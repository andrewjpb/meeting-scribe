import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CaptureSession,
  type BlockHandler,
  type CreatePipeline,
  type DeviceInfo,
  type MediaApi,
  type StreamLike,
  type TrackLike,
} from '../../src/renderer/src/audio/capture'
import type { MicConstraints, MicSettings } from '../../src/renderer/src/audio/constraints'
import { CountingFrameSink, type AudioSource } from '../../src/renderer/src/audio/frames'

class FakeTrack implements TrackLike {
  readyState: 'live' | 'ended' = 'live'
  readonly stop = vi.fn(() => {
    this.readyState = 'ended'
  })
  private readonly listeners = new Set<() => void>()
  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.delete(listener)
  }
  /** O sistema encerrou a trilha (permissão revogada, dispositivo sumiu). */
  endFromSystem(): void {
    this.readyState = 'ended'
    for (const listener of this.listeners) listener()
  }
}

class FakeStream implements StreamLike {
  constructor(
    readonly audio: FakeTrack[] = [new FakeTrack()],
    readonly video: FakeTrack[] = [],
  ) {}
  getAudioTracks(): TrackLike[] {
    return this.audio
  }
  getVideoTracks(): TrackLike[] {
    return this.video
  }
  removeTrack(track: TrackLike): void {
    const index = this.video.indexOf(track as FakeTrack)
    if (index >= 0) this.video.splice(index, 1)
  }
}

const denied = (): Error => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })

interface Harness {
  session: CaptureSession
  media: { [K in keyof MediaApi]: ReturnType<typeof vi.fn> } & MediaApi
  streams: Record<AudioSource, FakeStream>
  blocks: Partial<Record<AudioSource, BlockHandler>>
  closes: Record<AudioSource, ReturnType<typeof vi.fn>>
  sink: CountingFrameSink
  fireDeviceChange: () => void
  setNow: (ms: number) => void
}

function harness(
  options: { micFails?: boolean; systemFails?: boolean; systemVideo?: boolean; pipelineReady?: Promise<void>; settings?: MicSettings; micError?: (constraints: MicConstraints) => Error | null } = {},
): Harness {
  let now = 0
  const streams: Record<AudioSource, FakeStream> = {
    mic: new FakeStream(),
    system: new FakeStream([new FakeTrack()], options.systemVideo ? [new FakeTrack()] : []),
  }
  const deviceListeners = new Set<() => void>()
  const devices: DeviceInfo[] = [
    { deviceId: 'default', kind: 'audioinput', label: 'Microfone do MacBook' },
    { deviceId: 'cam', kind: 'videoinput', label: 'Câmera' },
  ]
  const media = {
    getUserMedia: vi.fn((constraints: MicConstraints) => {
      const error = options.micError?.(constraints) ?? null
      if (error) return Promise.reject(error)
      return options.micFails ? Promise.reject(denied()) : Promise.resolve(streams.mic)
    }),
    getDisplayMedia: vi.fn(() => (options.systemFails ? Promise.reject(denied()) : Promise.resolve(streams.system))),
    enumerateDevices: vi.fn(() => Promise.resolve(devices)),
    addEventListener: vi.fn((_type: 'devicechange', listener: () => void) => deviceListeners.add(listener)),
    removeEventListener: vi.fn((_type: 'devicechange', listener: () => void) => deviceListeners.delete(listener)),
  }
  const blocks: Partial<Record<AudioSource, BlockHandler>> = {}
  const closes = { mic: vi.fn(() => Promise.resolve()), system: vi.fn(() => Promise.resolve()) }
  const createPipeline: CreatePipeline = async (source, _stream, onBlock) => {
    await options.pipelineReady
    blocks[source] = onBlock
    return { close: closes[source] }
  }
  const sink = new CountingFrameSink()
  const session = new CaptureSession({ media, createPipeline, sink, settings: options.settings ?? { echoCancellation: false, micDeviceId: null }, now: () => now })
  return {
    session,
    media: media as Harness['media'],
    streams,
    blocks,
    closes,
    sink,
    fireDeviceChange: () => deviceListeners.forEach((listener) => listener()),
    setNow: (ms) => {
      now = ms
    },
  }
}

/** 200 ms a 48 kHz: com o atraso do filtro (meia janela), rende ao menos um quadro de 100 ms. */
const block = (value: number, channels = 1): Float32Array[] => Array.from({ length: channels }, () => new Float32Array(9600).fill(value))

describe('CaptureSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pede as duas fontes no mesmo instante, antes de qualquer espera (o gesto vale para as duas)', async () => {
    const h = harness()
    const started = h.session.start()
    expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
    expect(h.media.getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(h.media.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    expect(h.media.getDisplayMedia).toHaveBeenCalledWith({
      video: false,
      audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    await started
    expect(h.session.getState()).toMatchObject({ phase: 'recording', mic: 'live', system: 'live' })
  })

  it('getDisplayMedia rejeitado: o microfone segue live e o sistema fica failed', async () => {
    const h = harness({ systemFails: true })
    await h.session.start()
    const state = h.session.getState()
    expect(state.mic).toBe('live')
    expect(state.system).toBe('failed')
    expect(state.failure).toEqual({ mic: null, system: 'denied' })
    h.blocks.mic?.(block(0.1), 48_000)
    expect(h.sink.counts.mic).toBeGreaterThan(0)
    expect(h.sink.counts.system).toBe(0)
    expect(h.session.takeLevels().system).toBeNull()
  })

  it('getUserMedia rejeitado: o sistema segue live e o microfone fica failed', async () => {
    const h = harness({ micFails: true })
    await h.session.start()
    const state = h.session.getState()
    expect(state.system).toBe('live')
    expect(state.mic).toBe('failed')
    expect(state.failure).toEqual({ mic: 'denied', system: null })
    h.blocks.system?.(block(0.1, 2), 48_000)
    expect(h.sink.counts.mic).toBe(0)
    expect(h.sink.counts.system).toBeGreaterThan(0)
  })

  it('trilha de vídeo que vier no pedido do sistema é parada e removida', async () => {
    const h = harness({ systemVideo: true })
    const video = h.streams.system.video[0] as FakeTrack
    await h.session.start()
    expect(video.stop).toHaveBeenCalled()
    expect(h.streams.system.video).toHaveLength(0)
    expect(h.session.getState().system).toBe('live')
  })

  it('devicechange relê a lista depois de 500 ms de calmaria e não mexe nas trilhas', async () => {
    const h = harness()
    await h.session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.media.enumerateDevices).toHaveBeenCalledTimes(1)
    expect(h.session.getState().devices).toEqual([{ deviceId: 'default', kind: 'audioinput', label: 'Microfone do MacBook' }])

    h.fireDeviceChange()
    await vi.advanceTimersByTimeAsync(300)
    h.fireDeviceChange()
    await vi.advanceTimersByTimeAsync(300)
    h.fireDeviceChange()
    await vi.advanceTimersByTimeAsync(499)
    expect(h.media.enumerateDevices).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.media.enumerateDevices).toHaveBeenCalledTimes(2)

    expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
    expect(h.media.getDisplayMedia).toHaveBeenCalledTimes(1)
    for (const source of ['mic', 'system'] as const) {
      expect((h.streams[source].audio[0] as FakeTrack).stop).not.toHaveBeenCalled()
      expect(h.closes[source]).not.toHaveBeenCalled()
    }
    expect(h.session.getState()).toMatchObject({ mic: 'live', system: 'live' })
  })

  it('pausado: cronômetro para, trilhas seguem live e nenhum quadro sai; retomar volta a emitir', async () => {
    const h = harness()
    await h.session.start()
    h.setNow(10_000)
    h.blocks.mic?.(block(0.1), 48_000)
    h.blocks.system?.(block(0.1, 2), 48_000)
    const before = { ...h.sink.counts }
    expect(before.mic).toBeGreaterThan(0)
    expect(before.system).toBeGreaterThan(0)

    h.session.pause()
    expect(h.session.getState().phase).toBe('paused')
    for (let i = 0; i < 20; i++) {
      h.blocks.mic?.(block(0.1), 48_000)
      h.blocks.system?.(block(0.1, 2), 48_000)
    }
    h.setNow(15_000)
    expect(h.sink.counts).toEqual(before)
    expect(h.session.clock.elapsedMs).toBe(10_000)
    expect(h.session.getState()).toMatchObject({ mic: 'live', system: 'live' })
    expect((h.streams.mic.audio[0] as FakeTrack).readyState).toBe('live')

    h.session.resume()
    h.setNow(19_000)
    h.blocks.mic?.(block(0.1), 48_000)
    expect(h.sink.counts.mic).toBeGreaterThan(before.mic)
    expect(h.session.clock.elapsedMs).toBe(14_000)
  })

  it('encerrar para todas as trilhas, fecha os pipelines e devolve duração e fontes ouvidas', async () => {
    const h = harness()
    await h.session.start()
    h.blocks.mic?.(block(0.2), 48_000)
    h.blocks.system?.(block(0, 2), 48_000)
    h.setNow(10_000)
    h.session.pause()
    h.setNow(15_000)
    h.session.resume()
    h.setNow(19_000)
    const framesBeforeStop = { ...h.sink.counts }
    const result = await h.session.stop()
    expect(result).toEqual({ durationMs: 14_000, sources: { mic: true, system: false } })
    for (const source of ['mic', 'system'] as const) {
      expect((h.streams[source].audio[0] as FakeTrack).readyState).toBe('ended')
      expect(h.closes[source]).toHaveBeenCalledTimes(1)
    }
    expect(h.session.getState()).toMatchObject({ phase: 'stopped', mic: 'ended', system: 'ended' })
    expect(h.media.removeEventListener).toHaveBeenCalled()
    h.blocks.mic?.(block(0.2), 48_000)
    expect(h.sink.counts).toEqual(framesBeforeStop)
  })

  it('encerrar com o pipeline ainda subindo fecha o pipeline quando ele fica pronto e encerra as trilhas', async () => {
    let ready = (): void => undefined
    const h = harness({ pipelineReady: new Promise<void>((resolve) => (ready = resolve)) })
    const started = h.session.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.session.getState()).toMatchObject({ mic: 'starting', system: 'starting' })

    await h.session.stop()
    ready()
    await started
    await vi.advanceTimersByTimeAsync(0)

    for (const source of ['mic', 'system'] as const) {
      expect(h.closes[source]).toHaveBeenCalledTimes(1)
      expect((h.streams[source].audio[0] as FakeTrack).readyState).toBe('ended')
    }
    expect(h.session.getState().phase).toBe('stopped')
  })

  it('silêncio absoluto do sistema por 3 s vira silent e o som de volta desfaz; trilha encerrada vira ended', async () => {
    const h = harness()
    await h.session.start()
    for (let t = 0; t <= 3000; t += 100) {
      h.setNow(t)
      h.blocks.system?.(block(0, 2), 48_000)
    }
    expect(h.session.getState().silence.system).toBe('silent')
    expect(h.session.takeLevels().system).toBeNull()

    h.setNow(3100)
    h.blocks.system?.(block(0.01, 2), 48_000)
    expect(h.session.getState().silence.system).toBe('ok')
    expect(h.session.takeLevels().system).toBeGreaterThan(0)

    ;(h.streams.system.audio[0] as FakeTrack).endFromSystem()
    expect(h.session.getState()).toMatchObject({ system: 'ended', silence: { system: 'ended' }, mic: 'live' })
  })

  it('o temporizador também detecta silêncio sem bloco novo', async () => {
    const h = harness()
    await h.session.start()
    h.setNow(3500)
    await vi.advanceTimersByTimeAsync(250)
    expect(h.session.getState().silence).toEqual({ mic: 'silent', system: 'silent' })
  })

  describe('"Ouvir só os participantes" (contrato 29)', () => {
    it('desligado: trilha enabled=false, quadros do mic descartados, nada de heard, medidor nem silêncio; o estado não vira failed', async () => {
      const h = harness()
      await h.session.start()
      h.session.setMicEnabled(false)
      const track = h.streams.mic.audio[0] as FakeTrack & { enabled?: boolean }
      expect(track.enabled).toBe(false)
      expect(track.readyState).toBe('live')
      for (let t = 0; t <= 4000; t += 100) {
        h.setNow(t)
        h.blocks.mic?.(block(0.3), 48_000)
        h.blocks.system?.(block(0.1, 2), 48_000)
      }
      await vi.advanceTimersByTimeAsync(500)
      expect(h.sink.counts.mic).toBe(0)
      expect(h.sink.counts.system).toBeGreaterThan(0)
      const state = h.session.getState()
      expect(state).toMatchObject({ micOff: true, mic: 'live', heard: { mic: false, system: true }, silence: { mic: 'ok' } })
      // Desligado não é fonte ausente: a fita fica sem barras e sem o tracejado.
      expect(h.session.takeLevels().mic).toBe(0)
      const result = await h.session.stop()
      expect(result.sources).toEqual({ mic: false, system: true })
    })

    it('religar volta a entregar sem novo getUserMedia; pausado, o estado vale ao retomar', async () => {
      const h = harness()
      await h.session.start()
      h.session.pause()
      h.session.setMicEnabled(false)
      h.session.resume()
      h.blocks.mic?.(block(0.3), 48_000)
      expect(h.sink.counts.mic).toBe(0)
      h.setNow(5000)
      h.session.setMicEnabled(true)
      const track = h.streams.mic.audio[0] as FakeTrack & { enabled?: boolean }
      expect(track.enabled).toBe(true)
      expect(h.session.getState().micOff).toBe(false)
      // O detector recomeça a contar no religar: sem aviso de silêncio logo de cara.
      await vi.advanceTimersByTimeAsync(250)
      expect(h.session.getState().silence.mic).toBe('ok')
      h.blocks.mic?.(block(0.3), 48_000)
      expect(h.sink.counts.mic).toBeGreaterThan(0)
      expect(h.session.getState().heard.mic).toBe(true)
      expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('desligado antes de o microfone abrir: a trilha já nasce desligada', async () => {
      const h = harness()
      const started = h.session.start()
      h.session.setMicEnabled(false)
      await started
      expect((h.streams.mic.audio[0] as FakeTrack & { enabled?: boolean }).enabled).toBe(false)
      expect(h.session.getState()).toMatchObject({ mic: 'live', micOff: true })
    })
  })

  it('takeLevels devolve o RMS da janela e zera', async () => {
    const h = harness()
    await h.session.start()
    h.blocks.mic?.(block(0.5), 48_000)
    expect(h.session.takeLevels().mic).toBeCloseTo(0.5, 5)
    expect(h.session.takeLevels().mic).toBe(0)
  })

  describe('microfone escolhido em Configurações (CA9, CA17)', () => {
    it('com cancelamento de eco ligado e o microfone salvo presente, pede esse microfone com eco', async () => {
      const h = harness({ settings: { echoCancellation: true, micDeviceId: 'default' } })
      await h.session.start()
      expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
      expect(h.media.getUserMedia).toHaveBeenCalledWith({
        audio: { deviceId: { exact: 'default' }, echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      expect(h.session.getState().mic).toBe('live')
    })

    it('microfone salvo que não existe mais: a captura usa o padrão', async () => {
      const h = harness({ settings: { echoCancellation: false, micDeviceId: 'usb-que-sumiu' } })
      await h.session.start()
      expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
      expect(h.media.getUserMedia).toHaveBeenCalledWith({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      expect(h.session.getState().mic).toBe('live')
    })

    it('o pedido do microfone salvo falha por indisponível: tenta de novo com o padrão', async () => {
      const overconstrained = Object.assign(new Error('não existe'), { name: 'OverconstrainedError' })
      const h = harness({ settings: { echoCancellation: false, micDeviceId: 'default' }, micError: (c) => (c.audio.deviceId ? overconstrained : null) })
      await h.session.start()
      expect(h.media.getUserMedia).toHaveBeenCalledTimes(2)
      expect(h.media.getUserMedia.mock.calls[1]?.[0]).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
      expect(h.session.getState().mic).toBe('live')
    })

    it('microfone negado não vira nova tentativa', async () => {
      const h = harness({ settings: { echoCancellation: false, micDeviceId: 'default' }, micFails: true })
      await h.session.start()
      expect(h.media.getUserMedia).toHaveBeenCalledTimes(1)
      expect(h.session.getState().failure.mic).toBe('denied')
    })
  })
})
