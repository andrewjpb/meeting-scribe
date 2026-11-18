// WhatsApp no renderer (contrato 24): o estado do serviço local, as conversas e as mensagens da conversa aberta.
// Nada de token, porta ou caminho chega aqui. O envio passa por `__scribeApi.whatsappSend`, que só funciona no
// clique (ou ⌘↵) da pessoa: o preload confere a ativação do usuário e gera o token de clique.
//
// Contrato 32: as fotos de perfil, pedidas uma vez por conversa que aparece na tela, no máximo 3 ao mesmo tempo e
// sem segurar nada (a lista mostra as iniciais até a foto chegar).
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
}

/** Fotos pedidas ao mesmo tempo. */
const PHOTO_PARALLEL = 3
const photoQueue: string[] = []
const photoAsked = new Set<string>()
let photoRunning = 0
const photoRunningIds = new Set<string>()

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
  photos: {},

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
      set((state) => ({
        messages: { ...state.messages, [chatId]: merge(state.messages[chatId] ?? [], messages) },
        exhausted: { ...state.exhausted, [chatId]: messages.length < 50 },
        // Abrir zera as não lidas (só no app; nenhum recibo vai ao WhatsApp).
        chats: state.chats?.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)) ?? null,
      }))
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
      return { chats, messages }
    }),
}))

/** O main avisa cada mudança do serviço e cada mensagem nova; nada chega com o app bloqueado. */
export function watchWhatsApp(): () => void {
  const offState = window.__scribeApi.on('scribe:whatsapp-state', (status) => {
    // Contrato 32: fora de "conectado" (saiu da conta, removeu, desligou), as fotos guardadas na tela saem.
    if (status.state !== 'connected') useWhatsApp.getState().forgetPhotos()
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
  return () => {
    if (timer) clearTimeout(timer)
    offState()
    offMessage()
    offChats()
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
