// Índice estático da busca das Configurações (contrato 18): fica em `shared` porque o smoke (no main) confere
// que toda linha da tela está nele.
import type { SettingsTab } from './routes'

/** Uma linha de configuração no índice da busca. */
export interface SettingsEntry {
  tab: SettingsTab
  /** Nome como aparece na linha (`data-setting-name`); "Versão" também acha "Versão 0.3.0". */
  name: string
  description: string
  /** Âncora: o bloco (`section[aria-label]`) onde a linha fica, para rolar até ele quando ela não aparece. */
  section: string
  /** Linha que só aparece em certa condição: completa "Esta opção aparece quando …". */
  when?: string
}

/**
 * Índice estático da busca (contrato 18, CA4): todas as linhas, inclusive as que só aparecem em certa
 * condição. Linha nova em Configurações entra aqui também; o smoke confere que toda linha da tela está nele.
 */
export function settingsIndex(agent: string): SettingsEntry[] {
  const row = (tab: SettingsTab, section: string, name: string, description = '', when?: string): SettingsEntry =>
    when ? { tab, section, name, description, when } : { tab, section, name, description }
  return [
    row('geral', 'Marca', 'Nome do app', 'Aparece na barra lateral, no título da janela e no ícone do Dock.'),
    row('geral', 'Marca', 'Subtítulo', 'Abaixo do nome, na barra lateral.'),
    row('geral', 'Marca', 'Logo', 'Imagem da barra lateral e do ícone do Dock.'),
    row('geral', 'Aparência', 'Tema', 'Sistema, claro ou escuro.'),
    row('geral', 'Atualizações', 'Versão', 'Procurar atualização.'),
    row('geral', 'Atualizações', 'Procurar atualizações automaticamente', 'Ao abrir o app e a cada 6 horas.'),
    row('gravacao', 'Áudio', 'Microfone', 'Usado para a sua voz.'),
    row('gravacao', 'Áudio', 'Cancelamento de eco', 'Ligue se usar alto-falante em vez de fone, para a fala dos participantes não entrar pelo seu microfone.'),
    row('gravacao', 'Transcrição', 'Chave da AssemblyAI', 'Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS.'),
    row('gravacao', 'Transcrição', 'Remover eco do alto-falante', 'Some com a fala dos participantes que vaza para o seu microfone quando você não usa fone.'),
    row('gravacao', 'Transcrição', 'Identificar quem fala', 'Separa os participantes por voz. Mais lento; desligado, as falas se dividem pelas pausas.'),
    row('gravacao', 'Idiomas', 'Idioma falado', 'O idioma da reunião.'),
    row('gravacao', 'Idiomas', 'Traduzir ao vivo', 'A tradução aparece abaixo de cada fala.'),
    row('gravacao', 'Idiomas', 'Traduzir para', 'Idioma da tradução.'),
    row('claude', 'Claude', `Conexão com o ${agent}`, `O agente mostra o raciocínio e os passos do ${agent} direto do protocolo.`),
    row('claude', 'Claude', `Agente do ${agent}`, 'Baixado do registro do npm só quando você pede; fica neste Mac.'),
    row('claude', 'Claude', 'Claude CLI', 'Caminho do claude instalado neste Mac, usado na tradução, no resumo e em Perguntar.'),
    row('claude', 'Modelo de tradução', 'Traduzir com', 'O Claude CLI usa o claude instalado neste Mac, com a sua conta.'),
    row('claude', 'Modelo de tradução', 'Modelo', 'Modelo do Claude na tradução: Haiku (mais rápido) ou Sonnet.', '"Traduzir com" está em Claude CLI'),
    row('claude', 'Modelo de tradução', 'Modelo da AssemblyAI', 'Lista de modelos de tradução com preço e contexto.', '"Traduzir com" está em AssemblyAI'),
    row('claude', 'Chat e resumo', 'Modelo do chat', 'Usado em Perguntar. O Opus responde melhor e demora mais.'),
    row('claude', 'Chat e resumo', 'Resumir ao encerrar', 'Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas.'),
    row('arquivos', 'Arquivos da reunião', 'Salvar áudio e transcrição numa pasta', 'Para cada reunião: um arquivo de áudio (você e os participantes) e a transcrição em texto. Avise as pessoas antes de gravar.'),
    row('arquivos', 'Arquivos da reunião', 'Pasta', 'Onde ficam o áudio e a transcrição de cada reunião.', '"Salvar áudio e transcrição numa pasta" está ligado'),
    row('sobre', 'Sobre', 'Versão', 'Versão instalada do app.'),
    row('sobre', 'Sobre', 'Electron', 'Base do app.'),
    row('sobre', 'Sobre', 'Chrome', 'Motor das telas.'),
    row('sobre', 'Sobre', 'Licença', 'Código aberto, sob a licença MIT.'),
    row('sobre', 'Sobre', 'Atualizações', 'Abre o bloco de atualizações, em Geral.'),
  ]
}

/** A linha do índice na tela: mesmo nome, ou o nome seguido do número da versão ("Versão 0.3.0"). */
export function matchesRow(entry: Pick<SettingsEntry, 'name'>, rowName: string): boolean {
  return rowName === entry.name || (rowName.startsWith(`${entry.name} `) && /^\d/.test(rowName.slice(entry.name.length + 1)))
}
