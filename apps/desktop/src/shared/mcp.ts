// Servidores MCP do agente (contrato 21): o que o renderer e o main trocam. Duas fontes: os servidores do próprio Claude
// CLI (`claude mcp list`, escopo `user`), que o app só liga e desliga para si, e os do cadastro do app
// (`userData/mcp-servers.json`), que valem só aqui. Desligado por padrão; liga por servidor e por uso (chat e análise;
// nunca tradução nem resumo). Toda chamada de ferramenta MCP pede aprovação na conversa, a não ser a ferramenta marcada
// "Sempre permitir". Segredo (variável ou cabeçalho marcado) nunca volta ao renderer: só "•••• definido".
//
// Tudo o que chega de um servidor MCP (nomes e descrições de ferramentas, mensagens de erro) é dado, nunca instrução:
// passa por limites de tamanho e vai para a tela como texto puro.

/** Usos de um servidor: o chat (Assistente e conversa da reunião) e a análise da reunião. */
export const MCP_USES = ['chat', 'analysis'] as const
export type McpUse = (typeof MCP_USES)[number]
export const DEFAULT_MCP_USES: readonly McpUse[] = ['chat']

/** O que fazer quando o Claude pede uma ferramenta: perguntar (padrão), permitir sempre ou negar sempre. */
export const MCP_TOOL_POLICIES = ['ask', 'allow', 'deny'] as const
export type McpToolPolicy = (typeof MCP_TOOL_POLICIES)[number]

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/**
 * Nome do servidor: 1 a 40 letras, números, `-` e `_`, sem `__` e sem começar nem terminar com `_` (o Claude chama a
 * ferramenta de `mcp__<servidor>__<ferramenta>`; `a_` daria `mcp__a___ferramenta`, que não tem como ser lido de volta).
 */
export const MCP_NAME_PATTERN = /^(?!.*__)(?!_)(?!.*_$)[A-Za-z0-9_-]{1,40}$/
/** Chave de variável de ambiente. */
export const MCP_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/
/** Nome de cabeçalho HTTP (token do RFC 9110). */
export const MCP_HEADER_KEY_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/
export const MCP_COMMAND_MAX = 1000
export const MCP_ARGS_MAX = 50
export const MCP_ARG_MAX = 2000
export const MCP_PAIRS_MAX = 30
export const MCP_VALUE_MAX = 4000
export const MCP_URL_MAX = 2000
export const MCP_SERVERS_MAX = 50
/** Ferramentas lidas de um servidor (o resto fica de fora) e o tamanho de cada nome e descrição. */
export const MCP_TOOLS_MAX = 200
export const MCP_TOOL_NAME_MAX = 128
export const MCP_TOOL_DESCRIPTION_MAX = 300
/** Argumentos mostrados no cartão de aprovação. */
export const MCP_APPROVAL_ARGS_MAX = 4000
/** "Testar conexão": `initialize` e `tools/list` neste prazo. */
export const MCP_TEST_TIMEOUT_MS = 15_000
/** Cartão de aprovação sem resposta: negado. */
export const MCP_APPROVAL_TIMEOUT_MS = 2 * 60_000

/** O que aparece no lugar de um segredo. */
export const MCP_SECRET_MASK = '••••'

/** Aviso fixo da aba "Conexões" (CA7). */
export const MCP_FIXED_WARNING =
  'Servidores MCP dão ao Claude acesso a outros sistemas. Ligue só os que você confia. Texto de reunião pode tentar pedir ações: confira cada pedido.'
/** Adendo do contrato: a internet (contrato 26) e os servidores MCP são permissões separadas. */
export const MCP_INDEPENDENT_NOTE = 'A fonte "Internet" do Assistente e os servidores MCP são permissões separadas: ligar uma não liga a outra.'

/** Descrições das linhas fixas da aba, as mesmas na tela e no índice da busca. */
export const MCP_CLI_DESCRIPTION = 'Os servidores MCP do claude instalado neste Mac (claude mcp list). Ligue os que o app pode usar.'
export const MCP_APP_DESCRIPTION = 'Servidores que valem só neste app.'
export const MCP_FOUND_DESCRIPTION = 'Servidores de outras ferramentas (Claude Desktop). Importar não traz os segredos.'
export const MCP_ADD_DESCRIPTION = 'Um comando local (stdio) ou um endereço (HTTP), no Claude CLI ou só neste app.'

export const MCP_USE_LABELS: Readonly<Record<McpUse, string>> = { chat: 'Chat', analysis: 'Análise' }
export const MCP_POLICY_LABELS: Readonly<Record<McpToolPolicy, string>> = { ask: 'Perguntar', allow: 'Permitir', deny: 'Negar' }
export const MCP_TRANSPORT_LABELS: Readonly<Record<McpTransport, string>> = { stdio: 'Comando local', http: 'HTTP', sse: 'SSE' }

/** Uma variável ou um cabeçalho como a pessoa digitou (só do renderer para o main). */
export interface McpPair {
  key: string
  value: string
  secret: boolean
  /** Edição: segredo já guardado que fica como está (o valor não volta ao renderer, então chega vazio). */
  keep?: boolean | undefined
}

/** Uma variável ou um cabeçalho para a tela: o valor do segredo nunca vem. */
export interface McpPairView {
  key: string
  /** `null` quando é segredo. */
  value: string | null
  secret: boolean
  /** Segredo com valor guardado ("•••• definido"); vazio, ainda falta preencher (o importado chega assim). */
  defined: boolean
}

export interface McpToolInfo {
  name: string
  description: string
}

/** Estado de um servidor na lista. */
export type McpServerState =
  | { kind: 'off' }
  /** Ligado, ainda sem teste nesta máquina. */
  | { kind: 'untested' }
  | { kind: 'connected'; tools: number }
  | { kind: 'error'; reason: string }

/** Servidor do cadastro do app, como a tela vê. */
export interface McpServerView {
  id: string
  /** `app:<id>`: a chave do servidor nas conversas (interruptor por conversa). */
  key: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  cwd: string | null
  env: McpPairView[]
  url: string | null
  headers: McpPairView[]
  enabled: boolean
  uses: McpUse[]
  toolPolicy: Record<string, McpToolPolicy>
  source: 'manual' | 'import'
  /** Ferramentas do último "Testar". */
  tools: McpToolInfo[]
  state: McpServerState
}

/** Saúde do servidor como o próprio `claude mcp list` diz. */
export type McpCliHealth = 'connected' | 'failed' | 'pending' | 'needs-auth' | 'unknown'
export const MCP_CLI_HEALTH_LABELS: Readonly<Record<McpCliHealth, string>> = {
  connected: 'Conectado',
  failed: 'Falhou',
  pending: 'Pendente de aprovação',
  'needs-auth': 'Precisa de login',
  unknown: 'Desconhecido',
}

/** Servidor do Claude CLI, como a tela vê (nada do disco do CLI vem, só o que a lista mostra). */
export interface McpCliServerView {
  /** `cli:<nome>`. */
  key: string
  name: string
  transport: McpTransport | 'other'
  health: McpCliHealth
  /**
   * Dá para usar no app: está no escopo `user` do CLI, com transporte que o app passa ao agente. Os conectores do
   * claude.ai e os de plugins não dão (o app não tem como passar a definição deles).
   */
  usable: boolean
  enabled: boolean
  uses: McpUse[]
  toolPolicy: Record<string, McpToolPolicy>
  tools: McpToolInfo[]
  state: McpServerState
}

/** Servidor achado em outra ferramenta, só para mostrar e importar: sem nenhum valor de variável ou cabeçalho. */
export interface McpFoundServer {
  /** `<fonte>:<nome>`. */
  id: string
  source: 'claude-desktop'
  sourceLabel: string
  name: string
  transport: McpTransport
  /** Só o nome do programa (sem os argumentos, que podem levar segredo). */
  command: string | null
  /** Só a origem do endereço. */
  url: string | null
  envKeys: string[]
  headerKeys: string[]
}

export interface McpOverview {
  cli: { state: 'ok' | 'not-found' | 'error' | 'loading'; servers: McpCliServerView[]; error?: string | undefined }
  app: McpServerView[]
  found: McpFoundServer[]
}

/** O formulário de "Adicionar servidor MCP" (e o de editar um do app). */
export interface McpServerInput {
  /** Edição de um servidor do app. */
  id?: string | undefined
  /** "Salvar no Claude CLI (vale também no terminal)" ou "Só neste app". A edição é sempre do app. */
  target: 'cli' | 'app'
  name: string
  transport: McpTransport
  command?: string | undefined
  args?: string[] | undefined
  cwd?: string | undefined
  env?: McpPair[] | undefined
  url?: string | undefined
  headers?: McpPair[] | undefined
  uses?: McpUse[] | undefined
}

export type McpTestResult = { ok: true; tools: McpToolInfo[] } | { ok: false; error: string }
export type McpSaveResult = { ok: true; overview: McpOverview } | { ok: false; error: string }

/** "Ver detalhes" de um servidor do CLI: rótulo e valor, com variáveis e cabeçalhos mascarados. */
export interface McpCliDetails {
  name: string
  lines: { label: string; value: string }[]
}

/** Linha "Conexões" do painel Contexto: os servidores ligados para o chat. */
export interface McpChatServer {
  key: string
  name: string
  /** `null` se o agente aceita; senão o motivo ("não suportado por este agente"). */
  unavailable: string | null
}

/** Pedido de aprovação na conversa (CA5): "O Claude quer usar <ferramenta> de <servidor>". */
export interface McpApproval {
  id: string
  server: string
  tool: string
  /** Os argumentos em JSON formatado, cortados e com os segredos do cadastro mascarados. */
  args: string
}

export const MCP_APPROVAL_DECISIONS = ['once', 'always', 'deny'] as const
export type McpApprovalDecision = (typeof MCP_APPROVAL_DECISIONS)[number]

/** Endereço permitido: `https://` em qualquer lugar, ou `http://` só no próprio Mac (127.0.0.1 ou localhost). */
export function mcpUrlAllowed(value: string): boolean {
  if (value.length > MCP_URL_MAX) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return url.hostname !== ''
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
}

/** Nome da ferramenta MCP no Claude (`mcp__<servidor>__<ferramenta>`) de volta ao servidor e à ferramenta. */
export function mcpToolOf(name: string | undefined): { server: string; tool: string } | null {
  if (!name?.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const at = rest.indexOf('__')
  if (at <= 0) return null
  const tool = rest.slice(at + 2)
  return tool ? { server: rest.slice(0, at), tool } : null
}

/** O nome do servidor como o Claude o usa no nome das ferramentas: o que não for letra, número, `-` ou `_` vira `_`. */
export function mcpToolServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * O nome de uma ferramenta como o Claude Code o põe em `mcp__<servidor>__<ferramenta>` (o que não for letra, número, `-`
 * ou `_` vira `_`): a chave das regras "Perguntar", "Permitir" e "Negar".
 */
export function mcpToolKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Troca cada segredo (de 3 caracteres ou mais) que aparecer no texto por "••••". */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let masked = text
  for (const secret of [...secrets].filter((value) => value.length >= 3).sort((a, b) => b.length - a.length)) masked = masked.split(secret).join(MCP_SECRET_MASK)
  return masked
}

/** Texto curto vindo de fora (nome ou descrição de ferramenta, motivo de erro): uma linha, sem controle, cortado. */
export function mcpText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const line = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** O estado na tela: "Desligado", "Ligado · não testado", "Conectado · 2 ferramentas", "Erro: …". */
export function mcpStateLabel(state: McpServerState): string {
  if (state.kind === 'off') return 'Desligado'
  if (state.kind === 'untested') return 'Ligado · não testado'
  if (state.kind === 'connected') return `Conectado · ${state.tools === 1 ? '1 ferramenta' : `${state.tools} ferramentas`}`
  return `Erro: ${state.reason}`
}

/** Um servidor lido de um JSON colado no formato do Claude Desktop (`{"mcpServers": {...}}`). */
export interface McpPastedServer {
  name: string
  transport: McpTransport
  command: string
  args: string[]
  env: McpPair[]
  url: string
  headers: McpPair[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Pares de um objeto `{ "CHAVE": "valor" }`; valor colado entra como segredo (o padrão seguro). */
function pairsOf(value: unknown): McpPair[] {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .slice(0, MCP_PAIRS_MAX)
    .map(([key, text]) => ({ key: key.slice(0, 100), value: text.slice(0, MCP_VALUE_MAX), secret: true }))
}

/**
 * "Colar JSON" (CA3): o formato do Claude Desktop (`{"mcpServers": {"nome": {...}}}`), um servidor sem o nome
 * (`{"command": …}`) ou `{"nome": {...}}`. Devolve os servidores achados (o formulário usa o primeiro) ou o motivo.
 */
export function parseMcpJson(text: string): { ok: true; servers: McpPastedServer[] } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O texto colado não é um JSON válido.' }
  }
  if (!isRecord(data)) return { ok: false, error: 'O JSON precisa ser um objeto.' }
  const isServer = (value: unknown): value is Record<string, unknown> => isRecord(value) && (typeof value['command'] === 'string' || typeof value['url'] === 'string')
  const entries: [string, unknown][] = isRecord(data['mcpServers']) ? Object.entries(data['mcpServers']) : isServer(data) ? [['', data]] : Object.entries(data)
  const servers: McpPastedServer[] = []
  for (const [name, value] of entries.slice(0, MCP_SERVERS_MAX)) {
    if (!isServer(value)) continue
    const url = typeof value['url'] === 'string' ? value['url'] : ''
    const type = value['type'] === 'sse' ? 'sse' : value['type'] === 'http' || (url && typeof value['command'] !== 'string') ? 'http' : 'stdio'
    servers.push({
      name: name.slice(0, 40),
      transport: type,
      command: typeof value['command'] === 'string' ? value['command'].slice(0, MCP_COMMAND_MAX) : '',
      args: Array.isArray(value['args']) ? value['args'].filter((arg): arg is string => typeof arg === 'string').slice(0, MCP_ARGS_MAX) : [],
      env: pairsOf(value['env']),
      url: url.slice(0, MCP_URL_MAX),
      headers: pairsOf(value['headers']),
    })
  }
  return servers.length ? { ok: true, servers } : { ok: false, error: 'Nenhum servidor no JSON (precisa de "command" ou "url").' }
}
