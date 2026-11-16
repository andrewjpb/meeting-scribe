import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useStartRecording } from '../features/live/useStartRecording'

/**
 * Itens do menu do app: "Configurações…" chega como id de rota; "Nova gravação" chega como pedido de
 * gravação, com o gesto do usuário já marcado pelo main.
 */
export function useMainNavigation(): void {
  const navigate = useNavigate()
  const startRecording = useStartRecording()

  useEffect(
    () =>
      window.__scribeApi.on('scribe:navigate', (route) => {
        void navigate(ROUTE_PATHS[route])
      }),
    [navigate],
  )

  useEffect(() => window.__scribeApi.on('scribe:new-recording', startRecording), [startRecording])
}
