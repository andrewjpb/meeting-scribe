// Armazenamento de mídia compatível com S3 (contrato 70, R3 da spec redes-instagram): a imagem do Instagram precisa
// de uma URL pública, então o arquivo sobe para um bucket da pessoa (Cloudflare R2, AWS S3 ou outro compatível). A
// assinatura AWS SigV4 é feita aqui com `node:crypto`, sem dependência nova. Todo pedido passa por `redesAllowedUrl`
// com os hosts da própria configuração (endpoint, o host virtual do bucket e a URL pública) antes de sair; as
// mensagens de erro são curtas, em pt-BR, e nunca levam chave nem assinatura.
import { createHash, createHmac } from 'node:crypto'
import type { MediaHostConfig } from '../../shared/redes'
import type { HttpFetch, HttpMethod, HttpResponse } from '../accounts/http'
import { fetchWithTimeout, REDES_REQUEST_TIMEOUT_MS, redesAllowedUrl, RedesTimeoutError } from './hosts'

export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256'
/** sha256 do corpo vazio (GET, DELETE e a sondagem de existência). */
export const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex')

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest()

/** Codificação RFC 3986 que a SigV4 exige: tudo menos `A-Z a-z 0-9 - _ . ~`. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Caminho canônico do S3: cada segmento codificado uma vez, sem normalizar `.` nem `//`. */
const canonicalUri = (pathname: string): string => pathname.split('/').map((segment) => encodeRfc3986(decodeSegment(segment))).join('/') || '/'

/** Consulta canônica: chave e valor codificados, em ordem de chave (e de valor, na mesma chave). */
const canonicalQuery = (params: URLSearchParams): string =>
  [...params]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

/** `20150830T123600Z`. */
export const amzDateOf = (now: Date): string => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export interface SignS3Input {
  /** Qualquer método (o falso também confere `HEAD`); o cliente só usa os de `HttpMethod`. */
  method: string
  url: string
  /** Cabeçalhos extras a assinar (ex.: `content-type`); `host`, `x-amz-date` e `x-amz-content-sha256` entram sozinhos. */
  headers?: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  now: Date
}

/**
 * Cabeçalhos que entram na assinatura, em minúsculas. `x-amz-content-sha256` só no serviço `s3`, que o exige (os
 * vetores genéricos da AWS, como o `get-vanilla`, assinam só `host;x-amz-date`).
 */
function headersToSign(input: SignS3Input, amzDate: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value
  headers['host'] = new URL(input.url).host
  headers['x-amz-date'] = amzDate
  if ((input.service ?? 's3') === 's3') headers['x-amz-content-sha256'] = input.payloadHash
  return headers
}

/** Canonical request da SigV4 e a lista dos cabeçalhos assinados. Exportada para os testes conferirem o hash do corpo. */
export function canonicalRequest(input: SignS3Input): { canonical: string; signedHeaders: string; headers: Record<string, string> } {
  const url = new URL(input.url)
  const headers = headersToSign(input, amzDateOf(input.now))
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const canonical = [input.method, canonicalUri(url.pathname), canonicalQuery(url.searchParams), canonicalHeaders, signedHeaders, input.payloadHash].join('\n')
  return { canonical, signedHeaders, headers }
}

/**
 * Assina um pedido com AWS SigV4. Pura e determinística dado `now`: devolve os cabeçalhos assinados (`authorization`,
 * `x-amz-date`, `x-amz-content-sha256` no S3, `host` e os extras), em minúsculas.
 */
export function signS3Request(input: SignS3Input): Record<string, string> {
  const service = input.service ?? 's3'
  const amzDate = amzDateOf(input.now)
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`
  const { canonical, signedHeaders, headers } = canonicalRequest(input)
  const stringToSign = [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), service), 'aws4_request')
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')
  return { ...headers, authorization: `${SIGV4_ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }
}

/**
 * Chave de objeto só com `[a-z0-9/_.-]`: sem acento, minúsculas, o resto vira `-`. Cada parte pode ter `/`; segmentos
 * vazios ou só de pontos (`.`, `..`) somem.
 */
export function safeKey(parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .map((segment) =>
      segment
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((segment) => segment && !/^\.+$/.test(segment))
    .join('/')
}

const VALID_KEY = /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/
const encodeKey = (key: string): string => key.split('/').map(encodeRfc3986).join('/')
const trimSlash = (value: string): string => value.replace(/\/+$/, '')

export const S3_ERRORS = {
  forbidden: 'Chaves ou permissões recusadas pelo armazenamento',
  notFound: 'Bucket não encontrado',
  redirect: 'Região ou endpoint errado',
  network: 'Não foi possível falar com o armazenamento',
  /** Contrato 69 (devolução): conexão aceita e sem resposta em 15 s. */
  timeout: 'O armazenamento não respondeu a tempo',
  host: 'Endereço fora do armazenamento configurado',
  key: 'Nome de arquivo inválido para o armazenamento',
} as const

/** Texto curto de um status HTTP do armazenamento (nunca leva o corpo, que pode ecoar a chave). */
export function s3ErrorText(status: number): string {
  if (status === 403) return S3_ERRORS.forbidden
  if (status === 404) return S3_ERRORS.notFound
  if (status === 301 || status === 307) return S3_ERRORS.redirect
  return `Armazenamento respondeu ${status}`
}

/** Hosts que a configuração autoriza: o endpoint, o host virtual do bucket (fora do modo de caminho) e a URL pública. */
export function mediaHostHosts(config: MediaHostConfig): string[] {
  const hosts: string[] = []
  for (const value of [config.endpoint, config.publicBaseUrl]) {
    try {
      hosts.push(new URL(value).host)
    } catch {
      // URL inválida: nenhum host dela entra na lista, e todo pedido para ela é recusado.
    }
  }
  if (!config.pathStyle && hosts[0]) hosts.push(`${config.bucket}.${hosts[0]}`)
  return hosts
}

/** Recusa (lança) a URL fora dos hosts, antes de qualquer pedido. */
export function assertHost(url: string, hosts: readonly string[]): void {
  if (!redesAllowedUrl(url, hosts)) throw new Error(S3_ERRORS.host)
}

export type S3PutResult = { ok: true; url: string } | { ok: false; error: string }

export interface S3Client {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<S3PutResult>
  delete(key: string): Promise<{ ok: boolean; error?: string }>
  head(key: string): Promise<{ exists: boolean }>
  /** Endereço da API: `endpoint/bucket/key` (modo de caminho) ou `https://bucket.host/key`. */
  objectUrl(key: string): string
  /** Endereço público: `publicBaseUrl/key`, cada segmento codificado. */
  publicUrl(key: string): string
}

/** `timeoutMs`: o prazo de cada pedido (15 s, o mesmo do Instagram; os testes encurtam). */
export function createS3Client(fetch: HttpFetch, config: MediaHostConfig, secretAccessKey: string, now: () => Date = () => new Date(), timeoutMs = REDES_REQUEST_TIMEOUT_MS): S3Client {
  const hosts = mediaHostHosts(config)

  const objectUrl = (key: string): string => {
    if (config.pathStyle) return `${trimSlash(config.endpoint)}/${encodeRfc3986(config.bucket)}/${encodeKey(key)}`
    const endpoint = new URL(config.endpoint)
    return `${endpoint.protocol}//${config.bucket}.${endpoint.host}${trimSlash(endpoint.pathname)}/${encodeKey(key)}`
  }

  const publicUrl = (key: string): string => `${trimSlash(config.publicBaseUrl)}/${encodeKey(key)}`

  /** Pedido assinado. `host` fica de fora do que vai ao `fetch`: quem manda é o transporte, com o mesmo valor da URL. */
  async function send(method: HttpMethod, key: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<{ status: number } | { error: string }> {
    if (!VALID_KEY.test(key)) return { error: S3_ERRORS.key }
    let url: string
    try {
      url = objectUrl(key)
      assertHost(url, hosts)
    } catch {
      return { error: S3_ERRORS.host }
    }
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH
    const { host: _host, ...headers } = signS3Request({ method, url, headers: extra, payloadHash, accessKeyId: config.accessKeyId, secretAccessKey, region: config.region, now: now() })
    // Com prazo (contrato 69, devolução): o PUT, o DELETE e a sondagem rodam na fila do serviço das redes. Só o status
    // interessa; o corpo (o XML de erro, que pode ecoar a chave) nem é lido.
    try {
      return await fetchWithTimeout(fetch, url, { method, headers, ...(body ? { body } : {}) }, (response: HttpResponse) => Promise.resolve({ status: response.status }), timeoutMs)
    } catch (error) {
      return { error: error instanceof RedesTimeoutError ? S3_ERRORS.timeout : S3_ERRORS.network }
    }
  }

  return {
    objectUrl,
    publicUrl,

    async put(key, bytes, contentType) {
      const result = await send('PUT', key, bytes, { 'content-type': contentType })
      if ('error' in result) return { ok: false, error: result.error }
      if (result.status !== 200) return { ok: false, error: s3ErrorText(result.status) }
      return { ok: true, url: publicUrl(key) }
    },

    async delete(key) {
      const result = await send('DELETE', key)
      if ('error' in result) return { ok: false, error: result.error }
      const { status } = result
      return status === 200 || status === 204 || status === 404 ? { ok: true } : { ok: false, error: s3ErrorText(status) }
    },

    // `HttpMethod` (accounts/http.ts) não tem `HEAD`: a existência é sondada com um GET do primeiro byte (206; 200 se o
    // servidor ignora o `range`; 416 num objeto vazio).
    async head(key) {
      const result = await send('GET', key, undefined, { range: 'bytes=0-0' })
      if ('error' in result) return { exists: false }
      const { status } = result
      return { exists: status === 200 || status === 206 || status === 416 }
    },
  }
}
