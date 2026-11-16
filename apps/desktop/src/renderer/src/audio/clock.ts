// Cronômetro da gravação: conta só o tempo gravando, sem as pausas (N4: `durationMs`).

export class RecordingClock {
  private accumulated = 0
  private runningSince: number | null = null

  constructor(private readonly now: () => number) {}

  start(): void {
    this.accumulated = 0
    this.runningSince = this.now()
  }

  pause(): void {
    if (this.runningSince === null) return
    this.accumulated += this.now() - this.runningSince
    this.runningSince = null
  }

  resume(): void {
    if (this.runningSince === null) this.runningSince = this.now()
  }

  /** Para e devolve o total. */
  stop(): number {
    this.pause()
    return this.accumulated
  }

  get running(): boolean {
    return this.runningSince !== null
  }

  get elapsedMs(): number {
    return this.accumulated + (this.runningSince === null ? 0 : this.now() - this.runningSince)
  }
}

/** `00:42`, `12:05`, `1:02:09`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
