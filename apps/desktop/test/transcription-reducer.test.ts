// CA4, CA5, CA6: redutor puro, rótulos e costura do relógio, com a fixture de uma sessão real.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyMessage, emptyTranscriptState, type StreamEnvelope, type TranscriptState } from '../src/renderer/src/transcription/reducer'
import { speakerLabel } from '../src/renderer/src/transcription/speakers'

interface FixtureLine {
  at: number
  source: 'mic' | 'system'
  sessionId: string
  offsetMs: number
  message: unknown
}

const lines: FixtureLine[] = readFileSync(resolve(__dirname, 'fixtures/session/aai-session.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as FixtureLine)

const envelopeOf = (line: FixtureLine): StreamEnvelope => ({ source: line.source, sessionId: line.sessionId, offsetMs: line.offsetMs, message: line.message })

const replay = (): TranscriptState => lines.reduce((state, line) => applyMessage(state, envelopeOf(line)), emptyTranscriptState())

const turn = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  type: 'Turn',
  turn_order: 0,
  end_of_turn: true,
  transcript: 'Bom dia a todos.',
  words: [
    { text: 'Bom', start: 1_000, end: 1_200 },
    { text: 'dia', start: 1_200, end: 1_500 },
    { text: 'a', start: 1_500, end: 1_550 },
    { text: 'todos.', start: 1_550, end: 2_000 },
  ],
  ...overrides,
})

const envelope = (overrides: Partial<StreamEnvelope> = {}): StreamEnvelope => ({ source: 'mic', sessionId: 's1', offsetMs: 0, message: null, ...overrides })

const llm = (turnOrder: number, content: string, model = 'qwen3.5-4b-32k-fast'): Record<string, unknown> => ({
  type: 'LLMGatewayResponse',
  turn_order: turnOrder,
  data: { model, choices: [{ message: { role: 'assistant', content } }] },
})

describe('applyMessage com a sessão real gravada (CA4)', () => {
  it('parciais atualizam o mesmo trecho e o final fecha com falante, texto e tempos', () => {
    const state = replay()
    // Turnos parciais do fixture viram um trecho por turno; só os finais ficam com texto fechado.
    expect(state.segments.every((segment) => !segment.partial)).toBe(true)
    expect(state.segments).toHaveLength(3)
    expect(state.segments.map((segment) => segment.turnOrder)).toEqual([0, 1, 2])
    const [first, second, third] = state.segments
    expect(first).toMatchObject({ source: 'mic', speaker: 'A', partial: false, sessionId: 'mic-1' })
    expect(first?.text).toMatch(/^que precisa funcionar/)
    expect(second?.text).toMatch(/^O terceiro ponto/)
    expect(third?.text).toMatch(/^Bom dia a todos/)
    // Tempos das palavras da sessão, sem deslocamento (offsetMs 0 no fixture).
    expect(first?.startMs).toBeGreaterThan(0)
    expect(first?.endMs).toBeGreaterThan(first?.startMs ?? 0)
  })

  it('a tradução da conexão chega pelo turn_order e fica no trecho, com o modelo', () => {
    const state = replay()
    expect(state.segments[0]).toMatchObject({ translationModel: 'qwen3.5-4b-32k-fast', translationState: 'done' })
    expect(state.segments[0]?.translation).toMatch(/interfering with the microphone/)
    expect(state.segments[2]?.translation).toMatch(/Good morning/)
    expect(state.pendingTranslations).toEqual({})
  })

  it('estado é imutável: o redutor devolve outro objeto', () => {
    const before = emptyTranscriptState()
    const after = applyMessage(before, envelope({ message: turn({}) }))
    expect(after).not.toBe(before)
    expect(before.segments).toHaveLength(0)
  })
})

describe('applyMessage com casos montados (CA4)', () => {
  it('parcial atualiza no lugar; final substitui o parcial sem trocar o id', () => {
    let state = applyMessage(emptyTranscriptState(), envelope({ message: turn({ end_of_turn: false, transcript: 'Bom dia', speaker_label: null }) }))
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({ partial: true, text: 'Bom dia', speaker: null })
    const id = state.segments[0]?.id
    state = applyMessage(state, envelope({ message: turn({ end_of_turn: false, transcript: 'Bom dia a', words: [{ text: 'Bom', start: 1_000, end: 1_200 }] }) }))
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]?.text).toBe('Bom dia a')
    state = applyMessage(state, envelope({ message: turn({ speaker_label: 'B' }) }))
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({ id, partial: false, text: 'Bom dia a todos.', speaker: 'B' })
  })

  it('parcial atrasado não reabre o trecho final', () => {
    let state = applyMessage(emptyTranscriptState(), envelope({ message: turn({}) }))
    state = applyMessage(state, envelope({ message: turn({ end_of_turn: false, transcript: 'atrasado' }) }))
    expect(state.segments[0]?.text).toBe('Bom dia a todos.')
    expect(state.segments[0]?.partial).toBe(false)
  })

  it('LLM chegando antes do final é ligado quando o final chega; fora de ordem também', () => {
    let state = applyMessage(emptyTranscriptState(), envelope({ message: llm(1, 'Second in English') }))
    expect(state.pendingTranslations['mic:s1:1']).toEqual({ translation: 'Second in English', model: 'qwen3.5-4b-32k-fast' })
    state = applyMessage(state, envelope({ message: turn({ turn_order: 1, transcript: 'Segundo.' }) }))
    state = applyMessage(state, envelope({ message: llm(0, 'First in English') }))
    state = applyMessage(state, envelope({ message: turn({ turn_order: 0 }) }))
    expect(state.segments.map((segment) => [segment.turnOrder, segment.translation])).toEqual([[1, 'Second in English'], [0, 'First in English']])
    expect(state.pendingTranslations).toEqual({})
  })

  it('SpeakerRevision corrige trechos já fechados', () => {
    let state = applyMessage(emptyTranscriptState(), envelope({ message: turn({}) }))
    expect(state.segments[0]?.speaker).toBeNull()
    state = applyMessage(
      state,
      envelope({
        message: {
          type: 'SpeakerRevision',
          revisions: [{ turn_order: 0, speaker_label: 'B', words: [{ text: 'Bom', speaker: 'B', start: 1_000, end: 1_200 }] }],
        },
      }),
    )
    expect(state.segments[0]?.speaker).toBe('B')
  })

  it('tipo desconhecido ou mensagem quebrada é ignorado sem erro (e sem novo objeto)', () => {
    const state = applyMessage(emptyTranscriptState(), envelope({ message: turn({}) }))
    expect(applyMessage(state, envelope({ message: { type: 'Heartbeat' } }))).toBe(state)
    expect(applyMessage(state, envelope({ message: 'lixo' }))).toBe(state)
    expect(applyMessage(state, envelope({ message: null }))).toBe(state)
    expect(applyMessage(state, envelope({ message: { type: 'Turn', turn_order: 'x', transcript: 1 } }))).toBe(state)
  })
})

describe('speakers (CA5)', () => {
  it('microfone é sempre "Você"', () => {
    expect(speakerLabel('mic', 'A')).toBe('Você')
    expect(speakerLabel('mic', null)).toBe('Você')
  })

  it('no sistema, a letra vira participante; sem rótulo ou pendente vira "Participantes"', () => {
    expect(speakerLabel('system', 'A')).toBe('Participante A')
    expect(speakerLabel('system', 'B')).toBe('Participante B')
    expect(speakerLabel('system', 'b')).toBe('Participante B')
    expect(speakerLabel('system', null)).toBe('Participantes')
    expect(speakerLabel('system', undefined)).toBe('Participantes')
    expect(speakerLabel('system', 'PENDING')).toBe('Participantes')
    expect(speakerLabel('system', 'UNKNOWN')).toBe('Participantes')
  })
})

describe('stitch (CA6)', () => {
  it('soma o deslocamento da sessão ao tempo da palavra', () => {
    const state = applyMessage(
      emptyTranscriptState(),
      envelope({ offsetMs: 14_000, message: turn({ words: [{ text: 'a', start: 2_500, end: 3_100 }] }) }),
    )
    expect(state.segments[0]).toMatchObject({ startMs: 16_500, endMs: 17_100 })
  })

  it('vale para a segunda sessão, depois de uma pausa: o deslocamento é o relógio da gravação', () => {
    let state = applyMessage(emptyTranscriptState(), envelope({ sessionId: 's1', offsetMs: 0, message: turn({ words: [{ text: 'a', start: 1_000, end: 1_200 }] }) }))
    state = applyMessage(state, envelope({ sessionId: 's2', offsetMs: 14_000, message: turn({ words: [{ text: 'b', start: 2_500, end: 2_900 }] }) }))
    expect(state.segments.map((segment) => segment.startMs)).toEqual([1_000, 16_500])
  })
})
