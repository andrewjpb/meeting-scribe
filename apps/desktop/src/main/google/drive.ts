// API do Google Drive v3 (contrato 11, CA4), só o que o envio usa: achar ou criar pasta, conferir se uma pasta
// ainda existe e enviar um arquivo em partes (upload `resumable`, pedaços de 8 MB). Com o escopo `drive.file`
// o app só vê o que ele mesmo criou. Cada pedido leva o token do momento (`token()`); a classificação dos
// erros fica em `DriveError`, para a fila decidir entre tentar de novo, renovar o token ou recriar a pasta.
import type { DriveErrorReason } from '../../shared/accounts'
import { jsonOf, NetworkError, type HttpFetch, type HttpResponse } from '../accounts/http'

export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** Pedaço do upload em partes: múltiplo de 256 KiB, como o Drive exige. */
export const CHUNK_BYTES = 8 * 1024 * 1024

/**
 * `network`: sem conexão; `auth`: 401; `not-found`: 404 (arquivo ou pasta apagados); `rate`: 429 ou limite de
 * uso; `server`: 5xx; `quota`: Drive cheio; `refused`: outro 4xx.
 */
export type DriveErrorKind = 'network' | 'auth' | 'not-found' | 'rate' | 'server' | 'quota' | 'refused'

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    readonly status: number | null = null,
  ) {
    super(`drive: ${kind}${status ? ` (${status})` : ''}`)
    this.name = 'DriveError'
  }

  /** Erro que passa sozinho: a fila tenta de novo mais tarde. */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'rate' || this.kind === 'server'
  }

  /** O motivo curto que a tela mostra. */
  get reason(): DriveErrorReason {
    if (this.kind === 'quota') return 'quota'
    if (this.kind === 'auth') return 'session'
    if (this.kind === 'rate' || this.kind === 'server' || this.kind === 'network') return 'server'
    return 'refused'
  }
}

async function errorOf(response: HttpResponse): Promise<DriveError> {
  const { status } = response
  if (status === 401) return new DriveError('auth', status)
  if (status === 404) return new DriveError('not-found', status)
  if (status === 429) return new DriveError('rate', status)
  if (status >= 500) return new DriveError('server', status)
  const body = (await jsonOf(response)) as { error?: { errors?: { reason?: unknown }[] } } | null
  const reasons = (body?.error?.errors ?? []).map((item) => item.reason)
  if (reasons.includes('storageQuotaExceeded')) return new DriveError('quota', status)
  if (reasons.some((reason) => reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) return new DriveError('rate', status)
  return new DriveError('refused', status)
}

/** Conteúdo a enviar: o tamanho e uma leitura por trecho (o áudio nunca fica inteiro na memória). */
export interface UploadSource {
  name: string
  mimeType: string
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

/** Sessão de upload em andamento: o endereço que o Drive deu e o tamanho do arquivo. Só na memória. */
export interface UploadSession {
  uri: string
  size: number
}

export interface DriveClient {
  /** A pasta existe e não está na lixeira? 404 é `false`; outros erros são lançados. */
  folderExists(id: string): Promise<boolean>
  /** Pasta (ou arquivo) com este nome dentro de `parent` (`root` é a raiz), fora da lixeira; `null` se não há. */
  findByName(name: string, parent: string, folder: boolean): Promise<string | null>
  createFolder(name: string, parent: string): Promise<string>
  /**
   * Envia em partes: `fileId` substitui o conteúdo do arquivo (o mesmo id); `null` cria dentro de `parent`.
   * `session` retoma um envio que caiu no meio. Devolve o id do arquivo.
   */
  upload(input: {
    source: UploadSource
    parent: string
    fileId: string | null
    session?: UploadSession | null
    onSession?: (session: UploadSession | null) => void
    onBytes?: (sent: number) => void
  }): Promise<string>
}

/** Nome dentro de uma consulta do Drive: aspas simples e barra invertida escapadas. */
const quoted = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function createDriveClient(fetch: HttpFetch, token: () => Promise<string>): DriveClient {
  const request = async (url: string, init: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<HttpResponse> => {
    const headers = { authorization: `Bearer ${await token()}`, ...init.headers }
    try {
      return await fetch(url, { method: init.method, headers, ...(init.body !== undefined ? { body: init.body } : {}) })
    } catch (error) {
      if (error instanceof NetworkError) throw new DriveError('network')
      throw error
    }
  }

  const idOf = async (response: HttpResponse): Promise<string> => {
    const body = (await jsonOf(response)) as { id?: unknown } | null
    if (typeof body?.id !== 'string' || !body.id) throw new DriveError('server', response.status)
    return body.id
  }

  /** Abre a sessão de upload: o Drive responde com o endereço em `Location`. */
  async function startSession(source: UploadSource, parent: string, fileId: string | null): Promise<UploadSession> {
    const metadata = fileId ? { name: source.name } : { name: source.name, parents: [parent], mimeType: source.mimeType }
    const url = fileId ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id` : `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id`
    const response = await request(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': source.mimeType,
        'x-upload-content-length': String(source.size),
      },
      body: JSON.stringify(metadata),
    })
    if (response.status !== 200) throw await errorOf(response)
    const uri = response.header('location')
    if (!uri?.startsWith(`${DRIVE_UPLOAD_API}/`)) throw new DriveError('server', response.status)
    return { uri, size: source.size }
  }

  /** Onde a sessão parou: o próximo byte a enviar, `null` se a sessão não vale mais, ou o id se já terminou. */
  async function resumeAt(session: UploadSession): Promise<{ next: number } | { id: string } | null> {
    const response = await request(session.uri, { method: 'PUT', headers: { 'content-range': `bytes */${session.size}` }, body: new Uint8Array(0) })
    if (response.status === 200 || response.status === 201) return { id: await idOf(response) }
    if (response.status === 308) return { next: nextByte(response) }
    if (response.status === 404 || response.status === 410) return null
    throw await errorOf(response)
  }

  /** `Range: bytes=0-N` do 308: o próximo byte é N + 1; sem `Range`, nada chegou. */
  function nextByte(response: HttpResponse): number {
    const match = /bytes=0-(\d+)/.exec(response.header('range') ?? '')
    return match?.[1] ? Number(match[1]) + 1 : 0
  }

  return {
    async folderExists(id) {
      const response = await request(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,trashed`, { method: 'GET' })
      if (response.status === 404) return false
      if (response.status !== 200) throw await errorOf(response)
      const body = (await jsonOf(response)) as { trashed?: unknown } | null
      return body?.trashed !== true
    },

    async findByName(name, parent, folder) {
      const q = [`name = ${quoted(name)}`, `${quoted(parent)} in parents`, 'trashed = false', `mimeType ${folder ? '=' : '!='} ${quoted(FOLDER_MIME)}`].join(' and ')
      const url = `${DRIVE_API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' }).toString()}`
      const response = await request(url, { method: 'GET' })
      if (response.status !== 200) throw await errorOf(response)
      const body = (await jsonOf(response)) as { files?: { id?: unknown }[] } | null
      const id = body?.files?.[0]?.id
      return typeof id === 'string' && id ? id : null
    },

    async createFolder(name, parent) {
      const response = await request(`${DRIVE_API}/files?fields=id`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
      })
      if (response.status !== 200) throw await errorOf(response)
      return idOf(response)
    },

    async upload({ source, parent, fileId, session: previous = null, onSession, onBytes }) {
      let session = previous && previous.size === source.size ? previous : null
      let offset = 0
      if (session) {
        const at = await resumeAt(session)
        if (at && 'id' in at) {
          onSession?.(null)
          onBytes?.(source.size)
          return at.id
        }
        if (at) offset = at.next
        else session = null
      }
      if (!session) {
        session = await startSession(source, parent, fileId)
        offset = 0
      }
      onSession?.(session)
      onBytes?.(offset)
      for (;;) {
        const length = Math.min(CHUNK_BYTES, source.size - offset)
        const chunk = length > 0 ? await source.read(offset, length) : new Uint8Array(0)
        const range = source.size === 0 ? `bytes */0` : `bytes ${offset}-${offset + chunk.byteLength - 1}/${source.size}`
        const response = await request(session.uri, { method: 'PUT', headers: { 'content-range': range }, body: chunk })
        if (response.status === 200 || response.status === 201) {
          onSession?.(null)
          onBytes?.(source.size)
          return idOf(response)
        }
        if (response.status === 308) {
          // O Drive pode guardar menos do que o enviado: continua de onde ele parou. Sem avanço nenhum, a fila
          // tenta de novo mais tarde (a sessão continua valendo).
          const next = nextByte(response)
          if (next <= offset) throw new DriveError('server', response.status)
          offset = next
          onBytes?.(offset)
          continue
        }
        if (response.status === 404 || response.status === 410) {
          // Sessão vencida: a próxima tentativa abre outra.
          onSession?.(null)
          throw new DriveError('server', response.status)
        }
        throw await errorOf(response)
      }
    },
  }
}
