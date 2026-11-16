// Gravação em curso, vista do main (contrato 22). O renderer abre a sessão ao começar a gravar e a fecha no
// fim do "Encerrar". Com ela aberta, os canais de fim de gravação passam com o app bloqueado (só com o token
// dela) e fechar a janela ou sair do app pede confirmação. A janela que abriu a sessão sumir (fechada,
// recarregada, renderer encerrado) fecha a sessão: um token órfão não prende o app aberto.
import { randomUUID } from 'node:crypto'

/** Quem abriu a sessão: o `webContents` do renderer. */
export interface RecordingSessionOwner {
  once(event: 'destroyed', listener: () => void): unknown
}

export interface RecordingSessions {
  open(owner?: RecordingSessionOwner): string
  close(token: unknown): boolean
  /** Token da sessão aberta; `null` sem gravação. */
  active(): string | null
}

export function createRecordingSessions(onClose: () => void = () => undefined): RecordingSessions {
  let current: string | null = null
  const close = (token: unknown): boolean => {
    if (current === null || token !== current) return false
    current = null
    onClose()
    return true
  }
  return {
    open(owner) {
      const token = randomUUID()
      current = token
      owner?.once('destroyed', () => close(token))
      return token
    },
    close,
    active: () => current,
  }
}

/** Fechar a janela ou sair com gravação em andamento (contrato 22). */
export const RECORDING_LEAVE_MESSAGE = 'Há uma gravação em andamento. Encerre a gravação antes de sair.'

/** Botões do diálogo: bloqueado, só "Cancelar"; desbloqueado, também "Encerrar e sair" (índice 1). */
export function leaveButtons(locked: boolean): string[] {
  return locked ? ['Cancelar'] : ['Cancelar', 'Encerrar e sair']
}
