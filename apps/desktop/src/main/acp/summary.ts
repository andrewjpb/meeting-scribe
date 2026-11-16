// Resumo da reunião pelo ACP (contrato 17, CA4c). Uma sessão ACP curta por resumo, numa pasta vazia
// própria, sem ferramenta nenhuma, com o modelo das Configurações e a instrução do resumo (contrato 08). A
// transcrição e as anotações vão como conteúdo do `session/prompt`, nunca na linha de comando; a resposta
// (o `agent_message_chunk` juntado) passa pela mesma validação do resumo da linha de comando. Passou de 3
// min: `session/cancel` e o processo morre (`timeout`). Cancelado (reunião excluída, app saindo): o mesmo,
// com `failed`. A sessão sempre fecha no fim.
import { parseSummaryResult, SUMMARY_TIMEOUT_MS, summarySystemPrompt, type SummaryRunResult } from '../claude-cli/summary'
import type { Timers } from '../claude-cli/translator'
import type { ClaudeModel } from '../../shared/settings-defaults'
import { contentText, type AcpOpenResult, type AcpSessionRequest } from './agent'

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

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Um resumo pelo agente. Nunca rejeita: falha vira `failed`, `format` ou `timeout`. */
export async function runAcpSummary(options: RunAcpSummaryOptions): Promise<SummaryRunResult> {
  const timers = options.timers ?? defaultTimers
  const timeoutMs = options.timeoutMs ?? SUMMARY_TIMEOUT_MS
  const now = options.now ?? Date.now
  if (options.signal?.aborted) return { ok: false, error: 'failed' }
  const startedAt = now()
  let finished = false
  let settle: (result: SummaryRunResult) => void = () => undefined
  const outcome = new Promise<SummaryRunResult>((resolve) => {
    settle = (result) => {
      if (finished) return
      finished = true
      resolve(result)
    }
  })
  // O tempo conta desde a abertura: um agente que não abre também estoura os 3 min.
  const timer = timers.setTimeout(() => settle({ ok: false, error: 'timeout' }), timeoutMs)
  const onAbort = (): void => settle({ ok: false, error: 'failed' })
  options.signal?.addEventListener('abort', onAbort, { once: true })

  void (async () => {
    const opened = await options.open({ purpose: 'summary', cwd: options.cwd, model: options.model, systemPrompt: summarySystemPrompt(), tools: 'none' })
    if (!opened.ok) {
      options.log?.(`[acp] resumo: a sessão não abriu (${opened.reason.slice(0, 200)})`)
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
    const result = await session.prompt(options.input, {
      onUpdate: (update) => {
        if (update.sessionUpdate === 'agent_message_chunk') text += contentText(update.content)
      },
    })
    if (!result.ok || result.stopReason !== 'end_turn') {
      settle({ ok: false, error: 'failed' })
      return
    }
    const parsed = parseSummaryResult(text, null, now() - startedAt)
    if (parsed.ok) options.log?.(`[acp] resumo: ${options.input.length} caracteres na entrada, ${parsed.durationMs ?? '?'} ms`)
    settle(parsed)
  })()

  const result = await outcome
  timers.clearTimeout(timer)
  options.signal?.removeEventListener('abort', onAbort)
  if (!result.ok && result.error === 'timeout') options.log?.(`[acp] resumo sem resposta em ${timeoutMs} ms; processo encerrado`)
  return result
}
