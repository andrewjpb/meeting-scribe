// Contrato 48 (aviso-reuniao): o aviso "Começar a transcrever" do lado do main. A cada mudança do estado da extensão
// do Meet, confere a regra (`shouldPrompt`) e abre a janela do aviso; guarda as reuniões que já avisaram e as de "Não
// perguntar nesta reunião" (em memória, até o app fechar); fecha o aviso depois de 60 s, quando a reunião acaba ou
// quando a reunião troca. Os dois canais do aviso só atendem a própria janela dele. Sem Electron: a janela vem por
// `openWindow`, e o teste (test/meeting-prompt.test.ts) usa uma de mentira.
import { z } from 'zod'
import type { MeetPlatform, MeetState } from '../../shared/meet'
import { MEETING_PROMPT_ACTIONS, MEETING_PROMPT_TIMEOUT_MS, meetingPromptTitle, shouldPrompt, type MeetingPromptState } from '../../shared/meeting-prompt'
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

  const close = (): void => {
    const open = current
    if (!open) return
    current = null
    clearTimeout(open.timer)
    open.window.close()
  }

  const evaluate = async (state: MeetState): Promise<void> => {
    const meeting = state.connected ? state.meeting : null
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
    prompted.add(meeting)
    const window = deps.openWindow(settings)
    const open: OpenPrompt = { meeting, titulo: state.titulo, plataforma: state.plataforma, window, timer: setTimeout(close, timeoutMs) }
    open.timer.unref?.()
    current = open
    window.onClosed(() => {
      if (current !== open) return
      clearTimeout(open.timer)
      current = null
    })
  }

  const promptState = (open: OpenPrompt): MeetingPromptState => ({ titulo: meetingPromptTitle(open.titulo, open.plataforma), plataforma: open.plataforma })

  const fromPrompt = (sender: unknown): OpenPrompt | null => (current && current.window.isSender(sender) ? current : null)

  return {
    meetChanged(state) {
      const run = chain.then(() => evaluate(state)).catch(() => undefined)
      chain = run
      return run
    },

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
