// O que vai para o Drive de cada reunião (contrato 11, CA4, CA5 e CA7): só o que está nos arquivos do app. Os
// caminhos saem de `meetings.json`, com a checagem de extensão do contrato 07 (`meetingFilePath`); o renderer
// só manda o `meetingId`. Reunião sem arquivos na pasta (opção desligada) manda a transcrição e o resumo
// montados na hora (`transcriptMarkdown`/`summaryMarkdown`), com o mesmo texto do "Copiar". Tipo novo de arquivo
// (o vídeo do contrato 20) entra em `SOURCES` e em `DRIVE_FILE_KINDS`.
import { existsSync } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { DriveFileKind } from '../../shared/accounts'
import type { Meeting } from '../../shared/meetings'
import { summaryMarkdown } from '../../shared/meeting-summary'
import { transcriptMarkdown } from '../../shared/transcript-markdown'
import { meetingFileBase, insideFolder } from '../audio-files/names'
import { meetingFilePath } from '../audio-files/service'
import { SUMMARY_FILE_SUFFIX, summaryFileTarget } from '../audio-files/summary-file'
import type { AnalysesStore } from '../meetings/analyses'
import type { NotesStore } from '../meetings/notes'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { TranscriptStore } from '../meetings/transcripts'
import type { UploadSource } from './drive'

export interface DriveFilesDeps {
  meetings: Pick<MeetingsStore, 'get'>
  transcripts: Pick<TranscriptStore, 'get'>
  summaries: Pick<SummaryStore, 'get'>
  notes?: Pick<NotesStore, 'get'>
  analyses?: Pick<AnalysesStore, 'get'>
}

/** O arquivo de áudio que a reunião diz ter sumiu da pasta: a tela mostra "Erro: arquivo não encontrado". */
export class MissingFileError extends Error {
  constructor(readonly kind: DriveFileKind) {
    super(`arquivo ${kind} não encontrado`)
    this.name = 'MissingFileError'
  }
}

const AUDIO_MIME: Record<string, string> = { '.m4a': 'audio/mp4', '.webm': 'audio/webm' }
const MARKDOWN_MIME = 'text/markdown'

function textSource(name: string, text: string): UploadSource {
  const bytes = Buffer.from(text, 'utf8')
  return { name, mimeType: MARKDOWN_MIME, size: bytes.byteLength, read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)) }
}

async function fileSource(path: string, mimeType: string): Promise<UploadSource> {
  const { size } = await stat(path)
  return {
    name: basename(path),
    mimeType,
    size,
    // Um trecho por vez, direto do disco: o áudio de uma reunião longa nunca fica inteiro na memória.
    async read(offset, length) {
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    },
  }
}

/** Nome base dos arquivos da reunião: o do arquivo na pasta, se houver; senão `AAAA-MM-DD HHhMM - título`. */
export function meetingBase(meeting: Meeting): string {
  for (const path of [meeting.audioPath, meeting.transcriptPath]) {
    if (path && /\.(m4a|webm|md)$/i.test(path)) return basename(path).replace(/\.(m4a|webm|md)$/i, '')
  }
  return meetingFileBase(new Date(meeting.startedAt), meeting.title)
}

type Resolver = (deps: DriveFilesDeps, meeting: Meeting, base: string) => Promise<UploadSource | null>

const SOURCES: Readonly<Record<DriveFileKind, Resolver>> = {
  async audio(_deps, meeting) {
    if (!meeting.audioPath) return null
    const path = meetingFilePath(meeting, 'audio')
    if (!path) throw new MissingFileError('audio')
    return fileSource(path, AUDIO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream')
  },

  async transcript(deps, meeting, base) {
    const path = meetingFilePath(meeting, 'transcript')
    if (path) return { ...(await fileSource(path, MARKDOWN_MIME)), name: `${base}.md` }
    const document = await deps.transcripts.get(meeting.id).catch(() => null)
    if (!document?.segments.some((segment) => segment.text.trim())) return null
    const notes = (await deps.notes?.get(meeting.id).catch(() => [])) ?? []
    const analyses = (await deps.analyses?.get(meeting.id).catch(() => [])) ?? []
    return textSource(`${base}.md`, transcriptMarkdown(meeting, document, notes, analyses))
  },

  async summary(deps, meeting, base) {
    const name = `${base}${SUMMARY_FILE_SUFFIX}`
    const target = summaryFileTarget(meeting)
    if (target) {
      try {
        const path = insideFolder(target.folder, target.name)
        if (existsSync(path)) return textSource(name, await readFile(path, 'utf8'))
      } catch {
        // Nome que não cabe na pasta: monta o texto na hora, como sem pasta.
      }
    }
    const summary = await deps.summaries.get(meeting.id).catch(() => null)
    if (!summary) return null
    const analyses = (await deps.analyses?.get(meeting.id).catch(() => [])) ?? []
    return textSource(name, summaryMarkdown(meeting, summary, analyses))
  },
}

export interface MeetingUpload {
  meeting: Meeting
  /** Nome da subpasta no Drive. */
  base: string
  /** Só os tipos pedidos que têm conteúdo. */
  files: { kind: DriveFileKind; source: UploadSource }[]
}

/** `null` quando a reunião não existe mais (excluída no app: nada vai para o Drive). */
export async function meetingUpload(deps: DriveFilesDeps, meetingId: string, kinds: readonly DriveFileKind[]): Promise<MeetingUpload | null> {
  const meeting = await deps.meetings.get(meetingId)
  if (!meeting) return null
  const base = meetingBase(meeting)
  const files: MeetingUpload['files'] = []
  for (const kind of kinds) {
    const source = await SOURCES[kind](deps, meeting, base)
    if (source) files.push({ kind, source })
  }
  return { meeting, base, files }
}
