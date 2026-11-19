// "Carregar imagens" de um email (contrato 43, CA2): a CSP do renderer não deixa a tela buscar imagem fora do app, então
// o main baixa as imagens pedidas e devolve data URLs. Só no clique da pessoa; só `http(s)` com nome de servidor público:
// o nome é normalizado (minúsculas, sem o ponto final), os sufixos de rede local são recusados e o nome é resolvido
// antes; se QUALQUER endereço for de loopback, rede privada, link-local, CGNAT, ULA ou IPv4 dentro de IPv6, nada é
// pedido. Só resposta `image/*` de até 5 MB (lida aos pedaços e cortada ao passar), em até 10 s; redirecionamento
// recusado (não leva a outro endereço). Sem cookie. A que falhar volta `null` e a tela mostra o texto alternativo.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { EMAIL_REMOTE_IMAGE_MAX_BYTES, EMAIL_REMOTE_IMAGES_MAX } from '../../shared/email'

export const REMOTE_IMAGE_TIMEOUT_MS = 10_000

/** Baixa uma imagem; `null` se não deu (status, tipo ou tamanho). */
export type RemoteImageFetch = (url: string, signal: AbortSignal) => Promise<{ type: string; bytes: Uint8Array } | null>
/** Os endereços de um nome (no app, `dns.promises.lookup` com `all: true`). */
export type HostLookup = (host: string) => Promise<{ address: string; family: number }[]>

export const systemLookup: HostLookup = (host) => dnsLookup(host, { all: true, verbatim: true })

const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.internal', '.home', '.home.arpa', '.localdomain', '.intranet', '.corp']

/** O nome do servidor como comparado: minúsculas e sem o ponto final (`localhost.` é `localhost`). */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

/** Endereço que pode ser baixado pelo texto: `http(s)`, sem usuário na URL, com nome (não IP) público. */
export function isRemoteImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  const host = normalizeHost(url.hostname)
  if (!host || isIP(host) !== 0 || !host.includes('.')) return false
  return host !== 'localhost' && !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

const ipv4Number = (address: string): number => address.split('.').reduce((total, part) => total * 256 + Number(part), 0)
const inRange = (address: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((ipv4Number(address) & mask) >>> 0) === ((ipv4Number(base) & mask) >>> 0)
}

/** IPv4 fora da internet pública: loopback, privadas, link-local, CGNAT, "esta rede", multicast e reservadas. */
const PRIVATE_V4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

/** O endereço resolvido não pode ser baixado (qualquer coisa que não seja IPv4 ou IPv6 público). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return PRIVATE_V4.some(([base, bits]) => inRange(address, base, bits))
  if (family !== 6) return true
  const value = address.toLowerCase()
  if (value === '::' || value === '::1') return true
  // IPv4 dentro de IPv6 (`::ffff:10.0.0.1`, `::10.0.0.1`) e NAT64: recusados de vez.
  if (value.includes('.') || value.startsWith('::ffff:') || value.startsWith('64:ff9b:')) return true
  const first = parseInt(value.split(':')[0] || '0', 16)
  // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (site-local antigo), ff00::/8 (multicast).
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00
}

/** O nome resolve só para endereços públicos (e resolve para algum). */
export async function resolvesPublic(host: string, lookup: HostLookup): Promise<boolean> {
  const found = await lookup(normalizeHost(host))
  return found.length > 0 && found.every((item) => !isPrivateAddress(item.address))
}

/** Lê uma resposta aos pedaços e desiste ao passar do limite (sem confiar no `content-length`). */
export async function readLimited(body: ReadableStream<Uint8Array> | null, max = EMAIL_REMOTE_IMAGE_MAX_BYTES): Promise<Uint8Array | null> {
  if (!body) return null
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function loadRemoteImages(request: unknown, fetchImage: RemoteImageFetch, lookup: HostLookup, timeoutMs = REMOTE_IMAGE_TIMEOUT_MS): Promise<Record<string, string | null>> {
  const urls = (request as { urls?: unknown } | undefined)?.urls
  if (!Array.isArray(urls)) return {}
  const wanted = [...new Set(urls.filter(isRemoteImageUrl))].slice(0, EMAIL_REMOTE_IMAGES_MAX)
  const entries = await Promise.all(
    wanted.map(async (url): Promise<[string, string | null]> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        if (!(await resolvesPublic(new URL(url).hostname, lookup))) return [url, null]
        const image = await fetchImage(url, controller.signal)
        if (!image || !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(image.type) || image.bytes.byteLength > EMAIL_REMOTE_IMAGE_MAX_BYTES) return [url, null]
        return [url, `data:${image.type.toLowerCase()};base64,${Buffer.from(image.bytes).toString('base64')}`]
      } catch {
        return [url, null]
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return Object.fromEntries(entries)
}
