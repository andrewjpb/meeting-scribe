// Contrato das mensagens entre main e renderer. Canal novo entra aqui primeiro: no mapa do
// sentido certo e na lista de canais permitidos logo abaixo (o preload recusa o que não estiver nela).
import type { AcpAgentStatus } from './acp'
import type { BrandingInfo, BrandLogoChoice } from './branding'
import type { KeySaveResult, KeyStatus, MicAccess, ModelCheck, ModelsResult } from './assemblyai'
import type { Chat, ChatEvent, ChatListItem, ChatRedoRequest, ChatSendRequest, ChatSendResult, ChatUpdateRequest } from './chat'
import type { ClaudeLocateResult, ClaudeRunState, ClaudeStartResult, ClaudeTranslateRequest, ClaudeTranslateResult } from './claude-cli'
import type { AudioBeginResult, AudioExtension, AudioFinishResult, AudioFolderInfo, MeetingDownloadKind, MeetingDownloadResult, MeetingFileKind, MeetingFilesInfo } from './meeting-files'
import type { AnalysisRunRequest, AnalysisRunResult, MeetingAnalysis } from './meeting-analysis'
import type { MeetingNote } from './meeting-notes'
import type { SummaryStatus } from './meeting-summary'
import type { Meeting, NewMeeting } from './meetings'
import type { MeetingOverview, MeetingSearchResult } from './meetings-overview'
import type { RouteId } from './routes'
import type { AppSettings, SettingsPatch } from './settings-defaults'
import type { TranscriptCopyResult, TranscriptDocument, TranslateTurnResult, TranscriptionTokenResult } from './transcription'
import type { UpdateState } from './updates'

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
  /** Chat "Perguntar" (contrato 15): conversas da tela (`meetingId: null`) ou da aba de uma reunião. */
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
}
const RENDERER_EVENTS: Record<RendererEvent, true> = {
  'scribe:csp-violation': true,
  'scribe:open-privacy-settings': true,
  'scribe:open-key-dashboard': true,
  'scribe:chat-close': true,
  'scribe:chat-leave': true,
  'scribe:open-link': true,
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
}

export const INVOKE_CHANNELS = Object.keys(INVOKE) as InvokeChannel[]
export const RENDERER_EVENT_CHANNELS = Object.keys(RENDERER_EVENTS) as RendererEvent[]
export const MAIN_EVENT_CHANNELS = Object.keys(MAIN_EVENTS) as MainEvent[]

/** API exposta pelo preload em `window.__scribeApi`. */
export interface ScribeApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeChannels[C]['response']>
  send<C extends RendererEvent>(channel: C, payload: RendererEvents[C]): void
  on<C extends MainEvent>(channel: C, listener: (payload: MainEvents[C]) => void): () => void
}
