// CA3 de ponta a ponta: em modo real, o quadro que a captura produz chega ao socket da transcrição.
// A captura roda de verdade (Framer e reamostragem); só o worklet, o WebSocket e o IPC são falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockHandler, MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import type { AudioSource } from '../../src/renderer/src/audio/frames'
import type { StreamingSocket } from '../../src/renderer/src/transcription/sink'

const track = (): TrackLike => ({
  readyState: 'live',
  stop: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})
const stream = (): StreamLike => {
  const audio = [track()]
  return { getAudioTracks: () => audio, getVideoTracks: () => [], removeTrack: () => undefined }
}
const media: MediaApi = {
  getUserMedia: () => Promise.resolve(stream()),
  getDisplayMedia: () => Promise.resolve(stream()),
  enumerateDevices: () => Promise.resolve([]),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

/** Saída do worklet de cada fonte: o teste empurra blocos de áudio por aqui. */
const blocks = new Map<AudioSource, BlockHandler>()
let probe: { frames: () => Record<AudioSource, number> } | null = null
const env: CaptureEnvironment = {
  mode: 'real',
  media,
  createPipeline: (source, _stream, onBlock) => {
    blocks.set(source, onBlock)
    return Promise.resolve({ close: () => Promise.resolve() })
  },
  // O arquivo da reunião (contrato 07) tem teste próprio (recording-audio-file.test.ts).
  recorderMime: () => null,
  createRecorder: () => {
    throw new Error('sem gravador neste teste')
  },
  exposeProbe: (value) => {
    probe = value as unknown as typeof probe
  },
}

vi.mock('../../src/renderer/src/audio/environment', () => ({
  captureEnvironment: () => env,
  loadCaptureEnvironment: () => Promise.resolve(),
}))

class FakeSocket implements StreamingSocket {
  readyState = 0
  sent: (string | ArrayBuffer | ArrayBufferView)[] = []
  onopen: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer | ArrayBufferView): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
  get audio(): Uint8Array[] {
    return this.sent.filter((item): item is Uint8Array => item instanceof Uint8Array)
  }
}

const sockets: FakeSocket[] = []

const { useRecording, exposeRecordingProbe } = await import('../../src/renderer/src/features/live/recordingStore')
const { useSettings } = await import('../../src/renderer/src/app/settingsStore')
const { useTranscription } = await import('../../src/renderer/src/transcription/store')
const { DEFAULT_SETTINGS } = await import('../../src/shared/settings-defaults')

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('recordingStore: captura ligada à transcrição (B1)', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    sockets.length = 0
    blocks.clear()
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:transcription-token') return Promise.resolve({ ok: true, token: 'tok-teste', expiresInSeconds: 60 })
      if (channel === 'scribe:meetings-create') return Promise.resolve({ id: 'm1', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: true, system: true } })
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    // Os testes acham o socket do sistema pelo `speaker_labels`.
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, identifySpeakers: true } })
    vi.stubGlobal(
      'WebSocket',
      function FakeWebSocket(url: string) {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      } as unknown as typeof WebSocket,
    )
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('os 3200 bytes de PCM de cada quadro capturado chegam ao socket da fonte', async () => {
    exposeRecordingProbe()
    expect(useRecording.getState().start()).toBe(true)
    await tick()
    await tick()
    expect(sockets.map((socket) => new URL(socket.url).searchParams.get('token'))).toEqual(['tok-teste', 'tok-teste'])
    const mic = sockets.find((socket) => !new URL(socket.url).searchParams.has('speaker_labels')) as FakeSocket
    const system = sockets.find((socket) => new URL(socket.url).searchParams.has('speaker_labels')) as FakeSocket
    mic.readyState = 1
    mic.onopen?.()
    system.readyState = 1
    system.onopen?.()

    // Meio segundo de áudio por fonte a 16 kHz: 8000 amostras, 5 quadros de 100 ms.
    for (let i = 0; i < 5; i++) {
      blocks.get('mic')?.([new Float32Array(1_600).fill(0.25)], 16_000)
      blocks.get('system')?.([new Float32Array(1_600).fill(-0.25)], 16_000)
    }
    const frames = probe?.frames()
    expect(frames?.mic).toBeGreaterThan(0)
    expect(mic.audio).toHaveLength(frames?.mic ?? -1)
    expect(system.audio).toHaveLength(frames?.system ?? -1)
    for (const chunk of [...mic.audio, ...system.audio]) expect(chunk.byteLength).toBe(3_200)
    // O PCM do microfone é positivo e o do sistema negativo: cada fonte foi para o próprio socket, sem
    // o cabeçalho de 8 bytes (que começaria com a versão 1 e o byte da fonte).
    const sample = (chunk: Uint8Array, index: number): number => new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getInt16(index * 2, true)
    const lastMic = mic.audio.at(-1) as Uint8Array
    const lastSystem = system.audio.at(-1) as Uint8Array
    expect(sample(lastMic, 1_599)).toBeGreaterThan(8_000)
    expect(sample(lastSystem, 1_599)).toBeLessThan(-8_000)

    const ending = useRecording.getState().end()
    await tick()
    for (const socket of sockets) {
      expect(socket.sent.filter((item) => typeof item === 'string')).toEqual([JSON.stringify({ type: 'Terminate' })])
      socket.onmessage?.({ data: JSON.stringify({ type: 'Termination' }) })
    }
    expect(await ending).toMatchObject({ id: 'm1' })
  })
})

describe('recordingStore com o motor Claude CLI (contrato 05: CA3, CA6, CA9, CA11, CA14)', () => {
  const invoke = vi.fn()
  const translateCalls: unknown[] = []
  let claudeStart: { ok: boolean; version?: string; error?: string } = { ok: true, version: '2.1.312' }

  const finalTurn = (turnOrder: number, transcript: string): string =>
    JSON.stringify({ type: 'Turn', turn_order: turnOrder, end_of_turn: true, transcript, words: [{ text: transcript, start: 0, end: 500 }] })

  beforeEach(() => {
    sockets.length = 0
    blocks.clear()
    translateCalls.length = 0
    claudeStart = { ok: true, version: '2.1.312' }
    invoke.mockReset()
    invoke.mockImplementation((channel: string, request?: { text?: string }) => {
      if (channel === 'scribe:transcription-token') return Promise.resolve({ ok: true, token: 'tok-teste', expiresInSeconds: 60 })
      if (channel === 'scribe:meetings-create') return Promise.resolve({ id: 'm1', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: true, system: true } })
      if (channel === 'scribe:claude-start') return Promise.resolve(claudeStart)
      if (channel === 'scribe:claude-translate') {
        translateCalls.push(request)
        return Promise.resolve({ ok: true, translation: `EN: ${request?.text ?? ''}`, model: 'claude-cli:haiku' })
      }
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke, on: () => () => undefined } })
    vi.stubGlobal(
      'WebSocket',
      function FakeWebSocket(url: string) {
        const socket = new FakeSocket(url)
        sockets.push(socket)
        return socket
      } as unknown as typeof WebSocket,
    )
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, translationEngine: 'claude-cli', claudeModel: 'haiku', identifySpeakers: true } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } })
    vi.unstubAllGlobals()
  })

  const channels = (): string[] => invoke.mock.calls.map((call) => call[0] as string)

  async function startAndOpen(): Promise<{ mic: FakeSocket; system: FakeSocket }> {
    expect(useRecording.getState().start()).toBe(true)
    await tick()
    await tick()
    const mic = sockets.find((socket) => !new URL(socket.url).searchParams.has('speaker_labels')) as FakeSocket
    const system = sockets.find((socket) => new URL(socket.url).searchParams.has('speaker_labels')) as FakeSocket
    for (const socket of [mic, system]) {
      socket.readyState = 1
      socket.onopen?.()
    }
    return { mic, system }
  }

  it('abre o claude ao começar, a conexão vai sem llm_gateway, cada trecho final vai ao main e a reunião grava claude-cli:haiku', async () => {
    const { mic, system } = await startAndOpen()
    expect(channels()).toContain('scribe:claude-start')
    for (const socket of sockets) expect(new URL(socket.url).searchParams.get('llm_gateway')).toBeNull()
    // Diarização do áudio do sistema continua.
    expect(new URL(system.url).searchParams.get('speaker_labels')).toBe('true')

    mic.onmessage?.({ data: finalTurn(0, 'Bom dia.') })
    system.onmessage?.({ data: finalTurn(0, 'Alguma dúvida até aqui?') })
    // Na hora, sem esperar os 5 s da tradução de reserva.
    expect(translateCalls).toEqual([
      expect.objectContaining({ source: 'mic', turnOrder: 0, text: 'Bom dia.' }),
      expect.objectContaining({ source: 'system', turnOrder: 0, text: 'Alguma dúvida até aqui?' }),
    ])
    await tick()
    const segments = useTranscription.getState().segments
    expect(segments.map((segment) => [segment.source, segment.translation, segment.translationModel])).toEqual([
      ['mic', 'EN: Bom dia.', 'claude-cli:haiku'],
      ['system', 'EN: Alguma dúvida até aqui?', 'claude-cli:haiku'],
    ])

    // Pausar mantém o processo.
    useRecording.getState().togglePause()
    await tick()
    expect(channels()).not.toContain('scribe:claude-stop')

    const ending = useRecording.getState().end()
    await tick()
    for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify({ type: 'Termination' }) })
    expect(await ending).toMatchObject({ id: 'm1' })
    expect(channels()).toContain('scribe:claude-stop')
    const save = invoke.mock.calls.find((call) => call[0] === 'scribe:transcript-save')?.[1] as { document: { translationModel: string; segments: { translationModel: string | null }[] } }
    expect(save.document.translationModel).toBe('claude-cli:haiku')
    expect(save.document.segments.map((segment) => segment.translationModel)).toEqual(['claude-cli:haiku', 'claude-cli:haiku'])
  })

  it('claude não encontrado: aviso na coluna, a transcrição segue e nenhum trecho é pedido ao claude', async () => {
    claudeStart = { ok: false, error: 'not-found' }
    const { mic } = await startAndOpen()
    await tick()
    expect(useTranscription.getState().claude).toBe('not-found')
    mic.onmessage?.({ data: finalTurn(0, 'Bom dia.') })
    await tick()
    expect(translateCalls).toEqual([])
    expect(useTranscription.getState().segments).toMatchObject([{ text: 'Bom dia.', translation: null, translationState: 'pending' }])
    const ending = useRecording.getState().end()
    await tick()
    for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify({ type: 'Termination' }) })
    await ending
  })
})

