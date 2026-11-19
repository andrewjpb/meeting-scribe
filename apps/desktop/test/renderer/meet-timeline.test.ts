// Quem fala no Meet no renderer (contrato 27, CA3 e CA8): cada evento vale pelo horário em que chega, no relógio
// da gravação; em pausa ou sem gravação não entra; ao encerrar, os trechos do sistema ganham os nomes por
// sobreposição (1 s ou metade do trecho) e os do microfone continuam "Você".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import type { MeetState } from '../../src/shared/meet'
import type { RuntimeSegment, TranscriptDocument, TranscriptSegment } from '../../src/shared/transcription'

/** Contrato 48: o id, a plataforma e o título da reunião não mudam nada aqui. */
const NO_MEETING: Pick<MeetState, 'meeting' | 'plataforma' | 'titulo'> = { meeting: null, plataforma: null, titulo: null }

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
const { liveNamer, meetRecordingEnded, meetRecordingStarted, namesFor, segmentNames, SpeakerTimeline, useMeet, withSpeakerNames } = await import('../../src/renderer/src/features/live/meetStore')
const { segmentLabel } = await import('../../src/shared/transcription')

/** Relógio controlado: `elapsedMs` e `running` como o `RecordingClock`. */
function fakeClock(): { elapsedMs: number; running: boolean } {
  return { elapsedMs: 0, running: true }
}

const segment = (id: string, source: 'mic' | 'system', startMs: number, endMs: number): TranscriptSegment => ({ id, source, speaker: null, startMs, endMs, text: `Fala ${id}`, translation: null, translationModel: null })

describe('linha do tempo de falas', () => {
  it('carimba na chegada com o relógio da gravação, ignora o ts e o que chega em pausa', () => {
    const clock = fakeClock()
    let wall = 1_763_000_000_000
    const timeline = new SpeakerTimeline(clock, () => wall)
    clock.elapsedMs = 2000
    // O `ts` (epoch da extensão) não entra no carimbo: os eventos do mesmo envio valem o horário da chegada.
    timeline.receive([{ name: 'Ana', speaking: true, ts: wall }])
    clock.elapsedMs = 5000
    wall += 3000
    timeline.receive([{ name: 'Ana', speaking: false, ts: wall - 100 }, { name: 'Bruno', speaking: true, ts: wall }])
    // Pausa: a fala aberta fecha no instante da pausa; o que chega pausado não entra.
    clock.elapsedMs = 6000
    timeline.pause()
    clock.running = false
    wall += 1000
    timeline.receive([{ name: 'Carla', speaking: true, ts: wall }])
    clock.running = true
    clock.elapsedMs = 8000
    wall += 5000
    timeline.receive([{ name: 'Carla', speaking: false, ts: wall }, { name: 'Ana', speaking: true, ts: wall }])
    clock.elapsedMs = 9500
    expect(timeline.end()).toEqual([
      { name: 'Ana', fromMs: 2000, toMs: 5000 },
      { name: 'Bruno', fromMs: 5000, toMs: 6000 },
      { name: 'Ana', fromMs: 8000, toMs: 9500 },
    ])
  })

  it('"começou" repetido é idempotente; depois da pausa, o repetido da extensão reabre a fala de quem continuou falando', () => {
    const clock = fakeClock()
    let wall = 1_763_000_000_000
    const timeline = new SpeakerTimeline(clock, () => wall)
    const heartbeat = (): void => timeline.receive([{ name: 'Ana', speaking: true, ts: wall }])
    clock.elapsedMs = 1000
    heartbeat()
    // Repetido a cada segundo: o início continua o primeiro.
    clock.elapsedMs = 2000
    wall += 1000
    heartbeat()
    clock.elapsedMs = 3000
    wall += 1000
    heartbeat()
    // Pausa em 3 s; Ana segue falando durante a pausa (o repetido chega e não entra).
    timeline.pause()
    clock.running = false
    wall += 1000
    heartbeat()
    // Retomada: o próximo repetido reabre a fala sem esperar uma nova transição.
    clock.running = true
    wall += 1000
    clock.elapsedMs = 3500
    heartbeat()
    clock.elapsedMs = 6000
    expect(timeline.end()).toEqual([
      { name: 'Ana', fromMs: 1000, toMs: 3000 },
      { name: 'Ana', fromMs: 3500, toMs: 6000 },
    ])
  })

  it('evento com ts mais de 3 s atrás na chegada (guardado pela extensão) é descartado', () => {
    const clock = fakeClock()
    const wall = 1_763_000_060_000
    const timeline = new SpeakerTimeline(clock, () => wall)
    clock.elapsedMs = 10_000
    timeline.receive([
      { name: 'Velho', speaking: true, ts: wall - 30_000 },
      { name: 'Velho', speaking: false, ts: wall - 29_000 },
      { name: 'Limite', speaking: true, ts: wall - 3_000 },
      { name: 'Novo', speaking: true, ts: wall - 500 },
    ])
    clock.elapsedMs = 12_000
    expect(timeline.end()).toEqual([
      { name: 'Limite', fromMs: 10_000, toMs: 12_000 },
      { name: 'Novo', fromMs: 10_000, toMs: 12_000 },
    ])
  })

  it('sem gravação rodando (antes de a captura começar), nada entra', () => {
    const clock = { elapsedMs: 0, running: false }
    const timeline = new SpeakerTimeline(clock)
    timeline.receive([{ name: 'Ana', speaking: true, ts: Date.now() }])
    clock.elapsedMs = 3000
    expect(timeline.end()).toEqual([])
  })
})

describe('nomes por sobreposição', () => {
  it('um nome; dois nomes em ordem de maior sobreposição; menos de 1 s e menos da metade fica de fora', () => {
    const intervals = [
      { name: 'Ana', fromMs: 0, toMs: 4000 },
      { name: 'Bruno', fromMs: 2500, toMs: 10_000 },
      { name: 'Carla', fromMs: 3500, toMs: 4200 },
    ]
    // [0, 2000]: só Ana.
    expect(namesFor(0, 2000, intervals)).toEqual(['Ana'])
    // [2000, 6000]: Bruno 3,5 s, Ana 2 s; Carla 0,7 s (< 1 s e < 50% de 4 s) fica de fora.
    expect(namesFor(2000, 6000, intervals)).toEqual(['Bruno', 'Ana'])
    // [3800, 4300]: trecho curto; Carla 0,4 s é 80% dele, Ana 0,2 s (40%), Bruno 0,5 s (100%).
    expect(namesFor(3800, 4300, intervals)).toEqual(['Bruno', 'Carla'])
    // Fora de todos os intervalos.
    expect(namesFor(20_000, 25_000, intervals)).toEqual([])
    // O mesmo nome em dois intervalos que se cruzam não conta duas vezes.
    expect(namesFor(0, 4000, [{ name: 'Ana', fromMs: 0, toMs: 1500 }, { name: 'Ana', fromMs: 1000, toMs: 1600 }, { name: 'Bruno', fromMs: 0, toMs: 1700 }])).toEqual(['Bruno', 'Ana'])
  })

  it('só os trechos do sistema ganham nomes; o microfone continua sem', () => {
    const intervals = [{ name: 'Ana', fromMs: 0, toMs: 5000 }]
    const result = withSpeakerNames([segment('m', 'mic', 0, 3000), segment('s', 'system', 0, 3000), segment('t', 'system', 9000, 12_000)], intervals)
    expect(result.map((item) => item.names)).toEqual([undefined, ['Ana'], undefined])
    expect(withSpeakerNames([segment('s', 'system', 0, 3000)], [])).toEqual([segment('s', 'system', 0, 3000)])
  })
})

describe('nome ao vivo na coluna (adendo 27b)', () => {
  /** O rótulo que a coluna mostra para um trecho, com a linha do tempo parcial. */
  const liveLabel = (item: TranscriptSegment, timeline: InstanceType<typeof SpeakerTimeline>): string => {
    const names = segmentNames(item, timeline.snapshot())
    return segmentLabel({ ...item, ...(names.length ? { names } : {}) })
  }

  it('um nome, dois nomes, sem sobreposição e fala ainda aberta', () => {
    const clock = fakeClock()
    const timeline = new SpeakerTimeline(clock, () => 0)
    clock.elapsedMs = 0
    timeline.receive([{ name: 'Ana', speaking: true, ts: 0 }])
    clock.elapsedMs = 4000
    timeline.receive([{ name: 'Ana', speaking: false, ts: 0 }])
    clock.elapsedMs = 2500
    timeline.receive([{ name: 'Bruno', speaking: true, ts: 0 }])
    // Bruno continua falando: o intervalo dele está aberto e vale até o fim de qualquer trecho.
    expect(liveLabel(segment('a', 'system', 0, 2000), timeline)).toBe('Ana')
    expect(liveLabel(segment('b', 'system', 2000, 6000), timeline)).toBe('Bruno + Ana')
    expect(liveLabel(segment('c', 'system', 8000, 12_000), timeline)).toBe('Bruno')
    // Microfone continua "Você"; trecho antes de qualquer fala fica com o rótulo de sempre.
    expect(liveLabel(segment('m', 'mic', 0, 2000), timeline)).toBe('Você')
    const empty = new SpeakerTimeline(fakeClock(), () => 0)
    expect(liveLabel(segment('s', 'system', 0, 2000), empty)).toBe(segmentLabel(segment('s', 'system', 0, 2000)))
  })

  it('o rótulo é reavaliado quando o "parou de falar" fecha o intervalo', () => {
    const clock = fakeClock()
    const timeline = new SpeakerTimeline(clock, () => 0)
    timeline.receive([{ name: 'Ana', speaking: true, ts: 0 }])
    const late = segment('t', 'system', 5000, 8000)
    expect(liveLabel(late, timeline)).toBe('Ana')
    clock.elapsedMs = 3000
    timeline.receive([{ name: 'Ana', speaking: false, ts: 0 }])
    expect(liveLabel(late, timeline)).toBe(segmentLabel(late))
    expect(liveLabel(segment('u', 'system', 0, 3000), timeline)).toBe('Ana')
  })
})

describe('coluna ao vivo memorizada (adendo 27b)', () => {
  it('o caminho memorizado dá o mesmo resultado que o direto, com e sem cache', () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const names = ['Ana', 'Bruno', 'Carla', 'Davi', 'Eva']
    const intervals = Array.from({ length: 400 }, () => {
      const fromMs = Math.floor(random() * 600_000)
      return { name: names[Math.floor(random() * names.length)] as string, fromMs, toMs: random() < 0.02 ? Number.POSITIVE_INFINITY : fromMs + Math.floor(random() * 20_000) }
    })
    const segments = Array.from({ length: 300 }, (_, i) => {
      const startMs = Math.floor(random() * 600_000)
      return segment(`s${i}`, random() < 0.2 ? 'mic' : 'system', startMs, startMs + Math.floor(random() * 15_000))
    })
    const nameOf = liveNamer(intervals)
    for (const item of segments) {
      const direct = segmentNames(item, intervals)
      expect([...nameOf(item)]).toEqual(direct)
      // Segunda leitura vem do cache e continua igual.
      expect([...nameOf(item)]).toEqual(direct)
      // Mesmo `id` com fim novo (parcial crescendo) recalcula.
      const grown = { ...item, endMs: item.endMs + 5000 }
      expect([...nameOf(grown)]).toEqual(segmentNames(grown, intervals))
    }
    expect(withSpeakerNames(segments, intervals).map((item) => item.names ?? [])).toEqual(segments.map((item) => segmentNames(item, intervals)))
    expect(liveNamer([])(segments[0] as TranscriptSegment)).toEqual([])
  })
})

describe('extensão desconectada (adendo 27b)', () => {
  it('connected:false fecha a fala aberta no instante da queda: os trechos seguintes não herdam o nome', () => {
    const clock = fakeClock()
    vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      meetRecordingStarted(clock)
      clock.elapsedMs = 1000
      useMeet.getState().receive({ connected: true, participants: ['Ana'], events: [{ name: 'Ana', speaking: true, ts: 0 }], ...NO_MEETING })
      expect(useMeet.getState().liveIntervals).toEqual([{ name: 'Ana', fromMs: 1000, toMs: Number.POSITIVE_INFINITY }])
      clock.elapsedMs = 4000
      // Queda (ou status expirado): o servidor manda `connected: false` sem evento nenhum.
      useMeet.getState().receive({ connected: false, participants: [], events: [], ...NO_MEETING })
      expect(useMeet.getState().liveIntervals).toEqual([{ name: 'Ana', fromMs: 1000, toMs: 4000 }])
      clock.elapsedMs = 20_000
      expect(segmentNames(segment('depois', 'system', 10_000, 15_000), useMeet.getState().liveIntervals)).toEqual([])
      expect(meetRecordingEnded()).toEqual([{ name: 'Ana', fromMs: 1000, toMs: 4000 }])
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('gravação com o Meet conectado', () => {
  const invoke = vi.fn()
  let now = 0

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:key-status') return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
      if (channel === 'scribe:meetings-create') return Promise.resolve({ id: 'm-meet', title: 't', startedAt: '2026-11-18T12:00:00.000Z', durationMs: 0, sources: { mic: true, system: true } })
      return Promise.resolve(true)
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const meet = (events: MeetState['events']): void => useMeet.getState().receive({ connected: true, participants: ['Ana', 'Bruno'], events, ...NO_MEETING })
  const runtime = (item: TranscriptSegment): RuntimeSegment => ({ ...item, partial: false, turnOrder: 0, sessionId: 's', translationState: 'done' })

  it('ao encerrar, a transcrição salva leva os nomes nos trechos do sistema; o que chegou em pausa não conta', async () => {
    expect(useRecording.getState().start()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useMeet.getState()).toMatchObject({ connected: false })

    now = 1000
    meet([{ name: 'Ana', speaking: true, ts: Date.now() }])
    expect(useMeet.getState()).toMatchObject({ connected: true, participants: ['Ana', 'Bruno'] })
    now = 4000
    meet([{ name: 'Ana', speaking: false, ts: Date.now() }])
    // Pausa entre 4 s e 14 s (o relógio da gravação fica em 4 s): Bruno fala só na pausa.
    useRecording.getState().togglePause()
    now = 6000
    meet([{ name: 'Bruno', speaking: true, ts: Date.now() }])
    now = 9000
    meet([{ name: 'Bruno', speaking: false, ts: Date.now() }])
    now = 14_000
    useRecording.getState().togglePause()
    // Retomada: 15 s no relógio de parede = 5 s gravados.
    now = 15_000
    meet([{ name: 'Bruno', speaking: true, ts: Date.now() }])
    now = 18_000

    useTranscription.getState().replay([runtime(segment('m', 'mic', 1000, 3000)), runtime(segment('a', 'system', 1000, 3800)), runtime(segment('b', 'system', 4500, 8000)), runtime(segment('c', 'system', 3000, 4500))])
    const meeting = await useRecording.getState().end()
    expect(meeting?.id).toBe('m-meet')
    const saved = invoke.mock.calls.find(([channel]) => channel === 'scribe:transcript-save')?.[1] as { document: TranscriptDocument } | undefined
    const byId = Object.fromEntries((saved?.document.segments ?? []).map((item) => [item.id, item.names]))
    // Ana de 1 s a 4 s; Bruno de 5 s até o fim (8 s gravados).
    expect(byId).toEqual({ m: undefined, a: ['Ana'], b: ['Bruno'], c: ['Ana'] })
  })
})
