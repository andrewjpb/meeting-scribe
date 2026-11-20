// Armazenamento S3 falso, em memória, para os testes e o smoke (contrato 70; o 71 injeta no smoke), no padrão do
// `google/fake-google.ts`. Responde a API do bucket (no modo de caminho `endpoint/bucket/key` ou no host virtual
// `bucket.host/key`) e a leitura pública em `publicBaseUrl/<key>`. Confere o prefixo do `Authorization` com a chave de
// acesso e, com `strictSignature`, refaz a assinatura com `signS3Request` e recusa (403) a que diferir. `calls` leva
// só método, servidor e caminho: nada de cabeçalho, assinatura ou corpo.
import type { HttpFetch, HttpResponse } from '../accounts/http'
import { SIGV4_ALGORITHM, sha256Hex, signS3Request } from './s3'

export interface FakeS3Options {
  endpoint: string
  bucket: string
  publicBaseUrl: string
  accessKeyId: string
  secretAccessKey: string
  /** Refaz a assinatura de cada pedido e confere o sha256 do corpo. */
  strictSignature?: boolean
}

export interface FakeS3Object {
  body: Uint8Array
  contentType: string
}

export interface FakeS3 {
  fetch: HttpFetch
  /** Pedidos recebidos: método, servidor e caminho (sem consulta, cabeçalho nem corpo). */
  calls: { method: string; host: string; path: string }[]
  /** `false`: o bucket não é público e a leitura pela URL pública responde 403. */
  publicAccess: boolean
  /** Cópia dos objetos guardados, por chave. */
  objects(): Map<string, FakeS3Object>
}

const response = (status: number, body: Uint8Array | string = '', headers: Record<string, string> = {}): HttpResponse => {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
  return {
    status,
    header: (name) => lower[name.toLowerCase()] ?? null,
    text: () => Promise.resolve(Buffer.from(bytes).toString('utf8')),
    bytes: () => Promise.resolve(bytes),
  }
}

const xmlError = (status: number, code: string): HttpResponse => response(status, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`, { 'content-type': 'application/xml' })

const decodeKey = (path: string): string => path.split('/').map((segment) => decodeURIComponent(segment)).join('/')

/** `20150830T123600Z` → `Date`. */
const dateOf = (amzDate: string): Date | null => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate)
  return match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : null
}

export function createFakeS3(options: FakeS3Options): FakeS3 {
  const endpoint = new URL(options.endpoint)
  const publicBase = new URL(options.publicBaseUrl)
  const publicPath = publicBase.pathname.replace(/\/+$/, '')
  const endpointPath = endpoint.pathname.replace(/\/+$/, '')
  const store = new Map<string, FakeS3Object>()

  /** A chave do objeto no pedido à API, ou `null` se não é deste bucket. */
  function apiKey(url: URL): string | null {
    if (url.host === endpoint.host && url.pathname.startsWith(`${endpointPath}/${options.bucket}/`)) return decodeKey(url.pathname.slice(endpointPath.length + options.bucket.length + 2))
    if (url.host === `${options.bucket}.${endpoint.host}` && url.pathname.startsWith(`${endpointPath}/`)) return decodeKey(url.pathname.slice(endpointPath.length + 1))
    return null
  }

  /** A assinatura confere? Refaz com os mesmos cabeçalhos assinados, a data e a região do escopo. */
  function signatureMatches(url: string, method: string, headers: Record<string, string>, authorization: string, body: Uint8Array): boolean {
    const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=[0-9a-f]{64}$/.exec(authorization)
    const now = dateOf(headers['x-amz-date'] ?? '')
    const payloadHash = headers['x-amz-content-sha256'] ?? ''
    if (!match || !now || payloadHash !== sha256Hex(body)) return false
    const extra: Record<string, string> = {}
    for (const name of (match[4] ?? '').split(';')) {
      if (name === 'host' || name === 'x-amz-date' || name === 'x-amz-content-sha256') continue
      const value = headers[name]
      if (value === undefined) return false
      extra[name] = value
    }
    const signed = signS3Request({ method, url, headers: extra, payloadHash, accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, region: match[3] ?? '', now })
    return signed['authorization'] === authorization
  }

  const fake: FakeS3 = {
    calls: [],
    publicAccess: true,
    objects: () => new Map([...store].map(([key, object]) => [key, { body: new Uint8Array(object.body), contentType: object.contentType }])),

    async fetch(rawUrl, init) {
      const url = new URL(rawUrl)
      const method: string = init.method
      fake.calls.push({ method, host: url.host, path: url.pathname })
      const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]))
      const body = init.body === undefined ? new Uint8Array(0) : typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : new Uint8Array(init.body)
      const authorization = headers['authorization']

      // Leitura pública: sem assinatura, só GET.
      if (!authorization && url.host === publicBase.host && url.pathname.startsWith(`${publicPath}/`)) {
        if (method !== 'GET') return xmlError(405, 'MethodNotAllowed')
        if (!fake.publicAccess) return xmlError(403, 'AccessDenied')
        const object = store.get(decodeKey(url.pathname.slice(publicPath.length + 1)))
        return object ? response(200, object.body, { 'content-type': object.contentType }) : xmlError(404, 'NoSuchKey')
      }

      if (url.host !== endpoint.host && url.host !== `${options.bucket}.${endpoint.host}`) return xmlError(404, 'NoSuchBucket')
      if (!authorization?.startsWith(`${SIGV4_ALGORITHM} Credential=${options.accessKeyId}/`)) return xmlError(403, 'InvalidAccessKeyId')
      if (options.strictSignature && !signatureMatches(rawUrl, method, headers, authorization, body)) return xmlError(403, 'SignatureDoesNotMatch')
      const key = apiKey(url)
      if (!key) return xmlError(404, 'NoSuchBucket')

      if (method === 'PUT') {
        store.set(key, { body: new Uint8Array(body), contentType: headers['content-type'] ?? 'application/octet-stream' })
        return response(200, '', { etag: `"${sha256Hex(body).slice(0, 32)}"` })
      }
      if (method === 'DELETE') {
        store.delete(key)
        return response(204)
      }
      const object = store.get(key)
      if (method === 'HEAD') return object ? response(200, '', { 'content-length': String(object.body.byteLength) }) : response(404)
      if (method === 'GET') {
        if (!object) return xmlError(404, 'NoSuchKey')
        if (headers['range'] === 'bytes=0-0') return object.body.byteLength ? response(206, object.body.slice(0, 1)) : xmlError(416, 'InvalidRange')
        return response(200, object.body, { 'content-type': object.contentType })
      }
      return xmlError(405, 'MethodNotAllowed')
    },
  }
  return fake
}
