// Tabela de rotas. Rota nova: id em shared/routes.ts, linha aqui; com `nav`, aparece na barra lateral.
import type { LucideIcon } from 'lucide-react'
import { AtSign, Bot, Funnel, House, Mail, NotebookText, Settings, Smartphone, Sparkles, SquareCheck } from 'lucide-react'
import type { ReactElement } from 'react'
import { matchPath, Navigate } from 'react-router'
import { ROUTE_PATHS, ROUTE_REDIRECTS, SETTINGS_ROUTE_PATTERN, type RouteId } from '@shared/routes'
import { AutomationsScreen } from '../features/agents/AutomationsScreen'
import { ChatScreen } from '../features/chat/ChatScreen'
import { EmailScreen } from '../features/email/EmailScreen'
import { FunilScreen } from '../features/funil/FunilScreen'
import { InicioScreen } from '../features/inicio/InicioScreen'
import { LiveScreen } from '../features/live/LiveScreen'
import { MeetingDetailScreen } from '../features/meetings/MeetingDetailScreen'
import { MeetingsScreen } from '../features/meetings/MeetingsScreen'
import { RedesScreen } from '../features/redes/RedesScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { TarefasScreen } from '../features/tarefas/TarefasScreen'
import { WhatsAppScreen } from '../features/whatsapp/WhatsAppScreen'

export interface AppRoute {
  id: RouteId
  path: string
  element: ReactElement
  nav?: { label: string; icon: LucideIcon }
}

export const APP_ROUTES: AppRoute[] = [
  // Contrato 135 (D1): "Início" no topo, acima de "Reuniões", sem número e sem nível em pilha.
  { id: 'inicio', path: ROUTE_PATHS.inicio, element: <InicioScreen />, nav: { label: 'Início', icon: House } },
  { id: 'reunioes', path: ROUTE_PATHS.reunioes, element: <MeetingsScreen />, nav: { label: 'Reuniões', icon: NotebookText } },
  // Contrato 123 (R1): "Tarefas" logo depois de "Reuniões", com o número de vencidas e sem nível em pilha (o detalhe de
  // uma tarefa abre ao lado da lista, na mesma tela). `SquareCheck` é o `CheckSquare` da spec com o nome novo do lucide.
  { id: 'tarefas', path: ROUTE_PATHS.tarefas, element: <TarefasScreen />, nav: { label: 'Tarefas', icon: SquareCheck } },
  // Contrato 25: "Perguntar" virou "Assistente".
  { id: 'assistente', path: ROUTE_PATHS.assistente, element: <ChatScreen />, nav: { label: 'Assistente', icon: Sparkles } },
  // Contrato 65: "Email" na raiz da barra lateral, com o número de não lidas; o clique abre o nível com as contas e as
  // pastas (`SidebarStack` e `EmailNav`).
  { id: 'email', path: ROUTE_PATHS.email, element: <EmailScreen />, nav: { label: 'Email', icon: Mail } },
  // Contrato 112 (R17, D13): "Funil" entre Email e Redes, sempre visível; o clique abre o nível com Oportunidades, Contatos
  // e Empresas (`SidebarStack`).
  { id: 'funil', path: ROUTE_PATHS.funil, element: <FunilScreen />, nav: { label: 'Funil', icon: Funnel } },
  // Contrato 72: "Redes" entre Email e Automações, só com uma conta conectada (ou a rota aberta; `Sidebar`), com a soma
  // dos não lidos; o clique abre o nível com as contas e as seções (`SidebarStack` e `RedesNav`).
  { id: 'redes', path: ROUTE_PATHS.redes, element: <RedesScreen />, nav: { label: 'Redes', icon: AtSign } },
  // Contrato 23: agentes, agendamentos e execuções, logo abaixo do "Assistente".
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
