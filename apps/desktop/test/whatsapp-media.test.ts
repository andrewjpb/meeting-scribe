// Mídia do WhatsApp por clique (contrato 37): o leitor de bytes do cliente, o canal da mídia no serviço do main (ok,
// grande demais, expirada, pedidos iguais juntos), a transcrição pela AssemblyAI com o fetch falso (upload, pedido,
// consulta, prazo, cache e o corte de 20 000), o arquivo das transcrições (que sai no "Sair da conta" e no
// "Remover"). A lógica do player e dos blobs do renderer fica em `test/renderer/whatsapp-media.test.ts`.
import { spawn as spawnChild } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_MEDIA_AUDIO_DOWNLOADED_BYTES_MAX } from '../src/shared/assistant'
import { WHATSAPP_ASSISTANT_MEDIA_KINDS, WHATSAPP_DOWNLOADABLE_KINDS, WHATSAPP_MEDIA_MAX, WHATSAPP_TRANSCRIPT_MAX } from '../src/shared/whatsapp'
import { createVault } from '../src/main/accounts/vault'
import type { FetchInit, FetchLike, FetchResponse } from '../src/main/assemblyai/gateway'
import { createFileTranscriber, FileTranscriptError } from '../src/main/assemblyai/transcript'
import { memorySafeStorage } from '../src/main/secrets'
import { createBridgeClient, WhatsAppServiceError } from '../src/main/whatsapp/client'
import { removeBridge } from '../src/main/whatsapp/install'
import { createWhatsAppService } from '../src/main/whatsapp/service'
import { createTranscriptsCache, TRANSCRIPTS_FILE } from '../src/main/whatsapp/transcripts'

const ANA = '5511911110000@s.whatsapp.net'
const TOKEN = '0123456789abcdef'.repeat(4)
const INSTANCE = 'a1b2c3d4'.repeat(4)
const WAV = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), Buffer.alloc(64, 1)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32, 2)])

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-wa-media-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Route = (res: ServerResponse) => void
const bytes = (mime: string, body: Buffer): Route => (res) => {
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': String(body.byteLength) })
  res.end(body)
}
const error = (status: number, code: string): Route => (res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: code }))
}

/** Serviço falso: o `/health` do reencontro e a rota da mídia de cada mensagem (`routes`). */
function fakeBridge(routes: Record<string, Route>): Promise<{ server: Server; port: number; requests: string[]; hold: { release: (() => void) | null; on: boolean } }> {
  const requests: string[] = []
  const hold: { release: (() => void) | null; on: boolean } = { release: null, on: false }
  const server = createServer((req: IncomingMessage, res) => {
    req.resume()
    req.on('end', () => {
      const path = req.url ?? '/'
      requests.push(path)
      const json = (status: number, value: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (path === '/health' && req.headers.authorization !== `Bearer ${TOKEN}`) return json(200, { id: INSTANCE })
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'unauthorized' })
      if (path === '/health') return json(200, { version: '0.1.0', state: 'connected', me: { name: 'Andrea', phone: '+5511900000000' }, id: INSTANCE, pid: 999_999 })
      if (path === '/logout') return json(200, { version: '0.1.0', state: 'disconnected', me: null })
      if (path === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        return undefined
      }
      const match = /^\/chats\/[^/]+\/messages\/([^/]+)\/media$/.exec(path)
      const route = match ? routes[decodeURIComponent(match[1] ?? '')] : undefined
      if (!route) return json(404, { error: 'missing' })
      if (hold.on) {
        hold.release = () => route(res)
        return undefined
      }
      return route(res)
    })
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ server, port: typeof address === 'object' && address ? address.port : 0, requests, hold })
    }),
  )
}

async function reattached(port: number, root: string, transcribe?: (bytes: Uint8Array) => Promise<string>) {
  const safe = memorySafeStorage()
  createVault(join(root, 'service.bin'), safe, (raw) => raw).write({ token: TOKEN, port, on: true, instanceId: INSTANCE })
  mkdirSync(join(root, 'venv', 'bin'), { recursive: true })
  writeFileSync(join(root, 'venv', 'bin', 'python'), '')
  writeFileSync(join(root, 'installed.json'), '{}')
  const service = createWhatsAppService({
    root,
    bridgeSource: root,
    bridgeFiles: [],
    backend: 'fake',
    index: { kind: 'local', dir: root },
    pythonCandidates: [],
    exec: () => Promise.resolve({ ok: false, stderr: '' }),
    spawn: () => spawnChild(process.execPath, ['-e', 'process.exit(1)']),
    safeStorage: safe,
    baseEnv: {},
    draft: () => Promise.resolve({ ok: false, error: 'failed' }),
    meeting: () => Promise.resolve(null),
    onStatus: () => undefined,
    onMessage: () => undefined,
    ...(transcribe ? { transcribe } : {}),
  })
  await service.init()
  return service
}

describe('cliente: a mídia em bytes (contrato 37)', () => {
  it('lê os bytes com o tipo conferido e traduz 404, 410 e 413', async () => {
    const bridge = await fakeBridge({
      a1: bytes('audio/ogg; codecs=opus', WAV),
      i1: bytes('image/png', PNG),
      html: bytes('text/html', Buffer.from('<script>alert(1)</script>')),
      fonte: bytes('font/woff2', Buffer.from('wOF2')),
      pdf: bytes('application/pdf', Buffer.from('%PDF-1.4\n')),
      docx: bytes('application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK')),
      webp: bytes('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')),
      vazio: bytes('image/png', Buffer.alloc(0)),
      gone: error(410, 'gone'),
      big: error(413, 'too-big'),
    })
    try {
      const client = createBridgeClient(bridge.port, TOKEN)
      const audio = await client.media(ANA, 'a1')
      expect(audio.mime).toBe('audio/ogg; codecs=opus')
      expect(Buffer.compare(audio.bytes, WAV)).toBe(0)
      expect(bridge.requests.at(-1)).toBe(`/chats/${encodeURIComponent(ANA)}/messages/a1/media`)
      expect((await client.media(ANA, 'i1')).mime).toBe('image/png')
      // Contrato 149: também o que o serviço devolve para documento e figurinha (`application/*`, `text/*`, `image/webp`,
      // subtipo até 100). O tipo daqui não decide o que a mídia é: são os bytes (`chat/media-files.ts`).
      expect((await client.media(ANA, 'pdf')).mime).toBe('application/pdf')
      expect((await client.media(ANA, 'docx')).mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      expect((await client.media(ANA, 'webp')).mime).toBe('image/webp')
      expect((await client.media(ANA, 'html')).mime).toBe('text/html')
      // Outra família de tipo nunca passa.
      await expect(client.media(ANA, 'fonte')).rejects.toMatchObject({ status: 200, code: 'mime' })
      await expect(client.media(ANA, 'vazio')).rejects.toMatchObject({ code: 'empty' })
      await expect(client.media(ANA, 'gone')).rejects.toMatchObject({ status: 410, code: 'gone' })
      await expect(client.media(ANA, 'big')).rejects.toMatchObject({ status: 413, code: 'too-big' })
      await expect(client.media(ANA, 'nada')).rejects.toBeInstanceOf(WhatsAppServiceError)
    } finally {
      bridge.server.close()
    }
  })

  it('recusa sem ler o corpo que diz ter mais de 64 MB', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(WHATSAPP_MEDIA_MAX + 1) })
      res.write(Buffer.alloc(1024))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    try {
      const client = createBridgeClient(typeof address === 'object' && address ? address.port : 0, TOKEN)
      await expect(client.media(ANA, 'v1')).rejects.toMatchObject({ status: 413, code: 'too-big' })
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })
})

describe('serviço: o canal da mídia (contrato 37)', () => {
  it('ok, grande demais, expirada e indisponível; pedidos iguais ao mesmo tempo viram um só', async () => {
    const bridge = await fakeBridge({ a1: bytes('audio/wav', WAV), gone: error(410, 'gone'), big: error(413, 'too-big'), falha: error(502, 'failed') })
    const root = tempDir()
    try {
      const service = await reattached(bridge.port, root)
      const ok = await service.media({ chatId: ANA, messageId: 'a1' })
      expect(ok.ok && ok.mime === 'audio/wav' && Buffer.compare(Buffer.from(ok.bytes), WAV) === 0).toBe(true)
      expect(await service.media({ chatId: ANA, messageId: 'gone' })).toEqual({ ok: false, error: 'gone' })
      expect(await service.media({ chatId: ANA, messageId: 'big' })).toEqual({ ok: false, error: 'too-big' })
      expect(await service.media({ chatId: ANA, messageId: 'falha' })).toEqual({ ok: false, error: 'unavailable' })
      expect(await service.media({ chatId: ANA, messageId: 'sem-chaves' })).toEqual({ ok: false, error: 'unavailable' })
      // Pedido inválido não chega ao serviço.
      const before = bridge.requests.length
      expect(await service.media({ chatId: 'sem-arroba', messageId: 'a1' })).toEqual({ ok: false, error: 'unavailable' })
      expect(await service.media({ chatId: ANA, messageId: '../../health' })).toEqual({ ok: false, error: 'unavailable' })
      expect(await service.media({ chatId: ANA, messageId: 'a1', extra: 1 })).toEqual({ ok: false, error: 'unavailable' })
      expect(bridge.requests.length).toBe(before)
      // Dois cliques no mesmo "Baixar" antes da resposta: um pedido só ao serviço.
      bridge.hold.on = true
      const first = service.media({ chatId: ANA, messageId: 'a1' })
      const second = service.media({ chatId: ANA, messageId: 'a1' })
      await vi.waitFor(() => expect(bridge.hold.release).not.toBeNull())
      bridge.hold.on = false
      bridge.hold.release?.()
      const [a, b] = await Promise.all([first, second])
      expect(a.ok && b.ok).toBe(true)
      expect(bridge.requests.filter((path) => path.endsWith('/a1/media')).length).toBe(2)
      // Nada fica no main: um pedido novo depois vai de novo ao serviço (que guarda no disco dele).
      await service.media({ chatId: ANA, messageId: 'a1' })
      expect(bridge.requests.filter((path) => path.endsWith('/a1/media')).length).toBe(3)
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })
})

const reply = (status: number, body: unknown): FetchResponse => ({ status, text: () => Promise.resolve(JSON.stringify(body)) })

/** AssemblyAI falsa: upload, pedido e as consultas (`processing` até `polls` vezes, depois o texto). */
function fakeAssembly(options: { text?: string; polls?: number; status?: 'completed' | 'error'; uploadStatus?: number } = {}) {
  const calls: { url: string; init: FetchInit }[] = []
  let polled = 0
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/v2/upload')) return Promise.resolve(reply(options.uploadStatus ?? 200, { upload_url: 'https://cdn.assemblyai.com/upload/abc' }))
    if (url.endsWith('/v2/transcript')) return Promise.resolve(reply(200, { id: 'tr-1', status: 'queued' }))
    if (url.endsWith('/v2/transcript/tr-1')) {
      polled++
      if (polled <= (options.polls ?? 0)) return Promise.resolve(reply(200, { id: 'tr-1', status: 'processing' }))
      return Promise.resolve(reply(200, { id: 'tr-1', status: options.status ?? 'completed', text: options.text ?? 'Oi, tudo bem?', error: 'detalhe' }))
    }
    return Promise.resolve(reply(404, {}))
  }
  return { fetch, calls }
}

describe('transcrição de arquivo pela AssemblyAI (contrato 37)', () => {
  it('upload em bytes, pedido com a detecção de idioma e consultas a cada 2 s até o texto', async () => {
    const assembly = fakeAssembly({ polls: 2 })
    const sleeps: number[] = []
    const transcriber = createFileTranscriber({ fetch: assembly.fetch, getApiKey: () => 'chave-x', sleep: (ms) => (sleeps.push(ms), Promise.resolve()) })
    expect(await transcriber.transcribe(new Uint8Array(WAV))).toBe('Oi, tudo bem?')
    const [upload, created, ...polls] = assembly.calls
    expect(upload?.url).toBe('https://api.assemblyai.com/v2/upload')
    expect(upload?.init.method).toBe('POST')
    expect(upload?.init.body).toBeInstanceOf(Uint8Array)
    expect(upload?.init.headers).toEqual({ authorization: 'chave-x', 'content-type': 'application/octet-stream' })
    expect(created?.url).toBe('https://api.assemblyai.com/v2/transcript')
    expect(JSON.parse(String(created?.init.body))).toEqual({ audio_url: 'https://cdn.assemblyai.com/upload/abc', language_detection: true })
    expect(polls.map((call) => call.url)).toEqual(Array(3).fill('https://api.assemblyai.com/v2/transcript/tr-1'))
    expect(sleeps).toEqual([2000, 2000])
    // A chave nunca segue um redirecionamento, e nunca vai na URL.
    expect(assembly.calls.every((call) => call.init.redirect === 'error' && !call.url.includes('chave-x'))).toBe(true)
  })

  it('sem chave, chave recusada, erro da AssemblyAI, rede e o prazo de 120 s', async () => {
    await expect(createFileTranscriber({ fetch: fakeAssembly().fetch, getApiKey: () => null }).transcribe(new Uint8Array(1))).rejects.toMatchObject({ kind: 'no-key' })
    await expect(createFileTranscriber({ fetch: fakeAssembly({ uploadStatus: 401 }).fetch, getApiKey: () => 'k' }).transcribe(new Uint8Array(1))).rejects.toMatchObject({ kind: 'key-rejected' })
    await expect(createFileTranscriber({ fetch: fakeAssembly({ uploadStatus: 500 }).fetch, getApiKey: () => 'k' }).transcribe(new Uint8Array(1))).rejects.toMatchObject({ kind: 'server' })
    await expect(createFileTranscriber({ fetch: fakeAssembly({ status: 'error' }).fetch, getApiKey: () => 'k', sleep: () => Promise.resolve() }).transcribe(new Uint8Array(1))).rejects.toMatchObject({ kind: 'failed' })
    const offline: FetchLike = () => Promise.reject(new TypeError('fetch failed https://exemplo'))
    const failure = await createFileTranscriber({ fetch: offline, getApiKey: () => 'k' })
      .transcribe(new Uint8Array(1))
      .catch((caught: unknown) => caught)
    expect(failure).toBeInstanceOf(FileTranscriptError)
    expect((failure as FileTranscriptError).kind).toBe('network')
    expect((failure as Error).message).not.toContain('exemplo')
    // Sempre "processing": o relógio passa dos 120 s e para.
    let clock = 0
    const stuck = fakeAssembly({ polls: 1_000 })
    const slow = createFileTranscriber({ fetch: stuck.fetch, getApiKey: () => 'k', now: () => clock, sleep: (ms) => ((clock += ms), Promise.resolve()) })
    await expect(slow.transcribe(new Uint8Array(1))).rejects.toMatchObject({ kind: 'timeout' })
    const polls = stuck.calls.filter((call) => call.url.endsWith('/tr-1')).length
    expect(polls).toBeGreaterThanOrEqual(59)
    expect(polls).toBeLessThanOrEqual(61)
  })
})

describe('arquivo das transcrições (contrato 37)', () => {
  it('atômico e 0600, corta em 20 000, e o estragado é descartado', async () => {
    const root = tempDir()
    const file = join(root, TRANSCRIPTS_FILE)
    const cache = createTranscriptsCache(file)
    expect(await cache.get(ANA, 'a1')).toBeNull()
    expect(await cache.set(ANA, 'a1', `  ${'x'.repeat(WHATSAPP_TRANSCRIPT_MAX + 500)}  `)).toHaveLength(WHATSAPP_TRANSCRIPT_MAX)
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600')
    expect(await createTranscriptsCache(file).get(ANA, 'a1')).toHaveLength(WHATSAPP_TRANSCRIPT_MAX)
    writeFileSync(file, '{"estragado": ')
    expect(await createTranscriptsCache(file).get(ANA, 'a1')).toBeNull()
    writeFileSync(file, JSON.stringify({ [`${ANA}\na1`]: { at: 'ontem', text: 1 } }))
    expect(await createTranscriptsCache(file).get(ANA, 'a1')).toBeNull()
  })

  it('o "Remover" apaga o arquivo junto com a sessão', async () => {
    const root = tempDir()
    writeFileSync(join(root, TRANSCRIPTS_FILE), '{}')
    await removeBridge(root)
    expect(existsSync(join(root, TRANSCRIPTS_FILE))).toBe(false)
  })
})

describe('serviço: "Transcrever" (contrato 37)', () => {
  it('baixa, manda à AssemblyAI uma vez, guarda e depois só lê do arquivo; o `peek` nunca baixa', async () => {
    const bridge = await fakeBridge({ a1: bytes('audio/ogg', WAV), i1: bytes('image/png', PNG), gone: error(410, 'gone') })
    const root = tempDir()
    const sent: Uint8Array[] = []
    try {
      const service = await reattached(bridge.port, root, (audio) => (sent.push(audio), Promise.resolve(`  ${'a'.repeat(WHATSAPP_TRANSCRIPT_MAX + 10)}`)))
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1', peek: true })).toEqual({ ok: false, error: 'not-cached' })
      expect(bridge.requests.some((path) => path.endsWith('/media'))).toBe(false)
      const first = await service.transcribe({ chatId: ANA, messageId: 'a1' })
      expect(first.ok && first.text.length).toBe(WHATSAPP_TRANSCRIPT_MAX)
      expect(sent).toHaveLength(1)
      expect(Buffer.compare(Buffer.from(sent[0] ?? new Uint8Array()), WAV)).toBe(0)
      // Guardado: nem baixa, nem manda de novo; o `peek` também acha.
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1' })).toEqual(first)
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1', peek: true })).toEqual(first)
      expect(sent).toHaveLength(1)
      expect(bridge.requests.filter((path) => path.endsWith('/a1/media'))).toHaveLength(1)
      const saved = JSON.parse(readFileSync(join(root, TRANSCRIPTS_FILE), 'utf8')) as Record<string, { text: string }>
      expect(saved[`${ANA}\na1`]?.text).toBe(first.ok ? first.text : '')
      // Imagem não vai à AssemblyAI; arquivo expirado diz isso.
      expect(await service.transcribe({ chatId: ANA, messageId: 'i1' })).toEqual({ ok: false, error: 'unavailable' })
      expect(await service.transcribe({ chatId: ANA, messageId: 'gone' })).toEqual({ ok: false, error: 'gone' })
      expect(sent).toHaveLength(1)
      // "Sair da conta" apaga as transcrições (e a memória delas).
      await service.logout()
      expect(existsSync(join(root, TRANSCRIPTS_FILE))).toBe(false)
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1', peek: true })).toEqual({ ok: false, error: 'not-cached' })
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })

  it('erros da AssemblyAI viram rótulos e nada fica guardado; dois cliques juntos transcrevem uma vez', async () => {
    const bridge = await fakeBridge({ a1: bytes('audio/ogg', WAV), a2: bytes('audio/ogg', WAV) })
    const root = tempDir()
    let fail: FileTranscriptError | null = new FileTranscriptError('no-key', 'sem chave')
    let calls = 0
    try {
      const service = await reattached(bridge.port, root, async () => {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 20))
        if (fail) throw fail
        return 'texto'
      })
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1' })).toEqual({ ok: false, error: 'no-key' })
      fail = new FileTranscriptError('key-rejected', 'recusada')
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1' })).toEqual({ ok: false, error: 'key' })
      fail = new FileTranscriptError('timeout', 'prazo')
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1' })).toEqual({ ok: false, error: 'timeout' })
      fail = new FileTranscriptError('network', 'rede')
      expect(await service.transcribe({ chatId: ANA, messageId: 'a1' })).toEqual({ ok: false, error: 'failed' })
      expect(existsSync(join(root, TRANSCRIPTS_FILE))).toBe(false)
      fail = null
      calls = 0
      const both = await Promise.all([service.transcribe({ chatId: ANA, messageId: 'a2' }), service.transcribe({ chatId: ANA, messageId: 'a2' })])
      expect(both).toEqual([
        { ok: true, text: 'texto' },
        { ok: true, text: 'texto' },
      ])
      expect(calls).toBe(1)
      // "Remover" leva o arquivo junto.
      await service.remove()
      expect(existsSync(join(root, TRANSCRIPTS_FILE))).toBe(false)
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })
})

describe('contrato 149: documento e figurinha pelo canal da mídia, e a transcrição do Assistente (CA3, CA15)', () => {
  const BRUNO = '5511922220000@s.whatsapp.net'
  const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')
  const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF\x20\0\0\0WEBPVP8 ', 'latin1'), Buffer.alloc(16, 1)])

  it('o PDF (m9) e a figurinha (m10) do Bruno chegam com o tipo certo; a tela continua sem "Baixar" para os dois', async () => {
    const bridge = await fakeBridge({ m9: bytes('application/pdf', PDF_BYTES), m10: bytes('image/webp', WEBP_BYTES) })
    const root = tempDir()
    try {
      const service = await reattached(bridge.port, root)
      const pdf = await service.media({ chatId: BRUNO, messageId: 'm9' })
      expect(pdf.ok && pdf.mime === 'application/pdf' && Buffer.compare(Buffer.from(pdf.bytes), PDF_BYTES) === 0).toBe(true)
      const sticker = await service.media({ chatId: BRUNO, messageId: 'm10' })
      expect(sticker.ok && sticker.mime === 'image/webp').toBe(true)
      expect(bridge.requests).toContain(`/chats/${encodeURIComponent(BRUNO)}/messages/m9/media`)
      await service.dispose()
    } finally {
      bridge.server.close()
    }
    // O botão "Baixar" da tela segue a lista de antes; a do Assistente é outra.
    expect([...WHATSAPP_DOWNLOADABLE_KINDS]).toEqual(['image', 'video', 'audio'])
    expect([...WHATSAPP_ASSISTANT_MEDIA_KINDS].sort()).toEqual(['audio', 'document', 'image', 'sticker', 'video'])
  })

  it('assistantTranscribe: a guardada sem rede; a fala do vídeo também transcreve e guarda; o "Transcrever" da tela segue só com áudio', async () => {
    const bridge = await fakeBridge({ a1: bytes('audio/wav', WAV), v1: bytes('video/mp4', Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42', 'latin1'), Buffer.alloc(16)])) })
    const root = tempDir()
    const sent: number[] = []
    try {
      const service = await reattached(bridge.port, root, (input) => (sent.push(input.byteLength), Promise.resolve('Fala transcrita')))
      // O botão da tela recusa o vídeo, como antes.
      expect(await service.transcribe({ chatId: ANA, messageId: 'v1' })).toEqual({ ok: false, error: 'unavailable' })
      expect(await service.assistantTranscribe(ANA, 'v1')).toEqual({ ok: true, text: 'Fala transcrita' })
      expect(await service.savedTranscript(ANA, 'v1')).toBe('Fala transcrita')
      expect(await service.assistantTranscribe(ANA, 'a1')).toEqual({ ok: true, text: 'Fala transcrita' })
      const calls = sent.length
      // Guardada: nenhuma ida à AssemblyAI.
      expect(await service.assistantTranscribe(ANA, 'a1')).toEqual({ ok: true, text: 'Fala transcrita' })
      expect(sent).toHaveLength(calls)
      expect(calls).toBe(2)
      expect(await service.assistantTranscribe('sem-arroba', 'a1')).toEqual({ ok: false, error: 'unavailable' })
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })

  it('assistantTranscribe confere os bytes do áudio baixado contra o teto dos 30 minutos (16 MB): acima, nada vai à AssemblyAI', async () => {
    const big = Buffer.concat([WAV, Buffer.alloc(ASSISTANT_MEDIA_AUDIO_DOWNLOADED_BYTES_MAX)])
    const bridge = await fakeBridge({ grande: bytes('audio/ogg', big) })
    const root = tempDir()
    const sent: number[] = []
    try {
      const service = await reattached(bridge.port, root, (input) => (sent.push(input.byteLength), Promise.resolve('texto')))
      expect(await service.assistantTranscribe(ANA, 'grande')).toEqual({ ok: false, error: 'too-big' })
      expect(sent).toEqual([])
      expect(await service.savedTranscript(ANA, 'grande')).toBeNull()
      // O "Transcrever" da tela não muda.
      expect(await service.transcribe({ chatId: ANA, messageId: 'grande' })).toEqual({ ok: true, text: 'texto' })
      expect(await service.exportedMedia(root, ANA, 'a1')).toBeNull()
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })
})
