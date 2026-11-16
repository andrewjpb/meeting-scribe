// Microfones para o seletor de Áudio. A lista sai do mesmo `MediaApi` da captura (no smoke, o sinal
// gerado) e é relida no `devicechange` com o mesmo debounce de 500 ms da captura (R13).
import { useEffect, useState } from 'react'
import { DEVICE_DEBOUNCE_MS, type DeviceInfo } from '../../audio/capture'
import { captureEnvironment } from '../../audio/environment'

export function useAudioInputs(): readonly DeviceInfo[] {
  const [devices, setDevices] = useState<readonly DeviceInfo[]>([])

  useEffect(() => {
    let media: ReturnType<typeof captureEnvironment>['media']
    try {
      media = captureEnvironment().media
    } catch {
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      media
        .enumerateDevices()
        .then((all) => {
          if (alive) setDevices(all.filter((device) => device.kind === 'audioinput'))
        })
        .catch(() => undefined)
    }
    const onChange = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(read, DEVICE_DEBOUNCE_MS)
    }
    read()
    media.addEventListener('devicechange', onChange)
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
      media.removeEventListener('devicechange', onChange)
    }
  }, [])

  return devices
}
