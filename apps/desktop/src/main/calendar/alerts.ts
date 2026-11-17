// Avisos da agenda (contrato 12, CA6 a CA8), sem relógio nem rede: a cada passada, os eventos de agora, o instante,
// as configurações e a gravação em curso entram; saem as notificações a mostrar, a faixa "não está sendo gravada" e
// os eventos já avisados que sumiram ou vieram cancelados (`suspects`). "Cancelada" só sai depois que o serviço
// busca o evento pelo id e confirma (`confirmCancelled`); remarcado ou movido não avisa nada (`rescheduled`). A
// memória por evento fica com quem chama, pela chave do convite (`dedupeKey`): o mesmo evento em duas agendas é um
// só.
import { attendeeName, dedupeKey, eventKey, isMeetingEvent, type CalendarBanner, type CalendarEvent, type CalendarNotice, type CalendarProvider } from '../../shared/calendar'

/** CA7: o primeiro "não está sendo gravada" 2 min depois do início e o segundo aos 10 min. */
export const NOT_RECORDING_FIRST_MS = 2 * 60_000
export const NOT_RECORDING_REPEAT_MS = 10 * 60_000
/** Entre o primeiro e o segundo, pelo menos isto (o app aberto no meio da reunião não avisa duas vezes seguidas). */
export const NOT_RECORDING_GAP_MS = 4 * 60_000

export interface AlertMemory {
  /** A última cópia vista: provedor, agenda e id (para buscar pelo id) e a chave das ações ("Gravar"). */
  provider: CalendarProvider
  calendarId: string
  id: string
  eventKey: string
  /** Início com que o evento foi avisado (CA6); outro início avisa de novo. */
  warnedStart: string | null
  /** O que o aviso mostrou: o cancelamento (CA8) usa mesmo se o evento sumir da agenda. */
  title: string
  start: string
  end: string
  /** Quantos "não está sendo gravada" já saíram (0, 1 ou 2) e quando saiu o primeiro. */
  late: number
  lateAt: number
  dismissed: boolean
  /** Houve gravação durante o evento: nada mais de "não está gravando". */
  recorded: boolean
  cancelled: boolean
}

export interface AlertSettings {
  alerts: boolean
  leadMinutes: number
  notRecording: boolean
}

export interface AlertInput {
  /** Uma cópia por evento (`dedupeEvents`), inclusive as canceladas. */
  events: readonly CalendarEvent[]
  /**
   * Agendas (`provider:calendarId`) lidas agora com sucesso: um evento já avisado dessas agendas que sumiu é suspeito.
   * Sem leitura nova (só o relógio andou), vazio.
   */
  freshCalendars: ReadonlySet<string>
  /** `eventKey` dos eventos que a leitura trouxe só como cancelados, sem horário. */
  cancelledKeys: ReadonlySet<string>
  now: number
  settings: AlertSettings
  /** `eventKey`: a chave do convite (`dedupeKey`) do evento da gravação. */
  recording: { active: boolean; eventKey: string | null }
}

export interface AlertOutput {
  notices: CalendarNotice[]
  banner: CalendarBanner | null
  /** Chaves (da memória) de eventos avisados que sumiram ou vieram cancelados: buscar pelo id antes de avisar. */
  suspects: string[]
}

const memoryFor = (event: CalendarEvent): AlertMemory => ({
  provider: event.provider,
  calendarId: event.calendarId,
  id: event.id,
  eventKey: eventKey(event),
  warnedStart: null,
  title: event.title,
  start: event.start,
  end: event.end,
  late: 0,
  lateAt: 0,
  dismissed: false,
  recorded: false,
  cancelled: false,
})

const names = (event: CalendarEvent): string[] => event.attendees.map(attendeeName).filter(Boolean)

/** Reunião confirmada, que conta para os avisos e para a faixa. */
const counts = (event: CalendarEvent): boolean => event.status === 'confirmed' && isMeetingEvent(event)

/**
 * Uma passada. Muda a `memory` no lugar e devolve o que mostrar agora. Com os avisos desligados nada sai (nem a
 * faixa); com "não está sendo gravada" desligado, só o aviso antes.
 */
export function evaluateAlerts(input: AlertInput, memory: Map<string, AlertMemory>): AlertOutput {
  const { now, settings, recording } = input
  const notices: CalendarNotice[] = []
  const leadMs = settings.leadMinutes * 60_000
  const live = new Set<string>()
  const cancelledNow = new Set<string>()

  for (const event of input.events) {
    const key = dedupeKey(event)
    if (event.status === 'cancelled' || input.cancelledKeys.has(eventKey(event))) {
      cancelledNow.add(key)
      continue
    }
    live.add(key)
    let entry = memory.get(key)
    const start = Date.parse(event.start)
    const end = Date.parse(event.end)
    // Mudou de horário: tudo recomeça (avisa de novo).
    if (entry && entry.start !== event.start) {
      entry = memoryFor(event)
      memory.set(key, entry)
    }
    if (!counts(event) || end <= now) continue
    if (!entry) {
      entry = memoryFor(event)
      memory.set(key, entry)
    }
    Object.assign(entry, { provider: event.provider, calendarId: event.calendarId, id: event.id, eventKey: eventKey(event), title: event.title, end: event.end, cancelled: false })
    // Gravando durante o evento (ou a gravação é dele): nada de "não está gravando" depois.
    if (recording.active && (start <= now || recording.eventKey === key)) entry.recorded = true
    if (!settings.alerts) continue
    // CA6: N min antes, uma vez por início.
    if (now < start && now >= start - leadMs && entry.warnedStart !== event.start) {
      entry.warnedStart = event.start
      notices.push({ kind: 'before', key: eventKey(event), title: event.title, start: event.start, attendees: names(event), minutes: Math.max(1, Math.ceil((start - now) / 60_000)), recording: false })
    }
    // CA7: começou, ninguém grava e a reunião não acabou.
    if (!settings.notRecording || recording.active || entry.recorded || now < start + NOT_RECORDING_FIRST_MS) continue
    if (entry.late === 0) {
      entry.late = 1
      entry.lateAt = now
      notices.push({ kind: 'not-recording', key: eventKey(event), title: event.title, start: event.start, attendees: names(event), minutes: 0, recording: false })
    } else if (entry.late === 1 && !entry.dismissed && now >= start + NOT_RECORDING_REPEAT_MS && now - entry.lateAt >= NOT_RECORDING_GAP_MS) {
      entry.late = 2
      notices.push({ kind: 'not-recording', key: eventKey(event), title: event.title, start: event.start, attendees: names(event), minutes: 0, recording: false })
    }
  }

  // CA8: avisado e cancelado, ou sumido de uma agenda lida agora. Sem cópia viva com o mesmo convite (movido para
  // outra agenda escolhida não é cancelado), vira suspeito; o serviço confirma pelo id.
  const suspects: string[] = []
  for (const [key, entry] of memory) {
    if (live.has(key)) continue
    const flagged = cancelledNow.has(key) || input.cancelledKeys.has(entry.eventKey) || input.freshCalendars.has(`${entry.provider}:${entry.calendarId}`)
    if (flagged && !entry.cancelled && entry.warnedStart !== null && Date.parse(entry.end) > now) suspects.push(key)
    // Bem depois do fim, a memória do evento vai embora.
    if (Date.parse(entry.end) < now - 3_600_000) memory.delete(key)
  }

  return { notices, banner: settings.alerts && settings.notRecording && !recording.active ? bannerOf(input.events, memory, now) : null, suspects }
}

/** O serviço confirmou pelo id que o evento foi cancelado ou apagado: o aviso "foi cancelada" (uma vez). */
export function confirmCancelled(memory: Map<string, AlertMemory>, key: string, input: Pick<AlertInput, 'now' | 'settings' | 'recording'>): CalendarNotice | null {
  const entry = memory.get(key)
  if (!entry || entry.cancelled) return null
  entry.cancelled = true
  if (!input.settings.alerts || entry.warnedStart === null || Date.parse(entry.end) <= input.now) return null
  return { kind: 'cancelled', key: entry.eventKey, title: entry.title, start: entry.start, attendees: [], minutes: 0, recording: input.recording.active && input.recording.eventKey === key }
}

/**
 * A busca pelo id achou o evento de pé (remarcado para fora da janela lida, ou movido para uma agenda que o app não
 * lê): nada de aviso; a memória fica com o horário novo e volta a avisar se ele entrar na janela.
 */
export function rescheduled(memory: Map<string, AlertMemory>, key: string, event: CalendarEvent): void {
  const entry = memory.get(key)
  if (!entry) return
  if (entry.start === event.start) {
    // Mesmo horário, só fora da agenda lida: não pergunta de novo a cada leitura.
    entry.warnedStart = null
    return
  }
  memory.set(key, { ...memoryFor(event), recorded: entry.recorded, dismissed: entry.dismissed })
}

/** A faixa: a reunião mais antiga que já avisou "não está sendo gravada", sem "Ignorar", sem gravação e ainda acontecendo. */
function bannerOf(events: readonly CalendarEvent[], memory: Map<string, AlertMemory>, now: number): CalendarBanner | null {
  const shown = events
    .filter((event) => {
      const entry = memory.get(dedupeKey(event))
      return counts(event) && entry && entry.late > 0 && !entry.dismissed && !entry.recorded && !entry.cancelled && Date.parse(event.end) > now
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]
  return shown ? { key: eventKey(shown), title: shown.title } : null
}

/** "Ignorar" da faixa (pela chave do evento): não repete aos 10 min e a faixa some. */
export function dismissAlert(memory: Map<string, AlertMemory>, eventKeyOfBanner: string): boolean {
  for (const entry of memory.values()) {
    if (entry.eventKey === eventKeyOfBanner) {
      entry.dismissed = true
      return true
    }
  }
  return false
}
