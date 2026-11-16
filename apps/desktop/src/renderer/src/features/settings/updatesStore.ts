// Atualização no renderer (contrato 14): cópia do estado que o main mantém (versão atual, última
// verificação, versão nova e o download). Toda ação vai ao main; a cópia daqui só muda pelo retorno dele
// e por `scribe:update-state`.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { UpdateState } from '@shared/updates'

/** `aria-label` do bloco em Configurações e o `state.section` com que o aviso da barra lateral navega até ele. */
export const UPDATES_SECTION = 'Atualizações'

interface UpdatesStore {
  state: UpdateState
  check: () => Promise<void>
  download: () => Promise<void>
  quit: () => Promise<void>
}

const INITIAL: UpdateState = { currentVersion: '', checking: false, lastCheckedAt: null, available: null, download: { phase: 'idle' } }

export const useUpdates = create<UpdatesStore>()((set) => ({
  state: INITIAL,
  check: async () => {
    try {
      set({ state: await window.__scribeApi.invoke('scribe:update-check') })
    } catch {
      // Falha na consulta é silenciosa (CA1).
    }
  },
  download: async () => {
    try {
      set({ state: await window.__scribeApi.invoke('scribe:update-download') })
    } catch {
      // O estado de falha chega por `scribe:update-state`.
    }
  },
  quit: async () => {
    try {
      await window.__scribeApi.invoke('scribe:update-quit')
    } catch {
      // Nada a fazer: o app continua aberto.
    }
  },
}))

/** Lê o estado ao abrir e acompanha as mudanças do main. */
export function useUpdatesSync(): void {
  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:update-get').then(
      (state) => {
        if (alive) useUpdates.setState({ state })
      },
      () => undefined,
    )
    const off = window.__scribeApi.on('scribe:update-state', (state) => useUpdates.setState({ state }))
    return () => {
      alive = false
      off()
    }
  }, [])
}
