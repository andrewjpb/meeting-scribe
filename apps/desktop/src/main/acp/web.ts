// Internet nas sessões do chat (contrato 26, CA3): a busca é livre (com limite), mas uma página só abre se o
// endereço veio de um resultado de busca da mesma sessão ou do texto que a pessoa digitou. O risco tratado: o agente
// lê reuniões e WhatsApp, e uma página lida poderia mandá-lo "abrir" um endereço com esses dados na URL. Um endereço
// montado pelo modelo nunca aparece numa das duas listas, então nunca abre.
//
// Os endereços vistos valem só na execução (um `session/prompt`) e saem só dos resultados das chamadas de `WebSearch`:
// os hits estruturados (`_meta.claudeCode.toolResponse.results[].content[]`, com título e endereço) ou, sem eles, as
// linhas exatas "Título (url)" do adaptador. O resumo em texto livre da busca nunca entra (ele pode repetir o que o
// modelo pôs na consulta), e todo endereço que aparece numa consulta de busca da sessão é descartado, mesmo
// reformatado ou em parte. As contas (buscas e páginas) e os vistos recomeçam a cada `session/prompt`.
import { urlsIn } from '../../shared/web-urls'
import type { KnownToolCall } from './profiles/types'

export { urlsIn } from '../../shared/web-urls'

/** Buscas por execução; a 11ª é negada. */
export const WEB_SEARCH_MAX = 10
/** Páginas abertas por execução; a 16ª é negada. */
export const WEB_FETCH_MAX = 15
/** Tamanho máximo de uma consulta. */
export const WEB_QUERY_MAX = 300
/** Endereços guardados por lista (o resto é ignorado). */
const WEB_URLS_MAX = 2_000
/** Hits lidos de um resultado de busca (o resto é ignorado). */
const SEARCH_HITS_MAX = 200
/** Consultas guardadas por sessão (para descartar o eco delas). */
const QUERIES_MAX = 500

export type WebTool = 'WebSearch' | 'WebFetch'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** É a busca ou a página da web? Pelo nome (o adaptador manda) ou, sem ele, pelo tipo `fetch` e o título. */
export function webToolOf(call: Pick<KnownToolCall, 'name' | 'kind' | 'title'>): WebTool | null {
  if (call.name === 'WebSearch' || call.name === 'WebFetch') return call.name
  if (call.name !== undefined || call.kind !== 'fetch') return null
  if (call.title?.startsWith('Search') || call.title === 'Web search') return 'WebSearch'
  if (call.title?.startsWith('Fetch')) return 'WebFetch'
  return null
}

/** Nome IPv4 com os quatro números, ou `null`. */
function ipv4(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every((part) => part <= 255) ? parts : null
}

const privateV4 = ([a = 0, b = 0, c = 0]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224

/**
 * Endereço da rede local: `localhost`, `.local`, nome sem ponto (só existe numa rede), IPv4 privado, de loopback, de
 * enlace, de testes de rede (192.0.0.0/24, 198.18.0.0/15) ou reservado, e IPv6 de loopback, local ou com um IPv4 dentro (`::ffff:…`). O `URL` já normalizou o nome
 * (`0x7f.1` vira `127.0.0.1`).
 */
export function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.includes(':')) return host.startsWith('::') || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('64:ff9b:')
  const v4 = ipv4(host)
  if (v4) return privateV4(v4)
  // Só números e pontos sem ser um IPv4 inteiro: nada que a busca devolva.
  if (/^[\d.]+$/.test(host)) return true
  return !host.includes('.')
}

/** O endereço que pode abrir (`http`/`https`, sem credencial, fora da rede local), já normalizado; `null` se não. */
export function fetchableUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 4_000) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (privateHost(url.hostname)) return null
  return url
}

/** Origem e caminho, sem a consulta e sem o `#`. */
const bareKey = (url: URL): string => `${url.protocol}//${url.host}${url.pathname}`
/** Origem, caminho e consulta, sem o `#`. */
const fullKey = (url: URL): string => `${bareKey(url)}${url.search}`

/**
 * Lista de endereços conhecidos. Um endereço vale se for igual a um da lista (origem, caminho e consulta, sem o `#`),
 * ou se não tiver consulta e a origem e o caminho forem os de um da lista (tirar a consulta não leva dado nenhum).
 * Uma consulta diferente nunca vale: é onde um dado vazaria.
 */
export class WebUrlList {
  private readonly full = new Set<string>()
  private readonly bare = new Set<string>()

  get size(): number {
    return this.full.size
  }

  add(raw: string): void {
    const url = fetchableUrl(raw)
    if (!url || this.full.size >= WEB_URLS_MAX) return
    this.full.add(fullKey(url))
    this.bare.add(bareKey(url))
  }

  has(url: URL): boolean {
    return this.full.has(fullKey(url)) || (url.search === '' && this.bare.has(bareKey(url)))
  }

  clear(): void {
    this.full.clear()
    this.bare.clear()
  }
}

/** Texto para comparar com uma consulta: minúsculas, sem `%xx`, sem o esquema e sem o `www.`. */
function echoText(text: string): string {
  let decoded = text
  try {
    decoded = decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    // `%` solto: fica como veio
  }
  return decoded
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/(^|[\s/"'(])www\./g, '$1')
    .replace(/\s+/g, ' ')
}

/**
 * O endereço aparece numa das consultas (escritas pelo modelo)? Inteiro ou sem a consulta, com ou sem o esquema, em
 * maiúsculas ou codificado; ou o domínio dele está na consulta junto com um pedaço do caminho ou da consulta dele
 * (eco parcial: "evil.example … SEGREDO").
 */
export function echoedInQueries(url: URL, queries: readonly string[]): boolean {
  if (!queries.length) return false
  const host = echoText(url.host)
  const full = echoText(`${url.host}${url.pathname}${url.search}`)
  const bare = echoText(`${url.host}${url.pathname}`)
  const pieces = [...url.searchParams.values(), ...url.pathname.split('/')].map(echoText).filter((piece) => piece.trim().length >= 4)
  return queries.some((query) => {
    const text = echoText(query)
    if (text.includes(full) || (url.pathname !== '/' && text.includes(bare))) return true
    return text.includes(host) && pieces.some((piece) => text.includes(piece))
  })
}

/** Linha exata do adaptador para um hit: "Título (https://…)". */
const HIT_LINE = /^(.*\S) \((https?:\/\/\S+)\)$/

/**
 * Endereços dos hits de uma busca. Primeiro os estruturados (`_meta.claudeCode.toolResponse.results[]`, cada um com
 * `content: [{ title, url }]`); sem eles, só as linhas exatas "Título (url)" do `content`. Texto livre (o resumo da
 * busca, o resultado bruto) nunca entra, nem o `rawInput`. Os que aparecem numa consulta da sessão são descartados.
 */
export function searchResultUrls(update: { content?: unknown; _meta?: unknown }, queries: readonly string[] = []): string[] {
  const urls: string[] = []
  const response = isRecord(update._meta) && isRecord(update._meta['claudeCode']) ? update._meta['claudeCode']['toolResponse'] : undefined
  const results = isRecord(response) && Array.isArray(response['results']) ? response['results'] : []
  for (const entry of results) {
    if (!isRecord(entry) || !Array.isArray(entry['content'])) continue
    for (const hit of entry['content']) if (isRecord(hit) && typeof hit['title'] === 'string' && typeof hit['url'] === 'string') urls.push(hit['url'])
  }
  if (!urls.length && Array.isArray(update.content)) {
    for (const block of update.content) {
      const inner = isRecord(block) && isRecord(block['content']) ? block['content'] : null
      if (inner?.['type'] !== 'text' || typeof inner['text'] !== 'string') continue
      for (const line of inner['text'].split('\n')) {
        const match = HIT_LINE.exec(line.trim())
        if (match?.[2]) urls.push(match[2])
      }
    }
  }
  return [
    ...new Set(
      urls.slice(0, SEARCH_HITS_MAX).filter((raw) => {
        const url = fetchableUrl(raw)
        return url !== null && !echoedInQueries(url, queries)
      }),
    ),
  ]
}

/** A internet de uma sessão: o que a pessoa digitou, o que a busca devolveu e as contas da execução em curso. */
export class AcpWebState {
  /** Endereços dos resultados de `WebSearch` desta execução. */
  readonly seen = new WebUrlList()
  /** Consultas de `WebSearch` da sessão inteira (um endereço que aparece numa delas nunca vale como visto). */
  readonly queries: string[] = []
  /** Endereços que a pessoa escreveu (pedido, perguntas da conversa, instruções do agente). */
  readonly typed = new WebUrlList()
  searches = 0
  pages = 0
  /** Chamadas que a política liberou (as outras não podem terminar como feitas). */
  readonly allowed = new Set<string>()

  /** Uma consulta de busca que o modelo escreveu (pedida ou só anunciada). */
  addQuery(query: unknown): void {
    if (typeof query !== 'string' || !query.trim() || this.queries.includes(query) || this.queries.length >= QUERIES_MAX) return
    this.queries.push(query)
  }

  /** Começo de um `session/prompt`: as contas e os vistos zeram e o texto da pessoa entra na lista. */
  begin(typedText: string): void {
    this.searches = 0
    this.pages = 0
    this.seen.clear()
    this.typed.clear()
    for (const url of urlsIn(typedText)) this.typed.add(url)
  }
}

/** O que a política decide para uma chamada da web: liberar, negar o endereço, negar pelo limite, ou negar a entrada. */
export type WebDecision = 'allow' | 'blocked' | 'limit' | 'invalid'

/**
 * Política da web (CA3), sem efeito: `WebSearch` passa com a consulta de 1 a 300 caracteres e até 10 buscas;
 * `WebFetch` passa com o endereço que pode abrir, digitado pela pessoa ou visto num resultado desta execução (e que
 * não aparece em nenhuma consulta da sessão), até 15 páginas. Quem conta é quem chama (`permissionAllowed`).
 */
export function webDecision(tool: WebTool, call: Pick<KnownToolCall, 'rawInput'>, web: AcpWebState): WebDecision {
  const input = isRecord(call.rawInput) ? call.rawInput : {}
  if (tool === 'WebSearch') {
    const query = input['query']
    if (typeof query !== 'string' || query.trim() === '' || query.length > WEB_QUERY_MAX) return 'invalid'
    return web.searches >= WEB_SEARCH_MAX ? 'limit' : 'allow'
  }
  const url = fetchableUrl(input['url'])
  if (!url || !(web.typed.has(url) || (web.seen.has(url) && !echoedInQueries(url, web.queries)))) return 'blocked'
  return web.pages >= WEB_FETCH_MAX ? 'limit' : 'allow'
}

/** Domínio para a tela: o nome sem o `www.`. */
export function webDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const host = new URL(raw).hostname
    return host ? host.replace(/^www\./, '') : null
  } catch {
    return null
  }
}
