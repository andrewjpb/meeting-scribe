// Onde a marca escolhida aparece fora do renderer (contrato 09): título das janelas, painel "Sobre" e
// ícone do Dock. `app.setName` não entra aqui: ele fixa o `userData` e o Chaveiro e continua com o nome
// do pacote (`main/index.ts`). Sem Electron: app, janelas e Dock chegam injetados (test/branding.test.ts).
import type { AboutPanelOptionsOptions, NativeImage } from 'electron'
import { aboutPanelOptions } from '../menu'

export interface BrandNameTarget {
  setAboutPanelOptions(options: AboutPanelOptionsOptions): void
  windows: readonly { setTitle(title: string): void }[]
  version: string
}

/** Título de cada janela e painel "Sobre" com o nome escolhido. */
export function applyBrandName(target: BrandNameTarget, name: string): void {
  target.setAboutPanelOptions(aboutPanelOptions(name, target.version))
  for (const win of target.windows) win.setTitle(name)
}

export interface DockIconTarget {
  platform: NodeJS.Platform
  /** `app.dock` (só existe no macOS). */
  dock: { setIcon(image: NativeImage): void } | undefined
  /** Como `nativeImage.createFromPath`. */
  load(path: string): NativeImage
  /** Ícone do pacote: `resources/brand/icon.png`. */
  defaultIcon: string
}

/**
 * Logo próprio no Dock, ou o ícone do pacote de volta. Fora do macOS, nada. Logo que não carrega cai no
 * ícone do pacote.
 */
export function applyDockIcon(target: DockIconTarget, logoPath: string | null): 'custom' | 'default' | 'skipped' {
  if (target.platform !== 'darwin' || !target.dock) return 'skipped'
  if (logoPath) {
    const image = target.load(logoPath)
    if (!image.isEmpty()) {
      target.dock.setIcon(image)
      return 'custom'
    }
  }
  const fallback = target.load(target.defaultIcon)
  if (fallback.isEmpty()) return 'skipped'
  target.dock.setIcon(fallback)
  return 'default'
}
