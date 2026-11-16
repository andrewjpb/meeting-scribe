// Nível de cada fonte para a fita: RMS de uma janela de amostras, em dBFS, mapeado de -60..0 para 0..1.

export const FLOOR_DBFS = -60

export function rmsToDbfs(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

/** -60 dBFS ou menos vira 0; 0 dBFS vira 1; linear em dB entre os dois. */
export function dbfsToLevel(dbfs: number): number {
  if (!(dbfs > FLOOR_DBFS)) return 0
  return Math.min(1, (dbfs - FLOOR_DBFS) / -FLOOR_DBFS)
}

/** Soma de quadrados de todos os canais desde a última leitura. */
export class LevelMeter {
  private sumSquares = 0
  private count = 0

  add(channels: readonly Float32Array[]): void {
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) {
        const v = channel[i] as number
        this.sumSquares += v * v
      }
      this.count += channel.length
    }
  }

  /** RMS da janela, ou `null` se nenhuma amostra chegou; zera a janela. */
  take(): number | null {
    if (this.count === 0) return null
    const rms = Math.sqrt(this.sumSquares / this.count)
    this.reset()
    return rms
  }

  reset(): void {
    this.sumSquares = 0
    this.count = 0
  }
}

/** Verdadeiro se alguma amostra é diferente de zero (o detector de silêncio usa zero absoluto). */
export function hasSignal(channels: readonly Float32Array[]): boolean {
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) if (channel[i] !== 0) return true
  }
  return false
}
