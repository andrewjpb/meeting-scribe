// Estado do áudio do sistema na barra lateral (função pura, testada em test/renderer/settings-format.test.ts).
import type { CaptureState } from '../../audio/capture'

export type SystemAudioState = 'unknown' | 'ok' | 'silent'

/**
 * Áudio do sistema a partir do estado da captura. Encerrando, encerrada ou sem captura: mantém o último
 * valor. Trilha que falhou, terminou sozinha ou ficou em silêncio absoluto: `silent`. Trilha viva que
 * já entregou som: `ok`. Antes disso, nada mudou ainda.
 */
export function systemAudioFrom(capture: CaptureState | null, previous: SystemAudioState): SystemAudioState {
  if (!capture || capture.phase === 'idle' || capture.phase === 'stopping' || capture.phase === 'stopped') return previous
  if (capture.system === 'failed' || capture.system === 'ended' || capture.silence.system !== 'ok') return 'silent'
  if (capture.system === 'live' && capture.heard.system) return 'ok'
  return previous
}
