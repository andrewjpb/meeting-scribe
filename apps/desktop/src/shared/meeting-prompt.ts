// Contrato 48 (aviso-reuniao): quando a pessoa entra numa reunião do Meet ou do Teams (com a extensão "Quem fala no
// Meet"), uma janelinha no topo da tela oferece "Começar a transcrever". Aqui ficam a regra de quando avisar (pura,
// testada em test/meeting-prompt.test.ts), o texto do aviso e o formato do IPC entre a janela do aviso e o main.
// Contrato 49: o mesmo aviso quando outro app (Zoom, FaceTime, Slack…) liga o microfone, pelo `lap-mic-watch`
// (native/mic-watch/main.swift): quais apps contam, o nome de cada um e a sessão de microfone que faz uma reunião.
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
  /** De onde vem a reunião (contrato 49). Sem ela, da extensão do Meet. */
  fonte?: MeetingPromptSource
}

/**
 * De onde vem a reunião: a extensão do Meet (contrato 48) ou o microfone de um app (contrato 49), com o bundle id e
 * há quanto tempo o microfone dele está ligado sem parar. Na fonte `app`, `meeting` é a chave da sessão de microfone
 * (`micMeetingKey`), e `meetSpeakers` e `participants` não contam.
 */
export type MeetingPromptSource = { tipo: 'extensao' } | { tipo: 'app'; bundleId: string; micMs: number }

/**
 * Avisa só com tudo isto: a configuração ligada; uma reunião nova (que ainda não avisou); nenhuma gravação em
 * andamento; o app desbloqueado; e a reunião fora de "Não perguntar nesta reunião". Da extensão, também "Quem fala no
 * Meet" ligado e pelo menos um participante; de um app, um app que conta (`ignoredMicApp`) com o microfone ligado há
 * pelo menos `MIC_PROMPT_MIN_MS`.
 */
export function shouldPrompt(input: MeetingPromptInput): boolean {
  if (!input.meetingPrompt) return false
  const fonte = input.fonte ?? { tipo: 'extensao' }
  if (fonte.tipo === 'app') {
    if (ignoredMicApp(fonte.bundleId) || fonte.micMs < MIC_PROMPT_MIN_MS) return false
  } else if (!input.meetSpeakers || input.participants < 1) {
    return false
  }
  if (input.meeting === null) return false
  if (input.prompted.has(input.meeting) || input.skipped.has(input.meeting)) return false
  return !input.recording && !input.locked
}

// Contrato 49: o microfone de outros apps.

/** O microfone de um app precisa ficar ligado isto, sem parar, antes de avisar: ditado e áudio curto não avisam. */
export const MIC_PROMPT_MIN_MS = 3_000

/** O mesmo app desligou o microfone e religou depois disto: reunião nova (antes, é a mesma e não avisa de novo). */
export const MIC_SESSION_GAP_MS = 2 * 60_000

/**
 * Uma linha do `lap-mic-watch`: os bundle ids dos processos com entrada de áudio ligada (em qualquer microfone), o
 * nome que o macOS dá a cada um (quando achou), o microfone padrão em uso e a câmera (os dois só informativos).
 */
export interface MicWatchState {
  mic: boolean
  apps: string[]
  names: Record<string, string>
  camera: boolean
}

/** O próprio LAP Reuniões: o app empacotado e o Electron do `pnpm dev` (com os processos auxiliares de cada um). */
export const OWN_BUNDLE_IDS = ['com.lap.reunioes', 'com.github.Electron'] as const

/**
 * Chrome, Edge, Safari (e o processo do WebKit que abre o microfone por ele), Arc, Brave, Firefox, Opera, Vivaldi e
 * Dia: o Meet e o Teams neles avisam pela extensão (contrato 48); sem a extensão o navegador não avisa, senão cada
 * vídeo ou áudio de site avisaria.
 */
export const BROWSER_BUNDLE_IDS = [
  'com.google.Chrome',
  'com.microsoft.edgemac',
  'com.apple.Safari',
  'com.apple.WebKit',
  'company.thebrowser.Browser',
  'com.brave.Browser',
  'org.mozilla.firefox',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
  'company.thebrowser.dia',
] as const

/**
 * Os apps de reunião conhecidos e o nome do aviso. O FaceTime fala pelo `avconferenced` (é ele que abre o microfone
 * numa chamada), então os dois são "FaceTime".
 */
export const MIC_APP_NAMES: Readonly<Record<string, string>> = {
  'us.zoom.xos': 'Zoom',
  'com.apple.FaceTime': 'FaceTime',
  'com.apple.avconferenced': 'FaceTime',
  'com.microsoft.teams2': 'Teams',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.cisco.webexmeetingsapp': 'Webex',
  'com.hnc.Discord': 'Discord',
}

/** Nome quando nem o mapa nem o macOS dizem qual é o app. */
export const MIC_APP_UNKNOWN = 'outro app'

/** O bundle id é o próprio `prefix` ou um processo dele (`us.zoom.xos.helper`), sem diferença de maiúsculas. */
function sameApp(bundleId: string, prefix: string): boolean {
  const id = bundleId.toLowerCase()
  const base = prefix.toLowerCase()
  return id === base || id.startsWith(`${base}.`)
}

const knownMicApp = (bundleId: string): string | null => Object.entries(MIC_APP_NAMES).find(([id]) => sameApp(bundleId, id))?.[1] ?? null

/**
 * Apps cujo microfone não avisa: o próprio app, os navegadores e os processos do sistema da Apple fora do mapa
 * (Siri, ditado, reconhecimento de sons, Memorandos de Voz…), que ligam o microfone sem ser reunião.
 */
export function ignoredMicApp(bundleId: string): boolean {
  if (knownMicApp(bundleId) !== null) return false
  if ([...OWN_BUNDLE_IDS, ...BROWSER_BUNDLE_IDS].some((id) => sameApp(bundleId, id))) return true
  return bundleId.toLowerCase().startsWith('com.apple.')
}

/**
 * Nome do app no aviso: o do mapa; senão o que o macOS deu (sem o " Helper" dos processos auxiliares); senão
 * "outro app".
 */
export function micAppName(bundleId: string, macName: string | null | undefined): string {
  const known = knownMicApp(bundleId)
  if (known) return known
  const name = (macName ?? '').replace(/\s+Helper(\s*\(.*\))?$/, '').trim()
  return name || MIC_APP_UNKNOWN
}

/** "Reunião no Zoom". */
export function micPromptTitle(bundleId: string, macName: string | null | undefined): string {
  return `Reunião no ${micAppName(bundleId, macName)}`
}

/**
 * Microfone de um app (`micAppKey`): `start` é o começo da sessão (a reunião), `onSince` desde quando está ligado sem parar (`null`
 * desligado) e `offAt` quando desligou.
 */
export interface MicSession {
  start: number
  onSince: number | null
  offAt: number | null
}

/**
 * O app de um processo, para os processos do mesmo app terem uma sessão só: os ids do mapa com o mesmo nome viram o
 * primeiro deles (`com.apple.avconferenced` é `com.apple.FaceTime`, `us.zoom.xos.helper` é `us.zoom.xos`); os outros
 * perdem o `.helper…` do fim (`com.exemplo.app.helper.renderer` é `com.exemplo.app`).
 */
export function micAppKey(bundleId: string): string {
  const known = knownMicApp(bundleId)
  if (known !== null) return Object.entries(MIC_APP_NAMES).find(([, name]) => name === known)?.[0] ?? bundleId
  return bundleId.replace(/\.helper(\..*)?$/i, '')
}

/** Chave de "uma vez por reunião" de um app: o app (`micAppKey`) e o começo da sessão de microfone. */
export function micMeetingKey(app: string, start: number): string {
  return `app:${app}:${start}`
}

/**
 * Os apps (`micAppKey`) com entrada de áudio ligada agora, sem os ignorados e sem repetir. Decide só pela lista de
 * processos, que vale para qualquer microfone (um headset USB também): o `mic` do dispositivo padrão é informativo.
 */
export function activeMicApps(state: MicWatchState | null): string[] {
  if (!state) return []
  return [...new Set(state.apps.filter((id) => !ignoredMicApp(id)).map(micAppKey))]
}

/**
 * As sessões depois de uma linha do `lap-mic-watch` no instante `now`: app que ligou o microfone continua a sessão se
 * desligou há menos de `MIC_SESSION_GAP_MS`, senão começa outra; app que desligou guarda quando; sessão desligada há
 * `MIC_SESSION_GAP_MS` ou mais sai do mapa.
 */
export function updateMicSessions(sessions: ReadonlyMap<string, MicSession>, active: readonly string[], now: number): Map<string, MicSession> {
  const next = new Map<string, MicSession>()
  const on = new Set(active)
  for (const id of on) {
    const previous = sessions.get(id)
    if (previous && previous.onSince !== null) next.set(id, previous)
    else if (previous && previous.offAt !== null && now - previous.offAt < MIC_SESSION_GAP_MS) next.set(id, { start: previous.start, onSince: now, offAt: null })
    else next.set(id, { start: now, onSince: now, offAt: null })
  }
  for (const [id, session] of sessions) {
    if (on.has(id)) continue
    if (session.onSince !== null) next.set(id, { start: session.start, onSince: null, offAt: now })
    else if (session.offAt !== null && now - session.offAt < MIC_SESSION_GAP_MS) next.set(id, session)
  }
  return next
}
