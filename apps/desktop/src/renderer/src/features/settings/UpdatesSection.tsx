import { RefreshCw } from 'lucide-react'
import { UPDATE_INSTALL_INSTRUCTION, UPDATE_QUIT_BLOCKED_MESSAGE } from '@shared/updates'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { useRecording } from '../live/recordingStore'
import { downloadProgressLabel, lastCheckLabel } from './updatesFormat'
import { UPDATES_ANCHOR, UPDATES_SECTION, useUpdates } from './updatesStore'

/**
 * "Atualizações" (contrato 14, CA2 e CA3): versão atual, última verificação e "Procurar atualização";
 * com versão nova, as notas do release em texto simples e "Baixar e instalar". Baixado e aberto o `.dmg`,
 * a instrução de arrastar para Aplicativos e "Fechar o app agora", travado durante uma gravação. Fica na aba
 * "Geral" (contrato 18).
 */
export function UpdatesSection() {
  const state = useUpdates((store) => store.state)
  const check = useUpdates((store) => store.check)
  const download = useUpdates((store) => store.download)
  const quit = useUpdates((store) => store.quit)
  const autoCheckUpdates = useSettings((store) => store.settings.autoCheckUpdates)
  const update = useSettings((store) => store.update)
  const recording = useRecording((store) => store.session !== null)

  const { available, download: phase } = state
  const progress = downloadProgressLabel(phase)

  return (
    // Vindo do "Atualizar" da barra lateral ou de "Sobre", a tela rola até a âncora (`/configuracoes/geral#atualizacoes`).
    <Section title={UPDATES_SECTION} anchor={UPDATES_ANCHOR}>
      <SettingRow name={state.currentVersion ? `Versão ${state.currentVersion}` : 'Versão'} description={lastCheckLabel(state.lastCheckedAt, new Date())}>
        <Button action="update-check" variant="secondary" icon={RefreshCw} disabled={state.checking} onClick={() => void check()}>
          {state.checking ? 'Procurando…' : 'Procurar atualização'}
        </Button>
      </SettingRow>
      <SettingRow name="Procurar atualizações automaticamente" nameId="settings-auto-updates" description="Ao abrir o app e a cada 6 horas.">
        <Switch checked={autoCheckUpdates} labelledBy="settings-auto-updates" onChange={(value) => void update({ autoCheckUpdates: value })} />
      </SettingRow>
      {available && (
        <div data-update-available className="flex flex-col gap-2.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-13 font-medium text-text">Nova versão {available.version}</p>
            {progress ? (
              <p data-update-progress className="tabular text-13 text-text-muted">
                {progress}
              </p>
            ) : (
              phase.phase !== 'ready' && (
                <Button action="update-download" onClick={() => void download()}>
                  Baixar e instalar
                </Button>
              )
            )}
          </div>
          {available.notes && (
            <p data-update-notes className="text-13 whitespace-pre-wrap text-text-muted">
              {available.notes}
            </p>
          )}
          {phase.phase === 'failed' && (
            <p role="alert" data-update-error className="text-13 text-rec">
              {phase.message}
            </p>
          )}
          {phase.phase === 'ready' && (
            <div data-update-ready className="flex flex-wrap items-center justify-between gap-3 border-l-3 border-title bg-bg-sunken px-3 py-2">
              <p className="min-w-0 flex-[1_1_320px] text-13 text-text">
                {UPDATE_INSTALL_INSTRUCTION}
                {recording && <span data-update-quit-blocked className="mt-1 block text-text-muted">{UPDATE_QUIT_BLOCKED_MESSAGE}</span>}
              </p>
              <Button action="update-quit" disabled={recording} onClick={() => void quit()}>
                Fechar o app agora
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
