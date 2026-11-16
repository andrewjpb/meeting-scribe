// Cliente do LLM Gateway com `fetch` injetado e as respostas reais gravadas em test/fixtures/assemblyai
// (14/11/2026): catálogo de `GET /v1/models` (sem o bloco `performance`, que o app não lê), 200 de chat,
// 400 de modelo não liberado, 401 de chave inválida e o 400 de corpo vazio com chave válida.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_CACHE_MS,
  checkModelAccess,
  createGatewayClient,
  GATEWAY_BASE_URL,
  GATEWAY_TIMEOUT_MS,
  GatewayError,
  parseModels,
  type FetchInit,
  type FetchLike,
} from '../src/main/assemblyai/gateway'

const fixture = (name: string): string => readFileSync(resolve(__dirname, 'fixtures/assemblyai', name), 'utf8')
const MODELS = fixture('models.json')
const CHAT_OK = fixture('chat-ok.json')
const NOT_ALLOWED = fixture('chat-model-not-allowed.json')
const AUTH_ERROR = fixture('auth-error.json')
const EMPTY_BODY = fixture('key-probe-empty-body.json')

const reply = (status: number, body: string) => Promise.resolve({ status, text: () => Promise.resolve(body) })
const networkError = (): Promise<never> => Promise.reject(new TypeError('fetch failed'))
/** Nunca responde; rejeita quando o pedido é abortado (como o `fetch` de verdade). */
const hang = (_url: string, init: FetchInit): Promise<never> =>
  new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))

describe('parseModels (CA6)', () => {
  const models = parseModels(JSON.parse(MODELS))

  it('lê os 60 modelos da resposta real', () => {
    expect(models).toHaveLength(60)
    expect(new Set(models.map((m) => m.id)).size).toBe(60)
  })

  it('cada modelo vira {id, name, contextLength, promptPerM, completionPerM} em US$ por 1M', () => {
    expect(models[0]).toEqual({ id: 'qwen3.5-4b-32k-fast', name: 'Qwen3.5 4B Fast', contextLength: 32768, promptPerM: 0.1, completionPerM: 0.5 })
    expect(models.find((m) => m.id === 'claude-haiku-5-5')).toEqual({ id: 'claude-haiku-5-5', name: 'Haiku 5.5', contextLength: 1_000_000, promptPerM: 0.1, completionPerM: 0.5 })
    // `pricing` com `us`, `eu` e `global`: vale o global.
    expect(models.find((m) => m.id === 'nemotron-3-nano-30b-a3b')).toMatchObject({ promptPerM: 0.06, completionPerM: 0.24 })
    for (const model of models) expect(Object.keys(model).sort()).toEqual(['completionPerM', 'contextLength', 'id', 'name', 'promptPerM'])
  })

  it('sem preço fixo, sem nome ou com contexto estranho: null ou o id', () => {
    const parsed = parseModels({
      data: [
        { id: 'variavel', name: 'Variável', context_length: 1000, pricing: { global: { prompt: -1, completions: -1 } } },
        { id: 'sem-preco', context_length: 'muito' },
        { id: 'regional', name: 'Regional', pricing: { regional_increase_percent: 0.1, us: { prompt: 0.2, completions: 0.4 } } },
        { name: 'sem id' },
        'lixo',
      ],
    })
    expect(parsed).toEqual([
      { id: 'variavel', name: 'Variável', contextLength: 1000, promptPerM: null, completionPerM: null },
      { id: 'sem-preco', name: 'sem-preco', contextLength: null, promptPerM: null, completionPerM: null },
      { id: 'regional', name: 'Regional', contextLength: null, promptPerM: 0.2, completionPerM: 0.4 },
    ])
  })

  it('formato inesperado vira erro tipado', () => {
    expect(() => parseModels({ models: [] })).toThrow(GatewayError)
    expect(() => parseModels(null)).toThrow(GatewayError)
  })
})

describe('createGatewayClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('catálogo: GET /v1/models com a chave, cache de 10 min (CA6)', async () => {
    let now = 0
    const fetch = vi.fn<FetchLike>(() => reply(200, MODELS))
    const client = createGatewayClient({ fetch, getApiKey: () => 'chave-x', now: () => now })
    const [a, b] = await Promise.all([client.listModels(), client.listModels()])
    expect(a).toHaveLength(60)
    expect(b).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GATEWAY_BASE_URL}/models`)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', headers: { authorization: 'chave-x' } })

    now = CATALOG_CACHE_MS - 1
    await client.listModels()
    expect(fetch).toHaveBeenCalledTimes(1)
    now = CATALOG_CACHE_MS
    await client.listModels()
    expect(fetch).toHaveBeenCalledTimes(2)
    client.clearCache()
    await client.listModels()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('catálogo: rede, tempo limite de 10 s e resposta ruim viram erro tipado, sem guardar no cache', async () => {
    const fetch = vi.fn<FetchLike>(networkError)
    const client = createGatewayClient({ fetch, getApiKey: () => null })
    await expect(client.listModels()).rejects.toMatchObject({ name: 'GatewayError', kind: 'network' })

    fetch.mockImplementation(hang)
    const pending = client.listModels()
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(GATEWAY_TIMEOUT_MS - 1)
    expect(fetch.mock.calls.at(-1)?.[1].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion

    fetch.mockImplementation(() => reply(503, 'indisponível'))
    await expect(client.listModels()).rejects.toMatchObject({ kind: 'server', status: 503 })
    fetch.mockImplementation(() => reply(200, '{"nada":1}'))
    await expect(client.listModels()).rejects.toMatchObject({ kind: 'format' })
    fetch.mockImplementation(() => reply(200, MODELS))
    await expect(client.listModels()).resolves.toHaveLength(60)
  })

  it('a mensagem do erro de rede não repassa o texto original (que pode ter cabeçalhos)', async () => {
    const client = createGatewayClient({ fetch: () => Promise.reject(new Error('authorization: segredo')), getApiKey: () => 'segredo' })
    const error = await client.listModels().catch((e: unknown) => e)
    expect(String((error as Error).message)).not.toContain('segredo')
  })

  it('validateKey: POST /v1/chat/completions com corpo {} e a chave no cabeçalho (CA4)', async () => {
    const fetch = vi.fn<FetchLike>(() => reply(400, EMPTY_BODY))
    const client = createGatewayClient({ fetch, getApiKey: () => null })
    expect(await client.validateKey('chave-nova')).toBe('valid')
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GATEWAY_BASE_URL}/chat/completions`)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{}', redirect: 'error', headers: { authorization: 'chave-nova' } })
  })

  it.each([
    ['2xx', 200, CHAT_OK, 'valid'],
    ['204', 204, '', 'valid'],
    ['400 "invalid request body" (corpo real)', 400, EMPTY_BODY, 'valid'],
    ['401 (corpo real)', 401, AUTH_ERROR, 'refused'],
    ['403', 403, AUTH_ERROR, 'refused'],
    ['400 com outro corpo', 400, '{"message":"bad request","code":400}', 'unverified'],
    ['400 sem corpo JSON', 400, 'Bad Request', 'unverified'],
    ['404', 404, '{"message":"invalid request body"}', 'unverified'],
    ['422', 422, '{"message":"invalid request body"}', 'unverified'],
    ['429', 429, '{"message":"rate limited"}', 'unverified'],
    ['500 (corpo real)', 500, '{"message":"something went wrong","code":500}', 'unverified'],
    ['503', 503, 'indisponível', 'unverified'],
  ])('validateKey: %s -> %s', async (_label, status, body, expected) => {
    const client = createGatewayClient({ fetch: () => reply(status, body), getApiKey: () => null })
    expect(await client.validateKey('k')).toBe(expected)
  })

  it('validateKey: rede e tempo esgotado (10 s) -> não verificada', async () => {
    const fetch = vi.fn<FetchLike>(networkError)
    const client = createGatewayClient({ fetch, getApiKey: () => null })
    expect(await client.validateKey('k')).toBe('unverified')
    fetch.mockImplementation(hang)
    const pending = client.validateKey('k')
    await vi.advanceTimersByTimeAsync(GATEWAY_TIMEOUT_MS)
    expect(await pending).toBe('unverified')
  })

  it('nenhuma chamada segue redirecionamento (o authorization não vai para outro domínio)', async () => {
    const fetch = vi.fn<FetchLike>(() => reply(200, MODELS))
    const client = createGatewayClient({ fetch, getApiKey: () => 'chave-x' })
    await client.listModels()
    await client.validateKey('k')
    await checkModelAccess(client, 'qwen3.5-4b-32k-fast')
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [, init] of fetch.mock.calls) expect(init.redirect).toBe('error')
    // Um redirecionamento recusado pelo fetch vira falha de rede, nunca uma segunda requisição.
    fetch.mockImplementation(() => Promise.reject(new TypeError('fetch failed: redirect mode is set to error')))
    client.clearCache()
    await expect(client.listModels()).rejects.toMatchObject({ kind: 'network' })
  })

  it('checkModelAccess: chamada mínima; 200 liberado, 400 real de modelo não liberado, 401, rede (CA7)', async () => {
    const fetch = vi.fn<FetchLike>(() => reply(200, CHAT_OK))
    const client = createGatewayClient({ fetch, getApiKey: () => 'chave-x' })
    expect(await checkModelAccess(client, 'qwen3.5-4b-32k-fast')).toBe('available')
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body ?? '{}') as { model: string; max_tokens: number; messages: unknown[] }
    expect(body.model).toBe('qwen3.5-4b-32k-fast')
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.max_tokens).toBeLessThanOrEqual(8)
    expect(body.messages).toHaveLength(1)

    fetch.mockImplementation(() => reply(400, NOT_ALLOWED))
    expect(await checkModelAccess(client, 'gemini-2.5-flash-lite')).toBe('not-allowed')
    fetch.mockImplementation(() => reply(401, AUTH_ERROR))
    expect(await checkModelAccess(client, 'x')).toBe('refused')
    fetch.mockImplementation(networkError)
    expect(await checkModelAccess(client, 'x')).toBe('network')
    fetch.mockImplementation(() => reply(400, '{"metadata":{"errors":["model x is not supported"]},"message":"invalid request body","code":400}'))
    expect(await checkModelAccess(client, 'x')).toBe('server')
  })

  it('chat devolve o texto da resposta e sem chave nem tenta', async () => {
    const fetch = vi.fn<FetchLike>(() => reply(200, CHAT_OK))
    const client = createGatewayClient({ fetch, getApiKey: () => 'chave-x' })
    await expect(client.chat({ model: 'qwen3.5-4b-32k-fast', messages: [{ role: 'user', content: 'ok' }] })).resolves.toEqual({ model: 'qwen3.5-4b-32k-fast', content: 'Great' })
    const noKey = createGatewayClient({ fetch, getApiKey: () => null })
    await expect(noKey.chat({ model: 'm', messages: [] })).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
