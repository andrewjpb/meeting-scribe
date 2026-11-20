// Convites de reunião que chegam por email (contrato 59, feature convites-agenda): lê o `.ics` (iCalendar, RFC 5545 e
// RFC 5546) das partes da mensagem e monta o REPLY de "Aceitar", "Talvez" e "Recusar". Módulo puro: sem rede, sem
// disco, sem relógio (o "agora" vem de quem chama) e sem IA. A recorrência nunca é expandida: só lida e descrita.
// O `ical.js` confere a estrutura do arquivo e calcula os fusos que vêm em VTIMEZONE; as linhas são lidas aqui, porque
// o REPLY copia as linhas exatas do convite e a RRULE precisa do texto como veio.
import ICAL from 'ical.js'
import { CALENDAR_ATTENDEES_MAX, CALENDAR_TEXT_MAX, findJoinUrl } from './calendar'
import { windowsToIana } from './windows-zones'

/** Teto por parte `.ics`, em bytes antes de decodificar (CA9). */
export const INVITE_ICS_MAX_BYTES = 512 * 1024
/** VEVENTs por arquivo (CA9). */
export const INVITE_VEVENTS_MAX = 200
export const INVITE_EXDATES_MAX = 500
export const INVITE_EXCEPTIONS_MAX = 100
/** Caracteres, depois de tirar o escape do iCalendar. */
export const INVITE_DESCRIPTION_MAX = 8000

export type InviteMethod = 'REQUEST' | 'CANCEL' | 'REPLY'
export type InvitePartstat = 'NEEDS-ACTION' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | 'DELEGATED'
export type InviteReplyPartstat = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'
export interface InvitePerson {
  /** Minúsculo, sem "mailto:". */
  address: string
  /** Parâmetro `CN`. */
  name: string | null
}
export interface InviteAttendee extends InvitePerson {
  partstat: InvitePartstat
}
export type InviteWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export interface InviteRule {
  freq: 'SECONDLY' | 'MINUTELY' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  /** ISO UTC, ou AAAA-MM-DD se dia inteiro. */
  until: string | null
  byDay: { day: InviteWeekday; pos: number | null }[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  weekStart: InviteWeekday | null
}
export type InviteRecurrenceBlock = 'sub-daily' | 'byhour' | 'byminute' | 'bysecond' | 'byweekno' | 'byyearday' | 'rdate' | 'exrule' | 'multiple-rrule' | 'invalid'
export interface InviteRecurrence {
  /** `null` só quando não há RRULE (só RDATE) ou a RRULE é ilegível. */
  rule: InviteRule | null
  /** ISO UTC (ou AAAA-MM-DD), ordenadas, sem repetição, até `INVITE_EXDATES_MAX`. */
  exdates: string[]
  /** Em português (CA7). */
  text: string
  /** N8: o EKRecurrenceRule grava? */
  storable: boolean
  /** Por que não grava; `null` quando grava. */
  block: InviteRecurrenceBlock | null
}
export interface InviteException {
  recurrenceId: string
  start: string
  end: string
  cancelled: boolean
}
export type InviteWarning = 'unknown-tzid' | 'floating-time' | 'attendees-clipped' | 'description-clipped' | 'other-uids-ignored' | 'exdates-clipped' | 'exceptions-clipped'
export interface EmailInvite {
  method: InviteMethod
  uid: string
  /** Ausente ou inválido → 0. */
  sequence: number
  /** ISO UTC. */
  dtstamp: string | null
  /** ISO UTC (ou AAAA-MM-DD) quando o VEVENT principal é uma ocorrência. */
  recurrenceId: string | null
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' | null
  /** SUMMARY sem escape, até `CALENDAR_TEXT_MAX`; vazio → "(sem título)". */
  title: string
  allDay: boolean
  /** ISO UTC com milissegundos ("2026-11-20T15:00:00.000Z") ou AAAA-MM-DD se `allDay`. */
  start: string
  /** Idem; dia inteiro: exclusivo. */
  end: string
  /** IANA (N11); `null` em dia inteiro ou fuso que não deu para nomear. */
  timeZone: string | null
  /** TZID como veio (para o cartão mostrar o fuso de origem). */
  originalTzid: string | null
  location: string | null
  description: string | null
  /** CA6. */
  joinUrl: string | null
  organizer: InvitePerson | null
  /** Até `CALENDAR_ATTENDEES_MAX`, na ordem do arquivo. */
  attendees: InviteAttendee[]
  /** Total real de ATTENDEE. */
  attendeeCount: number
  /** N5: o ATTENDEE cujo endereço é um de `options.self`. */
  self: InviteAttendee | null
  /** `null` sem RRULE nem RDATE. */
  recurrence: InviteRecurrence | null
  /** VEVENTs do mesmo UID com RECURRENCE-ID (quando o principal é a série). */
  exceptions: InviteException[]
  warnings: InviteWarning[]
  /** O VCALENDAR escolhido, como texto (já decodificado), para o `buildReply` e o "Abrir no app de agenda". */
  source: string
}
export interface InvitePart {
  /** Com ou sem parâmetros. */
  contentType: string
  filename: string | null
  /** Parâmetro `method=` do Content-Type. */
  method: string | null
  content: string | Uint8Array
}
export type InviteParseError = 'none' | 'too-big' | 'malformed' | 'no-event' | 'no-method' | 'unsupported-method' | 'no-uid' | 'no-start'
export type InviteParseResult = { ok: true; invite: EmailInvite; ignoredParts: number } | { ok: false; error: InviteParseError }
export type InviteReplyError = 'not-request' | 'no-organizer' | 'not-invited' | 'invalid' | 'malformed'
export type InviteReplyResult =
  | { ok: true; ics: string; subject: string; to: InvitePerson; filename: 'invite.ics'; contentType: 'text/calendar; charset=utf-8; method=REPLY' }
  | { ok: false; error: InviteReplyError }

// ---------------------------------------------------------------------------------------------------------------
// Linhas do iCalendar (RFC 5545 §3.1): desdobra, separa nome, parâmetros e valor, e monta a árvore de componentes.

interface RawParam {
  /** Em maiúsculo. */
  name: string
  /** O primeiro valor, sem aspas. */
  value: string
  /** `NOME=valor` como veio na linha. */
  text: string
}
interface RawProp {
  /** Em maiúsculo. */
  name: string
  /** O nome como veio na linha. */
  nameText: string
  params: RawParam[]
  /** O valor como veio, ainda com o escape do iCalendar. */
  value: string
  /** A linha inteira, desdobrada. */
  line: string
}
interface RawComponent {
  name: string
  props: RawProp[]
  children: RawComponent[]
  /** Índices em `RawCalendar.lines` da linha BEGIN e da END. */
  first: number
  last: number
  /** Posições no texto: do começo da linha BEGIN ao fim da linha END (com a quebra). */
  start: number
  end: number
}
interface RawCalendar {
  roots: RawComponent[]
  /** Linhas desdobradas. */
  lines: string[]
}

function parseLine(line: string): RawProp | null {
  let i = 0
  while (i < line.length && /[A-Za-z0-9.-]/.test(line[i] ?? '')) i++
  if (i === 0) return null
  const nameText = line.slice(0, i)
  const params: RawParam[] = []
  while (line[i] === ';') {
    i++
    const paramStart = i
    while (i < line.length && line[i] !== '=' && line[i] !== ';' && line[i] !== ':') i++
    if (line[i] !== '=' || i === paramStart) return null
    const name = line.slice(paramStart, i).toUpperCase()
    i++
    let first: string | null = null
    for (;;) {
      let piece: string
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1)
        if (close < 0) return null
        piece = line.slice(i + 1, close)
        i = close + 1
      } else {
        const valueStart = i
        while (i < line.length && line[i] !== ',' && line[i] !== ';' && line[i] !== ':' && line[i] !== '"') i++
        piece = line.slice(valueStart, i)
      }
      first ??= piece
      if (line[i] !== ',') break
      i++
    }
    params.push({ name, value: first, text: line.slice(paramStart, i) })
  }
  if (line[i] !== ':') return null
  return { name: nameText.toUpperCase(), nameText, params, value: line.slice(i + 1), line }
}

/** A árvore do texto inteiro, ou `null` se alguma linha não é iCalendar ou um BEGIN não fecha. */
function parseRaw(text: string): RawCalendar | null {
  // Linhas físicas (CRLF, LF ou CR), com a posição no texto.
  const logical: { text: string; start: number; end: number }[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && text[j] !== '\r' && text[j] !== '\n') j++
    let k = j
    if (text[k] === '\r') k++
    if (text[k] === '\n') k++
    const physical = text.slice(i, j)
    const previous = logical[logical.length - 1]
    if ((physical.startsWith(' ') || physical.startsWith('\t')) && previous) {
      previous.text += physical.slice(1)
      previous.end = k
    } else if (physical.trim() !== '') {
      logical.push({ text: physical, start: i, end: k })
    }
    i = k
  }
  const roots: RawComponent[] = []
  const stack: RawComponent[] = []
  for (let index = 0; index < logical.length; index++) {
    const entry = logical[index]
    if (!entry) continue
    const prop = parseLine(entry.text)
    const top = stack[stack.length - 1]
    // Fora de qualquer BEGIN/END (texto antes do BEGIN:VCALENDAR ou depois do END), a linha não conta.
    if (!top && prop?.name !== 'BEGIN') continue
    if (!prop) return null
    if (prop.name === 'BEGIN') {
      const name = prop.value.trim().toUpperCase()
      if (!name) return null
      const component: RawComponent = { name, props: [], children: [], first: index, last: index, start: entry.start, end: entry.end }
      if (top) top.children.push(component)
      else roots.push(component)
      stack.push(component)
    } else if (prop.name === 'END') {
      if (!top || prop.value.trim().toUpperCase() !== top.name) return null
      top.last = index
      top.end = entry.end
      stack.pop()
    } else if (top) {
      top.props.push(prop)
    }
  }
  if (stack.length > 0 || roots.length === 0) return null
  return { roots, lines: logical.map((entry) => entry.text) }
}

const firstProp = (component: RawComponent, name: string): RawProp | null => component.props.find((prop) => prop.name === name) ?? null
const allProps = (component: RawComponent, name: string): RawProp[] => component.props.filter((prop) => prop.name === name)
const paramOf = (prop: RawProp, name: string): string | null => prop.params.find((param) => param.name === name)?.value ?? null

/** Tira o escape do TEXT (RFC 5545 §3.3.11). */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char))
}

/** Sem caractere de controle além de `\n` e `\t`, sem espaço nas pontas. */
function cleanText(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f)) out += char
  }
  return out.trim()
}

/** Corta em `max` caracteres sem partir um par de surrogates. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

function textProp(component: RawComponent, name: string): string | null {
  const prop = firstProp(component, name)
  if (!prop) return null
  const value = cleanText(unescapeText(prop.value))
  return value === '' ? null : value
}

// ---------------------------------------------------------------------------------------------------------------
// Datas e fusos (N11): tudo sai em UTC, ou AAAA-MM-DD no dia inteiro.

interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  date: boolean
  utc: boolean
}

function parseWall(value: string): Wall | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(value.trim())
  if (!match) return null
  const wall: Wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    date: match[4] === undefined,
    utc: match[7] !== undefined,
  }
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second))
  const same = check.getUTCFullYear() === wall.year && check.getUTCMonth() === wall.month - 1 && check.getUTCDate() === wall.day && check.getUTCHours() === wall.hour && check.getUTCMinutes() === wall.minute && check.getUTCSeconds() === wall.second
  return same ? wall : null
}

const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
const wallDate = (wall: Pick<Wall, 'year' | 'month' | 'day'>): string => `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`
const wallAsUtc = (wall: Wall): number => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)

/** O nome IANA na forma canônica do `Intl` (`america/new_york` → `America/New_York`), ou `null` se não é fuso. */
function canonicalZone(name: string): string | null {
  if (!name.trim()) return null
  try {
    return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

const isIanaZone = (name: string): boolean => canonicalZone(name) !== null

/** Data e hora de parede de um instante num fuso IANA. */
function wallIn(ms: number, timeZone: string): Omit<Wall, 'date' | 'utc'> & { weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? NaN)
  const wall = { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
  return { ...wall, weekday: new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() }
}

/** O instante de uma hora de parede num fuso IANA (no buraco do horário de verão, a hora de depois). */
function zonedToUtc(wall: Wall, timeZone: string): number {
  const guess = wallAsUtc(wall)
  const offset = (ms: number): number => {
    const seen = wallIn(ms, timeZone)
    return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - Math.floor(ms / 1000) * 1000
  }
  const first = offset(guess)
  const second = offset(guess - first)
  return guess - (first === second ? first : second)
}

/** Nome IANA de um TZID que não veio com VTIMEZONE: IANA, nome do Windows ou caminho que termina num IANA. */
function namedZone(tzid: string): string | null {
  const name = tzid.trim()
  const iana = canonicalZone(name)
  if (iana) return iana
  const windows = windowsToIana(name)
  if (windows) return canonicalZone(windows)
  if (name.includes('/')) {
    const segments = name.split('/').filter((segment) => segment !== '')
    for (let index = 1; index < segments.length; index++) {
      const candidate = canonicalZone(segments.slice(index).join('/'))
      if (candidate) return candidate
    }
  }
  return null
}

interface ZoneContext {
  /** TZIDs registrados no `ical.js` a partir dos VTIMEZONE do arquivo. */
  registered: ReadonlySet<string>
  /** TZIDs com VTIMEZONE recusado por `safeVtimezone`: lidos pelo nome, com aviso. */
  rejected: ReadonlySet<string>
  localTimeZone: string
  warnings: Set<InviteWarning>
}

/**
 * Tetos do VTIMEZONE antes de entregá-lo ao `ical.js`, que expande as regras de STANDARD/DAYLIGHT do DTSTART delas
 * até o ano do evento + 5, sem limite: um `FREQ=MINUTELY` desde 1601 estoura a memória do processo. Só passa regra
 * anual com no máximo um mês e um dia da semana (o formato de todo provedor), até 100 subcomponentes e 200 RDATE, e
 * DTSTART entre 1600 (o Outlook usa 1601) e 2200. O evento usa o VTIMEZONE só entre 1900 e 2200; fora disso, o nome.
 */
const VTIMEZONE_PARTS_MAX = 100
const VTIMEZONE_RDATES_MAX = 200
const VTIMEZONE_YEARS = [1600, 2200] as const
const EVENT_YEARS = [1900, 2200] as const
const VTIMEZONE_RULE_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYMONTH', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS', 'WKST'])

function safeVtimezone(vtimezone: RawComponent): boolean {
  if (vtimezone.children.length === 0 || vtimezone.children.length > VTIMEZONE_PARTS_MAX) return false
  let rdates = 0
  for (const part of vtimezone.children) {
    if (part.name !== 'STANDARD' && part.name !== 'DAYLIGHT') return false
    if (part.children.length > 0) return false
    const dtstart = firstProp(part, 'DTSTART')
    const wall = dtstart ? parseWall(dtstart.value) : null
    if (!wall || wall.year < VTIMEZONE_YEARS[0] || wall.year > VTIMEZONE_YEARS[1]) return false
    for (const rdate of allProps(part, 'RDATE')) rdates += rdate.value.split(',').length
    if (rdates > VTIMEZONE_RDATES_MAX) return false
    const rrules = allProps(part, 'RRULE')
    if (rrules.length > 1) return false
    const rrule = rrules[0]
    if (rrule) {
      const { parts, clean } = ruleParts(rrule.value)
      if (!clean || parts.get('FREQ') !== 'YEARLY') return false
      for (const [key, value] of parts) {
        if (!VTIMEZONE_RULE_KEYS.has(key)) return false
        const items = value.split(',').length
        if ((key === 'BYMONTH' || key === 'BYDAY' || key === 'BYSETPOS') && items > 1) return false
        if (key === 'BYMONTHDAY' && items > 7) return false
        if (key === 'INTERVAL' && !/^[1-9]\d{0,2}$/.test(value)) return false
      }
    }
  }
  return true
}

/** O instante sai do VTIMEZONE registrado (e não do nome) para esta data? */
const viaVtimezone = (wall: Wall, tzid: string, context: ZoneContext): boolean => context.registered.has(tzid) && wall.year >= EVENT_YEARS[0] && wall.year <= EVENT_YEARS[1]

/** O instante de uma data-hora com o TZID dela, em ms. `warn: false` não marca aviso (DTSTAMP, UNTIL). */
function wallToMs(wall: Wall, tzid: string | null, context: ZoneContext, warn = true): number {
  if (wall.utc) return wallAsUtc(wall)
  if (tzid === null) {
    if (warn) context.warnings.add('floating-time')
    return zonedToUtc(wall, context.localTimeZone)
  }
  if (viaVtimezone(wall, tzid, context)) {
    const zone = ICAL.TimezoneService.get(tzid)
    if (zone) {
      const time = new ICAL.Time({ year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, second: wall.second, isDate: false }, zone)
      return time.toUnixTime() * 1000
    }
  }
  // VTIMEZONE recusado, ou data fora da faixa dele: vale o nome, com aviso.
  if (warn && (context.rejected.has(tzid) || context.registered.has(tzid))) context.warnings.add('unknown-tzid')
  const named = namedZone(tzid)
  if (named) return zonedToUtc(wall, named)
  if (warn) context.warnings.add('unknown-tzid')
  return zonedToUtc(wall, context.localTimeZone)
}

const MS_MAX = 8.64e15
const isoOf = (ms: number): string | null => (Number.isFinite(ms) && Math.abs(ms) <= MS_MAX ? new Date(ms).toISOString() : null)

/** Valor de data ou data-hora em ISO UTC (ou AAAA-MM-DD). */
function instantOf(value: string, tzid: string | null, context: ZoneContext, warn = true): string | null {
  const wall = parseWall(value)
  if (!wall) return null
  return wall.date ? wallDate(wall) : isoOf(wallToMs(wall, tzid, context, warn))
}

function propInstant(prop: RawProp | null, context: ZoneContext, warn = true): string | null {
  return prop ? instantOf(prop.value, paramOf(prop, 'TZID'), context, warn) : null
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10)
}

/** Fim do evento: DTEND, senão DURATION, senão o dia seguinte (dia inteiro) ou o próprio início (RFC 5545 §3.6.1). */
function endOf(event: RawComponent, start: string, allDay: boolean, context: ZoneContext): string {
  const dtend = firstProp(event, 'DTEND')
  if (dtend) {
    const wall = parseWall(dtend.value)
    if (wall && wall.date === allDay) {
      const end = propInstant(dtend, context)
      if (end) return end
    }
  }
  const duration = firstProp(event, 'DURATION')
  if (duration) {
    let seconds: number | null
    try {
      seconds = ICAL.Duration.fromString(duration.value.trim()).toSeconds()
    } catch {
      seconds = null
    }
    if (seconds !== null && Number.isFinite(seconds)) {
      if (allDay) {
        const days = Math.trunc(seconds / 86_400)
        if (days >= 1) return addDays(start, days)
      } else if (seconds >= 0) {
        const end = isoOf(Date.parse(start) + seconds * 1000)
        if (end) return end
      }
    }
  }
  return allDay ? addDays(start, 1) : start
}

// ---------------------------------------------------------------------------------------------------------------
// Recorrência (N8, CA7, CA8): lida, classificada e descrita; nunca expandida.

const WEEKDAYS: readonly InviteWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const FREQS: readonly InviteRule['freq'][] = ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const RULE_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYWEEKNO', 'BYYEARDAY'])
/** As partes que o texto em português cobre; qualquer outra vira "Repetição personalizada". */
const DESCRIBED_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST'])

/** As partes da RRULE, sem conferir os valores; `clean: false` quando alguma parte não é `CHAVE=valor` ou se repete. */
function ruleParts(rrule: string): { parts: Map<string, string>; clean: boolean } {
  const text = rrule.trim().replace(/^RRULE:/i, '')
  const parts = new Map<string, string>()
  let clean = text !== ''
  for (const segment of text.split(';')) {
    const eq = segment.indexOf('=')
    if (eq <= 0) {
      clean = false
      continue
    }
    const key = segment.slice(0, eq).trim().toUpperCase()
    if (parts.has(key)) clean = false
    parts.set(key, segment.slice(eq + 1).trim().toUpperCase())
  }
  return { parts, clean }
}

function intList(value: string | undefined, min: number, max: number, allowNegative: boolean): number[] | null {
  if (value === undefined) return []
  const out: number[] = []
  for (const item of value.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(item)) return null
    const number = Number(item)
    const magnitude = Math.abs(number)
    if (number === 0 && min > 0) return null
    if ((number < 0 && !allowNegative) || magnitude < min || magnitude > max) return null
    out.push(number)
  }
  return out
}

interface LegibleRule extends Omit<InviteRule, 'until'> {
  /** UNTIL como veio. */
  untilRaw: string | null
  keys: ReadonlySet<string>
}

/** A RRULE conferida parte a parte, ou `null` se é ilegível. */
function legibleRule(rrule: string): LegibleRule | null {
  const { parts, clean } = ruleParts(rrule)
  if (!clean) return null
  for (const key of parts.keys()) if (!RULE_KEYS.has(key)) return null
  const freq = FREQS.find((value) => value === parts.get('FREQ'))
  if (!freq) return null
  const interval = parts.get('INTERVAL')
  const count = parts.get('COUNT')
  const until = parts.get('UNTIL')
  if (interval !== undefined && !/^\d{1,6}$/.test(interval)) return null
  if (count !== undefined && !/^\d{1,6}$/.test(count)) return null
  if (until !== undefined && !parseWall(until)) return null
  const byDay: InviteRule['byDay'] = []
  const byDayText = parts.get('BYDAY')
  if (byDayText !== undefined) {
    for (const item of byDayText.split(',')) {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item)
      if (!match) return null
      const pos = match[1] === undefined ? null : Number(match[1])
      if (pos !== null && (pos === 0 || Math.abs(pos) > 53)) return null
      byDay.push({ day: match[2] as InviteWeekday, pos })
    }
  }
  const byMonthDay = intList(parts.get('BYMONTHDAY'), 1, 31, true)
  const byMonth = intList(parts.get('BYMONTH'), 1, 12, false)
  const bySetPos = intList(parts.get('BYSETPOS'), 1, 366, true)
  const others = [intList(parts.get('BYHOUR'), 0, 23, false), intList(parts.get('BYMINUTE'), 0, 59, false), intList(parts.get('BYSECOND'), 0, 60, false), intList(parts.get('BYWEEKNO'), 1, 53, true), intList(parts.get('BYYEARDAY'), 1, 366, true)]
  if (!byMonthDay || !byMonth || !bySetPos || others.some((list) => list === null)) return null
  const wkst = parts.get('WKST')
  const weekStart = wkst === undefined ? null : (WEEKDAYS.find((day) => day === wkst) ?? null)
  if (wkst !== undefined && !weekStart) return null
  return {
    freq,
    interval: interval === undefined ? 1 : Number(interval),
    count: count === undefined ? null : Number(count),
    untilRaw: until ?? null,
    byDay,
    byMonthDay,
    byMonth,
    bySetPos,
    weekStart,
    keys: new Set(parts.keys()),
  }
}

/** O que o EKRecurrenceRule do Calendário do Mac grava (N8); a primeira regra que bate, na ordem do CA8. */
export function classifyRecurrence(rrules: readonly string[], hasRdate: boolean, hasExrule: boolean): { storable: boolean; block: InviteRecurrenceBlock | null } {
  const blocked = (block: InviteRecurrenceBlock): { storable: false; block: InviteRecurrenceBlock } => ({ storable: false, block })
  if (rrules.length > 1) return blocked('multiple-rrule')
  if (hasExrule) return blocked('exrule')
  if (hasRdate) return blocked('rdate')
  const rrule = rrules[0]
  if (rrule === undefined) return blocked('invalid')
  const { parts } = ruleParts(rrule)
  const freq = parts.get('FREQ')
  if (freq === 'SECONDLY' || freq === 'MINUTELY' || freq === 'HOURLY') return blocked('sub-daily')
  if (parts.has('BYHOUR')) return blocked('byhour')
  if (parts.has('BYMINUTE')) return blocked('byminute')
  if (parts.has('BYSECOND')) return blocked('bysecond')
  if (parts.has('BYWEEKNO')) return blocked('byweekno')
  if (parts.has('BYYEARDAY')) return blocked('byyearday')
  const rule = legibleRule(rrule)
  if (!rule || (rule.count !== null && rule.untilRaw !== null) || rule.interval < 1 || rule.count === 0) return blocked('invalid')
  if ((rule.freq === 'WEEKLY' || rule.freq === 'DAILY') && rule.byDay.some((item) => item.pos !== null)) return blocked('invalid')
  return { storable: true, block: null }
}

const CUSTOM = 'Repetição personalizada'
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** Plural (lista da semana), singular (ordinal do mês) e se o nome é masculino. */
const DAY_NAMES: Readonly<Record<InviteWeekday, { plural: string; singular: string; male: boolean }>> = {
  MO: { plural: 'segundas', singular: 'segunda', male: false },
  TU: { plural: 'terças', singular: 'terça', male: false },
  WE: { plural: 'quartas', singular: 'quarta', male: false },
  TH: { plural: 'quintas', singular: 'quinta', male: false },
  FR: { plural: 'sextas', singular: 'sexta', male: false },
  SA: { plural: 'sábados', singular: 'sábado', male: true },
  SU: { plural: 'domingos', singular: 'domingo', male: true },
}
const ORDINALS: Readonly<Record<string, [string, string]>> = { '1': ['primeira', 'primeiro'], '2': ['segunda', 'segundo'], '3': ['terceira', 'terceiro'], '4': ['quarta', 'quarto'], '-1': ['última', 'último'] }
/** `Date.getUTCDay()` (domingo = 0) para o dia do iCalendar. */
const JS_WEEKDAY: readonly InviteWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** "às segundas, quartas e aos sábados": artigo no primeiro e de novo só quando o gênero muda. */
function dayList(days: readonly InviteWeekday[]): string {
  const items: string[] = []
  let previousMale: boolean | null = null
  for (const day of days) {
    const name = DAY_NAMES[day]
    items.push(name.male === previousMale ? name.plural : `${name.male ? 'aos' : 'às'} ${name.plural}`)
    previousMale = name.male
  }
  return items.length === 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1] ?? ''}`
}

interface CivilDate {
  year: number
  month: number
  day: number
  weekday: InviteWeekday
}

function civilOf(value: string, timeZone: string): CivilDate | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (date) {
    const year = Number(date[1])
    const month = Number(date[2])
    const day = Number(date[3])
    const weekday = JS_WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
    return weekday ? { year, month, day, weekday } : null
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const wall = wallIn(ms, timeZone)
  const weekday = JS_WEEKDAY[wall.weekday]
  return weekday ? { year: wall.year, month: wall.month, day: wall.day, weekday } : null
}

/** A RRULE em português (CA7); o que a tabela do contrato não cobre vira "Repetição personalizada". */
export function describeRecurrence(rrule: string, dtstart: { start: string; timeZone: string | null; allDay: boolean }): string {
  try {
    return describe(rrule, dtstart) ?? CUSTOM
  } catch {
    return CUSTOM
  }
}

function describe(rrule: string, dtstart: { start: string; timeZone: string | null; allDay: boolean }): string | null {
  const rule = legibleRule(rrule)
  if (!rule) return null
  for (const key of rule.keys) if (!DESCRIBED_KEYS.has(key)) return null
  if ((rule.count !== null && rule.untilRaw !== null) || rule.interval < 1 || rule.count === 0) return null
  const timeZone = !dtstart.allDay && dtstart.timeZone && isIanaZone(dtstart.timeZone) ? dtstart.timeZone : 'UTC'
  const start = civilOf(dtstart.start, timeZone)
  const n = rule.interval
  const heads: Partial<Record<InviteRule['freq'], [string, string]>> = { DAILY: ['Todo dia', 'dias'], WEEKLY: ['Toda semana', 'semanas'], MONTHLY: ['Todo mês', 'meses'], YEARLY: ['Todo ano', 'anos'] }
  const head = heads[rule.freq]
  if (!head) return null
  let text = n === 1 ? head[0] : `A cada ${n} ${head[1]}`

  if (rule.freq === 'DAILY') {
    if (rule.byDay.length || rule.byMonthDay.length || rule.byMonth.length || rule.bySetPos.length) return null
  } else if (rule.freq === 'WEEKLY') {
    if (rule.byMonthDay.length || rule.byMonth.length || rule.bySetPos.length || rule.byDay.some((item) => item.pos !== null)) return null
    const chosen = rule.byDay.length ? rule.byDay.map((item) => item.day) : start ? [start.weekday] : []
    const days = WEEKDAYS.filter((day) => chosen.includes(day))
    if (!days.length) return null
    if (n === 1 && days.join(',') === 'MO,TU,WE,TH,FR') text = 'Todo dia útil (segunda a sexta)'
    else text += `, ${dayList(days)}`
  } else if (rule.freq === 'MONTHLY') {
    if (rule.byMonth.length) return null
    if (!rule.byDay.length && !rule.bySetPos.length) {
      if (rule.byMonthDay.length > 1) return null
      const day = rule.byMonthDay[0] ?? start?.day
      if (day === undefined || day < 1) return null
      text += `, no dia ${day}`
    } else if (rule.byDay.length === 1 && !rule.byMonthDay.length) {
      const item = rule.byDay[0]
      if (!item) return null
      let pos = item.pos
      if (pos === null) {
        if (rule.bySetPos.length !== 1) return null
        pos = rule.bySetPos[0] ?? null
      } else if (rule.bySetPos.length) {
        return null
      }
      const ordinal = ORDINALS[String(pos)]
      if (!ordinal) return null
      const name = DAY_NAMES[item.day]
      text += name.male ? `, no ${ordinal[1]} ${name.singular}` : `, na ${ordinal[0]} ${name.singular}`
    } else {
      return null
    }
  } else {
    if (rule.byDay.length || rule.bySetPos.length) return null
    let month: number | undefined
    let day: number | undefined
    if (!rule.byMonth.length && !rule.byMonthDay.length) {
      month = start?.month
      day = start?.day
    } else if (rule.byMonth.length === 1 && rule.byMonthDay.length === 1) {
      month = rule.byMonth[0]
      day = rule.byMonthDay[0]
    } else {
      return null
    }
    const monthName = month === undefined ? undefined : MONTHS[month - 1]
    if (!monthName || day === undefined || day < 1) return null
    text += `, em ${day} de ${monthName}`
  }

  if (rule.count !== null) text += `, ${rule.count} ${rule.count === 1 ? 'vez' : 'vezes'}`
  if (rule.untilRaw !== null) {
    const wall = parseWall(rule.untilRaw)
    if (!wall) return null
    const until = wall.utc ? civilOf(new Date(wallAsUtc(wall)).toISOString(), timeZone) : { year: wall.year, month: wall.month, day: wall.day }
    if (!until) return null
    text += `, até ${until.day} de ${MONTHS[until.month - 1] ?? ''}${start && start.year === until.year ? '' : ` de ${until.year}`}`
  }
  return text
}

// ---------------------------------------------------------------------------------------------------------------
// Versão (N4, RFC 5546 §2.1.5).

/** SEQUENCE primeiro; no empate, DTSTAMP (`null` é menor que qualquer data); empate nos dois → 0. */
export function compareInviteVersion(a: { sequence: number; dtstamp: string | null }, b: { sequence: number; dtstamp: string | null }): -1 | 0 | 1 {
  if (a.sequence !== b.sequence) return a.sequence > b.sequence ? 1 : -1
  const stamp = (value: string | null): number => {
    const ms = value === null ? NaN : Date.parse(value)
    return Number.isFinite(ms) ? ms : -Infinity
  }
  const left = stamp(a.dtstamp)
  const right = stamp(b.dtstamp)
  return left === right ? 0 : left > right ? 1 : -1
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura (R1, N10).

const METHODS: readonly InviteMethod[] = ['REQUEST', 'CANCEL', 'REPLY']
const PARTSTATS: readonly InvitePartstat[] = ['NEEDS-ACTION', 'ACCEPTED', 'TENTATIVE', 'DECLINED', 'DELEGATED']
const STATUSES = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'] as const

const baseType = (contentType: string): string => (contentType.split(';')[0] ?? '').trim().toLowerCase()
const addressOf = (value: string): string => value.trim().replace(/^mailto:/i, '').trim().toLowerCase()

function personOf(prop: RawProp): InvitePerson {
  const cn = paramOf(prop, 'CN')
  const name = cn === null ? '' : cleanText(cn)
  return { address: addressOf(prop.value), name: name === '' ? null : name }
}

function attendeeOf(prop: RawProp): InviteAttendee {
  const partstat = (paramOf(prop, 'PARTSTAT') ?? '').trim().toUpperCase()
  return { ...personOf(prop), partstat: PARTSTATS.find((value) => value === partstat) ?? 'NEEDS-ACTION' }
}

function byteLength(content: string | Uint8Array): number {
  if (typeof content !== 'string') return content.byteLength
  if (content.length > INVITE_ICS_MAX_BYTES) return content.length
  return new TextEncoder().encode(content).byteLength
}

function decode(part: InvitePart): string {
  if (typeof part.content === 'string') return part.content.replace(/^\uFEFF/, '')
  const bytes = part.content
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(part.contentType)?.[1]?.toLowerCase() ?? ''
  const label = ['iso-8859-1', 'latin1', 'iso8859-1', 'latin-1'].includes(charset) ? 'iso-8859-1' : ['windows-1252', 'cp1252'].includes(charset) ? 'windows-1252' : 'utf-8'
  return new TextDecoder(label).decode(bytes).replace(/^\uFEFF/, '')
}

/** O VEVENT principal: o que não tem RECURRENCE-ID; se todos têm, o primeiro. */
const mainEvent = (events: readonly RawComponent[]): RawComponent | undefined => events.find((event) => !firstProp(event, 'RECURRENCE-ID')) ?? events[0]
const uidOf = (event: RawComponent): string => {
  const prop = firstProp(event, 'UID')
  return prop ? cleanText(unescapeText(prop.value)) : ''
}

type PartResult = { ok: true; invite: EmailInvite } | { ok: false; error: InviteParseError }

function parsePart(part: InvitePart, options: { self: readonly string[]; localTimeZone: string }): PartResult {
  if (byteLength(part.content) > INVITE_ICS_MAX_BYTES) return { ok: false, error: 'too-big' }
  const text = decode(part)
  if (text.trim() === '') return { ok: false, error: 'malformed' }
  const raw = parseRaw(text)
  const calendar = raw?.roots[0]
  if (!raw || !calendar || calendar.name !== 'VCALENDAR') return { ok: false, error: 'malformed' }
  const events = calendar.children.filter((child) => child.name === 'VEVENT')
  if (events.length > INVITE_VEVENTS_MAX) return { ok: false, error: 'too-big' }
  const source = text.slice(calendar.start, calendar.end)

  // O TimezoneService do ical.js é global: os VTIMEZONE deste arquivo entram só durante este parse e saem no finally,
  // com o que já havia com o mesmo nome de volta (CA5a). Se o serviço estava vazio, volta vazio.
  const service = ICAL.TimezoneService
  const countBefore = service.count
  const restore: [string, InstanceType<typeof ICAL.Timezone> | null][] = []
  try {
    let parsed: ReturnType<typeof ICAL.parse>
    try {
      parsed = ICAL.parse(source)
    } catch {
      return { ok: false, error: 'malformed' }
    }
    if (!Array.isArray(parsed) || parsed[0] !== 'vcalendar') return { ok: false, error: 'malformed' }
    const component = new ICAL.Component(parsed)
    if (component.getAllSubcomponents('vevent').length !== events.length) return { ok: false, error: 'malformed' }
    if (events.length === 0) return { ok: false, error: 'no-event' }

    const fileMethod = firstProp(calendar, 'METHOD')?.value.trim().toUpperCase() || null
    const method = fileMethod ?? (part.method?.trim().toUpperCase() || null)
    if (!method) return { ok: false, error: 'no-method' }
    const knownMethod = METHODS.find((value) => value === method)
    if (!knownMethod) return { ok: false, error: 'unsupported-method' }

    const main = mainEvent(events)
    if (!main) return { ok: false, error: 'no-event' }
    const uid = uidOf(main)
    if (!uid) return { ok: false, error: 'no-uid' }
    const dtstart = firstProp(main, 'DTSTART')
    const startWall = dtstart ? parseWall(dtstart.value) : null
    if (!dtstart || !startWall) return { ok: false, error: 'no-start' }

    // Cada VTIMEZONE passa pelos tetos de `safeVtimezone` antes de chegar ao ical.js; o recusado vale pelo nome.
    const safety = new Map<string, boolean>()
    for (const child of calendar.children) {
      const tzidProp = child.name === 'VTIMEZONE' ? firstProp(child, 'TZID') : null
      const name = tzidProp ? unescapeText(tzidProp.value).trim() : ''
      if (name && !safety.has(name)) safety.set(name, safeVtimezone(child))
    }
    const registered = new Set<string>()
    const rejected = new Set<string>()
    for (const vtimezone of component.getAllSubcomponents('vtimezone')) {
      const tzid = vtimezone.getFirstPropertyValue('tzid')
      if (typeof tzid !== 'string' || tzid === '' || registered.has(tzid) || rejected.has(tzid)) continue
      if (safety.get(tzid.trim()) !== true) {
        rejected.add(tzid)
        continue
      }
      let zone: InstanceType<typeof ICAL.Timezone>
      try {
        zone = new ICAL.Timezone(vtimezone)
      } catch {
        rejected.add(tzid)
        continue
      }
      restore.push([tzid, service.has(tzid) ? service.get(tzid) : null])
      service.register(zone, tzid)
      registered.add(tzid)
    }

    const localTimeZone = canonicalZone(options.localTimeZone) ?? 'UTC'
    const warnings = new Set<InviteWarning>()
    const context: ZoneContext = { registered, rejected, localTimeZone, warnings }
    const selfSet = new Set(options.self.map((address) => address.trim().toLowerCase()))

    const allDay = startWall.date
    const start = propInstant(dtstart, context)
    if (!start) return { ok: false, error: 'no-start' }
    const end = endOf(main, start, allDay, context)
    const tzid = paramOf(dtstart, 'TZID')
    let timeZone: string | null
    if (allDay) timeZone = null
    else if (startWall.utc) timeZone = 'UTC'
    else if (tzid === null) timeZone = localTimeZone
    else if (viaVtimezone(startWall, tzid, context)) {
      const windows = windowsToIana(tzid)
      timeZone = canonicalZone(tzid) ?? (windows ? canonicalZone(windows) : null)
    }
    else timeZone = namedZone(tzid) ?? localTimeZone

    const sequenceText = firstProp(main, 'SEQUENCE')?.value.trim() ?? ''
    const sequence = /^\d{1,9}$/.test(sequenceText) ? Number(sequenceText) : 0
    const dtstampProp = firstProp(main, 'DTSTAMP')
    const dtstampWall = dtstampProp ? parseWall(dtstampProp.value) : null
    const dtstamp = dtstampWall && !dtstampWall.date ? propInstant(dtstampProp, context, false) : null
    const recurrenceId = propInstant(firstProp(main, 'RECURRENCE-ID'), context)
    const statusText = firstProp(main, 'STATUS')?.value.trim().toUpperCase()
    const status = STATUSES.find((value) => value === statusText) ?? null

    const title = clip(textProp(main, 'SUMMARY') ?? '', CALENDAR_TEXT_MAX) || '(sem título)'
    const location = textProp(main, 'LOCATION')
    const fullDescription = textProp(main, 'DESCRIPTION')
    let description = fullDescription
    if (description !== null && description.length > INVITE_DESCRIPTION_MAX) {
      description = clip(description, INVITE_DESCRIPTION_MAX)
      warnings.add('description-clipped')
    }
    const linkText = (name: string): string | null => {
      const prop = firstProp(main, name)
      return prop ? unescapeText(prop.value) : null
    }
    const joinUrl = findJoinUrl(linkText('X-GOOGLE-CONFERENCE'), linkText('X-MICROSOFT-SKYPETEAMSMEETINGURL'), linkText('X-MICROSOFT-ONLINEMEETINGEXTERNALLINK'), linkText('URL'), location, fullDescription)

    const organizerProp = firstProp(main, 'ORGANIZER')
    const organizer = organizerProp ? personOf(organizerProp) : null
    const everyone = allProps(main, 'ATTENDEE').map(attendeeOf)
    const self = everyone.find((attendee) => selfSet.has(attendee.address)) ?? null
    if (everyone.length > CALENDAR_ATTENDEES_MAX) warnings.add('attendees-clipped')

    const rrules = allProps(main, 'RRULE').map((prop) => prop.value)
    const hasRdate = allProps(main, 'RDATE').length > 0
    const hasExrule = allProps(main, 'EXRULE').length > 0
    let recurrence: InviteRecurrence | null = null
    if (rrules.length > 0 || hasRdate) {
      const { storable, block } = classifyRecurrence(rrules, hasRdate, hasExrule)
      const legible = rrules[0] === undefined ? null : legibleRule(rrules[0])
      let rule: InviteRule | null = null
      if (legible) {
        const { untilRaw, keys: _keys, ...fields } = legible
        rule = { ...fields, until: untilRaw === null ? null : instantOf(untilRaw, tzid, context, false) }
      }
      let text = 'Repetição por datas'
      if (rrules.length > 1) text = CUSTOM
      else if (rrules[0] !== undefined) text = describeRecurrence(rrules[0], { start, timeZone, allDay })
      const exdateSet = new Set<string>()
      for (const prop of allProps(main, 'EXDATE')) {
        const exTzid = paramOf(prop, 'TZID')
        for (const value of prop.value.split(',')) {
          const instant = instantOf(value, exTzid, context)
          if (instant) exdateSet.add(instant)
        }
      }
      let exdates = [...exdateSet].sort()
      if (exdates.length > INVITE_EXDATES_MAX) {
        exdates = exdates.slice(0, INVITE_EXDATES_MAX)
        warnings.add('exdates-clipped')
      }
      recurrence = { rule, exdates, text, storable, block }
    }

    let exceptions: InviteException[] = []
    if (!firstProp(main, 'RECURRENCE-ID')) {
      for (const event of events) {
        if (event === main || uidOf(event) !== uid) continue
        const exceptionId = propInstant(firstProp(event, 'RECURRENCE-ID'), context)
        const exceptionStartProp = firstProp(event, 'DTSTART')
        const exceptionWall = exceptionStartProp ? parseWall(exceptionStartProp.value) : null
        const exceptionStart = exceptionWall ? propInstant(exceptionStartProp, context) : null
        if (!exceptionId || !exceptionWall || !exceptionStart) continue
        const cancelled = firstProp(event, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
        exceptions.push({ recurrenceId: exceptionId, start: exceptionStart, end: endOf(event, exceptionStart, exceptionWall.date, context), cancelled })
      }
      exceptions.sort((a, b) => (a.recurrenceId < b.recurrenceId ? -1 : a.recurrenceId > b.recurrenceId ? 1 : 0))
      if (exceptions.length > INVITE_EXCEPTIONS_MAX) {
        exceptions = exceptions.slice(0, INVITE_EXCEPTIONS_MAX)
        warnings.add('exceptions-clipped')
      }
    }
    if (events.some((event) => uidOf(event) !== uid)) warnings.add('other-uids-ignored')

    return {
      ok: true,
      invite: {
        method: knownMethod,
        uid,
        sequence,
        dtstamp,
        recurrenceId,
        status,
        title,
        allDay,
        start,
        end,
        timeZone,
        originalTzid: allDay ? null : tzid,
        location,
        description,
        joinUrl,
        organizer,
        attendees: everyone.slice(0, CALENDAR_ATTENDEES_MAX),
        attendeeCount: everyone.length,
        self,
        recurrence,
        exceptions,
        warnings: [...warnings],
        source,
      },
    }
  } finally {
    for (const [name, previous] of restore.reverse()) {
      if (previous) service.register(previous, name)
      else service.remove(name)
    }
    if (countBefore === 0 && service.count !== 0) service._hard_reset()
  }
}

/**
 * O convite do email (CA2): tenta as partes `text/calendar`, `application/ics` ou `*.ics`, primeiro o `text/calendar`
 * com `method=`, depois os outros `text/calendar`, depois o resto na ordem. A primeira que dá certo vence; as seguintes
 * com o mesmo UID só contam em `ignoredParts`, e as de outro UID viram o aviso `other-uids-ignored` (C8).
 */
export function parseInvite(parts: readonly InvitePart[], options: { self: readonly string[]; localTimeZone: string }): InviteParseResult {
  try {
    const isCandidate = (part: InvitePart): boolean => {
      const type = baseType(part.contentType)
      return type === 'text/calendar' || type === 'application/ics' || (part.filename ?? '').trim().toLowerCase().endsWith('.ics')
    }
    const candidates = parts.filter(isCandidate)
    if (!candidates.length) return { ok: false, error: 'none' }
    const isCalendar = (part: InvitePart): boolean => baseType(part.contentType) === 'text/calendar'
    const hasMethod = (part: InvitePart): boolean => isCalendar(part) && typeof part.method === 'string' && part.method.trim() !== ''
    const ordered = [...candidates.filter(hasMethod), ...candidates.filter((part) => isCalendar(part) && !hasMethod(part)), ...candidates.filter((part) => !isCalendar(part))]

    let firstError: InviteParseError | null = null
    for (let index = 0; index < ordered.length; index++) {
      const part = ordered[index]
      if (!part) continue
      const result = parsePart(part, options)
      if (!result.ok) {
        firstError ??= result.error
        continue
      }
      let ignoredParts = 0
      const warnings = new Set(result.invite.warnings)
      for (const other of ordered.slice(index + 1)) {
        const next = parsePart(other, options)
        if (!next.ok) continue
        if (next.invite.uid === result.invite.uid) ignoredParts++
        else warnings.add('other-uids-ignored')
      }
      return { ok: true, invite: { ...result.invite, warnings: [...warnings] }, ignoredParts }
    }
    return { ok: false, error: firstError ?? 'malformed' }
  } catch {
    return { ok: false, error: 'malformed' }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Resposta (R3, N5, C5): só o que o organizador precisa para casar a resposta.

const REPLY_SUBJECTS: Readonly<Record<InviteReplyPartstat, string>> = { ACCEPTED: 'Aceito', TENTATIVE: 'Talvez', DECLINED: 'Recusado' }

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
}

/** Dobra em linhas de até 75 octetos (a continuação começa com espaço), sem partir caractere UTF-8. */
function foldLine(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = utf8Length(char)
    if (bytes + size > 75) {
      out.push(current)
      current = ' '
      bytes = 1
    }
    current += char
    bytes += size
  }
  out.push(current)
  return out.join('\r\n')
}

const stampOf = (now: Date): string => now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')

/** O REPLY (RFC 5546 §3.2.3) do convite com a resposta escolhida. */
export function buildReply(invite: EmailInvite, options: { partstat: InviteReplyPartstat; self: readonly string[]; now: Date }): InviteReplyResult {
  try {
    if (invite.method !== 'REQUEST') return { ok: false, error: 'not-request' }
    const partstat = options.partstat
    if (!Object.hasOwn(REPLY_SUBJECTS, partstat) || !(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) return { ok: false, error: 'invalid' }
    const raw = typeof invite.source === 'string' ? parseRaw(invite.source) : null
    const calendar = raw?.roots[0]
    if (!raw || !calendar || calendar.name !== 'VCALENDAR') return { ok: false, error: 'malformed' }
    const event = mainEvent(calendar.children.filter((child) => child.name === 'VEVENT' && uidOf(child) === invite.uid))
    const uidLine = event ? firstProp(event, 'UID') : null
    const dtstart = event ? firstProp(event, 'DTSTART') : null
    if (!event || !uidLine || !dtstart) return { ok: false, error: 'malformed' }
    const organizer = firstProp(event, 'ORGANIZER')
    if (!invite.organizer || !organizer || !/^mailto:/i.test(organizer.value.trim())) return { ok: false, error: 'no-organizer' }
    const selfSet = new Set(options.self.map((address) => address.trim().toLowerCase()))
    const attendee = allProps(event, 'ATTENDEE').find((prop) => selfSet.has(addressOf(prop.value)))
    if (!attendee) return { ok: false, error: 'not-invited' }

    const recurrenceId = invite.recurrenceId === null ? null : firstProp(event, 'RECURRENCE-ID')
    const dtend = firstProp(event, 'DTEND')
    const ending = dtend ?? firstProp(event, 'DURATION')
    const summary = firstProp(event, 'SUMMARY')
    const timed = [recurrenceId, dtstart, dtend].filter((prop): prop is RawProp => prop !== null)
    const tzids = new Set(timed.map((prop) => paramOf(prop, 'TZID')).filter((tzid): tzid is string => tzid !== null))

    // ATTENDEE do próprio: o mesmo valor e os mesmos parâmetros, com o PARTSTAT escolhido no lugar e sem o RSVP.
    const params: string[] = []
    let placed = false
    for (const param of attendee.params) {
      if (param.name === 'RSVP') continue
      if (param.name === 'PARTSTAT') {
        if (!placed) params.push(`PARTSTAT=${partstat}`)
        placed = true
        continue
      }
      params.push(param.text)
    }
    if (!placed) params.push(`PARTSTAT=${partstat}`)
    const attendeeLine = `${attendee.nameText};${params.join(';')}:${attendee.value}`

    const lines = ['BEGIN:VCALENDAR', 'PRODID:-//LAP//LAP Reunioes//PT-BR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:REPLY']
    const copied = new Set<string>()
    for (const vtimezone of calendar.children) {
      const tzid = vtimezone.name === 'VTIMEZONE' ? firstProp(vtimezone, 'TZID')?.value.trim() : undefined
      if (tzid === undefined || !tzids.has(tzid) || copied.has(tzid)) continue
      copied.add(tzid)
      lines.push(...raw.lines.slice(vtimezone.first, vtimezone.last + 1))
    }
    lines.push('BEGIN:VEVENT', uidLine.line, `SEQUENCE:${invite.sequence}`, `DTSTAMP:${stampOf(options.now)}`)
    if (recurrenceId) lines.push(recurrenceId.line)
    lines.push(dtstart.line)
    if (ending) lines.push(ending.line)
    if (summary) lines.push(summary.line)
    lines.push(organizer.line, attendeeLine, 'END:VEVENT', 'END:VCALENDAR')

    return {
      ok: true,
      ics: `${lines.map(foldLine).join('\r\n')}\r\n`,
      subject: `${REPLY_SUBJECTS[partstat]}: ${invite.title}`.replace(/[\r\n]+/g, ' '),
      to: { address: invite.organizer.address, name: invite.organizer.name },
      filename: 'invite.ics',
      contentType: 'text/calendar; charset=utf-8; method=REPLY',
    }
  } catch {
    return { ok: false, error: 'malformed' }
  }
}
