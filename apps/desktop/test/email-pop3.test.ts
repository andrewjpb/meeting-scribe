// Contrato 42, CA4 (e o POP3 do CA6): o cliente próprio contra um servidor POP3 FALSO de verdade, num socket TCP do
// teste em 127.0.0.1 (com STLS por um certificado de teste), pelo serviço inteiro: o poll fala USER/PASS (e STLS),
// usa o UIDL para baixar só as novas, não manda DELE por padrão e lembra os UIDLs no store.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectPop3, unstuff } from '../src/main/email/pop3-client'
import { createEmailService, EMAIL_FAILURES, parseEmail, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import { createFileSettingsStore } from '../src/main/settings/store'
import type { SafeStorageLike } from '../src/main/secrets'
import type { EmailAccountStatus, EmailMessage, EmailSecurity } from '../src/shared/email'

// Certificado só de teste (localhost e 127.0.0.1, autoassinado), para o STLS do servidor falso.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBejCCASCgAwIBAgIUE9rqqnp2SJkWeH5pqf9BXoE6JcAwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTExOTAzNDAwM1oYDzIxMjYxMDI2
MDM0MDAzWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAATomGnDabF7hJkBfShqDMkbiMKxdcAQfpFmpLG2a3+YPmMsQ7xEykPp
Cpv6Q0BA3pLAcbqRO46X9rd1hZv1+EtFo04wTDAdBgNVHQ4EFgQUGL3m8jF3ixKY
xllr3Fz/CA5F6pIwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhv
c3SHBH8AAAEwCgYIKoZIzj0EAwIDSAAwRQIhAM+dYHY3w2Ns2kjXg8gT4ATLMHzV
SolX5+qN+ytZ8oR6AiAxDaHLJ49sp5R4lEP4wQ55ffhHHNzbeCPweMrBTRgq7Q==
-----END CERTIFICATE-----`
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgln/kX9g/tWWflCy/
m12MgizZoXKdMGIv0zeiZ2WtD/ShRANCAATomGnDabF7hJkBfShqDMkbiMKxdcAQ
fpFmpLG2a3+YPmMsQ7xEykPpCpv6Q0BA3pLAcbqRO46X9rd1hZv1+EtF
-----END PRIVATE KEY-----`

const PASSWORD = 'pop-senha-123'

/** `safeStorage` falso: cifra de verdade (inverte e embaralha), sem Chaveiro. */
const fakeSafeStorage = (): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

const rawMessage = (n: number): string =>
  [`From: Remetente ${n} <r${n}@exemplo.com>`, 'To: ana@exemplo.com.br', `Subject: Assunto ${n}`, `Message-ID: <m${n}@exemplo.com>`, 'Date: Wed, 18 Nov 2026 10:00:00 +0000', '', `Corpo ${n}`, '.linha que começa com ponto', ''].join('\r\n')

interface FakePop3 {
  port: number
  /** Comandos recebidos, por sessão (a senha aparece como `PASS ***`). */
  sessions: string[][]
  /** Senhas recebidas (só para o teste conferir que chegou a certa). */
  passwords: string[]
  /** `size`: o que o `LIST` informa (sem ele, o tamanho de verdade). */
  messages: { uidl: string; raw: string; size?: number }[]
  /** UIDL cujo `RETR` derruba a conexão (uma vez). */
  dropOn: string | null
  close(): Promise<void>
}

/** Servidor POP3 falso (RFC 1939) com `STLS` opcional. */
async function startFakePop3(options: { stls: boolean; password?: string }): Promise<FakePop3> {
  const fake: FakePop3 = { port: 0, sessions: [], passwords: [], messages: [], dropOn: null, close: () => Promise.resolve() }
  const sockets = new Set<Socket>()
  const server: Server = createServer((plain) => {
    sockets.add(plain)
    const commands: string[] = []
    fake.sessions.push(commands)
    const deleted = new Set<number>()
    let socket: Socket = plain
    let buffer = ''
    const reply = (text: string): void => void socket.write(`${text}\r\n`)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('latin1')
      for (let at = buffer.indexOf('\r\n'); at >= 0; at = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const [verb = '', ...rest] = line.split(' ')
        const arg = rest.join(' ')
        commands.push(verb === 'PASS' ? 'PASS ***' : line)
        if (verb === 'STLS') {
          if (!options.stls) {
            reply('-ERR sem STLS')
            continue
          }
          reply('+OK pode começar o TLS')
          plain.off('data', onData)
          const secure = new TLSSocket(plain, { isServer: true, key: KEY, cert: CERT })
          sockets.add(secure)
          secure.on('data', onData)
          secure.on('error', () => undefined)
          socket = secure
          return
        }
        if (verb === 'USER') reply('+OK')
        else if (verb === 'PASS') {
          fake.passwords.push(arg)
          reply(arg === (options.password ?? PASSWORD) ? '+OK caixa aberta' : '-ERR [AUTH] senha errada')
        } else if (verb === 'UIDL') {
          reply('+OK')
          fake.messages.forEach((message, index) => reply(`${index + 1} ${message.uidl}`))
          reply('.')
        } else if (verb === 'LIST') {
          reply('+OK')
          fake.messages.forEach((message, index) => reply(`${index + 1} ${message.size ?? message.raw.length}`))
          reply('.')
        } else if (verb === 'RETR') {
          const message = fake.messages[Number(arg) - 1]
          if (!message) reply('-ERR não existe')
          else if (message.uidl === fake.dropOn) {
            fake.dropOn = null
            socket.destroy()
            return
          } else {
            reply(`+OK ${message.raw.length} octetos`)
            socket.write(message.raw.replace(/(^|\r\n)\./g, '$1..'))
            reply('.')
          }
        } else if (verb === 'DELE') {
          deleted.add(Number(arg))
          reply('+OK marcada')
        } else if (verb === 'QUIT') {
          fake.messages = fake.messages.filter((_message, index) => !deleted.has(index + 1))
          reply('+OK até logo')
          socket.end()
        } else reply('-ERR comando desconhecido')
      }
    }
    plain.on('data', onData)
    plain.on('error', () => undefined)
    plain.on('close', () => sockets.delete(plain))
    reply('+OK POP3 falso pronto')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  fake.port = (server.address() as { port: number }).port
  fake.close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })
  return fake
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

function setup(overrides: Partial<EmailServiceDeps> = {}): { userData: string; service: EmailService; logs: string[]; received: EmailMessage[]; states: EmailAccountStatus[][] } {
  const userData = mkdtempSync(join(tmpdir(), 'scribe-pop3-'))
  const logs: string[] = []
  const received: EmailMessage[] = []
  const states: EmailAccountStatus[][] = []
  const service = createEmailService({
    root: join(userData, 'email'),
    settings: createFileSettingsStore({ dir: userData }),
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    tls: { ca: CERT },
    onStatus: (list) => states.push(list),
    onMessage: (message) => received.push(message),
    log: (message) => logs.push(message),
    retryMs: 3_600_000,
    ...overrides,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  return { userData, service, logs, received, states }
}

const pop3Account = (port: number, security: EmailSecurity, extra: Record<string, unknown> = {}) => ({
  address: 'ana@exemplo.com.br',
  password: PASSWORD,
  incoming: { protocol: 'pop3', host: '127.0.0.1', port, security },
  outgoing: { host: '127.0.0.1', port: 1, security: 'none' },
  ...extra,
})

const stateOf = (service: EmailService, id: string): EmailAccountStatus | undefined => service.accounts().find((status) => status.account.id === id)

describe('cliente POP3 próprio (contrato 42, CA4)', () => {
  it('desfaz o ponto de escape das linhas', () => {
    expect(unstuff(Buffer.from('..a\r\nb\r\n..\r\n')).toString()).toBe('.a\r\nb\r\n.\r\n')
  })

  it('poll com STLS: USER/PASS depois do TLS, UIDL acha as 2 novas, RETR só delas, sem DELE, UIDLs lembrados', async () => {
    const server = await startFakePop3({ stls: true })
    cleanups.push(() => server.close())
    server.messages.push({ uidl: 'uid-1', raw: rawMessage(1) })
    const { userData, service, received } = setup()

    const added = await service.addAccount(pop3Account(server.port, 'starttls'))
    if (!added.ok) throw new Error('conta não entrou')
    const id = added.status.account.id
    await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))
    // Primeiro poll: a que já estava lá é baixada, sem aviso de mensagem nova.
    expect(server.sessions[0]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'LIST', 'RETR 1', 'QUIT'])
    expect(server.passwords).toEqual([PASSWORD])
    expect(received).toEqual([])

    server.messages.push({ uidl: 'uid-2', raw: rawMessage(2) }, { uidl: 'uid-3', raw: rawMessage(3) })
    await service.poll(id)
    expect(server.sessions[1]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'LIST', 'RETR 2', 'RETR 3', 'QUIT'])
    expect(server.sessions.flat().some((command) => command.startsWith('DELE'))).toBe(false)
    // As 3 continuam no servidor.
    expect(server.messages.map((message) => message.uidl)).toEqual(['uid-1', 'uid-2', 'uid-3'])
    expect(received.map((message) => message.id)).toEqual(['uid-2', 'uid-3'])
    expect(received[0]).toMatchObject({ accountId: id, folder: 'inbox', subject: 'Assunto 2', from: [{ name: 'Remetente 2', address: 'r2@exemplo.com' }], messageId: '<m2@exemplo.com>' })

    // No store, por conta: os 3 UIDLs vistos e as 3 mensagens; o corpo já veio no RETR, sem o ponto de escape.
    const stored = JSON.parse(readFileSync(join(userData, 'email', `${id}.json`), 'utf8')) as { seenUidls: string[]; inbox: EmailMessage[] }
    expect(stored.seenUidls.sort()).toEqual(['uid-1', 'uid-2', 'uid-3'])
    expect((await service.messages({ accountId: id })).map((message) => message.id).sort()).toEqual(['uid-1', 'uid-2', 'uid-3'])
    const body = await service.body({ accountId: id, id: 'uid-3' })
    expect(body).toMatchObject({ ok: true, body: { text: 'Corpo 3\n.linha que começa com ponto\n' } })

    // Sem nada novo, o poll seguinte não baixa nada.
    await service.poll(id)
    expect(server.sessions[2]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'QUIT'])
  })

  it('uma mensagem grande demais e uma ilegível entre as boas: as boas chegam e os polls seguintes não travam', async () => {
    const server = await startFakePop3({ stls: true })
    cleanups.push(() => server.close())
    server.messages.push({ uidl: 'boa-1', raw: rawMessage(1) })
    const { userData, service, received, logs } = setup({
      // O `mailparser` de verdade, mas a mensagem marcada como quebrada falha (MIME que não se lê).
      parse: (raw) => (raw.toString('latin1').includes('QUEBRADA') ? Promise.reject(new Error('MIME inválido')) : parseEmail(raw)),
    })
    const added = await service.addAccount(pop3Account(server.port, 'starttls'))
    if (!added.ok) throw new Error('conta não entrou')
    const id = added.status.account.id
    await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))

    server.messages.push(
      { uidl: 'boa-2', raw: rawMessage(2) },
      // O `LIST` diz 30 MB: nem chega ao RETR.
      { uidl: 'gigante', raw: rawMessage(9), size: 30 * 1024 * 1024 },
      { uidl: 'quebrada', raw: rawMessage(8).replace('Corpo 8', 'QUEBRADA') },
      { uidl: 'boa-3', raw: rawMessage(3) },
    )
    await service.poll(id)
    expect(server.sessions[1]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'LIST', 'RETR 2', 'RETR 4', 'RETR 5', 'QUIT'])
    expect(received.map((message) => message.id)).toEqual(['boa-2', 'boa-3'])
    expect(stateOf(service, id)?.state).toBe('connected')
    expect(logs.some((line) => line.includes('grande demais, pulada'))).toBe(true)
    expect(logs.some((line) => line.includes('ilegível, pulada'))).toBe(true)
    const stored = JSON.parse(readFileSync(join(userData, 'email', `${id}.json`), 'utf8')) as { seenUidls: string[] }
    expect(stored.seenUidls.sort()).toEqual(['boa-1', 'boa-2', 'boa-3', 'gigante', 'quebrada'])
    expect((await service.messages({ accountId: id })).map((message) => message.id).sort()).toEqual(['boa-1', 'boa-2', 'boa-3'])

    // O poll seguinte não tenta de novo nenhuma das duas ruins.
    await service.poll(id)
    expect(server.sessions[2]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'QUIT'])
    expect(stateOf(service, id)?.state).toBe('connected')
  })

  it('a conexão cai no meio do poll: o que já entrou fica visto; a que caiu vem no poll seguinte', async () => {
    const server = await startFakePop3({ stls: false })
    cleanups.push(() => server.close())
    server.messages.push({ uidl: 'x-1', raw: rawMessage(1) })
    const { service } = setup()
    const added = await service.addAccount(pop3Account(server.port, 'none'))
    if (!added.ok) throw new Error('conta não entrou')
    const id = added.status.account.id
    await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))

    server.messages.push({ uidl: 'x-2', raw: rawMessage(2) }, { uidl: 'x-3', raw: rawMessage(3) })
    server.dropOn = 'x-3'
    await service.poll(id)
    expect(stateOf(service, id)).toMatchObject({ state: 'error', error: EMAIL_FAILURES.connection })
    expect((await service.messages({ accountId: id })).map((message) => message.id).sort()).toEqual(['x-1', 'x-2'])

    // Falha de rede não marca a mensagem como vista: ela vem agora, e a x-2 não é baixada de novo.
    await service.poll(id)
    expect(server.sessions.at(-1)).toEqual(['USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'LIST', 'RETR 3', 'QUIT'])
    expect(stateOf(service, id)?.state).toBe('connected')
    expect((await service.messages({ accountId: id })).map((message) => message.id).sort()).toEqual(['x-1', 'x-2', 'x-3'])
  })

  it('com deleteFromServer: manda DELE de cada uma baixada', async () => {
    const server = await startFakePop3({ stls: true })
    cleanups.push(() => server.close())
    server.messages.push({ uidl: 'a', raw: rawMessage(1) }, { uidl: 'b', raw: rawMessage(2) })
    const { service } = setup()
    const added = await service.addAccount(pop3Account(server.port, 'starttls', { deleteFromServer: true }))
    if (!added.ok) throw new Error('conta não entrou')
    await vi.waitFor(() => expect(stateOf(service, added.status.account.id)?.state).toBe('connected'))
    expect(server.sessions[0]).toEqual(['STLS', 'USER ana@exemplo.com.br', 'PASS ***', 'UIDL', 'LIST', 'RETR 1', 'DELE 1', 'RETR 2', 'DELE 2', 'QUIT'])
    expect(server.messages).toEqual([])
  })

  it('starttls com servidor sem STLS: para antes do USER, a senha não vai em texto puro, conta em erro', async () => {
    const server = await startFakePop3({ stls: false })
    cleanups.push(() => server.close())
    const { service } = setup()
    const added = await service.addAccount(pop3Account(server.port, 'starttls'))
    if (!added.ok) throw new Error('conta não entrou')
    await vi.waitFor(() => expect(stateOf(service, added.status.account.id)?.state).toBe('error'))
    expect(stateOf(service, added.status.account.id)?.error).toBe(EMAIL_FAILURES.tls)
    expect(server.sessions[0]).toEqual(['STLS'])
    expect(server.passwords).toEqual([])
  })

  it('CA6: senha errada vira erro curto, sem a senha em log; servidor fora vira "fora do ar"', async () => {
    const server = await startFakePop3({ stls: false, password: 'outra' })
    cleanups.push(() => server.close())
    const consoleCalls: string[] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void consoleCalls.push(args.map(String).join(' ')))
    const { service, logs } = setup()
    const wrong = await service.addAccount(pop3Account(server.port, 'none'))
    // Porta fechada: nada escuta ali.
    const closed = await startFakePop3({ stls: false })
    const closedPort = closed.port
    await closed.close()
    const down = await service.addAccount({ ...pop3Account(closedPort, 'none'), address: 'bia@exemplo.com.br' })
    if (!wrong.ok || !down.ok) throw new Error('conta não entrou')
    await vi.waitFor(() => {
      expect(stateOf(service, wrong.status.account.id)).toMatchObject({ state: 'error', error: EMAIL_FAILURES.auth })
      expect(stateOf(service, down.status.account.id)).toMatchObject({ state: 'error', error: EMAIL_FAILURES.connection })
    })
    expect(server.passwords).toEqual([PASSWORD])
    const everything = [...logs, ...consoleCalls].join('\n')
    expect(logs.length).toBeGreaterThan(0)
    expect(everything).not.toContain(PASSWORD)
    expect(everything).not.toContain('ana@exemplo.com.br')
  })

  it('o cliente sozinho também recusa CR/LF no usuário ou na senha (não vira outro comando)', async () => {
    const server = await startFakePop3({ stls: false })
    cleanups.push(() => server.close())
    await expect(connectPop3({ host: '127.0.0.1', port: server.port, security: 'none', user: 'ana', pass: 'x\r\nDELE 1' })).rejects.toMatchObject({ kind: 'auth' })
    expect(server.sessions).toEqual([])
  })
})
