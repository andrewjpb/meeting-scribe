// Contrato 62 (convites-agenda, CA1 a CA24): o serviço de convites contra o `lap-calendar` falso
// (test/fixtures/fake-lap-calendar.mjs), subido pelo cliente de verdade do 60 (`createMacCalendar`) como no
// mac-calendar.test.ts. "O helper recebeu" é uma linha do log do falso (`FAKE_LAP_CALENDAR_LOG`). Os convites saem das
// fixtures do 59 e das `servico-*.ics` (fictícias), lidas por `parseInvite`. Nada contra o binário de verdade nem o
// Calendário do Mac; nenhuma rede.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleParser } from 'mailparser'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createFakeEmail, SMOKE_EMAIL_PASSWORD } from '../src/main/email/fake-email'
import { parseEmail } from '../src/main/email/service'
import { changesOf, createArgs, inviteSelfAdding, normalizeWhen, refFields, updateFields } from '../src/main/invites/map'
import { createInviteService, INVITE_REFRESH_MIN_MS, INVITE_RECONCILE_MIN_MS, type InviteService, type InviteSettings, type InviteSource } from '../src/main/invites/service'
import type { InviteEventRef, InviteRecord } from '../src/main/invites/store'
import { createMacCalendar, type MacCalendar, type MacCalendarOptions } from '../src/main/mac-calendar/process'
import { accessSchema, createArgsSchema, MAC_CALENDAR_MAX_NOTES } from '../src/main/mac-calendar/protocol'
import { parseSettings, parseSettingsPatch } from '../src/main/settings/schema'
import type { EmailAccount, InviteRepliedEvent } from '../src/shared/email'
import { parseInvite, type EmailInvite } from '../src/shared/invite'
import { INVITE_ERROR_MESSAGES, type InviteCalendarAccess, type InviteState } from '../src/shared/invite-state'
import { WHEN_LOCKED } from '../src/shared/ipc'
import { privacyPaneUrl } from '../src/shared/privacy'

const ROOT = join(import.meta.dirname, '..')
const FAKE = join(import.meta.dirname, 'fixtures', 'fake-lap-calendar.mjs')
const FIXTURES = join(import.meta.dirname, 'fixtures', 'invites')
const SELF = 'andrew.teste@example.org'
const SP = 'America/Sao_Paulo'
const CONTEXT = { self: [SELF], localTimeZone: SP }
const ACCOUNT_ID = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const NOW = Date.parse('2026-11-19T18:30:00.000Z')
const UID = 'servico-reuniao-0001@example.com'
const SERIES_UID = 'servico-serie-0001@example.com'
const TITLE = 'Planejamento fictício do trimestre'

/** Tudo o que o serviço e o cliente logaram, de todos os casos (conferido no fim: nenhum dado de evento). */
const allLogs: string[] = []

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

function inviteFrom(name: string): EmailInvite {
  const content = fixture(name)
  const method = /^METHOD:(\w+)/m.exec(content)?.[1] ?? null
  const result = parseInvite([{ contentType: 'text/calendar', filename: null, method, content }], CONTEXT)
  if (!result.ok) throw new Error(`fixture ${name}: ${result.error}`)
  return result.invite
}

const account = (host = 'mail.lapsoftware.com.br'): EmailAccount => ({
  id: ACCOUNT_ID,
  address: SELF,
  name: 'Andrew Teste',
  username: SELF,
  incoming: { host, port: 993, security: 'tls', protocol: 'imap' },
  outgoing: { host, port: 465, security: 'tls' },
  deleteFromServer: false,
})

const MESSAGES: Record<string, string> = {
  'm-v1': 'servico-request-v1.ics',
  'm-v2': 'servico-request-v2.ics',
  'm-cancel': 'servico-cancel.ics',
  'm-weekly': 'servico-weekly.ics',
  'm-cancel-occ': 'servico-cancel-occurrence.ics',
  'm-rdate': 'rdate.ics',
  'm-reply': 'reply-received.ics',
}

interface Setup {
  dir: string
  service: InviteService
  calendar: MacCalendar
  settings: InviteSettings
  clock: { now: number }
  opened: string[]
  spawned: () => number
  /** As requisições que o falso recebeu. */
  log: () => { cmd: string; args: Record<string, unknown> }[]
  cmds: () => string[]
  helperState: () => { events: Record<string, unknown>[]; [key: string]: unknown }
  writeHelperState: (patch: Record<string, unknown>) => void
  registry: () => InviteRecord[]
  dispose: () => Promise<void>
}

const setups: Setup[] = []
afterEach(async () => {
  for (const item of setups.splice(0)) await item.dispose()
})

function setup(options: { state?: Record<string, unknown>; env?: Record<string, string>; client?: Partial<MacCalendarOptions>; host?: string; settings?: Partial<InviteSettings>; settingsFn?: () => InviteSettings } = {}): Setup {
  const dir = mkdtempSync(join(tmpdir(), 'convites-servico-'))
  const statePath = join(dir, 'lap-calendar-falso.json')
  const logPath = join(dir, 'lap-calendar-falso.jsonl')
  if (options.state) writeFileSync(statePath, JSON.stringify(options.state))
  let spawned = 0
  const calendar = createMacCalendar({
    platform: 'darwin',
    arch: 'arm64',
    systemVersion: '26.6.0',
    packaged: true,
    command: async () => ({ file: process.execPath, args: [FAKE], env: { PATH: '/usr/bin:/bin', FAKE_LAP_CALENDAR_STATE: statePath, FAKE_LAP_CALENDAR_LOG: logPath, TZ: SP, ...options.env } }),
    spawn: (command) => {
      spawned++
      return spawn(command.file, [...command.args], { env: command.env, stdio: ['pipe', 'pipe', 'pipe'] })
    },
    log: (message) => void allLogs.push(message),
    baseDelayMs: 20,
    ...options.client,
  })
  const settings: InviteSettings = { inviteCalendarId: 'cal-trabalho', inviteAddOnAccept: true, ...options.settings }
  const clock = { now: NOW }
  const opened: string[] = []
  const owner = account(options.host)
  const service = createInviteService({
    root: dir,
    calendar,
    settings: options.settingsFn ?? (() => settings),
    source: async (accountId, id): Promise<InviteSource | null> => {
      const name = MESSAGES[id]
      if (accountId !== ACCOUNT_ID || !name) return null
      return { account: owner, invite: inviteFrom(name), messageId: id }
    },
    openPath: async (path) => {
      opened.push(path)
      return ''
    },
    now: () => clock.now,
    log: (message) => void allLogs.push(message),
  })
  const log = (): { cmd: string; args: Record<string, unknown> }[] =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { cmd: string; args: Record<string, unknown> })
      : []
  const result: Setup = {
    dir,
    service,
    calendar,
    settings,
    clock,
    opened,
    spawned: () => spawned,
    log,
    cmds: () => log().map((item) => item.cmd),
    helperState: () => JSON.parse(readFileSync(statePath, 'utf8')) as { events: Record<string, unknown>[] },
    writeHelperState: (patch) => writeFileSync(statePath, JSON.stringify({ ...(existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as object) : {}), ...patch })),
    registry: () => {
      const file = join(dir, 'email', 'invites.json')
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { invites: InviteRecord[] }).invites : []
    },
    dispose: async () => {
      await service.dispose()
      await calendar.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
  setups.push(result)
  return result
}

const request = (id: string) => ({ accountId: ACCOUNT_ID, id })
const addRequest = (id: string, availability: 'busy' | 'tentative' = 'busy') => ({ accountId: ACCOUNT_ID, id, calendarId: 'cal-trabalho', availability })

async function stateOf(service: InviteService, id: string): Promise<InviteState> {
  const result = await service.state(request(id))
  if (!result.ok) throw new Error(`state ${id}: ${result.error}`)
  return result.state
}

function replied(partstat: InviteRepliedEvent['partstat'], patch: Partial<InviteRepliedEvent> = {}): InviteRepliedEvent {
  return { accountId: ACCOUNT_ID, messageId: 'm-v1', mailbox: 'INBOX', uid: UID, recurrenceId: null, sequence: 1, dtstamp: '2026-11-19T10:00:00.000Z', partstat, respondedAt: NOW, replyMessageId: '<resposta-1@lap.example>', ...patch }
}

/** A cópia que a conta pôs na agenda (R5a, R5c): o mesmo UID como external id. */
const accountCopy = (patch: Record<string, unknown> = {}) => ({
  eventIdentifier: 'conta-ev-1',
  calendarItemIdentifier: 'conta-item-1',
  externalIdentifier: UID,
  calendarId: 'cal-trabalho',
  title: TITLE,
  start: '2026-11-20T18:00:00Z',
  end: '2026-11-20T19:00:00Z',
  timeZone: 'America/New_York',
  origin: 'account',
  ...patch,
})

// --- Tipos e mapeamento ------------------------------------------------------------------------------------------

describe('serviço de convites', () => {
  it('CA1: o InviteCalendarAccess repete o enum do protocolo do 60', () => {
    const access: Record<InviteCalendarAccess, true> = { full: true, writeOnly: true, denied: true, restricted: true, notDetermined: true }
    expect(Object.keys(access).sort()).toEqual([...accessSchema.options].sort())
    const source = readFileSync(join(ROOT, 'src/shared/invite-state.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"](node:|electron|\.\.\/main)/)
  })

  it('CA17: as 14 frases fixas', () => {
    expect(INVITE_ERROR_MESSAGES).toEqual({
      missing: 'Não achei o convite desta mensagem.',
      invalid: 'Não foi possível fazer isso agora.',
      old: 'Há uma versão mais nova deste convite.',
      'not-request': 'Este convite não vai para a agenda.',
      recurrence: 'Esta repetição o app não consegue copiar.',
      unavailable: 'O Calendário do Mac não está disponível aqui.',
      denied: 'Sem acesso ao Calendário.',
      restricted: 'O acesso ao Calendário está restrito neste Mac.',
      'no-calendar': 'A agenda escolhida não existe mais. Escolha outra.',
      'read-only-calendar': 'Esta agenda não aceita eventos novos. Escolha outra.',
      'not-owned': 'O app não mexe em evento que ele não pôs na agenda.',
      'not-found': 'Não encontrei este evento na agenda.',
      busy: 'Já há um pedido em andamento para este convite.',
      failed: 'O Calendário não respondeu. Tente de novo.',
    })
  })

  it('CA4: um create válido por fixture do 59; notas cortadas em 4000; rdate sem recurrence', async () => {
    const google = (await parseEmail(readFileSync(join(FIXTURES, 'google-request.eml')), CONTEXT)).body.invite
    if (!google) throw new Error('sem convite no google-request.eml')
    const invites: [string, EmailInvite][] = [
      ['google-request.eml', google],
      ...['outlook-windows-tz.ics', 'zoom-sem-vtimezone.ics', 'icloud-allday.ics', 'weekly-exdate.ics'].map((name): [string, EmailInvite] => [name, inviteFrom(name)]),
    ]
    for (const [name, invite] of invites) {
      const args = createArgs(invite, 'cal-trabalho', 'busy')
      expect(() => createArgsSchema.parse(args), name).not.toThrow()
      expect(args.title).toBe(invite.title)
      expect(args.start).toBe(invite.start)
      if (invite.allDay) expect(args.timeZone).toBeNull()
    }
    const allDay = createArgs(inviteFrom('icloud-allday.ics'), 'cal-trabalho', 'busy')
    expect(allDay.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const weekly = createArgs(inviteFrom('weekly-exdate.ics'), 'cal-trabalho', 'tentative')
    expect(weekly.availability).toBe('tentative')
    expect(weekly.recurrence).toMatchObject({ freq: 'weekly', interval: 1, byDay: [{ day: 'MO' }, { day: 'WE' }] })
    expect(weekly.recurrence?.until).toMatch(/Z$/)
    expect(weekly.exdates?.every((item) => !item.includes('.'))).toBe(true)
    expect(weekly.exdates).toHaveLength(3)
    const meet = createArgs(inviteFrom('servico-request-v1.ics'), 'cal-trabalho', 'busy')
    expect(meet).toMatchObject({ timeZone: 'America/New_York', url: 'https://meet.google.com/fic-tici-aaa', location: 'Sala Ficticia 3' })
    expect(meet.notes?.startsWith('https://meet.google.com/fic-tici-aaa\n\n')).toBe(true)
    const long = { ...inviteFrom('servico-request-v1.ics'), description: `${'a'.repeat(4998)}😀b` }
    const clipped = createArgs(long, 'cal-trabalho', 'busy')
    expect(clipped.notes).toHaveLength(MAC_CALENDAR_MAX_NOTES)
    expect(() => createArgsSchema.parse(createArgs({ ...long, description: 'x'.repeat(5000) }, 'cal-trabalho', 'busy'))).not.toThrow()
    // Sem partir o par substituto: o emoji no limite sai inteiro.
    const surrogate = createArgs({ ...long, joinUrl: null, description: `${'a'.repeat(3999)}😀` }, 'cal-trabalho', 'busy')
    expect(surrogate.notes).toBe('a'.repeat(3999))
    expect(createArgs({ ...long, joinUrl: 'ftp://x.example/a' }, 'cal-trabalho', 'busy').url).toBeUndefined()
    const rdate = createArgs(inviteFrom('rdate.ics'), 'cal-trabalho', 'busy')
    expect(rdate.recurrence).toBeUndefined()
    expect(rdate.exdates).toBeUndefined()
    expect(normalizeWhen('2026-11-20T18:00:00.000Z')).toBe('2026-11-20T18:00:00Z')
    expect(normalizeWhen('2026-11-20')).toBe('2026-11-20')
  })

  it('CA5: updateFields com todos os campos e changesOf do v2 (horário)', () => {
    const v1 = inviteFrom('servico-request-v1.ics')
    const v2 = inviteFrom('servico-request-v2.ics')
    const ref: InviteEventRef = { eventIdentifier: 'e', calendarItemIdentifier: 'i', externalIdentifier: null, calendarId: 'cal-trabalho', availability: 'tentative', occurrence: null, ...refFields(v1) }
    expect(changesOf(ref, v2)).toEqual([
      { field: 'time', before: { start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', allDay: false, timeZone: 'America/New_York' }, after: { start: '2026-11-20T19:30:00Z', end: '2026-11-20T20:30:00Z', allDay: false, timeZone: 'America/New_York' } },
    ])
    expect(changesOf(ref, v1)).toEqual([])
    expect(changesOf(ref, { ...v1, title: 'Outro', location: null })).toEqual([
      { field: 'title', before: TITLE, after: 'Outro' },
      { field: 'location', before: 'Sala Ficticia 3', after: null },
    ])
    const fields = updateFields({ ...v2, location: null }, ref)
    expect(fields).toMatchObject({ title: TITLE, start: v2.start, end: v2.end, allDay: false, timeZone: 'America/New_York', location: '', availability: 'tentative', url: 'https://meet.google.com/fic-tici-aaa', recurrence: null })
    expect(typeof fields.notes).toBe('string')
    const occurrence = updateFields(inviteFrom('occurrence-request.ics'), ref)
    expect('recurrence' in occurrence).toBe(false)
    expect('exdates' in occurrence).toBe(false)
    const series = updateFields(inviteFrom('weekly-exdate.ics'), ref)
    expect(series.recurrence).toMatchObject({ freq: 'weekly' })
    expect(series.exdates).toHaveLength(3)
  })

  it('CA9 (R5b): inviteSelfAdding pelo host IMAP', () => {
    expect(inviteSelfAdding({ incoming: { host: 'imap.gmail.com', port: 993, security: 'tls', protocol: 'imap' } })).toBe(true)
    expect(inviteSelfAdding({ incoming: { host: 'IMAP.GMAIL.COM.', port: 993, security: 'tls', protocol: 'imap' } })).toBe(true)
    expect(inviteSelfAdding({ incoming: { host: 'outlook.office365.com', port: 993, security: 'tls', protocol: 'imap' } })).toBe(true)
    expect(inviteSelfAdding({ incoming: { host: 'mail.lapsoftware.com.br', port: 993, security: 'tls', protocol: 'imap' } })).toBe(false)
  })

  it('CA6: pedido inválido → invalid; mensagem sem convite → missing; o renderer não manda o convite', async () => {
    const { service, spawned } = setup()
    expect(await service.state({ accountId: 'x', id: 'm-v1' })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.state({ ...request('m-v1'), title: 'forjado' })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.state({ accountId: ACCOUNT_ID, id: 'a\nb' })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.state(request('sem-convite'))).toEqual({ ok: false, error: 'missing' })
    expect(await service.add({ ...addRequest('m-v1'), availability: 'free' })).toMatchObject({ ok: false, error: 'invalid', message: INVITE_ERROR_MESSAGES.invalid, state: null })
    expect(await service.add({ ...addRequest('m-v1'), calendarId: '' })).toMatchObject({ ok: false, error: 'invalid' })
    expect(await service.update(request('sem-convite'))).toMatchObject({ ok: false, error: 'missing', state: null })
    expect(await service.openIcs(undefined)).toEqual({ ok: false, error: 'invalid' })
    expect(spawned()).toBe(0)
  })
})

// --- Verificação end-to-end ------------------------------------------------------------------------------------

describe('verificação end-to-end contra o helper falso', () => {
  it('passo 2: aceitar com "Pôr na agenda" cria o evento com tudo e grava a linha', async () => {
    const { service, log, registry } = setup()
    const first = await stateOf(service, 'm-v1')
    expect(first).toMatchObject({ kind: 'new', calendar: { status: 'absent' }, actions: { add: true, update: false, remove: false, openIcs: false }, defaultCalendarId: 'cal-trabalho', replyable: true, notForMe: false })
    await service.recordReply(replied('ACCEPTED'))
    const added = await service.add(addRequest('m-v1'))
    expect(added).toMatchObject({ ok: true, effect: 'created', state: { kind: 'in-calendar', calendar: { status: 'app', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' } } })
    const creates = log().filter((item) => item.cmd === 'create')
    expect(creates).toHaveLength(1)
    const args = creates[0]?.args ?? {}
    expect(args['title']).toBe(TITLE)
    expect(normalizeWhen(String(args['start']))).toBe('2026-11-20T18:00:00Z')
    expect(normalizeWhen(String(args['end']))).toBe('2026-11-20T19:00:00Z')
    expect(args['timeZone']).toBe('America/New_York')
    expect(args['url']).toBe('https://meet.google.com/fic-tici-aaa')
    expect(String(args['notes']).startsWith('https://meet.google.com/fic-tici-aaa')).toBe(true)
    expect(args['availability']).toBe('busy')
    const row = registry().find((item) => item.uid === UID)
    expect(row).toMatchObject({ response: 'ACCEPTED', event: { calendarItemIdentifier: 'fake-item-1', calendarId: 'cal-trabalho', start: '2026-11-20T18:00:00Z', sequence: 1 } })
    const state = await stateOf(service, 'm-v1')
    expect(state).toMatchObject({ kind: 'in-calendar', response: { partstat: 'ACCEPTED', at: NOW }, calendar: { status: 'app', calendarId: 'cal-trabalho', calendarTitle: 'Trabalho' }, actions: { add: false, remove: true } })
  })

  it('passo 3: o v2 mostra a mudança de horário e "Atualizar" manda update pelos ids do registro', async () => {
    const { service, log, registry } = setup()
    await service.add(addRequest('m-v1'))
    const pending = await stateOf(service, 'm-v2')
    expect(pending.kind).toBe('update-pending')
    expect(pending.actions.update).toBe(true)
    expect(pending.changes[0]).toMatchObject({ field: 'time', before: { start: '2026-11-20T18:00:00Z' }, after: { start: '2026-11-20T19:30:00Z' } })
    const updated = await service.update(request('m-v2'))
    expect(updated).toMatchObject({ ok: true, effect: 'updated', state: { kind: 'in-calendar' } })
    const updates = log().filter((item) => item.cmd === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.args).toMatchObject({ ids: { eventIdentifier: 'fake-ev-1', calendarItemIdentifier: 'fake-item-1', externalIdentifier: 'fake-ext-1' }, span: 'future' })
    expect(updates[0]?.args['recurrenceId']).toBeUndefined()
    const event = registry().find((item) => item.uid === UID)?.event
    expect(event).toMatchObject({ eventIdentifier: 'fake-ev-1', calendarItemIdentifier: 'fake-item-1', start: '2026-11-20T19:30:00Z', sequence: 2 })
    expect((await stateOf(service, 'm-v2')).kind).toBe('in-calendar')
    // N4: o v1 depois do v2 é antigo; nada muda e nada vai ao helper.
    const before = log().length
    const old = await stateOf(service, 'm-v1')
    expect(old).toMatchObject({ kind: 'old', calendar: { status: 'skipped' }, replyable: false })
    expect(Object.values(old.actions).every((value) => !value)).toBe(true)
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'old', message: INVITE_ERROR_MESSAGES.old })
    expect(log().length).toBe(before)
    expect(registry().find((item) => item.uid === UID)?.sequence).toBe(2)
  })

  it('passo 4: o CANCEL mostra "Tirar da agenda"; remove do item inteiro e o registro perde o UID', async () => {
    const { service, log, registry } = setup()
    await service.add(addRequest('m-v1'))
    const cancelled = await stateOf(service, 'm-cancel')
    expect(cancelled).toMatchObject({ kind: 'cancelled', actions: { remove: true, add: false, update: false }, replyable: false })
    const removed = await service.remove(request('m-cancel'))
    expect(removed).toMatchObject({ ok: true, effect: 'removed', state: { kind: 'cancelled', calendar: { status: 'skipped' }, actions: { remove: false } } })
    const removes = log().filter((item) => item.cmd === 'remove')
    expect(removes).toHaveLength(1)
    expect(removes[0]?.args).toMatchObject({ span: 'future' })
    expect('recurrenceId' in (removes[0]?.args ?? {})).toBe(false)
    expect(registry().filter((item) => item.uid === UID)).toEqual([])
  })

  it('passo 5: o evento que a conta pôs fica "Já estava na agenda"; o app não cria nem tira', async () => {
    const { service, log, registry } = setup({ state: { events: [accountCopy()] } })
    const state = await stateOf(service, 'm-v1')
    expect(state).toMatchObject({ kind: 'already-in-calendar', calendar: { status: 'account', merged: false, calendarTitle: 'Trabalho' }, actions: { remove: false, add: false, update: false } })
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: true, effect: 'already', state: { kind: 'already-in-calendar' } })
    expect(log().filter((item) => item.cmd === 'create')).toHaveLength(0)
    expect(registry().find((item) => item.uid === UID)?.event).toBeNull()
    // not-owned: o app não mexe em evento que não criou.
    expect(await service.remove(request('m-v1'))).toMatchObject({ ok: false, error: 'not-owned', message: INVITE_ERROR_MESSAGES['not-owned'] })
    expect(await service.update(request('m-v2'))).toMatchObject({ ok: false, error: 'not-owned' })
    expect(await service.remove(request('m-cancel'))).toMatchObject({ ok: false, error: 'not-owned' })
    expect(log().filter((item) => item.cmd === 'remove' || item.cmd === 'update')).toHaveLength(0)
    // O CANCEL de um evento que o app não gravou só avisa.
    expect(await stateOf(service, 'm-cancel')).toMatchObject({ kind: 'cancelled', calendar: { status: 'skipped' }, actions: { remove: false } })
    expect(registry().find((item) => item.uid === UID)?.sequence).toBe(3)
    expect(registry().filter((item) => item.uid === UID)).toHaveLength(1)
  })

  it('passo 6: a cópia da conta aparece depois; o app tira a dele e passa a mostrar a da conta', async () => {
    const { service, log, registry, writeHelperState, helperState, clock } = setup()
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: true, effect: 'created' })
    writeHelperState({ pending: [{ afterRefresh: 2, event: accountCopy() }] })
    clock.now += INVITE_REFRESH_MIN_MS + 1
    const merged = await stateOf(service, 'm-v1')
    expect(merged).toMatchObject({ kind: 'in-calendar', calendar: { status: 'account', merged: true, calendarTitle: 'Trabalho' }, notice: 'merged', actions: { remove: false, update: false } })
    const removes = log().filter((item) => item.cmd === 'remove')
    expect(removes).toHaveLength(1)
    expect(removes[0]?.args).toMatchObject({ ids: { calendarItemIdentifier: 'fake-item-1' }, span: 'future' })
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ event: null, merged: { calendarItemIdentifier: 'conta-item-1', calendarTitle: 'Trabalho' } })
    expect((await stateOf(service, 'm-v1')).notice).toBeNull()
    expect(helperState().events.map((event) => event['calendarItemIdentifier'])).toEqual(['conta-item-1'])
    // Um CANCEL agora só avisa: a cópia é da conta.
    expect(await stateOf(service, 'm-cancel')).toMatchObject({ kind: 'cancelled', actions: { remove: false } })
  })

  it('passo 6 (fundo): reconcileAll junta sem o cartão aberto e o aviso sai na abertura seguinte', async () => {
    const { service, log, registry, writeHelperState, clock, spawned } = setup()
    // Sem linha com evento, nada sobe.
    await service.reconcileAll()
    expect(spawned()).toBe(0)
    await service.add(addRequest('m-v1'))
    writeHelperState({ pending: [{ afterRefresh: 2, event: accountCopy() }] })
    clock.now = Date.parse('2026-11-19T20:00:00.000Z')
    await service.reconcileAll()
    expect(log().filter((item) => item.cmd === 'remove')).toHaveLength(1)
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ event: null, mergedNotice: true })
    // No máximo uma vez a cada 5 min, e sem pedir acesso.
    const before = log().length
    await service.reconcileAll()
    expect(log().length).toBe(before)
    clock.now += INVITE_RECONCILE_MIN_MS + 1
    await service.reconcileAll()
    expect(log().length).toBe(before)
    expect(log().some((item) => item.cmd === 'request-access')).toBe(false)
    expect((await stateOf(service, 'm-v1')).notice).toBe('merged')
    expect((await stateOf(service, 'm-v1')).notice).toBeNull()
  })

  it('passo 7: a conta Gmail ou Microsoft começa com "Pôr na agenda" desligado', async () => {
    for (const [host, addDefault, addHint] of [
      ['imap.gmail.com', false, 'account-adds'],
      ['outlook.office365.com', false, 'account-adds'],
      ['mail.lapsoftware.com.br', true, null],
    ] as const) {
      const { service } = setup({ host })
      expect(await stateOf(service, 'm-v1'), host).toMatchObject({ addDefault, addHint })
    }
    const { service } = setup({ settings: { inviteAddOnAccept: false } })
    expect(await stateOf(service, 'm-v1')).toMatchObject({ addDefault: false, addHint: null })
    const gmail = setup({ host: 'imap.gmail.com', settings: { inviteAddOnAccept: false } })
    expect(await stateOf(gmail.service, 'm-v1')).toMatchObject({ addDefault: false, addHint: 'account-adds' })
  })

  it('passo 8: o CANCEL de uma ocorrência tira só aquela; a série continua', async () => {
    const { service, log, registry, calendar } = setup()
    expect(await service.add(addRequest('m-weekly'))).toMatchObject({ ok: true, effect: 'created' })
    const create = log().find((item) => item.cmd === 'create')
    expect(create?.args['recurrence']).toEqual({ freq: 'weekly', interval: 1, count: 8 })
    const cancel = await stateOf(service, 'm-cancel-occ')
    expect(cancel).toMatchObject({ kind: 'cancelled', recurrenceId: '2026-12-17T13:00:00Z', calendar: { status: 'app' }, actions: { remove: true } })
    expect(await service.remove(request('m-cancel-occ'))).toMatchObject({ ok: true, effect: 'removed' })
    const removes = log().filter((item) => item.cmd === 'remove')
    expect(removes).toHaveLength(1)
    expect(removes[0]?.args).toMatchObject({ recurrenceId: '2026-12-17T13:00:00Z', span: 'this' })
    const series = registry().find((item) => item.uid === SERIES_UID && item.recurrenceId === null)
    const occurrence = registry().find((item) => item.uid === SERIES_UID && item.recurrenceId === '2026-12-17T13:00:00Z')
    expect(series?.event?.calendarItemIdentifier).toBe('fake-item-1')
    expect(occurrence).toMatchObject({ event: null, removed: true })
    const ids = { eventIdentifier: 'fake-ev-1', calendarItemIdentifier: 'fake-item-1' }
    const next = await calendar.find({ uid: SERIES_UID, title: 'Alinhamento semanal fictício', start: '2026-12-24T13:00:00Z', end: '2026-12-24T14:00:00Z', allDay: false, ids, recurrenceId: '2026-12-24T13:00:00Z' })
    expect(next.ok && next.value.matches.length).toBeGreaterThan(0)
    const gone = await calendar.find({ uid: SERIES_UID, title: 'Alinhamento semanal fictício', start: '2026-12-17T13:00:00Z', end: '2026-12-17T14:00:00Z', allDay: false, ids, recurrenceId: '2026-12-17T13:00:00Z' })
    expect(gone.ok && gone.value.matches.length).toBe(0)
    expect((await stateOf(service, 'm-weekly')).kind).toBe('in-calendar')
    const again = await stateOf(service, 'm-cancel-occ')
    expect(again.actions.remove).toBe(false)
    expect(await service.remove(request('m-cancel-occ'))).toMatchObject({ ok: false, error: 'not-owned' })
    expect(log().filter((item) => item.cmd === 'remove')).toHaveLength(1)
  })

  it('passo 10: sem acesso, o cartão oferece Ajustes e o .ics; a resposta é gravada mesmo assim', async () => {
    const { service, log } = setup({ state: { access: 'denied' } })
    const state = await stateOf(service, 'm-v1')
    expect(state).toMatchObject({ calendar: { status: 'no-access', access: 'denied' }, actions: { openSettings: true, openIcs: true, add: false, requestAccess: false }, defaultCalendarId: null })
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'denied', message: 'Sem acesso ao Calendário.' })
    expect(log().filter((item) => item.cmd === 'create')).toHaveLength(0)
    await service.recordReply(replied('ACCEPTED'))
    expect(await stateOf(service, 'm-v1')).toMatchObject({ kind: 'responded', response: { partstat: 'ACCEPTED' } })
    expect(await service.calendars()).toEqual({ ok: true, access: 'denied', calendars: [], defaultId: null })
    const restricted = setup({ state: { access: 'restricted' } })
    expect(await stateOf(restricted.service, 'm-v1')).toMatchObject({ calendar: { status: 'no-access', access: 'restricted' } })
    expect(await restricted.service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'restricted' })
  })

  it('passo 10: com notDetermined o estado não pede acesso; o primeiro "Pôr na agenda" pede', async () => {
    const { service, cmds } = setup({ state: { access: 'notDetermined', onRequest: 'full' } })
    expect(await stateOf(service, 'm-v1')).toMatchObject({ calendar: { status: 'needs-access' }, actions: { requestAccess: true, add: true } })
    expect(cmds()).not.toContain('request-access')
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: true, effect: 'created' })
    expect(cmds().filter((cmd) => cmd === 'request-access')).toHaveLength(1)
    expect(cmds().filter((cmd) => cmd === 'create')).toHaveLength(1)
  })

  it('Recusar com evento do app: remove, a linha fica com DECLINED e sem evento', async () => {
    const { service, log, registry } = setup()
    await service.recordReply(replied('ACCEPTED'))
    await service.add(addRequest('m-v1'))
    await service.recordReply(replied('DECLINED', { respondedAt: NOW + 1000 }))
    expect(await service.remove(request('m-v1'))).toMatchObject({ ok: true, effect: 'removed', state: { kind: 'responded', calendar: { status: 'absent' } } })
    expect(log().filter((item) => item.cmd === 'remove')).toHaveLength(1)
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ response: 'DECLINED', respondedAt: NOW + 1000, event: null })
    expect(await stateOf(service, 'm-v1')).toMatchObject({ kind: 'responded', response: { partstat: 'DECLINED' }, calendar: { status: 'absent' } })
  })

  it('o evento que sumiu da agenda fica "missing" com "Pôr de novo"; title-start em outra agenda não é do app', async () => {
    const calendars = [
      { id: 'cal-trabalho', title: 'Trabalho', sourceId: 'src-icloud', sourceTitle: 'iCloud', sourceType: 'caldav', writable: true, availabilities: ['busy', 'tentative'], color: null, isDefault: true },
      { id: 'cal-pessoal', title: 'Pessoal', sourceId: 'src-icloud', sourceTitle: 'iCloud', sourceType: 'caldav', writable: true, availabilities: ['busy'], color: null, isDefault: false },
    ]
    const { service, writeHelperState, cmds, registry } = setup({ state: { calendars } })
    await service.add(addRequest('m-v1'))
    // O evento do app saiu; uma cópia com o mesmo título e início está noutra agenda.
    writeHelperState({ events: [{ eventIdentifier: 'outro-ev', calendarItemIdentifier: 'outro-item', title: TITLE, start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', calendarId: 'cal-pessoal' }] })
    const missing = await stateOf(service, 'm-v1')
    expect(missing).toMatchObject({ calendar: { status: 'missing', calendarId: 'cal-trabalho', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' }, actions: { add: true, remove: false } })
    expect(await service.remove(request('m-v1'))).toMatchObject({ ok: false, error: 'not-found', state: { calendar: { status: 'missing' } } })
    expect(cmds()).not.toContain('remove')
    // A agenda que sumiu: nomes `null`.
    writeHelperState({ events: [], calendars: [calendars[1]] })
    expect(await stateOf(service, 'm-v1')).toMatchObject({ calendar: { status: 'missing', calendarTitle: null, sourceTitle: null }, defaultCalendarId: 'cal-pessoal' })
    // "Pôr de novo" cria e troca o ref.
    writeHelperState({ calendars })
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: true, effect: 'created', state: { calendar: { status: 'app' } } })
    expect(registry().find((item) => item.uid === UID)?.event?.calendarItemIdentifier).toBe('fake-item-2')
  })

  it('salvaguarda: título + início na agenda do registro só é do app com o mesmo external id', async () => {
    const candidate = { eventIdentifier: 'novo-ev', calendarItemIdentifier: 'novo-item', externalIdentifier: null, title: TITLE, start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', calendarId: 'cal-trabalho' }
    // O app gravou "fake-ext-1"; o achado tem `null`: é da conta, o app larga o `event` e não mexe nele.
    const foreign = setup()
    await foreign.service.add(addRequest('m-v1'))
    foreign.writeHelperState({ events: [candidate] })
    expect(await stateOf(foreign.service, 'm-v1')).toMatchObject({ kind: 'already-in-calendar', calendar: { status: 'account', merged: false, calendarTitle: 'Trabalho' }, actions: { remove: false, update: false } })
    expect(foreign.registry().find((item) => item.uid === UID)?.event).toBeNull()
    expect(await foreign.service.remove(request('m-v1'))).toMatchObject({ ok: false, error: 'not-owned' })
    expect(await foreign.service.update(request('m-v2'))).toMatchObject({ ok: false, error: 'not-owned' })
    expect(foreign.cmds().filter((cmd) => cmd === 'remove' || cmd === 'update')).toEqual([])
    // O app gravou `null` e o achado também é `null`: é o evento do app (o último passo do N3).
    const own = setup()
    await own.service.add(addRequest('m-v1'))
    const file = join(own.dir, 'email', 'invites.json')
    const disk = JSON.parse(readFileSync(file, 'utf8')) as { version: 1; invites: InviteRecord[] }
    for (const row of disk.invites) if (row.event) row.event.externalIdentifier = null
    writeFileSync(file, JSON.stringify(disk))
    own.writeHelperState({ events: [candidate] })
    expect(await stateOf(own.service, 'm-v1')).toMatchObject({ kind: 'in-calendar', calendar: { status: 'app', calendarId: 'cal-trabalho' }, actions: { remove: true } })
    expect(own.registry().find((item) => item.uid === UID)?.event).toMatchObject({ eventIdentifier: 'novo-ev', calendarItemIdentifier: 'novo-item', externalIdentifier: null })
    expect(await own.service.remove(request('m-v1'))).toMatchObject({ ok: true, effect: 'removed' })
    expect(own.log().filter((item) => item.cmd === 'remove')[0]?.args).toMatchObject({ ids: { eventIdentifier: 'novo-ev', calendarItemIdentifier: 'novo-item' }, span: 'future' })
  })

  it('devolução 1: a ocorrência destacada com outro eventIdentifier não troca os ids da série', async () => {
    const { service, log, registry, helperState, writeHelperState } = setup({ env: { FAKE_LAP_CALENDAR_DETACHED_IDS: '1' } })
    await service.add(addRequest('m-weekly'))
    const events = helperState().events
    writeHelperState({ events: events.map((event) => ({ ...event, detached: { '2026-12-17T13:00:00Z': { start: '2026-12-17T14:00:00Z', end: '2026-12-17T15:00:00Z' } } })) })
    expect(await stateOf(service, 'm-cancel-occ')).toMatchObject({ kind: 'cancelled', calendar: { status: 'app' }, actions: { remove: true } })
    const series = () => registry().find((item) => item.uid === SERIES_UID && item.recurrenceId === null)?.event
    expect(series()).toMatchObject({ eventIdentifier: 'fake-ev-1', calendarItemIdentifier: 'fake-item-1' })
    expect(await service.remove(request('m-cancel-occ'))).toMatchObject({ ok: true, effect: 'removed' })
    const remove = log().filter((item) => item.cmd === 'remove')
    expect(remove).toHaveLength(1)
    expect(remove[0]?.args).toMatchObject({ ids: { eventIdentifier: 'fake-ev-1', calendarItemIdentifier: 'fake-item-1' }, recurrenceId: '2026-12-17T13:00:00Z', span: 'this' })
    expect(series()).toMatchObject({ eventIdentifier: 'fake-ev-1' })
    expect(await stateOf(service, 'm-weekly')).toMatchObject({ kind: 'in-calendar', calendar: { status: 'app' } })
  })

  it('devolução 2: a cópia da conta é outro calendarItemIdentifier; eventIdentifier null dos dois não bloqueia', async () => {
    const { service, log, registry, helperState, writeHelperState, clock } = setup()
    await service.add(addRequest('m-v1'))
    const appEvent = { ...helperState().events[0], eventIdentifier: null }
    writeHelperState({ events: [appEvent, accountCopy({ eventIdentifier: null })] })
    clock.now += INVITE_REFRESH_MIN_MS + 1
    expect(await stateOf(service, 'm-v1')).toMatchObject({ kind: 'in-calendar', calendar: { status: 'account', merged: true }, notice: 'merged' })
    expect(log().filter((item) => item.cmd === 'remove')[0]?.args).toMatchObject({ ids: { calendarItemIdentifier: 'fake-item-1' }, span: 'future' })
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ event: null, merged: { calendarItemIdentifier: 'conta-item-1' } })
    // O mesmo `eventIdentifier` (não nulo) é o mesmo evento: não junta.
    const same = setup()
    await same.service.add(addRequest('m-v1'))
    same.writeHelperState({ events: [...same.helperState().events, accountCopy({ eventIdentifier: 'fake-ev-1' })] })
    same.clock.now += INVITE_REFRESH_MIN_MS + 1
    expect(await stateOf(same.service, 'm-v1')).toMatchObject({ calendar: { status: 'app' } })
    expect(same.cmds()).not.toContain('remove')
  })

  it('devolução 3: a escrita deu certo e o estado seguinte falhou: ok com o efeito real', async () => {
    // Falha uma vez: a segunda tentativa traz o estado completo.
    let calls = 0
    const flaky = setup({
      settingsFn: () => {
        calls++
        if (calls === 1) throw new Error('configurações ilegíveis')
        return { inviteCalendarId: 'cal-trabalho', inviteAddOnAccept: true }
      },
    })
    expect(await flaky.service.add(addRequest('m-v1'))).toMatchObject({ ok: true, effect: 'created', state: { kind: 'in-calendar', calendar: { status: 'app' } } })
    // Falha sempre: o estado mínimo, com a agenda sem perguntar e as ações dela desligadas.
    const broken = setup({
      settingsFn: () => {
        throw new Error('configurações ilegíveis')
      },
    })
    const added = await broken.service.add(addRequest('m-v1'))
    expect(added).toMatchObject({ ok: true, effect: 'created', state: { kind: 'new', calendar: { status: 'skipped' }, actions: { add: false, update: false, remove: false }, addDefault: true } })
    expect(broken.registry().find((item) => item.uid === UID)?.event?.calendarItemIdentifier).toBe('fake-item-1')
    expect(await broken.service.update(request('m-v2'))).toMatchObject({ ok: true, effect: 'updated', state: { calendar: { status: 'skipped' } } })
    expect(await broken.service.remove(request('m-cancel'))).toMatchObject({ ok: true, effect: 'removed', state: { kind: 'cancelled', calendar: { status: 'skipped' } } })
    expect(broken.cmds().filter((cmd) => cmd === 'create' || cmd === 'update' || cmd === 'remove')).toEqual(['create', 'update', 'remove'])
    expect(allLogs.some((line) => line.includes('estado mínimo'))).toBe(true)
  })

  it('agendas: só as graváveis, a padrão da configuração ou a do Calendário; agenda só de leitura recusa', async () => {
    const { service, settings, cmds } = setup()
    expect(await service.calendars()).toEqual({ ok: true, access: 'full', calendars: [{ id: 'cal-trabalho', title: 'Trabalho', sourceTitle: 'iCloud', sourceType: 'caldav', isDefault: true }], defaultId: 'cal-trabalho' })
    settings.inviteCalendarId = 'cal-feriados'
    expect((await service.calendars()).ok && (await service.calendars())).toMatchObject({ defaultId: 'cal-trabalho' })
    expect(await service.add({ ...addRequest('m-v1'), calendarId: 'cal-feriados' })).toMatchObject({ ok: false, error: 'read-only-calendar', message: INVITE_ERROR_MESSAGES['read-only-calendar'] })
    expect(await service.add({ ...addRequest('m-v1'), calendarId: 'cal-sumiu' })).toMatchObject({ ok: false, error: 'no-calendar' })
    expect(cmds()).not.toContain('create')
    expect(cmds()).not.toContain('request-access')
  })

  it('REPLY recebido: "Fulano aceitou", sem helper e sem registro', async () => {
    const { service, spawned, registry } = setup()
    const state = await stateOf(service, 'm-reply')
    expect(state).toMatchObject({ kind: 'reply-received', calendar: { status: 'skipped' }, replyable: false, response: null })
    expect(state.replier?.address).toContain('@')
    expect(Object.values(state.actions).every((value) => !value)).toBe(true)
    expect(spawned()).toBe(0)
    expect(registry()).toEqual([])
  })

  it('recorrência que o app não grava: recurrenceBlocked, "Abrir no app de agenda" e add → recurrence', async () => {
    const { service, cmds } = setup()
    const state = await stateOf(service, 'm-rdate')
    expect(state).toMatchObject({ recurrenceBlocked: true, actions: { add: false, openIcs: true } })
    expect(await service.add(addRequest('m-rdate'))).toMatchObject({ ok: false, error: 'recurrence', message: INVITE_ERROR_MESSAGES.recurrence })
    expect(cmds()).not.toContain('create')
  })

  it('fora do Mac: unavailable/platform, "Abrir no app de agenda" e nenhum processo', async () => {
    const { service, spawned } = setup({ client: { platform: 'linux' } })
    expect(await stateOf(service, 'm-v1')).toMatchObject({ calendar: { status: 'unavailable', reason: 'platform' }, actions: { openIcs: true, add: false } })
    expect(await service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'unavailable', message: INVITE_ERROR_MESSAGES.unavailable })
    expect(await service.calendars()).toEqual({ ok: false, error: 'unavailable', reason: 'platform' })
    expect(await service.calendarPresent()).toBe(false)
    expect(spawned()).toBe(0)
  })

  it('timeout no create: failed, um create só no log e nada adotado', async () => {
    const { service, cmds, registry } = setup({ env: { FAKE_LAP_CALENDAR_HANG: 'create' }, client: { timeouts: { create: 300 } } })
    const result = await service.add(addRequest('m-v1'))
    expect(result).toMatchObject({ ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed })
    expect(cmds().filter((cmd) => cmd === 'create')).toHaveLength(1)
    expect(registry().find((item) => item.uid === UID)?.event).toBeNull()
  })

  it('CA14: dois add ao mesmo tempo: um cria, o outro volta busy sem helper', async () => {
    const { service, cmds } = setup()
    const [first, second] = await Promise.all([service.add(addRequest('m-v1')), service.add(addRequest('m-v1'))])
    const effects = [first, second].map((item) => (item.ok ? item.effect : item.error)).sort()
    expect(effects).toEqual(['busy', 'created'])
    const busy = [first, second].find((item) => !item.ok)
    expect(busy).toMatchObject({ message: INVITE_ERROR_MESSAGES.busy, state: null })
    expect(cmds().filter((cmd) => cmd === 'create')).toHaveLength(1)
  })

  it('CA15: "Abrir no app de agenda" grava o .ics 0600 em userData/tmp e o dispose apaga', async () => {
    const { service, opened, dir } = setup()
    expect(await service.openIcs(request('m-v1'))).toEqual({ ok: true })
    expect(opened).toHaveLength(1)
    const file = opened[0] ?? ''
    expect(file.startsWith(join(dir, 'tmp', 'invite-'))).toBe(true)
    expect(file).toMatch(/invite-[0-9a-f]{16}\.ics$/)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'tmp')).mode & 0o777).toBe(0o700)
    expect(readFileSync(file, 'utf8')).toBe(inviteFrom('servico-request-v1.ics').source)
    expect(await service.openIcs(request('m-cancel'))).toEqual({ ok: false, error: 'invalid' })
    expect(await service.openIcs(request('sem-convite'))).toEqual({ ok: false, error: 'missing' })
    writeFileSync(join(dir, 'tmp', 'outro.txt'), 'fica')
    await service.dispose()
    expect(readdirSync(join(dir, 'tmp'))).toEqual(['outro.txt'])
  })

  it('CA15: o erro do openPath vira failed e apaga o arquivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'convites-ics-'))
    const calendar = createMacCalendar({ platform: 'linux', arch: 'x64', systemVersion: '6.0', packaged: true, command: async () => null })
    const service = createInviteService({
      root: dir,
      calendar,
      settings: () => ({ inviteCalendarId: null, inviteAddOnAccept: true }),
      source: async (_accountId, id) => ({ account: account(), invite: inviteFrom(MESSAGES[id] ?? 'servico-request-v1.ics'), messageId: id }),
      openPath: async () => 'sem app de agenda',
    })
    expect(await service.openIcs(request('m-v1'))).toEqual({ ok: false, error: 'failed' })
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  it('CA13: requestAccess fora do pacote → unavailable/dev; empacotado → o que o helper devolve', async () => {
    const dev = setup({ client: { packaged: false } })
    expect(await dev.service.requestAccess()).toEqual({ ok: false, error: 'unavailable', reason: 'dev' })
    const packaged = setup({ state: { access: 'notDetermined', onRequest: 'full' } })
    expect(await packaged.service.requestAccess()).toEqual({ ok: true, access: 'full', granted: true })
    const denied = setup({ state: { access: 'notDetermined' } })
    expect(await denied.service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'denied' })
    // No dev, o "Pôr na agenda" com notDetermined cai em unavailable.
    const devAdd = setup({ state: { access: 'notDetermined', onRequest: 'full' }, client: { packaged: false } })
    expect(await devAdd.service.add(addRequest('m-v1'))).toMatchObject({ ok: false, error: 'unavailable' })
  })

  it('CA16: recordReply valida o aviso, cria a linha se preciso e troca a resposta anterior', async () => {
    const { service, registry, spawned } = setup()
    await service.recordReply({ ...replied('ACCEPTED'), partstat: 'MAYBE' } as unknown as InviteRepliedEvent)
    await service.recordReply({ ...replied('ACCEPTED'), extra: 1 } as unknown as InviteRepliedEvent)
    expect(registry()).toEqual([])
    expect(allLogs.some((line) => line.includes('resposta de convite: aviso inválido'))).toBe(true)
    await service.recordReply(replied('TENTATIVE', { recurrenceId: '2026-12-17T13:00:00.000Z', uid: SERIES_UID, sequence: 4 }))
    expect(registry()).toEqual([expect.objectContaining({ uid: SERIES_UID, recurrenceId: '2026-12-17T13:00:00Z', response: 'TENTATIVE', sequence: 4, event: null })])
    await service.recordReply(replied('ACCEPTED'))
    await service.recordReply(replied('DECLINED', { respondedAt: NOW + 5 }))
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ response: 'DECLINED', respondedAt: NOW + 5, messageId: 'm-v1' })
    expect(spawned()).toBe(0)
  })

  it('a conta removida leva as linhas dela', async () => {
    const { service, registry } = setup()
    await service.recordReply(replied('ACCEPTED'))
    await service.forgetAccount(ACCOUNT_ID)
    expect(registry()).toEqual([])
  })
})

// --- Entradas do 64 ----------------------------------------------------------------------------------------------

describe('entradas do 64', () => {
  const source = (name: string, host?: string): InviteSource => ({ account: account(host), invite: inviteFrom(name), messageId: 'm-regra' })

  it('addFromRule: sem agenda padrão → no-calendar sem nenhum comando', async () => {
    const { service, cmds, spawned } = setup({ settings: { inviteCalendarId: null } })
    expect(await service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: false, error: 'no-calendar' })
    expect(cmds()).toEqual([])
    expect(spawned()).toBe(0)
  })

  it('addFromRule: notDetermined → calendar-denied sem pedir acesso', async () => {
    const { service, cmds } = setup({ state: { access: 'notDetermined', onRequest: 'full' } })
    expect(await service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: false, error: 'calendar-denied' })
    expect(cmds()).not.toContain('request-access')
    const writeOnly = setup({ state: { access: 'writeOnly' } })
    expect(await writeOnly.service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: false, error: 'calendar-denied' })
  })

  it('addFromRule: REQUEST novo cria; de novo → already; v2 → none; CANCEL → none', async () => {
    const { service, cmds, registry } = setup()
    expect(await service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: true, effect: 'created' })
    expect(cmds()).toEqual(['status', 'calendars', 'refresh', 'find', 'create'])
    expect(registry().find((item) => item.uid === UID)).toMatchObject({ response: null, messageId: 'm-regra', event: { calendarItemIdentifier: 'fake-item-1' } })
    expect(await service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: true, effect: 'already' })
    expect(cmds().filter((cmd) => cmd === 'create')).toHaveLength(1)
    const before = cmds().length
    expect(await service.addFromRule(source('servico-request-v2.ics'))).toEqual({ ok: true, effect: 'none' })
    expect(await service.addFromRule(source('servico-cancel.ics'))).toEqual({ ok: true, effect: 'none' })
    expect(await service.addFromRule(source('rdate.ics'))).toEqual({ ok: true, effect: 'none' })
    expect(cmds().length).toBe(before)
    expect(cmds()).not.toContain('update')
    expect(cmds()).not.toContain('remove')
  })

  it('addFromRule: a cópia da conta (R5a) → already; agenda só de leitura → no-calendar', async () => {
    const copy = setup({ state: { events: [accountCopy()] } })
    expect(await copy.service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: true, effect: 'already' })
    expect(copy.cmds()).not.toContain('create')
    const readOnly = setup({ settings: { inviteCalendarId: 'cal-feriados' } })
    expect(await readOnly.service.addFromRule(source('servico-request-v1.ics'))).toEqual({ ok: false, error: 'no-calendar' })
  })

  it('addEvent: duas vezes a mesma key → um create, o segundo already', async () => {
    const { service, cmds, registry } = setup()
    const args = { calendarId: 'cal-trabalho', title: 'Café fictício', start: '2026-11-25T15:00:00Z', end: '2026-11-25T15:30:00Z', allDay: false, timeZone: SP, availability: 'busy' as const }
    const key = 'suggest:0123456789abcdef'
    expect(await service.addEvent({ accountId: ACCOUNT_ID, key, messageId: 'm-sugestao', args })).toEqual({ ok: true, effect: 'created', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' })
    expect(await service.addEvent({ accountId: ACCOUNT_ID, key, messageId: 'm-sugestao', args })).toEqual({ ok: true, effect: 'already', calendarTitle: 'Trabalho', sourceTitle: 'iCloud' })
    expect(cmds().filter((cmd) => cmd === 'create')).toHaveLength(1)
    expect(registry().find((item) => item.uid === key)).toMatchObject({ recurrenceId: null, sequence: 0, dtstamp: null, response: null, event: { calendarItemIdentifier: 'fake-item-1' } })
    expect(await service.addEvent({ accountId: ACCOUNT_ID, key, messageId: 'm-sugestao', args: { ...args, title: '' } })).toMatchObject({ ok: false, error: 'invalid', message: INVITE_ERROR_MESSAGES.invalid })
    expect(await service.addEvent({ accountId: ACCOUNT_ID, key, messageId: 'm-sugestao', args: { ...args, calendarId: 'cal-feriados' } })).toMatchObject({ ok: false, error: 'read-only-calendar' })
  })

  it('calendarPresent: true no Mac (sem pedir acesso), false fora dele sem spawn', async () => {
    const mac = setup({ state: { access: 'notDetermined' } })
    expect(await mac.service.calendarPresent()).toBe(true)
    expect(mac.cmds()).toEqual(['status'])
    const linux = setup({ client: { platform: 'linux' } })
    expect(await linux.service.calendarPresent()).toBe(false)
    expect(linux.spawned()).toBe(0)
  })
})

// --- Ligação, settings e invariantes -----------------------------------------------------------------------------

describe('ligação e invariantes', () => {
  it('CA18: os sete canais são refused com o app bloqueado; o painel de privacidade do Calendário', () => {
    const channels = ['scribe:invite-state', 'scribe:invite-add', 'scribe:invite-update', 'scribe:invite-remove', 'scribe:invite-calendars', 'scribe:invite-request-access', 'scribe:invite-open-ics'] as const
    for (const channel of channels) expect(WHEN_LOCKED[channel], channel).toBe('refused')
    expect(privacyPaneUrl('calendars')).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars')
    const index = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    for (const channel of channels) expect(index).toContain(`handle('${channel}', appOrigin,`)
    expect(index).toMatch(/onInviteReplied: \(event\) => void invites\?\.recordReply\(event\)/)
    expect(index).toContain('void inviteService.reconcileAll()')
    expect(index).toContain('void invites?.forgetAccount(accountId)')
    expect(index).toContain('void services.invites.dispose()')
    expect(index).toContain('void services.macCalendar.dispose()')
  })

  it('CA19: as três chaves novas nas configurações, lenientes', () => {
    const defaults = parseSettings({})
    expect(defaults).toMatchObject({ inviteCalendarId: null, inviteAddOnAccept: true, inviteSuggest: false })
    expect(parseSettings({ inviteCalendarId: 'cal-trabalho', inviteAddOnAccept: false, inviteSuggest: true })).toMatchObject({ inviteCalendarId: 'cal-trabalho', inviteAddOnAccept: false, inviteSuggest: true })
    expect(parseSettings({ inviteCalendarId: 'a\nb' }).inviteCalendarId).toBeNull()
    expect(parseSettings({ inviteCalendarId: '' }).inviteCalendarId).toBeNull()
    expect(parseSettings({ inviteCalendarId: 'x'.repeat(1025) }).inviteCalendarId).toBeNull()
    expect(parseSettings({ inviteAddOnAccept: 'sim', inviteSuggest: 1 })).toMatchObject({ inviteAddOnAccept: true, inviteSuggest: false })
    expect(parseSettingsPatch({ inviteCalendarId: 'cal-x', inviteAddOnAccept: false, inviteSuggest: true })).toEqual({ inviteCalendarId: 'cal-x', inviteAddOnAccept: false, inviteSuggest: true })
    expect(parseSettingsPatch({ inviteCalendarId: null })).toEqual({ inviteCalendarId: null })
    expect(() => parseSettingsPatch({ inviteCalendarId: 'a\u0001' })).toThrow()
  })

  it('invariante: nada de rede em main/invites e shared/invite-state; inviteSource só lê o cache', () => {
    const files = ['src/main/invites/store.ts', 'src/main/invites/map.ts', 'src/main/invites/service.ts', 'src/main/invites/ics-file.ts', 'src/shared/invite-state.ts']
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      expect(text, file).not.toMatch(/from ['"](node:)?(net|http|https|dgram|dns|tls)['"]/)
      expect(text, file).not.toMatch(/from ['"](imapflow|nodemailer|electron)['"]/)
      expect(text, file).not.toMatch(/\bfetch\(/)
    }
    const email = readFileSync(join(ROOT, 'src/main/email/service.ts'), 'utf8')
    const start = email.indexOf('    async inviteSource(')
    const body = email.slice(start, email.indexOf('\n    },\n', start))
    expect(start).toBeGreaterThan(0)
    expect(body).not.toMatch(/serverSource|imap|pop3|smtp|setBody|deliver/)
    expect(body).toContain('store.body(')
  })

  it('invariante: as únicas escritas ao helper recebem o InviteEventRef', () => {
    const text = readFileSync(join(ROOT, 'src/main/invites/service.ts'), 'utf8')
    const lines = text.split('\n')
    const writes = lines.map((line, index) => ({ line, index })).filter(({ line }) => /\bcal\.(update|remove|create)\(/.test(line))
    const fn = (name: string) => lines.findIndex((line) => line.includes(`function ${name}(ref: InviteEventRef,`))
    expect(fn('updateEvent')).toBeGreaterThan(0)
    expect(fn('removeEvent')).toBeGreaterThan(0)
    for (const { line, index } of writes.filter(({ line }) => /\bcal\.(update|remove)\(/.test(line))) {
      expect([fn('updateEvent') + 1, fn('removeEvent') + 1], line).toContain(index)
    }
    expect(writes.filter(({ line }) => /\bcal\.(update|remove)\(/.test(line))).toHaveLength(2)
    expect(text).not.toMatch(/deps\.calendar\.(update|remove)\(/)
  })

  it('CA24: o deliver com calendar gera a parte text/calendar e o anexo invite.ics; um convite só', async () => {
    const fake = createFakeEmail(() => NOW)
    const content = fixture('servico-request-v1.ics')
    await fake.deliver({ from: { name: 'Carla Fictícia', address: 'carla.ficticia@example.com' }, subject: 'Convite: Planejamento', text: 'Você foi convidado.', calendar: { method: 'REQUEST', content } })
    const session = await fake.imap({ host: 'imap.lap.example', port: 993, security: 'tls', user: SELF, pass: SMOKE_EMAIL_PASSWORD })
    const [latest] = (await session.recent(10)).sort((a, b) => b.uid - a.uid)
    const raw = latest ? await session.source(latest.uid) : null
    await session.close()
    if (!Buffer.isBuffer(raw)) throw new Error('sem a mensagem entregue')
    const parsed = await simpleParser(raw)
    const types = parsed.attachments.map((item) => item.contentType)
    expect(types).toEqual(['text/calendar', 'application/ics'])
    expect(parsed.attachments[1]?.filename).toBe('invite.ics')
    expect(parsed.text?.trim()).toBe('Você foi convidado.')
    const parts = parsed.attachments.map((item) => ({ contentType: item.contentType, filename: item.filename ?? null, method: (item.headers.get('content-type') as { params?: Record<string, string> } | undefined)?.params?.method ?? null, content: item.content }))
    expect(parts[0]?.method).toBe('REQUEST')
    const result = parseInvite(parts, CONTEXT)
    expect(result).toMatchObject({ ok: true, ignoredParts: 1, invite: { uid: UID } })
    expect((await parseEmail(raw, CONTEXT)).body.invite?.uid).toBe(UID)
    // Sem `calendar`, a mensagem sai como antes.
    await fake.deliver({ from: { name: null, address: 'x@example.com' }, subject: 'Sem convite', text: 'Oi.' })
    const plain = await fake.imap({ host: 'imap.lap.example', port: 993, security: 'tls', user: SELF, pass: SMOKE_EMAIL_PASSWORD })
    const [last] = (await plain.recent(10)).sort((a, b) => b.uid - a.uid)
    const rawPlain = last ? await plain.source(last.uid) : null
    await plain.close()
    expect(Buffer.isBuffer(rawPlain) && (await simpleParser(rawPlain)).attachments).toEqual([])
  })
})

afterAll(() => {
  // Invariante: o log de todos os casos não leva dado de evento nem endereço das fixtures.
  const forbidden = [TITLE, UID, SERIES_UID, 'Sala Ficticia', 'meet.google.com', 'Pauta fictícia', 'Alinhamento semanal', 'carla.ficticia', SELF, '@example', 'Trabalho', 'iCloud', 'm-v1', 'Café fictício']
  const offenders = allLogs.filter((line) => forbidden.some((word) => line.includes(word)))
  expect(offenders).toEqual([])
  expect(allLogs.length).toBeGreaterThan(0)
})
