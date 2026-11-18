// Transcrição de um arquivo de áudio pela AssemblyAI (contrato 37, áudio do WhatsApp), só no main: o upload dos
// bytes em `POST /v2/upload`, o pedido em `POST /v2/transcript` (com a detecção do idioma) e a consulta em
// `GET /v2/transcript/<id>` a cada 2 s até `completed` ou `error`, com 120 s no total. A chave é a mesma da
// transcrição ao vivo (`getApiKey`), vai só no cabeçalho, e nenhum pedido segue redirecionamento. `fetch` chega
// injetado (os testes e o smoke usam respostas falsas; o app usa `net.fetch`). Todo erro sai como
// `FileTranscriptError` tipado, sem a mensagem original (que pode trazer URL).
import type { FetchLike, FetchResponse } from './gateway'

export const TRANSCRIPT_BASE_URL = 'https://api.assemblyai.com/v2'
export const TRANSCRIPT_TIMEOUT_MS = 120_000
export const TRANSCRIPT_POLL_MS = 2_000

export type FileTranscriptErrorKind = 'no-key' | 'key-rejected' | 'network' | 'timeout' | 'server' | 'failed' | 'format'

export class FileTranscriptError extends Error {
  constructor(
    readonly kind: FileTranscriptErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'FileTranscriptError'
  }
}

export interface FileTranscriber {
  /** O texto do áudio (vazio quando não há fala). Lança `FileTranscriptError`. */
  transcribe(bytes: Uint8Array): Promise<string>
}

export interface FileTranscriberOptions {
  fetch: FetchLike
  getApiKey: () => string | null
  baseUrl?: string
  timeoutMs?: number
  pollMs?: number
  /** Espera entre as consultas (os testes trocam). */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const TRANSCRIPT_ID = /^[\w-]{1,100}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

async function jsonOf(response: FetchResponse): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = JSON.parse(await response.text())
  } catch {
    throw new FileTranscriptError('format', 'resposta em formato inesperado')
  }
  if (!isRecord(body)) throw new FileTranscriptError('format', 'resposta em formato inesperado')
  return body
}

function checkStatus(response: FetchResponse): void {
  if (response.status === 401 || response.status === 403) throw new FileTranscriptError('key-rejected', 'chave recusada pela AssemblyAI')
  if (response.status !== 200) throw new FileTranscriptError('server', `resposta ${response.status}`)
}

export function createFileTranscriber({
  fetch,
  getApiKey,
  baseUrl = TRANSCRIPT_BASE_URL,
  timeoutMs = TRANSCRIPT_TIMEOUT_MS,
  pollMs = TRANSCRIPT_POLL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: FileTranscriberOptions): FileTranscriber {
  return {
    async transcribe(bytes) {
      const key = getApiKey()
      if (!key) throw new FileTranscriptError('no-key', 'nenhuma chave configurada')
      const deadline = now() + timeoutMs
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const expired = (): boolean => timedOut || now() >= deadline
      try {
        const upload = await fetch(`${baseUrl}/upload`, {
          method: 'POST',
          headers: { authorization: key, 'content-type': 'application/octet-stream' },
          body: bytes,
          signal: controller.signal,
          redirect: 'error',
        })
        checkStatus(upload)
        const audioUrl = (await jsonOf(upload))['upload_url']
        if (typeof audioUrl !== 'string' || !audioUrl.startsWith('https://')) throw new FileTranscriptError('format', 'upload sem endereço')
        const created = await fetch(`${baseUrl}/transcript`, {
          method: 'POST',
          headers: { authorization: key, 'content-type': 'application/json' },
          body: JSON.stringify({ audio_url: audioUrl, language_detection: true }),
          signal: controller.signal,
          redirect: 'error',
        })
        checkStatus(created)
        const id = (await jsonOf(created))['id']
        if (typeof id !== 'string' || !TRANSCRIPT_ID.test(id)) throw new FileTranscriptError('format', 'transcrição sem id')
        for (;;) {
          if (expired()) throw new FileTranscriptError('timeout', `sem resposta em ${timeoutMs / 1000} s`)
          const polled = await fetch(`${baseUrl}/transcript/${id}`, { method: 'GET', headers: { authorization: key }, signal: controller.signal, redirect: 'error' })
          checkStatus(polled)
          const body = await jsonOf(polled)
          if (body['status'] === 'completed') return typeof body['text'] === 'string' ? body['text'] : ''
          if (body['status'] === 'error') throw new FileTranscriptError('failed', 'a AssemblyAI não transcreveu o áudio')
          if (now() + pollMs >= deadline) throw new FileTranscriptError('timeout', `sem resposta em ${timeoutMs / 1000} s`)
          await sleep(pollMs)
        }
      } catch (error) {
        if (error instanceof FileTranscriptError) throw error
        throw timedOut ? new FileTranscriptError('timeout', `sem resposta em ${timeoutMs / 1000} s`) : new FileTranscriptError('network', 'falha de rede')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
