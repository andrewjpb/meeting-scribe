import { describe, expect, it } from 'vitest'
import { isSettingsTab, settingsPath, SETTINGS_ROUTE_PATTERN, SETTINGS_TABS } from '../../src/shared/routes'
import {
  lastSettingsTab,
  matchesRow,
  rememberSettingsTab,
  resultsLabel,
  searchSettings,
  settingsIndex,
  SETTINGS_TAB_LABELS,
  tabForShortcut,
  type SettingsEntry,
} from '../../src/renderer/src/features/settings/settingsTabs'

const key = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = { metaKey: true }) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('abas de Configurações (contrato 18)', () => {
  it('sete abas, nesta ordem, com os rótulos da tela', () => {
    expect(SETTINGS_TABS).toEqual(['geral', 'gravacao', 'claude', 'arquivos', 'contas', 'plugins', 'sobre'])
    expect(SETTINGS_TABS.map((tab) => SETTINGS_TAB_LABELS[tab])).toEqual(['Geral', 'Gravação', 'Claude', 'Arquivos', 'Contas', 'Plugins', 'Sobre'])
  })

  it('aba na URL, com a âncora do bloco', () => {
    expect(SETTINGS_ROUTE_PATTERN).toBe('/configuracoes/:aba?')
    expect(settingsPath('claude')).toBe('/configuracoes/claude')
    expect(settingsPath('geral', 'atualizacoes')).toBe('/configuracoes/geral#atualizacoes')
    expect(isSettingsTab('sobre')).toBe(true)
    expect(isSettingsTab('marca')).toBe(false)
    expect(isSettingsTab(undefined)).toBe(false)
  })

  it('lembra a última aba da sessão (padrão: geral)', () => {
    expect(lastSettingsTab()).toBe('geral')
    rememberSettingsTab('claude')
    expect(lastSettingsTab()).toBe('claude')
    rememberSettingsTab('geral')
  })

  it('⌘1…⌘7 abrem a aba N; outras teclas e modificadores não', () => {
    expect(tabForShortcut(key('1'))).toBe('geral')
    expect(tabForShortcut(key('3'))).toBe('claude')
    expect(tabForShortcut(key('6'))).toBe('plugins')
    expect(tabForShortcut(key('7'))).toBe('sobre')
    expect(tabForShortcut(key('8'))).toBeNull()
    expect(tabForShortcut(key('1', {}))).toBeNull()
    expect(tabForShortcut(key('1', { metaKey: true, shiftKey: true }))).toBeNull()
    expect(tabForShortcut(key('1', { ctrlKey: true }))).toBeNull()
    expect(tabForShortcut(key('f'))).toBeNull()
  })
})

describe('busca nas configurações (contrato 18, CA4)', () => {
  const entries: SettingsEntry[] = [
    { tab: 'geral', name: 'Tema', description: '', section: 'S' },
    { tab: 'gravacao', name: 'Cancelamento de eco', description: 'Ligue se usar alto-falante.', section: 'S' },
    { tab: 'claude', name: 'Modelo do chat', description: 'Usado em Perguntar.', section: 'S' },
    { tab: 'claude', name: 'Modelo', description: '', section: 'S' },
    { tab: 'gravacao', name: 'Idioma falado', description: 'O idioma da reunião.', section: 'S' },
  ]

  it('filtra por nome e descrição, sem acento nem maiúscula, agrupando por aba na ordem das abas', () => {
    expect(searchSettings(entries, 'MODELO')).toEqual([{ tab: 'claude', label: 'Claude', indexes: [2, 3] }])
    expect(searchSettings(entries, 'reuniao')).toEqual([{ tab: 'gravacao', label: 'Gravação', indexes: [4] }])
    expect(searchSettings(entries, 'e')).toEqual([
      { tab: 'geral', label: 'Geral', indexes: [0] },
      { tab: 'gravacao', label: 'Gravação', indexes: [1, 4] },
      { tab: 'claude', label: 'Claude', indexes: [2, 3] },
    ])
  })

  it('termo vazio ou sem resultado: nada', () => {
    expect(searchSettings(entries, '   ')).toEqual([])
    expect(searchSettings(entries, 'google')).toEqual([])
  })
})

describe('índice da busca (contrato 18, devolução)', () => {
  const index = settingsIndex('Claude')

  it('acha as linhas condicionais pelo nome e pela descrição, com a condição', () => {
    const find = (query: string): SettingsEntry[] => searchSettings(index, query).flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))
    expect(find('haiku').map((entry) => entry.name)).toContain('Modelo')
    expect(find('haiku').find((entry) => entry.name === 'Modelo')?.when).toBe('"Traduzir com" está em Claude CLI')
    const pasta = find('pasta').find((entry) => entry.name === 'Pasta')
    expect(pasta).toMatchObject({ tab: 'arquivos', section: 'Arquivos da reunião' })
    expect(pasta?.when).toContain('ligado')
  })

  it('toda aba com linhas (Contas desde o contrato 11); nomes únicos por bloco', () => {
    for (const tab of SETTINGS_TABS) {
      // Contrato 46: cada cartão de plugin tem o seu "Salvar plugin" e o seu "Como instalar"; o bloco desempata.
      const names = index.filter((entry) => entry.tab === tab).map((entry) => `${entry.section} › ${entry.name}`)
      expect(names.length > 0).toBe(true)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('o cartão do "Controle do navegador" entra na busca, com "Ativar ponte" (contrato 46)', () => {
    const plugins = index.filter((entry) => entry.tab === 'plugins' && entry.section === 'Controle do navegador').map((entry) => entry.name)
    expect(plugins).toEqual(['Controle do navegador', 'Ativar ponte', 'Salvar plugin', 'Como instalar'])
    const found = searchSettings(index, 'ponte').flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))
    expect(found.map((entry) => entry.name)).toContain('Ativar ponte')
  })

  it('casa a linha da tela pelo nome ou pelo nome com a versão', () => {
    expect(matchesRow({ name: 'Versão' }, 'Versão 0.3.0')).toBe(true)
    expect(matchesRow({ name: 'Modelo' }, 'Modelo')).toBe(true)
    expect(matchesRow({ name: 'Modelo' }, 'Modelo do chat')).toBe(false)
    expect(resultsLabel(1)).toBe('1 resultado')
    expect(resultsLabel(3)).toBe('3 resultados')
  })
})
