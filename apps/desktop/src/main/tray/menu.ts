// Ícone na barra de menus (contrato 23, CA8 e CA9): o menu é montado a cada clique, com o estado de agora.
// Desbloqueado: abrir o app, nova gravação (e a gravação em curso com "Encerrar"), bloquear, Automações, as
// próximas 3 tarefas, pausar ou retomar todas, e sair. Bloqueado (contrato 22): só "Abrir" (que mostra a camada
// da senha), "Bloqueado" e "Sair"; nada de nome de tarefa nem de reunião. Funções puras e o controlador com o
// `Tray` injetado (o smoke usa um substituto que registra os itens).
import type { MenuItemConstructorOptions } from 'electron'

export interface TrayNextTask {
  name: string
  /** "sex 17:00". */
  when: string
}

export interface TrayState {
  brandName: string
  locked: boolean
  /** "Bloquear" só com senha ou Touch ID (contrato 22). */
  canLock: boolean
  /** Gravação em curso: o tempo desde o começo. */
  recording: { elapsedMs: number } | null
  paused: boolean
  next: readonly TrayNextTask[]
}

export interface TrayHandlers {
  open: () => void
  newRecording: () => void
  stopRecording: () => void
  lock: () => void
  automations: () => void
  togglePause: () => void
  quit: () => void
}

/** Ids dos itens (o smoke clica por eles). */
export const TRAY_IDS = {
  open: 'tray-open',
  newRecording: 'tray-new-recording',
  recording: 'tray-recording',
  stopRecording: 'tray-stop-recording',
  lock: 'tray-lock',
  locked: 'tray-locked',
  automations: 'tray-automations',
  next: 'tray-next',
  pause: 'tray-pause',
  quit: 'tray-quit',
} as const

/** "12:34" ou "1:02:03". */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${String(minutes).padStart(2, '0')}:${seconds}`
}

export function trayMenuTemplate(state: TrayState, handlers: TrayHandlers): MenuItemConstructorOptions[] {
  if (state.locked) {
    return [
      { id: TRAY_IDS.open, label: 'Abrir', click: handlers.open },
      { id: TRAY_IDS.locked, label: 'Bloqueado', enabled: false },
      { type: 'separator' },
      { id: TRAY_IDS.quit, label: 'Sair', click: handlers.quit },
    ]
  }
  const recording: MenuItemConstructorOptions[] = state.recording
    ? [
        { id: TRAY_IDS.recording, label: `Gravando · ${elapsedLabel(state.recording.elapsedMs)}`, enabled: false },
        { id: TRAY_IDS.stopRecording, label: 'Encerrar', click: handlers.stopRecording },
      ]
    : []
  const next: MenuItemConstructorOptions[] = state.next.length
    ? state.next.slice(0, 3).map((task, index) => ({ id: `${TRAY_IDS.next}-${index}`, label: `${task.name} · ${task.when}`, enabled: false }))
    : [{ id: `${TRAY_IDS.next}-0`, label: state.paused ? 'Tarefas pausadas' : 'Nenhuma tarefa agendada', enabled: false }]
  return [
    { id: TRAY_IDS.open, label: `Abrir ${state.brandName}`, click: handlers.open },
    { id: TRAY_IDS.newRecording, label: 'Nova gravação', enabled: state.recording === null, click: handlers.newRecording },
    ...recording,
    { id: TRAY_IDS.lock, label: 'Bloquear', enabled: state.canLock, click: handlers.lock },
    { type: 'separator' },
    { id: TRAY_IDS.automations, label: 'Automações', click: handlers.automations },
    ...next,
    { id: TRAY_IDS.pause, label: state.paused ? 'Retomar' : 'Pausar todas as tarefas', click: handlers.togglePause },
    { type: 'separator' },
    { id: TRAY_IDS.quit, label: 'Sair', click: handlers.quit },
  ]
}

/** O `Tray` do Electron, só no que o app usa. */
export interface TrayLike {
  setImage(image: unknown): void
  setToolTip(text: string): void
  on(event: 'click' | 'right-click', listener: () => void): unknown
  popUpContextMenu(menu: unknown): void
  destroy(): void
  /** Onde o ícone está na barra. Largura ou altura 0 = o macOS escondeu (barra cheia, atrás da câmera). */
  getBounds?(): { width: number; height: number }
}

export type TrayIcon = 'idle' | 'running'

export interface TrayControllerDeps {
  /** Cria o ícone (com a imagem inicial). */
  create: (image: unknown) => TrayLike
  /** Imagem "template" de cada variação (com o ponto quando uma tarefa roda). */
  image: (icon: TrayIcon) => unknown
  /** `Menu.buildFromTemplate`. */
  buildMenu: (template: MenuItemConstructorOptions[]) => unknown
  state: () => TrayState
  /** Há uma execução rodando agora? */
  running: () => boolean
  handlers: TrayHandlers
}

export interface TrayController {
  /** Ícone e dica de agora (chamado a cada mudança das automações e do bloqueio). */
  refresh(): void
  /** O menu como seria aberto agora (o clique usa o mesmo). */
  template(): MenuItemConstructorOptions[]
  icon(): TrayIcon
  /** O ícone aparece de fato na barra de menus? */
  visible(): boolean
  dispose(): void
}

export function createTrayController(deps: TrayControllerDeps): TrayController {
  let icon: TrayIcon = deps.running() ? 'running' : 'idle'
  const tray = deps.create(deps.image(icon))
  const template = (): MenuItemConstructorOptions[] => trayMenuTemplate(deps.state(), deps.handlers)
  const open = (): void => tray.popUpContextMenu(deps.buildMenu(template()))
  // Clique (ou clique secundário) abre o menu, como os outros ícones da barra de menus do macOS.
  tray.on('click', open)
  tray.on('right-click', open)
  const tip = (): string => {
    const state = deps.state()
    return state.locked ? `${state.brandName} — bloqueado` : icon === 'running' ? `${state.brandName} — tarefa rodando` : state.brandName
  }
  tray.setToolTip(tip())
  return {
    refresh() {
      const next: TrayIcon = deps.running() ? 'running' : 'idle'
      if (next !== icon) {
        icon = next
        tray.setImage(deps.image(icon))
      }
      tray.setToolTip(tip())
    },
    template,
    icon: () => icon,
    visible: () => {
      const bounds = tray.getBounds?.()
      return !bounds || (bounds.width > 0 && bounds.height > 0)
    },
    dispose: () => tray.destroy(),
  }
}

/**
 * Fechar a última janela (CA9): "Continuar na barra de menus" esconde o app do Dock e deixa só o ícone;
 * "Sair do app" sai. Reabrir (pelo ícone ou abrindo o app de novo) mostra o Dock outra vez.
 */
export interface WindowLifecycleDeps {
  dock: { hide(): void; show(): unknown } | undefined
  quit: () => void
  behavior: () => Promise<'tray' | 'quit'>
  /** O ícone da barra de menus está visível? Sem ele, o app fica no Dock para a pessoa conseguir voltar. */
  trayVisible?: () => boolean
  /** Avisa (uma vez) que o macOS escondeu o ícone da barra de menus. */
  trayHidden?: () => void
}

export function createWindowLifecycle(deps: WindowLifecycleDeps): { lastWindowClosed(): Promise<void>; reopened(): void } {
  return {
    async lastWindowClosed() {
      const behavior = await deps.behavior().catch(() => 'tray' as const)
      if (behavior === 'quit') deps.quit()
      else if (deps.trayVisible && !deps.trayVisible()) deps.trayHidden?.()
      else deps.dock?.hide()
    },
    reopened() {
      void deps.dock?.show()
    },
  }
}
