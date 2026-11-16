import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useAutomations } from '../features/agents/automationsStore'
import { useRecording } from '../features/live/recordingStore'
import { useStartRecording } from '../features/live/useStartRecording'
import { useLock } from './lockStore'

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
        // Bloqueado, o menu não leva a lugar nenhum (o main já não manda; aqui é a segunda trava).
        if (useLock.getState().status.locked) return
        void navigate(ROUTE_PATHS[route])
      }),
    [navigate],
  )

  // "Encerrar e sair" no diálogo de fechar com gravação (contrato 22): encerra; o main sai depois de salvar.
  useEffect(() => window.__scribeApi.on('scribe:recording-end-and-quit', () => void useRecording.getState().end()), [])

  // Contrato 23: "Encerrar" no menu do ícone da barra de menus.
  useEffect(() => window.__scribeApi.on('scribe:recording-end', () => void useRecording.getState().end()), [])

  // "Abrir" de uma notificação de tarefa: a tela "Automações" com a execução aberta.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-run', ({ runId }) => {
        if (useLock.getState().status.locked) return
        useAutomations.getState().openRun(runId)
        void navigate(ROUTE_PATHS.automacoes)
      }),
    [navigate],
  )

  useEffect(
    () =>
      window.__scribeApi.on('scribe:new-recording', () => {
        if (!useLock.getState().status.locked) startRecording()
      }),
    [startRecording],
  )
}
