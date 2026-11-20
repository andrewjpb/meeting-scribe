// Contrato 61 (convites-agenda): o convite no corpo do email e o REPLY com um clique. O `parseEmail` de verdade lê o
// convite das partes (CA3), todo parse leva a conta e o fuso (CA4), o corpo guardado antes do 61 é relido uma vez
// (CA5), o REPLY sai pelo `deliver` sem virar enviado (CA7), com o token de clique, a trava por convite e cada erro sem
// envio (CA8 a CA11), o aviso para o contrato 62 (CA12) e, por leitura do código, que nada além do clique chama a
// resposta (CA15, N1). IMAP e POP3 falsos do teste e o SMTP do `fake-email`; nenhuma rede.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { simpleParser } from 'mailparser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmailStore, type EmailStore } from '../src/main/email/email-store'
import { createFakeEmail, type FakeEmail } from '../src/main/email/fake-email'
import type { ImapConnect, ImapMessage, ImapReaderConnect, ImapSession } from '../src/main/email/imap-client'
import type { Pop3Connect } from '../src/main/email/pop3-client'
import { createEmailService, parseEmail, serverMessageId, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import { SmtpError, type SmtpSend } from '../src/main/email/smtp-client'
import { createFileSettingsStore } from '../src/main/settings/store'
import type { SafeStorageLike } from '../src/main/secrets'
import type { EmailAccountStatus, EmailBody, InviteRepliedEvent, InviteReplySendResult } from '../src/shared/email'
import { INVOKE_CHANNELS } from '../src/shared/ipc'
import { parseInvite, type EmailInvite, type InviteReplyPartstat } from '../src/shared/invite'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'invites')
const SELF = 'andrew.teste@example.org'
const SP = 'America/Sao_Paulo'
const CONTEXT = { self: [SELF], localTimeZone: SP }
const GOOGLE_UID = '7kq2m9v0c3exampleuid@google.com'
const GOOGLE_MESSAGE_ID = '<0000000000004f2a9b0645exampleid@example.com>'
const PASSWORD = 'convite-senha-61'
const SENDER = 7
const NOW = Date.parse('2026-11-19T18:30:00.000Z')

const GOOGLE_EML = readFileSync(join(FIXTURES, 'google-request.eml'))
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

/** `safeStorage` falso: cifra de verdade (inverte e embaralha os bytes); `broken` faz o cifrado não abrir mais. */
function fakeSafeStorage(): SafeStorageLike & { broken: boolean } {
  const storage = {
    broken: false,
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
    decryptString: (sealed: Buffer) => {
      if (storage.broken) throw new Error('o cifrado não abre neste Mac')
      return Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8')
    },
  }
  return storage
}

/** Um email com o `.ics` como o Google manda: a parte `text/calendar` com `method=` e o anexo `invite.ics`. */
function inviteEml(ics: string, options: { messageId?: string; subject?: string; attachmentOnly?: boolean } = {}): Buffer {
  const method = /^METHOD:([^\r\n]+)/m.exec(ics)?.[1]?.trim() ?? 'REQUEST'
  const base64 = Buffer.from(ics, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n')
  const calendar = ['--m', `Content-Type: text/calendar; charset="UTF-8"; method=${method}`, 'Content-Transfer-Encoding: base64', '', base64]
  return Buffer.from(
    [
      'From: Ana Organizadora <ana@example.com>',
      `To: ${SELF}`,
      `Subject: ${options.subject ?? 'Convite'}`,
      `Message-ID: ${options.messageId ?? '<convite-teste@example.com>'}`,
      'Date: Wed, 18 Nov 2026 12:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="m"',
      '',
      '--m',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Você foi convidado.',
      ...(options.attachmentOnly ? [] : calendar),
      '--m',
      'Content-Type: application/ics; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      'Content-Transfer-Encoding: base64',
      '',
      base64,
      '--m--',
      '',
    ].join('\r\n'),
  )
}

const plainEml = (messageId = '<sem-convite@example.com>'): Buffer =>
  Buffer.from([`From: Bruno <bruno@example.net>`, `To: ${SELF}`, 'Subject: Sem convite', `Message-ID: ${messageId}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Só texto.', ''].join('\r\n'))

/** O VCALENDAR do `google-request.eml` (a parte `text/calendar`). */
async function googleIcs(): Promise<string> {
  const parsed = await simpleParser(GOOGLE_EML)
  return parsed.attachments[0]?.content.toString('utf8') ?? ''
}

const imapEnvelope = (uid: number, messageId: string | null): ImapMessage => ({
  uid,
  flags: [],
  date: Date.parse('2026-11-18T12:00:00Z') + uid * 60_000,
  subject: `Mensagem ${uid}`,
  from: [{ name: 'Ana Organizadora', address: 'ana@example.com' }],
  to: [{ name: null, address: SELF }],
  cc: [],
  messageId,
  inReplyTo: null,
  references: [],
})

interface FakeImap {
  connect: ImapConnect
  /** `source` pedidos (o download do corpo). */
  sources: number[]
  appended: number
  /** Desligado: o login falha (sem conexão). */
  online: boolean
  drop(): void
}

/** IMAP falso: a INBOX com as mensagens dadas (`raw` `null`: o servidor não tem mais a mensagem). */
function fakeImap(items: { uid: number; raw: Buffer | 'too-big' | null; messageId?: string | null }[]): FakeImap {
  const closeListeners: (() => void)[] = []
  const fake: FakeImap = {
    sources: [],
    appended: 0,
    online: true,
    drop() {
      for (const listener of closeListeners.splice(0)) listener()
    },
    connect: async () => {
      if (!fake.online) throw Object.assign(new Error('fora do ar'), { code: 'ECONNREFUSED' })
      const list = items.map((item) => imapEnvelope(item.uid, item.messageId === undefined ? `<m${item.uid}@example.com>` : item.messageId))
      const session: ImapSession = {
        uidValidity: '9',
        recent: async (limit) => list.slice(-limit),
        since: async (uid) => list.filter((message) => message.uid > uid),
        source: async (uid) => {
          fake.sources.push(uid)
          return items.find((item) => item.uid === uid)?.raw ?? null
        },
        setSeen: async () => undefined,
        setFlagged: async () => undefined,
        remove: async () => undefined,
        appendSent: async () => {
          fake.appended++
          return true
        },
        onNew: () => undefined,
        onClose: (listener) => void closeListeners.push(() => listener(null)),
        close: async () => undefined,
      }
      return session
    },
  }
  return fake
}

/** POP3 falso em memória, no molde do servidor de `email-pop3.test.ts`: conta as conexões. */
function fakePop3(messages: { uidl: string; raw: Buffer }[]): { connect: Pop3Connect; connections: number } {
  const fake = {
    connections: 0,
    connect: (async () => {
      fake.connections++
      return {
        uidl: async () => new Map(messages.map((message, index) => [index + 1, message.uidl])),
        sizes: async () => new Map(messages.map((message, index) => [index + 1, message.raw.length])),
        retr: async (number: number) => messages[number - 1]?.raw ?? Buffer.alloc(0),
        dele: async () => undefined,
        quit: async () => undefined,
        close: () => undefined,
      }
    }) as Pop3Connect,
  }
  return fake
}

const account = (address: string, protocol: 'imap' | 'pop3' = 'imap') => ({
  address,
  password: PASSWORD,
  name: 'Andrew Teste',
  incoming: { protocol, host: protocol === 'imap' ? 'imap.example.org' : 'pop.example.org', port: protocol === 'imap' ? 993 : 995, security: 'tls' },
  outgoing: { host: 'smtp.example.org', port: 587, security: 'starttls' },
})

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

interface Setup {
  service: EmailService
  store: EmailStore
  root: string
  fake: FakeEmail
  safeStorage: ReturnType<typeof fakeSafeStorage>
  logs: string[]
  changes: string[]
  replied: InviteRepliedEvent[]
  clock: { now: number }
  /** Registra um clique novo desta janela e devolve o token. */
  click(senderId?: number): string
  reply(accountId: string, id: string, partstat?: InviteReplyPartstat): Promise<InviteReplySendResult>
}

let tokenCount = 0
const nextToken = (): string => `${String(++tokenCount).padStart(8, '0')}-2222-4333-8444-555555555555`

function setup(overrides: Partial<EmailServiceDeps> = {}): Setup {
  const userData = mkdtempSync(join(tmpdir(), 'scribe-convite-'))
  const root = join(userData, 'email')
  const store = createEmailStore(root)
  const fake = createFakeEmail(() => NOW)
  const safeStorage = fakeSafeStorage()
  const logs: string[] = []
  const changes: string[] = []
  const replied: InviteRepliedEvent[] = []
  const clock = { now: NOW }
  const service = createEmailService({
    root,
    store,
    settings: createFileSettingsStore({ dir: userData }),
    safeStorage,
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    pop3: () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })),
    smtp: fake.smtp,
    onStatus: () => undefined,
    onMessage: () => undefined,
    onMessagesChanged: (accountId) => changes.push(accountId),
    onInviteReplied: (event) => replied.push(event),
    timeZone: () => SP,
    log: (message) => logs.push(message),
    now: () => clock.now,
    retryMs: 3_600_000,
    ...overrides,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  const click = (senderId = SENDER): string => {
    const token = nextToken()
    service.registerClick(senderId, token)
    return token
  }
  return {
    service,
    store,
    root,
    fake,
    safeStorage,
    logs,
    changes,
    replied,
    clock,
    click,
    reply: (accountId, id, partstat = 'ACCEPTED') => service.sendInviteReply(SENDER, { accountId, id, partstat, clickToken: click() }),
  }
}

const stateOf = (service: EmailService, id: string): EmailAccountStatus | undefined => service.accounts().find((status) => status.account.id === id)

async function addAccount(service: EmailService, address = SELF, protocol: 'imap' | 'pop3' = 'imap'): Promise<string> {
  const added = await service.addAccount(account(address, protocol))
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  const id = added.status.account.id
  await vi.waitFor(() => expect(stateOf(service, id)?.state).toBe('connected'))
  return id
}

/** Abre o corpo (como a tela) e devolve o convite dele. */
async function openInvite(service: EmailService, accountId: string, id: string): Promise<EmailInvite | null | undefined> {
  const result = await service.body({ accountId, id })
  if (!result.ok) throw new Error(`corpo não abriu: ${result.error}`)
  return result.body.invite
}

/** Conta IMAP com o convite do Google já aberto na INBOX (UID 1). */
async function googleOpened(overrides: Partial<EmailServiceDeps> = {}, address = SELF) {
  const imap = fakeImap([{ uid: 1, raw: GOOGLE_EML, messageId: GOOGLE_MESSAGE_ID }])
  const context = setup({ imap: imap.connect, ...overrides })
  const accountId = await addAccount(context.service, address)
  await openInvite(context.service, accountId, '1')
  return { ...context, imap, accountId }
}

/** Uma mensagem guardada numa pasta aberta (fora a INBOX), como o `openFolder` deixa no store; devolve o id dela. */
async function inFolder(store: EmailStore, accountId: string, path: string, uid: number, messageId: string | null = GOOGLE_MESSAGE_ID): Promise<string> {
  const id = serverMessageId(path, '5', uid)
  await store.updateFolder(accountId, path, () => ({ path, uidValidity: '5', at: NOW, messages: [{ ...imapEnvelope(uid, messageId), id, accountId, mailbox: path, uid, seen: false, flagged: false, answered: false }] }))
  return id
}

/** A leitura só de leitura das outras pastas (`BODY.PEEK[]`), contando os pedidos. */
function fakeReader(raw: Buffer | 'too-big' | null): { connect: ImapReaderConnect; peeks: string[] } {
  const fake = {
    peeks: [] as string[],
    connect: (async () => ({
      folders: async () => [],
      search: async () => ({ uidValidity: '5', messages: [] }),
      peek: async (path: string, uid: number) => {
        fake.peeks.push(`${path}:${uid}`)
        return raw
      },
      locate: async () => ({ uidValidity: '5', existing: [], byMessageId: {} }),
      close: async () => undefined,
    })) as unknown as ImapReaderConnect,
  }
  return fake
}

const replyInvite = (content: string): EmailInvite => {
  const result = parseInvite([{ contentType: 'text/calendar', filename: null, method: 'REPLY', content }], CONTEXT)
  if (!result.ok) throw new Error(`REPLY ilegível: ${result.error}`)
  return result.invite
}

// ---------------------------------------------------------------------------------------------------------------

describe('corpo guardado (CA1, CA2)', () => {
  it('CA1: shared/email.ts só importa o tipo de ./invite; o renderer não importa valor de shared/invite', () => {
    const SRC = resolve(import.meta.dirname, '../src')
    const email = readFileSync(join(SRC, 'shared', 'email.ts'), 'utf8')
    const lines = email.split('\n').filter((line) => /from ['"]\.\/invite['"]/.test(line))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/^import type\b/)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(entry.name))
          for (const line of readFileSync(path, 'utf8').split('\n'))
            if (/from ['"](@shared|\.\.?(\/\.\.)*\/shared)\/invite['"]/.test(line) && !/^\s*import type\b/.test(line)) offenders.push(`${relative(SRC, path)}: ${line}`)
      }
    }
    walk(join(SRC, 'renderer', 'src'))
    expect(offenders).toEqual([])
  })

  it('CA2: o convite volta como foi gravado; null volta null; sem a chave volta sem; fora do formato vira null sem perder o corpo; gravar fora do formato lança', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scribe-convite-store-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const store = createEmailStore(root)
    const accountId = '0f0e0d0c-0b0a-4908-8706-050403020100'
    const invite = (await parseEmail(GOOGLE_EML, CONTEXT)).body.invite
    if (!invite) throw new Error('sem convite no google-request.eml')
    const base: EmailBody = { text: 'Corpo', html: null, attachments: [{ filename: 'invite.ics', contentType: 'application/ics', size: 900 }] }

    // (a) objeto
    await store.setBody(accountId, 'inbox:1', { ...base, invite })
    expect((await store.body(accountId, 'inbox:1'))?.invite).toEqual(invite)
    // (b) null
    await store.setBody(accountId, 'inbox:2', { ...base, invite: null })
    expect((await store.body(accountId, 'inbox:2'))?.invite).toBeNull()
    // (c) sem a chave
    await store.setBody(accountId, 'inbox:3', base)
    const without = await store.body(accountId, 'inbox:3')
    expect(without).toEqual(base)
    expect('invite' in (without ?? {})).toBe(false)
    // (d) arquivo com o convite fora do formato: o resto do corpo fica
    const dir = join(root, `${accountId}.bodies`)
    const file = readdirSync(dir).find((name) => readFileSync(join(dir, name), 'utf8').includes(GOOGLE_UID))
    if (!file) throw new Error('arquivo do corpo não achado')
    writeFileSync(join(dir, file), `${JSON.stringify({ ...base, invite: { ...invite, uid: 42 } })}\n`)
    expect(await store.body(accountId, 'inbox:1')).toEqual({ ...base, invite: null })
    // (e) gravar fora do formato lança, como o resto do corpo
    await expect(store.setBody(accountId, 'inbox:4', { ...base, invite: { ...invite, uid: 42 } as unknown as EmailInvite })).rejects.toThrow()
    await expect(store.setBody(accountId, 'inbox:4', { ...base, invite: { ...invite, extra: true } as unknown as EmailInvite })).rejects.toThrow()
  })
})

describe('parse (CA3, CA4)', () => {
  it('CA3: o google-request.eml dá um convite só, com a parte text/calendar e o anexo listados como antes', async () => {
    const parsed = await parseEmail(GOOGLE_EML, CONTEXT)
    const invite = parsed.body.invite
    expect(invite?.uid).toBe(GOOGLE_UID)
    expect(invite?.method).toBe('REQUEST')
    expect(invite?.start).toBe('2026-11-20T15:00:00.000Z')
    expect(invite?.self?.partstat).toBe('NEEDS-ACTION')
    // N10: a parte e o anexo são o mesmo convite (nenhum aviso de outro UID).
    expect(invite?.warnings).not.toContain('other-uids-ignored')
    expect(parsed.body.attachments.map((item) => [item.contentType, item.filename])).toEqual([
      ['text/calendar', null],
      ['application/ics', 'invite.ics'],
    ])
  })

  it('CA3: sem .ics → null; malformed.ics anexo → null, com o anexo listado', async () => {
    expect((await parseEmail(plainEml(), CONTEXT)).body.invite).toBeNull()
    const broken = await parseEmail(inviteEml(fixture('malformed.ics'), { attachmentOnly: true }), CONTEXT)
    expect(broken.body.invite).toBeNull()
    expect(broken.body.attachments).toHaveLength(1)
  })

  it('CA4: toda chamada de parse no serviço leva o contexto', () => {
    const service = readFileSync(resolve(import.meta.dirname, '../src/main/email/service.ts'), 'utf8')
    expect(service.match(/await parse\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(service.match(/await parse\(\s*\w+\s*\)/g) ?? []).toEqual([])
  })

  it('CA4: IMAP — o corpo aberto traz o convite, e o arquivo do corpo em disco tem a chave invite', async () => {
    const { service, root, accountId } = await googleOpened()
    const result = await service.body({ accountId, id: '1' })
    expect(result.ok && result.body.invite?.uid).toBe(GOOGLE_UID)
    const dir = join(root, `${accountId}.bodies`)
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(1)
    const saved = JSON.parse(readFileSync(join(dir, files[0] ?? ''), 'utf8')) as EmailBody
    expect(saved.invite?.uid).toBe(GOOGLE_UID)
  })

  it('CA4: POP3 — depois do poll o corpo guardado já tem o convite, sem abrir a mensagem', async () => {
    const pop3 = fakePop3([{ uidl: 'convite-1', raw: GOOGLE_EML }])
    const { service, store } = setup({ pop3: pop3.connect })
    const accountId = await addAccount(service, SELF, 'pop3')
    const body = await store.body(accountId, 'inbox:convite-1')
    expect(body?.invite?.uid).toBe(GOOGLE_UID)
    expect(body?.invite?.self?.address).toBe(SELF)
  })

  it('CA4: conta com outro endereço → o convite continua lá, com self null', async () => {
    const { service, accountId } = await googleOpened({}, 'outra@example.net')
    const invite = await openInvite(service, accountId, '1')
    expect(invite?.uid).toBe(GOOGLE_UID)
    expect(invite?.self).toBeNull()
  })
})

describe('corpos antigos (CA5)', () => {
  const OLD: EmailBody = { text: 'Corpo antigo', html: null, attachments: [{ filename: 'invite.ics', contentType: 'application/ics', size: 900 }] }

  async function imapWithOldBody(raw: Buffer | 'too-big' | null, body: EmailBody = OLD, overrides: Partial<EmailServiceDeps> = {}) {
    const imap = fakeImap([{ uid: 1, raw, messageId: GOOGLE_MESSAGE_ID }])
    const context = setup({ imap: imap.connect, ...overrides })
    const accountId = await addAccount(context.service)
    await context.store.setBody(accountId, 'inbox:1', body)
    return { ...context, imap, accountId }
  }

  it('(a) IMAP: o primeiro body() baixa uma vez e devolve o convite; o segundo não baixa', async () => {
    const { service, imap, accountId } = await imapWithOldBody(GOOGLE_EML)
    expect((await openInvite(service, accountId, '1'))?.uid).toBe(GOOGLE_UID)
    expect(imap.sources).toEqual([1])
    expect((await openInvite(service, accountId, '1'))?.uid).toBe(GOOGLE_UID)
    expect(imap.sources).toEqual([1])
  })

  it('(b) POP3: relê o .eml guardado, sem conectar no servidor', async () => {
    const pop3 = fakePop3([{ uidl: 'convite-1', raw: GOOGLE_EML }])
    const { service, store } = setup({ pop3: pop3.connect })
    const accountId = await addAccount(service, SELF, 'pop3')
    await store.setBody(accountId, 'inbox:convite-1', OLD)
    const before = pop3.connections
    expect((await openInvite(service, accountId, 'convite-1'))?.uid).toBe(GOOGLE_UID)
    expect(pop3.connections).toBe(before)
    expect((await store.body(accountId, 'inbox:convite-1'))?.invite?.uid).toBe(GOOGLE_UID)
  })

  it('(c) IMAP desconectado: devolve o corpo como está, sem gravar; reconectado, o próximo body() baixa', async () => {
    const { service, store, imap, accountId } = await imapWithOldBody(GOOGLE_EML, OLD, { retryMs: 20 })
    imap.online = false
    imap.drop()
    await vi.waitFor(() => expect(stateOf(service, accountId)?.state).toBe('error'))
    const offline = await service.body({ accountId, id: '1' })
    expect(offline).toEqual({ ok: true, body: OLD })
    expect(imap.sources).toEqual([])
    expect('invite' in ((await store.body(accountId, 'inbox:1')) ?? {})).toBe(false)
    imap.online = true
    await vi.waitFor(() => expect(stateOf(service, accountId)?.state).toBe('connected'))
    expect((await openInvite(service, accountId, '1'))?.uid).toBe(GOOGLE_UID)
    expect(imap.sources).toEqual([1])
  })

  it('(d) o servidor não tem mais a mensagem: grava invite null e não tenta de novo', async () => {
    const { service, store, imap, accountId } = await imapWithOldBody(null)
    expect(await openInvite(service, accountId, '1')).toBeNull()
    expect((await store.body(accountId, 'inbox:1'))?.invite).toBeNull()
    expect(await openInvite(service, accountId, '1')).toBeNull()
    expect(await openInvite(service, accountId, '1')).toBeNull()
    expect(imap.sources).toEqual([1])
  })

  it('(d) grande demais no servidor: grava invite null e não tenta de novo', async () => {
    const { service, store, imap, accountId } = await imapWithOldBody('too-big')
    expect(await openInvite(service, accountId, '1')).toBeNull()
    expect((await store.body(accountId, 'inbox:1'))?.invite).toBeNull()
    expect(await openInvite(service, accountId, '1')).toBeNull()
    expect(imap.sources).toEqual([1])
  })

  it('(a) pasta IMAP que não é a INBOX: relê uma vez pelo BODY.PEEK[] da pasta, sem tocar na INBOX', async () => {
    const reader = fakeReader(GOOGLE_EML)
    const { service, store, imap, accountId } = await imapWithOldBody(GOOGLE_EML, OLD, { imapReader: reader.connect })
    const id = await inFolder(store, accountId, 'Projetos', 7)
    await store.setBody(accountId, `box:${id}`, OLD)
    expect((await openInvite(service, accountId, id))?.uid).toBe(GOOGLE_UID)
    expect((await openInvite(service, accountId, id))?.uid).toBe(GOOGLE_UID)
    expect(reader.peeks).toEqual(['Projetos:7'])
    expect(imap.sources).toEqual([])
    expect((await store.body(accountId, `box:${id}`))?.invite?.uid).toBe(GOOGLE_UID)

    // Grande demais na pasta: invite null gravado, sem nova tentativa.
    const big = fakeReader('too-big')
    const other = await imapWithOldBody(GOOGLE_EML, OLD, { imapReader: big.connect })
    const bigId = await inFolder(other.store, other.accountId, 'Projetos', 8)
    await other.store.setBody(other.accountId, `box:${bigId}`, OLD)
    expect(await openInvite(other.service, other.accountId, bigId)).toBeNull()
    expect(await openInvite(other.service, other.accountId, bigId)).toBeNull()
    expect(big.peeks).toEqual(['Projetos:8'])
  })

  it('(e) corpo antigo sem anexo candidato: nada é relido nem baixado', async () => {
    const plain: EmailBody = { text: 'Corpo antigo', html: null, attachments: [{ filename: 'nota.pdf', contentType: 'application/pdf', size: 10 }] }
    const { service, imap, accountId } = await imapWithOldBody(GOOGLE_EML, plain)
    expect(await service.body({ accountId, id: '1' })).toEqual({ ok: true, body: plain })
    expect(await service.body({ accountId, id: '1' })).toEqual({ ok: true, body: plain })
    expect(imap.sources).toEqual([])
  })

  it('(f) dois body() ao mesmo tempo: um download só; o cachedBody do Assistente não relê', async () => {
    const { service, imap, accountId } = await imapWithOldBody(GOOGLE_EML)
    const message = (await service.messages({ accountId }))[0]
    if (!message) throw new Error('sem mensagem')
    expect(await service.cachedBody(accountId, message)).toEqual(OLD)
    expect(imap.sources).toEqual([])
    const [first, second] = await Promise.all([service.body({ accountId, id: '1' }), service.body({ accountId, id: '1' })])
    expect(first.ok && first.body.invite?.uid).toBe(GOOGLE_UID)
    expect(second).toEqual(first)
    expect(imap.sources).toEqual([1])
  })
})

describe('record false (CA7)', () => {
  it('o REPLY não vira enviado: nem a lista, nem o disco, nem o answered, nem o APPEND, nem o aviso de mudança; o envio comum continua gravando', async () => {
    const { service, store, root, imap, accountId, changes, reply, click, fake } = await googleOpened()
    const dir = join(root, `${accountId}.bodies`)
    const filesBefore = readdirSync(dir).sort()
    const sentBefore = (await store.read(accountId)).sent.length
    const changesBefore = changes.length

    const result = await reply(accountId, '1')
    expect(result.ok).toBe(true)
    expect(fake.sent).toHaveLength(1)
    expect((await store.read(accountId)).sent).toHaveLength(sentBefore)
    expect(readdirSync(dir).sort()).toEqual(filesBefore)
    expect((await store.read(accountId)).inbox.find((message) => message.id === '1')?.answered).toBe(false)
    expect(imap.appended).toBe(0)
    expect(changes).toHaveLength(changesBefore)

    // Regressão: o "Enviar" de sempre grava em Enviados (com invite null no corpo) e faz o APPEND.
    const sent = await service.send(SENDER, { accountId, to: ['ana@example.com'], subject: 'Re: Convite', text: 'Combinado.', inReplyTo: GOOGLE_MESSAGE_ID, clickToken: click() })
    if (!sent.ok) throw new Error(`envio falhou: ${sent.error}`)
    const data = await store.read(accountId)
    expect(data.sent).toHaveLength(sentBefore + 1)
    expect(data.inbox.find((message) => message.id === '1')?.answered).toBe(true)
    expect(imap.appended).toBe(1)
    expect(fake.sent[1]?.icalEvent).toBeNull()
    expect((await store.body(accountId, `sent:${sent.messageId}`))?.invite).toBeNull()
  })
})

describe('sendInviteReply (CA8)', () => {
  it.each([
    ['ACCEPTED', 'Aceito: Revisão do projeto'],
    ['TENTATIVE', 'Talvez: Revisão do projeto'],
    ['DECLINED', 'Recusado: Revisão do projeto'],
  ] as const)('%s: um REPLY ao organizador, com o assunto, o In-Reply-To e o ATTENDEE da conta', async (partstat, subject) => {
    const { accountId, reply, fake, logs } = await googleOpened()
    const result = await reply(accountId, '1', partstat)
    expect(result.ok).toBe(true)
    expect(fake.sent).toHaveLength(1)
    const sent = fake.sent[0]
    expect(sent).toMatchObject({ to: ['ana@example.com'], cc: [], subject, text: `${subject}\n`, inReplyTo: GOOGLE_MESSAGE_ID, attachments: [] })
    expect(sent?.icalEvent?.method).toBe('REPLY')
    expect(sent?.icalEvent?.filename).toBe('invite.ics')
    const answer = replyInvite(sent?.icalEvent?.content ?? '')
    expect(answer.method).toBe('REPLY')
    expect(answer.uid).toBe(GOOGLE_UID)
    expect(answer.sequence).toBe(0)
    expect(answer.attendees).toEqual([{ address: SELF, name: SELF, partstat }])
    // Sem conteúdo no log: nem título, nem organizador, nem endereço.
    const text = logs.join('\n')
    expect(text).toContain('resposta de convite enviada com o clique da pessoa')
    expect(text).not.toMatch(/Revisão|ana@example\.com|andrew\.teste|BEGIN:VCALENDAR/)
  })
})

describe('trava (CA9)', () => {
  /** O SMTP falso segura cada envio até `release`. */
  function hold(fake: FakeEmail) {
    const state: { held: number; release: () => void } = { held: 0, release: () => undefined }
    const gate = new Promise<void>((done) => (state.release = done))
    fake.smtpHold = () => {
      state.held++
      return gate
    }
    return state
  }

  it('(a) duplo clique: um ok, o outro busy, um envio só', async () => {
    const { accountId, fake, reply } = await googleOpened()
    const held = hold(fake)
    const first = reply(accountId, '1')
    const second = reply(accountId, '1')
    const results = [first, second]
    await vi.waitFor(() => expect(held.held).toBe(1))
    held.release()
    const settled = await Promise.all(results)
    expect(settled.map((result) => (result.ok ? 'ok' : result.error)).sort()).toEqual(['busy', 'ok'])
    expect(fake.sent).toHaveLength(1)
  })

  it('(b) o mesmo token duas vezes: a segunda é click', async () => {
    const { service, accountId, click, fake } = await googleOpened()
    const token = click()
    expect((await service.sendInviteReply(SENDER, { accountId, id: '1', partstat: 'ACCEPTED', clickToken: token })).ok).toBe(true)
    expect(await service.sendInviteReply(SENDER, { accountId, id: '1', partstat: 'ACCEPTED', clickToken: token })).toEqual({ ok: false, error: 'click' })
    expect(fake.sent).toHaveLength(1)
  })

  it('(c) depois do primeiro, um clique novo com DECLINED manda o segundo REPLY', async () => {
    const { accountId, fake, reply } = await googleOpened()
    expect((await reply(accountId, '1', 'ACCEPTED')).ok).toBe(true)
    expect((await reply(accountId, '1', 'DECLINED')).ok).toBe(true)
    expect(fake.sent).toHaveLength(2)
    expect(fake.sent[1]?.icalEvent?.content).toContain('PARTSTAT=DECLINED')
  })

  it('(d) SMTP fora do ar: connection, sem aviso, e a trava sai', async () => {
    let down = true
    const fallback = createFakeEmail(() => NOW)
    const smtp: SmtpSend = (config, mail) => (down ? Promise.reject(new SmtpError('connection')) : fallback.smtp(config, mail))
    const { accountId, reply, replied } = await googleOpened({ smtp })
    expect(await reply(accountId, '1')).toEqual({ ok: false, error: 'connection' })
    expect(replied).toEqual([])
    down = false
    expect((await reply(accountId, '1')).ok).toBe(true)
    expect(fallback.sent).toHaveLength(1)
  })

  it('(e) duas mensagens com o mesmo UID ao mesmo tempo: uma busy; a ocorrência e a série do mesmo UID: as duas ok', async () => {
    const imap = fakeImap([
      { uid: 1, raw: GOOGLE_EML, messageId: GOOGLE_MESSAGE_ID },
      { uid: 2, raw: GOOGLE_EML, messageId: '<copia@example.com>' },
      { uid: 3, raw: inviteEml(fixture('weekly-exdate.ics'), { messageId: '<serie@example.com>' }) },
      { uid: 4, raw: inviteEml(fixture('occurrence-request.ics'), { messageId: '<ocorrencia@example.com>' }) },
    ])
    const { service, fake, reply } = setup({ imap: imap.connect })
    const accountId = await addAccount(service)
    for (const id of ['1', '2', '3', '4']) expect(await openInvite(service, accountId, id)).not.toBeNull()

    let held = hold(fake)
    const same = [reply(accountId, '1'), reply(accountId, '2')]
    await vi.waitFor(() => expect(held.held).toBe(1))
    held.release()
    expect((await Promise.all(same)).map((result) => (result.ok ? 'ok' : result.error)).sort()).toEqual(['busy', 'ok'])
    expect(fake.sent).toHaveLength(1)

    held = hold(fake)
    const series = [reply(accountId, '3'), reply(accountId, '4')]
    await vi.waitFor(() => expect(held.held).toBe(2))
    held.release()
    const settled = await Promise.all(series)
    expect(settled.map((result) => result.ok)).toEqual([true, true])
    expect(settled.map((result) => (result.ok ? result.reply.recurrenceId : 'erro'))).toEqual([null, expect.any(String)])
    expect(fake.sent).toHaveLength(3)
  })
})

describe('erros, cada um sem envio (CA10)', () => {
  /** Nenhum envio, nenhum aviso, e a trava não ficou: um clique certo em seguida sai. */
  async function nothingSent(context: Awaited<ReturnType<typeof googleOpened>>): Promise<void> {
    expect(context.fake.sent).toHaveLength(0)
    expect(context.replied).toEqual([])
    expect((await context.reply(context.accountId, '1')).ok).toBe(true)
    expect(context.fake.sent).toHaveLength(1)
  }

  it('token de clique vencido (10.001 ms depois, pelo relógio do serviço)', async () => {
    const context = await googleOpened()
    const token = context.click()
    context.clock.now += 10_001
    expect(await context.service.sendInviteReply(SENDER, { accountId: context.accountId, id: '1', partstat: 'ACCEPTED', clickToken: token })).toEqual({ ok: false, error: 'click' })
    await nothingSent(context)
  })

  it('token nunca registrado, ou registrado por outra janela', async () => {
    const context = await googleOpened()
    expect(await context.service.sendInviteReply(SENDER, { accountId: context.accountId, id: '1', partstat: 'ACCEPTED', clickToken: nextToken() })).toEqual({ ok: false, error: 'click' })
    const other = context.click(SENDER + 1)
    expect(await context.service.sendInviteReply(SENDER, { accountId: context.accountId, id: '1', partstat: 'ACCEPTED', clickToken: other })).toEqual({ ok: false, error: 'click' })
    await nothingSent(context)
  })

  it('NEEDS-ACTION, campo a mais ou id vazio: invalid, e o token foi gasto', async () => {
    const context = await googleOpened()
    const { service, accountId } = context
    const token = context.click()
    expect(await service.sendInviteReply(SENDER, { accountId, id: '1', partstat: 'NEEDS-ACTION', clickToken: token })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendInviteReply(SENDER, { accountId, id: '1', partstat: 'ACCEPTED', clickToken: token })).toEqual({ ok: false, error: 'click' })
    expect(await service.sendInviteReply(SENDER, { accountId, id: '1', partstat: 'ACCEPTED', extra: true, clickToken: context.click() })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendInviteReply(SENDER, { accountId, id: '', partstat: 'ACCEPTED', clickToken: context.click() })).toEqual({ ok: false, error: 'invalid' })
    await nothingSent(context)
  })

  it('conta inexistente', async () => {
    const context = await googleOpened()
    expect(await context.reply('00000000-0000-4000-8000-000000000000', '1')).toEqual({ ok: false, error: 'account' })
    await nothingSent(context)
  })

  it('mensagem que não existe, ou que é dos enviados', async () => {
    const context = await googleOpened()
    expect(await context.reply(context.accountId, '99')).toEqual({ ok: false, error: 'not-found' })
    const sent = await context.service.send(SENDER, { accountId: context.accountId, to: ['ana@example.com'], subject: 'x', text: 'y', clickToken: context.click() })
    if (!sent.ok) throw new Error('envio falhou')
    context.fake.sent.length = 0
    expect(await context.reply(context.accountId, sent.messageId)).toEqual({ ok: false, error: 'not-found' })
    await nothingSent(context)
  })

  it('mensagem da pasta Enviados do servidor (mailbox === sentMailbox, com UID): not-found; a mesma numa outra pasta responde', async () => {
    const context = await googleOpened()
    const { store, accountId, service } = context
    const sentMailbox = service.accounts().find((status) => status.account.id === accountId)?.sentMailbox ?? ''
    expect(sentMailbox).toBe('Sent')
    const invite = await openInvite(service, accountId, '1')
    const base: EmailBody = { text: 'x', html: null, attachments: [], invite: invite ?? null }
    const sentId = await inFolder(store, accountId, sentMailbox, 3, '<enviado@example.org>')
    await store.setBody(accountId, `box:${sentId}`, base)
    expect(await context.reply(accountId, sentId)).toEqual({ ok: false, error: 'not-found' })
    expect(context.fake.sent).toHaveLength(0)
    // Controle: o mesmo corpo numa pasta comum responde (o que barrou foi ser dos Enviados).
    const otherId = await inFolder(store, accountId, 'Projetos', 4)
    await store.setBody(accountId, `box:${otherId}`, base)
    const result = await context.reply(accountId, otherId)
    expect(result.ok && result.reply.mailbox).toBe('Projetos')
    expect(context.fake.sent).toHaveLength(1)
  })

  it('mensagem cujo corpo nunca foi aberto: not-found, sem download', async () => {
    const imap = fakeImap([{ uid: 1, raw: GOOGLE_EML, messageId: GOOGLE_MESSAGE_ID }])
    const { service, fake, reply } = setup({ imap: imap.connect })
    const accountId = await addAccount(service)
    expect(await reply(accountId, '1')).toEqual({ ok: false, error: 'not-found' })
    expect(imap.sources).toEqual([])
    expect(fake.sent).toHaveLength(0)
  })

  async function opened(raw: Buffer) {
    const imap = fakeImap([{ uid: 1, raw: GOOGLE_EML, messageId: GOOGLE_MESSAGE_ID }, { uid: 2, raw }])
    const context = setup({ imap: imap.connect })
    const accountId = await addAccount(context.service)
    await openInvite(context.service, accountId, '1')
    await openInvite(context.service, accountId, '2')
    return { ...context, imap, accountId }
  }

  it.each([
    ['corpo com invite null', () => plainEml(), 'no-invite'],
    ['convite CANCEL', () => inviteEml(fixture('google-cancel.ics')), 'not-request'],
    ['convite REPLY recebido', () => inviteEml(fixture('reply-received.ics')), 'not-request'],
  ] as const)('%s', async (_name, raw, error) => {
    const context = await opened(raw())
    expect(await context.reply(context.accountId, '2')).toEqual({ ok: false, error })
    await nothingSent(context)
  })

  it('ORGANIZER ausente (tirado da parte text/calendar e do anexo)', async () => {
    const ics = (await googleIcs()).replace(/^ORGANIZER[^\r\n]*\r\n(?:[ \t][^\r\n]*\r\n)*/m, '')
    expect(ics).not.toContain('ORGANIZER')
    const context = await opened(inviteEml(ics))
    expect(await context.reply(context.accountId, '2')).toEqual({ ok: false, error: 'no-organizer' })
    await nothingSent(context)
  })

  it('ORGANIZER com endereço que não passa no emailAddressSchema', async () => {
    const ics = (await googleIcs()).replace(/^ORGANIZER[^\r\n]*\r\n/m, 'ORGANIZER:mailto:ana\r\n')
    const context = await opened(inviteEml(ics))
    expect(await context.reply(context.accountId, '2')).toEqual({ ok: false, error: 'no-organizer' })
    await nothingSent(context)
  })

  it('N5: endereço da conta fora dos ATTENDEE', async () => {
    const context = await googleOpened({}, 'outra@example.net')
    expect(await context.reply(context.accountId, '1')).toEqual({ ok: false, error: 'not-invited' })
    expect(context.fake.sent).toHaveLength(0)
    expect(context.replied).toEqual([])
  })

  it('conta com a senha que não abre', async () => {
    const context = await googleOpened()
    context.safeStorage.broken = true
    expect(await context.reply(context.accountId, '1')).toEqual({ ok: false, error: 'account' })
    context.safeStorage.broken = false
    await nothingSent(context)
  })
})

describe('POP3 (CA11)', () => {
  it('o REPLY sai pelo SMTP da conta POP3, sem APPEND nem enviado; SMTP fora do ar → connection, sem aviso', async () => {
    const pop3 = fakePop3([{ uidl: 'convite-1', raw: GOOGLE_EML }])
    let down = false
    const fake = createFakeEmail(() => NOW)
    const smtp: SmtpSend = (config, mail) => (down ? Promise.reject(new SmtpError('connection')) : fake.smtp(config, mail))
    const { service, store, replied, reply } = setup({ pop3: pop3.connect, smtp })
    const accountId = await addAccount(service, SELF, 'pop3')

    down = true
    expect(await reply(accountId, 'convite-1')).toEqual({ ok: false, error: 'connection' })
    expect(replied).toEqual([])
    expect(fake.sent).toHaveLength(0)

    down = false
    const result = await reply(accountId, 'convite-1')
    expect(result.ok).toBe(true)
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]?.icalEvent?.method).toBe('REPLY')
    expect(fake.sent[0]?.to).toEqual(['ana@example.com'])
    expect((await store.read(accountId)).sent).toEqual([])
    expect(fake.appended).toBe(0)
    expect(replied).toHaveLength(1)
  })
})

describe('evento para o 62 (CA12)', () => {
  it('chamado uma vez, com o objeto exato, igual ao reply do retorno', async () => {
    const { accountId, reply, replied } = await googleOpened()
    const result = await reply(accountId, '1', 'TENTATIVE')
    if (!result.ok) throw new Error(`falhou: ${result.error}`)
    const expected: InviteRepliedEvent = {
      accountId,
      messageId: '1',
      mailbox: 'INBOX',
      uid: GOOGLE_UID,
      recurrenceId: null,
      sequence: 0,
      dtstamp: '2026-11-18T12:00:00.000Z',
      partstat: 'TENTATIVE',
      respondedAt: NOW,
      replyMessageId: result.messageId,
    }
    expect(replied).toEqual([expected])
    expect(result.reply).toEqual(expected)
    expect(result.messageId).toMatch(/^<[^<>]+@example\.org>$/)
  })

  it('callback que lança: ok mesmo assim, com o log', async () => {
    const { accountId, reply, logs } = await googleOpened({
      onInviteReplied: () => {
        throw new Error('o 62 falhou')
      },
    })
    expect((await reply(accountId, '1')).ok).toBe(true)
    expect(logs.some((line) => line.includes('resposta de convite: aviso falhou'))).toBe(true)
  })
})

describe('N1 estático (CA15)', () => {
  const SRC = resolve(import.meta.dirname, '../src')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []))
  const all = files(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }))
  const code = all.filter(({ file }) => /^(main|preload|renderer\/src)\//.test(file))
  const textOf = (name: string): string => all.find(({ file }) => file === name)?.text ?? ''

  it('só o registro do IPC chama sendInviteReply, e o canal só existe no ipc, no preload e no main', () => {
    expect(code.filter(({ text }) => text.includes('sendInviteReply')).map(({ file }) => file).sort()).toEqual(['main/email/service.ts', 'main/index.ts'])
    const calls = code.flatMap(({ file, text }) => (text.match(/\.sendInviteReply\([^\n]*/g) ?? []).map((call) => `${file}: ${call}`))
    expect(calls).toEqual(["main/index.ts: .sendInviteReply(event.sender.id, request).catch(() => ({ ok: false, error: 'failed' }) as const))"])
    const index = textOf('main/index.ts')
    const line = index.split('\n').find((item) => item.includes('.sendInviteReply(')) ?? ''
    expect(line.trimStart().startsWith("handle('scribe:invite-reply', appOrigin, (event, request) => email.sendInviteReply(")).toBe(true)
    expect(all.filter(({ text }) => text.includes("'scribe:invite-reply'")).map(({ file }) => file).sort()).toEqual(['main/index.ts', 'preload/index.ts', 'shared/ipc.ts'])
    // O 62 é quem liga o aviso (CA16 do 62): só para o registro de convites, nunca para outro envio.
    expect(index.match(/onInviteReplied:[^\n]*/g)).toEqual(['onInviteReplied: (event) => void invites?.recordReply(event).catch(() => undefined),'])
  })

  it('buildReply só no serviço; icalEvent só posto dentro de sendInviteReply', () => {
    const importers = code.filter(({ file, text }) => file.startsWith('main/') && /import\s*\{[^}]*\bbuildReply\b[^}]*\}\s*from/.test(text)).map(({ file }) => file)
    expect(importers).toEqual(['main/email/service.ts'])
    const service = textOf('main/email/service.ts')
    const start = service.indexOf('async sendInviteReply(')
    const end = service.indexOf('forgetSender(senderId) {')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const inside = service.slice(start, end)
    const outside = service.slice(0, start) + service.slice(end)
    // Dentro: o único `Delivery` com o REPLY.
    expect(inside.match(/icalEvent:/g) ?? []).toHaveLength(1)
    expect(inside.match(/record: false/g) ?? []).toHaveLength(1)
    // Fora, `icalEvent` e `record` só na interface e no repasse do `deliver` (em qualquer forma: chave, forma curta ou spread).
    const linesWith = (pattern: RegExp): string[] => outside.split('\n').filter((line) => pattern.test(line)).map((line) => line.trim())
    expect(linesWith(/\bicalEvent\b/)).toEqual([
      "icalEvent?: OutgoingMail['icalEvent']",
      'const { accountId, to, cc, bcc, subject, text, inReplyTo, attachments, icalEvent } = delivery',
      '...(icalEvent ? { icalEvent } : {}),',
    ])
    expect(linesWith(/\.record\b|\brecord\s*\??:/)).toEqual(['record?: false', 'if (delivery.record === false) return { ok: true, messageId }'])
    // Cada `deliver(` fora daqui: um objeto literal sem spread, sem `icalEvent` e sem `record`.
    const calls: string[] = []
    for (const match of outside.matchAll(/\bdeliver\(/g)) {
      let depth = 0
      let index = (match.index ?? 0) + 'deliver'.length
      do {
        const char = outside[index]
        if (char === '(') depth++
        else if (char === ')') depth--
        index++
      } while (depth > 0 && index < outside.length)
      calls.push(outside.slice(match.index, index))
    }
    const realCalls = calls.filter((call) => !call.startsWith('deliver(delivery: Delivery'))
    expect(realCalls).toHaveLength(2)
    for (const call of realCalls) {
      expect(call).toMatch(/^deliver\(\{/)
      expect(call).not.toMatch(/\.\.\.|icalEvent|record/)
    }
    // Nenhum `Delivery` montado à parte (variável tipada que fuja da conferência acima).
    expect(service.match(/:\s*Delivery\b/g) ?? []).toHaveLength(1)
  })

  it('regra, Assistente, tarefa agendada, chat, ACP e o agente do 56 não chegam ao convite', () => {
    const forbidden = code.filter(({ file }) => ['main/email/rules.ts', 'main/email/assistant-tools.ts', 'main/email/organize.ts', 'main/email/batches.ts'].includes(file) || /^main\/(schedules|chat|acp)\//.test(file))
    expect(forbidden.length).toBeGreaterThan(5)
    const hits = forbidden.filter(({ text }) => /sendInviteReply|icalEvent|buildReply|invite-reply|inviteReply/.test(text)).map(({ file }) => file)
    expect(hits).toEqual([])
  })

  it('os canais de envio e resposta são os de antes mais scribe:invite-reply', () => {
    expect(INVOKE_CHANNELS.filter((channel) => /send|reply/.test(channel)).sort()).toEqual(['scribe:chat-send', 'scribe:email-send', 'scribe:invite-reply', 'scribe:whatsapp-send', 'scribe:whatsapp-send-media'])
  })

  it('CA14: o preload confere a ativação antes do token e manda só os quatro campos', () => {
    const preload = textOf('preload/index.ts')
    const block = preload.slice(preload.indexOf('inviteReply(request)'), preload.indexOf('on(channel, listener)'))
    expect(block.indexOf('navigator.userActivation.isActive')).toBeGreaterThan(0)
    expect(block.indexOf('navigator.userActivation.isActive')).toBeLessThan(block.indexOf('crypto.randomUUID()'))
    expect(block).toContain("ipcRenderer.send('scribe:email-click', clickToken)")
    const payload = /ipcRenderer\.invoke\('scribe:invite-reply', \{([^}]*)\}\)/.exec(block)?.[1] ?? ''
    expect(payload.split(',').map((field) => field.trim().split(':')[0]?.trim())).toEqual(['accountId', 'id', 'partstat', 'clickToken'])
  })

  it('send e sendForTask com icalEvent ou record no pedido: invalid, nada enviado', async () => {
    const { service, accountId, fake, click } = await googleOpened()
    const base = { accountId, to: ['ana@example.com'], subject: 'x', text: 'y' }
    const ical = { method: 'REPLY', filename: 'invite.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }
    expect(await service.send(SENDER, { ...base, icalEvent: ical, clickToken: click() })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.send(SENDER, { ...base, record: false, clickToken: click() })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendForTask({ ...base, icalEvent: ical })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.sendForTask({ ...base, record: false })).toEqual({ ok: false, error: 'invalid' })
    expect(fake.sent).toHaveLength(0)
  })
})
