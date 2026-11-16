// Datas e durações da lista e do detalhe, em pt-BR e no fuso local. Sem DOM: testado em
// test/renderer/meetings-format.test.ts.
import type { Meeting } from '@shared/meetings'

const pad = (value: number): string => String(value).padStart(2, '0')

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

/** "Hoje", "Ontem", "12 de novembro" (com o ano quando não é o ano corrente). */
export function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date)
  if (key === dayKey(now)) return 'Hoje'
  if (key === dayKey(addDays(now, -1))) return 'Ontem'
  return (date.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(date)
}

/** "14 de novembro de 2026". */
export function longDateLabel(date: Date): string {
  return DAY_MONTH_YEAR.format(date)
}

export function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "45 s", "32 min", "1 h 05 min". */
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`
}

export interface MeetingGroup {
  key: string
  label: string
  meetings: Meeting[]
}

/** Agrupa por dia local, na ordem em que as reuniões chegam (a lista já vem da mais recente). */
export function groupByDay(meetings: readonly Meeting[], now: Date): MeetingGroup[] {
  const groups: MeetingGroup[] = []
  for (const meeting of meetings) {
    const date = new Date(meeting.startedAt)
    const key = dayKey(date)
    let group = groups.at(-1)
    if (group?.key !== key) {
      group = { key, label: dayLabel(date, now), meetings: [] }
      groups.push(group)
    }
    group.meetings.push(meeting)
  }
  return groups
}
