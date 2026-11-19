// Contrato 34: a lógica pura de responder citando, das reações e do "digitando…" da tela do WhatsApp. Nada aqui envia:
// a resposta e a reação saem só pelo clique (`whatsappSend` / `whatsappReact` do preload); o "digitando…" da sua conta
// só com "Mostrar quando estou digitando" ligado, e o main confere de novo.
import {
  WHATSAPP_REPLY_PREVIEW_MAX,
  WHATSAPP_TYPING_IDLE_MS,
  WHATSAPP_TYPING_TTL_MS,
  type WhatsAppMessage,
  type WhatsAppMessageType,
  type WhatsAppPresence,
  type WhatsAppReaction,
  type WhatsAppReactionEmoji,
} from '@shared/whatsapp'

/** A barra de citação acima do campo: quem mandou e o trecho da mensagem respondida. */
export interface ReplyQuote {
  id: string
  author: string
  preview: string
}

const MEDIA_PREVIEW: Record<WhatsAppMessageType, string> = {
  text: '',
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  other: 'Mensagem',
}

/** O trecho de uma mensagem numa linha só, até 120: o texto (a legenda) ou o rótulo da mídia. */
export function quotePreview(message: Pick<WhatsAppMessage, 'type' | 'text'>): string {
  const line = message.text.replace(/\s+/g, ' ').trim()
  return (line || MEDIA_PREVIEW[message.type]).slice(0, WHATSAPP_REPLY_PREVIEW_MAX)
}

/** "Responder" num balão: a citação que vai para a barra acima do campo. */
export function quoteFor(message: WhatsAppMessage): ReplyQuote {
  return { id: message.id, author: message.fromMe ? 'Você' : message.author, preview: quotePreview(message) }
}

/**
 * O bloco de citação de um balão que responde outro: o autor (só com a citada carregada na tela) e o trecho guardado
 * (ou, sem ele, o da citada carregada). `null` quando a mensagem não responde nada.
 */
export function quotedBlock(message: WhatsAppMessage, loaded: readonly WhatsAppMessage[] | undefined): { id: string; author: string | null; preview: string; loaded: boolean } | null {
  if (!message.replyToId) return null
  const quoted = loaded?.find((item) => item.id === message.replyToId)
  const preview = message.replyPreview || (quoted ? quotePreview(quoted) : '')
  return { id: message.replyToId, author: quoted ? (quoted.fromMe ? 'Você' : quoted.author) : null, preview: preview || 'Mensagem', loaded: quoted !== undefined }
}

/** Contrato 34: o que sai ao tocar num emoji: ele mesmo ou, se ele já é a sua reação, o vazio (tira a sua). */
export function reactionToSend(reactions: readonly WhatsAppReaction[] | undefined, emoji: WhatsAppReactionEmoji): WhatsAppReactionEmoji | '' {
  return reactions?.some((reaction) => reaction.mine && reaction.emoji === emoji) ? '' : emoji
}

/** As reações novas de uma mensagem nas carregadas da conversa (as outras não mudam). Sem a mensagem, a mesma lista. */
export function withReactions(messages: readonly WhatsAppMessage[] | undefined, messageId: string, reactions: readonly WhatsAppReaction[]): WhatsAppMessage[] | undefined {
  if (!messages) return undefined
  const index = messages.findIndex((message) => message.id === messageId)
  if (index === -1) return messages as WhatsAppMessage[]
  const next = [...messages]
  next[index] = { ...(next[index] as WhatsAppMessage), reactions: reactions.length ? [...reactions] : undefined }
  return next
}

/** Quem está digitando, por conversa, até quando vale o aviso. */
export type TypingByChat = Record<string, { author: string | null; until: number }>

/** Um aviso de presença: "digitando" vale 10 s (renova a cada aviso); "parou" tira na hora. */
export function applyPresence(typing: TypingByChat, presence: WhatsAppPresence, now: number): TypingByChat {
  if (presence.state === 'composing') return { ...typing, [presence.chatId]: { author: presence.author, until: now + WHATSAPP_TYPING_TTL_MS } }
  if (!(presence.chatId in typing)) return typing
  return Object.fromEntries(Object.entries(typing).filter(([chatId]) => chatId !== presence.chatId))
}

/** Os avisos que ainda valem (a mesma lista quando nenhum venceu). */
export function pruneTyping(typing: TypingByChat, now: number): TypingByChat {
  const alive = Object.entries(typing).filter(([, entry]) => entry.until > now)
  return alive.length === Object.keys(typing).length ? typing : Object.fromEntries(alive)
}

/** A mensagem chegou: quem mandou parou de digitar naquela conversa. */
export function stopTyping(typing: TypingByChat, chatIds: Iterable<string>): TypingByChat {
  const ids = new Set(chatIds)
  if (![...ids].some((chatId) => chatId in typing)) return typing
  return Object.fromEntries(Object.entries(typing).filter(([chatId]) => !ids.has(chatId)))
}

/** "digitando…" ou, num grupo com o nome de quem, "Fulano está digitando…"; `null` sem aviso valendo. */
export function typingLabel(typing: TypingByChat, chatId: string, group: boolean, now: number): string | null {
  const entry = typing[chatId]
  if (!entry || entry.until <= now) return null
  return group && entry.author ? `${entry.author} está digitando…` : 'digitando…'
}

export interface TypingSignal {
  /** O texto do campo mudou pela digitação da pessoa. */
  input(text: string): void
  /** Enviou, saiu da conversa ou desligou: "parou", se o "digitando…" tinha saído. */
  stop(): void
}

export interface TypingSignalDeps {
  send: (state: 'composing' | 'paused') => void
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Contrato 34: o "digitando…" da sua conta, com espera de 3 s: o primeiro caractere manda "digitando" (de novo no máximo
 * a cada 3 s enquanto a pessoa digita, para o aviso do outro lado não vencer) e 3 s sem digitar, campo vazio ou o envio
 * mandam "parou". Quem cria só o liga com o interruptor ligado.
 */
export function createTypingSignal(deps: TypingSignalDeps): TypingSignal {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let composing = false
  let lastSent = 0
  let idle: unknown = null

  const pause = (): void => {
    if (idle !== null) clearTimer(idle)
    idle = null
    if (!composing) return
    composing = false
    deps.send('paused')
  }

  return {
    input(text) {
      if (!text.trim()) {
        pause()
        return
      }
      if (!composing || now() - lastSent >= WHATSAPP_TYPING_IDLE_MS) {
        composing = true
        lastSent = now()
        deps.send('composing')
      }
      if (idle !== null) clearTimer(idle)
      idle = setTimer(pause, WHATSAPP_TYPING_IDLE_MS)
    },
    stop: pause,
  }
}
