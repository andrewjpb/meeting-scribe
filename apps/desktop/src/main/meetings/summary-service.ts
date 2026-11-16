// Resumo da reunião (contrato 08, CA4 e CA6): o que a aba "Resumo" e o fim da gravação pedem ao main.
// Gera em segundo plano (quem pede recebe o estado na hora e o resultado chega por `onStatus`), um resumo
// por reunião por vez: pedido repetido enquanto gera é ignorado. Ao encerrar a gravação (`auto`), só
// gera com "Resumir ao encerrar" ligado e o `claude` encontrado; senão nada acontece, nem aviso. Pedido
// pela tela, a falta do `claude` vira o erro `not-found`. Sem Electron: `claude`, clipboard e pasta
// chegam injetados.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import type { Meeting } from '../../shared/meetings'
import { summaryMarkdown, SUMMARY_VERSION, type MeetingSummary, type SummaryError, type SummaryStatus } from '../../shared/meeting-summary'
import { CLAUDE_MODEL_PREFIX } from '../../shared/settings-defaults'
import type { TranscriptCopyResult } from '../../shared/transcription'
import { claudeEnv } from '../claude-cli/locate'
import { CLAUDE_CWD_DIR } from '../claude-cli/service'
import { runSummary, summaryInput, summaryLines, type SpawnSummary } from '../claude-cli/summary'
import type { Timers } from '../claude-cli/translator'
import type { SettingsStore } from '../settings/store'
import type { ClipboardWriter } from './service'
import type { MeetingsStore } from './store'
import type { SummaryStore } from './summaries'
import type { TranscriptStore } from './transcripts'

export interface SummaryServiceDeps {
  settings: Pick<SettingsStore, 'get'>
  meetings: Pick<MeetingsStore, 'get'>
  transcripts: Pick<TranscriptStore, 'get'>
  summaries: SummaryStore
  /** O mesmo `locate` do tradutor: caminho configurado, lista fixa e shell de login. */
  locate: () => Promise<ClaudeLocateResult>
  spawn: SpawnSummary
  userData: string
  baseEnv: NodeJS.ProcessEnv
  clipboard: ClipboardWriter
  /** Resumo pronto: cópia em `<nome> - resumo.md` na pasta da reunião, quando houver (CA8). */
  writeToFolder: (meeting: Meeting, summary: MeetingSummary) => Promise<unknown>
  /** Estado novo de uma reunião, para todas as janelas. */
  onStatus: (meetingId: string, status: SummaryStatus) => void
  log?: (message: string) => void
  now?: () => number
  timers?: Timers
  timeoutMs?: number
}

export interface SummaryService {
  status(meetingId: unknown): Promise<SummaryStatus>
  /** Começa a gerar (ou ignora, se já está gerando) e devolve o estado na hora. */
  generate(request: unknown): Promise<SummaryStatus>
  copy(meetingId: unknown): Promise<TranscriptCopyResult>
  /** Excluir a reunião: apaga o `summary.json` interno e esquece o estado dela. */
  remove(meetingId: string): Promise<void>
  /** Teste: termina quando a geração em curso daquela reunião acabar e o estado novo for anunciado. */
  settled(meetingId: string): Promise<void>
  /** Sair do app: mata o processo de todo resumo em curso (SIGTERM e, se não sair em 2 s, SIGKILL). */
  dispose(): void
}

const meetingIdSchema = z.string().min(1).max(200)
const generateSchema = z.object({ meetingId: meetingIdSchema, auto: z.boolean().optional() }).strict()

interface Job {
  /** Ao encerrar a gravação: sem `claude`, nada acontece. Um pedido pela tela no meio vira manual. */
  auto: boolean
  /** Já anunciado como "gerando" (no automático, só depois de achar o `claude`). */
  visible: boolean
  /** Reunião excluída ou app saindo: nada mais é escrito e o processo morre. */
  cancelled: boolean
  abort: AbortController
  done: Promise<void>
}

export function createSummaryService(deps: SummaryServiceDeps): SummaryService {
  const now = deps.now ?? Date.now
  const jobs = new Map<string, Job>()
  /** Último erro de cada reunião nesta execução do app (não vai para o disco). */
  const errors = new Map<string, SummaryError>()

  const lines = async (meetingId: string): Promise<string[]> => {
    const document = await deps.transcripts.get(meetingId).catch(() => null)
    return document ? summaryLines(document) : []
  }

  async function status(meetingId: string): Promise<SummaryStatus> {
    if (jobs.get(meetingId)?.visible) return { state: 'generating' }
    const summary = await deps.summaries.get(meetingId).catch(() => null)
    const error = errors.get(meetingId)
    if (error) return { state: 'error', error, summary }
    if (summary) return { state: 'ready', summary }
    return (await lines(meetingId)).length ? { state: 'none' } : { state: 'empty' }
  }

  const announce = async (meetingId: string): Promise<void> => {
    deps.onStatus(meetingId, await status(meetingId))
  }

  const cancel = (job: Job): void => {
    job.cancelled = true
    job.abort.abort()
  }

  async function run(meetingId: string, input: readonly string[], job: Job): Promise<void> {
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    if (job.cancelled) return
    if (!found.ok) {
      if (job.auto) return
      errors.set(meetingId, 'not-found')
      return
    }
    if (!job.visible) {
      job.visible = true
      errors.delete(meetingId)
      deps.onStatus(meetingId, { state: 'generating' })
    }
    const { claudeModel } = await deps.settings.get()
    const cwd = join(deps.userData, CLAUDE_CWD_DIR)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const result = await runSummary({
      binaryPath: found.path,
      model: claudeModel,
      cwd,
      env: claudeEnv(deps.baseEnv, found.path),
      spawn: deps.spawn,
      input: summaryInput(input),
      ...(deps.timers ? { timers: deps.timers } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      ...(deps.log ? { log: deps.log } : {}),
      signal: job.abort.signal,
    })
    if (job.cancelled) return
    if (!result.ok) {
      errors.set(meetingId, result.error)
      return
    }
    // Reunião excluída enquanto gerava: o resumo não fica órfão. A checagem se repete antes de cada escrita.
    const meeting = await deps.meetings.get(meetingId)
    if (!meeting || job.cancelled) return
    const summary: MeetingSummary = {
      version: SUMMARY_VERSION,
      meetingId,
      createdAt: new Date(now()).toISOString(),
      model: `${CLAUDE_MODEL_PREFIX}${claudeModel}`,
      ...result.content,
    }
    try {
      await deps.summaries.save(summary)
    } catch {
      errors.set(meetingId, 'failed')
      return
    }
    errors.delete(meetingId)
    const settings = await deps.settings.get()
    if (!settings.saveToFolder || job.cancelled || !(await deps.meetings.get(meetingId))) return
    await deps.writeToFolder(meeting, summary).catch(() => undefined)
  }

  return {
    status: async (meetingId) => status(meetingIdSchema.parse(meetingId)),

    async generate(request) {
      const { meetingId, auto = false } = generateSchema.parse(request)
      const running = jobs.get(meetingId)
      if (running) {
        // O automático ainda procurando o `claude`: o pedido pela tela assume o mesmo trabalho.
        if (!auto && !running.visible) {
          running.auto = false
          running.visible = true
          errors.delete(meetingId)
        }
        return running.visible ? { state: 'generating' } : status(meetingId)
      }
      if (auto && !(await deps.settings.get()).summarizeOnStop) return status(meetingId)
      if (!(await deps.meetings.get(meetingId))) return { state: 'none' }
      const input = await lines(meetingId)
      if (!input.length) return { state: 'empty' }

      // Pedido pela tela: "gerando" na hora. Automático: só depois de achar o `claude`.
      const job: Job = { auto, visible: !auto, cancelled: false, abort: new AbortController(), done: Promise.resolve() }
      jobs.set(meetingId, job)
      if (job.visible) errors.delete(meetingId)
      job.done = run(meetingId, input, job)
        .catch(() => {
          errors.set(meetingId, 'failed')
        })
        .then(async () => {
          if (jobs.get(meetingId) === job) jobs.delete(meetingId)
          // Cancelado não anuncia nada; o automático que não achou o `claude` nunca apareceu.
          if (!job.cancelled && (job.visible || errors.has(meetingId))) await announce(meetingId).catch(() => undefined)
        })
      return job.visible ? { state: 'generating' } : status(meetingId)
    },

    async copy(input) {
      const meetingId = meetingIdSchema.parse(input)
      const meeting = await deps.meetings.get(meetingId)
      const summary = meeting ? await deps.summaries.get(meetingId) : null
      if (!meeting || !summary) return 'missing'
      try {
        deps.clipboard.writeText(summaryMarkdown(meeting, summary))
        return 'copied'
      } catch {
        return 'failed'
      }
    },

    async remove(meetingId) {
      // Geração em curso: o processo morre e nada mais é gravado; o arquivo só é apagado depois que ela parou.
      const job = jobs.get(meetingId)
      if (job) {
        cancel(job)
        await job.done
      }
      errors.delete(meetingId)
      await deps.summaries.remove(meetingId)
    },

    settled: (meetingId) => jobs.get(meetingId)?.done ?? Promise.resolve(),

    dispose() {
      for (const job of jobs.values()) cancel(job)
    },
  }
}
