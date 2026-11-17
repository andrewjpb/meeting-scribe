import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useRecording } from '../live/recordingStore'
import { useStartRecording } from '../live/useStartRecording'

/**
 * "Gravar" de um evento da agenda (contrato 12): avisa o main de qual evento é a gravação e começa no mesmo gesto
 * (o pedido chega ao main antes do início da sessão). Já gravando, só volta para a gravação.
 */
export function useRecordEvent(): (key: string) => void {
  const navigate = useNavigate()
  const startRecording = useStartRecording()
  return useCallback(
    (key: string) => {
      if (useRecording.getState().session) {
        void navigate(ROUTE_PATHS.gravacao)
        return
      }
      void Promise.resolve(window.__scribeApi.invoke('scribe:calendar-record', { key })).catch(() => undefined)
      startRecording()
    },
    [navigate, startRecording],
  )
}
