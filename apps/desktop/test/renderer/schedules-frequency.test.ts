import { describe, expect, it } from 'vitest'
import { copyName } from '../../src/renderer/src/features/agents/AgentForm'
import { defaultDraft, draftOf, FREQUENCY_OPTIONS, scheduleOf } from '../../src/renderer/src/features/schedules/frequency'
import { taskErrorText } from '../../src/renderer/src/features/schedules/TaskForm'

const SP = 'America/Sao_Paulo'
const NOW = Date.parse('2026-11-16T10:00:00Z')

describe('frequência do formulário de tarefa (contrato 23, CA4)', () => {
  it('seletores simples viram o schedule da tarefa e voltam para editar', () => {
    const base = defaultDraft(NOW, SP)
    expect(scheduleOf({ ...base, kind: 'every', everyValue: 2, everyUnit: 'h' }, SP, NOW)).toEqual({ schedule: { kind: 'every', minutes: 120 } })
    expect(scheduleOf({ ...base, kind: 'every', everyValue: 3, everyUnit: 'min' }, SP, NOW)).toEqual({ error: 'Escolha de 5 min a 24 h.' })
    expect(scheduleOf({ ...base, kind: 'weekly', days: [5, 1], time: '17:00' }, SP, NOW)).toEqual({ schedule: { kind: 'weekly', days: [1, 5], time: '17:00' } })
    expect(scheduleOf({ ...base, kind: 'weekly', days: [] }, SP, NOW)).toEqual({ error: 'Escolha pelo menos um dia.' })
    expect(scheduleOf({ ...base, kind: 'monthly', monthDay: 31 }, SP, NOW)).toEqual({ error: 'Escolha um dia de 1 a 28.' })
    // "Uma vez em" na hora do fuso da tarefa.
    expect(scheduleOf({ ...base, kind: 'once', onceAt: '2026-11-20T17:00' }, SP, NOW)).toEqual({ schedule: { kind: 'once', at: '2026-11-20T20:00:00.000Z' } })
    expect(scheduleOf({ ...base, kind: 'once', onceAt: '2026-11-01T17:00' }, SP, NOW)).toEqual({ error: 'Escolha um horário no futuro.' })
    expect(scheduleOf({ ...base, kind: 'cron', cron: ' 0  8 * * 1-5 ' }, SP, NOW)).toEqual({ schedule: { kind: 'cron', expr: '0 8 * * 1-5' } })
    expect('error' in scheduleOf({ ...base, kind: 'cron', cron: '0 8 * *' }, SP, NOW)).toBe(true)
    expect(scheduleOf({ ...base, kind: 'after-meeting', delayMin: 10 }, SP, NOW)).toEqual({ schedule: { kind: 'after-meeting', delayMin: 10 } })
    expect(draftOf({ kind: 'every', minutes: 90 }, NOW, SP)).toMatchObject({ kind: 'every', everyValue: 90, everyUnit: 'min' })
    expect(draftOf({ kind: 'once', at: '2026-11-20T20:00:00.000Z' }, NOW, SP)).toMatchObject({ kind: 'once', onceAt: '2026-11-20T17:00' })
  })

  it('contrato 162: "Quando chega mensagem do WhatsApp" no seletor, antes do cron, com espera de 5 a 600 s', () => {
    const values = FREQUENCY_OPTIONS.map((option) => option.value)
    expect(FREQUENCY_OPTIONS.find((option) => option.value === 'whatsapp-message')?.label).toBe('Quando chega mensagem do WhatsApp')
    expect(values.indexOf('whatsapp-message')).toBe(values.indexOf('cron') - 1)
    const base = defaultDraft(NOW, SP)
    expect(base).toMatchObject({ esperaSeg: 30, grupos: false })
    expect(scheduleOf({ ...base, kind: 'whatsapp-message' }, SP, NOW)).toEqual({ schedule: { kind: 'whatsapp-message', esperaSeg: 30, grupos: false } })
    expect(scheduleOf({ ...base, kind: 'whatsapp-message', esperaSeg: 4 }, SP, NOW)).toEqual({ error: 'Escolha de 5 a 600 s.' })
    expect('error' in scheduleOf({ ...base, kind: 'whatsapp-message', esperaSeg: 601 }, SP, NOW)).toBe(true)
    expect(draftOf({ kind: 'whatsapp-message', esperaSeg: 90, grupos: true }, NOW, SP)).toMatchObject({ kind: 'whatsapp-message', esperaSeg: 90, grupos: true })
  })

  it('contrato 162: a recusa da unicidade da triagem aparece como veio; as outras pela frase do formulário', () => {
    expect(taskErrorText('Já existe um agente de triagem ativo: Triagem do WhatsApp')).toBe('Já existe um agente de triagem ativo: Triagem do WhatsApp')
    expect(taskErrorText('full')).toBe('Limite de agendamentos atingido.')
    expect(taskErrorText('???')).toBe('Confira os campos do agendamento.')
  })

  it('"Duplicar" agente: nome com "(cópia)" que não repete', () => {
    expect(copyName('Resumo', [{ name: 'Resumo' }])).toBe('Resumo (cópia)')
    expect(copyName('Resumo', [{ name: 'Resumo' }, { name: 'resumo (cópia)' }])).toBe('Resumo (cópia 2)')
    expect(copyName('x'.repeat(40), []).length).toBe(40)
  })
})
