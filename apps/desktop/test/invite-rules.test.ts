// Contrato 64 (convites-agenda, Parte A): a regra "É convite → Pôr na agenda" de ponta a ponta. O serviço de email com o
// IMAP/SMTP falsos do smoke (`fake-email.ts`), o serviço de convites de verdade do 62 e o `lap-calendar` falso do 60
// (test/fixtures/fake-lap-calendar.mjs, pelo cliente de verdade). "O helper recebeu" é uma linha do log do falso. A regra
// só cria (nunca atualiza nem tira), nunca pede acesso ao macOS e nunca responde ao organizador: o SMTP falso fica com 0
// mensagens em toda a Parte A. E, por leitura do código, nada fora do clique chega à resposta (N1).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeEmail, SMOKE_EMAIL_ADDRESS, SMOKE_EMAIL_PASSWORD } from '../src/main/email/fake-email'
import { createEmailService, type EmailService, type EmailServiceDeps } from '../src/main/email/service'
import { createInviteService, type InviteService, type InviteSettings } from '../src/main/invites/service'
import type { InviteRecord } from '../src/main/invites/store'
import { createMacCalendar, type MacCalendarOptions } from '../src/main/mac-calendar/process'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFileSettingsStore } from '../src/main/settings/store'
import type { EmailMessage } from '../src/shared/email'
import { newEmailRule, type EmailRule, type EmailRuleActions } from '../src/shared/email-rules'

const ROOT = join(import.meta.dirname, '..')
const HELPER = join(import.meta.dirname, 'fixtures', 'fake-lap-calendar.mjs')
const FIXTURES = join(import.meta.dirname, 'fixtures', 'invites')
const SP = 'America/Sao_Paulo'
const NOW = Date.parse('2026-11-19T13:00:00Z')
const UID = 'servico-reuniao-0001@example.com'
const TITLE = 'Planejamento fictício do trimestre'
const ORGANIZER = { name: 'Carla Fictícia', address: 'carla.ficticia@example.com' }

const fakeSafeStorage = (): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
})

/** Uma fixture do 62, com o convidado trocado pelo endereço da conta (e o UID, se pedido). */
function ics(name: string, patch: { uid?: string; title?: string } = {}): string {
  let text = readFileSync(join(FIXTURES, name), 'utf8').replace(/\r?\n[ \t]/g, '')
  text = text.replace(/mailto:andrew\.teste@example\.org/gi, `mailto:${SMOKE_EMAIL_ADDRESS}`)
  if (patch.uid) text = text.replace(/^UID:.*$/m, `UID:${patch.uid}`)
  if (patch.title) text = text.replace(/^SUMMARY:.*$/m, `SUMMARY:${patch.title}`)
  return text.replace(/\r?\n/g, '\r\n')
}

let counter = 0
const uuid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
function rule(conditions: EmailRule['conditions'], actions: Partial<EmailRuleActions>, extra: Partial<EmailRule> = {}): EmailRule {
  const base = newEmailRule(uuid(), 'Convites')
  return { ...base, conditions, actions: { ...base.actions, ...actions }, ...extra }
}
const inviteRule = (actions: Partial<EmailRuleActions> = {}): EmailRule => rule([{ field: 'isInvite' }], { addToCalendar: true, ...actions })

const account = (host = 'imap.lap.example', protocol: 'imap' | 'pop3' = 'imap') => ({
  address: SMOKE_EMAIL_ADDRESS,
  password: SMOKE_EMAIL_PASSWORD,
  incoming: { protocol, host, port: protocol === 'imap' ? 993 : 995, security: 'tls' },
  outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' },
})

/** Tudo o que os serviços logaram (conferido: nada do convite). */
const allLogs: string[] = []
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface SetupOptions {
  helper?: Record<string, unknown>
  env?: Record<string, string>
  client?: Partial<MacCalendarOptions>
  settings?: Partial<InviteSettings>
  invites?: EmailServiceDeps['invites']
}

function setup(options: SetupOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'convites-regras-'))
  const statePath = join(dir, 'lap-calendar-falso.json')
  const logPath = join(dir, 'lap-calendar-falso.jsonl')
  if (options.helper) writeFileSync(statePath, JSON.stringify(options.helper))
  const fake = createFakeEmail(() => NOW)
  const received: { message: EmailMessage; notify: boolean }[] = []
  const settingsStore = createFileSettingsStore({ dir })
  const inviteSettings: InviteSettings = { inviteCalendarId: 'cal-trabalho', inviteAddOnAccept: true, ...options.settings }
  const calendar = createMacCalendar({
    platform: 'darwin',
    arch: 'arm64',
    systemVersion: '26.6.0',
    packaged: true,
    command: async () => ({ file: process.execPath, args: [HELPER], env: { PATH: '/usr/bin:/bin', FAKE_LAP_CALENDAR_STATE: statePath, FAKE_LAP_CALENDAR_LOG: logPath, TZ: SP, ...options.env } }),
    spawn: (command) => spawn(command.file, [...command.args], { env: command.env, stdio: ['pipe', 'pipe', 'pipe'] }),
    log: (message) => void allLogs.push(message),
    baseDelayMs: 20,
    ...options.client,
  })
  let invites: InviteService | null = null
  const email: EmailService = createEmailService({
    root: join(dir, 'email'),
    settings: settingsStore,
    safeStorage: fakeSafeStorage(),
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    onStatus: () => undefined,
    onMessage: (message, { notify }) => received.push({ message, notify }),
    log: (message) => void allLogs.push(message),
    imap: fake.imap,
    imapReader: fake.imapReader,
    imapFolders: fake.imapFolders,
    pop3: fake.pop3,
    smtp: fake.smtp,
    retryMs: 3_600_000,
    now: () => NOW,
    timeZone: () => SP,
    invites: options.invites ?? {
      addFromRule: (source) => (invites as InviteService).addFromRule(source),
      calendarPresent: () => (invites as InviteService).calendarPresent(),
    },
  })
  invites = createInviteService({
    root: dir,
    calendar,
    settings: () => inviteSettings,
    source: (accountId, id) => email.inviteSource(accountId, id),
    openPath: async () => '',
    now: () => NOW,
    log: (message) => void allLogs.push(message),
  })
  const reply = vi.spyOn(email, 'sendInviteReply')
  cleanups.push(async () => {
    await email.dispose()
    await invites?.dispose()
    await calendar.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const log = (): { cmd: string; args: Record<string, unknown> }[] =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { cmd: string; args: Record<string, unknown> })
      : []
  return {
    dir,
    fake,
    email,
    received,
    settingsStore,
    inviteSettings,
    reply,
    log,
    cmds: (...only: string[]) => log().map((item) => item.cmd).filter((cmd) => only.length === 0 || only.includes(cmd)),
    registry: (): InviteRecord[] => {
      const file = join(dir, 'email', 'invites.json')
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { invites: InviteRecord[] }).invites : []
    },
    ruleStateText: (): string =>
      readdirSync(join(dir, 'email'))
        .filter((name) => name.endsWith('.rules-state.json'))
        .map((name) => readFileSync(join(dir, 'email', name), 'utf8'))
        .join('\n'),
    deliverInvite: (subject: string, name: string, patch: { uid?: string; title?: string } = {}) => {
      const content = ics(name, patch)
      const method = /^METHOD:(\w+)/m.exec(content)?.[1] as 'REQUEST' | 'CANCEL' | 'REPLY'
      return fake.deliver({ from: ORGANIZER, subject, text: `${subject}. Mensagem fictícia.`, calendar: { method, content } })
    },
  }
}

async function connected(email: EmailService, input: Record<string, unknown> = account()): Promise<string> {
  const added = await email.addAccount(input)
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  const id = added.status.account.id
  await vi.waitFor(() => expect(email.accounts().find((status) => status.account.id === id)?.state).toBe('connected'))
  return id
}

async function saveRules(email: EmailService, accountId: string, rules: EmailRule[]): Promise<void> {
  const result = await email.rulesSet({ accountId, rules })
  if (!result.ok) throw new Error(`regras não gravadas: ${result.error}`)
}

async function stateOf(email: EmailService, accountId: string, ruleId: string) {
  const got = await email.rulesGet({ accountId })
  if (!got.ok) throw new Error('rules-get falhou')
  return got.state[ruleId]
}

describe('chegada (contrato 64, CA3)', () => {
  it('REQUEST com a regra: refresh, find e create na agenda padrão; uma linha no registro sem resposta; nada enviado', async () => {
    const s = setup()
    const id = await connected(s.email)
    const convites = inviteRule()
    await saveRules(s.email, id, [convites])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
    expect(s.cmds('refresh', 'find', 'create')).toEqual(['refresh', 'find', 'create'])
    const create = s.log().find((item) => item.cmd === 'create')
    expect(create?.args['calendarId']).toBe(s.inviteSettings.inviteCalendarId)
    expect(s.cmds('request-access')).toEqual([])
    const rows = s.registry()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.event).not.toBeNull()
    expect(rows[0]?.response).toBeNull()
    expect(s.fake.sent).toHaveLength(0)
    expect(s.reply).not.toHaveBeenCalled()
    expect(await stateOf(s.email, id, convites.id)).toMatchObject({ hits: 1, lastError: null })

    // A mesma mensagem de novo (mesmo UID e versão): nada novo na agenda.
    await s.deliverInvite('Convite: planejamento (de novo)', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(2), { timeout: 8000 })
    expect(s.cmds('create')).toHaveLength(1)

    // CANCEL com a mesma regra: a regra nunca tira nem atualiza (C2).
    await s.deliverInvite('Cancelado: planejamento', 'servico-cancel.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(3), { timeout: 8000 })
    expect(s.cmds('remove', 'update')).toEqual([])
    expect(s.fake.sent).toHaveLength(0)
    expect(s.reply).not.toHaveBeenCalled()
  })

  it('o evento já está na agenda pela conta (R5a): nenhum create, sem erro na regra', async () => {
    const accountCopy = { eventIdentifier: 'conta-ev-1', calendarItemIdentifier: 'conta-item-1', externalIdentifier: UID, calendarId: 'cal-trabalho', title: TITLE, start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', timeZone: 'America/New_York', origin: 'account' }
    const s = setup({ helper: { access: 'full', events: [accountCopy] } })
    const id = await connected(s.email)
    const convites = inviteRule()
    await saveRules(s.email, id, [convites])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
    expect(s.cmds('create')).toEqual([])
    expect(await stateOf(s.email, id, convites.id)).toMatchObject({ hits: 1, lastError: null })
  })

  it('mover para Arquivo + pôr na agenda: a mensagem está no Arquivo e o registro aponta para ela (COPYUID)', async () => {
    const s = setup()
    const id = await connected(s.email)
    await saveRules(s.email, id, [inviteRule({ moveTo: 'Arquivo' })])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
    const moved = s.received[0]?.message
    expect(moved?.mailbox).toBe('Arquivo')
    expect(s.fake.mailboxes()['Arquivo']?.uids.length).toBeGreaterThan(0)
    expect(s.registry()[0]?.messageId).toBe(moved?.id)
    expect(s.cmds('create')).toHaveLength(1)
    expect(s.fake.sent).toHaveLength(0)
  })
})

describe('R5b e fora do Mac (contrato 64, CA4)', () => {
  it('conta que já põe sozinha, com a regra gravada direto no settings.json: o helper nem é chamado, sem erro', async () => {
    const s = setup()
    const id = await connected(s.email, account('imap.gmail.com'))
    const convites = inviteRule()
    await s.settingsStore.setEmailRules(id, [convites])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
    expect(s.log()).toEqual([])
    expect((await stateOf(s.email, id, convites.id))?.lastError).toBeNull()
    expect(s.fake.sent).toHaveLength(0)
    expect(allLogs.some((line) => line.includes('regras: pôr na agenda ignorado (a conta já põe)'))).toBe(true)
  })
})

describe('erros (contrato 64, CA5)', () => {
  it('acesso negado ou nunca pedido: calendar-denied, o aviso sai, nenhum pedido de acesso', async () => {
    for (const access of ['denied', 'notDetermined'] as const) {
      const s = setup({ helper: { access } })
      const id = await connected(s.email)
      const convites = inviteRule()
      await saveRules(s.email, id, [convites])
      await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
      await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
      expect(s.received[0]?.notify).toBe(true)
      expect((await stateOf(s.email, id, convites.id))?.lastError?.code).toBe('calendar-denied')
      expect(s.cmds('request-access', 'create')).toEqual([])
      expect(s.fake.sent).toHaveLength(0)
    }
  })

  it('sem agenda padrão: no-calendar, nenhum create', async () => {
    const s = setup({ settings: { inviteCalendarId: null } })
    const id = await connected(s.email)
    const convites = inviteRule()
    await saveRules(s.email, id, [convites])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 8000 })
    expect((await stateOf(s.email, id, convites.id))?.lastError?.code).toBe('no-calendar')
    expect(s.cmds('create')).toEqual([])
  })

  it('o helper não responde: no-calendar, e a regra de mover da mesma mensagem moveu; nada do convite no estado nem no log', async () => {
    const s = setup({ env: { FAKE_LAP_CALENDAR_HANG: 'status' }, client: { timeouts: { status: 300 } } })
    const id = await connected(s.email)
    const convites = inviteRule()
    const mover = rule([{ field: 'subject', value: 'planejamento' }], { moveTo: 'Arquivo' })
    // Gravada direto (como um arquivo antigo): o `rules-set` também perguntaria ao helper.
    await s.settingsStore.setEmailRules(id, [convites, mover])
    await s.deliverInvite('Convite: planejamento', 'servico-request-v1.ics')
    await vi.waitFor(() => expect(s.received).toHaveLength(1), { timeout: 10_000 })
    expect(s.received[0]?.message.mailbox).toBe('Arquivo')
    expect((await stateOf(s.email, id, convites.id))?.lastError?.code).toBe('no-calendar')
    expect((await stateOf(s.email, id, mover.id))?.lastError).toBeNull()
    const text = `${s.ruleStateText()}\n${allLogs.join('\n')}`
    expect(text).not.toContain(TITLE)
    expect(text).not.toContain(ORGANIZER.address)
    expect(text).not.toContain('Convite: planejamento')
  }, 15_000)
})

describe('executar agora (contrato 64, CA6)', () => {
  it('conta só as mensagens com convite, diz que põe na agenda e grava as duas', async () => {
    const s = setup()
    const id = await connected(s.email)
    await s.deliverInvite('Convite: um', 'servico-request-v1.ics', { uid: 'regra-um@example.com', title: 'Reunião fictícia um' })
    await s.deliverInvite('Convite: dois', 'servico-request-v1.ics', { uid: 'regra-dois@example.com', title: 'Reunião fictícia dois' })
    await s.fake.deliver({ from: ORGANIZER, subject: 'Sem convite', text: 'Só texto.' })
    await vi.waitFor(() => expect(s.received).toHaveLength(3), { timeout: 8000 })
    const convites = inviteRule()
    await saveRules(s.email, id, [convites])
    const preview = await s.email.previewRule(id, convites.id)
    expect(preview.ok && preview.count).toBe(2)
    expect(preview.ok && preview.actions.addToCalendar).toBe(true)
    if (!preview.ok) return
    const run = await s.email.runRule(id, convites.id, preview.token)
    expect(run).toMatchObject({ ok: true, done: 2 })
    expect(s.cmds('create')).toHaveLength(2)
    expect(s.fake.sent).toHaveLength(0)
    expect(s.reply).not.toHaveBeenCalled()
  }, 15_000)
})

describe('gravar (contrato 64, CA7)', () => {
  it('conta do R5b e fora do Mac recusam e nada muda; POP3 aceita pôr na agenda, mas não estrela', async () => {
    const s = setup()
    const gmail = await connected(s.email, account('imap.gmail.com'))
    const before = await s.settingsStore.getEmailRules()
    expect(await s.email.rulesSet({ accountId: gmail, rules: [inviteRule()] })).toEqual({ ok: false, error: 'auto-calendar' })
    expect(await s.email.rulesSet({ accountId: gmail, rules: [{ ...inviteRule(), enabled: false }] })).toEqual({ ok: false, error: 'auto-calendar' })
    expect(await s.settingsStore.getEmailRules()).toEqual(before)
    const got = await s.email.rulesGet({ accountId: gmail })
    expect(got.ok && got.invite).toEqual({ autoAdds: true, mac: true })

    const noMac = setup({ invites: { addFromRule: async () => ({ ok: false, error: 'no-calendar' }), calendarPresent: async () => false } })
    const own = await connected(noMac.email)
    const ownBefore = await noMac.settingsStore.getEmailRules()
    expect(await noMac.email.rulesSet({ accountId: own, rules: [inviteRule()] })).toEqual({ ok: false, error: 'no-mac' })
    expect(await noMac.settingsStore.getEmailRules()).toEqual(ownBefore)
    const ownGot = await noMac.email.rulesGet({ accountId: own })
    expect(ownGot.ok && ownGot.invite).toEqual({ autoAdds: false, mac: false })

    const pop = setup({ invites: { addFromRule: async () => ({ ok: true, effect: 'created' }), calendarPresent: async () => true } })
    // O POP3 não precisa estar conectado para gravar (o `rules-set` só confere o protocolo).
    const added = await pop.email.addAccount(account('pop.lap.example', 'pop3'))
    const pop3 = added.ok ? added.status.account.id : ''
    expect((await pop.email.rulesSet({ accountId: pop3, rules: [inviteRule()] })).ok).toBe(true)
    expect(await pop.email.rulesSet({ accountId: pop3, rules: [rule([{ field: 'isInvite' }], { flag: true })] })).toEqual({ ok: false, error: 'pop3' })
  })
})

describe('nenhuma regra, tarefa ou IA responde convite (N1)', () => {
  it('estático: os arquivos das regras, da sugestão, das tarefas, dos agentes, do Assistente, do chat e do MCP não falam em responder convite', () => {
    const src = join(ROOT, 'src')
    const files = [
      'main/email/rules.ts',
      'main/invites/suggest.ts',
      'shared/invite-suggest.ts',
      'main/email/assistant-tools.ts',
      ...['main/schedules', 'main/agents', 'main/chat', 'main/mcp'].flatMap((folder) =>
        existsSync(join(src, folder))
          ? readdirSync(join(src, folder))
              .filter((name) => name.endsWith('.ts'))
              .map((name) => `${folder}/${name}`)
          : [],
      ),
    ]
    expect(files.length).toBeGreaterThan(5)
    const offenders = files.filter((file) => /sendInviteReply|inviteReply|buildReply|invite-reply|icalEvent|method=REPLY|METHOD:REPLY/.test(readFileSync(join(src, file), 'utf8')))
    expect(offenders.map((file) => relative(src, join(src, file)))).toEqual([])
  })

  it('estático: o executePlans só chega ao serviço de convites pelo addFromRule', () => {
    const service = readFileSync(join(ROOT, 'src/main/email/service.ts'), 'utf8')
    const start = service.indexOf('async function executePlans(')
    const end = service.indexOf('async function saveTally(')
    const body = service.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect([...body.matchAll(/deps\.invites\.(\w+)/g)].map((match) => match[1])).toEqual(['addFromRule'])
    expect(body).not.toMatch(/requestAccess|request-access|sendInviteReply/)
  })
})
