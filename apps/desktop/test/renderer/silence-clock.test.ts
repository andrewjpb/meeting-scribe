import { describe, expect, it } from 'vitest'
import { formatElapsed, RecordingClock } from '../../src/renderer/src/audio/clock'
import { SilenceDetector, type SilenceState } from '../../src/renderer/src/audio/silence'

describe('SilenceDetector', () => {
  it('zero absoluto por 3000 ms vira silent; som volta para ok; trilha encerrada vira ended', () => {
    let now = 0
    const changes: SilenceState[] = []
    const detector = new SilenceDetector(() => now, (state) => changes.push(state))

    for (now = 0; now < 3000; now += 100) detector.update(false)
    expect(detector.state).toBe('ok')
    now = 3000
    detector.update(false)
    expect(detector.state).toBe('silent')

    now = 3100
    detector.update(true)
    expect(detector.state).toBe('ok')

    now = 5000
    detector.tick()
    expect(detector.state).toBe('ok')
    now = 6100
    detector.tick()
    expect(detector.state).toBe('silent')

    detector.end()
    expect(detector.state).toBe('ended')
    detector.update(true)
    expect(detector.state).toBe('ended')
    expect(changes).toEqual(['silent', 'ok', 'silent', 'ended'])
  })

  it('som de vez em quando nunca deixa cair em silent', () => {
    let now = 0
    const detector = new SilenceDetector(() => now)
    for (now = 0; now < 20_000; now += 100) detector.update(now % 2900 === 0)
    expect(detector.state).toBe('ok')
  })
})

describe('RecordingClock', () => {
  it('10 s gravando, 5 s pausado e 4 s gravando dão 14000 ms', () => {
    let now = 1_000
    const clock = new RecordingClock(() => now)
    clock.start()
    now += 10_000
    expect(clock.elapsedMs).toBe(10_000)
    clock.pause()
    now += 5_000
    expect(clock.elapsedMs).toBe(10_000)
    clock.resume()
    now += 4_000
    expect(clock.elapsedMs).toBe(14_000)
    expect(clock.stop()).toBe(14_000)
    now += 1_000
    expect(clock.elapsedMs).toBe(14_000)
  })

  it('pausar ou retomar duas vezes não muda a conta', () => {
    let now = 0
    const clock = new RecordingClock(() => now)
    clock.start()
    now = 1000
    clock.pause()
    clock.pause()
    now = 2000
    clock.resume()
    clock.resume()
    now = 2500
    expect(clock.elapsedMs).toBe(1500)
  })

  it('formata o cronômetro', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(42_900)).toBe('00:42')
    expect(formatElapsed(725_000)).toBe('12:05')
    expect(formatElapsed(3_729_000)).toBe('1:02:09')
  })
})
