// Cadastro dos servidores MCP (contrato 21, CA1 e CA0). Dois arquivos em `userData`, com escrita atômica (temporário +
// `rename`, modo 0600) numa fila:
// - `mcp-servers.json`: os servidores que valem só no app. Valor marcado como segredo vai cifrado com o `safeStorage`
//   (a chave fica no Chaveiro do macOS, como a da AssemblyAI); no disco, só o resultado em base64.
// - `mcp-cli-enabled.json`: dos servidores do Claude CLI, só o nome dos ligados para o app, com os usos e a política de
//   cada ferramenta. A definição (e os segredos) do servidor continuam só no arquivo do CLI.
// Arquivo inválido vale como vazio (o próximo salvamento reescreve); entrada inválida é descartada.
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_MCP_USES,
  MCP_ARG_MAX,
  MCP_ARGS_MAX,
  MCP_COMMAND_MAX,
  MCP_ENV_KEY_PATTERN,
  MCP_HEADER_KEY_PATTERN,
  MCP_NAME_PATTERN,
  MCP_PAIRS_MAX,
  MCP_SERVERS_MAX,
  MCP_TOOL_DESCRIPTION_MAX,
  MCP_TOOL_NAME_MAX,
  MCP_TOOL_POLICIES,
  MCP_TOOLS_MAX,
  MCP_TRANSPORTS,
  MCP_URL_MAX,
  MCP_USES,
  MCP_VALUE_MAX,
  type McpToolInfo,
  type McpToolPolicy,
  type McpTransport,
  type McpUse,
} from '../../shared/mcp'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'

export const MCP_SERVERS_FILE = 'mcp-servers.json'
export const MCP_CLI_ENABLED_FILE = 'mcp-cli-enabled.json'

/** Uma variável ou um cabeçalho, já decifrado (só no main). */
export interface StoredPair {
  key: string
  value: string
  secret: boolean
}

/** Resultado do último "Testar" (sem nada do servidor além do número de ferramentas e do motivo curto). */
export interface StoredTest {
  ok: boolean
  at: string
  error?: string | undefined
}

/** Servidor do cadastro do app, como o main o usa. */
export interface StoredMcpServer {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  cwd: string | null
  env: StoredPair[]
  url: string | null
  headers: StoredPair[]
  enabled: boolean
  uses: McpUse[]
  toolPolicy: Record<string, McpToolPolicy>
  source: 'manual' | 'import'
  tools: McpToolInfo[]
  lastTest: StoredTest | null
}

/** Um servidor do CLI ligado para o app: só o nome (a chave do registro), os usos e a política. */
export interface CliServerPrefs {
  uses: McpUse[]
  toolPolicy: Record<string, McpToolPolicy>
}

const toolName = z.string().min(1).max(MCP_TOOL_NAME_MAX)
const usesSchema = z.array(z.enum(MCP_USES)).max(MCP_USES.length).catch([...DEFAULT_MCP_USES])
const policySchema = z.record(toolName, z.enum(MCP_TOOL_POLICIES)).catch({})
const toolsSchema = z
  .array(z.object({ name: toolName, description: z.string().max(MCP_TOOL_DESCRIPTION_MAX).catch('') }))
  .max(MCP_TOOLS_MAX)
  .catch([])

/** No disco: valor comum em texto, segredo só cifrado. */
const filePair = (keyPattern: RegExp) =>
  z.union([
    z.object({ key: z.string().regex(keyPattern), secret: z.literal(false), value: z.string().max(MCP_VALUE_MAX) }),
    z.object({ key: z.string().regex(keyPattern), secret: z.literal(true), cipher: z.string().max(MCP_VALUE_MAX * 4).nullable() }),
  ])

const fileServer = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().regex(MCP_NAME_PATTERN),
  transport: z.enum(MCP_TRANSPORTS),
  command: z.string().max(MCP_COMMAND_MAX).nullable(),
  args: z.array(z.string().max(MCP_ARG_MAX)).max(MCP_ARGS_MAX),
  cwd: z.string().max(MCP_COMMAND_MAX).nullable(),
  env: z.array(filePair(MCP_ENV_KEY_PATTERN)).max(MCP_PAIRS_MAX),
  url: z.string().max(MCP_URL_MAX).nullable(),
  headers: z.array(filePair(MCP_HEADER_KEY_PATTERN)).max(MCP_PAIRS_MAX),
  enabled: z.boolean(),
  uses: usesSchema,
  toolPolicy: policySchema,
  source: z.enum(['manual', 'import']).catch('manual'),
  tools: toolsSchema,
  lastTest: z.object({ ok: z.boolean(), at: z.string().max(40), error: z.string().max(200).optional() }).nullable().catch(null),
})
type FileServer = z.infer<typeof fileServer>

const serversFile = z.object({ version: z.literal(1), servers: z.array(z.unknown()).max(MCP_SERVERS_MAX * 2) })
const cliFile = z.object({
  version: z.literal(1),
  servers: z.record(z.string().min(1).max(200), z.object({ uses: usesSchema, toolPolicy: policySchema })),
})

export interface McpStore {
  /** Os servidores do app, com os segredos decifrados (o que não decifra fica vazio). */
  list(): Promise<StoredMcpServer[]>
  get(id: string): Promise<StoredMcpServer | null>
  /** Grava (novo ou edição). Lança `EncryptionUnavailableError` se há segredo e o Mac não cifra agora. */
  save(server: StoredMcpServer): Promise<void>
  /** Muda um servidor no lugar; `null` se ele não existe. */
  update(id: string, change: (server: StoredMcpServer) => StoredMcpServer): Promise<StoredMcpServer | null>
  remove(id: string): Promise<boolean>
  /** Os servidores do CLI ligados para o app, pelo nome. */
  cliEnabled(): Promise<Record<string, CliServerPrefs>>
  /** Liga (com as preferências) ou desliga (`null`) um servidor do CLI. */
  setCli(name: string, prefs: CliServerPrefs | null): Promise<void>
}

export interface McpStoreOptions {
  dir: string
  safeStorage: SafeStorageLike
  log?: (message: string) => void
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temp, data, { encoding: 'utf8', mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function createMcpStore({ dir, safeStorage, log }: McpStoreOptions): McpStore {
  const serversPath = join(dir, MCP_SERVERS_FILE)
  const cliPath = join(dir, MCP_CLI_ENABLED_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const decrypt = (cipher: string | null): string => {
    if (!cipher) return ''
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64')).slice(0, MCP_VALUE_MAX)
    } catch {
      log?.('[mcp] um segredo não pôde ser decifrado; precisa ser preenchido de novo')
      return ''
    }
  }
  const encrypt = (value: string): string | null => {
    if (!value) return null
    if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError()
    return safeStorage.encryptString(value).toString('base64')
  }

  const fromFile = (entry: FileServer): StoredMcpServer => {
    const pairs = (list: FileServer['env']): StoredPair[] => list.map((pair) => (pair.secret ? { key: pair.key, value: decrypt(pair.cipher), secret: true } : { key: pair.key, value: pair.value, secret: false }))
    return { ...entry, env: pairs(entry.env), headers: pairs(entry.headers), lastTest: entry.lastTest ? { ok: entry.lastTest.ok, at: entry.lastTest.at, ...(entry.lastTest.error ? { error: entry.lastTest.error } : {}) } : null }
  }
  const toFile = (server: StoredMcpServer): FileServer => {
    const pairs = (list: StoredPair[]): FileServer['env'] => list.map((pair) => (pair.secret ? { key: pair.key, secret: true as const, cipher: encrypt(pair.value) } : { key: pair.key, secret: false as const, value: pair.value }))
    return { ...server, env: pairs(server.env), headers: pairs(server.headers) }
  }

  async function readServers(): Promise<StoredMcpServer[]> {
    const parsed = serversFile.safeParse(await readJson(serversPath))
    if (!parsed.success) return []
    const servers: StoredMcpServer[] = []
    for (const raw of parsed.data.servers) {
      const entry = fileServer.safeParse(raw)
      if (entry.success && !servers.some((server) => server.id === entry.data.id || server.name.toLowerCase() === entry.data.name.toLowerCase())) servers.push(fromFile(entry.data))
    }
    return servers.slice(0, MCP_SERVERS_MAX)
  }
  const writeServers = (servers: StoredMcpServer[]): Promise<void> => writeAtomic(serversPath, `${JSON.stringify({ version: 1, servers: servers.map(toFile) }, null, 2)}\n`)

  async function readCli(): Promise<Record<string, CliServerPrefs>> {
    const parsed = cliFile.safeParse(await readJson(cliPath))
    return parsed.success ? parsed.data.servers : {}
  }

  return {
    list: () => enqueue(readServers),
    get: (id) => enqueue(async () => (await readServers()).find((server) => server.id === id) ?? null),
    save: (server) =>
      enqueue(async () => {
        const servers = await readServers()
        const at = servers.findIndex((entry) => entry.id === server.id)
        if (at === -1) servers.push(server)
        else servers[at] = server
        await writeServers(servers)
      }),
    update: (id, change) =>
      enqueue(async () => {
        const servers = await readServers()
        const at = servers.findIndex((entry) => entry.id === id)
        const current = servers[at]
        if (!current) return null
        const next = change(current)
        servers[at] = next
        await writeServers(servers)
        return next
      }),
    remove: (id) =>
      enqueue(async () => {
        const servers = await readServers()
        const next = servers.filter((entry) => entry.id !== id)
        if (next.length === servers.length) return false
        await writeServers(next)
        return true
      }),
    cliEnabled: () => enqueue(readCli),
    setCli: (name, prefs) =>
      enqueue(async () => {
        const current = await readCli()
        const servers = Object.fromEntries(Object.entries(current).filter(([known]) => known !== name))
        if (prefs) servers[name] = prefs
        await writeAtomic(cliPath, `${JSON.stringify({ version: 1, servers }, null, 2)}\n`)
      }),
  }
}
