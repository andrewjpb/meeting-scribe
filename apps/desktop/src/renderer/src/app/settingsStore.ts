// Configurações no renderer: cópia do que o main gravou. Toda mudança vai ao main, que valida, grava e
// avisa todas as janelas (`scribe:settings-changed`); a cópia daqui só muda por esse retorno.
import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings-defaults'

interface SettingsState {
  settings: AppSettings
  /** Já leu do main (antes disso valem os padrões). */
  loaded: boolean
  /** Grava no main; devolve falso se o main recusou ou não respondeu. */
  update: (patch: SettingsPatch) => Promise<boolean>
}

export const useSettings = create<SettingsState>()((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  update: async (patch) => {
    try {
      const settings = await window.__scribeApi.invoke('scribe:settings-update', patch)
      set({ settings, loaded: true })
      return true
    } catch {
      return false
    }
  },
}))

/** Lê do main antes do primeiro quadro (tema certo de saída). Falhou: seguem os padrões. */
export async function loadSettings(): Promise<void> {
  try {
    const settings = await window.__scribeApi.invoke('scribe:settings-get')
    useSettings.setState({ settings, loaded: true })
  } catch {
    // Os padrões continuam valendo; a próxima mudança gravada atualiza.
  }
}

/** Recebe as mudanças gravadas por qualquer janela. */
export function useSettingsSync(): void {
  useEffect(() => window.__scribeApi.on('scribe:settings-changed', (settings) => useSettings.setState({ settings, loaded: true })), [])
}
