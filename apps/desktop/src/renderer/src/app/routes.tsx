// Tabela de rotas. Rota nova: id em shared/routes.ts, linha aqui; com `nav`, aparece na barra lateral.
import type { LucideIcon } from 'lucide-react'
import { Bot, Mail, NotebookText, Settings, Smartphone, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import { matchPath, Navigate } from 'react-router'
import { ROUTE_PATHS, ROUTE_REDIRECTS, SETTINGS_ROUTE_PATTERN, type RouteId } from '@shared/routes'
import { AutomationsScreen } from '../features/agents/AutomationsScreen'
import { ChatScreen } from '../features/chat/ChatScreen'
import { EmailScreen } from '../features/email/EmailScreen'
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
  // Contrato 25: "Perguntar" virou "Assistente".
  { id: 'assistente', path: ROUTE_PATHS.assistente, element: <ChatScreen />, nav: { label: 'Assistente', icon: Sparkles } },
  // Contrato 65: "Email" na raiz da barra lateral, com o número de não lidas; o clique abre o nível com as contas e as
  // pastas (`SidebarStack` e `EmailNav`).
  { id: 'email', path: ROUTE_PATHS.email, element: <EmailScreen />, nav: { label: 'Email', icon: Mail } },
  // Contrato 23: agentes, tarefas agendadas e execuções, logo abaixo do "Assistente".
  { id: 'automacoes', path: ROUTE_PATHS.automacoes, element: <AutomationsScreen />, nav: { label: 'Automações', icon: Bot } },
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

/** Caminhos antigos que levam a uma rota de hoje: `/perguntar` abre o Assistente (contrato 25). */
export const REDIRECTS = ROUTE_REDIRECTS
export const redirectElement = (to: string): ReactElement => <Navigate to={to} replace />

export function routeIdOf(pathname: string): RouteId | null {
  return APP_ROUTES.find((route) => matchPath(route.path, pathname))?.id ?? null
}
