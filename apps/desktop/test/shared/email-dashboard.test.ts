// Contrato 155 (email-dashboard, CA1 a CA6 e CA9): a lógica pura do Painel de e-mail e as rotas.
import { describe, expect, it } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import {
  DASHBOARD_LIMITS,
  allowedTargetFolders,
  archiveFolder,
  folderPathLabel,
  buildDashboardView,
  clampModelItem,
  emptyDashboardStore,
  ignoreKey,
  itemKey,
  pruneStore,
  selectMessagesToAnalyze,
  withIgnored,
  withOpened,
  type EmailDashboardItem,
  type EmailDashboardStore,
} from '../../src/shared/email-dashboard'
import { EmailDashboardItemSchema, EmailDashboardModelOutputSchema, EmailDashboardStoreSchema } from '../../src/shared/email-dashboard-schema'
import { EMAIL_PAINEL_PATH, emailPainelPath, emailPath, isEmailPainelPath, type EmailNavigationState } from '../../src/shared/routes'

const DIA_MS = 86_400_000
const HORA_MS = 3_600_000
const NOW = Date.parse('2026-11-23T12:00:00.000Z')

function msg(id: string, patch: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    accountId: 'a',
    mailbox: 'INBOX',
    uid: Number(id) || null,
    seen: false,
    flagged: false,
    answered: false,
    from: [{ name: `Pessoa ${id}`, address: `p${id}@cliente.com` }],
    to: [{ name: null, address: 'eu@lap.com' }],
    cc: [],
    subject: `Assunto ${id}`,
    date: NOW - Number(id) * HORA_MS,
    messageId: `<${id}@cliente.com>`,
    inReplyTo: null,
    references: [],
    ...patch,
  }
}

function item(accountId: string, messageKey: string, patch: Partial<EmailDashboardItem> = {}): EmailDashboardItem {
  return {
    accountId,
    messageKey,
    messageId: null,
    analyzedAt: NOW,
    model: 'haiku',
    importance: 3,
    reason: 'motivo',
    needsReply: false,
    reply: null,
    move: null,
    ...patch,
  }
}

/** Como o `EmailFolderNode`: `name` é o último segmento do path. */
const folder = (path: string, specialUse: string | null = null, name = path.split('/').pop() ?? path) => ({ path, name, specialUse, delimiter: '/' })

describe('selectMessagesToAnalyze (CA1, R2)', () => {
  it('três contas de 100: até 60 por conta e 150 no total, sem as próprias, as antigas e as já analisadas; a mais recente primeiro', () => {
    const store = emptyDashboardStore()
    const accounts = ['a', 'b', 'c'].map((accountId) => {
      // 100 mensagens espalhadas em 20 dias (uma a cada 4,8 h), da mais nova para a mais antiga.
      const inbox = Array.from({ length: 100 }, (_, n) => msg(String(n + 1), { accountId, date: NOW - Math.round((n * 20 * DIA_MS) / 100) - 60_000 }))
      // 10 do próprio endereço (caixa diferente), entre as mais recentes.
      for (const n of [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]) {
        const m = inbox[n]
        if (m) m.from = [{ name: 'Eu', address: 'EU@lap.com' }]
      }
      // 5 já analisadas depois da data delas.
      for (const n of [1, 3, 5, 7, 9]) {
        const m = inbox[n]
        if (m) store.items[itemKey(accountId, m.id)] = item(accountId, m.id, { analyzedAt: m.date + 1 })
      }
      return { accountId, ownAddresses: ['eu@lap.com'], inbox }
    })
    const out = selectMessagesToAnalyze({ now: NOW, accounts, store })
    expect(out.length).toBeLessThanOrEqual(DASHBOARD_LIMITS.perRun)
    for (const account of accounts) {
      const daConta = out.filter((entry) => entry.accountId === account.accountId)
      expect(daConta.length).toBeGreaterThan(0)
      expect(daConta.length).toBeLessThanOrEqual(DASHBOARD_LIMITS.perAccount)
      const elegiveis = account.inbox.filter(
        (m) => m.date >= NOW - 7 * DIA_MS && m.from[0]?.address !== 'EU@lap.com' && !store.items[itemKey(account.accountId, m.id)],
      )
      expect(daConta[0]?.message.date).toBe(Math.max(...elegiveis.map((m) => m.date)))
    }
    for (const { accountId, message } of out) {
      expect(message.from.some((f) => f.address.toLowerCase() === 'eu@lap.com')).toBe(false)
      expect(message.date).toBeGreaterThanOrEqual(NOW - 7 * DIA_MS)
      expect(store.items[itemKey(accountId, message.id)]).toBeUndefined()
    }
    // Em ordem de data, da mais recente para a mais antiga.
    expect(out.map((entry) => entry.message.date)).toEqual([...out.map((entry) => entry.message.date)].sort((x, y) => y - x))
  })

  it('teto por conta antes do global: com 3 contas cheias, 150 no total e 50 de cada', () => {
    const accounts = ['a', 'b', 'c'].map((accountId) => ({
      accountId,
      ownAddresses: [],
      inbox: Array.from({ length: 80 }, (_, n) => msg(String(n + 1), { accountId, date: NOW - (n + 1) * 60_000 })),
    }))
    const out = selectMessagesToAnalyze({ now: NOW, accounts, store: emptyDashboardStore() })
    expect(out).toHaveLength(150)
    for (const id of ['a', 'b', 'c']) expect(out.filter((entry) => entry.accountId === id)).toHaveLength(50)
  })

  it('item analisado antes da data da mensagem (chegou de novo) volta à fila; fora da INBOX não entra', () => {
    const m = msg('1')
    const store = emptyDashboardStore()
    store.items[itemKey('a', '1')] = item('a', '1', { analyzedAt: m.date - 1 })
    const out = selectMessagesToAnalyze({ now: NOW, accounts: [{ accountId: 'a', ownAddresses: [], inbox: [m, msg('2', { mailbox: 'Clientes' })] }], store })
    expect(out.map((entry) => entry.message.id)).toEqual(['1'])
  })
})

describe('pastas de destino (CA2, R4)', () => {
  it('tira INBOX, as especiais e as de nome reservado; ordena pelo path, com o rótulo legível; acha a de arquivo', () => {
    const folders = [folder('INBOX'), folder('Sent', '\\Sent'), folder('Lixeira'), folder('Newsletters'), folder('Clientes/ABF'), folder('Archive')]
    expect(folders.find((f) => f.path === 'Clientes/ABF')?.name).toBe('ABF')
    expect(allowedTargetFolders(folders)).toEqual([
      { path: 'Archive', name: 'Archive', label: 'Archive' },
      { path: 'Clientes/ABF', name: 'ABF', label: 'Clientes / ABF' },
      { path: 'Newsletters', name: 'Newsletters', label: 'Newsletters' },
    ])
    expect(archiveFolder(folders)).toEqual({ path: 'Archive', name: 'Archive' })
    const semArchive = [...folders.filter((f) => f.path !== 'Archive'), folder('Arquivados', '\\Archive')]
    expect(archiveFolder(semArchive)).toEqual({ path: 'Arquivados', name: 'Arquivados' })
  })

  it('nome sem caixa e sem acento, uso especial em qualquer nome, inbox em qualquer caixa; no máximo 40', () => {
    const folders = [
      folder('inbox'),
      folder('Itens/Rascunhos', null, 'RASCUNHOS'),
      folder('Lixo'),
      folder('[Gmail]/Todos', '\\All', 'Todos'),
      folder('[Gmail]/Lixo', '\\Trash', 'Lixeira do Gmail'),
      folder('Sent Items'),
      folder('Spam'),
      folder('Junk', '\\Junk'),
      folder('Drafts', '\\Drafts'),
      folder('Deleted'),
      folder('Enviados'),
      folder('Projetos'),
    ]
    expect(allowedTargetFolders(folders)).toEqual([{ path: 'Projetos', name: 'Projetos', label: 'Projetos' }])
    const muitas = Array.from({ length: 50 }, (_, n) => folder(`P${String(n).padStart(2, '0')}`))
    expect(allowedTargetFolders(muitas)).toHaveLength(40)
    expect(archiveFolder([folder('Projetos'), folder('ARQUIVADAS')])?.path).toBe('ARQUIVADAS')
    expect(archiveFolder([folder('Projetos')])).toBeNull()
  })

  it('rótulo: pelo delimitador da pasta; sem hierarquia, o path inteiro; sem a informação, / ou .', () => {
    expect(folderPathLabel({ path: 'Clientes.Grupo Orion', delimiter: '.' })).toBe('Clientes / Grupo Orion')
    expect(folderPathLabel({ path: 'Clientes/Grupo Orion', delimiter: '/' })).toBe('Clientes / Grupo Orion')
    expect(folderPathLabel({ path: 'A/B', delimiter: null })).toBe('A/B')
    expect(folderPathLabel({ path: 'Clientes/Grupo Orion' })).toBe('Clientes / Grupo Orion')
  })
})

/** CA3/CA4: 5 itens (5,4,3,3,1), 2 respostas (uma já respondida), 3 mover (pasta inexistente, conta POP3, ignorado). */
function cenario(): { store: EmailDashboardStore; accounts: Parameters<typeof buildDashboardView>[0]['accounts'] } {
  const store = emptyDashboardStore()
  const inboxA = [
    msg('1', { seen: true }),
    msg('2'),
    msg('3', { date: NOW - 10 * HORA_MS }),
    msg('4', { date: NOW - 2 * HORA_MS, answered: true }),
    // Sem item: não aparece com a análise ligada.
    msg('6'),
  ]
  const inboxB = [msg('5', { accountId: 'b' })]
  store.items[itemKey('a', '1')] = item('a', '1', { importance: 5, needsReply: true, reply: 'Olá, Pessoa 1,\n\nrespondo amanhã.' })
  store.items[itemKey('a', '2')] = item('a', '2', { importance: 4, move: { folder: 'Inexistente', reason: 'r' } })
  store.items[itemKey('a', '3')] = item('a', '3', { importance: 3, move: { folder: 'Newsletters', reason: 'boletim' } })
  store.items[itemKey('a', '4')] = item('a', '4', { importance: 3, needsReply: true, reply: 'Oi' })
  store.items[itemKey('b', '5')] = item('b', '5', { importance: 1, move: { folder: 'Newsletters', reason: 'boletim' } })
  // Mensagem que saiu da INBOX: nem atenção.
  store.items[itemKey('a', '99')] = item('a', '99', { importance: 5 })
  store.ignored.push({ key: ignoreKey('a', '3', 'move'), at: NOW })
  const pendingA = new Set(['1', '2', '3', '6'])
  return {
    store,
    accounts: [
      { accountId: 'a', name: 'LAP', address: 'eu@lap.com', pop3: false, ownAddresses: ['eu@lap.com'], inbox: inboxA, pending: pendingA, folders: [folder('INBOX'), folder('Newsletters')] },
      { accountId: 'b', name: 'POP', address: 'eu@pop.com', pop3: true, ownAddresses: ['eu@pop.com'], inbox: inboxB, pending: new Set(['5']), folders: [folder('INBOX'), folder('Newsletters')] },
    ],
  }
}

describe('buildDashboardView (CA3, CA4)', () => {
  it('ligada: atenção por importância e data, uma resposta, nenhum grupo de mover', () => {
    const { store, accounts } = cenario()
    const view = buildDashboardView({ enabled: true, running: false, store, accounts })
    expect(view.attention.map((row) => [row.messageKey, row.importance])).toEqual([
      ['1', 5],
      ['2', 4],
      // Empate em 3: a mais recente primeiro (4 é de 2 h atrás, 3 de 10 h atrás).
      ['4', 3],
      ['3', 3],
      ['5', 1],
    ])
    expect(view.replies).toHaveLength(1)
    expect(view.replies[0]).toMatchObject({ accountId: 'a', messageKey: '1', reply: 'Olá, Pessoa 1,\n\nrespondo amanhã.', opened: false, from: 'Pessoa 1' })
    expect(view.moves).toEqual([])
    expect(view.accounts).toEqual([
      { accountId: 'a', name: 'LAP', address: 'eu@lap.com', unread: 4, pending: 4, pop3: false },
      { accountId: 'b', name: 'POP', address: 'eu@pop.com', unread: 1, pending: 1, pop3: true },
    ])
    // Contrato 170: os 6 itens das contas listadas; o "a:3" com o mover ignorado continua contando.
    expect(view.analyzed).toBe(6)
  })

  it('desligada: atenção só com as pendentes não lidas (importância 0, sem motivo), sem respostas nem mover', () => {
    const { store, accounts } = cenario()
    const view = buildDashboardView({ enabled: false, running: true, store, accounts })
    expect(view.attention.map((row) => [row.accountId, row.messageKey])).toEqual([
      ['a', '2'],
      ['b', '5'],
      ['a', '6'],
      ['a', '3'],
    ])
    expect(view.attention.every((row) => row.importance === 0 && row.reason === '' && !row.seen)).toBe(true)
    expect(view.replies).toEqual([])
    expect(view.moves).toEqual([])
    expect(view.accounts).toHaveLength(2)
    expect(view).toMatchObject({ enabled: false, running: true, lastRun: null })
  })

  it('mover: agrupa por conta e pasta, "Arquivar" na pasta de arquivo, maiores primeiro, 50 linhas no total; resposta aberta marcada', () => {
    const store = emptyDashboardStore()
    const inbox = Array.from({ length: 70 }, (_, n) => msg(String(n + 1)))
    inbox.forEach((m, n) => {
      store.items[itemKey('a', m.id)] = item('a', m.id, { move: { folder: n < 40 ? 'Archive' : 'Clientes/ABF', reason: 'r' } })
    })
    store.items[itemKey('a', '1')] = item('a', '1', { needsReply: true, reply: 'Oi', move: { folder: 'Archive', reason: 'r' } })
    const aberto = withOpened(store, 'a', '1', NOW)
    const view = buildDashboardView({
      enabled: true,
      running: false,
      store: aberto,
      accounts: [{ accountId: 'a', name: 'LAP', address: 'eu@lap.com', pop3: false, ownAddresses: [], inbox, pending: new Set(['1']), folders: [folder('INBOX'), folder('Archive', '\\Archive'), folder('Clientes/ABF')] }],
    })
    expect(view.moves.map((g) => [g.folder, g.folderName, g.rows.length])).toEqual([
      ['Archive', 'Arquivar', 40],
      // `folderName` é o caminho legível, não só o último segmento.
      ['Clientes/ABF', 'Clientes / ABF', 10],
    ])
    expect(view.replies).toEqual([expect.objectContaining({ messageKey: '1', opened: true })])
    expect(view.attention).toHaveLength(DASHBOARD_LIMITS.attentionRows)
  })
})

describe('total analisado (contrato 170, CA2)', () => {
  const conta = (accountId: string) => ({ accountId, name: 'LAP', address: 'eu@lap.com', pop3: false, ownAddresses: [], inbox: [], pending: new Set<string>(), folders: [] })

  it('conta os itens das contas listadas, não a última passada; ignorar não desconta; conta que saiu não entra', () => {
    const store = emptyDashboardStore()
    for (const id of ['1', '2', '3', '4', '5', '6']) store.items[itemKey('a', id)] = item('a', id)
    store.lastRun = { at: NOW, model: 'haiku', analyzed: 0, costUsd: null, error: null }
    expect(buildDashboardView({ enabled: true, running: false, store, accounts: [conta('a')] }).analyzed).toBe(6)
    // Desligada, o total é o mesmo.
    expect(buildDashboardView({ enabled: false, running: false, store, accounts: [conta('a')] }).analyzed).toBe(6)
    store.items[itemKey('z', '1')] = item('z', '1')
    const ignorado = withIgnored(withIgnored(store, 'a', '2', 'reply', NOW), 'a', '3', 'move', NOW)
    expect(buildDashboardView({ enabled: true, running: false, store: ignorado, accounts: [conta('a')] }).analyzed).toBe(6)
    expect(buildDashboardView({ enabled: true, running: false, store: emptyDashboardStore(), accounts: [conta('a')] }).analyzed).toBe(0)
  })
})

describe('pruneStore, withIgnored e withOpened (CA5)', () => {
  it('fica só o item vivo e os marcos recentes; o original não muda', () => {
    const store = emptyDashboardStore()
    for (const id of ['1', '2', '3']) store.items[itemKey('a', id)] = item('a', id)
    store.ignored.push({ key: ignoreKey('a', '2', 'reply'), at: NOW - 400 * DIA_MS })
    store.opened.push({ key: itemKey('a', '1'), at: NOW - DIA_MS })
    const antes = structuredClone(store)
    const out = pruneStore(store, { now: NOW, liveKeys: new Set([itemKey('a', '1')]) })
    expect(Object.keys(out.items)).toEqual([itemKey('a', '1')])
    expect(out.ignored).toEqual([])
    expect(out.opened).toHaveLength(1)
    expect(store).toEqual(antes)
  })

  it('ignorar e abrir não duplicam a chave e não mudam o original', () => {
    const store = emptyDashboardStore()
    const um = withIgnored(store, 'a', '1', 'move', NOW)
    const dois = withIgnored(um, 'a', '1', 'move', NOW + 1)
    expect(dois.ignored).toEqual([{ key: 'a:1:move', at: NOW }])
    expect(withIgnored(dois, 'a', '1', 'reply', NOW).ignored).toHaveLength(2)
    expect(withOpened(withOpened(store, 'a', '1', NOW), 'a', '1', NOW + 1).opened).toEqual([{ key: 'a:1', at: NOW }])
    expect(store).toEqual(emptyDashboardStore())
  })
})

describe('clampModelItem (CA6, R6)', () => {
  it('importância fora de 1–5 descarta o item; textos cortados; resposta só com needsReply; mover sem pasta vira null', () => {
    expect(clampModelItem({ importance: 7 })).toBeNull()
    expect(clampModelItem({ importance: 0 })).toBeNull()
    expect(clampModelItem({ importance: 2.5 })).toBeNull()
    expect(clampModelItem({ reason: 'sem importância' })).toBeNull()
    expect(clampModelItem(null)).toBeNull()
    const a = clampModelItem({ importance: 3, reason: 'x'.repeat(200), needsReply: false, reply: 'oi' })
    expect(a?.reason).toHaveLength(140)
    expect(a?.reply).toBeNull()
    expect(clampModelItem({ importance: 2, move: { folder: '' } })?.move).toBeNull()
    expect(clampModelItem({ importance: 5, needsReply: true, reply: 'y'.repeat(1500), move: { folder: 'Clientes/ABF', reason: 'z'.repeat(300) } })).toEqual({
      importance: 5,
      reason: '',
      needsReply: true,
      reply: 'y'.repeat(1200),
      move: { folder: 'Clientes/ABF', reason: 'z'.repeat(140) },
    })
  })

  it('emoji: o corte mede como o esquema (UTF-16) e não parte o par substituto', () => {
    const out = clampModelItem({ importance: 4, reason: '😀'.repeat(200), needsReply: true, reply: '😀'.repeat(1000), move: { folder: 'X', reason: 'a😀'.repeat(100) } })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.reason.length).toBeLessThanOrEqual(140)
    expect(out.reply?.length).toBeLessThanOrEqual(1200)
    expect(out.move?.reason.length).toBeLessThanOrEqual(140)
    // Nenhuma metade solta no fim.
    for (const text of [out.reason, out.reply ?? '', out.move?.reason ?? '']) expect(text).toBe(Array.from(text).join(''))
    expect(out.reason).toBe('😀'.repeat(70))
    expect(out.move?.reason.length).toBe(139)
    const parsed = EmailDashboardItemSchema.safeParse({ ...out, accountId: 'a', messageKey: '1', messageId: null, analyzedAt: NOW, model: 'haiku' })
    expect(parsed.success).toBe(true)
  })

  it('esquemas: store vazio passa; versão 2 não; a saída do modelo exige ref e importance', () => {
    expect(EmailDashboardStoreSchema.safeParse(emptyDashboardStore()).success).toBe(true)
    expect(EmailDashboardStoreSchema.safeParse({ ...emptyDashboardStore(), version: 2 }).success).toBe(false)
    expect(EmailDashboardModelOutputSchema.safeParse({ items: [{ ref: 'm1', importance: 3, move: null }] }).success).toBe(true)
    expect(EmailDashboardModelOutputSchema.safeParse({ items: [{ importance: 3 }] }).success).toBe(false)
  })
})

describe('rotas do Painel (CA9)', () => {
  it('caminho do Painel e o reconhecimento; as rotas de pasta não mudam', () => {
    expect(emailPainelPath()).toBe('/email/painel')
    expect(EMAIL_PAINEL_PATH).toBe('/email/painel')
    expect(isEmailPainelPath('/email/painel')).toBe(true)
    expect(isEmailPainelPath('/email/painel/')).toBe(true)
    expect(isEmailPainelPath('/email/abc/entrada')).toBe(false)
    expect(isEmailPainelPath('/email/painel/entrada')).toBe(false)
    expect(emailPath('abc', 'inbox')).toBe('/email/abc/entrada')
    const state: EmailNavigationState = { compose: { replyTo: { messageKey: '12', mailbox: 'INBOX' }, text: 'Olá' } }
    expect(state.compose?.replyTo?.messageKey).toBe('12')
    const antigo: EmailNavigationState = { compose: { to: ['a@b.com'], subject: 'Oi' } }
    expect(antigo.compose?.to).toEqual(['a@b.com'])
  })
})
