// Sinal gerado para o smoke: trilhas falsas e um pipeline que fabrica, em tempo real, blocos de
// 48 kHz com uma conversa (você fala, os participantes respondem). Exercita o mesmo caminho da
// captura real (nível, silêncio, reamostragem, quadros) sem tocar no microfone nem no áudio do
// sistema. Só é carregado quando o main responde `synthetic`, o que só acontece no smoke.
import { AUDIO_BITS_PER_SECOND } from '@shared/meeting-files'
import type { CaptureState, CreatePipeline, MediaApi, StreamLike, TrackLike } from './capture'
import type { MicConstraints } from './constraints'
import type { AudioSource } from './frames'
import type { CreateAudioRecorder, RecorderLike } from './recorder'

const RATE = 48_000
const BLOCK = 1024
const LOOP_S = 14

/** Turnos de fala, em segundos dentro do ciclo. */
const TURNS: Record<AudioSource, readonly [number, number][]> = {
  mic: [
    [0.2, 3.4],
    [7.9, 9.6],
  ],
  system: [
    [3.2, 7.6],
    [9.5, 13.4],
  ],
}
const PEAK: Record<AudioSource, number> = { mic: 0.55, system: 0.42 }

/** Fonte calada pelo smoke: zero absoluto, como o macOS entrega sem a permissão. */
const muted: Record<AudioSource, boolean> = { mic: false, system: false }

class SyntheticTrack implements TrackLike {
  readyState: 'live' | 'ended' = 'live'
  private readonly listeners = new Set<() => void>()

  stop(): void {
    this.readyState = 'ended'
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.delete(listener)
  }
}

class SyntheticStream implements StreamLike {
  readonly track = new SyntheticTrack()

  getAudioTracks(): TrackLike[] {
    return [this.track]
  }

  getVideoTracks(): TrackLike[] {
    return []
  }

  removeTrack(): void {}
}

/** Hash inteiro determinístico -> 0..1. */
function hash01(n: number): number {
  let x = (n * 2654435761) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

/** Envoltória de fala: sílabas de ~4,5 Hz com intensidade variável e pausas curtas entre palavras. */
function envelope(source: AudioSource, t: number): number {
  const cycle = t % LOOP_S
  const turn = TURNS[source].find(([start, end]) => cycle >= start && cycle < end)
  if (!turn) return 0
  const [start, end] = turn
  const edge = Math.min(1, (cycle - start) / 0.15, (end - cycle) / 0.15)
  const rate = source === 'mic' ? 4.6 : 4.2
  const syllable = Math.floor(t * rate)
  const seed = syllable * 7 + (source === 'mic' ? 1 : 3)
  if (hash01(seed) < 0.14) return 0
  const phase = (t * rate) % 1
  const shape = Math.sin(Math.PI * phase) ** 1.6
  return edge * shape * (0.08 + 0.92 * hash01(seed + 101) ** 1.4)
}

/** Restrições do último pedido de microfone, para o smoke conferir que a gravação usa as Configurações. */
let lastMicConstraints: MicConstraints | null = null

export const syntheticMedia: MediaApi = {
  getUserMedia: (constraints) => {
    lastMicConstraints = constraints
    return new Promise((resolve) => setTimeout(() => resolve(new SyntheticStream()), 40))
  },
  getDisplayMedia: () => new Promise((resolve) => setTimeout(() => resolve(new SyntheticStream()), 90)),
  enumerateDevices: () =>
    Promise.resolve([
      { deviceId: 'default', kind: 'audioinput', label: 'Sinal gerado' },
      { deviceId: 'smoke-usb', kind: 'audioinput', label: 'Microfone USB (sinal gerado)' },
    ]),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

export const createSyntheticPipeline: CreatePipeline = (source, _stream, onBlock) => {
  const channelCount = source === 'system' ? 2 : 1
  const began = performance.now()
  let produced = 0
  let noise = source === 'mic' ? 11 : 29
  const random = (): number => {
    noise = (noise * 16807) % 2147483647
    return noise / 2147483647 - 0.5
  }
  const timer = setInterval(() => {
    const due = Math.floor(((performance.now() - began) / 1000) * RATE)
    while (produced + BLOCK <= due) {
      const mono = new Float32Array(BLOCK)
      for (let i = 0; i < BLOCK; i++) {
        const t = (produced + i) / RATE
        const voice = Math.sin(2 * Math.PI * 170 * t) * 0.6 + Math.sin(2 * Math.PI * 510 * t) * 0.25 + random() * 0.5
        // Piso de ruído bem abaixo de -60 dBFS, como num microfone de verdade: nunca é zero absoluto.
        mono[i] = PEAK[source] * envelope(source, t) * voice + random() * 0.0005
      }
      if (muted[source]) mono.fill(0)
      produced += BLOCK
      onBlock(Array.from({ length: channelCount }, () => mono.slice()), RATE)
    }
  }, 20)
  return Promise.resolve({ close: () => Promise.resolve(clearInterval(timer)) })
}

/** Bytes por milissegundo gravado, na taxa do gravador de verdade (64 kbps). */
const RECORDER_BYTES_PER_MS = AUDIO_BITS_PER_SECOND / 8 / 1000

/**
 * Gravador falso do arquivo da reunião (contrato 07, CA10): nenhum `MediaRecorder` de verdade. Entrega
 * pedaços no ritmo do `timeslice`, com bytes proporcionais ao tempo gravado (nada durante a pausa), e o
 * último pedaço ao parar, como o de verdade.
 */
class SyntheticRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive'
  ondataavailable: RecorderLike['ondataavailable'] = null
  onstop: RecorderLike['onstop'] = null
  onerror: RecorderLike['onerror'] = null
  private timer: ReturnType<typeof setInterval> | null = null
  private since = 0
  private pending = 0

  constructor(private readonly mime: string) {}

  start(timeslice = 1000): void {
    this.state = 'recording'
    this.since = performance.now()
    this.timer = setInterval(() => this.emit(), timeslice)
  }

  pause(): void {
    this.accumulate()
    this.state = 'paused'
  }

  resume(): void {
    this.since = performance.now()
    this.state = 'recording'
  }

  stop(): void {
    this.accumulate()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.state = 'inactive'
    setTimeout(() => {
      this.emit()
      this.onstop?.()
    }, 30)
  }

  private accumulate(): void {
    if (this.state !== 'recording') return
    const now = performance.now()
    this.pending += (now - this.since) * RECORDER_BYTES_PER_MS
    this.since = now
  }

  private emit(): void {
    this.accumulate()
    const size = Math.floor(this.pending)
    if (size <= 0) return
    this.pending -= size
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size).fill(0x4d)], { type: this.mime }) })
  }
}

export const createSyntheticRecorder: CreateAudioRecorder = (mime) => ({
  recorder: new SyntheticRecorder(mime),
  addStream: () => undefined,
  close: () => Promise.resolve(),
})

export interface SmokeProbe {
  state: () => CaptureState | null
  frames: () => Record<AudioSource, number> | null
  tapeFrames: () => number
  /** Smoke: põe na coluna de transcrição os trechos da fixture gravada (nenhuma rede). */
  replay: (segments: unknown) => void
  /** Arquivo da reunião em gravação (contrato 07): pedaços e bytes que o main já gravou. */
  audioFile: () => { chunks: number; bytes: number; ok: boolean } | null
  /** Contrato 30: um ciclo da IA anotando agora, sem esperar os 5 min (o relógio injetável do smoke). */
  aiNotesCycle: () => Promise<string>
}

/** O smoke lê o estado da captura e as restrições do microfone e cala uma fonte por aqui (só existe com o sinal gerado). */
export function exposeSmokeProbe(probe: SmokeProbe): void {
  const mute = (source: AudioSource, value: boolean): void => {
    muted[source] = value
  }
  Object.defineProperty(window, '__smokeProbe', { value: { ...probe, mute, micConstraints: () => lastMicConstraints }, configurable: true })
}
