// Início no renderer (contrato 135, D11): a view que o main monta (agenda do dia e pendências, contrato 134). Carrega pelo
// `scribe:inicio-get`, troca a view a cada `scribe:inicio-changed` (o main manda a view inteira) e relê quando a janela
// volta ao foco. Com o app bloqueado o pedido é recusado: relê no desbloqueio, sem mostrar erro (como as Agendas).
// Tarefas, última reunião, automações e gravação vêm dos stores que já existem (D9).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { InicioView } from '@shared/inicio'
import { rereadWhenUnlocked } from '../../app/lockStore'

interface InicioStoreState {
  view: InicioView | null
  load: () => Promise<void>
  /** Assina `scribe:inicio-changed`; devolve o cancelamento. */
  watch: () => () => void
}

/** A releitura marcada para o desbloqueio (uma só, mesmo com várias recusas seguidas). */
let reread: (() => void) | null = null

export const useInicio = create<InicioStoreState>()((set) => ({
  view: null,

  load: async () => {
    try {
      set({ view: await window.__scribeApi.invoke('scribe:inicio-get') })
    } catch (error) {
      // Bloqueado (contrato 22): o desbloqueio relê. Outro erro: fica a última view (a próxima mudança chega por evento).
      reread ??= rereadWhenUnlocked(error, () => {
        reread = null
        void useInicio.getState().load()
      })
    }
  },

  watch: () => window.__scribeApi.on('scribe:inicio-changed', (view) => set({ view })),
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
