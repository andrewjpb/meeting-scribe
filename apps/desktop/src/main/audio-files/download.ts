// "Baixar…" na aba "Áudio" (contrato 08, CA7): o diálogo de salvar do macOS e uma cópia para onde a
// pessoa escolher. O renderer manda só a reunião e o tipo; a origem sai sempre de `meetings.json`, com a
// mesma checagem de extensão do "Abrir" (contrato 07). Áudio e transcrição salvos na pasta são copiados;
// a transcrição sem arquivo e o resumo viram `.md` na hora. Quem confirma a troca de um arquivo que já
// existe é o próprio diálogo do macOS.
import { copyFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { MEETING_DOWNLOAD_KINDS, type MeetingDownloadKind, type MeetingDownloadResult } from '../../shared/meeting-files'
import { summaryMarkdown } from '../../shared/meeting-summary'
import { transcriptMarkdown } from '../../shared/transcript-markdown'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { TranscriptStore } from '../meetings/transcripts'
import { meetingFileBase } from './names'
import { meetingFilePath } from './service'
import { SUMMARY_FILE_SUFFIX, summaryFileTarget } from './summary-file'

export interface SaveDialog {
  /** Diálogo nativo de salvar, aberto em `defaultPath`; `null` se cancelado. */
  chooseSavePath(defaultPath: string, extension: string): Promise<string | null>
}

export interface MeetingDownloadDeps {
  meetings: Pick<MeetingsStore, 'get'>
  transcripts: Pick<TranscriptStore, 'get'>
  summaries: Pick<SummaryStore, 'get'>
  dialog: SaveDialog
  /** Pasta em que o diálogo abre (Downloads). */
  downloads: string
}

const downloadSchema = z.object({ meetingId: z.string().min(1).max(200), kind: z.enum(MEETING_DOWNLOAD_KINDS) })

/** O que será salvo: um arquivo da pasta para copiar ou um texto para escrever. */
type Source = { name: string; copyFrom: string } | { name: string; text: string }

/**
 * O destino é o próprio original? Compara o caminho real dos dois lados (links resolvidos, sem diferenciar
 * maiúsculas, como o disco do Mac) e, se o destino já existe, o arquivo em si (`dev` + `ino`).
 */
export async function isSameFile(source: string, target: string): Promise<boolean> {
  const real = async (path: string): Promise<string> => {
    try {
      return await realpath(path)
    } catch {
      // Destino ainda não existe: vale o caminho real da pasta dele.
      return join(await realpath(dirname(path)).catch(() => dirname(path)), basename(path))
    }
  }
  const [from, to] = await Promise.all([real(source), real(target)])
  if (from === to || from.toLowerCase() === to.toLowerCase()) return true
  const [a, b] = await Promise.all([stat(source).catch(() => null), stat(target).catch(() => null)])
  return a !== null && b !== null && a.dev === b.dev && a.ino === b.ino
}

export function createMeetingDownload(deps: MeetingDownloadDeps): (input: unknown) => Promise<MeetingDownloadResult> {
  async function sourceOf(meetingId: string, kind: MeetingDownloadKind): Promise<Source | null> {
    const meeting = await deps.meetings.get(meetingId)
    if (!meeting) return null
    const base = meetingFileBase(new Date(meeting.startedAt), meeting.title)
    if (kind === 'audio') {
      const path = meetingFilePath(meeting, 'audio')
      return path ? { name: basename(path), copyFrom: path } : null
    }
    if (kind === 'transcript') {
      const path = meetingFilePath(meeting, 'transcript')
      if (path) return { name: basename(path), copyFrom: path }
      const document = await deps.transcripts.get(meetingId).catch(() => null)
      if (!document?.segments.some((segment) => segment.text.trim())) return null
      return { name: `${base}.md`, text: transcriptMarkdown(meeting, document) }
    }
    const summary = await deps.summaries.get(meetingId).catch(() => null)
    if (!summary) return null
    return { name: summaryFileTarget(meeting)?.name ?? `${base}${SUMMARY_FILE_SUFFIX}`, text: summaryMarkdown(meeting, summary) }
  }

  return async (input) => {
    const parsed = downloadSchema.safeParse(input)
    if (!parsed.success) return 'missing'
    const source = await sourceOf(parsed.data.meetingId, parsed.data.kind)
    if (!source) return 'missing'
    const extension = /\.([a-z0-9]+)$/i.exec(source.name)?.[1] ?? 'md'
    const chosen = await deps.dialog.chooseSavePath(join(deps.downloads, source.name), extension)
    if (!chosen || !isAbsolute(chosen)) return 'canceled'
    const target = resolve(chosen)
    try {
      if ('copyFrom' in source) {
        // Salvar por cima do próprio original não copia nada (e não pode truncá-lo).
        if (!(await isSameFile(source.copyFrom, target))) await copyFile(source.copyFrom, target)
      } else {
        await writeFile(target, source.text, 'utf8')
      }
      return 'saved'
    } catch {
      return 'failed'
    }
  }
}
