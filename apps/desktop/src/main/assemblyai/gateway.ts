// Cliente do LLM Gateway da AssemblyAI (`llm-gateway.assemblyai.com`), só no main: catálogo de modelos,
// validação da chave, conferência de modelo liberado e a chamada de chat que a tradução avulsa reaproveita.
// `fetch` chega injetado (os testes e o smoke usam fixtures; o app usa `net.fetch`). Todo erro sai como
// `GatewayError` tipado; nada aqui derruba o main.
//
// Comportamento real conferido em 14/11/2026 (docs/fase0.md, teste 12, e as fixtures em test/fixtures):
// - `GET /v1/models` é público: responde 200 com qualquer chave ou sem chave. Não serve para validar.
// - `POST /v1/chat/completions` autentica antes de validar o corpo: chave inválida dá 401
//   (`{"error":"Authentication error, API token missing/invalid",...}`); chave válida com corpo vazio
//   dá 400 `{"message":"invalid request body",...}` sem gerar nenhum token. É essa a validação gratuita
//   da chave (comportamento não documentado pela AssemblyAI: pode mudar).
// - Modelo não liberado na conta: 400 com `metadata.errors` contendo
//   "Your account does not have access to this LLM Gateway model".
import type { CatalogModel } from '../../shared/assemblyai'

export const GATEWAY_BASE_URL = 'https://llm-gateway.assemblyai.com/v1'
export const GATEWAY_TIMEOUT_MS = 10_000
export const CATALOG_CACHE_MS = 10 * 60_000
/** Chamada mínima de conferência de modelo (o contrato aceita até 8). */
export const MODEL_CHECK_MAX_TOKENS = 1

export interface FetchInit {
  method: 'GET' | 'POST'
  headers: Record<string, string>
  /** Contrato 37: o upload do áudio para a transcrição vai em bytes. */
  body?: string | Uint8Array
  signal: AbortSignal
  /** Sempre `error`: o cabeçalho `authorization` nunca segue um redirecionamento para outro lugar. */
  redirect: 'error'
}

export interface FetchResponse {
  status: number
  text(): Promise<string>
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>

export type GatewayErrorKind = 'network' | 'timeout' | 'unauthorized' | 'not-allowed' | 'bad-request' | 'server' | 'format'

export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export interface ChatResult {
  model: string
  content: string
}

export type KeyValidation = 'valid' | 'refused' | 'unverified'

export interface GatewayClient {
  /** Catálogo com cache de 10 min. Sem chave, lista mesmo assim (o endpoint é público). */
  listModels(): Promise<CatalogModel[]>
  /** Valida uma chave ainda não salva. Nunca lança. */
  validateKey(key: string): Promise<KeyValidation>
  /** Chat completo; lança `GatewayError`. */
  chat(request: ChatRequest, key?: string): Promise<ChatResult>
  /** Esquece o catálogo guardado (chave trocada ou removida). */
  clearCache(): void
}

export interface GatewayOptions {
  fetch: FetchLike
  /** Chave atual (do `SecretStore`); `null` sem chave. */
  getApiKey: () => string | null
  now?: () => number
  timeoutMs?: number
  cacheMs?: number
  baseUrl?: string
}

const NOT_ALLOWED = 'does not have access to this LLM Gateway model'
/** `message` do 400 que o gateway devolve para corpo inválido, já depois de aceitar a chave. */
const INVALID_BODY = 'invalid request body'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const price = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/**
 * `pricing` real: `{"global": {"prompt": 0.1, "completions": 0.5, "input_cache_read": ...},
 * "us": {...}, "eu": {...}, "regional_increase_percent": 0.1}`, já em US$ por 1M de tokens. Vale o
 * `global`; sem ele, a primeira região com preço.
 */
function pricesOf(pricing: unknown): { promptPerM: number | null; completionPerM: number | null } {
  if (!isRecord(pricing)) return { promptPerM: null, completionPerM: null }
  const tiers = [pricing['global'], ...Object.values(pricing)].filter(isRecord)
  const tier = tiers.find((t) => price(t['prompt']) !== null || price(t['completions']) !== null)
  return { promptPerM: price(tier?.['prompt']), completionPerM: price(tier?.['completions']) }
}

/** Resposta de `GET /v1/models` -> modelos. Item sem `id` é descartado; o resto vira `null`. */
export function parseModels(body: unknown): CatalogModel[] {
  const data = isRecord(body) ? body['data'] : undefined
  if (!Array.isArray(data)) throw new GatewayError('format', 'catálogo em formato inesperado')
  const models: CatalogModel[] = []
  const seen = new Set<string>()
  for (const item of data) {
    if (!isRecord(item)) continue
    const id = typeof item['id'] === 'string' ? item['id'].trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof item['name'] === 'string' && item['name'].trim() ? item['name'].trim() : id
    const context = item['context_length']
    models.push({
      id,
      name,
      contextLength: typeof context === 'number' && Number.isFinite(context) && context > 0 ? context : null,
      ...pricesOf(item['pricing']),
    })
  }
  return models
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Mensagens de erro do corpo: `metadata.errors[]`, `error` e `message`. */
export function errorMessages(body: unknown): string[] {
  if (!isRecord(body)) return []
  const messages: string[] = []
  const metadata = body['metadata']
  if (isRecord(metadata) && Array.isArray(metadata['errors'])) messages.push(...metadata['errors'].filter((e): e is string => typeof e === 'string'))
  for (const key of ['error', 'message'] as const) if (typeof body[key] === 'string') messages.push(body[key])
  return messages
}

export function createGatewayClient({
  fetch,
  getApiKey,
  now = Date.now,
  timeoutMs = GATEWAY_TIMEOUT_MS,
  cacheMs = CATALOG_CACHE_MS,
  baseUrl = GATEWAY_BASE_URL,
}: GatewayOptions): GatewayClient {
  let cache: { at: number; models: CatalogModel[] } | null = null
  let pending: Promise<CatalogModel[]> | null = null

  async function request(path: string, init: Omit<FetchInit, 'signal' | 'redirect'>): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...init, redirect: 'error', signal: controller.signal })
      const text = await response.text()
      return { status: response.status, body: parseJson(text) }
    } catch {
      // A mensagem original pode trazer a URL ou cabeçalhos; não é repassada.
      throw timedOut ? new GatewayError('timeout', `sem resposta em ${timeoutMs / 1000} s`) : new GatewayError('network', 'falha de rede')
    } finally {
      clearTimeout(timer)
    }
  }

  const headers = (key: string | null, json = false): Record<string, string> => ({
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(key ? { authorization: key } : {}),
  })

  function failure(status: number, body: unknown): GatewayError {
    const messages = errorMessages(body)
    if (status === 401 || status === 403) return new GatewayError('unauthorized', 'chave recusada pela AssemblyAI', status)
    if (status === 400 && messages.some((m) => m.includes(NOT_ALLOWED))) return new GatewayError('not-allowed', 'modelo não liberado na conta', status)
    if (status >= 400 && status < 500) return new GatewayError('bad-request', messages[0] ?? `resposta ${status}`, status)
    return new GatewayError('server', `resposta ${status}`, status)
  }

  async function fetchModels(): Promise<CatalogModel[]> {
    const { status, body } = await request('/models', { method: 'GET', headers: headers(getApiKey()) })
    if (status !== 200) throw failure(status, body)
    return parseModels(body)
  }

  return {
    async listModels() {
      if (cache && now() - cache.at < cacheMs) return cache.models
      // Duas telas pedindo ao mesmo tempo dividem a mesma requisição.
      pending ??= fetchModels()
        .then((models) => {
          cache = { at: now(), models }
          return models
        })
        .finally(() => {
          pending = null
        })
      return pending
    },

    async validateKey(key) {
      try {
        // Corpo vazio de propósito: com chave válida o gateway responde 400 "invalid request body" sem
        // gerar token nenhum. Qualquer outro 400 (ou 404, 422, 429, 5xx) não prova nada: não verificada.
        const { status, body } = await request('/chat/completions', { method: 'POST', headers: headers(key, true), body: '{}' })
        if (status === 401 || status === 403) return 'refused'
        if (status >= 200 && status < 300) return 'valid'
        if (status === 400 && isRecord(body) && body['message'] === INVALID_BODY) return 'valid'
        return 'unverified'
      } catch {
        return 'unverified'
      }
    },

    async chat({ model, messages, maxTokens, temperature }, key) {
      const auth = key ?? getApiKey()
      if (!auth) throw new GatewayError('unauthorized', 'nenhuma chave configurada')
      const payload = { model, messages, ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}), ...(temperature !== undefined ? { temperature } : {}) }
      const { status, body } = await request('/chat/completions', { method: 'POST', headers: headers(auth, true), body: JSON.stringify(payload) })
      if (status !== 200) throw failure(status, body)
      const choices = isRecord(body) && Array.isArray(body['choices']) ? body['choices'] : []
      const message = isRecord(choices[0]) && isRecord(choices[0]['message']) ? choices[0]['message'] : null
      const content = message && typeof message['content'] === 'string' ? message['content'] : ''
      return { model: isRecord(body) && typeof body['model'] === 'string' ? body['model'] : model, content }
    },

    clearCache() {
      cache = null
    },
  }
}

/** Conferência de modelo ao escolher: chamada mínima de chat. */
export async function checkModelAccess(client: GatewayClient, model: string): Promise<'available' | 'not-allowed' | 'refused' | 'network' | 'server'> {
  try {
    await client.chat({ model, messages: [{ role: 'user', content: 'ok' }], maxTokens: MODEL_CHECK_MAX_TOKENS })
    return 'available'
  } catch (error) {
    if (!(error instanceof GatewayError)) return 'server'
    if (error.kind === 'not-allowed') return 'not-allowed'
    if (error.kind === 'unauthorized') return 'refused'
    if (error.kind === 'network' || error.kind === 'timeout') return 'network'
    return 'server'
  }
}
