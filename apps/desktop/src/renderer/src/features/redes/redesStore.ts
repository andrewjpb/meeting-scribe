// Redes no renderer (contrato 69): as contas do Instagram e o armazenamento de mídia, como o main manda (`RedesState`).
// O token colado e a chave secreta digitada só passam por aqui a caminho do main, no pedido; nunca ficam no estado.
import { create } from 'zustand'
import type { MediaHostConfig, MediaHostSaveResult, MediaHostStatus, RedesConnectResult, RedesState } from '@shared/redes'

const FAILED = 'Não foi possível falar com o app. Tente de novo.'

interface RedesStoreState {
  state: RedesState | null
  loadFailed: boolean
  /** O que está em andamento (um por vez na tela): conectar, renovar ou remover uma conta, salvar ou testar o armazenamento. */
  busy: { kind: 'connect' } | { kind: 'refresh' | 'remove'; accountId: string } | { kind: 'media-save' | 'media-test' | 'media-clear' } | null
  load: () => Promise<void>
  connect: (token: string) => Promise<RedesConnectResult>
  refresh: (accountId: string) => Promise<RedesConnectResult>
  remove: (accountId: string) => Promise<boolean>
  /** Recusado com a razão (`ok: false`), ou `null` se o pedido nem chegou ao main. */
  saveMediaHost: (config: MediaHostConfig, secretAccessKey: string | null) => Promise<MediaHostSaveResult | null>
  testMediaHost: () => Promise<MediaHostStatus | null>
  clearMediaHost: () => Promise<MediaHostStatus | null>
}

export const useRedes = create<RedesStoreState>()((set, get) => {
  const withMediaHost = (mediaHost: MediaHostStatus): void => {
    const current = get().state
    if (current) set({ state: { ...current, mediaHost } })
  }
  const mediaCall = async (kind: 'media-test' | 'media-clear', call: () => Promise<MediaHostStatus>): Promise<MediaHostStatus | null> => {
    if (get().busy) return null
    set({ busy: { kind } })
    try {
      const status = await call()
      withMediaHost(status)
      return status
    } catch {
      return null
    } finally {
      set({ busy: null })
    }
  }

  return {
    state: null,
    loadFailed: false,
    busy: null,

    load: async () => {
      try {
        set({ state: await window.__scribeApi.invoke('scribe:redes-state'), loadFailed: false })
      } catch {
        set({ loadFailed: true })
      }
    },

    connect: async (token) => {
      if (get().busy) return { ok: false, error: FAILED }
      set({ busy: { kind: 'connect' } })
      try {
        return await window.__scribeApi.invoke('scribe:redes-connect', { token })
      } catch {
        return { ok: false, error: FAILED }
      } finally {
        set({ busy: null })
      }
    },

    refresh: async (accountId) => {
      if (get().busy) return { ok: false, error: FAILED }
      set({ busy: { kind: 'refresh', accountId } })
      try {
        return await window.__scribeApi.invoke('scribe:redes-refresh', { accountId })
      } catch {
        return { ok: false, error: FAILED }
      } finally {
        set({ busy: null })
      }
    },

    remove: async (accountId) => {
      if (get().busy) return false
      set({ busy: { kind: 'remove', accountId } })
      try {
        return (await window.__scribeApi.invoke('scribe:redes-remove', { accountId })).ok
      } catch {
        return false
      } finally {
        set({ busy: null })
      }
    },

    saveMediaHost: async (config, secretAccessKey) => {
      if (get().busy) return null
      set({ busy: { kind: 'media-save' } })
      try {
        const result = await window.__scribeApi.invoke('scribe:redes-media-host-save', { config, secretAccessKey })
        withMediaHost(result.status)
        return result
      } catch {
        return { ok: false, error: FAILED, status: get().state?.mediaHost ?? { configured: false, config: null, secretSet: false, lastTest: null } }
      } finally {
        set({ busy: null })
      }
    },
    testMediaHost: () => mediaCall('media-test', () => window.__scribeApi.invoke('scribe:redes-media-host-test')),
    clearMediaHost: () => mediaCall('media-clear', () => window.__scribeApi.invoke('scribe:redes-media-host-clear')),
  }
})

/** O main avisa cada mudança (conta entrou, renovou, venceu, saiu; armazenamento salvo ou testado), de qualquer janela. */
export function watchRedes(): () => void {
  return window.__scribeApi.on('scribe:redes-state', (state) => useRedes.setState({ state, loadFailed: false }))
}
