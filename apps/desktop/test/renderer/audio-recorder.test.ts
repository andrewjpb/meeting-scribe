// Gravador do arquivo da reunião (contrato 07): formato (CA3), pedaços em ordem para o main (CA4),
// pausa e encerrar esperando o último pedaço por até 5 s (CA6). Gravador de mentira, sem `MediaRecorder`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioFileRecorder, type RecorderLike } from '../../src/renderer/src/audio/recorder'
import { AUDIO_STOP_WAIT_MS, AUDIO_TIMESLICE_MS, audioExtension, pickRecorderMime, RECORDER_MIME_TYPES } from '../../src/shared/meeting-files'

class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive'
  ondataavailable: RecorderLike['ondataavailable'] = null
  onstop: RecorderLike['onstop'] = null
  onerror: RecorderLike['onerror'] = null
  timeslice: number | undefined
  calls: string[] = []
  /** Ao parar, entrega o último pedaço e o `stop` depois de tanto tempo (`null`: nunca). */
  stopDelayMs: number | null = 0
  start(timeslice?: number): void {
    this.timeslice = timeslice
    this.state = 'recording'
    this.calls.push('start')
  }
  pause(): void {
    this.state = 'paused'
    this.calls.push('pause')
  }
  resume(): void {
    this.state = 'recording'
    this.calls.push('resume')
  }
  stop(): void {
    this.state = 'inactive'
    this.calls.push('stop')
    if (this.stopDelayMs === null) return
    setTimeout(() => {
      this.emit('fim')
      this.onstop?.()
    }, this.stopDelayMs)
  }
  emit(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) })
  }
}

const decode = (data: Uint8Array): string => new TextDecoder().decode(data)

describe('formato do arquivo (CA3)', () => {
  it('o primeiro que o gravador aceitar, na ordem m4a AAC, m4a, webm Opus', () => {
    expect(RECORDER_MIME_TYPES).toEqual(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'])
    expect(pickRecorderMime(() => true)).toBe('audio/mp4;codecs=mp4a.40.2')
    expect(pickRecorderMime((mime) => mime === 'audio/mp4' || mime.startsWith('audio/webm'))).toBe('audio/mp4')
    expect(pickRecorderMime((mime) => mime.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMime(() => false)).toBeNull()
    expect(
      pickRecorderMime((mime) => {
        if (mime.startsWith('audio/mp4')) throw new Error('não consulta')
        return true
      }),
    ).toBe('audio/webm;codecs=opus')
    expect(audioExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(audioExtension('audio/mp4')).toBe('m4a')
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm')
  })
})

describe('AudioFileRecorder (CA4, CA6)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = (append: (data: Uint8Array) => Promise<boolean> = () => Promise.resolve(true)) => {
    const recorder = new FakeRecorder()
    const written: string[] = []
    const onFailure = vi.fn()
    const file = new AudioFileRecorder({
      recorder,
      writer: {
        append: async (data) => {
          const ok = await append(data)
          if (ok) written.push(decode(data))
          return ok
        },
      },
      onFailure,
    })
    return { recorder, written, onFailure, file }
  }

  it('grava em pedaços de 5 s, em ordem, mesmo com o main respondendo fora de ordem', async () => {
    let calls = 0
    const { recorder, written, file } = setup(
      () => new Promise((resolve) => setTimeout(() => resolve(true), calls++ === 0 ? 30 : 1)),
    )
    file.start()
    expect(recorder.timeslice).toBe(AUDIO_TIMESLICE_MS)
    recorder.emit('a')
    recorder.emit('b')
    recorder.emit('c')
    expect(await file.stop()).toBe(true)
    expect(written).toEqual(['a', 'b', 'c', 'fim'])
    expect(file.chunks).toBe(4)
    expect(file.bytes).toBe(6)
  })

  it('pausar pausa o gravador e retomar continua no mesmo arquivo', async () => {
    const { recorder, written, file } = setup()
    file.start()
    recorder.emit('antes')
    file.pause()
    file.pause()
    file.resume()
    recorder.emit('depois')
    await file.stop()
    expect(recorder.calls).toEqual(['start', 'pause', 'resume', 'stop'])
    expect(written).toEqual(['antes', 'depois', 'fim'])
  })

  it('encerrar espera o último pedaço por até 5 s; o que chegar depois é ignorado', async () => {
    vi.useFakeTimers()
    const { recorder, written, file } = setup()
    recorder.stopDelayMs = null
    file.start()
    recorder.emit('a')
    let done = false
    const stopping = file.stop().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(AUDIO_STOP_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await stopping
    expect(done).toBe(true)
    recorder.emit('tarde')
    await vi.runAllTimersAsync()
    expect(written).toEqual(['a'])
  })

  it('o main não grava: avisa uma vez, para o gravador e não manda mais nada', async () => {
    let answers = [true, false]
    const { recorder, written, onFailure, file } = setup(() => Promise.resolve(answers.shift() ?? true))
    file.start()
    recorder.emit('a')
    recorder.emit('b')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(recorder.state).toBe('inactive')
    recorder.emit('c')
    answers = []
    expect(await file.stop()).toBe(false)
    expect(written).toEqual(['a'])
    expect(file.ok).toBe(false)
    file.fail()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('gravador que nem começa conta como falha', () => {
    const { recorder, onFailure, file } = setup()
    recorder.start = () => {
      throw new Error('formato recusado')
    }
    file.start()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})
