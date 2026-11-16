// Frequência no formulário de tarefa (contrato 23, CA4): seletores simples que viram o `schedule` da tarefa, e
// o caminho de volta para editar. Funções puras (test/renderer/schedules-format.test.ts).
import { parseCron, wallTime, zonedInstant, type Schedule, type ScheduleKind } from '@shared/automations'

export interface FrequencyDraft {
  kind: ScheduleKind
  everyValue: number
  everyUnit: 'min' | 'h'
  time: string
  days: number[]
  monthDay: number
  /** `AAAA-MM-DDTHH:MM`, na hora do fuso da tarefa (o `datetime-local`). */
  onceAt: string
  delayMin: number
  cron: string
}

/** Na ordem do seletor; o cron fica por último, como "Avançado". */
export const FREQUENCY_OPTIONS: readonly { value: ScheduleKind; label: string }[] = [
  { value: 'every', label: 'A cada…' },
  { value: 'daily', label: 'Todo dia às' },
  { value: 'weekly', label: 'Dias da semana às' },
  { value: 'monthly', label: 'Todo mês no dia' },
  { value: 'once', label: 'Uma vez em' },
  { value: 'after-meeting', label: 'Depois de cada reunião' },
  { value: 'cron', label: 'Avançado: expressão cron' },
]

const two = (value: number): string => String(value).padStart(2, '0')

/** `datetime-local` de um instante, no fuso. */
export function localInput(ms: number, timeZone: string): string {
  const wall = wallTime(ms, timeZone)
  return `${wall.year}-${two(wall.month)}-${two(wall.day)}T${two(wall.hour)}:${two(wall.minute)}`
}

export function defaultDraft(now: number, timeZone: string): FrequencyDraft {
  return { kind: 'weekly', everyValue: 30, everyUnit: 'min', time: '08:00', days: [1, 2, 3, 4, 5], monthDay: 1, onceAt: localInput(now + 60 * 60_000, timeZone), delayMin: 0, cron: '0 8 * * 1-5' }
}

export function draftOf(schedule: Schedule, now: number, timeZone: string): FrequencyDraft {
  const base = defaultDraft(now, timeZone)
  switch (schedule.kind) {
    case 'every':
      return schedule.minutes % 60 === 0 ? { ...base, kind: 'every', everyValue: schedule.minutes / 60, everyUnit: 'h' } : { ...base, kind: 'every', everyValue: schedule.minutes, everyUnit: 'min' }
    case 'daily':
      return { ...base, kind: 'daily', time: schedule.time }
    case 'weekly':
      return { ...base, kind: 'weekly', days: [...schedule.days], time: schedule.time }
    case 'monthly':
      return { ...base, kind: 'monthly', monthDay: schedule.day, time: schedule.time }
    case 'once': {
      const at = Date.parse(schedule.at)
      return { ...base, kind: 'once', onceAt: Number.isNaN(at) ? base.onceAt : localInput(at, timeZone) }
    }
    case 'cron':
      return { ...base, kind: 'cron', cron: schedule.expr }
    case 'after-meeting':
      return { ...base, kind: 'after-meeting', delayMin: schedule.delayMin }
  }
}

/** O `schedule` do rascunho, ou a frase do que falta. */
export function scheduleOf(draft: FrequencyDraft, timeZone: string, now: number): { schedule: Schedule } | { error: string } {
  switch (draft.kind) {
    case 'every': {
      const minutes = Math.round(draft.everyUnit === 'h' ? draft.everyValue * 60 : draft.everyValue)
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) return { error: 'Escolha de 5 min a 24 h.' }
      return { schedule: { kind: 'every', minutes } }
    }
    case 'daily':
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) ? { schedule: { kind: 'daily', time: draft.time } } : { error: 'Escolha o horário.' }
    case 'weekly':
      if (!draft.days.length) return { error: 'Escolha pelo menos um dia.' }
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) ? { schedule: { kind: 'weekly', days: [...draft.days].sort((a, b) => a - b), time: draft.time } } : { error: 'Escolha o horário.' }
    case 'monthly':
      if (!Number.isInteger(draft.monthDay) || draft.monthDay < 1 || draft.monthDay > 28) return { error: 'Escolha um dia de 1 a 28.' }
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) ? { schedule: { kind: 'monthly', day: draft.monthDay, time: draft.time } } : { error: 'Escolha o horário.' }
    case 'once': {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(draft.onceAt)
      if (!match) return { error: 'Escolha o dia e o horário.' }
      const at = zonedInstant(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), timeZone)
      if (at <= now) return { error: 'Escolha um horário no futuro.' }
      return { schedule: { kind: 'once', at: new Date(at).toISOString() } }
    }
    case 'cron':
      return parseCron(draft.cron) ? { schedule: { kind: 'cron', expr: draft.cron.trim().replace(/\s+/g, ' ') } } : { error: 'Expressão cron inválida: use 5 campos (minuto, hora, dia, mês, dia da semana).' }
    case 'after-meeting': {
      const delayMin = Math.round(draft.delayMin)
      if (!Number.isFinite(delayMin) || delayMin < 0 || delayMin > 60) return { error: 'Escolha de 0 a 60 min.' }
      return { schedule: { kind: 'after-meeting', delayMin } }
    }
  }
}
