import { describe, expect, it } from 'vitest'
import { privacyPaneUrl } from '../src/shared/privacy'

describe('privacyPaneUrl', () => {
  it('mapeia os dois painéis para as URLs dos Ajustes do Sistema', () => {
    expect(privacyPaneUrl('audio-capture')).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture')
    expect(privacyPaneUrl('microphone')).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  })

  it.each(['https://example.com', 'Privacy_Camera', '', null, 42, 'toString', '__proto__'])('recusa %s', (pane) => {
    expect(privacyPaneUrl(pane)).toBeNull()
  })
})
