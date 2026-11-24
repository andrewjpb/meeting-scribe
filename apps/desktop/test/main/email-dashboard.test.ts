// Contrato 156 (CA1 a CA9): o serviço do Painel de e-mail com o cache do email falso em memória, o store de verdade numa
// pasta temporária, os lotes de verdade (`batches.json`) e o modelo falso: a mesma resposta determinística do `claude`
// falso do smoke (`fake-email-dashboard.mjs`). Também a montagem do pedido e a leitura da resposta.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DASHBOARD_LIMITS, emptyDashboardStore, type EmailDashboardStore, type EmailDashboardView } from '../../src/shared/email-dashboard'
import type { EmailBody, EmailMessage } from '../../src/shared/email'
import type { EmailBatch } from '../../src/shared/email-organize'
import { buildEmailDashboardPrompt, EMAIL_DASHBOARD_PROMPT_START, parseEmailDashboardOutput } from '../../src/main/claude-cli/email-dashboard'
import type { OneShotResult } from '../../src/main/claude-cli/summary'
import { createEmailBatchStore, type EmailBatchStore } from '../../src/main/email/batches'
import { DASHBOARD_MOVE_ERRORS, DASHBOARD_RUN_FAILED, DASHBOARD_RUN_LOCKED, DASHBOARD_SCHEDULE, createEmailDashboardService, dashboardRunError, type EmailDashboardDeps, type EmailDashboardOneShotRequest } from '../../src/main/email/dashboard'
import { createEmailDashboardStore, type EmailDashboardStoreApi } from '../../src/main/email/dashboard-store'
import type { EmailCache } from '../../src/main/email/export'
// @ts-expect-error a resposta falsa é um script .mjs sem tipos (a mesma do `claude` falso do smoke)
import { FAKE_EMAIL_DASHBOARD_REPLY, fakeEmailDashboard } from '../fixtures/fake-email-dashboard.mjs'

const HORA = 3_600_000
const NOW = new Date(2026, 10, 23, 10, 0, 0).getTime()
const SUBJECT = 'Assunto sigiloso'
const SENDER = 'remetente.secreto@cliente.example'
/** Ids de conta no formato do app (o `batches.json` só aceita esse). */
const IMAP = '11111111-1111-4111-8111-111111111111'
const POP3 = '22222222-2222-4222-8222-222222222222'

function message(accountId: string, n: number, uid: number | null, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: uid === null ? `uidl-${n}` : String(uid),
    accountId,
    mailbox: 'INBOX',
    uid,
    seen: false,
    flagged: false,
    answered: false,
    from: [{ name: `Pessoa ${n}`, address: SENDER }],
    to: [{ name: null, address: 'eu@lap.example' }],
    cc: [],
    subject: `${SUBJECT} ${n}`,
    date: NOW - HORA - n * 60_000,
    messageId: `<m${n}@${accountId}>`,
    inReplyTo: null,
    references: [],
    ...overrides,
  }
}

function cache(accountId: string, protocol: 'imap' | 'pop3', inbox: EmailMessage[]): EmailCache {
  return {
    status: {
      account: {
        id: accountId,
        address: `${protocol}@lap.example`,
        name: null,
        username: `${protocol}@lap.example`,
        incoming: { host: 'mail.lap.example', port: 993, security: 'tls', protocol },
        outgoing: { host: 'mail.lap.example', port: 465, security: 'tls' },
        deleteFromServer: false,
      },
      state: 'connected',
      error: null,
      sentMailbox: 'Sent',
    },
    inbox,
    sent: [],
    uidValidity: protocol === 'imap' ? '7' : null,
  }
}

const FOLDERS = [
  { path: 'INBOX', name: 'INBOX', specialUse: null, delimiter: '/' },
  { path: 'Newsletters', name: 'Newsletters', specialUse: null, delimiter: '/' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent', delimiter: '/' },
]

/** A resposta do `claude` falso, como o motor devolve. */
const fakeAnswer = (request: EmailDashboardOneShotRequest): OneShotResult<string> => ({ ok: true, content: fakeEmailDashboard(request.input), costUsd: 0.0012, durationMs: 5 })

interface Harness {
  service: ReturnType<typeof createEmailDashboardService>
  store: EmailDashboardStoreApi
  batches: EmailBatchStore
  caches: EmailCache[]
  calls: EmailDashboardOneShotRequest[]
  moves: { accountId: string; fromPath: string; uids: readonly number[]; toPath: string }[]
  loads: string[]
  logs: string[]
  changes: EmailDashboardView[]
  settings: { enabled: boolean; model: 'haiku' | 'sonnet' }
  state: { locked: boolean; online: boolean; now: number }
}

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'email-dashboard-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

function harness(input: {
  caches: EmailCache[]
  answer?: (request: EmailDashboardOneShotRequest, index: number) => Promise<OneShotResult<string>>
  store?: EmailDashboardStoreApi
  loadBody?: (message: EmailMessage) => EmailBody | null
  callTimeoutMs?: number
  /** A listagem da conta IMAP (o `LIST` guardado e o pedido agora); sem ela, `FOLDERS`. */
  folders?: typeof FOLDERS
}): Harness {
  const store = input.store ?? createEmailDashboardStore(join(dir, 'email'))
  const batches = createEmailBatchStore(join(dir, 'email'), () => h.state.now)
  const h: Harness = {
    service: null as unknown as Harness['service'],
    store,
    batches,
    caches: input.caches,
    calls: [],
    moves: [],
    loads: [],
    logs: [],
    changes: [],
    settings: { enabled: true, model: 'haiku' },
    state: { locked: false, online: true, now: NOW },
  }
  const deps: EmailDashboardDeps = {
    store,
    email: {
      cached: async () => structuredClone(h.caches),
      cachedFolders: (accountId) => (accountId === IMAP ? (input.folders ?? FOLDERS) : null),
      listFolders: async (accountId) => (accountId === IMAP ? (input.folders ?? FOLDERS) : null),
      cachedBody: async () => null,
      loadBody: async (_accountId, msg) => {
        h.loads.push(msg.id)
        return input.loadBody?.(msg) ?? null
      },
      moveMessages: async (accountId, fromPath, uids, toPath) => {
        h.moves.push({ accountId, fromPath, uids, toPath })
        return { ok: true, moved: uids.map((uid) => ({ fromUid: uid, toUid: uid + 100 })), uidValidity: '9' }
      },
      knownContacts: async () => new Set<string>(),
    },
    batches: {
      record: async (batch: EmailBatch) => {
        await batches.mutate((list) => ({ batches: [batch, ...list], value: null }))
        return batch.id
      },
    },
    settings: async () => ({ emailDashboard: { ...h.settings } }),
    runOneShot: (request) => {
      const index = h.calls.length
      h.calls.push(request)
      return input.answer ? input.answer(request, index) : Promise.resolve(fakeAnswer(request))
    },
    isLocked: () => h.state.locked,
    isOnline: () => h.state.online,
    now: () => h.state.now,
    log: (line) => void h.logs.push(line),
    onChanged: (view) => void h.changes.push(view),
    ...(input.callTimeoutMs ? { callTimeoutMs: input.callTimeoutMs } : {}),
  }
  h.service = createEmailDashboardService(deps)
  return h
}

/** CA1: a conta IMAP com 6 mensagens e a POP3 com 4. */
const twoAccounts = (): EmailCache[] => [
  cache(
    IMAP,
    'imap',
    Array.from({ length: 6 }, (_, index) => message(IMAP, index + 1, index + 1)),
  ),
  cache(
    POP3,
    'pop3',
    Array.from({ length: 4 }, (_, index) => message(POP3, index + 11, null)),
  ),
]

async function runToEnd(h: Harness): Promise<{ started: boolean; running: boolean }> {
  const result = await h.service.run('manual')
  await h.service.settled()
  return result
}

describe('passada (contrato 156)', () => {
  it('CA1: 2 contas, uma chamada por conta, 10 itens; respostas e mover só da conta IMAP', async () => {
    const h = harness({ caches: twoAccounts() })
    expect(await runToEnd(h)).toEqual({ started: true, running: true })
    const store = await h.store.load()
    expect(Object.keys(store.items)).toHaveLength(10)
    expect(store.lastRun).toMatchObject({ at: NOW, model: 'haiku', analyzed: 10, error: null })
    expect(store.lastRun?.costUsd).toBeCloseTo(0.0024)
    expect(h.calls).toHaveLength(2)
    expect(h.calls.every((call) => call.purpose === 'email-dashboard' && call.model === 'haiku' && call.timeoutMs === DASHBOARD_LIMITS.callTimeoutMs)).toBe(true)
    expect(h.calls.every((call) => call.systemPrompt.startsWith(EMAIL_DASHBOARD_PROMPT_START))).toBe(true)
    const view = await h.service.view()
    expect(view.replies).toHaveLength(5)
    expect(view.replies.every((row) => row.reply === FAKE_EMAIL_DASHBOARD_REPLY)).toBe(true)
    expect(view.moves).toHaveLength(1)
    expect(view.moves[0]).toMatchObject({ accountId: IMAP, folder: 'Newsletters' })
    expect(view.moves[0]?.rows).toHaveLength(3)
    expect(view.moves.flatMap((group) => group.rows).some((row) => row.accountId === POP3)).toBe(false)
    // R8: a visão nova vai às janelas no fim (e no começo, com "analisando").
    expect(h.changes.at(-1)?.running).toBe(false)
    expect(h.changes.some((change) => change.running)).toBe(true)
    // R7: uma linha, só números e o modelo.
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0]).toMatch(/^email-dashboard: contas=2 analisadas=10 baixadas=\d+ chamadas=2 falhas=0 modelo=haiku custo=0\.0024 ms=\d+$/)
  })

  it('CA2: sem mensagem nova, a segunda passada não chama o modelo e analisa 0', async () => {
    const h = harness({ caches: twoAccounts() })
    await runToEnd(h)
    h.calls.length = 0
    h.state.now = NOW + 60_000
    await runToEnd(h)
    expect(h.calls).toHaveLength(0)
    const store = await h.store.load()
    expect(store.lastRun).toMatchObject({ at: NOW + 60_000, analyzed: 0, error: null })
    expect(Object.keys(store.items)).toHaveLength(10)
    // Contrato 170 (CA2): a visão conta o que está analisado, não a última passada.
    expect((await h.service.view()).analyzed).toBe(10)
  })

  it('CA3: desligada, não começa e o modelo não é chamado', async () => {
    const h = harness({ caches: twoAccounts() })
    h.settings.enabled = false
    expect(await runToEnd(h)).toEqual({ started: false, running: false })
    expect(h.calls).toHaveLength(0)
    expect((await h.store.load()).lastRun).toBeNull()
  })

  it('CA4: com uma passada em curso, outra não começa; o modelo recebe só as chamadas da primeira', async () => {
    let release: (value: OneShotResult<string>) => void = () => undefined
    const h = harness({
      caches: [twoAccounts()[0] as EmailCache],
      answer: (request) =>
        new Promise((resolve) => {
          release = () => resolve(fakeAnswer(request))
        }),
    })
    expect(await h.service.run('manual')).toEqual({ started: true, running: true })
    await vi.waitFor(() => expect(h.calls).toHaveLength(1))
    expect(await h.service.run('manual')).toEqual({ started: false, running: true })
    expect(await h.service.run('daily')).toEqual({ started: false, running: true })
    expect((await h.service.view()).running).toBe(true)
    release({ ok: true, content: '', costUsd: null, durationMs: null })
    await h.service.settled()
    expect(h.calls).toHaveLength(1)
    expect((await h.store.load()).lastRun?.analyzed).toBe(6)
  })

  it('CA5: o lote que estoura o prazo não leva o outro; o erro é o texto fixo, sem assunto nem remetente', async () => {
    const h = harness({
      caches: twoAccounts(),
      callTimeoutMs: 30,
      // A primeira chamada nunca volta (o prazo a cancela); a segunda responde.
      answer: (request, index) => (index === 0 ? new Promise(() => undefined) : Promise.resolve(fakeAnswer(request))),
    })
    await runToEnd(h)
    const store = await h.store.load()
    expect(h.calls).toHaveLength(2)
    expect(Object.keys(store.items).sort()).toEqual([11, 12, 13, 14].map((n) => `${POP3}:uidl-${n}`))
    expect(store.lastRun?.analyzed).toBe(4)
    expect(store.lastRun?.error).toBe(dashboardRunError(1))
    expect(store.lastRun?.error).not.toContain(SUBJECT)
    expect(store.lastRun?.error).not.toContain(SENDER)
    expect(h.logs.join('\n')).not.toMatch(new RegExp(`${SUBJECT}|${SENDER}|Pessoa`))
    expect(h.logs[0]).toContain('falhas=1')
    // O que falhou volta na próxima passada.
    h.calls.length = 0
    h.state.now = NOW + 1000
    await runToEnd(h)
    expect(h.calls).toHaveLength(1)
  })

  it('CA6: 40 mensagens sem corpo: no máximo 30 baixadas; as outras 10 vão sem prévia', async () => {
    const inbox = Array.from({ length: 40 }, (_, index) => message(IMAP, index + 1, index + 1))
    const h = harness({ caches: [cache(IMAP, 'imap', inbox)], loadBody: (msg) => ({ text: `Corpo baixado ${msg.id}`, html: null, attachments: [] }) })
    await runToEnd(h)
    expect(h.loads).toHaveLength(DASHBOARD_LIMITS.bodyDownloadsPerAccount)
    const prompts = h.calls.map((call) => call.input).join('\n')
    expect(h.calls).toHaveLength(3)
    expect(prompts.match(/previa: sem texto baixado/g)).toHaveLength(10)
    expect(prompts.match(/Corpo baixado/g)).toHaveLength(30)
    expect(h.logs[0]).toContain('baixadas=30')
  })

  it('bloquear no meio: os lotes gravados ficam e nada mais vai ao modelo', async () => {
    const inbox = Array.from({ length: 40 }, (_, index) => message(IMAP, index + 1, index + 1))
    const h = harness({
      caches: [cache(IMAP, 'imap', inbox)],
      answer: (request, index) => {
        if (index === 0) h.state.locked = true
        return Promise.resolve(fakeAnswer(request))
      },
    })
    await runToEnd(h)
    expect(h.calls).toHaveLength(1)
    const store = await h.store.load()
    expect(Object.keys(store.items)).toHaveLength(DASHBOARD_LIMITS.perCall)
    expect(store.lastRun).toMatchObject({ at: NOW, analyzed: DASHBOARD_LIMITS.perCall, error: DASHBOARD_RUN_LOCKED })
    expect(h.logs[0]).toContain('bloqueada=1')
  })

  it('a passada que lança (disco) ainda grava o lastRun com o erro fixo; o agendador não repete no dia', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const memory = memoryStore(emptyDashboardStore())
    let falhas = 1
    // A gravação do primeiro lote falha (disco cheio); a do `lastRun` passa.
    const store: EmailDashboardStoreApi = {
      ...memory,
      update: (fn) => (falhas-- > 0 ? Promise.reject(new Error('ENOSPC')) : memory.update(fn)),
    }
    const h = harness({ caches: [cache(IMAP, 'imap', [message(IMAP, 1, 1)])], store })
    h.state.now = NOW + 5000
    await runToEnd(h)
    expect(h.calls).toHaveLength(1)
    expect((await memory.load()).lastRun).toMatchObject({ at: NOW + 5000, analyzed: 0, error: DASHBOARD_RUN_FAILED })
    expect(h.logs).toEqual(['email-dashboard: a passada parou com erro'])
    const stop = h.service.startDailyScheduler()
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.firstCheckMs + DASHBOARD_SCHEDULE.everyMs * 2)
    await h.service.settled()
    expect(h.calls).toHaveLength(1)
    stop()
  })

  it('CA8: ignorar a resposta tira a linha; a reanálise mantém needsReply, mas a visão segue sem ela', async () => {
    const h = harness({ caches: [twoAccounts()[0] as EmailCache] })
    await runToEnd(h)
    const before = await h.service.view()
    const row = before.replies[0]
    if (!row) throw new Error('sem resposta')
    const after = await h.service.ignore(IMAP, row.messageKey, 'reply')
    expect(after.replies.some((item) => item.messageKey === row.messageKey)).toBe(false)
    expect(after.replies).toHaveLength(before.replies.length - 1)
    expect((await h.store.load()).ignored.map((mark) => mark.key)).toContain(`${IMAP}:${row.messageKey}:reply`)
    // A mensagem "muda" (data depois da análise): volta ao modelo, que de novo diz que pede resposta.
    h.state.now = NOW + 2 * HORA
    const target = h.caches[0]?.inbox.find((item) => item.id === row.messageKey)
    if (!target) throw new Error('sem mensagem')
    target.date = NOW + HORA
    h.calls.length = 0
    await runToEnd(h)
    expect(h.calls).toHaveLength(1)
    expect((await h.store.load()).items[`${IMAP}:${row.messageKey}`]?.needsReply).toBe(true)
    expect((await h.service.view()).replies.some((item) => item.messageKey === row.messageKey)).toBe(false)
  })

  it('abrir a resposta marca a linha como aberta', async () => {
    const h = harness({ caches: [twoAccounts()[0] as EmailCache] })
    await runToEnd(h)
    const row = (await h.service.view()).replies[0]
    if (!row) throw new Error('sem resposta')
    const view = await h.service.markOpened(IMAP, row.messageKey)
    expect(view.replies.find((item) => item.messageKey === row.messageKey)?.opened).toBe(true)
  })
})

describe('conta na visão (contrato 170, CA1)', () => {
  it('a conta aparece pelo nome; o endereço fica em `address`; sem nome, o endereço', async () => {
    const caches = twoAccounts()
    const [imap] = caches
    if (!imap) throw new Error('sem conta')
    imap.status.account = { ...imap.status.account, name: 'Andrew Teste', address: 'andrew.teste@lap.example' }
    const view = await harness({ caches }).service.view()
    expect(view.accounts.map((conta) => [conta.name, conta.address])).toEqual([
      ['Andrew Teste', 'andrew.teste@lap.example'],
      ['pop3@lap.example', 'pop3@lap.example'],
    ])
  })

  it('o pedido ao modelo leva a conta pelo nome; sem nome, o endereço', async () => {
    const caches = twoAccounts()
    const [imap] = caches
    if (!imap) throw new Error('sem conta')
    imap.status.account = { ...imap.status.account, name: 'Andrew Teste', address: 'andrew.teste@lap.example' }
    const h = harness({ caches })
    await runToEnd(h)
    const conta = (input: string): string => /<conta>\n?([^<]*)<\/conta>/.exec(input)?.[1]?.trim() ?? ''
    expect(h.calls.map((call) => conta(call.input))).toEqual(['Andrew Teste', 'pop3@lap.example'])
  })
})

describe('mover (contrato 156, CA7)', () => {
  it('move as 3 de uma vez, grava o lote do painel com o Desfazer de sempre e tira os itens', async () => {
    const h = harness({ caches: twoAccounts() })
    await runToEnd(h)
    const group = (await h.service.view()).moves[0]
    const keys = group?.rows.map((row) => row.messageKey) ?? []
    expect(keys).toHaveLength(3)
    h.changes.length = 0
    const result = await h.service.applyMove(IMAP, 'Newsletters', keys)
    expect(result.moved).toBe(3)
    expect(h.moves).toEqual([{ accountId: IMAP, fromPath: 'INBOX', uids: keys.map(Number), toPath: 'Newsletters' }])
    const batch = await h.batches.get(result.batchId)
    expect(batch).toMatchObject({ accountId: IMAP, origem: 'painel', state: 'done' })
    expect(batch?.items.map((item) => [item.fromPath, item.fromUid, item.fromUidValidity, item.toPath, item.toUid, item.status])).toEqual(
      keys.map((key) => ['INBOX', Number(key), '7', 'Newsletters', Number(key) + 100, 'moved']),
    )
    // Nada de conteúdo de e-mail no lote do painel.
    expect(JSON.stringify(batch)).not.toMatch(new RegExp(`${SUBJECT}|${SENDER}|Motivo de teste`))
    const store = await h.store.load()
    for (const key of keys) expect(store.items[`${IMAP}:${key}`]).toBeUndefined()
    expect(h.changes).toHaveLength(1)
  })

  // Contrato 173 (CA1): a origem é sempre `INBOX` (o nome canônico do IMAP e o único que o serviço reconhece como a
  // entrada), mesmo quando a listagem a traz como "Caixa de entrada" (Zoho, de uso `\Inbox`, sem `INBOX`).
  it.each([
    ['com a Caixa de Entrada em "Caixa de entrada"', [{ path: 'Caixa de entrada', name: 'Caixa de entrada', specialUse: '\\Inbox', delimiter: '/' }, ...FOLDERS.slice(1)], 'INBOX'],
    ['com a INBOX (Gmail, servidor falso)', FOLDERS, 'INBOX'],
    ['sem a Caixa de Entrada na listagem', FOLDERS.slice(1), 'INBOX'],
  ])('%s: move e grava o lote com a origem INBOX', async (_name, folders, fromPath) => {
    const h = harness({ caches: twoAccounts(), folders })
    await runToEnd(h)
    const keys = (await h.service.view()).moves[0]?.rows.map((row) => row.messageKey) ?? []
    expect(keys).toHaveLength(3)
    const result = await h.service.applyMove(IMAP, 'Newsletters', keys)
    expect(h.moves).toEqual([{ accountId: IMAP, fromPath, uids: keys.map(Number), toPath: 'Newsletters' }])
    const batch = await h.batches.get(result.batchId)
    expect(batch?.items.map((item) => item.fromPath)).toEqual([fromPath, fromPath, fromPath])
  })

  it.each([
    ['conta POP3', POP3, 'Newsletters', ['uidl-11'], DASHBOARD_MOVE_ERRORS.pop3],
    ['para a INBOX', IMAP, 'INBOX', ['1'], DASHBOARD_MOVE_ERRORS.folder],
    ['para os Enviados', IMAP, 'Sent', ['1'], DASHBOARD_MOVE_ERRORS.folder],
    ['pasta que não existe', IMAP, 'Inexistente', ['1'], DASHBOARD_MOVE_ERRORS.folder],
    ['mensagem fora da INBOX', IMAP, 'Newsletters', ['1', '999'], DASHBOARD_MOVE_ERRORS.message],
    ['conta que não existe', '33333333-3333-4333-8333-333333333333', 'Newsletters', ['1'], DASHBOARD_MOVE_ERRORS.account],
  ])('%s: lança o texto fixo e nada é movido', async (_name, accountId, folder, keys, error) => {
    const h = harness({ caches: twoAccounts() })
    await expect(h.service.applyMove(accountId, folder, keys)).rejects.toThrow(error)
    expect(h.moves).toEqual([])
    expect(await h.batches.list()).toEqual([])
  })
})

/** Store em memória (o relógio falso não espera o disco). */
function memoryStore(initial: EmailDashboardStore): EmailDashboardStoreApi {
  let data = structuredClone(initial)
  return {
    load: async () => structuredClone(data),
    save: async (store) => {
      data = structuredClone(store)
    },
    update: async (fn) => {
      data = fn(structuredClone(data))
      return structuredClone(data)
    },
    removeAccount: async () => undefined,
    clear: async () => {
      data = emptyDashboardStore()
    },
  }
}

describe('agendamento diário (contrato 156, CA9)', () => {
  it('roda uma vez no dia novo; não repete no mesmo dia; bloqueado não roda', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const ontem = new Date(2026, 10, 22, 23, 0, 0).getTime()
    const store = memoryStore({ ...emptyDashboardStore(), lastRun: { at: ontem, model: 'haiku', analyzed: 0, costUsd: null, error: null } })
    const h = harness({ caches: [cache(IMAP, 'imap', [message(IMAP, 1, 1)])], store })
    const stop = h.service.startDailyScheduler()
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.firstCheckMs - 1)
    expect(h.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await h.service.settled()
    expect(h.calls).toHaveLength(1)
    expect((await store.load()).lastRun?.at).toBe(NOW)
    // Mesmo dia: a checagem seguinte não roda (nem com mensagem nova).
    h.caches[0]?.inbox.push(message(IMAP, 2, 2, { date: NOW - 1000 }))
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.everyMs)
    await h.service.settled()
    expect(h.calls).toHaveLength(1)
    // Outro dia, mas bloqueado (ou sem rede): não roda.
    h.state.now = NOW + 24 * HORA
    h.state.locked = true
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.everyMs)
    h.state.locked = false
    h.state.online = false
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.everyMs)
    await h.service.settled()
    expect(h.calls).toHaveLength(1)
    // Desbloqueado e online: roda.
    h.state.online = true
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.everyMs)
    await h.service.settled()
    expect(h.calls).toHaveLength(2)
    stop()
    h.state.now += 24 * HORA
    await vi.advanceTimersByTimeAsync(DASHBOARD_SCHEDULE.everyMs * 2)
    expect(h.calls).toHaveLength(2)
  })
})

describe('pedido e leitura da passada (contrato 156)', () => {
  const base = {
    accountName: 'eu@lap.example',
    ownAddresses: ['eu@lap.example'],
    folders: [
      { path: 'Arquivo', name: 'Arquivo' },
      { path: 'Newsletters', name: 'Newsletters' },
    ],
    archive: { path: 'Arquivo' },
  }
  const msg = (ref: string, preview: string | null) => ({ ref, from: 'Ana <ana@x.example>', to: ['eu@lap.example'], subject: 'Oi\nlinha', dateIso: '2026-11-23T10:00:00.000Z', seen: false, answered: false, pending: true, knownContact: true, preview })

  it('corta a prévia em 1.500 caracteres, escapa o material e põe o arquivo à parte', () => {
    const prompt = buildEmailDashboardPrompt({ ...base, messages: [msg('e1', `${'a'.repeat(1600)}`), msg('e2', null), msg('e3', '<script>')] })
    expect(prompt).toContain(`previa:\n${'a'.repeat(DASHBOARD_LIMITS.previewChars)}\n</email>`)
    expect(prompt).not.toContain('a'.repeat(DASHBOARD_LIMITS.previewChars + 1))
    expect(prompt).toContain('previa: sem texto baixado')
    expect(prompt).toContain('&lt;script&gt;')
    expect(prompt).toContain('assunto: Oi linha')
    expect(prompt).toContain('<pastas>\nNewsletters\n</pastas>')
    expect(prompt).toContain('<arquivo>\nArquivo\n</arquivo>')
  })

  it('pasta fora da lista vira null, ref desconhecido ou repetido sai, texto quebrado dá []', () => {
    const context = { refs: new Set(['e1', 'e2', 'e3']), folders: new Set(['Newsletters', 'A & B']) }
    const text = JSON.stringify({
      items: [
        { ref: 'e1', importance: 4, reason: 'r', needsReply: true, reply: 'Olá', move: { folder: 'Lixeira', reason: 'x' } },
        { ref: 'e2', importance: 2, move: { folder: 'A &amp; B', reason: 'x' } },
        { ref: 'e9', importance: 5 },
        { ref: 'e1', importance: 1 },
        { ref: 'e3', importance: 9 },
      ],
    })
    expect(parseEmailDashboardOutput(`\`\`\`json\n${text}\n\`\`\``, context)).toEqual([
      { ref: 'e1', item: { importance: 4, reason: 'r', needsReply: true, reply: 'Olá', move: null } },
      { ref: 'e2', item: { importance: 2, reason: '', needsReply: false, reply: null, move: { folder: 'A & B', reason: 'x' } } },
    ])
    expect(parseEmailDashboardOutput('não sei', context)).toEqual([])
    expect(parseEmailDashboardOutput('{"items": "x"}', context)).toEqual([])
  })
})
