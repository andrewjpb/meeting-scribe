// Reuniões locais em `userData/meetings.json`, até existir servidor. Cada operação lê o arquivo,
// valida com zod e regrava de forma atômica (arquivo temporário + `rename`); as operações entram
// numa fila, então duas chamadas seguidas nunca se atropelam. Arquivo que não passa na validação é
// guardado como `meetings.json.corrupt-<timestamp>` e a lista recomeça vazia.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { defaultMeetingTitle, MEETING_TITLE_MAX, type Meeting, type MeetingFilePaths, type NewMeeting } from '../../shared/meetings'

export const MEETINGS_FILE = 'meetings.json'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const title = z.string().trim().min(1).max(MEETING_TITLE_MAX)
/** Caminho de arquivo gravado pelo main. Registro antigo, sem o campo, carrega com `null`. */
const filePath = z.string().min(1).max(4096).nullable().default(null)

/** Participantes do evento da agenda (contrato 12 grava; o 10 mostra). Registro antigo vem sem o campo. */
export const CALENDAR_ATTENDEES_MAX = 50
const calendarText = z.string().max(200)
const calendarSchema = z.object({
  attendees: z.array(z.object({ name: calendarText, email: calendarText })).max(CALENDAR_ATTENDEES_MAX),
})

const meetingSchema = z.object({
  id: z.string().min(1),
  title,
  startedAt: isoDate,
  durationMs: z.number().int().nonnegative(),
  sources: z.object({ mic: z.boolean(), system: z.boolean() }),
  audioPath: filePath,
  transcriptPath: filePath,
  // Opcional e `null`: um `rename` relê e regrava o registro sem perder o evento.
  calendar: calendarSchema.nullable().optional(),
})

const fileSchema = z.object({ version: z.literal(1), meetings: z.array(meetingSchema) })

const newMeetingSchema = z.object({
  // Título vazio cai no padrão de N4.
  title: z.string().trim().max(MEETING_TITLE_MAX),
  startedAt: isoDate,
  durationMs: z.number().nonnegative().transform(Math.round),
  sources: z.object({ mic: z.boolean(), system: z.boolean() }),
})

const idSchema = z.string().min(1)

/** Interface que a interface do app usa; o servidor troca esta implementação depois. */
export interface MeetingsStore {
  list(): Promise<Meeting[]>
  get(id: string): Promise<Meeting | null>
  create(input: NewMeeting): Promise<Meeting>
  rename(id: string, title: string): Promise<Meeting | null>
  remove(id: string): Promise<boolean>
  /** Só para o main, ao encerrar com "Salvar áudio e transcrição numa pasta" ligado (contrato 07). */
  setFiles(id: string, files: MeetingFilePaths): Promise<Meeting | null>
}

export interface FileMeetingsStoreOptions {
  dir: string
  now?: () => number
  newId?: () => string
}

const byStartedAtDesc = (a: Meeting, b: Meeting): number => Date.parse(b.startedAt) - Date.parse(a.startedAt)

export function createFileMeetingsStore({ dir, now = Date.now, newId = randomUUID }: FileMeetingsStoreOptions): MeetingsStore {
  const file = join(dir, MEETINGS_FILE)
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function read(): Promise<Meeting[]> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const result = fileSchema.safeParse(parsed)
    if (result.success) return result.data.meetings
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    await rename(file, `${file}.corrupt-${stamp}`)
    console.warn(`[meetings] ${MEETINGS_FILE} inválido; guardado como ${MEETINGS_FILE}.corrupt-${stamp}`)
    return []
  }

  async function write(meetings: Meeting[]): Promise<void> {
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify({ version: 1, meetings }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  return {
    list: () => serial(async () => (await read()).sort(byStartedAtDesc)),

    get: (id) => serial(async () => (await read()).find((meeting) => meeting.id === idSchema.parse(id)) ?? null),

    create: (input) =>
      serial(async () => {
        const data = newMeetingSchema.parse(input)
        const meeting: Meeting = {
          id: newId(),
          title: data.title || defaultMeetingTitle(new Date(data.startedAt)),
          startedAt: new Date(data.startedAt).toISOString(),
          durationMs: data.durationMs,
          sources: { mic: data.sources.mic, system: data.sources.system },
          audioPath: null,
          transcriptPath: null,
        }
        await write([...(await read()), meeting])
        return meeting
      }),

    rename: (id, newTitle) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const value = title.parse(newTitle)
        const meetings = await read()
        const found = meetings.find((meeting) => meeting.id === key)
        if (!found) return null
        found.title = value
        await write(meetings)
        return found
      }),

    setFiles: (id, files) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const meetings = await read()
        const found = meetings.find((meeting) => meeting.id === key)
        if (!found) return null
        found.audioPath = files.audioPath
        found.transcriptPath = files.transcriptPath
        await write(meetings)
        return found
      }),

    remove: (id) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const meetings = await read()
        const rest = meetings.filter((meeting) => meeting.id !== key)
        if (rest.length === meetings.length) return false
        await write(rest)
        return true
      }),
  }
}
