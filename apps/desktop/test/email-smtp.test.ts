// Contrato 42, CA5: o envio pelo `nodemailer` de verdade contra um servidor SMTP falso num socket TCP do teste
// (127.0.0.1), pelo serviço inteiro: só com o clique, From da conta, Message-ID, In-Reply-To/References na resposta,
// APPEND nos enviados (no IMAP falso) e a falha do SMTP voltando tipada.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { simpleParser } from 'mailparser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImapConnect, ImapMessage, ImapSession } from '../src/main/email/imap-client'
import { createEmailService, safeAttachmentName, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import { smtpErrorKind } from '../src/main/email/smtp-client'
import { createFileSettingsStore } from '../src/main/settings/store'
import type { SafeStorageLike } from '../src/main/secrets'
import type { EmailAccountStatus } from '../src/shared/email'

const PASSWORD = 'smtp-senha-99'
const CLICK = ['11111111-2222-4333-8444-555555555555', '21111111-2222-4333-8444-555555555555', '31111111-2222-4333-8444-555555555555', '41111111-2222-4333-8444-555555555555']
const SENDER = 7

const fakeSafeStorage = (): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

interface Delivery {
  from: string
  to: string[]
  data: string
  user: string | null
}

interface FakeSmtp {
  port: number
  deliveries: Delivery[]
  /** Comandos recebidos (o AUTH sem a credencial). */
  commands: string[]
  close(): Promise<void>
}

/** Servidor SMTP falso (EHLO, AUTH PLAIN e LOGIN, MAIL, RCPT, DATA, QUIT), sem TLS. */
async function startFakeSmtp(password = PASSWORD): Promise<FakeSmtp> {
  const fake: FakeSmtp = { port: 0, deliveries: [], commands: [], close: () => Promise.resolve() }
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    let buffer = ''
    let mode: 'command' | 'data' | 'login-user' | 'login-pass' = 'command'
    let user: string | null = null
    let loginUser = ''
    let current: Delivery = { from: '', to: [], data: '', user: null }
    const reply = (text: string): void => void socket.write(`${text}\r\n`)
    const auth = (name: string, pass: string): void => {
      if (pass === password) {
        user = name
        reply('235 2.7.0 autenticado')
      } else reply('535 5.7.8 credenciais recusadas')
    }
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      for (;;) {
        if (mode === 'data') {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          current.data = buffer.slice(0, end + 2).replace(/(^|\r\n)\.\./g, '$1.')
          buffer = buffer.slice(end + 5)
          fake.deliveries.push({ ...current, user })
          mode = 'command'
          reply('250 2.0.0 recebida')
          continue
        }
        const at = buffer.indexOf('\r\n')
        if (at < 0) return
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        if (mode === 'login-user') {
          loginUser = Buffer.from(line, 'base64').toString()
          mode = 'login-pass'
          reply('334 UGFzc3dvcmQ6')
          continue
        }
        if (mode === 'login-pass') {
          mode = 'command'
          auth(loginUser, Buffer.from(line, 'base64').toString())
          continue
        }
        const verb = line.split(' ')[0]?.toUpperCase() ?? ''
        fake.commands.push(verb === 'AUTH' ? line.split(' ').slice(0, 2).join(' ') : line)
        if (verb === 'EHLO' || verb === 'HELO') reply('250-smtp.falso\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME')
        else if (verb === 'AUTH') {
          const [, method, initial] = line.split(' ')
          if (method?.toUpperCase() === 'PLAIN' && initial) {
            const [, name = '', pass = ''] = Buffer.from(initial, 'base64').toString().split('\0')
            auth(name, pass)
          } else if (method?.toUpperCase() === 'LOGIN') {
            mode = 'login-user'
            reply('334 VXNlcm5hbWU6')
          } else reply('504 método não suportado')
        } else if (verb === 'MAIL') {
          if (!user) {
            reply('530 5.7.0 autentique primeiro')
            continue
          }
          current = { from: /<([^>]*)>/.exec(line)?.[1] ?? '', to: [], data: '', user }
          reply('250 ok')
        } else if (verb === 'RCPT') {
          current.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          reply('250 ok')
        } else if (verb === 'DATA') {
          mode = 'data'
          reply('354 pode mandar')
        } else if (verb === 'RSET' || verb === 'NOOP') reply('250 ok')
        else if (verb === 'QUIT') {
          reply('221 tchau')
          socket.end()
        } else reply('502 não implementado')
      }
    })
    reply('220 smtp.falso ESMTP pronto')
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

/** IMAP falso com uma mensagem para responder e o `APPEND` registrado. */
function fakeImap(parent: ImapMessage): { connect: ImapConnect; appended: Buffer[] } {
  const appended: Buffer[] = []
  const session: ImapSession = {
    uidValidity: '1',
    recent: () => Promise.resolve([parent]),
    since: () => Promise.resolve([]),
    source: () => Promise.resolve(PARENT_RAW),
    setSeen: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    appendSent: (raw) => {
      appended.push(raw)
      return Promise.resolve(true)
    },
    onNew: () => undefined,
    onClose: () => undefined,
    close: () => Promise.resolve(),
  }
  return { connect: () => Promise.resolve(session), appended }
}

const PARENT: ImapMessage = {
  uid: 10,
  flags: ['\\Seen'],
  date: Date.parse('2026-11-18T09:00:00Z'),
  subject: 'Proposta',
  from: [{ name: 'Bruno', address: 'bruno@cliente.com' }],
  to: [{ name: null, address: 'ana@exemplo.com.br' }],
  cc: [],
  messageId: '<orig@cliente.com>',
  inReplyTo: '<raiz@cliente.com>',
  references: ['<raiz@cliente.com>'],
}

/** A original no servidor (contrato 43, CA8 e CA9): texto e dois anexos, um deles com caminho no nome. */
const PARENT_RAW = Buffer.from(
  [
    'From: Bruno <bruno@cliente.com>',
    'To: ana@exemplo.com.br',
    'Subject: Proposta',
    'Message-ID: <orig@cliente.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="m"',
    '',
    '--m',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Segue a planilha.',
    '--m',
    'Content-Type: text/csv; name="planilha.csv"',
    'Content-Disposition: attachment; filename="planilha.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('a;b\n1;2\n').toString('base64'),
    '--m',
    'Content-Type: text/plain; name="x.txt"',
    'Content-Disposition: attachment; filename="../../segredo.txt"',
    '',
    'segredo',
    '--m--',
    '',
  ].join('\r\n'),
)

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

async function setup(smtpPort: number, protocol: 'imap' | 'pop3' = 'imap', extra: Partial<EmailServiceDeps> = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'scribe-smtp-'))
  const imap = fakeImap(PARENT)
  const logs: string[] = []
  const service: EmailService = createEmailService({
    root: join(userData, 'email'),
    settings: createFileSettingsStore({ dir: userData }),
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    imap: imap.connect,
    // POP3 sem servidor neste teste: só o envio importa.
    pop3: () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })),
    onStatus: () => undefined,
    onMessage: () => undefined,
    log: (message) => logs.push(message),
    retryMs: 3_600_000,
    ...extra,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  const added = await service.addAccount({
    address: 'ana@exemplo.com.br',
    password: PASSWORD,
    name: 'Ana Souza',
    incoming: { protocol, host: '127.0.0.1', port: 993, security: 'tls' },
    outgoing: { host: '127.0.0.1', port: smtpPort, security: 'none' },
  })
  if (!added.ok) throw new Error('conta não entrou')
  const accountId = added.status.account.id
  if (protocol === 'imap') await vi.waitFor(() => expect(service.accounts().find((status: EmailAccountStatus) => status.account.id === accountId)?.state).toBe('connected'))
  return { service, accountId, imap, logs }
}

describe('envio por SMTP (contrato 42, CA5)', () => {
  it('sem o clique, nada sai; com o clique, chega com From da conta, Message-ID e, na resposta, In-Reply-To e References', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId, imap } = await setup(smtp.port)
    const request = { accountId, to: ['bruno@cliente.com'], subject: 'Re: Proposta', text: 'Pode ser na quinta.', inReplyTo: '<orig@cliente.com>' }

    expect(await service.send(SENDER, { ...request, clickToken: CLICK[0] })).toEqual({ ok: false, error: 'click' })
    service.registerClick(SENDER, CLICK[0])
    // Token de outra janela não vale (e fica gasto).
    expect(await service.send(SENDER + 1, { ...request, clickToken: CLICK[0] })).toEqual({ ok: false, error: 'click' })
    expect(smtp.deliveries).toEqual([])

    service.registerClick(SENDER, CLICK[1])
    const result = await service.send(SENDER, { ...request, clickToken: CLICK[1] })
    if (!result.ok) throw new Error(`envio falhou: ${result.error}`)
    expect(result.messageId).toMatch(/^<[0-9a-f-]{36}@exemplo\.com\.br>$/)
    expect(smtp.deliveries).toHaveLength(1)
    const delivery = smtp.deliveries[0] as Delivery
    expect(delivery).toMatchObject({ from: 'ana@exemplo.com.br', to: ['bruno@cliente.com'], user: 'ana@exemplo.com.br' })
    const parsed = await simpleParser(delivery.data)
    expect(parsed.from?.value).toEqual([{ name: 'Ana Souza', address: 'ana@exemplo.com.br' }])
    expect(parsed.messageId).toBe(result.messageId)
    expect(parsed.inReplyTo).toBe('<orig@cliente.com>')
    expect(parsed.references).toEqual(['<raiz@cliente.com>', '<orig@cliente.com>'])
    expect(parsed.subject).toBe('Re: Proposta')
    expect(parsed.text?.trim()).toBe('Pode ser na quinta.')

    // IMAP: os mesmos bytes no APPEND da pasta de enviados.
    expect(imap.appended).toHaveLength(1)
    expect(imap.appended[0]?.toString('latin1')).toContain(`Message-ID: ${result.messageId}`)
    // E no app: enviados guardados e a original marcada como respondida.
    const sent = await service.messages({ accountId, folder: 'sent' })
    expect(sent).toMatchObject([{ id: result.messageId, folder: 'sent', subject: 'Re: Proposta', inReplyTo: '<orig@cliente.com>' }])
    expect(await service.body({ accountId, id: result.messageId })).toEqual({ ok: true, body: { text: 'Pode ser na quinta.', html: null, attachments: [] } })
    expect((await service.messages({ accountId }))[0]?.answered).toBe(true)
  })

  it('contrato 43: Cc e anexos locais chegam ao servidor; o enviado guarda o nome e o tamanho de cada anexo', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId } = await setup(smtp.port)
    service.registerClick(SENDER, CLICK[3])
    const bytes = new TextEncoder().encode('conteúdo da planilha')
    const result = await service.send(SENDER, { accountId, to: ['bruno@cliente.com'], cc: ['carol@cliente.com'], subject: 'Planilha', text: 'Segue.', attachments: [{ name: 'notas.csv', bytes }], clickToken: CLICK[3] })
    if (!result.ok) throw new Error(`envio falhou: ${result.error}`)
    expect(smtp.deliveries[0]?.to).toEqual(['bruno@cliente.com', 'carol@cliente.com'])
    const parsed = await simpleParser(smtp.deliveries[0]?.data ?? '')
    expect(parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc.value.map((item) => item.address) : []).toEqual(['carol@cliente.com'])
    expect(parsed.attachments.map((item) => [item.filename, item.contentType, item.content.toString('utf8')])).toEqual([['notas.csv', 'text/csv', 'conteúdo da planilha']])
    expect(await service.messages({ accountId, folder: 'sent' })).toMatchObject([{ cc: [{ name: null, address: 'carol@cliente.com' }] }])
    expect(await service.body({ accountId, id: result.messageId })).toMatchObject({ ok: true, body: { attachments: [{ filename: 'notas.csv', size: bytes.byteLength }] } })
  })

  it('contrato 43 (CA8): o anexo recebido vem do servidor sob demanda, com o nome limpo; índice fora da lista não acha', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId } = await setup(smtp.port)
    const first = await service.attachment({ accountId, id: '10', index: 0 })
    expect(first.ok && [first.name, Buffer.from(first.bytes).toString('utf8')]).toEqual(['planilha.csv', 'a;b\n1;2\n'])
    const second = await service.attachment({ accountId, id: '10', index: 1 })
    expect(second.ok && second.name).toBe('_.._segredo.txt')
    expect(await service.attachment({ accountId, id: '10', index: 2 })).toEqual({ ok: false, error: 'not-found' })
    expect(await service.attachment({ accountId, id: '10', index: -1 })).toEqual({ ok: false, error: 'not-found' })
    expect(await service.attachment({ accountId, id: '99', index: 0 })).toEqual({ ok: false, error: 'not-found' })
    expect(safeAttachmentName(null, 3)).toBe('anexo-4')
    expect(safeAttachmentName('  .oculto:a.txt', 0)).toBe('oculto_a.txt')
  })

  it('contrato 43 (CA9): Encaminhar leva os anexos da original até o SMTP; do enviado, o anexo sai da mensagem guardada', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId } = await setup(smtp.port)
    const found = await service.attachments({ accountId, id: '10' })
    if (!found.ok) throw new Error('anexos não vieram')
    expect(found.skipped).toEqual([])
    service.registerClick(SENDER, CLICK[2])
    const result = await service.send(SENDER, { accountId, to: ['carol@cliente.com'], subject: 'Enc: Proposta', text: 'Segue.', attachments: found.attachments, clickToken: CLICK[2] })
    if (!result.ok) throw new Error(`envio falhou: ${result.error}`)
    const parsed = await simpleParser(smtp.deliveries[0]?.data ?? '')
    expect(parsed.attachments.map((item) => [item.filename, item.content.toString('utf8')])).toEqual([
      ['planilha.csv', 'a;b\n1;2\n'],
      ['_.._segredo.txt', 'segredo'],
    ])
    const again = await service.attachment({ accountId, id: result.messageId, index: 0 })
    expect(again.ok && Buffer.from(again.bytes).toString('utf8')).toBe('a;b\n1;2\n')
  })

  it('contrato 43 (CA9): acima de 10 anexos ou de 20 MB, os excedentes ficam de fora pelo nome', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const many = [
      ...Array.from({ length: 11 }, (_, index) => ({ filename: `f${index}.txt`, contentType: 'text/plain', content: Buffer.alloc(10) })),
    ]
    const { service, accountId } = await setup(smtp.port, 'imap', { parseAttachments: async () => many })
    const found = await service.attachments({ accountId, id: '10' })
    expect(found.ok && [found.attachments.length, found.skipped]).toEqual([10, ['f10.txt']])
    const big = [
      { filename: 'a.bin', contentType: 'application/octet-stream', content: Buffer.alloc(15 * 1024 * 1024) },
      { filename: 'b.bin', contentType: 'application/octet-stream', content: Buffer.alloc(8 * 1024 * 1024) },
      { filename: 'c.txt', contentType: 'text/plain', content: Buffer.alloc(10) },
    ]
    const other = await setup(smtp.port, 'imap', { parseAttachments: async () => big })
    const limited = await other.service.attachments({ accountId: other.accountId, id: '10' })
    expect(limited.ok && [limited.attachments.map((item) => item.name), limited.skipped]).toEqual([['a.bin', 'c.txt'], ['b.bin']])
  })

  it('contrato 43: anexo com caminho no nome ou acima do limite é recusado sem sair nada', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId } = await setup(smtp.port)
    service.registerClick(SENDER, CLICK[0])
    expect(await service.send(SENDER, { accountId, to: ['b@c.com'], subject: 'x', text: 'y', attachments: [{ name: '../../etc/passwd', bytes: new Uint8Array(1) }], clickToken: CLICK[0] })).toEqual({ ok: false, error: 'invalid' })
    service.registerClick(SENDER, CLICK[1])
    expect(await service.send(SENDER, { accountId, to: ['b@c.com'], subject: 'x', text: 'y', attachments: [{ name: 'grande.bin', bytes: new Uint8Array(21 * 1024 * 1024) }], clickToken: CLICK[1] })).toEqual({ ok: false, error: 'invalid' })
    expect(smtp.deliveries).toEqual([])
  })

  it('contrato 43: "Testar conexão" fala com o recebimento e faz o AUTH no SMTP sem mandar nada nem gravar a conta', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service } = await setup(smtp.port)
    const before = service.accounts().length
    const input = { address: 'novo@exemplo.com.br', password: PASSWORD, incoming: { protocol: 'imap', host: '127.0.0.1', port: 993, security: 'tls' }, outgoing: { host: '127.0.0.1', port: smtp.port, security: 'none' } }
    expect(await service.test(input)).toEqual({ ok: true })
    expect(smtp.deliveries).toEqual([])
    expect(await service.test({ ...input, password: 'errada' })).toEqual({ ok: false, stage: 'outgoing', error: 'Usuário ou senha recusados.' })
    expect(await service.test({ ...input, outgoing: { host: '127.0.0.1', port: 1, security: 'none' } })).toMatchObject({ ok: false, stage: 'outgoing' })
    expect(await service.test({ address: 'x' })).toMatchObject({ ok: false, stage: 'invalid' })
    expect(service.accounts()).toHaveLength(before)
  })

  it('mensagem nova (sem inReplyTo): sem In-Reply-To nem References; em POP3 não há APPEND', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId, imap } = await setup(smtp.port, 'pop3')
    service.registerClick(SENDER, CLICK[2])
    const result = await service.send(SENDER, { accountId, to: ['c1@x.com', 'c2@x.com'], subject: 'Oi', text: 'Tudo bem?', clickToken: CLICK[2] })
    expect(result.ok).toBe(true)
    const parsed = await simpleParser(smtp.deliveries[0]?.data ?? '')
    expect(parsed.inReplyTo).toBeUndefined()
    expect(parsed.references).toBeUndefined()
    expect(smtp.deliveries[0]?.to).toEqual(['c1@x.com', 'c2@x.com'])
    expect(imap.appended).toEqual([])
    expect(await service.messages({ accountId, folder: 'sent' })).toHaveLength(1)
  })

  it('falha do SMTP volta erro tipado, sem exceção: senha recusada, servidor fora e pedido inválido', async () => {
    const smtp = await startFakeSmtp('outra-senha')
    cleanups.push(() => smtp.close())
    const { service, accountId, logs } = await setup(smtp.port)
    service.registerClick(SENDER, CLICK[0])
    expect(await service.send(SENDER, { accountId, to: ['b@c.com'], subject: 'x', text: 'y', clickToken: CLICK[0] })).toEqual({ ok: false, error: 'auth' })
    expect(smtp.deliveries).toEqual([])

    const off = await startFakeSmtp()
    const offPort = off.port
    await off.close()
    const down = await setup(offPort)
    down.service.registerClick(SENDER, CLICK[1])
    expect(await down.service.send(SENDER, { accountId: down.accountId, to: ['b@c.com'], subject: 'x', text: 'y', clickToken: CLICK[1] })).toEqual({ ok: false, error: 'connection' })

    service.registerClick(SENDER, CLICK[2])
    expect(await service.send(SENDER, { accountId, to: ['não é email'], subject: 'x', text: 'y', clickToken: CLICK[2] })).toEqual({ ok: false, error: 'invalid' })
    service.registerClick(SENDER, CLICK[3])
    expect(await service.send(SENDER, { accountId: '00000000-0000-4000-8000-000000000000', to: ['b@c.com'], subject: 'x', text: 'y', clickToken: CLICK[3] })).toEqual({ ok: false, error: 'account' })
    // Cabeçalho com quebra de linha não vira cabeçalho novo.
    service.registerClick(SENDER, CLICK[1])
    expect(await service.send(SENDER, { accountId, to: ['b@c.com'], subject: 'x\r\nBcc: espiao@x.com', text: 'y', clickToken: CLICK[1] })).toEqual({ ok: false, error: 'invalid' })
    expect([...logs, ...down.logs].join('\n')).not.toContain(PASSWORD)
  })

  it('erros do nodemailer no tipo curto', () => {
    expect(smtpErrorKind({ code: 'EAUTH' })).toBe('auth')
    expect(smtpErrorKind({ code: 'ECONNECTION' })).toBe('connection')
    expect(smtpErrorKind({ code: 'ETIMEDOUT' })).toBe('connection')
    expect(smtpErrorKind({ code: 'EENVELOPE' })).toBe('rejected')
    expect(smtpErrorKind({ responseCode: 554 })).toBe('rejected')
    expect(smtpErrorKind(new Error('x'))).toBe('failed')
  })
})

describe('envio de uma tarefa com permissão (contrato 51)', () => {
  it('o caminho interno sai sem token de clique, com o Cco só no envelope, e fica em Enviados; pedido fora do formato não sai', async () => {
    const smtp = await startFakeSmtp()
    cleanups.push(() => smtp.close())
    const { service, accountId, imap, logs } = await setup(smtp.port)
    // Campo a mais (um token, um anexo) ou sem destinatário: recusado antes do SMTP.
    expect(await service.sendForTask({ accountId, to: ['bruno@cliente.com'], subject: 'x', text: 'y', clickToken: CLICK[0] })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendForTask({ accountId, to: [], subject: 'x', text: 'y' })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendForTask({ accountId: '00000000-0000-4000-8000-000000000000', to: ['bruno@cliente.com'], subject: 'x', text: 'y' })).toEqual({ ok: false, error: 'account' })
    expect(smtp.deliveries).toEqual([])

    const result = await service.sendForTask({ accountId, to: ['bruno@cliente.com'], cc: ['carol@cliente.com'], bcc: ['diretoria@cliente.com'], subject: 'Resumo da semana', text: 'Segue o resumo.' })
    if (!result.ok) throw new Error(`envio falhou: ${result.error}`)
    expect(smtp.deliveries).toHaveLength(1)
    const delivery = smtp.deliveries[0] as Delivery
    expect(delivery.to.sort()).toEqual(['bruno@cliente.com', 'carol@cliente.com', 'diretoria@cliente.com'])
    const parsed = await simpleParser(delivery.data)
    expect(parsed.messageId).toBe(result.messageId)
    expect(parsed.subject).toBe('Resumo da semana')
    expect(delivery.data).not.toMatch(/^Bcc:/im)
    expect(delivery.data).not.toContain('diretoria@cliente.com')
    expect(imap.appended).toHaveLength(1)
    expect((await service.messages({ accountId, folder: 'sent' }))[0]).toMatchObject({ id: result.messageId, subject: 'Resumo da semana' })
    expect(logs.some((line) => line.includes('enviada por uma tarefa com permissão'))).toBe(true)
  })
})

describe('nenhum caminho fora do clique alcança o envio do email', () => {
  it('o canal só é chamado pelo preload, com a ativação do usuário e o token de clique, e registrado só no main', () => {
    const SRC = resolve(import.meta.dirname, '../src')
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []))
    const all = files(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }))
    expect(all.filter(({ text }) => text.includes("'scribe:email-send'")).map(({ file }) => file).sort()).toEqual(['main/index.ts', 'preload/index.ts', 'shared/ipc.ts'])
    expect(all.flatMap(({ file, text }) => (text.match(/\bemail\.send\([^\n]*/g) ?? []).map((call) => `${file}: ${call}`))).toEqual([
      "main/index.ts: email.send(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))",
    ])
    const preload = all.find(({ file }) => file === 'preload/index.ts')?.text ?? ''
    const emailSend = preload.slice(preload.indexOf('emailSend('), preload.indexOf("'scribe:email-send'"))
    expect(emailSend).toContain('navigator.userActivation.isActive')
    expect(emailSend).toContain("ipcRenderer.send('scribe:email-click', clickToken)")
  })
})
