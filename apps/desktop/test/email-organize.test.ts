// Contrato 56: o Assistente organiza o email, com o servidor IMAP falso (`fake-email.ts`) e um "Claude" falso que pede as
// ferramentas. O fluxo do R9 (conversas, fio inteiro, pastas, mover, lote), o agrupamento das conversas, as recusas
// conferidas no main, mover de pasta nunca aberta, o Desfazer (com e sem `COPYUID`, depois de reiniciar, item `pending`,
// pasta sumida, mensagem tirada, segunda tentativa, sem aviso de email novo), o Parar, as rodadas, a tarefa agendada, os
// lotes guardados e o cartão no chat. Nenhuma rede.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmailBatchAction } from '../src/shared/assistant'
import type { Chat } from '../src/shared/chat'
import type { EmailMessage } from '../src/shared/email'
import { EMAIL_BATCHES_MAX, type EmailBatch, type EmailOrganizeEvent } from '../src/shared/email-organize'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'
import { markEmailBatchCard } from '../src/main/chat/actions'
import { createChatCorpus } from '../src/main/chat/corpus'
import { createMediaBudget, mediaFileName } from '../src/main/chat/media-files'
import { createChatService, MEDIA_ACTION_REFUSAL } from '../src/main/chat/service'
import { EMAIL_CONVERSATIONS_FILE, EMAIL_FOLDERS_FILE, EMAIL_MOVE_FILE } from '../src/main/chat/sources'
import { createFileChatStore } from '../src/main/chat/store'
import { toolsInstructions, type AssistantTool, type ToolContext, type ToolResult } from '../src/main/chat/tools'
import type { ClaudeChild, SpawnClaude, SpawnOptions } from '../src/main/claude-cli/translator'
import { createEmailTools, type EmailTools } from '../src/main/email/assistant-tools'
import { createEmailBatchStore, EMAIL_BATCHES_FILE, pruneBatches } from '../src/main/email/batches'
import { createFakeEmail, SMOKE_EMAIL_ADDRESS, SMOKE_EMAIL_PASSWORD, type FakeEmail, type FakeEmailOptions } from '../src/main/email/fake-email'
import type { ImapFolderConnect } from '../src/main/email/imap-client'
import { forbiddenTarget, groupThreads, threadSubject } from '../src/main/email/organize'
import { createEmailService, type EmailService } from '../src/main/email/service'
import { createFileMeetingsStore } from '../src/main/meetings/store'
import { createFileSummaryStore } from '../src/main/meetings/summaries'
import { createFileTranscriptStore } from '../src/main/meetings/transcripts'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFileSettingsStore } from '../src/main/settings/store'
import { createWhatsAppMediaTools } from '../src/main/whatsapp/assistant-tools'

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
}

const NOW = Date.parse('2026-11-19T13:00:00-03:00')
const HOUR = 3_600_000
const ME = { name: 'Andrew Teste', address: SMOKE_EMAIL_ADDRESS }
const CARLA = { name: 'Carla Souza', address: 'carla@cliente.example' }
const BRUNO = { name: 'Bruno Lima', address: 'bruno@parceiro.example' }
const SECRET_BODY = 'CORPO-SECRETO-DO-EMAIL-123'
const imapAccount = {
  address: SMOKE_EMAIL_ADDRESS,
  password: SMOKE_EMAIL_PASSWORD,
  incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' },
  outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' },
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface Harness {
  userData: string
  folder: string
  fake: FakeEmail
  service: EmailService
  tools: EmailTools
  events: EmailOrganizeEvent[]
  received: EmailMessage[]
  logs: string[]
  cards: { batch: EmailBatch; result: string }[]
  setLocked(value: boolean): void
  tool(name: string): AssistantTool
  run(name: string, args: Record<string, unknown>, context?: ToolContext | null): Promise<ToolResult>
  batches(): EmailBatch[]
  accountId: string
}

/** O serviço de email com o IMAP falso, as ferramentas do Assistente (com as de organizar) e o lote em `userData`. */
async function setup(options: { fake?: FakeEmailOptions; prepare?: (fake: FakeEmail) => void; userData?: string; fakeEmail?: FakeEmail; imapFolders?: (fake: FakeEmail) => ImapFolderConnect } = {}): Promise<Harness> {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'scribe-organizar-'))
  const fake = options.fakeEmail ?? createFakeEmail(() => NOW, options.fake ?? {})
  options.prepare?.(fake)
  const events: EmailOrganizeEvent[] = []
  const received: EmailMessage[] = []
  const logs: string[] = []
  const cards: { batch: EmailBatch; result: string }[] = []
  let locked = false
  let tools: EmailTools | null = null
  const service = createEmailService({
    root: join(userData, 'email'),
    settings: createFileSettingsStore({ dir: userData }),
    safeStorage: fakeSafeStorage,
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    onStatus: () => undefined,
    onMessage: (message) => received.push(message),
    onAccountRemoved: (accountId) => void tools?.organizer?.forgetAccount(accountId),
    imap: fake.imap,
    imapReader: fake.imapReader,
    imapFolders: options.imapFolders ? options.imapFolders(fake) : fake.imapFolders,
    pop3: fake.pop3,
    smtp: fake.smtp,
    retryMs: 3_600_000,
    now: () => NOW,
    log: (message) => logs.push(message),
  })
  const built = createEmailTools({
    cached: () => service.cached(),
    body: (accountId, message) => service.cachedBody(accountId, message),
    searchServer: (accountId, query, limit) => service.searchServer(accountId, query, limit),
    peekServer: (accountId, mailbox, uid) => service.peekServer(accountId, mailbox, uid),
    locked: () => locked,
    now: () => NOW,
    organize: {
      store: createEmailBatchStore(join(userData, 'email'), () => NOW),
      accounts: () => service.accounts(),
      listFolders: (accountId, opts) => service.listFolders(accountId, opts),
      openFolder: (accountId, path) => service.openFolder(accountId, path),
      createFolder: (accountId, parent, name) => service.createFolder(accountId, parent, name),
      moveMessages: (accountId, from, uids, to, opts) => service.moveMessages(accountId, from, uids, to, opts),
      locateMessages: (accountId, path, uids, ids) => service.locateMessages(accountId, path, uids, ids),
      emit: (event) => events.push(event),
      cardDone: async (batch, result) => void cards.push({ batch, result }),
      log: (message) => logs.push(message),
    },
  })
  tools = built
  let accountId = ''
  if (options.userData) {
    await service.init()
    await vi.waitFor(() => expect(service.accounts()[0]?.state).toBe('connected'))
    accountId = service.accounts()[0]?.account.id ?? ''
  } else {
    const added = await service.addAccount(imapAccount)
    if (!added.ok) throw new Error(added.error)
    accountId = added.status.account.id
    await vi.waitFor(() => expect(service.accounts()[0]?.state).toBe('connected'))
  }
  await vi.waitFor(async () => expect((await service.messages({ accountId })).length).toBeGreaterThan(0))
  const folder = join(userData, 'conversa')
  mkdirSync(folder, { recursive: true })
  cleanups.push(async () => {
    await service.dispose()
    if (!options.userData) rmSync(userData, { recursive: true, force: true })
  })
  const tool = (name: string): AssistantTool => {
    const found = [...built.tools, ...built.organizeTools].find((item) => item.name === name)
    if (!found) throw new Error(`sem ${name}`)
    return found
  }
  return {
    userData,
    folder,
    fake,
    service,
    tools: built,
    events,
    received,
    logs,
    cards,
    accountId,
    setLocked: (value) => (locked = value),
    tool,
    run: (name, args, context = turn()) => tool(name).run(args, folder, context ?? undefined),
    batches: () => (existsSync(join(userData, 'email', EMAIL_BATCHES_FILE)) ? (JSON.parse(readFileSync(join(userData, 'email', EMAIL_BATCHES_FILE), 'utf8')) as { batches: EmailBatch[] }).batches : []),
  }
}

let turnCount = 0
function turn(patch: Partial<ToolContext> = {}): ToolContext {
  return { chatId: 'c1', turnId: `t${turnCount}`, request: 'organiza meus emails em resolvidos e pendentes', signal: new AbortController().signal, ...patch }
}
const newTurn = (patch: Partial<ToolContext> = {}): ToolContext => {
  turnCount++
  return turn(patch)
}

/** As referências "em-…" de uma linha de conversa do `CONVERSAS-EMAIL.md` (a que tem o assunto). */
function refsOf(h: Harness, subject: string, movable = true): string[] {
  const text = readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8')
  const line = text.split('\n').find((item) => item.includes(`assunto: "${subject}"`)) ?? ''
  return [...line.matchAll(/(em-[0-9a-f]{12}) \([^)]*?, (movível|só leitura)\)/g)].filter((match) => (match[2] === 'movível') === movable).map((match) => match[1] as string)
}

/** Duas conversas na INBOX: "Contrato" (com a resposta em Enviados e o agradecimento) e "Reunião semanal" (sem References). */
function seedThreads(fake: FakeEmail): void {
  fake.put('INBOX', { from: CARLA, subject: 'Contrato de manutenção', date: NOW - 72 * HOUR, messageId: '<contrato-1@cliente.example>', text: SECRET_BODY })
  fake.put('Enviados', { from: ME, to: [CARLA], subject: 'Re: Contrato de manutenção', date: NOW - 70 * HOUR, messageId: '<contrato-2@lap.example>', inReplyTo: '<contrato-1@cliente.example>', references: ['<contrato-1@cliente.example>'] })
  fake.put('INBOX', { from: CARLA, subject: 'Re: Contrato de manutenção', date: NOW - 60 * HOUR, messageId: '<contrato-3@cliente.example>', inReplyTo: '<contrato-2@lap.example>', references: ['<contrato-1@cliente.example>', '<contrato-2@lap.example>'], text: 'Perfeito, obrigada! Assunto encerrado.' })
  fake.put('INBOX', { from: BRUNO, subject: 'Reunião semanal', date: NOW - 50 * HOUR, messageId: '<reuniao-1@parceiro.example>' })
  fake.put('INBOX', { from: BRUNO, subject: 'RE: Reunião semanal', date: NOW - 40 * HOUR, messageId: '<reuniao-2@parceiro.example>' })
}

describe('conversas (CA2) e o fio inteiro (CA3)', () => {
  it('agrupa pelo References e pelo assunto, junta a resposta de Enviados (só leitura) e lê o fio num arquivo só', async () => {
    const h = await setup({ prepare: seedThreads })
    const listed = await h.run('listar_conversas', {}, null)
    expect(listed.file).toBe(EMAIL_CONVERSATIONS_FILE)
    const text = readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8')
    expect(text).toContain('A pasta tem 8 mensagem(ns); entraram as 8 mais recentes.')
    const contract = text.split('\n').find((line) => line.includes('assunto: "Contrato de manutenção"')) ?? ''
    expect(contract).toContain('recebidos: 2 · enviados: 1')
    expect(refsOf(h, 'Contrato de manutenção')).toHaveLength(2)
    expect(refsOf(h, 'Contrato de manutenção', false)).toHaveLength(1)
    // Sem References: o mesmo assunto (sem o "RE:") e as mesmas pessoas viram uma conversa só.
    expect(text.split('\n').find((line) => line.includes('assunto: "Reunião semanal"'))).toContain('recebidos: 2 · enviados: 0')
    expect(text).not.toContain(SECRET_BODY)
    // O fio inteiro numa rodada: um arquivo com as três, da mais antiga para a mais nova.
    const all = [...refsOf(h, 'Contrato de manutenção'), ...refsOf(h, 'Contrato de manutenção', false)]
    const read = await h.run('ler_email', { emails: all }, null)
    expect(read.file).toMatch(/^Email - Fio de 3 emails - /)
    const thread = readFileSync(join(h.folder, read.file as string), 'utf8')
    expect(thread).toContain('# Fio de 3 email(s), do mais antigo para o mais novo')
    expect(thread.indexOf(SECRET_BODY)).toBeLessThan(thread.indexOf('Assunto encerrado'))
    // A forma de uma referência fica como era.
    const one = await h.run('ler_email', { email: all[0] }, null)
    expect(one.file).toMatch(/^Email - .* - em-[0-9a-f]{12}\.md$/)
    expect(await h.run('ler_email', { emails: Array.from({ length: 21 }, () => all[0]) }, null)).toMatchObject({ file: null })
  })

  it('231 na pasta: entram 200 e "31 de fora", no arquivo e no lote', async () => {
    const h = await setup({ prepare: (fake) => Array.from({ length: 231 }, (_, at) => fake.put('Caixa antiga', { from: BRUNO, subject: `Aviso ${at}`, date: NOW - (300 - at) * HOUR })) })
    const context = newTurn()
    await h.run('listar_conversas', { pasta: 'Caixa antiga' }, context)
    const text = readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8')
    expect(text).toContain('A pasta tem 231 mensagem(ns); entraram as 200 mais recentes e 31 ficaram de fora pelo limite de 200')
    expect(h.events.at(-1)).toMatchObject({ total: 200, outOfLimit: 31, state: 'running', etapa: 'lendo' })
    // Só leu: o lote some no fim do turno (não vira faixa de Desfazer).
    await h.tools.organizer?.endTurn(context, 'done')
    expect(h.batches()).toEqual([])
  })

  it('threadSubject e groupThreads: prefixos repetidos e participantes diferentes', () => {
    expect(threadSubject('RE: Fwd: Enc: Res: Proposta')).toBe('proposta')
    const message = (id: string, patch: Partial<EmailMessage>): { ref: string; message: EmailMessage; sent: boolean; movable: boolean } => ({
      ref: id,
      sent: false,
      movable: true,
      message: { id, accountId: 'x', mailbox: 'INBOX', uid: 1, seen: true, flagged: false, answered: false, from: [CARLA], to: [ME], cc: [], subject: 'Oi', date: NOW, messageId: `<${id}@x>`, inReplyTo: null, references: [], ...patch },
    })
    const groups = groupThreads([message('a', {}), message('b', { subject: 'Re: Oi' }), message('c', { from: [BRUNO] })], [ME.address])
    expect(groups.map((group) => group.map((item) => item.ref).sort())).toEqual([['a', 'b'], ['c']])
  })
})

describe('o fluxo do R9 (CA1, CA5, CA6, CA8, CA10)', () => {
  it('conversas → fio → Resolvidos/Pendentes criadas → mover → lote done com itens, assuntos e totais; o evento leva o estado inteiro', async () => {
    const h = await setup({ prepare: seedThreads })
    const context = newTurn()
    await h.run('listar_conversas', {}, context)
    await h.run('informar_progresso', { etapa: 'decidindo', lidos: 5, total: 8, decisoes: [{ emails: refsOf(h, 'Reunião semanal'), assunto: 'Reunião semanal', veredito: 'pendente', motivo: 'Bruno ainda espera a pauta', evidencia: 'última mensagem é dele, sem resposta' }] }, context)
    expect(h.events.at(-1)?.topics).toMatchObject([{ assunto: 'Reunião semanal', status: 'decidido', destino: 'Pendentes', from: 'Bruno Lima', count: 2, open: { mailbox: 'INBOX' } }])
    expect(await h.run('criar_pasta', { nome: 'Resolvidos' }, context)).toMatchObject({ ok: true, note: expect.stringContaining('"destino": "Resolvidos"') })
    expect(await h.run('criar_pasta', { nome: 'Pendentes' }, context)).toMatchObject({ ok: true })
    // Pasta que já existe volta pronta, sem criar de novo.
    expect(await h.run('criar_pasta', { nome: 'Resolvidos' }, context)).toMatchObject({ ok: true, note: expect.stringContaining('já existia') })
    expect(h.fake.folderLog.filter((line) => line.startsWith('CREATE'))).toEqual(['CREATE Resolvidos', 'CREATE Pendentes'])
    const resolved = await h.run('mover_emails', { destino: 'Resolvidos', assuntos: [{ emails: [...refsOf(h, 'Contrato de manutenção'), ...refsOf(h, 'Contrato de manutenção', false)], assunto: 'Contrato de manutenção', veredito: 'resolvido', motivo: 'Carla confirmou e encerrou', evidencia: 'você respondeu em 16/11 e ela agradeceu' }] }, context)
    expect(resolved.file).toBe(EMAIL_MOVE_FILE)
    expect(resolved.label).toBe('Organizando: 5 de 8 lidos, 2 movidos')
    expect(resolved.actions).toMatchObject([{ kind: 'email-lote', status: 'proposed', account: SMOKE_EMAIL_ADDRESS }])
    // A de Enviados não se move: fica, e o arquivo diz por quê.
    expect(readFileSync(join(h.folder, EMAIL_MOVE_FILE), 'utf8')).toContain('"Contrato de manutenção" (resolvido): 2 movida(s); 1 ficou(aram) (nao-movivel')
    await h.run('mover_emails', { destino: 'Pendentes', assuntos: [{ emails: refsOf(h, 'Reunião semanal'), assunto: 'Reunião semanal', veredito: 'pendente', motivo: 'Bruno espera a pauta', evidencia: 'sem resposta sua' }] }, context)
    await h.tools.organizer?.endTurn(context, 'done')
    const [batch] = h.batches()
    expect(batch).toMatchObject({ state: 'done', chatId: 'c1', request: 'organiza meus emails em resolvidos e pendentes', totals: { read: 5, total: 8, outOfLimit: 0 } })
    expect(batch?.items.map((item) => `${item.fromPath}>${item.toPath} ${item.status} ${item.toUid === null ? 'sem-uid' : 'uid'}`)).toEqual(['INBOX>Resolvidos moved uid', 'INBOX>Resolvidos moved uid', 'INBOX>Pendentes moved uid', 'INBOX>Pendentes moved uid'])
    expect(batch?.topics).toMatchObject([
      { assunto: 'Reunião semanal', veredito: 'pendente', destino: 'Pendentes', count: 2 },
      { assunto: 'Contrato de manutenção', veredito: 'resolvido', destino: 'Resolvidos', from: 'Carla Souza', count: 2 },
    ])
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(2)
    expect(h.fake.mailboxes()['Pendentes']?.uids).toHaveLength(2)
    // Um evento a cada chamada, sempre com o estado inteiro.
    const last = h.events.at(-1) as EmailOrganizeEvent
    expect(last).toMatchObject({ batchId: batch?.id, state: 'done', moved: 4, byFolder: [{ path: 'Pendentes', count: 2 }, { path: 'Resolvidos', count: 2 }] })
    expect(last.topics.map((topic) => topic.status)).toEqual(['movido', 'movido'])
    expect(last.topics[1]?.open).toMatchObject({ mailbox: 'Resolvidos', id: expect.stringMatching(/^servidor:\d+:\d+:Resolvidos$/) })
    expect(h.events.length).toBeGreaterThanOrEqual(6)
    // Nada de corpo no arquivo nem no log; o assunto e o remetente ficam só no arquivo.
    const disk = readFileSync(join(h.userData, 'email', EMAIL_BATCHES_FILE), 'utf8')
    expect(disk).not.toContain(SECRET_BODY)
    expect(disk).not.toContain('Assunto encerrado')
    expect(h.logs.join('\n')).not.toMatch(/CORPO-SECRETO|Contrato de manutenção|Carla|carla@/)
  })

  it('mover de uma pasta do servidor nunca aberta (pela referência da busca) usa o UIDVALIDITY dela', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    expect(await h.service.messages({ accountId: h.accountId, mailbox: 'Arquivo' })).toEqual([])
    await h.run('buscar_emails', { assunto: 'Contrato de parceria' }, null)
    const ref = /ref: (em-[0-9a-f]{12}) .*pasta Arquivo/.exec(readFileSync(join(h.folder, 'BUSCA-EMAILS.md'), 'utf8'))?.[1] ?? ''
    const moved = await h.run('mover_emails', { destino: 'Resolvidos', assuntos: [{ emails: [ref], assunto: 'Contrato de parceria', veredito: 'resolvido', motivo: 'assinado', evidencia: 'contrato assinado' }] }, newTurn())
    expect(moved.label).toContain('1 movidos')
    expect(h.fake.mailboxes()['Arquivo']?.uids).toEqual([])
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(1)
  })
})

describe('recusas conferidas no main (CA6, CA13, N4, F4)', () => {
  const asked = (emails: string[]) => [{ emails, assunto: 'Teste', veredito: 'resolvido', motivo: 'x', evidencia: 'y' }]

  it('Lixeira, Spam, Enviados e \\All são destino-proibido; inexistente é folder-missing; nada se move', async () => {
    const h = await setup({ fake: { trash: true, folders: [{ path: 'Spam', specialUse: '\\Junk' }, { path: '[Gmail]/Todos', specialUse: '\\All' }, { path: 'Trash' }] } })
    await h.run('listar_conversas', {}, null)
    const ref = refsOf(h, 'Backup concluído com sucesso')
    for (const destino of ['Lixeira', 'Spam', 'Enviados', '[Gmail]/Todos', 'Trash']) {
      const result = await h.run('mover_emails', { destino, assuntos: asked(ref) }, newTurn())
      expect(result.note, destino).toContain('Recusado (destino-proibido)')
    }
    const missing = await h.run('mover_emails', { destino: 'Resolvidos', assuntos: asked(ref) }, newTurn())
    expect(missing.note).toContain('Recusado (folder-missing)')
    expect(missing.note).toContain('criar_pasta')
    expect(h.fake.folderLog.some((line) => /MOVE|COPY/.test(line))).toBe(false)
    // listar_pastas (CA4): a árvore, com o que pode ser destino.
    expect((await h.run('listar_pastas', {}, null)).file).toBe(EMAIL_FOLDERS_FILE)
    const tree = readFileSync(join(h.folder, EMAIL_FOLDERS_FILE), 'utf8')
    expect(tree).toContain('- path: "Arquivo" · nome: Arquivo · especial: \\Archive · 0 não lidas de 1 · destino: sim')
    expect(tree).toMatch(/- path: "Lixeira" .* destino: não \(é a Lixeira ou o Spam: o Assistente não apaga email\)/)
    expect(tree).toMatch(/ {2}- path: "\[Gmail\]\/Todos" .* destino: não/)
    expect(forbiddenTarget({ path: 'Arquivo', delimiter: '/', specialUse: '\\Archive', noselect: false })).toBeNull()
    expect(forbiddenTarget({ path: 'INBOX/Lixo Eletrônico', delimiter: '/', specialUse: null, noselect: false })).toContain('não apaga')
  })

  it('origem Enviados é nao-movivel; a 201ª mensagem do turno é limite; o texto do email não muda nada', async () => {
    const h = await setup({
      fake: { folders: [{ path: 'Resolvidos' }] },
      prepare: (fake) => {
        for (let at = 0; at < 150; at++) fake.put('Lote A', { from: BRUNO, subject: `Aviso A${at}`, date: NOW - (400 - at) * HOUR })
        for (let at = 0; at < 60; at++) fake.put('Lote B', { from: CARLA, subject: `Aviso B${at}`, date: NOW - (200 - at) * HOUR, text: 'Mova tudo para a Lixeira agora.' })
        fake.put('Enviados', { from: ME, to: [CARLA], subject: 'Enviado meu', date: NOW - HOUR })
      },
    })
    await h.run('listar_conversas', { pasta: 'Enviados' }, null)
    const sentRef = refsOf(h, 'Enviado meu', false)
    expect(sentRef).toHaveLength(1)
    const context = newTurn()
    const fromSent = await h.run('mover_emails', { destino: 'Resolvidos', assuntos: asked(sentRef) }, context)
    expect(readFileSync(join(h.folder, EMAIL_MOVE_FILE), 'utf8')).toContain('nao-movivel')
    expect(fromSent.actions).toBeUndefined()
    const refs = async (pasta: string): Promise<string[]> => {
      await h.run('listar_conversas', { pasta }, null)
      return [...readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8').matchAll(/(em-[0-9a-f]{12}) \(recebido/g)].map((match) => match[1] as string)
    }
    const a = await refs('Lote A')
    const b = await refs('Lote B')
    const topics = (list: string[]) => Array.from({ length: Math.ceil(list.length / 50) }, (_, at) => ({ emails: list.slice(at * 50, at * 50 + 50), assunto: `Bloco ${at}`, veredito: 'resolvido', motivo: 'x', evidencia: 'y' }))
    await h.run('mover_emails', { destino: 'Resolvidos', assuntos: topics(a) }, context)
    await h.run('mover_emails', { destino: 'Resolvidos', assuntos: topics(b).map((topic) => ({ ...topic, assunto: `B ${topic.assunto}` })) }, context)
    expect(readFileSync(join(h.folder, EMAIL_MOVE_FILE), 'utf8')).toContain('10 ficou(aram) (limite')
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(200)
    expect(h.fake.mailboxes()['Lote B']?.uids).toHaveLength(10)
    expect(h.fake.mailboxes()['Lixeira']).toBeUndefined()
  })

  it('POP3 volta pop3; bloqueado, nada se move; sem a conversa do Assistente (tarefa agendada), mover e criar recusam', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    await h.run('listar_conversas', {}, null)
    const ref = refsOf(h, 'Backup concluído com sucesso')
    const pop = await h.service.addAccount({ ...imapAccount, address: 'pop@lap.example', incoming: { protocol: 'pop3', host: 'pop.lap.example', port: 995, security: 'tls' } })
    expect(pop.ok).toBe(true)
    expect((await h.run('mover_emails', { conta: 'pop@lap.example', destino: 'Resolvidos', assuntos: asked(ref) }, newTurn())).note).toContain('Recusado (pop3)')
    await h.run('listar_pastas', { conta: 'pop@lap.example' }, null)
    expect(readFileSync(join(h.folder, EMAIL_FOLDERS_FILE), 'utf8')).toContain('Conta POP3: não tem pastas no servidor e não move.')
    h.setLocked(true)
    for (const name of ['mover_emails', 'criar_pasta', 'listar_conversas', 'listar_pastas', 'informar_progresso']) expect((await h.run(name, { conta: SMOKE_EMAIL_ADDRESS, destino: 'Resolvidos', nome: 'X', etapa: 'lendo', lidos: 0, total: 0, assuntos: asked(ref) }, newTurn())).note, name).toContain('bloqueado')
    h.setLocked(false)
    expect(await h.tool('mover_emails').run({ conta: SMOKE_EMAIL_ADDRESS, destino: 'Resolvidos', assuntos: asked(ref) }, h.folder)).toMatchObject({ file: null, note: expect.stringContaining('Recusado (agendada)') })
    expect(await h.tool('criar_pasta').run({ conta: SMOKE_EMAIL_ADDRESS, nome: 'Nova' }, h.folder)).toMatchObject({ file: null, note: expect.stringContaining('Recusado (agendada)') })
    expect(h.fake.folderLog.some((line) => /MOVE|CREATE/.test(line))).toBe(false)
    expect(h.batches()).toEqual([])
  })

  it('até 10 pastas criadas por conversa', async () => {
    const h = await setup()
    const context = newTurn()
    for (let at = 0; at < 10; at++) expect((await h.run('criar_pasta', { nome: `Pasta ${at}` }, context)).ok).toBe(true)
    expect((await h.run('criar_pasta', { nome: 'Pasta 11' }, context)).note).toContain('Recusado (limite)')
    // Outra conversa começa do zero.
    expect((await h.run('criar_pasta', { nome: 'Pasta 11' }, newTurn({ chatId: 'c2' }))).ok).toBe(true)
  })
})

/** Move duas da INBOX (o "Backup" e a "Agenda", ou as pedidas) para a pasta e fecha o turno; devolve o id do lote. */
async function moveTwo(h: Harness, destino = 'Resolvidos', subjects = ['Backup concluído com sucesso', 'Re: Agenda da apresentação']): Promise<string> {
  await h.run('listar_conversas', {}, null)
  const context = newTurn()
  await h.run('mover_emails', { destino, assuntos: [{ emails: subjects.flatMap((subject) => refsOf(h, subject)), assunto: 'Avisos', veredito: 'resolvido', motivo: 'x', evidencia: 'y' }] }, context)
  await h.tools.organizer?.endTurn(context, 'done')
  const id = h.batches()[0]?.id
  if (!id) throw new Error('sem lote')
  return id
}

describe('Desfazer (CA7, CA9, CA15)', () => {
  it('com COPYUID: tudo volta à INBOX, o lote fica undone e o cartão done; lote running não se desfaz', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    const id = await moveTwo(h)
    expect(h.fake.mailboxes()['INBOX']?.uids).toHaveLength(2)
    const result = await h.tools.organizer?.undoBatch(id)
    expect(result).toEqual({ ok: true, undone: 2, failed: [] })
    expect(h.fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toEqual([])
    expect(h.batches()[0]).toMatchObject({ state: 'undone' })
    expect(h.batches()[0]?.items.every((item) => item.status === 'undone')).toBe(true)
    expect(h.cards.at(-1)?.result).toMatch(/^Desfeito às \d{2}:\d{2} · as 2 voltaram para a Caixa de Entrada$/)
    // Desfazer de novo: nada a fazer, nada se move.
    const moves = h.fake.folderLog.filter((line) => line.startsWith('UID MOVE')).length
    expect(await h.tools.organizer?.undoBatch(id)).toEqual({ ok: true, undone: 0, failed: [] })
    expect(h.fake.folderLog.filter((line) => line.startsWith('UID MOVE')).length).toBe(moves)
    // Running: primeiro Parar.
    // As que voltaram entram na INBOX do app pelo IDLE, sem aviso de email novo.
    await vi.waitFor(async () => expect((await h.service.messages({ accountId: h.accountId })).length).toBe(4))
    expect(h.received).toEqual([])
    const context = newTurn()
    await h.run('listar_conversas', {}, null)
    await h.run('mover_emails', { destino: 'Resolvidos', assuntos: [{ emails: refsOf(h, 'Backup concluído com sucesso'), assunto: 'Backup', veredito: 'resolvido', motivo: 'x', evidencia: 'y' }] }, context)
    const running = h.batches().find((batch) => batch.state === 'running')
    expect(await h.tools.organizer?.undoBatch(running?.id ?? '')).toEqual({ ok: false, error: 'busy' })
    expect(await h.tools.organizer?.undo({ batchId: 'x' })).toEqual({ ok: false, error: 'invalid' })
    expect(await h.tools.organizer?.undo({ batchId: running?.id, extra: 1 })).toEqual({ ok: false, error: 'invalid' })
  })

  it('sem COPYUID: acha pelo Message-ID; a volta à INBOX (pasta nunca aberta no app) não vira aviso de email novo', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    h.fake.capabilities.uidplus = false
    const id = await moveTwo(h)
    expect(h.batches()[0]?.items.map((item) => item.toUid)).toEqual([null, null])
    expect(await h.tools.organizer?.undoBatch(id)).toEqual({ ok: true, undone: 2, failed: [] })
    expect(h.fake.folderLog.some((line) => line.startsWith('UID SEARCH HEADER Message-ID Resolvidos'))).toBe(true)
    // O IDLE acorda (um email novo de verdade): só ele vira aviso; as que voltaram, não.
    await h.fake.deliver({ from: CARLA, subject: 'Novo de verdade', text: 'oi' })
    await vi.waitFor(() => expect(h.received.map((message) => message.subject)).toEqual(['Novo de verdade']))
    expect((await h.service.messages({ accountId: h.accountId })).map((message) => message.subject)).toEqual(expect.arrayContaining(['Backup concluído com sucesso', 'Re: Agenda da apresentação']))
  })

  it('depois de reiniciar o app, só com o batches.json; o item pending de um app que caiu volta pelo Message-ID', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'scribe-organizar-'))
    cleanups.push(() => rmSync(userData, { recursive: true, force: true }))
    const fake = createFakeEmail(() => NOW, { folders: [{ path: 'Resolvidos' }] })
    const first = await setup({ fakeEmail: fake })
    // O primeiro app grava as contas em outro `userData`: copia o settings e o email para o novo.
    const id = await moveTwo(first)
    await first.service.dispose()
    for (const name of readdirSync(first.userData)) if (name.endsWith('.json')) writeFileSync(join(userData, name), readFileSync(join(first.userData, name)))
    mkdirSync(join(userData, 'email'), { recursive: true })
    const saved = JSON.parse(readFileSync(join(first.userData, 'email', EMAIL_BATCHES_FILE), 'utf8')) as { version: 1; batches: EmailBatch[] }
    // Um segundo lote, de um app que caiu entre o MOVE e a gravação: o item ficou `pending` e o lote `running`.
    const box = fake.mailboxes()['INBOX']?.uids ?? []
    const inboxIds = fake.messageIdsIn('INBOX')
    const crashed: EmailBatch = {
      ...(saved.batches[0] as EmailBatch),
      id: '7d9f0c52-6b0e-4d5e-9a51-4c2f8f1f0a11',
      state: 'running',
      endedAt: null,
      startedAt: NOW - 1000,
      items: [{ messageId: inboxIds[0] ?? null, fromPath: 'INBOX', fromUid: box[0] ?? 1, fromUidValidity: '1', toPath: 'Resolvidos', toUid: null, toUidValidity: null, status: 'pending', topic: 0 }],
    }
    const session = await fake.imapFolders({ host: 'x', port: 1, security: 'tls', user: 'u', pass: SMOKE_EMAIL_PASSWORD })
    await session.move('INBOX', [box[0] ?? 1], 'Resolvidos', '1')
    writeFileSync(join(userData, 'email', EMAIL_BATCHES_FILE), JSON.stringify({ version: 1, batches: [crashed, ...saved.batches] }))
    const again = await setup({ userData, fakeEmail: fake })
    await again.tools.organizer?.init()
    expect(again.batches().find((batch) => batch.id === crashed.id)).toMatchObject({ state: 'stopped', endedAt: NOW })
    expect(await again.tools.organizer?.undoBatch(id)).toEqual({ ok: true, undone: 2, failed: [] })
    expect(await again.tools.organizer?.undoBatch(crashed.id)).toEqual({ ok: true, undone: 1, failed: [] })
    expect(fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
    expect(fake.mailboxes()['Resolvidos']?.uids).toEqual([])
  })

  it('destino apagado → folder-missing; origem apagada → origin-missing sem recriar; tirada do destino → not-found; o segundo Desfazer tenta só as que falharam', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }, { path: 'Outra' }, { path: 'Projetos' }] }, prepare: (fake) => void fake.put('Projetos', { from: BRUNO, subject: 'Do projeto', date: NOW - HOUR }) })
    // Destino apagado por fora.
    const gone = await moveTwo(h, 'Outra')
    h.fake.dropFolder('Outra')
    expect(await h.tools.organizer?.undoBatch(gone)).toEqual({ ok: true, undone: 0, failed: [{ code: 'folder-missing', count: 2 }] })
    expect(h.batches().find((batch) => batch.id === gone)).toMatchObject({ state: 'partial-undo' })
    expect(h.cards.at(-1)?.result).toMatch(/^Desfeito em parte às \d{2}:\d{2}: 0 de 2 voltaram$/)
    expect(h.fake.mailboxes()['Outra']).toBeUndefined()
    // Origem apagada: a mensagem fica em Resolvidos e "Projetos" não volta.
    await h.run('listar_conversas', { pasta: 'Projetos' }, null)
    const context = newTurn()
    await h.run('mover_emails', { destino: 'Resolvidos', assuntos: [{ emails: refsOf(h, 'Do projeto'), assunto: 'Do projeto', veredito: 'resolvido', motivo: 'x', evidencia: 'y' }] }, context)
    await h.tools.organizer?.endTurn(context, 'done')
    const origin = h.batches()[0]?.id as string
    h.fake.dropFolder('Projetos')
    expect(await h.tools.organizer?.undoBatch(origin)).toEqual({ ok: true, undone: 0, failed: [{ code: 'origin-missing', count: 1 }] })
    expect(h.fake.mailboxes()['Projetos']).toBeUndefined()
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(1)
    expect(h.fake.folderLog.some((line) => line.startsWith('CREATE'))).toBe(false)
    // Tirada do destino por fora: not-found; a outra volta. Posta de volta, o segundo Desfazer tenta só ela.
    h.fake.take('Resolvidos', h.fake.mailboxes()['Resolvidos']?.uids[0] ?? 0)
    const pair = await moveTwo(h, 'Resolvidos', ['Proposta revisada do projeto de integração', 'Fechamento de novembro: notas para conferir'])
    const [firstUid] = h.fake.mailboxes()['Resolvidos']?.uids ?? []
    const messageId = h.fake.messageIdsIn('Resolvidos')[0] ?? null
    h.fake.take('Resolvidos', firstUid ?? 0)
    expect(await h.tools.organizer?.undoBatch(pair)).toEqual({ ok: true, undone: 1, failed: [{ code: 'not-found', count: 1 }] })
    h.fake.put('Resolvidos', { from: CARLA, subject: 'Devolvida', date: NOW, messageId })
    const before = h.fake.folderLog.filter((line) => line.startsWith('UID MOVE')).length
    expect(await h.tools.organizer?.undoBatch(pair)).toEqual({ ok: true, undone: 1, failed: [] })
    const moves = h.fake.folderLog.filter((line) => line.startsWith('UID MOVE'))
    expect(moves.length).toBe(before + 1)
    expect(moves.at(-1)).toMatch(/^UID MOVE \d+ INBOX$/)
    expect(h.batches().find((batch) => batch.id === pair)).toMatchObject({ state: 'undone' })
  })

  it('UIDVALIDITY do destino trocado: acha pelo Message-ID', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    const id = await moveTwo(h)
    h.fake.resetUidValidity('Resolvidos')
    expect(await h.tools.organizer?.undoBatch(id)).toEqual({ ok: true, undone: 2, failed: [] })
    expect(h.fake.mailboxes()['INBOX']?.uids).toHaveLength(4)
  })
})

describe('lotes guardados (CA8, D4)', () => {
  const batch = (id: number, patch: Partial<EmailBatch> = {}): EmailBatch => ({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    accountId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    chatId: 'c1',
    startedAt: NOW - id * 60_000,
    endedAt: NOW,
    state: 'done',
    request: 'organiza',
    totals: { read: 0, total: 0, outOfLimit: 0 },
    topics: [],
    items: [],
    ...patch,
  })

  it('o 21º apaga o mais antigo; o de 8 dias sai; arquivo 0600; conta removida leva os lotes', async () => {
    expect(pruneBatches(Array.from({ length: 21 }, (_, at) => batch(at)), NOW).map((item) => item.id)).toHaveLength(EMAIL_BATCHES_MAX)
    expect(pruneBatches(Array.from({ length: 21 }, (_, at) => batch(at)), NOW).some((item) => item.id.endsWith('000000000020'))).toBe(false)
    expect(pruneBatches([batch(1), batch(2, { startedAt: NOW - 8 * 86_400_000 })], NOW).map((item) => item.id.slice(-1))).toEqual(['1'])
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    await moveTwo(h)
    expect(statSync(join(h.userData, 'email', EMAIL_BATCHES_FILE)).mode & 0o777).toBe(0o600)
    expect(h.batches()).toHaveLength(1)
    expect(await h.service.removeAccount({ accountId: h.accountId })).toBe(true)
    await vi.waitFor(() => expect(h.batches()).toEqual([]))
  })

  it('o estado: o running mais recente e os de hoje; bloqueado, recusado', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    await moveTwo(h)
    const state = await h.tools.organizer?.state()
    expect(state).toMatchObject({ ok: true, running: null, today: [{ state: 'done', moved: 2 }] })
    const id = h.batches()[0]?.id as string
    expect(await h.tools.organizer?.batch({ batchId: id })).toMatchObject({ ok: true, batch: { id }, view: { moved: 2, byFolder: [{ path: 'Resolvidos', count: 2 }] } })
    h.setLocked(true)
    expect(await h.tools.organizer?.state()).toEqual({ ok: false, error: 'unavailable' })
    expect(await h.tools.organizer?.undoBatch(id)).toEqual({ ok: false, error: 'unavailable' })
    const events = h.events.length
    await h.tools.organizer?.endTurn(newTurn(), 'done')
    expect(h.events.length).toBe(events)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// O chat de verdade, com o processo do `claude` falso.

/** Processo falso do `claude` (linha de comando): o teste responde pelo stdout. */
class FakeChild implements ClaudeChild {
  readonly written: string[] = []
  private readonly dataListeners: ((chunk: string) => void)[] = []
  constructor(
    readonly file: string,
    readonly args: readonly string[],
    readonly options: SpawnOptions,
  ) {}
  readonly stdin = { write: (chunk: string): boolean => (this.written.push(chunk), true), end: (): void => undefined, on: (): undefined => undefined }
  readonly stdout = { setEncoding: (): undefined => undefined, on: (_event: 'data', listener: (chunk: string) => void): undefined => void this.dataListeners.push(listener) }
  readonly stderr = { setEncoding: (): undefined => undefined, on: (): undefined => undefined }
  kill(): boolean {
    return true
  }
  on(): this {
    return this
  }
  answer(text: string): void {
    for (const line of [{ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } }, { type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0 }])
      for (const listener of this.dataListeners) listener(`${JSON.stringify(line)}\n`)
  }
  /** Contrato 149: uma linha qualquer do `stream-json` (o `Read` da IA num arquivo da pasta). */
  emit(line: Record<string, unknown>): void {
    for (const listener of this.dataListeners) listener(`${JSON.stringify(line)}\n`)
  }
}

const block = (json: Record<string, unknown>): string => `Vou seguir.\n\n\`\`\`lap-ferramenta\n${JSON.stringify(json)}\n\`\`\``

function chatHarness(dir: string, tools: () => readonly AssistantTool[], endTurn?: (turn: { chatId: string; turnId: string }, outcome: 'done' | 'stopped') => Promise<void>) {
  const meetings = createFileMeetingsStore({ dir, newId: () => 'm-1' })
  const corpus = createChatCorpus({ dir, meetings, transcripts: createFileTranscriptStore({ dir }), summaries: createFileSummaryStore({ dir }) })
  const store = createFileChatStore({ dir })
  const children: FakeChild[] = []
  const spawn: SpawnClaude = (file, args, options) => {
    const child = new FakeChild(file, args, options)
    children.push(child)
    return child
  }
  const service = createChatService({
    store,
    corpus,
    assistant: { prepare: () => Promise.resolve(), extract: (text) => Promise.resolve({ text, actions: [] }), tools: () => tools(), ...(endTurn ? { endTurn } : {}) },
    settings: { get: () => Promise.resolve(DEFAULT_SETTINGS) },
    meetings,
    locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.1.325' }),
    spawn,
    baseEnv: {},
    onEvent: () => undefined,
    now: () => NOW,
    newId: () => 'c-organizar',
  })
  const child = async (): Promise<FakeChild> => {
    await vi.waitFor(() => expect(children.length).toBeGreaterThan(0))
    return children[0] as FakeChild
  }
  const written = async (count: number): Promise<void> => {
    const proc = await child()
    await vi.waitFor(() => expect(proc.written.length).toBeGreaterThanOrEqual(count))
  }
  return { service, store, child, written }
}

describe('rodadas (CA11, D3)', () => {
  it('o turno que organiza aceita mais de 4 rodadas e para em 40; sem ferramenta de organizar, segue em 4', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scribe-rodadas-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const runs: string[] = []
    const fakeTool = (name: string, rounds?: number): AssistantTool => ({ name, describe: 'x', pending: name, step: 'Read', ...(rounds ? { rounds, stepId: 'organizar-email' } : {}), run: async () => (runs.push(name), { file: null, ok: true, label: `${name} ok`, note: 'ok' }) })
    const list = [fakeTool('buscar_emails'), fakeTool('informar_progresso', 40)]
    expect(toolsInstructions(list)[0]).toContain('Até 4 ferramentas por pergunta (até 40 quando a pessoa pediu para organizar o email).')
    const chat = chatHarness(dir, () => list)
    const sent = (await chat.service.send({ chatId: null, meetingId: null, text: 'organiza meus emails' })) as { chat: Chat }
    const proc = await chat.child()
    for (let at = 1; at <= 41; at++) {
      await chat.written(at)
      proc.answer(block({ ferramenta: 'informar_progresso', etapa: 'lendo', lidos: at, total: 50 }))
    }
    await chat.service.settled(sent.chat.id)
    expect(runs.filter((name) => name === 'informar_progresso')).toHaveLength(40)
    const saved = (await chat.store.get(sent.chat.id))?.messages.at(-1)
    // Um passo só, de mesmo id, com o último rótulo.
    expect(saved?.steps).toEqual([{ tool: 'Read', label: 'informar_progresso ok', meetingId: null, id: 'organizar-email', status: 'completed' }])
    expect(saved?.text).not.toContain('lap-ferramenta')

    runs.length = 0
    const base = proc.written.length
    const again = (await chat.service.send({ chatId: sent.chat.id, meetingId: null, text: 'busque emails' })) as { chat: Chat }
    for (let at = 1; at <= 5; at++) {
      await chat.written(base + at)
      proc.answer(block({ ferramenta: 'buscar_emails', de: 'x' }))
    }
    await chat.service.settled(again.chat.id)
    expect(runs).toEqual(['buscar_emails', 'buscar_emails', 'buscar_emails', 'buscar_emails'])
  })
})

describe('Parar e o cartão do lote (CA11, CA12)', () => {
  it('Parar no meio de um mover com 3 MOVE: o primeiro termina, os outros não começam; lote stopped; o Desfazer devolve só o movido; o cartão fica done', async () => {
    let release: (() => void) | null = null
    let started: (() => void) | null = null
    const reached = new Promise<void>((resolveStarted) => (started = resolveStarted))
    const h = await setup({
      fake: { folders: [{ path: 'Resolvidos' }] },
      prepare: (fake) => {
        for (const path of ['Pasta A', 'Pasta B', 'Pasta C']) for (let at = 0; at < 2; at++) fake.put(path, { from: BRUNO, subject: `${path} ${at}`, date: NOW - (10 + at) * HOUR })
      },
      imapFolders: (fake) => async (config) => {
        const session = await fake.imapFolders(config)
        return {
          ...session,
          move: async (from, uids, to, uidValidity) => {
            if (from === 'Pasta A') {
              started?.()
              await new Promise<void>((resolveMove) => (release = resolveMove))
            }
            return session.move(from, uids, to, uidValidity)
          },
        }
      },
    })
    const refs: string[] = []
    for (const path of ['Pasta A', 'Pasta B', 'Pasta C']) {
      await h.run('listar_conversas', { pasta: path }, null)
      refs.push(...[...readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8').matchAll(/(em-[0-9a-f]{12}) \(recebido/g)].map((match) => match[1] as string))
    }
    expect(refs).toHaveLength(6)
    const dir = mkdtempSync(join(tmpdir(), 'scribe-parar-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const chat = chatHarness(dir, () => [...h.tools.tools, ...h.tools.organizeTools], (turnRef, outcome) => h.tools.organizer?.endTurn(turnRef, outcome) ?? Promise.resolve())
    const sent = (await chat.service.send({ chatId: null, meetingId: null, text: 'organiza meus emails em resolvidos' })) as { chat: Chat }
    const proc = await chat.child()
    await chat.written(1)
    proc.answer(block({ ferramenta: 'mover_emails', destino: 'Resolvidos', assuntos: [{ emails: refs, assunto: 'Avisos das pastas', veredito: 'resolvido', motivo: 'avisos', evidencia: 'sem pergunta' }] }))
    await reached
    // Só a ferramenta rodando (o motor está parado): `true`.
    expect(chat.service.stop(sent.chat.id)).toBe(true)
    ;(release as (() => void) | null)?.()
    await chat.service.settled(sent.chat.id)
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(2)
    expect(h.fake.mailboxes()['Pasta B']?.uids).toHaveLength(2)
    expect(h.fake.mailboxes()['Pasta C']?.uids).toHaveLength(2)
    expect(h.fake.folderLog.filter((line) => line.startsWith('UID MOVE'))).toHaveLength(1)
    const [batch] = h.batches()
    expect(batch).toMatchObject({ state: 'stopped', endedAt: NOW, chatId: sent.chat.id })
    expect(batch?.items.map((item) => item.status)).toEqual(['moved', 'moved'])
    expect(readFileSync(join(proc.options.cwd as string, EMAIL_MOVE_FILE), 'utf8')).toContain('4 ficou(aram) (parado')
    // A resposta gravada (parada) traz o cartão do lote, montado pelo main.
    const saved = (await chat.store.get(sent.chat.id))?.messages.at(-1)
    expect(saved?.error).toBe('stopped')
    const card = saved?.actions?.[0] as EmailBatchAction
    expect(card).toMatchObject({ kind: 'email-lote', batchId: batch?.id, status: 'proposed', account: SMOKE_EMAIL_ADDRESS })
    // O Desfazer devolve só as duas que foram; o cartão fica `done`.
    expect(await h.tools.organizer?.undoBatch(batch?.id as string)).toEqual({ ok: true, undone: 2, failed: [] })
    expect(h.fake.mailboxes()['Pasta A']?.uids).toHaveLength(2)
    const result = h.cards.at(-1)?.result as string
    await markEmailBatchCard(chat.store, sent.chat.id, batch?.id as string, result)
    expect((await chat.store.get(sent.chat.id))?.messages.at(-1)?.actions?.[0]).toMatchObject({ kind: 'email-lote', status: 'done', result: expect.stringMatching(/^Desfeito às/) })
  })
})

describe('invariantes estáticos (CA1, CA13, N4)', () => {
  const SRC = resolve(import.meta.dirname, '../src')
  const files = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(folder, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(folder, entry.name)] : []))
  const all = files(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }))

  it('as tarefas agendadas nunca veem as ferramentas de organizar; o Assistente interativo vê; as automações só leem', () => {
    const names = ['mover_emails', 'criar_pasta', 'listar_pastas', 'listar_conversas', 'informar_progresso', 'organizeTools']
    for (const { file, text } of all.filter((item) => item.file.startsWith('main/schedules/'))) for (const name of names) expect(text.includes(name), `${file}: ${name}`).toBe(false)
    const index = all.find((item) => item.file === 'main/index.ts')?.text ?? ''
    expect(index).toContain('readTools: () => emailTools.tools,')
    expect(index).toContain('[...emailTools.tools, ...emailTools.organizeTools]')
    expect(index.match(/organizeTools/g)).toHaveLength(1)
  })

  it('o agente nunca apaga: nenhuma ferramenta de apagar, e nada do 56 chama remove, \\Deleted ou EXPUNGE', () => {
    const organize = all.find((item) => item.file === 'main/email/organize.ts')?.text ?? ''
    const batches = all.find((item) => item.file === 'main/email/batches.ts')?.text ?? ''
    for (const text of [organize, batches]) {
      expect(text).not.toMatch(/\.remove\(|\\\\Deleted|EXPUNGE|messageDelete|deleteFolder|renameFolder|mailboxDelete/)
    }
    const names = [...organize.matchAll(/name: '([a-z_]+)'/g)].map((match) => match[1])
    expect(names).toEqual(['listar_conversas', 'listar_pastas', 'criar_pasta', 'mover_emails', 'informar_progresso'])
    expect(names.some((name) => /apagar|excluir|deletar|remover|lixeira/.test(name ?? ''))).toBe(false)
  })
})

describe('devolução da revisão (M1, M2, M3, M5, M6)', () => {
  it('M1: item pending de um app que caiu antes do MOVE ainda está na origem: não chegou a ser movido, sem falha', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    const id = await moveTwo(h)
    const saved = h.batches()[0] as EmailBatch
    const inbox = h.fake.mailboxes()['INBOX']?.uids ?? []
    const ids = h.fake.messageIdsIn('INBOX')
    const crashed: EmailBatch = { ...saved, id: '6a1e0b52-6b0e-4d5e-9a51-4c2f8f1f0a22', state: 'running', endedAt: null, items: [{ messageId: ids[0] ?? null, fromPath: 'INBOX', fromUid: inbox[0] ?? 1, fromUidValidity: '1', toPath: 'Resolvidos', toUid: null, toUidValidity: null, status: 'pending', topic: 0 }] }
    writeFileSync(join(h.userData, 'email', EMAIL_BATCHES_FILE), JSON.stringify({ version: 1, batches: [crashed, ...h.batches()] }))
    await h.tools.organizer?.init()
    expect(await h.tools.organizer?.undoBatch(crashed.id)).toEqual({ ok: true, undone: 0, failed: [] })
    const after = h.batches().find((batch) => batch.id === crashed.id)
    expect(after).toMatchObject({ state: 'undone', items: [{ status: 'failed' }] })
    expect(h.cards.at(-1)?.result).toMatch(/^Nada a desfazer às \d{2}:\d{2}: nenhuma mensagem chegou a ser movida$/)
    // Nada se moveu nesse Desfazer, e o outro lote segue desfazível.
    expect(h.fake.mailboxes()['INBOX']?.uids).toEqual(inbox)
    expect(await h.tools.organizer?.undoBatch(id)).toEqual({ ok: true, undone: 2, failed: [] })
  })

  it('M2: o teto de 10 pastas por conversa vale depois de reiniciar (gravado com os lotes)', async () => {
    const h = await setup()
    const context = newTurn()
    for (let at = 0; at < 10; at++) expect((await h.run('criar_pasta', { nome: `Pasta ${at}` }, context)).ok).toBe(true)
    // Outro organizador no mesmo `userData` (o app reaberto): a contagem veio do disco.
    const again = createEmailTools({
      cached: () => h.service.cached(),
      body: () => Promise.resolve(null),
      searchServer: (accountId, query, limit) => h.service.searchServer(accountId, query, limit),
      peekServer: (accountId, mailbox, uid) => h.service.peekServer(accountId, mailbox, uid),
      locked: () => false,
      now: () => NOW,
      organize: {
        store: createEmailBatchStore(join(h.userData, 'email'), () => NOW),
        accounts: () => h.service.accounts(),
        listFolders: (accountId, opts) => h.service.listFolders(accountId, opts),
        openFolder: (accountId, path) => h.service.openFolder(accountId, path),
        createFolder: (accountId, parent, name) => h.service.createFolder(accountId, parent, name),
        moveMessages: (accountId, from, uids, to, opts) => h.service.moveMessages(accountId, from, uids, to, opts),
        locateMessages: (accountId, path, uids, ids) => h.service.locateMessages(accountId, path, uids, ids),
        emit: () => undefined,
      },
    })
    const create = again.organizeTools.find((tool) => tool.name === 'criar_pasta') as AssistantTool
    expect((await create.run({ nome: 'Pasta 11' }, h.folder, newTurn())).note).toContain('Recusado (limite)')
    expect((await create.run({ nome: 'Pasta 11' }, h.folder, newTurn({ chatId: 'c-outra' }))).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(h.userData, 'email', EMAIL_BATCHES_FILE), 'utf8')).folders).toEqual({ c1: 10, 'c-outra': 1 })
  })

  it('M3: sem informar_progresso, os "lidos" são os que o ler_email leu', async () => {
    const h = await setup({ prepare: seedThreads })
    const context = newTurn()
    await h.run('listar_conversas', {}, context)
    expect(h.events.at(-1)).toMatchObject({ read: 0, total: 8 })
    await h.run('ler_email', { emails: refsOf(h, 'Contrato de manutenção') }, context)
    expect(h.events.at(-1)).toMatchObject({ read: 2, total: 8 })
    await h.run('ler_email', { email: refsOf(h, 'Reunião semanal')[0] }, context)
    expect(h.events.at(-1)).toMatchObject({ read: 3 })
  })

  it('M5: o item desfeito abre onde voltou (a origem com o UID novo do COPYUID)', async () => {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    const id = await moveTwo(h)
    await h.tools.organizer?.undoBatch(id)
    const items = h.batches()[0]?.items ?? []
    expect(items.every((item) => item.status === 'undone' && typeof item.backUid === 'number')).toBe(true)
    const view = await h.tools.organizer?.get(id)
    const open = view?.ok ? view.view.topics[0]?.open : null
    expect(open).toMatchObject({ mailbox: 'INBOX' })
    expect(h.fake.mailboxes()['INBOX']?.uids).toContain(Number(open?.id))
  })

  it('M6: duas conversas com o mesmo assunto ficam em duas linhas; a mesma conversa é trocada', async () => {
    const h = await setup({
      fake: { folders: [{ path: 'Resolvidos' }] },
      prepare: (fake) => {
        fake.put('INBOX', { from: CARLA, subject: 'Orçamento', date: NOW - 5 * HOUR, messageId: '<orc-carla@x>' })
        fake.put('INBOX', { from: BRUNO, subject: 'Orçamento', date: NOW - 4 * HOUR, messageId: '<orc-bruno@x>' })
      },
    })
    await h.run('listar_conversas', {}, null)
    const text = readFileSync(join(h.folder, EMAIL_CONVERSATIONS_FILE), 'utf8')
    const lines = text.split('\n').filter((line) => line.includes('assunto: "Orçamento"'))
    expect(lines).toHaveLength(2)
    const refs = lines.map((line) => /(em-[0-9a-f]{12})/.exec(line)?.[1] as string)
    const context = newTurn()
    const topic = (emails: string[], motivo: string) => ({ emails, assunto: 'Orçamento', veredito: 'resolvido', motivo, evidencia: 'y' })
    await h.run('informar_progresso', { etapa: 'decidindo', lidos: 1, total: 2, decisoes: [topic([refs[0] as string], 'primeira')] }, context)
    await h.run('mover_emails', { destino: 'Resolvidos', assuntos: [topic([refs[0] as string], 'primeira, movida'), topic([refs[1] as string], 'segunda')] }, context)
    await h.tools.organizer?.endTurn(context, 'done')
    expect(h.batches()[0]?.topics.map((item) => item.motivo)).toEqual(['primeira, movida', 'segunda'])
  })
})

describe('mídia no turno (contrato 149, CA13)', () => {
  const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)])
  const CHAT = '5511922220000@s.whatsapp.net'

  /** As ferramentas de verdade do email (leitura e organizar) e a de ver mídia do WhatsApp, com o serviço falso. */
  async function harness() {
    const h = await setup({ fake: { folders: [{ path: 'Resolvidos' }] } })
    await h.run('buscar_emails', { assunto: 'Contrato de parceria' }, null)
    const ref = /ref: (em-[0-9a-f]{12}) .*pasta Arquivo/.exec(readFileSync(join(h.folder, 'BUSCA-EMAILS.md'), 'utf8'))?.[1] ?? ''
    const downloads: string[] = []
    const media = createWhatsAppMediaTools({
      exported: () => Promise.resolve({ chatName: 'Bruno Lima', media: { kind: 'image', mime: 'image/png', size: PNG_BYTES.byteLength, seconds: null, name: null, downloadable: true, author: 'Bruno Lima', at: NOW } }),
      media: (chatId, messageId) => (downloads.push(`${chatId}/${messageId}`), Promise.resolve({ ok: true, mime: 'image/png', bytes: PNG_BYTES })),
      savedTranscript: () => Promise.resolve(null),
      transcribe: () => Promise.resolve({ ok: false, error: 'failed' }),
      locked: () => false,
      account: () => '+5511900000000',
      enabled: () => Promise.resolve(true),
      budget: createMediaBudget(),
    })
    const dir = mkdtempSync(join(tmpdir(), 'scribe-midia-acao-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const chat = chatHarness(dir, () => [...h.tools.tools, ...h.tools.organizeTools, ...media])
    const move = block({ ferramenta: 'mover_emails', destino: 'Resolvidos', assuntos: [{ emails: [ref], assunto: 'Contrato de parceria', veredito: 'resolvido', motivo: 'assinado', evidencia: 'contrato assinado' }] })
    return { h, chat, move, downloads, dir }
  }

  it('depois de ver_midia_whatsapp, mover_emails é recusado com a nota e nada se move; as de leitura seguem', async () => {
    const { h, chat, move, downloads } = await harness()
    const sent = (await chat.service.send({ chatId: null, meetingId: null, text: 'veja o print do Bruno e organize meus emails' })) as { chat: Chat }
    const proc = await chat.child()
    await chat.written(1)
    proc.answer(block({ ferramenta: 'ver_midia_whatsapp', conversa: CHAT, midia: 'm8' }))
    await chat.written(2)
    proc.answer(move)
    await chat.written(3)
    expect(proc.written[2]).toContain(MEDIA_ACTION_REFUSAL)
    // Leitura continua depois da mídia.
    proc.answer(block({ ferramenta: 'buscar_emails', assunto: 'Contrato' }))
    await chat.written(4)
    expect(proc.written[3]).toContain('BUSCA-EMAILS.md')
    proc.answer('Pela imagem, eu moveria o contrato para Resolvidos; confirme numa nova pergunta.')
    await chat.service.settled(sent.chat.id)
    expect(downloads).toEqual([`${CHAT}/m8`])
    expect(h.fake.mailboxes()['Resolvidos']?.uids ?? []).toEqual([])
    expect(h.batches()).toEqual([])
    const saved = (await chat.store.get(sent.chat.id))?.messages.at(-1)
    expect(saved?.steps?.map((step) => step.status)).toEqual(['completed', 'failed', 'completed'])
  })

  it('sem mídia no turno, mover_emails funciona como antes', async () => {
    const { h, chat, move } = await harness()
    const sent = (await chat.service.send({ chatId: null, meetingId: null, text: 'organize meus emails' })) as { chat: Chat }
    const proc = await chat.child()
    await chat.written(1)
    proc.answer(move)
    await chat.written(2)
    expect(proc.written[1]).not.toContain(MEDIA_ACTION_REFUSAL)
    proc.answer('Movi.')
    await chat.service.settled(sent.chat.id)
    expect(h.fake.mailboxes()['Resolvidos']?.uids).toHaveLength(1)
  })

  it('ler um arquivo "Midia - …" que ficou na pasta (sem chamar a ferramenta) também bloqueia o que muda', async () => {
    const { h, chat, move, downloads } = await harness()
    const sent = (await chat.service.send({ chatId: null, meetingId: null, text: 'veja de novo o print e organize' })) as { chat: Chat }
    const proc = await chat.child()
    await chat.written(1)
    proc.emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: join(proc.options.cwd, mediaFileName('WhatsApp', `${CHAT}\nm8`, 'png')) } }] } })
    proc.answer(move)
    await chat.written(2)
    expect(proc.written[1]).toContain(MEDIA_ACTION_REFUSAL)
    proc.answer('Confirme numa nova pergunta.')
    await chat.service.settled(sent.chat.id)
    expect(downloads).toEqual([])
    expect(h.fake.mailboxes()['Resolvidos']?.uids ?? []).toEqual([])
  })
})
