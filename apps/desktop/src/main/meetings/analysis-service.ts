// "Analisar até agora" e "Analisar a reunião inteira" (contrato 19). Uma execução curta pelo mesmo motor do
// resumo (`claude-one-shot.ts`), só com o clique da pessoa, nunca sozinha. Na gravação o pedido traz tudo o
// que ainda está só no renderer (trechos finais, anotações e as análises anteriores) e a resposta volta para
// ele, sem nada gravado: as análises são salvas com a reunião, ao encerrar. Depois da reunião, o main lê a
// transcrição, as anotações e as análises salvas e grava a nova junto. A gravação, a transcrição e a fila da
// tradução não esperam por nada daqui: é outro processo, e o pedido responde quando a análise acaba.
// Sem Electron: `claude`, clipboard e pastas chegam injetados.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import { analyzedUntil, ANALYSES_MAX, ANALYSIS_TEXT_MAX, recentAnalyses, type AnalysisRunResult, type LiveAnalysisRequest, type LiveAnalysisSegment, type MeetingAnalysis } from '../../shared/meeting-analysis'
import { liveAnalysisRequestSchema, meetingAnalysesSchema, meetingAnalysisSchema } from '../../shared/meeting-analysis-schema'
import { CLAUDE_MODEL_PREFIX } from '../../shared/settings-defaults'
import { analysisInput, analysisLines, analysisNoteLines, analysisParser, analysisSystemPrompt, ANALYSIS_TIMEOUT_MS, previousAnalysisLines } from '../claude-cli/analysis'
import { ACP_ANALYSIS_DIR } from '../claude-cli/service'
import type { AnalysesStore } from './analyses'
import { runClaudeOneShot, type OneShotEngine } from './claude-one-shot'
import type { NotesStore } from './notes'
import type { ClipboardWriter } from './service'
import type { MeetingsStore } from './store'
import type { TranscriptStore } from './transcripts'

export interface AnalysisServiceDeps extends OneShotEngine {
  meetings: Pick<MeetingsStore, 'get'>
  transcripts: Pick<TranscriptStore, 'get'>
  notes?: Pick<NotesStore, 'get'> | undefined
  analyses: AnalysesStore
  /** O mesmo `locate` do tradutor e do resumo. */
  locate: () => Promise<ClaudeLocateResult>
  clipboard: ClipboardWriter
  now?: () => number
  newId?: () => string
  timeoutMs?: number
  /** Contrato 24: mensagens do dia da conversa do WhatsApp ligada (só na análise da reunião inteira, com a opção ligada). */
  whatsappMaterial?: (meetingId: string) => Promise<string[]>
  /** As análises gravadas de uma reunião mudaram (o detalhe aberto relê). */
  onChange?: (meetingId: string) => void
}

export interface AnalysisService {
  /** Uma análise; responde quando ela acaba (ou falha). Depois da reunião, a nova já vem salva. */
  run(request: unknown): Promise<AnalysisRunResult>
  /** Análises salvas da reunião, da mais antiga para a mais nova; reunião que não existe: lista vazia. */
  list(meetingId: unknown): Promise<MeetingAnalysis[]>
  /** Encerrar a gravação: as análises da memória passam a ser da reunião criada. Falso se ela não existe. */
  save(request: unknown): Promise<boolean>
  /** Uma análise da gravação que terminou depois do "Encerrar": entra na reunião já criada. */
  add(request: unknown): Promise<boolean>
  /** "Copiar" de um item: o texto na área de transferência. */
  copy(request: unknown): Promise<boolean>
  /** Excluir a reunião: cancela a análise em curso dela e apaga o arquivo. */
  remove(meetingId: string): Promise<void>
  /** Sair do app: mata o processo de toda análise em curso. */
  dispose(): void
}

const meetingIdSchema = z.string().min(1).max(200)
const runSchema = z.union([z.object({ live: z.unknown() }).strict(), z.object({ meetingId: meetingIdSchema }).strict()])
const saveSchema = z.object({ meetingId: meetingIdSchema, analyses: z.unknown() }).strict()
const addSchema = z.object({ meetingId: meetingIdSchema, analysis: z.unknown() }).strict()
const copySchema = z.object({ text: z.string().trim().min(1).max(ANALYSIS_TEXT_MAX * 2 + 10) }).strict()

/** Chave da análise em curso de uma gravação (`live:<id da gravação>`); a da reunião é o id dela. */
const LIVE_PREFIX = '\u0000gravacao:'

interface Job {
  abort: AbortController
  done: Promise<AnalysisRunResult>
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const jobs = new Map<string, Job>()

  const segmentsOf = async (meetingId: string): Promise<LiveAnalysisSegment[]> => {
    const document = await deps.transcripts.get(meetingId).catch(() => null)
    return (document?.segments ?? []).map(({ source, speaker, startMs, endMs, text }) => ({ source, speaker, startMs, endMs, text }))
  }

  async function analyze(request: LiveAnalysisRequest, meetingId: string | null, signal: AbortSignal): Promise<AnalysisRunResult> {
    const lines = analysisLines(request.segments)
    if (!lines.length) return { ok: false, error: 'empty' }
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    if (!found.ok) return { ok: false, error: 'not-found' }
    // Só as mais recentes vão no pedido: ele não cresce sem fim.
    const previous = previousAnalysisLines(recentAnalyses(request.previous))
    const whatsappLines = meetingId ? ((await deps.whatsappMaterial?.(meetingId).catch(() => [])) ?? []) : []
    const startedAt = now()
    const { result, model } = await runClaudeOneShot(deps, {
      claudePath: found.path,
      purpose: 'analysis',
      acpDir: ACP_ANALYSIS_DIR,
      systemPrompt: analysisSystemPrompt(),
      parse: analysisParser(previous.refs),
      input: analysisInput(lines, analysisNoteLines(request.notes), previous.lines, whatsappLines),
      label: 'análise',
      timeoutMs: deps.timeoutMs ?? ANALYSIS_TIMEOUT_MS,
      signal,
    })
    if (!result.ok) return result
    const analysis: MeetingAnalysis = {
      id: newId(),
      meetingId,
      createdAt: new Date(now()).toISOString(),
      atMs: Math.round(request.atMs),
      model: `${CLAUDE_MODEL_PREFIX}${model}`,
      costUsd: result.costUsd,
      durationMs: Math.round(result.durationMs ?? now() - startedAt),
      ...result.content,
    }
    return { ok: true, analysis }
  }

  /** Conferência dentro da fila de escrita, logo antes de gravar. */
  const exists = (meetingId: string) => async (): Promise<boolean> => (await deps.meetings.get(meetingId).catch(() => null)) !== null

  /** Uma por chave: o mesmo pedido repetido enquanto gera recebe a mesma resposta. */
  function start(key: string, task: (signal: AbortSignal) => Promise<AnalysisRunResult>): Promise<AnalysisRunResult> {
    const running = jobs.get(key)
    if (running) return running.done
    const abort = new AbortController()
    const job: Job = {
      abort,
      done: task(abort.signal)
        .catch((): AnalysisRunResult => ({ ok: false, error: 'failed' }))
        .finally(() => {
          if (jobs.get(key) === job) jobs.delete(key)
        }),
    }
    jobs.set(key, job)
    return job.done
  }

  return {
    async run(input) {
      const request = runSchema.parse(input)
      if ('live' in request) {
        const live = liveAnalysisRequestSchema.parse(request.live)
        const key = `${LIVE_PREFIX}${live.recordingId}`
        // Outra gravação pediu: a análise que ainda gerava para a anterior é cancelada e nunca chega a esta.
        for (const [other, job] of jobs) if (other.startsWith(LIVE_PREFIX) && other !== key) job.abort.abort()
        if (live.previous.length >= ANALYSES_MAX) return { ok: false, error: 'limit' }
        return start(key, (signal) => analyze(live, null, signal))
      }
      const { meetingId } = request
      return start(meetingId, async (signal) => {
        const meeting = await deps.meetings.get(meetingId)
        if (!meeting) return { ok: false, error: 'failed' }
        const [segments, notes, previous] = await Promise.all([segmentsOf(meetingId), deps.notes?.get(meetingId).catch(() => []) ?? [], deps.analyses.get(meetingId).catch(() => [])])
        if (previous.length >= ANALYSES_MAX) return { ok: false, error: 'limit' }
        // "Até" é o fim do último trecho analisado, como na gravação.
        const result = await analyze({ recordingId: meetingId, atMs: analyzedUntil(segments), segments, notes, previous }, meetingId, signal)
        if (!result.ok) return result
        // Reunião excluída enquanto gerava: a análise não fica órfã (a conferência se repete dentro da fila).
        if (signal.aborted) return { ok: false, error: 'failed' }
        try {
          const saved = await deps.analyses.add(meetingId, result.analysis, exists(meetingId))
          if (!saved) return { ok: false, error: 'failed' }
        } catch {
          return { ok: false, error: 'failed' }
        }
        deps.onChange?.(meetingId)
        return result
      })
    },

    async list(input) {
      const meetingId = meetingIdSchema.safeParse(input)
      if (!meetingId.success || !(await deps.meetings.get(meetingId.data))) return []
      return deps.analyses.get(meetingId.data)
    },

    async save(input) {
      const { meetingId, analyses } = saveSchema.parse(input)
      const list = meetingAnalysesSchema.parse(analyses)
      if (!(await deps.analyses.save(meetingId, list, exists(meetingId)))) return false
      deps.onChange?.(meetingId)
      return true
    },

    async add(input) {
      const { meetingId, analysis } = addSchema.parse(input)
      const one = meetingAnalysisSchema.parse(analysis)
      if (!(await deps.analyses.add(meetingId, one, exists(meetingId)))) return false
      deps.onChange?.(meetingId)
      return true
    },

    async copy(input) {
      const parsed = copySchema.safeParse(input)
      if (!parsed.success) return false
      try {
        deps.clipboard.writeText(parsed.data.text)
        return true
      } catch {
        return false
      }
    },

    async remove(meetingId) {
      const job = jobs.get(meetingId)
      if (job) {
        job.abort.abort()
        await job.done
      }
      await deps.analyses.remove(meetingId)
    },

    dispose() {
      for (const job of jobs.values()) job.abort.abort()
    },
  }
}
