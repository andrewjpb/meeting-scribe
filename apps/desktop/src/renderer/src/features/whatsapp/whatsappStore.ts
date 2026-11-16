// WhatsApp no renderer (contrato 24): o estado do serviço local, as conversas e as mensagens da conversa aberta.
// Nada de token, porta ou caminho chega aqui. O envio passa por `__scribeApi.whatsappSend`, que só funciona no
// clique (ou ⌘↵) da pessoa: o preload confere a ativação do usuário e gera o token de clique.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { WhatsAppChat, WhatsAppMessage, WhatsAppStatus } from '@shared/whatsapp'

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
  open: (chatId: string) => Promise<void>
  loadOlder: (chatId: string) => Promise<void>
  receive: (message: WhatsAppMessage, chatName: string) => void
}

const byTime = (a: WhatsAppMessage, b: WhatsAppMessage): number => a.at - b.at || a.id.localeCompare(b.id)

function merge(current: readonly WhatsAppMessage[], incoming: readonly WhatsAppMessage[]): WhatsAppMessage[] {
  const seen = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) seen.set(message.id, message)
  return [...seen.values()].sort(byTime)
}

export const useWhatsApp = create<WhatsAppState>()((set, get) => ({
  status: null,
  loadFailed: false,
  chats: null,
  messages: {},
  exhausted: {},

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

  open: async (chatId) => {
    try {
      const messages = await window.__scribeApi.invoke('scribe:whatsapp-messages', { chatId })
      set((state) => ({
        messages: { ...state.messages, [chatId]: merge(state.messages[chatId] ?? [], messages) },
        exhausted: { ...state.exhausted, [chatId]: messages.length < 50 },
        // Abrir zera as não lidas (só no app; nenhum recibo vai ao WhatsApp).
        chats: state.chats?.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)) ?? null,
      }))
    } catch {
      // Nada a fazer.
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

  receive: (message, chatName) =>
    set((state) => {
      const known = state.chats?.some((chat) => chat.id === message.chatId) ?? false
      const chats = state.chats
        ? (known
            ? state.chats.map((chat) => (chat.id === message.chatId ? { ...chat, lastMessage: message, unread: message.fromMe ? chat.unread : chat.unread + 1 } : chat))
            : [{ id: message.chatId, name: chatName, kind: message.chatId.endsWith('@g.us') ? ('group' as const) : ('person' as const), unread: message.fromMe ? 0 : 1, lastMessage: message }, ...state.chats]
          ).sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0))
        : null
      const loaded = state.messages[message.chatId]
      return { chats, messages: loaded ? { ...state.messages, [message.chatId]: merge(loaded, [message]) } : state.messages }
    }),
}))

/** O main avisa cada mudança do serviço e cada mensagem nova; nada chega com o app bloqueado. */
export function watchWhatsApp(): () => void {
  const offState = window.__scribeApi.on('scribe:whatsapp-state', (status) => useWhatsApp.setState({ status }))
  const offMessage = window.__scribeApi.on('scribe:whatsapp-message', ({ message, chatName }) => useWhatsApp.getState().receive(message, chatName))
  return () => {
    offState()
    offMessage()
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
