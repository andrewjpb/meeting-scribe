// "Testar conexão" (contrato 21, CA3): sobe o servidor MCP isolado e faz o `initialize` e o `tools/list` do protocolo,
// com 15 s de limite, e devolve as ferramentas (nome e descrição). Nada mais é pedido ao servidor: nenhuma ferramenta
// roda aqui.
// - Comando local (stdio): o processo recebe só as variáveis cadastradas, mais `PATH` (o do shell de login), `HOME` e
//   `LANG`; nada do ambiente do app. JSON por linha no stdin/stdout; o stderr é lido e descartado (pode ter segredo).
//   O processo morre no fim (stdin fechado, `SIGTERM` e, em 2 s, `SIGKILL`).
// - Endereço HTTP ("Streamable HTTP"): `POST` com os cabeçalhos cadastrados; a resposta vem em JSON ou num fluxo SSE.
//   SSE (o transporte antigo): `GET` do fluxo, o endereço de envio que ele manda (só na mesma origem) e os `POST`.
//   Só `https://`, ou `http://` no próprio Mac. Sem seguir redirecionamento.
// Tudo o que volta do servidor é dado: lido com limite de tamanho, validado de leve e cortado.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { z } from 'zod'
import { MCP_TEST_TIMEOUT_MS, MCP_TOOL_DESCRIPTION_MAX, MCP_TOOL_NAME_MAX, MCP_TOOLS_MAX, mcpText, mcpUrlAllowed, type McpTestResult, type McpToolInfo, type McpTransport } from '../../shared/mcp'

/** Versão do protocolo MCP pedida no `initialize`. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'
/** Tudo o que o servidor manda, somado, até isto. */
export const MCP_RESPONSE_MAX_BYTES = 4 * 1024 * 1024
const KILL_GRACE_MS = 2_000
const TOOLS_PAGES_MAX = 5

/** O que o teste precisa de um servidor (já com os segredos, só no main). */
export interface McpConnectDefinition {
  transport: McpTransport
  command: string | null
  args: readonly string[]
  cwd: string | null
  env: Readonly<Record<string, string>>
  url: string | null
  headers: Readonly<Record<string, string>>
}

export type SpawnMcp = (command: string, args: readonly string[], options: { cwd?: string | undefined; env: NodeJS.ProcessEnv }) => ChildProcess

export const nodeSpawnMcp: SpawnMcp = (command, args, options) => nodeSpawn(command, [...args], { ...options, stdio: ['pipe', 'pipe', 'pipe'] })

export interface McpTestOptions {
  /** `PATH` do shell de login (o app aberto pelo Finder não herda o do terminal). */
  path: string
  baseEnv: NodeJS.ProcessEnv
  timeoutMs?: number
  spawn?: SpawnMcp
}

/** Ambiente do processo: só as variáveis cadastradas, mais `PATH`, `HOME` e `LANG` (CA7). */
export function mcpProcessEnv(env: Readonly<Record<string, string>>, path: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: path }
  for (const name of ['HOME', 'LANG'] as const) {
    const value = baseEnv[name]
    if (typeof value === 'string' && value !== '') result[name] = value
  }
  return { ...result, ...env }
}

const toolsSchema = z.object({
  tools: z.array(z.unknown()).catch([]),
  nextCursor: z.string().max(1000).optional().catch(undefined),
})
const toolSchema = z.object({ name: z.string().min(1), description: z.unknown().optional() })

/** As ferramentas de uma página do `tools/list`, nos limites do app. */
export function toolsOf(result: unknown): { tools: McpToolInfo[]; cursor: string | undefined } {
  const page = toolsSchema.safeParse(result)
  if (!page.success) return { tools: [], cursor: undefined }
  const tools: McpToolInfo[] = []
  for (const raw of page.data.tools) {
    const tool = toolSchema.safeParse(raw)
    if (!tool.success) continue
    const name = mcpText(tool.data.name, MCP_TOOL_NAME_MAX)
    if (name) tools.push({ name, description: mcpText(tool.data.description, MCP_TOOL_DESCRIPTION_MAX) })
  }
  return { tools, cursor: page.data.nextCursor }
}

interface JsonRpcResponse {
  id: number
  result?: unknown
  error?: { message?: unknown }
}

const isResponse = (value: unknown): value is JsonRpcResponse =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number' && ('result' in value || 'error' in value)

/** O canal com o servidor: manda um pedido e espera a resposta de mesmo id; manda uma notificação. */
interface Channel {
  request(method: string, params: unknown): Promise<unknown>
  notify(method: string, params?: unknown): Promise<void>
  close(): void
}

class McpError extends Error {}

/** `initialize`, `notifications/initialized` e o `tools/list` (até 5 páginas). */
async function handshake(channel: Channel): Promise<McpToolInfo[]> {
  await channel.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'meeting-scribe', version: '1' } })
  await channel.notify('notifications/initialized')
  const tools: McpToolInfo[] = []
  let cursor: string | undefined
  for (let page = 0; page < TOOLS_PAGES_MAX; page++) {
    const result = toolsOf(await channel.request('tools/list', cursor ? { cursor } : {}))
    for (const tool of result.tools) if (!tools.some((known) => known.name === tool.name)) tools.push(tool)
    cursor = result.cursor
    if (!cursor || tools.length >= MCP_TOOLS_MAX) break
  }
  return tools.slice(0, MCP_TOOLS_MAX)
}

/** Erro do JSON-RPC como motivo curto (texto do servidor, cortado). */
function rpcError(response: JsonRpcResponse): McpError {
  const message = mcpText(response.error?.message, 120)
  return new McpError(message ? `o servidor respondeu com erro (${message})` : 'o servidor respondeu com erro')
}

/** O processo do servidor e o JSON por linha. */
function stdioChannel(child: ChildProcess, onExit: (reason: string) => void): Channel {
  let next = 0
  let received = 0
  let buffer = ''
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    received += chunk.length
    if (received > MCP_RESPONSE_MAX_BYTES) {
      onExit('o servidor mandou dados demais')
      return
    }
    buffer += chunk
    let at = buffer.indexOf('\n')
    while (at !== -1) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (!line.startsWith('{')) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (!isResponse(message)) continue
      const pending = waiting.get(message.id)
      if (!pending) continue
      waiting.delete(message.id)
      if (message.error) pending.reject(rpcError(message))
      else pending.resolve(message.result)
    }
  })
  // O stderr precisa ser lido (pipe cheio trava o processo); pode ter segredo, então não vai a lugar nenhum.
  child.stderr?.on('data', () => undefined)
  child.stdin?.on('error', () => undefined)
  const write = (message: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!child.stdin?.writable) {
        reject(new McpError('o processo do servidor não está aberto'))
        return
      }
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(new McpError('o processo do servidor fechou')) : resolve()))
    })
  return {
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++next
        waiting.set(id, { resolve, reject })
        write({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
          waiting.delete(id)
          reject(error instanceof Error ? error : new McpError(String(error)))
        })
      }),
    notify: (method, params) => write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }),
    close: () => {
      for (const pending of waiting.values()) pending.reject(new McpError('fechado'))
      waiting.clear()
    },
  }
}

/** Lê um corpo inteiro (até o limite) como texto. */
function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MCP_RESPONSE_MAX_BYTES) {
        response.destroy()
        reject(new McpError('o servidor mandou dados demais'))
        return
      }
      chunks.push(chunk)
    })
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    response.on('error', () => reject(new McpError('a conexão caiu')))
  })
}

/** Eventos de um fluxo SSE (`event:` e `data:` até a linha em branco), um a um. */
function onSseEvents(response: IncomingMessage, onEvent: (event: string, data: string) => void, onFail: (error: Error) => void): void {
  let buffer = ''
  let size = 0
  let event = 'message'
  let data: string[] = []
  response.setEncoding('utf8')
  response.on('data', (chunk: string) => {
    size += chunk.length
    if (size > MCP_RESPONSE_MAX_BYTES) {
      response.destroy()
      onFail(new McpError('o servidor mandou dados demais'))
      return
    }
    buffer += chunk.replace(/\r\n/g, '\n')
    let at = buffer.indexOf('\n')
    while (at !== -1) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (line === '') {
        if (data.length) onEvent(event, data.join('\n'))
        event = 'message'
        data = []
      } else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
  })
  response.on('error', () => onFail(new McpError('a conexão caiu')))
}

interface HttpOptions {
  method: 'GET' | 'POST' | 'DELETE'
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

function send(url: URL, options: HttpOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = requestFn(url, { method: options.method, headers: { ...options.headers, ...(options.body !== undefined ? { 'content-length': String(Buffer.byteLength(options.body)) } : {}) }, signal: options.signal }, resolve)
    req.on('error', () => reject(new McpError('não foi possível conectar ao endereço')))
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** Código HTTP como motivo curto. */
function statusError(status: number): McpError {
  if (status === 401 || status === 403) return new McpError(`o servidor recusou o acesso (HTTP ${status}); confira os cabeçalhos`)
  if (status >= 300 && status < 400) return new McpError(`o servidor mandou para outro endereço (HTTP ${status})`)
  return new McpError(`o servidor respondeu HTTP ${status}`)
}

/** "Streamable HTTP": cada mensagem num `POST`; a resposta em JSON ou num fluxo SSE com a resposta de mesmo id. */
function streamableChannel(url: URL, headers: Readonly<Record<string, string>>, signal: AbortSignal): Channel {
  let next = 0
  let session: string | null = null
  let protocol: string | null = null
  const post = async (message: { id?: number }): Promise<unknown> => {
    const response = await send(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
        ...(protocol ? { 'mcp-protocol-version': protocol } : {}),
      },
      body: JSON.stringify(message),
      signal,
    })
    const status = response.statusCode ?? 0
    const sessionHeader = response.headers['mcp-session-id']
    if (typeof sessionHeader === 'string' && sessionHeader.length <= 200) session = sessionHeader
    if (message.id === undefined) {
      response.resume()
      if (status >= 400) throw statusError(status)
      return undefined
    }
    if (status < 200 || status >= 300) {
      response.resume()
      throw statusError(status)
    }
    const type = String(response.headers['content-type'] ?? '')
    if (type.includes('text/event-stream')) {
      return new Promise((resolve, reject) => {
        onSseEvents(
          response,
          (_event, data) => {
            let parsed: unknown
            try {
              parsed = JSON.parse(data)
            } catch {
              return
            }
            if (!isResponse(parsed) || parsed.id !== message.id) return
            response.destroy()
            if (parsed.error) reject(rpcError(parsed))
            else resolve(parsed.result)
          },
          reject,
        )
        response.on('end', () => reject(new McpError('o servidor fechou o fluxo sem responder')))
      })
    }
    const body = await readBody(response)
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new McpError('o servidor não respondeu em JSON')
    }
    if (!isResponse(parsed)) throw new McpError('resposta fora do protocolo MCP')
    if (parsed.error) throw rpcError(parsed)
    return parsed.result
  }
  return {
    request: async (method, params) => {
      const result = await post({ jsonrpc: '2.0', id: ++next, method, params } as { id: number })
      if (method === 'initialize') {
        const version = (result as { protocolVersion?: unknown } | null)?.protocolVersion
        protocol = typeof version === 'string' && version.length <= 40 ? version : MCP_PROTOCOL_VERSION
      }
      return result
    },
    notify: async (method, params) => {
      await post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) } as { id?: number })
    },
    close: () => undefined,
  }
}

/** SSE (o transporte antigo): o fluxo do `GET` manda o endereço de envio e, depois, as respostas. */
async function sseChannel(url: URL, headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<Channel> {
  const stream = await send(url, { method: 'GET', headers: { ...headers, accept: 'text/event-stream' }, signal })
  const status = stream.statusCode ?? 0
  if (status < 200 || status >= 300) {
    stream.resume()
    throw statusError(status)
  }
  let next = 0
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let endpoint: URL | null = null
  let gotEndpoint: (url: URL) => void = () => undefined
  let failEndpoint: (error: Error) => void = () => undefined
  const endpointReady = new Promise<URL>((resolve, reject) => {
    gotEndpoint = resolve
    failEndpoint = reject
  })
  const fail = (error: Error): void => {
    failEndpoint(error)
    for (const pending of waiting.values()) pending.reject(error)
    waiting.clear()
  }
  onSseEvents(
    stream,
    (event, data) => {
      if (event === 'endpoint' && !endpoint) {
        let target: URL
        try {
          target = new URL(data.trim(), url)
        } catch {
          fail(new McpError('o servidor mandou um endereço de envio inválido'))
          return
        }
        // O endereço de envio fica na mesma origem: o servidor não manda o app para outro lugar.
        if (target.origin !== url.origin) {
          fail(new McpError('o servidor mandou um endereço de envio de outra origem'))
          return
        }
        endpoint = target
        gotEndpoint(target)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        return
      }
      if (!isResponse(parsed)) return
      const pending = waiting.get(parsed.id)
      if (!pending) return
      waiting.delete(parsed.id)
      if (parsed.error) pending.reject(rpcError(parsed))
      else pending.resolve(parsed.result)
    },
    fail,
  )
  stream.on('end', () => fail(new McpError('o servidor fechou o fluxo')))
  const target = await endpointReady
  const post = async (message: unknown): Promise<void> => {
    const response = await send(target, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(message), signal })
    response.resume()
    const code = response.statusCode ?? 0
    if (code < 200 || code >= 300) throw statusError(code)
  }
  return {
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++next
        waiting.set(id, { resolve, reject })
        post({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
          waiting.delete(id)
          reject(error instanceof Error ? error : new McpError(String(error)))
        })
      }),
    notify: (method, params) => post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }),
    close: () => stream.destroy(),
  }
}

/** Testa o servidor. Nunca rejeita: falha vira `{ ok: false, error }` com o motivo curto. */
export async function testMcpServer(definition: McpConnectDefinition, options: McpTestOptions): Promise<McpTestResult> {
  const timeoutMs = options.timeoutMs ?? MCP_TEST_TIMEOUT_MS
  const abort = new AbortController()
  let child: ChildProcess | null = null
  let channel: Channel | null = null
  let failExit: (reason: string) => void = () => undefined
  const exited = new Promise<never>((_resolve, reject) => {
    failExit = (reason) => reject(new McpError(reason))
  })
  exited.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new McpError(`sem resposta em ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)
  })
  timeout.catch(() => undefined)
  try {
    const work = (async (): Promise<McpToolInfo[]> => {
      if (definition.transport === 'stdio') {
        if (!definition.command) throw new McpError('falta o comando')
        const spawnMcp = options.spawn ?? nodeSpawnMcp
        child = spawnMcp(definition.command, definition.args, { ...(definition.cwd ? { cwd: definition.cwd } : {}), env: mcpProcessEnv(definition.env, options.path, options.baseEnv) })
        child.on('error', () => failExit('o comando não abriu'))
        child.on('exit', (code) => failExit(`o processo saiu antes de responder${typeof code === 'number' ? ` (código ${code})` : ''}`))
        channel = stdioChannel(child, failExit)
      } else {
        if (!definition.url || !mcpUrlAllowed(definition.url)) throw new McpError('endereço não permitido')
        const url = new URL(definition.url)
        channel = definition.transport === 'sse' ? await sseChannel(url, definition.headers, abort.signal) : streamableChannel(url, definition.headers, abort.signal)
      }
      return handshake(channel)
    })()
    const tools = await Promise.race([work, exited, timeout])
    return { ok: true, tools }
  } catch (error) {
    return { ok: false, error: error instanceof McpError ? error.message : 'falha na conexão' }
  } finally {
    if (timer !== null) clearTimeout(timer)
    const opened = channel as Channel | null
    opened?.close()
    abort.abort()
    const running = child as ChildProcess | null
    if (running) stopChild(running)
  }
}

/** Fecha o stdin, `SIGTERM` e, se não sair em 2 s, `SIGKILL`. */
function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    child.stdin?.end()
  } catch {
    // já fechado
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // já saiu
  }
  const killer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS)
  killer.unref()
  child.once('exit', () => clearTimeout(killer))
}
