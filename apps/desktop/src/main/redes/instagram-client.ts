// Cliente da Instagram API with Instagram Login (contrato 69, decisão 2 do plan redes-instagram): funções puras sobre um
// `HttpFetch` injetado (`net.fetch` no app, o falso no smoke e nos testes). Trocar a montagem da Meta depois mexe só
// aqui. Toda URL passa por `redesAllowedUrl` com `INSTAGRAM_HOSTS` antes de sair.
//
// O token vai sempre no cabeçalho `Authorization: Bearer`, nunca na URL: assim ele não aparece em log de URL, nem no
// relatório do smoke. A Graph API aceita o cabeçalho também em `/refresh_access_token`; se um dia a Meta recusar ali, a
// troca é só no `auth` daquela chamada (`'query'` põe o `access_token` na consulta, só nela).
import type { HttpFetch, HttpResponse } from '../accounts/http'
import type { RedesAccountType } from '../../shared/redes'
import { fetchWithTimeout, redesAllowedUrl } from './hosts'

export const INSTAGRAM_API_VERSION = 'v27.0'
export const INSTAGRAM_GRAPH = 'https://graph.instagram.com'
/** A Graph API e o upload retomável de vídeo (contrato 71). */
export const INSTAGRAM_HOSTS: readonly string[] = ['graph.instagram.com', 'rupload.facebook.com']

const PROFILE_FIELDS = 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count'

export interface InstagramProfile {
  /** `user_id` da conta profissional. */
  userId: string
  username: string
  name: string | null
  accountType: RedesAccountType
  pictureUrl: string | null
  followers: number | null
  follows: number | null
  mediaCount: number | null
}

export interface InstagramApiError {
  code?: number
  error_subcode?: number
  message?: string
}

/** `code`: o código da Meta (`null` em falha de rede ou resposta que não é da API). */
export type InstagramFailure = { ok: false; error: string; code: number | null; subcode: number | null }
export type InstagramResult<T> = ({ ok: true } & T) | InstagramFailure

export interface InstagramClient {
  me(token: string): Promise<InstagramResult<{ profile: InstagramProfile }>>
  refreshToken(token: string): Promise<InstagramResult<{ accessToken: string; expiresInSeconds: number }>>
}

/** Pelo subcódigo, que é o mais específico (os de publicação ficam para o contrato 71). */
const BY_SUBCODE: Readonly<Record<number, string>> = {
  2207052: 'O Instagram não conseguiu baixar a mídia',
  2207027: 'Mídia ainda não está pronta',
  2207009: 'Proporção fora de 4:5 a 1,91:1',
  2207004: 'Imagem acima de 8 MB',
  2207026: 'Formato de vídeo não aceito',
  2207008: 'Publicação expirou antes de concluir',
  2207050: 'Conta restrita pelo Instagram',
  2207051: 'Bloqueado pelo Instagram como spam',
  2207042: 'Cota de publicações das últimas 24 h esgotada',
}

/** Pelo código, quando o subcódigo não diz nada. */
const BY_CODE: Readonly<Record<number, string>> = {
  190: 'Token recusado pelo Instagram',
  4: 'Limite de chamadas do Instagram; tente mais tarde',
  17: 'Limite de chamadas do Instagram; tente mais tarde',
  80002: 'Limite de chamadas do Instagram; tente mais tarde',
  10: 'Permissão não concedida ao app',
  200: 'Permissão não concedida ao app',
  9004: 'O Instagram não conseguiu baixar a mídia',
  9007: 'Mídia ainda não está pronta',
  36003: 'Proporção fora de 4:5 a 1,91:1',
  36000: 'Imagem acima de 8 MB',
  352: 'Formato de vídeo não aceito',
}

export const INSTAGRAM_NETWORK_ERROR = 'Não foi possível falar com o Instagram'
const INSTAGRAM_UNEXPECTED = 'O Instagram respondeu de um jeito inesperado'

/** Erro da Meta em pt-BR, curto, para a tela. Nunca leva o `message` da Meta (pode trazer dado da conta). */
export function instagramErrorMessage(error: InstagramApiError): string {
  const bySubcode = error.error_subcode !== undefined ? BY_SUBCODE[error.error_subcode] : undefined
  if (bySubcode) return bySubcode
  const byCode = error.code !== undefined ? BY_CODE[error.code] : undefined
  if (byCode) return byCode
  return error.code !== undefined ? `Instagram respondeu com erro ${error.code}` : INSTAGRAM_UNEXPECTED
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const integer = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)
const count = (value: unknown): number | null => {
  const n = integer(value)
  return n !== undefined && n >= 0 ? n : null
}
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function accountTypeOf(value: unknown): RedesAccountType {
  const raw = typeof value === 'string' ? value.toLowerCase() : ''
  if (raw === 'business') return 'business'
  if (raw.includes('creator')) return 'creator'
  return 'desconhecido'
}

function failure(error: string, code: number | null = null, subcode: number | null = null): InstagramFailure {
  return { ok: false, error, code, subcode }
}

async function jsonBody(response: HttpResponse): Promise<Record<string, unknown> | null> {
  try {
    return record(JSON.parse(await response.text()) as unknown)
  } catch {
    return null
  }
}

/** O `{ error: { code, error_subcode } }` da Meta em `InstagramFailure`. */
function apiFailure(status: number, body: Record<string, unknown> | null): InstagramFailure {
  const error = record(body?.['error'])
  const code = integer(error?.['code'])
  const subcode = integer(error?.['error_subcode'])
  if (code === undefined) return failure(`Instagram respondeu ${status}`)
  return failure(instagramErrorMessage({ code, ...(subcode !== undefined ? { error_subcode: subcode } : {}) }), code, subcode ?? null)
}

export function createInstagramClient(fetch: HttpFetch, options: { base?: string } = {}): InstagramClient {
  const base = options.base ?? INSTAGRAM_GRAPH

  /** GET com o token no cabeçalho (`auth: 'header'`) ou, se um endpoint recusar o cabeçalho, na consulta. */
  const get = async (path: string, query: Record<string, string>, token: string, auth: 'header' | 'query' = 'header'): Promise<{ status: number; body: Record<string, unknown> | null } | InstagramFailure> => {
    const url = new URL(path, base)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    if (auth === 'query') url.searchParams.set('access_token', token)
    if (!redesAllowedUrl(url.toString(), INSTAGRAM_HOSTS)) return failure('Destino fora da lista do Instagram')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (auth === 'header') headers['authorization'] = `Bearer ${token}`
    try {
      // 15 s com a leitura do corpo (`fetchWithTimeout`); o tempo esgotado conta como falha de rede.
      return await fetchWithTimeout(fetch, url.toString(), { method: 'GET', headers }, async (response) => ({ status: response.status, body: await jsonBody(response) }))
    } catch {
      return failure(INSTAGRAM_NETWORK_ERROR)
    }
  }

  return {
    async me(token) {
      const result = await get(`/${INSTAGRAM_API_VERSION}/me`, { fields: PROFILE_FIELDS }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const body = result.body
      const rawId = body?.['user_id'] ?? body?.['id']
      const userId = typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId : ''
      const username = text(body?.['username'])
      if (!/^\d{1,32}$/.test(userId) || !username) return failure(INSTAGRAM_UNEXPECTED)
      return {
        ok: true,
        profile: {
          userId,
          username,
          name: text(body?.['name']),
          accountType: accountTypeOf(body?.['account_type']),
          pictureUrl: text(body?.['profile_picture_url']),
          followers: count(body?.['followers_count']),
          follows: count(body?.['follows_count']),
          mediaCount: count(body?.['media_count']),
        },
      }
    },

    async refreshToken(token) {
      // Sem versão no caminho, como na documentação da Meta. Cabeçalho `Bearer` (veja o comentário do topo).
      const result = await get('/refresh_access_token', { grant_type: 'ig_refresh_token' }, token, 'header')
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const accessToken = text(result.body?.['access_token'])
      const expiresIn = integer(result.body?.['expires_in'])
      if (!accessToken || /\s/.test(accessToken) || expiresIn === undefined || expiresIn <= 0) return failure(INSTAGRAM_UNEXPECTED)
      return { ok: true, accessToken, expiresInSeconds: expiresIn }
    },
  }
}
