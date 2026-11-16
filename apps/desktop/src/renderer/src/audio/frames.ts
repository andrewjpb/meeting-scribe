// Quadros de áudio no formato da spec de produto (seção 8.2): cabeçalho de 8 bytes + 100 ms de PCM
// s16le 16 kHz mono. Byte 0 versão (1); byte 1 fonte (0 microfone, 1 sistema); bytes 2–5 `seq`
// uint32 big-endian por fonte, começando em 0; bytes 6–7 reservados em zero.

export type AudioSource = 'mic' | 'system'

export const FRAME_VERSION = 1
export const FRAME_HEADER_BYTES = 8
export const FRAME_SAMPLES = 1600
export const FRAME_PAYLOAD_BYTES = FRAME_SAMPLES * 2
export const FRAME_BYTES = FRAME_HEADER_BYTES + FRAME_PAYLOAD_BYTES

const SOURCE_BYTE: Record<AudioSource, number> = { mic: 0, system: 1 }

export interface AudioFrame {
  source: AudioSource
  seq: number
  /** Quadro inteiro, cabeçalho incluído (`FRAME_BYTES`). */
  bytes: Uint8Array
  /** Só o PCM, sem o cabeçalho (vista sobre `bytes`). */
  pcm: Uint8Array
}

/** Destino dos quadros. Nesta versão só conta; o envio para a transcrição entra depois. */
export interface FrameSink {
  write(frame: AudioFrame): void
}

export class CountingFrameSink implements FrameSink {
  readonly counts: Record<AudioSource, number> = { mic: 0, system: 0 }

  write(frame: AudioFrame): void {
    this.counts[frame.source]++
  }
}

export function toInt16(sample: number): number {
  const x = sample > 1 ? 1 : sample < -1 ? -1 : sample
  return Math.round(x < 0 ? x * 0x8000 : x * 0x7fff)
}

/** Junta amostras a 16 kHz e emite um quadro a cada 1600. O `seq` nunca reinicia na mesma gravação. */
export class Framer {
  private readonly pending = new Float32Array(FRAME_SAMPLES)
  private filled = 0
  private seq = 0

  constructor(
    private readonly source: AudioSource,
    private readonly sink: FrameSink,
  ) {}

  push(samples: Float32Array): void {
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(FRAME_SAMPLES - this.filled, samples.length - offset)
      this.pending.set(samples.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === FRAME_SAMPLES) this.emit()
    }
  }

  get nextSeq(): number {
    return this.seq
  }

  private emit(): void {
    const bytes = new Uint8Array(FRAME_BYTES)
    const view = new DataView(bytes.buffer)
    view.setUint8(0, FRAME_VERSION)
    view.setUint8(1, SOURCE_BYTE[this.source])
    view.setUint32(2, this.seq, false)
    // bytes 6 e 7 já nascem em zero
    for (let i = 0; i < FRAME_SAMPLES; i++) view.setInt16(FRAME_HEADER_BYTES + i * 2, toInt16(this.pending[i] as number), true)
    this.sink.write({ source: this.source, seq: this.seq, bytes, pcm: bytes.subarray(FRAME_HEADER_BYTES) })
    this.seq = (this.seq + 1) >>> 0
    this.filled = 0
  }
}
