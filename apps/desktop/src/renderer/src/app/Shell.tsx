import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { TAREFAS_ROOT_PATH, type TarefasNavigationState } from '@shared/routes'
import { useLock } from './lockStore'
import { APP_ROUTES, redirectElement, REDIRECTS, routeIdOf } from './routes'
import { Sidebar } from './Sidebar'
import { useMainNavigation } from './useMainNavigation'
import { useWhatsAppSync } from '../features/whatsapp/whatsappStore'
import { useTriagemSync } from '../features/whatsapp/triagemStore'
import { useEmailSync } from '../features/email/emailStore'
import { useRedesSync } from '../features/redes/redesStore'
import { CalendarBanner } from '../features/calendar/CalendarBanner'
import { useCalendarSync } from '../features/calendar/calendarStore'
import { useMeetSync } from '../features/live/meetStore'
import { useTarefas } from '../features/tarefas/tarefasStore'

/** ⌘⇧T sem outro modificador (contrato 123, D19): abre Tarefas com o formulário "Nova tarefa". */
export function isNovaTarefaShortcut(event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>): boolean {
  return event.code === 'KeyT' && event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey
}

/**
 * Esqueleto da janela: barra lateral azul à esquerda, área principal em `--bg`. A faixa arrastável de
 * 52 px fica por cima do topo da área (os controles dentro dela usam `no-drag`), para o conteúdo
 * começar a 28 px do topo como nas telas aprovadas.
 */
export function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  useMainNavigation()
  useWhatsAppSync()
  // Contrato 162: as etiquetas da triagem do WhatsApp (abas, chips e o Urgente das Notificações).
  useTriagemSync()
  // Contrato 43: as contas de email e as não lidas de cada uma, para a barra lateral.
  useEmailSync()
  // Contrato 72: as contas das redes (o item "Redes" só aparece com conta) e a fila de publicações de cada uma.
  useRedesSync()
  // Contrato 12: "Próximas" e a faixa "não está sendo gravada" chegam do main.
  useCalendarSync()
  // Contrato 27: a extensão do Meet; os eventos de fala valem em qualquer tela durante a gravação.
  useMeetSync()
  // Contrato 123 (R1): as tarefas carregadas uma vez e acompanhadas, para o número de vencidas da barra lateral aparecer
  // sem abrir a tela.
  useEffect(() => {
    const { load, watch } = useTarefas.getState()
    const off = watch()
    void load()
    return off
  }, [])
  // Contrato 123 (D19): ⌘⇧T, desbloqueado, leva a Tarefas com "Nova tarefa" aberto e o foco no título.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isNovaTarefaShortcut(event) || event.repeat) return
      event.preventDefault()
      if (useLock.getState().status.locked) return
      const state: TarefasNavigationState = { nova: true }
      void navigate(TAREFAS_ROOT_PATH, { state })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
  const routeId = routeIdOf(location.pathname)
  // Trocar de aba em Configurações (ou de pasta no email, contrato 43, ou de seção nas redes, contrato 72, ou de tarefa,
  // contrato 123, que guarda a visão, a busca e o agrupamento) não remonta a tela (nem refaz a transição de rota).
  const routeKey = routeId === 'configuracoes' || routeId === 'email' || routeId === 'redes' || routeId === 'tarefas' ? routeId : location.pathname

  return (
    <div className="flex h-full">
      <Sidebar />
      <main data-route={routeId ?? ''} className="relative flex min-w-0 flex-1 flex-col bg-bg">
        <div className="drag absolute inset-x-0 top-0 h-[var(--titlebar-height)]" />
        <CalendarBanner />
        <div key={routeKey} className="route-enter relative flex min-h-0 flex-1 flex-col">
          <Routes location={location}>
            {APP_ROUTES.map((route) => (
              <Route key={route.id} path={route.path} element={route.element} />
            ))}
            {REDIRECTS.map((redirect) => (
              <Route key={redirect.from} path={redirect.from} element={redirectElement(redirect.to)} />
            ))}
          </Routes>
        </div>
      </main>
    </div>
  )
}
