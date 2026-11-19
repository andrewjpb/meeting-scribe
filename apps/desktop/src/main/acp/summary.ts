// Resumo da reunião pelo ACP (contrato 17, CA4c). Uma sessão ACP curta por resumo, numa pasta vazia
// própria, sem ferramenta nenhuma, com o modelo das Configurações e a instrução do resumo (contrato 08). A
// transcrição e as anotações vão como conteúdo do `session/prompt`, nunca na linha de comando; a resposta
// (o `agent_message_chunk` juntado) passa pela mesma validação do resumo da linha de comando. Passou de 3
// min: `session/cancel` e o processo morre (`timeout`). Cancelado (reunião excluída, app saindo): o mesmo,
// com `failed`. A sessão sempre fecha no fim.
//
// Contrato 19: a análise ("Analisar até agora") é outra execução curta do mesmo jeito (`runAcpOneShot`),
// com a instrução e a leitura dela, e o custo do `usage_update` vai para o rodapé.
import { parseSummaryResult, SUMMARY_TIMEOUT_MS, summarySystemPrompt, type OneShotParse, type OneShotResult, type SummaryRunResult } from '../claude-cli/summary'
import type { Timers } from '../claude-cli/translator'
import type { ClaudeModel } from '../../shared/settings-defaults'
import { contentText, type AcpOpenResult, type AcpPurpose, type AcpSessionRequest } from './agent'

export interface RunAcpSummaryOptions {
  open: (request: AcpSessionRequest) => Promise<AcpOpenResult>
  model: ClaudeModel
  /** Pasta vazia em `userData/claude-cwd/summary`. */
  cwd: string
  /** Conteúdo do pedido (`summaryInput`). */
  input: string
  timeoutMs?: number
  timers?: Timers
  log?: (message: string) => void
  signal?: AbortSignal
  now?: () => number
}

/** Uma execução curta qualquer pelo agente (resumo, análise), sempre sem ferramentas. */
export interface RunAcpOneShotOptions<T> extends RunAcpSummaryOptions {
  purpose: Exclude<AcpPurpose, 'chat' | 'translate'>
  systemPrompt: string
  parse: OneShotParse<T>
  /** "resumo", "análise": só para o log. */
  label: string
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Um resumo pelo agente. Nunca rejeita: falha vira `failed`, `format` ou `timeout`. */
export function runAcpSummary(options: RunAcpSummaryOptions): Promise<SummaryRunResult> {
  return runAcpOneShot({ ...options, purpose: 'summary', systemPrompt: summarySystemPrompt(), parse: parseSummaryResult, label: 'resumo' })
}

/** Uma sessão curta pelo agente que devolve um JSON. Nunca rejeita. */
export async function runAcpOneShot<T>(options: RunAcpOneShotOptions<T>): Promise<OneShotResult<T>> {
  const timers = options.timers ?? defaultTimers
  const timeoutMs = options.timeoutMs ?? SUMMARY_TIMEOUT_MS
  const now = options.now ?? Date.now
  if (options.signal?.aborted) return { ok: false, error: 'failed' }
  const startedAt = now()
  let finished = false
  let settle: (result: OneShotResult<T>) => void = () => undefined
  const outcome = new Promise<OneShotResult<T>>((resolve) => {
    settle = (result) => {
      if (finished) return
      finished = true
      resolve(result)
    }
  })
  // O tempo conta desde a abertura: um agente que não abre também estoura o prazo.
  const timer = timers.setTimeout(() => settle({ ok: false, error: 'timeout' }), timeoutMs)
  const onAbort = (): void => settle({ ok: false, error: 'failed' })
  options.signal?.addEventListener('abort', onAbort, { once: true })

  void (async () => {
    // Contrato 21: a análise pode receber os servidores MCP ligados para ela (com "Perguntar", a ferramenta é negada:
    // não há conversa para o cartão). Resumo, rascunho e o resto nunca.
    const opened = await options.open({ purpose: options.purpose, cwd: options.cwd, model: options.model, systemPrompt: options.systemPrompt, tools: 'none', ...(options.purpose === 'analysis' ? { mcp: {} } : {}) })
    if (!opened.ok) {
      options.log?.(`[acp] ${options.label}: a sessão não abriu (${opened.reason.slice(0, 200)})`)
      settle({ ok: false, error: opened.error === 'failed' ? 'failed' : 'agent' })
      return
    }
    const session = opened.session
    // Estourou o tempo ou foi cancelado: `session/cancel` e o processo morre.
    void outcome.then(() => {
      session.cancel()
      session.close()
    })
    if (finished) return
    let text = ''
    let costUsd: number | null = null
    const result = await session.prompt(options.input, {
      onUpdate: (update) => {
        if (update.sessionUpdate === 'agent_message_chunk') text += contentText(update.content)
        else if (update.sessionUpdate === 'usage_update') costUsd = session.profile.usage(update).costUsd ?? costUsd
      },
    })
    if (!result.ok || result.stopReason !== 'end_turn') {
      settle({ ok: false, error: 'failed' })
      return
    }
    const parsed = options.parse(text, costUsd, now() - startedAt)
    if (parsed.ok) options.log?.(`[acp] ${options.label}: ${options.input.length} caracteres na entrada, ${parsed.durationMs ?? '?'} ms`)
    settle(parsed)
  })()

  const result = await outcome
  timers.clearTimeout(timer)
  options.signal?.removeEventListener('abort', onAbort)
  if (!result.ok && result.error === 'timeout') options.log?.(`[acp] ${options.label} sem resposta em ${timeoutMs} ms; processo encerrado`)
  return result
}
