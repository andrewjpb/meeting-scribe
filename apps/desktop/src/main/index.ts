// Processo principal: esquema do app, segurança da sessão, IPC, menu e janela.
import { resolveMx } from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, Notification, powerMonitor, safeStorage, screen, session, shell, systemPreferences, Tray, type MenuItemConstructorOptions, type NativeImage, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { DRIVE_FOLDER_URL_PREFIX } from '../shared/accounts'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import type { ChatActionResult } from '../shared/assistant'
import { formatRunAt, formatRunShort, type AutomationRun } from '../shared/automations'
import { chatSourcesOf } from '../shared/chat'
import { brandTexts, DEFAULT_BRAND_NAME } from '../shared/branding'
import { calendarNoticeText, safeJoinUrl, type CalendarNotice } from '../shared/calendar'
import { lockedWindowTitle, type LockStatus } from '../shared/lock'
import type { NavegadorState } from '../shared/navegador'
import type { AppPluginId, PluginSaveResult } from '../shared/plugins'
import { privacyPaneUrl } from '../shared/privacy'
import type { MainEvents } from '../shared/ipc'
import type { AvisoTarefa } from '../shared/tarefas'
import type { AgentProfileId, AppSettings } from '../shared/settings-defaults'
import type { TranscriptDocument } from '../shared/transcription'
import { WHATSAPP_CHAT_ID_PATTERN, whatsappStateLabel, type WhatsAppMessage } from '../shared/whatsapp'
import { isBrowserUrl } from './accounts/oauth'
import { createFileAgentsStore } from './agents/store'
import { netHttp } from './accounts/transport'
import { createGatewayClient, type FetchInit, type FetchResponse } from './assemblyai/gateway'
import { createFileTranscriber } from './assemblyai/transcript'
import { createTokenClient, requestToken } from './assemblyai/token'
import { createTranslationService } from './assemblyai/translation'
import { createMeetingDownload, type SaveDialog } from './audio-files/download'
import { createMeetingFilesService, type FileOpener, type FolderDialog, type MeetingFilesService } from './audio-files/service'
import { writeSummaryFile } from './audio-files/summary-file'
import { applyBrandName, applyDockIcon, type DockIconTarget } from './branding/apply'
import { createBrandingService, type BrandingService, type ImageDialog } from './branding/service'
import { registerDisplayMediaHandler } from './capture/display-media'
import { createChatCorpus, type ChatCorpus } from './chat/corpus'
import { cachedCalendarReads, calendarOverview, createChatActions, extractActions, markEmailBatchCard, type CachedCalendarReads, type ChatActions } from './chat/actions'
import { createChatEventsStore } from './chat/events-store'
import { createChatService, type ChatService } from './chat/service'
import { AUTOMATION_RUNS_IN_SOURCE, writeSources, type AssistantState } from './chat/sources'
import { createFileChatStore } from './chat/store'
import { createGoogleAccount, type GoogleAccountService } from './google/account'
import { createMicrosoftAccount, type MicrosoftAccountService } from './microsoft/account'
import { createCalendarService, type CalendarService } from './calendar/service'
import { createMeetServer, type MeetServer } from './meet/server'
import { createMeetingPromptController, type MeetingPromptController, type MeetingPromptSettings } from './meeting-prompt/controller'
import { createMeetingPromptWindow } from './meeting-prompt/window'
import { createMicWatchService, locateMicWatch, type MicWatchService } from './mic-watch/process'
import { recordingTitleFor } from '../shared/meeting-prompt'
import { createNavegadorMcpServer, type NavegadorMcpServer } from './navegador/mcp'
import { createNavegadorServer, parseNavegadorSet, type NavegadorServer } from './navegador/server'
import { createPluginSave } from './plugins/save'
import { createDriveSync, createEndOfRecordingHooks, type DriveSyncService } from './google/drive-sync'
import { nodeExecFile } from './claude-cli/locate'
import { CLAUDE_CWD_DIR, createClaudeService, type ClaudeService } from './claude-cli/service'
import { nodeSpawnSummary } from './claude-cli/summary'
import { nodeSpawnClaude } from './claude-cli/translator'
import { broadcast, handle, onEvent, sendTo, setLockGate } from './ipc'
import { createRecordingSessions, leaveButtons, RECORDING_LEAVE_MESSAGE } from './lock/recording-session'
import { createLockService, type LockService, type TouchIdAccess } from './lock/service'
import { createFileLockStore } from './lock/store'
import { createFileAnalysesStore } from './meetings/analyses'
import { autoDetect } from './funil/apply-proposal'
import { createFunnelExtractService, type FunnelExtractService } from './funil/extract'
import { registerFunilIpc, type FunilPropostaIpcDeps } from './funil/ipc'
import { createFunilProposalStore } from './funil/proposals'
import { createFunilAlerts } from './funil/alerts'
import { funilMarkdown } from './funil/markdown'
import { createFunilService, type FunilService } from './funil/service'
import { createFunilStore } from './funil/store'
import { registerTarefasIpc } from './tarefas/ipc'
import { avisoMostrado, createDestinoPendente } from './tarefas/lembretes'
import { createTarefasService, type TarefasService } from './tarefas/service'
import { createTarefasStore } from './tarefas/store'
import { createAiNotesService, type AiNotesService } from './meetings/ai-notes-service'
import { createAnalysisService, type AnalysisService } from './meetings/analysis-service'
import { createMeetingsIndex, type MeetingsIndex } from './meetings/overview'
import { createFileNotesStore } from './meetings/notes'
import { createMeetingsService } from './meetings/service'
import { createFileMeetingsStore, folderCreateSchema, folderIdSchema, folderRenameSchema, meetingMoveSchema, type MeetingsStore } from './meetings/store'
import { createFileSummaryStore } from './meetings/summaries'
import { createSummaryService, type SummaryService } from './meetings/summary-service'
import { createFileTranscriptStore, MEETINGS_DIR, type TranscriptStore } from './meetings/transcripts'
import { aboutPanelOptions, buildMenuTemplate, MENU_IDS } from './menu'
import { createMicPermissions } from './permissions'
import { handleAppScheme, registerAppScheme } from './protocol'
import { createSecretStore, memorySafeStorage } from './secrets'
import { createMcpCli, loginPathOnce } from './mcp/cli'
import { createMcpService, type McpService } from './mcp/service'
import { createMcpStore } from './mcp/store'
import { APP_ORIGIN, applySessionSecurity, originOf } from './security'
import { createSettingsService, type SettingsService } from './settings/service'
import { createFileSettingsStore } from './settings/store'
import { isSmokeRun, prepareSmokeEnvironment, runSmoke, SMOKE_MEET_PORTS, SMOKE_NAVEGADOR_PORTS } from './smoke'
import { createSmokeAcp, createSmokeClaude, createSmokeFixtures, SMOKE_FAKE_KEY, writeSmokeMcpFixtures, type SmokeFixtures } from './smoke-fixtures'
import { acpOpener, processLauncher } from './acp/agent'
import { bundledAdapterEntry, bundledAgent, installedAgent, type AcpAgentService } from './acp/entry'
import { createAcpInstaller } from './acp/install'
import { agentProfile, type AgentProfile } from './acp/profiles'
import { applyOutput } from './schedules/outputs'
import { createAgentRunner } from './schedules/runner'
import { createAutomationsService, type AutomationNotice, type AutomationsService } from './schedules/service'
import { createFileRunsStore, createFileSchedulesStore } from './schedules/store'
import { createTrayController, createWindowLifecycle, todayMeetings, TRAY_LIST_MAX, trayJoinUrl, type TrayController, type TrayIcon, type TrayLike, type TrayRecent } from './tray/menu'
import { createUpdateService, type UpdateService } from './updates/service'
import { netDownload, netDownloadTarball, netFetch } from './updates/transport'
import { createMainWindow } from './window'
import { runClaudeOneShot } from './meetings/claude-one-shot'
import { ACP_DRAFT_DIR, DRAFT_TIMEOUT_MS, draftSystemPrompt, parseDraft } from './whatsapp/draft'
import { createCorrector } from './whatsapp/correct'
import { readAttachment } from './whatsapp/attach'
import { BRIDGE_FAKE_FILE, BRIDGE_FILES, nodeExec, PYTHON_CANDIDATES, WHATSAPP_DIR } from './whatsapp/install'
import { INSTALL_TEST_ENV, runInstallTest } from './whatsapp/install-test'
import { createInsightsCache, INSIGHTS_FILE } from './whatsapp/insights'
import { createInsightsService, type InsightsService } from './whatsapp/insights-service'
import { createWhatsAppNotifier, isGroupChat, shouldNotify, type NoticeHandle, type WhatsAppNotice } from './whatsapp/notify'
import { createWhatsAppService, type WhatsAppService } from './whatsapp/service'
import { EMAIL_DIR } from './email/email-store'
import { createEmailBatchStore } from './email/batches'
import type { EmailOrganizer } from './email/organize'
import { createEmailClickGuard, createEmailService, type EmailService } from './email/service'
import { createRedesService, REDES_ACCOUNT_MISSING_MESSAGE, type RedesService } from './redes/service'
import { testMediaHost } from './redes/media-host'
import { createRedesAssistant } from './redes/assistant-tools'
// 73: comentários
import type { RedesCommentsPayload } from '../shared/redes'
// fim 73
// 74: mensagens
import { failedMessagesPayload, MESSAGE_SEND_FAILED_MESSAGE } from './redes/messages'
// fim 74
// 75: métricas
import type { RedesMetricsState } from '../shared/redes'
// fim 75
import { createMacCalendar, locateMacCalendar, type MacCalendar } from './mac-calendar/process'
import { createInviteService, type InviteService } from './invites/service'
import { createInviteSuggester, createInviteSuggestChannels, type InviteSuggestChannels } from './invites/suggest'
import { INVITE_ERROR_MESSAGES } from '../shared/invite-state'
import { createEmailTools } from './email/assistant-tools'
import { emailStateLabel, exportEmail } from './email/export'
import { readEmailAttachments } from './email/attach'
import { createEmailNotifier, type EmailNotice } from './email/notify'
import { loadRemoteImages, readLimited, systemLookup, type HostLookup, type RemoteImageFetch } from './email/remote-images'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_REMOTE_IMAGE_MAX_BYTES, isInbox, type EmailFolder, type EmailMessage } from '../shared/email'

// `app.setName` fixa o `userData` (~/Library/Application Support/Meeting Scribe) e o item do Chaveiro:
// trocar este nome perderia reuniões, configurações e a chave. O nome que a pessoa vê é o da marca
// escolhida em Configurações (contrato 09, padrão "LAP Reuniões"); o menu do app fica com o nome do pacote.
const APP_NAME = 'Meeting Scribe'
const PACKAGE_DISPLAY_NAME = DEFAULT_BRAND_NAME
const smoke = isSmokeRun(process.argv)
/** Contrato 24: autoteste da instalação do WhatsApp no app empacotado, sem janela, sem `userData`, sem rede. */
const whatsappInstallTest = !smoke && process.env[INSTALL_TEST_ENV] === '1'

// O smoke troca o userData por uma pasta temporária; precisa acontecer antes de `ready`.
const smokeUserData = smoke ? prepareSmokeEnvironment(process.argv) : null
// Smoke: catálogo e respostas do gateway de fixtures, Chaveiro e permissão de microfone substitutos.
const smokeFixtures: SmokeFixtures | null = smoke && smokeUserData ? createSmokeFixtures(app.getVersion(), smokeUserData) : null

registerAppScheme()
app.setName(APP_NAME)
app.setAboutPanelOptions(aboutPanelOptions(DEFAULT_BRAND_NAME, app.getVersion()))

// Em desenvolvimento o electron-vite injeta a URL do servidor do Vite. O smoke usa sempre o build.
const devUrl = !app.isPackaged && !smoke ? process.env['ELECTRON_RENDERER_URL'] : undefined
const isDev = typeof devUrl === 'string'
const appOrigin = (isDev && originOf(devUrl)) || APP_ORIGIN
const appUrl = isDev ? devUrl : `${APP_ORIGIN}/index.html`
const rendererRoot = join(__dirname, '../renderer')

let mainWindow: BrowserWindow | null = null
/** Chat do "Assistente" (contratos 15 e 25), para a janela fechada avisar as conversas abertas. */
let chatService: ChatService | null = null
/** Nome da marca em uso (título da janela, "Sobre", `scribe:app-info`). */
let brandName = DEFAULT_BRAND_NAME
/** Último logo aplicado ao Dock; `undefined` antes da primeira vez. */
let dockLogo: string | null | undefined
/** Bloqueio do app (contrato 22): o estado fica no serviço; aqui, só o título e o menu acompanham. */
let lockService: LockService | null = null
/** "Encerrar e sair" escolhido: o app sai quando a gravação terminar de salvar. */
let quitAfterRecording = false
/** Gravação em curso (contrato 22): token dos canais de fim de gravação e confirmação ao fechar ou sair. */
const recordingSessions = createRecordingSessions(() => {
  // Contrato 12: a gravação acabou; os avisos de "não está gravando" voltam a valer para outras reuniões.
  calendarService?.recordingEnded()
  // Contrato 48: o título que veio do aviso de reunião vale só para esta gravação.
  meetingPromptController?.recordingEnded()
  // Contrato 23: a gravação terminou de salvar (ou a janela que gravava sumiu).
  onRecordingFinished?.()
  // Contrato 50: o tempo some da barra de menus e o menu volta a "Nova gravação".
  trayController?.refresh()
  if (!quitAfterRecording) return
  quitAfterRecording = false
  app.quit()
})
/** Fim da sessão de gravação: as reuniões dela seguem para as tarefas "depois de cada reunião" (contrato 23). */
let onRecordingFinished: (() => void) | null = null
/** Agendas e avisos (contrato 12). */
let calendarService: CalendarService | null = null
/** Um diálogo de "gravação em andamento" por vez. */
let leaveAsked = false
/** Envio ao Google Drive (contrato 11), para "Guardar no Google Drive" desligado esvaziar a fila. */
let driveService: DriveSyncService | null = null
/** WhatsApp (contrato 24): ao desbloquear, o estado volta às janelas; janela fechada esquece os cliques dela. */
let whatsappService: WhatsAppService | null = null
/** Email (contrato 42): o mesmo do WhatsApp, o estado ao desbloquear e os cliques da janela fechada. */
let emailService: EmailService | null = null
/** Redes (contrato 69): o estado volta às janelas ao desbloquear. */
let redesService: RedesService | null = null
/** Contrato 64: os canais do "Sugerir evento" (o guarda de clique sai com a janela). */
let inviteSuggestChannels: InviteSuggestChannels | null = null
/** Contrato 40: as configurações, lidas na hora de notificar e de pôr o número no Dock. */
let readSettings: (() => Promise<AppSettings>) | null = null
/** Servidor local da extensão do Meet (contrato 27): sobe e para com "Quem fala no Meet". */
let meetServer: MeetServer | null = null
/** Aviso "Começar a transcrever" ao entrar numa reunião (contrato 48). */
let meetingPromptController: MeetingPromptController | null = null
/** O `lap-mic-watch` (contrato 49): sobe e para com "Avisar quando uma reunião começar". */
let micWatchService: MicWatchService | null = null
/**
 * Janelas do aviso de reunião (contrato 48): ficam fora de `appWindows()`, então não recebem os eventos do app, não
 * levam o título da marca e fechar uma delas nunca conta como "fechar a última janela".
 */
const meetingPromptWindows = new WeakSet<BrowserWindow>()

/** As janelas do app (a principal e as do smoke), sem a do aviso de reunião. */
function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !meetingPromptWindows.has(win))
}
/** Ponte do "Controle do navegador" (contrato 46): sobe e para com "Ativar ponte" (`navegadorPlugin`). */
let navegadorServer: NavegadorServer | null = null
/** Última configuração vista de "Ativar ponte", para o estado que vai às janelas. */
let navegadorAtivo = false
/** Ícone da barra de menus (contrato 23, CA8): aparece sempre que o app está aberto. */
let trayController: TrayController | null = null
/** Último estado do bloqueio, para o menu do ícone ("Bloquear" só com senha ou Touch ID). */
let lastLockStatus: LockStatus | null = null
/** Começo da gravação em curso (o menu do ícone mostra "Gravando · 12:34"). */
let recordingStartedAt: number | null = null
/** Fechar a última janela e reabrir (contrato 23, CA9). */
let windowLifecycle: ReturnType<typeof createWindowLifecycle> | null = null
let trayHiddenNoticeShown = false
/** Post-its que os agentes acrescentaram e a tela ainda não leu, por reunião (contrato 23). */
const agentNotes = new Map<string, Set<string>>()
const NO_NOTES: ReadonlySet<string> = new Set()
/** "Abrir ao entrar no Mac": o último valor aplicado (só muda o item de login quando a pessoa troca). */
let loginItemApplied: boolean | null = null
/** Contrato 122 (R12, D7): o "Abrir" de uma tarefa pedido com o app bloqueado, mandado ao desbloquear. */
const destinoTarefa = createDestinoPendente()
/** Contrato 122: o serviço das tarefas, para reemitir a view ao desbloquear (o tick do dia pode ter rodado bloqueado). */
let tarefasService: TarefasService | null = null

/**
 * ⌘W ou ⌘Q com gravação em andamento: diálogo nativo. Bloqueado, só "Cancelar"; desbloqueado, também
 * "Encerrar e sair", que pede ao renderer para encerrar e sai depois de salvar. No smoke, o substituto responde.
 */
async function confirmLeave(win: BrowserWindow | null): Promise<void> {
  if (leaveAsked) return
  leaveAsked = true
  const locked = lockService?.isLocked() ?? false
  const buttons = leaveButtons(locked)
  try {
    let choice: number
    if (smokeFixtures) {
      smokeFixtures.leaveDialogs.push({ message: RECORDING_LEAVE_MESSAGE, buttons })
      choice = smokeFixtures.leaveChoice
    } else {
      const options = { type: 'warning' as const, message: RECORDING_LEAVE_MESSAGE, buttons, defaultId: 0, cancelId: 0 }
      choice = (win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)).response
    }
    if (choice === 1 && !locked && recordingSessions.active()) {
      quitAfterRecording = true
      broadcast(appWindows(), 'scribe:recording-end-and-quit', undefined)
    }
  } finally {
    leaveAsked = false
  }
}

/** Intervalo em que o bloqueio por falta de uso é conferido. */
const LOCK_TICK_MS = 15_000

/** Título da janela: o nome da marca, com "— bloqueado" enquanto o app está bloqueado (CA4). */
function windowTitle(): string {
  return lockService?.isLocked() ? lockedWindowTitle(brandName) : brandName
}

/** Cada mudança do bloqueio: título das janelas, item "Bloquear" do menu e o aviso às janelas. */
function applyLockStatus(status: LockStatus): void {
  const wasLocked = lastLockStatus?.locked ?? false
  lastLockStatus = status
  // Contrato 48: bloqueado, o aviso de reunião (que mostra o título dela) fecha.
  if (status.locked) meetingPromptController?.close()
  // Contrato 49: desbloqueado, a reunião (da extensão ou de um app) que não avisou por causa do bloqueio avisa agora.
  else if (wasLocked) void meetingPromptController?.recheck()
  trayController?.refresh()
  const title = windowTitle()
  for (const win of appWindows()) win.setTitle(title)
  const item = Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.lock)
  if (item) item.enabled = status.canLock && !status.locked
  broadcast(appWindows(), 'scribe:lock-state', status)
  // Contrato 122 (R12): o "Abrir" de uma tarefa pedido bloqueado chega agora, depois do estado desbloqueado.
  if (!status.locked) destinoTarefa.desbloqueou((id) => sendWhenLoaded(mainWindow ?? showMainWindow(), 'scribe:open-tarefa', { id }))
  // Contrato 24: bloqueado, nada do WhatsApp chega às janelas; ao desbloquear, o estado de agora.
  if (!status.locked && whatsappService) broadcast(appWindows(), 'scribe:whatsapp-state', whatsappService.status())
  // Contrato 42: o mesmo para as contas de email.
  if (!status.locked && emailService) broadcast(appWindows(), 'scribe:email-state', emailService.accounts())
  // Contrato 69: o mesmo para as redes. Contrato 71: e a fila de publicações de cada conta.
  if (!status.locked && redesService) {
    const redes = redesService
    broadcast(appWindows(), 'scribe:redes-state', redes.state())
    for (const account of redes.state().accounts) void redes.publications({ accountId: account.id }).then((payload) => broadcast(appWindows(), 'scribe:redes-publications', payload))
    // 73: comentários
    for (const account of redes.state().accounts) void redes.commentsState({ accountId: account.id }).then((payload) => broadcast(appWindows(), 'scribe:redes-comments', payload))
    // fim 73
    // 74: mensagens
    for (const payload of redes.messagesPayloads()) broadcast(appWindows(), 'scribe:redes-messages', payload)
    // fim 74
  }
  // Contrato 12: o mesmo para as próximas reuniões e a faixa da agenda.
  if (!status.locked && calendarService) broadcast(appWindows(), 'scribe:calendar-state', calendarService.view())
  // Contrato 122 (R12): a lista de agora, com o dia de hoje (a virada e os lembretes podem ter acontecido bloqueado).
  if (!status.locked && tarefasService) {
    void tarefasService.view().then(
      (view) => {
        if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:tarefas-changed', view)
      },
      (error: unknown) => console.error('[tarefas] view ao desbloquear:', error instanceof Error ? error.message : String(error)),
    )
  }
}

/** "Bloquear" pelo menu ou ⌘⇧L, pelo `powerMonitor` ou por falta de uso; só bloqueia com senha ou Touch ID. */
function lockApp(reason: Parameters<LockService['lock']>[0]): void {
  void lockService?.lock(reason).catch(() => undefined)
}

function openMainWindow(query?: Record<string, string>, invisible = false): BrowserWindow {
  const win = createMainWindow({ url: appUrl, appOrigin, title: windowTitle(), ...(query ? { query } : {}), invisible })
  // Fechar a janela no meio de uma gravação perderia a reunião: pede confirmação.
  win.on('close', (event) => {
    if (!recordingSessions.active()) return
    event.preventDefault()
    void confirmLeave(win)
  })
  const contentsId = win.webContents.id
  win.on('closed', () => {
    whatsappService?.forgetSender(contentsId)
    emailService?.forgetSender(contentsId)
    inviteSuggestChannels?.forget(contentsId)
    redesService?.forgetSender(contentsId)
    whatsappViewing.delete(contentsId)
    emailViewing.delete(contentsId)
    if (mainWindow === win) mainWindow = null
    // No macOS o app segue aberto sem janela: as conversas do chat morrem em 5 min, como ao sair da tela.
    chatService?.leaveAll()
    // Contrato 23 (CA9): sem janela, o app fica só no ícone da barra de menus (sem Dock) ou sai, como a pessoa escolheu.
    if (!appWindows().some((other) => other !== win && !other.isDestroyed())) void windowLifecycle?.lastWindowClosed()
  })
  mainWindow = win
  return win
}

/**
 * A janela de volta (pelo ícone da barra de menus, pela notificação ou abrindo o app de novo): o Dock aparece e a
 * janela vem para a frente; sem janela, abre uma. No smoke, a janela nova também fica invisível.
 */
function showMainWindow(): BrowserWindow {
  windowLifecycle?.reopened()
  const win = mainWindow ?? openMainWindow(undefined, smoke)
  if (!smoke) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  return win
}

/** Manda ao renderer depois que a página carregou (janela recém-aberta). */
function sendWhenLoaded<C extends 'scribe:navigate' | 'scribe:open-run' | 'scribe:open-whatsapp' | 'scribe:open-meeting' | 'scribe:open-settings' | 'scribe:open-email' | 'scribe:open-tarefa'>(
  win: BrowserWindow,
  channel: C,
  payload: MainEvents[C],
): void {
  const contents = win.webContents
  const send = (): void => sendTo(contents, channel, payload)
  if (contents.isLoading()) contents.once('did-finish-load', send)
  else send()
}

/** Notificações vivas: sem a referência, o "Abrir" de uma notificação antiga pode não chegar. */
const liveNotices = new Set<Notification>()

/**
 * Notificação de uma execução (contrato 23, CA6 e CA9), com "Abrir", que leva à execução. Bloqueado, sem
 * conteúdo nenhum: só que uma tarefa terminou. No smoke, o substituto registra e nada aparece.
 */
function showAutomationNotice(notice: AutomationNotice): void {
  const locked = lockService?.isLocked() ?? false
  // Contrato 25: o lembrete bloqueado também não mostra o texto.
  const shown = locked ? { title: brandName, body: notice.reminder ? 'Você tem um lembrete.' : 'Um agendamento terminou.', runId: notice.runId } : notice
  if (smokeFixtures) {
    smokeFixtures.automations.notifications.push(shown)
    return
  }
  if (!Notification.isSupported()) return
  const item = new Notification({ title: shown.title, body: shown.body, actions: [{ type: 'button', text: 'Abrir' }] })
  const open = (): void => {
    liveNotices.delete(item)
    // Contrato 25: o lembrete de uma conversa do WhatsApp abre a conversa.
    if (notice.whatsappChatId) sendWhenLoaded(showMainWindow(), 'scribe:open-whatsapp', { chatId: notice.whatsappChatId })
    // Contrato 45: o lembrete de responder um email abre a mensagem.
    // Achado só no servidor (CA7): não está na INBOX do app; o "Abrir" vai ao lembrete, que diz a pasta.
    else if (notice.email && !notice.email.mailbox) sendWhenLoaded(showMainWindow(), 'scribe:open-email', { accountId: notice.email.accountId, id: notice.email.messageId })
    else sendWhenLoaded(showMainWindow(), 'scribe:open-run', { runId: notice.runId })
  }
  item.on('click', open)
  item.on('action', open)
  item.on('close', () => liveNotices.delete(item))
  liveNotices.add(item)
  item.show()
}

/**
 * Contrato 122 (D7): o "Abrir" de uma tarefa (`null`, a lista). A janela vem para a frente; com o app bloqueado, o
 * destino fica guardado no main e vai ao desbloquear (`applyLockStatus`). O aviso "Hoje" (124) usa este caminho.
 */
function openTarefa(id: string | null): void {
  const win = showMainWindow()
  destinoTarefa.abrir(id, lockService?.isLocked() ?? false, (destino) => sendWhenLoaded(win, 'scribe:open-tarefa', { id: destino }))
}

/**
 * Contrato 122 (R12, D6): a notificação "Tarefa" de um lembrete, com "Abrir". Bloqueado, sem o título (só a marca e
 * "Você tem uma tarefa com lembrete"). No smoke, o substituto registra, com o "Abrir", e nada aparece.
 */
function showTarefaNotice(aviso: AvisoTarefa): void {
  const shown = avisoMostrado(aviso, lockService?.isLocked() ?? false, brandName)
  if (smokeFixtures) {
    smokeFixtures.tarefas.notifications.push({ ...shown, open: () => openTarefa(aviso.tarefaId) })
    return
  }
  if (!Notification.isSupported()) return
  const item = new Notification({ title: shown.title, body: shown.body, actions: [{ type: 'button', text: 'Abrir' }] })
  const open = (): void => {
    liveNotices.delete(item)
    openTarefa(aviso.tarefaId)
  }
  item.on('click', open)
  item.on('action', open)
  item.on('close', () => liveNotices.delete(item))
  liveNotices.add(item)
  item.show()
}

/** Contrato 115 (R44): o aviso diário do funil; o clique abre Funil > Oportunidades. No smoke, só uma linha de log. */
function showFunilNotice(aviso: { title: string; body: string }): void {
  // Bloqueado, sem as contagens (como `showAutomationNotice`).
  const shown = lockService?.isLocked() ? { title: brandName, body: 'Há oportunidades no funil pedindo atenção.' } : aviso
  if (smokeFixtures) return void console.log(`[funil] aviso não mostrado no smoke: ${shown.body}`)
  if (!Notification.isSupported()) return
  const item = new Notification({ title: shown.title, body: shown.body })
  const open = (): void => {
    liveNotices.delete(item)
    sendWhenLoaded(showMainWindow(), 'scribe:navigate', 'funil')
  }
  item.on('click', open)
  item.on('close', () => liveNotices.delete(item))
  liveNotices.add(item)
  item.show()
}

/**
 * "Gravar" de um aviso da agenda (contrato 12, CA6 e CA7), pela notificação ou pelo clique nela: o app vem para a
 * frente e começa a gravação com o evento; já gravando, ou com o app bloqueado, só vem para a frente.
 */
function recordFromCalendar(key: string): void {
  showMainWindow()
  if (lockService?.isLocked() || recordingSessions.active()) return
  calendarService?.pick(key)
  startRecordingFromMenu().catch((error: unknown) => console.error('[agenda] gravar:', error))
}

/**
 * "Começar a transcrever" do aviso de reunião (contrato 48): o mesmo caminho do "Gravar" da agenda. O app vem para a
 * frente e começa a gravação; já gravando, ou com o app bloqueado, só vem para a frente. O título da reunião chega à
 * gravação por `scribe:calendar-recording` (o controlador do aviso guarda até a sessão abrir).
 */
function recordFromMeetingPrompt(): void {
  showMainWindow()
  if (lockService?.isLocked() || recordingSessions.active()) return
  startRecordingFromMenu().catch((error: unknown) => console.error('[aviso] gravar:', error))
}

/**
 * Janela do aviso de reunião (contrato 48), na tela do cursor e no tema das Configurações. Fica fora de
 * `appWindows()`; no smoke, invisível e registrada nas fixtures.
 */
function openMeetingPromptWindow(settings: MeetingPromptSettings): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const theme = smoke ? 'light' : settings.theme === 'system' ? null : settings.theme
  const win = createMeetingPromptWindow({ url: appUrl, appOrigin, workArea: display.workArea, theme, invisible: smoke })
  meetingPromptWindows.add(win)
  if (smokeFixtures) smokeFixtures.meetingPrompt.windows.push(win)
  return win
}

/**
 * Notificação da agenda (contrato 12): "Reunião em N min", "não está sendo gravada" (com "Gravar") e "cancelada".
 * Bloqueado (contrato 22), sem nada da reunião: só o nome do app e uma frase. Com a assinatura ad-hoc o botão pode
 * não aparecer; o clique na notificação faz o mesmo. No smoke, o substituto registra e o smoke "clica".
 */
function showCalendarNotice(notice: CalendarNotice): void {
  const locked = lockService?.isLocked() ?? false
  const shown = calendarNoticeText(notice, locked, brandName)
  const act = (): void => {
    if (notice.kind === 'cancelled' || !shown.record) void showMainWindow()
    else recordFromCalendar(notice.key)
  }
  if (smokeFixtures) {
    smokeFixtures.calendar.notifications.push({ kind: notice.kind, title: shown.title, body: shown.body, actions: shown.record ? ['Gravar'] : [], act })
    return
  }
  if (!Notification.isSupported()) return
  const item = new Notification({ title: shown.title, body: shown.body, actions: shown.record ? [{ type: 'button', text: 'Gravar' }] : [] })
  const done = (): void => {
    liveNotices.delete(item)
    act()
  }
  item.on('click', done)
  item.on('action', done)
  item.on('close', () => liveNotices.delete(item))
  liveNotices.add(item)
  item.show()
}

/** Contrato 40: as notificações vivas do WhatsApp, à parte e com teto (as mais antigas são soltas primeiro). */
const WHATSAPP_LIVE_NOTICES_MAX = 50
const liveWhatsAppNotices = new Set<Notification>()

/** Contrato 40: a conversa aberta na tela "WhatsApp" de cada janela (pelo id do `webContents`). */
const whatsappViewing = new Map<number, string | null>()

/** A conversa aberta na janela em foco (no smoke, o foco é fingido: as janelas são invisíveis). */
function whatsappFocusedChat(): string | null {
  const id = smokeFixtures ? smokeFixtures.whatsappNotify.focusedContentsId : (BrowserWindow.getFocusedWindow()?.webContents.id ?? null)
  return id === null ? null : (whatsappViewing.get(id) ?? null)
}

/**
 * Notificação de uma mensagem do WhatsApp (contrato 40), local; o clique abre o app na conversa. A foto vai como
 * `icon`, que o macOS costuma ignorar (fica o ícone do app). No smoke, o substituto registra e o smoke "clica".
 */
function showWhatsAppNotice(notice: WhatsAppNotice): NoticeHandle {
  const open = (): void => sendWhenLoaded(showMainWindow(), 'scribe:open-whatsapp', { chatId: notice.chatId })
  if (smokeFixtures) {
    const entry = { chatId: notice.chatId, title: notice.title, body: notice.body, count: notice.count, icon: notice.icon !== null, closed: false, open }
    smokeFixtures.whatsappNotify.notifications.push(entry)
    return { close: () => void (entry.closed = true) }
  }
  if (!Notification.isSupported()) return { close: () => undefined }
  const icon = notice.icon ? nativeImage.createFromDataURL(notice.icon) : null
  const item = new Notification({ title: notice.title, body: notice.body, ...(icon && !icon.isEmpty() ? { icon } : {}) })
  const done = (): void => {
    liveWhatsAppNotices.delete(item)
    open()
  }
  item.on('click', done)
  item.on('action', done)
  item.on('close', () => liveWhatsAppNotices.delete(item))
  liveWhatsAppNotices.add(item)
  // O `close` nem sempre chega no macOS e cada uma segura a foto: passou do teto, as mais antigas são só soltas
  // (continuam na Central de Notificações; o clique nelas pode não chegar).
  for (const old of liveWhatsAppNotices) {
    if (liveWhatsAppNotices.size <= WHATSAPP_LIVE_NOTICES_MAX) break
    liveWhatsAppNotices.delete(old)
  }
  item.show()
  return {
    close: () => {
      liveWhatsAppNotices.delete(item)
      item.close()
    },
  }
}

const whatsappNotifier = createWhatsAppNotifier({ show: showWhatsAppNotice, appName: () => brandName, now: () => Date.now() })

/** Mensagem recebida (contrato 40): notifica pelas regras de `notify.ts`; a foto só com o app desbloqueado. */
async function notifyWhatsApp(message: WhatsAppMessage, chatName: string): Promise<void> {
  if (message.fromMe || !readSettings) return
  const current = await readSettings()
  const input = () => ({
    message,
    chatName,
    settings: { enabled: current.whatsappNotifications, groups: current.whatsappNotifyGroups },
    viewing: whatsappFocusedChat() === message.chatId,
    locked: lockService?.isLocked() ?? false,
  })
  const first = input()
  if (!shouldNotify(first)) return
  const icon = first.locked ? null : await (whatsappService?.photo({ chatId: message.chatId }) ?? Promise.resolve(null)).catch(() => null)
  whatsappNotifier.receive({ ...input(), icon })
}

/** Contrato 43: as notificações vivas do email, à parte e com o mesmo teto das do WhatsApp. */
const liveEmailNotices = new Set<Notification>()

/** Contrato 43: a pasta aberta na tela "Email" de cada janela (pelo id do `webContents`). */
const emailViewing = new Map<number, { accountId: string; folder: EmailFolder } | null>()

/** A Caixa de Entrada aberta na janela em foco (no smoke, o foco é fingido, como no WhatsApp). */
function emailFocusedInbox(): string | null {
  const id = smokeFixtures ? smokeFixtures.emailNotify.focusedContentsId : (BrowserWindow.getFocusedWindow()?.webContents.id ?? null)
  const viewing = id === null ? null : (emailViewing.get(id) ?? null)
  return viewing?.folder === 'inbox' ? viewing.accountId : null
}

/** Notificação de um email (contrato 43), local; o clique abre o app na mensagem. No smoke, o substituto registra. */
function showEmailNotice(notice: EmailNotice): NoticeHandle {
  // Contrato 55 (CA24): a movida por uma regra abre a pasta de destino (e a mensagem, se o servidor disse o UID novo).
  const open = (): void => sendWhenLoaded(showMainWindow(), 'scribe:open-email', { accountId: notice.accountId, id: notice.id, ...(notice.mailbox ? { mailbox: notice.mailbox.path, found: notice.mailbox.found } : {}) })
  if (smokeFixtures) {
    const entry = { ...notice, closed: false, open }
    smokeFixtures.emailNotify.notifications.push(entry)
    return { close: () => void (entry.closed = true) }
  }
  if (!Notification.isSupported()) return { close: () => undefined }
  const item = new Notification({ title: notice.title, body: notice.body })
  const done = (): void => {
    liveEmailNotices.delete(item)
    open()
  }
  item.on('click', done)
  item.on('action', done)
  item.on('close', () => liveEmailNotices.delete(item))
  liveEmailNotices.add(item)
  for (const old of liveEmailNotices) {
    if (liveEmailNotices.size <= WHATSAPP_LIVE_NOTICES_MAX) break
    liveEmailNotices.delete(old)
  }
  item.show()
  return {
    close: () => {
      liveEmailNotices.delete(item)
      item.close()
    },
  }
}

const emailNotifier = createEmailNotifier({ show: showEmailNotice, appName: () => brandName, now: () => Date.now() })

/** Email novo (contrato 43): notifica pelas regras de `email/notify.ts`. */
async function notifyEmail(message: EmailMessage): Promise<void> {
  const account = emailService?.accounts().find((status) => status.account.id === message.accountId)?.account
  if (!account || !readSettings) return
  const current = await readSettings()
  // Contrato 53: o `onMessage` só traz email novo da INBOX; fora dela, uma regra o moveu (e pediu o aviso).
  emailNotifier.receive({ message, account, enabled: current.emailNotifications, viewing: emailFocusedInbox() === message.accountId, locked: lockService?.isLocked() ?? false, movedByRule: !isInbox(message) })
}

/** Contrato 43: as imagens do "Carregar imagens", sem cookie e sem seguir redirecionamento. No smoke, o servidor falso. */
const fetchRemoteImage: RemoteImageFetch = async (url, signal) => {
  if (smokeFixtures) return smokeFixtures.email.fetchImage(url)
  const response = await net.fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal } as RequestInit)
  if (!response.ok) return null
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  if (Number(response.headers.get('content-length') ?? 0) > EMAIL_REMOTE_IMAGE_MAX_BYTES) return null
  // Sem `content-length` (ou com um falso): lido aos pedaços e cortado ao passar de 5 MB.
  const bytes = await readLimited(response.body)
  return bytes ? { type, bytes } : null
}

/** Contrato 43: o DNS de verdade; no smoke, o nome inventado do servidor falso resolve para um endereço público. */
const remoteImageLookup: HostLookup = smokeFixtures ? async () => [{ address: '93.184.216.34', family: 4 }] : systemLookup

let badgeTimer: ReturnType<typeof setTimeout> | null = null
let badgeShown: number | null = null
/** Cada leitura do número ganha um número; só a mais recente chega ao Dock (uma lenta não sobrescreve a nova). */
let badgeReads = 0

/**
 * Contrato 40 (opcional): o total de não lidas no ícone do Dock, com as notificações ligadas e o WhatsApp conectado
 * (com "Só pessoas", sem os grupos). Relido pouco depois de cada mudança; no smoke, só registra.
 */
function refreshWhatsAppBadge(): void {
  if (badgeTimer) return
  badgeTimer = setTimeout(() => {
    badgeTimer = null
    const read = ++badgeReads
    void whatsappBadgeCount().then((count) => {
      if (read !== badgeReads || count === badgeShown) return
      badgeShown = count
      if (smokeFixtures) smokeFixtures.whatsappNotify.badges.push(count)
      else app.setBadgeCount(count)
    })
  }, 500)
}

/** Ao sair: o timer do número do Dock para, e uma leitura em curso não aplica mais nada. */
function disposeWhatsAppBadge(): void {
  if (badgeTimer) clearTimeout(badgeTimer)
  badgeTimer = null
  badgeReads++
}

async function whatsappBadgeCount(): Promise<number> {
  const service = whatsappService
  if (!service || !readSettings || service.status().state !== 'connected') return 0
  const current = await readSettings().catch(() => null)
  if (!current?.whatsappNotifications) return 0
  const chats = await service.chats().catch(() => [])
  return chats.filter((chat) => current.whatsappNotifyGroups || !isGroupChat(chat.id)).reduce((total, chat) => total + Math.max(0, chat.unread), 0)
}

/** "Abrir ao entrar no Mac" (CA9): abre direto na barra de menus, sem janela. No smoke, só registra. */
function applyLoginItem(openAtLogin: boolean): void {
  if (loginItemApplied === openAtLogin) return
  const first = loginItemApplied === null
  loginItemApplied = openAtLogin
  // Ao abrir o app, nada muda nos itens de login: só quando a pessoa troca a opção.
  if (first) return
  const options = { openAtLogin, openAsHidden: true }
  if (smokeFixtures) smokeFixtures.automations.loginItems.push(options)
  else if (process.platform === 'darwin') app.setLoginItemSettings(options)
}

/** Imagem "template" do ícone da barra de menus (o macOS pinta no tom da barra); `@2x` ao lado. */
function trayImage(icon: TrayIcon): NativeImage {
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'brand', icon === 'running' ? 'trayRunningTemplate.png' : 'trayTemplate.png'))
  image.setTemplateImage(true)
  return image
}

/**
 * O que o menu do ícone lê de forma assíncrona (contrato 50), relido antes de cada montagem: as 3 reuniões gravadas
 * mais recentes e as configurações que ele mostra.
 */
let trayRecent: TrayRecent[] = []
let traySettings: Pick<AppSettings, 'meetingPrompt' | 'meetSpeakers' | 'navegadorPlugin'> | null = null
/** Último "Meet conectado" visto: os eventos de fala chegam a todo instante e só a conexão muda o menu. */
let trayMeetConnected = false

/** Ícone da barra de menus. No smoke, um substituto que registra os itens; o `Tray` de verdade nunca é criado. */
function installTray(services: AppServices): void {
  const { automations, calendar, meetings, meet, meetingPrompt, settings } = services
  const fixtures = smokeFixtures
  const smokeTray = (image: unknown): TrayLike => {
    fixtures?.automations.trayImages.push(String(image))
    return {
      setImage: (next) => void fixtures?.automations.trayImages.push(String(next)),
      setToolTip: () => undefined,
      setContextMenu: () => undefined,
      setTitle: (title) => void fixtures?.automations.trayTitles.push(title),
      destroy: () => undefined,
    }
  }
  /** O item do menu montado: no Electron, pelo id; no smoke, o menu é o próprio template. */
  const smokeItem = (items: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | null => {
    for (const item of items) {
      if (item.id === id) return item
      const found = Array.isArray(item.submenu) ? smokeItem(item.submenu, id) : null
      if (found) return found
    }
    return null
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locked = (): boolean => lockService?.isLocked() ?? false
  trayController = createTrayController({
    create: (image) => (fixtures ? smokeTray(image) : new Tray(image as NativeImage)),
    image: (icon) => (fixtures ? icon : trayImage(icon)),
    buildMenu: (template) => (fixtures ? template : Menu.buildFromTemplate(template)),
    setLabel: (menu, id, label) => {
      const item = fixtures ? smokeItem(menu as MenuItemConstructorOptions[], id) : (menu as Menu).getMenuItemById(id)
      if (item) item.label = label
    },
    prepare: async () => {
      traySettings = await settings.getSettings()
      trayRecent = (await meetings.list()).slice(0, TRAY_LIST_MAX).map((meeting) => ({ id: meeting.id, title: meeting.title }))
    },
    running: () => automations.snapshot().running.length > 0,
    state: () => {
      const status = automations.snapshot()
      const isLocked = locked()
      const startedAt = recordingSessions.active() !== null ? recordingStartedAt : null
      const current = traySettings
      return {
        brandName,
        locked: isLocked,
        canLock: lastLockStatus?.canLock ?? false,
        recording: startedAt !== null ? { elapsedMs: Date.now() - startedAt, title: isLocked ? null : (meetingPrompt.recordingTitle() ?? calendar.recordingCalendar()?.title ?? null) } : null,
        paused: status.paused,
        next: status.next.slice(0, 3).map((task) => ({ name: task.name, when: formatRunShort(Date.parse(task.at), timeZone) })),
        // Bloqueado, nada da agenda nem das reuniões chega ao menu (o template também não mostra).
        meetings: isLocked ? [] : todayMeetings(calendar.view().upcoming, Date.now()),
        recent: isLocked ? [] : trayRecent,
        meetingPrompt: current?.meetingPrompt ?? false,
        plugins: [
          ...(current?.meetSpeakers ? [{ name: 'Meet', connected: meet.status().connected }] : []),
          ...(current?.navegadorPlugin ? [{ name: 'Navegador', connected: navegadorServer?.connected() ?? false }] : []),
        ],
      }
    },
    handlers: {
      open: () => void showMainWindow(),
      newRecording: () => {
        if (locked()) return
        windowLifecycle?.reopened()
        startRecordingFromMenu().catch((error: unknown) => console.error('[barra de menus] nova gravação:', error))
      },
      openRecording: () => {
        if (locked()) return
        sendWhenLoaded(showMainWindow(), 'scribe:navigate', 'gravacao')
      },
      stopRecording: () => broadcast(appWindows(), 'scribe:recording-end', undefined),
      // O mesmo caminho do "Gravar" da notificação da agenda (bloqueado ou já gravando, só mostra a janela).
      recordEvent: (key) => recordFromCalendar(key),
      joinEvent: (key) => {
        if (locked()) return
        const url = trayJoinUrl(calendar.joinUrl(key))
        if (url) openExternal(url)
      },
      openMeeting: (id) => {
        if (locked()) return
        sendWhenLoaded(showMainWindow(), 'scribe:open-meeting', { meetingId: id })
      },
      toggleMeetingPrompt: () => {
        if (locked()) return
        void settings
          .getSettings()
          .then((current) => settings.updateSettings({ meetingPrompt: !current.meetingPrompt }))
          .catch(() => undefined)
      },
      openPlugins: () => {
        if (locked()) return
        sendWhenLoaded(showMainWindow(), 'scribe:open-settings', { tab: 'plugins' })
      },
      lock: () => lockApp('menu'),
      automations: () => {
        if (locked()) return
        sendWhenLoaded(showMainWindow(), 'scribe:navigate', 'automacoes')
      },
      togglePause: () => void automations.setPaused({ paused: !automations.snapshot().paused }).catch(() => undefined),
      quit: () => {
        if (fixtures) fixtures.automations.quitRequests++
        else app.quit()
      },
    },
  })
}

/** Estado da ponte do navegador (contrato 46) para a tela. */
function navegadorState(): NavegadorState {
  return { ativo: navegadorAtivo, conectado: navegadorServer?.connected() ?? false }
}

/** Contrato 46: a ponte do navegador segue "Ativar ponte"; ligar ou desligar vai às janelas. */
function applyNavegador(ativo: boolean): void {
  if (ativo) void navegadorServer?.start().catch(() => null)
  else void navegadorServer?.close().catch(() => undefined)
  if (ativo === navegadorAtivo) return
  navegadorAtivo = ativo
  broadcast(appWindows(), 'scribe:navegador-changed', navegadorState())
}

/** Mudança de configuração vai para todas as janelas abertas; a marca vai para o título, o "Sobre" e o Dock. */
function broadcastSettings(settings: AppSettings): void {
  broadcast(appWindows(), 'scribe:settings-changed', settings)
  applyBrand(settings)
  applyLoginItem(settings.openAtLogin)
  trayController?.refresh()
  // "Usar Touch ID" muda o que o botão "Bloquear" pode.
  void lockService?.refresh().catch(() => undefined)
  // "Guardar no Google Drive" desligado: a fila esvazia; ligado, ela volta a andar.
  if (settings.saveToDrive) driveService?.start()
  else driveService?.clear()
  // Contrato 12: agendas escolhidas e avisos.
  calendarService?.settingsChanged()
  // Contrato 27: "Quem fala no Meet" desligado para o servidor local; ligado, ele sobe (se já não estiver no ar).
  if (settings.meetSpeakers) void meetServer?.start().catch(() => null)
  else void meetServer?.stop().catch(() => undefined)
  // Contrato 48: "Avisar quando uma reunião começar" desligado fecha o aviso aberto.
  if (!settings.meetingPrompt) meetingPromptController?.close()
  // Contrato 49: e liga ou desliga o observador do microfone dos outros apps.
  micWatchService?.apply(settings.meetingPrompt)
  // Contrato 46: "Ativar ponte" ligado sobe a ponte do navegador; desligado, para (e recusa o comando em curso).
  applyNavegador(settings.navegadorPlugin)
  // Contrato 40: o número do Dock segue "Notificações do WhatsApp" e "Só pessoas".
  refreshWhatsAppBadge()
}

/** Ícone do Dock. No smoke nada toca o Dock de verdade: só o resultado fica registrado. */
const dockTarget: DockIconTarget = {
  platform: smokeFixtures ? 'darwin' : process.platform,
  dock: smokeFixtures ? { setIcon: () => undefined } : app.dock,
  load: (path) => nativeImage.createFromPath(path),
  defaultIcon: join(app.getAppPath(), 'resources', 'brand', 'icon.png'),
}

function applyBrand(settings: AppSettings): void {
  const { name } = brandTexts(settings)
  if (name !== brandName) {
    brandName = name
    applyBrandName({ setAboutPanelOptions: (options) => app.setAboutPanelOptions(options), windows: appWindows(), version: app.getVersion() }, name)
    // Bloqueado, o título segue com "— bloqueado".
    if (lockService?.isLocked()) for (const win of appWindows()) win.setTitle(windowTitle())
  }
  updateDockIcon(settings.brandLogo)
}

/**
 * Logo próprio no Dock ao abrir e a cada troca; voltando ao padrão, o ícone do pacote. Na abertura sem
 * logo próprio, o empacotado já mostra o ícone do pacote; em desenvolvimento o Dock mostraria o do Electron.
 */
function updateDockIcon(logo: string | null): void {
  if (logo === dockLogo) return
  const first = dockLogo === undefined
  dockLogo = logo
  if (first && logo === null && app.isPackaged && !smokeFixtures) return
  const path = logo === null ? null : join(app.getPath('userData'), 'branding', logo)
  const result = applyDockIcon(dockTarget, path)
  smokeFixtures?.dockIcons.push(result)
}

/**
 * Chave, catálogo, transcrição e reuniões. No smoke nada sai da máquina nem abre diálogo: `fetch` de
 * fixtures, `safeStorage` em memória com uma chave fictícia e `systemPreferences` substituto.
 * O cofre e o cliente do gateway são criados uma única vez e injetados onde são usados (transcrição e
 * tradução avulsa reaproveitam o mesmo cache de catálogo).
 */
interface AppServices {
  settings: SettingsService
  meetings: MeetingsStore
  transcripts: TranscriptStore
  meetingsService: ReturnType<typeof createMeetingsService>
  meetingsIndex: MeetingsIndex
  tokenClient: ReturnType<typeof createTokenClient>
  translation: ReturnType<typeof createTranslationService>
  claude: ClaudeService
  files: MeetingFilesService
  summary: SummaryService
  /** "Analisar até agora" (contrato 19). */
  analysis: AnalysisService
  /** IA anotando ao vivo (contrato 30). */
  aiNotes: AiNotesService
  download: ReturnType<typeof createMeetingDownload>
  branding: BrandingService
  updates: UpdateService
  /** Chat do "Assistente" (contratos 15 e 25) e o acervo em Markdown que o `claude` dele lê. */
  chat: ChatService
  /** Os cartões de ação do Assistente (contrato 25): só com o clique da pessoa. */
  chatActions: ChatActions
  /** Agente do ACP do perfil escolhido (contrato 17): instalar, remover e o estado. */
  acp: { current: () => Promise<AcpAgentService> }
  corpus: ChatCorpus
  /** Bloqueio do app (contrato 22): senha, Touch ID, espera e estado. */
  lock: LockService
  /** Conta Google e envio ao Drive (contrato 11). */
  google: GoogleAccountService
  drive: DriveSyncService
  /** Conta Microsoft e as agendas com os avisos (contrato 12). */
  microsoft: MicrosoftAccountService
  calendar: CalendarService
  /** WhatsApp pessoal pelo serviço local (contrato 24). */
  whatsapp: WhatsAppService
  /** Detalhes da conversa do WhatsApp pelo Claude (contrato 32). */
  whatsappInsights: InsightsService
  /** Contas de email IMAP, POP3 e SMTP (contrato 42). */
  email: EmailService
  /** Contrato 56: os lotes do Assistente que organiza o email (o estado, o cartão e o Desfazer). */
  emailOrganizer: EmailOrganizer | null
  /** Contas do Instagram por token e o armazenamento de mídia (contrato 69). */
  redes: RedesService
  /** Agentes, tarefas agendadas e execuções (contrato 23). */
  automations: AutomationsService
  /** Servidor local da extensão do Meet (contrato 27). */
  meet: MeetServer
  /** Aviso "Começar a transcrever" ao entrar numa reunião (contrato 48). */
  meetingPrompt: MeetingPromptController
  /** Microfone ligado por outro app, para o mesmo aviso (contrato 49). */
  micWatch: MicWatchService
  /** Contrato 60: o `lap-calendar` (Calendário do Mac), sob demanda. */
  macCalendar: MacCalendar
  /** Contrato 62: os convites do email no Calendário do Mac (registro, estado do cartão e as gravações no clique). */
  invites: InviteService
  /** Contrato 78: o acesso e as agendas guardados para o `ESTADO.md` do Assistente. */
  calendarReads: CachedCalendarReads
  /** Contrato 64: o "Sugerir evento" (o Claude só atrás do canal com o token de clique próprio). */
  inviteSuggest: InviteSuggestChannels
  /** "Salvar plugin…" da aba Plugins (contrato 31). */
  pluginSave: (input: unknown) => Promise<PluginSaveResult>
  /** Servidores MCP do agente: a aba "Conexões" e as sessões (contrato 21). */
  mcp: McpService
  /** Ponte do "Controle do navegador" (contrato 46). */
  navegador: NavegadorServer
  /** Servidor MCP das ferramentas do navegador do Assistente (contrato 47). */
  navegadorMcp: NavegadorMcpServer
  /** Contrato 110: o funil de vendas (`funil.json`), com as leituras sob demanda dos caches dos outros domínios. */
  funil: FunilService
  /** Contrato 113: a detecção de oportunidade nas reuniões (o serviço do 111). */
  funnel: FunnelExtractService
  /** Contrato 113: o que os canais `scribe:funil-proposta-*` usam (e o `proposals.remove` ao excluir a reunião). */
  funilProposta: FunilPropostaIpcDeps
  /** Contrato 122: as tarefas (`tarefas.json`), com os lembretes no tick das Automações. */
  tarefas: TarefasService
}

/**
 * Arquivos do serviço do WhatsApp (contrato 24): o empacotado leva em `resources/whatsapp-bridge` dentro do
 * `app.asar` (pack.sh; o app copia para o `userData` antes do `pip` e do Python); em desenvolvimento e no smoke, os
 * do repositório.
 */
function bridgeSourceDir(): string {
  return app.isPackaged ? join(app.getAppPath(), 'resources', 'whatsapp-bridge') : join(app.getAppPath(), '..', '..', 'services', 'whatsapp-bridge')
}

/**
 * Pasta embutida de um plugin (contrato 31): o empacotado leva em `resources/<id>-extension` dentro do `app.asar`
 * (pack.sh); em desenvolvimento e no smoke, a `extensions/<id>` do repositório. Contrato 46: e o do navegador.
 */
function pluginSourceDir(id: AppPluginId): string {
  const packaged: Record<AppPluginId, string> = { meet: 'meet-extension', navegador: 'navegador-extension' }
  const repo: Record<AppPluginId, string> = { meet: 'meet', navegador: 'navegador' }
  return app.isPackaged ? join(app.getAppPath(), 'resources', packaged[id]) : join(app.getAppPath(), '..', '..', 'extensions', repo[id])
}

function fetchImpl(url: string, init: FetchInit): Promise<FetchResponse> {
  if (smokeFixtures) return smokeFixtures.fetch(url, init)
  return net.fetch(url, init as RequestInit) as unknown as Promise<FetchResponse>
}

function createAppServices(userData: string): AppServices {
  const secrets = createSecretStore({
    dir: userData,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    isPackaged: app.isPackaged,
    env: smokeFixtures ? {} : process.env,
  })
  if (smokeFixtures) secrets.save(SMOKE_FAKE_KEY)
  const gateway = createGatewayClient({ fetch: fetchImpl, getApiKey: () => secrets.getApiKey() })
  const fileTranscriber = createFileTranscriber({ fetch: fetchImpl, getApiKey: () => secrets.getApiKey() })
  const mic = createMicPermissions(smokeFixtures ? smokeFixtures.media : process.platform === 'darwin' ? systemPreferences : null)
  const settings = createFileSettingsStore({ dir: userData, onChange: broadcastSettings })
  readSettings = () => settings.get()
  const meetings = createFileMeetingsStore({ dir: userData })
  const transcripts = createFileTranscriptStore({ dir: userData })
  const summaries = createFileSummaryStore({ dir: userData })
  // Anotações em cards (contrato 13), ao lado da transcrição e do resumo.
  // Contrato 23: o post-it que um agente acrescenta fica protegido do próximo `save` da tela até ela o ler.
  const notes = createFileNotesStore({ dir: userData, keep: (meetingId) => agentNotes.get(meetingId) ?? NO_NOTES })
  // Análises "Analisar até agora" (contrato 19), salvas com a reunião.
  const analyses = createFileAnalysesStore({ dir: userData })
  // Conta Google e fila do Drive (contrato 11). Rede só pelo `net.fetch` do main; no smoke, o Google falso em
  // memória (`google/fake-google.ts`) com o `safeStorage` substituto, e o "navegador" é o próprio smoke.
  const googleFetch = smokeFixtures ? smokeFixtures.google.fetch : netHttp
  if (smokeFixtures) smokeFixtures.google.photo = readFileSync(join(app.getAppPath(), 'test', 'fixtures', 'brand', 'logo-smoke.png'))
  const google = createGoogleAccount({
    dir: userData,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    fetch: googleFetch,
    openExternal: openBrowser,
    photoToDataUrl,
    onStatus: (status) => {
      broadcast(appWindows(), 'scribe:google-state', status)
      calendarService?.accountsChanged()
    },
    onSignedIn: (email) => drive.signedIn(email),
    onSignedOut: () => drive.clear(),
  })
  // Conta Microsoft (contrato 12): no smoke, a Microsoft falsa em memória; o "navegador" é o próprio smoke.
  const microsoft = createMicrosoftAccount({
    dir: userData,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    fetch: smokeFixtures ? smokeFixtures.microsoft.fetch : netHttp,
    openExternal: openBrowser,
    photoToDataUrl,
    onStatus: (status) => {
      broadcast(appWindows(), 'scribe:microsoft-state', status)
      calendarService?.accountsChanged()
    },
  })
  const drive = createDriveSync({
    dir: userData,
    account: google,
    enabled: async () => (await settings.get()).saveToDrive,
    files: { meetings, transcripts, summaries, notes, analyses },
    fetch: googleFetch,
    onStatus: (meetingId, status) => broadcast(appWindows(), 'scribe:drive-state', { meetingId, status }),
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  driveService = drive
  // No smoke a área de transferência fica só na memória: o clipboard do Mac não é tocado.
  const appClipboard = smokeFixtures ? { writeText: (text: string): void => void smokeFixtures.copiedTexts.push(text) } : clipboard
  // Tradução pelo `claude` local. No smoke, só o binário falso (test/fixtures/fake-claude.mjs): o
  // `claude` de verdade nunca roda, nem pelo shell de login.
  const smokeClaude = smokeFixtures ? createSmokeClaude(join(app.getAppPath(), 'test', 'fixtures', 'fake-claude.mjs'), smokeFixtures) : null
  // Agente do ACP (contrato 17): o adaptador oficial, com o Node do próprio Electron, um processo por sessão.
  // No smoke, o agente falso (test/fixtures/fake-acp-agent.mjs), que registra o que recebeu.
  const smokeAcp = smokeFixtures
    ? createSmokeAcp(join(app.getAppPath(), 'test', 'fixtures', 'fake-acp-agent.mjs'), join(userData, 'acp-fake.jsonl'), smokeFixtures)
    : null
  // O pacote não leva o agente: no app instalado (e no smoke, com o registro falso) ele é baixado com o
  // clique da pessoa para `userData/acp/<perfil>/<versão>`; em desenvolvimento, o do `node_modules`. Um
  // serviço por perfil (contrato 17, CA11); o perfil vem das Configurações a cada uso.
  const devLog = app.isPackaged ? {} : { log: (message: string) => console.log(message) }
  const acpAgents = new Map<AgentProfileId, AcpAgentService>()
  const agentFor = (profile: AgentProfile): AcpAgentService => {
    const known = acpAgents.get(profile.id)
    if (known) return known
    const created: AcpAgentService =
      app.isPackaged || smokeAcp
        ? installedAgent(
            createAcpInstaller({
              root: join(userData, 'acp', profile.id),
              download: smokeAcp?.download ?? netDownloadTarball,
              packages: smokeAcp ? smokeAcp.packagesFor(profile.install.packages) : profile.install.packages,
              version: profile.install.version,
              entry: profile.install.entry,
              label: profile.label,
              onStatus: (status) => broadcast(appWindows(), 'scribe:acp-state', status),
              ...devLog,
            }),
            smokeAcp ? () => smokeAcp.entry : undefined,
          )
        : bundledAgent(profile, bundledAdapterEntry(profile, app.getAppPath()))
    acpAgents.set(profile.id, created)
    return created
  }
  const currentProfile = async (): Promise<AgentProfile> => agentProfile((await settings.get()).agentProfile)
  const acpAgent = { current: async (): Promise<AcpAgentService> => agentFor(await currentProfile()) }
  // Contrato 21: os servidores MCP entram só nas sessões que pedem (chat das conversas e análise); o serviço nasce depois
  // do `claude` (precisa achar o binário), então a fábrica lê por aqui.
  const mcpRef: { current: McpService | null } = { current: null }
  // Contrato 47: o servidor MCP local com as ferramentas do navegador, para a sessão do Assistente que abre com a ponte
  // ligada e a extensão conectada. Sobe na primeira dessas sessões; cada uma tem o próprio token.
  const navegadorMcp = createNavegadorMcpServer({ ponte: () => navegadorServer, ...devLog })
  const openAcp = acpOpener({
    navegadorMcp,
    profile: currentProfile,
    mcp: {
      servers: async (use, off) => (mcpRef.current ? mcpRef.current.sessionServers(use, off) : []),
      capabilities: (capabilities) => mcpRef.current?.agentCapabilities(capabilities),
      // Contrato 57: os conectores do claude.ai ligados, só para o chat.
      connectors: async () => (mcpRef.current ? mcpRef.current.sessionConnectors() : null),
    },
    // Contrato 57: bloqueado (contrato 22), a ferramenta de um conector é negada.
    locked: () => lockService?.isLocked() ?? false,
    launch: processLauncher({
      execPath: process.execPath,
      entry: (profile) => agentFor(profile).entry(),
      ...(smokeAcp ? { args: smokeAcp.args, spawn: smokeAcp.spawn } : {}),
      ...devLog,
    }),
    baseEnv: process.env,
    ...devLog,
  })
  const claude = createClaudeService({
    settings,
    userData,
    home: app.getPath('home'),
    baseEnv: process.env,
    exec: smokeClaude?.exec ?? nodeExecFile,
    spawn: smokeClaude?.spawn ?? nodeSpawnClaude,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    ...(smokeClaude ? { candidates: smokeClaude.candidates, loginShell: false } : {}),
    onState: (state) => broadcast(appWindows(), 'scribe:claude-state', state),
    // Custo nominal e trocas de processo só nos logs de desenvolvimento.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Contrato 21: os servidores MCP. Os do Claude CLI vêm do `claude mcp` (no smoke, do `claude` falso, que guarda tudo num
  // arquivo do userData) e do arquivo dele (`~/.claude.json`); os do app, de `userData/mcp-servers.json`, com os segredos
  // cifrados pelo Chaveiro (no smoke, o substituto em memória). Nada disso vai para log.
  const smokeMcp = smokeFixtures ? writeSmokeMcpFixtures(userData, join(app.getAppPath(), 'test', 'fixtures', 'fake-mcp-server.mjs')) : null
  const mcp = createMcpService({
    store: createMcpStore({ dir: userData, safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage, ...devLog }),
    cli: createMcpCli({
      exec: smokeClaude?.exec ?? nodeExecFile,
      baseEnv: process.env,
      configFile: smokeMcp?.cliFile ?? join(app.getPath('home'), '.claude.json'),
      cwd: join(userData, CLAUDE_CWD_DIR, 'mcp'),
      ...(smokeMcp ? { extraEnv: smokeMcp.env } : {}),
      // Contrato 58: as ferramentas dos conectores, do `claude` no modo de controle (no smoke, o falso).
      spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    }),
    locate: () => claude.locate(),
    desktopConfig: smokeMcp?.desktopFile ?? join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'),
    baseEnv: process.env,
    // No smoke, sem o shell de login (o `PATH` do próprio processo).
    loginPath: smokeFixtures ? async () => process.env['PATH'] ?? '/usr/bin:/bin' : loginPathOnce(nodeExecFile, process.env),
    // Contrato 57: os conectores do claude.ai ligados ficam em `settings.claudeConnectors`; "Sempre permitir" grava lá.
    connectorPrefs: async () => (await settings.get()).claudeConnectors,
    allowConnectorTool: async (name, tool) => {
      await settings.mutate((current) => {
        const entry = current.claudeConnectors[name]
        return entry ? { claudeConnectors: { ...current.claudeConnectors, [name]: { ...entry, tools: { ...entry.tools, [tool]: 'allow' } } } } : null
      })
    },
    ...devLog,
  })
  mcpRef.current = mcp
  // WhatsApp pessoal (contrato 24): desligado por padrão; o serviço é processo filho, só depois de "Instalar" e
  // "Ligar". No smoke, o cliente falso (`backend_fake.py`) e um índice de pacotes falso numa pasta local: nenhum
  // neonize, nenhuma rede, nenhum número de verdade.
  const whatsapp = createWhatsAppService({
    root: join(userData, WHATSAPP_DIR),
    bridgeSource: bridgeSourceDir(),
    bridgeFiles: smokeFixtures ? [...BRIDGE_FILES, BRIDGE_FAKE_FILE] : BRIDGE_FILES,
    backend: smokeFixtures ? 'fake' : 'neonize',
    index: smokeFixtures ? { kind: 'local', dir: smokeFixtures.whatsapp.indexDir } : { kind: 'pypi' },
    ...(smokeFixtures ? { requirements: smokeFixtures.whatsapp.requirements } : {}),
    pythonCandidates: PYTHON_CANDIDATES,
    exec: nodeExec,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    baseEnv: process.env,
    // "Rascunho com o Claude": o motor do contrato 17, numa execução curta sem ferramenta nenhuma.
    draft: async (input) => {
      const found = await claude.locate()
      if (!found.ok) return { ok: false, error: 'not-found' }
      const { result } = await runClaudeOneShot(
        {
          settings,
          spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
          openAcp,
          acpAvailable: async () => (await acpAgent.current()).available(),
          userData,
          baseEnv: process.env,
          ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
        },
        { claudePath: found.path, purpose: 'draft', acpDir: ACP_DRAFT_DIR, systemPrompt: draftSystemPrompt(), parse: parseDraft, input, label: 'rascunho do WhatsApp', timeoutMs: DRAFT_TIMEOUT_MS, signal: new AbortController().signal },
      )
      return result
    },
    // Contrato 35: "Corrigir ao enviar" pelo mesmo motor, sempre com o Haiku, numa execução curta sem ferramenta
    // nenhuma; recebe e devolve só o texto.
    correct: createCorrector({
      settings,
      locate: () => claude.locate(),
      enabled: async () => (await settings.get()).whatsappAutoCorrect,
      spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
      openAcp,
      acpAvailable: async () => (await acpAgent.current()).available(),
      userData,
      baseEnv: process.env,
      ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
    }),
    meeting: async (meetingId) => {
      const meeting = await meetings.get(meetingId)
      return meeting ? { meeting, summary: await summaries.get(meetingId).catch(() => null) } : null
    },
    // Contrato 37: "Transcrever" o áudio, só no clique: o arquivo vai à AssemblyAI com a chave já guardada (no smoke,
    // as respostas falsas de `smokeFixtures.fetch`).
    transcribe: (bytes) => fileTranscriber.transcribe(bytes),
    // Bloqueado (contrato 22), nada do WhatsApp vai às janelas; o serviço segue conectado.
    onStatus: (status) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:whatsapp-state', status)
      refreshWhatsAppBadge()
    },
    // Contrato 40: a notificação sai também com o app bloqueado (sem o texto); o número do Dock é relido.
    onMessage: (message, chatName) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:whatsapp-message', { message, chatName })
      notifyWhatsApp(message, chatName).catch((error: unknown) => console.error('[whatsapp] notificação:', error))
      refreshWhatsAppBadge()
    },
    onChatsChanged: () => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:whatsapp-chats-changed', undefined)
      refreshWhatsAppBadge()
    },
    // Contrato 34: as reações e o "digitando…" dos outros, só com o app desbloqueado; o seu "digitando…" só com o
    // interruptor ligado (lido a cada vez).
    onReactions: (update) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:whatsapp-reactions', update)
    },
    onPresence: (presence) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:whatsapp-presence', presence)
    },
    typingEnabled: async () => (await settings.get()).whatsappTypingSignal,
    // Só estados, nunca texto de mensagem.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  whatsappService = whatsapp
  // Contrato 62: o serviço de convites depende do `inviteSource` do email, e o email avisa o serviço quando um REPLY sai
  // (CA16): o aviso fecha sobre esta variável, preenchida logo depois do email.
  let invites: InviteService | null = null
  // Email (contrato 42): as contas conectam direto do main (IMAP/POP3/SMTP), com a senha cifrada no `settings.json`.
  // O autoconfig só manda o domínio ao ISPDB do Thunderbird; no smoke, nenhuma rede (a tela cai no manual).
  const email = createEmailService({
    root: join(userData, EMAIL_DIR),
    settings,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    // Contrato 43: no smoke, o servidor de email falso em memória (IMAP, SMTP e o teste de conexão).
    ...(smokeFixtures ? { imap: smokeFixtures.email.imap, imapReader: smokeFixtures.email.imapReader, imapFolders: smokeFixtures.email.imapFolders, pop3: smokeFixtures.email.pop3, smtp: smokeFixtures.email.smtp, smtpVerify: smokeFixtures.email.smtpVerify } : {}),
    fetch: smokeFixtures
      ? () => Promise.reject(new TypeError('smoke: sem rede'))
      : (url, { signal }) => netFetch(url, { method: 'GET', headers: { accept: 'application/xml' }, signal, redirect: 'error' }),
    // O MX do domínio (só o domínio vai ao DNS), para reconhecer Zoho, Google Workspace e Microsoft 365 em domínio próprio.
    ...(smokeFixtures ? {} : { resolveMx: (domain: string) => resolveMx(domain).then((records) => records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange)) }),
    // Bloqueado (contrato 22), nada do email vai às janelas; as contas seguem conectadas.
    onStatus: (statuses) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:email-state', statuses)
    },
    // Contrato 43: a notificação sai também com o app bloqueado (sem o assunto). Contrato 53: sem ela quando uma regra
    // pediu "não avisar" ou levou o email à Lixeira (`notify: false`); a lista recebe sempre.
    onMessage: (message, { notify }) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:email-message', message)
      if (notify) notifyEmail(message).catch((error: unknown) => console.error('[email] notificação:', error))
    },
    onMessagesChanged: (accountId) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:email-changed', { accountId })
    },
    // Contrato 56: a conta removida leva os lotes do Assistente. Contrato 62: e as linhas dela no registro de convites
    // (os eventos que estão na agenda ficam).
    onAccountRemoved: (accountId) => {
      void emailTools.organizer?.forgetAccount(accountId).catch(() => undefined)
      void invites?.forgetAccount(accountId)
    },
    // Contrato 62 (CA16): o REPLY saiu; a resposta vai para o registro (um caminho só: o `reply` do resultado não é usado).
    onInviteReplied: (event) => void invites?.recordReply(event).catch(() => undefined),
    // Contrato 64: a ação "Pôr na agenda" das regras, pela entrada do 62 que só cria (nunca pede acesso, nunca responde).
    invites: {
      addFromRule: (source) => (invites ? invites.addFromRule(source) : Promise.resolve({ ok: false, error: 'no-calendar' } as const)),
      calendarPresent: () => (invites ? invites.calendarPresent() : Promise.resolve(false)),
    },
    // Só estados e tipos de erro, nunca senha, endereço ou texto de mensagem.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  emailService = email
  // Redes (contrato 69): o Instagram pela Graph API (`net.fetch`, só os hosts da lista) com o token cifrado no cofre; no
  // smoke, o Instagram falso em memória e o relógio dele (para "passar" dias sem esperar).
  const redes = createRedesService({
    userData,
    safeStorage: smokeFixtures ? memorySafeStorage() : safeStorage,
    // No smoke, o Instagram e o S3 falsos por host (`redesFetch`); nada sai da máquina.
    fetch: smokeFixtures ? smokeFixtures.redesFetch : netHttp,
    ...(smokeFixtures ? { now: smokeFixtures.instagram.now } : {}),
    testMediaHost,
    // Bloqueado (contrato 22), nada das redes vai às janelas; a renovação do token segue.
    onState: (state) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:redes-state', state)
    },
    // Contrato 71: a fila de publicações. Bloqueado, o agendador não começa nada (CA15) e nada vai às janelas; o
    // "Publicar agora" e o "Agendar" com um guarda de clique próprio; no smoke, o diálogo devolve os arquivos da fixture
    // e a espera entre as consultas do contêiner é curta (o Instagram falso responde na hora).
    isLocked: () => lockService?.isLocked() ?? false,
    clickGuard: createEmailClickGuard(),
    pickFiles: chooseRedesMedia,
    onPublications: (payload) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:redes-publications', payload)
    },
    ...(smokeFixtures ? { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 50))) } : {}),
    // Contrato 72: a miniatura da fila e do editor, pelo decodificador do Chromium (a tela não lê arquivo do disco).
    thumbnail: redesThumbnail,
    // 73: comentários
    // Contrato 73: os comentários; bloqueado, nada vai às janelas (e o polling não lê).
    onComments: (payload) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:redes-comments', payload)
    },
    // fim 73
    // 73/74: polling
    pollMinutes: async () => (await settings.get()).redesPollMinutes,
    // fim 73/74
    // 74: mensagens
    // Contrato 74: as mensagens diretas; bloqueado, nada vai às janelas (e o polling não lê).
    onMessages: (payload) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:redes-messages', payload)
    },
    // fim 74
    // 75: métricas
    onMetrics: (state) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:redes-metrics', state)
    },
    // fim 75
  })
  redesService = redes
  // Contrato 60: o Calendário do Mac pelo `lap-calendar`, sob demanda (nada sobe até o primeiro pedido). No smoke, o
  // falso (test/fixtures/fake-lap-calendar.mjs, CA24 do 62), com o estado e o log no userData do smoke.
  const macCalendarFixture = smokeFixtures?.macCalendar
  const macCalendar = createMacCalendar({
    platform: process.platform,
    arch: process.arch,
    systemVersion: process.getSystemVersion(),
    // No smoke, como empacotado: o `request-access` do falso responde (no `pnpm dev` de verdade, `unavailable`/`dev`).
    packaged: macCalendarFixture ? true : app.isPackaged,
    command: macCalendarFixture
      ? async () => ({
          file: process.execPath,
          args: [join(app.getAppPath(), 'test', 'fixtures', 'fake-lap-calendar.mjs')],
          env: { ELECTRON_RUN_AS_NODE: '1', FAKE_LAP_CALENDAR_STATE: macCalendarFixture.statePath, FAKE_LAP_CALENDAR_LOG: macCalendarFixture.logPath, TZ: process.env['TZ'] },
        })
      : async () => {
          const file = await locateMacCalendar({
            platform: process.platform,
            arch: process.arch,
            systemVersion: process.getSystemVersion(),
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            ...devLog,
          })
          return file ? { file, args: [], env: { PATH: '/usr/bin:/bin' } } : null
        },
    ...devLog,
  })
  // Contrato 62: o convite sai sempre do corpo guardado (`inviteSource`, sem rede); o `.ics` do "Abrir no app de agenda"
  // vai para `userData/tmp` e, no smoke, nada abre de verdade.
  const inviteService = createInviteService({
    root: userData,
    calendar: macCalendar,
    settings: () => settings.get(),
    source: (accountId, id) => email.inviteSource(accountId, id),
    openPath: smokeFixtures
      ? (path) => {
          smokeFixtures.openedFiles.push({ action: 'open', path })
          return Promise.resolve('')
        }
      : (path) => shell.openPath(path),
    ...devLog,
  })
  invites = inviteService
  // Contrato 64: o "Sugerir evento", sempre com o Haiku, numa execução curta sem ferramenta nenhuma; só o texto do email
  // aberto, do corpo guardado, e só pelo canal com o token de clique próprio.
  const inviteSuggest = createInviteSuggestChannels({
    suggester: createInviteSuggester({
      settings,
      locate: () => claude.locate(),
      enabled: async () => (await settings.get()).inviteSuggest,
      spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
      openAcp,
      acpAvailable: async () => (await acpAgent.current()).available(),
      userData,
      baseEnv: process.env,
      ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
    }),
    guard: createEmailClickGuard(),
    locked: () => lockService?.isLocked() ?? false,
    enabled: async () => (await settings.get()).inviteSuggest,
    stored: (accountId, id) => email.storedMessage(accountId, id),
    invites: inviteService,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  inviteSuggestChannels = inviteSuggest
  // Contrato 32: os Detalhes da conversa (resumo, humor, pendências) pelo mesmo motor, numa execução curta sem
  // ferramenta nenhuma. Só lê as mensagens; o resultado fica em `whatsapp/insights.json`.
  // Contrato 122: o mesmo cache também é lido pelas sugestões das tarefas.
  const insightsCache = createInsightsCache(join(userData, WHATSAPP_DIR, INSIGHTS_FILE))
  const whatsappInsights = createInsightsService({
    settings,
    cache: insightsCache,
    locate: () => claude.locate(),
    chat: (chatId) => whatsapp.findChat(chatId),
    messages: (chatId, max) => whatsapp.lastMessages(chatId, max),
    enabled: async () => (await settings.get()).whatsappInsights,
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Acervo do chat (contrato 15): um `.md` por reunião e o índice, reescritos a cada mudança da reunião.
  const corpus = createChatCorpus({ dir: userData, meetings, transcripts, summaries, notes })
  // Chat do "Assistente": o mesmo `claude` e o mesmo caminho configurado, um processo por conversa, só leitura.
  // Conversas do chat: a mesma fila para o "Assistente" e para a saída `chat` das automações (contrato 23).
  const chatStore = createFileChatStore({ dir: userData })
  const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone
  // Contrato 25: as fontes do Assistente, relidas a cada pergunta. Do WhatsApp, só a exportação e a lista das
  // conversas (para o nome no cartão); o envio não chega aqui. As automações chegam pela função, depois de criadas.
  const guidePath = join(app.getAppPath(), 'resources', 'assistente', 'guia-do-app.md')
  // Contrato 78: o acesso e as agendas do `ESTADO.md` guardados por 30 s (esquecidos no "Pedir acesso", na volta do foco
  // à janela e quando o cartão lê outro acesso na hora).
  const calendarReads = cachedCalendarReads(macCalendar)
  app.on('browser-window-focus', () => calendarReads.invalidate())
  const assistantState = async (): Promise<AssistantState> => {
    const [status, agents, tasks, calendar] = await Promise.all([
      automations.status(),
      automations.listAgents(),
      automations.listTasks(),
      // Contrato 78: as agendas do Calendário do Mac, só leitura (nunca pede acesso).
      calendarOverview(calendarReads, async () => (await settings.get()).inviteCalendarId),
    ])
    const account = google.status()
    return {
      now: Date.now(),
      timeZone: timeZone(),
      version: app.getVersion(),
      recording: recordingSessions.active() && recordingStartedAt !== null ? { startedAt: recordingStartedAt } : null,
      google: account.state === 'signed-in' && account.profile ? `conectada como ${account.profile.email}` : account.state === 'expired' ? 'sessão expirada (entrar de novo em Configurações › Contas)' : 'não conectada',
      whatsapp: whatsappStateLabel(whatsapp.status()),
      email: emailStateLabel(email.accounts()),
      automationsPaused: status.paused ? (status.pauseReason === 'limit' ? 'pausadas pelo limite diário' : 'pausadas pela pessoa') : null,
      agents: agents.agents,
      tasks,
      calendar,
    }
  }
  // Contrato 76: as ferramentas do Instagram (a fila, os comentários guardados e o rascunho sem publicar) e o `REDES.md`.
  const redesAssistant = createRedesAssistant({ service: redes, locked: () => lockService?.isLocked() ?? false, timeZone })
  const assistantSources = {
    state: assistantState,
    guide: () => readFile(guidePath, 'utf8'),
    automations: async () => {
      const [agents, tasks, items] = await Promise.all([automations.listAgents(), automations.listTasks(), automations.listRuns({})])
      const runs = await Promise.all(items.slice(0, AUTOMATION_RUNS_IN_SOURCE).map((item) => automations.getRun({ id: item.id })))
      return { agents: agents.agents, tasks, runs: runs.filter((run): run is AutomationRun => run !== null) }
    },
    whatsapp: { exportRecent: (folder: string) => whatsapp.exportRecent(folder), exportChats: (folder: string, chatIds: readonly string[], days: number) => whatsapp.exportChats(folder, chatIds, days) },
    // Contrato 45: o cache do email (só leitura do store; bloqueado, nada).
    email: { export: (folder: string) => exportEmail(emailExport, folder) },
    // Contrato 76: o guardado das redes (sem ler a Meta); bloqueado, nada.
    redes: () => redesAssistant.sourceAccounts(),
    // Contrato 117: o `FUNIL.md` do gerador do contrato 115; bloqueado, nada.
    funil: async () => (lockService?.isLocked() ? null : funilMarkdownText()),
    ...devLog,
  }
  // Contrato 45: o email do Assistente. O `EMAILS.md` e as mensagens já baixadas saem do cache (sem servidor); as
  // ferramentas `buscar_emails` e `ler_email` (CA7) vão ao servidor IMAP só para leitura. Bloqueado (CA5), nada disso.
  const emailLocked = (): boolean => lockService?.isLocked() ?? false
  const emailExport = {
    cached: () => email.cached(),
    body: (accountId: string, message: EmailMessage) => email.cachedBody(accountId, message),
    reminders: async () =>
      (await automations.listTasks()).flatMap((task) => {
        const next = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN
        return task.enabled && task.reminder?.email && !Number.isNaN(next) ? [{ accountId: task.reminder.email.accountId, messageId: task.reminder.email.messageId, mailbox: task.reminder.email.mailbox ?? null, when: formatRunAt(next, task.timezone) }] : []
      }),
    locked: emailLocked,
  }
  const emailTools = createEmailTools({
    cached: () => email.cached(),
    body: (accountId, message) => email.cachedBody(accountId, message),
    searchServer: (accountId, query, limit) => email.searchServer(accountId, query, limit),
    peekServer: (accountId, mailbox, uid) => email.peekServer(accountId, mailbox, uid),
    locked: emailLocked,
    // Contrato 56: organizar o email (só o Assistente interativo); os lotes com o Desfazer em `email/batches.json`.
    organize: {
      store: createEmailBatchStore(join(userData, EMAIL_DIR)),
      accounts: () => email.accounts(),
      listFolders: (accountId, options) => email.listFolders(accountId, options),
      openFolder: (accountId, path) => email.openFolder(accountId, path),
      createFolder: (accountId, parentPath, name) => email.createFolder(accountId, parentPath, name),
      moveMessages: (accountId, fromPath, uids, toPath, options) => email.moveMessages(accountId, fromPath, uids, toPath, options),
      locateMessages: (accountId, path, uids, messageIds) => email.locateMessages(accountId, path, uids, messageIds),
      // Bloqueado, nada do email vai às janelas (como os outros eventos do email).
      emit: (event) => {
        if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:email-organize', event)
      },
      // O cartão do lote fica `done` com a frase do Desfazer, na conversa que o tem.
      cardDone: async (batch, result) => {
        const saved = await markEmailBatchCard(chatStore, batch.chatId, batch.id, result)
        if (saved && !lockService?.isLocked()) broadcast(appWindows(), 'scribe:chat-event', { type: 'done', chatId: saved.id, chat: saved })
      },
      ...devLog,
    },
  })
  // Contrato 56 (CA11): o lote que ficou `running` (o app caiu no meio) vira `stopped`.
  void emailTools.organizer?.init().catch(() => undefined)
  const actionResolver = {
    whatsappChat: async (chatId: string) => {
      // A lista que a pergunta acabou de ler (uma chamada só ao serviço).
      const found = (await whatsapp.knownChats().catch(() => [])).find((item) => item.id === chatId)
      return found ? { name: found.name, kind: found.kind, ...(found.phone ? { phone: found.phone } : {}) } : null
    },
    agents: async () => (await automations.listAgents()).agents,
    meeting: async (meetingId: string) => meetings.get(meetingId),
    email: (ref: string) => emailTools.find(ref),
    // Contrato 78: o acesso e as agendas do Calendário do Mac, lidos na hora (só leitura: montar o cartão não grava nada), e
    // os lembretes. Acesso diferente do guardado para o `ESTADO.md` esquece o que estava guardado.
    calendar: {
      status: async () => {
        const outcome = await macCalendar.status()
        calendarReads.observe(outcome)
        return outcome
      },
      calendars: () => macCalendar.calendars(),
    },
    preferredCalendar: async () => (await settings.get()).inviteCalendarId,
    tasks: () => automations.listTasks(),
    // Contrato 76: as contas do Instagram conectadas (o id e o @).
    instagramAccounts: async () => redes.state().accounts.map((account) => ({ id: account.id, username: account.username })),
    // Contrato 117: o funil, só para ler os ids, as etapas e os contatos do cartão; bloqueado, o bloco fica como texto.
    funil: async () => (lockService?.isLocked() ? null : funil.view()),
    now: Date.now,
    timeZone,
  }
  const chat = createChatService({
    store: chatStore,
    corpus,
    // Contrato 24: só a exportação das conversas para a pasta de escopo; o envio não chega aqui.
    whatsapp: { exportChats: (folder, chatIds, days) => whatsapp.exportChats(folder, chatIds, days) },
    assistant: {
      prepare: (folder, scope) => writeSources(assistantSources, folder, scope),
      extract: (text) => extractActions(text, actionResolver),
      // Contrato 45 (CA7): com conta de email e a fonte ligada, as ferramentas de busca e leitura. Contrato 56: e as de
      // organizar (só aqui, no Assistente interativo; as automações recebem só as de leitura).
      // Contrato 76: com a fonte Redes ligada e uma conta do Instagram, as ferramentas do Instagram.
      tools: (scope) => [
        ...(chatSourcesOf(scope).email && email.accounts().length > 0 && !emailLocked() ? [...emailTools.tools, ...emailTools.organizeTools] : []),
        ...(chatSourcesOf(scope).redes && redes.state().accounts.length > 0 && !emailLocked() ? redesAssistant.tools : []),
      ],
      endTurn: (turn, outcome) => emailTools.organizer?.endTurn(turn, outcome) ?? Promise.resolve(),
    },
    settings,
    meetings,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawn ?? nodeSpawnClaude,
    openAcp,
    // Contrato 47: a ponte do navegador conectada agora (a sessão do Assistente abre com as ferramentas dela).
    navegador: { connected: () => navegadorServer?.connected() ?? false },
    baseEnv: process.env,
    onEvent: (event) => broadcast(appWindows(), 'scribe:chat-event', event),
    clipboard: appClipboard,
    // Custo nominal e ferramentas negadas só nos logs de desenvolvimento; nunca o texto das reuniões.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Resumo da reunião (contrato 08): o mesmo `claude` e o mesmo caminho configurado, numa execução curta.
  const summary = createSummaryService({
    settings,
    meetings,
    transcripts,
    summaries,
    notes,
    analyses,
    whatsappMaterial: (meetingId) => whatsapp.meetingMaterial(meetingId),
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    clipboard: appClipboard,
    writeToFolder: (meeting, result, meetingAnalyses) => writeSummaryFile(meeting, result, true, meetingAnalyses),
    onStatus: (meetingId, status) => {
      // Resumo novo entra no acervo do chat e vai para o Drive (substitui o anterior lá).
      if (status.state === 'ready') {
        void corpus.sync(meetingId).catch(() => undefined)
        void drive.enqueue(meetingId, ['summary']).catch(() => undefined)
        // Contrato 113 (R38, D8): a detecção de oportunidade, fora do smoke; o resumo nunca espera por ela.
        void autoDetect({ settings: () => settings.get(), proposals: funilPropostas, extract: funnel, smoke: smokeFixtures !== null }, meetingId).catch(() => undefined)
      }
      broadcast(appWindows(), 'scribe:summary-state', { meetingId, status })
    },
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Análise da reunião (contrato 19): o mesmo motor do resumo, numa execução curta, só com o clique.
  const analysis = createAnalysisService({
    settings,
    meetings,
    transcripts,
    notes,
    analyses,
    whatsappMaterial: (meetingId) => whatsapp.meetingMaterial(meetingId),
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    clipboard: appClipboard,
    onChange: (meetingId) => broadcast(appWindows(), 'scribe:analyses-changed', { meetingId }),
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // IA anotando ao vivo (contrato 30): o mesmo motor, um ciclo a cada 5 min com o interruptor da gravação ligado.
  const aiNotes = createAiNotesService({
    settings,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Excluir a reunião apaga a transcrição, o resumo, as anotações, as análises e as conversas do chat
  // internos; os arquivos da pasta ficam.
  const meetingsService = createMeetingsService({ meetings, transcripts, summaries: summary, notes, analyses: analysis, chats: chat, clipboard: appClipboard })
  // Lista e busca da tela de Reuniões (contrato 10): lê só o disco local; o estado "gerando" vem do resumo.
  const meetingsIndex = createMeetingsIndex({ dir: userData, meetings, transcripts, summaries, notes, activity: (id) => summary.activity(id), inDrive: (id) => drive.inDrive(id) })
  // Arquivos da reunião (contrato 07). No smoke, a "pasta pessoal" fica dentro do userData temporário
  // (nada vai para ~/Documents), o diálogo responde o que o smoke mandar e nada abre no Finder.
  const home = smokeUserData ? join(smokeUserData, 'home') : app.getPath('home')
  const files = createMeetingFilesService({
    settings,
    meetings,
    transcripts,
    notes,
    analyses,
    home,
    documents: smokeUserData ? join(home, 'Documents') : app.getPath('documents'),
    dialog: smokeFixtures ? { chooseFolder: () => Promise.resolve(smokeFixtures.chosenFolder) } : nativeFolderDialog,
    opener: smokeFixtures
      ? {
          openPath: (path) => {
            smokeFixtures.openedFiles.push({ action: 'open', path })
            return Promise.resolve('')
          },
          showItemInFolder: (path) => void smokeFixtures.openedFiles.push({ action: 'reveal', path }),
        }
      : nativeOpener,
  })
  const download = createMeetingDownload({
    meetings,
    transcripts,
    summaries,
    notes,
    analyses,
    dialog: smokeFixtures
      ? {
          chooseSavePath: (defaultPath) => {
            smokeFixtures.saveDialogs.push(defaultPath)
            return Promise.resolve(smokeFixtures.savePath)
          },
        }
      : nativeSaveDialog,
    downloads: smokeUserData ? join(home, 'Downloads') : app.getPath('downloads'),
  })
  // "Salvar plugin…" (contrato 31). No smoke o diálogo de pasta responde o mesmo `chosenFolder` da pasta de arquivos.
  const pluginSave = createPluginSave({
    sourceDir: pluginSourceDir,
    dialog: smokeFixtures ? { chooseFolder: () => Promise.resolve(smokeFixtures.chosenFolder) } : nativePluginFolderDialog,
    defaultFolder: smokeUserData ? join(home, 'Downloads') : app.getPath('downloads'),
  })
  // Logo próprio (contrato 09). No smoke o diálogo responde o que o smoke mandar.
  const branding = createBrandingService({
    settings,
    userData,
    dialog: smokeFixtures ? { chooseImage: () => Promise.resolve(smokeFixtures.chosenImage) } : nativeImageDialog,
    images: { fromPath: (path) => nativeImage.createFromPath(path) },
  })
  // Atualização pelo GitHub (contrato 14). No smoke, API e download falsos, o `.dmg` vai para o
  // "Downloads" dentro do userData temporário, nada abre no Finder e "Fechar o app agora" só é contado.
  const updates = createUpdateService({
    currentVersion: app.getVersion(),
    fetch: smokeFixtures ? smokeFixtures.updates.fetch : netFetch,
    request: smokeFixtures ? smokeFixtures.updates.request : netDownload,
    downloadsDir: smokeUserData ? join(home, 'Downloads') : app.getPath('downloads'),
    openPath: smokeFixtures
      ? (path) => {
          smokeFixtures.openedFiles.push({ action: 'open', path })
          return Promise.resolve('')
        }
      : (path) => shell.openPath(path),
    quit: smokeFixtures ? () => void smokeFixtures.updates.quitRequests++ : () => app.quit(),
    autoCheck: async () => (await settings.get()).autoCheckUpdates,
    onState: (state) => broadcast(appWindows(), 'scribe:update-state', state),
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Bloqueio do app (contrato 22). No smoke, Touch ID substituto e relógio que o smoke adianta (a espera de
  // 30 s passa sem esperar); o Touch ID de verdade nunca é pedido.
  const smokeLock = smokeFixtures?.lock
  const touchId: TouchIdAccess = smokeLock
    ? {
        available: () => smokeLock.touchIdAvailable,
        prompt: () => {
          smokeLock.touchIdPrompts++
          return smokeLock.touchIdApproves ? Promise.resolve() : Promise.reject(new Error('smoke: Touch ID recusado'))
        },
      }
    : {
        available: () => process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
        prompt: (reason) => systemPreferences.promptTouchID(reason),
      }
  const lock = createLockService({
    store: createFileLockStore({ dir: userData }),
    settings,
    touchId,
    onStatus: applyLockStatus,
    ...(smokeLock ? { now: () => Date.now() + smokeLock.skewMs } : {}),
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  if (smokeLock) smokeLock.refresh = () => void lock.refresh().catch(() => undefined)
  // Automações (contrato 23): cada execução é uma sessão ACP própria, com a política do chat (só leitura dentro
  // da pasta); as saídas ficam neste Mac. O WhatsApp não entra aqui: nenhum agente alcança o envio dele. O email só
  // com a permissão do contrato 51. No smoke, o relógio do agendador é o que o smoke adianta.
  const smokeAutomations = smokeFixtures?.automations
  const automations = createAutomationsService({
    agents: createFileAgentsStore({ dir: userData }),
    schedules: createFileSchedulesStore({ dir: userData }),
    runs: createFileRunsStore({ dir: userData }),
    runner: createAgentRunner({ locate: () => claude.locate(), openAcp, corpus, meetings, emptyDir: join(userData, 'automations-empty'), funilMarkdown: () => funilMarkdownText(), ...devLog }),
    applyOutput: (request) =>
      applyOutput(
        {
          chats: chatStore,
          notes,
          meetings,
          meetingsFolder: async () => (await files.folder()).path,
          onNoteSaved: (meetingId, noteId) => {
            const pending = agentNotes.get(meetingId) ?? new Set<string>()
            pending.add(noteId)
            agentNotes.set(meetingId, pending)
            void corpus.sync(meetingId).catch(() => undefined)
            if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:notes-changed', { meetingId })
          },
          ...(smokeAutomations ? { now: () => Date.now() + smokeAutomations.skewMs } : {}),
        },
        request,
      ),
    notify: showAutomationNotice,
    dailyLimit: async () => (await settings.get()).scheduledRunsDailyLimit,
    timeZone,
    onChange: (status) => {
      trayController?.refresh()
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:automations-changed', status)
    },
    // Bloqueado, nada da resposta vai às janelas; a execução continua e fica no histórico.
    onEvent: (event) => {
      if (event.type === 'done') trayController?.refresh()
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:automation-event', event)
    },
    // Contrato 122 (D6): os lembretes das tarefas no mesmo tick, depois do aviso do funil.
    onTick: async (at) => {
      await funilAlerts.tick(at)
      await tarefas.dispararLembretes(at)
    },
    ...(smokeAutomations ? { now: () => Date.now() + smokeAutomations.skewMs } : {}),
    // Contrato 51: só a tarefa com "Pode enviar email" envia, sem clique, pelo caminho interno do email (nunca pelo IPC),
    // depois das regras da permissão a cada envio; e lê o email com as mesmas ferramentas do Assistente. Bloqueado, nada.
    email: {
      send: (request) => email.sendForTask(request),
      accountAddress: (accountId) => email.accounts().find((status) => status.account.id === accountId)?.account.address ?? null,
      locked: emailLocked,
      readTools: () => emailTools.tools,
    },
    ...devLog,
  })
  // Agendas e avisos (contrato 12): só lê; rede só pelo `net.fetch` do main. No smoke, o Google e a Microsoft falsos.
  const calendar = createCalendarService({
    dir: userData,
    accounts: { google, microsoft },
    fetch: smokeFixtures ? (url, init) => (new URL(url).hostname === 'graph.microsoft.com' ? smokeFixtures.microsoft.fetch(url, init) : smokeFixtures.google.fetch(url, init)) : netHttp,
    settings: () => settings.get(),
    recording: () => recordingSessions.active() !== null,
    notify: showCalendarNotice,
    // Bloqueado (contrato 22), nada da agenda vai às janelas; ao desbloquear, o estado de agora.
    onView: (view) => {
      // Contrato 50: as reuniões de hoje no menu do ícone (que não mostra nada bloqueado).
      trayController?.refresh()
      // Contrato 62 (R5c): a cada leitura de agenda, a cópia da conta que apareceu toma o lugar da que o app criou (o
      // intervalo fica no serviço; sem evento gravado pelo app, nada sobe).
      void inviteService.reconcileAll()
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:calendar-state', view)
    },
    ...devLog,
  })
  calendarService = calendar
  // Contrato 27: a extensão do Meet manda nomes e eventos de fala. Vai às janelas também com o app bloqueado: a
  // gravação continua no bloqueio e o renderer carimba cada evento quando ele chega. Nada volta à extensão.
  // Contrato 48: cada mudança também passa pelo aviso "Começar a transcrever" (a janela dele não recebe o evento).
  const meetingPrompt = createMeetingPromptController({
    settings: () => settings.get(),
    recording: () => recordingSessions.active() !== null,
    locked: () => lockService?.isLocked() ?? false,
    openWindow: (current) => {
      const win = openMeetingPromptWindow(current)
      const contentsId = win.webContents.id
      return {
        // Pelo id do `webContents` (único por página), como o WhatsApp confere o clique da janela.
        isSender: (sender) => !win.isDestroyed() && typeof sender === 'object' && sender !== null && (sender as { id?: unknown }).id === contentsId,
        close: () => {
          if (!win.isDestroyed()) win.destroy()
        },
        onClosed: (listener) => void win.once('closed', listener),
        // Só para esta janela: o `broadcast` nunca a alcança.
        update: (state) => sendTo(win.webContents, 'scribe:meeting-prompt-changed', state),
      }
    },
    record: recordFromMeetingPrompt,
    disable: () => settings.update({ meetingPrompt: false }),
  })
  meetingPromptController = meetingPrompt
  // Contrato 49: o microfone ligado por outro app (Zoom, FaceTime…) também passa pelo aviso. No smoke, o binário falso
  // (test/fixtures/fake-mic-watch.mjs), que repete as linhas que o smoke escreve no arquivo das fixtures.
  const micWatch = createMicWatchService({
    command: smokeFixtures
      ? async () => ({ file: process.execPath, args: [join(app.getAppPath(), 'test', 'fixtures', 'fake-mic-watch.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', FAKE_MIC_WATCH_FILE: smokeFixtures.micWatch.file } })
      : async () => {
          const file = await locateMicWatch({
            platform: process.platform,
            arch: process.arch,
            systemVersion: process.getSystemVersion(),
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath(),
            log: (message) => console.warn(message),
          })
          return file ? { file, args: [], env: { PATH: '/usr/bin:/bin' } } : null
        },
    onState: (state) => void meetingPrompt.micChanged(state),
    log: (message) => console.warn(message),
  })
  micWatchService = micWatch
  const meet = createMeetServer({
    // Smoke: portas fora da faixa da extensão, para o Chrome de verdade nunca falar com ele.
    ...(smoke ? { ports: SMOKE_MEET_PORTS } : {}),
    onChange: (state) => {
      broadcast(appWindows(), 'scribe:meet-changed', state)
      void meetingPrompt.meetChanged(state)
      // Contrato 50: "Meet: conectado" no menu do ícone; só a conexão muda o menu.
      if (state.connected !== trayMeetConnected) {
        trayMeetConnected = state.connected
        trayController?.refresh()
      }
    },
    ...devLog,
  })
  meetServer = meet
  // Contrato 46: a ponte do "Controle do navegador". Conectar e desconectar vai às janelas; os comandos só saem do
  // main (neste contrato, nenhum consumidor ainda).
  const navegador = createNavegadorServer({
    // Smoke: portas fora da faixa da extensão, como no Meet.
    ...(smoke ? { ports: SMOKE_NAVEGADOR_PORTS } : {}),
    onChange: () => {
      broadcast(appWindows(), 'scribe:navegador-changed', navegadorState())
      // Contrato 50: "Navegador: conectado" no menu do ícone.
      trayController?.refresh()
    },
    ...devLog,
  })
  navegadorServer = navegador
  // Contrato 25: o clique nos cartões do Assistente. O lembrete é a tarefa "uma vez" sem agente das Automações.
  // Contrato 78: o evento no Calendário do Mac (gravado só no clique, registrado em `chat-events.json`) e alterar ou apagar
  // um lembrete das Automações.
  const chatActions = createChatActions({
    store: chatStore,
    createReminder: (input) => automations.createReminder(input),
    timeZone,
    calendar: macCalendar,
    events: createChatEventsStore(userData, devLog),
    reminders: { list: () => automations.listTasks(), update: (id, change) => automations.updateReminder(id, change), remove: (id) => automations.deleteTask({ id }) },
    // Contrato 76: o rascunho do Instagram sem mídia, pelo `savePublication` das redes (nunca publica nem agenda).
    instagram: {
      accounts: () => redes.state().accounts.map((account) => ({ id: account.id, username: account.username })),
      exists: (publicationId) => redes.hasPublication(publicationId),
      createDraft: async ({ accountId, caption, at, publicationId }) => {
        const saved = await redes.savePublication({ accountId, caption, mediaPaths: [], altTexts: {}, scheduledAt: at }, { draftWithoutMedia: true, newId: publicationId })
        if (saved.ok) return { ok: true, publicationId: saved.publication.id }
        return { ok: false, error: saved.problems.includes(REDES_ACCOUNT_MISSING_MESSAGE) ? 'missing' : 'invalid' }
      },
    },
    // Contrato 117: os cartões do funil gravam só pelo serviço do funil (110), no clique.
    funil: { view: () => funil.view(), contatoSave: (request) => funil.contatoSave(request), oportunidadeSave: (request) => funil.oportunidadeSave(request), oportunidadeMove: (request) => funil.oportunidadeMove(request), eventoAdd: (request) => funil.eventoAdd(request) },
    ...devLog,
  })
  // Contrato 110: o funil lê reuniões, email e WhatsApp só pelos caches deles; bloqueado, a view não vai às janelas.
  const funilStore = createFunilStore({ dir: userData, ...devLog })
  const funil = createFunilService({
    store: funilStore,
    meetings,
    summaries,
    email: { cached: () => email.cached() },
    whatsapp: { chats: () => whatsapp.chats(), me: () => whatsapp.status().me },
    chooseImportFile: chooseFunilImportFile,
    onChange: (view) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:funil-changed', view)
    },
    ...devLog,
  })
  // Contrato 115: o alerta diário (no tick das Automações) e o `FUNIL.md` dos agentes com "Pode ler o funil".
  const funilAlerts = createFunilAlerts({ view: () => funil.view(), ultimoAviso: async () => (await funilStore.read()).ultimoAvisoEm, settings: () => settings.get(), marcar: (at) => funil.marcarAviso(at), notify: showFunilNotice, timeZone, ...devLog })
  // Contrato 122: as tarefas leem funil, reuniões, análises e WhatsApp só pelos caches; bloqueado, a view não vai às janelas.
  const tarefas = createTarefasService({
    store: createTarefasStore({ dir: userData, ...devLog }),
    funil: { state: () => funilStore.read() },
    meetings,
    summaries,
    analyses: { list: (id) => analysis.list(id) },
    insights: insightsCache,
    whatsapp: { chats: () => whatsapp.chats() },
    settings: () => settings.get(),
    timeZone,
    notify: showTarefaNotice,
    onChange: (view) => {
      if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:tarefas-changed', view)
    },
    // No smoke, o mesmo relógio adiantado do tick: a view e o tick concordam sobre o dia de hoje.
    ...(smokeAutomations ? { now: () => Date.now() + smokeAutomations.skewMs } : {}),
    ...devLog,
  })
  tarefasService = tarefas
  const funilMarkdownText = async (): Promise<string> => {
    const [view, { funil: config }, lista] = await Promise.all([funil.view(), settings.get(), meetings.list()])
    return funilMarkdown({ view, diasEsfriar: config.diasEsfriar, reunioes: new Map(lista.map((meeting) => [meeting.id, meeting.title])), now: Date.now(), timeZone: timeZone() })
  }
  // Contrato 113: a proposta de IA de cada reunião e a passada `funnel-extract`, com o mesmo motor do resumo.
  const funilPropostas = createFunilProposalStore({ meetingsDir: join(userData, MEETINGS_DIR) })
  const notifyProposta = (meetingId: string): void => broadcast(appWindows(), 'scribe:funil-proposta-changed', { meetingId })
  const funnel = createFunnelExtractService({
    settings,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    meetings,
    summaries,
    funil: funilStore,
    proposals: funilPropostas,
    onChange: notifyProposta,
    ...devLog,
  })
  return {
    settings: createSettingsService({ settings, secrets, gateway, mic }),
    meetings,
    transcripts,
    meetingsService,
    meetingsIndex,
    tokenClient: createTokenClient({ fetch: fetchImpl, getApiKey: () => secrets.getApiKey() }),
    translation: createTranslationService(gateway),
    claude,
    files,
    summary,
    analysis,
    aiNotes,
    download,
    branding,
    updates,
    chat,
    chatActions,
    corpus,
    acp: acpAgent,
    lock,
    google,
    drive,
    microsoft,
    calendar,
    whatsapp,
    whatsappInsights,
    email,
    emailOrganizer: emailTools.organizer,
    redes,
    automations,
    meet,
    meetingPrompt,
    micWatch,
    macCalendar,
    invites: inviteService,
    calendarReads,
    inviteSuggest,
    pluginSave,
    mcp,
    navegador,
    navegadorMcp,
    funil,
    funnel,
    funilProposta: { funnel, proposals: funilPropostas, store: funilStore, meetings, onChange: notifyProposta },
    tarefas,
  }
}

/** Foto do perfil Google em data URL PNG, com até 256 px no lado maior; `null` se não for imagem. */
function photoToDataUrl(bytes: Uint8Array): string | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const sized = width > 256 || height > 256 ? image.resize(width >= height ? { width: 256, quality: 'best' } : { height: 256, quality: 'best' }) : image
  return sized.toDataURL()
}

/** Login da conta (contratos 11 e 12): só a página do Google ou da Microsoft, no navegador do sistema. */
async function openBrowser(url: string): Promise<void> {
  if (!isBrowserUrl(url)) throw new Error('endereço de login fora da lista')
  if (smokeFixtures) smokeFixtures.openedUrls.push(url)
  else await shell.openExternal(url)
}

/** "Escolher pasta…": diálogo do macOS preso à janela principal, com "Nova pasta". */
const nativeFolderDialog: FolderDialog = {
  async chooseFolder(defaultPath) {
    const options: OpenDialogOptions = { title: 'Pasta dos arquivos da reunião', buttonLabel: 'Escolher', defaultPath, properties: ['openDirectory', 'createDirectory'] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
}

/** "Salvar plugin…" (contrato 31): o mesmo diálogo de pasta, com o título do plugin. */
const nativePluginFolderDialog: FolderDialog = {
  async chooseFolder(defaultPath) {
    const options: OpenDialogOptions = { title: 'Onde salvar o plugin', buttonLabel: 'Salvar aqui', defaultPath, properties: ['openDirectory', 'createDirectory'] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
}

/** "Baixar…": diálogo de salvar do macOS; ele mesmo pergunta antes de trocar um arquivo que já existe. */
const nativeSaveDialog: SaveDialog = {
  async chooseSavePath(defaultPath, extension) {
    const options: SaveDialogOptions = { defaultPath, buttonLabel: 'Salvar', filters: [{ name: extension === 'md' ? 'Markdown' : 'Áudio', extensions: [extension] }] }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  },
}

/** "Escolher imagem…": um arquivo PNG ou JPG. SVG fica de fora (pode carregar script). */
const nativeImageDialog: ImageDialog = {
  async chooseImage() {
    const options: OpenDialogOptions = {
      title: 'Logo do app',
      buttonLabel: 'Escolher',
      properties: ['openFile'],
      filters: [{ name: 'Imagem PNG ou JPG', extensions: ['png', 'jpg', 'jpeg'] }],
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
}

/** Contrato 39: o clipe do campo do WhatsApp, só imagem e vídeo (o tipo é conferido de novo pelos bytes). */
async function chooseWhatsAppAttachment(): Promise<string | null> {
  if (smokeFixtures) return smokeFixtures.chosenAttachment
  const options: OpenDialogOptions = {
    title: 'Anexar imagem ou vídeo',
    buttonLabel: 'Anexar',
    properties: ['openFile'],
    filters: [{ name: 'Imagem ou vídeo', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov'] }],
  }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Contrato 110: "Importar…" do funil, um CSV ou vCard por vez (R13). No smoke, o CSV da fixture. */
async function chooseFunilImportFile(): Promise<string | null> {
  if (smokeFixtures) return smokeFixtures.funilImportFile
  const options: OpenDialogOptions = {
    title: 'Importar contatos',
    buttonLabel: 'Importar',
    properties: ['openFile'],
    filters: [{ name: 'CSV ou vCard', extensions: ['csv', 'vcf', 'txt'] }],
  }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Contrato 43 (CA8): onde salvar o anexo baixado. No smoke, o substituto registra e "responde" `savePath`. */
async function chooseAttachmentSavePath(defaultPath: string): Promise<string | null> {
  if (smokeFixtures) {
    smokeFixtures.saveDialogs.push(defaultPath)
    return smokeFixtures.savePath
  }
  const options: SaveDialogOptions = { title: 'Salvar anexo', defaultPath, buttonLabel: 'Salvar' }
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** Contrato 43: o clipe do composer do email, qualquer arquivo (até 10 de uma vez). */
async function chooseEmailAttachments(): Promise<string[]> {
  if (smokeFixtures) return smokeFixtures.chosenEmailAttachments
  const options: OpenDialogOptions = { title: 'Anexar arquivos', buttonLabel: 'Anexar', properties: ['openFile', 'multiSelections'] }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** Contrato 71: as mídias de uma publicação (JPEG, MP4, MOV; várias). No smoke, os arquivos da fixture. */
async function chooseRedesMedia(): Promise<string[]> {
  if (smokeFixtures) return smokeFixtures.chosenRedesMedia
  const options: OpenDialogOptions = {
    title: 'Escolher mídias',
    buttonLabel: 'Escolher',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens JPEG e vídeos MP4 ou MOV', extensions: ['jpg', 'jpeg', 'mp4', 'mov'] }],
  }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** Contrato 72: a miniatura de uma imagem em JPEG, até 192 px de lado (96 px na tela, em Retina), como data URL. */
function redesThumbnail(path: string): Promise<string | null> {
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return Promise.resolve(null)
  const { width, height } = image.getSize()
  const scale = Math.min(1, 192 / Math.max(width, height, 1))
  const small = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : image
  return Promise.resolve(`data:image/jpeg;base64,${small.toJPEG(80).toString('base64')}`)
}

const nativeOpener: FileOpener = {
  openPath: (path) => shell.openPath(path),
  showItemInFolder: (path) => shell.showItemInFolder(path),
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function openExternal(url: string): void {
  if (smokeFixtures) smokeFixtures.openedUrls.push(url)
  else void shell.openExternal(url)
}

function registerIpc(services: AppServices): void {
  const { settings, meetings, meetingsService, meetingsIndex, tokenClient, translation, claude, files, summary, analysis, aiNotes, download, branding, updates, chat, chatActions, corpus, acp, lock, google, drive, microsoft, calendar, whatsapp, whatsappInsights, email, emailOrganizer, redes, automations, meet, meetingPrompt, pluginSave, mcp, invites, inviteSuggest } = services
  /** Reunião salva, renomeada ou com anotações novas: o `.md` dela no acervo do chat é reescrito. */
  const touched = (meetingId: string): void => void corpus.sync(meetingId).catch(() => undefined)
  /**
   * Contrato 23: "depois de cada reunião" só quando a reunião está completa. As reuniões salvas na gravação em curso
   * esperam o fim da sessão (transcrição, anotações, análises e `.md` gravados) e o resumo automático, pronto ou com
   * erro. O serviço das automações guarda cada par (tarefa, reunião): um "Tentar de novo" não roda de novo.
   */
  const endingMeetings = new Set<string>()
  const summaryRequests = new Map<string, Promise<unknown>>()
  onRecordingFinished = () => {
    for (const meetingId of [...endingMeetings]) {
      endingMeetings.delete(meetingId)
      void (async () => {
        await summaryRequests.get(meetingId)
        summaryRequests.delete(meetingId)
        await summary.settled(meetingId).catch(() => undefined)
        automations.meetingEnded(meetingId)
      })()
    }
  }
  /** Contrato 11: quando a reunião que acabou de ser gravada entra na fila do Drive. */
  const driveEnd = createEndOfRecordingHooks({ enqueue: (meetingId, kinds) => drive.enqueue(meetingId, kinds), filesPending: () => files.hasOpenSession() })
  handle('scribe:app-info', appOrigin, () => ({
    name: brandName,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }))
  // Só o smoke recebe o sinal gerado; o app normal sempre capta microfone e sistema de verdade.
  handle('scribe:capture-mode', appOrigin, () => (smoke ? 'synthetic' : 'real'))
  registerFunilIpc({ appOrigin, funil: services.funil, proposta: services.funilProposta, log: (message) => console.error(message) })
  registerTarefasIpc({ appOrigin, tarefas: services.tarefas, log: (message) => console.error(message) })
  handle('scribe:meetings-list', appOrigin, () => meetings.list())
  handle('scribe:meetings-get', appOrigin, (_event, { id }) => meetings.get(id))
  handle('scribe:meetings-create', appOrigin, async (_event, input) => {
    // Contrato 12 (CA9): a reunião da gravação em curso leva o evento da agenda, que o main decidiu ao começar.
    const meeting = await meetings.create(input, { calendar: recordingSessions.active() ? calendar.recordingCalendar() : null })
    touched(meeting.id)
    // Contrato 50: "Recentes" no menu do ícone.
    trayController?.refresh()
    return meeting
  })
  handle('scribe:meetings-rename', appOrigin, async (_event, { id, title }) => {
    const meeting = await meetings.rename(id, title)
    if (meeting) touched(meeting.id)
    trayController?.refresh()
    return meeting
  })
  // Excluir a reunião apaga também a transcrição, o resumo e as anotações internos dela; os arquivos da pasta ficam.
  handle('scribe:meetings-delete', appOrigin, async (_event, { id }) => {
    const deleted = await meetingsService.deleteMeeting(id)
    // Contrato 24: a conversa do WhatsApp ligada a ela sai junto.
    if (deleted) await whatsapp.removeMeeting(id).catch(() => undefined)
    // Contrato 113: a proposta de IA sai junto; `Oportunidade.meetingIds` fica (a linha do tempo mostra "Reunião apagada").
    if (deleted) await services.funilProposta.proposals.remove(id).catch(() => undefined)
    trayController?.refresh()
    return deleted
  })
  handle('scribe:meetings-overview', appOrigin, () => meetingsIndex.overview())
  handle('scribe:meetings-search', appOrigin, (_event, request) => meetingsIndex.search((request as { term?: unknown } | undefined)?.term))
  // Pastas (contrato 28): o nome é dado, cortado em 60 no store; payload fora do formato é recusado aqui.
  handle('scribe:folders-list', appOrigin, () => meetings.folders())
  handle('scribe:folders-create', appOrigin, (_event, request) => meetings.createFolder(folderCreateSchema.parse(request).name))
  handle('scribe:folders-rename', appOrigin, (_event, request) => {
    const { id, name } = folderRenameSchema.parse(request)
    return meetings.renameFolder(id, name)
  })
  handle('scribe:folders-delete', appOrigin, (_event, request) => meetings.deleteFolder(folderIdSchema.parse(request).id))
  handle('scribe:meetings-move', appOrigin, (_event, request) => {
    const { id, folderId } = meetingMoveSchema.parse(request)
    return meetings.move(id, folderId)
  })
  handle('scribe:settings-get', appOrigin, () => settings.getSettings())
  handle('scribe:settings-update', appOrigin, async (_event, patch) => {
    const next = await settings.updateSettings(patch)
    // Contrato 57: ligar, desligar ou mudar a regra de um conector do claude.ai fecha as sessões de chat abertas (a
    // próxima pergunta abre com o que vale agora), como a mudança de um servidor MCP.
    if (typeof patch === 'object' && patch !== null && 'claudeConnectors' in patch) {
      mcp.invalidateConnectors()
      chat.mcpChanged()
    }
    return next
  })
  handle('scribe:key-status', appOrigin, () => settings.keyStatus())
  handle('scribe:key-save', appOrigin, (_event, request) => settings.saveKey((request as { key?: unknown } | undefined)?.key))
  handle('scribe:key-verify', appOrigin, () => settings.verifyKey())
  handle('scribe:key-remove', appOrigin, () => settings.removeKey())
  handle('scribe:models-list', appOrigin, () => settings.listModels())
  handle('scribe:model-select', appOrigin, (_event, request) => settings.selectModel((request as { id?: unknown } | undefined)?.id))
  handle('scribe:mic-access', appOrigin, () => settings.micAccess())
  handle('scribe:mic-access-request', appOrigin, () => settings.requestMicAccess())
  handle('scribe:transcription-token', appOrigin, () => requestToken(tokenClient))
  handle('scribe:transcript-save', appOrigin, async (_event, { document }) => {
    await meetingsService.saveTranscript(document as TranscriptDocument)
    touched((document as TranscriptDocument).meetingId)
    // Contrato 11: sem pasta, a transcrição vai para o Drive montada na hora; com pasta, espera o `audio-finish`.
    driveEnd.transcriptSaved((document as TranscriptDocument).meetingId)
    // Contrato 23: a reunião da gravação em curso; as tarefas "depois de cada reunião" esperam ela terminar por inteiro.
    if (recordingSessions.active()) endingMeetings.add((document as TranscriptDocument).meetingId)
    return true
  })
  handle('scribe:transcript-get', appOrigin, (_event, { meetingId }) => meetingsService.getTranscript(meetingId))
  handle('scribe:transcript-copy', appOrigin, (_event, { meetingId }) => meetingsService.copyTranscript(meetingId))
  handle('scribe:notes-get', appOrigin, async (_event, request) => {
    const meetingId = (request as { meetingId?: unknown } | undefined)?.meetingId
    const list = await meetingsService.getNotes(meetingId)
    // Contrato 23: a tela já viu estes post-its dos agentes; dali em diante, apagar um deles vale.
    const pending = typeof meetingId === 'string' ? agentNotes.get(meetingId) : undefined
    if (pending) {
      for (const note of list) pending.delete(note.id)
      if (!pending.size) agentNotes.delete(meetingId as string)
    }
    return list
  })
  handle('scribe:notes-save', appOrigin, async (_event, request) => {
    const saved = await meetingsService.saveNotes(request)
    if (saved) touched((request as { meetingId: string }).meetingId)
    return saved
  })
  handle('scribe:notes-copy', appOrigin, (_event, request) => meetingsService.copyNotes((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:translate-turn', appOrigin, (_event, request) => translation.translate(request))
  handle('scribe:claude-locate', appOrigin, () => claude.locate())
  // Contrato 17: o agente só é baixado com o clique da pessoa (este canal).
  handle('scribe:acp-status', appOrigin, async () => (await acp.current()).status())
  handle('scribe:acp-install', appOrigin, async () => (await acp.current()).install())
  handle('scribe:acp-remove', appOrigin, async () => (await acp.current()).remove())
  handle('scribe:claude-path-set', appOrigin, (_event, request) => claude.setPath((request as { path?: unknown } | undefined)?.path))
  handle('scribe:claude-start', appOrigin, () => claude.start())
  handle('scribe:claude-translate', appOrigin, (_event, request) => claude.translate(request))
  handle('scribe:claude-stop', appOrigin, async () => {
    await claude.stop()
    return true
  })
  handle('scribe:audio-folder', appOrigin, () => files.folder())
  handle('scribe:audio-folder-choose', appOrigin, () => files.chooseFolder())
  handle('scribe:audio-begin', appOrigin, (_event, request) => files.begin(request))
  handle('scribe:audio-append', appOrigin, (_event, request) => files.append(request))
  handle('scribe:audio-finish', appOrigin, async (_event, request) => {
    const result = await files.finish(request)
    // Contrato 11: o áudio e o `.md` da pasta vão para o Drive, com o nome base de verdade.
    driveEnd.filesFinished((request as { meetingId: string }).meetingId)
    return result
  })
  handle('scribe:meeting-files', appOrigin, (_event, request) => files.info((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:meeting-file-open', appOrigin, (_event, request) => files.open(request))
  handle('scribe:meeting-file-reveal', appOrigin, (_event, request) => files.reveal(request))
  handle('scribe:meeting-file-download', appOrigin, (_event, request) => download(request))
  handle('scribe:summary-get', appOrigin, (_event, request) => summary.status((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:summary-generate', appOrigin, (_event, request) => {
    const work = summary.generate(request)
    // O resumo automático do fim da gravação: "depois de cada reunião" espera por ele.
    const asked = request as { meetingId?: unknown; auto?: unknown } | undefined
    if (asked?.auto === true && typeof asked.meetingId === 'string') summaryRequests.set(asked.meetingId, work.catch(() => undefined))
    return work
  })
  handle('scribe:summary-copy', appOrigin, (_event, request) => summary.copy((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:analysis-run', appOrigin, (_event, request) => analysis.run(request))
  handle('scribe:analyses-get', appOrigin, (_event, request) => analysis.list((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:analyses-save', appOrigin, (_event, request) => analysis.save(request))
  handle('scribe:analyses-add', appOrigin, (_event, request) => analysis.add(request))
  handle('scribe:analysis-copy', appOrigin, (_event, request) => analysis.copy(request))
  handle('scribe:ai-notes-run', appOrigin, (_event, request) => aiNotes.run(request))
  handle('scribe:ai-notes-cancel', appOrigin, (_event, request) => aiNotes.cancel((request as { recordingId?: unknown } | undefined)?.recordingId))
  handle('scribe:branding-get', appOrigin, () => branding.get())
  handle('scribe:brand-logo-choose', appOrigin, () => branding.chooseLogo())
  handle('scribe:brand-logo-reset', appOrigin, () => branding.resetLogo())
  handle('scribe:update-get', appOrigin, () => updates.state())
  handle('scribe:update-check', appOrigin, () => updates.check())
  handle('scribe:update-download', appOrigin, () => updates.download())
  handle('scribe:update-quit', appOrigin, () => updates.quit())
  handle('scribe:chat-list', appOrigin, (_event, request) => chat.list(request))
  handle('scribe:chat-get', appOrigin, (_event, request) => chat.get((request as { id?: unknown } | undefined)?.id))
  handle('scribe:chat-send', appOrigin, (_event, request) => chat.send(request))
  handle('scribe:chat-stop', appOrigin, (_event, request) => chat.stop((request as { id?: unknown } | undefined)?.id))
  handle('scribe:chat-delete', appOrigin, (_event, request) => chat.remove((request as { id?: unknown } | undefined)?.id))
  handle('scribe:chat-update', appOrigin, (_event, request) => chat.update(request))
  handle('scribe:chat-redo', appOrigin, (_event, request) => chat.redo(request))
  handle('scribe:chat-copy', appOrigin, (_event, request) => chat.copy(request))
  // Assistente (contrato 25): o cartão só grava o clique; o envio segue só por `scribe:whatsapp-send`.
  handle('scribe:chat-action-reminder', appOrigin, (_event, request) => chatActions.reminder(request))
  handle('scribe:chat-action-state', appOrigin, (_event, request) => chatActions.setState(request))
  // Contrato 78: o evento só é gravado aqui, no clique em "Pôr na agenda"; o lembrete só muda ou sai no clique do cartão.
  handle('scribe:chat-action-event', appOrigin, (_event, request) => chatActions.event(request).catch((): ChatActionResult => ({ ok: false, error: 'invalid' })))
  handle('scribe:chat-action-reminder-change', appOrigin, (_event, request) => chatActions.reminderChange(request).catch((): ChatActionResult => ({ ok: false, error: 'invalid' })))
  // Contrato 76: o rascunho do Instagram só entra na fila aqui, no clique em "Criar rascunho"; a janela do clique abre o editor.
  handle('scribe:chat-action-instagram-draft', appOrigin, (event, request) =>
    chatActions
      .instagramDraft(request, (target) => {
        if (!lockService?.isLocked()) sendTo(event.sender, 'scribe:open-redes', target)
      })
      .catch((): ChatActionResult => ({ ok: false, error: 'invalid' })),
  )
  // Contrato 117: o funil só muda aqui, no clique de um cartão do funil.
  handle('scribe:chat-action-funil', appOrigin, (_event, request) => chatActions.funil(request).catch((): ChatActionResult => ({ ok: false, error: 'invalid' })))
  // Contrato 21: o cartão de aprovação de uma ferramenta MCP e a aba "Conexões". Nenhum segredo volta por aqui.
  handle('scribe:chat-approval', appOrigin, (_event, request) => chat.answerApproval(request))
  handle('scribe:mcp-chat-servers', appOrigin, () => mcp.chatServers())
  handle('scribe:mcp-overview', appOrigin, (_event, request) => mcp.overview(request))
  handle('scribe:mcp-test', appOrigin, (_event, request) => mcp.test(request))
  // Mudou o que vale para o MCP: as sessões de chat abertas fecham e a próxima pergunta abre com o que vale agora.
  const mcpChanging = async <T>(change: Promise<T>): Promise<T> => {
    try {
      return await change
    } finally {
      // Contrato 57: a próxima sessão com conector espera uma lista nova do `claude mcp list`.
      mcp.invalidateConnectors()
      chat.mcpChanged()
    }
  }
  handle('scribe:mcp-save', appOrigin, (_event, request) => mcpChanging(mcp.save(request)))
  handle('scribe:mcp-update', appOrigin, (_event, request) => mcpChanging(mcp.update(request)))
  handle('scribe:mcp-remove', appOrigin, (_event, request) => mcpChanging(mcp.remove(request)))
  handle('scribe:mcp-details', appOrigin, (_event, request) => mcp.details(request))
  handle('scribe:mcp-connector-tools', appOrigin, (_event, request) => mcp.connectorTools(request))
  handle('scribe:mcp-import', appOrigin, (_event, request) => mcpChanging(mcp.importFound(request)))
  // Bloqueio (contrato 22): a senha só passa por aqui até o serviço, que confere com o hash.
  handle('scribe:lock-status', appOrigin, () => lock.status())
  handle('scribe:lock-now', appOrigin, () => lock.lock('button'))
  handle('scribe:lock-unlock', appOrigin, (_event, request) => lock.unlock((request as { password?: unknown } | undefined)?.password))
  handle('scribe:lock-touch-id', appOrigin, () => lock.unlockWithTouchId())
  handle('scribe:lock-password-set', appOrigin, (_event, request) => lock.setPassword(request))
  handle('scribe:lock-password-remove', appOrigin, (_event, request) => lock.removePassword(request))
  onEvent('scribe:lock-activity', appOrigin, () => lock.activity())
  // Conta Google e Drive (contrato 11): a chave secreta e os tokens nunca voltam por aqui.
  handle('scribe:google-status', appOrigin, () => google.status())
  handle('scribe:google-client-save', appOrigin, (_event, request) => google.saveClient(request))
  handle('scribe:google-sign-in', appOrigin, () => google.signIn())
  handle('scribe:google-sign-in-cancel', appOrigin, () => google.cancelSignIn())
  handle('scribe:google-sign-out', appOrigin, () => google.signOut())
  handle('scribe:google-calendar-grant', appOrigin, () => google.grantCalendar())
  // Conta Microsoft (contrato 12): só o ID do aplicativo; os tokens nunca voltam por aqui.
  handle('scribe:microsoft-status', appOrigin, () => microsoft.status())
  handle('scribe:microsoft-client-save', appOrigin, (_event, request) => microsoft.saveClient(request))
  handle('scribe:microsoft-sign-in', appOrigin, () => microsoft.signIn())
  handle('scribe:microsoft-sign-in-cancel', appOrigin, () => microsoft.cancelSignIn())
  handle('scribe:microsoft-sign-out', appOrigin, () => microsoft.signOut())
  // Agendas (contrato 12): o link da chamada nunca vai ao renderer; o main abre, só `https://`.
  handle('scribe:calendar-get', appOrigin, () => calendar.view())
  handle('scribe:calendar-list', appOrigin, () => calendar.calendars())
  handle('scribe:calendar-record', appOrigin, (_event, request) => calendar.pick((request as { key?: unknown } | undefined)?.key))
  handle('scribe:calendar-dismiss', appOrigin, (_event, request) => calendar.dismiss((request as { key?: unknown } | undefined)?.key))
  handle('scribe:calendar-join', appOrigin, (_event, request) => {
    const url = safeJoinUrl(calendar.joinUrl((request as { key?: unknown } | undefined)?.key))
    if (!url) return false
    openExternal(url)
    return true
  })
  handle('scribe:calendar-recording', appOrigin, () => {
    if (!recordingSessions.active()) return null
    // Contrato 48: começou pelo aviso, o título da reunião dele vence o da agenda; senão, o da agenda.
    const title = recordingTitleFor(meetingPrompt.recordingTitle(), calendar.recordingCalendar()?.title)
    return title ? { title } : null
  })
  handle('scribe:meet-status', appOrigin, () => meet.status())
  // Contrato 48: os dois canais do aviso de reunião; o controlador confere que quem pede é a janela do aviso.
  handle('scribe:meeting-prompt-state', appOrigin, (event) => meetingPrompt.state(event.sender))
  handle('scribe:meeting-prompt-act', appOrigin, (event, request) => meetingPrompt.act(event.sender, request))
  handle('scribe:plugin-save', appOrigin, (_event, request) => pluginSave(request))
  // Contrato 46: o estado da ponte do navegador e o "Ativar ponte" (grava a configuração; o servidor segue ela).
  handle('scribe:navegador-status', appOrigin, () => navegadorState())
  handle('scribe:navegador-set', appOrigin, async (_event, request) => {
    const ativo = parseNavegadorSet(request)
    if (ativo !== null) await settings.updateSettings({ navegadorPlugin: ativo })
    return navegadorState()
  })
  handle('scribe:drive-status', appOrigin, (_event, request) => drive.status((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:drive-retry', appOrigin, (_event, request) => drive.retry((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:drive-open', appOrigin, (_event, request) => {
    const url = drive.folderUrl((request as { meetingId?: unknown } | undefined)?.meetingId)
    if (!url?.startsWith(DRIVE_FOLDER_URL_PREFIX)) return false
    openExternal(url)
    return true
  })
  // WhatsApp (contrato 24): o envio só com o token de clique que o preload registrou nesta mesma janela.
  handle('scribe:whatsapp-status', appOrigin, () => whatsapp.status())
  handle('scribe:whatsapp-risk-accept', appOrigin, (_event, request) => whatsapp.acceptRisk(request))
  handle('scribe:whatsapp-install', appOrigin, () => whatsapp.install())
  handle('scribe:whatsapp-start', appOrigin, () => whatsapp.start())
  handle('scribe:whatsapp-stop', appOrigin, () => whatsapp.stop())
  handle('scribe:whatsapp-pair', appOrigin, (_event, request) => whatsapp.pair(request))
  handle('scribe:whatsapp-logout', appOrigin, () => whatsapp.logout())
  handle('scribe:whatsapp-remove', appOrigin, () => whatsapp.remove())
  handle('scribe:whatsapp-chats', appOrigin, () => whatsapp.chats().catch(() => []))
  // Contrato 40: abrir a conversa zera as não lidas dela; o número do Dock é relido.
  handle('scribe:whatsapp-messages', appOrigin, (_event, request) =>
    whatsapp
      .messages(request)
      .catch(() => [])
      .finally(refreshWhatsAppBadge),
  )
  handle('scribe:whatsapp-search', appOrigin, (_event, request) => whatsapp.search(request).catch(() => []))
  handle('scribe:whatsapp-send', appOrigin, (event, request) => whatsapp.send(event.sender.id, request))
  // Contrato 39: o anexo, pelo mesmo guarda do clique; o clipe só devolve o arquivo conferido para a prévia.
  handle('scribe:whatsapp-send-media', appOrigin, (event, request) => whatsapp.sendMedia(event.sender.id, request))
  // Contrato 34: a reação é envio (o token de clique desta janela, no mesmo guarda); o "digitando…" só com o interruptor.
  handle('scribe:whatsapp-react', appOrigin, (event, request) => whatsapp.react(event.sender.id, request))
  handle('scribe:whatsapp-typing', appOrigin, (_event, request) => whatsapp.typing(request).catch(() => false))
  handle('scribe:whatsapp-attach-pick', appOrigin, async () => {
    const path = await chooseWhatsAppAttachment()
    return path ? readAttachment(path).catch(() => ({ ok: false, error: 'type' }) as const) : null
  })
  handle('scribe:whatsapp-draft', appOrigin, (_event, request) => whatsapp.draft(request))
  handle('scribe:whatsapp-link-get', appOrigin, (_event, request) => whatsapp.link((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:whatsapp-link-set', appOrigin, (_event, request) => whatsapp.setLink(request))
  // Contrato 32: a foto de perfil e os Detalhes (só leitura; nenhum caminho daqui alcança o envio).
  handle('scribe:whatsapp-photo', appOrigin, (_event, request) => whatsapp.photo(request).catch(() => null))
  // Contrato 37: a mídia e a transcrição, só no clique; erro nunca derruba nada.
  handle('scribe:whatsapp-media', appOrigin, (_event, request) => whatsapp.media(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:whatsapp-transcribe', appOrigin, (_event, request) => whatsapp.transcribe(request).catch(() => ({ ok: false, error: 'failed' }) as const))
  handle('scribe:whatsapp-insights', appOrigin, (_event, request) => whatsappInsights.state(request))
  handle('scribe:whatsapp-insights-run', appOrigin, (_event, request) => whatsappInsights.run(request))
  onEvent('scribe:whatsapp-click', appOrigin, (event, token) => whatsapp.registerClick(event.sender.id, token))
  onEvent('scribe:whatsapp-pair-cancel', appOrigin, () => whatsapp.cancelPair())
  // Email (contrato 42): o serviço valida cada pedido; falha vira resposta tipada, nunca exceção para a tela.
  handle('scribe:email-accounts', appOrigin, () => email.accounts())
  handle('scribe:email-autoconfig', appOrigin, (_event, request) => email.autoconfig(request).catch(() => null))
  handle('scribe:email-add-account', appOrigin, (_event, request) => email.addAccount(request).catch(() => ({ ok: false, error: 'invalid' }) as const))
  handle('scribe:email-remove-account', appOrigin, (_event, request) => email.removeAccount(request).catch(() => false))
  handle('scribe:email-messages', appOrigin, (_event, request) => email.messages(request).catch(() => []))
  handle('scribe:email-get-body', appOrigin, (_event, request) => email.body(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-mark-read', appOrigin, (_event, request) => email.markRead(request).catch(() => false))
  handle('scribe:email-delete', appOrigin, (_event, request) => email.remove(request).catch(() => false))
  handle('scribe:email-send', appOrigin, (event, request) => email.send(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))
  handle('scribe:invite-reply', appOrigin, (event, request) => email.sendInviteReply(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))
  onEvent('scribe:email-click', appOrigin, (event, token) => email.registerClick(event.sender.id, token))
  // Redes (contrato 69): o serviço valida cada pedido; falha vira resposta tipada, nunca exceção para a tela.
  const redesFailed = { ok: false, error: 'Não foi possível falar com o Instagram' } as const
  handle('scribe:redes-state', appOrigin, () => redes.state())
  handle('scribe:redes-connect', appOrigin, (_event, request) => redes.connect(request).catch(() => redesFailed))
  handle('scribe:redes-refresh', appOrigin, (_event, request) => redes.refresh(request).catch(() => redesFailed))
  handle('scribe:redes-remove', appOrigin, (_event, request) => redes.remove(request).catch(() => ({ ok: false })))
  handle('scribe:redes-media-host-save', appOrigin, (_event, request) => redes.mediaHostSave(request).catch(() => ({ ok: false, error: 'Não foi possível salvar o armazenamento', status: redes.state().mediaHost }) as const))
  handle('scribe:redes-media-host-test', appOrigin, () => redes.mediaHostTest().catch(() => redes.state().mediaHost))
  handle('scribe:redes-media-host-clear', appOrigin, () => redes.mediaHostClear().catch(() => redes.state().mediaHost))
  // Contrato 71: as publicações. "Publicar agora" e "Agendar" só com o token de clique da mesma janela (`redes-click`).
  const publicationFailed = { ok: false, error: 'Não foi possível concluir a ação na publicação' } as const
  handle('scribe:redes-publications', appOrigin, (_event, request) => redes.publications(request).catch(() => ({ accountId: '', publications: [], quota: null })))
  handle('scribe:redes-media-pick', appOrigin, () => redes.pickMedia().catch(() => []))
  handle('scribe:redes-publication-save', appOrigin, (_event, request) => redes.savePublication(request).catch(() => ({ ok: false, problems: [publicationFailed.error] }) as const))
  handle('scribe:redes-publication-delete', appOrigin, (_event, request) => redes.deletePublication(request).catch(() => publicationFailed))
  handle('scribe:redes-publication-schedule', appOrigin, (event, request) => redes.schedulePublication(event.sender.id, request).catch(() => publicationFailed))
  handle('scribe:redes-publication-publish', appOrigin, (event, request) => redes.publishNow(event.sender.id, request).catch(() => publicationFailed))
  handle('scribe:redes-publication-unschedule', appOrigin, (_event, request) => redes.unschedule(request).catch(() => publicationFailed))
  handle('scribe:redes-publication-retry', appOrigin, (_event, request) => redes.retry(request).catch(() => publicationFailed))
  handle('scribe:redes-quota', appOrigin, (_event, request) => redes.quota(request).catch(() => ({ ok: false, error: 'Não foi possível ler a cota do Instagram' }) as const))
  handle('scribe:redes-media-thumb', appOrigin, (_event, request) => redes.thumbnail(request).catch(() => null))
  // 73: comentários
  const commentsFailed = (request: unknown): RedesCommentsPayload => ({ accountId: String((request as { accountId?: unknown } | null)?.accountId ?? ''), media: [], unread: 0, updatedAt: null, error: 'Não foi possível ler os comentários do Instagram' })
  const commentFailed = { ok: false, error: 'Não foi possível falar com o Instagram' } as const
  handle('scribe:redes-comments', appOrigin, (_event, request) => redes.commentsState(request).catch(() => commentsFailed(request)))
  handle('scribe:redes-comments-refresh', appOrigin, (_event, request) => redes.refreshComments(request).catch(() => commentsFailed(request)))
  handle('scribe:redes-comment-reply', appOrigin, (event, request) => redes.replyComment(event.sender.id, request).catch(() => commentFailed))
  handle('scribe:redes-comment-hide', appOrigin, (_event, request) => redes.hideComment(request).catch(() => commentFailed))
  handle('scribe:redes-comment-delete', appOrigin, (event, request) => redes.deleteComment(event.sender.id, request).catch(() => commentFailed))
  handle('scribe:redes-comments-read', appOrigin, (_event, request) => redes.markCommentsRead(request).catch(() => commentsFailed(request)))
  // fim 73
  // 75: métricas
  const metricsFailed = (request: unknown): RedesMetricsState => ({ accountId: String((request as { accountId?: unknown } | null)?.accountId ?? ''), account: { 7: null, 28: null, 90: null }, media: [], error: 'Não foi possível ler as métricas do Instagram', updatedAt: null })
  handle('scribe:redes-metrics', appOrigin, (_event, request) => redes.metricsState(request).catch(() => metricsFailed(request)))
  handle('scribe:redes-metrics-refresh', appOrigin, (_event, request) => redes.refreshMetrics(request).catch(() => metricsFailed(request)))
  // fim 75
  onEvent('scribe:redes-click', appOrigin, (event, token) => redes.registerClick(event.sender.id, token))
  // 74: mensagens
  // Contrato 74: as mensagens diretas. "Enviar" só com o token de clique da mesma janela (`redes-click`).
  handle('scribe:redes-messages', appOrigin, (_event, request) => redes.messagesState(request).catch(() => failedMessagesPayload(request)))
  handle('scribe:redes-messages-refresh', appOrigin, (_event, request) => redes.refreshMessages(request).catch(() => failedMessagesPayload(request)))
  handle('scribe:redes-message-send', appOrigin, (event, request) => redes.sendMessage(event.sender.id, request).catch(() => ({ ok: false, error: MESSAGE_SEND_FAILED_MESSAGE }) as const))
  handle('scribe:redes-conversation-read', appOrigin, (_event, request) => redes.markConversationRead(request).catch(() => failedMessagesPayload(request)))
  // fim 74
  // Contrato 62: o cartão do convite e o Calendário do Mac. O serviço valida cada pedido; falha vira resposta tipada.
  const inviteFailed = { ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed, state: null } as const
  handle('scribe:invite-state', appOrigin, (_event, request) => invites.state(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:invite-add', appOrigin, (_event, request) => invites.add(request).catch(() => inviteFailed))
  handle('scribe:invite-update', appOrigin, (_event, request) => invites.update(request).catch(() => inviteFailed))
  handle('scribe:invite-remove', appOrigin, (_event, request) => invites.remove(request).catch(() => inviteFailed))
  handle('scribe:invite-calendars', appOrigin, () => invites.calendars().catch(() => ({ ok: false, error: 'unavailable', reason: 'failed' }) as const))
  // Contrato 78: depois do pedido, o `ESTADO.md` do Assistente lê o acesso de novo.
  handle('scribe:invite-request-access', appOrigin, () =>
    invites
      .requestAccess()
      .catch(() => ({ ok: false, error: 'unavailable', reason: 'failed' }) as const)
      .finally(() => services.calendarReads.invalidate()),
  )
  handle('scribe:invite-open-ics', appOrigin, (_event, request) => invites.openIcs(request).catch(() => ({ ok: false, error: 'failed' }) as const))
  // Contrato 64: o "Sugerir evento" só com o token de clique próprio; gravar a sugestão é local e só no clique do cartão.
  handle('scribe:invite-suggest', appOrigin, (event, request) => inviteSuggest.suggest(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))
  handle('scribe:invite-suggest-add', appOrigin, (_event, request) => inviteSuggest.add(request).catch(() => ({ ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed }) as const))
  onEvent('scribe:invite-suggest-click', appOrigin, (event, token) => inviteSuggest.registerClick(event.sender.id, token))
  // Contrato 43: o teste da conta, o clipe do composer, as imagens remotas e a pasta aberta na tela.
  handle('scribe:email-test', appOrigin, (_event, request) => email.test(request).catch(() => ({ ok: false, stage: 'incoming', error: 'Erro ao falar com o servidor.' }) as const))
  handle('scribe:email-attach-pick', appOrigin, async () => {
    const paths = await chooseEmailAttachments()
    return paths.length ? readEmailAttachments(paths).catch(() => ({ ok: false, error: 'unreadable' }) as const) : null
  })
  handle('scribe:email-remote-images', appOrigin, (_event, request) => loadRemoteImages(request, fetchRemoteImage, remoteImageLookup).catch(() => ({})))
  // Contrato 43 (CA8): "Baixar" um anexo: o diálogo de salvar do macOS (que pergunta antes de trocar um arquivo que já
  // existe), começando em Downloads com o nome limpo. O arquivo só é gravado; nunca aberto.
  handle('scribe:email-attachment-save', appOrigin, async (_event, request) => {
    const found = await email.attachment(request).catch(() => ({ ok: false, error: 'unavailable' }) as const)
    if (!found.ok) return found
    const path = await chooseAttachmentSavePath(join(app.getPath('downloads'), found.name))
    if (!path) return null
    try {
      await writeFile(path, found.bytes)
      return { ok: true, name: basename(path) }
    } catch {
      return { ok: false, error: 'write' }
    }
  })
  // Contrato 43 (CA9): os anexos da original para o "Encaminhar".
  handle('scribe:email-attachments', appOrigin, (_event, request) => email.attachments(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  // Contrato 52: as pastas (listar, abrir, mover, criar, renomear, apagar). Nenhum canal daqui envia email.
  handle('scribe:email-folders', appOrigin, (_event, request) => email.folders(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-open-folder', appOrigin, (_event, request) => email.open(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-move', appOrigin, (_event, request) => email.move(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-folder-create', appOrigin, (_event, request) => email.folderCreate(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-folder-rename', appOrigin, (_event, request) => email.folderRename(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-folder-delete', appOrigin, (_event, request) => email.folderDelete(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  // Contrato 54: a assinatura da conta (quem a põe no texto é o rascunho da tela; o envio não muda). O pedido fora do
  // formato já volta `invalid` do serviço; exceção que sobra é do `settings.json`.
  handle('scribe:email-signature-get', appOrigin, (_event, request) => email.signatureGet(request).catch(() => ({ ok: false, error: 'storage' }) as const))
  handle('scribe:email-signature-set', appOrigin, (_event, request) => email.signatureSet(request).catch(() => ({ ok: false, error: 'storage' }) as const))
  // Contrato 53: as regras da conta e o "Executar agora" em dois passos (o segundo só com o token do primeiro). Nenhum
  // envia email; o Assistente não tem nada disto.
  handle('scribe:email-rules-get', appOrigin, (_event, request) => email.rulesGet(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-rules-set', appOrigin, (_event, request) => email.rulesSet(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-rules-preview', appOrigin, (_event, request) => email.rulesPreview(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  handle('scribe:email-rules-run', appOrigin, (_event, request) => email.rulesRun(request).catch(() => ({ ok: false, error: 'unavailable' }) as const))
  onEvent('scribe:email-folder-watch', appOrigin, (event, request) => email.watchFolder(event.sender.id, request))
  // Contrato 56: o lote do Assistente (o estado, o cartão e o Desfazer). Nenhum envia email; o Desfazer só devolve o que
  // o agente moveu, sem token de clique.
  handle('scribe:email-organize-state', appOrigin, () => emailOrganizer?.state().catch(() => ({ ok: false, error: 'unavailable' }) as const) ?? ({ ok: false, error: 'unavailable' } as const))
  handle('scribe:email-batch-get', appOrigin, (_event, request) => emailOrganizer?.batch(request).catch(() => ({ ok: false, error: 'unavailable' }) as const) ?? ({ ok: false, error: 'unavailable' } as const))
  handle('scribe:email-batch-undo', appOrigin, (_event, request) => emailOrganizer?.undo(request).catch(() => ({ ok: false, error: 'unavailable' }) as const) ?? ({ ok: false, error: 'unavailable' } as const))
  onEvent('scribe:email-viewing', appOrigin, (event, request) => {
    const viewing = request as { accountId?: unknown; folder?: unknown } | null | undefined
    const accountId = viewing?.accountId
    const folder = viewing?.folder
    emailViewing.set(event.sender.id, typeof accountId === 'string' && EMAIL_ACCOUNT_ID_PATTERN.test(accountId) && (folder === 'inbox' || folder === 'sent') ? { accountId, folder } : null)
  })
  // Contrato 40: a conversa aberta na tela desta janela (só um id válido, ou nenhum).
  onEvent('scribe:whatsapp-viewing', appOrigin, (event, request) => {
    const chatId = (request as { chatId?: unknown } | undefined)?.chatId
    whatsappViewing.set(event.sender.id, typeof chatId === 'string' && WHATSAPP_CHAT_ID_PATTERN.test(chatId) ? chatId : null)
  })
  // Gravação em curso: o token vale até o fim do "Encerrar" ou até a janela que a abriu sumir.
  handle('scribe:recording-session-open', appOrigin, (event) => {
    recordingStartedAt = Date.now()
    const token = recordingSessions.open(event.sender)
    // Contrato 12 (CA9): o evento da agenda desta gravação (o do "Gravar" ou o que está acontecendo).
    calendar.recordingStarted()
    // Contrato 48: o aviso de reunião fecha e o título dele (se a gravação veio do aviso) fica para esta gravação.
    meetingPrompt.recordingStarted()
    // Contrato 50: o tempo aparece ao lado do ícone e o menu ganha "Gravando".
    trayController?.refresh()
    return token
  })
  handle('scribe:recording-session-close', appOrigin, (_event, request) => recordingSessions.close((request as { token?: unknown } | undefined)?.token))
  // Automações (contrato 23): tudo recusado com o app bloqueado (`WHEN_LOCKED`); o agendador não depende daqui.
  handle('scribe:agents-list', appOrigin, () => automations.listAgents())
  handle('scribe:agents-save', appOrigin, (_event, request) => automations.saveAgent(request))
  handle('scribe:agents-delete', appOrigin, (_event, request) => automations.deleteAgent(request))
  handle('scribe:agents-test', appOrigin, (_event, request) => automations.testAgent(request))
  handle('scribe:tasks-list', appOrigin, () => automations.listTasks())
  handle('scribe:tasks-save', appOrigin, (_event, request) => automations.saveTask(request))
  handle('scribe:tasks-delete', appOrigin, (_event, request) => automations.deleteTask(request))
  handle('scribe:tasks-toggle', appOrigin, (_event, request) => automations.toggleTask(request))
  handle('scribe:tasks-run-now', appOrigin, (_event, request) => automations.runNow(request))
  handle('scribe:automations-ask', appOrigin, (_event, request) => automations.ask(request))
  handle('scribe:runs-list', appOrigin, (_event, request) => automations.listRuns(request))
  handle('scribe:runs-get', appOrigin, (_event, request) => automations.getRun(request))
  handle('scribe:runs-rerun', appOrigin, (_event, request) => automations.rerun(request))
  handle('scribe:automations-status', appOrigin, () => automations.status())
  handle('scribe:automations-pause', appOrigin, (_event, request) => automations.setPaused(request))
  onEvent('scribe:chat-close', appOrigin, (_event, request) => chat.close((request as { id?: unknown } | undefined)?.id))
  onEvent('scribe:chat-leave', appOrigin, (_event, request) => chat.leave((request as { id?: unknown } | undefined)?.id))
  // Só `https://`, e só depois da confirmação na tela; qualquer outra coisa é ignorada.
  onEvent('scribe:open-link', appOrigin, (_event, url) => {
    if (isHttpsUrl(url)) openExternal(url)
  })
  onEvent('scribe:csp-violation', appOrigin, (_event, report) => {
    console.warn(`[csp] ${report.directive} bloqueou ${report.blockedUri} (${report.sourceFile})`)
  })
  onEvent('scribe:open-privacy-settings', appOrigin, (_event, pane) => {
    const url = privacyPaneUrl(pane)
    if (url) openExternal(url)
  })
  onEvent('scribe:open-key-dashboard', appOrigin, () => openExternal(ASSEMBLYAI_DASHBOARD_URL))
}

/**
 * "Nova gravação" pelo menu. O clique no menu não chega ao renderer como gesto, e o
 * `getDisplayMedia` exige um; `executeJavaScript(..., true)` marca a ativação do usuário no frame
 * antes de pedir ao renderer que comece.
 */
async function startRecordingFromMenu(): Promise<void> {
  const fresh = mainWindow === null
  const win = mainWindow ?? openMainWindow()
  const contents = win.webContents
  if (fresh || contents.isLoading()) await new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()))
  await contents.executeJavaScript('true', true)
  sendTo(contents, 'scribe:new-recording', undefined)
  if (!smoke) win.show()
}

function installMenu(): void {
  const template = buildMenuTemplate({
    appName: PACKAGE_DISPLAY_NAME,
    isDev,
    onNavigate: (route) => {
      // Bloqueado, o menu não leva a lugar nenhum (o renderer também ignora).
      if (lockService?.isLocked()) return
      const win = mainWindow ?? openMainWindow()
      sendTo(win.webContents, 'scribe:navigate', route)
      if (!smoke) win.show()
    },
    onNewRecording: () => {
      if (lockService?.isLocked()) return
      startRecordingFromMenu().catch((error: unknown) => console.error('[menu] nova gravação:', error))
    },
    onLock: () => lockApp('menu'),
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Uma instância por `userData`: uma segunda (ex.: `open -n`) renomearia o `.part` da gravação em curso
// para "(incompleto)" ao abrir. Ela sai e a primeira vem para a frente.
if (!whatsappInstallTest && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const window = appWindows()[0]
  // Contrato 23: só no ícone da barra de menus (sem janela), abrir o app de novo traz a janela.
  if (!window) {
    if (app.isReady() && !smoke) showMainWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.focus()
})

void app.whenReady().then(async () => {
  if (whatsappInstallTest) {
    app.exit(await runInstallTest(bridgeSourceDir()))
    return
  }
  const ses = session.defaultSession
  applySessionSecurity(ses, appOrigin, isDev ? 'development' : 'production')
  registerDisplayMediaHandler(ses, appOrigin)
  if (!isDev) handleAppScheme(ses, rendererRoot)
  const userData = app.getPath('userData')
  const services = createAppServices(userData)
  chatService = services.chat
  lockService = services.lock
  // Antes da primeira janela: o IPC já recusa o conteúdo se o app abrir bloqueado (CA6).
  setLockGate(
    () => services.lock.isLocked(),
    () => recordingSessions.active(),
  )
  const lockAtLaunch = await services.lock.init()
  registerIpc(services)
  // Contrato 24: o WhatsApp sobe sozinho só se a pessoa o deixou ligado (e reencontra um serviço já rodando).
  void services.whatsapp.init().catch(() => undefined)
  // Contrato 42: as contas de email gravadas conectam (sem conta, nada acontece).
  void services.email.init().catch(() => undefined)
  // Contrato 69: as contas do Instagram gravadas; o token com 7 dias ou mais é renovado já e a cada 24 h.
  void services.redes.init().catch(() => undefined)
  // Contrato 27: o servidor da extensão do Meet, com "Quem fala no Meet" ligado (padrão).
  if ((await services.settings.getSettings()).meetSpeakers) void services.meet.start().catch(() => null)
  // Contrato 49: o observador do microfone, com "Avisar quando uma reunião começar" ligado (padrão).
  services.micWatch.apply((await services.settings.getSettings()).meetingPrompt)
  // Contrato 46: a ponte do navegador, só com "Ativar ponte" ligado (padrão desligado).
  applyNavegador((await services.settings.getSettings()).navegadorPlugin)
  // Marca gravada: título da primeira janela, "Sobre" e ícone do Dock antes de abrir.
  applyBrand(await services.settings.getSettings())
  // Fila do Drive deixada por uma execução anterior (contrato 11): continua sozinha, também bloqueado.
  services.drive.start()
  // `.part` deixado por um app fechado ou travado no meio da gravação vira "(incompleto)" (CA7).
  void services.files.recover().catch(() => undefined)
  // Acervo do chat: pastas temporárias de conversas de uma reunião que sobraram, e o acervo refeito se faltar.
  void services.corpus
    .clearScopes()
    .then(() => services.corpus.ensure())
    .catch(() => undefined)
  // Sair do app mata os processos do `claude` (tradução, resumo, análise e chat) que estiverem vivos: nenhum fica órfão.
  // ⌘Q no meio de uma gravação: mesma confirmação de fechar a janela.
  app.on('before-quit', (event) => {
    if (!recordingSessions.active()) return
    event.preventDefault()
    void confirmLeave(mainWindow)
  })
  app.on('will-quit', () => {
    services.calendar.dispose()
    services.automations.dispose()
    trayController?.dispose()
    services.claude.dispose()
    services.summary.dispose()
    services.funnel.dispose()
    services.analysis.dispose()
    services.aiNotes.dispose()
    services.whatsappInsights.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    void services.whatsapp.dispose()
    void services.email.dispose()
    services.redes.dispose()
    void services.meet.stop()
    void services.micWatch.dispose()
    // Contrato 62: os `.ics` temporários saem; o `lap-calendar` fecha.
    void services.invites.dispose()
    void services.macCalendar.dispose()
    void services.navegador.close()
    void services.navegadorMcp.close()
    disposeWhatsAppBadge()
  })
  installMenu()
  // Contrato 23: fechar a última janela deixa o app na barra de menus (sem Dock) ou sai; o ícone aparece já.
  const smokeAutomations = smokeFixtures?.automations
  windowLifecycle = createWindowLifecycle({
    dock: smokeAutomations
      ? { hide: () => void smokeAutomations.dock.hides++, show: () => void smokeAutomations.dock.shows++ }
      : process.platform === 'darwin'
        ? app.dock
        : undefined,
    quit: smokeAutomations ? () => void smokeAutomations.quitRequests++ : () => app.quit(),
    behavior: async () => (await services.settings.getSettings()).closeBehavior,
    // O macOS esconde ícones quando a barra de menus está cheia (atrás da câmera dos MacBooks). Aí o app fica
    // no Dock, senão a pessoa não teria como voltar a ele.
    trayVisible: () => trayController?.visible() ?? false,
    trayHidden: () => {
      if (trayHiddenNoticeShown || smokeAutomations) return
      trayHiddenNoticeShown = true
      new Notification({
        title: brandName,
        body: 'O app continua aberto no Dock. O macOS escondeu o ícone da barra de menus porque ela está cheia.',
      }).show()
    },
  })
  applyLoginItem((await services.settings.getSettings()).openAtLogin)
  installTray(services)
  applyLockStatus(lockAtLaunch)
  // Agendador (CA5): confere já (horários perdidos com o app fechado) e a cada 30 s.
  services.automations.start()
  // Falta de uso (CA2): conferida a cada 15 s; o uso chega do renderer por `scribe:lock-activity`.
  setInterval(() => void services.lock.tick().catch(() => undefined), LOCK_TICK_MS).unref()
  // Mac bloqueou a tela ou dormiu (CA2, padrão ligado). No smoke, os eventos vêm do substituto: o Mac de
  // verdade bloquear a tela no meio do smoke não pode bloquear o app.
  const power: { on(event: 'lock-screen' | 'suspend', listener: () => void): unknown } = smokeFixtures ? smokeFixtures.lock.power : powerMonitor
  // Mac acordou: o agendador confere de novo (CA5) e as agendas são relidas (contrato 12, CA4).
  const wake: { on(event: 'resume', listener: () => void): unknown } = smokeFixtures ? smokeFixtures.lock.power : powerMonitor
  wake.on('resume', () => {
    void services.automations.resume()
    void services.calendar.refresh()
    // Contrato 69: o token do Instagram que passou dos 7 dias com o Mac dormindo renova ao acordar.
    void services.redes.refreshDue().catch(() => undefined)
  })
  // Contrato 12: o cache das agendas, a primeira leitura (sem conta, nenhum pedido) e os relógios dos avisos.
  services.calendar.start()
  for (const event of ['lock-screen', 'suspend'] as const) {
    power.on(event, () => {
      void services.settings
        .getSettings()
        .then((current) => {
          if (current.lockOnSystemLock) lockApp('system')
        })
        .catch(() => undefined)
    })
  }

  if (smokeUserData && smokeFixtures) {
    const code = await runSmoke({
      appOrigin,
      userDataDir: smokeUserData,
      outDir: join(app.getAppPath(), 'out', 'smoke'),
      fixtures: smokeFixtures,
      whatsapp: services.whatsapp,
      openWindow: (query) => openMainWindow(query, true),
      automations: services.automations,
      tray: () => trayController,
      calendar: services.calendar,
      meet: services.meet,
      navegador: services.navegador,
      redes: services.redes,
    })
    // `app.exit` não passa por `will-quit`.
    services.calendar.dispose()
    services.automations.dispose()
    trayController?.dispose()
    services.claude.dispose()
    services.summary.dispose()
    services.funnel.dispose()
    services.analysis.dispose()
    services.aiNotes.dispose()
    services.whatsappInsights.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    await services.whatsapp.dispose()
    await services.email.dispose()
    services.redes.dispose()
    disposeWhatsAppBadge()
    await services.meet.stop()
    await services.micWatch.dispose()
    await services.invites.dispose()
    await services.macCalendar.dispose()
    await services.navegador.close()
    await services.navegadorMcp.close()
    app.exit(code)
    return
  }

  // "Abrir ao entrar no Mac" (CA9): aberto pelo login, o app fica só na barra de menus, sem janela nem Dock.
  const login = process.platform === 'darwin' ? app.getLoginItemSettings() : null
  if (login?.wasOpenedAtLogin) app.dock?.hide()
  else openMainWindow()
  // Primeira consulta 30 s depois de abrir e a cada 6 h. O smoke não agenda: só o botão consulta.
  services.updates.start()
  app.on('activate', () => {
    if (appWindows().length === 0) showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !smoke) app.quit()
})
