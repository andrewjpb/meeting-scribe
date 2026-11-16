// Resumo de cada reunião em `userData/meetings/<id>.summary.json` (contrato 08), ao lado da transcrição.
// Gravação atômica (arquivo temporário + `rename`) em fila, como os outros stores. Arquivo inválido ao ler
// vale como "sem resumo": a tela mostra "Gerar resumo" e gerar de novo substitui o arquivo.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MeetingSummary } from '../../shared/meeting-summary'
import { meetingSummarySchema } from '../../shared/meeting-summary-schema'
import { MEETINGS_DIR, transcriptPath } from './transcripts'

export const SUMMARY_SUFFIX = '.summary.json'

export interface SummaryStore {
  save(summary: MeetingSummary): Promise<void>
  get(meetingId: string): Promise<MeetingSummary | null>
  remove(meetingId: string): Promise<void>
}

/** Mesma regra de id da transcrição: nada de barra, ponto ou caminho relativo. */
export function summaryPath(dir: string, meetingId: string): string | null {
  return transcriptPath(dir, meetingId) ? join(dir, MEETINGS_DIR, `${meetingId}${SUMMARY_SUFFIX}`) : null
}

export function createFileSummaryStore({ dir }: { dir: string }): SummaryStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    save: (summary) =>
      serial(async () => {
        const data = meetingSummarySchema.parse(summary)
        const file = summaryPath(dir, data.meetingId)
        if (!file) throw new Error('id de reunião inválido')
        await mkdir(join(dir, MEETINGS_DIR), { recursive: true })
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
      }),

    get: (meetingId) =>
      serial(async () => {
        const file = summaryPath(dir, meetingId)
        if (!file) return null
        let raw: string
        try {
          raw = await readFile(file, 'utf8')
        } catch {
          return null
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = undefined
        }
        const result = meetingSummarySchema.safeParse(parsed)
        // Resumo de outra reunião copiado por cima também não vale.
        if (!result.success || result.data.meetingId !== meetingId) {
          console.warn(`[summaries] ${file} inválido; a reunião fica sem resumo`)
          return null
        }
        return result.data
      }),

    remove: (meetingId) =>
      serial(async () => {
        const file = summaryPath(dir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }
}
