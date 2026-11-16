import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ protocol: {} }))

const { mimeOf, resolveAssetPath } = await import('../src/main/protocol')

const ROOT = '/app/out/renderer'

describe('resolveAssetPath', () => {
  it('serve index.html na raiz e arquivos dentro da pasta', () => {
    expect(resolveAssetPath('scribe://app/', ROOT)).toBe('/app/out/renderer/index.html')
    expect(resolveAssetPath('scribe://app/index.html?theme=dark', ROOT)).toBe('/app/out/renderer/index.html')
    expect(resolveAssetPath('scribe://app/assets/index-abc.js', ROOT)).toBe('/app/out/renderer/assets/index-abc.js')
  })

  it('o parser de URL já resolve `..` na raiz, então o caminho continua dentro da pasta', () => {
    expect(resolveAssetPath('scribe://app/../../etc/passwd', ROOT)).toBe('/app/out/renderer/etc/passwd')
    expect(resolveAssetPath('scribe://app/%2e%2e/%2e%2e/etc/passwd', ROOT)).toBe('/app/out/renderer/etc/passwd')
  })

  it.each([
    'scribe://app/assets/..%2f..%2f..%2fsegredo',
    'scribe://app/a%5c..%5c..%5cb',
    'scribe://app/%00',
    'scribe://outro/index.html',
    'https://app/index.html',
    'lixo',
  ])('recusa %s', (url) => {
    expect(resolveAssetPath(url, ROOT)).toBeNull()
  })
})

describe('mimeOf', () => {
  it('dá o tipo certo para módulo, folha de estilo e fonte', () => {
    expect(mimeOf('a.js')).toMatch(/^text\/javascript/)
    expect(mimeOf('a.css')).toMatch(/^text\/css/)
    expect(mimeOf('a.woff2')).toBe('font/woff2')
    expect(mimeOf('a.desconhecido')).toBe('application/octet-stream')
  })
})
