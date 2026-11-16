import { describe, expect, it } from 'vitest'
import { buildMicConstraints, buildSystemConstraints } from '../../src/renderer/src/audio/constraints'

describe('restrições de captura (N6)', () => {
  it('microfone sem processamento, eco conforme a configuração, padrão do sistema sem deviceId', () => {
    expect(buildMicConstraints({ echoCancellation: false, micDeviceId: null })).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    expect(buildMicConstraints({ echoCancellation: true, micDeviceId: null })).toEqual({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
  })

  it('microfone escolhido vai como deviceId exato', () => {
    expect(buildMicConstraints({ echoCancellation: false, micDeviceId: 'abc' })).toEqual({
      audio: { deviceId: { exact: 'abc' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
  })

  it('sistema: só áudio, sem o som do próprio app e sem processamento', () => {
    expect(buildSystemConstraints()).toEqual({
      video: false,
      audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  })
})
