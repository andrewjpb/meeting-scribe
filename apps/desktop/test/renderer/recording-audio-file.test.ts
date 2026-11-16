// recordingStore com "Salvar áudio e transcrição numa pasta" (contrato 07): começa o arquivo junto da
// gravação, mistura as fontes que abriram, pausa junto, e ao encerrar para o gravador antes da captura e
// pede ao main o arquivo final depois de salvar a transcrição interna. Desligado, nada vai ao main.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import type { AudioSource } from '../../src/renderer/src/audio/frames'
import type { RecorderLike } from '../../src/renderer/src/audio/recorder'

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

/** Linha do tempo das chamadas: gravador, mistura e IPC, para conferir a ordem. */
const events: string[] = []

class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive'
  ondataavailable: RecorderLike['ondataavailable'] = null
  onstop: RecorderLike['onstop'] = null
  onerror: RecorderLike['onerror'] = null
  start(): void {
    this.state = 'recording'
    events.push('recorder:start')
  }
  pause(): void {
    this.state = 'paused'
    events.push('recorder:pause')
  }
  resume(): void {
    this.state = 'recording'
    events.push('recorder:resume')
  }
  stop(): void {
    this.state = 'inactive'
    events.push('recorder:stop')
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['ultimo']) })
      this.onstop?.()
    }, 0)
  }
}

let recorder: FakeRecorder | null = null
const mixed: AudioSource[] = []
let mime: string | null = 'audio/mp4;codecs=mp4a.40.2'
const env: CaptureEnvironment = {
  mode: 'synthetic',
  media,
  createPipeline: () => Promise.resolve({ close: () => Promise.resolve() }),
  recorderMime: () => mime,
  createRecorder: () => {
    recorder = new FakeRecorder()
    return {
      recorder,
      addStream: (source) => void mixed.push(source),
      close: () => {
        events.push('mixer:close')
        return Promise.resolve()
      },
    }
  },
  exposeProbe: () => undefined,
}

vi.mock('../../src/renderer/src/audio/environment', () => ({
  captureEnvironment: () => env,
  loadCaptureEnvironment: () => Promise.resolve(),
}))

const { useRecording } = await import('../../src/renderer/src/features/live/recordingStore')
const { useSettings } = await import('../../src/renderer/src/app/settingsStore')
const { useTranscription } = await import('../../src/renderer/src/transcription/store')
const { DEFAULT_SETTINGS } = await import('../../src/shared/settings-defaults')

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const MEETING = { id: 'm1', title: 'Reunião', startedAt: '2026-11-15T10:00:00.000Z', durationMs: 0, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null }
const SEGMENT = {
  id: 'mic-0',
  source: 'mic' as const,
  speaker: null,
  startMs: 0,
  endMs: 1000,
  text: 'Bom dia.',
  translation: null,
  translationModel: null,
  partial: false,
  turnOrder: 0,
  sessionId: 's',
  translationState: 'done' as const,
}

describe('recordingStore e o arquivo da reunião (contrato 07)', () => {
  const invoke = vi.fn()
  let begin: unknown = { ok: true, id: 'sessao-1' }
  let finish: unknown = { ok: true, audioPath: '/p/a.m4a', transcriptPath: '/p/a.md' }

  beforeEach(() => {
    events.length = 0
    mixed.length = 0
    recorder = null
    mime = 'audio/mp4;codecs=mp4a.40.2'
    begin = { ok: true, id: 'sessao-1' }
    finish = { ok: true, audioPath: '/p/a.m4a', transcriptPath: '/p/a.md' }
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => {
      events.push(channel)
      if (channel === 'scribe:key-status') return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
      if (channel === 'scribe:audio-begin') return Promise.resolve(begin)
      if (channel === 'scribe:audio-finish') return Promise.resolve(finish)
      if (channel === 'scribe:meetings-create') return Promise.resolve(MEETING)
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null, audio: 'off', filesFailedMeetingId: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const calls = (channel: string): unknown[] => invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call[1])

  it('ligado (padrão): começa o .part, mistura as duas fontes, pausa junto e encerra na ordem certa', async () => {
    expect(DEFAULT_SETTINGS.saveToFolder).toBe(true)
    expect(useRecording.getState().start()).toBe(true)
    const { startedAt, title } = useRecording.getState()
    expect(calls('scribe:audio-begin')).toEqual([{ startedAt, title, extension: 'm4a' }])
    expect(useRecording.getState().audio).toBe('recording')
    await tick()
    expect(mixed.sort()).toEqual(['mic', 'system'])

    useRecording.getState().togglePause()
    useRecording.getState().togglePause()
    expect(events.filter((event) => event.startsWith('recorder:'))).toEqual(['recorder:start', 'recorder:pause', 'recorder:resume'])

    useTranscription.getState().replay([SEGMENT])
    expect(await useRecording.getState().end()).toMatchObject({ id: 'm1' })
    // O último pedaço vai antes de qualquer coisa; o arquivo final só depois da transcrição interna salva.
    const order = events.filter((event) => !['scribe:key-status', 'scribe:audio-begin', 'recorder:start', 'recorder:pause', 'recorder:resume'].includes(event))
    // O resumo (contrato 08, CA4) é pedido por último, depois dos arquivos, e só com algum trecho.
    expect(order).toEqual(['recorder:stop', 'scribe:audio-append', 'mixer:close', 'scribe:meetings-create', 'scribe:transcript-save', 'scribe:audio-finish', 'scribe:summary-generate'])
    expect(calls('scribe:summary-generate')).toEqual([{ meetingId: 'm1', auto: true }])
    expect(calls('scribe:audio-append')).toEqual([{ id: 'sessao-1', data: new TextEncoder().encode('ultimo') }])
    expect(calls('scribe:audio-finish')).toEqual([{ id: 'sessao-1', meetingId: 'm1' }])
    expect(useRecording.getState()).toMatchObject({ audio: 'off', filesFailedMeetingId: null })
  })

  it('desligado: nenhum gravador, nenhum pedido ao main (invariante)', async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, saveToFolder: false } })
    useRecording.getState().start()
    expect(useRecording.getState().audio).toBe('off')
    await tick()
    await useRecording.getState().end()
    expect(recorder).toBeNull()
    expect(invoke.mock.calls.map((call) => call[0] as string).filter((channel) => channel.startsWith('scribe:audio'))).toEqual([])
    // Sem nenhum trecho, o resumo nem é pedido (contrato 08, CA4).
    expect(calls('scribe:summary-generate')).toEqual([])
  })

  it('pasta que não dá para escrever: aviso na gravação, ela segue, e o detalhe mostra o mesmo aviso', async () => {
    begin = { ok: false, error: 'unwritable' }
    useRecording.getState().start()
    await tick()
    expect(useRecording.getState().audio).toBe('failed')
    expect(recorder?.state).toBe('inactive')
    expect(useRecording.getState().capture).toMatchObject({ mic: 'live', system: 'live' })
    expect(await useRecording.getState().end()).toMatchObject({ id: 'm1' })
    expect(calls('scribe:audio-append')).toEqual([])
    expect(calls('scribe:audio-finish')).toEqual([])
    expect(useRecording.getState().filesFailedMeetingId).toBe('m1')
  })

  it('opção desligada entre a tela e o main: nada gravado e sem aviso', async () => {
    begin = { ok: false, error: 'disabled' }
    useRecording.getState().start()
    await tick()
    await tick()
    expect(useRecording.getState().audio).toBe('off')
    await useRecording.getState().end()
    expect(calls('scribe:audio-append')).toEqual([])
    expect(useRecording.getState().filesFailedMeetingId).toBeNull()
  })

  it('o main não escreveu o arquivo final: a reunião é salva e o detalhe mostra o aviso', async () => {
    finish = { ok: false, audioPath: null, transcriptPath: null }
    useRecording.getState().start()
    await tick()
    expect(await useRecording.getState().end()).toMatchObject({ id: 'm1' })
    expect(useRecording.getState().filesFailedMeetingId).toBe('m1')
  })

  it('sem formato aceito pelo gravador: aviso, e a transcrição ainda vai para a pasta', async () => {
    mime = null
    useRecording.getState().start()
    expect(calls('scribe:audio-begin')).toEqual([expect.objectContaining({ extension: null })])
    expect(useRecording.getState().audio).toBe('failed')
    await tick()
    useTranscription.getState().replay([SEGMENT])
    await useRecording.getState().end()
    expect(calls('scribe:audio-finish')).toEqual([{ id: 'sessao-1', meetingId: 'm1' }])
  })
})
