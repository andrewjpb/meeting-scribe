// Motor por agente ACP (contrato 17): o app é um cliente ACP de verdade. Tudo o que é próprio de um agente
// (como instalar e subir, o `session/new` com o isolamento, o modo seguro, os modelos, as ferramentas de
// leitura, uso e custo) vem do perfil dele (`profiles/`, CA11); daqui para baixo nada sabe qual agente é. Um
// processo do agente por sessão: a conversa do chat, a gravação traduzida ou o resumo. O processo roda com o
// Node do próprio Electron (`ELECTRON_RUN_AS_NODE=1`, tirado do ambiente antes de o agente carregar), stdio
// em pipe e o ambiente que o perfil monta (CA1).
//
// Segurança (CA3, CA4d): o cliente responde `session/request_permission` sozinho: só leitura e busca dentro
// da pasta da sessão (caminho real, sem link simbólico para fora, padrão de busca que não sai dela) passam,
// e só no chat; o resto é negado e contado. `fs/read_text_file` lê só dentro da pasta, até 2 MB; escrita e
// terminal não existem (as capacidades vão falsas e o SDK responde "método não encontrado"). Sessão que não
// confirma o modo seguro do perfil é fechada.
//
// Contrato 26: a sessão do chat com `web` também libera `WebSearch` (consulta curta, até 10 por execução) e
// `WebFetch` (só endereço visto num resultado de busca desta execução ou digitado pela pessoa, até 15 por execução);
// a regra está em `web.ts`. Uma página que termina sem ter passado por esta política cancela a resposta.
//
// Contrato 21: a fábrica pede os servidores MCP ligados (só o chat das conversas e a análise) e o `session/new` leva só
// os de transporte que o agente anunciou no `initialize` (o comando local sempre). Cada ferramenta MCP passa pela
// política do servidor: "Negar" nega, "Permitir" libera, "Perguntar" (o padrão) abre o cartão na conversa e espera a
// pessoa até 2 min (sem resposta, ou sem conversa para perguntar, nega). A leitura de arquivos segue a regra de antes.
//
// Contrato 47: a sessão do chat com `navegador` abre, antes do `session/new`, uma entrada no servidor MCP local do
// navegador (url e token só dela) e libera as 7 ferramentas dele sem perguntar (`navegador.ts`); o token cai quando a
// sessão fecha ou o processo sai. O nome `navegador` é desse servidor: um servidor MCP da pessoa com o mesmo nome fica
// fora da sessão, e as ferramentas do navegador não passam pela política do contrato 21.
import { spawn as nodeSpawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { MCP_APPROVAL_ARGS_MAX, MCP_APPROVAL_TIMEOUT_MS, maskSecrets, mcpToolKey, mcpToolOf, type McpApproval, type McpApprovalDecision, type McpUse } from '../../shared/mcp'
import type { Timers } from '../claude-cli/translator'
import { NAVEGADOR_MCP_SERVER, navegadorRequested, navegadorToolOf } from './navegador'
import type { AcpMcpServer, AcpPurpose, AcpSessionRequest, AgentProfile, KnownToolCall } from './profiles/types'
import { AcpWebState, searchResultUrls, WEB_SEARCH_MAX, webDecision, webToolOf } from './web'

export type { AcpMcpServer, AcpPurpose, AcpSessionRequest, AgentProfile, KnownToolCall } from './profiles/types'

/** Contrato 47: uma entrada aberta no servidor MCP local do navegador, só de uma sessão. */
export interface NavegadorMcpEntry {
  url: string
  token: string
  /** Revoga o token (sem efeito na segunda vez). */
  close(): void
}

/** Contrato 47: quem abre as entradas do servidor MCP do navegador (`navegador/mcp.ts`). */
export interface NavegadorMcpHost {
  /** `null` se o servidor não subiu: a sessão abre sem o navegador. */
  open(): Promise<NavegadorMcpEntry | null>
}

/** `fs/read_text_file` lê até isto. */
export const ACP_READ_MAX_BYTES = 2 * 1024 * 1024
/** O adaptador tem de responder ao `initialize` nisto. */
export const ACP_INITIALIZE_TIMEOUT_MS = 30_000
/** `session/new` abre o `claude` por baixo: pode levar alguns segundos. */
export const ACP_SESSION_TIMEOUT_MS = 60_000
/** Depois do `SIGTERM`, quanto se espera antes do `SIGKILL`. */
export const ACP_KILL_GRACE_MS = 2_000

/** Ponta de um processo do adaptador (ou, no teste, de um agente na memória). */
export interface AcpLink {
  stream: acp.Stream
  /** `SIGTERM`, e `SIGKILL` se não sair em 2 s. Sem efeito depois de sair. */
  kill(): void
  /** Chamado uma vez, quando o processo sai ou não consegue abrir. */
  onExit(listener: () => void): void
}

/** Abre um processo do adaptador com este ambiente. Lança se nem abrir (`AcpMissingError` se não instalado). */
export type LaunchAcp = (env: NodeJS.ProcessEnv, profile: AgentProfile) => AcpLink

/** O adaptador não está instalado (contrato 17: baixado só com o clique da pessoa). */
export class AcpMissingError extends Error {
  constructor() {
    super('o agente do Claude não está instalado')
  }
}

/**
 * Antes do adaptador, no mesmo processo: tira `ELECTRON_RUN_AS_NODE` do ambiente (ele só serve para o
 * Electron rodar como Node; o adaptador repassa o próprio ambiente ao `claude`) e carrega o script. Com
 * `-e`, `process.argv[1]` é o script e o resto vai para ele.
 */
export const ACP_BOOT =
  "delete process.env.ELECTRON_RUN_AS_NODE;import(require('node:url').pathToFileURL(process.argv[1]).href).catch((error)=>{console.error(error);process.exit(1)})"

export interface AcpChildProcess {
  readonly stdin: NodeJS.WritableStream | null
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type SpawnAcp = (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] }) => AcpChildProcess

/** Implementação real: sem shell, então nenhum argumento é interpretado. */
export const nodeSpawnAcp: SpawnAcp = (file, args, options) => nodeSpawn(file, [...args], options)

export interface ProcessLaunchOptions {
  /** `process.execPath`: o Node do próprio Electron. */
  execPath: string
  /**
   * `dist/index.js` do adaptador: o instalado em `userData/acp` (`null` = não instalado), o do `node_modules`
   * em desenvolvimento ou, no smoke, o agente falso.
   */
  entry: string | ((profile: AgentProfile) => string | null)
  /** Argumentos depois do script (o smoke manda onde o agente falso registra o que recebeu). */
  args?: readonly string[]
  spawn?: SpawnAcp
  timers?: Timers
  /** Só em desenvolvimento: a última linha do stderr do adaptador, nunca texto de reunião. */
  log?: (message: string) => void
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** O adaptador como processo filho do Electron em modo Node, com o protocolo em JSON por linha no stdio. */
export function processLauncher(options: ProcessLaunchOptions): LaunchAcp {
  const spawnAcp = options.spawn ?? nodeSpawnAcp
  const timers = options.timers ?? defaultTimers
  return (env, profile) => {
    const entry = typeof options.entry === 'string' ? options.entry : options.entry(profile)
    if (!entry) throw new AcpMissingError()
    const child = spawnAcp(options.execPath, ['-e', ACP_BOOT, entry, ...(options.args ?? [])], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    if (!child.stdin || !child.stdout) throw new Error('adaptador sem stdio')
    let exited = false
    let killTimer: unknown = null
    const listeners: (() => void)[] = []
    const gone = (): void => {
      if (exited) return
      exited = true
      if (killTimer !== null) timers.clearTimeout(killTimer)
      killTimer = null
      for (const listener of listeners.splice(0)) listener()
    }
    child.on('exit', gone)
    child.on('error', gone)
    // Escrever num processo que acabou de morrer dá EPIPE; sem ouvinte, derrubaria o main.
    child.stdin.on('error', () => undefined)
    child.stdout.on('error', () => undefined)
    // O stderr precisa ser lido (pipe cheio trava o processo); só a última linha vai para o log de desenvolvimento.
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const last = chunk.trim().split('\n').pop()
      if (last) options.log?.(`[acp] stderr: ${last.slice(0, 300)}`)
    })
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>)
    return {
      stream,
      kill: () => {
        if (exited) return
        try {
          child.stdin?.end()
        } catch {
          // stdin já fechado
        }
        try {
          child.kill('SIGTERM')
        } catch {
          // já saiu
        }
        if (killTimer !== null) return
        killTimer = timers.setTimeout(() => {
          killTimer = null
          if (exited) return
          try {
            child.kill('SIGKILL')
          } catch {
            // já saiu
          }
        }, ACP_KILL_GRACE_MS)
      },
      onExit: (listener) => {
        if (exited) listener()
        else listeners.push(listener)
      },
    }
  }
}

/** Contrato 21: de onde a fábrica tira os servidores MCP e para onde vai o que o agente aceita. */
export interface AcpMcpSource {
  servers(use: McpUse, off: readonly string[]): Promise<AcpMcpServer[]>
  capabilities?(capabilities: { http: boolean; sse: boolean }): void
}

export interface AcpOpenerOptions {
  /** O perfil escolhido nas Configurações (`agentProfile`), lido a cada sessão. */
  profile: () => AgentProfile | Promise<AgentProfile>
  launch: LaunchAcp
  /** Contrato 21: os servidores MCP ligados. Sem isto, nenhuma sessão recebe MCP. */
  mcp?: AcpMcpSource
  /** Ambiente do main; passa por `claudeEnv` antes de chegar ao adaptador. */
  baseEnv: NodeJS.ProcessEnv
  timers?: Timers
  log?: (message: string) => void
  /** Contrato 47: o servidor MCP do navegador, para as sessões que pedem `navegador`. */
  navegadorMcp?: NavegadorMcpHost
}

/** A fábrica de sessões para o CLI do agente encontrado, como tradução, resumo e chat a recebem. */
export function acpOpener(options: AcpOpenerOptions): (claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult> {
  return (claudePath) => async (request) => {
    const profile = await options.profile()
    const use: McpUse | null = request.purpose === 'chat' || request.purpose === 'analysis' ? request.purpose : null
    const mcpServers = request.mcp && use && options.mcp ? await options.mcp.servers(use, request.mcp.off ?? []).catch(() => []) : []
    const { mcpServers: _ignored, ...rest } = request
    return openAcpSession(mcpServers.length ? { ...rest, mcpServers } : rest, {
      profile,
      launch: options.launch,
      env: profile.env(options.baseEnv, claudePath),
      ...(options.mcp?.capabilities ? { onMcpCapabilities: options.mcp.capabilities } : {}),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.log ? { log: options.log } : {}),
      ...(options.navegadorMcp ? { navegadorMcp: options.navegadorMcp } : {}),
    })
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Junta o que uma atualização traz ao que já se sabia da chamada. */
export function mergeToolCall(known: KnownToolCall | undefined, update: Partial<acp.ToolCallUpdate>): KnownToolCall {
  const next: KnownToolCall = { ...(known ?? { locations: [] }) }
  if (typeof update.name === 'string') next.name = update.name
  if (typeof update.kind === 'string') next.kind = update.kind
  if (typeof update.title === 'string') next.title = update.title
  if (typeof update.status === 'string') next.status = update.status
  if (Array.isArray(update.locations)) next.locations = update.locations.map((location) => location.path).filter((path): path is string => typeof path === 'string')
  if (update.rawInput !== undefined && update.rawInput !== null) next.rawInput = update.rawInput
  // O adaptador repete o nome da ferramenta em `_meta.claudeCode.toolName` (contrato 26: a busca e a página).
  if (next.name === undefined) {
    const meta = isRecord(update._meta) && isRecord(update._meta['claudeCode']) ? update._meta['claudeCode']['toolName'] : undefined
    if (typeof meta === 'string') next.name = meta
  }
  return next
}

/** Caminhos que a ferramenta vai ler: os `locations` e os campos de caminho do `rawInput`. */
export function toolPaths(call: KnownToolCall, cwd: string): string[] {
  const paths = [...call.locations]
  if (isRecord(call.rawInput)) {
    for (const key of ['file_path', 'path', 'notebook_path']) {
      const value = call.rawInput[key]
      if (typeof value === 'string' && value !== '') paths.push(value)
    }
  }
  return [...new Set(paths.map((path) => resolve(cwd, path)))]
}

/**
 * O caminho, com os links simbólicos resolvidos, está dentro da pasta (também já resolvida)? Arquivo que
 * não existe vale pela pasta dele.
 */
export async function insideFolder(folderReal: string, path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false
  let real: string
  try {
    real = await realpath(path)
  } catch {
    try {
      real = join(await realpath(dirname(path)), basename(path))
    } catch {
      return false
    }
  }
  const rel = relative(folderReal, real)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

/** Ferramentas que o chat pode usar: leitura e busca. */
const READ_KINDS = new Set(['read', 'search'])

/**
 * Padrão de busca (`pattern` do Glob, `glob` do Grep) que sai da pasta: absoluto, com `~` ou com `..` como
 * pedaço do caminho. Um `..` dentro de uma expressão regular (`a..b`) não é pedaço de caminho e passa.
 */
export function patternLeaves(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false
  const trimmed = pattern.trim()
  return isAbsolute(trimmed) || trimmed.startsWith('~') || trimmed.split(/[/\\]/).some((part) => part === '..')
}

/**
 * Política de permissão (CA3): só no chat, só leitura e busca, e todos os caminhos dentro da pasta da
 * sessão. Pedido sem caminho nenhum é negado (dentro da pasta o `claude` não pergunta: o que chega aqui sem
 * caminho não tem como ser conferido); padrão de busca que sai da pasta também.
 *
 * Contrato 26: com `web` (a sessão com internet), `WebSearch` e `WebFetch` seguem `webDecision`, e a liberação
 * conta na execução. Sem `web`, as duas são negadas como qualquer outra.
 *
 * Contrato 47: com `navegador` (a sessão que abriu com o servidor do navegador), as 7 ferramentas dele passam sem
 * conferência (quem confere os argumentos é o servidor MCP). Sem `navegador`, são negadas como qualquer outra.
 */
export async function permissionAllowed(
  purpose: AcpPurpose,
  call: KnownToolCall,
  cwd: string,
  cwdReal: string,
  readTools: AgentProfile['readTools'],
  web: AcpWebState | null = null,
  navegador = false,
): Promise<boolean> {
  if (purpose !== 'chat') return false
  if (call.name?.startsWith('mcp__')) return navegador && navegadorToolOf(call) !== null
  const tool = webToolOf(call)
  if (tool) {
    if (!web || webDecision(tool, call, web) !== 'allow') return false
    if (tool === 'WebSearch') web.searches += 1
    else web.pages += 1
    return true
  }
  const kind = call.kind ?? (call.name ? readTools[call.name] : undefined)
  if (!kind || !READ_KINDS.has(kind)) return false
  // Ferramenta com nome que não é uma das de leitura do perfil: negada, qualquer que seja o `kind`.
  if (call.name !== undefined && readTools[call.name] === undefined) return false
  if (isRecord(call.rawInput) && (patternLeaves(call.rawInput['pattern']) || patternLeaves(call.rawInput['glob']))) return false
  const paths = toolPaths(call, cwd)
  if (!paths.length) return false
  for (const path of paths) if (!(await insideFolder(cwdReal, path))) return false
  return true
}

/** Resposta ao `session/request_permission`: a opção "permitir uma vez" ou a de recusar. */
export function permissionOutcome(options: readonly acp.PermissionOption[], allow: boolean): acp.RequestPermissionResponse {
  const pick = (kinds: readonly string[]): acp.PermissionOption | undefined => kinds.map((kind) => options.find((option) => option.kind === kind)).find(Boolean)
  const option = allow ? pick(['allow_once']) : pick(['reject_once', 'reject_always'])
  // Sem a opção de recusar, `cancelled` também nega.
  return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }
}

/**
 * `fs/read_text_file` (CA3): só no chat, só dentro da pasta (caminho real), arquivo até 2 MB. `line` (a
 * partir de 1) e `limit` cortam as linhas como o protocolo diz.
 */
export async function readTextFileInside(purpose: AcpPurpose, params: acp.ReadTextFileRequest, cwdReal: string): Promise<acp.ReadTextFileResponse> {
  if (purpose !== 'chat' || !(await insideFolder(cwdReal, params.path))) throw acp.RequestError.invalidParams(undefined, 'leitura fora da pasta da conversa negada')
  const info = await stat(params.path).catch(() => null)
  if (!info?.isFile()) throw acp.RequestError.resourceNotFound(basename(params.path))
  if (info.size > ACP_READ_MAX_BYTES) throw acp.RequestError.invalidParams(undefined, 'arquivo acima de 2 MB')
  const content = await readFile(params.path, 'utf8')
  if (!params.line && !params.limit) return { content }
  const lines = content.split('\n')
  const start = Math.max((params.line ?? 1) - 1, 0)
  const end = params.limit ? start + params.limit : lines.length
  return { content: lines.slice(start, end).join('\n') }
}

/** Ferramenta MCP da chamada (contrato 21): o servidor da sessão e a ferramenta; `null` se não é MCP. */
export function mcpCallOf(call: KnownToolCall, servers: readonly AcpMcpServer[]): { server: AcpMcpServer | null; tool: string } | null {
  const parsed = mcpToolOf(call.name)
  if (!parsed) return null
  return { server: servers.find((server) => server.name === parsed.server) ?? null, tool: parsed.tool }
}

/** Argumentos do cartão de aprovação: JSON formatado, os segredos do cadastro mascarados, cortado. */
export function approvalArgs(rawInput: unknown, secrets: readonly string[]): string {
  let text: string
  try {
    text = JSON.stringify(rawInput ?? {}, null, 2) ?? '{}'
  } catch {
    text = '{}'
  }
  const masked = maskSecrets(text, secrets)
  return masked.length > MCP_APPROVAL_ARGS_MAX ? `${masked.slice(0, MCP_APPROVAL_ARGS_MAX - 1)}…` : masked
}

/** Fim de um `session/prompt`. */
export type AcpPromptOutcome =
  | { ok: true; stopReason: acp.StopReason; usage: acp.Usage | null; meta: Record<string, unknown> | null }
  /** `exited`: o processo saiu no meio; `failed`: o agente respondeu com erro. */
  | { ok: false; error: 'exited' | 'failed' }

/** Por que uma chamada foi negada, quando importa para a tela: a página fora da busca (contrato 26). */
export interface AcpDenial {
  toolCallId: string
  reason: 'web-blocked'
}

/** Quem acompanha um `session/prompt`. */
export interface AcpPromptHandlers {
  onUpdate?: (update: acp.SessionUpdate) => void
  /** Um pedido de permissão ou uma leitura negada nesta resposta (com o motivo, se a tela mostra). */
  onDenied?: (denial?: AcpDenial) => void
  /**
   * Contrato 21: ferramenta MCP com a política "Perguntar". Quem acompanha mostra o cartão e devolve a escolha da
   * pessoa; sem isto (análise), a ferramenta é negada.
   */
  onApproval?: (approval: McpApproval) => Promise<McpApprovalDecision>
  /** O cartão daquele pedido saiu (respondido, vencido em 2 min ou a resposta acabou). */
  onApprovalDone?: (id: string, decision: McpApprovalDecision) => void
}

/**
 * Falha ao abrir. `agent`: o adaptador não subiu (não abriu, não respondeu, versão incompatível ou não aceitou
 * o modo "default"); `missing`: não instalado.
 */
export type AcpOpenResult = { ok: true; session: AcpSession } | { ok: false; error: 'agent' | 'failed' | 'missing'; reason: string }

export interface AcpOpenDeps {
  profile: AgentProfile
  launch: LaunchAcp
  /** O ambiente do perfil (`profile.env`). */
  env: NodeJS.ProcessEnv
  timers?: Timers
  initializeTimeoutMs?: number
  sessionTimeoutMs?: number
  /** Contrato 21: a espera pela pessoa no cartão de aprovação. */
  approvalTimeoutMs?: number
  /** Contrato 21: os transportes MCP que o agente anunciou no `initialize`. */
  onMcpCapabilities?: (capabilities: { http: boolean; sse: boolean }) => void
  log?: (message: string) => void
  /** Contrato 47: o servidor MCP do navegador; sem ele, a sessão que pede `navegador` abre sem as ferramentas. */
  navegadorMcp?: NavegadorMcpHost
}

/** Promessa com tempo limite: estourou, rejeita. */
function within<T>(promise: Promise<T>, ms: number, timers: Timers, label: string): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = timers.setTimeout(() => reject(new Error(`${label}: sem resposta em ${ms} ms`)), ms)
    promise.then(
      (value) => {
        timers.clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        timers.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Fábrica de sessões (CA4d): abre o processo, faz o `initialize` (com a versão do protocolo conferida) e o
 * `session/new`. Nunca rejeita.
 */
export async function openAcpSession(asked: AcpSessionRequest, deps: AcpOpenDeps): Promise<AcpOpenResult> {
  const timers = deps.timers ?? defaultTimers
  let cwdReal: string
  try {
    cwdReal = await realpath(asked.cwd)
  } catch {
    return { ok: false, error: 'failed', reason: 'pasta da sessão não existe' }
  }
  // Contrato 47: a entrada do navegador antes do processo; servidor que não sobe deixa a sessão sem ele, com a
  // instrução sem o navegador (a pedida não fala de ferramentas que a sessão não tem).
  const navegador = navegadorRequested(asked) && deps.navegadorMcp ? await deps.navegadorMcp.open().catch(() => null) : null
  const { systemPromptSemNavegador, ...base } = asked
  const request: AcpSessionRequest = navegadorRequested(asked) && !navegador ? { ...base, navegador: false, systemPrompt: systemPromptSemNavegador ?? base.systemPrompt } : base
  if (navegadorRequested(asked) && !navegador) deps.log?.('[acp] o servidor do navegador não abriu: a sessão segue sem ele')
  let link: AcpLink
  try {
    link = deps.launch(deps.env, deps.profile)
  } catch (error) {
    navegador?.close()
    if (error instanceof AcpMissingError) return { ok: false, error: 'missing', reason: error.message }
    return { ok: false, error: 'agent', reason: `o adaptador não abriu: ${error instanceof Error ? error.message : String(error)}` }
  }
  const session = new AcpSession(deps.profile, request, link, cwdReal, timers, deps.approvalTimeoutMs ?? MCP_APPROVAL_TIMEOUT_MS, navegador)
  const exited = new Promise<never>((_resolve, reject) => link.onExit(() => reject(new Error('o adaptador saiu'))))
  exited.catch(() => undefined)
  try {
    const init = await within(Promise.race([session.initialize(), exited]), deps.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS, timers, 'initialize')
    if (init.protocolVersion !== acp.PROTOCOL_VERSION) {
      session.close()
      return { ok: false, error: 'agent', reason: `versão do protocolo ${String(init.protocolVersion)}, o app fala a ${acp.PROTOCOL_VERSION}` }
    }
    // Contrato 21: o comando local o agente sempre aceita; HTTP e SSE só se anunciou.
    const mcp = { http: init.agentCapabilities?.mcpCapabilities?.http === true, sse: init.agentCapabilities?.mcpCapabilities?.sse === true }
    deps.onMcpCapabilities?.(mcp)
    session.useMcp((request.mcpServers ?? []).filter((server) => server.transport === 'stdio' || mcp[server.transport]))
  } catch (error) {
    session.close()
    return { ok: false, error: 'agent', reason: error instanceof Error ? error.message : String(error) }
  }
  try {
    await within(Promise.race([session.start(), exited]), deps.sessionTimeoutMs ?? ACP_SESSION_TIMEOUT_MS, timers, 'session/new')
  } catch (error) {
    session.close()
    deps.log?.(`[acp] session/new falhou: ${error instanceof Error ? error.message.slice(0, 300) : 'erro'}`)
    return { ok: false, error: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
  // Sem o modo seguro confirmado (no Claude, "default"), um pedido de leitura fora da pasta poderia ser
  // aprovado sem perguntar.
  const unsafe = deps.profile.unsafeMode(session)
  if (unsafe) {
    session.close()
    return { ok: false, error: 'agent', reason: unsafe }
  }
  return { ok: true, session }
}

interface Prompting {
  handlers: AcpPromptHandlers
}

/** Uma sessão ACP num processo próprio do adaptador. */
export class AcpSession {
  sessionId = ''
  /** Opções de sessão que o adaptador anunciou (modelo, esforço, modo…), atualizadas a cada mudança. */
  configOptions: acp.SessionConfigOption[] = []

  private readonly connection: acp.ClientConnection
  private readonly tools = new Map<string, KnownToolCall>()
  private prompting: Prompting | null = null
  private closed = false
  private exitListeners: (() => void)[] = []
  private gone = false
  /** Contrato 26: a internet da sessão (só o chat com `web`); `null` nega busca e página. */
  readonly web: AcpWebState | null
  /** Contrato 21: os servidores MCP que foram no `session/new`. */
  mcpServers: readonly AcpMcpServer[] = []
  private approvals = 0
  /** Contrato 21: chamadas MCP que a política liberou (uma que roda sem ter passado por ela cancela a resposta). */
  private readonly mcpAllowed = new Set<string>()

  constructor(
    readonly profile: AgentProfile,
    readonly request: AcpSessionRequest,
    private readonly link: AcpLink,
    private readonly cwdReal: string,
    private readonly timers: Timers = defaultTimers,
    private readonly approvalTimeoutMs: number = MCP_APPROVAL_TIMEOUT_MS,
    /** Contrato 47: a entrada do servidor do navegador desta sessão; `null` nega as ferramentas dele. */
    private readonly navegadorMcp: NavegadorMcpEntry | null = null,
  ) {
    this.web = request.web === true && request.purpose === 'chat' && request.tools === 'read' ? new AcpWebState() : null
    const app = acp
      .client({ name: 'meeting-scribe' })
      .onNotification('session/update', (ctx) => this.onUpdate(ctx.params))
      .onRequest('session/request_permission', (ctx) => this.onPermission(ctx.params))
      .onRequest('fs/read_text_file', (ctx) => this.onRead(ctx.params))
    this.connection = app.connect(link.stream)
    link.onExit(() => {
      this.gone = true
      this.navegadorMcp?.close()
      this.connection.close()
      for (const listener of this.exitListeners.splice(0)) listener()
    })
  }

  /** Chamadas de ferramenta vistas nesta sessão (diagnóstico e teste real; caminhos ficam no main). */
  knownToolCalls(): ReadonlyMap<string, KnownToolCall> {
    return this.tools
  }

  /** Contrato 47: a sessão abriu com as ferramentas do navegador. */
  get navegador(): boolean {
    return this.navegadorMcp !== null
  }

  /** O processo ainda está vivo e a sessão não foi fechada. */
  get alive(): boolean {
    return !this.closed && !this.gone
  }

  /** O processo saiu (sozinho ou por `close`). */
  onExit(listener: () => void): void {
    if (this.gone) listener()
    else this.exitListeners.push(listener)
  }

  initialize(): Promise<acp.InitializeResponse> {
    return this.connection.agent.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'meeting-scribe', version: '1' },
    })
  }

  /**
   * Contrato 21: os servidores MCP que vão no `session/new` (só o chat e a análise). Contrato 47: sem o que tiver o
   * nome do servidor do navegador (as ferramentas dele cairiam na regra que libera as do navegador sem perguntar).
   */
  useMcp(servers: readonly AcpMcpServer[]): void {
    this.mcpServers = this.request.purpose === 'chat' || this.request.purpose === 'analysis' ? servers.filter((server) => server.name !== NAVEGADOR_MCP_SERVER) : []
  }

  async start(): Promise<void> {
    const { mcpServers: _requested, ...request } = this.request
    const local = this.navegadorMcp ? { navegador: { url: this.navegadorMcp.url, token: this.navegadorMcp.token } } : {}
    const response = await this.connection.agent.request('session/new', this.profile.newSession(this.mcpServers.length ? { ...request, mcpServers: this.mcpServers } : request, local))
    this.sessionId = response.sessionId
    this.configOptions = response.configOptions ?? []
  }

  /** Valor atual de uma opção de sessão (`model`, `effort`…). */
  option(configId: string): string | boolean | null {
    const option = this.configOptions.find((entry) => entry.id === configId)
    return option ? (option.currentValue as string | boolean) : null
  }

  /** O adaptador oferece este valor para a opção? */
  offers(configId: string, value: string): boolean {
    const option = this.configOptions.find((entry) => entry.id === configId)
    if (!option || option.type !== 'select') return false
    return option.options.some((entry) => ('options' in entry ? entry.options.some((inner) => inner.value === value) : entry.value === value))
  }

  /** `session/set_config_option` (CA2: troca de modelo; CA5: esforço). `false` se o agente recusou. */
  async setOption(configId: string, value: string): Promise<boolean> {
    if (!this.alive) return false
    try {
      const response = await this.connection.agent.request('session/set_config_option', { sessionId: this.sessionId, configId, value })
      this.configOptions = response.configOptions
      return true
    } catch {
      return false
    }
  }

  /**
   * Um `session/prompt` com o texto. Nunca rejeita. `typedText` (contrato 26): o que a pessoa escreveu, sem escape,
   * de onde saem os endereços que ela deixou abrir; as contas da internet recomeçam aqui.
   */
  async prompt(text: string, handlers: AcpPromptHandlers = {}, typedText = ''): Promise<AcpPromptOutcome> {
    if (!this.alive) return { ok: false, error: 'exited' }
    if (this.prompting) return { ok: false, error: 'failed' }
    this.prompting = { handlers }
    this.web?.begin(typedText)
    const exited = new Promise<'exited'>((resolvePromise) => this.onExit(() => resolvePromise('exited')))
    try {
      const response = await Promise.race([this.connection.agent.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }), exited])
      if (response === 'exited') return { ok: false, error: 'exited' }
      return { ok: true, stopReason: response.stopReason, usage: response.usage ?? null, meta: response._meta ?? null }
    } catch {
      return { ok: false, error: this.alive ? 'failed' : 'exited' }
    } finally {
      this.prompting = null
    }
  }

  /** "Parar": `session/cancel`; o `session/prompt` em curso termina com `cancelled` e a sessão segue viva. */
  cancel(): void {
    if (!this.alive || !this.sessionId) return
    void this.connection.agent.notify('session/cancel', { sessionId: this.sessionId }).catch(() => undefined)
  }

  /** Fecha a sessão: o processo morre (`SIGTERM` e, em 2 s, `SIGKILL`). */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.navegadorMcp?.close()
    this.connection.close()
    this.link.kill()
  }

  private onUpdate(notification: acp.SessionNotification): void {
    if (notification.sessionId !== this.sessionId && this.sessionId !== '') return
    const update = notification.update
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const call = mergeToolCall(this.tools.get(update.toolCallId), update)
      this.tools.set(update.toolCallId, call)
      this.onWebUpdate(update.toolCallId, call, update)
      this.onMcpUpdate(update.toolCallId, call, update)
    } else if (update.sessionUpdate === 'config_option_update') {
      this.configOptions = update.configOptions
    }
    this.prompting?.handlers.onUpdate?.(update)
  }

  /**
   * Contrato 26: o resultado de uma busca traz os endereços que podem abrir depois. Uma busca que termina sem ter
   * pedido permissão (o `claude` não perguntou) conta igual e, passado o limite, a resposta é cancelada; uma página que
   * termina sem a política ter liberado (o `claude` tem endereços que abre sem perguntar) também cancela.
   */
  private onWebUpdate(toolCallId: string, call: KnownToolCall, update: acp.ToolCallUpdate | acp.ToolCall): void {
    const tool = webToolOf(call)
    if (!tool) return
    const web = this.web
    const done = update.status === 'completed' || update.status === 'in_progress'
    if (tool === 'WebSearch' && web) {
      web.addQuery(isRecord(call.rawInput) ? call.rawInput['query'] : undefined)
      if (update.status !== 'failed') for (const url of searchResultUrls(update, web.queries)) web.seen.add(url)
    }
    if (!done || web?.allowed.has(toolCallId)) return
    if (tool === 'WebSearch' && web) {
      web.allowed.add(toolCallId)
      web.searches += 1
      if (web.searches <= WEB_SEARCH_MAX) return
    }
    this.prompting?.handlers.onDenied?.()
    this.cancel()
  }

  /**
   * Contrato 21: ferramenta MCP rodando sem ter passado pela política (o `claude` não perguntou): a resposta é cancelada.
   * Contrato 47: as do navegador, na sessão que abriu com ele, rodam sem perguntar (`allowedTools`) e não contam.
   */
  private onMcpUpdate(toolCallId: string, call: KnownToolCall, update: acp.ToolCallUpdate | acp.ToolCall): void {
    if (!mcpToolOf(call.name) || this.mcpAllowed.has(toolCallId) || (this.navegador && navegadorToolOf(call))) return
    if (update.status !== 'in_progress' && update.status !== 'completed') return
    this.prompting?.handlers.onDenied?.()
    this.cancel()
  }

  private async onPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const call = mergeToolCall(this.tools.get(params.toolCall.toolCallId), params.toolCall)
    // Contrato 47: as do navegador seguem `permissionAllowed` (liberadas só na sessão que abriu com ele).
    const mcp = navegadorToolOf(call) ? null : mcpCallOf(call, this.mcpServers)
    if (mcp) {
      const allow = await this.mcpDecision(mcp, call).catch(() => false)
      if (allow) this.mcpAllowed.add(params.toolCall.toolCallId)
      else this.prompting?.handlers.onDenied?.()
      return permissionOutcome(params.options, allow)
    }
    if (webToolOf(call) === 'WebSearch' && isRecord(call.rawInput)) this.web?.addQuery(call.rawInput['query'])
    const allow = await permissionAllowed(this.request.purpose, call, this.request.cwd, this.cwdReal, this.profile.readTools, this.web, this.navegador).catch(() => false)
    const tool = webToolOf(call)
    if (allow && tool) this.web?.allowed.add(params.toolCall.toolCallId)
    if (!allow) {
      const blocked = tool === 'WebFetch' && this.web !== null && webDecision('WebFetch', call, this.web) === 'blocked'
      this.prompting?.handlers.onDenied?.(blocked ? { toolCallId: params.toolCall.toolCallId, reason: 'web-blocked' } : undefined)
    }
    return permissionOutcome(params.options, allow)
  }

  /**
   * Contrato 21: a política da ferramenta MCP. Servidor que não é desta sessão: negado. "Perguntar": o cartão, até
   * 2 min; "Sempre permitir esta ferramenta" grava `allow` e vale já para as próximas desta sessão.
   */
  private async mcpDecision(mcp: { server: AcpMcpServer | null; tool: string }, call: KnownToolCall): Promise<boolean> {
    const server = mcp.server
    if (!server) return false
    const policy = server.toolPolicy[mcpToolKey(mcp.tool)] ?? 'ask'
    if (policy !== 'ask') return policy === 'allow'
    const handlers = this.prompting?.handlers
    if (!handlers?.onApproval) return false
    const id = `mcp-${++this.approvals}`
    const approval: McpApproval = { id, server: server.name, tool: mcp.tool, args: approvalArgs(call.rawInput, server.secrets) }
    let timer: unknown = null
    const expired = new Promise<McpApprovalDecision>((resolve) => {
      timer = this.timers.setTimeout(() => resolve('deny'), this.approvalTimeoutMs)
    })
    const gone = new Promise<McpApprovalDecision>((resolve) => this.onExit(() => resolve('deny')))
    const decision = await Promise.race([handlers.onApproval(approval).catch((): McpApprovalDecision => 'deny'), expired, gone])
    if (timer !== null) this.timers.clearTimeout(timer)
    handlers.onApprovalDone?.(id, decision)
    if (decision === 'always') {
      const tool = mcpToolKey(mcp.tool)
      server.allowAlways(tool)
      this.mcpServers = this.mcpServers.map((entry) => (entry === server ? { ...entry, toolPolicy: { ...entry.toolPolicy, [tool]: 'allow' } } : entry))
    }
    return decision !== 'deny'
  }

  private async onRead(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    try {
      return await readTextFileInside(this.request.purpose, params, this.cwdReal)
    } catch (error) {
      this.prompting?.handlers.onDenied?.()
      throw error instanceof acp.RequestError ? error : acp.RequestError.internalError(undefined, 'leitura falhou')
    }
  }
}

/** Texto de um bloco de conteúdo do ACP (`agent_message_chunk`, `agent_thought_chunk`). */
export function contentText(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : ''
}

/** Reexporta os tipos do protocolo que os usos (chat, tradução, resumo) leem. */
export type { SessionUpdate, Usage, PlanEntry, ToolCallStatus } from '@agentclientprotocol/sdk/unstable'
