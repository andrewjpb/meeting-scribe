// Início no renderer (contrato 135, D11): a view que o main monta (agenda do dia e pendências, contrato 134). Carrega pelo
// `scribe:inicio-get`, troca a view a cada `scribe:inicio-changed` (o main manda a view inteira) e relê quando a janela
// volta ao foco. Com o app bloqueado o pedido é recusado: relê no desbloqueio, sem mostrar erro (como as Agendas).
// Tarefas, última reunião, automações e gravação vêm dos stores que já existem (D9). Contrato 146: o "Atualizar" do topo
// pede `scribe:inicio-atualizar` (uma leitura por vez) e guarda o `falhou` até a próxima view bem-sucedida.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { InicioView } from '@shared/inicio'
import { rereadWhenUnlocked } from '../../app/lockStore'

interface InicioStoreState {
  view: InicioView | null
  /** Contrato 146 (CA5): o "Atualizar" está relendo as fontes (o botão fica desabilitado). */
  atualizando: boolean
  /** Contrato 146 (CA6): alguma fonte não foi relida no último "Atualizar"; a próxima view bem-sucedida limpa. */
  falhou: boolean
  load: () => Promise<void>
  /** "Conceder" da linha do Calendário do Mac (contrato 136): pede o acesso e fica com a view relida. */
  macAcesso: () => Promise<void>
  /** Contrato 146 (CA1): relê as fontes na origem e troca a view; com uma leitura em curso, não pede outra. */
  atualizar: () => Promise<void>
  /** Assina `scribe:inicio-changed`; devolve o cancelamento. */
  watch: () => () => void
}

/** A releitura marcada para o desbloqueio (uma só, mesmo com várias recusas seguidas). */
let reread: (() => void) | null = null

/** Quando o último "Atualizar" falhou (ms) e por quanto tempo um aviso do main ainda é eco dele. */
let falhouEm = 0
const FALHA_ECO_MS = 5_000

export const useInicio = create<InicioStoreState>()((set, get) => ({
  view: null,
  atualizando: false,
  falhou: false,

  load: async () => {
    try {
      set({ view: await window.__scribeApi.invoke('scribe:inicio-get'), falhou: false })
    } catch (error) {
      // Bloqueado (contrato 22): o desbloqueio relê. Outro erro: fica a última view (a próxima mudança chega por evento).
      reread ??= rereadWhenUnlocked(error, () => {
        reread = null
        void useInicio.getState().load()
      })
    }
  },

  macAcesso: async () => {
    try {
      set({ view: await window.__scribeApi.invoke('scribe:inicio-mac-acesso'), falhou: false })
    } catch {
      // Bloqueado no meio do pedido: a tela não está à mostra; o desbloqueio relê pelo `load`.
    }
  },

  atualizar: async () => {
    if (get().atualizando) return
    set({ atualizando: true })
    try {
      const { view, falhou } = await window.__scribeApi.invoke('scribe:inicio-atualizar')
      if (falhou) falhouEm = Date.now()
      set({ view, falhou, atualizando: false })
    } catch {
      // Recusado (app bloqueado) ou erro no main: fica a view de antes, com o aviso de que não deu para atualizar.
      falhouEm = Date.now()
      set({ atualizando: false, falhou: true })
    }
  },

  watch: () =>
    window.__scribeApi.on('scribe:inicio-changed', (view) => {
      // As fontes que deram certo no mesmo "Atualizar" avisam logo depois (agenda, pastas de outra conta): essa view é
      // eco da leitura que falhou, não uma leitura nova, e não apaga o aviso antes de a pessoa ler.
      const desde = Date.parse(view.atualizadoEm) - falhouEm
      const eco = get().falhou && desde >= 0 && desde < FALHA_ECO_MS
      set({ view, falhou: eco })
    }),
}))

/** A view do Início para a tela: carrega ao montar, acompanha o main e relê no foco da janela enquanto estiver montada. */
export function useInicioView(): InicioView | null {
  const view = useInicio((state) => state.view)
  useEffect(() => {
    const { load, watch } = useInicio.getState()
    const off = watch()
    void load()
    const onFocus = (): void => void useInicio.getState().load()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return view
}
