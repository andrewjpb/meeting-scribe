import { CalendarX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { INVITE_ACCESS_DESCRIPTION, INVITE_ADD_ON_ACCEPT_DESCRIPTION, INVITE_CALENDAR_DESCRIPTION, INVITE_CALENDAR_NO_ACCESS_DESCRIPTION, INVITE_SUGGEST_DESCRIPTION } from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { CalendarPicker } from '../email/CalendarPicker'
import { useInvites } from '../email/inviteStore'

const ACCESS_TEXT = { full: 'permitido', notDetermined: 'não pedido', denied: 'negado', restricted: 'negado', writeOnly: 'negado' } as const

/**
 * Configurações › Email › Convites (contrato 63, CA21 e CA22, quadros 11, 11b e 11c): a agenda padrão, "Pôr na agenda ao
 * aceitar", o acesso ao Calendário do Mac e o interruptor do "Sugerir evento" (o botão e o cartão são do 64). Vale para
 * todas as contas; as agendas vêm do `scribe:invite-calendars` ao abrir.
 */
export function InvitesSection() {
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const calendars = useInvites((state) => state.calendars)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    void useInvites.getState().loadCalendars()
  }, [])

  const unavailable = calendars !== null && !calendars.ok
  const access = calendars?.ok ? calendars.access : null
  const full = access === 'full'
  const options = calendars?.ok && full ? calendars.calendars : []
  // A agenda gravada que sumiu da lista: "Escolher agenda" (o cartão já recebe a padrão do 62).
  const saved = settings.inviteCalendarId
  const value = saved !== null ? (options.some((item) => item.id === saved) ? saved : null) : calendars?.ok ? calendars.defaultId : null

  const requestAccess = (): void => {
    setAsking(true)
    void window.__scribeApi
      .invoke('scribe:invite-request-access')
      .catch(() => null)
      .then(() => useInvites.getState().loadCalendars())
      .finally(() => setAsking(false))
  }

  return (
    <Section title="Convites" anchor="convites">
      {unavailable && (
        <div className="py-3">
          <Note id="invite-calendar-unavailable" icon={CalendarX} role="status">
            O Calendário do Mac só existe no macOS.
          </Note>
        </div>
      )}
      <SettingRow name="Agenda padrão" htmlFor="invite-default-calendar" description={calendars === null || full || unavailable ? INVITE_CALENDAR_DESCRIPTION : INVITE_CALENDAR_NO_ACCESS_DESCRIPTION}>
        <CalendarPicker id="invite-default-calendar" label="Agenda padrão" calendars={options} value={value} disabled={!full} onChange={(inviteCalendarId) => void update({ inviteCalendarId })} />
      </SettingRow>
      <SettingRow name="Pôr na agenda ao aceitar" nameId="settings-invite-add-on-accept" description={INVITE_ADD_ON_ACCEPT_DESCRIPTION}>
        <Switch action="invite-add-on-accept" checked={settings.inviteAddOnAccept} disabled={unavailable} labelledBy="settings-invite-add-on-accept" onChange={(inviteAddOnAccept) => void update({ inviteAddOnAccept })} />
      </SettingRow>
      <SettingRow name="Acesso ao Calendário do Mac" description={INVITE_ACCESS_DESCRIPTION}>
        <span data-invite-access={unavailable ? 'unavailable' : (access ?? '')} className="text-13 text-text">
          {unavailable ? 'só no macOS' : access ? ACCESS_TEXT[access] : ''}
        </span>
        {access === 'notDetermined' && (
          <Button action="invite-request-access" variant="secondary" disabled={asking} onClick={requestAccess}>
            Pedir acesso
          </Button>
        )}
        {(access === 'denied' || access === 'restricted' || access === 'writeOnly') && (
          <Button action="invite-open-settings" variant="secondary" onClick={() => window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')}>
            Abrir Ajustes
          </Button>
        )}
      </SettingRow>
      <SettingRow name="Sugerir evento quando o email não tem convite" nameId="settings-invite-suggest" description={INVITE_SUGGEST_DESCRIPTION}>
        <Switch action="invite-suggest-toggle" checked={settings.inviteSuggest} labelledBy="settings-invite-suggest" onChange={(inviteSuggest) => void update({ inviteSuggest })} />
      </SettingRow>
    </Section>
  )
}
