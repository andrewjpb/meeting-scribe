import { describe, expect, it, vi } from 'vitest'
import { INVITE_ERROR_MESSAGES, type InviteAccessResult, type InviteCalendarsResult } from '../../src/shared/invite-state'
import { suggestTarget } from '../../src/renderer/src/features/email/suggestTarget'

const trabalho = { id: 'cal-trabalho', title: 'Trabalho', sourceTitle: 'iCloud', sourceType: 'caldav' as const, isDefault: true }
const listed = (access: 'full' | 'notDetermined' | 'denied', calendars = access === 'full' ? [trabalho] : []): InviteCalendarsResult => ({ ok: true, access, calendars, defaultId: calendars[0]?.id ?? null })

/** A lista muda quando o `reload` roda, como o store depois do pedido de acesso. */
function deps(start: InviteCalendarsResult | null, asked: InviteAccessResult | null, after: InviteCalendarsResult | null, chosen: string | null = null) {
  let current = start
  const requestAccess = vi.fn(async () => asked)
  const reload = vi.fn(async () => {
    current = after
  })
  return { chosen, calendars: () => current, requestAccess, reload }
}

describe('agenda do "Pôr na agenda" da sugestão (contrato 64, CA14)', () => {
  it('a escolhida ou a padrão, sem pedir nada', async () => {
    const d = deps(listed('full'), null, null)
    expect(await suggestTarget(d)).toEqual({ id: 'cal-trabalho' })
    expect(await suggestTarget({ ...d, chosen: 'cal-pessoal' })).toEqual({ id: 'cal-pessoal' })
    expect(d.requestAccess).not.toHaveBeenCalled()
  })

  it('acesso nunca pedido: decide pelo acesso devolvido e pelas agendas relidas, não pela lista de antes', async () => {
    const granted = deps(listed('notDetermined'), { ok: true, access: 'full', granted: true }, listed('full'))
    expect(await suggestTarget(granted)).toEqual({ id: 'cal-trabalho' })
    expect(granted.reload).toHaveBeenCalledTimes(1)
    // Concedido, mas sem agenda em que dê para gravar: a frase de `no-calendar`.
    const empty = deps(listed('notDetermined'), { ok: true, access: 'full', granted: true }, listed('full', []))
    expect(await suggestTarget(empty)).toEqual({ error: INVITE_ERROR_MESSAGES['no-calendar'] })
    // Negado no pedido: sem acesso (a lista antiga dizia "não pedido").
    const denied = deps(listed('notDetermined'), { ok: true, access: 'denied', granted: false }, listed('denied'))
    expect(await suggestTarget(denied)).toEqual({ noAccess: true })
    expect(denied.reload).not.toHaveBeenCalled()
    const failed = deps(listed('notDetermined'), { ok: false, error: 'unavailable', reason: 'platform' }, null)
    expect(await suggestTarget(failed)).toEqual({ error: INVITE_ERROR_MESSAGES['no-calendar'] })
  })

  it('negado antes, ou com acesso e sem agenda: sem pedir de novo', async () => {
    const denied = deps(listed('denied'), null, null)
    expect(await suggestTarget(denied)).toEqual({ noAccess: true })
    expect(await suggestTarget(deps(listed('full', []), null, null))).toEqual({ error: INVITE_ERROR_MESSAGES['no-calendar'] })
    expect(await suggestTarget(deps(null, null, null))).toEqual({ error: INVITE_ERROR_MESSAGES['no-calendar'] })
    expect(denied.requestAccess).not.toHaveBeenCalled()
  })
})
