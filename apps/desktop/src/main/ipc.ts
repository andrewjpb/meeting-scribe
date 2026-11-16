// Registro tipado dos canais de `shared/ipc.ts`. Toda mensagem do renderer passa pela checagem de
// origem: só o frame servido pela própria origem do app é atendido.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { InvokeArgs, InvokeChannel, InvokeChannels, MainEvent, MainEvents, RendererEvent, RendererEvents } from '../shared/ipc'
import { originOf } from './security'

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
