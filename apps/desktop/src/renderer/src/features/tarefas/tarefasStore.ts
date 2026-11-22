// Tarefas no renderer (contrato 122, D5): uma fonte só para as telas que mostram tarefas. Carrega pelo
// `scribe:tarefas-get` e troca a view a cada `scribe:tarefas-changed` (o main manda a view inteira depois de cada
// gravação e na virada do dia). As ações chamam um canal cada e devolvem o resultado como veio; o pedido que nem
// chega ao main vira `falhou` com o texto de sempre. Busca e filtros ficam nas telas, sobre a view (R7).
import { useEffect } from 'react'
import { create } from 'zustand'
import {
  TAREFAS_TRANSPORTE_TEXTO,
  type SugestaoTarefa,
  type TarefaInput,
  type TarefaSalvar,
  type TarefasActionResult,
  type TarefasFalha,
  type TarefasResumoResult,
  type TarefaStatus,
  type TarefasView,
} from '@shared/tarefas'

const FALHA: TarefasFalha = { ok: false, erro: 'falhou', mensagem: TAREFAS_TRANSPORTE_TEXTO }

interface TarefasStoreState {
  view: TarefasView | null
  /** A última carga falhou (texto para a tela); `null` depois de uma carga ou de um evento. */
  error: string | null
  load: () => Promise<void>
  /** Assina `scribe:tarefas-changed`; devolve o cancelamento. */
  watch: () => () => void
  criar: (input: TarefaInput) => Promise<TarefasActionResult>
  salvar: (request: TarefaSalvar) => Promise<TarefasActionResult>
  status: (id: string, status: TarefaStatus) => Promise<TarefasActionResult>
  apagar: (id: string) => Promise<TarefasActionResult>
  /** Sem o main, lista vazia. */
  sugestoes: () => Promise<SugestaoTarefa[]>
  ignorar: (chave: string) => Promise<TarefasActionResult>
  adicionarDoResumo: (meetingId: string, indices: number[] | 'minhas') => Promise<TarefasResumoResult>
}

/** A chamada ao main; a promessa rejeitada (canal recusado, janela fechando) vira `fallback`. */
async function chamar<T, F>(run: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

export const useTarefas = create<TarefasStoreState>()((set) => ({
  view: null,
  error: null,

  load: async () => {
    try {
      const result = await window.__scribeApi.invoke('scribe:tarefas-get')
      // A falha do main vem tipada (`ok: false`); a view não tem `ok`.
      if ('ok' in result) set({ error: result.mensagem })
      else set({ view: result, error: null })
    } catch {
      set({ error: TAREFAS_TRANSPORTE_TEXTO })
    }
  },

  watch: () => window.__scribeApi.on('scribe:tarefas-changed', (view) => set({ view, error: null })),

  criar: (input) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-criar', input), FALHA),
  salvar: (request) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-salvar', request), FALHA),
  status: (id, status) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-status', { id, status }), FALHA),
  apagar: (id) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-apagar', { id }), FALHA),
  sugestoes: () => chamar(() => window.__scribeApi.invoke('scribe:tarefas-sugestoes'), []),
  ignorar: (chave) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-ignorar', { chave }), FALHA),
  adicionarDoResumo: (meetingId, indices) => chamar(() => window.__scribeApi.invoke('scribe:tarefas-adicionar-do-resumo', { meetingId, indices }), FALHA),
}))

/** A view das tarefas para uma tela: carrega ao montar e acompanha as gravações enquanto estiver montada. */
export function useTarefasView(): TarefasView | null {
  const view = useTarefas((state) => state.view)
  useEffect(() => {
    const { load, watch } = useTarefas.getState()
    const off = watch()
    void load()
    return off
  }, [])
  return view
}
