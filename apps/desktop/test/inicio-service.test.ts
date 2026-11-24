// Contrato 134 (inicio): o serviço da tela Início com as fontes falsas. Fonte desligada ou com falha vira `null`; o
// Calendário do Mac sem acesso (`sem-acesso`, `dev`) e fora do ar; a agenda da conta e a do Mac juntas sem repetir
// evento; nenhum link de chamada na view; o dia do Mac guardado 5 min e esquecido no foco e no "Conceder".
// Contrato 145 (inicio-atualizar): os não lidos guardados, o agrupamento dos avisos com relógio e temporizador falsos,
// a assinatura sem a hora, o "Atualizar" (cada fonte uma vez, a falha de uma não para as outras, pedidos juntos viram
// um) e o desbloqueio.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALENDAR_REFRESH_MS } from '../src/main/calendar/service'
import { createInicioService, createMacDay, INICIO_AGRUPAR_MS, inicioNoDesbloqueio, primeiroNome, type InicioServiceDeps, type MacDayDeps } from '../src/main/inicio/service'
import type { MacCalendarAccess, MacCalendarError, MacCalendarEvent, MacCalendarOutcome } from '../src/main/mac-calendar/protocol'
import type { AccountProfile } from '../src/shared/accounts'
import type { CalendarEvent, CalendarView } from '../src/shared/calendar'
import type { EmailAccountStatus, EmailFoldersResult } from '../src/shared/email'
import type { InicioView } from '../src/shared/inicio'
import type { Meeting } from '../src/shared/meetings'
import type { WhatsAppChat, WhatsAppStatus } from '../src/shared/whatsapp'

const MIN = 60_000
const TZ = 'America/Sao_Paulo'
/** Terça, 17/11/2026, 10:00 em São Paulo. */
const NOW = Date.parse('2026-11-17T13:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()
const semFracao = (ms: number): string => iso(ms).replace('.000Z', 'Z')

const evento = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  provider: 'google',
  calendarId: 'primary',
  id: 'g1',
  title: 'Revisão do contrato',
  start: iso(NOW + 60 * MIN),
  end: iso(NOW + 90 * MIN),
  allDay: false,
  status: 'confirmed',
  myResponse: 'accepted',
  attendees: [{ name: 'Ana Lima', email: 'ana@example.com' }],
  joinUrl: 'https://meet.google.com/abc-defg-hij',
  uid: null,
  ...patch,
})

const macEvento = (patch: Partial<MacCalendarEvent> = {}): MacCalendarEvent => ({
  eventIdentifier: 'E1',
  calendarItemIdentifier: 'C1',
  externalIdentifier: null,
  calendarId: 'cal-1',
  calendarTitle: 'Casa',
  sourceTitle: 'iCloud',
  title: 'Dentista',
  start: semFracao(NOW + 4 * 60 * MIN),
  end: semFracao(NOW + 5 * 60 * MIN),
  allDay: false,
  timeZone: TZ,
  recurring: false,
  occurrence: null,
  availability: 'busy',
  url: null,
  ...patch,
})

const chat = (patch: Partial<WhatsAppChat> & Pick<WhatsAppChat, 'id'>): WhatsAppChat =>
  ({ name: patch.id, kind: 'person', unread: 0, lastMessage: { id: `m-${patch.id}`, at: NOW - 60 * MIN, fromMe: false, text: 'oi' }, ...patch }) as WhatsAppChat

const whatsappStatus = (state: WhatsAppStatus['state']): WhatsAppStatus => ({ state, me: null, busy: null, error: null, progress: null, riskAcceptedAt: null })
const profile = (name: string): AccountProfile => ({ name, email: 'eu@example.com', photo: null })
const helperError = (code: MacCalendarError['code'], reason: MacCalendarError['reason']): { ok: false; error: MacCalendarError } => ({ ok: false, error: { code, reason, message: '' } })

/** O helper do Mac e o `status` guardado, falsos: cada chamada fica registrada. */
function fakeMac(options: { access?: MacCalendarAccess | null; events?: MacCalendarEvent[]; listError?: { ok: false; error: MacCalendarError }; packaged?: boolean } = {}) {
  const calls = { status: 0, list: [] as { start: string; end: string }[], requestAccess: 0, invalidate: 0 }
  const state = { access: options.access === undefined ? ('full' as MacCalendarAccess | null) : options.access, events: options.events ?? [], listError: options.listError ?? null }
  let clock = NOW
  let reads = 0
  /** Quem mais ouve o `onRead` (o `macRead` do serviço, como no index). */
  const hooks: { onRead: (() => void) | null } = { onRead: null }
  const deps: MacDayDeps = {
    calendar: {
      list: (args) => {
        calls.list.push(args)
        return Promise.resolve(state.listError ?? { ok: true, value: { events: state.events } })
      },
      requestAccess: () => {
        calls.requestAccess += 1
        state.access = 'full'
        return Promise.resolve({ ok: true, value: { access: 'full', granted: true } })
      },
    },
    reads: {
      status: () => {
        calls.status += 1
        const outcome: MacCalendarOutcome<{ access: MacCalendarAccess; version: 'lap-calendar 2' }> = state.access === null ? helperError('unavailable', 'no-binary') : { ok: true, value: { access: state.access, version: 'lap-calendar 2' } }
        return Promise.resolve(outcome)
      },
      invalidate: () => void (calls.invalidate += 1),
    },
    packaged: options.packaged ?? true,
    now: () => clock,
    onRead: () => {
      reads += 1
      hooks.onRead?.()
    },
  }
  return {
    calls,
    state,
    day: createMacDay(deps),
    reads: () => reads,
    hooks,
    advance: (ms: number) => void (clock += ms),
  }
}

function setup(
  options: {
    connected?: boolean
    events?: CalendarEvent[]
    mac?: ReturnType<typeof fakeMac>
    meetings?: () => Promise<Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'>[]>
    whatsappState?: WhatsAppStatus['state']
    chats?: () => Promise<WhatsAppChat[]>
    pendentes?: () => number | null
    naoLidos?: () => Promise<number>
    pendencias?: () => boolean
    profiles?: () => readonly (AccountProfile | null)[]
    contasEmail?: EmailAccountStatus[]
    refresh?: () => Promise<void>
    listFolders?: (accountId: string) => Promise<EmailFoldersResult>
    now?: () => number
    agruparMs?: number
    setTimer?: InicioServiceDeps['setTimer']
    log?: (message: string) => void
  } = {},
) {
  const views: InicioView[] = []
  const mac = options.mac ?? fakeMac()
  const events = options.events ?? []
  /** Quantas views foram montadas (cada uma lê a agenda uma vez). */
  const builds = { count: 0 }
  /** Contrato 145: cada chamada às fontes do email e do "Atualizar" (a de conexão é a `listFolders`). */
  const contagem = { pendentes: 0, naoLidos: 0, accounts: 0, listFolders: [] as string[], refresh: 0, invalidate: 0 }
  const invalidate = mac.day.invalidate.bind(mac.day)
  const macDay = {
    ...mac.day,
    invalidate: () => {
      contagem.invalidate += 1
      invalidate()
    },
  }
  const deps: InicioServiceDeps = {
    calendar: {
      view: (): CalendarView => {
        builds.count += 1
        return { connected: options.connected ?? true, upcoming: [], banner: null }
      },
      // Como o serviço das agendas: os que cruzam a janela.
      dayEvents: (from, to) => events.filter((item) => Date.parse(item.end) > from && Date.parse(item.start) < to),
      refresh: () => {
        contagem.refresh += 1
        return options.refresh ? options.refresh() : Promise.resolve()
      },
    },
    macDay,
    meetings: { list: options.meetings ?? (() => Promise.resolve([])) },
    whatsapp: { chats: options.chats ?? (() => Promise.resolve([])), status: () => whatsappStatus(options.whatsappState ?? 'connected') },
    email: {
      pendentesEmCache: () => {
        contagem.pendentes += 1
        return (options.pendentes ?? (() => null))()
      },
      naoLidosEmCache: () => {
        contagem.naoLidos += 1
        return (options.naoLidos ?? (() => Promise.resolve(0)))()
      },
      accounts: () => {
        contagem.accounts += 1
        return options.contasEmail ?? []
      },
      listFolders: (accountId) => {
        contagem.listFolders.push(accountId)
        return options.listFolders ? options.listFolders(accountId) : Promise.resolve({ ok: true, folders: [], pop3: false })
      },
    },
    ...(options.pendencias ? { pendencias: options.pendencias } : {}),
    profiles: options.profiles ?? (() => [null, null]),
    timeZone: () => TZ,
    now: options.now ?? (() => NOW),
    // Os testes antigos não esperam a janela de 1 s; os do agrupamento passam relógio e temporizador falsos.
    agruparMs: options.agruparMs ?? 0,
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.log ? { log: options.log } : {}),
    onChange: (view) => void views.push(view),
  }
  const service = createInicioService(deps)
  mac.hooks.onRead = () => service.macRead()
  return { service, views, mac, builds, events, contagem }
}

const contaEmail = (id: string, state: EmailAccountStatus['state'] = 'connected', protocol: 'imap' | 'pop3' = 'imap'): EmailAccountStatus =>
  ({
    account: { id, address: `${id}@example.com`, name: null, username: id, incoming: { protocol, host: 'mail.example.com', port: 993, security: 'tls' }, outgoing: { host: 'mail.example.com', port: 587, security: 'starttls' }, deleteFromServer: false },
    state,
    error: null,
    sentMailbox: 'Sent',
  }) as EmailAccountStatus

describe('tela Início: fontes desligadas e com falha', () => {
  it('sem conta, sem WhatsApp, sem pasta Pendentes e o helper fora do ar: tudo null e a agenda vazia', async () => {
    const { service } = setup({ connected: false, mac: fakeMac({ access: null }), whatsappState: 'stopped' })
    const view = await service.view()
    expect(view).toEqual({
      hoje: '2026-11-17',
      agenda: { eventos: [], amanha: 0, contas: false, mac: 'indisponivel' },
      pendencias: { whatsapp: null, convites: null, emails: null, emailsNaoLidos: 0 },
      saudacaoNome: null,
      atualizadoEm: '2026-11-17T13:00:00.000Z',
    })
  })

  it('WhatsApp não instalado ou pareando: null; leitura com falha, reuniões e email com falha: null sem derrubar a view', async () => {
    for (const state of ['not-installed', 'installing', 'pairing'] as const) {
      expect((await setup({ whatsappState: state }).service.view()).pendencias.whatsapp).toBeNull()
    }
    const { service } = setup({
      events: [evento()],
      chats: () => Promise.reject(new Error('serviço caiu')),
      meetings: () => Promise.reject(new Error('disco')),
      pendentes: () => {
        throw new Error('email')
      },
    })
    const view = await service.view()
    expect(view.pendencias).toEqual({ whatsapp: null, convites: 0, emails: null, emailsNaoLidos: 0 })
    expect(view.agenda.eventos.map((item) => [item.titulo, item.reuniaoId])).toEqual([['Revisão do contrato', null]])
  })

  it('as contagens: conversas de pessoa sem resposta, convites sem resposta, Pendentes do email; o primeiro nome do perfil', async () => {
    const { service } = setup({
      events: [
        evento({ id: 'c1', myResponse: 'none' }),
        // Já acabou: não conta.
        evento({ id: 'c2', myResponse: 'none', start: iso(NOW - 120 * MIN), end: iso(NOW - 60 * MIN) }),
        // Amanhã, ainda dentro da janela: conta.
        evento({ id: 'c3', myResponse: 'none', start: iso(NOW + 24 * 60 * MIN), end: iso(NOW + 25 * 60 * MIN) }),
      ],
      chats: () => Promise.resolve([chat({ id: 'a' }), chat({ id: 'b', kind: 'group' }), chat({ id: 'c', lastMessage: { id: 'x', at: NOW, fromMe: true, text: 'ok' } as WhatsAppChat['lastMessage'] })]),
      pendentes: () => 5,
      profiles: () => [null, profile('  Andrew  Pereira ')],
    })
    const view = await service.view()
    expect(view.pendencias).toEqual({ whatsapp: 1, convites: 2, emails: 5, emailsNaoLidos: 0 })
    expect(view.saudacaoNome).toBe('Andrew')
    expect(primeiroNome([profile('Ana Lima'), profile('Bruno')])).toBe('Ana')
    expect(primeiroNome([profile('   ')])).toBeNull()
  })
})

describe('tela Início: o Calendário do Mac', () => {
  it('sem acesso no app empacotado é sem-acesso; no pnpm dev é dev; nenhum list sem o acesso total', async () => {
    const empacotado = fakeMac({ access: 'denied' })
    expect((await setup({ mac: empacotado }).service.view()).agenda.mac).toBe('sem-acesso')
    const dev = fakeMac({ access: 'notDetermined', packaged: false })
    expect((await setup({ mac: dev }).service.view()).agenda.mac).toBe('dev')
    expect(empacotado.calls.list).toEqual([])
    expect(dev.calls.list).toEqual([])
    // O helper diz `denied` no `list` (o acesso mudou depois do `status` guardado).
    const negado = fakeMac({ listError: helperError('denied', 'denied') })
    expect((await setup({ mac: negado }).service.view()).agenda.mac).toBe('sem-acesso')
    const fora = fakeMac({ listError: helperError('unavailable', 'timeout') })
    expect((await setup({ mac: fora }).service.view()).agenda.mac).toBe('indisponivel')
  })

  it('"Conceder": pede o acesso, esquece o status guardado e o dia, e a view volta com ok', async () => {
    const mac = fakeMac({ access: 'notDetermined', events: [macEvento()] })
    const { service } = setup({ mac })
    expect((await service.view()).agenda.mac).toBe('sem-acesso')
    const view = await service.macAccess()
    expect(mac.calls.requestAccess).toBe(1)
    expect(mac.calls.invalidate).toBe(1)
    expect(view.agenda.mac).toBe('ok')
    expect(view.agenda.eventos.map((item) => item.titulo)).toEqual(['Dentista'])
  })

  it('o dia do Mac fica 5 min em memória (hoje e amanhã), é esquecido no foco e o onRead só sai quando muda', async () => {
    const mac = fakeMac({ events: [macEvento()] })
    const { service } = setup({ mac })
    await service.view()
    await service.view()
    expect(mac.calls.list).toEqual([{ start: '2026-11-17T03:00:00.000Z', end: '2026-11-19T03:00:00.000Z' }])
    expect(mac.reads()).toBe(1)
    mac.advance(CALENDAR_REFRESH_MS - 1)
    await service.view()
    expect(mac.calls.list).toHaveLength(1)
    mac.advance(1)
    await service.view()
    expect(mac.calls.list).toHaveLength(2)
    // Mesma leitura: nada de onRead de novo.
    expect(mac.reads()).toBe(1)
    // A janela voltou ao foco: a próxima view vai ao helper; o evento mudou, o onRead sai.
    mac.day.invalidate()
    mac.state.events = [macEvento({ title: 'Dentista (remarcado)' })]
    await service.view()
    expect(mac.calls.list).toHaveLength(3)
    expect(mac.reads()).toBe(2)
  })

  it('o index esquece o dia do Mac na volta do foco à janela e passa o onRead à agenda das contas', () => {
    const index = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    expect(index).toContain("app.on('browser-window-focus', () => macDay.invalidate())")
    expect(index).toContain('onRead: inicioChanged,')
    expect(index).toContain('onRead: inicioMacRead })')
    // Contrato 156: o mesmo aviso também leva a visão do Painel de e-mail; o do Início continua.
    expect(index).toMatch(/onFoldersCached: \(\) => \{\n\s*inicioChanged\(\)/)
    expect(index).toMatch(/if \(!lockService\?\.isLocked\(\)\) broadcast\(appWindows\(\), 'scribe:inicio-changed', view\)/)
  })
})

describe('tela Início: a agenda do dia', () => {
  it('ponta a ponta: o mesmo evento na conta e no Mac vira uma linha (uid ou título e horário); o resto entra; amanhã só conta', async () => {
    const conta = [
      evento({ id: 'g1', uid: 'convite-1@google.com' }),
      evento({ id: 'g2', title: 'Status semanal', start: iso(NOW + 3 * 60 * MIN), end: iso(NOW + 3 * 60 * MIN + 30 * MIN), joinUrl: null }),
      // De manhã, já passou: fica na agenda do dia.
      evento({ id: 'g3', title: 'Café', start: iso(NOW - 2 * 60 * MIN), end: iso(NOW - 90 * MIN), joinUrl: null }),
      // Recusado: fora.
      evento({ id: 'g4', title: 'Recusada', myResponse: 'declined' }),
      // Amanhã.
      evento({ id: 'g5', title: 'Planejamento', start: iso(NOW + 24 * 60 * MIN), end: iso(NOW + 25 * 60 * MIN) }),
    ]
    const mac = fakeMac({
      events: [
        // Pelo uid do convite (título diferente no Mac).
        macEvento({ calendarItemIdentifier: 'C-g1', externalIdentifier: 'convite-1@google.com', title: 'Convite: Revisão', start: semFracao(NOW + 60 * MIN), end: semFracao(NOW + 90 * MIN) }),
        // Pelo título normalizado e o início igual.
        macEvento({ calendarItemIdentifier: 'C-g2', title: 'STATUS SEMANAL!', start: semFracao(NOW + 3 * 60 * MIN), end: semFracao(NOW + 3 * 60 * MIN + 30 * MIN) }),
        // A cópia no Mac do recusado também some.
        macEvento({ calendarItemIdentifier: 'C-g4', title: 'Recusada', start: semFracao(NOW + 60 * MIN), end: semFracao(NOW + 90 * MIN) }),
        // Só no Mac, com Zoom.
        macEvento({ calendarItemIdentifier: 'C-mac', title: 'Dentista', url: 'https://zoom.us/j/123456' }),
        // Dia inteiro amanhã, só no Mac.
        macEvento({ calendarItemIdentifier: 'C-feriado', title: 'Feriado', allDay: true, start: '2026-11-18', end: '2026-11-19' }),
      ],
    })
    const { service } = setup({
      events: conta,
      mac,
      meetings: () =>
        Promise.resolve([
          { id: 'r1', title: 'Revisão do contrato', startedAt: iso(NOW + 61 * MIN), calendar: { provider: 'google', eventId: 'g1' } as Meeting['calendar'] },
          { id: 'r2', title: 'Dentista', startedAt: iso(NOW + 4 * 60 * MIN - 5 * MIN), calendar: null },
        ]),
    })
    const view = await service.view()
    expect(view.agenda.mac).toBe('ok')
    expect(view.agenda.contas).toBe(true)
    expect(view.agenda.eventos.map((item) => [item.titulo, item.fontes, item.calendarKey, item.chamada, item.reuniaoId])).toEqual([
      ['Café', ['google'], 'google:primary:g3', null, null],
      ['Revisão do contrato', ['google', 'mac'], 'google:primary:g1', 'meet', 'r1'],
      ['Status semanal', ['google', 'mac'], 'google:primary:g2', null, null],
      ['Dentista', ['mac'], null, 'zoom', 'r2'],
    ])
    expect(view.agenda.amanha).toBe(2)
  })

  it('nenhum link de chamada na view, nem pelo evento da conta nem pelo do Mac', async () => {
    const { service, views } = setup({
      events: [evento({ joinUrl: 'https://meet.google.com/abc-defg-hij' }), evento({ id: 'g2', title: 'Teams', joinUrl: 'https://teams.microsoft.com/l/meetup-join/xyz' })],
      mac: fakeMac({ events: [macEvento({ url: 'https://empresa.zoom.us/j/999?pwd=segredo' })] }),
    })
    const view = await service.view()
    expect(view.agenda.eventos.map((item) => item.chamada).sort()).toEqual(['meet', 'teams', 'zoom'])
    const text = JSON.stringify(view)
    expect(text).not.toContain('https://')
    expect(text).not.toContain('zoom.us')
    expect(text).not.toContain('meet.google.com')
    expect(text).not.toContain('segredo')
    service.changed()
    await expect.poll(() => views.length).toBe(1)
    expect(JSON.stringify(views)).not.toContain('https://')
  })

  it('changed: avisos juntos viram uma releitura a mais, não uma por aviso; view igual à mandada não vai de novo', async () => {
    const { service, views, builds } = setup()
    service.changed()
    service.changed()
    service.changed()
    await expect.poll(() => builds.count).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(builds.count).toBe(2)
    expect(views).toHaveLength(1)
  })

  it('assinatura: duas releituras idênticas mandam uma view; com algo diferente, outra', async () => {
    const { service, views, builds, events } = setup()
    service.changed()
    await expect.poll(() => builds.count).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    service.changed()
    await expect.poll(() => builds.count).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(views).toHaveLength(1)
    events.push(evento())
    service.changed()
    await expect.poll(() => views.length).toBe(2)
    expect(views[1]?.agenda.eventos.map((item) => item.titulo)).toEqual(['Revisão do contrato'])
  })

  it('a primeira leitura do Mac, dentro da própria releitura, não pede outra; fora dela, pede', async () => {
    const mac = fakeMac({ events: [macEvento()] })
    const { service, views, builds } = setup({ mac })
    service.changed()
    await expect.poll(() => views.length).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mac.reads()).toBe(1)
    expect(builds.count).toBe(1)
    expect(views[0]?.agenda.eventos.map((item) => item.titulo)).toEqual(['Dentista'])
    // Lida por um `scribe:inicio-get` (fora do changed) com o evento mudado: o macRead pede a releitura para as janelas.
    mac.day.invalidate()
    mac.state.events = [macEvento({ title: 'Dentista (remarcado)' })]
    await service.view()
    await expect.poll(() => views.length).toBe(2)
    expect(views[1]?.agenda.eventos.map((item) => item.titulo)).toEqual(['Dentista (remarcado)'])
  })
})

describe('tela Início: não lidos, agrupamento, Atualizar e desbloqueio (contrato 145)', () => {
  /** Deixa as releituras em andamento terminarem (o temporizador do agrupamento é o falso, não este). */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /** Relógio e temporizador falsos: o `setTimer` só roda quando o teste anda o relógio até a hora dele. */
  function relogio() {
    let clock = NOW
    const timers: { at: number; run: () => void }[] = []
    return {
      now: () => clock,
      setTimer: (run: () => void, ms: number) => void timers.push({ at: clock + ms, run }),
      pendentes: () => timers.length,
      async andar(ms: number) {
        clock += ms
        for (const timer of timers.filter((item) => item.at <= clock)) {
          timers.splice(timers.indexOf(timer), 1)
          timer.run()
        }
        await flush()
      },
    }
  }

  /** Sem o helper do Mac: a primeira leitura dele não pede outra releitura pelo `macRead` (as contagens ficam exatas). */
  const semMac = () => fakeMac({ access: null })

  it('CA1: os não lidos guardados entram nas pendências; Pendências desligado não consulta o email', async () => {
    const ligado = setup({ naoLidos: () => Promise.resolve(5), mac: semMac() })
    expect((await ligado.service.view()).pendencias.emailsNaoLidos).toBe(5)
    expect(ligado.contagem.naoLidos).toBe(1)

    const desligado = setup({ naoLidos: () => Promise.resolve(5), pendentes: () => 3, pendencias: () => false })
    const view = await desligado.service.view()
    expect(view.pendencias.emailsNaoLidos).toBe(0)
    expect(view.pendencias.emails).toBeNull()
    expect(desligado.contagem).toMatchObject({ naoLidos: 0, pendentes: 0, accounts: 0, listFolders: [] })

    const logs: string[] = []
    const falha = setup({ naoLidos: () => Promise.reject(new TypeError('disco com o nome de alguém')), log: (message) => void logs.push(message) })
    expect((await falha.service.view()).pendencias.emailsNaoLidos).toBe(0)
    expect(logs).toEqual(['[inicio] email: TypeError'])
  })

  it('CA3: 10 avisos em menos de 1 s montam a view no máximo 2 vezes, e a última reflete o estado final', async () => {
    expect(INICIO_AGRUPAR_MS).toBe(1_000)
    const tempo = relogio()
    let naoLidos = 0
    const { service, views, builds } = setup({ naoLidos: () => Promise.resolve(naoLidos), now: tempo.now, setTimer: tempo.setTimer, agruparMs: INICIO_AGRUPAR_MS })
    for (let i = 1; i <= 10; i++) {
      naoLidos = i
      service.changed()
      await tempo.andar(90)
    }
    expect(builds.count).toBe(1)
    expect(tempo.pendentes()).toBe(1)
    await tempo.andar(INICIO_AGRUPAR_MS)
    expect(builds.count).toBe(2)
    expect(views.at(-1)?.pendencias.emailsNaoLidos).toBe(10)
    // Nada ficou para depois e nenhuma releitura a mais aparece.
    await tempo.andar(10 * INICIO_AGRUPAR_MS)
    expect(builds.count).toBe(2)
    expect(tempo.pendentes()).toBe(0)
    // Passada a janela, o aviso seguinte relê na hora.
    naoLidos = 11
    service.changed()
    await flush()
    expect(builds.count).toBe(3)
    expect(views.at(-1)?.pendencias.emailsNaoLidos).toBe(11)
  })

  it('CA4: só os não lidos mudando mandam a view; igual não vai; a hora fica fora da comparação, mas viaja atualizada', async () => {
    const tempo = relogio()
    let naoLidos = 2
    const { service, views, builds } = setup({ naoLidos: () => Promise.resolve(naoLidos), now: tempo.now, setTimer: tempo.setTimer, agruparMs: INICIO_AGRUPAR_MS })
    service.changed()
    await flush()
    expect(views.map((view) => [view.pendencias.emailsNaoLidos, view.atualizadoEm])).toEqual([[2, '2026-11-17T13:00:00.000Z']])
    await tempo.andar(5 * MIN)
    service.changed()
    await flush()
    // A hora mudou, o resto não: nada sai.
    expect(builds.count).toBe(2)
    expect(views).toHaveLength(1)
    naoLidos = 3
    await tempo.andar(5 * MIN)
    service.changed()
    await flush()
    expect(views.map((view) => [view.pendencias.emailsNaoLidos, view.atualizadoEm])).toEqual([
      [2, '2026-11-17T13:00:00.000Z'],
      [3, '2026-11-17T13:10:00.000Z'],
    ])
  })

  it('desbloqueio: a view montada com o app bloqueado não foi entregue, então a releitura forçada manda mesmo igual', async () => {
    const tempo = relogio()
    const { service, views } = setup({ naoLidos: () => Promise.resolve(2), now: tempo.now, setTimer: tempo.setTimer, agruparMs: INICIO_AGRUPAR_MS })
    service.changed()
    await flush()
    expect(views).toHaveLength(1)
    await tempo.andar(5 * MIN)
    service.changed()
    await flush()
    // Igual à última: não vai (é o que acontece com a releitura adiada que roda bloqueada).
    expect(views).toHaveLength(1)
    await tempo.andar(5 * MIN)
    service.changed({ forcar: true })
    await flush()
    expect(views).toHaveLength(2)
  })

  it('relógio que volta para trás não segura a releitura além da janela de agrupamento', async () => {
    let agora = 10 * MIN
    const esperas: number[] = []
    const { service } = setup({ now: () => agora, setTimer: (_run: () => void, ms: number) => void esperas.push(ms), agruparMs: INICIO_AGRUPAR_MS })
    service.changed()
    await flush()
    agora = 0
    service.changed()
    expect(esperas).toEqual([INICIO_AGRUPAR_MS])
  })

  it('CA5: Atualizar relê a agenda, o dia do Mac e as pastas de cada conta IMAP conectada, uma vez cada, e monta a view', async () => {
    const { service, contagem, builds, views } = setup({
      mac: semMac(),
      naoLidos: () => Promise.resolve(4),
      contasEmail: [contaEmail('a'), contaEmail('b'), contaEmail('pop', 'connected', 'pop3'), contaEmail('fora', 'offline'), contaEmail('erro', 'error')],
      refresh: () => {
        // A view sai depois das releituras.
        expect(builds.count).toBe(0)
        return Promise.resolve()
      },
    })
    const result = await service.atualizar()
    expect(result.ok).toBe(true)
    expect(result.falhou).toBe(false)
    expect(result.view.pendencias.emailsNaoLidos).toBe(4)
    expect(contagem.refresh).toBe(1)
    expect(contagem.invalidate).toBe(1)
    expect(contagem.listFolders).toEqual(['a', 'b'])
    expect(builds.count).toBe(1)
    // A resposta vai a quem pediu; o `onChange` não é chamado por ela.
    expect(views).toEqual([])
  })

  it('CA6: uma fonte falha, as outras são relidas, a view sai com falhou e o log leva só o tipo do erro', async () => {
    const logs: string[] = []
    const agenda = setup({
      contasEmail: [contaEmail('a')],
      refresh: () => Promise.reject(new TypeError('Ana Lima: token expirado')),
      log: (message) => void logs.push(message),
    })
    const result = await agenda.service.atualizar()
    expect(result.falhou).toBe(true)
    expect(result.view.hoje).toBe('2026-11-17')
    expect(agenda.contagem).toMatchObject({ refresh: 1, invalidate: 1, listFolders: ['a'] })
    expect(logs).toEqual(['[inicio] atualizar agenda: TypeError'])

    // As pastas de uma conta sem conexão (o resultado `ok: false`) também contam como falha; a outra conta é relida.
    const pastas = setup({ contasEmail: [contaEmail('a'), contaEmail('b')], listFolders: (id) => Promise.resolve(id === 'a' ? { ok: false, error: 'unavailable' } : { ok: true, folders: [], pop3: false }) })
    const comPastas = await pastas.service.atualizar()
    expect(comPastas.falhou).toBe(true)
    expect(pastas.contagem).toMatchObject({ refresh: 1, invalidate: 1, listFolders: ['a', 'b'] })

    // A pasta que rejeita e a lista de contas que lança: nada é lançado.
    const rejeita = setup({ contasEmail: [contaEmail('a')], listFolders: () => Promise.reject(new Error('rede')) })
    await expect(rejeita.service.atualizar()).resolves.toMatchObject({ ok: true, falhou: true })
    expect(rejeita.contagem.refresh).toBe(1)
  })

  it('CA7: dois Atualizar ao mesmo tempo fazem uma leitura só e recebem a mesma resposta', async () => {
    let solta: () => void = () => undefined
    const { service, contagem, builds } = setup({ mac: semMac(), contasEmail: [contaEmail('a')], refresh: () => new Promise<void>((resolve) => (solta = resolve)) })
    const primeiro = service.atualizar()
    const segundo = service.atualizar()
    solta()
    const [a, b] = await Promise.all([primeiro, segundo])
    expect(a).toBe(b)
    expect(contagem).toMatchObject({ refresh: 1, invalidate: 1, listFolders: ['a'] })
    expect(builds.count).toBe(1)
    // Terminada, a próxima lê de novo.
    const terceiro = service.atualizar()
    solta()
    await terceiro
    expect(contagem.refresh).toBe(2)
  })

  it('CA9: o desbloqueio relê o Início uma vez; o resto das mudanças de estado não; o index chama no ponto do desbloqueio', () => {
    const chamadas: string[] = []
    const changed = (): void => void chamadas.push('changed')
    inicioNoDesbloqueio(false, false, changed)
    inicioNoDesbloqueio(false, true, changed)
    inicioNoDesbloqueio(true, true, changed)
    expect(chamadas).toEqual([])
    inicioNoDesbloqueio(true, false, changed)
    expect(chamadas).toEqual(['changed'])
    const index = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    expect(index.match(/inicioNoDesbloqueio\(/g)).toHaveLength(1)
    expect(index).toContain('inicioNoDesbloqueio(wasLocked, status.locked, () => inicioChangedRef?.({ forcar: true }))')
    expect(index).toContain('inicioChangedRef = inicioChanged')
    // O `inicioChanged` continua sem fazer nada bloqueado.
    expect(index).toContain('if (!lockService?.isLocked()) inicioRef.current?.changed(opcoes?.forcar === true ? { forcar: true } : undefined)')
  })

  it('CA10: a chegada de email só relê o guardado: nenhuma conexão, nenhuma agenda relida, nada gravado nem modelo', async () => {
    const { service, contagem, views } = setup({ naoLidos: () => Promise.resolve(1), contasEmail: [contaEmail('a')] })
    service.changed()
    await expect.poll(() => views.length).toBe(1)
    expect(contagem).toEqual({ pendentes: 1, naoLidos: 1, accounts: 0, listFolders: [], refresh: 0, invalidate: 0 })
    // O caminho do `onMessagesChanged` no index: o evento às janelas, o `inicioChanged` e o `emailDashboardChanged` (contrato
    // 156: a visão do Painel de e-mail relê o guardado, sem modelo), mais nada.
    const index = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    const inicio = index.indexOf('    onMessagesChanged: (accountId) => {')
    const bloco = index.slice(inicio, index.indexOf('\n    },', inicio))
    const linhas = bloco.split('\n').slice(1).map((linha) => linha.trim()).filter((linha) => linha !== '' && !linha.startsWith('//'))
    expect(linhas).toEqual(["if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:email-changed', { accountId })", 'inicioChanged()', 'emailDashboardChanged()'])
  })
})
