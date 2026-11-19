// Janela principal: barra de título embutida, barra lateral opaca (sem vibrancy) e webPreferences fechadas.
import { join } from 'node:path'
import { BrowserWindow, nativeTheme, type WebPreferences } from 'electron'
import { DEFAULT_BRAND_NAME } from '../shared/branding'
import { guardWebContents } from './security'

export interface MainWindowOptions {
  /** URL inicial do renderer (`scribe://app/index.html` ou o servidor do Vite). */
  url: string
  appOrigin: string
  /** Título da janela: o nome da marca escolhida (contrato 09). */
  title?: string
  /** Parâmetros de busca repassados ao renderer (o smoke força o tema por aqui). */
  query?: Record<string, string>
  /**
   * Smoke: janela mostrada sem ativar o app, transparente e sem receber clique nem foco. Não dá para
   * deixá-la oculta: no macOS `capturePage()` de janela oculta falha com `UnknownVizError`.
   */
  invisible?: boolean
}

export const WINDOW_SIZE = { width: 1120, height: 740, minWidth: 900, minHeight: 600 } as const

export function rendererUrl(base: string, query: Record<string, string> = {}): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}

/**
 * `webPreferences` da janela principal, também usadas pela janela do aviso de reunião (contrato 48): sandbox,
 * contextIsolation e o mesmo preload.
 */
export function appWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    // A gravação continua com a janela atrás de outras: timers do detector e do cronômetro não
    // podem ser estrangulados (mesma escolha de prova/main.js).
    backgroundThrottling: false,
  }
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    focusable: !options.invisible,
    title: options.title ?? DEFAULT_BRAND_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    // Fundo opaco no `--bg` do tema, para a janela não piscar outra cor antes do primeiro quadro.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#061A3D' : '#FFFFFF',
    webPreferences: appWebPreferences(),
  })

  guardWebContents(win.webContents, options.appOrigin)
  // O título é do main (nome da marca, `setTitle` a cada troca); o `<title>` da página não o substitui.
  win.on('page-title-updated', (event) => event.preventDefault())

  if (options.invisible) {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.showInactive()
  } else {
    win.once('ready-to-show', () => win.show())
  }
  void win.loadURL(rendererUrl(options.url, options.query))
  return win
}
