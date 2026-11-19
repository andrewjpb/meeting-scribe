// Contrato 46 (plugin-navegador): o estado da ponte do "Controle do navegador" na tela, no molde do `meetStore`.
// `ativo` é o "Ativar ponte" gravado; `conectado`, a extensão falou com o app há menos de 35 s. Lê ao abrir e
// recebe as mudanças do main por `scribe:navegador-changed`; o interruptor grava por `scribe:navegador-set`.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { NavegadorState } from '@shared/navegador'
import { rereadWhenUnlocked } from '../../app/lockStore'

interface NavegadorStoreState extends NavegadorState {
  /** Gravando o "Ativar ponte": o interruptor espera a resposta. */
  saving: boolean
  load: () => Promise<void>
  receive: (state: NavegadorState) => void
  setAtivo: (ativo: boolean) => Promise<void>
}

export const useNavegador = create<NavegadorStoreState>()((set) => ({
  ativo: false,
  conectado: false,
  saving: false,

  load: async () => {
    try {
      const state = await window.__scribeApi.invoke('scribe:navegador-status')
      set({ ativo: state.ativo, conectado: state.conectado })
    } catch (error) {
      // Bloqueado (contrato 22): lê de novo ao desbloquear.
      rereadWhenUnlocked(error, () => void useNavegador.getState().load())
    }
  },

  receive: (state) => set({ ativo: state.ativo, conectado: state.conectado }),

  setAtivo: async (ativo) => {
    set({ saving: true })
    try {
      const state = await window.__scribeApi.invoke('scribe:navegador-set', { ativo })
      set({ ativo: state.ativo, conectado: state.conectado })
    } catch {
      // Falhou (ou bloqueado): o interruptor fica como estava.
    } finally {
      set({ saving: false })
    }
  },
}))

/** Lê o estado ao abrir e recebe as mudanças do main. */
export function useNavegadorSync(): void {
  useEffect(() => {
    void useNavegador.getState().load()
    return window.__scribeApi.on('scribe:navegador-changed', (state) => useNavegador.getState().receive(state))
  }, [])
}
