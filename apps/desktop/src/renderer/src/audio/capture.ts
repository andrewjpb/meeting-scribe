// Orquestrador da captura: pede microfone e áudio do sistema, liga cada trilha a um pipeline de
// áudio e leva os blocos para o nível da fita, o detector de silêncio e o enquadrador. Tudo que toca
// o navegador chega injetado (`MediaApi`, `CreatePipeline`), então a lógica é testada sem WebAudio.
// Uma fonte falhar nunca derruba a outra (R7), e `devicechange` só relê a lista de dispositivos (R13).
import { RecordingClock } from './clock'
import { buildMicConstraints, buildSystemConstraints, resolveMicDeviceId, type MicConstraints, type MicSettings, type SystemConstraints } from './constraints'
import { Framer, type AudioSource, type FrameSink } from './frames'
import { hasSignal, LevelMeter } from './levels'
import { downmix, Resampler } from './resample'
import { SilenceDetector, SILENCE_AFTER_MS, type SilenceState } from './silence'

export interface TrackLike {
  readonly readyState: string
  stop(): void
  addEventListener(type: 'ended', listener: () => void): void
  removeEventListener(type: 'ended', listener: () => void): void
}

export interface StreamLike {
  getAudioTracks(): TrackLike[]
  getVideoTracks(): TrackLike[]
  removeTrack(track: TrackLike): void
}

export interface DeviceInfo {
  deviceId: string
  kind: string
  label: string
}

export interface MediaApi {
  getUserMedia(constraints: MicConstraints): Promise<StreamLike>
  getDisplayMedia(constraints: SystemConstraints): Promise<StreamLike>
  enumerateDevices(): Promise<DeviceInfo[]>
  addEventListener(type: 'devicechange', listener: () => void): void
  removeEventListener(type: 'devicechange', listener: () => void): void
}

/** Um bloco do worklet: um `Float32Array` por canal, na taxa do `AudioContext`. */
export type BlockHandler = (channels: Float32Array[], sampleRate: number) => void

export interface Pipeline {
  close(): Promise<void>
}

export type CreatePipeline = (source: AudioSource, stream: StreamLike, onBlock: BlockHandler) => Promise<Pipeline>

export type SourceStatus = 'idle' | 'starting' | 'live' | 'failed' | 'ended'
export type CaptureFailure = 'denied' | 'unavailable' | 'error'
export type CapturePhase = 'idle' | 'recording' | 'paused' | 'stopping' | 'stopped'

export interface CaptureState {
  phase: CapturePhase
  mic: SourceStatus
  system: SourceStatus
  failure: Readonly<Record<AudioSource, CaptureFailure | null>>
  silence: Readonly<Record<AudioSource, SilenceState>>
  /** A fonte já entregou alguma amostra diferente de zero nesta gravação. */
  heard: Readonly<Record<AudioSource, boolean>>
  /** Entradas de áudio (`audioinput`) da última leitura. */
  devices: readonly DeviceInfo[]
}

export interface CaptureResult {
  durationMs: number
  sources: { mic: boolean; system: boolean }
}

export interface CaptureDeps {
  media: MediaApi
  createPipeline: CreatePipeline
  sink: FrameSink
  settings: MicSettings
  now?: () => number
  deviceDebounceMs?: number
  silenceMs?: number
  /** Fonte que ficou `live`: o gravador do arquivo da reunião (contrato 07) liga a mesma trilha na mistura dele. */
  onStream?: (source: AudioSource, stream: StreamLike) => void
}

export const DEVICE_DEBOUNCE_MS = 500
const SILENCE_TICK_MS = 250
const SOURCES: readonly AudioSource[] = ['mic', 'system']

interface SourceRuntime {
  stream: StreamLike
  track: TrackLike
  pipeline: Pipeline | null
  resampler: Resampler | null
  framer: Framer
  meter: LevelMeter
  silence: SilenceDetector
  onEnded: () => void
}

export function classifyFailure(error: unknown): CaptureFailure {
  const name = error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error) ? String((error as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') return 'unavailable'
  return 'error'
}

const initialState: CaptureState = {
  phase: 'idle',
  mic: 'idle',
  system: 'idle',
  failure: { mic: null, system: null },
  silence: { mic: 'ok', system: 'ok' },
  heard: { mic: false, system: false },
  devices: [],
}

export class CaptureSession {
  readonly clock: RecordingClock
  private state: CaptureState = initialState
  private readonly listeners = new Set<(state: CaptureState) => void>()
  private readonly runtimes = new Map<AudioSource, SourceRuntime>()
  private readonly now: () => number
  private deviceTimer: ReturnType<typeof setTimeout> | null = null
  private silenceTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: CaptureDeps) {
    this.now = deps.now ?? (() => performance.now())
    this.clock = new RecordingClock(this.now)
  }

  getState(): CaptureState {
    return this.state
  }

  subscribe(listener: (state: CaptureState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Chamar direto do gesto do usuário. Os dois pedidos saem no mesmo instante, antes de qualquer
   * espera: o `getDisplayMedia` exige ativação do usuário, que não sobrevive à espera do microfone.
   */
  start(): Promise<void> {
    if (this.state.phase !== 'idle') return Promise.reject(new Error('a captura já foi iniciada'))
    this.clock.start()
    this.update({ phase: 'recording', mic: 'starting', system: 'starting' })
    this.deps.media.addEventListener('devicechange', this.onDeviceChange)
    const mic = this.open('mic', () => this.askMic())
    const system = this.open('system', () => this.deps.media.getDisplayMedia(buildSystemConstraints()))
    this.silenceTimer = setInterval(() => {
      for (const source of SOURCES) this.runtimes.get(source)?.silence.tick()
    }, SILENCE_TICK_MS)
    return Promise.all([mic, system]).then(() => this.refreshDevices())
  }

  pause(): void {
    if (this.state.phase !== 'recording') return
    this.clock.pause()
    this.update({ phase: 'paused' })
  }

  resume(): void {
    if (this.state.phase !== 'paused') return
    for (const source of SOURCES) this.runtimes.get(source)?.meter.reset()
    this.clock.resume()
    this.update({ phase: 'recording' })
  }

  /** Para todas as trilhas e fecha os `AudioContext`. Devolve a duração e as fontes ouvidas. */
  async stop(): Promise<CaptureResult> {
    const { phase } = this.state
    if (phase === 'idle' || phase === 'stopping' || phase === 'stopped') throw new Error('a captura não está ativa')
    const durationMs = this.clock.stop()
    this.update({ phase: 'stopping' })
    this.deps.media.removeEventListener('devicechange', this.onDeviceChange)
    if (this.deviceTimer !== null) clearTimeout(this.deviceTimer)
    if (this.silenceTimer !== null) clearInterval(this.silenceTimer)
    this.deviceTimer = null
    this.silenceTimer = null
    await Promise.all(SOURCES.map((source) => this.release(source)))
    const ended = (status: SourceStatus): SourceStatus => (status === 'failed' ? 'failed' : 'ended')
    this.update({ phase: 'stopped', mic: ended(this.state.mic), system: ended(this.state.system) })
    return { durationMs, sources: { mic: this.state.heard.mic, system: this.state.heard.system } }
  }

  /**
   * RMS de cada fonte desde a leitura anterior, para uma coluna da fita. `null` quando a fonte está
   * ausente: falhou, encerrou ou está em silêncio absoluto.
   */
  takeLevels(): Record<AudioSource, number | null> {
    const level = (source: AudioSource): number | null => {
      const runtime = this.runtimes.get(source)
      const rms = runtime?.meter.take() ?? null
      // Pedido ainda em andamento não é fonte ausente: a fita fica vazia, sem o tracejado.
      if (this.state[source] === 'starting') return 0
      if (!runtime || this.state[source] !== 'live' || this.state.silence[source] !== 'ok') return null
      return rms ?? 0
    }
    return { mic: level('mic'), system: level('system') }
  }

  /**
   * Microfone padrão: pede na hora, ainda dentro do gesto. Microfone escolhido: confere antes se ele
   * ainda existe; sumiu (ou o pedido dele falha por indisponível), a captura usa o padrão.
   */
  private async askMic(): Promise<StreamLike> {
    const { settings, media } = this.deps
    if (settings.micDeviceId === null) return media.getUserMedia(buildMicConstraints(settings))
    let devices: DeviceInfo[] = []
    try {
      devices = await media.enumerateDevices()
    } catch {
      // Sem lista, tenta o salvo; a queda para o padrão abaixo cobre o resto.
    }
    const micDeviceId = resolveMicDeviceId(settings.micDeviceId, devices)
    try {
      return await media.getUserMedia(buildMicConstraints({ ...settings, micDeviceId }))
    } catch (error) {
      if (micDeviceId === null || classifyFailure(error) !== 'unavailable') throw error
      return media.getUserMedia(buildMicConstraints({ ...settings, micDeviceId: null }))
    }
  }

  private async open(source: AudioSource, ask: () => Promise<StreamLike>): Promise<void> {
    let stream: StreamLike
    try {
      stream = await ask()
    } catch (error) {
      this.fail(source, classifyFailure(error))
      return
    }
    if (this.stopped()) return stopTracks(stream)

    // Pedido só de áudio: se vier vídeo mesmo assim, sai na hora.
    for (const video of stream.getVideoTracks()) {
      video.stop()
      stream.removeTrack(video)
    }
    const track = stream.getAudioTracks()[0]
    if (!track) {
      stopTracks(stream)
      this.fail(source, 'error')
      return
    }

    const runtime: SourceRuntime = {
      stream,
      track,
      pipeline: null,
      resampler: null,
      framer: new Framer(source, this.deps.sink),
      meter: new LevelMeter(),
      silence: new SilenceDetector(this.now, (silence) => this.update({ silence: { ...this.state.silence, [source]: silence } }), this.deps.silenceMs ?? SILENCE_AFTER_MS),
      onEnded: () => this.onTrackEnded(source),
    }
    this.runtimes.set(source, runtime)

    let pipeline: Pipeline
    try {
      pipeline = await this.deps.createPipeline(source, stream, (channels, sampleRate) => this.onBlock(source, channels, sampleRate))
    } catch {
      this.runtimes.delete(source)
      stopTracks(stream)
      this.fail(source, 'error')
      return
    }
    // "Encerrar" chegou enquanto o pipeline subia: `stop()` já tirou este runtime do mapa (com o
    // pipeline ainda nulo), então o recém-criado é fechado aqui mesmo.
    if (this.stopped()) {
      stopTracks(stream)
      await pipeline.close().catch(() => undefined)
      return
    }
    runtime.pipeline = pipeline

    track.addEventListener('ended', runtime.onEnded)
    this.update(statusPatch(source, 'live'))
    try {
      this.deps.onStream?.(source, stream)
    } catch {
      // O arquivo da reunião nunca derruba a captura.
    }
    if (track.readyState === 'ended') this.onTrackEnded(source)
  }

  private onBlock(source: AudioSource, channels: Float32Array[], sampleRate: number): void {
    const runtime = this.runtimes.get(source)
    if (!runtime || this.stopped()) return
    const signal = hasSignal(channels)
    runtime.silence.update(signal)
    if (signal && !this.state.heard[source]) this.update({ heard: { ...this.state.heard, [source]: true } })
    if (this.state.phase !== 'recording') return
    runtime.meter.add(channels)
    if (runtime.resampler?.inputRate !== sampleRate) runtime.resampler = new Resampler(sampleRate)
    runtime.framer.push(runtime.resampler.process(downmix(channels)))
  }

  private onTrackEnded(source: AudioSource): void {
    const runtime = this.runtimes.get(source)
    if (!runtime || this.stopped()) return
    runtime.silence.end()
    this.update(statusPatch(source, 'ended'))
  }

  private readonly onDeviceChange = (): void => {
    if (this.deviceTimer !== null) clearTimeout(this.deviceTimer)
    this.deviceTimer = setTimeout(() => {
      this.deviceTimer = null
      void this.refreshDevices()
    }, this.deps.deviceDebounceMs ?? DEVICE_DEBOUNCE_MS)
  }

  private async refreshDevices(): Promise<void> {
    try {
      const all = await this.deps.media.enumerateDevices()
      const devices = all.filter((device) => device.kind === 'audioinput').map(({ deviceId, kind, label }) => ({ deviceId, kind, label }))
      this.update({ devices })
    } catch {
      // Lista antiga continua valendo.
    }
  }

  private async release(source: AudioSource): Promise<void> {
    const runtime = this.runtimes.get(source)
    if (!runtime) return
    this.runtimes.delete(source)
    runtime.track.removeEventListener('ended', runtime.onEnded)
    stopTracks(runtime.stream)
    await runtime.pipeline?.close().catch(() => undefined)
  }

  private fail(source: AudioSource, failure: CaptureFailure): void {
    if (this.stopped()) return
    this.update({ ...statusPatch(source, 'failed'), failure: { ...this.state.failure, [source]: failure } })
  }

  private stopped(): boolean {
    return this.state.phase === 'stopping' || this.state.phase === 'stopped'
  }

  private update(patch: Partial<CaptureState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
}

function statusPatch(source: AudioSource, status: SourceStatus): Pick<CaptureState, 'mic'> | Pick<CaptureState, 'system'> {
  return source === 'mic' ? { mic: status } : { system: status }
}

function stopTracks(stream: StreamLike): void {
  for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) track.stop()
}
