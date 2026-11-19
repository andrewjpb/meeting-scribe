// Contrato 57 (devolução): a sessão com conector do claude.ai abre sem o modo estrito, e o bloqueio por prefixo só
// alcança os nomes que o app conhecia antes de abrir. Por isso, depois do `session/new`, o app confere o que a SESSÃO
// carregou pelo `/mcp` do adaptador (comando local: o `claude` responde sem chamar o modelo; o adaptador 0.107.0 troca a
// resposta pela lista de `mcpServerStatus`, em `dist/mcp-command.js`, `formatMcpStatus`). Os conectores sobem depois do
// `session/new`, sem bloquear a sessão: a conferência espera os ligados ficarem "Connected" (até 8 s).
//
// Formato do adaptador 0.107.0: "**MCP servers:** N (…)", depois um bloco por estado ("**Failed**", "**Needs
// authentication**", "**Connecting**", "**Connected**" ou o nome de um estado novo) com uma linha "- `nome`…" por servidor,
// e "**Disabled:** `a`, `b`" no fim; sem nenhum, "No MCP servers are configured.". Tudo o que vem daqui é dado.
import { CLAUDE_CONNECTOR_PREFIX, claudeConnectorToolServer, mcpToolServerName } from '../../shared/mcp'
import type { AcpConnector } from './profiles/types'

/** Quanto a sessão espera os conectores ligados conectarem antes da primeira pergunta. */
export const CONNECTOR_WAIT_MS = 8_000
/** Intervalo entre duas consultas ao `/mcp` nessa espera. */
export const CONNECTOR_POLL_MS = 400

/** Um servidor que a sessão carregou, com o estado que o adaptador mostra (`connected`, `needs-auth`, `pending`…). */
export interface McpStatusEntry {
  name: string
  status: string
}

const GROUPS: Readonly<Record<string, string>> = { Failed: 'failed', 'Needs authentication': 'needs-auth', Connecting: 'pending', Connected: 'connected' }

/** Os nomes em `code spans` de uma linha, como o adaptador os escreve (cerca de crases mais longa que o nome). */
function codeSpans(line: string): string[] {
  const names: string[] = []
  let at = 0
  while (at < line.length) {
    const open = line.indexOf('`', at)
    if (open < 0) break
    let fence = open
    while (line[fence] === '`') fence++
    const size = fence - open
    let close = line.indexOf('`'.repeat(size), fence)
    // A cerca de fecho tem o mesmo tamanho, sem crase colada depois.
    while (close >= 0 && line[close + size] === '`') close = line.indexOf('`'.repeat(size), close + size + 1)
    if (close < 0) break
    let name = line.slice(fence, close)
    if (name.length >= 2 && name.startsWith(' ') && name.endsWith(' ')) name = name.slice(1, -1)
    names.push(name)
    at = close + size
  }
  return names
}

/** A resposta do `/mcp` em servidores e estados; `null` se não é a lista do adaptador. */
export function parseMcpStatus(markdown: string): McpStatusEntry[] | null {
  const text = markdown.trim()
  if (text === 'No MCP servers are configured.') return []
  if (!text.startsWith('**MCP servers:**')) return null
  const entries: McpStatusEntry[] = []
  let group: string | null = null
  for (const line of text.split('\n').slice(1)) {
    const disabled = /^\*\*Disabled:\*\* (.*)$/.exec(line)
    if (disabled) {
      for (const name of codeSpans(disabled[1] ?? '')) entries.push({ name, status: 'disabled' })
      group = null
      continue
    }
    const title = /^\*\*([^*]+)\*\*$/.exec(line)
    if (title) {
      group = GROUPS[title[1] ?? ''] ?? (title[1] ?? '').toLowerCase()
      continue
    }
    if (group && line.startsWith('- ')) {
      const [name] = codeSpans(line.slice(2))
      if (name !== undefined && name !== '') entries.push({ name, status: group })
    }
  }
  return entries
}

/** O servidor como o `claude` o põe no nome das ferramentas (`claude.ai Notion` → `claude_ai_Notion`). */
export function statusToolServer(name: string): string {
  return name.startsWith(CLAUDE_CONNECTOR_PREFIX) ? claudeConnectorToolServer(name.slice(CLAUDE_CONNECTOR_PREFIX.length)) : mcpToolServerName(name)
}

/** Os servidores que o `session/new` bloqueou inteiros (`mcp__<servidor>` em `disallowedTools`). */
export function blockedServersOf(disallowedTools: readonly string[]): Set<string> {
  const servers = new Set<string>()
  for (const rule of disallowedTools) {
    const match = /^mcp__([A-Za-z0-9_-]+)$/.exec(rule)
    if (match?.[1] && !match[1].includes('__')) servers.add(match[1])
  }
  return servers
}

/** O que a conferência achou: os ligados que ainda não conectaram e os servidores que escaparam do bloqueio. */
export interface ConnectorVerdict {
  /** Ligados que não ficaram "Connected" a tempo. */
  pending: AcpConnector[]
  /** Servidores carregados que não são do app nem estão bloqueados, pelo nome no nome das ferramentas. */
  surprises: string[]
}

/**
 * Confere a lista da sessão. Vale: um conector ligado, um servidor que o app passou (`passed`, pelo nome do `session/new`)
 * ou um servidor bloqueado inteiro. O resto escapou; um nome com `__` escapa sempre (a regra `mcp__a__b` do `claude` é
 * lida como a ferramenta `b` do servidor `a` e não bloqueia o servidor). Desligado (`disabled`) não tem ferramentas.
 */
export function connectorVerdict(entries: readonly McpStatusEntry[], enabled: readonly AcpConnector[], passed: ReadonlySet<string>, blocked: ReadonlySet<string>): ConnectorVerdict {
  const labels = new Set(enabled.map((connector) => connector.label))
  const surprises = new Set<string>()
  for (const entry of entries) {
    if (entry.status === 'disabled' || labels.has(entry.name) || passed.has(entry.name)) continue
    const server = statusToolServer(entry.name)
    if (server.includes('__') || !blocked.has(server)) surprises.add(server)
  }
  const pending = enabled.filter((connector) => entries.find((entry) => entry.name === connector.label)?.status !== 'connected')
  return { pending, surprises: [...surprises] }
}

/** A espera acabou para este conector? (conectado, ou num estado que não muda sozinho). */
export function connectorSettled(entries: readonly McpStatusEntry[], connector: AcpConnector): boolean {
  const status = entries.find((entry) => entry.name === connector.label)?.status
  return status === 'connected' || status === 'needs-auth' || status === 'failed' || status === 'disabled'
}
