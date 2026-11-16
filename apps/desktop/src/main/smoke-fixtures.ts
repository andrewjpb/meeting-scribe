// Fixtures do smoke para o LLM Gateway e o macOS: nenhuma requisição sai da máquina, nenhum diálogo
// abre. O catálogo é a resposta real de `GET /v1/models` de 14/11/2026 reduzida aos campos que o app lê
// (a resposta inteira fica em test/fixtures/assemblyai/models.json); os corpos de erro também são reais.
// A chave é fictícia: só os quatro últimos caracteres aparecem na tela (••••4f2a, como no mockup).
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { updateAssetName } from '../shared/updates'
import type { FetchInit, FetchLike, FetchResponse } from './assemblyai/gateway'
import type { ExecFile } from './claude-cli/locate'
import type { SpawnSummary } from './claude-cli/summary'
import type { SpawnClaude } from './claude-cli/translator'
import { fakeMediaAccess } from './permissions'
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
export const SMOKE_NOT_ALLOWED_MODEL = 'gpt-oss-20b'
export const SMOKE_OFFLINE_MODEL = 'deepseek-v4.1-flash'

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
  /** Liga a falha de rede no catálogo. */
  failCatalog: boolean
  /** O `claude` falso some: `--version` falha e a busca dá "não encontrado". */
  claudeMissing: boolean
  /** Processos do `claude` falso abertos pelo app: argumentos, pasta e nomes das variáveis de ambiente. */
  claudeSpawns: { args: string[]; cwd: string; envNames: string[]; exited: boolean }[]
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
  /** Cada troca do ícone do Dock (`app.dock` nunca é tocado no smoke). */
  dockIcons: ('custom' | 'default' | 'skipped')[]
  /** API do GitHub e download do release falsos (contrato 14). */
  updates: SmokeUpdates
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

export function createSmokeFixtures(currentVersion: string): SmokeFixtures {
  const fixtures: SmokeFixtures = {
    updates: createSmokeUpdates(currentVersion),
    media: fakeMediaAccess('not-determined'),
    openedUrls: [],
    copiedTexts: [],
    calls: [],
    failCatalog: false,
    claudeMissing: false,
    claudeSpawns: [],
    chosenFolder: null,
    openedFiles: [],
    saveDialogs: [],
    savePath: null,
    chosenImage: null,
    dockIcons: [],
    fetch: (url: string, init: FetchInit) => {
      const path = new URL(url).pathname
      const auth = init.headers['authorization'] ?? ''
      let model: string | null = null
      if (init.body) {
        const parsed = JSON.parse(init.body) as { model?: unknown }
        model = typeof parsed.model === 'string' ? parsed.model : null
      }
      fixtures.calls.push({ method: init.method, path, model, authorized: auth !== '' })
      const offline = (): Promise<FetchResponse> => Promise.reject(new TypeError('fetch failed'))

      if (init.method === 'GET' && path === '/v1/models') return fixtures.failCatalog ? offline() : Promise.resolve(reply(200, CATALOG))
      // Token temporário de streaming: token fictício, nenhuma conexão é aberta no smoke.
      if (init.method === 'GET' && path === '/v3/token') return Promise.resolve(reply(200, { token: 'smoke-token-ficticio-0000', expires_in_seconds: 60 }))
      if (init.method !== 'POST' || path !== '/v1/chat/completions') return Promise.resolve(reply(404, { message: 'not found' }))
      if (auth === SMOKE_OFFLINE_KEY) return offline()
      if (!auth || auth === SMOKE_REFUSED_KEY) return Promise.resolve(reply(401, AUTH_ERROR))
      if (model === null) return Promise.resolve(reply(400, EMPTY_BODY))
      if (model === SMOKE_NOT_ALLOWED_MODEL) return Promise.resolve(reply(400, NOT_ALLOWED))
      if (model === SMOKE_OFFLINE_MODEL) return offline()
      return Promise.resolve(reply(200, { ...CHAT_OK, model }))
    },
  }
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
