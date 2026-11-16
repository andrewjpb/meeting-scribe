// Markdown da transcrição para a área de transferência (CA12). Sem DOM nem Electron: o main gera e
// escreve no clipboard, e o teste confere o texto exato.
import { formatClock, speakerLabel, type TranscriptDocument } from './transcription'

export interface MarkdownMeeting {
  title: string
  /** ISO 8601. */
  startedAt: string
  durationMs: number
}

const dateLabel = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const two = (value: number): string => String(value).padStart(2, '0')

export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${two(minutes % 60)} min`
}

/** Cabeçalho com título, data, hora e duração; cada trecho com falante, horário, texto e tradução. */
export function transcriptMarkdown(meeting: MarkdownMeeting, document: TranscriptDocument): string {
  const started = new Date(meeting.startedAt)
  const lines: string[] = [
    `# ${meeting.title}`,
    '',
    `${dateLabel.format(started)} · ${two(started.getHours())}:${two(started.getMinutes())} · ${durationLabel(meeting.durationMs)}`,
  ]
  for (const segment of document.segments) {
    if (!segment.text.trim()) continue
    lines.push('', `**${speakerLabel(segment.source, segment.speaker)}** · ${formatClock(segment.startMs)}`, segment.text)
    // Citação linha a linha: uma tradução com quebra de linha não escapa do bloco no meio.
    if (segment.translation) lines.push('', ...segment.translation.split(/\r?\n/).map((line) => (line.trim() ? `> ${line}` : '>')))
  }
  return `${lines.join('\n')}\n`
}
