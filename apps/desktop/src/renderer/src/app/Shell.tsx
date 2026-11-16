import { Route, Routes, useLocation } from 'react-router'
import { APP_ROUTES, routeIdOf } from './routes'
import { Sidebar } from './Sidebar'
import { useMainNavigation } from './useMainNavigation'

/**
 * Esqueleto da janela: barra lateral azul à esquerda, área principal em `--bg`. A faixa arrastável de
 * 52 px fica por cima do topo da área (os controles dentro dela usam `no-drag`), para o conteúdo
 * começar a 28 px do topo como nas telas aprovadas.
 */
export function Shell() {
  const location = useLocation()
  useMainNavigation()

  return (
    <div className="flex h-full">
      <Sidebar />
      <main data-route={routeIdOf(location.pathname) ?? ''} className="relative flex min-w-0 flex-1 flex-col bg-bg">
        <div className="drag absolute inset-x-0 top-0 h-[var(--titlebar-height)]" />
        <div key={location.pathname} className="route-enter relative flex min-h-0 flex-1 flex-col">
          <Routes location={location}>
            {APP_ROUTES.map((route) => (
              <Route key={route.id} path={route.path} element={route.element} />
            ))}
          </Routes>
        </div>
      </main>
    </div>
  )
}
