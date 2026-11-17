// Agendas no renderer (contrato 12): só o que a tela mostra ("Próximas" e a faixa "não está sendo gravada"). O link
// da chamada fica no main; "Entrar na chamada" e "Gravar" mandam só a chave do evento.
import { useEffect } from 'react'
import { create } from 'zustand'
import { EMPTY_CALENDAR_VIEW, type CalendarView } from '@shared/calendar'
import { rereadWhenUnlocked } from '../../app/lockStore'

interface CalendarState {
  view: CalendarView
  load: () => Promise<void>
  dismiss: (key: string) => Promise<void>
  join: (key: string) => Promise<void>
}

export const useCalendar = create<CalendarState>()((set) => ({
  view: EMPTY_CALENDAR_VIEW,

  load: async () => {
    try {
      set({ view: await window.__scribeApi.invoke('scribe:calendar-get') })
    } catch (error) {
      // Bloqueado (contrato 22): o main manda o estado de novo ao desbloquear.
      rereadWhenUnlocked(error, () => void useCalendar.getState().load())
    }
  },

  dismiss: async (key) => {
    // A faixa some na hora; a resposta do main confirma.
    set((state) => ({ view: state.view.banner?.key === key ? { ...state.view, banner: null } : state.view }))
    try {
      set({ view: await window.__scribeApi.invoke('scribe:calendar-dismiss', { key }) })
    } catch {
      // Nada a fazer: o próximo estado do main vale.
    }
  },

  join: async (key) => {
    try {
      await window.__scribeApi.invoke('scribe:calendar-join', { key })
    } catch {
      // Nada a fazer.
    }
  },
}))

/** Lê o estado ao abrir e recebe as mudanças do main. */
export function useCalendarSync(): void {
  useEffect(() => {
    void useCalendar.getState().load()
    return window.__scribeApi.on('scribe:calendar-state', (view) => useCalendar.setState({ view }))
  }, [])
}
