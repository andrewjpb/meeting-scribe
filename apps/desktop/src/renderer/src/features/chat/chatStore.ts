// Chat "Perguntar" no renderer (contrato 15): as conversas abertas, as listas e a resposta que está sendo
// escrita. A conversa mora no main; aqui fica a cópia do que ele devolveu e o que chega por
// `scribe:chat-event`. O store continua vivo fora da tela: a resposta que termina enquanto a pessoa está em
// outra tela já aparece pronta quando ela volta.
import { create } from 'zustand'
import type { Chat, ChatListItem, ChatProgress } from '@shared/chat'

/** Chave da lista: `all` na tela "Perguntar", o id da reunião na aba do detalhe. */
export const listKey = (meetingId: string | null): string => meetingId ?? 'all'
/** Chave da conversa na tela: o id, ou `new:<lista>` antes de ela existir. */
export const viewKey = (chatId: string | null, meetingId: string | null): string => chatId ?? `new:${listKey(meetingId)}`

export type ClaudePresence = 'checking' | 'found' | 'not-found'

interface ChatState {
  claude: ClaudePresence
  lists: Record<string, ChatListItem[]>
  chats: Record<string, Chat>
  /** Resposta em curso de cada conversa. */
  answers: Record<string, ChatProgress>
  /** Pergunta indo ao main (ainda sem resposta do `chat-send`), por `viewKey`. */
  sending: Record<string, string>
  /** Conversa escolhida na tela "Perguntar" e em cada aba de reunião (`null` = nova conversa). */
  selected: Record<string, string | null>
  /** Falha de envio ou de leitura, por `viewKey`. */
  failures: Record<string, string>
  checkClaude: () => Promise<void>
  loadList: (meetingId: string | null) => Promise<void>
  open: (id: string) => Promise<void>
  select: (meetingId: string | null, id: string | null) => void
  /** Manda a pergunta; devolve o id da conversa (nova ou a mesma) ou `null` se nada foi enviado. */
  send: (chatId: string | null, meetingId: string | null, text: string) => Promise<string | null>
  stop: (id: string) => Promise<void>
  remove: (id: string, meetingId: string | null) => Promise<void>
}

let listening = false

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))

/** Uma vez só: as respostas chegam a qualquer tela. */
function listen(): void {
  if (listening) return
  listening = true
  window.__scribeApi.on('scribe:chat-event', (event) => {
    if (event.type === 'answer') {
      useChat.setState((state) => ({ answers: { ...state.answers, [event.chatId]: { text: event.text, reading: event.reading } } }))
      return
    }
    useChat.setState((state) => {
      const answers = without(state.answers, event.chatId)
      const key = listKey(event.chat.meetingId)
      const list = state.lists[key]
      const item: ChatListItem = {
        id: event.chat.id,
        meetingId: event.chat.meetingId,
        title: event.chat.title,
        createdAt: event.chat.createdAt,
        updatedAt: event.chat.messages.at(-1)?.at ?? event.chat.createdAt,
      }
      return {
        answers,
        chats: { ...state.chats, [event.chatId]: event.chat },
        lists: list ? { ...state.lists, [key]: [item, ...list.filter((entry) => entry.id !== item.id)] } : state.lists,
      }
    })
  })
}

export const useChat = create<ChatState>()((set, get) => ({
  claude: 'checking',
  lists: {},
  chats: {},
  answers: {},
  sending: {},
  selected: {},
  failures: {},

  checkClaude: async () => {
    listen()
    try {
      const found = await window.__scribeApi.invoke('scribe:claude-locate')
      set({ claude: found.ok ? 'found' : 'not-found' })
    } catch {
      set({ claude: 'not-found' })
    }
  },

  loadList: async (meetingId) => {
    listen()
    const key = listKey(meetingId)
    try {
      const list = await window.__scribeApi.invoke('scribe:chat-list', { meetingId })
      set((state) => ({ lists: { ...state.lists, [key]: list }, failures: without(state.failures, `list:${key}`) }))
    } catch {
      set((state) => ({ lists: { ...state.lists, [key]: state.lists[key] ?? [] }, failures: { ...state.failures, [`list:${key}`]: 'Não foi possível abrir as conversas.' } }))
    }
  },

  open: async (id) => {
    listen()
    try {
      const chat = await window.__scribeApi.invoke('scribe:chat-get', { id })
      if (chat) set((state) => ({ chats: { ...state.chats, [id]: chat }, failures: without(state.failures, id) }))
      else set((state) => ({ failures: { ...state.failures, [id]: 'Esta conversa não existe mais.' } }))
    } catch {
      set((state) => ({ failures: { ...state.failures, [id]: 'Não foi possível abrir a conversa.' } }))
    }
  },

  select: (meetingId, id) => set((state) => ({ selected: { ...state.selected, [listKey(meetingId)]: id } })),

  send: async (chatId, meetingId, text) => {
    listen()
    const key = viewKey(chatId, meetingId)
    if (get().sending[key] !== undefined) return null
    // Conversa escolhida na hora do envio: se a pessoa trocar enquanto a pergunta vai, a troca dela vale.
    const selectedBefore = get().selected[listKey(meetingId)]
    set((state) => ({ sending: { ...state.sending, [key]: text }, failures: without(state.failures, key) }))
    try {
      const result = await window.__scribeApi.invoke('scribe:chat-send', { chatId, meetingId, text })
      if (!result.ok) {
        if (result.error === 'not-found') set({ claude: 'not-found' })
        const reason = result.error === 'busy' ? 'Espere a resposta terminar.' : result.error === 'missing' ? 'Esta conversa não existe mais.' : 'Configure o Claude CLI em Configurações.'
        set((state) => ({ failures: { ...state.failures, [key]: reason } }))
        return null
      }
      const { chat } = result
      set((state) => {
        // A resposta pode ter terminado antes desta volta (`done` com mais mensagens): ela vale.
        const newer = (state.chats[chat.id]?.messages.length ?? 0) > chat.messages.length
        const listName = listKey(chat.meetingId)
        const list = state.lists[listName] ?? []
        const item: ChatListItem = { id: chat.id, meetingId: chat.meetingId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.messages.at(-1)?.at ?? chat.createdAt }
        return {
          claude: 'found',
          chats: newer ? state.chats : { ...state.chats, [chat.id]: chat },
          answers: newer || state.answers[chat.id] ? state.answers : { ...state.answers, [chat.id]: { text: '', reading: false } },
          lists: { ...state.lists, [listName]: [item, ...list.filter((entry) => entry.id !== chat.id)] },
          selected: state.selected[listName] === selectedBefore ? { ...state.selected, [listName]: chat.id } : state.selected,
        }
      })
      return chat.id
    } catch {
      set((state) => ({ failures: { ...state.failures, [key]: 'Não foi possível enviar a pergunta.' } }))
      return null
    } finally {
      set((state) => ({ sending: without(state.sending, key) }))
    }
  },

  stop: async (id) => {
    try {
      await window.__scribeApi.invoke('scribe:chat-stop', { id })
    } catch {
      // O processo morre de qualquer jeito ao fechar a conversa ou sair do app.
    }
  },

  remove: async (id, meetingId) => {
    try {
      await window.__scribeApi.invoke('scribe:chat-delete', { id })
    } catch {
      set((state) => ({ failures: { ...state.failures, [`list:${listKey(meetingId)}`]: 'Não foi possível excluir a conversa.' } }))
      return
    }
    set((state) => {
      const key = listKey(meetingId)
      return {
        chats: without(state.chats, id),
        answers: without(state.answers, id),
        lists: { ...state.lists, [key]: (state.lists[key] ?? []).filter((item) => item.id !== id) },
        selected: state.selected[key] === id ? { ...state.selected, [key]: null } : state.selected,
      }
    })
  },
}))
