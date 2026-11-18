// Notificações do WhatsApp (contrato 40, CA1 e CA2), sem relógio nem Electron: cada mensagem recebida entra com as
// configurações, o bloqueio e se a pessoa já está olhando a conversa (janela em foco com ela aberta); sai a
// notificação a mostrar, ou nada. Quem mostra é injetado (`ShowNotice`): no app, a `Notification` do Electron; nos
// testes e no smoke, um substituto que registra. Tudo é local: nada da mensagem sai da máquina.
import type { WhatsAppMessage, WhatsAppMessageType } from '../../shared/whatsapp'

/** Corpo da notificação: no máximo isto de caracteres (com as reticências). */
export const NOTICE_BODY_MAX = 140
/** Rajada: a partir desta mensagem do mesmo chat dentro da janela, as notificações viram uma só. */
export const BURST_MIN = 3
export const BURST_WINDOW_MS = 5000

export interface NotifySettings {
  /** `whatsappNotifications`: desligado, nada sai. */
  enabled: boolean
  /** `whatsappNotifyGroups`: desligado ("Só pessoas"), mensagem de grupo não notifica. */
  groups: boolean
}

export interface IncomingNotice {
  message: WhatsAppMessage
  chatName: string
  settings: NotifySettings
  /** A janela do app está em foco com esta conversa aberta: a pessoa já está vendo. */
  viewing: boolean
  /** App bloqueado (contrato 22): sem o texto e sem a foto. */
  locked: boolean
  /** Foto da conversa (data URL), quando o main tem; o macOS pode ignorar. */
  icon?: string | null | undefined
}

export interface WhatsAppNotice {
  chatId: string
  title: string
  body: string
  /** Quantas mensagens a notificação resume (1, ou 3 ou mais numa rajada). */
  count: number
  icon: string | null
}

export interface NoticeHandle {
  close(): void
}

/** Mostra uma notificação e devolve como tirá-la (a rajada troca as anteriores pela de "N mensagens"). */
export type ShowNotice = (notice: WhatsAppNotice) => NoticeHandle

/** Conversa de grupo pelo id (`…@g.us`). */
export const isGroupChat = (chatId: string): boolean => chatId.endsWith('@g.us')

const MEDIA_LABELS: Partial<Record<WhatsAppMessageType, string>> = {
  image: '🖼 Imagem',
  audio: '🎤 Áudio',
  video: '🎬 Vídeo',
  document: '📎 Documento',
  sticker: 'Figurinha',
}

/** Corta em `max` caracteres (por ponto de código: emoji não parte ao meio), com reticências. */
export function clip(text: string, max = NOTICE_BODY_MAX): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** Título: o nome do contato; no grupo, "Autor · Grupo". */
export function noticeTitle(message: WhatsAppMessage, chatName: string): string {
  const name = chatName.trim() || message.chatId.split('@')[0] || 'WhatsApp'
  if (!isGroupChat(message.chatId)) return name
  const author = message.author.trim()
  return author ? `${author} · ${name}` : name
}

/** Corpo: o texto (≤140), ou o rótulo da mídia com a legenda, se houver. */
export function noticeBody(message: WhatsAppMessage): string {
  const text = message.text.replace(/\s+/g, ' ').trim()
  const label = message.type === 'text' ? undefined : MEDIA_LABELS[message.type]
  if (label) return clip(text ? `${label} · ${text}` : label)
  return clip(text || 'Mensagem')
}

/** Notifica? Nunca o que eu mandei; nada desligado; grupo só com a opção; nada com a conversa já à vista. */
export function shouldNotify(input: Pick<IncomingNotice, 'message' | 'settings' | 'viewing' | 'locked'>): boolean {
  const { message, settings } = input
  if (message.fromMe || !settings.enabled) return false
  if (isGroupChat(message.chatId) && !settings.groups) return false
  // Bloqueado, a conversa não está à vista (a tela fica coberta): avisa, sem o texto.
  return input.locked || !input.viewing
}

interface Burst {
  first: number
  count: number
  handles: NoticeHandle[]
}

export interface WhatsAppNotifier {
  /** Uma mensagem recebida: mostra (ou não) e devolve o que foi mostrado. */
  receive(input: IncomingNotice): WhatsAppNotice | null
}

/**
 * O notificador, com a memória das rajadas por conversa. Até a segunda mensagem do chat em 5 s, uma notificação por
 * mensagem; da terceira em diante, as anteriores saem e fica uma só, "N mensagens de Fulano". Bloqueado, o título é o
 * nome do app e o corpo só diz de quem é.
 */
export function createWhatsAppNotifier(deps: { show: ShowNotice; appName: () => string; now: () => number }): WhatsAppNotifier {
  const bursts = new Map<string, Burst>()

  return {
    receive(input) {
      if (!shouldNotify(input)) return null
      const { message, chatName, locked } = input
      const chatId = message.chatId
      const now = deps.now()
      for (const [id, burst] of bursts) if (now - burst.first > BURST_WINDOW_MS) bursts.delete(id)
      let burst = bursts.get(chatId)
      if (!burst) {
        burst = { first: now, count: 0, handles: [] }
        bursts.set(chatId, burst)
      }
      burst.count++
      const group = isGroupChat(chatId)
      const who = noticeTitle(message, chatName)
      const name = group ? chatName.trim() || who : who
      const count = burst.count >= BURST_MIN ? burst.count : 1
      const many = group ? `${count} mensagens em ${name}` : `${count} mensagens de ${name}`
      const notice: WhatsAppNotice =
        count > 1
          ? { chatId, title: locked ? deps.appName() : name, body: many, count, icon: locked ? null : (input.icon ?? null) }
          : locked
            ? { chatId, title: deps.appName(), body: `Mensagem de ${who}`, count, icon: null }
            : { chatId, title: who, body: noticeBody(message), count, icon: input.icon ?? null }
      if (count > 1) {
        for (const handle of burst.handles) handle.close()
        burst.handles = []
      }
      burst.handles.push(deps.show(notice))
      return notice
    },
  }
}
