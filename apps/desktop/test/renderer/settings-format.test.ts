import { describe, expect, it } from 'vitest'
import type { CatalogModel } from '../../src/shared/assemblyai'
import type { CaptureState } from '../../src/renderer/src/audio/capture'
import { resolveMicDeviceId } from '../../src/renderer/src/audio/constraints'
import { systemAudioFrom } from '../../src/renderer/src/features/permissions/systemAudio'
import { micOptions } from '../../src/renderer/src/features/settings/micOptions'
import { countLabel, filterModels, formatContext, formatPrice, normalizeSearch, orderModels } from '../../src/renderer/src/features/settings/modelFormat'

const model = (id: string, name: string, promptPerM: number | null, completionPerM: number | null, contextLength: number | null = 1000): CatalogModel => ({
  id,
  name,
  promptPerM,
  completionPerM,
  contextLength,
})

describe('seletor de modelo (CA8)', () => {
  it('preço no formato de design.md', () => {
    expect(formatPrice(model('a', 'A', 0.1, 0.5))).toBe('US$ 0,10 / 0,50 por 1M')
    expect(formatPrice(model('a', 'A', 0.05, 0.4))).toBe('US$ 0,05 / 0,40 por 1M')
    expect(formatPrice(model('a', 'A', 25, 1.2))).toBe('US$ 25,00 / 1,20 por 1M')
    expect(formatPrice(model('a', 'A', 0.006, 0.125))).toBe('US$ 0,006 / 0,125 por 1M')
    expect(formatPrice(model('a', 'A', null, 0.5))).toBe('Preço variável')
  })

  it('contexto como no mockup', () => {
    expect(formatContext(32768)).toBe('32k')
    expect(formatContext(131072)).toBe('131k')
    expect(formatContext(400000)).toBe('400k')
    expect(formatContext(922000)).toBe('922k')
    expect(formatContext(1_000_000)).toBe('1M')
    expect(formatContext(1_048_576)).toBe('1M')
    expect(formatContext(1_500_000)).toBe('1,5M')
    expect(formatContext(null)).toBe('')
  })

  const models = [
    model('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 0.1, 0.4),
    model('qwen3.5-4b-32k-fast', 'Qwen3.5 4B Fast', 0.1, 0.5),
    model('claude-opus-5-5', 'Opus 5.5', 4, 20),
    model('cafe', 'Café Rápido', 0.2, 0.2),
    model('variavel', 'Variável', null, null),
  ]

  it('busca por nome ou id sem diferenciar maiúsculas e acentos', () => {
    expect(normalizeSearch('  CAFÉ Rápido ')).toBe('cafe rapido')
    expect(filterModels(models, 'FLASH').map((m) => m.id)).toEqual(['gemini-2.5-flash-lite'])
    expect(filterModels(models, 'qwen3.5-4b').map((m) => m.id)).toEqual(['qwen3.5-4b-32k-fast'])
    expect(filterModels(models, 'cafe rapido').map((m) => m.id)).toEqual(['cafe'])
    expect(filterModels(models, 'VARIÁVEL').map((m) => m.id)).toEqual(['variavel'])
    expect(filterModels(models, 'ópus').map((m) => m.id)).toEqual(['claude-opus-5-5'])
    expect(filterModels(models, '')).toHaveLength(5)
    expect(filterModels(models, 'nada')).toEqual([])
  })

  it('ordem: o atual primeiro, depois do mais barato ao mais caro, sem preço no fim', () => {
    expect(orderModels(models, 'qwen3.5-4b-32k-fast').map((m) => m.id)).toEqual(['qwen3.5-4b-32k-fast', 'cafe', 'gemini-2.5-flash-lite', 'claude-opus-5-5', 'variavel'])
    expect(orderModels(models, 'variavel')[0]?.id).toBe('variavel')
  })

  it('contagem', () => {
    expect(countLabel(60, 60)).toBe('60 modelos')
    expect(countLabel(3, 60)).toBe('3 de 60')
    expect(countLabel(1, 1)).toBe('1 modelo')
  })
})

describe('microfone (CA9 e CA17)', () => {
  const devices = [
    { deviceId: 'default', kind: 'audioinput', label: 'Padrão - Microfone (MacBook Air)' },
    { deviceId: 'mba', kind: 'audioinput', label: 'Microfone (MacBook Air)' },
    { deviceId: 'usb', kind: 'audioinput', label: '' },
    { deviceId: 'cam', kind: 'videoinput', label: 'Câmera' },
  ]

  it('opções: padrão do sistema, as entradas e o salvo que sumiu como indisponível', () => {
    expect(micOptions(devices, null)).toEqual([
      { value: '', label: 'Padrão do sistema' },
      { value: 'mba', label: 'Microfone (MacBook Air)' },
      { value: 'usb', label: 'Microfone 2' },
    ])
    expect(micOptions(devices, 'usb').at(-1)).toEqual({ value: 'usb', label: 'Microfone 2' })
    expect(micOptions(devices, 'sumiu').at(-1)).toEqual({ value: 'sumiu', label: 'Dispositivo indisponível' })
  })

  it('microfone salvo que não existe mais vira o padrão do sistema', () => {
    expect(resolveMicDeviceId(null, devices)).toBeNull()
    expect(resolveMicDeviceId('usb', devices)).toBe('usb')
    expect(resolveMicDeviceId('sumiu', devices)).toBeNull()
    expect(resolveMicDeviceId('cam', devices)).toBeNull()
    // Lista sem ids (antes da permissão) não prova que sumiu.
    expect(resolveMicDeviceId('usb', [{ deviceId: '', kind: 'audioinput' }])).toBe('usb')
  })
})

describe('áudio do sistema na barra lateral (CA12)', () => {
  const capture = (patch: Partial<CaptureState>): CaptureState => ({
    phase: 'recording',
    mic: 'live',
    system: 'live',
    failure: { mic: null, system: null },
    silence: { mic: 'ok', system: 'ok' },
    heard: { mic: true, system: true },
    devices: [],
    micOff: false,
    ...patch,
  })

  it('não verificado até a primeira captura com som; depois ok ou sem áudio', () => {
    expect(systemAudioFrom(null, 'unknown')).toBe('unknown')
    expect(systemAudioFrom(capture({ system: 'starting', heard: { mic: false, system: false } }), 'unknown')).toBe('unknown')
    expect(systemAudioFrom(capture({ heard: { mic: true, system: false } }), 'unknown')).toBe('unknown')
    expect(systemAudioFrom(capture({}), 'unknown')).toBe('ok')
    expect(systemAudioFrom(capture({ silence: { mic: 'ok', system: 'silent' } }), 'ok')).toBe('silent')
    expect(systemAudioFrom(capture({ system: 'ended', silence: { mic: 'ok', system: 'ended' } }), 'ok')).toBe('silent')
    expect(systemAudioFrom(capture({ system: 'failed' }), 'unknown')).toBe('silent')
    expect(systemAudioFrom(capture({ phase: 'paused' }), 'silent')).toBe('ok')
  })

  it('o último valor fica depois que a gravação termina', () => {
    expect(systemAudioFrom(capture({ phase: 'stopping', system: 'ended' }), 'ok')).toBe('ok')
    expect(systemAudioFrom(capture({ phase: 'stopped', system: 'ended' }), 'silent')).toBe('silent')
    expect(systemAudioFrom(null, 'ok')).toBe('ok')
  })
})
