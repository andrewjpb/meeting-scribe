// Contrato 134 (inicio): a view da tela Início montada no main (D3). Junta a agenda das contas (a janela do D4) com a
// do Calendário do Mac sem repetir evento (D7), conta as pendências do WhatsApp, dos convites e do email (D8) e acha a
// reunião gravada de cada evento (D10), pelas regras puras de `shared/inicio.ts`. Só lê: nenhum evento, convite,
// mensagem ou arquivo é gravado (D15), e nada vai para disco. Sem relógio próprio: relê quando alguém pede ou quando
// uma fonte avisa. Fonte desligada ou com falha vale `null` (a linha some na tela); o link da chamada nunca entra.
import type { AccountProfile } from '../../shared/accounts'
import {
  convitesSemResposta,
  diaLocal,
  fimDeAmanha,
  inicioDoDiaLocal,
  juntarAgenda,
  reuniaoDoEvento,
  whatsappSemResposta,
  type InicioEvento,
  type InicioMacEstado,
  type InicioMacEvento,
  type InicioPendencias,
  type InicioView,
} from '../../shared/inicio'
import type { Meeting } from '../../shared/meetings'
import type { WhatsAppChat, WhatsAppStatus } from '../../shared/whatsapp'
import { CALENDAR_REFRESH_MS, calendarWindow, type CalendarService } from '../calendar/service'
import type { CachedCalendarReads } from '../chat/actions'
import type { MacCalendar } from '../mac-calendar/process'

/** D6: a leitura do dia no Calendário do Mac, guardada em memória. */
export interface MacDay {
  /** O estado do acesso e os eventos que cruzam `[from, to)`; sem acesso, ou com o helper fora do ar, nenhum. */
  read(from: number, to: number): Promise<{ estado: InicioMacEstado; eventos: InicioMacEvento[] }>
  /** "Conceder": pede o acesso ao macOS e esquece o que leu (o acesso e os eventos). */
  requestAccess(): Promise<void>
  /** A janela voltou ao foco: a próxima leitura vai ao helper. */
  invalidate(): void
}

export interface MacDayDeps {
  calendar: Pick<MacCalendar, 'list' | 'requestAccess'>
  /** O `status` guardado do contrato 78 (o mesmo do `ESTADO.md`). */
  reads: Pick<CachedCalendarReads, 'status' | 'invalidate'>
  /** Fora do pacote (`pnpm dev`) o `request-access` não sai: sem acesso vira `dev`. */
  packaged: boolean
  now?: () => number
  /** Uma leitura do helper trouxe algo diferente da anterior. */
  onRead?: () => void
}

/**
 * D6: o último `list` do Mac por 5 min (`CALENDAR_REFRESH_MS`, a cadência das contas), pela janela pedida. Só a
 * leitura boa fica guardada; o acesso vem do `status` guardado (30 s), para não pedir ao helper a cada tela.
 */
export function createMacDay(deps: MacDayDeps): MacDay {
  const now = deps.now ?? Date.now
  let cache: { key: string; at: number; eventos: InicioMacEvento[] } | null = null
  let lastSignature: string | null = null
  const semAcesso = (): InicioMacEstado => (deps.packaged ? 'sem-acesso' : 'dev')

  return {
    async read(from, to) {
      const status = await deps.reads.status().catch(() => null)
      if (!status?.ok) return { estado: 'indisponivel', eventos: [] }
      if (status.value.access !== 'full') return { estado: semAcesso(), eventos: [] }
      const key = `${from}|${to}`
      if (cache && cache.key === key && now() - cache.at < CALENDAR_REFRESH_MS) return { estado: 'ok', eventos: cache.eventos }
      const listed = await deps.calendar.list({ start: new Date(from).toISOString(), end: new Date(to).toISOString() }).catch(() => null)
      if (!listed) return { estado: 'indisponivel', eventos: [] }
      if (!listed.ok) return { estado: listed.error.code === 'denied' || listed.error.code === 'restricted' ? semAcesso() : 'indisponivel', eventos: [] }
      const eventos: InicioMacEvento[] = listed.value.events.map((event) => ({
        calendarItemIdentifier: event.calendarItemIdentifier,
        externalIdentifier: event.externalIdentifier,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        url: event.url,
      }))
      cache = { key, at: now(), eventos }
      const signature = JSON.stringify(eventos)
      if (signature !== lastSignature) {
        lastSignature = signature
        deps.onRead?.()
      }
      return { estado: 'ok', eventos }
    },

    async requestAccess() {
      await deps.calendar.requestAccess().catch(() => undefined)
      deps.reads.invalidate()
      cache = null
    },

    invalidate() {
      cache = null
    },
  }
}

export interface InicioServiceDeps {
  calendar: Pick<CalendarService, 'dayEvents' | 'view'>
  macDay: MacDay
  meetings: { list(): Promise<Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'>[]> }
  whatsapp: { chats(): Promise<WhatsAppChat[]>; status(): WhatsAppStatus }
  email: { pendentesEmCache(): number | null }
  /** D12: o perfil das contas já em memória, na ordem de preferência (Google, depois Microsoft). */
  profiles: () => readonly (AccountProfile | null)[]
  timeZone: () => string
  now?: () => number
  /** A view mudou (agenda lida, leitura nova do Mac, mensagem do WhatsApp, pastas do email): vai inteira. */
  onChange: (view: InicioView) => void
  /** Só o tipo do erro, nunca título, nome ou contagem de ninguém. */
  log?: (message: string) => void
}

export interface InicioService {
  view(): Promise<InicioView>
  /** "Conceder" da linha do Calendário do Mac, e a view relida. */
  macAccess(): Promise<InicioView>
  /** Uma fonte avisou: relê e manda a view pelo `onChange` (pedidos juntos viram uma releitura só). */
  changed(): void
  /**
   * O `onRead` do dia do Mac: o mesmo que `changed`, mas o aviso que sai durante a leitura do Mac da própria releitura
   * não pede outra (a leitura já está na view que vai sair).
   */
  macRead(): void
}

/** O WhatsApp só conta com o serviço de pé e a conta pareada (D8); parado, não instalado ou sem conta, `null`. */
const WHATSAPP_LENDO: readonly WhatsAppStatus['state'][] = ['connected', 'disconnected']

/** D12: o primeiro nome do primeiro perfil com nome. */
export function primeiroNome(profiles: readonly (AccountProfile | null)[]): string | null {
  for (const profile of profiles) {
    const nome = profile?.name.trim().split(/\s+/)[0]
    if (nome) return nome
  }
  return null
}

export function createInicioService(deps: InicioServiceDeps): InicioService {
  const now = deps.now ?? Date.now
  const log = (message: string): void => deps.log?.(`[inicio] ${message}`)
  const tipo = (error: unknown): string => (error instanceof Error ? error.name : 'erro')

  async function whatsappPendentes(at: number): Promise<number | null> {
    try {
      if (!WHATSAPP_LENDO.includes(deps.whatsapp.status().state)) return null
      return whatsappSemResposta(await deps.whatsapp.chats(), at)
    } catch (error) {
      log(`whatsapp: ${tipo(error)}`)
      return null
    }
  }

  async function reunioes(): Promise<Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'>[] | null> {
    try {
      return await deps.meetings.list()
    } catch (error) {
      log(`reuniões: ${tipo(error)}`)
      return null
    }
  }

  /** A releitura do `changed` está esperando o dia do Mac. */
  let lendoMac = false

  async function view(doChanged = false): Promise<InicioView> {
    const at = now()
    const timeZone = deps.timeZone()
    const hojeInicio = inicioDoDiaLocal(at, timeZone)
    const amanhaFim = fimDeAmanha(at, timeZone)
    // A meia-noite de amanhã: o começo do dia do último instante antes do fim de amanhã.
    const amanhaInicio = inicioDoDiaLocal(amanhaFim - 1, timeZone)

    let contas: boolean
    let doDia: ReturnType<CalendarService['dayEvents']> = []
    let convites: number | null = null
    try {
      contas = deps.calendar.view().connected
      if (contas) {
        const janela = calendarWindow(at, timeZone)
        doDia = deps.calendar.dayEvents(hojeInicio, amanhaFim)
        convites = convitesSemResposta(deps.calendar.dayEvents(janela.from, janela.to), at)
      }
    } catch (error) {
      log(`agenda: ${tipo(error)}`)
      contas = false
      doDia = []
      convites = null
    }

    if (doChanged) lendoMac = true
    const leituraMac = deps.macDay
      .read(hojeInicio, amanhaFim)
      .catch((error: unknown) => {
        log(`mac: ${tipo(error)}`)
        return { estado: 'indisponivel' as const, eventos: [] }
      })
      .finally(() => {
        if (doChanged) lendoMac = false
      })
    const [mac, whatsapp, lista] = await Promise.all([
      leituraMac,
      whatsappPendentes(at),
      reunioes(),
    ])

    let emails: number | null = null
    try {
      emails = deps.email.pendentesEmCache()
    } catch (error) {
      log(`email: ${tipo(error)}`)
    }

    const todos = juntarAgenda(doDia, mac.eventos, timeZone)
    const cruza = (evento: InicioEvento, from: number, to: number): boolean => {
      const inicio = Date.parse(evento.inicio)
      const fim = Date.parse(evento.fim)
      return !Number.isNaN(inicio) && inicio < to && (Number.isNaN(fim) ? inicio >= from : fim > from)
    }
    const eventos = todos.filter((evento) => cruza(evento, hojeInicio, amanhaInicio)).map((evento) => ({ ...evento, reuniaoId: lista ? reuniaoDoEvento(lista, evento) : null }))
    const amanha = todos.filter((evento) => {
      const inicio = Date.parse(evento.inicio)
      return inicio >= amanhaInicio && inicio < amanhaFim
    }).length

    const pendencias: InicioPendencias = { whatsapp, convites, emails }
    let saudacaoNome: string | null = null
    try {
      saudacaoNome = primeiroNome(deps.profiles())
    } catch (error) {
      log(`perfil: ${tipo(error)}`)
    }
    return { hoje: diaLocal(at, timeZone), agenda: { eventos, amanha, contas, mac: mac.estado }, pendencias, saudacaoNome }
  }

  let running: Promise<void> | null = null
  let again = false
  /** A última view mandada: igual não vai de novo (como o `publish` da agenda). */
  let lastSent = ''
  function changed(): void {
    if (running) {
      again = true
      return
    }
    running = (async () => {
      try {
        do {
          again = false
          const current = await view(true).catch((error: unknown) => {
            log(`view: ${tipo(error)}`)
            return null
          })
          if (!current) continue
          const signature = JSON.stringify(current)
          if (signature === lastSent) continue
          lastSent = signature
          deps.onChange(current)
        } while (again)
      } finally {
        running = null
      }
    })()
  }

  return {
    view: () => view(),
    async macAccess() {
      await deps.macDay.requestAccess()
      return view()
    },
    changed,
    macRead() {
      if (running && lendoMac) return
      changed()
    },
  }
}
