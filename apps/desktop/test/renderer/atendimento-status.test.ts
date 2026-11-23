// Selo, respostas do dia e mensagens do agente na tela do WhatsApp (contrato 143, CA1 a CA10).
import { describe, expect, it } from 'vitest'
import { ATENDIMENTO_BINDING_DEFAULTS, isWithinHours, type AtendimentoBinding, type AtendimentoLogEntry, type AtendimentoRuntimeEntry } from '../../src/shared/atendimento'
import { isWithinHours as schedulerIsWithinHours } from '../../src/main/whatsapp/atendimento/scheduler'
import { agentMessageIds, atendimentoStatus, bindingDraft, bindingInput, bindingProblems, repliesToday, riskLines } from '../../src/renderer/src/features/atendimento/status'

const CHAT = '5511900000001@s.whatsapp.net'
// Segunda-feira, 23/11/2026, 14:00 (hora local).
const NOW = new Date(2026, 10, 23, 14, 0)

const binding = (patch: Partial<AtendimentoBinding> = {}): AtendimentoBinding => ({
  chatId: CHAT,
  agentId: 'a1',
  ...ATENDIMENTO_BINDING_DEFAULTS,
  updatedAt: NOW.toISOString(),
  ...patch,
})

const runtime = (patch: Partial<AtendimentoRuntimeEntry> = {}): AtendimentoRuntimeEntry => ({ dueAt: null, draft: null, handedOffAt: null, ...patch })

const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const status = (b: AtendimentoBinding | undefined, r?: AtendimentoRuntimeEntry, pausedAll = false) => atendimentoStatus({ binding: b, pausedAll, runtime: r, now: NOW })

describe('atendimentoStatus', () => {
  it('CA1: sem atendimento → null', () => {
    expect(status(undefined, runtime({ handedOffAt: at(-1) }))).toBeNull()
  })

  it('CA2: desligado vence tudo', () => {
    expect(status(binding({ enabled: false, pausedUntil: at(30) }), runtime({ handedOffAt: at(-1), draft: { text: 'oi', at: at(0), agentId: 'a1' } }), true)).toEqual({ kind: 'off', label: 'desligado' })
  })

  it('CA3: pausa geral', () => {
    expect(status(binding(), runtime({ handedOffAt: at(-1) }), true)).toEqual({ kind: 'all-paused', label: 'todos pausados' })
  })

  it('CA4: passou para você', () => {
    expect(status(binding(), runtime({ handedOffAt: at(-1), draft: { text: 'oi', at: at(0), agentId: 'a1' }, dueAt: at(3) }))).toEqual({ kind: 'handed-off', label: 'passou para você' })
  })

  it('CA5: propôs uma resposta', () => {
    expect(status(binding(), runtime({ draft: { text: 'oi', at: at(0), agentId: 'a1' }, dueAt: at(3) }))).toEqual({ kind: 'proposed', label: 'propôs uma resposta' })
  })

  it('CA6: responde em N min, arredondado para cima; menos de 1 min, em instantes', () => {
    expect(status(binding({ pausedUntil: at(30) }), runtime({ dueAt: at(2.2) }))).toEqual({ kind: 'scheduled', label: 'responde em 3 min' })
    expect(status(binding(), runtime({ dueAt: at(3) }))).toEqual({ kind: 'scheduled', label: 'responde em 3 min' })
    expect(status(binding(), runtime({ dueAt: at(0.5) }))).toEqual({ kind: 'scheduled', label: 'responde em instantes' })
    // No passado, o agendamento não conta.
    expect(status(binding(), runtime({ dueAt: at(-1) }))?.kind).toBe('attending')
  })

  it('CA7: pausado até HH:MM; em outro dia, DD/MM HH:MM; no passado, ignorado', () => {
    expect(status(binding({ pausedUntil: new Date(2026, 10, 23, 15, 40).toISOString() }))).toEqual({ kind: 'paused', label: 'pausado até 15:40' })
    expect(status(binding({ pausedUntil: new Date(2026, 10, 24, 9, 5).toISOString() }))).toEqual({ kind: 'paused', label: 'pausado até 24/11 09:05' })
    expect(status(binding({ pausedUntil: at(-5) }))).toEqual({ kind: 'attending', label: 'atendendo' })
  })

  it('CA8: fora do horário', () => {
    expect(status(binding({ hours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00' } }))).toEqual({ kind: 'out-of-hours', label: 'fora do horário' })
    expect(status(binding({ hours: { days: [0, 6], start: '08:00', end: '18:00' } }))?.kind).toBe('out-of-hours')
    expect(status(binding({ hours: { days: [1], start: '08:00', end: '18:00' } }))?.kind).toBe('attending')
  })

  it('CA9: nenhum dos anteriores → atendendo', () => {
    expect(status(binding(), runtime())).toEqual({ kind: 'attending', label: 'atendendo' })
    expect(status(binding(), undefined)).toEqual({ kind: 'attending', label: 'atendendo' })
  })
})

const entry = (action: AtendimentoLogEntry['action'], when: Date, extra: Partial<AtendimentoLogEntry> = {}): AtendimentoLogEntry => ({ at: when.toISOString(), chatId: CHAT, agentId: 'a1', action, ...extra })

describe('CA10', () => {
  it('repliesToday conta sent e draft-sent da conversa no dia local', () => {
    const log = [
      entry('sent', new Date(2026, 10, 23, 0, 1)),
      entry('draft-sent', new Date(2026, 10, 23, 13, 59)),
      entry('drafted', new Date(2026, 10, 23, 10, 0)),
      entry('handed-off', new Date(2026, 10, 23, 11, 0)),
      entry('sent', new Date(2026, 10, 22, 23, 59)),
      entry('sent', new Date(2026, 10, 23, 12, 0), { chatId: 'outra@s.whatsapp.net' }),
    ]
    expect(repliesToday(log, CHAT, NOW)).toBe(2)
    expect(repliesToday([], CHAT, NOW)).toBe(0)
  })

  it('agentMessageIds: messageId → agente, de sent e draft-sent, sem as linhas sem id', () => {
    const log = [
      entry('sent', NOW, { messageId: 'm1' }),
      entry('draft-sent', NOW, { messageId: 'm2', agentId: 'a2' }),
      entry('sent', NOW),
      entry('drafted', NOW, { messageId: 'm3' }),
    ]
    expect([...agentMessageIds(log)]).toEqual([
      ['m1', 'a1'],
      ['m2', 'a2'],
    ])
  })

  it('isWithinHours mudou de lugar sem mudar: o do agendador é o mesmo', () => {
    expect(schedulerIsWithinHours).toBe(isWithinHours)
    expect(isWithinHours(null, NOW)).toBe(true)
    expect(isWithinHours({ days: [5], start: '22:00', end: '06:00' }, new Date(2026, 10, 28, 5, 0))).toBe(true)
  })
})

describe('formulário do painel', () => {
  it('conversa nova começa com os padrões e o agente pedido', () => {
    const draft = bindingDraft(undefined, 'a1')
    expect(draft).toMatchObject({ agentId: 'a1', enabled: true, mode: 'draft', delayMin: '2', delayMax: '5', typing: true, identify: false, hoursMode: 'always', maxPerHour: '6', pause: '60' })
    expect(bindingProblems(draft)).toEqual({})
    expect(bindingInput(CHAT, draft)).toEqual({ chatId: CHAT, agentId: 'a1', enabled: true, mode: 'draft', delayMinMinutes: 2, delayMaxMinutes: 5, typing: true, identify: false, about: '', hours: null, maxPerHour: 6, pauseOnMyReplyMinutes: 60 })
  })

  it('atendimento salvo volta como foi gravado, com os dias em ordem ao salvar', () => {
    const draft = bindingDraft(binding({ hours: { days: [0, 1], start: '07:00', end: '22:00' }, mode: 'auto' }))
    expect(draft).toMatchObject({ hoursMode: 'pick', days: [0, 1], start: '07:00', end: '22:00', mode: 'auto' })
    expect(bindingInput(CHAT, { ...draft, days: [5, 1, 3] }).hours).toEqual({ days: [1, 3, 5], start: '07:00', end: '22:00' })
  })

  it('problemas: atraso invertido, número fora do limite, nenhum dia', () => {
    const base = bindingDraft(undefined, 'a1')
    expect(bindingProblems({ ...base, delayMin: '5', delayMax: '2' }).delay).toBeDefined()
    expect(bindingProblems({ ...base, delayMin: '121' }).delay).toBeDefined()
    expect(bindingProblems({ ...base, maxPerHour: '0' }).maxPerHour).toBeDefined()
    expect(bindingProblems({ ...base, maxPerHour: '31' }).maxPerHour).toBeDefined()
    expect(bindingProblems({ ...base, pause: '1441' }).pause).toBeDefined()
    expect(bindingProblems({ ...base, pause: 'x' }).pause).toBeDefined()
    expect(bindingProblems({ ...base, hoursMode: 'pick', days: [] }).hours).toBe('Escolha pelo menos um dia.')
    expect(bindingProblems({ ...base, hoursMode: 'pick', start: '25:00' }).hours).toBeDefined()
  })

  it('linhas do aviso de risco', () => {
    expect(riskLines({ delayMin: '2', delayMax: '5', typing: true, maxPerHour: '6' })).toEqual(['espera de 2 a 5 minutos antes de responder;', 'mostra “digitando…” antes de enviar;', 'responde no máximo 6 vezes por hora.'])
    expect(riskLines({ delayMin: '0', delayMax: '0', typing: false, maxPerHour: '3' })).toEqual(['responde sem espera;', 'responde no máximo 3 vezes por hora.'])
  })
})
