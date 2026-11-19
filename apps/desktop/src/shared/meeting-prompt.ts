// Contrato 48 (aviso-reuniao): quando a pessoa entra numa reunião do Meet ou do Teams (com a extensão "Quem fala no
// Meet"), uma janelinha no topo da tela oferece "Começar a transcrever". Aqui ficam a regra de quando avisar (pura,
// testada em test/meeting-prompt.test.ts), o texto do aviso e o formato do IPC entre a janela do aviso e o main.
import type { MeetPlatform } from './meet'

/** O aviso some sozinho depois disto sem clique. */
export const MEETING_PROMPT_TIMEOUT_MS = 60_000

/** O que a janela do aviso mostra (`scribe:meeting-prompt-state`). */
export interface MeetingPromptState {
  /** Título da reunião, ou "Reunião no Meet" / "Reunião no Teams" quando a página não tem um. */
  titulo: string
  plataforma: MeetPlatform | null
}

/**
 * Os botões do aviso: "Começar a transcrever", o "x" (só desta vez), "Não perguntar nesta reunião" e "Nunca
 * perguntar" (desliga a configuração).
 */
export const MEETING_PROMPT_ACTIONS = ['gravar', 'fechar', 'nesta', 'nunca'] as const
export type MeetingPromptAction = (typeof MEETING_PROMPT_ACTIONS)[number]

/** Onde religar o aviso, dito logo abaixo de "Nunca perguntar" (a linha é "Avisar quando uma reunião começar"). */
export const MEETING_PROMPT_WHERE = 'Religue em Configurações › Gravação.'

/** Título do aviso: o da página; sem ele, de onde é a reunião. */
export function meetingPromptTitle(titulo: string | null, plataforma: MeetPlatform | null): string {
  if (titulo) return titulo
  if (plataforma === 'teams') return 'Reunião no Teams'
  if (plataforma === 'meet') return 'Reunião no Meet'
  return 'Reunião no navegador'
}

/**
 * Título da gravação em `scribe:calendar-recording`: começou pelo aviso, o da reunião do aviso vence o do evento da
 * agenda (um evento qualquer no mesmo horário não toma o título); por outro caminho (sem título do aviso), o da
 * agenda, como sempre. `null`: fica o título padrão.
 */
export function recordingTitleFor(promptTitle: string | null, calendarTitle: string | null | undefined): string | null {
  return promptTitle || calendarTitle || null
}

/** Tudo o que decide se o aviso aparece agora. */
export interface MeetingPromptInput {
  /** "Avisar quando uma reunião começar". */
  meetingPrompt: boolean
  /** "Quem fala no Meet": desligado, o servidor da extensão não está no ar e não há sinal. */
  meetSpeakers: boolean
  /** Id da reunião do último envio da extensão (`null` desconectada). */
  meeting: string | null
  participants: number
  /** Reuniões que já avisaram nesta execução do app (cada uma avisa no máximo uma vez). */
  prompted: ReadonlySet<string>
  /** "Não perguntar nesta reunião", em memória até o app fechar. */
  skipped: ReadonlySet<string>
  recording: boolean
  locked: boolean
}

/**
 * Avisa só com tudo isto: a configuração ligada; "Quem fala no Meet" ligado; uma reunião nova (que ainda não avisou)
 * com pelo menos um participante; nenhuma gravação em andamento; o app desbloqueado; e a reunião fora de "Não
 * perguntar nesta reunião".
 */
export function shouldPrompt(input: MeetingPromptInput): boolean {
  if (!input.meetingPrompt || !input.meetSpeakers) return false
  if (input.meeting === null || input.participants < 1) return false
  if (input.prompted.has(input.meeting) || input.skipped.has(input.meeting)) return false
  return !input.recording && !input.locked
}
