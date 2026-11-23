// Contrato 133 (inicio): as regras puras da tela Início. A agenda juntando contas e Calendário do Mac sem repetir
// evento (D7), as pendências do WhatsApp e dos convites (D8), o dia local num fuso e a reunião gravada do evento (D10).
import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../src/shared/calendar'
import {
  chamadaDe,
  convitesSemResposta,
  diaLocal,
  fimDeAmanha,
  inicioDoDiaLocal,
  juntarAgenda,
  normalizar,
  reuniaoDoEvento,
  whatsappSemResposta,
  type InicioEvento,
  type InicioMacEvento,
} from '../src/shared/inicio'
import type { Meeting } from '../src/shared/meetings'
import type { WhatsAppChat } from '../src/shared/whatsapp'

const TZ = 'America/Sao_Paulo'

let seq = 0
const conta = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  provider: 'google',
  calendarId: 'primary',
  id: `g-${++seq}`,
  title: 'Planejamento',
  start: '2026-11-23T13:00:00.000Z',
  end: '2026-11-23T14:00:00.000Z',
  allDay: false,
  status: 'confirmed',
  myResponse: 'accepted',
  attendees: [{ name: 'Ana', email: 'ana@exemplo.com' }],
  joinUrl: null,
  uid: null,
  ...patch,
})

const mac = (patch: Partial<InicioMacEvento> = {}): InicioMacEvento => ({
  calendarItemIdentifier: `m-${++seq}`,
  externalIdentifier: null,
  title: 'Planejamento',
  start: '2026-11-23T13:00:00Z',
  end: '2026-11-23T14:00:00Z',
  allDay: false,
  url: null,
  ...patch,
})

describe('normalizar (D7)', () => {
  it('tira acentos, caixa, pontuação, espaços repetidos e os prefixos de convite', () => {
    expect(normalizar('  Reunião   de   Revisão!! ')).toBe('reuniao de revisao')
    expect(normalizar('Convite: Revisão — Q4')).toBe('revisao q4')
    expect(normalizar('Invitation: Weekly sync')).toBe('weekly sync')
    expect(normalizar('Updated invitation: Weekly sync')).toBe('weekly sync')
    expect(normalizar('CONVITE : Ação/Comercial')).toBe('acao comercial')
    expect(normalizar('Convite: Invitation: Alinhamento')).toBe('alinhamento')
  })
})

describe('juntarAgenda (D7)', () => {
  it('uid do convite igual ao externalIdentifier do Mac: uma linha, a cópia da conta, as duas fontes', () => {
    const google = conta({ uid: 'abc123@google.com', title: 'Kickoff', joinUrl: 'https://meet.google.com/abc-defg-hij' })
    const copia = mac({ externalIdentifier: 'abc123@google.com', title: 'Outro título no Mac', start: '2026-11-23T15:00:00Z', end: '2026-11-23T16:00:00Z' })
    const agenda = juntarAgenda([google], [copia], TZ)
    expect(agenda).toHaveLength(1)
    expect(agenda[0]).toMatchObject({ id: `google:primary:${google.id}`, titulo: 'Kickoff', fontes: ['google', 'mac'], calendarKey: `google:primary:${google.id}`, eventId: google.id, chamada: 'meet' })
  })

  it('uid compara exato: caixa diferente e título e horário diferentes não juntam', () => {
    const agenda = juntarAgenda([conta({ uid: 'ABC@x', title: 'Kickoff' })], [mac({ externalIdentifier: 'abc@x', title: 'Outra coisa', start: '2026-11-23T18:00:00Z', end: '2026-11-23T19:00:00Z' })], TZ)
    expect(agenda).toHaveLength(2)
  })

  it('título equivalente por normalizar (acentos e prefixos convite:/invitation:) e início no mesmo minuto juntam', () => {
    const google = conta({ title: 'Reunião: Planejamento Comercial' })
    const copia = mac({ title: 'Convite: reuniao planejamento comercial', start: '2026-11-23T13:00:30Z', end: '2026-11-23T15:00:00Z' })
    expect(juntarAgenda([google], [copia], TZ)).toEqual([expect.objectContaining({ fontes: ['google', 'mac'] })])
    const microsoft = conta({ provider: 'microsoft', calendarId: 'default', title: 'Weekly Sync', start: '2026-11-23T17:00:00.000Z', end: '2026-11-23T17:30:00.000Z' })
    const copiaMs = mac({ title: 'Invitation: weekly sync', start: '2026-11-23T17:00:00Z', end: '2026-11-23T17:30:00Z' })
    expect(juntarAgenda([microsoft], [copiaMs], TZ)).toEqual([expect.objectContaining({ fontes: ['microsoft', 'mac'], calendarKey: `microsoft:default:${microsoft.id}` })])
    const atualizado = mac({ title: 'Updated invitation: Weekly Sync', start: '2026-11-23T17:00:00Z', end: '2026-11-23T17:30:00Z' })
    expect(juntarAgenda([microsoft], [atualizado], TZ)).toHaveLength(1)
  })

  it('início a 60 s ou mais não junta, mesmo com o título igual', () => {
    expect(juntarAgenda([conta()], [mac({ start: '2026-11-23T13:01:00Z' })], TZ)).toHaveLength(2)
    expect(juntarAgenda([conta()], [mac({ start: '2026-11-23T12:59:00Z' })], TZ)).toHaveLength(2)
    expect(juntarAgenda([conta()], [mac({ start: '2026-11-23T13:00:59Z' })], TZ)).toHaveLength(1)
  })

  it('um título começando com o outro (≥ 6 caracteres) só junta com o fim também igual', () => {
    const google = conta({ title: 'Planejamento' })
    expect(juntarAgenda([google], [mac({ title: 'Planejamento semanal da equipe' })], TZ)).toHaveLength(1)
    expect(juntarAgenda([google], [mac({ title: 'Planejamento semanal da equipe', end: '2026-11-23T14:30:00Z' })], TZ)).toHaveLength(2)
    // O curto tem menos de 6 caracteres: não junta nem com o fim igual.
    expect(juntarAgenda([conta({ title: 'Daily' })], [mac({ title: 'Daily standup' })], TZ)).toHaveLength(2)
    // Títulos diferentes de verdade no mesmo horário: duas linhas.
    expect(juntarAgenda([google], [mac({ title: 'Almoço' })], TZ)).toHaveLength(2)
  })

  it('dia inteiro × com hora não junta, mesmo título e mesmo início', () => {
    const google = conta({ title: 'Feriado', allDay: true, start: '2026-11-23T03:00:00.000Z', end: '2026-11-24T03:00:00.000Z' })
    const copia = mac({ title: 'Feriado', allDay: false, start: '2026-11-23T03:00:00Z', end: '2026-11-24T03:00:00Z' })
    expect(juntarAgenda([google], [copia], TZ)).toHaveLength(2)
  })

  it('dia inteiro nos dois: Google (meia-noite local) e Microsoft (meia-noite UTC) juntam com o YYYY-MM-DD do Mac', () => {
    const google = conta({ title: 'Feriado', allDay: true, start: '2026-11-23T03:00:00.000Z', end: '2026-11-24T03:00:00.000Z' })
    const microsoft = conta({ provider: 'microsoft', calendarId: 'default', title: 'Offsite', allDay: true, start: '2026-11-23T00:00:00.000Z', end: '2026-11-24T00:00:00.000Z' })
    const macFeriado = mac({ title: 'Feriado', allDay: true, start: '2026-11-23', end: '2026-11-24' })
    const macOffsite = mac({ title: 'Offsite', allDay: true, start: '2026-11-23', end: '2026-11-24' })
    const agenda = juntarAgenda([google, microsoft], [macFeriado, macOffsite], TZ)
    expect(agenda.map((evento) => [evento.titulo, evento.fontes, evento.diaInteiro])).toEqual([
      ['Feriado', ['google', 'mac'], true],
      ['Offsite', ['microsoft', 'mac'], true],
    ])
    // O dia inteiro começa à meia-noite local, venha de onde vier.
    expect(agenda.map((evento) => [evento.inicio, evento.fim])).toEqual([
      ['2026-11-23T03:00:00.000Z', '2026-11-24T03:00:00.000Z'],
      ['2026-11-23T03:00:00.000Z', '2026-11-24T03:00:00.000Z'],
    ])
    // Dia diferente não junta.
    expect(juntarAgenda([google], [mac({ title: 'Feriado', allDay: true, start: '2026-11-24', end: '2026-11-25' })], TZ)).toHaveLength(2)
  })

  it('série recorrente: o uid só junta no mesmo dia local; cada ocorrência com a sua e a só do Mac continua', () => {
    const uid = 'serie@google.com'
    const hoje = conta({ uid, title: 'Daily', start: '2026-11-23T12:00:00.000Z', end: '2026-11-23T12:15:00.000Z' })
    const amanha = conta({ uid, title: 'Daily', start: '2026-11-24T12:00:00.000Z', end: '2026-11-24T12:15:00.000Z' })
    const copias = [
      mac({ calendarItemIdentifier: 'serie', externalIdentifier: uid, title: 'Daily', start: '2026-11-23T12:00:00Z', end: '2026-11-23T12:15:00Z' }),
      mac({ calendarItemIdentifier: 'serie', externalIdentifier: uid, title: 'Daily', start: '2026-11-24T12:00:00Z', end: '2026-11-24T12:15:00Z' }),
      // Depois de amanhã: só o Mac tem esta ocorrência.
      mac({ calendarItemIdentifier: 'serie', externalIdentifier: uid, title: 'Daily', start: '2026-11-25T12:00:00Z', end: '2026-11-25T12:15:00Z' }),
    ]
    const agenda = juntarAgenda([hoje, amanha], copias, TZ)
    expect(agenda.map((evento) => [evento.id, evento.fontes])).toEqual([
      [`google:primary:${hoje.id}`, ['google', 'mac']],
      [`google:primary:${amanha.id}`, ['google', 'mac']],
      ['mac:serie:2026-11-25T12:00:00Z', ['mac']],
    ])
  })

  it('duas ocorrências da mesma série do Mac: ids diferentes', () => {
    const agenda = juntarAgenda(
      [],
      [mac({ calendarItemIdentifier: 'rep', start: '2026-11-23T12:00:00Z', end: '2026-11-23T13:00:00Z' }), mac({ calendarItemIdentifier: 'rep', start: '2026-11-24T12:00:00Z', end: '2026-11-24T13:00:00Z' })],
      TZ,
    )
    expect(agenda.map((evento) => evento.id)).toEqual(['mac:rep:2026-11-23T12:00:00Z', 'mac:rep:2026-11-24T12:00:00Z'])
  })

  it('dia inteiro da Microsoft (meia-noite UTC) em Tóquio e no próprio UTC: 00:00 local do dia certo, junta com o Mac', () => {
    const microsoft = conta({ provider: 'microsoft', calendarId: 'default', title: 'Offsite', allDay: true, start: '2026-11-23T00:00:00.000Z', end: '2026-11-24T00:00:00.000Z' })
    const copia = mac({ title: 'Offsite', allDay: true, start: '2026-11-23', end: '2026-11-24' })
    const toquio = juntarAgenda([microsoft], [copia], 'Asia/Tokyo')
    expect(toquio.map((evento) => [evento.fontes, evento.inicio, evento.fim])).toEqual([[['microsoft', 'mac'], '2026-11-22T15:00:00.000Z', '2026-11-23T15:00:00.000Z']])
    const utc = juntarAgenda([microsoft], [copia], 'UTC')
    expect(utc.map((evento) => [evento.fontes, evento.inicio, evento.fim])).toEqual([[['microsoft', 'mac'], '2026-11-23T00:00:00.000Z', '2026-11-24T00:00:00.000Z']])
  })

  it('início ilegível vai para o fim, ordenado pelo id', () => {
    const agenda = juntarAgenda(
      [conta({ calendarId: 'b', id: 'ruim-b', title: 'B', start: 'lixo' }), conta({ title: 'Válido' }), conta({ calendarId: 'a', id: 'ruim-a', title: 'A', start: 'também lixo' })],
      [],
      TZ,
    )
    expect(agenda.map((evento) => evento.id)).toEqual([expect.stringMatching(/^google:primary:g-/), 'google:a:ruim-a', 'google:b:ruim-b'])
  })

  it('cancelado e recusado não entram, nem a cópia deles no Mac', () => {
    const cancelado = conta({ title: 'Cancelada', status: 'cancelled' })
    const recusado = conta({ title: 'Recusada', myResponse: 'declined', start: '2026-11-23T16:00:00.000Z', end: '2026-11-23T17:00:00.000Z' })
    const copias = [mac({ title: 'Cancelada' }), mac({ title: 'Recusada', start: '2026-11-23T16:00:00Z', end: '2026-11-23T17:00:00Z' })]
    expect(juntarAgenda([cancelado, recusado], copias, TZ)).toEqual([])
    expect(juntarAgenda([cancelado, recusado], [], TZ)).toEqual([])
    // Talvez e sem resposta entram.
    expect(juntarAgenda([conta({ myResponse: 'tentative' }), conta({ myResponse: 'none', title: 'Outra' })], [], TZ)).toHaveLength(2)
  })

  it('evento só do Mac: sem calendarKey nem eventId, chamada pelo endereço; ordem por início', () => {
    const soMac = mac({ calendarItemIdentifier: 'item-1', title: 'Dentista', start: '2026-11-23T11:00:00Z', end: '2026-11-23T12:00:00Z', url: 'https://us02web.zoom.us/j/123' })
    const agenda = juntarAgenda([conta()], [soMac], TZ)
    expect(agenda.map((evento) => evento.titulo)).toEqual(['Dentista', 'Planejamento'])
    expect(agenda[0]).toEqual<InicioEvento>({
      id: 'mac:item-1:2026-11-23T11:00:00Z',
      titulo: 'Dentista',
      inicio: '2026-11-23T11:00:00.000Z',
      fim: '2026-11-23T12:00:00.000Z',
      diaInteiro: false,
      fontes: ['mac'],
      calendarKey: null,
      eventId: null,
      chamada: 'zoom',
      reuniaoId: null,
    })
  })

  it('o link da chamada nunca vai para a linha, só de onde ele é', () => {
    const agenda = juntarAgenda(
      [conta({ joinUrl: 'https://teams.microsoft.com/l/meetup-join/segredo' })],
      [mac({ title: 'Outra', start: '2026-11-23T18:00:00Z', end: '2026-11-23T19:00:00Z', url: 'https://meet.google.com/xyz-abcd-efg' })],
      TZ,
    )
    expect(agenda.map((evento) => evento.chamada)).toEqual(['teams', 'meet'])
    expect(JSON.stringify(agenda)).not.toContain('https://')
  })
})

describe('chamadaDe', () => {
  it('Meet, Teams, Zoom; outro endereço, http ou lixo é null', () => {
    expect(chamadaDe('https://meet.google.com/abc')).toBe('meet')
    expect(chamadaDe('https://teams.live.com/meet/1')).toBe('teams')
    expect(chamadaDe('https://zoom.us/j/1')).toBe('zoom')
    expect(chamadaDe('https://exemplo.com/zoom.us')).toBeNull()
    expect(chamadaDe('http://meet.google.com/abc')).toBeNull()
    expect(chamadaDe('não é url')).toBeNull()
    expect(chamadaDe(null)).toBeNull()
  })
})

const NOW = Date.parse('2026-11-23T17:40:00.000Z')
const DIA_MS = 86_400_000

const chat = (patch: Partial<WhatsAppChat> = {}, mensagem: Partial<NonNullable<WhatsAppChat['lastMessage']>> = {}): WhatsAppChat => ({
  id: `chat-${++seq}@s.whatsapp.net`,
  name: 'Ana',
  kind: 'person',
  unread: 1,
  lastMessage: { id: `msg-${seq}`, chatId: `chat-${seq}`, author: 'Ana', fromMe: false, at: NOW - 3_600_000, type: 'text', text: 'Oi', media: null, ...mensagem },
  ...patch,
})

describe('whatsappSemResposta (D8)', () => {
  it('conta só a pessoa com a última mensagem recebida há até 7 dias', () => {
    expect(whatsappSemResposta([chat()], NOW)).toBe(1)
    expect(whatsappSemResposta([chat({ kind: 'group' })], NOW)).toBe(0)
    expect(whatsappSemResposta([chat({}, { fromMe: true })], NOW)).toBe(0)
    expect(whatsappSemResposta([chat({}, { at: NOW - 7 * DIA_MS - 1 })], NOW)).toBe(0)
    expect(whatsappSemResposta([chat({}, { at: NOW - 7 * DIA_MS })], NOW)).toBe(1)
    expect(whatsappSemResposta([chat({ lastMessage: null })], NOW)).toBe(0)
    expect(whatsappSemResposta([chat(), chat(), chat({ kind: 'group' }), chat({}, { fromMe: true })], NOW)).toBe(2)
    expect(whatsappSemResposta([], NOW)).toBe(0)
  })

  it('serviço parado ou não instalado (null) devolve null', () => {
    expect(whatsappSemResposta(null, NOW)).toBeNull()
  })
})

describe('convitesSemResposta (D8)', () => {
  const convite = (patch: Partial<CalendarEvent> = {}): CalendarEvent => conta({ myResponse: 'none', start: '2026-11-23T18:00:00.000Z', end: '2026-11-23T19:00:00.000Z', ...patch })

  it('conta o confirmado, com participantes, sem resposta e que não acabou', () => {
    expect(convitesSemResposta([convite()], NOW)).toBe(1)
    // Em andamento ainda conta.
    expect(convitesSemResposta([convite({ start: '2026-11-23T17:00:00.000Z' })], NOW)).toBe(1)
    expect(convitesSemResposta([convite({ myResponse: 'accepted' }), convite({ myResponse: 'tentative' }), convite({ myResponse: 'declined' })], NOW)).toBe(0)
    expect(convitesSemResposta([convite({ attendees: [] })], NOW)).toBe(0)
    expect(convitesSemResposta([convite({ start: '2026-11-23T16:00:00.000Z', end: '2026-11-23T17:00:00.000Z' })], NOW)).toBe(0)
    expect(convitesSemResposta([convite({ end: '2026-11-23T17:40:00.000Z' })], NOW)).toBe(0)
    expect(convitesSemResposta([convite({ status: 'cancelled' })], NOW)).toBe(0)
    expect(convitesSemResposta([convite(), convite(), convite({ attendees: [] })], NOW)).toBe(2)
  })

  it('sem conta com a agenda (null) devolve null', () => {
    expect(convitesSemResposta(null, NOW)).toBeNull()
  })
})

describe('dia local e fim de amanhã no fuso', () => {
  it('em São Paulo, perto da meia-noite, o dia é o local e não o UTC', () => {
    const tarde = Date.parse('2026-11-23T02:30:00.000Z') // 22/11, 23:30 em São Paulo
    expect(diaLocal(tarde, TZ)).toBe('2026-11-22')
    expect(diaLocal(tarde, 'UTC')).toBe('2026-11-23')
    expect(new Date(inicioDoDiaLocal(tarde, TZ)).toISOString()).toBe('2026-11-22T03:00:00.000Z')
    expect(new Date(fimDeAmanha(tarde, TZ)).toISOString()).toBe('2026-11-24T03:00:00.000Z')
  })

  it('em Tóquio e na virada do mês', () => {
    const at = Date.parse('2026-11-30T16:00:00.000Z') // 01/12, 01:00 em Tóquio
    expect(diaLocal(at, 'Asia/Tokyo')).toBe('2026-12-01')
    expect(new Date(inicioDoDiaLocal(at, 'Asia/Tokyo')).toISOString()).toBe('2026-11-30T15:00:00.000Z')
    expect(new Date(fimDeAmanha(at, 'Asia/Tokyo')).toISOString()).toBe('2026-12-02T15:00:00.000Z')
  })
})

describe('reuniaoDoEvento (D10)', () => {
  const reuniao = (patch: Partial<Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'>> = {}): Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'> => ({
    id: `r-${++seq}`,
    title: 'Planejamento',
    startedAt: '2026-11-23T13:02:00.000Z',
    calendar: null,
    ...patch,
  })
  const doMac = { eventId: null, titulo: 'Planejamento', inicio: '2026-11-23T13:00:00.000Z', fim: '2026-11-23T14:00:00.000Z' }

  it('evento da conta: a reunião com o mesmo calendar.eventId, nunca pelo horário', () => {
    const certa = reuniao({ calendar: { eventId: 'g-evento', attendees: [] }, startedAt: '2026-11-20T10:00:00.000Z', title: 'Outro nome' })
    const pelaHora = reuniao()
    expect(reuniaoDoEvento([pelaHora, certa], { ...doMac, eventId: 'g-evento' })).toBe(certa.id)
    expect(reuniaoDoEvento([pelaHora], { ...doMac, eventId: 'g-evento' })).toBeNull()
  })

  it('evento só do Mac: começou entre 10 min antes do início e o fim, com o título equivalente', () => {
    expect(reuniaoDoEvento([reuniao({ id: 'a', startedAt: '2026-11-23T12:50:00.000Z' })], doMac)).toBe('a')
    expect(reuniaoDoEvento([reuniao({ id: 'b', startedAt: '2026-11-23T12:49:59.000Z' })], doMac)).toBeNull()
    expect(reuniaoDoEvento([reuniao({ id: 'c', startedAt: '2026-11-23T14:00:00.000Z' })], doMac)).toBe('c')
    expect(reuniaoDoEvento([reuniao({ id: 'd', startedAt: '2026-11-23T14:00:01.000Z' })], doMac)).toBeNull()
    expect(reuniaoDoEvento([reuniao({ id: 'e', title: 'Convite: planejamento' })], doMac)).toBe('e')
    expect(reuniaoDoEvento([reuniao({ id: 'f', title: 'Planejamento semanal' })], doMac)).toBe('f')
    expect(reuniaoDoEvento([reuniao({ id: 'g', title: 'Reunião de 23/11 10:02' })], doMac)).toBeNull()
  })

  it('mais de uma no horário: a que começou mais perto do início', () => {
    const longe = reuniao({ id: 'longe', startedAt: '2026-11-23T13:40:00.000Z' })
    const perto = reuniao({ id: 'perto', startedAt: '2026-11-23T12:58:00.000Z' })
    expect(reuniaoDoEvento([longe, perto], doMac)).toBe('perto')
    expect(reuniaoDoEvento([], doMac)).toBeNull()
  })
})
