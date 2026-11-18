// Reuniões locais em `userData/meetings.json`, até existir servidor. Cada operação lê o arquivo,
// valida com zod e regrava de forma atômica (arquivo temporário + `rename`); as operações entram
// numa fila, então duas chamadas seguidas nunca se atropelam. Arquivo que não passa na validação é
// guardado como `meetings.json.corrupt-<timestamp>` e a lista recomeça vazia.
// Pastas (contrato 28): no mesmo arquivo, campo `folders` opcional (arquivo antigo carrega sem ele, `version`
// continua 1); a reunião guarda só o `folderId`. Excluir a pasta tira as reuniões dela, nunca as apaga.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { defaultMeetingTitle, FOLDER_NAME_MAX, MEETING_TITLE_MAX, type Meeting, type MeetingCalendar, type MeetingFilePaths, type MeetingFolder, type NewMeeting } from '../../shared/meetings'

export const MEETINGS_FILE = 'meetings.json'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const title = z.string().trim().min(1).max(MEETING_TITLE_MAX)
/** Caminho de arquivo gravado pelo main. Registro antigo, sem o campo, carrega com `null`. */
const filePath = z.string().min(1).max(4096).nullable().default(null)

/**
 * Evento da agenda (contrato 12 grava; o 10 mostra os participantes). Registro antigo vem sem o campo; os do
 * contrato 10, só com os participantes.
 */
export const CALENDAR_ATTENDEES_MAX = 50
const calendarText = z.string().max(200)
const calendarSchema = z.object({
  provider: z.enum(['google', 'microsoft']).optional(),
  eventId: z.string().min(1).max(1024).optional(),
  title: calendarText.optional(),
  start: isoDate.optional(),
  end: isoDate.optional(),
  attendees: z.array(z.object({ name: calendarText, email: calendarText })).max(CALENDAR_ATTENDEES_MAX),
  joinUrl: z.string().max(2048).nullable().optional(),
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
  // Contrato 28: mesmo cuidado do `calendar` (rename/setFiles relêem e regravam sem perder a pasta).
  folderId: z.string().min(1).nullable().optional(),
})

/** Nome de pasta: sem espaço nas pontas, cortado em 60; vazio não vale. */
const folderName = z
  .string()
  .transform((value) => value.trim().slice(0, FOLDER_NAME_MAX).trim())
  .pipe(z.string().min(1))
const folderSchema = z.object({ id: z.string().min(1), name: folderName })

/**
 * Pastas na leitura: lenientes. Pasta inválida (nome vazio, sem id) ou repetida é descartada, sem reprovar o arquivo;
 * reunião nenhuma se perde por causa de pasta. A próxima gravação já sai sem ela.
 */
const foldersOnRead = z
  .unknown()
  .optional()
  .transform((value): MeetingFolder[] => {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const folders: MeetingFolder[] = []
    for (const item of value) {
      const parsed = folderSchema.safeParse(item)
      if (!parsed.success || seen.has(parsed.data.id)) continue
      seen.add(parsed.data.id)
      folders.push(parsed.data)
    }
    return folders
  })

const fileSchema = z.object({ version: z.literal(1), meetings: z.array(meetingSchema), folders: foldersOnRead })

interface MeetingsFile {
  meetings: Meeting[]
  folders: MeetingFolder[]
}

const newMeetingSchema = z.object({
  // Título vazio cai no padrão de N4.
  title: z.string().trim().max(MEETING_TITLE_MAX),
  startedAt: isoDate,
  durationMs: z.number().nonnegative().transform(Math.round),
  sources: z.object({ mic: z.boolean(), system: z.boolean() }),
})

const idSchema = z.string().min(1)

/** Payloads dos canais de pastas (contrato 28), validados no `registerIpc` antes de chegar ao store. */
const folderNameInput = z.string().max(1000)
export const folderCreateSchema = z.object({ name: folderNameInput })
export const folderRenameSchema = z.object({ id: idSchema.max(200), name: folderNameInput })
export const folderIdSchema = z.object({ id: idSchema.max(200) })
export const meetingMoveSchema = z.object({ id: idSchema.max(200), folderId: idSchema.max(200).nullable() })

/** Interface que a interface do app usa; o servidor troca esta implementação depois. */
export interface MeetingsStore {
  list(): Promise<Meeting[]>
  get(id: string): Promise<Meeting | null>
  /** `calendar`: o evento da agenda da gravação (contrato 12), decidido no main; o renderer não manda. */
  create(input: NewMeeting, extra?: { calendar?: MeetingCalendar | null }): Promise<Meeting>
  rename(id: string, title: string): Promise<Meeting | null>
  remove(id: string): Promise<boolean>
  /** Só para o main, ao encerrar com "Salvar áudio e transcrição numa pasta" ligado (contrato 07). */
  setFiles(id: string, files: MeetingFilePaths): Promise<Meeting | null>
  /** Pastas (contrato 28), na ordem em que foram criadas. */
  folders(): Promise<MeetingFolder[]>
  /** Nome vazio (depois do `trim`) não cria pasta: `null`. */
  createFolder(name: string): Promise<MeetingFolder | null>
  renameFolder(id: string, name: string): Promise<MeetingFolder | null>
  /** As reuniões da pasta ficam fora de pasta; nenhuma é apagada. */
  deleteFolder(id: string): Promise<boolean>
  /** `folderId` `null` tira da pasta; pasta inexistente recusa com `null`. */
  move(id: string, folderId: string | null): Promise<Meeting | null>
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

  async function load(): Promise<MeetingsFile> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { meetings: [], folders: [] }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const result = fileSchema.safeParse(parsed)
    if (result.success) return { meetings: result.data.meetings, folders: result.data.folders }
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    await rename(file, `${file}.corrupt-${stamp}`)
    console.warn(`[meetings] ${MEETINGS_FILE} inválido; guardado como ${MEETINGS_FILE}.corrupt-${stamp}`)
    return { meetings: [], folders: [] }
  }

  async function save({ meetings, folders }: MeetingsFile): Promise<void> {
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    // Sem pasta nenhuma, o arquivo fica como era antes do contrato 28.
    const body = folders.length ? { version: 1, meetings, folders } : { version: 1, meetings }
    await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  /** Só as reuniões; quem regrava assim mantém as pastas como estão. */
  async function read(): Promise<Meeting[]> {
    return (await load()).meetings
  }

  async function write(meetings: Meeting[]): Promise<void> {
    await save({ meetings, folders: (await load()).folders })
  }

  return {
    list: () => serial(async () => (await read()).sort(byStartedAtDesc)),

    get: (id) => serial(async () => (await read()).find((meeting) => meeting.id === idSchema.parse(id)) ?? null),

    create: (input, extra) =>
      serial(async () => {
        const data = newMeetingSchema.parse(input)
        const calendar = extra?.calendar ? calendarSchema.parse(extra.calendar) : null
        const meeting: Meeting = {
          id: newId(),
          title: data.title || defaultMeetingTitle(new Date(data.startedAt)),
          startedAt: new Date(data.startedAt).toISOString(),
          durationMs: data.durationMs,
          sources: { mic: data.sources.mic, system: data.sources.system },
          audioPath: null,
          transcriptPath: null,
          ...(calendar ? { calendar } : {}),
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

    folders: () => serial(async () => (await load()).folders),

    createFolder: (name) =>
      serial(async () => {
        const parsed = folderName.safeParse(name)
        if (!parsed.success) return null
        const data = await load()
        const folder: MeetingFolder = { id: newId(), name: parsed.data }
        await save({ ...data, folders: [...data.folders, folder] })
        return folder
      }),

    renameFolder: (id, name) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const parsed = folderName.safeParse(name)
        if (!parsed.success) return null
        const data = await load()
        const found = data.folders.find((folder) => folder.id === key)
        if (!found) return null
        found.name = parsed.data
        await save(data)
        return found
      }),

    deleteFolder: (id) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const data = await load()
        const folders = data.folders.filter((folder) => folder.id !== key)
        if (folders.length === data.folders.length) return false
        const meetings = data.meetings.map((meeting) => (meeting.folderId === key ? { ...meeting, folderId: null } : meeting))
        await save({ meetings, folders })
        return true
      }),

    move: (id, folderId) =>
      serial(async () => {
        const key = idSchema.parse(id)
        const target = folderId === null ? null : idSchema.parse(folderId)
        const data = await load()
        if (target !== null && !data.folders.some((folder) => folder.id === target)) return null
        const found = data.meetings.find((meeting) => meeting.id === key)
        if (!found) return null
        found.folderId = target
        await save(data)
        return found
      }),
  }
}
