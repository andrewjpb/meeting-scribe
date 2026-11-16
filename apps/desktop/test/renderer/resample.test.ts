import { describe, expect, it } from 'vitest'
import { downmix, Resampler, TARGET_RATE } from '../../src/renderer/src/audio/resample'

function sine(freq: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

/** Processa em blocos de 1024, como chegam do worklet. */
function stream(resampler: Resampler, input: Float32Array, block = 1024): Float32Array {
  const parts: Float32Array[] = []
  for (let i = 0; i < input.length; i += block) parts.push(resampler.process(input.subarray(i, i + block)))
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** RMS sem as bordas (o filtro precisa de meia janela de contexto). */
function rms(x: Float32Array, skip = 200): number {
  let sum = 0
  let n = 0
  for (let i = skip; i < x.length - skip; i++) {
    sum += (x[i] as number) ** 2
    n++
  }
  return Math.sqrt(sum / n)
}

const db = (ratio: number): number => 20 * Math.log10(ratio)

describe.each([48_000, 44_100])('Resampler a partir de %i Hz', (rate) => {
  it('1 kHz passa com o nível dentro de ±0,5 dB', () => {
    const input = sine(1000, rate, 1)
    const output = stream(new Resampler(rate), input)
    expect(Math.abs(db(rms(output) / rms(input)))).toBeLessThanOrEqual(0.5)
  })

  it('10 kHz fica pelo menos 40 dB abaixo', () => {
    const input = sine(10_000, rate, 1)
    const output = stream(new Resampler(rate), input)
    expect(db(rms(output) / rms(input))).toBeLessThanOrEqual(-40)
  })

  it('sai a 16 kHz, e em blocos dá o mesmo que de uma vez só', () => {
    const input = sine(440, rate, 2)
    const inBlocks = stream(new Resampler(rate), input, 1024)
    const oddBlocks = stream(new Resampler(rate), input, 997)
    const atOnce = new Resampler(rate).process(input)
    expect(Math.abs(inBlocks.length - (input.length * TARGET_RATE) / rate)).toBeLessThan(30)
    expect(Array.from(inBlocks)).toEqual(Array.from(atOnce))
    expect(Array.from(oddBlocks)).toEqual(Array.from(atOnce))
  })
})

describe('downmix', () => {
  it('estéreo vira mono pela média dos canais', () => {
    const left = Float32Array.from([0.5, -0.25, 1])
    const right = Float32Array.from([0.1, 0.25, 0])
    expect(Array.from(downmix([left, right]))).toEqual([Math.fround(0.3), 0, 0.5])
  })

  it('mono passa direto', () => {
    const mono = Float32Array.from([0.1, 0.2])
    expect(downmix([mono])).toBe(mono)
  })

  it('estéreo com L == R (como o áudio do sistema chega) mantém o nível depois da conversão', () => {
    const channel = sine(1000, 48_000, 0.5)
    const output = new Resampler(48_000).process(downmix([channel, channel.slice()]))
    expect(Math.abs(db(rms(output) / rms(channel)))).toBeLessThanOrEqual(0.5)
  })
})

describe('Resampler a 16 kHz', () => {
  it('não filtra, só copia', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3])
    expect(Array.from(new Resampler(16_000).process(input))).toEqual(Array.from(input))
  })
})
