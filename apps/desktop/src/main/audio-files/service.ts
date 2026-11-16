// Arquivos da reunião numa pasta do Mac (contrato 07). O renderer grava o áudio em pedaços e manda
// cada um para cá; o main é o único que escreve: escolhe a pasta (diálogo nativo), dá o nome, cria o
// `.part`, acrescenta os pedaços, renomeia no fim e escreve a transcrição em Markdown ao lado. Nada é
// escrito com "Salvar áudio e transcrição numa pasta" desligado. Sem Electron: diálogo e `shell`
// chegam injetados (o app usa os do Electron; o smoke e os testes, substitutos).
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, appendFile, constants, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  AUDIO_CHUNK_MAX_BYTES,
  AUDIO_EXTENSIONS,
  type AudioBeginResult,
  type AudioExtension,
  type AudioFinishResult,
  type AudioFolderInfo,
  type MeetingFileInfo,
  type MeetingFileKind,
  type MeetingFilesInfo,
} from '../../shared/meeting-files'
import { MEETING_TITLE_MAX, type Meeting } from '../../shared/meetings'
import type { AppSettings } from '../../shared/settings-defaults'
import { transcriptMarkdown } from '../../shared/transcript-markdown'
import type { AnalysesStore } from '../meetings/analyses'
import type { NotesStore } from '../meetings/notes'
import type { MeetingsStore } from '../meetings/store'
import type { TranscriptStore } from '../meetings/transcripts'
import type { SettingsStore } from '../settings/store'
import { incompleteName, insideFolder, meetingFileBase, PART_SUFFIX, uniqueBase } from './names'

/** Pasta padrão, dentro de Documentos. */
export const DEFAULT_FOLDER_NAME = 'Meeting Scribe'

export interface FolderDialog {
  /** Diálogo nativo de escolher pasta (`openDirectory`, `createDirectory`); `null` se cancelado. */
  chooseFolder(defaultPath: string): Promise<string | null>
}

export interface FileOpener {
  /** Como `shell.openPath`: devolve texto vazio quando abriu. */
  openPath(path: string): Promise<string>
  showItemInFolder(path: string): void
}

export interface MeetingFilesDeps {
  settings: Pick<SettingsStore, 'get' | 'setAudioFolder'>
  meetings: Pick<MeetingsStore, 'get' | 'setFiles'>
  transcripts: Pick<TranscriptStore, 'get'>
  /** Anotações da reunião (contrato 13): entram no fim do `.md` escrito ao encerrar. */
  notes?: Pick<NotesStore, 'get'>
  /** Análises da gravação (contrato 19): a seção "## Perguntas em aberto" no fim do `.md`. */
  analyses?: Pick<AnalysesStore, 'get'>
  /** Pasta pessoal, para encurtar caminhos com `~`. */
  home: string
  /** Pasta Documentos; a padrão é `<documents>/Meeting Scribe`. */
  documents: string
  dialog: FolderDialog
  opener: FileOpener
  newId?: () => string
}

export interface MeetingFilesService {
  folder(): Promise<AudioFolderInfo>
  chooseFolder(): Promise<{ chosen: boolean; folder: AudioFolderInfo; settings: AppSettings }>
  /** Início da gravação: cria a pasta se faltar e o `<nome>.<ext>.part` vazio. */
  begin(input: unknown): Promise<AudioBeginResult>
  /** Um pedaço do gravador, acrescentado ao `.part`. Falso quando não escreveu. */
  append(input: unknown): Promise<boolean>
  /** Encerrar: renomeia o `.part`, escreve o `.md` e grava os caminhos na reunião. */
  finish(input: unknown): Promise<AudioFinishResult>
  /** Abertura do app: `.part` deixado por um app fechado no meio vira `<nome> (incompleto).<ext>`. */
  recover(): Promise<string[]>
  /** Contrato 11: há uma gravação com arquivos na pasta ainda sem o `finish` (o Drive espera por ele). */
  hasOpenSession(): boolean
  info(meetingId: unknown): Promise<MeetingFilesInfo | null>
  open(input: unknown): Promise<boolean>
  reveal(input: unknown): Promise<boolean>
}

const beginSchema = z.object({
  startedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida'),
  title: z.string().max(MEETING_TITLE_MAX),
  extension: z.enum(AUDIO_EXTENSIONS).nullable(),
})
const sessionIdSchema = z.string().min(1).max(100)
const meetingIdSchema = z.string().min(1).max(200)
const finishSchema = z.object({ id: sessionIdSchema, meetingId: meetingIdSchema })
const fileSchema = z.object({ meetingId: meetingIdSchema, kind: z.enum(['audio', 'transcript']) })

interface FileSession {
  folder: string
  extension: AudioExtension | null
  /** `<nome>.<ext>.part` em gravação; `null` quando só a transcrição vai para a pasta. */
  part: string | null
  failed: boolean
  /** Pedaços em ordem: um `appendFile` por vez. */
  queue: Promise<void>
}

/** Nomes que um arquivo da reunião com esta base ocuparia na pasta. */
function namesFor(base: string, extension: AudioExtension | null): string[] {
  const finals = [...(extension ? [`${base}.${extension}`] : []), `${base}.md`]
  return [...finals, ...finals.map((name) => `${name}${PART_SUFFIX}`)]
}

function chunkBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

/**
 * Caminho de um arquivo da reunião, como gravado pelo main em `meetings.json`, só se ainda existir e tiver
 * a extensão do tipo. Defesa para um `meetings.json` editado à mão: "Abrir" e "Baixar" nunca usam algo que
 * não seja áudio ou `.md`.
 */
export function meetingFilePath(meeting: Pick<Meeting, 'audioPath' | 'transcriptPath'> | null, kind: MeetingFileKind): string | null {
  const path = kind === 'audio' ? meeting?.audioPath : meeting?.transcriptPath
  const allowed = kind === 'audio' ? /\.(m4a|webm)$/i : /\.md$/i
  return path && allowed.test(path) && existsSync(path) ? path : null
}

export function createMeetingFilesService(deps: MeetingFilesDeps): MeetingFilesService {
  const { settings, meetings, transcripts, notes, analyses, home, documents, dialog, opener, newId = randomUUID } = deps
  const sessions = new Map<string, FileSession>()
  const defaultFolder = join(documents, DEFAULT_FOLDER_NAME)

  const display = (path: string): string => {
    if (path === home) return '~'
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
  }
  const folderOf = (current: AppSettings): string => resolve(current.audioFolder ?? defaultFolder)
  const folderInfo = (path: string): AudioFolderInfo => ({ path, display: display(path) })

  const meetingPath = async (input: unknown): Promise<string | null> => {
    const parsed = fileSchema.safeParse(input)
    if (!parsed.success) return null
    return meetingFilePath(await meetings.get(parsed.data.meetingId), parsed.data.kind)
  }

  return {
    folder: async () => folderInfo(folderOf(await settings.get())),

    async chooseFolder() {
      const current = folderOf(await settings.get())
      const chosen = await dialog.chooseFolder(current)
      if (!chosen || !isAbsolute(chosen)) return { chosen: false, folder: folderInfo(current), settings: await settings.get() }
      const next = await settings.setAudioFolder(resolve(chosen))
      return { chosen: true, folder: folderInfo(folderOf(next)), settings: next }
    },

    async begin(input) {
      const { startedAt, title, extension } = beginSchema.parse(input)
      const current = await settings.get()
      if (!current.saveToFolder) return { ok: false, error: 'disabled' }
      const folder = folderOf(current)
      try {
        await mkdir(folder, { recursive: true })
        const base = uniqueBase(meetingFileBase(new Date(startedAt), title), (candidate) =>
          namesFor(candidate, extension).some((name) => existsSync(insideFolder(folder, name))),
        )
        let part: string | null = null
        if (extension) {
          part = insideFolder(folder, `${base}.${extension}${PART_SUFFIX}`)
          await writeFile(part, new Uint8Array(0), { flag: 'wx' })
        } else {
          await access(folder, constants.W_OK)
        }
        const id = newId()
        sessions.set(id, { folder, extension, part, failed: false, queue: Promise.resolve() })
        return { ok: true, id }
      } catch {
        return { ok: false, error: 'unwritable' }
      }
    },

    append(input) {
      const request = typeof input === 'object' && input !== null ? (input as { id?: unknown; data?: unknown }) : {}
      const id = sessionIdSchema.safeParse(request.id)
      const data = chunkBytes(request.data)
      const session = id.success ? sessions.get(id.data) : undefined
      if (!session?.part || session.failed || !data || data.byteLength > AUDIO_CHUNK_MAX_BYTES) return Promise.resolve(false)
      const part = session.part
      const write = session.queue.then(async () => {
        if (session.failed) return false
        try {
          await appendFile(part, data)
          return true
        } catch {
          session.failed = true
          return false
        }
      })
      session.queue = write.then(() => undefined)
      return write
    },

    async finish(input) {
      const { id, meetingId } = finishSchema.parse(input)
      const failed: AudioFinishResult = { ok: false, audioPath: null, transcriptPath: null }
      const session = sessions.get(id)
      if (!session) return failed
      sessions.delete(id)
      await session.queue
      const meeting = await meetings.get(meetingId)
      // Sem reunião, o `.part` fica: a próxima abertura o recupera como "(incompleto)".
      if (!meeting) return failed

      const { folder, extension, part } = session
      const base = uniqueBase(meetingFileBase(new Date(meeting.startedAt), meeting.title), (candidate) =>
        namesFor(candidate, extension).some((name) => {
          const path = insideFolder(folder, name)
          return path !== part && existsSync(path)
        }),
      )
      let ok = !session.failed
      let audioPath: string | null = null
      if (extension && part && !session.failed) {
        try {
          const target = insideFolder(folder, `${base}.${extension}`)
          await rename(part, target)
          audioPath = target
        } catch {
          ok = false
        }
      }

      // A cópia legível da transcrição: o mesmo texto do "Copiar transcrição", escrito uma vez só, com as
      // anotações no fim (contrato 13) e as perguntas em aberto da última análise (contrato 19). O renderer
      // grava as anotações e as análises antes de pedir o `finish`.
      let transcriptPath: string | null = null
      const document = await transcripts.get(meetingId).catch(() => null)
      if (document?.segments.some((segment) => segment.text.trim())) {
        const meetingNotes = (await notes?.get(meetingId).catch(() => [])) ?? []
        const meetingAnalyses = (await analyses?.get(meetingId).catch(() => [])) ?? []
        let temp: string | null = null
        try {
          const target = insideFolder(folder, `${base}.md`)
          temp = insideFolder(folder, `${base}.md${PART_SUFFIX}`)
          // `wx`, como o `.part` do áudio: não segue um link simbólico já plantado com esse nome.
          await writeFile(temp, transcriptMarkdown(meeting, document, meetingNotes, meetingAnalyses), { encoding: 'utf8', flag: 'wx' })
          await rename(temp, target)
          transcriptPath = target
        } catch {
          ok = false
          if (temp) await rm(temp, { force: true }).catch(() => undefined)
        }
      }

      if (audioPath || transcriptPath) {
        try {
          await meetings.setFiles(meetingId, { audioPath, transcriptPath })
        } catch {
          ok = false
        }
      }
      return { ok, audioPath, transcriptPath }
    },

    hasOpenSession: () => sessions.size > 0,

    async recover() {
      const current = await settings.get()
      if (!current.saveToFolder) return []
      const folder = folderOf(current)
      let names: string[]
      try {
        names = await readdir(folder)
      } catch {
        return []
      }
      const active = new Set([...sessions.values()].map((session) => session.part))
      const recovered: string[] = []
      for (const name of names) {
        const target = incompleteName(name)
        if (!target) continue
        try {
          const from = insideFolder(folder, name)
          if (active.has(from)) continue
          const base = uniqueBase(target.base, (candidate) => existsSync(insideFolder(folder, `${candidate}.${target.extension}`)))
          const to = insideFolder(folder, `${base}.${target.extension}`)
          await rename(from, to)
          recovered.push(basename(to))
        } catch {
          // Um arquivo que não deu para renomear não impede os outros.
        }
      }
      return recovered
    },

    async info(meetingId) {
      const id = meetingIdSchema.safeParse(meetingId)
      if (!id.success) return null
      const meeting = await meetings.get(id.data)
      if (!meeting || (!meeting.audioPath && !meeting.transcriptPath)) return null
      const file = (path: string | null): MeetingFileInfo | null => (path ? { name: basename(path), exists: existsSync(path) } : null)
      const anyPath = meeting.audioPath ?? meeting.transcriptPath ?? ''
      return { folder: display(dirname(anyPath)), audio: file(meeting.audioPath), transcript: file(meeting.transcriptPath) }
    },

    async open(input) {
      const path = await meetingPath(input)
      if (!path) return false
      return (await opener.openPath(path)) === ''
    },

    async reveal(input) {
      const path = await meetingPath(input)
      if (!path) return false
      opener.showItemInFolder(path)
      return true
    },
  }
}
