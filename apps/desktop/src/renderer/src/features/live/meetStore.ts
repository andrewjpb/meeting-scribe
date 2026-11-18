// Quem fala no Meet (contrato 27, CA3): o estado da extensão do Chrome (conectada, participantes) e a linha do
// tempo de falas da gravação em curso. O horário de cada evento é o da chegada aqui, no relógio da gravação
// (`RecordingClock.elapsedMs`, sem as pausas): o `ts` da extensão só ordena os eventos de um mesmo envio e descarta
// o evento velho (guardado pela extensão enquanto o app não respondia). Pausado ou sem gravação, o evento não entra.
// "Começou a falar" de quem já está falando não muda nada: a extensão repete, a cada segundo, quem fala agora, e
// isso reabre a fala depois de uma pausa. No "Encerrar", os trechos do sistema ganham os nomes de quem falava.
// Adendo 27b: durante a gravação, a coluna mostra os mesmos nomes pela mesma regra, sobre a linha do tempo parcial
// (a fala aberta vale até agora). É só exibição: o documento salvo continua saindo do merge do "Encerrar".
import { useEffect } from 'react'
import { create } from 'zustand'
import type { MeetSpeakingEvent, MeetState } from '@shared/meet'
import { SEGMENT_NAMES_MAX, type TranscriptSegment } from '@shared/transcription'
import { rereadWhenUnlocked } from '../../app/lockStore'

/** Um intervalo de fala no relógio da gravação. */
export interface SpeakerInterval {
  name: string
  fromMs: number
  toMs: number
}

/** Sobreposição mínima para o nome entrar no trecho: 1 s, ou metade do trecho. */
export const NAME_MIN_OVERLAP_MS = 1_000
export const NAME_MIN_OVERLAP_SHARE = 0.5
/**
 * Evento com `ts` mais antigo que isto na chegada é descartado: a extensão guarda até 60 s quando o app não
 * responde, e carimbar esse atraso como se fosse agora criaria falas no lugar errado.
 */
export const MEET_EVENT_MAX_AGE_MS = 3_000

/** O que a linha do tempo lê do relógio da gravação. */
export interface TimelineClock {
  readonly elapsedMs: number
  readonly running: boolean
}

/** Linha do tempo de uma gravação: quem está falando agora e os intervalos já fechados. */
export class SpeakerTimeline {
  private readonly open = new Map<string, number>()
  private readonly closed: SpeakerInterval[] = []

  constructor(
    private readonly clock: TimelineClock,
    /** Relógio de parede (o mesmo do `ts` da extensão, que roda nesta máquina). */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Eventos de um envio, já na ordem da extensão. Pausado, nada entra; evento velho (mais de 3 s) também não.
   * "Começou" de quem já tem fala aberta é ignorado (o início continua o primeiro).
   */
  receive(events: readonly MeetSpeakingEvent[]): void {
    if (!this.clock.running || !events.length) return
    const at = this.clock.elapsedMs
    const oldest = this.now() - MEET_EVENT_MAX_AGE_MS
    for (const event of events) {
      if (event.ts < oldest) continue
      if (event.speaking) {
        if (!this.open.has(event.name)) this.open.set(event.name, at)
      } else this.close(event.name, at)
    }
  }

  /** Pausa: quem estava falando para de contar ali; a fala volta com o próximo "começou" (ou o repetido da extensão). */
  pause(): void {
    this.closeAll()
  }

  /**
   * A extensão caiu (`connected: false`, também quando o status expira): a fala aberta fecha agora, senão todo trecho
   * seguinte herdaria o nome de quem falava. Volta com o próximo "começou".
   */
  disconnect(): void {
    this.closeAll()
  }

  /** A linha do tempo até agora, para a coluna ao vivo: a fala ainda aberta vai até o fim de qualquer trecho. */
  snapshot(): SpeakerInterval[] {
    const open = [...this.open.entries()].map(([name, fromMs]) => ({ name, fromMs, toMs: Number.POSITIVE_INFINITY }))
    return [...this.closed, ...open]
  }

  /** "Encerrar": fecha o que estiver aberto e devolve os intervalos. */
  end(): SpeakerInterval[] {
    this.closeAll()
    return [...this.closed]
  }

  private closeAll(): void {
    const at = this.clock.elapsedMs
    for (const name of [...this.open.keys()]) this.close(name, at)
  }

  private close(name: string, at: number): void {
    const from = this.open.get(name)
    if (from === undefined) return
    this.open.delete(name)
    if (at > from) this.closed.push({ name, fromMs: from, toMs: at })
  }
}

/**
 * Falas de uma pessoa prontas para consulta: ordenadas pelo início, com o maior fim até cada posição (`reach`),
 * para achar por busca binária só as que podem cruzar um trecho.
 */
interface SpeakerFalas {
  name: string
  intervals: SpeakerInterval[]
  reach: number[]
}

/** Índice da linha do tempo: as falas agrupadas por pessoa, na ordem em que cada nome apareceu. Monta uma vez. */
export type SpeakerIndex = readonly SpeakerFalas[]

export function indexSpeakers(intervals: readonly SpeakerInterval[]): SpeakerIndex {
  const byName = new Map<string, SpeakerInterval[]>()
  for (const interval of intervals) {
    let list = byName.get(interval.name)
    if (!list) {
      list = []
      byName.set(interval.name, list)
    }
    list.push(interval)
  }
  return [...byName.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => a.fromMs - b.fromMs)
    const reach: number[] = []
    let max = -Infinity
    for (const interval of sorted) {
      max = Math.max(max, interval.toMs)
      reach.push(max)
    }
    return { name, intervals: sorted, reach }
  })
}

/** Primeira posição em que `test` vale (o array é monotônico para `test`); `length` se nenhuma. */
function firstIndex(length: number, test: (index: number) => boolean): number {
  let lo = 0
  let hi = length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (test(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Tempo em que a pessoa falou dentro de `[startMs, endMs]`, sem contar duas vezes o mesmo pedaço. */
function overlapMs({ intervals, reach }: SpeakerFalas, startMs: number, endMs: number): number {
  // Antes de `from`, nenhuma fala chega a `startMs`; de `to` em diante, todas começam depois do trecho.
  const from = firstIndex(intervals.length, (index) => (reach[index] as number) > startMs)
  const to = firstIndex(intervals.length, (index) => (intervals[index] as SpeakerInterval).fromMs >= endMs)
  let total = 0
  let cursor = -Infinity
  for (let index = from; index < to; index++) {
    const interval = intervals[index] as SpeakerInterval
    const begin = Math.max(startMs, interval.fromMs, cursor)
    const finish = Math.min(endMs, interval.toMs)
    if (finish > begin) total += finish - begin
    cursor = Math.max(cursor, finish)
  }
  return total
}

/** `namesFor` sobre um índice já montado (a coluna ao vivo e o merge montam o índice uma vez só). */
export function namesInIndex(startMs: number, endMs: number, index: SpeakerIndex): string[] {
  const duration = endMs - startMs
  if (duration <= 0) return []
  return index
    .map((falas) => ({ name: falas.name, overlap: overlapMs(falas, startMs, endMs) }))
    .filter(({ overlap }) => overlap > 0 && (overlap >= NAME_MIN_OVERLAP_MS || overlap >= duration * NAME_MIN_OVERLAP_SHARE))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, SEGMENT_NAMES_MAX)
    .map(({ name }) => name)
}

/**
 * Nomes de um trecho: quem falou pelo menos 1 s dentro dele, ou pelo menos metade dele, do que mais falou para o
 * que menos falou (no máximo 4).
 */
export function namesFor(startMs: number, endMs: number, intervals: readonly SpeakerInterval[]): string[] {
  return namesInIndex(startMs, endMs, indexSpeakers(intervals))
}

type SegmentSpan = Pick<TranscriptSegment, 'source' | 'startMs' | 'endMs'>

/** Nomes de um trecho pela regra do merge: só o sistema ganha nome; o microfone continua "Você" (lista vazia). */
export function segmentNames(segment: SegmentSpan, intervals: readonly SpeakerInterval[]): string[] {
  if (segment.source !== 'system' || !intervals.length) return []
  return namesFor(segment.startMs, segment.endMs, intervals)
}

/** Os trechos do sistema ganham os nomes; os do microfone continuam "Você". Sem intervalo, nada muda. */
export function withSpeakerNames(segments: readonly TranscriptSegment[], intervals: readonly SpeakerInterval[]): TranscriptSegment[] {
  if (!intervals.length) return [...segments]
  const index = indexSpeakers(intervals)
  return segments.map((segment) => {
    if (segment.source !== 'system') return segment
    const names = namesInIndex(segment.startMs, segment.endMs, index)
    return names.length ? { ...segment, names } : segment
  })
}

const NO_NAMES: readonly string[] = []

/**
 * Coluna ao vivo (adendo 27b): o índice da linha do tempo é montado uma vez e o resultado de cada trecho fica
 * guardado por `id`, início e fim; só o trecho que mudou (ou uma linha do tempo nova) recalcula.
 */
export function liveNamer(intervals: readonly SpeakerInterval[]): (segment: SegmentSpan & { id: string }) => readonly string[] {
  if (!intervals.length) return () => NO_NAMES
  const index = indexSpeakers(intervals)
  const cache = new Map<string, readonly string[]>()
  return (segment) => {
    if (segment.source !== 'system') return NO_NAMES
    const key = `${segment.id}|${segment.startMs}|${segment.endMs}`
    let names = cache.get(key)
    if (!names) {
      names = namesInIndex(segment.startMs, segment.endMs, index)
      cache.set(key, names)
    }
    return names
  }
}

const sameIntervals = (a: readonly SpeakerInterval[], b: readonly SpeakerInterval[]): boolean =>
  a.length === b.length && a.every((item, index) => item.name === b[index]?.name && item.fromMs === b[index]?.fromMs && item.toMs === b[index]?.toMs)

interface MeetStoreState {
  connected: boolean
  participants: string[]
  /** Linha do tempo parcial da gravação em curso (adendo 27b); vazia sem gravação. */
  liveIntervals: SpeakerInterval[]
  load: () => Promise<void>
  receive: (state: MeetState) => void
}

/** Linha do tempo da gravação em curso; `null` sem gravação. */
let timeline: SpeakerTimeline | null = null

/** Publica a linha do tempo parcial para a coluna ao vivo; igual à anterior, não re-renderiza nada. */
function publishLive(): void {
  const next = timeline?.snapshot() ?? []
  if (!sameIntervals(useMeet.getState().liveIntervals, next)) useMeet.setState({ liveIntervals: next })
}

export const useMeet = create<MeetStoreState>()((set) => ({
  connected: false,
  participants: [],
  liveIntervals: [],

  load: async () => {
    try {
      const state = await window.__scribeApi.invoke('scribe:meet-status')
      set({ connected: state.connected, participants: state.participants })
    } catch (error) {
      // Bloqueado (contrato 22): lê de novo ao desbloquear.
      rereadWhenUnlocked(error, () => void useMeet.getState().load())
    }
  },

  receive: (state) => {
    set({ connected: state.connected, participants: state.participants })
    timeline?.receive(state.events)
    if (!state.connected) timeline?.disconnect()
    publishLive()
  },
}))

/** Começo da gravação: uma linha do tempo nova, no relógio dela. */
export function meetRecordingStarted(clock: TimelineClock): void {
  timeline = new SpeakerTimeline(clock)
  publishLive()
}

/** Pausa da gravação: as falas abertas fecham no instante da pausa. */
export function meetRecordingPaused(): void {
  timeline?.pause()
  publishLive()
}

/**
 * "Encerrar": os intervalos da gravação (o aberto fecha agora) e a linha do tempo acaba. A coluna fica com os
 * intervalos finais (a tela segue aberta se salvar falhar) até a próxima gravação começar.
 */
export function meetRecordingEnded(): SpeakerInterval[] {
  const intervals = timeline?.end() ?? []
  timeline = null
  if (!sameIntervals(useMeet.getState().liveIntervals, intervals)) useMeet.setState({ liveIntervals: intervals })
  return intervals
}

/** Lê o estado ao abrir e recebe as mudanças do main. */
export function useMeetSync(): void {
  useEffect(() => {
    void useMeet.getState().load()
    return window.__scribeApi.on('scribe:meet-changed', (state) => useMeet.getState().receive(state))
  }, [])
}
