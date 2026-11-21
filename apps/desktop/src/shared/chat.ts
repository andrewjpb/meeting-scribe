// Chat sobre as reuniões (contratos 15 e 16), hoje a tela "Assistente" (contrato 25): o que o renderer e o main
// trocam. O `claude` roda só no main, numa pasta só de leitura com as reuniões em Markdown; o renderer manda a
// pergunta e recebe a resposta enquanto ela é escrita, com o raciocínio, os passos de leitura e os detalhes da
// resposta. Contrato 25: a pasta da conversa do Assistente leva também o WhatsApp, as automações, o guia do app e o
// estado atual, e a resposta pode trazer ações propostas (`ChatAction`), que só rodam com o clique da pessoa.
import type { ChatAction } from './assistant'
import type { McpApproval, McpApprovalDecision } from './mcp'
import { NAVEGADOR_FERRAMENTAS } from './navegador-ferramentas'
import type { ChatModel } from './settings-defaults'

/** Até 200 mensagens por conversa; acima disso as mais antigas saem. */
export const CHAT_MESSAGES_MAX = 200
/** Texto de cada mensagem: pergunta e resposta. */
export const CHAT_TEXT_MAX = 20_000
/** Título da conversa: a primeira pergunta, cortada. */
export const CHAT_TITLE_MAX = 80
/** Esquema dos links que citam uma reunião: `[título · dd/mm](meeting:<id>)`. */
export const MEETING_LINK_SCHEME = 'meeting:'

/** Raciocínio (`thinking`) guardado com cada resposta (contrato 16). */
export const CHAT_THINKING_MAX = 20_000
/** Passos de leitura guardados com cada resposta; acima disso os primeiros saem. */
export const CHAT_STEPS_MAX = 200
/** Rótulo de um passo. */
export const CHAT_STEP_LABEL_MAX = 200
/** "Reuniões escolhidas": até 50. */
export const CHAT_SCOPE_MEETINGS_MAX = 50
/** Contador do campo de pergunta aparece acima disto. */
export const CHAT_COUNTER_FROM = 2_000

export type ChatRole = 'user' | 'assistant'

/** Itens do "Plano" que o agente manda pelo ACP (contrato 17), guardados com cada resposta. */
export const CHAT_PLAN_MAX = 50
/** Texto de cada item do plano. */
export const CHAT_PLAN_TEXT_MAX = 500

/**
 * Ferramentas que viram passo na tela: as de leitura, (contrato 26) a busca na web e a página aberta, (contrato 21) as
 * dos servidores MCP ("Usando <ferramenta> (<servidor>)") e (contrato 47) as do navegador do Assistente.
 */
export const CHAT_STEP_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Mcp', ...NAVEGADOR_FERRAMENTAS] as const
export type ChatStepTool = (typeof CHAT_STEP_TOOLS)[number]

/**
 * Um passo do Claude enquanto procura a resposta: "Lendo o índice das reuniões", "Abrindo «Planejamento»",
 * "Procurando "prazo"", "Listando arquivos". `meetingId` sai do nome do arquivo do acervo (que tem o id
 * inteiro); caminho de arquivo nunca chega à tela.
 */
export interface ChatStep {
  tool: ChatStepTool
  label: string
  meetingId: string | null
  /**
   * Pelo ACP (contrato 17): o id da chamada de ferramenta, para o mesmo passo mudar de estado (a tela troca o
   * passo de mesmo id em vez de acrescentar outro), e o estado dela.
   */
  id?: string | undefined
  status?: ChatStepStatus | undefined
}

/** Estado de um passo, como o protocolo manda: pendente, em andamento, feito ou falhou. */
export const CHAT_STEP_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const
export type ChatStepStatus = (typeof CHAT_STEP_STATUSES)[number]

/** Um item do "Plano" do agente (`plan` do ACP), com o estado dele. */
export const CHAT_PLAN_STATUSES = ['pending', 'in_progress', 'completed'] as const
export interface ChatPlanEntry {
  content: string
  status: (typeof CHAT_PLAN_STATUSES)[number]
}

/** Detalhes da resposta, do `system/init` e do `result` do `claude` (contrato 16, CA1). */
export interface ChatMeta {
  /** Id do modelo que respondeu (`claude-sonnet-…`), do `system/init`. */
  model: string
  durationMs: number
  /** Tokens de entrada cobrados como entrada (inclui os que foram gravados no cache). */
  inputTokens: number
  outputTokens: number
  /** Tokens de entrada lidos do cache. */
  cacheReadTokens: number
  /** Custo nominal em US$ (sai do plano do Claude da pessoa). */
  costUsd: number
  turns: number
  /** Reuniões abertas pelo Claude nesta resposta, na ordem. */
  consulted: string[]
}

/** Escopo da conversa da tela "Assistente": todas, últimos 7 ou 30 dias, ou as reuniões escolhidas. */
export const CHAT_SCOPE_KINDS = ['all', '7d', '30d', 'meetings'] as const
export type ChatScopeKind = (typeof CHAT_SCOPE_KINDS)[number]

export interface ChatScope {
  kind: ChatScopeKind
  /** Só em `meetings`. */
  meetingIds?: string[] | undefined
  /** Contrato 24 (CA5): conversas do WhatsApp lidas junto com as reuniões, até 10, em qualquer escopo. */
  whatsappChats?: string[] | undefined
  /** Últimos N dias dessas conversas (7, 30 ou 90; padrão 30). */
  whatsappDays?: number | undefined
  /**
   * Contrato 25 (CA2): como o WhatsApp entra. `recent` (padrão sem conversas escolhidas): as conversas com mensagem
   * nos últimos 14 dias; `chosen` ("Só estas conversas"): só as de `whatsappChats`. Com conversas escolhidas e sem o
   * campo (conversa do contrato 24), vale `chosen`.
   */
  whatsappMode?: ChatWhatsAppMode | undefined
  /**
   * Contrato 25 (CA2): fontes desligadas no painel "Contexto". Ausente = ligada. Contrato 76: as de `CHAT_SOURCES_OFF_BY_DEFAULT`
   * (a Redes) ao contrário: ausente = desligada, e fica guardado só o `true`.
   */
  sources?: Partial<ChatSources> | undefined
  /**
   * Contrato 21 (CA6): servidores MCP desligados nesta conversa (as chaves `app:<id>` e `cli:<nome>`). Ausente = os
   * ligados para o chat nas Configurações. Vale também na conversa de uma reunião (o resto do escopo não).
   */
  mcpOff?: string[] | undefined
}

export const CHAT_WHATSAPP_MODES = ['recent', 'chosen'] as const
export type ChatWhatsAppMode = (typeof CHAT_WHATSAPP_MODES)[number]

/**
 * Fontes do Assistente com interruptor (o estado atual vai sempre). `internet`: contrato 26; `email`: contrato 45; `redes`:
 * contrato 76 (o Instagram, desligada por padrão); `funil`: contrato 117 (o funil de vendas, desligada por padrão e a
 * primeira do painel: leva nomes, e-mails e telefones ao modelo).
 */
export const CHAT_SOURCE_KINDS = ['funil', 'whatsapp', 'email', 'redes', 'automations', 'guide', 'internet'] as const
export type ChatSourceKind = (typeof CHAT_SOURCE_KINDS)[number]
export type ChatSources = Record<ChatSourceKind, boolean>
/** Contrato 76: as fontes que começam desligadas (a conversa guarda só o `true` delas). Contrato 117: e o Funil. */
export const CHAT_SOURCES_OFF_BY_DEFAULT: readonly ChatSourceKind[] = ['redes', 'funil']

/** O valor de uma fonte quando a conversa não diz nada. */
export const chatSourceDefault = (kind: ChatSourceKind): boolean => !CHAT_SOURCES_OFF_BY_DEFAULT.includes(kind)

/** As fontes de um escopo, com o padrão (todas ligadas, menos a Redes e o Funil). */
export function chatSourcesOf(scope: Pick<ChatScope, 'sources'>): ChatSources {
  return {
    funil: scope.sources?.funil === true,
    whatsapp: scope.sources?.whatsapp !== false,
    email: scope.sources?.email !== false,
    redes: scope.sources?.redes === true,
    automations: scope.sources?.automations !== false,
    guide: scope.sources?.guide !== false,
    internet: scope.sources?.internet !== false,
  }
}

/** Só o que difere do padrão fica guardado na conversa (as desligadas e, da Redes e do Funil, o `true`). */
export function chatSourcesToKeep(sources: Partial<ChatSources> | undefined): Partial<ChatSources> {
  return Object.fromEntries(CHAT_SOURCE_KINDS.filter((kind) => sources?.[kind] !== undefined && sources[kind] !== chatSourceDefault(kind)).map((kind) => [kind, sources?.[kind] as boolean]))
}

/** Como o WhatsApp entra no escopo: o escolhido, ou `chosen` quando há conversas escolhidas. */
export function chatWhatsAppModeOf(scope: Pick<ChatScope, 'whatsappMode' | 'whatsappChats'>): ChatWhatsAppMode {
  return scope.whatsappMode ?? (scope.whatsappChats?.length ? 'chosen' : 'recent')
}

export const DEFAULT_CHAT_SCOPE: ChatScope = { kind: 'all' }

/**
 * `stopped`: a pessoa clicou em "Parar"; `timeout`: 3 min sem nenhum dado do processo; `failed`: o processo
 * morreu ou respondeu com erro; `not-found`: o `claude` não foi encontrado; `agent`: o agente do ACP não
 * abriu (pacote corrompido, versão incompatível; contrato 17, CA8) e a tela oferece a linha de comando;
 * `agent-missing`: o agente ainda não foi instalado (a tela oferece instalar ou a linha de comando).
 */
export const CHAT_ERRORS = ['stopped', 'timeout', 'failed', 'not-found', 'agent', 'agent-missing'] as const
export type ChatError = (typeof CHAT_ERRORS)[number]

export interface ChatMessage {
  role: ChatRole
  text: string
  /** ISO 8601. */
  at: string
  error?: ChatError | undefined
  /** Resposta: os passos de leitura, na ordem (contrato 16). */
  steps?: ChatStep[] | undefined
  /** Resposta: o raciocínio, quando o modelo mandou (texto puro, até 20 000 caracteres). */
  thinking?: string | undefined
  /** Resposta: ferramentas negadas. */
  denied?: number | undefined
  /** Resposta pelo ACP: o "Plano" do agente, como ficou no fim (contrato 17). */
  plan?: ChatPlanEntry[] | undefined
  /** Resposta: modelo, tempo, tokens, custo e reuniões consultadas. */
  meta?: ChatMeta | undefined
  /** Modelo pedido (`--model`) quando a mensagem foi feita. */
  model?: ChatModel | undefined
  /**
   * Contrato 25 (CA3): ações propostas pelo Assistente no fim da resposta, já validadas no main, com o estado de
   * cada cartão. Só as respostas do Assistente têm; as conversas criadas por uma automação nunca têm.
   */
  actions?: ChatAction[] | undefined
}

export interface Chat {
  id: string
  /** Conversa da aba "Assistente" de uma reunião; `null` na tela "Assistente" (todas as reuniões). */
  meetingId: string | null
  title: string
  /** ISO 8601. */
  createdAt: string
  messages: ChatMessage[]
  /** Pasta que o `claude` lê; a conversa de uma reunião ignora (é sempre só ela). */
  scope: ChatScope
  /** Modelo da conversa; `null` (conversa do contrato 15) segue o "Modelo do chat" das Configurações. */
  model: ChatModel | null
  /** "Pensar mais" (contrato 17, CA5): esforço alto no agente do ACP; a linha de comando ignora. */
  thinkMore: boolean
}

/** Linha da lista de conversas. */
export interface ChatListItem {
  id: string
  meetingId: string | null
  title: string
  createdAt: string
  /** Hora da última mensagem (ou da criação). */
  updatedAt: string
}

export type ChatSendResult = { ok: true; chat: Chat } | { ok: false; error: 'not-found' | 'busy' | 'missing' }

/** Pergunta: nova conversa (`chatId: null`) leva o escopo e o modelo escolhidos na barra do campo. */
export interface ChatSendRequest {
  chatId: string | null
  meetingId: string | null
  text: string
  scope?: ChatScope | undefined
  model?: ChatModel | undefined
  thinkMore?: boolean | undefined
}

/** Renomear, trocar o escopo, o modelo ou "Pensar mais" (vale para a próxima pergunta). */
export interface ChatUpdateRequest {
  id: string
  title?: string | undefined
  scope?: ChatScope | undefined
  model?: ChatModel | undefined
  thinkMore?: boolean | undefined
}

/** Contrato 21: a resposta da pessoa ao cartão de aprovação de uma ferramenta MCP. */
export interface ChatApprovalAnswer {
  chatId: string
  id: string
  decision: McpApprovalDecision
}

/**
 * "Refazer" e "Tentar de novo": a última resposta sai e a mesma pergunta vai de novo, num processo novo. Com
 * `text`, a última pergunta é trocada antes (↑ no campo vazio edita a última pergunta).
 */
export interface ChatRedoRequest {
  id: string
  text?: string | undefined
}

/** Resposta sendo escrita: o texto até agora e se o Claude está lendo os arquivos. */
export interface ChatProgress {
  text: string
  reading: boolean
}

/** O que acompanha a resposta além do texto (contrato 16, CA1). */
export type ChatDetail =
  /** Pedaço novo do raciocínio; quem recebe junta os pedaços na ordem. */
  | { type: 'thinking'; delta: string }
  /** Passo novo, ou (pelo ACP) o mesmo passo, de mesmo `id`, com rótulo ou estado novo. */
  | { type: 'step'; step: ChatStep }
  /** O "Plano" inteiro do agente, a cada mudança (ACP). */
  | { type: 'plan'; entries: ChatPlanEntry[] }
  /** Ferramentas negadas até agora nesta resposta. */
  | { type: 'denied'; count: number }
  | { type: 'meta'; meta: ChatMeta }
  /** Contrato 21: o Claude pede uma ferramenta MCP com a política "Perguntar" (o cartão na conversa). */
  | { type: 'approval'; approval: McpApproval }
  /** O cartão saiu: respondido, vencido em 2 min ou a resposta acabou. */
  | { type: 'approval-done'; id: string; decision: McpApprovalDecision }

/**
 * main -> renderer: a resposta cresceu (`answer`), o raciocínio, um passo, uma negação ou os detalhes
 * chegaram, ou ela terminou e a conversa foi salva (`done`).
 */
export type ChatEvent = ({ type: 'answer'; chatId: string } & ChatProgress) | ({ chatId: string } & ChatDetail) | { type: 'done'; chatId: string; chat: Chat }

/** Frase da tela para cada erro. */
export const CHAT_ERROR_TEXT: Readonly<Record<ChatError, string>> = {
  stopped: 'Resposta interrompida.',
  timeout: 'O Claude demorou demais.',
  failed: 'Não foi possível responder. Tente de novo.',
  'not-found': 'Configure o Claude CLI em Configurações.',
  agent: 'O agente do Claude não abriu.',
  'agent-missing': 'O agente do Claude não está instalado.',
}

/** Frase do erro com o nome do agente do perfil (contrato 17, CA11): "O agente do <label> não abriu." */
export function chatErrorText(error: ChatError, label: string): string {
  if (error === 'agent') return `O agente do ${label} não abriu.`
  if (error === 'agent-missing') return `O agente do ${label} não está instalado.`
  return CHAT_ERROR_TEXT[error]
}

/** Título da conversa a partir da primeira pergunta: uma linha só, cortada em 80 caracteres. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  if (line.length <= CHAT_TITLE_MAX) return line
  return `${line.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…`
}

/** Rótulo do passo de uma página da internet que a política do app recusou (contrato 26, CA3). */
export const WEB_BLOCKED_LABEL = 'Endereço bloqueado: não veio da busca'

/**
 * Quanto a resposta usou a internet (contrato 26, CA4), pelos passos gravados com ela: as buscas e as páginas que não
 * foram negadas. `used` liga o rodapé "Usou a internet" e o aviso dos cartões de ação.
 */
export function chatWebUsage(steps: readonly Pick<ChatStep, 'tool' | 'status'>[] | undefined): { used: boolean; searches: number; pages: number } {
  let searches = 0
  let pages = 0
  for (const step of steps ?? []) {
    if (step.status === 'failed') continue
    if (step.tool === 'WebSearch') searches++
    else if (step.tool === 'WebFetch') pages++
  }
  return { used: searches + pages > 0, searches, pages }
}

/** "Usou a internet · 2 buscas · 1 página". */
export function chatWebUsageLabel(usage: { searches: number; pages: number }): string {
  const searches = usage.searches === 1 ? '1 busca' : `${usage.searches} buscas`
  const pages = usage.pages === 1 ? '1 página' : `${usage.pages} páginas`
  return `Usou a internet · ${searches} · ${pages}`
}

/** Id da reunião de um link `meeting:<id>`; `null` se não for um. */
export function meetingIdOfLink(href: string): string | null {
  if (!href.startsWith(MEETING_LINK_SCHEME)) return null
  const id = href.slice(MEETING_LINK_SCHEME.length).trim()
  return /^[\w-]{1,200}$/.test(id) ? id : null
}
