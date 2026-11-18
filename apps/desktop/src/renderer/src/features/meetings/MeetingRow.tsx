import { Cloud } from 'lucide-react'
import { Link } from 'react-router'
import { notesCountLabel } from '@shared/meeting-notes'
import type { MeetingFolder } from '@shared/meetings'
import type { MeetingOverview, SearchField, SnippetPart } from '@shared/meetings-overview'
import { meetingPath } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { attendeesLabel, countLabel, durationLabel, timeLabel } from './format'
import { MoveMenu } from './MoveMenu'
import { SourceDots } from './SourceDots'

const FIELD_LABEL: Record<SearchField, string> = {
  title: 'no título',
  transcript: 'na transcrição',
  summary: 'no resumo',
  notes: 'nas anotações',
}

interface MeetingRowProps {
  entry: MeetingOverview
  /** Na busca: onde achou e o trecho, que toma o lugar da prévia do resumo. */
  found?: { field: SearchField; snippet: SnippetPart[] } | undefined
  /** Contrato 28: nome da pasta na linha de meta (só com o filtro "Todas"). */
  folderName?: string | null | undefined
  /** Contrato 28: o "…" com "Mover para…"; sem isto, a linha fica como era. */
  move?: { folders: readonly MeetingFolder[]; onMove: (folderId: string | null) => void; onMoveToNew: (name: string) => void } | undefined
}

/**
 * Linha da lista (contrato 10, CA3): título; hora, duração e participantes da agenda; a primeira frase do
 * resumo em até duas linhas; "N tarefas", "N decisões" e "N anotações" (contrato 13); "Gerando resumo…"
 * enquanto gera; à direita, a nuvem quando a reunião está no Google Drive (contrato 11). A linha inteira
 * é o link para o detalhe, inclusive pelo teclado. Contrato 28: o "…" de mover fica ao lado, fora do link, e a
 * pasta aparece discreta na linha de meta.
 */
export function MeetingRow({ entry, found, folderName, move }: MeetingRowProps) {
  const { meeting, summary, summaryState, notes } = entry
  const attendees = meeting.calendar?.attendees ?? []
  const names = attendees.length ? attendeesLabel(attendees.map((person) => person.name || person.email)) : ''
  const markers = [
    found ? FIELD_LABEL[found.field] : null,
    summary?.tasks ? countLabel(summary.tasks, 'tarefa', 'tarefas') : null,
    summary?.decisions ? countLabel(summary.decisions, 'decisão', 'decisões') : null,
    notes ? notesCountLabel(notes) : null,
    summaryState === 'generating' ? 'Gerando resumo…' : null,
  ].filter((marker): marker is string => marker !== null)

  return (
    <div className="flex items-start transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken">
      <Link
        to={meetingPath(meeting.id)}
        data-meeting={meeting.id}
        draggable={false}
        className="flex min-h-16 min-w-0 flex-1 items-start gap-4 px-2 py-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="truncate text-15 font-medium text-text">{meeting.title}</p>
          <p className="truncate text-12 text-text-muted tabular">
            {timeLabel(new Date(meeting.startedAt))} · {durationLabel(meeting.durationMs)}
            {names && <span data-attendees> · {names}</span>}
            {folderName && <span data-meeting-folder> · {folderName}</span>}
          </p>
          {found ? (
            <p data-search-snippet className="mt-1 line-clamp-2 text-13 text-text-muted">
              {found.snippet.map((part, i) =>
                part.mark ? (
                  <mark key={i} className="bg-transparent font-bold text-text">
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
          ) : (
            summary && (
              <p data-summary-overview className="mt-1 line-clamp-2 text-13 text-text-muted">
                {summary.overview}
              </p>
            )
          )}
          {markers.length > 0 && (
            <p data-summary-markers className="mt-0.5 flex flex-wrap gap-x-3 text-12 text-text-muted">
              {markers.map((marker) => (
                <span key={marker}>{marker}</span>
              ))}
            </p>
          )}
        </div>
        <span className="flex items-center gap-2 pt-1">
          {/* Contrato 11: discreto, só quando a reunião já está no Google Drive. */}
          {entry.inDrive && (
            <span data-in-drive role="img" aria-label="No Google Drive" title="No Google Drive" className="text-text-faint">
              <Icon icon={Cloud} size={14} />
            </span>
          )}
          <SourceDots sources={meeting.sources} />
        </span>
      </Link>
      {move && <MoveMenu folderId={meeting.folderId ?? null} folders={move.folders} onMove={move.onMove} onMoveToNew={move.onMoveToNew} />}
    </div>
  )
}
