// Estado da transcrição: "sem chave" só olha as fontes abertas (CA10), o arquivo salvo não perde um
// trecho que ainda era parcial no fim, e o encerramento espera a tradução de reserva em voo (CA9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceStatus } from '../../src/renderer/src/transcription/sink'
import { persistableTranscript, useTranscription } from '../../src/renderer/src/transcription/store'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'
import type { TranslateTurnResult } from '../../src/shared/transcription'

const status = (value: SourceStatus['status'], error: SourceStatus['error'] = null): SourceStatus => ({ status: value, attempts: 0, nextRetryMs: null, error })

describe('useTranscription.updateSource (CA10)', () => {
  beforeEach(() => {
    useTranscription.getState().attach(null, { ...DEFAULT_SETTINGS })
  })
  afterEach(() => useTranscription.getState().reset())

  it('só o microfone aberto e sem chave: o estado é "sem chave" (o sistema ocioso não conta)', () => {
    useTranscription.getState().updateSource('mic', status('no-key', 'no-key'))
    expect(useTranscription.getState().sources.system.status).toBe('idle')
    expect(useTranscription.getState().status).toBe('no-key')
  })

  it('uma fonte sem chave e a outra conectando: ainda esperando', () => {
    useTranscription.getState().updateSource('mic', status('no-key', 'no-key'))
    useTranscription.getState().updateSource('system', status('connecting'))
    expect(useTranscription.getState().status).toBe('waiting')
  })

  it('nenhuma fonte aberta: esperando, não "sem chave"', () => {
    useTranscription.getState().updateSource('mic', status('idle'))
    expect(useTranscription.getState().status).toBe('waiting')
  })
})

describe('persistableTranscript (CA12)', () => {
  const base = { source: 'mic' as const, speaker: null, translation: null, translationModel: null, sessionId: 's1', translationState: 'pending' as const }

  it('um trecho ainda parcial no fim entra no arquivo; parcial vazio não', () => {
    const saved = persistableTranscript([
      { ...base, id: 'a', turnOrder: 0, startMs: 0, endMs: 900, text: 'Bom dia.', partial: false },
      { ...base, id: 'b', turnOrder: 1, startMs: 1_000, endMs: 1_800, text: 'e o que ficou', partial: true },
      { ...base, id: 'c', turnOrder: 2, startMs: 2_000, endMs: 2_000, text: '  ', partial: true },
    ])
    expect(saved.map((segment) => segment.id)).toEqual(['a', 'b'])
    expect(saved[1]).toEqual({ id: 'b', source: 'mic', speaker: null, startMs: 1_000, endMs: 1_800, text: 'e o que ficou', translation: null, translationModel: null })
  })
})

describe('useTranscription.settleTranslations (CA9)', () => {
  let release: (value: TranslateTurnResult) => void = () => undefined
  const invoke = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    invoke.mockReset()
    invoke.mockImplementation(
      () =>
        new Promise<TranslateTurnResult>((resolve) => {
          release = resolve
        }),
    )
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useTranscription.getState().attach(null, { ...DEFAULT_SETTINGS, translationEnabled: true })
  })
  afterEach(() => {
    useTranscription.getState().reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('espera a tradução de reserva em voo e ela entra no trecho antes de salvar', async () => {
    useTranscription.getState().receive({
      source: 'mic',
      sessionId: 's1',
      offsetMs: 0,
      message: { type: 'Turn', turn_order: 0, end_of_turn: true, transcript: 'Bom dia.', words: [{ text: 'Bom', start: 0, end: 400 }] },
    })
    // Os 5 s da reserva passam e a chamada avulsa sai; ela ainda não voltou quando "Encerrar" chega.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(invoke).toHaveBeenCalledTimes(1)
    let settled = false
    const settling = useTranscription
      .getState()
      .settleTranslations()
      .then(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(settled).toBe(false)
    release({ ok: true, translation: 'Good morning.', model: 'qwen3.5-4b-32k-fast' })
    await settling
    expect(persistableTranscript(useTranscription.getState().segments)[0]).toMatchObject({ text: 'Bom dia.', translation: 'Good morning.' })
  })

  it('sem resposta, desiste em 5 s', async () => {
    useTranscription.getState().receive({
      source: 'mic',
      sessionId: 's1',
      offsetMs: 0,
      message: { type: 'Turn', turn_order: 0, end_of_turn: true, transcript: 'Bom dia.', words: [{ text: 'Bom', start: 0, end: 400 }] },
    })
    await vi.advanceTimersByTimeAsync(5_000)
    let settled = false
    void useTranscription
      .getState()
      .settleTranslations()
      .then(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })
})

// Contrato 06: eco do alto-falante. A mesma fala chega pelo microfone (final primeiro) e pelo sistema
// (final uns 3 s depois, com diarização).
describe('useTranscription com a remoção de eco (contrato 06)', () => {
  const MIC_TEXT =
    'Em julho, por exemplo, eu conversei com alguns analistas da Finclass e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta.'
  const SYSTEM_TEXT = 'e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta bancária.'
  const MIC_ID = 'mic-m-0'
  const SYSTEM_ID = 'system-s-0'

  const turn = (source: 'mic' | 'system', text: string, startMs: number, endMs: number, final = true) => {
    const tokens = text.split(' ')
    const step = (endMs - startMs) / tokens.length
    return {
      source,
      sessionId: source === 'mic' ? 'm' : 's',
      offsetMs: 0,
      message: {
        type: 'Turn',
        turn_order: 0,
        end_of_turn: final,
        transcript: text,
        words: tokens.map((token, i) => ({ text: token, start: Math.round(startMs + i * step), end: Math.round(startMs + (i + 1) * step) })),
      },
    }
  }
  const micFinal = () => turn('mic', MIC_TEXT, 31_000, 41_000)
  const systemFinal = (text = SYSTEM_TEXT) => turn('system', text, 34_000, 44_000)
  const llm = (source: 'mic' | 'system', content: string) => ({
    source,
    sessionId: source === 'mic' ? 'm' : 's',
    offsetMs: 0,
    message: { type: 'LLMGatewayResponse', turn_order: 0, data: { model: 'qwen3.5-4b-32k-fast', choices: [{ message: { content } }] } },
  })
  const segment = (id: string) => useTranscription.getState().segments.find((item) => item.id === id)
  const visible = () => useTranscription.getState().segments.filter((item) => !item.echo).map((item) => item.id)
  const claudeCalls = (invoke: ReturnType<typeof vi.fn>) => invoke.mock.calls.filter((call) => call[0] === 'scribe:claude-translate').map((call) => (call[1] as { segmentId: string }).segmentId)
  const fallbackCalls = (invoke: ReturnType<typeof vi.fn>) => invoke.mock.calls.filter((call) => call[0] === 'scribe:translate-turn')

  let pending: { segmentId: string; resolve: (value: unknown) => void }[] = []
  const invoke = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    pending = []
    invoke.mockReset()
    invoke.mockImplementation(
      (channel: string, payload: { segmentId?: string }) =>
        new Promise((resolve) => {
          pending.push({ segmentId: channel === 'scribe:claude-translate' ? (payload.segmentId ?? '') : channel, resolve })
        }),
    )
    vi.stubGlobal('window', { __scribeApi: { invoke } })
  })
  afterEach(() => {
    useTranscription.getState().reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const claudeSettings = (removeEcho: boolean) => ({ ...DEFAULT_SETTINGS, translationEnabled: true, translationEngine: 'claude-cli' as const, removeEcho })

  it('Claude CLI, ordem real: o mic vai para a fila; virou eco, a tradução que volta é descartada sem erro (CA4)', async () => {
    useTranscription.getState().attach(null, claudeSettings(true))
    useTranscription.getState().receive(micFinal())
    expect(claudeCalls(invoke)).toEqual([MIC_ID])
    useTranscription.getState().receive(systemFinal())
    expect(segment(MIC_ID)?.echo).toBe(true)
    expect(visible()).toEqual([SYSTEM_ID])
    expect(claudeCalls(invoke)).toEqual([MIC_ID, SYSTEM_ID])

    pending.find((call) => call.segmentId === MIC_ID)?.resolve({ ok: true, translation: 'In July…', model: 'claude-cli:haiku' })
    pending.find((call) => call.segmentId === SYSTEM_ID)?.resolve({ ok: true, translation: 'and I invested…', model: 'claude-cli:haiku' })
    await vi.advanceTimersByTimeAsync(0)
    expect(segment(MIC_ID)).toMatchObject({ translation: null, translationState: 'pending' })
    expect(segment(SYSTEM_ID)).toMatchObject({ translation: 'and I invested…', translationState: 'done' })
    expect(persistableTranscript(useTranscription.getState().segments).map((item) => item.id)).toEqual([SYSTEM_ID])
  })

  it('Claude CLI: erro da tradução de um trecho que virou eco não mostra "Tradução indisponível"', async () => {
    useTranscription.getState().attach(null, claudeSettings(true))
    useTranscription.getState().receive(micFinal())
    useTranscription.getState().receive(systemFinal())
    pending.find((call) => call.segmentId === MIC_ID)?.resolve({ ok: false, error: 'not-running' })
    await vi.advanceTimersByTimeAsync(0)
    expect(segment(MIC_ID)?.translationState).toBe('pending')
  })

  it('Claude CLI: o mic que já chega como eco não vai para a fila', () => {
    useTranscription.getState().attach(null, claudeSettings(true))
    useTranscription.getState().receive(systemFinal())
    useTranscription.getState().receive(micFinal())
    expect(segment(MIC_ID)?.echo).toBe(true)
    expect(claudeCalls(invoke)).toEqual([SYSTEM_ID])
  })

  it('Claude CLI: a marca cai com a correção do sistema e o trecho do mic volta a pedir tradução (CA3)', async () => {
    useTranscription.getState().attach(null, claudeSettings(true))
    useTranscription.getState().receive(systemFinal())
    useTranscription.getState().receive(micFinal())
    expect(claudeCalls(invoke)).toEqual([SYSTEM_ID])
    useTranscription.getState().receive(systemFinal('Bom, vamos passar para o próximo assunto da pauta de hoje.'))
    expect(segment(MIC_ID)?.echo).toBe(false)
    expect(visible()).toEqual([MIC_ID, SYSTEM_ID])
    expect(claudeCalls(invoke)).toEqual([SYSTEM_ID, MIC_ID])
    pending.find((call) => call.segmentId === MIC_ID)?.resolve({ ok: true, translation: 'In July…', model: 'claude-cli:haiku' })
    await vi.advanceTimersByTimeAsync(0)
    expect(segment(MIC_ID)?.translation).toBe('In July…')
  })

  it('AssemblyAI: a tradução da conexão chega igual e é ignorada; a reserva não sai para o eco (CA4)', async () => {
    useTranscription.getState().attach(null, { ...DEFAULT_SETTINGS, translationEnabled: true, removeEcho: true })
    useTranscription.getState().receive(systemFinal())
    useTranscription.getState().receive(llm('system', 'and I invested…'))
    useTranscription.getState().receive(micFinal())
    useTranscription.getState().receive(llm('mic', 'In July…'))
    expect(segment(MIC_ID)?.echo).toBe(true)
    expect(visible()).toEqual([SYSTEM_ID])
    expect(persistableTranscript(useTranscription.getState().segments).map((item) => item.id)).toEqual([SYSTEM_ID])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fallbackCalls(invoke)).toHaveLength(0)
  })

  it('AssemblyAI, ordem real: o mic fecha sem tradução, vira eco antes dos 5 s e a reserva é cancelada', async () => {
    useTranscription.getState().attach(null, { ...DEFAULT_SETTINGS, translationEnabled: true, removeEcho: true })
    useTranscription.getState().receive(micFinal())
    await vi.advanceTimersByTimeAsync(3_000)
    useTranscription.getState().receive(systemFinal())
    useTranscription.getState().receive(llm('system', 'and I invested…'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fallbackCalls(invoke)).toHaveLength(0)
    let settled = false
    void useTranscription
      .getState()
      .settleTranslations()
      .then(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('desligado: nada marcado, nada oculto, a tradução segue como no contrato 05 (CA5)', async () => {
    useTranscription.getState().attach(null, claudeSettings(false))
    useTranscription.getState().receive(micFinal())
    useTranscription.getState().receive(systemFinal())
    expect(useTranscription.getState().segments.some((item) => item.echo)).toBe(false)
    expect(visible()).toEqual([MIC_ID, SYSTEM_ID])
    pending.find((call) => call.segmentId === MIC_ID)?.resolve({ ok: true, translation: 'In July…', model: 'claude-cli:haiku' })
    await vi.advanceTimersByTimeAsync(0)
    expect(segment(MIC_ID)?.translation).toBe('In July…')
    expect(persistableTranscript(useTranscription.getState().segments).map((item) => item.id)).toEqual([MIC_ID, SYSTEM_ID])
  })

  it('trocar a configuração na gravação reavalia os trechos que já existem (CA7)', () => {
    useTranscription.getState().attach(null, claudeSettings(false))
    useTranscription.getState().receive(systemFinal())
    useTranscription.getState().receive(micFinal())
    expect(visible()).toEqual([MIC_ID, SYSTEM_ID])
    useTranscription.getState().setRemoveEcho(true)
    expect(segment(MIC_ID)?.echo).toBe(true)
    expect(visible()).toEqual([SYSTEM_ID])
    // A partir daqui, as mensagens novas também usam a regra.
    useTranscription.getState().receive(systemFinal(`${SYSTEM_TEXT} Pois é.`))
    expect(segment(MIC_ID)?.echo).toBe(true)
    useTranscription.getState().setRemoveEcho(false)
    expect(useTranscription.getState().segments.some((item) => item.echo)).toBe(false)
    expect(visible()).toEqual([MIC_ID, SYSTEM_ID])
  })

  it('o trecho do sistema nunca é removido nem alterado (CA6)', () => {
    useTranscription.getState().attach(null, { ...DEFAULT_SETTINGS, translationEnabled: false, removeEcho: false })
    useTranscription.getState().receive(micFinal())
    useTranscription.getState().receive(systemFinal())
    const without = segment(SYSTEM_ID)
    useTranscription.getState().setRemoveEcho(true)
    expect(segment(SYSTEM_ID)).toBe(without)
    expect(persistableTranscript(useTranscription.getState().segments).map((item) => item.id)).toEqual([SYSTEM_ID])
  })
})
