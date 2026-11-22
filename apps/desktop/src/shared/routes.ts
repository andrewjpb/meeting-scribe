// Rotas do renderer. O main só conhece o id; o caminho é detalhe do roteador em memória.
export type RouteId = 'reunioes' | 'tarefas' | 'assistente' | 'automacoes' | 'whatsapp' | 'email' | 'funil' | 'redes' | 'gravacao' | 'detalhe' | 'configuracoes'

export const ROUTE_PATHS: Record<RouteId, string> = {
  reunioes: '/',
  /**
   * Tarefas (contrato 123, R1): a lista única, com o detalhe ao lado quando há id. Padrão do roteador; o caminho concreto
   * sai de `tarefasPath(id)`.
   */
  tarefas: '/tarefas/:id?',
  /** Assistente (contratos 15 e 25): pergunta sobre o app inteiro e propõe ações. */
  assistente: '/assistente',
  /** Agentes, agendamentos e execuções (contrato 23). */
  automacoes: '/automacoes',
  /** WhatsApp pessoal (contrato 24): só aparece na barra lateral com o serviço instalado. */
  whatsapp: '/whatsapp',
  /**
   * Email (contrato 43): a pasta de uma conta, aberta pela barra lateral. Padrão do roteador; o caminho concreto sai de
   * `emailPath(conta, pasta)`. Sem conta, a tela abre a Caixa de Entrada da primeira.
   */
  email: '/email/:conta?/:pasta?',
  /**
   * Funil de vendas (contrato 112, R17): Oportunidades, Contatos e Empresas, abertas pelo nível Funil da barra lateral.
   * Padrão do roteador; o caminho concreto sai de `funilPath(secao, id)`. Sem seção, a tela vai a Oportunidades.
   */
  funil: '/funil/:secao?/:id?',
  /**
   * Redes (contrato 72): a seção de uma conta do Instagram, aberta pelo nível Redes da barra lateral. Padrão do roteador;
   * o caminho concreto sai de `redesPath(conta, secao)`. Sem conta, a tela abre a primeira (ou o estado vazio).
   */
  redes: '/redes/:conta?/:secao?',
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

/** Pastas do email na URL (contrato 43): "Caixa de Entrada" e "Enviados". */
export const EMAIL_FOLDER_SLUGS = { inbox: 'entrada', sent: 'enviados' } as const

/**
 * Destino do item "Email" da barra lateral (contrato 65) na primeira vez da sessão: sem conta e sem pasta, a tela abre a
 * Caixa de Entrada da primeira conta (ou a nota de nenhuma conta). `ROUTE_PATHS.email` é o padrão do roteador.
 */
export const EMAIL_ROOT_PATH = '/email'

/**
 * Contrato 55: as outras pastas vão num segmento com este prefixo e o path codificado (`p~Clientes%2FABF`), que nunca
 * colide com os dois slugs acima (nem com uma pasta chamada "entrada").
 */
export const EMAIL_PATH_SLUG_PREFIX = 'p~'

/** A pasta da tela: as duas fixas, ou o path IMAP de qualquer outra (contrato 55). */
export type EmailRouteFolder = 'inbox' | 'sent' | { path: string }

/** Caminho da pasta de uma conta: `/email/<id>/entrada`, `/email/<id>/enviados` ou `/email/<id>/p~<path>`. */
export function emailPath(accountId: string, folder: EmailRouteFolder = 'inbox'): string {
  const slug = typeof folder === 'string' ? EMAIL_FOLDER_SLUGS[folder] : `${EMAIL_PATH_SLUG_PREFIX}${encodeURIComponent(folder.path)}`
  return `/email/${encodeURIComponent(accountId)}/${slug}`
}

/**
 * O inverso de `emailPath` para o segmento da pasta, ainda codificado (como está no caminho: a tela lê o `pathname`, não
 * o parâmetro já decodificado pelo roteador, para um `%` do nome não ser decodificado duas vezes); `null` fora do formato.
 */
export function emailFolderFromSlug(segment: string | undefined): EmailRouteFolder | null {
  if (segment === EMAIL_FOLDER_SLUGS.inbox) return 'inbox'
  if (segment === EMAIL_FOLDER_SLUGS.sent) return 'sent'
  if (!segment?.startsWith(EMAIL_PATH_SLUG_PREFIX)) return null
  try {
    const path = decodeURIComponent(segment.slice(EMAIL_PATH_SLUG_PREFIX.length))
    return path ? { path } : null
  } catch {
    return null
  }
}

/** O segmento da pasta (cru) num caminho da tela de email: `/email/<conta>/<pasta>`. */
export function emailFolderSegment(pathname: string): string | undefined {
  return pathname.split('/')[3]
}

/**
 * `state` da navegação para o email que abre uma mensagem (o clique na notificação, contrato 43). Contrato 55: `mailbox`
 * é a pasta onde ela está (uma regra a moveu); `movedByRule` sem `messageId` abre a pasta com a nota de que ela foi movida.
 */
export interface EmailNavigationState {
  messageId?: string
  mailbox?: string
  movedByRule?: boolean
  /** Contrato 55 (CA1): a pasta pedida não existe mais na conta; a Caixa de Entrada abre com a nota. */
  missingFolder?: string
  /** Contrato 112 (D12, R28): abre o Composer de uma mensagem nova já endereçada (quem usa é o detalhe da oportunidade). */
  compose?: { to: string[]; subject?: string }
}

/** Destino do item "Funil" da barra lateral (contrato 112): a tela vai a Oportunidades. */
export const FUNIL_ROOT_PATH = '/funil'

/** As seções do funil, na ordem do nível Funil (contrato 112, R17); a primeira é a padrão. */
export const FUNIL_SECTIONS = ['oportunidades', 'contatos', 'empresas'] as const
export type FunilSection = (typeof FUNIL_SECTIONS)[number]

export function isFunilSection(value: unknown): value is FunilSection {
  return typeof value === 'string' && (FUNIL_SECTIONS as readonly string[]).includes(value)
}

/** Caminho de uma seção do funil (`/funil/oportunidades`) ou de um item dela (`/funil/oportunidades/<id>`). */
export function funilPath(section: FunilSection = 'oportunidades', id?: string): string {
  return `${FUNIL_ROOT_PATH}/${section}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`
}

/** `state` da navegação para Oportunidades que abre o cartão "Nova oportunidade" já preenchido (contrato 112, D14). */
export interface FunilNavigationState {
  nova?: { contatoIds: string[]; empresaId: string | null }
}

/** Destino do item "Tarefas" da barra lateral (contrato 123): a lista, na visão Hoje. */
export const TAREFAS_ROOT_PATH = '/tarefas'

/** Caminho da lista (`/tarefas`) ou de uma tarefa com o detalhe ao lado (`/tarefas/<id>`). */
export function tarefasPath(id?: string): string {
  return id === undefined ? TAREFAS_ROOT_PATH : `${TAREFAS_ROOT_PATH}/${encodeURIComponent(id)}`
}

/** `state` da navegação para Tarefas que abre o formulário "Nova tarefa" com o foco no título (⌘⇧T, contrato 123). */
export interface TarefasNavigationState {
  nova?: boolean
}

/** Destino do item "Redes" da barra lateral (contrato 72) na primeira vez da sessão: a tela abre a primeira conta. */
export const REDES_ROOT_PATH = '/redes'

/** As seções de cada conta das redes, na ordem do nível Redes (contrato 72); a primeira é a padrão. */
export const REDES_SECTIONS = ['publicacoes', 'comentarios', 'mensagens', 'metricas'] as const
export type RedesSection = (typeof REDES_SECTIONS)[number]
export const DEFAULT_REDES_SECTION: RedesSection = 'publicacoes'

export function isRedesSection(value: unknown): value is RedesSection {
  return typeof value === 'string' && (REDES_SECTIONS as readonly string[]).includes(value)
}

/** Caminho da seção de uma conta: `/redes/<id>/publicacoes`. */
export function redesPath(accountId: string, section: RedesSection = DEFAULT_REDES_SECTION): string {
  return `${REDES_ROOT_PATH}/${encodeURIComponent(accountId)}/${section}`
}

export function meetingPath(id: string): string {
  return `/reunioes/${encodeURIComponent(id)}`
}

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === 'string' && Object.hasOwn(ROUTE_PATHS, value)
}

/**
 * Abas de Configurações (contrato 18), na ordem da tela. A aba aberta fica na URL: `/configuracoes/:aba`. Contrato 31:
 * "Plugins" entra antes de "Sobre", que continua a última. Contrato 21: "Conexões" (os servidores MCP) depois de
 * "Plugins". Contrato 55: "Email" logo depois de "Contas" (⌘6); Plugins, Conexões e Sobre passam a ⌘7, ⌘8 e ⌘9.
 */
export const SETTINGS_TABS = ['geral', 'gravacao', 'claude', 'arquivos', 'contas', 'email', 'plugins', 'conexoes', 'sobre'] as const
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

/** Contrato 72: âncora da seção "Instagram", na aba "Contas" ("Conectar conta…" do nível Redes). */
export const INSTAGRAM_ANCHOR = 'instagram'
/** Contrato 72: âncora da seção "Armazenamento de mídia (S3)", na aba "Contas" (a nota do editor de publicação). */
export const MEDIA_HOST_ANCHOR = 'armazenamento-de-midia'

/** `state` da navegação para Configurações que pede foco num campo depois de rolar (ex.: a chave). */
export interface SettingsNavigationState {
  focus?: string
}
