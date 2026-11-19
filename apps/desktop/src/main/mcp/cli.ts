// Os servidores MCP do próprio Claude CLI (contrato 21, CA0). A lista e a saúde vêm de `claude mcp list` (lido na hora,
// nada copiado para o disco do app); "Ver detalhes" usa `claude mcp get`; "Adicionar no Claude CLI" roda
// `claude mcp add-json -s user` e "Remover" roda `claude mcp remove -s user`. Tudo por `execFile`, sem shell, cada
// argumento separado, numa pasta vazia do app (os servidores de projeto de outra pasta não entram) e com o ambiente
// de `claudeEnv`.
//
// A definição de um servidor (comando, argumentos, variáveis, endereço e cabeçalhos) é lida do arquivo do CLI
// (`~/.claude.json`, chave `mcpServers`: o escopo `user`) só no main, na hora de abrir a sessão ou de testar: os
// segredos vão do arquivo do CLI direto para o processo do agente, sem passar pelo renderer. Nada do arquivo vai para
// log. Os dos plugins aparecem na lista, mas não dão para usar no app (não estão no arquivo; o app não tem como passar a
// definição deles ao agente).
//
// Contrato 57: as linhas `claude.ai <Nome>` da mesma lista são os conectores do claude.ai (`connectorsOf`). Nada do
// arquivo do CLI entra nessa conta e nenhum endereço do claude.ai é chamado; sem conector na lista, `claude auth status`
// diz se o login é por assinatura (sem ela, não há conector).
import { mkdir, readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  CLAUDE_CONNECTOR_NAME_MAX,
  CLAUDE_CONNECTOR_PREFIX,
  CLAUDE_CONNECTORS_MAX,
  claudeConnectorToolServer,
  MCP_ARG_MAX,
  MCP_ARGS_MAX,
  MCP_COMMAND_MAX,
  MCP_PAIRS_MAX,
  MCP_SECRET_MASK,
  MCP_URL_MAX,
  MCP_VALUE_MAX,
  maskSecrets,
  mcpText,
  type ClaudeConnector,
  type McpCliHealth,
  type McpTransport,
} from '../../shared/mcp'
import { claudeEnv, LOGIN_SHELL, LOGIN_SHELL_TIMEOUT_MS, type ExecFile } from '../claude-cli/locate'
import type { SpawnSummary } from '../claude-cli/summary'
import { readConnectorTools, type ConnectorStatus } from './connector-tools'

/** `claude mcp list` confere a saúde de cada servidor (sobe os de comando local): pode demorar. */
export const MCP_LIST_TIMEOUT_MS = 60_000
export const MCP_CLI_TIMEOUT_MS = 30_000

/** Uma linha de `claude mcp list`. */
export interface CliListEntry {
  name: string
  transport: McpTransport | 'other'
  health: McpCliHealth
}

/** Definição de um servidor do arquivo do CLI (só no main). */
export interface CliDefinition {
  transport: McpTransport
  command: string | null
  args: string[]
  env: Record<string, string>
  url: string | null
  headers: Record<string, string>
}

const STATUS = / - ([✔✓✘✗⏸!⚠])\s*/u

/**
 * Lê a saída de `claude mcp list`: `nome: alvo - ✔ Connected`, `nome: url (HTTP) - ✘ Failed to connect`,
 * `nome: … - ⏸ Pending approval`, `nome: … - ! Needs authentication`. O nome vai até o primeiro `: ` (nomes como
 * `plugin:pdf-viewer:pdf` têm `:` sem espaço). O alvo nunca sai daqui: só o tipo dele.
 */
export function parseMcpList(stdout: string): CliListEntry[] {
  const entries: CliListEntry[] = []
  for (const line of stdout.split('\n')) {
    const at = line.indexOf(': ')
    const status = STATUS.exec(line)
    if (at <= 0 || !status || status.index < at) continue
    const name = line.slice(0, at).trim()
    if (!name || name.length > 200) continue
    const target = line.slice(at + 2, status.index)
    const symbol = status[1]
    const rest = line.slice(status.index + status[0].length)
    const health: McpCliHealth =
      symbol === '✔' || symbol === '✓' ? 'connected' : symbol === '✘' || symbol === '✗' ? 'failed' : symbol === '⏸' ? 'pending' : /auth/i.test(rest) ? 'needs-auth' : 'unknown'
    const transport: CliListEntry['transport'] = /\(HTTP\)\s*$/.test(target) ? 'http' : /\(SSE\)\s*$/.test(target) ? 'sse' : /\(WS\)\s*$|\(WebSocket\)\s*$/i.test(target) ? 'other' : /^https?:\/\//.test(target.trim()) ? 'http' : 'stdio'
    if (!entries.some((entry) => entry.name === name)) entries.push({ name, transport, health })
  }
  return entries
}

/** Contrato 57: a linha é de um conector do claude.ai (`claude.ai Notion`)? */
export const isConnectorEntry = (name: string): boolean => name.startsWith(CLAUDE_CONNECTOR_PREFIX)

/**
 * Contrato 57: os conectores do claude.ai das linhas `claude.ai <Nome>` de `claude mcp list`, na ordem da lista. O estado
 * vem do símbolo ("✔ Connected", "! Needs authentication"; o resto é falha). Nome que não dá um servidor que o Claude
 * consiga ler de volta no nome das ferramentas fica de fora.
 */
export function connectorsOf(entries: readonly CliListEntry[]): ClaudeConnector[] {
  const connectors: ClaudeConnector[] = []
  for (const entry of entries) {
    if (!isConnectorEntry(entry.name)) continue
    const name = mcpText(entry.name.slice(CLAUDE_CONNECTOR_PREFIX.length), CLAUDE_CONNECTOR_NAME_MAX)
    const toolServer = claudeConnectorToolServer(name)
    if (!name || name.endsWith('…') || !/^claude_ai_[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/.test(toolServer)) continue
    if (connectors.some((known) => known.name === name || known.toolServer === toolServer)) continue
    connectors.push({ name, toolServer, state: entry.health === 'connected' ? 'connected' : entry.health === 'needs-auth' ? 'needs-auth' : 'failed' })
    if (connectors.length >= CLAUDE_CONNECTORS_MAX) break
  }
  return connectors
}

/**
 * Contrato 57: a saída de `claude auth status --json` diz que o login é por assinatura (`authMethod: "claude.ai"` com o
 * provedor da Anthropic)? `null` se não dá para saber.
 */
export function subscriptionOf(stdout: string): boolean | null {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const status = data as Record<string, unknown>
  if (status['loggedIn'] === false) return false
  if (typeof status['authMethod'] !== 'string') return null
  return status['authMethod'] === 'claude.ai' && (status['apiProvider'] === undefined || status['apiProvider'] === 'firstParty')
}

const stringRecord = z
  .record(z.string(), z.unknown())
  .transform((record) => Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length <= MCP_VALUE_MAX).slice(0, MCP_PAIRS_MAX)))
  .catch({})

const definitionSchema = z.object({
  type: z.string().optional().catch(undefined),
  command: z.string().max(MCP_COMMAND_MAX).optional().catch(undefined),
  args: z
    .array(z.unknown())
    .transform((args) => args.filter((arg): arg is string => typeof arg === 'string' && arg.length <= MCP_ARG_MAX).slice(0, MCP_ARGS_MAX))
    .optional()
    .catch(undefined),
  env: stringRecord.optional(),
  url: z.string().max(MCP_URL_MAX).optional().catch(undefined),
  headers: stringRecord.optional(),
})

/** Uma definição do formato do Claude (`~/.claude.json` ou `claude_desktop_config.json`); `null` se não dá para usar. */
export function definitionOf(raw: unknown): CliDefinition | null {
  const parsed = definitionSchema.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data
  const type = value.type ?? (value.url && !value.command ? 'http' : 'stdio')
  if (type === 'stdio') {
    if (!value.command) return null
    return { transport: 'stdio', command: value.command, args: value.args ?? [], env: value.env ?? {}, url: null, headers: {} }
  }
  if ((type === 'http' || type === 'sse') && value.url) return { transport: type, command: null, args: [], env: {}, url: value.url, headers: value.headers ?? {} }
  return null
}

/** Os servidores de um arquivo de configuração no formato `{ "mcpServers": { nome: definição } }`. */
export async function readServersFile(path: string): Promise<Map<string, CliDefinition>> {
  const servers = new Map<string, CliDefinition>()
  let data: unknown
  try {
    data = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return servers
  }
  const record = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>)['mcpServers'] : undefined
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return servers
  for (const [name, raw] of Object.entries(record as Record<string, unknown>).slice(0, 200)) {
    const definition = definitionOf(raw)
    if (definition && name.length <= 200) servers.set(name, definition)
  }
  return servers
}

/** Os valores de variáveis e cabeçalhos de uma definição (para mascarar o que vier na saída do CLI). */
export function definitionSecrets(definition: CliDefinition): string[] {
  return [...Object.values(definition.env), ...Object.values(definition.headers)]
}

/** O JSON de `claude mcp add-json`: o formato do próprio CLI. */
export function addJsonOf(definition: CliDefinition): string {
  if (definition.transport === 'stdio') return JSON.stringify({ type: 'stdio', command: definition.command, args: definition.args, env: definition.env })
  return JSON.stringify({ type: definition.transport, url: definition.url, headers: definition.headers })
}

/** Linhas de "Ver detalhes" que a tela mostra, na ordem; o resto da saída de `claude mcp get` fica no main. */
const DETAIL_LABELS: Readonly<Record<string, string>> = { scope: 'Escopo', status: 'Estado', type: 'Tipo', command: 'Comando', args: 'Argumentos', url: 'Endereço' }

/**
 * "Ver detalhes" (CA0): as linhas de `claude mcp get` que interessam (escopo, estado, tipo, comando, argumentos,
 * endereço), com todo valor de variável e de cabeçalho do arquivo mascarado, e as chaves das variáveis e dos
 * cabeçalhos com "••••" no lugar do valor.
 */
export function cliDetails(stdout: string, definition: CliDefinition | null): { label: string; value: string }[] {
  const secrets = definition ? definitionSecrets(definition) : []
  const lines: { label: string; value: string }[] = []
  for (const line of stdout.split('\n')) {
    const match = /^\s*(Scope|Status|Type|Command|Args|URL):\s*(.*)$/i.exec(line)
    const label = match?.[1] ? DETAIL_LABELS[match[1].toLowerCase()] : undefined
    if (!label || !match) continue
    lines.push({ label, value: mcpText(maskSecrets(match[2] ?? '', secrets), 300) })
  }
  if (definition) {
    for (const key of Object.keys(definition.env)) lines.push({ label: 'Variável', value: `${key}=${MCP_SECRET_MASK}` })
    for (const key of Object.keys(definition.headers)) lines.push({ label: 'Cabeçalho', value: `${key}: ${MCP_SECRET_MASK}` })
  }
  return lines.slice(0, 60)
}

export interface McpCliOptions {
  exec: ExecFile
  baseEnv: NodeJS.ProcessEnv
  /** Arquivo do CLI com o escopo `user` (`~/.claude.json`; no smoke, o do `claude` falso). */
  configFile: string
  /** Pasta vazia do app onde o `claude mcp` roda. */
  cwd: string
  /** Só no smoke: onde o `claude` falso guarda os servidores. */
  extraEnv?: NodeJS.ProcessEnv | undefined
  /** Contrato 58: abre o `claude` no modo de controle para ler as ferramentas dos conectores. Sem isto, não lê. */
  spawn?: SpawnSummary | undefined
}

export interface McpCli {
  list(claudePath: string): Promise<CliListEntry[]>
  /** Contrato 57: o `claude` está logado por assinatura (`claude auth status`)? `null` se não respondeu. */
  subscription(claudePath: string): Promise<boolean | null>
  /** As definições do escopo `user`, lidas agora do arquivo do CLI. */
  definitions(): Promise<Map<string, CliDefinition>>
  details(claudePath: string, name: string): Promise<{ label: string; value: string }[]>
  add(claudePath: string, name: string, definition: CliDefinition): Promise<void>
  remove(claudePath: string, name: string): Promise<void>
  /**
   * Contrato 58: os conectores do `mcpServerStatus`, com as ferramentas; termina quando todos de `names` saem de "pending"
   * (o conjunto pode crescer durante a leitura).
   */
  connectorTools(claudePath: string, names: ReadonlySet<string>): Promise<ConnectorStatus[]>
}

export function createMcpCli(options: McpCliOptions): McpCli {
  const envFor = (claudePath: string): NodeJS.ProcessEnv => ({ ...claudeEnv(options.baseEnv, claudePath), ...(options.extraEnv ?? {}) })
  const run = async (claudePath: string, args: readonly string[], timeoutMs: number): Promise<string> => {
    await mkdir(options.cwd, { recursive: true, mode: 0o700 })
    const { stdout } = await options.exec(claudePath, args, { timeoutMs, env: envFor(claudePath), cwd: options.cwd })
    return stdout
  }
  const definitions = (): Promise<Map<string, CliDefinition>> => readServersFile(options.configFile)
  return {
    list: async (claudePath) => parseMcpList(await run(claudePath, ['mcp', 'list'], MCP_LIST_TIMEOUT_MS)),
    subscription: async (claudePath) => subscriptionOf(await run(claudePath, ['auth', 'status', '--json'], MCP_CLI_TIMEOUT_MS).catch(() => '')),
    definitions,
    details: async (claudePath, name) => {
      const [stdout, known] = await Promise.all([run(claudePath, ['mcp', 'get', name], MCP_CLI_TIMEOUT_MS).catch(() => ''), definitions()])
      return cliDetails(stdout, known.get(name) ?? null)
    },
    add: async (claudePath, name, definition) => {
      await run(claudePath, ['mcp', 'add-json', '-s', 'user', name, addJsonOf(definition)], MCP_CLI_TIMEOUT_MS)
    },
    remove: async (claudePath, name) => {
      await run(claudePath, ['mcp', 'remove', '-s', 'user', name], MCP_CLI_TIMEOUT_MS)
    },
    connectorTools: async (claudePath, names) => {
      if (!options.spawn) throw new Error('sem como abrir o claude')
      await mkdir(options.cwd, { recursive: true, mode: 0o700 })
      return readConnectorTools({ spawn: options.spawn, claudePath, env: envFor(claudePath), cwd: options.cwd, names })
    },
  }
}

/** Pastas que entram no `PATH` mesmo sem o shell de login (Homebrew e o padrão do macOS). */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

/**
 * O `PATH` do shell de login (`/bin/zsh -lc`, até 3 s), lido uma vez: o app aberto pelo Finder não herda o do terminal, e
 * os servidores de comando local costumam rodar com `npx`, `uvx` ou programas do Homebrew. Sem o shell, o do app mais o
 * Homebrew.
 */
export function loginPathOnce(exec: ExecFile, baseEnv: NodeJS.ProcessEnv): () => Promise<string> {
  let cached: Promise<string> | null = null
  const fallback = (): string => [...new Set([...(baseEnv['PATH'] ?? '').split(':').filter(Boolean), ...EXTRA_PATH])].join(':')
  return () => {
    cached ??= exec(LOGIN_SHELL, ['-lc', 'printf %s "$PATH"'], { timeoutMs: LOGIN_SHELL_TIMEOUT_MS, env: claudeEnv(baseEnv) }).then(
      ({ stdout }) => {
        const path = stdout.trim().split('\n').pop()?.trim() ?? ''
        return path.split(':').some((dir) => dir.startsWith('/')) ? [...new Set([...path.split(':').filter((dir) => dir.startsWith('/')), ...EXTRA_PATH])].join(':') : fallback()
      },
      () => fallback(),
    )
    return cached
  }
}
