import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  authorizationUrl,
  authorize,
  CALLBACK_DONE_TEXT,
  challengeOf,
  createPkce,
  exchangeCode,
  GOOGLE_OAUTH,
  isBrowserUrl,
  MICROSOFT_OAUTH,
  OAuthError,
  refreshAccessToken,
  startLoopback,
} from '../src/main/accounts/oauth'
import { allowedUrl, guardedFetch, type HttpFetch } from '../src/main/accounts/http'
import { createFakeGoogle } from '../src/main/google/fake-google'

const CLIENT = { clientId: '123-teste.apps.googleusercontent.com', clientSecret: 'segredo-de-teste-123' }

/** O "navegador": um GET no endereço de volta, sem rede (só 127.0.0.1). */
function browserGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return error instanceof OAuthError ? error.code : String(error)
  }
}

describe('PKCE e URL de autorização (CA1)', () => {
  it('verifier, challenge S256 e state aleatórios', () => {
    const a = createPkce()
    const b = createPkce()
    expect(a.verifier).toMatch(/^[\w-]{43}$/)
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'))
    expect(challengeOf(a.verifier)).toBe(a.challenge)
    expect(a.state.length).toBeGreaterThanOrEqual(32)
    expect(new Set([a.verifier, b.verifier, a.state, b.state]).size).toBe(4)
  })

  it('URL do Google com os escopos, S256, state e os parâmetros extras', () => {
    const pkce = createPkce()
    const url = new URL(
      authorizationUrl(GOOGLE_OAUTH, {
        clientId: CLIENT.clientId,
        redirectUri: 'http://127.0.0.1:5555/callback',
        scopes: ['openid', 'email'],
        pkce,
        extra: { access_type: 'offline', prompt: 'consent' },
      }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT.clientId,
      redirect_uri: 'http://127.0.0.1:5555/callback',
      response_type: 'code',
      scope: 'openid email',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state: pkce.state,
      access_type: 'offline',
      prompt: 'consent',
    })
    expect(url.searchParams.has('code_verifier')).toBe(false)
  })

  it('só o Google e a Microsoft abrem no navegador', () => {
    expect(isBrowserUrl(GOOGLE_OAUTH.authUrl)).toBe(true)
    expect(isBrowserUrl(MICROSOFT_OAUTH.authUrl)).toBe(true)
    expect(isBrowserUrl('https://accounts.google.com.evil.test/')).toBe(false)
    expect(isBrowserUrl('http://accounts.google.com/')).toBe(false)
    expect(isBrowserUrl('https://example.com/')).toBe(false)
  })

  it('a rede só vai para os destinos da lista', async () => {
    expect(allowedUrl('https://oauth2.googleapis.com/token')).toBe(true)
    expect(allowedUrl('https://www.googleapis.com/drive/v3/files')).toBe(true)
    expect(allowedUrl('https://www.googleapis.com/upload/drive/v3/files')).toBe(true)
    expect(allowedUrl('https://lh3.googleusercontent.com/a/x')).toBe(true)
    expect(allowedUrl('https://www.googleapis.com/gmail/v1/users')).toBe(false)
    expect(allowedUrl('https://accounts.google.com/o/oauth2/v2/auth')).toBe(false)
    expect(allowedUrl('http://oauth2.googleapis.com/token')).toBe(false)
    expect(allowedUrl('https://oauth2.googleapis.com:8443/token')).toBe(false)
    let called = false
    const fetch = guardedFetch(() => {
      called = true
      return Promise.reject(new Error('não chamar'))
    })
    await expect(fetch('https://example.com/', { method: 'GET', headers: {} })).rejects.toThrow('destino fora da lista')
    expect(called).toBe(false)
  })
})

describe('servidor local do login (CA1)', () => {
  it('aceita um GET /callback, confere o state, responde "Pronto" e fecha', async () => {
    const loop = await startLoopback({ state: 'estado-certo' })
    expect(loop.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    // Outro caminho: 404, e o servidor segue esperando.
    expect((await browserGet(loop.redirectUri.replace('/callback', '/favicon.ico'))).status).toBe(404)
    const page = await browserGet(`${loop.redirectUri}?code=abc&state=estado-certo`)
    expect(page.status).toBe(200)
    expect(page.body).toContain(CALLBACK_DONE_TEXT)
    expect(await loop.code).toBe('abc')
    // Fechado: um segundo pedido não é atendido.
    await expect(browserGet(`${loop.redirectUri}?code=outro&state=estado-certo`)).rejects.toThrow()
  })

  it('state diferente: erro `state`', async () => {
    const loop = await startLoopback({ state: 'estado-certo' })
    const page = await browserGet(`${loop.redirectUri}?code=abc&state=outro`)
    expect(page.body).not.toContain(CALLBACK_DONE_TEXT)
    expect(await codeOf(loop.code)).toBe('state')
  })

  it('a pessoa negou no Google: `denied`', async () => {
    const loop = await startLoopback({ state: 's' })
    await browserGet(`${loop.redirectUri}?error=access_denied&state=s`)
    expect(await codeOf(loop.code)).toBe('denied')
  })

  it('tempo esgotado: `timeout`; cancelado: `cancelled`', async () => {
    const slow = await startLoopback({ state: 's', timeoutMs: 30 })
    expect(await codeOf(slow.code)).toBe('timeout')
    const controller = new AbortController()
    const cancelled = await startLoopback({ state: 's', signal: controller.signal })
    controller.abort()
    expect(await codeOf(cancelled.code)).toBe('cancelled')
  })
})

describe('login inteiro com o Google falso (CA1)', () => {
  it('abre só a página do Google, volta pelo servidor local e troca o código com o verifier', async () => {
    const fake = createFakeGoogle(CLIENT)
    const opened: string[] = []
    const tokens = await authorize({
      provider: GOOGLE_OAUTH,
      ...CLIENT,
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
      extra: { access_type: 'offline', prompt: 'consent' },
      fetch: guardedFetch(fake.fetch),
      openExternal: async (url) => {
        opened.push(url)
        await browserGet(fake.approve(url))
      },
    })
    expect(opened).toHaveLength(1)
    expect(opened[0]?.startsWith('https://accounts.google.com/')).toBe(true)
    expect(tokens.accessToken).toMatch(/^token-acesso-falso-/)
    expect(tokens.refreshToken).toMatch(/^token-renovacao-falso-/)
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    // Uma troca só; o falso confere o verifier contra o challenge S256 da URL.
    expect(fake.calls.filter((call) => call.path === '/token')).toHaveLength(1)
  })

  it('erros do endpoint de token: `invalid-client`, `denied`, `network`', async () => {
    const fake = createFakeGoogle(CLIENT)
    const fetch = guardedFetch(fake.fetch)
    const input = { code: 'x', verifier: 'y', redirectUri: 'http://127.0.0.1:1/callback' }
    expect(await codeOf(exchangeCode(fetch, GOOGLE_OAUTH, { ...CLIENT, clientSecret: 'outro-segredo', ...input }))).toBe('invalid-client')
    expect(await codeOf(exchangeCode(fetch, GOOGLE_OAUTH, { ...CLIENT, ...input }))).toBe('denied')
    const offline: HttpFetch = () => Promise.reject(new TypeError('fetch failed'))
    expect(await codeOf(exchangeCode(guardedFetch(offline), GOOGLE_OAUTH, { ...CLIENT, ...input }))).toBe('network')
    const down: HttpFetch = () => Promise.resolve({ status: 503, header: () => null, text: () => Promise.resolve(''), bytes: () => Promise.resolve(new Uint8Array()) })
    expect(await codeOf(refreshAccessToken(down, GOOGLE_OAUTH, { ...CLIENT, refreshToken: 'r' }))).toBe('network')
    fake.refreshRevoked = true
    const refused = await codeOf(refreshAccessToken(fetch, GOOGLE_OAUTH, { ...CLIENT, refreshToken: 'r' }))
    expect(refused).toBe('denied')
  })

  it('navegador que não abre: `cancelled`; a pessoa nega: `denied`', async () => {
    const fake = createFakeGoogle(CLIENT)
    const base = { provider: GOOGLE_OAUTH, ...CLIENT, scopes: ['openid'], fetch: guardedFetch(fake.fetch) }
    expect(
      await codeOf(
        authorize({
          ...base,
          openExternal: () => {
            throw new Error('sem navegador')
          },
        }),
      ),
    ).toBe('cancelled')
    expect(await codeOf(authorize({ ...base, openExternal: async (url) => void (await browserGet(fake.approve(url, { deny: true }))) }))).toBe('denied')
  })
})
