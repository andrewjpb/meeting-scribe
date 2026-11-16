// O que a tela "Perguntar" e a aba "Perguntar" do detalhe pedem ao main (contrato 15, CA2 a CA7). Uma
// conversa tem no máximo um processo do `claude`, aberto na primeira pergunta e mantido entre as perguntas.
// Fechar a conversa mata o processo (depois da resposta em curso); sair da tela mata em 5 min; sair do app
// mata na hora. A pergunta é gravada antes de ir ao processo; a resposta, quando termina (inteira, parada ou
// com erro). Sem o `claude`, nada é gravado nem enviado. Sem Electron: `claude`, relógio e eventos chegam
// injetados.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CHAT_TEXT_MAX, chatTitle, type Chat, type ChatEvent, type ChatListItem, type ChatMessage, type ChatSendResult } from '../../shared/chat'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { ClaudeChat, type ChatAnswer } from '../claude-cli/chat'
import { claudeEnv } from '../claude-cli/locate'
import type { SpawnClaude, Timers } from '../claude-cli/translator'
import type { MeetingsStore } from '../meetings/store'
import type { SettingsStore } from '../settings/store'
import type { ChatCorpus } from './corpus'
import { chatIdSchema, type ChatStore } from './store'

/** Fora da tela do chat por 5 min: o processo da conversa morre. */
export const CHAT_LEAVE_MS = 5 * 60_000

export interface ChatServiceDeps {
  store: ChatStore
  corpus: Pick<ChatCorpus, 'dir' | 'ensure' | 'scope' | 'dropScope' | 'remove'>
  settings: Pick<SettingsStore, 'get'>
  meetings: Pick<MeetingsStore, 'get'>
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
const sendSchema = z
  .object({
    chatId: chatIdSchema.nullable(),
    meetingId: z.string().min(1).max(200).nullable(),
    text: z
      .string()
      .max(CHAT_TEXT_MAX)
      .refine((value) => value.trim() !== ''),
  })
  .strict()

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

  async function openSession(chat: Chat, binaryPath: string): Promise<Session | null> {
    const existing = sessions.get(chat.id)
    if (existing) return existing
    let cwd: string
    let scope: string | null = null
    if (chat.meetingId) {
      scope = await deps.corpus.scope(chat.meetingId, chat.id)
      if (!scope) return null
      cwd = scope
    } else {
      await deps.corpus.ensure()
      cwd = deps.corpus.dir
    }
    const { chatModel } = await deps.settings.get()
    const session: Session = {
      claude: new ClaudeChat({
        binaryPath,
        model: chatModel,
        scope: chat.meetingId ? 'meeting' : 'all',
        cwd,
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
    }
    sessions.set(chat.id, session)
    return session
  }

  async function answer(chat: Chat, question: string, session: Session): Promise<void> {
    const history = chat.messages.slice(0, -1).map(({ role, text }) => ({ role, text }))
    const result: ChatAnswer = await session.claude.ask(question, history, (progress) => {
      if (!session.cancelled) deps.onEvent({ type: 'answer', chatId: chat.id, ...progress })
    })
    if (session.cancelled) return
    const message: ChatMessage = result.ok ? { role: 'assistant', text: result.text, at: stamp() } : { role: 'assistant', text: result.text, at: stamp(), error: result.error }
    // A conversa relida do disco: outra janela pode ter gravado entre a pergunta e a resposta.
    const current = (await deps.store.get(chat.id)) ?? chat
    const saved = await deps.store.save({ ...current, messages: [...current.messages, message] })
    if (!session.cancelled) deps.onEvent({ type: 'done', chatId: chat.id, chat: saved })
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
      return deps.store.get(id)
    },

    async send(request) {
      const { chatId, meetingId, text } = sendSchema.parse(request)
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
          chat = { id, meetingId, title: chatTitle(question), createdAt: stamp(), messages: [] }
        }
        // Sem o `claude`, nada é gravado nem enviado (CA7).
        const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
        if (!found.ok) return { ok: false, error: 'not-found' }
        // A reunião e a pasta do processo antes de gravar: reunião que sumiu não deixa pergunta gravada.
        if (chat.meetingId && !(await deps.meetings.get(chat.meetingId))) return { ok: false, error: 'missing' }
        const session = await openSession(chat, found.path)
        if (!session) return { ok: false, error: 'missing' }
        const saved = await deps.store.save({ ...chat, messages: [...chat.messages, { role: 'user', text: question, at: stamp() }] })
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
        return { ok: true, chat: saved }
      } finally {
        starting.delete(id)
      }
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
