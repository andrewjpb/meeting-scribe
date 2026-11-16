// Transcrição de cada reunião em `userData/meetings/<id>.json`, separada do registro da lista
// (`meetings.json`). Gravação atômica (arquivo temporário + `rename`) em fila, como os outros stores.
// Arquivo inválido não some: vira `.corrupt-<timestamp>` e a leitura devolve `null`.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { LANGUAGE_CODES } from '../../shared/settings-defaults'
import { TRANSCRIPT_VERSION, type TranscriptDocument } from '../../shared/transcription'

export const MEETINGS_DIR = 'meetings'

const segmentSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['mic', 'system']),
  speaker: z.string().nullable(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  translation: z.string().nullable(),
  translationModel: z.string().nullable(),
})

const documentSchema = z.object({
  version: z.literal(TRANSCRIPT_VERSION),
  meetingId: z.string().min(1),
  sourceLanguage: z.enum(LANGUAGE_CODES),
  targetLanguage: z.enum(LANGUAGE_CODES).nullable(),
  translationModel: z.string().nullable(),
  segments: z.array(segmentSchema),
})

const idSchema = z.string().min(1).max(200)

export interface TranscriptStore {
  save(document: TranscriptDocument): Promise<void>
  get(meetingId: string): Promise<TranscriptDocument | null>
  remove(meetingId: string): Promise<void>
}

export interface FileTranscriptStoreOptions {
  dir: string
  now?: () => number
}

/** Só ids simples viram nome de arquivo: nada de barra, ponto ou caminho relativo. */
export function transcriptPath(dir: string, meetingId: string): string | null {
  const id = idSchema.safeParse(meetingId)
  if (!id.success || !/^[\w-]+$/.test(id.data)) return null
  return join(dir, MEETINGS_DIR, `${id.data}.json`)
}

export function createFileTranscriptStore({ dir, now = Date.now }: FileTranscriptStoreOptions): TranscriptStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    save: (document) =>
      serial(async () => {
        const data = documentSchema.parse(document)
        const file = transcriptPath(dir, data.meetingId)
        if (!file) throw new Error('id de reunião inválido')
        await mkdir(join(dir, MEETINGS_DIR), { recursive: true })
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
      }),

    get: (meetingId) =>
      serial(async () => {
        const file = transcriptPath(dir, meetingId)
        if (!file) return null
        let raw: string
        try {
          raw = await readFile(file, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
        const parsed = documentSchema.safeParse((() => {
          try {
            return JSON.parse(raw)
          } catch {
            return undefined
          }
        })())
        if (parsed.success) return parsed.data
        const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
        await rename(file, `${file}.corrupt-${stamp}`).catch(() => undefined)
        console.warn(`[transcripts] ${file} inválido; guardado como .corrupt-${stamp}`)
        return null
      }),

    remove: (meetingId) =>
      serial(async () => {
        const file = transcriptPath(dir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }
}
