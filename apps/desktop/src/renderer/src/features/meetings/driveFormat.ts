// Linha "Google Drive" da aba "Áudio" (contrato 11, CA6). Função pura, testada à parte.
import { DRIVE_ERROR_TEXT, type DriveMeetingStatus } from '@shared/accounts'

/** Texto do estado e a ação que a linha oferece; `null` quando a linha não aparece. */
export function driveStatusLine(status: DriveMeetingStatus | null): { text: string; action: 'open' | 'retry' | null } | null {
  if (!status) return null
  switch (status.state) {
    case 'hidden':
      return null
    case 'uploading':
      return { text: `Enviando… ${status.percent}%`, action: null }
    case 'done':
      return { text: 'No Drive', action: 'open' }
    case 'offline':
      return { text: 'Aguardando internet', action: null }
    case 'error':
      return { text: `Erro: ${DRIVE_ERROR_TEXT[status.reason]}`, action: 'retry' }
  }
}

/** Ícone de nuvem da lista depois de um `scribe:drive-state`: some só quando a reunião sai do Drive. */
export function inDriveAfter(previous: boolean, status: DriveMeetingStatus): boolean {
  if (status.state === 'done') return true
  if (status.state === 'hidden') return false
  return previous
}
