import { MemoryRouter } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useUpdatesSync } from '../features/settings/updatesStore'
import { useBrandingSync } from './brandingStore'
import { useSettingsSync } from './settingsStore'
import { Shell } from './Shell'
import { useThemeSync } from './themeStore'

export function App() {
  useSettingsSync()
  useThemeSync()
  useBrandingSync()
  useUpdatesSync()

  return (
    <MemoryRouter initialEntries={[ROUTE_PATHS.reunioes]}>
      <Shell />
    </MemoryRouter>
  )
}
