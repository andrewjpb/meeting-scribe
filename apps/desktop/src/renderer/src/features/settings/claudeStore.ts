// Claude CLI em Configurações (contrato 05, CA10): onde o main achou o `claude` e qual versão respondeu.
// O caminho digitado vai ao main, que só grava se `claude --version` responder ali.
import { create } from 'zustand'
import type { ClaudeLocateResult } from '@shared/claude-cli'
import { useSettings } from '../../app/settingsStore'

export type ClaudeCheck = { phase: 'checking' } | { phase: 'found'; path: string; version: string } | { phase: 'not-found' }

interface ClaudeCliState {
  check: ClaudeCheck
  busy: boolean
  /** O último caminho digitado não respondeu como Claude Code. */
  pathRejected: boolean
  load: () => Promise<void>
  /** Caminho escolhido; `null` volta a procurar sozinho. */
  choose: (path: string | null) => Promise<void>
}

const fromResult = (result: ClaudeLocateResult): ClaudeCheck => (result.ok ? { phase: 'found', path: result.path, version: result.version } : { phase: 'not-found' })

export const useClaudeCli = create<ClaudeCliState>()((set) => ({
  check: { phase: 'checking' },
  busy: false,
  pathRejected: false,

  load: async () => {
    set({ check: { phase: 'checking' } })
    try {
      set({ check: fromResult(await window.__scribeApi.invoke('scribe:claude-locate')) })
    } catch {
      set({ check: { phase: 'not-found' } })
    }
  },

  choose: async (path) => {
    set({ busy: true, pathRejected: false })
    try {
      const { result, settings } = await window.__scribeApi.invoke('scribe:claude-path-set', { path })
      useSettings.setState({ settings, loaded: true })
      // Caminho recusado: o que já estava valendo continua valendo.
      if (result.ok || path === null) set({ check: fromResult(result) })
      set({ pathRejected: path !== null && !result.ok })
    } catch {
      // Caminho fora do formato (relativo, longo demais): o main recusa sem executar nada.
      set({ pathRejected: path !== null })
    } finally {
      set({ busy: false })
    }
  },
}))
