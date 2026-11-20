// O que o cartão do convite mostra (contrato 63, CA24): a etiqueta e o tom de cada `kind`, os blocos de cada quadro
// (01–08, 12–16) com as combinações de `calendar.status`, `actions`, `addDefault`/`addHint`, `recurrenceBlocked`,
// `notForMe`, `replyable` e `notice`, o cartão sem estado (CA1), o `afterReply` e a trava do "Enviando".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailInvite } from '../../src/shared/invite'
import { INVITE_KINDS, type InviteCalendarStatus, type InviteState } from '../../src/shared/invite-state'
import { useInvites } from '../../src/renderer/src/features/email/inviteStore'
import { afterReply, availabilityFor, INVITE_BADGES, inviteView } from '../../src/renderer/src/features/email/inviteView'

const invite = (over: Partial<EmailInvite> = {}): EmailInvite => ({
  method: 'REQUEST',
  uid: 'revisao-0001@northwind.example',
  sequence: 0,
  dtstamp: '2026-11-19T10:00:00.000Z',
  recurrenceId: null,
  status: 'CONFIRMED',
  title: 'Revisão semanal Northwind',
  allDay: false,
  start: '2026-11-20T18:00:00.000Z',
  end: '2026-11-20T19:00:00.000Z',
  timeZone: 'America/New_York',
  originalTzid: 'America/New_York',
  location: 'Northwind, sala Hudson',
  description: null,
  joinUrl: 'https://meet.google.com/xpq-rtzm-kva',
  organizer: { name: 'Daniel Brooks', address: 'daniel.brooks@northwind.example' },
  attendees: [{ name: 'Andrew Teste', address: 'andrew.teste@lap.example', partstat: 'NEEDS-ACTION' }],
  attendeeCount: 8,
  self: { name: 'Andrew Teste', address: 'andrew.teste@lap.example', partstat: 'NEEDS-ACTION' },
  recurrence: null,
  exceptions: [],
  warnings: [],
  source: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  ...over,
})

const NO_ACTIONS: InviteState['actions'] = { add: false, update: false, remove: false, openIcs: false, requestAccess: false, openSettings: false }
const APP: InviteCalendarStatus = { status: 'app', calendarId: 'cal-trabalho', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' }
const ACCEPTED = { partstat: 'ACCEPTED' as const, at: Date.parse('2026-11-19T14:20:00.000Z') }

const state = (over: Partial<InviteState> = {}): InviteState => ({
  accountId: 'conta',
  id: '7',
  uid: 'revisao-0001@northwind.example',
  recurrenceId: null,
  method: 'REQUEST',
  kind: 'new',
  response: null,
  calendar: { status: 'absent' },
  changes: [],
  addDefault: true,
  addHint: null,
  defaultCalendarId: 'cal-trabalho',
  replyable: true,
  notForMe: false,
  recurrenceBlocked: false,
  replier: null,
  notice: null,
  actions: { ...NO_ACTIONS, add: true },
  error: null,
  ...over,
})

/** Os blocos que aparecem, para comparar de uma vez. */
const blocks = (view: ReturnType<typeof inviteView>): string[] =>
  Object.entries({
    addRow: view.addRow,
    addAfter: view.addAfter,
    addPrimary: view.addPrimary,
    replyButtons: view.replyButtons,
    responseSegment: view.responseSegment,
    updateButton: view.updateButton,
    removeButton: view.removeButton,
    readd: view.readd !== null,
    missing: view.missing !== null,
    noAccess: view.noAccess !== null,
    openIcsButton: view.openIcsButton,
    notStorable: view.notStorable !== null,
    notForMe: view.notForMe,
    reconciled: view.reconciled,
    accountAdds: view.accountAdds,
    oldVersion: view.oldVersion,
    error: view.error !== null,
  })
    .filter(([, on]) => on)
    .map(([name]) => name)

describe('inviteView: etiqueta (CA3)', () => {
  it('cada kind do INVITE_KINDS tem o texto e o tom do CA3', () => {
    const expected: Record<string, [string, string]> = {
      new: ['Novo', 'outline'],
      'update-pending': ['Atualização pendente', 'outline'],
      'in-calendar': ['Na agenda', 'solid'],
      'already-in-calendar': ['Já estava na agenda', 'muted'],
      responded: ['Respondido', 'muted'],
      'reply-received': ['Resposta recebida', 'muted'],
      old: ['Antigo', 'muted'],
      cancelled: ['Cancelado', 'danger'],
      error: ['Erro', 'danger'],
    }
    for (const kind of INVITE_KINDS) {
      const view = inviteView({ invite: invite(), state: state({ kind }) })
      expect([view.badge?.text, view.badge?.tone], kind).toEqual(expected[kind])
      expect(view.stateAttr).toBe(kind)
    }
    // O tom tracejado é só do 64 (sugestão): nenhum kind usa.
    expect(Object.values(INVITE_BADGES).some((badge) => badge.tone === 'dashed')).toBe(false)
  })

  it('o rótulo do tipo', () => {
    expect(inviteView({ invite: invite(), state: state() }).typeLabel).toBe('Convite de reunião')
    expect(inviteView({ invite: invite(), state: state({ kind: 'update-pending' }) }).typeLabel).toBe('Convite atualizado')
    expect(inviteView({ invite: invite({ method: 'CANCEL' }), state: state({ kind: 'cancelled', method: 'CANCEL' }) }).typeLabel).toBe('Convite cancelado')
    expect(inviteView({ invite: invite({ method: 'REPLY' }), state: state({ kind: 'reply-received', method: 'REPLY' }) }).typeLabel).toBe('Resposta ao convite')
  })
})

describe('inviteView: quadros', () => {
  it('01 novo: caixa "Pôr na agenda" e Aceitar · Talvez · Recusar', () => {
    const view = inviteView({ invite: invite(), state: state() })
    expect(blocks(view)).toEqual(['addRow', 'replyButtons'])
    expect(view.status).toBeNull()
  })

  it('02 na agenda: a linha "Na agenda" e o segmentado', () => {
    const view = inviteView({ invite: invite(), state: state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED, actions: { ...NO_ACTIONS, remove: true } }) })
    expect(blocks(view)).toEqual(['responseSegment'])
    expect(view.status).toEqual({ kind: 'in-calendar', calendarTitle: 'Trabalho', sourceTitle: 'iCloud', response: ACCEPTED })
  })

  it('03 já estava na agenda: sem "Pôr na agenda", com os botões', () => {
    const view = inviteView({ invite: invite(), state: state({ kind: 'already-in-calendar', calendar: { status: 'account', calendarTitle: 'andrew@gmail.example', sourceTitle: 'Google', merged: false }, actions: NO_ACTIONS }) })
    expect(blocks(view)).toEqual(['replyButtons'])
    expect(view.status).toMatchObject({ kind: 'already', calendarTitle: 'andrew@gmail.example' })
  })

  it('04 atualização pendente: as mudanças marcadas e "Atualizar na agenda" só com actions.update', () => {
    const before = { start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', allDay: false, timeZone: 'America/New_York' }
    const after = { start: '2026-11-20T19:30:00Z', end: '2026-11-20T20:30:00Z', allDay: false, timeZone: 'America/New_York' }
    const pending = state({
      kind: 'update-pending',
      calendar: APP,
      response: ACCEPTED,
      changes: [
        { field: 'time', before, after },
        { field: 'location', before: 'Northwind, sala Hudson', after: 'Northwind, sala Chelsea' },
      ],
      actions: { ...NO_ACTIONS, update: true, remove: true },
    })
    const view = inviteView({ invite: invite(), state: pending })
    expect(blocks(view)).toEqual(['responseSegment', 'updateButton'])
    expect(Object.keys(view.changes)).toEqual(['time', 'location'])
    expect(view.updating).toBe(true)
    expect(view.status).toEqual({ kind: 'update', calendarTitle: 'Trabalho', partstat: 'ACCEPTED' })
    expect(inviteView({ invite: invite(), state: { ...pending, actions: NO_ACTIONS } }).updateButton).toBe(false)
    // As mudanças só valem em update-pending.
    expect(inviteView({ invite: invite(), state: { ...pending, kind: 'in-calendar' } }).changes).toEqual({})
  })

  it('05 cancelado: "Tirar da agenda" só quando o app gravou; depois do clique, "Tirado"', () => {
    const cancel = invite({ method: 'CANCEL', status: 'CANCELLED' })
    const withApp = inviteView({ invite: cancel, state: state({ kind: 'cancelled', method: 'CANCEL', replyable: false, calendar: APP, actions: { ...NO_ACTIONS, remove: true } }) })
    expect(blocks(withApp)).toEqual(['removeButton'])
    expect(withApp.cancelled).toBe(true)
    expect(withApp.status).toEqual({ kind: 'cancelled', occurrence: null, mode: 'app', calendarTitle: 'Trabalho' })
    const without = inviteView({ invite: cancel, state: state({ kind: 'cancelled', method: 'CANCEL', replyable: false, calendar: { status: 'skipped' }, actions: NO_ACTIONS }) })
    expect(blocks(without)).toEqual([])
    expect(without.status).toMatchObject({ mode: 'account' })
    const removed = inviteView({ invite: cancel, state: state({ kind: 'cancelled', method: 'CANCEL', replyable: false, calendar: { status: 'skipped' }, actions: NO_ACTIONS }), removed: { calendarTitle: 'Trabalho' } })
    expect(removed.status).toMatchObject({ mode: 'removed', calendarTitle: 'Trabalho' })
    expect(removed.removeButton).toBe(false)
    const occurrence = inviteView({ invite: cancel, state: state({ kind: 'cancelled', method: 'CANCEL', recurrenceId: '2026-12-17T13:00:00Z', replyable: false, calendar: APP, actions: { ...NO_ACTIONS, remove: true } }) })
    expect(occurrence.status).toMatchObject({ occurrence: '2026-12-17T13:00:00Z' })
  })

  it('06 sem acesso: a resposta acima da nota com "Abrir Ajustes" e "Abrir no app de agenda"; os botões continuam', () => {
    const noAccess = state({ kind: 'responded', response: ACCEPTED, calendar: { status: 'no-access', access: 'denied' }, actions: { ...NO_ACTIONS, openIcs: true, openSettings: true } })
    const view = inviteView({ invite: invite(), state: noAccess })
    expect(blocks(view)).toEqual(['responseSegment', 'noAccess'])
    expect(view.noAccess).toEqual({ openSettings: true, openIcs: true })
    expect(view.status).toEqual({ kind: 'responded', response: ACCEPTED })
    // Antes de responder: os três botões e a etiqueta Novo.
    const before = inviteView({ invite: invite(), state: { ...noAccess, kind: 'new', response: null } })
    expect(blocks(before)).toEqual(['replyButtons', 'noAccess'])
    expect(before.badge?.text).toBe('Novo')
  })

  it('06 fora do macOS (unavailable): sem nota, "Abrir no app de agenda" no lugar da caixa', () => {
    const view = inviteView({ invite: invite(), state: state({ calendar: { status: 'unavailable', reason: 'platform' }, actions: { ...NO_ACTIONS, openIcs: true } }) })
    expect(blocks(view)).toEqual(['replyButtons', 'openIcsButton'])
  })

  it('07 não é para você: sem botões de resposta, "Pôr na agenda" primário', () => {
    const view = inviteView({ invite: invite({ self: null }), state: state({ notForMe: true, replyable: false }) })
    expect(blocks(view)).toEqual(['addPrimary', 'notForMe'])
    expect(inviteView({ invite: invite({ self: null }), state: state({ notForMe: true, replyable: false, actions: NO_ACTIONS }) }).addPrimary).toBe(false)
  })

  it('08 resposta recebida: compacto, sem botões', () => {
    const view = inviteView({ invite: invite({ method: 'REPLY', self: null }), state: state({ kind: 'reply-received', method: 'REPLY', replyable: false, notForMe: true, calendar: { status: 'skipped' }, actions: NO_ACTIONS, replier: { name: 'Carla', address: 'carla@exemplo.example', partstat: 'ACCEPTED' } }) })
    expect(view.compact).toBe(true)
    expect(blocks(view)).toEqual([])
  })

  it('12 conta que já põe sozinha: caixa desmarcada (addDefault) e a frase do R5b', () => {
    const view = inviteView({ invite: invite(), state: state({ addDefault: false, addHint: 'account-adds' }) })
    expect(blocks(view)).toEqual(['addRow', 'replyButtons', 'accountAdds'])
  })

  it('13 reconciliado: "Na agenda" da conta e a nota só com notice', () => {
    const merged = state({ kind: 'in-calendar', response: ACCEPTED, calendar: { status: 'account', calendarTitle: 'Trabalho', sourceTitle: 'Google', merged: true }, notice: 'merged', actions: NO_ACTIONS })
    const view = inviteView({ invite: invite(), state: merged })
    expect(blocks(view)).toEqual(['responseSegment', 'reconciled'])
    expect(view.status).toMatchObject({ kind: 'in-calendar', sourceTitle: 'Google' })
    expect(inviteView({ invite: invite(), state: { ...merged, notice: null } }).reconciled).toBe(false)
  })

  it('14 não encontrei: "Pôr de novo" com a agenda de antes e o segmentado', () => {
    const view = inviteView({ invite: invite(), state: state({ kind: 'responded', response: ACCEPTED, calendar: { status: 'missing', calendarId: 'cal-trabalho', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' } }) })
    expect(blocks(view)).toEqual(['responseSegment', 'readd', 'missing'])
    expect(view.readd).toEqual({ calendarId: 'cal-trabalho' })
    expect(view.status).toBeNull()
    expect(inviteView({ invite: invite(), state: state({ kind: 'responded', response: ACCEPTED, calendar: { status: 'missing', calendarId: 'x', calendarTitle: null, sourceTitle: null }, actions: NO_ACTIONS }) }).readd).toBeNull()
  })

  it('15 repetição que não dá para copiar: sem caixa, a nota com "Abrir no app de agenda", os botões ficam', () => {
    const view = inviteView({ invite: invite(), state: state({ recurrenceBlocked: true, actions: { ...NO_ACTIONS, openIcs: true } }) })
    expect(blocks(view)).toEqual(['replyButtons', 'notStorable'])
    expect(view.notStorable).toEqual({ openIcs: true })
  })

  it('respondido com o evento fora da agenda: "Pôr na agenda" secundário no lugar da caixa (só Aceito e Talvez)', () => {
    expect(blocks(inviteView({ invite: invite(), state: state({ kind: 'responded', response: ACCEPTED }) }))).toEqual(['addAfter', 'responseSegment'])
    expect(blocks(inviteView({ invite: invite(), state: state({ kind: 'responded', response: { partstat: 'TENTATIVE', at: 1 }, calendar: { status: 'needs-access' } }) }))).toEqual(['addAfter', 'responseSegment'])
    expect(blocks(inviteView({ invite: invite(), state: state({ kind: 'responded', response: { partstat: 'DECLINED', at: 1 } }) }))).toEqual(['responseSegment'])
    // Sem actions.add do 62 (sem acesso, repetição bloqueada…), nada.
    expect(inviteView({ invite: invite(), state: state({ kind: 'responded', response: ACCEPTED, actions: NO_ACTIONS }) }).addAfter).toBe(false)
  })

  it('16 needs-access: a caixa aparece normal', () => {
    expect(blocks(inviteView({ invite: invite(), state: state({ calendar: { status: 'needs-access' }, actions: { ...NO_ACTIONS, add: true, requestAccess: true } }) }))).toEqual(['addRow', 'replyButtons'])
  })

  it('antigo e erro', () => {
    expect(blocks(inviteView({ invite: invite(), state: state({ kind: 'old', replyable: false, actions: NO_ACTIONS }) }))).toEqual(['oldVersion'])
    const error = inviteView({ invite: invite(), state: state({ kind: 'error', calendar: { status: 'error', code: 'failed' }, actions: NO_ACTIONS, error: { code: 'failed', message: 'O Calendário não respondeu. Tente de novo.' } }) })
    expect(blocks(error)).toEqual(['replyButtons', 'error'])
    expect(error.error).toBe('O Calendário não respondeu. Tente de novo.')
  })

  it('cada calendar.status com actions.add ligada: a caixa só em absent e needs-access', () => {
    const statuses: InviteCalendarStatus[] = [
      { status: 'unavailable', reason: 'platform' },
      { status: 'needs-access' },
      { status: 'no-access', access: 'denied' },
      { status: 'absent' },
      APP,
      { status: 'account', calendarTitle: 'Trabalho', sourceTitle: 'Google', merged: false },
      { status: 'missing', calendarId: 'cal-trabalho', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' },
      { status: 'skipped' },
      { status: 'error', code: 'failed' },
    ]
    const withRow = statuses.filter((calendar) => inviteView({ invite: invite(), state: state({ calendar }) }).addRow).map((calendar) => calendar.status)
    expect(withRow).toEqual(['needs-access', 'absent'])
  })

  it('CA1: sem estado, Erro, a frase e os botões de resposta pelo convite do corpo', () => {
    const view = inviteView({ invite: invite(), state: null })
    expect(view.stateAttr).toBe('error')
    expect(view.badge).toEqual({ text: 'Erro', tone: 'danger' })
    expect(view.error).toBe('Não foi possível conferir a agenda agora.')
    expect(blocks(view)).toEqual(['replyButtons', 'error'])
    expect(inviteView({ invite: invite({ organizer: null }), state: null }).replyButtons).toBe(false)
    expect(inviteView({ invite: invite({ self: null }), state: null }).replyButtons).toBe(false)
    expect(inviteView({ invite: invite({ method: 'CANCEL' }), state: null }).replyButtons).toBe(false)
  })

  it('lendo: sem etiqueta e sem botões', () => {
    const view = inviteView({ invite: invite(), state: undefined })
    expect(view.stateAttr).toBe('loading')
    expect(view.badge).toBeNull()
    expect(blocks(view)).toEqual([])
  })
})

describe('afterReply (CA7)', () => {
  it('aceitar e talvez com a caixa marcada gravam; desmarcada, nada', () => {
    expect(afterReply(state(), 'ACCEPTED', true)).toBe('add')
    expect(afterReply(state(), 'TENTATIVE', true)).toBe('add')
    expect(afterReply(state(), 'ACCEPTED', false)).toBeNull()
    expect(afterReply(state({ calendar: { status: 'needs-access' } }), 'ACCEPTED', true)).toBe('add')
  })

  it('já na agenda pela conta (R5a) e "não encontrei": nunca add', () => {
    expect(afterReply(state({ calendar: { status: 'account', calendarTitle: 'x', sourceTitle: 'Google', merged: false }, actions: NO_ACTIONS }), 'ACCEPTED', true)).toBeNull()
    expect(afterReply(state({ calendar: { status: 'account', calendarTitle: 'x', sourceTitle: 'Google', merged: false } }), 'ACCEPTED', true)).toBeNull()
    expect(afterReply(state({ calendar: { status: 'missing', calendarId: 'c', calendarTitle: null, sourceTitle: null } }), 'ACCEPTED', true)).toBeNull()
  })

  it('recusar tira só o que o app pôs', () => {
    expect(afterReply(state({ calendar: APP, actions: { ...NO_ACTIONS, remove: true } }), 'DECLINED', true)).toBe('remove')
    expect(afterReply(state({ actions: NO_ACTIONS }), 'DECLINED', true)).toBeNull()
  })

  it('trocar de resposta: de Aceito para Talvez, nada; de Recusado para Aceito, grava de novo', () => {
    expect(afterReply(state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED, actions: { ...NO_ACTIONS, remove: true } }), 'TENTATIVE', true)).toBeNull()
    expect(afterReply(state({ kind: 'responded', response: { partstat: 'DECLINED', at: 1 } }), 'ACCEPTED', true)).toBe('add')
  })

  it('sem estado, nada vai à agenda; a disponibilidade pela resposta', () => {
    expect(afterReply(null, 'ACCEPTED', true)).toBeNull()
    expect(availabilityFor('TENTATIVE')).toBe('tentative')
    expect(availabilityFor('ACCEPTED')).toBe('busy')
    expect(availabilityFor(null)).toBe('busy')
  })
})

describe('inviteStore: a ordem e a trava (CA7, CA9)', () => {
  const invoke = vi.fn()
  const inviteReply = vi.fn()
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    invoke.mockReset()
    inviteReply.mockReset()
    vi.stubGlobal('window', { __scribeApi: { invoke, inviteReply, on: () => () => undefined } })
    useInvites.setState({ states: {}, calendars: null, addChecked: {}, calendarChoice: {}, sending: {}, busy: {}, errors: {}, effects: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('REPLY primeiro, -add depois; um segundo clique com o envio saindo não chama o preload', async () => {
    let release: () => void = () => undefined
    inviteReply.mockImplementation(() => {
      calls.push('reply')
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, messageId: '<r@x>', reply: {} })
      })
    })
    invoke.mockImplementation(async (channel: string) => {
      calls.push(channel)
      if (channel === 'scribe:invite-add') return { ok: true, effect: 'created', state: state({ kind: 'in-calendar', calendar: APP }) }
      if (channel === 'scribe:invite-state') return { ok: true, state: state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED }) }
      throw new Error(channel)
    })
    useInvites.setState({ states: { 'conta\n7': state() } })
    const first = useInvites.getState().reply('conta', '7', 'ACCEPTED', { addChecked: true, calendarId: 'cal-trabalho' })
    expect(useInvites.getState().sending['conta\n7']).toBe('ACCEPTED')
    await useInvites.getState().reply('conta', '7', 'TENTATIVE', { addChecked: true, calendarId: 'cal-trabalho' })
    expect(inviteReply).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(calls).toEqual(['reply', 'scribe:invite-add', 'scribe:invite-state'])
    expect(invoke.mock.calls[0]).toEqual(['scribe:invite-add', { accountId: 'conta', id: '7', calendarId: 'cal-trabalho', availability: 'busy' }])
    expect(useInvites.getState().sending['conta\n7']).toBeUndefined()
    expect(useInvites.getState().states['conta\n7']?.kind).toBe('in-calendar')
  })

  it('"Pôr na agenda" depois de responder: só o -add, sem REPLY, com a disponibilidade da resposta', async () => {
    invoke.mockImplementation(async (channel: string) => {
      calls.push(channel)
      if (channel === 'scribe:invite-add') return { ok: true, effect: 'created', state: state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED }) }
      return { ok: true, state: state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED }) }
    })
    useInvites.setState({ states: { 'conta\n7': state({ kind: 'responded', response: { partstat: 'TENTATIVE', at: 1 } }) } })
    await useInvites.getState().add('conta', '7', 'cal-trabalho', availabilityFor('TENTATIVE'))
    expect(inviteReply).not.toHaveBeenCalled()
    expect(invoke.mock.calls[0]).toEqual(['scribe:invite-add', { accountId: 'conta', id: '7', calendarId: 'cal-trabalho', availability: 'tentative' }])
  })

  it('needs-access sem agenda: pede o acesso; negado ou restrito, a frase do 62 para isso (não a de "sem agenda")', async () => {
    for (const access of ['denied', 'restricted'] as const) {
      invoke.mockReset()
      invoke.mockImplementation(async (channel: string) => {
        if (channel === 'scribe:invite-request-access') return { ok: true, access, granted: false }
        if (channel === 'scribe:invite-calendars') return { ok: true, access, calendars: [], defaultId: null }
        return { ok: true, state: state({ calendar: { status: 'no-access', access } }) }
      })
      useInvites.setState({ states: { 'conta\n7': state({ calendar: { status: 'needs-access' }, defaultCalendarId: null, actions: { ...NO_ACTIONS, add: true, requestAccess: true } }) }, calendars: null, errors: {} })
      await useInvites.getState().add('conta', '7', null, 'busy')
      expect(invoke.mock.calls.some((call) => call[0] === 'scribe:invite-add'), access).toBe(false)
      expect(useInvites.getState().errors['conta\n7'], access).toBe(access === 'denied' ? 'Sem acesso ao Calendário.' : 'O acesso ao Calendário está restrito neste Mac.')
    }
  })

  it('abrir de novo limpa o erro anterior; a lista de agendas sem acesso é relida quando o estado já lê a agenda', async () => {
    invoke.mockImplementation(async (channel: string) => {
      calls.push(channel)
      if (channel === 'scribe:invite-calendars') return { ok: true, access: 'full', calendars: [{ id: 'cal-trabalho', title: 'Trabalho', sourceTitle: 'iCloud', sourceType: 'caldav', isDefault: true }], defaultId: 'cal-trabalho' }
      return { ok: true, state: state() }
    })
    useInvites.setState({ errors: { 'conta\n7': 'Clique de novo para responder.' }, calendars: { ok: true, access: 'notDetermined', calendars: [], defaultId: null } })
    await useInvites.getState().load('conta', '7')
    expect(useInvites.getState().errors['conta\n7']).toBe('Clique de novo para responder.')
    await useInvites.getState().load('conta', '7', { clearError: true })
    expect(useInvites.getState().errors['conta\n7']).toBeUndefined()
    await vi.waitFor(() => expect(useInvites.getState().calendars).toMatchObject({ ok: true, access: 'full' }))
    expect(calls.filter((channel) => channel === 'scribe:invite-calendars').length).toBeGreaterThanOrEqual(1)
  })

  it('REPLY recusado: a frase do código e nenhum canal de agenda', async () => {
    inviteReply.mockResolvedValue({ ok: false, error: 'connection' })
    useInvites.setState({ states: { 'conta\n7': state() } })
    await useInvites.getState().reply('conta', '7', 'ACCEPTED', { addChecked: true, calendarId: 'cal-trabalho' })
    expect(invoke).not.toHaveBeenCalled()
    expect(useInvites.getState().errors['conta\n7']).toBe('Sem conexão com o servidor de envio. Nada foi enviado.')
  })

  it('REPLY ok e -remove recusado: a resposta vale e o erro diz que a agenda não mudou', async () => {
    inviteReply.mockResolvedValue({ ok: true, messageId: '<r@x>', reply: {} })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'scribe:invite-remove') return { ok: false, error: 'failed', message: 'O Calendário não respondeu. Tente de novo.', state: null }
      return { ok: true, state: state({ kind: 'responded', calendar: APP, response: { partstat: 'DECLINED', at: 1 } }) }
    })
    useInvites.setState({ states: { 'conta\n7': state({ kind: 'in-calendar', calendar: APP, response: ACCEPTED, actions: { ...NO_ACTIONS, remove: true } }) } })
    await useInvites.getState().reply('conta', '7', 'DECLINED', { addChecked: false, calendarId: null })
    expect(invoke.mock.calls.map((call) => call[0])).toEqual(['scribe:invite-remove', 'scribe:invite-state'])
    expect(useInvites.getState().errors['conta\n7']).toBe('A resposta foi enviada, mas a agenda não mudou. O Calendário não respondeu. Tente de novo.')
  })
})
