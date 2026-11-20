// Contrato 62 (convites-agenda): o mapeamento puro entre o convite do email (contrato 59), o registro do app
// (store.ts) e o protocolo do `lap-calendar` (contrato 60): os argumentos do `create` e do `update` (R4, N8, N11), as
// mudanças do cartão (R6), o `kind` e as ações (R7), a conta que já põe sozinha (R5b) e os erros do helper nas frases
// fixas (CA17). Nada de processo, disco ou relógio aqui.
import type { EmailAccount } from '../../shared/email'
import { compareInviteVersion, type EmailInvite } from '../../shared/invite'
import {
  INVITE_ERROR_MESSAGES,
  type InviteCalendarOption,
  type InviteCalendarStatus,
  type InviteChange,
  type InviteErrorCode,
  type InviteKind,
  type InviteState,
  type InviteWhen,
} from '../../shared/invite-state'
import {
  MAC_CALENDAR_MAX_EXDATES,
  MAC_CALENDAR_MAX_LOCATION,
  MAC_CALENDAR_MAX_NOTES,
  MAC_CALENDAR_MAX_TITLE,
  MAC_CALENDAR_MAX_URL,
  type MacCalendarCalendar,
  type MacCalendarCreateArgs,
  type MacCalendarError,
  type MacCalendarRecurrence,
  type MacCalendarUpdateArgs,
} from '../mac-calendar/protocol'
import type { InviteEventRef, InviteRecord } from './store'

/** R5b: os servidores IMAP de conta que põe o convite na agenda dela sozinha (Google e Microsoft). */
export const INVITE_SELF_ADDING_HOSTS = ['imap.gmail.com', 'outlook.office365.com'] as const

export function inviteSelfAdding(account: Pick<EmailAccount, 'incoming'>): boolean {
  const host = account.incoming.host.trim().toLowerCase().replace(/\.+$/, '')
  return (INVITE_SELF_ADDING_HOSTS as readonly string[]).includes(host)
}

/** Tira a fração de segundo de um instante (`…T18:00:00.000Z` → `…T18:00:00Z`); data fica como está. */
export function normalizeWhen(text: string): string {
  return text.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z$/, '$1Z')
}

/** Corta em `max` unidades UTF-16 sem partir par substituto. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

const titleOf = (invite: EmailInvite): string => clipText(invite.title, MAC_CALENDAR_MAX_TITLE) || '(sem título)'
const locationOf = (invite: EmailInvite): string | null => (invite.location === null ? null : clipText(invite.location, MAC_CALENDAR_MAX_LOCATION))
const timeZoneOf = (invite: EmailInvite): string | null => (invite.allDay ? null : invite.timeZone)

/** O link da reunião como URL do evento: só `http:`/`https:` com host, dentro do limite do helper. */
export function urlOf(invite: Pick<EmailInvite, 'joinUrl'>): string | null {
  const link = invite.joinUrl
  if (!link || link.length > MAC_CALENDAR_MAX_URL) return null
  try {
    const url = new URL(link)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? link : null
  } catch {
    return null
  }
}

/** R4: link + linha em branco + descrição, texto puro, até 4000 caracteres. */
export function notesOf(invite: Pick<EmailInvite, 'joinUrl' | 'description'>): string {
  return clipText([invite.joinUrl, invite.description].filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n\n'), MAC_CALENDAR_MAX_NOTES)
}

/** N8: a regra que o `EKRecurrenceRule` grava; `undefined` quando o convite não repete ou a repetição não é gravável. */
export function recurrenceOf(invite: EmailInvite): MacCalendarRecurrence | undefined {
  const rule = invite.recurrence?.storable === true ? invite.recurrence.rule : null
  if (!rule) return undefined
  const freq = rule.freq.toLowerCase()
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') return undefined
  return {
    freq,
    interval: rule.interval,
    ...(rule.count !== null ? { count: rule.count } : {}),
    ...(rule.until !== null ? { until: normalizeWhen(rule.until) } : {}),
    ...(rule.byDay.length ? { byDay: rule.byDay.map((entry) => (entry.pos === null ? { day: entry.day } : { day: entry.day, pos: entry.pos })) } : {}),
    ...(rule.byMonthDay.length ? { byMonthDay: rule.byMonthDay } : {}),
    ...(rule.byMonth.length ? { byMonth: rule.byMonth } : {}),
    ...(rule.bySetPos.length ? { bySetPos: rule.bySetPos } : {}),
    ...(rule.weekStart !== null ? { weekStart: rule.weekStart } : {}),
  }
}

/** Os EXDATE mais as ocorrências canceladas das exceções, sem repetição, até o limite do helper. */
export function exdatesOf(invite: EmailInvite): string[] {
  const list = [...(invite.recurrence?.exdates ?? []), ...invite.exceptions.filter((item) => item.cancelled).map((item) => item.recurrenceId)].map(normalizeWhen)
  return [...new Set(list)].slice(0, MAC_CALENDAR_MAX_EXDATES)
}

/** CA4: o convite como `create` do helper. */
export function createArgs(invite: EmailInvite, calendarId: string, availability: 'busy' | 'tentative'): MacCalendarCreateArgs {
  const location = locationOf(invite)
  const url = urlOf(invite)
  const notes = notesOf(invite)
  const recurrence = recurrenceOf(invite)
  const exdates = recurrence ? exdatesOf(invite) : []
  return {
    calendarId,
    title: titleOf(invite),
    start: invite.start,
    end: invite.end,
    allDay: invite.allDay,
    timeZone: timeZoneOf(invite),
    ...(location !== null ? { location } : {}),
    ...(url !== null ? { url } : {}),
    ...(notes ? { notes } : {}),
    availability,
    ...(recurrence ? { recurrence } : {}),
    ...(exdates.length ? { exdates } : {}),
  }
}

/**
 * CA5: todos os campos do CA4 para o `update`, com a disponibilidade já gravada. Sem `recurrenceId`, também a
 * repetição (ou `null`, se o convite não repete mais) e os EXDATE. A URL só vai quando há: o protocolo não apaga.
 */
export function updateFields(invite: EmailInvite, ref: Pick<InviteEventRef, 'availability'>): MacCalendarUpdateArgs['fields'] {
  const url = urlOf(invite)
  const fields: MacCalendarUpdateArgs['fields'] = {
    title: titleOf(invite),
    start: invite.start,
    end: invite.end,
    allDay: invite.allDay,
    timeZone: timeZoneOf(invite),
    location: locationOf(invite) ?? '',
    notes: notesOf(invite),
    availability: ref.availability,
    ...(url !== null ? { url } : {}),
  }
  if (invite.recurrenceId === null) {
    const recurrence = recurrenceOf(invite)
    fields.recurrence = recurrence ?? null
    const exdates = recurrence ? exdatesOf(invite) : []
    if (exdates.length) fields.exdates = exdates
  }
  return fields
}

/** Os campos do convite como ficam guardados no `event` do registro (a comparação do CA5 usa os mesmos). */
export function refFields(invite: EmailInvite): Pick<InviteEventRef, 'title' | 'start' | 'end' | 'allDay' | 'timeZone' | 'location' | 'url' | 'sequence' | 'dtstamp'> {
  return {
    title: titleOf(invite),
    start: normalizeWhen(invite.start),
    end: normalizeWhen(invite.end),
    allDay: invite.allDay,
    timeZone: timeZoneOf(invite),
    location: locationOf(invite),
    url: urlOf(invite),
    sequence: invite.sequence,
    dtstamp: invite.dtstamp,
  }
}

/** CA5: o que mudou entre o evento gravado e o convite novo, na ordem horário, título, local, link. */
export function changesOf(ref: InviteEventRef, invite: EmailInvite): InviteChange[] {
  const next = refFields(invite)
  const changes: InviteChange[] = []
  const before: InviteWhen = { start: ref.start, end: ref.end, allDay: ref.allDay, timeZone: ref.timeZone }
  const after: InviteWhen = { start: next.start, end: next.end, allDay: next.allDay, timeZone: next.timeZone }
  if (before.start !== after.start || before.end !== after.end || before.allDay !== after.allDay || before.timeZone !== after.timeZone) changes.push({ field: 'time', before, after })
  if (ref.title !== next.title) changes.push({ field: 'title', before: ref.title, after: next.title })
  if (ref.location !== next.location) changes.push({ field: 'location', before: ref.location, after: next.location })
  if (ref.url !== next.url) changes.push({ field: 'url', before: ref.url, after: next.url })
  return changes
}

/** CA17: o erro do cliente do Calendário no código do serviço. */
export function errorCodeOf(error: Pick<MacCalendarError, 'code' | 'reason'>): InviteErrorCode {
  switch (error.code) {
    case 'denied':
      return 'denied'
    case 'restricted':
      return 'restricted'
    case 'not-found':
      return error.reason === 'calendar' ? 'no-calendar' : 'not-found'
    case 'invalid':
      return error.reason === 'read-only-calendar' ? 'read-only-calendar' : error.reason === 'recurrence' ? 'recurrence' : 'invalid'
    default:
      return ['platform', 'no-binary', 'dev', 'gave-up', 'disposed'].includes(error.reason) ? 'unavailable' : 'failed'
  }
}

/** R9 (CA13): a agenda da configuração se ainda está na lista; senão a padrão gravável; senão a primeira. */
export function defaultCalendarOf(calendars: readonly Pick<MacCalendarCalendar, 'id' | 'writable' | 'isDefault'>[], preferred: string | null): string | null {
  const writable = calendars.filter((item) => item.writable)
  if (preferred !== null && writable.some((item) => item.id === preferred)) return preferred
  return (writable.find((item) => item.isDefault) ?? writable[0])?.id ?? null
}

export function calendarOption(calendar: MacCalendarCalendar): InviteCalendarOption {
  return { id: calendar.id, title: calendar.title, sourceTitle: calendar.sourceTitle, sourceType: calendar.sourceType, isDefault: calendar.isDefault }
}

export interface StateInput {
  accountId: string
  id: string
  account: Pick<EmailAccount, 'incoming'>
  invite: EmailInvite
  /** A linha da chave (a da ocorrência, com `recurrenceId`). */
  record: InviteRecord | null
  /** O evento do app achado na agenda (o dono do CA12), para as mudanças. */
  ref: InviteEventRef | null
  old: boolean
  calendar: InviteCalendarStatus
  defaultCalendarId: string | null
  addOnAccept: boolean
  notice: 'merged' | null
}

const ADDABLE: readonly InviteCalendarStatus['status'][] = ['absent', 'needs-access', 'missing']

/** CA9: o `kind`, as ações e o resto do estado do cartão. */
export function buildState(input: StateInput): InviteState {
  const { invite, calendar, record } = input
  const method = invite.method
  const recurrenceBlocked = invite.recurrence !== null && !invite.recurrence.storable
  const appFound = calendar.status === 'app' && input.ref !== null
  const pending = method === 'REQUEST' && appFound && input.ref !== null && compareInviteVersion(invite, input.ref) > 0
  const response = method !== 'REPLY' && record?.response ? { partstat: record.response, at: record.respondedAt ?? record.seenAt } : null
  let kind: InviteKind
  if (method === 'REPLY') kind = 'reply-received'
  else if (input.old) kind = 'old'
  else if (method === 'CANCEL' || invite.status === 'CANCELLED') kind = 'cancelled'
  else if (calendar.status === 'error') kind = 'error'
  else if (pending) kind = 'update-pending'
  else if (calendar.status === 'app' || (calendar.status === 'account' && calendar.merged)) kind = 'in-calendar'
  else if (calendar.status === 'account') kind = 'already-in-calendar'
  else if (response) kind = 'responded'
  else kind = 'new'
  const selfAdding = inviteSelfAdding(input.account)
  const replier = method === 'REPLY' ? (invite.attendees[0] ?? null) : null
  return {
    accountId: input.accountId,
    id: input.id,
    uid: invite.uid,
    recurrenceId: invite.recurrenceId === null ? null : normalizeWhen(invite.recurrenceId),
    method,
    kind,
    response,
    calendar,
    changes: kind === 'update-pending' && input.ref ? changesOf(input.ref, invite) : [],
    addDefault: input.addOnAccept && !selfAdding,
    addHint: selfAdding ? 'account-adds' : null,
    defaultCalendarId: input.defaultCalendarId,
    replyable: method === 'REQUEST' && invite.organizer !== null && invite.self !== null && kind !== 'old' && kind !== 'cancelled',
    notForMe: invite.self === null,
    recurrenceBlocked,
    replier: replier ? { name: replier.name, address: replier.address, partstat: replier.partstat } : null,
    notice: input.notice,
    actions: {
      add: method === 'REQUEST' && kind !== 'old' && kind !== 'cancelled' && !recurrenceBlocked && ADDABLE.includes(calendar.status),
      update: kind === 'update-pending' && calendar.status === 'app' && !recurrenceBlocked,
      remove: calendar.status === 'app' && (method === 'CANCEL' || method === 'REQUEST'),
      openIcs: method === 'REQUEST' && kind !== 'old' && (calendar.status === 'unavailable' || calendar.status === 'no-access' || recurrenceBlocked),
      requestAccess: calendar.status === 'needs-access',
      openSettings: calendar.status === 'no-access',
    },
    error: kind === 'error' && calendar.status === 'error' ? { code: calendar.code, message: INVITE_ERROR_MESSAGES[calendar.code] } : null,
  }
}
