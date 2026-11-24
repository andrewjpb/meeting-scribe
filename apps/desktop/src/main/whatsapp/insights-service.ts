// "Detalhes" da conversa do WhatsApp (contrato 32), no padrão do `analysis-service`: uma execução curta do Claude
// por conversa (o mesmo pedido repetido enquanto roda recebe a mesma resposta), cancelada quando outra conversa pede
// (a pessoa trocou de conversa) e ao sair do app. O resultado fica no cache por conversa, valendo enquanto a última
// mensagem for a mesma. Só lê: as mensagens chegam por `chat` e `messages` (do serviço do WhatsApp, injetados) e
// nada daqui alcança o envio. Com "Detalhes com IA no WhatsApp" desligado, nada roda.
import { z } from 'zod'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { CLAUDE_MODEL_PREFIX } from '../../shared/settings-defaults'
import { WHATSAPP_CHAT_ID_PATTERN, type WhatsAppChat, type WhatsAppMessage } from '../../shared/whatsapp'
import { INSIGHTS_MESSAGES_MAX, type WhatsAppInsights, type WhatsAppInsightsResult, type WhatsAppInsightsState } from '../../shared/whatsapp-insights'
import { runClaudeOneShot, type OneShotEngine } from '../meetings/claude-one-shot'
import { savedTranscripts } from './export'
import { ACP_INSIGHTS_DIR, insightsInput, insightsParser, insightsSystemPrompt, INSIGHTS_TIMEOUT_MS, type InsightsCacheStore } from './insights'

export interface InsightsServiceDeps extends OneShotEngine {
  cache: InsightsCacheStore
  locate: () => Promise<ClaudeLocateResult>
  /** A conversa da lista do serviço (com a última mensagem), ou `null`. */
  chat: (chatId: string) => Promise<WhatsAppChat | null>
  /** As últimas `max` mensagens, da mais antiga para a mais nova. */
  messages: (chatId: string, max: number) => Promise<WhatsAppMessage[]>
  /** Contrato 147: a transcrição já guardada de um áudio (sem rede); sem ela, os áudios vão como anexo. */
  transcript?: (chatId: string, messageId: string) => Promise<string | null>
  /** "Detalhes com IA no WhatsApp" (Configurações › Claude). */
  enabled: () => Promise<boolean>
  now?: () => number
  timeoutMs?: number
}

export interface InsightsService {
  /** O que está no cache para a conversa e se ainda vale para a última mensagem. Não roda nada. */
  state(request: unknown): Promise<WhatsAppInsightsState>
  /** Analisa agora (no clique, ou ao abrir a conversa sem cache válido); cancela a de outra conversa. */
  run(request: unknown): Promise<WhatsAppInsightsResult>
  dispose(): void
}

const requestSchema = z.object({ chatId: z.string().regex(WHATSAPP_CHAT_ID_PATTERN) }).strict()

interface Job {
  abort: AbortController
  done: Promise<WhatsAppInsightsResult>
}

export function createInsightsService(deps: InsightsServiceDeps): InsightsService {
  const now = deps.now ?? Date.now
  const jobs = new Map<string, Job>()

  async function analyze(chatId: string, signal: AbortSignal): Promise<WhatsAppInsightsResult> {
    if (!(await deps.enabled().catch(() => false))) return { ok: false, error: 'off' }
    const chat = await deps.chat(chatId).catch(() => null)
    if (!chat) return { ok: false, error: 'chat' }
    if (!chat.lastMessage) return { ok: false, error: 'empty' }
    const at = chat.lastMessage.at
    const messages = await deps.messages(chatId, INSIGHTS_MESSAGES_MAX).catch((): WhatsAppMessage[] => [])
    if (!messages.length) return { ok: false, error: 'empty' }
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    if (!found.ok) return { ok: false, error: 'not-found' }
    if (signal.aborted) return { ok: false, error: 'failed' }
    const transcripts = await savedTranscripts(messages.slice(-INSIGHTS_MESSAGES_MAX), deps.transcript ? { get: deps.transcript } : undefined)
    const startedAt = now()
    const { result, model } = await runClaudeOneShot(deps, {
      claudePath: found.path,
      purpose: 'whatsapp-insights',
      acpDir: ACP_INSIGHTS_DIR,
      systemPrompt: insightsSystemPrompt(),
      parse: insightsParser,
      input: insightsInput(chat.name, chat.kind, messages, now(), transcripts),
      label: 'detalhes do WhatsApp',
      timeoutMs: deps.timeoutMs ?? INSIGHTS_TIMEOUT_MS,
      signal,
    })
    if (!result.ok) return result
    if (signal.aborted) return { ok: false, error: 'failed' }
    // Desligado no meio da análise, ou o WhatsApp saiu da conta / foi removido: o resultado é descartado, sem gravar.
    if (!(await deps.enabled().catch(() => false))) return { ok: false, error: 'off' }
    if (!(await deps.chat(chatId).catch(() => null))) return { ok: false, error: 'chat' }
    const insights: WhatsAppInsights = {
      ...result.content,
      chatId,
      at,
      createdAt: new Date(now()).toISOString(),
      messages: messages.length,
      model: `${CLAUDE_MODEL_PREFIX}${model}`,
      costUsd: result.costUsd,
      durationMs: Math.max(0, Math.round(result.durationMs ?? now() - startedAt)),
    }
    // Falhar ao gravar o cache não perde a análise: ela volta para a tela do mesmo jeito.
    await deps.cache.put(insights).catch(() => undefined)
    return { ok: true, insights }
  }

  return {
    async state(input) {
      const parsed = requestSchema.safeParse(input)
      if (!parsed.success) return { insights: null, fresh: false }
      const [insights, chat] = await Promise.all([deps.cache.get(parsed.data.chatId).catch(() => null), deps.chat(parsed.data.chatId).catch(() => null)])
      if (!insights) return { insights: null, fresh: false }
      const current = chat?.lastMessage?.at ?? null
      return { insights, fresh: current !== null && insights.at >= current }
    },

    run(input) {
      const parsed = requestSchema.safeParse(input)
      if (!parsed.success) return Promise.resolve({ ok: false, error: 'chat' })
      const { chatId } = parsed.data
      // A pessoa trocou de conversa: a análise da anterior para e nunca chega a esta.
      for (const [other, job] of jobs) if (other !== chatId) job.abort.abort()
      // Um job já cancelado (A → B → A) não serve: abre outro.
      const running = jobs.get(chatId)
      if (running && !running.abort.signal.aborted) return running.done
      const abort = new AbortController()
      const job: Job = {
        abort,
        done: analyze(chatId, abort.signal)
          .catch((): WhatsAppInsightsResult => ({ ok: false, error: 'failed' }))
          .finally(() => {
            if (jobs.get(chatId) === job) jobs.delete(chatId)
          }),
      }
      jobs.set(chatId, job)
      return job.done
    },

    dispose() {
      for (const job of jobs.values()) job.abort.abort()
    },
  }
}
