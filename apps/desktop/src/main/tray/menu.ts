// Ícone na barra de menus (contrato 23, CA8 e CA9; reorganizado no contrato 50). O menu é nativo e fica preso ao
// ícone (`setContextMenu`): o clique, esquerdo ou direito, abre o menu, como os outros ícones da barra do macOS. Ele é
// remontado (com 500 ms de folga) quando uma das fontes muda; gravando, o tempo vai ao lado do ícone a cada segundo
// sem remontar o menu. Desbloqueado: abrir o app, nova gravação (ou a gravação em curso), as reuniões de hoje da
// agenda, as últimas gravadas, o aviso de reunião, o estado dos plugins, as Automações, bloquear e sair. Bloqueado
// (contrato 22): só "Abrir" (que mostra a camada da senha), "Bloqueado" e "Sair"; nada de tarefa, reunião, agenda ou
// recente. Funções puras e o controlador com o `Tray` injetado (o smoke usa um substituto que registra os itens).
import type { MenuItemConstructorOptions } from 'electron'
import { clockLabel, type CalendarUpcoming } from '../../shared/calendar'

export interface TrayNextTask {
  name: string
  /** "sex 17:00". */
  when: string
}

/** Uma reunião de hoje da agenda (contrato 50), sem o endereço da chamada (só se ele existe). */
export interface TrayMeeting {
  /** `eventKey` do evento: o mesmo do "Gravar" da notificação. */
  key: string
  title: string
  /** "14:00", no fuso do Mac. */
  time: string
  /** Já começou: "Agora · …". */
  happening: boolean
  hasJoinUrl: boolean
}

/** Uma reunião gravada (contrato 50), para "Recentes". */
export interface TrayRecent {
  id: string
  title: string
}

/** Um plugin ligado nas Configurações e se a extensão dele está falando com o app. */
export interface TrayPlugin {
  name: string
  connected: boolean
}

export interface TrayState {
  brandName: string
  locked: boolean
  /** "Bloquear" só com senha ou Touch ID (contrato 22). */
  canLock: boolean
  /** Gravação em curso: o tempo desde o começo e o título (do aviso de reunião ou do evento da agenda), se houver. */
  recording: { elapsedMs: number; title: string | null } | null
  paused: boolean
  next: readonly TrayNextTask[]
  /** As reuniões de hoje da agenda (`todayMeetings`); o menu mostra até 3. */
  meetings: readonly TrayMeeting[]
  /** As reuniões gravadas, da mais recente para a mais antiga; o menu mostra até 3. */
  recent: readonly TrayRecent[]
  /** "Avisar quando uma reunião começar" (contrato 48). */
  meetingPrompt: boolean
  /** Só os plugins ligados. */
  plugins: readonly TrayPlugin[]
}

export interface TrayHandlers {
  open: () => void
  newRecording: () => void
  /** "Abrir gravação": a tela ao vivo. */
  openRecording: () => void
  stopRecording: () => void
  /** "Gravar agora" de um evento: o mesmo caminho do "Gravar" da notificação da agenda. */
  recordEvent: (key: string) => void
  /** "Entrar na reunião": o link do evento no navegador padrão. */
  joinEvent: (key: string) => void
  openMeeting: (id: string) => void
  toggleMeetingPrompt: () => void
  /** Configurações › Plugins. */
  openPlugins: () => void
  lock: () => void
  automations: () => void
  togglePause: () => void
  quit: () => void
}

/** Ids dos itens (o smoke clica por eles). Reuniões e recentes ganham o índice: `tray-event-0`, `tray-recent-0-…`. */
export const TRAY_IDS = {
  open: 'tray-open',
  newRecording: 'tray-new-recording',
  recording: 'tray-recording',
  openRecording: 'tray-open-recording',
  stopRecording: 'tray-stop-recording',
  event: 'tray-event',
  noEvents: 'tray-event-none',
  recent: 'tray-recent',
  meetingPrompt: 'tray-meeting-prompt',
  plugins: 'tray-plugins',
  automationsMenu: 'tray-automations-menu',
  lock: 'tray-lock',
  locked: 'tray-locked',
  automations: 'tray-automations',
  next: 'tray-next',
  pause: 'tray-pause',
  quit: 'tray-quit',
} as const

/** Quantas reuniões da agenda e quantas recentes o menu mostra. */
export const TRAY_LIST_MAX = 3
/** Títulos de reunião no menu, cortados. */
export const TRAY_TITLE_MAX = 40
/** Folga entre a mudança de uma fonte e o menu remontado. */
export const TRAY_REBUILD_DEBOUNCE_MS = 500
/** O tempo da gravação ao lado do ícone. */
export const TRAY_TITLE_TICK_MS = 1_000

/** "12:34" ou "1:02:03". */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${String(minutes).padStart(2, '0')}:${seconds}`
}

/** Título de reunião no menu: uma linha só, até 40 caracteres (com "…" quando corta). */
export function trayTitle(text: string, max = TRAY_TITLE_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** "Gravando · 12:03 — Daily" (sem título, só o tempo). */
export function recordingLabel(recording: NonNullable<TrayState['recording']>): string {
  const title = recording.title ? trayTitle(recording.title) : ''
  return `Gravando · ${elapsedLabel(recording.elapsedMs)}${title ? ` — ${title}` : ''}`
}

/** "Agora · Daily (10:00)" ou "Planejamento · 14:00". */
export function meetingLabel(meeting: TrayMeeting): string {
  const title = trayTitle(meeting.title)
  return meeting.happening ? `Agora · ${title} (${meeting.time})` : `${title} · ${meeting.time}`
}

/** "Meet: conectado · Navegador: desconectado"; sem plugin ligado, nada. */
export function pluginsLabel(plugins: readonly TrayPlugin[]): string {
  return plugins.map((plugin) => `${plugin.name}: ${plugin.connected ? 'conectado' : 'desconectado'}`).join(' · ')
}

const sameLocalDay = (a: number, b: number): boolean => {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/**
 * As reuniões de hoje entre as "Próximas" da agenda (que vão até 24 h à frente): as que começam hoje, no fuso do Mac,
 * e as que estão acontecendo (inclusive a que começou ontem e ainda não acabou).
 */
export function todayMeetings(upcoming: readonly CalendarUpcoming[], now: number): TrayMeeting[] {
  return upcoming
    .filter((event) => event.happening || sameLocalDay(Date.parse(event.start), now))
    .map((event) => ({ key: event.key, title: event.title, time: clockLabel(event.start), happening: event.happening, hasJoinUrl: event.hasJoinUrl }))
}

/** O link que "Entrar na reunião" pode abrir: só `http://` ou `https://`; qualquer outra coisa, nada. */
export function trayJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
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
        { id: TRAY_IDS.recording, label: recordingLabel(state.recording), enabled: false },
        { id: TRAY_IDS.openRecording, label: 'Abrir gravação', click: handlers.openRecording },
        { id: TRAY_IDS.stopRecording, label: 'Encerrar', click: handlers.stopRecording },
      ]
    : [{ id: TRAY_IDS.newRecording, label: 'Nova gravação', click: handlers.newRecording }]
  const meetings: MenuItemConstructorOptions[] = state.meetings.length
    ? state.meetings.slice(0, TRAY_LIST_MAX).map((meeting, index) => {
        const id = `${TRAY_IDS.event}-${index}`
        return {
          id,
          label: meetingLabel(meeting),
          submenu: [
            { id: `${id}-record`, label: 'Gravar agora', enabled: state.recording === null, click: () => handlers.recordEvent(meeting.key) },
            ...(meeting.hasJoinUrl ? [{ id: `${id}-join`, label: 'Entrar na reunião', click: () => handlers.joinEvent(meeting.key) }] : []),
          ],
        }
      })
    : [{ id: TRAY_IDS.noEvents, label: 'Nenhuma reunião hoje', enabled: false }]
  const recent: MenuItemConstructorOptions[] = state.recent.length
    ? state.recent.slice(0, TRAY_LIST_MAX).map((meeting, index) => ({ id: `${TRAY_IDS.recent}-${index}`, label: trayTitle(meeting.title), click: () => handlers.openMeeting(meeting.id) }))
    : [{ id: `${TRAY_IDS.recent}-none`, label: 'Nenhuma reunião gravada', enabled: false }]
  const plugins: MenuItemConstructorOptions[] = state.plugins.length ? [{ id: TRAY_IDS.plugins, label: pluginsLabel(state.plugins), click: handlers.openPlugins }] : []
  const next: MenuItemConstructorOptions[] = state.next.length
    ? state.next.slice(0, 3).map((task, index) => ({ id: `${TRAY_IDS.next}-${index}`, label: `${task.name} · ${task.when}`, enabled: false }))
    : [{ id: `${TRAY_IDS.next}-0`, label: state.paused ? 'Agendamentos pausados' : 'Nenhum agendamento', enabled: false }]
  return [
    { id: TRAY_IDS.open, label: `Abrir ${state.brandName}`, click: handlers.open },
    ...recording,
    { type: 'separator' },
    ...meetings,
    { type: 'separator' },
    { id: TRAY_IDS.recent, label: 'Recentes', submenu: recent },
    { type: 'separator' },
    { id: TRAY_IDS.meetingPrompt, label: 'Avisar quando uma reunião começar', type: 'checkbox', checked: state.meetingPrompt, click: handlers.toggleMeetingPrompt },
    ...plugins,
    {
      id: TRAY_IDS.automationsMenu,
      label: 'Automações',
      submenu: [
        { id: TRAY_IDS.automations, label: 'Abrir Automações', click: handlers.automations },
        { type: 'separator' },
        ...next,
        { type: 'separator' },
        { id: TRAY_IDS.pause, label: state.paused ? 'Retomar' : 'Pausar todos os agendamentos', click: handlers.togglePause },
      ],
    },
    { id: TRAY_IDS.lock, label: 'Bloquear', enabled: state.canLock, click: handlers.lock },
    { type: 'separator' },
    { id: TRAY_IDS.quit, label: 'Sair', click: handlers.quit },
  ]
}

/** O `Tray` do Electron, só no que o app usa. */
export interface TrayLike {
  setImage(image: unknown): void
  setToolTip(text: string): void
  /** O menu preso ao ícone: o macOS abre no clique, esquerdo ou direito. */
  setContextMenu(menu: unknown): void
  /** O texto ao lado do ícone (o tempo da gravação); vazio, nenhum. */
  setTitle(title: string, options?: { fontType?: 'monospaced' | 'monospacedDigit' }): void
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
  /** Troca o rótulo de um item do menu já montado (o "Gravando · 12:03" a cada segundo, sem remontar). */
  setLabel?: (menu: unknown, id: string, label: string) => void
  /** Antes de cada montagem: lê o que é assíncrono (configurações, reuniões gravadas) para o `state` de agora. */
  prepare?: () => Promise<void>
  state: () => TrayState
  /** Há uma execução rodando agora? */
  running: () => boolean
  handlers: TrayHandlers
  /** Relógios (os testes trocam). */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void }
}

export interface TrayController {
  /** Ícone, dica e o tempo de agora, e o menu remontado com folga (chamado a cada mudança de uma fonte). */
  refresh(): void
  /** Remonta o menu já, sem a folga (no começo e no smoke). */
  rebuild(): Promise<void>
  /** O menu como seria montado agora. */
  template(): MenuItemConstructorOptions[]
  icon(): TrayIcon
  /** O ícone aparece de fato na barra de menus? */
  visible(): boolean
  dispose(): void
}

const unrefTimer = (handle: unknown): unknown => {
  ;(handle as { unref?: () => void } | null)?.unref?.()
  return handle
}

const DEFAULT_TIMERS: NonNullable<TrayControllerDeps['timers']> = {
  setTimeout: (fn, ms) => unrefTimer(setTimeout(fn, ms)),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => unrefTimer(setInterval(fn, ms)),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export function createTrayController(deps: TrayControllerDeps): TrayController {
  const timers = deps.timers ?? DEFAULT_TIMERS
  let icon: TrayIcon = deps.running() ? 'running' : 'idle'
  const tray = deps.create(deps.image(icon))
  const template = (): MenuItemConstructorOptions[] => trayMenuTemplate(deps.state(), deps.handlers)
  /** O menu preso ao ícone agora (o tempo da gravação é trocado nele). */
  let menu: unknown = null
  let builds = 0
  let disposed = false
  let debounce: unknown = null
  let ticker: unknown = null
  let lastLocked = deps.state().locked
  let shownTitle = ''

  async function rebuild(): Promise<void> {
    if (debounce !== null) timers.clearTimeout(debounce)
    debounce = null
    const build = ++builds
    // Bloqueado, o menu não usa nada assíncrono: troca na hora, sem esperar a leitura.
    if (deps.prepare && !deps.state().locked) await deps.prepare().catch(() => undefined)
    // Uma montagem mais nova começou enquanto esta lia: vale a mais nova.
    if (disposed || build !== builds) return
    menu = deps.buildMenu(template())
    tray.setContextMenu(menu)
  }

  const schedule = (): void => {
    if (disposed || debounce !== null) return
    debounce = timers.setTimeout(() => {
      debounce = null
      void rebuild()
    }, TRAY_REBUILD_DEBOUNCE_MS)
  }

  /** O tempo ao lado do ícone, e o rótulo "Gravando · …" no menu montado. Bloqueado, nenhum texto. */
  const tick = (): void => {
    const state = deps.state()
    const title = state.recording && !state.locked ? ` ${elapsedLabel(state.recording.elapsedMs)}` : ''
    if (title !== shownTitle) {
      shownTitle = title
      tray.setTitle(title, { fontType: 'monospacedDigit' })
    }
    if (state.recording && !state.locked && menu !== null) deps.setLabel?.(menu, TRAY_IDS.recording, recordingLabel(state.recording))
    // Só enquanto grava: o relógio para quando a gravação acaba (ou o app bloqueia).
    const recording = state.recording !== null && !state.locked
    if (recording && ticker === null && !disposed) ticker = timers.setInterval(tick, TRAY_TITLE_TICK_MS)
    else if (!recording && ticker !== null) {
      timers.clearInterval(ticker)
      ticker = null
    }
  }

  const tip = (): string => {
    const state = deps.state()
    return state.locked ? `${state.brandName} — bloqueado` : icon === 'running' ? `${state.brandName} — agendamento rodando` : state.brandName
  }
  tray.setToolTip(tip())
  void rebuild()
  tick()
  return {
    refresh() {
      if (disposed) return
      const next: TrayIcon = deps.running() ? 'running' : 'idle'
      if (next !== icon) {
        icon = next
        tray.setImage(deps.image(icon))
      }
      tray.setToolTip(tip())
      tick()
      // Bloquear ou desbloquear troca o menu já: nenhum título fica à mostra durante a folga.
      const locked = deps.state().locked
      if (locked !== lastLocked) {
        lastLocked = locked
        void rebuild()
      } else schedule()
    },
    rebuild,
    template,
    icon: () => icon,
    visible: () => {
      const bounds = tray.getBounds?.()
      return !bounds || (bounds.width > 0 && bounds.height > 0)
    },
    dispose: () => {
      disposed = true
      if (debounce !== null) timers.clearTimeout(debounce)
      if (ticker !== null) timers.clearInterval(ticker)
      debounce = null
      ticker = null
      tray.destroy()
    },
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
