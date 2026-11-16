// Linha "Agente do <perfil>" do bloco "Claude" (contrato 17, CA11): o agente do ACP não vem no pacote; a
// pessoa instala com um clique (baixa do registro do npm, conferido pelo hash) e pode remover.
import { useEffect } from 'react'
import { downloadSizeLabel } from '@shared/acp'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { Button } from '../../design/Button'
import { SettingRow } from '../../design/SettingRow'

export function AcpAgentField() {
  const status = useAcp((state) => state.status)
  const install = useAcp((state) => state.install)
  const remove = useAcp((state) => state.remove)
  const label = useAgentLabel()

  useEffect(() => {
    void useAcp.getState().load()
  }, [])

  const state = status?.state ?? 'missing'
  const line =
    state === 'installing'
      ? `Instalando… ${status?.progress ?? 0}%`
      : state === 'installed' || state === 'bundled'
        ? `Instalado ${status?.version ?? ''}`.trim()
        : state === 'error'
          ? (status?.error ?? 'Não foi possível instalar.')
          : 'Não instalado'

  return (
    <SettingRow name={`Agente do ${label}`} nameId="settings-acp-agent" description="Baixado do registro do npm só quando você pede; fica neste Mac.">
      <div className="flex flex-wrap items-center justify-end gap-3" data-acp-state={state}>
        <span data-acp-status aria-live="polite" className="text-12 font-medium text-text-muted tabular">
          {line}
        </span>
        {(state === 'missing' || state === 'error') && (
          <Button action="acp-install" variant="secondary" onClick={() => void install()}>
            {`Instalar (${downloadSizeLabel(status?.downloadBytes ?? 0)})`}
          </Button>
        )}
        {state === 'installed' && (
          <Button action="acp-remove" variant="danger" onClick={() => void remove()}>
            Remover
          </Button>
        )}
      </div>
    </SettingRow>
  )
}
