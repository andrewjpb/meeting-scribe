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
//
// Contrato 17: com a "Conexão com o Claude" no agente (padrão), a conversa fala ACP com o adaptador oficial
// (`acp/chat.ts`), uma sessão por conversa no mesmo ciclo de vida; trocar o modelo ou "Pensar mais" vale na
// mesma sessão, pelo protocolo. Com "Linha de comando", nada muda. Uma conversa aberta num transporte e
// perguntada depois da troca nas Configurações recomeça no outro, com o histórico.
//
// Contrato 25: com `assistant`, a conversa da tela "Assistente" roda sempre numa pasta própria (as reuniões do
// escopo), que a cada pergunta recebe de novo as fontes do app (estado, guia, automações, WhatsApp), com a
// instrução do Assistente. Os blocos `lap-acao` do fim da resposta viram ações propostas, gravadas com ela; nenhuma
// roda aqui. A conversa de uma reunião e as conversas criadas pelas automações não passam por isso.
//
// Contrato 45 (CA7): o Assistente também pode pedir uma ferramenta do app (só leitura: buscar e ler emails) com um
// bloco `lap-ferramenta` no fim da resposta; ela roda aqui e a resposta continua na mesma sessão (`tools.ts`).
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { withoutActionBlocks, type ChatAction } from '../../shared/assistant'
import {
  CHAT_SOURCE_KINDS,
  CHAT_TEXT_MAX,
  CHAT_TITLE_MAX,
  chatSourcesOf,
  chatTitle,
  chatWhatsAppModeOf,
  type Chat,
  type ChatDetail,
  type ChatEvent,
  type ChatListItem,
  type ChatMessage,
  type ChatMeta,
  type ChatPlanEntry,
  type ChatProgress,
  type ChatScope,
  type ChatSendResult,
  type ChatStep,
} from '../../shared/chat'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { CHAT_MODELS, type ChatModel, type ClaudeTransport } from '../../shared/settings-defaults'
import { WHATSAPP_DEFAULT_SCOPE_DAYS } from '../../shared/whatsapp'
import type { AcpOpenResult, AcpSessionRequest } from '../acp/agent'
import { AcpChat, type ChatEngine } from '../acp/chat'
import { assistantSystemPrompt, ClaudeChat, type ChatAnswer } from '../claude-cli/chat'
import { claudeEnv } from '../claude-cli/locate'
import type { SpawnClaude, Timers } from '../claude-cli/translator'
import type { MeetingsStore } from '../meetings/store'
import type { SettingsStore } from '../settings/store'
import { actionsHistory } from './actions'
import { toolCallOf, toolFollowUp, TOOL_ROUNDS_MAX, toolsInstructions, withoutToolCalls, type AssistantTool, type ToolResult } from './tools'
import { scopeMeetingIds, type ChatCorpus } from './corpus'
import { chatIdSchema, chatScopeSchema, type ChatStore } from './store'

/**
 * Contrato 45 (CA7): os detalhes de duas rodadas da mesma resposta somados: custo, tokens, tempo e turnos; as reuniões
 * consultadas sem repetir, na ordem; o modelo é o da última.
 */
export function sumMeta(a: ChatMeta, b: ChatMeta): ChatMeta {
  return {
    model: b.model || a.model,
    durationMs: a.durationMs + b.durationMs,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    costUsd: a.costUsd + b.costUsd,
    turns: a.turns + b.turns,
    consulted: [...new Set([...a.consulted, ...b.consulted])],
  }
}

/** Fora da tela do chat por 5 min: o processo da conversa morre. */
export const CHAT_LEAVE_MS = 5 * 60_000

export interface ChatServiceDeps {
  store: ChatStore
  corpus: Pick<ChatCorpus, 'dir' | 'ensure' | 'scope' | 'scopeMany' | 'dropScope' | 'remove'> & Partial<Pick<ChatCorpus, 'reindexScope' | 'refreshScope'>>
  /**
   * Contrato 24 (CA5): as conversas do WhatsApp escolhidas vão como `.md` para a pasta de escopo da conversa. Só
   * leitura: o chat não tem acesso ao envio.
   */
  whatsapp?: { exportChats(folder: string, chatIds: readonly string[], days: number): Promise<string[]> }
  /**
   * Contrato 25: o Assistente. `prepare` escreve as fontes do app na pasta da conversa antes de cada pergunta;
   * `extract` tira os blocos de ação do fim da resposta e devolve as ações validadas. Sem ele, a tela segue o chat
   * dos contratos 15 a 24.
   */
  assistant?: {
    prepare(folder: string, scope: ChatScope): Promise<unknown>
    extract(text: string): Promise<{ text: string; actions: ChatAction[] }>
    /**
     * Contrato 45 (CA7): as ferramentas do app (só leitura) que a conversa do Assistente pode pedir no fim da
     * resposta (`tools.ts`), pelo escopo (a fonte desligada não dá ferramenta). Relidas a cada pergunta; sem elas,
     * nenhum pedido de ferramenta roda.
     */
    tools?: (scope: ChatScope) => readonly AssistantTool[]
  }
  settings: Pick<SettingsStore, 'get'>
  meetings: Pick<MeetingsStore, 'get' | 'list'>
  /** "Copiar" de uma resposta (a área de transferência do main). */
  clipboard?: { writeText: (text: string) => void }
  /** O mesmo `locate` do tradutor e do resumo. */
  locate: () => Promise<ClaudeLocateResult>
  spawn: SpawnClaude
  baseEnv: NodeJS.ProcessEnv
  /**
   * Fábrica de sessões do ACP (contrato 17) para o `claude` encontrado. Sem ela, a conversa usa sempre a
   * linha de comando.
   */
  openAcp?: (claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult>
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
    thinkMore: z.boolean().optional(),
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
    thinkMore: z.boolean().optional(),
  })
  .strict()
const redoSchema = z.object({ id: chatIdSchema, text: questionSchema.optional() }).strict()
const copySchema = z.object({ id: chatIdSchema, index: z.number().int().min(0).max(10_000) }).strict()

const sameScope = (a: ChatScope, b: ChatScope): boolean =>
  a.kind === b.kind &&
  (a.meetingIds ?? []).join(',') === (b.meetingIds ?? []).join(',') &&
  (a.whatsappChats ?? []).join(',') === (b.whatsappChats ?? []).join(',') &&
  (a.whatsappDays ?? null) === (b.whatsappDays ?? null) &&
  chatWhatsAppModeOf(a) === chatWhatsAppModeOf(b) &&
  CHAT_SOURCE_KINDS.every((kind) => chatSourcesOf(a)[kind] === chatSourcesOf(b)[kind])

interface Session {
  claude: ChatEngine
  /** Transporte em que a conversa abriu: trocado nas Configurações, a próxima pergunta recomeça no outro. */
  transport: ClaudeTransport
  /** Pasta temporária da conversa de uma reunião, apagada quando o processo sai de uso. */
  scope: string | null
  leaveTimer: unknown
  /** Resposta em curso, gravada ao terminar. */
  answering: Promise<void> | null
  /** Fechada enquanto respondia: morre quando a resposta terminar. */
  closeAfter: boolean
  /** Conversa excluída: nada mais é gravado. */
  cancelled: boolean
  /** Modelo pedido ao processo (`--model`) ou à sessão ACP. */
  model: ChatModel
  /** "Pensar mais" pedido à sessão ACP. */
  thinkMore: boolean
  /** Títulos das reuniões, para o rótulo "Abrindo «<título>»"; relidos a cada pergunta. */
  titles: Map<string, string>
  /** Contrato 25: conversa do Assistente (fontes antes de cada pergunta, ações no fim da resposta). */
  assistant: boolean
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

  /**
   * Modelo ou "Pensar mais" trocados: pelo ACP, a mesma sessão aplica na próxima pergunta (contrato 17, CA2 e
   * CA5); pela linha de comando, o processo é refeito.
   */
  function reconfigure(id: string, model: ChatModel, thinkMore: boolean): void {
    const session = sessions.get(id)
    if (!session) return
    if (session.model === model && session.thinkMore === thinkMore) return
    if (session.claude.configure?.(model, thinkMore)) {
      session.model = model
      session.thinkMore = thinkMore
      return
    }
    restart(id)
  }

  /** O modelo da conversa; a do contrato 15 (`null`) segue as Configurações. */
  async function modelOf(chat: Chat): Promise<ChatModel> {
    return chat.model ?? (await deps.settings.get()).chatModel
  }

  async function openSession(chat: Chat, binaryPath: string): Promise<Session | null> {
    const { claudeTransport } = await deps.settings.get()
    const transport: ClaudeTransport = claudeTransport === 'acp' && deps.openAcp ? 'acp' : 'cli'
    const existing = sessions.get(chat.id)
    if (existing && existing.transport === transport) return existing
    // Conexão trocada nas Configurações: a conversa recomeça no outro transporte, com o histórico.
    if (existing) {
      if (existing.answering) return null
      end(chat.id, existing)
    }
    let cwd: string
    let scope: string | null = null
    let folder: 'all' | 'subset' | 'meeting' = 'all'
    // Contrato 25: o Assistente monta as fontes (o WhatsApp inclusive) a cada pergunta, em `answer`.
    const assistant = !chat.meetingId && deps.assistant !== undefined
    // Contrato 24: conversas do WhatsApp só na tela do chat, e só com o serviço ligado.
    const whatsappChats = chat.meetingId || assistant || !deps.whatsapp ? [] : (chat.scope.whatsappChats ?? [])
    let whatsapp = false
    if (chat.meetingId) {
      scope = await deps.corpus.scope(chat.meetingId, chat.id)
      if (!scope) return null
      cwd = scope
      folder = 'meeting'
    } else if (assistant || chat.scope.kind !== 'all' || whatsappChats.length) {
      // Só as reuniões do escopo (e as conversas do WhatsApp), numa pasta da conversa com o índice delas. O
      // Assistente usa o acervo como fonte das cópias: refeito se faltar, como no "Todas as reuniões" de antes.
      if (assistant) await deps.corpus.ensure()
      const ids = scopeMeetingIds(chat.scope, await deps.meetings.list(), now())
      scope = await deps.corpus.scopeMany(ids, chat.id)
      if (!scope) return null
      if (whatsappChats.length && deps.whatsapp) {
        const written = await deps.whatsapp.exportChats(scope, whatsappChats, chat.scope.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS).catch(() => [])
        whatsapp = written.length > 0
        if (whatsapp) await deps.corpus.reindexScope?.(chat.id)
      }
      cwd = scope
      folder = chat.scope.kind === 'all' ? 'all' : 'subset'
    } else {
      await deps.corpus.ensure()
      cwd = deps.corpus.dir
    }
    const model = await modelOf(chat)
    const titles = new Map<string, string>()
    const titleOf = (meetingId: string): string | null => titles.get(meetingId) ?? null
    // Contrato 26: a fonte "Internet" do Assistente (ligada por padrão) só vale pelo ACP, onde o app confere cada
    // página; pela linha de comando a busca e a página continuam negadas, e a instrução diz isso.
    const web = assistant && transport === 'acp' && chatSourcesOf(chat.scope).internet
    // Contrato 45 (CA7): as ferramentas do app que esta conversa pode pedir, descritas na instrução.
    const toolLines = assistant ? toolsInstructions(deps.assistant?.tools?.(chat.scope) ?? []) : []
    const systemPrompt = assistant && folder !== 'meeting' ? { systemPrompt: assistantSystemPrompt(folder, transport === 'acp' ? web : 'cli', toolLines) } : {}
    const claude: ChatEngine =
      transport === 'acp' && deps.openAcp
        ? new AcpChat({
            open: deps.openAcp(binaryPath),
            model,
            thinkMore: chat.thinkMore,
            scope: folder,
            whatsapp,
            ...systemPrompt,
            ...(web ? { web: true } : {}),
            cwd,
            titleOf,
            now,
            ...(deps.timers ? { timers: deps.timers } : {}),
            ...(deps.idleTimeoutMs !== undefined ? { idleTimeoutMs: deps.idleTimeoutMs } : {}),
            ...(deps.log ? { log: deps.log } : {}),
          })
        : new ClaudeChat({
            binaryPath,
            model,
            scope: folder,
            whatsapp,
            ...systemPrompt,
            cwd,
            titleOf,
            env: claudeEnv(deps.baseEnv, binaryPath),
            spawn: deps.spawn,
            ...(deps.timers ? { timers: deps.timers } : {}),
            ...(deps.idleTimeoutMs !== undefined ? { idleTimeoutMs: deps.idleTimeoutMs } : {}),
            ...(deps.log ? { log: deps.log } : {}),
          })
    const session: Session = {
      claude,
      transport,
      scope,
      leaveTimer: null,
      answering: null,
      closeAfter: false,
      cancelled: false,
      model,
      thinkMore: chat.thinkMore,
      titles,
      assistant,
    }
    sessions.set(chat.id, session)
    return session
  }

  async function answer(chat: Chat, question: string, session: Session): Promise<void> {
    // Contrato 25: os cartões propostos vão no histórico (o Claude sabe o que já foi criado ou enviado).
    const history = chat.messages.slice(0, -1).map(({ role, text, actions }) => ({ role, text: actions?.length ? `${text}\n\n${actionsHistory(actions)}`.trim() : text }))
    // Contrato 25: as fontes do app de agora na pasta da conversa, antes de a pergunta sair. Fonte que falha fica de fora.
    if (session.assistant && session.scope && deps.assistant) {
      await deps.assistant.prepare(session.scope, chat.scope).catch((error: unknown) => deps.log?.(`[assistente] fontes: ${error instanceof Error ? error.message : String(error)}`))
      // As reuniões do escopo de agora (a gravada depois de a conversa abrir entra) e o índice com as fontes.
      const ids = scopeMeetingIds(chat.scope, await deps.meetings.list().catch(() => []), now())
      if (deps.corpus.refreshScope) await deps.corpus.refreshScope(ids, chat.id).catch(() => undefined)
      else await deps.corpus.reindexScope?.(chat.id).catch(() => undefined)
    }
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
    let plan: ChatPlanEntry[] = []
    // Contrato 45 (CA7): com as rodadas de ferramenta, o que as rodadas anteriores já gastaram (o custo, os tokens, o
    // tempo, as negações e as fontes) e o texto que elas escreveram antes do pedido, que entra na resposta final.
    let spent: ChatMeta | null = null
    let deniedBefore = 0
    let earlier = ''
    const onDetail = (detail: ChatDetail): void => {
      if (detail.type === 'step') {
        // Pelo ACP o mesmo passo volta com estado novo: troca no lugar.
        const at = detail.step.id ? steps.findIndex((step) => step.id === detail.step.id) : -1
        if (at === -1) steps.push(detail.step)
        else steps[at] = detail.step
      } else if (detail.type === 'plan') plan = detail.entries
      else if (detail.type === 'thinking') thinking += detail.delta
      else if (detail.type === 'denied') denied = deniedBefore + detail.count
      else meta = spent ? sumMeta(spent, detail.meta) : detail.meta
      if (session.cancelled) return
      if (detail.type === 'denied') deps.onEvent({ chatId: chat.id, type: 'denied', count: denied })
      else if (detail.type === 'meta' && meta) deps.onEvent({ chatId: chat.id, type: 'meta', meta })
      else deps.onEvent({ chatId: chat.id, ...detail })
    }
    const joined = (text: string): string => (earlier && text ? `${earlier}\n\n${text}` : earlier || text)
    const onProgress = (progress: ChatProgress): void => {
      if (!session.cancelled) deps.onEvent({ type: 'answer', chatId: chat.id, ...progress, text: joined(progress.text) })
    }
    let result: ChatAnswer = await session.claude.ask(question, history, onProgress, onDetail)
    // Contrato 45 (CA7): o pedido de uma ferramenta do app no fim da resposta roda aqui (só leitura) e a resposta
    // continua na mesma sessão, com o arquivo do resultado na pasta. Até `TOOL_ROUNDS_MAX` rodadas.
    const tools = session.assistant ? (deps.assistant?.tools?.(chat.scope) ?? []) : []
    for (let round = 1; session.assistant && tools.length && session.scope && result.ok && round <= TOOL_ROUNDS_MAX; round++) {
      const call = toolCallOf(result.text, tools)
      if (!call || session.cancelled) break
      const stepId = `ferramenta-${round}`
      onDetail({ type: 'step', step: { tool: call.tool.step, label: call.tool.pending, meetingId: null, id: stepId, status: 'in_progress' } })
      const done: ToolResult = await call.tool.run(call.args, session.scope).catch((error: unknown) => {
        deps.log?.(`[assistente] ferramenta ${call.tool.name} falhou: ${error instanceof Error ? error.message : String(error)}`)
        return { file: null, label: `${call.tool.pending}: falhou`, note: 'A ferramenta falhou: responda com o que já tem.' }
      })
      onDetail({ type: 'step', step: { tool: call.tool.step, label: done.label, meetingId: null, id: stepId, status: done.file ? 'completed' : 'failed' } })
      if (session.cancelled) return
      // O texto e os blocos de ação antes do pedido ficam (os cartões das rodadas se juntam no fim).
      earlier = joined(call.before)
      spent = meta
      deniedBefore = denied
      result = await session.claude.ask(toolFollowUp(call.tool.name, done), [...history, { role: 'user', text: question }], onProgress, onDetail)
    }
    if (session.cancelled) return
    if (earlier) result = { ...result, text: joined(result.text) }
    if (tools.length && result.ok) result = { ...result, text: withoutToolCalls(result.text) }
    // Contrato 25: os blocos `lap-acao` da resposta inteira viram ações propostas (nunca executadas aqui).
    let text = result.text
    let actions: ChatAction[] = []
    if (session.assistant && result.ok && deps.assistant) {
      const extracted = await deps.assistant.extract(result.text).catch(() => ({ text: result.text, actions: [] as ChatAction[] }))
      text = extracted.text
      actions = extracted.actions
    } else if (session.assistant) text = withoutActionBlocks(result.text)
    if (session.cancelled) return
    const message: ChatMessage = {
      role: 'assistant',
      text,
      at: stamp(),
      ...(result.ok ? {} : { error: result.error }),
      ...(steps.length ? { steps } : {}),
      ...(thinking ? { thinking } : {}),
      ...(denied ? { denied } : {}),
      ...(plan.length ? { plan } : {}),
      ...(meta ? { meta } : {}),
      model: session.model,
      ...(actions.length ? { actions } : {}),
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
      const { chatId, meetingId, text, scope, model, thinkMore } = sendSchema.parse(request)
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
          chat = { id, meetingId, title: chatTitle(question), createdAt: stamp(), messages: [], scope: { kind: 'all' }, model: null, thinkMore: false }
        }
        // Escopo e modelo da barra do campo; trocados, o processo da conversa é refeito.
        const nextScope = scope && !chat.meetingId ? scope : chat.scope
        const currentModel = await modelOf(chat)
        const nextModel = model ?? currentModel
        const nextThinkMore = thinkMore ?? chat.thinkMore
        const scopeChanged = !sameScope(nextScope, chat.scope)
        chat = { ...chat, scope: nextScope, model: nextModel, thinkMore: nextThinkMore }
        if (scopeChanged) restart(chat.id)
        else reconfigure(chat.id, nextModel, nextThinkMore)
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
          return { ...current, scope: prepared.scope, model: prepared.model, thinkMore: prepared.thinkMore, messages: [...current.messages, asked] }
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
      const { id, title, scope, model, thinkMore } = updateSchema.parse(request)
      if (starting.has(id)) return null
      const fallback = (await deps.settings.get()).chatModel
      let scopeChanged = false
      // Leitura, mudança e gravação na mesma vez da fila (a resposta que termina no meio fica).
      const saved = await deps.store.mutate(id, (chat) => {
        if (!chat) return null
        const nextScope = scope && !chat.meetingId ? scope : chat.scope
        scopeChanged = !sameScope(nextScope, chat.scope)
        return {
          ...chat,
          ...(title !== undefined ? { title: chatTitle(title) } : {}),
          scope: nextScope,
          model: model ?? chat.model,
          thinkMore: thinkMore ?? chat.thinkMore,
        }
      })
      if (!saved) return null
      // O escopo muda a pasta: processo novo. Modelo e "Pensar mais" seguem na mesma sessão pelo ACP.
      if (scopeChanged) restart(id)
      else reconfigure(id, saved.model ?? fallback, saved.thinkMore)
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
      // Só `true` se o motor de fato tinha o que parar (contrato 17).
      return session.claude.stop()
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
