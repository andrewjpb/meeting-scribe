// Contrato 47 (plugin-navegador): o navegador nas sessões do Assistente, no molde de `web.ts`. As 7 ferramentas
// chegam ao agente pelo servidor MCP local `navegador` (`navegador/mcp.ts`), com o nome que o Claude Code dá a uma
// ferramenta MCP: `mcp__navegador__<ferramenta>`. Só a sessão do chat com as ferramentas de leitura que pediu o
// navegador recebe o servidor; nela, as 7 passam sem perguntar (padrão do app: sem diálogo de confirmação). Fora dela,
// um nome igual é negado como qualquer outra ferramenta.
import { isNavegadorFerramenta, NAVEGADOR_FERRAMENTAS, type NavegadorFerramenta } from '../../shared/navegador-ferramentas'
import type { AcpSessionRequest, KnownToolCall } from './profiles/types'

/** Nome do servidor MCP no `session/new` (e no meio do nome das ferramentas). */
export const NAVEGADOR_MCP_SERVER = 'navegador'
/** Começo do nome de cada ferramenta do servidor, como o Claude Code monta. */
export const NAVEGADOR_MCP_PREFIX = `mcp__${NAVEGADOR_MCP_SERVER}__`
/** As 7 com o nome completo, para `allowedTools` e `settings.permissions.allow`. */
export const NAVEGADOR_MCP_TOOLS: readonly string[] = NAVEGADOR_FERRAMENTAS.map((tool) => `${NAVEGADOR_MCP_PREFIX}${tool}`)

/** A sessão pede o navegador e pode ter: só o chat com as ferramentas de leitura. */
export function navegadorRequested(request: Pick<AcpSessionRequest, 'navegador' | 'purpose' | 'tools'>): boolean {
  return request.navegador === true && request.purpose === 'chat' && request.tools === 'read'
}

/** É uma ferramenta do navegador? Pelo nome que o adaptador manda (`mcp__navegador__navegador_abrir`). */
export function navegadorToolOf(call: Pick<KnownToolCall, 'name'>): NavegadorFerramenta | null {
  if (!call.name?.startsWith(NAVEGADOR_MCP_PREFIX)) return null
  const tool = call.name.slice(NAVEGADOR_MCP_PREFIX.length)
  return isNavegadorFerramenta(tool) ? tool : null
}

/** Número da aba no começo do resultado (`{"aba":2,…}`, como o servidor MCP escreve); `null` sem ele. */
export function navegadorAbaOf(output: unknown): number | null {
  if (typeof output !== 'string') return null
  const match = /^\{"aba":(\d{1,9})[,}]/.exec(output)
  return match ? Number(match[1]) : null
}
