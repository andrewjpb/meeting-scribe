import { describe, expect, it } from 'vitest'
import { isSettingsTab, settingsPath, SETTINGS_ROUTE_PATTERN, SETTINGS_TABS } from '../../src/shared/routes'
import {
  lastSettingsTab,
  matchesRow,
  rememberSettingsTab,
  resultsLabel,
  searchSettings,
  settingsResultLabel,
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
  it('nove abas, nesta ordem, com os rótulos da tela (contrato 55: Email depois de Contas)', () => {
    expect(SETTINGS_TABS).toEqual(['geral', 'gravacao', 'claude', 'arquivos', 'contas', 'email', 'plugins', 'conexoes', 'sobre'])
    expect(SETTINGS_TABS.map((tab) => SETTINGS_TAB_LABELS[tab])).toEqual(['Geral', 'Gravação', 'Claude', 'Arquivos', 'Contas', 'Email', 'Plugins', 'Conexões', 'Sobre'])
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

  it('⌘1…⌘9 abrem a aba N (⌘6 Email, ⌘9 Sobre); outras teclas e modificadores não', () => {
    expect(tabForShortcut(key('1'))).toBe('geral')
    expect(tabForShortcut(key('3'))).toBe('claude')
    expect(tabForShortcut(key('5'))).toBe('contas')
    expect(tabForShortcut(key('6'))).toBe('email')
    expect(tabForShortcut(key('7'))).toBe('plugins')
    expect(tabForShortcut(key('8'))).toBe('conexoes')
    expect(tabForShortcut(key('9'))).toBe('sobre')
    expect(tabForShortcut(key('0'))).toBeNull()
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

  it('"Avisar quando uma reunião começar" fica em Gravação › Transcrição, logo abaixo de "Quem fala no Meet" (contratos 48 e 49)', () => {
    const transcription = index.filter((entry) => entry.tab === 'gravacao' && entry.section === 'Transcrição').map((entry) => entry.name)
    expect(transcription.indexOf('Avisar quando uma reunião começar')).toBe(transcription.indexOf('Quem fala no Meet') + 1)
    const found = searchSettings(index, 'aviso').flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))
    expect(found.map((entry) => entry.name)).toContain('Avisar quando uma reunião começar')
    expect(found.find((entry) => entry.name === 'Avisar quando uma reunião começar')?.description).toBe('Mostra um aviso no topo da tela quando você entra numa reunião: Meet e Teams no navegador (com o plugin) ou apps como Zoom e FaceTime.')
  })

  it('"Salvar plugin" e "Como instalar" de cada cartão: o rótulo do resultado diz de qual plugin é', () => {
    const found = searchSettings(index, 'salvar plugin').flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))
    expect(found.map((entry) => settingsResultLabel(index, entry))).toEqual(['Plugins › Quem fala no Meet › Salvar plugin', 'Plugins › Controle do navegador › Salvar plugin'])
    const install = index.filter((entry) => entry.name === 'Como instalar').map((entry) => settingsResultLabel(index, entry))
    expect(new Set(install).size).toBe(install.length)
    // Nome único na aba: o rótulo de sempre.
    expect(settingsResultLabel(index, index.find((entry) => entry.name === 'Modelo do chat') as SettingsEntry)).toBe('Claude › Modelo do chat')
  })

  it('"A IA pode abrir imagens e transcrever áudios" fica logo abaixo de "Modelo do chat" e a busca acha pelas palavras de mídia (contrato 151)', () => {
    const chat = index.filter((entry) => entry.tab === 'claude' && entry.section === 'Chat e resumo').map((entry) => entry.name)
    expect(chat.indexOf('A IA pode abrir imagens e transcrever áudios')).toBe(chat.indexOf('Modelo do chat') + 1)
    for (const term of ['mídia', 'midia', 'imagem', 'foto', 'print', 'áudio', 'PDF', 'anexo', 'transcrição', 'AssemblyAI', 'privacidade']) {
      const found = searchSettings(index, term).flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))
      expect(found.map((entry) => entry.name), term).toContain('A IA pode abrir imagens e transcrever áudios')
    }
  })

  it('casa a linha da tela pelo nome ou pelo nome com a versão', () => {
    expect(matchesRow({ name: 'Versão' }, 'Versão 0.3.0')).toBe(true)
    expect(matchesRow({ name: 'Modelo' }, 'Modelo')).toBe(true)
    expect(matchesRow({ name: 'Modelo' }, 'Modelo do chat')).toBe(false)
    expect(resultsLabel(1)).toBe('1 resultado')
    expect(resultsLabel(3)).toBe('3 resultados')
  })
})

describe('aba Email no índice (contrato 55, CA23)', () => {
  const index = settingsIndex('Claude')
  const find = (query: string): SettingsEntry[] => searchSettings(index, query).flatMap((group) => group.indexes.map((i) => index[i] as SettingsEntry))

  it('as linhas de email saíram de Contas e as novas entraram em Email', () => {
    expect(index.filter((entry) => entry.tab === 'contas').some((entry) => /email/i.test(entry.name))).toBe(false)
    expect(index.filter((entry) => entry.tab === 'email').map((entry) => `${entry.section} › ${entry.name}`)).toEqual([
      'Contas › Contas de email',
      'Contas › Buscar emails novos a cada',
      'Assinatura › Assinatura',
      'Assinatura › Assinatura em mensagens novas',
      'Assinatura › Assinatura em respostas e encaminhamentos',
      'Regras › Regras',
      'Pastas › Pastas',
      'Avisos › Avisar quando chega email',
      // Contrato 63 (CA23): o bloco "Convites", no fim da aba.
      'Convites › Agenda padrão',
      'Convites › Pôr na agenda ao aceitar',
      'Convites › Acesso ao Calendário do Mac',
      'Convites › Sugerir evento quando o email não tem convite',
    ])
  })

  it('cada palavra acha ao menos uma linha da aba Email, com o rótulo "Email › <nome>"', () => {
    for (const word of ['regra', 'regras', 'executar', 'pasta', 'pastas', 'mover', 'assinatura', 'avisos', 'notificação']) {
      expect(find(word).some((entry) => entry.tab === 'email'), word).toBe(true)
    }
    const signature = find('assinatura')
    expect(signature.map((entry) => settingsResultLabel(index, entry))).toEqual(['Email › Assinatura', 'Email › Assinatura em mensagens novas', 'Email › Assinatura em respostas e encaminhamentos'])
    expect(signature[0]?.description).toBe('Texto que entra no fim das mensagens da conta. Um por conta.')
  })

  it('"Avisar quando chega email" com o texto exato da CA22; "avisos" acha pelas palavras-chave, fora da tela', () => {
    const notices = index.find((entry) => entry.name === 'Avisar quando chega email')
    expect(notices?.description).toBe('Notificação do macOS para email novo na Caixa de Entrada. Uma regra com “não avisar” vale mais.')
    expect(notices?.description).not.toMatch(/avisos/i)
    expect(find('avisos').map((entry) => entry.name)).toContain('Avisar quando chega email')
  })
})
