// Instagram falso, em memória, para os testes e o smoke (contrato 69): responde as URLs de verdade da Graph API
// (`graph.instagram.com`) sem rede. `GET /v27.0/me` devolve o perfil para um token válido no `Authorization: Bearer`;
// `GET /refresh_access_token` troca um token válido por um novo; o resto é 404. Os tokens são inventados e nunca aparecem
// fora daqui: `calls` guarda só o método, o servidor e o caminho (sem consulta, sem cabeçalho). O relógio (`now`,
// adiantado por `skewMs`) é o mesmo que o serviço usa no smoke, para "passar" 7 ou 61 dias sem esperar.
import type { HttpFetch, HttpResponse } from '../accounts/http'
import { INSTAGRAM_API_VERSION } from './instagram-client'

/** Token inventado que o smoke cola em Configurações › Contas › Instagram (começa com `IGAA`, como o de verdade). */
export const SMOKE_IG_TOKEN = 'IGAAsmokeTokenFalso0000000000000000000000'
export const SMOKE_IG_USERNAME = 'lap.teste'
export const SMOKE_IG_USER_ID = '17841400000000001'
/** O falso recusa a renovação deste token com o erro 190 (token revogado). */
export const SMOKE_IG_REVOKED_TOKEN = 'revogado'
/** `expires_in` da renovação, como a Meta responde (~60 dias). */
export const FAKE_IG_REFRESH_EXPIRES_IN = 5183944

export interface FakeInstagramProfile {
  user_id: string
  username: string
  name: string | null
  account_type: string
  profile_picture_url?: string
  followers_count: number
  follows_count: number
  media_count: number
}

export interface FakeInstagramOptions {
  profile?: FakeInstagramProfile
  validToken?: string
  now?: () => number
}

export interface FakeInstagram {
  fetch: HttpFetch
  /** O relógio do smoke: o de verdade mais `skewMs`. */
  now(): number
  skewMs: number
  /** Pedidos recebidos: método, servidor e caminho (sem a consulta, sem cabeçalho). */
  calls: { method: string; host: string; path: string; bearer: boolean; tokenInQuery: boolean }[]
  /** Todos os tokens que o falso já aceitou ou emitiu (os testes conferem que nenhum vazou). */
  tokens(): string[]
  /** Revoga um token (a próxima renovação com ele responde 190). */
  revoke(token: string): void
}

const response = (status: number, body: unknown): HttpResponse => {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8')
  return {
    status,
    header: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    text: () => Promise.resolve(bytes.toString('utf8')),
    bytes: () => Promise.resolve(new Uint8Array(bytes)),
  }
}

const oauthError = (): HttpResponse => response(400, { error: { message: 'Invalid OAuth access token - Cannot parse access token', type: 'OAuthException', code: 190, fbtrace_id: 'smoke' } })

export const DEFAULT_FAKE_IG_PROFILE: FakeInstagramProfile = {
  user_id: SMOKE_IG_USER_ID,
  username: SMOKE_IG_USERNAME,
  name: 'LAP Teste',
  account_type: 'Business',
  followers_count: 1284,
  follows_count: 210,
  media_count: 37,
}

export function createFakeInstagram(options: FakeInstagramOptions = {}): FakeInstagram {
  const profile = options.profile ?? DEFAULT_FAKE_IG_PROFILE
  const valid = new Set<string>([options.validToken ?? SMOKE_IG_TOKEN])
  const issued = new Set<string>(valid)
  const revoked = new Set<string>([SMOKE_IG_REVOKED_TOKEN])
  const base = options.now ?? Date.now
  let renewals = 0

  const fake: FakeInstagram = {
    skewMs: 0,
    now: () => base() + fake.skewMs,
    calls: [],
    tokens: () => [...issued],
    revoke: (token) => {
      revoked.add(token)
      valid.delete(token)
    },
    fetch: (url, init) => {
      const parsed = new URL(url)
      const auth = init.headers['authorization'] ?? init.headers['Authorization'] ?? ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
      const token = bearer ?? parsed.searchParams.get('access_token')
      fake.calls.push({ method: init.method, host: parsed.host, path: parsed.pathname, bearer: bearer !== null, tokenInQuery: parsed.searchParams.has('access_token') })
      if (parsed.host !== 'graph.instagram.com') return Promise.resolve(response(404, { error: { message: 'not found', code: 803 } }))
      if (init.method === 'GET' && parsed.pathname === `/${INSTAGRAM_API_VERSION}/me`) {
        if (!token || !valid.has(token)) return Promise.resolve(oauthError())
        return Promise.resolve(response(200, { ...profile, id: profile.user_id }))
      }
      if (init.method === 'GET' && parsed.pathname === '/refresh_access_token') {
        if (parsed.searchParams.get('grant_type') !== 'ig_refresh_token') return Promise.resolve(response(400, { error: { message: 'grant_type', code: 100 } }))
        if (!token || revoked.has(token) || !valid.has(token)) return Promise.resolve(oauthError())
        renewals++
        const next = `IGAAsmokeRenovado${String(renewals).padStart(4, '0')}${'0'.repeat(20)}`
        valid.add(next)
        issued.add(next)
        return Promise.resolve(response(200, { access_token: next, token_type: 'bearer', expires_in: FAKE_IG_REFRESH_EXPIRES_IN }))
      }
      return Promise.resolve(response(404, { error: { message: 'Unsupported get request', code: 100 } }))
    },
  }
  return fake
}
