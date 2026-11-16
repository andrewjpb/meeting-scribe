// Anotações de cada reunião em `userData/meetings/<id>.notes.json` (contrato 13), ao lado da transcrição e
// do resumo. Gravação atômica (arquivo temporário + `rename`) em fila, como os outros stores. Arquivo
// inválido ao ler vale como "sem anotações": a tela abre vazia e o próximo salvar substitui o arquivo.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NOTES_MAX, NOTES_VERSION, type MeetingNote, type MeetingNotesFile } from '../../shared/meeting-notes'
import { meetingNotesFileSchema, meetingNotesSchema } from '../../shared/meeting-notes-schema'
import { MEETINGS_DIR, transcriptPath } from './transcripts'

export const NOTES_SUFFIX = '.notes.json'

export interface NotesStore {
  /** Lista completa, na ordem da tela; pedido inválido lança. */
  save(meetingId: string, notes: readonly MeetingNote[]): Promise<MeetingNote[]>
  /** Sem arquivo ou arquivo inválido: lista vazia. */
  get(meetingId: string): Promise<MeetingNote[]>
  remove(meetingId: string): Promise<void>
  /**
   * Contrato 23: acrescenta uma anotação (o post-it de um agente) na mesma vez da fila em que lê o arquivo: nada que
   * outro `save` gravou no meio se perde. Falso quando a lista já está cheia ou o id é inválido.
   */
  append(meetingId: string, note: MeetingNote): Promise<boolean>
}

export interface NotesStoreOptions {
  dir: string
  /**
   * Contrato 23: ids de anotações que o main acrescentou e a tela ainda não leu. Um `save` da tela (que manda a lista
   * inteira dela) não os apaga: os que estão no arquivo e faltam na lista entram de volta no fim.
   */
  keep?: (meetingId: string) => ReadonlySet<string>
}

/** Mesma regra de id da transcrição: nada de barra, ponto ou caminho relativo. */
export function notesPath(dir: string, meetingId: string): string | null {
  return transcriptPath(dir, meetingId) ? join(dir, MEETINGS_DIR, `${meetingId}${NOTES_SUFFIX}`) : null
}

export function createFileNotesStore({ dir, keep }: NotesStoreOptions): NotesStore {
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function write(file: string, meetingId: string, notes: MeetingNote[]): Promise<void> {
    const data: MeetingNotesFile = { version: NOTES_VERSION, meetingId, notes }
    await mkdir(join(dir, MEETINGS_DIR), { recursive: true })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  return {
    save: (meetingId, input) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
        if (!file) throw new Error('id de reunião inválido')
        let notes = meetingNotesSchema.parse(input)
        const kept = keep?.(meetingId)
        if (kept?.size) {
          const sent = new Set(notes.map((note) => note.id))
          const missing = (await read(meetingId)).filter((note) => kept.has(note.id) && !sent.has(note.id))
          if (missing.length) notes = meetingNotesSchema.parse([...notes, ...missing].slice(0, NOTES_MAX))
        }
        await write(file, meetingId, notes)
        return notes
      }),

    append: (meetingId, note) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
        if (!file) return false
        const current = await read(meetingId)
        if (current.length >= NOTES_MAX) return false
        await write(file, meetingId, meetingNotesSchema.parse([...current, note]))
        return true
      }),

    get: (meetingId) => serial(() => read(meetingId)),

    remove: (meetingId) =>
      serial(async () => {
        const file = notesPath(dir, meetingId)
        if (file) await rm(file, { force: true })
      }),
  }

  /** Sem arquivo ou arquivo inválido: lista vazia. Só de dentro da fila. */
  async function read(meetingId: string): Promise<MeetingNote[]> {
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
  }
}
