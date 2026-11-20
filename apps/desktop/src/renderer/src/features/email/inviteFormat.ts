// Textos do cartão do convite (contrato 63, feature convites-agenda): a hora no fuso do Mac (com o fuso de origem
// quando é outro), o serviço do link da reunião, os convidados, a linha "Você aceitou …", a frase do "não é para você",
// a agenda e as frases dos erros do REPLY. Puro: o fuso e o "agora" vêm de quem chama. Importado também pelo smoke (no
// main), por isso os caminhos de `shared` são relativos.
import type { InviteReplySendError } from '../../../../shared/email'
import type { EmailInvite, InviteAttendee, InvitePerson, InviteRecurrenceBlock } from '../../../../shared/invite'
import type { InviteWhen } from '../../../../shared/invite-state'

/** O fuso do Mac (o do processo do renderer). */
export const macTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

const MINUTE = 60_000
const DAY_MS = 86_400_000

/** Cidade em português dos fusos mais comuns; fora da tabela, o último pedaço do IANA. */
const ZONE_CITIES: Readonly<Record<string, string>> = {
  'America/New_York': 'Nova York',
  'America/Sao_Paulo': 'São Paulo',
  'Europe/Lisbon': 'Lisboa',
  'Europe/London': 'Londres',
  'Europe/Madrid': 'Madri',
  'Europe/Paris': 'Paris',
  'Europe/Berlin': 'Berlim',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Los_Angeles': 'Los Angeles',
  'America/Mexico_City': 'Cidade do México',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Buenos_Aires': 'Buenos Aires',
  'America/Santiago': 'Santiago',
  'America/Bogota': 'Bogotá',
  'Asia/Tokyo': 'Tóquio',
  'Asia/Shanghai': 'Xangai',
  'Asia/Singapore': 'Singapura',
  'Australia/Sydney': 'Sydney',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
}

export function zoneCity(zone: string): string {
  return ZONE_CITIES[zone] ?? (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ')
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') }
}

/** O deslocamento do fuso naquele instante, em minutos. */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / MINUTE) * MINUTE) / MINUTE)
}

const pad = (value: number): string => String(value).padStart(2, '0')
const hm = (ms: number, timeZone: string): string => {
  const p = zonedParts(ms, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** "sex", sem o ponto do pt-BR. */
const weekday = (ms: number, timeZone: string): string => new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short' }).format(new Date(ms)).replace(/\.$/, '')
const monthName = (ms: number, timeZone: string): string => new Intl.DateTimeFormat('pt-BR', { timeZone, month: 'long' }).format(new Date(ms))

/** "sex, 20 de novembro" (com o ano, se é outro que o de agora). */
function dayLabel(ms: number, timeZone: string, nowYear: number, withMonth = true): string {
  const p = zonedParts(ms, timeZone)
  const base = `${weekday(ms, timeZone)}, ${p.day}`
  if (!withMonth) return base
  return `${base} de ${monthName(ms, timeZone)}${p.year !== nowYear ? ` de ${p.year}` : ''}`
}

/** "30 min", "1 h", "1 h 30 min", "2 h". */
export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** A hora do convite como o cartão mostra (CA4), em pedaços para o realce da atualização (CA11). */
export interface InviteWhenText {
  /** O texto inteiro: "sex, 20 de novembro · 15:00–16:00 · 1 h". */
  text: string
  /** Sem a duração: "sex, 20 de novembro · 15:00–16:00". */
  main: string
  /** "1 h"; `null` no dia inteiro. */
  duration: string | null
  /** "sex, 20 de novembro" quando começa e acaba no mesmo dia (e não é dia inteiro); senão `null`. */
  day: string | null
  startTime: string | null
  endTime: string | null
  /** "13:00–14:00 no horário de Nova York (America/New_York)", só quando o fuso do convite é outro. */
  origin: string | null
}

/** O mínimo do convite que a hora usa (o `EmailInvite` do 59 ou o `InviteWhen` do 62). */
export type InviteWhenInput = Pick<EmailInvite, 'start' | 'end' | 'allDay' | 'timeZone'> | InviteWhen

const allDayMs = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))

export function inviteWhen(when: InviteWhenInput, timeZone: string, now: number = Date.now()): InviteWhenText {
  const nowYear = zonedParts(now, timeZone).year
  if (when.allDay) {
    // Dia inteiro: datas de calendário, sem fuso; o `end` do 59 é exclusivo.
    const start = allDayMs(when.start)
    const last = Math.max(start, allDayMs(when.end) - DAY_MS)
    let main: string
    if (last === start) main = `${dayLabel(start, 'UTC', nowYear)} · dia inteiro`
    else {
      const a = zonedParts(start, 'UTC')
      const b = zonedParts(last, 'UTC')
      const sameMonth = a.year === b.year && a.month === b.month
      const first = sameMonth ? dayLabel(start, 'UTC', nowYear, false) : a.year === b.year ? `${weekday(start, 'UTC')}, ${a.day} de ${monthName(start, 'UTC')}` : dayLabel(start, 'UTC', nowYear)
      main = `${first} – ${dayLabel(last, 'UTC', nowYear)} · dia inteiro`
    }
    return { text: main, main, duration: null, day: null, startTime: null, endTime: null, origin: null }
  }
  const start = Date.parse(when.start)
  const end = Date.parse(when.end)
  const a = zonedParts(start, timeZone)
  const b = zonedParts(end, timeZone)
  const duration = durationLabel((end - start) / MINUTE)
  const startTime = hm(start, timeZone)
  const endTime = hm(end, timeZone)
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day
  const day = sameDay ? dayLabel(start, timeZone, nowYear) : null
  const main = day !== null ? `${day} · ${startTime}–${endTime}` : `${dayLabel(start, timeZone, nowYear)}, ${startTime} – ${dayLabel(end, timeZone, nowYear)}, ${endTime}`
  let origin: string | null = null
  if (when.timeZone !== null && offsetMinutes(start, when.timeZone) !== offsetMinutes(start, timeZone)) {
    origin = `${hm(start, when.timeZone)}–${hm(end, when.timeZone)} no horário de ${zoneCity(when.timeZone)} (${when.timeZone})`
  }
  return { text: `${main} · ${duration}`, main, duration, day, startTime, endTime, origin }
}

/** Um pedaço do texto de uma mudança: o antigo (riscado), o novo (negrito) ou o que não mudou. */
export interface DiffPiece {
  text: string
  mark: 'old' | 'new' | null
}

/**
 * CA11: a hora que mudou, só no trecho que mudou ("sex, 20 de novembro · ~~15:00~~ → **16:30**–17:30"); se mudou o
 * dia (ou o formato), o texto inteiro riscado → o novo. A duração (do novo) fica de fora: o cartão põe depois.
 */
export function whenDiff(before: InviteWhenText, after: InviteWhenText): DiffPiece[] {
  if (before.day !== null && before.day === after.day && before.startTime !== null && after.startTime !== null) {
    if (before.startTime !== after.startTime) {
      return [
        { text: `${after.day} · `, mark: null },
        { text: before.startTime, mark: 'old' },
        { text: ' → ', mark: null },
        { text: after.startTime, mark: 'new' },
        { text: `–${after.endTime ?? ''}`, mark: null },
      ]
    }
    if (before.endTime !== after.endTime) {
      return [
        { text: `${after.day} · ${after.startTime}–`, mark: null },
        { text: before.endTime ?? '', mark: 'old' },
        { text: ' → ', mark: null },
        { text: after.endTime ?? '', mark: 'new' },
      ]
    }
  }
  if (before.main === after.main) return [{ text: after.main, mark: null }]
  return [
    { text: before.main, mark: 'old' },
    { text: ' → ', mark: null },
    { text: after.main, mark: 'new' },
  ]
}

/** O link sem `https://` e sem a barra final. */
export function joinLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/** CA5: o serviço pelo domínio do link. */
export function joinService(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return joinLabel(url)
  }
  if (host === 'meet.google.com') return 'Google Meet'
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'Microsoft Teams'
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'Zoom'
  if (host === 'webex.com' || host.endsWith('.webex.com')) return 'Webex'
  return host
}

/** "1 convidado", "8 convidados"; com 0, vazio (o cartão tira a linha). */
export function attendeesLabel(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? '1 convidado' : `${count} convidados`
}

export type ReplyPartstat = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'

/** O rótulo de cada resposta no segmentado e no "Enviando" (CA8, CA9). */
export const RESPONSE_LABELS: Readonly<Record<ReplyPartstat, string>> = { ACCEPTED: 'Aceito', TENTATIVE: 'Talvez', DECLINED: 'Recusado' }

const VERBS: Readonly<Record<string, string>> = { ACCEPTED: 'aceitou', TENTATIVE: 'marcou talvez', DECLINED: 'recusou', DELEGATED: 'delegou' }
/** "aceitou", "marcou talvez", "recusou", "delegou"; outro PARTSTAT, "respondeu". */
export const partstatVerb = (partstat: string): string => VERBS[partstat] ?? 'respondeu'

/** "hoje às 11:20", "ontem às 09:05", "em 18/11 às 14:00" (com o ano, se é outro). */
export function whenLabel(at: number, timeZone: string, now: number): string {
  const p = zonedParts(at, timeZone)
  const today = zonedParts(now, timeZone)
  const yesterday = zonedParts(now - DAY_MS, timeZone)
  const time = `${pad(p.hour)}:${pad(p.minute)}`
  const same = (x: ZonedParts): boolean => x.year === p.year && x.month === p.month && x.day === p.day
  if (same(today)) return `hoje às ${time}`
  if (same(yesterday)) return `ontem às ${time}`
  return `em ${pad(p.day)}/${pad(p.month)}${p.year !== today.year ? `/${p.year}` : ''} às ${time}`
}

/** O nome, ou o endereço sem nome. */
export const personLabel = (person: InvitePerson): string => person.name?.trim() || person.address

/** "Você aceitou hoje às 11:20" (a parte em negrito da linha do CA13). */
export function responseHead(response: { partstat: ReplyPartstat; at: number }, timeZone: string, now: number): string {
  return `Você ${partstatVerb(response.partstat)} ${whenLabel(response.at, timeZone, now)}`
}

/** CA8: "Você aceitou hoje às 11:20. Resposta enviada a Daniel Brooks." */
export function responseLine(response: { partstat: ReplyPartstat; at: number }, organizer: InvitePerson | null, timeZone: string, now: number): string {
  const head = `${responseHead(response, timeZone, now)}.`
  return organizer ? `${head} ${sentToLine(organizer)}` : head
}

/** "Resposta enviada a Daniel Brooks." */
export const sentToLine = (organizer: InvitePerson): string => `Resposta enviada a ${personLabel(organizer)}.`

/** CA14: para quem é o convite, quando não é para a conta. */
export function notForLine(attendees: readonly Pick<InviteAttendee, 'address'>[], count: number): string {
  const rest = 'Para responder, abra o convite na conta convidada. Pôr na agenda continua possível.'
  const first = attendees[0]?.address
  if (count <= 0 || !first) return `O convite não lista convidados. ${rest}`
  return `Os convidados são outros endereços (${count === 1 ? first : `${first} e mais ${count - 1}`}). ${rest}`
}

/** "Trabalho (iCloud)". */
export const calendarLabel = (title: string, sourceTitle: string | null): string => (sourceTitle ? `${title} (${sourceTitle})` : title)

/** CA17: por que a repetição não vai para a agenda. */
export function recurrenceBlockLabel(block: InviteRecurrenceBlock | null): string {
  switch (block) {
    case 'rdate':
      return 'Repetição por datas (RDATE)'
    case 'sub-daily':
      return 'Repete mais de uma vez por dia'
    case 'byhour':
    case 'byminute':
    case 'bysecond':
      return 'Repetição por horário'
    case 'multiple-rrule':
      return 'Mais de uma regra de repetição'
    default:
      return 'Repetição fora do padrão'
  }
}

/** CA12: "qui, 17 de dezembro" de uma ocorrência (ISO UTC, ou AAAA-MM-DD de dia inteiro). */
export function occurrenceDay(recurrenceId: string, timeZone: string, now: number = Date.now()): string {
  const nowYear = zonedParts(now, timeZone).year
  if (/^\d{4}-\d{2}-\d{2}$/.test(recurrenceId)) return dayLabel(allDayMs(recurrenceId), 'UTC', nowYear)
  return dayLabel(Date.parse(recurrenceId), timeZone, nowYear)
}

/** CA7: a frase de cada recusa do REPLY (61). */
export const INVITE_REPLY_ERRORS: Readonly<Record<InviteReplySendError, string>> = Object.freeze({
  click: 'Clique de novo para responder.',
  busy: 'A resposta anterior ainda está saindo.',
  'not-invited': 'Este convite não é para este endereço.',
  'no-organizer': 'O convite não diz quem organizou: não há para quem responder.',
  auth: 'O servidor de envio recusou o usuário ou a senha.',
  connection: 'Sem conexão com o servidor de envio. Nada foi enviado.',
  rejected: 'O servidor de envio recusou a resposta.',
  account: 'Não foi possível enviar a resposta. Tente de novo.',
  'not-found': 'Não foi possível enviar a resposta. Tente de novo.',
  'no-invite': 'Não foi possível enviar a resposta. Tente de novo.',
  'not-request': 'Não foi possível enviar a resposta. Tente de novo.',
  invalid: 'Não foi possível enviar a resposta. Tente de novo.',
  malformed: 'Não foi possível enviar a resposta. Tente de novo.',
  failed: 'Não foi possível enviar a resposta. Tente de novo.',
})
