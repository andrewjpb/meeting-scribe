// Rede de verdade da atualização. A consulta usa `net.fetch` (sem redirecionamento). O download usa
// `net.request`: o `net.fetch` do Electron 45 não deixa seguir um redirecionamento só depois de conferir o
// destino (`redirect: 'manual'` cancela o pedido e `follow` não informa a URL final), e o asset do GitHub
// sempre redireciona para o armazenamento dele. Nenhum cookie da sessão vai junto.
import { net } from 'electron'
import type { FetchInit, FetchResponse } from '../assemblyai/gateway'
import type { DownloadRequest } from './download'

export function netFetch(url: string, init: FetchInit): Promise<FetchResponse> {
  return net.fetch(url, { ...init, credentials: 'omit' } as RequestInit) as unknown as Promise<FetchResponse>
}

export const netDownload: DownloadRequest = (url, { headers, allowRedirect, signal }) =>
  new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value)
    // Prazo sem dados, tamanho demais ou saída do app: `abort` derruba o pedido e o stream da resposta.
    signal.addEventListener('abort', () => {
      request.abort()
      reject(new Error('download cancelado'))
    })
    request.on('redirect', (_status, _method, redirectUrl) => {
      if (allowRedirect(redirectUrl)) request.followRedirect()
      else {
        request.abort()
        reject(new Error(`redirecionamento recusado: ${redirectUrl}`))
      }
    })
    request.on('response', (response) => {
      // Em tempo de execução é um `Readable` (iterável); o electron.d.ts não declara o iterador.
      resolve({ status: response.statusCode, chunks: response as unknown as AsyncIterable<Uint8Array> })
    })
    request.on('error', reject)
    request.end()
  })

/** Tarball maior que isto não é um pacote do agente (os fixos têm até ~1,6 MB). */
const TARBALL_MAX_BYTES = 50 * 1024 * 1024

/**
 * Download dos pacotes do agente ACP (contrato 17): só `https://registry.npmjs.org/`, sem redirecionamento,
 * sem cookie, até 50 MB e 60 s.
 */
export function netDownloadTarball(url: string, onBytes: (count: number) => void): Promise<Uint8Array> {
  if (!url.startsWith('https://registry.npmjs.org/')) return Promise.reject(new Error('endereço fora do registro do npm'))
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'error', credentials: 'omit', useSessionCookies: false })
    const timer = setTimeout(() => {
      request.abort()
      reject(new Error('o registro do npm não respondeu'))
    }, 60_000)
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timer)
        request.abort()
        reject(new Error(`o registro respondeu ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > TARBALL_MAX_BYTES) {
          clearTimeout(timer)
          request.abort()
          reject(new Error('arquivo grande demais'))
          return
        }
        chunks.push(chunk)
        onBytes(chunk.length)
      })
      response.on('end', () => {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks))
      })
      response.on('error', (error: Error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end()
  })
}
