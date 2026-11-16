import { describe, expect, it } from 'vitest'
import { CountingFrameSink, FRAME_BYTES, Framer, toInt16, type AudioFrame, type FrameSink } from '../../src/renderer/src/audio/frames'

class CollectingSink implements FrameSink {
  readonly frames: AudioFrame[] = []
  write(frame: AudioFrame): void {
    this.frames.push(frame)
  }
}

describe('Framer', () => {
  it('emite quadros de 100 ms: cabeçalho de 8 bytes e 3200 bytes de PCM s16le', () => {
    const sink = new CollectingSink()
    const framer = new Framer('mic', sink)
    const samples = new Float32Array(1600)
    samples[0] = 1
    samples[1] = -1
    samples[2] = 0.5
    samples[1599] = -0.5
    framer.push(samples)

    expect(sink.frames).toHaveLength(1)
    const frame = sink.frames[0] as AudioFrame
    expect(frame.bytes.length).toBe(FRAME_BYTES)
    expect(FRAME_BYTES).toBe(3208)
    expect(Array.from(frame.bytes.subarray(0, 8))).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(frame.pcm.length).toBe(3200)
    // 0x7fff, -0x8000, round(0.5 * 0x7fff) = 16384 (0x4000), little-endian
    expect(Array.from(frame.bytes.subarray(8, 14))).toEqual([0xff, 0x7f, 0x00, 0x80, 0x00, 0x40])
    // -0.5 * 0x8000 = -16384 = 0xC000
    expect(Array.from(frame.bytes.subarray(3206, 3208))).toEqual([0x00, 0xc0])
  })

  it('fonte do sistema é 1 e o seq cresce de 1 em 1, em big-endian', () => {
    const sink = new CollectingSink()
    const framer = new Framer('system', sink)
    framer.push(new Float32Array(1600 * 257 + 800))
    expect(sink.frames).toHaveLength(257)
    expect(sink.frames.map((f) => f.seq).slice(0, 3)).toEqual([0, 1, 2])
    const seqBytes = (f: AudioFrame): number[] => Array.from(f.bytes.subarray(1, 8))
    expect(seqBytes(sink.frames[1] as AudioFrame)).toEqual([1, 0, 0, 0, 1, 0, 0])
    expect(seqBytes(sink.frames[256] as AudioFrame)).toEqual([1, 0, 0, 1, 0, 0, 0])
    expect(framer.nextSeq).toBe(257)
  })

  it('junta blocos de tamanhos variados sem perder nem repetir amostras', () => {
    const sink = new CollectingSink()
    const framer = new Framer('mic', sink)
    const ramp = Float32Array.from({ length: 4000 }, (_, i) => (i % 1000) / 1000)
    framer.push(ramp.subarray(0, 333))
    framer.push(ramp.subarray(333, 2900))
    framer.push(ramp.subarray(2900))
    expect(sink.frames).toHaveLength(2)
    const second = new DataView((sink.frames[1] as AudioFrame).bytes.buffer)
    expect(second.getInt16(8, true)).toBe(toInt16((1600 % 1000) / 1000))
  })

  it('CountingFrameSink só conta por fonte', () => {
    const sink = new CountingFrameSink()
    new Framer('mic', sink).push(new Float32Array(3200))
    new Framer('system', sink).push(new Float32Array(1600))
    expect(sink.counts).toEqual({ mic: 2, system: 1 })
  })
})
