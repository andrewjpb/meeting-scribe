// Conversão para 16 kHz mono, em fluxo (blocos do worklet um atrás do outro). Mesmo filtro de
// prova/renderer/app.js: FIR passa-baixa de 127 coeficientes (sinc com janela de Blackman, corte em
// 7 kHz, ganho unitário em DC), avaliado só nas posições de saída; posição fracionária (44,1 kHz)
// interpola linearmente entre duas saídas do filtro. A posição é calculada em inteiros, sem acumular
// erro de ponto flutuante numa reunião longa.

export const TARGET_RATE = 16_000
const TAPS = 127
const HALF = (TAPS - 1) / 2

function lowPass(inputRate: number): Float64Array {
  const cutoff = Math.min(7000, 0.45 * inputRate) / inputRate
  const h = new Float64Array(TAPS)
  let sum = 0
  for (let k = 0; k < TAPS; k++) {
    const t = k - HALF
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t)
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (TAPS - 1))
    h[k] = sinc * w
    sum += h[k] as number
  }
  for (let k = 0; k < TAPS; k++) h[k] = (h[k] as number) / sum
  return h
}

/** Média dos canais (o loopback chega estéreo com L == R; o microfone já vem mono). */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first
  const out = new Float32Array(first.length)
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (channel[i] ?? 0) / channels.length
  }
  return out
}

export class Resampler {
  readonly inputRate: number
  private readonly h: Float64Array | null
  /** Amostras de entrada ainda necessárias; `buffer[0]` é a amostra absoluta `bufferStart`. */
  private buffer: Float32Array
  private bufferStart: number
  /** Próxima saída a produzir (índice absoluto). */
  private outIndex = 0

  constructor(inputRate: number) {
    if (!(inputRate > 0) || !Number.isInteger(inputRate)) throw new Error(`taxa de entrada inválida: ${inputRate}`)
    this.inputRate = inputRate
    this.h = inputRate === TARGET_RATE ? null : lowPass(inputRate)
    // Meio filtro de zeros antes da primeira amostra, para a saída ficar alinhada com a entrada.
    this.buffer = new Float32Array(HALF)
    this.bufferStart = -HALF
  }

  /** Recebe amostras mono na taxa de entrada; devolve as amostras a 16 kHz já disponíveis. */
  process(input: Float32Array): Float32Array {
    if (!this.h) return input.slice()
    const merged = new Float32Array(this.buffer.length + input.length)
    merged.set(this.buffer)
    merged.set(input, this.buffer.length)
    const end = this.bufferStart + merged.length // primeira amostra absoluta que ainda não chegou

    const out: number[] = []
    for (;;) {
      const numerator = this.outIndex * this.inputRate
      const i = Math.floor(numerator / TARGET_RATE)
      const frac = (numerator - i * TARGET_RATE) / TARGET_RATE
      const last = frac === 0 ? i + HALF : i + 1 + HALF
      if (last >= end) break
      const a = this.filterAt(merged, i - this.bufferStart)
      out.push(frac === 0 ? a : a * (1 - frac) + this.filterAt(merged, i + 1 - this.bufferStart) * frac)
      this.outIndex++
    }

    // Guarda só o que a próxima saída ainda vai ler.
    const nextI = Math.floor((this.outIndex * this.inputRate) / TARGET_RATE)
    const keepFrom = Math.max(this.bufferStart, nextI - HALF)
    this.buffer = merged.slice(keepFrom - this.bufferStart)
    this.bufferStart = keepFrom
    return Float32Array.from(out)
  }

  /** Saída do filtro centrada na posição `center` de `x`. */
  private filterAt(x: Float32Array, center: number): number {
    const h = this.h as Float64Array
    let acc = 0
    const start = center - HALF
    for (let k = 0; k < TAPS; k++) acc += (h[k] as number) * (x[start + k] as number)
    return acc
  }
}
