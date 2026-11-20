// Conferência das mídias de uma publicação (contrato 71, R4 e CA6 da spec redes-instagram) antes de salvar o rascunho,
// pelas regras da Meta: imagem só JPEG (até 8 MB, largura de 320 px ou mais, proporção de 4:5 a 1,91:1; acima de 1440 px
// a Meta reduz), vídeo MP4 ou MOV (até 300 MB, de 3 s a 15 min). Pura e sem dependência: lê só os cabeçalhos pelo
// `readHead` injetado (o serviço lê do disco; os testes, de um buffer). O JPEG pelos bytes `FF D8` e as dimensões pelo
// marcador SOF; o MP4/MOV pelo `ftyp`, a duração pelo `mvhd` e as dimensões pelo `tkhd` da trilha de vídeo. O `moov`
// no fim do arquivo (o padrão de quem grava sem "faststart") é achado pulando as caixas pelo tamanho, sem ler o `mdat`.
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIN_WIDTH,
  IMAGE_RATIO_MAX,
  IMAGE_RATIO_MIN,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
  type MediaCandidate,
  type PublicationMediaKind,
} from '../../shared/redes'

/** Lê `bytes` bytes a partir de `position` (0 sem o terceiro argumento); menos no fim do arquivo. */
export type ReadHead = (path: string, bytes: number, position?: number) => Promise<Uint8Array>

export const MEDIA_PROBLEMS = {
  notJpeg: 'Só JPEG é aceito para imagem',
  imageTooBig: 'Imagem acima de 8 MB',
  narrow: `Largura mínima de ${IMAGE_MIN_WIDTH} px`,
  unreadableImage: 'Não consegui ler as dimensões da imagem',
  videoTooBig: 'Vídeo acima de 300 MB',
  duration: 'Vídeo precisa ter entre 3 s e 15 min',
  unknownVideo: 'Formato de vídeo não reconhecido',
} as const

/** "Proporção fora de 4:5 a 1,91:1 (está em 3,2:1)". */
export const ratioProblem = (width: number, height: number): string => `Proporção fora de 4:5 a 1,91:1 (está em ${ratioText(width, height)})`

const decimal = (value: number): string => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
/** Larga: `3,2:1`; alta: `1:3,2`. */
function ratioText(width: number, height: number): string {
  return width >= height ? `${decimal(width / height)}:1` : `1:${decimal(height / width)}`
}

/** Pedaço lido de uma vez: os cabeçalhos de um JPEG ou as caixas de um MP4 caem quase sempre no primeiro. */
const CHUNK = 64 * 1024
/** O `moov` maior que isto não é lido (um vídeo de 15 min tem poucos MB de índice). */
const MOOV_MAX = 32 * 1024 * 1024
const MAX_JPEG_SEGMENTS = 512
const MAX_TOP_BOXES = 4096

type Reader = (offset: number, length: number) => Promise<Uint8Array>

/** Leitura com um pedaço em cache, para andar pelos marcadores e caixas sem uma ida ao disco por cabeçalho. */
function cachedReader(path: string, readHead: ReadHead, size: number): Reader {
  let start = -1
  let chunk: Uint8Array = new Uint8Array(0)
  return async (offset, length) => {
    if (offset < 0 || offset >= size || length <= 0) return new Uint8Array(0)
    const end = Math.min(offset + length, size)
    if (start < 0 || offset < start || end > start + chunk.byteLength) {
      start = offset
      chunk = await readHead(path, Math.max(CHUNK, end - offset), offset)
    }
    return chunk.subarray(offset - start, Math.min(end, start + chunk.byteLength) - start)
  }
}

const u16 = (data: Uint8Array, at: number): number => ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0)
const u32 = (data: Uint8Array, at: number): number => (((data[at] ?? 0) << 24) >>> 0) + (((data[at + 1] ?? 0) << 16) | ((data[at + 2] ?? 0) << 8) | (data[at + 3] ?? 0))
const i32 = (data: Uint8Array, at: number): number => u32(data, at) | 0
const u64 = (data: Uint8Array, at: number): number => u32(data, at) * 2 ** 32 + u32(data, at + 4)
const fourcc = (data: Uint8Array, at: number): string => String.fromCharCode(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0, data[at + 3] ?? 0)

/** SOF0 a SOF15, menos DHT (C4), JPG (C8) e DAC (CC). */
const isSof = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** Largura e altura do marcador SOF, andando pelos segmentos (os de EXIF podem ter dezenas de KB). */
async function jpegSize(read: Reader): Promise<{ width: number; height: number } | null> {
  let pos = 2
  for (let count = 0; count < MAX_JPEG_SEGMENTS; count++) {
    const head = await read(pos, 4)
    if (head.byteLength < 2 || head[0] !== 0xff) return null
    const marker = head[1] ?? 0
    // Bytes de preenchimento e marcadores sem tamanho.
    if (marker === 0xff) {
      pos += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2
      continue
    }
    // Fim da imagem ou começo dos dados comprimidos antes do SOF: não é um JPEG que dê para ler.
    if (marker === 0xd9 || marker === 0xda || head.byteLength < 4) return null
    const length = u16(head, 2)
    if (length < 2) return null
    if (isSof(marker)) {
      const sof = await read(pos + 4, 5)
      if (sof.byteLength < 5) return null
      const height = u16(sof, 1)
      const width = u16(sof, 3)
      return width > 0 && height > 0 ? { width, height } : null
    }
    pos += 2 + length
  }
  return null
}

/** Marcas do `ftyp` de imagem HEIF/AVIF (a foto do iPhone): não é vídeo, e a Meta só aceita JPEG. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'])
/** Caixas que abrem um MOV antigo sem `ftyp`. */
const QUICKTIME_FIRST_BOXES = new Set(['moov', 'mdat', 'wide', 'free', 'skip'])

interface Box {
  type: string
  /** Começo do conteúdo (depois do cabeçalho), relativo ao buffer. */
  start: number
  end: number
}

/** As caixas filhas de um trecho já em memória. */
function children(data: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = []
  let pos = from
  while (pos + 8 <= to) {
    const size32 = u32(data, pos)
    const type = fourcc(data, pos + 4)
    const header = size32 === 1 ? 16 : 8
    const size = size32 === 1 ? u64(data, pos + 8) : size32 === 0 ? to - pos : size32
    if (size < header || pos + size > to) break
    boxes.push({ type, start: pos + header, end: pos + size })
    pos += size
  }
  return boxes
}

const child = (data: Uint8Array, box: Box, type: string): Box | undefined => children(data, box.start, box.end).find((item) => item.type === type)

/** Duração (s) pelo `mvhd`; largura e altura pelo `tkhd` da trilha de vídeo (com a rotação do vídeo em pé). */
function parseMoov(moov: Uint8Array): { durationSeconds: number | null; width: number | null; height: number | null } {
  const root: Box = { type: 'moov', start: 0, end: moov.byteLength }
  let durationSeconds: number | null = null
  const mvhd = child(moov, root, 'mvhd')
  if (mvhd) {
    const version = moov[mvhd.start] ?? 0
    const timescale = version === 1 ? u32(moov, mvhd.start + 20) : u32(moov, mvhd.start + 12)
    const duration = version === 1 ? u64(moov, mvhd.start + 24) : u32(moov, mvhd.start + 16)
    if (timescale > 0) durationSeconds = duration / timescale
  }
  for (const trak of children(moov, root.start, root.end).filter((box) => box.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia')
    const hdlr = mdia ? child(moov, mdia, 'hdlr') : undefined
    if (!hdlr || fourcc(moov, hdlr.start + 8) !== 'vide') continue
    const tkhd = child(moov, trak, 'tkhd')
    if (!tkhd) continue
    const version = moov[tkhd.start] ?? 0
    const matrix = tkhd.start + (version === 1 ? 52 : 40)
    const dims = matrix + 36
    if (dims + 8 > tkhd.end) continue
    let width = u32(moov, dims) >>> 16
    let height = u32(moov, dims + 4) >>> 16
    // Matriz de 90° ou 270° (a = 0, b = ±1): o vídeo gravado em pé tem largura e altura trocadas no `tkhd`.
    if (i32(moov, matrix) === 0 && Math.abs(i32(moov, matrix + 4)) === 0x10000) [width, height] = [height, width]
    if (width > 0 && height > 0) return { durationSeconds, width, height }
  }
  return { durationSeconds, width: null, height: null }
}

/** O `moov` do arquivo, pulando as caixas de topo pelo tamanho (`null` se não há, ou é grande demais). */
async function readMoov(read: Reader, size: number): Promise<Uint8Array | null> {
  let pos = 0
  for (let count = 0; count < MAX_TOP_BOXES && pos + 8 <= size; count++) {
    const head = await read(pos, 16)
    if (head.byteLength < 8) return null
    const size32 = u32(head, 0)
    const header = size32 === 1 ? 16 : 8
    const boxSize = size32 === 1 ? u64(head, 8) : size32 === 0 ? size - pos : size32
    if (boxSize < header) return null
    if (fourcc(head, 4) === 'moov') {
      const length = Math.min(boxSize, size - pos) - header
      if (length <= 0 || length > MOOV_MAX) return null
      const body = new Uint8Array(length)
      // Em pedaços: o leitor devolve no máximo o que pediu, e às vezes menos no fim do arquivo.
      let filled = 0
      while (filled < length) {
        const part = await read(pos + header + filled, Math.min(CHUNK * 16, length - filled))
        if (!part.byteLength) return null
        body.set(part, filled)
        filled += part.byteLength
      }
      return body
    }
    pos += boxSize
  }
  return null
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || path
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|qt)$/i

/** Confere um arquivo escolhido: o tipo pelos bytes (não pela extensão), as dimensões, a duração e os limites. */
export async function inspectMedia(path: string, readHead: ReadHead, size: number): Promise<MediaCandidate> {
  const fileName = fileNameOf(path)
  const read = cachedReader(path, readHead, size)
  const result = (kind: PublicationMediaKind | null, mimeType: string | null, width: number | null, height: number | null, durationSeconds: number | null, problems: string[]): MediaCandidate => ({
    path,
    fileName,
    ok: problems.length === 0,
    kind,
    mimeType,
    bytes: size,
    width,
    height,
    durationSeconds,
    problems,
  })

  const head = await read(0, 32)
  // JPEG.
  if (head[0] === 0xff && head[1] === 0xd8) {
    const problems: string[] = []
    if (size > IMAGE_MAX_BYTES) problems.push(MEDIA_PROBLEMS.imageTooBig)
    const dims = await jpegSize(read)
    if (!dims) return result('imagem', 'image/jpeg', null, null, null, [...problems, MEDIA_PROBLEMS.unreadableImage])
    if (dims.width < IMAGE_MIN_WIDTH) problems.push(MEDIA_PROBLEMS.narrow)
    const ratio = dims.width / dims.height
    // Uma pequena folga para o arredondamento de 1080×1350 e 1080×566.
    if (ratio < IMAGE_RATIO_MIN - 0.001 || ratio > IMAGE_RATIO_MAX + 0.001) problems.push(ratioProblem(dims.width, dims.height))
    return result('imagem', 'image/jpeg', dims.width, dims.height, null, problems)
  }
  // PNG, GIF, WebP: imagem, mas não JPEG.
  const png = head[0] === 0x89 && fourcc(head, 1).startsWith('PNG')
  const gif = fourcc(head, 0) === 'GIF8'
  const webp = fourcc(head, 0) === 'RIFF' && fourcc(head, 8) === 'WEBP'
  if (png || gif || webp) return result('imagem', null, null, null, null, [MEDIA_PROBLEMS.notJpeg])

  const firstBox = fourcc(head, 4)
  if (firstBox === 'ftyp' || QUICKTIME_FIRST_BOXES.has(firstBox)) {
    const brand = firstBox === 'ftyp' ? fourcc(head, 8) : 'qt  '
    if (IMAGE_BRANDS.has(brand)) return result('imagem', null, null, null, null, [MEDIA_PROBLEMS.notJpeg])
    const mimeType = brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    const problems: string[] = []
    if (size > VIDEO_MAX_BYTES) problems.push(MEDIA_PROBLEMS.videoTooBig)
    const moov = await readMoov(read, size)
    const info = moov ? parseMoov(moov) : null
    if (!info || info.durationSeconds === null || info.width === null || info.height === null) return result('video', mimeType, info?.width ?? null, info?.height ?? null, info?.durationSeconds ?? null, [...problems, MEDIA_PROBLEMS.unknownVideo])
    if (info.durationSeconds < VIDEO_MIN_SECONDS || info.durationSeconds > VIDEO_MAX_SECONDS) problems.push(MEDIA_PROBLEMS.duration)
    return result('video', mimeType, info.width, info.height, Math.round(info.durationSeconds * 1000) / 1000, problems)
  }

  // Nem imagem nem vídeo conhecidos: a razão pela extensão que a pessoa escolheu.
  return VIDEO_EXTENSION.test(fileName) ? result(null, null, null, null, null, [MEDIA_PROBLEMS.unknownVideo]) : result(null, null, null, null, null, [MEDIA_PROBLEMS.notJpeg])
}
