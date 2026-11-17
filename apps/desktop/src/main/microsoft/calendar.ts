// Agenda Microsoft (contrato 12, CA4) pelo Graph, só leitura (`Calendars.Read`): a lista das agendas e o
// `calendarView` de uma janela de tempo, com `Prefer: outlook.timezone="UTC"` (os horários chegam em UTC, sem
// fuso no texto). A agenda principal é `/me/calendarView`; outra escolhida, `/me/calendars/<id>/calendarView`. O
// evento cancelado pelo organizador vem com `isCancelled`; o apagado some da leitura.
import { CALENDAR_ATTENDEES_MAX, CALENDAR_TEXT_MAX, DEFAULT_CALENDAR_ID, findJoinUrl, safeJoinUrl, type CalendarEvent, type CalendarListItem, type CalendarResponse } from '../../shared/calendar'
import type { MeetingAttendee } from '../../shared/meetings'
import { allowedUrl, jsonOf, type HttpFetch } from '../accounts/http'
import { CalendarReadError, lookupResponse, type CalendarRead, type EventLookup } from '../google/calendar'
import { GRAPH_BASE } from './account'

const MAX_PAGES = 4
const EVENT_FIELDS = 'id,iCalUId,subject,start,end,isAllDay,isCancelled,responseStatus,attendees,organizer,onlineMeeting,onlineMeetingUrl,location,bodyPreview'

const text = (value: unknown, max = CALENDAR_TEXT_MAX): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

async function getJson(fetch: HttpFetch, url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json', prefer: 'outlook.timezone="UTC"' } })
  if (response.status === 401 || response.status === 403) throw new CalendarReadError('auth')
  const body = (await jsonOf(response)) as Record<string, unknown> | null
  if (response.status !== 200 || !body || typeof body !== 'object') throw new CalendarReadError('server')
  return body
}

/** As agendas da conta; a principal vem como `default`, o mesmo id que a leitura usa quando a pessoa não escolheu. */
export async function listMicrosoftCalendars(fetch: HttpFetch, token: string): Promise<CalendarListItem[]> {
  const body = await getJson(fetch, `${GRAPH_BASE}/me/calendars?$select=id,name,isDefaultCalendar&$top=100`, token)
  const items = Array.isArray(body['value']) ? (body['value'] as Record<string, unknown>[]) : []
  return items
    .filter((item) => typeof item['id'] === 'string' && item['id'])
    .map((item) => {
      const primary = item['isDefaultCalendar'] === true
      return { provider: 'microsoft' as const, id: primary ? DEFAULT_CALENDAR_ID.microsoft : String(item['id']), name: text(item['name']) || 'Calendário', primary }
    })
}

/** `2026-11-17T13:00:00.0000000` com `timeZone: "UTC"` vira ISO com `Z`. */
function instantOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const { dateTime, timeZone } = value as { dateTime?: unknown; timeZone?: unknown }
  if (typeof dateTime !== 'string') return null
  const utc = typeof timeZone === 'string' && timeZone.toUpperCase() !== 'UTC' ? dateTime : /(Z|[+-]\d{2}:\d{2})$/.test(dateTime) ? dateTime : `${dateTime}Z`
  const ms = Date.parse(utc)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

const RESPONSES: Readonly<Record<string, CalendarResponse>> = {
  organizer: 'accepted',
  accepted: 'accepted',
  tentativelyAccepted: 'tentative',
  declined: 'declined',
  none: 'none',
  notResponded: 'none',
}

const addressOf = (entry: unknown): { name: string; email: string } | null => {
  const address = (entry as { emailAddress?: { name?: unknown; address?: unknown } } | undefined)?.emailAddress
  if (!address) return null
  return { name: text(address.name), email: text(address.address) }
}

/** Um evento do Graph no formato comum. `me` é o e-mail da conta: a própria pessoa não entra nos participantes. */
export function normalizeMicrosoftEvent(raw: unknown, calendarId: string, me: string | null): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = typeof item['id'] === 'string' ? item['id'].slice(0, 1024) : ''
  const start = instantOf(item['start'])
  const end = instantOf(item['end'])
  if (!id || !start || !end) return null
  const mine = (me ?? '').toLowerCase()
  const isMe = (email: string): boolean => mine !== '' && email.toLowerCase() === mine
  const people = Array.isArray(item['attendees']) ? (item['attendees'] as Record<string, unknown>[]) : []
  const attendees: MeetingAttendee[] = []
  const add = (person: { name: string; email: string } | null): void => {
    if (!person || (!person.name && !person.email) || isMe(person.email)) return
    if (person.email && attendees.some((known) => known.email.toLowerCase() === person.email.toLowerCase())) return
    if (attendees.length < CALENDAR_ATTENDEES_MAX) attendees.push(person)
  }
  // O organizador (quando é outra pessoa) primeiro; salas (`resource`) ficam de fora.
  add(addressOf(item['organizer']))
  for (const person of people) if (person['type'] !== 'resource') add(addressOf(person))
  const location = (item['location'] as { displayName?: unknown } | undefined)?.displayName
  const joinUrl =
    safeJoinUrl((item['onlineMeeting'] as { joinUrl?: unknown } | null | undefined)?.joinUrl) ??
    safeJoinUrl(item['onlineMeetingUrl']) ??
    findJoinUrl(typeof location === 'string' ? location : null, typeof item['bodyPreview'] === 'string' ? item['bodyPreview'] : null)
  return {
    provider: 'microsoft',
    calendarId,
    id,
    title: text(item['subject']) || 'Sem título',
    start,
    end,
    allDay: item['isAllDay'] === true,
    status: item['isCancelled'] === true ? 'cancelled' : 'confirmed',
    myResponse: RESPONSES[String((item['responseStatus'] as { response?: unknown } | undefined)?.response ?? '')] ?? 'none',
    attendees,
    joinUrl,
    uid: typeof item['iCalUId'] === 'string' && item['iCalUId'] ? item['iCalUId'].slice(0, 1024) : null,
  }
}

/** O `calendarView` de uma agenda entre `from` e `to` (ms). `default` é a principal. */
export async function readMicrosoftEvents(fetch: HttpFetch, token: string, calendarId: string, from: number, to: number, me: string | null): Promise<CalendarRead> {
  const path = calendarId === DEFAULT_CALENDAR_ID.microsoft ? '/me/calendarView' : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
  const first = new URL(`${GRAPH_BASE}${path}`)
  first.searchParams.set('startDateTime', new Date(from).toISOString())
  first.searchParams.set('endDateTime', new Date(to).toISOString())
  first.searchParams.set('$top', '250')
  first.searchParams.set('$select', EVENT_FIELDS)
  const events: CalendarEvent[] = []
  let next: string | null = first.toString()
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const body = await getJson(fetch, next, token)
    for (const raw of Array.isArray(body['value']) ? (body['value'] as unknown[]) : []) {
      const event = normalizeMicrosoftEvent(raw, calendarId, me)
      if (event) events.push(event)
    }
    const link = body['@odata.nextLink']
    // A próxima página só se for o mesmo Graph (o token nunca vai para outro lugar).
    next = typeof link === 'string' && allowedUrl(link) && new URL(link).hostname === 'graph.microsoft.com' ? link : null
  }
  return { events, cancelledIds: [] }
}

/** Busca de um evento avisado que sumiu da leitura (CA8): `/me/events/<id>`; 404 é apagado. */
export async function lookupMicrosoftEvent(fetch: HttpFetch, token: string, calendarId: string, id: string, me: string | null): Promise<EventLookup> {
  const url = new URL(`${GRAPH_BASE}/me/events/${encodeURIComponent(id)}`)
  url.searchParams.set('$select', EVENT_FIELDS)
  const response = await fetch(url.toString(), { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json', prefer: 'outlook.timezone="UTC"' } })
  return lookupResponse(response, (raw) => normalizeMicrosoftEvent(raw, calendarId, me))
}
