// Cliente da Instagram API with Instagram Login (contrato 69, decisão 2 do plan redes-instagram): funções puras sobre um
// `HttpFetch` injetado (`net.fetch` no app, o falso no smoke e nos testes). Trocar a montagem da Meta depois mexe só
// aqui. Toda URL passa por `redesAllowedUrl` com `INSTAGRAM_HOSTS` antes de sair.
//
// O token vai sempre no cabeçalho `Authorization: Bearer`, nunca na URL: assim ele não aparece em log de URL, nem no
// relatório do smoke. A Graph API aceita o cabeçalho também em `/refresh_access_token`; se um dia a Meta recusar ali, a
// troca é só no `auth` daquela chamada (`'query'` põe o `access_token` na consulta, só nela).
import type { HttpFetch, HttpMethod, HttpResponse } from '../accounts/http'
import type { PublicationQuota, RedesAccountType } from '../../shared/redes'
import { fetchWithTimeout, REDES_REQUEST_TIMEOUT_MS, redesAllowedUrl } from './hosts'

export const INSTAGRAM_API_VERSION = 'v27.0'
export const INSTAGRAM_GRAPH = 'https://graph.instagram.com'
/** A Graph API e o upload retomável de vídeo (contrato 71). */
export const INSTAGRAM_HOSTS: readonly string[] = ['graph.instagram.com', 'rupload.facebook.com']
/** Contrato 71: o host do upload retomável do vídeo. */
export const RUPLOAD_HOST = 'rupload.facebook.com'

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

/** Status do contêiner (`status_code`): `status` é o texto da Meta, que traz o código do erro em `ERROR`. */
export type ContainerStatusCode = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'

/** Corpo do `POST /<IG_ID>/media` (contrato 71): imagem, item de carrossel, carrossel ou Reels retomável. */
export type ContainerBody = Record<string, string | boolean>

export interface InstagramClient {
  me(token: string): Promise<InstagramResult<{ profile: InstagramProfile }>>
  refreshToken(token: string): Promise<InstagramResult<{ accessToken: string; expiresInSeconds: number }>>
  /** Contrato 71: cria o contêiner; o Reels retomável devolve também a `uri` do upload em `rupload.facebook.com`. */
  createContainer(token: string, igUserId: string, body: ContainerBody): Promise<InstagramResult<{ id: string; uri: string | null }>>
  containerStatus(token: string, id: string): Promise<InstagramResult<{ statusCode: ContainerStatusCode | null; status: string | null }>>
  publishContainer(token: string, igUserId: string, creationId: string): Promise<InstagramResult<{ id: string }>>
  /** Campos de uma mídia (ou de um contêiner), só os textos e números pedidos. */
  mediaInfo(token: string, mediaId: string, fields: readonly string[]): Promise<InstagramResult<{ data: Record<string, string | number> }>>
  /** `content_publishing_limit`: o uso e o teto das últimas 24 h. */
  publishingLimit(token: string, igUserId: string): Promise<InstagramResult<{ quota: PublicationQuota }>>
  /** Upload retomável do vídeo, de uma vez (`offset: 0`), com o token no cabeçalho `Authorization: OAuth`. */
  uploadResumable(token: string, uri: string, bytes: Uint8Array): Promise<InstagramResult<object>>
}

/** O upload do vídeo: 15 s mais 1 s a cada 256 KB (300 MB dão uns 20 min). */
export const uploadTimeoutMs = (bytes: number): number => REDES_REQUEST_TIMEOUT_MS + Math.ceil(bytes / (256 * 1024)) * 1000

const CONTAINER_STATUS_CODES: readonly ContainerStatusCode[] = ['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED']
const META_ID = /^\d{1,40}$/
const idOf = (value: unknown): string | null => {
  const raw = typeof value === 'number' && Number.isInteger(value) ? String(value) : value
  return typeof raw === 'string' && META_ID.test(raw) ? raw : null
}

/** Pelo subcódigo, que é o mais específico (os de publicação são do contrato 71). */
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

  /**
   * Pedido com o token no cabeçalho (`auth: 'header'`) ou, se um endpoint recusar o cabeçalho, na consulta. `body` vai
   * como JSON (a Graph API aceita JSON no `POST` com o `Bearer`).
   */
  const call = async (method: HttpMethod, path: string, query: Record<string, string>, token: string, options: { auth?: 'header' | 'query'; body?: Record<string, unknown> } = {}): Promise<{ status: number; body: Record<string, unknown> | null } | InstagramFailure> => {
    const auth = options.auth ?? 'header'
    const url = new URL(path, base)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    if (auth === 'query') url.searchParams.set('access_token', token)
    if (!redesAllowedUrl(url.toString(), INSTAGRAM_HOSTS)) return failure('Destino fora da lista do Instagram')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (auth === 'header') headers['authorization'] = `Bearer ${token}`
    if (options.body) headers['content-type'] = 'application/json'
    try {
      // 15 s com a leitura do corpo (`fetchWithTimeout`); o tempo esgotado conta como falha de rede.
      return await fetchWithTimeout(fetch, url.toString(), { method, headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}) }, async (response) => ({ status: response.status, body: await jsonBody(response) }))
    } catch {
      return failure(INSTAGRAM_NETWORK_ERROR)
    }
  }
  const get = (path: string, query: Record<string, string>, token: string, auth: 'header' | 'query' = 'header') => call('GET', path, query, token, { auth })
  const version = (path: string): string => `/${INSTAGRAM_API_VERSION}/${path}`

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

    async createContainer(token, igUserId, body) {
      if (!META_ID.test(igUserId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await call('POST', version(`${igUserId}/media`), {}, token, { body })
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const id = idOf(result.body?.['id'])
      if (!id) return failure(INSTAGRAM_UNEXPECTED)
      // Só a `uri` do próprio upload retomável da Meta (o host é conferido de novo no upload).
      const uri = text(result.body?.['uri'])
      return { ok: true, id, uri: uri && redesAllowedUrl(uri, [RUPLOAD_HOST]) ? uri : null }
    },

    async containerStatus(token, id) {
      if (!META_ID.test(id)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await get(version(id), { fields: 'status_code,status' }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const raw = result.body?.['status_code']
      const statusCode = CONTAINER_STATUS_CODES.find((code) => code === raw) ?? null
      return { ok: true, statusCode, status: text(result.body?.['status']) }
    },

    async publishContainer(token, igUserId, creationId) {
      if (!META_ID.test(igUserId) || !META_ID.test(creationId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await call('POST', version(`${igUserId}/media_publish`), {}, token, { body: { creation_id: creationId } })
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const id = idOf(result.body?.['id'])
      return id ? { ok: true, id } : failure(INSTAGRAM_UNEXPECTED)
    },

    async mediaInfo(token, mediaId, fields) {
      if (!META_ID.test(mediaId) || !fields.every((field) => /^[a-z_]{1,40}$/.test(field))) return failure(INSTAGRAM_UNEXPECTED)
      const result = await get(version(mediaId), { fields: fields.join(',') }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const data: Record<string, string | number> = {}
      for (const field of fields) {
        const value = result.body?.[field]
        if (typeof value === 'string' || typeof value === 'number') data[field] = value
      }
      return { ok: true, data }
    },

    async publishingLimit(token, igUserId) {
      if (!META_ID.test(igUserId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await get(version(`${igUserId}/content_publishing_limit`), { fields: 'quota_usage,config' }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      // `{ data: [{ quota_usage, config: { quota_total, quota_duration } }] }`; o `quota_total` solto também vale.
      const data = Array.isArray(result.body?.['data']) ? record((result.body['data'] as unknown[])[0]) : null
      const used = count(data?.['quota_usage'])
      const total = count(record(data?.['config'])?.['quota_total'] ?? data?.['quota_total'])
      if (used === null || total === null) return failure(INSTAGRAM_UNEXPECTED)
      return { ok: true, quota: { used, total, checkedAt: new Date().toISOString() } }
    },

    async uploadResumable(token, uri, bytes) {
      if (!redesAllowedUrl(uri, [RUPLOAD_HOST])) return failure('Destino fora da lista do Instagram')
      // O upload retomável pede o token no formato `OAuth <token>` (não `Bearer`), também no cabeçalho.
      const headers = { authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.byteLength), 'content-type': 'application/octet-stream' }
      try {
        const result = await fetchWithTimeout(fetch, uri, { method: 'POST', headers, body: bytes }, async (response) => ({ status: response.status, body: await jsonBody(response) }), uploadTimeoutMs(bytes.byteLength))
        if (result.status !== 200) return apiFailure(result.status, result.body)
        return result.body?.['success'] === false ? failure('O Instagram recusou o envio do vídeo') : { ok: true }
      } catch {
        return failure(INSTAGRAM_NETWORK_ERROR)
      }
    },
  }
}
