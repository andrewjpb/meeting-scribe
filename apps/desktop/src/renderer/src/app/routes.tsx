// Tabela de rotas. Rota nova: id em shared/routes.ts, linha aqui; com `nav`, aparece na barra lateral.
import type { LucideIcon } from 'lucide-react'
import { MessageCircle, NotebookText, Settings, Smartphone } from 'lucide-react'
import type { ReactElement } from 'react'
import { matchPath } from 'react-router'
import { ROUTE_PATHS, SETTINGS_ROUTE_PATTERN, type RouteId } from '@shared/routes'
import { ChatScreen } from '../features/chat/ChatScreen'
import { LiveScreen } from '../features/live/LiveScreen'
import { MeetingDetailScreen } from '../features/meetings/MeetingDetailScreen'
import { MeetingsScreen } from '../features/meetings/MeetingsScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { WhatsAppScreen } from '../features/whatsapp/WhatsAppScreen'

export interface AppRoute {
  id: RouteId
  path: string
  element: ReactElement
  nav?: { label: string; icon: LucideIcon }
}

export const APP_ROUTES: AppRoute[] = [
  { id: 'reunioes', path: ROUTE_PATHS.reunioes, element: <MeetingsScreen />, nav: { label: 'Reuniões', icon: NotebookText } },
  { id: 'perguntar', path: ROUTE_PATHS.perguntar, element: <ChatScreen />, nav: { label: 'Perguntar', icon: MessageCircle } },
  // Contrato 24: só aparece na barra lateral com o serviço do WhatsApp instalado (`Sidebar`).
  { id: 'whatsapp', path: ROUTE_PATHS.whatsapp, element: <WhatsAppScreen />, nav: { label: 'WhatsApp', icon: Smartphone } },
  { id: 'gravacao', path: ROUTE_PATHS.gravacao, element: <LiveScreen /> },
  { id: 'detalhe', path: ROUTE_PATHS.detalhe, element: <MeetingDetailScreen /> },
  {
    id: 'configuracoes',
    // Contrato 18: a aba aberta fica na URL (`/configuracoes/claude`).
    path: SETTINGS_ROUTE_PATTERN,
    element: <SettingsScreen />,
    nav: { label: 'Configurações', icon: Settings },
  },
]

export function routeIdOf(pathname: string): RouteId | null {
  return APP_ROUTES.find((route) => matchPath(route.path, pathname))?.id ?? null
}
