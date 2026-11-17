import { Video } from 'lucide-react'
import { attendeeLine, upcomingTimeLabel } from './format'
import { Icon } from '../../design/Icon'
import { useCalendar } from './calendarStore'
import { useRecordEvent } from './useRecordEvent'

/**
 * "Próximas" no topo da tela de Reuniões (contrato 12, CA10): até 3 reuniões da agenda das próximas 24 h, com a
 * hora, o título, os participantes, "Entrar na chamada" (o main abre o link no navegador, só `https://`) e
 * "Gravar". Some sem contas ou sem eventos.
 */
export function UpcomingSection({ className = '' }: { className?: string }) {
  const upcoming = useCalendar((state) => state.view.upcoming)
  const record = useRecordEvent()
  if (!upcoming.length) return null
  return (
    <section aria-label="Próximas" data-upcoming className={`max-w-[820px] ${className}`}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-2">
        <h2 className="text-12 font-bold text-text-muted">Próximas</h2>
        <span className="text-12 text-text-muted">Da agenda</span>
      </div>
      <ul>
        {upcoming.map((item) => {
          const names = attendeeLine(item.attendees)
          return (
            <li key={item.key} data-upcoming-event={item.key} className="flex min-h-14 items-center gap-4 border-b border-line px-2 py-2.5">
              <span className="w-[92px] shrink-0 text-13 font-medium text-text tabular" data-upcoming-time>
                {upcomingTimeLabel(item)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <p className="truncate text-15 font-medium text-text" data-upcoming-title>
                  {item.title}
                </p>
                {names && (
                  <p className="truncate text-12 text-text-muted" data-upcoming-attendees>
                    {names}
                  </p>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-2">
                {item.hasJoinUrl && (
                  <button
                    type="button"
                    data-action="calendar-join"
                    onClick={() => void useCalendar.getState().join(item.key)}
                    className="no-drag inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-13 font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
                  >
                    <Icon icon={Video} size={14} />
                    Entrar na chamada
                  </button>
                )}
                <button
                  type="button"
                  data-action="calendar-record"
                  onClick={() => record(item.key)}
                  className="no-drag inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 text-13 font-medium text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
                >
                  <span aria-hidden="true" className="size-2 bg-rec" />
                  Gravar
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
