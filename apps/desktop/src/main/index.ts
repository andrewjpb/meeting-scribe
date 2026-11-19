// Processo principal: esquema do app, segurança da sessão, IPC, menu e janela.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, Notification, powerMonitor, safeStorage, session, shell, systemPreferences, Tray, type NativeImage, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { DRIVE_FOLDER_URL_PREFIX } from '../shared/accounts'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import { formatRunShort, type AutomationRun } from '../shared/automations'
import { brandTexts, DEFAULT_BRAND_NAME } from '../shared/branding'
import { calendarNoticeText, safeJoinUrl, type CalendarNotice } from '../shared/calendar'
import { lockedWindowTitle, type LockStatus } from '../shared/lock'
import type { NavegadorState } from '../shared/navegador'
import type { AppPluginId, PluginSaveResult } from '../shared/plugins'
import { privacyPaneUrl } from '../shared/privacy'
import type { RouteId } from '../shared/routes'
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
import { createChatActions, extractActions, type ChatActions } from './chat/actions'
import { createChatService, type ChatService } from './chat/service'
import { AUTOMATION_RUNS_IN_SOURCE, writeSources, type AssistantState } from './chat/sources'
import { createFileChatStore } from './chat/store'
import { createGoogleAccount, type GoogleAccountService } from './google/account'
import { createMicrosoftAccount, type MicrosoftAccountService } from './microsoft/account'
import { createCalendarService, type CalendarService } from './calendar/service'
import { createMeetServer, type MeetServer } from './meet/server'
import { createNavegadorMcpServer, type NavegadorMcpServer } from './navegador/mcp'
import { createNavegadorServer, parseNavegadorSet, type NavegadorServer } from './navegador/server'
import { createPluginSave } from './plugins/save'
import { createDriveSync, createEndOfRecordingHooks, type DriveSyncService } from './google/drive-sync'
import { nodeExecFile } from './claude-cli/locate'
import { createClaudeService, type ClaudeService } from './claude-cli/service'
import { nodeSpawnSummary } from './claude-cli/summary'
import { nodeSpawnClaude } from './claude-cli/translator'
import { broadcast, handle, onEvent, sendTo, setLockGate } from './ipc'
import { createRecordingSessions, leaveButtons, RECORDING_LEAVE_MESSAGE } from './lock/recording-session'
import { createLockService, type LockService, type TouchIdAccess } from './lock/service'
import { createFileLockStore } from './lock/store'
import { createFileAnalysesStore } from './meetings/analyses'
import { createAiNotesService, type AiNotesService } from './meetings/ai-notes-service'
import { createAnalysisService, type AnalysisService } from './meetings/analysis-service'
import { createMeetingsIndex, type MeetingsIndex } from './meetings/overview'
import { createFileNotesStore } from './meetings/notes'
import { createMeetingsService } from './meetings/service'
import { createFileMeetingsStore, folderCreateSchema, folderIdSchema, folderRenameSchema, meetingMoveSchema, type MeetingsStore } from './meetings/store'
import { createFileSummaryStore } from './meetings/summaries'
import { createSummaryService, type SummaryService } from './meetings/summary-service'
import { createFileTranscriptStore, type TranscriptStore } from './meetings/transcripts'
import { aboutPanelOptions, buildMenuTemplate, MENU_IDS } from './menu'
import { createMicPermissions } from './permissions'
import { handleAppScheme, registerAppScheme } from './protocol'
import { createSecretStore, memorySafeStorage } from './secrets'
import { APP_ORIGIN, applySessionSecurity, originOf } from './security'
import { createSettingsService, type SettingsService } from './settings/service'
import { createFileSettingsStore } from './settings/store'
import { isSmokeRun, prepareSmokeEnvironment, runSmoke, SMOKE_MEET_PORTS, SMOKE_NAVEGADOR_PORTS } from './smoke'
import { createSmokeAcp, createSmokeClaude, createSmokeFixtures, SMOKE_FAKE_KEY, type SmokeFixtures } from './smoke-fixtures'
import { acpOpener, processLauncher } from './acp/agent'
import { bundledAdapterEntry, bundledAgent, installedAgent, type AcpAgentService } from './acp/entry'
import { createAcpInstaller } from './acp/install'
import { agentProfile, type AgentProfile } from './acp/profiles'
import { applyOutput } from './schedules/outputs'
import { createAgentRunner } from './schedules/runner'
import { createAutomationsService, type AutomationNotice, type AutomationsService } from './schedules/service'
import { createFileRunsStore, createFileSchedulesStore } from './schedules/store'
import { createTrayController, createWindowLifecycle, type TrayController, type TrayIcon, type TrayLike } from './tray/menu'
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
  // Contrato 23: a gravação terminou de salvar (ou a janela que gravava sumiu).
  onRecordingFinished?.()
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
/** Contrato 40: as configurações, lidas na hora de notificar e de pôr o número no Dock. */
let readSettings: (() => Promise<AppSettings>) | null = null
/** Servidor local da extensão do Meet (contrato 27): sobe e para com "Quem fala no Meet". */
let meetServer: MeetServer | null = null
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
      broadcast(BrowserWindow.getAllWindows(), 'scribe:recording-end-and-quit', undefined)
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
  lastLockStatus = status
  trayController?.refresh()
  const title = windowTitle()
  for (const win of BrowserWindow.getAllWindows()) win.setTitle(title)
  const item = Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.lock)
  if (item) item.enabled = status.canLock && !status.locked
  broadcast(BrowserWindow.getAllWindows(), 'scribe:lock-state', status)
  // Contrato 24: bloqueado, nada do WhatsApp chega às janelas; ao desbloquear, o estado de agora.
  if (!status.locked && whatsappService) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-state', whatsappService.status())
  // Contrato 12: o mesmo para as próximas reuniões e a faixa da agenda.
  if (!status.locked && calendarService) broadcast(BrowserWindow.getAllWindows(), 'scribe:calendar-state', calendarService.view())
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
    whatsappViewing.delete(contentsId)
    if (mainWindow === win) mainWindow = null
    // No macOS o app segue aberto sem janela: as conversas do chat morrem em 5 min, como ao sair da tela.
    chatService?.leaveAll()
    // Contrato 23 (CA9): sem janela, o app fica só no ícone da barra de menus (sem Dock) ou sai, como a pessoa escolheu.
    if (!BrowserWindow.getAllWindows().some((other) => other !== win && !other.isDestroyed())) void windowLifecycle?.lastWindowClosed()
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
function sendWhenLoaded<C extends 'scribe:navigate' | 'scribe:open-run' | 'scribe:open-whatsapp'>(
  win: BrowserWindow,
  channel: C,
  payload: C extends 'scribe:navigate' ? RouteId : C extends 'scribe:open-run' ? { runId: string | null } : { chatId: string },
): void {
  const contents = win.webContents
  const send = (): void => sendTo(contents, channel, payload as never)
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
  const shown = locked ? { title: brandName, body: notice.reminder ? 'Você tem um lembrete.' : 'Uma tarefa agendada terminou.', runId: notice.runId } : notice
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
    else sendWhenLoaded(showMainWindow(), 'scribe:open-run', { runId: notice.runId })
  }
  item.on('click', open)
  item.on('action', open)
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

/** Ícone da barra de menus. No smoke, um substituto que registra as imagens; o `Tray` de verdade nunca é criado. */
function installTray(automations: AutomationsService): void {
  const fixtures = smokeFixtures
  const smokeTray = (image: unknown): TrayLike => {
    fixtures?.automations.trayImages.push(String(image))
    return {
      setImage: (next) => void fixtures?.automations.trayImages.push(String(next)),
      setToolTip: () => undefined,
      on: () => undefined,
      popUpContextMenu: () => undefined,
      destroy: () => undefined,
    }
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  trayController = createTrayController({
    create: (image) => (fixtures ? smokeTray(image) : new Tray(image as NativeImage)),
    image: (icon) => (fixtures ? icon : trayImage(icon)),
    buildMenu: (template) => (fixtures ? template : Menu.buildFromTemplate(template)),
    running: () => automations.snapshot().running.length > 0,
    state: () => {
      const status = automations.snapshot()
      return {
        brandName,
        locked: lockService?.isLocked() ?? false,
        canLock: lastLockStatus?.canLock ?? false,
        recording: recordingSessions.active() !== null && recordingStartedAt !== null ? { elapsedMs: Date.now() - recordingStartedAt } : null,
        paused: status.paused,
        next: status.next.slice(0, 3).map((task) => ({ name: task.name, when: formatRunShort(Date.parse(task.at), timeZone) })),
      }
    },
    handlers: {
      open: () => void showMainWindow(),
      newRecording: () => {
        if (lockService?.isLocked()) return
        windowLifecycle?.reopened()
        startRecordingFromMenu().catch((error: unknown) => console.error('[barra de menus] nova gravação:', error))
      },
      stopRecording: () => broadcast(BrowserWindow.getAllWindows(), 'scribe:recording-end', undefined),
      lock: () => lockApp('menu'),
      automations: () => {
        if (lockService?.isLocked()) return
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
  broadcast(BrowserWindow.getAllWindows(), 'scribe:navegador-changed', navegadorState())
}

/** Mudança de configuração vai para todas as janelas abertas; a marca vai para o título, o "Sobre" e o Dock. */
function broadcastSettings(settings: AppSettings): void {
  broadcast(BrowserWindow.getAllWindows(), 'scribe:settings-changed', settings)
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
    applyBrandName({ setAboutPanelOptions: (options) => app.setAboutPanelOptions(options), windows: BrowserWindow.getAllWindows(), version: app.getVersion() }, name)
    // Bloqueado, o título segue com "— bloqueado".
    if (lockService?.isLocked()) for (const win of BrowserWindow.getAllWindows()) win.setTitle(windowTitle())
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
  /** Agentes, tarefas agendadas e execuções (contrato 23). */
  automations: AutomationsService
  /** Servidor local da extensão do Meet (contrato 27). */
  meet: MeetServer
  /** "Salvar plugin…" da aba Plugins (contrato 31). */
  pluginSave: (input: unknown) => Promise<PluginSaveResult>
  /** Ponte do "Controle do navegador" (contrato 46). */
  navegador: NavegadorServer
  /** Servidor MCP das ferramentas do navegador do Assistente (contrato 47). */
  navegadorMcp: NavegadorMcpServer
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
      broadcast(BrowserWindow.getAllWindows(), 'scribe:google-state', status)
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
      broadcast(BrowserWindow.getAllWindows(), 'scribe:microsoft-state', status)
      calendarService?.accountsChanged()
    },
  })
  const drive = createDriveSync({
    dir: userData,
    account: google,
    enabled: async () => (await settings.get()).saveToDrive,
    files: { meetings, transcripts, summaries, notes, analyses },
    fetch: googleFetch,
    onStatus: (meetingId, status) => broadcast(BrowserWindow.getAllWindows(), 'scribe:drive-state', { meetingId, status }),
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
              onStatus: (status) => broadcast(BrowserWindow.getAllWindows(), 'scribe:acp-state', status),
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
  // Contrato 47: o servidor MCP local com as ferramentas do navegador, para a sessão do Assistente que abre com a ponte
  // ligada e a extensão conectada. Sobe na primeira dessas sessões; cada uma tem o próprio token.
  const navegadorMcp = createNavegadorMcpServer({ ponte: () => navegadorServer, ...devLog })
  const openAcp = acpOpener({
    navegadorMcp,
    profile: currentProfile,
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
    onState: (state) => broadcast(BrowserWindow.getAllWindows(), 'scribe:claude-state', state),
    // Custo nominal e trocas de processo só nos logs de desenvolvimento.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
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
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-state', status)
      refreshWhatsAppBadge()
    },
    // Contrato 40: a notificação sai também com o app bloqueado (sem o texto); o número do Dock é relido.
    onMessage: (message, chatName) => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-message', { message, chatName })
      notifyWhatsApp(message, chatName).catch((error: unknown) => console.error('[whatsapp] notificação:', error))
      refreshWhatsAppBadge()
    },
    onChatsChanged: () => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-chats-changed', undefined)
      refreshWhatsAppBadge()
    },
    // Contrato 34: as reações e o "digitando…" dos outros, só com o app desbloqueado; o seu "digitando…" só com o
    // interruptor ligado (lido a cada vez).
    onReactions: (update) => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-reactions', update)
    },
    onPresence: (presence) => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-presence', presence)
    },
    typingEnabled: async () => (await settings.get()).whatsappTypingSignal,
    // Só estados, nunca texto de mensagem.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  whatsappService = whatsapp
  // Contrato 32: os Detalhes da conversa (resumo, humor, pendências) pelo mesmo motor, numa execução curta sem
  // ferramenta nenhuma. Só lê as mensagens; o resultado fica em `whatsapp/insights.json`.
  const whatsappInsights = createInsightsService({
    settings,
    cache: createInsightsCache(join(userData, WHATSAPP_DIR, INSIGHTS_FILE)),
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
  const assistantState = async (): Promise<AssistantState> => {
    const [status, agents, tasks] = await Promise.all([automations.status(), automations.listAgents(), automations.listTasks()])
    const account = google.status()
    return {
      now: Date.now(),
      timeZone: timeZone(),
      version: app.getVersion(),
      recording: recordingSessions.active() && recordingStartedAt !== null ? { startedAt: recordingStartedAt } : null,
      google: account.state === 'signed-in' && account.profile ? `conectada como ${account.profile.email}` : account.state === 'expired' ? 'sessão expirada (entrar de novo em Configurações › Contas)' : 'não conectada',
      whatsapp: whatsappStateLabel(whatsapp.status()),
      automationsPaused: status.paused ? (status.pauseReason === 'limit' ? 'pausadas pelo limite diário' : 'pausadas pela pessoa') : null,
      agents: agents.agents,
      tasks,
    }
  }
  const assistantSources = {
    state: assistantState,
    guide: () => readFile(guidePath, 'utf8'),
    automations: async () => {
      const [agents, tasks, items] = await Promise.all([automations.listAgents(), automations.listTasks(), automations.listRuns({})])
      const runs = await Promise.all(items.slice(0, AUTOMATION_RUNS_IN_SOURCE).map((item) => automations.getRun({ id: item.id })))
      return { agents: agents.agents, tasks, runs: runs.filter((run): run is AutomationRun => run !== null) }
    },
    whatsapp: { exportRecent: (folder: string) => whatsapp.exportRecent(folder), exportChats: (folder: string, chatIds: readonly string[], days: number) => whatsapp.exportChats(folder, chatIds, days) },
    ...devLog,
  }
  const actionResolver = {
    whatsappChat: async (chatId: string) => {
      // A lista que a pergunta acabou de ler (uma chamada só ao serviço).
      const found = (await whatsapp.knownChats().catch(() => [])).find((item) => item.id === chatId)
      return found ? { name: found.name, kind: found.kind, ...(found.phone ? { phone: found.phone } : {}) } : null
    },
    agents: async () => (await automations.listAgents()).agents,
    meeting: async (meetingId: string) => meetings.get(meetingId),
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
    },
    settings,
    meetings,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawn ?? nodeSpawnClaude,
    openAcp,
    // Contrato 47: a ponte do navegador conectada agora (a sessão do Assistente abre com as ferramentas dela).
    navegador: { connected: () => navegadorServer?.connected() ?? false },
    baseEnv: process.env,
    onEvent: (event) => broadcast(BrowserWindow.getAllWindows(), 'scribe:chat-event', event),
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
      }
      broadcast(BrowserWindow.getAllWindows(), 'scribe:summary-state', { meetingId, status })
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
    onChange: (meetingId) => broadcast(BrowserWindow.getAllWindows(), 'scribe:analyses-changed', { meetingId }),
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
    onState: (state) => broadcast(BrowserWindow.getAllWindows(), 'scribe:update-state', state),
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
  // da pasta); as saídas ficam neste Mac. O WhatsApp não entra aqui: nenhum agente alcança o envio. No smoke, o
  // relógio do agendador é o que o smoke adianta.
  const smokeAutomations = smokeFixtures?.automations
  const automations = createAutomationsService({
    agents: createFileAgentsStore({ dir: userData }),
    schedules: createFileSchedulesStore({ dir: userData }),
    runs: createFileRunsStore({ dir: userData }),
    runner: createAgentRunner({ locate: () => claude.locate(), openAcp, corpus, meetings, emptyDir: join(userData, 'automations-empty'), ...devLog }),
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
            if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:notes-changed', { meetingId })
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
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:automations-changed', status)
    },
    // Bloqueado, nada da resposta vai às janelas; a execução continua e fica no histórico.
    onEvent: (event) => {
      if (event.type === 'done') trayController?.refresh()
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:automation-event', event)
    },
    ...(smokeAutomations ? { now: () => Date.now() + smokeAutomations.skewMs } : {}),
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
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:calendar-state', view)
    },
    ...devLog,
  })
  calendarService = calendar
  // Contrato 27: a extensão do Meet manda nomes e eventos de fala. Vai às janelas também com o app bloqueado: a
  // gravação continua no bloqueio e o renderer carimba cada evento quando ele chega. Nada volta à extensão.
  const meet = createMeetServer({
    // Smoke: portas fora da faixa da extensão, para o Chrome de verdade nunca falar com ele.
    ...(smoke ? { ports: SMOKE_MEET_PORTS } : {}),
    onChange: (state) => broadcast(BrowserWindow.getAllWindows(), 'scribe:meet-changed', state),
    ...devLog,
  })
  meetServer = meet
  // Contrato 46: a ponte do "Controle do navegador". Conectar e desconectar vai às janelas; os comandos só saem do
  // main (neste contrato, nenhum consumidor ainda).
  const navegador = createNavegadorServer({
    // Smoke: portas fora da faixa da extensão, como no Meet.
    ...(smoke ? { ports: SMOKE_NAVEGADOR_PORTS } : {}),
    onChange: () => broadcast(BrowserWindow.getAllWindows(), 'scribe:navegador-changed', navegadorState()),
    ...devLog,
  })
  navegadorServer = navegador
  // Contrato 25: o clique nos cartões do Assistente. O lembrete é a tarefa "uma vez" sem agente das Automações.
  const chatActions = createChatActions({ store: chatStore, createReminder: (input) => automations.createReminder(input), timeZone })
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
    automations,
    meet,
    pluginSave,
    navegador,
    navegadorMcp,
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
  const { settings, meetings, meetingsService, meetingsIndex, tokenClient, translation, claude, files, summary, analysis, aiNotes, download, branding, updates, chat, chatActions, corpus, acp, lock, google, drive, microsoft, calendar, whatsapp, whatsappInsights, automations, meet, pluginSave } = services
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
  handle('scribe:meetings-list', appOrigin, () => meetings.list())
  handle('scribe:meetings-get', appOrigin, (_event, { id }) => meetings.get(id))
  handle('scribe:meetings-create', appOrigin, async (_event, input) => {
    // Contrato 12 (CA9): a reunião da gravação em curso leva o evento da agenda, que o main decidiu ao começar.
    const meeting = await meetings.create(input, { calendar: recordingSessions.active() ? calendar.recordingCalendar() : null })
    touched(meeting.id)
    return meeting
  })
  handle('scribe:meetings-rename', appOrigin, async (_event, { id, title }) => {
    const meeting = await meetings.rename(id, title)
    if (meeting) touched(meeting.id)
    return meeting
  })
  // Excluir a reunião apaga também a transcrição, o resumo e as anotações internos dela; os arquivos da pasta ficam.
  handle('scribe:meetings-delete', appOrigin, async (_event, { id }) => {
    const deleted = await meetingsService.deleteMeeting(id)
    // Contrato 24: a conversa do WhatsApp ligada a ela sai junto.
    if (deleted) await whatsapp.removeMeeting(id).catch(() => undefined)
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
  handle('scribe:settings-update', appOrigin, (_event, patch) => settings.updateSettings(patch))
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
    const event = recordingSessions.active() ? calendar.recordingCalendar() : null
    return event?.title ? { title: event.title } : null
  })
  handle('scribe:meet-status', appOrigin, () => meet.status())
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
  const window = BrowserWindow.getAllWindows()[0]
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
  // Contrato 27: o servidor da extensão do Meet, com "Quem fala no Meet" ligado (padrão).
  if ((await services.settings.getSettings()).meetSpeakers) void services.meet.start().catch(() => null)
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
    services.analysis.dispose()
    services.aiNotes.dispose()
    services.whatsappInsights.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    void services.whatsapp.dispose()
    void services.meet.stop()
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
  installTray(services.automations)
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
    })
    // `app.exit` não passa por `will-quit`.
    services.calendar.dispose()
    services.automations.dispose()
    trayController?.dispose()
    services.claude.dispose()
    services.summary.dispose()
    services.analysis.dispose()
    services.aiNotes.dispose()
    services.whatsappInsights.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    await services.whatsapp.dispose()
    disposeWhatsAppBadge()
    await services.meet.stop()
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
    if (BrowserWindow.getAllWindows().length === 0) showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !smoke) app.quit()
})
