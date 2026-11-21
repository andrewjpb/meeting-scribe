// Índice estático da busca das Configurações (contrato 18): fica em `shared` porque o smoke (no main) confere
// que toda linha da tela está nele.
import { CLAUDE_CONNECTORS_DESCRIPTION, MCP_ADD_DESCRIPTION, MCP_CLI_DESCRIPTION, MCP_FOUND_DESCRIPTION } from './mcp'
import { APP_PLUGINS, PLUGIN_INSTALL_DESCRIPTION, PLUGIN_SAVE_DESCRIPTION } from './plugins'
import type { SettingsTab } from './routes'

/** Descrição do interruptor "Quem fala no Meet" (contratos 27 e 41), a mesma na tela e na busca. */
export const MEET_SPEAKERS_DESCRIPTION = 'Com a extensão do LAP Reuniões no Chrome, cada fala do Meet e do Teams ganha o nome de quem falou. Tudo fica neste computador.'

/** Descrição de "Avisar quando uma reunião começar" (contratos 48 e 49), a mesma na tela e na busca. */
export const MEETING_PROMPT_DESCRIPTION = 'Mostra um aviso no topo da tela quando você entra numa reunião: Meet e Teams no navegador (com o plugin) ou apps como Zoom e FaceTime.'

/** Descrição de "Ativar ponte" do plugin "Controle do navegador" (contrato 46), a mesma na tela e na busca. */
export const NAVEGADOR_BRIDGE_DESCRIPTION = 'Liga a conexão local que a extensão usa para receber os comandos do app. Desligada, nada chega ao Chrome.'

/** Descrição de "IA anotando ao vivo" (contrato 30), a mesma na tela e na busca. */
export const LIVE_CARDS_DESCRIPTION = 'Durante a gravação, a cada 5 minutos o Claude local lê o trecho novo da conversa e cria e resolve post-its. Vale como padrão do interruptor "IA anotando" de cada gravação.'

/** Descrição de "Detalhes com IA no WhatsApp" (contrato 32), a mesma na tela e na busca. */
export const WHATSAPP_INSIGHTS_DESCRIPTION = 'Ao abrir uma conversa, o Claude local lê as últimas mensagens e escreve o resumo, o humor, as pendências e os compromissos no painel Detalhes. Nunca envia nada.'

/** Descrição de "Corrigir ao enviar no WhatsApp" (contrato 35), a mesma na tela e na busca. */
export const WHATSAPP_AUTO_CORRECT_DESCRIPTION = 'Ao clicar em Enviar, o Claude (Haiku) corrige ortografia e pontuação e melhora a clareza da mensagem, e o texto corrigido é enviado sem nova confirmação. Se a correção falhar, a mensagem original é enviada.'

/** Descrições das notificações do WhatsApp (contrato 40), as mesmas na tela e na busca. */
export const WHATSAPP_NOTIFICATIONS_DESCRIPTION = 'Uma notificação do macOS a cada mensagem recebida, menos da conversa que está aberta na frente. Com o app bloqueado, sem o texto.'
export const WHATSAPP_ONLY_PEOPLE_DESCRIPTION = 'Mensagens de grupo não geram notificação.'
/** Descrição de "Mostrar quando estou digitando" (contrato 34), a mesma na tela e na busca. */
export const WHATSAPP_TYPING_SIGNAL_DESCRIPTION = 'Quem está na conversa aberta vê "digitando…" enquanto você escreve. Desligado, ninguém vê.'

/** Descrição de "Buscar emails novos a cada" (contrato 42, `emailPollMinutes`), a mesma na tela e na busca. */
export const EMAIL_POLL_DESCRIPTION = 'Só nas contas POP3: de quantos em quantos minutos o app procura email novo. As contas IMAP recebem na hora.'

/**
 * Descrições da aba "Email" de Configurações (contrato 43; contrato 55: saíram de Contas para a aba própria), as mesmas na
 * tela e na busca.
 */
export const EMAIL_ACCOUNTS_DESCRIPTION = 'Contas de email IMAP ou POP3, com envio por SMTP. A senha fica cifrada neste Mac.'
export const EMAIL_NOTIFICATIONS_DESCRIPTION = 'Notificação do macOS para email novo na Caixa de Entrada. Uma regra com “não avisar” vale mais.'
export const EMAIL_SIGNATURE_DESCRIPTION = 'Texto que entra no fim das mensagens da conta. Um por conta.'
export const EMAIL_SIGNATURE_NEW_DESCRIPTION = 'Põe a assinatura ao abrir “Nova mensagem”.'
export const EMAIL_SIGNATURE_REPLY_DESCRIPTION = 'Põe a assinatura acima do texto citado.'
export const EMAIL_RULES_DESCRIPTION = 'As regras são do app: agem no email que chega, na ordem da lista, só enquanto o Meeting Scribe está aberto. “Parar aqui” impede as regras de baixo.'
export const EMAIL_FOLDERS_DESCRIPTION = 'As pastas da conta no servidor. Para mover mensagens, arraste para a pasta na tela de email.'

/** Descrições do bloco "Convites" da aba Email (contrato 63, CA21), as mesmas na tela e na busca. */
export const INVITE_CALENDAR_DESCRIPTION = 'Onde entra o convite aceito. Dá para trocar em cada convite.'
export const INVITE_CALENDAR_NO_ACCESS_DESCRIPTION = 'Permita o acesso ao Calendário para ver as agendas.'
export const INVITE_ADD_ON_ACCEPT_DESCRIPTION = 'Ligado, Aceitar e Talvez também gravam o evento no Calendário do Mac. Dá para desligar em cada convite.'
export const INVITE_ACCESS_DESCRIPTION = 'Acesso completo: o app lista as agendas, acha o convite que já está lá e atualiza o que ele mesmo gravou. Nunca apaga evento que não criou.'
export const INVITE_SUGGEST_DESCRIPTION = 'Mostra “Sugerir evento” na leitura. No clique, o Claude (Haiku) lê só o texto do email aberto e preenche um evento para você conferir. Nada é gravado nem respondido sem você.'

/** Contrato 69: as seções "Instagram" e "Armazenamento de mídia (S3)" da aba Contas, as mesmas na tela e na busca. */
export const INSTAGRAM_SECTION_DESCRIPTION = 'Contas profissionais conectadas por token, para publicar, responder e ver métricas daqui. O token fica cifrado neste Mac.'
export const INSTAGRAM_TOKEN_DESCRIPTION = 'Gerado no painel da Meta; começa com IGAA. Vale 60 dias e o app renova sozinho enquanto estiver em uso.'
export const INSTAGRAM_PREREQUISITE = 'A conta precisa ser profissional (Business ou Creator) e pública.'
// 73: comentários
/** Contrato 73: "Atualizar comentários e mensagens a cada" (`redesPollMinutes`), a mesma na tela e na busca. */
export const REDES_POLL_NAME = 'Atualizar comentários e mensagens a cada'
export const REDES_POLL_DESCRIPTION = 'De quantos em quantos minutos o app lê os comentários e as mensagens do Instagram. Também atualiza ao abrir a seção.'
// fim 73
export const MEDIA_HOST_SECTION_DESCRIPTION = 'Imagens e carrosséis precisam de um endereço público para o Instagram buscar. Compatível com Cloudflare R2 e qualquer S3. Vídeos não precisam.'
export const MEDIA_HOST_FIELDS = [
  { key: 'endpoint', name: 'Endpoint', description: 'Endereço S3 do provedor, com https://.' },
  { key: 'region', name: 'Região', description: 'No Cloudflare R2, “auto”.' },
  { key: 'bucket', name: 'Bucket', description: 'Onde os arquivos sobem, em instagram/<conta>/.' },
  { key: 'accessKeyId', name: 'Chave de acesso', description: 'O ID da chave de API do armazenamento.' },
  { key: 'secretAccessKey', name: 'Chave secreta', description: 'Fica cifrada neste Mac e nunca aparece de novo.' },
  { key: 'publicBaseUrl', name: 'URL pública base', description: 'De onde o Instagram baixa a imagem.' },
] as const
export const MEDIA_HOST_PATH_STYLE_NAME = 'Endereço no caminho (path-style)'
export const MEDIA_HOST_PATH_STYLE_DESCRIPTION = 'Ligado: endpoint/bucket/arquivo, como o R2 pede. Desligado: bucket.endpoint/arquivo.'

/** Contrato 109 (R46): a Section "Funil de vendas" da aba Geral, com os nomes e as descrições da tela e da busca. */
export const FUNIL_SECTION = 'Funil de vendas'
export const FUNIL_DETECTAR_NAME = 'Detectar oportunidades nas reuniões'
export const FUNIL_DETECTAR_DESCRIPTION = 'Depois do resumo, propõe criar ou atualizar uma oportunidade.'
export const FUNIL_DIAS_NAME = 'Considerar esfriada após (dias)'
export const FUNIL_DIAS_DESCRIPTION = 'Oportunidade aberta sem interação nesse prazo ganha o marcador esfriou.'
export const FUNIL_AVISAR_NAME = 'Avisar oportunidades esfriadas e passos vencidos'
export const FUNIL_AVISAR_DESCRIPTION = 'Uma notificação por dia, depois das 9h.'

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
  /** Contrato 55: palavras a mais que a busca acha, sem aparecer na tela ("avisos", "executar"). */
  keywords?: string
}

/**
 * Índice estático da busca (contrato 18, CA4): todas as linhas, inclusive as que só aparecem em certa
 * condição. Linha nova em Configurações entra aqui também; o smoke confere que toda linha da tela está nele.
 */
export function settingsIndex(agent: string): SettingsEntry[] {
  const row = (tab: SettingsTab, section: string, name: string, description = '', when?: string, keywords?: string): SettingsEntry => ({
    tab,
    section,
    name,
    description,
    ...(when ? { when } : {}),
    ...(keywords ? { keywords } : {}),
  })
  return [
    row('geral', 'Marca', 'Nome do app', 'Aparece na barra lateral, no título da janela e no ícone do Dock.'),
    row('geral', 'Marca', 'Subtítulo', 'Abaixo do nome, na barra lateral.'),
    row('geral', 'Marca', 'Logo', 'Imagem da barra lateral e do ícone do Dock.'),
    row('geral', 'Aparência', 'Tema', 'Sistema, claro ou escuro.'),
    row('geral', 'Janela', 'Ao fechar a janela', 'Na barra de menus, as tarefas agendadas continuam rodando.'),
    row('geral', 'Janela', 'Abrir ao entrar no Mac', 'Abre direto na barra de menus, sem janela.'),
    row('geral', FUNIL_SECTION, FUNIL_DETECTAR_NAME, FUNIL_DETECTAR_DESCRIPTION),
    row('geral', FUNIL_SECTION, FUNIL_DIAS_NAME, FUNIL_DIAS_DESCRIPTION),
    row('geral', FUNIL_SECTION, FUNIL_AVISAR_NAME, FUNIL_AVISAR_DESCRIPTION),
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
    row('gravacao', 'Transcrição', 'Avisar quando uma reunião começar', MEETING_PROMPT_DESCRIPTION),
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
    row('contas', 'WhatsApp', 'Mostrar quando estou digitando', WHATSAPP_TYPING_SIGNAL_DESCRIPTION),
    // Contrato 69: o Instagram por token e o armazenamento de mídia, depois do WhatsApp.
    row('contas', 'Instagram', 'Token de acesso', INSTAGRAM_TOKEN_DESCRIPTION, undefined, 'instagram meta conta conectar token redes'),
    // 73: comentários
    row('contas', 'Instagram', REDES_POLL_NAME, REDES_POLL_DESCRIPTION, undefined, 'instagram comentários mensagens atualizar redes'),
    // fim 73
    ...MEDIA_HOST_FIELDS.map((field) => row('contas', 'Armazenamento de mídia (S3)', field.name, field.description, undefined, 's3 r2 cloudflare armazenamento mídia instagram')),
    row('contas', 'Armazenamento de mídia (S3)', MEDIA_HOST_PATH_STYLE_NAME, MEDIA_HOST_PATH_STYLE_DESCRIPTION, undefined, 's3 r2 armazenamento mídia'),
    row('contas', 'Google', 'Guardar no Google Drive', 'Depois de cada reunião, o áudio, a transcrição e o resumo vão para a pasta "LAP Reuniões" do seu Drive.', 'a conta Google está conectada'),
    // Contrato 43: as contas de email, os avisos e o intervalo do POP3. Contrato 55: na aba "Email", com a assinatura,
    // as regras e as pastas da conta escolhida.
    row('email', 'Contas', 'Contas de email', EMAIL_ACCOUNTS_DESCRIPTION),
    row('email', 'Contas', 'Buscar emails novos a cada', EMAIL_POLL_DESCRIPTION),
    row('email', 'Assinatura', 'Assinatura', EMAIL_SIGNATURE_DESCRIPTION, 'há uma conta de email'),
    row('email', 'Assinatura', 'Assinatura em mensagens novas', EMAIL_SIGNATURE_NEW_DESCRIPTION, 'há uma conta de email'),
    row('email', 'Assinatura', 'Assinatura em respostas e encaminhamentos', EMAIL_SIGNATURE_REPLY_DESCRIPTION, 'há uma conta de email'),
    row('email', 'Regras', 'Regras', EMAIL_RULES_DESCRIPTION, 'há uma conta de email', 'regra executar agora mover marcar apagar não avisar'),
    row('email', 'Pastas', 'Pastas', EMAIL_FOLDERS_DESCRIPTION, 'há uma conta de email', 'pasta criar renomear apagar mover'),
    row('email', 'Avisos', 'Avisar quando chega email', EMAIL_NOTIFICATIONS_DESCRIPTION, undefined, 'avisos notificação'),
    // Contrato 63: o bloco "Convites", no fim da aba (vale para todas as contas).
    row('email', 'Convites', 'Agenda padrão', INVITE_CALENDAR_DESCRIPTION, undefined, 'convite agenda calendário'),
    row('email', 'Convites', 'Pôr na agenda ao aceitar', INVITE_ADD_ON_ACCEPT_DESCRIPTION, undefined, 'convite agenda calendário aceitar'),
    row('email', 'Convites', 'Acesso ao Calendário do Mac', INVITE_ACCESS_DESCRIPTION, undefined, 'convite agenda calendário permissão'),
    row('email', 'Convites', 'Sugerir evento quando o email não tem convite', INVITE_SUGGEST_DESCRIPTION, undefined, 'convite sugerir evento agenda'),
    // Contrato 31: um cartão por plugin, com o nome (e o estado), "Salvar plugin" e "Como instalar". Contrato 46: o
    // do navegador tem também "Ativar ponte".
    ...APP_PLUGINS.flatMap((plugin) => [
      row('plugins', plugin.nome, plugin.nome, `${plugin.navegador}. ${plugin.descricao}`),
      ...(plugin.id === 'navegador' ? [row('plugins', plugin.nome, 'Ativar ponte', NAVEGADOR_BRIDGE_DESCRIPTION)] : []),
      row('plugins', plugin.nome, 'Salvar plugin', PLUGIN_SAVE_DESCRIPTION),
      row('plugins', plugin.nome, 'Como instalar', PLUGIN_INSTALL_DESCRIPTION),
    ]),
    // Contrato 21: as linhas fixas da aba "Conexões" (os servidores são itens da lista, não linhas de configuração).
    row('conexoes', 'Do Claude CLI', 'Servidores do Claude CLI', MCP_CLI_DESCRIPTION),
    row('conexoes', 'Servidores do app', 'Adicionar servidor MCP', MCP_ADD_DESCRIPTION),
    row('conexoes', 'Encontrados neste Mac', 'Claude Desktop', MCP_FOUND_DESCRIPTION),
    // Contrato 58: a seção dos conectores do claude.ai, por último.
    row('conexoes', 'Conectores do claude.ai', 'Conectores da sua conta', CLAUDE_CONNECTORS_DESCRIPTION),
    row('sobre', 'Sobre', 'Versão', 'Versão instalada do app.'),
    row('sobre', 'Sobre', 'Electron', 'Base do app.'),
    row('sobre', 'Sobre', 'Chrome', 'Motor das telas.'),
    row('sobre', 'Sobre', 'Licença', 'Código aberto, sob a licença GPL-3.0.'),
    row('sobre', 'Sobre', 'Atualizações', 'Abre o bloco de atualizações, em Geral.'),
  ]
}

/** A linha do índice na tela: mesmo nome, ou o nome seguido do número da versão ("Versão 0.3.0"). */
export function matchesRow(entry: Pick<SettingsEntry, 'name'>, rowName: string): boolean {
  return rowName === entry.name || (rowName.startsWith(`${entry.name} `) && /^\d/.test(rowName.slice(entry.name.length + 1)))
}
