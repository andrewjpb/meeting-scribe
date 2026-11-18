// Mídia do WhatsApp por clique (contrato 37): o que a tela usa sem React. Os bytes chegam pelo IPC só no clique em
// "Baixar" e viram `Blob`, guardados na sessão por mensagem (até 256 MB, as mais antigas saem); o object URL existe só
// enquanto um elemento na tela o usa e é revogado quando o último sai (trocar de conversa desmonta tudo). O player do áudio:
// tempo, velocidade e a posição clicada na barra. Os textos de erro e o aviso das mensagens de antes desta versão.
import { WHATSAPP_DOWNLOADABLE_KINDS, type WhatsAppMedia, type WhatsAppMediaError, type WhatsAppTranscribeError } from '@shared/whatsapp'

/** Velocidades do áudio, na ordem do botão. */
export const PLAYBACK_RATES = [1, 1.5, 2] as const

/** A próxima velocidade: 1x → 1.5x → 2x → 1x. */
export function nextRate(rate: number): number {
  const index = PLAYBACK_RATES.findIndex((value) => value === rate)
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1
}

/** "1x", "1.5x", "2x". */
export const rateLabel = (rate: number): string => `${rate}x`

/** "0:07", "12:05", "1:02:03"; sem duração conhecida, "0:00". */
export function timeLabel(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** A fração da barra no ponto clicado (0 a 1). */
export function seekRatio(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0
  return Math.min(1, Math.max(0, (clientX - left) / width))
}

/** A duração que vale: a do arquivo, se for conhecida; senão a que o WhatsApp informou. */
export const knownDuration = (fromFile: number, fromMessage: number | undefined): number => (Number.isFinite(fromFile) && fromFile > 0 ? fromFile : (fromMessage ?? 0))

/** Imagem, vídeo e áudio baixam; documento e figurinha, não. */
export const supportsDownload = (media: WhatsAppMedia): boolean => (WHATSAPP_DOWNLOADABLE_KINDS as readonly string[]).includes(media.kind)

/** O clique baixa: tipo suportado e as chaves guardadas pelo serviço. */
export const canDownload = (media: WhatsAppMedia): boolean => supportsDownload(media) && media.downloadable === true

/** Mídia suportada de antes desta versão (o serviço não guardou as chaves do download). */
export const OLD_MEDIA_TITLE = 'Disponível só para mensagens recebidas a partir desta versão'
export const TRANSCRIBE_TITLE = 'O áudio é enviado à AssemblyAI para transcrever'

export function mediaErrorText(error: WhatsAppMediaError): string {
  switch (error) {
    case 'gone':
      return 'Este arquivo não está mais disponível no WhatsApp'
    case 'too-big':
      return 'Arquivo grande demais'
    case 'unavailable':
      return 'Não foi possível baixar agora. Tente de novo.'
  }
}

/**
 * O erro desabilita o "Baixar"? Só "grande demais": o `gone` também cobre falha passageira do WhatsApp (o whatsmeow não
 * distingue), e o clique tenta de novo (nunca sozinho).
 */
export const mediaErrorFinal = (error: WhatsAppMediaError): boolean => error === 'too-big'

export function transcribeErrorText(error: WhatsAppTranscribeError): string {
  switch (error) {
    case 'gone':
    case 'too-big':
    case 'unavailable':
      return mediaErrorText(error)
    case 'no-key':
      return 'Adicione a chave da AssemblyAI em Configurações › Gravação para transcrever.'
    case 'key':
      return 'A AssemblyAI recusou a chave. Confira em Configurações › Gravação.'
    case 'timeout':
      return 'A transcrição demorou demais. Tente de novo.'
    case 'not-cached':
    case 'failed':
      return 'Não foi possível transcrever o áudio. Tente de novo.'
  }
}

/** Chave de uma mensagem nos guardados da sessão. */
export const mediaKey = (chatId: string, messageId: string): string => `${chatId}\n${messageId}`

/** Os bytes que vieram pelo IPC como `Blob` do tipo da mídia. */
export const toBlob = (bytes: Uint8Array, mime: string): Blob => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })

export interface BlobStore {
  get(key: string): Blob | undefined
  put(key: string, blob: Blob): void
  clear(): void
  /** Bytes guardados agora. */
  size(): number
}

/** Os blobs baixados nesta sessão, por mensagem, até `max` bytes: passou disso, os menos usados saem. */
export function createBlobStore(max = 256 * 1024 * 1024): BlobStore {
  const blobs = new Map<string, Blob>()
  let total = 0
  return {
    get(key) {
      const blob = blobs.get(key)
      if (blob) {
        blobs.delete(key)
        blobs.set(key, blob)
      }
      return blob
    },
    put(key, blob) {
      const before = blobs.get(key)
      if (before) total -= before.size
      blobs.delete(key)
      blobs.set(key, blob)
      total += blob.size
      for (const [oldest, old] of blobs) {
        if (total <= max || oldest === key) break
        blobs.delete(oldest)
        total -= old.size
      }
    },
    clear() {
      blobs.clear()
      total = 0
    },
    size: () => total,
  }
}

export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface ObjectUrlRegistry {
  /** O object URL do blob (o mesmo enquanto ele estiver em uso). */
  urlFor(blob: Blob): string
  /** Um elemento na tela passou a usar o blob. */
  acquire(blob: Blob): void
  /** O elemento saiu da tela: sem mais ninguém usando, o URL é revogado (logo depois, para a remontagem do React). */
  release(blob: Blob): void
  /** URLs vivos agora. */
  live(): number
}

/**
 * Os object URLs dos elementos na tela, contados por uso: o último a sair revoga. A revogação espera um instante
 * (`defer`) porque o React desmonta e monta de novo na mesma passada (modo estrito, troca de chave).
 */
export function createUrlRegistry(api: ObjectUrlApi = URL, defer: (job: () => void) => void = (job) => setTimeout(job, 0)): ObjectUrlRegistry {
  const urls = new Map<Blob, { url: string; users: number }>()
  return {
    urlFor(blob) {
      const known = urls.get(blob)
      if (known) return known.url
      const url = api.createObjectURL(blob)
      urls.set(blob, { url, users: 0 })
      return url
    },
    acquire(blob) {
      const known = urls.get(blob)
      if (known) known.users++
      else urls.set(blob, { url: api.createObjectURL(blob), users: 1 })
    },
    release(blob) {
      const known = urls.get(blob)
      if (!known) return
      known.users = Math.max(0, known.users - 1)
      if (known.users > 0) return
      defer(() => {
        if (urls.get(blob) !== known || known.users > 0) return
        urls.delete(blob)
        api.revokeObjectURL(known.url)
      })
    },
    live: () => urls.size,
  }
}

/** Os object URLs da tela do WhatsApp. */
export const objectUrls = createUrlRegistry()

/** Os blobs desta sessão do app (o main não guarda bytes). */
export const sessionBlobs = createBlobStore()
/** As transcrições já lidas nesta sessão (texto, ou `null` quando ainda não há): não pergunta de novo ao main. */
export const sessionTranscripts = new Map<string, string | null>()
