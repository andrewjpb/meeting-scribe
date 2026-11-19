// Chat "Perguntar" pelo ACP (contrato 17, CA2 a CA5). Mesma conversa da linha de comando (contratos 15 e
// 16), outro transporte: uma sessão ACP (um processo do adaptador) por conversa, aberta na primeira pergunta
// e mantida entre as perguntas, sem reenviar o histórico. O que acompanha a resposta chega como eventos do
// protocolo, não como saída de terminal: `agent_message_chunk` vira o texto, `agent_thought_chunk` o
// raciocínio, `tool_call`/`tool_call_update` os passos (com estado), `plan` o "Plano", `usage_update` e o fim
// do `session/prompt` os detalhes. "Parar" manda `session/cancel` e a sessão segue viva. Trocar o modelo ou
// "Pensar mais" usa `session/set_config_option` na mesma sessão; se o agente recusar, a próxima pergunta
// abre outra sessão com o histórico. Nenhum caminho absoluto sai daqui: o passo leva só o rótulo e o id da
// reunião.
//
// Contrato 26: com `web`, a sessão abre com a busca e a página (a política fica no `AcpSession`); os passos mostram
// "Pesquisando: <consulta>", "Abrindo <domínio>" e, para a página recusada, "Endereço bloqueado: não veio da busca".
//
// Contrato 47: com `navegador`, a sessão abre com as ferramentas do navegador; cada chamada vira um passo curto
// ("Abriu exemplo.com (aba 2)", "Leu a página", "Clicou no elemento 3"…), com o domínio e nunca o endereço inteiro.
import type { ChatDetail, ChatError, ChatMeta, ChatPlanEntry, ChatProgress, ChatStep, ChatStepStatus } from '../../shared/chat'
import { CHAT_PLAN_MAX, CHAT_PLAN_TEXT_MAX, CHAT_STEP_LABEL_MAX, CHAT_STEP_STATUSES, CHAT_TEXT_MAX, CHAT_THINKING_MAX, WEB_BLOCKED_LABEL } from '../../shared/chat'
import type { ChatModel } from '../../shared/settings-defaults'
import { CHAT_IDLE_TIMEOUT_MS, chatQuestionContent, chatStepOf, chatSystemPrompt, type ChatAnswer, type ChatFolder, type ChatTurn } from '../claude-cli/chat'
import { escapeTurnText } from '../claude-cli/prompt'
import type { Timers } from '../claude-cli/translator'
import { contentText, type AcpOpenResult, type AcpSession, type AcpSessionRequest, type KnownToolCall, type SessionUpdate, type Usage } from './agent'
import { isNavegadorFerramenta, type NavegadorFerramenta } from '../../shared/navegador-ferramentas'
import { navegadorAbaOf } from './navegador'
import type { AgentProfile } from './profiles/types'
import { webDomain } from './web'

/** Depois de "Parar", quanto o agente tem para fechar a resposta antes de o processo morrer. */
export const ACP_CANCEL_GRACE_MS = 5_000

/** O que o serviço do chat usa de uma conversa, seja pela linha de comando, seja pelo ACP. */
export interface ChatEngine {
  readonly busy: boolean
  readonly alive: boolean
  ask(question: string, history: readonly ChatTurn[], onUpdate: (progress: ChatProgress) => void, onDetail?: (detail: ChatDetail) => void): Promise<ChatAnswer>
  /** "Parar": `true` se havia uma resposta em curso para parar. */
  stop(): boolean
  kill(): void
  /**
   * Modelo ou "Pensar mais" trocados (CA2, CA5): o ACP aplica na mesma sessão, na próxima pergunta, e devolve
   * `true`; sem isso (linha de comando), o serviço refaz o processo.
   */
  configure?(model: ChatModel, thinkMore: boolean): boolean
}

export interface AcpChatOptions {
  /** A fábrica de sessões (`openAcpSession` com o `claude` encontrado). */
  open: (request: AcpSessionRequest) => Promise<AcpOpenResult>
  model: ChatModel
  thinkMore: boolean
  scope: ChatFolder
  /** Contrato 24: a pasta tem conversas do WhatsApp (a instrução diz como citar). */
  whatsapp?: boolean
  /** Contrato 23: a instrução de sistema de um agente (as dele, sobre as regras do chat) no lugar da do chat. */
  systemPrompt?: string
  /** Contrato 26: a sessão abre com a busca na web e as páginas (agente com internet, Assistente com a fonte ligada). */
  web?: boolean
  /** Contrato 26: mais texto escrito pela pessoa (as instruções do agente), de onde saem endereços que ela deixou abrir. */
  webTyped?: string
  /** Contrato 47: a sessão abre com as ferramentas do navegador (Assistente com a ponte ligada e a extensão conectada). */
  navegador?: boolean
  /** Contrato 47: a instrução sem o navegador, para a sessão cujo servidor do navegador não abriu. */
  systemPromptSemNavegador?: string
  cwd: string
  titleOf?: (meetingId: string) => string | null
  timers?: Timers
  idleTimeoutMs?: number
  cancelGraceMs?: number
  now?: () => number
  /** Só em desenvolvimento: custo nominal e ferramentas negadas, nunca o texto. */
  log?: (message: string) => void
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const clip = (text: string): string => (text.length > CHAT_TEXT_MAX ? text.slice(0, CHAT_TEXT_MAX) : text)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Passo da internet (contrato 26, CA4): "Pesquisando: <consulta>", "Abrindo <domínio>" e, para a página que a
 * política recusou, "Endereço bloqueado: não veio da busca". O endereço inteiro não vai para a tela, só o domínio.
 */
export function webStepOf(tool: 'WebSearch' | 'WebFetch', input: Record<string, unknown>, blocked = false): Omit<ChatStep, 'id' | 'status'> {
  if (tool === 'WebSearch') {
    const query = typeof input['query'] === 'string' ? oneLine(input['query']) : ''
    const label = query ? `Pesquisando: ${query}` : 'Pesquisando na internet'
    return { tool, label: label.length > CHAT_STEP_LABEL_MAX ? `${label.slice(0, CHAT_STEP_LABEL_MAX - 1)}…` : label, meetingId: null }
  }
  if (blocked) return { tool, label: WEB_BLOCKED_LABEL, meetingId: null }
  const domain = webDomain(input['url'])
  return { tool, label: domain ? `Abrindo ${domain.slice(0, 120)}` : 'Abrindo uma página', meetingId: null }
}

/** Inteiro positivo da entrada, ou `null`. */
const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

/**
 * Passo do navegador (contrato 47): "Abriu <domínio> (aba N)", "Listou as abas", "Leu a página", "Clicou no elemento
 * N", "Digitou no campo N", "Aguardou N s", "Fechou a aba N". Só o domínio do endereço vai à tela; o texto digitado e o
 * conteúdo da página nunca. A aba aberta sai do começo do resultado (`output`), quando ele já chegou.
 */
export function navegadorStepOf(tool: NavegadorFerramenta, input: Record<string, unknown>, output?: string): Omit<ChatStep, 'id' | 'status'> {
  const step = (label: string): Omit<ChatStep, 'id' | 'status'> => ({ tool, label: label.length > CHAT_STEP_LABEL_MAX ? `${label.slice(0, CHAT_STEP_LABEL_MAX - 1)}…` : label, meetingId: null })
  const aba = positive(input['aba'])
  switch (tool) {
    case 'navegador_abrir': {
      const domain = webDomain(input['url'])
      const opened = navegadorAbaOf(output)
      return step(`Abriu ${domain ? domain.slice(0, 120) : 'um site'}${opened ? ` (aba ${opened})` : ''}`)
    }
    case 'navegador_abas':
      return step('Listou as abas')
    case 'navegador_ler':
      return step('Leu a página')
    case 'navegador_clicar': {
      const ref = positive(input['ref'])
      return step(ref ? `Clicou no elemento ${ref}` : 'Clicou na página')
    }
    case 'navegador_digitar': {
      const ref = positive(input['ref'])
      return step(ref ? `Digitou no campo ${ref}` : 'Digitou na página')
    }
    case 'navegador_aguardar': {
      const segundos = positive(input['segundos'])
      return step(segundos ? `Aguardou ${segundos} s` : 'Aguardou a página')
    }
    case 'navegador_fechar':
      return step(aba ? `Fechou a aba ${aba}` : 'Fechou a aba')
  }
}

/** Começo do texto do resultado de uma chamada (o `content` do `tool_call_update`), só para o rótulo do passo. */
function outputOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content as unknown[]) {
    const inner = typeof block === 'object' && block !== null ? (block as { content?: unknown }).content : undefined
    if (typeof inner === 'object' && inner !== null && (inner as { type?: unknown }).type === 'text') {
      const text = (inner as { text?: unknown }).text
      if (typeof text === 'string') return text.slice(0, 200)
    }
  }
  return undefined
}

/**
 * Passo em português a partir de uma chamada de ferramenta do ACP (CA4): "Lendo o índice das reuniões",
 * "Abrindo «<título>»", "Procurando "<termo>"", "Listando arquivos", com o id da chamada e o estado. Outra
 * ferramenta (escrita, shell) não vira passo: a negação aparece na contagem. `blocked`: a página que a política
 * recusou (contrato 26).
 */
export function acpStepOf(profile: AgentProfile, id: string, call: KnownToolCall, titleOf: (meetingId: string) => string | null = () => null, blocked = false): ChatStep | null {
  // O perfil diz que passo é (pelo nome da ferramenta dele) e normaliza a entrada.
  const mapped = profile.stepOf(call)
  if (!mapped) return null
  const step =
    mapped.tool === 'WebSearch' || mapped.tool === 'WebFetch'
      ? webStepOf(mapped.tool, mapped.input, blocked)
      : isNavegadorFerramenta(mapped.tool)
        ? navegadorStepOf(mapped.tool, mapped.input, call.output)
        : chatStepOf(mapped.tool, mapped.input, titleOf)
  if (!step) return null
  const status = (CHAT_STEP_STATUSES as readonly string[]).includes(call.status ?? '') ? (call.status as ChatStepStatus) : 'pending'
  return { ...step, id, status }
}

/** Itens do `plan` do ACP, nos limites do app. */
export function acpPlanOf(entries: readonly { content: string; status: string }[]): ChatPlanEntry[] {
  return entries.slice(0, CHAT_PLAN_MAX).map((entry) => ({
    content: entry.content.replace(/\s+/g, ' ').trim().slice(0, CHAT_PLAN_TEXT_MAX),
    status: entry.status === 'completed' || entry.status === 'in_progress' ? entry.status : 'pending',
  }))
}

/** Detalhes da resposta pelo ACP (CA4): modelo, tempo medido aqui, tokens do fim do prompt e custo do turno. */
export function acpMetaOf(model: string, durationMs: number, usage: Usage | null, costUsd: number, consulted: readonly string[]): ChatMeta {
  return {
    model: model.slice(0, 100),
    durationMs: Math.max(0, Math.round(durationMs)),
    // Como na linha de comando: entrada cobrada como entrada (com a gravada no cache) e a lida do cache à parte.
    inputTokens: count(usage?.inputTokens) + count(usage?.cachedWriteTokens),
    outputTokens: count(usage?.outputTokens),
    cacheReadTokens: count(usage?.cachedReadTokens),
    costUsd: Math.max(0, costUsd),
    turns: 1,
    consulted: [...consulted],
  }
}

interface Asking {
  session: AcpSession
  text: string
  reading: boolean
  thinking: string
  tools: Map<string, KnownToolCall>
  consulted: string[]
  denied: number
  /** Contrato 26: chamadas de página que a política recusou (o passo vira "Endereço bloqueado"). */
  blocked: Set<string>
  /** Custo acumulado da sessão quando a pergunta saiu (o `usage_update` manda o total). */
  costBefore: number
  startedAt: number
  timer: unknown
  stopping: boolean
  /** "Parar" enquanto a sessão abria: aplicado assim que ela abrir. */
  stopRequested?: boolean
  onUpdate: (progress: ChatProgress) => void
  onDetail: (detail: ChatDetail) => void
  resolve: (answer: ChatAnswer) => void
}

export class AcpChat implements ChatEngine {
  /** Sessões abertas por esta conversa, na ordem (teste e diagnóstico). */
  readonly sessions: AcpSession[] = []

  private readonly timers: Timers
  private readonly idleTimeoutMs: number
  private readonly cancelGraceMs: number
  private readonly now: () => number
  private session: AcpSession | null = null
  private asking: Asking | null = null
  private closed = false
  private model: ChatModel
  private thinkMore: boolean
  /** Modelo/esforço a aplicar na sessão viva antes da próxima pergunta. */
  private pending = false
  /** Custo acumulado da sessão, do último `usage_update`. */
  private cost = 0
  /** Modelo que respondeu, do `_meta` do `usage_update`. */
  private answeredBy = ''

  constructor(private readonly options: AcpChatOptions) {
    this.timers = options.timers ?? defaultTimers
    this.idleTimeoutMs = options.idleTimeoutMs ?? CHAT_IDLE_TIMEOUT_MS
    this.cancelGraceMs = options.cancelGraceMs ?? ACP_CANCEL_GRACE_MS
    this.now = options.now ?? Date.now
    this.model = options.model
    this.thinkMore = options.thinkMore
  }

  get busy(): boolean {
    return this.asking !== null
  }

  get alive(): boolean {
    return this.session?.alive === true
  }

  configure(model: ChatModel, thinkMore: boolean): boolean {
    if (model === this.model && thinkMore === this.thinkMore) return true
    this.model = model
    this.thinkMore = thinkMore
    this.pending = true
    return true
  }

  /** Uma pergunta. Nunca rejeita: falha vira `failed`, `agent`, `timeout` ou `stopped`, com o texto até ali. */
  async ask(question: string, history: readonly ChatTurn[], onUpdate: (progress: ChatProgress) => void, onDetail: (detail: ChatDetail) => void = () => undefined): Promise<ChatAnswer> {
    if (this.closed) return { ok: false, error: 'stopped', text: '' }
    if (this.asking) return { ok: false, error: 'failed', text: '' }
    // Reservada antes do primeiro `await`: duas perguntas nunca correm juntas. "Parar" no meio marca
    // `stopRequested`; `kill` no meio marca `closed`: os dois valem assim que a espera acabar.
    const placeholder = { resolve: () => undefined, stopping: false } as unknown as Asking
    this.asking = placeholder
    const interrupted = (): boolean => this.closed || placeholder.stopRequested === true || this.asking !== placeholder
    let content = escapeTurnText(question)
    try {
      if (this.session && !this.session.alive) this.session = null
      if (this.session && this.pending) {
        const session = this.session
        const applied = await this.applyPending(session)
        if (this.closed) return { ok: false, error: 'stopped', text: '' }
        if (!applied) {
          session.close()
          if (this.session === session) this.session = null
        }
      }
      if (interrupted()) return { ok: false, error: 'stopped', text: '' }
      if (!this.session) {
        content = chatQuestionContent(question, history)
        const opened = await this.options.open({
          purpose: 'chat',
          cwd: this.options.cwd,
          model: this.model,
          systemPrompt: this.options.systemPrompt ?? chatSystemPrompt(this.options.scope, this.options.whatsapp ?? false),
          tools: 'read',
          thinkMore: this.thinkMore,
          ...(this.options.web ? { web: true } : {}),
          ...(this.options.navegador ? { navegador: true } : {}),
          ...(this.options.navegador && this.options.systemPromptSemNavegador !== undefined ? { systemPromptSemNavegador: this.options.systemPromptSemNavegador } : {}),
        })
        if (!opened.ok) {
          this.options.log?.(`[acp] chat: a sessão não abriu (${opened.reason.slice(0, 200)})`)
          if (interrupted()) return { ok: false, error: 'stopped', text: '' }
          return { ok: false, error: opened.error === 'agent' ? 'agent' : opened.error === 'missing' ? 'agent-missing' : 'failed', text: '' }
        }
        if (this.closed) {
          opened.session.close()
          return { ok: false, error: 'stopped', text: '' }
        }
        // "Parar" enquanto abria: a sessão fica (a próxima pergunta usa), a pergunta não vai.
        this.session = opened.session
        this.sessions.push(opened.session)
        this.pending = false
        this.cost = 0
        this.answeredBy = ''
        if (interrupted()) return { ok: false, error: 'stopped', text: '' }
      }
    } catch {
      return { ok: false, error: 'failed', text: '' }
    } finally {
      if (this.asking === placeholder) this.asking = null
    }
    const session = this.session
    if (this.closed || !session) return { ok: false, error: 'stopped', text: '' }
    // Contrato 26: o texto que a pessoa escreveu (a pergunta, as anteriores e as instruções do agente), sem escape.
    const typed = [question, ...history.filter((turn) => turn.role === 'user').map((turn) => turn.text), this.options.webTyped ?? ''].join('\n')
    return this.run(session, content, onUpdate, onDetail, typed)
  }

  /** "Parar": `session/cancel`; se o agente não fechar a resposta em 5 s, o processo morre. */
  stop(): boolean {
    const asking = this.asking
    if (!asking) return false
    // Ainda abrindo a sessão: marcado, aplicado quando ela abrir.
    if (!asking.session) {
      asking.stopRequested = true
      return true
    }
    if (asking.stopping) return true
    asking.stopping = true
    asking.session.cancel()
    const session = asking.session
    this.timers.setTimeout(() => {
      if (this.asking !== asking) return
      this.options.log?.('[acp] chat: o agente não parou; processo encerrado')
      this.finish(asking, { ok: false, error: 'stopped' })
      session.close()
      if (this.session === session) this.session = null
    }, this.cancelGraceMs)
    return true
  }

  /** Fechar a conversa ou sair do app: o processo morre e nada mais abre. */
  kill(): void {
    this.closed = true
    const asking = this.asking
    if (asking?.session) this.finish(asking, { ok: false, error: 'stopped' })
    this.asking = null
    this.session?.close()
    this.session = null
  }

  /** Aplica modelo e "Pensar mais" na sessão viva, pelas opções do perfil; `false` se o agente recusou o modelo. */
  private async applyPending(session: AcpSession): Promise<boolean> {
    this.pending = false
    const { modelConfig, thinkMore } = session.profile
    if (!(await session.setOption(modelConfig.configId, modelConfig.value(this.model)))) return false
    if (!thinkMore) return true
    const value = this.thinkMore ? thinkMore.on : thinkMore.off
    // Modelo sem a opção (o agente não oferece) segue sem "Pensar mais".
    if (session.offers(thinkMore.configId, value) && session.option(thinkMore.configId) !== value) await session.setOption(thinkMore.configId, value)
    return true
  }

  private run(session: AcpSession, content: string, onUpdate: (progress: ChatProgress) => void, onDetail: (detail: ChatDetail) => void, typed: string): Promise<ChatAnswer> {
    return new Promise((resolve) => {
      const asking: Asking = {
        session,
        text: '',
        reading: false,
        thinking: '',
        tools: new Map(),
        consulted: [],
        denied: 0,
        blocked: new Set(),
        costBefore: this.cost,
        startedAt: this.now(),
        timer: null,
        stopping: false,
        onUpdate,
        onDetail,
        resolve,
      }
      this.asking = asking
      this.arm(asking)
      void session
        .prompt(content, {
          onUpdate: (update) => {
            if (this.asking !== asking) return
            this.arm(asking)
            this.onUpdate(asking, update)
          },
          onDenied: (denial) => {
            if (this.asking !== asking) return
            asking.denied += 1
            asking.onDetail({ type: 'denied', count: asking.denied })
            if (denial?.reason !== 'web-blocked') return
            // A página recusada: o passo dela troca de rótulo na hora, com o estado de negado.
            asking.blocked.add(denial.toolCallId)
            const call = asking.tools.get(denial.toolCallId)
            const step = call ? acpStepOf(asking.session.profile, denial.toolCallId, { ...call, status: 'failed' }, this.options.titleOf, true) : null
            if (step) asking.onDetail({ type: 'step', step })
          },
        }, typed)
        .then((outcome) => {
          if (this.asking !== asking) return
          if (!outcome.ok) {
            if (outcome.error === 'exited' && this.session === session) this.session = null
            this.finish(asking, { ok: false, error: asking.stopping ? 'stopped' : 'failed' })
            return
          }
          const model = this.answeredBy || String(session.option(session.profile.modelConfig.configId) ?? this.model)
          asking.onDetail({ type: 'meta', meta: acpMetaOf(model, this.now() - asking.startedAt, outcome.usage, this.cost - asking.costBefore, asking.consulted) })
          this.options.log?.(`[acp] chat: ${outcome.stopReason}, US$ ${(this.cost - asking.costBefore).toFixed(4)} nominais, ${asking.denied} pedido(s) negado(s)`)
          if (outcome.stopReason === 'cancelled' || asking.stopping) {
            this.finish(asking, { ok: false, error: 'stopped' })
            return
          }
          const text = asking.text.trim()
          if (outcome.stopReason === 'refusal' || !text) {
            this.finish(asking, { ok: false, error: 'failed' })
            return
          }
          this.finish(asking, { ok: true, text })
        })
    })
  }

  /** Relógio de 3 min sem nenhum evento: cancela e o processo morre. */
  private arm(asking: Asking): void {
    if (asking.timer !== null) this.timers.clearTimeout(asking.timer)
    asking.timer = this.timers.setTimeout(() => {
      if (this.asking !== asking) return
      this.options.log?.(`[acp] chat sem resposta em ${this.idleTimeoutMs} ms; processo encerrado`)
      this.finish(asking, { ok: false, error: 'timeout' })
      asking.session.cancel()
      asking.session.close()
      if (this.session === asking.session) this.session = null
    }, this.idleTimeoutMs)
  }

  private finish(asking: Asking, result: { ok: true; text: string } | { ok: false; error: Exclude<ChatError, 'not-found'> }): void {
    if (this.asking !== asking) return
    this.asking = null
    if (asking.timer !== null) this.timers.clearTimeout(asking.timer)
    asking.timer = null
    asking.resolve(result.ok ? { ok: true, text: clip(result.text) } : { ok: false, error: result.error, text: clip(asking.text) })
  }

  private onUpdate(asking: Asking, update: SessionUpdate): void {
    const progress = (): void => asking.onUpdate({ text: clip(asking.text), reading: asking.reading })
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const piece = contentText(update.content)
        if (!piece) return
        asking.text += piece
        asking.reading = false
        progress()
        return
      }
      case 'agent_thought_chunk': {
        const piece = contentText(update.content)
        if (!piece || asking.thinking.length >= CHAT_THINKING_MAX) return
        const delta = piece.slice(0, CHAT_THINKING_MAX - asking.thinking.length)
        asking.thinking += delta
        asking.onDetail({ type: 'thinking', delta })
        return
      }
      case 'tool_call':
      case 'tool_call_update': {
        const before = asking.tools.get(update.toolCallId)
        const output = outputOf(update.content)
        const call: KnownToolCall = {
          ...(before ?? { locations: [] }),
          ...(typeof update.name === 'string' ? { name: update.name } : {}),
          ...(typeof update.kind === 'string' ? { kind: update.kind } : {}),
          ...(typeof update.title === 'string' ? { title: update.title } : {}),
          ...(typeof update.status === 'string' ? { status: update.status } : {}),
          ...(Array.isArray(update.locations) ? { locations: update.locations.map((location) => location.path) } : {}),
          ...(update.rawInput !== undefined && update.rawInput !== null ? { rawInput: update.rawInput } : {}),
          ...(output !== undefined ? { output } : {}),
        }
        asking.tools.set(update.toolCallId, call)
        const blocked = asking.blocked.has(update.toolCallId)
        const step = acpStepOf(asking.session.profile, update.toolCallId, blocked ? { ...call, status: 'failed' } : call, this.options.titleOf, blocked)
        if (update.sessionUpdate === 'tool_call' && !asking.text) {
          asking.reading = true
          progress()
        }
        if (!step) return
        if (step.meetingId && !asking.consulted.includes(step.meetingId)) asking.consulted.push(step.meetingId)
        const previous = before ? acpStepOf(asking.session.profile, update.toolCallId, blocked ? { ...before, status: 'failed' } : before, this.options.titleOf, blocked) : null
        // O mesmo passo só volta à tela quando o rótulo ou o estado mudaram.
        if (previous && previous.label === step.label && previous.status === step.status && previous.meetingId === step.meetingId) return
        asking.onDetail({ type: 'step', step })
        return
      }
      case 'plan':
        asking.onDetail({ type: 'plan', entries: acpPlanOf(update.entries) })
        return
      case 'usage_update': {
        const reading = asking.session.profile.usage(update)
        if (reading.costUsd !== null) this.cost = reading.costUsd
        if (reading.model) this.answeredBy = reading.model
        return
      }
      default:
        return
    }
  }
}
