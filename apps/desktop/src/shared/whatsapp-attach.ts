// Contrato 39: anexar imagem ou vídeo a uma conversa do WhatsApp (arrastar e soltar ou o clipe). O tipo vem dos
// primeiros bytes do arquivo (magic bytes), nunca da extensão nem do tipo que o navegador informa: a tela usa isto
// para recusar na hora, o main confere de novo no envio e o serviço local também. Os bytes são opacos: o cabeçalho só
// decide aceitar ou recusar.

export const WHATSAPP_ATTACH_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'] as const
export type WhatsAppAttachMime = (typeof WHATSAPP_ATTACH_MIMES)[number]
export type WhatsAppAttachKind = 'image' | 'video'

/** Imagem até 16 MB e vídeo até 64 MB (os limites do WhatsApp). */
export const WHATSAPP_ATTACH_IMAGE_MAX = 16 * 1024 * 1024
export const WHATSAPP_ATTACH_VIDEO_MAX = 64 * 1024 * 1024
/** Nome do arquivo que acompanha o envio. */
export const WHATSAPP_ATTACH_NAME_MAX = 200
/** Quantos bytes do começo bastam para reconhecer o tipo. */
export const WHATSAPP_ATTACH_HEAD = 32

/** `type`: não é imagem nem vídeo aceito; `too-big`: passou do limite do tipo. */
export type WhatsAppAttachError = 'type' | 'too-big'

/** Um arquivo aceito, pronto para a prévia (só na memória da tela). */
export interface WhatsAppAttachment {
  name: string
  mime: WhatsAppAttachMime
  kind: WhatsAppAttachKind
  bytes: Uint8Array
}

/** "Clipe": o seletor do macOS no main. `null` quando a pessoa cancela. */
export type WhatsAppAttachPickResult = { ok: true; attachment: WhatsAppAttachment } | { ok: false; error: WhatsAppAttachError; kind?: WhatsAppAttachKind | undefined } | null

/** Enviar o anexo: só com o token de clique, como o texto (`WhatsAppSendRequest`). A legenda vai como foi digitada. */
export interface WhatsAppSendMediaRequest {
  chatId: string
  name: string
  mime: WhatsAppAttachMime
  bytes: Uint8Array
  caption?: string | undefined
  clickToken: string
}

/**
 * `timeout`: o serviço não respondeu em 300 s (o arquivo pode ter saído: a pessoa confere antes de tentar de novo);
 * `ffmpeg`: vídeo sem o ffmpeg instalado no Mac.
 */
export type WhatsAppSendMediaResult = { ok: true; id: string } | { ok: false; error: 'click' | 'state' | 'invalid' | 'too-big' | 'timeout' | 'ffmpeg' | 'failed' }

/** Marcas (`ftyp`) de MP4 de vídeo; HEIF, AVIF e áudio M4A ficam de fora. */
const MP4_BRANDS = /^(?:isom|iso[2-9]|mp4[12]|mp71|avc1|M4V[ HP]|mmp4|dash|MSNV|NDS[CHMPS]|NDX[CHMPS]|f4v |3gp[4-6]|3g2[abc]|XAVC)$/

const ascii = (bytes: Uint8Array, from: number, to: number): string => (bytes.byteLength >= to ? String.fromCharCode(...bytes.subarray(from, to)) : '')

/**
 * O tipo pelos primeiros bytes (JPEG, PNG, WebP, GIF, MP4, MOV); `null` para qualquer outra coisa. MP4 e MOV só com a
 * caixa `ftyp` no começo (MOV pela marca `qt  `): o QuickTime antigo, que começa direto por `moov`/`free`/`wide`, fica de
 * fora, porque reconhecê-lo pelo nome do átomo deixava passar um SVG ou HTML com "free" nos bytes 4 a 8.
 */
export function sniffAttachment(head: Uint8Array): WhatsAppAttachMime | null {
  if (head.byteLength >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (ascii(head, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp'
  const gif = ascii(head, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  const box = ascii(head, 4, 8)
  if (box === 'ftyp') {
    const brand = ascii(head, 8, 12)
    if (brand === 'qt  ') return 'video/quicktime'
    return MP4_BRANDS.test(brand) ? 'video/mp4' : null
  }
  return null
}

export const attachKind = (mime: WhatsAppAttachMime): WhatsAppAttachKind => (mime.startsWith('video/') ? 'video' : 'image')
export const attachLimit = (kind: WhatsAppAttachKind): number => (kind === 'video' ? WHATSAPP_ATTACH_VIDEO_MAX : WHATSAPP_ATTACH_IMAGE_MAX)

/**
 * Aceita ou recusa pelo cabeçalho e pelo tamanho (`size`, o do arquivo inteiro; sem ele, o dos bytes). Com `declared`,
 * o tipo informado tem de ser o mesmo que os bytes dizem: tipo mentiroso é recusado.
 */
export function checkAttachment(
  head: Uint8Array,
  options: { size?: number; declared?: string } = {},
): { ok: true; mime: WhatsAppAttachMime; kind: WhatsAppAttachKind } | { ok: false; error: WhatsAppAttachError; kind?: WhatsAppAttachKind } {
  const mime = sniffAttachment(head)
  if (!mime || (options.declared !== undefined && options.declared !== mime)) return { ok: false, error: 'type' }
  const kind = attachKind(mime)
  const size = options.size ?? head.byteLength
  if (size <= 0) return { ok: false, error: 'type' }
  if (size > attachLimit(kind)) return { ok: false, error: 'too-big', kind }
  return { ok: true, mime, kind }
}

/** O nome que acompanha o envio: sem caminho, sem caracteres de controle, até 200 caracteres. */
export function attachName(name: string): string {
  // eslint-disable-next-line no-control-regex -- os caracteres de controle saem de propósito
  const clean = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (clean || 'arquivo').slice(0, WHATSAPP_ATTACH_NAME_MAX)
}

/** Mensagem de recusa para a pessoa. */
export function attachErrorText(error: WhatsAppAttachError, kind?: WhatsAppAttachKind): string {
  if (error === 'too-big') return kind === 'video' ? 'O vídeo passa de 64 MB, o limite do WhatsApp.' : 'A imagem passa de 16 MB, o limite do WhatsApp.'
  return 'Só dá para anexar imagem (JPG, PNG, WebP ou GIF) ou vídeo (MP4 ou MOV).'
}
