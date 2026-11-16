import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, buildCsp, decideNavigation, decidePermission, decidePermissionCheck, decideWindowOpen, originOf } from '../src/main/security'

describe('originOf', () => {
  it('monta a origem de esquema próprio que o URL do Node devolve como "null"', () => {
    expect(originOf('scribe://app/index.html?theme=dark')).toBe('scribe://app')
    expect(originOf('https://openrouter.ai/api/v1/models')).toBe('https://openrouter.ai')
    expect(originOf('http://localhost:5173/src/main.tsx')).toBe('http://localhost:5173')
  })

  it('devolve null para URL inválida ou sem host', () => {
    expect(originOf('não é url')).toBeNull()
    expect(originOf('about:blank')).toBeNull()
    expect(originOf('')).toBeNull()
  })
})

describe('decidePermission', () => {
  const allow = [
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['audio'] },
    { permission: 'display-capture', origin: APP_ORIGIN, mediaTypes: [] },
  ]
  const deny = [
    // vídeo, sozinho ou junto com áudio
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['video'] },
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['audio', 'video'] },
    // media sem tipo declarado
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: [] },
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['unknown'] },
    // outra origem
    { permission: 'media', origin: 'https://evil.example', mediaTypes: ['audio'] },
    { permission: 'display-capture', origin: 'https://evil.example', mediaTypes: [] },
    { permission: 'display-capture', origin: 'scribe://outro', mediaTypes: [] },
    { permission: 'media', origin: null, mediaTypes: ['audio'] },
    { permission: 'display-capture', origin: 'file://', mediaTypes: [] },
    // outras permissões, mesmo na própria origem
    { permission: 'notifications', origin: APP_ORIGIN, mediaTypes: [] },
    { permission: 'geolocation', origin: APP_ORIGIN, mediaTypes: [] },
    { permission: 'clipboard-read', origin: APP_ORIGIN, mediaTypes: [] },
    { permission: 'openExternal', origin: APP_ORIGIN, mediaTypes: [] },
  ]

  it.each(allow)('concede $permission $mediaTypes para a própria origem', (query) => {
    expect(decidePermission(query, APP_ORIGIN)).toBe(true)
  })

  it.each(deny)('nega $permission $mediaTypes de $origin', (query) => {
    expect(decidePermission(query, APP_ORIGIN)).toBe(false)
  })

  it('compara com a origem passada, não com uma fixa', () => {
    const dev = 'http://localhost:5173'
    expect(decidePermission({ permission: 'media', origin: dev, mediaTypes: ['audio'] }, dev)).toBe(true)
    expect(decidePermission({ permission: 'media', origin: APP_ORIGIN, mediaTypes: ['audio'] }, dev)).toBe(false)
  })
})

describe('decidePermissionCheck', () => {
  it('aceita media com mediaType unknown da própria origem (enumerateDevices e rótulos)', () => {
    expect(decidePermissionCheck({ permission: 'media', origin: APP_ORIGIN, mediaTypes: ['unknown'] }, APP_ORIGIN)).toBe(true)
  })

  it('continua aceitando o que o pedido aceita', () => {
    expect(decidePermissionCheck({ permission: 'media', origin: APP_ORIGIN, mediaTypes: ['audio'] }, APP_ORIGIN)).toBe(true)
    expect(decidePermissionCheck({ permission: 'display-capture', origin: APP_ORIGIN, mediaTypes: [] }, APP_ORIGIN)).toBe(true)
  })

  it.each([
    { permission: 'media', origin: 'https://evil.example', mediaTypes: ['unknown'] },
    { permission: 'media', origin: 'scribe://outro', mediaTypes: ['unknown'] },
    { permission: 'media', origin: null, mediaTypes: ['unknown'] },
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['video'] },
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: ['unknown', 'video'] },
    { permission: 'media', origin: APP_ORIGIN, mediaTypes: [] },
    { permission: 'notifications', origin: APP_ORIGIN, mediaTypes: ['unknown'] },
  ])('nega $permission $mediaTypes de $origin', (query) => {
    expect(decidePermissionCheck(query, APP_ORIGIN)).toBe(false)
  })

  it('não afrouxa o pedido: decidePermission segue negando unknown', () => {
    expect(decidePermission({ permission: 'media', origin: APP_ORIGIN, mediaTypes: ['unknown'] }, APP_ORIGIN)).toBe(false)
  })
})

describe('decideNavigation', () => {
  it('permite a própria origem', () => {
    expect(decideNavigation('scribe://app/index.html', APP_ORIGIN)).toBe('allow')
    expect(decideNavigation('scribe://app/index.html?theme=dark#x', APP_ORIGIN)).toBe('allow')
  })

  it.each([
    'https://example.com/',
    'http://app/',
    'scribe://outro/index.html',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<p>oi</p>',
    'about:blank',
    'x-apple.systempreferences:com.apple.preference.security',
    'lixo',
  ])('nega %s', (url) => {
    expect(decideNavigation(url, APP_ORIGIN)).toBe('deny')
  })
})

describe('decideWindowOpen', () => {
  it.each(['https://example.com/', 'scribe://app/index.html', 'about:blank'])('nega janela nova para %s', (url) => {
    expect(decideWindowOpen(url)).toEqual({ action: 'deny' })
  })
})

describe('buildCsp', () => {
  it('produção: só a própria origem, sem inline nem eval', () => {
    const csp = buildCsp('production')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'none'")
    // A única saída do renderer é a transcrição ao vivo (CA13): nada além de si e do streaming.
    expect(csp).toContain("connect-src 'self' wss://streaming.assemblyai.com")
    expect(csp).toContain("worker-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/https?:/)
  })

  it('desenvolvimento: libera o servidor do Vite e o WebSocket dele', () => {
    const csp = buildCsp('development', 'http://localhost:5173')
    expect(csp).toContain('http://localhost:5173')
    expect(csp).toContain('ws://localhost:5173')
    expect(csp).not.toContain('unsafe-eval')
  })
})
