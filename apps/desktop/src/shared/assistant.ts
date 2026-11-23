// Assistente (contrato 25): as ações que o Claude propõe no fim da resposta e o que o renderer e o main trocam
// sobre elas. O Claude só escreve um bloco cercado `lap-acao` com um JSON; o main valida (inválido vira texto
// comum), lê do app o que o cartão mostra (o nome e o número da conversa, o nome do agente) e grava a ação com a
// resposta. Nada roda sem o clique da pessoa no cartão: o lembrete vira uma tarefa "uma vez" das Automações (23),
// a resposta no WhatsApp passa pelo envio do contrato 24 (token de clique e diálogo nativo) e a tarefa abre o
// formulário do 23 preenchido. Sem zod e sem Node: o renderer usa as frases. Contrato 45: os cartões de email (a lista
// que abre a tela Email e o rascunho de resposta, que só sai pelo envio com o token de clique do contrato 42). Contrato 56:
// o cartão do lote que o Assistente moveu (`email-lote`), montado pelo main a partir do lote, nunca do texto do modelo.
// Contrato 78: o evento no Calendário do Mac (`evento`, gravado só no clique em "Pôr na agenda") e os cartões de alterar e
// apagar um lembrete que já existe (`lembrete-editar`, `lembrete-apagar`), que só aceitam o id de um lembrete do app.
// Contrato 76: o rascunho de uma publicação no Instagram (`instagram-rascunho`): o clique em "Criar rascunho" só põe o
// rascunho na fila da conta e abre o editor na tela Redes; nada é publicado daqui.
// Contrato 117: os cartões do funil de vendas (`oportunidade-criar`, `oportunidade-mover`, `oportunidade-proximo-passo`,
// `contato-criar`). Ids, etapas e contatos são lidos do funil do app; nada é gravado no funil antes do clique no cartão.
// Contrato 127: os cartões das tarefas (`tarefa-criar`, `tarefa-concluir`, `tarefa-adiar`), pelo canal único
// `scribe:chat-action-tarefa`; o `lembrete` passa a criar uma tarefa com aviso e `lembrete-editar`/`-apagar` operam sobre
// tarefas abertas com lembrete (o id inteiro ou o curto, de 8 caracteres, do `TAREFAS.md`).
// Contrato 163: os cartões da triagem do WhatsApp (`triagem-agente`, `triagem-etiqueta`), pelo canal único
// `scribe:chat-action-triagem`; a triagem só etiqueta: nenhum dos dois envia mensagem. O "Abrir" ganha Notificações e as
// abas do WhatsApp como alvo.
import { formatRunAt, wallTime, type AgentModel, type Schedule } from './automations'
import type { Chat } from './chat'
import { CAPTION_MAX } from './redes-rules'
import type { WhatsAppNavigationState } from './routes'
import type { Etiqueta, TriagemAba, TriagemAmbito } from './triagem'

/** Linguagem da cerca do bloco de ação: ```lap-acao ... ```. */
export const ACTION_FENCE = 'lap-acao'
/** Contrato 45 (CA7): o pedido de uma ferramenta do app (`src/main/chat/tools.ts`): ```lap-ferramenta ... ```. */
export const TOOL_FENCE = 'lap-ferramenta'
/**
 * Contrato 149 (R7): os limites das ferramentas de mídia do Assistente (`ver_midia_whatsapp`, `transcrever_audio_whatsapp`,
 * `ler_anexo_email`). Por pergunta, até 8 mídias; imagem e PDF até 20 MB; áudio e vídeo até 64 MB e 30 minutos (quando a
 * duração é conhecida); o texto de um anexo de texto puro é cortado em 20.000 caracteres.
 */
export const ASSISTANT_MEDIA_PER_QUESTION_MAX = 8
export const ASSISTANT_MEDIA_IMAGE_BYTES_MAX = 20 * 1024 * 1024
export const ASSISTANT_MEDIA_AUDIO_BYTES_MAX = 64 * 1024 * 1024
export const ASSISTANT_MEDIA_AUDIO_SECONDS_MAX = 30 * 60
/**
 * Contrato 149: o teto dos bytes de um áudio do WhatsApp conferido depois do download (a duração e o tamanho declarados vêm
 * de quem mandou): 16 MB cabem 30 minutos de áudio comprimido do WhatsApp. Vídeo e anexo de email seguem com os 64 MB.
 */
export const ASSISTANT_MEDIA_AUDIO_DOWNLOADED_BYTES_MAX = 16 * 1024 * 1024
export const ASSISTANT_MEDIA_TEXT_CHARS_MAX = 20_000
/** Contrato 149: os nomes das ferramentas de mídia (só existem com `settings.assistant.media` ligado). */
export const ASSISTANT_MEDIA_TOOLS = ['ver_midia_whatsapp', 'transcrever_audio_whatsapp', 'ler_anexo_email'] as const
/** Cartões numa resposta; os blocos a mais viram texto. */
export const ACTIONS_PER_MESSAGE_MAX = 6
/** "É esta conversa?": no máximo 3 cartões de resposta no WhatsApp numa resposta. */
export const WHATSAPP_CHOICES_MAX = 3
export const REMINDER_TEXT_MAX = 300
/** Pedido sem hora: o lembrete fica para as 09:00 e o cartão diz isso. */
export const REMINDER_DEFAULT_TIME = '09:00'
/** Contrato 78: os limites do evento (o que passa é cortado). */
export const EVENT_TITLE_MAX = 200
export const EVENT_NOTES_MAX = 4000
export const EVENT_LOCATION_MAX = 1024
/** Sem "fim": uma hora. */
export const EVENT_DEFAULT_DURATION_MS = 3_600_000
/** Contrato 117: os limites dos cartões do funil (o próximo passo e a nota numa linha; os contatos de um cartão de criar). */
export const FUNIL_CARD_PASSO_MAX = 300
export const FUNIL_CARD_NOTA_MAX = 1000
export const FUNIL_CARD_CONTATOS_MAX = 10
/** A frase do erro de um cartão `failed`. */
export const CHAT_ACTION_ERROR_MAX = 300
/**
 * Contrato 76: a legenda que o cartão do rascunho aceita (em unidades UTF-16). Acima dos 2.200 caracteres do Instagram o
 * cartão aparece com o contador marcando o problema (dá para editar); acima disto, o bloco fica como texto.
 */
export const INSTAGRAM_DRAFT_CAPTION_MAX = CAPTION_MAX * 4

/**
 * Telas que o botão "Abrir" alcança. `alvo`: a reunião, a conversa, a aba de Configurações ou a aba das Automações.
 * Contrato 117 (R20): o funil (Oportunidades), uma oportunidade e um contato (`alvo`: o id).
 * Contrato 127 (R30): a lista de tarefas e uma tarefa (`alvo`: o id inteiro ou o curto).
 * Contrato 163: Notificações (sem alvo); no WhatsApp, o `alvo` pode ser também uma aba da triagem (`TRIAGEM_OPEN_TABS`).
 */
export const OPEN_SCREENS = ['reuniao', 'reunioes', 'whatsapp', 'configuracoes', 'automacoes', 'gravacao', 'funil', 'oportunidade', 'contato', 'tarefas', 'tarefa', 'notificacoes'] as const
export type OpenScreen = (typeof OPEN_SCREENS)[number]
export const OPEN_SCREEN_LABELS: Readonly<Record<OpenScreen, string>> = {
  reuniao: 'a reunião',
  reunioes: 'Reuniões',
  whatsapp: 'WhatsApp',
  configuracoes: 'Configurações',
  automacoes: 'Automações',
  gravacao: 'Gravação',
  funil: 'Funil',
  oportunidade: 'a oportunidade',
  contato: 'o contato',
  tarefas: 'Tarefas',
  tarefa: 'a tarefa',
  notificacoes: 'Notificações',
}
/** Contrato 163: as abas do WhatsApp que o "Abrir" aceita como `alvo` (a "Todas" é a tela sem alvo). */
export const TRIAGEM_OPEN_TABS = ['nao-lidas', 'urgentes', 'pessoal', 'profissional'] as const satisfies readonly TriagemAba[]
export type TriagemOpenTab = (typeof TRIAGEM_OPEN_TABS)[number]
export const TRIAGEM_OPEN_TAB_LABELS: Readonly<Record<TriagemOpenTab, string>> = { 'nao-lidas': 'Não lidas', urgentes: 'Urgentes', pessoal: 'Pessoal', profissional: 'Profissional' }
export const isTriagemOpenTab = (value: string | null | undefined): value is TriagemOpenTab => (TRIAGEM_OPEN_TABS as readonly (string | null | undefined)[]).includes(value)
/** Contrato 163: o `state` do "Abrir" na tela WhatsApp: a aba da triagem (sem conversa), a conversa (o id) ou nada. */
export function whatsappOpenState(target: string | null): WhatsAppNavigationState {
  if (isTriagemOpenTab(target)) return { aba: target }
  return target ? { chatId: target } : {}
}
/** Contrato 163: "Abrir WhatsApp › Urgentes". */
export const triagemTabOpenLabel = (tab: TriagemOpenTab): string => `Abrir WhatsApp › ${TRIAGEM_OPEN_TAB_LABELS[tab]}`
/** Abas das Automações que o "Abrir" aceita. */
export const AUTOMATIONS_TABS = ['agentes', 'tarefas', 'execucoes'] as const

/**
 * `proposed`: o cartão espera o clique; `done`: feito (criado, enviado); `dismissed`: "Descartar". Contrato 78: `failed`,
 * o clique não deu certo (a frase em `error`): o evento oferece "Tentar de novo"; o lembrete que sumiu fica assim.
 */
export const CHAT_ACTION_STATUSES = ['proposed', 'done', 'failed', 'dismissed'] as const
export type ChatActionStatus = (typeof CHAT_ACTION_STATUSES)[number]
export const CHAT_ACTION_KINDS = [
  'lembrete',
  'whatsapp-resposta',
  // Contrato 128 (R29): o antigo `tarefa` (o cartão que abre o formulário das Automações).
  'agendamento',
  'abrir',
  'emails',
  'email-resposta',
  'email-lote',
  'evento',
  'lembrete-editar',
  'lembrete-apagar',
  'instagram-rascunho',
  'oportunidade-criar',
  'oportunidade-mover',
  'oportunidade-proximo-passo',
  'contato-criar',
  // Contrato 127 (R28).
  'tarefa-criar',
  'tarefa-concluir',
  'tarefa-adiar',
  // Contrato 163.
  'triagem-agente',
  'triagem-etiqueta',
] as const
export type ChatActionKind = (typeof CHAT_ACTION_KINDS)[number]

interface ActionBase {
  /** Único na resposta. */
  id: string
  status: ChatActionStatus
  /** A frase do estado depois do clique ("Lembrete criado · ter 17/11 09:00", "Enviada às 19:40", "Descartado"). */
  result: string | null
}

/** `lembrete`: uma notificação do macOS no horário. Contrato 127 (R13): o clique cria uma tarefa com `lembreteEm`. */
export interface ReminderAction extends ActionBase {
  kind: 'lembrete'
  /** ISO 8601 com o fuso. */
  at: string
  text: string
  /** "Abrir" da notificação leva a esta conversa do WhatsApp. */
  whatsappChatId: string | null
  /** O nome da conversa, lido do app. */
  whatsappChatName: string | null
  /** O pedido não disse a hora: 09:00. */
  defaultTime: boolean
  /** Contrato 45: o lembrete de responder um email; "Abrir" da notificação leva à mensagem. */
  email?: ReminderEmail | null | undefined
  /** Contrato 127: a tarefa criada pelo clique ("Ver em Tarefas" abre o detalhe dela); ausente nos cartões antigos. */
  tarefaId?: string | null | undefined
}

/** Contrato 45: a mensagem de um lembrete, lida do cache do app ("Marina Rocha · Proposta revisada"). */
export interface ReminderEmail {
  accountId: string
  /** O id da mensagem na conta (`EmailMessage.id`; achada no servidor, o id composto com a pasta). */
  messageId: string
  label: string
  /** CA7: achada só no servidor, nesta pasta: o "Abrir" não procura na INBOX do app. `null`/ausente: no app. */
  mailbox?: string | null | undefined
}

/** `whatsapp-resposta`: o texto editável e "Enviar", pelo caminho do contrato 24. */
export interface WhatsAppReplyAction extends ActionBase {
  kind: 'whatsapp-resposta'
  chatId: string
  /** Nome e número lidos do app, nunca do texto do modelo. */
  chatName: string
  phone: string | null
  group: boolean
  text: string
}

/** `agendamento` (contrato 128; era `tarefa`): "Criar agendamento" abre o formulário das Automações preenchido. */
export interface TaskAction extends ActionBase {
  kind: 'agendamento'
  name: string
  agentId: string
  /** O nome do agente, lido do app. */
  agentName: string
  message: string
  schedule: Schedule
}

/** `abrir`: um botão que leva a uma tela do app. */
export interface OpenAction extends ActionBase {
  kind: 'abrir'
  screen: OpenScreen
  target: string | null
  /** "Abrir Configurações › Claude", "Abrir «Planejamento»", lido do app. */
  label: string
}

/** Contrato 45: uma mensagem num cartão de email, como estava no cache quando a resposta terminou. */
export interface EmailCardItem {
  accountId: string
  /** O id da mensagem na conta (`EmailMessage.id`): o clique abre a tela Email nela. */
  messageId: string
  /** O endereço da conta, lido do app. */
  account: string
  /** Quem mandou: o nome, ou o endereço. */
  from: string
  fromAddress: string
  subject: string
  /** Milissegundos desde 1970. */
  date: number
  seen: boolean
  /** Recebida sem resposta posterior sua. */
  pending: boolean
  /** CA7: achada só no servidor, nesta pasta (fora do cache do app, a tela Email não a mostra); `null`: no app. */
  mailbox: string | null
}

/** Contrato 45: `emails`, a lista de mensagens que a resposta cita (pendências, busca). Só abre a tela Email. */
export interface EmailListAction extends ActionBase {
  kind: 'emails'
  items: EmailCardItem[]
}

/**
 * Contrato 45: `email-resposta`, o rascunho da resposta. Destinatário, assunto ("Re:") e o Message-ID respondido são
 * lidos do cache do app, nunca do texto do modelo; o corpo é editável e só sai com o clique em "Enviar" (o
 * `emailSend` do preload, com o token de clique do contrato 42).
 */
export interface EmailReplyAction extends ActionBase {
  kind: 'email-resposta'
  accountId: string
  /** O endereço da conta que envia. */
  account: string
  /** A mensagem respondida (`EmailMessage.id`). */
  messageId: string
  /** CA7: a respondida está só no servidor, nesta pasta ("Abrir o email" não existe para ela); `null`: no app. */
  mailbox: string | null
  /** O Message-ID dela, para o `In-Reply-To`; `null` se ela não tinha um. */
  inReplyTo: string | null
  to: string[]
  /** "Marina Rocha <marina@x>". */
  toLabel: string
  subject: string
  text: string
}

/**
 * Contrato 56: `email-lote`, o que o Assistente moveu num turno (uma conta). O main anexa à resposta (o modelo nunca
 * escreve este bloco); o cartão lê o lote por `scribe:email-batch-get` e desfaz por `scribe:email-batch-undo`. Depois do
 * Desfazer fica `done`, com a frase do estado ("Desfeito às 14:40").
 */
export interface EmailBatchAction extends ActionBase {
  kind: 'email-lote'
  batchId: string
  accountId: string
  /** O endereço da conta, lido do app. */
  account: string
}

/** Contrato 78: uma agenda do Mac em que dá para gravar, como o cartão mostra (o id só serve para escolher). */
export interface ChatActionCalendar {
  id: string
  title: string
  /** A conta ("iCloud", "Google"). */
  source: string
  /** A cor que o Mac dá à agenda (`#RRGGBB`), ou `null`. */
  color: string | null
  isDefault: boolean
}

/** Contrato 78: o acesso ao Calendário do Mac quando o cartão foi montado. */
export type ChatCalendarAccess = 'full' | 'not-determined' | 'denied' | 'unavailable'

/**
 * Contrato 78: `evento`, um evento no Calendário do Mac. O que o modelo escreveu já validado (início hoje ou depois, fim
 * depois do início) e a agenda resolvida pelo nome; nada é gravado até "Pôr na agenda". Sem acesso, `calendars` vazio e
 * `calendarId` nulo.
 */
export interface ChatActionEvent extends ActionBase {
  kind: 'evento'
  title: string
  /** ISO 8601 (UTC). No dia inteiro, a meia-noite do dia no fuso do Mac. */
  start: string
  /** ISO 8601 (UTC), depois do início. No dia inteiro, a meia-noite do dia seguinte. */
  end: string
  allDay: boolean
  location: string | null
  notes: string | null
  calendarId: string | null
  calendarTitle: string | null
  calendars: ChatActionCalendar[]
  access: ChatCalendarAccess
  /** A frase em pt-BR do clique que não deu certo (`failed`). */
  error: string | null
}

/** Contrato 78: `lembrete-editar`, mudar a hora e/ou o texto de um lembrete. Contrato 127: o lembrete de uma tarefa. */
export interface ChatActionReminderEdit extends ActionBase {
  kind: 'lembrete-editar'
  /** Contrato 127: o id inteiro da tarefa aberta com `lembreteEm` (nos cartões antigos, o de uma `ScheduledTask`). */
  taskId: string
  currentText: string
  /** ISO 8601. */
  currentAt: string
  /** O texto novo, ou `null` (fica o atual). */
  text: string | null
  /** A hora nova (ISO 8601 com o fuso), ou `null` (fica a atual). */
  at: string | null
  error: string | null
}

/** Contrato 78: `lembrete-apagar`, apagar um lembrete. Contrato 127: apaga a tarefa do lembrete. */
export interface ChatActionReminderDelete extends ActionBase {
  kind: 'lembrete-apagar'
  taskId: string
  text: string
  /** ISO 8601. */
  at: string
  error: string | null
}

/**
 * Contrato 76: `instagram-rascunho`, a legenda proposta para uma conta do Instagram conectada (a conta resolvida pelo app:
 * a única, ou a nomeada). "Criar rascunho" põe o rascunho, sem mídia, na fila da conta e abre o editor em Redes; nada é
 * publicado nem agendado daqui. A legenda acima dos limites do Instagram vira cartão com o contador marcando o problema.
 */
export interface ChatActionInstagramDraft extends ActionBase {
  kind: 'instagram-rascunho'
  /** O id da conta (`RedesAccount.id`). */
  accountId: string
  /** O @ da conta, lido do app (sem o "@"). */
  username: string
  caption: string
  /** A data proposta para publicar (ISO 8601), ou `null`: no rascunho ela é só planejada. */
  at: string | null
  /** O rascunho criado (`Publication.id`), depois do clique. */
  publicationId: string | null
}

/** Contrato 117: um contato do cartão de criar oportunidade; `contatoId`: o contato do funil com esse e-mail. */
export interface ChatActionFunilContato {
  nome: string
  email: string | null
  contatoId: string | null
}

/**
 * Contrato 117: `oportunidade-criar`. A etapa resolvida entre as abertas (sem etapa, a primeira), o valor em centavos e os
 * contatos ligados pelo e-mail aos que já existem. Os campos se editam no cartão; "Criar" grava pelo serviço do funil.
 */
export interface ChatActionOportunidadeCriar extends ActionBase {
  kind: 'oportunidade-criar'
  titulo: string
  /** O nome da empresa (achada pelo nome ou criada no clique). */
  empresa: string | null
  contatos: ChatActionFunilContato[]
  etapaId: string
  /** As etapas abertas quando o cartão foi montado (o seletor do cartão). */
  etapas: { id: string; nome: string }[]
  /** Centavos. */
  valor: number | null
  /** `AAAA-MM-DD`. */
  previsao: string | null
  proximoPasso: { texto: string; data: string | null } | null
  /** A oportunidade criada, depois do clique. */
  oportunidadeId: string | null
  error: string | null
}

/** Contrato 117: `oportunidade-mover`. `de` e `para` são os nomes das etapas, lidos do funil. Para Perdido, a nota é o motivo. */
export interface ChatActionOportunidadeMover extends ActionBase {
  kind: 'oportunidade-mover'
  oportunidadeId: string
  titulo: string
  de: string
  paraEtapaId: string
  para: string
  nota: string | null
  error: string | null
}

/**
 * Contrato 117: `oportunidade-proximo-passo`. Contrato 127 (R17): o clique cria uma tarefa ligada à oportunidade; o passo
 * de antes (`anterior`) não aparece mais no cartão e sai `null` nos novos.
 */
export interface ChatActionOportunidadeProximoPasso extends ActionBase {
  kind: 'oportunidade-proximo-passo'
  oportunidadeId: string
  titulo: string
  texto: string
  /** `AAAA-MM-DD`. */
  data: string | null
  anterior: { texto: string; data: string | null } | null
  error: string | null
}

/**
 * Contrato 117: `contato-criar`. Com o e-mail ou o telefone de um contato que já existe, `existenteId` e `existenteNome`:
 * o clique completa esse contato (R4) em vez de criar outro.
 */
export interface ChatActionContatoCriar extends ActionBase {
  kind: 'contato-criar'
  nome: string
  email: string | null
  telefone: string | null
  empresa: string | null
  cargo: string | null
  existenteId: string | null
  existenteNome: string | null
  /** O contato criado ou completado, depois do clique. */
  contatoId: string | null
  error: string | null
}

/**
 * Contrato 127 (R28): `tarefa-criar`. A oportunidade e o contato resolvidos pelo nome no funil do app; nenhum ou mais de um
 * com o nome vira `ambiguo` (o cartão pede a escolha). `lembreteEm` `null`: o lembrete padrão do prazo. `tarefaId`: a
 * tarefa criada, depois do clique.
 */
export interface ChatActionTarefaCriar extends ActionBase {
  kind: 'tarefa-criar'
  titulo: string
  /** `AAAA-MM-DD`. */
  prazo: string | null
  /** Epoch ms. */
  lembreteEm: number | null
  oportunidade: { id: string; titulo: string } | null
  contato: { id: string; nome: string } | null
  ambiguo: { campo: 'oportunidade' | 'contato'; texto: string } | null
  /** O contato citado que também ficou por escolher quando a oportunidade já é o `ambiguo` (ausente nos demais). */
  ambiguoContato?: string | null | undefined
  tarefaId: string | null
  error: string | null
}

/** Contrato 127 (R28): `tarefa-concluir`, com o título lido das tarefas do app. */
export interface ChatActionTarefaConcluir extends ActionBase {
  kind: 'tarefa-concluir'
  tarefaId: string
  titulo: string
  error: string | null
}

/** Contrato 127 (R28): `tarefa-adiar`, com o prazo de antes para o "antes → depois". */
export interface ChatActionTarefaAdiar extends ActionBase {
  kind: 'tarefa-adiar'
  tarefaId: string
  titulo: string
  /** `AAAA-MM-DD`. */
  prazoAntes: string | null
  /** `AAAA-MM-DD`. */
  prazo: string
  error: string | null
}

/** Contrato 163: o que o cartão do agente de triagem faz no clique. */
export const TRIAGEM_AGENTE_ACOES = ['criar', 'editar', 'pausar', 'retomar'] as const
export type TriagemAgenteAcao = (typeof TRIAGEM_AGENTE_ACOES)[number]
/**
 * `ja-existe`: o "criar" virou "editar"; `sem-agente`: não há agente para editar, pausar ou retomar; `desligado`: o
 * interruptor das Configurações; `agendamentos-pausados`: a pausa geral das Automações (retomar o agente não basta).
 */
export const TRIAGEM_AGENTE_AVISOS = ['ja-existe', 'sem-agente', 'desligado', 'agendamentos-pausados'] as const
export type TriagemAgenteAviso = (typeof TRIAGEM_AGENTE_AVISOS)[number]
/** Contrato 163: os primeiros caracteres das instruções que o cartão guarda (mais o "…"). */
export const TRIAGEM_INSTRUCOES_PREVIEW = 140

/**
 * Contrato 163: `triagem-agente`, criar, editar, pausar ou retomar o agente "Triagem do WhatsApp" e a tarefa dele. `agente`
 * e `tarefa` são os de agora, lidos das Automações (`null`: não existe; o cartão mostra os valores do modelo pronto);
 * `pedido` é o que o modelo pediu para mudar (`null`: fica como está). As instruções não aparecem no cartão.
 */
export interface ChatActionTriagemAgente extends ActionBase {
  kind: 'triagem-agente'
  acao: TriagemAgenteAcao
  agente: { id: string; nome: string; modelo: AgentModel } | null
  tarefa: { id: string; esperaSeg: number; grupos: boolean; enabled: boolean } | null
  pedido: { instrucoes: string | null; esperaSeg: number | null; grupos: boolean | null }
  permissoes: string[]
  instrucoesPreview: string
  avisos: TriagemAgenteAviso[]
  error: string | null
}

/**
 * Contrato 163: `triagem-etiqueta`, a escolha do dono numa conversa (o mesmo `set` da tela do WhatsApp). `chat` lido do
 * app (`null`: a conversa não existe e o botão fica desabilitado); `antes`, a etiqueta de agora; `depois`, a prévia;
 * `pedido`, os eixos pedidos (`null`: não mexe; `ambito: 'nenhum'` limpa o âmbito).
 */
export interface ChatActionTriagemEtiqueta extends ActionBase {
  kind: 'triagem-etiqueta'
  chatId: string
  chat: { id: string; name: string; kind: 'person' | 'group' } | null
  antes: Etiqueta | null
  depois: { urgente: boolean; ambito: TriagemAmbito | null }
  pedido: { urgente: boolean | null; ambito: TriagemAmbito | 'nenhum' | null }
  avisos: 'conversa-nao-encontrada'[]
  error: string | null
}

export type ChatAction =
  | ReminderAction
  | WhatsAppReplyAction
  | TaskAction
  | OpenAction
  | EmailListAction
  | EmailReplyAction
  | EmailBatchAction
  | ChatActionEvent
  | ChatActionReminderEdit
  | ChatActionReminderDelete
  | ChatActionInstagramDraft
  | ChatActionOportunidadeCriar
  | ChatActionOportunidadeMover
  | ChatActionOportunidadeProximoPasso
  | ChatActionContatoCriar
  | ChatActionTarefaCriar
  | ChatActionTarefaConcluir
  | ChatActionTarefaAdiar
  | ChatActionTriagemAgente
  | ChatActionTriagemEtiqueta

/** Contrato 117: os cartões do funil (o canal `scribe:chat-action-funil` executa pelo tipo gravado). */
export type ChatActionFunil = ChatActionOportunidadeCriar | ChatActionOportunidadeMover | ChatActionOportunidadeProximoPasso | ChatActionContatoCriar
export const FUNIL_ACTION_KINDS = ['oportunidade-criar', 'oportunidade-mover', 'oportunidade-proximo-passo', 'contato-criar'] as const satisfies readonly ChatActionFunil['kind'][]

/** Contrato 127 (D14): os cartões das tarefas (o canal `scribe:chat-action-tarefa` executa pelo tipo gravado). */
export type ChatActionTarefa = ChatActionTarefaCriar | ChatActionTarefaConcluir | ChatActionTarefaAdiar
export const TAREFA_ACTION_KINDS = ['tarefa-criar', 'tarefa-concluir', 'tarefa-adiar'] as const satisfies readonly ChatActionTarefa['kind'][]

/** Contrato 163: os cartões da triagem (o canal `scribe:chat-action-triagem` executa pelo tipo gravado). */
export type ChatActionTriagem = ChatActionTriagemAgente | ChatActionTriagemEtiqueta
export const TRIAGEM_ACTION_KINDS = ['triagem-agente', 'triagem-etiqueta'] as const satisfies readonly ChatActionTriagem['kind'][]

/** Qual cartão de qual resposta. */
export interface ChatActionRef {
  chatId: string
  /** Posição da resposta na conversa. */
  index: number
  actionId: string
}

/** "Criar lembrete" (com a data e o texto do "Editar", quando mudaram). */
export interface ChatActionReminderRequest extends ChatActionRef {
  at?: string | undefined
  text?: string | undefined
}

/** Contrato 78: o que o "Editar" do cartão de evento mudou (o main confere de novo com as mesmas regras). */
export interface ChatActionEventFields {
  title?: string | undefined
  start?: string | undefined
  end?: string | undefined
  allDay?: boolean | undefined
  location?: string | null | undefined
  notes?: string | null | undefined
}

/** Contrato 78: "Pôr na agenda" (e "Tentar de novo"), na agenda escolhida no cartão. */
export interface ChatActionEventRequest extends ChatActionRef {
  calendarId: string
  fields?: ChatActionEventFields | undefined
}

/** Contrato 78: "Salvar" (`update`, com a hora e o texto do "Editar") e "Apagar lembrete" (`delete`). */
export interface ChatActionReminderChangeRequest extends ChatActionRef {
  op: 'update' | 'delete'
  at?: string | undefined
  text?: string | undefined
}

/** Contrato 76: "Criar rascunho", com a legenda e a data do "Editar" (`at: null` tira a data proposta). */
export interface ChatActionInstagramDraftRequest extends ChatActionRef {
  caption?: string | undefined
  at?: string | null | undefined
}

/** Contrato 117: o que o cartão de criar oportunidade mudou antes do clique (o main confere de novo com as mesmas regras). */
export interface ChatActionOportunidadeCampos {
  titulo?: string | undefined
  empresa?: string | null | undefined
  etapaId?: string | undefined
  /** Centavos. */
  valor?: number | null | undefined
  previsao?: string | null | undefined
  proximoPasso?: { texto: string; data: string | null } | null | undefined
  contatos?: ChatActionFunilContato[] | undefined
}

/** Contrato 117: "Mover", "Criar" e "Salvar" num cartão do funil (`campos`: só no de criar oportunidade). */
export interface ChatActionFunilRequest extends ChatActionRef {
  campos?: ChatActionOportunidadeCampos | undefined
}

/** Contrato 127: o que o "Editar" do cartão de criar tarefa mudou (o main confere de novo com as regras do 121). */
export interface ChatActionTarefaCampos {
  titulo?: string | undefined
  /** `AAAA-MM-DD`. */
  prazo?: string | null | undefined
  /** Epoch ms; `null`: o lembrete padrão do prazo. */
  lembreteEm?: number | null | undefined
  oportunidadeId?: string | null | undefined
  contatoId?: string | null | undefined
}

/** Contrato 127 (D14): "Criar", "Concluir" e "Adiar" num cartão das tarefas (`campos`: só no de criar). */
export interface ChatActionTarefaRequest extends ChatActionRef {
  campos?: ChatActionTarefaCampos | undefined
}

/** Contrato 163: "Criar agente", "Salvar", "Pausar", "Retomar" e "Aplicar" nos cartões da triagem (nada a editar). */
export type ChatActionTriagemRequest = ChatActionRef

/**
 * Estado depois do clique que não cria nada no main: "Descartar"; "Enviar" que já passou pelo contrato 24 (`sent`,
 * com o texto que foi; contrato 45: também o email, depois do `emailSend`); a tarefa salva no formulário das
 * Automações (`task-created`).
 */
export interface ChatActionStateRequest extends ChatActionRef {
  state: 'dismissed' | 'sent' | 'task-created'
  text?: string | undefined
}

/** `done`: o cartão já tinha sido usado (recarregar a conversa não repete a ação). */
export type ChatActionResult = { ok: true; chat: Chat } | { ok: false; error: 'missing' | 'invalid' | 'past' | 'done' | 'full' }

const two = (value: number): string => String(value).padStart(2, '0')

/** "ter 17/11 09:00" no fuso. */
export function reminderWhen(at: string, timeZone: string): string {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? at : formatRunAt(ms, timeZone)
}

/** "hoje", "amanhã" ou `null`, no fuso. */
export function relativeDay(at: string, now: number, timeZone: string): string | null {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return null
  const day = (value: number): number => {
    const wall = wallTime(value, timeZone)
    return Date.UTC(wall.year, wall.month - 1, wall.day)
  }
  const diff = Math.round((day(ms) - day(now)) / 86_400_000)
  return diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : null
}

/** Título do cartão: "Lembrete · ter 17/11 09:00 (amanhã) · Responder Fulano". */
export function reminderTitle(action: Pick<ReminderAction, 'at' | 'text'>, now: number, timeZone: string): string {
  const relative = relativeDay(action.at, now, timeZone)
  return `Lembrete · ${reminderWhen(action.at, timeZone)}${relative ? ` (${relative})` : ''} · ${action.text}`
}

/** "Lembrete criado · ter 17/11 09:00". */
export function reminderCreatedText(at: string, timeZone: string): string {
  return `Lembrete criado · ${reminderWhen(at, timeZone)}`
}

/** Contrato 78: "sex 20/11 · 20:00–21:00", "sex 20/11 · dia inteiro" ou, em dias diferentes, "sex 20/11 22:00 – sáb 21/11 01:00". */
export function eventWhen(event: Pick<ChatActionEvent, 'start' | 'end' | 'allDay'>, timeZone: string): string {
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return event.start
  const day = formatRunAt(start, timeZone).slice(0, -6)
  if (event.allDay) return `${day} · dia inteiro`
  const from = wallTime(start, timeZone)
  const to = wallTime(end, timeZone)
  if (from.year === to.year && from.month === to.month && from.day === to.day) return `${day} · ${two(from.hour)}:${two(from.minute)}–${two(to.hour)}:${two(to.minute)}`
  return `${formatRunAt(start, timeZone)} – ${formatRunAt(end, timeZone)}`
}

/** Contrato 78: "Evento criado · sex 20/11 20:00 · Pessoal" (no dia inteiro, "sex 20/11 (dia inteiro)"). */
export function eventCreatedText(event: Pick<ChatActionEvent, 'start' | 'allDay'>, calendarTitle: string, timeZone: string): string {
  const start = Date.parse(event.start)
  const when = Number.isNaN(start) ? event.start : event.allDay ? `${formatRunAt(start, timeZone).slice(0, -6)} (dia inteiro)` : formatRunAt(start, timeZone)
  return `Evento criado · ${when} · ${calendarTitle}`.slice(0, 200)
}

/** Contrato 78: o evento igual que o "Tentar de novo" achou na agenda (o `create` anterior tinha gravado). */
export function eventAlreadyText(event: Pick<ChatActionEvent, 'start' | 'allDay'>, calendarTitle: string, timeZone: string): string {
  return eventCreatedText(event, calendarTitle, timeZone).replace(/^Evento criado/, 'Evento já estava na agenda').slice(0, 200)
}

/** Contrato 78: "Lembrete alterado · qua 18/11 09:00". */
export function reminderChangedText(at: string, timeZone: string): string {
  return `Lembrete alterado · ${reminderWhen(at, timeZone)}`
}

export const REMINDER_DELETED_TEXT = 'Lembrete apagado'
/** Contrato 117 (R42): as razões de um cartão do funil que já nasce `failed` (o texto exato da spec). */
export const FUNIL_OPORTUNIDADE_NAO_ENCONTRADA = 'oportunidade não encontrada'
export const FUNIL_ETAPA_NAO_ENCONTRADA = 'etapa não encontrada'
export const FUNIL_CONTATO_SEM_CANAL = 'Informe um e-mail ou telefone'
/** Contrato 117: o cartão do funil depois do clique. */
export const FUNIL_OPORTUNIDADE_CRIADA_TEXT = 'Oportunidade criada'
export const FUNIL_PASSO_SALVO_TEXT = 'Próximo passo salvo'
export const FUNIL_CONTATO_CRIADO_TEXT = 'Contato criado'
export const FUNIL_CONTATO_COMPLETADO_TEXT = 'Contato completado'
/** Contrato 117: "Movida para Negociação". */
export const funilMovidaText = (para: string): string => `Movida para ${para}`.slice(0, 200)
/** Contrato 76: o cartão do rascunho depois do clique. */
export const INSTAGRAM_DRAFT_CREATED_TEXT = 'Rascunho criado · abra em Redes'
/** Contrato 78: o lembrete sumiu entre a proposta e o clique. Contrato 127: a tarefa dele foi concluída ou apagada. */
export const REMINDER_GONE_TEXT = 'Esse lembrete não existe mais: a tarefa foi concluída ou apagada.'
/** Contrato 127 (R28, D-13): o id que não casa com exatamente uma tarefa aberta, ou a tarefa que fechou antes do clique. */
export const TAREFA_GONE_TEXT = 'Essa tarefa não existe mais'
/** Contrato 127 (R17): o cartão do próximo passo numa oportunidade ganha ou perdida. */
export const OPORTUNIDADE_FECHADA_TEXT = 'A oportunidade está fechada'
/** Contrato 127: o clique em "Criar" com a oportunidade (ou o contato) ainda por escolher. */
export const TAREFA_ESCOLHA_OPORTUNIDADE_TEXT = 'Escolha a oportunidade antes de criar.'
export const TAREFA_ESCOLHA_CONTATO_TEXT = 'Escolha o contato antes de criar.'
/** Contrato 127: "Tarefa criada: Mandar proposta". */
export const tarefaCriadaText = (titulo: string): string => `Tarefa criada: ${titulo}`.slice(0, 200)
/** Contrato 127 (R17): o passo que já era uma tarefa aberta com outro prazo; o prazo dela mudou. */
export const tarefaPrazoAtualizadoText = (titulo: string): string => `Prazo da tarefa atualizado: ${titulo}`.slice(0, 200)
/** Contrato 127 (R17): o passo que já era uma tarefa aberta com o mesmo prazo; nada mudou. */
export const tarefaJaExistiaText = (titulo: string): string => `A tarefa já existia: ${titulo}`.slice(0, 200)
/** Contrato 127: "Tarefa concluída: Mandar proposta". */
export const tarefaConcluidaText = (titulo: string): string => `Tarefa concluída: ${titulo}`.slice(0, 200)
/** Contrato 127: "Adiada para 27/11", de `AAAA-MM-DD`. */
export const tarefaAdiadaText = (prazo: string): string => `Adiada para ${prazo.slice(8, 10)}/${prazo.slice(5, 7)}`

/** Contrato 163: os cartões da triagem depois do clique. */
export const TRIAGEM_AGENTE_RESULT: Readonly<Record<TriagemAgenteAcao, string>> = {
  criar: 'Agente de triagem criado',
  editar: 'Agente de triagem atualizado',
  pausar: 'Agente de triagem pausado',
  retomar: 'Agente de triagem retomado',
}
/** O "criar" de um agente que já existia, sem nada a mudar (ou com os mesmos valores). */
export const TRIAGEM_JA_EXISTIA_TEXT = 'O agente de triagem já existia; nada mudou.'
/** O "retomar" com a pausa geral dos agendamentos: a tarefa volta a ligar, o motor segue parado. */
export const TRIAGEM_RETOMADO_PAUSADOS_TEXT = 'Agente de triagem retomado; os agendamentos continuam pausados.'
export const TRIAGEM_SEM_AGENTE_TEXT = 'Não há agente de triagem. Peça para criar o agente primeiro.'
export const TRIAGEM_CONVERSA_NAO_ENCONTRADA_TEXT = 'Essa conversa não está no WhatsApp conectado.'
/** "Etiqueta aplicada: Urgente · Profissional", ou "Etiqueta limpa" sem etiqueta nenhuma. */
export const triagemEtiquetaText = (chips: readonly string[]): string => (chips.length ? `Etiqueta aplicada: ${chips.join(' · ')}` : 'Etiqueta limpa')

/** "Enviada às 19:40", na hora local. */
export function sentText(at: number): string {
  const date = new Date(at)
  return `Enviada às ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Contrato 45: "Enviado às 19:40" (o email), na hora local. */
export function emailSentText(at: number): string {
  const date = new Date(at)
  return `Enviado às ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Contrato 45: mensagens num cartão `emails`; as a mais ficam de fora do cartão. */
export const EMAIL_CARD_ITEMS_MAX = 10

export const DISMISSED_TEXT = 'Descartado'
export const TASK_CREATED_TEXT = 'Agendamento criado'

/**
 * Número de uma conversa a partir do id (`5511911110000@s.whatsapp.net` -> "+55 11 91111-0000"); grupo e id
 * `@lid` não têm número.
 */
export function phoneOfChatId(chatId: string): string | null {
  const match = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(chatId)
  const digits = match?.[1]
  if (!digits) return null
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits)
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`
  return `+${digits}`
}

/** "Abrir <tela>" com o nome do alvo. */
export function openLabel(screen: OpenScreen, targetName: string | null): string {
  if (screen === 'reuniao') return targetName ? `Abrir «${targetName}»` : 'Abrir a reunião'
  if (screen === 'whatsapp' && targetName) return `Abrir a conversa com ${targetName}`
  if (screen === 'configuracoes' && targetName) return `Abrir Configurações › ${targetName}`
  if (screen === 'automacoes' && targetName) return `Abrir Automações › ${targetName}`
  // Contrato 117.
  if (screen === 'oportunidade' && targetName) return `Abrir «${targetName}»`
  if (screen === 'contato' && targetName) return `Abrir o contato ${targetName}`
  // Contrato 127.
  if (screen === 'tarefa' && targetName) return `Abrir a tarefa «${targetName}»`
  return `Abrir ${OPEN_SCREEN_LABELS[screen]}`
}

/**
 * Resposta com erro, parada ou estourada no tempo (contrato 25): nenhum bloco de ação fica no texto gravado, nem
 * inteiro nem pela metade (o cartão só nasce de uma resposta que terminou).
 */
export function withoutActionBlocks(text: string): string {
  let rest = text
  // Contrato 45: o pedido de ferramenta também nunca fica no texto gravado.
  for (const fence of [ACTION_FENCE, TOOL_FENCE]) {
    const whole = new RegExp(`(^|\\n)[ \\t]*\`\`\`${fence}[ \\t]*\\n[\\s\\S]*?\\n[ \\t]*\`\`\`[ \\t]*(?=\\n|$)`, 'g')
    rest = rest.replace(whole, '$1')
  }
  return withoutPendingActions(rest)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Na resposta em curso, o bloco de ação (ou o pedido de ferramenta) ainda pela metade não aparece: o texto para no começo da cerca. */
export function withoutPendingActions(text: string): string {
  const found = [ACTION_FENCE, TOOL_FENCE].map((fence) => text.indexOf(`\`\`\`${fence}`)).filter((at) => at !== -1)
  return found.length ? text.slice(0, Math.min(...found)).trimEnd() : text
}
