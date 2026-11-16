import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeImage } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBrandName, applyDockIcon, type DockIconTarget } from '../src/main/branding/apply'
import { BRANDING_DIR, createBrandingService, imageHeaderSize, preparedLogo, type BrandImage, type ImageLoader } from '../src/main/branding/service'
import { createFileSettingsStore } from '../src/main/settings/store'
import { BRAND_LOGO_PATTERN, brandTexts, DEFAULT_BRAND_NAME, DEFAULT_BRAND_SUBTITLE } from '../src/shared/branding'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Cabeçalho de PNG com largura e altura no IHDR: o bastante para o `nativeImage` falso. */
function pngBytes(width: number, height: number, padding = 0): Buffer {
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  return Buffer.concat([PNG_SIGNATURE, ihdr, Buffer.alloc(padding)])
}

/** JPEG mínimo: SOI, APP0 (JFIF) e um SOF0 de 300×200, o que basta para ler o tamanho no cabeçalho. */
function jpegBytes(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}

const JPEG_BYTES = jpegBytes(300, 200)

/** `nativeImage` falso: lê o tamanho do IHDR (JPEG vale 300×200); qualquer outra coisa vem vazia. */
function fakeImage(width: number, height: number, resized: { width?: number; height?: number }[]): BrandImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (options) => {
      resized.push({ ...(options.width ? { width: options.width } : {}), ...(options.height ? { height: options.height } : {}) })
      const w = options.width ?? Math.round((width * (options.height ?? height)) / height)
      const h = options.height ?? Math.round((height * (options.width ?? width)) / width)
      return fakeImage(w, h, resized)
    },
    toPNG: () => pngBytes(width, height),
  }
}

function fakeLoader(resized: { width?: number; height?: number }[] = [], forceEmpty = false): ImageLoader {
  return {
    fromPath: (path) => {
      const bytes = readFileSync(path)
      if (forceEmpty) return fakeImage(0, 0, resized)
      if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return fakeImage(bytes.readUInt32BE(16), bytes.readUInt32BE(20), resized)
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return fakeImage(300, 200, resized)
      return fakeImage(0, 0, resized)
    },
  }
}

describe('logo próprio (contrato 09, CA3 e CA4)', () => {
  let userData: string
  let files: string
  let chosen: string | null
  const dialog = { chooseImage: vi.fn(() => Promise.resolve(chosen)) }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'branding-user-'))
    files = mkdtempSync(join(tmpdir(), 'branding-files-'))
    chosen = null
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  const file = (name: string, content: Buffer | string): string => {
    const path = join(files, name)
    writeFileSync(path, content)
    return path
  }
  const brandingFiles = (): string[] => {
    try {
      return readdirSync(join(userData, BRANDING_DIR)).sort()
    } catch {
      return []
    }
  }
  const setup = (images: ImageLoader = fakeLoader()) => {
    const settings = createFileSettingsStore({ dir: userData })
    return { settings, branding: createBrandingService({ settings, userData, dialog, images }) }
  }

  it('sem logo: nome e subtítulo padrão, sem data URL', async () => {
    const { branding } = setup()
    expect(await branding.get()).toEqual({ name: DEFAULT_BRAND_NAME, subtitle: DEFAULT_BRAND_SUBTITLE, logoDataUrl: null })
    expect(await branding.logoPath()).toBeNull()
  })

  it('cancelar o diálogo não muda nada', async () => {
    const { branding } = setup()
    chosen = null
    const result = await branding.chooseLogo()
    expect(result.result).toBe('canceled')
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(brandingFiles()).toEqual([])
  })

  it('PNG grande: reduzido a 512 px no lado maior, copiado como logo-<hash>.png, só o nome nas configurações', async () => {
    const resized: { width?: number; height?: number }[] = []
    const { branding, settings } = setup(fakeLoader(resized))
    chosen = file('marca.png', pngBytes(1000, 500))
    const result = await branding.chooseLogo()
    expect(result.result).toBe('chosen')
    expect(resized).toEqual([{ width: 512 }])
    const name = (await settings.get()).brandLogo
    expect(name).toMatch(BRAND_LOGO_PATTERN)
    expect(brandingFiles()).toEqual([name])
    const saved = readFileSync(join(userData, BRANDING_DIR, name ?? ''))
    expect(saved.readUInt32BE(16)).toBe(512)
    expect(saved.readUInt32BE(20)).toBe(256)
    // CA4: o renderer recebe a data URL PNG, nunca um caminho.
    expect(result.branding.logoDataUrl).toBe(`data:image/png;base64,${saved.toString('base64')}`)
    expect(JSON.stringify(result.branding)).not.toContain(userData)
    expect(JSON.stringify(result.branding)).not.toContain(files)
    expect(await branding.get()).toEqual(result.branding)
  })

  it('imagem alta é reduzida pela altura; pequena fica como está; JPG vira PNG', async () => {
    const resized: { width?: number; height?: number }[] = []
    const { branding, settings } = setup(fakeLoader(resized))
    chosen = file('alto.png', pngBytes(300, 900))
    await branding.chooseLogo()
    expect(resized).toEqual([{ height: 512 }])
    chosen = file('foto.JPG', JPEG_BYTES)
    expect((await branding.chooseLogo()).result).toBe('chosen')
    expect(resized).toHaveLength(1)
    const name = (await settings.get()).brandLogo ?? ''
    expect(readFileSync(join(userData, BRANDING_DIR, name)).subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  })

  it('trocar o logo apaga o anterior', async () => {
    const { branding, settings } = setup()
    chosen = file('a.png', pngBytes(64, 64))
    await branding.chooseLogo()
    const first = (await settings.get()).brandLogo
    chosen = file('b.png', pngBytes(128, 64))
    await branding.chooseLogo()
    const second = (await settings.get()).brandLogo
    expect(second).not.toBe(first)
    expect(brandingFiles()).toEqual([second])
  })

  it.each([
    ['SVG', 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['SVG renomeado para .png', 'logo.png', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['GIF', 'logo.gif', 'GIF89a'],
    ['sem extensão', 'logo', pngBytes(64, 64)],
    ['acima de 2 MB', 'grande.png', pngBytes(64, 64, 2 * 1024 * 1024)],
    ['arquivo vazio', 'vazio.png', ''],
    ['PNG com 20 000 px de lado (bomba de descompressão)', 'bomba.png', pngBytes(20_000, 20_000)],
    ['JPEG com 10 000 px de lado', 'bomba.jpg', jpegBytes(10_000, 300)],
    ['JPEG sem SOF', 'sem-sof.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])],
  ])('inválida (%s): mensagem e nada muda', async (_label, name, content) => {
    const { branding, settings } = setup()
    chosen = file('antes.png', pngBytes(64, 64))
    await branding.chooseLogo()
    const before = await settings.get()
    const filesBefore = brandingFiles()
    chosen = file(name, content)
    const result = await branding.chooseLogo()
    expect(result.result).toBe('invalid')
    expect(await settings.get()).toEqual(before)
    expect(brandingFiles()).toEqual(filesBefore)
  })

  it('pasta, arquivo inexistente e imagem que o nativeImage não lê são recusados', async () => {
    mkdirSync(join(files, 'pasta.png'))
    expect(await preparedLogo(join(files, 'pasta.png'), fakeLoader())).toBeNull()
    expect(await preparedLogo(join(files, 'nao-existe.png'), fakeLoader())).toBeNull()
    expect(await preparedLogo(file('ok.png', pngBytes(10, 10)), fakeLoader([], true))).toBeNull()
    expect(await preparedLogo(file('ok2.png', pngBytes(10, 10)), fakeLoader())).not.toBeNull()
  })

  it('"Usar o logo da LAP" apaga o arquivo e volta brandLogo a null', async () => {
    const { branding, settings } = setup()
    chosen = file('a.png', pngBytes(64, 64))
    await branding.chooseLogo()
    const result = await branding.resetLogo()
    expect(result.settings.brandLogo).toBeNull()
    expect(result.branding.logoDataUrl).toBeNull()
    expect((await settings.get()).brandLogo).toBeNull()
    expect(brandingFiles()).toEqual([])
  })

  it('logo gravado que sumiu da pasta: sem data URL, sem caminho', async () => {
    const { branding, settings } = setup()
    await settings.setBrandLogo('logo-0123456789ab.png')
    expect((await branding.get()).logoDataUrl).toBeNull()
    expect(await branding.logoPath()).toBeNull()
  })
})

describe('nome da marca (contrato 09, CA1 e CA5)', () => {
  it('padrões e subtítulo vazio', () => {
    expect(brandTexts({ brandName: null, brandSubtitle: null })).toEqual({ name: 'LAP Reuniões', subtitle: 'LAP Software' })
    expect(brandTexts({ brandName: 'Atas', brandSubtitle: '' })).toEqual({ name: 'Atas', subtitle: '' })
  })

  it('título das janelas e painel "Sobre" com o nome escolhido', () => {
    const setAboutPanelOptions = vi.fn()
    const windows = [{ setTitle: vi.fn() }, { setTitle: vi.fn() }]
    applyBrandName({ setAboutPanelOptions, windows, version: '0.1.0' }, 'Atas da Diretoria')
    expect(setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: 'Atas da Diretoria', applicationVersion: '0.1.0', copyright: '© 2026 LAP Software & Consultoria' })
    for (const win of windows) expect(win.setTitle).toHaveBeenCalledWith('Atas da Diretoria')
  })

  it('o userData não depende do nome escolhido: app.setName fica com o nome fixo do pacote', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    expect(source).toMatch(/^const APP_NAME = 'Meeting Scribe'$/m)
    // Um único `setName`, com a constante; nenhum `setPath('userData')` fora do smoke (smoke.ts).
    expect(source.match(/\bsetName\(/g)).toHaveLength(1)
    expect(source).toContain('app.setName(APP_NAME)')
    expect(source).not.toMatch(/setPath\(\s*'userData'/)
    // O nome da marca nunca chega a `setName` nem a `getPath`.
    expect(source).not.toMatch(/setName\([^)]*brand/i)
  })
})

describe('ícone do Dock (contrato 09, CA6)', () => {
  const image = (empty: boolean, tag: string): NativeImage => ({ isEmpty: () => empty, tag }) as unknown as NativeImage
  const target = (platform: NodeJS.Platform, emptyLogo = false): DockIconTarget & { setIcon: ReturnType<typeof vi.fn> } => {
    const setIcon = vi.fn()
    return {
      platform,
      dock: { setIcon },
      load: (path) => (path === '/pacote/icon.png' ? image(false, 'pacote') : image(emptyLogo, 'logo')),
      defaultIcon: '/pacote/icon.png',
      setIcon,
    }
  }

  it('com logo próprio, o Dock mostra o logo', () => {
    const t = target('darwin')
    expect(applyDockIcon(t, '/dados/branding/logo-deadbeef.png')).toBe('custom')
    expect(t.setIcon).toHaveBeenCalledWith(expect.objectContaining({ tag: 'logo' }))
  })

  it('voltando ao padrão, restaura o ícone do pacote', () => {
    const t = target('darwin')
    expect(applyDockIcon(t, null)).toBe('default')
    expect(t.setIcon).toHaveBeenCalledWith(expect.objectContaining({ tag: 'pacote' }))
  })

  it('logo que não carrega cai no ícone do pacote', () => {
    const t = target('darwin', true)
    expect(applyDockIcon(t, '/dados/branding/logo-deadbeef.png')).toBe('default')
    expect(t.setIcon).toHaveBeenCalledWith(expect.objectContaining({ tag: 'pacote' }))
  })

  it.each(['linux', 'win32'] as const)('fora do macOS (%s), nada', (platform) => {
    const t = target(platform)
    expect(applyDockIcon(t, '/dados/branding/logo-deadbeef.png')).toBe('skipped')
    expect(t.setIcon).not.toHaveBeenCalled()
  })

  it('sem Dock, nada', () => {
    expect(applyDockIcon({ ...target('darwin'), dock: undefined }, null)).toBe('skipped')
  })
})

describe('imageHeaderSize (tamanho lido antes de decodificar)', () => {
  it('lê PNG pelo IHDR e JPEG pelo SOF; outra coisa é null', () => {
    expect(imageHeaderSize(pngBytes(640, 400))).toEqual({ width: 640, height: 400 })
    expect(imageHeaderSize(jpegBytes(300, 200))).toEqual({ width: 300, height: 200 })
    expect(imageHeaderSize(Buffer.from('<svg/>'))).toBeNull()
  })
})
