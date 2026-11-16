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
