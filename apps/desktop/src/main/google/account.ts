// Conta Google (contrato 11, CA2 e CA3; contrato 12, CA2): cadastro do cliente OAuth, login, perfil, renovação do
// token e saída. O cadastro (ID e chave secreta do cliente) fica em `userData/accounts/google-client.bin` e a sessão
// (tokens e perfil) em `userData/accounts/google.bin`, os dois cifrados com `safeStorage` (o ciclo da sessão é o de
// `accounts/account.ts`, o mesmo da Microsoft). O renderer recebe só `GoogleAccountStatus`: se há cadastro, o ID
// com o meio mascarado, o nome, o e-mail, a foto e se a agenda foi liberada. Tokens nunca saem do main nem vão
// para log. `invalid_grant` na renovação deixa a conta em "Entre de novo" sem apagar nada local. Sem Electron:
// `fetch`, navegador, `safeStorage` e a foto chegam injetados.
import { z } from 'zod'
import { maskClientId, type AccountProfile, type GoogleAccountStatus, type GoogleClientSaveResult } from '../../shared/accounts'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'
import { AccountError, createAccountCore, REFRESH_MARGIN_MS } from '../accounts/account'
import { allowedUrl, guardedFetch, jsonOf, type HttpFetch } from '../accounts/http'
import { GOOGLE_LOOPBACK, GOOGLE_OAUTH, OAuthError, type TokenSet } from '../accounts/oauth'

export { AccountError, REFRESH_MARGIN_MS }

export const GOOGLE_CLIENT_FILE = 'google-client.bin'
export const GOOGLE_SESSION_FILE = 'google.bin'
/** Contrato 12: leitura das agendas. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
/** CA3: perfil, Drive (só o que o app criou) e, no contrato 12, a agenda (só leitura). */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file', GOOGLE_CALENDAR_SCOPE] as const
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
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
  /** Contrato 12 (CA2): "Permitir acesso à agenda", o consentimento só com o escopo que falta. */
  grantCalendar(): Promise<GoogleAccountStatus>
  cancelSignIn(): boolean
  signOut(): Promise<GoogleAccountStatus>
  /** Token válido para o Drive e a agenda; renova sozinho 60 s antes de vencer, ou na hora com `force` (depois de um 401). */
  accessToken(force?: boolean): Promise<string>
  /**
   * O Drive respondeu 401 mesmo com o token recém-renovado: a conta passa a "Sessão expirada. Entre de novo.",
   * a mesma coisa que a linha da reunião mostra.
   */
  markExpired(): void
  /** Logado e com a sessão valendo. */
  signedIn(): boolean
  /** Logado, com a sessão valendo e a agenda liberada. */
  hasCalendar(): boolean
  email(): string | null
}

export function createGoogleAccount(deps: GoogleAccountDeps): GoogleAccountService {
  const fetch = guardedFetch(deps.fetch)
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

  async function profileOf(_fetch: HttpFetch, tokens: TokenSet, signal: AbortSignal): Promise<AccountProfile> {
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

  const core = createAccountCore<ClientRecord>(
    {
      label: 'Google',
      provider: GOOGLE_OAUTH,
      clientFile: GOOGLE_CLIENT_FILE,
      sessionFile: GOOGLE_SESSION_FILE,
      parseClient: (raw) => {
        const parsed = clientSchema.safeParse(raw)
        return parsed.success ? parsed.data : null
      },
      maskClient: (client) => maskClientId(client.clientId),
      credentials: (client) => ({ clientId: client.clientId, clientSecret: client.clientSecret }),
      // CA3: `offline` + `consent` para o Google mandar o `refresh_token`. Contrato 12: com `include_granted_scopes`,
      // o token novo vale também para o que a pessoa já tinha liberado.
      signInRequest: { scopes: GOOGLE_SCOPES, extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } },
      // Contrato 12 (CA2): só o escopo que falta, na mesma conta (`login_hint`).
      calendarRequest: (email) => ({
        scopes: [GOOGLE_CALENDAR_SCOPE],
        extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', ...(email ? { login_hint: email } : {}) },
      }),
      loopback: GOOGLE_LOOPBACK,
      profile: profileOf,
      hasCalendar: (scope) => scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE),
    },
    { ...deps, fetch },
  )

  return {
    status: core.status,

    saveClient(input) {
      const request = typeof input === 'object' && input !== null ? (input as { clientId?: unknown; clientSecret?: unknown }) : {}
      const clientId = clientIdSchema.safeParse(request.clientId)
      if (!clientId.success) return { ok: false, error: 'invalid-id', status: core.status() }
      const clientSecret = clientSecretSchema.safeParse(request.clientSecret)
      if (!clientSecret.success) return { ok: false, error: 'invalid-secret', status: core.status() }
      try {
        core.writeClient({ clientId: clientId.data, clientSecret: clientSecret.data })
      } catch (error) {
        return { ok: false, error: error instanceof EncryptionUnavailableError ? 'unavailable' : 'failed', status: core.status() }
      }
      core.clearError()
      return { ok: true, status: core.announce() }
    },

    signIn: core.signIn,
    grantCalendar: core.grantCalendar,
    cancelSignIn: core.cancelSignIn,
    signOut: core.signOut,
    accessToken: core.accessToken,
    markExpired: core.markExpired,
    signedIn: core.signedIn,
    hasCalendar: core.hasCalendar,
    email: core.email,
  }
}
