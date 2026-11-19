import { Route, Routes, useLocation } from 'react-router'
import { APP_ROUTES, redirectElement, REDIRECTS, routeIdOf } from './routes'
import { Sidebar } from './Sidebar'
import { useMainNavigation } from './useMainNavigation'
import { useWhatsAppSync } from '../features/whatsapp/whatsappStore'
import { useEmailSync } from '../features/email/emailStore'
import { CalendarBanner } from '../features/calendar/CalendarBanner'
import { useCalendarSync } from '../features/calendar/calendarStore'
import { useMeetSync } from '../features/live/meetStore'

/**
 * Esqueleto da janela: barra lateral azul à esquerda, área principal em `--bg`. A faixa arrastável de
 * 52 px fica por cima do topo da área (os controles dentro dela usam `no-drag`), para o conteúdo
 * começar a 28 px do topo como nas telas aprovadas.
 */
export function Shell() {
  const location = useLocation()
  useMainNavigation()
  useWhatsAppSync()
  // Contrato 43: as contas de email e as não lidas de cada uma, para a barra lateral.
  useEmailSync()
  // Contrato 12: "Próximas" e a faixa "não está sendo gravada" chegam do main.
  useCalendarSync()
  // Contrato 27: a extensão do Meet; os eventos de fala valem em qualquer tela durante a gravação.
  useMeetSync()
  const routeId = routeIdOf(location.pathname)
  // Trocar de aba em Configurações (ou de pasta no email, contrato 43) não remonta a tela (nem refaz a transição de rota).
  const routeKey = routeId === 'configuracoes' || routeId === 'email' ? routeId : location.pathname

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
