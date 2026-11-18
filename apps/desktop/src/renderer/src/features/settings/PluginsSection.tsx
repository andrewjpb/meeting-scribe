import { ChevronDown, ChevronRight, FolderDown } from 'lucide-react'
import { useState } from 'react'
import { APP_PLUGINS, PLUGIN_INSTALL_DESCRIPTION, PLUGIN_SAVE_DESCRIPTION, pluginFolderName, type AppPlugin, type AppPluginId } from '@shared/plugins'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { useMeet } from '../live/meetStore'

/**
 * Aba "Plugins" (contrato 31): um cartão por plugin embutido no app. O estado vem do servidor local do plugin
 * (para o Meet, `useMeet`); "Salvar plugin…" abre o diálogo de pasta no main, que copia a pasta do plugin para lá;
 * "Como instalar" abre o passo a passo na própria linha.
 */
export function PluginsSection() {
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
  return id === 'meet' ? meetConnected : false
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

/** O passo a passo de carregar sem compactação (o Chrome não instala sozinho nem abre `chrome://` por link). */
function InstallManual({ id, plugin }: { id: string; plugin: AppPlugin }) {
  const code = 'rounded-[var(--radius-control)] bg-bg-sunken px-1 font-mono text-12 text-text select-text'
  return (
    <div id={id} data-plugin-manual={plugin.id} className="flex flex-col gap-3 py-4 text-13 text-text">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-text-muted">
        <li>Clique em “Salvar plugin…” e escolha uma pasta. O app grava ali a pasta “{pluginFolderName(plugin)}”.</li>
        <li>
          No {plugin.navegador}, digite <code className={code}>chrome://extensions</code> na barra de endereço e tecle Enter.
        </li>
        <li>Ligue o “Modo do desenvolvedor”, no canto superior direito.</li>
        <li>Clique em “Carregar sem compactação” e escolha a pasta “{pluginFolderName(plugin)}” que você salvou.</li>
        <li>Recarregue a aba do Meet.</li>
      </ol>
      <p className="text-12 text-text-muted">
        Desligue o picture-in-picture automático do Meet (o mini-player esconde a reunião do plugin) e mantenha a aba do Meet aberta durante a gravação.
      </p>
      <p className="text-12 text-text-muted">Tudo fica neste computador: o plugin só fala com o app.</p>
    </div>
  )
}
