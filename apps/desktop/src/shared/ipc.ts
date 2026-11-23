// Contrato das mensagens entre main e renderer. Canal novo entra aqui primeiro: no mapa do
// sentido certo e na lista de canais permitidos logo abaixo (o preload recusa o que não estiver nela).
import type { AcpAgentStatus } from './acp'
import type { ChatActionEventRequest, ChatActionFunilRequest, ChatActionInstagramDraftRequest, ChatActionReminderChangeRequest, ChatActionReminderRequest, ChatActionResult, ChatActionStateRequest, ChatActionTarefaRequest } from './assistant'
import type { AgentDeleteResult, AgentInput, AgentSaveResult, AgentsList, AutomationEvent, AutomationRun, AutomationRunListItem, AutomationsStatus, RunStartResult, RunStatus, ScheduledTask, TaskInput, TaskSaveResult } from './automations'
import type { DriveMeetingStatus, GoogleAccountStatus, GoogleClientSaveResult, MicrosoftAccountStatus, MicrosoftClientSaveResult } from './accounts'
import type { CalendarListResult, CalendarView } from './calendar'
import type { BrandingInfo, BrandLogoChoice } from './branding'
import type { LockResponse, LockStatus } from './lock'
import type { EmailAccountInput, EmailAccountStatus, EmailAddResult, EmailAttachmentRequest, EmailAttachmentSaveResult, EmailAttachmentsResult, EmailAttachPickResult, EmailAutoconfig, EmailBodyResult, EmailFolder, EmailFolderDeleteResult, EmailFolderPathResult, EmailFoldersResult, EmailMessage, EmailMoveResult, EmailOpenFolderResult, EmailSendRequest, EmailSendResult, EmailTestResult, InviteReplySendRequest, InviteReplySendResult } from './email'
import type { EmailSignature, EmailSignatureResult } from './email-signature'
import type { InviteAccessResult, InviteActionResult, InviteAddRequest, InviteCalendarsResult, InviteMessageRequest, InviteOpenIcsResult, InviteStateResult } from './invite-state'
import type { InviteSuggestAddRequest, InviteSuggestAddResult, InviteSuggestRequest, InviteSuggestResult } from './invite-suggest'
import type { EmailRule, EmailRulePreviewResult, EmailRuleRunResult, EmailRulesGetResult, EmailRulesSetResult } from './email-rules'
import type { EmailBatchGetResult, EmailBatchUndoResult, EmailOrganizeEvent, EmailOrganizeStateResult } from './email-organize'
import type { KeySaveResult, KeyStatus, MicAccess, ModelCheck, ModelsResult } from './assemblyai'
import type { Chat, ChatApprovalAnswer, ChatEvent, ChatListItem, ChatRedoRequest, ChatSendRequest, ChatSendResult, ChatUpdateRequest } from './chat'
import type { ClaudeLocateResult, ClaudeRunState, ClaudeStartResult, ClaudeTranslateRequest, ClaudeTranslateResult } from './claude-cli'
import type { AudioBeginResult, AudioExtension, AudioFinishResult, AudioFolderInfo, MeetingDownloadKind, MeetingDownloadResult, MeetingFileKind, MeetingFilesInfo } from './meeting-files'
import type { MeetState } from './meet'
import type { MeetingPromptAction, MeetingPromptState } from './meeting-prompt'
import type { NavegadorState } from './navegador'
import type { AppPluginId, PluginSaveResult } from './plugins'
import type { ClaudeConnectorTools, McpChatServer, McpCliDetails, McpOverview, McpSaveResult, McpServerInput, McpTestResult, McpToolPolicy, McpUse } from './mcp'
import type { AiNotesRunRequest, AiNotesRunResult } from './ai-notes'
// 110: funil
import type { ContatoInput, ContatoOrigem, EmpresaInput, EtapaInput, FunilActionResult, FunilFalha, FunilImportAbrirResult, FunilImportConfirmarResult, FunilTimelineResult, FunilView, OportunidadeInput, Sugestao } from './funil'
import type { CampoImport } from './funil-import'
// fim 110
// 113: proposta do funil
import type { FunilPropostaAplicarRequest, FunilPropostaAplicarResult, FunilPropostaRecusa, FunilPropostaView } from './funil-proposta'
// fim 113
// 122: tarefas
import type { SugestaoTarefa, TarefaInput, TarefaSalvar, TarefasActionResult, TarefasFalha, TarefasResumoResult, TarefaStatus, TarefasView } from './tarefas'
// fim 122
// 134: inicio
import type { InicioAtualizarResult, InicioView } from './inicio'
// fim 134
// 138: atendimento
import type {
  AtendimentoAgentInput,
  AtendimentoAgentSaveResult,
  AtendimentoAgentTestRequest,
  AtendimentoAgentTestResult,
  AtendimentoBindingInput,
  AtendimentoBindingSaveResult,
  AtendimentoDraftDiscardResult,
  AtendimentoDraftSendRequest,
  AtendimentoDraftSendResult,
  AtendimentoFailure,
  AtendimentoLogListRequest,
  AtendimentoLogListResult,
  AtendimentoResult,
  AtendimentoRuntime,
  AtendimentoState,
} from './atendimento'
// fim 138
import type { AnalysisRunRequest, AnalysisRunResult, MeetingAnalysis } from './meeting-analysis'
import type { MeetingNote } from './meeting-notes'
import type { SummaryStatus } from './meeting-summary'
import type { Meeting, MeetingFolder, NewMeeting } from './meetings'
import type { MeetingOverview, MeetingSearchResult } from './meetings-overview'
import type {
  MediaCandidate,
  MediaHostConfig,
  MediaHostSaveResult,
  MediaHostStatus,
  PublicationActionResult,
  PublicationQuotaResult,
  PublicationSaveInput,
  PublicationSaveResult,
  RedesConnectResult,
  RedesPublicationsPayload,
  RedesState,
} from './redes'
// 73: comentários
import type { RedesCommentActionResult, RedesCommentReplyResult, RedesCommentsPayload } from './redes'
// fim 73
// 75: métricas
import type { MetricPeriod, RedesMetricsState } from './redes'
// fim 75
// 74: mensagens
import type { RedesMessageSendResult, RedesMessagesPayload } from './redes'
// fim 74
import type { RouteId, SettingsTab } from './routes'
import type { AppSettings, SettingsPatch } from './settings-defaults'
import type { TranscriptCopyResult, TranscriptDocument, TranslateTurnResult, TranscriptionTokenResult } from './transcription'
import type { UpdateState } from './updates'
import type { WhatsAppInsightsResult, WhatsAppInsightsState } from './whatsapp-insights'
import type {
  WhatsAppChat,
  WhatsAppDraftRequest,
  WhatsAppDraftResult,
  WhatsAppError,
  WhatsAppMediaRequest,
  WhatsAppMediaResult,
  WhatsAppMeetingLink,
  WhatsAppMessage,
  WhatsAppPairing,
  WhatsAppPresence,
  WhatsAppReactRequest,
  WhatsAppReactResult,
  WhatsAppReaction,
  WhatsAppSearchHit,
  WhatsAppSendRequest,
  WhatsAppSendResult,
  WhatsAppStatus,
  WhatsAppTranscribeRequest,
  WhatsAppTranscribeResult,
} from './whatsapp'
import type { WhatsAppAttachPickResult, WhatsAppSendMediaRequest, WhatsAppSendMediaResult } from './whatsapp-attach'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
}

export interface CspViolation {
  directive: string
  blockedUri: string
  sourceFile: string
}

/**
 * De onde vem o áudio da gravação. `synthetic` (sinal gerado, sem microfone nem áudio do sistema)
 * só existe no smoke: o main decide pelo argumento `--smoke`, nunca o renderer.
 */
export type CaptureMode = 'real' | 'synthetic'

/** Painéis de privacidade dos Ajustes do Sistema que o app abre. */
export type PrivacyPane = 'microphone' | 'audio-capture' | 'calendars'

/** renderer -> main, com resposta (`__scribeApi.invoke` / `ipcMain.handle`). */
export interface InvokeChannels {
  'scribe:app-info': { request: undefined; response: AppInfo }
  'scribe:capture-mode': { request: undefined; response: CaptureMode }
  'scribe:meetings-list': { request: undefined; response: Meeting[] }
  'scribe:meetings-get': { request: { id: string }; response: Meeting | null }
  'scribe:meetings-create': { request: NewMeeting; response: Meeting }
  'scribe:meetings-rename': { request: { id: string; title: string }; response: Meeting | null }
  'scribe:meetings-delete': { request: { id: string }; response: boolean }
  /** Tela de Reuniões (contrato 10): cada reunião com a prévia e o estado do resumo, numa chamada só. */
  'scribe:meetings-overview': { request: undefined; response: MeetingOverview[] }
  /** Busca no main, em título, transcrição e resumo; termo de 2 a 100 caracteres. Nada sai do Mac. */
  'scribe:meetings-search': { request: { term: string }; response: MeetingSearchResult[] }
  /** Pastas de reuniões (contrato 28): só organizam a lista; nome com até 60 caracteres, vazio não cria. */
  'scribe:folders-list': { request: undefined; response: MeetingFolder[] }
  'scribe:folders-create': { request: { name: string }; response: MeetingFolder | null }
  'scribe:folders-rename': { request: { id: string; name: string }; response: MeetingFolder | null }
  /** As reuniões da pasta ficam fora de pasta; nenhuma é apagada. */
  'scribe:folders-delete': { request: { id: string }; response: boolean }
  /** `folderId` `null` tira da pasta; pasta inexistente devolve `null`. */
  'scribe:meetings-move': { request: { id: string; folderId: string | null }; response: Meeting | null }
  'scribe:settings-get': { request: undefined; response: AppSettings }
  'scribe:settings-update': { request: SettingsPatch; response: AppSettings }
  /** Só o estado da chave; nenhum canal devolve a chave. */
  'scribe:key-status': { request: undefined; response: KeyStatus }
  'scribe:key-save': { request: { key: string }; response: KeySaveResult }
  /** "Tentar de novo": confere outra vez a chave já salva. */
  'scribe:key-verify': { request: undefined; response: KeySaveResult }
  'scribe:key-remove': { request: undefined; response: KeyStatus }
  'scribe:models-list': { request: undefined; response: ModelsResult }
  /** Confere o modelo no gateway e, se liberado, grava `translationModel`. */
  'scribe:model-select': { request: { id: string }; response: { check: ModelCheck; settings: AppSettings } }
  'scribe:mic-access': { request: undefined; response: MicAccess }
  /** "Permitir": pede o microfone ao macOS. */
  'scribe:mic-access-request': { request: undefined; response: MicAccess }
  /** Token temporário de streaming; a chave fica no main (CA1). */
  'scribe:transcription-token': { request: undefined; response: TranscriptionTokenResult }
  /** Salva a transcrição ao encerrar, em `meetings/<id>.json` (CA12). */
  'scribe:transcript-save': { request: { document: TranscriptDocument }; response: boolean }
  'scribe:transcript-get': { request: { meetingId: string }; response: TranscriptDocument | null }
  /** "Copiar transcrição": o main monta o Markdown e escreve na área de transferência (CA12). */
  'scribe:transcript-copy': { request: { meetingId: string }; response: TranscriptCopyResult }
  /** Anotações da reunião (contrato 13), de `meetings/<id>.notes.json`; arquivo inválido = lista vazia. */
  'scribe:notes-get': { request: { meetingId: string }; response: MeetingNote[] }
  /** Grava a lista inteira de anotações; falso quando a reunião não existe. */
  'scribe:notes-save': { request: { meetingId: string; notes: MeetingNote[] }; response: boolean }
  /** "Copiar anotações": o main monta o Markdown e escreve na área de transferência. */
  'scribe:notes-copy': { request: { meetingId: string }; response: TranscriptCopyResult }
  /** Tradução avulsa de um trecho quando o gateway não respondeu na conexão (CA9). */
  'scribe:translate-turn': {
    request: { text: string; source: AppSettings['sourceLanguage']; target: AppSettings['targetLanguage']; model: string }
    response: TranslateTurnResult
  }
  /** Onde está o `claude` e qual versão respondeu (contrato 05). */
  'scribe:claude-locate': { request: undefined; response: ClaudeLocateResult }
  /** Agente do Claude pelo ACP (contrato 17): estado, instalar (só com o clique) e remover. */
  'scribe:acp-status': { request: undefined; response: AcpAgentStatus }
  'scribe:acp-install': { request: undefined; response: AcpAgentStatus }
  'scribe:acp-remove': { request: undefined; response: AcpAgentStatus }
  /** Caminho escolhido em Configurações; só grava se o `claude` responder ali. `null` volta a procurar sozinho. */
  'scribe:claude-path-set': { request: { path: string | null }; response: { result: ClaudeLocateResult; settings: AppSettings } }
  /** Início da gravação com o motor Claude CLI: abre (aquece) o processo. */
  'scribe:claude-start': { request: undefined; response: ClaudeStartResult }
  /** Um trecho final; a resposta é a tradução daquele trecho. */
  'scribe:claude-translate': { request: ClaudeTranslateRequest; response: ClaudeTranslateResult }
  /** Encerrar a gravação: espera a fila por até 5 s e fecha o processo. */
  'scribe:claude-stop': { request: undefined; response: boolean }
  /** Pasta dos arquivos da reunião (contrato 07), com o caminho encurtado para a tela. */
  'scribe:audio-folder': { request: undefined; response: AudioFolderInfo }
  /** "Escolher pasta…": diálogo nativo no main; só ele grava `audioFolder`. */
  'scribe:audio-folder-choose': { request: undefined; response: { chosen: boolean; folder: AudioFolderInfo; settings: AppSettings } }
  /** Início da gravação com "Salvar áudio e transcrição numa pasta": cria o `.part`. */
  'scribe:audio-begin': { request: { startedAt: string; title: string; extension: AudioExtension | null }; response: AudioBeginResult }
  /** Um pedaço de 5 s do gravador. */
  'scribe:audio-append': { request: { id: string; data: Uint8Array }; response: boolean }
  /** Encerrar: renomeia o `.part`, escreve o `.md` e grava os caminhos na reunião. */
  'scribe:audio-finish': { request: { id: string; meetingId: string }; response: AudioFinishResult }
  /** Arquivos da reunião para o detalhe; `null` quando ela não tem arquivo na pasta. */
  'scribe:meeting-files': { request: { meetingId: string }; response: MeetingFilesInfo | null }
  /** "Abrir": o arquivo no app padrão do Mac. O caminho sai do registro no main, nunca do renderer. */
  'scribe:meeting-file-open': { request: { meetingId: string; kind: MeetingFileKind }; response: boolean }
  /** "Mostrar no Finder". */
  'scribe:meeting-file-reveal': { request: { meetingId: string; kind: MeetingFileKind }; response: boolean }
  /** "Baixar…" (contrato 08): diálogo de salvar no main e cópia; a origem sai do registro, nunca do renderer. */
  'scribe:meeting-file-download': { request: { meetingId: string; kind: MeetingDownloadKind }; response: MeetingDownloadResult }
  /** Resumo da reunião (contrato 08): o que a aba "Resumo" mostra. */
  'scribe:summary-get': { request: { meetingId: string }; response: SummaryStatus }
  /**
   * "Gerar resumo" / "Gerar de novo", ou `auto` ao encerrar a gravação (só com "Resumir ao encerrar"
   * ligado e o `claude` encontrado). Responde na hora; o resultado chega por `scribe:summary-state`.
   */
  'scribe:summary-generate': { request: { meetingId: string; auto?: boolean }; response: SummaryStatus }
  /** "Copiar resumo": o main monta o Markdown e escreve na área de transferência. */
  'scribe:summary-copy': { request: { meetingId: string }; response: TranscriptCopyResult }
  /**
   * "Analisar até agora" na gravação (`live`, nada é gravado) ou "Analisar a reunião inteira" no detalhe
   * (`meetingId`, salva junto). Responde quando a análise acaba (até 90 s); só com o clique da pessoa.
   */
  'scribe:analysis-run': { request: AnalysisRunRequest; response: AnalysisRunResult }
  /** Análises salvas da reunião (contrato 19), de `meetings/<id>.analyses.json`; arquivo inválido = lista vazia. */
  'scribe:analyses-get': { request: { meetingId: string }; response: MeetingAnalysis[] }
  /** Encerrar a gravação: as análises da memória vão para a reunião criada; falso quando ela não existe. */
  'scribe:analyses-save': { request: { meetingId: string; analyses: MeetingAnalysis[] }; response: boolean }
  /** Análise da gravação que terminou depois do "Encerrar": entra na reunião já criada. */
  'scribe:analyses-add': { request: { meetingId: string; analysis: MeetingAnalysis }; response: boolean }
  /** "Copiar" de um item da análise: o main escreve o texto na área de transferência. */
  'scribe:analysis-copy': { request: { text: string }; response: boolean }
  /**
   * IA anotando ao vivo (contrato 30): um ciclo com os trechos novos e os cards abertos da IA; responde o lote (cards
   * novos e resolvidos) quando acaba, até 90 s. Nada é gravado: a tela aplica e "Encerrar" salva.
   */
  'scribe:ai-notes-run': { request: AiNotesRunRequest; response: AiNotesRunResult }
  /** "Encerrar" ou desligar "IA anotando": o ciclo em curso da gravação é cancelado (o processo morre). */
  'scribe:ai-notes-cancel': { request: { recordingId: string }; response: boolean }
  /** Marca do app (contrato 09): nome, subtítulo e o logo como data URL PNG, nunca um caminho. */
  'scribe:branding-get': { request: undefined; response: BrandingInfo }
  /** "Escolher imagem…": diálogo nativo no main; só ele confere, copia e grava `brandLogo`. */
  'scribe:brand-logo-choose': { request: undefined; response: { result: BrandLogoChoice; branding: BrandingInfo; settings: AppSettings } }
  /** "Usar o logo da LAP": apaga o logo próprio. */
  'scribe:brand-logo-reset': { request: undefined; response: { branding: BrandingInfo; settings: AppSettings } }
  /** Atualização pelo GitHub (contrato 14): versão atual, última verificação e versão nova, se houver. */
  'scribe:update-get': { request: undefined; response: UpdateState }
  /** "Procurar atualização": responde depois da consulta; erro e falta de internet não mudam nada. */
  'scribe:update-check': { request: undefined; response: UpdateState }
  /** "Atualizar" / "Baixar e instalar": o main baixa, confere e abre o `.dmg`; o andamento chega por `scribe:update-state`. */
  'scribe:update-download': { request: undefined; response: UpdateState }
  /** "Fechar o app agora", depois de abrir o `.dmg`. O renderer só oferece fora de uma gravação. */
  'scribe:update-quit': { request: undefined; response: boolean }
  /** Chat do "Assistente" (contratos 15 e 25): conversas da tela (`meetingId: null`) ou da aba de uma reunião. */
  'scribe:chat-list': { request: { meetingId: string | null }; response: ChatListItem[] }
  'scribe:chat-get': { request: { id: string }; response: Chat | null }
  /**
   * Uma pergunta (`chatId: null` abre uma conversa nova). Responde com a pergunta gravada; a resposta chega
   * por `scribe:chat-event`. Sem o `claude`, nada é gravado nem enviado.
   */
  'scribe:chat-send': { request: ChatSendRequest; response: ChatSendResult }
  /** "Parar": mata o processo; a resposta parcial é gravada como interrompida. */
  'scribe:chat-stop': { request: { id: string }; response: boolean }
  'scribe:chat-delete': { request: { id: string }; response: boolean }
  /** Renomear, trocar o escopo ou o modelo (contrato 16); a troca vale para a próxima pergunta. */
  'scribe:chat-update': { request: ChatUpdateRequest; response: Chat | null }
  /** "Refazer", "Tentar de novo" e ↑ para editar a última pergunta: a resposta chega por `scribe:chat-event`. */
  'scribe:chat-redo': { request: ChatRedoRequest; response: ChatSendResult }
  /** "Copiar" uma resposta: o main escreve o texto dela na área de transferência. */
  'scribe:chat-copy': { request: { id: string; index: number }; response: boolean }
  /**
   * Assistente (contrato 25, CA3): "Criar lembrete" num cartão, com a data e o texto do "Editar". Cria a tarefa "uma
   * vez" das Automações e grava o cartão como feito; cartão já usado devolve `done` (nada se repete).
   */
  'scribe:chat-action-reminder': { request: ChatActionReminderRequest; response: ChatActionResult }
  /**
   * O estado de um cartão depois do clique que não cria nada aqui: "Descartar"; "Enviar", depois que o envio passou
   * pelo `scribe:whatsapp-send` (o único caminho de envio); e a tarefa salva no formulário das Automações.
   */
  'scribe:chat-action-state': { request: ChatActionStateRequest; response: ChatActionResult }
  /**
   * Contrato 78: "Pôr na agenda" (e "Tentar de novo") no cartão de evento: grava no Calendário do Mac, na agenda escolhida,
   * com o que o "Editar" mudou (conferido de novo no main). Cartão já usado devolve `done`; erro do Calendário vira o
   * cartão `failed`, com a frase.
   */
  'scribe:chat-action-event': { request: ChatActionEventRequest; response: ChatActionResult }
  /** Contrato 78: "Salvar" no cartão de alterar um lembrete e "Apagar lembrete"; o lembrete que sumiu vira `failed`. */
  'scribe:chat-action-reminder-change': { request: ChatActionReminderChangeRequest; response: ChatActionResult }
  /**
   * Contrato 76: "Criar rascunho" no cartão do Instagram: põe o rascunho, sem mídia, na fila da conta (nunca publica nem
   * agenda) e manda `scribe:open-redes` a esta janela. Cartão já usado devolve `done`. O clique no cartão é a confirmação.
   */
  'scribe:chat-action-instagram-draft': { request: ChatActionInstagramDraftRequest; response: ChatActionResult }
  /**
   * Contrato 117 (D9): "Mover", "Criar" e "Salvar" nos cartões do funil, pelo tipo gravado (`campos`: o que o cartão de
   * criar oportunidade mudou, conferido de novo no main). Grava pelo serviço do funil; cartão já usado devolve `done`; o
   * que o funil recusa vira o cartão `failed`, com a frase.
   */
  'scribe:chat-action-funil': { request: ChatActionFunilRequest; response: ChatActionResult }
  /**
   * Contrato 127 (D14): "Criar", "Concluir" e "Adiar" nos cartões das tarefas, pelo tipo gravado (`campos`: o que o cartão
   * de criar tarefa mudou, conferido de novo no main). Grava pelo serviço das tarefas; cartão já usado devolve `done`; a
   * tarefa que fechou ou sumiu vira o cartão `failed`, com a frase.
   */
  'scribe:chat-action-tarefa': { request: ChatActionTarefaRequest; response: ChatActionResult }
  /** Contrato 21: "Permitir uma vez", "Sempre permitir esta ferramenta" ou "Negar" no cartão de uma ferramenta MCP. */
  'scribe:chat-approval': { request: ChatApprovalAnswer; response: boolean }
  /** Contrato 21: a linha "Conexões" do painel Contexto (os servidores MCP ligados para o chat). */
  'scribe:mcp-chat-servers': { request: undefined; response: McpChatServer[] }
  /**
   * Contrato 21: a aba "Conexões". Com `cli`, espera o `claude mcp list` (lido na hora; `refresh` relê). Nenhum valor de
   * segredo vem: só "•••• definido".
   */
  'scribe:mcp-overview': { request: { cli?: boolean; refresh?: boolean }; response: McpOverview }
  /** "Testar conexão" do formulário (`draft`) ou de um servidor da lista (`key`): `initialize` e `tools/list`, até 15 s. */
  'scribe:mcp-test': { request: { draft: McpServerInput } | { key: string }; response: McpTestResult }
  /** "Salvar" do formulário: no Claude CLI (`claude mcp add-json -s user`) ou só no app. Só depois de testar. */
  'scribe:mcp-save': { request: McpServerInput; response: McpSaveResult }
  /** Interruptor, usos e a política de uma ferramenta de um servidor (`app:<id>` ou `cli:<nome>`). */
  'scribe:mcp-update': { request: { key: string; enabled?: boolean; uses?: McpUse[]; tool?: string; policy?: McpToolPolicy }; response: McpOverview | null }
  /** "Remover": do app, ou do Claude CLI (`claude mcp remove -s user`) depois da confirmação na tela. */
  'scribe:mcp-remove': { request: { key: string }; response: McpSaveResult }
  /** "Ver detalhes" de um servidor do CLI (`claude mcp get`), com variáveis e cabeçalhos mascarados. */
  'scribe:mcp-details': { request: { name: string }; response: McpCliDetails | null }
  /** "Importar" um servidor do Claude Desktop: para o Claude CLI ou só no app (sem os segredos). */
  'scribe:mcp-import': { request: { id: string; target: 'cli' | 'app' }; response: McpSaveResult }
  /** Contrato 58: "Ver ferramentas" de um conector do claude.ai, do `mcpServerStatus` do `claude` (nada vai ao modelo). */
  'scribe:mcp-connector-tools': { request: { name: string }; response: ClaudeConnectorTools }
  /** Bloqueio do app (contrato 22): estado, sem nada da senha. */
  'scribe:lock-status': { request: undefined; response: LockStatus }
  /** "Bloquear" (barra lateral, barra da gravação, ⌘⇧L): só bloqueia se houver senha ou Touch ID. */
  'scribe:lock-now': { request: undefined; response: LockStatus }
  /** A senha vai ao main, que confere com o hash; ela nunca volta. */
  'scribe:lock-unlock': { request: { password: string }; response: LockResponse }
  'scribe:lock-touch-id': { request: undefined; response: LockResponse }
  /** "Criar senha" (`current: null`) e "Trocar senha" (pede a atual). A confirmação é conferida na tela. */
  'scribe:lock-password-set': { request: { current: string | null; next: string }; response: LockResponse }
  /** "Remover senha" (pede a atual). */
  'scribe:lock-password-remove': { request: { current: string }; response: LockResponse }
  /**
   * Gravação em curso (contrato 22): aberta no começo da gravação e fechada no fim do "Encerrar". O token é o
   * que deixa os canais de fim de gravação passarem com o app bloqueado, e o main sabe que há gravação (⌘W, ⌘Q).
   */
  'scribe:recording-session-open': { request: undefined; response: string }
  'scribe:recording-session-close': { request: { token: string }; response: boolean }
  /** Conta Google (contrato 11): se há cadastro, o ID mascarado, o estado e o perfil. Nenhum segredo volta. */
  'scribe:google-status': { request: undefined; response: GoogleAccountStatus }
  /** "Salvar" do painel "Configurar…": o main confere o formato e guarda os dois cifrados. */
  'scribe:google-client-save': { request: { clientId: string; clientSecret: string }; response: GoogleClientSaveResult }
  /** "Entrar com Google": abre o navegador e responde quando o login termina (até 5 min). */
  'scribe:google-sign-in': { request: undefined; response: GoogleAccountStatus }
  'scribe:google-sign-in-cancel': { request: undefined; response: boolean }
  /** "Sair": revoga o token no Google e apaga a sessão do disco. */
  'scribe:google-sign-out': { request: undefined; response: GoogleAccountStatus }
  /** Contrato 12 (CA2): "Permitir acesso à agenda", o consentimento só com o escopo que falta. */
  'scribe:google-calendar-grant': { request: undefined; response: GoogleAccountStatus }
  /** Conta Microsoft (contrato 12, CA1): o mesmo que a do Google, com só o ID do aplicativo (sem segredo). */
  'scribe:microsoft-status': { request: undefined; response: MicrosoftAccountStatus }
  'scribe:microsoft-client-save': { request: { clientId: string }; response: MicrosoftClientSaveResult }
  /** "Entrar com Microsoft": abre o navegador e responde quando o login termina (até 5 min). */
  'scribe:microsoft-sign-in': { request: undefined; response: MicrosoftAccountStatus }
  'scribe:microsoft-sign-in-cancel': { request: undefined; response: boolean }
  /** "Sair": apaga a sessão deste Mac. */
  'scribe:microsoft-sign-out': { request: undefined; response: MicrosoftAccountStatus }
  /** Agendas (contrato 12): "Próximas" e a faixa "não está sendo gravada". Nenhum link de chamada volta. */
  'scribe:calendar-get': { request: undefined; response: CalendarView }
  /** As agendas de cada conta, para escolher em Configurações › Contas › Agenda. */
  'scribe:calendar-list': { request: undefined; response: CalendarListResult }
  /** "Gravar" da faixa ou de "Próximas": o evento da gravação que a tela começa em seguida. */
  'scribe:calendar-record': { request: { key: string }; response: boolean }
  /** "Ignorar" da faixa. */
  'scribe:calendar-dismiss': { request: { key: string }; response: CalendarView }
  /** "Entrar na chamada": o main abre o link do evento no navegador, só se for `https://`. */
  'scribe:calendar-join': { request: { key: string }; response: boolean }
  /** Título do evento da gravação que acabou de começar (CA9); `null` sem evento. */
  'scribe:calendar-recording': { request: undefined; response: { title: string } | null }
  /** Quem fala no Meet (contrato 27): o estado da extensão agora, para a tela ao abrir (`events` vem vazio). */
  'scribe:meet-status': { request: undefined; response: MeetState }
  /** Aviso de reunião (contrato 48), só a janela do aviso: o título e a plataforma que ela mostra. */
  'scribe:meeting-prompt-state': { request: undefined; response: MeetingPromptState }
  /** Um botão do aviso; falso se o pedido não veio da janela do aviso. */
  'scribe:meeting-prompt-act': { request: { acao: MeetingPromptAction }; response: boolean }
  /** "Salvar plugin…" (contrato 31): diálogo de pasta no main e cópia da extensão embutida; `null` se cancelado. */
  'scribe:plugin-save': { request: { id: AppPluginId }; response: PluginSaveResult }
  /** Controle do navegador (contrato 46): a ponte ligada na configuração e a extensão conectada agora. */
  'scribe:navegador-status': { request: undefined; response: NavegadorState }
  /** "Ativar ponte": grava a configuração (o servidor sobe ou para junto) e devolve o estado. */
  'scribe:navegador-set': { request: { ativo: boolean }; response: NavegadorState }
  /** Estado da reunião no Google Drive (aba "Áudio" do detalhe). */
  'scribe:drive-status': { request: { meetingId: string }; response: DriveMeetingStatus }
  /** "Tentar de novo". */
  'scribe:drive-retry': { request: { meetingId: string }; response: DriveMeetingStatus }
  /** "Abrir no Drive": o main monta o endereço da pasta e abre no navegador. */
  'scribe:drive-open': { request: { meetingId: string }; response: boolean }
  /** WhatsApp pessoal (contrato 24): estado do serviço local, sem token nem porta. */
  'scribe:whatsapp-status': { request: undefined; response: WhatsAppStatus }
  /** "Entendo o risco e quero continuar": registra a aceitação com a data, para instalar ou para um pareamento. */
  'scribe:whatsapp-risk-accept': { request: { purpose: 'install' | 'pair' }; response: WhatsAppStatus }
  /** "Instalar": só com o clique e a aceitação recente do aviso; o andamento chega por `scribe:whatsapp-state`. */
  'scribe:whatsapp-install': { request: undefined; response: WhatsAppStatus }
  'scribe:whatsapp-start': { request: undefined; response: WhatsAppStatus }
  'scribe:whatsapp-stop': { request: undefined; response: WhatsAppStatus }
  /** QR em texto (o app desenha) ou, com `phone`, o código por número; só depois da tela de risco. */
  'scribe:whatsapp-pair': { request: { phone?: string }; response: WhatsAppPairing | { error: WhatsAppError } }
  /** "Sair da conta": `/logout` e a sessão apagada. */
  'scribe:whatsapp-logout': { request: undefined; response: WhatsAppStatus }
  /** "Remover": o ambiente Python e a sessão. */
  'scribe:whatsapp-remove': { request: undefined; response: WhatsAppStatus }
  'scribe:whatsapp-chats': { request: undefined; response: WhatsAppChat[] }
  /** Mensagens de uma conversa; com `before`, as anteriores (carregar mais ao rolar). */
  'scribe:whatsapp-messages': { request: { chatId: string; before?: number; beforeId?: string }; response: WhatsAppMessage[] }
  'scribe:whatsapp-search': { request: { term: string }; response: WhatsAppSearchHit[] }
  /**
   * Enviar (CA4): só com o token de clique que o preload gera no clique em "Enviar" (`ScribeApi.whatsappSend`), de
   * uso único e com validade de 10 s, e depois do "Enviar" no diálogo nativo que o main abre em todo envio.
   */
  'scribe:whatsapp-send': { request: WhatsAppSendRequest; response: WhatsAppSendResult }
  /**
   * Contrato 39: enviar a imagem ou o vídeo anexado, com a legenda como foi digitada. Só com o token de clique, como o
   * texto (`ScribeApi.whatsappSendMedia`); o main confere de novo o tipo pelos bytes e o limite antes de gastar o token.
   */
  'scribe:whatsapp-send-media': { request: WhatsAppSendMediaRequest; response: WhatsAppSendMediaResult }
  /** Contrato 39: o clipe do campo abre o seletor do macOS; o arquivo escolhido volta conferido (nada é enviado). */
  'scribe:whatsapp-attach-pick': { request: undefined; response: WhatsAppAttachPickResult }
  /**
   * Contrato 34: reagir a uma mensagem (um dos 6 emojis; vazio tira a sua). É envio: só com o token de clique do preload
   * (`ScribeApi.whatsappReact`), gasto no mesmo guarda do texto.
   */
  'scribe:whatsapp-react': { request: WhatsAppReactRequest; response: WhatsAppReactResult }
  /**
   * Contrato 34: o "digitando…" da sua conta na conversa aberta. Não é mensagem (sem token de clique), mas o main só
   * repassa com "Mostrar quando estou digitando" ligado; `false`: nada saiu.
   */
  'scribe:whatsapp-typing': { request: { chatId: string; state: 'composing' | 'paused' }; response: boolean }
  /** "Rascunho com o Claude": o texto volta para o campo; nada é enviado. */
  'scribe:whatsapp-draft': { request: WhatsAppDraftRequest; response: WhatsAppDraftResult }
  /** "Ligar conversa do WhatsApp" no detalhe da reunião. */
  'scribe:whatsapp-link-get': { request: { meetingId: string }; response: WhatsAppMeetingLink | null }
  'scribe:whatsapp-link-set': { request: { meetingId: string; link: WhatsAppMeetingLink | null }; response: WhatsAppMeetingLink | null }
  /** Contrato 32: foto de perfil da conversa (data URL) ou `null`; o main guarda na memória. */
  'scribe:whatsapp-photo': { request: { chatId: string }; response: string | null }
  /**
   * Contrato 37: os bytes da imagem, do vídeo ou do áudio de uma mensagem, só no clique em "Baixar" (o renderer faz o
   * blob). Nada é baixado sem o pedido.
   */
  'scribe:whatsapp-media': { request: WhatsAppMediaRequest; response: WhatsAppMediaResult }
  /** Contrato 37: transcrever um áudio pela AssemblyAI (só no clique); com `peek`, só a transcrição já guardada. */
  'scribe:whatsapp-transcribe': { request: WhatsAppTranscribeRequest; response: WhatsAppTranscribeResult }
  /** Contrato 32: os Detalhes guardados da conversa e se ainda valem para a última mensagem. Não roda nada. */
  'scribe:whatsapp-insights': { request: { chatId: string }; response: WhatsAppInsightsState }
  /** Contrato 32: analisar a conversa agora (só lê; cancela a análise de outra conversa). */
  'scribe:whatsapp-insights-run': { request: { chatId: string }; response: WhatsAppInsightsResult }
  /** Email (contrato 42): as contas, com o estado de cada uma. Nenhuma senha volta, nem cifrada. */
  'scribe:email-accounts': { request: undefined; response: EmailAccountStatus[] }
  /** Servidores pelo endereço: preset embutido, ISPDB do Thunderbird (até 5 s) ou `null` (a tela cai no manual). */
  'scribe:email-autoconfig': { request: { address: string }; response: EmailAutoconfig | null }
  /** A senha vai ao main, que guarda só cifrada pelo `safeStorage`; a conta conecta em seguida. */
  'scribe:email-add-account': { request: EmailAccountInput; response: EmailAddResult }
  /** Remove a conta, o cache das mensagens e os corpos baixados. Nada é apagado no servidor. */
  'scribe:email-remove-account': { request: { accountId: string }; response: boolean }
  /** INBOX (padrão) ou enviados, do cache local; com `mailbox` (contrato 52), a pasta aberta como ficou guardada. */
  'scribe:email-messages': { request: { accountId: string; folder?: EmailFolder; mailbox?: string }; response: EmailMessage[] }
  /** Corpo de uma mensagem: do cache, ou baixado agora (IMAP) e passado pelo `mailparser`. */
  'scribe:email-get-body': { request: { accountId: string; id: string }; response: EmailBodyResult }
  /** "Marcar como (não) lida": no servidor (IMAP) e no cache. */
  'scribe:email-mark-read': { request: { accountId: string; id: string; seen: boolean }; response: boolean }
  /** "Apagar": `\Deleted` + `EXPUNGE` no IMAP; no POP3 e nos enviados, só no app. */
  'scribe:email-delete': { request: { accountId: string; id: string }; response: boolean }
  /**
   * Enviar (R4 da PRD): só com o token de clique que o preload gera no clique em "Enviar" (`ScribeApi.emailSend`), de uso
   * único e com validade de 10 s, como no WhatsApp; sem diálogo de confirmação. Falha volta tipada, sem exceção.
   */
  'scribe:email-send': { request: EmailSendRequest; response: EmailSendResult }
  /**
   * "Aceitar", "Talvez" ou "Recusar" de um convite: o REPLY ao organizador, só com o token de clique do email (contrato
   * 61); nunca regra, tarefa ou Assistente. Não fica em Enviados. Falha volta tipada, sem exceção.
   */
  'scribe:invite-reply': { request: InviteReplySendRequest; response: InviteReplySendResult }
  /**
   * Contrato 62: o estado do cartão do convite e o Calendário do Mac. O renderer manda só a conta e a mensagem; o
   * convite sai do corpo guardado no main. Gravar é local e o app só mexe no evento que ele criou (sem token de clique).
   */
  'scribe:invite-state': { request: InviteMessageRequest; response: InviteStateResult }
  'scribe:invite-add': { request: InviteAddRequest; response: InviteActionResult }
  'scribe:invite-update': { request: InviteMessageRequest; response: InviteActionResult }
  'scribe:invite-remove': { request: InviteMessageRequest; response: InviteActionResult }
  'scribe:invite-calendars': { request: undefined; response: InviteCalendarsResult }
  'scribe:invite-request-access': { request: undefined; response: InviteAccessResult }
  'scribe:invite-open-ics': { request: InviteMessageRequest; response: InviteOpenIcsResult }
  /**
   * Contrato 64: "Sugerir evento" num email sem convite: só com o token de clique próprio (`ScribeApi.inviteSuggest`), com a
   * opção ligada e o corpo guardado; o Claude lê só o texto daquele email. Nada é gravado nem enviado.
   */
  'scribe:invite-suggest': { request: InviteSuggestRequest; response: InviteSuggestResult }
  /** Contrato 64: grava a sugestão conferida, só no clique de "Pôr na agenda" do cartão (local, sem token). */
  'scribe:invite-suggest-add': { request: InviteSuggestAddRequest; response: InviteSuggestAddResult }
  /** Contrato 43: "Testar conexão" com os dados do formulário (recebimento e envio); nada é gravado. */
  'scribe:email-test': { request: EmailAccountInput; response: EmailTestResult }
  /** Contrato 43: o clipe do composer abre o seletor do macOS; os arquivos voltam para a lista de anexos (nada é enviado). */
  'scribe:email-attach-pick': { request: undefined; response: EmailAttachPickResult }
  /**
   * Contrato 43: "Carregar imagens" de um email: o main baixa só as imagens `http(s)` pedidas (nunca de endereço local)
   * e devolve data URLs; a que falhar volta `null`. Sem o clique, nada é baixado.
   */
  'scribe:email-remote-images': { request: { urls: string[] }; response: Record<string, string | null> }
  /**
   * Contrato 43 (CA8): "Baixar" um anexo recebido: os bytes vêm do servidor (IMAP) ou da mensagem guardada (POP3,
   * enviados) e vão para o arquivo escolhido no diálogo do macOS. Nada é aberto.
   */
  'scribe:email-attachment-save': { request: EmailAttachmentRequest; response: EmailAttachmentSaveResult }
  /** Contrato 43 (CA9): os anexos da mensagem para o "Encaminhar", nos limites do envio. */
  'scribe:email-attachments': { request: { accountId: string; id: string }; response: EmailAttachmentsResult }
  /** Contrato 52 (CA2): as pastas da conta em árvore, com as contagens (`LIST` + `STATUS`). POP3: INBOX e Sent, `pop3`. */
  'scribe:email-folders': { request: { accountId: string }; response: EmailFoldersResult }
  /** Contrato 52 (CA3): as 200 mais recentes da pasta, gravadas no cache; a INBOX vem do cache (segue no IDLE). */
  'scribe:email-open-folder': { request: { accountId: string; path: string }; response: EmailOpenFolderResult }
  /** Contrato 52 (CA4): "Mover para…" no servidor (`MOVE`, ou `COPY` + `EXPUNGE`), até 500 UIDs; nada é enviado. */
  'scribe:email-move': { request: { accountId: string; fromPath: string; uids: number[]; toPath: string }; response: EmailMoveResult }
  /** Contrato 52 (CA5): pasta nova (`parentPath` `null`: na raiz). */
  'scribe:email-folder-create': { request: { accountId: string; parentPath: string | null; name: string }; response: EmailFolderPathResult }
  /** Contrato 52 (CA5): a INBOX e as pastas especiais voltam `protected`. */
  'scribe:email-folder-rename': { request: { accountId: string; path: string; newName: string }; response: EmailFolderPathResult }
  /** Contrato 52 (CA5): pasta com mensagens ou subpastas só sai com `force`. */
  'scribe:email-folder-delete': { request: { accountId: string; path: string; force?: boolean }; response: EmailFolderDeleteResult }
  /** Contrato 54 (CA2): a assinatura da conta (a padrão se nunca foi gravada). Nada é enviado. */
  'scribe:email-signature-get': { request: { accountId: string }; response: EmailSignatureResult }
  /** Contrato 54 (CA2): grava a assinatura da conta (texto até 2000 caracteres e os dois interruptores). */
  'scribe:email-signature-set': { request: { accountId: string; signature: EmailSignature }; response: EmailSignatureResult }
  /** Contrato 53 (CA12): as regras da conta, na ordem, com o estado de cada uma (último erro, último "Executar agora"). */
  'scribe:email-rules-get': { request: { accountId: string }; response: EmailRulesGetResult }
  /** Contrato 53 (CA9): a lista inteira, na ordem; confere a pasta de destino, a Lixeira e o POP3 antes de gravar. */
  'scribe:email-rules-set': { request: { accountId: string; rules: EmailRule[] }; response: EmailRulesSetResult }
  /** Contrato 53 (CA10): "Executar agora", primeiro passo: a contagem e o token. Nada muda. */
  'scribe:email-rules-preview': { request: { accountId: string; ruleId: string }; response: EmailRulePreviewResult }
  /** Segundo passo: só com o token do preview. */
  'scribe:email-rules-run': { request: { accountId: string; ruleId: string; token: string }; response: EmailRuleRunResult }
  /** Contrato 56 (CA10): o lote `running` mais recente e os de hoje (o painel e a faixa abrem no meio ou depois de reiniciar). */
  'scribe:email-organize-state': { request: undefined; response: EmailOrganizeStateResult }
  /** Contrato 56 (CA12): um lote do Assistente, para o cartão do chat. */
  'scribe:email-batch-get': { request: { batchId: string }; response: EmailBatchGetResult }
  /** Contrato 56 (CA9): devolve à pasta de antes o que o Assistente moveu; nada é enviado nem apagado. */
  'scribe:email-batch-undo': { request: { batchId: string }; response: EmailBatchUndoResult }
  /** Automações (contrato 23): os agentes, quantas tarefas usam cada um e os modelos que o perfil oferece. */
  'scribe:agents-list': { request: undefined; response: AgentsList }
  /** Criar (`id: null`) ou trocar um agente. */
  'scribe:agents-save': { request: AgentInput; response: AgentSaveResult }
  /** Recusado se uma tarefa usa o agente (com a lista das tarefas). */
  'scribe:agents-delete': { request: { id: string }; response: AgentDeleteResult }
  /** "Testar agora": o agente do formulário com uma mensagem; a resposta chega por `scribe:automation-event`. */
  'scribe:agents-test': { request: { agent: AgentInput; text: string }; response: RunStartResult }
  'scribe:tasks-list': { request: undefined; response: ScheduledTask[] }
  'scribe:tasks-save': { request: TaskInput; response: TaskSaveResult }
  'scribe:tasks-delete': { request: { id: string }; response: boolean }
  /** Interruptor ligado/desligado; ligar tira a pausa automática. */
  'scribe:tasks-toggle': { request: { id: string; enabled: boolean }; response: ScheduledTask | null }
  /** "Rodar agora"; se a tarefa já roda, a vez vira `skipped`. */
  'scribe:tasks-run-now': { request: { id: string }; response: RunStartResult }
  /** "Pedir agora": um agente e um pedido, na hora; entra em "Execuções". */
  'scribe:automations-ask': { request: { agentId: string; text: string }; response: RunStartResult }
  /** "Execuções": as últimas 500, com os filtros por tarefa e estado. */
  'scribe:runs-list': { request: { taskId?: string | undefined; status?: RunStatus | undefined }; response: AutomationRunListItem[] }
  'scribe:runs-get': { request: { id: string }; response: AutomationRun | null }
  'scribe:runs-rerun': { request: { id: string }; response: RunStartResult }
  /** Pausa, limite diário, o que roda e as próximas tarefas. */
  'scribe:automations-status': { request: undefined; response: AutomationsStatus }
  /** "Pausar todas as tarefas" / "Retomar". */
  'scribe:automations-pause': { request: { paused: boolean }; response: AutomationsStatus }
  /** Redes (contrato 69): as contas do Instagram e o armazenamento de mídia. Nenhum token nem chave secreta volta. */
  'scribe:redes-state': { request: undefined; response: RedesState }
  /** "Conectar": o token colado vai ao main, que valida no `/me` e guarda só cifrado; erro não grava nada. */
  'scribe:redes-connect': { request: { token: string }; response: RedesConnectResult }
  /** "Renovar agora" (só depois de 24 h da última renovação, como a Meta exige). */
  'scribe:redes-refresh': { request: { accountId: string }; response: RedesConnectResult }
  /** "Remover": o token e os dados locais da conta. Nada muda no Instagram. */
  'scribe:redes-remove': { request: { accountId: string }; response: { ok: boolean } }
  /** Salvar o armazenamento; `secretAccessKey: null` mantém a chave secreta guardada. Configuração inválida volta com a razão. */
  'scribe:redes-media-host-save': { request: { config: MediaHostConfig; secretAccessKey: string | null }; response: MediaHostSaveResult }
  /** "Testar": upload de 1 byte e leitura pública (contrato 70); o resultado fica em `lastTest`. */
  'scribe:redes-media-host-test': { request: undefined; response: MediaHostStatus }
  'scribe:redes-media-host-clear': { request: undefined; response: MediaHostStatus }
  /** Contrato 71: a fila de publicações de uma conta e a última cota lida. */
  'scribe:redes-publications': { request: { accountId: string }; response: RedesPublicationsPayload }
  /** O diálogo nativo (JPEG, MP4, MOV, vários): os arquivos já conferidos pelas regras da Meta, sem salvar nada. */
  'scribe:redes-media-pick': { request: undefined; response: MediaCandidate[] }
  /** Salvar o rascunho (as mídias novas são conferidas e copiadas para `userData/redes/midia/`); problemas voltam em pt-BR. */
  'scribe:redes-publication-save': { request: PublicationSaveInput; response: PublicationSaveResult }
  /** Apagar (não em `publicando`): a publicação e as cópias das mídias. */
  'scribe:redes-publication-delete': { request: { id: string }; response: { ok: true } | { ok: false; error: string } }
  /** "Agendar": só pelo `redesSchedule` do preload, com o token de clique. */
  'scribe:redes-publication-schedule': { request: { id?: string; at: string; clickToken: string; save?: PublicationSaveInput }; response: PublicationActionResult }
  /** "Publicar agora": só pelo `redesPublish` do preload, com o token de clique. */
  'scribe:redes-publication-publish': { request: { id?: string; clickToken: string; save?: PublicationSaveInput }; response: PublicationActionResult }
  /** A agendada volta a rascunho. */
  'scribe:redes-publication-unschedule': { request: { id: string }; response: PublicationActionResult }
  /** "Tentar de novo" (só em `erro`): retoma pelo contêiner que já existe, sem criar outro. */
  'scribe:redes-publication-retry': { request: { id: string }; response: PublicationActionResult }
  /** A cota das últimas 24 h (cache de 5 min). */
  'scribe:redes-quota': { request: { accountId: string }; response: PublicationQuotaResult }
  /**
   * Contrato 72: a miniatura de uma imagem da fila ou do editor (data URL em JPEG, até 192 px), feita no main. Só de uma
   * cópia em `userData/redes/midia/` ou de um arquivo que o diálogo de mídias devolveu nesta sessão; vídeo e o resto, `null`.
   */
  'scribe:redes-media-thumb': { request: { path: string }; response: string | null }
  // 73: comentários
  /** Contrato 73: os comentários guardados de uma conta (sem ler o Instagram), agrupados por mídia, com os não lidos. */
  'scribe:redes-comments': { request: { accountId: string }; response: RedesCommentsPayload }
  /** Ao abrir a seção e no "Atualizar": lê as 25 mídias mais recentes e os comentários agora. */
  'scribe:redes-comments-refresh': { request: { accountId: string }; response: RedesCommentsPayload }
  /**
   * "Responder" (Enter): a resposta vai ao comentário (a de uma resposta, ao comentário de cima). Até 2.200 caracteres.
   * Só pelo `redesCommentReply` do preload, com o token de clique das redes.
   */
  'scribe:redes-comment-reply': { request: { accountId: string; commentId: string; message: string; clickToken: string }; response: RedesCommentReplyResult }
  /** "Ocultar" (`hide: true`) ou "Mostrar". */
  'scribe:redes-comment-hide': { request: { accountId: string; commentId: string; hide: boolean }; response: RedesCommentActionResult }
  /** "Excluir", depois da confirmação na linha: só pelo `redesCommentDelete` do preload, com o token de clique das redes. */
  'scribe:redes-comment-delete': { request: { accountId: string; commentId: string; clickToken: string }; response: RedesCommentActionResult }
  /** A mídia aberta na tela: os comentários dela ficam lidos. */
  'scribe:redes-comments-read': { request: { accountId: string; mediaId: string }; response: RedesCommentsPayload }
  // fim 73
  // 75: métricas
  /** Contrato 75: as métricas da conta no período e das 25 mídias recentes (cache de 1 h; passou, lê da Meta). */
  'scribe:redes-metrics': { request: { accountId: string; period: MetricPeriod }; response: RedesMetricsState }
  /** Contrato 75: "Atualizar" das métricas: lê da Meta de novo. */
  'scribe:redes-metrics-refresh': { request: { accountId: string; period: MetricPeriod }; response: RedesMetricsState }
  // fim 75
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens guardadas de uma conta (sem ler o Instagram). */
  'scribe:redes-messages': { request: { accountId: string }; response: RedesMessagesPayload }
  /** "Atualizar" e a abertura da seção: lê as conversas agora (só as mensagens das que mudaram). */
  'scribe:redes-messages-refresh': { request: { accountId: string }; response: RedesMessagesPayload }
  /** "Enviar" a resposta: só pelo `redesMessageSend` do preload, com o token de clique. Até 1000 bytes. */
  'scribe:redes-message-send': { request: { accountId: string; conversationId: string; text: string; clickToken: string }; response: RedesMessageSendResult }
  /** A conversa aberta na tela: deixa de ser não lida. */
  'scribe:redes-conversation-read': { request: { accountId: string; conversationId: string }; response: RedesMessagesPayload }
  // fim 74
  // 110: funil
  /** Contrato 110: o funil inteiro e a última interação (R7) de cada oportunidade não arquivada; exceção, `falhou`. */
  'scribe:funil-get': { request: undefined; response: FunilView | FunilFalha }
  /** Cria (sem `id`) ou edita; criar com e-mail ou telefone de outro contato mescla nele (R4, `mesclado: true`). */
  'scribe:funil-contato-save': { request: { contato: ContatoInput; origem: ContatoOrigem }; response: FunilActionResult }
  'scribe:funil-contato-archive': { request: { id: string }; response: FunilActionResult }
  'scribe:funil-empresa-save': { request: { empresa: EmpresaInput }; response: FunilActionResult }
  /** Recusa (`empresa-em-uso`) a empresa com contato ou oportunidade. */
  'scribe:funil-empresa-delete': { request: { id: string }; response: FunilActionResult }
  'scribe:funil-oportunidade-save': { request: { oportunidade: OportunidadeInput }; response: FunilActionResult }
  /** Muda de etapa e/ou de posição na coluna (R6). */
  'scribe:funil-oportunidade-move': { request: { id: string; etapaId: string; ordem: number; motivoPerda?: string | null | undefined }; response: FunilActionResult }
  'scribe:funil-oportunidade-delete': { request: { id: string }; response: FunilActionResult }
  /** Só ganha ou perdida (R27). */
  'scribe:funil-oportunidade-archive': { request: { id: string }; response: FunilActionResult }
  'scribe:funil-etapas-save': { request: { etapas: EtapaInput[] }; response: FunilActionResult }
  /** Nota na oportunidade. */
  'scribe:funil-evento-add': { request: { oportunidadeId: string; texto: string }; response: FunilActionResult }
  /** Sugestões de contato (R11, R12), calculadas na hora pelos caches de reuniões, e-mail e WhatsApp. */
  'scribe:funil-sugestoes': { request: undefined; response: Sugestao[] }
  'scribe:funil-ignorar': { request: { chave: string }; response: FunilActionResult }
  /** "Importar…": diálogo, leitura e prévia (R13 a R15). */
  'scribe:funil-importar-abrir': { request: undefined; response: FunilImportAbrirResult }
  /** Importa a leitura do `token` (R16); `simular` só conta. */
  'scribe:funil-importar-confirmar': { request: { token: string; mapeamento?: CampoImport[] | undefined; simular?: boolean | undefined }; response: FunilImportConfirmarResult }
  /** Linha do tempo de um contato ou de uma oportunidade (R8 a R10, R29). */
  'scribe:funil-timeline': { request: { tipo: 'contato' | 'oportunidade'; id: string }; response: FunilTimelineResult }
  // fim 110
  // 113: proposta do funil
  /** Contrato 113: a proposta de IA da reunião, se a detecção roda agora e a oportunidade aberta da mesma empresa (R39). */
  'scribe:funil-proposta-get': { request: { meetingId: string }; response: FunilPropostaView | FunilPropostaRecusa }
  /** "Criar" / "Atualizar" / "Vincular a existente…" (R39): só com o arquivo `proposed`; grava `accepted`. */
  'scribe:funil-proposta-aplicar': { request: FunilPropostaAplicarRequest; response: FunilPropostaAplicarResult }
  /** "Ignorar": `proposed` vira `dismissed`. */
  'scribe:funil-proposta-descartar': { request: { meetingId: string }; response: { ok: boolean } }
  /** "Detectar oportunidade" (R40): roda mesmo com o interruptor desligado e substitui o arquivo; responde na hora com `detectando: true`. */
  'scribe:funil-proposta-detectar': { request: { meetingId: string }; response: FunilPropostaView | FunilPropostaRecusa }
  // fim 113
  // 122: tarefas
  /** Contrato 122: a lista inteira, o dia de hoje e os nomes dos vínculos (D5); exceção, `falhou`. */
  'scribe:tarefas-get': { request: undefined; response: TarefasView | TarefasFalha }
  /** Nova tarefa; o lembrete padrão e os vínculos da oportunidade (R9, R11) são resolvidos no main. */
  'scribe:tarefas-criar': { request: TarefaInput; response: TarefasActionResult }
  /** Edição parcial (R37): só o que vier muda. */
  'scribe:tarefas-salvar': { request: TarefaSalvar; response: TarefasActionResult }
  /** Concluir, cancelar ou reabrir (R8). */
  'scribe:tarefas-status': { request: { id: string; status: TarefaStatus }; response: TarefasActionResult }
  /** Remove sem lixeira (R8). */
  'scribe:tarefas-apagar': { request: { id: string }; response: TarefasActionResult }
  /** A aba Sugestões, calculada a cada pedido (R26); exceção, lista vazia. */
  'scribe:tarefas-sugestoes': { request: undefined; response: SugestaoTarefa[] }
  /** "Ignorar" de uma sugestão: não volta (R26). */
  'scribe:tarefas-ignorar': { request: { chave: string }; response: TarefasActionResult }
  /** "Adicionar" e "Adicionar as minhas" do resumo (R22, R23). */
  'scribe:tarefas-adicionar-do-resumo': { request: { meetingId: string; indices: number[] | 'minhas' }; response: TarefasResumoResult }
  // fim 122
  // 134: inicio
  /** Contrato 134 (D10): a tela Início (agenda do dia, pendências e a saudação), só leitura; nunca o link da chamada. */
  'scribe:inicio-get': { request: undefined; response: InicioView }
  /** "Conceder" da linha do Calendário do Mac: pede o acesso, esquece o que leu e devolve a view de novo. */
  'scribe:inicio-mac-acesso': { request: undefined; response: InicioView }
  /** Contrato 145 (D3): relê na origem a agenda, o Calendário do Mac e as pastas do email; devolve a view de novo. */
  'scribe:inicio-atualizar': { request: undefined; response: InicioAtualizarResult }
  // fim 134
  // 138: atendimento
  /** Contrato 138: os agentes de atendimento, os atendimentos das conversas, a pausa geral e o aceite do risco. */
  'scribe:atendimento-state': { request: undefined; response: { ok: true; state: AtendimentoState } | AtendimentoFailure }
  /** Criar (`id: null`) ou trocar um agente de atendimento; nome único sem diferenciar maiúsculas. */
  'scribe:atendimento-agent-save': { request: AtendimentoAgentInput; response: AtendimentoAgentSaveResult }
  /** Apaga o agente; os atendimentos que o usam ficam desligados, não apagados. */
  'scribe:atendimento-agent-delete': { request: { id: string }; response: AtendimentoResult }
  /** Cria ou substitui o atendimento da conversa; grupo recusado, automático ligado só com o aceite do risco. */
  'scribe:atendimento-binding-save': { request: AtendimentoBindingInput; response: AtendimentoBindingSaveResult }
  'scribe:atendimento-binding-delete': { request: { chatId: string }; response: AtendimentoResult }
  /** "Pausar todos os atendimentos" / "Retomar". */
  'scribe:atendimento-pause-all': { request: { paused: boolean }; response: AtendimentoResult }
  /** Aceite do aviso de risco do atendimento automático. */
  'scribe:atendimento-risk-accept': { request: undefined; response: AtendimentoResult }
  /** O histórico, do mais recente para o mais antigo. */
  'scribe:atendimento-log-list': { request: AtendimentoLogListRequest; response: AtendimentoLogListResult }
  // fim 138
  // 141: atendimento
  /** Contrato 141: por conversa, a resposta agendada, a proposta do modo rascunho e a passagem para o dono (só memória). */
  'scribe:atendimento-runtime': { request: undefined; response: AtendimentoRuntime }
  /** "Testar agente": a decisão do motor para a mensagem de exemplo. Não grava, não agenda, não envia e não notifica. */
  'scribe:atendimento-agent-test': { request: AtendimentoAgentTestRequest; response: AtendimentoAgentTestResult }
  /** Enviar a proposta: só pelo `atendimentoDraftSend` do preload, com o token de clique do `scribe:whatsapp-send`. */
  'scribe:atendimento-draft-send': { request: AtendimentoDraftSendRequest; response: AtendimentoDraftSendResult }
  /** Descartar a proposta da conversa. */
  'scribe:atendimento-draft-discard': { request: { chatId: string }; response: AtendimentoDraftDiscardResult }
  // fim 141
}

/** renderer -> main, sem resposta (`__scribeApi.send` / `ipcMain.on`). */
export interface RendererEvents {
  'scribe:csp-violation': CspViolation
  'scribe:open-privacy-settings': PrivacyPane
  /** "Criar chave": o main abre o painel da AssemblyAI no navegador padrão. */
  'scribe:open-key-dashboard': undefined
  /** Conversa fechada (outra escolhida, "Nova conversa"): o processo dela morre. */
  'scribe:chat-close': { id: string }
  /** Saiu da tela da conversa: o processo morre em 5 min, se ela não for aberta de novo. */
  'scribe:chat-leave': { id: string }
  /** Link `https://` de uma resposta, depois da confirmação na tela: o main confere e abre no navegador. */
  'scribe:open-link': string
  /** Uso do app (tecla, clique, movimento), no máximo um a cada 15 s: "Bloquear sozinho depois de …" (contrato 22). */
  'scribe:lock-activity': undefined
  /** Clique em "Enviar" do WhatsApp (contrato 24): só o preload manda, com a ativação do usuário viva. */
  'scribe:whatsapp-click': string
  /** Saiu da tela do QR: a aceitação do aviso deste pareamento acaba. */
  'scribe:whatsapp-pair-cancel': undefined
  /**
   * Contrato 40: a conversa aberta na tela "WhatsApp" desta janela (`null`: nenhuma, ou saiu da tela). Com a janela em
   * foco, a mensagem dessa conversa não vira notificação. Só o id; ignorada com o app bloqueado.
   */
  'scribe:whatsapp-viewing': { chatId: string | null }
  /** Clique em "Enviar" do email (contrato 42): só o preload manda, com a ativação do usuário viva. */
  'scribe:email-click': string
  /** Contrato 64: clique em "Sugerir evento", com guarda próprio; só o preload manda, com a ativação do usuário viva. */
  'scribe:invite-suggest-click': string
  /** Contrato 71: clique em "Publicar agora" ou "Agendar" das redes; só o preload manda, com a ativação do usuário viva. */
  'scribe:redes-click': string
  /**
   * Contrato 43: a pasta aberta na tela "Email" desta janela (`null`: nenhuma, ou saiu da tela). Com a janela em foco e a
   * Caixa de Entrada da conta aberta, o email novo dela não vira notificação. Ignorada com o app bloqueado.
   */
  'scribe:email-viewing': { accountId: string; folder: EmailFolder } | null
  /**
   * Contrato 52 (CA3): a pasta aberta na tela desta janela, fora a INBOX, relida a cada 5 min (só uma por janela);
   * `null` (ou `path` `null`) para. Ignorada com o app bloqueado.
   */
  'scribe:email-folder-watch': { accountId: string; path: string | null } | null
}

/** main -> renderer (`webContents.send` / `__scribeApi.on`). */
export interface MainEvents {
  'scribe:navigate': RouteId
  /** Menu "Nova gravação" (⌘N): o main já marcou o gesto do usuário no frame antes de mandar. */
  'scribe:new-recording': undefined
  /** Configurações gravadas, para todas as janelas. */
  'scribe:settings-changed': AppSettings
  /** Processo do Claude CLI da gravação: reaberto ou parado de vez. */
  'scribe:claude-state': ClaudeRunState
  /** Estado do agente do ACP: instalando (com o progresso), instalado, removido, erro. */
  'scribe:acp-state': AcpAgentStatus
  /** Resumo de uma reunião começou, terminou ou falhou. */
  'scribe:summary-state': { meetingId: string; status: SummaryStatus }
  /** As análises gravadas de uma reunião mudaram (contrato 19): o detalhe aberto relê. */
  'scribe:analyses-changed': { meetingId: string }
  /** Consulta ou download da atualização mudou de estado. */
  'scribe:update-state': UpdateState
  /** Resposta do chat crescendo ou terminada (contrato 15), com o raciocínio, os passos e os detalhes (16). */
  'scribe:chat-event': ChatEvent
  /** O app bloqueou ou desbloqueou, ou a senha, o Touch ID ou a espera mudaram (contrato 22). */
  'scribe:lock-state': LockStatus
  /** "Encerrar e sair" no diálogo de fechar com gravação em andamento: o renderer encerra e o main sai depois. */
  'scribe:recording-end-and-quit': undefined
  /** A conta Google mudou (entrando, entrou, expirou, saiu) (contrato 11). */
  'scribe:google-state': GoogleAccountStatus
  /** A conta Microsoft mudou (contrato 12). */
  'scribe:microsoft-state': MicrosoftAccountStatus
  /** "Próximas" ou a faixa da agenda mudaram (contrato 12). Não chega com o app bloqueado. */
  'scribe:calendar-state': CalendarView
  /** Uma reunião mudou de estado no Drive (enviando com a porcentagem, no Drive, erro). */
  'scribe:drive-state': { meetingId: string; status: DriveMeetingStatus }
  /** O serviço do WhatsApp mudou de estado (contrato 24). Não chega com o app bloqueado. */
  'scribe:whatsapp-state': WhatsAppStatus
  /** Mensagem nova pelo `/events` do serviço. Não chega com o app bloqueado. */
  'scribe:whatsapp-message': { message: WhatsAppMessage; chatName: string }
  /** Várias conversas mudaram de uma vez (histórico, nomes): relê a lista. Não chega com o app bloqueado. */
  'scribe:whatsapp-chats-changed': undefined
  /** Contrato 34: as reações de uma mensagem mudaram (todas, juntas). Não chega com o app bloqueado. */
  'scribe:whatsapp-reactions': { chatId: string; messageId: string; reactions: WhatsAppReaction[] }
  /** Contrato 34: alguém digitando (ou parou) numa conversa. Não chega com o app bloqueado. */
  'scribe:whatsapp-presence': WhatsAppPresence
  /** Automações (contrato 23): a resposta de uma execução crescendo ou terminada. Não chega com o app bloqueado. */
  'scribe:automation-event': AutomationEvent
  /** Tarefas, fila ou pausa mudaram: a tela relê. */
  'scribe:automations-changed': AutomationsStatus
  /** "Abrir" de uma notificação: a tela "Automações" com a execução aberta (`null`: só a tela). */
  'scribe:open-run': { runId: string | null }
  /** "Abrir" da notificação de um lembrete do Assistente (contrato 25): a conversa do WhatsApp dele. */
  'scribe:open-whatsapp': { chatId: string }
  /** "Encerrar" no menu do ícone da barra de menus: o renderer encerra a gravação em curso. */
  'scribe:recording-end': undefined
  /** "Recentes" no menu do ícone da barra de menus (contrato 50): o detalhe da reunião. Ignorado com o app bloqueado. */
  'scribe:open-meeting': { meetingId: string }
  /** A linha dos plugins no menu do ícone (contrato 50): uma aba de Configurações. Ignorado com o app bloqueado. */
  'scribe:open-settings': { tab: SettingsTab }
  /** Um agente acrescentou um post-it à reunião (contrato 23): o detalhe aberto relê as anotações. */
  'scribe:notes-changed': { meetingId: string }
  /**
   * A extensão do Meet (contrato 27) conectou, desconectou, mudou os participantes ou mandou eventos de fala. Chega
   * também com o app bloqueado: a gravação continua no bloqueio e cada evento vale pelo horário em que chega.
   */
  'scribe:meet-changed': MeetState
  /**
   * Contrato 48: o título (ou a plataforma) da reunião do aviso aberto mudou; vai só à janela do aviso (nunca pelo
   * `broadcast`) e nunca com o app bloqueado (o aviso fecha ao bloquear).
   */
  'scribe:meeting-prompt-changed': MeetingPromptState
  /** A ponte do "Controle do navegador" (contrato 46) ligou, desligou, conectou ou desconectou. */
  'scribe:navegador-changed': NavegadorState
  /** Contrato 42: uma conta de email mudou de estado (ou entrou, ou saiu); vai a lista inteira. Não chega bloqueado. */
  'scribe:email-state': EmailAccountStatus[]
  /** Email novo na INBOX (IDLE do IMAP ou poll do POP3). Não chega com o app bloqueado. */
  'scribe:email-message': EmailMessage
  /** As mensagens de uma conta mudaram (sincronismo, lida, apagada, enviada): a tela relê. Não chega bloqueado. */
  'scribe:email-changed': { accountId: string }
  /** Contrato 56 (CA10): o estado inteiro de um lote do Assistente a cada mudança. Não chega bloqueado. */
  'scribe:email-organize': EmailOrganizeEvent
  /** Contrato 69: as redes mudaram (conta entrou, renovou, venceu, saiu; armazenamento salvo ou testado). Não chega bloqueado. */
  'scribe:redes-state': RedesState
  /** Contrato 71: a fila de publicações de uma conta mudou (vai inteira, com a cota em cache). Não chega bloqueado. */
  'scribe:redes-publications': RedesPublicationsPayload
  // 73: comentários
  /** Contrato 73: os comentários de uma conta mudaram (leitura, resposta, ocultar, excluir, lida). Não chega bloqueado. */
  'scribe:redes-comments': RedesCommentsPayload
  // fim 73
  // 75: métricas
  /** Contrato 75: as métricas de uma conta foram lidas (ao abrir, no "Atualizar" e a cada hora). Não chega bloqueado. */
  'scribe:redes-metrics': RedesMetricsState
  // fim 75
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens de uma conta mudaram (leitura, envio, lida). Não chega bloqueado. */
  'scribe:redes-messages': RedesMessagesPayload
  // fim 74
  /**
   * Contrato 43: o clique na notificação de email: a Caixa de Entrada da conta com a mensagem aberta. Contrato 55: a que
   * uma regra moveu vem com a pasta (`mailbox`) e, sem o UID novo (`found: false`), abre só a pasta.
   */
  'scribe:open-email': { accountId: string; id: string; mailbox?: string; found?: boolean }
  /** Contrato 76: o rascunho que o cartão do Assistente criou: Redes › Publicações da conta, com o editor nele. Ignorado bloqueado. */
  'scribe:open-redes': { accountId: string; publicationId: string }
  // 110: funil
  /** Contrato 110: `funil.json` foi gravado; vai a view inteira. Não chega bloqueado. */
  'scribe:funil-changed': FunilView
  // fim 110
  // 113: proposta do funil
  /** Contrato 113: `meetings/<id>.funil.json` foi gravado (detecção, "Criar" / "Atualizar" ou "Ignorar"). */
  'scribe:funil-proposta-changed': { meetingId: string }
  // fim 113
  // 122: tarefas
  /** Contrato 122: `tarefas.json` foi gravado ou o dia virou (R12); vai a view inteira. Não chega bloqueado. */
  'scribe:tarefas-changed': TarefasView
  /** "Abrir" da notificação de uma tarefa (D7); `null` abre a lista. Bloqueado, o main guarda e manda ao desbloquear. */
  'scribe:open-tarefa': { id: string | null }
  // fim 122
  // 134: inicio
  /** Contrato 134 (D10): a agenda, uma leitura nova do Mac, mensagem do WhatsApp ou as pastas do email; a view inteira. Não chega bloqueado. */
  'scribe:inicio-changed': InicioView
  // fim 134
  // 141: atendimento
  /** Contrato 141: a resposta agendada, a proposta ou a passagem de uma conversa mudou; relê o runtime. Não chega bloqueado. */
  'scribe:atendimento-changed': { chatId: string }
  // fim 141
}

export type InvokeChannel = keyof InvokeChannels
export type RendererEvent = keyof RendererEvents
export type MainEvent = keyof MainEvents

export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['request'] extends undefined
  ? []
  : [request: InvokeChannels[C]['request']]

// `Record<..., true>` obriga a listar todo canal declarado nos mapas acima.
const INVOKE: Record<InvokeChannel, true> = {
  'scribe:app-info': true,
  'scribe:capture-mode': true,
  'scribe:meetings-list': true,
  'scribe:meetings-get': true,
  'scribe:meetings-create': true,
  'scribe:meetings-rename': true,
  'scribe:meetings-delete': true,
  'scribe:meetings-overview': true,
  'scribe:meetings-search': true,
  'scribe:folders-list': true,
  'scribe:folders-create': true,
  'scribe:folders-rename': true,
  'scribe:folders-delete': true,
  'scribe:meetings-move': true,
  'scribe:settings-get': true,
  'scribe:settings-update': true,
  'scribe:key-status': true,
  'scribe:key-save': true,
  'scribe:key-verify': true,
  'scribe:key-remove': true,
  'scribe:models-list': true,
  'scribe:model-select': true,
  'scribe:mic-access': true,
  'scribe:mic-access-request': true,
  'scribe:transcription-token': true,
  'scribe:transcript-save': true,
  'scribe:transcript-get': true,
  'scribe:transcript-copy': true,
  'scribe:notes-get': true,
  'scribe:notes-save': true,
  'scribe:notes-copy': true,
  'scribe:translate-turn': true,
  'scribe:claude-locate': true,
  'scribe:acp-status': true,
  'scribe:acp-install': true,
  'scribe:acp-remove': true,
  'scribe:claude-path-set': true,
  'scribe:claude-start': true,
  'scribe:claude-translate': true,
  'scribe:claude-stop': true,
  'scribe:audio-folder': true,
  'scribe:audio-folder-choose': true,
  'scribe:audio-begin': true,
  'scribe:audio-append': true,
  'scribe:audio-finish': true,
  'scribe:meeting-files': true,
  'scribe:meeting-file-open': true,
  'scribe:meeting-file-reveal': true,
  'scribe:meeting-file-download': true,
  'scribe:summary-get': true,
  'scribe:summary-generate': true,
  'scribe:summary-copy': true,
  'scribe:analysis-run': true,
  'scribe:analyses-get': true,
  'scribe:analyses-save': true,
  'scribe:analyses-add': true,
  'scribe:analysis-copy': true,
  'scribe:ai-notes-run': true,
  'scribe:ai-notes-cancel': true,
  'scribe:branding-get': true,
  'scribe:brand-logo-choose': true,
  'scribe:brand-logo-reset': true,
  'scribe:update-get': true,
  'scribe:update-check': true,
  'scribe:update-download': true,
  'scribe:update-quit': true,
  'scribe:chat-list': true,
  'scribe:chat-get': true,
  'scribe:chat-send': true,
  'scribe:chat-stop': true,
  'scribe:chat-delete': true,
  'scribe:chat-update': true,
  'scribe:chat-redo': true,
  'scribe:chat-copy': true,
  'scribe:chat-action-reminder': true,
  'scribe:chat-action-state': true,
  'scribe:chat-action-event': true,
  'scribe:chat-action-reminder-change': true,
  'scribe:chat-action-instagram-draft': true,
  'scribe:chat-action-funil': true,
  'scribe:chat-action-tarefa': true,
  'scribe:chat-approval': true,
  'scribe:mcp-chat-servers': true,
  'scribe:mcp-overview': true,
  'scribe:mcp-test': true,
  'scribe:mcp-save': true,
  'scribe:mcp-update': true,
  'scribe:mcp-remove': true,
  'scribe:mcp-details': true,
  'scribe:mcp-import': true,
  'scribe:mcp-connector-tools': true,
  'scribe:lock-status': true,
  'scribe:lock-now': true,
  'scribe:lock-unlock': true,
  'scribe:lock-touch-id': true,
  'scribe:lock-password-set': true,
  'scribe:lock-password-remove': true,
  'scribe:recording-session-open': true,
  'scribe:recording-session-close': true,
  'scribe:google-status': true,
  'scribe:google-client-save': true,
  'scribe:google-sign-in': true,
  'scribe:google-sign-in-cancel': true,
  'scribe:google-sign-out': true,
  'scribe:google-calendar-grant': true,
  'scribe:microsoft-status': true,
  'scribe:microsoft-client-save': true,
  'scribe:microsoft-sign-in': true,
  'scribe:microsoft-sign-in-cancel': true,
  'scribe:microsoft-sign-out': true,
  'scribe:calendar-get': true,
  'scribe:calendar-list': true,
  'scribe:calendar-record': true,
  'scribe:calendar-dismiss': true,
  'scribe:calendar-join': true,
  'scribe:calendar-recording': true,
  'scribe:meet-status': true,
  'scribe:meeting-prompt-state': true,
  'scribe:meeting-prompt-act': true,
  'scribe:plugin-save': true,
  'scribe:navegador-status': true,
  'scribe:navegador-set': true,
  'scribe:drive-status': true,
  'scribe:drive-retry': true,
  'scribe:drive-open': true,
  'scribe:whatsapp-status': true,
  'scribe:whatsapp-risk-accept': true,
  'scribe:whatsapp-install': true,
  'scribe:whatsapp-start': true,
  'scribe:whatsapp-stop': true,
  'scribe:whatsapp-pair': true,
  'scribe:whatsapp-logout': true,
  'scribe:whatsapp-remove': true,
  'scribe:whatsapp-chats': true,
  'scribe:whatsapp-messages': true,
  'scribe:whatsapp-search': true,
  'scribe:whatsapp-send': true,
  'scribe:whatsapp-send-media': true,
  'scribe:whatsapp-attach-pick': true,
  'scribe:whatsapp-react': true,
  'scribe:whatsapp-typing': true,
  'scribe:whatsapp-draft': true,
  'scribe:whatsapp-link-get': true,
  'scribe:whatsapp-link-set': true,
  'scribe:whatsapp-photo': true,
  'scribe:whatsapp-media': true,
  'scribe:whatsapp-transcribe': true,
  'scribe:whatsapp-insights': true,
  'scribe:whatsapp-insights-run': true,
  'scribe:email-accounts': true,
  'scribe:email-autoconfig': true,
  'scribe:email-add-account': true,
  'scribe:email-remove-account': true,
  'scribe:email-messages': true,
  'scribe:email-get-body': true,
  'scribe:email-mark-read': true,
  'scribe:email-delete': true,
  'scribe:email-send': true,
  'scribe:invite-reply': true,
  'scribe:invite-state': true,
  'scribe:invite-add': true,
  'scribe:invite-update': true,
  'scribe:invite-remove': true,
  'scribe:invite-calendars': true,
  'scribe:invite-request-access': true,
  'scribe:invite-open-ics': true,
  'scribe:invite-suggest': true,
  'scribe:invite-suggest-add': true,
  'scribe:email-test': true,
  'scribe:email-attach-pick': true,
  'scribe:email-remote-images': true,
  'scribe:email-attachment-save': true,
  'scribe:email-attachments': true,
  'scribe:email-folders': true,
  'scribe:email-open-folder': true,
  'scribe:email-move': true,
  'scribe:email-folder-create': true,
  'scribe:email-folder-rename': true,
  'scribe:email-folder-delete': true,
  'scribe:email-signature-get': true,
  'scribe:email-signature-set': true,
  'scribe:email-rules-get': true,
  'scribe:email-rules-set': true,
  'scribe:email-rules-preview': true,
  'scribe:email-rules-run': true,
  'scribe:email-organize-state': true,
  'scribe:email-batch-get': true,
  'scribe:email-batch-undo': true,
  'scribe:agents-list': true,
  'scribe:agents-save': true,
  'scribe:agents-delete': true,
  'scribe:agents-test': true,
  'scribe:tasks-list': true,
  'scribe:tasks-save': true,
  'scribe:tasks-delete': true,
  'scribe:tasks-toggle': true,
  'scribe:tasks-run-now': true,
  'scribe:automations-ask': true,
  'scribe:runs-list': true,
  'scribe:runs-get': true,
  'scribe:runs-rerun': true,
  'scribe:automations-status': true,
  'scribe:automations-pause': true,
  'scribe:redes-state': true,
  'scribe:redes-connect': true,
  'scribe:redes-refresh': true,
  'scribe:redes-remove': true,
  'scribe:redes-media-host-save': true,
  'scribe:redes-media-host-test': true,
  'scribe:redes-media-host-clear': true,
  'scribe:redes-publications': true,
  'scribe:redes-media-pick': true,
  'scribe:redes-publication-save': true,
  'scribe:redes-publication-delete': true,
  'scribe:redes-publication-schedule': true,
  'scribe:redes-publication-publish': true,
  'scribe:redes-publication-unschedule': true,
  'scribe:redes-publication-retry': true,
  'scribe:redes-quota': true,
  'scribe:redes-media-thumb': true,
  // 73: comentários
  'scribe:redes-comments': true,
  'scribe:redes-comments-refresh': true,
  'scribe:redes-comment-reply': true,
  'scribe:redes-comment-hide': true,
  'scribe:redes-comment-delete': true,
  'scribe:redes-comments-read': true,
  // fim 73
  // 75: métricas
  'scribe:redes-metrics': true,
  'scribe:redes-metrics-refresh': true,
  // fim 75
  // 74: mensagens
  'scribe:redes-messages': true,
  'scribe:redes-messages-refresh': true,
  'scribe:redes-message-send': true,
  'scribe:redes-conversation-read': true,
  // fim 74
  // 110: funil
  'scribe:funil-get': true,
  'scribe:funil-contato-save': true,
  'scribe:funil-contato-archive': true,
  'scribe:funil-empresa-save': true,
  'scribe:funil-empresa-delete': true,
  'scribe:funil-oportunidade-save': true,
  'scribe:funil-oportunidade-move': true,
  'scribe:funil-oportunidade-delete': true,
  'scribe:funil-oportunidade-archive': true,
  'scribe:funil-etapas-save': true,
  'scribe:funil-evento-add': true,
  'scribe:funil-sugestoes': true,
  'scribe:funil-ignorar': true,
  'scribe:funil-importar-abrir': true,
  'scribe:funil-importar-confirmar': true,
  'scribe:funil-timeline': true,
  // fim 110
  // 113: proposta do funil
  'scribe:funil-proposta-get': true,
  'scribe:funil-proposta-aplicar': true,
  'scribe:funil-proposta-descartar': true,
  'scribe:funil-proposta-detectar': true,
  // fim 113
  // 122: tarefas
  'scribe:tarefas-get': true,
  'scribe:tarefas-criar': true,
  'scribe:tarefas-salvar': true,
  'scribe:tarefas-status': true,
  'scribe:tarefas-apagar': true,
  'scribe:tarefas-sugestoes': true,
  'scribe:tarefas-ignorar': true,
  'scribe:tarefas-adicionar-do-resumo': true,
  // fim 122
  // 134: inicio
  'scribe:inicio-get': true,
  'scribe:inicio-mac-acesso': true,
  'scribe:inicio-atualizar': true,
  // fim 134
  // 138: atendimento
  'scribe:atendimento-state': true,
  'scribe:atendimento-agent-save': true,
  'scribe:atendimento-agent-delete': true,
  'scribe:atendimento-binding-save': true,
  'scribe:atendimento-binding-delete': true,
  'scribe:atendimento-pause-all': true,
  'scribe:atendimento-risk-accept': true,
  'scribe:atendimento-log-list': true,
  // fim 138
  // 141: atendimento
  'scribe:atendimento-runtime': true,
  'scribe:atendimento-agent-test': true,
  'scribe:atendimento-draft-send': true,
  'scribe:atendimento-draft-discard': true,
  // fim 141
}
const RENDERER_EVENTS: Record<RendererEvent, true> = {
  'scribe:csp-violation': true,
  'scribe:open-privacy-settings': true,
  'scribe:open-key-dashboard': true,
  'scribe:chat-close': true,
  'scribe:chat-leave': true,
  'scribe:open-link': true,
  'scribe:lock-activity': true,
  'scribe:whatsapp-click': true,
  'scribe:whatsapp-pair-cancel': true,
  'scribe:whatsapp-viewing': true,
  'scribe:email-click': true,
  'scribe:invite-suggest-click': true,
  'scribe:redes-click': true,
  'scribe:email-viewing': true,
  'scribe:email-folder-watch': true,
}
const MAIN_EVENTS: Record<MainEvent, true> = {
  'scribe:navigate': true,
  'scribe:new-recording': true,
  'scribe:settings-changed': true,
  'scribe:claude-state': true,
  'scribe:acp-state': true,
  'scribe:summary-state': true,
  'scribe:analyses-changed': true,
  'scribe:update-state': true,
  'scribe:chat-event': true,
  'scribe:lock-state': true,
  'scribe:recording-end-and-quit': true,
  'scribe:google-state': true,
  'scribe:microsoft-state': true,
  'scribe:calendar-state': true,
  'scribe:drive-state': true,
  'scribe:whatsapp-state': true,
  'scribe:whatsapp-message': true,
  'scribe:whatsapp-chats-changed': true,
  'scribe:whatsapp-reactions': true,
  'scribe:whatsapp-presence': true,
  'scribe:automation-event': true,
  'scribe:automations-changed': true,
  'scribe:open-run': true,
  'scribe:open-whatsapp': true,
  'scribe:recording-end': true,
  'scribe:open-meeting': true,
  'scribe:open-settings': true,
  'scribe:notes-changed': true,
  'scribe:meet-changed': true,
  'scribe:meeting-prompt-changed': true,
  'scribe:navegador-changed': true,
  'scribe:email-state': true,
  'scribe:email-message': true,
  'scribe:email-changed': true,
  'scribe:email-organize': true,
  'scribe:open-email': true,
  'scribe:open-redes': true,
  'scribe:redes-state': true,
  'scribe:redes-publications': true,
  // 73: comentários
  'scribe:redes-comments': true,
  // fim 73
  // 75: métricas
  'scribe:redes-metrics': true,
  // fim 75
  // 74: mensagens
  'scribe:redes-messages': true,
  // fim 74
  // 110: funil
  'scribe:funil-changed': true,
  // fim 110
  // 113: proposta do funil
  'scribe:funil-proposta-changed': true,
  // fim 113
  // 122: tarefas
  'scribe:tarefas-changed': true,
  'scribe:open-tarefa': true,
  // fim 122
  // 134: inicio
  'scribe:inicio-changed': true,
  // fim 134
  // 141: atendimento
  'scribe:atendimento-changed': true,
  // fim 141
}

/**
 * O que cada canal faz com o app bloqueado (contrato 22, CA4). O registro do main (`main/ipc.ts`) é o ponto
 * único que aplica, e é uma lista de permitidos: só passa o canal marcado `allowed`, e `session` só com o token
 * da gravação em curso; qualquer outro valor, ou um canal fora deste mapa, devolve o erro `locked` sem chamar o
 * handler. Passam o próprio bloqueio, o que a janela precisa para abrir e pintar a camada sem conteúdo nenhum
 * (versão, tema, marca, permissões, aviso de versão) e o que a gravação em curso usa enquanto grava. Os canais
 * de fim de gravação (`session`) passam só com o token da sessão aberta: bloquear no meio do "Encerrar" não
 * perde a reunião. Todo o resto é recusado: leitura de reuniões, transcrição, resumo, notas, análises, chat,
 * arquivos, busca, cópia para a área de transferência e qualquer ação ou mudança de configuração.
 * `Record<..., …>` obriga a classificar todo canal novo.
 */
export type LockedPolicy = 'allowed' | 'session' | 'refused'

/** Canais de fim de gravação: passam bloqueado só com o token da sessão (`ScribeApi.invokeInSession`). */
export const RECORDING_SESSION_CHANNELS = [
  'scribe:meetings-create',
  'scribe:transcript-save',
  'scribe:notes-save',
  'scribe:analyses-save',
  'scribe:analyses-add',
  'scribe:audio-finish',
  // Só o resumo automático (`auto: true`).
  'scribe:summary-generate',
  // Contrato 30: cancela o ciclo da IA anotando em curso.
  'scribe:ai-notes-cancel',
] as const satisfies readonly InvokeChannel[]
export type RecordingSessionChannel = (typeof RECORDING_SESSION_CHANNELS)[number]

/** Segundo argumento do `invoke` de um canal de fim de gravação. */
export interface RecordingSessionTag {
  recordingSession: string
}

export const WHEN_LOCKED: Readonly<Record<InvokeChannel, LockedPolicy>> = Object.freeze({
  // O próprio bloqueio.
  'scribe:lock-status': 'allowed',
  'scribe:lock-now': 'allowed',
  'scribe:lock-unlock': 'allowed',
  'scribe:lock-touch-id': 'allowed',
  // Criar, trocar e remover a senha são de Configurações: só com o app desbloqueado.
  'scribe:lock-password-set': 'refused',
  'scribe:lock-password-remove': 'refused',
  // A janela abre e pinta a camada sem conteúdo nenhum.
  'scribe:app-info': 'allowed',
  'scribe:capture-mode': 'allowed',
  'scribe:settings-get': 'allowed',
  'scribe:branding-get': 'allowed',
  'scribe:mic-access': 'allowed',
  'scribe:update-get': 'allowed',
  // A gravação em curso continua: token de reconexão, tradução de cada trecho, o processo do `claude` e o
  // áudio que vai para a pasta, e o fim da sessão.
  'scribe:transcription-token': 'allowed',
  'scribe:translate-turn': 'allowed',
  'scribe:claude-start': 'allowed',
  'scribe:claude-translate': 'allowed',
  'scribe:claude-stop': 'allowed',
  'scribe:audio-append': 'allowed',
  'scribe:recording-session-close': 'allowed',
  // Uma gravação só começa pela tela, que está bloqueada.
  'scribe:recording-session-open': 'refused',
  'scribe:meetings-list': 'refused',
  'scribe:meetings-get': 'refused',
  'scribe:meetings-create': 'session',
  'scribe:meetings-rename': 'refused',
  'scribe:meetings-delete': 'refused',
  'scribe:meetings-overview': 'refused',
  'scribe:meetings-search': 'refused',
  'scribe:folders-list': 'refused',
  'scribe:folders-create': 'refused',
  'scribe:folders-rename': 'refused',
  'scribe:folders-delete': 'refused',
  'scribe:meetings-move': 'refused',
  'scribe:settings-update': 'refused',
  'scribe:key-status': 'refused',
  'scribe:key-save': 'refused',
  'scribe:key-verify': 'refused',
  'scribe:key-remove': 'refused',
  'scribe:models-list': 'refused',
  'scribe:model-select': 'refused',
  'scribe:mic-access-request': 'refused',
  'scribe:transcript-save': 'session',
  'scribe:transcript-get': 'refused',
  'scribe:transcript-copy': 'refused',
  'scribe:notes-get': 'refused',
  'scribe:notes-save': 'session',
  'scribe:notes-copy': 'refused',
  'scribe:claude-locate': 'refused',
  'scribe:acp-status': 'refused',
  'scribe:acp-install': 'refused',
  'scribe:acp-remove': 'refused',
  'scribe:claude-path-set': 'refused',
  'scribe:audio-folder': 'refused',
  'scribe:audio-folder-choose': 'refused',
  'scribe:audio-begin': 'refused',
  'scribe:audio-finish': 'session',
  'scribe:meeting-files': 'refused',
  'scribe:meeting-file-open': 'refused',
  'scribe:meeting-file-reveal': 'refused',
  'scribe:meeting-file-download': 'refused',
  'scribe:summary-get': 'refused',
  'scribe:summary-generate': 'session',
  'scribe:summary-copy': 'refused',
  'scribe:analysis-run': 'refused',
  'scribe:analyses-get': 'refused',
  'scribe:analyses-save': 'session',
  'scribe:analyses-add': 'session',
  'scribe:analysis-copy': 'refused',
  // Contrato 30: bloqueado, o ciclo da IA é pulado (a gravação segue).
  'scribe:ai-notes-run': 'refused',
  // Cancelar no "Encerrar" passa com o token da gravação, como o resto do fim dela.
  'scribe:ai-notes-cancel': 'session',
  'scribe:brand-logo-choose': 'refused',
  'scribe:brand-logo-reset': 'refused',
  'scribe:update-check': 'refused',
  'scribe:update-download': 'refused',
  'scribe:update-quit': 'refused',
  'scribe:chat-list': 'refused',
  'scribe:chat-get': 'refused',
  'scribe:chat-send': 'refused',
  'scribe:chat-stop': 'refused',
  'scribe:chat-delete': 'refused',
  'scribe:chat-update': 'refused',
  'scribe:chat-redo': 'refused',
  'scribe:chat-copy': 'refused',
  // Assistente (contrato 25, CA5): os cartões de ação, recusados com o app bloqueado.
  'scribe:chat-action-reminder': 'refused',
  'scribe:chat-action-state': 'refused',
  // Contrato 78: o evento no Calendário e alterar ou apagar um lembrete, também recusados com o app bloqueado.
  'scribe:chat-action-event': 'refused',
  'scribe:chat-action-reminder-change': 'refused',
  // Contrato 76: o rascunho do Instagram pelo cartão, recusado com o app bloqueado como os outros cartões.
  'scribe:chat-action-instagram-draft': 'refused',
  // Contrato 117: os cartões do funil, recusados com o app bloqueado como os outros cartões.
  'scribe:chat-action-funil': 'refused',
  'scribe:chat-action-tarefa': 'refused',
  // Contrato 21: as conexões MCP não aparecem nem mudam com o app bloqueado; o cartão sem resposta nega em 2 min.
  'scribe:chat-approval': 'refused',
  'scribe:mcp-chat-servers': 'refused',
  'scribe:mcp-overview': 'refused',
  'scribe:mcp-test': 'refused',
  'scribe:mcp-save': 'refused',
  'scribe:mcp-update': 'refused',
  'scribe:mcp-remove': 'refused',
  'scribe:mcp-details': 'refused',
  'scribe:mcp-import': 'refused',
  'scribe:mcp-connector-tools': 'refused',
  // Conta Google e Drive (contrato 11): tudo é de Configurações e do detalhe, recusado bloqueado. A fila de envio
  // não depende de canal: roda no main e continua com o app bloqueado.
  'scribe:google-status': 'refused',
  'scribe:google-client-save': 'refused',
  'scribe:google-sign-in': 'refused',
  'scribe:google-sign-in-cancel': 'refused',
  'scribe:google-sign-out': 'refused',
  // Contrato 12: a conta Microsoft e as agendas, tudo de Configurações e das telas, recusado bloqueado. A leitura das
  // agendas e os avisos rodam no main e continuam bloqueado (a notificação sai sem conteúdo).
  'scribe:google-calendar-grant': 'refused',
  'scribe:microsoft-status': 'refused',
  'scribe:microsoft-client-save': 'refused',
  'scribe:microsoft-sign-in': 'refused',
  'scribe:microsoft-sign-in-cancel': 'refused',
  'scribe:microsoft-sign-out': 'refused',
  'scribe:calendar-get': 'refused',
  'scribe:calendar-list': 'refused',
  'scribe:calendar-record': 'refused',
  'scribe:calendar-dismiss': 'refused',
  'scribe:calendar-join': 'refused',
  'scribe:calendar-recording': 'refused',
  // Contrato 27: o estado do Meet não aparece com o app bloqueado; o servidor continua coletando para a gravação.
  'scribe:meet-status': 'refused',
  // Contrato 48: bloqueado, o aviso nem abre (e fecha se estava aberto); os botões dele também ficam recusados.
  'scribe:meeting-prompt-state': 'refused',
  'scribe:meeting-prompt-act': 'refused',
  'scribe:plugin-save': 'refused',
  'scribe:navegador-status': 'refused',
  'scribe:navegador-set': 'refused',
  'scribe:drive-status': 'refused',
  'scribe:drive-retry': 'refused',
  'scribe:drive-open': 'refused',
  // WhatsApp (contrato 24, CA6): tudo recusado com o app bloqueado. O serviço continua conectado no main (as
  // mensagens não se perdem), mas nada chega à tela até desbloquear.
  'scribe:whatsapp-status': 'refused',
  'scribe:whatsapp-risk-accept': 'refused',
  'scribe:whatsapp-install': 'refused',
  'scribe:whatsapp-start': 'refused',
  'scribe:whatsapp-stop': 'refused',
  'scribe:whatsapp-pair': 'refused',
  'scribe:whatsapp-logout': 'refused',
  'scribe:whatsapp-remove': 'refused',
  'scribe:whatsapp-chats': 'refused',
  'scribe:whatsapp-messages': 'refused',
  'scribe:whatsapp-search': 'refused',
  'scribe:whatsapp-send': 'refused',
  // Contrato 39: o envio do anexo e o seletor de arquivo, como o resto do WhatsApp.
  'scribe:whatsapp-send-media': 'refused',
  'scribe:whatsapp-attach-pick': 'refused',
  // Contrato 34: a reação (um envio) e o "digitando…", como o resto do WhatsApp.
  'scribe:whatsapp-react': 'refused',
  'scribe:whatsapp-typing': 'refused',
  'scribe:whatsapp-draft': 'refused',
  'scribe:whatsapp-link-get': 'refused',
  'scribe:whatsapp-link-set': 'refused',
  'scribe:whatsapp-photo': 'refused',
  'scribe:whatsapp-media': 'refused',
  'scribe:whatsapp-transcribe': 'refused',
  'scribe:whatsapp-insights': 'refused',
  'scribe:whatsapp-insights-run': 'refused',
  // Email (contrato 42, CA7): tudo recusado com o app bloqueado, como o WhatsApp. As contas continuam conectadas no main
  // (as mensagens chegam ao cache), mas nada chega à tela até desbloquear.
  'scribe:email-accounts': 'refused',
  'scribe:email-autoconfig': 'refused',
  'scribe:email-add-account': 'refused',
  'scribe:email-remove-account': 'refused',
  'scribe:email-messages': 'refused',
  'scribe:email-get-body': 'refused',
  'scribe:email-mark-read': 'refused',
  'scribe:email-delete': 'refused',
  'scribe:email-send': 'refused',
  // Contrato 61: a resposta de convite é envio, como o "Enviar".
  'scribe:invite-reply': 'refused',
  // Contrato 62 (N6): o cartão não aparece bloqueado, e a agenda também não muda.
  'scribe:invite-state': 'refused',
  'scribe:invite-add': 'refused',
  'scribe:invite-update': 'refused',
  'scribe:invite-remove': 'refused',
  'scribe:invite-calendars': 'refused',
  'scribe:invite-request-access': 'refused',
  'scribe:invite-open-ics': 'refused',
  // Contrato 64: o "Sugerir evento" e a gravação da sugestão.
  'scribe:invite-suggest': 'refused',
  'scribe:invite-suggest-add': 'refused',
  // Contrato 43: o teste da conta, o clipe do composer e as imagens remotas, como o resto do email.
  'scribe:email-test': 'refused',
  'scribe:email-attach-pick': 'refused',
  'scribe:email-remote-images': 'refused',
  'scribe:email-attachment-save': 'refused',
  'scribe:email-attachments': 'refused',
  // Contrato 52: as pastas, como o resto do email.
  'scribe:email-folders': 'refused',
  'scribe:email-open-folder': 'refused',
  'scribe:email-move': 'refused',
  'scribe:email-folder-create': 'refused',
  'scribe:email-folder-rename': 'refused',
  'scribe:email-folder-delete': 'refused',
  // Contrato 54: a assinatura, como o resto do email.
  'scribe:email-signature-get': 'refused',
  'scribe:email-signature-set': 'refused',
  // Contrato 53: as regras, como o resto do email.
  'scribe:email-rules-get': 'refused',
  'scribe:email-rules-set': 'refused',
  'scribe:email-rules-preview': 'refused',
  'scribe:email-rules-run': 'refused',
  // Contrato 56: o lote do Assistente, como o resto do email.
  'scribe:email-organize-state': 'refused',
  'scribe:email-batch-get': 'refused',
  'scribe:email-batch-undo': 'refused',
  // Automações (contrato 23, CA10): gerenciar agentes e tarefas, testar, pedir e ver o histórico, tudo recusado com
  // o app bloqueado. O agendador não depende de canal: roda no main e as tarefas continuam rodando bloqueado.
  'scribe:agents-list': 'refused',
  'scribe:agents-save': 'refused',
  'scribe:agents-delete': 'refused',
  'scribe:agents-test': 'refused',
  'scribe:tasks-list': 'refused',
  'scribe:tasks-save': 'refused',
  'scribe:tasks-delete': 'refused',
  'scribe:tasks-toggle': 'refused',
  'scribe:tasks-run-now': 'refused',
  'scribe:automations-ask': 'refused',
  'scribe:runs-list': 'refused',
  'scribe:runs-get': 'refused',
  'scribe:runs-rerun': 'refused',
  'scribe:automations-status': 'refused',
  'scribe:automations-pause': 'refused',
  // Redes (contrato 69, R10, CA15): tudo recusado com o app bloqueado. A renovação diária do token segue no main.
  'scribe:redes-state': 'refused',
  'scribe:redes-connect': 'refused',
  'scribe:redes-refresh': 'refused',
  'scribe:redes-remove': 'refused',
  'scribe:redes-media-host-save': 'refused',
  'scribe:redes-media-host-test': 'refused',
  'scribe:redes-media-host-clear': 'refused',
  'scribe:redes-publications': 'refused',
  'scribe:redes-media-pick': 'refused',
  'scribe:redes-publication-save': 'refused',
  'scribe:redes-publication-delete': 'refused',
  'scribe:redes-publication-schedule': 'refused',
  'scribe:redes-publication-publish': 'refused',
  'scribe:redes-publication-unschedule': 'refused',
  'scribe:redes-publication-retry': 'refused',
  'scribe:redes-quota': 'refused',
  'scribe:redes-media-thumb': 'refused',
  // 73: comentários
  'scribe:redes-comments': 'refused',
  'scribe:redes-comments-refresh': 'refused',
  'scribe:redes-comment-reply': 'refused',
  'scribe:redes-comment-hide': 'refused',
  'scribe:redes-comment-delete': 'refused',
  'scribe:redes-comments-read': 'refused',
  // fim 73
  // 75: métricas
  'scribe:redes-metrics': 'refused',
  'scribe:redes-metrics-refresh': 'refused',
  // fim 75
  // 74: mensagens
  'scribe:redes-messages': 'refused',
  'scribe:redes-messages-refresh': 'refused',
  'scribe:redes-message-send': 'refused',
  'scribe:redes-conversation-read': 'refused',
  // fim 74
  // 110: funil (R47: todos recusados)
  'scribe:funil-get': 'refused',
  'scribe:funil-contato-save': 'refused',
  'scribe:funil-contato-archive': 'refused',
  'scribe:funil-empresa-save': 'refused',
  'scribe:funil-empresa-delete': 'refused',
  'scribe:funil-oportunidade-save': 'refused',
  'scribe:funil-oportunidade-move': 'refused',
  'scribe:funil-oportunidade-delete': 'refused',
  'scribe:funil-oportunidade-archive': 'refused',
  'scribe:funil-etapas-save': 'refused',
  'scribe:funil-evento-add': 'refused',
  'scribe:funil-sugestoes': 'refused',
  'scribe:funil-ignorar': 'refused',
  'scribe:funil-importar-abrir': 'refused',
  'scribe:funil-importar-confirmar': 'refused',
  'scribe:funil-timeline': 'refused',
  // fim 110
  // 113: proposta do funil (R47: todos recusados)
  'scribe:funil-proposta-get': 'refused',
  'scribe:funil-proposta-aplicar': 'refused',
  'scribe:funil-proposta-descartar': 'refused',
  'scribe:funil-proposta-detectar': 'refused',
  // fim 113
  // 122: tarefas (R36: todos recusados)
  'scribe:tarefas-get': 'refused',
  'scribe:tarefas-criar': 'refused',
  'scribe:tarefas-salvar': 'refused',
  'scribe:tarefas-status': 'refused',
  'scribe:tarefas-apagar': 'refused',
  'scribe:tarefas-sugestoes': 'refused',
  'scribe:tarefas-ignorar': 'refused',
  'scribe:tarefas-adicionar-do-resumo': 'refused',
  // fim 122
  // 134: inicio (D10: recusados; o `scribe:inicio-changed` só sai desbloqueado)
  'scribe:inicio-get': 'refused',
  'scribe:inicio-mac-acesso': 'refused',
  'scribe:inicio-atualizar': 'refused',
  // fim 134
  // 138: atendimento (recusados, como o resto do WhatsApp)
  'scribe:atendimento-state': 'refused',
  'scribe:atendimento-agent-save': 'refused',
  'scribe:atendimento-agent-delete': 'refused',
  'scribe:atendimento-binding-save': 'refused',
  'scribe:atendimento-binding-delete': 'refused',
  'scribe:atendimento-pause-all': 'refused',
  'scribe:atendimento-risk-accept': 'refused',
  'scribe:atendimento-log-list': 'refused',
  // fim 138
  // 141: atendimento (recusados; o serviço continua respondendo com o app bloqueado)
  'scribe:atendimento-runtime': 'refused',
  'scribe:atendimento-agent-test': 'refused',
  'scribe:atendimento-draft-send': 'refused',
  'scribe:atendimento-draft-discard': 'refused',
  // fim 141
})

/**
 * Mensagens sem resposta com o app bloqueado: abrir link, os Ajustes ou o painel da AssemblyAI é ignorado;
 * a violação de CSP, o fechamento das conversas e o uso do app passam.
 */
export const RENDERER_EVENTS_WHEN_LOCKED: Readonly<Record<RendererEvent, 'pass' | 'ignored'>> = Object.freeze({
  'scribe:csp-violation': 'pass',
  'scribe:chat-close': 'pass',
  'scribe:chat-leave': 'pass',
  'scribe:lock-activity': 'pass',
  'scribe:open-privacy-settings': 'ignored',
  'scribe:open-key-dashboard': 'ignored',
  'scribe:open-link': 'ignored',
  'scribe:whatsapp-click': 'ignored',
  'scribe:whatsapp-pair-cancel': 'pass',
  'scribe:whatsapp-viewing': 'ignored',
  'scribe:email-click': 'ignored',
  'scribe:invite-suggest-click': 'ignored',
  'scribe:redes-click': 'ignored',
  'scribe:email-viewing': 'ignored',
  'scribe:email-folder-watch': 'ignored',
})

/** Mensagens que só o próprio preload manda (o `send` genérico recusa): o clique do envio do WhatsApp. */
export const PRELOAD_ONLY_EVENTS: readonly RendererEvent[] = ['scribe:whatsapp-click']
/**
 * Contrato 42: o clique do envio do email, também só pelo preload (lista à parte: a do WhatsApp fica como estava).
 * Contrato 64: e o clique do "Sugerir evento".
 */
export const EMAIL_PRELOAD_ONLY_EVENTS: readonly RendererEvent[] = ['scribe:email-click', 'scribe:invite-suggest-click']
/** Contrato 71: o clique do "Publicar agora" e do "Agendar" das redes, também só pelo preload (lista à parte). */
export const REDES_PRELOAD_ONLY_EVENTS: readonly RendererEvent[] = ['scribe:redes-click']
/** Contrato 71: "Publicar agora" ou "Agendar" sem o clique da pessoa (o preload e o main devolvem o mesmo texto). */
export const REDES_CLICK_MESSAGE = 'Clique em Publicar agora ou Agendar para confirmar'
// 74: mensagens
/** Contrato 74: o "Enviar" da mensagem direta sem o clique da pessoa (o preload e o main devolvem o mesmo texto). */
export const REDES_MESSAGE_CLICK_MESSAGE = 'Clique em Enviar para mandar a mensagem'
// fim 74
// 73: comentários
/** Contrato 73: responder ou excluir um comentário sem o clique da pessoa (o preload e o main devolvem o mesmo texto). */
export const REDES_COMMENT_CLICK_MESSAGE = 'Clique em Responder ou Excluir para confirmar'
// fim 73

export const INVOKE_CHANNELS = Object.keys(INVOKE) as InvokeChannel[]
export const RENDERER_EVENT_CHANNELS = Object.keys(RENDERER_EVENTS) as RendererEvent[]
export const MAIN_EVENT_CHANNELS = Object.keys(MAIN_EVENTS) as MainEvent[]

/** API exposta pelo preload em `window.__scribeApi`. */
export interface ScribeApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeChannels[C]['response']>
  /** O mesmo `invoke` com o token da gravação em curso: só os canais de fim de gravação (contrato 22). */
  invokeInSession<C extends RecordingSessionChannel>(token: string, channel: C, request: InvokeChannels[C]['request']): Promise<InvokeChannels[C]['response']>
  send<C extends RendererEvent>(channel: C, payload: RendererEvents[C]): void
  on<C extends MainEvent>(channel: C, listener: (payload: MainEvents[C]) => void): () => void
  /**
   * "Enviar" do WhatsApp (contrato 24, CA4): chamado no clique (ou ⌘↵) da pessoa. O preload confere a ativação do
   * usuário no frame, gera o token de clique, registra no main e envia com ele. Sem clique de verdade, recusado.
   */
  whatsappSend(request: Omit<WhatsAppSendRequest, 'clickToken'>): Promise<WhatsAppSendResult>
  /** Contrato 39: o "Enviar" com um anexo, pelo mesmo token de clique do `whatsappSend`. */
  whatsappSendMedia(request: Omit<WhatsAppSendMediaRequest, 'clickToken'>): Promise<WhatsAppSendMediaResult>
  /** Contrato 34: reagir é envio: o mesmo token de clique do `whatsappSend`, gerado só com a ativação do usuário viva. */
  whatsappReact(request: Omit<WhatsAppReactRequest, 'clickToken'>): Promise<WhatsAppReactResult>
  /**
   * Contrato 141: "Enviar" a proposta do agente de atendimento, com o mesmo token de clique do `whatsappSend` (ativação
   * viva no frame, registrada no main antes do pedido). Sem clique de verdade, recusado e a proposta fica.
   */
  atendimentoDraftSend(request: Omit<AtendimentoDraftSendRequest, 'clickToken'>): Promise<AtendimentoDraftSendResult>
  /** Contrato 42: o "Enviar" do email, com o mesmo desenho do `whatsappSend` (ativação viva, token de clique). */
  emailSend(request: Omit<EmailSendRequest, 'clickToken'>): Promise<EmailSendResult>
  /** Contrato 61: "Aceitar", "Talvez" ou "Recusar" de um convite, pelo mesmo token de clique do `emailSend`. */
  inviteReply(request: Omit<InviteReplySendRequest, 'clickToken'>): Promise<InviteReplySendResult>
  /** Contrato 64: "Sugerir evento", com o desenho do `emailSend` (ativação viva, token de clique) e guarda próprio. */
  inviteSuggest(request: Omit<InviteSuggestRequest, 'clickToken'>): Promise<InviteSuggestResult>
  /**
   * Contrato 71: "Publicar agora" das redes, com o desenho do `emailSend` (ativação viva, token de clique) e guarda próprio.
   * Contrato 72: com `save`, a edição da tela vai junto e o main salva depois de gastar o token (`id` `null` numa nova).
   */
  redesPublish(id: string | null, save?: PublicationSaveInput): Promise<PublicationActionResult>
  /** Contrato 71: "Agendar" (`at` em ISO), pelo mesmo token de clique do `redesPublish`. */
  redesSchedule(id: string | null, at: string, save?: PublicationSaveInput): Promise<PublicationActionResult>
  // 74: mensagens
  /** Contrato 74: "Enviar" a resposta de uma mensagem direta, pelo mesmo token de clique das redes (ativação viva). */
  redesMessageSend(request: { accountId: string; conversationId: string; text: string }): Promise<RedesMessageSendResult>
  // fim 74
  // 73: comentários
  /** Contrato 73: "Responder" um comentário, pelo mesmo token de clique das redes (ativação viva). */
  redesCommentReply(accountId: string, commentId: string, message: string): Promise<RedesCommentReplyResult>
  /** Contrato 73: "Excluir" um comentário (o clique da confirmação), pelo mesmo token de clique. */
  redesCommentDelete(accountId: string, commentId: string): Promise<RedesCommentActionResult>
  // fim 73
}
