// Contrato 58 (CA3): as ferramentas de um conector do claude.ai, para "Ver ferramentas". O app não tem a definição nem o
// login do conector, e nem `claude mcp get` nem o `/mcp` do adaptador dão os nomes (só o estado e a contagem). Quem tem a
// lista é o `mcpServerStatus` do próprio `claude`: o app abre o `claude` no modo de controle (`--input-format
// stream-json`), manda `initialize` e pede `mcp_status` até o conector sair de "pending". Nenhuma mensagem vai ao modelo
// (sem pergunta não há chamada) e o processo morre logo depois. O ambiente é o de `claudeEnv`, sem nada do app.
//
// Formato do Claude Code 2.1.325 (conferido em 19/11/2026): a resposta do controle é `{ type: "control_response",
// response: { request_id, subtype: "success", response: { mcpServers: [{ name: "claude.ai Notion", status, tools:
// [{ name, annotations }] }] } } }`; logo depois do `initialize` a lista vem vazia, e os conectores aparecem "pending" e
// conectam em 1 s a 13 s. Tudo o que vem daqui é dado: passa por `mcpText` e pelos limites de tamanho.
import { CLAUDE_CONNECTOR_PREFIX, MCP_TOOL_DESCRIPTION_MAX, MCP_TOOL_NAME_MAX, MCP_TOOLS_MAX, mcpText, type McpToolInfo } from '../../shared/mcp'
import type { SpawnSummary } from '../claude-cli/summary'
import { KILL_GRACE_MS, type Timers } from '../claude-cli/translator'

/** Quanto a leitura espera o conector conectar. */
export const CONNECTOR_TOOLS_TIMEOUT_MS = 20_000
/** Intervalo entre duas perguntas `mcp_status`. */
export const CONNECTOR_TOOLS_POLL_MS = 500
/** Linha do stdout sem quebra acima disto é descartada. */
const MAX_LINE_CHARS = 4_000_000

/** Argumentos do modo de controle: sem as configurações da pessoa, sem sessão gravada, no modo de permissão padrão. */
export const CONNECTOR_TOOLS_ARGS: readonly string[] = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--restricted', '--no-session-persistence', '--permission-mode', 'default']

/** Um conector como o `mcpServerStatus` o mostra: o nome depois de `claude.ai `, o estado e as ferramentas. */
export interface ConnectorStatus {
  name: string
  status: string
  tools: McpToolInfo[]
}

/** A resposta de `mcp_status` em conectores; `null` se não é ela. Servidor que não é conector fica de fora. */
export function connectorStatusesOf(response: unknown): ConnectorStatus[] | null {
  if (typeof response !== 'object' || response === null) return null
  const servers = (response as { mcpServers?: unknown }).mcpServers
  if (!Array.isArray(servers)) return null
  const connectors: ConnectorStatus[] = []
  for (const server of servers.slice(0, 500)) {
    if (typeof server !== 'object' || server === null) continue
    const { name, status, tools } = server as { name?: unknown; status?: unknown; tools?: unknown }
    if (typeof name !== 'string' || !name.startsWith(CLAUDE_CONNECTOR_PREFIX) || typeof status !== 'string') continue
    const list: McpToolInfo[] = []
    for (const tool of Array.isArray(tools) ? tools : []) {
      if (list.length >= MCP_TOOLS_MAX) break
      if (typeof tool !== 'object' || tool === null) continue
      const toolName = mcpText((tool as { name?: unknown }).name, MCP_TOOL_NAME_MAX)
      if (!toolName || toolName.endsWith('…') || list.some((known) => known.name === toolName)) continue
      list.push({ name: toolName, description: mcpText((tool as { description?: unknown }).description, MCP_TOOL_DESCRIPTION_MAX) })
    }
    connectors.push({ name: name.slice(CLAUDE_CONNECTOR_PREFIX.length), status, tools: list })
  }
  return connectors
}

export interface ReadConnectorToolsOptions {
  spawn: SpawnSummary
  claudePath: string
  env: NodeJS.ProcessEnv
  cwd: string
  /**
   * Os conectores que a tela pediu: a leitura termina quando todos saem de "pending" (ou o prazo acaba). O conjunto pode
   * crescer durante a leitura: um pedido que chega depois espera a mesma leitura.
   */
  names: ReadonlySet<string>
  timeoutMs?: number
  pollMs?: number
  timers?: Timers
}

/**
 * Lê os conectores do `mcpServerStatus`. Devolve o último retrato (com o pedido já conectado, ou o que havia quando o
 * tempo acabou); lança erro se o `claude` não respondeu ao controle.
 */
export function readConnectorTools(options: ReadConnectorToolsOptions): Promise<ConnectorStatus[]> {
  const timers: Timers = options.timers ?? { setTimeout: (handler, ms) => setTimeout(handler, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) }
  const child = options.spawn(options.claudePath, CONNECTOR_TOOLS_ARGS, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
  return new Promise<ConnectorStatus[]>((resolve, reject) => {
    let last: ConnectorStatus[] | null = null
    let buffer = ''
    let asked = 0
    let finished = false
    let poll: unknown = null
    const send = (request: Record<string, unknown>): void => {
      asked += 1
      child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: `scribe-${asked}`, request })}\n`)
    }
    const finish = (error: Error | null): void => {
      if (finished) return
      finished = true
      timers.clearTimeout(deadline)
      if (poll !== null) timers.clearTimeout(poll)
      child.stdin?.end()
      child.kill('SIGTERM')
      const kill = timers.setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      child.on('close', () => timers.clearTimeout(kill))
      if (error && !last) reject(error)
      else resolve(last ?? [])
    }
    const deadline = timers.setTimeout(() => finish(new Error('o claude não respondeu a tempo')), options.timeoutMs ?? CONNECTOR_TOOLS_TIMEOUT_MS)
    const onLine = (line: string): void => {
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'control_response') return
      const response = (message as { response?: { request_id?: unknown; subtype?: unknown; response?: unknown } }).response
      if (!response || response.subtype !== 'success') {
        finish(new Error('o claude recusou o pedido'))
        return
      }
      if (response.request_id === 'scribe-1') {
        send({ subtype: 'mcp_status' })
        return
      }
      const statuses = connectorStatusesOf(response.response)
      if (statuses) last = statuses
      const settled = [...options.names].every((name) => {
        const status = statuses?.find((entry) => entry.name === name)?.status
        return status !== undefined && status !== 'pending'
      })
      if (statuses && settled) {
        finish(null)
        return
      }
      poll = timers.setTimeout(() => {
        poll = null
        if (!finished) send({ subtype: 'mcp_status' })
      }, options.pollMs ?? CONNECTOR_TOOLS_POLL_MS)
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      buffer += chunk
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        if (line.trim()) onLine(line)
        at = buffer.indexOf('\n')
      }
      if (buffer.length > MAX_LINE_CHARS) buffer = ''
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', () => undefined)
    child.stdin?.on('error', () => undefined)
    child.on('error', (error) => finish(error))
    child.on('close', () => finish(new Error('o claude saiu antes de responder')))
    send({ subtype: 'initialize' })
  })
}
