// Contrato 59: o parser e o gerador iCalendar dos convites do email (`shared/invite.ts`), a tabela de fusos do
// Windows e o empacotamento do `ical.js`. Tudo com fixtures anonimizadas; nada sai da máquina, nenhum email é enviado.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ICAL from 'ical.js'
import { simpleParser } from 'mailparser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INVITE_DESCRIPTION_MAX,
  INVITE_ICS_MAX_BYTES,
  INVITE_VEVENTS_MAX,
  buildReply,
  classifyRecurrence,
  compareInviteVersion,
  describeRecurrence,
  parseInvite,
  type EmailInvite,
  type InvitePart,
  type InviteParseResult,
  type InviteReplyPartstat,
} from '../src/shared/invite'
import { WINDOWS_ZONES, windowsToIana } from '../src/shared/windows-zones'

const ROOT = join(import.meta.dirname, '..')
const FIXTURES = join(import.meta.dirname, 'fixtures', 'invites')
const SELF = 'andrew.teste@example.org'
const OPTIONS = { self: [SELF], localTimeZone: 'America/Sao_Paulo' }
const NOW = new Date('2026-11-19T18:30:00.000Z')

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
const icsPart = (content: string | Uint8Array, method: string | null = 'REQUEST', contentType = 'text/calendar; charset=utf-8'): InvitePart => ({ contentType, filename: null, method, content })
const parseFixture = (name: string, options = OPTIONS): InviteParseResult => parseInvite([icsPart(fixture(name), null)], options)

function okInvite(result: InviteParseResult): EmailInvite {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.error}`)
  return result.invite
}

/** As partes do email como o `mailparser` entrega (o que o contrato 61 vai fazer no `parseEmail`). */
async function emlParts(name: string): Promise<InvitePart[]> {
  const parsed = await simpleParser(readFileSync(join(FIXTURES, name)))
  return parsed.attachments.map((item) => {
    const params = (item.headers.get('content-type') as { params?: Record<string, string> } | undefined)?.params
    return { contentType: item.contentType, filename: item.filename ?? null, method: params?.method ?? null, content: item.content }
  })
}

async function googleRequest(): Promise<EmailInvite> {
  return okInvite(parseInvite(await emlParts('google-request.eml'), OPTIONS))
}

/** Windows-1252 dos caracteres que as fixtures usam (o Node não tem codificador para ele). */
function toWindows1252(text: string): Uint8Array {
  const special: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 }
  return Uint8Array.from([...text].map((char) => {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code
    const byte = special[char]
    if (byte === undefined) throw new Error(`sem windows-1252 para ${char}`)
    return byte
  }))
}

/** Linhas desdobradas de um .ics. */
const unfold = (text: string): string[] => text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((line) => line !== '')

/** Gerador com semente fixa (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('partes (CA2, CA3)', () => {
  it('o email do Google: o text/calendar com method vence e o anexo do mesmo UID conta em ignoredParts', async () => {
    const parts = await emlParts('google-request.eml')
    expect(parts.map((part) => [part.contentType, part.filename, part.method])).toEqual([
      ['text/calendar', null, 'REQUEST'],
      ['application/ics', 'invite.ics', null],
    ])
    const result = parseInvite(parts, OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ignoredParts).toBe(1)
    const reversed = parseInvite([...parts].reverse(), OPTIONS)
    expect(reversed).toEqual(result)
  })

  it('só contam text/calendar, application/ics e *.ics; nenhuma → none', () => {
    const ics = fixture('zoom-sem-vtimezone.ics')
    expect(parseInvite([], OPTIONS)).toEqual({ ok: false, error: 'none' })
    expect(parseInvite([{ contentType: 'text/plain', filename: 'convite.txt', method: null, content: ics }, { contentType: 'text/html', filename: null, method: null, content: ics }], OPTIONS)).toEqual({ ok: false, error: 'none' })
    expect(okInvite(parseInvite([{ contentType: 'application/octet-stream', filename: 'Convite.ICS', method: null, content: ics }], OPTIONS)).uid).toBe('ZOOM81234567890EXAMPLE')
    expect(okInvite(parseInvite([{ contentType: 'APPLICATION/ICS; name=x', filename: null, method: null, content: ics }], OPTIONS)).uid).toBe('ZOOM81234567890EXAMPLE')
    expect(okInvite(parseInvite([{ contentType: 'Text/Calendar', filename: null, method: null, content: ics }], OPTIONS)).uid).toBe('ZOOM81234567890EXAMPLE')
  })

  it('a ordem: text/calendar com method, outro text/calendar, o resto; o erro é o da primeira candidata', () => {
    const zoom = fixture('zoom-sem-vtimezone.ics')
    const teams = fixture('teams-new-link.ics')
    const attached: InvitePart = { contentType: 'application/ics', filename: 'invite.ics', method: null, content: zoom }
    const plainCalendar: InvitePart = { contentType: 'text/calendar', filename: null, method: null, content: teams }
    const withMethod: InvitePart = { contentType: 'text/calendar', filename: null, method: 'REQUEST', content: fixture('icloud-allday.ics') }
    const first = parseInvite([attached, plainCalendar, withMethod], OPTIONS)
    expect(okInvite(first).uid).toBe('3F2A9C1E-7B4D-4E8A-9C0F-EXAMPLE00001')
    if (first.ok) expect(first.ignoredParts).toBe(0)
    expect(okInvite(first).warnings).toEqual(['other-uids-ignored'])
    expect(okInvite(parseInvite([attached, plainCalendar], OPTIONS)).uid).toMatch(/^040000008200E/)
    const broken: InvitePart = { contentType: 'text/calendar', filename: null, method: 'REQUEST', content: fixture('malformed.ics') }
    expect(okInvite(parseInvite([attached, broken], OPTIONS)).uid).toBe('ZOOM81234567890EXAMPLE')
    expect(parseInvite([{ ...attached, content: fixture('publish.ics') }, broken], OPTIONS)).toEqual({ ok: false, error: 'malformed' })
  })

  it('bytes em windows-1252 com charset dão o mesmo título que o UTF-8', () => {
    const text = fixture('outlook-windows-tz.ics')
    const utf8 = okInvite(parseInvite([icsPart(new TextEncoder().encode(text), null, 'text/calendar; charset=utf-8')], OPTIONS))
    const cp1252 = okInvite(parseInvite([icsPart(toWindows1252(text), null, 'text/calendar; charset="windows-1252"; method=REQUEST')], OPTIONS))
    expect(utf8.title).toBe('Planejamento — orçamento 2027')
    expect(cp1252.title).toBe('Planejamento — orçamento 2027')
    expect(cp1252.description).toBe(utf8.description)
    const latin1 = okInvite(parseInvite([icsPart(toWindows1252(text.replace('—', '-')), null, 'text/calendar; charset=ISO-8859-1')], OPTIONS))
    expect(latin1.title).toBe('Planejamento - orçamento 2027')
  })

  it('sem charset ou com charset desconhecido lê UTF-8; tira o BOM; aceita LF puro', () => {
    const text = fixture('zoom-sem-vtimezone.ics')
    expect(text.includes('\r')).toBe(false)
    const bytes = new TextEncoder().encode(text)
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes])
    for (const contentType of ['text/calendar', 'text/calendar; charset=koi8-r', 'text/calendar; charset=windows-1252']) {
      const invite = okInvite(parseInvite([icsPart(bom, 'REQUEST', contentType)], OPTIONS))
      expect(invite.title).toBe('Alinhamento com o fornecedor')
      expect(invite.source.startsWith('BEGIN:VCALENDAR')).toBe(true)
    }
    expect(okInvite(parseInvite([icsPart(`\uFEFF${text}`)], OPTIONS)).start).toBe('2026-11-26T12:00:00.000Z')
    expect(okInvite(parseInvite([icsPart(bytes, 'REQUEST', 'text/calendar')], OPTIONS)).description).toContain('você')
  })
})

describe('fixtures (CA4)', () => {
  it('google-request.eml', async () => {
    const result = parseInvite(await emlParts('google-request.eml'), OPTIONS)
    if (!result.ok) throw new Error(result.error)
    expect(result.ignoredParts).toBe(1)
    const { source, description, ...invite } = result.invite
    expect(invite).toEqual({
      method: 'REQUEST',
      uid: '7kq2m9v0c3exampleuid@google.com',
      sequence: 0,
      dtstamp: '2026-11-18T12:00:00.000Z',
      recurrenceId: null,
      status: 'CONFIRMED',
      title: 'Revisão do projeto',
      allDay: false,
      start: '2026-11-20T15:00:00.000Z',
      end: '2026-11-20T16:00:00.000Z',
      timeZone: 'America/New_York',
      originalTzid: 'America/New_York',
      location: null,
      joinUrl: 'https://meet.google.com/abc-defg-hij',
      organizer: { address: 'ana@example.com', name: 'Ana Organizadora' },
      attendees: [
        { address: 'ana@example.com', name: 'Ana Organizadora', partstat: 'ACCEPTED' },
        { address: SELF, name: SELF, partstat: 'NEEDS-ACTION' },
        { address: 'bruno@example.net', name: 'bruno@example.net', partstat: 'TENTATIVE' },
      ],
      attendeeCount: 3,
      self: { address: SELF, name: SELF, partstat: 'NEEDS-ACTION' },
      recurrence: null,
      exceptions: [],
      warnings: [],
    })
    expect(description?.startsWith('-::~:~::~')).toBe(true)
    expect(description).toContain('Entrar com o Google Meet: https://meet.google.com/abc-defg-hij\n')
    expect(source.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(source.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(JSON.parse(JSON.stringify(result.invite))).toEqual(result.invite)
  })

  it('outlook-windows-tz.ics', () => {
    const invite = okInvite(parseFixture('outlook-windows-tz.ics'))
    expect(invite.method).toBe('REQUEST')
    expect(invite.start).toBe('2026-11-24T17:00:00.000Z')
    expect(invite.end).toBe('2026-11-24T18:00:00.000Z')
    expect(invite.timeZone).toBe('America/Sao_Paulo')
    expect(invite.originalTzid).toBe('E. South America Standard Time')
    expect(invite.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_EXAMPLE%40thread.v2/0?context=%7b%7d')
    expect(invite.self).toEqual({ address: SELF, name: 'Andrew Teste', partstat: 'NEEDS-ACTION' })
    expect(invite.organizer).toEqual({ address: 'carla@example.com', name: 'Carla Exemplo' })
    expect(invite.title).toBe('Planejamento — orçamento 2027')
    expect(invite.location).toBe('Reunião do Microsoft Teams')
    expect(invite.attendeeCount).toBe(2)
    expect(invite.warnings).toEqual([])
  })

  it('teams-new-link.ics', () => {
    const invite = okInvite(parseFixture('teams-new-link.ics'))
    expect(invite.start).toBe('2026-12-01T17:00:00.000Z')
    expect(invite.end).toBe('2026-12-01T17:30:00.000Z')
    expect(invite.timeZone).toBe('America/Los_Angeles')
    expect(invite.originalTzid).toBe('Pacific Standard Time')
    expect(invite.joinUrl).toBe('https://teams.microsoft.com/meet/2468013579123?p=AbCdEfGh12345')
    expect(invite.warnings).toEqual([])
  })

  it('zoom-sem-vtimezone.ics', () => {
    const invite = okInvite(parseFixture('zoom-sem-vtimezone.ics'))
    expect(invite.start).toBe('2026-11-26T12:00:00.000Z')
    expect(invite.end).toBe('2026-11-26T13:00:00.000Z')
    expect(invite.timeZone).toBe('America/Sao_Paulo')
    expect(invite.joinUrl).toBe('https://us02web.zoom.us/j/81234567890?pwd=ExAmPlE123')
    expect(invite.organizer).toEqual({ address: 'zoom.organizador@example.com', name: 'Zoom Organizador' })
    expect(invite.warnings).toEqual([])
  })

  it('icloud-allday.ics', () => {
    const invite = okInvite(parseFixture('icloud-allday.ics'))
    expect(invite.allDay).toBe(true)
    expect(invite.start).toBe('2026-12-05')
    expect(invite.end).toBe('2026-12-06')
    expect(invite.timeZone).toBe(null)
    expect(invite.originalTzid).toBe(null)
    expect(invite.location).toBe('Rua Exemplo, 100')
    expect(invite.joinUrl).toBe(null)
    expect(invite.organizer).toEqual({ address: 'davi@example.com', name: 'Davi Exemplo' })
    expect(invite.self).toEqual({ address: SELF, name: 'Andrew Teste', partstat: 'NEEDS-ACTION' })
    expect(invite.recurrence).toEqual({
      rule: { freq: 'YEARLY', interval: 1, count: null, until: null, byDay: [], byMonthDay: [], byMonth: [], bySetPos: [], weekStart: null },
      exdates: [],
      text: 'Todo ano, em 5 de dezembro',
      storable: true,
      block: null,
    })
  })

  it('google-cancel.ics', () => {
    const invite = okInvite(parseFixture('google-cancel.ics'))
    expect(invite.method).toBe('CANCEL')
    expect(invite.status).toBe('CANCELLED')
    expect(invite.sequence).toBe(1)
    expect(invite.uid).toBe('7kq2m9v0c3exampleuid@google.com')
    expect(invite.dtstamp).toBe('2026-11-19T09:00:00.000Z')
  })

  it('occurrence-request.ics', () => {
    const invite = okInvite(parseFixture('occurrence-request.ics'))
    expect(invite.uid).toBe('serie-semanal-0001@example.com')
    expect(invite.recurrenceId).toBe('2026-12-09T13:00:00.000Z')
    expect(invite.start).toBe('2026-12-09T18:00:00.000Z')
    expect(invite.end).toBe('2026-12-09T19:00:00.000Z')
    expect(invite.sequence).toBe(1)
    expect(invite.recurrence).toBe(null)
    expect(invite.exceptions).toEqual([])
  })

  it('weekly-exdate.ics', () => {
    const invite = okInvite(parseFixture('weekly-exdate.ics'))
    expect(invite.start).toBe('2026-12-02T13:00:00.000Z')
    expect(invite.recurrence).toEqual({
      rule: { freq: 'WEEKLY', interval: 1, count: null, until: '2027-01-31T13:00:00.000Z', byDay: [{ day: 'MO', pos: null }, { day: 'WE', pos: null }], byMonthDay: [], byMonth: [], bySetPos: [], weekStart: null },
      exdates: ['2026-12-23T13:00:00.000Z', '2026-12-28T13:00:00.000Z', '2026-12-30T13:00:00.000Z'],
      text: 'Toda semana, às segundas e quartas, até 31 de janeiro de 2027',
      storable: true,
      block: null,
    })
    expect(invite.exceptions).toEqual([{ recurrenceId: '2026-12-16T13:00:00.000Z', start: '2026-12-16T14:00:00.000Z', end: '2026-12-16T15:00:00.000Z', cancelled: false }])
    expect(invite.warnings).toEqual([])
  })

  it('rdate.ics', () => {
    const invite = okInvite(parseFixture('rdate.ics'))
    expect(invite.recurrence?.text).toBe('Todo mês, na última sexta, 6 vezes')
    expect(invite.recurrence?.storable).toBe(false)
    expect(invite.recurrence?.block).toBe('rdate')
    expect(invite.recurrence?.rule).toEqual({ freq: 'MONTHLY', interval: 1, count: 6, until: null, byDay: [{ day: 'FR', pos: -1 }], byMonthDay: [], byMonth: [], bySetPos: [], weekStart: null })
  })

  it('reply-received.ics', () => {
    const invite = okInvite(parseFixture('reply-received.ics'))
    expect(invite.method).toBe('REPLY')
    expect(invite.attendees).toEqual([{ address: 'bruno@example.net', name: 'Bruno Exemplo', partstat: 'ACCEPTED' }])
    expect(invite.self).toBe(null)
  })

  it('malformed.ics', () => {
    expect(parseFixture('malformed.ics')).toEqual({ ok: false, error: 'malformed' })
  })

  it('no-vevent.ics', () => {
    expect(parseFixture('no-vevent.ics')).toEqual({ ok: false, error: 'no-event' })
  })

  it('no-method.ics', () => {
    expect(parseInvite([icsPart(fixture('no-method.ics'), null)], OPTIONS)).toEqual({ ok: false, error: 'no-method' })
    expect(okInvite(parseInvite([icsPart(fixture('no-method.ics'), 'REQUEST')], OPTIONS)).method).toBe('REQUEST')
  })

  it('publish.ics', () => {
    expect(parseFixture('publish.ics')).toEqual({ ok: false, error: 'unsupported-method' })
  })
})

/** Um VCALENDAR mínimo com as linhas do VEVENT dadas. */
const calendar = (event: string[], extra: string[] = [], method = 'REQUEST'): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Exemplo//Teste//PT', `METHOD:${method}`, ...extra, 'BEGIN:VEVENT', 'UID:teste-0001@example.com', 'DTSTAMP:20261119T100000Z', ...event, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')

describe('regras gerais da leitura (CA4)', () => {
  it('METHOD do arquivo vence o da parte; ADD, COUNTER, DECLINECOUNTER e REFRESH não são aceitos', () => {
    const text = calendar(['DTSTART:20261130T130000Z'], [], 'CANCEL')
    expect(okInvite(parseInvite([icsPart(text, 'REQUEST')], OPTIONS)).method).toBe('CANCEL')
    for (const method of ['ADD', 'COUNTER', 'DECLINECOUNTER', 'REFRESH', 'PUBLISH']) {
      expect(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z'], [], method), 'REQUEST')], OPTIONS)).toEqual({ ok: false, error: 'unsupported-method' })
    }
  })

  it('sem UID → no-uid; sem DTSTART → no-start', () => {
    const noUid = calendar(['DTSTART:20261130T130000Z']).replace('UID:teste-0001@example.com\r\n', '')
    expect(parseInvite([icsPart(noUid)], OPTIONS)).toEqual({ ok: false, error: 'no-uid' })
    expect(parseInvite([icsPart(calendar(['SUMMARY:x']))], OPTIONS)).toEqual({ ok: false, error: 'no-start' })
  })

  it('sem DTEND: DURATION; sem os dois, dia inteiro → dia seguinte, com hora → o próprio início', () => {
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'DURATION:PT45M']))], OPTIONS)).end).toBe('2026-11-30T13:45:00.000Z')
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART;VALUE=DATE:20261231', 'DURATION:P2D']))], OPTIONS)).end).toBe('2027-01-02')
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART;VALUE=DATE:20261231']))], OPTIONS)).end).toBe('2027-01-01')
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z']))], OPTIONS)).end).toBe('2026-11-30T13:00:00.000Z')
  })

  it('o principal é o VEVENT sem RECURRENCE-ID; outro UID vira aviso; SEQUENCE inválido → 0', () => {
    const text = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST',
      'BEGIN:VEVENT', 'UID:outro@example.com', 'DTSTART:20261201T100000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:serie@example.com', 'RECURRENCE-ID:20261208T100000Z', 'DTSTART:20261208T120000Z', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:serie@example.com', 'SEQUENCE:abc', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const invite = okInvite(parseInvite([icsPart(text)], OPTIONS))
    // O primeiro sem RECURRENCE-ID é o do outro UID: ele é o principal, e os da série são de outro UID.
    expect(invite.uid).toBe('outro@example.com')
    expect(invite.warnings).toEqual(['other-uids-ignored'])
    const serie = okInvite(parseInvite([icsPart(text.replace('UID:outro@example.com\r\nDTSTART:20261201T100000Z', 'UID:outro@example.com\r\nRECURRENCE-ID:20261201T100000Z\r\nDTSTART:20261201T100000Z'))], OPTIONS))
    expect(serie.uid).toBe('serie@example.com')
    expect(serie.sequence).toBe(0)
    expect(serie.exceptions).toEqual([{ recurrenceId: '2026-12-08T10:00:00.000Z', start: '2026-12-08T12:00:00.000Z', end: '2026-12-08T12:00:00.000Z', cancelled: true }])
    expect(serie.warnings).toEqual(['other-uids-ignored'])
  })

  it('todos com RECURRENCE-ID: o primeiro é o principal e não há exceções', () => {
    const text = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST',
      'BEGIN:VEVENT', 'UID:serie@example.com', 'RECURRENCE-ID:20261208T100000Z', 'DTSTART:20261208T120000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:serie@example.com', 'RECURRENCE-ID:20261215T100000Z', 'DTSTART:20261215T120000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const invite = okInvite(parseInvite([icsPart(text)], OPTIONS))
    expect(invite.recurrenceId).toBe('2026-12-08T10:00:00.000Z')
    expect(invite.exceptions).toEqual([])
  })

  it('endereços, CN, PARTSTAT e self sem diferenciar maiúsculas', () => {
    const invite = okInvite(parseInvite([icsPart(calendar([
      'DTSTART:20261130T130000Z',
      'ORGANIZER:MailTo:Chefe@Example.COM',
      'ATTENDEE;PARTSTAT=accepted;CN="Fulana, a Exemplo":MAILTO:Fulana@Example.com',
      'ATTENDEE;PARTSTAT=XYZ:mailto:outra@example.com',
      'ATTENDEE:mailto:andrew.teste@example.org',
    ]))], { self: ['ANDREW.Teste@Example.org'], localTimeZone: 'America/Sao_Paulo' }))
    expect(invite.organizer).toEqual({ address: 'chefe@example.com', name: null })
    expect(invite.attendees).toEqual([
      { address: 'fulana@example.com', name: 'Fulana, a Exemplo', partstat: 'ACCEPTED' },
      { address: 'outra@example.com', name: null, partstat: 'NEEDS-ACTION' },
      { address: SELF, name: null, partstat: 'NEEDS-ACTION' },
    ])
    expect(invite.self).toEqual({ address: SELF, name: null, partstat: 'NEEDS-ACTION' })
  })

  it('textos sem escape e sem controle; título vazio; descrição cortada', () => {
    const long = 'a'.repeat(INVITE_DESCRIPTION_MAX + 10)
    const invite = okInvite(parseInvite([icsPart(calendar([
      'DTSTART:20261130T130000Z',
      'SUMMARY:   ',
      'LOCATION:Sala 1\\, andar 2\\; bloco \\\\B\\nfundos\u0007',
      `DESCRIPTION:${long}`,
    ]))], OPTIONS))
    expect(invite.title).toBe('(sem título)')
    expect(invite.location).toBe('Sala 1, andar 2; bloco \\B\nfundos')
    expect(invite.description?.length).toBe(INVITE_DESCRIPTION_MAX)
    expect(invite.warnings).toEqual(['description-clipped'])
    const titled = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', `SUMMARY:${'x'.repeat(300)}`]))], OPTIONS))
    expect(titled.title.length).toBe(200)
  })
})

const zonedLower = calendar(['DTSTART;TZID=america/new_york:20261120T100000'], ['BEGIN:VTIMEZONE', 'TZID:america/new_york', 'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'])

describe('fuso (CA5)', () => {
  const sneaky = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST',
    'BEGIN:VTIMEZONE', 'TZID:America/Sao_Paulo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:fuso-falso@example.com', 'DTSTAMP:20261119T100000Z', 'DTSTART;TZID=America/Sao_Paulo:20261126T090000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('(a) isolamento: o VTIMEZONE de um convite não vaza para o seguinte, e o TimezoneService termina como começou', () => {
    const before = ICAL.TimezoneService.count
    const first = okInvite(parseInvite([icsPart(sneaky)], OPTIONS))
    expect(first.start).toBe('2026-11-26T04:00:00.000Z')
    expect(first.timeZone).toBe('America/Sao_Paulo')
    const second = okInvite(parseFixture('zoom-sem-vtimezone.ics'))
    expect(second.start).toBe('2026-11-26T12:00:00.000Z')
    expect(ICAL.TimezoneService.count).toBe(before)
    expect(ICAL.TimezoneService.has('America/Sao_Paulo')).toBe(false)
  })

  it('(a) um fuso já registrado com o mesmo nome volta como estava, mesmo quando o parse falha', () => {
    const utc = ICAL.Timezone.utcTimezone
    ICAL.TimezoneService.register(utc, 'America/Sao_Paulo')
    try {
      const count = ICAL.TimezoneService.count
      okInvite(parseInvite([icsPart(sneaky)], OPTIONS))
      expect(ICAL.TimezoneService.get('America/Sao_Paulo')).toBe(utc)
      expect(parseInvite([icsPart(sneaky.replace('BEGIN:VEVENT\r\nUID:fuso-falso@example.com', 'BEGIN:VEVENT'))], OPTIONS)).toEqual({ ok: false, error: 'no-uid' })
      expect(ICAL.TimezoneService.get('America/Sao_Paulo')).toBe(utc)
      expect(ICAL.TimezoneService.count).toBe(count)
    } finally {
      ICAL.TimezoneService.remove('America/Sao_Paulo')
    }
  })

  it('(b) TZID inventado sem VTIMEZONE → unknown-tzid, lido em São Paulo', () => {
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=Fuso Inventado/XYZ:20261126T090000', 'DTEND;TZID=Fuso Inventado/XYZ:20261126T100000']))], OPTIONS))
    expect(invite.start).toBe('2026-11-26T12:00:00.000Z')
    expect(invite.end).toBe('2026-11-26T13:00:00.000Z')
    expect(invite.timeZone).toBe('America/Sao_Paulo')
    expect(invite.originalTzid).toBe('Fuso Inventado/XYZ')
    expect(invite.warnings).toEqual(['unknown-tzid'])
  })

  it('(c) TZID com prefixo de caminho sem VTIMEZONE → o trecho final IANA', () => {
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20261120T100000']))], OPTIONS))
    expect(invite.timeZone).toBe('America/New_York')
    expect(invite.start).toBe('2026-11-20T15:00:00.000Z')
    expect(invite.warnings).toEqual([])
  })

  it('hora com Z → UTC; flutuante → fuso do Mac com floating-time; VTIMEZONE de nome desconhecido → timeZone null', () => {
    const utc = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z']))], OPTIONS))
    expect(utc.timeZone).toBe('UTC')
    expect(utc.originalTzid).toBe(null)
    expect(utc.warnings).toEqual([])
    const floating = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000']))], OPTIONS))
    expect(floating.start).toBe('2026-11-30T16:00:00.000Z')
    expect(floating.timeZone).toBe('America/Sao_Paulo')
    expect(floating.warnings).toEqual(['floating-time'])
    const custom = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=Customized Time Zone:20261130T130000'], ['BEGIN:VTIMEZONE', 'TZID:Customized Time Zone', 'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE']))], OPTIONS))
    expect(custom.start).toBe('2026-11-30T12:00:00.000Z')
    expect(custom.timeZone).toBe(null)
    expect(custom.warnings).toEqual([])
  })

  it('o IANA sai na forma canônica', () => {
    const lower = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=america/new_york:20261120T100000']))], OPTIONS))
    expect(lower.timeZone).toBe('America/New_York')
    expect(lower.start).toBe('2026-11-20T15:00:00.000Z')
    const windows = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=pacific standard time:20261201T090000']))], OPTIONS))
    expect(windows.timeZone).toBe('America/Los_Angeles')
    const path = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=/mozilla.org/20050126_1/america/new_york:20261120T100000']))], OPTIONS))
    expect(path.timeZone).toBe('America/New_York')
    const floating = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000']))], { self: [SELF], localTimeZone: 'america/sao_paulo' }))
    expect(floating.timeZone).toBe('America/Sao_Paulo')
    const withVtimezone = okInvite(parseInvite([icsPart(zonedLower)], OPTIONS))
    expect(withVtimezone.timeZone).toBe('America/New_York')
  })

  it('TZID do Windows sem VTIMEZONE passa pela tabela; horário de verão vem do Intl', () => {
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART;TZID=Eastern Standard Time:20260720T100000']))], OPTIONS))
    expect(invite.timeZone).toBe('America/New_York')
    expect(invite.start).toBe('2026-07-20T14:00:00.000Z')
  })
})

describe('link (CA6)', () => {
  it('ordem: X-GOOGLE-CONFERENCE, X-MICROSOFT-SKYPETEAMSMEETINGURL, X-MICROSOFT-ONLINEMEETINGEXTERNALLINK, URL, LOCATION, DESCRIPTION', () => {
    const all = [
      'DTSTART:20261130T130000Z',
      'DESCRIPTION:https://zoom.us/j/111',
      'LOCATION:https://zoom.us/j/222',
      'URL:https://zoom.us/j/333',
      'X-MICROSOFT-ONLINEMEETINGEXTERNALLINK:https://zoom.us/j/444',
      'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://zoom.us/j/555',
      'X-GOOGLE-CONFERENCE:https://zoom.us/j/666',
    ]
    const expected = ['666', '555', '444', '333', '222', '111']
    for (let index = 0; index < expected.length; index++) {
      const lines = all.slice(0, all.length - index)
      expect(okInvite(parseInvite([icsPart(calendar(lines))], OPTIONS)).joinUrl).toBe(`https://zoom.us/j/${expected[index] ?? ''}`)
    }
  })

  it('o primeiro que dá link vence; FaceTime e Webex ficam fora', () => {
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'X-GOOGLE-CONFERENCE:sem link', 'LOCATION:https://meet.google.com/abc-defg-hij']))], OPTIONS)).joinUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'URL:https://facetime.apple.com/join#v=1&p=EXAMPLE', 'LOCATION:https://example.webex.com/meet/fulano']))], OPTIONS)).joinUrl).toBe(null)
  })
})

describe('texto da recorrência (CA7)', () => {
  const wednesday = { start: '2026-11-25T13:00:00.000Z', timeZone: 'America/Sao_Paulo', allDay: false }
  const day7 = { start: '2026-12-07T13:00:00.000Z', timeZone: 'America/Sao_Paulo', allDay: false }
  const rows: [string, { start: string; timeZone: string | null; allDay: boolean }, string][] = [
    ['FREQ=DAILY', wednesday, 'Todo dia'],
    ['FREQ=DAILY;INTERVAL=3', wednesday, 'A cada 3 dias'],
    ['FREQ=WEEKLY', wednesday, 'Toda semana, às quartas'],
    ['FREQ=WEEKLY;BYDAY=FR', wednesday, 'Toda semana, às sextas'],
    ['FREQ=WEEKLY;BYDAY=SA', wednesday, 'Toda semana, aos sábados'],
    ['FREQ=WEEKLY;BYDAY=MO,WE', wednesday, 'Toda semana, às segundas e quartas'],
    ['FREQ=WEEKLY;BYDAY=SA,MO,WE', wednesday, 'Toda semana, às segundas, quartas e aos sábados'],
    ['FREQ=WEEKLY;BYDAY=SU,SA', wednesday, 'Toda semana, aos sábados e domingos'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', wednesday, 'Todo dia útil (segunda a sexta)'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', wednesday, 'A cada 2 semanas, às terças'],
    ['FREQ=MONTHLY;BYMONTHDAY=15', wednesday, 'Todo mês, no dia 15'],
    ['FREQ=MONTHLY', day7, 'Todo mês, no dia 7'],
    ['FREQ=MONTHLY;BYDAY=2TU', wednesday, 'Todo mês, na segunda terça'],
    ['FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', wednesday, 'Todo mês, na segunda terça'],
    ['FREQ=MONTHLY;BYDAY=1SA', wednesday, 'Todo mês, no primeiro sábado'],
    ['FREQ=MONTHLY;BYDAY=-1FR', wednesday, 'Todo mês, na última sexta'],
    ['FREQ=MONTHLY;BYDAY=-1SU', wednesday, 'Todo mês, no último domingo'],
    ['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1', wednesday, 'A cada 3 meses, no dia 1'],
    ['FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=10', wednesday, 'Todo ano, em 10 de março'],
    ['FREQ=YEARLY', { start: '2026-12-05', timeZone: null, allDay: true }, 'Todo ano, em 5 de dezembro'],
    ['FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYMONTHDAY=1', wednesday, 'A cada 2 anos, em 1 de junho'],
    ['FREQ=DAILY;COUNT=5', wednesday, 'Todo dia, 5 vezes'],
    ['FREQ=WEEKLY;BYDAY=FR;UNTIL=20261218T130000Z', { start: '2026-11-20T13:00:00.000Z', timeZone: 'America/Sao_Paulo', allDay: false }, 'Toda semana, às sextas, até 18 de dezembro'],
    ['FREQ=WEEKLY;BYDAY=MO;UNTIL=20270131T130000Z', { start: '2026-12-07T13:00:00.000Z', timeZone: 'America/Sao_Paulo', allDay: false }, 'Toda semana, às segundas, até 31 de janeiro de 2027'],
    ['FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1', wednesday, 'Repetição personalizada'],
    ['FREQ=HOURLY', wednesday, 'Repetição personalizada'],
    ['FREQ=DAILY;BYHOUR=9,15', wednesday, 'Repetição personalizada'],
    ['isto não é RRULE', wednesday, 'Repetição personalizada'],
  ]
  it('FREQ=DAILY;COUNT=0 → Repetição personalizada (fora da tabela, não grava)', () => {
    expect(describeRecurrence('FREQ=DAILY;COUNT=0', wednesday)).toBe('Repetição personalizada')
  })
  for (const [rrule, dtstart, text] of rows) {
    it(`${rrule} → ${text}`, () => {
      expect(describeRecurrence(rrule, dtstart)).toBe(text)
    })
  }

  it('dia da semana e datas no fuso do evento; sem fuso, UTC', () => {
    // 23:30 de terça em São Paulo é quarta em UTC.
    const lateTuesday = '2026-11-25T02:30:00.000Z'
    expect(describeRecurrence('FREQ=WEEKLY', { start: lateTuesday, timeZone: 'America/Sao_Paulo', allDay: false })).toBe('Toda semana, às terças')
    expect(describeRecurrence('FREQ=WEEKLY', { start: lateTuesday, timeZone: null, allDay: false })).toBe('Toda semana, às quartas')
  })

  it('só RDATE, sem RRULE → "Repetição por datas"', () => {
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'RDATE:20261207T130000Z,20261214T130000Z']))], OPTIONS))
    expect(invite.recurrence).toEqual({ rule: null, exdates: [], text: 'Repetição por datas', storable: false, block: 'rdate' })
  })
})

describe('gravável (CA8)', () => {
  const cases: [readonly string[], boolean, boolean, string | null][] = [
    [['FREQ=DAILY', 'FREQ=WEEKLY'], false, false, 'multiple-rrule'],
    [['FREQ=DAILY'], false, true, 'exrule'],
    [['FREQ=DAILY'], true, false, 'rdate'],
    [['FREQ=SECONDLY'], false, false, 'sub-daily'],
    [['FREQ=MINUTELY;INTERVAL=15'], false, false, 'sub-daily'],
    [['FREQ=HOURLY'], false, false, 'sub-daily'],
    [['FREQ=DAILY;BYHOUR=9'], false, false, 'byhour'],
    [['FREQ=DAILY;BYMINUTE=30'], false, false, 'byminute'],
    [['FREQ=DAILY;BYSECOND=10'], false, false, 'bysecond'],
    [['FREQ=YEARLY;BYWEEKNO=20'], false, false, 'byweekno'],
    [['FREQ=YEARLY;BYYEARDAY=100'], false, false, 'byyearday'],
    [['isto não é RRULE'], false, false, 'invalid'],
    [['FREQ=DAILY;COUNT=3;UNTIL=20261231T000000Z'], false, false, 'invalid'],
    [['FREQ=DAILY;INTERVAL=0'], false, false, 'invalid'],
    [['FREQ=WEEKLY;BYDAY=2MO'], false, false, 'invalid'],
    [['FREQ=DAILY;COUNT=0'], false, false, 'invalid'],
    [['FREQ=DAILY;BYDAY=-1FR'], false, false, 'invalid'],
    [['FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270131T130000Z'], false, false, null],
    [['FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1'], false, false, null],
  ]
  for (const [rrules, rdate, exrule, block] of cases) {
    it(`${rrules.join(' + ')}${rdate ? ' + RDATE' : ''}${exrule ? ' + EXRULE' : ''} → ${block ?? 'grava'}`, () => {
      expect(classifyRecurrence(rrules, rdate, exrule)).toEqual({ storable: block === null, block })
    })
  }

  it('EXDATE não bloqueia, e o parseInvite usa a mesma função (storable e block nunca se contradizem)', () => {
    for (const name of ['icloud-allday.ics', 'weekly-exdate.ics', 'rdate.ics']) {
      const recurrence = okInvite(parseFixture(name)).recurrence
      expect(recurrence).not.toBe(null)
      if (recurrence) expect(recurrence.storable).toBe(recurrence.block === null)
    }
    const many = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY', 'EXRULE:FREQ=DAILY;INTERVAL=2']))], OPTIONS))
    expect(many.recurrence).toMatchObject({ storable: false, block: 'multiple-rrule', text: 'Repetição personalizada' })
    expect(many.recurrence?.rule?.freq).toBe('DAILY')
  })
})

describe('teto e erros (CA9)', () => {
  it('parte acima de 512 KiB → too-big sem chamar o ical.js', () => {
    const spy = vi.spyOn(ICAL, 'parse')
    const big = calendar(['DTSTART:20261130T130000Z', `DESCRIPTION:${'x'.repeat(600 * 1024)}`])
    expect(parseInvite([icsPart(big)], OPTIONS)).toEqual({ ok: false, error: 'too-big' })
    expect(parseInvite([icsPart(new TextEncoder().encode(big))], OPTIONS)).toEqual({ ok: false, error: 'too-big' })
    expect(spy).not.toHaveBeenCalled()
    // O teto é em bytes: 300 mil "ç" são 600 mil bytes em UTF-8.
    expect(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', `DESCRIPTION:${'ç'.repeat(300_000)}`]))], OPTIONS)).toEqual({ ok: false, error: 'too-big' })
    expect(spy).not.toHaveBeenCalled()
    okInvite(parseFixture('zoom-sem-vtimezone.ics'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('2.000 convidados em ~400 KiB: ok, 50 guardados, o próprio achado no 1.999º', () => {
    const attendees = Array.from({ length: 2000 }, (_, index) => {
      const address = index === 1998 ? SELF : `pessoa${String(index).padStart(4, '0')}@example.com`
      return `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Pessoa Convidada Número ${index} da Equipe de Planejamento;X-NUM-GUESTS=0:mailto:${address}`
    })
    const text = calendar(['DTSTART:20261130T130000Z', 'ORGANIZER:mailto:ana@example.com', ...attendees])
    const size = new TextEncoder().encode(text).byteLength
    expect(size).toBeGreaterThan(350 * 1024)
    expect(size).toBeLessThan(INVITE_ICS_MAX_BYTES)
    const invite = okInvite(parseInvite([icsPart(text)], OPTIONS))
    expect(invite.attendees.length).toBe(50)
    expect(invite.attendeeCount).toBe(2000)
    expect(invite.self).toEqual({ address: SELF, name: 'Pessoa Convidada Número 1998 da Equipe de Planejamento', partstat: 'NEEDS-ACTION' })
    expect(invite.warnings).toContain('attendees-clipped')
  })

  it('mais de 200 VEVENTs → too-big; EXDATEs e exceções acima do teto são cortadas', () => {
    const events = (count: number): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', ...Array.from({ length: count }, (_, index) => ['BEGIN:VEVENT', `UID:evento-${index}@example.com`, 'DTSTART:20261130T130000Z', 'END:VEVENT']).flat(), 'END:VCALENDAR'].join('\r\n')
    expect(parseInvite([icsPart(events(INVITE_VEVENTS_MAX + 1))], OPTIONS)).toEqual({ ok: false, error: 'too-big' })
    expect(parseInvite([icsPart(events(INVITE_VEVENTS_MAX))], OPTIONS).ok).toBe(true)

    const exdates = Array.from({ length: 600 }, (_, index) => new Date(Date.UTC(2027, 0, 1 + index, 13)).toISOString().replace(/[-:]|\.\d{3}/g, ''))
    const series = ['BEGIN:VEVENT', 'UID:serie@example.com', 'DTSTART:20261231T130000Z', 'RRULE:FREQ=DAILY', `EXDATE:${exdates.join(',')}`, 'END:VEVENT']
    const exceptions = Array.from({ length: 150 }, (_, index) => {
      const day = new Date(Date.UTC(2029, 0, 1 + index, 13)).toISOString().replace(/[-:]|\.\d{3}/g, '')
      return ['BEGIN:VEVENT', 'UID:serie@example.com', `RECURRENCE-ID:${day}`, `DTSTART:${day}`, 'END:VEVENT']
    }).flat()
    const invite = okInvite(parseInvite([icsPart(['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', ...series, ...exceptions, 'END:VCALENDAR'].join('\r\n'))], OPTIONS))
    expect(invite.recurrence?.exdates.length).toBe(500)
    expect(invite.recurrence?.exdates[0]).toBe('2027-01-01T13:00:00.000Z')
    expect(invite.exceptions.length).toBe(100)
    expect(invite.exceptions[0]?.recurrenceId).toBe('2029-01-01T13:00:00.000Z')
    expect(invite.warnings).toEqual(['exdates-clipped', 'exceptions-clipped'])
  })

  it('texto fora de BEGIN/END (antes ou depois do VCALENDAR) é ignorado', () => {
    const text = fixture('zoom-sem-vtimezone.ics')
    const invite = okInvite(parseInvite([icsPart(`Convite enviado pelo Zoom\n\n${text}\n-- \nlinha de assinatura sem dois-pontos\nX-OUTRA:coisa\nEND:VEVENT\n`)], OPTIONS))
    expect(invite.start).toBe('2026-11-26T12:00:00.000Z')
    expect(invite.source).toBe(text)
  })

  it('malformed: sem END, linha sem ":", vazio, só espaços, VCARD', () => {
    const bad = [
      fixture('malformed.ics'),
      'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261130T130000Z\r\nEND:VEVENT\r\n',
      'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nlinha sem dois-pontos\r\nEND:VCALENDAR\r\n',
      '',
      '   \r\n \t ',
      'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Fulana Exemplo\r\nEMAIL:fulana@example.com\r\nEND:VCARD\r\n',
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
    ]
    for (const text of bad) {
      expect(parseInvite([icsPart(text)], OPTIONS)).toEqual({ ok: false, error: 'malformed' })
      expect(parseInvite([icsPart(new TextEncoder().encode(text))], OPTIONS)).toEqual({ ok: false, error: 'malformed' })
    }
  })

  it('a recorrência nunca é expandida: FREQ=SECONDLY sem fim é lida em tempo constante', () => {
    const iterator = vi.spyOn(ICAL.Recur.prototype, 'iterator')
    const started = performance.now()
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'RRULE:FREQ=SECONDLY']))], OPTIONS))
    expect(performance.now() - started).toBeLessThan(500)
    expect(invite.recurrence).toMatchObject({ storable: false, block: 'sub-daily', text: 'Repetição personalizada' })
    expect(iterator).not.toHaveBeenCalled()
  })

  /** Um convite às 09:00 de 26/11 (ano opcional) no TZID dado, com o VTIMEZONE dado. */
  const zoned = (tzid: string, vtimezone: string[], year = '2026'): string =>
    calendar([`DTSTART;TZID=${tzid}:${year}1126T090000`, `DTEND;TZID=${tzid}:${year}1126T100000`], ['BEGIN:VTIMEZONE', `TZID:${tzid}`, ...vtimezone, 'END:VTIMEZONE'])
  const timed = (text: string): { result: InviteParseResult; ms: number } => {
    const started = performance.now()
    const result = parseInvite([icsPart(text)], OPTIONS)
    return { result, ms: performance.now() - started }
  }
  const standard = (...lines: string[]): string[] => ['BEGIN:STANDARD', ...lines, 'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'END:STANDARD']

  for (const freq of ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']) {
    it(`VTIMEZONE com RRULE FREQ=${freq} desde 1601 é recusado: lido pelo nome, rápido, com aviso`, () => {
      const { result, ms } = timed(zoned('America/Sao_Paulo', standard('DTSTART:16010101T000000', `RRULE:FREQ=${freq}`)))
      expect(ms).toBeLessThan(300)
      const invite = okInvite(result)
      expect(invite.start).toBe('2026-11-26T12:00:00.000Z')
      expect(invite.timeZone).toBe('America/Sao_Paulo')
      expect(invite.warnings).toEqual(['unknown-tzid'])
    })
  }

  it('VTIMEZONE com DTSTART no ano 9999, e evento no ano 9999, saem pelo nome', () => {
    const late = timed(zoned('America/Sao_Paulo', standard('DTSTART:99990101T000000', 'RRULE:FREQ=YEARLY')))
    expect(late.ms).toBeLessThan(300)
    expect(okInvite(late.result).start).toBe('2026-11-26T12:00:00.000Z')
    expect(okInvite(late.result).warnings).toEqual(['unknown-tzid'])
    const farEvent = timed(zoned('America/Sao_Paulo', standard('DTSTART:16010101T000000', 'RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1'), '9999'))
    expect(farEvent.ms).toBeLessThan(300)
    expect(okInvite(farEvent.result).start).toBe('9999-11-26T12:00:00.000Z')
    expect(okInvite(farEvent.result).timeZone).toBe('America/Sao_Paulo')
    expect(okInvite(farEvent.result).warnings).toEqual(['unknown-tzid'])
    const inventedFar = timed(zoned('Fuso Inventado', standard('DTSTART:16010101T000000'), '9999'))
    expect(okInvite(inventedFar.result).start).toBe('9999-11-26T12:00:00.000Z')
  })

  it('RDATE em massa, subcomponentes demais ou regra anual larga demais: recusado, rápido', () => {
    const rdates = Array.from({ length: 5000 }, (_, index) => `${1700 + Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, '0')}01T000000`)
    const cases = [
      standard('DTSTART:17000101T000000', `RDATE:${rdates.join(',')}`),
      Array.from({ length: 150 }, (_, index) => standard(`DTSTART:${1700 + index}0101T000000`)).flat(),
      standard('DTSTART:16010101T000000', 'RRULE:FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYDAY=MO,TU,WE,TH,FR,SA,SU'),
      standard('DTSTART:16010101T000000', 'RRULE:FREQ=YEARLY;BYYEARDAY=1,2,3,4,5,6,7,8,9,10'),
      standard('DTSTART:16010101T000000', 'RRULE:FREQ=YEARLY', 'RRULE:FREQ=YEARLY;BYMONTH=6'),
      ['BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'BEGIN:STANDARD', 'END:STANDARD', 'END:STANDARD'],
    ]
    for (const vtimezone of cases) {
      const { result, ms } = timed(zoned('America/Sao_Paulo', vtimezone))
      expect(ms).toBeLessThan(500)
      expect(okInvite(result).start).toBe('2026-11-26T12:00:00.000Z')
      expect(okInvite(result).warnings).toEqual(['unknown-tzid'])
    }
  })

  it('o VTIMEZONE normal (Outlook desde 1601, regra anual do estilo libical) continua valendo', () => {
    const custom = timed(zoned('Customized Time Zone', [
      'BEGIN:STANDARD', 'DTSTART:16010101T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=25,26,27,28,29,30,31;BYDAY=SU', 'END:DAYLIGHT',
    ]))
    expect(custom.ms).toBeLessThan(300)
    const invite = okInvite(custom.result)
    // 26/11 é inverno no fuso inventado: +0100.
    expect(invite.start).toBe('2026-11-26T08:00:00.000Z')
    expect(invite.timeZone).toBe(null)
    expect(invite.warnings).toEqual([])
    const outlook = okInvite(parseFixture('outlook-windows-tz.ics'))
    expect(outlook.start).toBe('2026-11-24T17:00:00.000Z')
    expect(outlook.warnings).toEqual([])
  })

  it('nunca lança: 50 rodadas de 4 KiB aleatórios e de fixtures embaralhadas', () => {
    const random = seeded(59)
    const texts = ['google-cancel.ics', 'outlook-windows-tz.ics', 'weekly-exdate.ics', 'icloud-allday.ics', 'zoom-sem-vtimezone.ics'].map(fixture)
    for (let round = 0; round < 50; round++) {
      const bytes = Uint8Array.from({ length: 4096 }, () => Math.floor(random() * 256))
      expect(() => parseInvite([icsPart(bytes)], OPTIONS)).not.toThrow()
      expect(parseInvite([icsPart(bytes)], OPTIONS).ok).toBe(false)
      const lines = (texts[round % texts.length] ?? '').split(/\r?\n/)
      for (let swap = 0; swap < 4; swap++) {
        const a = Math.floor(random() * lines.length)
        const b = Math.floor(random() * lines.length)
        ;[lines[a], lines[b]] = [lines[b] ?? '', lines[a] ?? '']
      }
      const cut = lines.join('\r\n').slice(0, Math.floor(random() * 4096))
      let result: InviteParseResult | undefined
      expect(() => {
        result = parseInvite([icsPart(cut)], OPTIONS)
      }).not.toThrow()
      if (result?.ok) {
        const invite = result.invite
        expect(() => buildReply(invite, { partstat: 'ACCEPTED', self: [SELF], now: NOW })).not.toThrow()
        expect(() => buildReply({ ...invite, method: 'REQUEST', source: invite.source.slice(0, Math.floor(random() * invite.source.length)) }, { partstat: 'ACCEPTED', self: [SELF], now: NOW })).not.toThrow()
      }
    }
  })
})

describe('versão (CA10)', () => {
  it('SEQUENCE, depois DTSTAMP; null é menor que qualquer data', async () => {
    const request = await googleRequest()
    const cancel = okInvite(parseFixture('google-cancel.ics'))
    expect(compareInviteVersion(cancel, request)).toBe(1)
    expect(compareInviteVersion(request, cancel)).toBe(-1)
    expect(compareInviteVersion(request, request)).toBe(0)
    expect(compareInviteVersion({ sequence: 1, dtstamp: null }, { sequence: 0, dtstamp: '2030-01-01T00:00:00.000Z' })).toBe(1)
    expect(compareInviteVersion({ sequence: 0, dtstamp: null }, { sequence: 0, dtstamp: '2026-11-18T12:00:00.000Z' })).toBe(-1)
    expect(compareInviteVersion({ sequence: 0, dtstamp: '2026-11-19T12:00:00.000Z' }, { sequence: 0, dtstamp: '2026-11-18T12:00:00.000Z' })).toBe(1)
    expect(compareInviteVersion({ sequence: 2, dtstamp: null }, { sequence: 2, dtstamp: null })).toBe(0)
  })
})

describe('REPLY (CA11)', () => {
  const sources: [string, () => Promise<EmailInvite>][] = [
    ['google-request.eml', googleRequest],
    ['outlook-windows-tz.ics', async () => okInvite(parseFixture('outlook-windows-tz.ics'))],
    ['icloud-allday.ics', async () => okInvite(parseFixture('icloud-allday.ics'))],
    ['occurrence-request.ics', async () => okInvite(parseFixture('occurrence-request.ics'))],
  ]
  const partstats: InviteReplyPartstat[] = ['ACCEPTED', 'TENTATIVE', 'DECLINED']

  for (const [name, load] of sources) {
    it(`${name}: o REPLY relido dá o mesmo convite com uma resposta`, async () => {
      const invite = await load()
      for (const partstat of partstats) {
        const reply = buildReply(invite, { partstat, self: [SELF], now: NOW })
        if (!reply.ok) throw new Error(reply.error)
        expect(reply.filename).toBe('invite.ics')
        expect(reply.contentType).toBe('text/calendar; charset=utf-8; method=REPLY')
        expect(reply.to).toEqual(invite.organizer)
        expect(reply.subject).toBe(`${{ ACCEPTED: 'Aceito', TENTATIVE: 'Talvez', DECLINED: 'Recusado' }[partstat]}: ${invite.title}`)
        const back = okInvite(parseInvite([icsPart(reply.ics, 'REPLY', reply.contentType)], OPTIONS))
        expect(back.method).toBe('REPLY')
        expect(back.uid).toBe(invite.uid)
        expect(back.sequence).toBe(invite.sequence)
        expect(back.start).toBe(invite.start)
        expect(back.end).toBe(invite.end)
        expect(back.recurrenceId).toBe(invite.recurrenceId)
        expect(back.dtstamp).toBe(NOW.toISOString())
        expect(back.attendees.length).toBe(1)
        expect(back.attendees[0]?.partstat).toBe(partstat)
        expect(back.attendees[0]?.address).toBe(SELF)
      }
    })
  }

  it('formato: CRLF, até 75 octetos por linha, cabeçalho, linhas copiadas do convite e nada além do necessário', async () => {
    const invite = await googleRequest()
    const reply = buildReply(invite, { partstat: 'TENTATIVE', self: [SELF], now: NOW })
    if (!reply.ok) throw new Error(reply.error)
    const { ics } = reply
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
    expect(ics.replace(/\r\n/g, '').includes('\r')).toBe(false)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
    const lines = unfold(ics)
    expect(lines.slice(0, 5)).toEqual(['BEGIN:VCALENDAR', 'PRODID:-//LAP//LAP Reunioes//PT-BR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:REPLY'])
    expect(lines.filter((line) => line === 'BEGIN:VEVENT').length).toBe(1)
    expect(lines.filter((line) => line === 'BEGIN:VTIMEZONE').length).toBe(1)
    const original = unfold(invite.source)
    const vtimezone = original.slice(original.indexOf('BEGIN:VTIMEZONE'), original.indexOf('END:VTIMEZONE') + 1)
    expect(lines.slice(lines.indexOf('BEGIN:VTIMEZONE'), lines.indexOf('END:VTIMEZONE') + 1)).toEqual(vtimezone)
    const event = lines.slice(lines.indexOf('BEGIN:VEVENT'), lines.indexOf('END:VEVENT') + 1)
    const from = (prefix: string): string | undefined => original.find((line) => line.startsWith(prefix))
    expect(event).toEqual([
      'BEGIN:VEVENT',
      from('UID:'),
      'SEQUENCE:0',
      'DTSTAMP:20261119T183000Z',
      from('DTSTART;'),
      from('DTEND;'),
      from('SUMMARY:'),
      from('ORGANIZER;'),
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE;CN=andrew.teste@example.org;X-NUM-GUESTS=0:mailto:andrew.teste@example.org',
      'END:VEVENT',
    ])
    expect(ics.match(/^ATTENDEE/gm)?.length).toBe(1)
    for (const banned of [/^DESCRIPTION/m, /^LOCATION/m, /^URL/m, /^BEGIN:VALARM/m, /^ATTACH/m, /RSVP/]) expect(ics).not.toMatch(banned)
    // Os X- ficam fora do VEVENT; o VTIMEZONE vai como veio (o do Google tem X-LIC-LOCATION).
    expect(event.some((line) => line.startsWith('X-'))).toBe(false)
  })

  it('ATTENDEE com a caixa do convite e o CN entre aspas; RECURRENCE-ID só na ocorrência; DURATION copiado', () => {
    const outlook = okInvite(parseFixture('outlook-windows-tz.ics'))
    const reply = buildReply(outlook, { partstat: 'DECLINED', self: [SELF], now: NOW })
    if (!reply.ok) throw new Error(reply.error)
    const lines = unfold(reply.ics)
    expect(lines).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=DECLINED;CN=Andrew Teste:mailto:Andrew.Teste@example.org')
    expect(lines).toContain('ORGANIZER;CN="Carla Exemplo":mailto:carla@example.com')
    expect(lines).toContain('SUMMARY;LANGUAGE=pt-BR:Planejamento — orçamento 2027')
    expect(lines).toContain('TZID:E. South America Standard Time')
    expect(lines.some((line) => line.startsWith('RECURRENCE-ID'))).toBe(false)
    expect(reply.subject).toBe('Recusado: Planejamento — orçamento 2027')

    const occurrence = buildReply(okInvite(parseFixture('occurrence-request.ics')), { partstat: 'ACCEPTED', self: [SELF], now: NOW })
    if (!occurrence.ok) throw new Error(occurrence.error)
    expect(unfold(occurrence.ics)).toContain('RECURRENCE-ID;TZID=America/Sao_Paulo:20261209T100000')
    expect(unfold(occurrence.ics)).toContain('SEQUENCE:1')

    const withDuration = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'DURATION:PT45M', 'SUMMARY:Curta', 'ORGANIZER:mailto:ana@example.com', 'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:andrew.teste@example.org']).replace('DTSTAMP', 'SEQUENCE:3\r\nDTSTAMP'))], OPTIONS))
    const durationReply = buildReply(withDuration, { partstat: 'ACCEPTED', self: [SELF], now: NOW })
    if (!durationReply.ok) throw new Error(durationReply.error)
    expect(unfold(durationReply.ics)).toContain('DURATION:PT45M')
    expect(unfold(durationReply.ics)).toContain('SEQUENCE:3')
    expect(unfold(durationReply.ics)).toContain('ATTENDEE;PARTSTAT=ACCEPTED:mailto:andrew.teste@example.org')
    const noSequence = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'ORGANIZER:mailto:ana@example.com', 'ATTENDEE:mailto:andrew.teste@example.org']))], OPTIONS))
    const noSequenceReply = buildReply(noSequence, { partstat: 'ACCEPTED', self: [SELF], now: NOW })
    if (!noSequenceReply.ok) throw new Error(noSequenceReply.error)
    expect(unfold(noSequenceReply.ics)).toContain('SEQUENCE:0')
    expect(unfold(noSequenceReply.ics)).toContain('ATTENDEE;PARTSTAT=ACCEPTED:mailto:andrew.teste@example.org')
  })

  it('zoom sem VTIMEZONE: REPLY sem VTIMEZONE e com o DTSTART copiado', () => {
    const reply = buildReply(okInvite(parseFixture('zoom-sem-vtimezone.ics')), { partstat: 'ACCEPTED', self: [SELF], now: NOW })
    if (!reply.ok) throw new Error(reply.error)
    expect(reply.ics).not.toMatch(/VTIMEZONE/)
    expect(unfold(reply.ics)).toContain('DTSTART;TZID=America/Sao_Paulo:20261126T090000')
    expect(reply.ics).not.toMatch(/\nTZID:/)
  })

  it('os erros: not-request, not-invited, no-organizer, invalid, malformed', async () => {
    const invite = await googleRequest()
    const options = { partstat: 'ACCEPTED' as const, self: [SELF], now: NOW }
    expect(buildReply(okInvite(parseFixture('google-cancel.ics')), options)).toEqual({ ok: false, error: 'not-request' })
    expect(buildReply(okInvite(parseFixture('reply-received.ics')), options)).toEqual({ ok: false, error: 'not-request' })
    expect(buildReply(invite, { ...options, self: ['outra@example.org'] })).toEqual({ ok: false, error: 'not-invited' })
    expect(buildReply({ ...invite, organizer: null }, options)).toEqual({ ok: false, error: 'no-organizer' })
    const urnOrganizer = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', 'ORGANIZER:urn:uuid:00000000-0000-0000-0000-000000000001', 'ATTENDEE:mailto:andrew.teste@example.org']))], OPTIONS))
    expect(buildReply(urnOrganizer, options)).toEqual({ ok: false, error: 'no-organizer' })
    expect(buildReply(invite, { ...options, partstat: 'NEEDS-ACTION' as InviteReplyPartstat })).toEqual({ ok: false, error: 'invalid' })
    expect(buildReply(invite, { ...options, now: new Date(Number.NaN) })).toEqual({ ok: false, error: 'invalid' })
    expect(buildReply({ ...invite, source: 'isto não é iCalendar' }, options)).toEqual({ ok: false, error: 'malformed' })
    expect(buildReply({ ...invite, uid: 'outro@example.com' }, options)).toEqual({ ok: false, error: 'malformed' })
  })

  it('determinismo: o mesmo convite e o mesmo agora dão o mesmo ics byte a byte', async () => {
    const first = buildReply(await googleRequest(), { partstat: 'ACCEPTED', self: [SELF], now: new Date(NOW.getTime()) })
    const second = buildReply(await googleRequest(), { partstat: 'ACCEPTED', self: [SELF], now: new Date(NOW.getTime()) })
    expect(first.ok && second.ok && first.ics === second.ics).toBe(true)
  })

  it('dobra sem partir caractere UTF-8', () => {
    const title = `Reunião ${'çã€😀'.repeat(40)}`
    const invite = okInvite(parseInvite([icsPart(calendar(['DTSTART:20261130T130000Z', `SUMMARY:${title}`, 'ORGANIZER:mailto:ana@example.com', 'ATTENDEE:mailto:andrew.teste@example.org']))], OPTIONS))
    const reply = buildReply(invite, { partstat: 'ACCEPTED', self: [SELF], now: NOW })
    if (!reply.ok) throw new Error(reply.error)
    for (const line of reply.ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
      expect(line.includes('\uFFFD')).toBe(false)
    }
    expect(unfold(reply.ics)).toContain(`SUMMARY:${title}`)
    expect(okInvite(parseInvite([icsPart(reply.ics, 'REPLY')], OPTIONS)).title).toBe(clipTitle(title))
  })
})

/** O título como o `parseInvite` guarda (até 200 unidades UTF-16, sem partir surrogate). */
function clipTitle(title: string): string {
  const cut = title.slice(0, 200)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

describe('empacotamento (CA12, estático)', () => {
  it('ical.js 2.2.1 exato e embutido no main', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['ical.js']).toBe('2.2.1')
    const config = readFileSync(join(ROOT, 'electron.vite.config.ts'), 'utf8')
    const main = config.slice(config.indexOf('main: {'), config.indexOf('preload: {'))
    expect(main).toMatch(/externalizeDeps:\s*\{\s*exclude:\s*\[[^\]]*'ical\.js'[^\]]*\]/)
  })
})

describe('fusos do Windows (CA13)', () => {
  it('a tabela do CLDR: pelo menos 130 nomes, todos aceitos pelo Intl', () => {
    const entries = Object.entries(WINDOWS_ZONES)
    expect(entries.length).toBeGreaterThanOrEqual(130)
    for (const [, timeZone] of entries) expect(() => new Intl.DateTimeFormat('en', { timeZone })).not.toThrow()
  })

  it('os nomes que importam', () => {
    const expected: Record<string, string> = {
      'E. South America Standard Time': 'America/Sao_Paulo',
      'SA Eastern Standard Time': 'America/Cayenne',
      'Central Brazilian Standard Time': 'America/Cuiaba',
      'Tocantins Standard Time': 'America/Araguaina',
      'Bahia Standard Time': 'America/Bahia',
      'SA Western Standard Time': 'America/La_Paz',
      'Eastern Standard Time': 'America/New_York',
      'Central Standard Time': 'America/Chicago',
      'Pacific Standard Time': 'America/Los_Angeles',
      'GMT Standard Time': 'Europe/London',
      'W. Europe Standard Time': 'Europe/Berlin',
      'Romance Standard Time': 'Europe/Paris',
      'Tokyo Standard Time': 'Asia/Tokyo',
      UTC: 'Etc/UTC',
    }
    for (const [name, zone] of Object.entries(expected)) expect(windowsToIana(name)).toBe(zone)
    expect(windowsToIana('  "pacific standard time" ')).toBe('America/Los_Angeles')
    expect(windowsToIana('Customized Time Zone')).toBe(null)
  })
})

describe('anonimização (CA14)', () => {
  /** O único endereço fora de example.*: o domínio técnico do UID inventado do Google. */
  const ALLOWED = new Set(['7kq2m9v0c3exampleuid@google.com'])
  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g

  /** Nas linhas desdobradas: a dobra do iCalendar pode partir um endereço no meio. */
  const check = (where: string, text: string): void => {
    for (const found of text.replace(/\r?\n[ \t]/g, '').match(EMAIL) ?? []) {
      const address = found.toLowerCase()
      if (ALLOWED.has(address)) continue
      expect(/@example\.(com|org|net)$/.test(address), `${where}: ${found}`).toBe(true)
    }
  }

  it('todo endereço das fixtures é example.com, example.org ou example.net (salvo o UID do Google)', async () => {
    const files = readdirSync(FIXTURES)
    expect(files.length).toBe(14)
    for (const name of files) {
      const path = join(FIXTURES, name)
      expect(statSync(path).isFile()).toBe(true)
      check(name, readFileSync(path, 'utf8'))
      if (name.endsWith('.eml')) {
        const parsed = await simpleParser(readFileSync(path))
        check(`${name} (texto)`, parsed.text ?? '')
        check(`${name} (html)`, typeof parsed.html === 'string' ? parsed.html : '')
        check(`${name} (assunto)`, parsed.subject ?? '')
        for (const item of parsed.attachments) check(`${name} (${item.contentType})`, item.content.toString('utf8'))
      }
    }
  })
})

describe('módulo puro e renderer (Invariantes)', () => {
  it('invite.ts e windows-zones.ts importam só ical.js, ./calendar e ./windows-zones, sem relógio nem rede', () => {
    for (const name of ['invite.ts', 'windows-zones.ts']) {
      const text = readFileSync(join(ROOT, 'src', 'shared', name), 'utf8')
      const imports = [...text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1])
      for (const spec of imports) expect(['ical.js', './calendar', './windows-zones', 'zod'], `${name}: ${spec ?? ''}`).toContain(spec)
      for (const banned of ['Date.now(', 'new Date()', 'fetch(', 'require(', 'process.', "from 'node:", 'electron']) expect(text.includes(banned), `${name}: ${banned}`).toBe(false)
    }
  })

  it('nenhum arquivo do renderer importa valor de shared/invite', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          for (const line of readFileSync(path, 'utf8').split('\n')) {
            if (/from ['"](@shared|\.\.?(\/\.\.)*\/shared)\/invite['"]/.test(line) && !/^\s*import type\b/.test(line)) offenders.push(`${path}: ${line}`)
          }
        }
      }
    }
    walk(join(ROOT, 'src', 'renderer', 'src'))
    expect(offenders).toEqual([])
  })
})
