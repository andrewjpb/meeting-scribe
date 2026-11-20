// Destinos de rede das redes sociais (contrato 69, R10 da spec redes-instagram). Como `accounts/http.ts`, todo pedido
// passa pela lista antes de sair; aqui a lista é de hosts (com a porta, quando houver), porque o armazenamento S3 do
// contrato 70 entra com o endpoint e a URL pública que a pessoa configurou. `http://` só vale no próprio Mac
// (`127.0.0.1`, `localhost`), que é o que o smoke usa.

import type { HttpFetch, HttpRequest, HttpResponse } from '../accounts/http'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

/** `https://` (ou `http://` no próprio Mac), sem usuário nem senha, num host da lista (`host` com a porta, como `URL.host`). */
export function redesAllowedUrl(url: string, hosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username || parsed.password) return false
  const secure = parsed.protocol === 'https:'
  const loopback = parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname)
  if (!secure && !loopback) return false
  return hosts.includes(parsed.host)
}

/** Um pedido das redes parado por mais que isto (conexão aceita e sem resposta) desiste. */
export const REDES_REQUEST_TIMEOUT_MS = 15_000

/** O pedido (e a leitura do corpo, em `read`) passou de `REDES_REQUEST_TIMEOUT_MS`. */
export class RedesTimeoutError extends Error {
  constructor() {
    super('tempo esgotado')
    this.name = 'RedesTimeoutError'
  }
}

/**
 * O `fetch` com prazo: aborta o pedido pelo `signal` e, para um transporte que não respeita o `signal`, desiste do
 * mesmo jeito (`RedesTimeoutError`). `read` lê o corpo dentro do mesmo prazo. Os pedidos das redes rodam na fila do
 * serviço: sem isso, um servidor que aceita a conexão e para trava conectar, renovar e remover.
 */
export async function fetchWithTimeout<T>(fetch: HttpFetch, url: string, init: HttpRequest, read: (response: HttpResponse) => Promise<T>, timeoutMs = REDES_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new RedesTimeoutError())
    }, timeoutMs)
  })
  const request = fetch(url, { ...init, signal: controller.signal }).then(read)
  // Perdeu a corrida para o prazo: o erro do pedido abortado, que chega depois, não vira rejeição solta.
  request.catch(() => undefined)
  try {
    return await Promise.race([request, expired])
  } finally {
    clearTimeout(timer)
  }
}
