// Plugins no app (contrato 31): extensões de navegador que vêm embutidas no pacote. A aba Configurações › Plugins
// mostra um cartão por plugin e "Salvar plugin…" copia a pasta dele para onde a pessoa escolher, para carregar sem
// compactação no navegador. Um plugin novo (ex.: Teams) = uma entrada aqui + a pasta embutida pelo pack.sh.

export type AppPluginId = 'meet'

export interface AppPlugin {
  id: AppPluginId
  nome: string
  navegador: string
  descricao: string
  /** Arquivos da pasta embutida que vão para fora, um a um. */
  arquivos: readonly string[]
}

export const APP_PLUGINS: readonly AppPlugin[] = [
  {
    id: 'meet',
    nome: 'Quem fala no Meet',
    navegador: 'Google Chrome',
    descricao: 'No Google Meet e no Microsoft Teams aberto no Chrome (não no app do Teams), manda ao app os nomes de quem fala, para a transcrição dizer quem falou cada trecho.',
    arquivos: ['manifest.json', 'content.js', 'background.js', 'README.md'],
  },
]

export const APP_PLUGIN_IDS = APP_PLUGINS.map((plugin) => plugin.id) as [AppPluginId, ...AppPluginId[]]

/** Pasta criada dentro da que a pessoa escolheu: "LAP Reunioes - Quem fala no Meet". */
export function pluginFolderName(plugin: Pick<AppPlugin, 'nome'>): string {
  return `LAP Reunioes - ${plugin.nome}`
}

/** Descrições das linhas do cartão, as mesmas na tela e no índice da busca. */
export const PLUGIN_SAVE_DESCRIPTION = 'Grava a pasta do plugin onde você escolher, para carregar no navegador.'
export const PLUGIN_INSTALL_DESCRIPTION = 'O passo a passo para carregar o plugin sem compactação.'

/** "Salvar plugin…": a pasta gravada; `{ ok: false }` se falhou; `null` se a pessoa cancelou o diálogo. */
export type PluginSaveResult = { ok: true; path: string } | { ok: false } | null
