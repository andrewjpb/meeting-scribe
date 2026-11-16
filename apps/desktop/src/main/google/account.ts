// Conta Google (contrato 11, CA2 e CA3): cadastro do cliente OAuth, login, perfil, renovação do token e saída.
// O cadastro (ID e chave secreta do cliente) fica em `userData/accounts/google-client.bin` e a sessão (tokens e
// perfil) em `userData/accounts/google.bin`, os dois cifrados com `safeStorage`. O renderer recebe só
// `GoogleAccountStatus`: se há cadastro, o ID com o meio mascarado, o nome, o e-mail e a foto. Tokens nunca
// saem do main nem vão para log. `invalid_grant` na renovação deixa a conta em "Entre de novo" sem apagar nada
// local. Sem Electron: `fetch`, navegador, `safeStorage` e a foto chegam injetados.
import { join } from 'node:path'
import { z } from 'zod'
import { maskClientId, type AccountProfile, type AccountState, type GoogleAccountStatus, type GoogleClientSaveResult, type OAuthErrorCode } from '../../shared/accounts'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'
import { allowedUrl, guardedFetch, jsonOf, NetworkError, type HttpFetch } from '../accounts/http'
import { authorize, GOOGLE_OAUTH, OAuthError, refreshAccessToken, revokeToken, type TokenSet } from '../accounts/oauth'
import { ACCOUNTS_DIR, createVault } from '../accounts/vault'

export const GOOGLE_CLIENT_FILE = 'google-client.bin'
export const GOOGLE_SESSION_FILE = 'google.bin'
/** CA3: perfil e Drive (só o que o app criou). O contrato 12 acrescenta a agenda com `include_granted_scopes`. */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'] as const
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
/** Renova o access token quando faltar isto para vencer. */
export const REFRESH_MARGIN_MS = 60_000
const PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PHOTO_SIZE = 256

const clientIdSchema = z
  .string()
  .trim()
  .regex(/^[\w.-]{1,200}\.apps\.googleusercontent\.com$/)
const clientSecretSchema = z
  .string()
  .trim()
  .regex(/^[\x21-\x7E]{8,256}$/)
const clientSchema = z.object({ clientId: clientIdSchema, clientSecret: clientSecretSchema })
type ClientRecord = z.infer<typeof clientSchema>

const profileSchema = z.object({ name: z.string().max(200), email: z.string().max(320), photo: z.string().max(2_000_000).nullable() })
const sessionSchema = z.object({
  refreshToken: z.string().min(1),
  accessToken: z.string(),
  expiresAt: z.number(),
  scope: z.string(),
  profile: profileSchema,
  /** `invalid_grant`: falta entrar de novo; nada local é apagado. */
  expired: z.boolean(),
})

/** `session`: sem conta ou sessão expirada; `network`: sem internet ou o Google não respondeu. */
export class AccountError extends Error {
  constructor(readonly code: 'session' | 'network') {
    super(`conta Google: ${code}`)
    this.name = 'AccountError'
  }
}

export interface GoogleAccountDeps {
  /** `userData`; os arquivos ficam em `accounts/`. */
  dir: string
  safeStorage: SafeStorageLike
  fetch: HttpFetch
  /** `shell.openExternal`; o smoke guarda a URL e faz o papel do navegador. */
  openExternal: (url: string) => Promise<void> | void
  /** Foto baixada para data URL com até 256 px (`nativeImage` no app); `null` se não for imagem. */
  photoToDataUrl: (bytes: Uint8Array) => string | null
  onStatus: (status: GoogleAccountStatus) => void
  /** Login bom (o e-mail diz se é a mesma conta de antes): o envio ao Drive retoma a fila. */
  onSignedIn?: (email: string) => void
  /** "Sair": o envio ao Drive esvazia a fila. */
  onSignedOut?: () => void
  now?: () => number
  timeoutMs?: number
  randomBytes?: (size: number) => Uint8Array
}

export interface GoogleAccountService {
  status(): GoogleAccountStatus
  saveClient(input: unknown): GoogleClientSaveResult
  /** Responde quando o login termina (ou falha); o estado intermediário chega por `onStatus`. */
  signIn(): Promise<GoogleAccountStatus>
  cancelSignIn(): boolean
  signOut(): Promise<GoogleAccountStatus>
  /** Token válido para o Drive; renova sozinho 60 s antes de vencer, ou na hora com `force` (depois de um 401). */
  accessToken(force?: boolean): Promise<string>
  /**
   * O Drive respondeu 401 mesmo com o token recém-renovado: a conta passa a "Sessão expirada. Entre de novo.",
   * a mesma coisa que a linha da reunião mostra.
   */
  markExpired(): void
  /** Logado e com a sessão valendo. */
  signedIn(): boolean
  email(): string | null
}

export function createGoogleAccount(deps: GoogleAccountDeps): GoogleAccountService {
  const now = deps.now ?? Date.now
  const fetch = guardedFetch(deps.fetch)
  const clients = createVault(join(deps.dir, ACCOUNTS_DIR, GOOGLE_CLIENT_FILE), deps.safeStorage, (raw) => {
    const parsed = clientSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  })
  const sessions = createVault(join(deps.dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE), deps.safeStorage, (raw) => {
    const parsed = sessionSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  })
  let signingIn: AbortController | null = null
  let lastError: OAuthErrorCode | null = null
  let refreshing: Promise<string> | null = null
  /**
   * Geração da sessão: "Sair" (e cada login novo) avança. Uma renovação ou um login que começou numa geração
   * anterior não escreve nada no fim: "Sair" no meio nunca deixa a sessão regravada no disco.
   */
  let generation = 0

  const state = (): AccountState => {
    if (signingIn) return 'signing-in'
    const session = sessions.read()
    if (!session) return 'signed-out'
    return session.expired ? 'expired' : 'signed-in'
  }

  const status = (): GoogleAccountStatus => {
    const client = clients.read()
    return {
      client: { configured: client !== null, clientId: client ? maskClientId(client.clientId) : null },
      state: state(),
      profile: sessions.read()?.profile ?? null,
      error: lastError,
    }
  }

  const announce = (): GoogleAccountStatus => {
    const current = status()
    deps.onStatus(current)
    return current
  }

  const authorized = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, accept: 'application/json' })

  async function photoOf(url: unknown): Promise<string | null> {
    if (typeof url !== 'string') return null
    // As fotos do Google aceitam o tamanho no fim (`=s96-c`): pede 256 px.
    const sized = /=s\d+(-c)?$/.test(url) ? url.replace(/=s\d+(-c)?$/, `=s${PHOTO_SIZE}-c`) : url
    if (!allowedUrl(sized) || new URL(sized).hostname !== 'lh3.googleusercontent.com') return null
    try {
      const response = await fetch(sized, { method: 'GET', headers: { accept: 'image/*' } })
      if (response.status !== 200 || !(response.header('content-type') ?? '').startsWith('image/')) return null
      const bytes = await response.bytes()
      return bytes.byteLength > PHOTO_MAX_BYTES ? null : deps.photoToDataUrl(bytes)
    } catch {
      return null
    }
  }

  async function profileOf(tokens: TokenSet, signal: AbortSignal): Promise<AccountProfile> {
    let response
    try {
      response = await fetch(GOOGLE_USERINFO_URL, { method: 'GET', headers: authorized(tokens.accessToken), signal })
    } catch {
      throw new OAuthError(signal.aborted ? 'cancelled' : 'network', 'perfil')
    }
    const body = (await jsonOf(response)) as Record<string, unknown> | null
    if (response.status !== 200 || !body) throw new OAuthError('network', `perfil http ${response.status}`)
    const email = typeof body['email'] === 'string' ? body['email'].slice(0, 320) : ''
    const name = typeof body['name'] === 'string' && body['name'].trim() ? body['name'].trim().slice(0, 200) : email
    return { name, email, photo: await photoOf(body['picture']) }
  }

  /** "Entre de novo": a sessão fica no disco com o perfil, marcada como expirada. */
  function expire(): void {
    const current = sessions.read()
    if (current && !current.expired) sessions.write({ ...current, expired: true })
    announce()
  }

  async function refresh(): Promise<string> {
    const session = sessions.read()
    const client = clients.read()
    if (!session || session.expired || !client) throw new AccountError('session')
    const started = generation
    let tokens: TokenSet
    try {
      tokens = await refreshAccessToken(fetch, GOOGLE_OAUTH, { ...client, refreshToken: session.refreshToken }, now)
    } catch (error) {
      if (started !== generation) throw new AccountError('session')
      if (error instanceof OAuthError && (error.code === 'denied' || error.code === 'invalid-client')) {
        // Sessão revogada ou vencida (`invalid_grant`), ou o cadastro mudou: "Entre de novo", sem apagar nada local.
        expire()
        throw new AccountError('session')
      }
      throw new AccountError('network')
    }
    // "Sair" (ou outro login) enquanto renovava: o resultado é descartado e nada é regravado.
    const current = sessions.read()
    if (started !== generation || !current) throw new AccountError('session')
    sessions.write({ ...current, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, refreshToken: tokens.refreshToken ?? current.refreshToken })
    return tokens.accessToken
  }

  return {
    status,

    saveClient(input) {
      const request = typeof input === 'object' && input !== null ? (input as { clientId?: unknown; clientSecret?: unknown }) : {}
      const clientId = clientIdSchema.safeParse(request.clientId)
      if (!clientId.success) return { ok: false, error: 'invalid-id', status: status() }
      const clientSecret = clientSecretSchema.safeParse(request.clientSecret)
      if (!clientSecret.success) return { ok: false, error: 'invalid-secret', status: status() }
      const record: ClientRecord = { clientId: clientId.data, clientSecret: clientSecret.data }
      try {
        clients.write(record)
      } catch (error) {
        return { ok: false, error: error instanceof EncryptionUnavailableError ? 'unavailable' : 'failed', status: status() }
      }
      lastError = null
      return { ok: true, status: announce() }
    },

    async signIn() {
      const client = clients.read()
      if (!client || signingIn) return status()
      const controller = new AbortController()
      signingIn = controller
      const started = ++generation
      lastError = null
      announce()
      // "Cancelar" ou "Sair" em qualquer ponto do fluxo, até a última escrita.
      const stillWanted = (): void => {
        if (controller.signal.aborted || started !== generation) throw new OAuthError('cancelled')
      }
      try {
        const tokens = await authorize({
          provider: GOOGLE_OAUTH,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          scopes: GOOGLE_SCOPES,
          // CA3: `offline` + `consent` para o Google mandar o `refresh_token`.
          extra: { access_type: 'offline', prompt: 'consent' },
          fetch,
          openExternal: deps.openExternal,
          signal: controller.signal,
          now,
          ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
          ...(deps.randomBytes ? { randomBytes: deps.randomBytes } : {}),
        })
        stillWanted()
        if (!tokens.refreshToken) throw new OAuthError('denied', 'sem refresh_token')
        const profile = await profileOf(tokens, controller.signal)
        stillWanted()
        sessions.write({ refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, scope: tokens.scope, profile, expired: false })
        signingIn = null
        const current = announce()
        deps.onSignedIn?.(profile.email)
        return current
      } catch (error) {
        lastError = error instanceof OAuthError ? error.code : error instanceof NetworkError ? 'network' : controller.signal.aborted ? 'cancelled' : 'network'
        if (signingIn === controller) signingIn = null
        return announce()
      }
    },

    cancelSignIn() {
      if (!signingIn) return false
      signingIn.abort()
      return true
    },

    async signOut() {
      generation++
      signingIn?.abort()
      refreshing = null
      const session = sessions.read()
      if (session) await revokeToken(fetch, GOOGLE_OAUTH, session.refreshToken)
      sessions.remove()
      lastError = null
      deps.onSignedOut?.()
      return announce()
    },

    accessToken(force = false) {
      const session = sessions.read()
      if (!session || session.expired) return Promise.reject(new AccountError('session'))
      if (!force && session.expiresAt - REFRESH_MARGIN_MS > now()) return Promise.resolve(session.accessToken)
      refreshing ??= refresh().finally(() => {
        refreshing = null
      })
      return refreshing
    },

    markExpired: expire,

    signedIn: () => state() === 'signed-in',
    email: () => sessions.read()?.profile.email ?? null,
  }
}
