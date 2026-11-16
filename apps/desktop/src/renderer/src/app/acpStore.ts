// Agente do Claude pelo ACP no renderer (contrato 17): o estado da instalação, que o main manda a cada
// mudança (`scribe:acp-state`), e os pedidos de instalar e remover. Instalar só com o clique da pessoa.
import { create } from 'zustand'
import type { AcpAgentStatus } from '@shared/acp'

interface AcpState {
  /** `null` até a primeira leitura. */
  status: AcpAgentStatus | null
  load: () => Promise<void>
  install: () => Promise<void>
  remove: () => Promise<void>
}

let listening = false

export const useAcp = create<AcpState>()((set) => {
  const listen = (): void => {
    if (listening) return
    listening = true
    window.__scribeApi.on('scribe:acp-state', (status) => set({ status }))
  }
  const call = async (channel: 'scribe:acp-status' | 'scribe:acp-install' | 'scribe:acp-remove'): Promise<void> => {
    listen()
    try {
      set({ status: await window.__scribeApi.invoke(channel) })
    } catch {
      // O estado continua o último que o main mandou.
    }
  }
  return {
    status: null,
    load: () => call('scribe:acp-status'),
    install: () => call('scribe:acp-install'),
    remove: () => call('scribe:acp-remove'),
  }
})
