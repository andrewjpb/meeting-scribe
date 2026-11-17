// Conta Microsoft (contrato 12, CA1): o "ID do aplicativo (cliente)" registrado no Microsoft Entra (cliente
// público, sem chave secreta), o login pelo navegador no endpoint comum com PKCE e volta em
// `http://localhost:<porta>`, o perfil do Graph (nome, e-mail e foto), a renovação e "Sair". O cadastro fica em
// `userData/accounts/microsoft-client.bin` e a sessão em `userData/accounts/microsoft.bin`, cifrados com
// `safeStorage`, no mesmo ciclo da conta Google (`accounts/account.ts`). A Microsoft não tem revogação pelo app:
// "Sair" apaga a sessão deste Mac. Tokens nunca saem do main nem vão para log.
import { z } from 'zod'
import { maskClientId, type AccountProfile, type MicrosoftAccountStatus, type MicrosoftClientSaveResult } from '../../shared/accounts'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'
import { createAccountCore } from '../accounts/account'
import { guardedFetch, jsonOf, type HttpFetch } from '../accounts/http'
import { MICROSOFT_LOOPBACK, MICROSOFT_OAUTH, OAuthError, type TokenSet } from '../accounts/oauth'

export const MICROSOFT_CLIENT_FILE = 'microsoft-client.bin'
export const MICROSOFT_SESSION_FILE = 'microsoft.bin'
/** CA1: perfil, `offline_access` (o refresh token) e a agenda, só leitura. */
export const MICROSOFT_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Calendars.Read'] as const
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
export const GRAPH_ME_URL = `${GRAPH_BASE}/me?$select=displayName,mail,userPrincipalName`
export const GRAPH_PHOTO_URL = `${GRAPH_BASE}/me/photo/$value`
const PHOTO_MAX_BYTES = 2 * 1024 * 1024

/** O ID do aplicativo é um GUID. */
const clientIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const clientSchema = z.object({ clientId: clientIdSchema })
type ClientRecord = z.infer<typeof clientSchema>

export interface MicrosoftAccountDeps {
  dir: string
  safeStorage: SafeStorageLike
  fetch: HttpFetch
  openExternal: (url: string) => Promise<void> | void
  /** Foto baixada para data URL com até 256 px; `null` se não for imagem. */
  photoToDataUrl: (bytes: Uint8Array) => string | null
  onStatus: (status: MicrosoftAccountStatus) => void
  onSignedIn?: (email: string) => void
  onSignedOut?: () => void
  now?: () => number
  timeoutMs?: number
  randomBytes?: (size: number) => Uint8Array
}

export interface MicrosoftAccountService {
  status(): MicrosoftAccountStatus
  saveClient(input: unknown): MicrosoftClientSaveResult
  signIn(): Promise<MicrosoftAccountStatus>
  cancelSignIn(): boolean
  signOut(): Promise<MicrosoftAccountStatus>
  accessToken(force?: boolean): Promise<string>
  markExpired(): void
  signedIn(): boolean
  hasCalendar(): boolean
  email(): string | null
}

export function createMicrosoftAccount(deps: MicrosoftAccountDeps): MicrosoftAccountService {
  const fetch = guardedFetch(deps.fetch)

  async function photoOf(token: string, signal: AbortSignal): Promise<string | null> {
    try {
      const response = await fetch(GRAPH_PHOTO_URL, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'image/*' }, signal })
      // 404: a conta não tem foto.
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
      response = await fetch(GRAPH_ME_URL, { method: 'GET', headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json' }, signal })
    } catch {
      throw new OAuthError(signal.aborted ? 'cancelled' : 'network', 'perfil')
    }
    const body = (await jsonOf(response)) as Record<string, unknown> | null
    if (response.status !== 200 || !body) throw new OAuthError('network', `perfil http ${response.status}`)
    const mail = typeof body['mail'] === 'string' && body['mail'] ? body['mail'] : typeof body['userPrincipalName'] === 'string' ? body['userPrincipalName'] : ''
    const email = mail.slice(0, 320)
    const name = typeof body['displayName'] === 'string' && body['displayName'].trim() ? body['displayName'].trim().slice(0, 200) : email
    return { name, email, photo: await photoOf(tokens.accessToken, signal) }
  }

  const core = createAccountCore<ClientRecord>(
    {
      label: 'Microsoft',
      provider: MICROSOFT_OAUTH,
      clientFile: MICROSOFT_CLIENT_FILE,
      sessionFile: MICROSOFT_SESSION_FILE,
      parseClient: (raw) => {
        const parsed = clientSchema.safeParse(raw)
        return parsed.success ? parsed.data : null
      },
      maskClient: (client) => maskClientId(client.clientId),
      credentials: (client) => ({ clientId: client.clientId }),
      signInRequest: { scopes: MICROSOFT_SCOPES },
      // O login já pede a agenda: não há consentimento à parte.
      calendarRequest: null,
      loopback: MICROSOFT_LOOPBACK,
      refreshScope: MICROSOFT_SCOPES.join(' '),
      profile: profileOf,
      hasCalendar: (scope) => scope.split(/\s+/).some((item) => /(^|\/)calendars\.read$/i.test(item)),
    },
    { ...deps, fetch },
  )

  return {
    status: core.status,

    saveClient(input) {
      const request = typeof input === 'object' && input !== null ? (input as { clientId?: unknown }) : {}
      const clientId = clientIdSchema.safeParse(request.clientId)
      if (!clientId.success) return { ok: false, error: 'invalid-id', status: core.status() }
      try {
        core.writeClient({ clientId: clientId.data.toLowerCase() })
      } catch (error) {
        return { ok: false, error: error instanceof EncryptionUnavailableError ? 'unavailable' : 'failed', status: core.status() }
      }
      core.clearError()
      return { ok: true, status: core.announce() }
    },

    signIn: core.signIn,
    cancelSignIn: core.cancelSignIn,
    signOut: core.signOut,
    accessToken: core.accessToken,
    markExpired: core.markExpired,
    signedIn: core.signedIn,
    hasCalendar: core.hasCalendar,
    email: core.email,
  }
}
