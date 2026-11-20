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
  // 73: comentários
  /** Os comentários de uma mídia (até 50, a primeira página), cada um com as respostas aninhadas. */
  comments(token: string, mediaId: string): Promise<InstagramResult<{ comments: InstagramComment[] }>>
  /** Responde a um comentário; devolve o id da resposta. */
  replyComment(token: string, commentId: string, message: string): Promise<InstagramResult<{ id: string }>>
  /** Oculta (`hide: true`) ou mostra de novo um comentário. */
  hideComment(token: string, commentId: string, hide: boolean): Promise<InstagramResult<object>>
  deleteComment(token: string, commentId: string): Promise<InstagramResult<object>>
  // fim 73
  // 74: mensagens
  /** As conversas da caixa de mensagens diretas (`/me/conversations?platform=instagram`), a primeira página. */
  conversations(token: string): Promise<MessagingResult<{ conversations: InstagramConversation[] }>>
  /** As mensagens de uma conversa: só as 20 mais recentes vêm com detalhe; as outras só contam (`olderCount`). */
  conversationMessages(token: string, conversationId: string): Promise<MessagingResult<{ messages: InstagramDirectMessage[]; olderCount: number }>>
  /** Responde ao contato (`POST /<IG_ID>/messages`), só texto. */
  sendMessage(token: string, igUserId: string, recipientId: string, text: string): Promise<MessagingResult<{ messageId: string | null }>>
  // fim 74
  // 75: métricas
  /** As mídias mais recentes da conta (`limit` até 100), da mais nova para a mais antiga. Contrato 73 reaproveita. */
  recentMedia(token: string, igUserId: string, limit?: number): Promise<InstagramResult<{ media: InstagramMedia[] }>>
  /**
   * Insights da conta entre `since` e `until` (UNIX, em segundos), `period=day` e `metric_type=total_value`: o total de
   * cada métrica pedida. A métrica que não veio na resposta fica fora de `values` (a tela mostra "—"). Com
   * `breakdown: 'follow_type'`, o `follows_and_unfollows` vem separado em ganhos e perdidos (`follows`).
   */
  accountInsights(token: string, igUserId: string, since: number, until: number, options?: { metrics?: readonly AccountMetric[]; breakdown?: 'follow_type' }): Promise<InstagramResult<{ values: Partial<Record<AccountMetric, number>>; follows: { follows: number; unfollows: number } | null }>>
  /** Insights de uma mídia desde que saiu; a métrica que não veio fica fora de `values`. */
  mediaInsights(token: string, mediaId: string, metrics?: readonly MediaMetric[]): Promise<InstagramResult<{ values: Partial<Record<MediaMetric, number>> }>>
  /** Os seguidores de agora (`/me?fields=followers_count`). */
  followersCount(token: string): Promise<InstagramResult<{ followers: number | null }>>
  // fim 75
}

// 75: métricas
/** Uma mídia publicada da conta, como `GET /<IG_ID>/media` devolve. */
export interface InstagramMedia {
  id: string
  caption: string
  /** `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM`. */
  mediaType: string
  permalink: string | null
  mediaUrl: string | null
  /** Só vídeo e Reels: a capa. */
  thumbnailUrl: string | null
  /** ISO. */
  timestamp: string
  commentsCount: number | null
}

/** As métricas da conta (`/<IG_ID>/insights`), na ordem da spec; `impressions` não existe mais. */
export const ACCOUNT_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'saves', 'shares', 'follows_and_unfollows', 'profile_links_taps'] as const
export type AccountMetric = (typeof ACCOUNT_METRICS)[number]
/** As métricas de uma mídia (`/<MEDIA_ID>/insights`); as mesmas para imagem, carrossel e vídeo/Reels. */
export const MEDIA_METRICS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'] as const
export type MediaMetric = (typeof MEDIA_METRICS)[number]
const MEDIA_FIELDS = 'id,caption,media_type,permalink,media_url,thumbnail_url,timestamp,comments_count'
// fim 75

// 73: comentários
/** Um comentário como `GET /<MEDIA_ID>/comments` devolve; as respostas só um nível abaixo (o Instagram não tem mais). */
export interface InstagramComment {
  id: string
  parentId: string | null
  text: string
  username: string
  /** Vazio quando a Meta não manda o `from`. */
  fromId: string
  /** ISO. */
  timestamp: string
  hidden: boolean
  likeCount: number
  replies: InstagramComment[]
}
const COMMENT_FIELDS = 'id,text,timestamp,username,from,hidden,like_count,parent_id'
const COMMENTS_FIELDS = `${COMMENT_FIELDS},replies{${COMMENT_FIELDS.replace(',parent_id', '')}}`
/** Os comentários lidos de uma vez por mídia (a primeira página). */
export const COMMENTS_PAGE_LIMIT = 50
/** O texto de terceiros guardado: até 2.200 pontos de código (o dobro em UTF-16); o resto é cortado. */
const COMMENT_TEXT_KEEP = 4400
// fim 73

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

// 75: métricas
/** As linhas `data[]` de uma resposta de insights, com o `name` de cada uma. */
function insightRows(body: Record<string, unknown> | null): { name: string; row: Record<string, unknown> }[] {
  const rows = Array.isArray(body?.['data']) ? (body['data'] as unknown[]) : []
  return rows.flatMap((raw) => {
    const row = record(raw)
    const name = typeof row?.['name'] === 'string' ? row['name'] : null
    return row && name ? [{ name, row }] : []
  })
}

/** `follows_and_unfollows` com `breakdown=follow_type`: `FOLLOWER` são os ganhos, `NON_FOLLOWER` os perdidos. */
function followsOf(total: Record<string, unknown> | null): { follows: number; unfollows: number } | null {
  const breakdowns = Array.isArray(total?.['breakdowns']) ? (total['breakdowns'] as unknown[]) : []
  const results = breakdowns.flatMap((raw) => {
    const list = record(raw)?.['results']
    return Array.isArray(list) ? (list as unknown[]) : []
  })
  let follows: number | null = null
  let unfollows: number | null = null
  for (const raw of results) {
    const item = record(raw)
    const dimension = Array.isArray(item?.['dimension_values']) ? (item['dimension_values'] as unknown[])[0] : null
    const value = count(item?.['value'])
    if (value === null) continue
    if (dimension === 'FOLLOWER') follows = (follows ?? 0) + value
    else if (dimension === 'NON_FOLLOWER') unfollows = (unfollows ?? 0) + value
  }
  return follows === null && unfollows === null ? null : { follows: follows ?? 0, unfollows: unfollows ?? 0 }
}
// fim 75

// 74: mensagens
/** `denied`: a Meta recusou o acesso às mensagens (permissão, Standard Access, "Permitir acesso" desligado). */
export type MessagingFailure = InstagramFailure & { denied: boolean }
export type MessagingResult<T> = ({ ok: true } & T) | MessagingFailure

export interface InstagramParticipant {
  id: string
  username: string
  name: string | null
}

export interface InstagramConversation {
  id: string
  /** ISO. */
  updatedAt: string
  participants: InstagramParticipant[]
}

export interface InstagramDirectMessage {
  id: string
  /** ISO. */
  createdAt: string
  fromId: string
  fromUsername: string | null
  text: string | null
  attachments: { kind: 'imagem' | 'video' | 'audio' | 'arquivo' | 'outro'; url: string | null }[]
}

/** Ids da caixa de mensagens (conversa e mensagem): base64 da Meta; vão no caminho da URL. */
export const MESSAGING_ID = /^[A-Za-z0-9_=-]{1,400}$/
/** Texto de terceiros guardado no máximo com isto (a Meta limita a 1000 bytes; folga para o que vier de outro app). */
const DIRECT_TEXT_MAX = 4000
/** Os códigos de permissão da Meta (10, 200–299) e o 230 ("Permitir acesso a mensagens" desligado); o 3 é capacidade do app. */
const DENIED_CODES = new Set([3, 10, 230])
/** A recusa de acesso que vem só pelo texto (sem um dos códigos acima). Só detecta: o texto da Meta não sai daqui. */
const DENIED_TEXT = /permission|capabilit|allow access|access to messag|not authorized|standard access/i
export const MESSAGES_DENIED_SUMMARY = 'O Instagram não liberou o acesso às mensagens desta conta'

/** A falha de um pedido de mensagens, com o `denied` decidido pelo código (ou pelo texto, que não é guardado). */
function messagingFailure(status: number, body: Record<string, unknown> | null): MessagingFailure {
  const base = apiFailure(status, body)
  const raw = record(body?.['error'])
  const message = typeof raw?.['message'] === 'string' ? raw['message'] : ''
  const code = base.code
  const denied = code !== null && code !== 190 && (DENIED_CODES.has(code) || (code >= 200 && code <= 299) || DENIED_TEXT.test(message))
  // O resumo da recusa em pt-BR com o código, nunca o texto da Meta (pode trazer dado da conta).
  return { ...base, denied, ...(denied ? { error: `${code === 230 ? MESSAGES_DENIED_SUMMARY : base.error} (erro ${code})` } : {}) }
}

/** A recusa de transporte (rede, destino fora da lista): nunca é recusa de acesso. */
const notDenied = (failure: InstagramFailure): MessagingFailure => ({ ...failure, denied: false })

function participantsOf(value: unknown): InstagramParticipant[] {
  const list = record(value)?.['data']
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const item = record(raw)
    const rawId = item?.['id']
    const id = typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId : ''
    const username = text(item?.['username'])
    return /^\d{1,40}$/.test(id) && username ? [{ id, username: username.slice(0, 100), name: text(item?.['name'])?.slice(0, 200) ?? null }] : []
  })
}

/** O anexo pelo tipo que a Meta manda (`image_data`, `video_data`, `audio_data`, `file_url`); só URL `https://`. */
function attachmentsOf(value: unknown): InstagramDirectMessage['attachments'] {
  const list = record(value)?.['data']
  if (!Array.isArray(list)) return []
  const https = (url: unknown): string | null => (typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) && url.length <= 4096 ? url : null)
  return list.slice(0, 20).map((raw) => {
    const item = record(raw)
    const image = record(item?.['image_data'])
    const video = record(item?.['video_data'])
    const audio = record(item?.['audio_data'])
    if (image) return { kind: 'imagem' as const, url: https(image['url']) }
    if (video) return { kind: 'video' as const, url: https(video['url']) }
    if (audio) return { kind: 'audio' as const, url: https(audio['url']) }
    const mime = typeof item?.['mime_type'] === 'string' ? item['mime_type'] : ''
    if (item?.['file_url']) return { kind: mime.startsWith('audio/') ? ('audio' as const) : mime.startsWith('video/') ? ('video' as const) : mime.startsWith('image/') ? ('imagem' as const) : ('arquivo' as const), url: https(item['file_url']) }
    return { kind: 'outro' as const, url: null }
  })
}

const isoOf = (value: unknown): string | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}
// fim 74

// 73: comentários
/** A data da Meta (`2026-11-19T15:22:10+0000`) em ISO; `null` se não for data. */
function metaTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const at = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/** Um comentário (ou resposta) da Meta; sem id ou sem data, fica de fora. */
function commentOf(raw: unknown, parentId: string | null): InstagramComment | null {
  const item = record(raw)
  const id = idOf(item?.['id'])
  const timestamp = metaTime(item?.['timestamp'])
  if (!item || !id || !timestamp) return null
  const from = record(item['from'])
  const username = (typeof item['username'] === 'string' ? item['username'] : typeof from?.['username'] === 'string' ? from['username'] : '').slice(0, 100)
  const replies = parentId === null && Array.isArray(record(item['replies'])?.['data']) ? (record(item['replies'])?.['data'] as unknown[]) : []
  return {
    id,
    parentId: parentId ?? idOf(item['parent_id']),
    text: (typeof item['text'] === 'string' ? item['text'] : '').slice(0, COMMENT_TEXT_KEEP),
    username,
    fromId: idOf(from?.['id']) ?? '',
    timestamp,
    hidden: item['hidden'] === true,
    likeCount: count(item['like_count']) ?? 0,
    replies: replies.flatMap((reply) => commentOf(reply, id) ?? []),
  }
}
// fim 73

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

    // 73: comentários
    async comments(token, mediaId) {
      if (!META_ID.test(mediaId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await get(version(`${mediaId}/comments`), { fields: COMMENTS_FIELDS, limit: String(COMMENTS_PAGE_LIMIT) }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const rows = Array.isArray(result.body?.['data']) ? (result.body['data'] as unknown[]) : null
      if (!rows) return failure(INSTAGRAM_UNEXPECTED)
      return { ok: true, comments: rows.flatMap((raw) => commentOf(raw, null) ?? []) }
    },

    async replyComment(token, commentId, message) {
      if (!META_ID.test(commentId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await call('POST', version(`${commentId}/replies`), {}, token, { body: { message } })
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const id = idOf(result.body?.['id'])
      return id ? { ok: true, id } : failure(INSTAGRAM_UNEXPECTED)
    },

    async hideComment(token, commentId, hide) {
      if (!META_ID.test(commentId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await call('POST', version(commentId), {}, token, { body: { hide } })
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      return result.body?.['success'] === false ? failure(INSTAGRAM_UNEXPECTED) : { ok: true }
    },

    async deleteComment(token, commentId) {
      if (!META_ID.test(commentId)) return failure(INSTAGRAM_UNEXPECTED)
      const result = await call('DELETE', version(commentId), {}, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      return result.body?.['success'] === false ? failure(INSTAGRAM_UNEXPECTED) : { ok: true }
    },
    // fim 73

    // 75: métricas
    async recentMedia(token, igUserId, limit = 25) {
      if (!META_ID.test(igUserId)) return failure(INSTAGRAM_UNEXPECTED)
      const size = Math.min(100, Math.max(1, Math.floor(limit)))
      const result = await get(version(`${igUserId}/media`), { fields: MEDIA_FIELDS, limit: String(size) }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const rows = Array.isArray(result.body?.['data']) ? (result.body['data'] as unknown[]) : null
      if (!rows) return failure(INSTAGRAM_UNEXPECTED)
      const media: InstagramMedia[] = []
      for (const raw of rows) {
        const item = record(raw)
        const id = idOf(item?.['id'])
        const timestamp = typeof item?.['timestamp'] === 'string' ? Date.parse(item['timestamp']) : NaN
        // Sem id ou sem data, a mídia não entra (não dá para pedir os números nem pôr na tabela).
        if (!item || !id || Number.isNaN(timestamp)) continue
        media.push({
          id,
          caption: typeof item['caption'] === 'string' ? item['caption'] : '',
          mediaType: text(item['media_type']) ?? 'IMAGE',
          permalink: text(item['permalink']),
          mediaUrl: text(item['media_url']),
          thumbnailUrl: text(item['thumbnail_url']),
          timestamp: new Date(timestamp).toISOString(),
          commentsCount: count(item['comments_count']),
        })
      }
      return { ok: true, media: media.slice(0, size) }
    },

    async accountInsights(token, igUserId, since, until, options = {}) {
      const metrics = options.metrics ?? ACCOUNT_METRICS
      if (!META_ID.test(igUserId) || !Number.isInteger(since) || !Number.isInteger(until) || since >= until || !metrics.length) return failure(INSTAGRAM_UNEXPECTED)
      const query: Record<string, string> = { metric: metrics.join(','), period: 'day', metric_type: 'total_value', since: String(since), until: String(until) }
      if (options.breakdown) query['breakdown'] = options.breakdown
      const result = await get(version(`${igUserId}/insights`), query, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const values: Partial<Record<AccountMetric, number>> = {}
      let follows: { follows: number; unfollows: number } | null = null
      for (const entry of insightRows(result.body)) {
        const name = metrics.find((metric) => metric === entry.name)
        if (!name) continue
        const total = record(entry.row['total_value'])
        const value = count(total?.['value'])
        if (value !== null) values[name] = value
        if (name === 'follows_and_unfollows') follows = followsOf(total) ?? follows
      }
      return { ok: true, values, follows }
    },

    async mediaInsights(token, mediaId, metrics = MEDIA_METRICS) {
      if (!META_ID.test(mediaId) || !metrics.length) return failure(INSTAGRAM_UNEXPECTED)
      const result = await get(version(`${mediaId}/insights`), { metric: metrics.join(',') }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      const values: Partial<Record<MediaMetric, number>> = {}
      for (const entry of insightRows(result.body)) {
        const name = metrics.find((metric) => metric === entry.name)
        if (!name) continue
        // `lifetime`: o número em `values[0].value`; a forma nova (`total_value.value`) também vale.
        const first = Array.isArray(entry.row['values']) ? record((entry.row['values'] as unknown[])[0]) : null
        const value = count(first?.['value'] ?? record(entry.row['total_value'])?.['value'])
        if (value !== null) values[name] = value
      }
      return { ok: true, values }
    },

    async followersCount(token) {
      const result = await get(version('me'), { fields: 'followers_count' }, token)
      if ('ok' in result) return result
      if (result.status !== 200) return apiFailure(result.status, result.body)
      return { ok: true, followers: count(result.body?.['followers_count']) }
    },
    // fim 75
    // 74: mensagens
    async conversations(token) {
      const result = await get(version('me/conversations'), { platform: 'instagram', fields: 'id,updated_time,participants' }, token)
      if ('ok' in result) return notDenied(result)
      if (result.status !== 200) return messagingFailure(result.status, result.body)
      const rows = Array.isArray(result.body?.['data']) ? (result.body['data'] as unknown[]) : null
      if (!rows) return notDenied(failure(INSTAGRAM_UNEXPECTED))
      const conversations: InstagramConversation[] = []
      for (const raw of rows) {
        const item = record(raw)
        const id = typeof item?.['id'] === 'string' ? item['id'] : ''
        const updatedAt = isoOf(item?.['updated_time'])
        if (!MESSAGING_ID.test(id) || !updatedAt) continue
        conversations.push({ id, updatedAt, participants: participantsOf(item?.['participants']) })
      }
      return { ok: true, conversations }
    },

    async conversationMessages(token, conversationId) {
      if (!MESSAGING_ID.test(conversationId)) return notDenied(failure(INSTAGRAM_UNEXPECTED))
      const result = await get(version(conversationId), { fields: 'messages{id,created_time,from,to,message,attachments}' }, token)
      if ('ok' in result) return notDenied(result)
      if (result.status !== 200) return messagingFailure(result.status, result.body)
      const rows = record(result.body?.['messages'])?.['data']
      const messages: InstagramDirectMessage[] = []
      let olderCount = 0
      for (const raw of Array.isArray(rows) ? rows : []) {
        const item = record(raw)
        const id = typeof item?.['id'] === 'string' ? item['id'] : ''
        if (!MESSAGING_ID.test(id)) continue
        const createdAt = isoOf(item?.['created_time'])
        const from = record(item?.['from'])
        const rawFrom = from?.['id']
        const fromId = typeof rawFrom === 'number' ? String(rawFrom) : typeof rawFrom === 'string' ? rawFrom : ''
        // Fora das 20 mais recentes, a Meta só manda o id: conta como mensagem antiga.
        if (!createdAt || !/^\d{1,40}$/.test(fromId)) {
          olderCount++
          continue
        }
        const body = typeof item?.['message'] === 'string' && item['message'] ? item['message'].slice(0, DIRECT_TEXT_MAX) : null
        messages.push({ id, createdAt, fromId, fromUsername: text(from?.['username']), text: body, attachments: attachmentsOf(item?.['attachments']) })
      }
      return { ok: true, messages, olderCount }
    },

    async sendMessage(token, igUserId, recipientId, message) {
      if (!META_ID.test(igUserId) || !META_ID.test(recipientId)) return notDenied(failure(INSTAGRAM_UNEXPECTED))
      const result = await call('POST', version(`${igUserId}/messages`), {}, token, { body: { recipient: { id: recipientId }, message: { text: message } } })
      if ('ok' in result) return notDenied(result)
      if (result.status !== 200) return messagingFailure(result.status, result.body)
      const raw = result.body?.['message_id']
      return { ok: true, messageId: typeof raw === 'string' && MESSAGING_ID.test(raw) ? raw : null }
    },
    // fim 74
  }
}
