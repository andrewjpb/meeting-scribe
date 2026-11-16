import { describe, expect, it } from 'vitest'
import type { CaptureState } from '../../src/renderer/src/audio/capture'
import { noticesFor } from '../../src/renderer/src/features/live/noticeRules'
import { brandNameChange, brandSubtitleChange } from '../../src/renderer/src/features/settings/brandFields'

const micDenied: CaptureState = {
  phase: 'recording',
  mic: 'failed',
  system: 'live',
  failure: { mic: 'denied', system: null },
  silence: { mic: 'ok', system: 'ok' },
  heard: { mic: false, system: true },
  devices: [],
}

describe('marca escolhida no renderer (contrato 09)', () => {
  it('CA5: o aviso do microfone bloqueado cita o nome escolhido; sem nome, "LAP Reuniões"', () => {
    expect(noticesFor(micDenied, 'Atas da Diretoria')[0]?.text).toBe('O microfone está bloqueado para o Atas da Diretoria. Libere em Privacidade e Segurança, Microfone.')
    expect(noticesFor(micDenied)[0]?.text).toBe('O microfone está bloqueado para o LAP Reuniões. Libere em Privacidade e Segurança, Microfone.')
  })

  it('CA2: nome vazio ou igual ao padrão volta ao padrão; sem mudança, nada grava', () => {
    expect(brandNameChange('', null)).toBeUndefined()
    expect(brandNameChange('  Atas  ', null)).toBe('Atas')
    expect(brandNameChange('', 'Atas')).toBeNull()
    expect(brandNameChange('LAP Reuniões', 'Atas')).toBeNull()
    expect(brandNameChange('Atas ', 'Atas')).toBeUndefined()
  })

  it('CA2: subtítulo vazio tira a linha; igual ao padrão volta ao padrão', () => {
    // A partir do padrão (campo mostra "LAP Software"), apagar tira o subtítulo.
    expect(brandSubtitleChange('', null)).toBe('')
    expect(brandSubtitleChange('LAP Software', null)).toBeUndefined()
    expect(brandSubtitleChange('', 'Jurídico')).toBe('')
    expect(brandSubtitleChange('', '')).toBeUndefined()
    expect(brandSubtitleChange('LAP Software', '')).toBeNull()
    expect(brandSubtitleChange(' Jurídico ', null)).toBe('Jurídico')
  })
})
