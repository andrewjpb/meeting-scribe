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
}

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
    fetch: async (url, init) => {
      const parsed = new URL(url)
      const auth = init.headers['authorization'] ?? init.headers['Authorization'] ?? ''
      const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
      const token = bearer ?? parsed.searchParams.get('access_token')
      fake.calls.push({ method: init.method, host: parsed.host, path: parsed.pathname, bearer: bearer !== null, tokenInQuery: parsed.searchParams.has('access_token') })
      if (parsed.host === 'rupload.facebook.com') return upload(parsed, init.headers, init.body)
      if (parsed.host !== 'graph.instagram.com') return Promise.resolve(response(404, { error: { message: 'not found', code: 803 } }))
      const publishing = await publication(parsed, init.method, token, init.body)
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
