import { ChevronDown, ChevronRight, FolderDown } from 'lucide-react'
import { useState } from 'react'
import { APP_PLUGINS, PLUGIN_INSTALL_DESCRIPTION, PLUGIN_SAVE_DESCRIPTION, pluginFolderName, type AppPlugin, type AppPluginId } from '@shared/plugins'
import { NAVEGADOR_BRIDGE_DESCRIPTION } from '@shared/settings-index'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { useMeet } from '../live/meetStore'
import { useNavegador, useNavegadorSync } from '../live/navegadorStore'

/**
 * Aba "Plugins" (contrato 31): um cartão por plugin embutido no app. O estado vem do servidor local do plugin
 * (para o Meet, `useMeet`); "Salvar plugin…" abre o diálogo de pasta no main, que copia a pasta do plugin para lá;
 * "Como instalar" abre o passo a passo na própria linha. Contrato 46: o "Controle do navegador" tem também o
 * "Ativar ponte" (`useNavegador`), e o passo a passo é o de cada plugin.
 */
export function PluginsSection() {
  useNavegadorSync()
  return (
    <>
      {APP_PLUGINS.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} />
      ))}
    </>
  )
}

/** Conectado agora? Desconectado é o normal fora de reunião: texto apagado, nunca vermelho aqui. */
function usePluginConnected(id: AppPluginId): boolean {
  const meetConnected = useMeet((state) => state.connected)
  const navegadorConnected = useNavegador((state) => state.conectado)
  if (id === 'meet') return meetConnected
  return id === 'navegador' ? navegadorConnected : false
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; path: string } | { kind: 'failed' }

function PluginCard({ plugin }: { plugin: AppPlugin }) {
  const connected = usePluginConnected(plugin.id)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [manualOpen, setManualOpen] = useState(false)
  const manualId = `plugin-manual-${plugin.id}`

  const saveTo = (): void => {
    setSave({ kind: 'saving' })
    window.__scribeApi.invoke('scribe:plugin-save', { id: plugin.id }).then(
      (result) => {
        if (result === null) setSave({ kind: 'idle' })
        else setSave(result.ok ? { kind: 'saved', path: result.path } : { kind: 'failed' })
      },
      () => setSave({ kind: 'failed' }),
    )
  }

  return (
    <Section title={plugin.nome}>
      <div data-plugin={plugin.id} data-plugin-state={connected ? 'on' : 'off'}>
        <SettingRow name={plugin.nome} description={`${plugin.navegador}. ${plugin.descricao}`}>
          <span className={`text-13 font-medium ${connected ? 'text-live' : 'text-text-muted'}`}>{connected ? 'Conectado' : 'Desconectado'}</span>
        </SettingRow>
      </div>
      {plugin.id === 'navegador' && <NavegadorBridgeRow />}
      <SettingRow name="Salvar plugin" description={PLUGIN_SAVE_DESCRIPTION}>
        <Button action={`plugin-save-${plugin.id}`} variant="secondary" icon={FolderDown} disabled={save.kind === 'saving'} onClick={saveTo}>
          Salvar plugin…
        </Button>
      </SettingRow>
      {(save.kind === 'saved' || save.kind === 'failed') && (
        <p role="status" data-plugin-feedback={save.kind} className="py-3 text-12 text-text-muted">
          {save.kind === 'saved' ? (
            <>
              Salvo em <span className="text-text select-text">{save.path}</span>
            </>
          ) : (
            'Não salvou. Escolha outra pasta e tente de novo.'
          )}
        </p>
      )}
      <SettingRow name="Como instalar" description={PLUGIN_INSTALL_DESCRIPTION}>
        <button
          type="button"
          data-action={`plugin-manual-${plugin.id}`}
          aria-expanded={manualOpen}
          aria-controls={manualId}
          onClick={() => setManualOpen(!manualOpen)}
          className="no-drag inline-flex items-center gap-1.5 rounded-[var(--radius-control)] py-0.5 text-13 font-medium text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-accent"
        >
          <Icon icon={manualOpen ? ChevronDown : ChevronRight} size={14} />
          Como instalar
        </button>
      </SettingRow>
      {manualOpen && <InstallManual id={manualId} plugin={plugin} />}
    </Section>
  )
}

/** "Ativar ponte" (contrato 46): liga a ponte local; o main grava a configuração e sobe ou para o servidor. */
function NavegadorBridgeRow() {
  const ativo = useNavegador((state) => state.ativo)
  const saving = useNavegador((state) => state.saving)
  return (
    <SettingRow name="Ativar ponte" nameId="settings-navegador-ponte" description={NAVEGADOR_BRIDGE_DESCRIPTION}>
      <Switch checked={ativo} labelledBy="settings-navegador-ponte" action="navegador-ponte" disabled={saving} onChange={(next) => void useNavegador.getState().setAtivo(next)} />
    </SettingRow>
  )
}

/** O que muda no passo a passo de cada plugin: o último passo e os avisos abaixo da lista. */
const MANUAL_EXTRAS: Record<AppPluginId, { lastStep: string; notes: readonly string[] }> = {
  meet: {
    lastStep: 'Recarregue a aba do Meet ou do Teams.',
    notes: [
      'Desligue o picture-in-picture automático do Meet (o mini-player esconde a reunião do plugin) e mantenha a aba do Meet aberta durante a gravação.',
      'No Teams, só funciona na reunião aberta no Chrome (teams.microsoft.com, teams.live.com ou teams.cloud.microsoft), não no app do Teams. A leitura do Teams é melhor esforço: a Microsoft muda a tela com frequência e pode ser preciso ajustar o plugin.',
    ],
  },
  navegador: {
    lastStep: 'Volte aqui e ligue “Ativar ponte”. Em alguns segundos o cartão mostra “Conectado”.',
    notes: [
      'O plugin age só na janela do Chrome que ele mesmo abre (até 10 abas). Não lê nem mexe nas suas abas e não digita em campo de senha.',
      'Se o cartão ficar “Desconectado” com a ponte ligada, abra chrome://extensions e recarregue a extensão.',
    ],
  },
}

/** O passo a passo de carregar sem compactação (o Chrome não instala sozinho nem abre `chrome://` por link). */
function InstallManual({ id, plugin }: { id: string; plugin: AppPlugin }) {
  const code = 'rounded-[var(--radius-control)] bg-bg-sunken px-1 font-mono text-12 text-text select-text'
  const extras = MANUAL_EXTRAS[plugin.id]
  return (
    <div id={id} data-plugin-manual={plugin.id} className="flex flex-col gap-3 py-4 text-13 text-text">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-text-muted">
        <li>Clique em “Salvar plugin…” e escolha uma pasta. O app grava ali a pasta “{pluginFolderName(plugin)}”.</li>
        <li>
          No {plugin.navegador}, digite <code className={code}>chrome://extensions</code> na barra de endereço e tecle Enter.
        </li>
        <li>Ligue o “Modo do desenvolvedor”, no canto superior direito.</li>
        <li>Clique em “Carregar sem compactação” e escolha a pasta “{pluginFolderName(plugin)}” que você salvou.</li>
        <li>{extras.lastStep}</li>
      </ol>
      {extras.notes.map((note) => (
        <p key={note} className="text-12 text-text-muted">
          {note}
        </p>
      ))}
      <p className="text-12 text-text-muted">Tudo fica neste computador: o plugin só fala com o app.</p>
    </div>
  )
}
