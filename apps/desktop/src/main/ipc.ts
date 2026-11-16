// Registro tipado dos canais de `shared/ipc.ts`. Toda mensagem do renderer passa pela checagem de
// origem: só o frame servido pela própria origem do app é atendido. Com o app bloqueado (contrato 22, CA4),
// este é o ponto único que recusa os canais de conteúdo (`WHEN_LOCKED`), antes de qualquer handler rodar.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { LOCKED_ERROR } from '../shared/lock'
import { RENDERER_EVENTS_WHEN_LOCKED, WHEN_LOCKED, type InvokeArgs, type RecordingSessionTag, type InvokeChannel, type InvokeChannels, type MainEvent, type MainEvents, type RendererEvent, type RendererEvents } from '../shared/ipc'
import { originOf } from './security'

let isLocked: () => boolean = () => false
let activeRecordingSession: () => string | null = () => null

/**
 * O serviço do bloqueio diz se o app está bloqueado e qual é o token da gravação em curso; vale para todo
 * canal, registrado antes ou depois.
 */
export function setLockGate(locked: () => boolean, recordingSession: () => string | null = () => null): void {
  isLocked = locked
  activeRecordingSession = recordingSession
}

/**
 * Lista de permitidos com o app bloqueado: passa o canal `allowed`; o `session` só com o token da gravação em
 * curso no segundo argumento (e o resumo só o automático). Canal fora do mapa ou qualquer outro valor: recusado.
 */
export function passesWhileLocked(channel: string, args: readonly unknown[]): boolean {
  const policy = Object.hasOwn(WHEN_LOCKED, channel) ? WHEN_LOCKED[channel as InvokeChannel] : undefined
  if (policy === 'allowed') return true
  if (policy !== 'session') return false
  const token = activeRecordingSession()
  const tag = args[1] as Partial<RecordingSessionTag> | undefined
  if (token === null || typeof tag !== 'object' || tag === null || tag.recordingSession !== token) return false
  if (channel === 'scribe:summary-generate') return (args[0] as { auto?: unknown } | undefined)?.auto === true
  return true
}

export function isTrustedSender(frameUrl: string | undefined, appOrigin: string): boolean {
  return typeof frameUrl === 'string' && originOf(frameUrl) === appOrigin
}

export function handle<C extends InvokeChannel>(
  channel: C,
  appOrigin: string,
  handler: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeChannels[C]['response'] | Promise<InvokeChannels[C]['response']>,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame?.url, appOrigin)) throw new Error(`${channel}: origem não autorizada`)
    if (isLocked() && !passesWhileLocked(channel, args)) throw new Error(LOCKED_ERROR)
    return handler(event, ...(args as InvokeArgs<C>))
  })
}

export function onEvent<C extends RendererEvent>(
  channel: C,
  appOrigin: string,
  listener: (event: IpcMainEvent, payload: RendererEvents[C]) => void,
): void {
  ipcMain.on(channel, (event, payload: RendererEvents[C]) => {
    if (!isTrustedSender(event.senderFrame?.url, appOrigin)) return
    if (RENDERER_EVENTS_WHEN_LOCKED[channel] !== 'pass' && isLocked()) return
    listener(event, payload)
  })
}

export function sendTo<C extends MainEvent>(contents: WebContents, channel: C, payload: MainEvents[C]): void {
  if (!contents.isDestroyed()) contents.send(channel, payload)
}

/** Mesma mensagem para todas as janelas (ex.: configurações gravadas). */
export function broadcast<C extends MainEvent>(windows: readonly { webContents: WebContents }[], channel: C, payload: MainEvents[C]): void {
  for (const win of windows) sendTo(win.webContents, channel, payload)
}
