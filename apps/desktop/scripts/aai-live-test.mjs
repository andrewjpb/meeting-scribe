#!/usr/bin/env node
// Teste real do streaming (CA14), fora dos gates. Usa a mesma URL, o mesmo envio e o mesmo redutor do
// app: os módulos TypeScript são carregados pelo Vite (SSR), sem cópia de lógica. Lê a chave do
// ambiente (`ASSEMBLYAI_API_KEY`) e nunca imprime a chave, a URL com token nem o token.
//
// Uso: ASSEMBLYAI_API_KEY=... pnpm --filter @meeting-scribe/desktop test:aai <arquivo.wav> [--no-translation] [--params=<json>]
//   <arquivo.wav>: PCM 16 bits, mono, 16 kHz (prova/out/*-16000hz-1ch.wav).
//   --no-translation: sem llm_gateway; nesse caso a checagem de tradução não se aplica.
//   --params: parâmetros extras da URL de conexão, em JSON (usado para medir variações de latência),
//             ex.: --params='{"min_turn_silence":100,"max_turn_silence":640}'.
//   --source=mic|system: fonte simulada (system liga a diarização, como no app).
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const wav = args.find((arg) => !arg.startsWith('--'))
const translation = !args.includes('--no-translation')
const extraParams = JSON.parse(args.find((arg) => arg.startsWith('--params='))?.slice('--params='.length) ?? '{}')
const source = args.find((arg) => arg.startsWith('--source='))?.slice('--source='.length) ?? 'mic'
if (source !== 'mic' && source !== 'system') {
  console.error('--source aceita mic ou system')
  process.exit(2)
}

if (!wav) {
  console.error('uso: pnpm --filter @meeting-scribe/desktop test:aai <arquivo 16 kHz mono .wav>')
  process.exit(2)
}
const key = process.env.ASSEMBLYAI_API_KEY
if (!key) {
  console.error('defina ASSEMBLYAI_API_KEY (a chave fica em prova/.env; nunca é impressa)')
  process.exit(2)
}

function readWav(path) {
  const file = readFileSync(path)
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') throw new Error('não é WAV (RIFF/WAVE)')
  let format = null
  let data = null
  for (let p = 12; p + 8 <= file.length; ) {
    const id = file.toString('ascii', p, p + 4)
    const size = file.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      format = { code: file.readUInt16LE(p + 8), channels: file.readUInt16LE(p + 10), rate: file.readUInt32LE(p + 12), bits: file.readUInt16LE(p + 22) }
    }
    if (id === 'data') data = file.subarray(p + 8, Math.min(p + 8 + size, file.length))
    p += 8 + size + (size % 2)
  }
  if (!format || !data) throw new Error('WAV sem bloco fmt ou data')
  if (format.code !== 1 || format.bits !== 16 || format.channels !== 1 || format.rate !== 16_000) {
    throw new Error(`esperado PCM 16 bits mono 16000 Hz; veio formato=${format.code} bits=${format.bits} canais=${format.channels} taxa=${format.rate}`)
  }
  return data
}

const pcm = readWav(wav)
const bytesPerFrame = 3200

// Os mesmos módulos do app: URL, envio e redutor.
const vite = await createServer({
  configFile: false,
  root: appDir,
  appType: 'custom',
  logLevel: 'error',
  // Sem HMR nem servidor WebSocket do Vite: nada é editado durante a medição, e duas execuções em
  // paralelo não disputam a porta.
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { '@shared': join(appDir, 'src', 'shared') } },
})

const load = async (path) => vite.ssrLoadModule(path)
const [{ buildStreamingUrl }, { createTokenClient }, { AssemblyAiSink }, { applyMessage, emptyTranscriptState }, { DEFAULT_SETTINGS }] = await Promise.all([
  load('/src/renderer/src/transcription/url.ts'),
  load('/src/main/assemblyai/token.ts'),
  load('/src/renderer/src/transcription/sink.ts'),
  load('/src/renderer/src/transcription/reducer.ts'),
  load('/src/shared/settings-defaults.ts'),
])

const settings = { ...DEFAULT_SETTINGS, translationEnabled: translation }
const tokenClient = createTokenClient({ fetch: globalThis.fetch, getApiKey: () => key })
const received = []
let audioOrigin = null
let sessionId = 'aai-1'
/** Quadros já enviados ao servidor: cada um vale 100 ms de áudio no relógio da sessão. */
let framesSent = 0
/** Fechamentos vistos (código e motivo do servidor; a URL com o token nunca é guardada). */
const closes = []
/** Estados da fonte, na ordem (conectando, ao vivo, reconectando…). */
const statuses = []
/** Mensagens de erro do servidor (campo `error`), sem repetição. */
const serverErrors = []

const sink = new AssemblyAiSink({
  openSocket: (url) => {
    const socket = new WebSocket(url)
    socket.addEventListener('close', (event) => closes.push(`${event.code}${event.reason ? ` ${event.reason}` : ''}`))
    const send = socket.send.bind(socket)
    socket.send = (data) => {
      framesSent += 1
      send(data)
    }
    return socket
  },
  getToken: () => tokenClient.get().then((value) => ({ ok: true, ...value }), (error) => ({ ok: false, error: error?.kind ?? 'network' })),
  urlFor: (token, source) => buildStreamingUrl({ token, source, settings, extraParams }),
  elapsedMs: () => 0,
  newSessionId: () => sessionId,
  onStatus: (_source, status) => {
    const label = status.error ? `${status.status}(${status.error})` : status.status
    if (statuses.at(-1) !== label) statuses.push(label)
  },
  onMessage: (envelope) => {
    const error = envelope.message?.error
    if (typeof error === 'string' && !serverErrors.includes(error)) serverErrors.push(error)
    if (audioOrigin === null) {
      const type = envelope.message?.type
      if (type !== 'Begin') return
      audioOrigin = Date.now()
    }
    received.push({ at: Date.now(), frames: framesSent, envelope })
  },
})

sink.start([source])
const startedAt = Date.now()
for (let offset = 0, seq = 0; offset < pcm.length; offset += bytesPerFrame, seq++) {
  const wait = startedAt + seq * 100 - Date.now()
  if (wait > 0) await new Promise((done) => setTimeout(done, wait))
  let chunk = pcm.subarray(offset, offset + bytesPerFrame)
  if (chunk.length < bytesPerFrame) {
    const full = Buffer.alloc(bytesPerFrame)
    chunk.copy(full)
    chunk = full
  }
  const bytes = new Uint8Array(8 + bytesPerFrame)
  bytes.set(chunk, 8)
  sink.write({ source, seq, bytes, pcm: bytes.subarray(8) })
}
await new Promise((done) => setTimeout(done, 0))
const audioMs = Math.round((pcm.length / 32_000) * 1000)
console.log(`arquivo ${wav.split('/').pop()} (${source}) · ${(audioMs / 1000).toFixed(2)} s de áudio · tradução ${translation ? 'ligada' : 'desligada'} · parâmetros extras ${JSON.stringify(extraParams)}`)
await sink.end()
await new Promise((done) => setTimeout(done, 100))
await vite.close()

// Reduz as mensagens com o mesmo redutor do app.
let state = emptyTranscriptState()
const turns = []
for (const entry of received) {
  const { message } = entry.envelope
  if (message?.type === 'Termination' && audioOrigin === null) continue
  state = applyMessage(state, entry.envelope)
  if (message?.type === 'Turn') turns.push({ at: entry.at, frames: entry.frames, ...message })
  if (message?.type === 'LLMGatewayResponse') turns.push({ at: entry.at, type: 'LLMGatewayResponse', ...message })
}
const origin = audioOrigin ?? startedAt
const partials = turns.filter((turn) => turn.type === 'Turn' && !turn.end_of_turn)
const finals = turns.filter((turn) => turn.type === 'Turn' && turn.end_of_turn)
const translations = turns.filter((turn) => turn.type === 'LLMGatewayResponse')

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const round = (value) => (value === null ? null : Math.round(value))

const firstPartialMs = partials.length ? partials[0].at - origin : null
const intervals = partials.slice(1).map((turn, index) => turn.at - partials[index].at)
// Atraso do trecho final após o fim da fala, no relógio do áudio enviado (o servidor recebe o quadro
// antes de transcrever; o `Begin` pode chegar depois do primeiro envio quando há buffer).
const finalDelays = finals.map((turn) => {
  const end = turn.words?.at(-1)?.end ?? 0
  return round(turn.frames * 100 - end)
})
const translationDelays = translations.map((translationMessage) => {
  const final = finals.find((turn) => turn.turn_order === translationMessage.turn_order)
  return final ? round(translationMessage.at - final.at) : null
})

const finalsWithText = finals.filter((turn) => typeof turn.transcript === 'string' && turn.transcript.trim() !== '')
const translationsWithText = translations.filter((message) => message.data?.choices?.[0]?.message?.content?.trim())

console.log('---')
console.log(`parciais: ${partials.length} · tempo até o primeiro parcial: ${firstPartialMs === null ? 'n/a' : `${round(firstPartialMs)} ms`}`)
console.log(`intervalo entre parciais: mediana ${round(median(intervals))} ms (${intervals.map(round).join(', ') || 'n/a'})`)
console.log(`trechos finais: ${finals.length} (${finalsWithText.length} com texto) · atraso após o fim da fala: ${finalDelays.map((value) => `${value} ms`).join(', ') || 'n/a'}`)
console.log(`traduções: ${translations.length} (${translationsWithText.length} com texto) · atraso após o trecho: ${translationDelays.map((value) => `${value} ms`).join(', ') || 'n/a'}`)
for (const final of finals) console.log(`#${final.turn_order} [${final.speaker_label ?? '-'}] ${final.transcript}`)
if (serverErrors.length) console.log(`erros do servidor: ${serverErrors.join(' | ')}`)
console.log(`estados da fonte: ${statuses.join(' → ')} · fechamentos: ${closes.join(', ') || 'nenhum'}`)
console.log(`estado do redutor: ${state.segments.length} trechos no estado do redutor (${state.segments.filter((segment) => segment.translation).length} traduzidos)`)

let failed = false
if (finalsWithText.length === 0) {
  console.error('FALHOU: nenhum trecho final com texto')
  failed = true
}
if (translation && translationsWithText.length === 0) {
  console.error('FALHOU: tradução ligada e nenhuma tradução recebida')
  failed = true
}
process.exit(failed ? 1 : 0)
