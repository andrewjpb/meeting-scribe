// "Analisar até agora" na gravação (contrato 19, CA3 e CA5): o pedido leva só os trechos finais sem eco, as
// anotações e as análises anteriores; um clique por vez; a captura segue; "Virar anotação" cria o card; ao
// encerrar, as análises vão para a reunião criada e a que terminar depois entra direto nela.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import type { AnalysisRunResult, MeetingAnalysis } from '../../src/shared/meeting-analysis'
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

const analysis = (id: string, atMs: number): MeetingAnalysis => ({
  id,
  meetingId: null,
  createdAt: new Date(Date.parse('2026-11-16T15:00:00.000Z') + atMs).toISOString(),
  atMs,
  model: 'claude-cli:haiku',
  costUsd: 0.004,
  durationMs: 1500,
  openQuestions: [{ text: 'Quem aprova?', atMs: 1000 }],
  unclearTopics: [],
  toConfirm: [],
  suggestedQuestions: ['Quem aprova o orçamento?'],
  answered: [],
})

const MEETING = { id: 'm-analise', title: 't', startedAt: '2026-11-16T15:00:00.000Z', durationMs: 0, sources: { mic: true, system: true } }

describe('"Analisar até agora" na gravação', () => {
  const invoke = vi.fn()
  const pending: ((result: AnalysisRunResult) => void)[] = []

  beforeEach(() => {
    invoke.mockReset()
    pending.length = 0
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:analysis-run') return new Promise<AnalysisRunResult>((resolve) => pending.push(resolve))
      if (channel === 'scribe:key-status') return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
      if (channel === 'scribe:meetings-create') return Promise.resolve(MEETING)
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  const runs = (): { live: { recordingId: string; atMs: number; segments: { text: string }[]; notes: unknown[]; previous: MeetingAnalysis[] } }[] =>
    invoke.mock.calls.filter(([channel]) => channel === 'scribe:analysis-run').map(([, request]) => request as never)

  it('pede só com trecho final, um clique por vez, sem parar a captura; ao encerrar salva na reunião e a atrasada entra depois', async () => {
    expect(useRecording.getState().start()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Sem trecho final: abre a aba, mas não pede nada.
    useTranscription.getState().replay([segment('parcial', { partial: true })])
    useRecording.getState().analyze()
    expect(runs()).toHaveLength(0)
    expect(useRecording.getState()).toMatchObject({ notesOpen: true, panelTab: 'analise', analyzing: false })

    // Direto no estado: o eco marcado (contrato 06) não vai para a análise.
    useTranscription.setState({ segments: [segment('a'), segment('eco', { echo: true, text: 'repetida' }), segment('parcial', { partial: true }), segment('b', { source: 'system', speaker: 'A', startMs: 4000 })] })
    useRecording.getState().addNote()
    const noteId = useRecording.getState().notes[0]?.id ?? ''
    useRecording.getState().editNote(noteId, { text: 'Lembrar do prazo' })
    useRecording.getState().analyze()
    useRecording.getState().analyze()
    expect(runs()).toHaveLength(1)
    const first = runs()[0]
    expect(first?.live.segments.map((item) => item.text)).toEqual(['Fala a?', 'Fala b?'])
    expect(first?.live.notes).toEqual([expect.objectContaining({ text: 'Lembrar do prazo' })])
    expect(first?.live.previous).toEqual([])
    // "Até" é o fim do último trecho lido.
    expect(first?.live.atMs).toBe(4000)
    expect(useRecording.getState()).toMatchObject({ analyzing: true, panelTab: 'analise' })
    // A captura não pausa nem espera a análise.
    expect(useRecording.getState().capture?.phase).toBe('recording')

    pending[0]?.({ ok: true, analysis: analysis('x1', first?.live.atMs ?? 0) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState()).toMatchObject({ analyzing: false, analysisError: null })
    expect(useRecording.getState().analyses.map((item) => item.id)).toEqual(['x1'])

    // "Virar anotação": card amarelo com o texto e o tempo do item.
    useRecording.getState().noteFromAnalysis('Quem aprova?', 1000)
    expect(useRecording.getState().notes[0]).toMatchObject({ text: 'Quem aprova?', atMs: 1000, color: 'yellow' })

    // Falha: o motivo fica até a próxima tentativa.
    useRecording.getState().analyze()
    pending[1]?.({ ok: false, error: 'timeout' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState()).toMatchObject({ analyzing: false, analysisError: 'timeout' })

    // A terceira leva a primeira como anterior e ainda gera quando "Encerrar" é clicado.
    useRecording.getState().analyze()
    expect(runs()[2]?.live.previous.map((item) => item.id)).toEqual(['x1'])
    const meeting = await useRecording.getState().end()
    expect(meeting).toEqual(MEETING)
    const save = invoke.mock.calls.find(([channel]) => channel === 'scribe:analyses-save')
    expect(save?.[1]).toMatchObject({ meetingId: 'm-analise', analyses: [{ id: 'x1' }] })
    expect(useRecording.getState()).toMatchObject({ session: null, analyses: [], analyzing: false })

    pending[2]?.({ ok: true, analysis: analysis('x2', 9000) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledWith('scribe:analyses-add', { meetingId: 'm-analise', analysis: expect.objectContaining({ id: 'x2', meetingId: 'm-analise' }) })
  })

  it('gravação A e gravação B: a análise de A chega depois e entra só na reunião de A; B recebe só a dela; add falhou duas vezes vira aviso', async () => {
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    useTranscription.setState({ segments: [segment('a')] })
    useRecording.getState().analyze()
    const idA = runs()[0]?.live.recordingId
    expect(await useRecording.getState().end()).toEqual(MEETING)

    // B começa e analisa antes de a análise de A voltar.
    let addFails = 2
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:analysis-run') return new Promise<AnalysisRunResult>((resolve) => pending.push(resolve))
      if (channel === 'scribe:key-status') return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
      if (channel === 'scribe:analyses-add') return Promise.resolve(addFails-- <= 0)
      return Promise.resolve(true)
    })
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    useTranscription.setState({ segments: [segment('b')] })
    useRecording.getState().analyze()
    const idB = runs()[1]?.live.recordingId
    expect(idB).not.toBe(idA)

    pending[0]?.({ ok: true, analysis: analysis('de-A', 1000) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState().analyses).toEqual([])
    expect(useRecording.getState().analyzing).toBe(true)
    // Duas tentativas falharam: o detalhe de A mostra o aviso; "Tentar de novo" salva.
    expect(invoke.mock.calls.filter(([channel]) => channel === 'scribe:analyses-add')).toHaveLength(2)
    expect(useRecording.getState().unsavedAnalyses).toEqual([{ meetingId: 'm-analise', analysis: expect.objectContaining({ id: 'de-A' }) }])
    await useRecording.getState().retryUnsavedAnalyses('m-analise')
    expect(useRecording.getState().unsavedAnalyses).toEqual([])
    expect(invoke).toHaveBeenLastCalledWith('scribe:analyses-add', { meetingId: 'm-analise', analysis: expect.objectContaining({ id: 'de-A', meetingId: 'm-analise' }) })

    pending[1]?.({ ok: true, analysis: analysis('de-B', 1000) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState().analyses.map((item) => item.id)).toEqual(['de-B'])
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'scribe:meetings-create' ? { ...MEETING, id: 'm-b' } : true))
    await useRecording.getState().end()
  })
})
