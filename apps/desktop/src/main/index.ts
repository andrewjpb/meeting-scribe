// Processo principal: esquema do app, segurança da sessão, IPC, menu e janela.
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, safeStorage, session, shell, systemPreferences, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import { brandTexts, DEFAULT_BRAND_NAME } from '../shared/branding'
import { privacyPaneUrl } from '../shared/privacy'
import type { AppSettings } from '../shared/settings-defaults'
import type { TranscriptDocument } from '../shared/transcription'
import { createGatewayClient, type FetchInit, type FetchResponse } from './assemblyai/gateway'
import { createTokenClient, requestToken } from './assemblyai/token'
import { createTranslationService } from './assemblyai/translation'
import { createMeetingDownload, type SaveDialog } from './audio-files/download'
import { createMeetingFilesService, type FileOpener, type FolderDialog, type MeetingFilesService } from './audio-files/service'
import { writeSummaryFile } from './audio-files/summary-file'
import { applyBrandName, applyDockIcon, type DockIconTarget } from './branding/apply'
import { createBrandingService, type BrandingService, type ImageDialog } from './branding/service'
import { registerDisplayMediaHandler } from './capture/display-media'
import { nodeExecFile } from './claude-cli/locate'
import { createClaudeService, type ClaudeService } from './claude-cli/service'
import { nodeSpawnSummary } from './claude-cli/summary'
import { nodeSpawnClaude } from './claude-cli/translator'
import { broadcast, handle, onEvent, sendTo } from './ipc'
import { createMeetingsService } from './meetings/service'
import { createFileMeetingsStore, type MeetingsStore } from './meetings/store'
import { createFileSummaryStore } from './meetings/summaries'
import { createSummaryService, type SummaryService } from './meetings/summary-service'
import { createFileTranscriptStore, type TranscriptStore } from './meetings/transcripts'
import { aboutPanelOptions, buildMenuTemplate } from './menu'
import { createMicPermissions } from './permissions'
import { handleAppScheme, registerAppScheme } from './protocol'
import { createSecretStore, memorySafeStorage } from './secrets'
import { APP_ORIGIN, applySessionSecurity, originOf } from './security'
import { createSettingsService, type SettingsService } from './settings/service'
import { createFileSettingsStore } from './settings/store'
import { isSmokeRun, prepareSmokeEnvironment, runSmoke } from './smoke'
import { createSmokeClaude, createSmokeFixtures, SMOKE_FAKE_KEY, type SmokeFixtures } from './smoke-fixtures'
import { createMainWindow } from './window'

// `app.setName` fixa o `userData` (~/Library/Application Support/Meeting Scribe) e o item do Chaveiro:
// trocar este nome perderia reuniões, configurações e a chave. O nome que a pessoa vê é o da marca
// escolhida em Configurações (contrato 09, padrão "LAP Reuniões"); o menu do app fica com o nome do pacote.
const APP_NAME = 'Meeting Scribe'
const PACKAGE_DISPLAY_NAME = DEFAULT_BRAND_NAME
const smoke = isSmokeRun(process.argv)

// O smoke troca o userData por uma pasta temporária; precisa acontecer antes de `ready`.
const smokeUserData = smoke ? prepareSmokeEnvironment(process.argv) : null
// Smoke: catálogo e respostas do gateway de fixtures, Chaveiro e permissão de microfone substitutos.
const smokeFixtures: SmokeFixtures | null = smoke ? createSmokeFixtures() : null

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
/** Nome da marca em uso (título da janela, "Sobre", `scribe:app-info`). */
let brandName = DEFAULT_BRAND_NAME
/** Último logo aplicado ao Dock; `undefined` antes da primeira vez. */
let dockLogo: string | null | undefined

function openMainWindow(query?: Record<string, string>, invisible = false): BrowserWindow {
  const win = createMainWindow({ url: appUrl, appOrigin, title: brandName, ...(query ? { query } : {}), invisible })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
  return win
}

/** Mudança de configuração vai para todas as janelas abertas; a marca vai para o título, o "Sobre" e o Dock. */
function broadcastSettings(settings: AppSettings): void {
  broadcast(BrowserWindow.getAllWindows(), 'scribe:settings-changed', settings)
  applyBrand(settings)
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
  tokenClient: ReturnType<typeof createTokenClient>
  translation: ReturnType<typeof createTranslationService>
  claude: ClaudeService
  files: MeetingFilesService
  summary: SummaryService
  download: ReturnType<typeof createMeetingDownload>
  branding: BrandingService
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
  // No smoke a área de transferência fica só na memória: o clipboard do Mac não é tocado.
  const appClipboard = smokeFixtures ? { writeText: (text: string): void => void smokeFixtures.copiedTexts.push(text) } : clipboard
  // Tradução pelo `claude` local. No smoke, só o binário falso (test/fixtures/fake-claude.mjs): o
  // `claude` de verdade nunca roda, nem pelo shell de login.
  const smokeClaude = smokeFixtures ? createSmokeClaude(join(app.getAppPath(), 'test', 'fixtures', 'fake-claude.mjs'), smokeFixtures) : null
  const claude = createClaudeService({
    settings,
    userData,
    home: app.getPath('home'),
    baseEnv: process.env,
    exec: smokeClaude?.exec ?? nodeExecFile,
    spawn: smokeClaude?.spawn ?? nodeSpawnClaude,
    ...(smokeClaude ? { candidates: smokeClaude.candidates, loginShell: false } : {}),
    onState: (state) => broadcast(BrowserWindow.getAllWindows(), 'scribe:claude-state', state),
    // Custo nominal e trocas de processo só nos logs de desenvolvimento.
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Resumo da reunião (contrato 08): o mesmo `claude` e o mesmo caminho configurado, numa execução curta.
  const summary = createSummaryService({
    settings,
    meetings,
    transcripts,
    summaries,
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    userData,
    baseEnv: process.env,
    clipboard: appClipboard,
    writeToFolder: (meeting, result) => writeSummaryFile(meeting, result, true),
    onStatus: (meetingId, status) => broadcast(BrowserWindow.getAllWindows(), 'scribe:summary-state', { meetingId, status }),
    ...(app.isPackaged ? {} : { log: (message: string) => console.log(message) }),
  })
  // Excluir a reunião apaga a transcrição e o resumo internos; os arquivos da pasta ficam.
  const meetingsService = createMeetingsService({ meetings, transcripts, summaries: summary, clipboard: appClipboard })
  // Arquivos da reunião (contrato 07). No smoke, a "pasta pessoal" fica dentro do userData temporário
  // (nada vai para ~/Documents), o diálogo responde o que o smoke mandar e nada abre no Finder.
  const home = smokeUserData ? join(smokeUserData, 'home') : app.getPath('home')
  const files = createMeetingFilesService({
    settings,
    meetings,
    transcripts,
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
  return {
    settings: createSettingsService({ settings, secrets, gateway, mic }),
    meetings,
    transcripts,
    meetingsService,
    tokenClient: createTokenClient({ fetch: fetchImpl, getApiKey: () => secrets.getApiKey() }),
    translation: createTranslationService(gateway),
    claude,
    files,
    summary,
    download,
    branding,
  }
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

function openExternal(url: string): void {
  if (smokeFixtures) smokeFixtures.openedUrls.push(url)
  else void shell.openExternal(url)
}

function registerIpc(services: AppServices): void {
  const { settings, meetings, meetingsService, tokenClient, translation, claude, files, summary, download, branding } = services
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
  handle('scribe:meetings-create', appOrigin, (_event, input) => meetings.create(input))
  handle('scribe:meetings-rename', appOrigin, (_event, { id, title }) => meetings.rename(id, title))
  // Excluir a reunião apaga também a transcrição e o resumo internos dela; os arquivos da pasta ficam.
  handle('scribe:meetings-delete', appOrigin, (_event, { id }) => meetingsService.deleteMeeting(id))
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
    return true
  })
  handle('scribe:transcript-get', appOrigin, (_event, { meetingId }) => meetingsService.getTranscript(meetingId))
  handle('scribe:transcript-copy', appOrigin, (_event, { meetingId }) => meetingsService.copyTranscript(meetingId))
  handle('scribe:translate-turn', appOrigin, (_event, request) => translation.translate(request))
  handle('scribe:claude-locate', appOrigin, () => claude.locate())
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
  handle('scribe:audio-finish', appOrigin, (_event, request) => files.finish(request))
  handle('scribe:meeting-files', appOrigin, (_event, request) => files.info((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:meeting-file-open', appOrigin, (_event, request) => files.open(request))
  handle('scribe:meeting-file-reveal', appOrigin, (_event, request) => files.reveal(request))
  handle('scribe:meeting-file-download', appOrigin, (_event, request) => download(request))
  handle('scribe:summary-get', appOrigin, (_event, request) => summary.status((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:summary-generate', appOrigin, (_event, request) => summary.generate(request))
  handle('scribe:summary-copy', appOrigin, (_event, request) => summary.copy((request as { meetingId?: unknown } | undefined)?.meetingId))
  handle('scribe:branding-get', appOrigin, () => branding.get())
  handle('scribe:brand-logo-choose', appOrigin, () => branding.chooseLogo())
  handle('scribe:brand-logo-reset', appOrigin, () => branding.resetLogo())
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
      const win = mainWindow ?? openMainWindow()
      sendTo(win.webContents, 'scribe:navigate', route)
      if (!smoke) win.show()
    },
    onNewRecording: () => {
      startRecordingFromMenu().catch((error: unknown) => console.error('[menu] nova gravação:', error))
    },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Uma instância por `userData`: uma segunda (ex.: `open -n`) renomearia o `.part` da gravação em curso
// para "(incompleto)" ao abrir. Ela sai e a primeira vem para a frente.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

void app.whenReady().then(async () => {
  const ses = session.defaultSession
  applySessionSecurity(ses, appOrigin, isDev ? 'development' : 'production')
  registerDisplayMediaHandler(ses, appOrigin)
  if (!isDev) handleAppScheme(ses, rendererRoot)
  const userData = app.getPath('userData')
  const services = createAppServices(userData)
  registerIpc(services)
  // Marca gravada: título da primeira janela, "Sobre" e ícone do Dock antes de abrir.
  applyBrand(await services.settings.getSettings())
  // `.part` deixado por um app fechado ou travado no meio da gravação vira "(incompleto)" (CA7).
  void services.files.recover().catch(() => undefined)
  // Sair do app mata os processos do `claude` (tradução e resumo) que estiverem vivos: nenhum fica órfão.
  app.on('will-quit', () => {
    services.claude.dispose()
    services.summary.dispose()
  })
  installMenu()

  if (smokeUserData && smokeFixtures) {
    const code = await runSmoke({
      appOrigin,
      userDataDir: smokeUserData,
      outDir: join(app.getAppPath(), 'out', 'smoke'),
      fixtures: smokeFixtures,
      openWindow: (query) => openMainWindow(query, true),
    })
    // `app.exit` não passa por `will-quit`.
    services.claude.dispose()
    services.summary.dispose()
    app.exit(code)
    return
  }

  openMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !smoke) app.quit()
})
