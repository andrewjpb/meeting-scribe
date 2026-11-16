// Restrições de captura (N6 da spec, provadas na fase 0). Sem pedir, o Chromium liga cancelamento de
// eco, supressão de ruído e ganho automático também na trilha do sistema; aqui os três vêm explícitos.
import type { AppSettings } from '@shared/settings-defaults'

export type MicSettings = Pick<AppSettings, 'echoCancellation' | 'micDeviceId'>

export interface MicConstraints {
  audio: {
    deviceId?: { exact: string }
    echoCancellation: boolean
    noiseSuppression: false
    autoGainControl: false
    channelCount: 1
  }
}

export interface SystemConstraints {
  video: false
  audio: {
    restrictOwnAudio: true
    echoCancellation: false
    noiseSuppression: false
    autoGainControl: false
  }
}

/**
 * Microfone salvo que não existe mais vira o padrão do sistema (`null`). Lista sem ids (o Chromium
 * esconde os ids antes da permissão) não prova que sumiu: o salvo segue, e a captura cai no padrão se
 * o pedido falhar.
 */
export function resolveMicDeviceId(saved: string | null, devices: readonly { deviceId: string; kind: string }[]): string | null {
  if (saved === null) return null
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  if (inputs.some((device) => device.deviceId === saved)) return saved
  return inputs.some((device) => device.deviceId !== '') ? null : saved
}

export function buildMicConstraints(settings: MicSettings): MicConstraints {
  return {
    audio: {
      ...(settings.micDeviceId !== null ? { deviceId: { exact: settings.micDeviceId } } : {}),
      echoCancellation: settings.echoCancellation,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  }
}

/** `restrictOwnAudio` tira o som do próprio app da captura (fase 0, teste 5). */
export function buildSystemConstraints(): SystemConstraints {
  return {
    video: false,
    audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  }
}
