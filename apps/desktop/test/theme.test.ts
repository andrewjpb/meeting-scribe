import { describe, expect, it } from 'vitest'
import { parseForcedTheme, resolveTheme } from '../src/renderer/src/app/theme'

describe('resolveTheme', () => {
  it('system segue o macOS', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('preferência explícita ignora o macOS', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('tema forçado (smoke) vence tudo', () => {
    expect(resolveTheme('system', true, 'light')).toBe('light')
    expect(resolveTheme('light', false, 'dark')).toBe('dark')
  })
})

describe('parâmetros da URL', () => {
  it('lê o tema forçado e ignora valor inválido', () => {
    expect(parseForcedTheme('?theme=dark')).toBe('dark')
    expect(parseForcedTheme('?outro=1&theme=light')).toBe('light')
    expect(parseForcedTheme('?theme=system')).toBeNull()
    expect(parseForcedTheme('')).toBeNull()
  })
})
