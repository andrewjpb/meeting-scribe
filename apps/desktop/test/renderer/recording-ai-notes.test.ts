// IA anotando na gravação (contrato 30, CA2): o interruptor, o ciclo pulado, só os trechos novos, o lote aplicado
// (cards da IA criados e resolvidos), a falha silenciosa e o "Encerrar" que salva tudo. O ciclo é chamado direto (o
// relógio de 5 min é o mesmo `runAiNotesCycle`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import type { AiNotesRunResult } from '../../src/shared/ai-notes'
import type { RuntimeSegment } from '../../src/shared/transcription'

const track = (): TrackLike => ({ readyState: 'live', stop: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined })
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
const env: CaptureEnvironment = {
  mode: 'synthetic',
  media,
  createPipeline: () => Promise.resolve({ close: () => Promise.resolve() }),
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
const { useTranscription } = await import('../../src/renderer/src/transcription/store')

const segment = (id: string, patch: Partial<RuntimeSegment> = {}): RuntimeSegment => ({
  id,
  source: 'mic',
  speaker: null,
  startMs: 1000,
  endMs: patch.startMs ?? 2000,
  text: `Fala ${id}?`,
  translation: null,
  translationModel: null,
  partial: false,
  turnOrder: 0,
  sessionId: 's',
  translationState: 'done',
  ...patch,
})

const MEETING = { id: 'm-ia', title: 't', startedAt: '2026-11-18T15:00:00.000Z', durationMs: 0, sources: { mic: true, system: true } }
const LONG = 'Precisamos confirmar a janela de manutenção com o cliente antes de sexta, e o plano de volta tem que estar por escrito. '

describe('IA anotando na gravação (contrato 30, CA2)', () => {
  const invoke = vi.fn()
  const pending: ((result: AiNotesRunResult) => void)[] = []

  beforeEach(() => {
    invoke.mockReset()
    pending.length = 0
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:ai-notes-run') return new Promise<AiNotesRunResult>((resolve) => pending.push(resolve))
      if (channel === 'scribe:key-status') return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
      if (channel === 'scribe:meetings-create') return Promise.resolve(MEETING)
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  const runs = (): { recordingId: string; segments: { text: string }[]; openCards: { id: string }[]; knownTitles: string[] }[] =>
    invoke.mock.calls.filter(([channel]) => channel === 'scribe:ai-notes-run').map(([, request]) => request as never)
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('desligado não roda; pouca fala pula; só trechos novos; o lote vira cards da IA e resolve os dela; encerrar salva', async () => {
    expect(useRecording.getState().start()).toBe(true)
    await tick()
    // Padrão das Configurações (`liveCards`): desligado.
    expect(useRecording.getState().aiNotes).toBe(false)
    expect(await useRecording.getState().runAiNotesCycle()).toBe('off')

    useRecording.getState().toggleAiNotes()
    expect(useRecording.getState().aiNotes).toBe(true)
    useTranscription.setState({ segments: [segment('a', { text: 'Curto.' })] })
    expect(await useRecording.getState().runAiNotesCycle()).toBe('skipped')
    expect(runs()).toHaveLength(0)

    useTranscription.setState({ segments: [segment('a', { text: 'Curto.' }), segment('b', { text: LONG + LONG })] })
    const first = useRecording.getState().runAiNotesCycle()
    expect(useRecording.getState().aiNotesBusy).toBe(true)
    expect(await useRecording.getState().runAiNotesCycle()).toBe('busy')
    expect(runs()[0]?.segments.map((item) => item.text)).toEqual(['Curto.', LONG + LONG])
    pending[0]?.({ ok: true, model: 'claude-cli:haiku', costUsd: 0.002, durationMs: 900, batch: { created: [{ title: 'Janela', description: 'Confirmar com o cliente.' }], resolved: [] } })
    expect(await first).toBe('ran')
    const card = useRecording.getState().notes[0]
    expect(card).toMatchObject({ title: 'Janela', text: 'Confirmar com o cliente.', origin: 'ia', color: 'blue', status: 'aberta' })
    expect(useRecording.getState().aiNotesBusy).toBe(false)

    // Um card manual não vai como aberto da IA; só os trechos novos vão no próximo ciclo.
    useRecording.getState().addNote()
    useTranscription.setState({ segments: [...useTranscription.getState().segments, segment('c', { text: LONG + LONG, startMs: 5000 })] })
    const second = useRecording.getState().runAiNotesCycle()
    expect(runs()[1]?.segments.map((item) => item.text)).toEqual([LONG + LONG])
    expect(runs()[1]?.openCards.map((item) => item.id)).toEqual([card?.id])
    expect(runs()[1]?.knownTitles).toEqual(['Janela'])
    pending[1]?.({ ok: true, model: 'claude-cli:haiku', costUsd: 0.002, durationMs: 900, batch: { created: [], resolved: [{ id: card?.id ?? '', reason: 'Ficou para sábado.' }] } })
    expect(await second).toBe('ran')
    expect(useRecording.getState().notes.find((note) => note.id === card?.id)).toMatchObject({ status: 'resolvida', resolution: { reason: 'Ficou para sábado.', by: 'ia' } })

    // Falha: silenciosa, e os mesmos trechos voltam no próximo.
    useTranscription.setState({ segments: [...useTranscription.getState().segments, segment('d', { text: LONG + LONG, startMs: 9000 })] })
    const failed = useRecording.getState().runAiNotesCycle()
    pending[2]?.({ ok: false, error: 'timeout' })
    expect(await failed).toBe('failed')
    void useRecording.getState().runAiNotesCycle()
    expect(runs()[3]?.segments.map((item) => item.text)).toEqual([LONG + LONG])
    pending[3]?.({ ok: false, error: 'failed' })
    await tick()

    // Desligado no meio do ciclo: o main cancela e o lote que chegar não entra (sem consentimento).
    useTranscription.setState({ segments: [...useTranscription.getState().segments, segment('e', { text: LONG + LONG, startMs: 12000 })] })
    const before = useRecording.getState().notes.length
    const revoked = useRecording.getState().runAiNotesCycle()
    useRecording.getState().toggleAiNotes()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'scribe:ai-notes-cancel').map(([, request]) => request)).toEqual([{ recordingId: runs()[0]?.recordingId }])
    pending[4]?.({ ok: true, model: 'claude-cli:haiku', costUsd: 0.002, durationMs: 900, batch: { created: [{ title: 'Não devia entrar', description: 'x' }], resolved: [] } })
    expect(await revoked).toBe('failed')
    expect(useRecording.getState().notes).toHaveLength(before)
    useRecording.getState().toggleAiNotes()

    // "Concluir" e "Reabrir" pela pessoa.
    const manualId = useRecording.getState().notes[0]?.id ?? ''
    useRecording.getState().resolveNote(manualId, 'feito')
    expect(useRecording.getState().notes[0]).toMatchObject({ status: 'resolvida', resolution: { reason: 'feito', by: 'manual' } })
    useRecording.getState().reopenNote(manualId)
    expect(useRecording.getState().notes[0]?.status).toBe('aberta')

    void useRecording.getState().runAiNotesCycle()
    await useRecording.getState().end()
    // "Encerrar" com o interruptor ligado cancela o ciclo em curso no main.
    expect(invoke.mock.calls.filter(([channel]) => channel === 'scribe:ai-notes-cancel')).toHaveLength(2)
    const saved = invoke.mock.calls.find(([channel]) => channel === 'scribe:notes-save')?.[1] as { notes: { origin?: string; status?: string }[] } | undefined
    expect(saved?.notes.some((note) => note.origin === 'ia' && note.status === 'resolvida')).toBe(true)
    // Depois da reunião não há ciclo.
    expect(await useRecording.getState().runAiNotesCycle()).toBe('off')
  })
})
