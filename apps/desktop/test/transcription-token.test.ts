// CA1: o main troca a chave por um token temporário e devolve só `{token, expiresInSeconds}`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTokenClient, requestToken, TOKEN_BASE_URL, TOKEN_TIMEOUT_MS, TokenError } from '../src/main/assemblyai/token'
import type { FetchInit, FetchLike } from '../src/main/assemblyai/gateway'

const KEY = 'chave-de-teste-ficticia-0123abcd'
const reply = (status: number, body: unknown) => Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) })

describe('token temporário de streaming (CA1)', () => {
  let calls: { url: string; init: FetchInit }[]

  beforeEach(() => {
    calls = []
  })
  afterEach(() => vi.useRealTimers())

  const client = (fetch: FetchLike, key: string | null = KEY) => createTokenClient({ fetch, getApiKey: () => key })

  it('GET no endpoint real com a chave no cabeçalho e só dois campos de volta', async () => {
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, init })
      return reply(200, { token: 'token-temporario-123', expires_in_seconds: 60, extra: 'ignorado' })
    }
    expect(await requestToken(client(fetch))).toEqual({ ok: true, token: 'token-temporario-123', expiresInSeconds: 60 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${TOKEN_BASE_URL}?expires_in_seconds=60`)
    expect(calls[0]?.init.method).toBe('GET')
    expect(calls[0]?.init.headers).toEqual({ authorization: KEY })
    expect(calls[0]?.init.redirect).toBe('error')
    // A chave não vai na URL.
    expect(calls[0]?.url).not.toContain(KEY)
  })

  it('sem chave devolve no-key sem tocar na rede', async () => {
    const fetch = vi.fn<FetchLike>()
    expect(await requestToken(client(fetch, null))).toEqual({ ok: false, error: 'no-key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('401, 403 e o 404 real de chave inválida viram key-rejected', async () => {
    for (const status of [401, 403, 404]) {
      const result = await requestToken(client(() => reply(status, { detail: 'Invalid API key' })))
      expect(result).toEqual({ ok: false, error: 'key-rejected' })
    }
  })

  it('5xx vira server; corpo sem token vira format', async () => {
    expect(await requestToken(client(() => reply(500, {})))).toEqual({ ok: false, error: 'server' })
    expect(await requestToken(client(() => reply(200, { expires_in_seconds: 60 })))).toEqual({ ok: false, error: 'format' })
  })

  it('rede caída vira network, e o tempo limite também', async () => {
    vi.useFakeTimers()
    const network = await requestToken(client(() => Promise.reject(new TypeError('fetch failed'))))
    expect(network).toEqual({ ok: false, error: 'network' })

    let aborted = false
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const pending = requestToken(createTokenClient({ fetch: hang, getApiKey: () => KEY }))
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, error: 'network' })
    expect(aborted).toBe(true)
  })

  it('cliente que lança TokenError preserva o tipo', async () => {
    const failing = { get: () => Promise.reject(new TokenError('key-rejected', 'recusada')) }
    expect(await requestToken(failing)).toEqual({ ok: false, error: 'key-rejected' })
  })
})
