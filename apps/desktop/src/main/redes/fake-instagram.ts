// Instagram falso, em memória, para os testes e o smoke (contrato 69): responde as URLs de verdade da Graph API
// (`graph.instagram.com`) sem rede. `GET /v27.0/me` devolve o perfil para um token válido no `Authorization: Bearer`;
// `GET /refresh_access_token` troca um token válido por um novo; o resto é 404. Os tokens são inventados e nunca aparecem
// fora daqui: `calls` guarda só o método, o servidor e o caminho (sem consulta, sem cabeçalho). O relógio (`now`,
// adiantado por `skewMs`) é o mesmo que o serviço usa no smoke, para "passar" 7 ou 61 dias sem esperar.
//
// Contrato 71: a publicação. `POST /<IG>/media` cria o contêiner (id crescente; o Reels retomável devolve também a `uri`
// em `rupload.facebook.com`, que exige `offset`, `file_size` e o corpo do tamanho certo); o status fica `IN_PROGRESS` nas
// duas primeiras consultas e depois `FINISHED` (`failNext(code)` marca o próximo contêiner consultado como `ERROR` com
// o código e `expireNext()` como `EXPIRED`, para sempre, como na Meta); `media_publish` devolve o id da mídia (o mesmo id
// para o contêiner já publicado, para provar a idempotência; `failPublishNext()` faz o próximo falhar de forma
// transitória, com o contêiner intacto); `GET /<contêiner>?fields=id` devolve o id do próprio contêiner; `GET /<mídia>?fields=permalink,timestamp`; `content_publishing_limit` com `setQuota`.
// Com `mediaFetch`, a imagem é "baixada" pela `image_url` como a Meta faz (o smoke liga no S3 falso).
// 73: comentários
// Contrato 73: `GET /<mídia>/comments` (com as respostas em `replies`), `POST /<comentário>/replies`, `POST /<comentário>`
// com `hide` e `DELETE /<comentário>`, sobre comentários em memória (`addComment`); `failCommentNext(code)` faz o próximo falhar.
// fim 73
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
  /** Contrato 71: o próximo contêiner consultado fica em `ERROR` com este código (para sempre, como na Meta). */
  failNext(code: number): void
  /** Contrato 71: o próximo contêiner consultado fica `EXPIRED` (para sempre). */
  expireNext(): void
  /** Contrato 71: o próximo `media_publish` falha de forma transitória (limite de chamadas, código 4); o contêiner fica. */
  failPublishNext(code?: number): void
  /** Contrato 71: a cota de `content_publishing_limit`. */
  setQuota(used: number, total: number): void
  /** Contrato 71: os contêineres criados, em ordem (sem token; a legenda só pelo tamanho). */
  containers(): FakeContainer[]
  /** Contrato 71: os envios ao `rupload.facebook.com`. */
  uploads: { containerId: string; offset: string | null; fileSize: string | null; bodyBytes: number; oauth: boolean }[]
  /** Contrato 71: as mídias publicadas (id da mídia → contêiner). */
  published(): { mediaId: string; creationId: string }[]
  /** Contrato 71: como a Meta baixa a `image_url` (no smoke, o S3 falso); sem ele, a imagem não é conferida. */
  mediaFetch: HttpFetch | null
  // 73: comentários
  /**
   * Contrato 73: um comentário novo de terceiro numa mídia (`parentId`: resposta a um comentário). Devolve o id. A
   * `comments_count` que o `GET /<IG>/media` devolve não muda (é a do 75); a tela conta os que leu.
   */
  addComment(mediaId: string, comment: { text: string; username: string; fromId?: string; at?: number; parentId?: string; hidden?: boolean }): string
  /** Contrato 73: os comentários de uma mídia como estão no falso (com as respostas, as ocultas e sem as excluídas). */
  commentsOf(mediaId: string): FakeComment[]
  /** Contrato 73: o próximo pedido de comentário (ler, responder, ocultar, excluir) falha com este código. */
  failCommentNext(code: number): void
  // fim 73
  // 74: mensagens
  /** Contrato 74: uma conversa nova com o contato (sem mensagem ainda); devolve o id dela. */
  addConversation(contact: { id: string; username: string; name?: string }): string
  /** Contrato 74: uma mensagem do contato na conversa (`at` em ms; o padrão é o `now()`). */
  addInbound(conversationId: string, text: string, at?: number): string
  /** Contrato 74: com `false`, a Meta recusa as mensagens (código 230, "Permitir acesso a mensagens" desligado). */
  setMessagingAccess(allowed: boolean): void
  /** Contrato 74: as respostas que chegaram ao `POST /<IG_ID>/messages` e foram aceitas. */
  sentMessages: { recipientId: string; text: string }[]
  /** Contrato 74: apaga as conversas (o smoke termina limpo). */
  clearConversations(): void
  // fim 74
  // 75: métricas
  /** Contrato 75: as mídias da conta, da mais nova à mais antiga: as publicadas aqui e 30 inventadas (`FAKE_IG_SEED_MEDIA`). */
  mediaList(): FakeMedia[]
  /** Contrato 75: a Meta passa a recusar (código 100) todo pedido de insights que inclua esta métrica. */
  denyMetric(metric: string): void
  /** Contrato 75: volta a aceitar todas as métricas. */
  allowMetrics(): void
  /** Contrato 75: o JPEG que a CDN falsa (`*.cdninstagram.com`) devolve para qualquer miniatura; `null` responde 404. */
  thumbJpeg: Uint8Array | null
  // fim 75
}

// 75: métricas
/** Contrato 75: uma mídia como `GET /<IG_ID>/media` devolve. */
export interface FakeMedia {
  id: string
  caption: string
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  permalink: string
  media_url: string
  thumbnail_url?: string
  timestamp: string
  comments_count: number
}

/** As mídias inventadas da conta, além das publicadas pelo smoke. */
export const FAKE_IG_SEED_MEDIA = 30
export const FAKE_IG_CDN = 'https://scontent.cdninstagram.com'
const SEED_CAPTIONS = [
  'Como a gente grava e resume reuniões',
  'Por dentro do nosso processo de spec',
  'Bastidores do lançamento do app',
  'Equipe LAP no evento de tecnologia',
  'Três dicas para pautas mais curtas',
  'Novidade: integração com o email',
  'Ata pronta em dois minutos',
  'O que muda com o Assistente',
  'Reunião boa termina com tarefa',
  'Café, quadro branco e um cliente feliz',
]
const SEED_TYPES: readonly FakeMedia['media_type'][] = ['VIDEO', 'CAROUSEL_ALBUM', 'IMAGE']
/** Até 30 dias entre `since` e `until`, como a Meta. */
const FAKE_INSIGHTS_WINDOW_S = 30 * 86_400
// fim 75

// 73: comentários
/** Contrato 73: um comentário no falso, como a Meta guarda (as respostas no `replies`). */
export interface FakeComment {
  id: string
  mediaId: string
  parentId: string | null
  text: string
  username: string
  fromId: string
  timestamp: string
  hidden: boolean
  likeCount: number
  replies: FakeComment[]
}
// fim 73

export interface FakeContainer {
  id: string
  kind: 'imagem' | 'item' | 'carrossel' | 'reels'
  children: string[]
  imageUrl: string | null
  altText: string | null
  captionChars: number
  uploaded: boolean
  statusPolls: number
  publishedMediaId: string | null
  /** Morto pela Meta: não sai mais deste estado. */
  dead: { status: 'ERROR'; code: number } | { status: 'EXPIRED' } | null
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
  // Contrato 71.
  const containers = new Map<string, FakeContainer>()
  const media = new Map<string, { creationId: string; timestamp: string }>()
  // Ids de 17 dígitos, como os da Meta (BigInt: passam do inteiro seguro do JavaScript).
  let nextId = 17900000000000001n
  let nextMediaId = 18000000000000001n
  let forced: { status: 'ERROR'; code: number } | { status: 'EXPIRED' } | null = null
  let publishFailure: number | null = null
  let quota = { used: 0, total: 50 }

  const v = `/${INSTAGRAM_API_VERSION}/`
  const header = (headers: Record<string, string>, name: string): string | null => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? null
  const bodyOf = (body: string | Uint8Array | undefined): Record<string, unknown> => {
    if (body === undefined) return {}
    try {
      const value = JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8')) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  const apiError = (code: number, subcode?: number): HttpResponse => response(400, { error: { message: 'erro do falso', type: 'OAuthException', code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: 'smoke' } })
  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

  /** O upload retomável do Reels: o token `OAuth`, `offset: 0`, `file_size` e o corpo inteiro. */
  function upload(url: URL, headers: Record<string, string>, body: string | Uint8Array | undefined): HttpResponse {
    const match = new RegExp(`^/ig-api-upload/${INSTAGRAM_API_VERSION}/(\\d+)$`).exec(url.pathname)
    const auth = header(headers, 'authorization') ?? ''
    const token = auth.startsWith('OAuth ') ? auth.slice('OAuth '.length) : null
    const offset = header(headers, 'offset')
    const fileSize = header(headers, 'file_size')
    const bodyBytes = body === undefined ? 0 : typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
    const container = match ? containers.get(match[1] ?? '') : undefined
    fake.uploads.push({ containerId: match?.[1] ?? '', offset, fileSize, bodyBytes, oauth: token !== null })
    if (!token || !valid.has(token)) return oauthError()
    if (!container || container.kind !== 'reels') return response(404, { debug_info: { type: 'NotFound', message: 'contêiner' } })
    if (offset !== '0' || fileSize === null || Number(fileSize) !== bodyBytes || bodyBytes === 0) return response(400, { debug_info: { type: 'ProcessingFailedError', message: 'offset/file_size' } })
    container.uploaded = true
    return response(200, { success: true, message: 'Upload complete' })
  }

  /** As rotas de publicação da Graph API; `null` se não é uma delas. */
  async function publication(url: URL, method: string, token: string | null, rawBody: string | Uint8Array | undefined): Promise<HttpResponse | null> {
    if (!url.pathname.startsWith(v)) return null
    const rest = url.pathname.slice(v.length).split('/')
    const [first, second] = rest
    const known = second === 'media' || second === 'media_publish' || second === 'content_publishing_limit' || (rest.length === 1 && first !== 'me')
    if (!known) return null
    if (!token || !valid.has(token)) return oauthError()
    const body = bodyOf(rawBody)

    if (method === 'POST' && first === profile.user_id && second === 'media' && rest.length === 2) {
      const id = String(nextId++)
      const mediaType = str(body['media_type'])
      const kind: FakeContainer['kind'] = mediaType === 'REELS' ? 'reels' : mediaType === 'CAROUSEL' ? 'carrossel' : body['is_carousel_item'] === true || body['is_carousel_item'] === 'true' ? 'item' : 'imagem'
      const imageUrl = str(body['image_url'])
      if ((kind === 'imagem' || kind === 'item') && !imageUrl) return apiError(100)
      if (kind === 'reels' && str(body['upload_type']) !== 'resumable') return apiError(100)
      const children = kind === 'carrossel' ? (str(body['children']) ?? '').split(',').filter(Boolean) : []
      if (kind === 'carrossel' && (children.length < 2 || children.some((child) => containers.get(child)?.kind !== 'item'))) return apiError(100)
      // Como a Meta: a imagem é baixada pela URL pública na hora; sem ela, 9004.
      if (imageUrl && fake.mediaFetch) {
        const fetched = await fake.mediaFetch(imageUrl, { method: 'GET', headers: {} }).catch(() => null)
        if (!fetched || fetched.status !== 200) return apiError(9004, 2207052)
      }
      containers.set(id, { id, kind, children, imageUrl, altText: str(body['alt_text']), captionChars: (str(body['caption']) ?? '').length, uploaded: false, statusPolls: 0, publishedMediaId: null, dead: null })
      return response(200, kind === 'reels' ? { id, uri: `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_API_VERSION}/${id}` } : { id })
    }

    if (method === 'POST' && first === profile.user_id && second === 'media_publish' && rest.length === 2) {
      const creationId = str(body['creation_id']) ?? ''
      const container = containers.get(creationId)
      if (!container || container.kind === 'item') return apiError(100)
      // Já publicado: o mesmo id de mídia (nada sai duas vezes).
      if (container.publishedMediaId) return response(200, { id: container.publishedMediaId })
      if (container.dead) return apiError(9007, 2207027)
      if (container.kind === 'reels' && !container.uploaded) return apiError(9007, 2207027)
      if (container.statusPolls < 3) return apiError(9007, 2207027)
      if (publishFailure !== null) {
        const code = publishFailure
        publishFailure = null
        return apiError(code)
      }
      if (quota.used >= quota.total) return apiError(9, 2207042)
      const mediaId = String(nextMediaId++)
      container.publishedMediaId = mediaId
      media.set(mediaId, { creationId, timestamp: new Date(fake.now()).toISOString().replace(/\.\d{3}Z$/, '+0000') })
      quota.used++
      return response(200, { id: mediaId })
    }

    if (method === 'GET' && first === profile.user_id && second === 'content_publishing_limit' && rest.length === 2) {
      return response(200, { data: [{ quota_usage: quota.used, config: { quota_total: quota.total, quota_duration: 86400 } }] })
    }

    if (method === 'GET' && rest.length === 1 && first) {
      const fields = (url.searchParams.get('fields') ?? '').split(',')
      const container = containers.get(first)
      if (container && fields.includes('status_code')) {
        if (forced && !container.publishedMediaId) {
          container.dead = forced
          forced = null
        }
        if (container.dead?.status === 'EXPIRED') return response(200, { id: container.id, status_code: 'EXPIRED', status: 'Expired' })
        if (container.dead) return response(200, { id: container.id, status_code: 'ERROR', status: `Error: Media upload has failed with error code ${container.dead.code}` })
        if (container.publishedMediaId) return response(200, { id: container.id, status_code: 'PUBLISHED', status: 'Published' })
        if (container.kind === 'reels' && !container.uploaded) return response(200, { id: container.id, status_code: 'IN_PROGRESS', status: 'In Progress' })
        container.statusPolls++
        return response(200, container.statusPolls <= 2 ? { id: container.id, status_code: 'IN_PROGRESS', status: 'In Progress' } : { id: container.id, status_code: 'FINISHED', status: 'Finished' })
      }
      // Como a Meta: o contêiner devolve o próprio id (não o da mídia publicada).
      if (container) return response(200, { id: container.id })
      const published = media.get(first)
      if (published) return response(200, { id: first, permalink: `https://www.instagram.com/p/smoke${first.slice(-6)}/`, timestamp: published.timestamp })
      return apiError(100, 33)
    }
    return null
  }

  // 75: métricas
  const metaTimestamp = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000')
  // Montadas no primeiro pedido, pelo relógio de então (quem cria o falso pode acertar o relógio depois).
  let seededCache: FakeMedia[] | null = null
  const seedMedia = (seedBase: number): FakeMedia[] => Array.from({ length: FAKE_IG_SEED_MEDIA }, (_, index) => {
    const id = String(18100000000000001n + BigInt(index))
    const type = SEED_TYPES[index % SEED_TYPES.length] ?? 'IMAGE'
    return {
      id,
      caption: `${SEED_CAPTIONS[index % SEED_CAPTIONS.length] ?? ''}${index >= SEED_CAPTIONS.length ? ` (parte ${Math.floor(index / SEED_CAPTIONS.length) + 1})` : ''}`,
      media_type: type,
      permalink: `https://www.instagram.com/p/seed${id.slice(-6)}/`,
      media_url: type === 'VIDEO' ? `${FAKE_IG_CDN}/v/t51/${id}.mp4` : `${FAKE_IG_CDN}/v/t51/${id}.jpg`,
      ...(type === 'VIDEO' ? { thumbnail_url: `${FAKE_IG_CDN}/v/t51/${id}.jpg` } : {}),
      // Uma a cada 2 dias e meio, a mais nova 2 dias e meio antes do primeiro pedido.
      timestamp: metaTimestamp(seedBase - (index + 1) * 60 * 3_600_000),
      comments_count: (index * 7) % 13,
    }
  })
  /** A legenda de cada contêiner criado (a das publicadas, para a lista de mídias). */
  const captions = new Map<string, string>()
  const deniedMetrics = new Set<string>()
  const KIND_TYPES: Readonly<Record<FakeContainer['kind'], FakeMedia['media_type']>> = { imagem: 'IMAGE', item: 'IMAGE', carrossel: 'CAROUSEL_ALBUM', reels: 'VIDEO' }
  const mediaList = (): FakeMedia[] => {
    const published: FakeMedia[] = [...media].map(([id, item]) => {
      const type = KIND_TYPES[containers.get(item.creationId)?.kind ?? 'imagem']
      return {
        id,
        caption: captions.get(item.creationId) ?? '',
        media_type: type,
        permalink: `https://www.instagram.com/p/smoke${id.slice(-6)}/`,
        media_url: type === 'VIDEO' ? `${FAKE_IG_CDN}/v/t51/${id}.mp4` : `${FAKE_IG_CDN}/v/t51/${id}.jpg`,
        ...(type === 'VIDEO' ? { thumbnail_url: `${FAKE_IG_CDN}/v/t51/${id}.jpg` } : {}),
        timestamp: item.timestamp,
        comments_count: 0,
      }
    })
    seededCache ??= seedMedia(base())
    return [...published, ...seededCache].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  }
  /** Um número de 0 a 999 fixo por id (os números das mídias não mudam entre leituras). */
  const spread = (id: string): number => Number(BigInt(id) % 997n)
  const accountValue = (metric: string, days: number): number | null => {
    const table: Record<string, number> = { reach: 290 * days + 17, views: 760 * days + 41, accounts_engaged: 21 * days + 5, total_interactions: 52 * days + 9, likes: 39 * days + 4, comments: 3 * days + 1, saves: 5 * days + 2, shares: 5 * days, follows_and_unfollows: 2 * days + 2 + Math.floor(days / 2), profile_links_taps: 2 * days + 3 }
    return table[metric] ?? null
  }
  const mediaValue = (metric: string, id: string): number | null => {
    const h = spread(id)
    const views = 400 + ((h * 97) % 9500)
    const likes = 20 + ((h * 7) % 400)
    const comments = h % 15
    const saved = (h * 3) % 80
    const shares = (h * 5) % 70
    const table: Record<string, number> = { views, reach: Math.floor(views * 0.63), likes, comments, saved, shares, total_interactions: likes + comments + saved + shares }
    return table[metric] ?? null
  }
  /** As rotas do contrato 75: a lista de mídias, os insights da conta e das mídias e a CDN das miniaturas. */
  const metricsRoute = (url: URL, method: string, token: string | null): HttpResponse | null => {
    if (url.host === new URL(FAKE_IG_CDN).host) {
      const thumb = fake.thumbJpeg
      if (method !== 'GET' || !thumb || !/^\/v\/t51\/\d+\.jpg$/.test(url.pathname)) return response(404, { error: 'not found' })
      return { status: 200, header: (name) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null), text: () => Promise.resolve(''), bytes: () => Promise.resolve(new Uint8Array(thumb)) }
    }
    if (url.host !== 'graph.instagram.com' || method !== 'GET' || !url.pathname.startsWith(v)) return null
    const [first, second, ...more] = url.pathname.slice(v.length).split('/')
    if (!first || more.length) return null
    if (second === 'media' && first === profile.user_id) {
      if (!token || !valid.has(token)) return oauthError()
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '25') || 25))
      return response(200, { data: mediaList().slice(0, limit) })
    }
    if (second !== 'insights') return null
    if (!token || !valid.has(token)) return oauthError()
    const metrics = (url.searchParams.get('metric') ?? '').split(',').filter(Boolean)
    if (!metrics.length || metrics.some((metric) => deniedMetrics.has(metric))) return apiError(100)
    if (first === profile.user_id) {
      const since = Number(url.searchParams.get('since'))
      const until = Number(url.searchParams.get('until'))
      if (url.searchParams.get('period') !== 'day' || url.searchParams.get('metric_type') !== 'total_value' || !Number.isInteger(since) || !Number.isInteger(until) || until <= since || until - since > FAKE_INSIGHTS_WINDOW_S) return apiError(100)
      if (metrics.some((metric) => accountValue(metric, 1) === null)) return apiError(100)
      const days = Math.ceil((until - since) / 86_400)
      const split = url.searchParams.get('breakdown') === 'follow_type'
      return response(200, {
        data: metrics.map((name) => {
          const value = accountValue(name, days) ?? 0
          const breakdowns = name === 'follows_and_unfollows' && split ? [{ dimension_keys: ['follow_type'], results: [{ dimension_values: ['FOLLOWER'], value: 2 * days + 2 }, { dimension_values: ['NON_FOLLOWER'], value: Math.floor(days / 2) }] }] : undefined
          return { name, period: 'day', title: name, total_value: { value, ...(breakdowns ? { breakdowns } : {}) }, id: `${first}/insights/${name}/day` }
        }),
      })
    }
    if (!mediaList().some((item) => item.id === first)) return apiError(100, 33)
    if (metrics.some((metric) => mediaValue(metric, first) === null)) return apiError(100)
    return response(200, { data: metrics.map((name) => ({ name, period: 'lifetime', title: name, values: [{ value: mediaValue(name, first) ?? 0 }], id: `${first}/insights/${name}/lifetime` })) })
  }
  /** A legenda do contêiner que acabou de ser criado. */
  const noteCaption = async (url: URL, method: string, body: string | Uint8Array | undefined, answer: HttpResponse): Promise<void> => {
    if (method !== 'POST' || answer.status !== 200 || !url.pathname.endsWith(`/${profile.user_id}/media`)) return
    const id = str(bodyOf(await answer.text())['id'])
    const caption = str(bodyOf(body)['caption'])
    if (id && caption !== null) captions.set(id, caption)
  }
  // fim 75

  // 74: mensagens
  interface FakeDirect {
    id: string
    createdAt: number
    fromId: string
    fromUsername: string
    toId: string
    toUsername: string
    text: string
  }
  interface FakeThread {
    id: string
    contact: { id: string; username: string; name?: string }
    updatedAt: number
    messages: FakeDirect[]
  }
  const threads = new Map<string, FakeThread>()
  const directTime = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000')
  let messagingAllowed = true
  let nextThread = 1
  let nextDirect = 1
  /** Ids como os da Meta (base64), só com os caracteres que vão no caminho. */
  const threadId = (n: number): string => `aWdfZDpjb252ZXJzYXRpb246${String(n).padStart(6, '0')}`
  const directId = (n: number): string => `aWdfZDptZXNzYWdlOj${String(n).padStart(8, '0')}`
  const deniedMessaging = (): HttpResponse => response(400, { error: { message: '(#230) Requires instagram_manage_messages permission to manage the object', type: 'OAuthException', code: 230, fbtrace_id: 'smoke' } })
  /** A janela de 24 h desde a última mensagem do contato, como a Meta recusa fora dela (código 10, subcódigo 2018278). */
  const outsideWindow = (thread: FakeThread): boolean => {
    const last = [...thread.messages].reverse().find((item) => item.fromId === thread.contact.id)
    return !last || fake.now() - last.createdAt > 24 * 3_600_000
  }
  /** As rotas do contrato 74: as conversas, as mensagens de uma conversa e a resposta. */
  const messagingRoute = (url: URL, method: string, token: string | null, rawBody: string | Uint8Array | undefined): HttpResponse | null => {
    if (url.host !== 'graph.instagram.com' || !url.pathname.startsWith(v)) return null
    const rest = url.pathname.slice(v.length).split('/')
    const [first, second] = rest
    const conversationsList = method === 'GET' && rest.length === 2 && first === 'me' && second === 'conversations'
    const threadRead = method === 'GET' && rest.length === 1 && first !== undefined && threads.has(first)
    const reply = method === 'POST' && rest.length === 2 && first === profile.user_id && second === 'messages'
    if (!conversationsList && !threadRead && !reply) return null
    if (!token || !valid.has(token)) return oauthError()
    if (!messagingAllowed) return deniedMessaging()
    const self = { username: profile.username, id: profile.user_id }
    if (conversationsList) {
      if (url.searchParams.get('platform') !== 'instagram') return apiError(100)
      const data = [...threads.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({ id: thread.id, updated_time: directTime(thread.updatedAt), participants: { data: [self, { username: thread.contact.username, id: thread.contact.id }] } }))
      return response(200, { data })
    }
    if (threadRead) {
      const thread = threads.get(first ?? '')
      if (!thread) return apiError(100, 33)
      // Da mais nova para a mais antiga; só as 20 mais recentes com detalhe, como a Meta.
      const data = [...thread.messages]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((item, index) =>
          index < 20 ? { id: item.id, created_time: directTime(item.createdAt), from: { username: item.fromUsername, id: item.fromId }, to: { data: [{ username: item.toUsername, id: item.toId }] }, message: item.text } : { id: item.id },
        )
      return response(200, { id: thread.id, messages: { data } })
    }
    const body = bodyOf(rawBody)
    const recipient = str((body['recipient'] as Record<string, unknown> | undefined)?.['id'])
    const text = str((body['message'] as Record<string, unknown> | undefined)?.['text'])
    const thread = [...threads.values()].find((item) => item.contact.id === recipient)
    if (!thread || !text) return apiError(100)
    if (Buffer.byteLength(text, 'utf8') > 1000) return apiError(100)
    if (outsideWindow(thread)) return response(400, { error: { message: 'This message is sent outside of allowed window.', type: 'OAuthException', code: 10, error_subcode: 2018278, fbtrace_id: 'smoke' } })
    const id = directId(nextDirect++)
    const at = fake.now()
    thread.messages.push({ id, createdAt: at, fromId: profile.user_id, fromUsername: profile.username, toId: thread.contact.id, toUsername: thread.contact.username, text })
    thread.updatedAt = at
    fake.sentMessages.push({ recipientId: thread.contact.id, text })
    return response(200, { recipient_id: thread.contact.id, message_id: id })
  }
  // fim 74

  // 73: comentários
  const comments = new Map<string, FakeComment[]>()
  let nextCommentId = 17950000000000001n
  let commentFailure: number | null = null
  const commentTime = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000')
  const allComments = (): FakeComment[] => [...comments.values()].flatMap((list) => list.flatMap((item) => [item, ...item.replies]))
  const findFakeComment = (id: string): FakeComment | undefined => allComments().find((item) => item.id === id)
  const commentJson = (item: FakeComment, nested: boolean): Record<string, unknown> => ({
    id: item.id,
    text: item.text,
    timestamp: item.timestamp,
    username: item.username,
    from: { id: item.fromId, username: item.username },
    hidden: item.hidden,
    like_count: item.likeCount,
    ...(item.parentId ? { parent_id: item.parentId } : {}),
    ...(nested && item.replies.length ? { replies: { data: item.replies.map((reply) => commentJson(reply, false)) } } : {}),
  })
  /** As rotas do contrato 73: os comentários de uma mídia, responder, ocultar ou mostrar e excluir. */
  const commentsRoute = (url: URL, method: string, token: string | null, rawBody: string | Uint8Array | undefined): HttpResponse | null => {
    if (url.host !== 'graph.instagram.com' || !url.pathname.startsWith(v)) return null
    const [first, second, ...more] = url.pathname.slice(v.length).split('/')
    if (!first || more.length) return null
    const isMedia = comments.has(first) || fake.mediaList().some((item) => item.id === first)
    const comment = second === undefined || second === 'replies' ? findFakeComment(first) : undefined
    const route = method === 'GET' && second === 'comments' && isMedia ? 'list' : comment && method === 'POST' && second === 'replies' ? 'reply' : comment && method === 'POST' && second === undefined ? 'hide' : comment && method === 'DELETE' && second === undefined ? 'delete' : null
    if (!route) return null
    if (!token || !valid.has(token)) return oauthError()
    if (commentFailure !== null) {
      const code = commentFailure
      commentFailure = null
      return apiError(code)
    }
    const body = bodyOf(rawBody)
    if (route === 'list') return response(200, { data: (comments.get(first) ?? []).map((item) => commentJson(item, true)) })
    if (!comment) return null
    if (route === 'reply') {
      const message = str(body['message'])
      if (!message || comment.parentId) return apiError(100)
      const id = String(nextCommentId++)
      comment.replies.push({ id, mediaId: comment.mediaId, parentId: comment.id, text: message, username: profile.username, fromId: profile.user_id, timestamp: commentTime(fake.now()), hidden: false, likeCount: 0, replies: [] })
      return response(200, { id })
    }
    if (route === 'hide') {
      if (typeof body['hide'] !== 'boolean') return apiError(100)
      comment.hidden = body['hide']
      return response(200, { success: true })
    }
    const list = comments.get(comment.mediaId) ?? []
    if (comment.parentId) {
      const top = list.find((item) => item.id === comment.parentId)
      if (top) top.replies = top.replies.filter((item) => item.id !== comment.id)
    } else comments.set(comment.mediaId, list.filter((item) => item.id !== comment.id))
    return response(200, { success: true })
  }
  // fim 73

  const fake: FakeInstagram = {
    skewMs: 0,
    now: () => base() + fake.skewMs,
    calls: [],
    tokens: () => [...issued],
    revoke: (token) => {
      revoked.add(token)
      valid.delete(token)
    },
    failNext: (code) => {
      forced = { status: 'ERROR', code }
    },
    expireNext: () => {
      forced = { status: 'EXPIRED' }
    },
    failPublishNext: (code = 4) => {
      publishFailure = code
    },
    setQuota: (used, total) => {
      quota = { used, total }
    },
    containers: () => [...containers.values()].map((item) => ({ ...item, children: [...item.children] })),
    uploads: [],
    published: () => [...media].map(([mediaId, item]) => ({ mediaId, creationId: item.creationId })),
    mediaFetch: null,
    // 73: comentários
    addComment: (mediaId, comment) => {
      const id = String(nextCommentId++)
      const item: FakeComment = { id, mediaId, parentId: comment.parentId ?? null, text: comment.text, username: comment.username, fromId: comment.fromId ?? String(17841499000000000n + nextCommentId), timestamp: commentTime(comment.at ?? fake.now()), hidden: comment.hidden ?? false, likeCount: 0, replies: [] }
      const list = comments.get(mediaId) ?? []
      const top = comment.parentId ? list.find((entry) => entry.id === comment.parentId) : undefined
      if (top) top.replies.push(item)
      else comments.set(mediaId, [...list, { ...item, parentId: null }])
      return id
    },
    commentsOf: (mediaId) => (comments.get(mediaId) ?? []).map((item) => ({ ...item, replies: item.replies.map((reply) => ({ ...reply })) })),
    failCommentNext: (code) => {
      commentFailure = code
    },
    // fim 73
    // 74: mensagens
    addConversation: (contact) => {
      const id = threadId(nextThread++)
      threads.set(id, { id, contact: { ...contact }, updatedAt: fake.now(), messages: [] })
      return id
    },
    addInbound: (conversationId, text, at) => {
      const thread = threads.get(conversationId)
      if (!thread) throw new Error('conversa do falso inexistente')
      const id = directId(nextDirect++)
      const when = at ?? fake.now()
      thread.messages.push({ id, createdAt: when, fromId: thread.contact.id, fromUsername: thread.contact.username, toId: profile.user_id, toUsername: profile.username, text })
      // A conversa nova (sem mensagem) fica com a hora da primeira; depois, a da mais recente.
      thread.updatedAt = thread.messages.length === 1 ? when : Math.max(thread.updatedAt, when)
      return id
    },
    setMessagingAccess: (allowed) => {
      messagingAllowed = allowed
    },
    sentMessages: [],
    clearConversations: () => {
      threads.clear()
      fake.sentMessages.length = 0
      messagingAllowed = true
    },
    // fim 74
    // 75: métricas
    mediaList,
    denyMetric: (metric) => {
      deniedMetrics.add(metric)
    },
    allowMetrics: () => {
      deniedMetrics.clear()
    },
    thumbJpeg: null,
    // fim 75
    fetch: async (url, init) => {
      const parsed = new URL(url)
      const auth = init.headers['authorization'] ?? init.headers['Authorization'] ?? ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
      const token = bearer ?? parsed.searchParams.get('access_token')
      fake.calls.push({ method: init.method, host: parsed.host, path: parsed.pathname, bearer: bearer !== null, tokenInQuery: parsed.searchParams.has('access_token') })
      // 75: métricas
      const metrics = metricsRoute(parsed, init.method, token)
      if (metrics) return metrics
      // fim 75
      // 73: comentários
      const commenting = commentsRoute(parsed, init.method, token, init.body)
      if (commenting) return commenting
      // fim 73
      if (parsed.host === 'rupload.facebook.com') return upload(parsed, init.headers, init.body)
      if (parsed.host !== 'graph.instagram.com') return Promise.resolve(response(404, { error: { message: 'not found', code: 803 } }))
      // 74: mensagens
      const messaging = messagingRoute(parsed, init.method, token, init.body)
      if (messaging) return messaging
      // fim 74
      const publishing = await publication(parsed, init.method, token, init.body)
      // 75: métricas
      if (publishing) await noteCaption(parsed, init.method, init.body, publishing)
      // fim 75
      if (publishing) return publishing
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
