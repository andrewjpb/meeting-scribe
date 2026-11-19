// WhatsApp no renderer (contrato 24): o estado do serviço local, as conversas e as mensagens da conversa aberta.
// Nada de token, porta ou caminho chega aqui. O envio passa por `__scribeApi.whatsappSend`, que só funciona no
// clique (ou ⌘↵) da pessoa: o preload confere a ativação do usuário e gera o token de clique.
//
// Contrato 32: as fotos de perfil, pedidas uma vez por conversa que aparece na tela, no máximo 3 ao mesmo tempo e
// sem segurar nada (a lista mostra as iniciais até a foto chegar).
//
// Contrato 36: os balões temporários do envio com "Corrigir ao enviar" ligado, por conversa (`pending.ts`).
//
// Contrato 34: as reações que mudam (as do serviço e as que a resposta do "reagir" traz) e quem está digitando em cada
// conversa, com o aviso vencendo sozinho 10 s depois do último (`interactions.ts`).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { WhatsAppChat, WhatsAppMessage, WhatsAppPresence, WhatsAppReaction, WhatsAppStatus } from '@shared/whatsapp'
import { applyPresence, pruneTyping, stopTyping, withReactions, type TypingByChat } from './interactions'
import { sessionBlobs, sessionTranscripts } from './media'
import { addPending, confirmPending, failPending, markPendingSent, PENDING_ECHO_WAIT_MS, settledIds, settlePending, type PendingByChat } from './pending'

interface WhatsAppState {
  status: WhatsAppStatus | null
  loadFailed: boolean
  chats: WhatsAppChat[] | null
  /** Mensagens por conversa (as carregadas até agora, da mais antiga para a mais nova). */
  messages: Record<string, WhatsAppMessage[]>
  /** Conversas sem mais mensagens antigas para carregar. */
  exhausted: Record<string, boolean>
  load: () => Promise<void>
  loadChats: () => Promise<void>
  open: (chatId: string, attempt?: number) => Promise<void>
  loadOlder: (chatId: string) => Promise<void>
  receive: (message: WhatsAppMessage, chatName: string) => void
  /** Várias mensagens novas de uma vez: uma só atualização da tela. */
  receiveMany: (items: readonly { message: WhatsAppMessage; chatName: string }[]) => void
  /** Contrato 32: foto de perfil por conversa (data URL), ou `null` quando não há. Ausente: ainda não chegou. */
  photos: Record<string, string | null>
  /**
   * Pede a foto da conversa, se ainda não pediu; nunca espera. `again`: ao abrir a conversa, a que veio sem foto é
   * pedida de novo (uma vez por abertura; o main guarda o "sem foto" por 10 min).
   */
  requestPhoto: (chatId: string, again?: boolean) => void
  /** Saiu da conta, removeu ou desconectou: as fotos guardadas saem. */
  forgetPhotos: () => void
  /** Contrato 36: balões temporários por conversa, até a mensagem real chegar. */
  pending: PendingByChat
  /** Mensagens que entraram no lugar de um temporário (o texto entra com um fade curto). */
  swapped: Record<string, true>
  /** Envio otimista que falhou: o texto e o erro que voltam ao campo da conversa (que pode estar fechada). */
  restore: Record<string, { text: string; error: string }>
  /** O clique em "Enviar" com a correção ligada: o temporário entra com o texto digitado. Devolve a chave dele. */
  startPending: (chatId: string, text: string) => string
  /** O envio foi aceito com este `id`: o temporário sai quando o eco chegar (ou já saiu, se chegou antes). */
  confirmPending: (chatId: string, key: string, id: string) => void
  /** O envio falhou: o temporário sai e o texto volta ao campo com o erro. */
  failPending: (chatId: string, key: string, error: string) => void
  /** O campo da conversa pegou o texto que voltou. */
  takeRestore: (chatId: string) => { text: string; error: string } | null
  /** Contrato 34: quem está digitando, por conversa (o aviso vence sozinho). */
  typing: TypingByChat
  receivePresence: (presence: WhatsAppPresence) => void
  /** Contrato 34: as reações de uma mensagem mudaram (todas, juntas por emoji). */
  setReactions: (chatId: string, messageId: string, reactions: readonly WhatsAppReaction[]) => void
}

/** Fotos pedidas ao mesmo tempo. */
const PHOTO_PARALLEL = 3
const photoQueue: string[] = []
const photoAsked = new Set<string>()
let photoRunning = 0
const photoRunningIds = new Set<string>()
let pendingCount = 0
/** Contrato 34: o próximo vencimento de um "digitando…". */
let typingTimer: ReturnType<typeof setTimeout> | null = null

const byTime = (a: WhatsAppMessage, b: WhatsAppMessage): number => a.at - b.at || a.id.localeCompare(b.id)

function merge(current: readonly WhatsAppMessage[], incoming: readonly WhatsAppMessage[]): WhatsAppMessage[] {
  const seen = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) seen.set(message.id, message)
  return [...seen.values()].sort(byTime)
}

/** As mensagens das conversas mudaram: os temporários já com a mensagem real saem (e ela ganha o fade). */
function settleChats(state: Pick<WhatsAppState, 'pending' | 'swapped'>, messages: Record<string, WhatsAppMessage[]>, chatIds: Iterable<string>): Pick<WhatsAppState, 'pending' | 'swapped'> {
  let pending = state.pending
  for (const chatId of chatIds) pending = settlePending(pending, chatId, messages[chatId])
  if (pending === state.pending) return { pending, swapped: state.swapped }
  const swapped = { ...state.swapped }
  for (const id of settledIds(state.pending, pending)) swapped[id] = true
  return { pending, swapped }
}

export const useWhatsApp = create<WhatsAppState>()((set, get) => ({
  status: null,
  loadFailed: false,
  chats: null,
  messages: {},
  exhausted: {},
  photos: {},
  pending: {},
  swapped: {},
  restore: {},
  typing: {},

  receivePresence: (presence) => {
    set((state) => ({ typing: applyPresence(pruneTyping(state.typing, Date.now()), presence, Date.now()) }))
    // Um só relógio: vence o aviso mais próximo e se arma de novo para o seguinte.
    const arm = (): void => {
      if (typingTimer) clearTimeout(typingTimer)
      typingTimer = null
      const entries = Object.values(get().typing)
      if (!entries.length) return
      const next = Math.min(...entries.map((entry) => entry.until))
      typingTimer = setTimeout(
        () => {
          set((state) => ({ typing: pruneTyping(state.typing, Date.now()) }))
          arm()
        },
        Math.max(0, next - Date.now()) + 50,
      )
    }
    arm()
  },

  setReactions: (chatId, messageId, reactions) =>
    set((state) => {
      const current = state.messages[chatId]
      const next = withReactions(current, messageId, reactions)
      if (!next || next === current) return {}
      return { messages: { ...state.messages, [chatId]: next } }
    }),

  startPending: (chatId, text) => {
    const key = `pendente-${++pendingCount}`
    set((state) => ({ pending: addPending(state.pending, { key, chatId, text, at: Date.now() }) }))
    return key
  },

  confirmPending: (chatId, key, id) => {
    set((state) => {
      const pending = confirmPending(state.pending, chatId, key, id, undefined)
      if (pending === state.pending) return {}
      // O eco chegou antes da resposta do envio: a mensagem real já está na conversa e o temporário sai agora.
      return settleChats({ pending, swapped: state.swapped }, state.messages, [chatId])
    })
    // Sem o eco em 10 s, o temporário para de brilhar e diz "Enviada" (o texto oficial vem com o eco).
    setTimeout(() => set((state) => ({ pending: markPendingSent(state.pending, chatId, key) })), PENDING_ECHO_WAIT_MS)
  },

  failPending: (chatId, key, error) =>
    set((state) => {
      const { pending, failed } = failPending(state.pending, chatId, key)
      if (!failed) return {}
      const before = state.restore[chatId]?.text
      // Duas falhas antes de o campo pegar o texto: nenhuma se perde.
      return { pending, restore: { ...state.restore, [chatId]: { text: before ? `${before}\n${failed.text}` : failed.text, error } } }
    }),

  takeRestore: (chatId) => {
    const found = get().restore[chatId] ?? null
    if (found)
      set((state) => ({ restore: Object.fromEntries(Object.entries(state.restore).filter(([id]) => id !== chatId)) }))
    return found
  },

  load: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:whatsapp-status'), loadFailed: false })
    } catch {
      set({ loadFailed: true })
    }
  },

  loadChats: async () => {
    try {
      set({ chats: await window.__scribeApi.invoke('scribe:whatsapp-chats') })
    } catch {
      // Bloqueado ou o serviço caiu: a lista fica como estava.
    }
  },

  open: async (chatId, attempt = 0) => {
    try {
      const messages = await window.__scribeApi.invoke('scribe:whatsapp-messages', { chatId })
      set((state) => {
        const all = { ...state.messages, [chatId]: merge(state.messages[chatId] ?? [], messages) }
        return {
          messages: all,
          exhausted: { ...state.exhausted, [chatId]: messages.length < 50 },
          // Abrir zera as não lidas (só no app; nenhum recibo vai ao WhatsApp).
          chats: state.chats?.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)) ?? null,
          ...settleChats(state, all, [chatId]),
        }
      })
    } catch {
      // O serviço estava ocupado (histórico chegando): tenta de novo algumas vezes; depois mostra a conversa vazia
      // em vez de ficar carregando para sempre.
      if (attempt < 3) setTimeout(() => void get().open(chatId, attempt + 1), 2000 * (attempt + 1))
      else set((state) => (state.messages[chatId] ? {} : { messages: { ...state.messages, [chatId]: [] } }))
    }
  },

  loadOlder: async (chatId) => {
    const current = get().messages[chatId]
    const oldest = current?.[0]
    if (!oldest || get().exhausted[chatId]) return
    try {
      const older = await window.__scribeApi.invoke('scribe:whatsapp-messages', { chatId, before: oldest.at, beforeId: oldest.id })
      set((state) => ({
        messages: { ...state.messages, [chatId]: merge(state.messages[chatId] ?? [], older) },
        exhausted: { ...state.exhausted, [chatId]: older.length < 50 },
      }))
    } catch {
      // Nada a fazer.
    }
  },

  receive: (message, chatName) => get().receiveMany([{ message, chatName }]),

  forgetPhotos: () => {
    photoQueue.length = 0
    photoAsked.clear()
    set({ photos: {} })
  },

  requestPhoto: (chatId, again = false) => {
    const known = get().photos[chatId]
    if (again && known === null && !photoQueue.includes(chatId) && !photoRunningIds.has(chatId)) photoAsked.delete(chatId)
    if (photoAsked.has(chatId) || (known !== undefined && !(again && known === null))) return
    photoAsked.add(chatId)
    photoQueue.push(chatId)
    const next = (): void => {
      while (photoRunning < PHOTO_PARALLEL && photoQueue.length) {
        const id = photoQueue.shift() as string
        photoRunning++
        photoRunningIds.add(id)
        void window.__scribeApi.invoke('scribe:whatsapp-photo', { chatId: id }).then(
          (photo) => set((state) => ({ photos: { ...state.photos, [id]: photo } })),
          // Bloqueado ou o serviço caiu: pede de novo da próxima vez que a conversa aparecer.
          () => photoAsked.delete(id),
        ).finally(() => {
          photoRunning--
          photoRunningIds.delete(id)
          next()
        })
      }
    }
    next()
  },

  receiveMany: (items) =>
    set((state) => {
      let chats = state.chats ? [...state.chats] : null
      const messages = { ...state.messages }
      const byChat = new Map<string, WhatsAppMessage[]>()
      for (const { message, chatName } of items) {
        if (chats) {
          const index = chats.findIndex((chat) => chat.id === message.chatId)
          const chat = chats[index]
          if (chat) {
            chats[index] = { ...chat, name: chat.name === chat.id.split('@')[0] && chatName ? chatName : chat.name, lastMessage: message, unread: message.fromMe ? chat.unread : chat.unread + 1 }
          } else chats.push({ id: message.chatId, name: chatName, kind: message.chatId.endsWith('@g.us') ? 'group' : 'person', unread: message.fromMe ? 0 : 1, lastMessage: message })
        }
        if (messages[message.chatId]) byChat.set(message.chatId, [...(byChat.get(message.chatId) ?? []), message])
      }
      for (const [chatId, incoming] of byChat) messages[chatId] = merge(messages[chatId] ?? [], incoming)
      if (chats) chats = chats.sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0))
      // Contrato 34: a mensagem de alguém chegou: o "digitando…" daquela conversa sai.
      const typing = stopTyping(state.typing, items.filter(({ message }) => !message.fromMe).map(({ message }) => message.chatId))
      return { chats, messages, typing, ...settleChats(state, messages, byChat.keys()) }
    }),
}))

/** O main avisa cada mudança do serviço e cada mensagem nova; nada chega com o app bloqueado. */
export function watchWhatsApp(): () => void {
  const offState = window.__scribeApi.on('scribe:whatsapp-state', (status) => {
    // Contrato 32: fora de "conectado" (saiu da conta, removeu, desligou), as fotos guardadas na tela saem. Contrato 37:
    // e as mídias baixadas e as transcrições lidas nesta sessão.
    if (status.state !== 'connected') {
      useWhatsApp.getState().forgetPhotos()
      sessionBlobs.clear()
      sessionTranscripts.clear()
      useWhatsApp.setState({ typing: {} })
    }
    useWhatsApp.setState({ status })
  })
  // Mensagens chegam em rajadas (o celular manda muitas de uma vez): junta e atualiza a tela no máximo a cada 250 ms,
  // para a barra lateral e os cliques nunca ficarem presos atrás de milhares de atualizações.
  let pending: { message: WhatsAppMessage; chatName: string }[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const items = pending
    pending = []
    if (items.length) useWhatsApp.getState().receiveMany(items)
  }
  const offMessage = window.__scribeApi.on('scribe:whatsapp-message', (item) => {
    pending.push(item)
    timer ??= setTimeout(flush, 250)
  })
  const offChats = window.__scribeApi.on('scribe:whatsapp-chats-changed', () => {
    const state = useWhatsApp.getState()
    if (state.chats) void state.loadChats()
  })
  // Contrato 34: as reações e o "digitando…" chegam do serviço como dados (conferidos no main).
  const offReactions = window.__scribeApi.on('scribe:whatsapp-reactions', ({ chatId, messageId, reactions }) => useWhatsApp.getState().setReactions(chatId, messageId, reactions))
  const offPresence = window.__scribeApi.on('scribe:whatsapp-presence', (presence) => useWhatsApp.getState().receivePresence(presence))
  return () => {
    if (timer) clearTimeout(timer)
    offState()
    offMessage()
    offChats()
    offReactions()
    offPresence()
  }
}

/**
 * Estado do WhatsApp para a barra lateral e as telas: lido ao montar (atrás do bloqueio) e acompanhado pelos avisos
 * do main. Desbloquear manda o estado de novo.
 */
export function useWhatsAppSync(): void {
  useEffect(() => {
    void useWhatsApp.getState().load()
    return watchWhatsApp()
  }, [])
}
