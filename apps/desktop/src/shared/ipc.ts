// Contrato das mensagens entre main e renderer. Canal novo entra aqui primeiro: no mapa do
// sentido certo e na lista de canais permitidos logo abaixo (o preload recusa o que não estiver nela).
import type { AcpAgentStatus } from './acp'
import type { ChatActionReminderRequest, ChatActionResult, ChatActionStateRequest } from './assistant'
import type { AgentDeleteResult, AgentInput, AgentSaveResult, AgentsList, AutomationEvent, AutomationRun, AutomationRunListItem, AutomationsStatus, RunStartResult, RunStatus, ScheduledTask, TaskInput, TaskSaveResult } from './automations'
import type { DriveMeetingStatus, GoogleAccountStatus, GoogleClientSaveResult, MicrosoftAccountStatus, MicrosoftClientSaveResult } from './accounts'
import type { CalendarListResult, CalendarView } from './calendar'
import type { BrandingInfo, BrandLogoChoice } from './branding'
import type { LockResponse, LockStatus } from './lock'
import type { KeySaveResult, KeyStatus, MicAccess, ModelCheck, ModelsResult } from './assemblyai'
import type { Chat, ChatEvent, ChatListItem, ChatRedoRequest, ChatSendRequest, ChatSendResult, ChatUpdateRequest } from './chat'
import type { ClaudeLocateResult, ClaudeRunState, ClaudeStartResult, ClaudeTranslateRequest, ClaudeTranslateResult } from './claude-cli'
import type { AudioBeginResult, AudioExtension, AudioFinishResult, AudioFolderInfo, MeetingDownloadKind, MeetingDownloadResult, MeetingFileKind, MeetingFilesInfo } from './meeting-files'
import type { MeetState } from './meet'
import type { NavegadorState } from './navegador'
import type { AppPluginId, PluginSaveResult } from './plugins'
import type { AiNotesRunRequest, AiNotesRunResult } from './ai-notes'
import type { AnalysisRunRequest, AnalysisRunResult, MeetingAnalysis } from './meeting-analysis'
import type { MeetingNote } from './meeting-notes'
import type { SummaryStatus } from './meeting-summary'
import type { Meeting, MeetingFolder, NewMeeting } from './meetings'
import type { MeetingOverview, MeetingSearchResult } from './meetings-overview'
import type { RouteId } from './routes'
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
export type PrivacyPane = 'microphone' | 'audio-capture'

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
  /** Um agente acrescentou um post-it à reunião (contrato 23): o detalhe aberto relê as anotações. */
  'scribe:notes-changed': { meetingId: string }
  /**
   * A extensão do Meet (contrato 27) conectou, desconectou, mudou os participantes ou mandou eventos de fala. Chega
   * também com o app bloqueado: a gravação continua no bloqueio e cada evento vale pelo horário em que chega.
   */
  'scribe:meet-changed': MeetState
  /** A ponte do "Controle do navegador" (contrato 46) ligou, desligou, conectou ou desconectou. */
  'scribe:navegador-changed': NavegadorState
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
  'scribe:notes-changed': true,
  'scribe:meet-changed': true,
  'scribe:navegador-changed': true,
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
})

/** Mensagens que só o próprio preload manda (o `send` genérico recusa): o clique do envio do WhatsApp. */
export const PRELOAD_ONLY_EVENTS: readonly RendererEvent[] = ['scribe:whatsapp-click']

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
}
