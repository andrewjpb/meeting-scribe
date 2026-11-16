import { describe, expect, it } from 'vitest'
import { agoLabel, describeCron, describeSchedule, dueOccurrences, formatRunAt, nextRunAfter, nextRuns, parseCron, promptHeader, scheduleLine, zonedInstant, type Schedule } from '../src/shared/automations'
import { agentInputSchema, scheduleSchema, taskInputSchema } from '../src/shared/automations-schema'

const NY = 'America/New_York'
const SP = 'America/Sao_Paulo'
const at = (iso: string): number => Date.parse(iso)
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

describe('próximo horário (contrato 23, CA3)', () => {
  it('todo dia: hoje se ainda não passou, senão amanhã, no fuso da tarefa', () => {
    const daily: Schedule = { kind: 'daily', time: '08:00' }
    // 16/11/2026 07:00 em São Paulo (UTC−3).
    expect(iso(nextRunAfter(daily, SP, at('2026-11-16T10:00:00Z')))).toBe('2026-11-16T11:00:00.000Z')
    expect(iso(nextRunAfter(daily, SP, at('2026-11-16T11:00:00Z')))).toBe('2026-11-17T11:00:00.000Z')
    // O mesmo instante em Nova York (UTC−5 em novembro) cai noutro horário.
    expect(iso(nextRunAfter(daily, NY, at('2026-11-16T10:00:00Z')))).toBe('2026-11-16T13:00:00.000Z')
  })

  it('horário de verão: a hora que não existe roda uma hora depois; 08:00 continua 08:00 de parede', () => {
    // 08/03/2026 às 02:00 o relógio de Nova York pula para 03:00.
    const gap: Schedule = { kind: 'daily', time: '02:30' }
    const first = nextRunAfter(gap, NY, at('2026-03-07T12:00:00Z'))
    expect(iso(first)).toBe('2026-03-08T07:30:00.000Z') // 03:30 EDT
    expect(iso(nextRunAfter(gap, NY, first ?? 0))).toBe('2026-03-09T06:30:00.000Z') // 02:30 EDT
    const morning: Schedule = { kind: 'daily', time: '08:00' }
    expect(nextRuns(morning, NY, at('2026-03-07T00:00:00Z'), 2).map(iso)).toEqual(['2026-03-07T13:00:00.000Z', '2026-03-08T12:00:00.000Z'])
  })

  it('fim do horário de verão: a hora repetida roda uma vez só (a primeira)', () => {
    // 01/11/2026 às 02:00 EDT o relógio volta para 01:00 EST: 01:30 acontece duas vezes.
    const repeated: Schedule = { kind: 'daily', time: '01:30' }
    expect(nextRuns(repeated, NY, at('2026-11-01T04:00:00Z'), 2).map(iso)).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'])
    expect(iso(zonedInstant(2026, 11, 1, 1, 30, NY))).toBe('2026-11-01T05:30:00.000Z')
  })

  it('dias da semana e fim de semana', () => {
    const weekdays: Schedule = { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }
    // Sexta 20/11 às 09:00: a próxima é segunda 23/11.
    expect(iso(nextRunAfter(weekdays, SP, at('2026-11-20T12:00:00Z')))).toBe('2026-11-23T11:00:00.000Z')
    const friday: Schedule = { kind: 'weekly', days: [5], time: '17:00' }
    expect(formatRunAt(nextRunAfter(friday, SP, at('2026-11-16T12:00:00Z')) ?? 0, SP)).toBe('sex 20/11 17:00')
  })

  it('todo mês: do fim de janeiro para fevereiro, e o dia que já passou vai ao mês seguinte', () => {
    const monthly: Schedule = { kind: 'monthly', day: 28, time: '09:00' }
    expect(iso(nextRunAfter(monthly, SP, at('2026-01-31T12:00:00Z')))).toBe('2026-02-28T12:00:00.000Z')
    expect(iso(nextRunAfter(monthly, SP, at('2026-12-28T12:00:00Z')))).toBe('2027-01-28T12:00:00.000Z')
  })

  it('a cada N min conta da última execução; uma vez só some depois do horário; depois de cada reunião não tem horário', () => {
    expect(nextRunAfter({ kind: 'every', minutes: 30 }, SP, 1_000)).toBe(1_000 + 30 * 60_000)
    const once: Schedule = { kind: 'once', at: '2026-11-20T20:00:00.000Z' }
    expect(iso(nextRunAfter(once, SP, at('2026-11-16T00:00:00Z')))).toBe('2026-11-20T20:00:00.000Z')
    expect(nextRunAfter(once, SP, at('2026-11-21T00:00:00Z'))).toBeNull()
    expect(nextRunAfter({ kind: 'after-meeting', delayMin: 5 }, SP, 0)).toBeNull()
  })

  it('cron de 5 campos: listas, faixas, passos, domingo como 0 ou 7 e a regra do "ou" entre dia e dia da semana', () => {
    expect(parseCron('0 8 * * 1-5')?.weekdays).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(parseCron('*/15 * * * *')?.minutes).toEqual([0, 15, 30, 45])
    expect(parseCron('0 9 * * 7')?.weekdays).toEqual(new Set([0]))
    expect(parseCron('0 8 * *')).toBeNull()
    expect(parseCron('60 8 * * *')).toBeNull()
    expect(parseCron('0 8 * * 1 extra')).toBeNull()
    expect(parseCron('0 8 32 * *')).toBeNull()
    expect(iso(nextRunAfter({ kind: 'cron', expr: '0 8 * * 1' }, SP, at('2026-11-15T12:00:00Z')))).toBe('2026-11-16T11:00:00.000Z')
    // Dia 1 do mês ou sexta: a primeira das duas.
    expect(iso(nextRunAfter({ kind: 'cron', expr: '0 12 1 * 5' }, SP, at('2026-11-16T12:00:00Z')))).toBe('2026-11-20T15:00:00.000Z')
    // A hora que não existe no dia da troca do horário de verão não roda nesse dia.
    expect(iso(nextRunAfter({ kind: 'cron', expr: '30 2 * * *' }, NY, at('2026-03-07T12:00:00Z')))).toBe('2026-03-09T06:30:00.000Z')
    // 29 de fevereiro: o próximo é em 2028.
    expect(iso(nextRunAfter({ kind: 'cron', expr: '0 0 29 2 *' }, 'UTC', at('2026-03-01T00:00:00Z')))).toBe('2028-02-29T00:00:00.000Z')
  })

  it('horários perdidos: lista do primeiro vencido até agora, com teto', () => {
    const daily: Schedule = { kind: 'daily', time: '08:00' }
    const due = dueOccurrences(daily, SP, at('2026-11-13T11:00:00Z'), at('2026-11-16T15:00:00Z'))
    expect(due.map(iso)).toEqual(['2026-11-13T11:00:00.000Z', '2026-11-14T11:00:00.000Z', '2026-11-15T11:00:00.000Z', '2026-11-16T11:00:00.000Z'])
    expect(dueOccurrences({ kind: 'every', minutes: 5 }, SP, 0, 10 * 24 * 60 * 60_000, 50)).toHaveLength(50)
  })
})

describe('frases em português (contrato 23, CA3 e CA4)', () => {
  it('descreve cada frequência', () => {
    expect(describeSchedule({ kind: 'weekly', days: [5], time: '17:00' }, SP)).toBe('Toda sexta às 17:00')
    expect(describeSchedule({ kind: 'weekly', days: [1], time: '08:00' }, SP)).toBe('Toda segunda às 08:00')
    expect(describeSchedule({ kind: 'weekly', days: [6], time: '10:00' }, SP)).toBe('Todo sábado às 10:00')
    expect(describeSchedule({ kind: 'weekly', days: [5, 1, 3], time: '08:00' }, SP)).toBe('Toda segunda, quarta e sexta às 08:00')
    expect(describeSchedule({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }, SP)).toBe('Todo dia útil às 08:00')
    expect(describeSchedule({ kind: 'every', minutes: 30 }, SP)).toBe('A cada 30 min')
    expect(describeSchedule({ kind: 'every', minutes: 60 }, SP)).toBe('A cada hora')
    expect(describeSchedule({ kind: 'every', minutes: 90 }, SP)).toBe('A cada 1 h 30 min')
    expect(describeSchedule({ kind: 'monthly', day: 5, time: '09:00' }, SP)).toBe('Todo mês no dia 5 às 09:00')
    expect(describeSchedule({ kind: 'after-meeting', delayMin: 0 }, SP)).toBe('Depois de cada reunião')
    expect(describeSchedule({ kind: 'after-meeting', delayMin: 10 }, SP)).toBe('10 min depois de cada reunião')
    expect(describeSchedule({ kind: 'once', at: '2026-11-20T20:00:00.000Z' }, SP)).toBe('Uma vez em sex 20/11 17:00')
  })

  it('cron em português quando cabe numa frase', () => {
    expect(describeCron('0 8 * * 1')).toBe('Toda segunda às 08:00')
    expect(describeCron('0 8 * * 1-5')).toBe('Todo dia útil às 08:00')
    expect(describeCron('30 18 * * *')).toBe('Todo dia às 18:30')
    expect(describeCron('0 9 15 * *')).toBe('Todo mês no dia 15 às 09:00')
    expect(describeCron('*/10 * * * *')).toBe('A cada 10 min')
    expect(describeCron('0 8 1 1 *')).toBe('Cron: 0 8 1 1 *')
    expect(describeCron('isso não')).toBeNull()
  })

  it('linha da tabela, "há 2 h" e o cabeçalho do pedido', () => {
    const task = { schedule: { kind: 'weekly', days: [5], time: '17:00' } as Schedule, timezone: SP, nextRunAt: '2026-11-20T20:00:00.000Z', enabled: true, autoPaused: false }
    expect(scheduleLine(task)).toBe('Toda sexta às 17:00 · próxima: sex 20/11 17:00')
    expect(scheduleLine({ ...task, enabled: false })).toBe('Toda sexta às 17:00')
    expect(agoLabel(0, 2 * 60 * 60_000 + 5)).toBe('há 2 h')
    expect(agoLabel(0, 30_000)).toBe('agora')
    expect(promptHeader(at('2026-11-16T22:30:00Z'), SP)).toBe('Agora: segunda, 16/11/2026 19:30 (America/Sao_Paulo).')
  })
})

describe('validação (contrato 23, CA1 e CA3)', () => {
  const agent = {
    id: null,
    name: 'Resumo',
    description: '',
    icon: 'bot',
    color: 'blue',
    instructions: 'Resuma.',
    profile: 'claude',
    model: 'sonnet',
    thinkMore: false,
    scope: { kind: '7d' },
    mcpServers: [],
    output: { kind: 'chat' },
  }
  const task = {
    id: null,
    name: 'Sexta',
    agentId: 'a1',
    message: 'Resuma a semana.',
    schedule: { kind: 'weekly', days: [5], time: '17:00' },
    timezone: SP,
    enabled: true,
    runOnce: false,
    runOnceAction: 'disable',
    timeoutS: 300,
    notify: 'on-error',
    output: null,
  }

  it('agente: nome de 1 a 40 numa linha, instruções até 8 000, modelos do perfil, sem MCP e só as quatro saídas', () => {
    expect(agentInputSchema.safeParse(agent).success).toBe(true)
    expect(agentInputSchema.safeParse({ ...agent, name: '' }).success).toBe(false)
    expect(agentInputSchema.safeParse({ ...agent, name: 'x'.repeat(41) }).success).toBe(false)
    expect(agentInputSchema.safeParse({ ...agent, name: 'linha\nquebrada' }).success).toBe(false)
    expect(agentInputSchema.safeParse({ ...agent, instructions: 'x'.repeat(8_001) }).success).toBe(false)
    expect(agentInputSchema.safeParse({ ...agent, model: 'gpt-5' }).success).toBe(false)
    expect(agentInputSchema.safeParse({ ...agent, mcpServers: ['github'] }).success).toBe(false)
    // Nenhuma saída manda nada para fora do Mac: WhatsApp, e-mail ou "enviar" não existem.
    for (const kind of ['whatsapp', 'email', 'send', 'webhook']) expect(agentInputSchema.safeParse({ ...agent, output: { kind } }).success).toBe(false)
  })

  it('tarefa: frequência, fuso IANA, tempo máximo de 30 a 1 800 s e cron validado', () => {
    expect(taskInputSchema.safeParse(task).success).toBe(true)
    expect(taskInputSchema.safeParse({ ...task, timezone: 'Lua/Base' }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, timeoutS: 10 }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, timeoutS: 1_801 }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, name: 'x'.repeat(61) }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, message: 'x'.repeat(4_001) }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'every', minutes: 4 }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'every', minutes: 1_441 }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'weekly', days: [], time: '08:00' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'weekly', days: [1, 1], time: '08:00' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'daily', time: '24:00' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'monthly', day: 29, time: '08:00' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'cron', expr: '0 8 * * 1-5' }).success).toBe(true)
    expect(scheduleSchema.safeParse({ kind: 'cron', expr: '0 8 * *' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'after-meeting', delayMin: 61 }).success).toBe(false)
  })
})
