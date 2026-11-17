// Contrato 12: textos da conta Microsoft e do bloco "Agenda", a hora de "Próximas" e a origem no detalhe.
import { describe, expect, it } from 'vitest'
import { OAUTH_ERRORS, type MicrosoftAccountStatus } from '../../src/shared/accounts'
import { calendarOriginLabel, upcomingTimeLabel } from '../../src/renderer/src/features/calendar/format'
import { isCalendarChosen, microsoftAccountLine, microsoftClientSaveErrorText, microsoftSignInErrorText, toggleCalendar } from '../../src/renderer/src/features/settings/microsoftFormat'

const status = (patch: Partial<MicrosoftAccountStatus>): MicrosoftAccountStatus => ({ client: { configured: true, clientId: '111111•••555555555555' }, state: 'signed-out', profile: null, error: null, calendar: false, ...patch })
const local = (hours: number, minutes: number): string => new Date(2026, 10, 17, hours, minutes).toISOString()

describe('conta Microsoft (CA1)', () => {
  it('a linha de cada estado, sem segredo', () => {
    expect(microsoftAccountLine(null)).toBe('')
    expect(microsoftAccountLine(status({ client: { configured: false, clientId: null } }))).toBe('Para avisar as reuniões da sua agenda do Outlook.')
    expect(microsoftAccountLine(status({}))).toBe('Cadastro 111111•••555555555555')
    expect(microsoftAccountLine(status({ state: 'signing-in' }))).toBe('Continue no navegador…')
    expect(microsoftAccountLine(status({ state: 'expired' }))).toBe('Sessão expirada. Entre de novo.')
    expect(microsoftAccountLine(status({ state: 'signed-in', profile: { name: 'Bruno', email: 'bruno@example.com', photo: null } }))).toBe('bruno@example.com')
  })

  it('todo erro tem texto (cancelar não diz nada)', () => {
    for (const code of OAUTH_ERRORS) expect(code === 'cancelled' ? microsoftSignInErrorText(code) === null : (microsoftSignInErrorText(code) ?? '').length > 0).toBe(true)
    expect(microsoftClientSaveErrorText('invalid-id')).toContain('00000000-0000-0000-0000-000000000000')
  })
})

describe('agendas escolhidas (CA3)', () => {
  it('sem escolha, só a principal; marcar e desmarcar partem da principal', () => {
    expect(isCalendarChosen(null, 'primary', true)).toBe(true)
    expect(isCalendarChosen(null, 'equipe', false)).toBe(false)
    expect(toggleCalendar(null, ['primary'], 'equipe', true)).toEqual(['primary', 'equipe'])
    expect(toggleCalendar(null, ['primary'], 'primary', false)).toEqual([])
    expect(toggleCalendar(['primary', 'equipe'], ['primary'], 'equipe', false)).toEqual(['primary'])
    expect(isCalendarChosen([], 'primary', true)).toBe(false)
  })
})

describe('"Próximas" e o detalhe (CA9, CA10)', () => {
  it('hora: "Agora" para a que acontece, início e fim para a próxima', () => {
    expect(upcomingTimeLabel({ start: local(13, 57), end: local(14, 30), happening: true })).toBe('Agora')
    expect(upcomingTimeLabel({ start: local(14, 5), end: local(14, 35), happening: false })).toBe('14:05–14:35')
  })

  it('"Da agenda: <provedor> · <hora>"; sem evento (ou só com os participantes do contrato 10), nada', () => {
    expect(calendarOriginLabel({ provider: 'microsoft', eventId: 'm1', title: 'Status', start: local(9, 30), end: local(10, 0), attendees: [], joinUrl: null })).toBe('Da agenda: Microsoft · 09:30')
    expect(calendarOriginLabel({ attendees: [{ name: 'Ana', email: '' }] })).toBeNull()
    expect(calendarOriginLabel(null)).toBeNull()
    expect(calendarOriginLabel(undefined)).toBeNull()
  })
})
