import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { EMAIL_DASHBOARD_ENABLED_DESCRIPTION, EMAIL_DASHBOARD_MODEL_DESCRIPTION, EMAIL_DASHBOARD_SECTION_DESCRIPTION } from '@shared/settings-index'
import { EMAIL_DASHBOARD_MODELS, type EmailDashboardSettings, type SettingsPatch } from '@shared/settings-defaults'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { PAINEL_MODELO_ROTULO, textoUltimaAnalise } from '../email/painelFormat'
import { usePainel } from '../email/painelStore'

const MODELOS = EMAIL_DASHBOARD_MODELS.map((value) => ({ value, label: PAINEL_MODELO_ROTULO[value] }))

/** O que o interruptor e o Segmented gravam: o objeto `emailDashboard` inteiro, com a mudança. */
export function emailDashboardPatch(config: EmailDashboardSettings, change: Partial<EmailDashboardSettings>): SettingsPatch {
  return { emailDashboard: { ...config, ...change } }
}

/**
 * Configurações › Email › Painel (contrato 157, R23, R24, D13): ligar a análise por IA, o modelo e a última análise com
 * o "Analisar agora". A visão vem do mesmo store do Painel (`scribe:email-dashboard-get` e o evento de mudança).
 */
export function EmailPainelSection() {
  const config = useSettings((state) => state.settings.emailDashboard)
  const update = useSettings((state) => state.update)
  const view = usePainel((state) => state.view)

  useEffect(() => {
    const painel = usePainel.getState()
    void painel.load()
    return painel.subscribe()
  }, [])

  const running = view?.running ?? false
  return (
    <Section title="Painel" anchor="painel" description={EMAIL_DASHBOARD_SECTION_DESCRIPTION}>
      <SettingRow name="Analisar e-mails com IA" nameId="settings-email-dashboard-enabled" description={EMAIL_DASHBOARD_ENABLED_DESCRIPTION}>
        <Switch action="email-dashboard-enabled" checked={config.enabled} labelledBy="settings-email-dashboard-enabled" onChange={(enabled) => void update(emailDashboardPatch(config, { enabled }))} />
      </SettingRow>
      <SettingRow name="Modelo" nameId="settings-email-dashboard-model" description={EMAIL_DASHBOARD_MODEL_DESCRIPTION}>
        <Segmented value={config.model} options={MODELOS} labelledBy="settings-email-dashboard-model" dataName="email-dashboard-model" disabled={!config.enabled} onChange={(model) => void update(emailDashboardPatch(config, { model }))} />
      </SettingRow>
      <SettingRow name="Última análise" description={textoUltimaAnalise(view?.lastRun ?? null, view?.analyzed ?? 0)}>
        <Button action="email-dashboard-run" variant="secondary" icon={RefreshCw} disabled={!config.enabled || running} onClick={() => void usePainel.getState().run()}>
          {running ? 'Analisando…' : 'Analisar agora'}
        </Button>
      </SettingRow>
    </Section>
  )
}
