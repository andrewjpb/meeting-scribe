// De onde a gravação tira o áudio. O main responde `real` no app e `synthetic` só no smoke; o módulo
// do sinal gerado é importado sob demanda, então nem é carregado no app normal.
import type { CaptureMode } from '@shared/ipc'
import { pickRecorderMime } from '@shared/meeting-files'
import type { CreatePipeline, MediaApi } from './capture'
import { createMixedRecorder } from './mixer'
import { browserMedia, createWebAudioPipeline } from './pipeline'
import type { CreateAudioRecorder } from './recorder'
import type { SmokeProbe } from './synthetic'

export interface CaptureEnvironment {
  mode: CaptureMode
  media: MediaApi
  createPipeline: CreatePipeline
  /** Formato do arquivo da reunião (contrato 07); `null` se o gravador não aceita nenhum. */
  recorderMime: () => string | null
  /** Gravador do arquivo da reunião: o de verdade no app, o falso no smoke. */
  createRecorder: CreateAudioRecorder
  exposeProbe: (probe: SmokeProbe) => void
}

/** O primeiro formato da lista que o `MediaRecorder` deste Chromium aceita (o smoke usa o mesmo). */
function recorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return pickRecorderMime((mime) => MediaRecorder.isTypeSupported(mime))
}

let current: CaptureEnvironment | null = null

export async function loadCaptureEnvironment(): Promise<void> {
  const mode = await window.__scribeApi.invoke('scribe:capture-mode')
  if (mode === 'synthetic') {
    const synthetic = await import('./synthetic')
    current = {
      mode,
      media: synthetic.syntheticMedia,
      createPipeline: synthetic.createSyntheticPipeline,
      recorderMime,
      createRecorder: synthetic.createSyntheticRecorder,
      exposeProbe: synthetic.exposeSmokeProbe,
    }
    return
  }
  current = { mode: 'real', media: browserMedia(), createPipeline: createWebAudioPipeline, recorderMime, createRecorder: createMixedRecorder, exposeProbe: () => undefined }
}

export function captureEnvironment(): CaptureEnvironment {
  if (!current) throw new Error('ambiente de captura não carregado')
  return current
}
