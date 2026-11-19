// Contrato 48 (aviso-reuniao): o aviso "Começar a transcrever" do lado do main. A cada mudança do estado da extensão
// do Meet, confere a regra (`shouldPrompt`) e abre a janela do aviso; guarda as reuniões que já avisaram e as de "Não
// perguntar nesta reunião" (em memória, até o app fechar); fecha o aviso depois de 60 s, quando a reunião acaba ou
// quando a reunião troca. Os dois canais do aviso só atendem a própria janela dele. Sem Electron: a janela vem por
// `openWindow`, e o teste (test/meeting-prompt.test.ts) usa uma de mentira.
// Contrato 49: as linhas do `lap-mic-watch` (`micChanged`) também abrem o aviso, "Reunião no Zoom": cada app com o
// microfone ligado tem a sua sessão (a reunião), avisa depois de 3 s ligado e fecha o aviso quando desliga. Um aviso
// por vez: com um aberto, o outro espera.
import { z } from 'zod'
import type { MeetPlatform, MeetState } from '../../shared/meet'
import {
  activeMicApps,
  MEETING_PROMPT_ACTIONS,
  MEETING_PROMPT_TIMEOUT_MS,
  meetingPromptTitle,
  MIC_PROMPT_MIN_MS,
  micAppKey,
  micMeetingKey,
  micPromptTitle,
  shouldPrompt,
  updateMicSessions,
  type MeetingPromptState,
  type MicSession,
  type MicWatchState,
} from '../../shared/meeting-prompt'
import type { ThemeSetting } from '../../shared/settings-defaults'

/** "Começar a transcrever" leva o título da reunião à gravação que começar até este prazo depois do clique. */
export const MEETING_PROMPT_PICK_MS = 2 * 60_000

/** A janela do aviso, vista do controlador. */
export interface MeetingPromptWindow {
  /** O `webContents` que chamou o IPC é o desta janela? */
  isSender(sender: unknown): boolean
  close(): void
  /** Fechada por qualquer caminho. */
  onClosed(listener: () => void): void
  /** O título (ou a plataforma) da mesma reunião mudou com o aviso aberto (`scribe:meeting-prompt-changed`). */
  update(state: MeetingPromptState): void
}

/** O que o aviso lê das configurações: as duas chaves da regra e o tema da janela. */
export interface MeetingPromptSettings {
  meetingPrompt: boolean
  meetSpeakers: boolean
  theme: ThemeSetting
}

export interface MeetingPromptDeps {
  settings: () => Promise<MeetingPromptSettings>
  recording: () => boolean
  locked: () => boolean
  openWindow: (settings: MeetingPromptSettings) => MeetingPromptWindow
  /** "Começar a transcrever": mostra a janela principal e começa a gravação (o caminho do "Gravar" da agenda). */
  record: () => void
  /** "Nunca perguntar": grava `meetingPrompt: false` pelo caminho das configurações. */
  disable: () => Promise<unknown>
  timeoutMs?: number
  now?: () => number
}

export interface MeetingPromptController {
  /** Cada mudança do estado da extensão (`onChange` do servidor do Meet). */
  meetChanged(state: MeetState): Promise<void>
  /** Contrato 49: cada linha do `lap-mic-watch`; `null` quando ele parou (configuração desligada ou caiu). */
  micChanged(state: MicWatchState | null): Promise<void>
  /** O app desbloqueou: a última reunião da extensão e os apps com o microfone ligado são conferidos de novo. */
  recheck(): Promise<void>
  /** `scribe:meeting-prompt-state`: só a janela do aviso; outra recebe erro. */
  state(sender: unknown): MeetingPromptState
  /** `scribe:meeting-prompt-act`: falso para outra janela ou pedido fora do formato. */
  act(sender: unknown, request: unknown): Promise<boolean>
  /** Fecha o aviso aberto (app bloqueado, configuração desligada). */
  close(): void
  /** A reunião do aviso aberto, ou `null`. */
  open(): string | null
  /** Uma gravação começou: o aviso fecha e o título do "Começar a transcrever" (se veio dele) vale para ela. */
  recordingStarted(): void
  /** Título da reunião da gravação em curso, quando ela começou pelo aviso. */
  recordingTitle(): string | null
  recordingEnded(): void
}

const actSchema = z.object({ acao: z.enum(MEETING_PROMPT_ACTIONS) }).strict()

interface OpenPrompt {
  meeting: string
  /** Contrato 49: o app (`micAppKey`), quando o aviso veio do microfone dele; `null`, da extensão. */
  app: { key: string; titulo: string } | null
  titulo: string | null
  plataforma: MeetPlatform | null
  window: MeetingPromptWindow
  timer: ReturnType<typeof setTimeout>
}

export function createMeetingPromptController(deps: MeetingPromptDeps): MeetingPromptController {
  const timeoutMs = deps.timeoutMs ?? MEETING_PROMPT_TIMEOUT_MS
  const now = deps.now ?? Date.now
  const prompted = new Set<string>()
  const skipped = new Set<string>()
  let current: OpenPrompt | null = null
  let chain: Promise<void> = Promise.resolve()
  let pending: { titulo: string; at: number } | null = null
  let recordingTitle: string | null = null
  let micSessions = new Map<string, MicSession>()
  const micNames = new Map<string, string>()
  let micTimer: ReturnType<typeof setTimeout> | null = null
  /** O último estado da extensão: com um aviso que fechou ou o desbloqueio, a reunião dela é conferida de novo. */
  let lastMeet: MeetState | null = null

  const close = (): void => {
    const open = current
    if (!open) return
    current = null
    clearTimeout(open.timer)
    open.window.close()
    freed()
  }

  /**
   * Um aviso fechou: a reunião da extensão ou um app com o microfone ligado (contrato 49) que ficaram esperando podem
   * avisar agora, sem esperar outro evento.
   */
  const freed = (): void => {
    if (lastMeet?.connected || [...micSessions.values()].some((session) => session.onSince !== null)) void recheck()
  }

  const recheck = (): Promise<void> =>
    enqueue(async () => {
      if (lastMeet) await evaluate(lastMeet)
      await evaluateMic()
    })

  const opened = (meeting: string, app: OpenPrompt['app'], titulo: string | null, plataforma: MeetPlatform | null, settings: MeetingPromptSettings): void => {
    prompted.add(meeting)
    const window = deps.openWindow(settings)
    const open: OpenPrompt = { meeting, app, titulo, plataforma, window, timer: setTimeout(close, timeoutMs) }
    open.timer.unref?.()
    current = open
    window.onClosed(() => {
      if (current !== open) return
      clearTimeout(open.timer)
      current = null
      freed()
    })
  }

  const evaluate = async (state: MeetState): Promise<void> => {
    lastMeet = state
    const meeting = state.connected ? state.meeting : null
    // O aviso de um app (contrato 49) não depende da extensão; com ele aberto, a reunião da extensão espera.
    if (current?.app) return
    if (current && current.meeting !== meeting) close()
    if (meeting === null) return
    if (current) {
      // A mesma reunião: o título pode ter chegado agora; a janela aberta recebe o novo (bloqueado, o aviso já fechou).
      if (current.titulo === state.titulo && current.plataforma === state.plataforma) return
      current.titulo = state.titulo
      current.plataforma = state.plataforma
      if (!deps.locked()) current.window.update(promptState(current))
      return
    }
    // Vista durante uma gravação: a pessoa já está gravando, a reunião não avisa depois.
    if (deps.recording() && state.participants.length > 0) {
      prompted.add(meeting)
      return
    }
    const settings = await deps.settings()
    const input = { meetingPrompt: settings.meetingPrompt, meetSpeakers: settings.meetSpeakers, meeting, participants: state.participants.length, prompted, skipped, recording: deps.recording(), locked: deps.locked() }
    if (!shouldPrompt(input)) return
    opened(meeting, null, state.titulo, state.plataforma, settings)
  }

  /** Contrato 49: confere cada app com o microfone ligado; o primeiro que passa na regra abre o aviso. */
  const evaluateMic = async (): Promise<void> => {
    if (micTimer) clearTimeout(micTimer)
    micTimer = null
    const at = now()
    let wait: number | null = null
    for (const [app, session] of micSessions) {
      if (session.onSince === null) continue
      const meeting = micMeetingKey(app, session.start)
      if (current || prompted.has(meeting) || skipped.has(meeting)) continue
      // Ligado durante uma gravação: a pessoa já está gravando, esta reunião não avisa depois.
      if (deps.recording()) {
        prompted.add(meeting)
        continue
      }
      const micMs = at - session.onSince
      // Ainda não fez 3 s: confere de novo quando fizer.
      if (micMs < MIC_PROMPT_MIN_MS) {
        wait = Math.min(wait ?? Infinity, MIC_PROMPT_MIN_MS - micMs)
        continue
      }
      const settings = await deps.settings()
      const input = { meetingPrompt: settings.meetingPrompt, meetSpeakers: settings.meetSpeakers, meeting, participants: 0, prompted, skipped, recording: deps.recording(), locked: deps.locked(), fonte: { tipo: 'app' as const, bundleId: app, micMs } }
      // A sessão pode ter acabado enquanto as configurações eram lidas.
      if (current || micSessions.get(app) !== session || !shouldPrompt(input)) continue
      opened(meeting, { key: app, titulo: micPromptTitle(app, micNames.get(app)) }, null, null, settings)
    }
    if (wait !== null) {
      micTimer = setTimeout(() => void enqueue(evaluateMic), wait)
      micTimer.unref?.()
    }
  }

  const micUpdate = async (state: MicWatchState | null): Promise<void> => {
    // O nome do app vem do processo principal quando ele está na lista; senão, de um auxiliar (sem o " Helper").
    for (const id of state?.apps ?? []) {
      const name = state?.names[id]
      const key = micAppKey(id)
      if (name && (id === key || !micNames.has(key))) micNames.set(key, name)
    }
    micSessions = updateMicSessions(micSessions, activeMicApps(state), now())
    // O app do aviso aberto desligou o microfone: a reunião acabou, o aviso fecha.
    if (current?.app && micSessions.get(current.app.key)?.onSince == null) close()
    await evaluateMic()
  }

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = chain.then(task).catch(() => undefined)
    chain = run
    return run
  }

  const promptState = (open: OpenPrompt): MeetingPromptState =>
    open.app ? { titulo: open.app.titulo, plataforma: null } : { titulo: meetingPromptTitle(open.titulo, open.plataforma), plataforma: open.plataforma }

  const fromPrompt = (sender: unknown): OpenPrompt | null => (current && current.window.isSender(sender) ? current : null)

  return {
    meetChanged: (state) => enqueue(() => evaluate(state)),

    micChanged: (state) => enqueue(() => micUpdate(state)),

    recheck,

    state(sender) {
      const open = fromPrompt(sender)
      if (!open) throw new Error('scribe:meeting-prompt-state: só a janela do aviso')
      return promptState(open)
    },

    async act(sender, request) {
      const open = fromPrompt(sender)
      const parsed = actSchema.safeParse(request)
      if (!open || !parsed.success) return false
      const acao = parsed.data.acao
      if (acao === 'nesta') skipped.add(open.meeting)
      close()
      if (acao === 'gravar') {
        // Já gravando ou bloqueado, a janela só vem para a frente: o título não fica esperando outra gravação.
        pending = open.titulo && !deps.recording() && !deps.locked() ? { titulo: open.titulo, at: now() } : null
        deps.record()
      } else if (acao === 'nunca') {
        await deps.disable()
      }
      return true
    },

    close,

    open: () => current?.meeting ?? null,

    recordingStarted() {
      recordingTitle = pending && now() - pending.at <= MEETING_PROMPT_PICK_MS ? pending.titulo : null
      pending = null
      close()
    },

    recordingTitle: () => recordingTitle,

    recordingEnded() {
      recordingTitle = null
    },
  }
}
