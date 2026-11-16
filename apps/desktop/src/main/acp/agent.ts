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
import { spawn as nodeSpawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import type { Timers } from '../claude-cli/translator'
import type { AcpPurpose, AcpSessionRequest, AgentProfile, KnownToolCall } from './profiles/types'

export type { AcpPurpose, AcpSessionRequest, AgentProfile, KnownToolCall } from './profiles/types'

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

export interface AcpOpenerOptions {
  /** O perfil escolhido nas Configurações (`agentProfile`), lido a cada sessão. */
  profile: () => AgentProfile | Promise<AgentProfile>
  launch: LaunchAcp
  /** Ambiente do main; passa por `claudeEnv` antes de chegar ao adaptador. */
  baseEnv: NodeJS.ProcessEnv
  timers?: Timers
  log?: (message: string) => void
}

/** A fábrica de sessões para o CLI do agente encontrado, como tradução, resumo e chat a recebem. */
export function acpOpener(options: AcpOpenerOptions): (claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult> {
  return (claudePath) => async (request) => {
    const profile = await options.profile()
    return openAcpSession(request, {
      profile,
      launch: options.launch,
      env: profile.env(options.baseEnv, claudePath),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.log ? { log: options.log } : {}),
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
 */
export async function permissionAllowed(
  purpose: AcpPurpose,
  call: KnownToolCall,
  cwd: string,
  cwdReal: string,
  readTools: AgentProfile['readTools'],
): Promise<boolean> {
  if (purpose !== 'chat') return false
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

/** Fim de um `session/prompt`. */
export type AcpPromptOutcome =
  | { ok: true; stopReason: acp.StopReason; usage: acp.Usage | null; meta: Record<string, unknown> | null }
  /** `exited`: o processo saiu no meio; `failed`: o agente respondeu com erro. */
  | { ok: false; error: 'exited' | 'failed' }

/** Quem acompanha um `session/prompt`. */
export interface AcpPromptHandlers {
  onUpdate?: (update: acp.SessionUpdate) => void
  /** Um pedido de permissão ou uma leitura negada nesta resposta. */
  onDenied?: () => void
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
  log?: (message: string) => void
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
export async function openAcpSession(request: AcpSessionRequest, deps: AcpOpenDeps): Promise<AcpOpenResult> {
  const timers = deps.timers ?? defaultTimers
  let cwdReal: string
  try {
    cwdReal = await realpath(request.cwd)
  } catch {
    return { ok: false, error: 'failed', reason: 'pasta da sessão não existe' }
  }
  let link: AcpLink
  try {
    link = deps.launch(deps.env, deps.profile)
  } catch (error) {
    if (error instanceof AcpMissingError) return { ok: false, error: 'missing', reason: error.message }
    return { ok: false, error: 'agent', reason: `o adaptador não abriu: ${error instanceof Error ? error.message : String(error)}` }
  }
  const session = new AcpSession(deps.profile, request, link, cwdReal)
  const exited = new Promise<never>((_resolve, reject) => link.onExit(() => reject(new Error('o adaptador saiu'))))
  exited.catch(() => undefined)
  try {
    const init = await within(Promise.race([session.initialize(), exited]), deps.initializeTimeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS, timers, 'initialize')
    if (init.protocolVersion !== acp.PROTOCOL_VERSION) {
      session.close()
      return { ok: false, error: 'agent', reason: `versão do protocolo ${String(init.protocolVersion)}, o app fala a ${acp.PROTOCOL_VERSION}` }
    }
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

  constructor(
    readonly profile: AgentProfile,
    readonly request: AcpSessionRequest,
    private readonly link: AcpLink,
    private readonly cwdReal: string,
  ) {
    const app = acp
      .client({ name: 'meeting-scribe' })
      .onNotification('session/update', (ctx) => this.onUpdate(ctx.params))
      .onRequest('session/request_permission', (ctx) => this.onPermission(ctx.params))
      .onRequest('fs/read_text_file', (ctx) => this.onRead(ctx.params))
    this.connection = app.connect(link.stream)
    link.onExit(() => {
      this.gone = true
      this.connection.close()
      for (const listener of this.exitListeners.splice(0)) listener()
    })
  }

  /** Chamadas de ferramenta vistas nesta sessão (diagnóstico e teste real; caminhos ficam no main). */
  knownToolCalls(): ReadonlyMap<string, KnownToolCall> {
    return this.tools
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

  async start(): Promise<void> {
    const response = await this.connection.agent.request('session/new', this.profile.newSession(this.request))
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

  /** Um `session/prompt` com o texto. Nunca rejeita. */
  async prompt(text: string, handlers: AcpPromptHandlers = {}): Promise<AcpPromptOutcome> {
    if (!this.alive) return { ok: false, error: 'exited' }
    if (this.prompting) return { ok: false, error: 'failed' }
    this.prompting = { handlers }
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
    this.connection.close()
    this.link.kill()
  }

  private onUpdate(notification: acp.SessionNotification): void {
    if (notification.sessionId !== this.sessionId && this.sessionId !== '') return
    const update = notification.update
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.tools.set(update.toolCallId, mergeToolCall(this.tools.get(update.toolCallId), update))
    } else if (update.sessionUpdate === 'config_option_update') {
      this.configOptions = update.configOptions
    }
    this.prompting?.handlers.onUpdate?.(update)
  }

  private async onPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const call = mergeToolCall(this.tools.get(params.toolCall.toolCallId), params.toolCall)
    const allow = await permissionAllowed(this.request.purpose, call, this.request.cwd, this.cwdReal, this.profile.readTools).catch(() => false)
    if (!allow) this.prompting?.handlers.onDenied?.()
    return permissionOutcome(params.options, allow)
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
