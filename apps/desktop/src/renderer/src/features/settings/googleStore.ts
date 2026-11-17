// Conta Google no renderer (contrato 11): só `GoogleAccountStatus` (cadastro sim ou não, ID mascarado, estado e
// perfil). O ID e a chave secreta digitados vão ao main em `scribe:google-client-save` e não ficam aqui.
import { create } from 'zustand'
import type { GoogleAccountStatus, GoogleClientSaveError } from '@shared/accounts'

interface GoogleState {
  status: GoogleAccountStatus | null
  busy: 'saving' | 'signing-out' | null
  /** Ler o estado falhou. */
  loadFailed: boolean
  load: () => Promise<void>
  /** `null` quando guardou. */
  saveClient: (clientId: string, clientSecret: string) => Promise<GoogleClientSaveError | null>
  signIn: () => Promise<void>
  /** Contrato 12 (CA2): "Permitir acesso à agenda". */
  grantCalendar: () => Promise<void>
  cancel: () => Promise<void>
  signOut: () => Promise<void>
}

export const useGoogle = create<GoogleState>()((set, get) => ({
  status: null,
  busy: null,
  loadFailed: false,

  load: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:google-status'), loadFailed: false })
    } catch {
      set({ loadFailed: true })
    }
  },

  saveClient: async (clientId, clientSecret) => {
    if (get().busy) return 'failed'
    set({ busy: 'saving' })
    try {
      const result = await window.__scribeApi.invoke('scribe:google-client-save', { clientId, clientSecret })
      set({ status: result.status, busy: null })
      return result.ok ? null : result.error
    } catch {
      set({ busy: null })
      return 'failed'
    }
  },

  signIn: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:google-sign-in') })
    } catch {
      // O estado chega por `scribe:google-state`.
    }
  },

  grantCalendar: async () => {
    try {
      set({ status: await window.__scribeApi.invoke('scribe:google-calendar-grant') })
    } catch {
      // O estado chega por `scribe:google-state`.
    }
  },

  cancel: async () => {
    try {
      await window.__scribeApi.invoke('scribe:google-sign-in-cancel')
    } catch {
      // Nada a fazer.
    }
  },

  signOut: async () => {
    if (get().busy) return
    set({ busy: 'signing-out' })
    try {
      set({ status: await window.__scribeApi.invoke('scribe:google-sign-out'), busy: null })
    } catch {
      set({ busy: null })
    }
  },
}))

/** O main avisa cada mudança (entrando, entrou, expirou, saiu), inclusive vinda de outra janela. */
export function watchGoogleState(): () => void {
  return window.__scribeApi.on('scribe:google-state', (status) => useGoogle.setState({ status }))
}
