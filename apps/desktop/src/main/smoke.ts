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
//
// Contrato 11: antes do bloqueio, a conta Google e o Drive com o Google falso em memória (`googleChecks`): o
// cadastro do cliente, o login (o smoke faz o papel do navegador no servidor local do app), uma gravação que vai
// inteira para o Drive falso, "Gerar de novo" substituindo o resumo e "Sair". Nada sai da máquina.
//
// Contrato 24: antes do bloqueio, o WhatsApp com o serviço falso em Python (`backend_fake.py`, sem neonize e sem
// rede) e um índice de pacotes falso numa pasta local (`whatsappChecks`): detectar, instalar, a tela de risco antes
// do QR, o pareamento, a tela, o SSE, o rascunho pelo agente ACP falso, o envio só com o clique e o "Perguntar" com
// uma conversa; depois do bloqueio, os canais recusados com o app bloqueado (`whatsappLockCheck`). Nenhum número
// de verdade é pareado.
//
// Contrato 23: antes do bloqueio, as Automações (`automationsChecks`) com o agente ACP falso e o relógio do agendador
// adiantado pelo smoke: os agentes de exemplo, um agente criado pelo formulário com "Testar agora", uma tarefa diária e
// uma "depois de cada reunião" (saídas `chat`, `file` e a notificação substituta), `skipped` com a anterior rodando,
// `autoPaused` depois de 3 falhas, um horário perdido rodando uma vez só, "Pedir agora", o histórico com o detalhe, o
// menu do ícone da barra de menus (substituto que registra os itens) e fechar a janela mantendo o app (Dock escondido,
// substituto) e reabrir pelo ícone. Não há ferramenta MCP para negar: o contrato 21 não dá MCP às automações.
//
// Contrato 12: depois do Google e antes do WhatsApp, as agendas (`calendarChecks`) com o Google e a Microsoft falsos em
// memória: o cadastro e o login da Microsoft, o Google com a agenda, o bloco "Agenda", as notificações substitutas
// ("Reunião em 5 min", "não está sendo gravada", "cancelada"), a faixa, "Próximas", "Gravar" pela faixa e pela
// notificação com o título do evento e o `calendar` salvo na reunião. Nenhum dado da agenda vai para o relatório.
//
// Contrato 26: depois do Assistente e antes do bloqueio, a internet (`internetChecks`) com o agente ACP falso, que
// devolve resultados de busca inventados (domínios `.example`, sem rede): o agente com "Pode pesquisar na internet",
// "Pedir agora" com a busca, a página aberta e a página montada negada, o agente sem internet e o Assistente com a
// fonte "Internet".
//
// Contrato 21: depois da internet e antes do Meet, os servidores MCP (`mcpChecks`) com o `claude` falso (`mcp list | get |
// add-json | remove` sobre um arquivo do userData), o servidor MCP falso (stdio e HTTP em 127.0.0.1) e o agente ACP falso:
// a aba "Conexões", ligar um do CLI para o chat, importar do Claude Desktop falso sem o segredo, adicionar pelo
// formulário (no CLI) e por JSON colado (só no app), "Testar conexão", o cartão de aprovação com "Permitir uma vez" e a
// ferramenta negada pela política. Termina com tudo desligado. Nenhum segredo vai para a tela, o log ou o relatório.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn as spawnChild } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, session, type MenuItem, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { DRIVE_ROOT_FOLDER_NAME } from '../shared/accounts'
import { WHATSAPP_EXPORT_PREFIX, WHATSAPP_FIXED_WARNING, WHATSAPP_PAIR_HINT, WHATSAPP_RISK_CHECKBOX, WHATSAPP_RISK_TEXT, WHATSAPP_RISK_TITLE } from '../shared/whatsapp'
import { INSIGHTS_MOOD_NOTE } from '../shared/whatsapp-insights'
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
import { encodeQr } from '../renderer/src/features/whatsapp/qr'
import { CALLBACK_DONE_TEXT } from './accounts/oauth'
import { DEFAULT_FOLDER_NAME } from './audio-files/service'
import { SUMMARY_FILE_SUFFIX, summaryFileTarget } from './audio-files/summary-file'
import { BRANDING_DIR } from './branding/service'
import { summaryInput, summaryLines } from './claude-cli/summary'
import { MENU_IDS } from './menu'
import { CHAT_CORPUS_DIR, CHAT_INDEX_FILE, CHAT_SCOPE_DIR, corpusFileSuffix } from './chat/corpus'
import { AUTOMATIONS_FILE, EMAIL_SEARCH_FILE, GUIDE_FILE, isSourceFile, STATE_FILE } from './chat/sources'
import { CHATS_DIR } from './chat/store'
import type { FakeDriveFile } from './google/fake-google'
import { RECORDING_LEAVE_MESSAGE } from './lock/recording-session'
import { createLockService } from './lock/service'
import { createFileLockStore, LOCK_FILE } from './lock/store'
import { SUMMARY_SUFFIX } from './meetings/summaries'
import { createFileSettingsStore, SETTINGS_FILE } from './settings/store'
import { CHAT_ALLOWED_TOOLS, CHAT_DISALLOWED_TOOLS } from './claude-cli/chat'
import { MEETINGS_FILE } from './meetings/store'
import { originOf } from './security'
import type { WhatsAppService } from './whatsapp/service'
import type { AutomationsService } from './schedules/service'
import { SCHEDULE_RUNS_DIR, SCHEDULES_FILE } from './schedules/store'
import { AGENTS_FILE } from './agents/store'
import type { TrayController } from './tray/menu'
import type { CalendarService } from './calendar/service'
import { MEET_DISCONNECTED_LABEL } from '../shared/meet'
import { APP_PLUGINS, pluginFolderName } from '../shared/plugins'
import { MEET_PATH, MEET_PORTS, type MeetServer } from './meet/server'
import { MEETING_PROMPT_SIZE } from './meeting-prompt/window'
import { MIC_PROMPT_MIN_MS } from '../shared/meeting-prompt'
import { MCP_CLI_ENABLED_FILE, MCP_SERVERS_FILE } from './mcp/store'
import { CLAUDE_CONNECTOR_AUTHORIZE_HINT, CLAUDE_CONNECTOR_NEXT_QUESTION, CLAUDE_CONNECTORS_URL, claudeConnectorEnabledNotice, MCP_FIXED_WARNING } from '../shared/mcp'
import { NAVEGADOR_COMANDOS_PATH, NAVEGADOR_HEADER, NAVEGADOR_PORTS, type NavegadorServer } from './navegador/server'
import { MEETINGS_DIR } from './meetings/transcripts'
import { SETTINGS_VERSION } from './settings/schema'
import { SMOKE_EMAIL_ADDRESS, SMOKE_EMAIL_ARCHIVED, SMOKE_EMAIL_ATTACHMENT, SMOKE_EMAIL_PASSWORD, SMOKE_EMAIL_WRONG_PASSWORD } from './email/fake-email'
import { CLAUDE_DISALLOWED_TOOLS, CLAUDE_READ_TOOLS, CLAUDE_WEB_TOOLS } from './acp/profiles/claude'
import { LATEST_RELEASE_URL, RELEASE_DOWNLOAD_PREFIX, RELEASE_REDIRECT_HOSTS } from './updates/release'
import {
  SMOKE_AUDIO_TRANSCRIPT,
  SMOKE_FAKE_KEY,
  SMOKE_GOOGLE_CLIENT_ID,
  SMOKE_GOOGLE_CLIENT_SECRET,
  SMOKE_MCP_SECRETS,
  SMOKE_MICROSOFT_CLIENT_ID,
  SMOKE_NOT_ALLOWED_MODEL,
  SMOKE_OFFLINE_KEY,
  SMOKE_OFFLINE_MODEL,
  SMOKE_REFUSED_KEY,
  type SmokeFixtures,
} from './smoke-fixtures'

// Contrato 22: o bloqueio, no fim, soma uns 25 s ao roteiro; o contrato 11 (conta Google e Drive), uns 20 s; o
// contrato 24 (WhatsApp, com o `venv` e o `pip` de verdade do índice local), uns 40 s; o contrato 23 (Automações), uns
// 60 s.
// Contrato 12 (agendas): uns 25 s.
// Contrato 43 (email): uns 25 s.
const TIMEOUT_MS = 600_000
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
  // Contrato 25: a tela "Perguntar" virou "Assistente".
  'assistente',
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
  /** Contrato 24: o serviço do WhatsApp do app, para o smoke fazer o papel do celular no serviço falso. */
  whatsapp: Pick<WhatsAppService, 'fake' | 'status'>
  openWindow: (query: Record<string, string>) => BrowserWindow
  /** Contrato 23: o agendador (o smoke "avança o relógio" e confere) e o ícone da barra de menus substituto. */
  automations: Pick<AutomationsService, 'tick' | 'meetingEnded' | 'settled' | 'snapshot' | 'resume' | 'listTasks'>
  tray: () => TrayController | null
  /** Contrato 12: as agendas (o smoke lê de novo depois de mudar os eventos falsos). */
  calendar: Pick<CalendarService, 'refresh' | 'view'>
  /** Contrato 27: o servidor local do Meet (a porta em que subiu e o estado). */
  meet: Pick<MeetServer, 'port' | 'status'>
  /** Contrato 46: a ponte do "Controle do navegador" (a porta em que subiu e se a extensão está conectada). */
  navegador: Pick<NavegadorServer, 'port' | 'connected'>
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

/** Contrato 38: o trilho da direita do Assistente (conversas em cima, "Contexto" embaixo). */
const CHAT_RAIL = 'aside[aria-label="Conversas e contexto"]'

const routeIs = (route: string): string => `document.querySelector('main')?.dataset.route === '${route}'`

/** Contrato 18: a aba marcada e o painel dela à mostra (os outros ficam montados, com `hidden`). */
const settingsTabIs = (tab: SettingsTab): string =>
  `document.querySelector('[role="tab"][data-tab="${tab}"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('[data-settings-panel="${tab}"]')?.hidden === false`

/** Contrato 18: troca de aba pelo clique, já em Configurações. */
async function selectSettingsTab(contents: WebContents, tab: SettingsTab): Promise<boolean> {
  // 15 s: com a máquina carregada a troca de rota passa dos 5 s e o teste desistia cedo (flake da aba "geral").
  await waitFor(contents, `document.querySelector('[role="tab"][data-tab="${tab}"]')`, 15_000)
  await clickSelector(contents, `[role="tab"][data-tab="${tab}"]`)
  return waitFor(contents, settingsTabIs(tab))
}

/** Contrato 18: a âncora rolou a aba até o bloco (rolagem fora do topo e o bloco à vista). */
const anchoredAt = (label: string): string =>
  `(() => { const s = document.querySelector('[data-settings-scroll]'); const b = document.querySelector('section[aria-label=${JSON.stringify(label)}]')?.getBoundingClientRect(); const r = s.getBoundingClientRect(); return s.scrollTop > 0 && b && b.top >= r.top - 1 && b.top < r.top + 40 })()`

/** Contrato 18: Configurações pela barra lateral e a aba pelo clique. */
async function openSettingsTab(contents: WebContents, tab: SettingsTab): Promise<boolean> {
  await clickSelector(contents, '[data-nav="configuracoes"]')
  if (!(await waitFor(contents, routeIs('configuracoes'), 5000))) {
    // Um <dialog> modal aberto deixa o resto da tela inerte e o click() programático some. Registra o
    // estado (para a flake da aba "geral" ter diagnóstico), fecha o que estiver aberto e tenta de novo.
    const stuck = await evaluate<string>(
      contents,
      `JSON.stringify({ rota: location.hash || location.pathname, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className).slice(0, 3), foco: document.activeElement?.tagName })`,
    )
    console.log(`[smoke] configuracoes não abriu de primeira: ${stuck}`)
    await evaluate(contents, `(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true })()`)
    await clickSelector(contents, '[data-nav="configuracoes"]')
    await waitFor(contents, routeIs('configuracoes'), 15_000)
  }
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
  const rows = `[...document.querySelectorAll('[data-transcript-list] li')].map((li) => ({ label: li.querySelector('.caps')?.textContent ?? '', system: li.querySelector('.caps')?.classList.contains('text-sys') ?? false, text: li.querySelector('[data-transcript-text]')?.textContent ?? '' }))`
  type EchoRow = { label: string; system: boolean; text: string }
  const withPhrase = (list: EchoRow[]): string[] => list.filter((row) => row.text.includes(ECHO_PHRASE)).map((row) => row.label)

  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(fixtureSegments(lines.slice(0, systemFinal)))})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 3`)
  const before = await evaluate<EchoRow[]>(contents, rows)
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(fixtureSegments(lines))})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 2`)
  await settle(contents)
  const after = await evaluate<EchoRow[]>(contents, rows)
  const shot = await capture(win, outDir, 'gravacao-eco-light')
  const beforeLabels = withPhrase(before)
  const afterLabels = withPhrase(after)
  return {
    check: {
      ok:
        beforeLabels.includes('Você') &&
        afterLabels.length === 1 &&
        // O que importa é o trecho ter ido para a linha do sistema; o rótulo pode trazer o nome do Meet (contrato 27).
        after.some((row) => row.text.includes(ECHO_PHRASE) && row.system && row.label !== 'Você') &&
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
  messages: { role: string; text: string; error?: string; steps?: unknown[]; thinking?: string; plan?: unknown[]; meta?: { model: string; consulted: string[] }; model?: string; actions?: SmokeActionFile[] }[]
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
  await clickSelector(contents, '[data-nav="assistente"]')
  // Contrato 16: 6 sugestões em cartões, em 3 grupos.
  const opened = await waitFor(
    contents,
    `${routeIs('assistente')} && document.querySelectorAll('[data-chat-suggestion]').length === 6 && document.querySelectorAll('[data-chat-empty] section').length === 3 && document.querySelector('[data-chat-input]')`,
    8000,
  )
  const suggestions = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-chat-suggestion]')].map((b) => b.textContent)`)
  // Contrato 38: as sugestões numa grade 2×3; o trilho à direita da conversa, só com o histórico (conversa nova: nada de
  // "Contexto"); a barra lateral do app continua sendo o primeiro `aside`.
  const emptyLayout = await evaluate<{ columns: number; rows: number; railRight: boolean; noContext: boolean; sidebarFirst: boolean }>(
    contents,
    `(() => {
      const boxes = [...document.querySelectorAll('[data-chat-suggestion]')].map((b) => b.getBoundingClientRect())
      const distinct = (values) => new Set(values.map((v) => Math.round(v))).size
      const rail = document.querySelector(${JSON.stringify(CHAT_RAIL)})?.getBoundingClientRect()
      const conversation = document.querySelector('[data-chat-conversation]')?.getBoundingClientRect()
      return {
        columns: distinct(boxes.map((b) => b.left)),
        rows: distinct(boxes.map((b) => b.top)),
        railRight: Boolean(rail && conversation && rail.width > 0 && rail.left >= conversation.right - 1),
        noContext: !document.querySelector('[data-chat-context]') && !document.querySelector('[data-action="expand-context"]') && Boolean(document.querySelector(${JSON.stringify(`${CHAT_RAIL} [data-chat-list]`)})),
        sidebarFirst: Boolean(document.querySelector('aside')?.querySelector('[data-nav="assistente"]')),
      }
    })()`,
  )
  const emptyOk = emptyLayout.columns === 2 && emptyLayout.rows === 3 && emptyLayout.railRight && emptyLayout.noContext && emptyLayout.sidebarFirst
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
      emptyOk &&
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
      // Contrato 25: o Assistente roda na pasta da conversa (as reuniões do escopo e as fontes do app).
      spawn?.cwd === join(ctx.userDataDir, CHAT_SCOPE_DIR, saved?.id ?? '?') &&
      chatArgsCheck(spawn) &&
      chats.length === chatsBefore + 1 &&
      saved?.messages[1]?.role === 'assistant' &&
      saved.messages[1].error === undefined,
    detail: `tela=${opened}, sugestões ${JSON.stringify(suggestions)}, grade e trilho ${JSON.stringify(emptyLayout)}; estados=${JSON.stringify(asked.statuses)}, terminou=${asked.done}, resposta "${asked.answer.slice(0, 120)}"; link meeting:${link}; pessoa à direita=${userRight}; INDICE.md ${indexLines} linhas para ${meetings.length} reuniões, ${sampleFile ?? 'sem .md da smoke-2'}; permissões pasta ${mode(corpus)}, índice ${mode(join(corpus, CHAT_INDEX_FILE))}; processo ${JSON.stringify(spawn ? { cwd: spawn.cwd.replace(ctx.userDataDir, '<userData>'), args: spawn.args.filter((arg, i) => arg.startsWith('--') || spawn.args[i - 1]?.endsWith('Tools') || spawn.args[i - 1] === '--permission-mode'), env: spawn.envNames } : null)}; conversas ${chatsBefore} -> ${chats.length}`,
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
 * da lista; ↑ no campo vazio edita a última pergunta. Contrato 38: o "Contexto" é uma seção recolhível no trilho da
 * direita (abre e recolhe no lugar, embaixo do histórico, com o menu da lista funcionando com ele aberto).
 */
async function chatContextCheck(contents: WebContents, ctx: SmokeContext, shootContext: () => Promise<void>): Promise<Check> {
  const chatId = await evaluate<string>(contents, `document.querySelector('[data-chat-conversation]')?.getAttribute('data-chat-conversation') ?? ''`)
  const spawns = (): SmokeFixtures['claudeSpawns'] => chatSpawns(ctx.fixtures)
  // Contrato 38: com a conversa aberta, o "Contexto" recolhido no trilho (só o cabeçalho); aberto, ele aparece no trilho, à
  // direita da conversa e embaixo do histórico.
  const collapsed = await evaluate<boolean>(contents, `!document.querySelector('[data-chat-context]') && Boolean(document.querySelector(${JSON.stringify(`${CHAT_RAIL} [data-action="expand-context"]`)}))`)
  await clickSelector(contents, '[data-action="toggle-context"]')
  const panel = await waitFor(contents, `document.querySelector(${JSON.stringify(`${CHAT_RAIL} [data-chat-context]`)})`)
  const rail = await evaluate<{ right: boolean; below: boolean }>(
    contents,
    `(() => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect()
      const rail = box(${JSON.stringify(CHAT_RAIL)}), conversation = box('[data-chat-conversation]'), list = box('[data-chat-list]'), context = box('[data-chat-context]')
      return { right: Boolean(rail && conversation && rail.left >= conversation.right - 1), below: Boolean(list && context && list.bottom <= context.top + 1) }
    })()`,
  )
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
  const recollapsed = await waitFor(contents, `!document.querySelector('[data-chat-context]') && document.querySelector('[data-action="expand-context"]')`)

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

  // Contrato 38: o rótulo do modelo abre o "Contexto" e o trilho rola até ele; o menu do histórico funciona com ele aberto.
  await clickSelector(contents, '[data-action="chat-model-label"]')
  const revealed = await waitFor(
    contents,
    `(() => { const rail = document.querySelector(${JSON.stringify(CHAT_RAIL)})?.getBoundingClientRect(); const context = document.querySelector('[data-chat-context]')?.getBoundingClientRect(); return Boolean(rail && context && context.top >= rail.top - 1 && context.top < rail.bottom) })()`,
  )

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
  const menuWithContext = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-chat-context]'))`)
  await clickSelector(contents, '[data-action="close-context"]')
  const closedAgain = await waitFor(contents, `!document.querySelector('[data-chat-context]')`)

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
      collapsed &&
      rail.right &&
      rail.below &&
      recollapsed &&
      revealed &&
      menuWithContext &&
      closedAgain &&
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
      // As reuniões escolhidas e o índice; mais as fontes do app (contrato 25), com o estado sempre.
      scopeFiles.filter((name) => !isSourceFile(name)).length === 3 &&
      scopeFiles.includes(STATE_FILE) &&
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
    detail: `conversa ${chatId}; teclado do escopo: 1 parada de Tab=${tabStops === 1}, ↓=${arrowed}, End=${ended}; escolhidas vazio: aviso=${blocked}, Enviar desligado=${sendDisabled}, nada enviado=${nothingSent}; menu "…" pelo teclado ${JSON.stringify(menuKeys)}, Esc fechou=${menuClosed}; trilho: recolhido=${collapsed}, à direita=${rail.right}, embaixo do histórico=${rail.below}, recolheu=${recollapsed}, rótulo do modelo abriu e rolou=${revealed}, menu com o Contexto aberto=${menuWithContext}, fechou=${closedAgain}; painel=${panel}, consultadas no painel=${panelConsulted}, totais "${totals}"; escopo salvo ${JSON.stringify(savedScope)}, rótulo=${scoped}; processo do escopo em ${scopedSpawn ? scopedSpawn.cwd.replace(ctx.userDataDir, '<userData>') : '?'} com ${JSON.stringify(scopeFiles)}, anterior saiu=${previous?.exited ?? '?'}, resposta "${scopedAnswer.answer.slice(0, 80)}"; modelo -> ${opusSpawn?.args[opusSpawn.args.indexOf('--model') + 1] ?? '?'}, rodapé "${opusFooter.slice(0, 40)}"; Refazer: processo novo=${redoSpawn !== opusSpawn}, mensagens ${lengthBefore} -> ${afterRedo?.messages.length ?? '?'}; renomear: linha=${renamedRow}, arquivo "${renamedFile ?? '?'}"; ↑: editando=${editing}, mensagens ${lengthBeforeEdit} -> ${afterEdit?.messages.length ?? '?'}, última pergunta "${lastQuestion ?? '?'}"`,
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

/**
 * Contrato 28 (CA3, CA4 e CA7), na lista com seis reuniões: "Nova pasta" cria "Cliente X" pela barra; o "…" da linha
 * de smoke-1 move a reunião para ela (o `meetings.json` guarda o `folderId`); selecionar a pasta deixa só smoke-1;
 * "Todas" traz as seis de volta e a linha de smoke-1 mostra "· Cliente X".
 */
async function meetingsFoldersCheck(contents: WebContents, userDataDir: string): Promise<Check> {
  const FOLDER = 'Cliente X'
  const FOLDER_OPTION = `[...document.querySelectorAll('main [data-folders] [data-folder]')].find((b) => b.dataset.folder !== 'all' && b.textContent.startsWith(${JSON.stringify(FOLDER)}))`
  const barShown = await waitFor(contents, `document.querySelector('main [data-folders] [data-folder="all"]') && document.querySelector('main [data-action="new-folder"]')`)
  await clickSelector(contents, 'main [data-action="new-folder"]')
  await waitFor(contents, `document.querySelector('main [data-new-folder-input]')`)
  await setValue(contents, 'main [data-new-folder-input]', FOLDER)
  await pressEnterIn(contents, 'main [data-new-folder-input]')
  const created = await waitFor(contents, `${FOLDER_OPTION}`)
  const folderId = await evaluate<string>(contents, `${FOLDER_OPTION}?.dataset.folder ?? ''`)
  // "…" da linha (fora do link) → "Mover para…" → a pasta.
  await clickSelector(contents, 'main a[data-meeting="smoke-1"] ~ div [data-meeting-menu]')
  const menuShown = await waitFor(contents, `document.querySelector('main [data-move-to="${folderId}"]')`)
  if (menuShown) await clickSelector(contents, `main [data-move-to="${folderId}"]`)
  let savedFolder: string | null | undefined
  for (let attempt = 0; attempt < 100 && savedFolder !== folderId; attempt++) {
    savedFolder = readMeetings(userDataDir).find((meeting) => meeting.id === 'smoke-1')?.folderId
    if (savedFolder !== folderId) await wait(50)
  }
  const ROW_IDS = `[...document.querySelectorAll('main a[data-meeting]')].map((a) => a.dataset.meeting)`
  const counted = await waitFor(contents, `${FOLDER_OPTION}?.textContent === ${JSON.stringify(`${FOLDER}1`)}`)
  await clickSelector(contents, `main [data-folder="${folderId}"]`)
  const filtered = await waitFor(contents, `JSON.stringify(${ROW_IDS}) === '["smoke-1"]'`)
  const filteredRows = await evaluate<string[]>(contents, ROW_IDS)
  await clickSelector(contents, 'main [data-folder="all"]')
  const back = await waitFor(contents, `${ROW_IDS}.length === 6`)
  const meta = await evaluate<string>(contents, `document.querySelector('main a[data-meeting="smoke-1"] [data-meeting-folder]')?.textContent ?? ''`)
  return {
    ok: barShown && created && folderId !== '' && menuShown && savedFolder === folderId && counted && filtered && back && meta === ` · ${FOLDER}`,
    detail: `barra=${barShown}; pasta criada=${created} (${folderId || 'sem id'}); menu da linha=${menuShown}; folderId salvo=${savedFolder ?? 'nenhum'}; contagem 1=${counted}; filtro -> ${JSON.stringify(filteredRows)}; "Todas" com 6=${back}; meta de smoke-1 "${meta}"`,
  }
}

/**
 * Contrato 28 (CA5), no meio da gravação: na lista de Reuniões, "Gravando agora" com o título e o tempo andando;
 * o clique no cartão volta para a gravação.
 */
async function recordingNowCheck(contents: WebContents): Promise<Check> {
  await clickSelector(contents, '[data-nav="reunioes"]')
  const shown = await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('main [data-recording-now]')`)
  const card = shown ? await text(contents, 'main [data-recording-now]') : ''
  const before = shown ? await text(contents, 'main [data-recording-now-elapsed]') : ''
  const moved = shown && (await waitFor(contents, `document.querySelector('main [data-recording-now-elapsed]')?.textContent !== ${JSON.stringify(before)}`, 3000))
  const after = shown ? await text(contents, 'main [data-recording-now-elapsed]') : ''
  if (shown) await clickSelector(contents, 'main [data-recording-now]')
  const back = await waitFor(contents, routeIs('gravacao'))
  return {
    ok: shown && card.includes('Gravando agora') && /Reunião de \d{2}\/\d{2} \d{2}:\d{2}/.test(card) && moved && back,
    detail: `cartão=${shown} "${card}"; tempo ${before} -> ${after} (andou=${moved}); clique voltou à gravação=${back}`,
  }
}

/**
 * Contrato 29 (CA3 e CA5), no meio da gravação: o botão do microfone logo depois de "Pausar" desliga ("Ouvir só os
 * participantes": `aria-pressed=true`, fita "Você" com "mic desligado", sem "sem sinal" e sem aviso de microfone) e
 * religa; a barra de controles continua cabendo na janela de 1120 px.
 */
async function micOffCheck(contents: WebContents): Promise<Check> {
  const BUTTON = '[data-action="mic-off"]'
  const STATE = `(() => {
    const button = document.querySelector('${BUTTON}')
    const label = document.querySelector('[data-source-label="mic"]')
    const bar = document.querySelector('[role="toolbar"][aria-label="Controles da gravação"]')
    const main = document.querySelector('main')?.getBoundingClientRect()
    const box = bar?.getBoundingClientRect()
    return {
      pressed: button?.getAttribute('aria-pressed') ?? '',
      afterPause: button?.previousElementSibling?.dataset.action ?? '',
      title: button?.title ?? '',
      label: [...(label?.children ?? [])].map((part) => part.textContent ?? ''),
      micNotices: [...document.querySelectorAll('[data-notice^="mic-"]')].length,
      barFits: Boolean(bar && box && main && bar.scrollWidth <= bar.clientWidth && box.left >= main.left && box.right <= main.right),
      bar: bar && box && main ? { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, left: Math.round(box.left - main.left), right: Math.round(main.right - box.right), main: Math.round(main.width) } : null,
    }
  })()`
  type MicState = { pressed: string; afterPause: string; title: string; label: string[]; micNotices: number; barFits: boolean; bar: unknown }
  const before = await evaluate<MicState>(contents, STATE)
  await clickSelector(contents, BUTTON)
  const off = await waitFor(contents, `document.querySelector('${BUTTON}')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-mic-off-label]')`)
  const offState = await evaluate<MicState>(contents, STATE)
  await clickSelector(contents, BUTTON)
  const on = await waitFor(contents, `document.querySelector('${BUTTON}')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('[data-mic-off-label]')`)
  const onState = await evaluate<MicState>(contents, STATE)
  return {
    ok:
      before.pressed === 'false' &&
      before.afterPause === 'toggle-pause' &&
      before.title === 'Ouvir só os participantes' &&
      before.barFits &&
      off &&
      offState.title === 'Voltar a me ouvir' &&
      JSON.stringify(offState.label) === JSON.stringify(['Você', 'mic desligado']) &&
      offState.micNotices === 0 &&
      offState.barFits &&
      on &&
      onState.title === 'Ouvir só os participantes',
    detail: `antes ${JSON.stringify(before)}; desligado=${off} ${JSON.stringify(offState)}; religado=${on} ${JSON.stringify(onState)}`,
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
      JSON.stringify(screen.tabs) === JSON.stringify(['Resumo', 'Anotações', 'Assistente', 'Transcrição', 'Áudio']) &&
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
      JSON.stringify(screen.tabs) === JSON.stringify(['Resumo', 'Anotações', 'Assistente', 'Transcrição', 'Áudio']) &&
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
 * Contrato 31 (CA3 e CA6), no claro: a aba "Plugins" com o cartão do Meet e o estado; "Salvar plugin…" cancelado não
 * grava nada; com a pasta escolhida (diálogo substituto), os 4 arquivos da extensão em "LAP Reunioes - Quem fala no
 * Meet/" e o "Salvo em …"; "Como instalar" abre o passo a passo. PNG `configuracoes-plugins-light`. Devolve a pasta
 * do diálogo como estava.
 */
async function pluginsSettings(win: BrowserWindow, ctx: SmokeContext): Promise<{ check: Check; shot: Screenshot }> {
  const contents = win.webContents
  const plugin = APP_PLUGINS.find((candidate) => candidate.id === 'meet')
  const card = `[data-settings-panel="plugins"] section[aria-label=${JSON.stringify(plugin?.nome ?? '')}]`
  const opened = await openSettingsTab(contents, 'plugins')
  await waitFor(contents, `document.querySelector('${card}')`)
  const state = await evaluate<string>(contents, `document.querySelector('[data-plugin="meet"]')?.dataset.pluginState ?? ''`)
  const stateText = await evaluate<string>(contents, `document.querySelector('[data-plugin="meet"] [data-setting-control]')?.textContent ?? ''`)
  const expectedState = ctx.meet.status().connected ? 'on' : 'off'

  const previous = ctx.fixtures.chosenFolder
  const chosen = join(smokeHome(ctx), 'Plugins salvos')
  mkdirSync(chosen, { recursive: true })
  const folder = join(chosen, plugin ? pluginFolderName(plugin) : '')
  // Cancelado: nada gravado, nenhum aviso.
  ctx.fixtures.chosenFolder = null
  await clickSelector(contents, '[data-action="plugin-save-meet"]')
  await wait(300)
  const canceledQuiet = (await evaluate<boolean>(contents, `!document.querySelector('[data-plugin-feedback]')`)) && !existsSync(folder)
  ctx.fixtures.chosenFolder = chosen
  await clickSelector(contents, '[data-action="plugin-save-meet"]')
  const saved = await waitFor(contents, `document.querySelector('[data-plugin-feedback="saved"]')`)
  const feedback = await evaluate<string>(contents, `document.querySelector('[data-plugin-feedback]')?.textContent ?? ''`)
  ctx.fixtures.chosenFolder = previous
  const files = (plugin?.arquivos ?? []).map((name) => ({ name, ok: existsSync(join(folder, name)) }))

  await clickSelector(contents, '[data-action="plugin-manual-meet"]')
  const manualOpen = await waitFor(contents, `document.querySelector('[data-plugin-manual="meet"]')`)
  const manual = await evaluate<{ text: string; steps: number; expanded: string }>(
    contents,
    `({ text: document.querySelector('[data-plugin-manual="meet"]')?.textContent ?? '', steps: document.querySelectorAll('[data-plugin-manual="meet"] ol > li').length, expanded: document.querySelector('[data-action="plugin-manual-meet"]')?.getAttribute('aria-expanded') ?? '' })`,
  )
  await settle(contents)
  const shot = await capture(win, ctx.outDir, 'configuracoes-plugins-light')
  // Contrato 46: depois do PNG, para ele não mudar: o cartão do navegador, "Ativar ponte" e o cliente falso.
  const navegador = await navegadorPluginChecks(contents, ctx)
  return {
    check: {
      ok:
        navegador.ok &&
        opened &&
        plugin !== undefined &&
        state === expectedState &&
        stateText === (expectedState === 'on' ? 'Conectado' : 'Desconectado') &&
        canceledQuiet &&
        saved &&
        feedback === `Salvo em ${folder}` &&
        files.length === 4 &&
        files.every((file) => file.ok) &&
        manualOpen &&
        manual.expanded === 'true' &&
        manual.steps === 5 &&
        manual.text.includes('chrome://extensions') &&
        manual.text.includes('Modo do desenvolvedor') &&
        manual.text.includes('Carregar sem compactação') &&
        manual.text.includes('picture-in-picture') &&
        manual.text.includes('Tudo fica neste computador: o plugin só fala com o app.'),
      detail: `aba aberta=${opened}; estado "${stateText}" (${state}, esperado ${expectedState}); cancelado sem nada=${canceledQuiet}; salvo=${saved} "${feedback}"; arquivos ${JSON.stringify(files)}; manual aberto=${manualOpen} (aria-expanded=${manual.expanded}, ${manual.steps} passos); navegador: ${navegador.detail}`,
    },
    shot,
  }
}

/**
 * Portas da ponte do navegador no smoke (contrato 46): fora da faixa da extensão (47672–47681), para o Chrome de
 * verdade, com a extensão instalada, nunca falar com o smoke.
 */
export const SMOKE_NAVEGADOR_PORTS: readonly number[] = Array.from({ length: 10 }, (_, index) => 47692 + index)

/**
 * GET de um cliente falso na ponte do navegador (contrato 46), fora da sessão do Electron. Como o Chrome real, a
 * "extensão" (`chrome-extension://…`) manda o cabeçalho da ponte e nenhum `Origin`; a página manda `Origin` e não
 * consegue mandar o cabeçalho.
 */
function navegadorGet(port: number, origin: string): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = origin.startsWith('chrome-extension://') ? { [NAVEGADOR_HEADER]: '1' } : { origin }
  return new Promise((resolve) => {
    const req = httpRequest({ agent: false, host: '127.0.0.1', port, method: 'GET', path: NAVEGADOR_COMANDOS_PATH, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    // Porta fechada ou conexão cortada ao desligar: vale como sem resposta.
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end()
  })
}

/**
 * Contrato 46, na aba Plugins: o cartão "Controle do navegador" começa desligado e "Desconectado"; "Ativar ponte"
 * grava `navegadorPlugin` e sobe a ponte numa porta do smoke; a origem de página é recusada (404) e um cliente
 * falso com origem `chrome-extension://` (o GET do long-poll, que fica pendurado) deixa o cartão "Conectado";
 * desligar fecha a porta, solta o GET e o cartão volta a "Desconectado".
 */
async function navegadorPluginChecks(contents: WebContents, ctx: SmokeContext): Promise<Check> {
  const card = '[data-plugin="navegador"]'
  const toggle = '[data-action="navegador-ponte"]'
  const cardState = (): Promise<{ state: string; text: string; checked: string }> =>
    evaluate(
      contents,
      `({ state: document.querySelector('${card}')?.dataset.pluginState ?? '', text: document.querySelector('${card} [data-setting-control]')?.textContent ?? '', checked: document.querySelector('${toggle}')?.getAttribute('aria-checked') ?? '' })`,
    )
  const present = await waitFor(contents, `document.querySelector('${card}') && document.querySelector('${toggle}')`)
  const before = await cardState()
  if (!present) return { ok: false, detail: 'cartão ou "Ativar ponte" não apareceu' }

  await clickSelector(contents, toggle)
  let port: number | null = null
  for (let attempt = 0; attempt < 100 && port === null; attempt++) {
    port = ctx.navegador.port()
    if (port === null) await wait(50)
  }
  const inRange = port !== null && SMOKE_NAVEGADOR_PORTS.includes(port) && !NAVEGADOR_PORTS.includes(port)
  const saved = readSettings(ctx.userDataDir).navegadorPlugin === true
  const refused = port === null ? { status: -1, body: '' } : await navegadorGet(port, 'https://mau.example')
  const quietAfterRefused = !ctx.navegador.connected()
  // O GET do long-poll fica pendurado até 25 s; o cartão vira "Conectado" assim que ele chega.
  const poll = port === null ? Promise.resolve({ status: -1, body: '' }) : navegadorGet(port, 'chrome-extension://abc')
  const connected = await waitFor(contents, `document.querySelector('${card}')?.dataset.pluginState === 'on'`)
  const on = await cardState()

  await clickSelector(contents, toggle)
  const disconnected = await waitFor(contents, `document.querySelector('${card}')?.dataset.pluginState === 'off' && document.querySelector('${toggle}')?.getAttribute('aria-checked') === 'false'`)
  const released = await poll
  const after = await cardState()
  const closed = ctx.navegador.port() === null && readSettings(ctx.userDataDir).navegadorPlugin === false
  return {
    ok:
      before.state === 'off' &&
      before.text.startsWith('Desconectado') &&
      before.checked === 'false' &&
      inRange &&
      saved &&
      refused.status === 404 &&
      refused.body === '' &&
      quietAfterRefused &&
      connected &&
      on.text.startsWith('Conectado') &&
      on.checked === 'true' &&
      disconnected &&
      released.status !== -1 &&
      after.text.startsWith('Desconectado') &&
      closed,
    detail: `antes ${before.state} "${before.text}" (ponte ${before.checked}); ligada: porta ${port ?? 'nenhuma'} na faixa do smoke=${inRange}, gravada=${saved}; https://mau.example → ${refused.status} "${refused.body}", conectado=${!quietAfterRefused}; chrome-extension://abc → ${on.state} "${on.text}"; desligada: ${after.state} "${after.text}", GET solto com ${released.status} "${released.body}", porta fechada e gravada=${closed}`,
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
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, routeIs('assistente'))
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
    chatNew?.cwd === join(userDataDir, CHAT_SCOPE_DIR, chatId) &&
    JSON.stringify(chatNew?.mcpServers) === '[]' &&
    JSON.stringify(options['settingSources']) === '[]' &&
    // Contrato 26: esta conversa é do Assistente, com a fonte "Internet" ligada por padrão: a busca e a página entram
    // em `tools`, saem das negadas e pedem permissão sempre. O resto das negadas (escrita, shell, subagente) fica.
    JSON.stringify(options['tools']) === JSON.stringify([...CLAUDE_READ_TOOLS, ...CLAUDE_WEB_TOOLS]) &&
    JSON.stringify(options['disallowedTools']) === JSON.stringify(CLAUDE_DISALLOWED_TOOLS.filter((tool) => !(CLAUDE_WEB_TOOLS as readonly string[]).includes(tool))) &&
    JSON.stringify(options['settings']) === JSON.stringify({ permissions: { ask: [...CLAUDE_WEB_TOOLS] } }) &&
    options['model'] === 'sonnet' &&
    String(options['systemPrompt']).startsWith('Você é o Assistente') &&
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
    // Botões das contas (Google, Microsoft): alinhados pela direita, a mesma borda em todas as linhas.
    ...Object.fromEntries(SETTINGS_TABS.map((tab) => [`controlEndSpread_${tab}`, { min: 0, max: 0.5 }])),
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
      `[...document.querySelectorAll('[data-settings-panel="${tab}"] [data-setting-control]:not([data-setting-control="end"])')].map((el) => (el.firstElementChild ?? el).getBoundingClientRect().left)`,
    )
    if (xs.length > 1) metrics[`controlSpread_${tab}`] = round(Math.max(...xs) - Math.min(...xs))
    const ends = await evaluate<number[]>(
      contents,
      `[...document.querySelectorAll('[data-settings-panel="${tab}"] [data-setting-control="end"]')].map((el) => (el.lastElementChild ?? el).getBoundingClientRect().right)`,
    )
    if (ends.length > 1) metrics[`controlEndSpread_${tab}`] = round(Math.max(...ends) - Math.min(...ends))
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
 * aberto no navegador e o atalho para "Atualizações"; a aba lembrada ao voltar; ⌘2/⌘8 e as setas; ⌘F e a
 * busca sem acento nem maiúscula, agrupada por aba, com o clique que leva à linha e a destaca por 2 s; Esc limpa.
 */
async function settingsTabsChecks(contents: WebContents, ctx: SmokeContext, shot: (name: string) => Promise<void>): Promise<Check> {
  const visibleText = (selector: string): Promise<string> => evaluate<string>(contents, `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)

  // Contas.
  const contasOpen = await openSettingsTab(contents, 'contas')
  const contas = await visibleText('[data-settings-panel="contas"]')
  const contasButtons = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-settings-panel="contas"] button')].map((el) => el.textContent ?? '')`)
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

  // Teclado: ⌘2, ⌘8 ("Sobre", desde que "Plugins" (contrato 31) e "Conexões" (contrato 21) entraram antes dela) e a seta
  // para a direita na lista de abas (da última, volta à primeira).
  const press = (key: string, meta: boolean): Promise<unknown> =>
    evaluate(contents, `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, metaKey: ${meta}, bubbles: true, cancelable: true })), true`)
  await press('2', true)
  const cmd2 = await waitFor(contents, settingsTabIs('gravacao'))
  const activeTab = `document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.dataset.tab : ''`
  const cmd2Focus = await evaluate<string>(contents, activeTab)
  await press('8', true)
  const cmd8 = await waitFor(contents, settingsTabIs('sobre'))
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
    // Contrato 11: o bloco "Google" sem cadastro, só com "Configurar…", e nenhum pedido ao Google.
    contas.includes('Conta Google') &&
    contas.includes('Para guardar as reuniões no seu Google Drive.') &&
    !contas.includes('Em breve') &&
    // Contrato 24: o bloco "WhatsApp" (não instalado) com o "Instalar" e o aviso fixo.
    // Contrato 12: o bloco "Microsoft" sem cadastro e o bloco "Agenda" (dois interruptores e "Avisar antes").
    // Contrato 40: os dois interruptores das notificações do WhatsApp, depois do "Instalar". Contrato 34: e o de
    // "Mostrar quando estou digitando". Contrato 43: o "Adicionar conta" e o interruptor das notificações de email.
    JSON.stringify(contasButtons) === JSON.stringify(['Configurar…', 'Configurar…', '', '1 min', '5 min', '10 min', '', 'Instalar', '', '', '', 'Adicionar conta', '']) &&
    contas.includes('Conta Microsoft') &&
    contas.includes('Entre com a conta Google ou Microsoft acima para escolher as agendas.') &&
    contas.includes(WHATSAPP_FIXED_WARNING) &&
    ctx.fixtures.google.calls.length === 0 &&
    ctx.fixtures.microsoft.calls.length === 0 &&
    sobreOpen &&
    sobre.includes(app.getVersion()) &&
    sobre.includes(process.versions.electron) &&
    sobre.includes(process.versions.chrome) &&
    // A licença mudou para GPL-3.0 em 19/11/2026 (commit 60d9751, que não ajustou o smoke).
    sobre.includes('GPL-3.0') &&
    opened === REPOSITORY_URL &&
    toUpdates &&
    updatesVisible &&
    remembered &&
    cmd2 &&
    cmd2Focus === 'gravacao' &&
    cmd8 &&
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
    detail: `Contas "${contas.replace(/\s+/g, ' ').trim()}" (botões ${JSON.stringify(contasButtons)}, ${ctx.fixtures.google.calls.length} pedidos ao Google); Sobre "${sobre.replace(/\s+/g, ' ').slice(0, 160)}", repositório -> ${opened || 'nada'}, "Procurar atualização" -> Geral=${toUpdates}, bloco visível=${updatesVisible}; aba lembrada=${remembered}; ⌘2=${cmd2}, ⌘8=${cmd8}, seta=${arrow}; ⌘F foca=${focused}; "TRADUCAO" -> grupos ${JSON.stringify(groups)}, itens ${JSON.stringify(items)}, painéis escondidos=${panelsHidden}; clique em "Modelo do chat" -> aba Claude e destaque=${jumped}, à vista=${inView}, busca limpa=${cleared}, destaque some em 2 s=${unhighlighted}; Esc limpa=${escaped}; foco: ⌘2 -> aba ${cmd2Focus || 'nenhuma'}, resultado -> ${resultFocus || 'fora da linha'}, Esc -> aba ${escFocus || 'nenhuma'}; durante a busca nenhuma aba marcada=${noneSelected}, região viva "${live}"; "haiku" acha "Modelo" escondido=${hiddenFound}, aviso=${hintShown}; "pasta"=${pastaFound}; ${rows.length} linhas na tela, fora do índice: ${JSON.stringify(missing)}`,
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
// Contrato 11: conta Google e envio ao Google Drive, com o Google falso em memória (`google/fake-google.ts`).

/**
 * O "navegador" do smoke: um GET no endereço de volta ao app (só 127.0.0.1 ou, para a Microsoft, `localhost`, como
 * o navegador pede: o app escuta em 127.0.0.1 e em ::1), fora da sessão do Electron.
 */
function loopbackGet(url: string): Promise<{ status: number; body: string }> {
  if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('http://localhost:')) return Promise.reject(new Error(`endereço de volta inesperado: ${url}`))
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const GOOGLE_STATE = `(document.querySelector('[data-google-state]')?.dataset.googleState ?? '')`
const DRIVE_SWITCH = `document.querySelector('[aria-labelledby="settings-save-drive"]')`

/** Os arquivos de uma pasta do Drive falso, fora da lixeira. */
function driveChildren(ctx: SmokeContext, parent: string | undefined): FakeDriveFile[] {
  return parent ? ctx.fixtures.google.childrenOf(parent).filter((file) => !file.trashed) : []
}

function driveRoot(ctx: SmokeContext): FakeDriveFile | undefined {
  return [...ctx.fixtures.google.files.values()].find((file) => file.name === DRIVE_ROOT_FOLDER_NAME && file.parents.includes('root') && !file.trashed)
}

/**
 * Contrato 11 (CA8), numa janela clara e depois numa escura: nenhum pedido ao Google antes do login; cadastro em
 * Configurações › Contas (o segredo nunca volta ao renderer); "Entrar com Google" abre só a página do Google e o
 * smoke faz o papel do navegador no servidor local; a conta aparece com foto, nome e e-mail e o interruptor
 * ligado; uma gravação da fixture vai inteira para o Drive falso (subpasta com o nome base, áudio, `.md` e
 * `- resumo.md` iguais aos da pasta); "No Drive", "Abrir no Drive" e a nuvem da lista; "Gerar de novo" substitui o
 * resumo (o mesmo id); no escuro, "Sair" revoga e apaga a sessão.
 */
async function googleChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const fake = ctx.fixtures.google
  const callsBeforeLogin = fake.calls.length
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents

  // Cadastro do cliente.
  await openSettingsTab(contents, 'contas')
  const unconfigured = await waitFor(contents, `${GOOGLE_STATE} === 'unconfigured'`)
  await clickSelector(contents, '[data-action="google-configure"]')
  const panel = await waitFor(contents, `document.querySelector('[data-google-client-panel]')`)
  const panelText = await evaluate<string>(contents, `document.querySelector('[data-google-client-panel]')?.innerText ?? ''`)
  const secretIsPassword = await evaluate<boolean>(contents, `document.querySelector('#google-client-secret')?.type === 'password'`)
  await setValue(contents, '#google-client-id', SMOKE_GOOGLE_CLIENT_ID)
  await setValue(contents, '#google-client-secret', SMOKE_GOOGLE_CLIENT_SECRET)
  await clickSelector(contents, '[data-action="google-client-save"]')
  const saved = await waitFor(contents, `${GOOGLE_STATE} === 'signed-out' && !document.querySelector('[data-google-client-panel]')`)
  const line = await text(contents, '[data-google-line]')
  const statusJson = JSON.stringify(await evaluate<unknown>(contents, "window.__scribeApi.invoke('scribe:google-status')"))
  const clientFile = join(ctx.userDataDir, 'accounts', 'google-client.bin')
  checks['client'] = {
    ok:
      unconfigured &&
      panel &&
      panelText.includes('ID do cliente') &&
      panelText.includes('Chave secreta do cliente') &&
      panelText.includes('Crie em console.cloud.google.com → Clientes → App para computador.') &&
      secretIsPassword &&
      saved &&
      line.includes('•••') &&
      !line.includes(SMOKE_GOOGLE_CLIENT_ID) &&
      !statusJson.includes(SMOKE_GOOGLE_CLIENT_SECRET) &&
      !statusJson.includes(SMOKE_GOOGLE_CLIENT_ID) &&
      mode(clientFile) === '600' &&
      callsBeforeLogin === 0 &&
      fake.calls.length === 0,
    detail: `sem cadastro=${unconfigured}; painel=${panel} "${panelText.replace(/\s+/g, ' ').slice(0, 160)}", chave em campo de senha=${secretIsPassword}; salvo=${saved}, linha "${line}"; estado sem o segredo=${!statusJson.includes(SMOKE_GOOGLE_CLIENT_SECRET)}; google-client.bin ${mode(clientFile)}; pedidos ao Google antes do login: ${callsBeforeLogin}, depois do cadastro: ${fake.calls.length}`,
  }

  // Login: o app abre a página do Google e o smoke volta pelo servidor local.
  const openedBefore = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="google-sign-in"]')
  let authUrl = ''
  for (let attempt = 0; attempt < 100 && !authUrl; attempt++) {
    authUrl = ctx.fixtures.openedUrls.slice(openedBefore).find((url) => url.startsWith('https://accounts.google.com/')) ?? ''
    if (!authUrl) await wait(50)
  }
  const waiting = await waitFor(contents, `${GOOGLE_STATE} === 'signing-in' && document.querySelector('[data-action="google-sign-in-cancel"]')`)
  const waitingLine = await text(contents, '[data-google-line]')
  const params = authUrl ? new URL(authUrl).searchParams : new URLSearchParams()
  const redirect = params.get('redirect_uri') ?? ''
  const page = authUrl ? await loopbackGet(fake.approve(authUrl)) : { status: 0, body: '' }
  const signedIn = await waitFor(contents, `${GOOGLE_STATE} === 'signed-in' && document.querySelector('img[data-google-photo]')?.naturalWidth > 0`, 8000)
  const name = await text(contents, '[data-google-name]')
  const email = await text(contents, '[data-google-line]')
  const photo = await evaluate<{ src: string; width: number }>(contents, `(() => { const img = document.querySelector('img[data-google-photo]'); return { src: (img?.getAttribute('src') ?? '').slice(0, 22), width: img?.naturalWidth ?? 0 } })()`)
  const switchOn = await evaluate<string | null>(contents, `${DRIVE_SWITCH}?.getAttribute('aria-checked') ?? null`)
  const driveRow = await evaluate<string>(contents, `${DRIVE_SWITCH}?.closest('[data-setting-row]')?.textContent ?? ''`)
  const sessionFile = join(ctx.userDataDir, 'accounts', 'google.bin')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'configuracoes-contas-logado-light'))
  checks['signIn'] = {
    ok:
      authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?') &&
      ctx.fixtures.openedUrls.slice(openedBefore).length === 1 &&
      params.get('client_id') === SMOKE_GOOGLE_CLIENT_ID &&
      // Contrato 12 (CA2): o login pede também a agenda, somando ao que já foi liberado.
      params.get('scope') === 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly' &&
      params.get('include_granted_scopes') === 'true' &&
      params.get('code_challenge_method') === 'S256' &&
      (params.get('code_challenge') ?? '').length === 43 &&
      (params.get('state') ?? '').length >= 32 &&
      params.get('access_type') === 'offline' &&
      params.get('prompt') === 'consent' &&
      !authUrl.includes(SMOKE_GOOGLE_CLIENT_SECRET) &&
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(redirect) &&
      waiting &&
      waitingLine === 'Continue no navegador…' &&
      page.status === 200 &&
      page.body.includes(CALLBACK_DONE_TEXT) &&
      signedIn &&
      name === 'Andrea Teste' &&
      email === 'andrea.teste@example.com' &&
      photo.src === 'data:image/png;base64,' &&
      photo.width > 0 &&
      photo.width <= 256 &&
      switchOn === 'true' &&
      driveRow.includes('Depois de cada reunião, o áudio, a transcrição e o resumo vão para a pasta "LAP Reuniões" do seu Drive.') &&
      mode(sessionFile) === '600',
    detail: `URL ${authUrl.split('?')[0] ?? ''} (parâmetros ${[...params.keys()].join(', ')}), redirect ${redirect}; esperando=${waiting} "${waitingLine}"; página de volta ${page.status} "${page.body.includes(CALLBACK_DONE_TEXT) ? CALLBACK_DONE_TEXT : page.body.slice(0, 80)}"; logado=${signedIn}: "${name}" <${email}>, foto ${photo.src}… ${photo.width} px; interruptor ${switchOn}; google.bin ${mode(sessionFile)}`,
  }

  // Uma gravação da fixture vai para o Drive.
  const segments = fixtureSegments(liveFixtureLines(readSessionFixture()))
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('[data-action="new-recording"]')`)
  await clickSelector(contents, '[data-action="new-recording"]')
  await waitFor(contents, `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`)
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(segments)})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === ${segments.length}`)
  await wait(1500)
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'), 15000)
  let recorded: Meeting | undefined
  for (let attempt = 0; attempt < 200 && !recorded; attempt++) {
    recorded = readMeetings(ctx.userDataDir).find((meeting) => !idsBefore.has(meeting.id) && meeting.audioPath !== null && meeting.transcriptPath !== null)
    if (!recorded) await wait(50)
  }
  const summaryFile = recorded ? summaryFileTarget(recorded) : null
  const summaryPath = summaryFile ? join(summaryFile.folder, summaryFile.name) : ''
  // "Resumir ao encerrar" desligado por um passo anterior: o resumo é pedido pela tela.
  if (!(await waitFor(contents, `document.querySelector('[data-action="regenerate-summary"]')`, 12000))) {
    await clickSelector(contents, '[data-action="generate-summary"]')
    await waitFor(contents, `document.querySelector('[data-action="regenerate-summary"]')`, 12000)
  }
  const base = recorded?.audioPath ? basename(recorded.audioPath).replace(/\.(m4a|webm)$/, '') : ''
  let folder: FakeDriveFile | undefined
  let files: FakeDriveFile[] = []
  for (let attempt = 0; attempt < 300 && files.length < 3; attempt++) {
    folder = driveChildren(ctx, driveRoot(ctx)?.id).find((file) => file.name === base)
    files = driveChildren(ctx, folder?.id)
    if (files.length < 3) await wait(50)
  }
  const named = (name: string): FakeDriveFile | undefined => files.find((file) => file.name === name)
  const audioExt = recorded?.audioPath?.split('.').pop() ?? ''
  const same = (file: FakeDriveFile | undefined, path: string): boolean => Boolean(file && path && existsSync(path) && file.content.equals(readFileSync(path)))
  const audioSame = same(named(`${base}.${audioExt}`), recorded?.audioPath ?? '')
  const transcriptSame = same(named(`${base}.md`), recorded?.transcriptPath ?? '')
  const summarySame = same(named(`${base} - resumo.md`), summaryPath)
  // Aba "Áudio": "No Drive" e "Abrir no Drive".
  await clickSelector(contents, '[role="tab"][data-tab="audio"]')
  const doneShown = await waitFor(contents, `document.querySelector('[data-drive-status="done"] [data-drive-text]')?.textContent === 'No Drive'`, 8000)
  const openedBeforeDrive = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="drive-open"]')
  await wait(150)
  const openedDrive = ctx.fixtures.openedUrls.slice(openedBeforeDrive)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'detalhe-drive-light'))
  checks['upload'] = {
    ok:
      recorded !== undefined &&
      driveRoot(ctx)?.mimeType === 'application/vnd.google-apps.folder' &&
      folder?.mimeType === 'application/vnd.google-apps.folder' &&
      /^\d{4}-\d{2}-\d{2} \d{2}h\d{2} - /.test(base) &&
      files.length === 3 &&
      audioSame &&
      transcriptSame &&
      summarySame &&
      doneShown &&
      openedDrive.length === 1 &&
      openedDrive[0] === `https://drive.google.com/drive/folders/${folder?.id ?? ''}`,
    detail: `reunião ${recorded?.id ?? 'não salva'}; "LAP Reuniões"=${Boolean(driveRoot(ctx))}, subpasta "${folder?.name ?? '?'}"; arquivos ${JSON.stringify(files.map((file) => `${file.name} (${file.content.byteLength} B, ${file.mimeType})`))}; iguais aos da pasta: áudio=${audioSame}, transcrição=${transcriptSame}, resumo=${summarySame}; "No Drive"=${doneShown}; "Abrir no Drive" -> ${openedDrive.join(', ') || 'nada'}`,
  }

  // "Gerar de novo": o resumo novo substitui o do Drive (o mesmo id).
  const summaryBefore = named(`${base} - resumo.md`)
  const uploadsBefore = summaryBefore?.uploads ?? 0
  await clickSelector(contents, '[role="tab"][data-tab="resumo"]')
  await waitFor(contents, `document.querySelector('[data-action="regenerate-summary"]')`)
  await clickSelector(contents, '[data-action="regenerate-summary"]')
  let replaced = false
  for (let attempt = 0; attempt < 300 && !replaced; attempt++) {
    replaced = (summaryBefore?.uploads ?? 0) > uploadsBefore
    if (!replaced) await wait(50)
  }
  const summaries = driveChildren(ctx, folder?.id).filter((file) => file.name.endsWith(' - resumo.md'))
  // Lista: a nuvem discreta na linha da reunião.
  await clickSelector(contents, '[data-nav="reunioes"]')
  const cloud = await waitFor(contents, `document.querySelector('main a[data-meeting="${recorded?.id ?? ''}"] [data-in-drive]')`)
  const cloudLabel = await evaluate<string>(contents, `document.querySelector('main a[data-meeting="${recorded?.id ?? ''}"] [data-in-drive]')?.getAttribute('aria-label') ?? ''`)
  checks['replaceSummary'] = {
    ok: replaced && summaries.length === 1 && summaries[0]?.id === summaryBefore?.id && same(summaries[0], summaryPath) && cloud && cloudLabel === 'No Google Drive',
    detail: `envios do resumo ${uploadsBefore} -> ${summaryBefore?.uploads ?? 0}; ${summaries.length} resumo(s) na subpasta, mesmo id=${summaries[0]?.id === summaryBefore?.id}, igual ao da pasta=${same(summaries[0], summaryPath)}; nuvem na lista=${cloud} "${cloudLabel}"`,
  }
  win.destroy()

  // Escuro: logado e, depois de "Sair", deslogado.
  const dark = ctx.openWindow({ theme: 'dark' })
  watch(dark)
  await loadAndWait(dark)
  const darkContents = dark.webContents
  await openSettingsTab(darkContents, 'contas')
  const darkSignedIn = await waitFor(darkContents, `${GOOGLE_STATE} === 'signed-in' && document.querySelector('img[data-google-photo]')?.naturalWidth > 0`)
  await settle(darkContents)
  shots.push(await capture(dark, ctx.outDir, 'configuracoes-contas-logado-dark'))
  await clickSelector(darkContents, '[data-action="google-sign-out"]')
  const signedOut = await waitFor(darkContents, `${GOOGLE_STATE} === 'signed-out' && !${DRIVE_SWITCH} && document.querySelector('[data-action="google-sign-in"]')`)
  await settle(darkContents)
  shots.push(await capture(dark, ctx.outDir, 'configuracoes-contas-dark'))
  checks['signOut'] = {
    ok: darkSignedIn && signedOut && fake.revoked === 1 && fake.refreshTokens().length === 0 && !existsSync(sessionFile) && existsSync(clientFile),
    detail: `escuro logado=${darkSignedIn}; "Sair" -> deslogado=${signedOut}, ${fake.revoked} token(s) revogado(s), google.bin apagado=${!existsSync(sessionFile)}, cadastro mantido=${existsSync(clientFile)}`,
  }
  dark.destroy()
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 12: agendas Google e Microsoft, com as duas contas falsas em memória (nada sai da máquina).

/**
 * Contrato 12 (CA11): nada da agenda no relatório. Os títulos dos eventos viram nome de arquivo das reuniões
 * gravadas (pasta e Drive) e o link da chamada vai para as URLs abertas: no relatório, só `<agenda>`.
 */
const SMOKE_CALENDAR_TEXTS = ['Alinhamento com o jurídico', 'Status da obra', 'Orçamento do trimestre', 'https://teams.microsoft.com/l/meetup-join/smoke', 'https://meet.google.com/smk-abcd-efg']
function redactCalendar(value: string): string {
  return SMOKE_CALENDAR_TEXTS.reduce((text, secret) => text.split(secret).join('<agenda>'), value.normalize('NFC'))
}

const MICROSOFT_STATE = `(document.querySelector('[data-microsoft-state]')?.dataset.microsoftState ?? '')`
const UPCOMING_TITLES = `[...document.querySelectorAll('[data-upcoming-title]')].map((el) => el.textContent ?? '')`
const LIVE_TITLE = `(document.querySelector('main h1')?.textContent ?? '')`

/** Eventos crus inventados, no formato de cada API, em volta de agora. */
function smokeCalendarEvents(now: number): { revisao: Record<string, unknown>; planejamento: Record<string, unknown>; status: Record<string, unknown> } {
  const at = (minutes: number): string => new Date(now + minutes * 60_000).toISOString()
  const graph = (minutes: number): { dateTime: string; timeZone: string } => ({ dateTime: at(minutes).replace('Z', ''), timeZone: 'UTC' })
  return {
    // Começa em 4,5 min: "Reunião em 5 min".
    revisao: {
      id: 'smoke-revisao',
      status: 'confirmed',
      summary: 'Alinhamento com o jurídico',
      start: { dateTime: at(4.5) },
      end: { dateTime: at(34.5) },
      attendees: [
        { email: 'andrea.teste@example.com', self: true, responseStatus: 'accepted' },
        { email: 'ana.lima@example.com', displayName: 'Ana Lima', responseStatus: 'accepted' },
        { email: 'bruno.souza@example.com', displayName: 'Bruno Souza', responseStatus: 'needsAction' },
      ],
      hangoutLink: 'https://meet.google.com/smk-abcd-efg',
    },
    planejamento: {
      id: 'smoke-planejamento',
      status: 'confirmed',
      summary: 'Orçamento do trimestre',
      start: { dateTime: at(120) },
      end: { dateTime: at(150) },
      attendees: [{ email: 'davi.reis@example.com', displayName: 'Davi Reis' }],
      location: 'https://empresa.zoom.us/j/123456789',
    },
    // Começou há 3 min e ninguém grava.
    status: {
      id: 'smoke-status',
      subject: 'Status da obra',
      start: graph(-3),
      end: graph(30),
      isAllDay: false,
      isCancelled: false,
      responseStatus: { response: 'accepted' },
      organizer: { emailAddress: { name: 'Carla Dias', address: 'carla.dias@example.com' } },
      attendees: [{ type: 'required', emailAddress: { name: 'Bruno Teste', address: 'bruno.teste@example.com' } }],
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/smoke' },
    },
  }
}

/** Espera a notificação substituta de um tipo (e com o texto, se dado). */
async function calendarNotice(ctx: SmokeContext, kind: string, includes = ''): Promise<SmokeFixtures['calendar']['notifications'][number] | undefined> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = ctx.fixtures.calendar.notifications.find((item) => item.kind === kind && `${item.title} ${item.body}`.includes(includes))
    if (found) return found
    await wait(50)
  }
  return undefined
}

/** Grava até a reunião ser salva e o detalhe abrir; devolve a reunião nova. */
async function endCalendarRecording(contents: WebContents, ctx: SmokeContext, idsBefore: ReadonlySet<string>): Promise<Meeting | undefined> {
  await wait(1200)
  await clickSelector(contents, '[data-action="end-recording"]')
  await waitFor(contents, routeIs('detalhe'), 15000)
  let saved: Meeting | undefined
  for (let attempt = 0; attempt < 200 && !saved; attempt++) {
    saved = readMeetings(ctx.userDataDir).find((meeting) => !idsBefore.has(meeting.id))
    if (!saved) await wait(50)
  }
  return saved
}

/**
 * Contrato 12 (CA12), numa janela clara: sem contas, nenhum pedido às agendas e nenhum aviso; o cadastro e o login da
 * Microsoft (o smoke faz o papel do navegador em `http://localhost:<porta>`); o Google de novo, agora com a agenda;
 * o bloco "Agenda" com as agendas de cada conta; as notificações substitutas ("Reunião em 5 min" de um evento do
 * Google e "não está sendo gravada" de um da Microsoft que começou há 3 min); a faixa e "Próximas" em Reuniões;
 * "Entrar na chamada"; "Gravar" pela faixa (título do evento, `calendar` na reunião, "Da agenda" no detalhe);
 * "Gravar" pela notificação e o evento cancelado no meio ("A gravação continua."); e "Sair" das duas contas.
 */
async function calendarChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const google = ctx.fixtures.google
  const microsoft = ctx.fixtures.microsoft
  const notices = ctx.fixtures.calendar.notifications
  const events = smokeCalendarEvents(Date.now())
  google.calendars.push({ id: 'equipe@group.calendar.google.com', summary: 'Equipe', primary: false })
  google.events.set('primary', [events.revisao, events.planejamento])
  microsoft.events.set('default', [events.status])
  // Sem contas (o Google saiu no fim de `googleChecks`): uma leitura agora não pede nada nem avisa.
  const googleReadsBefore = google.eventReads.length
  await ctx.calendar.refresh()
  const idle = microsoft.calls.length === 0 && google.eventReads.length === googleReadsBefore && notices.length === 0 && !ctx.calendar.view().connected

  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents

  // Microsoft: cadastro e login.
  await openSettingsTab(contents, 'contas')
  const unconfigured = await waitFor(contents, `${MICROSOFT_STATE} === 'unconfigured'`)
  await clickSelector(contents, '[data-action="microsoft-configure"]')
  const panel = await waitFor(contents, `document.querySelector('[data-microsoft-client-panel]')?.innerText.includes('ID do aplicativo (cliente)')`)
  await setValue(contents, '#microsoft-client-id', SMOKE_MICROSOFT_CLIENT_ID)
  await clickSelector(contents, '[data-action="microsoft-client-save"]')
  const saved = await waitFor(contents, `${MICROSOFT_STATE} === 'signed-out' && !document.querySelector('[data-microsoft-client-panel]')`)
  const line = await text(contents, '[data-microsoft-line]')
  const clientFile = join(ctx.userDataDir, 'accounts', 'microsoft-client.bin')
  const openedBefore = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="microsoft-sign-in"]')
  let authUrl = ''
  for (let attempt = 0; attempt < 100 && !authUrl; attempt++) {
    authUrl = ctx.fixtures.openedUrls.slice(openedBefore).find((url) => url.startsWith('https://login.microsoftonline.com/')) ?? ''
    if (!authUrl) await wait(50)
  }
  const params = authUrl ? new URL(authUrl).searchParams : new URLSearchParams()
  const redirect = params.get('redirect_uri') ?? ''
  const page = authUrl ? await loopbackGet(microsoft.approve(authUrl)) : { status: 0, body: '' }
  const signedIn = await waitFor(contents, `${MICROSOFT_STATE} === 'signed-in' && document.querySelector('img[data-microsoft-photo]')?.naturalWidth > 0`, 8000)
  const name = await text(contents, '[data-microsoft-name]')
  const email = await text(contents, '[data-microsoft-line]')
  const msState = await evaluate<string>(contents, `${MICROSOFT_STATE} + ' foto ' + (document.querySelector('img[data-microsoft-photo]')?.naturalWidth ?? 'sem')`)
  const sessionFile = join(ctx.userDataDir, 'accounts', 'microsoft.bin')
  checks['microsoft'] = {
    ok:
      idle &&
      unconfigured &&
      panel &&
      saved &&
      line.includes('•••') &&
      !line.includes(SMOKE_MICROSOFT_CLIENT_ID) &&
      mode(clientFile) === '600' &&
      authUrl.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?') &&
      params.get('client_id') === SMOKE_MICROSOFT_CLIENT_ID &&
      params.get('scope') === 'openid profile email offline_access User.Read Calendars.Read' &&
      params.get('code_challenge_method') === 'S256' &&
      (params.get('code_challenge') ?? '').length === 43 &&
      /^http:\/\/localhost:\d+$/.test(redirect) &&
      page.status === 200 &&
      page.body.includes(CALLBACK_DONE_TEXT) &&
      signedIn &&
      name === 'Bruno Teste' &&
      email === 'bruno.teste@example.com' &&
      microsoft.tokenFields.length > 0 &&
      microsoft.tokenFields.every((fields) => !fields.includes('client_secret')) &&
      mode(sessionFile) === '600',
    detail: `sem contas: nenhum pedido nem aviso=${idle}; sem cadastro=${unconfigured}, painel=${panel}, salvo=${saved} (linha mascarada=${line.includes('•••') && !line.includes(SMOKE_MICROSOFT_CLIENT_ID)}), microsoft-client.bin ${mode(clientFile)}; URL ${authUrl.split('?')[0] ?? ''} (parâmetros ${[...params.keys()].join(', ')}), volta ${redirect.replace(/\d+$/, '<porta>')}; página ${page.status}; logado=${signedIn} (${msState}); pedidos de token sem chave secreta=${microsoft.tokenFields.every((fields) => !fields.includes('client_secret'))}; microsoft.bin ${mode(sessionFile)}`,
  }

  // Google de novo, agora com a agenda no mesmo login.
  const googleOpened = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="google-sign-in"]')
  let googleUrl = ''
  for (let attempt = 0; attempt < 100 && !googleUrl; attempt++) {
    googleUrl = ctx.fixtures.openedUrls.slice(googleOpened).find((url) => url.startsWith('https://accounts.google.com/')) ?? ''
    if (!googleUrl) await wait(50)
  }
  const googleParams = googleUrl ? new URL(googleUrl).searchParams : new URLSearchParams()
  if (googleUrl) await loopbackGet(google.approve(googleUrl))
  const googleIn = await waitFor(contents, `${GOOGLE_STATE} === 'signed-in' && !document.querySelector('[data-action="google-calendar-grant"]')`, 8000)
  checks['googleCalendar'] = {
    ok: googleIn && (googleParams.get('scope') ?? '').split(' ').includes('https://www.googleapis.com/auth/calendar.readonly') && googleParams.get('include_granted_scopes') === 'true' && google.granted.has('https://www.googleapis.com/auth/calendar.readonly'),
    detail: `Google logado com a agenda=${googleIn}; escopos ${googleParams.get('scope') ?? '?'}; include_granted_scopes=${googleParams.get('include_granted_scopes') ?? '?'}`,
  }

  // As duas agendas lidas: as notificações e o bloco "Agenda".
  await ctx.calendar.refresh()
  const before = await calendarNotice(ctx, 'before', 'Alinhamento com o jurídico')
  const late = await calendarNotice(ctx, 'not-recording', 'Status da obra')
  const googleRead = google.eventReads.at(-1)
  const microsoftRead = microsoft.eventReads.at(-1)
  const windowOk = (from: string, to: string): boolean => Math.abs(Date.parse(to) - Date.parse(from) - 25 * 3_600_000) < 5_000 && Math.abs(Date.parse(from) - (Date.now() - 3_600_000)) < 60_000
  checks['notices'] = {
    ok:
      before?.title === 'Reunião em 5 min: Alinhamento com o jurídico' &&
      /^\d{2}:\d{2} · Ana Lima, Bruno Souza$/.test(before.body) &&
      JSON.stringify(before.actions) === JSON.stringify(['Gravar']) &&
      late?.body === 'A reunião "Status da obra" começou e não está sendo gravada.' &&
      JSON.stringify(late.actions) === JSON.stringify(['Gravar']) &&
      googleRead?.calendarId === 'primary' &&
      googleRead.showDeleted === 'true' &&
      windowOk(googleRead.timeMin, googleRead.timeMax) &&
      microsoftRead?.calendarId === 'default' &&
      microsoftRead.prefer === 'outlook.timezone="UTC"' &&
      windowOk(microsoftRead.startDateTime, microsoftRead.endDateTime),
    detail: `"Reunião em 5 min" com hora e participantes=${Boolean(before && /^\d{2}:\d{2} · /.test(before.body))}, "Gravar"=${JSON.stringify(before?.actions ?? [])}; "não está sendo gravada"=${Boolean(late)}; Google: agenda principal, cancelados=${googleRead?.showDeleted ?? '?'}, janela −1 h a +24 h=${googleRead ? windowOk(googleRead.timeMin, googleRead.timeMax) : false}; Microsoft: calendarView=${microsoftRead?.calendarId === 'default'}, Prefer UTC=${microsoftRead?.prefer === 'outlook.timezone="UTC"'}, janela=${microsoftRead ? windowOk(microsoftRead.startDateTime, microsoftRead.endDateTime) : false}; ${notices.length} notificação(ões)`,
  }

  const checksReady = await waitFor(contents, `document.querySelectorAll('[data-calendar-check]').length === 3`, 8000)
  const checked = await evaluate<Record<string, boolean>>(contents, `Object.fromEntries([...document.querySelectorAll('[data-calendar-check]')].map((el) => [el.dataset.calendarCheck, el.checked]))`)
  const lead = await evaluate<string>(contents, `document.querySelector('[data-calendar-lead-option][aria-pressed="true"]')?.dataset.calendarLeadOption ?? ''`)
  const switches = await evaluate<string[]>(contents, `['settings-calendar-alerts', 'settings-calendar-not-recording'].map((id) => document.querySelector('[aria-labelledby="' + id + '"]')?.getAttribute('aria-checked') ?? '')`)
  await scrollToSection(contents, 'Agenda')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'configuracoes-agenda-light'))
  checks['settings'] = {
    ok: checksReady && checked['google:primary'] === true && checked['google:equipe@group.calendar.google.com'] === false && checked['microsoft:default'] === true && lead === '5' && JSON.stringify(switches) === JSON.stringify(['true', 'true']),
    detail: `agendas na tela=${checksReady} ${JSON.stringify(Object.values(checked))}; "Avisar antes"=${lead} min; interruptores ${JSON.stringify(switches)}`,
  }

  // Reuniões: a faixa e "Próximas".
  await clickSelector(contents, '[data-nav="reunioes"]')
  const shown = await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('[data-calendar-banner]') && document.querySelectorAll('[data-upcoming-event]').length === 3`, 8000)
  const titles = await evaluate<string[]>(contents, UPCOMING_TITLES)
  const firstTime = await text(contents, '[data-upcoming-time]')
  const bannerText = await text(contents, '[data-notice="calendar-not-recording"]')
  const bannerButtons = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-calendar-banner] button')].map((el) => el.textContent ?? '')`)
  const joinBefore = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-upcoming-event="microsoft:default:smoke-status"] [data-action="calendar-join"]')
  await wait(150)
  const joined = ctx.fixtures.openedUrls.slice(joinBefore)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'gravacao-faixa-agenda-light'))
  checks['banner'] = {
    ok:
      shown &&
      JSON.stringify(titles) === JSON.stringify(['Status da obra', 'Alinhamento com o jurídico', 'Orçamento do trimestre']) &&
      firstTime === 'Agora' &&
      bannerText.includes('A reunião "Status da obra" começou e não está sendo gravada.') &&
      JSON.stringify(bannerButtons) === JSON.stringify(['Gravar', 'Ignorar']) &&
      joined.length === 1 &&
      joined[0] === 'https://teams.microsoft.com/l/meetup-join/smoke',
    detail: `faixa e "Próximas"=${shown}, ${titles.length} reunião(ões) na ordem certa=${JSON.stringify(titles) === JSON.stringify(['Status da obra', 'Alinhamento com o jurídico', 'Orçamento do trimestre'])}, a primeira "${firstTime}"; botões da faixa ${JSON.stringify(bannerButtons)}; "Entrar na chamada" abriu ${joined.length} link(s) https do Teams=${joined[0]?.startsWith('https://teams.microsoft.com/') ?? false}`,
  }

  // "Gravar" pela faixa: o título do evento e o `calendar` na reunião.
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  await clickSelector(contents, '[data-action="calendar-banner-record"]')
  const bannerRecording = await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live' && ${LIVE_TITLE} === 'Status da obra' && !document.querySelector('[data-calendar-banner]')`, 8000)
  const fromBanner = await endCalendarRecording(contents, ctx, idsBefore)
  const origin = (await waitFor(contents, `/^Da agenda: Microsoft · \\d{2}:\\d{2} · Carla Dias$/.test(document.querySelector('[data-calendar-origin]')?.textContent ?? '')`, 5000)) as boolean
  checks['recordFromBanner'] = {
    ok:
      bannerRecording &&
      fromBanner?.title === 'Status da obra' &&
      fromBanner.calendar?.provider === 'microsoft' &&
      fromBanner.calendar.eventId === 'smoke-status' &&
      fromBanner.calendar.title === 'Status da obra' &&
      JSON.stringify(fromBanner.calendar.attendees) === JSON.stringify([{ name: 'Carla Dias', email: 'carla.dias@example.com' }]) &&
      fromBanner.calendar.joinUrl === 'https://teams.microsoft.com/l/meetup-join/smoke' &&
      origin,
    detail: `"Gravar" da faixa gravou com o título do evento e a faixa sumiu=${bannerRecording}; reunião salva com o evento da Microsoft=${fromBanner?.calendar?.provider === 'microsoft' && fromBanner.calendar.eventId === 'smoke-status'}, participantes=${fromBanner?.calendar?.attendees.length ?? 0}, link=${Boolean(fromBanner?.calendar?.joinUrl)}; "Da agenda: Microsoft · hh:mm" no detalhe=${origin}`,
  }

  // "Gravar" pela notificação; o evento é cancelado no meio da gravação dele.
  const idsMiddle = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  before?.act()
  const noticeRecording = await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live' && ${LIVE_TITLE} === 'Alinhamento com o jurídico'`, 8000)
  google.events.set('primary', [{ ...events.revisao, status: 'cancelled' }, events.planejamento])
  await ctx.calendar.refresh()
  const cancelled = await calendarNotice(ctx, 'cancelled', 'Alinhamento com o jurídico')
  const stillRecording = await evaluate<boolean>(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live'`)
  const fromNotice = await endCalendarRecording(contents, ctx, idsMiddle)
  checks['recordFromNotice'] = {
    ok:
      noticeRecording &&
      /^A reunião "Alinhamento com o jurídico" das \d{2}:\d{2} foi cancelada\. A gravação continua\.$/.test(cancelled?.body ?? '') &&
      JSON.stringify(cancelled?.actions ?? null) === '[]' &&
      stillRecording &&
      fromNotice?.title === 'Alinhamento com o jurídico' &&
      fromNotice.calendar?.provider === 'google' &&
      fromNotice.calendar.eventId === 'smoke-revisao' &&
      fromNotice.calendar.attendees.length === 2,
    detail: `"Gravar" da notificação gravou com o título do evento=${noticeRecording}; cancelada no meio: "…foi cancelada. A gravação continua."=${/A gravação continua\.$/.test(cancelled?.body ?? '')}, gravação seguiu=${stillRecording}; reunião salva com o evento do Google=${fromNotice?.calendar?.provider === 'google' && fromNotice.calendar.eventId === 'smoke-revisao'}`,
  }

  // Reuniões depois: a cancelada saiu de "Próximas", a gravada não tem mais faixa e a linha mostra os participantes.
  await clickSelector(contents, '[data-nav="reunioes"]')
  const after = await waitFor(
    contents,
    `${routeIs('reunioes')} && JSON.stringify(${UPCOMING_TITLES}) === ${JSON.stringify(JSON.stringify(['Status da obra', 'Orçamento do trimestre']))} && !document.querySelector('[data-calendar-banner]')`,
    8000,
  )
  const rowNames = await evaluate<string>(contents, `document.querySelector('main a[data-meeting="${fromBanner?.id ?? ''}"] [data-attendees]')?.textContent ?? ''`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'reunioes-proximas-light'))
  checks['upcoming'] = {
    ok: after && rowNames.includes('Carla Dias'),
    detail: `"Próximas" sem a cancelada e sem faixa=${after}; participantes na linha da reunião=${rowNames.includes('Carla Dias')}`,
  }

  // "Sair" das duas contas: nada da agenda na tela e o cache apagado.
  await openSettingsTab(contents, 'contas')
  await clickSelector(contents, '[data-action="microsoft-sign-out"]')
  await waitFor(contents, `${MICROSOFT_STATE} === 'signed-out'`)
  await clickSelector(contents, '[data-action="google-sign-out"]')
  const outBoth = await waitFor(contents, `${MICROSOFT_STATE} === 'signed-out' && ${GOOGLE_STATE} === 'signed-out'`)
  await ctx.calendar.refresh()
  await clickSelector(contents, '[data-nav="reunioes"]')
  const gone = await waitFor(contents, `${routeIs('reunioes')} && !document.querySelector('[data-upcoming]') && !document.querySelector('[data-calendar-banner]')`)
  checks['signOut'] = {
    ok: outBoth && gone && !existsSync(sessionFile) && !existsSync(join(ctx.userDataDir, 'calendar-cache.json')) && !ctx.calendar.view().connected,
    detail: `as duas contas saíram=${outBoth}; "Próximas" e faixa sumiram=${gone}; microsoft.bin apagado=${!existsSync(sessionFile)}; cache da agenda apagado=${!existsSync(join(ctx.userDataDir, 'calendar-cache.json'))}`,
  }
  win.destroy()
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

// Contrato 24: o QR fixo e a conta do serviço falso (`services/whatsapp-bridge/backend_fake.py`).
const WA_FAKE_QR = '2@smoke-qr-falso,AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=,smoke-chave-publica-falsa,smoke-segredo-falso'
const WA_ANA = '5511911110000@s.whatsapp.net'
const WA_ATLAS = '120363000000000001@g.us'
const WA_BRUNO = '5511922220000@s.whatsapp.net'
/** Contrato 32: a Ana do serviço falso tem 3 mensagens de hoje e 8 de histórico, espalhadas pelos últimos dias. */
const WA_ANA_SEEDED = 11
const WA_STATE = `(document.querySelector('[data-whatsapp-state]')?.dataset.whatsappState ?? '')`
const WA_INSTRUCTION = 'responda confirmando a reunião de sexta'

/** O que o serviço falso "enviou" (só na memória dele). */
async function waSent(ctx: SmokeContext): Promise<{ id: string; chatId: string; text: string }[]> {
  const result = (await ctx.whatsapp.fake('sent')) as { sent?: { id: string; chatId: string; text: string }[] }
  return result.sent ?? []
}

/**
 * Contrato 24 (CA7), numa janela clara e depois numa escura, com o serviço falso em Python (sem neonize, sem rede) e
 * o índice de pacotes falso: "Não instalado" sem nenhum processo; "Instalar" pela tela de risco (o `venv` e o `pip
 * --require-hashes` de verdade, do índice local); "Ligar"; "Parear" mostra a tela de risco antes de qualquer QR
 * (botão desabilitado até marcar a caixa; "Cancelar" não mostra QR) e o QR desenhado do texto fixo; o celular falso
 * lê o QR; as conversas, a conversa aberta (texto como texto, mídia como metadado) e a mensagem nova pelo SSE;
 * "Rascunho com o Claude" (agente ACP falso) preenche o campo sem enviar; o envio sem clique recusado (canal com
 * token inventado, `whatsappSend` sem ativação do usuário, o evento do clique pelo `send` genérico) e o envio com o
 * clique; e o escopo do "Perguntar" com uma conversa. Contrato 32: as fotos (Ana e Atlas) e as iniciais (Bruno) na
 * lista e o painel Detalhes com a análise do Claude falso, os gráficos locais e o custo. Contrato 33: o topo sem
 * título nem aviso, os Detalhes fechados ao abrir abaixo de 1280 px e abertos acima, e o envio sem diálogo.
 */
/** Contrato 36: o que o balão temporário do envio mostrou na tela, observado a cada mudança do DOM. */
interface PendingLog {
  seen: boolean
  text: string
  status: string
  shimmer: boolean
  /** O temporário e o balão real de `realText` na tela ao mesmo tempo (nunca deveria). */
  both: boolean
}

/** Começa a observar o balão temporário (`[data-wa-pending]`): o eco pode chegar rápido demais para uma consulta só. */
async function watchPending(contents: WebContents, realText: string): Promise<void> {
  await evaluate(
    contents,
    `(() => {
      window.__waPendingStop?.()
      const log = (window.__waPendingLog = { seen: false, text: '', status: '', shimmer: false, both: false })
      const look = () => {
        const pending = document.querySelector('[data-wa-pending]')
        if (!pending) return
        log.seen = true
        log.text ||= pending.querySelector('[data-wa-pending-text]')?.textContent ?? ''
        log.status ||= pending.querySelector('[data-wa-pending-status]')?.textContent ?? ''
        log.shimmer ||= Boolean(pending.querySelector('.wa-pending-shimmer'))
        if ([...document.querySelectorAll('[data-whatsapp-message][data-from-me="true"] [data-whatsapp-text]')].some((el) => el.textContent === ${JSON.stringify(realText)})) log.both = true
      }
      const observer = new MutationObserver(look)
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      window.__waPendingStop = () => observer.disconnect()
      return true
    })()`,
  )
}

async function stopPending(contents: WebContents): Promise<PendingLog> {
  return evaluate<PendingLog>(contents, `(() => { window.__waPendingStop?.(); window.__waPendingStop = undefined; return window.__waPendingLog })()`)
}

async function whatsappChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const root = join(ctx.userDataDir, 'whatsapp')

  // Não instalado: nada roda, nenhuma pasta, nenhuma tela na barra lateral.
  await openSettingsTab(contents, 'contas')
  const notInstalled = await waitFor(contents, `${WA_STATE} === 'not-installed'`)
  const lineBefore = await text(contents, '[data-whatsapp-line]')
  const warning = await text(contents, '[data-notice="whatsapp-warning"]')
  const navHidden = await evaluate<boolean>(contents, `!document.querySelector('[data-nav="whatsapp"]')`)
  const nothingYet = !existsSync(join(root, 'venv')) && ctx.whatsapp.status().state === 'not-installed'
  checks['detect'] = {
    ok: notInstalled && lineBefore === 'Não instalado' && warning === WHATSAPP_FIXED_WARNING && navHidden && nothingYet,
    detail: `estado=${notInstalled} "${lineBefore}"; aviso fixo="${warning}"; sem item na barra=${navHidden}; sem venv nem processo=${nothingYet}`,
  }

  // Instalar: a tela de risco antes, e o ambiente de verdade a partir do índice local.
  await clickSelector(contents, '[data-action="whatsapp-install"]')
  const installRisk = await waitFor(contents, `document.querySelector('[data-whatsapp-risk]') && document.querySelector('[data-action="whatsapp-install-confirm"]')?.disabled === true`)
  await clickSelector(contents, '[data-whatsapp-risk-check]')
  await waitFor(contents, `document.querySelector('[data-action="whatsapp-install-confirm"]')?.disabled === false`)
  await clickSelector(contents, '[data-action="whatsapp-install-confirm"]')
  const installing = await waitFor(contents, `${WA_STATE} === 'installing' || ${WA_STATE} === 'stopped'`)
  const installed = await waitFor(contents, `${WA_STATE} === 'stopped'`, 180_000)
  const installedLine = await text(contents, '[data-whatsapp-line]')
  const venvOk = existsSync(join(root, 'venv', 'bin', 'python')) && existsSync(join(root, 'installed.json'))
  const acceptances = (): { at: string; purpose: string }[] => {
    try {
      return (JSON.parse(readFileSync(join(root, 'aceite.json'), 'utf8')) as { acceptances: { at: string; purpose: string }[] }).acceptances
    } catch {
      return []
    }
  }
  const afterInstall = acceptances()
  checks['install'] = {
    ok: installRisk && installing && installed && installedLine === 'Parado' && venvOk && afterInstall.length === 1 && afterInstall[0]?.purpose === 'install' && mode(join(root, 'aceite.json')) === '600',
    detail: `tela de risco antes (botão desabilitado)=${installRisk}; instalando=${installing}; instalado=${installed} "${installedLine}"; venv=${venvOk}; aceite.json ${mode(join(root, 'aceite.json'))} ${JSON.stringify(afterInstall.map((item) => item.purpose))}; erro=${ctx.whatsapp.status().error ?? 'nenhum'}`,
  }

  // Ligar: o serviço falso sobe como processo filho e fica aguardando o pareamento.
  await clickSelector(contents, '[data-action="whatsapp-start"]')
  const started = await waitFor(contents, `${WA_STATE} === 'pairing'`, 30_000)
  const navShown = await waitFor(contents, `document.querySelector('[data-nav="whatsapp"]')`)
  const tokenGone = !existsSync(join(root, 'token'))
  const serviceBin = mode(join(root, 'service.bin'))

  // Parear: a tela de risco vem antes de qualquer QR; "Cancelar" volta sem QR.
  await clickSelector(contents, '[data-action="whatsapp-pair"]')
  const riskShown = await waitFor(contents, `document.querySelector('[data-whatsapp-risk]')`)
  const riskTitle = await text(contents, '[data-whatsapp-risk] h3')
  const riskText = await text(contents, '[data-whatsapp-risk-text]')
  const riskCheckbox = await evaluate<string>(contents, `document.querySelector('[data-whatsapp-risk] label')?.textContent ?? ''`)
  const qrBeforeAccept = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-whatsapp-qr]'))`)
  const disabledBefore = await evaluate<boolean>(contents, `document.querySelector('[data-action="whatsapp-show-qr"]')?.disabled === true`)
  const pairWithoutRisk = await evaluate<unknown>(contents, `window.__scribeApi.invoke('scribe:whatsapp-pair', {})`)
  await clickSelector(contents, '[data-action="whatsapp-risk-cancel"]')
  const cancelled = await waitFor(contents, `!document.querySelector('[data-whatsapp-risk]') && !document.querySelector('[data-whatsapp-qr]') && !document.querySelector('[data-whatsapp-pairing]')`)
  await clickSelector(contents, '[data-action="whatsapp-pair"]')
  await waitFor(contents, `document.querySelector('[data-whatsapp-risk]')`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-risco-light'))
  await clickSelector(contents, '[data-whatsapp-risk-check]')
  const enabledAfter = await waitFor(contents, `document.querySelector('[data-action="whatsapp-show-qr"]')?.disabled === false`)
  await clickSelector(contents, '[data-action="whatsapp-show-qr"]')
  const qrShown = await waitFor(contents, `document.querySelector('[data-whatsapp-qr]')`, 8000)
  const qrModules = await evaluate<number>(contents, `Number(document.querySelector('[data-whatsapp-qr]')?.dataset.qrModules ?? 0)`)
  const pairHint = await text(contents, '[data-whatsapp-pair-hint]')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-pareamento-light'))
  checks['risk'] = {
    ok:
      started &&
      navShown &&
      tokenGone &&
      serviceBin === '600' &&
      riskShown &&
      riskTitle === WHATSAPP_RISK_TITLE &&
      riskText === WHATSAPP_RISK_TEXT &&
      riskCheckbox === WHATSAPP_RISK_CHECKBOX &&
      !qrBeforeAccept &&
      disabledBefore &&
      JSON.stringify(pairWithoutRisk) === JSON.stringify({ error: 'risk' }) &&
      cancelled &&
      enabledAfter &&
      qrShown &&
      qrModules === encodeQr(WA_FAKE_QR).length &&
      pairHint === WHATSAPP_PAIR_HINT &&
      acceptances().filter((item) => item.purpose === 'pair').length === 1,
    detail: `ligado=${started}, item na barra=${navShown}, token em texto apagado=${tokenGone}, service.bin ${serviceBin}; risco antes do QR=${riskShown} "${riskTitle}" (texto igual=${riskText === WHATSAPP_RISK_TEXT}, caixa "${riskCheckbox}"), QR antes do aceite=${qrBeforeAccept}, botão desabilitado=${disabledBefore}, /pair sem aceite=${JSON.stringify(pairWithoutRisk)}; "Cancelar" sem QR=${cancelled}; habilitado com a caixa=${enabledAfter}; QR=${qrShown} com ${qrModules} módulos (esperado ${encodeQr(WA_FAKE_QR).length}); "${pairHint}"; aceites de pareamento=${acceptances().filter((item) => item.purpose === 'pair').length}`,
  }

  // O celular falso lê o QR: conectado, o painel fecha e o próximo pareamento pede o aviso de novo.
  await ctx.whatsapp.fake('scan')
  const connected = await waitFor(contents, `${WA_STATE} === 'connected' && !document.querySelector('[data-whatsapp-pairing]')`, 8000)
  const connectedLine = await text(contents, '[data-whatsapp-line]')
  const pairAgain = await evaluate<unknown>(contents, `window.__scribeApi.invoke('scribe:whatsapp-pair', {})`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'configuracoes-whatsapp-light'))
  checks['paired'] = {
    ok: connected && connectedLine === 'Conectado como Andrea Teste (+55 11 90000-0000)' && JSON.stringify(pairAgain) === JSON.stringify({ error: 'risk' }),
    detail: `conectado=${connected} "${connectedLine}"; /pair depois (aceite gasto)=${JSON.stringify(pairAgain)}`,
  }

  // A tela "WhatsApp": conversas (grupo marcado, não lidas), a conversa aberta e a mensagem nova pelo SSE.
  await clickSelector(contents, '[data-nav="whatsapp"]')
  const listed = await waitFor(contents, `${routeIs('whatsapp')} && document.querySelectorAll('[data-whatsapp-chat]').length === 3`, 8000)
  const rows = await evaluate<{ id: string; text: string; group: boolean; unread: string }[]>(
    contents,
    `[...document.querySelectorAll('[data-whatsapp-chat]')].map((row) => ({ id: row.dataset.whatsappChat, text: row.textContent, group: Boolean(row.querySelector('[data-whatsapp-group]')), unread: row.querySelector('[data-whatsapp-unread]')?.textContent ?? '' }))`,
  )
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ATLAS}"]`)
  const atlasOpen = await waitFor(contents, `document.querySelector('[data-whatsapp-conversation="${WA_ATLAS}"] [data-whatsapp-media]')`)
  const media = await text(contents, '[data-whatsapp-media]')
  const noImage = await evaluate<boolean>(contents, `!document.querySelector('[data-whatsapp-messages] img')`)
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ANA}"]`)
  const anaOpen = await waitFor(contents, `document.querySelectorAll('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-message]').length === ${WA_ANA_SEEDED}`)
  const htmlAsText = await evaluate<{ text: string; tags: number }>(
    contents,
    `(() => { const el = document.querySelector('[data-whatsapp-message="m3"] [data-whatsapp-text]'); return { text: el?.textContent ?? '', tags: el?.querySelectorAll('b').length ?? -1 } })()`,
  )
  await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, text: 'Chegou agora pelo SSE' })
  const sse = await waitFor(contents, `[...document.querySelectorAll('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-text]')].some((el) => el.textContent === 'Chegou agora pelo SSE')`, 5000)
  // Contrato 33: sem título nem aviso no topo; as colunas começam no topo da área da tela.
  const top = await evaluate<{ heading: boolean; notices: string[]; columnsTop: number; areaTop: number }>(
    contents,
    `(() => {
      const area = document.querySelector('main [aria-label="Conversas do WhatsApp"]')?.parentElement?.parentElement
      return {
        heading: Boolean(document.querySelector('main h1')),
        notices: [...document.querySelectorAll('main [data-notice]')].map((el) => el.dataset.notice),
        columnsTop: document.querySelector('main [aria-label="Conversas do WhatsApp"]')?.getBoundingClientRect().top ?? -1,
        areaTop: area?.getBoundingClientRect().top ?? -2,
      }
    })()`,
  )
  const topClean = !top.heading && top.notices.length === 0 && top.columnsTop === top.areaTop
  checks['screen'] = {
    ok:
      listed &&
      rows.map((row) => row.id).join(',') === [WA_ATLAS, WA_ANA, '5511922220000@s.whatsapp.net'].join(',') &&
      rows[0]?.group === true &&
      rows[1]?.group === false &&
      rows[0]?.unread === '2' &&
      atlasOpen &&
      media === 'imagem · 120 KB' &&
      noImage &&
      anaOpen &&
      htmlAsText.text === 'Combinado. <b>Não</b> esquece a pauta.' &&
      htmlAsText.tags === 0 &&
      sse &&
      topClean,
    detail: `topo sem título=${!top.heading} avisos ${JSON.stringify(top.notices)} colunas no topo=${top.columnsTop === top.areaTop} (${top.columnsTop}); lista=${listed} ${JSON.stringify(rows.map((row) => ({ id: row.id.slice(0, 8), group: row.group, unread: row.unread })))}; mídia "${media}" sem <img>=${noImage}; conversa=${anaOpen}; HTML como texto "${htmlAsText.text}" (${htmlAsText.tags} <b>); SSE=${sse}`,
  }

  // Contrato 37: a mídia por clique (o áudio e a imagem do Bruno; a imagem do Atlas é de antes das chaves).
  checks['media'] = await whatsappMediaCheck(ctx, win, root, shots)
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ANA}"]`)
  await waitFor(contents, `document.querySelectorAll('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-message]').length >= ${WA_ANA_SEEDED}`)

  // Contrato 33: a janela do smoke tem menos de 1280 px, então os Detalhes começam fechados; o botão do cabeçalho abre.
  const narrow = await evaluate<{ width: number; panel: boolean; toggle: string }>(
    contents,
    `({ width: window.innerWidth, panel: Boolean(document.querySelector('[data-wa-details]')), toggle: document.querySelector('[data-action="toggle-whatsapp-details"]')?.getAttribute('aria-pressed') ?? '' })`,
  )
  const narrowClosed = narrow.width < 1280 && !narrow.panel && narrow.toggle === 'false'
  await clickSelector(contents, '[data-action="toggle-whatsapp-details"]')
  // Contrato 32: o painel Detalhes com a análise do Claude falso (sozinha, ao abrir o painel numa conversa sem
  // cache), o humor, o gráfico de atividade com barras e o rodapé com o custo; a foto da Ana e do Atlas na lista e as
  // iniciais do Bruno (o serviço falso não tem foto dele); e o cache em whatsapp/insights.json.
  const detailsShown = await waitFor(contents, `document.querySelector('[data-wa-details] [data-wa-summary]')?.textContent.includes('Conversa com Ana Souza')`, 20_000)
  const details = await evaluate<{ summary: string; mood: string; moodNote: boolean; bars: number; activeBars: number; balance: number; moodPoints: number; cost: string; toggle: string; anaPhoto: boolean; atlasPhoto: boolean; brunoInitials: string; headerPhoto: boolean; subtitle: string; myBubble: string }>(
    contents,
    `(() => {
      const panel = document.querySelector('[data-wa-details]')
      const row = (id) => document.querySelector('[data-whatsapp-chat="' + id + '"]')
      return {
        summary: panel?.querySelector('[data-wa-summary]')?.textContent ?? '',
        mood: panel?.querySelector('[data-wa-mood-label]')?.textContent ?? '',
        moodNote: (panel?.querySelector('[data-wa-section="mood"]')?.textContent ?? '').includes('${INSIGHTS_MOOD_NOTE}'),
        bars: panel?.querySelectorAll('[data-wa-chart="activity"] [data-wa-bar]').length ?? 0,
        activeBars: new Set([...(panel?.querySelectorAll('[data-wa-chart="activity"] [data-wa-bar]') ?? [])].map((bar) => bar.dataset.waBar)).size,
        balance: panel?.querySelectorAll('[data-wa-chart="balance"] [data-wa-bar]').length ?? 0,
        moodPoints: panel?.querySelectorAll('[data-wa-chart="mood"] [data-wa-mood]').length ?? 0,
        cost: panel?.querySelector('[data-wa-insights-cost]')?.textContent ?? '',
        toggle: document.querySelector('[data-action="toggle-whatsapp-details"]')?.getAttribute('aria-pressed') ?? '',
        anaPhoto: (row('${WA_ANA}')?.querySelector('img[data-wa-avatar="photo"]')?.getAttribute('src') ?? '').startsWith('data:image/png;base64,'),
        atlasPhoto: Boolean(row('${WA_ATLAS}')?.querySelector('img[data-wa-avatar="photo"]')),
        brunoInitials: row('${WA_BRUNO}')?.querySelector('[data-wa-avatar="initials"]')?.textContent ?? '',
        headerPhoto: Boolean(document.querySelector('[data-whatsapp-conversation="${WA_ANA}"] header img[data-wa-avatar="photo"]')),
        subtitle: document.querySelector('[data-whatsapp-chat-subtitle]')?.textContent ?? '',
        myBubble: [...(document.querySelector('[data-whatsapp-message="m2"] [data-wa-bubble]')?.classList ?? [])].filter((name) => name === 'bg-accent' || name === 'text-on-accent').join(' '),
      }
    })()`,
  )
  const insightsFile = join(root, 'insights.json')
  const cached = ((): { at?: number; result?: { resumo?: string } } | undefined => {
    try {
      return (JSON.parse(readFileSync(insightsFile, 'utf8')) as Record<string, { at?: number; result?: { resumo?: string } }>)[WA_ANA]
    } catch {
      return undefined
    }
  })()
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-detalhes-light'))
  // Fechar e abrir pelo botão do cabeçalho; aberto de novo com o cache, sem rodar outra vez.
  await clickSelector(contents, '[data-action="whatsapp-details-close"]')
  const closed = await waitFor(contents, `!document.querySelector('[data-wa-details]') && document.querySelector('[data-action="toggle-whatsapp-details"]')?.getAttribute('aria-pressed') === 'false'`)
  await clickSelector(contents, '[data-action="toggle-whatsapp-details"]')
  const reopened = await waitFor(contents, `document.querySelector('[data-wa-details] [data-wa-summary]') && document.querySelector('[data-action="toggle-whatsapp-details"]')?.getAttribute('aria-pressed') === 'true'`)
  // Contrato 33: com a janela larga (1320 px), a tela abre com os Detalhes já abertos; voltar à largura de antes não
  // fecha o painel (a decisão é só ao abrir a tela).
  const [narrowWidth, narrowHeight] = win.getContentSize() as [number, number]
  win.setContentSize(1320, narrowHeight)
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, routeIs('reunioes'))
  await clickSelector(contents, '[data-nav="whatsapp"]')
  await waitFor(contents, `${routeIs('whatsapp')} && window.innerWidth >= 1280 && document.querySelectorAll('[data-whatsapp-chat]').length === 3`, 8000)
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ANA}"]`)
  const wideOpen = await waitFor(contents, `document.querySelector('[data-wa-details] [data-wa-summary]') && document.querySelector('[data-action="toggle-whatsapp-details"]')?.getAttribute('aria-pressed') === 'true'`)
  win.setContentSize(narrowWidth, narrowHeight)
  const narrowAgain = await waitFor(contents, `window.innerWidth === ${narrowWidth}`)
  await wait(300)
  const keptOpen = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-wa-details]'))`)
  checks['details'] = {
    ok:
      narrowClosed &&
      wideOpen &&
      narrowAgain &&
      keptOpen &&
      detailsShown &&
      // 11 do serviço falso (12 se a do SSE chegou antes de o pedido ler as mensagens).
      Number(/Conversa com Ana Souza: (\d+) mensagens/.exec(details.summary)?.[1] ?? 0) >= WA_ANA_SEEDED &&
      details.mood === 'Satisfeito' &&
      details.moodNote &&
      details.bars >= 5 &&
      details.activeBars === details.bars &&
      details.balance === 2 &&
      details.moodPoints >= 5 &&
      details.cost.includes('US$') &&
      details.toggle === 'true' &&
      details.anaPhoto &&
      details.atlasPhoto &&
      details.brunoInitials === 'BL' &&
      details.headerPhoto &&
      details.subtitle === '+5511911110000' &&
      details.myBubble === 'bg-accent text-on-accent' &&
      cached?.result?.resumo === details.summary &&
      mode(insightsFile) === '600' &&
      closed &&
      reopened,
    detail: `janela ${narrow.width} px: fechado ao abrir=${narrowClosed}; 1320 px: aberto ao abrir=${wideOpen}, de volta a ${narrowWidth} px continua aberto=${narrowAgain && keptOpen}; painel=${detailsShown} "${details.summary.slice(0, 80)}"; humor "${details.mood}" (nota=${details.moodNote}, ${details.moodPoints} pontos no tempo); atividade ${details.bars} barras; quem fala ${details.balance} segmentos; rodapé "${details.cost}"; botão aria-pressed=${details.toggle}; fotos Ana=${details.anaPhoto} Atlas=${details.atlasPhoto} cabeçalho=${details.headerPhoto}; Bruno "${details.brunoInitials}"; subtítulo "${details.subtitle}"; meu balão "${details.myBubble}"; cache ${mode(insightsFile)} igual=${cached?.result?.resumo === details.summary}; fechar=${closed}, abrir de novo=${reopened}`,
  }

  // "Rascunho com o Claude" pelo agente ACP falso: o texto vai para o campo e nada é enviado.
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const acpStatus = await evaluate<{ state?: string }>(contents, "window.__scribeApi.invoke('scribe:acp-status')")
  if (acpStatus.state !== 'installed') await evaluate(contents, "window.__scribeApi.invoke('scribe:acp-install').then(() => true)")
  const acpLogBefore = readAcpLog(ctx.userDataDir).length
  await clickSelector(contents, '[data-action="whatsapp-draft"]')
  await waitFor(contents, `document.querySelector('[data-whatsapp-draft-panel]')`)
  await setValue(contents, '#whatsapp-draft-instruction', WA_INSTRUCTION)
  await clickSelector(contents, '[data-action="whatsapp-draft-run"]')
  const drafted = await waitFor(contents, `(document.querySelector('[data-whatsapp-composer]')?.value ?? '').startsWith('Oi, Ana!')`, 15_000)
  // O print com o campo já preenchido pelo rascunho.
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-rascunho-light'))
  const draftText = await evaluate<string>(contents, `document.querySelector('[data-whatsapp-composer]')?.value ?? ''`)
  const draftLog = readAcpLog(ctx.userDataDir).slice(acpLogBefore)
  const draftSession = draftLog.find((entry) => entry.method === 'session/new' && entry.purpose === 'draft')
  const sentAfterDraft = await waSent(ctx)
  checks['draft'] = {
    ok: drafted && draftText.includes('confirmando a reunião de sexta') && Boolean(draftSession) && draftLog.some((entry) => entry.method === 'session/prompt' && entry.purpose === 'draft') && sentAfterDraft.length === 0,
    detail: `campo preenchido=${drafted} "${draftText}"; sessão ACP de rascunho=${Boolean(draftSession)} (mcp ${JSON.stringify((draftSession as { mcpServers?: unknown } | undefined)?.mcpServers ?? null)}); enviadas depois do rascunho=${sentAfterDraft.length}`,
  }

  // Sem clique, nada sai: token inventado pelo canal, o evento do clique pelo `send` genérico e o `whatsappSend` sem
  // a ativação do usuário (passada a validade da ativação do último clique do smoke).
  const forged = await evaluate<unknown>(contents, `window.__scribeApi.invoke('scribe:whatsapp-send', { chatId: '${WA_ANA}', text: 'forjada', clickToken: crypto.randomUUID() })`)
  const noToken = await evaluate<string>(contents, `window.__scribeApi.invoke('scribe:whatsapp-send', { chatId: '${WA_ANA}', text: 'forjada' }).then((r) => JSON.stringify(r), (e) => 'erro ' + String(e?.message ?? e).slice(0, 60))`)
  const genericClick = await evaluate<string>(contents, `(() => { try { window.__scribeApi.send('scribe:whatsapp-click', crypto.randomUUID()); return 'mandou' } catch (error) { return String(error?.message ?? error) } })()`)
  await wait(5500)
  const withoutGesture = (await contents.executeJavaScript(`window.__scribeApi.whatsappSend({ chatId: '${WA_ANA}', text: 'sem clique' })`, false)) as unknown
  const sentWithoutClick = await waSent(ctx)

  // Com o clique, sai direto ao serviço, sem diálogo de confirmação (removido a pedido do dono no contrato 33): o
  // clique e o token do preload bastam. Enter não envia; ⌘↵ envia. Contrato 36: com a correção desligada, nenhum
  // balão temporário aparece nos dois envios.
  await watchPending(contents, 'Segunda mensagem')
  await clickSelector(contents, '[data-action="whatsapp-send"]')
  let sent = await waSent(ctx)
  for (let attempt = 0; attempt < 50 && sent.length < 1; attempt++) {
    await wait(100)
    sent = await waSent(ctx)
  }
  const cleared = await waitFor(contents, `(document.querySelector('[data-whatsapp-composer]')?.value ?? 'x') === ''`)
  const noSendError = await evaluate<boolean>(contents, `!document.querySelector('[data-whatsapp-send-error]')`)
  await setValue(contents, '[data-whatsapp-composer]', 'Segunda mensagem')
  await pressEnterIn(contents, '[data-whatsapp-composer]')
  await wait(300)
  const afterEnter = (await waSent(ctx)).length
  await evaluate(contents, `document.querySelector('[data-whatsapp-composer]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))`)
  let second = await waSent(ctx)
  for (let attempt = 0; attempt < 50 && second.length < 2; attempt++) {
    await wait(100)
    second = await waSent(ctx)
  }
  const shownSent = await waitFor(contents, `[...document.querySelectorAll('[data-whatsapp-message][data-from-me="true"] [data-whatsapp-text]')].some((el) => el.textContent === 'Segunda mensagem')`)
  const sendPending = await stopPending(contents)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-light'))
  checks['send'] = {
    ok:
      JSON.stringify(forged) === JSON.stringify({ ok: false, error: 'click' }) &&
      noToken === JSON.stringify({ ok: false, error: 'click' }) &&
      genericClick.includes('Canal não permitido') &&
      JSON.stringify(withoutGesture) === JSON.stringify({ ok: false, error: 'click' }) &&
      sentWithoutClick.length === 0 &&
      sent.length === 1 &&
      sent[0]?.text === draftText &&
      sent[0]?.chatId === WA_ANA &&
      cleared &&
      noSendError &&
      afterEnter === 1 &&
      second.length === 2 &&
      second[1]?.text === 'Segunda mensagem' &&
      shownSent &&
      !sendPending.seen,
    detail: `token inventado=${JSON.stringify(forged)}; sem token=${noToken}; clique pelo send genérico="${genericClick.slice(0, 60)}"; whatsappSend sem ativação=${JSON.stringify(withoutGesture)}; enviadas sem clique=${sentWithoutClick.length}; "Enviar" sem diálogo -> enviada=${sent.length} (igual ao rascunho=${sent[0]?.text === draftText}); campo limpo=${cleared}, sem erro=${noSendError}; Enter não enviou=${afterEnter === 1}; ⌘↵ enviou=${second.length === 2}; na conversa=${shownSent}; balão temporário com a correção desligada=${sendPending.seen}`,
  }

  // Contrato 35: com "Corrigir ao enviar" ligado (e o Sonnet nas Configurações), o clique em "Enviar" manda ao serviço o
  // texto corrigido pelo agente falso, sempre com o Haiku, e o balão mostra o corrigido. Desligado (o padrão, acima), o
  // envio sai como foi digitado.
  const correctDefault = readSettings(ctx.userDataDir).whatsappAutoCorrect
  const modelBefore = readSettings(ctx.userDataDir).claudeModel ?? 'haiku'
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappAutoCorrect: true, claudeModel: 'sonnet' }).then(() => true)")
  const correctLogBefore = readAcpLog(ctx.userDataDir).length
  await setValue(contents, '[data-whatsapp-composer]', 'oi tudo bem')
  // Contrato 36: no clique, o campo limpa e o balão temporário entra com o texto digitado e a linha da IA; o eco com o
  // corrigido entra no lugar dele (com o fade), sem os dois na tela ao mesmo tempo.
  await watchPending(contents, 'Oi, tudo bem?')
  await clickSelector(contents, '[data-action="whatsapp-send"]')
  const clearedAtClick = await evaluate<boolean>(contents, `(document.querySelector('[data-whatsapp-composer]')?.value ?? 'x') === ''`)
  let corrected = await waSent(ctx)
  for (let attempt = 0; attempt < 150 && corrected.length < 3; attempt++) {
    await wait(100)
    corrected = await waSent(ctx)
  }
  const shownCorrected = await waitFor(contents, `[...document.querySelectorAll('[data-whatsapp-message][data-from-me="true"] [data-whatsapp-text]')].some((el) => el.textContent === 'Oi, tudo bem?')`)
  const pendingGone = await waitFor(contents, `!document.querySelector('[data-wa-pending]')`)
  const swapFade = await evaluate<boolean>(contents, `[...document.querySelectorAll('[data-whatsapp-message][data-from-me="true"] [data-whatsapp-text]')].some((el) => el.textContent === 'Oi, tudo bem?' && el.classList.contains('wa-swap-in'))`)
  const correctPending = await stopPending(contents)
  const correctLog = readAcpLog(ctx.userDataDir).slice(correctLogBefore)
  const correctSession = correctLog.find((entry) => entry.method === 'session/new' && entry.purpose === 'whatsapp-correct')
  const correctModel = JSON.stringify((correctSession as { configOptions?: unknown } | undefined)?.configOptions ?? null)
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { whatsappAutoCorrect: false, claudeModel: '${modelBefore}' }).then(() => true)`)
  checks['correct'] = {
    ok:
      correctDefault !== true &&
      corrected.length === 3 &&
      corrected[2]?.text === 'Oi, tudo bem?' &&
      corrected[2]?.chatId === WA_ANA &&
      Boolean(correctSession) &&
      correctModel.includes('haiku') &&
      !correctModel.includes('sonnet') &&
      shownCorrected &&
      clearedAtClick &&
      correctPending.seen &&
      correctPending.text === 'oi tudo bem' &&
      correctPending.status.includes('ajustando') &&
      correctPending.shimmer &&
      !correctPending.both &&
      pendingGone &&
      swapFade &&
      readSettings(ctx.userDataDir).whatsappAutoCorrect === false,
    detail: `padrão desligado=${correctDefault !== true}; ligado -> enviadas=${corrected.length} "${corrected[2]?.text ?? ''}"; sessão ACP de correção=${Boolean(correctSession)} (modelo ${correctModel}); campo limpo no clique=${clearedAtClick}; temporário "${correctPending.text}" (linha "${correctPending.status}", brilho=${correctPending.shimmer}); os dois juntos=${correctPending.both}; temporário saiu=${pendingGone}; balão corrigido=${shownCorrected} (fade=${swapFade}); desligado de novo=${readSettings(ctx.userDataDir).whatsappAutoCorrect === false}`,
  }

  // Contrato 39: imagem por arrastar e soltar (e pelo clipe), com a legenda; só o clique em "Enviar" envia.
  checks['attach'] = await whatsappAttachCheck(ctx, win, shots)
  // Contrato 34: responder citando, reagir e o "digitando…" (o dos outros e o seu, só com o interruptor).
  checks['interactions'] = await whatsappInteractionsCheck(ctx, win, shots)

  // "Só estas conversas" do Assistente (contrato 25; o "Perguntar" do 24) com a conversa da Ana: o `.md` dela na
  // pasta da conversa e no índice.
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, routeIs('assistente'))
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  await clickSelector(contents, '[data-action="chat-scope-label"]')
  await waitFor(contents, `document.querySelector('[data-chat-whatsapp-mode="chosen"]')`, 8000)
  await clickSelector(contents, '[data-chat-whatsapp-mode="chosen"]')
  const section = await waitFor(contents, `document.querySelector('[data-chat-whatsapp] [data-scope-whatsapp="${WA_ANA}"]')`, 8000)
  await clickSelector(contents, `[data-scope-whatsapp="${WA_ANA}"]`)
  const label = await waitFor(contents, `(document.querySelector('[data-action="chat-scope-label"]')?.textContent ?? '').includes('+ 1 conversa')`)
  const asked = await askChat(contents, 'O que a Ana pediu?')
  const chatId = await evaluate<string>(contents, `window.__scribeApi.invoke('scribe:chat-list', { meetingId: null }).then((list) => list[0]?.id ?? '')`)
  const scopeDir = join(ctx.userDataDir, CHAT_SCOPE_DIR, chatId)
  const scopeFiles = existsSync(scopeDir) ? readdirSync(scopeDir) : []
  const waFile = scopeFiles.find((name) => name.startsWith(WHATSAPP_EXPORT_PREFIX)) ?? ''
  const waText = waFile ? readFileSync(join(scopeDir, waFile), 'utf8') : ''
  const index = existsSync(join(scopeDir, CHAT_INDEX_FILE)) ? readFileSync(join(scopeDir, CHAT_INDEX_FILE), 'utf8') : ''
  const savedScope = chatFile(ctx.userDataDir, chatId)?.scope as { whatsappChats?: string[] } | undefined
  checks['ask'] = {
    ok:
      section &&
      label &&
      asked.done &&
      waFile.startsWith('WhatsApp - Ana Souza - ') &&
      waText.includes('- Citar como: [WhatsApp · Ana Souza · dd/mm hh:mm]') &&
      waText.includes('Chegou agora pelo SSE') &&
      waText.includes('Segunda mensagem') &&
      index.includes(`- arquivo: ${waFile}`) &&
      mode(join(scopeDir, waFile)) === '600' &&
      JSON.stringify(savedScope?.whatsappChats ?? []) === JSON.stringify([WA_ANA]),
    detail: `seção no Contexto=${section}; rótulo do escopo=${label}; resposta=${asked.done}; pasta ${scopeFiles.length} arquivos, "${waFile}" ${mode(join(scopeDir, waFile))}; citação no .md=${waText.includes('Citar como')}; no índice=${index.includes(waFile)}; escopo gravado=${JSON.stringify(savedScope?.whatsappChats ?? [])}`,
  }
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`)
  win.destroy()

  // Escuro: a tela com a conversa aberta.
  const dark = ctx.openWindow({ theme: 'dark' })
  watch(dark)
  await loadAndWait(dark)
  await waitFor(dark.webContents, `document.querySelector('[data-nav="whatsapp"]')`)
  await clickSelector(dark.webContents, '[data-nav="whatsapp"]')
  await waitFor(dark.webContents, `document.querySelectorAll('[data-whatsapp-chat]').length === 3`, 8000)
  await clickSelector(dark.webContents, `[data-whatsapp-chat="${WA_ANA}"]`)
  const darkOpen = await waitFor(dark.webContents, `document.querySelectorAll('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-message]').length >= 5`)
  // Contrato 32: o painel Detalhes também no escuro (mensagens novas desde a análise: ela roda de novo, sozinha). Na
  // janela de menos de 1280 px ele começa fechado (contrato 33): o botão do cabeçalho abre.
  await clickSelector(dark.webContents, '[data-action="toggle-whatsapp-details"]')
  const darkDetails = await waitFor(dark.webContents, `document.querySelector('[data-wa-details] [data-wa-summary]') && !document.querySelector('[data-wa-insights-running]') && document.querySelector('[data-wa-chart="activity"] [data-wa-bar]')`, 20_000)
  await settle(dark.webContents)
  shots.push(await capture(dark, ctx.outDir, 'whatsapp-dark'))
  checks['dark'] = { ok: darkOpen && darkDetails, detail: `conversa no escuro=${darkOpen}; Detalhes no escuro=${darkDetails}` }
  dark.destroy()
}

/**
 * Contrato 37: nada baixa sem o clique. A imagem antiga (m4, sem as chaves) fica como chip com o aviso; no Bruno, o
 * "Baixar" da imagem traz o `<img>` em blob (e a sobreposição em tamanho natural, que o Esc fecha) e o do áudio traz o
 * player; "Transcrever" manda o WAV à AssemblyAI falsa e o texto aparece no balão, guardado em `transcripts.json`.
 */
async function whatsappMediaCheck(ctx: SmokeContext, win: BrowserWindow, root: string, shots: Screenshot[]): Promise<Check> {
  const contents = win.webContents
  const mediaDir = join(root, 'session', 'media')
  const transcriptsFile = join(root, 'transcripts.json')
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ATLAS}"]`)
  await waitFor(contents, `document.querySelector('[data-whatsapp-conversation="${WA_ATLAS}"] [data-whatsapp-message="m4"] [data-whatsapp-media]')`)
  const old = await evaluate<{ title: string; download: boolean }>(
    contents,
    `(() => { const m = document.querySelector('[data-whatsapp-message="m4"]'); return { title: m?.querySelector('[data-whatsapp-media]')?.getAttribute('title') ?? '', download: Boolean(m?.querySelector('[data-wa-download]')) } })()`,
  )
  await clickSelector(contents, `[data-whatsapp-chat="${WA_BRUNO}"]`)
  const listed = await waitFor(contents, `document.querySelector('[data-whatsapp-message="m7"] [data-wa-download]') && document.querySelector('[data-whatsapp-message="m8"] [data-wa-download]')`, 8000)
  await wait(500)
  // Conversa aberta, nada baixado: nenhum blob na tela, nada em `media/`, nenhum upload, sem "Transcrever".
  const before = await evaluate<{ blobs: number; transcribe: boolean; audio: boolean }>(
    contents,
    `({ blobs: [...document.querySelectorAll('[data-whatsapp-messages] img, [data-whatsapp-messages] audio, [data-whatsapp-messages] video')].length, transcribe: Boolean(document.querySelector('[data-wa-transcribe]')), audio: Boolean(document.querySelector('[data-wa-audio]')) })`,
  )
  const nothingBefore = listed && before.blobs === 0 && !before.transcribe && !before.audio && !existsSync(mediaDir) && ctx.fixtures.audioUploads.length === 0

  await clickSelector(contents, '[data-whatsapp-message="m8"] [data-wa-download]')
  const image = await waitFor(contents, `(() => { const img = document.querySelector('[data-whatsapp-message="m8"] img[data-wa-image]'); return img && img.src.startsWith('blob:') && img.complete && img.naturalWidth === 48 })()`, 8000)
  await clickSelector(contents, '[data-whatsapp-message="m8"] [data-wa-image-open]')
  const overlay = await waitFor(contents, `(() => { const img = document.querySelector('[data-wa-image-overlay] img'); return img && img.src.startsWith('blob:') })()`)
  await evaluate(contents, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  const overlayClosed = await waitFor(contents, `!document.querySelector('[data-wa-image-overlay]')`)

  await clickSelector(contents, '[data-whatsapp-message="m7"] [data-wa-download]')
  const player = await waitFor(contents, `(() => { const p = document.querySelector('[data-whatsapp-message="m7"] [data-wa-audio]'); return p && p.querySelector('audio')?.src.startsWith('blob:') })()`, 8000)
  const timeShown = await waitFor(contents, `document.querySelector('[data-whatsapp-message="m7"] [data-wa-audio-time]')?.textContent === '0:00 / 0:02'`)
  const rates: string[] = []
  for (let index = 0; index < 3; index++) {
    await clickSelector(contents, '[data-whatsapp-message="m7"] [data-wa-audio-rate]')
    rates.push(await evaluate<string>(contents, `(() => { const p = document.querySelector('[data-whatsapp-message="m7"] [data-wa-audio]'); return (p?.querySelector('[data-wa-audio-rate]')?.textContent ?? '') + '@' + (p?.querySelector('audio')?.playbackRate ?? 0) })()`))
  }
  const transcribeTitle = await evaluate<string>(contents, `document.querySelector('[data-whatsapp-message="m7"] [data-wa-transcribe]')?.getAttribute('title') ?? ''`)

  await clickSelector(contents, '[data-whatsapp-message="m7"] [data-wa-transcribe]')
  const transcribed = await waitFor(contents, `document.querySelector('[data-whatsapp-message="m7"] [data-wa-transcript]')?.textContent === ${JSON.stringify(SMOKE_AUDIO_TRANSCRIPT)}`, 15_000)
  const buttonGone = await evaluate<boolean>(contents, `!document.querySelector('[data-whatsapp-message="m7"] [data-wa-transcribe]')`)
  const saved = ((): string => {
    try {
      return Object.values(JSON.parse(readFileSync(transcriptsFile, 'utf8')) as Record<string, { text?: string }>)[0]?.text ?? ''
    } catch {
      return ''
    }
  })()
  const uploads = [...ctx.fixtures.audioUploads]
  const cached = existsSync(mediaDir) ? readdirSync(mediaDir) : []
  const cacheModes = cached.map((name) => mode(join(mediaDir, name)))
  // O print do balão com a imagem, o player e a transcrição.
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-midia-light'))
  return {
    ok:
      old.title === 'Disponível só para mensagens recebidas a partir desta versão' &&
      !old.download &&
      nothingBefore &&
      image &&
      overlay &&
      overlayClosed &&
      player &&
      timeShown &&
      rates.join(',') === '1.5x@1.5,2x@2,1x@1' &&
      transcribeTitle === 'O áudio é enviado à AssemblyAI para transcrever' &&
      transcribed &&
      buttonGone &&
      saved === SMOKE_AUDIO_TRANSCRIPT &&
      mode(transcriptsFile) === '600' &&
      uploads.length === 1 &&
      uploads[0]?.wav === true &&
      cached.length === 2 &&
      cacheModes.every((item) => item === '600') &&
      mode(mediaDir) === '700',
    detail: `m4 antiga: chip com "${old.title}", sem Baixar=${!old.download}; antes do clique nada baixado=${nothingBefore} (${JSON.stringify(before)}); imagem em blob=${image}, sobreposição=${overlay}, Esc fecha=${overlayClosed}; player=${player}, tempo 0:00 / 0:02=${timeShown}, velocidades ${rates.join(' ')}; "Transcrever" com "${transcribeTitle}"; texto no balão=${transcribed}, botão saiu=${buttonGone}; transcripts.json ${mode(transcriptsFile)} igual=${saved === SMOKE_AUDIO_TRANSCRIPT}; uploads ${JSON.stringify(uploads)}; media/ ${mode(mediaDir)} com ${cached.length} arquivos ${cacheModes.join(',')}`,
  }
}

/** O que o serviço falso registrou de um envio de anexo (contrato 39): nunca os bytes. */
interface WaSentMedia {
  id: string
  chatId: string
  type?: string
  mime?: string
  name?: string
  size?: number
  caption?: string
}

/**
 * Contrato 39, na conversa da Ana: arrastar um arquivo mostra "Solte para anexar"; soltar um texto com nome de PNG é
 * recusado pelos bytes; soltar um texto e o PNG do fixture monta a prévia do PNG (o primeiro válido) e nada é enviado;
 * Esc e o X descartam; o clipe (o seletor do main, com o fixture escolhido) monta de novo. O canal do anexo sem o clique
 * é recusado; com a legenda "olha isso", o clique em "Enviar" manda ao serviço falso, a prévia sai e o eco aparece como
 * balão de mídia seu, que baixa no clique.
 */
async function whatsappAttachCheck(ctx: SmokeContext, win: BrowserWindow, shots: Screenshot[]): Promise<Check> {
  const contents = win.webContents
  const conversation = `[data-whatsapp-conversation="${WA_ANA}"]`
  const pngPath = join(app.getAppPath(), 'test', 'fixtures', 'brand', 'logo-smoke.png')
  const png = readFileSync(pngPath)
  const files = (list: { name: string; type: string; bytes: Buffer }[]): string =>
    JSON.stringify(list.map((file) => ({ name: file.name, type: file.type, base64: file.bytes.toString('base64') })))
  /** Monta o `DataTransfer` com os arquivos e dispara o `dragenter` na conversa (o `drop` vem depois, com o mesmo). */
  const dragIn = (list: string): Promise<boolean> =>
    evaluate<boolean>(
      contents,
      `(() => { const dt = new DataTransfer(); for (const f of ${list}) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type })); window.__waDrop = dt; const el = document.querySelector('${conversation} [data-whatsapp-messages]'); if (!el) return false; el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); return true })()`,
    )
  const drop = (): Promise<boolean> =>
    evaluate<boolean>(contents, `(() => { const el = document.querySelector('${conversation} [data-whatsapp-messages]'); if (!el || !window.__waDrop) return false; el.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__waDrop, bubbles: true, cancelable: true })); return true })()`)
  const previewShown = `(() => { const img = document.querySelector('${conversation} [data-wa-attach="image"] img[data-wa-attach-thumb]'); return img && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0 && document.querySelector('[data-wa-attach-name]')?.textContent === 'logo-smoke.png' })()`
  const noPreview = `!document.querySelector('[data-wa-attach]')`
  const sentBefore = (await waSent(ctx)).length

  // Um texto com nome e tipo de PNG: recusado pelos bytes.
  await dragIn(files([{ name: 'falsa.png', type: 'image/png', bytes: Buffer.from('não sou uma imagem, sou texto') }]))
  const overlay = await waitFor(contents, `document.querySelector('${conversation} [data-wa-drop]')?.textContent === 'Solte para anexar'`)
  await drop()
  const lying = await waitFor(contents, `(document.querySelector('[data-wa-attach-error]')?.textContent ?? '').startsWith('Só dá para anexar imagem') && ${noPreview}`)
  const overlayGone = await waitFor(contents, `!document.querySelector('[data-wa-drop]')`)

  // Um texto e o PNG: fica o PNG (o primeiro válido); soltar não envia nada.
  await dragIn(files([{ name: 'notas.txt', type: 'text/plain', bytes: Buffer.from('anotações') }, { name: 'logo-smoke.png', type: 'image/png', bytes: png }]))
  await drop()
  const dropped = await waitFor(contents, previewShown, 8000)
  const errorCleared = await evaluate<boolean>(contents, `!document.querySelector('[data-wa-attach-error]')`)
  await wait(400)
  const sentAfterDrop = (await waSent(ctx)).length

  // Esc descarta; soltar de novo e o X descarta; o clipe monta pelo main.
  await evaluate(contents, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  const escaped = await waitFor(contents, noPreview)
  await dragIn(files([{ name: 'logo-smoke.png', type: 'image/png', bytes: png }]))
  await drop()
  const again = await waitFor(contents, previewShown, 8000)
  await clickSelector(contents, '[data-action="whatsapp-attach-discard"]')
  const discarded = await waitFor(contents, noPreview)
  ctx.fixtures.chosenAttachment = pngPath
  await clickSelector(contents, '[data-wa-attach-pick]')
  const picked = await waitFor(contents, previewShown, 8000)
  ctx.fixtures.chosenAttachment = null
  await setValue(contents, '[data-whatsapp-composer]', 'olha isso')
  const placeholder = await evaluate<string>(contents, `document.querySelector('[data-whatsapp-composer]')?.getAttribute('placeholder') ?? ''`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-anexo-light'))

  // O canal do anexo sem o clique: token inventado e sem token, recusados; nada sai.
  const forged = await evaluate<string>(
    contents,
    `window.__scribeApi.invoke('scribe:whatsapp-send-media', { chatId: '${WA_ANA}', name: 'forjada.png', mime: 'image/png', bytes: Uint8Array.from(atob('${png.toString('base64')}'), (c) => c.charCodeAt(0)), clickToken: crypto.randomUUID() }).then((r) => JSON.stringify(r), (e) => 'erro ' + String(e?.message ?? e).slice(0, 60))`,
  )
  const noToken = await evaluate<string>(
    contents,
    `window.__scribeApi.invoke('scribe:whatsapp-send-media', { chatId: '${WA_ANA}', name: 'forjada.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }).then((r) => JSON.stringify(r), (e) => 'erro ' + String(e?.message ?? e).slice(0, 60))`,
  )
  const sentWithoutClick = (await waSent(ctx)).length

  // O clique em "Enviar": o serviço registra o envio da imagem com a legenda e o eco vira balão de mídia seu.
  await clickSelector(contents, '[data-action="whatsapp-send"]')
  let sent = (await waSent(ctx)) as WaSentMedia[]
  for (let attempt = 0; attempt < 80 && sent.length <= sentBefore; attempt++) {
    await wait(100)
    sent = (await waSent(ctx)) as WaSentMedia[]
  }
  const last = sent.at(-1)
  const bubble = `document.querySelector('${conversation} [data-whatsapp-message="${last?.id ?? 'x'}"][data-from-me="true"]')`
  const echoed = await waitFor(contents, `${bubble}?.querySelector('[data-wa-download]') && ${bubble}?.querySelector('[data-whatsapp-text]')?.textContent === 'olha isso'`, 8000)
  const cleared = await waitFor(contents, `${noPreview} && (document.querySelector('[data-whatsapp-composer]')?.value ?? 'x') === '' && !document.querySelector('[data-whatsapp-send-error]')`)
  await clickSelector(contents, `${conversation} [data-whatsapp-message="${last?.id ?? 'x'}"] [data-wa-download]`)
  const downloaded = await waitFor(contents, `(() => { const img = ${bubble}?.querySelector('img[data-wa-image]'); return img && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0 })()`, 8000)
  return {
    ok:
      overlay &&
      lying &&
      overlayGone &&
      dropped &&
      errorCleared &&
      sentAfterDrop === sentBefore &&
      escaped &&
      again &&
      discarded &&
      picked &&
      placeholder === 'Legenda (opcional)' &&
      forged === JSON.stringify({ ok: false, error: 'click' }) &&
      noToken === JSON.stringify({ ok: false, error: 'click' }) &&
      sentWithoutClick === sentBefore &&
      sent.length === sentBefore + 1 &&
      last?.chatId === WA_ANA &&
      last.type === 'image' &&
      last.mime === 'image/png' &&
      last.name === 'logo-smoke.png' &&
      last.size === png.byteLength &&
      last.caption === 'olha isso' &&
      echoed &&
      cleared &&
      downloaded,
    detail: `sobreposição=${overlay} (saiu=${overlayGone}); PNG mentiroso recusado=${lying}; texto + PNG -> prévia do PNG=${dropped}, enviadas no soltar=${sentAfterDrop - sentBefore}; Esc=${escaped}; X=${again && discarded}; clipe=${picked}; legenda com "${placeholder}"; token inventado=${forged}; sem token=${noToken}; sem clique=${sentWithoutClick - sentBefore}; com o clique ${JSON.stringify(last ?? null)}; eco como mídia sua=${echoed}; prévia e campo limpos=${cleared}; eco baixa=${downloaded}`,
  }
}

/** O que o serviço falso registrou (contrato 34): os textos, com a citação, e as reações. */
interface WaSentItem {
  id?: string
  chatId: string
  text?: string
  replyToId?: string
  type?: string
  messageId?: string
  emoji?: string
}

/**
 * Contrato 34, na conversa da Ana: "Responder" na m1 abre a barra de citação (Esc e o X tiram); o envio com a barra sai
 * citando (o serviço falso confirma o `replyToId`) e o balão enviado mostra a citação, que rola até a m1; a resposta da
 * Ana a ela chega com a citação. Reagir sem o clique é recusado; 👍 pelo seletor dos 6 emojis vira o chip seu (o serviço
 * confirma), o ❤️ da Ana chega pelo SSE e tocar de novo no 👍 tira. "digitando…" aparece no cabeçalho e na lista (no
 * grupo, com o nome) e some sozinho em 10 s. O seu "digitando…": desligado (o padrão), nada sai; ligado, "digitando" e,
 * ao limpar o campo, "parou".
 */
async function whatsappInteractionsCheck(ctx: SmokeContext, win: BrowserWindow, shots: Screenshot[]): Promise<Check> {
  const contents = win.webContents
  const conversation = `[data-whatsapp-conversation="${WA_ANA}"]`
  const m1Text = 'Oi! Conseguimos marcar a reunião de sexta?'
  const replyText = 'Conseguimos sim, sexta às 10h.'
  const thumbs = '\u{1F44D}'
  const heart = '❤️'
  const sentNow = async (): Promise<WaSentItem[]> => (await waSent(ctx)) as WaSentItem[]
  const presences = async (): Promise<{ chatId: string; state: string }[]> => ((await ctx.whatsapp.fake('presences')) as { presences?: { chatId: string; state: string }[] }).presences ?? []
  const until = async (test: (items: WaSentItem[]) => boolean): Promise<WaSentItem[]> => {
    let items = await sentNow()
    for (let attempt = 0; attempt < 80 && !test(items); attempt++) {
      await wait(100)
      items = await sentNow()
    }
    return items
  }
  const bubble = (id: string): string => `document.querySelector(${JSON.stringify(`${conversation} [data-whatsapp-message="${id}"]`)})`
  await waitFor(contents, `${bubble('m1')}`, 8000)
  const before = (await sentNow()).length

  // Responder: a barra com o trecho da m1, o foco no campo; Esc tira, o X também.
  await clickSelector(contents, `${conversation} [data-wa-reply="m1"]`)
  const bar = await waitFor(contents, `document.querySelector('[data-wa-reply-bar="m1"] [data-wa-reply-bar-text]')?.textContent === ${JSON.stringify(m1Text)} && document.activeElement?.matches('[data-whatsapp-composer]')`)
  await evaluate(contents, `document.querySelector('[data-whatsapp-composer]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  const escCancels = await waitFor(contents, `!document.querySelector('[data-wa-reply-bar]')`)
  await clickSelector(contents, `${conversation} [data-wa-reply="m1"]`)
  await waitFor(contents, `document.querySelector('[data-wa-reply-bar="m1"]')`)
  await clickSelector(contents, '[data-wa-reply-cancel]')
  const xCancels = await waitFor(contents, `!document.querySelector('[data-wa-reply-bar]')`)

  // Com a barra, o clique em "Enviar" manda a resposta citando a m1.
  await clickSelector(contents, `${conversation} [data-wa-reply="m1"]`)
  await waitFor(contents, `document.querySelector('[data-wa-reply-bar="m1"]')`)
  await setValue(contents, '[data-whatsapp-composer]', replyText)
  await clickSelector(contents, '[data-action="whatsapp-send"]')
  const afterReply = await until((items) => items.length > before)
  const reply = afterReply.at(-1)
  const replyId = reply?.id ?? 'x'
  const quoted = await waitFor(
    contents,
    `${bubble(replyId)}?.dataset.fromMe === 'true' && ${bubble(replyId)}?.querySelector('[data-wa-quote="m1"] [data-wa-quote-text]')?.textContent === ${JSON.stringify(m1Text)}`,
    8000,
  )
  const barGone = await evaluate<boolean>(contents, `!document.querySelector('[data-wa-reply-bar]') && (document.querySelector('[data-whatsapp-composer]')?.value ?? 'x') === ''`)
  // A citação rola até a m1 (carregada): ela fica à vista na lista.
  // O que importa é a m1 ficar à vista na lista (o balão dela cruza a área visível), não a suavidade da rolagem.
  const m1Visible = `(() => { const list = document.querySelector('${conversation} [data-whatsapp-messages]')?.getBoundingClientRect(); const m = ${bubble('m1')}?.querySelector('[data-wa-bubble]')?.getBoundingClientRect(); return Boolean(list && m && m.bottom > list.top && m.top < list.bottom) })()`
  await evaluate(contents, `(() => { const list = document.querySelector('${conversation} [data-whatsapp-messages]'); if (list) list.scrollTop = list.scrollHeight; return true })()`)
  await settle(contents)
  const hiddenBefore = !(await evaluate<boolean>(contents, m1Visible))
  await clickSelector(contents, `${conversation} [data-whatsapp-message="${replyId}"] [data-wa-quote="m1"]`)
  const scrolled = await waitFor(contents, m1Visible, 8000)
  // A Ana responde à sua resposta: a citação chega com o trecho e "Você".
  const answer = (await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, text: 'Perfeito!', replyToId: replyId })) as { id?: string }
  const incomingQuote = await waitFor(
    contents,
    `(() => { const q = ${bubble(answer.id ?? 'x')}?.querySelector('[data-wa-quote="${replyId}"]'); return q?.querySelector('[data-wa-quote-text]')?.textContent === ${JSON.stringify(replyText)} && (q?.textContent ?? '').includes('Você') })()`,
    8000,
  )

  // Reagir sem o clique: token inventado e sem token, recusados; nada sai.
  const forged = await evaluate<string>(contents, `window.__scribeApi.invoke('scribe:whatsapp-react', { chatId: '${WA_ANA}', messageId: 'm1', emoji: ${JSON.stringify(thumbs)}, clickToken: crypto.randomUUID() }).then((r) => JSON.stringify(r), (e) => 'erro ' + String(e?.message ?? e).slice(0, 60))`)
  const noToken = await evaluate<string>(contents, `window.__scribeApi.invoke('scribe:whatsapp-react', { chatId: '${WA_ANA}', messageId: 'm1', emoji: ${JSON.stringify(thumbs)} }).then((r) => JSON.stringify(r), (e) => 'erro ' + String(e?.message ?? e).slice(0, 60))`)
  const reactedWithoutClick = (await sentNow()).filter((item) => item.type === 'reaction').length

  // 👍 pelo seletor: o chip seu, e o serviço falso confirma.
  await clickSelector(contents, `${conversation} [data-wa-react-open="m1"]`)
  const picker = await waitFor(contents, `document.querySelectorAll('[data-wa-react-picker="m1"] [data-wa-react-emoji]').length === 6`)
  await clickSelector(contents, `[data-wa-react-picker="m1"] [data-wa-react-emoji="${thumbs}"]`)
  const chip = await waitFor(contents, `${bubble('m1')}?.querySelector('[data-wa-reaction="${thumbs}"][data-mine="true"]')?.textContent === '${thumbs}1' && !document.querySelector('[data-wa-react-picker]')`, 8000)
  const afterReact = await until((items) => items.some((item) => item.type === 'reaction'))
  const reacted = afterReact.filter((item) => item.type === 'reaction')
  // O ❤️ da Ana na sua resposta, pelo SSE.
  await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, reaction: { messageId: replyId, emoji: heart } })
  const theirs = await waitFor(contents, `${bubble(replyId)}?.querySelector('[data-wa-reaction="${heart}"][data-mine="false"]')?.textContent === '${heart}1'`, 8000)
  // O print do balão com a citação e a reação.
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'whatsapp-interacoes-light'))
  // Tocar de novo no 👍 tira a sua.
  await clickSelector(contents, `${conversation} [data-whatsapp-message="m1"] [data-wa-reaction="${thumbs}"]`)
  const removed = await waitFor(contents, `!${bubble('m1')}?.querySelector('[data-wa-reaction]')`, 8000)
  const afterRemove = await until((items) => items.filter((item) => item.type === 'reaction').length >= 2)
  const removal = afterRemove.filter((item) => item.type === 'reaction')[1]

  // "digitando…" da Ana: no cabeçalho e na lista; some sozinho em 10 s. No grupo, com o nome de quem digita.
  await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, presence: 'composing' })
  const typingShown = await waitFor(
    contents,
    `document.querySelector('${conversation} header [data-wa-typing]')?.textContent === 'digitando…' && document.querySelector('[data-whatsapp-chat="${WA_ANA}"] [data-wa-typing]')?.textContent === 'digitando…'`,
  )
  const typingAt = Date.now()
  await ctx.whatsapp.fake('incoming', { chatId: WA_ATLAS, presence: 'composing', author: 'Carla Dias' })
  const groupTyping = await waitFor(contents, `document.querySelector('[data-whatsapp-chat="${WA_ATLAS}"] [data-wa-typing]')?.textContent === 'Carla Dias está digitando…'`)
  const typingExpired = await waitFor(contents, `!document.querySelector('${conversation} header [data-wa-typing]') && !document.querySelector('[data-whatsapp-chat="${WA_ANA}"] [data-wa-typing]')`, 14_000)
  const typingLasted = Date.now() - typingAt
  const subtitleBack = await waitFor(contents, `document.querySelector('${conversation} [data-whatsapp-chat-subtitle]')`)

  // O seu "digitando…": desligado (o padrão), digitar não manda nada; ligado, "digitando" e, ao limpar, "parou".
  const typingDefault = readSettings(ctx.userDataDir).whatsappTypingSignal
  const presencesBefore = (await presences()).length
  await setValue(contents, '[data-whatsapp-composer]', 'sem avisar')
  await wait(600)
  const silentWhenOff = (await presences()).length === presencesBefore
  await setValue(contents, '[data-whatsapp-composer]', '')
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappTypingSignal: true }).then(() => true)")
  await wait(400)
  await setValue(contents, '[data-whatsapp-composer]', 'avisando')
  let own = await presences()
  for (let attempt = 0; attempt < 40 && own.length < presencesBefore + 1; attempt++) {
    await wait(100)
    own = await presences()
  }
  await setValue(contents, '[data-whatsapp-composer]', '')
  for (let attempt = 0; attempt < 40 && own.length < presencesBefore + 2; attempt++) {
    await wait(100)
    own = await presences()
  }
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappTypingSignal: false }).then(() => true)")
  const ownStates = own.slice(presencesBefore).map((item) => `${item.chatId === WA_ANA ? 'ana' : item.chatId}:${item.state}`)

  // A resposta da Ana ("Perfeito!") fica respondida pelo clique, como a conversa estava antes deste passo: o Assistente
  // (contrato 25) confere depois que a Ana não está pendente.
  const beforeClosing = (await sentNow()).length
  await waitFor(contents, `document.querySelector('[data-whatsapp-composer]')?.value === ''`)
  await setValue(contents, '[data-whatsapp-composer]', 'Até sexta!')
  await clickSelector(contents, '[data-action="whatsapp-send"]')
  const closing = (await until((items) => items.length > beforeClosing)).at(-1)
  const closed = closing?.text === 'Até sexta!' && (await waitFor(contents, `[...document.querySelectorAll('${conversation} [data-whatsapp-message][data-from-me="true"] [data-whatsapp-text]')].some((el) => el.textContent === 'Até sexta!')`, 8000))

  return {
    ok:
      bar &&
      escCancels &&
      xCancels &&
      afterReply.length === before + 1 &&
      reply?.chatId === WA_ANA &&
      reply.text === replyText &&
      reply.replyToId === 'm1' &&
      quoted &&
      barGone &&
      scrolled &&
      incomingQuote &&
      forged === JSON.stringify({ ok: false, error: 'click' }) &&
      noToken === JSON.stringify({ ok: false, error: 'click' }) &&
      reactedWithoutClick === 0 &&
      picker &&
      chip &&
      reacted.length >= 1 &&
      reacted[0]?.messageId === 'm1' &&
      reacted[0]?.emoji === thumbs &&
      theirs &&
      removed &&
      removal?.messageId === 'm1' &&
      removal.emoji === '' &&
      typingShown &&
      groupTyping &&
      typingExpired &&
      typingLasted >= 8000 &&
      subtitleBack &&
      typingDefault !== true &&
      silentWhenOff &&
      ownStates.join(',') === 'ana:composing,ana:paused' &&
      readSettings(ctx.userDataDir).whatsappTypingSignal === false &&
      closed,
    detail: `barra de citação=${bar} (Esc=${escCancels}, X=${xCancels}); resposta ${JSON.stringify(reply ?? null)}; citação no balão=${quoted}, barra e campo limpos=${barGone}, rola até a m1=${scrolled} (fora de vista antes=${hiddenBefore}); resposta da Ana com a citação=${incomingQuote}; reação com token inventado=${forged}, sem token=${noToken}, sem clique=${reactedWithoutClick}; seletor com 6=${picker}; chip 👍 seu=${chip} (serviço ${JSON.stringify(reacted)}); ❤️ da Ana pelo SSE=${theirs}; tocar de novo tira=${removed} (${JSON.stringify(removal ?? null)}); "digitando…" no cabeçalho e na lista=${typingShown}, no grupo com o nome=${groupTyping}, sumiu sozinho=${typingExpired} em ${typingLasted} ms; o seu "digitando…": padrão desligado=${typingDefault !== true}, desligado não manda=${silentWhenOff}, ligado ${ownStates.join(' ')}; resposta final à Ana pelo clique=${closed}`,
  }
}

/**
 * Contrato 24 (CA6), depois do bloqueio (a senha já existe): bloqueado, todo canal do WhatsApp é recusado e a tela
 * some atrás da camada; o serviço continua conectado e guarda a mensagem que chega, que não vai à janela até
 * desbloquear.
 */
async function whatsappLockCheck(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  await waitFor(contents, `document.querySelector('[data-nav="whatsapp"]')`)
  await clickSelector(contents, '[data-nav="whatsapp"]')
  await waitFor(contents, `document.querySelectorAll('[data-whatsapp-chat]').length === 3`, 8000)
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ANA}"]`)
  await waitFor(contents, `document.querySelector('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-message]')`)
  await evaluate(contents, "window.__scribeApi.invoke('scribe:lock-now').then(() => true)")
  const locked = await waitFor(contents, LOCK_LAYER)
  const channels = INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:whatsapp-'))
  const refused = await evaluate<{ locked: number; others: string[] }>(
    contents,
    `(async () => {
      let locked = 0
      const others = []
      for (const channel of ${JSON.stringify(channels)}) {
        try {
          await window.__scribeApi.invoke(channel, { chatId: '${WA_ANA}', text: 'bloqueado', clickToken: crypto.randomUUID(), meetingId: 'x', term: 'ana', purpose: 'pair' })
          others.push(channel + ': respondeu')
        } catch (error) {
          if (String(error?.message ?? error).endsWith('Error: ${LOCKED_ERROR}')) locked++
          else others.push(channel + ': ' + String(error?.message ?? error).slice(0, 60))
        }
      }
      const send = await window.__scribeApi.whatsappSend({ chatId: '${WA_ANA}', text: 'bloqueado' }).then((r) => JSON.stringify(r), (e) => String(e?.message ?? e))
      return { locked, others: send.endsWith('Error: ${LOCKED_ERROR}') ? others : [...others, 'whatsappSend: ' + send.slice(0, 60)] }
    })()`,
  )
  const inert = await evaluate<boolean>(contents, `document.querySelector('[data-app-content]')?.inert === true`)
  const stillConnected = ctx.whatsapp.status().state === 'connected'
  const noticesBefore = ctx.fixtures.whatsappNotify.notifications.length
  await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, text: 'Chegou com o app bloqueado' })
  await wait(600)
  // Contrato 40 (CA2): bloqueado, a notificação sai sem o texto e sem a foto, só de quem é.
  const lockedNotice = await waitNotice(ctx, noticesBefore, (item) => item.chatId === WA_ANA)
  const notDelivered = await evaluate<boolean>(contents, `![...document.querySelectorAll('[data-whatsapp-text]')].some((el) => el.textContent === 'Chegou com o app bloqueado')`)
  const sent = await waSent(ctx)
  await typeLockPassword(contents, LOCK_PASSWORD)
  const unlocked = await waitFor(contents, `!${LOCK_LAYER}`)
  const kept = await evaluate<boolean>(contents, `window.__scribeApi.invoke('scribe:whatsapp-messages', { chatId: '${WA_ANA}' }).then((list) => list.some((m) => m.text === 'Chegou com o app bloqueado'))`)
  checks['locked'] = {
    ok:
      locked &&
      refused.locked === channels.length &&
      refused.others.length === 0 &&
      inert &&
      stillConnected &&
      notDelivered &&
      sent.every((item) => item.text !== 'bloqueado') &&
      unlocked &&
      kept &&
      lockedNotice?.body === 'Mensagem de Ana Souza' &&
      !`${lockedNotice.title} ${lockedNotice.body}`.includes('Chegou') &&
      !lockedNotice.icon,
    detail: `bloqueado=${locked}; ${refused.locked}/${channels.length} canais recusados ${JSON.stringify(refused.others)}; tela inerte=${inert}; serviço conectado=${stillConnected}; mensagem não chegou à janela=${notDelivered}, guardada pelo serviço=${kept}; desbloqueado=${unlocked}; notificação bloqueada ${lockedNotice ? `"${lockedNotice.title}" / "${lockedNotice.body}" foto=${lockedNotice.icon}` : 'nenhuma'}`,
  }
  win.destroy()
}

type WhatsAppNoticeRecord = SmokeFixtures['whatsappNotify']['notifications'][number]

/** A primeira notificação do WhatsApp registrada depois de `from` que passa no filtro (até `ms`). */
async function waitNotice(ctx: SmokeContext, from: number, match: (item: WhatsAppNoticeRecord) => boolean, ms = 5000): Promise<WhatsAppNoticeRecord | null> {
  const until = Date.now() + ms
  for (;;) {
    const found = ctx.fixtures.whatsappNotify.notifications.slice(from).find(match)
    if (found || Date.now() > until) return found ?? null
    await wait(50)
  }
}

/**
 * Contrato 40: as notificações do WhatsApp com a `Notification` substituta. A conversa aberta na janela "em foco"
 * (fingido) não notifica; outra conversa notifica com nome e texto; grupo com "Autor · Grupo" e o rótulo da mídia (e
 * nada com "Só pessoas"); três do mesmo chat em 5 s viram uma; o clique abre a conversa; o número do Dock acompanha.
 */
async function whatsappNotifyCheck(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const notify = ctx.fixtures.whatsappNotify
  await waitFor(contents, `document.querySelector('[data-nav="whatsapp"]')`)
  await clickSelector(contents, '[data-nav="whatsapp"]')
  await waitFor(contents, `document.querySelectorAll('[data-whatsapp-chat]').length === 3`, 8000)
  await clickSelector(contents, `[data-whatsapp-chat="${WA_ANA}"]`)
  await waitFor(contents, `document.querySelector('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-message]')`)
  await wait(200)
  notify.focusedContentsId = contents.id

  // Em foco com a Ana aberta: a mensagem dela aparece na tela e não vira notificação.
  const start = notify.notifications.length
  await ctx.whatsapp.fake('incoming', { chatId: WA_ANA, text: 'Com a conversa aberta' })
  const shownInScreen = await waitFor(contents, `[...document.querySelectorAll('[data-whatsapp-conversation="${WA_ANA}"] [data-whatsapp-text]')].some((el) => el.textContent === 'Com a conversa aberta')`, 5000)
  await wait(800)
  const viewingSilent = notify.notifications.length === start

  // Outra conversa: título e corpo certos (o Bruno não tem foto no serviço falso).
  await ctx.whatsapp.fake('incoming', { chatId: WA_BRUNO, author: 'Bruno Lima', text: 'Chegou para o Bruno' })
  const bruno = await waitNotice(ctx, start, (item) => item.chatId === WA_BRUNO)
  // Rajada: mais duas do Bruno em seguida viram "3 mensagens de Bruno Lima", e as anteriores saem.
  await ctx.whatsapp.fake('incoming', { chatId: WA_BRUNO, author: 'Bruno Lima', text: 'Segunda do Bruno' })
  await ctx.whatsapp.fake('incoming', { chatId: WA_BRUNO, author: 'Bruno Lima', text: 'Terceira do Bruno' })
  const burst = await waitNotice(ctx, start, (item) => item.chatId === WA_BRUNO && item.count === 3)
  const brunoOpen = notify.notifications.slice(start).filter((item) => item.chatId === WA_BRUNO && !item.closed)

  // Grupo: "Autor · Grupo" e o rótulo da imagem com a foto do grupo; com "Só pessoas", nada.
  await ctx.whatsapp.fake('incoming', { chatId: WA_ATLAS, author: 'Carla Dias', type: 'image' })
  const group = await waitNotice(ctx, start, (item) => item.chatId === WA_ATLAS)
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappNotifyGroups: false }).then(() => true)")
  const groupFrom = notify.notifications.length
  await ctx.whatsapp.fake('incoming', { chatId: WA_ATLAS, author: 'Carla Dias', text: 'Só pessoas ligado' })
  const groupSilent = (await waitNotice(ctx, groupFrom, (item) => item.chatId === WA_ATLAS, 1200)) === null
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappNotifyGroups: true }).then(() => true)")

  // Notificações desligadas: nada sai.
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappNotifications: false }).then(() => true)")
  const offFrom = notify.notifications.length
  await ctx.whatsapp.fake('incoming', { chatId: WA_BRUNO, author: 'Bruno Lima', text: 'Com as notificações desligadas' })
  const offSilent = (await waitNotice(ctx, offFrom, () => true, 1200)) === null
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { whatsappNotifications: true }).then(() => true)")

  // Número do Dock: as não lidas do Bruno e do Atlas; o clique abre a conversa do Bruno e o número desce.
  await wait(800)
  const badgeBefore = notify.badges.at(-1) ?? 0
  burst?.open()
  const routed = await waitFor(contents, `${routeIs('whatsapp')} && document.querySelector('[data-whatsapp-conversation="${WA_BRUNO}"]')`, 5000)
  await wait(1200)
  const badgeAfter = notify.badges.at(-1) ?? 0
  notify.focusedContentsId = null
  // O título do grupo não vai ao relatório: "Carla Dias" também é participante da agenda falsa (contrato 12, CA11).
  checks['notify'] = {
    ok:
      shownInScreen &&
      viewingSilent &&
      bruno?.title === 'Bruno Lima' &&
      bruno.body === 'Chegou para o Bruno' &&
      !bruno.icon &&
      burst?.body === '3 mensagens de Bruno Lima' &&
      brunoOpen.length === 1 &&
      group?.title === 'Carla Dias · Projeto Atlas' &&
      group.body === '🖼 Imagem' &&
      group.icon &&
      groupSilent &&
      offSilent &&
      routed &&
      badgeBefore > 0 &&
      badgeAfter < badgeBefore,
    detail: `conversa aberta em foco sem notificação=${viewingSilent} (na tela=${shownInScreen}); Bruno "${bruno?.title ?? ''}" / "${bruno?.body ?? ''}" foto=${bruno?.icon}; rajada "${burst?.body ?? ''}" (${brunoOpen.length} aberta); grupo com "Autor · Grupo"=${group?.title === 'Carla Dias · Projeto Atlas'} / "${group?.body ?? ''}" foto=${group?.icon}; só pessoas sem grupo=${groupSilent}; desligado sem nada=${offSilent}; clique abriu a conversa=${routed}; Dock ${badgeBefore} -> ${badgeAfter} ${JSON.stringify(notify.badges)}`,
  }
  win.destroy()
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 25: o Assistente, com o agente ACP falso e o serviço do WhatsApp falso (as três conversas semeadas).

interface SmokeActionFile {
  id: string
  kind: string
  status: string
  result: string | null
  chatId?: string
  chatName?: string
  phone?: string | null
  whatsappChatId?: string | null
}

/**
 * Contrato 25 (CA1 a CA6), numa janela clara: "Assistente" na barra lateral, com o título, a descrição e o campo
 * novos; "tenho algo pendente no WhatsApp?" responde citando as conversas pendentes; o painel "Contexto" com as
 * fontes; "me lembre amanhã de responder a Ana" vira cartão (data absoluta, "amanhã", 09:00 sem hora no pedido), e
 * "Criar lembrete" cria a tarefa "uma vez" sem agente, que aparece em Automações › Tarefas agendadas; clicar de
 * novo não repete; "responda ao Bruno dizendo sim" vira cartão com o nome e o número lidos do app, e "Enviar" (com o
 * clique, sem diálogo desde o contrato 33) chega ao serviço falso; um bloco inválido vira texto. O bloqueio dos
 * canais novos (`chat-action-*`) fica com `lockChecks`, que chama todo canal recusado.
 */
async function assistantChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const shot = async (name: string): Promise<void> => {
    await settle(contents)
    shots.push(await capture(win, ctx.outDir, name))
  }
  const lastActions = (): SmokeActionFile[] => {
    return chatFile(ctx.userDataDir, chatIdNow)?.messages.at(-1)?.actions ?? []
  }
  let chatIdNow = ''

  // CA1: o nome em toda a tela.
  const navLabel = await evaluate<string>(contents, `document.querySelector('[data-nav="assistente"]')?.textContent ?? ''`)
  const noOldName = await evaluate<boolean>(contents, `![...document.querySelectorAll('[data-nav]')].some((el) => el.textContent.includes('Perguntar'))`)
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, routeIs('assistente'))
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  const header = await evaluate<string>(contents, `document.querySelector('main h1')?.parentElement?.textContent ?? ''`)
  const placeholder = await evaluate<string>(contents, `document.querySelector('[data-chat-input]')?.placeholder ?? ''`)
  checks['name'] = {
    ok: navLabel === 'Assistente' && noOldName && header.includes('Assistente') && header.includes('Pergunte ou peça qualquer coisa: reuniões, WhatsApp, email, automações e o próprio app.') && placeholder === 'Pergunte ou peça algo…',
    detail: `barra lateral "${navLabel}", sem "Perguntar"=${noOldName}; cabeçalho "${header.slice(0, 120)}"; campo "${placeholder}"`,
  }

  // CA2: o que está pendente no WhatsApp, com a citação de cada conversa.
  const pending = await askChat(contents, 'Tenho algo pendente no WhatsApp?')
  chatIdNow = await evaluate<string>(contents, `document.querySelector('[data-chat-conversation]')?.getAttribute('data-chat-conversation') ?? ''`)
  const scopeDir = join(ctx.userDataDir, CHAT_SCOPE_DIR, chatIdNow)
  const files = existsSync(scopeDir) ? readdirSync(scopeDir) : []
  const overview = existsSync(join(scopeDir, 'CONVERSAS-WHATSAPP.md')) ? readFileSync(join(scopeDir, 'CONVERSAS-WHATSAPP.md'), 'utf8') : ''
  const stateText = existsSync(join(scopeDir, STATE_FILE)) ? readFileSync(join(scopeDir, STATE_FILE), 'utf8') : ''
  const guideText = existsSync(join(scopeDir, GUIDE_FILE)) ? readFileSync(join(scopeDir, GUIDE_FILE), 'utf8') : ''
  // As conversas com a última mensagem do outro lado (a da Ana já foi respondida no contrato 24) e só elas.
  const pendingNames = overview.split('\n').flatMap((line) => (line.includes(' · pendente de resposta: sim · ') ? [/^- (.+?) · /.exec(line)?.[1] ?? '?'] : []))
  const answeredNames = overview.split('\n').flatMap((line) => (line.includes(' · pendente de resposta: não · ') ? [/^- (.+?) · /.exec(line)?.[1] ?? '?'] : []))
  checks['pending'] = {
    ok:
      pending.done &&
      pendingNames.length > 0 &&
      pendingNames.every((name) => pending.answer.includes(`[WhatsApp · ${name} · `)) &&
      answeredNames.includes('Ana Souza') &&
      !pending.answer.includes('[WhatsApp · Ana Souza · ') &&
      files.includes(AUTOMATIONS_FILE) &&
      files.some((name) => name.startsWith(WHATSAPP_EXPORT_PREFIX)) &&
      stateText.includes(`Versão instalada: ${app.getVersion()}`) &&
      guideText.includes(`Versão instalada: ${app.getVersion()}`) &&
      !guideText.includes('{{versao}}') &&
      mode(join(scopeDir, STATE_FILE)) === '600',
    detail: `resposta=${pending.done} "${pending.answer.slice(0, 240)}"; pendentes ${JSON.stringify(pendingNames)}, respondidas ${JSON.stringify(answeredNames)}; pasta ${JSON.stringify(files.filter((name) => isSourceFile(name)).sort())}; estado com a versão=${stateText.includes('Versão instalada')}`,
  }

  // CA2: o painel "Contexto" com as fontes, todas ligadas.
  await clickSelector(contents, '[data-action="toggle-context"]')
  const sources = await waitFor(
    contents,
    `['whatsapp', 'automations', 'guide'].every((kind) => document.querySelector('[data-chat-source="' + kind + '"] [role="switch"]')?.getAttribute('aria-checked') === 'true') && document.querySelector('[data-chat-whatsapp-mode="recent"]')?.getAttribute('aria-checked') === 'true'`,
  )
  await shot('assistente-contexto-light')
  await clickSelector(contents, '[data-action="close-context"]')
  checks['sources'] = { ok: sources, detail: `WhatsApp, Automações e Guia ligados, conversas recentes=${sources}` }

  // CA3 e CA4: o lembrete, do cartão até a tarefa.
  const tasksBefore = (await ctx.automations.listTasks()).length
  const reminder = await askChat(contents, 'Me lembre amanhã de responder a Ana')
  const card = `[...document.querySelectorAll('[data-chat-action="lembrete"]')].at(-1)`
  const proposed = await waitFor(contents, `${card}?.dataset.chatActionStatus === 'proposed'`)
  const title = await evaluate<string>(contents, `${card}?.querySelector('[data-chat-action-title]')?.textContent ?? ''`)
  const defaultTime = await evaluate<boolean>(contents, `Boolean(${card}?.querySelector('[data-chat-action-default-time]'))`)
  const rawHidden = !(await evaluate<string>(contents, LAST_ANSWER)).includes('lap-acao')
  const createdBeforeClick = (await ctx.automations.listTasks()).length
  await shot('assistente-lembrete-light')
  await evaluate(contents, `${card}?.querySelector('[data-action="chat-action-reminder-create"]')?.click()`)
  const created = await waitFor(contents, `${card}?.dataset.chatActionStatus === 'done' && (${card}?.querySelector('[data-chat-action-result]')?.textContent ?? '').startsWith('Lembrete criado · ')`)
  const tasks = await ctx.automations.listTasks()
  const task = tasks.find((item) => item.reminder?.whatsappChatId === WA_ANA)
  const savedReminder = lastActions()[0]
  // Recarregar a conversa não repete: o mesmo cartão pelo canal devolve `done` e nada é criado.
  const again = await evaluate<{ ok: boolean; error?: string }>(contents, `window.__scribeApi.invoke('scribe:chat-action-reminder', { chatId: '${chatIdNow}', index: ${(chatFile(ctx.userDataDir, chatIdNow)?.messages.length ?? 1) - 1}, actionId: '${savedReminder?.id ?? 'x'}' })`)
  const tasksAfter = (await ctx.automations.listTasks()).length
  await evaluate(contents, `${card}?.querySelector('[data-action="chat-action-open-tasks"]')?.click()`)
  const listed = await waitFor(contents, `${routeIs('automacoes')} && document.querySelector('[data-automations-tab="tarefas"] [data-task-reminder][data-task-name="${task?.name ?? '?'}"]')`, 8000)
  const when = await evaluate<string>(contents, `document.querySelector('[data-task-reminder] [data-task-when]')?.textContent ?? ''`)
  checks['reminder'] = {
    ok:
      reminder.done &&
      proposed &&
      rawHidden &&
      createdBeforeClick === tasksBefore &&
      title.startsWith('Lembrete · ') &&
      title.includes(' 09:00 (amanhã) · Responder Ana Souza') &&
      defaultTime &&
      created &&
      task !== undefined &&
      task.agentId === '' &&
      task.schedule.kind === 'once' &&
      tasksAfter === tasksBefore + 1 &&
      savedReminder?.status === 'done' &&
      again.ok === false &&
      again.error === 'done' &&
      listed &&
      when.startsWith('Uma vez em '),
    detail: `cartão=${proposed} "${title}", 09:00 avisado=${defaultTime}, bloco escondido=${rawHidden}; nada antes do clique=${createdBeforeClick === tasksBefore}; criado=${created}, tarefa ${task ? `${task.name} (${task.schedule.kind}, agente "${task.agentId}")` : 'ausente'}; de novo -> ${JSON.stringify(again)}, tarefas ${tasksBefore} -> ${tasksAfter}; em Automações=${listed} "${when}"`,
  }
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, `${routeIs('assistente')} && document.querySelector('[data-chat-conversation="${chatIdNow}"]')`, 8000)

  // CA3 e CA5: a resposta no WhatsApp, com o nome e o número do app; "Enviar" pelo caminho do contrato 24.
  const reply = await askChat(contents, 'Responda ao Bruno dizendo sim')
  const replyCard = `[...document.querySelectorAll('[data-chat-action="whatsapp-resposta"]')].at(-1)`
  const replyShown = await waitFor(contents, `${replyCard}?.dataset.chatActionStatus === 'proposed'`)
  const name = await evaluate<string>(contents, `${replyCard}?.querySelector('[data-chat-action-name]')?.textContent ?? ''`)
  const phone = await evaluate<string>(contents, `${replyCard}?.querySelector('[data-chat-action-phone]')?.textContent ?? ''`)
  const sentBefore = (await waSent(ctx)).length
  await shot('assistente-whatsapp-light')
  await evaluate(contents, `${replyCard}?.querySelector('[data-action="chat-action-send"]')?.click()`)
  let sent = await waSent(ctx)
  for (let attempt = 0; attempt < 50 && sent.length <= sentBefore; attempt++) {
    await wait(100)
    sent = await waSent(ctx)
  }
  const sentDone = await waitFor(contents, `${replyCard}?.dataset.chatActionStatus === 'done' && (${replyCard}?.querySelector('[data-chat-action-result]')?.textContent ?? '').startsWith('Enviada às ')`)
  const last = sent.at(-1)
  checks['whatsapp'] = {
    ok:
      reply.done &&
      replyShown &&
      name === 'Bruno Lima' &&
      phone === '+55 11 92222-0000' &&
      last?.chatId === '5511922220000@s.whatsapp.net' &&
      last.text === 'Sim' &&
      sent.length === sentBefore + 1 &&
      sentDone &&
      lastActions()[0]?.status === 'done',
    detail: `cartão=${replyShown} "${name}" "${phone}"; enviada sem diálogo ${sentBefore} -> ${sent.length} (${JSON.stringify(last ?? null)}); cartão "Enviada"=${sentDone}`,
  }

  // CA3: o bloco inválido vira texto comum, sem cartão.
  const invalid = await askChat(contents, 'Mande um bloco inválido')
  const invalidCards = await evaluate<number>(contents, `${LAST_ASSISTANT}?.querySelectorAll('[data-chat-action]').length ?? -1`)
  const invalidText = await evaluate<string>(contents, LAST_ANSWER)
  checks['invalid'] = {
    ok: invalid.done && invalidCards === 0 && invalidText.includes('"tipo": "lembrete"') && lastActions().length === 0,
    detail: `resposta=${invalid.done}; cartões=${invalidCards}; texto "${invalidText.slice(0, 120)}"`,
  }

  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`)
  win.destroy()
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 26: agentes, tarefas e Assistente pesquisando na internet, com o agente ACP falso (os resultados da busca
// são inventados, em domínios `.example`; nenhuma rede de verdade).

/**
 * Contrato 26 (CA1 a CA6, CA8), numa janela clara: o agente novo com "Pode pesquisar na internet" (o cartão mostra
 * "Internet"; "Minhas tarefas" continua desligado); "Pedir agora" com ele mostra "Pesquisando: …", "Abrindo …", o
 * endereço montado com o título da reunião negado ("Endereço bloqueado: não veio da busca"), a resposta com o link e
 * "Usou a internet"; "Minhas tarefas" (sem internet) tem a busca negada e a resposta sugere ligar o interruptor; o
 * Assistente com a fonte "Internet" ligada por padrão responde com o link, que abre fora do app, e o cartão de ação
 * dessa resposta avisa para conferir antes.
 */
async function internetChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const invoke = <T>(script: string): Promise<T> => evaluate<T>(contents, script)
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await invoke("window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const NAME = 'Pesquisa na internet'
  const QUESTION = 'Pesquise o que está em alta sobre finanças no Instagram'

  // CA1: o formulário com o interruptor (desligado no agente novo) e o cartão com "Internet".
  await clickSelector(contents, '[data-nav="automacoes"]')
  await waitFor(contents, `document.querySelectorAll('[data-agent-card]').length >= 3`, 8000)
  await clickSelector(contents, '[data-action="agent-new"]')
  await waitFor(contents, `document.querySelector('[data-agent-form] #agent-name')`)
  const field = await invoke<string>(`document.querySelector('[data-form-field="Pode pesquisar na internet"]')?.textContent ?? ''`)
  const offByDefault = await invoke<string | null>(`document.querySelector('[data-agent-web] [role="switch"]')?.getAttribute('aria-checked') ?? null`)
  await setValue(contents, '#agent-name', NAME)
  await setValue(contents, '#agent-instructions', 'Pesquise na internet e traga ideias de conteúdo para o Instagram, com as fontes.')
  await clickSelector(contents, '[data-agent-web] [role="switch"]')
  const switched = await waitFor(contents, `document.querySelector('[data-agent-web] [role="switch"]')?.getAttribute('aria-checked') === 'true'`)
  await clickSelector(contents, '[data-action="agent-save"]')
  const card = `document.querySelector('[data-agent-name="${NAME}"]')`
  const badge = await waitFor(contents, `${card}?.querySelector('[data-agent-web-badge]')?.textContent === 'Internet'`, 8000)
  const otherBadges = await invoke<string[]>(`[...document.querySelectorAll('[data-agent-card]')].filter((el) => el.querySelector('[data-agent-web-badge]')).map((el) => el.dataset.agentName)`)
  const agentsFile = JSON.parse(readFileSync(join(ctx.userDataDir, AGENTS_FILE), 'utf8')) as { agents: { id: string; name: string; web?: boolean }[] }
  const webAgent = agentsFile.agents.find((agent) => agent.name === NAME)
  const tasksAgent = agentsFile.agents.find((agent) => agent.name === 'Minhas tarefas')
  const description = await invoke<string>(`document.querySelector('main h1')?.parentElement?.textContent ?? ''`)
  checks['agent'] = {
    ok:
      field.includes('Busca na web e abre as páginas que encontrar. Não abre endereços inventados.') &&
      offByDefault === 'false' &&
      switched &&
      badge &&
      JSON.stringify(otherBadges) === JSON.stringify([NAME]) &&
      webAgent?.web === true &&
      tasksAgent?.web === false &&
      description.includes('Agentes que leem as suas reuniões e, se você deixar, a internet, e respondem na hora ou no horário que você escolher.'),
    detail: `campo "${field.slice(0, 120)}"; desligado no novo=${offByDefault}; ligado=${switched}; cartão "Internet"=${badge} ${JSON.stringify(otherBadges)}; agents.json web=${String(webAgent?.web)}, "Minhas tarefas" web=${String(tasksAgent?.web)}; descrição "${description.slice(0, 160)}"`,
  }

  // CA3, CA4 e CA8: "Pedir agora" com o agente com internet.
  const runsBefore = readRunFiles(ctx.userDataDir).filter((run) => run.trigger === 'ask').length
  // A execução nova é a que não existia antes (o id é aleatório e o relógio do agendador foi adiantado mais acima).
  const askIds = (): Set<string> => new Set(readRunFiles(ctx.userDataDir).map((run) => run.id))
  const newAsk = (before: Set<string>): SmokeRunFile | undefined => readRunFiles(ctx.userDataDir).find((run) => run.trigger === 'ask' && !before.has(run.id))
  const webBefore = askIds()
  await setValue(contents, '#ask-now-agent', webAgent?.id ?? '', 'change')
  await setValue(contents, '#ask-now-text', QUESTION)
  await clickSelector(contents, '[data-action="ask-now"]')
  const box = `document.querySelector('[data-ask-now] [data-run-state="ok"]')`
  const asked = await waitFor(contents, `${box}?.querySelector('[data-chat-footer] [data-chat-web]')`, 30_000)
  await invoke(`${box}?.querySelector('[data-action="toggle-reasoning"]')?.click()`)
  await waitFor(contents, `${box}?.querySelector('[data-chat-steps]')`)
  const steps = await invoke<{ tool: string; label: string; status: string }[]>(
    `[...(${box}?.querySelectorAll('[data-chat-step]') ?? [])].map((el) => ({ tool: el.dataset.chatStep, label: el.textContent, status: el.dataset.chatStepStatus }))`,
  )
  const link = await invoke<string | null>(`${box}?.querySelector('[data-external-link]')?.getAttribute('data-external-link') ?? null`)
  const footer = await invoke<string>(`${box}?.querySelector('[data-chat-web]')?.textContent ?? ''`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'automacoes-internet-light'))
  const webRun = newAsk(webBefore)
  const label = (tool: string, start: string): boolean => steps.some((step) => step.tool === tool && step.label.startsWith(start))
  checks['askNow'] = {
    ok:
      asked &&
      label('WebSearch', 'Pesquisando: finanças em alta no Instagram') &&
      label('WebFetch', 'Abrindo financas.example') &&
      steps.some((step) => step.tool === 'WebFetch' && step.status === 'failed' && step.label.startsWith('Endereço bloqueado: não veio da busca')) &&
      link === 'https://www.financas.example/tendencias-2026?utm_source=busca' &&
      footer === 'Usou a internet · 1 busca · 1 página' &&
      readRunFiles(ctx.userDataDir).filter((run) => run.trigger === 'ask').length === runsBefore + 1 &&
      webRun?.status === 'ok' &&
      (webRun.answer?.text ?? '').includes('[Web · financas.example · Tendências 2026]('),
    detail: `resposta=${asked}; passos ${JSON.stringify(steps)}; link ${String(link)}; rodapé "${footer}"; execução ${String(webRun?.status)} "${(webRun?.answer?.text ?? '').slice(0, 160)}"`,
  }
  await clickSelector(contents, '[data-action="ask-now-close"]')
  await waitFor(contents, `!document.querySelector('[data-ask-now] [data-run-answer]')`)

  // CA5 e CA8: o agente sem internet ("Minhas tarefas"): a busca é negada e a resposta diz onde ligar.
  const offBefore = askIds()
  await setValue(contents, '#ask-now-agent', tasksAgent?.id ?? '', 'change')
  await setValue(contents, '#ask-now-text', QUESTION)
  await clickSelector(contents, '[data-action="ask-now"]')
  const offAnswered = await waitFor(contents, `${box}?.querySelector('[data-chat-footer]')`, 30_000)
  const offText = await invoke<string>(`${box}?.querySelector('[data-chat-markdown]')?.textContent ?? ''`)
  const offWeb = await invoke<boolean>(`Boolean(${box}?.querySelector('[data-chat-web]'))`)
  const offRun = newAsk(offBefore)
  const offSteps = (offRun?.answer?.steps ?? []) as { tool?: string; status?: string }[]
  checks['noInternet'] = {
    ok: offAnswered && offText === "Para isso, ligue 'Pode pesquisar na internet' neste agente." && !offWeb && offSteps.some((step) => step.tool === 'WebSearch' && step.status === 'failed') && !offSteps.some((step) => step.tool === 'WebFetch'),
    detail: `resposta=${offAnswered} "${offText.slice(0, 120)}"; rodapé com internet=${offWeb}; passos ${JSON.stringify(offSteps)}`,
  }
  await clickSelector(contents, '[data-action="ask-now-close"]')
  await waitFor(contents, `!document.querySelector('[data-ask-now] [data-run-answer]')`)

  // CA2 e CA4: o Assistente, com a fonte "Internet" ligada por padrão; o link abre no navegador do sistema.
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, routeIs('assistente'))
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
  await clickSelector(contents, '[data-action="toggle-context"]')
  const sourceOn = await waitFor(contents, `document.querySelector('[data-chat-source="internet"] [role="switch"]')?.getAttribute('aria-checked') === 'true'`)
  const sourceText = await invoke<string>(`document.querySelector('[data-chat-source="internet"]')?.textContent ?? ''`)
  await clickSelector(contents, '[data-action="close-context"]')
  const reply = await askChat(contents, `${QUESTION} e me lembre amanhã de postar`)
  // CA6: o cartão de ação de uma resposta que usou a internet avisa para conferir antes.
  const cardWarned = await waitFor(contents, `(${LAST_ASSISTANT}?.querySelector('[data-chat-action-web]')?.textContent ?? '') === 'Esta resposta usou páginas da internet: confira antes.' && ${LAST_ASSISTANT}?.querySelector('[data-chat-action="lembrete"]')`)
  await invoke(`${LAST_ASSISTANT}?.querySelector('[data-action="toggle-reasoning"]')?.click()`)
  await waitFor(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-steps]')`)
  const chatSteps = await invoke<string[]>(`[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-step]') ?? [])].map((el) => el.textContent)`)
  const chatFooter = await invoke<string>(`${LAST_ASSISTANT}?.querySelector('[data-chat-web]')?.textContent ?? ''`)
  const opensBefore = ctx.fixtures.openedUrls.length
  await invoke(`${LAST_ASSISTANT}?.querySelector('[data-external-link^="https://www.financas.example/"]')?.click()`)
  await waitFor(contents, `document.querySelector('[data-action="open-external-link"]')`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'assistente-internet-light'))
  await clickSelector(contents, '[data-action="open-external-link"]')
  for (let attempt = 0; attempt < 30 && ctx.fixtures.openedUrls.length === opensBefore; attempt++) await wait(100)
  const opened = ctx.fixtures.openedUrls.slice(opensBefore)
  checks['assistant'] = {
    ok:
      sourceOn &&
      sourceText.includes('Busca na web quando a pergunta pedir. Os links aparecem na resposta.') &&
      reply.done &&
      reply.answer.includes('Web · financas.example · Tendências 2026') &&
      chatSteps.some((step) => step.startsWith('Pesquisando: ')) &&
      chatSteps.some((step) => step.startsWith('Endereço bloqueado: não veio da busca')) &&
      chatFooter === 'Usou a internet · 1 busca · 1 página' &&
      cardWarned &&
      JSON.stringify(opened) === JSON.stringify(['https://www.financas.example/tendencias-2026?utm_source=busca']),
    detail: `fonte ligada=${sourceOn} "${sourceText.slice(0, 120)}"; resposta=${reply.done} "${reply.answer.slice(0, 200)}"; passos ${JSON.stringify(chatSteps)}; rodapé "${chatFooter}"; aviso no cartão=${cardWarned}; aberto fora do app ${JSON.stringify(opened)}`,
  }

  await invoke(`window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`)
  win.destroy()
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 21: os servidores MCP do agente, com o `claude` falso, o servidor MCP falso e o agente ACP falso.

interface SmokeMcpSession {
  method?: string
  purpose?: string
  mcpServers?: { name: string; type?: string; command?: string; args?: string[]; url?: string; env?: { name: string; length: number }[]; headers?: { name: string; length: number }[] }[]
  options?: { disallowedTools?: string[]; settings?: { permissions?: { ask?: string[] } } }
}

/** O servidor MCP falso por HTTP, numa porta livre de 127.0.0.1, exigindo o cabeçalho com o segredo inventado. */
async function smokeMcpHttp(script: string): Promise<{ url: string; stop: () => void }> {
  const child = spawnChild(process.execPath, [script, '--http', '--token', SMOKE_MCP_SECRETS.http], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'] })
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('o servidor MCP falso por HTTP não abriu')), 10_000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      const match = /PORT (\d+)/.exec(chunk)
      if (!match) return
      clearTimeout(timer)
      resolve(Number(match[1]))
    })
  })
  return { url: `http://127.0.0.1:${port}/mcp`, stop: () => void child.kill() }
}

/**
 * Contrato 21 (CA0 a CA8), no claro: a aba "Conexões" com o aviso fixo e os servidores do `claude` falso (contrato 57: o
 * conector do claude.ai sai da lista do CLI e vem na lista própria, desligado); "Ver detalhes" mascarado; ligar
 * `calculadora` para o chat, "Testar" e a regra "Negar" em `apagar_tudo`; importar o do Claude Desktop falso só no app (sem o segredo); adicionar pelo formulário no Claude CLI
 * (grava no arquivo do `claude` falso) e por JSON colado só no app (HTTP local com o cabeçalho), com "Salvar" só depois
 * do teste; no Assistente, a linha "Conexões" com um servidor desligado na conversa, o cartão de aprovação ("Permitir uma
 * vez"), o passo concluído e a ferramenta negada pela regra; o `session/new` com a definição lida na hora; tradução e
 * resumo sem MCP; "Remover" do CLI com a confirmação. PNGs `configuracoes-conexoes-light`/`-dark`,
 * `conexoes-adicionar-light` e `perguntar-aprovacao-mcp-light`. Termina com tudo desligado.
 */
async function mcpChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const script = join(app.getAppPath(), 'test', 'fixtures', 'fake-mcp-server.mjs')
  const cliFile = join(ctx.userDataDir, 'smoke-mcp', 'claude.json')
  const http = await smokeMcpHttp(script)
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const invoke = <T>(js: string): Promise<T> => evaluate<T>(contents, js)
  const secrets = Object.values(SMOKE_MCP_SECRETS)
  const leakOnScreen = async (): Promise<string[]> => {
    const html = await invoke<string>('document.documentElement.outerHTML')
    return secrets.filter((secret) => html.includes(secret))
  }
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await invoke("window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const server = (key: string): string => `[data-mcp-server=${JSON.stringify(key)}]`
  try {
    // CA0, CA2 e CA7: a aba, o aviso, a lista do CLI lida na hora e o encontrado no Claude Desktop.
    const opened = await openSettingsTab(contents, 'conexoes')
    const listed = await waitFor(contents, `document.querySelector('[data-mcp-cli-state="ok"]') && document.querySelector('${server('cli:calculadora')}')`, 15_000)
    const warning = await invoke<string>(`document.querySelector('[data-notice="mcp-warning"]')?.textContent ?? ''`)
    const cliNames = await invoke<string[]>(`[...document.querySelectorAll('[data-mcp-section="cli"] [data-mcp-server]')].map((el) => el.dataset.mcpServer)`)
    // Contrato 57: o conector não é mais um servidor "não usável" do CLI; vem na lista dos conectores, desligado.
    const claudeAiGone = await invoke<boolean>(`document.querySelector('${server('cli:claude.ai Notion')}') === null`)
    // O servidor de plugin do `claude` falso não dá para usar no app: o interruptor fica travado (contrato 21).
    const pluginLocked = await invoke<boolean>(`document.querySelector('${server('cli:plugin:design:slack')} [data-action="mcp-toggle"]')?.disabled === true`)
    const connectors = await invoke<{ names: string[]; reason: string | null; prefs: string }>(
      "Promise.all([window.__scribeApi.invoke('scribe:mcp-overview', {}), window.__scribeApi.invoke('scribe:settings-get')]).then(([o, s]) => ({ names: o.connectors.connectors.map((c) => c.name + '|' + c.toolServer + '|' + c.state), reason: o.connectors.reason, prefs: JSON.stringify(s.claudeConnectors) }))",
    )
    // Contrato 58: o `claude` falso tem três conectores (dois conectados e um que precisa autorizar).
    const connectorsOk =
      JSON.stringify(connectors.names) === JSON.stringify(['Notion|claude_ai_Notion|connected', 'Google Drive|claude_ai_Google_Drive|connected', 'Gmail|claude_ai_Gmail|needs-auth']) && connectors.reason === null && connectors.prefs === '{}'
    const allOff = await invoke<boolean>(`[...document.querySelectorAll('[data-mcp-server]')].every((el) => el.dataset.mcpState === 'off')`)
    const foundCount = await invoke<string>(`document.querySelector('[data-mcp-found-count]')?.textContent ?? ''`)
    await clickSelector(contents, `${server('cli:calculadora')} [data-action="mcp-details"]`)
    const detailsShown = await waitFor(contents, `document.querySelector('${server('cli:calculadora')} [data-mcp-details]')?.textContent.includes('CALC_TOKEN=••••')`)
    await settle(contents)
    shots.push(await capture(win, ctx.outDir, 'configuracoes-conexoes-light'))
    const leakList = await leakOnScreen()
    checks['tab'] = {
      ok:
        opened &&
        listed &&
        warning.includes(MCP_FIXED_WARNING) &&
        warning.includes('permissões separadas') &&
        JSON.stringify(cliNames) === JSON.stringify(['cli:calculadora', 'cli:docs-remoto', 'cli:plugin:design:slack']) &&
        claudeAiGone &&
        pluginLocked &&
        connectorsOk &&
        allOff &&
        foundCount === '1 servidor' &&
        detailsShown &&
        leakList.length === 0,
      detail: `aba=${opened}; lista do CLI=${listed} ${JSON.stringify(cliNames)}; aviso "${warning.slice(0, 80)}…"; claude.ai fora do CLI=${claudeAiGone}, plugin travado=${pluginLocked}, conectores ${JSON.stringify(connectors)}; tudo desligado=${allOff}; Claude Desktop "${foundCount}"; detalhes mascarados=${detailsShown}; segredos na tela=${leakList.length}`,
    }

    // CA0 e CA5: ligar `calculadora` para o chat, "Testar" (as duas ferramentas) e "Negar" em `apagar_tudo`.
    await clickSelector(contents, `${server('cli:calculadora')} [data-action="mcp-toggle"]`)
    const on = await waitFor(contents, `document.querySelector('${server('cli:calculadora')} [data-action="mcp-toggle"]')?.getAttribute('aria-checked') === 'true'`)
    await clickSelector(contents, `${server('cli:calculadora')} [data-action="mcp-test"]`)
    const tested = await waitFor(contents, `document.querySelector('${server('cli:calculadora')} [data-mcp-test="ok"]') && document.querySelector('${server('cli:calculadora')} [data-mcp-policy="apagar_tudo"]')`, 20_000)
    const tools = await invoke<string[]>(`[...document.querySelectorAll('${server('cli:calculadora')} [data-mcp-tool]')].map((el) => el.dataset.mcpTool)`)
    const state = await invoke<string>(`document.querySelector('${server('cli:calculadora')}')?.dataset.mcpState ?? ''`)
    await setValue(contents, `${server('cli:calculadora')} [data-mcp-policy="apagar_tudo"]`, 'deny', 'change')
    let prefs: unknown = null
    for (let attempt = 0; attempt < 40; attempt++) {
      prefs = existsSync(join(ctx.userDataDir, MCP_CLI_ENABLED_FILE)) ? (JSON.parse(readFileSync(join(ctx.userDataDir, MCP_CLI_ENABLED_FILE), 'utf8')) as { servers: unknown }).servers : null
      if (JSON.stringify(prefs).includes('deny')) break
      await wait(50)
    }
    checks['cliEnable'] = {
      ok: on && tested && JSON.stringify(tools) === JSON.stringify(['soma', 'apagar_tudo']) && state === 'connected' && JSON.stringify(prefs) === JSON.stringify({ calculadora: { uses: ['chat'], toolPolicy: { apagar_tudo: 'deny' } } }),
      detail: `ligado=${on}; teste=${tested} ${JSON.stringify(tools)}; estado ${state}; mcp-cli-enabled.json ${JSON.stringify(prefs)}`,
    }

    // CA2: importar do Claude Desktop só no app, desligado e sem o segredo.
    await clickSelector(contents, '[data-mcp-found="claude-desktop:arquivos-desktop"] [data-action="mcp-import-app"]')
    const imported = await waitFor(contents, `[...document.querySelectorAll('[data-mcp-section="app"] [data-mcp-server]')].some((el) => el.textContent.includes('arquivos-desktop') && el.dataset.mcpState === 'off')`)
    const appFile = (): string => (existsSync(join(ctx.userDataDir, MCP_SERVERS_FILE)) ? readFileSync(join(ctx.userDataDir, MCP_SERVERS_FILE), 'utf8') : '')
    const importedFile = appFile()
    const importedEnv = (JSON.parse(importedFile || '{"servers":[]}') as { servers: { name: string; env: { key: string; cipher?: string | null }[] }[] }).servers.find((entry) => entry.name === 'arquivos-desktop')?.env
    checks['import'] = {
      ok: imported && !importedFile.includes(SMOKE_MCP_SECRETS.desktop) && JSON.stringify(importedEnv?.find((pair) => pair.key === 'API_KEY')) === JSON.stringify({ key: 'API_KEY', secret: true, cipher: null }),
      detail: `importado desligado=${imported}; segredo no arquivo=${importedFile.includes(SMOKE_MCP_SECRETS.desktop)}; API_KEY ${JSON.stringify(importedEnv)}`,
    }

    // CA3: pelo formulário, comando local, salvo no Claude CLI (o padrão); "Salvar" só depois do teste.
    await clickSelector(contents, '[data-action="mcp-add"]')
    await waitFor(contents, `document.querySelector('[data-mcp-form="new"] #mcp-form-name')`)
    await setValue(contents, '#mcp-form-name', 'calc-form')
    await setValue(contents, '#mcp-form-command', process.execPath)
    await setValue(contents, '#mcp-form-args', script)
    await clickSelector(contents, '[data-action="mcp-form-add-env"]')
    await setValue(contents, '[data-mcp-form] [data-mcp-pair="env"] [data-mcp-pair-key]', 'ELECTRON_RUN_AS_NODE')
    await setValue(contents, '[data-mcp-form] [data-mcp-pair="env"] [data-mcp-pair-value]', '1')
    const saveLockedBefore = await invoke<boolean>(`document.querySelector('[data-action="mcp-form-save"]')?.disabled === true`)
    const targetCli = await invoke<string | null>(`document.querySelector('[data-mcp-form-target="cli"]')?.getAttribute('aria-checked') ?? null`)
    await clickSelector(contents, '[data-action="mcp-form-test"]')
    const formTested = await waitFor(contents, `document.querySelector('[data-mcp-form-result="ok"] [data-mcp-tool="soma"]') && document.querySelector('[data-action="mcp-form-save"]')?.disabled === false`, 20_000)
    await settle(contents)
    shots.push(await capture(win, ctx.outDir, 'conexoes-adicionar-light'))
    await clickSelector(contents, '[data-action="mcp-form-save"]')
    const formSaved = await waitFor(contents, `!document.querySelector('[data-mcp-form]') && document.querySelector('${server('cli:calc-form')}')`, 20_000)
    // Nasce desligado para o app (CA0); o smoke liga para o chat.
    const formOff = await invoke<string | null>(`document.querySelector('${server('cli:calc-form')} [data-action="mcp-toggle"]')?.getAttribute('aria-checked') ?? null`)
    await clickSelector(contents, `${server('cli:calc-form')} [data-action="mcp-toggle"]`)
    const formOn = await waitFor(contents, `document.querySelector('${server('cli:calc-form')} [data-action="mcp-toggle"]')?.getAttribute('aria-checked') === 'true'`)
    const cliAfter = JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, { command?: string; args?: string[] }> }
    checks['addForm'] = {
      ok: saveLockedBefore && targetCli === 'true' && formTested && formSaved && formOff === 'false' && formOn && cliAfter.mcpServers['calc-form']?.command === process.execPath && JSON.stringify(cliAfter.mcpServers['calc-form']?.args) === JSON.stringify([script]),
      detail: `"Salvar" travado antes do teste=${saveLockedBefore}; "Salvar no Claude CLI" marcado=${targetCli}; teste=${formTested}; salvo=${formSaved}; desligado ao nascer=${formOff}, ligado=${formOn}; no CLI falso ${JSON.stringify(cliAfter.mcpServers['calc-form'] ?? null).replace(process.execPath, '<electron>')}`,
    }

    // CA3: por JSON colado (HTTP local com o cabeçalho), só neste app.
    await clickSelector(contents, '[data-action="mcp-add"]')
    await waitFor(contents, `document.querySelector('[data-mcp-form="new"]')`)
    await clickSelector(contents, '[data-action="mcp-form-json"]')
    await waitFor(contents, `document.querySelector('#mcp-form-json')`)
    await setValue(contents, '#mcp-form-json', JSON.stringify({ mcpServers: { 'calc-http': { type: 'http', url: http.url, headers: { Authorization: `Bearer ${SMOKE_MCP_SECRETS.http}` } } } }))
    await clickSelector(contents, '[data-action="mcp-form-paste"]')
    const pasted = await waitFor(contents, `document.querySelector('#mcp-form-url')?.value === ${JSON.stringify(http.url)} && document.querySelector('#mcp-form-name')?.value === 'calc-http'`)
    const headerSecret = await invoke<boolean>(`document.querySelector('[data-mcp-form] [data-mcp-pair="header"] [data-mcp-pair-secret]')?.checked === true`)
    await clickSelector(contents, '[data-mcp-form-target="app"]')
    await clickSelector(contents, '[data-action="mcp-form-test"]')
    const jsonTested = await waitFor(contents, `document.querySelector('[data-mcp-form-result="ok"] [data-mcp-tool="apagar_tudo"]')`, 20_000)
    await clickSelector(contents, '[data-action="mcp-form-save"]')
    const httpItem = `[...document.querySelectorAll('[data-mcp-section="app"] [data-mcp-server]')].find((el) => el.textContent.includes('calc-http'))`
    // Nasce desligado (CA1); o smoke liga e o estado mostra o último teste.
    const jsonSavedOff = await waitFor(contents, `${httpItem}?.dataset.mcpState === 'off'`, 20_000)
    await invoke(`${httpItem}?.querySelector('[data-action="mcp-toggle"]')?.click()`)
    const jsonSaved = jsonSavedOff && (await waitFor(contents, `${httpItem}?.dataset.mcpState === 'connected'`))
    const savedFile = appFile()
    checks['addJson'] = {
      ok: pasted && headerSecret && jsonTested && jsonSaved && !savedFile.includes(SMOKE_MCP_SECRETS.http) && savedFile.includes('calc-http'),
      detail: `formulário preenchido=${pasted}; cabeçalho como segredo=${headerSecret}; teste=${jsonTested}; salvo desligado=${jsonSavedOff}, ligado e conectado=${jsonSaved}; segredo em texto no arquivo=${savedFile.includes(SMOKE_MCP_SECRETS.http)}`,
    }
    const leakForms = await leakOnScreen()

    // CA0: a definição é lida na hora: muda no CLI depois de ligar e a sessão vê a de agora.
    const cliNow = JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, { args?: string[] }> }
    cliNow.mcpServers['calculadora']?.args?.push('--rodada-2')
    writeFileSync(cliFile, JSON.stringify(cliNow, null, 2))

    // CA4 a CA6: o Assistente com as conexões; `calc-form` desligado só nesta conversa.
    const sessionsBefore = readAcpLog(ctx.userDataDir).filter((entry) => entry.method === 'session/new').length
    await clickSelector(contents, '[data-nav="assistente"]')
    await waitFor(contents, routeIs('assistente'))
    await clickSelector(contents, '[data-action="chat-new"]')
    await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
    await clickSelector(contents, '[data-action="toggle-context"]')
    const row = await waitFor(contents, `document.querySelectorAll('[data-chat-connections] [data-chat-connection]').length === 3`, 8000)
    const rowKeys = await invoke<string[]>(`[...document.querySelectorAll('[data-chat-connection]')].map((el) => el.dataset.chatConnection)`)
    await clickSelector(contents, `[data-chat-connection="cli:calc-form"] [role="switch"]`)
    const offInChat = await waitFor(contents, `document.querySelector('[data-chat-connection="cli:calc-form"] [role="switch"]')?.getAttribute('aria-checked') === 'false'`)
    await clickSelector(contents, '[data-action="close-context"]')
    await setValue(contents, '[data-chat-input]', 'Calculadora: some 2 e 3 e depois apague tudo')
    await pressEnterIn(contents, '[data-chat-input]')
    const card = await waitFor(contents, `document.querySelector('[data-mcp-approval]')?.textContent.includes('O Claude quer usar soma de calculadora')`, 15_000)
    const cardArgs = await invoke<string>(`document.querySelector('[data-mcp-approval-args]')?.textContent ?? ''`)
    const cardButtons = await invoke<string[]>(`[...document.querySelectorAll('[data-mcp-approval] button')].map((el) => el.textContent)`)
    await settle(contents)
    shots.push(await capture(win, ctx.outDir, 'perguntar-aprovacao-mcp-light'))
    await clickSelector(contents, '[data-mcp-approval] [data-action="mcp-allow-once"]')
    const done = await waitFor(contents, `${CHAT_DONE} && (${LAST_ASSISTANT}?.textContent ?? '').includes('A soma deu 5.')`, 15_000)
    const answerText = await invoke<string>(`${LAST_ASSISTANT}?.querySelector('[data-chat-markdown]')?.textContent ?? ''`)
    await invoke(`${LAST_ASSISTANT}?.querySelector('[data-action="toggle-reasoning"]')?.click()`)
    await waitFor(contents, `${LAST_ASSISTANT}?.querySelector('[data-chat-steps]')`)
    const steps = await invoke<{ tool: string; label: string; status: string }[]>(
      `[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-step]') ?? [])].map((el) => ({ tool: el.dataset.chatStep, label: el.querySelector('span.min-w-0')?.textContent ?? '', status: el.dataset.chatStepStatus }))`,
    )
    const cardGone = await invoke<boolean>(`!document.querySelector('[data-mcp-approval]')`)
    const log = readAcpLog(ctx.userDataDir)
    const chatSession = (log.filter((entry) => entry.method === 'session/new').slice(sessionsBefore) as SmokeMcpSession[]).find((entry) => entry.purpose === 'chat')
    const servers = chatSession?.mcpServers ?? []
    const calc = servers.find((entry) => entry.name === 'calculadora')
    const httpServer = servers.find((entry) => entry.name === 'calc-http')
    const mcpEvents = log.filter((entry) => (entry as { event?: string }).event === 'mcp').map((entry) => `${String((entry as { tool?: string }).tool)}:${String((entry as { outcome?: string }).outcome)}`)
    checks['chat'] = {
      ok:
        row &&
        JSON.stringify(rowKeys) === JSON.stringify(['cli:calculadora', 'cli:calc-form', `app:${(JSON.parse(appFile()) as { servers: { id: string; name: string }[] }).servers.find((entry) => entry.name === 'calc-http')?.id ?? ''}`]) &&
        offInChat &&
        card &&
        cardArgs === '{\n  "a": 2,\n  "b": 3\n}' &&
        JSON.stringify(cardButtons) === JSON.stringify(['Permitir uma vez', 'Sempre permitir esta ferramenta', 'Negar']) &&
        done &&
        answerText.includes('A soma deu 5.') &&
        answerText.includes('Não pude usar apagar_tudo: o app negou.') &&
        steps.some((step) => step.tool === 'Mcp' && step.label === 'Usando soma (calculadora)' && step.status === 'completed') &&
        steps.some((step) => step.tool === 'Mcp' && step.label === 'Usando apagar_tudo (calculadora)' && step.status === 'failed') &&
        cardGone &&
        JSON.stringify(mcpEvents.slice(-2)) === JSON.stringify(['soma:allow', 'apagar_tudo:reject']),
      detail: `linha Conexões=${row} ${JSON.stringify(rowKeys)}; desligado na conversa=${offInChat}; cartão=${card} args ${JSON.stringify(cardArgs)} botões ${JSON.stringify(cardButtons)}; resposta=${done} "${answerText}"; passos ${JSON.stringify(steps)}; cartão saiu=${cardGone}; agente ${JSON.stringify(mcpEvents)}`,
    }
    checks['session'] = {
      ok:
        JSON.stringify(servers.map((entry) => entry.name)) === JSON.stringify(['calculadora', 'calc-http']) &&
        (calc?.args ?? []).includes('--rodada-2') &&
        calc?.env?.some((pair) => pair.name === 'CALC_TOKEN' && pair.length === SMOKE_MCP_SECRETS.cli.length) === true &&
        httpServer?.type === 'http' &&
        httpServer.url === http.url &&
        httpServer.headers?.some((pair) => pair.name === 'Authorization' && pair.length === `Bearer ${SMOKE_MCP_SECRETS.http}`.length) === true &&
        (chatSession?.options?.disallowedTools ?? []).includes('mcp__calculadora__apagar_tudo') &&
        JSON.stringify(chatSession?.options?.settings?.permissions?.ask ?? []) === JSON.stringify(['WebSearch', 'WebFetch', 'mcp__calculadora', 'mcp__calc-http']),
      detail: `servidores ${JSON.stringify(servers.map((entry) => entry.name))}; calculadora lida na hora (--rodada-2)=${(calc?.args ?? []).includes('--rodada-2')}; CALC_TOKEN com o tamanho do segredo=${String(calc?.env?.some((pair) => pair.name === 'CALC_TOKEN' && pair.length === SMOKE_MCP_SECRETS.cli.length))}; HTTP ${httpServer?.type ?? '-'}; negadas ${JSON.stringify((chatSession?.options?.disallowedTools ?? []).filter((tool) => tool.startsWith('mcp__')))}; ask ${JSON.stringify(chatSession?.options?.settings?.permissions?.ask ?? [])}`,
    }

    // CA4: tradução, resumo e os outros usos nunca recebem servidor MCP (em todo o roteiro do smoke).
    const others = (readAcpLog(ctx.userDataDir) as SmokeMcpSession[]).filter((entry) => entry.method === 'session/new' && entry.purpose !== 'chat' && entry.purpose !== 'analysis')
    const withMcp = others.filter((entry) => (entry.mcpServers ?? []).length > 0)
    checks['otherUses'] = {
      ok: others.some((entry) => entry.purpose === 'translate') && others.some((entry) => entry.purpose === 'summary') && withMcp.length === 0,
      detail: `${others.length} sessões de outros usos (${[...new Set(others.map((entry) => entry.purpose))].join(', ')}); com MCP: ${withMcp.length}`,
    }

    // CA0: "Remover" do CLI com a confirmação roda `claude mcp remove -s user`.
    await openSettingsTab(contents, 'conexoes')
    await waitFor(contents, `document.querySelector('${server('cli:calc-form')}')`, 15_000)
    await clickSelector(contents, `${server('cli:calc-form')} [data-action="mcp-remove"]`)
    const confirmText = await invoke<string>(`document.querySelector('${server('cli:calc-form')} [data-mcp-remove-confirm]')?.textContent ?? ''`)
    await clickSelector(contents, `${server('cli:calc-form')} [data-action="mcp-remove-confirm"]`)
    const removed = await waitFor(contents, `!document.querySelector('${server('cli:calc-form')}')`, 15_000)
    const cliRemoved = !(JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers['calc-form']
    const leakEnd = await leakOnScreen()
    checks['remove'] = {
      ok: confirmText.includes('Remover também do Claude CLI do terminal?') && removed && cliRemoved,
      detail: `confirmação "${confirmText}"; saiu da lista=${removed}; saiu do CLI falso=${cliRemoved}`,
    }
    checks['secrets'] = {
      ok: leakList.length + leakForms.length + leakEnd.length === 0 && !appFile().includes(SMOKE_MCP_SECRETS.http) && !JSON.stringify(readAcpLog(ctx.userDataDir)).includes(SMOKE_MCP_SECRETS.cli),
      detail: `segredos na tela: ${leakList.length + leakForms.length + leakEnd.length}; em texto no mcp-servers.json=${appFile().includes(SMOKE_MCP_SECRETS.http)}; no registro do agente falso=${JSON.stringify(readAcpLog(ctx.userDataDir)).includes(SMOKE_MCP_SECRETS.cli)}`,
    }

    // No escuro, a aba com os servidores ligados.
    const dark = ctx.openWindow({ theme: 'dark' })
    watch(dark)
    await loadAndWait(dark)
    await openSettingsTab(dark.webContents, 'conexoes')
    const darkListed = await waitFor(dark.webContents, `document.querySelector('[data-mcp-cli-state="ok"]') && document.querySelector('${server('cli:calculadora')}')?.dataset.mcpState !== 'off'`, 15_000)
    await settle(dark.webContents)
    shots.push(await capture(dark, ctx.outDir, 'configuracoes-conexoes-dark'))
    checks['dark'] = { ok: darkListed, detail: `lista no escuro=${darkListed}` }
    dark.destroy()
  } finally {
    // Tudo desligado: o resto do roteiro segue sem MCP.
    await invoke(
      `window.__scribeApi.invoke('scribe:mcp-overview', {}).then((overview) => Promise.all([...overview.cli.servers, ...overview.app].filter((entry) => entry.enabled).map((entry) => window.__scribeApi.invoke('scribe:mcp-update', { key: entry.key, enabled: false })))).then(() => true)`,
    ).catch(() => undefined)
    await invoke(`window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`).catch(() => undefined)
    http.stop()
    win.destroy()
  }
}

/**
 * Contrato 58 (CA1 a CA6), depois do contrato 21 (que termina com tudo desligado): a seção "Conectores do claude.ai", por
 * último na aba, com os três conectores do `claude` falso (Notion e Google Drive conectados, Gmail precisa autorizar),
 * tudo desligado; o link "Autorizar no claude.ai" pelo `scribe:open-link`; ligar o Notion (o aviso de uma linha e o "vale
 * na próxima pergunta"); "Ver ferramentas" pelo `mcpServerStatus` do `claude` falso, com o rótulo "Escrita", e "Negar"
 * em `delete-comment`; no Assistente, o `session/new` do chat com as opções do CA4 do contrato 57. PNGs
 * `conexoes-conectores-light` e `-dark`. Termina com `claudeConnectors` vazio.
 */
async function connectorChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const invoke = <T>(js: string): Promise<T> => evaluate<T>(contents, js)
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await invoke("window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const item = (name: string): string => `[data-connector=${JSON.stringify(name)}]`
  // Só a coluna das Configurações rola: o título da seção no alto.
  const scrollToConnectors = (target: WebContents): Promise<unknown> =>
    evaluate(
      target,
      `(() => { const scroll = document.querySelector('[data-settings-panel="conexoes"]')?.closest('[data-settings-scroll]') ?? document.querySelector('[data-settings-scroll]'); const section = document.querySelector('section[aria-label="Conectores do claude.ai"]'); if (scroll && section) scroll.scrollTop += section.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16; return true })()`,
    )
  try {
    // CA1 e CA4: a seção por último, os três conectores desligados, o Gmail travado com o link; o plugin sem o "conectores".
    const opened = await openSettingsTab(contents, 'conexoes')
    const listed = await waitFor(contents, `document.querySelector('[data-connectors-section="ok"]') && document.querySelectorAll('[data-connector]').length === 3`, 15_000)
    const sections = await invoke<string[]>(`[...document.querySelectorAll('[data-settings-panel="conexoes"] section[aria-label]')].map((el) => el.getAttribute('aria-label'))`)
    const rows = await invoke<{ name: string; state: string; checked: string | null; disabled: boolean; text: string }[]>(
      `[...document.querySelectorAll('[data-connector]')].map((el) => ({ name: el.dataset.connector, state: el.dataset.connectorState, checked: el.querySelector('[data-action="connector-toggle"]')?.getAttribute('aria-checked') ?? null, disabled: el.querySelector('[data-action="connector-toggle"]')?.disabled === true, text: el.innerText }))`,
    )
    const stateColors = await invoke<string[]>(`[...document.querySelectorAll('[data-connector] p:nth-of-type(2) span')].map((el) => el.className)`)
    const count = await invoke<string>(`document.querySelector('[data-connectors-count]')?.textContent ?? ''`)
    const toolsButtons = await invoke<string[]>(`[...document.querySelectorAll('[data-action="connector-tools"]')].map((el) => el.closest('[data-connector]').dataset.connector)`)
    const pluginText = await invoke<string>(`document.querySelector('[data-mcp-server="cli:plugin:design:slack"]')?.innerText ?? ''`)
    const openedBefore = ctx.fixtures.openedUrls.length
    await clickSelector(contents, `${item('Gmail')} [data-action="connector-authorize"]`)
    await wait(100)
    const authorizeOpened = ctx.fixtures.openedUrls.slice(openedBefore).join()
    checks['connectorsList'] = {
      ok:
        opened &&
        listed &&
        sections.at(-1) === 'Conectores do claude.ai' &&
        JSON.stringify(sections.slice(0, 3)) === JSON.stringify(['Do Claude CLI', 'Servidores do app', 'Encontrados neste Mac']) &&
        JSON.stringify(rows.map((row) => `${row.name}|${row.state}|${String(row.checked)}|${String(row.disabled)}`)) === JSON.stringify(['Notion|connected|false|false', 'Google Drive|connected|false|false', 'Gmail|needs-auth|false|true']) &&
        rows.every((row) => !row.text.includes('Não dá para usar no app') && !row.text.includes('claude.ai Notion')) &&
        rows[0]?.text.includes('Conector do claude.ai · Conectado') === true &&
        rows[2]?.text.includes('Conector do claude.ai · Precisa autorizar') === true &&
        rows[2]?.text.includes(`${CLAUDE_CONNECTOR_AUTHORIZE_HINT} Autorizar no claude.ai`) === true &&
        JSON.stringify(stateColors) === JSON.stringify(['text-live', 'text-live', 'text-text-muted']) &&
        count === '3 conectores' &&
        JSON.stringify(toolsButtons) === JSON.stringify(['Notion', 'Google Drive']) &&
        pluginText.includes('Não dá para usar no app') &&
        pluginText.includes('(de plugins)') &&
        !pluginText.includes('conectores do claude.ai') &&
        authorizeOpened === CLAUDE_CONNECTORS_URL,
      detail: `aba=${opened}; lista=${listed}; seções ${JSON.stringify(sections)}; linhas ${JSON.stringify(rows.map((row) => `${row.name}|${row.state}|${String(row.checked)}|${String(row.disabled)}`))}; cores ${JSON.stringify(stateColors)}; contagem "${count}"; "Ver ferramentas" em ${JSON.stringify(toolsButtons)}; plugin "${pluginText.replace(/\s+/g, ' ').slice(0, 160)}"; link aberto "${authorizeOpened}"`,
    }

    // CA2 e CA5: ligar o Notion pela primeira vez.
    await clickSelector(contents, `${item('Notion')} [data-action="connector-toggle"]`)
    const on = await waitFor(contents, `document.querySelector('${item('Notion')} [data-action="connector-toggle"]')?.getAttribute('aria-checked') === 'true'`)
    const notice = await invoke<string>(`document.querySelector('${item('Notion')} [data-notice="connector-enabled"]')?.textContent ?? ''`)
    const next = await invoke<string>(`document.querySelector('${item('Notion')} [data-connector-next]')?.textContent ?? ''`)
    const dialogs = await invoke<number>(`document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]').length`)
    const prefsOn = JSON.stringify(readSettings(ctx.userDataDir).claudeConnectors ?? null)
    checks['connectorsEnable'] = {
      ok: on && notice === claudeConnectorEnabledNotice('Notion') && next === CLAUDE_CONNECTOR_NEXT_QUESTION && dialogs === 0 && prefsOn === JSON.stringify({ Notion: { enabled: true, everEnabled: true, tools: {} } }),
      detail: `ligado=${on}; aviso "${notice}"; próxima pergunta "${next}"; diálogos ${dialogs}; settings ${prefsOn}`,
    }

    // CA3: "Ver ferramentas" do Notion, do `mcpServerStatus` do `claude` falso; "Escrita" pelo nome; "Negar" em `delete-comment`.
    await clickSelector(contents, `${item('Notion')} [data-action="connector-tools"]`)
    const toolsShown = await waitFor(contents, `document.querySelectorAll('${item('Notion')} [data-mcp-tool]').length === 5`, 25_000)
    const tools = await invoke<{ name: string; write: boolean; policy: string }[]>(
      `[...document.querySelectorAll('${item('Notion')} [data-mcp-tool]')].map((el) => ({ name: el.dataset.mcpTool, write: Boolean(el.querySelector('[data-mcp-tool-write]')), policy: el.querySelector('[data-mcp-policy]')?.value ?? '' }))`,
    )
    const hideLabel = await invoke<string>(`document.querySelector('${item('Notion')} [data-action="connector-tools"]')?.textContent ?? ''`)
    await setValue(contents, `${item('Notion')} [data-mcp-policy="delete-comment"]`, 'deny', 'change')
    let prefsPolicy = ''
    for (let attempt = 0; attempt < 40; attempt++) {
      prefsPolicy = JSON.stringify(readSettings(ctx.userDataDir).claudeConnectors ?? null)
      if (prefsPolicy.includes('deny')) break
      await wait(50)
    }
    const policyShown = await invoke<string>(`document.querySelector('${item('Notion')} [data-mcp-policy="delete-comment"]')?.value ?? ''`)
    await scrollToConnectors(contents)
    await settle(contents)
    shots.push(await capture(win, ctx.outDir, 'conexoes-conectores-light'))
    checks['connectorsTools'] = {
      ok:
        toolsShown &&
        JSON.stringify(tools.map((tool) => `${tool.name}|${String(tool.write)}|${tool.policy}`)) ===
          JSON.stringify(['search|false|ask', 'fetch|false|ask', 'create-pages|true|ask', 'update-page|true|ask', 'delete-comment|true|ask']) &&
        hideLabel === 'Ocultar ferramentas' &&
        prefsPolicy === JSON.stringify({ Notion: { enabled: true, everEnabled: true, tools: { 'delete-comment': 'deny' } } }) &&
        policyShown === 'deny',
      detail: `ferramentas=${toolsShown} ${JSON.stringify(tools)}; botão "${hideLabel}"; settings ${prefsPolicy}; regra na tela ${policyShown}`,
    }

    // CA6 (e CA4 do contrato 57): a sessão do chat com o Notion ligado, sem o modo estrito e com o resto bloqueado.
    const sessionsBefore = readAcpLog(ctx.userDataDir).filter((entry) => entry.method === 'session/new').length
    await clickSelector(contents, '[data-nav="assistente"]')
    await waitFor(contents, routeIs('assistente'))
    await clickSelector(contents, '[data-action="chat-new"]')
    await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)
    await setValue(contents, '[data-chat-input]', 'O que tenho no Notion sobre o orçamento?')
    await pressEnterIn(contents, '[data-chat-input]')
    const answered = await waitFor(contents, CHAT_DONE, 30_000)
    const chatSession = (readAcpLog(ctx.userDataDir).filter((entry) => entry.method === 'session/new').slice(sessionsBefore) as (SmokeMcpSession & { options?: Record<string, unknown> })[]).find((entry) => entry.purpose === 'chat')
    const options = (chatSession?.options ?? {}) as { strictMcpConfig?: unknown; settingSources?: unknown; extraArgs?: Record<string, unknown>; disallowedTools?: string[]; settings?: { permissions?: { ask?: string[] } } }
    const disallowed = options.disallowedTools ?? []
    const ask = options.settings?.permissions?.ask ?? []
    checks['connectorsSession'] = {
      ok:
        answered &&
        chatSession !== undefined &&
        !('strictMcpConfig' in options) &&
        JSON.stringify(options.settingSources) === '[]' &&
        options.extraArgs !== undefined &&
        'restricted' in options.extraArgs &&
        ask.includes('mcp__claude_ai_Notion') &&
        !ask.includes('mcp__claude_ai_Google_Drive') &&
        disallowed.includes('mcp__claude_ai_Google_Drive') &&
        disallowed.includes('mcp__claude_ai_Gmail') &&
        disallowed.includes('mcp__calculadora') &&
        disallowed.includes('mcp__claude_ai_Notion__delete-comment') &&
        !disallowed.includes('mcp__claude_ai_Notion'),
      detail: `resposta=${answered}; sessão de chat=${chatSession !== undefined}; strict=${String(options.strictMcpConfig)}; settingSources ${JSON.stringify(options.settingSources)}; extraArgs ${JSON.stringify(options.extraArgs)}; ask ${JSON.stringify(ask)}; negadas mcp ${JSON.stringify(disallowed.filter((tool) => tool.startsWith('mcp__')))}`,
    }

    // No escuro, a seção com o Notion ligado e as ferramentas abertas.
    const dark = ctx.openWindow({ theme: 'dark' })
    watch(dark)
    await loadAndWait(dark)
    await openSettingsTab(dark.webContents, 'conexoes')
    const darkListed = await waitFor(dark.webContents, `document.querySelector('${item('Notion')} [data-action="connector-toggle"]')?.getAttribute('aria-checked') === 'true'`, 15_000)
    await clickSelector(dark.webContents, `${item('Notion')} [data-action="connector-tools"]`)
    const darkTools = await waitFor(dark.webContents, `document.querySelectorAll('${item('Notion')} [data-mcp-tool]').length === 5`, 25_000)
    await scrollToConnectors(dark.webContents)
    await settle(dark.webContents)
    shots.push(await capture(dark, ctx.outDir, 'conexoes-conectores-dark'))
    checks['connectorsDark'] = { ok: darkListed && darkTools, detail: `Notion ligado no escuro=${darkListed}; ferramentas=${darkTools}` }
    dark.destroy()
  } finally {
    // Tudo desligado: o resto do roteiro segue sem conector.
    await invoke(`window.__scribeApi.invoke('scribe:settings-update', { claudeConnectors: {}, claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`).catch(() => undefined)
    win.destroy()
  }
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 23: Automações (agentes, tarefas agendadas, execuções) com o agente ACP falso e o relógio do
// agendador adiantado pelo smoke; o ícone da barra de menus, as notificações, o Dock e o "abrir ao entrar" são
// substitutos que só registram. Nada sai da máquina e nenhum agente alcança o WhatsApp.

interface SmokeRunFile {
  id: string
  taskId: string | null
  taskName: string | null
  trigger: string
  status: string
  error: string | null
  outputResult: string | null
  costUsd: number
  answer: { text: string; steps?: unknown[]; meta?: unknown } | null
}

function readRunFiles(userDataDir: string): SmokeRunFile[] {
  const dir = join(userDataDir, SCHEDULE_RUNS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as SmokeRunFile)
}

interface SmokeTaskFile {
  id: string
  name: string
  nextRunAt: string | null
  lastStatus: string | null
  autoPaused: boolean
  consecutiveFailures: number
}

function readTaskFiles(userDataDir: string): SmokeTaskFile[] {
  const file = join(userDataDir, SCHEDULES_FILE)
  if (!existsSync(file)) return []
  return (JSON.parse(readFileSync(file, 'utf8')) as { tasks: SmokeTaskFile[] }).tasks
}

/** Espera o agendador terminar o que está na fila e rodando. */
async function automationsIdle(ctx: SmokeContext): Promise<void> {
  await wait(100)
  await ctx.automations.settled()
  await wait(100)
}

/** Contrato 50: os itens dos submenus (Automações, Recentes, cada reunião) entram logo depois do item pai. */
const trayItems = (items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? trayItems(item.submenu) : [])])
const trayLabels = (ctx: SmokeContext): string[] => trayItems(ctx.tray()?.template() ?? []).map((item) => (item.type === 'separator' ? '—' : String(item.label ?? '')))

function trayClick(ctx: SmokeContext, id: string): boolean {
  const item = trayItems(ctx.tray()?.template() ?? []).find((entry) => entry.id === id)
  if (!item?.click) return false
  ;(item.click as () => void)()
  return true
}

async function automationsChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const auto = ctx.fixtures.automations
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const invoke = <T>(script: string): Promise<T> => evaluate<T>(contents, script)
  // O agente ACP falso instalado (o bloco do WhatsApp já instalou; se não, instala aqui).
  const acpStatus = await invoke<{ state?: string }>("window.__scribeApi.invoke('scribe:acp-status')")
  if (acpStatus.state !== 'installed') await invoke("window.__scribeApi.invoke('scribe:acp-install').then(() => true)")

  // A tela, logo abaixo de "Perguntar", com "Pedir agora", as três abas e os agentes de exemplo.
  await clickSelector(contents, '[data-nav="automacoes"]')
  const cards = await waitFor(contents, `document.querySelectorAll('[data-agent-card]').length === 3`, 8000)
  const seeded = await invoke<string[]>(`[...document.querySelectorAll('[data-agent-card]')].map((card) => card.dataset.agentName)`)
  const tabs = await invoke<string[]>(`[...document.querySelectorAll('[data-automations] [role="tab"]')].map((tab) => tab.textContent)`)
  const nav = await invoke<string[]>(`[...document.querySelectorAll('[data-nav]')].map((item) => item.dataset.nav)`)
  const askNowShown = await invoke<boolean>(`Boolean(document.querySelector('[data-ask-now] #ask-now-text'))`)
  const title = await text(contents, 'main h1')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'agentes-light'))
  checks['screen'] = {
    ok:
      cards &&
      JSON.stringify(seeded) === JSON.stringify(['Resumo da semana', 'Minhas tarefas', 'Pendências da reunião']) &&
      JSON.stringify(tabs) === JSON.stringify(['Agentes', 'Tarefas agendadas', 'Execuções']) &&
      nav.indexOf('automacoes') === nav.indexOf('assistente') + 1 &&
      askNowShown &&
      title === 'Automações' &&
      existsSync(join(ctx.userDataDir, AGENTS_FILE)),
    detail: `título "${title}"; agentes ${JSON.stringify(seeded)}; abas ${JSON.stringify(tabs)}; barra lateral ${JSON.stringify(nav)}; Pedir agora=${askNowShown}`,
  }

  // Novo agente pelo formulário e "Testar agora" (não entra no histórico).
  await clickSelector(contents, '[data-action="agent-new"]')
  await waitFor(contents, `document.querySelector('[data-agent-form]')`)
  await setValue(contents, '#agent-name', 'Agente do smoke')
  await setValue(contents, '#agent-description', 'Criado pelo formulário no smoke.')
  await clickSelector(contents, '[data-agent-icon="sparkles"]')
  await clickSelector(contents, '[data-agent-color="purple"]')
  await setValue(contents, '#agent-instructions', 'Liste as decisões das reuniões, uma por linha, com a reunião citada.')
  await clickSelector(contents, '[data-agent-model-option="haiku"]')
  await setValue(contents, '#agent-output', 'chat', 'change')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'agente-editar-light'))
  const logBefore = readAcpLog(ctx.userDataDir).length
  await setValue(contents, '#agent-test-text', 'O que ficou decidido?')
  await clickSelector(contents, '[data-action="agent-test"]')
  const testDone = await waitFor(contents, `document.querySelector('[data-agent-test] [data-run-state="ok"] [data-chat-message="assistant"]:not([data-chat-streaming])')`, 30_000)
  const testView = await invoke<{ reasoning: boolean; footer: string; answer: string; asked: string }>(
    `(() => { const box = document.querySelector('[data-agent-test]'); return { reasoning: Boolean(box?.querySelector('[data-chat-reasoning]')), footer: box?.querySelector('[data-chat-footer]')?.textContent ?? '', answer: box?.querySelector('[data-chat-message="assistant"] [data-chat-markdown]')?.textContent ?? '', asked: box?.querySelector('[data-chat-message="user"]')?.textContent ?? '' } })()`,
  )
  const testSessions = readAcpLog(ctx.userDataDir)
    .slice(logBefore)
    .filter((entry) => entry.method === 'session/new') as (AcpLogEntry & { options?: { tools?: string[]; settingSources?: unknown[]; disallowedTools?: string[]; systemPrompt?: string }; mcpServers?: unknown[]; cwd?: string; configOptions?: { configId: string; value: string }[] })[]
  const testSession = testSessions[0]
  const sessionSafe =
    testSessions.length === 1 &&
    JSON.stringify(testSession?.options?.tools) === JSON.stringify([...CLAUDE_READ_TOOLS]) &&
    JSON.stringify(testSession?.options?.settingSources) === '[]' &&
    JSON.stringify(testSession?.mcpServers) === '[]' &&
    CLAUDE_DISALLOWED_TOOLS.every((tool) => testSession?.options?.disallowedTools?.includes(tool)) &&
    testSession?.cwd === join(ctx.userDataDir, CHAT_CORPUS_DIR) &&
    testSession?.configOptions?.some((option) => option.configId === 'model' && option.value === 'haiku') === true
  const runsAfterTest = readRunFiles(ctx.userDataDir).length
  checks['testNow'] = {
    ok: testDone && testView.reasoning && testView.footer.includes('US$') && testView.answer.includes('INDICE.md') && testView.asked === 'O que ficou decidido?' && sessionSafe && runsAfterTest === 0,
    detail: `resposta=${testDone} "${testView.answer.slice(0, 60)}"; raciocínio=${testView.reasoning}; rodapé "${testView.footer}"; session/new só leitura, sem configurações pessoais, sem MCP, no acervo, Haiku=${sessionSafe}; execuções gravadas=${runsAfterTest}`,
  }
  await clickSelector(contents, '[data-action="agent-save"]')
  const savedCard = await waitFor(contents, `document.querySelectorAll('[data-agent-card]').length === 4 && document.querySelector('[data-agent-card][data-agent-name="Agente do smoke"]')`)
  const agentsFile = JSON.parse(readFileSync(join(ctx.userDataDir, AGENTS_FILE), 'utf8')) as { agents: { id: string; name: string; icon: string; color: string; model: string; output: { kind: string } }[] }
  const smokeAgent = agentsFile.agents.find((agent) => agent.name === 'Agente do smoke')
  checks['agentForm'] = {
    ok: savedCard && smokeAgent?.icon === 'sparkles' && smokeAgent.color === 'purple' && smokeAgent.model === 'haiku' && smokeAgent.output.kind === 'chat' && mode(join(ctx.userDataDir, AGENTS_FILE)) === '600',
    detail: `cartão=${savedCard}; agents.json ${mode(join(ctx.userDataDir, AGENTS_FILE))} ${JSON.stringify(smokeAgent)}`,
  }
  const agentId = smokeAgent?.id ?? ''
  const pendenciasId = agentsFile.agents.find((agent) => agent.name === 'Pendências da reunião')?.id ?? ''

  // Tarefa diária pelo formulário (com a prévia) e uma "depois de cada reunião" pela sugestão pronta.
  await clickSelector(contents, '#automations-tab-tarefas')
  await waitFor(contents, `document.querySelector('[data-tasks-tab]')`)
  await clickSelector(contents, '[data-action="task-new"]')
  await waitFor(contents, `document.querySelector('[data-task-form]')`)
  const suggestions = await invoke<number>(`document.querySelectorAll('[data-task-suggestion]').length`)
  await setValue(contents, '#task-name', 'Resumo diário do smoke')
  await setValue(contents, '#task-agent', agentId, 'change')
  await setValue(contents, '#task-message', 'Resuma as reuniões de hoje.')
  await setValue(contents, '#task-frequency', 'daily', 'change')
  await waitFor(contents, `document.querySelector('[data-task-frequency="daily"] [data-task-time]')`)
  await setValue(contents, '[data-task-time]', '08:00')
  await setValue(contents, '#task-output', 'chat', 'change')
  await setValue(contents, '#task-notify', 'always', 'change')
  const preview = await waitFor(contents, `document.querySelectorAll('[data-task-preview-item]').length === 5`)
  const hint = await text(contents, '[data-form-field="Frequência"] p.text-12')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'tarefa-editar-light'))
  await clickSelector(contents, '[data-action="task-save"]')
  const dailyRow = await waitFor(contents, `document.querySelector('[data-task-row][data-task-name="Resumo diário do smoke"]')`)
  await clickSelector(contents, '[data-action="task-new"]')
  await waitFor(contents, `document.querySelector('[data-task-form]')`)
  await clickSelector(contents, '[data-task-suggestion="Pendências da reunião"]')
  await waitFor(contents, `document.querySelector('[data-task-frequency="after-meeting"]')`)
  await setValue(contents, '#task-output', 'file', 'change')
  await clickSelector(contents, '[data-action="task-save"]')
  const meetingRow = await waitFor(contents, `document.querySelector('[data-task-row][data-task-name="Pendências da reunião"]')`)
  const when = await text(contents, '[data-task-row][data-task-name="Resumo diário do smoke"] [data-task-when]')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'tarefas-light'))
  const tasksFile = readTaskFiles(ctx.userDataDir)
  const daily = tasksFile.find((task) => task.name === 'Resumo diário do smoke')
  checks['tasks'] = {
    ok: suggestions === 3 && preview && hint === 'Todo dia às 08:00' && dailyRow && meetingRow && when.startsWith('Todo dia às 08:00 · próxima: ') && daily?.nextRunAt !== null && tasksFile.length === 2 && mode(join(ctx.userDataDir, SCHEDULES_FILE)) === '600',
    detail: `sugestões=${suggestions}; prévia de 5=${preview}; frase "${hint}"; linhas=${dailyRow}/${meetingRow} "${when}"; schedules.json ${mode(join(ctx.userDataDir, SCHEDULES_FILE))} com ${tasksFile.length} tarefas`,
  }

  // O relógio do agendador avança até o horário da diária: roda, grava, cria a conversa e notifica.
  const imagesBefore = auto.trayImages.length
  auto.skewMs = Date.parse(daily?.nextRunAt ?? '') - Date.now() + 1_000
  await ctx.automations.tick()
  await automationsIdle(ctx)
  const dailyRuns = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === daily?.id)
  const chatOut = readChatFiles(ctx.userDataDir).find((chat) => chat.title === 'Tarefa: Resumo diário do smoke')
  const dailyNotice = auto.notifications.find((notice) => notice.title === 'Tarefa: Resumo diário do smoke')
  const trayDot = auto.trayImages.slice(imagesBefore).includes('running') && auto.trayImages.at(-1) === 'idle'
  checks['scheduled'] = {
    ok:
      dailyRuns.length === 1 &&
      dailyRuns[0]?.status === 'ok' &&
      dailyRuns[0].trigger === 'schedule' &&
      dailyRuns[0].outputResult === 'Conversa criada no Assistente' &&
      chatOut?.messages.length === 2 &&
      chatOut.messages[0]?.text.startsWith('Agora: ') === true &&
      dailyNotice !== undefined &&
      dailyNotice.runId === dailyRuns[0].id &&
      trayDot,
    detail: `execuções ${JSON.stringify(dailyRuns.map((run) => `${run.trigger}:${run.status}`))}; saída "${dailyRuns[0]?.outputResult}"; conversa ${chatOut ? `"${chatOut.title}" com ${chatOut.messages.length} mensagens` : 'ausente'}; notificação=${Boolean(dailyNotice)}; ícone com o ponto e de volta=${trayDot} ${JSON.stringify(auto.trayImages.slice(imagesBefore))}`,
  }

  // Depois de cada reunião: o fim de uma reunião dispara a tarefa, com a pasta só dela, e a saída vira um `.md`.
  const meeting = readMeetings(ctx.userDataDir)[0]
  const folder = (await invoke<{ path: string }>("window.__scribeApi.invoke('scribe:audio-folder')")).path
  const logBeforeMeeting = readAcpLog(ctx.userDataDir).length
  ctx.automations.meetingEnded(meeting?.id ?? '')
  await wait(300)
  await automationsIdle(ctx)
  const meetingTask = readTaskFiles(ctx.userDataDir).find((task) => task.name === 'Pendências da reunião')
  const meetingRuns = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === meetingTask?.id)
  const agentDir = join(folder, 'Agentes', 'Pendências da reunião')
  const mdFiles = existsSync(agentDir) ? readdirSync(agentDir).filter((name) => /^\d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(\d+\))?\.md$/.test(name)) : []
  const meetingSession = readAcpLog(ctx.userDataDir)
    .slice(logBeforeMeeting)
    .find((entry) => entry.method === 'session/new') as (AcpLogEntry & { cwd?: string }) | undefined
  // O mesmo fim de reunião de novo ("Tentar de novo"): não roda outra vez.
  ctx.automations.meetingEnded(meeting?.id ?? '')
  await wait(300)
  await ctx.automations.tick()
  await automationsIdle(ctx)
  const meetingRunsAgain = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === meetingTask?.id).length
  const meetingFolderOnly = typeof meetingSession?.cwd === 'string' && meetingSession.cwd.startsWith(join(ctx.userDataDir, CHAT_SCOPE_DIR)) && !existsSync(meetingSession.cwd)
  checks['afterMeeting'] = {
    ok: Boolean(meeting) && meetingRuns.length === 1 && meetingRunsAgain === 1 && meetingRuns[0]?.trigger === 'meeting' && meetingRuns[0].status === 'ok' && mdFiles.length === 1 && meetingFolderOnly && pendenciasId !== '',
    detail: `reunião ${meeting?.id ?? 'nenhuma'}; execuções ${JSON.stringify(meetingRuns.map((run) => `${run.trigger}:${run.status}:${run.outputResult}`))}; arquivos ${JSON.stringify(mdFiles)} em Agentes/Pendências da reunião; pasta só da reunião, apagada no fim=${meetingFolderOnly}; repetido sem rodar de novo=${meetingRunsAgain === 1}`,
  }

  // Uma por tarefa: "Rodar agora" de novo com a anterior rodando vira `skipped`. O menu do ícone, enquanto roda.
  const created = async (name: string, message: string): Promise<string> => {
    const result = await invoke<{ ok: boolean; task?: { id: string } }>(
      `window.__scribeApi.invoke('scribe:tasks-save', ${JSON.stringify({ id: null, name, agentId, message, schedule: { kind: 'daily', time: '23:00' }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: false, runOnce: false, runOnceAction: 'disable', timeoutS: 120, notify: 'on-error', output: null })})`,
    )
    return result.task?.id ?? ''
  }
  const slowId = await created('Lenta', 'Responda devagar, por favor.')
  const first = await invoke<{ ok: boolean }>(`window.__scribeApi.invoke('scribe:tasks-run-now', { id: ${JSON.stringify(slowId)} })`)
  await wait(300)
  const second = await invoke<{ ok: boolean; error?: string }>(`window.__scribeApi.invoke('scribe:tasks-run-now', { id: ${JSON.stringify(slowId)} })`)
  const runningIcon = ctx.tray()?.icon()
  // Contrato 50: o menu montado com o que é assíncrono (configurações, reuniões gravadas) lido agora.
  await ctx.tray()?.rebuild()
  const top = ctx.tray()?.template() ?? []
  const all = trayItems(top)
  const automationsMenu = top.find((item) => item.id === 'tray-automations-menu')
  const promptItem = top.find((item) => item.id === 'tray-meeting-prompt')
  const structure =
    top.some((item) => item.id === 'tray-recent' && Array.isArray(item.submenu)) &&
    Array.isArray(automationsMenu?.submenu) &&
    automationsMenu.submenu.some((item) => item.id === 'tray-pause') &&
    automationsMenu.submenu.some((item) => item.id === 'tray-automations') &&
    promptItem?.type === 'checkbox' &&
    promptItem.checked === (readSettings(ctx.userDataDir).meetingPrompt ?? DEFAULT_SETTINGS.meetingPrompt) &&
    all.some((item) => item.id === 'tray-event-none' || item.id === 'tray-event-0')
  const menu = trayLabels(ctx)
  // No relatório, sem os títulos da agenda e das reuniões gravadas (o relatório não leva dado da agenda).
  const reportLabels = (items: MenuItemConstructorOptions[]): string[] => items.filter((item) => !/^tray-(event|recent)-/.test(item.id ?? '')).map((item) => (item.type === 'separator' ? '—' : String(item.label ?? '')))
  const shownMenu = reportLabels(all)
  const nextLine = menu.find((label) => label.startsWith('Resumo diário do smoke · '))
  const pauseClicked = trayClick(ctx, 'tray-pause')
  await wait(200)
  const pausedMenu = trayLabels(ctx)
  const shownPaused = reportLabels(trayItems(ctx.tray()?.template() ?? []))
  trayClick(ctx, 'tray-pause')
  await wait(200)
  await automationsIdle(ctx)
  const slowRuns = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === slowId)
  checks['skipped'] = {
    ok: first.ok && !second.ok && second.error === 'busy' && slowRuns.filter((run) => run.status === 'ok').length === 1 && slowRuns.filter((run) => run.status === 'skipped').length === 1,
    detail: `primeira=${first.ok}; segunda ${JSON.stringify(second)}; execuções ${JSON.stringify(slowRuns.map((run) => `${run.status}:${run.error ?? ''}`))}`,
  }
  checks['tray'] = {
    ok:
      runningIcon === 'running' &&
      structure &&
      (menu[0] ?? '').startsWith('Abrir ') &&
      ['Nova gravação', 'Bloquear', 'Automações', 'Pausar todas as tarefas', 'Sair'].every((label) => menu.includes(label)) &&
      nextLine !== undefined &&
      pauseClicked &&
      pausedMenu.includes('Retomar') &&
      trayLabels(ctx).includes('Pausar todas as tarefas'),
    detail: `ícone rodando=${runningIcon}; estrutura do contrato 50=${structure} (ids ${JSON.stringify(all.map((item) => item.id).filter(Boolean))}); menu ${JSON.stringify(shownMenu)}; próxima "${nextLine ?? ''}"; pausado ${JSON.stringify(shownPaused)}`,
  }

  // 3 falhas seguidas: a tarefa pausa sozinha e avisa.
  const failId = await created('Falha', 'Por favor, falhe agora.')
  for (let i = 0; i < 3; i++) {
    await invoke(`window.__scribeApi.invoke('scribe:tasks-run-now', { id: ${JSON.stringify(failId)} })`)
    await automationsIdle(ctx)
  }
  const failTask = readTaskFiles(ctx.userDataDir).find((task) => task.id === failId)
  const failRuns = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === failId)
  const pauseNotice = auto.notifications.find((notice) => notice.title === 'Tarefa pausada: Falha')
  checks['autoPaused'] = {
    ok: failTask?.autoPaused === true && failTask.consecutiveFailures === 3 && failRuns.length === 3 && failRuns.every((run) => run.status === 'error') && pauseNotice !== undefined,
    detail: `tarefa ${JSON.stringify(failTask)}; execuções ${JSON.stringify(failRuns.map((run) => run.status))}; aviso=${Boolean(pauseNotice)}`,
  }

  // Horário perdido (Mac dormindo 3 h): uma tarefa a cada 5 min roda uma vez só; os outros horários viram um registro.
  const missedSave = await invoke<{ ok: boolean; task?: { id: string } }>(
    `window.__scribeApi.invoke('scribe:tasks-save', ${JSON.stringify({ id: null, name: 'Perdida', agentId, message: 'O que mudou?', schedule: { kind: 'every', minutes: 5 }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true, runOnce: false, runOnceAction: 'disable', timeoutS: 120, notify: 'never', output: null })})`,
  )
  const missedId = missedSave.task?.id ?? ''
  auto.skewMs += 3 * 60 * 60_000
  ctx.fixtures.lock.power.emit('resume')
  await wait(300)
  await automationsIdle(ctx)
  await ctx.automations.tick()
  await automationsIdle(ctx)
  const missedRuns = readRunFiles(ctx.userDataDir).filter((run) => run.taskId === missedId)
  const missedOk = missedRuns.filter((run) => run.status !== 'skipped')
  const missedSkipped = missedRuns.filter((run) => run.status === 'skipped')
  checks['missed'] = {
    ok: missedSave.ok && missedOk.length === 1 && missedOk[0]?.trigger === 'missed' && missedOk[0].status === 'ok' && missedSkipped.length === 1 && /horários perdidos/.test(missedSkipped[0]?.error ?? ''),
    detail: `rodaram ${JSON.stringify(missedOk.map((run) => `${run.trigger}:${run.status}`))}; pulados ${JSON.stringify(missedSkipped.map((run) => run.error))}`,
  }
  await invoke(`window.__scribeApi.invoke('scribe:tasks-toggle', { id: ${JSON.stringify(missedId)}, enabled: false })`)

  // "Pedir agora": um agente e um pedido, na hora; a execução entra em "Execuções".
  await setValue(contents, '#ask-now-agent', agentId, 'change')
  await setValue(contents, '#ask-now-text', 'Quais decisões tomamos?')
  await clickSelector(contents, '[data-action="ask-now"]')
  const asked = await waitFor(contents, `document.querySelector('[data-ask-now] [data-run-state="ok"] [data-chat-footer]')`, 30_000)
  const askRuns = readRunFiles(ctx.userDataDir).filter((run) => run.trigger === 'ask')
  checks['askNow'] = {
    ok: asked && askRuns.length === 1 && askRuns[0]?.status === 'ok' && (askRuns[0].answer?.text ?? '').length > 0,
    detail: `resposta na tela=${asked}; execuções "Pedir agora" ${JSON.stringify(askRuns.map((run) => run.status))}`,
  }

  await clickSelector(contents, '[data-action="ask-now-close"]')
  const askClosed = await waitFor(contents, `!document.querySelector('[data-ask-now] [data-run-answer]')`)

  // Execuções: a lista, os filtros e o detalhe com o pedido, o raciocínio, os passos e o rodapé.
  await clickSelector(contents, '#automations-tab-execucoes')
  const listed = await waitFor(contents, `document.querySelectorAll('[data-run-row]').length >= 8`)
  const rows = await invoke<number>(`document.querySelectorAll('[data-run-row]').length`)
  await setValue(contents, '#runs-status-filter', 'skipped', 'change')
  const filtered = await waitFor(contents, `[...document.querySelectorAll('[data-run-row]')].every((row) => row.dataset.runStatus === 'skipped') && document.querySelectorAll('[data-run-row]').length >= 2`)
  await setValue(contents, '#runs-status-filter', '', 'change')
  await waitFor(contents, `document.querySelectorAll('[data-run-row]').length === ${rows}`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'execucoes-light'))
  await clickSelector(contents, `[data-run-row][data-run-trigger="schedule"] [data-action="run-open"]`)
  const detail = await waitFor(contents, `document.querySelector('[data-run-detail] [data-run-state="ok"] [data-chat-footer]')`, 8000)
  const detailView = await invoke<{ prompt: string; steps: number; cost: string; output: string }>(
    `(() => { const box = document.querySelector('[data-run-detail]'); return { prompt: box?.querySelector('[data-chat-message="user"]')?.textContent ?? '', steps: box?.querySelector('[data-chat-reasoning]') ? 1 : 0, cost: box?.querySelector('[data-chat-cost]')?.textContent ?? '', output: box?.querySelector('[data-run-output]')?.textContent ?? '' } })()`,
  )
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'execucao-detalhe-light'))
  checks['runs'] = {
    ok: askClosed && listed && filtered && detail && detailView.prompt.startsWith('Agora: ') && detailView.prompt.includes('Resuma as reuniões de hoje.') && detailView.steps === 1 && detailView.cost.includes('US$') && detailView.output === 'Conversa criada no Assistente',
    detail: `"Pedir agora" fechado=${askClosed}; ${rows} linhas; filtro "Pulada"=${filtered}; detalhe=${detail} ${JSON.stringify(detailView)}`,
  }

  // Configurações › Geral: "Ao fechar a janela" e "Abrir ao entrar no Mac" (só registrado); › Claude: o limite diário.
  await clickSelector(contents, '[data-nav="configuracoes"]')
  await openSettingsTab(contents, 'geral')
  const closeRow = await waitFor(contents, `document.querySelector('[data-setting-name="Ao fechar a janela"] [data-close-behavior-option="tray"][aria-pressed="true"]')`)
  const loginBefore = auto.loginItems.length
  await clickSelector(contents, '[aria-labelledby="settings-open-at-login"]')
  await waitFor(contents, `document.querySelector('[aria-labelledby="settings-open-at-login"]')?.getAttribute('aria-checked') === 'true'`)
  await wait(200)
  await clickSelector(contents, '[aria-labelledby="settings-open-at-login"]')
  await wait(300)
  await openSettingsTab(contents, 'claude')
  const limitRow = await waitFor(contents, `document.querySelector('#settings-daily-limit')?.value === '50'`)
  const logins = auto.loginItems.slice(loginBefore)
  checks['settings'] = {
    ok: closeRow && limitRow && JSON.stringify(logins) === JSON.stringify([{ openAtLogin: true, openAsHidden: true }, { openAtLogin: false, openAsHidden: true }]) && readSettings(ctx.userDataDir).openAtLogin === false,
    detail: `"Ao fechar a janela" na barra de menus=${closeRow}; limite diário 50=${limitRow}; itens de login ${JSON.stringify(logins)}`,
  }

  // Fechar a janela mantém o app (Dock escondido) e o ícone reabre (Dock de volta).
  const dockBefore = { ...auto.dock }
  const closed = new Promise<void>((resolve) => win.once('closed', () => resolve()))
  win.close()
  await closed
  await wait(200)
  const hidden = auto.dock.hides === dockBefore.hides + 1 && BrowserWindow.getAllWindows().length === 0 && auto.quitRequests === 0
  const reopened = trayClick(ctx, 'tray-open')
  const reopenedWin = BrowserWindow.getAllWindows()[0]
  if (reopenedWin) {
    watch(reopenedWin)
    await loadAndWait(reopenedWin)
  }
  checks['closeKeepsApp'] = {
    ok: hidden && reopened && reopenedWin !== undefined && auto.dock.shows === dockBefore.shows + 1,
    detail: `fechada: Dock escondido=${hidden} (${dockBefore.hides}→${auto.dock.hides}), saídas pedidas=${auto.quitRequests}; reaberta pelo ícone=${reopened && reopenedWin !== undefined}, Dock ${dockBefore.shows}→${auto.dock.shows}`,
  }
  reopenedWin?.destroy()

  // Tema escuro.
  const dark = ctx.openWindow({ theme: 'dark' })
  watch(dark)
  await loadAndWait(dark)
  await clickSelector(dark.webContents, '[data-nav="automacoes"]')
  const darkCards = await waitFor(dark.webContents, `document.querySelectorAll('[data-agent-card]').length === 4`, 8000)
  await settle(dark.webContents)
  shots.push(await capture(dark, ctx.outDir, 'agentes-dark'))
  checks['dark'] = { ok: darkCards, detail: `cartões no escuro=${darkCards}` }
  dark.destroy()
  auto.skewMs = 0
}

/**
 * Portas do servidor do Meet no smoke: fora da faixa da extensão (47632–47641). Com o Chrome do Andrew aberto no Meet,
 * a extensão de verdade mandava nomes reais ao servidor do smoke e o resultado dependia disso.
 */
export const SMOKE_MEET_PORTS: readonly number[] = Array.from({ length: 10 }, (_, index) => 47652 + index)

/** POST de um cliente falso no servidor do Meet (contrato 27), fora da sessão do Electron. */
function meetPost(port: number, origin: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: MEET_PATH, headers: { origin, 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    // Porta fechada (servidor parado): vale como sem resposta.
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end(JSON.stringify(body))
  })
}

const MEET_MARKER = `(document.querySelector('[data-meet-marker]')?.textContent ?? '')`

/** O PNG do aviso de reunião (contrato 48): o único no tamanho da janela dele, não no de 1120×740. */
const MEETING_PROMPT_SHOT = 'aviso-reuniao-light'

/**
 * Contrato 27 (CA8), numa janela clara, sem PNG novo: o servidor local do Meet no ar numa das portas 47632–47641;
 * um cliente falso com origem `chrome-extension://abc` é aceito (`{ ok: true }`) e com `https://mau.example` é
 * recusado (404 sem corpo); numa gravação curta, "Meet conectado · 2 participantes" no cabeçalho e o evento "Ana
 * começou a falar" vira o nome do trecho do sistema no arquivo e no `.md` do acervo ("[mm:ss] Ana: …"); o do
 * microfone continua "Você". "Quem fala no Meet" desligado para o servidor e ligado sobe de novo, desconectado; a
 * gravação começa com "Meet desconectado" em vermelho e fica verde no primeiro envio (adendo 27c). Contrato 31: o clique
 * no marcador abre Configurações › Plugins.
 */
async function meetChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const body = (eventos: { nome: string; falando: boolean; ts: number }[]): unknown => ({ reuniao: 'smk-meet-abc', participantes: ['Ana', 'Bruno'], eventos })

  // Estado limpo antes de afirmar "desconectado": desligar e religar o interruptor reinicia o servidor e zera a
  // janela de 15 s de um envio anterior.
  const restartMeet = async (): Promise<{ stopped: boolean; restarted: boolean }> => {
    await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { meetSpeakers: false })`)
    let stopped = false
    for (let attempt = 0; attempt < 100 && !stopped; attempt++) {
      stopped = ctx.meet.port() === null
      if (!stopped) await wait(50)
    }
    await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { meetSpeakers: true })`)
    let restarted = false
    for (let attempt = 0; attempt < 100 && !restarted; attempt++) {
      restarted = ctx.meet.port() !== null
      if (!restarted) await wait(50)
    }
    return { stopped, restarted }
  }
  const fresh = await restartMeet()
  const freshDisconnected = !ctx.meet.status().connected

  // Servidor: aceita só a extensão; a página de fora recebe 404 sem corpo e nada muda.
  const port = ctx.meet.port()
  const inRange = port !== null && SMOKE_MEET_PORTS.includes(port) && !MEET_PORTS.includes(port)
  const refused = port === null ? { status: -1, body: '' } : await meetPost(port, 'https://mau.example', body([{ nome: 'Mau', falando: true, ts: Date.now() }]))
  const afterRefused = ctx.meet.status()
  const accepted = port === null ? { status: -1, body: '' } : await meetPost(port, 'chrome-extension://abc', body([]))
  const afterAccepted = ctx.meet.status()
  checks['server'] = {
    ok:
      fresh.restarted &&
      freshDisconnected &&
      inRange &&
      refused.status === 404 &&
      refused.body === '' &&
      !afterRefused.connected &&
      accepted.status === 200 &&
      accepted.body === '{"ok":true}' &&
      afterAccepted.connected &&
      JSON.stringify(afterAccepted.participants) === JSON.stringify(['Ana', 'Bruno']),
    detail: `estado limpo (reiniciado=${fresh.stopped && fresh.restarted}, desconectado=${freshDisconnected}); porta ${port ?? 'nenhuma'} na faixa do smoke=${inRange}; https://mau.example → ${refused.status} "${refused.body}", conectado=${afterRefused.connected}; chrome-extension://abc → ${accepted.status} ${accepted.body}, conectado=${afterAccepted.connected}, ${afterAccepted.participants.length} participante(s)`,
  }

  // "Quem fala no Meet" desligado: o servidor para e a porta fecha; ligado, sobe de novo (e desconectado: a gravação
  // abaixo começa com o marcador vermelho, adendo 27c).
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { meetSpeakers: false })`)
  let stopped = false
  for (let attempt = 0; attempt < 100 && !stopped; attempt++) {
    stopped = ctx.meet.port() === null
    if (!stopped) await wait(50)
  }
  const closed = port === null ? { status: -1, body: '' } : await meetPost(port, 'chrome-extension://abc', body([]))
  const disconnected = !ctx.meet.status().connected
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { meetSpeakers: true })`)
  let restarted = false
  for (let attempt = 0; attempt < 100 && !restarted; attempt++) {
    restarted = ctx.meet.port() !== null
    if (!restarted) await wait(50)
  }
  checks['setting'] = {
    ok: stopped && closed.status !== 200 && disconnected && restarted,
    detail: `desligado: servidor parado=${stopped}, POST → ${closed.status}, desconectado=${disconnected}; ligado de novo: no ar=${restarted} (porta ${ctx.meet.port() ?? 'nenhuma'})`,
  }

  // Gravação curta: o marcador vermelho antes do envio e verde depois (adendo 27c), e o nome no trecho do sistema.
  const livePort = ctx.meet.port()
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('[data-action="new-recording"]')`)
  await clickSelector(contents, '[data-action="new-recording"]')
  const live = await waitFor(contents, `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`)
  const markerOff = await waitFor(contents, `document.querySelector('[data-meet-marker="off"]') && ${MEET_MARKER} === ${JSON.stringify(MEET_DISCONNECTED_LABEL)}`)
  const markerOffText = await text(contents, '[data-meet-marker]')
  // Contrato 31 (CA4): o marcador leva à aba "Plugins"; a gravação continua e o smoke volta para ela.
  await clickSelector(contents, '[data-meet-marker]')
  const markerToPlugins = await waitFor(contents, `${routeIs('configuracoes')} && ${settingsTabIs('plugins')}`)
  contents.send('scribe:navigate', 'gravacao')
  const markerBack = await waitFor(contents, `${routeIs('gravacao')} && document.querySelector('[data-meet-marker="off"]')`)
  if (livePort !== null) await meetPost(livePort, 'chrome-extension://abc', body([{ nome: 'Ana', falando: true, ts: Date.now() }]))
  const marker = await waitFor(contents, `document.querySelector('[data-meet-marker="on"]') && ${MEET_MARKER} === 'Meet conectado · 2 participantes'`)
  const markerText = await text(contents, '[data-meet-marker]')
  const base = { speaker: null, translation: null, translationModel: null, partial: false, sessionId: 'smoke-meet', translationState: 'done' }
  const segments = [
    { ...base, id: 'smoke-meet-mic', source: 'mic', startMs: 0, endMs: 3000, text: 'Pode começar.', turnOrder: 0 },
    { ...base, id: 'smoke-meet-sys', source: 'system', startMs: 0, endMs: 3000, text: 'O cronograma fechou ontem.', turnOrder: 1 },
  ]
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(segments)})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 2`)
  // A fala de Ana fica aberta: o "Encerrar" fecha. A gravação passa de 3 s (o fim dos trechos).
  await wait(2000)
  const saved = await endCalendarRecording(contents, ctx, idsBefore)
  let transcript: TranscriptDocument | null = null
  for (let attempt = 0; attempt < 100 && !transcript; attempt++) {
    try {
      transcript = saved ? (JSON.parse(readFileSync(join(ctx.userDataDir, MEETINGS_DIR, `${saved.id}.json`), 'utf8')) as TranscriptDocument) : null
    } catch {
      await wait(50)
    }
  }
  const byId = Object.fromEntries((transcript?.segments ?? []).map((segment) => [segment.id, segment.names ?? null]))
  // O `.md` do acervo do chat (o mesmo formato do resumo): "[mm:ss] Ana: texto".
  const corpusDir = join(ctx.userDataDir, CHAT_CORPUS_DIR)
  let corpusMd = ''
  for (let attempt = 0; attempt < 100 && !corpusMd.includes('] Ana: '); attempt++) {
    const file = saved && existsSync(corpusDir) ? readdirSync(corpusDir).find((name) => name.endsWith(corpusFileSuffix(saved.id))) : undefined
    corpusMd = file ? readFileSync(join(corpusDir, file), 'utf8') : ''
    if (!corpusMd.includes('] Ana: ')) await wait(50)
  }
  const folderMd = saved?.transcriptPath && existsSync(saved.transcriptPath) ? readFileSync(saved.transcriptPath, 'utf8') : null
  // Aba "Transcrição" do detalhe (o resumo pode ter aberto a aba "Resumo").
  if (await waitFor(contents, `document.querySelector('[data-tab="transcricao"]')`, 5000)) await clickSelector(contents, '[data-tab="transcricao"]')
  const labelInDetail = await waitFor(contents, `[...document.querySelectorAll('[data-transcript-list] li .caps')].some((el) => el.textContent === 'Ana')`, 5000)
  checks['recording'] = {
    ok:
      live &&
      markerOff &&
      markerToPlugins &&
      markerBack &&
      marker &&
      Boolean(saved) &&
      JSON.stringify(byId['smoke-meet-sys']) === JSON.stringify(['Ana']) &&
      byId['smoke-meet-mic'] === null &&
      corpusMd.includes('] Ana: O cronograma fechou ontem.') &&
      corpusMd.includes('] Você: Pode começar.') &&
      (folderMd === null || folderMd.includes('**Ana** · ')) &&
      labelInDetail,
    detail: `gravando=${live}; antes do envio "${markerOffText}" vermelho=${markerOff}; clique no marcador -> Plugins=${markerToPlugins}, de volta=${markerBack}; depois "${markerText}" verde=${marker}; reunião salva=${Boolean(saved)}; nomes no arquivo: sistema=${JSON.stringify(byId['smoke-meet-sys'] ?? null)}, microfone=${JSON.stringify(byId['smoke-meet-mic'] ?? null)}; acervo com "Ana:"=${corpusMd.includes('] Ana: ')}; .md da pasta ${folderMd === null ? 'sem arquivo' : `com "**Ana**"=${folderMd.includes('**Ana** · ')}`}; "Ana" no detalhe=${labelInDetail}`,
  }

  win.destroy()
}

/**
 * Contrato 48 (aviso-reuniao), numa janela clara, com "Quem fala no Meet" ligado (como `meetChecks` deixa): um envio
 * de reunião nova abre a janela do aviso (invisível no smoke, sem foco, sempre na frente, 460×88) com o título da
 * página; outro envio da mesma reunião não abre outra, nem depois do "x"; "Começar a transcrever" fecha o aviso e
 * começa a gravação com o título da reunião, e durante ela outra reunião não avisa; sem título, "Reunião no Meet";
 * "Nunca perguntar" desliga "Avisar quando uma reunião começar" e, desligado, nada abre. Um PNG do aviso, no claro.
 */
/**
 * Clique que fecha a própria janela (os botões do aviso): o clique sai depois que o `executeJavaScript` responde, senão
 * a janela some no meio do pedido ("Render frame was disposed").
 */
async function clickThenClose(contents: WebContents, selector: string): Promise<boolean> {
  return evaluate<boolean>(contents, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; setTimeout(() => el.click(), 0); return true })()`)
}

async function meetingPromptChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const opened = ctx.fixtures.meetingPrompt.windows
  const before = opened.length
  const port = ctx.meet.port()
  const post = async (reuniao: string, titulo?: string): Promise<number> =>
    port === null ? -1 : (await meetPost(port, 'chrome-extension://abc', { reuniao, participantes: ['Ana', 'Bruno'], eventos: [], plataforma: 'meet', ...(titulo ? { titulo } : {}) })).status
  // A janela número `count` do aviso (contando desde o começo desta checagem), quando o app abrir.
  const nth = async (count: number): Promise<BrowserWindow | null> => {
    for (let attempt = 0; attempt < 100 && opened.length < before + count; attempt++) await wait(50)
    const prompt = opened[before + count - 1] ?? null
    if (prompt) watch(prompt)
    return prompt
  }
  const gone = async (prompt: BrowserWindow | null): Promise<boolean> => {
    for (let attempt = 0; attempt < 100 && prompt && !prompt.isDestroyed(); attempt++) await wait(50)
    return prompt !== null && prompt.isDestroyed()
  }
  const PROMPT_TITLE = `(document.querySelector('[data-meeting-prompt-title]')?.textContent ?? '')`

  // Reunião nova: o aviso abre, sem foco e na frente, com o título; a mesma reunião não abre outro, nem depois do "x".
  const posted = await post('smk-aviso-uma', 'Revisão do contrato')
  const first = await nth(1)
  const titled = first ? await waitFor(first.webContents, `${PROMPT_TITLE} === 'Revisão do contrato' && document.querySelector('[data-action="meeting-prompt-record"]')`, 8000) : false
  const bounds = first?.getBounds()
  const sized = bounds?.width === MEETING_PROMPT_SIZE.width && bounds.height === MEETING_PROMPT_SIZE.height
  const unfocused = first !== null && !first.isFocusable() && !first.isFocused() && first.isAlwaysOnTop()
  if (first) {
    await settle(first.webContents)
    shots.push(await capture(first, ctx.outDir, MEETING_PROMPT_SHOT))
  }
  await post('smk-aviso-uma', 'Revisão do contrato')
  await wait(300)
  const kept = opened.length === before + 1 && first !== null && !first.isDestroyed()
  if (first) await clickThenClose(first.webContents, '[data-action="meeting-prompt-close"]')
  const closedByX = await gone(first)
  await post('smk-aviso-uma', 'Revisão do contrato')
  await wait(300)
  const notAgain = opened.length === before + 1
  checks['meetingPrompt'] = {
    ok: posted === 200 && titled && sized && unfocused && kept && closedByX && notAgain,
    detail: `envio=${posted}; aviso aberto com "Revisão do contrato"=${titled}, ${bounds ? `${bounds.width}x${bounds.height}` : 'sem janela'}, sem foco e na frente=${unfocused}; mesma reunião não abre outro=${kept}; "x" fechou=${closedByX}; de novo a mesma reunião, nada=${notAgain}`,
  }

  // "Começar a transcrever": o aviso fecha e a gravação começa com o título; gravando, outra reunião não avisa.
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  await post('smk-aviso-duas', 'Planejamento do trimestre')
  const second = await nth(2)
  if (second && (await waitFor(second.webContents, `document.querySelector('[data-action="meeting-prompt-record"]')`, 8000))) await clickThenClose(second.webContents, '[data-action="meeting-prompt-record"]')
  const secondClosed = await gone(second)
  const recording = await waitFor(contents, `${routeIs('gravacao')} && ${probeJs('state()?.mic')} === 'live' && ${LIVE_TITLE} === 'Planejamento do trimestre'`, 8000)
  await post('smk-aviso-tres')
  await wait(300)
  const quietWhileRecording = opened.length === before + 2
  const saved = await endCalendarRecording(contents, ctx, idsBefore)
  checks['meetingPromptRecord'] = {
    ok: second !== null && secondClosed && recording && quietWhileRecording && saved?.title === 'Planejamento do trimestre',
    detail: `aviso da segunda reunião=${second !== null}, fechou no clique=${secondClosed}; gravando com o título da reunião=${recording}; outra reunião durante a gravação não avisou=${quietWhileRecording}; reunião salva como "${saved?.title ?? 'nenhuma'}"`,
  }

  // Sem título, "Reunião no Meet"; "Nunca perguntar" desliga a configuração e, desligada, nada abre.
  await post('smk-aviso-quatro')
  const third = await nth(3)
  const fallback = third ? await waitFor(third.webContents, `${PROMPT_TITLE} === 'Reunião no Meet'`, 8000) : false
  if (third) {
    await clickSelector(third.webContents, '[data-action="meeting-prompt-more"]')
    if (await waitFor(third.webContents, `document.querySelector('[data-action="meeting-prompt-never"]') && document.querySelector('[data-meeting-prompt-where]')`)) {
      await clickThenClose(third.webContents, '[data-action="meeting-prompt-never"]')
    }
  }
  const thirdClosed = await gone(third)
  let off = false
  for (let attempt = 0; attempt < 100 && !off; attempt++) {
    off = readSettings(ctx.userDataDir).meetingPrompt === false
    if (!off) await wait(50)
  }
  await post('smk-aviso-cinco')
  await wait(500)
  const quietWhenOff = opened.length === before + 3
  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { meetingPrompt: true })`)
  checks['meetingPromptNever'] = {
    ok: fallback && thirdClosed && off && quietWhenOff,
    detail: `sem título, "Reunião no Meet"=${fallback}; "Nunca perguntar" fechou=${thirdClosed} e desligou a configuração=${off}; desligada, reunião nova não abriu nada=${quietWhenOff}`,
  }

  win.destroy()
}

/**
 * Contrato 49 (aviso-reuniao), com o `lap-mic-watch` falso (test/fixtures/fake-mic-watch.mjs), que repete as linhas
 * que o smoke acrescenta no arquivo das fixtures: o microfone só do navegador não avisa; o do Zoom, depois de 3 s,
 * abre o aviso "Reunião no Zoom" (sem foco, sempre na frente); o Zoom desligar o microfone fecha o aviso.
 */
async function micWatchChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const opened = ctx.fixtures.meetingPrompt.windows
  const before = opened.length
  const line = (mic: boolean, apps: string[], names: Record<string, string> = {}): void => appendFileSync(ctx.fixtures.micWatch.file, `${JSON.stringify({ v: 1, mic, apps, names, camera: false })}\n`)
  // O observador subiu de novo quando `meetingPromptChecks` religou a configuração: espera o falso ler o arquivo.
  await wait(500)
  line(true, ['com.google.Chrome.helper'], { 'com.google.Chrome.helper': 'Google Chrome Helper' })
  await wait(MIC_PROMPT_MIN_MS + 800)
  const browserQuiet = opened.length === before
  line(true, ['com.google.Chrome.helper', 'us.zoom.xos'], { 'us.zoom.xos': 'zoom.us' })
  const startedAt = Date.now()
  for (let attempt = 0; attempt < 200 && opened.length === before; attempt++) await wait(50)
  const elapsed = Date.now() - startedAt
  const prompt = opened[before] ?? null
  if (prompt) watch(prompt)
  const titled = prompt ? await waitFor(prompt.webContents, `(document.querySelector('[data-meeting-prompt-title]')?.textContent ?? '') === 'Reunião no Zoom'`, 8000) : false
  const unfocused = prompt !== null && !prompt.isFocusable() && !prompt.isFocused() && prompt.isAlwaysOnTop()
  const single = opened.length === before + 1
  line(false, [])
  for (let attempt = 0; attempt < 100 && prompt && !prompt.isDestroyed(); attempt++) await wait(50)
  const closedWhenOff = prompt !== null && prompt.isDestroyed()
  // Fechado o aviso do Zoom, a última reunião da extensão (a que `meetingPromptChecks` mandou com o aviso desligado)
  // pode avisar agora, se a extensão ainda constar como conectada: esse aviso não é desta checagem e fecha aqui.
  await wait(300)
  for (const extra of opened.slice(before + 1)) if (!extra.isDestroyed()) extra.destroy()
  checks['micWatch'] = {
    ok: browserQuiet && prompt !== null && elapsed >= MIC_PROMPT_MIN_MS - 500 && titled && unfocused && single && closedWhenOff,
    detail: `só o navegador com o microfone, nada abriu=${browserQuiet}; Zoom: aviso aberto=${prompt !== null} depois de ${elapsed} ms, "Reunião no Zoom"=${titled}, sem foco e na frente=${unfocused}, um aviso só=${single}; Zoom desligou o microfone, o aviso fechou=${closedWhenOff}`,
  }
}

/** Títulos que `test/fixtures/fake-ai-notes.mjs` cria no primeiro e no segundo ciclo (contrato 30). */
const AI_NOTES_FIRST_TITLE = 'Confirmar a janela de manutenção'
const AI_NOTES_SECOND_TITLE = 'Quem aprova o orçamento da réplica'
const AI_CARD = (title: string): string => `[...document.querySelectorAll('[data-notes-panel] [data-note-origin="ia"]')].find((card) => card.querySelector('[data-note-title]')?.value === ${JSON.stringify(title)})`

/**
 * Contrato 30, CA6, numa janela clara e numa gravação à parte (as anotações da gravação principal ficam como o
 * contrato 13 confere): desligado (o padrão), o ciclo não roda; ligado "IA anotando", um ciclo (chamado direto, sem
 * esperar os 5 min) mostra "anotando…" e traz o card da IA com título; o segundo, com fala nova, resolve esse card
 * com o motivo e cria outro; o filtro "Resolvidas" mostra só o resolvido. Depois de "Encerrar": o `notes.json` com os
 * cards da IA; no detalhe, o quadro; arrastar um card (pointer events de verdade) grava a posição, que continua
 * depois de recarregar a tela; e o filtro do detalhe.
 */
async function aiNotesChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const idsBefore = new Set(readMeetings(ctx.userDataDir).map((meeting) => meeting.id))
  const defaultOff = DEFAULT_SETTINGS.liveCards === false && readSettings(ctx.userDataDir).liveCards !== true

  await clickSelector(contents, '[data-nav="reunioes"]')
  await waitFor(contents, `${routeIs('reunioes')} && document.querySelector('[data-action="new-recording"]')`)
  await clickSelector(contents, '[data-action="new-recording"]')
  const live = await waitFor(contents, `${probeJs('state()?.mic')} === 'live' && ${probeJs('state()?.system')} === 'live'`)
  const base = { speaker: null, translation: null, translationModel: null, partial: false, sessionId: 'smoke-ia', translationState: 'done' }
  const first = [
    { ...base, id: 'smoke-ia-1', source: 'mic', startMs: 0, endMs: 4000, text: 'Precisamos confirmar a janela de manutenção com o cliente antes de sexta, senão a migração do banco escorrega para o mês que vem.', turnOrder: 0 },
    { ...base, id: 'smoke-ia-2', source: 'system', speaker: 'A', startMs: 4000, endMs: 9000, text: 'Eu falo com o cliente hoje, mas ainda não sei quem aprova o orçamento da réplica nem se o plano de volta vai por escrito.', turnOrder: 1 },
  ]
  const second = [
    { ...base, id: 'smoke-ia-3', source: 'system', speaker: 'A', startMs: 9000, endMs: 14000, text: 'Falei com o cliente agora há pouco: a janela de manutenção ficou confirmada para sábado às dez da noite, com duas horas de folga.', turnOrder: 2 },
    { ...base, id: 'smoke-ia-4', source: 'mic', startMs: 14000, endMs: 18000, text: 'Ótimo, então a janela está fechada. Fica faltando só descobrir quem aprova o orçamento da réplica antes da reunião de quinta.', turnOrder: 3 },
  ]
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify(first)})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 2`)
  await clickSelector(contents, '[data-action="toggle-notes"]')
  await waitFor(contents, `document.querySelector('[data-notes-panel] [data-action="ai-notes"]')`)
  const switchOff = await evaluate<boolean>(contents, `document.querySelector('[data-action="ai-notes"]')?.getAttribute('aria-checked') === 'false'`)
  const offResult = await evaluate<string>(contents, `window.__smokeProbe.aiNotesCycle()`)
  const spawnsBefore = ctx.fixtures.claudeSpawns.length
  await clickSelector(contents, '[data-action="ai-notes"]')
  const switchOn = await waitFor(contents, `document.querySelector('[data-action="ai-notes"]')?.getAttribute('aria-checked') === 'true'`)
  // O ciclo fica rodando na página; a tela mostra "anotando…" até o lote chegar.
  await evaluate(contents, `(window.__smokeAiCycle = window.__smokeProbe.aiNotesCycle(), true)`)
  const busy = await waitFor(contents, `document.querySelector('[data-ai-notes-busy]')?.textContent === 'anotando…'`, 3000)
  const firstRan = await evaluate<string>(contents, 'window.__smokeAiCycle')
  const created = await waitFor(contents, `Boolean(${AI_CARD(AI_NOTES_FIRST_TITLE)})`, 5000)
  const firstCard = await evaluate<{ id: string; color: string; status: string; badge: boolean; text: string; busyGone: boolean }>(
    contents,
    `(() => { const card = ${AI_CARD(AI_NOTES_FIRST_TITLE)}; return { id: card?.dataset.note ?? '', color: card?.dataset.color ?? '', status: card?.dataset.noteStatus ?? '', badge: Boolean(card?.querySelector('[data-note-ai]')), text: card?.querySelector('[data-note-text]')?.value ?? '', busyGone: !document.querySelector('[data-ai-notes-busy]') } })()`,
  )
  // Segundo ciclo, com fala nova: o card aberto da IA é resolvido com o motivo e outro chega.
  await evaluate(contents, `window.__smokeProbe.replay(${JSON.stringify([...first, ...second])})`)
  await waitFor(contents, `document.querySelectorAll('[data-transcript-list] li').length === 4`)
  const secondRan = await evaluate<string>(contents, `window.__smokeProbe.aiNotesCycle()`)
  const resolved = await waitFor(contents, `${AI_CARD(AI_NOTES_FIRST_TITLE)}?.dataset.noteStatus === 'resolvida' && Boolean(${AI_CARD(AI_NOTES_SECOND_TITLE)})`, 5000)
  const reason = await evaluate<string>(contents, `${AI_CARD(AI_NOTES_FIRST_TITLE)}?.querySelector('[data-note-resolution]')?.textContent ?? ''`)
  const aiSpawns = ctx.fixtures.claudeSpawns.slice(spawnsBefore).filter((item) => (item.args[item.args.indexOf('--system-prompt') + 1] ?? '').startsWith('Você anota')).length
  const aiAcp = readAcpLog(ctx.userDataDir).filter((entry) => entry.method === 'session/new' && entry.purpose === 'ai-notes').length
  // Filtro do painel: "Resolvidas" mostra só o resolvido; "Todas" volta os dois.
  await clickSelector(contents, '[data-notes-panel] [data-notes-filter-option="resolvidas"]')
  const panelResolved = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 1 && document.querySelector('[data-notes-panel] [data-note]')?.dataset.noteStatus === 'resolvida'`)
  await clickSelector(contents, '[data-notes-panel] [data-notes-filter-option="todas"]')
  const panelAll = await waitFor(contents, `document.querySelectorAll('[data-notes-panel] [data-note]').length === 2`)
  checks['aiNotesLive'] = {
    ok:
      defaultOff &&
      live &&
      switchOff &&
      offResult === 'off' &&
      switchOn &&
      busy &&
      firstRan === 'ran' &&
      created &&
      firstCard.color === 'blue' &&
      firstCard.status === 'aberta' &&
      firstCard.badge &&
      firstCard.text.startsWith('Fala de Você:') &&
      firstCard.busyGone &&
      secondRan === 'ran' &&
      resolved &&
      reason.startsWith('Resolvida — Respondido:') &&
      aiSpawns + aiAcp === 2 &&
      panelResolved &&
      panelAll,
    detail: `padrão desligado=${defaultOff}; interruptor desligado=${switchOff}, ciclo "${offResult}"; ligado=${switchOn}; "anotando…"=${busy}; 1º ciclo "${firstRan}", card ${JSON.stringify(firstCard)}; 2º ciclo "${secondRan}", resolvido=${resolved} "${reason}"; chamadas à IA ${aiSpawns} CLI + ${aiAcp} ACP; filtro Resolvidas=${panelResolved}, Todas=${panelAll}`,
  }

  // "Encerrar": os cards da IA vão para o `notes.json` com o estado e o motivo.
  const saved = await endCalendarRecording(contents, ctx, idsBefore)
  const fileNotes = (): MeetingNote[] => readNotesFile(ctx.userDataDir, saved?.id)?.notes ?? []
  const waitFile = async (predicate: (notes: MeetingNote[]) => boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (predicate(fileNotes())) return true
      await wait(50)
    }
    return false
  }
  const fileOk = await waitFile(
    (notes) =>
      notes.length === 2 &&
      notes.every((note) => note.origin === 'ia' && note.color === 'blue' && typeof note.atMs === 'number') &&
      notes.some((note) => note.title === AI_NOTES_FIRST_TITLE && note.status === 'resolvida' && note.resolution?.by === 'ia' && note.resolution.reason.startsWith('Respondido:')) &&
      notes.some((note) => note.title === AI_NOTES_SECOND_TITLE && note.status === 'aberta'),
  )

  // Detalhe: o quadro, com a mesma ordem da lista (as abas aparecem quando a reunião carrega).
  if (await waitFor(contents, `document.querySelector('[data-tab="anotacoes"]')`, 8000)) await clickSelector(contents, '[data-tab="anotacoes"]')
  const canvas = await waitFor(contents, `document.querySelectorAll('[data-notes-canvas] [data-note]').length === 2`)
  const order = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-notes-canvas] > li [data-note]')].map((card) => card.dataset.note)`)
  const orderOk = JSON.stringify(order) === JSON.stringify(fileNotes().map((note) => note.id))
  const tilts = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-notes-canvas] > li')].map((li) => li.style.getPropertyValue('--note-tilt'))`)
  // Arrastar o card aberto pelo papel (o vão ao lado das cores), com eventos de ponteiro de verdade.
  const dragId = fileNotes().find((note) => note.status !== 'resolvida')?.id ?? ''
  const grip = await evaluate<{ x: number; y: number } | null>(
    contents,
    `(() => { const group = document.querySelector('[data-notes-canvas] [data-note="${dragId}"] [role="group"]'); const box = group?.getBoundingClientRect(); return box ? { x: Math.round(box.right + 18), y: Math.round(box.top + box.height / 2) } : null })()`,
  )
  if (grip) {
    contents.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y })
    contents.sendInputEvent({ type: 'mouseDown', x: grip.x, y: grip.y, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 8; step++) {
      contents.sendInputEvent({ type: 'mouseMove', x: grip.x + step * 40, y: grip.y + step * 25, modifiers: ['leftbuttondown'] })
      await wait(30)
    }
    contents.sendInputEvent({ type: 'mouseUp', x: grip.x + 320, y: grip.y + 200, button: 'left', clickCount: 1 })
  }
  const moved = await waitFile((notes) => {
    const position = notes.find((note) => note.id === dragId)?.position
    return Boolean(position && position.x > 0 && position.y > 0)
  })
  const position = fileNotes().find((note) => note.id === dragId)?.position ?? null
  const placed = await waitFor(contents, `document.querySelector('[data-notes-canvas] > li[data-note-item="${dragId}"]')?.hasAttribute('data-placed') === true`)
  // Recarregar a janela e voltar à reunião pela lista: a posição vem do disco.
  contents.reload()
  await loadAndWait(win)
  if (!(await waitFor(contents, routeIs('detalhe'), 3000))) {
    await clickSelector(contents, '[data-nav="reunioes"]')
    if (await waitFor(contents, `document.querySelector('main a[data-meeting="${saved?.id ?? ''}"]')`, 8000)) await clickSelector(contents, `main a[data-meeting="${saved?.id ?? ''}"]`)
    await waitFor(contents, routeIs('detalhe'), 8000)
  }
  if (await waitFor(contents, `document.querySelector('[data-tab="anotacoes"]')`, 5000)) await clickSelector(contents, '[data-tab="anotacoes"]')
  const reloaded = await waitFor(
    contents,
    `(() => { const li = document.querySelector('[data-notes-canvas] > li[data-note-item="${dragId}"]'); return Boolean(li?.hasAttribute('data-placed') && parseFloat(li.style.getPropertyValue('--note-x')) > 0) })()`,
    8000,
  )
  // Filtro do detalhe: "Resolvidas" mostra só o resolvido.
  if (await waitFor(contents, `document.querySelector('[data-notes-tab] [data-notes-filter-option="resolvidas"]')`, 5000)) await clickSelector(contents, '[data-notes-tab] [data-notes-filter-option="resolvidas"]')
  const detailFilter = await waitFor(contents, `document.querySelectorAll('[data-notes-canvas] [data-note]').length === 1 && document.querySelector('[data-notes-canvas] [data-note]')?.dataset.noteStatus === 'resolvida' && document.querySelector('[data-notes-canvas] [data-note-resolution]')`)
  const counts = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-notes-tab] [data-notes-filter-option]')].map((b) => b.textContent)`)
  checks['notesCanvas'] = {
    ok: Boolean(saved) && fileOk && canvas && orderOk && tilts.length === 2 && tilts.every((tilt) => /^-?\d+(\.\d+)?deg$/.test(tilt)) && moved && placed && reloaded,
    detail: `reunião salva=${Boolean(saved)}; notes.json com os cards da IA=${fileOk} ${JSON.stringify(fileNotes().map((note) => [note.title, note.status, note.resolution?.reason ?? null, note.position ?? null]))}; quadro=${canvas}, ordem da lista=${orderOk}; rotações ${JSON.stringify(tilts)}; arrastado de ${JSON.stringify(grip)} -> posição ${JSON.stringify(position)} gravada=${moved}, solto no quadro=${placed}; depois de recarregar=${reloaded}`,
  }
  checks['notesFilter'] = {
    ok: panelResolved && panelAll && detailFilter && JSON.stringify(counts) === JSON.stringify(['Abertas1', 'Resolvidas1', 'Todas2']),
    detail: `painel: Resolvidas=${panelResolved}, Todas=${panelAll}; detalhe: Resolvidas=${detailFilter}; opções ${JSON.stringify(counts)}`,
  }

  win.destroy()
}

// ---------------------------------------------------------------------------------------------------------
// Contrato 43: as telas de email com o servidor falso em memória (`email/fake-email.ts`; domínios `.example`).

const EMAIL_INBOX_LINK = '[data-email-folder="inbox"]'
const EMAIL_SENT_LINK = '[data-email-folder="sent"]'
const EMAIL_ROWS = `document.querySelectorAll('[data-email-list] [data-email-message]')`
const EMAIL_UNREAD = `(document.querySelector('[data-email-unread-count]')?.firstChild?.textContent ?? '')`
const emailRow = (subject: string): string => `[...${EMAIL_ROWS}].find((el) => el.querySelector('[data-email-row-subject]')?.textContent === ${JSON.stringify(subject)})`
const EMAIL_HTML_SUBJECT = 'Proposta revisada do projeto de integração'

async function clickEmailRow(contents: WebContents, subject: string): Promise<boolean> {
  if (!(await waitFor(contents, emailRow(subject)))) return false
  await evaluate(contents, `${emailRow(subject)}.click(), true`)
  return waitFor(contents, `document.querySelector('[data-email-reading] [data-email-subject]')?.textContent === ${JSON.stringify(subject)}`)
}

/** Abre a Caixa de Entrada (ou Enviados) pela barra lateral e espera a lista. */
async function openEmailFolder(contents: WebContents, folder: 'inbox' | 'sent', rows = 1): Promise<boolean> {
  const link = folder === 'inbox' ? EMAIL_INBOX_LINK : EMAIL_SENT_LINK
  await waitFor(contents, `document.querySelector('${link}')`, 8000)
  await clickSelector(contents, link)
  return waitFor(contents, `${routeIs('email')} && document.querySelector('[data-email-folder-view="${folder}"]') && ${EMAIL_ROWS}.length >= ${rows}`, 8000)
}

/**
 * Contrato 43 (CA1, CA2, CA3, CA5 e CA6), numa janela clara e depois numa escura: a conta adicionada em Configurações ›
 * Contas › Email (a dica do Gmail, o autoconfig sem rede caindo no manual, "Testar conexão" com a senha recusada e com
 * a certa, "Adicionar conta"); a conta na barra lateral com as pastas e as não lidas; a lista em duas colunas com as
 * prévias; a leitura do HTML sanitizado (sem script, iframe, form nem `on*`), a imagem remota só depois de "Carregar
 * imagens" e o link pela confirmação; Responder com o "Re:", a citação e um anexo, enviado sem diálogo e mostrado em
 * Enviados; o erro do SMTP mantendo o rascunho; a conta recolhida gravada nas configurações; apagar; e remover uma
 * conta com problema pela confirmação.
 */
async function emailChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const fake = ctx.fixtures.email
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents

  // Configurações › Contas › Email: adicionar em dois passos.
  await openSettingsTab(contents, 'contas')
  await scrollToSection(contents, 'Email')
  const navHidden = await evaluate<boolean>(contents, `!document.querySelector('[data-email-nav]')`)
  await clickSelector(contents, '[data-action="email-add-account"]')
  await waitFor(contents, `document.querySelector('[data-email-add-panel="credentials"]')`)
  await setValue(contents, '#email-add-address', 'fulano@gmail.com')
  const gmailHint = await waitFor(contents, `document.querySelector('[data-notice="email-gmail-hint"]')?.textContent.includes('senha de app')`)
  await setValue(contents, '#email-add-address', SMOKE_EMAIL_ADDRESS)
  const hintGone = await waitFor(contents, `!document.querySelector('[data-notice="email-gmail-hint"]')`)
  await setValue(contents, '#email-add-password', SMOKE_EMAIL_WRONG_PASSWORD)
  await clickSelector(contents, '[data-action="email-add-next"]')
  const manual = await waitFor(contents, `document.querySelector('[data-email-autoconfig="manual"]') && document.querySelector('[data-email-advanced]') && document.querySelector('#email-add-in-host')?.value === 'imap.lap.example'`)
  await clickSelector(contents, '[data-action="email-test"]')
  const testRefused = await waitFor(contents, `document.querySelector('[data-notice="email-test-error"]')?.textContent.includes('Recebimento: Usuário ou senha recusados.')`, 8000)
  await setValue(contents, '#email-add-password', SMOKE_EMAIL_PASSWORD)
  await setValue(contents, '#email-add-name', 'Andrew Teste')
  await clickSelector(contents, '[data-action="email-test"]')
  const testOk = await waitFor(contents, `document.querySelector('[data-notice="email-test-ok"]')`, 8000)
  await clickSelector(contents, '[data-action="email-add-confirm"]')
  const added = await waitFor(contents, `document.querySelector('[data-email-settings-state="connected"]') && !document.querySelector('[data-email-add-panel]')`, 8000)
  const line = await text(contents, '[data-email-settings-line]')
  const accountId = await evaluate<string>(contents, `document.querySelector('[data-email-settings-account]')?.dataset.emailSettingsAccount ?? ''`)
  checks['settings'] = {
    ok: navHidden && gmailHint && hintGone && manual && testRefused && testOk && added && line === 'IMAP · Conectada' && accountId !== '',
    detail: `sem conta, nada na barra=${navHidden}; dica do Gmail=${gmailHint} (some em outro domínio=${hintGone}); sem autoconfig cai no manual=${manual}; teste com a senha recusada=${testRefused}; teste ok=${testOk}; adicionada=${added} "${line}"`,
  }

  // Barra lateral: a conta pelo nome, as pastas e as não lidas; a lista em duas colunas.
  const sidebar = await waitFor(contents, `document.querySelector('[data-email-account-toggle]')?.textContent.includes('Andrew Teste') && document.querySelector('${EMAIL_INBOX_LINK}') && document.querySelector('${EMAIL_SENT_LINK}') && ${EMAIL_UNREAD} === '2'`, 8000)
  const navOrder = await evaluate<string[]>(contents, `[...document.querySelectorAll('aside nav[aria-label="Navegação principal"] [data-nav]')].map((el) => el.dataset.nav)`)
  const listed = await openEmailFolder(contents, 'inbox', 4)
  const previews = await waitFor(contents, `[...${EMAIL_ROWS}].every((el) => el.querySelector('[data-email-row-preview]')?.textContent.trim().length > 3)`, 8000)
  const rows = await evaluate<{ from: string; unread: string; dot: boolean }[]>(contents, `[...${EMAIL_ROWS}].map((el) => ({ from: el.querySelector('[data-email-row-from]')?.textContent ?? '', unread: el.dataset.emailUnread, dot: Boolean(el.querySelector('[data-email-unread-dot]')) }))`)
  const groups = await evaluate<string[]>(contents, `[...document.querySelectorAll('[data-email-group]')].map((el) => el.dataset.emailGroup)`)
  const newButton = await evaluate<boolean>(contents, `Boolean(document.querySelector('[data-email-list]')?.closest('aside')?.querySelector('[data-action="email-new"]'))`)
  // O print "email": a barra lateral, a lista e uma mensagem já lida aberta (as não lidas continuam 2).
  const firstRead = await clickEmailRow(contents, 'Re: Agenda da apresentação')
  await waitFor(contents, `document.querySelector('[data-email-body="text"]')`, 8000)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'email-light'))
  checks['list'] = {
    ok:
      sidebar &&
      JSON.stringify(navOrder) === JSON.stringify(['reunioes', 'assistente', 'automacoes', 'whatsapp', 'configuracoes']) &&
      listed &&
      previews &&
      rows.length === 4 &&
      rows[0]?.from === 'Marina Rocha' &&
      rows.filter((row) => row.unread === 'true' && row.dot).length === 2 &&
      groups[0] === 'Hoje' &&
      newButton &&
      firstRead,
    detail: `barra lateral com a conta, as pastas e 2 não lidas=${sidebar}; itens de sempre ${JSON.stringify(navOrder)}; lista=${listed} com prévias=${previews}; linhas ${JSON.stringify(rows)}; grupos ${JSON.stringify(groups)}; "Nova mensagem" no topo=${newButton}`,
  }

  // Leitura: o HTML sanitizado, a imagem só com o clique e o link pela confirmação.
  const opened = await clickEmailRow(contents, EMAIL_HTML_SUBJECT)
  const bodyShown = await waitFor(contents, `document.querySelector('[data-email-body="html"]')?.textContent.includes('proposta revisada')`, 8000)
  const reading = await evaluate<{ html: string; xss: boolean; blocked: boolean; img: number; cc: string; from: string; actions: string[]; oneLine: boolean }>(
    contents,
    `(() => {
      const body = document.querySelector('[data-email-body="html"]')
      return {
        html: body?.innerHTML ?? '',
        xss: window.__emailXss === true,
        blocked: Boolean(document.querySelector('[data-notice="email-images-blocked"]')) && Boolean(body?.querySelector('[data-email-image-blocked]')),
        img: body?.querySelectorAll('img').length ?? -1,
        cc: document.querySelector('[data-email-cc]')?.textContent ?? '',
        from: document.querySelector('[data-email-from]')?.textContent ?? '',
        actions: [...document.querySelectorAll('[data-email-actions] [data-action^="email-"]:not([data-action="email-back"])')].map((el) => el.getAttribute('aria-label') || el.textContent.trim()),
        // CA7: na janela padrão, todas as ações na mesma linha e nada cortado.
        oneLine: (() => {
          const bar = document.querySelector('[data-email-actions]')
          const tops = [...bar.querySelectorAll('[data-action^="email-"]:not([data-action="email-back"])')].map((el) => Math.round(el.getBoundingClientRect().top))
          const right = Math.max(...[...bar.querySelectorAll('[data-action^="email-"]:not([data-action="email-back"])')].map((el) => el.getBoundingClientRect().right))
          return new Set(tops).size === 1 && bar.scrollWidth <= bar.clientWidth && right <= bar.getBoundingClientRect().right
        })(),
      }
    })()`,
  )
  const markedRead = await waitFor(contents, `${EMAIL_UNREAD} === '1'`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'email-leitura-light'))
  const requestsBefore = fake.imageRequests.length
  await clickSelector(contents, '[data-action="email-load-images"]')
  const imageLoaded = await waitFor(contents, `document.querySelector('[data-email-body="html"] img')?.src.startsWith('data:image/png;base64,')`, 8000)
  await evaluate(contents, `document.querySelector('[data-email-body="html"] a[data-email-link]')?.click(), true`)
  const asked = await waitFor(contents, `document.querySelector('[data-notice="email-external-link"]')?.textContent.includes('https://portal.cliente.example/proposta')`)
  const openedBefore = ctx.fixtures.openedUrls.length
  await clickSelector(contents, '[data-action="email-open-link"]')
  await wait(200)
  const linkOpened = ctx.fixtures.openedUrls.slice(openedBefore).includes('https://portal.cliente.example/proposta')
  const dangerous = /<script|<iframe|<form|<input|<style|onclick|onerror|javascript:/i.test(reading.html)
  checks['reading'] = {
    ok:
      opened &&
      bodyShown &&
      !dangerous &&
      !reading.xss &&
      reading.blocked &&
      reading.img === 0 &&
      requestsBefore === 0 &&
      imageLoaded &&
      fake.imageRequests.length === 1 &&
      asked &&
      linkOpened &&
      reading.from === 'Marina Rocha' &&
      reading.cc.includes('paulo.nunes@cliente.example') &&
      JSON.stringify(reading.actions) === JSON.stringify(['Responder', 'Responder a todos', 'Encaminhar', 'Marcar como não lida', 'Apagar']) &&
      reading.oneLine &&
      markedRead,
    detail: `aberta=${opened}, corpo=${bodyShown}; marcas perigosas no HTML=${dangerous}, script rodou=${reading.xss}; imagem bloqueada=${reading.blocked} (${reading.img} img, ${requestsBefore} pedidos antes do clique); "Carregar imagens"=${imageLoaded} (${fake.imageRequests.length} pedido); link pela confirmação=${asked}, aberto no navegador=${linkOpened}; de "${reading.from}", Cc com o Paulo=${reading.cc.includes('paulo.nunes@cliente.example')}; ações ${JSON.stringify(reading.actions)} numa linha=${reading.oneLine}; lida ao abrir=${markedRead}`,
  }

  // Responder: "Re:", a citação e um anexo local; Enviar sem diálogo, e a mensagem em Enviados.
  await clickSelector(contents, '[data-action="email-reply"]')
  const composer = await waitFor(contents, `document.querySelector('[data-email-composer="reply"]')`)
  const prefilled = await evaluate<{ to: string[]; subject: string; quoted: boolean }>(
    contents,
    `({ to: [...document.querySelectorAll('[data-email-recipients="to"] [data-email-chip]')].map((el) => el.dataset.emailChip), subject: document.querySelector('#email-compose-subject')?.value ?? '', quoted: (document.querySelector('#email-compose-text')?.value ?? '').includes('Marina Rocha <marina.rocha@cliente.example> escreveu:\\n> ') })`,
  )
  const attachmentFile = join(ctx.userDataDir, 'cronograma.txt')
  writeFileSync(attachmentFile, 'Fase 1: levantamento\nFase 2: integração\n')
  ctx.fixtures.chosenEmailAttachments = [attachmentFile]
  await clickSelector(contents, '[data-action="email-attach"]')
  const attached = await waitFor(contents, `document.querySelector('[data-email-compose-attachments]')?.textContent.includes('cronograma.txt')`)
  const quote = await evaluate<string>(contents, `document.querySelector('#email-compose-text')?.value ?? ''`)
  await setValue(contents, '#email-compose-text', `Obrigado, Marina. Fechado.${quote}`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'email-composer-light'))
  await clickSelector(contents, '[data-action="email-send"]')
  const toSent = await waitFor(
    contents,
    `${routeIs('email')} && document.querySelector('[data-email-folder-view="sent"]') && !document.querySelector('[data-email-composer]') && document.querySelector('[data-email-reading] [data-email-subject]')?.textContent === ${JSON.stringify(`Re: ${EMAIL_HTML_SUBJECT}`)}`,
    8000,
  )
  const delivered = fake.sent[0]
  const sentOk =
    delivered?.to.join() === 'marina.rocha@cliente.example' &&
    delivered.subject === `Re: ${EMAIL_HTML_SUBJECT}` &&
    /^<smoke-\d+@cliente\.example>$/.test(delivered.inReplyTo ?? '') &&
    delivered.text.startsWith('Obrigado, Marina. Fechado.') &&
    delivered.attachments.length === 1 &&
    delivered.attachments[0]?.name === 'cronograma.txt' &&
    fake.appended === 1

  // Erro do SMTP: o rascunho fica, com o aviso.
  await clickSelector(contents, '[data-action="email-new"]')
  await waitFor(contents, `document.querySelector('[data-email-composer="new"]')`)
  await setValue(contents, '#email-compose-to', 'cliente@parceiro.example,')
  await setValue(contents, '#email-compose-subject', 'Envio que falha')
  fake.failNextSend = true
  await clickSelector(contents, '[data-action="email-send"]')
  const keptDraft = await waitFor(
    contents,
    `document.querySelector('[data-notice="email-send-error"]')?.textContent.includes('recusou') && document.querySelector('#email-compose-subject')?.value === 'Envio que falha' && document.querySelector('[data-email-chip="cliente@parceiro.example"]')`,
    8000,
  )
  await clickSelector(contents, '[data-action="email-discard"]')
  await clickSelector(contents, '[data-action="email-discard-confirm"]')
  const discarded = await waitFor(contents, `!document.querySelector('[data-email-composer]')`)
  checks['compose'] = {
    ok: composer && JSON.stringify(prefilled.to) === JSON.stringify(['marina.rocha@cliente.example']) && prefilled.subject === `Re: ${EMAIL_HTML_SUBJECT}` && prefilled.quoted && attached && toSent && sentOk && keptDraft && discarded && fake.sent.length === 1,
    detail: `composer=${composer}; para ${JSON.stringify(prefilled.to)}, "Re:"=${prefilled.subject.startsWith('Re: ')}, citação=${prefilled.quoted}; anexo=${attached}; enviado e aberto em Enviados=${toSent}; no SMTP falso=${sentOk} (${fake.sent.length} envio, ${fake.appended} APPEND); erro mantém o rascunho=${keptDraft}; descartado=${discarded}`,
  }

  // Conta recolhida: some com as pastas, fica gravada e vale numa janela nova.
  await clickSelector(contents, `[data-email-account-toggle="${accountId}"]`)
  const collapsed = await waitFor(contents, `!document.querySelector('${EMAIL_INBOX_LINK}') && document.querySelector('[data-email-account-toggle]')?.getAttribute('aria-expanded') === 'false'`)
  await wait(300)
  const saved = (readSettings(ctx.userDataDir).emailCollapsed ?? []).includes(accountId)
  const again = ctx.openWindow({ theme: 'light' })
  watch(again)
  await loadAndWait(again)
  const stillCollapsed = await waitFor(again.webContents, `document.querySelector('[data-email-account-toggle]')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('${EMAIL_INBOX_LINK}')`, 8000)
  again.destroy()
  await clickSelector(contents, `[data-email-account-toggle="${accountId}"]`)
  const expanded = await waitFor(contents, `document.querySelector('${EMAIL_INBOX_LINK}')`)

  // Apagar, pela confirmação.
  await openEmailFolder(contents, 'inbox', 4)
  await clickEmailRow(contents, 'Backup concluído com sucesso')
  await clickSelector(contents, '[data-action="email-delete"]')
  await clickSelector(contents, '[data-action="email-delete-confirm"]')
  const deleted = await waitFor(contents, `${EMAIL_ROWS}.length === 3 && !${emailRow('Backup concluído com sucesso')}`)
  // CA8: "Baixar" o anexo do Financeiro: o diálogo começa em Downloads com o nome do anexo e o arquivo sai com o conteúdo.
  const savedFile = join(ctx.userDataDir, 'anexo-baixado.csv')
  const savePathBefore = ctx.fixtures.savePath
  ctx.fixtures.savePath = savedFile
  await clickEmailRow(contents, 'Fechamento de novembro: notas para conferir')
  await waitFor(contents, `document.querySelector('[data-email-attachment="0"]')?.textContent.includes(${JSON.stringify(SMOKE_EMAIL_ATTACHMENT.name)})`, 8000)
  await clickSelector(contents, '[data-email-attachment="0"] [data-action="email-attachment-save"]')
  const downloadedShown = await waitFor(contents, `document.querySelector('[data-email-attachment-saved]')?.textContent.includes('anexo-baixado.csv')`, 8000)
  const downloaded = existsSync(savedFile) && readFileSync(savedFile, 'utf8') === SMOKE_EMAIL_ATTACHMENT.content
  const dialogStart = ctx.fixtures.saveDialogs.at(-1) ?? ''
  ctx.fixtures.savePath = savePathBefore
  const download = downloadedShown && downloaded && dialogStart === join(app.getPath('downloads'), SMOKE_EMAIL_ATTACHMENT.name)

  // CA9: "Encaminhar" leva o anexo da original até o SMTP falso.
  await clickSelector(contents, '[data-action="email-forward"]')
  const forwardOpen = await waitFor(contents, `document.querySelector('[data-email-composer="forward"] [data-email-compose-attachments]')?.textContent.includes(${JSON.stringify(SMOKE_EMAIL_ATTACHMENT.name)})`, 8000)
  await setValue(contents, '#email-compose-to', 'contabilidade@parceiro.example,')
  const sentBefore = fake.sent.length
  await clickSelector(contents, '[data-action="email-send"]')
  await waitFor(contents, `!document.querySelector('[data-email-composer]')`, 8000)
  const forwarded = fake.sent[sentBefore]
  const forwardOk = forwardOpen && forwarded?.subject === 'Enc: Fechamento de novembro: notas para conferir' && forwarded.attachments.map((item) => `${item.name}:${item.size}`).join() === `${SMOKE_EMAIL_ATTACHMENT.name}:${Buffer.byteLength(SMOKE_EMAIL_ATTACHMENT.content)}`
  await openEmailFolder(contents, 'inbox', 3)
  checks['attachments'] = {
    ok: download && forwardOk,
    detail: `baixado=${downloadedShown}, conteúdo certo=${downloaded}, diálogo começa em Downloads com o nome=${dialogStart.endsWith(SMOKE_EMAIL_ATTACHMENT.name)}; encaminhar com o anexo=${forwardOpen}, no SMTP falso=${forwardOk}`,
  }

  checks['folders'] = {
    ok: collapsed && saved && stillCollapsed && expanded && deleted,
    detail: `recolhida=${collapsed}, gravada=${saved}, recolhida na janela nova=${stillCollapsed}, aberta de novo=${expanded}; apagada pela confirmação=${deleted}`,
  }

  // Conta com problema: o estado na lista e "Remover" pela confirmação.
  await evaluate(
    contents,
    `window.__scribeApi.invoke('scribe:email-add-account', { address: 'recusada@lap.example', password: ${JSON.stringify(SMOKE_EMAIL_WRONG_PASSWORD)}, incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' }, outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' } }).then(() => true)`,
  )
  await openSettingsTab(contents, 'contas')
  const errorLine = await waitFor(contents, `[...document.querySelectorAll('[data-email-settings-state="error"] [data-email-settings-line]')].some((el) => el.textContent === 'IMAP · Com problema: Usuário ou senha recusados.')`, 8000)
  const errorInSidebar = await waitFor(contents, `document.querySelector('[data-email-account-error]')`)
  await clickSelector(contents, '[data-email-settings-state="error"] [data-action="email-remove-account"]')
  const confirmShown = await waitFor(contents, `document.querySelector('[data-notice="email-remove-confirm"]')?.textContent.includes('recusada@lap.example')`)
  await clickSelector(contents, '[data-action="email-remove-confirm"]')
  const removed = await waitFor(contents, `document.querySelectorAll('[data-email-settings-account]').length === 1 && document.querySelectorAll('[data-email-account]').length === 1`, 8000)
  checks['remove'] = {
    ok: errorLine && errorInSidebar && confirmShown && removed,
    detail: `estado com problema na lista=${errorLine} e na barra=${errorInSidebar}; confirmação=${confirmShown}; removida=${removed}`,
  }
  win.destroy()

  // Escuro: a lista, a leitura e o composer.
  const dark = ctx.openWindow({ theme: 'dark' })
  watch(dark)
  await loadAndWait(dark)
  const darkContents = dark.webContents
  const darkList = await openEmailFolder(darkContents, 'inbox', 3)
  await waitFor(darkContents, `[...${EMAIL_ROWS}].every((el) => el.querySelector('[data-email-row-preview]')?.textContent.trim().length > 3)`, 8000)
  const darkFirst = await clickEmailRow(darkContents, 'Re: Agenda da apresentação')
  await settle(darkContents)
  shots.push(await capture(dark, ctx.outDir, 'email-dark'))
  const darkReading = await clickEmailRow(darkContents, 'Fechamento de novembro: notas para conferir')
  await waitFor(darkContents, `document.querySelector('[data-email-body="text"]')`, 8000)
  await settle(darkContents)
  shots.push(await capture(dark, ctx.outDir, 'email-leitura-dark'))
  await clickSelector(darkContents, '[data-action="email-reply-all"]')
  const darkComposer = await waitFor(darkContents, `document.querySelector('[data-email-composer="replyAll"]')`)
  await settle(darkContents)
  shots.push(await capture(dark, ctx.outDir, 'email-composer-dark'))
  await clickSelector(darkContents, '[data-action="email-discard"]')
  await clickSelector(darkContents, '[data-action="email-discard-confirm"]')
  const darkTheme = await evaluate<string>(darkContents, 'document.documentElement.dataset.theme ?? ""')
  checks['dark'] = { ok: darkList && darkFirst && darkReading && darkComposer && darkTheme === 'dark', detail: `lista=${darkList} (${darkFirst}), leitura=${darkReading}, composer=${darkComposer}, tema=${darkTheme}` }
  dark.destroy()
}

/**
 * Contrato 45 (CA2 a CA4, CA7), com a conta do servidor falso já conectada e o agente ACP falso: "o que tenho de email
 * pendente?" lê o `EMAILS.md` (só o cache) e mostra o cartão com os emails, que abre a tela Email na mensagem; "responde
 * pro email da Marina dizendo …" vira o rascunho com "Re:", e só o clique em "Enviar" faz o SMTP falso receber, com o
 * In-Reply-To dela; "cria uma tarefa pra responder o email da Juliana amanhã" vira o lembrete ligado ao email, que
 * aparece nas pendências seguintes; "busque nos emails contrato da Juliana" pede as ferramentas do app, que acham no
 * servidor (pasta "Arquivo", fora do cache) e leem por PEEK, sem mudar a lida de nenhuma mensagem.
 */
async function emailAssistantChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const fake = ctx.fixtures.email
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const transportBefore = readSettings(ctx.userDataDir).claudeTransport
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: 'acp' }).then(() => true)")
  const accountId = await evaluate<string>(contents, `window.__scribeApi.invoke('scribe:email-accounts').then((list) => list[0]?.account.id ?? '')`)
  const inbox = (): Promise<{ id: string; subject: string; seen: boolean; messageId: string | null }[]> =>
    evaluate(contents, `window.__scribeApi.invoke('scribe:email-messages', { accountId: '${accountId}' }).then((list) => list.map((item) => ({ id: item.id, subject: item.subject, seen: item.seen, messageId: item.messageId })))`)
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, routeIs('assistente'))
  await clickSelector(contents, '[data-action="chat-new"]')
  await waitFor(contents, `document.querySelector('[data-chat-input]') && !document.querySelector('[data-chat-message]')`)

  // CA2: as pendências, com o cartão dos emails.
  const searchesBefore = fake.reader.searches
  const pending = await askChat(contents, 'O que tenho de email pendente?')
  const chatId = await evaluate<string>(contents, `document.querySelector('[data-chat-conversation]')?.getAttribute('data-chat-conversation') ?? ''`)
  const scopeDir = join(ctx.userDataDir, CHAT_SCOPE_DIR, chatId)
  const overviewOf = (): string => (existsSync(join(scopeDir, 'EMAILS.md')) ? readFileSync(join(scopeDir, 'EMAILS.md'), 'utf8') : '')
  const overview = overviewOf()
  const pendingLines = overview.split('\n').filter((line) => line.startsWith('- ref: ') && line.includes(' · pendente de resposta: sim'))
  const card = `[...document.querySelectorAll('[data-chat-action="emails"]')].at(-1)`
  const cardShown = await waitFor(contents, `${card}?.querySelectorAll('[data-chat-email-item]').length === ${pendingLines.length}`)
  const fromNames = await evaluate<string[]>(contents, `[...(${card}?.querySelectorAll('[data-chat-email-from]') ?? [])].map((el) => el.textContent)`)
  const accountShown = await evaluate<boolean>(contents, `[...(${card}?.querySelectorAll('[data-chat-email-account]') ?? [])].every((el) => el.textContent.startsWith('${SMOKE_EMAIL_ADDRESS}'))`)
  const timeShown = await evaluate<boolean>(contents, `[...(${card}?.querySelectorAll('[data-chat-email-time]') ?? [])].every((el) => el.textContent.trim().length > 0)`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'assistente-email-light'))
  const firstSubject = await evaluate<string>(contents, `${card}?.querySelector('[data-chat-email-subject]')?.textContent ?? ''`)
  await evaluate(contents, `${card}?.querySelector('[data-action="chat-email-open"]')?.click()`)
  const opened = await waitFor(contents, `${routeIs('email')} && document.querySelector('[data-email-reading]')?.getAttribute('aria-label') === ${JSON.stringify(firstSubject)}`, 8000)
  checks['assistantPending'] = {
    ok:
      pending.done &&
      pendingLines.length > 0 &&
      cardShown &&
      fromNames.length === pendingLines.length &&
      accountShown &&
      timeShown &&
      pending.answer.includes('[Email · ') &&
      !pending.answer.includes('lap-acao') &&
      fake.reader.searches === searchesBefore &&
      mode(join(scopeDir, 'EMAILS.md')) === '600' &&
      opened,
    detail: `resposta=${pending.done} "${pending.answer.slice(0, 200)}"; pendentes no EMAILS.md=${pendingLines.length}; cartão=${cardShown} ${JSON.stringify(fromNames)} conta=${accountShown} hora=${timeShown}; servidor nas pendências=${fake.reader.searches - searchesBefore}; clique abriu "${firstSubject}"=${opened}`,
  }
  await clickSelector(contents, '[data-nav="assistente"]')
  await waitFor(contents, `${routeIs('assistente')} && document.querySelector('[data-chat-conversation="${chatId}"]')`, 8000)

  // CA3: o rascunho, enviado só no clique, com o In-Reply-To da mensagem respondida.
  const marina = (await inbox()).find((item) => item.subject.startsWith('Proposta revisada'))
  const reply = await askChat(contents, 'Responde pro email da Marina dizendo que recebi a proposta')
  const replyCard = `[...document.querySelectorAll('[data-chat-action="email-resposta"]')].at(-1)`
  const replyShown = await waitFor(contents, `${replyCard}?.dataset.chatActionStatus === 'proposed'`)
  const to = await evaluate<string>(contents, `${replyCard}?.querySelector('[data-chat-email-to]')?.textContent ?? ''`)
  const subject = await evaluate<string>(contents, `${replyCard}?.querySelector('[data-chat-email-subject]')?.textContent ?? ''`)
  const sentBefore = fake.sent.length
  await wait(300)
  const nothingBeforeClick = fake.sent.length === sentBefore
  await setValue(contents, '[data-chat-action="email-resposta"][data-chat-action-status="proposed"] [data-chat-action-message]', 'Recebi a proposta, obrigado. Respondo até sexta.')
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'assistente-email-rascunho-light'))
  await evaluate(contents, `${replyCard}?.querySelector('[data-action="chat-action-email-send"]')?.click()`)
  for (let attempt = 0; attempt < 50 && fake.sent.length <= sentBefore; attempt++) await wait(100)
  const sentDone = await waitFor(contents, `${replyCard}?.dataset.chatActionStatus === 'done' && (${replyCard}?.querySelector('[data-chat-action-result]')?.textContent ?? '').startsWith('Enviado às ')`)
  const last = fake.sent.at(-1)
  const savedReply = chatFile(ctx.userDataDir, chatId)?.messages.at(-1)?.actions?.[0]
  checks['assistantReply'] = {
    ok:
      reply.done &&
      replyShown &&
      to.includes('marina.rocha@cliente.example') &&
      subject === 'Re: Proposta revisada do projeto de integração' &&
      nothingBeforeClick &&
      fake.sent.length === sentBefore + 1 &&
      last?.to.join(',') === 'marina.rocha@cliente.example' &&
      last.subject === subject &&
      last.inReplyTo === (marina?.messageId ?? '?') &&
      last.text === 'Recebi a proposta, obrigado. Respondo até sexta.' &&
      sentDone &&
      savedReply?.status === 'done',
    detail: `cartão=${replyShown} para "${to}" assunto "${subject}"; nada antes do clique=${nothingBeforeClick}; SMTP ${sentBefore} -> ${fake.sent.length} ${JSON.stringify(last ?? null)}; In-Reply-To esperado ${marina?.messageId ?? '?'}; "Enviado"=${sentDone}`,
  }

  // CA4: a tarefa de responder, ligada ao email, e ela nas pendências seguintes.
  const reminder = await askChat(contents, 'Cria uma tarefa pra responder o email da Juliana amanhã')
  const reminderCard = `[...document.querySelectorAll('[data-chat-action="lembrete"]')].at(-1)`
  const reminderShown = await waitFor(contents, `${reminderCard}?.dataset.chatActionStatus === 'proposed' && ${reminderCard}?.querySelector('[data-chat-action-email-label]')`)
  const label = await evaluate<string>(contents, `${reminderCard}?.querySelector('[data-chat-action-email-label]')?.textContent ?? ''`)
  await evaluate(contents, `${reminderCard}?.querySelector('[data-action="chat-action-reminder-create"]')?.click()`)
  const created = await waitFor(contents, `${reminderCard}?.dataset.chatActionStatus === 'done'`)
  const task = (await ctx.automations.listTasks()).find((item) => item.reminder?.email?.accountId === accountId)
  await askChat(contents, 'O que tenho de email pendente?')
  const julianaLine = overviewOf()
    .split('\n')
    .find((line) => line.includes('de: Juliana Prado'))
  checks['assistantTask'] = {
    ok: reminder.done && reminderShown && label.startsWith('Email: Juliana Prado · ') && created && task !== undefined && task.schedule.kind === 'once' && task.agentId === '' && (julianaLine?.includes(' · lembrete marcado: ') ?? false),
    detail: `cartão=${reminderShown} "${label}"; criado=${created}; tarefa ${task ? `${task.name} (${task.schedule.kind})` : 'ausente'}; linha seguinte "${julianaLine ?? ''}"`,
  }

  // CA7: a busca além do cache, pelas ferramentas do app; nada muda de lida.
  const seenBefore = JSON.stringify((await inbox()).map((item) => [item.id, item.seen]))
  const peeksBefore = fake.reader.peeks
  const searchBefore = fake.reader.searches
  const found = await askChat(contents, 'Busque nos emails contrato da Juliana')
  const searchFile = existsSync(join(scopeDir, EMAIL_SEARCH_FILE)) ? readFileSync(join(scopeDir, EMAIL_SEARCH_FILE), 'utf8') : ''
  const archivedCard = await waitFor(contents, `[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-email-account]') ?? [])].some((el) => el.textContent.includes('só no servidor (pasta Arquivo)'))`)
  const steps = await evaluate<string[]>(contents, `[...(${LAST_ASSISTANT}?.querySelectorAll('[data-chat-step]') ?? [])].map((el) => el.textContent)`)
  const seenAfter = JSON.stringify((await inbox()).map((item) => [item.id, item.seen]))
  checks['assistantSearch'] = {
    ok:
      found.done &&
      found.answer.includes('Vigência de 24 meses') &&
      !found.answer.includes('lap-ferramenta') &&
      searchFile.includes('onde: servidor, pasta Arquivo') &&
      searchFile.includes(SMOKE_EMAIL_ARCHIVED.subject) &&
      fake.reader.searches > searchBefore &&
      fake.reader.peeks === peeksBefore + 1 &&
      archivedCard &&
      seenAfter === seenBefore,
    detail: `resposta=${found.done} "${found.answer.slice(0, 200)}"; busca ${fake.reader.searches - searchBefore} pastas, PEEK ${fake.reader.peeks - peeksBefore}; cartão da pasta Arquivo=${archivedCard}; passos ${JSON.stringify(steps.slice(-4))}; lidas iguais=${seenAfter === seenBefore}`,
  }

  await evaluate(contents, `window.__scribeApi.invoke('scribe:settings-update', { claudeTransport: '${transportBefore === 'acp' ? 'acp' : 'cli'}' }).then(() => true)`)
  win.destroy()
}

/**
 * Contrato 51 (CA1 a CA3, CA6), com a conta do servidor falso conectada e o agente ACP falso: a tarefa nova com "Pode
 * enviar email" ligada pelo formulário (a conta e `@cliente.example`), gravada com a data e com o ícone de envio na
 * lista; "Rodar agora" com o pedido de envio para um endereço da lista e outro de fora: o SMTP falso recebe só o
 * primeiro, o segundo é recusado, a execução mostra os dois, o enviado está em Enviados e sai o aviso do fim.
 */
async function emailTaskChecks(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>, shots: Screenshot[]): Promise<void> {
  const fake = ctx.fixtures.email
  const auto = ctx.fixtures.automations
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  const invoke = <T>(script: string): Promise<T> => evaluate<T>(contents, script)
  const accountId = await invoke<string>(`window.__scribeApi.invoke('scribe:email-accounts').then((list) => list[0]?.account.id ?? '')`)
  const agentId = await invoke<string>(`window.__scribeApi.invoke('scribe:agents-list').then((list) => list.agents[0]?.id ?? '')`)
  const name = 'Aviso por email do smoke'
  const subject = 'o aviso do smoke'

  // CA1: o formulário, com a seção desligada por padrão; ligada, a conta, a lista e o teto.
  await clickSelector(contents, '[data-nav="automacoes"]')
  await waitFor(contents, routeIs('automacoes'), 8000)
  await clickSelector(contents, '#automations-tab-tarefas')
  await waitFor(contents, `document.querySelector('[data-tasks-tab]')`)
  await clickSelector(contents, '[data-action="task-new"]')
  await waitFor(contents, `document.querySelector('[data-task-form]')`)
  const offByDefault = await waitFor(contents, `document.querySelector('[data-task-email="off"]') && !document.querySelector('#task-email-allow') && document.querySelector('[data-action="task-email-toggle"]')?.disabled === false`)
  await setValue(contents, '#task-name', name)
  await setValue(contents, '#task-agent', agentId, 'change')
  await setValue(contents, '#task-message', `Envie ${subject} para marina.rocha@cliente.example e fora@outro.example`)
  await setValue(contents, '#task-frequency', 'daily', 'change')
  await waitFor(contents, `document.querySelector('[data-task-frequency="daily"] [data-task-time]')`)
  await setValue(contents, '[data-task-time]', '23:30')
  await clickSelector(contents, '[data-action="task-email-toggle"]')
  await waitFor(contents, `document.querySelector('[data-task-email="on"] #task-email-allow')`)
  await setValue(contents, '#task-email-account', accountId, 'change')
  // Lista vazia: não salva.
  const emptyBlocked = await waitFor(contents, `document.querySelector('[data-task-email-error]') && document.querySelector('[data-action="task-save"]')?.disabled === true`)
  await setValue(contents, '#task-email-allow', '@Cliente.example')
  const maxDefault = await invoke<string>(`document.querySelector('#task-email-max')?.value ?? ''`)
  const ready = await waitFor(contents, `!document.querySelector('[data-task-email-error]') && document.querySelector('[data-action="task-save"]')?.disabled === false`)
  await invoke(`(() => { document.querySelector('[data-task-email]')?.scrollIntoView({ block: 'center' }); return true })()`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'tarefa-email-light'))
  await clickSelector(contents, '[data-action="task-save"]')
  const row = await waitFor(contents, `document.querySelector('[data-task-row][data-task-name=${JSON.stringify(name)}][data-task-email] [data-task-email-icon]')`)
  const line = await invoke<string>(`document.querySelector('[data-task-row][data-task-name=${JSON.stringify(name)}] [data-task-email-line]')?.textContent ?? ''`)
  const saved = (await ctx.automations.listTasks()).find((task) => task.name === name)
  const otherTasks = (await ctx.automations.listTasks()).filter((task) => task.name !== name && !task.reminder)
  checks['taskEmailForm'] = {
    ok:
      offByDefault &&
      emptyBlocked &&
      maxDefault === '5' &&
      ready &&
      row &&
      line.startsWith('Pode enviar email · permitido em ') &&
      saved?.email?.accountId === accountId &&
      JSON.stringify(saved.email.allow) === JSON.stringify(['@cliente.example']) &&
      saved.email.maxPerRun === 5 &&
      !Number.isNaN(Date.parse(saved.email.grantedAt)) &&
      otherTasks.every((task) => task.email === null),
    detail: `desligada por padrão=${offByDefault}; lista vazia bloqueia=${emptyBlocked}; teto padrão "${maxDefault}"; ícone na lista=${row} "${line}"; gravada ${JSON.stringify(saved?.email ?? null)}; outras sem permissão=${otherTasks.every((task) => task.email === null)}`,
  }

  // CA2, CA3 e CA6: "Rodar agora": um envio para a lista chega no SMTP falso, o de fora é recusado.
  const sentBefore = fake.sent.length
  const noticesBefore = auto.notifications.length
  const started = await invoke<{ ok: boolean; runId?: string }>(`window.__scribeApi.invoke('scribe:tasks-run-now', { id: ${JSON.stringify(saved?.id ?? '')} })`)
  await automationsIdle(ctx)
  for (let attempt = 0; attempt < 50 && readRunFiles(ctx.userDataDir).find((run) => run.id === started.runId)?.status === 'running'; attempt++) await wait(100)
  await automationsIdle(ctx)
  const run = readRunFiles(ctx.userDataDir).find((item) => item.id === started.runId) as (SmokeRunFile & { emails?: { to: string[]; ok: boolean; messageId: string | null; error: string | null; subject: string }[] }) | undefined
  const delivered = fake.sent.slice(sentBefore)
  const emails = run?.emails ?? []
  const sentFolder = await invoke<{ subject: string; to: string[] }[]>(
    `window.__scribeApi.invoke('scribe:email-messages', { accountId: '${accountId}', folder: 'sent' }).then((list) => list.map((item) => ({ subject: item.subject, to: item.to.map((entry) => entry.address) })))`,
  )
  const notice = auto.notifications.slice(noticesBefore).find((item) => item.title === `Tarefa: ${name}` && item.body === `Tarefa ${name} enviou 1 email`)

  // A execução mostra os dois.
  await clickSelector(contents, '#automations-tab-execucoes')
  await waitFor(contents, `document.querySelector('[data-run-row="${started.runId ?? ''}"]')`, 8000)
  await clickSelector(contents, `[data-run-row="${started.runId ?? ''}"] [data-action="run-open"]`)
  const shown = await waitFor(contents, `document.querySelectorAll('[data-run-detail] [data-run-email]').length === 2`, 8000)
  const view = await invoke<{ kind: string; to: string; extra: string }[]>(
    `[...document.querySelectorAll('[data-run-detail] [data-run-email]')].map((item) => ({ kind: item.dataset.runEmail, to: item.querySelector('[data-run-email-to]')?.textContent ?? '', extra: (item.querySelector('[data-run-email-id]') ?? item.querySelector('[data-run-email-error]'))?.textContent ?? '' }))`,
  )
  await invoke(`(() => { document.querySelector('[data-run-emails]')?.scrollIntoView({ block: 'center' }); return true })()`)
  await settle(contents)
  shots.push(await capture(win, ctx.outDir, 'execucao-emails-light'))
  checks['taskEmailRun'] = {
    ok:
      started.ok &&
      run?.status === 'ok' &&
      delivered.length === 1 &&
      delivered[0]?.to.join(',') === 'marina.rocha@cliente.example' &&
      delivered[0].subject === subject &&
      emails.length === 2 &&
      emails[0]?.ok === true &&
      (emails[0].messageId ?? '').startsWith('<') &&
      emails[1]?.ok === false &&
      emails[1].error === 'destinatário fora da lista: fora@outro.example' &&
      sentFolder.some((item) => item.subject === subject && item.to.join(',') === 'marina.rocha@cliente.example') &&
      notice !== undefined &&
      shown &&
      view[0]?.kind === 'sent' &&
      view[0].extra.startsWith('Message-ID <') &&
      view[1]?.kind === 'refused' &&
      view[1].to.includes('fora@outro.example') &&
      view[1].extra.includes('fora da lista'),
    detail: `rodou=${JSON.stringify(started)} ${run?.status ?? '?'}; SMTP ${JSON.stringify(delivered.map((item) => ({ to: item.to, subject: item.subject })))}; na execução ${JSON.stringify(emails.map((item) => `${item.ok ? 'ok' : 'recusado'}:${item.to.join(',')}:${item.error ?? item.messageId ?? ''}`))}; em Enviados=${sentFolder.some((item) => item.subject === subject)}; aviso=${notice ? notice.body : 'nenhum'}; na tela ${JSON.stringify(view)}`,
  }
  // A tarefa sai: o resto do smoke não vê a permissão.
  await invoke(`window.__scribeApi.invoke('scribe:tasks-delete', { id: ${JSON.stringify(saved?.id ?? '')} })`)
  win.destroy()
}

type EmailNoticeRecord = SmokeFixtures['emailNotify']['notifications'][number]

/** A primeira notificação de email registrada depois de `from` que passa no filtro (até `ms`). */
async function waitEmailNotice(ctx: SmokeContext, from: number, match: (item: EmailNoticeRecord) => boolean, ms = 5000): Promise<EmailNoticeRecord | null> {
  const until = Date.now() + ms
  for (;;) {
    const found = ctx.fixtures.emailNotify.notifications.slice(from).find(match)
    if (found || Date.now() > until) return found ?? null
    await wait(50)
  }
}

/**
 * Contrato 43 (CA4): as notificações de email com a `Notification` substituta, por último (a senha do bloqueio já
 * existe). A Caixa de Entrada aberta na janela "em foco" não notifica; com Enviados aberto, notifica com o remetente e
 * o assunto; três do mesmo remetente em 5 s viram uma; o da própria conta e com a opção desligada, nada; bloqueado, sem
 * o assunto; o clique abre a mensagem.
 */
async function emailNotifyCheck(ctx: SmokeContext, watch: (win: BrowserWindow) => void, checks: Record<string, Check>): Promise<void> {
  const fake = ctx.fixtures.email
  const notify = ctx.fixtures.emailNotify
  const win = ctx.openWindow({ theme: 'light' })
  watch(win)
  await loadAndWait(win)
  const contents = win.webContents
  await openEmailFolder(contents, 'inbox', 3)
  await wait(200)
  notify.focusedContentsId = contents.id
  const paulo = { name: 'Paulo Nunes', address: 'paulo.nunes@cliente.example' }
  const juliana = { name: 'Juliana Prado', address: 'juliana.prado@parceiro.example' }

  const start = notify.notifications.length
  await fake.deliver({ from: paulo, subject: 'Com a caixa aberta', text: 'Chegou com a Caixa de Entrada à vista.' })
  const inList = await waitFor(contents, emailRow('Com a caixa aberta'), 5000)
  await wait(800)
  const viewingSilent = notify.notifications.length === start

  await openEmailFolder(contents, 'sent', 1)
  await wait(200)
  await fake.deliver({ from: paulo, subject: 'Cronograma aprovado', text: 'Pode seguir.' })
  const single = await waitEmailNotice(ctx, start, (item) => item.body === 'Cronograma aprovado')
  await fake.deliver({ from: paulo, subject: 'Segundo', text: '2' })
  await fake.deliver({ from: paulo, subject: 'Terceiro', text: '3' })
  const burst = await waitEmailNotice(ctx, start, (item) => item.count === 3)
  const openNow = notify.notifications.slice(start).filter((item) => !item.closed).length

  const ownFrom = notify.notifications.length
  await fake.deliver({ from: { name: 'Andrew Teste', address: SMOKE_EMAIL_ADDRESS }, subject: 'Da própria conta', text: 'x' })
  const ownSilent = (await waitEmailNotice(ctx, ownFrom, () => true, 1200)) === null
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { emailNotifications: false }).then(() => true)")
  const offFrom = notify.notifications.length
  await fake.deliver({ from: juliana, subject: 'Com as notificações desligadas', text: 'x' })
  const offSilent = (await waitEmailNotice(ctx, offFrom, () => true, 1200)) === null
  await evaluate(contents, "window.__scribeApi.invoke('scribe:settings-update', { emailNotifications: true }).then(() => true)")

  // Bloqueado: só de quem é, sem o assunto; o clique (depois de desbloquear) abre a mensagem.
  await evaluate(contents, "window.__scribeApi.invoke('scribe:lock-now').then(() => true)")
  await waitFor(contents, LOCK_LAYER)
  const lockedFrom = notify.notifications.length
  await fake.deliver({ from: juliana, subject: 'Assunto sigiloso', text: 'x' })
  const locked = await waitEmailNotice(ctx, lockedFrom, () => true)
  await typeLockPassword(contents, LOCK_PASSWORD)
  const unlocked = await waitFor(contents, `!${LOCK_LAYER}`)
  locked?.open()
  const routed = await waitFor(contents, `${routeIs('email')} && document.querySelector('[data-email-folder-view="inbox"]') && document.querySelector('[data-email-reading="${locked?.id ?? 'x'}"] [data-email-subject]')?.textContent === 'Assunto sigiloso'`, 8000)
  notify.focusedContentsId = null
  const lockedHidden = locked ? !`${locked.title} ${locked.body}`.includes('sigiloso') : false
  checks['notify'] = {
    ok: inList && viewingSilent && single?.title === 'Paulo Nunes' && burst?.body === '3 emails de Paulo Nunes' && openNow === 1 && ownSilent && offSilent && locked?.body === 'Email de Juliana Prado' && lockedHidden && unlocked && routed,
    detail: `Caixa de Entrada à vista sem notificação=${viewingSilent} (na lista=${inList}); "${single?.title ?? ''}" / "${single?.body ?? ''}"; rajada "${burst?.body ?? ''}" (${openNow} aberta); própria conta sem nada=${ownSilent}; desligado sem nada=${offSilent}; bloqueado "${locked?.body ?? ''}" sem o assunto=${lockedHidden}; clique abriu a mensagem=${routed}`,
  }
  win.destroy()
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
  /** Contrato 11: conta Google e Drive. */
  const google: Record<string, Check> = {}
  /** Contrato 12: agendas e avisos. */
  const calendar: Record<string, Check> = {}
  /** Contrato 24: WhatsApp pelo serviço falso. */
  const whatsapp: Record<string, Check> = {}
  const assistant: Record<string, Check> = {}
  const automations: Record<string, Check> = {}
  const internet: Record<string, Check> = {}
  const mcp: Record<string, Check> = {}
  /** Contrato 27: quem fala no Meet. */
  const meet: Record<string, Check> = {}
  const email: Record<string, Check> = {}
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
      // Contrato 28: a gravação em curso aparece no topo da lista e o cartão volta para ela.
      if (themeName === 'light') meetingsList['recordingNow'] = await recordingNowCheck(contents)
      // Contrato 29: "Ouvir só os participantes" desliga e religa o microfone no meio da gravação.
      if (themeName === 'light') recording['micOff'] = await micOffCheck(contents)

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
        // Contrato 28: pasta criada pela barra, reunião movida pelo "…" da linha, filtro e "Todas".
        meetingsList['folders'] = await meetingsFoldersCheck(contents, ctx.userDataDir)
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
        () => shoot('assistente', 'assistente'),
        () => shoot('perguntar-v2', 'assistente'),
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
        // Contrato 31: a aba "Plugins", o "Salvar plugin…" e o manual.
        const plugins = await pluginsSettings(win, ctx)
        settings['plugins'] = plugins.check
        screenshots.push(plugins.shot)
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

    // Contrato 11: conta Google e Drive falsos, antes do bloqueio (que termina com a conta já fora).
    await googleChecks(ctx, watch, google, screenshots)

    // Contrato 12: agendas Google e Microsoft falsas, logo depois do Google (que termina com as duas contas fora).
    await calendarChecks(ctx, watch, calendar, screenshots)

    // Contrato 24: WhatsApp com o serviço falso, antes do bloqueio (que também recusa os canais dele).
    await whatsappChecks(ctx, watch, whatsapp, screenshots)

    // Contrato 23: Automações, com o agente ACP falso e o relógio do agendador adiantado; antes do bloqueio.
    await automationsChecks(ctx, watch, automations, screenshots)

    // Contrato 25: o Assistente, com o WhatsApp falso ainda conectado e o relógio do agendador de volta; antes do
    // bloqueio (que recusa os canais novos junto com os outros).
    await assistantChecks(ctx, watch, assistant, screenshots)

    // Contrato 26: a internet nos agentes, no "Pedir agora" e no Assistente, com o agente ACP falso (sem rede).
    await internetChecks(ctx, watch, internet, screenshots)

    // Contrato 21: os servidores MCP (Claude CLI falso, servidor MCP falso e o agente ACP falso); termina desligado.
    await mcpChecks(ctx, watch, mcp, screenshots)

    // Contrato 58: os conectores do claude.ai na aba Conexões e na sessão do chat; termina com todos desligados.
    await connectorChecks(ctx, watch, mcp, screenshots)

    // Contrato 27: quem fala no Meet, com um cliente falso no servidor local; antes do bloqueio.
    await meetChecks(ctx, watch, meet)

    // Contrato 48: o aviso de reunião, com o servidor do Meet no ar (como `meetChecks` deixa); antes do bloqueio.
    await meetingPromptChecks(ctx, watch, meet, screenshots)

    // Contrato 49: o mesmo aviso pelo microfone de outro app, com o `lap-mic-watch` falso.
    await micWatchChecks(ctx, watch, meet)

    // Contrato 30: IA anotando ao vivo e o quadro de post-its, numa gravação à parte; antes do bloqueio.
    await aiNotesChecks(ctx, watch, recording)

    // Contrato 43: as telas de email com o servidor falso; antes do bloqueio (que recusa os canais novos junto).
    await emailChecks(ctx, watch, email, screenshots)

    // Contrato 45: o email no Assistente, com a conta do servidor falso conectada; antes do bloqueio.
    await emailAssistantChecks(ctx, watch, email, screenshots)

    // Contrato 51: a tarefa com "Pode enviar email", com a mesma conta do servidor falso; antes do bloqueio.
    await emailTaskChecks(ctx, watch, email, screenshots)

    // Contrato 22: bloqueio do app, por último (a senha criada vale para o userData inteiro).
    await lockChecks(ctx, watch, lock, screenshots)

    // Contrato 24 (CA6): com a senha criada, o bloqueio recusa o WhatsApp e o serviço segue conectado.
    await whatsappLockCheck(ctx, watch, whatsapp)

    // Contrato 40: as notificações do WhatsApp, por último (o app já desbloqueado, o serviço falso conectado).
    await whatsappNotifyCheck(ctx, watch, whatsapp)

    // Contrato 43: as notificações de email, por último também (com a senha do bloqueio criada).
    await emailNotifyCheck(ctx, watch, email)
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
  for (const name of ['list', 'listDark', 'search', 'folders', 'recordingNow']) if (!meetingsList[name]) failures.push(`lista de reuniões ${name}: não executado`)
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
  for (const name of ['captureWorklet', 'tapeFps', 'endSavesAndOpensDetail', 'pause', 'spaceResumes', 'systemSilenceNotice', 'endFromHeader', 'deleteWithConfirmation', 'noKeyState', 'copyTranscript', 'deleteTranscript', 'echoRemoved', 'echoNotSaved', 'recorderFormat', 'audioWhileRecording', 'audioSaved', 'audioDetail', 'deleteKeepsFiles', 'summary', 'summaryDark', 'summaryDownload', 'notesRecording', 'notesRecordingDark', 'notesDetail', 'notesDetailDark', 'analysisRecording', 'analysisRecordingDark', 'analysisDetail', 'micOff', 'aiNotesLive', 'notesCanvas', 'notesFilter']) {
    if (!recording[name]) failures.push(`gravação ${name}: não executado`)
  }
  for (const [name, check] of Object.entries(google)) if (!check.ok) failures.push(`google ${name}: ${check.detail}`)
  for (const name of ['client', 'signIn', 'upload', 'replaceSummary', 'signOut']) if (!google[name]) failures.push(`google ${name}: não executado`)
  for (const [name, check] of Object.entries(calendar)) if (!check.ok) failures.push(`agenda ${name}: ${check.detail}`)
  for (const name of ['microsoft', 'googleCalendar', 'notices', 'settings', 'banner', 'recordFromBanner', 'recordFromNotice', 'upcoming', 'signOut']) if (!calendar[name]) failures.push(`agenda ${name}: não executado`)
  for (const [name, check] of Object.entries(whatsapp)) if (!check.ok) failures.push(`whatsapp ${name}: ${check.detail}`)
  for (const name of ['detect', 'install', 'risk', 'paired', 'screen', 'draft', 'send', 'correct', 'ask', 'dark', 'locked', 'notify']) if (!whatsapp[name]) failures.push(`whatsapp ${name}: não executado`)
  for (const [name, check] of Object.entries(automations)) if (!check.ok) failures.push(`automações ${name}: ${check.detail}`)
  for (const [name, check] of Object.entries(assistant)) if (!check.ok) failures.push(`assistente ${name}: ${check.detail}`)
  for (const name of ['name', 'pending', 'sources', 'reminder', 'whatsapp', 'invalid']) if (!assistant[name]) failures.push(`assistente ${name}: não executado`)
  for (const name of ['screen', 'testNow', 'agentForm', 'tasks', 'scheduled', 'afterMeeting', 'skipped', 'tray', 'autoPaused', 'missed', 'askNow', 'runs', 'settings', 'closeKeepsApp', 'dark']) if (!automations[name]) failures.push(`automações ${name}: não executado`)
  for (const [name, check] of Object.entries(internet)) if (!check.ok) failures.push(`internet ${name}: ${check.detail}`)
  for (const name of ['agent', 'askNow', 'noInternet', 'assistant']) if (!internet[name]) failures.push(`internet ${name}: não executado`)
  for (const [name, check] of Object.entries(mcp)) if (!check.ok) failures.push(`mcp ${name}: ${check.detail}`)
  for (const name of ['tab', 'cliEnable', 'import', 'addForm', 'addJson', 'chat', 'session', 'otherUses', 'remove', 'secrets', 'dark']) if (!mcp[name]) failures.push(`mcp ${name}: não executado`)
  for (const [name, check] of Object.entries(meet)) if (!check.ok) failures.push(`meet ${name}: ${check.detail}`)
  for (const name of ['server', 'recording', 'setting', 'meetingPrompt', 'meetingPromptRecord', 'meetingPromptNever', 'micWatch']) if (!meet[name]) failures.push(`meet ${name}: não executado`)
  for (const [name, check] of Object.entries(email)) if (!check.ok) failures.push(`email ${name}: ${check.detail}`)
  for (const name of ['settings', 'list', 'reading', 'compose', 'folders', 'attachments', 'remove', 'dark', 'notify', 'assistantPending', 'assistantReply', 'assistantTask', 'assistantSearch', 'taskEmailForm', 'taskEmailRun']) if (!email[name]) failures.push(`email ${name}: não executado`)
  for (const [name, check] of Object.entries(lock)) if (!check.ok) failures.push(`bloqueio ${name}: ${check.detail}`)
  for (const name of ['password', 'layer', 'channels', 'unlock', 'shortcutAndTouchId', 'recordingContinues', 'leaveDialog', 'endWhileLocked', 'reopen', 'reopenFromDisk', 'dark']) if (!lock[name]) failures.push(`bloqueio ${name}: não executado`)
  if (!theme.ok) failures.push(`tema: ${theme.detail}`)
  if (!motion.ok) failures.push(`movimento reduzido: ${motion.detail}`)
  // Mais o aviso de sistema sem som, nos dois temas, o eco removido, os arquivos no detalhe, a aba
  // "Áudio" depois de baixar, a barra com a marca própria, o bloco "Atualizações" e a busca na lista
  // (só no claro), a conversa vazia e o painel "Contexto" do "Perguntar" v2 e a conversa pelo agente ACP
  // (contrato 17), as abas "Contas" e "Sobre" e a busca das Configurações (contrato 18), só no claro; a aba
  // "Análise" da gravação nos dois temas e a seção "Perguntas em aberto" do detalhe, no claro (contrato 19); a
  // camada de bloqueio nos dois temas, bloqueada na gravação e o bloco "Bloqueio" (contrato 22); a aba "Contas"
  // logada nos dois temas, deslogada no escuro e a aba "Áudio" com "No Drive" (contrato 11); a tela "WhatsApp" nos
  // dois temas, o bloco em Configurações, a tela de risco, o pareamento e o rascunho, no claro (contrato 24); a tela
  // "Automações" nos dois temas, o formulário do agente, as tarefas, o formulário da tarefa, as execuções e o detalhe
  // de uma, no claro (contrato 23); o painel "Contexto" com as fontes, o cartão do lembrete e o da resposta no
  // WhatsApp do Assistente, no claro (contrato 25); "Pedir agora" com o agente com internet e a resposta do Assistente
  // com o link, no claro (contrato 26); o bloco "Agenda", a faixa "não está sendo gravada" e "Próximas", no claro
  // (contrato 12); a aba "Plugins" com o plugin salvo e o manual aberto, no claro (contrato 31); o painel Detalhes do
  // WhatsApp, no claro (contrato 32; no escuro ele sai no print da tela "WhatsApp"); o balão com a imagem, o player e
  // a transcrição do áudio, no claro (contrato 37); a prévia do anexo com a legenda, no claro (contrato 39); a aba
  // "Conexões" nos dois temas, o formulário testado e o cartão de aprovação da ferramenta MCP, no claro (contrato 21);
  // o aviso de reunião, no claro e no tamanho dele (contrato 48); a lista, a leitura e o composer do email, nos dois
  // temas (contrato 43); o cartão dos emails pendentes e o rascunho de resposta por email no Assistente, no claro
  // (contrato 45); o formulário da tarefa com "Pode enviar email" e a execução com os emails enviado e recusado, no
  // claro (contrato 51); a seção "Conectores do claude.ai" com o Notion ligado e as ferramentas, nos dois temas
  // (contrato 58).
  const expectedShots = SCREENS.length * THEMES.length + 68
  if (screenshots.length !== expectedShots) failures.push(`${screenshots.length} PNGs em vez de ${expectedShots}`)
  for (const shot of screenshots) {
    if (shot.name === MEETING_PROMPT_SHOT) {
      if (shot.width !== MEETING_PROMPT_SIZE.width || shot.height !== MEETING_PROMPT_SIZE.height) failures.push(`${shot.name}: ${shot.width}x${shot.height} em vez de ${MEETING_PROMPT_SIZE.width}x${MEETING_PROMPT_SIZE.height}`)
    } else if (shot.width < 1120 || shot.height < 740) failures.push(`${shot.name}: ${shot.width}x${shot.height} abaixo de 1120x740`)
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
    // Contrato 11: só método, servidor e caminho dos pedidos ao Google falso; nenhum token, nenhum corpo.
    google,
    googleFakeCalls: ctx.fixtures.google.calls,
    googleFakeDrive: [...ctx.fixtures.google.files.values()].map((file) => ({ name: redactCalendar(file.name), mimeType: file.mimeType, bytes: file.content.byteLength, uploads: file.uploads, trashed: file.trashed })),
    // Contrato 12: os resultados, os caminhos pedidos à Microsoft falsa e só o tipo das notificações; nenhum token,
    // nenhum título, participante ou link da agenda.
    calendar,
    microsoftFakeCalls: ctx.fixtures.microsoft.calls.map((call) => ({ method: call.method, host: call.host, path: call.path.replace(/\/calendars\/[^/]+\//, '/calendars/<id>/') })),
    calendarNotifications: ctx.fixtures.calendar.notifications.map((notice) => ({ kind: notice.kind, actions: notice.actions })),
    // Contrato 24: só os resultados; nenhum texto de mensagem além dos fixos do serviço falso.
    whatsapp,
    assistant,
    // Contrato 26: só os resultados (os endereços são os inventados do agente falso).
    internet,
    // Contrato 21: só os resultados; nenhum valor de variável ou cabeçalho dos servidores MCP falsos.
    mcp,
    // Contrato 27: só os resultados (os nomes são os inventados do cliente falso).
    meet,
    // Contrato 43: só os resultados (os endereços e assuntos são os inventados do servidor falso).
    email,
    // Contrato 23: os resultados, as notificações, o Dock e os itens de login substitutos; nenhum texto de reunião.
    automations,
    automationsFixtures: { notifications: ctx.fixtures.automations.notifications.map((notice) => notice.title), trayImages: ctx.fixtures.automations.trayImages, dock: ctx.fixtures.automations.dock, loginItems: ctx.fixtures.automations.loginItems, quitRequests: ctx.fixtures.automations.quitRequests },
    meetingFolder: folderFiles(defaultMeetingFolder(ctx)).map((file) => ({ ...file, name: redactCalendar(file.name) })),
    openedFiles: ctx.fixtures.openedFiles.map((item) => ({ action: item.action, file: redactCalendar(basename(item.path)) })),
    claudeFakeSpawns: ctx.fixtures.claudeSpawns.map((spawn) => ({ ...spawn, args: spawn.args.filter((arg) => arg.startsWith('--')) })),
    openedExternally: ctx.fixtures.openedUrls.map(redactCalendar),
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
  // Contrato 11: nenhum segredo (chave secreta do cliente, tokens do Google falso) no relatório.
  const secrets = [SMOKE_GOOGLE_CLIENT_SECRET, ...ctx.fixtures.google.accessTokens(), ...ctx.fixtures.google.refreshTokens(), 'token-acesso-falso-', 'token-renovacao-falso-']
  const leaked = secrets.filter((secret) => JSON.stringify(report).includes(secret))
  if (leaked.length) failures.push(`${leaked.length} segredo(s) do Google no relatório`)
  // Contrato 21 (CA7): nenhum segredo dos servidores MCP falsos no relatório.
  const mcpLeaked = Object.values(SMOKE_MCP_SECRETS).filter((secret) => JSON.stringify(report).includes(secret))
  if (mcpLeaked.length) failures.push(`${mcpLeaked.length} segredo(s) dos servidores MCP no relatório`)
  // Contrato 12 (CA11): nenhum token da Microsoft e nenhum dado da agenda (título, participante, link) no relatório.
  const calendarData = [...ctx.fixtures.microsoft.accessTokens(), ...ctx.fixtures.microsoft.refreshTokens(), 'token-ms-', 'Alinhamento com o jurídico', 'Status da obra', 'Orçamento do trimestre', 'Carla Dias', 'ana.lima@example.com', 'meet.google.com/smk', 'teams.microsoft.com/l/meetup-join/smoke']
  const calendarLeaked = calendarData.filter((value) => JSON.stringify(report).includes(value))
  if (calendarLeaked.length) failures.push(`${calendarLeaked.length} dado(s) da agenda ou token da Microsoft no relatório`)
  writeFileSync(join(ctx.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  clearTimeout(timer)

  for (const failure of failures) console.error(`[smoke] ${failure}`)
  console.log(`[smoke] ${screenshots.length} PNGs e report.json em ${ctx.outDir}; ${failures.length ? 'FALHOU' : 'ok'}`)
  return failures.length ? 1 : 0
}
