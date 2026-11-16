import { useEffect } from 'react'
import { parseForcedTheme, resolveTheme, type ResolvedTheme } from './theme'
import { useSettings } from './settingsStore'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme
}

export function applyInitialAppearance(): void {
  applyTheme(resolveTheme(useSettings.getState().settings.theme, window.matchMedia(DARK_QUERY).matches, parseForcedTheme(window.location.search)))
}

/**
 * Mantém `<html data-theme>` em dia com a aparência escolhida em Configurações e com a troca de tema do
 * macOS, sem recarregar.
 */
export function useThemeSync(): void {
  const preference = useSettings((state) => state.settings.theme)

  useEffect(() => {
    const forced = parseForcedTheme(window.location.search)
    const media = window.matchMedia(DARK_QUERY)
    const update = (): void => applyTheme(resolveTheme(preference, media.matches, forced))
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [preference])
}
