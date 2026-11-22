import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { emailPath, funilPath, isSettingsTab, meetingPath, REDES_ROOT_PATH, redesPath, ROUTE_PATHS, settingsPath, TAREFAS_ROOT_PATH, tarefasPath, type EmailNavigationState, type WhatsAppNavigationState } from '@shared/routes'
import { useAutomations } from '../features/agents/automationsStore'
import { useRecording } from '../features/live/recordingStore'
import { useStartRecording } from '../features/live/useStartRecording'
import { useRedes } from '../features/redes/redesStore'
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
        // Contrato 72: o caminho de Redes é um padrão com a conta e a seção; o destino concreto é `/redes`. Contrato 112
        // (D14): o do Funil também é padrão (`:secao?`); o destino é Oportunidades. Contrato 123: o de Tarefas (`:id?`)
        // também; o destino é a lista.
        void navigate(route === 'redes' ? REDES_ROOT_PATH : route === 'funil' ? funilPath('oportunidades') : route === 'tarefas' ? TAREFAS_ROOT_PATH : ROUTE_PATHS[route])
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

  // Contrato 25: "Abrir" da notificação de um lembrete ligado a uma conversa do WhatsApp.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-whatsapp', ({ chatId }) => {
        if (useLock.getState().status.locked) return
        const state: WhatsAppNavigationState = { chatId }
        void navigate(ROUTE_PATHS.whatsapp, { state })
      }),
    [navigate],
  )

  // Contrato 43: o clique na notificação de email: a Caixa de Entrada da conta com a mensagem aberta.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-email', ({ accountId, id, mailbox, found }) => {
        if (useLock.getState().status.locked) return
        // Contrato 55 (CA24): a que uma regra moveu abre na pasta de destino; sem o UID novo, só a pasta, com a nota.
        if (mailbox) {
          const state: EmailNavigationState = found === false ? { mailbox, movedByRule: true } : { messageId: id, mailbox, movedByRule: true }
          void navigate(emailPath(accountId, { path: mailbox }), { state })
          return
        }
        const state: EmailNavigationState = { messageId: id }
        void navigate(emailPath(accountId, 'inbox'), { state })
      }),
    [navigate],
  )

  // Contrato 76: o rascunho que o cartão do Assistente criou: Redes › Publicações da conta, com o editor nele.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-redes', ({ accountId, publicationId }) => {
        if (useLock.getState().status.locked || typeof accountId !== 'string' || typeof publicationId !== 'string') return
        useRedes.getState().openEditor({ accountId, id: publicationId })
        void navigate(redesPath(accountId, 'publicacoes'))
      }),
    [navigate],
  )

  // Contrato 123 (D7, R12): o "Abrir" da notificação de uma tarefa (`null`, a lista). Bloqueado, o main guarda o destino
  // e manda de novo depois do desbloqueio; aqui não se guarda nada.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-tarefa', ({ id }) => {
        if (useLock.getState().status.locked) return
        void navigate(tarefasPath(typeof id === 'string' && id ? id : undefined))
      }),
    [navigate],
  )

  // Contrato 50: "Recentes" no menu do ícone da barra de menus abre o detalhe da reunião.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-meeting', ({ meetingId }) => {
        if (useLock.getState().status.locked || typeof meetingId !== 'string' || !meetingId) return
        void navigate(meetingPath(meetingId))
      }),
    [navigate],
  )

  // Contrato 50: a linha dos plugins no menu do ícone leva a Configurações › Plugins.
  useEffect(
    () =>
      window.__scribeApi.on('scribe:open-settings', ({ tab }) => {
        if (useLock.getState().status.locked || !isSettingsTab(tab)) return
        void navigate(settingsPath(tab))
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
