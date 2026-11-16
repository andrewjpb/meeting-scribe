import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useRecording } from './recordingStore'

/**
 * "Nova gravação": inicia a captura no próprio gesto e abre a tela de gravação. Com uma gravação em
 * andamento, só volta para ela.
 */
export function useStartRecording(): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    useRecording.getState().start()
    void navigate(ROUTE_PATHS.gravacao)
  }, [navigate])
}
