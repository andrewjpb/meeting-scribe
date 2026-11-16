// Resolução do tema, sem DOM: testada em test/theme.test.ts.

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/**
 * Tema efetivo. `forced` vem da URL (só o smoke usa) e vence a preferência; `system` segue o
 * macOS pelo `prefers-color-scheme`.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
  forced: ResolvedTheme | null = null,
): ResolvedTheme {
  if (forced) return forced
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function parseForcedTheme(search: string): ResolvedTheme | null {
  const value = new URLSearchParams(search).get('theme')
  return value === 'light' || value === 'dark' ? value : null
}
