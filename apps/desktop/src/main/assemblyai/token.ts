// Token temporário de streaming da AssemblyAI (CA1): o renderer nunca vê a chave; o main troca a chave
// guardada por um token curto e devolve só `{token, expiresInSeconds}`.
//
// Comportamento real conferido em 14/11/2026 com a conta de teste:
// - `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60` com `authorization: <chave>`
//   responde 200 `{"token":"...","expires_in_seconds":60}`. É o endpoint que vale.
// - `POST https://token.assemblyai.com/v1/token` responde 422 (não aceita o formato documentado).
// - Chave inválida responde **404** `{"detail":"Invalid API key"}` (não 401, como o contrato supunha);
//   por isso 401, 403 e 404 viram `key-rejected`.
// - `expires_in_seconds` aceita de 1 a 600.
import type { TranscriptionTokenResult } from '../../shared/transcription'
import type { FetchLike } from './gateway'

export const TOKEN_BASE_URL = 'https://streaming.assemblyai.com/v3/token'
export const TOKEN_TIMEOUT_MS = 8_000
const EXPIRES_SECONDS = 60

export class TokenError extends Error {
  constructor(
    readonly kind: 'no-key' | 'key-rejected' | 'network' | 'server' | 'format',
    message: string,
  ) {
    super(message)
    this.name = 'TokenError'
  }
}

export interface TokenClient {
  /** Lança `TokenError`; nunca devolve a chave. */
  get(): Promise<{ token: string; expiresInSeconds: number }>
}

export interface TokenClientOptions {
  fetch: FetchLike
  getApiKey: () => string | null
  timeoutMs?: number
  baseUrl?: string
  expiresInSeconds?: number
}

export function createTokenClient({
  fetch,
  getApiKey,
  timeoutMs = TOKEN_TIMEOUT_MS,
  baseUrl = TOKEN_BASE_URL,
  expiresInSeconds = EXPIRES_SECONDS,
}: TokenClientOptions): TokenClient {
  return {
    async get() {
      const key = getApiKey()
      if (!key) throw new TokenError('no-key', 'nenhuma chave configurada')
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      try {
        // A URL não leva a chave: ela vai no cabeçalho, e um redirecionamento é recusado para o
        // cabeçalho nunca seguir para outro host.
        const response = await fetch(`${baseUrl}?expires_in_seconds=${expiresInSeconds}`, {
          method: 'GET',
          headers: { authorization: key },
          signal: controller.signal,
          redirect: 'error',
        })
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new TokenError('key-rejected', 'chave recusada pela AssemblyAI')
        }
        if (response.status !== 200) throw new TokenError('server', `resposta ${response.status}`)
        const body: unknown = JSON.parse(await response.text())
        if (typeof body !== 'object' || body === null) throw new TokenError('format', 'resposta em formato inesperado')
        const { token, expires_in_seconds: expires } = body as { token?: unknown; expires_in_seconds?: unknown }
        if (typeof token !== 'string' || !token) throw new TokenError('format', 'token ausente na resposta')
        return { token, expiresInSeconds: typeof expires === 'number' && expires > 0 ? Math.floor(expires) : expiresInSeconds }
      } catch (error) {
        if (error instanceof TokenError) throw error
        // Mensagem original pode trazer URL: não é repassada.
        throw timedOut ? new TokenError('network', `sem resposta em ${timeoutMs / 1000} s`) : new TokenError('network', 'falha de rede')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Erro de `TokenClient.get()` já no formato do canal (CA1). */
export async function requestToken(client: TokenClient): Promise<TranscriptionTokenResult> {
  try {
    const { token, expiresInSeconds } = await client.get()
    return { ok: true, token, expiresInSeconds }
  } catch (error) {
    const kind = error instanceof TokenError ? error.kind : 'server'
    return { ok: false, error: kind }
  }
}
