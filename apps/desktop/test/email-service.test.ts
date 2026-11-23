// Contrato 42: o serviço de email com o cliente IMAP falso injetado. CA1 (conta gravada com a senha só cifrada), CA3
// (INBOX, IDLE, lida, apagar, corpo sob demanda pelo `mailparser`, store por conta) e CA6 (erro por conta, as outras
// seguem, nada de senha em log). Nenhuma rede.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toImapMessage, type ImapConnect, type ImapFolderConnect, type ImapFolderEntry, type ImapMessage, type ImapSession } from '../src/main/email/imap-client'
import { createEmailClickGuard, createEmailService, EMAIL_FAILURES, failureOf, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import { createFileSettingsStore, SETTINGS_FILE } from '../src/main/settings/store'
import type { SafeStorageLike } from '../src/main/secrets'
import type { EmailAccountStatus, EmailMessage } from '../src/shared/email'

const PASSWORD = 'Senha-Secreta-42!'
const CLICK = '11111111-2222-4333-8444-555555555555'

/** `safeStorage` falso: cifra de verdade (inverte e embaralha os bytes), sem Chaveiro. */
const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

const imapMessage = (uid: number, extra: Partial<ImapMessage> = {}): ImapMessage => ({
  uid,
  flags: [],
  date: Date.parse('2026-11-01T10:00:00Z') + uid * 60_000,
  subject: `Assunto ${uid}`,
  from: [{ name: `Pessoa ${uid}`, address: `p${uid}@exemplo.com` }],
  to: [{ name: null, address: 'ana@exemplo.com.br' }],
  cc: [],
  messageId: `<m${uid}@exemplo.com>`,
  inReplyTo: null,
  references: [],
  ...extra,
})

const rawOf = (uid: number): Buffer =>
  Buffer.from(
    [
      `From: Pessoa ${uid} <p${uid}@exemplo.com>`,
      'To: ana@exemplo.com.br',
      `Subject: Assunto ${uid}`,
      `Message-ID: <m${uid}@exemplo.com>`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Olá, corpo ${uid}.`,
      '--b',
      'Content-Type: text/html; charset=utf-8',
      '',
      `<p>Olá, <b>corpo ${uid}</b>.</p>`,
      '--b--',
      '',
    ].join('\r\n'),
  )

interface FakeImap {
  connect: ImapConnect
  /** O protocolo como o servidor veria: `LOGIN`, `UID STORE`, `EXPUNGE`, `APPEND`… (sem a senha). */
  calls: string[]
  passwords: string[]
  messages: ImapMessage[]
  appended: Buffer[]
  sources: number[]
  /** Chega uma mensagem: o IDLE avisa (`EXISTS`). */
  deliver(message: ImapMessage): void
  /** A conexão cai. */
  drop(): void
  failWith: unknown
}

function fakeImap(initial: ImapMessage[] = []): FakeImap {
  const newListeners: (() => void)[] = []
  const closeListeners: ((error: unknown) => void)[] = []
  const fake: FakeImap = {
    calls: [],
    passwords: [],
    messages: [...initial],
    appended: [],
    sources: [],
    failWith: null,
    deliver(message) {
      fake.messages.push(message)
      for (const listener of newListeners) listener()
    },
    drop() {
      for (const listener of closeListeners) listener(null)
    },
    connect: async (config) => {
      fake.calls.push(`LOGIN ${config.user}`)
      fake.passwords.push(config.pass)
      if (fake.failWith) throw fake.failWith
      const session: ImapSession = {
        uidValidity: '7',
        recent: async (limit) => {
          fake.calls.push(`FETCH últimas ${limit}`)
          return fake.messages.slice(-limit)
        },
        since: async (uid) => {
          fake.calls.push(`UID FETCH ${uid + 1}:*`)
          return fake.messages.filter((message) => message.uid > uid)
        },
        source: async (uid) => {
          fake.sources.push(uid)
          return fake.messages.some((message) => message.uid === uid) ? rawOf(uid) : null
        },
        setSeen: async (uid, seen) => {
          fake.calls.push(`UID STORE ${uid} ${seen ? '+' : '-'}FLAGS (\\Seen)`)
        },
        setFlagged: async (uid, flagged) => {
          fake.calls.push(`UID STORE ${uid} ${flagged ? '+' : '-'}FLAGS (\\Flagged)`)
        },
        remove: async (uid) => {
          fake.calls.push(`UID STORE ${uid} +FLAGS (\\Deleted)`, `UID EXPUNGE ${uid}`)
          fake.messages = fake.messages.filter((message) => message.uid !== uid)
        },
        appendSent: async (raw) => {
          fake.calls.push('APPEND Sent (\\Seen)')
          fake.appended.push(raw)
          return true
        },
        onNew: (listener) => void newListeners.push(listener),
        onClose: (listener) => void closeListeners.push(listener),
        close: async () => void fake.calls.push('LOGOUT'),
      }
      return session
    },
  }
  return fake
}

const account = (address = 'ana@exemplo.com.br', extra: Record<string, unknown> = {}) => ({
  address,
  password: PASSWORD,
  name: 'Ana Souza',
  incoming: { protocol: 'imap', host: 'imap.exemplo.com.br', port: 993, security: 'tls' },
  outgoing: { host: 'smtp.exemplo.com.br', port: 587, security: 'starttls' },
  ...extra,
})

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

function setup(overrides: Partial<EmailServiceDeps> = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'scribe-email-'))
  const logs: string[] = []
  const received: EmailMessage[] = []
  const states: EmailAccountStatus[][] = []
  const settings = createFileSettingsStore({ dir: userData })
  const service = createEmailService({
    root: join(userData, 'email'),
    settings,
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    onStatus: (list) => states.push(list),
    onMessage: (message) => received.push(message),
    log: (message) => logs.push(message),
    smtp: () => Promise.reject(new Error('sem SMTP neste teste')),
    retryMs: 3_600_000,
    ...overrides,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  return { userData, settings, service, logs, received, states }
}

const stateOf = (service: EmailService, id: string): EmailAccountStatus | undefined => service.accounts().find((status) => status.account.id === id)

async function addConnected(service: EmailService, input = account()): Promise<string> {
  const added = await service.addAccount(input)
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  const id = added.status.account.id
  await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))
  return id
}

describe('contas de email (contrato 42, CA1)', () => {
  it('settings vazio: a conta entra com id, a senha só cifrada (base64) no settings.json e nunca em claro', async () => {
    const imap = fakeImap()
    const { userData, service } = setup({ imap: imap.connect })
    expect(existsSync(join(userData, SETTINGS_FILE))).toBe(false)
    const id = await addConnected(service)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)

    const text = readFileSync(join(userData, SETTINGS_FILE), 'utf8')
    const file = JSON.parse(text) as { emailAccounts: Record<string, unknown>[] }
    expect(file.emailAccounts).toHaveLength(1)
    const saved = file.emailAccounts[0] ?? {}
    expect(saved).toMatchObject({ id, address: 'ana@exemplo.com.br', name: 'Ana Souza', username: 'ana@exemplo.com.br', deleteFromServer: false })
    expect(saved['password']).toBe(Buffer.from(fakeSafeStorage().encryptString(PASSWORD)).toString('base64'))
    // Em claro, em base64 da senha ou em qualquer pedaço reconhecível: nada.
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain(Buffer.from(PASSWORD).toString('base64'))
    expect(text).not.toContain('Senha-Secreta')
    // O cliente recebe a senha decifrada; o renderer recebe a conta sem senha nenhuma.
    expect(imap.passwords).toEqual([PASSWORD])
    expect(JSON.stringify(service.accounts())).not.toContain('password')
    expect(JSON.stringify(service.accounts())).not.toContain(String(saved['password']))
    // As configurações do renderer continuam sem conta nenhuma.
    expect(text).toContain('"settings"')
    expect(JSON.stringify((JSON.parse(text) as { settings: unknown }).settings)).not.toContain('ana@exemplo.com.br')
  })

  it('reaberto: a conta gravada conecta de novo com a senha decifrada', async () => {
    const imap = fakeImap([imapMessage(1)])
    const first = setup({ imap: imap.connect })
    await addConnected(first.service)
    await first.service.dispose()
    const again = createEmailService({ root: join(first.userData, 'email'), settings: createFileSettingsStore({ dir: first.userData }), safeStorage: fakeSafeStorage(), fetch: () => Promise.reject(new Error('x')), imap: imap.connect, onStatus: () => undefined, onMessage: () => undefined })
    cleanups.push(() => again.dispose())
    await again.init()
    await vi.waitFor(() => expect(again.accounts()[0]?.state).toBe('connected'))
    expect(imap.passwords).toEqual([PASSWORD, PASSWORD])
  })

  it('pedido fora do formato, endereço repetido e cifragem indisponível: nada é gravado', async () => {
    const imap = fakeImap()
    const { userData, service } = setup({ imap: imap.connect })
    expect(await service.addAccount({ ...account(), incoming: { protocol: 'smtp', host: 'x.com', port: 1, security: 'tls' } })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.addAccount({ ...account(), address: 'sem-arroba' })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.addAccount({ ...account(), extra: true })).toEqual({ ok: false, error: 'invalid' })
    expect(existsSync(join(userData, SETTINGS_FILE))).toBe(false)
    await addConnected(service)
    expect(await service.addAccount(account('ANA@exemplo.com.br'))).toEqual({ ok: false, error: 'duplicate' })

    const locked = setup({ imap: imap.connect, safeStorage: fakeSafeStorage(false) })
    expect(await locked.service.addAccount(account())).toEqual({ ok: false, error: 'encryption' })
    expect(existsSync(join(locked.userData, SETTINGS_FILE))).toBe(false)
  })

  it('remover: sai do settings, do store e fecha a conexão; nada é apagado no servidor', async () => {
    const imap = fakeImap([imapMessage(1)])
    const { userData, service } = setup({ imap: imap.connect })
    const id = await addConnected(service)
    expect(existsSync(join(userData, 'email', `${id}.json`))).toBe(true)
    expect(await service.removeAccount({ accountId: id })).toBe(true)
    expect(service.accounts()).toEqual([])
    expect(existsSync(join(userData, 'email', `${id}.json`))).toBe(false)
    expect((JSON.parse(readFileSync(join(userData, SETTINGS_FILE), 'utf8')) as Record<string, unknown>)['emailAccounts']).toBeUndefined()
    expect(imap.calls).toContain('LOGOUT')
    expect(imap.calls.some((call) => call.includes('Deleted'))).toBe(false)
    expect(await service.removeAccount({ accountId: id })).toBe(false)
  })
})

describe('lista de contas e remoção no meio do sincronismo', () => {
  it('duas contas adicionadas ao mesmo tempo: as duas ficam gravadas', async () => {
    const imap = fakeImap()
    const { settings, service } = setup({ imap: imap.connect })
    const results = await Promise.all([service.addAccount(account('ana@um.com.br')), service.addAccount(account('bia@dois.com.br')), service.addAccount(account('ana@um.com.br'))])
    expect(results.map((result) => (result.ok ? 'ok' : result.error))).toEqual(['ok', 'ok', 'duplicate'])
    expect((await settings.getEmailAccounts()).map((item) => item.address).sort()).toEqual(['ana@um.com.br', 'bia@dois.com.br'])
    // Remover uma enquanto outra entra: nenhuma se perde.
    const first = results[0]
    if (!first?.ok) throw new Error('conta não entrou')
    await Promise.all([service.removeAccount({ accountId: first.status.account.id }), service.addAccount(account('caio@tres.com.br'))])
    expect((await settings.getEmailAccounts()).map((item) => item.address).sort()).toEqual(['bia@dois.com.br', 'caio@tres.com.br'])
  })

  it('conta removida no meio do sincronismo IMAP: nada é regravado em userData/email', async () => {
    const imap = fakeImap([imapMessage(1)])
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: ImapConnect = async (config) => {
      const session = await imap.connect(config)
      return { ...session, recent: async (limit) => (await gate, session.recent(limit)) }
    }
    const { userData, service } = setup({ imap: slow })
    const added = await service.addAccount(account())
    if (!added.ok) throw new Error('conta não entrou')
    await vi.waitFor(() => expect(imap.calls).toContain('LOGIN ana@exemplo.com.br'))
    expect(await service.removeAccount({ accountId: added.status.account.id })).toBe(true)
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(existsSync(join(userData, 'email')) ? readdirSync(join(userData, 'email')) : []).toEqual([])
  })

  it('TLS recusado pelo imapflow (`tlsFailed`) vira o erro de TLS', () => {
    expect(failureOf(Object.assign(new Error('x'), { tlsFailed: true }))).toBe('tls')
    expect(EMAIL_FAILURES[failureOf({ tlsFailed: true })]).toBe('Falha na conexão segura (TLS).')
    expect(failureOf(Object.assign(new Error('x'), { authenticationFailed: true, tlsFailed: false }))).toBe('auth')
  })
})

describe('IMAP com o cliente falso (contrato 42, CA3)', () => {
  it('lista as últimas 200 da INBOX (UID, flags, envelope) e grava no store, um arquivo por conta', async () => {
    const all = Array.from({ length: 250 }, (_, index) => imapMessage(index + 1, index % 2 === 0 ? { flags: ['\\Seen'] } : {}))
    const imap = fakeImap(all)
    const { userData, service } = setup({ imap: imap.connect })
    const id = await addConnected(service)
    expect(imap.calls).toContain('FETCH últimas 200')
    const list = await service.messages({ accountId: id })
    expect(list).toHaveLength(200)
    expect(list[0]).toMatchObject({ id: '250', uid: 250, seen: false, subject: 'Assunto 250', from: [{ name: 'Pessoa 250', address: 'p250@exemplo.com' }], messageId: '<m250@exemplo.com>' })
    expect(list.at(-1)).toMatchObject({ uid: 51, seen: true })
    expect(readdirSync(join(userData, 'email'))).toEqual([`${id}.json`])
    const stored = JSON.parse(readFileSync(join(userData, 'email', `${id}.json`), 'utf8')) as { uidValidity: string; inbox: EmailMessage[] }
    expect(stored.uidValidity).toBe('7')
    expect(stored.inbox).toHaveLength(200)
  })

  it('mensagem nova pelo IDLE: evento, store e o limite de 200', async () => {
    const imap = fakeImap(Array.from({ length: 200 }, (_, index) => imapMessage(index + 1)))
    const { service, received } = setup({ imap: imap.connect })
    const id = await addConnected(service)
    expect(received).toEqual([])
    imap.deliver(imapMessage(201, { subject: 'Chegou agora' }))
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toMatchObject({ accountId: id, id: '201', subject: 'Chegou agora', mailbox: 'INBOX' })
    expect(imap.calls).toContain('UID FETCH 201:*')
    const list = await service.messages({ accountId: id })
    expect(list).toHaveLength(200)
    expect(list[0]?.id).toBe('201')
    expect(list.some((message) => message.id === '1')).toBe(false)
  })

  it('marcar lida (STORE \\Seen) e apagar (\\Deleted + EXPUNGE) vão ao servidor e ao store', async () => {
    const imap = fakeImap([imapMessage(1), imapMessage(2)])
    const { service } = setup({ imap: imap.connect })
    const id = await addConnected(service)
    expect(await service.markRead({ accountId: id, id: '1', seen: true })).toBe(true)
    expect(imap.calls).toContain('UID STORE 1 +FLAGS (\\Seen)')
    expect((await service.messages({ accountId: id })).find((message) => message.id === '1')?.seen).toBe(true)
    expect(await service.markRead({ accountId: id, id: '1', seen: false })).toBe(true)
    expect(imap.calls).toContain('UID STORE 1 -FLAGS (\\Seen)')

    expect(await service.remove({ accountId: id, id: '2' })).toBe(true)
    expect(imap.calls.slice(-2)).toEqual(['UID STORE 2 +FLAGS (\\Deleted)', 'UID EXPUNGE 2'])
    expect((await service.messages({ accountId: id })).map((message) => message.id)).toEqual(['1'])
    expect(await service.remove({ accountId: id, id: '99' })).toBe(false)
  })

  it('corpo sob demanda: baixado uma vez, passado pelo mailparser e cacheado no disco', async () => {
    const imap = fakeImap([imapMessage(1)])
    const { userData, service } = setup({ imap: imap.connect })
    const id = await addConnected(service)
    expect(imap.sources).toEqual([])
    const first = await service.body({ accountId: id, id: '1' })
    // Contrato 61: o corpo lido diz que não há convite (`invite: null`).
    expect(first).toEqual({ ok: true, body: { text: 'Olá, corpo 1.', html: '<p>Olá, <b>corpo 1</b>.</p>', attachments: [], invite: null } })
    const again = await service.body({ accountId: id, id: '1' })
    expect(again).toEqual(first)
    expect(imap.sources).toEqual([1])
    expect(readdirSync(join(userData, 'email', `${id}.bodies`))).toHaveLength(1)
    // Pedidos iguais ao mesmo tempo viram um só download.
    imap.deliver(imapMessage(2))
    await vi.waitFor(async () => expect((await service.messages({ accountId: id })).length).toBe(2))
    await Promise.all([service.body({ accountId: id, id: '2' }), service.body({ accountId: id, id: '2' })])
    expect(imap.sources).toEqual([1, 2])
    expect(await service.body({ accountId: id, id: 'nao-existe' })).toEqual({ ok: false, error: 'not-found' })
  })
})

describe('erro por conta (contrato 42, CA6)', () => {
  it('senha errada e servidor fora: a conta vira error com mensagem curta, as outras seguem, nada de senha em log', async () => {
    const consoleCalls: string[] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void consoleCalls.push(args.map(String).join(' ')))
    const good = fakeImap([imapMessage(1)])
    const wrong = fakeImap()
    wrong.failWith = Object.assign(new Error(`Authentication failed for ${PASSWORD}`), { authenticationFailed: true })
    const down = fakeImap()
    down.failWith = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:993'), { code: 'ECONNREFUSED' })
    const byHost: Record<string, ImapConnect> = { 'imap.bom.com': good.connect, 'imap.senha.com': wrong.connect, 'imap.fora.com': down.connect }
    const { service, logs, received } = setup({ imap: (config) => (byHost[config.host] ?? good.connect)(config) })
    const ids: Record<string, string> = {}
    for (const host of Object.keys(byHost)) {
      const added = await service.addAccount(account(`ana@${host.slice(5)}`, { incoming: { protocol: 'imap', host, port: 993, security: 'tls' } }))
      if (!added.ok) throw new Error('conta não entrou')
      ids[host] = added.status.account.id
    }
    await vi.waitFor(() => {
      expect(stateOf(service, ids['imap.bom.com'] ?? '')?.state).toBe('connected')
      expect(stateOf(service, ids['imap.senha.com'] ?? '')).toMatchObject({ state: 'error', error: EMAIL_FAILURES.auth })
      expect(stateOf(service, ids['imap.fora.com'] ?? '')).toMatchObject({ state: 'error', error: EMAIL_FAILURES.connection })
    })
    // A conta boa continua recebendo.
    good.deliver(imapMessage(2))
    await vi.waitFor(() => expect(received.map((message) => message.id)).toEqual(['2']))
    const everything = [...logs, ...consoleCalls, JSON.stringify(service.accounts())].join('\n')
    expect(logs.some((line) => line.includes('falhou (auth)'))).toBe(true)
    expect(logs.some((line) => line.includes('falhou (connection)'))).toBe(true)
    expect(everything).not.toContain(PASSWORD)
    expect(everything).not.toContain('Senha-Secreta')
  })

  it('a conexão caiu: error "a conexão caiu" e nova tentativa sozinha; senha recusada não tenta de novo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    cleanups.push(() => void vi.useRealTimers())
    const imap = fakeImap([imapMessage(1)])
    const { service } = setup({ imap: imap.connect, retryMs: 60_000 })
    const added = await service.addAccount(account())
    if (!added.ok) throw new Error('conta não entrou')
    const id = added.status.account.id
    await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))
    imap.drop()
    expect(stateOf(service, id)).toMatchObject({ state: 'error', error: EMAIL_FAILURES.closed })
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))
    expect(imap.calls.filter((call) => call.startsWith('LOGIN'))).toHaveLength(2)

    imap.failWith = Object.assign(new Error('auth'), { authenticationFailed: true })
    imap.drop()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(stateOf(service, id)?.error).toBe(EMAIL_FAILURES.auth))
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(imap.calls.filter((call) => call.startsWith('LOGIN'))).toHaveLength(3)
  })
})

describe('pendentes em cache (contrato 134, D8)', () => {
  const folder = (path: string, name: string, total: number | null, noselect = false): ImapFolderEntry => ({ path, name, delimiter: '/', specialUse: null, noselect, total, unseen: 0 })

  it('soma só o LIST guardado (maiúsculas e acentos não importam); nunca abre sessão IMAP; sem pasta, null', async () => {
    const imap = fakeImap()
    let sessions = 0
    const entries: ImapFolderEntry[] = [
      folder('INBOX', 'INBOX', 12),
      folder('Pendentes', 'Pendentes', 4),
      folder('Clientes/PENDÊNTES', 'PENDÊNTES', 3),
      folder('Clientes/Pendentes antigos', 'Pendentes antigos', 50),
      folder('Arquivo/Pendentes', 'Pendentes', null),
      folder('Nó/Pendentes', 'Pendentes', null, true),
    ]
    const imapFolders: ImapFolderConnect = () => {
      sessions += 1
      return Promise.resolve({
        list: () => Promise.resolve(entries),
        recent: () => Promise.reject(new Error('não usado')),
        move: () => Promise.reject(new Error('não usado')),
        create: () => Promise.reject(new Error('não usado')),
        rename: () => Promise.reject(new Error('não usado')),
        delete: () => Promise.reject(new Error('não usado')),
        close: () => Promise.resolve(),
      })
    }
    const cached: string[] = []
    const { service } = setup({ imap: imap.connect, imapFolders, onFoldersCached: (accountId) => void cached.push(accountId) })
    expect(service.pendentesEmCache()).toBeNull()
    const id = await addConnected(service)
    // A conta conectou, mas o LIST ainda não foi pedido: nada em cache e nenhuma sessão das pastas.
    expect(service.pendentesEmCache()).toBeNull()
    expect(sessions).toBe(0)
    const listed = await service.listFolders(id)
    expect(listed.ok).toBe(true)
    expect(sessions).toBe(1)
    // O LIST novo ficou guardado: o aviso sai uma vez; o LIST lido do cache não avisa de novo.
    expect(cached).toEqual([id])
    expect(service.pendentesEmCache()).toBe(7)
    expect(service.pendentesEmCache()).toBe(7)
    await service.listFolders(id)
    expect(sessions).toBe(1)
    expect(cached).toEqual([id])
    // Sem a pasta "Pendentes" no LIST guardado: null.
    entries.splice(1, 2)
    await service.listFolders(id, { fresh: true })
    expect(cached).toEqual([id, id])
    expect(service.pendentesEmCache()).toBeNull()
  })
})

describe('não lidos em cache (contrato 145, D1)', () => {
  it('soma os não lidos da INBOX guardada das contas conectadas; desconectada ou sem nada guardado conta 0; nunca abre sessão', async () => {
    const seen = { flags: ['\\Seen'] }
    const tres = fakeImap([imapMessage(1), imapMessage(2), imapMessage(3), imapMessage(4, seen)])
    const duas = fakeImap([imapMessage(1), imapMessage(2, seen), imapMessage(3)])
    const caiu = fakeImap([imapMessage(1), imapMessage(2)])
    const vazia = fakeImap()
    const byHost: Record<string, FakeImap> = { 'imap.tres.com': tres, 'imap.duas.com': duas, 'imap.caiu.com': caiu, 'imap.vazia.com': vazia }
    let folderSessions = 0
    const imapFolders: ImapFolderConnect = () => {
      folderSessions += 1
      return Promise.reject(new Error('não usado'))
    }
    const { service } = setup({ imap: (config) => (byHost[config.host] ?? tres).connect(config), imapFolders })
    expect(await service.naoLidosEmCache()).toBe(0)
    const ids: Record<string, string> = {}
    for (const host of Object.keys(byHost)) ids[host] = await addConnected(service, account(`ana@${host.slice(5)}`, { incoming: { protocol: 'imap', host, port: 993, security: 'tls' } }))
    expect(await service.naoLidosEmCache()).toBe(7)
    // A conexão de uma conta caiu (e não volta): ela sai da soma, mesmo com a INBOX guardada.
    caiu.failWith = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    caiu.drop()
    expect(stateOf(service, ids['imap.caiu.com'] ?? '')?.state).toBe('error')
    const logins = Object.values(byHost).map((fake) => fake.calls.filter((call) => call.startsWith('LOGIN')).length)
    const calls = Object.values(byHost).map((fake) => fake.calls.length)
    expect(await service.naoLidosEmCache()).toBe(5)
    expect(await service.naoLidosEmCache()).toBe(5)
    // Nenhum login, nenhum comando IMAP e nenhuma sessão das pastas por causa da contagem.
    expect(Object.values(byHost).map((fake) => fake.calls.filter((call) => call.startsWith('LOGIN')).length)).toEqual(logins)
    expect(Object.values(byHost).map((fake) => fake.calls.length)).toEqual(calls)
    expect(folderSessions).toBe(0)
  })
})

describe('ponte do imapflow', () => {
  it('UID, flags, envelope e o cabeçalho References (dobrado em linhas) viram a mensagem do serviço', () => {
    const fetched = {
      seq: 3,
      uid: 42,
      flags: new Set(['\\Seen', '\\Answered']),
      envelope: {
        date: new Date('2026-11-18T12:00:00Z'),
        subject: 'Orçamento',
        messageId: '<x@y.com>',
        inReplyTo: '<w@y.com>',
        from: [{ name: 'Bruno', address: 'bruno@y.com' }, { name: 'sem endereço' }],
        to: [{ address: 'ana@exemplo.com.br' }],
      },
      headers: Buffer.from('References: <a@y.com>\r\n <w@y.com>\r\n\r\n'),
    }
    expect(toImapMessage(fetched)).toEqual({
      uid: 42,
      flags: ['\\Seen', '\\Answered'],
      date: Date.parse('2026-11-18T12:00:00Z'),
      subject: 'Orçamento',
      from: [{ name: 'Bruno', address: 'bruno@y.com' }],
      to: [{ name: null, address: 'ana@exemplo.com.br' }],
      cc: [],
      messageId: '<x@y.com>',
      inReplyTo: '<w@y.com>',
      references: ['<a@y.com>', '<w@y.com>'],
    })
    expect(toImapMessage({ seq: 1, uid: 1 })).toMatchObject({ uid: 1, flags: [], date: 0, subject: '', from: [], references: [] })
  })
})

describe('guarda do clique do envio', () => {
  it('vale uma vez, só para a janela que registrou e só por 10 s', () => {
    let now = 1_000
    const guard = createEmailClickGuard(() => now)
    expect(guard.consume(1, CLICK)).toBe(false)
    guard.register(1, CLICK)
    expect(guard.consume(2, CLICK)).toBe(false)
    // Gasto pela tentativa da outra janela.
    expect(guard.consume(1, CLICK)).toBe(false)
    const other = '21111111-2222-4333-8444-555555555555'
    guard.register(1, other)
    expect(guard.consume(1, other)).toBe(true)
    expect(guard.consume(1, other)).toBe(false)
    const late = '31111111-2222-4333-8444-555555555555'
    guard.register(1, late)
    now += 10_001
    expect(guard.consume(1, late)).toBe(false)
    guard.register(1, 'nao-e-token')
    expect(guard.consume(1, 'nao-e-token')).toBe(false)
  })
})
