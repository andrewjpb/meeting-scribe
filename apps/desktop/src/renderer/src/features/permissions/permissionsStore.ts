// Estado das duas permissões da barra lateral. Microfone: o que o macOS diz (relido quando a janela ganha
// foco). Áudio do sistema: não há consulta sem diálogo, então vale o detector de silêncio da última
// captura (contrato 02), guardado aqui porque o estado da captura some quando a gravação termina.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { MicAccess } from '@shared/assemblyai'
import type { CaptureState } from '../../audio/capture'
import { useRecording } from '../live/recordingStore'
import { systemAudioFrom, type SystemAudioState } from './systemAudio'

interface PermissionsState {
  mic: MicAccess | null
  systemAudio: SystemAudioState
  requesting: boolean
  refreshMic: () => Promise<void>
  requestMic: () => Promise<void>
}

export const usePermissions = create<PermissionsState>()((set, get) => ({
  mic: null,
  systemAudio: 'unknown',
  requesting: false,

  refreshMic: async () => {
    try {
      set({ mic: await window.__scribeApi.invoke('scribe:mic-access') })
    } catch {
      // Fica o último estado lido.
    }
  },

  requestMic: async () => {
    if (get().requesting) return
    set({ requesting: true })
    try {
      set({ mic: await window.__scribeApi.invoke('scribe:mic-access-request') })
    } catch {
      await get().refreshMic()
    } finally {
      set({ requesting: false })
    }
  },
}))

/** Lê o microfone ao abrir, ao ganhar foco e quando a captura do microfone sobe; segue a captura do sistema. */
export function usePermissionsSync(): void {
  useEffect(() => {
    const { refreshMic } = usePermissions.getState()
    void refreshMic()
    const onFocus = (): void => void refreshMic()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshMic()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    const follow = (capture: CaptureState | null, previousCapture: CaptureState | null): void => {
      const systemAudio = systemAudioFrom(capture, usePermissions.getState().systemAudio)
      if (systemAudio !== usePermissions.getState().systemAudio) usePermissions.setState({ systemAudio })
      // O pedido do `getUserMedia` pode ter acabado de responder ao macOS.
      if (capture && capture.mic !== previousCapture?.mic && (capture.mic === 'live' || capture.mic === 'failed')) void refreshMic()
    }
    follow(useRecording.getState().capture, null)
    const unsubscribe = useRecording.subscribe((state, previous) => {
      if (state.capture !== previous.capture) follow(state.capture, previous.capture)
    })

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [])
}
