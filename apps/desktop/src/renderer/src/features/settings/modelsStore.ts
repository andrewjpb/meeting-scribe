// Seletor de modelo no renderer: catálogo vindo do main (que guarda 10 min), modelos que o gateway disse
// não estarem liberados nesta sessão e a conferência em andamento. Escolher só muda `translationModel`
// quando o main confirma que o modelo responde.
import { create } from 'zustand'
import type { CatalogError, CatalogModel, ModelCheck } from '@shared/assemblyai'
import { useSettings } from '../../app/settingsStore'
import { orderModels } from './modelFormat'

type CatalogState = { phase: 'idle' | 'loading' } | { phase: 'ready'; models: CatalogModel[] } | { phase: 'error'; error: CatalogError }

interface ModelsState {
  catalog: CatalogState
  notAllowed: ReadonlySet<string>
  /** Id em conferência. */
  checking: string | null
  /** Última escolha que não deu certo (sem contar "não liberado", que marca a linha). */
  selectFailure: { id: string; check: ModelCheck } | null
  load: () => Promise<void>
  select: (id: string) => Promise<void>
}

export const useModels = create<ModelsState>()((set, get) => ({
  catalog: { phase: 'idle' },
  notAllowed: new Set(),
  checking: null,
  selectFailure: null,

  load: async () => {
    if (get().catalog.phase === 'loading') return
    set({ catalog: { phase: 'loading' } })
    try {
      const result = await window.__scribeApi.invoke('scribe:models-list')
      if (result.ok) set({ catalog: { phase: 'ready', models: orderModels(result.models, useSettings.getState().settings.translationModel) } })
      else set({ catalog: { phase: 'error', error: result.error } })
    } catch {
      set({ catalog: { phase: 'error', error: 'server' } })
    }
  },

  select: async (id) => {
    if (get().checking || get().notAllowed.has(id)) return
    if (id === useSettings.getState().settings.translationModel) return
    set({ checking: id, selectFailure: null })
    try {
      const { check, settings } = await window.__scribeApi.invoke('scribe:model-select', { id })
      useSettings.setState({ settings, loaded: true })
      if (check === 'not-allowed') set({ notAllowed: new Set([...get().notAllowed, id]) })
      else if (check !== 'selected') set({ selectFailure: { id, check } })
    } catch {
      set({ selectFailure: { id, check: 'server' } })
    } finally {
      set({ checking: null })
    }
  },
}))
