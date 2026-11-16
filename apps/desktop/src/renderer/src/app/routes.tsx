// Tabela de rotas. Rota nova: id em shared/routes.ts, linha aqui; com `nav`, aparece na barra lateral.
import type { LucideIcon } from 'lucide-react'
import { MessageCircle, NotebookText, Settings } from 'lucide-react'
import type { ReactElement } from 'react'
import { matchPath } from 'react-router'
import { ROUTE_PATHS, type RouteId } from '@shared/routes'
import { ChatScreen } from '../features/chat/ChatScreen'
import { LiveScreen } from '../features/live/LiveScreen'
import { MeetingDetailScreen } from '../features/meetings/MeetingDetailScreen'
import { MeetingsScreen } from '../features/meetings/MeetingsScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'

export interface AppRoute {
  id: RouteId
  path: string
  element: ReactElement
  nav?: { label: string; icon: LucideIcon }
}

export const APP_ROUTES: AppRoute[] = [
  { id: 'reunioes', path: ROUTE_PATHS.reunioes, element: <MeetingsScreen />, nav: { label: 'Reuniões', icon: NotebookText } },
  { id: 'perguntar', path: ROUTE_PATHS.perguntar, element: <ChatScreen />, nav: { label: 'Perguntar', icon: MessageCircle } },
  { id: 'gravacao', path: ROUTE_PATHS.gravacao, element: <LiveScreen /> },
  { id: 'detalhe', path: ROUTE_PATHS.detalhe, element: <MeetingDetailScreen /> },
  {
    id: 'configuracoes',
    path: ROUTE_PATHS.configuracoes,
    element: <SettingsScreen />,
    nav: { label: 'Configurações', icon: Settings },
  },
]

export function routeIdOf(pathname: string): RouteId | null {
  return APP_ROUTES.find((route) => matchPath(route.path, pathname))?.id ?? null
}
