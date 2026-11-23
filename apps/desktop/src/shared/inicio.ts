// Contrato 133 (inicio): os tipos da tela Início e as regras puras que o serviço do main (134) usa para montar a
// view: a agenda do dia juntando as contas e o Calendário do Mac sem repetir evento (D7), as pendências do WhatsApp e
// dos convites (D8), o dia local num fuso e a reunião gravada de cada evento (D10). Nada de rede, disco ou relógio
// aqui: o agora e o fuso chegam por parâmetro. O link da chamada nunca entra na view, só de onde ele é.
import { wallTime, zonedInstant } from './automations'
import { eventKey, type CalendarEvent, type CalendarProvider } from './calendar'
import type { Meeting } from './meetings'
import { diaNoFuso } from './tarefas-logic'
import type { WhatsAppChat } from './whatsapp'

/** De onde veio o evento: as contas (Google, Microsoft) ou o Calendário do Mac. */
export type InicioFonte = CalendarProvider | 'mac'
/** De que serviço é o link de chamada do evento (o link em si fica no main). */
export type InicioChamada = 'meet' | 'teams' | 'zoom'
/** O acesso ao Calendário do Mac: concedido, negado, `pnpm dev` (sem pedir acesso) ou helper fora do ar. */
export type InicioMacEstado = 'ok' | 'sem-acesso' | 'dev' | 'indisponivel'

/** Uma linha da agenda do dia. Horários em ISO 8601 (UTC); o dia inteiro começa à meia-noite local. */
export interface InicioEvento {
  /** Chave da linha: a `eventKey` da conta ou `mac:<calendarItemIdentifier>:<início>` (uma por ocorrência). */
  id: string
  titulo: string
  inicio: string
  fim: string
  diaInteiro: boolean
  /** As fontes onde o evento aparece (a conta e o Mac, quando é o mesmo nos dois). */
  fontes: InicioFonte[]
  /** `eventKey` da cópia da conta (Transcrever pelo fluxo do aviso); `null` no evento só do Mac. */
  calendarKey: string | null
  /** Id do evento na conta, como a reunião gravada guarda (`calendar.eventId`); `null` no evento só do Mac. */
  eventId: string | null
  chamada: InicioChamada | null
  /** A reunião gravada deste evento (`reuniaoDoEvento`); `null` sem nenhuma. */
  reuniaoId: string | null
}

/** Contagens da linha Pendências; `null` é a fonte desligada ou sem dado (a linha some). */
export interface InicioPendencias {
  whatsapp: number | null
  convites: number | null
  emails: number | null
}

/** O que `scribe:inicio-get` devolve (D10). */
export interface InicioView {
  /** O dia local, `YYYY-MM-DD`. */
  hoje: string
  agenda: {
    eventos: InicioEvento[]
    /** Quantos eventos amanhã (a faixa "Amanhã: N eventos"). */
    amanha: number
    /** Há conta com a agenda liberada. */
    contas: boolean
    mac: InicioMacEstado
  }
  pendencias: InicioPendencias
  /** Primeiro nome do perfil da conta; `null` sem conta. */
  saudacaoNome: string | null
}

/** O que a agenda usa de um evento do Calendário do Mac (o `MacCalendarEvent` do helper serve). */
export interface InicioMacEvento {
  calendarItemIdentifier: string
  externalIdentifier: string | null
  title: string
  /** Instante UTC ou, no dia inteiro, `YYYY-MM-DD` (o fim é exclusivo). */
  start: string
  end: string
  allDay: boolean
  url: string | null
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/
const MINUTO_MS = 60_000
const pad = (value: number): string => String(value).padStart(2, '0')

/** O dia civil `YYYY-MM-DD` de um instante no fuso (o mesmo `hoje` das Tarefas). */
export function diaLocal(ms: number, timeZone: string): string {
  return diaNoFuso(ms, timeZone)
}

/** Meia-noite do dia `dias` depois do dia local de `ms`, no fuso. */
function meiaNoite(ms: number, dias: number, timeZone: string): number {
  const wall = wallTime(ms, timeZone)
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + dias))
  return zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0, timeZone)
}

/** Começo do dia local de `ms` (meia-noite), no fuso. */
export function inicioDoDiaLocal(ms: number, timeZone: string): number {
  return meiaNoite(ms, 0, timeZone)
}

/** Fim de amanhã no fuso: a meia-noite de depois de amanhã (exclusivo). */
export function fimDeAmanha(ms: number, timeZone: string): number {
  return meiaNoite(ms, 2, timeZone)
}

/**
 * O dia civil de um evento de dia inteiro. O Mac manda `YYYY-MM-DD`; o Google, a meia-noite local; a Microsoft, a
 * meia-noite UTC (o app lê o Graph em UTC). Outro instante fica com o dia local.
 */
function diaDoDiaInteiro(when: string, timeZone: string): string | null {
  if (DIA.test(when)) return when
  const ms = Date.parse(when)
  if (Number.isNaN(ms)) return null
  const wall = wallTime(ms, timeZone)
  if (wall.hour === 0 && wall.minute === 0) return diaLocal(ms, timeZone)
  const utc = new Date(ms)
  if (utc.getUTCHours() === 0 && utc.getUTCMinutes() === 0) return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`
  return diaLocal(ms, timeZone)
}

/** O instante (ms) de um horário do evento; no dia inteiro, a meia-noite local do dia. `NaN` se não entende. */
function instanteDe(when: string, allDay: boolean, timeZone: string): number {
  if (!allDay) return DIA.test(when) ? Number.NaN : Date.parse(when)
  const dia = diaDoDiaInteiro(when, timeZone)
  const match = dia ? DIA.exec(dia) : null
  return match ? zonedInstant(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, timeZone) : Number.NaN
}

const PREFIXOS_CONVITE = /^(?:updated invitation|invitation|convite)\s*:\s*/

/**
 * Título para comparar (D7): sem acentos, em minúsculas, sem os prefixos `convite:`/`invitation:`/`updated
 * invitation:`, com a pontuação virando espaço e os espaços colapsados.
 */
export function normalizar(titulo: string): string {
  let texto = titulo.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim()
  for (let anterior = ''; anterior !== texto; ) {
    anterior = texto
    texto = texto.replace(PREFIXOS_CONVITE, '')
  }
  return texto
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Como dois títulos se parecem: iguais depois de `normalizar`, um começa com o outro (≥ 6 caracteres) ou nada. */
function semelhanca(a: string, b: string): 'igual' | 'prefixo' | null {
  const x = normalizar(a)
  const y = normalizar(b)
  if (x === '' || y === '') return null
  if (x === y) return 'igual'
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x]
  return curto.length >= 6 && longo.startsWith(curto) ? 'prefixo' : null
}

const mesmoMinuto = (a: number, b: number): boolean => !Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) < MINUTO_MS

/**
 * O evento do Mac é o mesmo da conta (D7): o `uid` do convite no mesmo dia local (numa série, cada ocorrência tem o
 * mesmo `uid`; sem o dia, a primeira levaria a série inteira) ou dia inteiro, início e título equivalentes.
 */
function mesmoEvento(conta: CalendarEvent, mac: InicioMacEvento, timeZone: string): boolean {
  const inicioConta = instanteDe(conta.start, conta.allDay, timeZone)
  const inicioMac = instanteDe(mac.start, mac.allDay, timeZone)
  if (conta.uid !== null && mac.externalIdentifier !== null && conta.uid === mac.externalIdentifier) {
    if (!Number.isNaN(inicioConta) && !Number.isNaN(inicioMac) && diaLocal(inicioConta, timeZone) === diaLocal(inicioMac, timeZone)) return true
  }
  if (conta.allDay !== mac.allDay) return false
  if (!mesmoMinuto(inicioConta, inicioMac)) return false
  const titulo = semelhanca(conta.title, mac.title)
  if (titulo === 'igual') return true
  return titulo === 'prefixo' && mesmoMinuto(instanteDe(conta.end, conta.allDay, timeZone), instanteDe(mac.end, mac.allDay, timeZone))
}

/** De que serviço é o link (Meet, Teams ou Zoom); outro endereço, ou nenhum, é `null`. */
export function chamadaDe(url: string | null | undefined): InicioChamada | null {
  if (!url) return null
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    host = parsed.hostname.toLowerCase()
  } catch {
    return null
  }
  if (host === 'meet.google.com') return 'meet'
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'teams'
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'zoom'
  return null
}

const isoDe = (ms: number, original: string): string => (Number.isNaN(ms) ? original : new Date(ms).toISOString())

/**
 * A agenda do dia (D7): os eventos das contas (já únicos entre Google e Microsoft) e os do Mac, uma linha por evento.
 * O evento do Mac que é o mesmo de um da conta some dentro dele: fica a cópia da conta (tem a `calendarKey`) e
 * `fontes` leva as duas. Cancelado ou recusado não entra, nem a cópia dele no Mac. Ordem: início, depois título.
 */
export function juntarAgenda(contas: readonly CalendarEvent[], mac: readonly InicioMacEvento[], timeZone: string): InicioEvento[] {
  const absorvidos = new Set<InicioMacEvento>()
  const eventos: InicioEvento[] = []
  for (const conta of contas) {
    const copias = mac.filter((evento) => !absorvidos.has(evento) && mesmoEvento(conta, evento, timeZone))
    for (const copia of copias) absorvidos.add(copia)
    if (conta.status === 'cancelled' || conta.myResponse === 'declined') continue
    eventos.push({
      id: eventKey(conta),
      titulo: conta.title,
      inicio: isoDe(instanteDe(conta.start, conta.allDay, timeZone), conta.start),
      fim: isoDe(instanteDe(conta.end, conta.allDay, timeZone), conta.end),
      diaInteiro: conta.allDay,
      fontes: copias.length > 0 ? [conta.provider, 'mac'] : [conta.provider],
      calendarKey: eventKey(conta),
      eventId: conta.id,
      chamada: chamadaDe(conta.joinUrl),
      reuniaoId: null,
    })
  }
  for (const evento of mac) {
    if (absorvidos.has(evento)) continue
    // A série do Mac repete o `calendarItemIdentifier` em cada ocorrência: o início faz a chave da linha.
    eventos.push({
      id: `mac:${evento.calendarItemIdentifier}:${evento.start}`,
      titulo: evento.title,
      inicio: isoDe(instanteDe(evento.start, evento.allDay, timeZone), evento.start),
      fim: isoDe(instanteDe(evento.end, evento.allDay, timeZone), evento.end),
      diaInteiro: evento.allDay,
      fontes: ['mac'],
      calendarKey: null,
      eventId: null,
      chamada: chamadaDe(evento.url),
      reuniaoId: null,
    })
  }
  return eventos.sort(ordemDaAgenda)
}

/** Início, depois título; início ilegível vai para o fim, pelo id (nada de `NaN` na comparação). */
function ordemDaAgenda(a: InicioEvento, b: InicioEvento): number {
  const x = Date.parse(a.inicio)
  const y = Date.parse(b.inicio)
  const xRuim = Number.isNaN(x)
  const yRuim = Number.isNaN(y)
  if (xRuim || yRuim) return xRuim && yRuim ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : xRuim ? 1 : -1
  return x - y || a.titulo.localeCompare(b.titulo, 'pt-BR')
}

/** Até quantos dias a última mensagem recebida conta como "sem resposta" (D8). */
export const WHATSAPP_SEM_RESPOSTA_DIAS = 7

/**
 * Conversas sem resposta (D8): de pessoa (grupo não conta), com a última mensagem recebida (não sua) há até 7 dias.
 * `null` (o serviço parado ou não instalado) devolve `null`.
 */
export function whatsappSemResposta(chats: readonly WhatsAppChat[] | null, now: number): number | null {
  if (chats === null) return null
  const limite = now - WHATSAPP_SEM_RESPOSTA_DIAS * 86_400_000
  return chats.filter((chat) => chat.kind === 'person' && chat.lastMessage !== null && !chat.lastMessage.fromMe && chat.lastMessage.at >= limite).length
}

/**
 * Convites sem resposta (D8): eventos da conta confirmados, com participantes, sem a sua resposta e que ainda não
 * acabaram. `null` (sem conta com a agenda) devolve `null`.
 */
export function convitesSemResposta(eventos: readonly CalendarEvent[] | null, now: number): number | null {
  if (eventos === null) return null
  return eventos.filter((evento) => evento.myResponse === 'none' && evento.status === 'confirmed' && evento.attendees.length > 0 && Date.parse(evento.end) > now).length
}

/** Antes do início do evento, quanto a gravação ainda conta como dele (D10). */
export const REUNIAO_ANTES_MS = 10 * 60_000

/**
 * A reunião gravada de um evento (D10): a que guardou o mesmo `calendar.eventId`; no evento só do Mac, a que começou
 * entre 10 min antes do início e o fim com o título equivalente (igual ou um começando com o outro; a janela faz as
 * vezes do fim igual do D7). Mais de uma: a que começou mais perto do início.
 */
export function reuniaoDoEvento(
  reunioes: readonly Pick<Meeting, 'id' | 'title' | 'startedAt' | 'calendar'>[],
  evento: Pick<InicioEvento, 'eventId' | 'titulo' | 'inicio' | 'fim'>,
): string | null {
  if (evento.eventId !== null) return reunioes.find((reuniao) => reuniao.calendar?.eventId === evento.eventId)?.id ?? null
  const inicio = Date.parse(evento.inicio)
  const fim = Date.parse(evento.fim)
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return null
  let melhor: { id: string; distancia: number } | null = null
  for (const reuniao of reunioes) {
    const comecou = Date.parse(reuniao.startedAt)
    if (Number.isNaN(comecou) || comecou < inicio - REUNIAO_ANTES_MS || comecou > fim) continue
    if (semelhanca(reuniao.title, evento.titulo) === null) continue
    const distancia = Math.abs(comecou - inicio)
    if (!melhor || distancia < melhor.distancia) melhor = { id: reuniao.id, distancia }
  }
  return melhor?.id ?? null
}
