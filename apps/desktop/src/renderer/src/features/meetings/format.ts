// Datas e durações da lista e do detalhe, em pt-BR e no fuso local. Sem DOM: testado em
// test/renderer/meetings-format.test.ts.
import type { Meeting } from '@shared/meetings'

const pad = (value: number): string => String(value).padStart(2, '0')

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })

/** Dias de calendário entre as duas datas, no fuso local (o horário de verão não desloca). */
function daysBetween(date: Date, now: Date): number {
  const start = (value: Date): number => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  return Math.round((start(now) - start(date)) / 86_400_000)
}

/** "Hoje", "Ontem", "12 de novembro" (com o ano quando não é o ano corrente). */
export function dayLabel(date: Date, now: Date): string {
  const days = daysBetween(date, now)
  if (days === 0) return 'Hoje'
  if (days === 1) return 'Ontem'
  return (date.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(date)
}

/**
 * Cabeçalho dos grupos da lista de reuniões (contrato 10): como `dayLabel`, mas com o dia da semana de 2 a
 * 6 dias atrás ("Quinta-feira"). Uma semana atrás já cai no mesmo dia da semana de hoje e volta à data.
 */
export function groupDayLabel(date: Date, now: Date): string {
  const days = daysBetween(date, now)
  if (days < 2 || days > 6) return dayLabel(date, now)
  const weekday = WEEKDAY.format(date)
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`
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

/** "1 reunião · 45 min", "3 reuniões · 1 h 20 min". */
export function dayTotalLabel(count: number, totalMs: number): string {
  return `${count} ${count === 1 ? 'reunião' : 'reuniões'} · ${durationLabel(totalMs)}`
}

/** "1 tarefa", "3 tarefas". */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Participantes da agenda: até 3 nomes e "+N" para o resto ("Ana, Bruno, Carla +2"). */
export function attendeesLabel(names: readonly string[], shown = 3): string {
  const clean = names.map((name) => name.trim()).filter(Boolean)
  const rest = clean.length - shown
  return `${clean.slice(0, shown).join(', ')}${rest > 0 ? ` +${rest}` : ''}`
}

export interface MeetingGroup<T> {
  key: string
  label: string
  /** Total do dia para o cabeçalho do grupo. */
  total: string
  items: T[]
}

/**
 * Agrupa por dia local, na ordem em que os itens chegam (a lista já vem da mais recente). `meetingOf`
 * diz onde está a reunião de cada item (a própria, uma linha da lista ou um resultado da busca).
 */
export function groupByDay<T>(items: readonly T[], now: Date, meetingOf: (item: T) => Pick<Meeting, 'startedAt' | 'durationMs'>): MeetingGroup<T>[] {
  const groups: { key: string; label: string; totalMs: number; items: T[] }[] = []
  for (const item of items) {
    const meeting = meetingOf(item)
    const date = new Date(meeting.startedAt)
    const key = dayKey(date)
    let group = groups.at(-1)
    if (group?.key !== key) {
      group = { key, label: groupDayLabel(date, now), totalMs: 0, items: [] }
      groups.push(group)
    }
    group.items.push(item)
    group.totalMs += meeting.durationMs
  }
  return groups.map(({ key, label, totalMs, items: grouped }) => ({ key, label, total: dayTotalLabel(grouped.length, totalMs), items: grouped }))
}
