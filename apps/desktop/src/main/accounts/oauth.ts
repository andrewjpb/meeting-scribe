// Login OAuth de app de computador (contrato 11, CA1), o mesmo para o Google e, no contrato 12, para a
// Microsoft: navegador do sistema, redirecionamento para `http://127.0.0.1:<porta livre>/callback`, PKCE S256 e
// `state` aleatório. Nada de janela de login dentro do Electron. Sem Electron aqui: o `fetch`, o "abrir no
// navegador" e o sorteio chegam injetados (o app usa `net.fetch` e `shell.openExternal`; os testes e o smoke,
// um servidor falso). Os tokens só voltam a quem chamou, no main; nada é escrito em log.
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthErrorCode } from '../../shared/accounts'
import { formBody, jsonOf, NetworkError, type HttpFetch } from './http'

export interface OAuthProvider {
  id: 'google' | 'microsoft'
  /** Página de autorização, aberta no navegador. */
  authUrl: string
  tokenUrl: string
  revokeUrl: string | null
}

export const GOOGLE_OAUTH: OAuthProvider = {
  id: 'google',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
}

/** Contrato 12: a mesma troca, no endpoint comum da Microsoft. */
export const MICROSOFT_OAUTH: OAuthProvider = {
  id: 'microsoft',
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  revokeUrl: null,
}

/** Únicos endereços que o login abre no navegador. */
export const BROWSER_PREFIXES = ['https://accounts.google.com/', 'https://login.microsoftonline.com/'] as const

/** Tempo para a pessoa terminar no navegador. */
export const LOGIN_TIMEOUT_MS = 5 * 60_000
export const CALLBACK_PATH = '/callback'
export const CALLBACK_DONE_TEXT = 'Pronto, pode voltar ao app.'
export const CALLBACK_FAILED_TEXT = 'Não deu certo. Volte ao app e tente de novo.'

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    /** Código de erro do servidor (`invalid_grant`, `access_denied`…), quando houver. Nunca um token. */
    readonly reason: string | null = null,
  ) {
    super(`login: ${code}${reason ? ` (${reason})` : ''}`)
    this.name = 'OAuthError'
  }
}

export interface TokenSet {
  accessToken: string
  /** Só vem no primeiro login (`access_type=offline` + `prompt=consent`) e às vezes na renovação. */
  refreshToken: string | null
  /** Instante (ms) em que o access token vence. */
  expiresAt: number
  scope: string
}

export interface Pkce {
  verifier: string
  challenge: string
  state: string
}

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/** `code_verifier` de 43 caracteres, o `code_challenge` S256 dele e o `state`, todos aleatórios. */
export function createPkce(randomBytes: (size: number) => Uint8Array = nodeRandomBytes): Pkce {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: challengeOf(verifier), state: base64url(randomBytes(24)) }
}

export function challengeOf(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export interface AuthorizationParams {
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  pkce: Pick<Pkce, 'challenge' | 'state'>
  /** `access_type`, `prompt`, `include_granted_scopes`… */
  extra?: Readonly<Record<string, string>>
}

export function authorizationUrl(provider: OAuthProvider, params: AuthorizationParams): string {
  const url = new URL(provider.authUrl)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('code_challenge', params.pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', params.pkce.state)
  for (const [name, value] of Object.entries(params.extra ?? {})) url.searchParams.set(name, value)
  return url.toString()
}

/** Só a página de login do Google ou da Microsoft abre no navegador. */
export function isBrowserUrl(url: string): boolean {
  return BROWSER_PREFIXES.some((prefix) => url.startsWith(prefix))
}

export interface Loopback {
  /** `http://127.0.0.1:<porta>/callback`. */
  redirectUri: string
  /** O `code` que o navegador trouxe, com o `state` conferido. */
  code: Promise<string>
  close(): void
}

export interface LoopbackOptions {
  state: string
  timeoutMs?: number
  signal?: AbortSignal
}

function page(text: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${text}</title></head><body style="font-family: Helvetica Neue, Helvetica, Arial, sans-serif; margin: 64px"><p>${text}</p></body></html>`
}

/**
 * Servidor em `127.0.0.1`, porta livre, que aceita um pedido `GET /callback`: confere o `state`, responde a
 * página "Pronto, pode voltar ao app." e fecha. Outro caminho recebe 404 e o servidor segue esperando. Fecha
 * também no prazo (5 min, `timeout`) e no cancelamento (`cancelled`).
 */
export function startLoopback({ state, timeoutMs = LOGIN_TIMEOUT_MS, signal }: LoopbackOptions): Promise<Loopback> {
  return new Promise((resolveLoopback, rejectLoopback) => {
    let settle: { resolve: (code: string) => void; reject: (error: OAuthError) => void } | null = null
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // Sem ninguém esperando ainda (o `close` antes do `await`), a rejeição não vira erro solto.
    code.catch(() => undefined)
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (done || request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado')
        return
      }
      const error = url.searchParams.get('error')
      const returned = url.searchParams.get('state')
      const value = url.searchParams.get('code')
      let outcome: { ok: true; code: string } | { ok: false; error: OAuthError }
      if (returned !== state) outcome = { ok: false, error: new OAuthError('state') }
      else if (error) outcome = { ok: false, error: new OAuthError('denied', error.slice(0, 64)) }
      else if (!value) outcome = { ok: false, error: new OAuthError('denied', 'sem código') }
      else outcome = { ok: true, code: value }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' })
      response.end(page(outcome.ok ? CALLBACK_DONE_TEXT : CALLBACK_FAILED_TEXT))
      finish(outcome)
    })

    function finish(outcome: { ok: true; code: string } | { ok: false; error: OAuthError }): void {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.close()
      server.closeAllConnections?.()
      if (outcome.ok) settle?.resolve(outcome.code)
      else settle?.reject(outcome.error)
    }
    const onAbort = (): void => finish({ ok: false, error: new OAuthError('cancelled') })

    server.on('error', () => {
      if (!done) {
        done = true
        rejectLoopback(new OAuthError('network', 'servidor local'))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      if (signal?.aborted) {
        onAbort()
        rejectLoopback(new OAuthError('cancelled'))
        return
      }
      signal?.addEventListener('abort', onAbort)
      timer = setTimeout(() => finish({ ok: false, error: new OAuthError('timeout') }), timeoutMs)
      timer.unref?.()
      const { port } = server.address() as AddressInfo
      resolveLoopback({
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        code,
        close: () => finish({ ok: false, error: new OAuthError('cancelled') }),
      })
    })
  })
}

const TOKEN_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }

/** Resposta do endpoint de token: tokens, ou o erro do OAuth na lista do contrato. */
async function tokenRequest(fetch: HttpFetch, provider: OAuthProvider, fields: Record<string, string>, now: () => number, signal?: AbortSignal): Promise<TokenSet> {
  let response
  try {
    response = await fetch(provider.tokenUrl, { method: 'POST', headers: TOKEN_HEADERS, body: formBody(fields), ...(signal ? { signal } : {}) })
  } catch (error) {
    if (signal?.aborted) throw new OAuthError('cancelled')
    throw new OAuthError('network', error instanceof NetworkError ? null : 'pedido')
  }
  const body = (await jsonOf(response)) as Record<string, unknown> | null
  const errorCode = typeof body?.['error'] === 'string' ? body['error'] : null
  if (response.status >= 500) throw new OAuthError('network', `http ${response.status}`)
  if (errorCode === 'invalid_client' || errorCode === 'unauthorized_client' || response.status === 401) throw new OAuthError('invalid-client', errorCode)
  if (response.status !== 200 || errorCode) throw new OAuthError('denied', errorCode ?? `http ${response.status}`)
  const accessToken = body?.['access_token']
  const expiresIn = body?.['expires_in']
  if (typeof accessToken !== 'string' || !accessToken) throw new OAuthError('network', 'resposta sem token')
  const refreshToken = body?.['refresh_token']
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : null,
    expiresAt: now() + (typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600) * 1000,
    scope: typeof body?.['scope'] === 'string' ? body['scope'] : '',
  }
}

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

/** Troca o código pelos tokens (`authorization_code` + `code_verifier`). */
export function exchangeCode(
  fetch: HttpFetch,
  provider: OAuthProvider,
  input: ClientCredentials & { code: string; verifier: string; redirectUri: string },
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<TokenSet> {
  return tokenRequest(
    fetch,
    provider,
    {
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    now,
    signal,
  )
}

/** Renovação do access token. `invalid_grant` chega como `denied`: a sessão expirou ou foi revogada. */
export function refreshAccessToken(fetch: HttpFetch, provider: OAuthProvider, input: ClientCredentials & { refreshToken: string }, now: () => number = Date.now): Promise<TokenSet> {
  return tokenRequest(fetch, provider, { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }, now)
}

export interface AuthorizeOptions extends ClientCredentials {
  provider: OAuthProvider
  scopes: readonly string[]
  extra?: Readonly<Record<string, string>>
  fetch: HttpFetch
  /** `shell.openExternal` no app; o smoke guarda a URL e faz o papel do navegador. */
  openExternal: (url: string) => Promise<void> | void
  signal?: AbortSignal
  timeoutMs?: number
  now?: () => number
  randomBytes?: (size: number) => Uint8Array
}

/** O login inteiro: servidor local, navegador, código conferido e troca pelos tokens. */
export async function authorize(options: AuthorizeOptions): Promise<TokenSet> {
  const pkce = createPkce(options.randomBytes)
  const loopback = await startLoopback({ state: pkce.state, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}), ...(options.signal ? { signal: options.signal } : {}) })
  try {
    const url = authorizationUrl(options.provider, { clientId: options.clientId, redirectUri: loopback.redirectUri, scopes: options.scopes, pkce, ...(options.extra ? { extra: options.extra } : {}) })
    if (!isBrowserUrl(url)) throw new OAuthError('invalid-client', 'endereço de login')
    try {
      await options.openExternal(url)
    } catch {
      throw new OAuthError('cancelled', 'navegador')
    }
    const code = await loopback.code
    return await exchangeCode(options.fetch, options.provider, { clientId: options.clientId, clientSecret: options.clientSecret, code, verifier: pkce.verifier, redirectUri: loopback.redirectUri }, options.now, options.signal)
  } finally {
    loopback.close()
  }
}

/** Revoga o token no provedor (Google). Falha de rede não impede sair: o app apaga do disco de qualquer jeito. */
export async function revokeToken(fetch: HttpFetch, provider: OAuthProvider, token: string): Promise<boolean> {
  if (!provider.revokeUrl) return false
  try {
    const response = await fetch(provider.revokeUrl, { method: 'POST', headers: TOKEN_HEADERS, body: formBody({ token }) })
    return response.status === 200
  } catch {
    return false
  }
}
