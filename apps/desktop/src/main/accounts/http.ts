// Rede das contas (contratos 11 e 12): o tipo do `fetch` injetado e a lista fechada de destinos. O app usa o
// `net.fetch` do Electron (`accounts/transport.ts`); os testes e o smoke, um Google falso em memória. Todo
// pedido passa por `allowedUrl` antes de sair: um endereço fora da lista nunca é pedido.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface HttpRequest {
  method: HttpMethod
  headers: Record<string, string>
  body?: string | Uint8Array
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  header(name: string): string | null
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

export type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>

/**
 * Destinos de rede das contas, todos pedidos pelo main (CA7). `accounts.google.com` e
 * `login.microsoftonline.com` só abrem no navegador (`oauth.ts`), nunca aqui.
 */
export const ACCOUNT_HOSTS: readonly { host: string; path: string }[] = [
  { host: 'oauth2.googleapis.com', path: '/' },
  { host: 'openidconnect.googleapis.com', path: '/' },
  { host: 'www.googleapis.com', path: '/oauth2/' },
  { host: 'www.googleapis.com', path: '/drive/v3/' },
  { host: 'www.googleapis.com', path: '/upload/drive/v3/' },
  { host: 'lh3.googleusercontent.com', path: '/' },
  // Contrato 12: as agendas e a conta Microsoft (o token, o perfil, a foto e o `calendarView`).
  { host: 'www.googleapis.com', path: '/calendar/v3/' },
  { host: 'login.microsoftonline.com', path: '/common/oauth2/v2.0/token' },
  { host: 'graph.microsoft.com', path: '/v1.0/me' },
]

/** Só `https://`, sem usuário nem porta, num destino da lista. */
export function allowedUrl(url: string, hosts: readonly { host: string; path: string }[] = ACCOUNT_HOSTS): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  return hosts.some((entry) => parsed.hostname === entry.host && parsed.pathname.startsWith(entry.path))
}

/** Falha de rede (sem internet, DNS, conexão caída): o envio (e a leitura da agenda) tenta de novo mais tarde. */
export class NetworkError extends Error {
  readonly code = 'network'
  constructor(message = 'sem conexão') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** O `fetch` injetado, só para destinos da lista; qualquer exceção dele vira `NetworkError`. */
export function guardedFetch(fetch: HttpFetch, hosts: readonly { host: string; path: string }[] = ACCOUNT_HOSTS): HttpFetch {
  return async (url, init) => {
    if (!allowedUrl(url, hosts)) throw new Error('destino fora da lista das contas')
    try {
      return await fetch(url, init)
    } catch (error) {
      if (init.signal?.aborted) throw error
      throw new NetworkError(error instanceof Error ? error.message : String(error))
    }
  }
}

/** Corpo `application/x-www-form-urlencoded`. */
export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

/** JSON da resposta, ou `null` se não for JSON. */
export async function jsonOf(response: HttpResponse): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown
  } catch {
    return null
  }
}
