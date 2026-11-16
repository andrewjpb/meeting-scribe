// Processo principal: esquema do app, segurança da sessão, IPC, menu e janela.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, powerMonitor, safeStorage, session, shell, systemPreferences, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { DRIVE_FOLDER_URL_PREFIX } from '../shared/accounts'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import { brandTexts, DEFAULT_BRAND_NAME } from '../shared/branding'
import { lockedWindowTitle, type LockStatus } from '../shared/lock'
import { privacyPaneUrl } from '../shared/privacy'
import type { AgentProfileId, AppSettings } from '../shared/settings-defaults'
import type { TranscriptDocument } from '../shared/transcription'
import { isBrowserUrl } from './accounts/oauth'
import { netHttp } from './accounts/transport'
import { createGatewayClient, type FetchInit, type FetchResponse } from './assemblyai/gateway'
import { createTokenClient, requestToken } from './assemblyai/token'
import { createTranslationService } from './assemblyai/translation'
import { createMeetingDownload, type SaveDialog } from './audio-files/download'
import { createMeetingFilesService, type FileOpener, type FolderDialog, type MeetingFilesService } from './audio-files/service'
import { writeSummaryFile } from './audio-files/summary-file'
import { applyBrandName, applyDockIcon, type DockIconTarget } from './branding/apply'
import { createBrandingService, type BrandingService, type ImageDialog } from './branding/service'
import { registerDisplayMediaHandler } from './capture/display-media'
import { createChatCorpus, type ChatCorpus } from './chat/corpus'
import { createChatService, type ChatService } from './chat/service'
import { createFileChatStore } from './chat/store'
import { createGoogleAccount, type GoogleAccountService } from './google/account'
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
import { createAnalysisService, type AnalysisService } from './meetings/analysis-service'
import { createMeetingsIndex, type MeetingsIndex } from './meetings/overview'
import { createFileNotesStore } from './meetings/notes'
import { createMeetingsService } from './meetings/service'
import { createFileMeetingsStore, type MeetingsStore } from './meetings/store'
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
import { isSmokeRun, prepareSmokeEnvironment, runSmoke } from './smoke'
import { createSmokeAcp, createSmokeClaude, createSmokeFixtures, SMOKE_FAKE_KEY, type SmokeFixtures } from './smoke-fixtures'
import { acpOpener, processLauncher } from './acp/agent'
import { bundledAdapterEntry, bundledAgent, installedAgent, type AcpAgentService } from './acp/entry'
import { createAcpInstaller } from './acp/install'
import { agentProfile, type AgentProfile } from './acp/profiles'
import { createUpdateService, type UpdateService } from './updates/service'
import { netDownload, netDownloadTarball, netFetch } from './updates/transport'
import { createMainWindow } from './window'
import { runClaudeOneShot } from './meetings/claude-one-shot'
import { ACP_DRAFT_DIR, DRAFT_TIMEOUT_MS, draftSystemPrompt, parseDraft } from './whatsapp/draft'
import { BRIDGE_FAKE_FILE, BRIDGE_FILES, nodeExec, PYTHON_CANDIDATES, WHATSAPP_DIR } from './whatsapp/install'
import { INSTALL_TEST_ENV, runInstallTest } from './whatsapp/install-test'
import { createWhatsAppService, sendDialogText, type SendQuestion, type WhatsAppService } from './whatsapp/service'

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
/** Chat "Perguntar" (contrato 15), para a janela fechada avisar as conversas abertas. */
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
  if (!quitAfterRecording) return
  quitAfterRecording = false
  app.quit()
})
/** Um diálogo de "gravação em andamento" por vez. */
let leaveAsked = false
/** Envio ao Google Drive (contrato 11), para "Guardar no Google Drive" desligado esvaziar a fila. */
let driveService: DriveSyncService | null = null
/** WhatsApp (contrato 24): ao desbloquear, o estado volta às janelas; janela fechada esquece os cliques dela. */
let whatsappService: WhatsAppService | null = null

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
  const title = windowTitle()
  for (const win of BrowserWindow.getAllWindows()) win.setTitle(title)
  const item = Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.lock)
  if (item) item.enabled = status.canLock && !status.locked
  broadcast(BrowserWindow.getAllWindows(), 'scribe:lock-state', status)
  // Contrato 24: bloqueado, nada do WhatsApp chega às janelas; ao desbloquear, o estado de agora.
  if (!status.locked && whatsappService) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-state', whatsappService.status())
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
    if (mainWindow === win) mainWindow = null
    // No macOS o app segue aberto sem janela: as conversas do chat morrem em 5 min, como ao sair da tela.
    chatService?.leaveAll()
  })
  mainWindow = win
  return win
}

/** Mudança de configuração vai para todas as janelas abertas; a marca vai para o título, o "Sobre" e o Dock. */
function broadcastSettings(settings: AppSettings): void {
  broadcast(BrowserWindow.getAllWindows(), 'scribe:settings-changed', settings)
  applyBrand(settings)
  // "Usar Touch ID" muda o que o botão "Bloquear" pode.
  void lockService?.refresh().catch(() => undefined)
  // "Guardar no Google Drive" desligado: a fila esvazia; ligado, ela volta a andar.
  if (settings.saveToDrive) driveService?.start()
  else driveService?.clear()
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
  download: ReturnType<typeof createMeetingDownload>
  branding: BrandingService
  updates: UpdateService
  /** Chat "Perguntar" (contrato 15) e o acervo em Markdown que o `claude` dele lê. */
  chat: ChatService
  /** Agente do ACP do perfil escolhido (contrato 17): instalar, remover e o estado. */
  acp: { current: () => Promise<AcpAgentService> }
  corpus: ChatCorpus
  /** Bloqueio do app (contrato 22): senha, Touch ID, espera e estado. */
  lock: LockService
  /** Conta Google e envio ao Drive (contrato 11). */
  google: GoogleAccountService
  drive: DriveSyncService
  /** WhatsApp pessoal pelo serviço local (contrato 24). */
  whatsapp: WhatsAppService
}

/**
 * Arquivos do serviço do WhatsApp (contrato 24): o empacotado leva em `resources/whatsapp-bridge` dentro do
 * `app.asar` (pack.sh; o app copia para o `userData` antes do `pip` e do Python); em desenvolvimento e no smoke, os
 * do repositório.
 */
function bridgeSourceDir(): string {
  return app.isPackaged ? join(app.getAppPath(), 'resources', 'whatsapp-bridge') : join(app.getAppPath(), '..', '..', 'services', 'whatsapp-bridge')
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
  const mic = createMicPermissions(smokeFixtures ? smokeFixtures.media : process.platform === 'darwin' ? systemPreferences : null)
  const settings = createFileSettingsStore({ dir: userData, onChange: broadcastSettings })
  const meetings = createFileMeetingsStore({ dir: userData })
  const transcripts = createFileTranscriptStore({ dir: userData })
  const summaries = createFileSummaryStore({ dir: userData })
  // Anotações em cards (contrato 13), ao lado da transcrição e do resumo.
  const notes = createFileNotesStore({ dir: userData })
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
    onStatus: (status) => broadcast(BrowserWindow.getAllWindows(), 'scribe:google-state', status),
    onSignedIn: (email) => drive.signedIn(email),
    onSignedOut: () => drive.clear(),
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
  const openAcp = acpOpener({
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
    meeting: async (meetingId) => {
      const meeting = await meetings.get(meetingId)
      return meeting ? { meeting, summary: await summaries.get(meetingId).catch(() => null) } : null
    },
    // Bloqueado (contrato 22), nada do WhatsApp vai às janelas; o serviço segue conectado.
    onStatus: (status) => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-state', status)
    },
    onMessage: (message, chatName) => {
      if (!lockService?.isLocked()) broadcast(BrowserWindow.getAllWindows(), 'scribe:whatsapp-message', { message, chatName })
    },
    // Só estados, nunca texto de mensagem.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  whatsappService = whatsapp
  // Acervo do chat (contrato 15): um `.md` por reunião e o índice, reescritos a cada mudança da reunião.
  const corpus = createChatCorpus({ dir: userData, meetings, transcripts, summaries, notes })
  // Chat "Perguntar": o mesmo `claude` e o mesmo caminho configurado, um processo por conversa, só leitura.
  const chat = createChatService({
    store: createFileChatStore({ dir: userData }),
    corpus,
    // Contrato 24: só a exportação das conversas para a pasta de escopo; o envio não chega aqui.
    whatsapp: { exportChats: (folder, chatIds, days) => whatsapp.exportChats(folder, chatIds, days) },
    settings,
    meetings,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawn ?? nodeSpawnClaude,
    openAcp,
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
    download,
    branding,
    updates,
    chat,
    corpus,
    acp: acpAgent,
    lock,
    google,
    drive,
    whatsapp,
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

/**
 * Contrato 24: "Enviar para <nome>?" com o texto (até 300 caracteres), num diálogo nativo do macOS aberto pelo main,
 * em todo envio. "Cancelar" é o padrão. No smoke, o substituto responde e o diálogo fica registrado.
 */
async function confirmWhatsAppSend(win: BrowserWindow | null, question: SendQuestion): Promise<boolean> {
  const { message, detail } = sendDialogText(question)
  const buttons = ['Cancelar', 'Enviar']
  if (smokeFixtures) {
    smokeFixtures.whatsappSendDialogs.push({ message, detail, buttons })
    return smokeFixtures.whatsappSendChoice === 1
  }
  const options = { type: 'question' as const, message, detail, buttons, defaultId: 0, cancelId: 0, noLink: true }
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response === 1
}

function registerIpc(services: AppServices): void {
  const { settings, meetings, meetingsService, meetingsIndex, tokenClient, translation, claude, files, summary, analysis, download, branding, updates, chat, corpus, acp, lock, google, drive, whatsapp } = services
  /** Reunião salva, renomeada ou com anotações novas: o `.md` dela no acervo do chat é reescrito. */
  const touched = (meetingId: string): void => void corpus.sync(meetingId).catch(() => undefined)
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
    const meeting = await meetings.create(input)
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
    return true
  })
  handle('scribe:transcript-get', appOrigin, (_event, { meetingId }) => meetingsService.getTranscript(meetingId))
  handle('scribe:transcript-copy', appOrigin, (_event, { meetingId }) => meetingsService.copyTranscript(meetingId))
  handle('scribe:notes-get', appOrigin, (_event, request) => meetingsService.getNotes((request as { meetingId?: unknown } | undefined)?.meetingId))
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
  handle('scribe:summary-generate', appOrigin, (_event, request) => summary.generate(request))
  handle('scribe:summary-copy', appOrigin, (_event, request) => summary.copy((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:analysis-run', appOrigin, (_event, request) => analysis.run(request))
  handle('scribe:analyses-get', appOrigin, (_event, request) => analysis.list((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:analyses-save', appOrigin, (_event, request) => analysis.save(request))
  handle('scribe:analyses-add', appOrigin, (_event, request) => analysis.add(request))
  handle('scribe:analysis-copy', appOrigin, (_event, request) => analysis.copy(request))
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
  handle('scribe:whatsapp-messages', appOrigin, (_event, request) => whatsapp.messages(request).catch(() => []))
  handle('scribe:whatsapp-search', appOrigin, (_event, request) => whatsapp.search(request).catch(() => []))
  handle('scribe:whatsapp-send', appOrigin, (event, request) => whatsapp.send(event.sender.id, request, (question) => confirmWhatsAppSend(BrowserWindow.fromWebContents(event.sender), question)))
  handle('scribe:whatsapp-draft', appOrigin, (_event, request) => whatsapp.draft(request))
  handle('scribe:whatsapp-link-get', appOrigin, (_event, request) => whatsapp.link((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:whatsapp-link-set', appOrigin, (_event, request) => whatsapp.setLink(request))
  onEvent('scribe:whatsapp-click', appOrigin, (event, token) => whatsapp.registerClick(event.sender.id, token))
  onEvent('scribe:whatsapp-pair-cancel', appOrigin, () => whatsapp.cancelPair())
  // Gravação em curso: o token vale até o fim do "Encerrar" ou até a janela que a abriu sumir.
  handle('scribe:recording-session-open', appOrigin, (event) => recordingSessions.open(event.sender))
  handle('scribe:recording-session-close', appOrigin, (_event, request) => recordingSessions.close((request as { token?: unknown } | undefined)?.token))
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
  if (!window) return
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
    services.claude.dispose()
    services.summary.dispose()
    services.analysis.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    void services.whatsapp.dispose()
  })
  installMenu()
  applyLockStatus(lockAtLaunch)
  // Falta de uso (CA2): conferida a cada 15 s; o uso chega do renderer por `scribe:lock-activity`.
  setInterval(() => void services.lock.tick().catch(() => undefined), LOCK_TICK_MS).unref()
  // Mac bloqueou a tela ou dormiu (CA2, padrão ligado). No smoke, os eventos vêm do substituto: o Mac de
  // verdade bloquear a tela no meio do smoke não pode bloquear o app.
  const power: { on(event: 'lock-screen' | 'suspend', listener: () => void): unknown } = smokeFixtures ? smokeFixtures.lock.power : powerMonitor
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
    })
    // `app.exit` não passa por `will-quit`.
    services.claude.dispose()
    services.summary.dispose()
    services.analysis.dispose()
    services.chat.dispose()
    services.updates.dispose()
    services.drive.dispose()
    await services.whatsapp.dispose()
    app.exit(code)
    return
  }

  openMainWindow()
  // Primeira consulta 30 s depois de abrir e a cada 6 h. O smoke não agenda: só o botão consulta.
  services.updates.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !smoke) app.quit()
})
