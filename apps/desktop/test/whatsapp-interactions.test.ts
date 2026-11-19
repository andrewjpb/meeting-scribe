// Contrato 34 no main: a resposta citando (o `replyToId` no envio, com a mesma prova), a reação como envio (token de
// clique próprio no mesmo guarda, só os 6 emojis), o "digitando…" da sua conta só com o interruptor ligado, e o que chega
// do serviço (citação, reações, presença) conferido como dado: emoji só texto curto, fora do formato é descartado.
import { spawn as spawnChild } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WHATSAPP_CLICK_TTL_MS, type WhatsAppPresence, type WhatsAppReaction } from '../src/shared/whatsapp'
import { createVault } from '../src/main/accounts/vault'
import { memorySafeStorage } from '../src/main/secrets'
import { createBridgeClient, messageSchema, parseSseBlock } from '../src/main/whatsapp/client'
import { createSendGuard } from '../src/main/whatsapp/send-guard'
import { createWhatsAppService } from '../src/main/whatsapp/service'

const ANA = '5511911110000@s.whatsapp.net'
const TOKEN = '0123456789abcdef'.repeat(4)
const INSTANCE = 'a1b2c3d4'.repeat(4)
const THUMBS = '\u{1F44D}'
const HEART = '❤️'

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-wa-34-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Received {
  method: string
  path: string
  body: unknown
}

/** Serviço falso: `/health`, `/chats` (só a Ana), `send`, `react`, `presence` e um `/events` com uma reação e uma presença. */
function fakeBridge(): Promise<{ server: Server; port: number; received: Received[]; react: { status: number; body: unknown } }> {
  const received: Received[] = []
  const state = { react: { status: 200, body: { reactions: [{ emoji: THUMBS, count: 1, mine: true }] } as unknown } }
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? '/'
      const json = (status: number, value: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      if (path === '/health' && req.headers.authorization !== `Bearer ${TOKEN}`) return json(200, { id: INSTANCE })
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'unauthorized' })
      if (path === '/health') return json(200, { version: '0.1.0', state: 'connected', me: { name: 'Andrea', phone: '+5511900000000' }, id: INSTANCE, pid: 999_999 })
      if (path === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: reactions\ndata: ${JSON.stringify({ chatId: ANA, messageId: 'm1', reactions: [{ emoji: HEART, count: 2, mine: false }] })}\n\n`)
        res.write(`event: presence\ndata: ${JSON.stringify({ chatId: ANA, state: 'composing', author: null })}\n\n`)
        return undefined
      }
      if (path === '/chats') return json(200, { chats: [{ id: ANA, name: 'Ana Souza', kind: 'person', unread: 0, lastMessage: null }] })
      const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
      if (/^\/chats\/[^/]+\/send$/.test(path)) {
        received.push({ method: req.method ?? '', path, body })
        return json(200, { id: 'enviada-1' })
      }
      if (/^\/chats\/[^/]+\/messages\/[^/]+\/react$/.test(path)) {
        received.push({ method: req.method ?? '', path, body })
        return json(state.react.status, state.react.body)
      }
      if (/^\/chats\/[^/]+\/presence$/.test(path)) {
        received.push({ method: req.method ?? '', path, body })
        return json(200, { ok: true })
      }
      return json(404, { error: 'not-found' })
    })
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        received,
        get react() {
          return state.react
        },
        set react(next) {
          state.react = next
        },
      })
    }),
  )
}

async function reattached(port: number, options: { now?: () => number; typing?: () => boolean } = {}) {
  const root = tempDir()
  const safe = memorySafeStorage()
  createVault(join(root, 'service.bin'), safe, (raw) => raw).write({ token: TOKEN, port, on: true, instanceId: INSTANCE })
  mkdirSync(join(root, 'venv', 'bin'), { recursive: true })
  writeFileSync(join(root, 'venv', 'bin', 'python'), '')
  writeFileSync(join(root, 'installed.json'), '{}')
  const reactions: { chatId: string; messageId: string; reactions: WhatsAppReaction[] }[] = []
  const presences: WhatsAppPresence[] = []
  const corrections: string[] = []
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
    correct: (text) => {
      corrections.push(text)
      return Promise.resolve(`${text}!`)
    },
    meeting: () => Promise.resolve(null),
    onStatus: () => undefined,
    onMessage: () => undefined,
    onReactions: (update) => reactions.push(update),
    onPresence: (presence) => presences.push(presence),
    ...(options.typing ? { typingEnabled: () => Promise.resolve((options.typing as () => boolean)()) } : {}),
    ...(options.now ? { now: options.now } : {}),
  })
  await service.init()
  return { service, reactions, presences, corrections }
}

let clicks = 0
const click = (): string => `3${String(++clicks).padStart(7, '0')}-2222-4333-8444-555555555555`

describe('o que chega do serviço é dado conferido (CA4)', () => {
  it('a citação e as reações entram na mensagem; fora do formato, ela chega sem elas', () => {
    const base = { id: 'm1', chatId: ANA, author: 'Ana', fromMe: false, at: 1, type: 'text', text: 'oi', media: null }
    expect(messageSchema.parse({ ...base, replyToId: 'Q1', replyPreview: 'trecho', reactions: [{ emoji: THUMBS, count: 2, mine: true }] })).toEqual({
      ...base,
      replyToId: 'Q1',
      replyPreview: 'trecho',
      reactions: [{ emoji: THUMBS, count: 2, mine: true }],
    })
    const odd = messageSchema.parse({ ...base, replyToId: 'a b', replyPreview: 'x'.repeat(500), reactions: [{ emoji: `${THUMBS}\n<script>`, count: 1, mine: false }] })
    expect(odd.replyToId).toBeUndefined()
    expect(odd.replyPreview).toBeUndefined()
    expect(odd.reactions).toBeUndefined()
    expect(messageSchema.parse({ ...base, reactions: [{ emoji: 'x'.repeat(40), count: 1, mine: false }] }).reactions).toBeUndefined()
    expect(messageSchema.parse(base)).toEqual(base)
  })

  it('os eventos `reactions` e `presence` do SSE; o resto é descartado', () => {
    expect(parseSseBlock(`event: reactions\ndata: ${JSON.stringify({ chatId: ANA, messageId: 'm1', reactions: [{ emoji: HEART, count: 1, mine: true }] })}`)).toEqual({
      type: 'reactions',
      chatId: ANA,
      messageId: 'm1',
      reactions: [{ emoji: HEART, count: 1, mine: true }],
    })
    expect(parseSseBlock(`event: reactions\ndata: ${JSON.stringify({ chatId: ANA, messageId: 'm1', reactions: [{ emoji: '\u0007', count: 1, mine: true }] })}`)).toBeNull()
    expect(parseSseBlock(`event: reactions\ndata: ${JSON.stringify({ chatId: 'nada', messageId: 'm1', reactions: [] })}`)).toBeNull()
    expect(parseSseBlock(`event: presence\ndata: ${JSON.stringify({ chatId: ANA, state: 'composing', author: 'Carla' })}`)).toEqual({ type: 'presence', presence: { chatId: ANA, state: 'composing', author: 'Carla' } })
    expect(parseSseBlock(`event: presence\ndata: ${JSON.stringify({ chatId: ANA, state: 'paused', author: 42 })}`)).toEqual({ type: 'presence', presence: { chatId: ANA, state: 'paused', author: null } })
    expect(parseSseBlock(`event: presence\ndata: ${JSON.stringify({ chatId: ANA, state: 'recording', author: null })}`)).toBeNull()
  })

  it('o serviço do main repassa as reações e o "digitando…" do `/events`', async () => {
    const bridge = await fakeBridge()
    try {
      const { reactions, presences } = await reattached(bridge.port)
      await new Promise((done) => setTimeout(done, 100))
      expect(reactions).toEqual([{ chatId: ANA, messageId: 'm1', reactions: [{ emoji: HEART, count: 2, mine: false }] }])
      expect(presences).toEqual([{ chatId: ANA, state: 'composing', author: null }])
    } finally {
      bridge.server.close()
    }
  })
})

describe('responder citando (CA1)', () => {
  it('o envio leva o `replyToId` com a mesma prova de clique, e a correção do 35 continua no texto', async () => {
    const bridge = await fakeBridge()
    try {
      const { service, corrections } = await reattached(bridge.port)
      const token = click()
      service.registerClick(1, token)
      expect(await service.send(1, { chatId: ANA, text: 'Combinado', clickToken: token, replyToId: 'm1' })).toEqual({ ok: true, id: 'enviada-1' })
      expect(bridge.received.at(-1)?.body).toEqual({ text: 'Combinado!', replyToId: 'm1' })
      expect(corrections).toEqual(['Combinado'])
      // Sem citação, o corpo de antes; id malformado é inválido (o token já foi gasto).
      const plain = click()
      service.registerClick(1, plain)
      await service.send(1, { chatId: ANA, text: 'oi', clickToken: plain })
      expect(bridge.received.at(-1)?.body).toEqual({ text: 'oi!' })
      const bad = click()
      service.registerClick(1, bad)
      expect(await service.send(1, { chatId: ANA, text: 'oi', clickToken: bad, replyToId: 'a b' })).toEqual({ ok: false, error: 'invalid' })
      expect(await service.send(1, { chatId: ANA, text: 'oi', clickToken: bad })).toEqual({ ok: false, error: 'click' })
      expect(bridge.received).toHaveLength(2)
    } finally {
      bridge.server.close()
    }
  })
})

describe('reagir é envio: o mesmo guarda do clique (CA2, CA4)', () => {
  it('o cliente só reage com a prova da mesma conversa', async () => {
    const bridge = await fakeBridge()
    try {
      const client = createBridgeClient(bridge.port, TOKEN)
      const guard = createSendGuard()
      const token = click()
      guard.register(1, token)
      const proof = guard.consume(1, token, ANA)
      if (!proof) throw new Error('sem prova')
      expect(await client.react(proof, ANA, 'm1', THUMBS)).toEqual([{ emoji: THUMBS, count: 1, mine: true }])
      expect(bridge.received[0]).toEqual({ method: 'POST', path: `/chats/${encodeURIComponent(ANA)}/messages/m1/react`, body: { emoji: THUMBS } })
      await expect(client.react({ chatId: ANA } as never, ANA, 'm1', THUMBS)).rejects.toMatchObject({ code: 'click' })
      const other = click()
      guard.register(1, other)
      await expect(client.react(guard.consume(1, other, 'outra@s.whatsapp.net') ?? (null as never), ANA, 'm1', THUMBS)).rejects.toMatchObject({ code: 'click' })
      expect(bridge.received).toHaveLength(1)
    } finally {
      bridge.server.close()
    }
  })

  it('sem token, de outra janela, vencido ou repetido: recusa sem chegar ao serviço; só os 6 emojis', async () => {
    const bridge = await fakeBridge()
    let now = 5_000_000
    try {
      const { service } = await reattached(bridge.port, { now: () => now })
      const base = { chatId: ANA, messageId: 'm1', emoji: THUMBS }
      expect(await service.react(1, base)).toEqual({ ok: false, error: 'click' })
      expect(await service.react(1, { ...base, clickToken: click() })).toEqual({ ok: false, error: 'click' })
      const otherWindow = click()
      service.registerClick(2, otherWindow)
      expect(await service.react(1, { ...base, clickToken: otherWindow })).toEqual({ ok: false, error: 'click' })
      const late = click()
      service.registerClick(1, late)
      now += WHATSAPP_CLICK_TTL_MS + 1
      expect(await service.react(1, { ...base, clickToken: late })).toEqual({ ok: false, error: 'click' })
      // Emoji fora da lista: inválido, e o token não volta a valer.
      const fire = click()
      service.registerClick(1, fire)
      expect(await service.react(1, { ...base, emoji: '\u{1F525}', clickToken: fire })).toEqual({ ok: false, error: 'invalid' })
      expect(await service.react(1, { ...base, clickToken: fire })).toEqual({ ok: false, error: 'click' })
      expect(bridge.received).toHaveLength(0)
      // Com o clique: sai, e um token só vale uma vez.
      const ok = click()
      service.registerClick(1, ok)
      expect(await service.react(1, { ...base, clickToken: ok })).toEqual({ ok: true, reactions: [{ emoji: THUMBS, count: 1, mine: true }] })
      expect(await service.react(1, { ...base, clickToken: ok })).toEqual({ ok: false, error: 'click' })
      // Vazio tira a sua.
      const remove = click()
      service.registerClick(1, remove)
      await service.react(1, { ...base, emoji: '', clickToken: remove })
      expect(bridge.received.map((item) => item.body)).toEqual([{ emoji: THUMBS }, { emoji: '' }])
      // Mensagem que o serviço não tem: `missing`.
      bridge.react = { status: 404, body: { error: 'message' } }
      const missing = click()
      service.registerClick(1, missing)
      expect(await service.react(1, { ...base, clickToken: missing })).toEqual({ ok: false, error: 'missing' })
    } finally {
      bridge.server.close()
    }
  })
})

describe('o seu "digitando…" só com o interruptor (CA3)', () => {
  it('desligado (ou sem a leitura dele), nada vai ao serviço; ligado, "digitando" e "parou"', async () => {
    const bridge = await fakeBridge()
    let on = false
    try {
      const { service } = await reattached(bridge.port, { typing: () => on })
      expect(await service.typing({ chatId: ANA, state: 'composing' })).toBe(false)
      on = true
      expect(await service.typing({ chatId: ANA, state: 'composing' })).toBe(true)
      expect(await service.typing({ chatId: ANA, state: 'paused' })).toBe(true)
      expect(await service.typing({ chatId: ANA, state: 'available' })).toBe(false)
      expect(await service.typing({ chatId: 'nada', state: 'paused' })).toBe(false)
      expect(bridge.received.map((item) => [item.path, item.body])).toEqual([
        [`/chats/${encodeURIComponent(ANA)}/presence`, { state: 'composing' }],
        [`/chats/${encodeURIComponent(ANA)}/presence`, { state: 'paused' }],
      ])
      on = false
      expect(await service.typing({ chatId: ANA, state: 'paused' })).toBe(false)
      expect(bridge.received).toHaveLength(2)
      const without = await reattached(bridge.port)
      expect(await without.service.typing({ chatId: ANA, state: 'composing' })).toBe(false)
      expect(bridge.received).toHaveLength(2)
    } finally {
      bridge.server.close()
    }
  })
})
