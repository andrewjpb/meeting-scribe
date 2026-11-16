// Anotações de cada reunião em `userData/meetings/<id>.notes.json` (contrato 13), ao lado da transcrição e
// do resumo. Gravação atômica (arquivo temporário + `rename`) em fila, como os outros stores. Arquivo
// inválido ao ler vale como "sem anotações": a tela abre vazia e o próximo salvar substitui o arquivo.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NOTES_VERSION, type MeetingNote, type MeetingNotesFile } from '../../shared/meeting-notes'
import { meetingNotesFileSchema, meetingNotesSchema } from '../../shared/meeting-notes-schema'
import { MEETINGS_DIR, transcriptPath } from './transcripts'

export const NOTES_SUFFIX = '.notes.json'

export interface NotesStore {
  /** Lista completa, na ordem da tela; pedido inválido lança. */
  save(meetingId: string, notes: readonly MeetingNote[]): Promise<MeetingNote[]>
  /** Sem arquivo ou arquivo inválido: lista vazia. */
  get(meetingId: string): Promise<MeetingNote[]>
  remove(meetingId: string): Promise<void>
}

/** Mesma regra de id da transcrição: nada de barra, ponto ou caminho relativo. */
export function notesPath(dir: string, meetingId: string): string | null {
  return transcriptPath(dir, meetingId) ? join(dir, MEETINGS_DIR, `${meetingId}${NOTES_SUFFIX}`) : null
}

export function createFileNotesStore({ dir }: { dir: string }): NotesStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    save: (meetingId, input) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
        if (!file) throw new Error('id de reunião inválido')
        const notes = meetingNotesSchema.parse(input)
        const data: MeetingNotesFile = { version: NOTES_VERSION, meetingId, notes }
        await mkdir(join(dir, MEETINGS_DIR), { recursive: true })
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
        return notes
      }),

    get: (meetingId) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
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
        const result = meetingNotesFileSchema.safeParse(parsed)
        // Anotações de outra reunião copiadas por cima também não valem.
        if (!result.success || result.data.meetingId !== meetingId) {
          console.warn(`[notes] ${file} inválido; a reunião fica sem anotações`)
          return []
        }
        return result.data.notes
      }),

    remove: (meetingId) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }
}
