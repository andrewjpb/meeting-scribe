// Ciclo de vida da transcrição de uma gravação: uma sessão por fonte ativa, pausa e retomada, troca
// planejada aos 170 min e encerramento com espera do `Termination`. O envio em si fica em `sink.ts`;
// aqui só se costura o token, a URL (com as configurações do momento) e o relógio da gravação. É também
// o `FrameSink` que a captura alimenta: cada quadro entra por `write`.
import type { AppSettings } from '../../../shared/settings-defaults'
import type { TranscriptionTokenResult } from '../../../shared/transcription'
import type { AudioFrame, AudioSource, FrameSink } from '../audio/frames'
import { buildStreamingUrl } from './url'
import { AssemblyAiSink, type OpenSocket, type SourceStatus, type Timers } from './sink'
import type { StreamEnvelope } from './reducer'

export type TranscriptionSettings = Pick<AppSettings, 'sourceLanguage' | 'targetLanguage' | 'translationEnabled' | 'translationModel' | 'translationEngine' | 'identifySpeakers'>

export interface TranscriptionSessionOptions {
  /** Fontes que a captura abriu de fato. */
  sources: readonly AudioSource[]
  settings: TranscriptionSettings
  /** Relógio da gravação (sem pausas). */
  elapsedMs: () => number
  getToken: () => Promise<TranscriptionTokenResult>
  openSocket: OpenSocket
  onMessage: (envelope: StreamEnvelope) => void
  onStatus?: (source: AudioSource, status: SourceStatus) => void
  timers?: Timers
  reconnectDelaysMs?: readonly number[]
  terminationTimeoutMs?: number
  pauseTerminationTimeoutMs?: number
  rotateAfterMs?: number
  newSessionId?: () => string
}

export class TranscriptionSession implements FrameSink {
  readonly sink: AssemblyAiSink
  private readonly sources: readonly AudioSource[]
  private started = false

  constructor(options: TranscriptionSessionOptions) {
    this.sources = options.sources
    this.sink = new AssemblyAiSink({
      openSocket: options.openSocket,
      getToken: options.getToken,
      urlFor: (token, source) => buildStreamingUrl({ token, source, settings: options.settings }),
      onMessage: options.onMessage,
      elapsedMs: options.elapsedMs,
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.reconnectDelaysMs ? { reconnectDelaysMs: options.reconnectDelaysMs } : {}),
      ...(options.terminationTimeoutMs !== undefined ? { terminationTimeoutMs: options.terminationTimeoutMs } : {}),
      ...(options.pauseTerminationTimeoutMs !== undefined ? { pauseTerminationTimeoutMs: options.pauseTerminationTimeoutMs } : {}),
      ...(options.rotateAfterMs !== undefined ? { rotateAfterMs: options.rotateAfterMs } : {}),
      ...(options.newSessionId ? { newSessionId: options.newSessionId } : {}),
    })
  }

  /** Só as fontes que a captura abriu recebem conexão (a que falhou não fica reconectando à toa). */
  start(active: readonly AudioSource[] = this.sources): void {
    if (this.started) return
    this.started = true
    this.sink.start(active)
  }

  /** Quadro da captura: vai para o socket da fonte (ou para o buffer, enquanto ele abre). */
  write(frame: AudioFrame): void {
    this.sink.write(frame)
  }

  pause(): void {
    this.sink.pause()
  }

  resume(): void {
    this.sink.resume()
  }

  retry(source: AudioSource): void {
    this.sink.retry(source)
  }

  /** Encerrar: espera `Termination` por até 3 s e fecha os sockets. */
  end(): Promise<void> {
    return this.sink.end()
  }
}
