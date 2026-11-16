import { describe, expect, it } from 'vitest'
import { attendeesLabel, countLabel, dayLabel, dayTotalLabel, durationLabel, groupByDay, groupDayLabel, timeLabel } from '../../src/renderer/src/features/meetings/format'
import type { Meeting } from '../../src/shared/meetings'

const local = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)
const meeting = (id: string, startedAt: Date, durationMs = 0): Meeting => ({ id, title: id, startedAt: startedAt.toISOString(), durationMs, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null })

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

  it('grupo da lista (contrato 10, CA2): Hoje, Ontem, dia da semana até 6 dias atrás, depois a data', () => {
    // 14/11/2026 é um sábado.
    expect(groupDayLabel(local(2026, 11, 14, 0, 5), now)).toBe('Hoje')
    expect(groupDayLabel(local(2026, 11, 13, 23, 59), now)).toBe('Ontem')
    expect(groupDayLabel(local(2026, 11, 12, 0, 0), now)).toBe('Quinta-feira')
    expect(groupDayLabel(local(2026, 11, 11), now)).toBe('Quarta-feira')
    expect(groupDayLabel(local(2026, 11, 8, 23, 59), now)).toBe('Domingo')
    expect(groupDayLabel(local(2026, 11, 7), now)).toBe('7 de novembro')
    expect(groupDayLabel(local(2026, 1, 15), now)).toBe('15 de janeiro')
    expect(groupDayLabel(local(2025, 11, 15), now)).toBe('15 de novembro de 2025')
    // Virada de ano: o dia da semana vale mesmo no ano anterior.
    expect(groupDayLabel(local(2025, 12, 29), local(2026, 1, 2, 9))).toBe('Segunda-feira')
    expect(groupDayLabel(local(2025, 12, 20), local(2026, 1, 2, 9))).toBe('20 de dezembro de 2025')
    // Data no futuro (relógio adiantado) não vira dia da semana.
    expect(groupDayLabel(local(2026, 11, 16), now)).toBe('16 de novembro')
  })

  it('o rótulo da última verificação (contrato 14) continua sem dia da semana', () => {
    expect(dayLabel(local(2026, 11, 12), now)).toBe('12 de novembro')
  })

  it('total do dia, contagens e participantes', () => {
    expect(dayTotalLabel(3, 80 * 60_000)).toBe('3 reuniões · 1 h 20 min')
    expect(dayTotalLabel(1, 45 * 60_000)).toBe('1 reunião · 45 min')
    expect(countLabel(1, 'tarefa', 'tarefas')).toBe('1 tarefa')
    expect(countLabel(4, 'decisão', 'decisões')).toBe('4 decisões')
    expect(attendeesLabel(['Ana', 'Bruno'])).toBe('Ana, Bruno')
    expect(attendeesLabel(['Ana', 'Bruno', 'Carla'])).toBe('Ana, Bruno, Carla')
    expect(attendeesLabel(['Ana', 'Bruno', 'Carla', 'Davi', ' ', 'Eva'])).toBe('Ana, Bruno, Carla +2')
  })

  it('agrupa por dia local mantendo a ordem, com o total de cada dia', () => {
    const groups = groupByDay(
      [
        meeting('a', local(2026, 11, 14, 18), 50 * 60_000),
        meeting('b', local(2026, 11, 14, 9), 30 * 60_000),
        meeting('c', local(2026, 11, 13, 16), 45_000),
        meeting('d', local(2026, 11, 11, 10), 65 * 60_000),
        meeting('e', local(2026, 10, 2, 10), 32 * 60_000),
      ],
      now,
      (item) => item,
    )
    expect(groups.map((g) => [g.label, g.total, g.items.map((m) => m.id)])).toEqual([
      ['Hoje', '2 reuniões · 1 h 20 min', ['a', 'b']],
      ['Ontem', '1 reunião · 45 s', ['c']],
      ['Quarta-feira', '1 reunião · 1 h 05 min', ['d']],
      ['2 de outubro', '1 reunião · 32 min', ['e']],
    ])
  })

  it('agrupa itens que levam a reunião dentro (linha da lista ou resultado da busca)', () => {
    const entries = [{ meeting: meeting('a', local(2026, 11, 14, 18)) }, { meeting: meeting('b', local(2026, 11, 13, 9)) }]
    expect(groupByDay(entries, now, (entry) => entry.meeting).map((g) => g.items.map((entry) => entry.meeting.id))).toEqual([['a'], ['b']])
  })
})
