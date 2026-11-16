// Contrato 06: eco do alto-falante na trilha "Você". Comparação pura (CA2), reavaliação no redutor na
// ordem real das mensagens (CA3), o sistema nunca muda (CA6) e o custo com uma reunião longa (CA9).
// As frações medidas ficam nos `toBeCloseTo` para o Andrew ajustar os limiares com reuniões reais.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ECHO_MIN_FRACTION, ECHO_MIN_RUN, ECHO_MIN_WORDS, ECHO_SLACK_MS, matchEcho, normalizeWords, SystemWindow, type EchoSpan } from '../src/renderer/src/transcription/echo'
import { applyEcho, applyMessage, emptyTranscriptState, persistableSegments, type StreamEnvelope, type TranscriptState } from '../src/renderer/src/transcription/reducer'
import type { RuntimeSegment } from '../src/shared/transcription'

/** O exemplo real visto pelo Andrew em 14/11/2026, gravando sem fone. */
const MIC_TEXT =
  'Em julho, por exemplo, eu conversei com alguns analistas da Finclass e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta.'
const SYSTEM_TEXT = 'e eu investi R$1 milhão no LV B11. No mês seguinte, agosto, eu já recebi mais de R$8 mil direto na minha conta bancária.'

const mic = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs })
const sys = (text: string, startMs: number, endMs: number): EchoSpan => ({ text, startMs, endMs })

interface FixtureLine {
  at: number
  source: 'mic' | 'system'
  sessionId: string
  offsetMs: number
  message: unknown
}

const echoLines: FixtureLine[] = readFileSync(resolve(__dirname, 'fixtures/session/echo-session.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as FixtureLine)

const envelopeOf = (line: FixtureLine): StreamEnvelope => ({ source: line.source, sessionId: line.sessionId, offsetMs: line.offsetMs, message: line.message })

describe('normalizeWords', () => {
  it('minúsculas, sem acento, sem pontuação, números mantidos', () => {
    expect(normalizeWords('No mês seguinte, AGOSTO: R$8 mil — LV B11!')).toEqual(['no', 'mes', 'seguinte', 'agosto', 'r', '8', 'mil', 'lv', 'b11'])
    expect(normalizeWords('  ...  ')).toEqual([])
  })
})

describe('matchEcho (CA2)', () => {
  it('constantes nomeadas', () => {
    expect(ECHO_SLACK_MS).toBe(1_000)
    expect(ECHO_MIN_RUN).toBe(4)
    expect(ECHO_MIN_FRACTION).toBe(0.6)
    expect(ECHO_MIN_WORDS).toBe(4)
  })

  describe('é eco', () => {
    it('o exemplo real, mesmo com cortes e horários diferentes entre as trilhas', () => {
      const result = matchEcho(mic(MIC_TEXT, 31_000, 41_000), [sys(SYSTEM_TEXT, 34_000, 44_000)])
      expect(result.echo).toBe(true)
      // 25 das 36 palavras do microfone estão numa sequência seguida do sistema ("e eu investi … minha conta").
      expect(result).toMatchObject({ micWords: 36, coveredWords: 25 })
      expect(result.fraction).toBeCloseTo(0.694, 3)
    })

    it('sistema cortado em dois trechos: o texto é juntado em ordem de tempo', () => {
      const result = matchEcho(mic(MIC_TEXT, 31_000, 41_000), [
        sys(SYSTEM_TEXT, 34_000, 44_000),
        sys('Em julho, por exemplo, eu conversei com alguns analistas da Finclass', 30_000, 34_000),
      ])
      expect(result.echo).toBe(true)
      expect(result).toMatchObject({ micWords: 36, coveredWords: 36, fraction: 1 })
    })

    it('controle da fala curta: "ok" que o sistema diz ao mesmo tempo', () => {
      const result = matchEcho(mic('Ok.', 10_000, 10_400), [sys('Ok.', 10_100, 10_500)])
      expect(result).toMatchObject({ echo: true, fraction: 1 })
      expect(result.timeCover).toBeCloseTo(0.75, 3)
    })

    it('controle de "não sei": o participante disse "não sei" naquele momento', () => {
      const result = matchEcho(mic('Não sei.', 7_000, 7_600), [sys('Então, eu não sei se a equipe tem tempo para isso agora.', 0, 15_000)])
      expect(result).toMatchObject({ echo: true, fraction: 1, timeCover: 1 })
    })
  })

  describe('não é eco', () => {
    it('fala sua metade sobreposta ao eco', () => {
      const own = 'eu acho que a gente precisa revisar esse contrato antes de assinar hoje'
      const leaked = 'no mês seguinte, agosto, eu já recebi mais de R$8 mil direto'
      const result = matchEcho(mic(`${own} ${leaked}`, 33_000, 43_000), [sys(SYSTEM_TEXT, 34_000, 44_000)])
      expect(result.echo).toBe(false)
      expect(result).toMatchObject({ micWords: 26, coveredWords: 13 })
      expect(result.fraction).toBe(0.5)
    })

    it('"ok" e "sim" curtos em momentos distintos', () => {
      // O "ok" do sistema 1,6 s depois: fora da janela de 1 s.
      expect(matchEcho(mic('Ok.', 10_000, 10_400), [sys('Ok.', 12_000, 12_400)])).toMatchObject({ echo: false, fraction: 0 })
      // O "sim, sim" do sistema termina 0,5 s antes do microfone: entra na janela, mas não cobre o tempo dele.
      const sim = matchEcho(mic('Sim, sim.', 20_000, 20_600), [sys('Sim, sim.', 17_000, 19_500)])
      expect(sim).toMatchObject({ echo: false, fraction: 1, timeCover: 0 })
      // Fala curta com uma palavra faltando no sistema.
      expect(matchEcho(mic('Sim, claro.', 10_000, 10_600), [sys('Sim.', 10_100, 10_500)])).toMatchObject({ echo: false, fraction: 0 })
    })

    it('texto igual fora da janela de tempo', () => {
      expect(matchEcho(mic(MIC_TEXT, 31_000, 41_000), [sys(MIC_TEXT, 41_000 + ECHO_SLACK_MS + 1, 52_000)])).toMatchObject({ echo: false, fraction: 0 })
      expect(matchEcho(mic(MIC_TEXT, 31_000, 41_000), [sys(MIC_TEXT, 15_000, 31_000 - ECHO_SLACK_MS - 1)])).toMatchObject({ echo: false, fraction: 0 })
      // Encostar na borda não é sobrepor; 1 ms para dentro, sim.
      expect(matchEcho(mic(MIC_TEXT, 31_000, 41_000), [sys(MIC_TEXT, 41_000 + ECHO_SLACK_MS, 52_000)]).echo).toBe(false)
      expect(matchEcho(mic(MIC_TEXT, 31_000, 41_000), [sys(MIC_TEXT, 41_000 + ECHO_SLACK_MS - 1, 52_000)]).echo).toBe(true)
    })

    describe('resposta sua logo depois de um turno longo do participante (casos da revisão)', () => {
      // Participante de 0 a 15 s, ~35 palavras; o microfone fala de 16 a 18 s.
      const participant = sys(
        'Então, sobre a entrega do mês que vem, eu não sei se a equipe tem tempo para isso agora, a gente precisa ver o cronograma com o cliente antes de prometer qualquer coisa. Eu acho que não dá.',
        0,
        15_000,
      )
      it.each([
        ['Eu não sei se é isso.', 6],
        ['Eu acho que dá sim, a gente faz.', 8],
        ['Não, eu acho que é isso mesmo.', 7],
        ['Pois é, eu acho que o cliente quer isso', 9],
      ])('"%s"', (text, words) => {
        expect(normalizeWords(participant.text).length).toBeGreaterThanOrEqual(35)
        const result = matchEcho(mic(text, 16_000, 18_000), [participant])
        expect(result).toMatchObject({ echo: false, micWords: words, fraction: 0 })
      })

      it('mesmo dentro da janela, só as palavras soltas não bastam (ordem e sequência de 4)', () => {
        // O turno do participante deslocado para cruzar o microfone: a regra de ordem decide sozinha.
        const near = { ...participant, startMs: 2_000, endMs: 17_000 }
        expect(matchEcho(mic('Eu acho que dá sim, a gente faz.', 16_000, 18_000), [near])).toMatchObject({ echo: false, fraction: 0 })
        expect(matchEcho(mic('Não, eu acho que é isso mesmo.', 16_000, 18_000), [near])).toMatchObject({ echo: false, fraction: 0 })
        expect(matchEcho(mic('Pois é, eu acho que o cliente quer isso', 16_000, 18_000), [near])).toMatchObject({ echo: false, fraction: 0 })
      })
    })

    it('"não sei" no meio da fala do participante, quando ele não disse "não sei" ali', () => {
      const result = matchEcho(mic('Não sei.', 7_000, 7_600), [
        sys('Então, sobre a entrega do mês que vem, a equipe tem tempo para isso agora? A gente precisa ver o cronograma com o cliente.', 0, 15_000),
      ])
      expect(result).toMatchObject({ echo: false, fraction: 0, timeCover: 1 })
    })

    it('as mesmas palavras fora de ordem', () => {
      const shuffled = 'conta minha na direto mil 8 R$ de mais recebi já eu agosto seguinte mês no'
      expect(matchEcho(mic(shuffled, 34_000, 44_000), [sys(SYSTEM_TEXT, 34_000, 44_000)])).toMatchObject({ echo: false, fraction: 0 })
    })

    it('parcial do microfone nunca é eco', () => {
      expect(matchEcho({ ...mic(MIC_TEXT, 31_000, 41_000), partial: true }, [sys(MIC_TEXT, 31_000, 41_000)]).echo).toBe(false)
    })
  })

  it('sequências que se sobrepõem contam cada palavra do microfone uma vez', () => {
    const result = matchEcho(mic('um dois três quatro cinco seis', 0, 2_000), [sys('um dois três quatro, depois três quatro cinco seis', 0, 2_000)])
    expect(result).toMatchObject({ micWords: 6, coveredWords: 6, fraction: 1, echo: true })
  })
})

describe('SystemWindow', () => {
  it('devolve só os trechos que se sobrepõem à janela, inclusive um longo que começou bem antes', () => {
    const window = new SystemWindow([sys('longo', 0, 50_000), sys('a', 10_000, 11_000), sys('b', 20_000, 21_000), sys('c', 30_000, 31_000)])
    expect(window.around({ startMs: 20_500, endMs: 21_000 }).map((span) => span.text)).toEqual(['longo', 'b'])
    // Janela de 11 a 14 s: `a` termina exatamente em 11 s, só encosta, fica de fora.
    expect(window.around({ startMs: 12_000, endMs: 13_000 }).map((span) => span.text)).toEqual(['longo'])
    expect(window.around({ startMs: 60_000, endMs: 70_000 })).toEqual([])
  })

  it('dá o mesmo resultado que matchEcho', () => {
    const spans = [sys(SYSTEM_TEXT, 34_000, 44_000), sys('Em julho, por exemplo, eu conversei com alguns analistas da Finclass', 30_000, 34_000)]
    const candidate = mic(MIC_TEXT, 31_000, 41_000)
    expect(new SystemWindow(spans).match(candidate)).toEqual(matchEcho(candidate, spans))
  })
})

/** Mensagens da fixture de eco, na ordem em que chegaram (mic final primeiro, sistema final ~3 s depois). */
const replayEcho = (removeEcho: boolean, upTo = echoLines.length): TranscriptState =>
  echoLines.slice(0, upTo).reduce((state, line) => applyMessage(state, envelopeOf(line), { removeEcho }), emptyTranscriptState())

const segmentById = (state: TranscriptState, id: string): RuntimeSegment | undefined => state.segments.find((segment) => segment.id === id)

const MIC_ECHO_ID = 'mic-eco-mic-1'
const SYSTEM_ID = 'system-eco-system-0'

describe('redutor com a remoção de eco (CA3, CA5, CA6)', () => {
  it('ordem real: o mic fecha antes, sem eco; o final do sistema 3 s depois marca o trecho do mic', () => {
    const micFinalIndex = echoLines.findIndex((line) => line.source === 'mic' && (line.message as { turn_order?: number; end_of_turn?: boolean }).turn_order === 1 && (line.message as { end_of_turn?: boolean }).end_of_turn === true)
    const systemFinalIndex = echoLines.findIndex((line) => line.source === 'system' && (line.message as { end_of_turn?: boolean }).end_of_turn === true)
    expect(micFinalIndex).toBeLessThan(systemFinalIndex)
    expect((echoLines[systemFinalIndex] as FixtureLine).at - (echoLines[micFinalIndex] as FixtureLine).at).toBeGreaterThanOrEqual(3_000)

    // Só com o parcial do sistema na janela, o mic final ainda não é eco.
    const atMicFinal = replayEcho(true, micFinalIndex + 1)
    expect(segmentById(atMicFinal, MIC_ECHO_ID)).toMatchObject({ partial: false })
    expect(segmentById(atMicFinal, MIC_ECHO_ID)?.echo ?? false).toBe(false)

    const done = replayEcho(true)
    expect(segmentById(done, MIC_ECHO_ID)?.echo).toBe(true)
    // A fala própria do microfone ("Pode falar…") continua.
    expect(segmentById(done, 'mic-eco-mic-0')?.echo ?? false).toBe(false)
    expect(persistableSegments(done).map((segment) => segment.id)).toEqual(['mic-eco-mic-0', SYSTEM_ID])
  })

  it('parcial do microfone nunca é marcado, mesmo idêntico ao sistema', () => {
    let state = applyMessage(emptyTranscriptState(), { source: 'system', sessionId: 's', offsetMs: 0, message: turnMessage(0, SYSTEM_TEXT, 34_000, 44_000, true) }, { removeEcho: true })
    state = applyMessage(state, { source: 'mic', sessionId: 'm', offsetMs: 0, message: turnMessage(0, SYSTEM_TEXT, 33_000, 43_000, false) }, { removeEcho: true })
    expect(segmentById(state, 'mic-m-0')).toMatchObject({ partial: true })
    expect(segmentById(state, 'mic-m-0')?.echo ?? false).toBe(false)
    state = applyMessage(state, { source: 'mic', sessionId: 'm', offsetMs: 0, message: turnMessage(0, SYSTEM_TEXT, 33_000, 43_000, true) }, { removeEcho: true })
    expect(segmentById(state, 'mic-m-0')?.echo).toBe(true)
  })

  it('a marca cai se o texto do sistema mudar (correção do final)', () => {
    let state = replayEcho(true)
    expect(segmentById(state, MIC_ECHO_ID)?.echo).toBe(true)
    // O mesmo turno do sistema chega de novo, corrigido, com outro texto.
    state = applyMessage(state, { source: 'system', sessionId: 'eco-system', offsetMs: 0, message: turnMessage(0, 'Bom, vamos passar para o próximo assunto da pauta de hoje.', 34_000, 44_000, true) }, { removeEcho: true })
    expect(segmentById(state, MIC_ECHO_ID)?.echo).toBe(false)
  })

  it('a marca cai se o trecho do sistema se mover para fora da janela', () => {
    let state = replayEcho(true)
    state = applyMessage(state, { source: 'system', sessionId: 'eco-system', offsetMs: 0, message: turnMessage(0, SYSTEM_TEXT, 60_000, 70_000, true) }, { removeEcho: true })
    expect(segmentById(state, MIC_ECHO_ID)?.echo).toBe(false)
  })

  it('desligado: nada marcado (CA5)', () => {
    const state = replayEcho(false)
    expect(state.segments.some((segment) => segment.echo)).toBe(false)
    expect(persistableSegments(state)).toHaveLength(3)
    // Idêntico ao redutor do contrato 05 (sem opção).
    expect(state).toEqual(echoLines.reduce((acc, line) => applyMessage(acc, envelopeOf(line)), emptyTranscriptState()))
  })

  it('trocar a configuração reavalia o que já existe', () => {
    const off = replayEcho(false)
    const on = applyEcho(off, true)
    expect(segmentById(on, MIC_ECHO_ID)?.echo).toBe(true)
    const offAgain = applyEcho(on, false)
    expect(offAgain.segments.some((segment) => segment.echo)).toBe(false)
  })

  it('o trecho do sistema nunca é removido nem alterado (CA6)', () => {
    const withoutRule = replayEcho(false)
    const withRule = replayEcho(true)
    expect(segmentById(withRule, SYSTEM_ID)).toEqual(segmentById(withoutRule, SYSTEM_ID))
    expect(segmentById(withRule, SYSTEM_ID)?.echo).toBeUndefined()
    expect(withRule.segments.filter((segment) => segment.source === 'system')).toHaveLength(1)
    expect(persistableSegments(withRule).find((segment) => segment.id === SYSTEM_ID)).toEqual(persistableSegments(withoutRule).find((segment) => segment.id === SYSTEM_ID))
    // Reavaliar tudo também não toca o sistema.
    expect(segmentById(applyEcho(withRule, true), SYSTEM_ID)).toBe(segmentById(withRule, SYSTEM_ID))
  })
})

describe('custo (CA9)', () => {
  it('2 000 trechos de cada lado avaliados em menos de 200 ms', () => {
    const segments: RuntimeSegment[] = []
    for (let i = 0; i < 2_000; i++) {
      const startMs = i * 6_000
      const base = { speaker: null, translation: null, translationModel: null, partial: false, turnOrder: i, translationState: 'pending' as const }
      // Metade dos trechos do mic são eco (o mesmo texto do sistema), metade fala própria.
      segments.push({ ...base, id: `system-${i}`, source: 'system', sessionId: 's', startMs: startMs + 1_000, endMs: startMs + 5_000, text: `${SYSTEM_TEXT} ${i}` })
      segments.push({ ...base, id: `mic-${i}`, source: 'mic', sessionId: 'm', startMs, endMs: startMs + 4_000, text: i % 2 === 0 ? SYSTEM_TEXT : `fala própria número ${i} sobre o contrato da agência` })
    }
    segments.sort((a, b) => a.startMs - b.startMs)
    const started = performance.now()
    const result = applyEcho({ segments, pendingTranslations: {} }, true)
    const elapsed = performance.now() - started
    expect(result.segments.filter((segment) => segment.echo)).toHaveLength(1_000)
    expect(elapsed).toBeLessThan(200)
  })
})

function turnMessage(turnOrder: number, text: string, startMs: number, endMs: number, final: boolean): Record<string, unknown> {
  const tokens = text.split(' ')
  const step = (endMs - startMs) / tokens.length
  return {
    type: 'Turn',
    turn_order: turnOrder,
    end_of_turn: final,
    transcript: text,
    words: tokens.map((token, i) => ({ text: token, start: Math.round(startMs + i * step), end: Math.round(startMs + (i + 1) * step) })),
  }
}
