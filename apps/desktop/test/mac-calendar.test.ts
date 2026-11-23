// Contrato 60 (convites-agenda): o `lap-calendar` e o cliente dele. A tabela de conformidade do protocolo roda contra
// o helper falso (test/fixtures/fake-lap-calendar.mjs) e, com `LAP_CALENDAR_REAL=1` no Mac do Andrew, contra o
// binário de verdade nos casos "só leitura" (status, calendars, refresh, find e os `invalid`). O cliente
// (src/main/mac-calendar/process.ts) é testado com o falso e com um `spawn` de mentira.
//
// UID (D0, caso 2b): não se sabe se o Gmail e o Exchange põem o UID do convite como external id. O `find` casa o UID
// só por igualdade exata e, sem isso, por título + início exato; os casos abaixo cobrem os dois caminhos.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createMacCalendar,
  locateMacCalendar,
  MAC_CALENDAR_KILL_AFTER_MS,
  MAC_CALENDAR_MAX_PENDING,
  MAC_CALENDAR_MAX_RESTARTS,
  MAC_CALENDAR_RESTART_BASE_MS,
  MAC_CALENDAR_SOURCE,
  MAC_CALENDAR_STABLE_MS,
  MAC_CALENDAR_SWIFTC_ARGS,
  MAC_CALENDAR_TIMEOUTS_MS,
  type MacCalendarCommand,
  type MacCalendarOptions,
  type SpawnMacCalendar,
} from '../src/main/mac-calendar/process'
import {
  MAC_CALENDAR_MAX_LIST,
  MAC_CALENDAR_MAX_LIST_WINDOW_MS,
  MAC_CALENDAR_MAX_NOTES,
  MAC_CALENDAR_MAX_REQUEST_LINE,
  MAC_CALENDAR_MAX_RESPONSE_LINE,
  MAC_CALENDAR_RESULT_SCHEMAS,
  type MacCalendarCreateArgs,
} from '../src/main/mac-calendar/protocol'

const ROOT = join(__dirname, '..')
const FAKE = join(__dirname, 'fixtures', 'fake-lap-calendar.mjs')
const REAL = process.env['LAP_CALENDAR_REAL'] === '1'
const PHRASE = 'Para pôr na sua agenda os convites de reunião que chegam por email.'

// --- Driver de linhas cruas --------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- as respostas cruas do protocolo são conferidas campo a campo */
interface Raw {
  line: string
  json: any
}

interface Helper {
  proc: ChildProcess
  send(request: string | object): Promise<Raw>
  close(): Promise<number | null>
}

function startProcess(file: string, args: string[], env: Record<string, string>): Helper {
  const proc = spawn(file, args, { env: { PATH: '/usr/bin:/bin', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  proc.stderr.resume()
  const lines: string[] = []
  const waiters: ((line: string) => void)[] = []
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const waiter = waiters.shift()
    if (waiter) waiter(line)
    else lines.push(line)
  })
  const exit = new Promise<number | null>((resolve) => proc.once('exit', (code) => resolve(code)))
  return {
    proc,
    send(request) {
      const text = typeof request === 'string' ? request : JSON.stringify(request)
      proc.stdin.write(`${text}\n`)
      return new Promise((resolve) => {
        const take = (line: string): void => resolve({ line, json: JSON.parse(line) })
        const ready = lines.shift()
        if (ready !== undefined) take(ready)
        else waiters.push(take)
      })
    },
    close() {
      proc.stdin.end()
      return exit
    },
  }
}

let realBinary = ''
let realDir = ''

interface Ctx {
  real: boolean
  /** Sobe o helper; `state` só vale para o falso (gravado no arquivo de estado). */
  start(state?: object, env?: Record<string, string>): Helper
  /** O estado do falso como está no arquivo agora. */
  state(): any
  stateFile: string
}

function context(real: boolean, dir: string): Ctx {
  const stateFile = join(dir, `state-${Math.random().toString(36).slice(2)}.json`)
  return {
    real,
    stateFile,
    start(state, env = {}) {
      if (real) return startProcess(realBinary, [], env)
      if (state) writeFileSync(stateFile, JSON.stringify(state))
      return startProcess(process.execPath, [FAKE], { ...(state ? { FAKE_LAP_CALENDAR_STATE: stateFile } : {}), ...env })
    },
    state: () => JSON.parse(readFileSync(stateFile, 'utf8')),
  }
}

let counter = 0
const req = (cmd: string, args: object = {}, extra: object = {}) => ({ v: 1, id: `r${++counter}`, cmd, args, ...extra })

const CALENDARS = [
  { id: 'cal-trabalho', title: 'Trabalho', sourceId: 'src-icloud', sourceTitle: 'iCloud', sourceType: 'caldav', writable: true, availabilities: ['busy', 'tentative', 'free'], color: '#1B6FD8', isDefault: true },
  { id: 'cal-feriados', title: 'Feriados', sourceId: 'src-assinadas', sourceTitle: 'Assinadas', sourceType: 'subscribed', writable: false, availabilities: ['busy', 'free'], color: null, isDefault: false },
  { id: 'cal-exchange', title: 'Agenda', sourceId: 'src-ex', sourceTitle: 'Exchange', sourceType: 'exchange', writable: true, availabilities: ['busy', 'free'], color: '#00FF00', isDefault: false },
  { id: 'cal-sem', title: 'Sem disponibilidade', sourceId: 'src-local', sourceTitle: 'No Mac', sourceType: 'local', writable: true, availabilities: [], color: null, isDefault: false },
]

const state = (patch: object = {}) => ({ access: 'full', onRequest: 'denied', calendars: CALENDARS, events: [], pending: [], ...patch })

const accountEvent = (patch: object = {}) => ({
  eventIdentifier: 'acc-ev-1',
  calendarItemIdentifier: 'acc-item-1',
  externalIdentifier: 'convite-123@google.com',
  calendarId: 'cal-trabalho',
  title: 'Revisão do contrato',
  start: '2026-11-20T18:00:00Z',
  end: '2026-11-20T19:00:00Z',
  allDay: false,
  timeZone: 'America/Sao_Paulo',
  origin: 'account',
  ...patch,
})

const FIND = { uid: 'convite-123@google.com', title: 'Revisão do contrato', start: '2026-11-20T18:00:00Z', end: '2026-11-20T19:00:00Z', allDay: false }

const CREATE: MacCalendarCreateArgs = {
  calendarId: 'cal-trabalho',
  title: 'Planejamento',
  start: '2026-11-20T18:00:00Z',
  end: '2026-11-20T19:00:00Z',
  allDay: false,
  timeZone: 'America/New_York',
  location: 'Sala 3',
  url: 'https://meet.google.com/abc-defg-hij',
  notes: 'https://meet.google.com/abc-defg-hij\n\nPauta do mês.',
  availability: 'busy',
}

/** O dia 22/11/2026 em São Paulo (UTC−3). */
const LIST = { start: '2026-11-22T03:00:00Z', end: '2026-11-23T03:00:00Z' }
const BIRTHDAYS = { id: 'cal-aniversarios', title: 'Aniversários', sourceId: 'src-niver', sourceTitle: 'Outros', sourceType: 'birthdays', writable: false, availabilities: [], color: null, isDefault: false }

const SERIES = { ...CREATE, title: 'Diária', recurrence: { freq: 'daily', count: 5 } }

const expectError = (raw: Raw, code: string, reason: string, id: string | null): void => {
  expect(raw.json).toMatchObject({ v: 1, ok: false, id, error: { code, reason } })
  expect(typeof raw.json.error.message).toBe('string')
  expect(Object.keys(raw.json)).toEqual(['error', 'id', 'ok', 'v'])
}

const expectOk = (raw: Raw, cmd: keyof typeof MAC_CALENDAR_RESULT_SCHEMAS): any => {
  expect(raw.json.ok, raw.line).toBe(true)
  expect(Object.keys(raw.json)).toEqual(['id', 'ok', 'result', 'v'])
  const parsed = MAC_CALENDAR_RESULT_SCHEMAS[cmd].safeParse(raw.json.result)
  expect(parsed.success, raw.line).toBe(true)
  return raw.json.result
}

/** Envia e confere o `id` da resposta. */
async function call(helper: Helper, cmd: string, args: object = {}): Promise<Raw> {
  const request = req(cmd, args)
  const raw = await helper.send(request)
  expect(raw.json.id).toBe(request.id)
  return raw
}

// --- Tabela de conformidade --------------------------------------------------------------------------------------

interface Case {
  ca: string
  title: string
  readOnly?: boolean
  run(ctx: Ctx): Promise<void>
}

const TABLE: Case[] = [
  {
    ca: 'CA1',
    title: 'status sai numa linha só, com as chaves em ordem alfabética',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      const raw = await helper.send({ v: 1, id: 'a1', cmd: 'status', args: {} })
      expect(raw.line).toMatch(/^\{"id":"a1","ok":true,"result":\{"access":"(full|writeOnly|denied|restricted|notDetermined)","version":"lap-calendar 2"\},"v":1\}$/)
      await helper.close()
    },
  },
  {
    ca: 'CA1',
    title: 'linha que não é JSON, chave a mais, cmd desconhecido, v:2, id fora do formato, args ausente',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      const raw = await helper.send('não é json')
      expectError(raw, 'invalid', 'json', null)
      expect(raw.line.startsWith('{"error":{"code":"invalid","message":')).toBe(true)
      expectError(await helper.send({ v: 1, id: 'b1', cmd: 'status', args: {}, extra: 1 }), 'invalid', 'schema', 'b1')
      expectError(await helper.send({ v: 1, id: 'b2', cmd: 'apagar-tudo', args: {} }), 'invalid', 'schema', 'b2')
      expectError(await helper.send({ v: 2, id: 'b3', cmd: 'status', args: {} }), 'invalid', 'schema', 'b3')
      expectError(await helper.send({ v: 1, id: 'b4', cmd: 'status' }), 'invalid', 'schema', 'b4')
      expectError(await helper.send({ v: 1, id: 'b5', cmd: 'status', args: { x: 1 } }), 'invalid', 'schema', 'b5')
      expectError(await helper.send({ v: 1, id: 'com espaço', cmd: 'status', args: {} }), 'invalid', 'schema', null)
      expectError(await helper.send({ v: 1, id: 'x'.repeat(65), cmd: 'status', args: {} }), 'invalid', 'schema', null)
      expectError(await helper.send('[1,2]'), 'invalid', 'schema', null)
      expectError(await helper.send({ v: 1, id: 'b6', cmd: 'find', args: { ...FIND, uid: 7 } }), 'invalid', 'schema', 'b6')
      expectError(await helper.send({ v: 1, id: 'b7', cmd: 'find', args: { ...FIND, allDay: 1 } }), 'invalid', 'schema', 'b7')
      expectError(await helper.send({ v: 1, id: 'b8', cmd: 'find', args: { ...FIND, start: '2026-11-20' } }), 'invalid', 'schema', 'b8')
      expectError(await helper.send({ v: 1, id: 'b9', cmd: 'find', args: { ...FIND, start: '2026-02-30T18:00:00Z' } }), 'invalid', 'schema', 'b9')
      expectError(await helper.send({ v: 1, id: 'b10', cmd: 'find', args: { ...FIND, ids: {} } }), 'invalid', 'schema', 'b10')
      expectError(await helper.send({ v: 1, id: 'b11', cmd: 'find', args: { ...FIND, title: 't'.repeat(1025) } }), 'invalid', 'schema', 'b11')
      await helper.close()
    },
  },
  {
    ca: 'CA1',
    title: 'linha de 64 KiB + 1 byte: line-too-long com id null, e a seguinte é respondida; 64 KiB cabe',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      expectError(await helper.send('x'.repeat(MAC_CALENDAR_MAX_REQUEST_LINE + 1)), 'invalid', 'line-too-long', null)
      const base = JSON.stringify({ v: 1, id: 'c1', cmd: 'status', args: {} })
      const exact = await helper.send(base + ' '.repeat(MAC_CALENDAR_MAX_REQUEST_LINE - base.length))
      expect(exact.json).toMatchObject({ id: 'c1', ok: true })
      expect((await helper.send({ v: 1, id: 'c2', cmd: 'status', args: {} })).json).toMatchObject({ id: 'c2', ok: true })
      await helper.close()
    },
  },
  {
    ca: 'CA2',
    title: 'sem acesso completo: calendars, find, create, update e remove voltam denied/restricted e nada é gravado',
    async run(ctx) {
      const cases = [
        ['denied', 'denied', 'denied'],
        ['notDetermined', 'denied', 'not-determined'],
        ['writeOnly', 'denied', 'write-only'],
        ['restricted', 'restricted', 'restricted'],
      ] as const
      for (const [access, code, reason] of cases) {
        const helper = ctx.start(state({ access, events: [accountEvent()] }))
        const before = readFileSync(ctx.stateFile, 'utf8')
        expectError(await call(helper, 'calendars'), code, reason, `r${counter}`)
        expectError(await call(helper, 'find', FIND), code, reason, `r${counter}`)
        expectError(await call(helper, 'create', CREATE), code, reason, `r${counter}`)
        expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { title: 'Outro' } }), code, reason, `r${counter}`)
        expectError(await call(helper, 'remove', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future' }), code, reason, `r${counter}`)
        // status nunca dá erro de permissão.
        expect(expectOk(await call(helper, 'status'), 'status').access).toBe(access)
        expect(readFileSync(ctx.stateFile, 'utf8')).toBe(before)
        await helper.close()
      }
    },
  },
  {
    ca: 'CA2',
    title: 'request-access: a partir de notDetermined pede uma vez; já decidido, devolve o estado',
    async run(ctx) {
      let helper = ctx.start(state({ access: 'notDetermined', onRequest: 'full' }))
      expect(expectOk(await call(helper, 'request-access'), 'request-access')).toEqual({ access: 'full', granted: true })
      expect(ctx.state().access).toBe('full')
      expect(expectOk(await call(helper, 'request-access'), 'request-access')).toEqual({ access: 'full', granted: true })
      await helper.close()
      helper = ctx.start(state({ access: 'notDetermined', onRequest: 'denied' }))
      expect(expectOk(await call(helper, 'request-access'), 'request-access')).toEqual({ access: 'denied', granted: false })
      await helper.close()
      helper = ctx.start(state({ access: 'restricted', onRequest: 'full' }))
      expect(expectOk(await call(helper, 'request-access'), 'request-access')).toEqual({ access: 'restricted', granted: false })
      await helper.close()
    },
  },
  {
    ca: 'CA3',
    title: 'calendars: os campos de cada agenda, só leitura e sem provisório marcados',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start(ctx.real ? undefined : state())
      const raw = await call(helper, 'calendars')
      if (ctx.real && !raw.json.ok) {
        expect(['denied', 'restricted']).toContain(raw.json.error.code)
      } else {
        const { calendars } = expectOk(raw, 'calendars')
        const order = calendars.map((item: any) => [item.sourceTitle, item.title].join('\u0000'))
        expect(order).toEqual([...order].sort())
        if (!ctx.real) {
          expect(calendars.map((item: any) => item.title)).toEqual(['Feriados', 'Agenda', 'Sem disponibilidade', 'Trabalho'])
          const feriados = calendars.find((item: any) => item.id === 'cal-feriados')
          expect(feriados).toMatchObject({ writable: false, sourceType: 'subscribed', isDefault: false, color: null })
          expect(feriados.availabilities).not.toContain('tentative')
          expect(calendars.filter((item: any) => item.isDefault).map((item: any) => item.id)).toEqual(['cal-trabalho'])
        }
      }
      await helper.close()
    },
  },
  {
    ca: 'CA3',
    title: 'refresh responde em menos de 1 s, sem esperar a sincronia',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      const started = Date.now()
      const result = expectOk(await call(helper, 'refresh'), 'refresh')
      expect(Date.now() - started).toBeLessThan(1_000)
      expect(Math.abs(Date.parse(result.requestedAt) - Date.now())).toBeLessThan(5_000)
      await helper.close()
    },
  },
  {
    ca: 'CA4',
    title: 'find sem nada parecido: matches vazio (não é erro)',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      const raw = await call(helper, 'find', { ...FIND, uid: `nao-existe-${Date.now()}@lap`, title: `Nada parecido ${Date.now()}`, start: '2001-01-01T00:00:00Z', end: '2001-01-01T01:00:00Z' })
      if (ctx.real && !raw.json.ok) expect(['denied', 'restricted']).toContain(raw.json.error.code)
      else expect(expectOk(raw, 'find')).toEqual({ matches: [] })
      await helper.close()
    },
  },
  {
    ca: 'CA4',
    title: 'find pelos ids, pelo UID e por título + início exato, em todas as agendas, sem repetir',
    async run(ctx) {
      const events = [
        accountEvent(),
        // Mesmo título e início, outra agenda (só leitura), external id sem relação com o UID (caso 2b do D0).
        accountEvent({ eventIdentifier: 'ex-ev', calendarItemIdentifier: 'ex-item', externalIdentifier: 'AAMkAGI2', calendarId: 'cal-feriados', title: '  Revisão do contrato  ' }),
        // Diferenças que não casam: caixa do título, um segundo a mais, fora da janela.
        accountEvent({ eventIdentifier: 'caixa', calendarItemIdentifier: 'caixa', externalIdentifier: null, title: 'revisão do contrato' }),
        accountEvent({ eventIdentifier: 'seg', calendarItemIdentifier: 'seg', externalIdentifier: null, start: '2026-11-20T18:00:01Z' }),
        accountEvent({ eventIdentifier: 'longe', calendarItemIdentifier: 'longe', start: '2026-11-25T18:00:00Z', end: '2026-11-25T19:00:00Z' }),
        accountEvent({ eventIdentifier: 'app-ev', calendarItemIdentifier: 'app-item', externalIdentifier: 'fake-ext-9', title: 'Outro título', origin: 'app' }),
      ]
      const helper = ctx.start(state({ events }))
      const before = readFileSync(ctx.stateFile, 'utf8')
      let { matches } = expectOk(await call(helper, 'find', FIND), 'find')
      expect(matches.map((item: any) => [item.calendarItemIdentifier, item.match])).toEqual([
        ['acc-item-1', 'uid'],
        ['longe', 'uid'],
        ['ex-item', 'title-start'],
      ])
      expect(matches[0]).toMatchObject({ eventIdentifier: 'acc-ev-1', externalIdentifier: 'convite-123@google.com', calendarTitle: 'Trabalho', sourceTitle: 'iCloud', occurrence: null, recurring: false })
      expect(matches[2].calendarTitle).toBe('Feriados')
      ;({ matches } = expectOk(await call(helper, 'find', { ...FIND, ids: { eventIdentifier: 'nao-tem', calendarItemIdentifier: 'app-item' } }), 'find'))
      expect(matches.map((item: any) => [item.calendarItemIdentifier, item.match])).toEqual([
        ['app-item', 'calendarItemIdentifier'],
        ['acc-item-1', 'uid'],
        ['longe', 'uid'],
        ['ex-item', 'title-start'],
      ])
      ;({ matches } = expectOk(await call(helper, 'find', { ...FIND, ids: { eventIdentifier: 'acc-ev-1' } }), 'find'))
      expect(matches[0]).toMatchObject({ calendarItemIdentifier: 'acc-item-1', match: 'eventIdentifier' })
      expect(matches.filter((item: any) => item.calendarItemIdentifier === 'acc-item-1')).toHaveLength(1)
      ;({ matches } = expectOk(await call(helper, 'find', { ...FIND, ids: { externalIdentifier: 'fake-ext-9' } }), 'find'))
      expect(matches[0]).toMatchObject({ calendarItemIdentifier: 'app-item', match: 'externalIdentifier' })
      // O find nunca grava.
      expect(readFileSync(ctx.stateFile, 'utf8')).toBe(before)
      await helper.close()
    },
  },
  {
    ca: 'CA4',
    title: 'find com recurrenceId acha a ocorrência daquela data',
    async run(ctx) {
      const series = accountEvent({ recurrence: { freq: 'weekly', interval: 1, count: 4 } })
      const helper = ctx.start(state({ events: [series] }))
      const { matches } = expectOk(
        await call(helper, 'find', { ...FIND, start: '2026-11-27T18:00:00Z', end: '2026-11-27T19:00:00Z', recurrenceId: '2026-11-27T18:00:00Z', ids: { calendarItemIdentifier: 'acc-item-1' } }),
        'find',
      )
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({ match: 'calendarItemIdentifier', occurrence: '2026-11-27T18:00:00Z', start: '2026-11-27T18:00:00Z', recurring: true })
      await helper.close()
    },
  },
  {
    ca: 'CA5',
    title: 'create grava os campos e devolve os ids lidos depois de salvar',
    async run(ctx) {
      const helper = ctx.start(state())
      const result = expectOk(await call(helper, 'create', { ...CREATE, start: '2026-11-20T18:00:00.750Z' }), 'create')
      expect(result).toEqual({
        availabilityFallback: false,
        event: {
          allDay: false,
          availability: 'busy',
          calendarId: 'cal-trabalho',
          calendarItemIdentifier: 'fake-item-1',
          calendarTitle: 'Trabalho',
          end: '2026-11-20T19:00:00Z',
          eventIdentifier: 'fake-ev-1',
          externalIdentifier: 'fake-ext-1',
          occurrence: null,
          recurring: false,
          sourceTitle: 'iCloud',
          start: '2026-11-20T18:00:00Z',
          timeZone: 'America/New_York',
          title: 'Planejamento',
          url: 'https://meet.google.com/abc-defg-hij',
        },
        exdatesMissing: [],
        exdatesRemoved: [],
      })
      expect(ctx.state().events[0]).toMatchObject({ origin: 'app', location: 'Sala 3', notes: CREATE.notes })
      // Dia inteiro: datas com o fim exclusivo, sem fuso.
      const allDay = expectOk(await call(helper, 'create', { ...CREATE, allDay: true, start: '2026-12-24', end: '2026-12-26', timeZone: null }), 'create')
      expect(allDay.event).toMatchObject({ allDay: true, start: '2026-12-24', end: '2026-12-26', timeZone: null, eventIdentifier: 'fake-ev-2' })
      await helper.close()
    },
  },
  {
    ca: 'CA5',
    title: 'create recusa sem deixar evento gravado',
    async run(ctx) {
      const helper = ctx.start(state())
      expectError(await call(helper, 'create', { ...CREATE, calendarId: 'cal-feriados' }), 'invalid', 'read-only-calendar', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, calendarId: 'nao-existe' }), 'not-found', 'calendar', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, end: CREATE.start }), 'invalid', 'dates', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, end: '2026-11-20T17:00:00Z' }), 'invalid', 'dates', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, timeZone: 'Brasil/Sao_Paulo_Nao' }), 'invalid', 'timezone', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, url: 'ftp://exemplo.com/a' }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, url: 'javascript:alert(1)' }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, notes: 'n'.repeat(MAC_CALENDAR_MAX_NOTES + 1) }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, availability: 'free' }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, alarms: [] }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, allDay: true, start: '2026-12-24', end: '2026-12-25', timeZone: 'America/New_York' }), 'invalid', 'schema', `r${counter}`)
      const { title: _title, ...noTitle } = CREATE
      expectError(await call(helper, 'create', noTitle), 'invalid', 'schema', `r${counter}`)
      expect(ctx.state().events).toEqual([])
      await helper.close()
    },
  },
  {
    ca: 'CA5',
    title: 'dia inteiro no dia da troca de horário: o fim é a meia-noite do último dia de calendário, não 86.400 s antes',
    readOnly: true,
    async run(ctx) {
      // Nova York adianta o relógio em 14/03/2027 e Berlim em 28/03/2027: esses dias têm 23 h. Sem acesso ou sem a agenda,
      // nada é gravado; a conta das datas vem antes (allDayRange) e não pode dar invalid/dates.
      for (const [tz, date, next] of [
        ['America/New_York', '2027-03-14', '2027-03-15'],
        ['Europe/Berlin', '2027-03-28', '2027-03-29'],
        ['America/New_York', '2027-11-07', '2027-11-08'],
      ] as const) {
        const helper = ctx.start(undefined, { TZ: tz })
        const args = { ...CREATE, calendarId: 'agenda-que-nao-existe', allDay: true, start: date, end: next, timeZone: null }
        const raw = await call(helper, 'create', args)
        expect(raw.json.ok).toBe(false)
        expect([raw.json.error.code, raw.json.error.reason], `${tz} ${date}`).not.toEqual(['invalid', 'dates'])
        expect(['not-found', 'denied', 'restricted']).toContain(raw.json.error.code)
        expectError(await call(helper, 'create', { ...args, end: date }), 'invalid', 'dates', `r${counter}`)
        await helper.close()
      }
    },
  },
  {
    ca: 'CA6',
    title: 'provisório só onde a agenda aceita; senão ocupado com availabilityFallback',
    async run(ctx) {
      const helper = ctx.start(state())
      let result = expectOk(await call(helper, 'create', { ...CREATE, availability: 'tentative' }), 'create')
      expect([result.event.availability, result.availabilityFallback]).toEqual(['tentative', false])
      result = expectOk(await call(helper, 'create', { ...CREATE, calendarId: 'cal-exchange', availability: 'tentative' }), 'create')
      expect([result.event.availability, result.availabilityFallback]).toEqual(['busy', true])
      result = expectOk(await call(helper, 'create', { ...CREATE, calendarId: 'cal-sem', availability: 'tentative' }), 'create')
      expect([result.event.availability, result.availabilityFallback]).toEqual(['none', true])
      await helper.close()
    },
  },
  {
    ca: 'CA7',
    title: 'create com recorrência grava a série; cada EXDATE tira a ocorrência ou vai para exdatesMissing',
    async run(ctx) {
      const helper = ctx.start(state())
      const weekly = expectOk(
        await call(helper, 'create', { ...CREATE, recurrence: { freq: 'weekly', interval: 2, until: '2027-03-01', byDay: [{ day: 'MO' }, { day: 'WE' }], weekStart: 'MO' } }),
        'create',
      )
      expect(weekly.event.recurring).toBe(true)
      const monthly = expectOk(await call(helper, 'create', { ...CREATE, recurrence: { freq: 'monthly', count: 6, byDay: [{ day: 'TU', pos: -1 }], bySetPos: [1], byMonthDay: [-1, 15] } }), 'create')
      expect(monthly.event.recurring).toBe(true)
      expectOk(await call(helper, 'create', { ...CREATE, recurrence: { freq: 'yearly', byMonth: [1, 12] } }), 'create')
      const daily = expectOk(await call(helper, 'create', { ...SERIES, exdates: ['2026-11-21T18:00:00Z', '2026-11-22T18:00:00.000Z', '2026-11-21T19:00:00Z'] }), 'create')
      expect(daily.exdatesRemoved).toEqual(['2026-11-21T18:00:00Z', '2026-11-22T18:00:00Z'])
      expect(daily.exdatesMissing).toEqual(['2026-11-21T19:00:00Z'])
      const at = async (start: string) => expectOk(await call(helper, 'find', { ...FIND, uid: 'x', title: 'Diária', start, end: start.replace('T18', 'T19') }), 'find').matches
      expect(await at('2026-11-21T18:00:00Z')).toEqual([])
      expect((await at('2026-11-23T18:00:00Z')).map((item: any) => [item.occurrence, item.match])).toEqual([['2026-11-23T18:00:00Z', 'title-start']])
      await helper.close()
    },
  },
  {
    ca: 'CA7',
    title: 'recorrência fora do que o EventKit representa: invalid/recurrence, nada gravado',
    async run(ctx) {
      const helper = ctx.start(state())
      const bad: object[] = [
        { freq: 'daily', count: 3, until: '2027-01-01' },
        { freq: 'weekly', byDay: [{ day: 'MO', pos: 1 }] },
        { freq: 'daily', byDay: [{ day: 'MO', pos: -1 }] },
        { freq: 'daily', bySetPos: [1] },
        { freq: 'weekly', bySetPos: [1] },
        { freq: 'daily', byHour: [9] },
        { freq: 'daily', byMinute: [0] },
        { freq: 'daily', bySecond: [0] },
        { freq: 'yearly', byWeekNo: [1] },
        { freq: 'yearly', byYearDay: [1] },
        { freq: 'daily', rdate: ['2026-11-20T18:00:00Z'] },
        { freq: 'hourly' },
        { freq: 'minutely' },
        { freq: 'secondly' },
        { freq: 'daily', interval: 0 },
        { freq: 'daily', interval: 1000 },
        { freq: 'daily', count: 0 },
        { freq: 'monthly', byMonthDay: [0] },
        { freq: 'monthly', byMonthDay: [32] },
        { freq: 'yearly', byMonth: [13] },
        { freq: 'monthly', byDay: [{ day: 'XX' }] },
        { freq: 'monthly', byDay: [{ day: 'MO', pos: 54 }] },
        { freq: 'daily', until: 'amanhã' },
        { interval: 2 },
      ]
      for (const recurrence of bad) expectError(await call(helper, 'create', { ...CREATE, recurrence }), 'invalid', 'recurrence', `r${counter}`)
      expectError(await call(helper, 'create', { ...CREATE, exdates: ['2026-11-21T18:00:00Z'] }), 'invalid', 'recurrence', `r${counter}`)
      expect(ctx.state().events).toEqual([])
      await helper.close()
    },
  },
  {
    ca: 'CA9',
    title: 'update sem recurrenceId muda o evento inteiro e devolve o evento lido de novo',
    async run(ctx) {
      const helper = ctx.start(state({ events: [accountEvent({ origin: 'app' })] }))
      const result = expectOk(
        await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { title: 'Revisão (nova hora)', start: '2026-11-20T19:00:00Z', end: '2026-11-20T20:00:00Z', availability: 'tentative' } }),
        'update',
      )
      expect(result.event).toMatchObject({ title: 'Revisão (nova hora)', start: '2026-11-20T19:00:00Z', end: '2026-11-20T20:00:00Z', availability: 'tentative', timeZone: 'America/Sao_Paulo' })
      expect(result.availabilityFallback).toBe(false)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { end: '2026-11-20T18:00:00Z' } }), 'invalid', 'dates', `r${counter}`)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: {} }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { color: 'red' } }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { timeZone: 'Lugar/Nenhum' } }), 'invalid', 'timezone', `r${counter}`)
      // Trocar allDay pede as duas datas novas (o binário e o falso recusam igual).
      for (const fields of [{ allDay: true }, { allDay: true, start: '2026-11-20' }, { allDay: false, end: '2026-11-20T20:00:00Z' }]) {
        expectError(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields }), 'invalid', 'schema', `r${counter}`)
      }
      const allDay = expectOk(await call(helper, 'update', { ids: { eventIdentifier: 'acc-ev-1' }, span: 'future', fields: { allDay: true, start: '2026-11-20', end: '2026-11-21', timeZone: null } }), 'update')
      expect(allDay.event).toMatchObject({ allDay: true, start: '2026-11-20', end: '2026-11-21', timeZone: null })
      await helper.close()
    },
  },
  {
    ca: 'CA9',
    title: 'update de uma ocorrência (this) não muda as outras; future a partir dela; erros nomeados',
    async run(ctx) {
      const helper = ctx.start(state({ events: [accountEvent({ origin: 'app' })] }))
      const created = expectOk(await call(helper, 'create', SERIES), 'create')
      const ids = { eventIdentifier: created.event.eventIdentifier }
      const one = expectOk(await call(helper, 'update', { ids, recurrenceId: '2026-11-22T18:00:00Z', span: 'this', fields: { title: 'Diária (mudou)' } }), 'update')
      expect(one.event).toMatchObject({ title: 'Diária (mudou)', occurrence: '2026-11-22T18:00:00Z' })
      const titleAt = async (recurrenceId: string) =>
        expectOk(await call(helper, 'find', { ...FIND, uid: 'x', title: 'sem título igual', start: recurrenceId, end: recurrenceId.replace('T18', 'T19'), recurrenceId, ids }), 'find').matches.map((item: any) => item.title)
      expect(await titleAt('2026-11-21T18:00:00Z')).toEqual(['Diária'])
      expect(await titleAt('2026-11-22T18:00:00Z')).toEqual(['Diária (mudou)'])
      expect(await titleAt('2026-11-23T18:00:00Z')).toEqual(['Diária'])
      expectError(await call(helper, 'update', { ids, span: 'this', fields: { title: 'x' } }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'update', { ids, recurrenceId: '2026-11-22T18:00:00Z', span: 'this', fields: { recurrence: { freq: 'weekly' } } }), 'invalid', 'recurrence', `r${counter}`)
      expectError(await call(helper, 'update', { ids, recurrenceId: '2026-11-22T18:00:00Z', span: 'this', fields: { recurrence: null } }), 'invalid', 'recurrence', `r${counter}`)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'nao-existe' }, span: 'future', fields: { title: 'x' } }), 'not-found', 'event', `r${counter}`)
      expectError(await call(helper, 'update', { ids, recurrenceId: '2026-11-22T18:30:00Z', span: 'this', fields: { title: 'x' } }), 'not-found', 'occurrence', `r${counter}`)
      // Desta em diante: a série nova começa na ocorrência, com ids novos; a de antes fica até a véspera.
      const future = expectOk(await call(helper, 'update', { ids, recurrenceId: '2026-11-23T18:00:00Z', span: 'future', fields: { title: 'Diária (nova fase)' } }), 'update')
      expect(future.event).toMatchObject({ title: 'Diária (nova fase)', start: '2026-11-23T18:00:00Z' })
      expect(future.event.eventIdentifier).not.toBe(ids.eventIdentifier)
      await helper.close()
    },
  },
  {
    ca: 'CA9',
    title: 'update: id externo repetido é ambiguous; evento de agenda só de leitura é not-mutable',
    async run(ctx) {
      const events = [accountEvent(), accountEvent({ eventIdentifier: 'dup', calendarItemIdentifier: 'dup' }), accountEvent({ eventIdentifier: 'ro', calendarItemIdentifier: 'ro', externalIdentifier: 'ro', calendarId: 'cal-feriados' })]
      const helper = ctx.start(state({ events }))
      expectError(await call(helper, 'update', { ids: { externalIdentifier: 'convite-123@google.com' }, span: 'future', fields: { title: 'x' } }), 'invalid', 'ambiguous', `r${counter}`)
      expectError(await call(helper, 'update', { ids: { eventIdentifier: 'ro' }, span: 'future', fields: { title: 'x' } }), 'invalid', 'not-mutable', `r${counter}`)
      expectError(await call(helper, 'remove', { ids: { externalIdentifier: 'convite-123@google.com' }, span: 'future' }), 'invalid', 'ambiguous', `r${counter}`)
      expect(ctx.state().events).toHaveLength(3)
      await helper.close()
    },
  },
  {
    ca: 'CA10',
    title: 'remove de uma ocorrência deixa as outras; remove da série tira tudo; só pelos ids',
    async run(ctx) {
      const helper = ctx.start(state({ events: [accountEvent()] }))
      const created = expectOk(await call(helper, 'create', SERIES), 'create')
      const ids = { calendarItemIdentifier: created.event.calendarItemIdentifier }
      const removed = expectOk(await call(helper, 'remove', { ids, recurrenceId: '2026-11-21T18:00:00Z', span: 'this' }), 'remove')
      expect(removed).toEqual({ removed: { calendarItemIdentifier: 'fake-item-1', occurrence: '2026-11-21T18:00:00Z', span: 'this' } })
      const occurrenceAt = async (recurrenceId: string) =>
        expectOk(await call(helper, 'find', { ...FIND, uid: 'x', title: 'Diária', start: recurrenceId, end: recurrenceId.replace('T18', 'T19'), recurrenceId, ids }), 'find').matches.map((item: any) => item.occurrence)
      expect(await occurrenceAt('2026-11-21T18:00:00Z')).toEqual([])
      expect(await occurrenceAt('2026-11-20T18:00:00Z')).toEqual(['2026-11-20T18:00:00Z'])
      expect(await occurrenceAt('2026-11-22T18:00:00Z')).toEqual(['2026-11-22T18:00:00Z'])
      expectError(await call(helper, 'remove', { ids, span: 'this' }), 'invalid', 'schema', `r${counter}`)
      // Ids que não acham nada: nada sai, mesmo com título e início iguais aos de um evento da agenda.
      expectError(await call(helper, 'remove', { ids: { eventIdentifier: 'Revisão do contrato' }, span: 'future' }), 'not-found', 'event', `r${counter}`)
      expectError(await call(helper, 'remove', { ids: { eventIdentifier: 'x' }, span: 'future', title: 'Revisão do contrato' }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'remove', { ids, recurrenceId: '2026-12-25T18:00:00Z', span: 'this' }), 'not-found', 'occurrence', `r${counter}`)
      expect(expectOk(await call(helper, 'remove', { ids, span: 'future' }), 'remove').removed).toEqual({ calendarItemIdentifier: 'fake-item-1', occurrence: null, span: 'future' })
      expect(ctx.state().events.map((event: any) => event.calendarItemIdentifier)).toEqual(['acc-item-1'])
      await helper.close()
    },
  },
  {
    ca: 'CA11',
    title: 'stdin fechado: sai com 0 em até 1 s',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      await helper.send({ v: 1, id: 'd1', cmd: 'status', args: {} })
      const started = Date.now()
      expect(await helper.close()).toBe(0)
      expect(Date.now() - started).toBeLessThan(1_500)
    },
  },
  {
    ca: 'CA11',
    title: '--version e argumento desconhecido',
    readOnly: true,
    async run(ctx) {
      const [file, args]: [string, string[]] = ctx.real ? [realBinary, []] : [process.execPath, [FAKE]]
      await Promise.resolve()
      const version = spawnSync(file, [...args, '--version'], { encoding: 'utf8', input: '' })
      expect(version.status).toBe(0)
      expect(version.stdout).toMatch(ctx.real ? /^lap-calendar 2\n$/ : /^lap-calendar 2 \(falso\)\n$/)
      const other = spawnSync(file, [...args, '--outro'], { encoding: 'utf8', input: '' })
      expect(other.status).toBe(64)
      expect(other.stderr).toContain('uso: lap-calendar')
    },
  },
  {
    ca: 'C132',
    title: 'list: args fora do formato (chave a mais, sem start, data em vez de instante) são schema; fim ≤ início ou janela de mais de 35 dias, dates',
    readOnly: true,
    async run(ctx) {
      const helper = ctx.start()
      expectError(await call(helper, 'list', { ...LIST, extra: 1 }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'list', { end: LIST.end }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'list', { ...LIST, start: '2026-11-22' }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'list', { ...LIST, end: 7 }), 'invalid', 'schema', `r${counter}`)
      expectError(await call(helper, 'list', { start: LIST.end, end: LIST.start }), 'invalid', 'dates', `r${counter}`)
      expectError(await call(helper, 'list', { start: LIST.start, end: LIST.start }), 'invalid', 'dates', `r${counter}`)
      expectError(await call(helper, 'list', { start: LIST.start, end: '2026-12-27T03:00:01Z' }), 'invalid', 'dates', `r${counter}`)
      await helper.close()
    },
  },
  {
    ca: 'C132',
    title: 'list: janela de exatamente 35 dias é aceita',
    async run(ctx) {
      const helper = ctx.start(state({ events: [accountEvent({ start: '2026-12-26T12:00:00Z', end: '2026-12-26T13:00:00Z' })] }))
      expect(MAC_CALENDAR_MAX_LIST_WINDOW_MS).toBe(35 * 86_400_000)
      const { events } = expectOk(await call(helper, 'list', { start: LIST.start, end: '2026-12-27T03:00:00Z' }), 'list')
      expect(events.map((item: any) => item.title)).toEqual(['Revisão do contrato'])
      await helper.close()
    },
  },
  {
    ca: 'C132',
    title: 'list: dia inteiro na borda da janela (meia-noite UTC no falso)',
    async run(ctx) {
      // Como no `find`, o falso põe o dia inteiro na meia-noite UTC; o helper de verdade, na meia-noite local. Com a
      // janela do dia 22 em São Paulo (03:00Z a 03:00Z), o dia 23 entra no falso (00:00Z < 03:00Z) e fica de fora no
      // Mac (a meia-noite local do 23 é 03:00Z, o fim exclusivo); o dia 21 fica de fora nos dois.
      const allDay = (day: string, next: string) => accountEvent({ eventIdentifier: `dia-${day}`, calendarItemIdentifier: `dia-${day}`, title: `Dia ${day}`, allDay: true, timeZone: null, start: day, end: next })
      const helper = ctx.start(state({ events: [allDay('2026-11-21', '2026-11-22'), allDay('2026-11-22', '2026-11-23'), allDay('2026-11-23', '2026-11-24')] }))
      const { events } = expectOk(await call(helper, 'list', LIST), 'list')
      expect(events.map((item: any) => [item.title, item.start, item.end, item.allDay, item.timeZone])).toEqual([
        ['Dia 2026-11-22', '2026-11-22', '2026-11-23', true, null],
        ['Dia 2026-11-23', '2026-11-23', '2026-11-24', true, null],
      ])
      await helper.close()
    },
  },
  {
    ca: 'C132',
    title: 'list: só o que cruza a janela, pelo início, ocorrências da série, sem aniversários e nada gravado',
    async run(ctx) {
      const events = [
        accountEvent({ eventIdentifier: 'tarde', calendarItemIdentifier: 'tarde', title: 'Tarde', start: '2026-11-22T18:00:00Z', end: '2026-11-22T19:00:00Z' }),
        accountEvent({ eventIdentifier: 'cedo', calendarItemIdentifier: 'cedo', title: 'Cedo', start: '2026-11-22T11:00:00Z', end: '2026-11-22T12:00:00Z' }),
        accountEvent({ eventIdentifier: 'virada', calendarItemIdentifier: 'virada', title: 'Virada', start: '2026-11-22T02:00:00Z', end: '2026-11-22T04:00:00Z' }),
        accountEvent({ eventIdentifier: 'antes', calendarItemIdentifier: 'antes', title: 'Antes', start: '2026-11-22T01:00:00Z', end: '2026-11-22T03:00:00Z' }),
        accountEvent({ eventIdentifier: 'depois', calendarItemIdentifier: 'depois', title: 'Depois', start: '2026-11-23T03:00:00Z', end: '2026-11-23T04:00:00Z' }),
        accountEvent({ eventIdentifier: 'serie', calendarItemIdentifier: 'serie', title: 'Diária', start: '2026-11-20T15:00:00Z', end: '2026-11-20T15:30:00Z', recurrence: { freq: 'daily', interval: 1, count: 5 } }),
        accountEvent({ eventIdentifier: 'niver', calendarItemIdentifier: 'niver', title: 'Aniversário', calendarId: 'cal-aniversarios', start: '2026-11-22T12:00:00Z', end: '2026-11-22T13:00:00Z' }),
      ]
      const helper = ctx.start(state({ calendars: [...CALENDARS, BIRTHDAYS], events }))
      const before = readFileSync(ctx.stateFile, 'utf8')
      const { events: listed } = expectOk(await call(helper, 'list', LIST), 'list')
      expect(listed.map((item: any) => [item.title, item.start, item.occurrence])).toEqual([
        ['Virada', '2026-11-22T02:00:00Z', null],
        ['Cedo', '2026-11-22T11:00:00Z', null],
        ['Diária', '2026-11-22T15:00:00Z', '2026-11-22T15:00:00Z'],
        ['Tarde', '2026-11-22T18:00:00Z', null],
      ])
      expect(listed[0]).toMatchObject({ calendarId: 'cal-trabalho', calendarTitle: 'Trabalho', sourceTitle: 'iCloud', recurring: false })
      expect(expectOk(await call(helper, 'list', { start: '2026-11-25T00:00:00.500Z', end: '2026-11-26T00:00:00Z' }), 'list').events).toEqual([])
      expect(readFileSync(ctx.stateFile, 'utf8')).toBe(before)
      await helper.close()
    },
  },
  {
    ca: 'C132',
    title: 'list: no máximo 200 eventos, os primeiros pelo início',
    async run(ctx) {
      const events = Array.from({ length: 250 }, (_, index) => {
        const minute = String(index % 60).padStart(2, '0')
        const hour = String(3 + Math.floor(index / 60)).padStart(2, '0')
        return accountEvent({ eventIdentifier: `ev-${index}`, calendarItemIdentifier: `item-${String(index).padStart(3, '0')}`, title: `Evento ${index}`, start: `2026-11-22T${hour}:${minute}:00Z`, end: `2026-11-22T${hour}:${minute}:30Z` })
      })
      const helper = ctx.start(state({ events: events.reverse() }))
      const { events: listed } = expectOk(await call(helper, 'list', LIST), 'list')
      expect(listed).toHaveLength(MAC_CALENDAR_MAX_LIST)
      expect(listed.map((item: any) => item.title)).toEqual(Array.from({ length: MAC_CALENDAR_MAX_LIST }, (_, index) => `Evento ${index}`))
      await helper.close()
    },
  },
  {
    ca: 'C132',
    title: 'list sem acesso completo: denied/restricted, como os outros comandos de leitura',
    async run(ctx) {
      for (const [access, code, reason] of [
        ['denied', 'denied', 'denied'],
        ['notDetermined', 'denied', 'not-determined'],
        ['writeOnly', 'denied', 'write-only'],
        ['restricted', 'restricted', 'restricted'],
      ] as const) {
        const helper = ctx.start(state({ access, events: [accountEvent({ start: '2026-11-22T12:00:00Z', end: '2026-11-22T13:00:00Z' })] }))
        expectError(await call(helper, 'list', LIST), code, reason, `r${counter}`)
        await helper.close()
      }
    },
  },
]

describe('protocolo do lap-calendar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lap-calendar-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  for (const entry of TABLE) {
    it(`${entry.ca} — ${entry.title}`, () => entry.run(context(false, dir)), 20_000)
  }

  describe.skipIf(!REAL)('binário de verdade (LAP_CALENDAR_REAL=1, só leitura)', () => {
    beforeAll(() => {
      realDir = mkdtempSync(join(tmpdir(), 'lap-calendar-real-'))
      realBinary = join(realDir, 'lap-calendar')
      const built = spawnSync('/usr/bin/swiftc', [...MAC_CALENDAR_SWIFTC_ARGS, MAC_CALENDAR_SOURCE, '-o', realBinary], { cwd: ROOT, encoding: 'utf8' })
      expect(built.status, built.stderr).toBe(0)
    }, 300_000)
    afterAll(() => rmSync(realDir, { recursive: true, force: true }))

    for (const entry of TABLE.filter((item) => item.readOnly)) {
      it(`${entry.ca} — ${entry.title}`, () => entry.run(context(true, dir)), 20_000)
    }
  })
})

// --- Cliente -----------------------------------------------------------------------------------------------------

interface MockChild {
  child: ChildProcess
  /** Cada linha que o cliente escreveu no stdin. */
  written: string[]
  signals: string[]
  reply(line: string): void
  exit(code: number | null): void
  stdinEnded: () => boolean
}

/** Um `ChildProcess` de mentira: o teste lê o stdin e escreve o stdout. */
function mockChild(options: { ignoreTerm?: boolean } = {}): MockChild {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const written: string[] = []
  const signals: string[] = []
  let ended = false
  let buffer = ''
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    buffer += chunk
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      written.push(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
    }
  })
  stdin.on('finish', () => {
    ended = true
  })
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill(signal: string) {
      signals.push(signal)
      if (signal === 'SIGKILL' || !options.ignoreTerm) exit(null, signal)
      return true
    },
  })
  function exit(code: number | null, signal: string | null = null): void {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.exitCode = code
    child.signalCode = signal
    setImmediate(() => emitter.emit('exit', code, signal))
  }
  return {
    child: child as unknown as ChildProcess,
    written,
    signals,
    reply: (line) => void stdout.write(`${line}\n`),
    exit: (code) => exit(code ?? 1),
    stdinEnded: () => ended,
  }
}

const fakeCommand = (env: Record<string, string> = {}): MacCalendarCommand => ({ file: process.execPath, args: [FAKE], env: { PATH: '/usr/bin:/bin', ...env } })

function client(patch: Partial<MacCalendarOptions> = {}) {
  const logs: string[] = []
  let spawned = 0
  const spawnFake: SpawnMacCalendar = (cmd) => {
    spawned++
    return spawn(cmd.file, [...cmd.args], { env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] })
  }
  const calendar = createMacCalendar({
    platform: 'darwin',
    arch: 'arm64',
    systemVersion: '26.6.0',
    packaged: true,
    command: () => Promise.resolve(fakeCommand()),
    spawn: spawnFake,
    log: (message) => void logs.push(message),
    baseDelayMs: 20,
    ...patch,
  })
  return { calendar, logs, spawned: () => spawned }
}

const ok = (id: string, result: object) => JSON.stringify({ id, ok: true, result, v: 1 })
const idOf = (line: string | undefined): string => (JSON.parse(line ?? '{}') as { id: string }).id

describe('cliente do lap-calendar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lap-calendar-cliente-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const stateFile = (content: object): string => {
    const file = join(dir, `state-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(file, JSON.stringify(content))
    return file
  }

  it('CA12 — fora do macOS 14.4 com Apple Silicon: unavailable/platform, sem spawn', async () => {
    for (const patch of [{ platform: 'linux' as const }, { arch: 'x64' }, { systemVersion: '14.3.1' }, { systemVersion: '13.6' }]) {
      const { calendar, spawned } = client(patch)
      for (const outcome of [await calendar.status(), await calendar.calendars(), await calendar.find(FIND), await calendar.create(CREATE), await calendar.requestAccess()]) {
        expect(outcome).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'platform' } })
      }
      expect(spawned()).toBe(0)
      await calendar.dispose()
    }
  })

  it('CA12 — sem binário: no-binary; fora do pacote, requestAccess é dev sem mandar nada; depois do dispose, disposed', async () => {
    const missing = client({ command: () => Promise.resolve(null) })
    expect(await missing.calendar.status()).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'no-binary' } })
    expect(missing.spawned()).toBe(0)
    await missing.calendar.dispose()

    const log = join(dir, 'dev.jsonl')
    const dev = client({ packaged: false, command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_LOG: log })) })
    expect(await dev.calendar.requestAccess()).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'dev' } })
    expect(dev.spawned()).toBe(0)
    expect(await dev.calendar.status()).toEqual({ ok: true, value: { access: 'full', version: 'lap-calendar 2' } })
    expect(readFileSync(log, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { cmd: string }).cmd)).toEqual(['status'])
    await dev.calendar.dispose()
    for (const outcome of [await dev.calendar.status(), await dev.calendar.refresh(), await dev.calendar.remove({ ids: { eventIdentifier: 'x' }, span: 'future' })]) {
      expect(outcome).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'disposed' } })
    }
  })

  it('CA12 — a API inteira com o falso, e nenhum método rejeita', async () => {
    const { calendar } = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: stateFile(state()) })) })
    expect(Object.keys(calendar).sort()).toEqual(['calendars', 'create', 'dispose', 'find', 'list', 'refresh', 'remove', 'requestAccess', 'status', 'update'])
    expect((await calendar.calendars()).ok).toBe(true)
    expect((await calendar.refresh()).ok).toBe(true)
    const created = await calendar.create(CREATE)
    expect(created).toMatchObject({ ok: true, value: { event: { eventIdentifier: 'fake-ev-1' } } })
    expect(await calendar.update({ ids: { eventIdentifier: 'fake-ev-1' }, span: 'future', fields: { title: 'Outro' } })).toMatchObject({ ok: true, value: { event: { title: 'Outro' } } })
    expect(await calendar.find({ ...FIND, title: 'Outro', uid: 'u' })).toMatchObject({ ok: true, value: { matches: [{ match: 'title-start' }] } })
    expect(await calendar.remove({ ids: { eventIdentifier: 'fake-ev-1' }, span: 'future' })).toMatchObject({ ok: true })
    expect(await calendar.create({ ...CREATE, calendarId: 'cal-feriados' })).toMatchObject({ ok: false, error: { code: 'invalid', reason: 'read-only-calendar' } })
    // Argumento fora do esquema não sai do cliente.
    expect(await calendar.create({ ...CREATE, url: 'ftp://x' })).toMatchObject({ ok: false, error: { code: 'invalid', reason: 'schema' } })
    await calendar.dispose()
  })

  it('CA13 — sob demanda, um spawn só, uma requisição por vez, cada promessa com a sua resposta', async () => {
    const mocks: MockChild[] = []
    const logs: string[] = []
    const calendar = createMacCalendar({
      platform: 'darwin',
      arch: 'arm64',
      systemVersion: '26.6.0',
      packaged: true,
      command: () => Promise.resolve(fakeCommand()),
      spawn: () => {
        const mock = mockChild()
        mocks.push(mock)
        return mock.child
      },
      log: (message) => void logs.push(message),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks).toHaveLength(0)
    const calls = Array.from({ length: 10 }, () => calendar.status())
    const mock = await vi.waitFor(() => {
      expect(mocks).toHaveLength(1)
      return mocks[0] as MockChild
    })
    const ids: string[] = []
    for (let index = 0; index < 10; index++) {
      await vi.waitFor(() => expect(mock.written).toHaveLength(index + 1))
      // A próxima só sai depois da resposta da anterior.
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(mock.written).toHaveLength(index + 1)
      const id = idOf(mock.written[index])
      ids.push(id)
      if (index === 3) {
        // id desconhecido e id repetido: descartados com log; a promessa espera a dela.
        mock.reply(ok('nao-e-esse', { access: 'full', version: 'lap-calendar 2' }))
        mock.reply(ok(ids[0] ?? '', { access: 'full', version: 'lap-calendar 2' }))
      }
      mock.reply(ok(id, { access: index % 2 ? 'denied' : 'full', version: 'lap-calendar 2' }))
    }
    const outcomes = await Promise.all(calls)
    expect(new Set(ids).size).toBe(10)
    expect(outcomes.map((outcome) => (outcome.ok ? outcome.value.access : null))).toEqual(Array.from({ length: 10 }, (_, index) => (index % 2 ? 'denied' : 'full')))
    expect(mocks).toHaveLength(1)
    expect(logs.filter((message) => message.includes('id desconhecido ou repetido'))).toHaveLength(2)
    await calendar.dispose()
  })

  it('CA13 — mais de 32 pendentes: a 33ª volta busy; requisição maior que 64 KiB não sai', async () => {
    const mock = mockChild()
    const calendar = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child })
    expect(MAC_CALENDAR_MAX_PENDING).toBe(32)
    const pending = Array.from({ length: MAC_CALENDAR_MAX_PENDING }, () => calendar.status())
    expect(await calendar.status()).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'busy' } })
    const control = '\u0001'
    const huge = await calendar.update({
      ids: { eventIdentifier: control.repeat(1024), calendarItemIdentifier: control.repeat(1024), externalIdentifier: control.repeat(1024) },
      span: 'future',
      fields: { title: control.repeat(1024), notes: control.repeat(MAC_CALENDAR_MAX_NOTES), location: control.repeat(1024), exdates: Array.from({ length: 500 }, () => '2026-11-20T18:00:00.123456Z') },
    })
    // A fila estava cheia: o limite de tamanho vale de novo com a fila livre.
    expect(huge).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'busy' } })
    await calendar.dispose()
    for (const outcome of await Promise.all(pending)) expect(outcome).toMatchObject({ ok: false, error: { reason: 'disposed' } })

    const fresh = mockChild()
    const other = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => fresh.child })
    const tooLong = await other.update({
      ids: { eventIdentifier: control.repeat(1024), calendarItemIdentifier: control.repeat(1024), externalIdentifier: control.repeat(1024) },
      span: 'future',
      fields: { title: control.repeat(1024), notes: control.repeat(MAC_CALENDAR_MAX_NOTES), location: control.repeat(1024), exdates: Array.from({ length: 500 }, () => '2026-11-20T18:00:00.123456Z') },
    })
    expect(tooLong).toMatchObject({ ok: false, error: { code: 'invalid', reason: 'line-too-long' } })
    expect(fresh.written).toEqual([])
    await other.dispose()
  })

  it('CA14 — prazos exportados; o helper que não responde: timeout, o processo morre e a fila segue no novo', async () => {
    expect(MAC_CALENDAR_TIMEOUTS_MS).toEqual({ status: 10_000, calendars: 10_000, refresh: 10_000, find: 10_000, list: 10_000, create: 15_000, update: 15_000, remove: 15_000, 'request-access': 120_000 })
    expect(MAC_CALENDAR_KILL_AFTER_MS).toBe(3_000)
    const log = join(dir, 'hang.jsonl')
    const { calendar, spawned, logs } = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_HANG: 'find', FAKE_LAP_CALENDAR_LOG: log })), timeouts: { find: 300 } })
    const hung = calendar.find(FIND)
    const after = calendar.status()
    expect(await hung).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'timeout' } })
    expect(await after).toEqual({ ok: true, value: { access: 'full', version: 'lap-calendar 2' } })
    expect(spawned()).toBe(2)
    expect(logs.some((message) => message.includes('find') && message.includes('timeout'))).toBe(true)
    await calendar.dispose()
  })

  it('CA14 — create que deu timeout não é repetido; quem não sai com SIGTERM leva SIGKILL', async () => {
    const log = join(dir, 'hang-create.jsonl')
    const { calendar } = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_HANG: 'create', FAKE_LAP_CALENDAR_LOG: log })), timeouts: { create: 200 } })
    expect(await calendar.create(CREATE)).toMatchObject({ ok: false, error: { reason: 'timeout' } })
    expect((await calendar.status()).ok).toBe(true)
    const cmds = readFileSync(log, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { cmd: string }).cmd)
    expect(cmds).toEqual(['create', 'status'])
    await calendar.dispose()

    const stubborn = mockChild({ ignoreTerm: true })
    const other = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => stubborn.child, timeouts: { status: 50 }, killAfterMs: 100 })
    expect(await other.status()).toMatchObject({ ok: false, error: { reason: 'timeout' } })
    await vi.waitFor(() => expect(stubborn.signals).toEqual(['SIGTERM', 'SIGKILL']))
    await other.dispose()
  })

  it('CA15 — resposta fora do formato: bad-response, sem o conteúdo da linha no log', async () => {
    const { calendar, logs } = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_GARBAGE: 'calendars' })) })
    expect(await calendar.calendars()).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'bad-response' } })
    expect((await calendar.status()).ok).toBe(true)
    await calendar.dispose()
    expect(logs.join('\n')).not.toContain('garbage')

    const mock = mockChild()
    const mocked = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child, log: (message) => void logs.push(message) })
    const answers = [
      // O helper de antes do `list` (contrato 132) é recusado: a versão é conferida no `status`.
      (id: string) => ok(id, { access: 'full', version: 'lap-calendar 1' }),
      (id: string) => ok(id, { access: 'full', version: 'lap-calendar 2', segredo: 'Título secreto' }),
      (id: string) => ok(id, { access: 'tudo', version: 'lap-calendar 2' }),
      (id: string) => JSON.stringify({ id, ok: false, v: 1, error: { code: 'denied', reason: 'eventkit', message: 'x' } }),
      () => 'Título secreto da reunião',
      (id: string) => ok(id, { access: 'full', version: 'lap-calendar 2', lixo: 'x'.repeat(MAC_CALENDAR_MAX_RESPONSE_LINE) }),
    ]
    for (const [index, answer] of answers.entries()) {
      const pending = mocked.status()
      await vi.waitFor(() => expect(mock.written).toHaveLength(index + 1))
      mock.reply(answer(idOf(mock.written[index])))
      expect(await pending).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'bad-response' } })
    }
    const fine = mocked.status()
    await vi.waitFor(() => expect(mock.written).toHaveLength(answers.length + 1))
    mock.reply(ok(idOf(mock.written[answers.length]), { access: 'full', version: 'lap-calendar 2' }))
    expect(await fine).toMatchObject({ ok: true })
    expect(logs.join('\n')).not.toContain('secreto')
    await mocked.dispose()
  })

  it('CA15 — erro com o que ficou gravado (EXDATE que falhou depois de salvar): os ids chegam ao chamador', async () => {
    const mock = mockChild()
    const calendar = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child })
    const saved = { calendarItemIdentifier: 'item-1', eventIdentifier: 'ev-1', externalIdentifier: null }
    const answers = [
      { answer: { code: 'unavailable', message: 'A série ficou gravada: um EXDATE falhou.', reason: 'eventkit', saved }, outcome: { ok: false, error: { code: 'unavailable', reason: 'eventkit', saved } } },
      // `saved` fora de unavailable/eventkit, ou com chave a mais: fora do formato.
      { answer: { code: 'invalid', message: 'x', reason: 'schema', saved }, outcome: { ok: false, error: { reason: 'bad-response' } } },
      { answer: { code: 'unavailable', message: 'x', reason: 'eventkit', saved: { ...saved, title: 'x' } }, outcome: { ok: false, error: { reason: 'bad-response' } } },
    ]
    for (const [index, { answer, outcome }] of answers.entries()) {
      const pending = calendar.create({ ...CREATE, recurrence: { freq: 'daily', count: 3 }, exdates: ['2026-11-21T18:00:00Z'] })
      await vi.waitFor(() => expect(mock.written).toHaveLength(index + 1))
      mock.reply(JSON.stringify({ error: answer, id: idOf(mock.written[index]), ok: false, v: 1 }))
      expect(await pending).toMatchObject(outcome)
    }
    await calendar.dispose()
  })

  it('CA15 — saiu com a requisição em voo: exited; sobe de novo com recuo e desiste depois de 5', async () => {
    expect([MAC_CALENDAR_MAX_RESTARTS, MAC_CALENDAR_RESTART_BASE_MS, MAC_CALENDAR_STABLE_MS]).toEqual([5, 1_000, 60_000])
    const spawns: number[] = []
    const started = Date.now()
    const calendar = createMacCalendar({
      platform: 'darwin',
      arch: 'arm64',
      systemVersion: '26.6.0',
      packaged: true,
      command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_EXIT_ON: 'create' })),
      spawn: (cmd) => {
        spawns.push(Date.now() - started)
        return spawn(cmd.file, [...cmd.args], { env: cmd.env, stdio: ['pipe', 'pipe', 'pipe'] })
      },
      baseDelayMs: 20,
    })
    expect(await calendar.create(CREATE)).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'exited' } })
    // A próxima chamada sobe o helper de novo (depois do recuo) e funciona.
    expect((await calendar.status()).ok).toBe(true)
    expect(spawns).toHaveLength(2)
    for (let index = 0; index < 5; index++) expect(await calendar.create(CREATE)).toMatchObject({ ok: false, error: { reason: 'exited' } })
    expect(spawns).toHaveLength(6)
    // Cada espera é pelo menos o dobro da anterior: 20, 40, 80, 160, 320 ms.
    spawns.slice(1).forEach((at, index) => expect(at - (spawns[index] ?? 0)).toBeGreaterThanOrEqual(20 * 2 ** index - 5))
    expect(await calendar.status()).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'gave-up' } })
    expect(await calendar.find(FIND)).toMatchObject({ ok: false, error: { reason: 'gave-up' } })
    expect(spawns).toHaveLength(6)
    await calendar.dispose()
  }, 15_000)

  it('CA15 — dispose fecha o stdin, manda SIGTERM e as pendentes voltam disposed', async () => {
    const mock = mockChild()
    const calendar = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child })
    const first = calendar.find(FIND)
    const second = calendar.status()
    await vi.waitFor(() => expect(mock.written).toHaveLength(1))
    await calendar.dispose()
    expect(await first).toMatchObject({ ok: false, error: { reason: 'disposed' } })
    expect(await second).toMatchObject({ ok: false, error: { reason: 'disposed' } })
    expect(mock.stdinEnded()).toBe(true)
    expect(mock.signals).toEqual(['SIGTERM'])
  })

  it('C132 — list pelo cliente: a janela, denied tipado e args fora do esquema não saem do cliente', async () => {
    const log = join(dir, 'list.jsonl')
    const events = [
      accountEvent({ eventIdentifier: 'dentro', calendarItemIdentifier: 'dentro', title: 'Dentro', start: '2026-11-22T12:00:00Z', end: '2026-11-22T13:00:00Z' }),
      accountEvent({ eventIdentifier: 'fora', calendarItemIdentifier: 'fora', title: 'Fora', start: '2026-11-23T12:00:00Z', end: '2026-11-23T13:00:00Z' }),
    ]
    const { calendar } = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: stateFile(state({ events })), FAKE_LAP_CALENDAR_LOG: log })) })
    const listed = await calendar.list(LIST)
    expect(listed.ok && listed.value.events.map((item) => item.title)).toEqual(['Dentro'])
    const invalidArgs = [{ ...LIST, extra: 1 }, { start: LIST.start }, { ...LIST, start: '2026-11-22' }]
    for (const args of invalidArgs) {
      expect(await calendar.list(args as unknown as typeof LIST)).toMatchObject({ ok: false, error: { code: 'invalid', reason: 'schema' } })
    }
    // Fim ≤ início e janela de mais de 35 dias: o mesmo `invalid`/`dates` do helper, sem sair do cliente.
    for (const args of [{ start: LIST.end, end: LIST.start }, { start: LIST.start, end: LIST.start }, { start: LIST.start, end: '2026-12-27T03:00:01Z' }]) {
      expect(await calendar.list(args)).toMatchObject({ ok: false, error: { code: 'invalid', reason: 'dates' } })
    }
    expect(readFileSync(log, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { cmd: string }).cmd)).toEqual(['list'])
    await calendar.dispose()

    const denied = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: stateFile(state({ access: 'denied', events })) })) })
    expect(await denied.calendar.list(LIST)).toMatchObject({ ok: false, error: { code: 'denied', reason: 'denied' } })
    await denied.calendar.dispose()
  })

  it('C132 — resposta do list com mais de 200 eventos ou evento fora do formato: bad-response', async () => {
    const event = { allDay: false, availability: 'busy', calendarId: 'c', calendarItemIdentifier: 'i', calendarTitle: 'T', end: '2026-11-22T13:00:00Z', eventIdentifier: null, externalIdentifier: null, occurrence: null, recurring: false, sourceTitle: 'S', start: '2026-11-22T12:00:00Z', timeZone: null, title: 'x', url: null }
    for (const result of [{ events: Array.from({ length: MAC_CALENDAR_MAX_LIST + 1 }, () => event) }, { events: [{ ...event, segredo: 1 }] }, { events: [], extra: 1 }]) {
      const mock = mockChild()
      const calendar = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child })
      const pending = calendar.list(LIST)
      await vi.waitFor(() => expect(mock.written).toHaveLength(1))
      mock.reply(ok(idOf(mock.written[0]), result))
      expect(await pending).toMatchObject({ ok: false, error: { code: 'unavailable', reason: 'bad-response' } })
      await calendar.dispose()
    }
    const mock = mockChild()
    const calendar = createMacCalendar({ platform: 'darwin', arch: 'arm64', systemVersion: '26.6.0', packaged: true, command: () => Promise.resolve(fakeCommand()), spawn: () => mock.child })
    const pending = calendar.list(LIST)
    await vi.waitFor(() => expect(mock.written).toHaveLength(1))
    mock.reply(ok(idOf(mock.written[0]), { events: Array.from({ length: MAC_CALENDAR_MAX_LIST }, () => event) }))
    const outcome = await pending
    expect(outcome.ok && outcome.value.events).toHaveLength(MAC_CALENDAR_MAX_LIST)
    await calendar.dispose()
  })

  it('CA19 — os três cenários do falso: acesso negado, UID que a conta já pôs, cópia que aparece no segundo refresh', async () => {
    const denied = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: stateFile(state({ access: 'denied' })) })) })
    expect(await denied.calendar.status()).toEqual({ ok: true, value: { access: 'denied', version: 'lap-calendar 2' } })
    expect(await denied.calendar.calendars()).toMatchObject({ ok: false, error: { code: 'denied', reason: 'denied' } })
    expect(await denied.calendar.create(CREATE)).toMatchObject({ ok: false, error: { code: 'denied', reason: 'denied' } })
    expect(await denied.calendar.requestAccess()).toEqual({ ok: true, value: { access: 'denied', granted: false } })
    await denied.calendar.dispose()

    const existing = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: stateFile(state({ events: [accountEvent()] })) })) })
    expect(await existing.calendar.find(FIND)).toMatchObject({ ok: true, value: { matches: [{ match: 'uid', calendarItemIdentifier: 'acc-item-1', externalIdentifier: FIND.uid }] } })
    await existing.calendar.dispose()

    const file = stateFile(state({ pending: [{ afterRefresh: 2, event: accountEvent() }] }))
    const later = client({ command: () => Promise.resolve(fakeCommand({ FAKE_LAP_CALENDAR_STATE: file })) })
    const created = await later.calendar.create({ ...CREATE, title: FIND.title, start: FIND.start, end: FIND.end })
    expect(created).toMatchObject({ ok: true, value: { event: { externalIdentifier: 'fake-ext-1' } } })
    const before = await later.calendar.find(FIND)
    expect(before.ok && before.value.matches.map((item) => item.match)).toEqual(['title-start'])
    await later.calendar.refresh()
    const once = await later.calendar.find(FIND)
    expect(once.ok && once.value.matches.map((item) => item.match)).toEqual(['title-start'])
    await later.calendar.refresh()
    const twice = await later.calendar.find(FIND)
    expect(twice.ok && twice.value.matches.map((item) => [item.calendarItemIdentifier, item.match])).toEqual([
      ['acc-item-1', 'uid'],
      ['fake-item-1', 'title-start'],
    ])
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { events: { origin: string }[]; pending: unknown[] }
    expect(saved.events.map((event) => event.origin)).toEqual(['app', 'account'])
    expect(saved.pending).toEqual([])
    await later.calendar.dispose()
  })
})

// --- Binário, plists e pacote ------------------------------------------------------------------------------------

describe('onde está o lap-calendar', () => {
  const base = { platform: 'darwin' as NodeJS.Platform, arch: 'arm64', systemVersion: '26.6.0', resourcesPath: '/nao/existe/Resources', appPath: ROOT }

  it('fora do Apple Silicon, macOS antigo ou pacote sem o binário: null, com o motivo no log', async () => {
    const logs: string[] = []
    const log = (message: string): void => void logs.push(message)
    expect(await locateMacCalendar({ ...base, arch: 'x64', packaged: true, log })).toBeNull()
    expect(await locateMacCalendar({ ...base, platform: 'linux', packaged: true, log })).toBeNull()
    expect(await locateMacCalendar({ ...base, systemVersion: '14.2', packaged: true, log })).toBeNull()
    expect(await locateMacCalendar({ ...base, packaged: true, log })).toBeNull()
    expect(logs).toHaveLength(4)
    expect(logs.every((message) => message.startsWith('[mac-calendar] sem o Calendário do Mac:'))).toBe(true)
  })

  it('no pacote, Contents/Resources/bin/lap-calendar', async () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'lap-calendar-pacote-'))
    try {
      mkdirSync(join(resourcesPath, 'bin'))
      writeFileSync(join(resourcesPath, 'bin', 'lap-calendar'), '')
      expect(await locateMacCalendar({ ...base, resourcesPath, packaged: true })).toBe(join(resourcesPath, 'bin', 'lap-calendar'))
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
  })

  it('no dev, sem as ferramentas do Xcode, não chama o swiftc; com elas, compila com MAC_CALENDAR_SWIFTC_ARGS', async () => {
    const appPath = mkdtempSync(join(tmpdir(), 'lap-calendar-dev-'))
    try {
      mkdirSync(join(appPath, 'native', 'calendar'), { recursive: true })
      writeFileSync(join(appPath, 'native', 'calendar', 'main.swift'), '// fonte\n')
      writeFileSync(join(appPath, 'native', 'calendar', 'Info.plist'), '<plist/>\n')
      const calls: { argv: string[]; cwd: string }[] = []
      const logs: string[] = []
      let tools = false
      const options = {
        ...base,
        appPath,
        packaged: false,
        run: (file: string, args: readonly string[], _timeout: number, cwd: string) => {
          calls.push({ argv: [file, ...args], cwd })
          if (file === '/usr/bin/swiftc') writeFileSync(join(appPath, 'out', 'bin', 'lap-calendar'), '')
          return Promise.resolve(file === '/usr/bin/xcode-select' ? tools : true)
        },
        log: (message: string) => void logs.push(message),
      }
      expect(await locateMacCalendar(options)).toBeNull()
      expect(calls.map((entry) => entry.argv)).toEqual([['/usr/bin/xcode-select', '-p']])
      expect(logs.at(-1)).toContain('swiftc ausente')
      tools = true
      const out = join(appPath, 'out', 'bin', 'lap-calendar')
      expect(await locateMacCalendar(options)).toBe(out)
      expect(calls.at(-1)).toEqual({ argv: ['/usr/bin/swiftc', ...MAC_CALENDAR_SWIFTC_ARGS, 'native/calendar/main.swift', '-o', out], cwd: appPath })
      // Binário mais novo que a fonte e o Info.plist: não compila de novo; o Info.plist mudou, compila.
      calls.length = 0
      expect(await locateMacCalendar(options)).toBe(out)
      expect(calls).toEqual([])
      const future = new Date(statSync(out).mtimeMs + 10_000)
      utimesSync(join(appPath, 'native', 'calendar', 'Info.plist'), future, future)
      expect(await locateMacCalendar(options)).toBe(out)
      expect(calls.at(-1)?.argv[0]).toBe('/usr/bin/swiftc')
    } finally {
      rmSync(appPath, { recursive: true, force: true })
    }
  })

  it('CA18 — o pack.sh compila com exatamente os mesmos argumentos, assina e confere o helper', () => {
    const pack = readFileSync(join(ROOT, 'scripts', 'pack.sh'), 'utf8')
    expect(pack).toContain(`swiftc ${MAC_CALENDAR_SWIFTC_ARGS.join(' ')} ${MAC_CALENDAR_SOURCE} -o "$CAL"`)
    expect(MAC_CALENDAR_SWIFTC_ARGS.join(' ')).toBe('-O -target arm64-apple-macos14.4 -warnings-as-errors -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/calendar/Info.plist')
    expect(pack).toContain('codesign --force --sign - --entitlements build/entitlements.plist "$CAL"')
    expect(pack).toContain('codesign --verify --strict "$CAL"')
    expect(pack).toContain('echo "lap-calendar ok"')
    // Compila antes da assinatura do app e confere depois dela.
    expect(pack.indexOf(MAC_CALENDAR_SOURCE)).toBeLessThan(pack.indexOf('codesign --force --deep'))
    expect(pack.indexOf('codesign --verify --strict "$CAL"')).toBeGreaterThan(pack.indexOf('codesign --force --deep'))
    // O bloco do lap-mic-watch continua igual.
    expect(pack).toContain('swiftc -O -target arm64-apple-macos14.4 native/mic-watch/main.swift -o "$MIC_WATCH"')
  })

  it('CA16 e CA17 — Info.plist do helper (6 chaves) e as duas chaves NSCalendars no do app', () => {
    const helper = readFileSync(join(ROOT, 'native', 'calendar', 'Info.plist'), 'utf8')
    const keys = [...helper.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])
    expect(keys).toEqual(['CFBundleIdentifier', 'CFBundleName', 'CFBundleVersion', 'CFBundleShortVersionString', 'NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription'])
    expect(helper).toContain('<string>com.lap.reunioes.calendar</string>')
    expect(helper).toContain('<string>lap-calendar</string>')
    expect(helper.split(`<string>${PHRASE}</string>`)).toHaveLength(3)
    const app = readFileSync(join(ROOT, 'build', 'extendInfo.plist'), 'utf8')
    expect(app).toContain(`<key>NSCalendarsFullAccessUsageDescription</key>\n  <string>${PHRASE}</string>`)
    expect(app).toContain(`<key>NSCalendarsUsageDescription</key>\n  <string>${PHRASE}</string>`)
    expect(app).toContain('<key>NSMicrophoneUsageDescription</key>')
  })

  it('invariantes: só request-access pede acesso, nada de agenda, lembrete, alarme ou rede', () => {
    const swift = readFileSync(join(ROOT, 'native', 'calendar', 'main.swift'), 'utf8')
    expect(swift.match(/requestFullAccessToEvents/g)).toHaveLength(1)
    expect(swift).not.toContain('requestWriteOnlyAccessToEvents')
    expect(swift).not.toMatch(/removeCalendar|saveCalendar|\.reminder|addAlarm|EKAlarm/)
    expect(swift).not.toMatch(/import Network|URLSession|socket\(/)
    // Dia inteiro e UNTIL de data contam dia de calendário, nunca ±86.400 s (o dia da troca de horário tem 23 ou 25 h).
    expect(swift).not.toMatch(/addingTimeInterval\(-day\)\s*$|addingTimeInterval\(day - 1\)/m)
    expect(swift).toContain('func allDayRange(start: When, end: When)')
    expect([...swift.matchAll(/^import (\w+)$/gm)].map((match) => match[1])).toEqual(['EventKit', 'Foundation'])
    const fake = readFileSync(FAKE, 'utf8')
    expect(fake).not.toMatch(/node:net|node:http|node:https|node:dgram|\bfetch\(/)
    const protocol = readFileSync(join(ROOT, 'src', 'main', 'mac-calendar', 'protocol.ts'), 'utf8')
    expect(protocol).not.toContain('node:child_process')
    expect(existsSync(join(ROOT, 'native', 'mic-watch', 'main.swift'))).toBe(true)
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */
