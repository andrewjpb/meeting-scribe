// Servidores MCP do agente (contrato 21): a aba "Conexões" e o que entra em cada sessão do agente.
// - "Do Claude CLI" (CA0): o que `claude mcp list` devolve, lido na hora; "Usar no app" guarda só o nome (e os usos e
//   a política das ferramentas) em `userData/mcp-cli-enabled.json`. A definição é relida do arquivo do CLI a cada
//   sessão e a cada teste, só no main.
// - "Servidores do app" (CA1): o cadastro próprio, com os segredos cifrados (`store.ts`).
// - "Encontrados neste Mac" (CA2): o arquivo do Claude Desktop, lido só para mostrar (sem nenhum valor) e importar
//   ("para o Claude CLI" grava a definição direto no CLI pelo `add-json`; "só no app" copia sem os segredos).
// - "Adicionar servidor MCP" (CA3): "Salvar" só vale depois de um "Testar conexão" que deu certo com a mesma definição
//   (o main confere, não só a tela).
// - A sessão (CA4): só os servidores ligados para aquele uso, menos os desligados na conversa (CA6).
// - Contrato 57: os conectores do claude.ai saem da lista do CLI (não são "não usáveis": têm a lista própria). A sessão do
//   chat recebe os ligados em `settings.claudeConnectors` que a lista mostra conectados, e o nome de todo o resto que o
//   `claude` carregaria sem o modo estrito (os outros conectores, os servidores do escopo `user` e os de plugin), para o
//   perfil bloquear.
// Nenhum segredo sai daqui para o renderer nem para log.
import { createHash, randomUUID } from 'node:crypto'
import { access, constants, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { z } from 'zod'
import type { ClaudeLocateResult } from '../../shared/claude-cli'
import {
  claudeConnectorLabel,
  DEFAULT_MCP_USES,
  MCP_ARG_MAX,
  MCP_ARGS_MAX,
  MCP_COMMAND_MAX,
  MCP_ENV_KEY_PATTERN,
  MCP_HEADER_KEY_PATTERN,
  MCP_NAME_PATTERN,
  MCP_PAIRS_MAX,
  MCP_TOOL_NAME_MAX,
  MCP_TOOL_POLICIES,
  MCP_TRANSPORTS,
  MCP_URL_MAX,
  MCP_USES,
  MCP_VALUE_MAX,
  maskSecrets,
  mcpText,
  mcpToolKey,
  mcpToolServerName,
  mcpUrlAllowed,
  type ClaudeConnectorList,
  type ClaudeConnectorPrefs,
  type ClaudeConnectorsReason,
  type ClaudeConnectorTools,
  type McpChatServer,
  type McpCliDetails,
  type McpCliServerView,
  type McpFoundServer,
  type McpOverview,
  type McpPairView,
  type McpSaveResult,
  type McpServerState,
  type McpServerView,
  type McpTestResult,
  type McpToolInfo,
  type McpToolPolicy,
  type McpUse,
} from '../../shared/mcp'
import type { AcpConnectorSet, AcpMcpServer } from '../acp/profiles/types'
import { EncryptionUnavailableError } from '../secrets'
import { connectorsOf, isConnectorEntry, readServersFile, type CliDefinition, type CliListEntry, type McpCli } from './cli'
import type { ConnectorStatus } from './connector-tools'
import { testMcpServer, type McpConnectDefinition, type SpawnMcp } from './client'
import type { CliServerPrefs, McpStore, StoredMcpServer, StoredPair } from './store'

/** Contrato 57: depois de uma falha do `claude mcp list`, a sessão espera isto para tentar de novo. */
export const LIST_RETRY_MS = 60_000
/** Contrato 57: lista em cache com mais que isto é renovada em segundo plano depois de abrir a sessão. */
export const LIST_STALE_MS = 5 * 60_000

/** Definições testadas com sucesso que ainda dão direito a "Salvar" (as mais recentes). */
const TESTED_MAX = 20

export interface McpServiceDeps {
  store: McpStore
  cli: McpCli
  locate: () => Promise<ClaudeLocateResult>
  /** `claude_desktop_config.json` do Claude Desktop. */
  desktopConfig: string
  baseEnv: NodeJS.ProcessEnv
  /** `PATH` do shell de login, para achar o comando e rodar o servidor. */
  loginPath: () => Promise<string>
  spawn?: SpawnMcp
  testTimeoutMs?: number
  newId?: () => string
  now?: () => number
  log?: (message: string) => void
  /** Contrato 57: os conectores ligados e as regras deles (`settings.claudeConnectors`). Sem isto, nenhum. */
  connectorPrefs?: () => Promise<Readonly<Record<string, ClaudeConnectorPrefs>>>
  /** Contrato 57: "Sempre permitir esta ferramenta" de um conector: grava `allow` em `settings.claudeConnectors`. */
  allowConnectorTool?: (name: string, tool: string) => Promise<void>
}

export interface McpService {
  /** A aba "Conexões". Com `cli`, espera o `claude mcp list` (relido com `refresh`). */
  overview(input: unknown): Promise<McpOverview>
  save(input: unknown): Promise<McpSaveResult>
  test(input: unknown): Promise<McpTestResult>
  update(input: unknown): Promise<McpOverview | null>
  remove(input: unknown): Promise<McpSaveResult>
  details(input: unknown): Promise<McpCliDetails | null>
  importFound(input: unknown): Promise<McpSaveResult>
  /** Linha "Conexões" do painel Contexto: os ligados para o chat. */
  chatServers(): Promise<McpChatServer[]>
  /** Os servidores de uma sessão do agente (CA4): os ligados para o uso, menos os desligados na conversa. */
  sessionServers(use: McpUse, off: readonly string[]): Promise<AcpMcpServer[]>
  /** O que o agente disse que aceita no `initialize` (o comando local ele sempre aceita). */
  agentCapabilities(capabilities: { http: boolean; sse: boolean }): void
  /**
   * Contrato 57: os conectores da sessão do chat. `null` (nada muda na sessão) se nenhum ligado está conectado na lista;
   * sem nenhum ligado, nem a lista é lida.
   */
  sessionConnectors(): Promise<AcpConnectorSet | null>
  /**
   * Contrato 57: a lista em cache não vale mais para a próxima sessão com conector (mudou o MCP ou `claudeConnectors`):
   * ela espera uma lista nova.
   */
  invalidateConnectors(): void
  /**
   * Contrato 58 (CA3): "Ver ferramentas" de um conector conectado, do `mcpServerStatus` do `claude` (uma leitura serve
   * todos os conectores por 5 min).
   */
  connectorTools(input: unknown): Promise<ClaudeConnectorTools>
}

const pairSchema = z
  .object({ key: z.string().trim().max(100), value: z.string().max(MCP_VALUE_MAX), secret: z.boolean(), keep: z.boolean().optional() })
  .strict()
const inputSchema = z
  .object({
    id: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .optional(),
    target: z.enum(['cli', 'app']),
    name: z.string().trim().min(1).max(40),
    transport: z.enum(MCP_TRANSPORTS),
    command: z.string().trim().max(MCP_COMMAND_MAX).optional(),
    args: z.array(z.string().max(MCP_ARG_MAX)).max(MCP_ARGS_MAX).optional(),
    cwd: z.string().trim().max(MCP_COMMAND_MAX).optional(),
    env: z.array(pairSchema).max(MCP_PAIRS_MAX).optional(),
    url: z.string().trim().max(MCP_URL_MAX).optional(),
    headers: z.array(pairSchema).max(MCP_PAIRS_MAX).optional(),
    uses: z.array(z.enum(MCP_USES)).max(MCP_USES.length).optional(),
  })
  .strict()
type Input = z.infer<typeof inputSchema>

const keySchema = z.string().regex(/^(app:[\w-]{1,64}|cli:.{1,200})$/s)
const overviewSchema = z.object({ cli: z.boolean().optional(), refresh: z.boolean().optional() }).strict().optional()
const testSchema = z.union([z.object({ draft: z.unknown() }).strict(), z.object({ key: keySchema }).strict()])
const updateSchema = z
  .object({
    key: keySchema,
    enabled: z.boolean().optional(),
    uses: z.array(z.enum(MCP_USES)).max(MCP_USES.length).optional(),
    tool: z.string().min(1).max(MCP_TOOL_NAME_MAX).optional(),
    policy: z.enum(MCP_TOOL_POLICIES).optional(),
  })
  .strict()
const removeSchema = z.object({ key: keySchema }).strict()
const detailsSchema = z.object({ name: z.string().min(1).max(200) }).strict()
const importSchema = z.object({ id: z.string().min(1).max(260), target: z.enum(['cli', 'app']) }).strict()

/** Motivo de uma validação que não passou (frase da tela). */
class InvalidServer extends Error {}

const keyOf = { app: (id: string): string => `app:${id}`, cli: (name: string): string => `cli:${name}` }
const uniqueUses = (uses: readonly McpUse[] | undefined): McpUse[] => MCP_USES.filter((use) => (uses ?? DEFAULT_MCP_USES).includes(use))
const record = (pairs: readonly StoredPair[]): Record<string, string> => Object.fromEntries(pairs.map((pair) => [pair.key, pair.value]))

/** O comando existe e é executável (caminho absoluto, ou procurado no `PATH`)? Devolve o caminho. */
export async function findExecutable(command: string, path: string): Promise<string | null> {
  const executable = async (file: string): Promise<boolean> => {
    try {
      await access(file, constants.X_OK)
      return (await stat(file)).isFile()
    } catch {
      return false
    }
  }
  if (command.includes('/')) return isAbsolute(command) && (await executable(command)) ? command : null
  for (const dir of path.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue
    const file = join(dir, command)
    if (await executable(file)) return file
  }
  return null
}

/** A definição do ACP (`session/new`) de um servidor. */
export function acpDefinition(name: string, definition: McpConnectDefinition): acp.McpServer {
  const pairs = (values: Readonly<Record<string, string>>): { name: string; value: string }[] => Object.entries(values).map(([key, value]) => ({ name: key, value }))
  if (definition.transport === 'stdio') return { name, command: definition.command ?? '', args: [...definition.args], env: pairs(definition.env) }
  return { type: definition.transport, name, url: definition.url ?? '', headers: pairs(definition.headers) }
}

const connectOf = (server: StoredMcpServer): McpConnectDefinition => ({
  transport: server.transport,
  command: server.command,
  args: server.args,
  cwd: server.cwd,
  env: record(server.env),
  url: server.url,
  headers: record(server.headers),
})

const connectOfCli = (definition: CliDefinition): McpConnectDefinition => ({ ...definition, cwd: null })

/** Os valores de variáveis e cabeçalhos (o que se mascara em texto que vem do servidor). */
const secretsOf = (definition: McpConnectDefinition): string[] => [...Object.values(definition.env), ...Object.values(definition.headers)].filter((value) => value !== '')

/** Endereço que o app aceita (a mesma regra do teste vale na sessão e no CLI). */
const urlUsable = (definition: Pick<McpConnectDefinition, 'transport' | 'url'>): boolean => definition.transport === 'stdio' || (definition.url !== null && mcpUrlAllowed(definition.url))

/** Impressão digital de uma definição (com os segredos), para "Salvar" só o que foi testado. */
const fingerprint = (name: string, definition: McpConnectDefinition): string => createHash('sha256').update(JSON.stringify({ name, ...definition })).digest('hex')

/** Valida os pares e junta com os segredos guardados (`keep`). */
function pairsOf(list: Input['env'], pattern: RegExp, previous: readonly StoredPair[], label: 'variável' | 'cabeçalho'): StoredPair[] {
  const pairs: StoredPair[] = []
  for (const pair of list ?? []) {
    if (!pair.key && !pair.value) continue
    if (!pattern.test(pair.key)) throw new InvalidServer(`Nome de ${label} inválido: ${pair.key.slice(0, 40) || '(vazio)'}`)
    if (pairs.some((known) => known.key.toLowerCase() === pair.key.toLowerCase())) throw new InvalidServer(`${label === 'variável' ? 'Variável repetida' : 'Cabeçalho repetido'}: ${pair.key}`)
    if (label === 'cabeçalho' && /[\r\n]/.test(pair.value)) throw new InvalidServer(`O cabeçalho ${pair.key} tem quebra de linha.`)
    const kept = pair.secret && pair.keep ? previous.find((known) => known.key === pair.key && known.secret) : undefined
    pairs.push({ key: pair.key, value: kept ? kept.value : pair.value, secret: pair.secret })
  }
  return pairs
}

const viewPairs = (pairs: readonly StoredPair[]): McpPairView[] => pairs.map((pair) => ({ key: pair.key, value: pair.secret ? null : pair.value, secret: pair.secret, defined: pair.value !== '' }))

/** Ferramentas a mostrar: as do último teste e as que já têm política. */
function knownTools(tools: readonly McpToolInfo[], policy: Readonly<Record<string, McpToolPolicy>>): McpToolInfo[] {
  const list = [...tools]
  for (const name of Object.keys(policy)) if (!list.some((tool) => mcpToolKey(tool.name) === name)) list.push({ name, description: '' })
  return list
}

export function createMcpService(deps: McpServiceDeps): McpService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const log = deps.log ?? (() => undefined)
  let cliList: { state: 'ok' | 'not-found' | 'error'; entries: CliListEntry[] } | null = null
  /** Contrato 57: sem conector na lista, por quê (lido junto com a lista). */
  let connectorsReason: ClaudeConnectorsReason | null = null
  /** Contrato 57: a leitura em curso e quando a última falhou. */
  let listing: Promise<void> | null = null
  let listFailedAt: number | null = null
  /** Contrato 57: quando a lista em cache foi lida; `null` obriga a próxima sessão com conector a esperar uma nova. */
  let listedAt: number | null = null
  /** Contrato 58: as ferramentas de cada conector conectado, da última leitura do `mcpServerStatus`, e a leitura em curso. */
  const toolsByConnector = new Map<string, { tools: McpToolInfo[]; at: number }>()
  let readingTools: { names: Set<string>; done: Promise<ConnectorStatus[]> } | null = null
  /** Teste dos servidores do CLI nesta execução do app (não vai para o disco). */
  const cliTests = new Map<string, { ok: true; tools: McpToolInfo[] } | { ok: false; error: string }>()
  const tested: string[] = []
  let capabilities: { http: boolean; sse: boolean } | null = null

  const claudePath = async (): Promise<string | null> => {
    const found = await deps.locate().catch((): ClaudeLocateResult => ({ ok: false, error: 'not-found' }))
    return found.ok ? found.path : null
  }

  /**
   * Lê o `claude mcp list`. Contrato 57: a sessão com conector relê sempre (`forSession`), aproveitando uma leitura que já
   * esteja em curso, e depois de uma falha só tenta de novo passados 60 s (a aba tenta sempre).
   */
  function loadCli(refresh: boolean, forSession = false): Promise<void> {
    if (forSession && cliList?.state === 'error' && listFailedAt !== null && now() - listFailedAt < LIST_RETRY_MS) return Promise.resolve()
    if (forSession && listing) return listing
    const run = readCli(refresh).finally(() => {
      if (listing === run) listing = null
    })
    listing = run
    return run
  }

  async function readCli(refresh: boolean): Promise<void> {
    // Só a lista lida guarda: sem o `claude` (ou com erro), a próxima abertura da aba tenta de novo.
    if (cliList?.state === 'ok' && !refresh) return
    // Contrato 58: lista relida ("Atualizar"), as ferramentas dos conectores também.
    toolsByConnector.clear()
    const path = await claudePath()
    if (!path) {
      cliList = { state: 'not-found', entries: [] }
      return
    }
    try {
      const entries = await deps.cli.list(path)
      cliList = { state: 'ok', entries }
      listFailedAt = null
      listedAt = now()
      // Contrato 57: lista sem conector; sem login por assinatura, a conta nem tem como ter.
      connectorsReason = connectorsOf(entries).length ? null : (await deps.cli.subscription(path).catch(() => null)) === false ? 'no-subscription' : 'none'
      // Servidor que saiu do Claude CLI: o "Usar no app" e as regras dele saem também (um homônimo futuro começa do zero).
      const names = new Set(entries.map((entry) => entry.name))
      for (const name of Object.keys(await deps.store.cliEnabled())) {
        if (names.has(name)) continue
        await deps.store.setCli(name, null)
        cliTests.delete(name)
      }
    } catch {
      log('[mcp] claude mcp list falhou')
      cliList = { state: 'error', entries: [] }
      listFailedAt = now()
    }
  }

  async function foundServers(): Promise<McpFoundServer[]> {
    const servers = await readServersFile(deps.desktopConfig)
    return [...servers.entries()].map(([name, definition]) => {
      let origin: string | null
      try {
        origin = definition.url ? new URL(definition.url).origin : null
      } catch {
        origin = null
      }
      return {
        id: `claude-desktop:${name}`,
        source: 'claude-desktop' as const,
        sourceLabel: 'Claude Desktop',
        name: mcpText(name, 60),
        transport: definition.transport,
        command: definition.command ? mcpText(definition.command.split('/').pop() ?? '', 80) : null,
        url: origin,
        envKeys: Object.keys(definition.env).map((key) => mcpText(key, 100)),
        headerKeys: Object.keys(definition.headers).map((key) => mcpText(key, 100)),
      }
    })
  }

  const appState = (server: StoredMcpServer): McpServerState => {
    if (!server.enabled) return { kind: 'off' }
    if (!server.lastTest) return { kind: 'untested' }
    return server.lastTest.ok ? { kind: 'connected', tools: server.tools.length } : { kind: 'error', reason: server.lastTest.error ?? 'falha na conexão' }
  }

  const appView = (server: StoredMcpServer): McpServerView => ({
    id: server.id,
    key: keyOf.app(server.id),
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: viewPairs(server.env),
    url: server.url,
    headers: viewPairs(server.headers),
    enabled: server.enabled,
    uses: server.uses,
    toolPolicy: server.toolPolicy,
    source: server.source,
    tools: knownTools(server.tools, server.toolPolicy),
    state: appState(server),
  })

  async function overview(withCli: boolean, refresh = false): Promise<McpOverview> {
    if (withCli) await loadCli(refresh)
    const [app, enabled, definitions, found] = await Promise.all([deps.store.list(), deps.store.cliEnabled(), deps.cli.definitions().catch(() => new Map<string, CliDefinition>()), foundServers().catch(() => [])])
    const servers: McpCliServerView[] = (cliList?.entries ?? []).filter((entry) => !isConnectorEntry(entry.name)).map((entry) => {
      const prefs = enabled[entry.name]
      const definition = definitions.get(entry.name)
      const usable = definition !== undefined && MCP_NAME_PATTERN.test(mcpToolServerName(entry.name)) && urlUsable(definition)
      const test = cliTests.get(entry.name)
      const state: McpServerState = !prefs ? { kind: 'off' } : !test ? { kind: 'untested' } : test.ok ? { kind: 'connected', tools: test.tools.length } : { kind: 'error', reason: test.error }
      return {
        key: keyOf.cli(entry.name),
        name: mcpText(entry.name, 200),
        transport: definition?.transport ?? entry.transport,
        health: entry.health,
        usable,
        enabled: prefs !== undefined && usable,
        uses: prefs?.uses ?? [...DEFAULT_MCP_USES],
        toolPolicy: prefs?.toolPolicy ?? {},
        tools: knownTools(test?.ok ? test.tools : [], prefs?.toolPolicy ?? {}),
        state,
      }
    })
    return { cli: { state: cliList?.state ?? 'loading', servers }, app: app.map(appView), found, connectors: connectorList() }
  }

  /** Contrato 57: os conectores da última lista lida (sem lista, vazia e sem motivo). */
  function connectorList(): ClaudeConnectorList {
    if (cliList?.state !== 'ok') return { connectors: [], reason: null }
    const connectors = connectorsOf(cliList.entries)
    return { connectors, reason: connectors.length ? null : (connectorsReason ?? 'none') }
  }

  /** A definição do formulário, validada, com os segredos guardados quando a edição pede para manter. */
  async function resolveInput(raw: unknown): Promise<{ input: Input; server: StoredMcpServer; definition: McpConnectDefinition }> {
    const parsed = inputSchema.safeParse(raw)
    if (!parsed.success) throw new InvalidServer('Formulário inválido.')
    const input = parsed.data
    if (!MCP_NAME_PATTERN.test(input.name)) throw new InvalidServer('Nome: até 40 letras, números, - ou _ (sem espaço e sem __).')
    const previous = input.id ? await deps.store.get(input.id) : null
    if (input.id && !previous) throw new InvalidServer('Este servidor não existe mais.')
    if (input.id && input.target !== 'app') throw new InvalidServer('A edição vale só para os servidores do app.')
    let command: string | null = null
    let url: string | null = null
    let cwd: string | null = null
    if (input.transport === 'stdio') {
      command = input.command ?? ''
      if (!command) throw new InvalidServer('Informe o comando.')
      if (!(await findExecutable(command, await deps.loginPath()))) throw new InvalidServer(`Comando não encontrado ou sem permissão de execução: ${command.slice(0, 120)}`)
      cwd = input.cwd || null
      if (cwd) {
        if (input.target === 'cli') throw new InvalidServer('O Claude CLI não guarda pasta de trabalho: deixe a pasta vazia ou salve só neste app.')
        const info = isAbsolute(cwd) ? await stat(cwd).catch(() => null) : null
        if (!info?.isDirectory()) throw new InvalidServer('A pasta de trabalho não existe.')
      }
    } else {
      url = input.url ?? ''
      if (!mcpUrlAllowed(url)) throw new InvalidServer('Endereço não permitido: use https://, ou http:// só no próprio Mac (127.0.0.1 ou localhost).')
    }
    const env = input.transport === 'stdio' ? pairsOf(input.env, MCP_ENV_KEY_PATTERN, previous?.env ?? [], 'variável') : []
    const headers = input.transport === 'stdio' ? [] : pairsOf(input.headers, MCP_HEADER_KEY_PATTERN, previous?.headers ?? [], 'cabeçalho')
    const server: StoredMcpServer = {
      id: previous?.id ?? newId(),
      name: input.name,
      transport: input.transport,
      command,
      args: input.transport === 'stdio' ? (input.args ?? []).filter((arg) => arg !== '') : [],
      cwd,
      env,
      url,
      headers,
      // Contrato 21: todo servidor novo nasce desligado; a pessoa liga na lista.
      enabled: previous?.enabled ?? false,
      uses: uniqueUses(input.uses ?? previous?.uses),
      toolPolicy: previous?.toolPolicy ?? {},
      source: previous?.source ?? 'manual',
      tools: previous?.tools ?? [],
      lastTest: previous?.lastTest ?? null,
    }
    return { input, server, definition: connectOf(server) }
  }

  /** O nome já existe nos servidores do app ou no Claude CLI? */
  async function nameTaken(name: string, exceptId: string | null): Promise<string | null> {
    const lower = name.toLowerCase()
    if ((await deps.store.list()).some((server) => server.id !== exceptId && server.name.toLowerCase() === lower)) return 'Já existe um servidor do app com este nome.'
    const cliNames = new Set([...(cliList?.entries ?? []).map((entry) => entry.name.toLowerCase()), ...[...(await deps.cli.definitions().catch(() => new Map<string, CliDefinition>())).keys()].map((key) => key.toLowerCase())])
    if (cliNames.has(lower)) return 'Já existe um servidor do Claude CLI com este nome.'
    return null
  }

  /** O teste, com a mensagem de erro do servidor sem nenhum segredo da definição (ela vai à tela e ao `lastTest`). */
  const runTest = async (definition: McpConnectDefinition): Promise<McpTestResult> => {
    const path = await deps.loginPath()
    const result = await testMcpServer(definition, { path, baseEnv: deps.baseEnv, ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.testTimeoutMs !== undefined ? { timeoutMs: deps.testTimeoutMs } : {}) })
    return result.ok ? result : { ok: false, error: maskSecrets(result.error, secretsOf(definition)) }
  }

  const failure = (error: unknown): { ok: false; error: string } => {
    if (error instanceof InvalidServer) return { ok: false, error: error.message }
    if (error instanceof EncryptionUnavailableError) return { ok: false, error: 'O Mac não está cifrando agora: o segredo não foi guardado.' }
    log('[mcp] operação falhou')
    return { ok: false, error: 'Não deu certo. Tente de novo.' }
  }

  async function prefsOf(name: string): Promise<CliServerPrefs | undefined> {
    return (await deps.store.cliEnabled())[name]
  }

  return {
    overview: async (input) => {
      const parsed = overviewSchema.parse(input)
      return overview(parsed?.cli === true, parsed?.refresh === true)
    },

    test: async (input) => {
      const parsed = testSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }
      if ('draft' in parsed.data) {
        let resolved: Awaited<ReturnType<typeof resolveInput>>
        try {
          resolved = await resolveInput(parsed.data.draft)
        } catch (error) {
          return failure(error)
        }
        const result = await runTest(resolved.definition)
        if (result.ok) {
          tested.push(fingerprint(resolved.server.name, resolved.definition))
          if (tested.length > TESTED_MAX) tested.shift()
        }
        return result
      }
      const key = parsed.data.key
      if (key.startsWith('app:')) {
        const server = await deps.store.get(key.slice(4))
        if (!server) return { ok: false, error: 'Este servidor não existe mais.' }
        const result = await runTest(connectOf(server))
        await deps.store.update(server.id, (current) => ({
          ...current,
          tools: result.ok ? result.tools : current.tools,
          lastTest: { ok: result.ok, at: new Date(now()).toISOString(), ...(result.ok ? {} : { error: result.error.slice(0, 200) }) },
        }))
        return result
      }
      const name = key.slice(4)
      const definition = (await deps.cli.definitions().catch(() => new Map<string, CliDefinition>())).get(name)
      if (!definition) return { ok: false, error: 'Este servidor não está no escopo user do Claude CLI.' }
      const result = await runTest(connectOfCli(definition))
      cliTests.set(name, result)
      return result
    },

    save: async (input) => {
      try {
        const { input: form, server, definition } = await resolveInput(input)
        const taken = await nameTaken(server.name, form.id ?? null)
        if (taken) throw new InvalidServer(taken)
        if (!tested.includes(fingerprint(server.name, definition))) throw new InvalidServer('Teste a conexão antes de salvar.')
        if (form.target === 'cli') {
          const path = await claudePath()
          if (!path) throw new InvalidServer('O claude não foi encontrado (Configurações › Claude).')
          try {
            await deps.cli.add(path, server.name, { transport: server.transport, command: server.command, args: server.args, env: definition.env, url: server.url, headers: definition.headers })
          } catch {
            throw new InvalidServer('O Claude CLI não aceitou o servidor.')
          }
          // Desligado para o app até a pessoa ligar ("Usar no app").
          await loadCli(true)
        } else {
          const result = await runTest(definition).catch(() => null)
          await deps.store.save({ ...server, ...(result ? { tools: result.ok ? result.tools : server.tools, lastTest: { ok: result.ok, at: new Date(now()).toISOString(), ...(result.ok ? {} : { error: result.error.slice(0, 200) }) } } : {}) })
        }
        return { ok: true, overview: await overview(false) }
      } catch (error) {
        return failure(error)
      }
    },

    update: async (input) => {
      const parsed = updateSchema.safeParse(input)
      if (!parsed.success) return null
      const { key, enabled, uses, policy } = parsed.data
      // A regra fica com o nome da ferramenta como o Claude a chama (o que não for letra, número, `-` ou `_` vira `_`).
      const tool = parsed.data.tool === undefined ? undefined : mcpToolKey(parsed.data.tool)
      const nextPolicy = (current: Record<string, McpToolPolicy>): Record<string, McpToolPolicy> => {
        if (!tool || !policy) return current
        // "Perguntar" é o padrão: não fica guardado.
        const next = Object.fromEntries(Object.entries(current).filter(([name]) => name !== tool))
        return policy === 'ask' ? next : { ...next, [tool]: policy }
      }
      if (key.startsWith('app:')) {
        const changed = await deps.store.update(key.slice(4), (server) => ({
          ...server,
          ...(enabled !== undefined ? { enabled } : {}),
          ...(uses ? { uses: uniqueUses(uses) } : {}),
          toolPolicy: nextPolicy(server.toolPolicy),
        }))
        return changed ? overview(false) : null
      }
      const name = key.slice(4)
      const current = await prefsOf(name)
      if (enabled === false) await deps.store.setCli(name, null)
      else if (enabled === true || current) {
        const definitions = await deps.cli.definitions().catch(() => new Map<string, CliDefinition>())
        if (!definitions.has(name)) return null
        const base = current ?? { uses: [...DEFAULT_MCP_USES], toolPolicy: {} }
        await deps.store.setCli(name, { uses: uses ? uniqueUses(uses) : base.uses, toolPolicy: nextPolicy(base.toolPolicy) })
      } else return null
      return overview(false)
    },

    remove: async (input) => {
      const parsed = removeSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }
      const { key } = parsed.data
      try {
        if (key.startsWith('app:')) {
          if (!(await deps.store.remove(key.slice(4)))) throw new InvalidServer('Este servidor não existe mais.')
        } else {
          const name = key.slice(4)
          const path = await claudePath()
          if (!path) throw new InvalidServer('O claude não foi encontrado (Configurações › Claude).')
          try {
            await deps.cli.remove(path, name)
          } catch {
            throw new InvalidServer('O Claude CLI não removeu o servidor.')
          }
          await deps.store.setCli(name, null)
          cliTests.delete(name)
          await loadCli(true)
        }
        return { ok: true, overview: await overview(false) }
      } catch (error) {
        return failure(error)
      }
    },

    details: async (input) => {
      const parsed = detailsSchema.safeParse(input)
      if (!parsed.success) return null
      const path = await claudePath()
      if (!path) return null
      const lines = await deps.cli.details(path, parsed.data.name).catch(() => [])
      return { name: mcpText(parsed.data.name, 200), lines }
    },

    connectorTools: async (input) => {
      const parsed = detailsSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }
      const name = parsed.data.name
      const connector = connectorList().connectors.find((entry) => entry.name === name)
      if (!connector) return { ok: false, error: 'Conector não encontrado.' }
      if (connector.state !== 'connected') return { ok: false, error: 'O conector não está conectado.' }
      const cached = toolsByConnector.get(name)
      if (cached && now() - cached.at <= LIST_STALE_MS) return { ok: true, tools: cached.tools }
      const path = await claudePath()
      if (!path) return { ok: false, error: 'O claude não foi encontrado neste Mac.' }
      try {
        // Uma leitura por vez: o conector pedido depois entra nos nomes que ela espera (até o mesmo prazo).
        let reading = readingTools
        if (reading) reading.names.add(name)
        else {
          const names = new Set([name])
          reading = { names, done: deps.cli.connectorTools(path, names) }
          readingTools = reading
        }
        const current = reading
        const statuses = await current.done.finally(() => {
          if (readingTools === current) readingTools = null
        })
        const at = now()
        for (const status of statuses) if (status.status === 'connected') toolsByConnector.set(status.name, { tools: status.tools, at })
        const found = statuses.find((status) => status.name === name)
        if (found?.status === 'connected') return { ok: true, tools: found.tools }
        return { ok: false, error: found?.status === 'pending' ? 'O conector ainda não conectou. Tente de novo.' : 'O conector não respondeu com as ferramentas.' }
      } catch {
        log('[mcp] as ferramentas do conector não foram lidas')
        return { ok: false, error: 'Não foi possível ler as ferramentas do conector.' }
      }
    },

    importFound: async (input) => {
      const parsed = importSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'Pedido inválido.' }
      const { id, target } = parsed.data
      try {
        if (!id.startsWith('claude-desktop:')) throw new InvalidServer('Servidor não encontrado.')
        const name = id.slice('claude-desktop:'.length)
        const definition = (await readServersFile(deps.desktopConfig)).get(name)
        if (!definition) throw new InvalidServer('O servidor não está mais no arquivo do Claude Desktop.')
        if (!urlUsable(definition)) throw new InvalidServer('Endereço não permitido: use https://, ou http:// só no próprio Mac (127.0.0.1 ou localhost).')
        // Nome que o app aceita: o que não serve vira `-`; repetido ganha um número.
        const base = (name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/_{2,}/g, '_').replace(/^[-_]+|[-_]+$/g, '') || 'servidor').slice(0, 36).replace(/[-_]+$/, '')
        let unique = base
        for (let n = 2; (await nameTaken(unique, null)) && n < 100; n++) unique = `${base}-${n}`
        if (await nameTaken(unique, null)) throw new InvalidServer('Já existe um servidor com este nome.')
        if (target === 'cli') {
          const path = await claudePath()
          if (!path) throw new InvalidServer('O claude não foi encontrado (Configurações › Claude).')
          try {
            await deps.cli.add(path, unique, definition)
          } catch {
            throw new InvalidServer('O Claude CLI não aceitou o servidor.')
          }
          await loadCli(true)
        } else {
          // Sem os segredos: as variáveis e os cabeçalhos vêm com o nome e o valor vazio, para a pessoa preencher.
          const blank = (values: Record<string, string>, pattern: RegExp): StoredPair[] => Object.keys(values).filter((key) => pattern.test(key)).map((key) => ({ key, value: '', secret: true }))
          await deps.store.save({
            id: newId(),
            name: unique,
            transport: definition.transport,
            command: definition.command,
            args: definition.args,
            cwd: null,
            env: blank(definition.env, MCP_ENV_KEY_PATTERN),
            url: definition.url,
            headers: blank(definition.headers, MCP_HEADER_KEY_PATTERN),
            enabled: false,
            uses: [...DEFAULT_MCP_USES],
            toolPolicy: {},
            source: 'import',
            tools: [],
            lastTest: null,
          })
        }
        return { ok: true, overview: await overview(false) }
      } catch (error) {
        return failure(error)
      }
    },

    chatServers: async () => {
      const servers = await sessionCandidates('chat', [])
      return servers.map((server) => ({ key: server.key, name: server.label, unavailable: supported(server.transport) ? null : 'não suportado por este agente' }))
    },

    sessionServers: async (use, off) => {
      const servers = await sessionCandidates(use, off)
      return servers.filter((server) => supported(server.transport))
    },

    agentCapabilities: (next) => {
      capabilities = next
    },

    invalidateConnectors: () => {
      listedAt = null
      toolsByConnector.clear()
    },

    sessionConnectors: async () => {
      const none: Readonly<Record<string, ClaudeConnectorPrefs>> = {}
      const prefs = (await deps.connectorPrefs?.().catch(() => none)) ?? none
      if (!Object.values(prefs).some((entry) => entry.enabled)) return null
      // A lista em cache (o `claude mcp list` confere a saúde de cada servidor e leva uns 17 s): a sessão só espera por ela
      // sem cache (a primeira vez na execução, ou depois de `invalidateConnectors`). Com mais de 5 min, renova em segundo
      // plano, sem atrasar esta sessão. A segurança não depende da lista estar fresca: a sessão confere o que carregou
      // pelo `/mcp` (`acp/connectors.ts`) e reabre ou cai no modo estrito.
      if (cliList?.state !== 'ok' || listedAt === null) await loadCli(true, true)
      else if (now() - listedAt > LIST_STALE_MS) void loadCli(true, true).catch(() => undefined)
      const listed = connectorList().connectors
      const enabled = listed.filter((connector) => connector.state === 'connected' && prefs[connector.name]?.enabled === true)
      if (!enabled.length) return null
      // Tudo o que o `claude` sobe sem o modo estrito: os conectores da lista, os servidores da lista (escopo `user`,
      // plugins) e os do escopo `user` lidos agora do arquivo do CLI (um que entrou depois da lista também fica de fora).
      const definitions = await deps.cli.definitions().catch(() => new Map<string, CliDefinition>())
      const others = new Set<string>([
        ...listed.filter((connector) => !enabled.includes(connector)).map((connector) => connector.toolServer),
        ...(cliList?.entries ?? []).filter((entry) => !isConnectorEntry(entry.name)).map((entry) => mcpToolServerName(entry.name)),
        ...[...definitions.keys()].map((name) => mcpToolServerName(name)),
      ])
      return {
        enabled: enabled.map((connector) => ({
          name: connector.name,
          label: claudeConnectorLabel(connector.name),
          toolServer: connector.toolServer,
          toolPolicy: { ...(prefs[connector.name]?.tools ?? {}) },
          allowAlways: (tool: string) => {
            void deps.allowConnectorTool?.(connector.name, tool).catch(() => log('[mcp] a regra do conector não foi gravada'))
          },
        })),
        others: [...others],
      }
    },
  }

  function supported(transport: 'stdio' | 'http' | 'sse'): boolean {
    if (transport === 'stdio' || !capabilities) return true
    return capabilities[transport]
  }

  /** Os servidores ligados para o uso, sem os desligados na conversa, com a definição lida agora. */
  async function sessionCandidates(use: McpUse, off: readonly string[]): Promise<(AcpMcpServer & { label: string })[]> {
    const [app, enabled] = await Promise.all([deps.store.list(), deps.store.cliEnabled()])
    // Nenhum ligado para o uso: nem o arquivo do CLI nem o shell de login (a sessão sai igual à do contrato 17).
    const wanted = (key: string, uses: readonly McpUse[]): boolean => uses.includes(use) && !off.includes(key)
    if (!app.some((server) => server.enabled && wanted(keyOf.app(server.id), server.uses)) && !Object.entries(enabled).some(([name, prefs]) => wanted(keyOf.cli(name), prefs.uses))) return []
    const [definitions, path] = await Promise.all([deps.cli.definitions().catch(() => new Map<string, CliDefinition>()), deps.loginPath()])
    const servers: (AcpMcpServer & { label: string })[] = []
    const add = (key: string, label: string, definition: McpConnectDefinition, policy: Record<string, McpToolPolicy>, allowAlways: (tool: string) => void): void => {
      const name = mcpToolServerName(label)
      if (off.includes(key) || servers.some((server) => server.name === name) || !MCP_NAME_PATTERN.test(name) || !urlUsable(definition)) return
      // O comando local acha os programas dele pelo `PATH` do shell de login (o do app aberto pelo Finder é curto),
      // a não ser que a pessoa tenha cadastrado outro.
      const env = definition.transport === 'stdio' ? { PATH: path, ...definition.env } : definition.env
      servers.push({
        key,
        name,
        label,
        transport: definition.transport,
        definition: acpDefinition(name, { ...definition, env }),
        toolPolicy: policy,
        secrets: secretsOf(definition),
        allowAlways,
      })
    }
    for (const [name, prefs] of Object.entries(enabled)) {
      const definition = definitions.get(name)
      if (!definition || !prefs.uses.includes(use)) continue
      add(keyOf.cli(name), name, connectOfCli(definition), prefs.toolPolicy, (tool) => {
        void prefsOf(name).then((current) => (current ? deps.store.setCli(name, { ...current, toolPolicy: { ...current.toolPolicy, [tool]: 'allow' } }) : undefined))
      })
    }
    for (const server of app) {
      if (!server.enabled || !server.uses.includes(use)) continue
      add(keyOf.app(server.id), server.name, connectOf(server), server.toolPolicy, (tool) => {
        void deps.store.update(server.id, (current) => ({ ...current, toolPolicy: { ...current.toolPolicy, [tool]: 'allow' } }))
      })
    }
    return servers
  }
}
