// Textos da agenda na tela (contrato 12): hora das "Próximas" e a linha dos participantes. Sem DOM: testado em
// test/renderer/calendar-format.test.ts.
import { CALENDAR_PROVIDER_LABELS, clockLabel, shortAttendees, type CalendarUpcoming } from '@shared/calendar'
import type { MeetingCalendar } from '@shared/meetings'

/** "Agora" para a que está acontecendo; "14:00–14:30" para a que vai começar. */
export function upcomingTimeLabel(item: Pick<CalendarUpcoming, 'start' | 'end' | 'happening'>): string {
  if (item.happening) return 'Agora'
  return `${clockLabel(item.start)}–${clockLabel(item.end)}`
}

/** Até 3 nomes e "+N". */
export function attendeeLine(names: readonly string[]): string {
  return shortAttendees(names)
}

/** "Da agenda: Google · 14:00" no detalhe da reunião; `null` quando a reunião não veio de um evento. */
export function calendarOriginLabel(calendar: MeetingCalendar | null | undefined): string | null {
  if (!calendar?.provider || !calendar.start) return null
  return `Da agenda: ${CALENDAR_PROVIDER_LABELS[calendar.provider]} · ${clockLabel(calendar.start)}`
}
