// Contrato 52: a ponte de verdade das pastas (`connectImapFolders`) contra um `ImapFlow` falso que registra as chamadas:
// o `LIST` com `statusQuery`, o intervalo das mais recentes, o `UID MOVE` (com o `UIDVALIDITY` conferido antes), a recusa
// sem `MOVE` nem `UIDPLUS` e o `CREATE`/`RENAME`/`DELETE`. Nenhuma rede.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flow = vi.hoisted(() => ({
  calls: [] as unknown[][],
  capabilities: new Map<string, boolean>(),
  mailboxes: {} as Record<string, { exists: number; uidValidity: bigint }>,
  moveResult: null as unknown,
}))

vi.mock('imapflow', () => ({
  ImapFlow: class {
    capabilities = flow.capabilities
    constructor(options: unknown) {
      flow.calls.push(['new', options])
    }
    on() {}
    async connect() {
      flow.calls.push(['connect'])
    }
    async list(options: unknown) {
      flow.calls.push(['list', options])
      return [
        { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: new Set<string>(), status: { path: 'INBOX', messages: 12, unseen: 3 } },
        { path: '[Gmail]', name: '[Gmail]', delimiter: '/', flags: new Set(['\\Noselect']) },
        { path: '[Gmail]/Lixeira', name: 'Lixeira', delimiter: '/', flags: new Set<string>(), specialUse: '\\Trash', status: { path: '[Gmail]/Lixeira', messages: 0, unseen: 0 } },
      ]
    }
    async mailboxOpen(path: string, options?: unknown) {
      flow.calls.push(['mailboxOpen', path, options])
      const box = flow.mailboxes[path]
      if (!box) throw new Error('sem pasta')
      return { path, ...box }
    }
    async fetchAll(range: string, query: unknown, options?: unknown) {
      flow.calls.push(['fetchAll', range, query, options])
      return [{ uid: 41, flags: new Set(['\\Seen']), envelope: { subject: 'Oi', date: new Date('2026-11-01T10:00:00Z') } }]
    }
    async messageMove(range: string, to: string, options: unknown) {
      flow.calls.push(['messageMove', range, to, options])
      return flow.moveResult
    }
    async mailboxCreate(path: string) {
      flow.calls.push(['mailboxCreate', path])
      return { path: `INBOX.${path}`, created: true }
    }
    async mailboxRename(path: string, newPath: string) {
      flow.calls.push(['mailboxRename', path, newPath])
      return { path, newPath }
    }
    async mailboxDelete(path: string) {
      flow.calls.push(['mailboxDelete', path])
      return { path }
    }
    async logout() {
      flow.calls.push(['logout'])
    }
    close() {}
  },
}))

import { connectImapFolders, ImapFolderError } from '../src/main/email/imap-client'

const CONFIG = { host: 'imap.lap.example', port: 993, security: 'tls' as const, user: 'andrew@lap.example', pass: 'x' }
const named = (name: string): unknown[][] => flow.calls.filter((call) => call[0] === name)

beforeEach(() => {
  flow.calls = []
  flow.capabilities = new Map([
    ['MOVE', true],
    ['UIDPLUS', true],
  ])
  flow.mailboxes = { INBOX: { exists: 202, uidValidity: 7n }, Arquivo: { exists: 0, uidValidity: 3n } }
  flow.moveResult = { path: 'INBOX', destination: 'Arquivo', uidValidity: 3n, uidMap: new Map([[10, 100]]) }
})

describe('connectImapFolders com o imapflow (contrato 52)', () => {
  it('LIST com STATUS (MESSAGES UNSEEN); \\Noselect sem contagem', async () => {
    const session = await connectImapFolders(CONFIG)
    const list = await session.list()
    expect(named('list')).toEqual([['list', { statusQuery: { messages: true, unseen: true } }]])
    expect(list).toEqual([
      { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: null, noselect: false, total: 12, unseen: 3 },
      { path: '[Gmail]', name: '[Gmail]', delimiter: '/', specialUse: null, noselect: true, total: null, unseen: null },
      { path: '[Gmail]/Lixeira', name: 'Lixeira', delimiter: '/', specialUse: '\\Trash', noselect: false, total: 0, unseen: 0 },
    ])
  })

  it('as mais recentes: EXAMINE (só leitura) e o intervalo de sequência das últimas `limit`', async () => {
    const session = await connectImapFolders(CONFIG)
    const read = await session.recent('INBOX', 200)
    expect(named('mailboxOpen')).toEqual([['mailboxOpen', 'INBOX', { readOnly: true }]])
    expect(named('fetchAll')[0]?.slice(0, 2)).toEqual(['fetchAll', '3:*'])
    expect(named('fetchAll')[0]?.[3]).toBeUndefined()
    expect(read).toMatchObject({ uidValidity: '7', messages: [{ uid: 41, flags: ['\\Seen'], subject: 'Oi' }] })
    // Pasta vazia: nem pede.
    expect(await session.recent('Arquivo', 200)).toEqual({ uidValidity: '3', messages: [] })
    expect(named('fetchAll')).toHaveLength(1)
  })

  it('mover: abre a origem para escrita, confere o UIDVALIDITY e faz UID MOVE com o mapa do COPYUID', async () => {
    const session = await connectImapFolders(CONFIG)
    expect(await session.move('INBOX', [10, 11], 'Arquivo', '7')).toEqual({ uidValidity: '3', moved: [{ fromUid: 10, toUid: 100 }, { fromUid: 11, toUid: null }] })
    expect(named('mailboxOpen')).toEqual([['mailboxOpen', 'INBOX', undefined]])
    expect(named('messageMove')).toEqual([['messageMove', '10,11', 'Arquivo', { uid: true }]])
  })

  it('UIDVALIDITY diferente: nada é movido', async () => {
    const session = await connectImapFolders(CONFIG)
    await expect(session.move('INBOX', [10], 'Arquivo', '6')).rejects.toEqual(new ImapFolderError('uidvalidity'))
    expect(named('messageMove')).toEqual([])
  })

  it('sem MOVE e com UIDPLUS: o imapflow faz COPY + UID EXPUNGE (o messageMove com uid); sem os dois: recusa antes de abrir', async () => {
    flow.capabilities = new Map([['UIDPLUS', true]])
    const session = await connectImapFolders(CONFIG)
    await session.move('INBOX', [10], 'Arquivo', '7')
    expect(named('messageMove')).toEqual([['messageMove', '10', 'Arquivo', { uid: true }]])
    flow.capabilities.clear()
    flow.calls = []
    await expect(session.move('INBOX', [10], 'Arquivo', '7')).rejects.toMatchObject({ kind: 'unsupported' })
    expect(named('mailboxOpen')).toEqual([])
    expect(named('messageMove')).toEqual([])
  })

  it('o servidor recusou o MOVE (imapflow devolve false): exceção', async () => {
    flow.moveResult = false
    const session = await connectImapFolders(CONFIG)
    await expect(session.move('INBOX', [10], 'Arquivo', '7')).rejects.toThrow('MOVE recusado')
  })

  it('CREATE devolve o path que o servidor criou (com o prefixo); RENAME e DELETE', async () => {
    const session = await connectImapFolders(CONFIG)
    expect(await session.create('Clientes')).toBe('INBOX.Clientes')
    expect(await session.rename('A', 'B')).toBe('B')
    await session.delete('B')
    await session.close()
    expect(flow.calls.map((call) => call[0]).filter((name) => name !== 'new' && name !== 'connect')).toEqual(['mailboxCreate', 'mailboxRename', 'mailboxDelete', 'logout'])
  })
})
