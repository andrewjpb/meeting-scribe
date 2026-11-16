// Ponte entre renderer e main. Roda com sandbox: só `electron` e o código empacotado aqui.
// Expõe apenas `window.__scribeApi`, e só para os canais declarados em `shared/ipc.ts`.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  INVOKE_CHANNELS,
  MAIN_EVENT_CHANNELS,
  RENDERER_EVENT_CHANNELS,
  type CspViolation,
  type ScribeApi,
} from '../shared/ipc'

function assertChannel(allowed: readonly string[], channel: string): void {
  if (!allowed.includes(channel)) throw new Error(`Canal não permitido: ${channel}`)
}

const api: ScribeApi = {
  invoke(channel, ...args) {
    assertChannel(INVOKE_CHANNELS, channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel, payload) {
    assertChannel(RENDERER_EVENT_CHANNELS, channel)
    ipcRenderer.send(channel, payload)
  },
  on(channel, listener) {
    assertChannel(MAIN_EVENT_CHANNELS, channel)
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('__scribeApi', api)

// Violação de CSP vai para o main, que registra (e o smoke reprova).
document.addEventListener('securitypolicyviolation', (event) => {
  const report: CspViolation = {
    directive: event.effectiveDirective,
    blockedUri: event.blockedURI,
    sourceFile: event.sourceFile,
  }
  ipcRenderer.send('scribe:csp-violation', report)
})
