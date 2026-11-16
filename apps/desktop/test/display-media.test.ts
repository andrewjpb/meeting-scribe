import { describe, expect, it } from 'vitest'
import { decideDisplayMedia } from '../src/main/capture/display-media'
import { APP_ORIGIN } from '../src/main/security'

describe('decideDisplayMedia', () => {
  it('só áudio, da própria origem: áudio do sistema pela saída loopback', () => {
    expect(decideDisplayMedia({ videoRequested: false, audioRequested: true, origin: APP_ORIGIN }, APP_ORIGIN)).toEqual({ audio: 'loopback' })
  })

  it.each([
    { videoRequested: true, audioRequested: true, origin: APP_ORIGIN },
    { videoRequested: true, audioRequested: false, origin: APP_ORIGIN },
    { videoRequested: false, audioRequested: false, origin: APP_ORIGIN },
    { videoRequested: false, audioRequested: true, origin: 'https://evil.example' },
    { videoRequested: false, audioRequested: true, origin: 'scribe://outro' },
    { videoRequested: false, audioRequested: true, origin: 'file://' },
    { videoRequested: false, audioRequested: true, origin: null },
  ])('nega video=$videoRequested audio=$audioRequested de $origin', (query) => {
    expect(decideDisplayMedia(query, APP_ORIGIN)).toBeNull()
  })

  it('compara com a origem passada (servidor do Vite em desenvolvimento)', () => {
    const dev = 'http://localhost:5173'
    expect(decideDisplayMedia({ videoRequested: false, audioRequested: true, origin: dev }, dev)).toEqual({ audio: 'loopback' })
    expect(decideDisplayMedia({ videoRequested: false, audioRequested: true, origin: APP_ORIGIN }, dev)).toBeNull()
  })
})
