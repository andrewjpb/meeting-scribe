// Chat do "Assistente" no renderer (contratos 15 e 25): as conversas abertas, as listas e a resposta que está sendo
// escrita. A conversa mora no main; aqui fica a cópia do que ele devolveu e o que chega por
// `scribe:chat-event`. O store continua vivo fora da tela: a resposta que termina enquanto a pessoa está em
// outra tela já aparece pronta quando ela volta.
//
// Contrato 16: a resposta em curso traz também o raciocínio, os passos, as negações e os detalhes; a
// conversa nova guarda o escopo e o modelo escolhidos na barra do campo até a primeira pergunta; "Refazer",
// renomear, trocar escopo ou modelo e "Copiar" passam pelo main.
//
// Contrato 17: pelo ACP o mesmo passo volta com estado novo (troca no lugar, pelo id), o "Plano" chega
// inteiro a cada mudança e a conversa guarda "Pensar mais".
//
// Contrato 25: os cartões de ação da resposta ("Criar lembrete", "Descartar", "Enviada") passam pelo main, que
// devolve a conversa gravada com o estado novo do cartão.
//
// Contrato 21: os cartões de aprovação das ferramentas MCP ficam com a resposta em curso (nunca gravados); a escolha vai
// ao main, que avisa quando o cartão sai.
//
// Contrato 78: "Pôr na agenda" no cartão de evento e "Salvar"/"Apagar lembrete" nos cartões de lembrete, também pelo main.
import { create } from 'zustand'
import type { ChatActionEventFields, ChatActionOportunidadeCampos, ChatActionRef, ChatActionResult, ChatActionStateRequest, ChatActionTarefaCampos } from '@shared/assistant'
import {
  DEFAULT_CHAT_SCOPE,
  type Chat,
  type ChatListItem,
  type ChatMeta,
  type ChatPlanEntry,
  type ChatProgress,
  type ChatScope,
  type ChatSendResult,
  type ChatStep,
} from '@shared/chat'
import type { McpApproval, McpApprovalDecision } from '@shared/mcp'
import type { ChatModel } from '@shared/settings-defaults'
import { rereadWhenUnlocked } from '../../app/lockStore'

/** Chave da lista: `all` na tela "Assistente", o id da reunião na aba do detalhe. */
export const listKey = (meetingId: string | null): string => meetingId ?? 'all'
/** Chave da conversa na tela: o id, ou `new:<lista>` antes de ela existir. */
export const viewKey = (chatId: string | null, meetingId: string | null): string => chatId ?? `new:${listKey(meetingId)}`

export type ClaudePresence = 'checking' | 'found' | 'not-found'

/** Resposta em curso: o texto, se está lendo, e o que veio junto (contrato 16). */
export interface LiveAnswer extends ChatProgress {
  thinking: string
  steps: ChatStep[]
  denied: number
  /** "Plano" do agente (ACP). */
  plan: ChatPlanEntry[]
  meta: ChatMeta | null
  /** Contrato 21: cartões de aprovação de ferramentas MCP esperando a pessoa. */
  approvals: McpApproval[]
}

export const emptyAnswer = (): LiveAnswer => ({ text: '', reading: false, thinking: '', steps: [], denied: 0, plan: [], meta: null, approvals: [] })

/** Passo novo no fim; o mesmo passo (mesmo id, pelo ACP) troca no lugar. */
export function upsertStep(steps: readonly ChatStep[], step: ChatStep): ChatStep[] {
  const at = step.id ? steps.findIndex((entry) => entry.id === step.id) : -1
  return at === -1 ? [...steps, step] : steps.map((entry, index) => (index === at ? step : entry))
}

/** Escopo, modelo e "Pensar mais" de uma conversa que ainda não existe. */
export interface ChatDraft {
  scope: ChatScope
  model: ChatModel | null
  thinkMore: boolean
}

interface ChatState {
  claude: ClaudePresence
  /** "Modelo do chat" das Configurações: o da conversa nova até a pessoa trocar. */
  defaultModel: ChatModel
  lists: Record<string, ChatListItem[]>
  chats: Record<string, Chat>
  /** Resposta em curso de cada conversa. */
  answers: Record<string, LiveAnswer>
  /** Escopo e modelo da conversa nova, por lista. */
  drafts: Record<string, ChatDraft>
  /** Pergunta indo ao main (ainda sem resposta do `chat-send`), por `viewKey`. */
  sending: Record<string, string>
  /** "Refazer" indo ao main: a tela tira a resposta antiga até a conversa nova voltar. */
  redoing: Record<string, true>
  /** Conversa escolhida na tela "Assistente" e em cada aba de reunião (`null` = nova conversa). */
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
  /** Escopo ou modelo da conversa nova (antes da primeira pergunta). */
  setDraft: (meetingId: string | null, patch: Partial<ChatDraft>) => void
  /** Renomear, trocar escopo ou modelo; devolve se gravou. */
  update: (id: string, patch: { title?: string; scope?: ChatScope; model?: ChatModel; thinkMore?: boolean }) => Promise<boolean>
  /** "Refazer", "Tentar de novo" e ↑ (com o texto novo). */
  redo: (id: string, text?: string) => Promise<boolean>
  /** "Copiar" a mensagem `index` da conversa. */
  copy: (id: string, index: number) => Promise<boolean>
  /** Contrato 25: "Criar lembrete" num cartão (com a data e o texto do "Editar", quando mudaram). */
  createReminder: (ref: ChatActionRef, edit?: { at?: string; text?: string }) => Promise<ChatActionResult>
  /** Contrato 25: "Descartar", "Enviada" (depois do envio do WhatsApp) e "Agendamento criado". */
  setActionState: (ref: ChatActionRef, state: ChatActionStateRequest['state'], text?: string) => Promise<ChatActionResult>
  /** Contrato 78: "Pôr na agenda" (e "Tentar de novo"), na agenda escolhida e com o que o "Editar" mudou. */
  createEvent: (ref: ChatActionRef, calendarId: string, fields?: ChatActionEventFields) => Promise<ChatActionResult>
  /** Contrato 78: "Salvar" (`update`, com a hora e o texto do "Editar") ou "Apagar lembrete" (`delete`). */
  changeReminder: (ref: ChatActionRef, op: 'update' | 'delete', edit?: { at?: string; text?: string }) => Promise<ChatActionResult>
  /** Contrato 76: "Criar rascunho" no cartão do Instagram, com a legenda e a data do "Editar" (`at: null` tira a data). */
  createInstagramDraft: (ref: ChatActionRef, edit?: { caption?: string; at?: string | null }) => Promise<ChatActionResult>
  /** Contrato 117: "Mover", "Criar" e "Salvar" num cartão do funil (`campos`: o que o cartão de criar oportunidade mudou). */
  funilAction: (ref: ChatActionRef, campos?: ChatActionOportunidadeCampos) => Promise<ChatActionResult>
  /** Contrato 127: "Criar", "Concluir" e "Adiar" num cartão das tarefas (`campos`: o que o cartão de criar tarefa mudou). */
  tarefaAction: (ref: ChatActionRef, campos?: ChatActionTarefaCampos) => Promise<ChatActionResult>
  /** Contrato 163: "Criar agente", "Salvar", "Pausar", "Retomar" e "Aplicar" num cartão da triagem do WhatsApp. */
  triagemAction: (ref: ChatActionRef) => Promise<ChatActionResult>
  /** Contrato 21: "Permitir uma vez", "Sempre permitir esta ferramenta" ou "Negar" num cartão de aprovação. */
  answerApproval: (chatId: string, id: string, decision: McpApprovalDecision) => Promise<boolean>
}

let listening = false

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))

const itemOf = (chat: Chat): ChatListItem => ({ id: chat.id, meetingId: chat.meetingId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.messages.at(-1)?.at ?? chat.createdAt })

/** O rascunho de uma lista, com os padrões. */
export function draftOf(state: Pick<ChatState, 'drafts'>, meetingId: string | null): ChatDraft {
  return state.drafts[listKey(meetingId)] ?? { scope: DEFAULT_CHAT_SCOPE, model: null, thinkMore: false }
}

/** Uma vez só: as respostas chegam a qualquer tela. */
function listen(): void {
  if (listening) return
  listening = true
  window.__scribeApi.on('scribe:chat-event', (event) => {
    if (event.type !== 'done') {
      useChat.setState((state) => {
        const current = state.answers[event.chatId] ?? emptyAnswer()
        let next: LiveAnswer
        if (event.type === 'answer') next = { ...current, text: event.text, reading: event.reading }
        else if (event.type === 'thinking') next = { ...current, thinking: current.thinking + event.delta }
        else if (event.type === 'step') next = { ...current, steps: upsertStep(current.steps, event.step) }
        else if (event.type === 'plan') next = { ...current, plan: event.entries }
        else if (event.type === 'denied') next = { ...current, denied: event.count }
        else if (event.type === 'approval') next = { ...current, approvals: [...current.approvals.filter((entry) => entry.id !== event.approval.id), event.approval] }
        else if (event.type === 'approval-done') next = { ...current, approvals: current.approvals.filter((entry) => entry.id !== event.id) }
        else next = { ...current, meta: event.meta }
        return { answers: { ...state.answers, [event.chatId]: next } }
      })
      return
    }
    useChat.setState((state) => {
      const answers = without(state.answers, event.chatId)
      const key = listKey(event.chat.meetingId)
      const list = state.lists[key]
      const item = itemOf(event.chat)
      return {
        answers,
        chats: { ...state.chats, [event.chatId]: event.chat },
        lists: list ? { ...state.lists, [key]: [item, ...list.filter((entry) => entry.id !== item.id)] } : state.lists,
      }
    })
  })
}

export const useChat = create<ChatState>()((set, get) => {
  /** Volta do `chat-send` ou do `chat-redo`: a conversa gravada e a resposta marcada como em curso. */
  const accept = (result: ChatSendResult, key: string, meetingId: string | null, selectedBefore: string | null | undefined): string | null => {
    if (!result.ok) {
      if (result.error === 'not-found') set({ claude: 'not-found' })
      const reason = result.error === 'busy' ? 'Espere a resposta terminar.' : result.error === 'missing' ? 'Esta conversa não existe mais.' : 'Configure o Claude CLI em Configurações.'
      set((state) => ({ failures: { ...state.failures, [key]: reason } }))
      return null
    }
    const { chat } = result
    set((state) => {
      // A resposta pode ter terminado antes desta volta (`done` com mais mensagens e mais nova): ela vale. No
      // "Refazer", a conversa da tela tem mais mensagens, mas mais antigas: a que voltou vale.
      const shown = state.chats[chat.id]
      const newer =
        (shown?.messages.length ?? 0) > chat.messages.length && Date.parse(shown?.messages.at(-1)?.at ?? '') >= Date.parse(chat.messages.at(-1)?.at ?? '')
      const listName = listKey(chat.meetingId ?? meetingId)
      const list = state.lists[listName] ?? []
      return {
        claude: 'found',
        chats: newer ? state.chats : { ...state.chats, [chat.id]: chat },
        answers: newer || state.answers[chat.id] ? state.answers : { ...state.answers, [chat.id]: emptyAnswer() },
        lists: { ...state.lists, [listName]: [itemOf(chat), ...list.filter((entry) => entry.id !== chat.id)] },
        selected: state.selected[listName] === selectedBefore ? { ...state.selected, [listName]: chat.id } : state.selected,
        // A conversa nova levou o rascunho; a próxima começa do padrão.
        drafts: selectedBefore === null || selectedBefore === undefined ? without(state.drafts, listName) : state.drafts,
      }
    })
    return chat.id
  }

  /** A conversa que o main gravou com o estado novo de um cartão. */
  const keepChat = (chat: Chat): void => set((state) => ({ chats: { ...state.chats, [chat.id]: chat } }))

  return {
    claude: 'checking',
    defaultModel: 'sonnet',
    lists: {},
    chats: {},
    answers: {},
    drafts: {},
    sending: {},
    redoing: {},
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
      try {
        const settings = await window.__scribeApi.invoke('scribe:settings-get')
        if (settings?.chatModel) set({ defaultModel: settings.chatModel })
      } catch {
        // Fica o padrão das Configurações.
      }
    },

    loadList: async (meetingId) => {
      listen()
      const key = listKey(meetingId)
      try {
        const list = await window.__scribeApi.invoke('scribe:chat-list', { meetingId })
        set((state) => ({ lists: { ...state.lists, [key]: list }, failures: without(state.failures, `list:${key}`) }))
      } catch (error) {
        // Recusada com o app bloqueado (contrato 22): relê no desbloqueio, sem aviso.
        if (rereadWhenUnlocked(error, () => void get().loadList(meetingId))) return
        set((state) => ({ lists: { ...state.lists, [key]: state.lists[key] ?? [] }, failures: { ...state.failures, [`list:${key}`]: 'Não foi possível abrir as conversas.' } }))
      }
    },

    open: async (id) => {
      listen()
      try {
        const chat = await window.__scribeApi.invoke('scribe:chat-get', { id })
        if (chat) set((state) => ({ chats: { ...state.chats, [id]: chat }, failures: without(state.failures, id) }))
        else set((state) => ({ failures: { ...state.failures, [id]: 'Esta conversa não existe mais.' } }))
      } catch (error) {
        if (rereadWhenUnlocked(error, () => void get().open(id))) return
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
        // A conversa nova leva o escopo e o modelo da barra do campo.
        const draft = draftOf(get(), meetingId)
        // Contrato 21: a conversa de uma reunião leva do escopo só os servidores MCP desligados nela.
        const meetingScope = draft.scope.mcpOff?.length ? { scope: { kind: 'all' as const, mcpOff: draft.scope.mcpOff } } : {}
        const extra = chatId
          ? {}
          : { ...(meetingId ? meetingScope : { scope: draft.scope }), ...(draft.model ? { model: draft.model } : {}), ...(draft.thinkMore ? { thinkMore: true } : {}) }
        const result = await window.__scribeApi.invoke('scribe:chat-send', { chatId, meetingId, text, ...extra })
        return accept(result, key, meetingId, chatId ? chatId : selectedBefore)
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

    setDraft: (meetingId, patch) =>
      set((state) => {
        const key = listKey(meetingId)
        return { drafts: { ...state.drafts, [key]: { ...draftOf(state, meetingId), ...patch } } }
      }),

    update: async (id, patch) => {
      try {
        const chat = await window.__scribeApi.invoke('scribe:chat-update', { id, ...patch })
        if (!chat) return false
        set((state) => {
          const key = listKey(chat.meetingId)
          const list = state.lists[key]
          return {
            // As mensagens que a tela já tem valem (a resposta pode estar chegando).
            chats: { ...state.chats, [id]: { ...chat, messages: state.chats[id]?.messages ?? chat.messages } },
            lists: list ? { ...state.lists, [key]: list.map((item) => (item.id === id ? { ...item, title: chat.title } : item)) } : state.lists,
          }
        })
        return true
      } catch {
        set((state) => ({ failures: { ...state.failures, [id]: 'Não foi possível gravar a mudança.' } }))
        return false
      }
    },

    redo: async (id, text) => {
      listen()
      if (get().sending[id] !== undefined || get().answers[id]) return false
      const meetingId = get().chats[id]?.meetingId ?? null
      set((state) => ({ sending: { ...state.sending, [id]: text ?? '' }, redoing: { ...state.redoing, [id]: true }, failures: without(state.failures, id) }))
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-redo', text === undefined ? { id } : { id, text })
        return accept(result, id, meetingId, id) !== null
      } catch {
        set((state) => ({ failures: { ...state.failures, [id]: 'Não foi possível refazer a resposta.' } }))
        return false
      } finally {
        set((state) => ({ sending: without(state.sending, id), redoing: without(state.redoing, id) }))
      }
    },

    copy: async (id, index) => {
      try {
        return await window.__scribeApi.invoke('scribe:chat-copy', { id, index })
      } catch {
        return false
      }
    },

    createReminder: async (ref, edit = {}) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-reminder', { ...ref, ...(edit.at ? { at: edit.at } : {}), ...(edit.text !== undefined ? { text: edit.text } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    answerApproval: async (chatId, id, decision) => {
      try {
        return await window.__scribeApi.invoke('scribe:chat-approval', { chatId, id, decision })
      } catch {
        return false
      }
    },

    setActionState: async (ref, state, text) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-state', { ...ref, state, ...(text !== undefined ? { text } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    createEvent: async (ref, calendarId, fields) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-event', { ...ref, calendarId, ...(fields ? { fields } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    changeReminder: async (ref, op, edit = {}) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-reminder-change', { ...ref, op, ...(edit.at ? { at: edit.at } : {}), ...(edit.text !== undefined ? { text: edit.text } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    createInstagramDraft: async (ref, edit = {}) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-instagram-draft', { ...ref, ...(edit.caption !== undefined ? { caption: edit.caption } : {}), ...(edit.at !== undefined ? { at: edit.at } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    funilAction: async (ref, campos) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-funil', { ...ref, ...(campos ? { campos } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    tarefaAction: async (ref, campos) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-tarefa', { ...ref, ...(campos ? { campos } : {}) })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },

    triagemAction: async (ref) => {
      try {
        const result = await window.__scribeApi.invoke('scribe:chat-action-triagem', { chatId: ref.chatId, index: ref.index, actionId: ref.actionId })
        if (result.ok) keepChat(result.chat)
        return result
      } catch {
        return { ok: false, error: 'invalid' }
      }
    },
  }
})

/**
 * Contrato 67: abre a conversa `id` (ou a nova, `null`) na tela "Assistente", pela lista do sidebar ou pela tela. A que
 * estava aberta fecha: o processo dela morre (depois da resposta em curso).
 */
export function openChat(id: string | null): void {
  const key = listKey(null)
  const selected = useChat.getState().selected[key] ?? null
  if (id === selected) return
  if (selected) window.__scribeApi.send('scribe:chat-close', { id: selected })
  useChat.getState().select(null, id)
}
