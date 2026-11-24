// Triagem do WhatsApp no renderer (contrato 162): as etiquetas por conversa e o estado do motor, como o main devolveu.
// A etiqueta manual grava pelo `scribe:triagem-set` e a resposta substitui a daqui; o agente etiqueta pelo main e o
// aviso `scribe:triagem-changed` chega aqui. Nada daqui envia mensagem.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { InvokeChannels, MainEvents } from '@shared/ipc'
import type { Etiqueta, EtiquetaPatch, TriagemStatus } from '@shared/triagem'
import { rereadWhenUnlocked } from '../../app/lockStore'

export type TriagemRunResult = InvokeChannels['scribe:triagem-run']['response']
export type TriagemRunError = Extract<TriagemRunResult, { ok: false }>['error']
export type TriagemCreateResult = InvokeChannels['scribe:triagem-create-from-template']['response']

/** A frase de cada recusa do "Triar agora". */
export const TRIAGEM_RUN_ERRORS: Readonly<Record<TriagemRunError, string>> = {
  'sem-agente': 'Nenhum agente de triagem ativo.',
  desligado: 'A triagem está desligada em Configurações.',
  pausado: 'O agente de triagem está pausado.',
  'sem-mensagens': 'Nada para triar nesta conversa.',
  teto: 'Teto diário de triagens atingido.',
  ocupado: 'Já há uma triagem desta conversa em andamento.',
}

interface TriagemStoreState {
  etiquetas: Record<string, Etiqueta>
  /** `null` enquanto não leu. */
  status: TriagemStatus | null
  load: () => Promise<void>
  /** Grava a escolha do dono; a etiqueta devolvida substitui a daqui. */
  set: (chatId: string, patch: EtiquetaPatch) => Promise<{ ok: true } | { ok: false; error: string }>
  runNow: (chatId: string) => Promise<TriagemRunResult>
  createFromTemplate: () => Promise<TriagemCreateResult>
  /** O aviso do main: a etiqueta nova da conversa (`null` tira). */
  receive: (event: MainEvents['scribe:triagem-changed']) => void
}

let reread: (() => void) | null = null

export const useTriagem = create<TriagemStoreState>()((set) => ({
  etiquetas: {},
  status: null,

  load: async () => {
    try {
      const { etiquetas, status } = await window.__scribeApi.invoke('scribe:triagem-list')
      set({ etiquetas, status })
    } catch (error) {
      // Recusado com o app bloqueado: relê no desbloqueio.
      reread ??= rereadWhenUnlocked(error, () => {
        reread = null
        void useTriagem.getState().load()
      })
    }
  },

  set: async (chatId, patch) => {
    try {
      const result = await window.__scribeApi.invoke('scribe:triagem-set', { chatId, patch })
      if (!result.ok) return { ok: false, error: result.error }
      set((state) => ({ etiquetas: { ...state.etiquetas, [chatId]: result.etiqueta } }))
      return { ok: true }
    } catch {
      return { ok: false, error: 'failed' }
    }
  },

  runNow: async (chatId) => window.__scribeApi.invoke('scribe:triagem-run', { chatId }),

  createFromTemplate: async () => {
    const result = await window.__scribeApi.invoke('scribe:triagem-create-from-template')
    // O status muda com o agente novo (o aviso também chega; reler cobre a ordem).
    if (result.ok) void useTriagem.getState().load()
    return result
  },

  receive: ({ chatId, etiqueta }) =>
    set((state) => ({ etiquetas: etiqueta ? { ...state.etiquetas, [chatId]: etiqueta } : Object.fromEntries(Object.entries(state.etiquetas).filter(([id]) => id !== chatId)) })),
}))

/** Os avisos do main: a etiqueta de uma conversa e o estado do motor. */
export function watchTriagem(): () => void {
  const offChanged = window.__scribeApi.on('scribe:triagem-changed', (event) => useTriagem.getState().receive(event))
  const offStatus = window.__scribeApi.on('scribe:triagem-status-changed', (status) => useTriagem.setState({ status }))
  return () => {
    offChanged()
    offStatus()
  }
}

/** As etiquetas lidas ao montar (atrás do bloqueio) e acompanhadas pelos avisos do main. */
export function useTriagemSync(): void {
  useEffect(() => {
    void useTriagem.getState().load()
    return watchTriagem()
  }, [])
}
