// Agenda Google (contrato 12, CA4): a lista das agendas da conta e os eventos de uma agenda numa janela de tempo,
// só leitura (`calendar.readonly`). `singleEvents=true` abre as recorrências em ocorrências, `orderBy=startTime`
// ordena, e `showDeleted=true` traz os cancelados (às vezes só com o id e o status: o serviço completa com o que
// já tinha lido). O evento sai no formato comum de `shared/calendar.ts`.
import { CALENDAR_ATTENDEES_MAX, CALENDAR_TEXT_MAX, findJoinUrl, safeJoinUrl, type CalendarEvent, type CalendarListItem, type CalendarResponse } from '../../shared/calendar'
import type { MeetingAttendee } from '../../shared/meetings'
import { jsonOf, type HttpFetch, type HttpResponse } from '../accounts/http'

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
/** Páginas lidas por agenda (250 eventos cada). */
const MAX_PAGES = 4

/** Erro da leitura: `auth` (401/403, o token não vale para a agenda) ou `server` (outro status). */
export class CalendarReadError extends Error {
  constructor(readonly kind: 'auth' | 'server') {
    super(`agenda: ${kind}`)
    this.name = 'CalendarReadError'
  }
}

/** O que a leitura de uma agenda devolve: os eventos e os ids dos cancelados que vieram sem horário. */
export interface CalendarRead {
  events: CalendarEvent[]
  /** Ids (sem a agenda) de eventos cancelados que vieram só com o id e o status. */
  cancelledIds: string[]
}

const text = (value: unknown, max = CALENDAR_TEXT_MAX): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

async function getJson(fetch: HttpFetch, url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  if (response.status === 401 || response.status === 403) throw new CalendarReadError('auth')
  const body = (await jsonOf(response)) as Record<string, unknown> | null
  if (response.status !== 200 || !body || typeof body !== 'object') throw new CalendarReadError('server')
  return body
}

/** As agendas da conta. A principal vem como `primary`, o mesmo id que a leitura usa quando a pessoa não escolheu. */
export async function listGoogleCalendars(fetch: HttpFetch, token: string): Promise<CalendarListItem[]> {
  const body = await getJson(fetch, `${GOOGLE_CALENDAR_API}/users/me/calendarList?maxResults=100`, token)
  const items = Array.isArray(body['items']) ? (body['items'] as Record<string, unknown>[]) : []
  return items
    .filter((item) => typeof item['id'] === 'string' && item['id'])
    .map((item) => {
      const primary = item['primary'] === true
      return { provider: 'google' as const, id: primary ? 'primary' : String(item['id']), name: text(item['summaryOverride']) || text(item['summary']) || String(item['id']), primary }
    })
}

/** Instante do início ou do fim: `dateTime` (com fuso) ou `date` (dia inteiro, meia-noite local). */
function instantOf(value: unknown): { iso: string; allDay: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const { dateTime, date } = value as { dateTime?: unknown; date?: unknown }
  if (typeof dateTime === 'string' && !Number.isNaN(Date.parse(dateTime))) return { iso: new Date(dateTime).toISOString(), allDay: false }
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { iso: new Date(`${date}T00:00:00`).toISOString(), allDay: true }
  return null
}

const RESPONSES: Readonly<Record<string, CalendarResponse>> = { accepted: 'accepted', tentative: 'tentative', declined: 'declined', needsAction: 'none' }

/** Um evento da API no formato comum; `null` sem horário (cancelado só com o id) ou sem id. */
export function normalizeGoogleEvent(raw: unknown, calendarId: string): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = typeof item['id'] === 'string' ? item['id'].slice(0, 1024) : ''
  const start = instantOf(item['start'])
  const end = instantOf(item['end'])
  if (!id || !start || !end) return null
  const people = Array.isArray(item['attendees']) ? (item['attendees'] as Record<string, unknown>[]) : []
  const self = people.find((person) => person['self'] === true)
  const attendees: MeetingAttendee[] = people
    .filter((person) => person['self'] !== true && person['resource'] !== true && (typeof person['email'] === 'string' || typeof person['displayName'] === 'string'))
    .slice(0, CALENDAR_ATTENDEES_MAX)
    .map((person) => ({ name: text(person['displayName']), email: text(person['email']) }))
  const entryPoints = (item['conferenceData'] as { entryPoints?: unknown } | undefined)?.entryPoints
  const video = Array.isArray(entryPoints) ? (entryPoints as Record<string, unknown>[]).find((entry) => entry['entryPointType'] === 'video') : undefined
  const joinUrl = safeJoinUrl(item['hangoutLink']) ?? safeJoinUrl(video?.['uri']) ?? findJoinUrl(typeof item['location'] === 'string' ? item['location'] : null, typeof item['description'] === 'string' ? item['description'] : null)
  return {
    provider: 'google',
    calendarId,
    id,
    title: text(item['summary']) || 'Sem título',
    start: start.iso,
    end: end.iso,
    allDay: start.allDay,
    status: item['status'] === 'cancelled' ? 'cancelled' : 'confirmed',
    myResponse: RESPONSES[String(self?.['responseStatus'] ?? '')] ?? 'none',
    attendees,
    joinUrl,
    uid: typeof item['iCalUID'] === 'string' && item['iCalUID'] ? item['iCalUID'].slice(0, 1024) : null,
  }
}

/** Os eventos de uma agenda entre `from` e `to` (ms), com os cancelados. */
export async function readGoogleEvents(fetch: HttpFetch, token: string, calendarId: string, from: number, to: number): Promise<CalendarRead> {
  const events: CalendarEvent[] = []
  const cancelledIds: string[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('showDeleted', 'true')
    url.searchParams.set('timeMin', new Date(from).toISOString())
    url.searchParams.set('timeMax', new Date(to).toISOString())
    url.searchParams.set('maxResults', '250')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const body = await getJson(fetch, url.toString(), token)
    for (const raw of Array.isArray(body['items']) ? (body['items'] as unknown[]) : []) {
      const event = normalizeGoogleEvent(raw, calendarId)
      if (event) events.push(event)
      else if (raw && typeof raw === 'object' && (raw as { status?: unknown }).status === 'cancelled' && typeof (raw as { id?: unknown }).id === 'string') cancelledIds.push((raw as { id: string }).id)
    }
    pageToken = typeof body['nextPageToken'] === 'string' ? body['nextPageToken'] : null
    if (!pageToken) break
  }
  return { events, cancelledIds }
}

/**
 * Busca de um evento avisado que sumiu da leitura ou veio cancelado (contrato 12, CA8): `cancelled` só com
 * `status: cancelled`, 404 ou 410; `found` com o evento (remarcado ou movido, nada de "cancelada"); `unknown` quando
 * não deu para saber (o serviço não avisa e tenta na próxima leitura).
 */
export type EventLookup = { kind: 'cancelled' } | { kind: 'found'; event: CalendarEvent } | { kind: 'unknown' }

/** Resposta da busca de um evento: 404/410 é apagado; 401/403 vira `auth` (o serviço renova o token e tenta de novo). */
export async function lookupResponse(response: HttpResponse, normalize: (raw: unknown) => CalendarEvent | null): Promise<EventLookup> {
  if (response.status === 404 || response.status === 410) return { kind: 'cancelled' }
  if (response.status === 401 || response.status === 403) throw new CalendarReadError('auth')
  if (response.status !== 200) return { kind: 'unknown' }
  const body = await jsonOf(response)
  if (body && typeof body === 'object' && (body as { status?: unknown }).status === 'cancelled') return { kind: 'cancelled' }
  const event = normalize(body)
  if (!event) return { kind: 'unknown' }
  return event.status === 'cancelled' ? { kind: 'cancelled' } : { kind: 'found', event }
}

export async function lookupGoogleEvent(fetch: HttpFetch, token: string, calendarId: string, id: string): Promise<EventLookup> {
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`
  const response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  return lookupResponse(response, (raw) => normalizeGoogleEvent(raw, calendarId))
}
