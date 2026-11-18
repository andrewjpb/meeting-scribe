// Microsoft falsa, em memória, para os testes e o smoke (contrato 12, CA1 e CA12): o endpoint de token do
// `login.microsoftonline.com` (cliente público: sem chave secreta, com PKCE), o perfil e a foto do Graph, a lista das
// agendas e o `calendarView`. Nada sai da máquina: o `fetch` dela responde as URLs de verdade sem rede. O
// "navegador" é `approve`, que confere a URL de autorização e devolve o endereço de volta com o código. Os tokens
// são inventados e nunca aparecem fora daqui.
import { createHash } from 'node:crypto'
import type { HttpFetch, HttpResponse } from '../accounts/http'

export interface FakeMicrosoftOptions {
  clientId: string
  profile?: { name: string; email: string }
  /** Sem foto, `/me/photo/$value` responde 404, como numa conta sem foto. */
  photo?: Uint8Array | null
}

export interface FakeMicrosoft {
  fetch: HttpFetch
  photo: Uint8Array | null
  approve(authUrl: string, options?: { deny?: boolean; state?: string }): string
  /** Pedidos recebidos: método, servidor e caminho (sem a consulta, sem cabeçalho, sem corpo). */
  calls: { method: string; host: string; path: string }[]
  /** A renovação responde `invalid_grant`. */
  refreshRevoked: boolean
  /** Os próximos pedidos ao Graph falham por rede. */
  offline: number
  calendars: { id: string; name: string; isDefaultCalendar: boolean }[]
  /** Eventos crus (formato do Graph) por id de agenda; `default` é a principal (`/me/calendarView`). */
  events: Map<string, unknown[]>
  /** Leituras do `calendarView`: a agenda, a janela e o cabeçalho `Prefer`. */
  eventReads: { calendarId: string; startDateTime: string; endDateTime: string; prefer: string }[]
  /** Eventos buscados pelo id. */
  eventLookups: string[]
  /** Corpos dos pedidos de token: só os nomes dos campos (para conferir que não vai chave secreta). */
  tokenFields: string[][]
  accessTokens(): string[]
  refreshTokens(): string[]
}

const response = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => {
  const bytes = body instanceof Uint8Array ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
  return {
    status,
    header: (name) => lower[name.toLowerCase()] ?? null,
    text: () => Promise.resolve(Buffer.from(bytes).toString('utf8')),
    bytes: () => Promise.resolve(bytes),
  }
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQt8r+DwADBAHEUZJjfgAAAABJRU5ErkJggg==', 'base64')
const GRANTED = 'openid profile email https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read'

export function createFakeMicrosoft(options: FakeMicrosoftOptions): FakeMicrosoft {
  const profile = options.profile ?? { name: 'Pessoa de Teste', email: 'pessoa.teste@example.com' }
  const codes = new Map<string, { challenge: string; redirectUri: string }>()
  const access = new Set<string>()
  const refresh = new Set<string>()
  let counter = 0
  const next = (prefix: string): string => `${prefix}${(++counter).toString(36)}`

  const fake: FakeMicrosoft = {
    photo: options.photo === undefined ? TINY_PNG : options.photo,
    calls: [],
    refreshRevoked: false,
    offline: 0,
    calendars: [{ id: 'AAMkAGI2-calendario-principal', name: 'Calendário', isDefaultCalendar: true }],
    events: new Map(),
    eventReads: [],
    eventLookups: [],
    tokenFields: [],
    accessTokens: () => [...access],
    refreshTokens: () => [...refresh],

    approve(authUrl, { deny = false, state } = {}) {
      const url = new URL(authUrl)
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const back = new URL(redirectUri)
      back.searchParams.set('state', state ?? url.searchParams.get('state') ?? '')
      if (deny) {
        back.searchParams.set('error', 'access_denied')
        return back.toString()
      }
      if (url.searchParams.get('client_id') !== options.clientId || url.searchParams.get('code_challenge_method') !== 'S256' || !/^http:\/\/localhost:\d+$/.test(redirectUri)) {
        back.searchParams.set('error', 'invalid_request')
        return back.toString()
      }
      const code = next('codigo-ms-falso-')
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri })
      back.searchParams.set('code', code)
      return back.toString()
    },

    async fetch(rawUrl, init) {
      const url = new URL(rawUrl)
      fake.calls.push({ method: init.method, host: url.host, path: url.pathname })
      const body = init.body === undefined ? '' : typeof init.body === 'string' ? init.body : Buffer.from(init.body).toString('utf8')

      if (url.host === 'login.microsoftonline.com' && url.pathname === '/common/oauth2/v2.0/token' && init.method === 'POST') {
        const fields = new URLSearchParams(body)
        fake.tokenFields.push([...fields.keys()].sort())
        // Cliente público: chave secreta é recusada (AADSTS700025).
        if (fields.get('client_id') !== options.clientId || fields.has('client_secret')) return response(401, { error: 'invalid_client' })
        if (fields.get('grant_type') === 'authorization_code') {
          const issued = codes.get(fields.get('code') ?? '')
          codes.delete(fields.get('code') ?? '')
          const challenge = createHash('sha256')
            .update(fields.get('code_verifier') ?? '')
            .digest('base64url')
          if (!issued || issued.challenge !== challenge || issued.redirectUri !== fields.get('redirect_uri')) return response(400, { error: 'invalid_grant' })
          const accessToken = next('token-ms-acesso-falso-')
          const refreshToken = next('token-ms-renovacao-falso-')
          access.add(accessToken)
          refresh.add(refreshToken)
          return response(200, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3599, scope: GRANTED, token_type: 'Bearer' })
        }
        if (fields.get('grant_type') === 'refresh_token') {
          const old = fields.get('refresh_token') ?? ''
          if (fake.refreshRevoked || !refresh.has(old)) return response(400, { error: 'invalid_grant', error_description: 'AADSTS70000: The provided grant has expired.' })
          // A Microsoft troca o refresh token a cada renovação.
          refresh.delete(old)
          const accessToken = next('token-ms-acesso-falso-')
          const refreshToken = next('token-ms-renovacao-falso-')
          access.add(accessToken)
          refresh.add(refreshToken)
          return response(200, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3599, scope: GRANTED, token_type: 'Bearer' })
        }
        return response(400, { error: 'unsupported_grant_type' })
      }

      if (url.host !== 'graph.microsoft.com') return response(404, { error: { code: 'NotFound' } })
      if (fake.offline > 0) {
        fake.offline--
        return Promise.reject(new TypeError('fetch failed'))
      }
      const bearer = (init.headers['authorization'] ?? '').replace(/^Bearer /, '')
      if (!access.has(bearer)) return response(401, { error: { code: 'InvalidAuthenticationToken' } })

      if (url.pathname === '/v1.0/me') return response(200, { displayName: profile.name, mail: profile.email, userPrincipalName: profile.email })
      if (url.pathname === '/v1.0/me/photo/$value') return fake.photo ? response(200, fake.photo, { 'content-type': 'image/png' }) : response(404, { error: { code: 'ImageNotFound' } })
      if (url.pathname === '/v1.0/me/calendars') return response(200, { value: fake.calendars })
      // Um evento pelo id (a confirmação do cancelamento): de qualquer agenda, ou 404 (apagado).
      const one = /^\/v1\.0\/me\/events\/([^/]+)$/.exec(url.pathname)
      if (one) {
        const id = decodeURIComponent(one[1] ?? '')
        fake.eventLookups.push(id)
        const found = [...fake.events.values()].flat().find((item) => (item as { id?: unknown }).id === id)
        return found ? response(200, found) : response(404, { error: { code: 'ErrorItemNotFound' } })
      }
      const view = url.pathname === '/v1.0/me/calendarView' ? 'default' : decodeURIComponent(/^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname)?.[1] ?? '')
      if (view) {
        fake.eventReads.push({ calendarId: view, startDateTime: url.searchParams.get('startDateTime') ?? '', endDateTime: url.searchParams.get('endDateTime') ?? '', prefer: init.headers['prefer'] ?? '' })
        const primary = fake.calendars.find((item) => item.isDefaultCalendar)?.id
        const items = fake.events.get(view) ?? (view === primary ? fake.events.get('default') : undefined)
        return response(200, { value: items ?? [] })
      }
      return response(404, { error: { code: 'NotFound' } })
    },
  }
  return fake
}
