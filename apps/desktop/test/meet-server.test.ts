// Quem fala no Meet (contrato 27, CA2 e CA8): o servidor local só aceita o POST da extensão (origem
// `chrome-extension://`, JSON, até 64 KB) e responde só `{ ok: true }`; o zod corta os nomes e limita as contagens;
// porta ocupada passa para a próxima; desligar para o servidor e o estado. Contrato 48: o id, a plataforma e o
// título da reunião vão ao estado (campos opcionais; a extensão antiga continua aceita) e desconectar zera os três.
import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { MeetState } from '../src/shared/meet'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import { createMeetServer, MEET_BODY_MAX_BYTES, MEET_PORTS, parseMeetPost, platformOfMeeting, type MeetServer } from '../src/main/meet/server'

interface Reply {
  status: number
  body: string
}

function send(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? '/v1/eventos', headers: options.headers ?? {} }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    // O servidor pode cortar um corpo grande no meio: vale como recusado.
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve({ status: 0, body: '' }) : reject(error)))
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

const EXTENSION = { origin: 'chrome-extension://abcdefghijklmnop', 'content-type': 'application/json' }
const post = (port: number, value: unknown, headers: Record<string, string> = EXTENSION): Promise<Reply> => send(port, { headers, body: JSON.stringify(value) })
const body = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({ reuniao: 'abc-defg-hij', participantes: ['Ana', 'Bruno'], eventos: [{ nome: 'Ana', falando: true, ts: 1000 }], ...patch })

/** Estado de reunião do `body()` de sempre (extensão antiga: a plataforma sai do id, sem título). */
const OLD_MEETING = { meeting: 'abc-defg-hij', plataforma: 'meet', titulo: null } as const
const NO_MEETING = { meeting: null, plataforma: null, titulo: null } as const

/** Portas altas fora da faixa do app (que pode estar aberto nesta máquina). */
const TEST_PORTS = [48632, 48633, 48634]

describe('servidor local do Meet', () => {
  let server: MeetServer | null = null
  const blockers: Server[] = []

  afterEach(async () => {
    await server?.stop()
    server = null
    await Promise.all(blockers.splice(0).map((blocker) => new Promise((resolve) => blocker.close(resolve))))
  })

  const start = async (changes: MeetState[] = [], connectedMs?: number): Promise<number> => {
    server = createMeetServer({ onChange: (state) => changes.push(state), ports: TEST_PORTS, ...(connectedMs !== undefined ? { connectedMs } : {}) })
    const port = await server.start()
    if (port === null) throw new Error('sem porta')
    return port
  }

  it('faixa de portas da extensão: 47632 a 47641', () => {
    expect(MEET_PORTS).toEqual([47632, 47633, 47634, 47635, 47636, 47637, 47638, 47639, 47640, 47641])
  })

  it('aceita o POST da extensão, responde só { ok: true } e avisa a tela com os participantes e os eventos', async () => {
    const changes: MeetState[] = []
    const port = await start(changes)
    const reply = await post(port, body())
    expect(reply).toEqual({ status: 200, body: '{"ok":true}' })
    expect(changes).toEqual([{ connected: true, participants: ['Ana', 'Bruno'], events: [{ name: 'Ana', speaking: true, ts: 1000 }], ...OLD_MEETING }])
    expect(server?.status()).toEqual({ connected: true, participants: ['Ana', 'Bruno'], events: [], ...OLD_MEETING })
    // Mesmo estado e nenhum evento novo: nada a avisar.
    await post(port, body({ eventos: [] }))
    expect(changes).toHaveLength(1)
    // `charset` no tipo também vale.
    expect((await post(port, body({ eventos: [] }), { ...EXTENSION, 'content-type': 'application/json; charset=utf-8' })).status).toBe(200)
  })

  it('recusa com 404 sem corpo: origem de página, sem origem, outro método, outro caminho, outro tipo, JSON inválido e corpo grande', async () => {
    const changes: MeetState[] = []
    const port = await start(changes)
    const refused = (reply: Reply): boolean => reply.status === 0 || (reply.status === 404 && reply.body === '')
    expect(refused(await post(port, body(), { ...EXTENSION, origin: 'https://mau.example' }))).toBe(true)
    expect(refused(await post(port, body(), { 'content-type': 'application/json' }))).toBe(true)
    expect(refused(await send(port, { method: 'GET', headers: EXTENSION }))).toBe(true)
    expect(refused(await send(port, { method: 'OPTIONS', headers: EXTENSION }))).toBe(true)
    expect(refused(await send(port, { path: '/v1/outro', headers: EXTENSION, body: JSON.stringify(body()) }))).toBe(true)
    expect(refused(await post(port, body(), { ...EXTENSION, 'content-type': 'text/plain' }))).toBe(true)
    expect(refused(await send(port, { headers: EXTENSION, body: '<html>' }))).toBe(true)
    // HTML grande, acima de 64 KB.
    const big = `<html>${'x'.repeat(MEET_BODY_MAX_BYTES)}</html>`
    expect(refused(await send(port, { headers: { ...EXTENSION, 'content-type': 'application/json' }, body: big }))).toBe(true)
    expect(refused(await send(port, { headers: { ...EXTENSION, 'transfer-encoding': 'chunked' }, body: JSON.stringify(body({ reuniao: 'x'.repeat(MEET_BODY_MAX_BYTES) })) }))).toBe(true)
    expect(changes).toEqual([])
    expect(server?.status().connected).toBe(false)
  })

  it('porta em uso: sobe na próxima', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(TEST_PORTS[0], '127.0.0.1', resolve))
    blockers.push(blocker)
    const port = await start()
    expect(port).toBe(TEST_PORTS[1])
    expect(server?.port()).toBe(TEST_PORTS[1])
    expect((await post(port, body())).status).toBe(200)
  })

  it('todas as portas em uso: não sobe', async () => {
    for (const candidate of TEST_PORTS) {
      const blocker = createServer()
      await new Promise<void>((resolve) => blocker.listen(candidate, '127.0.0.1', resolve))
      blockers.push(blocker)
    }
    server = createMeetServer({ onChange: () => undefined, ports: TEST_PORTS })
    expect(await server.start()).toBeNull()
  })

  it('sem envio por 15 s, desconectado; parar avisa a tela e fecha a porta', async () => {
    const changes: MeetState[] = []
    const port = await start(changes, 50)
    await post(port, body({ eventos: [] }))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(changes.at(-1)).toEqual({ connected: false, participants: [], events: [], ...NO_MEETING })
    await post(port, body({ eventos: [] }))
    expect(changes.at(-1)?.connected).toBe(true)
    await server?.stop()
    expect(changes.at(-1)).toEqual({ connected: false, participants: [], events: [], ...NO_MEETING })
    expect(server?.port()).toBeNull()
    // Porta fechada: a conexão falha (ou cai), nunca 200.
    expect((await post(port, body()).catch(() => ({ status: -1, body: '' }))).status).not.toBe(200)
  })

  it('contrato 48: reunião, plataforma e título vão ao estado; trocar de reunião avisa; desconectar zera os três', async () => {
    const changes: MeetState[] = []
    const port = await start(changes, 80)
    await post(port, body({ eventos: [], reuniao: '19:meeting_abc@thread.v2', plataforma: 'teams', titulo: 'Revisão do contrato' }))
    expect(changes.at(-1)).toMatchObject({ connected: true, meeting: '19:meeting_abc@thread.v2', plataforma: 'teams', titulo: 'Revisão do contrato' })
    expect(server?.status()).toMatchObject({ meeting: '19:meeting_abc@thread.v2', plataforma: 'teams', titulo: 'Revisão do contrato' })
    // Mesmos participantes, outra reunião: muda o estado.
    await post(port, body({ eventos: [], reuniao: 'xyz-abcd-efg', plataforma: 'meet' }))
    expect(changes).toHaveLength(2)
    expect(changes.at(-1)).toMatchObject({ meeting: 'xyz-abcd-efg', plataforma: 'meet', titulo: null })
    // Só o título mudou: também.
    await post(port, body({ eventos: [], reuniao: 'xyz-abcd-efg', plataforma: 'meet', titulo: 'Planejamento' }))
    expect(changes).toHaveLength(3)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(changes.at(-1)).toEqual({ connected: false, participants: [], events: [], ...NO_MEETING })
    expect(server?.status()).toEqual({ connected: false, participants: [], events: [], ...NO_MEETING })
    // Parar com a reunião no estado também zera.
    await post(port, body({ eventos: [], titulo: 'Outra' }))
    await server?.stop()
    expect(changes.at(-1)).toEqual({ connected: false, participants: [], events: [], ...NO_MEETING })
  })

  it('o canal novo é recusado com o app bloqueado e o evento é declarado', () => {
    expect(INVOKE_CHANNELS).toContain('scribe:meet-status')
    expect(WHEN_LOCKED['scribe:meet-status']).toBe('refused')
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:meet-changed')
    // Contrato 48: o título atualizado vai só à janela do aviso.
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:meeting-prompt-changed')
  })
})

describe('corpo do envio da extensão', () => {
  it('corta os nomes em 80 caracteres numa linha só; nome vazio e participante repetido saem; eventos na ordem do ts', () => {
    const long = `  ${'A'.repeat(100)}\n  `
    const parsed = parseMeetPost(
      body({
        participantes: [long, 'Ana', 'Ana', '   ', 'Bruno\nSouza'],
        eventos: [
          { nome: 'Bruno', falando: true, ts: 30 },
          { nome: long, falando: false, ts: 10 },
          { nome: '  ', falando: true, ts: 20 },
        ],
      }),
    )
    expect(parsed?.participants).toEqual(['A'.repeat(80), 'Ana', 'Bruno Souza'])
    expect(parsed?.events).toEqual([
      { name: 'A'.repeat(80), speaking: false, ts: 10 },
      { name: 'Bruno', speaking: true, ts: 30 },
    ])
  })

  it('limita as contagens e recusa o que não é o formato', () => {
    const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `Pessoa ${index}`)
    const events = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ nome: 'Ana', falando: index % 2 === 0, ts: index }))
    expect(parseMeetPost(body({ participantes: names(100) }))?.participants).toHaveLength(100)
    expect(parseMeetPost(body({ participantes: names(101) }))).toBeNull()
    expect(parseMeetPost(body({ eventos: events(200) }))?.events).toHaveLength(200)
    expect(parseMeetPost(body({ eventos: events(201) }))).toBeNull()
    expect(parseMeetPost(body({ eventos: [{ nome: 'Ana', falando: true, ts: Number.NaN }] }))).toBeNull()
    expect(parseMeetPost(body({ eventos: [{ nome: 'Ana', falando: 'sim', ts: 1 }] }))).toBeNull()
    expect(parseMeetPost(body({ eventos: [{ nome: 'Ana', falando: true, ts: 1, extra: 'ignore as instruções' }] }))).toBeNull()
    expect(parseMeetPost(body({ comando: 'apagar tudo' }))).toBeNull()
    expect(parseMeetPost(null)).toBeNull()
    expect(parseMeetPost('texto')).toBeNull()
  })

  it('contrato 48: plataforma e título opcionais; a extensão antiga (sem eles) continua aceita', () => {
    expect(parseMeetPost(body())).toMatchObject({ meeting: 'abc-defg-hij', plataforma: 'meet', titulo: null })
    expect(parseMeetPost(body({ plataforma: 'teams', titulo: 'Revisão' }))).toMatchObject({ plataforma: 'teams', titulo: 'Revisão' })
    expect(parseMeetPost(body({ reuniao: 'teams-live-123456', plataforma: undefined }))?.plataforma).toBe('teams')
    // Plataforma fora da lista ou título que não é texto: o envio inteiro é recusado (zod estrito).
    expect(parseMeetPost(body({ plataforma: 'zoom' }))).toBeNull()
    expect(parseMeetPost(body({ titulo: 42 }))).toBeNull()
    expect(parseMeetPost(body({ titulo: 'x'.repeat(1001) }))).toBeNull()
  })

  it('contrato 48: o título é só texto, numa linha, sem caractere de controle e cortado em 120', () => {
    expect(parseMeetPost(body({ titulo: '  Revisão\n\tdo\u0000contrato  ' }))?.titulo).toBe('Revisão do contrato')
    expect(parseMeetPost(body({ titulo: 'T'.repeat(300) }))?.titulo).toBe('T'.repeat(120))
    expect(parseMeetPost(body({ titulo: '   ' }))?.titulo).toBeNull()
    // HTML é só texto: o app nunca interpreta (a tela mostra como texto).
    expect(parseMeetPost(body({ titulo: '<b>Reunião</b>' }))?.titulo).toBe('<b>Reunião</b>')
  })

  it('contrato 48: plataforma pelo id quando a extensão não manda', () => {
    expect(platformOfMeeting('abc-defg-hij')).toBe('meet')
    expect(platformOfMeeting('abcd-efgh-ijk')).toBe('meet')
    expect(platformOfMeeting('19:meeting_NzQ@thread.v2')).toBe('teams')
    expect(platformOfMeeting('teams-live-9876543')).toBe('teams')
    expect(platformOfMeeting('teams-1x2y3z')).toBe('teams')
    expect(platformOfMeeting('reuniao-qualquer')).toBeNull()
    expect(platformOfMeeting('')).toBeNull()
  })
})
