// Índice estático da busca das Configurações (contrato 18): fica em `shared` porque o smoke (no main) confere
// que toda linha da tela está nele.
import { APP_PLUGINS, PLUGIN_INSTALL_DESCRIPTION, PLUGIN_SAVE_DESCRIPTION } from './plugins'
import type { SettingsTab } from './routes'

/** Descrição do interruptor "Quem fala no Meet" (contrato 27), a mesma na tela e na busca. */
export const MEET_SPEAKERS_DESCRIPTION = 'Com a extensão do LAP Reuniões no Chrome, cada fala do Meet ganha o nome de quem falou. Tudo fica neste computador.'

/** Descrição de "IA anotando ao vivo" (contrato 30), a mesma na tela e na busca. */
export const LIVE_CARDS_DESCRIPTION = 'Durante a gravação, a cada 5 minutos o Claude local lê o trecho novo da conversa e cria e resolve post-its. Vale como padrão do interruptor "IA anotando" de cada gravação.'

/** Descrição de "Detalhes com IA no WhatsApp" (contrato 32), a mesma na tela e na busca. */
export const WHATSAPP_INSIGHTS_DESCRIPTION = 'Ao abrir uma conversa, o Claude local lê as últimas mensagens e escreve o resumo, o humor, as pendências e os compromissos no painel Detalhes. Nunca envia nada.'

/** Descrição de "Corrigir ao enviar no WhatsApp" (contrato 35), a mesma na tela e na busca. */
export const WHATSAPP_AUTO_CORRECT_DESCRIPTION = 'Ao clicar em Enviar, o Claude (Haiku) corrige ortografia e pontuação e melhora a clareza da mensagem, e o texto corrigido é enviado sem nova confirmação. Se a correção falhar, a mensagem original é enviada.'

/** Descrições das notificações do WhatsApp (contrato 40), as mesmas na tela e na busca. */
export const WHATSAPP_NOTIFICATIONS_DESCRIPTION = 'Uma notificação do macOS a cada mensagem recebida, menos da conversa que está aberta na frente. Com o app bloqueado, sem o texto.'
export const WHATSAPP_ONLY_PEOPLE_DESCRIPTION = 'Mensagens de grupo não geram notificação.'

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
    row('geral', 'Janela', 'Ao fechar a janela', 'Na barra de menus, as tarefas agendadas continuam rodando.'),
    row('geral', 'Janela', 'Abrir ao entrar no Mac', 'Abre direto na barra de menus, sem janela.'),
    row('geral', 'Bloqueio', 'Senha do app', 'Pedida para desbloquear. Fica só neste Mac, guardada como hash.'),
    row('geral', 'Bloqueio', 'Usar Touch ID', 'Desbloquear com a digital, sem digitar a senha.', 'o Mac tem Touch ID'),
    row('geral', 'Bloqueio', 'Bloquear sozinho', 'Depois de um tempo sem uso do app.'),
    row('geral', 'Bloqueio', 'Bloquear quando o Mac bloquear a tela ou dormir', 'Junto com o bloqueio de tela do macOS.'),
    row('geral', 'Bloqueio', 'Pedir senha ao abrir', 'O app abre já bloqueado.'),
    row('geral', 'Atualizações', 'Versão', 'Procurar atualização.'),
    row('geral', 'Atualizações', 'Procurar atualizações automaticamente', 'Ao abrir o app e a cada 6 horas.'),
    row('gravacao', 'Áudio', 'Microfone', 'Usado para a sua voz.'),
    row('gravacao', 'Áudio', 'Cancelamento de eco', 'Ligue se usar alto-falante em vez de fone, para a fala dos participantes não entrar pelo seu microfone.'),
    row('gravacao', 'Transcrição', 'Chave da AssemblyAI', 'Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS.'),
    row('gravacao', 'Transcrição', 'Remover eco do alto-falante', 'Some com a fala dos participantes que vaza para o seu microfone quando você não usa fone.'),
    row('gravacao', 'Transcrição', 'Identificar quem fala', 'Separa os participantes por voz. Mais lento; desligado, as falas se dividem pelas pausas.'),
    row('gravacao', 'Transcrição', 'Quem fala no Meet', MEET_SPEAKERS_DESCRIPTION),
    row('gravacao', 'Idiomas', 'Idioma falado', 'O idioma da reunião.'),
    row('gravacao', 'Idiomas', 'Traduzir ao vivo', 'A tradução aparece abaixo de cada fala.'),
    row('gravacao', 'Idiomas', 'Traduzir para', 'Idioma da tradução.'),
    row('claude', 'Claude', `Conexão com o ${agent}`, `O agente mostra o raciocínio e os passos do ${agent} direto do protocolo.`),
    row('claude', 'Claude', `Agente do ${agent}`, 'Baixado do registro do npm só quando você pede; fica neste Mac.'),
    row('claude', 'Claude', 'Claude CLI', 'Caminho do claude instalado neste Mac, usado na tradução, no resumo e no Assistente.'),
    row('claude', 'Modelo de tradução', 'Traduzir com', 'O Claude CLI usa o claude instalado neste Mac, com a sua conta.'),
    row('claude', 'Modelo de tradução', 'Modelo', 'Modelo do Claude na tradução: Haiku (mais rápido) ou Sonnet.', '"Traduzir com" está em Claude CLI'),
    row('claude', 'Modelo de tradução', 'Modelo da AssemblyAI', 'Lista de modelos de tradução com preço e contexto.', '"Traduzir com" está em AssemblyAI'),
    row('claude', 'Chat e resumo', 'Modelo do chat', 'Usado no Assistente. O Opus responde melhor e demora mais.'),
    row('claude', 'Chat e resumo', 'Resumir ao encerrar', 'Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas.'),
    row('claude', 'Chat e resumo', 'IA anotando ao vivo', LIVE_CARDS_DESCRIPTION),
    row('claude', 'Chat e resumo', 'Detalhes com IA no WhatsApp', WHATSAPP_INSIGHTS_DESCRIPTION),
    row('claude', 'Chat e resumo', 'Corrigir ao enviar no WhatsApp', WHATSAPP_AUTO_CORRECT_DESCRIPTION),
    row('claude', 'Automações', 'Limite diário de execuções agendadas', 'Ao passar, todas as tarefas pausam e o app avisa.'),
    row('arquivos', 'Arquivos da reunião', 'Salvar áudio e transcrição numa pasta', 'Para cada reunião: um arquivo de áudio (você e os participantes) e a transcrição em texto. Avise as pessoas antes de gravar.'),
    row('arquivos', 'Arquivos da reunião', 'Pasta', 'Onde ficam o áudio e a transcrição de cada reunião.', '"Salvar áudio e transcrição numa pasta" está ligado'),
    row('contas', 'Google', 'Conta Google', 'Entrar com a conta Google para guardar as reuniões no Drive.'),
    row('contas', 'Microsoft', 'Conta Microsoft', 'Entrar com a conta Microsoft para ler a agenda do Outlook.'),
    row('contas', 'Agenda', 'Avisar reuniões da agenda', 'Uma notificação do macOS antes de cada reunião das agendas Google e Microsoft.'),
    row('contas', 'Agenda', 'Avisar antes', 'Quantos minutos antes do início.'),
    row('contas', 'Agenda', 'Avisar se a reunião não estiver sendo gravada', '2 minutos depois do início, e de novo aos 10, se nada estiver gravando.'),
    row('contas', 'Agenda', 'Agendas', 'Quais agendas de cada conta o app lê.'),
    row('contas', 'WhatsApp', 'WhatsApp', 'Ler as suas conversas e enviar mensagens só com o seu clique. Experimental.'),
    row('contas', 'WhatsApp', 'Notificações do WhatsApp', WHATSAPP_NOTIFICATIONS_DESCRIPTION),
    row('contas', 'WhatsApp', 'Só pessoas (sem grupos)', WHATSAPP_ONLY_PEOPLE_DESCRIPTION, '"Notificações do WhatsApp" está ligado'),
    row('contas', 'Google', 'Guardar no Google Drive', 'Depois de cada reunião, o áudio, a transcrição e o resumo vão para a pasta "LAP Reuniões" do seu Drive.', 'a conta Google está conectada'),
    // Contrato 31: um cartão por plugin, com o nome (e o estado), "Salvar plugin" e "Como instalar".
    ...APP_PLUGINS.flatMap((plugin) => [
      row('plugins', plugin.nome, plugin.nome, `${plugin.navegador}. ${plugin.descricao}`),
      row('plugins', plugin.nome, 'Salvar plugin', PLUGIN_SAVE_DESCRIPTION),
      row('plugins', plugin.nome, 'Como instalar', PLUGIN_INSTALL_DESCRIPTION),
    ]),
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
