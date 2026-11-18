import { describe, expect, it } from 'vitest'
import type { CaptureState } from '../../src/renderer/src/audio/capture'
import { languagePairLabel, modelLabel } from '../../src/renderer/src/features/live/labels'
import { noticesFor } from '../../src/renderer/src/features/live/noticeRules'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'

const base: CaptureState = {
  phase: 'recording',
  mic: 'live',
  system: 'live',
  failure: { mic: null, system: null },
  silence: { mic: 'ok', system: 'ok' },
  heard: { mic: true, system: true },
  devices: [],
  micOff: false,
}

describe('avisos da gravação', () => {
  it('nada com as duas fontes ok', () => {
    expect(noticesFor(base)).toEqual([])
  })

  it('sistema em silêncio ou encerrado aponta para Gravação de Áudio do Sistema; some quando volta', () => {
    for (const state of [{ ...base, silence: { mic: 'ok', system: 'silent' } }, { ...base, system: 'ended', silence: { mic: 'ok', system: 'ended' } }] as CaptureState[]) {
      const [notice] = noticesFor(state)
      expect(notice?.pane).toBe('audio-capture')
      expect(notice?.text).toContain('Gravação de Áudio do Sistema')
    }
    expect(noticesFor({ ...base, silence: { mic: 'ok', system: 'ok' } })).toEqual([])
  })

  it('encerrando ou encerrada, o sistema que terminou não vira aviso de permissão', () => {
    for (const phase of ['stopping', 'stopped'] as const) {
      expect(noticesFor({ ...base, phase, system: 'ended', silence: { mic: 'ok', system: 'silent' } as CaptureState['silence'] })).toEqual([])
    }
  })

  it('microfone desligado de propósito (contrato 29): sem aviso de microfone ausente ou bloqueado', () => {
    expect(noticesFor({ ...base, micOff: true })).toEqual([])
    expect(noticesFor({ ...base, micOff: true, mic: 'failed', failure: { mic: 'denied', system: null } })).toEqual([])
    expect(noticesFor({ ...base, micOff: true, mic: 'failed', failure: { mic: 'unavailable', system: null } })).toEqual([])
  })

  it('microfone negado aponta para o painel do microfone', () => {
    const notices = noticesFor({ ...base, mic: 'failed', failure: { mic: 'denied', system: null } })
    expect(notices.map((n) => n.pane)).toEqual(['microphone'])
  })

  it('sistema que falhou ao iniciar também mostra o aviso da permissão', () => {
    const notices = noticesFor({ ...base, system: 'failed', failure: { mic: null, system: 'denied' } })
    expect(notices.map((n) => n.id)).toEqual(['system-failed'])
  })
})

describe('etiquetas da barra de controles', () => {
  it('padrões: PT → EN e o id do modelo', () => {
    expect(languagePairLabel(DEFAULT_SETTINGS)).toBe('PT → EN')
    expect(modelLabel(DEFAULT_SETTINGS)).toBe('qwen3.5-4b-32k-fast')
  })

  it('id com provedor perde o prefixo; sem tradução, só a origem e nenhum modelo', () => {
    expect(modelLabel({ ...DEFAULT_SETTINGS, translationModel: 'anthropic/claude-haiku-5.5' })).toBe('claude-haiku-5.5')
    expect(languagePairLabel({ ...DEFAULT_SETTINGS, translationEnabled: false })).toBe('PT')
    expect(modelLabel({ ...DEFAULT_SETTINGS, translationEnabled: false })).toBeNull()
    // Contrato 05: com o Claude CLI a barra mostra o modelo que de fato traduz.
    expect(modelLabel({ ...DEFAULT_SETTINGS, translationEngine: 'claude-cli', claudeModel: 'sonnet' })).toBe('claude-cli:sonnet')
  })
})
