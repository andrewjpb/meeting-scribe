// Painéis de privacidade dos Ajustes do Sistema. O renderer mostra a URL no link, mas só manda o nome
// do painel ao main; a URL aberta por `shell.openExternal` sai sempre desta tabela.
import type { PrivacyPane } from './ipc'

export const PRIVACY_PANE_URLS: Readonly<Record<PrivacyPane, string>> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  'audio-capture': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
}

export function privacyPaneUrl(pane: unknown): string | null {
  return typeof pane === 'string' && Object.hasOwn(PRIVACY_PANE_URLS, pane) ? PRIVACY_PANE_URLS[pane as PrivacyPane] : null
}
