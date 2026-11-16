// Opções do seletor de microfone (função pura, testada em test/renderer/settings-format.test.ts).
import type { DeviceInfo } from '../../audio/capture'

/** Valor do seletor para "Padrão do sistema" (`micDeviceId = null`). */
export const SYSTEM_DEFAULT = ''

export interface MicOption {
  value: string
  label: string
}

/** Pseudo-dispositivos do Chromium que repetem o padrão do sistema. */
const ALIASES = new Set(['default', 'communications'])

/**
 * "Padrão do sistema" e as entradas de áudio. Um microfone salvo que não está mais na lista aparece como
 * "Dispositivo indisponível" (a captura usa o padrão, `resolveMicDeviceId`).
 */
export function micOptions(devices: readonly DeviceInfo[], saved: string | null): MicOption[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId !== '' && !ALIASES.has(device.deviceId))
  const options: MicOption[] = [{ value: SYSTEM_DEFAULT, label: 'Padrão do sistema' }]
  inputs.forEach((device, index) => options.push({ value: device.deviceId, label: device.label.trim() || `Microfone ${index + 1}` }))
  if (saved !== null && !options.some((option) => option.value === saved)) options.push({ value: saved, label: 'Dispositivo indisponível' })
  return options
}
