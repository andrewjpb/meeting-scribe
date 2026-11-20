// Contrato 64 (CA14): a agenda do "Pôr na agenda" do cartão de sugestão, sem DOM (testado em
// test/renderer/email-suggest-target.test.ts). A escolhida no cartão ou a padrão; sem nenhuma e com o acesso nunca
// pedido (R8), pede o acesso no clique e decide pelo que o canal devolveu e pelas agendas relidas, nunca pela lista de
// antes do pedido.
import { INVITE_ERROR_MESSAGES, type InviteAccessResult, type InviteCalendarsResult } from '@shared/invite-state'

export type SuggestTarget = { id: string } | { noAccess: true } | { error: string }

export interface SuggestTargetDeps {
  /** A agenda escolhida no cartão (`null`: a padrão). */
  chosen: string | null
  /** As agendas de agora (lidas a cada chamada: mudam depois do pedido de acesso). */
  calendars: () => InviteCalendarsResult | null
  requestAccess: () => Promise<InviteAccessResult | null>
  reload: () => Promise<void>
}

const noCalendar: SuggestTarget = { error: INVITE_ERROR_MESSAGES['no-calendar'] }

export async function suggestTarget(deps: SuggestTargetDeps): Promise<SuggestTarget> {
  const before = deps.calendars()
  const picked = deps.chosen ?? (before?.ok ? before.defaultId : null)
  if (picked) return { id: picked }
  if (!before?.ok) return noCalendar
  if (before.access === 'notDetermined') {
    const asked = await deps.requestAccess().catch(() => null)
    if (!asked?.ok) return noCalendar
    if (asked.access !== 'full') return { noAccess: true }
    await deps.reload()
    const after = deps.calendars()
    // Acesso concedido, mas nenhuma agenda em que dê para gravar.
    return after?.ok && after.defaultId ? { id: after.defaultId } : noCalendar
  }
  return before.access === 'full' ? noCalendar : { noAccess: true }
}
