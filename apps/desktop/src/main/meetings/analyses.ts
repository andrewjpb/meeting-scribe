// Análises de cada reunião em `userData/meetings/<id>.analyses.json` (contrato 19, CA5), ao lado da
// transcrição, do resumo e das anotações. Gravação atômica (arquivo temporário + `rename`) em fila, como os
// outros stores. Arquivo inválido ao ler vale como "sem análises".
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ANALYSES_MAX, ANALYSES_VERSION, type MeetingAnalysesFile, type MeetingAnalysis } from '../../shared/meeting-analysis'
import { meetingAnalysesFileSchema, meetingAnalysesSchema, meetingAnalysisSchema } from '../../shared/meeting-analysis-schema'
import { MEETINGS_DIR, transcriptPath } from './transcripts'

export const ANALYSES_SUFFIX = '.analyses.json'

/**
 * Conferência feita dentro da fila, logo antes de gravar: a reunião ainda existe? Uma exclusão que chegou
 * entre o pedido e a escrita não deixa arquivo órfão.
 */
export type WriteGuard = () => Promise<boolean>

export interface AnalysesStore {
  /**
   * Lista completa, da mais antiga para a mais nova; cada uma passa a ser desta reunião. Pedido inválido
   * lança. `null` quando o `guard` disse que a reunião não existe mais (nada é gravado).
   */
  save(meetingId: string, analyses: readonly MeetingAnalysis[], guard?: WriteGuard): Promise<MeetingAnalysis[] | null>
  /** Uma análise a mais no fim da lista (cheia: a mais antiga sai). `null` como no `save`. */
  add(meetingId: string, analysis: MeetingAnalysis, guard?: WriteGuard): Promise<MeetingAnalysis[] | null>
  /** Sem arquivo ou arquivo inválido: lista vazia. */
  get(meetingId: string): Promise<MeetingAnalysis[]>
  remove(meetingId: string): Promise<void>
}

/** Mesma regra de id da transcrição: nada de barra, ponto ou caminho relativo. */
export function analysesPath(dir: string, meetingId: string): string | null {
  return transcriptPath(dir, meetingId) ? join(dir, MEETINGS_DIR, `${meetingId}${ANALYSES_SUFFIX}`) : null
}

export function createFileAnalysesStore({ dir }: { dir: string }): AnalysesStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function read(meetingId: string): Promise<MeetingAnalysis[]> {
    const file = analysesPath(dir, meetingId)
    if (!file) return []
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const result = meetingAnalysesFileSchema.safeParse(parsed)
    // Análises de outra reunião copiadas por cima também não valem.
    if (!result.success || result.data.meetingId !== meetingId) {
      console.warn(`[analyses] ${file} inválido; a reunião fica sem análises`)
      return []
    }
    return result.data.analyses
  }

  async function write(meetingId: string, input: readonly MeetingAnalysis[]): Promise<MeetingAnalysis[]> {
    const file = analysesPath(dir, meetingId)
    if (!file) throw new Error('id de reunião inválido')
    const analyses = meetingAnalysesSchema.parse(input.map((analysis) => ({ ...analysis, meetingId })))
    const data: MeetingAnalysesFile = { version: ANALYSES_VERSION, meetingId, analyses }
    await mkdir(join(dir, MEETINGS_DIR), { recursive: true })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    return analyses
  }

  return {
    save: (meetingId, analyses, guard) =>
      serial(async () => {
        if (guard && !(await guard())) return null
        return write(meetingId, analyses)
      }),

    add: (meetingId, analysis, guard) =>
      serial(async () => {
        const one = meetingAnalysisSchema.parse(analysis)
        if (guard && !(await guard())) return null
        const current = (await read(meetingId)).filter((item) => item.id !== one.id)
        return write(meetingId, [...current, one].slice(-ANALYSES_MAX))
      }),

    get: (meetingId) => serial(() => read(meetingId)),

    remove: (meetingId) =>
      serial(async () => {
        const file = analysesPath(dir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }
}
