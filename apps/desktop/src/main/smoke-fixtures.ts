// Fixtures do smoke para o LLM Gateway e o macOS: nenhuma requisição sai da máquina, nenhum diálogo
// abre. O catálogo é a resposta real de `GET /v1/models` de 14/11/2026 reduzida aos campos que o app lê
// (a resposta inteira fica em test/fixtures/assemblyai/models.json); os corpos de erro também são reais.
// A chave é fictícia: só os quatro últimos caracteres aparecem na tela (••••4f2a, como no mockup).
import { createFakeEmail, type FakeEmail } from './email/fake-email'
import type { EmailNotice } from './email/notify'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { BrowserWindow } from 'electron'
import { updateAssetName } from '../shared/updates'
import type { FetchInit, FetchLike, FetchResponse } from './assemblyai/gateway'
import type { ExecFile } from './claude-cli/locate'
import type { SpawnSummary } from './claude-cli/summary'
import type { SpawnClaude } from './claude-cli/translator'
import type { SpawnAcp } from './acp/agent'
import { NPM_REGISTRY, type AcpPackage, type DownloadTarball } from './acp/install'
import { createFakeGoogle, type FakeGoogle } from './google/fake-google'
import { createFakeMicrosoft, type FakeMicrosoft } from './microsoft/fake-microsoft'
import { createFakeInstagram, type FakeInstagram } from './redes/fake-instagram'
import { createFakeS3, type FakeS3 } from './redes/fake-s3'
import type { HttpFetch, HttpResponse } from './accounts/http'
import type { CalendarNoticeKind } from '../shared/calendar'
import { fakeMediaAccess } from './permissions'
import { writeFakeIndex } from './whatsapp/fake-index'
import type { DownloadRequest } from './updates/download'
import { LATEST_RELEASE_URL, RELEASE_DOWNLOAD_PREFIX } from './updates/release'

/** Chave inventada do smoke. As chaves digitadas pelo smoke dizem o que o gateway falso responde. */
export const SMOKE_FAKE_KEY = 'smoke-chave-ficticia-0000-4f2a'
/** Chave que o gateway falso recusa (401). */
export const SMOKE_REFUSED_KEY = 'smoke-chave-recusada-9999'
/** Chave cuja validação cai em falha de rede. */
export const SMOKE_OFFLINE_KEY = 'smoke-chave-sem-rede-7c1e'
/**
 * Modelos que o gateway falso responde como não liberado (o 400 real; a conta de teste não tem o
 * gpt-oss-20b liberado, conferido em 14/11/2026) e por falha de rede.
 */
/** Contrato 37: o texto que a transcrição falsa do áudio do WhatsApp devolve. */
export const SMOKE_AUDIO_TRANSCRIPT = 'Oi, aqui é o Bruno. O contrato revisado já está no seu e-mail.'
export const SMOKE_NOT_ALLOWED_MODEL = 'gpt-oss-20b'
export const SMOKE_OFFLINE_MODEL = 'deepseek-v4.1-flash'
/** Cadastro OAuth inventado do Google falso (contrato 11): o smoke cola os dois em Configurações › Contas. */
export const SMOKE_GOOGLE_CLIENT_ID = '000000000000-smokefalso.apps.googleusercontent.com'
export const SMOKE_GOOGLE_CLIENT_SECRET = 'smoke-segredo-falso-0000'
/** ID de aplicativo inventado da Microsoft falsa (contrato 12): o smoke cola em Configurações › Contas. */
export const SMOKE_MICROSOFT_CLIENT_ID = '00000000-0000-4000-8000-00000000abcd'
/**
 * Contrato 69: o armazenamento S3 falso que o smoke digita em Configurações › Contas › Armazenamento de mídia. Endereços
 * no próprio Mac (o `http://` só vale em 127.0.0.1), numa porta onde nada escuta: quem responde é o `fake-s3` em memória.
 */
export const SMOKE_S3_ENDPOINT = 'http://127.0.0.1:9/s3'
export const SMOKE_S3_PUBLIC_BASE_URL = 'http://127.0.0.1:9/publico'
export const SMOKE_S3_REGION = 'auto'
export const SMOKE_S3_BUCKET = 'lap-midia-smoke'
export const SMOKE_S3_ACCESS_KEY_ID = 'AKSMOKEFALSA0000'
/** A chave secreta inventada: nunca pode sair do cofre (o smoke procura em claro no `userData`, na tela e no relatório). */
export const SMOKE_S3_SECRET_ACCESS_KEY = 'smoke-chave-secreta-s3-falsa-0000'

const notFound = (): HttpResponse => {
  const bytes = Buffer.from('{"error":"não encontrado"}', 'utf8')
  return { status: 404, header: () => null, text: () => Promise.resolve(bytes.toString('utf8')), bytes: () => Promise.resolve(new Uint8Array(bytes)) }
}

/** Contrato 69: o `fetch` das redes no smoke: os hosts do S3 falso, o Instagram falso e 404 para o resto. */
function redesRouter(instagram: FakeInstagram, s3: FakeS3): HttpFetch {
  const s3Hosts = new Set([new URL(SMOKE_S3_ENDPOINT).host, new URL(SMOKE_S3_PUBLIC_BASE_URL).host])
  return (url, init) => {
    const host = new URL(url).host
    if (s3Hosts.has(host)) return s3.fetch(url, init)
    if (host === 'graph.instagram.com') return instagram.fetch(url, init)
    return Promise.resolve(notFound())
  }
}

const CATALOG = {
  data: [
  {"id":"qwen3.5-4b-32k-fast","name":"Qwen3.5 4B Fast","context_length":32768,"pricing":{"global":{"completions":0.5,"prompt":0.1}}},
  {"id":"claude-haiku-4-5-20251001","name":"Haiku 4.5","context_length":200000,"pricing":{"global":{"completions":5,"prompt":1,"input_cache_read":0.1,"input_cache_write":1.25,"input_cache_write_1h":2},"regional_increase_percent":0.1}},
  {"id":"claude-haiku-5-5","name":"Haiku 5.5","context_length":1000000,"pricing":{"global":{"completions":0.5,"prompt":0.1,"input_cache_read":0.01,"input_cache_write":0.125,"input_cache_write_1h":0.2},"regional_increase_percent":0.1}},
  {"id":"claude-opus-4-5-20251101","name":"Opus 4.5","context_length":200000,"pricing":{"global":{"completions":25,"prompt":5,"input_cache_read":0.5,"input_cache_write":6.25,"input_cache_write_1h":10},"regional_increase_percent":0.1}},
  {"id":"claude-opus-4-6","name":"Opus 4.6","context_length":200000,"pricing":{"global":{"completions":25,"prompt":5,"input_cache_read":0.5,"input_cache_write":6.25,"input_cache_write_1h":10},"regional_increase_percent":0.1}},
  {"id":"claude-opus-4-7","name":"Opus 4.7","context_length":1000000,"pricing":{"global":{"completions":25,"prompt":5,"input_cache_read":0.5,"input_cache_write":6.25,"input_cache_write_1h":10},"regional_increase_percent":0.1}},
  {"id":"claude-opus-4-8","name":"Opus 4.8","context_length":1000000,"pricing":{"global":{"completions":25,"prompt":5,"input_cache_read":0.5,"input_cache_write":6.25,"input_cache_write_1h":10},"regional_increase_percent":0.1}},
  {"id":"claude-opus-5","name":"Opus 5","context_length":200000,"pricing":{"global":{"completions":25,"prompt":5,"input_cache_read":0.5,"input_cache_write":6.25,"input_cache_write_1h":10},"regional_increase_percent":0.1}},
  {"id":"claude-opus-5-5","name":"Opus 5.5","context_length":1000000,"pricing":{"global":{"completions":20,"prompt":4,"input_cache_read":0.2,"input_cache_write":5,"input_cache_write_1h":8},"regional_increase_percent":0.1}},
  {"id":"claude-sonnet-4-5-20250929","name":"Sonnet 4.5","context_length":200000,"pricing":{"global":{"completions":15,"prompt":3,"input_cache_read":0.3,"input_cache_write":3.75,"input_cache_write_1h":6},"regional_increase_percent":0.1}},
  {"id":"claude-sonnet-4-6","name":"Sonnet 4.6","context_length":200000,"pricing":{"global":{"completions":15,"prompt":3,"input_cache_read":0.3,"input_cache_write":3.75,"input_cache_write_1h":6},"regional_increase_percent":0.1}},
  {"id":"claude-sonnet-5","name":"Sonnet 5","context_length":200000,"pricing":{"global":{"completions":15,"prompt":3,"input_cache_read":0.3,"input_cache_write":3.75,"input_cache_write_1h":6},"regional_increase_percent":0.1}},
  {"id":"claude-sonnet-5-5","name":"Sonnet 5.5","context_length":1000000,"pricing":{"global":{"completions":10,"prompt":2,"input_cache_read":0.1,"input_cache_write":2.5,"input_cache_write_1h":4},"regional_increase_percent":0.1}},
  {"id":"deepseek-v4.1-flash","name":"DeepSeek V4.1 Flash","context_length":1048576,"pricing":{"global":{"completions":1.2,"prompt":0.3,"input_cache_read":0.006}}},
  {"id":"deepseek-v4.1-flash-1017","name":"DeepSeek V4.1 Flash 1017","context_length":1048576,"pricing":{"global":{"completions":1.2,"prompt":0.3,"input_cache_read":0.006}}},
  {"id":"gemini-2.5-flash","name":"Gemini 2.5 Flash","context_length":1048576,"pricing":{"global":{"completions":2.5,"prompt":0.3,"input_cache_read":0.03},"regional_increase_percent":0.1}},
  {"id":"gemini-2.5-flash-lite","name":"Gemini 2.5 Flash Lite","context_length":1048576,"pricing":{"global":{"completions":0.4,"prompt":0.1,"input_cache_read":0.01},"regional_increase_percent":0.1}},
  {"id":"gemini-2.5-pro","name":"Gemini 2.5 Pro","context_length":200000,"pricing":{"global":{"completions":10,"prompt":1.25,"input_cache_read":0.125},"regional_increase_percent":0.1}},
  {"id":"gemini-3.1-flash-lite","name":"Gemini 3.1 Flash Lite","context_length":1048575,"pricing":{"global":{"completions":1.5,"prompt":0.25,"input_cache_read":0.025},"regional_increase_percent":0.1}},
  {"id":"gemini-3.5-flash","name":"Gemini 3.5 Flash","context_length":1048575,"pricing":{"global":{"completions":9,"prompt":1.25,"input_cache_read":0.125},"regional_increase_percent":0.1}},
  {"id":"gemini-3.5-flash-lite","name":"Gemini 3.5 Flash Lite","context_length":1048575,"pricing":{"global":{"completions":2.5,"prompt":0.3,"input_cache_read":0.03},"regional_increase_percent":0.1}},
  {"id":"gemini-3.6-flash","name":"Gemini 3.6 Flash","context_length":1048575,"pricing":{"global":{"completions":7.5,"prompt":1.5,"input_cache_read":0.15},"regional_increase_percent":0.1}},
  {"id":"gemini-3.7-flash","name":"Gemini 3.7 Flash","context_length":1048575,"pricing":{"global":{"completions":3.75,"prompt":0.75,"input_cache_read":0.075},"regional_increase_percent":0.1}},
  {"id":"gemini-3.8-flash","name":"Gemini 3.8 Flash","context_length":1048575,"pricing":{"global":{"completions":3.75,"prompt":0.75,"input_cache_read":0.075},"regional_increase_percent":0.1}},
  {"id":"gemini-4-argon","name":"Gemini 4 Argon","context_length":1048576,"pricing":{"global":{"completions":10,"prompt":2,"input_cache_read":0.1},"regional_increase_percent":0.1}},
  {"id":"gemini-4-hydrogen","name":"Gemini 4 Hydrogen","context_length":1048576,"pricing":{"global":{"completions":7.5,"prompt":1.5,"input_cache_read":0.075},"regional_increase_percent":0.1}},
  {"id":"gemma-4-31b","name":"gemma-4-31b","context_length":256000,"pricing":{"global":{"completions":0.4,"prompt":0.14}}},
  {"id":"mercury-3","name":"Mercury 3","context_length":1000000,"pricing":{"global":{"completions":0.35,"prompt":0.1,"input_cache_read":0.01}}},
  {"id":"mercury-voice","name":"Mercury Voice","context_length":128000,"pricing":{"global":{"completions":0.75,"prompt":0.2,"input_cache_read":0.02}}},
  {"id":"muse-spark-open","name":"Muse Spark Open","context_length":1000000,"pricing":{"global":{"completions":4.25,"prompt":1.25,"input_cache_read":0.15}}},
  {"id":"minimax-m3","name":"Minimax M3","context_length":512000,"pricing":{"global":{"completions":1.2,"prompt":0.3,"input_cache_read":0.06}}},
  {"id":"kimi-k3","name":"Kimi K3","context_length":1000000,"pricing":{"global":{"completions":15,"prompt":3,"input_cache_read":0.3,"input_cache_write":3.75},"regional_increase_percent":0.1}},
  {"id":"kimi-k3.1-pro","name":"Kimi K3.1 Pro","context_length":1048576,"pricing":{"global":{"completions":10,"prompt":2,"input_cache_read":0.2}}},
  {"id":"nemotron-3-nano-30b-a3b","name":"Nemotron 3 Nano 30B A3B","context_length":256000,"pricing":{"us":{"completions":0.24,"prompt":0.06},"eu":{"completions":0.28,"prompt":0.07},"global":{"completions":0.24,"prompt":0.06}}},
  {"id":"nemotron-3-super-120b-a12b","name":"Nemotron 3 Super 120B A12B","context_length":256000,"pricing":{"us":{"completions":0.65,"prompt":0.15},"eu":{"completions":0.78,"prompt":0.18},"global":{"completions":0.65,"prompt":0.15}}},
  {"id":"nemotron-lightning-3p5-30b-a3b","name":"Nemotron Lightning 3.5 30B A3B","context_length":262000,"pricing":{"global":{"completions":0.2,"prompt":0.05,"input_cache_read":0.01}}},
  {"id":"nemotron-nano-9b-v2","name":"Nemotron Nano 9B v2","context_length":128000,"pricing":{"us":{"completions":0.23,"prompt":0.06},"eu":{"completions":0.27,"prompt":0.07},"global":{"completions":0.23,"prompt":0.06}}},
  {"id":"gpt-oss-120b","name":"GPT OSS 120B","context_length":131072,"pricing":{"global":{"completions":0.6,"prompt":0.15}}},
  {"id":"gpt-oss-20b","name":"GPT OSS 20B","context_length":131072,"pricing":{"global":{"completions":0.3,"prompt":0.07}}},
  {"id":"gpt-4.1","name":"GPT-4.1","context_length":1047576,"pricing":{"global":{"completions":8,"prompt":2,"input_cache_read":0.5},"regional_increase_percent":0.1}},
  {"id":"gpt-5","name":"GPT-5","context_length":400000,"pricing":{"global":{"completions":10,"prompt":1.25,"input_cache_read":0.125},"regional_increase_percent":0.1}},
  {"id":"gpt-5-nano","name":"GPT-5 Nano","context_length":400000,"pricing":{"global":{"completions":0.4,"prompt":0.05,"input_cache_read":0.005},"regional_increase_percent":0.1}},
  {"id":"gpt-5-mini","name":"GPT-5 mini","context_length":400000,"pricing":{"global":{"completions":2,"prompt":0.25,"input_cache_read":0.025},"regional_increase_percent":0.1}},
  {"id":"gpt-5.1","name":"GPT-5.1","context_length":400000,"pricing":{"global":{"completions":10,"prompt":1.25,"input_cache_read":0.125},"regional_increase_percent":0.1}},
  {"id":"gpt-5.2","name":"GPT-5.2","context_length":400000,"pricing":{"global":{"completions":14,"prompt":1.75,"input_cache_read":0.175},"regional_increase_percent":0.1}},
  {"id":"gpt-5.5","name":"GPT-5.5","context_length":272000,"pricing":{"global":{"completions":30,"prompt":5,"input_cache_read":0.5},"regional_increase_percent":0.1}},
  {"id":"gpt-5.6-luna","name":"GPT-5.6 Luna","context_length":270000,"pricing":{"global":{"completions":1.2,"prompt":0.2,"input_cache_read":0.02,"input_cache_write":0.25},"regional_increase_percent":0.1}},
  {"id":"gpt-5.6-sol","name":"GPT-5.6 Sol","context_length":270000,"pricing":{"global":{"completions":20,"prompt":4,"input_cache_read":0.4,"input_cache_write":5},"regional_increase_percent":0.1}},
  {"id":"gpt-5.6-terra","name":"GPT-5.6 Terra","context_length":270000,"pricing":{"global":{"completions":12,"prompt":2,"input_cache_read":0.2,"input_cache_write":2.5},"regional_increase_percent":0.1}},
  {"id":"gpt-6-astra","name":"GPT-6 Astra","context_length":270000,"pricing":{"global":{"completions":50,"prompt":10,"input_cache_read":1,"input_cache_write":12.5},"regional_increase_percent":0.1}},
  {"id":"gpt-6-luna","name":"GPT-6 Luna","context_length":922000,"pricing":{"global":{"completions":0.5,"prompt":0.1,"input_cache_read":0.01,"input_cache_write":0.125},"regional_increase_percent":0.1}},
  {"id":"gpt-6-sol","name":"GPT-6 Sol","context_length":922000,"pricing":{"global":{"completions":10,"prompt":2,"input_cache_read":0.2,"input_cache_write":2.5},"regional_increase_percent":0.1}},
  {"id":"gpt-6.1-sol","name":"GPT-6.1 Sol","context_length":922000,"pricing":{"global":{"completions":10,"prompt":2,"input_cache_read":0.1,"input_cache_write":2.5},"regional_increase_percent":0.1}},
  {"id":"gpt-6.1-terra","name":"GPT-6.1 Terra","context_length":922000,"pricing":{"global":{"completions":5,"prompt":1,"input_cache_read":0.05,"input_cache_write":1.25},"regional_increase_percent":0.1}},
  {"id":"qwen3-32B","name":"Qwen3 32B","context_length":200000,"pricing":{"global":{"completions":0.6,"prompt":0.15}}},
  {"id":"qwen3-next-80b-a3b","name":"Qwen3 Next 80B A3B","context_length":200000,"pricing":{"global":{"completions":1.2,"prompt":0.15}}},
  {"id":"beam-1.0","name":"Beam 1.0","context_length":1048576,"pricing":{"global":{"completions":1.2,"prompt":0.4,"input_cache_read":0.04}}},
  {"id":"glm-5.3","name":"GLM-5.3","context_length":1040000,"pricing":{"global":{"completions":3.4,"prompt":0.95,"input_cache_read":0.2}}},
  {"id":"glm-5.3-flash","name":"GLM-5.3 Flash","context_length":1040000,"pricing":{"global":{"completions":0.5,"prompt":0.15,"input_cache_read":0.03}}},
  {"id":"grok-4.7","name":"Grok 4.7","context_length":500000,"pricing":{"global":{"completions":6,"prompt":2,"input_cache_read":0.5},"regional_increase_percent":0.1}},
  ],
}

const CHAT_OK = {
  model: 'qwen3.5-4b-32k-fast',
  choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: 'Great' } }],
  usage: { prompt_tokens: 13, completion_tokens: 1, total_tokens: 14 },
}
const NOT_ALLOWED = {
  metadata: { errors: ['Your account does not have access to this LLM Gateway model'] },
  message: 'invalid request body',
  code: 400,
}
const EMPTY_BODY = {
  metadata: { errors: ['model is a required field', 'one of messages or prompt required', 'model  is not supported'] },
  message: 'invalid request body',
  code: 400,
}
const AUTH_ERROR = { error: 'Authentication error, API token missing/invalid', status: 'error' }

export interface SmokeCall {
  method: string
  path: string
  model: string | null
  /** Se o cabeçalho `authorization` veio (o valor nunca é guardado). */
  authorized: boolean
}

export interface SmokeFixtures {
  fetch: FetchLike
  media: ReturnType<typeof fakeMediaAccess>
  /** URLs que o app pediu para abrir no navegador ou nos Ajustes (o smoke não abre nada). */
  openedUrls: string[]
  /** Textos que o app "copiou": o clipboard do Mac nunca é tocado no smoke. */
  copiedTexts: string[]
  calls: SmokeCall[]
  /** Contrato 37: os uploads de áudio à AssemblyAI falsa (tamanho e se é um WAV); nada sai da máquina. */
  audioUploads: { bytes: number; wav: boolean }[]
  /** Liga a falha de rede no catálogo. */
  failCatalog: boolean
  /** O `claude` falso some: `--version` falha e a busca dá "não encontrado". */
  claudeMissing: boolean
  /** Processos do `claude` falso abertos pelo app: argumentos, pasta e nomes das variáveis de ambiente. */
  claudeSpawns: { args: string[]; cwd: string; envNames: string[]; exited: boolean }[]
  /**
   * Processos do agente ACP falso (contrato 17): o script, os nomes das variáveis de ambiente, o `claude` que
   * o adaptador rodaria e se o processo já saiu.
   */
  acpSpawns: { entry: string; envNames: string[]; claudeExecutable: string | null; exited: boolean }[]
  /** Smoke: o "adaptador" não abre (pacote corrompido), para conferir o botão "Usar a linha de comando". */
  acpBroken: boolean
  /** Pedidos ao registro falso do npm (caminhos dos tarballs). */
  registryCalls: string[]
  /** O que o diálogo de escolher pasta "responde" (o diálogo nativo nunca abre no smoke); `null` cancela. */
  chosenFolder: string | null
  /** Arquivos que o app pediu para abrir ou mostrar no Finder (nada abre de verdade). */
  openedFiles: { action: 'open' | 'reveal'; path: string }[]
  /** Onde o diálogo de salvar abriria (o nativo nunca abre no smoke). */
  saveDialogs: string[]
  /** O que o diálogo de salvar "responde"; `null` cancela. */
  savePath: string | null
  /** O que o diálogo de escolher o logo "responde"; `null` cancela (contrato 09). */
  chosenImage: string | null
  /** Contrato 39: o arquivo que o clipe do WhatsApp "escolhe"; `null` cancela. */
  chosenAttachment: string | null
  /** Cada troca do ícone do Dock (`app.dock` nunca é tocado no smoke). */
  dockIcons: ('custom' | 'default' | 'skipped')[]
  /** API do GitHub e download do release falsos (contrato 14). */
  updates: SmokeUpdates
  /** Bloqueio do app (contrato 22): Touch ID, relógio e `powerMonitor` substitutos. */
  lock: SmokeLock
  /** Diálogos de "gravação em andamento" ao fechar ou sair (o nativo nunca abre no smoke). */
  leaveDialogs: { message: string; buttons: string[] }[]
  /** Botão que o substituto "clica" (0 é "Cancelar"). */
  leaveChoice: number
  /** Google falso (contrato 11): token, perfil, foto e Drive em memória; nada sai da máquina. */
  google: FakeGoogle
  /** WhatsApp (contrato 24): o índice de pacotes falso numa pasta local (o serviço é o `backend_fake.py`). */
  whatsapp: { indexDir: string; requirements: string }
  /** Automações (contrato 23): relógio, notificações, ícone da barra de menus, Dock e "abrir ao entrar" substitutos. */
  automations: SmokeAutomations
  /** Microsoft falsa (contrato 12): token, perfil, foto e agendas em memória; nada sai da máquina. */
  microsoft: FakeMicrosoft
  /** Contrato 69: o Instagram falso (perfil e renovação do token) e o relógio das redes; nada sai da máquina. */
  instagram: FakeInstagram
  /** Contrato 69: o armazenamento S3 falso (assinatura conferida), para o "Testar" do armazenamento de mídia. */
  s3: FakeS3
  /** Contrato 69: o `fetch` que o serviço das redes usa no smoke (S3 falso, Instagram falso, 404 para o resto). */
  redesFetch: HttpFetch
  /** Agendas (contrato 12): as notificações substitutas. */
  calendar: SmokeCalendar
  /** Aviso de reunião (contrato 48): cada janela do aviso que o app abriu, na ordem. */
  meetingPrompt: { windows: BrowserWindow[] }
  /** Contrato 49: o arquivo de onde o `lap-mic-watch` falso tira as linhas que escreve (o smoke acrescenta nele). */
  micWatch: { file: string }
  /**
   * Contrato 62 (CA24): o `lap-calendar` falso (test/fixtures/fake-lap-calendar.mjs). O smoke escreve o estado dele em
   * `statePath` (o falso relê a cada requisição; ausente = `full`, "Trabalho" e "Feriados") e lê o que ele recebeu em
   * `log()`, uma requisição por item.
   */
  macCalendar: { statePath: string; logPath: string; log(): Record<string, unknown>[] }
  /** Notificações do WhatsApp (contrato 40): as substitutas, o foco fingido e o número do Dock. */
  whatsappNotify: SmokeWhatsAppNotify
  /** Contrato 43: o servidor de email falso (IMAP, SMTP e imagens remotas em memória). */
  email: FakeEmail
  /** Contrato 43: as notificações de email substitutas e o foco fingido. */
  emailNotify: SmokeEmailNotify
  /** Contrato 43: os arquivos que o clipe do composer do email "escolhe"; vazio cancela. */
  chosenEmailAttachments: string[]
}

export interface SmokeEmailNotify {
  notifications: (EmailNotice & { closed: boolean; open: () => void })[]
  focusedContentsId: number | null
}

export interface SmokeWhatsAppNotify {
  /** Notificações que o app mostraria; `open` faz o clique; `closed` marca as que uma rajada trocou. */
  notifications: { chatId: string; title: string; body: string; count: number; icon: boolean; closed: boolean; open: () => void }[]
  /** Id do `webContents` da janela "em foco" (as janelas do smoke são invisíveis e nunca ganham foco de verdade). */
  focusedContentsId: number | null
  /** `app.setBadgeCount` pedidos (o Dock de verdade fica intacto). */
  badges: number[]
}

export interface SmokeCalendar {
  /** Notificações que o app mostraria (a de verdade nunca aparece no smoke); `act` faz o clique em "Gravar". */
  notifications: { kind: CalendarNoticeKind; title: string; body: string; actions: string[]; act: () => void }[]
}

export interface SmokeAutomations {
  /** Quanto o relógio do agendador está adiantado: o smoke "avança o relógio" por aqui. */
  skewMs: number
  /** Notificações do macOS que o app mostraria (a de verdade nunca aparece no smoke). */
  notifications: { title: string; body: string; runId: string | null }[]
  /** Cada troca da imagem do ícone da barra de menus (o `Tray` de verdade nunca é criado no smoke). */
  trayImages: string[]
  /** Contrato 50: cada texto posto ao lado do ícone (o tempo da gravação; vazio, nenhum). */
  trayTitles: string[]
  /** `app.dock.hide()` / `show()` pedidos ao fechar a última janela e ao reabrir (o Dock de verdade fica intacto). */
  dock: { hides: number; shows: number }
  /** `app.setLoginItemSettings` pedidos (nada entra nos itens de login do Mac). */
  loginItems: { openAtLogin: boolean; openAsHidden: boolean }[]
  /** "Sair" pedido pelo ícone ou por "Ao fechar a janela: Sair do app" (o smoke nunca sai por eles). */
  quitRequests: number
}

export interface SmokeLock {
  /** Quanto o relógio do bloqueio está adiantado: a espera depois dos erros passa sem esperar de verdade. */
  skewMs: number
  touchIdAvailable: boolean
  /** O que o Touch ID substituto responde (o de verdade nunca é pedido no smoke). */
  touchIdApproves: boolean
  touchIdPrompts: number
  /** `powerMonitor` substituto: o smoke emite `lock-screen` e `suspend`. */
  power: EventEmitter
  /** Reavisa o estado do bloqueio às janelas (ligado pelo main), depois de adiantar o relógio. */
  refresh: () => void
}

export interface SmokeUpdates {
  fetch: FetchLike
  request: DownloadRequest
  /** Versão do release falso: a atual com o `minor` + 1. */
  version: string
  notes: string
  /** Conteúdo do `.dmg` falso e o SHA-256 dele. */
  dmg: Buffer
  sha256: string
  /** O `.sha256` do release falso traz outro hash (o download não confere). */
  wrongHash: boolean
  /** Pedidos à API e ao download: URL, `User-Agent` e os nomes dos cabeçalhos (nunca mais que isso). */
  calls: { url: string; userAgent: string; headerNames: string[] }[]
  /** Redirecionamentos que o app aceitou seguir. */
  redirects: string[]
  /** Vezes que "Fechar o app agora" pediu para sair (o smoke nunca sai por ele). */
  quitRequests: number
}

const SMOKE_DMG_CHUNKS = 8
const SMOKE_DMG_CHUNK_DELAY_MS = 120

/**
 * Release falso para a versão atual + 1 no `minor`: API, `.dmg` de 8 pedaços entregues devagar (o
 * "Baixando… N%" aparece) e o `.sha256`. O download passa pelo redirecionamento para o armazenamento de
 * assets, como no GitHub; nenhum pedido sai da máquina.
 */
export function createSmokeUpdates(currentVersion: string): SmokeUpdates {
  const [major = 0, minor = 0] = currentVersion.split('.').map(Number)
  const version = `${major}.${minor + 1}.0`
  const name = updateAssetName(version)
  const dmg = Buffer.alloc(SMOKE_DMG_CHUNKS * 4096, 'LAP Reuniões smoke dmg ')
  const sha256 = createHash('sha256').update(dmg).digest('hex')
  const base = `${RELEASE_DOWNLOAD_PREFIX}v${version}/`
  const updates: SmokeUpdates = {
    version,
    notes: 'Novidades desta versão:\n- Aviso de versão nova na barra lateral.\n- Atualização pelo GitHub com o arquivo conferido.',
    dmg,
    sha256,
    wrongHash: false,
    calls: [],
    redirects: [],
    quitRequests: 0,
    fetch: (url, init) => {
      updates.calls.push({ url, userAgent: init.headers['user-agent'] ?? '', headerNames: Object.keys(init.headers).sort() })
      if (url !== LATEST_RELEASE_URL) return Promise.resolve(reply(404, { message: 'Not Found' }))
      return Promise.resolve(
        reply(200, {
          tag_name: `v${version}`,
          draft: false,
          prerelease: false,
          body: updates.notes,
          assets: [
            { name, browser_download_url: `${base}${name}`, size: dmg.length },
            { name: `${name}.sha256`, browser_download_url: `${base}${name}.sha256`, size: 100 },
          ],
        }),
      )
    },
    request: (url, { headers, allowRedirect, signal }) => {
      updates.calls.push({ url, userAgent: headers['user-agent'] ?? '', headerNames: Object.keys(headers).sort() })
      const file = url.slice(base.length)
      const storage = `https://release-assets.githubusercontent.com/github-production-release-asset/smoke/${encodeURIComponent(file)}`
      if (!url.startsWith(base) || (file !== name && file !== `${name}.sha256`)) return Promise.resolve({ status: 404, chunks: (async function* () {})() })
      if (!allowRedirect(storage)) return Promise.reject(new Error(`redirecionamento recusado: ${storage}`))
      updates.redirects.push(storage)
      if (file !== name) {
        const hash = updates.wrongHash ? createHash('sha256').update('outro arquivo').digest('hex') : sha256
        return Promise.resolve({ status: 200, chunks: (async function* () { yield Buffer.from(`${hash}  ${name}\n`) })() })
      }
      return Promise.resolve({
        status: 200,
        chunks: (async function* () {
          for (let i = 0; i < SMOKE_DMG_CHUNKS && !signal.aborted; i++) {
            await new Promise((resolve) => setTimeout(resolve, SMOKE_DMG_CHUNK_DELAY_MS))
            yield dmg.subarray(i * 4096, (i + 1) * 4096)
          }
        })(),
      })
    },
  }
  return updates
}

const reply = (status: number, body: unknown): FetchResponse => ({ status, text: () => Promise.resolve(JSON.stringify(body)) })

/** Contrato 62 (CA24): as requisições que o `lap-calendar` falso recebeu, uma por linha do `.jsonl`. */
function readFakeCalendarLog(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

export function createSmokeFixtures(currentVersion: string, userDataDir: string): SmokeFixtures {
  const fixtures: SmokeFixtures = {
    updates: createSmokeUpdates(currentVersion),
    media: fakeMediaAccess('not-determined'),
    openedUrls: [],
    copiedTexts: [],
    calls: [],
    audioUploads: [],
    failCatalog: false,
    claudeMissing: false,
    claudeSpawns: [],
    acpSpawns: [],
    acpBroken: false,
    registryCalls: [],
    chosenFolder: null,
    openedFiles: [],
    saveDialogs: [],
    savePath: null,
    chosenImage: null,
    chosenAttachment: null,
    dockIcons: [],
    leaveDialogs: [],
    leaveChoice: 0,
    google: createFakeGoogle({ clientId: SMOKE_GOOGLE_CLIENT_ID, clientSecret: SMOKE_GOOGLE_CLIENT_SECRET, profile: { name: 'Andrea Teste', email: 'andrea.teste@example.com' } }),
    whatsapp: writeFakeIndex(join(userDataDir, 'whatsapp-indice-falso')),
    automations: { skewMs: 0, notifications: [], trayImages: [], trayTitles: [], dock: { hides: 0, shows: 0 }, loginItems: [], quitRequests: 0 },
    microsoft: createFakeMicrosoft({ clientId: SMOKE_MICROSOFT_CLIENT_ID, profile: { name: 'Bruno Teste', email: 'bruno.teste@example.com' } }),
    instagram: createFakeInstagram(),
    s3: createFakeS3({ endpoint: SMOKE_S3_ENDPOINT, bucket: SMOKE_S3_BUCKET, publicBaseUrl: SMOKE_S3_PUBLIC_BASE_URL, accessKeyId: SMOKE_S3_ACCESS_KEY_ID, secretAccessKey: SMOKE_S3_SECRET_ACCESS_KEY, strictSignature: true }),
    redesFetch: () => Promise.resolve(notFound()),
    calendar: { notifications: [] },
    meetingPrompt: { windows: [] },
    micWatch: { file: join(userDataDir, 'mic-watch-falso.jsonl') },
    macCalendar: {
      statePath: join(userDataDir, 'lap-calendar-falso.json'),
      logPath: join(userDataDir, 'lap-calendar-falso.jsonl'),
      log: () => readFakeCalendarLog(join(userDataDir, 'lap-calendar-falso.jsonl')),
    },
    whatsappNotify: { notifications: [], focusedContentsId: null, badges: [] },
    email: createFakeEmail(),
    emailNotify: { notifications: [], focusedContentsId: null },
    chosenEmailAttachments: [],
    lock: { skewMs: 0, touchIdAvailable: true, touchIdApproves: true, touchIdPrompts: 0, power: new EventEmitter(), refresh: () => undefined },
    fetch: (url: string, init: FetchInit) => {
      const path = new URL(url).pathname
      const auth = init.headers['authorization'] ?? ''
      let model: string | null = null
      if (typeof init.body === 'string' && path === '/v1/chat/completions') {
        const parsed = JSON.parse(init.body) as { model?: unknown }
        model = typeof parsed.model === 'string' ? parsed.model : null
      }
      fixtures.calls.push({ method: init.method, path, model, authorized: auth !== '' })
      const offline = (): Promise<FetchResponse> => Promise.reject(new TypeError('fetch failed'))

      if (init.method === 'GET' && path === '/v1/models') return fixtures.failCatalog ? offline() : Promise.resolve(reply(200, CATALOG))
      // Token temporário de streaming: token fictício, nenhuma conexão é aberta no smoke.
      if (init.method === 'GET' && path === '/v3/token') return Promise.resolve(reply(200, { token: 'smoke-token-ficticio-0000', expires_in_seconds: 60 }))
      // Contrato 37: a transcrição do áudio do WhatsApp (upload, pedido e consulta), com respostas fictícias.
      if (path.startsWith('/v2/') && auth !== SMOKE_FAKE_KEY) return Promise.resolve(reply(401, { error: 'Authentication error, API token missing/invalid' }))
      if (init.method === 'POST' && path === '/v2/upload') {
        const body = init.body instanceof Uint8Array ? init.body : new Uint8Array()
        fixtures.audioUploads.push({ bytes: body.byteLength, wav: Buffer.from(body.subarray(0, 4)).toString('latin1') === 'RIFF' })
        return Promise.resolve(reply(200, { upload_url: 'https://cdn.assemblyai.com/upload/smoke-audio-ficticio' }))
      }
      if (init.method === 'POST' && path === '/v2/transcript') return Promise.resolve(reply(200, { id: 'smoke-transcricao-1', status: 'queued' }))
      if (init.method === 'GET' && path === '/v2/transcript/smoke-transcricao-1') return Promise.resolve(reply(200, { id: 'smoke-transcricao-1', status: 'completed', text: SMOKE_AUDIO_TRANSCRIPT }))
      if (init.method !== 'POST' || path !== '/v1/chat/completions') return Promise.resolve(reply(404, { message: 'not found' }))
      if (auth === SMOKE_OFFLINE_KEY) return offline()
      if (!auth || auth === SMOKE_REFUSED_KEY) return Promise.resolve(reply(401, AUTH_ERROR))
      if (model === null) return Promise.resolve(reply(400, EMPTY_BODY))
      if (model === SMOKE_NOT_ALLOWED_MODEL) return Promise.resolve(reply(400, NOT_ALLOWED))
      if (model === SMOKE_OFFLINE_MODEL) return offline()
      return Promise.resolve(reply(200, { ...CHAT_OK, model }))
    },
  }
  fixtures.redesFetch = redesRouter(fixtures.instagram, fixtures.s3)
  return fixtures
}

/**
 * `claude` falso do smoke: o script `test/fixtures/fake-claude.mjs` fala o mesmo protocolo `stream-json`
 * e roda no próprio Electron como Node. Só esse caminho é aceito; qualquer outro (inclusive o `claude` de
 * verdade) falha como se não existisse.
 */
export function createSmokeClaude(scriptPath: string, fixtures: SmokeFixtures): { exec: ExecFile; spawn: SpawnClaude; spawnSummary: SpawnSummary; candidates: string[] } {
  const asNode = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, ELECTRON_RUN_AS_NODE: '1' })
  const exec: ExecFile = (file, args, { timeoutMs, env }) =>
    new Promise((resolve, reject) => {
      if (file !== scriptPath || fixtures.claudeMissing) {
        reject(new Error(`smoke: ${file} não existe`))
        return
      }
      execFile(process.execPath, [scriptPath, ...args], { timeout: timeoutMs, env: asNode(env), encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(error)
        else resolve({ stdout })
      })
    })
  // O tradutor e o resumo abrem o mesmo binário falso; o resumo espera o `close` do processo.
  const spawnFake: SpawnClaude & SpawnSummary = (file, args, options) => {
    if (file !== scriptPath) throw new Error(`smoke: ${file} não existe`)
    const record = { args: [...args], cwd: options.cwd, envNames: Object.keys(options.env).sort(), exited: false }
    fixtures.claudeSpawns.push(record)
    const child = spawn(process.execPath, [scriptPath, ...args], { ...options, env: asNode(options.env) })
    child.on('exit', () => {
      record.exited = true
    })
    return child
  }
  return { exec, spawn: spawnFake, spawnSummary: spawnFake, candidates: [scriptPath] }
}

/** Tarball `.tgz` mínimo (ustar), com os arquivos sob `package/`: os pacotes do registro falso do smoke. */
export function smokeTarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = []
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8')
    const header = Buffer.alloc(512)
    header.write(`package/${name}`, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8, 'ascii')
    header.write('0000000\0', 108, 8, 'ascii')
    header.write('0000000\0', 116, 8, 'ascii')
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
    header.write('00000000000\0', 136, 12, 'ascii')
    header.write('        ', 148, 8, 'ascii')
    header.write('0', 156, 1, 'ascii')
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

/**
 * Agente ACP falso do smoke (contrato 17, CA10). A instalação baixa de um registro falso local (servidor
 * HTTP em 127.0.0.1, pelo `fetch` do Node: nada passa pela sessão do Chromium) pacotes pequenos com o
 * `integrity` calculado aqui; instalado, quem roda é `test/fixtures/fake-acp-agent.mjs`, com o mesmo Node do
 * Electron e o mesmo ambiente; o agente registra em `logPath` o que recebeu e o que o cliente respondeu. Com
 * `acpBroken`, o processo sai na hora (o adaptador que não sobe).
 */
export function createSmokeAcp(
  scriptPath: string,
  logPath: string,
  fixtures: SmokeFixtures,
): { entry: string; args: string[]; spawn: SpawnAcp; packagesFor: (pinned: readonly AcpPackage[]) => AcpPackage[]; download: DownloadTarball; close: () => void } {
  const spawnAcp: SpawnAcp = (file, args, options) => {
    const record = { entry: args[2] ?? '', envNames: Object.keys(options.env).sort(), claudeExecutable: options.env['CLAUDE_CODE_EXECUTABLE'] ?? null, exited: false }
    fixtures.acpSpawns.push(record)
    const child = spawn(file, fixtures.acpBroken ? ['-e', 'process.exit(3)'] : [...args], options)
    child.on('exit', () => {
      record.exited = true
    })
    return child
  }
  const tarballs = new Map<string, Buffer>()
  // Os mesmos nomes e caminhos dos pacotes pinados do perfil, com conteúdo pequeno e o hash calculado aqui.
  const packagesFor = (pinned: readonly AcpPackage[]): AcpPackage[] =>
    pinned.map((pkg, index) => {
      const files: Record<string, string> = { 'package.json': JSON.stringify({ name: pkg.name, version: pkg.version, license: 'falso' }) }
      // O primeiro pacote é o do agente: o script que o perfil roda.
      if (index === 0) files['dist/index.js'] = '// adaptador falso do smoke: quem roda é test/fixtures/fake-acp-agent.mjs\n'
      const data = smokeTarball(files)
      tarballs.set(pkg.path, data)
      return { ...pkg, integrity: `sha512-${createHash('sha512').update(data).digest('base64')}`, bytes: data.length }
    })
  const server = createServer((request, response) => {
    fixtures.registryCalls.push(request.url ?? '')
    const data = tarballs.get((request.url ?? '').slice(1))
    if (!data) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length }).end(data)
  })
  const registry = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`)
    })
  })
  // O instalador pede os endereços de verdade do npm; o smoke responde pelo servidor local.
  const download: DownloadTarball = async (url, onBytes) => {
    if (!url.startsWith(NPM_REGISTRY)) throw new Error('fora do registro do npm')
    const response = await fetch(`${await registry}${url.slice(NPM_REGISTRY.length)}`)
    if (!response.ok) throw new Error(`registro falso respondeu ${response.status}`)
    const data = new Uint8Array(await response.arrayBuffer())
    onBytes(data.length)
    return data
  }
  return { entry: scriptPath, args: ['--log', logPath], spawn: spawnAcp, packagesFor, download, close: () => server.close() }
}

/** Contrato 21: os segredos inventados dos servidores MCP falsos (o smoke confere que nenhum chega à tela nem ao relatório). */
export const SMOKE_MCP_SECRETS = { cli: 'segredo-do-cli-1234', http: 'segredo-http-5678', desktop: 'segredo-desktop-9012' } as const

/**
 * Contrato 21: o arquivo do `claude` falso com os servidores do escopo `user` (no formato do `~/.claude.json`) e o
 * `claude_desktop_config.json` falso, no userData do smoke. O servidor de comando local é o `fake-mcp-server.mjs` com o
 * Node do Electron; o HTTP do CLI aponta para um endereço `.example` que nunca é aberto. Devolve os caminhos e a
 * variável que diz ao `claude` falso onde está o arquivo dele.
 */
export function writeSmokeMcpFixtures(userData: string, serverScript: string): { cliFile: string; desktopFile: string; env: NodeJS.ProcessEnv } {
  const dir = join(userData, 'smoke-mcp')
  mkdirSync(dir, { recursive: true })
  const cliFile = join(dir, 'claude.json')
  const desktopFile = join(dir, 'claude_desktop_config.json')
  writeFileSync(
    cliFile,
    `${JSON.stringify(
      {
        mcpServers: {
          calculadora: { type: 'stdio', command: process.execPath, args: [serverScript], env: { ELECTRON_RUN_AS_NODE: '1', CALC_TOKEN: SMOKE_MCP_SECRETS.cli } },
          'docs-remoto': { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: `Bearer ${SMOKE_MCP_SECRETS.http}` } },
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    desktopFile,
    `${JSON.stringify({ mcpServers: { 'arquivos-desktop': { command: process.execPath, args: [serverScript], env: { ELECTRON_RUN_AS_NODE: '1', API_KEY: SMOKE_MCP_SECRETS.desktop } } } }, null, 2)}\n`,
  )
  return { cliFile, desktopFile, env: { FAKE_CLAUDE_MCP_FILE: cliFile } }
}
