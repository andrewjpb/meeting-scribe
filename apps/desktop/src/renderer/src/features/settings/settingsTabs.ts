// Abas de Configurações (contrato 18): rótulos, a aba lembrada na sessão, os atalhos ⌘1…⌘9 e a busca, que
// filtra as linhas de todas as abas pelo nome e pela descrição, sem acento nem maiúscula.
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, type SettingsTab } from '@shared/routes'
import type { SettingsEntry } from '@shared/settings-index'
import { normalizeSearch } from './modelFormat'

export { matchesRow, settingsIndex, type SettingsEntry } from '@shared/settings-index'

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  geral: 'Geral',
  gravacao: 'Gravação',
  claude: 'Claude',
  arquivos: 'Arquivos',
  contas: 'Contas',
  email: 'Email',
  plugins: 'Plugins',
  conexoes: 'Conexões',
  sobre: 'Sobre',
}

/** Tempo do destaque da linha achada pela busca. */
export const HIGHLIGHT_MS = 2000

// Vale para esta janela enquanto o app está aberto; Configurações sem a aba na URL volta a ela.
let rememberedTab: SettingsTab = DEFAULT_SETTINGS_TAB

export function lastSettingsTab(): SettingsTab {
  return rememberedTab
}

export function rememberSettingsTab(tab: SettingsTab): void {
  rememberedTab = tab
}

/** ⌘1…⌘9 abrem a aba N (contrato 55: ⌘6 Email, ⌘9 Sobre); qualquer outra tecla (ou modificador a mais) não é atalho. */
export function tabForShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): SettingsTab | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return null
  return SETTINGS_TABS[Number(event.key) - 1] ?? null
}

/** Texto da região viva da busca. */
export function resultsLabel(count: number): string {
  return count === 1 ? '1 resultado' : `${count} resultados`
}

export interface SettingsResultGroup {
  tab: SettingsTab
  label: string
  /** Posições em `entries`, na ordem da tela. */
  indexes: number[]
}

/**
 * Rótulo do resultado da busca: "<aba> › <nome>". Quando o mesmo nome aparece em mais de um bloco da aba ("Salvar
 * plugin" e "Como instalar" de cada cartão de plugin), entra o bloco no meio: "Plugins › Quem fala no Meet › Salvar plugin".
 */
export function settingsResultLabel(entries: readonly SettingsEntry[], entry: SettingsEntry): string {
  const repeated = entries.some((other) => other !== entry && other.tab === entry.tab && other.name === entry.name && other.section !== entry.section)
  const tab = SETTINGS_TAB_LABELS[entry.tab]
  return repeated ? `${tab} › ${entry.section} › ${entry.name}` : `${tab} › ${entry.name}`
}

/** Linhas cujo nome ou descrição contém o termo, agrupadas por aba na ordem das abas. Termo vazio: nada. */
export function searchSettings(entries: readonly SettingsEntry[], query: string): SettingsResultGroup[] {
  const needle = normalizeSearch(query)
  if (!needle) return []
  return SETTINGS_TABS.flatMap((tab) => {
    const indexes = entries.flatMap((entry, index) =>
      entry.tab === tab && [entry.name, entry.description, entry.keywords ?? ''].some((text) => normalizeSearch(text).includes(needle)) ? [index] : [],
    )
    return indexes.length ? [{ tab, label: SETTINGS_TAB_LABELS[tab], indexes }] : []
  })
}
