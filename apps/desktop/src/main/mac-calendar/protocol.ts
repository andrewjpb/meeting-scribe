// Contrato 60 (convites-agenda): o protocolo do `lap-calendar` (native/calendar/main.swift) em zod. Cada requisição e
// cada resposta tem o seu esquema `.strict()` (chave a mais é recusada); os limites valem igual no helper, no falso
// (test/fixtures/fake-lap-calendar.mjs) e no cliente (process.ts). Puro: nada de processo aqui.
import { z } from 'zod'

export const MAC_CALENDAR_PROTOCOL_VERSION = 1
export const MAC_CALENDAR_VERSION = 'lap-calendar 2'

/** Linha de requisição (sem o `\n`), em bytes UTF-8. */
export const MAC_CALENDAR_MAX_REQUEST_LINE = 64 * 1024
/** Linha de resposta (sem o `\n`), em bytes UTF-8. */
export const MAC_CALENDAR_MAX_RESPONSE_LINE = 1024 * 1024
export const MAC_CALENDAR_MAX_TITLE = 1024
export const MAC_CALENDAR_MAX_LOCATION = 1024
/** R4: as notas levam o link e a descrição, em texto puro, até 4000 caracteres. */
export const MAC_CALENDAR_MAX_NOTES = 4000
export const MAC_CALENDAR_MAX_URL = 2048
export const MAC_CALENDAR_MAX_EXDATES = 500
export const MAC_CALENDAR_MAX_MATCHES = 50
/** Itens de cada lista da recorrência (`byDay`, `byMonthDay`, `bySetPos`; `byMonth` vai até 12). */
export const MAC_CALENDAR_MAX_RECURRENCE_LIST = 366
/** O `find` olha a janela `[start − 1 dia, end + 1 dia]`. */
export const MAC_CALENDAR_FIND_MARGIN_MS = 86_400_000
/** Contrato 132 (inicio): o `list` devolve no máximo isto, os primeiros pelo início. */
export const MAC_CALENDAR_MAX_LIST = 200
/** A janela do `list` vai até 35 dias (o Início pede dois); maior que isso é `invalid`/`dates`, como fim ≤ início. */
export const MAC_CALENDAR_MAX_LIST_WINDOW_MS = 35 * 86_400_000
/** A mensagem do `refine` do `list` que o cliente devolve como `invalid`/`dates` (o mesmo `reason` do helper). */
export const MAC_CALENDAR_DATES_ISSUE = 'janela fora da ordem ou maior que 35 dias'

export const MAC_CALENDAR_COMMANDS = ['status', 'request-access', 'calendars', 'refresh', 'find', 'list', 'create', 'update', 'remove'] as const
export type MacCalendarCmd = (typeof MAC_CALENDAR_COMMANDS)[number]

// --- Valores -----------------------------------------------------------------------------------------------------

const INSTANT_IN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/
const INSTANT_OUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function validParts(match: RegExpExecArray | null): boolean {
  if (!match) return false
  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1, 7).map((part) => (part === undefined ? 0 : Number(part)))
  if (year === undefined || month === undefined || day === undefined || year < 1 || month < 1 || month > 12 || day < 1) return false
  if (hour > 23 || minute > 59 || second > 59) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Instante UTC com `Z`; na entrada aceita fração de segundo (o helper descarta). */
export const instantInSchema = z.string().refine((text) => validParts(INSTANT_IN.exec(text)), 'instante fora do formato')
/** Instante como o helper devolve: precisão de segundo, sem fração. */
export const instantOutSchema = z.string().refine((text) => validParts(INSTANT_OUT.exec(text)), 'instante fora do formato')
/** Data de dia inteiro, `YYYY-MM-DD` (o `end` é exclusivo, como o DTEND de data do iCalendar). */
export const daySchema = z.string().refine((text) => validParts(DAY.exec(text)), 'data fora do formato')
const whenInSchema = z.union([instantInSchema, daySchema])
const whenOutSchema = z.union([instantOutSchema, daySchema])

export const isDayText = (text: string): boolean => DAY.test(text)

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const identifierSchema = z.string().min(1).max(1024)
const httpUrlSchema = z
  .string()
  .min(1)
  .max(MAC_CALENDAR_MAX_URL)
  .refine((text) => {
    try {
      const url = new URL(text)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
    } catch {
      return false
    }
  }, 'url só http ou https')

export const idsSchema = z
  .object({ eventIdentifier: identifierSchema.optional(), calendarItemIdentifier: identifierSchema.optional(), externalIdentifier: identifierSchema.optional() })
  .strict()
  .refine((ids) => ids.eventIdentifier !== undefined || ids.calendarItemIdentifier !== undefined || ids.externalIdentifier !== undefined, 'ids sem nenhum id')
export type MacCalendarIds = z.infer<typeof idsSchema>

const weekdaySchema = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
const signed = (max: number) => z.number().int().min(-max).max(max).refine((value) => value !== 0)

/** N8: o que o `EKRecurrenceRule` representa. `weekStart` é aceito, mas o EventKit não o recebe. */
export const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(999).optional(),
    count: z.number().int().min(1).max(999).optional(),
    until: whenInSchema.optional(),
    byDay: z.array(z.object({ day: weekdaySchema, pos: signed(53).optional() }).strict()).max(MAC_CALENDAR_MAX_RECURRENCE_LIST).optional(),
    byMonthDay: z.array(signed(31)).max(MAC_CALENDAR_MAX_RECURRENCE_LIST).optional(),
    byMonth: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    bySetPos: z.array(signed(366)).max(MAC_CALENDAR_MAX_RECURRENCE_LIST).optional(),
    weekStart: weekdaySchema.optional(),
  })
  .strict()
  .refine((rule) => rule.count === undefined || rule.until === undefined, 'count e until juntos')
  .refine((rule) => !(rule.freq === 'daily' || rule.freq === 'weekly') || !(rule.byDay ?? []).some((entry) => entry.pos !== undefined), 'byDay com pos só na repetição mensal ou anual')
  .refine((rule) => rule.bySetPos === undefined || rule.freq === 'monthly' || rule.freq === 'yearly', 'bySetPos só na repetição mensal ou anual')
export type MacCalendarRecurrence = z.infer<typeof recurrenceSchema>

const titleSchema = z.string().min(1).max(MAC_CALENDAR_MAX_TITLE)
const exdatesSchema = z.array(whenInSchema).max(MAC_CALENDAR_MAX_EXDATES)
const spanSchema = z.enum(['this', 'future'])

// --- Requisições -------------------------------------------------------------------------------------------------

const emptyArgs = z.object({}).strict()

export const findArgsSchema = z
  .object({ uid: z.string().min(1).max(1024), title: titleSchema, start: whenInSchema, end: whenInSchema, allDay: z.boolean(), ids: idsSchema.optional(), recurrenceId: whenInSchema.optional() })
  .strict()
export type MacCalendarFindArgs = z.infer<typeof findArgsSchema>

/** Contrato 132 (inicio): os eventos que cruzam `[start, end)`, só leitura; o fim depois do início, até 35 dias. */
export const listArgsSchema = z
  .object({ start: instantInSchema, end: instantInSchema })
  .strict()
  .refine((args) => {
    const span = Date.parse(args.end) - Date.parse(args.start)
    return span > 0 && span <= MAC_CALENDAR_MAX_LIST_WINDOW_MS
  }, MAC_CALENDAR_DATES_ISSUE)
export type MacCalendarListArgs = z.infer<typeof listArgsSchema>

export const createArgsSchema = z
  .object({
    calendarId: identifierSchema,
    title: titleSchema,
    start: whenInSchema,
    end: whenInSchema,
    allDay: z.boolean(),
    timeZone: z.string().min(1).max(64).nullable(),
    location: z.string().max(MAC_CALENDAR_MAX_LOCATION).optional(),
    url: httpUrlSchema.optional(),
    notes: z.string().max(MAC_CALENDAR_MAX_NOTES).optional(),
    availability: z.enum(['busy', 'tentative']),
    recurrence: recurrenceSchema.optional(),
    exdates: exdatesSchema.optional(),
  })
  .strict()
export type MacCalendarCreateArgs = z.infer<typeof createArgsSchema>

export const updateFieldsSchema = z
  .object({
    title: titleSchema.optional(),
    start: whenInSchema.optional(),
    end: whenInSchema.optional(),
    allDay: z.boolean().optional(),
    timeZone: z.string().min(1).max(64).nullable().optional(),
    location: z.string().max(MAC_CALENDAR_MAX_LOCATION).optional(),
    url: httpUrlSchema.optional(),
    notes: z.string().max(MAC_CALENDAR_MAX_NOTES).optional(),
    availability: z.enum(['busy', 'tentative']).optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    exdates: exdatesSchema.optional(),
  })
  .strict()
  .refine((fields) => Object.keys(fields).length > 0, 'fields vazio')

export const updateArgsSchema = z.object({ ids: idsSchema, recurrenceId: whenInSchema.optional(), span: spanSchema, fields: updateFieldsSchema }).strict()
export type MacCalendarUpdateArgs = z.infer<typeof updateArgsSchema>

export const removeArgsSchema = z.object({ ids: idsSchema, recurrenceId: whenInSchema.optional(), span: spanSchema }).strict()
export type MacCalendarRemoveArgs = z.infer<typeof removeArgsSchema>

export const MAC_CALENDAR_ARGS_SCHEMAS = {
  status: emptyArgs,
  'request-access': emptyArgs,
  calendars: emptyArgs,
  refresh: emptyArgs,
  find: findArgsSchema,
  list: listArgsSchema,
  create: createArgsSchema,
  update: updateArgsSchema,
  remove: removeArgsSchema,
} as const satisfies Record<MacCalendarCmd, z.ZodType>

export const requestSchema = z.object({ v: z.literal(1), id: idSchema, cmd: z.enum(MAC_CALENDAR_COMMANDS), args: z.record(z.string(), z.unknown()) }).strict()
export type MacCalendarRequest = z.infer<typeof requestSchema>

// --- Respostas ---------------------------------------------------------------------------------------------------

export const accessSchema = z.enum(['full', 'writeOnly', 'denied', 'restricted', 'notDetermined'])
export type MacCalendarAccess = z.infer<typeof accessSchema>

const availabilityOutSchema = z.enum(['busy', 'tentative', 'free', 'unavailable', 'none'])

export const eventOutSchema = z
  .object({
    eventIdentifier: z.string().nullable(),
    calendarItemIdentifier: z.string(),
    externalIdentifier: z.string().nullable(),
    calendarId: z.string(),
    calendarTitle: z.string(),
    sourceTitle: z.string(),
    title: z.string(),
    start: whenOutSchema,
    end: whenOutSchema,
    allDay: z.boolean(),
    timeZone: z.string().nullable(),
    recurring: z.boolean(),
    occurrence: whenOutSchema.nullable(),
    availability: availabilityOutSchema,
    url: z.string().nullable(),
  })
  .strict()
export type MacCalendarEvent = z.infer<typeof eventOutSchema>

export const MAC_CALENDAR_MATCHES = ['eventIdentifier', 'calendarItemIdentifier', 'externalIdentifier', 'uid', 'title-start'] as const
const matchSchema = eventOutSchema.extend({ match: z.enum(MAC_CALENDAR_MATCHES) }).strict()
export type MacCalendarMatch = z.infer<typeof matchSchema>

const calendarOutSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    sourceId: z.string(),
    sourceTitle: z.string(),
    sourceType: z.enum(['local', 'exchange', 'caldav', 'mobileme', 'subscribed', 'birthdays']),
    writable: z.boolean(),
    availabilities: z.array(z.enum(['busy', 'tentative', 'free', 'unavailable'])).max(4),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable(),
    isDefault: z.boolean(),
  })
  .strict()
export type MacCalendarCalendar = z.infer<typeof calendarOutSchema>

const writeResultSchema = z
  .object({ event: eventOutSchema, availabilityFallback: z.boolean(), exdatesRemoved: z.array(whenOutSchema).max(MAC_CALENDAR_MAX_EXDATES), exdatesMissing: z.array(whenOutSchema).max(MAC_CALENDAR_MAX_EXDATES) })
  .strict()

export const MAC_CALENDAR_RESULT_SCHEMAS = {
  status: z.object({ access: accessSchema, version: z.literal(MAC_CALENDAR_VERSION) }).strict(),
  'request-access': z.object({ access: accessSchema, granted: z.boolean() }).strict(),
  calendars: z.object({ calendars: z.array(calendarOutSchema) }).strict(),
  refresh: z.object({ requestedAt: instantOutSchema }).strict(),
  find: z.object({ matches: z.array(matchSchema).max(MAC_CALENDAR_MAX_MATCHES) }).strict(),
  list: z.object({ events: z.array(eventOutSchema).max(MAC_CALENDAR_MAX_LIST) }).strict(),
  create: writeResultSchema,
  update: writeResultSchema,
  remove: z
    .object({ removed: z.object({ calendarItemIdentifier: z.string(), occurrence: whenOutSchema.nullable(), span: spanSchema }).strict() })
    .strict(),
} as const satisfies Record<MacCalendarCmd, z.ZodType>

export type MacCalendarResults = { [K in MacCalendarCmd]: z.infer<(typeof MAC_CALENDAR_RESULT_SCHEMAS)[K]> }

/** Os `reason` que o helper pode mandar em cada `code`. */
export const MAC_CALENDAR_HELPER_REASONS = {
  denied: ['denied', 'not-determined', 'write-only'],
  restricted: ['restricted'],
  'not-found': ['event', 'occurrence', 'calendar'],
  invalid: ['line-too-long', 'json', 'schema', 'dates', 'timezone', 'recurrence', 'read-only-calendar', 'not-mutable', 'ambiguous'],
  unavailable: ['eventkit'],
} as const

/** Os `reason` de `unavailable` que só o cliente produz (o helper não está disponível ou não respondeu). */
export const MAC_CALENDAR_CLIENT_REASONS = ['platform', 'no-binary', 'dev', 'timeout', 'exited', 'busy', 'gave-up', 'bad-response', 'disposed'] as const

export type MacCalendarErrorCode = keyof typeof MAC_CALENDAR_HELPER_REASONS
export type MacCalendarErrorReason = (typeof MAC_CALENDAR_HELPER_REASONS)[MacCalendarErrorCode][number] | (typeof MAC_CALENDAR_CLIENT_REASONS)[number]

const HELPER_CODES = Object.keys(MAC_CALENDAR_HELPER_REASONS) as [MacCalendarErrorCode, ...MacCalendarErrorCode[]]
/**
 * O que ficou gravado apesar do erro: a série cujo EXDATE falhou e que não saiu da agenda (`create`), ou o evento cujos
 * campos já foram salvos (`update`). Só com `unavailable`/`eventkit`; o 62 usa os ids para não perder o evento.
 */
export const savedIdsSchema = z.object({ eventIdentifier: z.string().nullable(), calendarItemIdentifier: z.string(), externalIdentifier: z.string().nullable() }).strict()
export type MacCalendarSavedIds = z.infer<typeof savedIdsSchema>

const helperErrorSchema = z
  .object({ code: z.enum(HELPER_CODES), reason: z.string(), message: z.string().max(4000), saved: savedIdsSchema.optional() })
  .strict()
  .refine((error) => (MAC_CALENDAR_HELPER_REASONS[error.code] as readonly string[]).includes(error.reason), '"reason" fora da lista do "code"')
  .refine((error) => error.saved === undefined || error.reason === 'eventkit', '"saved" só com unavailable/eventkit')
  .transform(({ saved, ...error }) => ({ ...error, reason: error.reason as MacCalendarErrorReason, ...(saved ? { saved } : {}) }))

export const errorResponseSchema = z.object({ v: z.literal(1), id: idSchema.nullable(), ok: z.literal(false), error: helperErrorSchema }).strict()

/** O envelope da resposta de sucesso; o `result` passa depois pelo esquema do comando (MAC_CALENDAR_RESULT_SCHEMAS). */
const successEnvelopeSchema = z.object({ v: z.literal(1), id: idSchema, ok: z.literal(true), result: z.unknown() }).strict()

export interface MacCalendarError {
  code: MacCalendarErrorCode
  reason: MacCalendarErrorReason
  message: string
  /** Só quando algo ficou gravado apesar do erro (ver `savedIdsSchema`). */
  saved?: MacCalendarSavedIds
}

export type MacCalendarOutcome<T> = { ok: true; value: T } | { ok: false; error: MacCalendarError }

/** Lê uma linha do stdout como resposta a `cmd`; `null` fora do formato (o cliente devolve `bad-response`). */
export function parseMacCalendarResponse<K extends MacCalendarCmd>(cmd: K, raw: unknown): { id: string | null; outcome: MacCalendarOutcome<MacCalendarResults[K]> } | null {
  const envelope = successEnvelopeSchema.safeParse(raw)
  if (envelope.success) {
    const result = MAC_CALENDAR_RESULT_SCHEMAS[cmd].safeParse(envelope.data.result)
    return result.success ? { id: envelope.data.id, outcome: { ok: true, value: result.data as MacCalendarResults[K] } } : null
  }
  const failure = errorResponseSchema.safeParse(raw)
  if (failure.success) return { id: failure.data.id, outcome: { ok: false, error: failure.data.error } }
  return null
}
