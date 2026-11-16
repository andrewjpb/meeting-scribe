import { describe, expect, it } from 'vitest'
import { downloadProgressLabel, lastCheckLabel } from '../../src/renderer/src/features/settings/updatesFormat'

describe('textos da atualização (contrato 14)', () => {
  const now = new Date(2026, 10, 15, 21, 30)

  it('última verificação: hoje, ontem ou a data, com a hora', () => {
    expect(lastCheckLabel(null, now)).toBe('Ainda não verificado.')
    expect(lastCheckLabel('lixo', now)).toBe('Ainda não verificado.')
    expect(lastCheckLabel(new Date(2026, 10, 15, 21, 5).toISOString(), now)).toBe('Última verificação: hoje às 21:05')
    expect(lastCheckLabel(new Date(2026, 10, 14, 9, 0).toISOString(), now)).toBe('Última verificação: ontem às 09:00')
    expect(lastCheckLabel(new Date(2026, 10, 12, 18, 12).toISOString(), now)).toBe('Última verificação: 12 de novembro às 18:12')
  })

  it('"Baixando… 42%" só durante o download', () => {
    expect(downloadProgressLabel({ phase: 'downloading', percent: 42 })).toBe('Baixando… 42%')
    expect(downloadProgressLabel({ phase: 'idle' })).toBeNull()
    expect(downloadProgressLabel({ phase: 'ready' })).toBeNull()
    expect(downloadProgressLabel({ phase: 'failed', message: 'x' })).toBeNull()
  })
})
