// Agendas (contrato 12): junta as agendas Google e Microsoft, lê de agora −1 h a +24 h a cada 5 min, ao abrir o
// app, ao acordar o Mac e ao trocar de conta, e confere os avisos a cada 30 s (`alerts.ts`). Sem internet, usa a
// última leitura, guardada em memória e em `userData/calendar-cache.json` (só os campos do evento, CA5, arquivo
// 0600). Também decide de que evento é a gravação que começa (CA9) e o que a tela mostra ("Próximas" e a faixa).
// Só lê: nenhum convite, resposta ou mensagem sai daqui. Tokens e dados da agenda nunca vão para log.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CALENDAR_ATTENDEES_MAX,
  CALENDAR_PROVIDERS,
  dedupeEvents,
  dedupeKey,
  eventKey,
  matchRecordingEvent,
  meetingCalendarOf,
  selectedCalendars,
  upcomingEvents,
  upcomingView,
  type CalendarBanner,
  type CalendarEvent,
  type CalendarListItem,
  type CalendarListResult,
  type CalendarNotice,
  type CalendarProvider,
  type CalendarView,
} from '../../shared/calendar'
import type { MeetingCalendar } from '../../shared/meetings'
import type { AppSettings } from '../../shared/settings-defaults'
import { guardedFetch, type HttpFetch } from '../accounts/http'
import { CalendarReadError, listGoogleCalendars, lookupGoogleEvent, readGoogleEvents, type CalendarRead, type EventLookup } from '../google/calendar'
import { listMicrosoftCalendars, lookupMicrosoftEvent, readMicrosoftEvents } from '../microsoft/calendar'
import { confirmCancelled, dismissAlert, evaluateAlerts, rescheduled, type AlertMemory } from './alerts'

export const CALENDAR_CACHE_FILE = 'calendar-cache.json'
export const CALENDAR_REFRESH_MS = 5 * 60_000
export const CALENDAR_TICK_MS = 30_000
/** Janela lida (CA4): de agora −1 h a +24 h. */
export const CALENDAR_WINDOW_BEFORE_MS = 3_600_000
export const CALENDAR_WINDOW_AFTER_MS = 24 * 3_600_000
/** "Gravar" de um evento vale para a gravação que começar até este tempo depois. */
export const CALENDAR_PICK_MS = 2 * 60_000

/** A conta, do ponto de vista da agenda. */
export interface CalendarAccount {
  /** Logada, com a sessão valendo e a agenda liberada. */
  hasCalendar(): boolean
  accessToken(force?: boolean): Promise<string>
  email(): string | null
}

export interface CalendarServiceDeps {
  dir: string
  accounts: Readonly<Record<CalendarProvider, CalendarAccount>>
  fetch: HttpFetch
  settings: () => Promise<Pick<AppSettings, 'calendarAlerts' | 'calendarLeadMinutes' | 'calendarNotRecordingAlert' | 'calendarIds'>>
  /** Há gravação em andamento (a sessão do contrato 22). */
  recording: () => boolean
  notify: (notice: CalendarNotice) => void
  /** O que a tela mostra mudou. */
  onView: (view: CalendarView) => void
  now?: () => number
  /** Só contagens e erros, nunca título, participante ou token. */
  log?: (message: string) => void
}

export interface CalendarService {
  /** Lê o cache, faz a primeira leitura e liga os relógios. */
  start(): void
  /** Lê as agendas agora e confere os avisos. */
  refresh(): Promise<void>
  /** Confere os avisos com a última leitura (o relógio andou). */
  tick(): Promise<void>
  view(): CalendarView
  /** As agendas de cada conta, para escolher em Configurações. */
  calendars(): Promise<CalendarListResult>
  /** "Gravar" de um evento (notificação, faixa ou "Próximas"): vale para a próxima gravação. */
  pick(key: unknown): boolean
  /** A gravação começou: o evento dela (o escolhido em "Gravar" ou o que está acontecendo). */
  recordingStarted(): MeetingCalendar | null
  /** O evento da gravação em curso. */
  recordingCalendar(): MeetingCalendar | null
  recordingEnded(): void
  /** "Ignorar" da faixa. */
  dismiss(key: unknown): CalendarView
  /** O link da chamada de um evento (só `https://`). */
  joinUrl(key: unknown): string | null
  /** Uma conta entrou, saiu ou liberou a agenda. */
  accountsChanged(): void
  /** Configurações gravadas: as agendas escolhidas ou os avisos mudaram. */
  settingsChanged(): void
  dispose(): void
}

const attendeeSchema = z.object({ name: z.string().max(200), email: z.string().max(200) })
const eventSchema = z.object({
  provider: z.enum(CALENDAR_PROVIDERS),
  calendarId: z.string().min(1).max(1024),
  id: z.string().min(1).max(1024),
  title: z.string().max(200),
  start: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  end: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  allDay: z.boolean(),
  status: z.enum(['confirmed', 'cancelled']),
  myResponse: z.enum(['accepted', 'tentative', 'declined', 'none']),
  attendees: z.array(attendeeSchema).max(CALENDAR_ATTENDEES_MAX),
  joinUrl: z.string().max(2048).nullable(),
  // Cache de antes do `uid`: carrega sem ele.
  uid: z.string().max(1024).nullable().catch(null),
})
const cacheSchema = z.object({ version: z.literal(1), calendars: z.record(z.string(), z.array(eventSchema)) })

const calendarKey = (provider: CalendarProvider, calendarId: string): string => `${provider}:${calendarId}`

export function createCalendarService(deps: CalendarServiceDeps): CalendarService {
  const now = deps.now ?? Date.now
  const fetch = guardedFetch(deps.fetch)
  const file = join(deps.dir, CALENDAR_CACHE_FILE)
  /** Última leitura boa de cada agenda (`provider:calendarId`). */
  const byCalendar = new Map<string, CalendarEvent[]>()
  const memory = new Map<string, AlertMemory>()
  let banner: CalendarBanner | null = null
  let lastView = ''
  let timers: ReturnType<typeof setInterval>[] = []
  let refreshing: Promise<void> | null = null
  let again = false
  let accountsSignature = ''
  let settingsSignature = ''
  let pending: { event: CalendarEvent; at: number } | null = null
  let recording: { key: string; calendar: MeetingCalendar } | null = null
  let disposed = false

  const connected = (): CalendarProvider[] => CALENDAR_PROVIDERS.filter((provider) => deps.accounts[provider].hasCalendar())
  const signatureOfAccounts = (): string => CALENDAR_PROVIDERS.map((provider) => `${provider}=${deps.accounts[provider].hasCalendar() ? (deps.accounts[provider].email() ?? '') : '-'}`).join('|')

  /** As agendas escolhidas das contas conectadas. */
  async function wanted(): Promise<{ provider: CalendarProvider; calendarId: string }[]> {
    const settings = await deps.settings()
    return connected().flatMap((provider) => selectedCalendars(provider, settings.calendarIds[provider]).map((calendarId) => ({ provider, calendarId })))
  }

  /**
   * Os eventos de agora: só das contas conectadas e das agendas escolhidas, uma cópia por convite (o mesmo evento
   * em duas agendas, ou nas duas contas, é um só: uma notificação, uma linha em "Próximas").
   */
  let wantedKeys = new Set<string>()
  const currentEvents = (): CalendarEvent[] => {
    const providers = new Set(connected())
    const events: CalendarEvent[] = []
    for (const [key, list] of byCalendar) {
      if (!wantedKeys.has(key)) continue
      for (const event of list) if (providers.has(event.provider)) events.push(event)
    }
    return dedupeEvents(events)
  }

  function loadCache(): void {
    if (!existsSync(file)) return
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')) as unknown)
      if (!parsed.success) return
      for (const [key, list] of Object.entries(parsed.data.calendars)) byCalendar.set(key, list)
    } catch {
      // Cache ilegível: a próxima leitura refaz.
    }
  }

  function writeCache(): void {
    const calendars = Object.fromEntries([...byCalendar].filter(([key]) => wantedKeys.has(key)))
    if (!Object.keys(calendars).length) {
      rmSync(file, { force: true })
      return
    }
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(temp, `${JSON.stringify({ version: 1, calendars })}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, file)
    } catch {
      rmSync(temp, { force: true })
    }
  }

  async function readCalendar(provider: CalendarProvider, calendarId: string): Promise<CalendarRead> {
    const account = deps.accounts[provider]
    const from = now() - CALENDAR_WINDOW_BEFORE_MS
    const to = now() + CALENDAR_WINDOW_AFTER_MS
    const read = (token: string): Promise<CalendarRead> =>
      provider === 'google' ? readGoogleEvents(fetch, token, calendarId, from, to) : readMicrosoftEvents(fetch, token, calendarId, from, to, account.email())
    try {
      return await read(await account.accessToken())
    } catch (error) {
      // 401 com o token guardado: renova uma vez e tenta de novo.
      if (error instanceof CalendarReadError && error.kind === 'auth') return read(await account.accessToken(true))
      throw error
    }
  }

  function publish(): void {
    const current = view()
    const serialized = JSON.stringify(current)
    if (serialized === lastView) return
    lastView = serialized
    deps.onView(current)
  }

  /** Uma passada dos avisos; devolve os eventos avisados que sumiram ou vieram cancelados (a confirmar pelo id). */
  async function evaluate(fresh: ReadonlySet<string>, cancelledKeys: ReadonlySet<string>): Promise<string[]> {
    const settings = await deps.settings()
    const active = deps.recording()
    if (!active) recording = null
    const output = evaluateAlerts(
      {
        events: currentEvents(),
        freshCalendars: fresh,
        cancelledKeys,
        now: now(),
        settings: alertSettings(settings),
        recording: recordingState(active),
      },
      memory,
    )
    banner = output.banner
    for (const notice of output.notices) deps.notify(notice)
    publish()
    return output.suspects
  }

  const alertSettings = (settings: Awaited<ReturnType<CalendarServiceDeps['settings']>>) => ({ alerts: settings.calendarAlerts, leadMinutes: settings.calendarLeadMinutes, notRecording: settings.calendarNotRecordingAlert })
  const recordingState = (active: boolean): { active: boolean; eventKey: string | null } => ({ active, eventKey: active ? (recording?.key ?? null) : null })

  /** O evento pelo id, com o token renovado uma vez depois de um 401; falha de rede é `unknown`. */
  async function lookup(entry: AlertMemory): Promise<EventLookup> {
    const account = deps.accounts[entry.provider]
    const ask = (token: string): Promise<EventLookup> =>
      entry.provider === 'google' ? lookupGoogleEvent(fetch, token, entry.calendarId, entry.id) : lookupMicrosoftEvent(fetch, token, entry.calendarId, entry.id, account.email())
    try {
      return await ask(await account.accessToken()).catch(async (error: unknown) => {
        if (error instanceof CalendarReadError && error.kind === 'auth') return ask(await account.accessToken(true))
        throw error
      })
    } catch {
      return { kind: 'unknown' }
    }
  }

  /**
   * CA8: "foi cancelada" só com a busca pelo id dizendo cancelado (ou apagado: 404/410). Remarcado ou movido: nada
   * de aviso, só a memória com o horário novo. Sem resposta: nada agora; a próxima leitura tenta de novo.
   */
  async function verify(suspects: readonly string[]): Promise<void> {
    if (!suspects.length) return
    const settings = await deps.settings()
    for (const key of suspects) {
      const entry = memory.get(key)
      if (!entry || disposed) continue
      const result = await lookup(entry)
      if (result.kind === 'found') rescheduled(memory, key, result.event)
      else if (result.kind === 'cancelled') {
        const notice = confirmCancelled(memory, key, { now: now(), settings: alertSettings(settings), recording: recordingState(deps.recording()) })
        if (notice) deps.notify(notice)
      }
    }
    // A faixa do evento cancelado some.
    await evaluate(new Set(), new Set())
  }

  async function doRefresh(): Promise<void> {
    const calendars = await wanted()
    wantedKeys = new Set(calendars.map(({ provider, calendarId }) => calendarKey(provider, calendarId)))
    const fresh = new Set<string>()
    const cancelledKeys = new Set<string>()
    let read = 0
    for (const { provider, calendarId } of calendars) {
      if (disposed) return
      const key = calendarKey(provider, calendarId)
      try {
        const result = await readCalendar(provider, calendarId)
        byCalendar.set(key, result.events)
        for (const id of result.cancelledIds) cancelledKeys.add(`${key}:${id}`)
        fresh.add(key)
        read += result.events.length
      } catch (error) {
        // Sem internet ou sessão expirada: fica a última leitura desta agenda.
        deps.log?.(`[agenda] ${provider}: leitura falhou (${error instanceof CalendarReadError ? error.kind : error instanceof Error ? error.name : 'erro'})`)
      }
    }
    // Agenda que deixou de ser escolhida (ou conta que saiu) sai da memória e do cache.
    for (const key of [...byCalendar.keys()]) if (!wantedKeys.has(key)) byCalendar.delete(key)
    if (fresh.size || calendars.length === 0) writeCache()
    if (calendars.length) deps.log?.(`[agenda] ${fresh.size}/${calendars.length} agenda(s) lida(s), ${read} evento(s)`)
    await verify(await evaluate(fresh, cancelledKeys))
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (refreshing) {
      again = true
      return refreshing
    }
    refreshing = (async () => {
      try {
        do {
          again = false
          await doRefresh().catch((error: unknown) => deps.log?.(`[agenda] leitura: ${error instanceof Error ? error.name : 'erro'}`))
        } while (again && !disposed)
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  function view(): CalendarView {
    const providers = connected()
    if (!providers.length) return { connected: false, upcoming: [], banner: null }
    return { connected: true, upcoming: upcomingEvents(currentEvents(), now()).map((event) => upcomingView(event, now())), banner }
  }

  async function tick(): Promise<void> {
    if (disposed || refreshing) return
    await evaluate(new Set(), new Set()).catch(() => undefined)
  }

  function settingsChanged(): void {
    void deps
      .settings()
      .then((settings) => {
        const signature = JSON.stringify(settings.calendarIds)
        if (signature === settingsSignature) return tick()
        settingsSignature = signature
        return refresh()
      })
      .catch(() => undefined)
  }

  const findEvent = (key: unknown): CalendarEvent | null => (typeof key === 'string' ? (currentEvents().find((event) => eventKey(event) === key) ?? null) : null)

  return {
    start() {
      loadCache()
      accountsSignature = signatureOfAccounts()
      void deps
        .settings()
        .then((settings) => {
          settingsSignature = JSON.stringify(settings.calendarIds)
        })
        .catch(() => undefined)
      void refresh()
      timers = [setInterval(() => void tick(), CALENDAR_TICK_MS), setInterval(() => void refresh(), CALENDAR_REFRESH_MS)]
      for (const timer of timers) timer.unref?.()
    },

    refresh,

    tick,

    view,

    async calendars() {
      const calendars: CalendarListItem[] = []
      const failed: CalendarProvider[] = []
      for (const provider of connected()) {
        const account = deps.accounts[provider]
        const list = (token: string): Promise<CalendarListItem[]> => (provider === 'google' ? listGoogleCalendars(fetch, token) : listMicrosoftCalendars(fetch, token))
        try {
          calendars.push(...(await list(await account.accessToken()).catch(async (error: unknown) => {
            if (error instanceof CalendarReadError && error.kind === 'auth') return list(await account.accessToken(true))
            throw error
          })))
        } catch {
          failed.push(provider)
        }
      }
      return { calendars, failed }
    },

    pick(key) {
      const event = findEvent(key)
      pending = event ? { event, at: now() } : null
      return event !== null
    },

    recordingStarted() {
      const picked = pending && now() - pending.at <= CALENDAR_PICK_MS ? pending.event : null
      pending = null
      const event = picked ?? matchRecordingEvent(currentEvents(), now())
      recording = event ? { key: dedupeKey(event), calendar: meetingCalendarOf(event) } : null
      // A faixa some já: a gravação começou.
      void evaluate(new Set(), new Set()).catch(() => undefined)
      return recording?.calendar ?? null
    },

    recordingCalendar: () => recording?.calendar ?? null,

    recordingEnded() {
      recording = null
      void evaluate(new Set(), new Set()).catch(() => undefined)
    },

    dismiss(key) {
      if (typeof key === 'string' && dismissAlert(memory, key) && banner?.key === key) {
        banner = null
        publish()
        // Outra reunião sem gravação pode tomar o lugar da faixa.
        void tick()
      }
      return view()
    },

    joinUrl: (key) => findEvent(key)?.joinUrl ?? null,

    accountsChanged() {
      const signature = signatureOfAccounts()
      if (signature === accountsSignature) return
      accountsSignature = signature
      void refresh()
    },

    settingsChanged,

    dispose() {
      disposed = true
      for (const timer of timers) clearInterval(timer)
      timers = []
    },
  }
}
