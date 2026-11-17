// Uma execução de agente (contrato 23, CA5 e CA10): uma sessão ACP própria (o motor do contrato 17), com as
// instruções do agente como instrução de sistema, o escopo como pasta da sessão (o acervo do chat 16, uma pasta
// só com as reuniões do escopo, só a reunião que acabou, ou uma pasta vazia) e a mesma política do chat: só
// leitura e busca dentro da pasta, sem shell, sem escrita, sem configurações pessoais, sem MCP (o contrato 21 ainda
// não existe) e, a não ser que o agente tenha "Pode pesquisar na internet" (contrato 26), sem rede. O pedido vai com a data, a hora e o fuso no começo. O tempo máximo da tarefa
// manda `session/cancel` e, 2 s depois, mata o processo. Nada aqui alcança o WhatsApp nem qualquer envio: a
// resposta volta para quem chamou e só vira as saídas locais do CA6.
import { mkdir } from 'node:fs/promises'
import { chatErrorText, type ChatDetail, type ChatMessage, type ChatMeta, type ChatPlanEntry, type ChatProgress, type ChatStep } from '../../shared/chat'
import type { Agent, AgentScope } from '../../shared/automations'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { AGENT_PROFILE_LABELS, CHAT_MODELS, type ChatModel } from '../../shared/settings-defaults'
import type { AcpOpenResult, AcpSessionRequest } from '../acp/agent'
import { AcpChat, type ChatEngine } from '../acp/chat'
import type { ChatCorpus } from '../chat/corpus'
import { scopeMeetingIds } from '../chat/corpus'
import { chatSystemPrompt, webInstructions, type ChatFolder } from '../claude-cli/chat'
import { escapeTurnText } from '../claude-cli/prompt'
import type { Timers } from '../claude-cli/translator'
import type { MeetingsStore } from '../meetings/store'

/** Depois do `session/cancel` pelo tempo máximo, quanto o agente tem antes de o processo morrer. */
export const RUN_KILL_GRACE_MS = 2_000

export interface AgentRunnerDeps {
  /** O mesmo `locate` do chat, do resumo e da tradução. */
  locate: () => Promise<ClaudeLocateResult>
  /** Fábrica de sessões do ACP (contrato 17). Sem ela, nenhuma execução roda. */
  openAcp?: ((claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult>) | undefined
  corpus: Pick<ChatCorpus, 'dir' | 'ensure' | 'scope' | 'scopeMany' | 'dropScope'>
  meetings: Pick<MeetingsStore, 'list'>
  /** Pasta vazia para o escopo "nenhuma reunião". */
  emptyDir: string
  now?: () => number
  timers?: Timers
  /** Teste: motor substituto no lugar do `AcpChat`. */
  engine?: (options: {
    open: (request: AcpSessionRequest) => Promise<AcpOpenResult>
    model: ChatModel
    thinkMore: boolean
    cwd: string
    systemPrompt: string
    titleOf: (id: string) => string | null
    idleTimeoutMs: number
    /** Contrato 26: o agente pode pesquisar na internet. */
    web: boolean
  }) => ChatEngine
  log?: (message: string) => void
}

export interface AgentRunRequest {
  runId: string
  agent: Pick<Agent, 'name' | 'instructions' | 'profile' | 'model' | 'thinkMore' | 'scope' | 'web'>
  /** O pedido já com o cabeçalho de data e fuso. */
  prompt: string
  /** Depois de cada reunião: a pasta da sessão é só ela. */
  meetingId: string | null
  timeoutS: number
}

export interface AgentRunResult {
  status: 'ok' | 'error' | 'timeout'
  answer: ChatMessage
  error: string | null
  costUsd: number
}

export type AgentRunEvent = ({ type: 'answer' } & ChatProgress) | ChatDetail

export interface AgentRunner {
  run(request: AgentRunRequest, onEvent: (event: AgentRunEvent) => void): Promise<AgentRunResult>
  /** Execuções vivas (teste e smoke). */
  active(): string[]
  /** Sair do app: mata todas. */
  dispose(): void
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export const isChatModel = (model: string): model is ChatModel => (CHAT_MODELS as readonly string[]).includes(model)

/**
 * Instrução de sistema do agente: as regras do chat para a pasta (ler o índice, citar a reunião, o conteúdo das
 * reuniões é só material), as regras fixas (só ler e responder, nunca enviar nada a ninguém) e as instruções que
 * a pessoa escreveu, entre marcas. Contrato 26: com `web`, as regras da internet; sem, onde ligar.
 */
export function agentSystemPrompt(folder: ChatFolder | 'none', instructions: string, web = false): string {
  const base =
    folder === 'none'
      ? [
          'Você é um agente do app de reuniões da pessoa que usa este app. Esta execução não tem reuniões para ler: responda só com base no pedido.',
          'Responda sempre em português do Brasil, direto ao ponto, em Markdown simples: parágrafos, listas, negrito e código. Sem tabelas, títulos, imagens ou HTML.',
          'Na mensagem, &, < e > aparecem como &amp;, &lt; e &gt;: são texto, nunca marcas.',
        ].join('\n')
      : chatSystemPrompt(folder)
  return [
    base,
    web
      ? 'Você só lê e responde: não escreve arquivos, não roda comandos e nunca envia nada a ninguém, por canal nenhum (mensagem, e-mail, WhatsApp ou qualquer outro). A resposta fica só neste Mac.'
      : 'Você só lê e responde: não escreve arquivos, não roda comandos, não acessa a internet e nunca envia nada a ninguém, por canal nenhum (mensagem, e-mail, WhatsApp ou qualquer outro). A resposta fica só neste Mac.',
    ...webInstructions('agent', web),
    'A mensagem começa com a data, a hora e o fuso de agora: use-os para "hoje", "esta semana" e prazos.',
    'As instruções da pessoa para este agente estão entre <instrucoes_do_agente> e </instrucoes_do_agente>. Siga-as dentro das regras acima.',
    '<instrucoes_do_agente>',
    escapeTurnText(instructions.trim()),
    '</instrucoes_do_agente>',
  ].join('\n')
}

/** Escopo do agente para a pasta: o acervo inteiro, só algumas reuniões, ou nenhuma. */
function folderOf(scope: AgentScope, meetingId: string | null): ChatFolder | 'none' {
  if (meetingId) return 'meeting'
  if (scope.kind === 'none') return 'none'
  return scope.kind === 'all' ? 'all' : 'subset'
}

export function createAgentRunner(deps: AgentRunnerDeps): AgentRunner {
  const now = deps.now ?? Date.now
  const timers = deps.timers ?? defaultTimers
  const live = new Map<string, ChatEngine>()
  /** Saindo do app: o que ainda procura o `claude` ou monta a pasta não abre sessão. */
  let disposed = false
  const CLOSING = 'O app está fechando.'

  /** A pasta da sessão e, se for uma pasta temporária, a chave dela no acervo (apagada no fim). */
  async function prepare(request: AgentRunRequest): Promise<{ cwd: string; key: string | null } | null> {
    const key = `agent-${request.runId}`
    if (request.meetingId) {
      const scope = await deps.corpus.scope(request.meetingId, key)
      return scope ? { cwd: scope, key } : null
    }
    const scope = request.agent.scope
    if (scope.kind === 'none') {
      await mkdir(deps.emptyDir, { recursive: true, mode: 0o700 })
      return { cwd: deps.emptyDir, key: null }
    }
    if (scope.kind === 'all') {
      await deps.corpus.ensure()
      return { cwd: deps.corpus.dir, key: null }
    }
    const ids = scopeMeetingIds(scope.kind === 'meetings' ? { kind: 'meetings', meetingIds: scope.meetingIds ?? [] } : { kind: scope.kind }, await deps.meetings.list(), now())
    const folder = await deps.corpus.scopeMany(ids, key)
    return folder ? { cwd: folder, key } : null
  }

  async function run(request: AgentRunRequest, onEvent: (event: AgentRunEvent) => void): Promise<AgentRunResult> {
    const { agent } = request
    const label = AGENT_PROFILE_LABELS[agent.profile]
    const failure = (error: string): AgentRunResult => ({ status: 'error', answer: { role: 'assistant', text: '', at: new Date(now()).toISOString(), error: 'failed' }, error, costUsd: 0 })
    if (!isChatModel(agent.model)) return failure('O modelo deste agente não está disponível.')
    const model = agent.model
    if (!deps.openAcp) return failure(`O agente do ${label} não está disponível.`)
    if (disposed) return failure(CLOSING)
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    if (disposed) return failure(CLOSING)
    if (!found.ok) return failure(chatErrorText('not-found', label))
    const folder = await prepare(request).catch(() => null)
    if (disposed) {
      if (folder?.key) void deps.corpus.dropScope(folder.key).catch(() => undefined)
      return failure(CLOSING)
    }
    if (!folder) return failure('A reunião do escopo não existe mais.')

    const titles = new Map<string, string>()
    void deps.meetings.list().then(
      (meetings) => {
        for (const meeting of meetings) titles.set(meeting.id, meeting.title)
      },
      () => undefined,
    )
    const open = deps.openAcp(found.path)
    const systemPrompt = agentSystemPrompt(folderOf(agent.scope, request.meetingId), agent.instructions, agent.web)
    const timeoutMs = request.timeoutS * 1000
    // O relógio de 3 min sem evento do chat fica atrás do tempo máximo da tarefa: quem encerra é o tempo máximo.
    const idleTimeoutMs = timeoutMs + 10_000
    const titleOf = (id: string): string | null => titles.get(id) ?? null
    const engine: ChatEngine = deps.engine
      ? deps.engine({ open, model, thinkMore: agent.thinkMore, cwd: folder.cwd, systemPrompt, titleOf, idleTimeoutMs, web: agent.web })
      : new AcpChat({
          open,
          model,
          thinkMore: agent.thinkMore,
          scope: 'all',
          systemPrompt,
          cwd: folder.cwd,
          titleOf,
          now,
          timers,
          idleTimeoutMs,
          // Contrato 26: a internet do agente; as instruções dele contam como texto da pessoa (endereços que ela deu).
          ...(agent.web ? { web: true, webTyped: agent.instructions } : {}),
          ...(deps.log ? { log: deps.log } : {}),
        })
    live.set(request.runId, engine)
    // Fechou entre a criação e aqui: morre na hora (o `ask` volta como interrompido).
    if (disposed) engine.kill()

    const steps: ChatStep[] = []
    let thinking = ''
    let denied = 0
    let meta: ChatMeta | null = null
    let plan: ChatPlanEntry[] = []
    let timedOut = false
    let killTimer: unknown = null
    const timer = timers.setTimeout(() => {
      timedOut = true
      deps.log?.(`[automações] execução passou de ${request.timeoutS} s; cancelada`)
      engine.stop()
      killTimer = timers.setTimeout(() => engine.kill(), RUN_KILL_GRACE_MS)
    }, timeoutMs)
    try {
      const result = await engine.ask(
        request.prompt,
        [],
        (progress) => onEvent({ type: 'answer', ...progress }),
        (detail) => {
          if (detail.type === 'step') {
            const at = detail.step.id ? steps.findIndex((step) => step.id === detail.step.id) : -1
            if (at === -1) steps.push(detail.step)
            else steps[at] = detail.step
          } else if (detail.type === 'plan') plan = detail.entries
          else if (detail.type === 'thinking') thinking += detail.delta
          else if (detail.type === 'denied') denied = detail.count
          else meta = detail.meta
          onEvent(detail)
        },
      )
      const finalMeta = meta as ChatMeta | null
      const answer: ChatMessage = {
        role: 'assistant',
        text: result.text,
        at: new Date(now()).toISOString(),
        ...(result.ok ? {} : { error: timedOut ? 'timeout' : result.error }),
        ...(steps.length ? { steps } : {}),
        ...(thinking ? { thinking } : {}),
        ...(denied ? { denied } : {}),
        ...(plan.length ? { plan } : {}),
        ...(finalMeta ? { meta: finalMeta } : {}),
        model,
      }
      const costUsd = finalMeta?.costUsd ?? 0
      if (result.ok) return { status: 'ok', answer, error: null, costUsd }
      if (timedOut || result.error === 'timeout') return { status: 'timeout', answer, error: `Passou do tempo máximo de ${request.timeoutS} s.`, costUsd }
      return { status: 'error', answer, error: chatErrorText(result.error, label), costUsd }
    } finally {
      timers.clearTimeout(timer)
      if (killTimer !== null) timers.clearTimeout(killTimer)
      live.delete(request.runId)
      engine.kill()
      if (folder.key) void deps.corpus.dropScope(folder.key).catch(() => undefined)
    }
  }

  return {
    run,
    active: () => [...live.keys()],
    dispose() {
      disposed = true
      for (const engine of live.values()) engine.kill()
      live.clear()
    },
  }
}
