// Falha silenciosa da captura (fase 0, teste 2): sem a permissão "Gravação de Áudio do Sistema" o
// macOS entrega a trilha `live` com zero absoluto, ou a encerra. Zero absoluto por 3 s vira `silent`;
// qualquer amostra diferente de zero volta a `ok`; trilha encerrada vira `ended` e fica assim.

export type SilenceState = 'ok' | 'silent' | 'ended'

export const SILENCE_AFTER_MS = 3000

export class SilenceDetector {
  private lastSoundAt: number
  private current: SilenceState = 'ok'

  constructor(
    private readonly now: () => number,
    private readonly onChange: (state: SilenceState) => void = () => undefined,
    private readonly thresholdMs = SILENCE_AFTER_MS,
  ) {
    this.lastSoundAt = now()
  }

  get state(): SilenceState {
    return this.current
  }

  /** Um bloco de amostras: `signal` diz se alguma amostra era diferente de zero. */
  update(signal: boolean): void {
    if (this.current === 'ended') return
    if (signal) {
      this.lastSoundAt = this.now()
      this.set('ok')
      return
    }
    this.tick()
  }

  /** Reavalia sem bloco novo (chamado também por temporizador). */
  tick(): void {
    if (this.current === 'ended') return
    if (this.now() - this.lastSoundAt >= this.thresholdMs) this.set('silent')
  }

  end(): void {
    this.set('ended')
  }

  /** Recomeça a contar agora (o microfone religado, contrato 29): volta a `ok`, salvo trilha encerrada. */
  reset(): void {
    if (this.current === 'ended') return
    this.lastSoundAt = this.now()
    this.set('ok')
  }

  private set(state: SilenceState): void {
    if (state === this.current) return
    this.current = state
    this.onChange(state)
  }
}
