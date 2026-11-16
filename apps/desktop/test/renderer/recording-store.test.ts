import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'

const track = (): TrackLike => {
  let state = 'live'
  return {
    get readyState() {
      return state
    },
    stop: () => {
      state = 'ended'
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}
const stream = (): StreamLike => {
  const audio = [track()]
  return { getAudioTracks: () => audio, getVideoTracks: () => [], removeTrack: () => undefined }
}

const stopFails = { value: true }
const micRequests: unknown[] = []
const media: MediaApi = {
  getUserMedia: (constraints) => {
    micRequests.push(constraints)
    return Promise.resolve(stream())
  },
  getDisplayMedia: () => Promise.resolve(stream()),
  enumerateDevices: () => Promise.resolve([]),
  addEventListener: () => undefined,
  // Faz `CaptureSession.stop()` rejeitar no meio, depois de parar o cronômetro.
  removeEventListener: () => {
    if (stopFails.value) throw new Error('falhou ao soltar o devicechange')
  },
}
const env: CaptureEnvironment = {
  // Modo sintético: este teste é da captura (contrato 02), não da transcrição; nada conecta.
  mode: 'synthetic',
  media,
  createPipeline: () => Promise.resolve({ close: () => Promise.resolve() }),
  // O arquivo da reunião (contrato 07) tem teste próprio (recording-audio-file.test.ts).
  recorderMime: () => null,
  createRecorder: () => {
    throw new Error('sem gravador neste teste')
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

describe('recordingStore.end', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    stopFails.value = true
    invoke.mockReset()
    // O modo sintético pergunta o estado da chave ao começar.
    invoke.mockResolvedValue({ configured: true, last4: 'aaaa', source: 'saved' })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stop() rejeitado: saving volta a false, o aviso de falha aparece e "Tentar de novo" salva', async () => {
    expect(useRecording.getState().start()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState().capture).toMatchObject({ mic: 'live', system: 'live' })

    expect(await useRecording.getState().end()).toBeNull()
    expect(useRecording.getState()).toMatchObject({ saving: false, saveFailed: true })
    expect(invoke).not.toHaveBeenCalledWith('scribe:meetings-create', expect.anything())
    expect(useRecording.getState().session).not.toBeNull()

    const meeting = { id: 'm1', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: false, system: false } }
    invoke.mockResolvedValueOnce(meeting)
    expect(await useRecording.getState().end()).toEqual(meeting)
    expect(invoke).toHaveBeenCalledWith('scribe:meetings-create', expect.objectContaining({ durationMs: expect.any(Number) as number }))
    expect(useRecording.getState()).toMatchObject({ saving: false, saveFailed: false, session: null })
  })

  it('falha ao salvar: saving volta a false e o aviso aparece', async () => {
    stopFails.value = false
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    invoke.mockRejectedValueOnce(new Error('disco cheio'))
    expect(await useRecording.getState().end()).toBeNull()
    expect(useRecording.getState()).toMatchObject({ saving: false, saveFailed: true })
  })

  it('a gravação usa o cancelamento de eco e o microfone de Configurações (CA9)', async () => {
    stopFails.value = false
    micRequests.length = 0
    useSettings.setState({ settings: { ...useSettings.getState().settings, echoCancellation: true, micDeviceId: null } })
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(micRequests).toEqual([{ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }])
    invoke.mockResolvedValueOnce({ id: 'm2', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: false, system: false } })
    await useRecording.getState().end()
  })

  it('"Remover eco do alto-falante" trocado no meio da gravação vale na hora (contrato 06, CA7)', async () => {
    stopFails.value = false
    useSettings.setState({ settings: { ...useSettings.getState().settings, removeEcho: true } })
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useTranscription.getState().removeEcho).toBe(true)
    useSettings.setState({ settings: { ...useSettings.getState().settings, removeEcho: false } })
    expect(useTranscription.getState().removeEcho).toBe(false)
    useSettings.setState({ settings: { ...useSettings.getState().settings, removeEcho: true } })
    expect(useTranscription.getState().removeEcho).toBe(true)
    // Trocado enquanto "Encerrar" ainda salva: também chega.
    invoke.mockResolvedValueOnce({ id: 'm3', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: false, system: false } })
    const ending = useRecording.getState().end()
    expect(useRecording.getState().saving).toBe(true)
    useSettings.setState({ settings: { ...useSettings.getState().settings, removeEcho: false } })
    expect(useTranscription.getState().removeEcho).toBe(false)
    await ending
    // Sem gravação, a próxima lê a configuração ao começar.
    useSettings.setState({ settings: { ...useSettings.getState().settings, removeEcho: true } })
    useRecording.getState().start()
    expect(useTranscription.getState().removeEcho).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    invoke.mockResolvedValueOnce({ id: 'm4', title: 't', startedAt: '2026-11-14T10:00:00.000Z', durationMs: 0, sources: { mic: false, system: false } })
    await useRecording.getState().end()
  })
})
