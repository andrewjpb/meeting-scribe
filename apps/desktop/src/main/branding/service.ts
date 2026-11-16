// Logo próprio do app (contrato 09). Só o main escolhe a imagem (diálogo nativo), confere, converte para
// PNG de até 512 px e guarda em `userData/branding/logo-<hash>.png`; nas configurações fica só o nome do
// arquivo. O renderer recebe o logo como data URL, nunca um caminho. Sem Electron: o diálogo e o
// `nativeImage` chegam injetados (o app usa os do Electron; os testes e o smoke, substitutos).
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_LOGO_MAX_SIDE,
  BRAND_LOGO_PATTERN,
  brandTexts,
  type BrandingInfo,
  type BrandLogoChoice,
} from '../../shared/branding'
import type { AppSettings } from '../../shared/settings-defaults'
import type { SettingsStore } from '../settings/store'

/** Pasta do logo, dentro do `userData`. */
export const BRANDING_DIR = 'branding'
/** Extensões aceitas; SVG fica de fora (pode carregar script). */
export const BRAND_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const

export interface ImageDialog {
  /** Diálogo nativo de abrir um arquivo (`openFile`, filtros PNG e JPG); `null` se cancelado. */
  chooseImage(): Promise<string | null>
}

/** O pedaço do `NativeImage` do Electron que o serviço usa. */
export interface BrandImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): BrandImage
  toPNG(): Buffer
}

export interface ImageLoader {
  /** Como `nativeImage.createFromPath`: imagem vazia quando o arquivo não é uma imagem que ele lê. */
  fromPath(path: string): BrandImage
}

export interface BrandingDeps {
  settings: Pick<SettingsStore, 'get' | 'setBrandLogo'>
  /** `userData`; o logo fica em `<userData>/branding/`. */
  userData: string
  dialog: ImageDialog
  images: ImageLoader
}

export interface BrandingService {
  get(): Promise<BrandingInfo>
  /** "Escolher imagem…": inválida não muda nada. */
  chooseLogo(): Promise<{ result: BrandLogoChoice; branding: BrandingInfo; settings: AppSettings }>
  /** "Usar o logo da LAP": apaga o arquivo e volta ao símbolo. */
  resetLogo(): Promise<{ branding: BrandingInfo; settings: AppSettings }>
  /** Caminho do logo em uso (para o ícone do Dock); só o main usa. */
  logoPath(): Promise<string | null>
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

async function readHead(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Lado máximo aceito antes de decodificar: um PNG pequeno e muito comprimido não estoura a memória do main. */
export const BRAND_LOGO_MAX_DECODE_SIDE = 8_192

/** Largura e altura lidas do cabeçalho (PNG: IHDR; JPEG: primeiro SOF), sem decodificar a imagem. */
export function imageHeaderSize(head: Buffer): { width: number; height: number } | null {
  if (head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    if (head.length < 24) return null
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  }
  if (!head.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return null
  let offset = 2
  while (offset + 9 < head.length) {
    if (head[offset] !== 0xff) return null
    const marker = head[offset + 1] as number
    if (marker === 0xff) {
      offset += 1
      continue
    }
    const length = head.readUInt16BE(offset + 2)
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: head.readUInt16BE(offset + 7), height: head.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return null
}

/** O arquivo começa como PNG ou JPEG de verdade (um SVG renomeado para `.png` não passa). */
function hasImageSignature(head: Buffer): boolean {
  return head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) || head.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
}

/**
 * Lê e confere a imagem escolhida: arquivo comum, PNG ou JPG pela extensão e pelos primeiros bytes, até
 * 2 MB e não vazia para o `nativeImage`. Devolve o PNG já reduzido a 512 px no lado maior, ou `null`.
 */
export async function preparedLogo(path: string, images: ImageLoader): Promise<Buffer | null> {
  const extension = extname(path).slice(1).toLowerCase()
  if (!(BRAND_LOGO_EXTENSIONS as readonly string[]).includes(extension)) return null
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0 || info.size > BRAND_LOGO_MAX_BYTES) return null
    const head = await readHead(path, 128 * 1024)
    if (!hasImageSignature(head)) return null
    const size = imageHeaderSize(head)
    if (!size || size.width <= 0 || size.height <= 0 || Math.max(size.width, size.height) > BRAND_LOGO_MAX_DECODE_SIDE) return null
  } catch {
    return null
  }
  let image = images.fromPath(path)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return null
  if (Math.max(width, height) > BRAND_LOGO_MAX_SIDE) {
    image = width >= height ? image.resize({ width: BRAND_LOGO_MAX_SIDE, quality: 'best' }) : image.resize({ height: BRAND_LOGO_MAX_SIDE, quality: 'best' })
    if (image.isEmpty()) return null
  }
  const png = image.toPNG()
  return png.length > 0 ? png : null
}

/** `logo-<12 primeiros hex do sha256>.png`. */
export function logoFileName(png: Buffer): string {
  return `logo-${createHash('sha256').update(png).digest('hex').slice(0, 12)}.png`
}

export function createBrandingService({ settings, userData, dialog, images }: BrandingDeps): BrandingService {
  const dir = join(userData, BRANDING_DIR)

  /** Caminho do logo gravado, só se o nome bater com o formato e o arquivo existir. */
  async function currentLogoPath(current: AppSettings): Promise<string | null> {
    const name = current.brandLogo
    if (!name || !BRAND_LOGO_PATTERN.test(name)) return null
    const path = join(dir, name)
    try {
      return (await stat(path)).isFile() ? path : null
    } catch {
      return null
    }
  }

  async function info(current: AppSettings): Promise<BrandingInfo> {
    const { name, subtitle } = brandTexts(current)
    const path = await currentLogoPath(current)
    let logoDataUrl: string | null = null
    if (path) {
      try {
        const png = await readFile(path)
        if (png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) logoDataUrl = `data:image/png;base64,${png.toString('base64')}`
      } catch {
        logoDataUrl = null
      }
    }
    return { name, subtitle, logoDataUrl }
  }

  /** Apaga um logo antigo (nome no formato, dentro de `branding/`). */
  async function removeLogo(name: string | null): Promise<void> {
    if (!name || !BRAND_LOGO_PATTERN.test(name)) return
    await rm(join(dir, name), { force: true }).catch(() => undefined)
  }

  return {
    get: async () => info(await settings.get()),

    async chooseLogo() {
      const path = await dialog.chooseImage()
      const before = await settings.get()
      if (path === null) return { result: 'canceled', branding: await info(before), settings: before }
      const png = await preparedLogo(path, images)
      if (!png) return { result: 'invalid', branding: await info(before), settings: before }
      const name = logoFileName(png)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const temp = join(dir, `.tmp-${process.pid}-${randomUUID()}`)
      await writeFile(temp, png, { mode: 0o600 })
      await rename(temp, join(dir, name))
      const saved = await settings.setBrandLogo(name)
      if (before.brandLogo !== name) await removeLogo(before.brandLogo)
      return { result: 'chosen', branding: await info(saved), settings: saved }
    },

    async resetLogo() {
      const before = await settings.get()
      const saved = before.brandLogo === null ? before : await settings.setBrandLogo(null)
      await removeLogo(before.brandLogo)
      return { branding: await info(saved), settings: saved }
    },

    logoPath: async () => currentLogoPath(await settings.get()),
  }
}
