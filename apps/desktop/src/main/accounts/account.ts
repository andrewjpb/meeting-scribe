// O que as contas Google (contrato 11) e Microsoft (contrato 12) têm em comum: o cadastro do cliente e a sessão
// (tokens e perfil) em dois arquivos cifrados com `safeStorage`, o login pelo navegador, a renovação 60 s antes de
// vencer, "Entre de novo" depois de um `invalid_grant` (sem apagar nada local) e "Sair". Cada provedor diz o
// formato do cadastro, os escopos, o endereço de volta e como ler o perfil. Tokens nunca saem do main nem vão
// para log; o renderer recebe só `AccountStatus`.
import { join } from 'node:path'
import { z } from 'zod'
import type { AccountProfile, AccountState, AccountStatus, OAuthErrorCode } from '../../shared/accounts'
import type { SafeStorageLike } from '../secrets'
import { NetworkError, type HttpFetch } from './http'
import { authorize, OAuthError, refreshAccessToken, revokeToken, type ClientCredentials, type LoopbackAddress, type OAuthProvider, type TokenSet } from './oauth'
import { ACCOUNTS_DIR, createVault } from './vault'

/** Renova o access token quando faltar isto para vencer. */
export const REFRESH_MARGIN_MS = 60_000

/** `session`: sem conta ou sessão expirada; `network`: sem internet ou o provedor não respondeu. */
export class AccountError extends Error {
  constructor(
    readonly code: 'session' | 'network',
    label = 'Google',
  ) {
    super(`conta ${label}: ${code}`)
    this.name = 'AccountError'
  }
}

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
type Session = z.infer<typeof sessionSchema>

/** Um pedido de login: os escopos e os parâmetros a mais da página de autorização. */
export interface LoginRequest {
  scopes: readonly string[]
  extra?: Readonly<Record<string, string>>
}

/**
 * Escopos da sessão nova: os que o provedor devolveu; sem eles (resposta sem `scope`), os da sessão da mesma conta
 * somados aos pedidos (o Google soma com `include_granted_scopes`).
 */
export function grantedScope(returned: string, current: string | null, requested: readonly string[]): string {
  if (returned.trim()) return returned
  return [...new Set([...(current ?? '').split(/\s+/), ...requested].filter(Boolean))].join(' ')
}

export interface AccountProviderConfig<Client> {
  /** "Google", "Microsoft": só no texto dos erros internos. */
  label: string
  provider: OAuthProvider
  clientFile: string
  sessionFile: string
  parseClient: (raw: unknown) => Client | null
  maskClient: (client: Client) => string
  credentials: (client: Client) => ClientCredentials
  /** O login completo ("Entrar com …"). */
  signInRequest: LoginRequest
  /** Contrato 12: só o escopo da agenda, para quem já entrou sem ele (`null`: o login já pede tudo). */
  calendarRequest: ((email: string) => LoginRequest) | null
  loopback?: LoopbackAddress
  /** Escopos mandados na renovação (Microsoft); sem isto, nada. */
  refreshScope?: string
  /** Perfil com o token recém-recebido. */
  profile: (fetch: HttpFetch, tokens: TokenSet, signal: AbortSignal) => Promise<AccountProfile>
  /** A sessão tem a agenda liberada (pelos escopos concedidos). */
  hasCalendar: (scope: string) => boolean
}

export interface AccountCoreDeps {
  /** `userData`; os arquivos ficam em `accounts/`. */
  dir: string
  safeStorage: SafeStorageLike
  /** Já protegido pela lista de destinos (`guardedFetch`). */
  fetch: HttpFetch
  openExternal: (url: string) => Promise<void> | void
  onStatus: (status: AccountStatus) => void
  /** Login bom (o e-mail diz se é a mesma conta de antes). */
  onSignedIn?: (email: string) => void
  onSignedOut?: () => void
  now?: () => number
  timeoutMs?: number
  randomBytes?: (size: number) => Uint8Array
}

export interface AccountCore<Client> {
  status(): AccountStatus
  client(): Client | null
  writeClient(client: Client): void
  /** Erro de login mostrado na linha da conta; o cadastro novo apaga. */
  clearError(): void
  announce(): AccountStatus
  signIn(): Promise<AccountStatus>
  /** Contrato 12 (CA2): o novo consentimento só com o escopo da agenda. */
  grantCalendar(): Promise<AccountStatus>
  cancelSignIn(): boolean
  signOut(): Promise<AccountStatus>
  accessToken(force?: boolean): Promise<string>
  markExpired(): void
  signedIn(): boolean
  hasCalendar(): boolean
  email(): string | null
}

export function createAccountCore<Client>(config: AccountProviderConfig<Client>, deps: AccountCoreDeps): AccountCore<Client> {
  const now = deps.now ?? Date.now
  const { fetch } = deps
  const clients = createVault(join(deps.dir, ACCOUNTS_DIR, config.clientFile), deps.safeStorage, config.parseClient)
  const sessions = createVault(join(deps.dir, ACCOUNTS_DIR, config.sessionFile), deps.safeStorage, (raw) => {
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

  const status = (): AccountStatus => {
    const client = clients.read()
    const session = sessions.read()
    return {
      client: { configured: client !== null, clientId: client ? config.maskClient(client) : null },
      state: state(),
      profile: session?.profile ?? null,
      error: lastError,
      calendar: session ? config.hasCalendar(session.scope) : false,
    }
  }

  const announce = (): AccountStatus => {
    const current = status()
    deps.onStatus(current)
    return current
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
    if (!session || session.expired || !client) throw new AccountError('session', config.label)
    const started = generation
    let tokens: TokenSet
    try {
      tokens = await refreshAccessToken(fetch, config.provider, { ...config.credentials(client), refreshToken: session.refreshToken, scope: config.refreshScope }, now)
    } catch (error) {
      if (started !== generation) throw new AccountError('session', config.label)
      if (error instanceof OAuthError && (error.code === 'denied' || error.code === 'invalid-client')) {
        // Sessão revogada ou vencida (`invalid_grant`), ou o cadastro mudou: "Entre de novo", sem apagar nada local.
        expire()
        throw new AccountError('session', config.label)
      }
      throw new AccountError('network', config.label)
    }
    // "Sair" (ou outro login) enquanto renovava: o resultado é descartado e nada é regravado.
    const current = sessions.read()
    if (started !== generation || !current) throw new AccountError('session', config.label)
    sessions.write({
      ...current,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      refreshToken: tokens.refreshToken ?? current.refreshToken,
      // A Microsoft devolve os escopos a cada renovação; o Google também, às vezes.
      scope: tokens.scope || current.scope,
    })
    return tokens.accessToken
  }

  /** `sameAccount`: o e-mail da conta já conectada; outra conta volta com `other-account` e nada muda. */
  async function login(request: LoginRequest, sameAccount: string | null = null): Promise<AccountStatus> {
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
        provider: config.provider,
        ...config.credentials(client),
        scopes: request.scopes,
        ...(request.extra ? { extra: request.extra } : {}),
        ...(config.loopback ? { loopback: config.loopback } : {}),
        fetch,
        openExternal: deps.openExternal,
        signal: controller.signal,
        now,
        ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
        ...(deps.randomBytes ? { randomBytes: deps.randomBytes } : {}),
      })
      stillWanted()
      if (!tokens.refreshToken) throw new OAuthError('denied', 'sem refresh_token')
      const profile = await config.profile(fetch, tokens, controller.signal)
      stillWanted()
      // Contrato 12: "Permitir acesso à agenda" com outra conta no navegador: os tokens novos são descartados.
      if (sameAccount !== null && profile.email.toLowerCase() !== sameAccount.toLowerCase()) throw new OAuthError('other-account')
      const previous = sessions.read()
      const sameEmail = previous && previous.profile.email.toLowerCase() === profile.email.toLowerCase() ? previous.scope : null
      const session: Session = { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, scope: grantedScope(tokens.scope, sameEmail, request.scopes), profile, expired: false }
      sessions.write(session)
      signingIn = null
      const current = announce()
      deps.onSignedIn?.(profile.email)
      return current
    } catch (error) {
      lastError = error instanceof OAuthError ? error.code : error instanceof NetworkError ? 'network' : controller.signal.aborted ? 'cancelled' : 'network'
      if (signingIn === controller) signingIn = null
      return announce()
    }
  }

  return {
    status,
    client: () => clients.read(),
    writeClient: (client) => clients.write(client),
    clearError: () => {
      lastError = null
    },
    announce,

    signIn: () => login(config.signInRequest),

    grantCalendar() {
      const session = sessions.read()
      if (!config.calendarRequest || !session || session.expired) return Promise.resolve(status())
      return login(config.calendarRequest(session.profile.email), session.profile.email)
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
      if (session) await revokeToken(fetch, config.provider, session.refreshToken)
      sessions.remove()
      lastError = null
      deps.onSignedOut?.()
      return announce()
    },

    accessToken(force = false) {
      const session = sessions.read()
      if (!session || session.expired) return Promise.reject(new AccountError('session', config.label))
      if (!force && session.expiresAt - REFRESH_MARGIN_MS > now()) return Promise.resolve(session.accessToken)
      refreshing ??= refresh().finally(() => {
        refreshing = null
      })
      return refreshing
    },

    markExpired: expire,
    signedIn: () => state() === 'signed-in',
    hasCalendar: () => {
      const session = sessions.read()
      return session !== null && !session.expired && config.hasCalendar(session.scope)
    },
    email: () => sessions.read()?.profile.email ?? null,
  }
}
