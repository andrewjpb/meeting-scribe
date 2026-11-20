// Contrato 53: as regras de email. `matchRule`, `planActions` e `needsBody` (puros), o esquema, o `settings.json`, a
// aplicação na chegada com o IMAP falso (`fake-email.ts`) e com um POP3 em memória, o aviso (`notify`), a pasta de
// destino que some ou muda, o "Executar agora" em dois passos, o estado das regras e a limpeza dos corpos órfãos.
// Nenhuma rede.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmailStore, type EmailStore } from '../src/main/email/email-store'
import { createFakeEmail, SMOKE_EMAIL_ADDRESS, SMOKE_EMAIL_PASSWORD, type FakeEmailOptions } from '../src/main/email/fake-email'
import type { Pop3Connect } from '../src/main/email/pop3-client'
import { emptyPlan, matchRule, needsBody, planActions, ruleBody, type EmailRuleInput } from '../src/main/email/rules'
import { createEmailService, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFileSettingsStore, SETTINGS_FILE } from '../src/main/settings/store'
import type { EmailBody, EmailMessage } from '../src/shared/email'
import type { EmailInvite } from '../src/shared/invite'
import { DEFAULT_EMAIL_RULE_ACTIONS, EMAIL_RULE_ERROR_CODES, emailRuleListSchema, emailRuleSchema, EMAIL_RULE_TOKEN_TTL_MS, newEmailRule, type EmailRule, type EmailRuleActions } from '../src/shared/email-rules'

const fakeSafeStorage = (): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

let counter = 0
const uuid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function rule(conditions: EmailRule['conditions'], actions: Partial<EmailRuleActions>, extra: Partial<EmailRule> = {}): EmailRule {
  const base = newEmailRule(uuid(), 'Regra')
  return { ...base, conditions, actions: { ...base.actions, ...actions }, ...extra }
}

const input = (extra: Partial<EmailRuleInput> = {}): EmailRuleInput => ({
  from: [{ name: 'Marina Rocha', address: 'marina@cliente.example' }],
  to: [{ name: 'Andrew', address: 'andrew@lap.example' }],
  cc: [{ name: 'Paulo Nunes', address: 'paulo@cliente.example' }],
  subject: 'Relatório de Novembro',
  body: 'Segue o relatório anexo.',
  hasAttachment: true,
  inviteMethod: null,
  ...extra,
})

describe('matchRule (CA3)', () => {
  it('cada campo, sem diferenciar maiúsculas', () => {
    expect(matchRule(input(), rule([{ field: 'from', value: 'MARINA' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'from', value: 'cliente.example' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'to', value: 'andrew@' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'subject', value: 'novembro' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'body', value: 'ANEXO' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'hasAttachment' }], { flag: true }))).toBe(true)
    expect(matchRule(input({ hasAttachment: false }), rule([{ field: 'hasAttachment' }], { flag: true }))).toBe(false)
    expect(matchRule(input(), rule([{ field: 'subject', value: 'dezembro' }], { flag: true }))).toBe(false)
  })

  it('`to` acha no Cc', () => {
    expect(matchRule(input(), rule([{ field: 'to', value: 'Paulo Nunes' }], { flag: true }))).toBe(true)
    expect(matchRule(input({ cc: [] }), rule([{ field: 'to', value: 'Paulo' }], { flag: true }))).toBe(false)
  })

  it('NFC dos dois lados; acento conta (D2)', () => {
    const decomposed = 'Relatório'
    expect(matchRule(input(), rule([{ field: 'subject', value: decomposed }], { flag: true }))).toBe(true)
    expect(matchRule(input({ subject: decomposed }), rule([{ field: 'subject', value: 'relatório' }], { flag: true }))).toBe(true)
    expect(matchRule(input(), rule([{ field: 'subject', value: 'relatorio' }], { flag: true }))).toBe(false)
  })

  it('all × any', () => {
    const conditions: EmailRule['conditions'] = [{ field: 'from', value: 'marina' }, { field: 'subject', value: 'dezembro' }]
    expect(matchRule(input(), rule(conditions, { flag: true }, { match: 'all' }))).toBe(false)
    expect(matchRule(input(), rule(conditions, { flag: true }, { match: 'any' }))).toBe(true)
  })

  it('corpo e anexo `null` não casam (nem com "any" no resto falso); regra desligada nunca casa', () => {
    expect(matchRule(input({ body: null }), rule([{ field: 'body', value: 'anexo' }], { flag: true }))).toBe(false)
    expect(matchRule(input({ hasAttachment: null }), rule([{ field: 'hasAttachment' }], { flag: true }))).toBe(false)
    expect(matchRule(input(), rule([{ field: 'from', value: 'marina' }], { flag: true }, { enabled: false }))).toBe(false)
  })

  it('needsBody: só regra ligada com corpo ou anexo', () => {
    expect(needsBody([rule([{ field: 'subject', value: 'x' }], { flag: true })])).toBe(false)
    expect(needsBody([rule([{ field: 'body', value: 'x' }], { flag: true })])).toBe(true)
    expect(needsBody([rule([{ field: 'hasAttachment' }], { flag: true })])).toBe(true)
    expect(needsBody([rule([{ field: 'body', value: 'x' }], { flag: true }, { enabled: false })])).toBe(false)
  })
})

describe('planActions (CA3)', () => {
  const any: EmailRule['conditions'] = [{ field: 'from', value: 'marina' }]
  const none: EmailRule['conditions'] = [{ field: 'from', value: 'ninguém' }]

  it('na ordem: marcas somadas; o primeiro mover vence e encerra', () => {
    const a = rule(any, { markRead: true })
    const b = rule(any, { flag: true, moveTo: 'Clientes' })
    const c = rule(any, { silent: true, moveTo: 'Outra' })
    expect(planActions(input(), [a, b, c])).toEqual({ ruleIds: [a.id, b.id], markRead: true, flag: true, moveTo: 'Clientes', delete: false, silent: false, addToCalendar: false })
  })

  it('stopHere encerra; apagar encerra', () => {
    const a = rule(any, { markRead: true }, { stopHere: true })
    const b = rule(any, { flag: true })
    expect(planActions(input(), [a, b])).toMatchObject({ ruleIds: [a.id], markRead: true, flag: false })
    const d = rule(any, { delete: true, silent: true })
    expect(planActions(input(), [d, b])).toMatchObject({ ruleIds: [d.id], delete: true, silent: true, flag: false })
  })

  it('regra que não casa não para nada; nada casou → plano vazio', () => {
    const a = rule(none, { markRead: true }, { stopHere: true })
    const b = rule(any, { flag: true })
    expect(planActions(input(), [a, b])).toMatchObject({ ruleIds: [b.id], flag: true, markRead: false })
    expect(planActions(input(), [a])).toEqual({ ruleIds: [], markRead: false, flag: false, moveTo: null, delete: false, silent: false, addToCalendar: false })
  })
})

describe('esquema (CA1)', () => {
  const ok = rule([{ field: 'subject', value: 'x' }], { markRead: true })

  it('aceita a regra boa', () => {
    expect(emailRuleSchema.safeParse(ok).success).toBe(true)
  })

  it.each([
    ['sem ação', { ...ok, actions: { moveTo: null, markRead: false, flag: false, delete: false, silent: false } }],
    ['apagar e mover', { ...ok, actions: { ...ok.actions, delete: true, moveTo: 'Arquivo' } }],
    ['mover para a INBOX', { ...ok, actions: { ...ok.actions, moveTo: 'inbox' } }],
    ['sem condição', { ...ok, conditions: [] }],
    ['CR/LF no valor', { ...ok, conditions: [{ field: 'subject', value: 'a\nb' }] }],
    ['CR/LF no nome', { ...ok, name: 'a\rb' }],
    ['id que não é UUID', { ...ok, id: 'x' }],
    ['campo a mais', { ...ok, extra: 1 }],
    ['op que não existe', { ...ok, conditions: [{ field: 'subject', value: 'x', op: 'equals' }] }],
  ])('%s → invalid', (_name, value) => {
    expect(emailRuleSchema.safeParse(value).success).toBe(false)
  })

  it('51 regras ou id repetido → invalid', () => {
    expect(emailRuleListSchema.safeParse(Array.from({ length: 51 }, () => ({ ...ok, id: uuid() }))).success).toBe(false)
    expect(emailRuleListSchema.safeParse(Array.from({ length: 50 }, () => ({ ...ok, id: uuid() }))).success).toBe(true)
    expect(emailRuleListSchema.safeParse([ok, ok]).success).toBe(false)
  })

  it('a regra nova nasce ligada, sem "parar aqui" e sem nenhuma ação', () => {
    const fresh = newEmailRule(uuid(), 'Nova')
    expect(fresh).toMatchObject({ enabled: true, stopHere: false, actions: { moveTo: null, markRead: false, flag: false, delete: false, silent: false } })
  })
})

// ——— Contrato 64: "É convite" e "Pôr na agenda" ———

describe('esquema (contrato 64, CA1)', () => {
  const base = rule([{ field: 'subject', value: 'x' }], { markRead: true })

  it('a regra da 0.16.0, sem `addToCalendar`, continua válida e volta com `false`', () => {
    const { addToCalendar: _gone, ...old } = base.actions
    const parsed = emailRuleSchema.safeParse({ ...base, actions: old })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.actions.addToCalendar).toBe(false)
  })

  it('`isInvite` sem valor; `addToCalendar` sozinho ou com qualquer ação; nenhuma regra nasce pondo na agenda', () => {
    expect(emailRuleSchema.safeParse({ ...base, conditions: [{ field: 'isInvite' }] }).success).toBe(true)
    expect(emailRuleSchema.safeParse({ ...base, conditions: [{ field: 'isInvite', value: 'x' }] }).success).toBe(false)
    expect(emailRuleSchema.safeParse({ ...base, actions: { ...DEFAULT_EMAIL_RULE_ACTIONS, addToCalendar: true } }).success).toBe(true)
    expect(emailRuleSchema.safeParse({ ...base, actions: { ...DEFAULT_EMAIL_RULE_ACTIONS, addToCalendar: 'sim' } }).success).toBe(false)
    expect(emailRuleSchema.safeParse({ ...base, actions: { ...DEFAULT_EMAIL_RULE_ACTIONS, addToCalendar: true, moveTo: 'Arquivo' } }).success).toBe(true)
    expect(emailRuleSchema.safeParse({ ...base, actions: { ...DEFAULT_EMAIL_RULE_ACTIONS, addToCalendar: true, delete: true } }).success).toBe(true)
    expect(DEFAULT_EMAIL_RULE_ACTIONS.addToCalendar).toBe(false)
    expect(EMAIL_RULE_ERROR_CODES.slice(-2)).toEqual(['calendar-denied', 'no-calendar'])
  })
})

describe('matchRule (contrato 64, CA2)', () => {
  const isInvite = rule([{ field: 'isInvite' }], { addToCalendar: true })

  it('"é convite" casa com REQUEST e CANCEL; não com REPLY, sem convite ou regra desligada', () => {
    expect(matchRule(input({ inviteMethod: 'REQUEST' }), isInvite)).toBe(true)
    expect(matchRule(input({ inviteMethod: 'CANCEL' }), isInvite)).toBe(true)
    expect(matchRule(input({ inviteMethod: 'REPLY' }), isInvite)).toBe(false)
    expect(matchRule(input({ inviteMethod: null }), isInvite)).toBe(false)
    expect(matchRule(input({ inviteMethod: 'REQUEST' }), { ...isInvite, enabled: false })).toBe(false)
  })

  it('ruleBody: o método do convite do corpo; sem corpo, os três `null`', () => {
    const body = (invite: EmailInvite | null): EmailBody => ({ text: 'oi', html: null, attachments: [], invite })
    expect(ruleBody(null)).toEqual({ body: null, hasAttachment: null, inviteMethod: null })
    expect(ruleBody(body(null)).inviteMethod).toBeNull()
    expect(ruleBody({ text: 'oi', html: null, attachments: [] }).inviteMethod).toBeNull()
    expect(ruleBody(body({ method: 'CANCEL' } as EmailInvite)).inviteMethod).toBe('CANCEL')
  })
})

describe('planActions (contrato 64, CA2)', () => {
  const any: EmailRule['conditions'] = [{ field: 'from', value: 'marina' }]

  it('"pôr na agenda" se soma como as marcas; quem encerra antes leva o dela, não o de depois', () => {
    const mark = rule(any, { addToCalendar: true })
    const move = rule(any, { moveTo: 'Arquivo' })
    expect(planActions(input(), [mark, move])).toMatchObject({ addToCalendar: true, moveTo: 'Arquivo' })
    expect(planActions(input(), [move, mark])).toMatchObject({ addToCalendar: false, moveTo: 'Arquivo' })
    expect(planActions(input(), [rule(any, { addToCalendar: true, moveTo: 'Arquivo' }), mark])).toMatchObject({ addToCalendar: true, moveTo: 'Arquivo' })
    expect(emptyPlan().addToCalendar).toBe(false)
  })
})

describe('needsBody (contrato 64, CA2)', () => {
  it('regra ligada com "é convite" ou "pôr na agenda" baixa o corpo', () => {
    const fromOnly = rule([{ field: 'from', value: 'x' }], { addToCalendar: true })
    expect(needsBody([fromOnly])).toBe(true)
    expect(needsBody([{ ...fromOnly, enabled: false }])).toBe(false)
    expect(needsBody([rule([{ field: 'isInvite' }], { markRead: true })])).toBe(true)
  })
})

// ——— Serviço ———

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
})

interface Received {
  message: EmailMessage
  notify: boolean
}

function setup(options: FakeEmailOptions = {}, overrides: Partial<EmailServiceDeps> = {}, dir?: string) {
  const userData = dir ?? mkdtempSync(join(tmpdir(), 'scribe-regras-'))
  const fake = createFakeEmail(() => NOW, options)
  const received: Received[] = []
  const logs: string[] = []
  const clock = { now: NOW }
  const settings = createFileSettingsStore({ dir: userData })
  const service = createEmailService({
    root: join(userData, 'email'),
    settings,
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    onStatus: () => undefined,
    onMessage: (message, { notify }) => received.push({ message, notify }),
    log: (message) => logs.push(message),
    imap: fake.imap,
    imapReader: fake.imapReader,
    imapFolders: fake.imapFolders,
    pop3: fake.pop3,
    smtp: fake.smtp,
    retryMs: 3_600_000,
    now: () => clock.now,
    ...overrides,
  })
  cleanups.push(async () => {
    await service.dispose()
    if (!dir) rmSync(userData, { recursive: true, force: true })
  })
  return { userData, fake, service, received, logs, clock, settings }
}

async function connected(service: EmailService, account: Record<string, unknown> = imapAccount): Promise<string> {
  const added = await service.addAccount(account)
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  const id = added.status.account.id
  await vi.waitFor(() => expect(service.accounts().find((status) => status.account.id === id)?.state).toBe('connected'))
  return id
}

async function saveRules(service: EmailService, accountId: string, rules: EmailRule[]): Promise<void> {
  const result = await service.rulesSet({ accountId, rules })
  if (!result.ok) throw new Error(`regras não gravadas: ${result.error}`)
}

const marina = { name: 'Marina Rocha', address: 'marina.rocha@cliente.example' }
const subjectHas = (value: string): EmailRule['conditions'] => [{ field: 'subject', value }]
const inboxSubjects = (fake: ReturnType<typeof createFakeEmail>, path = 'INBOX'): number => fake.mailboxes()[path]?.uids.length ?? 0

describe('chegada no IMAP (CA4, CA5)', () => {
  it('mover: sai da INBOX, entra no destino, um MOVE só por destino; avisa com a mensagem no destino', async () => {
    const { fake, service, received } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('fatura'), { moveTo: 'Arquivo' })])
    const before = inboxSubjects(fake)
    await Promise.all([fake.deliver({ from: marina, subject: 'Fatura 1', text: 'x' }), fake.deliver({ from: marina, subject: 'Fatura 2', text: 'x' })])
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(fake.folderLog.filter((line) => line.startsWith('UID MOVE'))).toEqual(['UID MOVE 5,6 Arquivo'])
    expect(inboxSubjects(fake)).toBe(before)
    expect(fake.mailboxes()['Arquivo']?.uids).toEqual([7, 8, 9])
    expect(received.map((item) => [item.message.mailbox, item.message.uid, item.message.id, item.notify])).toEqual([
      ['Arquivo', 8, 'servidor:1:8:Arquivo', true],
      ['Arquivo', 9, 'servidor:1:9:Arquivo', true],
    ])
    const inbox = await service.messages({ accountId: id })
    expect(inbox.some((message) => message.subject.startsWith('Fatura'))).toBe(false)
  })

  it('marcar lida e estrela: STORE no servidor, no store, e avisa', async () => {
    const { fake, service, received } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('lida'), { markRead: true }), rule(subjectHas('estrela'), { flag: true })])
    await fake.deliver({ from: marina, subject: 'Fica lida', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    await fake.deliver({ from: marina, subject: 'Com estrela', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(fake.sessionLog).toEqual(['UID STORE 5 +FLAGS (\\Seen)', 'UID STORE 6 +FLAGS (\\Flagged)'])
    expect(received.map((item) => [item.message.seen, item.message.flagged, item.notify])).toEqual([
      [true, false, true],
      [false, true, true],
    ])
    const inbox = await service.messages({ accountId: id })
    expect(inbox.find((message) => message.subject === 'Fica lida')?.seen).toBe(true)
    expect(inbox.find((message) => message.subject === 'Com estrela')?.flagged).toBe(true)
  })

  it('apagar vai para a Lixeira (nenhum EXPUNGE na INBOX) e não avisa', async () => {
    const { fake, service, received } = setup({ trash: true })
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('spam'), { delete: true })])
    await fake.deliver({ from: marina, subject: 'Promoção spam', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(fake.mailboxes()['Lixeira']?.uids).toEqual([1])
    expect(fake.sessionLog.some((line) => line.includes('EXPUNGE') || line.includes('Deleted'))).toBe(false)
    expect(fake.folderLog).toEqual(['UID MOVE 5 Lixeira'])
    expect(received[0]).toMatchObject({ notify: false, message: { mailbox: 'Lixeira' } })
  })

  it('sem Lixeira: fica na INBOX com `no-trash`, onMessage chamado', async () => {
    const { fake, service, received, settings } = setup()
    const id = await connected(service)
    const spam = rule(subjectHas('spam'), { delete: true })
    // Offline na gravação não confere; aqui grava direto no settings (como um arquivo antigo).
    await settings.setEmailRules(id, [spam])
    await fake.deliver({ from: marina, subject: 'Promoção spam', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]?.message.mailbox).toBe('INBOX')
    expect(fake.folderLog.filter((line) => line.startsWith('UID MOVE'))).toEqual([])
    const got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.state[spam.id]?.lastError?.code).toBe('no-trash')
  })

  it('"não avisar": notify false; sem regra que case, notify true', async () => {
    const { fake, service, received } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('silêncio'), { silent: true })])
    await fake.deliver({ from: marina, subject: 'Em silêncio', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    await fake.deliver({ from: marina, subject: 'Normal', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received.map((item) => item.notify)).toEqual([false, true])
    expect(fake.sessionLog).toEqual([])
  })

  it('condição de corpo e de anexo: o corpo é baixado e guardado', async () => {
    const { fake, service, received } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule([{ field: 'body', value: 'boleto' }], { flag: true }), rule([{ field: 'hasAttachment' }], { markRead: true })])
    await fake.deliver({ from: marina, subject: 'A', text: 'Segue o boleto.', attachments: [{ name: 'a.txt', type: 'text/plain', content: 'oi' }] })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]?.message).toMatchObject({ seen: true, flagged: true })
    expect(await service.cachedBody(id, received[0]?.message as EmailMessage)).toMatchObject({ text: expect.stringContaining('boleto') })
  })

  it('sem deadlock: a chegada com mover termina e o próximo IDLE é processado', async () => {
    const { fake, service, received } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('mover'), { moveTo: 'Arquivo' })])
    await fake.deliver({ from: marina, subject: 'Para mover', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 1000 })
    await fake.deliver({ from: marina, subject: 'Depois', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 1000 })
    // E o mover da tela, na mesma fila, também volta.
    const moved = await service.moveMessages(id, 'INBOX', [received[1]?.message.uid as number], 'Arquivo')
    expect(moved.ok).toBe(true)
  })

  it('não roda no sincronismo da conexão nem no que entrou por "Mover"', async () => {
    const { fake, service, received, userData } = setup()
    const id = await connected(service)
    await saveRules(service, id, [rule(subjectHas('Proposta'), { moveTo: 'Arquivo' }), rule(subjectHas('Contrato'), { flag: true })])
    // Volta a conectar (outro serviço, mesmo userData): a "Proposta revisada" já estava na INBOX e fica.
    await service.dispose()
    const again = createEmailService({
      root: join(userData, 'email'),
      settings: createFileSettingsStore({ dir: userData }),
      safeStorage: fakeSafeStorage(),
      fetch: () => Promise.reject(new Error('x')),
      onStatus: () => undefined,
      onMessage: (message, { notify }) => received.push({ message, notify }),
      imap: fake.imap,
      imapFolders: fake.imapFolders,
      retryMs: 3_600_000,
      now: () => NOW,
    })
    cleanups.push(() => again.dispose())
    await again.init()
    await vi.waitFor(() => expect(again.accounts()[0]?.state).toBe('connected'))
    expect(fake.folderLog).toEqual([])
    // Do "Arquivo" para a INBOX pela tela: a regra de estrela não pega.
    await again.openFolder(id, 'Arquivo')
    expect((await again.moveMessages(id, 'Arquivo', [7], 'INBOX')).ok).toBe(true)
    await fake.deliver({ from: marina, subject: 'Qualquer', text: 'x' })
    await vi.waitFor(() => expect(received.map((item) => item.message.subject)).toEqual(['Qualquer']))
    expect(fake.sessionLog).toEqual([])
    expect(fake.folderLog).toEqual(['UID MOVE 7 INBOX'])
  })
})

describe('pasta de destino que some ou muda (CA6, CA8, CA9)', () => {
  it('sumiu por fora: fica na INBOX com `folder-missing` e avisa; a próxima com sucesso limpa o erro', async () => {
    const { fake, service, received } = setup({ folders: [{ path: 'Projetos' }] })
    const id = await connected(service)
    const move = rule(subjectHas('projeto'), { moveTo: 'Projetos' })
    await saveRules(service, id, [move])
    // Apagada no "webmail" (direto no servidor falso): o `LIST` guardado ainda a tem.
    const direct = await fake.imapFolders({ host: 'x', port: 1, security: 'tls', user: 'x', pass: SMOKE_EMAIL_PASSWORD })
    await direct.delete('Projetos')
    await fake.deliver({ from: marina, subject: 'Novo projeto', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toMatchObject({ notify: true, message: { mailbox: 'INBOX' } })
    let got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.state[move.id]?.lastError?.code).toBe('folder-missing')
    expect(service.accounts()[0]?.state).toBe('connected')
    // Criada de novo: a próxima chegada move e limpa o erro.
    await direct.create('Projetos')
    await fake.deliver({ from: marina, subject: 'Outro projeto', text: 'x' })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received[1]?.message.mailbox).toBe('Projetos')
    got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.state[move.id]).toMatchObject({ lastError: null, hits: 1 })
  })

  it('renomeada pelo app: a regra (e a de subpasta) segue; apagada pelo app: a regra fica, com `folder-missing`', async () => {
    const { service } = setup({ folders: [{ path: 'Clientes/LAP' }, { path: 'Velha' }] })
    const id = await connected(service)
    const top = rule(subjectHas('a'), { moveTo: 'Clientes' })
    const sub = rule(subjectHas('b'), { moveTo: 'Clientes/LAP' })
    const old = rule(subjectHas('c'), { moveTo: 'Velha' })
    await saveRules(service, id, [top, sub, old])
    expect(await service.renameFolder(id, 'Clientes', 'Contas')).toEqual({ ok: true, path: 'Contas' })
    let got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.rules.map((item) => item.actions.moveTo)).toEqual(['Contas', 'Contas/LAP', 'Velha'])
    expect(await service.deleteFolder(id, 'Velha', true)).toEqual({ ok: true })
    got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.rules.map((item) => item.id)).toEqual([top.id, sub.id, old.id])
    expect(got.ok && got.rules[2]?.enabled).toBe(true)
    expect(got.ok && got.state[old.id]?.lastError?.code).toBe('folder-missing')
  })

  it('gravar: pasta que não existe → folder-missing, nada gravado; apagar sem Lixeira grava com `no-trash` na regra', async () => {
    const { service } = setup()
    const id = await connected(service)
    expect(await service.rulesSet({ accountId: id, rules: [rule(subjectHas('x'), { moveTo: 'Não existe' })] })).toEqual({ ok: false, error: 'folder-missing' })
    expect(await service.rulesSet({ accountId: id, rules: [{ ...rule(subjectHas('x'), { markRead: true }), id: 'x' }] })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.rulesSet({ accountId: '0f8fad5b-d9cb-469f-a165-70867728950e', rules: [] })).toEqual({ ok: false, error: 'missing' })
    let got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.rules).toEqual([])
    const spam = rule(subjectHas('spam'), { delete: true })
    const flag = rule(subjectHas('x'), { flag: true })
    expect(await service.rulesSet({ accountId: id, rules: [spam, flag] })).toEqual({ ok: true, rules: [spam, flag] })
    got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.rules.map((item) => item.id)).toEqual([spam.id, flag.id])
    expect(got.ok && got.state[spam.id]?.lastError).toEqual({ at: NOW, code: 'no-trash' })
    expect(got.ok && got.state[flag.id]?.lastError).toBeNull()
  })

  it('regra antiga quebrada não trava a lista: editar outra grava; desligar a quebrada grava; a nova com destino inexistente não (B2)', async () => {
    const { fake, service, settings } = setup({ folders: [{ path: 'Projetos' }] })
    const id = await connected(service)
    const broken = rule(subjectHas('projeto'), { moveTo: 'Projetos' })
    // A de apagar veio de um arquivo antigo (a conta não tem Lixeira).
    const oldDelete = rule(subjectHas('spam'), { delete: true })
    const other = rule(subjectHas('x'), { flag: true })
    await settings.setEmailRules(id, [broken, oldDelete, other])
    const direct = await fake.imapFolders({ host: 'x', port: 1, security: 'tls', user: 'x', pass: SMOKE_EMAIL_PASSWORD })
    await direct.delete('Projetos')
    // Editar a outra (nome e ações): grava, sem olhar o destino das que não mudaram.
    const edited = { ...other, name: 'Outra', actions: { ...other.actions, flag: false, markRead: true } }
    expect(await service.rulesSet({ accountId: id, rules: [broken, oldDelete, edited] })).toEqual({ ok: true, rules: [broken, oldDelete, edited] })
    // Desligar a quebrada (com as mesmas ações ou não): grava.
    const off = { ...broken, enabled: false, actions: { ...broken.actions, moveTo: 'Outra que não existe' } }
    expect(await service.rulesSet({ accountId: id, rules: [off, oldDelete, edited] })).toEqual({ ok: true, rules: [off, oldDelete, edited] })
    // Regra nova (ou ligada com o destino trocado) para pasta que não existe: recusada, nada muda.
    const fresh = rule(subjectHas('novo'), { moveTo: 'Projetos' })
    expect(await service.rulesSet({ accountId: id, rules: [off, oldDelete, edited, fresh] })).toEqual({ ok: false, error: 'folder-missing' })
    expect(await service.rulesSet({ accountId: id, rules: [{ ...edited, actions: { ...edited.actions, moveTo: 'Projetos' } }] })).toEqual({ ok: false, error: 'folder-missing' })
    const got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.rules).toEqual([off, oldDelete, edited])
  })
})

describe('falha no meio da aplicação (CA6)', () => {
  it('uma etapa lança depois de um MOVE feito: a movida fica dita como movida, a contagem e o erro gravam', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'scribe-regras-'))
    cleanups.push(() => rmSync(userData, { recursive: true, force: true }))
    const real = createEmailStore(join(userData, 'email'))
    const gate = { armed: false, log: [] as string[] }
    const store: EmailStore = {
      ...real,
      // Depois do primeiro `MOVE`, a leitura do store (o começo do segundo mover) falha uma vez.
      read: (accountId) => {
        if (gate.armed && gate.log.some((line) => line.startsWith('UID MOVE'))) {
          gate.armed = false
          return Promise.reject(new Error('disco'))
        }
        return real.read(accountId)
      },
    }
    const { fake, service, received } = setup({ folders: [{ path: 'Projetos' }] }, { store }, userData)
    gate.log = fake.folderLog
    const id = await connected(service)
    const archive = rule(subjectHas('fatura'), { moveTo: 'Arquivo' })
    const project = rule(subjectHas('projeto'), { moveTo: 'Projetos' })
    await saveRules(service, id, [archive, project])
    gate.armed = true
    await Promise.all([fake.deliver({ from: marina, subject: 'Fatura 1', text: 'x' }), fake.deliver({ from: marina, subject: 'Novo projeto', text: 'x' })])
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(fake.folderLog.filter((line) => line.startsWith('UID MOVE'))).toEqual(['UID MOVE 5 Arquivo'])
    expect(received.map((item) => [item.message.subject, item.message.mailbox])).toEqual([
      ['Fatura 1', 'Arquivo'],
      ['Novo projeto', 'INBOX'],
    ])
    const got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.state[archive.id]).toMatchObject({ hits: 1, lastError: null })
    expect(got.ok && got.state[project.id]).toMatchObject({ hits: 0, lastError: { code: 'server' } })
    expect(service.accounts()[0]?.state).toBe('connected')
  })
})

// POP3 em memória: as mensagens numeradas, com UIDL.
function memoryPop3(): { connect: Pop3Connect; add(subject: string): void; down: boolean } {
  const messages: { uidl: string; raw: Buffer }[] = []
  const state = {
    down: true,
    add(subject: string) {
      const n = messages.length + 1
      messages.push({ uidl: `uidl-${n}`, raw: Buffer.from(`From: Marina <marina@cliente.example>\r\nTo: ana@exemplo.com.br\r\nSubject: ${subject}\r\nMessage-ID: <p${n}@cliente.example>\r\n\r\nCorpo ${n}\r\n`) })
    },
    connect: (async () => {
      if (state.down) throw Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })
      return {
        uidl: async () => new Map(messages.map((item, index) => [index + 1, item.uidl])),
        sizes: async () => new Map(messages.map((item, index) => [index + 1, item.raw.length])),
        retr: async (number: number) => messages[number - 1]?.raw ?? Buffer.alloc(0),
        dele: async () => undefined,
        quit: async () => undefined,
        close: () => undefined,
      }
    }) as Pop3Connect,
  }
  return state
}

describe('POP3 (CA4, CA9)', () => {
  it('não roda no primeiro poll; depois "marcar lida" e "não avisar" funcionam; mover → pop3', async () => {
    const pop = memoryPop3()
    const { service, received } = setup({}, { pop3: pop.connect })
    const added = await service.addAccount({ ...imapAccount, address: 'ana@exemplo.com.br', incoming: { protocol: 'pop3', host: 'pop.exemplo.com.br', port: 995, security: 'tls' } })
    if (!added.ok) throw new Error('conta')
    const id = added.status.account.id
    await vi.waitFor(() => expect(service.accounts()[0]?.state).toBe('error'))
    expect(await service.rulesSet({ accountId: id, rules: [rule(subjectHas('x'), { moveTo: 'Arquivo' })] })).toEqual({ ok: false, error: 'pop3' })
    expect(await service.rulesSet({ accountId: id, rules: [rule(subjectHas('x'), { flag: true })] })).toEqual({ ok: false, error: 'pop3' })
    await saveRules(service, id, [rule(subjectHas('Aviso'), { markRead: true, silent: true })])
    pop.add('Aviso antigo')
    pop.down = false
    await service.poll(id)
    // Primeiro poll: nem aviso nem regra.
    expect(received).toEqual([])
    expect((await service.messages({ accountId: id }))[0]?.seen).toBe(false)
    pop.add('Aviso novo')
    pop.add('Outro')
    await service.poll(id)
    expect(received.map((item) => [item.message.subject, item.message.seen, item.notify])).toEqual([
      ['Aviso novo', true, false],
      ['Outro', false, true],
    ])
    expect((await service.messages({ accountId: id })).find((message) => message.subject === 'Aviso novo')?.seen).toBe(true)
  })
})

describe('"Executar agora" (CA10)', () => {
  it('preview conta sem mudar nada; run com o token age; o token não vale duas vezes', async () => {
    const { fake, service } = setup()
    const id = await connected(service)
    const archive = rule([{ field: 'from', value: 'cliente.example' }], { moveTo: 'Arquivo', markRead: true }, { enabled: false })
    await saveRules(service, id, [archive])
    const preview = await service.rulesPreview({ accountId: id, ruleId: archive.id })
    expect(preview).toMatchObject({ ok: true, count: 1, actions: { markRead: true, flag: false, moveTo: 'Arquivo', delete: false } })
    expect(fake.folderLog).toEqual([])
    expect(fake.sessionLog).toEqual([])
    if (!preview.ok) throw new Error('preview')
    expect(await service.rulesRun({ accountId: id, ruleId: archive.id, token: preview.token })).toEqual({ ok: true, done: 1, skipped: 0 })
    expect(fake.folderLog).toEqual(['UID MOVE 4 Arquivo'])
    expect(fake.sessionLog).toEqual(['UID STORE 4 +FLAGS (\\Seen)'])
    expect(await service.rulesRun({ accountId: id, ruleId: archive.id, token: preview.token })).toEqual({ ok: false, error: 'stale' })
    const got = await service.rulesGet({ accountId: id })
    expect(got.ok && got.state[archive.id]).toMatchObject({ lastRunAt: NOW, hits: 1, lastError: null })
  })

  it('token vencido, de outra conta, ou com a regra editada no meio → stale sem efeito', async () => {
    const { fake, service, clock } = setup()
    const id = await connected(service)
    const other = await connected(service, { ...imapAccount, address: 'outra@lap.example' })
    const flag = rule(subjectHas('Backup'), { flag: true })
    await saveRules(service, id, [flag])
    await saveRules(service, other, [flag])
    const token = async (accountId: string): Promise<string> => {
      const preview = await service.previewRule(accountId, flag.id)
      if (!preview.ok) throw new Error('preview')
      return preview.token
    }
    const late = await token(id)
    clock.now += EMAIL_RULE_TOKEN_TTL_MS + 1
    expect(await service.runRule(id, flag.id, late)).toEqual({ ok: false, error: 'stale' })
    clock.now = NOW
    expect(await service.runRule(other, flag.id, await token(id))).toEqual({ ok: false, error: 'stale' })
    const edited = await token(id)
    await saveRules(service, id, [{ ...flag, name: 'Outro nome' }])
    expect(await service.runRule(id, flag.id, edited)).toEqual({ ok: false, error: 'stale' })
    expect(fake.sessionLog).toEqual([])
  })

  it('mensagem que saiu da INBOX entre os dois passos → skipped', async () => {
    const { service } = setup()
    const id = await connected(service)
    const flag = rule([{ field: 'from', value: '.example' }], { flag: true })
    await saveRules(service, id, [flag])
    const preview = await service.previewRule(id, flag.id)
    if (!preview.ok) throw new Error('preview')
    expect(preview.count).toBe(4)
    expect((await service.moveMessages(id, 'INBOX', [1], 'Arquivo')).ok).toBe(true)
    expect(await service.runRule(id, flag.id, preview.token)).toEqual({ ok: true, done: 3, skipped: 1 })
  })
})

describe('estado das regras (CA7)', () => {
  it('nada do email no arquivo nem no log; conta removida apaga o arquivo; regra apagada sai do estado', async () => {
    const { fake, service, userData, logs } = setup({ trash: true })
    const id = await connected(service)
    const move = rule(subjectHas('sigiloso'), { moveTo: 'Arquivo' })
    const keep = rule(subjectHas('nada'), { flag: true })
    await saveRules(service, id, [move, keep])
    await fake.deliver({ from: marina, subject: 'Assunto sigiloso', text: 'texto secreto' })
    await vi.waitFor(async () => {
      const got = await service.rulesGet({ accountId: id })
      expect(got.ok && got.state[move.id]?.hits).toBe(1)
    })
    const file = join(userData, 'email', `${id}.rules-state.json`)
    const content = readFileSync(file, 'utf8')
    for (const text of ['sigiloso', 'secreto', 'marina', 'Marina']) {
      expect(content).not.toContain(text)
      expect(logs.join('\n')).not.toContain(text)
    }
    await saveRules(service, id, [keep])
    expect(Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { rules: object }).rules)).toEqual([])
    expect(await service.removeAccount({ accountId: id })).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(join(userData, SETTINGS_FILE), 'utf8')).not.toContain('emailRules')
  })
})

describe('settings (CA2)', () => {
  it('leitura leniente: a regra inválida (ou repetida) sai sozinha; conta inexistente → false; fora do formato lança', async () => {
    const { service, userData } = setup()
    const id = await connected(service)
    const good = rule(subjectHas('x'), { markRead: true })
    const file = JSON.parse(readFileSync(join(userData, SETTINGS_FILE), 'utf8')) as Record<string, unknown>
    const ghost = '0b8f5a52-6f6c-4f0e-9a51-6c1f0f7e9d10'
    writeFileSync(join(userData, SETTINGS_FILE), JSON.stringify({ ...file, emailRules: { [id]: [good, { ...good, actions: {} }, good, { ...good, id: uuid(), conditions: [] }], [ghost]: [good] } }))
    const store = createFileSettingsStore({ dir: userData })
    expect(await store.getEmailRules()).toEqual({ [id]: [good] })
    expect(await store.setEmailRules(ghost, [good])).toBe(false)
    await expect(store.setEmailRules(id, [good, good])).rejects.toThrow()
    expect(await store.getEmailRules()).toEqual({ [id]: [good] })
  })
})

describe('corpos órfãos (CA11)', () => {
  const body: EmailBody = { text: 'x', html: null, attachments: [] }
  const ACCOUNT = '0f8fad5b-d9cb-469f-a165-70867728950e'

  it('pruneBodies: 205 corpos, 200 na lista → sobram 200; temporário velho sai, o novo fica', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scribe-orfaos-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const store = createEmailStore(root, () => NOW)
    const keys = Array.from({ length: 205 }, (_v, index) => `inbox:${index + 1}`)
    for (const key of keys) await store.setBody(ACCOUNT, key, body)
    await store.setRaw(ACCOUNT, 'sent:<s@lap.example>', Buffer.from('eml'))
    const dir = join(root, `${ACCOUNT}.bodies`)
    writeFileSync(join(dir, 'a.json.tmp-1-velho'), 'x')
    utimesSync(join(dir, 'a.json.tmp-1-velho'), (NOW - 11 * 60_000) / 1000, (NOW - 11 * 60_000) / 1000)
    writeFileSync(join(dir, 'b.json.tmp-1-novo'), 'x')
    utimesSync(join(dir, 'b.json.tmp-1-novo'), NOW / 1000, NOW / 1000)
    expect(await store.pruneBodies(ACCOUNT, [...keys.slice(5), 'sent:<s@lap.example>'])).toBe(6)
    const left = readdirSync(dir)
    expect(left.filter((name) => name.endsWith('.json'))).toHaveLength(200)
    expect(left.filter((name) => name.endsWith('.eml'))).toHaveLength(1)
    expect(left).toContain('b.json.tmp-1-novo')
    expect(left).not.toContain('a.json.tmp-1-velho')
    expect(await createEmailStore(join(root, 'nada')).pruneBodies(ACCOUNT, [])).toBe(0)
  })

  it('init() e o sincronismo limpam a sobra antiga; os da lista (e o .eml dos enviados) ficam', async () => {
    const { service, userData, fake } = setup()
    const id = await connected(service)
    await service.dispose()
    const store = createEmailStore(join(userData, 'email'))
    const sent: EmailMessage = { id: '<s1@lap.example>', accountId: id, mailbox: 'Enviados', uid: null, seen: true, flagged: false, answered: false, from: [], to: [], cc: [], subject: 'Enviado', date: NOW, messageId: '<s1@lap.example>', inReplyTo: null, references: [] }
    await store.update(id, (data) => ({ ...data, sent: [sent] }))
    await store.setBody(id, 'sent:<s1@lap.example>', body)
    await store.setRaw(id, 'sent:<s1@lap.example>', Buffer.from('eml'))
    await store.setBody(id, 'inbox:1', body)
    for (let uid = 100; uid < 110; uid++) await store.setBody(id, `inbox:${uid}`, body)
    const again = setup({}, { imap: fake.imap, imapFolders: fake.imapFolders }, userData).service
    await again.init()
    await vi.waitFor(() => expect(readdirSync(join(userData, 'email', `${id}.bodies`)).sort()).toHaveLength(3))
    expect(await store.raw(id, 'sent:<s1@lap.example>')).toEqual(Buffer.from('eml'))
    expect(await store.body(id, 'inbox:1')).toEqual(body)
    expect(await store.body(id, 'inbox:100')).toBeNull()
  })

  it('a 31ª pasta aberta: os corpos da pasta que saiu pelo teto são apagados', async () => {
    const folders = Array.from({ length: 31 }, (_v, index) => ({ path: `P${String(index).padStart(2, '0')}` }))
    const { service, fake, clock } = setup({ folders })
    const id = await connected(service)
    const direct = await fake.imapFolders({ host: 'x', port: 1, security: 'tls', user: 'x', pass: SMOKE_EMAIL_PASSWORD })
    await direct.move('Arquivo', [7], 'P00', '1')
    const first = await service.openFolder(id, 'P00')
    if (!first.ok) throw new Error('abrir')
    const message = first.messages[0] as EmailMessage
    expect((await service.body({ accountId: id, id: message.id })).ok).toBe(true)
    expect(await service.cachedBody(id, message)).not.toBeNull()
    for (let index = 1; index <= 30; index++) {
      clock.now += 1000
      await service.openFolder(id, `P${String(index).padStart(2, '0')}`)
    }
    await vi.waitFor(async () => expect(await service.cachedBody(id, message)).toBeNull())
  })
})

describe('corpos órfãos no serviço (CA11, CA14)', () => {
  const body: EmailBody = { text: 'x', html: null, attachments: [] }
  const bodyFiles = (userData: string, id: string): string[] => readdirSync(join(userData, 'email', `${id}.bodies`)).filter((name) => name.endsWith('.json'))

  /** O store do serviço, com cada limpeza guardada para o teste esperar por ela. */
  function watchedStore(userData: string) {
    const real = createEmailStore(join(userData, 'email'))
    const prunes: Promise<number>[] = []
    const store: EmailStore = {
      ...real,
      pruneBodies: (accountId, keep) => {
        const run = real.pruneBodies(accountId, keep)
        prunes.push(run)
        return run
      },
    }
    return { real, store, prunes }
  }

  it('um envio entre a decisão de limpar e a limpeza: o corpo e o .eml do enviado ficam (B1)', async () => {
    const { service: first, userData } = setup()
    const id = await connected(first)
    await first.dispose()
    const real = createEmailStore(join(userData, 'email'))
    const CLICK = '11111111-2222-4333-8444-555555555555'
    const state: { service: EmailService | null; armed: boolean; sent: Promise<unknown> | null; pruned: Promise<number> | null } = { service: null, armed: true, sent: null, pruned: null }
    const store: EmailStore = {
      ...real,
      // A primeira limpeza (a do `init()`) só começa depois de um envio inteiro: a lista lida antes dele não vale.
      pruneBodies: async (accountId, keep) => {
        if (state.armed && state.service) {
          state.armed = false
          state.service.registerClick(1, CLICK)
          state.sent = state.service.send(1, { accountId: id, to: ['bruno@cliente.example'], subject: 'Proposta', text: 'Segue.', attachments: [{ name: 'a.txt', bytes: new Uint8Array([1, 2, 3]) }], clickToken: CLICK })
          await state.sent
          state.pruned = real.pruneBodies(accountId, keep)
          return state.pruned
        }
        return real.pruneBodies(accountId, keep)
      },
    }
    const second = setup({}, { imap: () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })), store }, userData)
    const again = second.service
    state.service = again
    await again.init()
    await vi.waitFor(() => expect(state.pruned).not.toBeNull())
    const result = (await state.sent) as { ok: boolean; messageId: string }
    expect(result.ok).toBe(true)
    await state.pruned
    expect(second.fake.sent).toHaveLength(1)
    expect((await real.read(id)).sent.map((message) => message.id)).toEqual([result.messageId])
    expect(await real.body(id, `sent:${result.messageId}`)).toMatchObject({ text: 'Segue.' })
    expect(await real.raw(id, `sent:${result.messageId}`)).not.toBeNull()
  })

  it('o <conta>.json que não se lê não apaga nada; o válido e vazio limpa', async () => {
    const { service: first, userData } = setup()
    const id = await connected(first)
    await first.dispose()
    const real = createEmailStore(join(userData, 'email'))
    await real.setBody(id, 'inbox:1', body)
    await real.setRaw(id, 'inbox:uidl-9', Buffer.from('eml'))
    // Uma pasta aberta guardada: com o `<conta>.json` ilegível, a lista a manter não fica vazia.
    const boxed: EmailMessage = { id: 'servidor:1:7:Arquivo', accountId: id, mailbox: 'Arquivo', uid: 7, seen: true, flagged: false, answered: false, from: [], to: [], cc: [], subject: 'Arquivada', date: NOW, messageId: null, inReplyTo: null, references: [] }
    await real.updateFolder(id, 'Arquivo', () => ({ path: 'Arquivo', uidValidity: '1', at: NOW, messages: [boxed] }))
    await real.setBody(id, `box:${boxed.id}`, body)
    writeFileSync(join(userData, 'email', `${id}.json`), '{ quebrado')
    const offline = { imap: () => Promise.reject(Object.assign(new Error('fora'), { code: 'ECONNREFUSED' })) }
    const broken = watchedStore(userData)
    await setup({}, { ...offline, store: broken.store }, userData).service.init()
    await vi.waitFor(() => expect(broken.prunes.length).toBeGreaterThan(0))
    expect(await Promise.all(broken.prunes)).toEqual([0])
    expect(await real.body(id, 'inbox:1')).toEqual(body)
    expect(await real.raw(id, 'inbox:uidl-9')).toEqual(Buffer.from('eml'))
    // Agora o arquivo se lê e não lista ninguém: os dois são órfãos.
    await real.update(id, (data) => ({ ...data, inbox: [], sent: [] }))
    const valid = watchedStore(userData)
    await setup({}, { ...offline, store: valid.store }, userData).service.init()
    await vi.waitFor(() => expect(valid.prunes.length).toBeGreaterThan(0))
    expect(await Promise.all(valid.prunes)).toEqual([2])
    expect(await real.body(id, 'inbox:1')).toBeNull()
    expect(await real.body(id, `box:${boxed.id}`)).toEqual(body)
  })

  it('fetchNew: 200 na INBOX com corpo e mais 5 que chegam → sobram 200 corpos, os das novas entre eles', async () => {
    const { fake, service, received, userData } = setup()
    // 4 do servidor falso + 196: a INBOX chega ao teto antes de conectar.
    for (let index = 0; index < 196; index++) await fake.deliver({ from: marina, subject: `Antiga ${index}`, text: 'x' })
    const id = await connected(service)
    const store = createEmailStore(join(userData, 'email'))
    const inbox = (await store.read(id)).inbox
    expect(inbox).toHaveLength(200)
    for (const message of inbox) await store.setBody(id, `inbox:${message.id}`, body)
    // Condição de corpo: as que chegam têm o corpo baixado (e guardado) pela regra.
    await saveRules(service, id, [rule([{ field: 'body', value: 'nunca-casa' }], { flag: true })])
    for (let index = 0; index < 5; index++) {
      await fake.deliver({ from: marina, subject: `Nova ${index}`, text: 'Corpo novo' })
      await vi.waitFor(() => expect(received).toHaveLength(index + 1))
    }
    await vi.waitFor(() => expect(bodyFiles(userData, id)).toHaveLength(200))
    const now = (await store.read(id)).inbox
    expect(now).toHaveLength(200)
    for (const item of received) expect(await store.body(id, `inbox:${item.message.id}`)).toMatchObject({ text: expect.stringContaining('Corpo novo') })
    // Baixar o corpo para a regra não marcou nada como lido (no servidor falso nem no app).
    expect(received.every((item) => !item.message.seen)).toBe(true)
    expect(fake.sessionLog).toEqual([])
  })

  it('POP3: o .eml de mensagem ainda listada fica; o órfão sai', async () => {
    const pop = memoryPop3()
    const { service, userData } = setup({}, { pop3: pop.connect })
    pop.down = false
    pop.add('Primeira')
    pop.add('Segunda')
    const added = await service.addAccount({ ...imapAccount, address: 'ana@exemplo.com.br', incoming: { protocol: 'pop3', host: 'pop.exemplo.com.br', port: 995, security: 'tls' } })
    if (!added.ok) throw new Error('conta')
    const id = added.status.account.id
    await vi.waitFor(async () => expect(await service.messages({ accountId: id })).toHaveLength(2))
    await service.dispose()
    const real = createEmailStore(join(userData, 'email'))
    expect(await real.raw(id, 'inbox:uidl-1')).not.toBeNull()
    await real.setRaw(id, 'inbox:uidl-velho', Buffer.from('eml'))
    const watched = watchedStore(userData)
    await setup({}, { pop3: pop.connect, store: watched.store }, userData).service.init()
    await vi.waitFor(() => expect(watched.prunes.length).toBeGreaterThan(0))
    await Promise.all(watched.prunes)
    expect(await real.raw(id, 'inbox:uidl-1')).not.toBeNull()
    expect(await real.raw(id, 'inbox:uidl-2')).not.toBeNull()
    expect(await real.body(id, 'inbox:uidl-1')).not.toBeNull()
    expect(await real.raw(id, 'inbox:uidl-velho')).toBeNull()
  })
})

describe('o Assistente não tem regra (CA12, N4/F4)', () => {
  it('nem as ferramentas do email nem o servidor MCP falam de regra', () => {
    for (const file of ['src/main/email/assistant-tools.ts', 'src/main/chat/sources.ts', 'src/main/chat/corpus.ts', 'src/main/chat/tools.ts', 'src/main/chat/actions.ts', 'src/main/mcp/service.ts']) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8')
      expect(source, file).not.toMatch(/email-rules|rulesGet|rulesSet|rulesPreview|rulesRun|previewRule|runRule|setEmailRules|getEmailRules/)
    }
  })
})
