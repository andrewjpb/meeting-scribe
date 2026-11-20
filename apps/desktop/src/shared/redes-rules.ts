// Redes (contrato 72): os limites da legenda e do carrossel e as regras puras que a tela usa (o contador da legenda e o
// tipo da publicação pelas mídias), sem o zod: o renderer importa daqui, e `redes.ts` reexporta para o main.
import type { PublicationMediaKind, PublicationType } from './redes'

export const CAPTION_MAX = 2200
export const CAPTION_HASHTAGS_MAX = 30
export const CAPTION_MENTIONS_MAX = 20
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 10
/** Texto alternativo por imagem. */
export const ALT_TEXT_MAX = 1000

export interface CaptionStats {
  /** Caracteres como a pessoa conta (pontos de código, um emoji simples é 1). */
  chars: number
  hashtags: number
  mentions: number
  problems: string[]
}

const HASHTAG = /(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu
const MENTION = /(^|[^\p{L}\p{N}_.@])@[A-Za-z0-9._]+/gu
const thousands = (value: number): string => value.toLocaleString('pt-BR')

/** O contador da legenda e o que passa dos limites da Meta (2.200 caracteres, 30 hashtags, 20 @). */
export function captionStats(caption: string): CaptionStats {
  const chars = [...caption].length
  const hashtags = caption.match(HASHTAG)?.length ?? 0
  const mentions = caption.match(MENTION)?.length ?? 0
  const problems: string[] = []
  if (chars > CAPTION_MAX) problems.push(`Legenda acima de ${thousands(CAPTION_MAX)} caracteres`)
  if (hashtags > CAPTION_HASHTAGS_MAX) problems.push(`Mais de ${CAPTION_HASHTAGS_MAX} hashtags na legenda`)
  if (mentions > CAPTION_MENTIONS_MAX) problems.push(`Mais de ${CAPTION_MENTIONS_MAX} menções (@) na legenda`)
  return { chars, hashtags, mentions, problems }
}

/** 1 imagem → imagem; 2 a 10 imagens → carrossel; 1 vídeo → Reels. O resto é recusado com a razão. */
export function inferPublicationType(media: readonly { kind: PublicationMediaKind }[]): PublicationType | { error: string } {
  const videos = media.filter((item) => item.kind === 'video').length
  const images = media.length - videos
  if (media.length === 0) return { error: 'Escolha ao menos uma imagem ou um vídeo' }
  if (videos > 0 && images > 0) return { error: 'Vídeo não entra em carrossel: publique o vídeo sozinho' }
  if (videos > 1) return { error: 'Só um vídeo por publicação' }
  if (videos === 1) return 'reels'
  if (images > CAROUSEL_MAX) return { error: `Carrossel aceita no máximo ${CAROUSEL_MAX} imagens` }
  return images === 1 ? 'imagem' : 'carrossel'
}

// 74: mensagens
// Contrato 74 (R6): os limites da resposta por mensagem direta e as duas regras puras que a tela e o main usam (o contador
// de bytes e a janela de 24 h), aqui sem o zod pelo mesmo motivo de cima.

/** A Meta aceita até 1000 bytes (UTF-8) no texto de uma mensagem. */
export const MESSAGE_TEXT_MAX_BYTES = 1000
/** A janela de resposta: 24 h desde a última mensagem do contato. */
export const MESSAGE_WINDOW_MS = 24 * 3_600_000

/** O tamanho do texto como a Meta conta (bytes em UTF-8: acento vale 2, emoji vale 4). */
export function messageBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** A última mensagem do contato tem mais de 24 h (sem mensagem dele, não há janela aberta). */
export function outsideMessageWindow(lastInboundAt: string | null, now: number): boolean {
  if (!lastInboundAt) return true
  const at = Date.parse(lastInboundAt)
  return !Number.isFinite(at) || now - at > MESSAGE_WINDOW_MS
}
// fim 74
