import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import type { InviteCalendarOption } from '@shared/invite-state'
import { Icon } from '../../design/Icon'
import { MENU_ITEM, useInlineMenu } from '../meetings/menu'

interface CalendarPickerProps {
  /** Já só as graváveis, na ordem do helper (62). */
  calendars: readonly InviteCalendarOption[]
  /** A escolhida; fora da lista (ou `null`), o botão diz "Escolher agenda". */
  value: string | null
  onChange: (calendarId: string) => void
  disabled?: boolean
  /** `id` do botão (Configurações: `invite-default-calendar`). */
  id?: string
  /** Nome para o leitor de tela. */
  label?: string
}

/** As agendas agrupadas por conta (`sourceTitle`), na ordem em que aparecem. */
function groupsOf(calendars: readonly InviteCalendarOption[]): { source: string; items: InviteCalendarOption[] }[] {
  const groups: { source: string; items: InviteCalendarOption[] }[] = []
  for (const calendar of calendars) {
    const group = groups.find((item) => item.source === calendar.sourceTitle)
    if (group) group.items.push(calendar)
    else groups.push({ source: calendar.sourceTitle, items: [calendar] })
  }
  return groups
}

/**
 * Seletor de agenda (contrato 63, CA22, quadro 11b): um menu na própria linha, aberto logo abaixo do botão, com as
 * agendas em que dá para gravar agrupadas por conta. Sem cor de agenda (as do EventKit não são tokens). Serve ao cartão
 * do convite (a escolha vale só para ele), a Configurações (grava a agenda padrão) e ao cartão de sugestão do 64.
 */
export function CalendarPicker({ calendars, value, onChange, disabled = false, id, label = 'Agenda' }: CalendarPickerProps) {
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(open, close)
  const current = calendars.find((item) => item.id === value) ?? null
  const groups = groupsOf(calendars)
  const off = disabled || calendars.length === 0

  // Aberto: o foco vai à escolhida (ou à primeira).
  useEffect(() => {
    if (!open) return
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    ;(options.find((item) => item.getAttribute('aria-selected') === 'true') ?? options[0])?.focus()
  }, [open, menu])

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    if (!options.length) return
    event.preventDefault()
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? Math.min(at + 1, options.length - 1) : Math.max(at - 1, 0)
    options[next]?.focus()
  }

  const pick = (calendarId: string): void => {
    close()
    button.current?.focus()
    if (calendarId !== value) onChange(calendarId)
  }

  return (
    <div data-invite-calendar-picker onBlur={onBlur} onKeyDown={open ? onKeyDown : undefined} className={`relative min-w-0 ${off ? 'opacity-50' : ''}`}>
      <button
        ref={button}
        id={id}
        type="button"
        data-invite-calendar={current?.id ?? ''}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `${label}: ${current.title} (${current.sourceTitle})` : `${label}: escolher agenda`}
        disabled={off}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`no-drag inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 text-13 whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none ${open ? 'bg-bg-sunken' : ''}`}
      >
        {current ? (
          <>
            <span className="truncate font-bold text-title">{current.title}</span>
            <span className="truncate text-text-muted">{current.sourceTitle}</span>
          </>
        ) : (
          <span className="truncate text-text-muted">Escolher agenda</span>
        )}
        <Icon icon={ChevronDown} size={14} className="ml-1 shrink-0 text-text-muted" />
      </button>
      {open && (
        <div
          ref={menu}
          role="listbox"
          aria-label={label}
          data-invite-calendar-menu
          onKeyDown={onListKey}
          className="absolute top-full left-0 z-10 mt-1 flex w-72 max-w-[80vw] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised py-1"
        >
          {groups.map((group) => (
            <div key={group.source} role="group" aria-label={group.source} className="flex flex-col">
              <p aria-hidden="true" data-invite-calendar-group className="label truncate px-3 pt-2 pb-1">
                {group.source}
              </p>
              {group.items.map((calendar) => {
                const selected = calendar.id === value
                return (
                  <button
                    key={calendar.id}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    data-invite-calendar-option={calendar.id}
                    onClick={() => pick(calendar.id)}
                    className={`${MENU_ITEM} gap-2 text-text`}
                  >
                    <span className="flex w-3.5 shrink-0 justify-center text-accent">{selected && <Icon icon={Check} size={14} />}</span>
                    <span className="truncate">{calendar.title}</span>
                  </button>
                )
              })}
            </div>
          ))}
          <p className="mt-1 border-t border-line px-3 pt-2 pb-1.5 text-12 text-text-faint">Só as agendas em que dá para gravar. Feriados e agendas assinadas não aparecem.</p>
        </div>
      )}
    </div>
  )
}
