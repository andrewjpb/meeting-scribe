// Google falso, em memória, para os testes e o smoke (contrato 11, CA8): endpoint de token, revogação, perfil,
// foto e a parte do Drive v3 que o app usa (pastas, busca por nome, upload em partes). Nada sai da máquina: o
// `fetch` dele responde as URLs de verdade do Google sem rede. O "navegador" é `approve`, que confere a URL de
// autorização e devolve o endereço de volta ao app com o código. Os tokens são inventados e nunca aparecem fora
// daqui (o relatório do smoke só leva método e caminho).
import { createHash } from 'node:crypto'
import type { HttpFetch, HttpResponse } from '../accounts/http'
import { FOLDER_MIME } from './drive'

export interface FakeDriveFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  trashed: boolean
  content: Buffer
  /** Quantas vezes o conteúdo foi enviado (o resumo gerado de novo substitui: 2). */
  uploads: number
}

export interface FakeGoogleOptions {
  clientId: string
  clientSecret: string
  profile?: { name: string; email: string }
  photo?: Uint8Array
}

export interface FakeGoogle {
  fetch: HttpFetch
  /** Foto do perfil (PNG); o smoke troca pelo logo das fixtures. */
  photo: Uint8Array
  /** O "navegador": confere a URL de autorização e devolve o endereço de volta (`redirect_uri?code&state`). */
  approve(authUrl: string, options?: { deny?: boolean; state?: string }): string
  files: Map<string, FakeDriveFile>
  /** Pedidos recebidos: método, servidor e caminho (sem a consulta, sem cabeçalho, sem corpo). */
  calls: { method: string; host: string; path: string }[]
  revoked: number
  /** Próximos pedidos ao Drive que respondem 401 (token revogado antes da hora). */
  unauthorized: number
  /** A renovação responde `invalid_grant`. */
  refreshRevoked: boolean
  /** O próximo pedaço do upload cai no meio: metade chega, a conexão some. */
  dropNextChunk: boolean
  /** Os próximos pedidos ao Drive falham por rede (sem internet). */
  offline: number
  /** Os próximos pedidos ao Drive respondem 503. */
  unavailable: number
  /** Pastas a que o app perdeu o acesso: ler responde 403 e elas não aparecem na busca. */
  forbidden: Set<string>
  /** Manda a pasta (e o que está dentro) para a lixeira, como apagar no Drive. */
  trash(id: string): void
  childrenOf(parent: string): FakeDriveFile[]
  /** Access tokens válidos agora (os testes conferem que nenhum vazou). */
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

const offline = (): Promise<HttpResponse> => Promise.reject(new TypeError('fetch failed'))

/** PNG 1×1 quando o teste não dá uma foto. */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPpfDwAE3gI2d2Ow6wAAAABJRU5ErkJggg==', 'base64')

export function createFakeGoogle(options: FakeGoogleOptions): FakeGoogle {
  const profile = options.profile ?? { name: 'Pessoa de Teste', email: 'pessoa.teste@example.com' }
  const codes = new Map<string, { challenge: string; redirectUri: string }>()
  const access = new Set<string>()
  const refresh = new Set<string>()
  const sessions = new Map<string, { fileId: string | null; name: string; mimeType: string; parents: string[]; size: number; received: Buffer[] }>()
  let counter = 0
  const next = (prefix: string): string => `${prefix}${(++counter).toString(36)}`

  const fake: FakeGoogle = {
    photo: options.photo ?? TINY_PNG,
    files: new Map(),
    calls: [],
    revoked: 0,
    unauthorized: 0,
    refreshRevoked: false,
    dropNextChunk: false,
    offline: 0,
    unavailable: 0,
    forbidden: new Set(),

    approve(authUrl, { deny = false, state } = {}) {
      const url = new URL(authUrl)
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const back = new URL(redirectUri)
      back.searchParams.set('state', state ?? url.searchParams.get('state') ?? '')
      if (deny) {
        back.searchParams.set('error', 'access_denied')
        return back.toString()
      }
      if (url.searchParams.get('client_id') !== options.clientId || url.searchParams.get('code_challenge_method') !== 'S256') {
        back.searchParams.set('error', 'invalid_request')
        return back.toString()
      }
      const code = next('codigo-falso-')
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri })
      back.searchParams.set('code', code)
      return back.toString()
    },

    trash(id) {
      const file = fake.files.get(id)
      if (!file) return
      file.trashed = true
      for (const child of fake.childrenOf(id)) fake.trash(child.id)
    },

    childrenOf: (parent) => [...fake.files.values()].filter((file) => file.parents.includes(parent)),
    accessTokens: () => [...access],
    refreshTokens: () => [...refresh],

    async fetch(rawUrl, init) {
      const url = new URL(rawUrl)
      fake.calls.push({ method: init.method, host: url.host, path: url.pathname })
      const body = init.body === undefined ? Buffer.alloc(0) : typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : Buffer.from(init.body)
      const form = (): URLSearchParams => new URLSearchParams(body.toString('utf8'))

      if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token' && init.method === 'POST') {
        const fields = form()
        if (fields.get('client_id') !== options.clientId || fields.get('client_secret') !== options.clientSecret) return response(401, { error: 'invalid_client' })
        if (fields.get('grant_type') === 'authorization_code') {
          const issued = codes.get(fields.get('code') ?? '')
          codes.delete(fields.get('code') ?? '')
          const verifier = fields.get('code_verifier') ?? ''
          const challenge = createHash('sha256').update(verifier).digest('base64url')
          if (!issued || issued.challenge !== challenge || issued.redirectUri !== fields.get('redirect_uri')) return response(400, { error: 'invalid_grant' })
          const accessToken = next('token-acesso-falso-')
          const refreshToken = next('token-renovacao-falso-')
          access.add(accessToken)
          refresh.add(refreshToken)
          return response(200, { access_token: accessToken, refresh_token: refreshToken, expires_in: 3599, scope: 'openid email profile https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' })
        }
        if (fields.get('grant_type') === 'refresh_token') {
          if (fake.refreshRevoked || !refresh.has(fields.get('refresh_token') ?? '')) return response(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
          const accessToken = next('token-acesso-falso-')
          access.add(accessToken)
          return response(200, { access_token: accessToken, expires_in: 3599, scope: 'openid email profile https://www.googleapis.com/auth/drive.file', token_type: 'Bearer' })
        }
        return response(400, { error: 'unsupported_grant_type' })
      }

      if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke' && init.method === 'POST') {
        const token = form().get('token') ?? ''
        if (refresh.delete(token) || access.delete(token)) fake.revoked++
        return response(200, {})
      }

      if (url.host === 'lh3.googleusercontent.com') return response(200, fake.photo, { 'content-type': 'image/png' })

      const bearer = (init.headers['authorization'] ?? '').replace(/^Bearer /, '')
      if (url.host === 'openidconnect.googleapis.com' && url.pathname === '/v1/userinfo') {
        if (!access.has(bearer)) return response(401, { error: 'invalid_token' })
        return response(200, { sub: '1000', name: profile.name, email: profile.email, email_verified: true, picture: 'https://lh3.googleusercontent.com/a/foto-falsa=s96-c' })
      }

      if (url.host !== 'www.googleapis.com') return response(404, { error: 'não encontrado' })
      if (fake.offline > 0) {
        fake.offline--
        return offline()
      }
      if (fake.unavailable > 0) {
        fake.unavailable--
        return response(503, { error: { code: 503, message: 'Backend Error' } })
      }
      if (fake.unauthorized > 0 || !access.has(bearer)) {
        if (fake.unauthorized > 0) fake.unauthorized--
        return response(401, { error: { code: 401, message: 'Invalid Credentials' } })
      }

      // Drive v3: metadados.
      const fileMatch = /^\/drive\/v3\/files\/([\w-]+)$/.exec(url.pathname)
      if (fileMatch && init.method === 'GET') {
        if (fake.forbidden.has(fileMatch[1] ?? '')) return response(403, { error: { code: 403, errors: [{ reason: 'insufficientFilePermissions' }] } })
        const file = fake.files.get(fileMatch[1] ?? '')
        return file ? response(200, { id: file.id, trashed: file.trashed }) : response(404, { error: { code: 404, message: 'File not found' } })
      }
      if (url.pathname === '/drive/v3/files' && init.method === 'GET') {
        const q = url.searchParams.get('q') ?? ''
        const unquote = (value: string): string => value.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
        const name = unquote(/name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1] ?? '')
        const parent = unquote(/'((?:[^'\\]|\\.)*)' in parents/.exec(q)?.[1] ?? '')
        const folder = q.includes(`mimeType = '${FOLDER_MIME}'`)
        const found = [...fake.files.values()].filter(
          (file) => !file.trashed && !fake.forbidden.has(file.id) && file.name === name && (file.mimeType === FOLDER_MIME) === folder && (parent === 'root' ? file.parents.includes('root') : file.parents.includes(parent)),
        )
        return response(200, { files: found.slice(0, 1).map((file) => ({ id: file.id })) })
      }
      if (url.pathname === '/drive/v3/files' && init.method === 'POST') {
        const metadata = JSON.parse(body.toString('utf8')) as { name: string; mimeType: string; parents?: string[] }
        const parents = metadata.parents ?? ['root']
        if (parents.some((id) => id !== 'root' && (!fake.files.get(id) || fake.files.get(id)?.trashed))) return response(404, { error: { code: 404, message: 'File not found' } })
        const id = next('pasta-')
        fake.files.set(id, { id, name: metadata.name, mimeType: metadata.mimeType, parents, trashed: false, content: Buffer.alloc(0), uploads: 0 })
        return response(200, { id })
      }

      // Upload em partes: abre a sessão (criar ou substituir) e recebe os pedaços.
      const uploadUpdate = /^\/upload\/drive\/v3\/files\/([\w-]+)$/.exec(url.pathname)
      if (url.searchParams.get('uploadType') === 'resumable' && !url.searchParams.has('upload_id') && (url.pathname === '/upload/drive/v3/files' || uploadUpdate)) {
        const metadata = JSON.parse(body.toString('utf8')) as { name: string; mimeType?: string; parents?: string[] }
        const size = Number(init.headers['x-upload-content-length'] ?? '0')
        const mimeType = init.headers['x-upload-content-type'] ?? metadata.mimeType ?? 'application/octet-stream'
        let fileId: string | null = null
        let parents = metadata.parents ?? ['root']
        if (uploadUpdate) {
          const existing = fake.files.get(uploadUpdate[1] ?? '')
          if (!existing || existing.trashed) return response(404, { error: { code: 404, message: 'File not found' } })
          fileId = existing.id
          parents = existing.parents
        } else if (parents.some((id) => id !== 'root' && (!fake.files.get(id) || fake.files.get(id)?.trashed))) {
          return response(404, { error: { code: 404, message: 'File not found' } })
        }
        const sessionId = next('sessao-')
        sessions.set(sessionId, { fileId, name: metadata.name, mimeType, parents, size, received: [] })
        return response(200, {}, { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sessionId}` })
      }
      const sessionId = url.searchParams.get('upload_id')
      if (sessionId && init.method === 'PUT') {
        const session = sessions.get(sessionId)
        if (!session) return response(404, { error: { code: 404, message: 'Upload session not found' } })
        const received = (): number => session.received.reduce((total, part) => total + part.byteLength, 0)
        const incomplete = (): HttpResponse => (received() > 0 ? response(308, '', { range: `bytes=0-${received() - 1}` }) : response(308, ''))
        const finish = (): HttpResponse => {
          sessions.delete(sessionId)
          const content = Buffer.concat(session.received)
          const existing = session.fileId ? fake.files.get(session.fileId) : undefined
          if (existing) {
            existing.content = content
            existing.name = session.name
            existing.uploads++
            return response(200, { id: existing.id })
          }
          const id = next('arquivo-')
          fake.files.set(id, { id, name: session.name, mimeType: session.mimeType, parents: session.parents, trashed: false, content, uploads: 1 })
          return response(200, { id })
        }
        const range = init.headers['content-range'] ?? ''
        if (/^bytes \*\/\d+$/.test(range)) return received() >= session.size ? finish() : incomplete()
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)
        if (!match) return response(400, { error: { code: 400, message: 'Bad Content-Range' } })
        if (Number(match[1]) !== received()) return incomplete()
        if (fake.dropNextChunk) {
          fake.dropNextChunk = false
          session.received.push(body.subarray(0, Math.floor(body.byteLength / 2)))
          return offline()
        }
        session.received.push(body)
        return received() >= session.size ? finish() : incomplete()
      }
      return response(404, { error: { code: 404, message: 'não encontrado' } })
    },
  }
  return fake
}
