// Contrato 48 (aviso-reuniao): a janelinha do aviso "Começar a transcrever", no topo da tela do cursor, abaixo da
// barra de menus. Sem moldura, transparente, sempre na frente (também sobre tela cheia) e sem nunca roubar o foco
// da reunião: não recebe foco e aparece com `showInactive()`. Mesmas `webPreferences` e a mesma trava de navegação
// da janela principal; o renderer é o mesmo `index.html`, com `?janela=aviso`. A geometria é pura
// (test/meeting-prompt.test.ts).
import { BrowserWindow } from 'electron'
import { guardWebContents } from '../security'
import { appWebPreferences, rendererUrl } from '../window'

/**
 * ~420×88 do contrato, com 40 px a mais na largura: em 420, "Começar a transcrever" (o texto e o botão, como no
 * desenho do contrato) não cabia e o texto saía cortado.
 */
export const MEETING_PROMPT_SIZE = { width: 460, height: 88 } as const
/** Distância do topo da área útil (logo abaixo da barra de menus). */
export const MEETING_PROMPT_TOP_GAP = 8

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Onde o aviso fica: centrado na largura da área útil da tela (`workArea`, que já desconta a barra de menus e o
 * Dock), 8 px abaixo do topo dela. Tela mais estreita que o aviso: ele encolhe para caber.
 */
export function meetingPromptBounds(workArea: Rect, size: { width: number; height: number } = MEETING_PROMPT_SIZE): Rect {
  const width = Math.min(size.width, Math.max(0, workArea.width))
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + MEETING_PROMPT_TOP_GAP),
    width,
    height: size.height,
  }
}

export interface MeetingPromptWindowOptions {
  url: string
  appOrigin: string
  /** Área útil da tela onde está o cursor. */
  workArea: Rect
  /** Tema escolhido em Configurações; `null` segue o macOS (o renderer acompanha a troca). */
  theme: 'light' | 'dark' | null
  /** Smoke: janela mostrada sem ativar o app, transparente e sem receber clique (como a principal). */
  invisible?: boolean
}

export function createMeetingPromptWindow(options: MeetingPromptWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...meetingPromptBounds(options.workArea),
    show: false,
    frame: false,
    transparent: true,
    // Sem cor de fundo: os cantos de 6 px do cartão ficam transparentes.
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    // Sem foco, o primeiro clique precisa chegar ao botão (senão só "ativaria" a janela).
    acceptFirstMouse: true,
    // macOS: painel que não ativa o app, aparece sobre apps em tela cheia e em todas as mesas.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    title: 'Começar a transcrever',
    webPreferences: appWebPreferences(),
  })
  guardWebContents(win.webContents, options.appOrigin)
  win.on('page-title-updated', (event) => event.preventDefault())
  win.setAlwaysOnTop(true, 'pop-up-menu')
  // Sem trocar o tipo do processo: a troca esconde o Dock e a janela por um instante a cada chamada.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  if (options.invisible) {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.showInactive()
  } else {
    win.once('ready-to-show', () => win.showInactive())
  }
  void win.loadURL(rendererUrl(options.url, { janela: 'aviso', ...(options.theme ? { theme: options.theme } : {}) }))
  return win
}
