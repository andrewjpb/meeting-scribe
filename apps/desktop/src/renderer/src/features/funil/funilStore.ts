// Funil no renderer (contrato 110, D5): uma fonte só para todas as telas do funil. Carrega pelo `scribe:funil-get` e
// troca a view a cada `scribe:funil-changed` (o main manda a view inteira depois de cada gravação). As ações chamam
// um canal cada e devolvem o resultado como veio; o pedido que nem chega ao main vira `falhou` com o texto de sempre.
import { useEffect } from 'react'
import { create } from 'zustand'
import {
  FUNIL_TRANSPORTE_TEXTO,
  type ContatoInput,
  type ContatoOrigem,
  type EmpresaInput,
  type EtapaInput,
  type FunilActionResult,
  type FunilFalha,
  type FunilImportAbrirResult,
  type FunilImportConfirmarResult,
  type FunilTimelineResult,
  type FunilView,
  type OportunidadeInput,
  type Sugestao,
} from '@shared/funil'
import type { CampoImport } from '@shared/funil-import'

/** O pedido não chegou ao main (ou a resposta não voltou): o mesmo formato da falha do main. */
export type FunilFalhaTransporte = FunilFalha

const FALHA: FunilFalhaTransporte = { ok: false, erro: 'falhou', mensagem: FUNIL_TRANSPORTE_TEXTO }

interface FunilStoreState {
  view: FunilView | null
  /** A última carga falhou (texto para a tela); `null` depois de uma carga ou de um evento. */
  error: string | null
  load: () => Promise<void>
  /** Assina `scribe:funil-changed`; devolve o cancelamento. */
  watch: () => () => void
  saveContato: (contato: ContatoInput, origem: ContatoOrigem) => Promise<FunilActionResult>
  archiveContato: (id: string) => Promise<FunilActionResult>
  saveEmpresa: (empresa: EmpresaInput) => Promise<FunilActionResult>
  deleteEmpresa: (id: string) => Promise<FunilActionResult>
  saveOportunidade: (oportunidade: OportunidadeInput) => Promise<FunilActionResult>
  moveOportunidade: (request: { id: string; etapaId: string; ordem: number; motivoPerda?: string | null }) => Promise<FunilActionResult>
  deleteOportunidade: (id: string) => Promise<FunilActionResult>
  archiveOportunidade: (id: string) => Promise<FunilActionResult>
  saveEtapas: (etapas: EtapaInput[]) => Promise<FunilActionResult>
  addNota: (oportunidadeId: string, texto: string) => Promise<FunilActionResult>
  /** Sem o main, lista vazia. */
  sugestoes: () => Promise<Sugestao[]>
  ignorar: (chave: string) => Promise<FunilActionResult>
  importarAbrir: () => Promise<FunilImportAbrirResult>
  importarConfirmar: (request: { token: string; mapeamento?: CampoImport[]; simular?: boolean }) => Promise<FunilImportConfirmarResult>
  timeline: (tipo: 'contato' | 'oportunidade', id: string) => Promise<FunilTimelineResult | FunilFalhaTransporte>
}

/** A chamada ao main; a promessa rejeitada (canal recusado, janela fechando) vira `fallback`. */
async function chamar<T, F>(run: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

export const useFunil = create<FunilStoreState>()((set) => ({
  view: null,
  error: null,

  load: async () => {
    try {
      const result = await window.__scribeApi.invoke('scribe:funil-get')
      // A falha do main vem tipada (`ok: false`); a view não tem `ok`.
      if ('ok' in result) set({ error: result.mensagem })
      else set({ view: result, error: null })
    } catch {
      set({ error: FUNIL_TRANSPORTE_TEXTO })
    }
  },

  watch: () => window.__scribeApi.on('scribe:funil-changed', (view) => set({ view, error: null })),

  saveContato: (contato, origem) => chamar(() => window.__scribeApi.invoke('scribe:funil-contato-save', { contato, origem }), FALHA),
  archiveContato: (id) => chamar(() => window.__scribeApi.invoke('scribe:funil-contato-archive', { id }), FALHA),
  saveEmpresa: (empresa) => chamar(() => window.__scribeApi.invoke('scribe:funil-empresa-save', { empresa }), FALHA),
  deleteEmpresa: (id) => chamar(() => window.__scribeApi.invoke('scribe:funil-empresa-delete', { id }), FALHA),
  saveOportunidade: (oportunidade) => chamar(() => window.__scribeApi.invoke('scribe:funil-oportunidade-save', { oportunidade }), FALHA),
  moveOportunidade: (request) => chamar(() => window.__scribeApi.invoke('scribe:funil-oportunidade-move', request), FALHA),
  deleteOportunidade: (id) => chamar(() => window.__scribeApi.invoke('scribe:funil-oportunidade-delete', { id }), FALHA),
  archiveOportunidade: (id) => chamar(() => window.__scribeApi.invoke('scribe:funil-oportunidade-archive', { id }), FALHA),
  saveEtapas: (etapas) => chamar(() => window.__scribeApi.invoke('scribe:funil-etapas-save', { etapas }), FALHA),
  addNota: (oportunidadeId, texto) => chamar(() => window.__scribeApi.invoke('scribe:funil-evento-add', { oportunidadeId, texto }), FALHA),
  sugestoes: () => chamar(() => window.__scribeApi.invoke('scribe:funil-sugestoes'), []),
  ignorar: (chave) => chamar(() => window.__scribeApi.invoke('scribe:funil-ignorar', { chave }), FALHA),
  importarAbrir: () => chamar(() => window.__scribeApi.invoke('scribe:funil-importar-abrir'), { ok: false, erro: 'falhou' } as const),
  importarConfirmar: (request) => chamar(() => window.__scribeApi.invoke('scribe:funil-importar-confirmar', request), FALHA),
  timeline: (tipo, id) => chamar(() => window.__scribeApi.invoke('scribe:funil-timeline', { tipo, id }), FALHA),
}))

/** A view do funil para uma tela: carrega ao montar e acompanha as gravações enquanto estiver montada. */
export function useFunilView(): FunilView | null {
  const view = useFunil((state) => state.view)
  useEffect(() => {
    const { load, watch } = useFunil.getState()
    const off = watch()
    void load()
    return off
  }, [])
  return view
}
