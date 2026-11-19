import { ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { AppInfo } from '@shared/ipc'
import { settingsPath } from '@shared/routes'
import { REPOSITORY_URL } from '@shared/updates'
import { Button } from '../../design/Button'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { UPDATES_ANCHOR } from './updatesStore'

function Value({ children }: { children: string }) {
  return <span className="tabular text-13 text-text select-text">{children}</span>
}

/**
 * Aba "Sobre" (contrato 18, CA1): versão, Electron e Chrome (`scribe:app-info`), a licença (GPL-3.0 desde 19/11/2026) com o link do
 * repositório (o main só abre `https://`) e o atalho para o bloco "Atualizações" da aba "Geral".
 */
export function AboutSection() {
  const navigate = useNavigate()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:app-info').then(
      (next) => {
        if (alive) setInfo(next)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  return (
    <Section title={info ? `Sobre o ${info.name}` : 'Sobre'} description="© 2026 LAP Software & Consultoria.">
      <SettingRow name="Versão">
        <Value>{info?.version ?? '…'}</Value>
      </SettingRow>
      <SettingRow name="Electron" description="Base do app.">
        <Value>{info?.electron ?? '…'}</Value>
      </SettingRow>
      <SettingRow name="Chrome" description="Motor das telas.">
        <Value>{info?.chrome ?? '…'}</Value>
      </SettingRow>
      <SettingRow name="Licença" description="Código aberto, sob a licença GPL-3.0.">
        <Button action="open-repository" variant="secondary" icon={ExternalLink} onClick={() => window.__scribeApi.send('scribe:open-link', REPOSITORY_URL)}>
          Ver o repositório
        </Button>
      </SettingRow>
      <SettingRow name="Atualizações" description="Abre o bloco de atualizações, em Geral.">
        <Button action="about-update-check" variant="secondary" icon={RefreshCw} onClick={() => void navigate(settingsPath('geral', UPDATES_ANCHOR))}>
          Procurar atualização
        </Button>
      </SettingRow>
    </Section>
  )
}
