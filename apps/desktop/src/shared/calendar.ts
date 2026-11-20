// Agendas Google e Microsoft (contrato 12): o evento normalizado que o main lê das duas APIs, o que conta como
// reunião para os avisos, os textos das notificações e o que o renderer vê (próximas reuniões e a faixa "não está
// sendo gravada"). Nenhum token passa por aqui; o renderer nunca recebe o endereço da chamada, só se ele existe.
import type { MeetingAttendee, MeetingCalendar } from './meetings'

export const CALENDAR_PROVIDERS = ['google', 'microsoft'] as const
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number]
export const CALENDAR_PROVIDER_LABELS: Readonly<Record<CalendarProvider, string>> = { google: 'Google', microsoft: 'Microsoft' }

export type CalendarEventStatus = 'confirmed' | 'cancelled'
export type CalendarResponse = 'accepted' | 'tentative' | 'declined' | 'none'

/** Participantes guardados por evento (e na reunião). */
export const CALENDAR_ATTENDEES_MAX = 50
export const CALENDAR_TEXT_MAX = 200

/** Agenda principal de cada conta quando a pessoa não escolheu outras (Google `primary`, Microsoft `/me/calendarView`). */
export const DEFAULT_CALENDAR_ID: Readonly<Record<CalendarProvider, string>> = { google: 'primary', microsoft: 'default' }

/** Evento da agenda (CA5), o mesmo para as duas contas. Horários em ISO 8601 (UTC). */
export interface CalendarEvent {
  provider: CalendarProvider
  calendarId: string
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  status: CalendarEventStatus
  myResponse: CalendarResponse
  /** Os outros convidados (sem a própria pessoa e sem sala), até 50. */
  attendees: MeetingAttendee[]
  /** Meet, Teams ou Zoom; só `https://`. */
  joinUrl: string | null
  /**
   * `iCalUID` (Google) ou `iCalUId` (Microsoft): o mesmo convite em duas agendas tem o mesmo. Fora da lista do CA5;
   * só serve para não avisar duas vezes nem mostrar a mesma reunião em duas linhas.
   */
  uid: string | null
}

/** Chave única do evento: provedor, agenda e id. */
export function eventKey(event: Pick<CalendarEvent, 'provider' | 'calendarId' | 'id'>): string {
  return `${event.provider}:${event.calendarId}:${event.id}`
}

/** O mesmo evento em duas agendas (ou nas duas contas): o `uid` do convite; sem ele, o título e o início. */
export function dedupeKey(event: Pick<CalendarEvent, 'uid' | 'title' | 'start'>): string {
  return event.uid ? `uid:${event.uid.toLowerCase()}` : `titulo:${event.title.trim().toLowerCase()}|${event.start}`
}

/**
 * Uma cópia por evento (CA6, CA10): fica a confirmada e, entre elas, a que tem link de chamada; no empate, a
 * primeira lida.
 */
export function dedupeEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  const best = new Map<string, CalendarEvent>()
  const rank = (event: CalendarEvent): number => (event.status === 'confirmed' ? 2 : 0) + (event.joinUrl ? 1 : 0)
  for (const event of events) {
    const key = dedupeKey(event)
    const known = best.get(key)
    if (!known || rank(event) > rank(known)) best.set(key, event)
  }
  return [...best.values()]
}

/** Conta como reunião para os avisos: não é dia inteiro, não foi recusada e tem outra pessoa ou link de chamada. */
export function isMeetingEvent(event: Pick<CalendarEvent, 'allDay' | 'myResponse' | 'attendees' | 'joinUrl'>): boolean {
  return !event.allDay && event.myResponse !== 'declined' && (event.attendees.length > 0 || event.joinUrl !== null)
}

/** Endereço de chamada aceito: só `https://`, sem usuário e com até 2048 caracteres. */
export function safeJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

/** Links de chamada que o app reconhece no local ou na descrição do evento. */
const JOIN_URL_PATTERN = /https:\/\/(?:meet\.google\.com\/[\w-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+|teams\.microsoft\.com\/meet\/\d+(?:\?p=[\w-]+)?|teams\.live\.com\/meet\/[^\s<>"']+|(?:[\w-]+\.)*zoom\.us\/(?:j|my|w)\/[^\s<>"']+)/i

/** Primeiro link de Meet, Teams ou Zoom nos textos (local, descrição). */
export function findJoinUrl(...texts: readonly (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (typeof text !== 'string') continue
    const found = JOIN_URL_PATTERN.exec(text)?.[0]
    const url = found ? safeJoinUrl(found.replace(/[).,;]+$/, '')) : null
    if (url) return url
  }
  return null
}

const startMs = (event: Pick<CalendarEvent, 'start'>): number => Date.parse(event.start)
const endMs = (event: Pick<CalendarEvent, 'end'>): number => Date.parse(event.end)

/** Antes do começo da gravação: um evento-reunião que começa em até 10 min ou que está acontecendo. */
export const RECORDING_MATCH_AHEAD_MS = 10 * 60_000

/**
 * O evento da gravação que começa agora (CA9): reunião confirmada que começa em até 10 min ou está acontecendo; o
 * mais próximo do agora e, no empate, o que tem link de chamada.
 */
export function matchRecordingEvent(events: readonly CalendarEvent[], now: number): CalendarEvent | null {
  const candidates = events.filter((event) => {
    if (event.status !== 'confirmed' || !isMeetingEvent(event)) return false
    const start = startMs(event)
    const end = endMs(event)
    return start - now <= RECORDING_MATCH_AHEAD_MS && end > now
  })
  candidates.sort((a, b) => Math.abs(startMs(a) - now) - Math.abs(startMs(b) - now) || Number(b.joinUrl !== null) - Number(a.joinUrl !== null))
  return candidates[0] ?? null
}

/** O que a reunião gravada guarda do evento. */
export function meetingCalendarOf(event: CalendarEvent): MeetingCalendar {
  return { provider: event.provider, eventId: event.id, title: event.title, start: event.start, end: event.end, attendees: event.attendees.slice(0, CALENDAR_ATTENDEES_MAX), joinUrl: event.joinUrl }
}

/** "Próximas" (CA10): até 3 reuniões das próximas 24 h que ainda não acabaram, da mais cedo para a mais tarde. */
export const UPCOMING_MAX = 3
export const UPCOMING_WINDOW_MS = 24 * 3_600_000

export function upcomingEvents(events: readonly CalendarEvent[], now: number, max = UPCOMING_MAX): CalendarEvent[] {
  return events
    .filter((event) => event.status === 'confirmed' && isMeetingEvent(event) && endMs(event) > now && startMs(event) < now + UPCOMING_WINDOW_MS)
    .sort((a, b) => startMs(a) - startMs(b))
    .slice(0, max)
}

/** Uma reunião da seção "Próximas", sem o endereço da chamada (só se ele existe). */
export interface CalendarUpcoming {
  key: string
  provider: CalendarProvider
  title: string
  start: string
  end: string
  attendees: string[]
  hasJoinUrl: boolean
  /** Já começou (a tela mostra "Agora"). */
  happening: boolean
}

/** A faixa "começou e não está sendo gravada" (CA7). */
export interface CalendarBanner {
  key: string
  title: string
}

/** O que a tela mostra da agenda. `connected`: alguma conta com a agenda liberada. */
export interface CalendarView {
  connected: boolean
  upcoming: CalendarUpcoming[]
  banner: CalendarBanner | null
}

export const EMPTY_CALENDAR_VIEW: CalendarView = Object.freeze({ connected: false, upcoming: [], banner: null }) as CalendarView

/** Nome mostrado de um participante: o nome, ou o e-mail quando não há nome. */
export const attendeeName = (attendee: MeetingAttendee): string => attendee.name.trim() || attendee.email.trim()

export function upcomingView(event: CalendarEvent, now: number): CalendarUpcoming {
  return {
    key: eventKey(event),
    provider: event.provider,
    title: event.title,
    start: event.start,
    end: event.end,
    attendees: event.attendees.map(attendeeName).filter(Boolean),
    hasJoinUrl: event.joinUrl !== null,
    happening: Date.parse(event.start) <= now,
  }
}

/** Uma agenda da conta, para escolher em Configurações › Contas › Agenda. */
export interface CalendarListItem {
  provider: CalendarProvider
  /** `primary` / `default` para a principal. */
  id: string
  name: string
  primary: boolean
}

export interface CalendarListResult {
  calendars: CalendarListItem[]
  /** Contas cuja lista não veio (sem internet, sessão expirada). */
  failed: CalendarProvider[]
}

/** Agendas lidas de uma conta: as escolhidas, ou a principal quando a pessoa não escolheu (`null`). */
export function selectedCalendars(provider: CalendarProvider, chosen: readonly string[] | null): string[] {
  return chosen === null ? [DEFAULT_CALENDAR_ID[provider]] : [...chosen]
}

// ---------------------------------------------------------------------------------------------------------
// Notificações (CA6, CA7, CA8).

export type CalendarNoticeKind = 'before' | 'not-recording' | 'cancelled'

/** O que o agendador dos avisos pede ao main para mostrar. O texto sai de `calendarNoticeText`. */
export interface CalendarNotice {
  kind: CalendarNoticeKind
  key: string
  title: string
  start: string
  attendees: string[]
  /** "Reunião em N min". */
  minutes: number
  /** Cancelada com a gravação deste evento em andamento: "A gravação continua." */
  recording: boolean
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** "14:05", no fuso do Mac. */
export function clockLabel(iso: string): string {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Até 3 nomes e "+N" para o resto. */
export function shortAttendees(names: readonly string[], shown = 3): string {
  const clean = names.map((name) => name.trim()).filter(Boolean)
  const rest = clean.length - shown
  return `${clean.slice(0, shown).join(', ')}${rest > 0 ? ` +${rest}` : ''}`
}

/** Notificação sem nada da reunião com o app bloqueado (contrato 22): nem título, nem hora, nem participantes. */
export const LOCKED_NOTICE_TEXT: Readonly<Record<CalendarNoticeKind, string>> = {
  before: 'Você tem uma reunião da agenda em breve.',
  'not-recording': 'Uma reunião da agenda começou e não está sendo gravada.',
  cancelled: 'Uma reunião da agenda foi cancelada.',
}

export function notRecordingText(title: string): string {
  return `A reunião "${title}" começou e não está sendo gravada.`
}

export function cancelledText(title: string, start: string, recording: boolean): string {
  return `A reunião "${title}" das ${clockLabel(start)} foi cancelada.${recording ? ' A gravação continua.' : ''}`
}

/** Título, corpo e se a notificação tem "Gravar". Bloqueado, só o nome do app e uma frase sem conteúdo. */
export function calendarNoticeText(notice: CalendarNotice, locked: boolean, appName: string): { title: string; body: string; record: boolean } {
  if (locked) return { title: appName, body: LOCKED_NOTICE_TEXT[notice.kind], record: false }
  switch (notice.kind) {
    case 'before': {
      const names = shortAttendees(notice.attendees)
      return { title: `Reunião em ${notice.minutes} min: ${notice.title}`, body: names ? `${clockLabel(notice.start)} · ${names}` : clockLabel(notice.start), record: true }
    }
    case 'not-recording':
      return { title: appName, body: notRecordingText(notice.title), record: true }
    case 'cancelled':
      return { title: appName, body: cancelledText(notice.title, notice.start, notice.recording), record: false }
  }
}
