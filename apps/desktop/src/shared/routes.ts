// Rotas do renderer. O main só conhece o id; o caminho é detalhe do roteador em memória.
export type RouteId = 'reunioes' | 'assistente' | 'automacoes' | 'whatsapp' | 'gravacao' | 'detalhe' | 'configuracoes'

export const ROUTE_PATHS: Record<RouteId, string> = {
  reunioes: '/',
  /** Assistente (contratos 15 e 25): pergunta sobre o app inteiro e propõe ações. */
  assistente: '/assistente',
  /** Agentes, tarefas agendadas e execuções (contrato 23). */
  automacoes: '/automacoes',
  /** WhatsApp pessoal (contrato 24): só aparece na barra lateral com o serviço instalado. */
  whatsapp: '/whatsapp',
  gravacao: '/gravacao',
  /** Padrão do roteador; o caminho concreto sai de `meetingPath(id)`. */
  detalhe: '/reunioes/:id',
  configuracoes: '/configuracoes',
}

/** Caminho antigo da tela "Perguntar" (antes do contrato 25): redireciona para o Assistente. */
export const LEGACY_CHAT_PATH = '/perguntar'

/** Caminhos antigos que levam a uma rota de hoje. */
export const ROUTE_REDIRECTS: readonly { from: string; to: string }[] = [{ from: LEGACY_CHAT_PATH, to: ROUTE_PATHS.assistente }]

/** `state` da navegação para "WhatsApp" que abre uma conversa (com o texto no campo, do cartão do Assistente). */
export interface WhatsAppNavigationState {
  chatId?: string
  text?: string
}

export function meetingPath(id: string): string {
  return `/reunioes/${encodeURIComponent(id)}`
}

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === 'string' && Object.hasOwn(ROUTE_PATHS, value)
}

/** Abas de Configurações (contrato 18), na ordem da tela. A aba aberta fica na URL: `/configuracoes/:aba`. */
export const SETTINGS_TABS = ['geral', 'gravacao', 'claude', 'arquivos', 'contas', 'sobre'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'geral'

/** Padrão do roteador para Configurações: sem a aba, a tela abre a última aberta na sessão. */
export const SETTINGS_ROUTE_PATTERN = `${ROUTE_PATHS.configuracoes}/:aba?`

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)
}

/** Caminho de uma aba; com `anchor`, a tela rola até o bloco (`/configuracoes/geral#atualizacoes`). */
export function settingsPath(tab: SettingsTab, anchor?: string): string {
  return `${ROUTE_PATHS.configuracoes}/${tab}${anchor ? `#${anchor}` : ''}`
}

/** Âncora do bloco "Transcrição" (chave da AssemblyAI), na aba "Gravação". */
export const TRANSCRIPTION_ANCHOR = 'transcricao'

/** `state` da navegação para Configurações que pede foco num campo depois de rolar (ex.: a chave). */
export interface SettingsNavigationState {
  focus?: string
}
