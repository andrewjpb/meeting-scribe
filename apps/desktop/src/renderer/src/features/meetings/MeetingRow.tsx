import { Link } from 'react-router'
import type { MeetingOverview, SearchField, SnippetPart } from '@shared/meetings-overview'
import { meetingPath } from '@shared/routes'
import { attendeesLabel, countLabel, durationLabel, timeLabel } from './format'
import { SourceDots } from './SourceDots'

const FIELD_LABEL: Record<SearchField, string> = {
  title: 'no título',
  transcript: 'na transcrição',
  summary: 'no resumo',
}

interface MeetingRowProps {
  entry: MeetingOverview
  /** Na busca: onde achou e o trecho, que toma o lugar da prévia do resumo. */
  found?: { field: SearchField; snippet: SnippetPart[] } | undefined
}

/**
 * Linha da lista (contrato 10, CA3): título; hora, duração e participantes da agenda; a primeira frase do
 * resumo em até duas linhas; "N tarefas" e "N decisões"; "Gerando resumo…" enquanto gera. A linha inteira
 * é o link para o detalhe, inclusive pelo teclado.
 */
export function MeetingRow({ entry, found }: MeetingRowProps) {
  const { meeting, summary, summaryState } = entry
  const attendees = meeting.calendar?.attendees ?? []
  const names = attendees.length ? attendeesLabel(attendees.map((person) => person.name || person.email)) : ''
  const markers = [
    found ? FIELD_LABEL[found.field] : null,
    summary?.tasks ? countLabel(summary.tasks, 'tarefa', 'tarefas') : null,
    summary?.decisions ? countLabel(summary.decisions, 'decisão', 'decisões') : null,
    summaryState === 'generating' ? 'Gerando resumo…' : null,
  ].filter((marker): marker is string => marker !== null)

  return (
    <Link
      to={meetingPath(meeting.id)}
      data-meeting={meeting.id}
      draggable={false}
      className="flex min-h-16 items-start gap-4 px-2 py-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <p className="truncate text-15 font-medium text-text">{meeting.title}</p>
        <p className="truncate text-12 text-text-muted tabular">
          {timeLabel(new Date(meeting.startedAt))} · {durationLabel(meeting.durationMs)}
          {names && <span data-attendees> · {names}</span>}
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
      <span className="pt-2">
        <SourceDots sources={meeting.sources} />
      </span>
    </Link>
  )
}
