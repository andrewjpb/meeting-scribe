import { useEffect, useState } from 'react'
import { CALENDAR_PROVIDER_LABELS, CALENDAR_PROVIDERS, type CalendarListResult, type CalendarProvider } from '@shared/calendar'
import type { CalendarLeadMinutes } from '@shared/settings-defaults'
import { useSettings } from '../../app/settingsStore'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { useGoogle } from './googleStore'
import { isCalendarChosen, LEAD_OPTIONS, toggleCalendar } from './microsoftFormat'
import { useMicrosoft } from './microsoftStore'

/**
 * Configurações › Contas › "Agenda" (contrato 12, CA3): avisar as reuniões das agendas Google e Microsoft, quanto
 * antes, avisar quando a reunião começou e nada está gravando, e quais agendas de cada conta o app lê (padrão: a
 * principal). A lista das agendas vem do main, que pergunta às contas conectadas.
 */
export function CalendarSection() {
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const googleOn = useGoogle((state) => state.status?.state === 'signed-in' && state.status.calendar)
  const microsoftOn = useMicrosoft((state) => state.status?.state === 'signed-in' && state.status.calendar)
  /** A lista vale para as contas conectadas de quando foi pedida (`accounts`). */
  const [loaded, setLoaded] = useState<{ accounts: string; result: CalendarListResult } | null>(null)
  const accounts = `${googleOn}:${microsoftOn}`
  const list = loaded?.accounts === accounts ? loaded.result : null

  useEffect(() => {
    if (!googleOn && !microsoftOn) return
    let alive = true
    const key = `${googleOn}:${microsoftOn}`
    window.__scribeApi.invoke('scribe:calendar-list').then(
      (result) => {
        if (alive) setLoaded({ accounts: key, result })
      },
      () => {
        if (alive) setLoaded({ accounts: key, result: { calendars: [], failed: CALENDAR_PROVIDERS.filter((provider) => (provider === 'google' ? googleOn : microsoftOn)) } })
      },
    )
    return () => {
      alive = false
    }
  }, [googleOn, microsoftOn])

  const toggle = (provider: CalendarProvider, id: string, on: boolean): void => {
    const primaryIds = (list?.calendars ?? []).filter((item) => item.provider === provider && item.primary).map((item) => item.id)
    void update({ calendarIds: { ...settings.calendarIds, [provider]: toggleCalendar(settings.calendarIds[provider], primaryIds, id, on) } })
  }

  const providers = CALENDAR_PROVIDERS.filter((provider) => (provider === 'google' ? googleOn : microsoftOn))

  return (
    <Section title="Agenda">
      <SettingRow name="Avisar reuniões da agenda" nameId="settings-calendar-alerts" description="Uma notificação do macOS antes de cada reunião das agendas Google e Microsoft.">
        <Switch checked={settings.calendarAlerts} labelledBy="settings-calendar-alerts" onChange={(calendarAlerts) => void update({ calendarAlerts })} />
      </SettingRow>
      <SettingRow name="Avisar antes" nameId="settings-calendar-lead" description="Quantos minutos antes do início.">
        <Segmented
          value={String(settings.calendarLeadMinutes) as `${CalendarLeadMinutes}`}
          options={LEAD_OPTIONS}
          labelledBy="settings-calendar-lead"
          dataName="calendar-lead-option"
          onChange={(value) => void update({ calendarLeadMinutes: Number(value) as CalendarLeadMinutes })}
        />
      </SettingRow>
      <SettingRow name="Avisar se a reunião não estiver sendo gravada" nameId="settings-calendar-not-recording" description="2 minutos depois do início, e de novo aos 10, se nada estiver gravando.">
        <Switch checked={settings.calendarNotRecordingAlert} labelledBy="settings-calendar-not-recording" onChange={(calendarNotRecordingAlert) => void update({ calendarNotRecordingAlert })} />
      </SettingRow>
      <div className="flex flex-col gap-3 py-4" data-setting-row data-setting-name="Agendas" data-setting-description="Quais agendas de cada conta o app lê." data-calendar-list>
        <div className="flex flex-col gap-0.5">
          <p className="text-13 font-medium text-text">Agendas</p>
          <p className="text-12 text-text-muted">Quais agendas de cada conta o app lê. O app só lê: não responde convites nem muda nada.</p>
        </div>
        {!providers.length && <p className="text-12 text-text-muted">Entre com a conta Google ou Microsoft acima para escolher as agendas.</p>}
        {providers.map((provider) => {
          const calendars = (list?.calendars ?? []).filter((item) => item.provider === provider)
          const failed = list?.failed.includes(provider) ?? false
          return (
            <fieldset key={provider} className="flex flex-col gap-2" data-calendar-provider={provider}>
              <legend className="caps mb-1 text-text-muted">{CALENDAR_PROVIDER_LABELS[provider]}</legend>
              {list === null && <p className="text-12 text-text-muted">Lendo as agendas…</p>}
              {failed && <p className="text-12 text-text-muted">Não foi possível ler as agendas desta conta agora.</p>}
              {calendars.map((item) => {
                const id = `calendar-${provider}-${item.id}`
                return (
                  <label key={item.id} htmlFor={id} className="flex min-w-0 items-center gap-2.5 text-13 text-text">
                    <input
                      id={id}
                      type="checkbox"
                      data-calendar-check={`${provider}:${item.id}`}
                      checked={isCalendarChosen(settings.calendarIds[provider], item.id, item.primary)}
                      onChange={(event) => toggle(provider, item.id, event.target.checked)}
                      className="no-drag size-4 shrink-0 accent-accent"
                    />
                    <span className="truncate">{item.name}</span>
                    {item.primary && <span className="shrink-0 text-12 text-text-muted">principal</span>}
                  </label>
                )
              })}
            </fieldset>
          )
        })}
      </div>
    </Section>
  )
}
