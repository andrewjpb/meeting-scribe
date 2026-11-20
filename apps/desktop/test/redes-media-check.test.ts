// Contrato 71 (CA6): a conferência das mídias antes de salvar o rascunho, com os arquivos de `fixtures/redes/` (um JPEG
// 640×800 e um MP4 de 4 s, com o `moov` no fim e no começo) e com cabeçalhos montados aqui (PNG, HEIC, WebP, SOF2 depois
// de um EXIF grande, vídeo em pé, `mvhd` versão 1, tamanhos e durações fora dos limites).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectMedia, MEDIA_PROBLEMS, ratioProblem, type ReadHead } from '../src/main/redes/media-check'

const FIXTURES = join(__dirname, 'fixtures', 'redes')

/** Leitor sobre um buffer, contando as leituras (para provar que o `mdat` não é lido inteiro). */
function memory(data: Uint8Array): { read: ReadHead; reads: { bytes: number; position: number }[] } {
  const reads: { bytes: number; position: number }[] = []
  return {
    reads,
    read: (_path, bytes, position = 0) => {
      reads.push({ bytes, position })
      return Promise.resolve(data.subarray(position, Math.min(position + bytes, data.byteLength)))
    },
  }
}

const inspect = (name: string, data: Uint8Array, size = data.byteLength) => inspectMedia(`/tmp/${name}`, memory(data).read, size)

const u32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))
const box = (type: string, payload: number[]): number[] => [...u32(payload.length + 8), ...ascii(type), ...payload]

/** JPEG mínimo: SOI, um APP1 de `appBytes`, o SOF pedido e SOS. */
function jpeg(width: number, height: number, sof = 0xc0, appBytes = 16): Uint8Array {
  const app = [0xff, 0xe1, ((appBytes + 2) >> 8) & 0xff, (appBytes + 2) & 0xff, ...Array<number>(appBytes).fill(0x45)]
  const frame = [0xff, sof, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, ...Array<number>(9).fill(0)]
  return Uint8Array.from([0xff, 0xd8, ...app, ...frame, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
}

/** MP4 mínimo: `ftyp`, `mdat` de `mdatBytes` e o `moov` (no fim, se `moovLast`). */
function mp4(options: { width: number; height: number; timescale: number; duration: number; rotate?: boolean; version1?: boolean; moovLast?: boolean; mdatBytes?: number; brand?: string; noVideo?: boolean }): Uint8Array {
  const { width, height, timescale, duration } = options
  const mvhd = options.version1
    ? box('mvhd', [1, 0, 0, 0, ...Array<number>(16).fill(0), ...u32(timescale), ...u32(0), ...u32(duration), ...Array<number>(80).fill(0)])
    : box('mvhd', [0, 0, 0, 0, ...Array<number>(8).fill(0), ...u32(timescale), ...u32(duration), ...Array<number>(80).fill(0)])
  const matrix = options.rotate ? [...u32(0), ...u32(0x10000), ...u32(0), ...u32(0xffff0000), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)] : [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)]
  const tkhd = box('tkhd', [0, 0, 0, 3, ...Array<number>(20).fill(0), ...Array<number>(16).fill(0), ...matrix, ...u32(width << 16), ...u32(height << 16)])
  const hdlr = box('hdlr', [0, 0, 0, 0, ...u32(0), ...ascii(options.noVideo ? 'soun' : 'vide'), ...Array<number>(13).fill(0)])
  const trak = box('trak', [...tkhd, ...box('mdia', [...hdlr])])
  const moov = box('moov', [...mvhd, ...trak])
  const ftyp = box('ftyp', [...ascii(options.brand ?? 'isom'), ...u32(512), ...ascii('isomiso2mp41')])
  const mdat = box('mdat', Array<number>(options.mdatBytes ?? 64).fill(0))
  return Uint8Array.from(options.moovLast ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat])
}

describe('inspectMedia (contrato 71)', () => {
  it('o JPEG 640×800 da fixture é imagem válida (4:5)', async () => {
    const data = readFileSync(join(FIXTURES, 'imagem-640x800.jpg'))
    const result = await inspectMedia(join(FIXTURES, 'imagem-640x800.jpg'), memory(data).read, data.byteLength)
    expect(result).toMatchObject({ fileName: 'imagem-640x800.jpg', ok: true, kind: 'imagem', mimeType: 'image/jpeg', width: 640, height: 800, durationSeconds: null, problems: [] })
    expect(data.byteLength).toBeLessThan(200 * 1024)
  })

  it('o MP4 de 4 s com o `moov` no fim: acha a caixa pulando o `mdat`', async () => {
    for (const name of ['video-4s.mp4', 'video-4s-faststart.mp4']) {
      const data = readFileSync(join(FIXTURES, name))
      expect(data.byteLength).toBeLessThan(200 * 1024)
      const result = await inspectMedia(join(FIXTURES, name), memory(data).read, data.byteLength)
      expect(result, name).toMatchObject({ ok: true, kind: 'video', mimeType: 'video/mp4', width: 320, height: 400, problems: [] })
      expect(result.durationSeconds, name).toBeCloseTo(4, 1)
    }
  })

  it('o `moov` depois de um `mdat` grande é lido sem ler o `mdat`', async () => {
    const data = mp4({ width: 1080, height: 1920, timescale: 600, duration: 600 * 30, moovLast: true, mdatBytes: 3 * 1024 * 1024 })
    const { read, reads } = memory(data)
    const result = await inspectMedia('/tmp/longo.mp4', read, data.byteLength)
    expect(result).toMatchObject({ ok: true, width: 1080, height: 1920, durationSeconds: 30 })
    expect(reads.reduce((total, item) => total + item.bytes, 0)).toBeLessThan(512 * 1024)
  })

  it('PNG, GIF, WebP e HEIC: "Só JPEG é aceito para imagem"', async () => {
    const png = Uint8Array.from([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...Array<number>(24).fill(0)])
    const gif = Uint8Array.from([...ascii('GIF89a'), ...Array<number>(26).fill(0)])
    const webp = Uint8Array.from([...ascii('RIFF'), ...u32(100), ...ascii('WEBPVP8 '), ...Array<number>(20).fill(0)])
    const heic = Uint8Array.from(box('ftyp', [...ascii('heic'), ...u32(0), ...ascii('mif1heic')]))
    for (const [name, data] of [['a.png', png], ['a.gif', gif], ['a.webp', webp], ['IMG_0001.HEIC', heic]] as const) {
      const result = await inspect(name, data)
      expect(result, name).toMatchObject({ ok: false, kind: 'imagem', problems: [MEDIA_PROBLEMS.notJpeg] })
    }
  })

  it('SOF2 (progressivo) depois de um EXIF de 60 KB', async () => {
    const result = await inspect('progressivo.jpg', jpeg(1440, 1080, 0xc2, 60_000))
    expect(result).toMatchObject({ ok: true, width: 1440, height: 1080 })
  })

  it('os limites da imagem: tamanho, largura e proporção (acima de 1440 px vale)', async () => {
    expect((await inspect('grande.jpg', jpeg(1080, 1080), 9 * 1024 * 1024)).problems).toEqual([MEDIA_PROBLEMS.imageTooBig])
    expect((await inspect('estreita.jpg', jpeg(300, 300))).problems).toEqual([MEDIA_PROBLEMS.narrow])
    expect((await inspect('larga.jpg', jpeg(1920, 600))).problems).toEqual(['Proporção fora de 4:5 a 1,91:1 (está em 3,2:1)'])
    expect((await inspect('alta.jpg', jpeg(600, 1920))).problems).toEqual([ratioProblem(600, 1920)])
    expect(ratioProblem(600, 1920)).toBe('Proporção fora de 4:5 a 1,91:1 (está em 1:3,2)')
    expect((await inspect('retrato.jpg', jpeg(1080, 1350))).ok).toBe(true)
    expect((await inspect('paisagem.jpg', jpeg(1080, 566))).ok).toBe(true)
    expect((await inspect('enorme.jpg', jpeg(4000, 3000))).ok).toBe(true)
  })

  it('JPEG sem o SOF: não dá para ler as dimensões', async () => {
    const data = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
    expect((await inspect('quebrado.jpg', data)).problems).toEqual([MEDIA_PROBLEMS.unreadableImage])
  })

  it('vídeo: duração fora de 3 s a 15 min, acima de 300 MB, em pé, `mvhd` versão 1 e MOV', async () => {
    expect((await inspect('curto.mp4', mp4({ width: 720, height: 1280, timescale: 1000, duration: 2500 }))).problems).toEqual([MEDIA_PROBLEMS.duration])
    expect((await inspect('longo.mp4', mp4({ width: 720, height: 1280, timescale: 1000, duration: 901_000 }))).problems).toEqual([MEDIA_PROBLEMS.duration])
    const data = mp4({ width: 720, height: 1280, timescale: 1000, duration: 10_000 })
    expect((await inspect('pesado.mp4', data, 301 * 1024 * 1024)).problems).toEqual([MEDIA_PROBLEMS.videoTooBig])
    expect(await inspect('em-pe.mp4', mp4({ width: 1920, height: 1080, timescale: 600, duration: 6000, rotate: true }))).toMatchObject({ ok: true, width: 1080, height: 1920, durationSeconds: 10 })
    expect(await inspect('v1.mp4', mp4({ width: 1080, height: 1080, timescale: 90000, duration: 90000 * 5, version1: true }))).toMatchObject({ ok: true, durationSeconds: 5 })
    expect(await inspect('clipe.mov', mp4({ width: 1080, height: 1920, timescale: 600, duration: 6000, brand: 'qt  ' }))).toMatchObject({ ok: true, mimeType: 'video/quicktime' })
  })

  it('vídeo sem `moov` ou sem trilha de vídeo, e arquivo desconhecido', async () => {
    const noMoov = Uint8Array.from([...box('ftyp', [...ascii('isom'), ...u32(0)]), ...box('mdat', Array<number>(32).fill(0))])
    expect((await inspect('sem-moov.mp4', noMoov)).problems).toEqual([MEDIA_PROBLEMS.unknownVideo])
    expect((await inspect('audio.mp4', mp4({ width: 0, height: 0, timescale: 1000, duration: 10_000, noVideo: true }))).problems).toEqual([MEDIA_PROBLEMS.unknownVideo])
    const junk = Uint8Array.from(ascii('isto não é mídia nenhuma, só texto solto'))
    expect(await inspect('nada.mov', junk)).toMatchObject({ ok: false, kind: null, problems: [MEDIA_PROBLEMS.unknownVideo] })
    expect(await inspect('nada.txt', junk)).toMatchObject({ ok: false, kind: null, problems: [MEDIA_PROBLEMS.notJpeg] })
  })
})
