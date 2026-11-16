// Download do `.dmg` do release (contrato 14, CA3): só do repositório (e do redirecionamento para o
// armazenamento de assets do GitHub), para `~/Downloads/<nome>.part`, com o SHA-256 calculado no caminho.
// Confere contra o `.sha256` do release; diferente, apaga. Igual, renomeia para o nome final. Conexão
// parada por 60 s, arquivo maior que o declarado (ou que 1 GB) e saída do app cancelam o pedido e apagam o `.part`.
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isAllowedRedirect, isReleaseDownloadUrl, userAgent, type UpdateRelease } from './release'

export interface DownloadResponse {
  status: number
  /** Pedaços do corpo, na ordem. */
  chunks: AsyncIterable<Uint8Array>
}

/**
 * Pedido de download. Cada redirecionamento passa por `allowRedirect` antes de ser seguido; recusado, o
 * pedido é cancelado e a promessa rejeita. `signal` abortado cancela o pedido (`abort` no `net.request`).
 * No app é o `net.request` do Electron; nos testes e no smoke, um falso.
 */
export type DownloadRequest = (
  url: string,
  options: { headers: Record<string, string>; allowRedirect: (url: string) => boolean; signal: AbortSignal },
) => Promise<DownloadResponse>

export type DownloadOutcome = { ok: true; path: string } | { ok: false; reason: 'hash' | 'network' | 'file' | 'size' | 'cancelled'; detail: string }

/** Sem receber nenhum dado por este tempo, o download é cancelado. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
/** Teto quando a API não informa o tamanho do asset. */
export const DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024

export interface DownloadOptions {
  request: DownloadRequest
  release: UpdateRelease
  currentVersion: string
  downloadsDir: string
  /** 0 a 100, só quando muda o inteiro. */
  onProgress?: (percent: number) => void
  /** Saída do app: cancela e apaga o `.part`. */
  signal?: AbortSignal
  idleTimeoutMs?: number
  /** Teto sem tamanho declarado; só os testes trocam. */
  maxBytes?: number
}

/** Primeiro campo de 64 dígitos hexadecimais do arquivo (`shasum -a 256` escreve `<hash>  <nome>`). */
export function parseSha256File(text: string): string | null {
  const match = /^\s*([0-9a-fA-F]{64})(?:\s|$)/.exec(text)
  return match?.[1] ? match[1].toLowerCase() : null
}

class DownloadAbort extends Error {
  constructor(
    readonly reason: 'network' | 'size' | 'cancelled',
    message: string,
  ) {
    super(message)
  }
}

/**
 * Um pedido com prazo de inatividade: o relógio recomeça a cada pedaço recebido. Estourado, ou com o
 * `signal` de fora abortado, o pedido é cancelado e a leitura rejeita na hora, mesmo com o stream parado.
 */
async function* readWithDeadline(
  request: DownloadRequest,
  url: string,
  currentVersion: string,
  outer: AbortSignal | undefined,
  idleTimeoutMs: number,
): AsyncGenerator<Uint8Array> {
  if (!isReleaseDownloadUrl(url)) throw new Error(`endereço fora do repositório: ${url}`)
  if (outer?.aborted) throw new DownloadAbort('cancelled', 'download cancelado')
  const controller = new AbortController()
  let failure: DownloadAbort | null = null
  let rejectWait: ((error: Error) => void) | null = null
  const fail = (error: DownloadAbort): void => {
    if (failure) return
    failure = error
    controller.abort()
    rejectWait?.(error)
  }
  let timer: NodeJS.Timeout | null = null
  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fail(new DownloadAbort('network', `nenhum dado em ${idleTimeoutMs / 1000} s`)), idleTimeoutMs)
  }
  const onOuterAbort = (): void => fail(new DownloadAbort('cancelled', 'download cancelado'))
  outer?.addEventListener('abort', onOuterAbort)
  // Espera a próxima promessa ou a falha, o que vier antes.
  const race = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (failure) return reject(failure)
      rejectWait = reject
      promise.then(resolve, reject)
    })

  arm()
  let iterator: AsyncIterator<Uint8Array> | null = null
  let done = false
  try {
    const response = await race(request(url, { headers: { 'user-agent': userAgent(currentVersion) }, allowRedirect: isAllowedRedirect, signal: controller.signal }))
    if (response.status !== 200) throw new Error(`GitHub respondeu ${response.status}`)
    iterator = response.chunks[Symbol.asyncIterator]()
    for (;;) {
      arm()
      const next = await race(iterator.next())
      if (next.done) {
        done = true
        return
      }
      yield next.value
    }
  } finally {
    if (timer) clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
    // Saída antes do fim (prazo, saída do app ou quem lê desistiu): cancela o pedido e solta o stream.
    if (!done) {
      controller.abort()
      void iterator?.return?.()?.catch(() => undefined)
    }
  }
}

const SHA_FILE_MAX = 4096

async function readSha256(request: DownloadRequest, url: string, currentVersion: string, signal: AbortSignal | undefined, idleTimeoutMs: number): Promise<string> {
  let text = ''
  for await (const chunk of readWithDeadline(request, url, currentVersion, signal, idleTimeoutMs)) {
    text += Buffer.from(chunk).toString('utf8')
    if (text.length > SHA_FILE_MAX) throw new Error('.sha256 grande demais')
  }
  const hash = parseSha256File(text)
  if (!hash) throw new Error('.sha256 sem hash')
  return hash
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function downloadRelease({
  request,
  release,
  currentVersion,
  downloadsDir,
  onProgress,
  signal,
  idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
  maxBytes = DOWNLOAD_MAX_BYTES,
}: DownloadOptions): Promise<DownloadOutcome> {
  let expected: string
  try {
    expected = await readSha256(request, release.sha256Url, currentVersion, signal, idleTimeoutMs)
  } catch (error) {
    return { ok: false, reason: error instanceof DownloadAbort ? error.reason : 'network', detail: `.sha256: ${message(error)}` }
  }

  const finalPath = join(downloadsDir, release.dmg.name)
  const partPath = `${finalPath}.part`
  const hash = createHash('sha256')
  const total = release.dmg.size
  const limit = total && total > 0 ? total : maxBytes
  let file: Awaited<ReturnType<typeof open>> | null = null
  let stage: 'network' | 'file' = 'network'
  const body = readWithDeadline(request, release.dmg.url, currentVersion, signal, idleTimeoutMs)
  try {
    stage = 'file'
    await mkdir(downloadsDir, { recursive: true })
    file = await open(partPath, 'w', 0o644)
    stage = 'network'
    let received = 0
    let lastPercent = -1
    onProgress?.(0)
    for await (const chunk of body) {
      received += chunk.byteLength
      if (received > limit) throw new DownloadAbort('size', `mais de ${limit} bytes`)
      stage = 'file'
      await file.write(chunk)
      stage = 'network'
      hash.update(chunk)
      if (total && total > 0) {
        const percent = Math.min(100, Math.floor((received / total) * 100))
        if (percent !== lastPercent) {
          lastPercent = percent
          onProgress?.(percent)
        }
      }
    }
    stage = 'file'
    await file.close()
    file = null
  } catch (error) {
    // Sair do laço com `throw` encerra o gerador, que cancela o pedido.
    await body.return(undefined).catch(() => undefined)
    await file?.close().catch(() => undefined)
    await rm(partPath, { force: true }).catch(() => undefined)
    return { ok: false, reason: error instanceof DownloadAbort ? error.reason : stage, detail: message(error) }
  }

  const actual = hash.digest('hex')
  if (actual !== expected) {
    await rm(partPath, { force: true }).catch(() => undefined)
    return { ok: false, reason: 'hash', detail: `esperado ${expected}, veio ${actual}` }
  }
  if (signal?.aborted) {
    await rm(partPath, { force: true }).catch(() => undefined)
    return { ok: false, reason: 'cancelled', detail: 'download cancelado' }
  }
  try {
    await rename(partPath, finalPath)
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined)
    return { ok: false, reason: 'file', detail: message(error) }
  }
  onProgress?.(100)
  return { ok: true, path: finalPath }
}
