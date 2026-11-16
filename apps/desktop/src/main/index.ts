// Processo principal: esquema do app, segurança da sessão, IPC, menu e janela.
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, Menu, nativeImage, net, safeStorage, session, shell, systemPreferences, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import { brandTexts, DEFAULT_BRAND_NAME } from '../shared/branding'
import { privacyPaneUrl } from '../shared/privacy'
import type { AgentProfileId, AppSettings } from '../shared/settings-defaults'
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
import { createChatCorpus, type ChatCorpus } from './chat/corpus'
import { createChatService, type ChatService } from './chat/service'
import { createFileChatStore } from './chat/store'
import { nodeExecFile } from './claude-cli/locate'
import { createClaudeService, type ClaudeService } from './claude-cli/service'
import { nodeSpawnSummary } from './claude-cli/summary'
import { nodeSpawnClaude } from './claude-cli/translator'
import { broadcast, handle, onEvent, sendTo } from './ipc'
import { createFileAnalysesStore } from './meetings/analyses'
import { createAnalysisService, type AnalysisService } from './meetings/analysis-service'
import { createMeetingsIndex, type MeetingsIndex } from './meetings/overview'
import { createFileNotesStore } from './meetings/notes'
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
import { createSmokeAcp, createSmokeClaude, createSmokeFixtures, SMOKE_FAKE_KEY, type SmokeFixtures } from './smoke-fixtures'
import { acpOpener, processLauncher } from './acp/agent'
import { bundledAdapterEntry, bundledAgent, installedAgent, type AcpAgentService } from './acp/entry'
import { createAcpInstaller } from './acp/install'
import { agentProfile, type AgentProfile } from './acp/profiles'
import { createUpdateService, type UpdateService } from './updates/service'
import { netDownload, netDownloadTarball, netFetch } from './updates/transport'
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
const smokeFixtures: SmokeFixtures | null = smoke ? createSmokeFixtures(app.getVersion()) : null

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

function openMainWindow(query?: Record<string, string>, invisible = false): BrowserWindow {
  const win = createMainWindow({ url: appUrl, appOrigin, title: brandName, ...(query ? { query } : {}), invisible })
  win.on('closed', () => {
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
  // Acervo do chat (contrato 15): um `.md` por reunião e o índice, reescritos a cada mudança da reunião.
  const corpus = createChatCorpus({ dir: userData, meetings, transcripts, summaries, notes })
  // Chat "Perguntar": o mesmo `claude` e o mesmo caminho configurado, um processo por conversa, só leitura.
  const chat = createChatService({
    store: createFileChatStore({ dir: userData }),
    corpus,
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
    locate: () => claude.locate(),
    spawn: smokeClaude?.spawnSummary ?? nodeSpawnSummary,
    openAcp,
    acpAvailable: async () => (await acpAgent.current()).available(),
    userData,
    baseEnv: process.env,
    clipboard: appClipboard,
    writeToFolder: (meeting, result, meetingAnalyses) => writeSummaryFile(meeting, result, true, meetingAnalyses),
    onStatus: (meetingId, status) => {
      // Resumo novo entra no acervo do chat.
      if (status.state === 'ready') void corpus.sync(meetingId).catch(() => undefined)
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
  const meetingsIndex = createMeetingsIndex({ dir: userData, meetings, transcripts, summaries, notes, activity: (id) => summary.activity(id) })
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
  const { settings, meetings, meetingsService, meetingsIndex, tokenClient, translation, claude, files, summary, analysis, download, branding, updates, chat, corpus, acp } = services
  /** Reunião salva, renomeada ou com anotações novas: o `.md` dela no acervo do chat é reescrito. */
  const touched = (meetingId: string): void => void corpus.sync(meetingId).catch(() => undefined)
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
  handle('scribe:meetings-delete', appOrigin, (_event, { id }) => meetingsService.deleteMeeting(id))
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
  handle('scribe:audio-finish', appOrigin, (_event, request) => files.finish(request))
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
  chatService = services.chat
  registerIpc(services)
  // Marca gravada: título da primeira janela, "Sobre" e ícone do Dock antes de abrir.
  applyBrand(await services.settings.getSettings())
  // `.part` deixado por um app fechado ou travado no meio da gravação vira "(incompleto)" (CA7).
  void services.files.recover().catch(() => undefined)
  // Acervo do chat: pastas temporárias de conversas de uma reunião que sobraram, e o acervo refeito se faltar.
  void services.corpus
    .clearScopes()
    .then(() => services.corpus.ensure())
    .catch(() => undefined)
  // Sair do app mata os processos do `claude` (tradução, resumo, análise e chat) que estiverem vivos: nenhum fica órfão.
  app.on('will-quit', () => {
    services.claude.dispose()
    services.summary.dispose()
    services.analysis.dispose()
    services.chat.dispose()
    services.updates.dispose()
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
    services.analysis.dispose()
    services.chat.dispose()
    services.updates.dispose()
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
