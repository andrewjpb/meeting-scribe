// Conta Microsoft no renderer (contrato 12): só `MicrosoftAccountStatus` (cadastro sim ou não, ID mascarado, estado,
// perfil e a agenda). O ID do aplicativo digitado vai ao main em `scribe:microsoft-client-save` e não fica aqui.
import { create } from 'zustand'
import type { MicrosoftAccountStatus, MicrosoftClientSaveError } from '@shared/accounts'

interface MicrosoftState {
  status: MicrosoftAccountStatus | null
  busy: 'saving' | 'signing-out' | null
  loadFailed: boolean
  load: () => Promise<void>
  /** `null` quando guardou. */
  saveClient: (clientId: string) => Promise<MicrosoftClientSaveError | null>
  signIn: () => Promise<void>
  cancel: () => Promise<void>
  signOut: () => Promise<void>
}

export const useMicrosoft = create<MicrosoftState>()((set, get) => ({
  status: null,
  busy: null,
  loadFailed: false,

  load: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:microsoft-status'), loadFailed: false })
    } catch {
      set({ loadFailed: true })
    }
  },

  saveClient: async (clientId) => {
    if (get().busy) return 'failed'
    set({ busy: 'saving' })
    try {
      const result = await window.__scribeApi.invoke('scribe:microsoft-client-save', { clientId })
      set({ status: result.status, busy: null })
      return result.ok ? null : result.error
    } catch {
      set({ busy: null })
      return 'failed'
    }
  },

  signIn: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:microsoft-sign-in') })
    } catch {
      // O estado chega por `scribe:microsoft-state`.
    }
  },

  cancel: async () => {
    try {
      await window.__scribeApi.invoke('scribe:microsoft-sign-in-cancel')
    } catch {
      // Nada a fazer.
    }
  },

  signOut: async () => {
    if (get().busy) return
    set({ busy: 'signing-out' })
    try {
      set({ status: await window.__scribeApi.invoke('scribe:microsoft-sign-out'), busy: null })
    } catch {
      set({ busy: null })
    }
  },
}))

/** O main avisa cada mudança (entrando, entrou, expirou, saiu), inclusive vinda de outra janela. */
export function watchMicrosoftState(): () => void {
  return window.__scribeApi.on('scribe:microsoft-state', (status) => useMicrosoft.setState({ status }))
}
