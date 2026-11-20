// Textos do cartão do convite (contrato 63, CA24): a hora no fuso do Mac (mesmo dia, virada de dia, dia inteiro, ano
// diferente, a duração e o fuso de origem só quando o deslocamento é outro), a cidade do fuso, o serviço do link, os
// convidados, a linha "Você aceitou …", a frase do "não é para você" e as frases dos erros do REPLY.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { InviteReplySendError } from '../../src/shared/email'
import {
  attendeesLabel,
  durationLabel,
  INVITE_REPLY_ERRORS,
  inviteWhen,
  joinLabel,
  joinService,
  notForLine,
  occurrenceDay,
  recurrenceBlockLabel,
  responseHead,
  responseLine,
  whenDiff,
  zoneCity,
} from '../../src/renderer/src/features/email/inviteFormat'

const SP = 'America/Sao_Paulo'
/** 19/11/2026 14:00 em São Paulo. */
const NOW = Date.parse('2026-11-19T17:00:00.000Z')
const timed = (start: string, end: string, timeZone: string | null = SP) => ({ start, end, allDay: false, timeZone })
const allDay = (start: string, end: string) => ({ start, end, allDay: true, timeZone: null })

describe('inviteWhen', () => {
  // O fuso do processo não conta: o do Mac vem por parâmetro. Fixado mesmo assim, para nada depender da máquina.
  beforeAll(() => {
    vi.stubEnv('TZ', 'Asia/Tokyo')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('mesmo dia, no fuso do Mac, com a duração', () => {
    const when = inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z'), SP, NOW)
    expect(when.text).toBe('sex, 20 de novembro · 15:00–16:00 · 1 h')
    expect(when.main).toBe('sex, 20 de novembro · 15:00–16:00')
    expect(when.duration).toBe('1 h')
    expect(when.origin).toBeNull()
  })

  it('virada de dia', () => {
    expect(inviteWhen(timed('2026-11-21T01:00:00.000Z', '2026-11-21T04:00:00.000Z'), SP, NOW).text).toBe('sex, 20 de novembro, 22:00 – sáb, 21 de novembro, 01:00 · 3 h')
  })

  it('dia inteiro de 1 e de 3 dias (o fim é exclusivo), sem fuso de origem', () => {
    expect(inviteWhen(allDay('2026-11-20', '2026-11-21'), SP, NOW)).toMatchObject({ text: 'sex, 20 de novembro · dia inteiro', duration: null, origin: null })
    expect(inviteWhen(allDay('2026-11-20', '2026-11-23'), SP, NOW).text).toBe('sex, 20 – dom, 22 de novembro · dia inteiro')
  })

  it('ano diferente do atual entra depois do mês', () => {
    expect(inviteWhen(timed('2027-01-07T13:00:00.000Z', '2027-01-07T13:30:00.000Z'), SP, NOW).text).toBe('qui, 7 de janeiro de 2027 · 10:00–10:30 · 30 min')
  })

  it('a duração: 30 min, 1 h, 1 h 30 min, 2 h', () => {
    expect([30, 60, 90, 120].map(durationLabel)).toEqual(['30 min', '1 h', '1 h 30 min', '2 h'])
    expect(inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:30:00.000Z'), SP, NOW).duration).toBe('1 h 30 min')
  })

  it('o fuso de origem só quando o deslocamento é outro', () => {
    const ny = inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z', 'America/New_York'), SP, NOW)
    expect(ny.origin).toBe('13:00–14:00 no horário de Nova York (America/New_York)')
    // America/Bahia tem o mesmo deslocamento de São Paulo: sem a linha.
    expect(inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z', 'America/Bahia'), SP, NOW).origin).toBeNull()
    expect(inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z', null), SP, NOW).origin).toBeNull()
  })

  it('a mudança mostra só o trecho que mudou; o dia que mudou entra inteiro', () => {
    const before = inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z'), SP, NOW)
    const after = inviteWhen(timed('2026-11-20T19:30:00.000Z', '2026-11-20T20:30:00.000Z'), SP, NOW)
    const pieces = whenDiff(before, after)
    expect(pieces.map((piece) => piece.text).join('')).toBe('sex, 20 de novembro · 15:00 → 16:30–17:30')
    expect(pieces.filter((piece) => piece.mark).map((piece) => `${piece.mark}:${piece.text}`)).toEqual(['old:15:00', 'new:16:30'])
    const endOnly = whenDiff(before, inviteWhen(timed('2026-11-20T18:00:00.000Z', '2026-11-20T20:00:00.000Z'), SP, NOW))
    expect(endOnly.map((piece) => piece.text).join('')).toBe('sex, 20 de novembro · 15:00–16:00 → 17:00')
    const otherDay = whenDiff(before, inviteWhen(timed('2026-11-23T18:00:00.000Z', '2026-11-23T19:00:00.000Z'), SP, NOW))
    expect(otherDay).toEqual([
      { text: 'sex, 20 de novembro · 15:00–16:00', mark: 'old' },
      { text: ' → ', mark: null },
      { text: 'seg, 23 de novembro · 15:00–16:00', mark: 'new' },
    ])
  })

  it('o dia de uma ocorrência cancelada', () => {
    expect(occurrenceDay('2026-12-17T13:00:00Z', SP, NOW)).toBe('qui, 17 de dezembro')
    expect(occurrenceDay('2026-12-17', SP, NOW)).toBe('qui, 17 de dezembro')
  })
})

describe('zoneCity', () => {
  it('a tabela e, fora dela, o último pedaço com espaço no lugar do _', () => {
    expect(zoneCity('America/New_York')).toBe('Nova York')
    expect(zoneCity('America/Sao_Paulo')).toBe('São Paulo')
    expect(zoneCity('Asia/Tokyo')).toBe('Tóquio')
    expect(zoneCity('UTC')).toBe('UTC')
    expect(zoneCity('America/Port_of_Spain')).toBe('Port of Spain')
    expect(zoneCity('Africa/Lagos')).toBe('Lagos')
  })
})

describe('joinService', () => {
  it('Meet, Teams nos dois domínios, Zoom com subdomínio, Webex e outro', () => {
    expect(joinService('https://meet.google.com/abc-defg-hij')).toBe('Google Meet')
    expect(joinService('https://teams.microsoft.com/l/meetup-join/x')).toBe('Microsoft Teams')
    expect(joinService('https://teams.live.com/meet/123')).toBe('Microsoft Teams')
    expect(joinService('https://us02web.zoom.us/j/123')).toBe('Zoom')
    expect(joinService('https://zoom.us/j/123')).toBe('Zoom')
    expect(joinService('https://empresa.webex.com/meet/fulano')).toBe('Webex')
    expect(joinService('https://whereby.com/sala')).toBe('whereby.com')
  })

  it('o link sem https:// e sem a barra final', () => {
    expect(joinLabel('https://meet.google.com/abc-defg-hij/')).toBe('meet.google.com/abc-defg-hij')
  })
})

describe('attendeesLabel', () => {
  it('0, 1 e 8', () => {
    expect(attendeesLabel(0)).toBe('')
    expect(attendeesLabel(1)).toBe('1 convidado')
    expect(attendeesLabel(8)).toBe('8 convidados')
  })
})

describe('responseLine', () => {
  const organizer = { name: 'Daniel Brooks', address: 'daniel.brooks@northwind.example' }
  const today = Date.parse('2026-11-19T14:20:00.000Z')
  const yesterday = Date.parse('2026-11-18T12:05:00.000Z')
  const older = Date.parse('2026-11-16T17:00:00.000Z')

  it('cada resposta, hoje, ontem e outra data', () => {
    expect(responseLine({ partstat: 'ACCEPTED', at: today }, organizer, SP, NOW)).toBe('Você aceitou hoje às 11:20. Resposta enviada a Daniel Brooks.')
    expect(responseLine({ partstat: 'TENTATIVE', at: yesterday }, organizer, SP, NOW)).toBe('Você marcou talvez ontem às 09:05. Resposta enviada a Daniel Brooks.')
    expect(responseLine({ partstat: 'DECLINED', at: older }, organizer, SP, NOW)).toBe('Você recusou em 16/11 às 14:00. Resposta enviada a Daniel Brooks.')
    expect(responseHead({ partstat: 'ACCEPTED', at: today }, SP, NOW)).toBe('Você aceitou hoje às 11:20')
  })

  it('organizador sem nome: o endereço', () => {
    expect(responseLine({ partstat: 'ACCEPTED', at: today }, { name: null, address: 'agenda@northwind.example' }, SP, NOW)).toBe('Você aceitou hoje às 11:20. Resposta enviada a agenda@northwind.example.')
  })
})

describe('notForLine', () => {
  const people = Array.from({ length: 8 }, (_, index) => ({ address: `pessoa${index + 1}@northwind.example` }))
  it('0, 1 e 8 convidados', () => {
    expect(notForLine([], 0)).toBe('O convite não lista convidados. Para responder, abra o convite na conta convidada. Pôr na agenda continua possível.')
    expect(notForLine(people.slice(0, 1), 1)).toBe('Os convidados são outros endereços (pessoa1@northwind.example). Para responder, abra o convite na conta convidada. Pôr na agenda continua possível.')
    expect(notForLine(people, 8)).toBe('Os convidados são outros endereços (pessoa1@northwind.example e mais 7). Para responder, abra o convite na conta convidada. Pôr na agenda continua possível.')
  })
})

describe('recurrenceBlockLabel', () => {
  it('o motivo curto de cada bloqueio', () => {
    expect(recurrenceBlockLabel('rdate')).toBe('Repetição por datas (RDATE)')
    expect(recurrenceBlockLabel('sub-daily')).toBe('Repete mais de uma vez por dia')
    expect(recurrenceBlockLabel('byminute')).toBe('Repetição por horário')
    expect(recurrenceBlockLabel('multiple-rrule')).toBe('Mais de uma regra de repetição')
    expect(recurrenceBlockLabel('exrule')).toBe('Repetição fora do padrão')
  })
})

describe('INVITE_REPLY_ERRORS', () => {
  it('tem os 14 códigos do InviteReplySendError', () => {
    const codes: InviteReplySendError[] = ['click', 'invalid', 'account', 'not-found', 'no-invite', 'not-request', 'busy', 'no-organizer', 'not-invited', 'malformed', 'auth', 'connection', 'rejected', 'failed']
    expect(Object.keys(INVITE_REPLY_ERRORS).sort()).toEqual([...codes].sort())
    expect(INVITE_REPLY_ERRORS.click).toBe('Clique de novo para responder.')
    expect(INVITE_REPLY_ERRORS.failed).toBe('Não foi possível enviar a resposta. Tente de novo.')
  })
})
