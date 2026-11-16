// O que a tela "Perguntar" e a aba "Perguntar" do detalhe pedem ao main (contrato 15, CA2 a CA7). Uma
// conversa tem no máximo um processo do `claude`, aberto na primeira pergunta e mantido entre as perguntas.
// Fechar a conversa mata o processo (depois da resposta em curso); sair da tela mata em 5 min; sair do app
// mata na hora. A pergunta é gravada antes de ir ao processo; a resposta, quando termina (inteira, parada ou
// com erro). Sem o `claude`, nada é gravado nem enviado. Sem Electron: `claude`, relógio e eventos chegam
// injetados.
//
// Contrato 16: o raciocínio, os passos, as negações e os detalhes da resposta vão à tela enquanto chegam e
// ficam gravados com ela. A conversa da tela tem escopo (todas, 7 dias, 30 dias ou as escolhidas: as três
// últimas rodam numa pasta só com aquelas reuniões) e modelo; trocar um ou outro fecha o processo (depois da
// resposta em curso) e a próxima pergunta abre outro com o histórico. "Refazer" tira a última resposta e
// pergunta de novo num processo novo, só desta conversa.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CHAT_TEXT_MAX,
  CHAT_TITLE_MAX,
  chatTitle,
  type Chat,
  type ChatDetail,
  type ChatEvent,
  type ChatListItem,
  type ChatMessage,
  type ChatMeta,
  type ChatScope,
  type ChatSendResult,
  type ChatStep,
} from '../../shared/chat'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { CHAT_MODELS, type ChatModel } from '../../shared/settings-defaults'
import { ClaudeChat, type ChatAnswer } from '../claude-cli/chat'
import { claudeEnv } from '../claude-cli/locate'
import type { SpawnClaude, Timers } from '../claude-cli/translator'
import type { MeetingsStore } from '../meetings/store'
import type { SettingsStore } from '../settings/store'
import { scopeMeetingIds, type ChatCorpus } from './corpus'
import { chatIdSchema, chatScopeSchema, type ChatStore } from './store'

/** Fora da tela do chat por 5 min: o processo da conversa morre. */
export const CHAT_LEAVE_MS = 5 * 60_000

export interface ChatServiceDeps {
  store: ChatStore
  corpus: Pick<ChatCorpus, 'dir' | 'ensure' | 'scope' | 'scopeMany' | 'dropScope' | 'remove'>
  settings: Pick<SettingsStore, 'get'>
  meetings: Pick<MeetingsStore, 'get' | 'list'>
  /** "Copiar" de uma resposta (a área de transferência do main). */
  clipboard?: { writeText: (text: string) => void }
  /** O mesmo `locate` do tradutor e do resumo. */
  locate: () => Promise<ClaudeLocateResult>
  spawn: SpawnClaude
  baseEnv: NodeJS.ProcessEnv
  /** Resposta crescendo ou terminada, para todas as janelas. */
  onEvent: (event: ChatEvent) => void
  log?: (message: string) => void
  now?: () => number
  newId?: () => string
  timers?: Timers
  idleTimeoutMs?: number
  leaveMs?: number
}

export interface ChatService {
  /** Conversas da tela (`meetingId: null`) ou da aba de uma reunião. */
  list(request: unknown): Promise<ChatListItem[]>
  /** Abrir uma conversa cancela o fim marcado por `leave`. */
  get(id: unknown): Promise<Chat | null>
  /** Grava a pergunta e começa a responder; a resposta chega por `onEvent`. */
  send(request: unknown): Promise<ChatSendResult>
  /** Renomear, trocar o escopo ou o modelo; `null` se a conversa não existe. */
  update(request: unknown): Promise<Chat | null>
  /** "Refazer" / "Tentar de novo" / ↑ (com o texto novo): a última resposta sai e a pergunta vai de novo. */
  redo(request: unknown): Promise<ChatSendResult>
  /** "Copiar" uma resposta: o texto dela na área de transferência. */
  copy(request: unknown): Promise<boolean>
  /** "Parar": a resposta em curso termina como `stopped` e o processo morre. */
  stop(id: unknown): boolean
  /** Fechar a conversa (trocar de conversa, "Nova conversa"): o processo morre, depois da resposta em curso. */
  close(id: unknown): void
  /** Sair da tela: o processo morre em 5 min, se a conversa não for aberta de novo. */
  leave(id: unknown): void
  /** Janela principal fechada (o app segue aberto no macOS): `leave` em todas as conversas abertas. */
  leaveAll(): void
  /** Excluir a conversa: mata o processo e apaga o arquivo. */
  remove(id: unknown): Promise<boolean>
  /** Excluir a reunião: as conversas dela (com os processos) e o `.md` do acervo. */
  removeMeeting(meetingId: string): Promise<void>
  /** Teste: termina quando a resposta em curso daquela conversa for gravada. */
  settled(id: string): Promise<void>
  /** Processos vivos (teste e smoke). */
  sessions(): string[]
  /** Sair do app: mata todos os processos. */
  dispose(): void
}

const listSchema = z.object({ meetingId: z.string().min(1).max(200).nullable() }).strict()
const questionSchema = z
  .string()
  .max(CHAT_TEXT_MAX)
  .refine((value) => value.trim() !== '')
const sendSchema = z
  .object({
    chatId: chatIdSchema.nullable(),
    meetingId: z.string().min(1).max(200).nullable(),
    text: questionSchema,
    scope: chatScopeSchema.optional(),
    model: z.enum(CHAT_MODELS).optional(),
  })
  .strict()
const updateSchema = z
  .object({
    id: chatIdSchema,
    title: z
      .string()
      .max(CHAT_TITLE_MAX * 4)
      .refine((value) => value.trim() !== '')
      .optional(),
    scope: chatScopeSchema.optional(),
    model: z.enum(CHAT_MODELS).optional(),
  })
  .strict()
const redoSchema = z.object({ id: chatIdSchema, text: questionSchema.optional() }).strict()
const copySchema = z.object({ id: chatIdSchema, index: z.number().int().min(0).max(10_000) }).strict()

const sameScope = (a: ChatScope, b: ChatScope): boolean => a.kind === b.kind && (a.meetingIds ?? []).join(',') === (b.meetingIds ?? []).join(',')

interface Session {
  claude: ClaudeChat
  /** Pasta temporária da conversa de uma reunião, apagada quando o processo sai de uso. */
  scope: string | null
  leaveTimer: unknown
  /** Resposta em curso, gravada ao terminar. */
  answering: Promise<void> | null
  /** Fechada enquanto respondia: morre quando a resposta terminar. */
  closeAfter: boolean
  /** Conversa excluída: nada mais é gravado. */
  cancelled: boolean
  /** Modelo pedido ao processo (`--model`). */
  model: ChatModel
  /** Títulos das reuniões, para o rótulo "Abrindo «<título>»"; relidos a cada pergunta. */
  titles: Map<string, string>
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const timers = deps.timers ?? defaultTimers
  const leaveMs = deps.leaveMs ?? CHAT_LEAVE_MS
  const sessions = new Map<string, Session>()
  /** Conversas com pergunta em andamento antes de o processo existir (procura do `claude`, acervo). */
  const starting = new Set<string>()

  const stamp = (): string => new Date(now()).toISOString()
  const idOf = (input: unknown): string | null => {
    const parsed = chatIdSchema.safeParse(input)
    return parsed.success ? parsed.data : null
  }

  function end(id: string, session: Session): void {
    if (session.leaveTimer !== null) timers.clearTimeout(session.leaveTimer)
    session.leaveTimer = null
    session.claude.kill()
    if (sessions.get(id) === session) sessions.delete(id)
    if (session.scope) void deps.corpus.dropScope(id).catch(() => undefined)
  }

  function close(id: string): void {
    const session = sessions.get(id)
    if (!session) return
    if (session.answering) session.closeAfter = true
    else end(id, session)
  }

  function leave(id: string): void {
    const session = sessions.get(id)
    if (!session) return
    if (session.leaveTimer !== null) timers.clearTimeout(session.leaveTimer)
    session.leaveTimer = timers.setTimeout(() => {
      session.leaveTimer = null
      if (sessions.get(id) === session) close(id)
    }, leaveMs)
  }

  /** Processo morre agora, ou depois da resposta em curso: a próxima pergunta abre outro com o histórico. */
  function restart(id: string): void {
    const session = sessions.get(id)
    if (!session) return
    if (session.answering) session.closeAfter = true
    else end(id, session)
  }

  /** O modelo da conversa; a do contrato 15 (`null`) segue as Configurações. */
  async function modelOf(chat: Chat): Promise<ChatModel> {
    return chat.model ?? (await deps.settings.get()).chatModel
  }

  async function openSession(chat: Chat, binaryPath: string): Promise<Session | null> {
    const existing = sessions.get(chat.id)
    if (existing) return existing
    let cwd: string
    let scope: string | null = null
    let folder: 'all' | 'subset' | 'meeting' = 'all'
    if (chat.meetingId) {
      scope = await deps.corpus.scope(chat.meetingId, chat.id)
      if (!scope) return null
      cwd = scope
      folder = 'meeting'
    } else if (chat.scope.kind !== 'all') {
      // Só as reuniões do escopo, numa pasta da conversa com o índice delas.
      const ids = scopeMeetingIds(chat.scope, await deps.meetings.list(), now())
      scope = await deps.corpus.scopeMany(ids, chat.id)
      if (!scope) return null
      cwd = scope
      folder = 'subset'
    } else {
      await deps.corpus.ensure()
      cwd = deps.corpus.dir
    }
    const model = await modelOf(chat)
    const titles = new Map<string, string>()
    const session: Session = {
      claude: new ClaudeChat({
        binaryPath,
        model,
        scope: folder,
        cwd,
        titleOf: (meetingId) => titles.get(meetingId) ?? null,
        env: claudeEnv(deps.baseEnv, binaryPath),
        spawn: deps.spawn,
        ...(deps.timers ? { timers: deps.timers } : {}),
        ...(deps.idleTimeoutMs !== undefined ? { idleTimeoutMs: deps.idleTimeoutMs } : {}),
        ...(deps.log ? { log: deps.log } : {}),
      }),
      scope,
      leaveTimer: null,
      answering: null,
      closeAfter: false,
      cancelled: false,
      model,
      titles,
    }
    sessions.set(chat.id, session)
    return session
  }

  async function answer(chat: Chat, question: string, session: Session): Promise<void> {
    const history = chat.messages.slice(0, -1).map(({ role, text }) => ({ role, text }))
    // Títulos de agora (a reunião renomeada aparece com o nome novo no passo), sem atrasar a pergunta: até
    // chegarem, vale o título do nome do arquivo.
    void deps.meetings.list().then(
      (meetings) => {
        session.titles.clear()
        for (const meeting of meetings) session.titles.set(meeting.id, meeting.title)
      },
      () => undefined,
    )
    const steps: ChatStep[] = []
    let thinking = ''
    let denied = 0
    let meta: ChatMeta | null = null
    const onDetail = (detail: ChatDetail): void => {
      if (detail.type === 'step') steps.push(detail.step)
      else if (detail.type === 'thinking') thinking += detail.delta
      else if (detail.type === 'denied') denied = detail.count
      else meta = detail.meta
      if (!session.cancelled) deps.onEvent({ chatId: chat.id, ...detail })
    }
    const result: ChatAnswer = await session.claude.ask(
      question,
      history,
      (progress) => {
        if (!session.cancelled) deps.onEvent({ type: 'answer', chatId: chat.id, ...progress })
      },
      onDetail,
    )
    if (session.cancelled) return
    const message: ChatMessage = {
      role: 'assistant',
      text: result.text,
      at: stamp(),
      ...(result.ok ? {} : { error: result.error }),
      ...(steps.length ? { steps } : {}),
      ...(thinking ? { thinking } : {}),
      ...(denied ? { denied } : {}),
      ...(meta ? { meta } : {}),
      model: session.model,
    }
    // Lida e gravada na mesma vez da fila: o que outra janela ou um "Renomear" gravou no meio fica.
    const saved = await deps.store.mutate(chat.id, (current) => {
      const base = current ?? chat
      return { ...base, messages: [...base.messages, message] }
    })
    if (saved && !session.cancelled) deps.onEvent({ type: 'done', chatId: chat.id, chat: saved })
  }

  /** Pergunta gravada: começa a responder e marca a conversa ocupada até a resposta ser gravada. */
  function start(saved: Chat, question: string, session: Session): void {
    if (session.leaveTimer !== null) timers.clearTimeout(session.leaveTimer)
    session.leaveTimer = null
    session.closeAfter = false
    const run = answer(saved, question, session)
      .catch(() => undefined)
      .then(() => {
        session.answering = null
        if (session.closeAfter) end(saved.id, session)
      })
    session.answering = run
  }

  return {
    async list(request) {
      const { meetingId } = listSchema.parse(request)
      return (await deps.store.list()).filter((item) => item.meetingId === meetingId)
    },

    async get(input) {
      const id = idOf(input)
      if (!id) return null
      const session = sessions.get(id)
      if (session && session.leaveTimer !== null) {
        timers.clearTimeout(session.leaveTimer)
        session.leaveTimer = null
      }
      const chat = await deps.store.get(id)
      return chat ? { ...chat, model: await modelOf(chat) } : null
    },

    async send(request) {
      const { chatId, meetingId, text, scope, model } = sendSchema.parse(request)
      const question = text.trim()
      // Marcada antes do primeiro `await`: duas perguntas seguidas na mesma conversa nunca correm juntas.
      const id = chatId ?? newId()
      if (starting.has(id) || sessions.get(id)?.answering) return { ok: false, error: 'busy' }
      starting.add(id)
      try {
        let chat: Chat
        if (chatId) {
          const found = await deps.store.get(chatId)
          if (!found) return { ok: false, error: 'missing' }
          chat = found
        } else {
          // A conversa de uma reunião é sempre só dela: o escopo não vale ali.
          chat = { id, meetingId, title: chatTitle(question), createdAt: stamp(), messages: [], scope: { kind: 'all' }, model: null }
        }
        // Escopo e modelo da barra do campo; trocados, o processo da conversa é refeito.
        const nextScope = scope && !chat.meetingId ? scope : chat.scope
        const currentModel = await modelOf(chat)
        const nextModel = model ?? currentModel
        const changed = !sameScope(nextScope, chat.scope) || nextModel !== currentModel
        chat = { ...chat, scope: nextScope, model: nextModel }
        if (changed) restart(chat.id)
        // Sem o `claude`, nada é gravado nem enviado (CA7).
        const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
        if (!found.ok) return { ok: false, error: 'not-found' }
        // A reunião e a pasta do processo antes de gravar: reunião que sumiu não deixa pergunta gravada.
        if (chat.meetingId && !(await deps.meetings.get(chat.meetingId))) return { ok: false, error: 'missing' }
        const session = await openSession(chat, found.path)
        if (!session) return { ok: false, error: 'missing' }
        const asked: ChatMessage = { role: 'user', text: question, at: stamp() }
        const prepared = chat
        // Relida na fila: um título trocado entre a leitura de cima e aqui não se perde.
        const saved = await deps.store.mutate(id, (current) => {
          if (!current) return chatId ? null : { ...prepared, messages: [asked] }
          return { ...current, scope: prepared.scope, model: prepared.model, messages: [...current.messages, asked] }
        })
        if (!saved) {
          end(id, session)
          return { ok: false, error: 'missing' }
        }
        start(saved, question, session)
        return { ok: true, chat: saved }
      } finally {
        starting.delete(id)
      }
    },

    async update(request) {
      const { id, title, scope, model } = updateSchema.parse(request)
      if (starting.has(id)) return null
      const fallback = (await deps.settings.get()).chatModel
      let restartNeeded = false
      // Leitura, mudança e gravação na mesma vez da fila (a resposta que termina no meio fica).
      const saved = await deps.store.mutate(id, (chat) => {
        if (!chat) return null
        const nextScope = scope && !chat.meetingId ? scope : chat.scope
        restartNeeded = !sameScope(nextScope, chat.scope) || (model !== undefined && model !== (chat.model ?? fallback))
        return { ...chat, ...(title !== undefined ? { title: chatTitle(title) } : {}), scope: nextScope, model: model ?? chat.model }
      })
      if (!saved) return null
      if (restartNeeded) restart(id)
      return { ...saved, model: saved.model ?? fallback }
    },

    async redo(request) {
      const { id, text } = redoSchema.parse(request)
      if (starting.has(id) || sessions.get(id)?.answering) return { ok: false, error: 'busy' }
      starting.add(id)
      try {
        const chat = await deps.store.get(id)
        if (!chat) return { ok: false, error: 'missing' }
        const last = chat.messages.findLastIndex((message) => message.role === 'user')
        const asked = chat.messages[last]
        if (!asked) return { ok: false, error: 'missing' }
        const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
        if (!found.ok) return { ok: false, error: 'not-found' }
        if (chat.meetingId && !(await deps.meetings.get(chat.meetingId))) return { ok: false, error: 'missing' }
        // Processo novo: o que já respondeu esta pergunta nunca é reaproveitado.
        const old = sessions.get(id)
        if (old) end(id, old)
        const question = text?.trim() ?? asked.text
        const session = await openSession(chat, found.path)
        if (!session) return { ok: false, error: 'missing' }
        const asking: ChatMessage = { role: 'user', text: question, at: stamp() }
        // Relida na fila: corta a partir da última pergunta da conversa como está agora.
        const saved = await deps.store.mutate(id, (current) => {
          if (!current) return null
          const at = current.messages.findLastIndex((message) => message.role === 'user')
          return at === -1 ? null : { ...current, messages: [...current.messages.slice(0, at), asking] }
        })
        if (!saved) {
          end(id, session)
          return { ok: false, error: 'missing' }
        }
        start(saved, question, session)
        return { ok: true, chat: saved }
      } finally {
        starting.delete(id)
      }
    },

    async copy(request) {
      const { id, index } = copySchema.parse(request)
      const message = (await deps.store.get(id))?.messages[index]
      if (!message || !deps.clipboard) return false
      deps.clipboard.writeText(message.text)
      return true
    },

    stop(input) {
      const id = idOf(input)
      const session = id ? sessions.get(id) : undefined
      if (!session?.answering) return false
      session.claude.stop()
      return true
    },

    close(input) {
      const id = idOf(input)
      if (id) close(id)
    },

    leave(input) {
      const id = idOf(input)
      if (id) leave(id)
    },

    leaveAll() {
      for (const id of [...sessions.keys()]) leave(id)
    },

    async remove(input) {
      const id = idOf(input)
      if (!id) return false
      const session = sessions.get(id)
      if (session) {
        session.cancelled = true
        end(id, session)
        await session.answering
      }
      return deps.store.remove(id)
    },

    async removeMeeting(meetingId) {
      const linked = (await deps.store.list()).filter((item) => item.meetingId === meetingId)
      for (const item of linked) {
        const session = sessions.get(item.id)
        if (!session) continue
        session.cancelled = true
        end(item.id, session)
        await session.answering
      }
      for (const item of linked) await deps.store.remove(item.id)
      await deps.corpus.remove(meetingId)
    },

    settled: async (id) => {
      await sessions.get(id)?.answering
    },

    sessions: () => [...sessions.keys()],

    dispose() {
      for (const [id, session] of [...sessions]) end(id, session)
    },
  }
}
