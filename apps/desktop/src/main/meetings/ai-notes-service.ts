// IA anotando ao vivo (contrato 30, CA2): um ciclo por pedido do renderer (que guarda a transcrição e as anotações
// da gravação), pelo mesmo motor da análise (`claude-one-shot.ts`). Nada é gravado aqui: o lote volta para a tela,
// que cria e resolve os post-its dela, e "Encerrar" os salva com a reunião. Um ciclo por gravação (o pedido repetido
// enquanto gera recebe a mesma resposta); o de outra gravação cancela o anterior; sair do app mata o processo.
// A IA não envia nada nem executa nada: a resposta é dado (JSON validado), nunca ação.
// Sem Electron: `claude` e pastas chegam injetados.
import type { AiNotesRunResult } from '../../shared/ai-notes'
import { aiNotesRunRequestSchema } from '../../shared/ai-notes-schema'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { CLAUDE_MODEL_PREFIX } from '../../shared/settings-defaults'
import { AI_NOTES_TIMEOUT_MS, aiNotesInput, aiNotesParser, aiNotesSystemPrompt } from '../claude-cli/ai-notes'
import { analysisLines } from '../claude-cli/analysis'
import { ACP_AI_NOTES_DIR } from '../claude-cli/service'
import { runClaudeOneShot, type OneShotEngine } from './claude-one-shot'

export interface AiNotesServiceDeps extends OneShotEngine {
  /** O mesmo `locate` do tradutor, do resumo e da análise. */
  locate: () => Promise<ClaudeLocateResult>
  now?: () => number
  timeoutMs?: number
}

export interface AiNotesService {
  /** Um ciclo; responde quando ele acaba (ou falha). Pedido inválido lança. */
  run(request: unknown): Promise<AiNotesRunResult>
  /** "Encerrar" ou desligar o interruptor: cancela o ciclo em curso da gravação. Falso se não havia nenhum. */
  cancel(recordingId: unknown): boolean
  /** Sair do app: mata o processo de todo ciclo em curso. */
  dispose(): void
}

/** Mesma forma da chave da análise ao vivo. */
const LIVE_PREFIX = '\u0000gravacao:'

interface Job {
  abort: AbortController
  done: Promise<AiNotesRunResult>
}

export function createAiNotesService(deps: AiNotesServiceDeps): AiNotesService {
  const now = deps.now ?? Date.now
  const jobs = new Map<string, Job>()
  const log = deps.log ?? ((message: string) => console.log(message))

  return {
    async run(input) {
      const request = aiNotesRunRequestSchema.parse(input)
      const key = `${LIVE_PREFIX}${request.recordingId}`
      // Outra gravação pediu: o ciclo que ainda gerava para a anterior é cancelado e nunca chega a esta.
      for (const [other, job] of jobs) if (other !== key) job.abort.abort()
      const running = jobs.get(key)
      if (running) return running.done
      const abort = new AbortController()
      const job: Job = {
        abort,
        done: (async (): Promise<AiNotesRunResult> => {
          const lines = analysisLines(request.segments)
          if (!lines.length) return { ok: false, error: 'empty' }
          const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
          if (!found.ok) return { ok: false, error: 'not-found' }
          // Cancelado ("Encerrar" ou interruptor desligado) antes de o processo abrir: nem abre.
          if (abort.signal.aborted) return { ok: false, error: 'failed' }
          const openIds = new Set(request.openCards.map((card) => card.id))
          const startedAt = now()
          const { result, model } = await runClaudeOneShot(deps, {
            claudePath: found.path,
            purpose: 'ai-notes',
            acpDir: ACP_AI_NOTES_DIR,
            systemPrompt: aiNotesSystemPrompt(),
            parse: aiNotesParser(openIds),
            input: aiNotesInput(lines, request.openCards, request.knownTitles),
            label: 'IA anotando',
            timeoutMs: deps.timeoutMs ?? AI_NOTES_TIMEOUT_MS,
            signal: abort.signal,
          })
          if (!result.ok) {
            log(`[ai-notes] ciclo falhou: ${result.error}`)
            return result
          }
          if (abort.signal.aborted) return { ok: false, error: 'failed' }
          const durationMs = Math.round(result.durationMs ?? now() - startedAt)
          // Custo visível (CA5): sem tela nova, fica no log do main.
          log(`[ai-notes] ciclo: modelo ${CLAUDE_MODEL_PREFIX}${model}, custo ${result.costUsd ?? '?'} USD, ${durationMs} ms, ${result.content.created.length} novos, ${result.content.resolved.length} resolvidos`)
          return { ok: true, batch: result.content, model: `${CLAUDE_MODEL_PREFIX}${model}`, costUsd: result.costUsd, durationMs }
        })()
          .catch((): AiNotesRunResult => ({ ok: false, error: 'failed' }))
          .finally(() => {
            if (jobs.get(key) === job) jobs.delete(key)
          }),
      }
      jobs.set(key, job)
      return job.done
    },

    cancel(recordingId) {
      if (typeof recordingId !== 'string' || !recordingId) return false
      const job = jobs.get(`${LIVE_PREFIX}${recordingId}`)
      job?.abort.abort()
      return Boolean(job)
    },

    dispose() {
      for (const job of jobs.values()) job.abort.abort()
    },
  }
}
