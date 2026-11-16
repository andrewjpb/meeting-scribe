// Smoke do build de produção: abre cada tela nos dois temas, grava PNG e `out/smoke/report.json`
// e confere segurança, origem, OPFS, AudioWorklet, navegação, gravação, marca, troca de tema e
// movimento reduzido, Configurações (chave, modelo, áudio, idiomas, tema) e o bloco de permissões. A
// janela nunca aparece: transparente, sem clique, sem foco e com o app fora do Dock; `userData` numa pasta
// temporária apagada no fim. A gravação usa o sinal gerado (o main responde `synthetic` ao renderer só
// no smoke): nenhum microfone nem áudio do sistema é aberto. A AssemblyAI e o macOS ficam de fora:
// gateway de fixtures, Chaveiro em memória com chave fictícia e permissão de microfone substituta. O
// Claude CLI é o binário falso (test/fixtures/fake-claude.mjs); o `claude` de verdade nunca roda, nem
// para o resumo da reunião (contrato 08). A marca própria (contrato 09) usa o logo de
// test/fixtures/brand/ pelo diálogo substituto, e o Dock de verdade nunca é tocado. A atualização pelo
// GitHub (contrato 14) usa API e download falsos; o `.dmg` falso vai para o userData temporário. A lista
// de reuniões (contrato 10) é conferida com seis reuniões semeadas, duas com resumo, e uma busca. As
// anotações (contrato 13) são criadas no painel da gravação e conferidas no arquivo, no `.md`, na aba
// "Anotações" do detalhe e na lista. O chat "Perguntar" (contrato 15) usa o `claude` falso em modo chat: o
// acervo das fixtures é refeito, uma pergunta responde em pedaços, o link `meeting:` abre o detalhe, "Parar"
// mata o processo e a aba "Perguntar" do detalhe roda numa pasta só com o `.md` da reunião. O "Perguntar"
// v2 (contrato 16) confere a linha "Pensando…"/"Abrindo «…»", o bloco "Raciocínio e passos", o rodapé, o
// painel "Contexto" com a troca de escopo (e a pasta do processo), a troca de modelo, "Refazer", renomear e
// ↑ para editar a última pergunta.
//
// Contrato 17: todo o smoke acima roda com a "Conexão com o Claude" em "Linha de comando" (a reserva, que
// não muda). No fim do tema claro, a conexão vai para o agente e o agente ACP falso
// (test/fixtures/fake-acp-agent.mjs) responde no lugar do adaptador: uma pergunta com raciocínio, plano,
// passos com estado, permissões concedidas e negadas, a leitura fora da pasta recusada e o rodapé; "Parar"
// (`session/cancel`, a sessão segue viva); troca de modelo e "Pensar mais" na mesma sessão; uma gravação
// traduzida (com a latência medida) e um resumo pelo agente; e o adaptador que não sobe, com o botão "Usar
// a linha de comando". O `claude` de verdade nunca roda.
//
// Contrato 19: no meio da gravação da fixture, "Analisar até agora" (o `claude` falso espera 1,5 s antes de
// responder) com a captura, o cronômetro e uma tradução seguindo enquanto ele gera; a aba "Análise" com as
// quatro seções, "Virar anotação", "Copiar", o tempo que rola a transcrição e uma segunda análise que risca o
// item respondido da anterior; "Encerrar" salva `analyses.json`; a seção "Perguntas em aberto" no detalhe, no
// `.md` da pasta e no "Copiar resumo", e "Analisar a reunião inteira".
//
// Contrato 22: no fim, o bloqueio do app numa janela à parte (`lockChecks`): senha criada em Configurações, a
// camada fosca pelo botão, por ⌘⇧L, pelo menu e pelo "Mac bloqueou a tela" (`powerMonitor` substituto),
// todo canal de conteúdo recusado, a espera depois de 5 erros (relógio do bloqueio adiantado), o Touch ID
// substituto e uma gravação que continua com o app bloqueado. O Touch ID de verdade nunca é pedido.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app, ipcMain, Menu, nativeTheme, session, type BrowserWindow, type MenuItem, type WebContents } from 'electron'
import { ASSEMBLYAI_DASHBOARD_URL } from '../shared/assemblyai'
import { INVOKE_CHANNELS, WHEN_LOCKED, type CspViolation } from '../shared/ipc'
import { LOCK_DISABLED_HINT, LOCKED_ERROR, lockedWindowTitle, TOUCH_ID_FAILED_TEXT } from '../shared/lock'
import { analyzedUntil, type MeetingAnalysesFile, type MeetingAnalysis } from '../shared/meeting-analysis'
import { notesMarkdown, type MeetingNote, type MeetingNotesFile } from '../shared/meeting-notes'
import type { Meeting } from '../shared/meetings'
import { summaryMarkdown, type MeetingSummary } from '../shared/meeting-summary'
import { summaryPreview } from '../shared/meetings-overview'
import { PRIVACY_PANE_URLS } from '../shared/privacy'
import { SETTINGS_TABS, type SettingsTab } from '../shared/routes'
import { matchesRow, settingsIndex } from '../shared/settings-index'
import { BRAND_LOGO_INVALID_MESSAGE, BRAND_LOGO_PATTERN, DEFAULT_BRAND_NAME, DEFAULT_BRAND_SUBTITLE } from '../shared/branding'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings-defaults'
import { transcriptMarkdown } from '../shared/transcript-markdown'
import { REPOSITORY_URL, UPDATE_HASH_MISMATCH_MESSAGE, UPDATE_INSTALL_INSTRUCTION, UPDATE_QUIT_BLOCKED_MESSAGE, updateAssetName } from '../shared/updates'
import { TRANSCRIPT_VERSION, type RuntimeSegment, type TranscriptDocument } from '../shared/transcription'
import { applyMessage, emptyTranscriptState, persistableSegments, type StreamEnvelope } from '../renderer/src/transcription/reducer'
import { DEFAULT_FOLDER_NAME } from './audio-files/service'
import { SUMMARY_FILE_SUFFIX, summaryFileTarget } from './audio-files/summary-file'
import { BRANDING_DIR } from './branding/service'
import { summaryInput, summaryLines } from './claude-cli/summary'
import { MENU_IDS } from './menu'
import { CHAT_CORPUS_DIR, CHAT_INDEX_FILE, CHAT_SCOPE_DIR, corpusFileSuffix } from './chat/corpus'
import { CHATS_DIR } from './chat/store'
import { RECORDING_LEAVE_MESSAGE } from './lock/recording-session'
import { createLockService } from './lock/service'
import { createFileLockStore, LOCK_FILE } from './lock/store'
import { SUMMARY_SUFFIX } from './meetings/summaries'
import { createFileSettingsStore, SETTINGS_FILE } from './settings/store'
import { CHAT_ALLOWED_TOOLS, CHAT_DISALLOWED_TOOLS } from './claude-cli/chat'
import { MEETINGS_FILE } from './meetings/store'
import { originOf } from './security'
import { SETTINGS_VERSION } from './settings/schema'
import { CLAUDE_DISALLOWED_TOOLS, CLAUDE_READ_TOOLS } from './acp/profiles/claude'
import { LATEST_RELEASE_URL, RELEASE_DOWNLOAD_PREFIX, RELEASE_REDIRECT_HOSTS } from './updates/release'
import {
  SMOKE_FAKE_KEY,
  SMOKE_NOT_ALLOWED_MODEL,
  SMOKE_OFFLINE_KEY,
  SMOKE_OFFLINE_MODEL,
  SMOKE_REFUSED_KEY,
  type SmokeFixtures,
} from './smoke-fixtures'

// Contrato 22: o bloqueio, no fim, soma uns 25 s ao roteiro.
const TIMEOUT_MS = 240_000
const THEMES = ['light', 'dark'] as const
/** Telas fotografadas em cada tema, na ordem do roteiro de `runSmoke`. */
const SCREENS = [
  'reunioes',
  'gravacao',
  'gravacao-ao-vivo',
  'gravacao-anotacoes',
  'reunioes-com-dados',
  'reunioes-lista',
  'detalhe',
  'detalhe-resumo',
  'detalhe-anotacoes',
  'perguntar',
  'perguntar-v2',
  // Contrato 18: Configurações por aba ("Geral" abre com a "Marca").
  'configuracoes-geral',
  'configuracoes-gravacao',
  'configuracoes-seletor',
  'configuracoes-claude',
  'configuracoes-arquivos',
] as const
/** Tempo de gravação até a fita encher a largura da janela (uma coluna a cada 50 ms). */
const TAPE_FILL_MS = 12_500
const MIN_TAPE_FPS = 30

export interface SmokeContext {
  appOrigin: string
  userDataDir: string
  outDir: string
  /** Gateway, Chaveiro e permissão de microfone substitutos (`smoke-fixtures.ts`). */
  fixtures: SmokeFixtures
  openWindow: (query: Record<string, string>) => BrowserWindow
}

interface Check {
  ok: boolean
  detail: string
}

interface Screenshot {
  name: string
  file: string
  /** Tamanho em pontos (px lógicos), o que o critério de 1120×740 mede. */
  width: number
  height: number
  devicePixelRatio: number
  pixelWidth: number
  pixelHeight: number
  distinctColors: number
}

export function isSmokeRun(argv: readonly string[]): boolean {
  return argv.includes('--smoke')
}

/**
 * Antes de `ready`: `userData` temporário, sem ícone no Dock e sem roubar o foco. A pasta vem de
 * `scripts/smoke.mjs` (que a apaga depois que o Electron sai); sem ele, cria uma aqui.
 */
export function prepareSmokeEnvironment(argv: readonly string[]): string {
  const given = argv.find((arg) => arg.startsWith('--smoke-user-data='))?.slice('--smoke-user-data='.length)
  const temp = realpathSync(tmpdir())
  const dir = given ? realpathSync(given) : realpathSync(mkdtempSync(join(tmpdir(), 'meeting-scribe-smoke-')))
  if (!dir.startsWith(`${temp}/`)) throw new Error(`smoke: userData fora da pasta temporária (${dir})`)
  app.setPath('userData', dir)
  app.setPath('sessionData', dir)
  // Contrato 17: o smoke dos contratos anteriores confere a linha de comando (a reserva); o agente ACP falso
  // entra só no bloco dele, no fim do tema claro.
  const settingsFile = join(dir, SETTINGS_FILE)
  if (!existsSync(settingsFile)) writeFileSync(settingsFile, `${JSON.stringify({ version: SETTINGS_VERSION, settings: { claudeTransport: 'cli' } })}\n`, { mode: 0o600 })
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  return dir
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function evaluate<T>(contents: WebContents, script: string): Promise<T> {
  return (await contents.executeJavaScript(script, true)) as T
}

async function waitFor(contents: WebContents, predicate: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(contents, `Boolean(${predicate})`)) return true
    await wait(50)
  }
  return false
}

/** Fontes carregadas, transição de rota terminada e um quadro pintado. */
async function settle(contents: WebContents): Promise<void> {
  await evaluate(contents, 'document.fonts.ready.then(() => true)')
  await wait(400)
}

async function loadAndWait(win: BrowserWindow): Promise<void> {
  const contents = win.webContents
  if (contents.isLoading()) await new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()))
  if (!(await waitFor(contents, "document.querySelector('main[data-route]')", 10_000))) {
    throw new Error('o renderer não montou a área principal')
  }
}

const currentRoute = (contents: WebContents): Promise<string> =>
  evaluate<string>(contents, "document.querySelector('main')?.dataset.route ?? ''")

const activeNav = (contents: WebContents): Promise<string> =>
  evaluate<string>(contents, `document.querySelector('[aria-current="page"]')?.dataset.nav ?? ''`)

async function clickSelector(contents: WebContents, selector: string): Promise<void> {
  const found = await evaluate<boolean>(
    contents,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`,
  )
  if (!found) throw new Error(`elemento não encontrado: ${selector}`)
}

const routeIs = (route: string): string => `document.querySelector('main')?.dataset.route === '${route}'`

/** Contrato 18: a aba marcada e o painel dela à mostra (os outros ficam montados, com `hidden`). */
const settingsTabIs = (tab: SettingsTab): string =>
  `document.querySelector('[role="tab"][data-tab="${tab}"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-settings-panel="${tab}"]')?.hidden === false`

/** Contrato 18: troca de aba pelo clique, já em Configurações. */
async function selectSettingsTab(contents: WebContents, tab: SettingsTab): Promise<boolean> {
  await waitFor(contents, `document.querySelector('[role="tab"][data-tab="${tab}"]')`)
  await clickSelector(contents, `[role="tab"][data-tab="${tab}"]`)
  return waitFor(contents, settingsTabIs(tab))
}

/** Contrato 18: a âncora rolou a aba até o bloco (rolagem fora do topo e o bloco à vista). */
const anchoredAt = (label: string): string =>
  `(() => { const s = document.querySelector('[data-settings-scroll]'); const b = document.querySelector('section[aria-label=${JSON.stringify(label)}]')?.getBoundingClientRect(); const r = s.getBoundingClientRect(); return s.scrollTop > 0 && b && b.top >= r.top - 1 && b.top < r.top + 40 })()`

/** Contrato 18: Configurações pela barra lateral e a aba pelo clique. */
async function openSettingsTab(contents: WebContents, tab: SettingsTab): Promise<boolean> {
  await clickSelector(contents, '[data-nav="configuracoes"]')
  await waitFor(contents, routeIs('configuracoes'))
  return selectSettingsTab(contents, tab)
}
const probeJs = (expression: string): string => `window.__smokeProbe?.${expression}`

async function captureState(contents: WebContents): Promise<{ phase?: string; mic?: string; system?: string } | null> {
  return evaluate(contents, `${probeJs('state()')} ?? null`)
}

async function frameCounts(contents: WebContents): Promise<{ mic: number; system: number } | null> {
  return evaluate(contents, `${probeJs('frames()')} ?? null`)
}

/** Quadros desenhados pela fita em 1 s. */
async function tapeFps(contents: WebContents): Promise<number> {
  const before = await evaluate<number>(contents, `${probeJs('tapeFrames()')} ?? 0`)
  await wait(1000)
  return (await evaluate<number>(contents, `${probeJs('tapeFrames()')} ?? 0`)) - before
}

function readMeetings(userDataDir: string): Meeting[] {
  const file = join(userDataDir, MEETINGS_FILE)
  if (!existsSync(file)) return []
  return (JSON.parse(readFileSync(file, 'utf8')) as { meetings: Meeting[] }).meetings
}

interface FixtureLine {
  at: number
  source: 'mic' | 'system'
  sessionId: string
  offsetMs: number
  message: unknown
}

/**
 * A sessão real gravada em 14/11/2026 (mic de 30 s, com tradução). É a mesma fixture dos testes do
 * redutor: o smoke não inventa texto nem conecta — mostra o que o app mostraria com ela. Com
 * `echo-session.jsonl`, o eco do alto-falante do contrato 06 (o exemplo real, nas duas trilhas).
 */
function readSessionFixture(name = 'aai-session.jsonl'): FixtureLine[] {
  const file = join(app.getAppPath(), 'test', 'fixtures', 'session', name)
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FixtureLine)
    .filter((line) => line.message !== undefined)
}

const fixtureEnvelope = (line: FixtureLine): StreamEnvelope => ({ source: line.source, sessionId: line.sessionId, offsetMs: line.offsetMs, message: line.message })

function fixtureSegments(lines: readonly FixtureLine[]): RuntimeSegment[] {
  return lines.reduce((state, line) => applyMessage(state, fixtureEnvelope(line)), emptyTranscriptState()).segments
}

/** Texto que só o trecho do eco tem (o mic e o sistema dizem "direto na minha conta"). */
const ECHO_PHRASE = 'direto na minha conta'

/**
 * Contrato 06, CA8: a fixture de eco entra na coluna ao vivo em dois tempos, na ordem real. Com o mic
 * fechado e só o parcial do sistema, a fala aparece em "Você"; com o final do sistema, ela fica só em
 * "Participantes" (sem animação nem aviso). Fotografa `gravacao-eco-light`.
 */
async function echoCheck(win: BrowserWindow, outDir: string): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const lines = readSessionFixture('echo-session.jsonl')
  const systemFinal = lines.findIndex((line) => line.source === 'system' && (line.message as { end_of_turn?: unknown } | null)?.end_of_turn === true)
  const rows = `[...document.querySelectorAll('[data-transcript-list] li')].map((li) => ({ label: li.querySelector('.caps')?.textContent ?? '', text: li.querySelector('[data-transcript-text]')?.textContent ?? '' }))`
  const withPhrase = (list: { label: string; text: string }[]): string[] => list.filter((row) => row.text.includes(ECHO_PHRASE)).map((row) => row.label)

  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(fixtureSegments(lines.slice(0, systemFinal)))})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 3`)
  const before = await evaluate<{ label: string; text: string }[]>(contents, rows)
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(fixtureSegments(lines))})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 2`)
  await settle(contents)
  const after = await evaluate<{ label: string; text: string }[]>(contents, rows)
  const shot = await capture(win, outDir, 'gravacao-eco-light')
  const beforeLabels = withPhrase(before)
  const afterLabels = withPhrase(after)
  return {
    check: {
      ok:
        beforeLabels.includes('Você') &&
        afterLabels.length === 1 &&
        afterLabels[0] === 'Participante A' &&
        after.some((row) => row.label === 'Você' && row.text.startsWith('Pode falar')),
      detail: `antes do final do sistema: "${ECHO_PHRASE}" em [${beforeLabels.join(', ')}]; depois: em [${afterLabels.join(', ')}]; linhas na tela: ${after.map((row) => row.label).join(', ')}`,
    },
    shot,
  }
}

/** Coluna ao vivo: a conversa até o primeiro parcial do terceiro turno (dois finais + parcial). */
function liveFixtureLines(lines: readonly FixtureLine[]): FixtureLine[] {
  const index = lines.findIndex((line) => {
    const message = line.message as { type?: unknown; turn_order?: unknown; end_of_turn?: unknown } | null
    return message?.type === 'Turn' && message.turn_order === 2 && message.end_of_turn === false
  })
  return index === -1 ? [...lines] : lines.slice(0, index + 1)
}

function transcriptDocument(meetingId: string, lines: readonly FixtureLine[]): TranscriptDocument {
  return {
    version: TRANSCRIPT_VERSION,
    meetingId,
    sourceLanguage: DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: DEFAULT_SETTINGS.targetLanguage,
    translationModel: DEFAULT_SETTINGS.translationModel,
    segments: persistableSegments({ segments: fixtureSegments(lines), pendingTranslations: {} }),
  }
}

/** Processos do `claude` falso abertos pelo chat (os únicos com `--include-partial-messages`). */
const chatSpawns = (fixtures: SmokeFixtures): SmokeFixtures['claudeSpawns'] => fixtures.claudeSpawns.filter((spawn) => spawn.args.includes('--include-partial-messages'))

const CHAT_DONE = `document.querySelector('[data-chat-message="assistant"]:not([data-chat-streaming])') && !document.querySelector('[data-chat-streaming]')`
const LAST_ANSWER = `[...document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])')].at(-1)?.textContent ?? ''`

/** Uma pergunta pelo campo (Enter envia) e a espera da resposta: viu texto aparecer antes do fim? */
async function askChat(contents: WebContents, question: string): Promise<{ streamed: boolean; done: boolean; answer: string }> {
  const answersBefore = await evaluate<number>(contents, `document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])').length`)
  await setValue(contents, '[data-chat-input]', question)
  await pressEnterIn(contents, '[data-chat-input]')
  const streamed = await waitFor(contents, `(document.querySelector('[data-chat-streaming] [data-chat-markdown]')?.textContent ?? '').length > 0`, 8000)
  const done = await waitFor(contents, `${CHAT_DONE} && document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])').length > ${answersBefore}`, 8000)
  return { streamed, done, answer: await evaluate<string>(contents, LAST_ANSWER) }
}

interface SmokeChatFile {
  id: string
  meetingId: string | null
  title: string
  scope?: { kind: string; meetingIds?: string[] }
  model?: string | null
  thinkMore?: boolean
  messages: { role: string; text: string; error?: string; steps?: unknown[]; thinking?: string; plan?: unknown[]; meta?: { model: string; consulted: string[] }; model?: string }[]
}

function readChatFiles(userDataDir: string): SmokeChatFile[] {
  const dir = join(userDataDir, CHATS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as SmokeChatFile)
}

const chatFile = (userDataDir: string, id: string): SmokeChatFile | undefined => readChatFiles(userDataDir).find((chat) => chat.id === id)

/**
 * Contrato 16, CA2 e CA8: uma pergunta pelo campo, olhando a resposta em curso a cada 30 ms: as linhas de
 * estado vistas ("Pensando…", depois o último passo) e se o bloco "Raciocínio e passos" estava aberto.
 */
async function askWatching(contents: WebContents, question: string): Promise<{ statuses: string[]; liveOpen: boolean; streamed: boolean; done: boolean; answer: string }> {
  const answersBefore = await evaluate<number>(contents, `document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])').length`)
  await setValue(contents, '[data-chat-input]', question)
  await pressEnterIn(contents, '[data-chat-input]')
  const statuses: string[] = []
  let liveOpen = false
  let streamed = false
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const seen = await evaluate<{ status: string; open: boolean; text: boolean }>(
      contents,
      `({ status: document.querySelector('[data-chat-streaming] [data-chat-status]')?.textContent ?? '', open: Boolean(document.querySelector('[data-chat-streaming] [data-chat-reasoning="open"]')), text: (document.querySelector('[data-chat-streaming] [data-chat-markdown]')?.textContent ?? '').length > 0 })`,
    )
    if (seen.status && statuses.at(-1) !== seen.status) statuses.push(seen.status)
    liveOpen ||= seen.open
    if (seen.text) {
      streamed = true
      break
    }
    await wait(30)
  }
  const done = await waitFor(contents, `${CHAT_DONE} && document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])').length > ${answersBefore}`, 10_000)
  return { statuses, liveOpen, streamed, done, answer: await evaluate<string>(contents, LAST_ANSWER) }
}

const LAST_ASSISTANT = `[...document.querySelectorAll('[data-chat-message="assistant"]:not([data-chat-streaming])')].at(-1)`

const mode = (path: string): string => (existsSync(path) ? (statSync(path).mode & 0o777).toString(8) : 'ausente')

/** Argumentos de isolamento do chat (CA2): ferramentas liberadas e negadas, nada pergunta, ambiente filtrado. */
function chatArgsCheck(spawn: SmokeFixtures['claudeSpawns'][number] | undefined): boolean {
  if (!spawn) return false
  const value = (flag: string): string | undefined => spawn.args[spawn.args.indexOf(flag) + 1]
  return (
    value('--allowedTools') === CHAT_ALLOWED_TOOLS.join(' ') &&
    value('--disallowedTools') === CHAT_DISALLOWED_TOOLS.join(' ') &&
    value('--tools') === CHAT_ALLOWED_TOOLS.join(',') &&
    value('--permission-mode') === 'dontAsk' &&
    value('--setting-sources') === '' &&
    spawn.args.includes('--restricted') &&
    spawn.args.includes('--disable-slash-commands') &&
    spawn.args.includes('--strict-mcp-config') &&
    spawn.args.includes('--no-session-persistence') &&
    spawn.envNames.every((name) => ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'PATH'].includes(name))
  )
}

/**
 * Contrato 15 (CA1, CA2, CA3, CA4 e CA9) nos dois temas: o acervo apagado é refeito a partir das reuniões
 * semeadas; uma pergunta pela tela "Perguntar" responde em pedaços, com o link `meeting:`; a conversa fica
 * gravada e o processo roda no acervo só com as ferramentas de leitura. A foto sai com a conversa.
 */
async function chatScreenCheck(
  contents: WebContents,
  ctx: SmokeContext,
  shoot: () => Promise<void>,
  shootV2: () => Promise<void>,
  shootEmpty: (() => Promise<void>) | null,
): Promise<{ check: Check; v2: Check }> {
  const corpus = join(ctx.userDataDir, CHAT_CORPUS_DIR)
  rmSync(corpus, { recursive: true, force: true })
  const meetings = readMeetings(ctx.userDataDir)
  const chatsBefore = readChatFiles(ctx.userDataDir).length
  const spawnsBefore = chatSpawns(ctx.fixtures).length
  await clickSelector(contents, '[data-nav="perguntar"]')
  // Contrato 16: 6 sugestões em cartões, em 3 grupos.
  const opened = await waitFor(
    contents,
    `${routeIs('perguntar')} && document.querySelectorAll('[data-chat-suggestion]').length === 6 && document.querySelectorAll('[data-chat-empty] section').length === 3 && document.querySelector('[data-chat-input]')`,
    8000,
  )
  const suggestions = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-chat-suggestion]')].map((b) => b.textContent)`)
  if (shootEmpty) await shootEmpty()
  const asked = await askWatching(contents, 'O que ficou decidido esta semana?')
  const link = await evaluate<string>(contents, `[...document.querySelectorAll('[data-chat-message="assistant"] [data-meeting-link]')].at(-1)?.dataset.meetingLink ?? ''`)
  const userRight = await evaluate<string>(contents, `getComputedStyle(document.querySelector('[data-chat-message="user"]')).justifyContent`)
  const index = existsSync(join(corpus, CHAT_INDEX_FILE)) ? readFileSync(join(corpus, CHAT_INDEX_FILE), 'utf8') : ''
  const indexLines = index.split('\n').filter((line) => line.startsWith('- ')).length
  const sample = meetings.find((meeting) => meeting.id === 'smoke-2')
  const sampleFile = existsSync(corpus) ? readdirSync(corpus).find((name) => sample && name.endsWith(corpusFileSuffix(sample.id))) : undefined
  const sampleText = sampleFile ? readFileSync(join(corpus, sampleFile), 'utf8') : ''
  const spawn = chatSpawns(ctx.fixtures).at(-1)
  const chats = readChatFiles(ctx.userDataDir)
  const saved = chats.find((chat) => chat.meetingId === null && chat.messages.length === 2 && chat.messages[0]?.text === 'O que ficou decidido esta semana?')
  await shoot()
  const v2 = await chatAnswerDetailsCheck(contents, ctx, asked, saved, shootV2)
  const check = {
    ok:
      opened &&
      asked.streamed &&
      asked.done &&
      asked.answer.includes(`${meetings.length} reuniões`) &&
      meetings.some((meeting) => meeting.id === link) &&
      userRight === 'flex-end' &&
      indexLines === meetings.length &&
      sampleText.includes(`- Id: ${sample?.id ?? '?'}`) &&
      sampleText.includes('## Resumo') &&
      sampleText.includes(LIST_SUMMARIES['smoke-2']?.decisions[0] ?? '?') &&
      sampleText.includes('## Transcrição') &&
      mode(corpus) === '700' &&
      mode(join(corpus, CHAT_INDEX_FILE)) === '600' &&
      chatSpawns(ctx.fixtures).length === spawnsBefore + 1 &&
      spawn?.cwd === corpus &&
      chatArgsCheck(spawn) &&
      chats.length === chatsBefore + 1 &&
      saved?.messages[1]?.role === 'assistant' &&
      saved.messages[1].error === undefined,
    detail: `tela=${opened}, sugestões ${JSON.stringify(suggestions)}; estados=${JSON.stringify(asked.statuses)}, terminou=${asked.done}, resposta "${asked.answer.slice(0, 120)}"; link meeting:${link}; pessoa à direita=${userRight}; INDICE.md ${indexLines} linhas para ${meetings.length} reuniões, ${sampleFile ?? 'sem .md da smoke-2'}; permissões pasta ${mode(corpus)}, índice ${mode(join(corpus, CHAT_INDEX_FILE))}; processo ${JSON.stringify(spawn ? { cwd: spawn.cwd.replace(ctx.userDataDir, '<userData>'), args: spawn.args.filter((arg, i) => arg.startsWith('--') || spawn.args[i - 1]?.endsWith('Tools') || spawn.args[i - 1] === '--permission-mode'), env: spawn.envNames } : null)}; conversas ${chatsBefore} -> ${chats.length}`,
  }
  return { check, v2 }
}

/**
 * Contrato 16, CA1, CA2, CA3, CA7 e CA8 (nos dois temas): "Pensando…" e depois "Abrindo «…»" enquanto a
 * resposta não começa, com "Raciocínio e passos" aberto; depois de pronta, o bloco fechado e o rodapé com
 * modelo, tempo, tokens, custo nominal (com a dica) e a reunião consultada. Aberto, o bloco mostra os 3
 * passos, a ferramenta negada e o raciocínio em texto puro; nenhum caminho de arquivo chega à tela. Tudo
 * gravado com a resposta. A foto `perguntar-v2` sai com o bloco e a lista de consultadas abertos.
 */
async function chatAnswerDetailsCheck(
  contents: WebContents,
  ctx: SmokeContext,
  asked: { statuses: string[]; liveOpen: boolean; done: boolean },
  saved: SmokeChatFile | undefined,
  shoot: () => Promise<void>,
): Promise<Check> {
  const closedAfter = await evaluate<boolean>(contents, `Boolean(${LAST_ASSISTANT}?.querySelector('[data-chat-reasoning="closed"]'))`)
  const footer = await evaluate<string>(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-footer]')?.textContent ?? ''`)
  const costHint = await evaluate<string>(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-cost]')?.getAttribute('title') ?? ''`)
  await evaluate(contents, `${LAST_ASSISTANT}?.querySelector('[data-action="toggle-reasoning"]')?.click()`)
  await evaluate(contents, `${LAST_ASSISTANT}?.querySelector('[data-action="toggle-consulted"]')?.click()`)
  await waitFor(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-steps]') && ${LAST_ASSISTANT}?.querySelector('[data-chat-consulted]')`)
  const steps = await evaluate<string[]>(contents, `[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-step]') ?? [])].map((li) => li.textContent)`)
  const denied = await evaluate<string>(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-denied]')?.textContent ?? ''`)
  const thinking = await evaluate<{ text: string; elements: number }>(
    contents,
    `(() => { const p = ${LAST_ASSISTANT}?.querySelector('[data-chat-thinking]'); return { text: p?.textContent ?? '', elements: p?.children.length ?? -1 } })()`,
  )
  const consulted = await evaluate<string[]>(contents, `[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-consulted] [data-meeting-link]') ?? [])].map((b) => b.dataset.meetingLink)`)
  const pathsOnScreen = await evaluate<boolean>(contents, `document.body.innerText.includes(${JSON.stringify(ctx.userDataDir)}) || document.body.innerText.includes('/chat-corpus') || document.body.innerText.includes('/chat-scope')`)
  const stored = saved ? chatFile(ctx.userDataDir, saved.id)?.messages[1] : undefined
  await shoot()
  return {
    ok:
      asked.done &&
      asked.statuses[0] === 'Pensando…' &&
      asked.statuses.some((status) => status.startsWith('Abrindo «')) &&
      asked.liveOpen &&
      closedAfter &&
      footer.includes('Sonnet') &&
      footer.includes('3,1 mil entrada · 420 saída') &&
      footer.includes('US$ 0,02') &&
      footer.includes('1 reunião consultada') &&
      costHint.includes('sai do seu plano do Claude') &&
      steps.length === 3 &&
      steps[0] === 'Lendo o índice das reuniões' &&
      (steps[1] ?? '').startsWith('Abrindo «') &&
      (steps[2] ?? '').startsWith('Procurando "') &&
      denied.startsWith('1 ferramenta negada') &&
      thinking.text.includes('<b>sem HTML</b>') &&
      thinking.elements === 0 &&
      consulted.length === 1 &&
      !pathsOnScreen &&
      stored?.steps?.length === 3 &&
      (stored.thinking ?? '').includes('<b>sem HTML</b>') &&
      stored.meta?.model === 'claude-sonnet-5-5' &&
      stored.model === 'sonnet',
    detail: `estados ${JSON.stringify(asked.statuses)}, bloco aberto enquanto pensa=${asked.liveOpen}, fechado depois=${closedAfter}; rodapé "${footer}" (dica "${costHint}"); passos ${JSON.stringify(steps)}; "${denied}"; raciocínio texto puro=${thinking.elements === 0} ("${thinking.text.slice(0, 60)}"); consultadas ${JSON.stringify(consulted)}; caminho na tela=${pathsOnScreen}; gravado: ${stored?.steps?.length ?? 0} passos, meta ${stored?.meta?.model ?? '?'}, modelo ${stored?.model ?? '?'}`,
  }
}

/**
 * Contrato 16, CA3, CA4, CA5 e CA8 (tema claro), na conversa da tela "Perguntar": o painel "Contexto" com as
 * consultadas e os totais; "Reuniões escolhidas" com duas reuniões monta `chat-scope/<id>/` só com os `.md`
 * delas e o `INDICE.md` (foto `perguntar-contexto-light`); o modelo trocado na barra do campo abre outro
 * processo com `--model opus`; "Refazer" troca a última resposta num processo novo; renomear pelo menu "…"
 * da lista; ↑ no campo vazio edita a última pergunta.
 */
async function chatContextCheck(contents: WebContents, ctx: SmokeContext, shootContext: () => Promise<void>): Promise<Check> {
  const chatId = await evaluate<string>(contents, `document.querySelector('[data-chat-conversation]')?.getAttribute('data-chat-conversation') ?? ''`)
  const spawns = (): SmokeFixtures['claudeSpawns'] => chatSpawns(ctx.fixtures)
  // Painel "Contexto".
  await clickSelector(contents, '[data-action="toggle-context"]')
  const panel = await waitFor(contents, `document.querySelector('[data-chat-context]')`)
  const panelConsulted = await evaluate<number>(contents, `document.querySelectorAll('[data-chat-context-consulted] [data-meeting-link]').length`)
  const totals = await evaluate<string>(contents, `document.querySelector('[data-chat-totals]')?.textContent ?? ''`)
  // Teclado no grupo do escopo (tabindex móvel): ↓ marca "Últimos 7 dias" com o foco nele; End vai a
  // "Reuniões escolhidas".
  const radioKey = (key: string): Promise<unknown> =>
    evaluate(contents, `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
  await evaluate(contents, `document.querySelector('[data-scope-option][aria-checked="true"]')?.focus()`)
  const tabStops = await evaluate<number>(contents, `document.querySelectorAll('[data-scope-option][tabindex="0"]').length`)
  await radioKey('ArrowDown')
  const arrowed = await waitFor(contents, `document.querySelector('[data-scope-option="7d"]')?.getAttribute('aria-checked') === 'true' && document.activeElement?.dataset.scopeOption === '7d'`)
  await radioKey('End')
  // Escopo "Reuniões escolhidas" sem nenhuma: envio bloqueado com o aviso; depois, duas reuniões.
  const ended = await waitFor(contents, `document.activeElement?.dataset.scopeOption === 'meetings'`)
  const blocked = await waitFor(contents, `document.querySelector('[data-chat-scope-empty]')?.textContent === 'Escolha ao menos uma reunião'`)
  await setValue(contents, '[data-chat-input]', 'Isto não pode sair')
  const sendDisabled = await evaluate<boolean>(contents, `document.querySelector('[data-action="chat-send"]')?.disabled === true`)
  const spawnsBlocked = spawns().length
  await pressEnterIn(contents, '[data-chat-input]')
  await wait(300)
  const nothingSent = spawns().length === spawnsBlocked && (await evaluate<string>(contents, `document.querySelector('[data-chat-input]')?.value ?? ''`)) === 'Isto não pode sair'
  await setValue(contents, '[data-chat-input]', '')
  await waitFor(contents, `document.querySelector('[data-scope-meeting="smoke-2"]') && document.querySelector('[data-scope-meeting="smoke-4"]')`)
  await clickSelector(contents, '[data-scope-meeting="smoke-2"]')
  await waitFor(contents, `document.querySelector('[data-scope-meeting="smoke-2"]')?.checked`)
  await clickSelector(contents, '[data-scope-meeting="smoke-4"]')
  const scoped = await waitFor(contents, `document.querySelector('[data-action="chat-scope-label"]')?.textContent === 'Reuniões escolhidas (2)'`)
  for (let i = 0; i < 40 && (chatFile(ctx.userDataDir, chatId)?.scope?.meetingIds?.length ?? 0) < 2; i++) await wait(50)
  const savedScope = chatFile(ctx.userDataDir, chatId)?.scope
  await shootContext()
  const before = spawns().length
  const previous = spawns().at(-1)
  const scopedAnswer = await askChat(contents, 'Quais tarefas são minhas?')
  const scopedSpawn = spawns().at(-1)
  const scopeFiles = scopedSpawn && existsSync(scopedSpawn.cwd) ? readdirSync(scopedSpawn.cwd).sort() : []
  const scopeIndex = scopedSpawn && existsSync(join(scopedSpawn.cwd, CHAT_INDEX_FILE)) ? readFileSync(join(scopedSpawn.cwd, CHAT_INDEX_FILE), 'utf8') : ''
  await clickSelector(contents, '[data-action="close-context"]')
  await waitFor(contents, `!document.querySelector('[data-chat-context]')`)

  // Modelo trocado na barra do campo: o processo é refeito com --model opus.
  await setValue(contents, '[data-chat-model-select]', 'opus', 'change')
  const modelLabel = await waitFor(contents, `document.querySelector('[data-action="chat-model-label"]')?.textContent === 'Opus'`)
  const beforeModel = spawns().length
  const opusAnswer = await askChat(contents, 'E o que ficou decidido?')
  const opusSpawn = spawns().at(-1)
  const opusSpawnCount = spawns().length
  const opusFooter = await evaluate<string>(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-footer]')?.textContent ?? ''`)

  // "Refazer": mesma pergunta, processo novo, a resposta trocada.
  const lengthBefore = chatFile(ctx.userDataDir, chatId)?.messages.length ?? 0
  const beforeRedo = spawns().length
  await evaluate(contents, `${LAST_ASSISTANT}?.querySelector('[data-action="chat-redo"]')?.click()`)
  for (let i = 0; i < 100 && spawns().length === beforeRedo; i++) await wait(50)
  const redoSpawn = spawns().at(-1)
  for (let i = 0; i < 200 && chatFile(ctx.userDataDir, chatId)?.messages.at(-1)?.role !== 'assistant'; i++) await wait(50)
  await waitFor(contents, CHAT_DONE, 10_000)
  const afterRedo = chatFile(ctx.userDataDir, chatId)

  // Menu "…" pelo teclado: abre com o foco no primeiro item; ↓, End, Home andam; Esc fecha e volta ao "…".
  const focusedAction = (): Promise<string> => evaluate<string>(contents, `document.activeElement?.dataset.action ?? ''`)
  const menuKey = (key: string): Promise<unknown> =>
    evaluate(contents, `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`)
  await clickSelector(contents, `[data-chat-item="${chatId}"] [data-action="chat-row-menu"]`)
  await waitFor(contents, `document.activeElement?.dataset.action === 'rename-chat'`)
  const menuKeys: string[] = [await focusedAction()]
  for (const key of ['ArrowDown', 'ArrowDown', 'End', 'Home']) {
    await menuKey(key)
    menuKeys.push(await focusedAction())
  }
  await menuKey('Escape')
  const menuClosed = await waitFor(contents, `!document.querySelector('[role="menu"]') && document.activeElement?.dataset.action === 'chat-row-menu'`)
  const menuOk = JSON.stringify(menuKeys) === JSON.stringify(['rename-chat', 'delete-chat', 'rename-chat', 'delete-chat', 'rename-chat']) && menuClosed

  // Renomear pelo menu "…" da linha.
  await clickSelector(contents, `[data-chat-item="${chatId}"] [data-action="chat-row-menu"]`)
  await clickSelector(contents, '[data-action="rename-chat"]')
  await waitFor(contents, `document.querySelector('[data-chat-rename-input]')`)
  await setValue(contents, '[data-chat-rename-input]', 'Conversa renomeada')
  await pressEnterIn(contents, '[data-chat-rename-input]')
  const renamedRow = await waitFor(contents, `document.querySelector('[data-chat-item="${chatId}"]')?.textContent?.includes('Conversa renomeada')`)
  for (let i = 0; i < 40 && chatFile(ctx.userDataDir, chatId)?.title !== 'Conversa renomeada'; i++) await wait(50)
  const renamedFile = chatFile(ctx.userDataDir, chatId)?.title

  // ↑ no campo vazio: a última pergunta volta ao campo; enviada, troca a última pergunta e a resposta.
  await setValue(contents, '[data-chat-input]', '')
  await evaluate(contents, `document.querySelector('[data-chat-input]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`)
  const editing = await waitFor(contents, `document.querySelector('[data-chat-editing]') && document.querySelector('[data-chat-input]')?.value === 'E o que ficou decidido?'`)
  const lengthBeforeEdit = chatFile(ctx.userDataDir, chatId)?.messages.length ?? 0
  const beforeEdit = spawns().length
  await setValue(contents, '[data-chat-input]', 'E quais decisões ficaram?')
  await pressEnterIn(contents, '[data-chat-input]')
  for (let i = 0; i < 100 && spawns().length === beforeEdit; i++) await wait(50)
  for (let i = 0; i < 200 && chatFile(ctx.userDataDir, chatId)?.messages.at(-1)?.role !== 'assistant'; i++) await wait(50)
  const edited = { done: await waitFor(contents, CHAT_DONE, 10_000) }
  const afterEdit = chatFile(ctx.userDataDir, chatId)
  const lastQuestion = afterEdit?.messages.at(-2)?.text

  return {
    ok:
      chatId !== '' &&
      tabStops === 1 &&
      arrowed &&
      ended &&
      blocked &&
      sendDisabled &&
      nothingSent &&
      menuOk &&
      panel &&
      panelConsulted >= 1 &&
      totals.includes('Mensagens') &&
      scoped &&
      savedScope?.kind === 'meetings' &&
      JSON.stringify(savedScope.meetingIds) === JSON.stringify(['smoke-2', 'smoke-4']) &&
      scopedAnswer.done &&
      scopedAnswer.answer.includes('2 reuniões') &&
      spawns().length >= before + 1 &&
      previous?.exited === true &&
      scopedSpawn?.cwd === join(ctx.userDataDir, CHAT_SCOPE_DIR, chatId) &&
      scopeFiles.length === 3 &&
      scopeFiles.includes(CHAT_INDEX_FILE) &&
      scopeFiles.some((name) => name.endsWith(corpusFileSuffix('smoke-2'))) &&
      scopeFiles.some((name) => name.endsWith(corpusFileSuffix('smoke-4'))) &&
      scopeIndex.includes('meeting:smoke-2') &&
      !scopeIndex.includes('meeting:smoke-3') &&
      chatArgsCheck(scopedSpawn) &&
      modelLabel &&
      opusAnswer.done &&
      opusSpawn !== scopedSpawn &&
      opusSpawnCount === beforeModel + 1 &&
      opusSpawn?.args[opusSpawn.args.indexOf('--model') + 1] === 'opus' &&
      opusFooter.includes('Opus') &&
      redoSpawn !== opusSpawn &&
      redoSpawn?.args[redoSpawn.args.indexOf('--model') + 1] === 'opus' &&
      afterRedo?.messages.length === lengthBefore &&
      afterRedo.messages.at(-2)?.text === 'E o que ficou decidido?' &&
      renamedRow &&
      renamedFile === 'Conversa renomeada' &&
      editing &&
      edited.done &&
      afterEdit?.messages.length === lengthBeforeEdit &&
      lastQuestion === 'E quais decisões ficaram?',
    detail: `conversa ${chatId}; teclado do escopo: 1 parada de Tab=${tabStops === 1}, ↓=${arrowed}, End=${ended}; escolhidas vazio: aviso=${blocked}, Enviar desligado=${sendDisabled}, nada enviado=${nothingSent}; menu "…" pelo teclado ${JSON.stringify(menuKeys)}, Esc fechou=${menuClosed}; painel=${panel}, consultadas no painel=${panelConsulted}, totais "${totals}"; escopo salvo ${JSON.stringify(savedScope)}, rótulo=${scoped}; processo do escopo em ${scopedSpawn ? scopedSpawn.cwd.replace(ctx.userDataDir, '<userData>') : '?'} com ${JSON.stringify(scopeFiles)}, anterior saiu=${previous?.exited ?? '?'}, resposta "${scopedAnswer.answer.slice(0, 80)}"; modelo -> ${opusSpawn?.args[opusSpawn.args.indexOf('--model') + 1] ?? '?'}, rodapé "${opusFooter.slice(0, 40)}"; Refazer: processo novo=${redoSpawn !== opusSpawn}, mensagens ${lengthBefore} -> ${afterRedo?.messages.length ?? '?'}; renomear: linha=${renamedRow}, arquivo "${renamedFile ?? '?'}"; ↑: editando=${editing}, mensagens ${lengthBeforeEdit} -> ${afterEdit?.messages.length ?? '?'}, última pergunta "${lastQuestion ?? '?'}"`,
  }
}

/** Contrato 15, CA3 (tema claro): "Parar" mata o processo e grava o parcial; a próxima pergunta abre outro, com o histórico. */
async function chatStopCheck(contents: WebContents, ctx: SmokeContext): Promise<Check> {
  const before = chatSpawns(ctx.fixtures).length
  await setValue(contents, '[data-chat-input]', 'Responda devagar, por favor.')
  await pressEnterIn(contents, '[data-chat-input]')
  const streaming = await waitFor(contents, `(document.querySelector('[data-chat-streaming] [data-chat-markdown]')?.textContent ?? '').length > 0 && document.querySelector('[data-action="chat-stop"]')`, 8000)
  await clickSelector(contents, '[data-action="chat-stop"]')
  const stopped = await waitFor(contents, `document.querySelector('[data-chat-error="stopped"]') && document.querySelector('[data-action="chat-send"]')`, 5000)
  const slow = chatSpawns(ctx.fixtures).at(-1)
  for (let attempt = 0; attempt < 60 && slow && !slow.exited; attempt++) await wait(50)
  const stoppedText = await text(contents, '[data-chat-error="stopped"]')
  const saved = readChatFiles(ctx.userDataDir).find((chat) => chat.messages.some((message) => message.error === 'stopped'))
  const next = await askChat(contents, 'E agora, o que ficou?')
  const after = chatSpawns(ctx.fixtures)
  return {
    ok:
      streaming &&
      stopped &&
      slow?.exited === true &&
      stoppedText.includes('Resposta interrompida.') &&
      saved !== undefined &&
      next.done &&
      next.answer.includes('Histórico: sim') &&
      after.length === before + 1 &&
      after.at(-1) !== slow,
    detail: `resposta lenta em pedaços=${streaming}; "Parar" -> erro na tela=${stopped} ("${stoppedText.slice(-60)}"), processo saiu=${slow?.exited ?? '?'}, parcial gravado=${saved !== undefined}; próxima pergunta terminou=${next.done}, histórico reenviado=${next.answer.includes('Histórico: sim')}; processos do chat ${before} -> ${after.length}`,
  }
}

/**
 * Contrato 15, CA4, CA5 e CA9 (tema claro): o link `meeting:` da resposta abre o detalhe daquela reunião; a
 * aba "Perguntar" do detalhe responde com o `claude` rodando numa pasta só com o `.md` dela.
 */
async function chatMeetingCheck(contents: WebContents, ctx: SmokeContext): Promise<Check> {
  const link = await evaluate<string>(contents, `[...document.querySelectorAll('[data-chat-message="assistant"] [data-meeting-link]')].at(-1)?.dataset.meetingLink ?? ''`)
  await clickSelector(contents, `[data-meeting-link="${link}"]`)
  const opened = await waitFor(contents, `${routeIs('detalhe')} && ${DETAIL_ID} === ${JSON.stringify(link)}`, 5000)
  await clickSelector(contents, '[data-tab="perguntar"]')
  const tab = await waitFor(contents, `document.querySelector('[data-meeting-chat] [data-chat-input]') && document.querySelectorAll('[data-chat-suggestion]').length > 0`, 8000)
  const before = chatSpawns(ctx.fixtures).length
  const asked = await askChat(contents, 'O que ficou decidido?')
  const spawn = chatSpawns(ctx.fixtures).at(-1)
  const scopeRoot = join(ctx.userDataDir, CHAT_SCOPE_DIR)
  const scopeFiles = spawn && existsSync(spawn.cwd) ? readdirSync(spawn.cwd) : []
  const saved = readChatFiles(ctx.userDataDir).find((chat) => chat.meetingId === link)
  return {
    ok:
      link !== '' &&
      opened &&
      tab &&
      asked.done &&
      asked.answer.includes('Esta conversa é só sobre') &&
      chatSpawns(ctx.fixtures).length === before + 1 &&
      spawn?.cwd.startsWith(`${scopeRoot}/`) === true &&
      scopeFiles.length === 1 &&
      (scopeFiles[0] ?? '').endsWith(corpusFileSuffix(link)) &&
      chatArgsCheck(spawn) &&
      saved?.messages.length === 2,
    detail: `link meeting:${link} -> detalhe=${opened}; aba Perguntar=${tab}; resposta "${asked.answer.slice(0, 100)}"; pasta do processo ${spawn ? spawn.cwd.replace(ctx.userDataDir, '<userData>') : '?'} com ${JSON.stringify(scopeFiles)}; conversa ligada à reunião=${saved !== undefined}`,
  }
}

/** Três reuniões gravadas: hoje, ontem e três dias atrás (a última só com o microfone). */
function seedMeetings(userDataDir: string): void {
  const at = (daysAgo: number, hours: number, minutes: number): string => {
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    date.setHours(hours, minutes, 0, 0)
    return date.toISOString()
  }
  const meetings: Meeting[] = [
    { id: 'smoke-1', title: 'Planejamento da migração do banco', startedAt: at(0, 9, 30), durationMs: 32 * 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null },
    { id: 'smoke-2', title: 'Revisão do contrato com a agência', startedAt: at(1, 16, 10), durationMs: 47 * 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null },
    { id: 'smoke-3', title: 'Notas da visita à fábrica', startedAt: at(3, 11, 0), durationMs: 72 * 60_000, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null },
  ]
  writeFileSync(join(userDataDir, MEETINGS_FILE), `${JSON.stringify({ version: 1, meetings }, null, 2)}\n`)
  // A primeira reunião tem a transcrição da fixture: o detalhe fotografado abre com texto salvo.
  const transcripts = join(userDataDir, 'meetings')
  mkdirSync(transcripts, { recursive: true })
  writeFileSync(join(transcripts, 'smoke-1.json'), `${JSON.stringify(transcriptDocument('smoke-1', readSessionFixture()), null, 2)}\n`)
}

/**
 * Resumos das duas reuniões com resumo na lista (contrato 10). A `smoke-1` fica sem: com resumo, o detalhe
 * abriria na aba "Resumo" e o passo do detalhe fotografa e copia a transcrição.
 */
const LIST_SUMMARIES: Record<string, MeetingSummary> = {
  'smoke-4': {
    version: 1,
    meetingId: 'smoke-4',
    createdAt: new Date().toISOString(),
    model: 'claude-cli:haiku',
    overview: 'A equipe definiu a ordem da migração do banco e o plano de volta caso algo falhe. Depois revisou os riscos do fim de semana.',
    decisions: ['Migrar no sábado de manhã.'],
    tasks: [
      { task: 'Preparar o roteiro da migração', owner: 'Você', due: 'sexta-feira' },
      { task: 'Avisar o cliente da janela de manutenção', owner: null, due: null },
    ],
  },
  'smoke-2': {
    version: 1,
    meetingId: 'smoke-2',
    createdAt: new Date().toISOString(),
    model: 'claude-cli:haiku',
    overview: 'A agência aceitou rever o prazo de entrega do material da campanha, desde que o escopo da segunda fase seja fechado até o fim do mês, as peças de vídeo saiam da proposta e a aprovação de cada etapa seja feita por uma pessoa só do nosso lado. Depois as duas partes repassaram a lista de pendências.',
    decisions: ['Prazo novo em 15 de dezembro.', 'Vídeos ficam para a fase 3.'],
    tasks: [{ task: 'Enviar o escopo revisado', owner: 'Agência', due: null }],
  },
}

/** Palavras que só a transcrição da fixture tem (nem título nem resumo), em outra caixa e sem acento. */
const TRANSCRIPT_ONLY_TERM = 'Transcricao em TEMPO real'

/**
 * Contrato 10: mais três reuniões (5, 12 e 400 dias atrás) e o resumo de duas delas. Com as três de
 * `seedMeetings`, são seis em dias diferentes.
 */
function seedListMeetings(userDataDir: string): void {
  const at = (daysAgo: number, hours: number, minutes: number): string => {
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    date.setHours(hours, minutes, 0, 0)
    return date.toISOString()
  }
  const more: Meeting[] = [
    { id: 'smoke-4', title: 'Alinhamento semanal do time', startedAt: at(5, 10, 0), durationMs: 25 * 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null },
    { id: 'smoke-5', title: 'Entrevista com o fornecedor de nuvem', startedAt: at(12, 15, 30), durationMs: 58 * 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null },
    { id: 'smoke-6', title: 'Retrospectiva do ano', startedAt: at(400, 17, 0), durationMs: 15 * 60_000, sources: { mic: false, system: true }, audioPath: null, transcriptPath: null },
  ]
  writeFileSync(join(userDataDir, MEETINGS_FILE), `${JSON.stringify({ version: 1, meetings: [...readMeetings(userDataDir), ...more] }, null, 2)}\n`)
  for (const summary of Object.values(LIST_SUMMARIES)) {
    writeFileSync(join(userDataDir, 'meetings', `${summary.meetingId}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
  }
  // Contrato 13, CA8: duas anotações (e uma em branco, que não conta) numa reunião sem resumo.
  const now = new Date().toISOString()
  const notes: MeetingNotesFile = {
    version: 1,
    meetingId: 'smoke-5',
    notes: [
      { id: 'n1', text: NOTES_ONLY_TEXT, color: 'green', atMs: 95_000, createdAt: now, updatedAt: now },
      { id: 'n2', text: 'Comparar o suporte em português', color: 'purple', atMs: null, createdAt: now, updatedAt: now },
      { id: 'n3', text: '  ', color: 'yellow', atMs: null, createdAt: now, updatedAt: now },
    ],
  }
  writeFileSync(join(userDataDir, 'meetings', 'smoke-5.notes.json'), `${JSON.stringify(notes, null, 2)}\n`)
}

/** Texto que só as anotações da `smoke-5` têm; a busca o procura sem acento e em outra caixa. */
const NOTES_ONLY_TEXT = 'Pedir a tabela de preços por região'
const NOTES_ONLY_TERM = 'TABELA de precos'

/** Rótulo esperado do grupo, calculado aqui sem o código do renderer (contrato 10, CA2). */
function expectedDayLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const start = (value: Date): number => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  const days = Math.round((start(now) - start(date)) / 86_400_000)
  if (days === 0) return 'Hoje'
  if (days === 1) return 'Ontem'
  if (days >= 2 && days <= 6) {
    const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(date)
    return weekday.charAt(0).toUpperCase() + weekday.slice(1)
  }
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) }
  return new Intl.DateTimeFormat('pt-BR', options).format(date)
}

interface ListRow {
  id: string
  overview: string
  markers: string[]
  snippet: string
  marks: string[]
}

const LIST_ROWS = `[...document.querySelectorAll('main a[data-meeting]')].map((a) => ({
  id: a.dataset.meeting,
  overview: a.querySelector('[data-summary-overview]')?.textContent ?? '',
  markers: [...a.querySelectorAll('[data-summary-markers] span')].map((s) => s.textContent),
  snippet: a.querySelector('[data-search-snippet]')?.textContent ?? '',
  marks: [...a.querySelectorAll('[data-search-snippet] mark')].map((m) => m.textContent.toLowerCase()),
}))`
const LIST_GROUPS = `[...document.querySelectorAll('main section[data-day]')].map((s) => ({ label: s.querySelector('h2')?.textContent ?? '', total: s.querySelector('[data-day-total]')?.textContent ?? '' }))`

/** Lista com seis reuniões (contrato 10): rótulos dos dias, totais, prévia do resumo e "N tarefas". */
async function meetingsListCheck(contents: WebContents, userDataDir: string): Promise<Check> {
  const meetings = readMeetings(userDataDir).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const expectedLabels = [...new Set(meetings.map((meeting) => expectedDayLabel(meeting.startedAt)))]
  const groups = await evaluate<{ label: string; total: string }[]>(contents, LIST_GROUPS)
  const rows = await evaluate<ListRow[]>(contents, LIST_ROWS)
  const first = rows.find((row) => row.id === 'smoke-4')
  const second = rows.find((row) => row.id === 'smoke-2')
  const withNotes = rows.find((row) => row.id === 'smoke-5')
  const plain = rows.filter((row) => row.id !== 'smoke-4' && row.id !== 'smoke-2' && row.id !== 'smoke-5')
  const expectedOverview = summaryPreview(LIST_SUMMARIES['smoke-4'] as MeetingSummary).overview
  const ok =
    rows.length === 6 &&
    JSON.stringify(groups.map((group) => group.label)) === JSON.stringify(expectedLabels) &&
    groups[0]?.label === 'Hoje' &&
    groups[1]?.label === 'Ontem' &&
    /-feira$|^Sábado$|^Domingo$/.test(groups[2]?.label ?? '') &&
    /\d{4}$/.test(groups.at(-1)?.label ?? '') &&
    groups[0]?.total === '1 reunião · 32 min' &&
    first?.overview === expectedOverview &&
    JSON.stringify(first.markers) === JSON.stringify(['2 tarefas', '1 decisão']) &&
    second?.overview.endsWith('…') === true &&
    second.overview.length <= 200 &&
    JSON.stringify(second.markers) === JSON.stringify(['1 tarefa', '2 decisões']) &&
    JSON.stringify(withNotes?.markers) === JSON.stringify(['2 anotações']) &&
    plain.every((row) => row.overview === '' && row.markers.length === 0)
  return {
    ok,
    detail: `grupos ${JSON.stringify(groups)} (esperado ${JSON.stringify(expectedLabels)}); smoke-4 "${first?.overview ?? ''}" ${JSON.stringify(first?.markers ?? [])}; smoke-2 ${second?.overview.length ?? 0} caracteres ${JSON.stringify(second?.markers ?? [])}; smoke-5 ${JSON.stringify(withNotes?.markers ?? [])}; sem resumo: ${plain.map((row) => row.id).join(', ')}`,
  }
}

/**
 * Busca (contrato 10, CA4): ⌘F foca o campo; palavras que só existem na transcrição acham a reunião com o
 * trecho marcado e "na transcrição" (fotografa `reunioes-busca-light`); termo sem resultado mostra o aviso;
 * Esc limpa e a lista volta, com o foco no campo e com o foco fora dele.
 */
async function meetingsSearchCheck(win: BrowserWindow, outDir: string): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['meta'] })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['meta'] })
  const focused = await waitFor(contents, `document.activeElement?.matches('main [data-search]')`, 2000)
  const typedAt = Date.now()
  await setValue(contents, 'main [data-search]', TRANSCRIPT_ONLY_TERM)
  const found = await waitFor(contents, `document.querySelectorAll('main [data-search-snippet]').length > 0`)
  const answeredMs = Date.now() - typedAt
  await settle(contents)
  const rows = await evaluate<ListRow[]>(contents, LIST_ROWS)
  const shot = await capture(win, outDir, 'reunioes-busca-light')
  // Contrato 13, CA8: palavras que só as anotações têm.
  await setValue(contents, 'main [data-search]', NOTES_ONLY_TERM)
  await waitFor(contents, `[...document.querySelectorAll('main a[data-meeting]')].length === 1 && document.querySelector('main a[data-meeting="smoke-5"] [data-search-snippet]')`)
  const inNotes = await evaluate<ListRow[]>(contents, LIST_ROWS)
  await setValue(contents, 'main [data-search]', 'zzqq')
  const empty = await waitFor(contents, `document.querySelector('[data-search-empty]')?.textContent === 'Nada encontrado para "zzqq".'`)
  await evaluate(contents, `document.querySelector('main [data-search]').focus(), true`)
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  const listBack = `document.querySelector('main [data-search]').value === '' && document.querySelectorAll('main a[data-meeting]').length === 6 && !document.querySelector('[data-search-snippet]')`
  const cleared = await waitFor(contents, listBack)
  // Esc com o foco fora do campo também limpa.
  await setValue(contents, 'main [data-search]', 'zzqq')
  await waitFor(contents, `document.querySelector('[data-search-empty]')`)
  await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  const clearedOutside = await waitFor(contents, `${listBack} && document.activeElement !== document.querySelector('main [data-search]')`)
  const row = rows[0]
  return {
    check: {
      ok:
        focused &&
        found &&
        answeredMs >= 200 &&
        rows.length === 1 &&
        row?.id === 'smoke-1' &&
        ['transcrição', 'tempo', 'real'].every((word) => row.marks.includes(word)) &&
        row.snippet.toLowerCase().includes('transcrição em tempo real') &&
        row.snippet.length <= 120 &&
        JSON.stringify(row.markers) === JSON.stringify(['na transcrição']) &&
        inNotes.length === 1 &&
        inNotes[0]?.id === 'smoke-5' &&
        JSON.stringify(inNotes[0].markers) === JSON.stringify(['nas anotações', '2 anotações']) &&
        ['tabela', 'preços'].every((word) => inNotes[0]?.marks.includes(word)) &&
        empty &&
        cleared &&
        clearedOutside,
      detail: `⌘F focou=${focused}; "${TRANSCRIPT_ONLY_TERM}" -> ${rows.length} linha(s) em ${answeredMs} ms: ${JSON.stringify(rows)}; "${NOTES_ONLY_TERM}" -> ${JSON.stringify(inNotes)}; sem resultado=${empty}; Esc limpou no campo=${cleared}, fora do campo=${clearedOutside}`,
    },
    shot,
  }
}

/** Pasta pessoal do smoke, dentro do `userData` temporário: o smoke nunca escreve em ~/Documents. */
const smokeHome = (ctx: SmokeContext): string => join(ctx.userDataDir, 'home')
const defaultMeetingFolder = (ctx: SmokeContext): string => join(smokeHome(ctx), 'Documents', DEFAULT_FOLDER_NAME)

function folderFiles(dir: string): { name: string; size: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, size: statSync(join(dir, name)).size }))
}

/** Áudio de uma gravação do smoke com o título padrão ("Reunião de DD/MM HH:mm", sem barra nem dois-pontos). */
const SMOKE_AUDIO_FILE = /^\d{4}-\d{2}-\d{2} \d{2}h\d{2} - Reunião de \d{2}-\d{2} \d{2}-\d{2}\.(m4a|webm)$/

type AudioProbe = { chunks: number; bytes: number; ok: boolean } | null
const audioProbe = (contents: WebContents): Promise<AudioProbe> => evaluate<AudioProbe>(contents, `${probeJs('audioFile()')} ?? null`)

/**
 * Formato que o `MediaRecorder` deste Electron aceita e o tamanho real do arquivo (contrato 07, CA3):
 * 4 s de dois tons misturados num destino mono a 64 kbps, a mesma montagem de `audio/mixer.ts`. Só
 * mede; nada vai para o disco (o fluxo da gravação usa o gravador falso).
 */
async function recorderFormat(contents: WebContents): Promise<Check & { measured: Record<string, unknown> }> {
  const measured = await evaluate<{ supported: string[]; mime: string | null; recorderMime: string; bytes: number; chunks: number; ms: number; head: string; error: string }>(
    contents,
    `(async () => {
      const types = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      const supported = types.filter((type) => MediaRecorder.isTypeSupported(type))
      const mime = supported[0] ?? null
      const out = { supported, mime, recorderMime: '', bytes: 0, chunks: 0, ms: 0, head: '', error: '' }
      if (!mime) return out
      try {
        const context = new AudioContext()
        const destination = context.createMediaStreamDestination()
        destination.channelCount = 1
        destination.channelCountMode = 'explicit'
        destination.channelInterpretation = 'speakers'
        const gain = context.createGain()
        gain.gain.value = 0.2
        for (const frequency of [220, 330]) {
          const tone = context.createOscillator()
          tone.frequency.value = frequency
          tone.connect(gain)
          tone.start()
        }
        gain.connect(destination)
        await context.resume()
        const recorder = new MediaRecorder(destination.stream, { mimeType: mime, audioBitsPerSecond: 64000 })
        out.recorderMime = recorder.mimeType
        const pending = []
        recorder.ondataavailable = (event) => {
          out.bytes += event.data.size
          out.chunks++
          if (out.chunks === 1) pending.push(event.data.slice(0, 12).arrayBuffer().then((buffer) => { out.head = String.fromCharCode(...new Uint8Array(buffer).slice(4, 8)) }))
        }
        const started = performance.now()
        recorder.start(1000)
        await new Promise((resolve) => setTimeout(resolve, 4000))
        await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop() })
        out.ms = Math.round(performance.now() - started)
        await Promise.all(pending)
        await context.close()
      } catch (error) { out.error = String(error) }
      return out
    })()`,
  )
  const kbps = measured.ms ? Math.round((measured.bytes * 8) / measured.ms) : 0
  const mbPerHour = Math.round(((measured.bytes / Math.max(1, measured.ms)) * 3_600_000) / 1_000_000)
  return {
    ok: measured.mime !== null && measured.bytes > 0 && measured.chunks >= 3 && !measured.error,
    detail: `aceitos: [${measured.supported.join(', ')}]; escolhido ${measured.mime} (gravador: ${measured.recorderMime}, caixa "${measured.head}"); ${measured.bytes} bytes em ${measured.ms} ms e ${measured.chunks} pedaços = ~${kbps} kbps, ~${mbPerHour} MB por hora${measured.error ? `; erro ${measured.error}` : ''}`,
    measured: { ...measured, kbps, mbPerHour },
  }
}

/** Contrato 07, CA9 e CA4: marcador "Gravando áudio" e o `.part` crescendo em pedaços na pasta. */
async function audioWhileRecording(contents: WebContents, folder: string): Promise<Check> {
  const marker = await text(contents, '[data-audio-marker]')
  const probe = await audioProbe(contents)
  const files = folderFiles(folder)
  const part = files[0]
  return {
    ok: marker === 'Gravando áudio' && files.length === 1 && part !== undefined && /\.(m4a|webm)\.part$/.test(part.name) && part.size > 0 && (probe?.chunks ?? 0) >= 2,
    detail: `marcador "${marker}"; pasta ${JSON.stringify(files)}; gravador ${JSON.stringify(probe)}`,
  }
}

/**
 * Contrato 07, CA6, CA6b e CA10 depois de "Encerrar": o `.part` virou o arquivo final com todos os
 * pedaços, o `.md` ao lado tem o texto do "Exportar" da transcrição salva, os caminhos estão na reunião e
 * o detalhe mostra "Áudio" e "Transcrição" com Abrir e Mostrar no Finder.
 */
async function audioAfterEnd(win: BrowserWindow, ctx: SmokeContext, record: Meeting | undefined): Promise<{ saved: Check; detail: Check; shot: Screenshot }> {
  const contents = win.webContents
  const folder = defaultMeetingFolder(ctx)
  // O resumo (contrato 08) também vai para a pasta; aqui contam só o áudio e a transcrição do contrato 07.
  const files = folderFiles(folder).filter((file) => !file.name.endsWith(SUMMARY_FILE_SUFFIX))
  const probe = await audioProbe(contents)
  const audio = files.find((file) => SMOKE_AUDIO_FILE.test(file.name))
  const md = files.find((file) => file.name.endsWith('.md'))
  const transcriptFile = record ? join(ctx.userDataDir, 'meetings', `${record.id}.json`) : ''
  const document = transcriptFile && existsSync(transcriptFile) ? (JSON.parse(readFileSync(transcriptFile, 'utf8')) as TranscriptDocument) : null
  const mdText = md ? readFileSync(join(folder, md.name), 'utf8') : ''
  // Contrato 13, CA7: as anotações da gravação fecham o `.md`.
  const notes = readNotesFile(ctx.userDataDir, record?.id)?.notes ?? []
  // Contrato 19: e a seção "## Perguntas em aberto" da última análise da gravação.
  const analyses = readAnalyses(ctx.userDataDir, record?.id)
  const expected = record && document ? transcriptMarkdown(record, document, notes, analyses) : null
  const saved: Check = {
    ok:
      files.length === 2 &&
      audio !== undefined &&
      md !== undefined &&
      probe?.ok === true &&
      audio.size === probe.bytes &&
      md.name === audio.name.replace(/\.(m4a|webm)$/, '.md') &&
      mdText === expected &&
      mdText.includes(ECHO_PHRASE) &&
      mdText.includes(`\n## Anotações\n\n- [`) &&
      mdText.includes(SMOKE_NOTE_EDITED) &&
      mdText.includes('\n## Perguntas em aberto\n') &&
      record?.audioPath === join(folder, audio.name) &&
      record.transcriptPath === join(folder, md.name),
    detail: `pasta ${JSON.stringify(files)}; gravador ${JSON.stringify(probe)}; .md igual ao "Exportar"=${mdText === expected} (${mdText.split('\n').length} linhas, ${notes.length} anotações, seção "## Anotações"=${mdText.includes('\n## Anotações\n')}); reunião audioPath=${record?.audioPath ? basename(record.audioPath) : null}, transcriptPath=${record?.transcriptPath ? basename(record.transcriptPath) : null}`,
  }

  // Os arquivos ficam na aba "Áudio" (contrato 08).
  await clickSelector(contents, '[data-tab="audio"]')
  await waitFor(contents, `document.querySelector('[data-file="audio"][data-exists="true"]') && document.querySelector('[data-file="transcript"][data-exists="true"]')`)
  const rows = await evaluate<{ kind: string; label: string; name: string }[]>(
    contents,
    `[...document.querySelectorAll('[data-meeting-files] li')].map((li) => ({ kind: li.dataset.file, label: li.querySelector('span')?.textContent ?? '', name: li.querySelector('[data-file-name]')?.textContent ?? '' }))`,
  )
  const openedBefore = ctx.fixtures.openedFiles.length
  await clickSelector(contents, '[data-action="open-audio"]')
  await clickSelector(contents, '[data-action="reveal-transcript"]')
  for (let attempt = 0; attempt < 40 && ctx.fixtures.openedFiles.length < openedBefore + 2; attempt++) await wait(50)
  const opened = ctx.fixtures.openedFiles.slice(openedBefore)
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'detalhe-arquivos-light')
  const detail: Check = {
    ok:
      rows.length === 2 &&
      rows[0]?.label === 'Áudio' &&
      rows[0].name === audio?.name &&
      rows[1]?.label === 'Transcrição' &&
      rows[1].name === md?.name &&
      opened.length === 2 &&
      opened[0]?.action === 'open' &&
      opened[0].path === record?.audioPath &&
      opened[1]?.action === 'reveal' &&
      opened[1].path === record?.transcriptPath,
    detail: `linhas ${JSON.stringify(rows)}; Abrir/Mostrar no Finder -> ${JSON.stringify(opened.map((item) => ({ action: item.action, file: basename(item.path) })))}`,
  }
  return { saved, detail, shot }
}

/** Medidas do resumo com o `claude` falso, para o relatório (contrato 08, notas do coordenador). */
interface SummaryMeasured {
  /** Do clique em "Encerrar" até o resumo aparecer na aba. */
  elapsedMs: number
  /** Caracteres que foram pelo stdin (pedido + transcrição). */
  promptChars: number
  segments: number
  /** O `claude` falso informa US$ 0; o real cobra da assinatura, nominal. */
  costUsdNominal: number
}

/**
 * Contrato 08, CA4, CA5, CA6, CA8 e CA10 depois de "Encerrar": o resumo é gerado sozinho (uma execução do
 * `claude` falso, com o isolamento do contrato 05 e a transcrição só no stdin), o detalhe abre na aba
 * "Resumo" com as três seções e o rodapé, `meetings/<id>.summary.json` vale pelo esquema e a pasta
 * ganha `<nome> - resumo.md` com o mesmo Markdown do "Copiar resumo".
 */
async function summaryAfterEnd(win: BrowserWindow, ctx: SmokeContext, record: Meeting | undefined, endedAt: number, copy: boolean): Promise<{ check: Check; measured: SummaryMeasured }> {
  const contents = win.webContents
  const ready = await waitFor(
    contents,
    `document.querySelector('[data-tab="resumo"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-summary="ready"] [data-summary-footer]')`,
    15_000,
  )
  const elapsedMs = Date.now() - endedAt
  const file = record ? join(ctx.userDataDir, 'meetings', `${record.id}.summary.json`) : ''
  const summary = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as MeetingSummary) : null
  const transcriptFile = record ? join(ctx.userDataDir, 'meetings', `${record.id}.json`) : ''
  const document = transcriptFile && existsSync(transcriptFile) ? (JSON.parse(readFileSync(transcriptFile, 'utf8')) as TranscriptDocument) : null
  const lines = document ? summaryLines(document) : []
  const target = record ? summaryFileTarget(record) : null
  const folderPath = target ? join(target.folder, target.name) : ''
  // A cópia na pasta é escrita logo depois do `summary.json`.
  for (let attempt = 0; attempt < 40 && folderPath && !existsSync(folderPath); attempt++) await wait(50)
  const folderText = folderPath && existsSync(folderPath) ? readFileSync(folderPath, 'utf8') : ''
  // Contrato 19: com análise da gravação, o Markdown do resumo ganha "## Perguntas em aberto".
  const analyses = readAnalyses(ctx.userDataDir, record?.id)
  const expected = record && summary ? summaryMarkdown(record, summary, analyses) : null
  const screen = await evaluate<{ tabs: string[]; sections: string[]; decisions: number; rows: string[][]; footer: string; buttons: string[] }>(
    contents,
    `({
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
      sections: [...document.querySelectorAll('[data-summary] h2')].map((h) => h.textContent),
      decisions: document.querySelectorAll('[data-summary-decisions] li').length,
      rows: [...document.querySelectorAll('[data-summary-tasks] tr')].map((tr) => [...tr.children].map((cell) => cell.textContent)),
      footer: document.querySelector('[data-summary-footer]')?.textContent ?? '',
      buttons: [...document.querySelectorAll('[data-summary] button')].map((button) => button.textContent),
    })`,
  )
  const spawn = [...ctx.fixtures.claudeSpawns].reverse().find((item) => item.args[item.args.indexOf('--output-format') + 1] === 'json')
  const spawnArgs = spawn?.args ?? []
  const leaked = lines.some((line) => spawnArgs.some((arg) => arg.includes(line.slice(line.indexOf(': ') + 2, line.indexOf(': ') + 30))))

  let copied = ''
  if (copy) {
    const before = ctx.fixtures.copiedTexts.length
    await clickSelector(contents, '[data-action="copy-summary"]')
    for (let attempt = 0; attempt < 40 && ctx.fixtures.copiedTexts.length === before; attempt++) await wait(50)
    copied = ctx.fixtures.copiedTexts.at(-1) ?? ''
  }
  const check: Check = {
    ok:
      ready &&
      summary !== null &&
      summary.meetingId === record?.id &&
      summary.model === 'claude-cli:haiku' &&
      summary.tasks.length === 2 &&
      JSON.stringify(screen.tabs) === JSON.stringify(['Resumo', 'Anotações', 'Perguntar', 'Transcrição', 'Áudio']) &&
      JSON.stringify(screen.sections) === JSON.stringify(['O que aconteceu', 'Decisões', 'Tarefas']) &&
      screen.decisions === summary.decisions.length &&
      JSON.stringify(screen.rows[0]) === JSON.stringify(['Tarefa', 'Quem', 'Prazo']) &&
      screen.rows.length === 3 &&
      screen.rows[2]?.[2] === '—' &&
      screen.footer.startsWith('Gerado pelo Claude em ') &&
      screen.footer.endsWith('· claude-cli:haiku') &&
      screen.buttons.includes('Copiar resumo') &&
      screen.buttons.includes('Gerar de novo') &&
      folderText !== '' &&
      folderText === expected &&
      analyses.length > 0 &&
      folderText.includes('\n## Perguntas em aberto\n') &&
      (!copy || copied === expected) &&
      spawn !== undefined &&
      spawn.cwd === join(ctx.userDataDir, 'claude-cwd') &&
      spawnArgs.includes('--strict-mcp-config') &&
      spawnArgs[spawnArgs.indexOf('--setting-sources') + 1] === '' &&
      spawnArgs[spawnArgs.indexOf('--tools') + 1] === '' &&
      !spawn.envNames.some((name) => name.startsWith('ELECTRON') || name.includes('ASSEMBLYAI')) &&
      !leaked,
    detail: `pronto=${ready} em ${elapsedMs} ms; summary.json ${summary ? `${summary.decisions.length} decisões, ${summary.tasks.length} tarefas, ${summary.model}` : 'ausente'}; abas ${JSON.stringify(screen.tabs)}; seções ${JSON.stringify(screen.sections)}; tarefas ${JSON.stringify(screen.rows)}; rodapé "${screen.footer}"; pasta ${target ? target.name : 'sem arquivo'} igual ao Markdown=${folderText === expected}${copy ? `; "Copiar resumo" igual=${copied === expected}` : ''}; processo ${JSON.stringify(spawn ? { cwd: basename(spawn.cwd), args: spawnArgs.filter((arg) => arg.startsWith('--')), env: spawn.envNames } : null)}; transcrição nos argumentos=${leaked}`,
  }
  return { check, measured: { elapsedMs, promptChars: summaryInput(lines).length, segments: lines.length, costUsdNominal: 0 } }
}

/** Anotações que o smoke cria na gravação (contrato 13, CA9), da primeira para a última. */
const SMOKE_NOTES = [
  { text: 'Confirmar a janela de manutenção com o cliente', color: 'yellow' },
  { text: 'Pedir o plano de volta por escrito', color: 'pink' },
  { text: 'Revisar o custo da réplica', color: 'blue' },
] as const
/** Texto da primeira anotação editado logo antes de "Encerrar", sem esperar nada (CA4). */
const SMOKE_NOTE_EDITED = `${SMOKE_NOTES[0].text} até sexta`
const NOTE_CARDS = `[...document.querySelectorAll('[data-notes-panel] [data-note]')].map((card) => ({ id: card.dataset.note, color: card.dataset.color, text: card.querySelector('[data-note-text]')?.value ?? '', time: card.querySelector('[data-note-time]')?.textContent ?? '' }))`

interface NoteCard {
  id: string
  color: string
  text: string
  time: string
}

/**
 * Contrato 13, CA3 e CA9, na gravação: o painel abre por ⌘⇧N (claro) ou pelo botão "Anotações" (escuro) à
 * direita da transcrição, que continua na tela; três anotações novas nascem amarelas, em edição e com o
 * tempo da gravação; cada uma ganha texto e uma cor; excluir mostra "Desfazer", que a traz de volta no
 * mesmo lugar. Fotografa `gravacao-anotacoes-<tema>` (pela `shoot`, depois de voltar).
 */
async function notesWhileRecording(contents: WebContents, byShortcut: boolean): Promise<Check> {
  if (byShortcut) {
    await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['meta', 'shift'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['meta', 'shift'] })
  } else {
    await clickSelector(contents, '[data-action="toggle-notes"]')
  }
  const opened = await waitFor(contents, `document.querySelector('[data-notes-panel]') && document.querySelector('[data-action="toggle-notes"]')?.getAttribute('aria-pressed') === 'true'`)
  const layout = await evaluate<{ panel: number; transcript: number; segments: number }>(
    contents,
    `({ panel: document.querySelector('[data-notes-panel]')?.getBoundingClientRect().width ?? 0, transcript: document.querySelector('[data-transcript-scroll]')?.getBoundingClientRect().width ?? 0, segments: document.querySelectorAll('[data-transcript-list] li').length })`,
  )
  const born: { color: string; focused: boolean; time: string }[] = []
  for (const [index, wanted] of SMOKE_NOTES.entries()) {
    await clickSelector(contents, '[data-notes-panel] [data-action="new-note"]')
    await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === ${index + 1} && document.activeElement?.matches('[data-notes-panel] li:first-child [data-note-text]')`)
    const first = await evaluate<NoteCard[]>(contents, NOTE_CARDS)
    born.push({
      color: first[0]?.color ?? '',
      focused: await evaluate<boolean>(contents, `document.activeElement?.matches('[data-notes-panel] li:first-child [data-note-text]') === true`),
      time: first[0]?.time ?? '',
    })
    await setValue(contents, '[data-notes-panel] li:first-child [data-note-text]', wanted.text)
    if (wanted.color !== 'yellow') await clickSelector(contents, `[data-notes-panel] li:first-child [data-note-color="${wanted.color}"]`)
  }
  const created = await evaluate<NoteCard[]>(contents, NOTE_CARDS)
  // Exclui a do meio e desfaz.
  await clickSelector(contents, '[data-notes-panel] li:nth-child(2) [data-action="delete-note"]')
  const deleted = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 2 && document.querySelector('[data-notes-panel] [data-action="undo-delete-note"]')`)
  // O foco vai para o card seguinte (o que era o terceiro).
  const focusNext = await waitFor(contents, `document.activeElement?.closest('[data-note]')?.dataset.note === ${JSON.stringify(created[2]?.id ?? '-')}`, 1000)
  await clickSelector(contents, '[data-notes-panel] [data-action="undo-delete-note"]')
  const restored = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 3 && !document.querySelector('[data-notes-panel] [data-action="undo-delete-note"]')`)
  const after = await evaluate<NoteCard[]>(contents, NOTE_CARDS)
  // A barra de controles não cobre nenhum card: rolado até o fim, o último termina acima dela.
  const clearance = await evaluate<number>(
    contents,
    `(() => { const scroll = document.querySelector('[data-notes-panel] .overflow-y-auto'); if (scroll) scroll.scrollTop = scroll.scrollHeight; const last = [...document.querySelectorAll('[data-notes-panel] [data-note]')].at(-1)?.getBoundingClientRect(); const bar = document.querySelector('[role="toolbar"]')?.getBoundingClientRect(); return last && bar ? bar.top - last.bottom : -1 })()`,
  )
  await evaluate(contents, `(() => { const scroll = document.querySelector('[data-notes-panel] .overflow-y-auto'); if (scroll) scroll.scrollTop = 0; return true })()`)
  const labels = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-notes-panel] [data-action="delete-note"]')].map((b) => b.getAttribute('aria-label'))`)
  const swatches = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-notes-panel] li:first-child [data-note-color]')].map((b) => b.getAttribute('aria-label') + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''))`)
  const expectedOrder = [...SMOKE_NOTES].reverse()
  return {
    ok:
      opened &&
      layout.panel >= 300 &&
      layout.panel <= 340 &&
      layout.transcript > 0 &&
      layout.segments > 0 &&
      born.every((note) => note.color === 'yellow' && note.focused && /^\d{2}:\d{2}$/.test(note.time)) &&
      JSON.stringify(created.map((note) => [note.text, note.color])) === JSON.stringify(expectedOrder.map((note) => [note.text, note.color])) &&
      deleted &&
      focusNext &&
      restored &&
      clearance >= 0 &&
      JSON.stringify(labels) === JSON.stringify(['Excluir anotação 1', 'Excluir anotação 2', 'Excluir anotação 3']) &&
      JSON.stringify(after.map((note) => note.id)) === JSON.stringify(created.map((note) => note.id)) &&
      JSON.stringify(swatches) === JSON.stringify(['Amarelo', 'Rosa', 'Verde', 'Azul*', 'Roxo', 'Laranja']),
    detail: `painel aberto=${opened} (${byShortcut ? '⌘⇧N' : 'botão'}), ${Math.round(layout.panel)} px, transcrição ${Math.round(layout.transcript)} px com ${layout.segments} trechos; ao nascer ${JSON.stringify(born)}; cards ${JSON.stringify(created.map((note) => [note.text, note.color, note.time]))}; excluir=${deleted} (foco no seguinte=${focusNext}), desfazer=${restored} na mesma ordem=${JSON.stringify(after.map((note) => note.id)) === JSON.stringify(created.map((note) => note.id))}; cores ${JSON.stringify(swatches)}; barra ${Math.round(clearance)} px abaixo do último card; rótulos ${JSON.stringify(labels)}`,
  }
}

/** Análises gravadas em `meetings/<id>.analyses.json` (contrato 19), ou lista vazia. */
function readAnalyses(userDataDir: string, meetingId: string | undefined): MeetingAnalysis[] {
  const file = meetingId ? join(userDataDir, 'meetings', `${meetingId}.analyses.json`) : ''
  return file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as MeetingAnalysesFile).analyses : []
}

const ANALYSIS_SECTIONS = ['Perguntas em aberto', 'Não ficou claro', 'Para confirmar', 'Perguntas para fazer agora']
const ANALYZE_BUTTON = `document.querySelector('[data-action="analyze-now"]')`
const ANALYSIS_BLOCK = (index: number): string => `document.querySelectorAll('[data-notes-panel] [data-analysis]')[${index}]`

/** Seções, cabeçalho e rodapé de um bloco de análise do painel. */
async function analysisBlockView(contents: WebContents, index: number): Promise<{ sections: string[]; until: string; footer: string; expanded: string; answered: number }> {
  return evaluate(
    contents,
    `(() => {
      const block = ${ANALYSIS_BLOCK(index)}
      return {
        sections: [...(block?.querySelectorAll('[data-analysis-section] h3') ?? [])].map((h) => h.textContent),
        until: block?.querySelector('[data-analysis-until]')?.textContent ?? '',
        footer: block?.querySelector('[data-analysis-footer]')?.textContent ?? '',
        expanded: block?.dataset.expanded ?? '',
        answered: block?.querySelectorAll('[data-analysis-item][data-answered]').length ?? 0,
      }
    })()`,
  )
}

/** Medidas da análise para o `report.json`. */
interface AnalysisMeasured {
  /** Do clique ao bloco na tela (o `claude` falso espera 1,5 s). */
  elapsedMs: number
  /** Tradução pedida enquanto a análise gerava: quanto levou (ms). */
  translationMs: number
  /** Quadros da captura contados enquanto a análise gerava. */
  framesWhileAnalyzing: number
}

/**
 * Contrato 19, CA3, CA4, CA7 e CA8, na gravação: "Analisar até agora" (clique no claro, ⌘⇧A no escuro) abre
 * a aba "Análise" com "Analisando…" e o botão travado; enquanto o `claude` falso gera, a captura conta
 * quadros, o cronômetro anda e uma tradução vai e volta; o bloco chega com as quatro seções, "Até mm:ss" e o
 * rodapé com modelo, tempo e custo. No claro também: "Virar anotação" cria o card amarelo com o texto e o
 * tempo (e o card é excluído para o resto do smoke seguir com as três anotações dele), "Copiar", o tempo que
 * rola a transcrição e uma segunda análise que leva a anterior no pedido e risca o item respondido. Fotografa
 * `gravacao-analise-<tema>` e volta à aba "Anotações".
 */
async function analysisWhileRecording(win: BrowserWindow, ctx: SmokeContext, themeName: string, full: boolean): Promise<{ check: Check; shot: Screenshot; measured: AnalysisMeasured }> {
  const contents = win.webContents
  const enabled = await evaluate<boolean>(contents, `${ANALYZE_BUTTON}?.disabled === false && ${ANALYZE_BUTTON}?.getAttribute('aria-keyshortcuts') === 'Meta+Shift+A'`)
  const spawnsBefore = ctx.fixtures.claudeSpawns.length
  const framesBefore = await frameCounts(contents)
  const timerBefore = await evaluate<string>(contents, TIMER)
  const clickedAt = Date.now()
  if (full) await clickSelector(contents, '[data-action="analyze-now"]')
  else {
    await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['meta', 'shift'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['meta', 'shift'] })
  }
  const busy = await waitFor(
    contents,
    `document.querySelector('[data-notes-panel]')?.dataset.panelTab === 'analise' && document.querySelector('[data-analysis-busy]') && ${ANALYZE_BUTTON}?.textContent.includes('Analisando…') && ${ANALYZE_BUTTON}?.disabled`,
  )
  // A tradução não espera a análise: um trecho vai e volta pelo mesmo canal da gravação enquanto ela gera.
  const during = await evaluate<{ ok: boolean; ms: number; stillBusy: boolean }>(
    contents,
    `(async () => {
      const t0 = performance.now()
      const result = await window.__scribeApi.invoke('scribe:translate-turn', { text: 'Vamos fechar a janela no sábado.', source: 'pt', target: 'en', model: ${JSON.stringify(DEFAULT_SETTINGS.translationModel)} })
      return { ok: result?.ok === true, ms: Math.round(performance.now() - t0), stillBusy: Boolean(document.querySelector('[data-analysis-busy]')) }
    })()`,
  )
  // O cronômetro anda (vira o segundo) enquanto a análise gera.
  await waitFor(contents, `(${TIMER}) !== ${JSON.stringify(timerBefore)}`, 1100)
  const framesDuring = await frameCounts(contents)
  const phaseDuring = (await captureState(contents))?.phase
  const timerDuring = await evaluate<string>(contents, TIMER)
  const stillBusy = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-analysis-busy]'))`)
  const done = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-analysis]').length === 1 && !document.querySelector('[data-analysis-busy]')`, 15_000)
  const elapsedMs = Date.now() - clickedAt
  const first = await analysisBlockView(contents, 0)
  const spawn = ctx.fixtures.claudeSpawns.slice(spawnsBefore).find((item) => (item.args[item.args.indexOf('--system-prompt') + 1] ?? '').startsWith('Você analisa'))
  const spawnArgs = spawn?.args ?? []
  const firstOk =
    enabled &&
    busy &&
    during.ok &&
    during.stillBusy &&
    stillBusy &&
    phaseDuring === 'recording' &&
    (framesDuring?.mic ?? 0) > (framesBefore?.mic ?? 0) &&
    timerDuring !== timerBefore &&
    done &&
    JSON.stringify(first.sections) === JSON.stringify(ANALYSIS_SECTIONS) &&
    /^Até \d{2}:\d{2}$/.test(first.until) &&
    first.footer.includes('Haiku') &&
    first.footer.includes('US$') &&
    spawn !== undefined &&
    spawn.cwd === join(ctx.userDataDir, 'claude-cwd') &&
    spawnArgs[spawnArgs.indexOf('--output-format') + 1] === 'json' &&
    spawnArgs[spawnArgs.indexOf('--tools') + 1] === '' &&
    spawnArgs.includes('--strict-mcp-config')
  let detail = `botão pronto=${enabled}; ${full ? 'clique' : '⌘⇧A'} -> aba Análise com "Analisando…" e travado=${busy}; tradução durante=${during.ok} em ${during.ms} ms com a análise ainda gerando=${during.stillBusy}; captura ${phaseDuring}, quadros ${framesBefore?.mic ?? '?'} -> ${framesDuring?.mic ?? '?'}, cronômetro ${timerBefore} -> ${timerDuring}; bloco em ${elapsedMs} ms=${done}: "${first.until}", seções ${JSON.stringify(first.sections)}, rodapé "${first.footer}"; processo ${JSON.stringify(spawn ? { cwd: basename(spawn.cwd), args: spawnArgs.filter((arg) => arg.startsWith('--')) } : null)}`
  let fullOk = true

  if (full) {
    // "Virar anotação" do primeiro item: card amarelo com o texto e o tempo dele.
    const item = await evaluate<{ text: string; time: string }>(
      contents,
      `(() => { const li = ${ANALYSIS_BLOCK(0)}?.querySelector('[data-analysis-section="openQuestions"] [data-analysis-item]'); return { text: li?.querySelector('p')?.lastChild?.textContent ?? '', time: li?.querySelector('[data-action="analysis-jump"]')?.textContent ?? '' } })()`,
    )
    await clickSelector(contents, `[data-notes-panel] [data-analysis-section="openQuestions"] [data-action="analysis-to-note"]`)
    const marked = await waitFor(contents, `${ANALYSIS_BLOCK(0)}?.querySelector('[data-action="analysis-to-note"]')?.textContent.includes('Virou anotação')`)
    await clickSelector(contents, '[data-notes-panel] [data-tab="anotacoes"]')
    await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 4`)
    const card = (await evaluate<NoteCard[]>(contents, NOTE_CARDS))[0]
    const noted = card !== undefined && card.text === item.text && card.color === 'yellow' && card.time === item.time
    // O card sai: o resto do smoke confere as três anotações dele.
    await clickSelector(contents, '[data-notes-panel] li:first-child [data-action="delete-note"]')
    const removed = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 3`)
    await clickSelector(contents, '[data-notes-panel] [data-tab="analise"]')
    await waitFor(contents, `document.querySelector('[data-notes-panel] [data-analysis]')`)
    // "Copiar" e o tempo que rola a transcrição.
    const copiedBefore = ctx.fixtures.copiedTexts.length
    await clickSelector(contents, '[data-notes-panel] [data-analysis-section="openQuestions"] [data-action="analysis-copy"]')
    for (let attempt = 0; attempt < 40 && ctx.fixtures.copiedTexts.length === copiedBefore; attempt++) await wait(50)
    const copied = ctx.fixtures.copiedTexts.at(-1) === item.text
    await clickSelector(contents, '[data-notes-panel] [data-action="analysis-jump"]')
    const jumped = await waitFor(contents, `document.querySelector('[data-transcript-list] [data-jump-target]')`)
    // Segunda análise: a anterior vai no pedido e o item respondido aparece riscado nela.
    await clickSelector(contents, '[data-action="analyze-now"]')
    const second = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-analysis]').length === 2 && !document.querySelector('[data-analysis-busy]')`, 15_000)
    const collapsed = await analysisBlockView(contents, 1)
    await evaluate(contents, `${ANALYSIS_BLOCK(1)}?.querySelector('[data-action="toggle-analysis"]')?.click() ?? true`)
    await waitFor(contents, `${ANALYSIS_BLOCK(1)}?.dataset.expanded === 'true'`)
    const older = await analysisBlockView(contents, 1)
    const newest = await analysisBlockView(contents, 0)
    fullOk = marked && noted && removed && copied && jumped && second && newest.expanded === 'true' && collapsed.expanded === 'false' && older.answered === 1 && newest.answered === 0
    detail += `; "Virar anotação" -> marcado=${marked}, card ${JSON.stringify(card)} igual ao item ${JSON.stringify(item)}=${noted}, excluído=${removed}; "Copiar"=${copied}; tempo -> transcrição=${jumped}; segunda análise=${second}, mais nova aberta=${newest.expanded}, anterior recolhida=${collapsed.expanded} e com ${older.answered} item riscado`
  }
  await settle(contents)
  const shot = await capture(win, ctx.outDir, `gravacao-analise-${themeName}`)
  // De volta às anotações: o passo seguinte edita um card.
  await clickSelector(contents, '[data-notes-panel] [data-tab="anotacoes"]')
  await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 3`)
  return { check: { ok: firstOk && fullOk, detail }, shot, measured: { elapsedMs, translationMs: during.ms, framesWhileAnalyzing: (framesDuring?.mic ?? 0) - (framesBefore?.mic ?? 0) } }
}

/**
 * Contrato 19, CA5, CA6 e CA8, depois de "Encerrar" (tema claro): `analyses.json` com as duas análises da
 * gravação, a seção "Perguntas em aberto" na aba "Resumo" com a última, o "Copiar resumo" com a seção e
 * "Analisar a reunião inteira" gerando e salvando uma terceira. Fotografa `detalhe-perguntas-abertas-light`.
 */
async function analysisDetailCheck(win: BrowserWindow, ctx: SmokeContext, record: Meeting | undefined): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const saved = readAnalyses(ctx.userDataDir, record?.id)
  await clickSelector(contents, '[data-tab="resumo"]')
  const shown = await waitFor(contents, `document.querySelector('[data-open-questions]')?.dataset.openQuestions === ${JSON.stringify(saved.at(-1)?.id ?? '-')}`)
  const sections = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-open-questions] [data-analysis-section] h3')].map((h) => h.textContent)`)
  // Só a coluna da aba rola (o `scrollIntoView` arrastaria a janela inteira).
  await evaluate(
    contents,
    `(() => { const scroll = document.querySelector('[data-summary-scroll]'); const section = document.querySelector('[data-open-questions]'); if (scroll && section) scroll.scrollTop += section.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24; return true })()`,
  )
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'detalhe-perguntas-abertas-light')
  const copiedBefore = ctx.fixtures.copiedTexts.length
  await clickSelector(contents, '[data-action="copy-summary"]')
  for (let attempt = 0; attempt < 40 && ctx.fixtures.copiedTexts.length === copiedBefore; attempt++) await wait(50)
  const copied = ctx.fixtures.copiedTexts.at(-1) ?? ''
  await clickSelector(contents, '[data-action="analyze-meeting"]')
  const busy = await waitFor(contents, `document.querySelector('[data-action="analyze-meeting"]')?.textContent.includes('Analisando…')`)
  const done = await waitFor(contents, `!document.querySelector('[data-action="analyze-meeting"]')?.textContent.includes('Analisando…') && document.querySelector('[data-open-questions]')?.dataset.openQuestions !== ${JSON.stringify(saved.at(-1)?.id ?? '-')}`, 15_000)
  const after = readAnalyses(ctx.userDataDir, record?.id)
  const whole = after.at(-1)
  // "Até mm:ss" é o fim do último trecho lido: nenhum item cita um tempo depois dele.
  const transcriptFile = record ? join(ctx.userDataDir, 'meetings', `${record.id}.json`) : ''
  const segments = transcriptFile && existsSync(transcriptFile) ? (JSON.parse(readFileSync(transcriptFile, 'utf8')) as TranscriptDocument).segments : []
  const itemsInside = after.every((analysis) => [...analysis.openQuestions, ...analysis.unclearTopics].every((item) => item.atMs === undefined || item.atMs <= analysis.atMs))
  return {
    check: {
      ok:
        saved.length === 2 &&
        saved.every((analysis) => analysis.meetingId === record?.id) &&
        (saved[1]?.answered.length ?? 0) === 1 &&
        shown &&
        JSON.stringify(sections) === JSON.stringify(ANALYSIS_SECTIONS) &&
        copied.includes('\n## Perguntas em aberto\n') &&
        busy &&
        done &&
        after.length === 3 &&
        whole !== undefined &&
        whole.meetingId === record?.id &&
        whole.atMs === analyzedUntil(segments) &&
        itemsInside,
      detail: `analyses.json ${JSON.stringify(saved.map((analysis) => ({ id: analysis.id, atMs: analysis.atMs, respondidos: analysis.answered.length })))}; seção na aba Resumo=${shown} com ${JSON.stringify(sections)}; "Copiar resumo" com a seção=${copied.includes('## Perguntas em aberto')}; "Analisar a reunião inteira" -> gerando=${busy}, pronta=${done}, ${after.length} no arquivo, a nova até ${whole?.atMs ?? '?'} ms (fim do último trecho ${analyzedUntil(segments)}); itens dentro do "Até"=${itemsInside}`,
    },
    shot,
  }
}

/** Notas gravadas em `meetings/<id>.notes.json`, ou `null` se o arquivo não existe. */
function readNotesFile(userDataDir: string, meetingId: string | undefined): MeetingNotesFile | null {
  const file = meetingId ? join(userDataDir, 'meetings', `${meetingId}.notes.json`) : ''
  return file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as MeetingNotesFile) : null
}

/**
 * Contrato 13, CA4, CA5 e CA9, depois de "Encerrar": `notes.json` com as três anotações (a editada na hora
 * do clique, com o texto novo), tempos da gravação e cores; a aba "Anotações" entre "Resumo" e
 * "Transcrição", em grade, com "Copiar anotações"; clicar no tempo de um card abre a "Transcrição" no
 * trecho mais próximo. Fotografa `detalhe-anotacoes-<tema>` (pela `shoot`).
 */
async function notesAfterEnd(contents: WebContents, ctx: SmokeContext, record: Meeting | undefined, shoot: () => Promise<void>, edit: boolean): Promise<Check> {
  const saved = readNotesFile(ctx.userDataDir, record?.id)
  const notes = saved?.notes ?? []
  const expectedFile = [...SMOKE_NOTES].reverse().map((note, i) => [i === 2 ? SMOKE_NOTE_EDITED : note.text, note.color])
  await clickSelector(contents, '[data-tab="anotacoes"]')
  const shown = await waitFor(contents, `document.querySelectorAll('[data-notes="grid"] [data-note]').length === 3`)
  const screen = await evaluate<{ tabs: string[]; buttons: string[]; columns: number; times: string[] }>(
    contents,
    `({
      tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
      buttons: [...document.querySelectorAll('[data-notes-tab] > div button')].map((button) => button.textContent),
      columns: getComputedStyle(document.querySelector('[data-notes="grid"]')).gridTemplateColumns.split(' ').length,
      times: [...document.querySelectorAll('[data-notes="grid"] [data-action="note-time"]')].map((b) => b.textContent),
    })`,
  )
  await shoot()
  const edited = edit ? await notesDetailEdits(contents, ctx, record) : { ok: true, detail: 'só no tema claro' }
  // O tempo da anotação mais antiga leva ao trecho mais próximo da transcrição.
  const oldest = notes.at(-1)
  const transcriptFile = record ? join(ctx.userDataDir, 'meetings', `${record.id}.json`) : ''
  const segments = transcriptFile && existsSync(transcriptFile) ? (JSON.parse(readFileSync(transcriptFile, 'utf8')) as TranscriptDocument).segments : []
  const closest = oldest?.atMs != null ? [...segments].sort((a, b) => Math.abs(a.startMs - (oldest.atMs ?? 0)) - Math.abs(b.startMs - (oldest.atMs ?? 0)))[0]?.id : undefined
  await clickSelector(contents, '[data-notes="grid"] li:last-child [data-action="note-time"]')
  const jumped = await waitFor(contents, `document.querySelector('[data-tab="transcricao"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-jump-target]')`)
  const target = await evaluate<{ id: string; visible: boolean }>(
    contents,
    `(() => { const li = document.querySelector('[data-jump-target]'); const box = li?.getBoundingClientRect(); const scroll = document.querySelector('[data-transcript-scroll]')?.getBoundingClientRect(); return { id: li?.dataset.segment ?? '', visible: Boolean(box && scroll && box.top >= scroll.top && box.bottom <= scroll.bottom) } })()`,
  )
  return {
    ok:
      saved?.version === 1 &&
      saved.meetingId === record?.id &&
      JSON.stringify(notes.map((note) => [note.text, note.color])) === JSON.stringify(expectedFile) &&
      notes.every((note) => typeof note.atMs === 'number') &&
      shown &&
      JSON.stringify(screen.tabs) === JSON.stringify(['Resumo', 'Anotações', 'Perguntar', 'Transcrição', 'Áudio']) &&
      screen.buttons.includes('Nova anotação') &&
      screen.buttons.includes('Copiar anotações') &&
      screen.columns >= 2 &&
      screen.columns <= 4 &&
      screen.times.length === 3 &&
      edited.ok &&
      jumped &&
      closest !== undefined &&
      target.id === closest &&
      target.visible,
    detail: `notes.json ${JSON.stringify(notes.map((note) => [note.text, note.color, note.atMs]))}; abas ${JSON.stringify(screen.tabs)}; botões ${JSON.stringify(screen.buttons)}; ${screen.columns} colunas; tempos ${JSON.stringify(screen.times)}; tempo ${oldest?.atMs ?? '?'} ms -> aba Transcrição=${jumped}, trecho ${target.id} (mais próximo ${closest ?? '?'}), visível=${target.visible}; edição no detalhe: ${edited.detail}`,
  }
}

/** Texto da anotação criada no detalhe (contrato 13, CA5). */
const DETAIL_NOTE_TEXT = 'Mandar a ata para o time'

/**
 * Contrato 13, CA5, no tema claro: na aba "Anotações", "+ Nova anotação" cria um card sem tempo com o
 * cursor no texto; o texto vai para o `notes.json` 500 ms depois de parar de digitar; a cor muda; excluir
 * leva o foco ao card seguinte e "Desfazer" o traz de volta; "Copiar anotações" copia o mesmo Markdown do
 * arquivo.
 */
async function notesDetailEdits(contents: WebContents, ctx: SmokeContext, record: Meeting | undefined): Promise<Check> {
  const fileNotes = (): MeetingNote[] => readNotesFile(ctx.userDataDir, record?.id)?.notes ?? []
  const waitFile = async (predicate: (notes: MeetingNote[]) => boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (predicate(fileNotes())) return true
      await wait(50)
    }
    return false
  }
  await clickSelector(contents, '[data-notes-tab] [data-action="new-note"]')
  const created = await waitFor(contents, `document.querySelectorAll('[data-notes="grid"] [data-note]').length === 4 && document.activeElement?.matches('[data-notes="grid"] li:first-child [data-note-text]')`)
  const createdSaved = await waitFile((notes) => notes.length === 4 && notes[0]?.atMs === null)
  await setValue(contents, '[data-notes="grid"] li:first-child [data-note-text]', DETAIL_NOTE_TEXT)
  const typedAt = Date.now()
  const textSaved = await waitFile((notes) => notes[0]?.text === DETAIL_NOTE_TEXT)
  const savedAfterMs = Date.now() - typedAt
  await clickSelector(contents, '[data-notes="grid"] li:first-child [data-note-color="orange"]')
  const colorSaved = await waitFile((notes) => notes[0]?.color === 'orange')
  const newId = fileNotes()[0]?.id ?? ''
  const nextId = fileNotes()[1]?.id ?? ''
  await clickSelector(contents, '[data-notes="grid"] li:first-child [data-action="delete-note"]')
  const deleted = await waitFile((notes) => notes.length === 3 && !notes.some((note) => note.id === newId))
  const focusNext = await waitFor(contents, `document.activeElement?.closest('[data-note]')?.dataset.note === ${JSON.stringify(nextId)}`, 1000)
  await clickSelector(contents, '[data-notes-tab] [data-action="undo-delete-note"]')
  const restored = await waitFile((notes) => notes.length === 4 && notes[0]?.id === newId && notes[0].text === DETAIL_NOTE_TEXT)
  const copiedBefore = ctx.fixtures.copiedTexts.length
  await clickSelector(contents, '[data-action="copy-notes"]')
  for (let attempt = 0; attempt < 40 && ctx.fixtures.copiedTexts.length === copiedBefore; attempt++) await wait(50)
  const copied = ctx.fixtures.copiedTexts.at(-1) ?? ''
  const expected = notesMarkdown(fileNotes())
  return {
    ok: created && createdSaved && textSaved && savedAfterMs >= 400 && colorSaved && deleted && focusNext && restored && copied === expected && copied.endsWith(`- ${DETAIL_NOTE_TEXT}\n`),
    detail: `nova=${created} salva=${createdSaved}; texto salvo em ~${savedAfterMs} ms=${textSaved}; cor=${colorSaved}; excluir=${deleted} (foco no seguinte=${focusNext}); desfazer=${restored}; "Copiar anotações" igual ao arquivo=${copied === expected} (${copied.split('\n').length} linhas)`,
  }
}

/**
 * Contrato 08, CA7, no tema claro: na aba "Áudio", "Baixar áudio…" abre o diálogo de salvar (substituto)
 * com o nome do arquivo e copia o áudio para onde ele "responde"; "Baixar resumo…" escreve o `.md` na
 * hora. Fotografa `detalhe-audio-light`.
 */
async function downloadsCheck(win: BrowserWindow, ctx: SmokeContext, record: Meeting | undefined): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const out = join(ctx.userDataDir, 'baixados')
  mkdirSync(out, { recursive: true })
  const dialogsBefore = ctx.fixtures.saveDialogs.length
  await waitFor(contents, `document.querySelector('[data-action="download-audio"]') && document.querySelector('[data-download="summary"]')`)
  ctx.fixtures.savePath = join(out, 'copia.m4a')
  await clickSelector(contents, '[data-action="download-audio"]')
  const audioSaved = await waitFor(contents, `document.querySelector('[data-action="download-audio"]')?.textContent === 'Salvo'`)
  ctx.fixtures.savePath = join(out, 'resumo.md')
  await clickSelector(contents, '[data-action="download-summary"]')
  const summarySaved = await waitFor(contents, `document.querySelector('[data-action="download-summary"]')?.textContent === 'Salvo'`)
  ctx.fixtures.savePath = null
  const dialogs = ctx.fixtures.saveDialogs.slice(dialogsBefore)
  const audioCopy = existsSync(join(out, 'copia.m4a')) ? statSync(join(out, 'copia.m4a')).size : -1
  const audioSize = record?.audioPath && existsSync(record.audioPath) ? statSync(record.audioPath).size : -2
  const summary = record ? (JSON.parse(readFileSync(join(ctx.userDataDir, 'meetings', `${record.id}.summary.json`), 'utf8')) as MeetingSummary) : null
  const summaryText = existsSync(join(out, 'resumo.md')) ? readFileSync(join(out, 'resumo.md'), 'utf8') : ''
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'detalhe-audio-light')
  const downloads = join(smokeHome(ctx), 'Downloads')
  return {
    check: {
      ok:
        audioSaved &&
        summarySaved &&
        dialogs.length === 2 &&
        record?.audioPath !== null &&
        dialogs[0] === join(downloads, basename(record?.audioPath ?? '')) &&
        dialogs[1] === join(downloads, basename(record?.audioPath ?? '').replace(/\.(m4a|webm)$/, SUMMARY_FILE_SUFFIX)) &&
        audioCopy === audioSize &&
        summary !== null &&
        record !== undefined &&
        summaryText === summaryMarkdown(record, summary, readAnalyses(ctx.userDataDir, record.id)),
      detail: `diálogos ${JSON.stringify(dialogs.map((path) => basename(path)))}; áudio copiado ${audioCopy} de ${audioSize} bytes; resumo baixado igual ao Markdown=${summary && record ? summaryText === summaryMarkdown(record, summary, readAnalyses(ctx.userDataDir, record.id)) : false}`,
    },
    shot,
  }
}

/** Contrato 08, CA3: "Resumir ao encerrar", ligado por padrão, com a ajuda; desligar e religar grava. */
async function summarizeSetting(contents: WebContents, userDataDir: string): Promise<Check> {
  await openSettingsTab(contents, 'claude')
  await waitFor(contents, `document.querySelector('[aria-labelledby="settings-summarize"]')`)
  const row = await evaluate<string>(contents, `document.querySelector('#settings-summarize')?.parentElement?.textContent ?? ''`)
  const on = await evaluate<string | null>(contents, `document.querySelector('[aria-labelledby="settings-summarize"]')?.getAttribute('aria-checked') ?? null`)
  await clickSelector(contents, '[aria-labelledby="settings-summarize"]')
  await waitFor(contents, `document.querySelector('[aria-labelledby="settings-summarize"]')?.getAttribute('aria-checked') === 'false'`)
  const offSaved = readSettings(userDataDir).summarizeOnStop
  await clickSelector(contents, '[aria-labelledby="settings-summarize"]')
  await waitFor(contents, `document.querySelector('[aria-labelledby="settings-summarize"]')?.getAttribute('aria-checked') === 'true'`)
  const onSaved = readSettings(userDataDir).summarizeOnStop
  return {
    ok:
      on === 'true' &&
      row.includes('Resumir ao encerrar') &&
      row.includes('Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas.') &&
      offSaved === false &&
      onSaved === true,
    detail: `"${row}" ligado=${on}; desligado -> ${offSaved}; religado -> ${onSaved}`,
  }
}

/**
 * Contrato 07, CA2 e a invariante, no tema claro: o bloco "Arquivos da reunião" ligado com a pasta
 * padrão encurtada; "Escolher pasta…" grava a pasta pelo diálogo (substituto); desligado, uma gravação
 * não escreve nada em nenhuma das pastas. Termina ligado, com a pasta escolhida.
 */
async function meetingFilesSettings(win: BrowserWindow, ctx: SmokeContext): Promise<Check> {
  const contents = win.webContents
  const section = `section[aria-label="Arquivos da reunião"]`
  await openSettingsTab(contents, 'arquivos')
  await waitFor(contents, `document.querySelector('${section}')`)
  await scrollToSection(contents, 'Arquivos da reunião')
  const before = await evaluate<{ text: string; on: string }>(
    contents,
    `({ text: document.querySelector('${section}')?.innerText ?? '', on: document.querySelector('[aria-labelledby="settings-save-folder"]')?.getAttribute('aria-checked') ?? '' })`,
  )
  await waitFor(contents, `document.querySelector('${section}')?.innerText.includes('~/Documents/${DEFAULT_FOLDER_NAME}')`)
  const defaultShown = await evaluate<string>(contents, `document.querySelector('${section}')?.innerText ?? ''`)

  const chosen = join(smokeHome(ctx), 'Reuniões gravadas')
  mkdirSync(chosen, { recursive: true })
  ctx.fixtures.chosenFolder = chosen
  await clickSelector(contents, '[data-action="choose-folder"]')
  const shownChosen = await waitFor(contents, `document.querySelector('${section}')?.innerText.includes('~/Reuniões gravadas')`)
  const savedFolder = readSettings(ctx.userDataDir).audioFolder

  // Desligado: nenhum byte na pasta (nem na padrão, nem na escolhida), nenhum marcador, nenhuma linha no detalhe.
  await clickSelector(contents, '[aria-labelledby="settings-save-folder"]')
  const rowGone = await waitFor(contents, `!document.querySelector('[data-action="choose-folder"]')`)
  const offSaved = readSettings(ctx.userDataDir).saveToFolder
  const snapshot = (): string => JSON.stringify([folderFiles(defaultMeetingFolder(ctx)), folderFiles(chosen)])
  const filesBefore = snapshot()
  Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.newRecording)?.click()
  await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  await wait(1500)
  const markerOff = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-audio-marker]'))`)
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, `${routeIs('detalhe')} && ${DETAIL_ID} !== ''`)
  await settle(contents)
  const detailFiles = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-meeting-files]'))`)
  const filesAfter = snapshot()

  await openSettingsTab(contents, 'arquivos')
  await waitFor(contents, `document.querySelector('[aria-labelledby="settings-save-folder"]')`)
  await clickSelector(contents, '[aria-labelledby="settings-save-folder"]')
  const backOn = await waitFor(contents, `document.querySelector('[data-action="choose-folder"]')`)
  return {
    ok:
      before.on === 'true' &&
      before.text.includes('Salvar áudio e transcrição numa pasta') &&
      before.text.includes('Para cada reunião: um arquivo de áudio (você e os participantes) e a transcrição em texto. Avise as pessoas antes de gravar.') &&
      defaultShown.includes(`~/Documents/${DEFAULT_FOLDER_NAME}`) &&
      shownChosen &&
      savedFolder === chosen &&
      rowGone &&
      offSaved === false &&
      !markerOff &&
      !detailFiles &&
      filesBefore === filesAfter &&
      backOn &&
      readSettings(ctx.userDataDir).saveToFolder === true,
    detail: `ligado=${before.on}, pasta padrão mostrada=${defaultShown.includes(`~/Documents/${DEFAULT_FOLDER_NAME}`)}; "Escolher pasta…" -> mostrada=${shownChosen}, audioFolder=${savedFolder ? basename(savedFolder) : null}; desligado -> linha da pasta sumiu=${rowGone}, saveToFolder=${offSaved}, marcador na gravação=${markerOff}, linhas no detalhe=${detailFiles}, pastas iguais antes e depois=${filesBefore === filesAfter}; religado=${backOn}`,
  }
}

/** Enter num campo de texto (o React ouve o `keydown` que sobe até a raiz). */
async function pressEnterIn(contents: WebContents, selector: string): Promise<void> {
  await evaluate(contents, `document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) ?? false`)
}

/** Saída do campo: o `onBlur` do React ouve o `focusout` (a janela do smoke não recebe foco de verdade). */
async function leaveField(contents: WebContents, selector: string): Promise<void> {
  await evaluate(contents, `document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) ?? false`)
}

interface SidebarBrand {
  name: string
  subtitle: string | null
  logoSrc: string
  logoBox: { width: number; height: number } | null
  logoFit: string
  logoRadius: string
  symbol: boolean
}

const sidebarBrand = (contents: WebContents): Promise<SidebarBrand> =>
  evaluate<SidebarBrand>(
    contents,
    `(() => {
      const aside = document.querySelector('aside')
      const img = aside?.querySelector('img[data-brand-logo]')
      const box = img?.getBoundingClientRect()
      return {
        name: aside?.querySelector('[data-brand-name]')?.textContent ?? '',
        subtitle: aside?.querySelector('[data-brand-subtitle]')?.textContent ?? null,
        logoSrc: img?.getAttribute('src') ?? '',
        logoBox: box ? { width: Math.round(box.width), height: Math.round(box.height) } : null,
        logoFit: img ? getComputedStyle(img).objectFit : '',
        logoRadius: img ? getComputedStyle(img).borderTopLeftRadius : '',
        symbol: Boolean(aside?.querySelector('svg[aria-label="LAP"]')),
      }
    })()`,
  )

/**
 * Contrato 09, CA2 a CA7, no tema claro: o bloco "Marca" é o primeiro de Configurações; "Escolher
 * imagem…" (diálogo substituto) põe o logo de fixture na barra lateral como data URL, nome e subtítulo
 * novos mudam a barra, o título da janela e o `document.title` na hora; uma imagem inválida mostra a
 * mensagem e não muda nada; "Usar o logo da LAP" e os campos de volta ao padrão restauram tudo. O
 * `userData` e o `app.getName()` não mudam em nenhum momento.
 */
async function brandingChecks(win: BrowserWindow, ctx: SmokeContext): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const section = 'section[aria-label="Marca"]'
  const userDataBefore = app.getPath('userData')
  const dockFrom = ctx.fixtures.dockIcons.length
  await openSettingsTab(contents, 'geral')
  await waitFor(contents, `document.querySelector('${section}')`)
  await scrollToSection(contents, 'Marca')
  const block = await evaluate<{ first: string; text: string; namePlaceholder: string; subtitlePlaceholder: string; resetShown: boolean; preview: number }>(
    contents,
    `({
      first: document.querySelector('[data-settings-scroll] section')?.getAttribute('aria-label') ?? '',
      text: document.querySelector('${section}')?.innerText ?? '',
      namePlaceholder: document.querySelector('#brand-name')?.getAttribute('placeholder') ?? '',
      subtitlePlaceholder: document.querySelector('#brand-subtitle')?.getAttribute('placeholder') ?? '',
      resetShown: Boolean(document.querySelector('[data-action="reset-brand-logo"]')),
      preview: Math.round(document.querySelector('[data-brand-logo-preview] svg')?.getBoundingClientRect().width ?? 0),
    })`,
  )

  // Logo de fixture (640×400) pelo diálogo substituto.
  ctx.fixtures.chosenImage = join(app.getAppPath(), 'test', 'fixtures', 'brand', 'logo-smoke.png')
  await clickSelector(contents, '[data-action="choose-brand-logo"]')
  const logoShown = await waitFor(contents, `document.querySelector('aside img[data-brand-logo]')?.getAttribute('src')?.startsWith('data:image/png;base64,')`)
  const savedLogo = readSettings(ctx.userDataDir).brandLogo ?? null
  const logoFile = savedLogo !== null && BRAND_LOGO_PATTERN.test(savedLogo) && existsSync(join(ctx.userDataDir, BRANDING_DIR, savedLogo))
  const resetAppears = await waitFor(contents, `document.querySelector('[data-action="reset-brand-logo"]')`)

  // Nome (Enter) e subtítulo (saída do campo).
  const name = 'Atas da Diretoria'
  const subtitle = 'Jurídico'
  await setValue(contents, '#brand-name', `  ${name}  `)
  await pressEnterIn(contents, '#brand-name')
  await setValue(contents, '#brand-subtitle', subtitle)
  await leaveField(contents, '#brand-subtitle')
  const textsShown = await waitFor(
    contents,
    `document.querySelector('aside [data-brand-name]')?.textContent === ${JSON.stringify(name)} && document.querySelector('aside [data-brand-subtitle]')?.textContent === ${JSON.stringify(subtitle)}`,
  )
  const titled = await waitFor(contents, `document.title === ${JSON.stringify(name)}`)
  const custom = await sidebarBrand(contents)
  const customSettings = readSettings(ctx.userDataDir)
  const windowTitle = win.getTitle()
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'barra-marca-propria-light')

  // Imagem inválida: mensagem e nada muda.
  const svg = join(smokeHome(ctx), 'logo.svg')
  mkdirSync(smokeHome(ctx), { recursive: true })
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  ctx.fixtures.chosenImage = svg
  await clickSelector(contents, '[data-action="choose-brand-logo"]')
  const invalidShown = await waitFor(contents, `document.querySelector('[data-brand-logo-invalid]')?.textContent === ${JSON.stringify(BRAND_LOGO_INVALID_MESSAGE)}`)
  const afterInvalid = readSettings(ctx.userDataDir).brandLogo ?? null
  const srcAfterInvalid = (await sidebarBrand(contents)).logoSrc

  // De volta ao padrão: "Usar o logo da LAP", nome vazio e o subtítulo padrão.
  await clickSelector(contents, '[data-action="reset-brand-logo"]')
  await waitFor(contents, `document.querySelector('aside svg[aria-label="LAP"]')`)
  await setValue(contents, '#brand-name', '')
  await pressEnterIn(contents, '#brand-name')
  await setValue(contents, '#brand-subtitle', DEFAULT_BRAND_SUBTITLE)
  await pressEnterIn(contents, '#brand-subtitle')
  const backShown = await waitFor(
    contents,
    `document.querySelector('aside [data-brand-name]')?.textContent === ${JSON.stringify(DEFAULT_BRAND_NAME)} && document.querySelector('aside [data-brand-subtitle]')?.textContent === ${JSON.stringify(DEFAULT_BRAND_SUBTITLE)} && document.title === ${JSON.stringify(DEFAULT_BRAND_NAME)}`,
  )
  const back = await sidebarBrand(contents)
  const backSettings = readSettings(ctx.userDataDir)
  const brandingDir = join(ctx.userDataDir, BRANDING_DIR)
  const leftFiles = existsSync(brandingDir) ? readdirSync(brandingDir) : []
  const backTitle = win.getTitle()
  const resetGone = await waitFor(contents, `!document.querySelector('[data-action="reset-brand-logo"]') && !document.querySelector('[data-brand-logo-invalid]')`)
  const dock = ctx.fixtures.dockIcons.slice(dockFrom)
  const userDataSame = app.getPath('userData') === userDataBefore && userDataBefore === ctx.userDataDir
  const packageName = app.getName()

  return {
    check: {
      ok:
        block.first === 'Marca' &&
        block.text.includes('Nome do app') &&
        block.text.includes('Subtítulo') &&
        block.text.includes('Logo') &&
        block.text.includes('Escolher imagem…') &&
        block.text.includes('Aparece na barra lateral, no título da janela e no ícone do Dock. O nome no Finder e na pasta Aplicativos não muda.') &&
        block.namePlaceholder === DEFAULT_BRAND_NAME &&
        block.subtitlePlaceholder === 'Sem subtítulo' &&
        !block.resetShown &&
        block.preview === 28 &&
        logoShown &&
        logoFile &&
        resetAppears &&
        textsShown &&
        titled &&
        custom.logoSrc.startsWith('data:image/png;base64,') &&
        !custom.symbol &&
        custom.logoBox?.width === 28 &&
        custom.logoBox.height === 28 &&
        custom.logoFit === 'contain' &&
        custom.logoRadius === '4px' &&
        customSettings.brandName === name &&
        customSettings.brandSubtitle === subtitle &&
        windowTitle === name &&
        invalidShown &&
        afterInvalid === savedLogo &&
        srcAfterInvalid === custom.logoSrc &&
        backShown &&
        back.symbol &&
        back.logoSrc === '' &&
        backSettings.brandName === null &&
        backSettings.brandSubtitle === null &&
        backSettings.brandLogo === null &&
        leftFiles.length === 0 &&
        backTitle === DEFAULT_BRAND_NAME &&
        resetGone &&
        dock.join(',') === 'custom,default' &&
        userDataSame &&
        packageName === 'Meeting Scribe',
      detail:
        `bloco: primeiro="${block.first}", miniatura=${block.preview}px, "Usar o logo da LAP" antes=${block.resetShown}; ` +
        `logo -> barra=${logoShown}, arquivo=${savedLogo}, existe=${logoFile}, img ${custom.logoBox?.width}x${custom.logoBox?.height} ${custom.logoFit} raio ${custom.logoRadius}, símbolo=${custom.symbol}; ` +
        `nome/subtítulo -> barra="${custom.name}"/"${custom.subtitle}", título="${windowTitle}", document.title=${titled}, gravado=${JSON.stringify([customSettings.brandName, customSettings.brandSubtitle])}; ` +
        `SVG -> mensagem=${invalidShown}, logo igual=${afterInvalid === savedLogo}; ` +
        `padrão -> barra="${back.name}"/"${back.subtitle}", símbolo=${back.symbol}, gravado=${JSON.stringify([backSettings.brandName, backSettings.brandSubtitle, backSettings.brandLogo])}, sobras=${leftFiles.length}, título="${backTitle}"; ` +
        `Dock=[${dock.join(', ')}]; userData igual=${userDataSame}, app.getName()="${packageName}"`,
    },
    shot,
  }
}

/**
 * Contrato 14, CA2, CA3 e CA6, numa janela clara própria (o aviso de versão nova não entra nas outras
 * fotos): o smoke não agenda consulta, então nada aparece antes do botão. "Procurar atualização" consulta a
 * API falsa (versão atual + 1 no `minor`); o aviso aparece na barra e as notas em Configurações. Com o
 * `.sha256` errado, a mensagem de arquivo que não confere e nada fica em Downloads. "Atualizar" da barra
 * baixa (passando pelo redirecionamento), mostra "Baixando… N%", confere, chama o `openPath` substituto e
 * mostra a instrução. Durante uma gravação, "Fechar o app agora" fica travado; depois, só conta o pedido.
 */
async function updatesChecks(win: BrowserWindow, ctx: SmokeContext): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const updates = ctx.fixtures.updates
  const section = 'section[aria-label="Atualizações"]'
  const dmgName = updateAssetName(updates.version)
  const downloads = join(smokeHome(ctx), 'Downloads')
  const downloadFiles = (): string[] => (existsSync(downloads) ? readdirSync(downloads).sort() : [])
  const notice = `document.querySelector('aside [data-update-notice-text]')?.textContent ?? ''`
  const version = app.getVersion()

  await openSettingsTab(contents, 'geral')
  await waitFor(contents, `document.querySelector('${section}')`)
  await scrollToSection(contents, 'Atualizações')
  const before = await evaluate<{ text: string; notice: boolean }>(
    contents,
    `({ text: document.querySelector('${section}')?.innerText ?? '', notice: Boolean(document.querySelector('[data-update-notice]')) })`,
  )
  const callsBefore = updates.calls.length

  // "Procurar atualizações automaticamente": padrão ligado, desliga e liga de novo.
  const autoSwitch = '[aria-labelledby="settings-auto-updates"]'
  const autoDefault = await evaluate<string>(contents, `document.querySelector('${autoSwitch}')?.getAttribute('aria-checked') ?? ''`)
  await clickSelector(contents, autoSwitch)
  const autoOff = await waitFor(contents, `document.querySelector('${autoSwitch}')?.getAttribute('aria-checked') === 'false'`)
  const savedOff = readSettings(ctx.userDataDir).autoCheckUpdates
  await clickSelector(contents, autoSwitch)
  await waitFor(contents, `document.querySelector('${autoSwitch}')?.getAttribute('aria-checked') === 'true'`)
  const savedOn = readSettings(ctx.userDataDir).autoCheckUpdates

  // "Procurar atualização": a versão nova na barra e as notas em Configurações.
  await clickSelector(contents, '[data-action="update-check"]')
  const shown = await waitFor(contents, `(${notice}) === ${JSON.stringify(`Nova versão ${updates.version}`)} && document.querySelector('[data-update-notes]')?.textContent === ${JSON.stringify(updates.notes)}`)
  const afterCheck = await evaluate<string>(contents, `document.querySelector('${section}')?.innerText ?? ''`)
  const apiCall = updates.calls[callsBefore]
  await scrollToSection(contents, 'Atualizações')
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'configuracoes-atualizacoes-light')

  // `.sha256` que não confere: mensagem e nada em Downloads.
  const openedBefore = ctx.fixtures.openedFiles.length
  updates.wrongHash = true
  await clickSelector(contents, '[data-action="update-download"]')
  const hashError = await waitFor(contents, `document.querySelector('[data-update-error]')?.textContent === ${JSON.stringify(UPDATE_HASH_MISMATCH_MESSAGE)}`, 10_000)
  const filesAfterError = downloadFiles()
  const openedAfterError = ctx.fixtures.openedFiles.length - openedBefore
  updates.wrongHash = false

  // "Atualizar" da barra lateral, a partir de Reuniões: abre Configurações no bloco e baixa.
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, routeIs('reunioes'))
  await clickSelector(contents, 'aside [data-action="update-now"]')
  // Contrato 18, CA2: abre a aba "Geral" e rola até o bloco.
  const toSettings = await waitFor(contents, `${routeIs('configuracoes')} && ${settingsTabIs('geral')}`)
  const progressSeen = await waitFor(
    contents,
    `/^Baixando… \\d+%$/.test(document.querySelector('[data-update-progress]')?.textContent ?? '') && /^Baixando… \\d+%$/.test(${notice})`,
    5000,
  )
  const ready = await waitFor(contents, `document.querySelector('[data-update-ready]')?.innerText.includes(${JSON.stringify(UPDATE_INSTALL_INSTRUCTION)})`, 10_000)
  const sectionVisible = await evaluate<boolean>(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]').getBoundingClientRect()
      const box = document.querySelector('${section}').getBoundingClientRect()
      return box.top >= scroller.top - 1 && box.top < scroller.bottom
    })()`,
  )
  const dmgPath = join(downloads, dmgName)
  const filesReady = downloadFiles()
  const dmgOk = existsSync(dmgPath) && readFileSync(dmgPath).equals(updates.dmg)
  const opened = ctx.fixtures.openedFiles.slice(openedBefore)
  const quitEnabled = await evaluate<boolean>(contents, `document.querySelector('[data-action="update-quit"]')?.disabled === false`)

  // Gravando: "Fechar o app agora" travado, com o aviso. Encerrar destrava.
  ctx.fixtures.media.set('granted')
  Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.newRecording)?.click()
  const live = await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  contents.send('scribe:navigate', 'configuracoes')
  await waitFor(contents, `${routeIs('configuracoes')} && document.querySelector('[data-action="update-quit"]')`)
  const blocked = await evaluate<{ disabled: boolean; text: string }>(
    contents,
    `({ disabled: document.querySelector('[data-action="update-quit"]')?.disabled === true, text: document.querySelector('[data-update-quit-blocked]')?.textContent ?? '' })`,
  )
  const quitsWhileRecording = updates.quitRequests
  contents.send('scribe:navigate', 'gravacao')
  await waitFor(contents, `${routeIs('gravacao')} && document.querySelector('[data-action="end-recording"]')`)
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'), 10_000)
  await clickSelector(contents, '[data-nav="configuracoes"]')
  const unblocked = await waitFor(contents, `document.querySelector('[data-action="update-quit"]')?.disabled === false && !document.querySelector('[data-update-quit-blocked]')`)
  await clickSelector(contents, '[data-action="update-quit"]')
  for (let attempt = 0; attempt < 40 && updates.quitRequests === 0; attempt++) await wait(50)

  const calls = updates.calls.slice(callsBefore)
  const destinations = calls.every((call) => call.url === LATEST_RELEASE_URL || call.url.startsWith(RELEASE_DOWNLOAD_PREFIX))
  const redirects = updates.redirects.every((url) => RELEASE_REDIRECT_HOSTS.includes(new URL(url).hostname))
  const headersOk = calls.every((call) => call.userAgent === `LAP-Reunioes/${version}`)

  return {
    check: {
      ok:
        before.text.includes(`Versão ${version}`) &&
        before.text.includes('Procurar atualização') &&
        before.text.includes('Procurar atualizações automaticamente') &&
        before.text.includes('Ainda não verificado.') &&
        !before.notice &&
        callsBefore === 0 &&
        autoDefault === 'true' &&
        autoOff &&
        savedOff === false &&
        savedOn === true &&
        shown &&
        afterCheck.includes('Última verificação: hoje às') &&
        afterCheck.includes('Baixar e instalar') &&
        apiCall?.url === LATEST_RELEASE_URL &&
        apiCall.headerNames.join(',') === 'accept,user-agent' &&
        hashError &&
        filesAfterError.length === 0 &&
        openedAfterError === 0 &&
        toSettings &&
        progressSeen &&
        ready &&
        sectionVisible &&
        filesReady.join(',') === dmgName &&
        dmgOk &&
        opened.length === 1 &&
        opened[0]?.action === 'open' &&
        opened[0].path === dmgPath &&
        quitEnabled &&
        live &&
        blocked.disabled &&
        blocked.text === UPDATE_QUIT_BLOCKED_MESSAGE &&
        quitsWhileRecording === 0 &&
        unblocked &&
        updates.quitRequests === 1 &&
        destinations &&
        redirects &&
        updates.redirects.length > 0 &&
        headersOk,
      detail:
        `antes: versão ${version} no bloco=${before.text.includes(`Versão ${version}`)}, aviso na barra=${before.notice}, consultas=${callsBefore}; ` +
        `automático padrão=${autoDefault}, desligado gravou ${String(savedOff)}, ligado gravou ${String(savedOn)}; ` +
        `"Procurar atualização" -> barra "${await evaluate<string>(contents, notice)}", notas=${shown}, cabeçalhos=[${apiCall?.headerNames.join(', ') ?? ''}] UA "${apiCall?.userAgent ?? ''}"; ` +
        `hash errado -> mensagem=${hashError}, Downloads=[${filesAfterError.join(', ')}], abertos=${openedAfterError}; ` +
        `"Atualizar" -> Configurações=${toSettings}, bloco visível=${sectionVisible}, andamento=${progressSeen}, instrução=${ready}, Downloads=[${filesReady.join(', ')}], conteúdo igual=${dmgOk}, openPath=${JSON.stringify(opened.map((item) => basename(item.path)))}; ` +
        `gravando -> botão travado=${blocked.disabled}, "${blocked.text}"; depois -> destravado=${unblocked}, pedidos de sair=${updates.quitRequests}; ` +
        `${calls.length} pedidos, destinos ok=${destinations}, redirecionamentos=[${updates.redirects.map((url) => new URL(url).hostname).join(', ')}]`,
    },
    shot,
  }
}

type AcpLogEntry = Record<string, unknown> & { method?: string; event?: string; purpose?: string; sessionId?: string }

/** O que o agente ACP falso registrou (`--log`), na ordem. */
function readAcpLog(userDataDir: string): AcpLogEntry[] {
  const file = join(userDataDir, 'acp-fake.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AcpLogEntry)
}

/** Medidas do bloco do ACP para o `report.json`. */
interface AcpMeasured {
  /** Tempo de cada trecho traduzido pelo agente falso, do pedido do renderer à tradução (ms). */
  translationLatencyMs: number[]
  /** Tempo do resumo pelo agente falso, do pedido ao "pronto" (ms). */
  summaryMs: number | null
}

/**
 * Contrato 17 (CA1 a CA10) no tema claro, com o agente ACP falso no lugar do adaptador: "Perguntar" pelo
 * agente (raciocínio, plano, passos com estado, permissões, leitura fora recusada, rodapé), "Parar" com
 * `session/cancel`, modelo e "Pensar mais" na mesma sessão, uma gravação traduzida e um resumo pelo agente, e
 * o adaptador que não sobe. Termina com a conexão de volta na linha de comando.
 */
async function acpChecks(win: BrowserWindow, ctx: SmokeContext, shot: () => Promise<void>): Promise<{ check: Check; measured: AcpMeasured }> {
  const contents = win.webContents
  const { fixtures, userDataDir } = ctx
  const measured: AcpMeasured = { translationLatencyMs: [], summaryMs: null }
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const transportSaved = readSettings(userDataDir).claudeTransport
  // CA7: a linha "Conexão com o Claude" nas Configurações, no agente.
  await openSettingsTab(contents, 'claude')
  const settingsRow = await waitFor(contents, `document.querySelector('[data-claude-transport-option="acp"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('section[aria-label="Claude"]')`)
  const settingsLabels = await evaluate<string[]>(contents, "[...document.querySelectorAll('[data-claude-transport-option]')].map((el) => el.textContent)")
  // Devolução A: o agente não vem no pacote: "Não instalado" com "Instalar (≈… MB)".
  const missingRow = await waitFor(contents, `document.querySelector('[data-acp-state="missing"] [data-action="acp-install"]')?.textContent.startsWith('Instalar (≈')`)
  const missingText = await text(contents, '[data-acp-status]')

  // Sem o agente, a tradução vai pela linha de comando (nada é baixado sem clique).
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEngine: 'claude-cli' }).then(() => true)")
  const cliBefore = fixtures.claudeSpawns.length
  const acpBefore = fixtures.acpSpawns.length
  const fallback = await evaluate<{ ok: boolean }>(contents, "window.__scribeApi.invoke('scribe:claude-start').then(async (started) => { await window.__scribeApi.invoke('scribe:claude-stop'); return started })")
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEngine: 'assemblyai' }).then(() => true)")
  const fallbackOk = fallback.ok && fixtures.claudeSpawns.length === cliBefore + 1 && fixtures.acpSpawns.length === acpBefore && fixtures.registryCalls.length === 0

  // O chat sem o agente: "Instalar o agente do Claude" e "Usar a linha de comando"; o clique instala.
  await clickSelector(contents, '[data-nav="perguntar"]')
  await waitFor(contents, routeIs('perguntar'))
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  await setValue(contents, '[data-chat-input]', 'Oi, agente?')
  await pressEnterIn(contents, '[data-chat-input]')
  const missingShown = await waitFor(
    contents,
    `document.querySelector('[data-chat-error="agent-missing"] [data-action="acp-install-from-chat"]') && document.querySelector('[data-chat-error="agent-missing"] [data-action="use-command-line"]')`,
    10_000,
  )
  const missingChatText = await text(contents, '[data-chat-error="agent-missing"]')
  await clickSelector(contents, '[data-action="acp-install-from-chat"]')
  let installed: { state: string; version?: string } = { state: 'installing' }
  for (let attempt = 0; attempt < 100 && installed.state !== 'installed' && installed.state !== 'error'; attempt++) {
    await wait(50)
    installed = await evaluate(contents, "window.__scribeApi.invoke('scribe:acp-status')")
  }
  const installRoot = join(userDataDir, 'acp', 'claude')
  const installOk =
    installed.state === 'installed' &&
    installed.version === '0.107.0' &&
    fixtures.registryCalls.length === 5 &&
    existsSync(join(installRoot, '0.107.0', 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js')) &&
    existsSync(join(installRoot, '0.107.0', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json')) &&
    JSON.stringify(readdirSync(installRoot)) === '["0.107.0"]'
  const afterInstall = await waitFor(contents, `document.querySelector('[data-chat-error="agent-missing"]')?.textContent.includes('Agente instalado')`)

  // CA2 a CA4 e CA10: uma pergunta pelo agente, numa conversa nova.
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  const thinkMoreShown = await waitFor(contents, `document.querySelector('[data-action="chat-think-more"]')`)
  const spawnsBefore = fixtures.acpSpawns.length
  const asked = await askWatching(contents, 'O que ficou decidido? Pergunta pelo agente.')
  // O bloco "Raciocínio e passos" da resposta gravada, aberto para a foto e para conferir.
  await evaluate(contents, `${LAST_ASSISTANT}?.querySelector('[data-action="toggle-reasoning"]')?.click() ?? true`)
  await waitFor(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-plan]')`)
  const block = await evaluate<{ plan: string[]; steps: string[]; denied: string; thinking: string; footer: string }>(
    contents,
    `(() => {
      const last = ${LAST_ASSISTANT}
      return {
        plan: [...last.querySelectorAll('[data-chat-plan-entry]')].map((el) => el.dataset.chatPlanEntry + ':' + el.textContent),
        steps: [...last.querySelectorAll('[data-chat-step]')].map((el) => el.dataset.chatStepStatus + ':' + el.textContent),
        denied: last.querySelector('[data-chat-denied]')?.dataset.chatDenied ?? '',
        thinking: last.querySelector('[data-chat-thinking]')?.textContent ?? '',
        footer: last.querySelector('[data-chat-footer]')?.textContent ?? '',
      }
    })()`,
  )
  await shot()
  const chatId = await evaluate<string>(contents, `document.querySelector('[data-chat-conversation]')?.getAttribute('data-chat-conversation') ?? ''`)
  const chatSpawn = fixtures.acpSpawns[spawnsBefore]

  // "Parar": `session/cancel`; o processo segue vivo e a próxima pergunta vai na mesma sessão.
  await setValue(contents, '[data-chat-input]', 'Responda devagar, por favor.')
  await pressEnterIn(contents, '[data-chat-input]')
  const streaming = await waitFor(contents, `(document.querySelector('[data-chat-streaming] [data-chat-markdown]')?.textContent ?? '').length > 0 && document.querySelector('[data-action="chat-stop"]')`, 10_000)
  await clickSelector(contents, '[data-action="chat-stop"]')
  const stopped = await waitFor(contents, `document.querySelector('[data-chat-error="stopped"]') && document.querySelector('[data-action="chat-send"]')`, 8000)
  const aliveAfterStop = chatSpawn !== undefined && !chatSpawn.exited

  // Modelo e "Pensar mais": `session/set_config_option` na mesma sessão.
  await setValue(contents, '[data-chat-model-select]', 'opus', 'change')
  await clickSelector(contents, '[data-action="chat-think-more"]')
  await waitFor(contents, `document.querySelector('[data-action="chat-think-more"]')?.getAttribute('aria-pressed') === 'true'`)
  const switched = await askChat(contents, 'E com o Opus?')
  const chatSpawnsAfter = fixtures.acpSpawns.length - spawnsBefore
  const savedChat = chatFile(userDataDir, chatId)

  const log = readAcpLog(userDataDir)
  const chatNew = log.find((entry) => entry.method === 'session/new' && entry.purpose === 'chat') as
    | (AcpLogEntry & { cwd?: string; mcpServers?: unknown[]; configOptions?: { configId: string; value: string }[]; options?: Record<string, unknown> })
    | undefined
  const chatSession = chatNew?.sessionId
  const ofChat = log.filter((entry) => entry.sessionId === chatSession)
  const init = log.find((entry) => entry.method === 'initialize') as (AcpLogEntry & { clientCapabilities?: Record<string, unknown> }) | undefined
  const permissions = ofChat.filter((entry) => entry.event === 'permission').slice(0, 4).map((entry) => `${String(entry.tool)}:${String(entry.outcome)}`)
  const options = chatNew?.options ?? {}
  const allowedEnv = ['CLAUDE_CODE_EXECUTABLE', 'ELECTRON_RUN_AS_NODE', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']
  const capabilities = init?.clientCapabilities as { fs?: { readTextFile?: boolean; writeTextFile?: boolean }; terminal?: boolean } | undefined
  // O SDK reordena as chaves ao validar: compara campo a campo.
  const pairs = (list: { configId: string; value: string }[] | undefined): string[] => (list ?? []).map((entry) => `${entry.configId}=${entry.value}`)
  const sessionOk =
    capabilities?.fs?.readTextFile === true &&
    capabilities.fs.writeTextFile === false &&
    capabilities.terminal === false &&
    chatNew?.cwd === join(userDataDir, CHAT_CORPUS_DIR) &&
    JSON.stringify(chatNew?.mcpServers) === '[]' &&
    JSON.stringify(options['settingSources']) === '[]' &&
    JSON.stringify(options['tools']) === JSON.stringify([...CLAUDE_READ_TOOLS]) &&
    JSON.stringify(options['disallowedTools']) === JSON.stringify([...CLAUDE_DISALLOWED_TOOLS]) &&
    options['model'] === 'sonnet' &&
    String(options['systemPrompt']).startsWith('Você responde perguntas sobre as reuniões') &&
    JSON.stringify(pairs(chatNew?.configOptions)) === JSON.stringify(['mode=default', 'model=sonnet'])
  const securityOk =
    JSON.stringify(permissions) === JSON.stringify(['Read:allow', 'Read:allow', 'Grep:allow', 'Write:reject']) &&
    ofChat.some((entry) => entry.event === 'read-outside' && entry.refused === true) &&
    ofChat.some((entry) => entry.event === 'terminal' && entry.refused === true)
  const protocolOk =
    ofChat.some((entry) => entry.method === 'session/cancel') &&
    ofChat.filter((entry) => entry.method === 'session/new').length === 1 &&
    ofChat.filter((entry) => entry.method === 'session/prompt').length === 3 &&
    JSON.stringify(ofChat.filter((entry) => entry.method === 'session/set_config_option').map((entry) => `${String(entry.configId)}=${String(entry.value)}`)) ===
      JSON.stringify(['model=opus', 'effort=high']) &&
    log.filter((entry) => entry.method === 'session/new' && entry.purpose === 'chat').length === 1
  const processOk =
    chatSpawnsAfter === 1 &&
    chatSpawn !== undefined &&
    chatSpawn.claudeExecutable === join(app.getAppPath(), 'test', 'fixtures', 'fake-claude.mjs') &&
    chatSpawn.envNames.every((name) => allowedEnv.includes(name)) &&
    chatSpawn.envNames.includes('CLAUDE_CODE_EXECUTABLE') &&
    chatSpawn.envNames.includes('ELECTRON_RUN_AS_NODE')
  const uiOk =
    asked.done &&
    asked.streamed &&
    asked.liveOpen &&
    asked.statuses[0] === 'Pensando…' &&
    asked.statuses.some((status) => status.startsWith('Abrindo «')) &&
    asked.answer.includes('pelo agente') &&
    JSON.stringify(block.plan.map((entry) => entry.split(':')[0])) === JSON.stringify(['completed', 'completed', 'completed']) &&
    block.steps.length === 3 &&
    block.steps.every((step) => step.startsWith('completed:') && step.endsWith('· feito')) &&
    block.denied === '2' &&
    block.thinking.includes('<b>sem HTML</b>') &&
    block.footer.includes('Sonnet') &&
    block.footer.includes('US$') &&
    !JSON.stringify(block).includes(userDataDir)
  const savedOk =
    savedChat?.thinkMore === true &&
    savedChat.model === 'opus' &&
    savedChat.messages.some((message) => message.error === 'stopped') &&
    (savedChat.messages.find((message) => message.role === 'assistant')?.plan?.length ?? 0) === 3

  // CA4b: uma gravação traduzida pelo agente, pelos mesmos canais da gravação, com a latência medida.
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEngine: 'claude-cli' }).then(() => true)")
  const translate = await evaluate<{ started: { ok: boolean }; results: { ok: boolean; translation?: string; model?: string }[]; ms: number[] }>(
    contents,
    `(async () => {
      const started = await window.__scribeApi.invoke('scribe:claude-start')
      const results = []
      const ms = []
      const texts = ['Bom dia a todos.', 'Alguma dúvida <até> aqui?', 'Vamos fechar o orçamento hoje.']
      for (let i = 0; i < texts.length; i++) {
        const t0 = performance.now()
        results.push(await window.__scribeApi.invoke('scribe:claude-translate', { segmentId: 'mic-acp-' + i, source: 'mic', turnOrder: i, text: texts[i] }))
        ms.push(Math.round(performance.now() - t0))
      }
      await window.__scribeApi.invoke('scribe:claude-stop')
      return { started, results, ms }
    })()`,
  )
  measured.translationLatencyMs = translate.ms
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEngine: 'assemblyai' }).then(() => true)")
  const translateNew = readAcpLog(userDataDir).find((entry) => entry.method === 'session/new' && entry.purpose === 'translate') as (AcpLogEntry & { cwd?: string; options?: Record<string, unknown> }) | undefined
  const translateOk =
    translate.started.ok &&
    JSON.stringify(translate.results.map((result) => result.translation)) === JSON.stringify(['[EN] Bom dia a todos.', '[EN] Alguma dúvida <até> aqui?', '[EN] Vamos fechar o orçamento hoje.']) &&
    translate.results.every((result) => result.model === 'claude-cli:haiku') &&
    translateNew?.cwd === join(userDataDir, 'claude-cwd', 'translate') &&
    JSON.stringify(translateNew.options?.['tools']) === '[]' &&
    JSON.stringify(translateNew.options?.['settingSources']) === '[]'

  // CA4c: um resumo pelo agente, de uma reunião com a transcrição da fixture (o resumo sai do arquivo depois).
  const summaryMeeting = readMeetings(userDataDir)[0]?.id ?? 'smoke-1'
  const transcriptFile = join(userDataDir, 'meetings', `${summaryMeeting}.json`)
  const hadTranscript = existsSync(transcriptFile)
  if (!hadTranscript) writeFileSync(transcriptFile, `${JSON.stringify(transcriptDocument(summaryMeeting, readSessionFixture()), null, 2)}\n`)
  const summaryStarted = Date.now()
  await evaluate(contents, `window.__scribeApi.invoke('scribe:summary-generate', { meetingId: ${JSON.stringify(summaryMeeting)} })`)
  let summary: { state: string; summary?: { overview?: string } } = { state: 'generating' }
  for (let attempt = 0; attempt < 100 && summary.state === 'generating'; attempt++) {
    await wait(100)
    summary = await evaluate(contents, `window.__scribeApi.invoke('scribe:summary-get', { meetingId: ${JSON.stringify(summaryMeeting)} })`)
  }
  measured.summaryMs = summary.state === 'ready' ? Date.now() - summaryStarted : null
  const summaryNew = readAcpLog(userDataDir).find((entry) => entry.method === 'session/new' && entry.purpose === 'summary') as (AcpLogEntry & { cwd?: string; options?: Record<string, unknown> }) | undefined
  const summaryOk =
    summary.state === 'ready' &&
    (summary.summary?.overview ?? '').includes('resumida pelo agente') &&
    summaryNew?.cwd === join(userDataDir, 'claude-cwd', 'summary') &&
    JSON.stringify(summaryNew.options?.['tools']) === '[]'
  rmSync(join(userDataDir, 'meetings', `${summaryMeeting}.summary.json`), { force: true })
  if (!hadTranscript) rmSync(transcriptFile, { force: true })

  // CA8: o adaptador que não sobe: o erro na tela e o botão que troca para a linha de comando.
  fixtures.acpBroken = true
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  await setValue(contents, '[data-chat-input]', 'Oi, agente?')
  await pressEnterIn(contents, '[data-chat-input]')
  const brokenShown = await waitFor(contents, `document.querySelector('[data-chat-error="agent"] [data-action="use-command-line"]')`, 10_000)
  const brokenText = await text(contents, '[data-chat-error="agent"]')
  await clickSelector(contents, '[data-action="use-command-line"]')
  const switchedBack = await waitFor(contents, `!document.querySelector('[data-action="use-command-line"]')`)
  fixtures.acpBroken = false
  const back = readSettings(userDataDir).claudeTransport
  // Nenhum processo do agente fica vivo depois de cada uso (o do chat morre ao sair do app).
  for (let attempt = 0; attempt < 60 && fixtures.acpSpawns.slice(spawnsBefore + 1).some((spawn) => !spawn.exited); attempt++) await wait(50)
  const othersExited = fixtures.acpSpawns.slice(spawnsBefore + 1).every((spawn) => spawn.exited)

  // "Remover" nas Configurações: volta a "Não instalado" e a pasta some.
  await openSettingsTab(contents, 'claude')
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  await waitFor(contents, `document.querySelector('[data-acp-state="installed"] [data-action="acp-remove"]')`)
  const installedText = await text(contents, '[data-acp-status]')
  await clickSelector(contents, '[data-action="acp-remove"]')
  const removed = (await waitFor(contents, `document.querySelector('[data-acp-state="missing"]')`)) && !existsSync(join(installRoot, '0.107.0'))
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'cli' }).then(() => true)")

  return {
    check: {
      ok:
        missingRow &&
        missingText === 'Não instalado' &&
        fallbackOk &&
        missingShown &&
        missingChatText.includes('O agente do Claude não está instalado.') &&
        installOk &&
        afterInstall &&
        installedText === 'Instalado 0.107.0' &&
        removed &&
        transportSaved === 'acp' &&
        settingsRow &&
        JSON.stringify(settingsLabels) === JSON.stringify(['Agente (ACP, recomendado)', 'Linha de comando']) &&
        thinkMoreShown &&
        uiOk &&
        sessionOk &&
        securityOk &&
        streaming &&
        stopped &&
        aliveAfterStop &&
        switched.done &&
        switched.answer.includes('Modelo: opus') &&
        protocolOk &&
        processOk &&
        savedOk &&
        translateOk &&
        summaryOk &&
        brokenShown &&
        brokenText.includes('O agente do Claude não abriu.') &&
        switchedBack &&
        back === 'cli' &&
        othersExited,
      detail: `sem agente: linha "${missingText}"=${missingRow}, tradução pela linha de comando=${fallbackOk}, chat "${missingChatText.slice(0, 80)}" com os botões=${missingShown}; instalação ${JSON.stringify(installed)}, ${fixtures.registryCalls.length} pacotes do registro falso, ok=${installOk}, aviso depois=${afterInstall}; "${installedText}", Remover=${removed}; conexão ${transportSaved}, linha nas Configurações=${settingsRow} ${JSON.stringify(settingsLabels)}; pergunta: estados ${JSON.stringify(asked.statuses)}, bloco aberto=${asked.liveOpen}, em pedaços=${asked.streamed}, fim=${asked.done}, resposta "${asked.answer.slice(0, 80)}"; plano ${JSON.stringify(block.plan)}, passos ${JSON.stringify(block.steps)}, negadas ${block.denied}, rodapé "${block.footer}"; session/new ok=${sessionOk}, permissões ${JSON.stringify(permissions)}, segurança=${securityOk}; Parar: em pedaços=${streaming}, parada=${stopped}, processo vivo=${aliveAfterStop}; Opus + Pensar mais -> "${switched.answer.slice(-40)}", protocolo=${protocolOk}; processo=${processOk} (${fixtures.acpSpawns.length - spawnsBefore} abertos); gravado=${savedOk}; tradução ${JSON.stringify(translate.results)} em ${JSON.stringify(translate.ms)} ms, ok=${translateOk}; resumo ${summary.state} em ${measured.summaryMs ?? '?'} ms, ok=${summaryOk}; adaptador quebrado -> "${brokenText.slice(-60)}", botão=${brokenShown}, conexão de volta ${back}; processos encerrados=${othersExited}`,
    },
    measured,
  }
}

async function scrollToSection(contents: WebContents, label: string): Promise<void> {
  await evaluate(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]')
      const section = document.querySelector('section[aria-label=${JSON.stringify(label)}]')
      scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      return true
    })()`,
  )
}

function countDistinctColors(bitmap: Buffer): number {
  const colors = new Set<number>()
  for (let i = 0; i + 3 < bitmap.length; i += 4) colors.add(bitmap.readUInt32LE(i))
  return colors.size
}

async function capture(win: BrowserWindow, outDir: string, name: string): Promise<Screenshot> {
  const image = await win.webContents.capturePage()
  const file = join(outDir, `${name}.png`)
  writeFileSync(file, image.toPNG())
  const pixels = image.getSize()
  const devicePixelRatio = await evaluate<number>(win.webContents, 'window.devicePixelRatio')
  return {
    name,
    file,
    width: Math.round(pixels.width / devicePixelRatio),
    height: Math.round(pixels.height / devicePixelRatio),
    devicePixelRatio,
    pixelWidth: pixels.width,
    pixelHeight: pixels.height,
    distinctColors: countDistinctColors(image.toBitmap()),
  }
}

async function probeOrigin(contents: WebContents): Promise<{ origin: string; opfs: boolean; workletAddModule: boolean; errors: string[] }> {
  return evaluate(
    contents,
    `(async () => {
      const errors = []
      let opfs = false
      try {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('smoke-probe.txt', { create: true })
        const writable = await handle.createWritable()
        await writable.write('scribe-opfs-ok')
        await writable.close()
        const text = await (await handle.getFile()).text()
        await root.removeEntry('smoke-probe.txt')
        opfs = text === 'scribe-opfs-ok'
      } catch (error) { errors.push('opfs: ' + error) }
      let workletAddModule = false
      try {
        const ctx = new OfflineAudioContext(1, 128, 16000)
        const url = new URL('/probe-worklet.js', location.origin).href
        await ctx.audioWorklet.addModule(url)
        new AudioWorkletNode(ctx, 'scribe-probe')
        workletAddModule = url.startsWith(location.origin + '/')
      } catch (error) { errors.push('worklet: ' + error) }
      return { origin: location.origin, opfs, workletAddModule, errors }
    })()`,
  )
}

/** Tab até o item "Configurações" e Enter, com eventos de teclado reais do Chromium. */
async function keyboardNavigation(contents: WebContents): Promise<Check> {
  await evaluate(contents, "document.activeElement instanceof HTMLElement && document.activeElement.blur(), true")
  for (let i = 0; i < 6; i++) {
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await wait(60)
    const focused = await evaluate<string>(contents, "document.activeElement?.dataset?.nav ?? ''")
    if (focused === 'configuracoes') {
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      contents.sendInputEvent({ type: 'char', keyCode: 'Return' })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      await wait(200)
      const route = await currentRoute(contents)
      const nav = await activeNav(contents)
      return { ok: route === 'configuracoes' && nav === 'configuracoes', detail: `Tab x${i + 1} + Enter -> rota ${route}, aria-current em ${nav}` }
    }
  }
  return { ok: false, detail: 'Tab não chegou ao item Configurações' }
}

async function themeLiveSwitch(contents: WebContents): Promise<Check> {
  nativeTheme.themeSource = 'light'
  const light = await waitFor(contents, "document.documentElement.dataset.theme === 'light'")
  await evaluate(contents, 'window.__smokeMarker = 1, true')
  nativeTheme.themeSource = 'dark'
  const dark = await waitFor(contents, "document.documentElement.dataset.theme === 'dark'")
  const kept = await evaluate<boolean>(contents, 'window.__smokeMarker === 1')
  nativeTheme.themeSource = 'system'
  return {
    ok: light && dark && kept,
    detail: `tema system: claro=${light}, escuro=${dark}, mesma página (sem recarregar)=${kept}`,
  }
}

/** Maior duração de transição/animação entre todos os elementos, em ms. */
const MAX_MOTION_MS = `(() => {
  const ms = (v) => Math.max(0, ...v.split(',').map((s) => parseFloat(s) * (s.trim().endsWith('ms') ? 1 : 1000)))
  let max = 0
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.transitionProperty !== 'none') max = Math.max(max, ms(cs.transitionDuration))
    if (cs.animationName !== 'none') max = Math.max(max, ms(cs.animationDuration))
  }
  return max
})()`

async function reducedMotion(contents: WebContents): Promise<Check> {
  const normal = await evaluate<number>(contents, MAX_MOTION_MS)
  contents.debugger.attach('1.3')
  try {
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const reduced = await evaluate<number>(contents, MAX_MOTION_MS)
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    return { ok: normal > 0 && reduced === 0, detail: `maior duração: normal ${normal} ms, reduzido ${reduced} ms` }
  } finally {
    contents.debugger.detach()
  }
}

/**
 * O worklet da captura de verdade (o smoke grava com sinal gerado e não passa por ele): carrega pela
 * própria origem, liga um oscilador a ele num `OfflineAudioContext` a 48 kHz e confere que blocos
 * chegam à thread principal.
 */
async function probeCaptureWorklet(contents: WebContents, appPath: string): Promise<Check> {
  const asset = readdirSync(join(appPath, 'out', 'renderer', 'assets')).find((file) => /^pcm-worklet-.*\.js$/.test(file))
  if (!asset) return { ok: false, detail: 'pcm-worklet-*.js ausente do build' }
  const result = await evaluate<{ blocks: number; channels: number; frames: number; error: string }>(
    contents,
    `(async () => {
      try {
        const ctx = new OfflineAudioContext(1, 48000, 48000)
        await ctx.audioWorklet.addModule('/assets/${asset}')
        const node = new AudioWorkletNode(ctx, 'scribe-pcm')
        let blocks = 0, channels = 0, frames = 0
        node.port.onmessage = (event) => { blocks++; channels = event.data.channels.length; frames += event.data.channels[0].length }
        const osc = new OscillatorNode(ctx, { frequency: 440 })
        osc.connect(node)
        node.connect(ctx.destination)
        osc.start()
        await ctx.startRendering()
        await new Promise((resolve) => setTimeout(resolve, 200))
        return { blocks, channels, frames, error: '' }
      } catch (error) { return { blocks: 0, channels: 0, frames: 0, error: String(error) } }
    })()`,
  )
  return {
    ok: !result.error && result.blocks > 0 && result.channels === 1 && result.frames >= 1024,
    detail: `/assets/${asset}: ${result.blocks} lotes, ${result.channels} canal, ${result.frames} amostras${result.error ? `; ${result.error}` : ''}`,
  }
}

const TIMER = `document.querySelector('[aria-label="Tempo gravado"]')?.textContent ?? ''`
const STATUS = `document.querySelector('[data-status]')?.textContent ?? ''`
const DETAIL_ID = `(document.querySelector('main [data-meeting]:not(a)')?.dataset.meeting ?? '')`
const NOTICE_SYSTEM = `document.querySelector('[data-notice="system-silent"]')`

/** Silencia o áudio do sistema até o aviso aparecer, fotografa e devolve o som. */
async function captureSystemNotice(
  win: BrowserWindow,
  outDir: string,
  name: string,
): Promise<{ shown: boolean; href: string; label: string; gone: boolean; sidebar: string; sidebarAfter: string; shot: Screenshot }> {
  const contents = win.webContents
  await evaluate(contents, `${probeJs("mute('system', true)")}, true`)
  const shown = await waitFor(contents, NOTICE_SYSTEM, 6000)
  // Bloco de permissões da barra lateral acompanha o detector (CA12).
  await waitFor(contents, `document.querySelector('[data-permission="system"]')?.dataset.state === 'silent'`, 1000)
  const sidebar = await evaluate<string>(contents, `document.querySelector('[data-permission="system"]')?.textContent ?? ''`)
  const href = await evaluate<string>(contents, `${NOTICE_SYSTEM}?.querySelector('a')?.getAttribute('href') ?? ''`)
  const label = await evaluate<string>(contents, `document.querySelector('[data-source-label="sys"]')?.textContent ?? ''`)
  await settle(contents)
  const shot = await capture(win, outDir, name)
  await evaluate(contents, `${probeJs("mute('system', false)")}, true`)
  const gone = await waitFor(contents, `!${NOTICE_SYSTEM}`, 3000)
  await waitFor(contents, `document.querySelector('[data-permission="system"]')?.dataset.state === 'ok'`, 1000)
  const sidebarAfter = await evaluate<string>(contents, `document.querySelector('[data-permission="system"]')?.textContent ?? ''`)
  return { shown, href, label, gone, sidebar, sidebarAfter, shot }
}

/**
 * Leitura do detalhe que falha (meetings.json trocado por uma pasta: a leitura dá EISDIR): a tela
 * mostra o aviso com "Tentar de novo" em vez de ficar em branco, e o botão abre a reunião quando o
 * arquivo volta.
 */
async function detailLoadFailure(contents: WebContents, userDataDir: string): Promise<Check> {
  const file = join(userDataDir, MEETINGS_FILE)
  const backup = `${file}.smoke-backup`
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, "document.querySelectorAll('main a[data-meeting]').length > 0")
  renameSync(file, backup)
  mkdirSync(file)
  let shown: boolean
  let text: string
  try {
    await clickSelector(contents, 'main a[data-meeting]')
    shown = await waitFor(contents, `${routeIs('detalhe')} && document.querySelector('[data-notice="detail-load-failed"]')`)
    text = await evaluate<string>(contents, `document.querySelector('[data-notice="detail-load-failed"]')?.textContent ?? ''`)
  } finally {
    rmSync(file, { recursive: true, force: true })
    renameSync(backup, file)
  }
  await clickSelector(contents, '[data-notice="detail-load-failed"] button')
  const recovered = await waitFor(contents, `${DETAIL_ID} !== '' && !document.querySelector('[data-notice="detail-load-failed"]')`)
  return {
    ok: shown && text.includes('Tentar de novo') && recovered,
    detail: `leitura falhou -> aviso=${shown} ("${text}"); "Tentar de novo" com o arquivo de volta -> reunião ${await evaluate<string>(contents, DETAIL_ID)}`,
  }
}

/** Nome do app, título da janela e barra lateral opaca em --side-bg com o símbolo da LAP. */
async function brandCheck(win: BrowserWindow): Promise<Check> {
  const sidebar = await evaluate<{ background: string; sideBg: string; symbol: boolean; signature: string }>(
    win.webContents,
    `(() => {
      const aside = document.querySelector('aside')
      const probe = document.createElement('div')
      probe.style.background = 'var(--side-bg)'
      document.body.append(probe)
      const sideBg = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        background: aside ? getComputedStyle(aside).backgroundColor : '',
        sideBg,
        symbol: Boolean(aside?.querySelector('svg[aria-label="LAP"]')),
        signature: aside?.textContent ?? '',
      }
    })()`,
  )
  const name = app.getName()
  const title = win.getTitle()
  return {
    ok:
      name === 'Meeting Scribe' &&
      title === 'LAP Reuniões' &&
      sidebar.background === sidebar.sideBg &&
      sidebar.background === 'rgb(10, 42, 94)' &&
      sidebar.symbol &&
      sidebar.signature.includes('LAP Reuniões') &&
      sidebar.signature.includes('LAP Software'),
    detail: `app.getName()="${name}", título="${title}", barra lateral ${sidebar.background} (--side-bg ${sidebar.sideBg}), símbolo=${sidebar.symbol}`,
  }
}

async function pressSpace(contents: WebContents): Promise<void> {
  await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  contents.sendInputEvent({ type: 'char', keyCode: 'Space' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
}

/**
 * Tema claro: "Nova gravação" do cabeçalho, pausa (cronômetro, fita e quadros parados, trilhas
 * vivas), barra de espaço, aviso de silêncio do sistema, encerrar, excluir com confirmação e o menu
 * "Nova gravação" (⌘N). Grava também o PNG do aviso.
 */
async function recordingChecks(
  win: BrowserWindow,
  ctx: SmokeContext,
  navigation: Record<string, Check>,
  recording: Record<string, Check>,
  screenshots: Screenshot[],
): Promise<void> {
  const contents = win.webContents
  const bothLive = `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`

  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, "document.querySelectorAll('main a[data-meeting]').length > 0")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  const live = await waitFor(contents, bothLive)
  navigation['headerNewRecording'] = {
    ok: live && (await currentRoute(contents)) === 'gravacao',
    detail: `"Nova gravação" do cabeçalho de Reuniões -> rota ${await currentRoute(contents)}, captura ${JSON.stringify(await captureState(contents))}`,
  }
  await wait(1200)

  await clickSelector(contents, '[data-action="toggle-pause"]')
  await waitFor(contents, `${probeJs('state()?.phase')} === 'paused'`)
  await wait(100)
  const before = { timer: await evaluate<string>(contents, TIMER), frames: await frameCounts(contents), tape: await evaluate<number>(contents, probeJs('tapeFrames()')) }
  await wait(1200)
  const after = { timer: await evaluate<string>(contents, TIMER), frames: await frameCounts(contents), tape: await evaluate<number>(contents, probeJs('tapeFrames()')) }
  const paused = await captureState(contents)
  const status = await evaluate<string>(contents, STATUS)
  recording['pause'] = {
    ok:
      paused?.phase === 'paused' &&
      paused.mic === 'live' &&
      paused.system === 'live' &&
      status === 'Pausado' &&
      before.timer === after.timer &&
      before.tape === after.tape &&
      JSON.stringify(before.frames) === JSON.stringify(after.frames) &&
      (before.frames?.mic ?? 0) > 0,
    detail: `estado ${JSON.stringify(paused)}, "${status}"; em 1,2 s: cronômetro ${before.timer} -> ${after.timer}, quadros ${JSON.stringify(before.frames)} -> ${JSON.stringify(after.frames)}, fita ${before.tape} -> ${after.tape} desenhos`,
  }

  await pressSpace(contents)
  const resumed = await waitFor(contents, `${probeJs('state()?.phase')} === 'recording'`, 2000)
  await wait(800)
  const framesResumed = await frameCounts(contents)
  recording['spaceResumes'] = {
    ok: resumed && (framesResumed?.mic ?? 0) > (after.frames?.mic ?? 0) && (await evaluate<string>(contents, TIMER)) !== after.timer,
    detail: `barra de espaço -> ${(await captureState(contents))?.phase}; quadros ${JSON.stringify(after.frames)} -> ${JSON.stringify(framesResumed)}`,
  }

  const { shown, href, label, gone, sidebar, sidebarAfter, shot } = await captureSystemNotice(win, ctx.outDir, 'gravacao-aviso-light')
  screenshots.push(shot)
  recording['systemSilenceNotice'] = {
    ok: shown && href === PRIVACY_PANE_URLS['audio-capture'] && label === 'Participantessem sinal' && gone && sidebar === 'Áudio do sistemasem áudio' && sidebarAfter === 'Áudio do sistemaok',
    detail: `zero absoluto no sistema -> aviso=${shown}, link=${href}, rótulo="${label}", barra lateral "${sidebar}"; som de volta -> aviso sumiu=${gone}, barra lateral "${sidebarAfter}"`,
  }

  const countBefore = readMeetings(ctx.userDataDir).length
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, `${routeIs('detalhe')} && ${DETAIL_ID} !== ''`)
  const id = await evaluate<string>(contents, DETAIL_ID)
  recording['endFromHeader'] = {
    ok: (await currentRoute(contents)) === 'detalhe' && readMeetings(ctx.userDataDir).length === countBefore + 1 && readMeetings(ctx.userDataDir).some((m) => m.id === id),
    detail: `"Encerrar" -> rota ${await currentRoute(contents)}, reunião ${id}, ${countBefore} -> ${readMeetings(ctx.userDataDir).length} registros`,
  }

  await clickSelector(contents, '[data-action="delete-meeting"]')
  const asked = await waitFor(contents, `document.querySelector('[data-action="confirm-delete"]')`)
  const keptWhileAsking = readMeetings(ctx.userDataDir).some((m) => m.id === id)
  // Contrato 07, CA8: a confirmação avisa que os arquivos da pasta ficam, e eles ficam.
  const confirmText = await text(contents, '[aria-label="Confirmar exclusão"] p')
  const ownFiles = readMeetings(ctx.userDataDir).find((m) => m.id === id)
  await clickSelector(contents, '[data-action="confirm-delete"]')
  await waitFor(contents, routeIs('reunioes'))
  recording['deleteKeepsFiles'] = {
    ok:
      confirmText === 'Excluir esta reunião? Os arquivos na pasta continuam.' &&
      typeof ownFiles?.audioPath === 'string' &&
      existsSync(ownFiles.audioPath) &&
      // Sem trecho (esta gravação não tem transcrição), não há .md.
      (ownFiles.transcriptPath === null || existsSync(ownFiles.transcriptPath)),
    detail: `confirmação "${confirmText}"; depois de excluir: áudio existe=${ownFiles?.audioPath ? existsSync(ownFiles.audioPath) : 'sem caminho'}, .md existe=${ownFiles?.transcriptPath ? existsSync(ownFiles.transcriptPath) : 'sem caminho'}`,
  }
  recording['deleteWithConfirmation'] = {
    ok: asked && keptWhileAsking && (await currentRoute(contents)) === 'reunioes' && !readMeetings(ctx.userDataDir).some((m) => m.id === id),
    detail: `"Excluir" pediu confirmação=${asked}, manteve até confirmar=${keptWhileAsking}; depois rota ${await currentRoute(contents)}, ${readMeetings(ctx.userDataDir).length} registros`,
  }

  const newRecording = Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.newRecording)
  newRecording?.click()
  const menuLive = await waitFor(contents, `${routeIs('gravacao')} && ${bothLive}`)
  navigation['menuNovaGravacao'] = {
    ok: newRecording?.accelerator === 'CmdOrCtrl+N' && menuLive,
    detail: `menu "${newRecording?.label ?? '?'}" (${newRecording?.accelerator ?? '?'}) -> rota ${await currentRoute(contents)}, captura ${JSON.stringify(await captureState(contents))}`,
  }
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'))
}

function readSettings(userDataDir: string): Partial<AppSettings> {
  const file = join(userDataDir, SETTINGS_FILE)
  if (!existsSync(file)) return {}
  return (JSON.parse(readFileSync(file, 'utf8')) as { settings: Partial<AppSettings> }).settings
}

/** Escreve num campo controlado pelo React (setter nativo + evento), como a digitação faria. */
async function setValue(contents: WebContents, selector: string, value: string, event: 'input' | 'change' = 'input'): Promise<void> {
  const found = await evaluate<boolean>(
    contents,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }))
      return true
    })()`,
  )
  if (!found) throw new Error(`campo não encontrado: ${selector}`)
}

const text = (contents: WebContents, selector: string): Promise<string> =>
  evaluate<string>(contents, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

const KEY_STATUS = '[data-key-status]'
const PERMISSION = (name: 'mic' | 'system'): string => `document.querySelector('[data-permission="${name}"]')`
const permissionState = (contents: WebContents, name: 'mic' | 'system'): Promise<string> =>
  evaluate<string>(contents, `${PERMISSION(name)}?.dataset.state ?? ''`)

/** Configurações prontas para a foto: chave conferida e catálogo carregado. */
async function settingsReady(contents: WebContents): Promise<boolean> {
  return waitFor(contents, `${routeIs('configuracoes')} && document.querySelector('[data-key-state="valid"]') && document.querySelector('[data-model-picker="ready"]')`, 8000)
}

/** Abre a aba "Claude", rola até o "Modelo de tradução" e marca um modelo não liberado. */
async function openModelPicker(contents: WebContents): Promise<boolean> {
  await selectSettingsTab(contents, 'claude')
  await evaluate(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]')
      const section = document.querySelector('section[aria-label="Modelo de tradução"]')
      scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      return true
    })()`,
  )
  await clickSelector(contents, `[data-model="${SMOKE_NOT_ALLOWED_MODEL}"]`)
  // A lista fica no topo: o modelo atual com a marca na primeira linha e o não liberado logo abaixo,
  // como no mockup aprovado (do mais barato ao mais caro, o gpt-oss-20b cai na quinta linha).
  const marked = await waitFor(
    contents,
    `document.querySelector('[data-model="${SMOKE_NOT_ALLOWED_MODEL}"]')?.dataset.modelState === 'not-allowed' && document.querySelector('[data-model]')?.dataset.modelState === 'selected'`,
  )
  return marked
}

/**
 * CA16: nenhum controle de Configurações fica sob a faixa arrastável de 52 px (ou, se ficar, tem
 * `no-drag`) em nenhuma posição da rolagem; depois de rolar até o fim e voltar, um clique de verdade no
 * primeiro controle à mostra (desde o contrato 18, o nome do app, na aba "Geral") dá foco a ele.
 */
async function settingsReachable(contents: WebContents): Promise<Check> {
  const result = await evaluate<{ scrollerTop: number; positions: number; blocked: string[]; first: { x: number; y: number; id: string } | null }>(
    contents,
    `(() => {
      const STRIP = 52
      const scroller = document.querySelector('[data-settings-scroll]')
      const controls = () => [...document.querySelectorAll('main input, main select, main button, main a[href], main [tabindex]')]
      const blocked = new Set()
      let positions = 0
      const check = () => {
        positions++
        const sr = scroller.getBoundingClientRect()
        for (const el of controls()) {
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height) continue
          const inside = scroller.contains(el)
          const top = inside ? Math.max(r.top, sr.top) : r.top
          const bottom = inside ? Math.min(r.bottom, sr.bottom) : r.bottom
          if (bottom <= top || top >= STRIP) continue
          let node = el, region = ''
          while (node && !region) { const v = getComputedStyle(node).getPropertyValue('app-region') || getComputedStyle(node).getPropertyValue('-webkit-app-region'); if (v && v !== 'none' && v !== 'auto') region = v; node = node.parentElement }
          if (region !== 'no-drag') blocked.add(el.outerHTML.slice(0, 80))
        }
      }
      for (let y = 0; y <= scroller.scrollHeight; y += 80) { scroller.scrollTop = y; check() }
      scroller.scrollTop = scroller.scrollHeight
      check()
      scroller.scrollTop = 0
      check()
      const first = controls().find((el) => scroller.contains(el) && el.getBoundingClientRect().width > 0)
      const r = first?.getBoundingClientRect()
      const scrollerTop = Math.round(scroller.getBoundingClientRect().top)
      return { scrollerTop, positions, blocked: [...blocked], first: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: first.id } : null }
    })()`,
  )
  let focused = ''
  if (result.first) {
    await evaluate(contents, 'document.activeElement instanceof HTMLElement && document.activeElement.blur(), true')
    const { x, y } = result.first
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await wait(150)
    focused = await evaluate<string>(contents, 'document.activeElement?.id ?? ""')
  }
  return {
    ok: result.scrollerTop >= 52 && result.blocked.length === 0 && result.first !== null && focused === result.first.id && focused !== '',
    detail: `área que rola começa em y=${result.scrollerTop}; ${result.positions} posições de rolagem conferidas, controles sob a faixa sem no-drag: ${result.blocked.length ? result.blocked.join(' | ') : 'nenhum'}; clique no primeiro controle (#${result.first?.id ?? '?'}) -> foco em #${focused || 'nada'}`,
  }
}

/**
 * Bloco de permissões (CA12), tema claro, logo depois da foto de Reuniões: microfone "não pedido" com
 * "Permitir" (o substituto concede sem diálogo), negado com o link para os Ajustes, releitura ao ganhar
 * foco, e o áudio do sistema "não verificado" antes da primeira captura.
 */
async function permissionChecks(contents: WebContents, fixtures: SmokeFixtures): Promise<Check> {
  const before = { mic: await permissionState(contents, 'mic'), system: await permissionState(contents, 'system'), systemText: await evaluate<string>(contents, `${PERMISSION('system')}?.textContent ?? ''`) }
  const allowButton = await evaluate<boolean>(contents, `Boolean(${PERMISSION('mic')}?.querySelector('[data-action="allow-mic"]'))`)
  await clickSelector(contents, '[data-action="allow-mic"]')
  const granted = await waitFor(contents, `${PERMISSION('mic')}?.dataset.state === 'granted' && ${PERMISSION('mic')}.textContent.includes('concedido')`)
  const asked = fixtures.media.asked

  fixtures.media.set('denied')
  await evaluate(contents, "window.dispatchEvent(new Event('focus')), true")
  const denied = await waitFor(contents, `${PERMISSION('mic')}?.dataset.state === 'denied'`)
  const href = await evaluate<string>(contents, `${PERMISSION('mic')}?.querySelector('a')?.getAttribute('href') ?? ''`)
  const opened = fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="open-mic-settings"]')
  await wait(100)
  const openedUrl = fixtures.openedUrls.slice(opened).join(', ')

  fixtures.media.set('granted')
  await evaluate(contents, "window.dispatchEvent(new Event('focus')), true")
  const back = await waitFor(contents, `${PERMISSION('mic')}?.dataset.state === 'granted'`)
  return {
    ok:
      before.mic === 'not-determined' &&
      allowButton &&
      before.system === 'unknown' &&
      before.systemText.includes('não verificado') &&
      granted &&
      asked === 1 &&
      denied &&
      href === PRIVACY_PANE_URLS.microphone &&
      openedUrl === PRIVACY_PANE_URLS.microphone &&
      back,
    detail: `início: microfone ${before.mic} (Permitir=${allowButton}), sistema ${before.system} ("${before.systemText}"); Permitir -> ${granted ? 'concedido' : 'falhou'} (${asked} pedido ao substituto); negado + foco -> ${denied}, link ${href}, clique abriu ${openedUrl || 'nada'}; concedido + foco -> ${back}`,
  }
}

/**
 * Configurações no tema claro, depois das fotos: chave (CA4, CA5), seletor (CA7, CA8), áudio (CA9, CA17),
 * idiomas e barra da gravação (CA10). Termina com tudo de volta ao padrão e a chave fictícia salva.
 */
async function settingsChecks(win: BrowserWindow, ctx: SmokeContext, checks: Record<string, Check>): Promise<void> {
  const contents = win.webContents
  const { fixtures, userDataDir } = ctx
  const keyInput = '#assemblyai-key'
  const keyStatus = (): Promise<{ configured: boolean; last4: string | null; source: string | null }> => evaluate(contents, "window.__scribeApi.invoke('scribe:key-status')")
  const saveKey = async (key: string): Promise<void> => {
    await setValue(contents, keyInput, key)
    await clickSelector(contents, '[data-action="save-key"]')
    await wait(50)
    await waitFor(contents, `document.querySelector('[data-key-state]') && !document.querySelector('${KEY_STATUS}')?.textContent.includes('Verificando')`)
    await wait(100)
  }

  await openSettingsTab(contents, 'geral')
  if (!(await settingsReady(contents))) throw new Error('Configurações não ficaram prontas')
  checks['reachable'] = await settingsReachable(contents)
  // Contrato 18: a chave fica no bloco "Transcrição" da aba "Gravação"; o seletor de modelo, na aba "Claude".
  await selectSettingsTab(contents, 'gravacao')

  // CA5: campo de senha, só os quatro últimos, frase do Chaveiro e "Criar chave".
  const field = await evaluate<{ type: string; value: string; help: string; link: string }>(
    contents,
    `(() => ({ type: document.querySelector('${keyInput}').type, value: document.querySelector('${keyInput}').value, help: document.querySelector('#assemblyai-key-help').textContent, link: document.querySelector('[data-action="create-key"]').getAttribute('href') }))()`,
  )
  const statusText = await text(contents, KEY_STATUS)
  const openedBefore = fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="create-key"]')
  await wait(100)
  checks['keyField'] = {
    ok:
      field.type === 'password' &&
      field.value === '' &&
      statusText === 'Chave válida · termina em ••••4f2a' &&
      !(await evaluate<string>(contents, 'document.body.innerText')).includes(SMOKE_FAKE_KEY) &&
      field.help.includes('Guardada cifrada neste Mac, protegida pelo Chaveiro do macOS.') &&
      field.link === ASSEMBLYAI_DASHBOARD_URL &&
      fixtures.openedUrls.slice(openedBefore).join() === ASSEMBLYAI_DASHBOARD_URL,
    detail: `type=${field.type}, valor no campo="${field.value}", estado "${statusText}", "Criar chave" -> ${fixtures.openedUrls.slice(openedBefore).join() || 'nada'}`,
  }

  // CA4: recusada não salva; sem rede salva com "Tentar de novo"; válida salva.
  await saveKey(SMOKE_REFUSED_KEY)
  const refusedText = await text(contents, KEY_STATUS)
  const afterRefused = await keyStatus()
  await setValue(contents, keyInput, '')
  await saveKey(SMOKE_OFFLINE_KEY)
  const offlineNotice = await text(contents, '[data-notice="key-unverified"]')
  const afterOffline = await keyStatus()
  await saveKey(SMOKE_FAKE_KEY)
  const validText = await text(contents, KEY_STATUS)
  const afterValid = await keyStatus()
  checks['keySave'] = {
    ok:
      refusedText === 'Chave recusada pela AssemblyAI' &&
      afterRefused.last4 === '4f2a' &&
      offlineNotice.includes('Não foi possível verificar agora') &&
      offlineNotice.includes('Tentar de novo') &&
      afterOffline.last4 === SMOKE_OFFLINE_KEY.slice(-4) &&
      validText === 'Chave válida · termina em ••••4f2a' &&
      afterValid.last4 === '4f2a' &&
      afterValid.source === 'saved',
    detail: `401 -> "${refusedText}", guardada continua ••••${afterRefused.last4}; sem rede -> "${offlineNotice}", guardada ••••${afterOffline.last4}; válida -> "${validText}"`,
  }

  // CA8: busca por nome ou id, sem maiúsculas nem acentos.
  await selectSettingsTab(contents, 'claude')
  await waitFor(contents, "document.querySelector('[data-model-picker=\"ready\"]')")
  const search = async (query: string): Promise<{ ids: string[]; count: string }> => {
    await setValue(contents, '[data-model-search]', query)
    await wait(80)
    return evaluate(contents, `({ ids: [...document.querySelectorAll('[data-model]')].map((el) => el.dataset.model), count: document.querySelector('[data-model-search]').nextElementSibling.textContent })`)
  }
  const byName = await search('FLASH LÍTE')
  const byId = await search('QWEN3.5-4B')
  const none = await search('modelo-que-nao-existe')
  await search('')
  const rowText = await text(contents, '[data-model="qwen3.5-4b-32k-fast"]')
  const selectedMark = await evaluate<boolean>(contents, `document.querySelector('[data-model="qwen3.5-4b-32k-fast"]')?.getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector('[data-model="qwen3.5-4b-32k-fast"] svg'))`)
  checks['modelSearch'] = {
    ok:
      byName.ids.length > 0 &&
      byName.ids.every((id) => id.includes('flash-lite')) &&
      byId.ids.join() === 'qwen3.5-4b-32k-fast' &&
      none.ids.length === 0 &&
      rowText.includes('US$ 0,10 / 0,50 por 1M') &&
      rowText.includes('32k') &&
      selectedMark,
    detail: `"FLASH LÍTE" -> ${byName.ids.join(', ')} (${byName.count}); "QWEN3.5-4B" -> ${byId.ids.join(', ')}; sem resultado -> ${none.ids.length}; linha atual "${rowText}", marca=${selectedMark}`,
  }

  // CA7: liberado grava; sem rede mantém a anterior e oferece "Tentar de novo".
  await clickSelector(contents, '[data-model="gpt-oss-120b"]')
  const switched = await waitFor(contents, `document.querySelector('[data-model="gpt-oss-120b"]')?.dataset.modelState === 'selected'`)
  const savedModel = readSettings(userDataDir).translationModel
  await clickSelector(contents, `[data-model="${SMOKE_OFFLINE_MODEL}"]`)
  const failed = await waitFor(contents, `document.querySelector('[data-notice="model-select-failed"]')`)
  const failedText = await text(contents, '[data-notice="model-select-failed"]')
  const keptModel = readSettings(userDataDir).translationModel
  await clickSelector(contents, '[data-model="qwen3.5-4b-32k-fast"]')
  const back = await waitFor(contents, `document.querySelector('[data-model="qwen3.5-4b-32k-fast"]')?.dataset.modelState === 'selected' && !document.querySelector('[data-notice="model-select-failed"]')`)
  const modelCalls = fixtures.calls.filter((call) => call.path === '/v1/chat/completions' && call.model !== null).map((call) => call.model)
  checks['modelSelect'] = {
    ok: switched && savedModel === 'gpt-oss-120b' && failed && failedText.includes('Tentar de novo') && keptModel === 'gpt-oss-120b' && back && readSettings(userDataDir).translationModel === DEFAULT_SETTINGS.translationModel,
    detail: `gpt-oss-120b -> selecionado=${switched}, settings.json ${savedModel}; ${SMOKE_OFFLINE_MODEL} sem rede -> "${failedText}", settings.json continua ${keptModel}; volta ao padrão=${back}; conferências no gateway: ${modelCalls.join(', ')}`,
  }

  // CA5 e CA8: remover pede confirmação; sem chave o seletor convida a adicionar.
  await selectSettingsTab(contents, 'gravacao')
  await clickSelector(contents, '[data-action="remove-key"]')
  const asked = await waitFor(contents, "document.querySelector('[data-action=\"confirm-remove-key\"]')")
  const keptWhileAsking = (await keyStatus()).configured
  await clickSelector(contents, '[data-action="confirm-remove-key"]')
  await selectSettingsTab(contents, 'claude')
  const invite = await waitFor(contents, `document.querySelector('[data-model-picker="no-key"] [data-notice="model-no-key"]')`)
  const removed = await keyStatus()
  const current = await evaluate<string>(contents, "document.querySelector('[data-current-model]')?.dataset.currentModel ?? ''")
  checks['keyRemoveAndInvite'] = {
    ok: asked && keptWhileAsking && !removed.configured && invite && current === DEFAULT_SETTINGS.translationModel,
    detail: `"Remover" pediu confirmação=${asked}, manteve até confirmar=${keptWhileAsking}; depois configured=${removed.configured}; seletor sem chave mostra o convite=${invite} e o modelo atual ${current}`,
  }

  // Contrato 18, CA2: "Adicionar chave" do seletor leva à aba "Gravação", ao bloco "Transcrição" e ao campo da chave.
  await clickSelector(contents, '[data-notice="model-no-key"] button')
  const addKeyTab = await waitFor(contents, settingsTabIs('gravacao'))
  const addKeyFocus = await waitFor(contents, `document.activeElement?.id === 'assemblyai-key'`)
  checks['addKeyLink'] = {
    ok: addKeyTab && addKeyFocus,
    detail: `"Adicionar chave" na aba Claude -> aba Gravação=${addKeyTab}, foco no campo da chave=${addKeyFocus}`,
  }

  // CA8: catálogo sem rede mostra o erro com "Tentar de novo" e o modelo atual pelo id.
  fixtures.failCatalog = true
  await saveKey(SMOKE_FAKE_KEY)
  await selectSettingsTab(contents, 'claude')
  const offlineCatalog = await waitFor(contents, `document.querySelector('[data-notice="models-load-failed"]')`)
  const offlineText = await text(contents, '[data-notice="models-load-failed"]')
  const offlineCurrent = await evaluate<string>(contents, "document.querySelector('[data-current-model]')?.dataset.currentModel ?? ''")
  fixtures.failCatalog = false
  await clickSelector(contents, '[data-notice="models-load-failed"] button')
  const recovered = await waitFor(contents, `document.querySelector('[data-model-picker="ready"]')`)
  checks['catalogOffline'] = {
    ok: offlineCatalog && offlineText.includes('Tentar de novo') && offlineCurrent === DEFAULT_SETTINGS.translationModel && recovered,
    detail: `catálogo sem rede -> "${offlineText}", modelo atual ${offlineCurrent}; "Tentar de novo" com rede -> lista=${recovered}`,
  }

  // CA10: origem e destino nunca iguais.
  await selectSettingsTab(contents, 'gravacao')
  // Os seletores são controlados: só mostram o valor novo quando o main devolve o que gravou.
  const languagesAre = (source: string, target: string): string =>
    `document.querySelector('#settings-source')?.value === '${source}' && document.querySelector('#settings-target')?.value === '${target}'`
  await setValue(contents, '#settings-target', 'pt', 'change')
  await waitFor(contents, languagesAre('en', 'pt'))
  const swapped = readSettings(userDataDir)
  const swappedUi = await evaluate<{ source: string; target: string }>(contents, "({ source: document.querySelector('#settings-source').value, target: document.querySelector('#settings-target').value })")
  await setValue(contents, '#settings-source', 'pt', 'change')
  await waitFor(contents, languagesAre('pt', 'en'))
  const restored = readSettings(userDataDir)
  checks['languages'] = {
    ok: swapped.sourceLanguage === 'en' && swapped.targetLanguage === 'pt' && swappedUi.source === 'en' && swappedUi.target === 'pt' && restored.sourceLanguage === 'pt' && restored.targetLanguage === 'en',
    detail: `destino = origem (pt) -> settings.json ${swapped.sourceLanguage} → ${swapped.targetLanguage}, tela ${swappedUi.source} → ${swappedUi.target}; origem = destino de volta -> ${restored.sourceLanguage} → ${restored.targetLanguage}`,
  }

  // CA9: microfone e cancelamento de eco gravam; um microfone que sumiu aparece como indisponível.
  await setValue(contents, '#settings-mic', 'smoke-usb', 'change')
  await waitFor(contents, "document.querySelector('#settings-mic')?.value === 'smoke-usb'")
  const micSaved = readSettings(userDataDir).micDeviceId
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { micDeviceId: 'microfone-que-sumiu' }).then(() => true)")
  await waitFor(contents, "document.querySelector('#settings-mic')?.value === 'microfone-que-sumiu'")
  const unavailable = await evaluate<string>(contents, "document.querySelector('#settings-mic')?.selectedOptions[0]?.textContent ?? ''")
  const micLabels = await evaluate<string[]>(contents, "[...document.querySelectorAll('#settings-mic option')].map((o) => o.textContent)")
  await clickSelector(contents, '[role="switch"][aria-labelledby="settings-echo"]')
  await waitFor(contents, "document.querySelector('[aria-labelledby=\"settings-echo\"]')?.getAttribute('aria-checked') === 'true'")
  const echoSaved = readSettings(userDataDir).echoCancellation
  const echoUi = await evaluate<string>(contents, "document.querySelector('[aria-labelledby=\"settings-echo\"]')?.getAttribute('aria-checked') ?? ''")
  checks['audio'] = {
    ok: micSaved === 'smoke-usb' && unavailable === 'Dispositivo indisponível' && micLabels[0] === 'Padrão do sistema' && echoSaved === true && echoUi === 'true',
    detail: `opções ${JSON.stringify(micLabels)}; escolher "Microfone USB" -> settings.json ${micSaved}; id salvo que sumiu -> "${unavailable}"; cancelamento de eco -> settings.json ${echoSaved}, aria-checked=${echoUi}`,
  }

  // CA10, CA17 e CA9: sem tradução, a barra mostra só o idioma de origem e nenhum modelo; a gravação usa o
  // eco ligado e, com o microfone salvo sumido, o padrão (sem deviceId).
  await clickSelector(contents, '[role="switch"][aria-labelledby="settings-translate"]')
  await waitFor(contents, "document.querySelector('[aria-labelledby=\"settings-translate\"]')?.getAttribute('aria-checked') === 'false'")
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('main [data-action="new-recording"]')`)
  await clickSelector(contents, 'main [data-action="new-recording"]')
  await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  const constraints = await evaluate<{ audio?: { echoCancellation?: boolean; deviceId?: unknown } } | null>(contents, `${probeJs('micConstraints()')} ?? null`)
  const barOff = await text(contents, '[role="toolbar"]')
  const modelTagOff = await evaluate<boolean>(contents, "Boolean(document.querySelector('[role=\"toolbar\"] .font-mono'))")
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEnabled: true, sourceLanguage: 'es', targetLanguage: 'ja' }).then(() => true)")
  await waitFor(contents, "document.querySelector('[role=\"toolbar\"]')?.textContent.includes('ES → JA')")
  const barOn = await text(contents, '[role="toolbar"]')
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'))
  checks['recordingUsesSettings'] = {
    ok:
      constraints?.audio?.echoCancellation === true &&
      constraints.audio.deviceId === undefined &&
      barOff.includes('PT') &&
      !barOff.includes('→') &&
      !modelTagOff &&
      barOn.includes('ES → JA') &&
      barOn.includes(DEFAULT_SETTINGS.translationModel),
    detail: `restrições do microfone ${JSON.stringify(constraints)}; barra sem tradução "${barOff}" (etiqueta de modelo=${modelTagOff}); com tradução ES → JA "${barOn}"`,
  }

  // `translationModel`, `claudePath`, `audioFolder` e `brandLogo` não passam pelo canal de configurações; o modelo já
  // voltou ao padrão pelo seletor, e o caminho do `claude` e a pasta dos arquivos nunca saíram do padrão.
  const { translationModel: _model, claudePath: _claudePath, audioFolder: _audioFolder, brandLogo: _brandLogo, ...resettable } = DEFAULT_SETTINGS
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', ${JSON.stringify(resettable)}).then(() => true)`)
  const reset = readSettings(userDataDir)
  if (JSON.stringify(reset) !== JSON.stringify(DEFAULT_SETTINGS)) checks['reset'] = { ok: false, detail: `padrões não voltaram: ${JSON.stringify(reset)}` }
  // Contrato 17: o padrão é o agente; o resto do smoke segue na linha de comando até o bloco do ACP.
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'cli' }).then(() => true)")
}

/** Contrato 05, CA10: "Traduzir com" em Claude CLI, com o binário falso encontrado. */
async function showClaudeSettings(contents: WebContents): Promise<boolean> {
  await selectSettingsTab(contents, 'claude')
  await clickSelector(contents, '[data-engine-option="claude-cli"]')
  const found = await waitFor(contents, `document.querySelector('[data-claude-state="found"]') && !document.querySelector('[data-model-picker]')`, 8000)
  await evaluate(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]')
      const section = document.querySelector('section[aria-label="Modelo de tradução"]')
      scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      return true
    })()`,
  )
  return found
}

/**
 * Contrato 05 no tema claro, com o binário falso: estado e modelo em Configurações (CA10), um trecho de
 * ponta a ponta pelo processo (CA4, CA6, CA9, CA12), "não encontrado" com o campo do caminho e o aviso
 * na gravação (CA11). Termina com o motor de volta na AssemblyAI.
 */
async function claudeChecks(win: BrowserWindow, ctx: SmokeContext): Promise<Check> {
  const contents = win.webContents
  const { fixtures, userDataDir } = ctx
  const statusText = await text(contents, '[data-claude-status]')
  const engineSaved = readSettings(userDataDir).translationEngine
  const modelLabels = await evaluate<string[]>(contents, "[...document.querySelectorAll('[data-claude-model-option]')].map((el) => el.textContent)")
  await clickSelector(contents, '[data-claude-model-option="sonnet"]')
  await waitFor(contents, `document.querySelector('[data-claude-model-option="sonnet"]')?.getAttribute('aria-pressed') === 'true'`)
  const sonnetSaved = readSettings(userDataDir).claudeModel
  await clickSelector(contents, '[data-claude-model-option="haiku"]')
  await waitFor(contents, `document.querySelector('[data-claude-model-option="haiku"]')?.getAttribute('aria-pressed') === 'true'`)

  // Um trecho pelo processo falso, pelos mesmos canais da gravação.
  const spawnsBefore = fixtures.claudeSpawns.length
  const started = await evaluate<{ ok: boolean; version?: string }>(contents, "window.__scribeApi.invoke('scribe:claude-start')")
  const translated = await evaluate<{ ok: boolean; translation?: string; model?: string }>(
    contents,
    "window.__scribeApi.invoke('scribe:claude-translate', { segmentId: 'mic-smoke-0', source: 'mic', turnOrder: 0, text: 'Alguma dúvida até aqui?' })",
  )
  await evaluate(contents, "window.__scribeApi.invoke('scribe:claude-stop')")
  const spawn = fixtures.claudeSpawns[spawnsBefore]
  for (let attempt = 0; attempt < 40 && spawn && !spawn.exited; attempt++) await wait(50)
  const allowedEnv = ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']
  const spawnOk =
    fixtures.claudeSpawns.length === spawnsBefore + 1 &&
    spawn !== undefined &&
    spawn.exited &&
    spawn.args.includes('--strict-mcp-config') &&
    spawn.args.includes('--no-session-persistence') &&
    !spawn.args.join(' ').includes('Alguma dúvida') &&
    spawn.cwd === join(userDataDir, 'claude-cwd') &&
    spawn.envNames.every((name) => allowedEnv.includes(name))

  // Binário sumido: "não encontrado" com o campo do caminho; caminho que não responde é recusado.
  fixtures.claudeMissing = true
  await clickSelector(contents, '[data-engine-option="assemblyai"]')
  await waitFor(contents, "document.querySelector('[data-model-picker]')")
  await clickSelector(contents, '[data-engine-option="claude-cli"]')
  // Com "Resumir ao encerrar" ligado, o estado do Claude CLI também aparece no motor AssemblyAI (contrato
  // 08): espera o bloco do motor Claude, não o anterior.
  await waitFor(contents, `!document.querySelector('[data-model-picker]') && document.querySelector('[data-claude-model-option]')`)
  const notFound = await waitFor(contents, `document.querySelector('[data-claude-state="not-found"]') && document.querySelector('#claude-path') && document.querySelector('[data-action="use-claude-path"]')`)
  const notFoundText = await text(contents, '[data-claude-status]')
  await setValue(contents, '#claude-path', '/tmp/nao-existe/claude')
  await clickSelector(contents, '[data-action="use-claude-path"]')
  const rejected = await waitFor(contents, "document.querySelector('[data-claude-path-rejected]')")
  const pathKept = readSettings(userDataDir).claudePath ?? null

  // CA11: gravação com o Claude CLI não encontrado mostra o aviso com o caminho para Configurações.
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, "document.querySelector('main header [data-action=\"new-recording\"]')")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  const notice = await waitFor(contents, "document.querySelector('[data-notice=\"claude-not-found\"]')")
  const noticeText = await text(contents, '[data-notice="claude-not-found"]')
  const spawnsWhileMissing = fixtures.claudeSpawns.length
  await clickSelector(contents, '[data-action="open-settings-from-claude"]')
  // Contrato 18, CA2: abre a aba "Claude".
  const toSettings = await waitFor(contents, `${routeIs('configuracoes')} && ${settingsTabIs('claude')}`)
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, "document.querySelector('main header [data-action=\"new-recording\"]')")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  await waitFor(contents, routeIs('gravacao'))
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'))
  fixtures.claudeMissing = false

  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { translationEngine: 'assemblyai' }).then(() => true)")
  const back = readSettings(userDataDir).translationEngine
  return {
    ok:
      statusText.includes('Claude Code 2.1.312 encontrado') &&
      engineSaved === 'claude-cli' &&
      JSON.stringify(modelLabels) === JSON.stringify(['Haiku (mais rápido)', 'Sonnet']) &&
      sonnetSaved === 'sonnet' &&
      started.ok &&
      started.version === '2.1.312' &&
      translated.ok &&
      translated.translation === '[EN] Alguma dúvida até aqui?' &&
      translated.model === 'claude-cli:haiku' &&
      spawnOk &&
      notFound &&
      notFoundText.includes('Claude CLI não encontrado nesta máquina') &&
      rejected &&
      pathKept === null &&
      notice &&
      noticeText.includes('Claude CLI não encontrado. Ajuste em Configurações.') &&
      spawnsWhileMissing === spawnsBefore + 1 &&
      toSettings &&
      back === 'assemblyai',
    detail: `estado "${statusText}", settings.json ${engineSaved}; modelos ${JSON.stringify(modelLabels)}, Sonnet -> ${sonnetSaved}; início ${JSON.stringify(started)}; trecho -> ${JSON.stringify(translated)}; processo ${JSON.stringify(spawn ? { ...spawn, args: spawn.args.filter((arg) => arg.startsWith('--')) } : null)}; sem binário -> "${notFoundText}", campo=${notFound}, caminho errado recusado=${rejected} (claudePath ${pathKept}); gravação -> aviso "${noticeText}", Configurações=${toSettings}; motor de volta ${back}`,
  }
}

/**
 * CA10 e CA11: sem chave, a coluna mostra a frase do estado, o botão para Configurações e "Ver exemplo";
 * a captura (níveis, cronômetro e registro) continua igual. Com chave, o link de exemplo some.
 */
async function transcriptionChecks(win: BrowserWindow, recording: Record<string, Check>): Promise<void> {
  const contents = win.webContents
  const routeToReunioes = '[data-nav="reunioes"]'
  await evaluate(contents, "window.__scribeApi.invoke('scribe:key-remove').then(() => true)")
  await clickSelector(contents, routeToReunioes)
  await waitFor(contents, "document.querySelector('main header [data-action=\"new-recording\"]')")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  const live = await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  const shown = await waitFor(contents, `document.querySelector('[data-transcript-state="no-key"]')`)
  const noKeyText = await text(contents, '[data-transcript-state="no-key"]')
  await clickSelector(contents, '[data-action="show-example"]')
  const example = await waitFor(contents, `document.querySelector('[data-transcript-state="example"]')`)
  await clickSelector(contents, '[data-action="hide-example"]')
  await waitFor(contents, `document.querySelector('[data-transcript-state="no-key"]')`)
  await clickSelector(contents, '[data-action="open-settings-from-transcript"]')
  // Contrato 18, CA2: `/configuracoes/gravacao#transcricao` (aba "Gravação", rolada até "Transcrição").
  const wentToSettings = await waitFor(contents, `${routeIs('configuracoes')} && ${settingsTabIs('gravacao')} && ${anchoredAt('Transcrição')}`)
  // Devolve a chave fictícia (o gateway de fixtures aceita) e encerra a gravação sem chave.
  const started = await captureState(contents)
  await evaluate(contents, `window.__scribeApi.invoke('scribe:key-save', { key: ${JSON.stringify(SMOKE_FAKE_KEY)} }).then(() => true)`)
  await clickSelector(contents, routeToReunioes)
  await waitFor(contents, "document.querySelector('main header [data-action=\"new-recording\"]')")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'))
  // Com chave, uma gravação nova não mostra o estado sem chave nem o link de exemplo.
  await clickSelector(contents, routeToReunioes)
  await waitFor(contents, "document.querySelector('main header [data-action=\"new-recording\"]')")
  await clickSelector(contents, 'main header [data-action="new-recording"]')
  await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  const withKey = await waitFor(contents, `!document.querySelector('[data-transcript-state="no-key"]')`)
  const exampleWithKey = await evaluate<boolean>(contents, "Boolean(document.querySelector('[data-action=\"show-example\"]'))")
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'))
  recording['noKeyState'] = {
    ok:
      live &&
      shown &&
      noKeyText.includes('Adicione sua chave da AssemblyAI para transcrever.') &&
      noKeyText.includes('Abrir Configurações') &&
      noKeyText.includes('Ver exemplo') &&
      example &&
      wentToSettings &&
      withKey &&
      !exampleWithKey,
    detail: `sem chave -> captura ${JSON.stringify(started)}, aviso=${shown} "${noKeyText}"; exemplo=${example}; "Abrir Configurações" -> ${wentToSettings}; com chave -> link de exemplo=${exampleWithKey}`,
  }
}

/** CA11: na janela sem tema forçado, "Claro", "Escuro" e "Sistema" trocam o tema na hora e gravam. */
async function appearanceCheck(contents: WebContents, userDataDir: string): Promise<Check> {
  const theme = (value: string): string => `document.documentElement.dataset.theme === '${value}'`
  // A opção só fica marcada quando o main devolve o que gravou: ler o arquivo antes disso é corrida.
  const pressed = (option: string): string => `document.querySelector('[data-theme-option="${option}"]')?.getAttribute('aria-pressed') === 'true'`
  await clickSelector(contents, '[data-nav="configuracoes"]')
  await waitFor(contents, `${routeIs('configuracoes')} && ${pressed('system')}`)
  // Ponto de partida conhecido: o macOS claro já aplicado, qualquer que seja o tema da máquina.
  nativeTheme.themeSource = 'light'
  const start = await waitFor(contents, theme('light'))
  await clickSelector(contents, '[data-theme-option="dark"]')
  const dark = await waitFor(contents, `${pressed('dark')} && ${theme('dark')}`)
  const savedDark = readSettings(userDataDir).theme
  await clickSelector(contents, '[data-theme-option="light"]')
  const light = await waitFor(contents, `${pressed('light')} && ${theme('light')}`)
  const savedLight = readSettings(userDataDir).theme
  nativeTheme.themeSource = 'dark'
  // O macOS escuro não pode mudar nada com "Claro" escolhido: espera o tempo de a troca chegar e confere.
  await waitFor(contents, "window.matchMedia('(prefers-color-scheme: dark)').matches")
  await wait(150)
  const keptLight = (await evaluate<string>(contents, 'document.documentElement.dataset.theme')) === 'light'
  await clickSelector(contents, '[data-theme-option="system"]')
  const system = await waitFor(contents, `${pressed('system')} && ${theme('dark')}`)
  const savedSystem = readSettings(userDataDir).theme
  nativeTheme.themeSource = 'system'
  return {
    ok: start && dark && savedDark === 'dark' && light && savedLight === 'light' && keptLight && system && savedSystem === 'system',
    detail: `macOS claro -> light=${start}; Escuro -> marcado e data-theme dark=${dark}, settings.json ${savedDark}; Claro -> light=${light}, ${savedLight}, com o macOS escuro continua claro=${keptLight}; Sistema -> segue o macOS=${system}, ${savedSystem}`,
  }
}

type LayoutScreen = 'configuracoes' | 'gravacao' | 'detalhe'

/**
 * Medidas em px lógicos contra os mockups aprovados (docs/specs/desktop-shell/mockups): barra lateral de
 * 224, item de navegação de 40, quadrado de permissão de 6, conteúdo a 28 do topo (24 no detalhe) e 40 da
 * lateral, campo, seletor e botão de 40, linha de configuração de 64 no mínimo, linha de modelo de 56,
 * fita de 96, calha da transcrição de 64 e as linhas de texto/tradução de 26/22. Lidas da tela, para a
 * escala de espaço não encolher de novo.
 */
async function layoutMetrics(contents: WebContents, screen: LayoutScreen): Promise<Record<string, number>> {
  return evaluate(
    contents,
    `(() => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null
      const main = box('main')
      const header = document.querySelector('main header')
      const round = (n) => Math.round(n * 10) / 10
      const lineHeight = (selector) => round(parseFloat(getComputedStyle(document.querySelector(selector)).lineHeight))
      const out = {
        sidebarWidth: round(box('aside')?.width ?? 0),
        navItemHeight: round(box('[data-nav="reunioes"]')?.height ?? 0),
        permissionSquare: round(box('[data-permission="mic"] span[aria-hidden="true"]')?.width ?? 0),
      }
      if (${JSON.stringify(screen)} === 'configuracoes') {
        const title = box('main h1')
        Object.assign(out, {
          contentTop: round(title.top - main.top),
          contentLeft: round(title.left - main.left),
          inputHeight: round(box('#assemblyai-key').height),
          selectHeight: round(box('#settings-mic').height),
          buttonHeight: round(box('[data-action="save-key"]').height),
          settingRowHeight: round(document.querySelector('#settings-source').closest('[data-setting-row]').getBoundingClientRect().height),
        })
      } else {
        const style = getComputedStyle(header)
        Object.assign(out, {
          contentTop: round(box('main header').top - main.top + parseFloat(style.paddingTop)),
          contentLeft: round(box('main header').left - main.left + parseFloat(style.paddingLeft)),
          transcriptGutter: round(parseFloat(getComputedStyle(document.querySelector('[data-transcript-list] li')).gridTemplateColumns)),
        })
        if (${JSON.stringify(screen)} === 'gravacao') {
          out.tapeHeight = round(box('[aria-label="Níveis de áudio de você e dos participantes"]').height)
        } else {
          out.transcriptTextLineHeight = lineHeight('[data-transcript-text]')
          out.transcriptTranslationLineHeight = lineHeight('[data-transcript-translation]')
          out.copyButtonHeight = round(box('[data-action="copy-transcript"]').height)
        }
      }
      return out
    })()`,
  )
}

interface Expectation {
  min: number
  max: number
}

const COMMON_LAYOUT: Record<string, Expectation> = {
  sidebarWidth: { min: 224, max: 224 },
  navItemHeight: { min: 40, max: 40 },
  permissionSquare: { min: 6, max: 6 },
  contentLeft: { min: 40, max: 40 },
  transcriptGutter: { min: 64, max: 64 },
}

const SCREEN_LAYOUT: Record<LayoutScreen, Record<string, Expectation>> = {
  configuracoes: {
    contentTop: { min: 28, max: 28 },
    // Contrato 18: coluna de leitura de até 760 px, centralizada (na janela de 1120, a 68 px da lateral, mais a
    // reserva da barra de rolagem quando ela não é sobreposta).
    contentLeft: { min: 40, max: 100 },
    columnWidth: { min: 600, max: 760 },
    columnCentered: { min: 0, max: 0.5 },
    headerAlign: { min: 0, max: 0.5 },
    // Só registra a largura reservada para a barra (0 com a barra sobreposta do macOS).
    scrollbarGutter: { min: 0, max: 40 },
    tabsShiftOnScroll: { min: 0, max: 0 },
    // Coluna dos controles: o mesmo `x` em todas as linhas de cada aba, com 1 px de tolerância.
    ...Object.fromEntries(SETTINGS_TABS.map((tab) => [`controlSpread_${tab}`, { min: 0, max: 0.5 }])),
    inputHeight: { min: 40, max: 40 },
    selectHeight: { min: 40, max: 40 },
    buttonHeight: { min: 40, max: 40 },
    settingRowHeight: { min: 64, max: 80 },
    modelRowHeight: { min: 56, max: 64 },
  },
  gravacao: {
    contentTop: { min: 28, max: 28 },
    tapeHeight: { min: 96, max: 96 },
  },
  detalhe: {
    // Mockup do detalhe: cabeçalho a 24 do topo, texto 16/26 e tradução 14/22.
    contentTop: { min: 24, max: 24 },
    transcriptTextLineHeight: { min: 26, max: 26 },
    transcriptTranslationLineHeight: { min: 22, max: 22 },
    copyButtonHeight: { min: 40, max: 40 },
  },
}

/**
 * Contrato 18: as medidas de Configurações na aba "Gravação" (campo, seletor, botão e linha), a linha de
 * modelo na aba "Claude" e, em cada aba, o alinhamento da coluna dos controles (o `x` do primeiro elemento
 * de cada `[data-setting-control]`), a largura e a centralização da coluna e as abas paradas ao rolar.
 */
async function settingsLayoutMetrics(contents: WebContents): Promise<Record<string, number>> {
  const round = (n: number): number => Math.round(n * 10) / 10
  await selectSettingsTab(contents, 'gravacao')
  const metrics = await layoutMetrics(contents, 'configuracoes')
  const column = await evaluate<{ width: number; tabsShift: number }>(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]')
      const tablist = document.querySelector('[role="tablist"]')
      const before = tablist.getBoundingClientRect().top
      scroller.scrollTop = scroller.scrollHeight
      const after = tablist.getBoundingClientRect().top
      scroller.scrollTop = 0
      return { width: document.querySelector('[data-settings-column]').getBoundingClientRect().width, tabsShift: Math.abs(after - before) }
    })()`,
  )
  metrics['columnWidth'] = round(column.width)
  metrics['tabsShiftOnScroll'] = round(column.tabsShift)
  // Em cada aba, no topo e rolada até o fim: a coluna centralizada na área principal (sem descontar a barra de
  // rolagem) e o título, as abas e a busca no mesmo `x` da coluna.
  let centered = 0
  let headerAlign = 0
  let scrollbar = 0
  await selectSettingsTab(contents, 'claude')
  await waitFor(contents, "document.querySelector('[data-model]')?.getBoundingClientRect().height > 0")
  metrics['modelRowHeight'] = round(await evaluate<number>(contents, "document.querySelector('[data-model]')?.getBoundingClientRect().height ?? 0"))
  for (const tab of SETTINGS_TABS) {
    await selectSettingsTab(contents, tab)
    const xs = await evaluate<number[]>(
      contents,
      `[...document.querySelectorAll('[data-settings-panel="${tab}"] [data-setting-control]')].map((el) => (el.firstElementChild ?? el).getBoundingClientRect().left)`,
    )
    if (xs.length > 1) metrics[`controlSpread_${tab}`] = round(Math.max(...xs) - Math.min(...xs))
    const aligned = await evaluate<{ centered: number; header: number; scrollbar: number }>(
      contents,
      `(() => {
        const scroller = document.querySelector('[data-settings-scroll]')
        const measure = () => {
          const main = document.querySelector('main').getBoundingClientRect()
          const col = document.querySelector('[data-settings-column]').getBoundingClientRect()
          const title = document.querySelector('main h1').getBoundingClientRect()
          const tabs = document.querySelector('[role="tablist"]').getBoundingClientRect()
          const search = document.querySelector('[data-settings-search]').getBoundingClientRect()
          return {
            centered: Math.abs((col.left - main.left) - (main.right - col.right)),
            header: Math.max(Math.abs(title.left - col.left), Math.abs(tabs.left - col.left), Math.abs(search.right - col.right)),
          }
        }
        const top = measure()
        scroller.scrollTop = scroller.scrollHeight
        const bottom = measure()
        scroller.scrollTop = 0
        return { centered: Math.max(top.centered, bottom.centered), header: Math.max(top.header, bottom.header), scrollbar: scroller.offsetWidth - scroller.clientWidth }
      })()`,
    )
    centered = Math.max(centered, aligned.centered)
    headerAlign = Math.max(headerAlign, aligned.header)
    scrollbar = Math.max(scrollbar, aligned.scrollbar)
  }
  metrics['columnCentered'] = round(centered)
  metrics['headerAlign'] = round(headerAlign)
  metrics['scrollbarGutter'] = round(scrollbar)
  return metrics
}

/**
 * Contrato 18, no claro: "Contas" vazia e sem botões; "Sobre" com versão, Electron e Chrome, o repositório
 * aberto no navegador e o atalho para "Atualizações"; a aba lembrada ao voltar; ⌘2/⌘6 e as setas; ⌘F e a
 * busca sem acento nem maiúscula, agrupada por aba, com o clique que leva à linha e a destaca por 2 s; Esc limpa.
 */
async function settingsTabsChecks(contents: WebContents, ctx: SmokeContext, shot: (name: string) => Promise<void>): Promise<Check> {
  const visibleText = (selector: string): Promise<string> => evaluate<string>(contents, `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)

  // Contas.
  const contasOpen = await openSettingsTab(contents, 'contas')
  const contas = await visibleText('[data-settings-panel="contas"]')
  const contasButtons = await evaluate<number>(contents, `document.querySelectorAll('[data-settings-panel="contas"] button').length`)
  await shot('configuracoes-contas-light')

  // Sobre.
  const sobreOpen = await selectSettingsTab(contents, 'sobre')
  await waitFor(contents, `document.querySelector('[data-settings-panel="sobre"]')?.innerText.includes(${JSON.stringify(process.versions.electron)})`)
  const sobre = await visibleText('[data-settings-panel="sobre"]')
  const openedBefore = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="open-repository"]')
  await wait(100)
  const opened = ctx.fixtures.openedUrls.slice(openedBefore).join()
  await shot('configuracoes-sobre-light')
  await clickSelector(contents, '[data-action="about-update-check"]')
  const toUpdates = await waitFor(contents, settingsTabIs('geral'))
  await wait(100)
  const updatesVisible = await evaluate<boolean>(
    contents,
    `(() => {
      const scroller = document.querySelector('[data-settings-scroll]').getBoundingClientRect()
      const box = document.querySelector('section[aria-label="Atualizações"]').getBoundingClientRect()
      return box.top >= scroller.top - 1 && box.top < scroller.bottom
    })()`,
  )

  // Aba lembrada na sessão.
  await selectSettingsTab(contents, 'claude')
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, routeIs('reunioes'))
  await clickSelector(contents, '[data-nav="configuracoes"]')
  const remembered = await waitFor(contents, `${routeIs('configuracoes')} && ${settingsTabIs('claude')}`)

  // Teclado: ⌘2, ⌘6 e a seta para a direita na lista de abas (da última, volta à primeira).
  const press = (key: string, meta: boolean): Promise<unknown> =>
    evaluate(contents, `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, metaKey: ${meta}, bubbles: true, cancelable: true })), true`)
  await press('2', true)
  const cmd2 = await waitFor(contents, settingsTabIs('gravacao'))
  const activeTab = `document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.dataset.tab : ''`
  const cmd2Focus = await evaluate<string>(contents, activeTab)
  await press('6', true)
  const cmd6 = await waitFor(contents, settingsTabIs('sobre'))
  await evaluate(contents, `document.querySelector('[role="tab"][data-tab="geral"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })), true`)
  const arrow = await waitFor(contents, settingsTabIs('geral'))

  // ⌘F e a busca.
  const input = '[data-settings-search] input'
  await press('f', true)
  const focused = await waitFor(contents, `document.activeElement === document.querySelector('${input}')`)
  await setValue(contents, input, 'TRADUCAO')
  await waitFor(contents, "document.querySelector('[data-settings-results]')")
  const groups = await evaluate<string[]>(contents, "[...document.querySelectorAll('[data-settings-results] [role=\"group\"]')].map((el) => el.getAttribute('aria-label'))")
  const items = await evaluate<string[]>(contents, "[...document.querySelectorAll('[data-settings-result]')].map((el) => el.innerText)")
  const panelsHidden = await evaluate<boolean>(contents, "[...document.querySelectorAll('[data-settings-panel]')].every((el) => el.hidden)")
  const noneSelected = await evaluate<boolean>(contents, `!document.querySelector('[role="tab"][aria-selected="true"]')`)
  const live = await evaluate<string>(contents, `(document.querySelector('[data-settings-results-count]')?.getAttribute('aria-live') ?? '') + ':' + (document.querySelector('[data-settings-results-count]')?.textContent ?? '')`)
  await shot('configuracoes-busca-light')
  await setValue(contents, input, 'modelo do chat')
  await waitFor(contents, "[...document.querySelectorAll('[data-settings-result]')].some((el) => el.innerText.includes('Claude › Modelo do chat'))")
  await evaluate(contents, "[...document.querySelectorAll('[data-settings-result]')].find((el) => el.innerText.includes('Claude › Modelo do chat'))?.click(), true")
  const row = `document.querySelector('[data-setting-row][data-setting-name="Modelo do chat"]')`
  const jumped = await waitFor(contents, `${settingsTabIs('claude')} && ${row}?.hasAttribute('data-highlighted')`)
  const inView = await evaluate<boolean>(
    contents,
    `(() => { const s = document.querySelector('[data-settings-scroll]').getBoundingClientRect(); const r = ${row}.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom })()`,
  )
  const cleared = (await evaluate<string>(contents, `document.querySelector('${input}').value`)) === ''
  const resultFocus = await evaluate<string>(contents, `${row}.contains(document.activeElement) ? document.activeElement.tagName + ':' + (document.activeElement.dataset.chatModelOption ?? '') : ''`)
  await wait(2300)
  const unhighlighted = await evaluate<boolean>(contents, `!${row}.hasAttribute('data-highlighted')`)
  await setValue(contents, input, 'tema')
  await waitFor(contents, "document.querySelector('[data-settings-results]')")
  await press('Escape', false)
  const escaped = await waitFor(contents, `document.querySelector('${input}').value === '' && !document.querySelector('[data-settings-results]') && ${settingsTabIs('claude')}`)
  const escFocus = await evaluate<string>(contents, activeTab)

  // Linha que só aparece em certa condição ("Modelo" do Claude, com a tradução na AssemblyAI): a busca acha
  // pelo índice, o clique leva à aba e ao bloco e explica quando ela aparece.
  await setValue(contents, input, 'haiku')
  const hiddenFound = await waitFor(contents, "[...document.querySelectorAll('[data-settings-result]')].some((el) => el.innerText.startsWith('Claude › Modelo\\n'))")
  await evaluate(contents, "[...document.querySelectorAll('[data-settings-result]')].find((el) => el.innerText.startsWith('Claude › Modelo\\n'))?.click(), true")
  const hintShown = await waitFor(contents, `${settingsTabIs('claude')} && document.querySelector('[data-notice="settings-hint"]')?.textContent === 'Esta opção aparece quando "Traduzir com" está em Claude CLI.'`)
  await setValue(contents, input, 'pasta')
  const pastaFound = await waitFor(contents, "[...document.querySelectorAll('[data-settings-result]')].some((el) => el.innerText.startsWith('Arquivos › Pasta\\n'))")
  await press('Escape', false)

  // O índice da busca cobre toda linha da tela (todas as abas estão montadas).
  const rows = await evaluate<{ tab: string; name: string }[]>(
    contents,
    `[...document.querySelectorAll('[data-settings-panel] [data-setting-row]')].map((el) => ({ tab: el.closest('[data-settings-panel]').dataset.settingsPanel, name: el.dataset.settingName ?? '' }))`,
  )
  const index = settingsIndex('Claude')
  const missing = rows.filter((row) => !index.some((entry) => entry.tab === row.tab && matchesRow(entry, row.name)))

  const ok =
    contasOpen &&
    contas.trim() === 'Em breve: Google Drive e agendas Google e Microsoft.' &&
    contasButtons === 0 &&
    sobreOpen &&
    sobre.includes(app.getVersion()) &&
    sobre.includes(process.versions.electron) &&
    sobre.includes(process.versions.chrome) &&
    sobre.includes('MIT') &&
    opened === REPOSITORY_URL &&
    toUpdates &&
    updatesVisible &&
    remembered &&
    cmd2 &&
    cmd2Focus === 'gravacao' &&
    cmd6 &&
    arrow &&
    focused &&
    JSON.stringify(groups) === JSON.stringify(['Gravação', 'Claude']) &&
    items.every((item) => item.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes('traduc')) &&
    panelsHidden &&
    noneSelected &&
    live === `polite:${items.length} resultados` &&
    jumped &&
    resultFocus === 'BUTTON:haiku' &&
    inView &&
    cleared &&
    unhighlighted &&
    escaped &&
    escFocus === 'claude' &&
    hiddenFound &&
    hintShown &&
    pastaFound &&
    rows.length > 20 &&
    missing.length === 0
  return {
    ok,
    detail: `Contas "${contas.trim()}" (${contasButtons} botões); Sobre "${sobre.replace(/\s+/g, ' ').slice(0, 160)}", repositório -> ${opened || 'nada'}, "Procurar atualização" -> Geral=${toUpdates}, bloco visível=${updatesVisible}; aba lembrada=${remembered}; ⌘2=${cmd2}, ⌘6=${cmd6}, seta=${arrow}; ⌘F foca=${focused}; "TRADUCAO" -> grupos ${JSON.stringify(groups)}, itens ${JSON.stringify(items)}, painéis escondidos=${panelsHidden}; clique em "Modelo do chat" -> aba Claude e destaque=${jumped}, à vista=${inView}, busca limpa=${cleared}, destaque some em 2 s=${unhighlighted}; Esc limpa=${escaped}; foco: ⌘2 -> aba ${cmd2Focus || 'nenhuma'}, resultado -> ${resultFocus || 'fora da linha'}, Esc -> aba ${escFocus || 'nenhuma'}; durante a busca nenhuma aba marcada=${noneSelected}, região viva "${live}"; "haiku" acha "Modelo" escondido=${hiddenFound}, aviso=${hintShown}; "pasta"=${pastaFound}; ${rows.length} linhas na tela, fora do índice: ${JSON.stringify(missing)}`,
  }
}

function layoutCheck(screen: LayoutScreen, metrics: Record<string, number>): Check {
  const expected = { ...COMMON_LAYOUT, ...SCREEN_LAYOUT[screen] }
  const off = Object.entries(metrics).filter(([name, value]) => {
    const target = expected[name]
    return !target || value < target.min - 0.5 || value > target.max + 0.5
  })
  return { ok: off.length === 0, detail: `${JSON.stringify(metrics)}${off.length ? `; fora do mockup: ${off.map(([n]) => n).join(', ')}` : ''}` }
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 22: bloqueio do app.

const LOCK_PASSWORD = 'smoke-senha-1'
const LOCK_LAYER = `document.querySelector('[data-lock-screen]')`
const LOCK_CARD_RECT = `(() => { const r = document.querySelector('[data-lock-card]')?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null })()`

interface LockFileView {
  mode: string
  raw: string
  data: { locked?: boolean; failures?: number; retryAt?: number | null; password?: { algorithm?: string; N?: number; r?: number; p?: number } | null }
}

function readLockFile(userDataDir: string): LockFileView {
  const path = join(userDataDir, LOCK_FILE)
  if (!existsSync(path)) return { mode: 'ausente', raw: '', data: {} }
  const raw = readFileSync(path, 'utf8')
  return { mode: mode(path), raw, data: JSON.parse(raw) as LockFileView['data'] }
}

/**
 * Bordas nítidas (diferença de luminância > 64 entre pixels vizinhos, na horizontal e na vertical) fora do
 * cartão da camada: com o texto de trás legível há milhares; desfocado em 24 px e coberto pelo véu, quase nenhuma.
 */
function sharpEdges(bitmap: Buffer, width: number, height: number, exclude: { x: number; y: number; width: number; height: number } | null, scale: number): number {
  const lum = (index: number): number => 0.0722 * (bitmap[index] ?? 0) + 0.7152 * (bitmap[index + 1] ?? 0) + 0.2126 * (bitmap[index + 2] ?? 0)
  const margin = 8 * scale
  const skip = exclude
    ? { left: exclude.x * scale - margin, top: exclude.y * scale - margin, right: (exclude.x + exclude.width) * scale + margin, bottom: (exclude.y + exclude.height) * scale + margin }
    : null
  let edges = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (skip && x >= skip.left && x <= skip.right && y >= skip.top && y <= skip.bottom) continue
      const here = (y * width + x) * 4
      const value = lum(here)
      if (Math.abs(value - lum(here + 4)) > 64 || Math.abs(value - lum(here + width * 4)) > 64) edges++
    }
  }
  return edges
}

async function edgesOutsideCard(win: BrowserWindow): Promise<number> {
  const image = await win.webContents.capturePage()
  const size = image.getSize()
  const scale = await evaluate<number>(win.webContents, 'window.devicePixelRatio')
  const card = await evaluate<{ x: number; y: number; width: number; height: number } | null>(win.webContents, LOCK_CARD_RECT)
  return sharpEdges(image.toBitmap(), size.width, size.height, card, scale)
}

/** A camada como o smoke a confere: desfoque, véu, `inert`, título e foco. */
async function lockLayerView(win: BrowserWindow): Promise<{ shown: boolean; blur: string; veil: string; inert: boolean; focus: string; title: string; text: string }> {
  const view = await evaluate<{ shown: boolean; blur: string; veil: string; inert: boolean; focus: string; text: string }>(
    win.webContents,
    `(() => {
      const layer = ${LOCK_LAYER}
      const style = layer ? getComputedStyle(layer) : null
      return {
        shown: Boolean(layer),
        blur: style?.backdropFilter ?? '',
        veil: style?.backgroundColor ?? '',
        inert: document.querySelector('[data-app-content]')?.inert === true,
        focus: layer && layer.contains(document.activeElement) ? (document.activeElement.id || document.activeElement.dataset.action || document.activeElement.tagName) : 'fora: ' + (document.activeElement?.tagName ?? ''),
        text: layer?.innerText ?? '',
      }
    })()`,
  )
  return { ...view, title: win.getTitle() }
}

const typeLockPassword = async (contents: WebContents, password: string): Promise<void> => {
  await setValue(contents, '#lock-password', password)
  await pressEnterIn(contents, '#lock-password')
}

const pressKeys = (contents: WebContents, keyCode: string, modifiers: ('meta' | 'shift')[] = []): void => {
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

/** Todos os canais recusados com o app bloqueado, chamados de verdade pelo renderer: a mensagem de cada um. */
async function refusedChannels(contents: WebContents): Promise<{ total: number; locked: number; others: string[]; allowedOk: boolean }> {
  const channels = INVOKE_CHANNELS.filter((channel) => WHEN_LOCKED[channel] === 'refused')
  return evaluate(
    contents,
    `(async () => {
      const channels = ${JSON.stringify(channels)}
      let locked = 0
      const others = []
      for (const channel of channels) {
        try {
          await window.__scribeApi.invoke(channel, {})
          others.push(channel + ': respondeu')
        } catch (error) {
          if (String(error?.message ?? error).endsWith('Error: ${LOCKED_ERROR}')) locked++
          else others.push(channel + ': ' + String(error?.message ?? error).slice(0, 80))
        }
      }
      const info = await window.__scribeApi.invoke('scribe:app-info').catch(() => null)
      return { total: channels.length, locked, others, allowedOk: Boolean(info?.version) }
    })()`,
  )
}

/**
 * Contrato 22 (CA7), numa janela clara à parte e depois numa escura: o botão desabilitado sem senha; criar a
 * senha em Configurações › Geral › "Bloqueio" (`lock.json` 0600, só o hash); bloquear pelo botão da barra
 * lateral e por ⌘⇧L; a camada (desfoque de 24 px medido no print, `inert`, foco preso, clique e atalhos
 * barrados, título); todo canal de conteúdo devolvendo `locked`; 5 senhas erradas (a espera aparece; o relógio
 * do bloqueio é adiantado em vez de esperar 30 s); a senha certa volta à mesma tela, rolagem, rascunho e
 * foco; Touch ID substituto; uma gravação da fixture bloqueada pelo botão da barra e pelo "Mac bloqueou a
 * tela", contando quadros e transcrevendo; e o app reaberto bloqueado.
 */
async function lockChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const lockFixture = ctx.fixtures.lock
  const lockedTitle = lockedWindowTitle(DEFAULT_BRAND_NAME)

  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const menuItem = (): MenuItem | null => Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.lock) ?? null

  // CA1: sem senha e sem Touch ID ligado, "Bloquear" desabilitado com a dica; o menu também.
  const disabled = await evaluate<{ disabled: boolean; hint: string }>(
    contents,
    `(() => { const b = document.querySelector('[data-action="lock-app"]'); return { disabled: b?.disabled === true, hint: b?.parentElement?.title ?? '' } })()`,
  )
  const menuDisabled = menuItem()?.enabled === false
  const menuLabel = menuItem()?.label ?? ''
  await clickSelector(contents, '[data-action="lock-app"]')
  await wait(150)
  const stayedOpen = !(await evaluate<boolean>(contents, `Boolean(${LOCK_LAYER})`))

  // CA1: criar a senha no bloco "Bloqueio" (curta e diferente na confirmação são recusadas na tela).
  await openSettingsTab(contents, 'geral')
  await scrollToSection(contents, 'Bloqueio')
  await clickSelector(contents, '[data-action="lock-password-create"]')
  await waitFor(contents, `document.querySelector('[data-lock-password-form="create"]')`)
  await setValue(contents, '#lock-next', 'abc')
  await setValue(contents, '#lock-confirm', 'abc')
  await clickSelector(contents, '[data-action="lock-password-save"]')
  const tooShort = await waitFor(contents, `document.querySelector('[data-lock-form-error]')?.textContent.includes('de 4 a 64')`)
  await setValue(contents, '#lock-next', LOCK_PASSWORD)
  await setValue(contents, '#lock-confirm', `${LOCK_PASSWORD}x`)
  await clickSelector(contents, '[data-action="lock-password-save"]')
  const mismatch = await waitFor(contents, `document.querySelector('[data-lock-form-error]')?.textContent.includes('não são iguais')`)
  await setValue(contents, '#lock-confirm', LOCK_PASSWORD)
  await clickSelector(contents, '[data-action="lock-password-save"]')
  const created = await waitFor(contents, `document.querySelector('[data-action="lock-password-change"]') && document.querySelector('[data-lock-password-done]')`)
  const file = readLockFile(ctx.userDataDir)
  const touchIdRow = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-setting-name="Usar Touch ID"]'))`)
  await scrollToSection(contents, 'Bloqueio')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'configuracoes-bloqueio-light'))
  const canLockNow = await waitFor(contents, `document.querySelector('[data-action="lock-app"]')?.disabled === false`)
  const passwordInDom = await evaluate<boolean>(contents, `document.documentElement.outerHTML.includes(${JSON.stringify(LOCK_PASSWORD)}) || [...document.querySelectorAll('input')].some((i) => i.value.includes(${JSON.stringify(LOCK_PASSWORD)}))`)
  checks['password'] = {
    ok:
      disabled.disabled &&
      disabled.hint === LOCK_DISABLED_HINT &&
      menuDisabled &&
      menuLabel === `Bloquear ${DEFAULT_BRAND_NAME}` &&
      stayedOpen &&
      tooShort &&
      mismatch &&
      created &&
      canLockNow &&
      file.mode === '600' &&
      !file.raw.includes(LOCK_PASSWORD) &&
      file.data.password?.algorithm === 'scrypt' &&
      (file.data.password.N ?? 0) >= 2 ** 16 &&
      touchIdRow &&
      !passwordInDom &&
      menuItem()?.enabled === true,
    detail: `sem senha: botão desabilitado=${disabled.disabled} com a dica "${disabled.hint}", menu "${menuLabel}" desabilitado=${menuDisabled}, clique não bloqueou=${stayedOpen}; curta recusada=${tooShort}, confirmação diferente=${mismatch}, criada=${created}; lock.json ${file.mode}, senha em texto=${file.raw.includes(LOCK_PASSWORD)}, ${file.data.password?.algorithm ?? '?'} N=${file.data.password?.N ?? '?'} r=${file.data.password?.r ?? '?'} p=${file.data.password?.p ?? '?'}; linha Touch ID=${touchIdRow}; senha no DOM=${passwordInDom}; botão e menu liberados=${canLockNow}/${menuItem()?.enabled}`,
  }

  // Touch ID ligado (substituto) para o desbloqueio do passo seguinte.
  await clickSelector(contents, '[data-setting-name="Usar Touch ID"] [role="switch"]')
  await waitFor(contents, `document.querySelector('[data-setting-name="Usar Touch ID"] [role="switch"]')?.getAttribute('aria-checked') === 'true'`)

  // Tela de trás: Configurações › Geral rolada até "Bloqueio", com "Trocar senha" aberto e um rascunho no campo.
  await clickSelector(contents, '[data-action="lock-password-change"]')
  await waitFor(contents, `document.querySelector('[data-lock-password-form="change"]')`)
  await setValue(contents, '#lock-next', 'rascunho-nao-enviado')
  await evaluate(contents, `document.querySelector('#lock-next').focus(), true`)
  const before = await evaluate<{ scroll: number; route: string }>(contents, `({ scroll: document.querySelector('[data-settings-scroll]').scrollTop, route: location.hash })`)
  const sharpBefore = await edgesOutsideCard(win)
  const scrolls: number[] = []
  const readScroll = async (): Promise<void> => void scrolls.push(await evaluate<number>(contents, `document.querySelector('[data-settings-scroll]').scrollTop`))

  // CA2 e CA3: bloquear pelo botão da barra lateral.
  await clickSelector(contents, '[data-action="lock-app"]')
  const lockedByButton = await waitFor(contents, LOCK_LAYER)
  await settle(contents)
  await readScroll()
  const layer = await lockLayerView(win)
  const sharpAfter = await edgesOutsideCard(win)
  shots.push(await capture(win, ctx.outDir, 'bloqueado-light'))
  // Foco preso: Tab e Shift+Tab nunca saem da camada.
  const tabStops: string[] = []
  for (let i = 0; i < 6; i++) {
    pressKeys(contents, 'Tab', i % 2 ? ['shift'] : [])
    await wait(40)
    tabStops.push((await lockLayerView(win)).focus)
  }
  // Clique na barra lateral e atalho de aba (⌘2) não chegam à tela de trás.
  const navPoint = await evaluate<{ x: number; y: number; hit: boolean } | null>(
    contents,
    `(() => { const r = document.querySelector('[data-nav="reunioes"]')?.getBoundingClientRect(); if (!r) return null; const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); return { x, y, hit: ${LOCK_LAYER}.contains(document.elementFromPoint(x, y)) } })()`,
  )
  if (navPoint) {
    contents.sendInputEvent({ type: 'mouseDown', x: navPoint.x, y: navPoint.y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x: navPoint.x, y: navPoint.y, button: 'left', clickCount: 1 })
  }
  await readScroll()
  pressKeys(contents, '2', ['meta'])
  await wait(200)
  await readScroll()
  const stillGeral = (await currentRoute(contents)) === 'configuracoes' && (await evaluate<boolean>(contents, settingsTabIs('geral')))
  checks['layer'] = {
    ok:
      lockedByButton &&
      layer.blur === 'blur(24px)' &&
      layer.veil !== 'rgba(0, 0, 0, 0)' &&
      layer.inert &&
      layer.title === lockedTitle &&
      layer.focus === 'lock-password' &&
      layer.text.includes(`${DEFAULT_BRAND_NAME} está bloqueado`) &&
      layer.text.includes('Usar Touch ID') &&
      !layer.text.includes('rascunho') &&
      sharpBefore > 2000 &&
      sharpAfter <= Math.max(50, sharpBefore * 0.01) &&
      tabStops.every((stop) => !stop.startsWith('fora')) &&
      navPoint?.hit === true &&
      stillGeral &&
      menuItem()?.enabled === false,
    detail: `pelo botão=${lockedByButton}; backdrop-filter=${layer.blur}, véu ${layer.veil}, resto inert=${layer.inert}; título "${layer.title}"; foco em ${layer.focus}; Tab: ${tabStops.join(' > ')}; bordas nítidas fora do cartão ${sharpBefore} -> ${sharpAfter}; clique em Reuniões caiu na camada=${navPoint?.hit}, ⌘2 e o clique não mudaram a tela=${stillGeral}; menu "Bloquear" desabilitado=${menuItem()?.enabled === false}`,
  }

  // CA4: todos os canais de conteúdo devolvem `locked`; os da base respondem.
  const channels = await refusedChannels(contents)
  await readScroll()
  checks['channels'] = {
    ok: channels.total > 40 && channels.locked === channels.total && channels.others.length === 0 && channels.allowedOk,
    detail: `${channels.locked}/${channels.total} canais recusados com "${LOCKED_ERROR}"${channels.others.length ? `; fora da regra: ${channels.others.join(' | ')}` : ''}; scribe:app-info respondeu=${channels.allowedOk}`,
  }

  // CA5: cinco senhas erradas abrem a espera (contagem na tela, guardada em lock.json).
  const wrongSeen: boolean[] = []
  for (let i = 1; i <= 5; i++) {
    await typeLockPassword(contents, `errada-${i}`)
    wrongSeen.push(await waitFor(contents, `document.querySelector('[data-lock-error]')?.textContent === 'Senha incorreta'`))
    if (i < 5) await setValue(contents, '#lock-password', '')
  }
  const waitShown = await waitFor(contents, `/Tente de novo em 0:(30|29)/.test(document.querySelector('[data-lock-wait]')?.textContent ?? '') && document.querySelector('#lock-password')?.disabled === true`)
  await readScroll()
  const waitText = await text(contents, '[data-lock-wait]')
  const waitFile = readLockFile(ctx.userDataDir).data
  // O relógio do bloqueio anda 31 s (no main) e o estado é reavisado: a espera some.
  lockFixture.skewMs += 31_000
  lockFixture.refresh()
  const waitGone = await waitFor(contents, `!document.querySelector('[data-lock-wait]') && document.querySelector('#lock-password')?.disabled === false`)
  await setValue(contents, '#lock-password', LOCK_PASSWORD)
  await clickSelector(contents, '[data-action="unlock"]')
  await readScroll()
  const unlocked = await waitFor(contents, `!${LOCK_LAYER} && document.querySelector('[data-app-content]')?.inert === false`)
  await readScroll()
  await wait(150)
  const after = await evaluate<{ scroll: number; route: string; draft: string; focus: string; form: boolean }>(
    contents,
    `({ scroll: document.querySelector('[data-settings-scroll]').scrollTop, route: location.hash, draft: document.querySelector('#lock-next')?.value ?? '', focus: document.activeElement?.id ?? '', form: Boolean(document.querySelector('[data-lock-password-form="change"]')) })`,
  )
  const unlockedFile = readLockFile(ctx.userDataDir).data
  checks['unlock'] = {
    ok:
      wrongSeen.every(Boolean) &&
      waitShown &&
      waitFile.failures === 5 &&
      typeof waitFile.retryAt === 'number' &&
      waitGone &&
      unlocked &&
      win.getTitle() === DEFAULT_BRAND_NAME &&
      (await currentRoute(contents)) === 'configuracoes' &&
      (await evaluate<boolean>(contents, settingsTabIs('geral'))) &&
      Math.abs(after.scroll - before.scroll) < 1 &&
      before.scroll > 0 &&
      after.draft === 'rascunho-nao-enviado' &&
      after.form &&
      after.focus === 'lock-next' &&
      unlockedFile.failures === 0 &&
      unlockedFile.locked === false,
    detail: `"Senha incorreta" ${wrongSeen.filter(Boolean).length}/5; espera "${waitText}" (campo travado=${waitShown}), lock.json failures=${waitFile.failures} retryAt=${typeof waitFile.retryAt}; relógio +31 s, espera sumiu=${waitGone}; senha certa desbloqueou=${unlocked}, título "${win.getTitle()}"; rolagem ${before.scroll} -> ${after.scroll} (no caminho: ${scrolls.join(', ')}), rascunho "${after.draft}", formulário aberto=${after.form}, foco em #${after.focus}; lock.json depois failures=${unlockedFile.failures} locked=${unlockedFile.locked}`,
  }

  // CA2: ⌘⇧L bloqueia; Touch ID (substituto) recusado não desbloqueia, aprovado desbloqueia.
  await setValue(contents, '#lock-next', '')
  await clickSelector(contents, '[data-action="lock-password-cancel"]')
  pressKeys(contents, 'L', ['meta', 'shift'])
  const lockedByShortcut = await waitFor(contents, LOCK_LAYER)
  lockFixture.touchIdApproves = false
  await clickSelector(contents, '[data-action="unlock-touch-id"]')
  const touchRefused = await waitFor(contents, `document.querySelector('[data-lock-error]')?.textContent === ${JSON.stringify(TOUCH_ID_FAILED_TEXT)}`)
  const stillLocked = await evaluate<boolean>(contents, `Boolean(${LOCK_LAYER})`)
  lockFixture.touchIdApproves = true
  await clickSelector(contents, '[data-action="unlock-touch-id"]')
  const touchUnlocked = await waitFor(contents, `!${LOCK_LAYER}`)
  // Menu "Bloquear LAP Reuniões" (o mesmo ⌘⇧L no app de verdade).
  menuItem()?.click()
  const lockedByMenu = await waitFor(contents, LOCK_LAYER)
  await typeLockPassword(contents, LOCK_PASSWORD)
  const menuUnlocked = await waitFor(contents, `!${LOCK_LAYER}`)
  checks['shortcutAndTouchId'] = {
    ok: lockedByShortcut && touchRefused && stillLocked && touchUnlocked && lockFixture.touchIdPrompts === 2 && lockedByMenu && menuUnlocked,
    detail: `⌘⇧L bloqueou=${lockedByShortcut}; Touch ID recusado: aviso=${touchRefused}, seguiu bloqueado=${stillLocked}; aprovado desbloqueou=${touchUnlocked}; ${lockFixture.touchIdPrompts} pedidos ao Touch ID substituto; menu bloqueou=${lockedByMenu}, senha desbloqueou=${menuUnlocked}`,
  }

  // Bloquear nunca para a gravação: a fixture segue contando quadros e transcrevendo com o app bloqueado.
  const sessionFixture = readSessionFixture()
  const segments = fixtureSegments(liveFixtureLines(sessionFixture))
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, routeIs('reunioes'))
  await waitFor(contents, `document.querySelector('[data-action="new-recording"]')`)
  await clickSelector(contents, '[data-action="new-recording"]')
  const live = await waitFor(contents, `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`)
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(segments.slice(0, 1))})`)
  await waitFor(contents, "document.querySelectorAll('[data-transcript-list] li').length === 1")
  await wait(1200)
  await clickSelector(contents, '[data-action="lock-app-recording"]')
  const lockedRecording = await waitFor(contents, LOCK_LAYER)
  const framesAtLock = await frameCounts(contents)
  const timerAtLock = await evaluate<string>(contents, TIMER)
  await wait(1500)
  // Trechos novos chegam com o app bloqueado.
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(segments)})`)
  const transcribing = await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === ${segments.length}`)
  const framesLater = await frameCounts(contents)
  const phaseLocked = (await captureState(contents))?.phase ?? ''
  await settle(contents)
  const recordingLine = await text(contents, '[data-lock-recording]')
  const layerText = await evaluate<string>(contents, `${LOCK_LAYER}?.innerText ?? ''`)
  const leaked = segments.filter((segment) => segment.text.length > 8 && layerText.includes(segment.text.slice(0, 20))).length
  shots.push(await capture(win, ctx.outDir, 'bloqueado-gravando-light'))
  // ⌘W com a gravação em andamento e o app bloqueado: o diálogo só oferece "Cancelar" e a janela fica.
  const dialogsBefore = ctx.fixtures.leaveDialogs.length
  win.close()
  await wait(200)
  const lockedDialog = ctx.fixtures.leaveDialogs.slice(dialogsBefore)
  const stayedLocked = !win.isDestroyed() && (await evaluate<boolean>(contents, `Boolean(${LOCK_LAYER})`))
  await typeLockPassword(contents, LOCK_PASSWORD)
  const backToRecording = (await waitFor(contents, `!${LOCK_LAYER}`)) && (await currentRoute(contents)) === 'gravacao'
  // Desbloqueado, o mesmo diálogo oferece também "Encerrar e sair" (o substituto responde "Cancelar").
  win.close()
  await wait(200)
  const unlockedDialog = ctx.fixtures.leaveDialogs.slice(dialogsBefore + lockedDialog.length)
  checks['leaveDialog'] = {
    ok:
      lockedDialog.length === 1 &&
      lockedDialog[0]?.message === RECORDING_LEAVE_MESSAGE &&
      JSON.stringify(lockedDialog[0]?.buttons) === JSON.stringify(['Cancelar']) &&
      stayedLocked &&
      unlockedDialog.length === 1 &&
      JSON.stringify(unlockedDialog[0]?.buttons) === JSON.stringify(['Cancelar', 'Encerrar e sair']) &&
      !win.isDestroyed() &&
      (await captureState(contents))?.phase === 'recording',
    detail: `bloqueado: ${JSON.stringify(lockedDialog)}, janela e camada ficaram=${stayedLocked}; desbloqueado: ${JSON.stringify(unlockedDialog)}; janela aberta=${!win.isDestroyed()}, gravação segue=${(await captureState(contents))?.phase}`,
  }
  const timerAfter = await evaluate<string>(contents, TIMER)
  // "Mac bloqueou a tela" (powerMonitor substituto) com a opção ligada (padrão): bloqueia também.
  lockFixture.power.emit('lock-screen')
  const lockedBySystem = await waitFor(contents, LOCK_LAYER)
  await clickSelector(contents, '[data-action="unlock-touch-id"]')
  const systemUnlocked = await waitFor(contents, `!${LOCK_LAYER}`)
  const phaseAfter = (await captureState(contents))?.phase ?? ''
  checks['recordingContinues'] = {
    ok:
      live &&
      lockedRecording &&
      framesAtLock !== null &&
      framesLater !== null &&
      framesLater.mic > framesAtLock.mic &&
      framesLater.system > framesAtLock.system &&
      transcribing &&
      phaseLocked === 'recording' &&
      /^Gravando · \d{2}:\d{2}$/.test(recordingLine) &&
      leaked === 0 &&
      backToRecording &&
      timerAfter !== timerAtLock &&
      lockedBySystem &&
      systemUnlocked &&
      phaseAfter === 'recording',
    detail: `gravando=${live}; bloqueado pela barra=${lockedRecording}; quadros ${JSON.stringify(framesAtLock)} -> ${JSON.stringify(framesLater)} bloqueado, fase ${phaseLocked}; trechos novos na transcrição=${transcribing}; linha "${recordingLine}", trechos da reunião na camada=${leaked}; desbloqueado de volta na gravação=${backToRecording}, cronômetro ${timerAtLock} -> ${timerAfter}; "Mac bloqueou a tela" bloqueou=${lockedBySystem}, Touch ID desbloqueou=${systemUnlocked}, fase ${phaseAfter}`,
  }

  // Bloquear logo depois de clicar "Encerrar": a reunião, a transcrição, o `.md` e o áudio ficam completos (os
  // canais de fim de gravação passam com o token da sessão), o resumo automático roda e o detalhe só abre
  // depois do desbloqueio.
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  await evaluate(contents, `(() => { document.querySelector('[data-action="end-recording"]').click(); void window.__scribeApi.invoke('scribe:lock-now'); return true })()`)
  const lockedDuringEnd = await waitFor(contents, LOCK_LAYER)
  let ending: Meeting | undefined
  for (let attempt = 0; attempt < 300 && !ending; attempt++) {
    ending = readMeetings(ctx.userDataDir).find((meeting) => !idsBefore.has(meeting.id) && meeting.audioPath !== null && meeting.transcriptPath !== null)
    if (!ending) await wait(50)
  }
  const audioPath = ending?.audioPath ?? ''
  const transcriptPath = ending?.transcriptPath ?? ''
  const folder = audioPath ? dirname(audioPath) : ''
  const parts = folder && existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('.part')) : ['pasta ausente']
  const internalTranscript = ending ? existsSync(join(ctx.userDataDir, 'meetings', `${ending.id}.json`)) : false
  const wantsSummary = readSettings(ctx.userDataDir).summarizeOnStop !== false
  let summaryReady = !wantsSummary
  for (let attempt = 0; attempt < 200 && !summaryReady && ending; attempt++) {
    summaryReady = existsSync(join(ctx.userDataDir, 'meetings', `${ending.id}${SUMMARY_SUFFIX}`))
    if (!summaryReady) await wait(50)
  }
  const stillLockedAfterSave = await evaluate<boolean>(contents, `Boolean(${LOCK_LAYER})`)
  const routeWhileLocked = await currentRoute(contents)
  await typeLockPassword(contents, LOCK_PASSWORD)
  const detailAfterUnlock = await waitFor(contents, `!${LOCK_LAYER} && ${routeIs('detalhe')}`, 5000)
  checks['endWhileLocked'] = {
    ok:
      lockedDuringEnd &&
      ending !== undefined &&
      existsSync(audioPath) &&
      !audioPath.endsWith('.part') &&
      existsSync(transcriptPath) &&
      parts.length === 0 &&
      internalTranscript &&
      summaryReady &&
      stillLockedAfterSave &&
      routeWhileLocked === 'gravacao' &&
      detailAfterUnlock,
    detail: `bloqueou logo depois do "Encerrar"=${lockedDuringEnd}; reunião ${ending?.id ?? 'não salva'}, áudio ${basename(audioPath) || '?'} (existe=${existsSync(audioPath)}), .md ${basename(transcriptPath) || '?'} (existe=${existsSync(transcriptPath)}), .part na pasta: ${parts.length ? parts.join(', ') : 'nenhum'}, transcrição interna=${internalTranscript}; resumo automático ${wantsSummary ? `pronto=${summaryReady}` : 'desligado nas configurações'}; seguiu bloqueado=${stillLockedAfterSave} na rota ${routeWhileLocked}; detalhe abriu depois do desbloqueio=${detailAfterUnlock}`,
  }

  const fromDisk = async (lockOnLaunch: boolean | null): Promise<{ locked: boolean; hasPassword: boolean }> => {
    const dir = mkdtempSync(join(ctx.userDataDir, 'reabrir-'))
    for (const name of [LOCK_FILE, SETTINGS_FILE]) if (existsSync(join(ctx.userDataDir, name))) writeFileSync(join(dir, name), readFileSync(join(ctx.userDataDir, name)))
    if (lockOnLaunch !== null) {
      const raw = JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8')) as { version: number; settings: Record<string, unknown> }
      writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify({ ...raw, settings: { ...raw.settings, lockOnLaunch } }))
    }
    const service = createLockService({
      store: createFileLockStore({ dir }),
      settings: createFileSettingsStore({ dir }),
      touchId: { available: () => false, prompt: () => Promise.reject(new Error('smoke: sem Touch ID')) },
      onStatus: () => undefined,
    })
    const status = await service.init()
    rmSync(dir, { recursive: true, force: true })
    return { locked: status.locked, hasPassword: status.hasPassword }
  }
  // CA6: fechado bloqueado, abre bloqueado (a camada é o primeiro quadro; as telas só montam depois). O
  // `lock.json` e o `settings.json` também são relidos do disco por um serviço novo, como na próxima abertura do
  // app; numa cópia, para o serviço em uso não ser afetado.
  pressKeys(contents, 'L', ['meta', 'shift'])
  await waitFor(contents, LOCK_LAYER)
  win.destroy()
  const diskLocked = await fromDisk(null)
  const reopened = ctx.openWindow({ theme: 'light' })
  watch(reopened)
  const reopenedContents = reopened.webContents
  if (reopenedContents.isLoading()) await new Promise<void>((resolve) => reopenedContents.once('did-finish-load', () => resolve()))
  const openedLocked = await waitFor(reopenedContents, LOCK_LAYER, 10_000)
  const noScreens = await evaluate<boolean>(reopenedContents, `!document.querySelector('main')`)
  const reopenedTitle = reopened.getTitle()
  await typeLockPassword(reopenedContents, LOCK_PASSWORD)
  const reopenedUnlocked = await waitFor(reopenedContents, `!${LOCK_LAYER} && document.querySelector('main[data-route]')`, 10_000)
  checks['reopen'] = {
    ok: openedLocked && noScreens && reopenedTitle === lockedTitle && reopenedUnlocked && (await currentRoute(reopenedContents)) === 'reunioes',
    detail: `reaberto bloqueado=${openedLocked}, telas montadas antes do desbloqueio=${!noScreens}, título "${reopenedTitle}"; desbloqueado em ${await currentRoute(reopenedContents)}`,
  }
  // Agora desbloqueado no disco: abre livre; com "Pedir senha ao abrir" ligado, abre bloqueado.
  const diskUnlocked = await fromDisk(false)
  const diskOnLaunch = await fromDisk(true)
  // "Pedir senha ao abrir" pela tela grava a opção.
  await openSettingsTab(reopenedContents, 'geral')
  await clickSelector(reopenedContents, '[data-setting-name="Pedir senha ao abrir"] [role="switch"]')
  const onLaunchSaved = await waitFor(reopenedContents, `document.querySelector('[data-setting-name="Pedir senha ao abrir"] [role="switch"]')?.getAttribute('aria-checked') === 'true'`)
  const settingSaved = readSettings(ctx.userDataDir).lockOnLaunch === true
  const diskWithSetting = await fromDisk(null)
  await clickSelector(reopenedContents, '[data-setting-name="Pedir senha ao abrir"] [role="switch"]')
  await waitFor(reopenedContents, `document.querySelector('[data-setting-name="Pedir senha ao abrir"] [role="switch"]')?.getAttribute('aria-checked') === 'false'`)
  checks['reopenFromDisk'] = {
    ok: diskLocked.locked && diskLocked.hasPassword && !diskUnlocked.locked && diskOnLaunch.locked && onLaunchSaved && settingSaved && diskWithSetting.locked,
    detail: `serviço novo do disco: fechado bloqueado -> ${JSON.stringify(diskLocked)}; desbloqueado -> ${JSON.stringify(diskUnlocked)}; com "Pedir senha ao abrir" -> ${JSON.stringify(diskOnLaunch)}; ligado pela tela: switch=${onLaunchSaved}, settings.json=${settingSaved}, reaberto -> ${JSON.stringify(diskWithSetting)}`,
  }
  reopened.destroy()

  // Tema escuro: a mesma camada.
  const dark = ctx.openWindow({ theme: 'dark' })
  watch(dark)
  await loadAndWait(dark)
  pressKeys(dark.webContents, 'L', ['meta', 'shift'])
  const darkLocked = await waitFor(dark.webContents, LOCK_LAYER)
  await settle(dark.webContents)
  const darkLayer = await lockLayerView(dark)
  shots.push(await capture(dark, ctx.outDir, 'bloqueado-dark'))
  await typeLockPassword(dark.webContents, LOCK_PASSWORD)
  const darkUnlocked = await waitFor(dark.webContents, `!${LOCK_LAYER}`)
  checks['dark'] = {
    ok: darkLocked && darkLayer.blur === 'blur(24px)' && darkLayer.inert && darkUnlocked,
    detail: `bloqueado=${darkLocked}, backdrop-filter=${darkLayer.blur}, véu ${darkLayer.veil}, inert=${darkLayer.inert}; desbloqueado=${darkUnlocked}`,
  }
  dark.destroy()
}

export async function runSmoke(ctx: SmokeContext): Promise<number> {
  const timer = setTimeout(() => {
    console.error(`[smoke] tempo esgotado (${TIMEOUT_MS} ms)`)
    app.exit(1)
  }, TIMEOUT_MS)

  rmSync(ctx.outDir, { recursive: true, force: true })
  mkdirSync(ctx.outDir, { recursive: true })

  const consoleErrors: string[] = []
  const cspViolations: CspViolation[] = []
  const externalRequests: string[] = []
  const failures: string[] = []
  const screenshots: Screenshot[] = []
  const navigation: Record<string, Check> = {}
  const recording: Record<string, Check> = {}
  const settings: Record<string, Check> = {}
  const layout: Record<string, Check> = {}

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const origin = originOf(details.url)
    const local = details.url.startsWith('data:') || details.url.startsWith('blob:') || details.url.startsWith('devtools:')
    if (!local && origin !== ctx.appOrigin) externalRequests.push(details.url)
    callback({})
  })
  ipcMain.on('scribe:csp-violation', (_event, report: CspViolation) => cspViolations.push(report))

  const watch = (win: BrowserWindow): void => {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') consoleErrors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    win.webContents.on('render-process-gone', (_event, details) => failures.push(`renderer encerrou: ${details.reason}`))
    win.webContents.on('did-fail-load', (_event, code, description, url) => failures.push(`falha ao carregar ${url}: ${code} ${description}`))
  }

  let webPreferences: Record<string, unknown> = {}
  let probe = { origin: '', opfs: false, workletAddModule: false, errors: [] as string[] }
  let bridge: Check = { ok: false, detail: 'não executado' }
  let theme: Check = { ok: false, detail: 'não executado' }
  let motion: Check = { ok: false, detail: 'não executado' }
  const brand: Record<string, Check> = {}
  let recorderMeasured: Record<string, unknown> = {}
  let summaryMeasured: SummaryMeasured | null = null
  /** Contrato 10: lista com prévia do resumo (nos dois temas) e busca (no claro). */
  const meetingsList: Record<string, Check> = {}
  /** Contratos 15 e 16: chat "Perguntar" e os detalhes da resposta (nos dois temas); "Parar", o painel "Contexto" e a aba do detalhe (no claro). */
  const chat: Record<string, Check> = {}
  let acpMeasured: AcpMeasured | null = null
  /** Contrato 22: bloqueio do app. */
  const lock: Record<string, Check> = {}
  let analysisMeasured: AnalysisMeasured | null = null

  // A fixture da sessão real, reduzida pelo mesmo redutor do app: a mesma dos testes (CA4) e do smoke.
  const sessionFixture = readSessionFixture()
  const liveSegments = fixtureSegments(liveFixtureLines(sessionFixture))

  try {
    for (const themeName of THEMES) {
      // Cada tema começa com o microfone "não pedido", como em Reuniões vazia no mockup.
      ctx.fixtures.media.set('not-determined')
      const win = ctx.openWindow({ theme: themeName })
      watch(win)
      await loadAndWait(win)
      const contents = win.webContents

      if (themeName === 'light') {
        // `getLastWebPreferences` existe no Electron 45 mas não está no electron.d.ts.
        const prefs = (contents as WebContents & { getLastWebPreferences(): Record<string, unknown> | null }).getLastWebPreferences() ?? {}
        webPreferences = {
          contextIsolation: prefs.contextIsolation,
          sandbox: prefs.sandbox,
          nodeIntegration: prefs.nodeIntegration,
          webSecurity: prefs.webSecurity,
        }
        probe = await probeOrigin(contents)
        recording['captureWorklet'] = await probeCaptureWorklet(contents, app.getAppPath())
        const format = await recorderFormat(contents)
        recording['recorderFormat'] = { ok: format.ok, detail: format.detail }
        recorderMeasured = format.measured
        const info = await evaluate<{ name?: string; electron?: string } | null>(
          contents,
          "window.__scribeApi.invoke('scribe:app-info').catch(() => null)",
        )
        const exposed = await evaluate<string[]>(contents, "Object.keys(window).filter((k) => k.startsWith('__scribe'))")
        bridge = {
          ok: info?.electron === process.versions.electron && exposed.length === 1 && exposed[0] === '__scribeApi',
          detail: `invoke scribe:app-info -> ${JSON.stringify(info)}; globais expostos: ${exposed.join(', ')}`,
        }
      }

      const shoot = async (name: (typeof SCREENS)[number], route: string): Promise<void> => {
        if (!(await waitFor(contents, routeIs(route)))) failures.push(`${name}/${themeName}: rota ${route} não abriu`)
        const dataTheme = await evaluate<string>(contents, 'document.documentElement.dataset.theme ?? ""')
        if (dataTheme !== themeName) failures.push(`${name}/${themeName}: data-theme=${dataTheme}`)
        await settle(contents)
        screenshots.push(await capture(win, ctx.outDir, `${name}-${themeName}`))
      }

      // 1. Reuniões vazia, com "Permitir" no bloco de permissões. Depois o microfone fica concedido.
      await waitFor(contents, `document.querySelector('[data-permission="mic"]')?.dataset.state === 'not-determined'`)
      await shoot('reunioes', 'reunioes')
      if (themeName === 'light') settings['permissions'] = await permissionChecks(contents, ctx.fixtures)
      else await clickSelector(contents, '[data-action="allow-mic"]')

      // 2. "Nova gravação" do estado vazio inicia a captura (sinal gerado) e abre a gravação.
      await clickSelector(contents, '[data-action="new-recording"]')
      const recordingFrom = Date.now()
      const live = await waitFor(contents, `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`)
      if (themeName === 'light') {
        navigation['emptyStateButton'] = {
          ok: live && (await currentRoute(contents)) === 'gravacao',
          detail: `"Nova gravação" do estado vazio -> rota ${await currentRoute(contents)}, captura ${JSON.stringify(await captureState(contents))}`,
        }
      }
      await wait(1500)
      await shoot('gravacao', 'gravacao')

      // 3. Fita cheia e a coluna com a fixture da sessão gravada (nenhuma conexão: modo sintético).
      await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(liveSegments)})`)
      await waitFor(contents, "document.querySelectorAll('[data-transcript-list] li').length === 3")
      if (themeName === 'light') {
        const fps = await tapeFps(contents)
        recording['tapeFps'] = { ok: fps >= MIN_TAPE_FPS, detail: `${fps} quadros desenhados em 1 s (mínimo ${MIN_TAPE_FPS})` }
      }
      await wait(Math.max(0, TAPE_FILL_MS - (Date.now() - recordingFrom)))
      await shoot('gravacao-ao-vivo', 'gravacao')
      if (themeName === 'light') layout['gravacao'] = layoutCheck('gravacao', await layoutMetrics(contents, 'gravacao'))
      // Contrato 07: com a opção ligada (padrão), o áudio vai em pedaços para o `.part` na pasta.
      if (themeName === 'light') recording['audioWhileRecording'] = await audioWhileRecording(contents, defaultMeetingFolder(ctx))

      // Contrato 06: o eco do alto-falante some de "Você" (a gravação deste passo salva a fixture de eco).
      if (themeName === 'light') {
        const echo = await echoCheck(win, ctx.outDir)
        recording['echoRemoved'] = echo.check
        screenshots.push(echo.shot)
      }

      // No escuro, o aviso de sistema sem som também é fotografado (o claro sai em `recordingChecks`).
      if (themeName === 'dark') {
        const notice = await captureSystemNotice(win, ctx.outDir, 'gravacao-aviso-dark')
        screenshots.push(notice.shot)
        if (!notice.shown || !notice.gone) failures.push(`gravacao-aviso-dark: aviso=${notice.shown}, sumiu=${notice.gone}`)
      }

      // Contrato 13: painel de anotações com três cards (⌘⇧N no claro, o botão "Anotações" no escuro).
      recording[themeName === 'light' ? 'notesRecording' : 'notesRecordingDark'] = await notesWhileRecording(contents, themeName === 'light')
      await shoot('gravacao-anotacoes', 'gravacao')

      // Contrato 19: "Analisar até agora" no meio da gravação, com a captura e a tradução seguindo.
      const analysisLive = await analysisWhileRecording(win, ctx, themeName, themeName === 'light')
      recording[themeName === 'light' ? 'analysisRecording' : 'analysisRecordingDark'] = analysisLive.check
      screenshots.push(analysisLive.shot)
      if (themeName === 'light') analysisMeasured = analysisLive.measured

      // 4. Encerrar salva o registro e abre o detalhe. A anotação mais antiga é editada logo antes do
      // clique, sem esperar nada: o texto novo tem que chegar ao `notes.json` (contrato 13, CA4).
      await setValue(contents, '[data-notes-panel] li:last-child [data-note-text]', SMOKE_NOTE_EDITED)
      const recordedMs = Date.now() - recordingFrom
      const endedAt = Date.now()
      await clickSelector(contents, '[data-action="end-recording"]')
      await waitFor(contents, routeIs('detalhe'))
      const saved = readMeetings(ctx.userDataDir)
      const record = saved[0]
      // Contrato 08: o resumo sai sozinho (claude falso) e o detalhe abre na aba "Resumo".
      const summaryResult = await summaryAfterEnd(win, ctx, record, endedAt, themeName === 'light')
      recording[themeName === 'light' ? 'summary' : 'summaryDark'] = summaryResult.check
      if (themeName === 'light') summaryMeasured = summaryResult.measured
      await shoot('detalhe-resumo', 'detalhe')
      if (themeName === 'light') {
        // A reunião salva fica sem o trecho repetido do microfone (contrato 06, CA4).
        const transcriptFile = record ? join(ctx.userDataDir, 'meetings', `${record.id}.json`) : ''
        const savedSegments = transcriptFile && existsSync(transcriptFile) ? (JSON.parse(readFileSync(transcriptFile, 'utf8')) as TranscriptDocument).segments : []
        const echoSources = savedSegments.filter((segment) => segment.text.includes(ECHO_PHRASE)).map((segment) => segment.source)
        recording['echoNotSaved'] = {
          ok: echoSources.length === 1 && echoSources[0] === 'system' && savedSegments.some((segment) => segment.source === 'mic'),
          detail: `${savedSegments.length} trechos salvos; "${ECHO_PHRASE}" em [${echoSources.join(', ')}]`,
        }
        recording['endSavesAndOpensDetail'] = {
          ok:
            (await currentRoute(contents)) === 'detalhe' &&
            saved.length === 1 &&
            record !== undefined &&
            Math.abs(record.durationMs - recordedMs) < 1500 &&
            record.sources.mic &&
            record.sources.system &&
            /^Reunião de \d{2}\/\d{2} \d{2}:\d{2}$/.test(record.title),
          detail: `rota ${await currentRoute(contents)}; registro ${JSON.stringify(record)}; gravado ~${recordedMs} ms`,
        }
        // Contrato 07: o arquivo final, o .md e as linhas do detalhe.
        const files = await audioAfterEnd(win, ctx, record)
        recording['audioSaved'] = files.saved
        recording['audioDetail'] = files.detail
        screenshots.push(files.shot)
        // Contrato 08, CA7: "Baixar…" na aba "Áudio".
        const downloads = await downloadsCheck(win, ctx, record)
        recording['summaryDownload'] = downloads.check
        screenshots.push(downloads.shot)
      }
      // Contrato 13: as anotações no arquivo e na aba "Anotações", e o salto para a transcrição.
      recording[themeName === 'light' ? 'notesDetail' : 'notesDetailDark'] = await notesAfterEnd(contents, ctx, record, () => shoot('detalhe-anotacoes', 'detalhe'), themeName === 'light')
      // Contrato 19: as análises salvas, a seção "Perguntas em aberto" e "Analisar a reunião inteira".
      if (themeName === 'light') {
        const analysisDetail = await analysisDetailCheck(win, ctx, record)
        recording['analysisDetail'] = analysisDetail.check
        screenshots.push(analysisDetail.shot)
      }

      // 5. Lista com três reuniões semeadas.
      seedMeetings(ctx.userDataDir)
      await clickSelector(contents, '[data-nav="reunioes"]')
      await waitFor(contents, "document.querySelectorAll('main a[data-meeting]').length === 3")
      await shoot('reunioes-com-dados', 'reunioes')

      // Contrato 10: seis reuniões em dias diferentes, duas com resumo, e a busca.
      seedListMeetings(ctx.userDataDir)
      await clickSelector(contents, '[data-nav="configuracoes"]')
      await waitFor(contents, routeIs('configuracoes'))
      await clickSelector(contents, '[data-nav="reunioes"]')
      await waitFor(contents, "document.querySelectorAll('main a[data-meeting]').length === 6 && document.querySelectorAll('main [data-summary-overview]').length === 2")
      meetingsList[themeName === 'light' ? 'list' : 'listDark'] = await meetingsListCheck(contents, ctx.userDataDir)
      await shoot('reunioes-lista', 'reunioes')
      if (themeName === 'light') {
        const search = await meetingsSearchCheck(win, ctx.outDir)
        meetingsList['search'] = search.check
        screenshots.push(search.shot)
      }

      // 6. Clique na primeira linha abre o detalhe.
      await clickSelector(contents, 'main a[data-meeting]')
      await waitFor(contents, "document.querySelector('main [data-meeting]:not(a)') && document.querySelectorAll('[data-transcript-list] li').length === 3")
      await shoot('detalhe', 'detalhe')
      if (themeName === 'light') {
        layout['detalhe'] = layoutCheck('detalhe', await layoutMetrics(contents, 'detalhe'))
        // CA12: "Copiar transcrição" põe o Markdown na área de transferência (fixture em memória).
        // O "Copiar resumo" do passo 4 (contrato 08) já pôs um texto ali: espera o próximo.
        const copiedBefore = ctx.fixtures.copiedTexts.length
        await clickSelector(contents, '[data-action="copy-transcript"]')
        for (let attempt = 0; attempt < 40 && ctx.fixtures.copiedTexts.length === copiedBefore; attempt++) await wait(50)
        const markdown = ctx.fixtures.copiedTexts.at(-1) ?? ''
        recording['copyTranscript'] = {
          ok:
            markdown.startsWith('# Planejamento da migração do banco') &&
            markdown.includes('**Você** · 00:00') &&
            markdown.includes('> must operate without interfering with the microphone.'),
          detail: `${markdown.split('\n').length} linhas; começa "${markdown.split('\n')[0] ?? ''}"`,
        }
        // Excluir a reunião apaga também a transcrição dela.
        await clickSelector(contents, '[data-action="delete-meeting"]')
        await clickSelector(contents, '[data-action="confirm-delete"]')
        const back = await waitFor(contents, routeIs('reunioes'))
        const transcriptGone = !existsSync(join(ctx.userDataDir, 'meetings', 'smoke-1.json'))
        recording['deleteTranscript'] = {
          ok: back && transcriptGone && readMeetings(ctx.userDataDir).length === 5,
          detail: `"Excluir" -> rota ${await currentRoute(contents)}, transcrição apagada=${transcriptGone}, ${readMeetings(ctx.userDataDir).length} reuniões`,
        }
      }

      // Contrato 15: a tela "Perguntar" com o `claude` falso em modo chat (acervo refeito a partir das reuniões
      // semeadas); no claro também "Parar", o link `meeting:` e a aba "Perguntar" do detalhe.
      // Contrato 16: a resposta com "Pensando…", passos, raciocínio e rodapé nos dois temas; no claro também a
      // conversa vazia, o painel "Contexto" com o escopo, o modelo, "Refazer", renomear e ↑.
      const extraShot = async (name: string): Promise<void> => {
        await settle(contents)
        screenshots.push(await capture(win, ctx.outDir, name))
      }
      const chatScreen = await chatScreenCheck(
        contents,
        ctx,
        () => shoot('perguntar', 'perguntar'),
        () => shoot('perguntar-v2', 'perguntar'),
        themeName === 'light' ? () => extraShot('perguntar-vazio-light') : null,
      )
      chat[themeName === 'light' ? 'screen' : 'screenDark'] = chatScreen.check
      chat[themeName === 'light' ? 'details' : 'detailsDark'] = chatScreen.v2
      if (themeName === 'light') {
        chat['stop'] = await chatStopCheck(contents, ctx)
        chat['context'] = await chatContextCheck(contents, ctx, () => extraShot('perguntar-contexto-light'))
        chat['meeting'] = await chatMeetingCheck(contents, ctx)
      }

      // 7. Configurações (chave conferida, catálogo das fixtures) e o seletor com um modelo não liberado.
      // Contrato 18: cada aba pelo clique. "Geral" abre com o bloco "Marca" e o símbolo da LAP (contrato 09, CA2).
      await openSettingsTab(contents, 'geral')
      if (!(await settingsReady(contents))) failures.push(`configuracoes/${themeName}: chave ou catálogo não carregou`)
      await shoot('configuracoes-geral', 'configuracoes')
      if (!(await selectSettingsTab(contents, 'gravacao'))) failures.push(`configuracoes-gravacao/${themeName}: aba não abriu`)
      await shoot('configuracoes-gravacao', 'configuracoes')
      if (themeName === 'light') layout['configuracoes'] = layoutCheck('configuracoes', await settingsLayoutMetrics(contents))
      brand[themeName] = await brandCheck(win)
      if (!(await openModelPicker(contents))) failures.push(`configuracoes-seletor/${themeName}: modelo não liberado não foi marcado`)
      await shoot('configuracoes-seletor', 'configuracoes')
      // Contrato 05: Claude CLI encontrado (binário falso), sem o seletor do gateway.
      if (!(await showClaudeSettings(contents))) failures.push(`configuracoes-claude/${themeName}: Claude CLI falso não foi encontrado`)
      await evaluate(contents, "document.querySelector('[data-settings-scroll]').scrollTop = 0, true")
      await shoot('configuracoes-claude', 'configuracoes')
      await clickSelector(contents, '[data-engine-option="assemblyai"]')
      await waitFor(contents, "document.querySelector('[data-model-picker]')")
      // Contrato 07, CA2: o bloco "Arquivos da reunião", ligado, com a pasta padrão (aba "Arquivos").
      if (!(await selectSettingsTab(contents, 'arquivos'))) failures.push(`configuracoes-arquivos/${themeName}: aba não abriu`)
      await waitFor(contents, `document.querySelector('section[aria-label="Arquivos da reunião"]')?.innerText.includes('~/')`)
      await shoot('configuracoes-arquivos', 'configuracoes')
      // Contrato 18: "Contas", "Sobre", a aba lembrada, os atalhos e a busca, no claro.
      if (themeName === 'light') settings['tabs'] = await settingsTabsChecks(contents, ctx, extraShot)

      if (themeName === 'light') navigation['detailLoadFailure'] = await detailLoadFailure(contents, ctx.userDataDir)

      if (themeName === 'light') {
        await transcriptionChecks(win, recording)
        await recordingChecks(win, ctx, navigation, recording, screenshots)
        await settingsChecks(win, ctx, settings)
        await clickSelector(contents, '[data-nav="configuracoes"]')
        await waitFor(contents, routeIs('configuracoes'))
        settings['claudeCli'] = (await showClaudeSettings(contents)) ? await claudeChecks(win, ctx) : { ok: false, detail: 'Claude CLI falso não foi encontrado' }
        settings['meetingFiles'] = await meetingFilesSettings(win, ctx)
        settings['summarizeOnStop'] = await summarizeSetting(contents, ctx.userDataDir)
        // Contrato 09: logo, nome e subtítulo próprios e a volta ao padrão.
        const branding = await brandingChecks(win, ctx)
        settings['branding'] = branding.check
        screenshots.push(branding.shot)

        // Barra lateral, menu ⌘, e teclado.
        await clickSelector(contents, '[data-nav="reunioes"]')
        await waitFor(contents, routeIs('reunioes'))
        navigation['sidebarReunioes'] = {
          ok: (await currentRoute(contents)) === 'reunioes' && (await activeNav(contents)) === 'reunioes',
          detail: `clique em Reuniões -> rota ${await currentRoute(contents)}, aria-current em ${await activeNav(contents)}`,
        }

        await clickSelector(contents, '[data-nav="configuracoes"]')
        await waitFor(contents, routeIs('configuracoes'))
        navigation['sidebarConfiguracoes'] = {
          ok: (await currentRoute(contents)) === 'configuracoes' && (await activeNav(contents)) === 'configuracoes',
          detail: `clique em Configurações -> rota ${await currentRoute(contents)}, aria-current em ${await activeNav(contents)}`,
        }

        await clickSelector(contents, '[data-nav="reunioes"]')
        await waitFor(contents, routeIs('reunioes'))
        const settingsItem = Menu.getApplicationMenu()?.getMenuItemById(MENU_IDS.settings)
        settingsItem?.click()
        await waitFor(contents, routeIs('configuracoes'))
        navigation['menuConfiguracoes'] = {
          ok: settingsItem?.accelerator === 'CmdOrCtrl+,' && (await currentRoute(contents)) === 'configuracoes',
          detail: `menu "${settingsItem?.label ?? '?'}" (${settingsItem?.accelerator ?? '?'}) -> rota ${await currentRoute(contents)}`,
        }

        await clickSelector(contents, '[data-nav="reunioes"]')
        await waitFor(contents, routeIs('reunioes'))
        navigation['keyboard'] = await keyboardNavigation(contents)

        motion = await reducedMotion(contents)

        // Contrato 17: o motor pelo agente ACP falso (chat, tradução, resumo e o adaptador que não sobe).
        const acpResult = await acpChecks(win, ctx, () => extraShot('perguntar-acp-light'))
        chat['acp'] = acpResult.check
        acpMeasured = acpResult.measured
      }
      rmSync(join(ctx.userDataDir, MEETINGS_FILE), { force: true })
      win.destroy()
    }

    // Tema `system` (sem parâmetro) acompanha o macOS sem recarregar.
    const win = ctx.openWindow({})
    watch(win)
    await loadAndWait(win)
    settings['appearance'] = await appearanceCheck(win.webContents, ctx.userDataDir)
    theme = await themeLiveSwitch(win.webContents)
    win.destroy()

    // Contrato 14: atualização pelo GitHub (API e download falsos), numa janela clara à parte.
    const updatesWin = ctx.openWindow({ theme: 'light' })
    watch(updatesWin)
    await loadAndWait(updatesWin)
    const updates = await updatesChecks(updatesWin, ctx)
    settings['updates'] = updates.check
    screenshots.push(updates.shot)
    updatesWin.destroy()

    // Contrato 22: bloqueio do app, por último (a senha criada vale para o userData inteiro).
    await lockChecks(ctx, watch, lock, screenshots)
  } catch (error) {
    failures.push(`erro: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  }

  // Coleta o que pode ter chegado depois do último quadro.
  await wait(100)

  if (webPreferences['contextIsolation'] !== true) failures.push('contextIsolation não está true')
  if (webPreferences['sandbox'] !== true) failures.push('sandbox não está true')
  if (webPreferences['nodeIntegration'] !== false) failures.push('nodeIntegration não está false')
  if (probe.origin !== 'scribe://app') failures.push(`origem ${probe.origin}`)
  if (!probe.opfs) failures.push('OPFS falhou')
  if (!probe.workletAddModule) failures.push('audioWorklet.addModule falhou')
  if (!bridge.ok) failures.push(`ponte do preload: ${bridge.detail}`)
  if (consoleErrors.length) failures.push(`${consoleErrors.length} erro(s) no console`)
  if (cspViolations.length) failures.push(`${cspViolations.length} violação(ões) de CSP`)
  if (externalRequests.length) failures.push(`${externalRequests.length} requisição(ões) externa(s)`)
  for (const [name, check] of Object.entries(navigation)) if (!check.ok) failures.push(`navegação ${name}: ${check.detail}`)
  for (const [name, check] of Object.entries(recording)) if (!check.ok) failures.push(`gravação ${name}: ${check.detail}`)
  for (const [name, check] of Object.entries(brand)) if (!check.ok) failures.push(`marca ${name}: ${check.detail}`)
  for (const [name, check] of Object.entries(settings)) if (!check.ok) failures.push(`configurações ${name}: ${check.detail}`)
  for (const [name, check] of Object.entries(meetingsList)) if (!check.ok) failures.push(`lista de reuniões ${name}: ${check.detail}`)
  for (const name of ['list', 'listDark', 'search']) if (!meetingsList[name]) failures.push(`lista de reuniões ${name}: não executado`)
  for (const [name, check] of Object.entries(chat)) if (!check.ok) failures.push(`chat ${name}: ${check.detail}`)
  for (const name of ['screen', 'screenDark', 'details', 'detailsDark', 'stop', 'context', 'meeting', 'acp']) if (!chat[name]) failures.push(`chat ${name}: não executado`)
  for (const name of ['configuracoes', 'gravacao', 'detalhe']) {
    const check = layout[name]
    if (!check) failures.push(`medidas ${name}: não executado`)
    else if (!check.ok) failures.push(`medidas ${name}: ${check.detail}`)
  }
  for (const name of ['permissions', 'reachable', 'keyField', 'keySave', 'modelSearch', 'modelSelect', 'keyRemoveAndInvite', 'catalogOffline', 'languages', 'audio', 'recordingUsesSettings', 'appearance', 'claudeCli', 'meetingFiles', 'summarizeOnStop', 'branding', 'updates', 'addKeyLink', 'tabs']) {
    if (!settings[name]) failures.push(`configurações ${name}: não executado`)
  }
  // Nenhuma chamada saiu para a AssemblyAI: todas passaram pelo gateway de fixtures.
  if (!ctx.fixtures.calls.some((call) => call.path === '/v1/models')) failures.push('gateway de fixtures: catálogo não foi pedido')
  if (Object.keys(brand).length !== THEMES.length) failures.push('marca: não executado nos dois temas')
  for (const name of ['emptyStateButton', 'headerNewRecording', 'menuNovaGravacao', 'sidebarReunioes', 'keyboard', 'detailLoadFailure']) {
    if (!navigation[name]) failures.push(`navegação ${name}: não executado`)
  }
  for (const name of ['captureWorklet', 'tapeFps', 'endSavesAndOpensDetail', 'pause', 'spaceResumes', 'systemSilenceNotice', 'endFromHeader', 'deleteWithConfirmation', 'noKeyState', 'copyTranscript', 'deleteTranscript', 'echoRemoved', 'echoNotSaved', 'recorderFormat', 'audioWhileRecording', 'audioSaved', 'audioDetail', 'deleteKeepsFiles', 'summary', 'summaryDark', 'summaryDownload', 'notesRecording', 'notesRecordingDark', 'notesDetail', 'notesDetailDark', 'analysisRecording', 'analysisRecordingDark', 'analysisDetail']) {
    if (!recording[name]) failures.push(`gravação ${name}: não executado`)
  }
  for (const [name, check] of Object.entries(lock)) if (!check.ok) failures.push(`bloqueio ${name}: ${check.detail}`)
  for (const name of ['password', 'layer', 'channels', 'unlock', 'shortcutAndTouchId', 'recordingContinues', 'leaveDialog', 'endWhileLocked', 'reopen', 'reopenFromDisk', 'dark']) if (!lock[name]) failures.push(`bloqueio ${name}: não executado`)
  if (!theme.ok) failures.push(`tema: ${theme.detail}`)
  if (!motion.ok) failures.push(`movimento reduzido: ${motion.detail}`)
  // Mais o aviso de sistema sem som, nos dois temas, o eco removido, os arquivos no detalhe, a aba
  // "Áudio" depois de baixar, a barra com a marca própria, o bloco "Atualizações" e a busca na lista
  // (só no claro), a conversa vazia e o painel "Contexto" do "Perguntar" v2 e a conversa pelo agente ACP
  // (contrato 17), as abas "Contas" e "Sobre" e a busca das Configurações (contrato 18), só no claro; a aba
  // "Análise" da gravação nos dois temas e a seção "Perguntas em aberto" do detalhe, no claro (contrato 19); a
  // camada de bloqueio nos dois temas, bloqueada na gravação e o bloco "Bloqueio" (contrato 22).
  const expectedShots = SCREENS.length * THEMES.length + 21
  if (screenshots.length !== expectedShots) failures.push(`${screenshots.length} PNGs em vez de ${expectedShots}`)
  for (const shot of screenshots) {
    if (shot.width < 1120 || shot.height < 740) failures.push(`${shot.name}: ${shot.width}x${shot.height} abaixo de 1120x740`)
    if (shot.distinctColors <= 50) failures.push(`${shot.name}: só ${shot.distinctColors} cores distintas`)
  }

  const userDataIsTemp = ctx.userDataDir.startsWith(realpathSync(tmpdir())) && app.getPath('userData') === ctx.userDataDir
  if (!userDataIsTemp) failures.push('userData fora da pasta temporária')

  const report = {
    generatedAt: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userDataDir: ctx.userDataDir,
    userDataIsTemp,
    webPreferences,
    origin: probe.origin,
    opfs: probe.opfs,
    workletAddModule: probe.workletAddModule,
    probeErrors: probe.errors,
    bridge,
    consoleErrors,
    cspViolations,
    externalRequests,
    navigation,
    recording,
    settings,
    layout,
    gatewayFixtureCalls: ctx.fixtures.calls,
    recorderFormat: recorderMeasured,
    summary: summaryMeasured,
    meetingsList,
    chat,
    acp: acpMeasured,
    analysis: analysisMeasured,
    lock,
    lockTouchIdPrompts: ctx.fixtures.lock.touchIdPrompts,
    meetingFolder: folderFiles(defaultMeetingFolder(ctx)),
    openedFiles: ctx.fixtures.openedFiles.map((item) => ({ action: item.action, file: basename(item.path) })),
    claudeFakeSpawns: ctx.fixtures.claudeSpawns.map((spawn) => ({ ...spawn, args: spawn.args.filter((arg) => arg.startsWith('--')) })),
    openedExternally: ctx.fixtures.openedUrls,
    updateFixtureCalls: ctx.fixtures.updates.calls,
    updateRedirects: ctx.fixtures.updates.redirects,
    dockIcons: ctx.fixtures.dockIcons,
    keychain: 'substituto em memória (safeStorage real nunca chamado no smoke)',
    brand,
    themeLiveSwitch: theme,
    reducedMotion: motion,
    screenshots: screenshots.map((shot) => ({ ...shot, file: shot.file.replace(`${ctx.outDir}/`, '') })),
    failures,
  }
  writeFileSync(join(ctx.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  clearTimeout(timer)

  for (const failure of failures) console.error(`[smoke] ${failure}`)
  console.log(`[smoke] ${screenshots.length} PNGs e report.json em ${ctx.outDir}; ${failures.length ? 'FALHOU' : 'ok'}`)
  return failures.length ? 1 : 0
}
