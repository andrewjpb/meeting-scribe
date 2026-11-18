// Enviar imagem e vídeo pelo WhatsApp (contrato 39): o tipo pelos primeiros bytes (JPEG, PNG, WebP, GIF, MP4, MOV; o
// tipo mentiroso é recusado), os limites (16 MB imagem, 64 MB vídeo), o arquivo do clipe lido no main, o POST binário do
// cliente e o envio no serviço do main com a mesma prova de clique do texto (sem token, outra janela, vencido), sem a
// correção do contrato 35. A lógica da prévia do renderer fica em `test/renderer/whatsapp-attach.test.ts`.
import { spawn as spawnChild } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  attachName,
  checkAttachment,
  sniffAttachment,
  WHATSAPP_ATTACH_IMAGE_MAX,
  WHATSAPP_ATTACH_VIDEO_MAX,
} from '../src/shared/whatsapp-attach'
import { WHATSAPP_CLICK_TTL_MS } from '../src/shared/whatsapp'
import { createVault } from '../src/main/accounts/vault'
import { memorySafeStorage } from '../src/main/secrets'
import { readAttachment } from '../src/main/whatsapp/attach'
import { createBridgeClient, SEND_MEDIA_TIMEOUT_MS } from '../src/main/whatsapp/client'
import { createSendGuard } from '../src/main/whatsapp/send-guard'
import { createWhatsAppService } from '../src/main/whatsapp/service'

const ANA = '5511911110000@s.whatsapp.net'
const TOKEN = '0123456789abcdef'.repeat(4)
const INSTANCE = 'a1b2c3d4'.repeat(4)
const bin = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))
const pad = (head: number[], size = 64): Uint8Array => {
  const out = new Uint8Array(Math.max(size, head.length))
  out.set(head)
  return out
}
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0])
const PNG = pad([0x89, ...bin('PNG\r\n\x1a\n')])
const WEBP = pad([...bin('RIFF'), 0, 0, 0, 0, ...bin('WEBPVP8 ')])
const GIF = pad(bin('GIF89a'))
const MP4 = pad([0, 0, 0, 0x18, ...bin('ftypmp42'), 0, 0, 0, 0, ...bin('mp42isom')])
const MOV = pad([0, 0, 0, 0x14, ...bin('ftypqt  '), 0, 0, 0, 0, ...bin('qt  ')])

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-wa-attach-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('tipo pelos primeiros bytes e limites (CA1)', () => {
  it('reconhece JPEG, PNG, WebP, GIF, MP4 e MOV', () => {
    expect(sniffAttachment(JPEG)).toBe('image/jpeg')
    expect(sniffAttachment(PNG)).toBe('image/png')
    expect(sniffAttachment(WEBP)).toBe('image/webp')
    expect(sniffAttachment(pad(bin('GIF87a')))).toBe('image/gif')
    expect(sniffAttachment(GIF)).toBe('image/gif')
    expect(sniffAttachment(MP4)).toBe('video/mp4')
    expect(sniffAttachment(pad([0, 0, 0, 0x20, ...bin('ftypisom')]))).toBe('video/mp4')
    expect(sniffAttachment(MOV)).toBe('video/quicktime')
  })

  it('recusa o resto: texto, SVG, PDF, HEIF, áudio M4A, cabeçalho cortado', () => {
    expect(sniffAttachment(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffAttachment(pad(bin('%PDF-1.7')))).toBeNull()
    expect(sniffAttachment(pad([0, 0, 0, 0x18, ...bin('ftypheic')]))).toBeNull()
    expect(sniffAttachment(pad([0, 0, 0, 0x18, ...bin('ftypM4A ')]))).toBeNull()
    expect(sniffAttachment(pad([...bin('RIFF'), 0, 0, 0, 0, ...bin('WAVE')]))).toBeNull()
    expect(sniffAttachment(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffAttachment(new Uint8Array(0))).toBeNull()
    // SVG/HTML disfarçado de QuickTime antigo ("free" nos bytes 4 a 8) e o próprio QuickTime sem `ftyp`: recusados.
    const disguised = new TextEncoder().encode('<!--free--><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')
    expect(sniffAttachment(disguised)).toBeNull()
    expect(checkAttachment(disguised, { declared: 'video/quicktime' })).toEqual({ ok: false, error: 'type' })
    expect(sniffAttachment(new TextEncoder().encode('<!--skip--><html><script>x</script></html>'))).toBeNull()
    expect(sniffAttachment(pad([0, 0, 0, 8, ...bin('wide')]))).toBeNull()
    expect(sniffAttachment(pad([0, 0, 0, 8, ...bin('moov')]))).toBeNull()
  })

  it('o tipo declarado tem de bater com os bytes, e cada tipo tem o seu limite', () => {
    expect(checkAttachment(PNG, { declared: 'image/png' })).toEqual({ ok: true, mime: 'image/png', kind: 'image' })
    // Mentiroso: PNG dito JPEG, imagem dita vídeo, texto dito imagem.
    expect(checkAttachment(PNG, { declared: 'image/jpeg' })).toEqual({ ok: false, error: 'type' })
    expect(checkAttachment(PNG, { declared: 'video/mp4' })).toEqual({ ok: false, error: 'type' })
    expect(checkAttachment(new TextEncoder().encode('oi, não sou imagem'), { declared: 'image/png' })).toEqual({ ok: false, error: 'type' })
    expect(checkAttachment(JPEG, { size: WHATSAPP_ATTACH_IMAGE_MAX })).toMatchObject({ ok: true })
    expect(checkAttachment(JPEG, { size: WHATSAPP_ATTACH_IMAGE_MAX + 1 })).toEqual({ ok: false, error: 'too-big', kind: 'image' })
    expect(checkAttachment(MP4, { size: WHATSAPP_ATTACH_IMAGE_MAX + 1 })).toMatchObject({ ok: true, kind: 'video' })
    expect(checkAttachment(MP4, { size: WHATSAPP_ATTACH_VIDEO_MAX + 1 })).toEqual({ ok: false, error: 'too-big', kind: 'video' })
    expect(WHATSAPP_ATTACH_IMAGE_MAX).toBe(16 * 1024 * 1024)
    expect(WHATSAPP_ATTACH_VIDEO_MAX).toBe(64 * 1024 * 1024)
  })

  it('o nome vai sem caminho e sem caracteres de controle', () => {
    expect(attachName('/Users/ana/Fotos/praia.jpg')).toBe('praia.jpg')
    expect(attachName('C:\\fotos\\a\u0000b\n.png')).toBe('ab.png')
    expect(attachName('')).toBe('arquivo')
    expect(attachName(`${'x'.repeat(300)}.png`)).toHaveLength(200)
  })
})

describe('o clipe: o arquivo escolhido lido no main (CA1)', () => {
  it('aceita pelo conteúdo, não pela extensão, e recusa o grande demais sem ler tudo', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'foto.jpg'), PNG)
    writeFileSync(join(dir, 'falsa.png'), 'só texto aqui, nada de imagem')
    writeFileSync(join(dir, 'vazia.png'), '')
    const picked = await readAttachment(join(dir, 'foto.jpg'))
    expect(picked).toMatchObject({ ok: true, attachment: { name: 'foto.jpg', mime: 'image/png', kind: 'image' } })
    expect(picked?.ok && Buffer.compare(Buffer.from(picked.attachment.bytes), Buffer.from(PNG))).toBe(0)
    expect(await readAttachment(join(dir, 'falsa.png'))).toEqual({ ok: false, error: 'type' })
    expect(await readAttachment(join(dir, 'vazia.png'))).toEqual({ ok: false, error: 'type' })
    expect(await readAttachment(dir)).toEqual({ ok: false, error: 'type' })
    // Imagem de 16 MB + 1 byte: recusada pelo tamanho.
    const big = new Uint8Array(WHATSAPP_ATTACH_IMAGE_MAX + 1)
    big.set(JPEG.subarray(0, 4))
    writeFileSync(join(dir, 'grande.jpg'), big)
    expect(await readAttachment(join(dir, 'grande.jpg'))).toEqual({ ok: false, error: 'too-big', kind: 'image' })
  })
})

interface Received {
  path: string
  headers: IncomingHttpHeaders
  body: Buffer
}

/** Serviço falso: `/health`, `/chats` (só a Ana) e o `send-media`, que guarda o que chegou e responde `status`. */
function fakeBridge(reply: { status: number; body: unknown } = { status: 200, body: { id: 'enviada-1' } }): Promise<{ server: Server; port: number; received: Received[]; reply: typeof reply }> {
  const received: Received[] = []
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
        return undefined
      }
      if (path === '/chats') return json(200, { chats: [{ id: ANA, name: 'Ana Souza', kind: 'person', unread: 0, lastMessage: null }] })
      if (/^\/chats\/[^/]+\/send-media$/.test(path)) {
        received.push({ path, headers: req.headers, body: Buffer.concat(chunks) })
        return json(state.reply.status, state.reply.body)
      }
      return json(404, { error: 'not-found' })
    })
  })
  const state = { reply }
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
        received,
        get reply() {
          return state.reply
        },
        set reply(next) {
          state.reply = next
        },
      })
    }),
  )
}

async function reattached(port: number, now?: () => number) {
  const root = tempDir()
  const safe = memorySafeStorage()
  createVault(join(root, 'service.bin'), safe, (raw) => raw).write({ token: TOKEN, port, on: true, instanceId: INSTANCE })
  mkdirSync(join(root, 'venv', 'bin'), { recursive: true })
  writeFileSync(join(root, 'venv', 'bin', 'python'), '')
  writeFileSync(join(root, 'installed.json'), '{}')
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
    // A correção do contrato 35 nunca roda na legenda.
    correct: (text) => {
      corrections.push(text)
      return Promise.resolve(text.toUpperCase())
    },
    meeting: () => Promise.resolve(null),
    onStatus: () => undefined,
    onMessage: () => undefined,
    ...(now ? { now } : {}),
  })
  await service.init()
  return { service, corrections }
}

let clicks = 0
const click = (): string => `7${String(++clicks).padStart(7, '0')}-2222-4333-8444-555555555555`

describe('cliente: o POST binário do anexo (CA2)', () => {
  it('manda os bytes no corpo e o tipo, o nome e a legenda nos cabeçalhos; só com a prova', async () => {
    const bridge = await fakeBridge()
    try {
      const client = createBridgeClient(bridge.port, TOKEN)
      const guard = createSendGuard()
      const token = click()
      guard.register(1, token)
      const proof = guard.consume(1, token, ANA)
      if (!proof) throw new Error('sem prova')
      expect(await client.sendMedia(proof, ANA, { name: 'foto ação.png', mime: 'image/png', bytes: PNG, caption: 'olha isso 👀\nlinha 2' })).toBe('enviada-1')
      const got = bridge.received[0]
      expect(got?.path).toBe(`/chats/${encodeURIComponent(ANA)}/send-media`)
      expect(got?.headers['x-media-mime']).toBe('image/png')
      expect(decodeURIComponent(String(got?.headers['x-media-name']))).toBe('foto ação.png')
      expect(decodeURIComponent(String(got?.headers['x-caption']))).toBe('olha isso 👀\nlinha 2')
      expect(got?.headers['content-type']).toBe('application/octet-stream')
      expect(Buffer.compare(got?.body ?? Buffer.alloc(0), Buffer.from(PNG))).toBe(0)
      // Sem legenda, sem o cabeçalho. Prova de outra conversa ou nenhuma: nada sai.
      const again = click()
      guard.register(1, again)
      await client.sendMedia(guard.consume(1, again, ANA) ?? (null as never), ANA, { name: 'v.mp4', mime: 'video/mp4', bytes: MP4 })
      expect(bridge.received[1]?.headers['x-caption']).toBeUndefined()
      const other = click()
      guard.register(1, other)
      await expect(client.sendMedia(guard.consume(1, other, 'outra@s.whatsapp.net') ?? (null as never), ANA, { name: 'a.png', mime: 'image/png', bytes: PNG })).rejects.toMatchObject({ code: 'click' })
      await expect(client.sendMedia({ chatId: ANA } as never, ANA, { name: 'a.png', mime: 'image/png', bytes: PNG })).rejects.toMatchObject({ code: 'click' })
      expect(bridge.received).toHaveLength(2)
    } finally {
      bridge.server.close()
    }
  })
})

describe('serviço: o envio do anexo com a mesma prova de clique (CA2, CA4)', () => {
  it('o envio do anexo espera até 300 s (sem resposta, a tela pede para conferir antes de reenviar)', () => {
    expect(SEND_MEDIA_TIMEOUT_MS).toBe(300_000)
  })

  it('sem token, token de outra janela, vencido ou repetido: recusa sem chegar ao serviço', async () => {
    const bridge = await fakeBridge()
    let now = 1_000_000
    try {
      const { service } = await reattached(bridge.port, () => now)
      const base = { chatId: ANA, name: 'foto.png', mime: 'image/png', bytes: PNG }
      expect(await service.sendMedia(1, base)).toEqual({ ok: false, error: 'click' })
      expect(await service.sendMedia(1, { ...base, clickToken: click() })).toEqual({ ok: false, error: 'click' })
      const otherWindow = click()
      service.registerClick(2, otherWindow)
      expect(await service.sendMedia(1, { ...base, clickToken: otherWindow })).toEqual({ ok: false, error: 'click' })
      const late = click()
      service.registerClick(1, late)
      now += WHATSAPP_CLICK_TTL_MS + 1
      expect(await service.sendMedia(1, { ...base, clickToken: late })).toEqual({ ok: false, error: 'click' })
      const once = click()
      service.registerClick(1, once)
      expect(await service.sendMedia(1, { ...base, clickToken: once })).toEqual({ ok: true, id: 'enviada-1' })
      expect(await service.sendMedia(1, { ...base, clickToken: once })).toEqual({ ok: false, error: 'click' })
      // O token do texto é o mesmo guarda: gasto no anexo, não envia texto.
      expect(await service.send(1, { chatId: ANA, text: 'oi', clickToken: once })).toEqual({ ok: false, error: 'click' })
      expect(bridge.received).toHaveLength(1)
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })

  it('confere de novo os bytes e o limite no main, e a legenda vai como foi digitada (sem a correção)', async () => {
    const bridge = await fakeBridge()
    try {
      const { service, corrections } = await reattached(bridge.port)
      const send = (request: Record<string, unknown>) => {
        const token = click()
        service.registerClick(1, token)
        return service.sendMedia(1, { chatId: ANA, name: 'foto.png', ...request, clickToken: token })
      }
      // O renderer diz PNG, os bytes são JPEG; tipo fora da lista; texto dito imagem; campo a mais; bytes que não são bytes.
      expect(await send({ mime: 'image/png', bytes: JPEG })).toEqual({ ok: false, error: 'invalid' })
      expect(await send({ mime: 'image/svg+xml', bytes: PNG })).toEqual({ ok: false, error: 'invalid' })
      expect(await send({ mime: 'image/png', bytes: new TextEncoder().encode('não sou imagem') })).toEqual({ ok: false, error: 'invalid' })
      expect(await send({ mime: 'image/png', bytes: PNG, extra: 1 })).toEqual({ ok: false, error: 'invalid' })
      expect(await send({ mime: 'image/png', bytes: [...PNG] })).toEqual({ ok: false, error: 'invalid' })
      expect(await send({ mime: 'image/png', bytes: PNG, chatId: 'outra@s.whatsapp.net' })).toEqual({ ok: false, error: 'invalid' })
      const big = new Uint8Array(WHATSAPP_ATTACH_IMAGE_MAX + 1)
      big.set(JPEG.subarray(0, 4))
      expect(await send({ mime: 'image/jpeg', bytes: big })).toEqual({ ok: false, error: 'too-big' })
      expect(bridge.received).toHaveLength(0)
      expect(await send({ mime: 'video/quicktime', bytes: MOV, name: 'v.mov', caption: 'oi tudo bem' })).toEqual({ ok: true, id: 'enviada-1' })
      expect(decodeURIComponent(String(bridge.received[0]?.headers['x-caption']))).toBe('oi tudo bem')
      expect(corrections).toEqual([])
      // Legenda só de espaços não vai.
      await send({ mime: 'image/gif', bytes: GIF, caption: '   ' })
      expect(bridge.received[1]?.headers['x-caption']).toBeUndefined()
      // Erros do serviço: 413, 400, 409, o ffmpeg que falta (503) e 502.
      for (const [status, code, error] of [
        [413, 'x', 'too-big'],
        [400, 'x', 'invalid'],
        [409, 'x', 'state'],
        [503, 'ffmpeg', 'ffmpeg'],
        [503, 'x', 'failed'],
        [502, 'x', 'failed'],
      ] as const) {
        bridge.reply = { status, body: { error: code } }
        expect(await send({ mime: 'image/webp', bytes: WEBP })).toEqual({ ok: false, error })
      }
      await service.dispose()
    } finally {
      bridge.server.close()
    }
  })
})
