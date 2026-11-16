// Rede de verdade das contas: `net.fetch` do Electron no main, sem cookie da sessão e sem seguir
// redirecionamento (o token nunca vai para outro lugar). O upload em partes do Drive responde 308 sem
// `Location`, que o Chromium entrega como resposta comum.
import { net } from 'electron'
import type { HttpFetch } from './http'

export const netHttp: HttpFetch = async (url, init) => {
  const response = await net.fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
    redirect: 'error',
    credentials: 'omit',
  } as RequestInit)
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    text: () => response.text(),
    bytes: async () => new Uint8Array(await response.arrayBuffer()),
  }
}
