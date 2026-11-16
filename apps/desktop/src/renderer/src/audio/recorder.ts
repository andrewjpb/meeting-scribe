// Gravador do áudio da reunião (contrato 07): entrega ao main, em ordem, os pedaços de 5 s do
// `MediaRecorder`, para nada da reunião ficar inteiro na memória. Pausar pausa o gravador (o arquivo
// não guarda o silêncio da pausa); encerrar espera o último pedaço por até 5 s. O gravador e quem
// escreve chegam injetados: no app, o `MediaRecorder` sobre a mistura das duas fontes (`mixer.ts`);
// no smoke, um gravador falso; nos testes, um de mentira. A captura que vai para a AssemblyAI não passa
// por aqui.
import { AUDIO_STOP_WAIT_MS, AUDIO_TIMESLICE_MS } from '@shared/meeting-files'
import type { AudioSource } from './frames'
import type { StreamLike } from './capture'

/** O pedaço do `MediaRecorder` que o app usa. */
export interface RecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start(timeslice?: number): void
  pause(): void
  resume(): void
  stop(): void
}

/** Gravador de uma reunião e onde ligar cada fonte que abrir. */
export interface MeetingAudioRecorder {
  recorder: RecorderLike
  /** Fonte que a captura abriu: entra na mistura sem ganho extra. */
  addStream(source: AudioSource, stream: StreamLike): void
  close(): Promise<void>
}

/** Cria o gravador para o formato escolhido (`pickRecorderMime`). */
export type CreateAudioRecorder = (mime: string) => MeetingAudioRecorder

export interface AudioChunkWriter {
  /** Grava um pedaço no fim do arquivo; falso quando não escreveu. */
  append(data: Uint8Array): Promise<boolean>
}

export interface AudioFileRecorderDeps {
  recorder: RecorderLike
  writer: AudioChunkWriter
  /** Uma vez, na primeira falha: o aviso da gravação. */
  onFailure: () => void
  timesliceMs?: number
  stopWaitMs?: number
}

export class AudioFileRecorder {
  private queue: Promise<void> = Promise.resolve()
  private failed = false
  private closed = false
  /** Bytes e pedaços já gravados pelo main (o smoke confere com o arquivo). */
  bytes = 0
  chunks = 0

  constructor(private readonly deps: AudioFileRecorderDeps) {}

  start(): void {
    const { recorder } = this.deps
    recorder.ondataavailable = (event) => this.enqueue(event.data)
    recorder.onerror = () => this.fail()
    try {
      recorder.start(this.deps.timesliceMs ?? AUDIO_TIMESLICE_MS)
    } catch {
      this.fail()
    }
  }

  pause(): void {
    if (this.deps.recorder.state === 'recording') this.deps.recorder.pause()
  }

  resume(): void {
    if (this.deps.recorder.state === 'paused') this.deps.recorder.resume()
  }

  get ok(): boolean {
    return !this.failed
  }

  /** O main não conseguiu escrever (ou a pasta nem abriu): para de gravar e avisa uma vez. */
  fail(): void {
    if (this.failed) return
    this.failed = true
    this.stopRecorder()
    this.deps.onFailure()
  }

  /** Desiste sem aviso (a opção foi desligada antes de o main abrir o arquivo): nada mais é enviado. */
  cancel(): void {
    this.closed = true
    this.stopRecorder()
  }

  /** Para o gravador, espera o último pedaço (até 5 s) e todos os pedaços já pedidos ao main. */
  async stop(): Promise<boolean> {
    const { recorder } = this.deps
    if (recorder.state !== 'inactive') {
      let timer: ReturnType<typeof setTimeout> | undefined
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        timer = setTimeout(resolve, this.deps.stopWaitMs ?? AUDIO_STOP_WAIT_MS)
      })
      this.stopRecorder()
      await stopped
      clearTimeout(timer)
    }
    // Pedaço que chegue depois disso já não tem arquivo para ir.
    this.closed = true
    await this.queue
    return !this.failed
  }

  private stopRecorder(): void {
    if (this.deps.recorder.state === 'inactive') return
    try {
      this.deps.recorder.stop()
    } catch {
      // Já parado.
    }
  }

  private enqueue(blob: Blob): void {
    if (this.failed || this.closed || blob.size === 0) return
    this.queue = this.queue.then(async () => {
      if (this.failed) return
      let ok: boolean
      try {
        ok = await this.deps.writer.append(new Uint8Array(await blob.arrayBuffer()))
      } catch {
        ok = false
      }
      if (!ok) {
        this.fail()
        return
      }
      this.bytes += blob.size
      this.chunks++
    })
  }
}
