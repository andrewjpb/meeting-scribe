// CA9: tradução de reserva depois de 5 s, uma única chamada, e "Tentar de novo".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_TIMEOUT_MS, TranslationWatcher } from '../../src/renderer/src/transcription/fallback'
import { applyFallbackTranslation, applyMessage, emptyTranscriptState, markTranslationUnavailable } from '../../src/renderer/src/transcription/reducer'
import type { TranslateTurnResult } from '../../src/shared/transcription'

const ok = (translation: string): TranslateTurnResult => ({ ok: true, translation, model: 'qwen3.5-4b-32k-fast' })
const fail: TranslateTurnResult = { ok: false, error: 'server' }

describe('TranslationWatcher (CA9)', () => {
  let calls: { id: string; text: string }[]
  beforeEach(() => {
    vi.useFakeTimers()
    calls = []
  })
  afterEach(() => vi.useRealTimers())

  const watcher = (result: TranslateTurnResult = ok('Hello')) => {
    const results: { id: string; result: TranslateTurnResult }[] = []
    const instance = new TranslationWatcher({
      translate: (id, text) => {
        calls.push({ id, text })
        return Promise.resolve(result)
      },
      onResult: (id, value) => results.push({ id, result: value }),
    })
    return { instance, results }
  }

  it('espera 5 s antes de chamar o gateway por fora, uma vez só', async () => {
    const { instance, results } = watcher()
    expect(FALLBACK_TIMEOUT_MS).toBe(5_000)
    instance.expect('seg-1', 'Bom dia.')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([{ id: 'seg-1', text: 'Bom dia.' }])
    expect(results).toEqual([{ id: 'seg-1', result: ok('Hello') }])
    // O mesmo trecho não agenda de novo.
    instance.expect('seg-1', 'Bom dia.')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(1)
  })

  it('drop (eco, contrato 06): cancela a espera agendada e deixa pedir de novo depois', async () => {
    const { instance, results } = watcher()
    instance.expect('seg-1', 'Bom dia.')
    instance.drop('seg-1')
    expect(instance.has('seg-1')).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)
    expect(results).toHaveLength(0)
    // Deixou de ser eco: volta a esperar.
    instance.expect('seg-1', 'Bom dia.')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(1)
    // Já atendido: `drop` esquece, e um novo `expect` agenda outra vez.
    instance.drop('seg-1')
    instance.expect('seg-1', 'Bom dia.')
    expect(instance.has('seg-1')).toBe(true)
  })

  it('tradução da conexão chegando antes cancela a reserva', async () => {
    const { instance } = watcher()
    instance.expect('seg-1', 'Bom dia.')
    instance.settle([{ id: 'seg-1', translation: 'Ahead of time' }])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)
  })

  it('falha vira aviso; "Tentar de novo" chama na hora', async () => {
    const { instance, results } = watcher(fail)
    instance.expect('seg-1', 'Bom dia.')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(results).toEqual([{ id: 'seg-1', result: fail }])
    instance.retry('seg-1', 'Bom dia.')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
  })

  it('"Tentar de novo" com a chamada ainda em voo não abre outra nem duplica o resultado', async () => {
    const results: { id: string; result: TranslateTurnResult }[] = []
    let release: (value: TranslateTurnResult) => void = () => undefined
    let count = 0
    const instance = new TranslationWatcher({
      translate: () => {
        count += 1
        return new Promise<TranslateTurnResult>((resolve) => {
          release = resolve
        })
      },
      onResult: (id, value) => results.push({ id, result: value }),
    })
    instance.retry('seg-1', 'Bom dia.')
    instance.retry('seg-1', 'Bom dia.')
    instance.retry('seg-1', 'Bom dia.')
    expect(count).toBe(1)
    release(ok('Good morning.'))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([{ id: 'seg-1', result: ok('Good morning.') }])
  })

  it('idle: resolve quando a tradução em voo volta, ou no limite de tempo', async () => {
    let release: (value: TranslateTurnResult) => void = () => undefined
    const results: string[] = []
    const instance = new TranslationWatcher({
      translate: () =>
        new Promise<TranslateTurnResult>((resolve) => {
          release = resolve
        }),
      onResult: (id) => results.push(id),
    })
    let idle = false
    await instance.idle(5_000)
    instance.retry('seg-1', 'Bom dia.')
    void instance.idle(5_000).then(() => {
      idle = true
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(idle).toBe(false)
    release(ok('Good morning.'))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual(['seg-1'])
    expect(idle).toBe(true)

    // Chamada que nunca volta: o limite solta quem espera.
    instance.retry('seg-2', 'Até já.')
    let late = false
    void instance.idle(5_000).then(() => {
      late = true
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(late).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(late).toBe(true)
  })

  it('texto vazio não agenda nada', async () => {
    const { instance } = watcher()
    instance.expect('seg-1', '   ')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(0)
  })

  it('dispose cancela as esperas', async () => {
    const { instance } = watcher()
    instance.expect('seg-1', 'Bom dia.')
    instance.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(0)
  })
})

describe('tradução no estado (CA9)', () => {
  const state = applyMessage(emptyTranscriptState(), {
    source: 'mic',
    sessionId: 's1',
    offsetMs: 0,
    message: { type: 'Turn', turn_order: 0, end_of_turn: true, transcript: 'Bom dia.', speaker_label: null, words: [{ text: 'Bom dia.', start: 0, end: 500 }] },
  })

  it('tradução de reserva preenche o trecho', () => {
    const next = applyFallbackTranslation(state, state.segments[0]?.id ?? '', 'Good morning.', 'qwen3.5-4b-32k-fast')
    expect(next.segments[0]).toMatchObject({ translation: 'Good morning.', translationModel: 'qwen3.5-4b-32k-fast', translationState: 'done' })
  })

  it('falha marca "indisponível" sem apagar o texto', () => {
    const next = markTranslationUnavailable(state, state.segments[0]?.id ?? '')
    expect(next.segments[0]).toMatchObject({ translation: null, translationState: 'unavailable', text: 'Bom dia.' })
  })
})
