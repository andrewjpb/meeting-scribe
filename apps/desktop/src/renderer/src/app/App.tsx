import { useState, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useUpdatesSync } from '../features/settings/updatesStore'
import { useBrandingSync } from './brandingStore'
import { LockScreen } from './LockScreen'
import { useLock, useLockSync } from './lockStore'
import { useSettingsSync } from './settingsStore'
import { Shell } from './Shell'
import { useThemeSync } from './themeStore'

export function App() {
  useSettingsSync()
  useThemeSync()
  useBrandingSync()
  useUpdatesSync()
  useLockSync()

  return (
    <>
      <BehindLock>
        <MemoryRouter initialEntries={INITIAL_ENTRIES}>
          <Shell />
        </MemoryRouter>
      </BehindLock>
      <LockScreen />
    </>
  )
}

const INITIAL_ENTRIES = [ROUTE_PATHS.reunioes]

/**
 * As telas atrás da camada de bloqueio (contrato 22). Aberto já bloqueado (CA6), elas só montam depois do
 * primeiro desbloqueio, porque o main recusaria o que elas leem ao abrir. Bloqueado depois, continuam montadas,
 * `inert`: rota, rolagem, rascunhos e painéis ficam como estavam, e a gravação segue. As telas chegam prontas
 * como `children`, para bloquear e desbloquear não as renderizar de novo (a tela de Configurações volta ao topo
 * quando renderiza com outra `location`).
 */
function BehindLock({ children }: { children: ReactNode }) {
  const locked = useLock((state) => state.status.locked)
  const [mounted, setMounted] = useState(!locked)
  if (!locked && !mounted) setMounted(true)
  return (
    <div className="h-full" inert={locked} data-app-content>
      {mounted && children}
    </div>
  )
}
