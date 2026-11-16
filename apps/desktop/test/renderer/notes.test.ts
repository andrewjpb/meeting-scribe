// Contrato 13: operações na lista de anotações (CA3, CA5) e as anotações da gravação, que vão para a
// reunião ao encerrar sem perder a que está sendo digitada (CA4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingNote } from '@shared/meeting-notes'
import type { MediaApi, StreamLike, TrackLike } from '../../src/renderer/src/audio/capture'
import type { CaptureEnvironment } from '../../src/renderer/src/audio/environment'
import { addNote, closestSegmentId, createNote, editNote, removeNote, restoreNote } from '../../src/renderer/src/features/notes/noteList'

const NOW = Date.parse('2026-11-15T20:00:00.000Z')

describe('lista de anotações', () => {
  it('nova anotação: amarela, vazia, com o tempo da gravação ou null, em cima da lista', () => {
    const a = createNote(754_321.4, NOW, 'a')
    expect(a).toEqual({ id: 'a', text: '', color: 'yellow', atMs: 754_321, createdAt: '2026-11-15T20:00:00.000Z', updatedAt: '2026-11-15T20:00:00.000Z' })
    expect(createNote(null, NOW, 'b').atMs).toBeNull()
    expect(createNote(-5, NOW, 'c').atMs).toBe(0)
    expect(addNote([a], createNote(null, NOW, 'b')).map((note) => note.id)).toEqual(['b', 'a'])
    expect(createNote(0, NOW).id).not.toBe(createNote(0, NOW).id)
  })

  it('até 200: a 201ª não entra', () => {
    const full = Array.from({ length: 200 }, (_, i) => createNote(i, NOW, `n${i}`))
    expect(addNote(full, createNote(0, NOW, 'extra'))).toHaveLength(200)
  })

  it('editar texto e cor muda updatedAt; texto cortado em 2 000; nada mudou, mesma lista', () => {
    const list = [createNote(1_000, NOW, 'a'), createNote(2_000, NOW, 'b')]
    const edited = editNote(list, 'a', { text: 'Olá', color: 'pink' }, NOW + 1_000)
    expect(edited[0]).toMatchObject({ text: 'Olá', color: 'pink', updatedAt: '2026-11-15T20:00:01.000Z', createdAt: '2026-11-15T20:00:00.000Z' })
    expect(edited[1]).toBe(list[1])
    expect(editNote(edited, 'a', { text: 'Olá' }, NOW + 2_000)).toBe(edited)
    expect(editNote(edited, 'x', { text: 'nada' }, NOW)).toBe(edited)
    expect(editNote(list, 'a', { text: 'x'.repeat(2_500) }, NOW)[0]?.text).toHaveLength(2_000)
  })

  it('tempo do card: o trecho mais próximo da transcrição', () => {
    const segments = [
      { id: 's1', startMs: 0 },
      { id: 's2', startMs: 10_000 },
      { id: 's3', startMs: 30_000 },
    ]
    expect(closestSegmentId(segments, 12_000)).toBe('s2')
    expect(closestSegmentId(segments, 21_000)).toBe('s3')
    expect(closestSegmentId(segments, 999_000)).toBe('s3')
    expect(closestSegmentId([], 1_000)).toBeNull()
  })

  it('excluir e desfazer: volta para a mesma posição, sem duplicar', () => {
    const list = ['a', 'b', 'c'].map((id) => createNote(0, NOW, id))
    const { list: rest, removed } = removeNote(list, 'b')
    expect(rest.map((note) => note.id)).toEqual(['a', 'c'])
    expect(removed?.index).toBe(1)
    if (!removed) throw new Error('nada removido')
    const back = restoreNote(rest, removed)
    expect(back.map((note) => note.id)).toEqual(['a', 'b', 'c'])
    expect(restoreNote(back, removed)).toHaveLength(3)
    expect(restoreNote([], removed).map((note) => note.id)).toEqual(['b'])
    expect(removeNote(list, 'x').removed).toBeNull()
  })
})

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
const { useSettings } = await import('../../src/renderer/src/app/settingsStore')

describe('anotações da gravação (CA3, CA4)', () => {
  const invoke = vi.fn()
  const meeting = { id: 'm1', title: 't', startedAt: '2026-11-15T20:00:00.000Z', durationMs: 0, sources: { mic: false, system: false } }

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:meetings-create') return Promise.resolve(meeting)
      if (channel === 'scribe:notes-save') return Promise.resolve(true)
      return Promise.resolve({ configured: true, last4: 'aaaa', source: 'saved' })
    })
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useSettings.setState({ settings: { ...useSettings.getState().settings, saveToFolder: false } })
    useRecording.setState({ session: null, capture: null, transcription: null, tape: null, title: '', startedAt: null, saving: false, saveFailed: false, savedMeeting: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('painel lembrado, nova anotação com o tempo da gravação, pausa não muda nada', async () => {
    const recording = useRecording.getState()
    recording.addNote()
    expect(useRecording.getState().notes).toEqual([])
    expect(recording.start()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useRecording.getState()).toMatchObject({ notes: [], notesOpen: false })
    useRecording.getState().toggleNotes()
    expect(useRecording.getState().notesOpen).toBe(true)
    useRecording.getState().addNote()
    const [first] = useRecording.getState().notes
    expect(first).toMatchObject({ color: 'yellow', text: '' })
    expect(first?.atMs).toEqual(expect.any(Number))
    expect(useRecording.getState().newNoteId).toBe(first?.id)
    useRecording.getState().togglePause()
    useRecording.getState().addNote()
    expect(useRecording.getState().notes).toHaveLength(2)
    useRecording.getState().togglePause()
    await useRecording.getState().end()
    expect(useRecording.getState()).toMatchObject({ notes: [], notesOpen: false, session: null })
  })

  it('encerrar salva todas as anotações na reunião criada, inclusive a que está sendo digitada', async () => {
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const { addNote: add, editNote: edit, deleteNote, undoDeleteNote } = useRecording.getState()
    add()
    add()
    add()
    const [c, b, a] = useRecording.getState().notes as [MeetingNote, MeetingNote, MeetingNote]
    edit(a.id, { text: 'Primeira', color: 'green' })
    edit(b.id, { text: 'Segunda', color: 'pink' })
    deleteNote(b.id)
    expect(useRecording.getState().notes).toHaveLength(2)
    // O "Desfazer" fica no store: fechar o painel não o perde.
    useRecording.getState().toggleNotes()
    expect(useRecording.getState().noteUndo?.note.id).toBe(b.id)
    undoDeleteNote()
    expect(useRecording.getState().noteUndo).toBeNull()
    // Última tecla antes do clique em "Encerrar", sem esperar nada.
    edit(c.id, { text: 'Digitando ag' })
    const ending = useRecording.getState().end()
    // Enquanto salva, nada muda.
    useRecording.getState().editNote(c.id, { text: 'tarde demais' })
    expect(await ending).toEqual(meeting)
    const calls = invoke.mock.calls.map(([channel]) => channel as string)
    expect(calls.indexOf('scribe:notes-save')).toBeGreaterThan(calls.indexOf('scribe:meetings-create'))
    const saved = invoke.mock.calls.find(([channel]) => channel === 'scribe:notes-save')?.[1] as { meetingId: string; notes: MeetingNote[] }
    expect(saved.meetingId).toBe('m1')
    expect(saved.notes.map((note) => [note.text, note.color])).toEqual([
      ['Digitando ag', 'yellow'],
      ['Segunda', 'pink'],
      ['Primeira', 'green'],
    ])
  })

  it('sem anotação, nada é gravado; falha ao gravar as anotações: "Tentar de novo" grava', async () => {
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    useRecording.getState().addNote()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:meetings-create') return Promise.resolve(meeting)
      if (channel === 'scribe:notes-save') return Promise.reject(new Error('disco cheio'))
      return Promise.resolve({ configured: true })
    })
    expect(await useRecording.getState().end()).toBeNull()
    expect(useRecording.getState()).toMatchObject({ saveFailed: true })
    expect(useRecording.getState().notes).toHaveLength(1)
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'scribe:notes-save' ? true : meeting))
    expect(await useRecording.getState().end()).toEqual(meeting)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'scribe:meetings-create')).toHaveLength(1)

    invoke.mockClear()
    useRecording.getState().start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await useRecording.getState().end()
    expect(invoke.mock.calls.some(([channel]) => channel === 'scribe:notes-save')).toBe(false)
  })
})
