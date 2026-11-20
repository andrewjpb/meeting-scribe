// Contrato 52: as pastas do email com o servidor IMAP falso (`fake-email.ts`). Migração do store da 0.15.0, árvore do
// `LIST` com delimitador `/` e `.`, abrir pasta, mover com e sem `MOVE` (e o mapa de UIDs do `COPYUID`), pasta
// protegida, nome inválido, apagar com e sem `force`, POP3 recusa e as contagens depois de mover. Nenhuma rede.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmailStore, migrateAccountData } from '../src/main/email/email-store'
import { createEmailTools } from '../src/main/email/assistant-tools'
import { createFakeEmail, SMOKE_EMAIL_ADDRESS, SMOKE_EMAIL_PASSWORD, SMOKE_EMAIL_WRONG_PASSWORD, type FakeEmailOptions } from '../src/main/email/fake-email'
import type { ImapConnect, ImapFolderConnect } from '../src/main/email/imap-client'
import { movedList } from '../src/main/email/imap-client'
import { createEmailService, folderTree, isProtectedFolder, validFolderName, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFileSettingsStore } from '../src/main/settings/store'
import { isSent, type EmailFolderNode, type EmailMessage } from '../src/shared/email'

const fakeSafeStorage = (): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

const ACCOUNT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const NOW = Date.parse('2026-11-19T13:00:00Z')

const imapAccount = {
  address: SMOKE_EMAIL_ADDRESS,
  password: SMOKE_EMAIL_PASSWORD,
  incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' },
  outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' },
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
})

function setup(options: FakeEmailOptions = {}, overrides: Partial<EmailServiceDeps> = {}, dir?: string) {
  const userData = dir ?? mkdtempSync(join(tmpdir(), 'scribe-pastas-'))
  const fake = createFakeEmail(() => NOW, options)
  const changed: string[] = []
  const received: EmailMessage[] = []
  const service = createEmailService({
    root: join(userData, 'email'),
    settings: createFileSettingsStore({ dir: userData }),
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    onStatus: () => undefined,
    onMessage: (message) => received.push(message),
    onMessagesChanged: (accountId) => changed.push(accountId),
    imap: fake.imap,
    imapReader: fake.imapReader,
    imapFolders: fake.imapFolders,
    pop3: fake.pop3,
    smtp: fake.smtp,
    retryMs: 3_600_000,
    now: () => NOW,
    ...overrides,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  return { userData, fake, service, changed, received }
}

async function connected(service: EmailService, input: Record<string, unknown> = imapAccount): Promise<string> {
  const added = await service.addAccount(input)
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  const id = added.status.account.id
  if ((input['incoming'] as { protocol: string }).protocol === 'imap') await vi.waitFor(() => expect(service.accounts().find((status) => status.account.id === id)?.state).toBe('connected'))
  return id
}

const flat = (nodes: readonly EmailFolderNode[]): EmailFolderNode[] => nodes.flatMap((node) => [node, ...flat(node.children)])
const find = (nodes: readonly EmailFolderNode[], path: string): EmailFolderNode | undefined => flat(nodes).find((node) => node.path === path)

describe('store por pasta: migração da 0.15.0 (CA1)', () => {
  const legacy = {
    version: 1,
    uidValidity: '1',
    polled: false,
    seenUidls: [],
    inbox: [{ id: '4', accountId: ACCOUNT_ID, folder: 'inbox', uid: 4, seen: false, flagged: false, answered: false, from: [{ name: 'Marina', address: 'marina@cliente.example' }], to: [], cc: [], subject: 'Proposta', date: NOW - 60_000, messageId: '<m4@cliente.example>', inReplyTo: null, references: [] }],
    sent: [{ id: '<s1@lap.example>', accountId: ACCOUNT_ID, folder: 'sent', uid: null, seen: true, flagged: false, answered: false, from: [{ name: null, address: SMOKE_EMAIL_ADDRESS }], to: [{ name: null, address: 'marina@cliente.example' }], cc: [], subject: 'Re: Proposta', date: NOW, messageId: '<s1@lap.example>', inReplyTo: '<m4@cliente.example>', references: [] }],
  }

  it('o arquivo da versão 1 abre sem perda: inbox → INBOX, sent → Sent', async () => {
    const migrated = migrateAccountData(legacy)
    expect(migrated).toMatchObject({ version: 1, uidValidity: '1', sentMailbox: 'Sent' })
    expect(migrated?.inbox).toMatchObject([{ id: '4', mailbox: 'INBOX', subject: 'Proposta' }])
    expect(migrated?.sent).toMatchObject([{ id: '<s1@lap.example>', mailbox: 'Sent', subject: 'Re: Proposta' }])
    expect(migrated?.inbox[0]).not.toHaveProperty('folder')

    const root = mkdtempSync(join(tmpdir(), 'scribe-migra-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    writeFileSync(join(root, `${ACCOUNT_ID}.json`), JSON.stringify(legacy))
    const store = createEmailStore(root)
    expect((await store.read(ACCOUNT_ID)).sent[0]?.mailbox).toBe('Sent')
    // Gravado de novo: continua na versão 1, com o `folder` antigo ao lado do `mailbox` (a 0.15.0 lê o mesmo arquivo).
    await store.update(ACCOUNT_ID, (data) => ({ ...data, sentMailbox: 'Enviados', sent: data.sent.map((item) => ({ ...item, mailbox: 'Enviados' })), seenUidls: ['uidl-1'] }))
    const disk = JSON.parse(readFileSync(join(root, `${ACCOUNT_ID}.json`), 'utf8'))
    expect(disk).toMatchObject({ version: 1, sentMailbox: 'Enviados', seenUidls: ['uidl-1'], inbox: [{ folder: 'inbox', mailbox: 'INBOX' }], sent: [{ folder: 'sent', mailbox: 'Enviados' }] })
    // O que a 0.15.0 grava de volta (sem os campos novos) abre de novo, com a pasta dos enviados que a conta tinha.
    const rolledBack = { ...disk, sentMailbox: undefined, inbox: disk.inbox.map(({ mailbox: _m, ...item }: Record<string, unknown>) => item), sent: disk.sent.map(({ mailbox: _m, ...item }: Record<string, unknown>) => item) }
    expect(migrateAccountData(rolledBack)?.sent[0]?.mailbox).toBe('Sent')
    expect(migrateAccountData(rolledBack)?.inbox[0]?.mailbox).toBe('INBOX')
  })

  it('arquivo quebrado continua valendo como vazio', () => {
    expect(migrateAccountData({ version: 1, inbox: 'x' })).toBeNull()
    expect(migrateAccountData(null)).toBeNull()
  })

  it('ao conectar, os enviados guardados vão para a pasta \\Sent do servidor e os corpos já baixados continuam', async () => {
    const { userData, service } = setup()
    const id = await connected(service)
    // A conta já conectou uma vez: grava a versão 1 com o id dela, um corpo já baixado de um enviado e reconecta.
    await service.dispose()
    const root = join(userData, 'email')
    mkdirSync(root, { recursive: true })
    const own = { ...legacy, sent: legacy.sent.map((item) => ({ ...item, accountId: id })), inbox: [] }
    writeFileSync(join(root, `${id}.json`), JSON.stringify(own))
    await createEmailStore(root).setBody(id, 'sent:<s1@lap.example>', { text: 'Corpo antigo', html: null, attachments: [] })
    const again = setup({}, { root, settings: createFileSettingsStore({ dir: userData }) }).service
    await again.init()
    await vi.waitFor(() => expect(again.accounts()[0]?.state).toBe('connected'))
    expect(again.accounts()[0]?.sentMailbox).toBe('Enviados')
    const sent = await again.messages({ accountId: id, folder: 'sent' })
    expect(sent).toMatchObject([{ id: '<s1@lap.example>', mailbox: 'Enviados' }])
    expect(await again.body({ accountId: id, id: '<s1@lap.example>' })).toEqual({ ok: true, body: { text: 'Corpo antigo', html: null, attachments: [] } })
    // A Caixa de Entrada continua a mesma de antes.
    expect((await again.messages({ accountId: id })).every((message) => message.mailbox === 'INBOX')).toBe(true)
  })
})

describe('árvore de pastas (CA2)', () => {
  it('delimitador "/": aninhada, com contagens, \\Noselect como nó e a INBOX primeiro', async () => {
    const { service, fake } = setup({ folders: [{ path: 'Projetos', noselect: true }, { path: 'Projetos/ABF' }, { path: 'Projetos/ABF/2026' }] })
    const id = await connected(service)
    const result = await service.listFolders(id)
    if (!result.ok) throw new Error(result.error)
    expect(result.pop3).toBe(false)
    expect(result.folders.map((node) => node.path)).toEqual(['INBOX', 'Arquivo', 'Enviados', 'Projetos'])
    expect(find(result.folders, 'INBOX')).toMatchObject({ total: 4, unseen: 2, delimiter: '/', specialUse: null, noselect: false })
    expect(find(result.folders, 'Projetos')).toMatchObject({ noselect: true, total: null, unseen: null })
    expect(find(result.folders, 'Projetos')?.children.map((node) => node.path)).toEqual(['Projetos/ABF'])
    expect(find(result.folders, 'Projetos/ABF')?.children).toMatchObject([{ path: 'Projetos/ABF/2026', name: '2026' }])
    // Guardada na memória: o segundo pedido não vai ao servidor.
    const before = fake.folderLog.length
    expect(await service.listFolders(id)).toEqual(result)
    expect(fake.folderLog.length).toBe(before)
  })

  it('delimitador ".": "INBOX.Clientes.LAP" fica dentro da INBOX', () => {
    const entry = (path: string, extra = {}) => ({ path, name: path.split('.').pop() ?? path, delimiter: '.', specialUse: null, noselect: false, total: 0, unseen: 0, ...extra })
    const tree = folderTree([entry('INBOX'), entry('INBOX.Clientes'), entry('INBOX.Clientes.LAP'), entry('Lixo', { specialUse: '\\Trash' }), entry('Órfã.Filha')])
    // O pai de "Órfã.Filha" não veio no LIST: ela fica na raiz.
    expect(tree.map((node) => node.path)).toEqual(['INBOX', 'Órfã.Filha', 'Lixo'])
    expect(find(tree, 'INBOX')?.children.map((node) => node.name)).toEqual(['Clientes'])
    expect(find(tree, 'INBOX.Clientes')?.children.map((node) => node.name)).toEqual(['LAP'])
  })

  it('com o servidor falso de delimitador ".", criar dentro de outra usa o ponto', async () => {
    const { service, fake } = setup({ delimiter: '.', folders: [{ path: 'Clientes' }] })
    const id = await connected(service)
    expect(await service.createFolder(id, 'Clientes', 'LAP')).toEqual({ ok: true, path: 'Clientes.LAP' })
    expect(await service.createFolder(id, 'Clientes', 'A.B')).toEqual({ ok: false, error: 'invalid' })
    expect(fake.folderLog).toEqual(['CREATE Clientes.LAP'])
    const result = await service.listFolders(id)
    expect(result.ok && find(result.folders, 'Clientes')?.children.map((node) => node.path)).toEqual(['Clientes.LAP'])
  })

  it('POP3: só INBOX e Sent, com pop3: true; mover, abrir outra e criar recusam com pop3', async () => {
    const { service } = setup()
    const id = await connected(service, { ...imapAccount, incoming: { protocol: 'pop3', host: 'pop.lap.example', port: 995, security: 'tls' } })
    const result = await service.listFolders(id)
    expect(result).toMatchObject({ ok: true, pop3: true, folders: [{ path: 'INBOX', total: 0 }, { path: 'Sent', specialUse: '\\Sent' }] })
    expect(await service.moveMessages(id, 'INBOX', [1], 'Arquivo')).toEqual({ ok: false, error: 'pop3' })
    expect(await service.createFolder(id, null, 'Nova')).toEqual({ ok: false, error: 'pop3' })
    expect(await service.openFolder(id, 'Arquivo')).toEqual({ ok: false, error: 'pop3' })
    expect(await service.openFolder(id, 'INBOX')).toEqual({ ok: true, messages: [] })
    expect(await service.move({ accountId: id, fromPath: 'INBOX', uids: [1], toPath: 'Arquivo' })).toEqual({ ok: false, error: 'pop3' })
  })
})

describe('abrir pasta (CA3)', () => {
  it('as mais recentes vão para o store daquela pasta; a INBOX vem do store; relida a cada 5 min enquanto aberta', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { service, fake, changed } = setup()
    const id = await connected(service)
    const opened = await service.openFolder(id, 'Arquivo')
    expect(opened).toMatchObject({ ok: true, messages: [{ mailbox: 'Arquivo', uid: 7, id: 'servidor:1:7:Arquivo', subject: 'Contrato de parceria assinado' }] })
    expect(await service.messages({ accountId: id, mailbox: 'Arquivo' })).toMatchObject([{ uid: 7 }])
    // O corpo de uma mensagem da pasta vem por BODY.PEEK (só leitura).
    const peeks = fake.reader.peeks
    expect(await service.body({ accountId: id, id: 'servidor:1:7:Arquivo' })).toMatchObject({ ok: true, body: { text: expect.stringContaining('contrato de parceria') } })
    expect(fake.reader.peeks).toBe(peeks + 1)
    const inbox = await service.openFolder(id, 'inbox')
    expect(inbox.ok && inbox.messages.length).toBe(4)

    service.watchFolder(1, { accountId: id, path: 'Arquivo' })
    const before = changed.length
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await vi.waitFor(() => expect(changed.length).toBeGreaterThan(before))
    // Só uma por janela; `null` para.
    service.watchFolder(1, null)
    const after = changed.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(changed.length).toBe(after)
  })
})

describe('mover (CA4)', () => {
  it('com MOVE: UID MOVE, o mapa do COPYUID, sai do store e as contagens mudam', async () => {
    const { service, fake } = setup()
    const id = await connected(service)
    const before = await service.listFolders(id)
    expect(before.ok && find(before.folders, 'Arquivo')?.total).toBe(1)
    const result = await service.moveMessages(id, 'INBOX', [1, 2], 'Arquivo')
    expect(result).toEqual({ ok: true, moved: [{ fromUid: 1, toUid: 8 }, { fromUid: 2, toUid: 9 }] })
    expect(fake.folderLog).toEqual(['UID MOVE 1,2 Arquivo'])
    expect((await service.messages({ accountId: id })).map((message) => message.uid).sort()).toEqual([3, 4])
    const counts = await service.listFolders(id)
    expect(counts.ok && find(counts.folders, 'Arquivo')?.total).toBe(3)
    expect(counts.ok && find(counts.folders, 'INBOX')?.total).toBe(2)
  })

  it('sem MOVE e com UIDPLUS: COPY + \\Deleted + UID EXPUNGE, com o mapa de UIDs', async () => {
    const { service, fake } = setup()
    fake.capabilities.move = false
    const id = await connected(service)
    const result = await service.moveMessages(id, 'INBOX', [3], 'Arquivo')
    expect(result).toEqual({ ok: true, moved: [{ fromUid: 3, toUid: 8 }] })
    expect(fake.folderLog).toEqual(['UID COPY 3 Arquivo', 'UID STORE 3 +FLAGS (\\Deleted)', 'UID EXPUNGE 3'])
    expect(fake.mailboxes()['Arquivo']?.uids).toEqual([7, 8])
  })

  it('com MOVE e sem UIDPLUS: move, e o UID de destino fica null', async () => {
    const { service, fake } = setup()
    fake.capabilities.uidplus = false
    const id = await connected(service)
    expect(await service.moveMessages(id, 'INBOX', [3], 'Arquivo')).toEqual({ ok: true, moved: [{ fromUid: 3, toUid: null }] })
  })

  it('sem MOVE e sem UIDPLUS: recusado (unsupported), nada muda no servidor nem no store', async () => {
    const { service, fake } = setup()
    fake.capabilities.move = false
    fake.capabilities.uidplus = false
    const id = await connected(service)
    expect(await service.moveMessages(id, 'INBOX', [3], 'Arquivo')).toEqual({ ok: false, error: 'unsupported' })
    expect(fake.folderLog).toEqual([])
    expect(fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
    expect((await service.messages({ accountId: id })).length).toBe(4)
  })

  it('UIDVALIDITY da origem mudou: invalid, nada movido; pasta nunca aberta também não move', async () => {
    const { service, fake } = setup({ folders: [{ path: 'Projetos' }] })
    const id = await connected(service)
    fake.resetUidValidity('INBOX')
    expect(await service.moveMessages(id, 'INBOX', [1], 'Arquivo')).toEqual({ ok: false, error: 'invalid' })
    expect(fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
    expect(fake.folderLog).toEqual([])
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Projetos')).toEqual({ ok: false, error: 'invalid' })
    await service.openFolder(id, 'Arquivo')
    fake.resetUidValidity('Arquivo')
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Projetos')).toEqual({ ok: false, error: 'invalid' })
    expect(fake.mailboxes()['Arquivo']?.uids).toEqual([7])
  })

  it('de uma pasta aberta para outra: sai do store daquela pasta', async () => {
    const { service } = setup({ folders: [{ path: 'Projetos' }] })
    const id = await connected(service)
    await service.openFolder(id, 'Arquivo')
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Projetos')).toEqual({ ok: true, moved: [{ fromUid: 7, toUid: 1 }] })
    expect(await service.messages({ accountId: id, mailbox: 'Arquivo' })).toEqual([])
  })

  it('erro do servidor não apaga nada local; pedido fora do formato e mais de 500 UIDs voltam invalid', async () => {
    const { service, fake } = setup()
    const id = await connected(service)
    fake.failNext = 'MOVE'
    expect(await service.moveMessages(id, 'INBOX', [1], 'Arquivo')).toEqual({ ok: false, error: 'server' })
    expect((await service.messages({ accountId: id })).length).toBe(4)
    expect(fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
    expect(await service.moveMessages(id, 'INBOX', [], 'Arquivo')).toEqual({ ok: false, error: 'invalid' })
    expect(await service.moveMessages(id, 'INBOX', Array.from({ length: 501 }, (_, index) => index + 1), 'Arquivo')).toEqual({ ok: false, error: 'invalid' })
    expect(await service.moveMessages(id, 'INBOX', [1], 'INBOX')).toEqual({ ok: false, error: 'invalid' })
    expect(await service.move({ accountId: id, fromPath: 'INBOX', uids: [1], toPath: 'Arquivo', extra: true })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.move({ accountId: '0f8fad5b-d9cb-469f-a165-000000000000', fromPath: 'INBOX', uids: [1], toPath: 'Arquivo' })).toEqual({ ok: false, error: 'missing' })
  })

  it('a ponte do imapflow: o uidMap na ordem pedida, o que faltou fica null', () => {
    expect(movedList([5, 6, 7], new Map([[5, 50], [7, 70]]), 9n)).toEqual({ uidValidity: '9', moved: [{ fromUid: 5, toUid: 50 }, { fromUid: 6, toUid: null }, { fromUid: 7, toUid: 70 }] })
    expect(movedList([5], undefined)).toEqual({ uidValidity: null, moved: [{ fromUid: 5, toUid: null }] })
  })
})

describe('criar, renomear e apagar (CA5)', () => {
  it('INBOX e pastas especiais (e a pasta que tem uma dentro) são protegidas', async () => {
    const { service, fake } = setup({ folders: [{ path: '[Gmail]', noselect: true }, { path: '[Gmail]/Lixeira', specialUse: '\\Trash' }] })
    const id = await connected(service)
    for (const path of ['INBOX', 'Enviados', 'Arquivo', '[Gmail]', '[Gmail]/Lixeira']) {
      expect(await service.renameFolder(id, path, 'Outro')).toEqual({ ok: false, error: 'protected' })
      expect(await service.deleteFolder(id, path, true)).toEqual({ ok: false, error: 'protected' })
    }
    expect(fake.folderLog).toEqual([])
    const entry = (path: string, specialUse: string | null = null) => ({ path, name: path, delimiter: '/', specialUse, noselect: false, total: 0, unseen: 0 })
    expect(isProtectedFolder(entry('inbox'), [])).toBe(true)
    expect(isProtectedFolder(entry('Favoritos', '\\Flagged'), [])).toBe(true)
    expect(isProtectedFolder(entry('Todos', '\\All'), [])).toBe(true)
    expect(isProtectedFolder(entry('Notas'), [])).toBe(false)
  })

  it('nome inválido: vazio, mais de 100, com o delimitador, CR ou LF', async () => {
    const { service, fake } = setup()
    const id = await connected(service)
    for (const name of ['', '   ', 'x'.repeat(101), 'A/B', 'linha\nnova', 'linha\rnova']) expect(await service.createFolder(id, null, name)).toEqual({ ok: false, error: 'invalid' })
    expect(validFolderName('x'.repeat(100), '/')).toBe(true)
    expect(validFolderName('Clientes 2026', '.')).toBe(true)
    expect(await service.folderCreate({ accountId: id, parentPath: null, name: 'Nova', extra: 1 })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.createFolder(id, 'Não existe', 'Nova')).toEqual({ ok: false, error: 'missing' })
    expect(fake.folderLog).toEqual([])
  })

  it('criar, renomear (com as de dentro) e criar a que já existe', async () => {
    const { service, fake } = setup()
    const id = await connected(service)
    expect(await service.folderCreate({ accountId: id, parentPath: null, name: 'Clientes' })).toEqual({ ok: true, path: 'Clientes' })
    expect(await service.createFolder(id, 'Clientes', 'ABF')).toEqual({ ok: true, path: 'Clientes/ABF' })
    expect(await service.createFolder(id, null, 'Clientes')).toEqual({ ok: true, path: 'Clientes' })
    expect(await service.folderRename({ accountId: id, path: 'Clientes', newName: 'Contas' })).toEqual({ ok: true, path: 'Contas' })
    expect(await service.renameFolder(id, 'Contas/ABF', 'A/B')).toEqual({ ok: false, error: 'invalid' })
    expect(fake.folderLog).toEqual(['CREATE Clientes', 'CREATE Clientes/ABF', 'RENAME Clientes Contas'])
    const result = await service.listFolders(id)
    expect(result.ok && find(result.folders, 'Contas')?.children.map((node) => node.path)).toEqual(['Contas/ABF'])
  })

  it('apagar: vazia sai; com mensagens ou subpastas só com force', async () => {
    const { service, fake } = setup({ folders: [{ path: 'Vazia' }, { path: 'Pai' }, { path: 'Pai/Filho' }] })
    const id = await connected(service)
    expect(await service.moveMessages(id, 'INBOX', [1], 'Pai/Filho')).toMatchObject({ ok: true })
    expect(await service.deleteFolder(id, 'Pai/Filho', false)).toEqual({ ok: false, error: 'invalid', contents: { messages: 1, folders: 0 } })
    expect(await service.deleteFolder(id, 'Pai', false)).toEqual({ ok: false, error: 'invalid', contents: { messages: 0, folders: 1 } })
    expect(await service.folderDelete({ accountId: id, path: 'Vazia' })).toEqual({ ok: true })
    expect(await service.folderDelete({ accountId: id, path: 'Pai/Filho', force: true })).toEqual({ ok: true })
    expect(fake.folderLog.filter((line) => line.startsWith('DELETE'))).toEqual(['DELETE Vazia', 'DELETE Pai/Filho'])
    expect(Object.keys(fake.mailboxes())).not.toContain('Vazia')
    expect(await service.deleteFolder(id, 'Vazia', true)).toEqual({ ok: false, error: 'missing' })
  })

  it('servidor recusa: server; sem senha que abra ou sem conexão: unavailable', async () => {
    const { service, fake } = setup()
    const id = await connected(service)
    fake.failNext = 'CREATE'
    expect(await service.createFolder(id, null, 'Nova')).toEqual({ ok: false, error: 'server' })
    const offline = setup({}, { imapFolders: () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })) })
    const other = await connected(offline.service)
    expect(await offline.service.listFolders(other)).toEqual({ ok: false, error: 'unavailable' })
  })
})

describe('achados da revisão do contrato 52', () => {
  const CLICK = '11111111-2222-4333-8444-555555555555'

  it('a pasta dos enviados gravada vale já antes de conectar (conta fora do ar): Enviados, assistente e "pendente" iguais', async () => {
    const first = setup()
    const id = await connected(first.service)
    first.service.registerClick(1, CLICK)
    const sent = await first.service.send(1, { accountId: id, to: ['marina@cliente.example'], subject: 'Re: Proposta', text: 'Segue.', clickToken: CLICK })
    expect(sent.ok).toBe(true)
    await first.service.dispose()
    // O app reabre com o servidor fora do ar: a conta não conecta.
    const offline: ImapConnect = () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' }))
    const again = setup({}, { imap: offline }, first.userData).service
    await again.init()
    const status = again.accounts()[0]
    expect(status?.state).not.toBe('connected')
    expect(status?.sentMailbox).toBe('Enviados')
    const list = await again.messages({ accountId: id, folder: 'sent' })
    expect(list).toHaveLength(1)
    expect(isSent(list[0] as EmailMessage, status as { sentMailbox: string })).toBe(true)
    // O assistente vê o enviado como enviado (não como recebido "pendente").
    const tools = createEmailTools({ cached: () => again.cached(), body: (accountId, message) => again.cachedBody(accountId, message), searchServer: () => Promise.resolve({ ok: false, error: 'unavailable' }), peekServer: () => Promise.resolve({ ok: false, error: 'unavailable' }), locked: () => false, now: () => NOW })
    const folder = mkdtempSync(join(tmpdir(), 'scribe-busca-'))
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
    await tools.tools.find((tool) => tool.name === 'buscar_emails')?.run({ assunto: 'Re: Proposta' }, folder)
    const found = readFileSync(join(folder, 'BUSCA-EMAILS.md'), 'utf8')
    expect(found).toContain('onde: enviados (no app)')
    expect(found).not.toContain('pendente de resposta')
  })

  it('a pasta vigiada não faz login com a senha recusada nem com a conta fora do ar', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let logins = 0
    const fake = createFakeEmail(() => NOW)
    const counted: ImapFolderConnect = (config) => {
      logins++
      return fake.imapFolders(config)
    }
    const { service } = setup({}, { imap: fake.imap, imapFolders: counted, folderRefreshMs: 1_000 })
    const added = await service.addAccount({ ...imapAccount, password: SMOKE_EMAIL_WRONG_PASSWORD })
    if (!added.ok) throw new Error(added.error)
    const id = added.status.account.id
    await vi.waitFor(() => expect(service.accounts()[0]?.state).toBe('error'))
    service.watchFolder(1, { accountId: id, path: 'Arquivo' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await service.listFolders(id)).toEqual({ ok: false, error: 'unavailable' })
    expect(await service.openFolder(id, 'Arquivo')).toEqual({ ok: false, error: 'unavailable' })
    expect(logins).toBe(0)
  })

  it('a pasta vigiada para: conta removida, pasta renomeada ou apagada, e duas recusas seguidas do servidor', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let logins = 0
    const fake = createFakeEmail(() => NOW, { folders: [{ path: 'Projetos' }, { path: 'Velha' }] })
    const counted: ImapFolderConnect = (config) => {
      logins++
      return fake.imapFolders(config)
    }
    const { service } = setup({}, { imap: fake.imap, imapReader: fake.imapReader, imapFolders: counted, folderRefreshMs: 1_000 })
    const id = await connected(service)
    await service.openFolder(id, 'Projetos')
    await service.openFolder(id, 'Velha')

    // Renomeada: para de vigiar.
    service.watchFolder(1, { accountId: id, path: 'Projetos' })
    expect(await service.renameFolder(id, 'Projetos', 'Clientes')).toMatchObject({ ok: true })
    let before = logins
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logins).toBe(before)

    // Apagada pelo app: idem.
    service.watchFolder(2, { accountId: id, path: 'Velha' })
    expect(await service.deleteFolder(id, 'Velha', true)).toEqual({ ok: true })
    before = logins
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logins).toBe(before)

    // Some do servidor por fora: duas recusas seguidas e para.
    service.watchFolder(3, { accountId: id, path: 'Clientes' })
    const direct = await fake.imapFolders({ host: 'x', port: 993, security: 'tls', user: 'u', pass: SMOKE_EMAIL_PASSWORD })
    await direct.delete('Clientes')
    before = logins
    await vi.advanceTimersByTimeAsync(10_000)
    expect(logins - before).toBe(2)

    // Conta removida: para.
    service.watchFolder(4, { accountId: id, path: 'Arquivo' })
    await service.removeAccount({ accountId: id })
    before = logins
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logins).toBe(before)
  })

  it('as pastas abertas ficam em arquivos à parte; o <conta>.json não muda de tamanho; passou do teto, sai a mais antiga', async () => {
    const folders = Array.from({ length: 31 }, (_, index) => ({ path: `P${String(index).padStart(2, '0')}` }))
    let clock = NOW
    const { service, userData } = setup({ folders }, { now: () => clock++ })
    const id = await connected(service)
    const accountFile = join(userData, 'email', `${id}.json`)
    const size = readFileSync(accountFile, 'utf8').length
    await service.openFolder(id, 'Arquivo')
    expect(readFileSync(accountFile, 'utf8').length).toBe(size)
    expect(readFileSync(accountFile, 'utf8')).not.toContain('Contrato de parceria')
    const dir = join(userData, 'email', `${id}.folders`)
    expect(existsSync(join(dir, 'index.json'))).toBe(true)
    for (const folder of folders) await service.openFolder(id, folder.path)
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { folders: Record<string, unknown> }
    expect(Object.keys(index.folders)).toHaveLength(30)
    // A mais antiga ("Arquivo") saiu, com o arquivo dela.
    expect(index.folders['Arquivo']).toBeUndefined()
    expect(readdirSync(dir).filter((name) => name !== 'index.json')).toHaveLength(30)
    expect(await service.messages({ accountId: id, mailbox: 'Arquivo' })).toEqual([])
    // Remover a conta leva as pastas junto.
    await service.removeAccount({ accountId: id })
    expect(existsSync(dir)).toBe(false)
  })

  it('a pasta de destino guardada recebe as movidas (pelo COPYUID); sem o UID novo, ela é descartada', async () => {
    const { service, fake } = setup({ folders: [{ path: 'Projetos' }] })
    const id = await connected(service)
    await service.openFolder(id, 'Arquivo')
    expect(await service.moveMessages(id, 'INBOX', [1], 'Arquivo')).toEqual({ ok: true, moved: [{ fromUid: 1, toUid: 8 }] })
    expect((await service.messages({ accountId: id, mailbox: 'Arquivo' })).map((message) => [message.uid, message.id, message.mailbox])).toEqual(
      expect.arrayContaining([
        [7, 'servidor:1:7:Arquivo', 'Arquivo'],
        [8, 'servidor:1:8:Arquivo', 'Arquivo'],
      ]),
    )
    fake.capabilities.uidplus = false
    expect(await service.moveMessages(id, 'INBOX', [2], 'Arquivo')).toMatchObject({ ok: true })
    expect(await service.messages({ accountId: id, mailbox: 'Arquivo' })).toEqual([])
  })

  it('mover PARA a INBOX não vira aviso de email novo (com e sem o UID novo)', async () => {
    const { service, fake, received } = setup()
    const id = await connected(service)
    await service.openFolder(id, 'Arquivo')
    expect(await service.moveMessages(id, 'Arquivo', [7], 'INBOX')).toEqual({ ok: true, moved: [{ fromUid: 7, toUid: 5 }] })
    expect((await service.messages({ accountId: id })).find((message) => message.uid === 5)).toMatchObject({ mailbox: 'INBOX', id: '5', subject: 'Contrato de parceria assinado' })
    // O IDLE avisa (EXISTS): nada novo para notificar.
    await fake.deliver({ from: { name: 'Ana', address: 'ana@cliente.example' }, subject: 'De verdade nova', text: 'oi' })
    await vi.waitFor(() => expect(received.map((message) => message.subject)).toEqual(['De verdade nova']))
    // Sem UIDPLUS: o IDLE traz a movida, mas ela não é avisada (o Message-ID ficou marcado).
    await service.openFolder(id, 'Arquivo')
    expect(await service.moveMessages(id, 'INBOX', [5], 'Arquivo')).toMatchObject({ ok: true })
    await service.openFolder(id, 'Arquivo')
    const back = (await service.messages({ accountId: id, mailbox: 'Arquivo' })).find((message) => message.subject === 'Contrato de parceria assinado')
    fake.capabilities.uidplus = false
    expect(await service.moveMessages(id, 'Arquivo', [back?.uid ?? 0], 'INBOX')).toEqual({ ok: true, moved: [{ fromUid: back?.uid ?? 0, toUid: null }] })
    await fake.deliver({ from: { name: 'Ana', address: 'ana@cliente.example' }, subject: 'Outra nova', text: 'oi' })
    await vi.waitFor(() => expect(received.map((message) => message.subject)).toEqual(['De verdade nova', 'Outra nova']))
    expect((await service.messages({ accountId: id })).some((message) => message.subject === 'Contrato de parceria assinado')).toBe(true)
  })

  it('mover espera o sincronismo da INBOX em andamento: as movidas não voltam à lista', async () => {
    const fake = createFakeEmail(() => NOW)
    // Primeira vez: a conta conecta e grava o UIDVALIDITY da INBOX.
    const dir = mkdtempSync(join(tmpdir(), 'scribe-fila-'))
    const first = setup({}, { imap: fake.imap, imapFolders: fake.imapFolders }, dir)
    const accountId = await connected(first.service)
    await first.service.dispose()
    // O app reabre: o servidor responde a lista de antes do mover, e a gravação dela atrasa.
    let syncing = false
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: ImapConnect = async (config) => {
      const session = await fake.imap(config)
      return {
        ...session,
        recent: async (limit) => {
          const list = await session.recent(limit)
          syncing = true
          await gate
          return list
        },
      }
    }
    const second = setup({}, { imap: slow, imapFolders: fake.imapFolders }, dir).service
    await second.init()
    await vi.waitFor(() => expect(syncing).toBe(true))
    const moving = second.moveMessages(accountId, 'INBOX', [1], 'Arquivo')
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    expect(await moving).toEqual({ ok: true, moved: [{ fromUid: 1, toUid: 8 }] })
    await vi.waitFor(() => expect(second.accounts()[0]?.state).toBe('connected'))
    expect((await second.messages({ accountId })).map((message) => message.uid)).not.toContain(1)
  })
})

describe('contrato 56 (CA7): mover com o UIDVALIDITY da referência e os Message-IDs que voltam à INBOX', () => {
  it('pasta nunca aberta: sem `options` é invalid (como no 52); com o UIDVALIDITY dela, move e diz o do destino', async () => {
    const { service, fake } = setup({ folders: [{ path: 'Resolvidos' }] })
    const id = await connected(service)
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Resolvidos')).toEqual({ ok: false, error: 'invalid' })
    // O UIDVALIDITY errado não move nada.
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Resolvidos', { uidValidity: '99' })).toEqual({ ok: false, error: 'invalid' })
    const moved = await service.moveMessages(id, 'Arquivo', [7], 'Resolvidos', { uidValidity: '1' })
    expect(moved).toMatchObject({ ok: true, moved: [{ fromUid: 7, toUid: 1 }], uidValidity: expect.stringMatching(/^\d+$/) })
    expect(fake.mailboxes()['Resolvidos']?.uids).toEqual([1])
    expect(await service.moveMessages(id, 'Arquivo', [7], 'Resolvidos', { uidValidity: 'abc' })).toEqual({ ok: false, error: 'invalid' })
  })

  it('a volta à INBOX de uma pasta fora do store não avisa email novo (os Message-IDs vão para `movedIn`)', async () => {
    const { service, fake, received } = setup({ folders: [{ path: 'Resolvidos' }] })
    const id = await connected(service)
    const uid = fake.put('Resolvidos', { from: { name: 'Ana', address: 'ana@cliente.example' }, subject: 'Volta', date: NOW, messageId: '<volta@cliente.example>' })
    const located = await service.locateMessages(id, 'Resolvidos', [uid, 999], ['<volta@cliente.example>', '<nada@x>'])
    expect(located).toMatchObject({ ok: true, existing: [uid], byMessageId: { '<volta@cliente.example>': [uid], '<nada@x>': [] } })
    const uidValidity = located.ok ? located.uidValidity : ''
    expect(await service.moveMessages(id, 'Resolvidos', [uid], 'INBOX', { uidValidity, messageIds: ['<volta@cliente.example>'] })).toMatchObject({ ok: true })
    await vi.waitFor(async () => expect((await service.messages({ accountId: id })).map((message) => message.subject)).toContain('Volta'))
    expect(received).toEqual([])
  })
})
