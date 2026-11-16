// Eco do alto-falante na trilha "Você" (contrato 06): sem fone, a fala dos participantes sai no
// alto-falante, entra no microfone e aparece duas vezes. A comparação é só de texto, em memória: um
// trecho final do microfone é eco quando a maior parte dele repete, na mesma ordem, o que o sistema
// transcreveu ao mesmo tempo. Os cortes de trecho não batem entre as trilhas e o sistema (com
// diarização) fecha o trecho uns 3 s depois, por isso a decisão é refeita a cada mudança do lado do
// sistema (`reducer.ts`).
//
// Regra revista em 15/11/2026: palavras soltas numa janela larga apagavam respostas reais suas logo
// depois de um turno longo dos participantes ("Eu não sei se é isso."). Agora só conta o que se
// sobrepõe no tempo e sequências de palavras seguidas. Os limiares vêm de um exemplo real só;
// ajustar com reuniões reais.

/** Folga, antes e depois do trecho do microfone: o eco acontece ao mesmo tempo que a fala do sistema. */
export const ECHO_SLACK_MS = 1_000
/** Menor sequência de palavras seguidas, na mesma ordem, que conta como repetição. */
export const ECHO_MIN_RUN = 4
/** Fração mínima das palavras do microfone cobertas por essas sequências. */
export const ECHO_MIN_FRACTION = 0.6
/** Abaixo disto ("sim", "não sei"), só é eco se o texto inteiro aparece seguido e o sistema cobre metade do tempo do microfone. */
export const ECHO_MIN_WORDS = 4

export interface EchoSpan {
  text: string
  startMs: number
  endMs: number
}

export interface EchoCandidate extends EchoSpan {
  partial?: boolean
}

export interface EchoMatch {
  echo: boolean
  /**
   * Palavras do microfone cobertas por sequências seguidas no texto do sistema / palavras do microfone.
   * A sequência mínima é `ECHO_MIN_RUN`; com menos palavras que isso, o texto inteiro.
   */
  fraction: number
  micWords: number
  coveredWords: number
  /** Maior parte da duração do microfone coberta por um único trecho do sistema da janela (0 a 1). */
  timeCover: number
}

/** Algum caractere fora do ASCII (acento possível). */
const NON_ASCII = /[\u0080-\uffff]/
const MARK = /\p{M}/u
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Minúsculas, sem acento, sem pontuação; números ficam. Um laço só, sem regex por palavra: é o passo
 * mais caro da comparação (CA9) e roda em cada trecho novo.
 */
export function normalizeWords(text: string): string[] {
  const lower = text.toLowerCase()
  // Decompõe só se houver acento possível: "ã" vira "a" + til, e o til (marca) é pulado.
  const plain = NON_ASCII.test(lower) ? lower.normalize('NFD') : lower
  const words: string[] = []
  let word = ''
  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i)
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      word += plain[i]
      continue
    }
    if (code < 128) {
      if (word) words.push(word)
      word = ''
      continue
    }
    const char = String.fromCodePoint(plain.codePointAt(i) as number)
    if (char.length === 2) i++
    if (MARK.test(char)) continue
    if (WORD_CHAR.test(char)) word += char
    else {
      if (word) words.push(word)
      word = ''
    }
  }
  if (word) words.push(word)
  return words
}

interface Timed {
  startMs: number
  endMs: number
}

/** Sobreposição de verdade com a janela do microfone; encostar na borda não conta. */
const overlapsWindow = (span: Timed, mic: Timed): boolean => span.startMs < mic.endMs + ECHO_SLACK_MS && span.endMs > mic.startMs - ECHO_SLACK_MS

/** Trecho do sistema já normalizado (a janela normaliza cada um uma vez só). */
interface NormalizedSpan extends Timed {
  words: readonly string[]
}

/**
 * Quantas palavras do microfone ficam dentro de alguma sequência de pelo menos `minRun` palavras
 * seguidas que aparece igual, na mesma ordem e contígua, no texto do sistema. Sequências podem se
 * sobrepor; cada palavra do microfone conta uma vez.
 */
function coveredByRuns(micWords: readonly string[], systemWords: readonly string[], minRun: number): number {
  if (micWords.length < minRun || systemWords.length < minRun) return 0
  const covered = new Uint8Array(micWords.length)
  // Maior sequência comum que termina em (i, j), linha a linha.
  let previous = new Uint16Array(systemWords.length + 1)
  let current = new Uint16Array(systemWords.length + 1)
  for (let i = 0; i < micWords.length; i++) {
    let longest = 0
    for (let j = 0; j < systemWords.length; j++) {
      const run = micWords[i] === systemWords[j] ? Math.min((previous[j] as number) + 1, 65_535) : 0
      current[j + 1] = run
      if (run > longest) longest = run
    }
    if (longest >= minRun) covered.fill(1, i - longest + 1, i + 1)
    // Cada posição da linha nova é reescrita; a coluna 0 fica sempre 0.
    ;[previous, current] = [current, previous]
  }
  let count = 0
  for (const flag of covered) count += flag
  return count
}

/** Maior fração da duração do microfone coberta por um único trecho do sistema. */
function timeCoverOf(mic: Timed, spans: readonly Timed[]): number {
  const duration = mic.endMs - mic.startMs
  let best = 0
  for (const span of spans) {
    if (duration <= 0) {
      if (span.startMs <= mic.startMs && span.endMs >= mic.startMs) return 1
      continue
    }
    const overlap = Math.min(span.endMs, mic.endMs) - Math.max(span.startMs, mic.startMs)
    if (overlap > 0) best = Math.max(best, overlap / duration)
  }
  return best
}

/**
 * Compara um trecho final do microfone com os trechos do sistema (finais e parciais). Só os do sistema
 * que se sobrepõem a `[mic.startMs − 1 s, mic.endMs + 1 s]` contam, com o texto juntado em ordem de
 * tempo. Parcial do microfone nunca é eco.
 */
export function matchEcho(mic: EchoCandidate, system: readonly EchoSpan[]): EchoMatch {
  const nearby = mic.partial ? [] : system.filter((span) => overlapsWindow(span, mic)).sort((a, b) => a.startMs - b.startMs)
  return matchNormalized(
    mic,
    nearby.map((span) => ({ words: normalizeWords(span.text), startMs: span.startMs, endMs: span.endMs })),
  )
}

/** A regra do CA2 sobre trechos do sistema já filtrados pela janela, normalizados e em ordem de tempo. */
function matchNormalized(mic: EchoCandidate, nearby: readonly NormalizedSpan[]): EchoMatch {
  const micWords = normalizeWords(mic.text)
  const none: EchoMatch = { echo: false, fraction: 0, micWords: micWords.length, coveredWords: 0, timeCover: 0 }
  if (mic.partial || micWords.length === 0 || nearby.length === 0) return none
  const systemWords = nearby.flatMap((span) => span.words)
  const timeCover = timeCoverOf(mic, nearby)
  if (micWords.length >= ECHO_MIN_WORDS) {
    const coveredWords = coveredByRuns(micWords, systemWords, ECHO_MIN_RUN)
    const fraction = coveredWords / micWords.length
    return { echo: fraction >= ECHO_MIN_FRACTION, fraction, micWords: micWords.length, coveredWords, timeCover }
  }
  // Fala curta: o texto inteiro seguido no sistema, e o sistema falando durante metade dela.
  const coveredWords = coveredByRuns(micWords, systemWords, micWords.length)
  const fraction = coveredWords / micWords.length
  return { echo: fraction === 1 && timeCover >= 0.5, fraction, micWords: micWords.length, coveredWords, timeCover }
}

export function isEcho(mic: EchoCandidate, system: readonly EchoSpan[]): boolean {
  return matchEcho(mic, system).echo
}

/**
 * Trechos do sistema já ordenados por início, com consulta da janela de um trecho do microfone sem
 * percorrer a reunião inteira (CA9): busca binária no início e no maior fim acumulado.
 */
export class SystemWindow<T extends EchoSpan> {
  private readonly spans: readonly T[]
  private readonly maxEnd: number[]
  /** Palavras normalizadas de cada trecho, calculadas na primeira consulta que o alcança. */
  private readonly words = new Map<number, readonly string[]>()

  constructor(spans: readonly T[]) {
    this.spans = [...spans].sort((a, b) => a.startMs - b.startMs)
    let max = -Infinity
    this.maxEnd = this.spans.map((span) => (max = Math.max(max, span.endMs)))
  }

  /** Trechos que se sobrepõem à janela do trecho do microfone. */
  around(mic: Timed): T[] {
    return this.indexesAround(mic).map((i) => this.spans[i] as T)
  }

  /** A comparação do microfone olhando só a janela dele. */
  match(mic: EchoCandidate): EchoMatch {
    if (mic.partial) return matchNormalized(mic, [])
    const nearby = this.indexesAround(mic).map((i) => {
      const span = this.spans[i] as T
      let words = this.words.get(i)
      if (!words) {
        words = normalizeWords(span.text)
        this.words.set(i, words)
      }
      return { words, startMs: span.startMs, endMs: span.endMs }
    })
    return matchNormalized(mic, nearby)
  }

  private indexesAround(mic: Timed): number[] {
    const from = mic.startMs - ECHO_SLACK_MS
    const to = mic.endMs + ECHO_SLACK_MS
    // Primeiro índice cujo maior fim acumulado passa de `from` (antes dele, nenhum se sobrepõe).
    let lo = 0
    let hi = this.spans.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((this.maxEnd[mid] as number) <= from) lo = mid + 1
      else hi = mid
    }
    const result: number[] = []
    for (let i = lo; i < this.spans.length; i++) {
      const span = this.spans[i] as T
      if (span.startMs >= to) break
      if (overlapsWindow(span, mic)) result.push(i)
    }
    return result
  }
}
