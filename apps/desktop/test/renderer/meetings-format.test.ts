import { describe, expect, it } from 'vitest'
import { dayLabel, durationLabel, groupByDay, timeLabel } from '../../src/renderer/src/features/meetings/format'
import type { Meeting } from '../../src/shared/meetings'

const local = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)
const meeting = (id: string, startedAt: Date): Meeting => ({ id, title: id, startedAt: startedAt.toISOString(), durationMs: 0, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null })

describe('formato da lista de reuniões', () => {
  const now = local(2026, 11, 14, 19, 0)

  it('rótulo do dia: Hoje, Ontem, data por extenso e ano só fora do ano corrente', () => {
    expect(dayLabel(local(2026, 11, 14, 0, 5), now)).toBe('Hoje')
    expect(dayLabel(local(2026, 11, 13, 23, 59), now)).toBe('Ontem')
    expect(dayLabel(local(2026, 11, 12), now)).toBe('12 de novembro')
    expect(dayLabel(local(2025, 12, 30), now)).toBe('30 de dezembro de 2025')
  })

  it('hora e duração', () => {
    expect(timeLabel(local(2026, 11, 14, 8, 5))).toBe('08:05')
    expect(durationLabel(45_000)).toBe('45 s')
    expect(durationLabel(32 * 60_000 + 10_000)).toBe('32 min')
    expect(durationLabel(65 * 60_000)).toBe('1 h 05 min')
  })

  it('agrupa por dia local mantendo a ordem', () => {
    const groups = groupByDay(
      [meeting('a', local(2026, 11, 14, 18)), meeting('b', local(2026, 11, 14, 9)), meeting('c', local(2026, 11, 13, 16)), meeting('d', local(2026, 11, 11, 10))],
      now,
    )
    expect(groups.map((g) => [g.label, g.meetings.map((m) => m.id)])).toEqual([
      ['Hoje', ['a', 'b']],
      ['Ontem', ['c']],
      ['11 de novembro', ['d']],
    ])
  })
})
