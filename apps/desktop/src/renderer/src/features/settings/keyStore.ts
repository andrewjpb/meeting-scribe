// Estado da chave da AssemblyAI no renderer: só `KeyStatus` (se há chave, os quatro últimos caracteres e
// a origem) e o resultado da última conferência nesta sessão. A chave digitada vai ao main em
// `scribe:key-save` e não fica guardada aqui.
import { create } from 'zustand'
import type { KeyCheck, KeyStatus } from '@shared/assemblyai'

interface KeyState {
  status: KeyStatus | null
  /** Última conferência desta sessão (`null`: ainda não conferida). */
  check: KeyCheck | null
  busy: 'saving' | 'verifying' | 'removing' | null
  /** Ler o estado falhou. */
  loadFailed: boolean
  /** O main não conseguiu guardar (escrita ou cifragem falhou): nada foi salvo. */
  saveFailed: boolean
  /** Lê o estado e, se há chave e ela ainda não foi conferida nesta sessão, confere (sem custo de tokens). */
  load: () => Promise<void>
  /** Devolve o resultado da conferência, ou `null` se o main não conseguiu guardar. */
  save: (key: string) => Promise<KeyCheck | null>
  verify: () => Promise<void>
  remove: () => Promise<void>
}

export const useApiKey = create<KeyState>()((set, get) => ({
  status: null,
  check: null,
  busy: null,
  loadFailed: false,
  saveFailed: false,

  load: async () => {
    try {
      const status = await window.__scribeApi.invoke('scribe:key-status')
      set({ status, loadFailed: false })
      if (status.configured && get().check === null && get().busy === null) await get().verify()
    } catch {
      set({ loadFailed: true })
    }
  },

  save: async (key) => {
    if (get().busy) return null
    set({ busy: 'saving', saveFailed: false })
    try {
      const { check, status } = await window.__scribeApi.invoke('scribe:key-save', { key })
      set({ status, check, busy: null })
      return check
    } catch {
      // A conferência anterior continua valendo; a tela diz que não guardou.
      set({ busy: null, saveFailed: true })
      return null
    }
  },

  verify: async () => {
    if (get().busy) return
    set({ busy: 'verifying' })
    try {
      const { check, status } = await window.__scribeApi.invoke('scribe:key-verify')
      set({ status, check: check === 'invalid' ? null : check, busy: null })
    } catch {
      set({ busy: null, check: 'unverified' })
    }
  },

  remove: async () => {
    if (get().busy) return
    set({ busy: 'removing' })
    try {
      const status = await window.__scribeApi.invoke('scribe:key-remove')
      set({ status, check: null, busy: null, saveFailed: false })
    } catch {
      set({ busy: null })
    }
  },
}))
