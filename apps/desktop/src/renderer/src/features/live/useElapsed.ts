import { useEffect, useState } from 'react'
import type { RecordingClock } from '../../audio/clock'

/** Tempo gravado, relido 4 vezes por segundo enquanto o cronômetro corre. */
export function useElapsed(clock: RecordingClock | null, running: boolean): number {
  const [elapsed, setElapsed] = useState(() => clock?.elapsedMs ?? 0)
  useEffect(() => {
    if (!clock) return
    const read = (): void => setElapsed(clock.elapsedMs)
    read()
    if (!running) return
    const timer = setInterval(read, 250)
    return () => clearInterval(timer)
  }, [clock, running])
  return clock ? elapsed : 0
}
