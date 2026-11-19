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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Objeto JSON de um texto: inteiro, ou do primeiro `{` ao último `}` (com espaço ou um prefixo antes). */
function objectIn(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown
    } catch {
      return null
    }
  }
}

/**
 * Os dados de uma ferramenta do navegador a partir do texto do resultado, como chegou ao `tool_call_update`: o JSON do
 * servidor MCP puro, com espaço ou prefixo antes, ou embrulhado nos blocos do MCP (`[{"type":"text","text":"{…}"}]`).
 * `null` se nada casar. Só para o rótulo do passo: o que sai daqui nunca é instrução.
 */
export function navegadorDadosOf(output: unknown): Record<string, unknown> | null {
  if (typeof output !== 'string') return null
  let value = objectIn(output)
  if (Array.isArray(value)) {
    const block = value.find((item): item is { text: string } => isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string')
    value = block ? objectIn(block.text) : null
  }
  if (isRecord(value) && value['type'] === 'text' && typeof value['text'] === 'string') value = objectIn(value['text'])
  return isRecord(value) ? value : null
}

/** Número da aba no resultado (`{"aba":2,…}`); `null` sem ele. */
export function navegadorAbaOf(output: unknown): number | null {
  const aba = navegadorDadosOf(output)?.['aba']
  return typeof aba === 'number' && Number.isInteger(aba) && aba > 0 ? aba : null
}

/** Rótulo do elemento no resultado de `clicar` e `digitar`, numa linha e curto; `null` sem ele. */
export function navegadorRotuloOf(output: unknown): string | null {
  const rotulo = navegadorDadosOf(output)?.['rotulo']
  if (typeof rotulo !== 'string') return null
  const line = rotulo.replace(/\s+/g, ' ').trim()
  return line ? line.slice(0, 80) : null
}
