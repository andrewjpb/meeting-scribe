// `lap-calendar` falso (contrato 60) para o teste do cliente e, depois, o smoke: fala o mesmo protocolo do binário de
// verdade (native/calendar/main.swift), com os mesmos limites, as mesmas validações e os mesmos `code`/`reason`, sem
// tocar em agenda nenhuma nem em rede. Uma requisição por linha no stdin, uma resposta por linha no stdout (chaves em
// ordem alfabética), uma por vez; sai quando o stdin fecha.
//
// - `FAKE_LAP_CALENDAR_STATE=<arquivo.json>`: o estado `{ access, onRequest, calendars, events, pending }`, relido a
//   cada requisição e regravado (atômico) depois de `request-access`, `create`, `update`, `remove` e `refresh`. Sem a
//   variável: em memória, `access: "full"`, as agendas `Trabalho` (gravável, aceita provisório, padrão) e `Feriados`
//   (só leitura, sem provisório), sem eventos.
//   - `access`: `full`, `denied`, `restricted`, `notDetermined` ou `writeOnly`; `onRequest` é o que o
//     `request-access` devolve a partir de `notDetermined` (`full` ou `denied`, padrão `denied`).
//   - Evento que a conta pôs na agenda: um item de `events` com `externalIdentifier` = UID e `origin: "account"`.
//   - Cópia da conta que aparece depois (R5c): `pending: [{ afterRefresh: n, event }]` entra em `events` no n-ésimo
//     `refresh` (contado em `refreshes`).
//   - Eventos criados aqui: `fake-ev-<n>`, `fake-item-<n>`, `fake-ext-<n>` (diferente do UID, como no EventKit) e
//     `origin: "app"`.
// - `FAKE_LAP_CALENDAR_LOG=<arquivo.jsonl>`: cada requisição recebida, uma por linha.
// - Cenário (contrato 62): `FAKE_LAP_CALENDAR_DETACHED_IDS=1` dá a cada ocorrência destacada (`detached`) um
//   `eventIdentifier` próprio (`<o da série>-<ocorrência>`), como o EventKit; os ids da série continuam valendo.
// - Falhas: `FAKE_LAP_CALENDAR_HANG=<cmd>` (não responde mais), `FAKE_LAP_CALENDAR_EXIT_ON=<cmd>` (sai com 1 ao
//   receber), `FAKE_LAP_CALENDAR_GARBAGE=<cmd>` (responde uma linha fora do formato).
//
// O UID casa só por igualdade exata com o `externalIdentifier` (o D0 não respondeu se o Gmail e o Exchange usam o
// UID como external id: caso 2b do contrato); o título + início exato é o outro caminho.
//
// Dia inteiro: a conta de `startDate`/`endDate` (`end` − 1 dia de calendário, meia-noite local) é a mesma do binário
// (`allDayRange`), no fuso do processo (`TZ`), e recusa com `invalid`/`dates` no mesmo ponto; as janelas do `find` e as
// ocorrências do falso continuam contadas em UTC. A série se expande só por
// `freq`, `interval`, `count` e `until`; `byDay` e afins são validados e guardados, mas não mudam as ocorrências.
//
// Uso: node fake-lap-calendar.mjs | node fake-lap-calendar.mjs --version
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { URL } from 'node:url'

if (process.argv.includes('--version')) {
  process.stdout.write('lap-calendar 1 (falso)\n')
  process.exit(0)
}
if (process.argv.length > 2) {
  process.stderr.write('uso: lap-calendar [--version]\n')
  process.exit(64)
}

const VERSION = 'lap-calendar 1'
const MAX_REQUEST_LINE = 64 * 1024
const MAX_TITLE = 1024
const MAX_LOCATION = 1024
const MAX_NOTES = 4000
const MAX_URL = 2048
const MAX_EXDATES = 500
const MAX_MATCHES = 50
const MAX_RECURRENCE_LIST = 366
const DAY_MS = 86_400_000
const COMMANDS = new Set(['status', 'request-access', 'calendars', 'refresh', 'find', 'create', 'update', 'remove'])
const WEEKDAYS = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])

const STATE_FILE = process.env['FAKE_LAP_CALENDAR_STATE']
const LOG_FILE = process.env['FAKE_LAP_CALENDAR_LOG']
const HANG = process.env['FAKE_LAP_CALENDAR_HANG']
const EXIT_ON = process.env['FAKE_LAP_CALENDAR_EXIT_ON']
const GARBAGE = process.env['FAKE_LAP_CALENDAR_GARBAGE']
const DETACHED_IDS = process.env['FAKE_LAP_CALENDAR_DETACHED_IDS'] === '1'

// --- Estado ------------------------------------------------------------------------------------------------------

const defaultState = () => ({
  access: 'full',
  onRequest: 'denied',
  calendars: [
    { id: 'cal-trabalho', title: 'Trabalho', sourceId: 'src-icloud', sourceTitle: 'iCloud', sourceType: 'caldav', writable: true, availabilities: ['busy', 'tentative', 'free'], color: '#1B6FD8', isDefault: true },
    { id: 'cal-feriados', title: 'Feriados', sourceId: 'src-assinadas', sourceTitle: 'Assinadas', sourceType: 'subscribed', writable: false, availabilities: ['busy', 'free'], color: null, isDefault: false },
  ],
  events: [],
  pending: [],
  refreshes: 0,
  nextId: 1,
})

let memory = defaultState()

function loadState() {
  if (!STATE_FILE) return memory
  const raw = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
  const base = defaultState()
  return { ...base, ...raw, events: (raw.events ?? []).map(normalizeEvent), pending: raw.pending ?? [], refreshes: raw.refreshes ?? 0, nextId: raw.nextId ?? 1 }
}

function saveState(state) {
  if (!STATE_FILE) {
    memory = state
    return
  }
  const tmp = `${STATE_FILE}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(tmp, STATE_FILE)
}

/** Evento do estado com os campos que faltarem (o teste escreve só o que importa). */
function normalizeEvent(event) {
  return {
    eventIdentifier: null,
    externalIdentifier: null,
    calendarId: 'cal-trabalho',
    allDay: false,
    timeZone: null,
    location: null,
    url: null,
    notes: null,
    availability: 'busy',
    recurrence: null,
    removed: [],
    cutFrom: null,
    detached: {},
    origin: 'account',
    ...event,
    calendarItemIdentifier: event.calendarItemIdentifier ?? event.eventIdentifier ?? `item-${event.title ?? 'sem-titulo'}`,
  }
}

// --- Erros e leitura ---------------------------------------------------------------------------------------------

class Failure extends Error {
  constructor(code, reason, message) {
    super(message)
    this.code = code
    this.reason = reason
  }
}

const invalid = (reason, message) => new Failure('invalid', reason, message)
const schema = (message) => invalid('schema', message)
const recurrenceError = (message) => invalid('recurrence', message)

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Um objeto com as chaves conferidas, como o `Fields` do main.swift. */
function fields(value, allowed, required = [], fail = schema) {
  if (!isObject(value)) throw fail('Era esperado um objeto.')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw fail(`Chave desconhecida: ${key}.`)
  for (const key of required) if (!(key in value)) throw fail(`Falta a chave ${key}.`)
  const has = (key) => key in value
  const string = (key, max, min = 0) => {
    if (!has(key)) return undefined
    const text = value[key]
    if (typeof text !== 'string') throw fail(`${key} não é texto.`)
    if (text.length < min || text.length > max) throw fail(`${key} fora do tamanho.`)
    return text
  }
  const requiredString = (key, max, min = 0) => {
    const text = string(key, max, min)
    if (text === undefined) throw fail(`Falta a chave ${key}.`)
    return text
  }
  const bool = (key) => {
    if (!has(key)) return undefined
    if (typeof value[key] !== 'boolean') throw fail(`${key} não é booleano.`)
    return value[key]
  }
  const oneOf = (key, options) => {
    const text = string(key, 64)
    if (text !== undefined && !options.includes(text)) throw fail(`${key} com valor desconhecido.`)
    return text
  }
  const array = (key, max) => {
    if (!has(key)) return undefined
    if (!Array.isArray(value[key])) throw fail(`${key} não é lista.`)
    if (value[key].length > max) throw fail(`${key} com itens demais.`)
    return value[key]
  }
  return { value, has, string, requiredString, bool, oneOf, array, isNull: (key) => value[key] === null }
}

function integer(raw, min, max, fail, exclude) {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max || raw === exclude) throw fail('Número fora do limite.')
  return raw
}

const validId = (text) => typeof text === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(text)

// --- Datas -------------------------------------------------------------------------------------------------------

const pad = (value, size = 2) => String(value).padStart(size, '0')

/** `{ day: true, ms, text }` para `YYYY-MM-DD`; `{ day: false, ms, text }` para o instante (a fração é descartada). */
function parseWhen(text) {
  if (typeof text !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z)?$/.exec(text)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  if (match[4] === undefined) {
    const ms = Date.UTC(year, month - 1, day)
    return { day: true, ms, text: `${pad(year, 4)}-${pad(month)}-${pad(day)}` }
  }
  const [hour, minute, second] = [Number(match[4]), Number(match[5]), Number(match[6])]
  if (hour > 23 || minute > 59 || second > 59) return null
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  return { day: false, ms, text: formatMs(ms, false) }
}

function formatMs(ms, day) {
  const date = new Date(ms)
  const ymd = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  return day ? ymd : `${ymd}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
}

function when(f, key, allDay) {
  const text = f.string(key, 64)
  if (text === undefined) return undefined
  const value = parseWhen(text)
  if (!value || value.day !== allDay) throw schema(`${key} fora do formato.`)
  return value
}

function requiredWhen(f, key, allDay) {
  const value = when(f, key, allDay)
  if (!value) throw schema(`Falta a chave ${key}.`)
  return value
}

/**
 * O `allDayRange` do main.swift: meia-noite local do `start` e do último dia (`end` − 1 dia de calendário, nunca
 * 86.400 ms: o dia da troca de horário tem 23 ou 25 h). Recusa quando o último dia vem antes do primeiro.
 */
function allDayRange(start, end) {
  const [sy, sm, sd] = start.text.split('-').map(Number)
  const [ey, em, ed] = end.text.split('-').map(Number)
  const first = new Date(sy, sm - 1, sd).getTime()
  const last = new Date(ey, em - 1, ed - 1).getTime()
  if (!(last >= first)) throw invalid('dates', 'O fim tem de vir depois do início.')
  return { start: first, end: last }
}

function validTimeZone(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

function httpUrl(text) {
  try {
    const url = new URL(text)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return text
  } catch {
    // cai no erro abaixo
  }
  throw schema('url só http ou https.')
}

// --- Recorrência -------------------------------------------------------------------------------------------------

function recurrenceRule(raw) {
  const rule = fields(raw, ['freq', 'interval', 'count', 'until', 'byDay', 'byMonthDay', 'byMonth', 'bySetPos', 'weekStart'], ['freq'], recurrenceError)
  const freq = rule.oneOf('freq', ['daily', 'weekly', 'monthly', 'yearly'])
  const out = { freq, interval: rule.has('interval') ? integer(rule.value.interval, 1, 999, recurrenceError) : 1 }
  if (rule.has('count') && rule.has('until')) throw recurrenceError('count e until juntos.')
  if (rule.has('count')) out.count = integer(rule.value.count, 1, 999, recurrenceError)
  if (rule.has('until')) {
    const until = parseWhen(rule.string('until', 64))
    if (!until) throw recurrenceError('until fora do formato.')
    out.until = until.text
  }
  const byDay = rule.array('byDay', MAX_RECURRENCE_LIST)
  if (byDay) {
    out.byDay = byDay.map((item) => {
      const entry = fields(item, ['day', 'pos'], ['day'], recurrenceError)
      const day = entry.oneOf('day', [...WEEKDAYS])
      if (!entry.has('pos')) return { day }
      if (freq === 'daily' || freq === 'weekly') throw recurrenceError('byDay com pos só na repetição mensal ou anual.')
      return { day, pos: integer(entry.value.pos, -53, 53, recurrenceError, 0) }
    })
  }
  const list = (key, max, min, top, exclude) => {
    const items = rule.array(key, max)
    if (items) out[key] = items.map((item) => integer(item, min, top, recurrenceError, exclude))
  }
  list('byMonthDay', MAX_RECURRENCE_LIST, -31, 31, 0)
  list('byMonth', 12, 1, 12)
  list('bySetPos', MAX_RECURRENCE_LIST, -366, 366, 0)
  if (out.bySetPos && freq !== 'monthly' && freq !== 'yearly') throw recurrenceError('bySetPos só na repetição mensal ou anual.')
  const weekStart = rule.oneOf('weekStart', [...WEEKDAYS])
  if (weekStart) out.weekStart = weekStart
  return out
}

function addPeriod(ms, freq, steps) {
  const date = new Date(ms)
  if (freq === 'daily') return ms + steps * DAY_MS
  if (freq === 'weekly') return ms + steps * 7 * DAY_MS
  if (freq === 'monthly') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + steps, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds())
  return Date.UTC(date.getUTCFullYear() + steps, date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds())
}

/** As ocorrências de um evento: `{ occurrence, event }` (sem série, uma só, com `occurrence: null`). */
function occurrences(event) {
  if (!event.recurrence) return [{ occurrence: null, event }]
  const start = parseWhen(event.start)
  const duration = parseWhen(event.end).ms - start.ms
  const { freq, interval, count, until } = event.recurrence
  const untilMs = until ? parseWhen(until).ms + (parseWhen(until).day ? DAY_MS - 1 : 0) : Infinity
  const cut = event.cutFrom ? parseWhen(event.cutFrom).ms : Infinity
  const out = []
  for (let index = 0; index < (count ?? 1000); index++) {
    const ms = addPeriod(start.ms, freq, index * interval)
    if (ms > untilMs || ms >= cut) break
    const occurrence = formatMs(ms, event.allDay)
    if (event.removed.includes(occurrence)) continue
    const detached = event.detached[occurrence]
    const own = detached && DETACHED_IDS && event.eventIdentifier ? { eventIdentifier: `${event.eventIdentifier}-${occurrence.replace(/[^0-9]/g, '')}` } : {}
    out.push({ occurrence, event: detached ? { ...event, ...detached, ...own } : { ...event, start: occurrence, end: formatMs(ms + duration, event.allDay) } })
  }
  return out
}

// --- Saída -------------------------------------------------------------------------------------------------------

function eventOut(state, occ) {
  const event = occ.event
  const calendar = state.calendars.find((item) => item.id === event.calendarId)
  return {
    allDay: event.allDay,
    availability: event.availability,
    calendarId: event.calendarId,
    calendarItemIdentifier: event.calendarItemIdentifier,
    calendarTitle: calendar?.title ?? '',
    end: event.end,
    eventIdentifier: event.eventIdentifier,
    externalIdentifier: event.externalIdentifier,
    occurrence: occ.occurrence,
    recurring: event.recurrence !== null,
    sourceTitle: calendar?.sourceTitle ?? '',
    start: event.start,
    timeZone: event.allDay ? null : event.timeZone,
    title: event.title,
    url: event.url,
  }
}

/** JSON com as chaves em ordem alfabética em todos os níveis, como o `.sortedKeys` do helper. */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  )
}

const write = (response) => process.stdout.write(`${JSON.stringify(sorted(response))}\n`)
// O falso nunca falha depois de salvar, então nunca manda o `saved` do erro (só o binário, quando um EXDATE falha).
const failureLine = (id, failure) => ({ v: 1, id, ok: false, error: { code: failure.code, reason: failure.reason, message: failure.message } })

// --- Comandos ----------------------------------------------------------------------------------------------------

function requireFullAccess(state) {
  if (state.access === 'full') return
  if (state.access === 'restricted') throw new Failure('restricted', 'restricted', 'O acesso ao Calendário está restrito neste Mac.')
  if (state.access === 'notDetermined') throw new Failure('denied', 'not-determined', 'O acesso ao Calendário ainda não foi pedido.')
  if (state.access === 'writeOnly') throw new Failure('denied', 'write-only', 'O acesso ao Calendário é só para adicionar eventos.')
  throw new Failure('denied', 'denied', 'O acesso ao Calendário foi negado.')
}

function readIds(raw) {
  const ids = fields(raw, ['eventIdentifier', 'calendarItemIdentifier', 'externalIdentifier'])
  const out = { eventIdentifier: ids.string('eventIdentifier', 1024, 1), calendarItemIdentifier: ids.string('calendarItemIdentifier', 1024, 1), externalIdentifier: ids.string('externalIdentifier', 1024, 1) }
  if (!out.eventIdentifier && !out.calendarItemIdentifier && !out.externalIdentifier) throw schema('ids sem nenhum id.')
  return out
}

/** Cada caminho do N3 que achou alguma coisa, na ordem. */
function lookups(state, ids) {
  const found = []
  const byEvent = ids.eventIdentifier && state.events.filter((event) => event.eventIdentifier === ids.eventIdentifier)
  if (byEvent?.length) found.push({ match: 'eventIdentifier', events: byEvent.slice(0, 1) })
  const byItem = ids.calendarItemIdentifier && state.events.filter((event) => event.calendarItemIdentifier === ids.calendarItemIdentifier)
  if (byItem?.length) found.push({ match: 'calendarItemIdentifier', events: byItem.slice(0, 1) })
  const byExternal = ids.externalIdentifier && state.events.filter((event) => event.externalIdentifier === ids.externalIdentifier)
  if (byExternal?.length) found.push({ match: 'externalIdentifier', events: byExternal })
  return found
}

function locate(state, ids) {
  const first = lookups(state, ids)[0]
  if (!first) throw new Failure('not-found', 'event', 'Não achei o evento na agenda.')
  if (first.events.length > 1) throw invalid('ambiguous', 'Mais de um evento com esse id.')
  return first.events[0]
}

/** A ocorrência de `event` cuja data original é `recurrenceId` (texto normalizado). */
function occurrenceOf(event, recurrenceId) {
  return occurrences(event).find((occ) => occ.occurrence === recurrenceId) ?? null
}

function find(state, args) {
  const f = fields(args, ['uid', 'title', 'start', 'end', 'allDay', 'ids', 'recurrenceId'], ['uid', 'title', 'start', 'end', 'allDay'])
  const allDay = f.bool('allDay')
  const uid = f.requiredString('uid', 1024, 1)
  const title = f.requiredString('title', MAX_TITLE, 1)
  const start = requiredWhen(f, 'start', allDay)
  const end = requiredWhen(f, 'end', allDay)
  const ids = f.has('ids') ? readIds(args.ids) : null
  const recurrenceId = when(f, 'recurrenceId', allDay)
  requireFullAccess(state)

  const matches = []
  const seen = new Set()
  const add = (occ, match) => {
    if (matches.length >= MAX_MATCHES) return
    const key = `${occ.event.calendarItemIdentifier}|${occ.occurrence ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    matches.push({ ...eventOut(state, occ), match })
  }
  const resolved = (event) => {
    if (!recurrenceId) return { occurrence: event.recurrence ? (occurrences(event)[0]?.occurrence ?? null) : null, event: event.recurrence ? (occurrences(event)[0]?.event ?? event) : event }
    return occurrenceOf(event, recurrenceId.text)
  }
  if (ids) {
    for (const { match, events } of lookups(state, ids)) {
      const found = events.map(resolved).filter(Boolean)
      if (!found.length) continue
      for (const occ of found) add(occ, match)
      break
    }
  }
  const from = start.ms - DAY_MS
  const to = end.ms + DAY_MS
  const window = state.events
    .flatMap(occurrences)
    .filter((occ) => parseWhen(occ.event.start).ms < to && parseWhen(occ.event.end).ms > from)
    .filter((occ) => !recurrenceId || occ.occurrence === recurrenceId.text)
  const byUid = window.filter((occ) => occ.event.externalIdentifier === uid)
  for (const occ of byUid) add(occ, 'uid')
  const windowItems = new Set(byUid.map((occ) => occ.event.calendarItemIdentifier))
  for (const event of state.events) {
    if (event.externalIdentifier !== uid || windowItems.has(event.calendarItemIdentifier)) continue
    const occ = resolved(event)
    if (occ) add(occ, 'uid')
  }
  for (const occ of window) {
    if (occ.event.title.trim() === title.trim() && occ.event.start === start.text && occ.event.allDay === allDay) add(occ, 'title-start')
  }
  return { matches }
}

function availabilityFor(calendar, requested) {
  if (requested === 'tentative' && calendar.availabilities.includes('tentative')) return { availability: 'tentative', fallback: false }
  if (calendar.availabilities.includes('busy')) return { availability: 'busy', fallback: requested !== 'busy' }
  return { availability: 'none', fallback: true }
}

function textFields(f) {
  const out = {}
  const title = f.string('title', MAX_TITLE, 1)
  if (title !== undefined) out.title = title
  const location = f.string('location', MAX_LOCATION)
  if (location !== undefined) out.location = location
  const notes = f.string('notes', MAX_NOTES)
  if (notes !== undefined) out.notes = notes
  const url = f.string('url', MAX_URL, 1)
  if (url !== undefined) out.url = httpUrl(url)
  return out
}

function exdateList(f, allDay) {
  const list = f.array('exdates', MAX_EXDATES)
  if (!list) return undefined
  return list.map((raw) => {
    const value = parseWhen(raw)
    if (!value || value.day !== allDay) throw schema('exdates fora do formato.')
    return value.text
  })
}

function removeExdates(event, exdates) {
  const removed = []
  const missing = []
  for (const exdate of exdates) {
    if (occurrences(event).some((occ) => occ.occurrence === exdate)) {
      event.removed.push(exdate)
      removed.push(exdate)
    } else {
      missing.push(exdate)
    }
  }
  return { removed, missing }
}

function newIds(state) {
  const n = state.nextId++
  return { eventIdentifier: `fake-ev-${n}`, calendarItemIdentifier: `fake-item-${n}`, externalIdentifier: `fake-ext-${n}` }
}

const CREATE_KEYS = ['calendarId', 'title', 'start', 'end', 'allDay', 'timeZone', 'location', 'url', 'notes', 'availability', 'recurrence', 'exdates']

function create(state, args) {
  const f = fields(args, CREATE_KEYS, ['calendarId', 'title', 'start', 'end', 'allDay', 'timeZone', 'availability'])
  const calendarId = f.requiredString('calendarId', 1024, 1)
  const allDay = f.bool('allDay')
  const start = requiredWhen(f, 'start', allDay)
  const end = requiredWhen(f, 'end', allDay)
  const zone = f.isNull('timeZone') ? null : f.requiredString('timeZone', 64)
  if (allDay && zone !== null) throw schema('Dia inteiro vai sem fuso.')
  const requested = f.oneOf('availability', ['busy', 'tentative'])
  const recurrence = f.has('recurrence') ? recurrenceRule(args.recurrence) : null
  const exdates = exdateList(f, allDay)
  if (exdates && !recurrence) throw recurrenceError('exdates sem recurrence.')
  if (zone !== null && !validTimeZone(zone)) throw invalid('timezone', 'Fuso desconhecido.')
  if (end.ms <= start.ms) throw invalid('dates', 'O fim tem de vir depois do início.')
  if (allDay) allDayRange(start, end)
  const text = textFields(f)
  if (text.title === undefined) throw schema('Falta a chave title.')
  requireFullAccess(state)

  const calendar = state.calendars.find((item) => item.id === calendarId)
  if (!calendar) throw new Failure('not-found', 'calendar', 'Não achei essa agenda.')
  if (!calendar.writable) throw invalid('read-only-calendar', 'Esta agenda é só de leitura.')
  const { availability, fallback } = availabilityFor(calendar, requested)
  const event = normalizeEvent({ ...newIds(state), ...text, calendarId, start: start.text, end: end.text, allDay, timeZone: allDay ? null : zone, availability, recurrence, origin: 'app' })
  state.events.push(event)
  const { removed, missing } = exdates ? removeExdates(event, exdates) : { removed: [], missing: [] }
  return { event: eventOut(state, resolvedFirst(event)), availabilityFallback: fallback, exdatesRemoved: removed, exdatesMissing: missing }
}

const resolvedFirst = (event) => (event.recurrence ? (occurrences(event)[0] ?? { occurrence: null, event }) : { occurrence: null, event })

const UPDATE_FIELD_KEYS = ['title', 'start', 'end', 'allDay', 'timeZone', 'location', 'url', 'notes', 'availability', 'recurrence', 'exdates']

function update(state, args) {
  const a = fields(args, ['ids', 'recurrenceId', 'span', 'fields'], ['ids', 'span', 'fields'])
  const ids = readIds(args.ids)
  const span = a.oneOf('span', ['this', 'future'])
  const f = fields(args.fields, UPDATE_FIELD_KEYS)
  if (!Object.keys(args.fields).length) throw schema('fields vazio.')
  const allDayField = f.bool('allDay')
  const startRaw = f.string('start', 64)
  const endRaw = f.string('end', 64)
  const ridRaw = a.string('recurrenceId', 64)
  for (const text of [startRaw, endRaw, ridRaw]) if (text !== undefined && !parseWhen(text)) throw schema('Data fora do formato.')
  // Trocar `allDay` sem as datas novas não tem leitura única (o 62 sempre manda as duas): recusado, como no binário.
  if (allDayField !== undefined && (startRaw === undefined || endRaw === undefined)) throw schema('allDay pede start e end.')
  const zone = f.has('timeZone') ? (f.isNull('timeZone') ? null : f.requiredString('timeZone', 64)) : undefined
  const requested = f.oneOf('availability', ['busy', 'tentative'])
  const recurrence = f.has('recurrence') ? (f.isNull('recurrence') ? null : recurrenceRule(args.fields.recurrence)) : undefined
  if (ridRaw !== undefined && recurrence !== undefined) throw recurrenceError('recurrence não vale para uma ocorrência.')
  const text = textFields(f)
  if (zone && !validTimeZone(zone)) throw invalid('timezone', 'Fuso desconhecido.')
  requireFullAccess(state)

  const item = locate(state, ids)
  const allDay = allDayField ?? item.allDay
  const exdates = exdateList(f, allDay)
  if (exdates && ridRaw !== undefined) throw recurrenceError('exdates não vale para uma ocorrência.')
  const willRecur = recurrence !== undefined ? recurrence !== null : item.recurrence !== null
  if (exdates && !willRecur) throw recurrenceError('exdates sem recurrence.')
  if (allDay && zone) throw schema('Dia inteiro vai sem fuso.')

  let occ = null
  if (ridRaw !== undefined) {
    const recurrenceId = parseWhen(ridRaw)
    if (recurrenceId.day !== item.allDay) throw schema('recurrenceId fora do formato.')
    occ = occurrenceOf(item, recurrenceId.text)
    if (!occ) throw new Failure('not-found', 'occurrence', 'Não achei essa ocorrência na agenda.')
  } else if (span === 'this' && item.recurrence) {
    throw schema('span this numa série pede recurrenceId.')
  }
  const calendar = state.calendars.find((entry) => entry.id === item.calendarId)
  if (!calendar?.writable) throw invalid('not-mutable', 'O Calendário não deixa mudar este evento.')

  const base = occ ? occ.event : item
  const parse = (raw, fallback) => {
    if (raw === undefined) return parseWhen(fallback)
    const value = parseWhen(raw)
    if (value.day !== allDay) throw schema('Data fora do formato.')
    return value
  }
  const start = parse(startRaw, base.start)
  const end = parse(endRaw, base.end)
  if (start.day !== allDay || end.day !== allDay) throw schema('Data fora do formato.')
  if (end.ms <= start.ms) throw invalid('dates', 'O fim tem de vir depois do início.')
  if (allDay) allDayRange(start, end)
  const changes = { ...text, start: start.text, end: end.text, allDay, timeZone: allDay ? null : zone === undefined ? base.timeZone : zone }
  let fallback = false
  if (requested) {
    const chosen = availabilityFor(calendar, requested)
    changes.availability = chosen.availability
    fallback = chosen.fallback
  }

  let target = item
  if (occ && span === 'this') {
    // Só esta ocorrência muda (`.thisEvent`): vira uma exceção da série.
    item.detached[occ.occurrence] = { ...(item.detached[occ.occurrence] ?? {}), ...changes }
    return { event: eventOut(state, occurrenceOf(item, occ.occurrence)), availabilityFallback: fallback, exdatesRemoved: [], exdatesMissing: [] }
  }
  if (occ && span === 'future' && occ.occurrence !== resolvedFirst(item).occurrence) {
    // Desta em diante (`.futureEvents`): a série de antes termina aqui e a nova começa nesta ocorrência, com ids novos.
    item.cutFrom = occ.occurrence
    target = normalizeEvent({ ...item, ...newIds(state), ...changes, removed: [], cutFrom: null, detached: {}, origin: item.origin })
    state.events.push(target)
  } else {
    Object.assign(target, changes)
    if (recurrence !== undefined) target.recurrence = recurrence
  }
  const { removed, missing } = exdates ? removeExdates(target, exdates) : { removed: [], missing: [] }
  return { event: eventOut(state, resolvedFirst(target)), availabilityFallback: fallback, exdatesRemoved: removed, exdatesMissing: missing }
}

function remove(state, args) {
  const a = fields(args, ['ids', 'recurrenceId', 'span'], ['ids', 'span'])
  const ids = readIds(args.ids)
  const span = a.oneOf('span', ['this', 'future'])
  const ridRaw = a.string('recurrenceId', 64)
  if (ridRaw !== undefined && !parseWhen(ridRaw)) throw schema('recurrenceId fora do formato.')
  requireFullAccess(state)

  const item = locate(state, ids)
  let occ = null
  if (ridRaw !== undefined) {
    const recurrenceId = parseWhen(ridRaw)
    if (recurrenceId.day !== item.allDay) throw schema('recurrenceId fora do formato.')
    occ = occurrenceOf(item, recurrenceId.text)
    if (!occ) throw new Failure('not-found', 'occurrence', 'Não achei essa ocorrência na agenda.')
  } else if (span === 'this' && item.recurrence) {
    throw schema('span this numa série pede recurrenceId.')
  }
  const calendar = state.calendars.find((entry) => entry.id === item.calendarId)
  if (!calendar?.writable) throw invalid('not-mutable', 'O Calendário não deixa tirar este evento.')
  if (occ?.occurrence && span === 'this') item.removed.push(occ.occurrence)
  else if (occ?.occurrence && occ.occurrence !== resolvedFirst(item).occurrence) item.cutFrom = occ.occurrence
  else state.events = state.events.filter((event) => event !== item)
  return { removed: { calendarItemIdentifier: item.calendarItemIdentifier, occurrence: occ?.occurrence ?? null, span } }
}

/** `{ result, save }`: `save` diz se o estado volta para o arquivo. */
function run(cmd, args) {
  if (['status', 'request-access', 'calendars', 'refresh'].includes(cmd)) fields(args, [])
  const state = loadState()
  switch (cmd) {
    case 'status':
      return { result: { access: state.access, version: VERSION } }
    case 'request-access': {
      if (state.access === 'notDetermined') state.access = state.onRequest === 'full' ? 'full' : 'denied'
      saveState(state)
      return { result: { access: state.access, granted: state.access === 'full' } }
    }
    case 'calendars': {
      requireFullAccess(state)
      const list = [...state.calendars].sort((a, b) => (a.sourceTitle === b.sourceTitle ? (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) : a.sourceTitle < b.sourceTitle ? -1 : 1))
      return { result: { calendars: list } }
    }
    case 'refresh': {
      state.refreshes++
      const ready = state.pending.filter((entry) => entry.afterRefresh <= state.refreshes)
      state.pending = state.pending.filter((entry) => entry.afterRefresh > state.refreshes)
      for (const entry of ready) state.events.push(normalizeEvent(entry.event))
      saveState(state)
      return { result: { requestedAt: formatMs(Math.floor(Date.now() / 1000) * 1000, false) } }
    }
    case 'find':
      return { result: find(state, args) }
    default: {
      const result = cmd === 'create' ? create(state, args) : cmd === 'update' ? update(state, args) : remove(state, args)
      saveState(state)
      return { result }
    }
  }
}

function handle(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return failureLine(null, invalid('json', 'A linha não é um JSON.'))
  }
  const id = isObject(json) && validId(json.id) ? json.id : null
  try {
    const request = fields(json, ['v', 'id', 'cmd', 'args'], ['v', 'id', 'cmd', 'args'])
    if (json.v !== 1) throw schema('Versão do protocolo desconhecida.')
    if (id === null) throw schema('id fora do formato.')
    const cmd = request.oneOf('cmd', [...COMMANDS])
    if (cmd === HANG) {
      hung = true
      return null
    }
    if (cmd === EXIT_ON) process.exit(1)
    if (cmd === GARBAGE) return { garbage: true, id, ok: true, v: 1 }
    return { v: 1, id, ok: true, result: run(cmd, json.args).result }
  } catch (error) {
    if (error instanceof Failure) return failureLine(id, error)
    return failureLine(id, new Failure('unavailable', 'eventkit', String(error?.message ?? error)))
  }
}

// --- Laço --------------------------------------------------------------------------------------------------------

let hung = false
let buffer = Buffer.alloc(0)
let discarding = false

function line(bytes) {
  if (hung) return
  if (bytes.length > MAX_REQUEST_LINE) {
    write(failureLine(null, invalid('line-too-long', 'A linha passou de 64 KiB.')))
    return
  }
  const text = bytes.toString('utf8')
  if (!text.trim()) return
  if (LOG_FILE) appendFileSync(LOG_FILE, `${text}\n`)
  const response = handle(text)
  if (response) write(response)
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (let end = buffer.indexOf(0x0a); end !== -1; end = buffer.indexOf(0x0a)) {
    const bytes = buffer.subarray(0, end)
    buffer = buffer.subarray(end + 1)
    if (discarding) {
      discarding = false
      if (!hung) write(failureLine(null, invalid('line-too-long', 'A linha passou de 64 KiB.')))
      continue
    }
    line(bytes)
  }
  if (buffer.length > MAX_REQUEST_LINE) {
    discarding = true
    buffer = Buffer.alloc(0)
  }
})

// O app morreu (ou desligou o cliente): o stdin fecha e o processo sai.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('close', () => process.exit(0))
process.stdin.resume()
