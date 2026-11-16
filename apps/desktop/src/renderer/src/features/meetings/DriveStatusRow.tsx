import { useEffect, useState } from 'react'
import type { DriveMeetingStatus } from '@shared/accounts'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { driveStatusLine } from './driveFormat'

/**
 * Linha "Google Drive" da aba "Áudio" (contrato 11, CA6): "Enviando… 45%", "No Drive" com "Abrir no Drive",
 * "Aguardando internet" ou "Erro: …" com "Tentar de novo". O estado vem do main e acompanha a fila por
 * `scribe:drive-state`; sem conta e sem nada enviado, a linha não aparece.
 */
export function DriveStatusRow({ meetingId, rowClass, actionClass }: { meetingId: string; rowClass: string; actionClass: string }) {
  const [status, setStatus] = useState<DriveMeetingStatus | null>(null)

  useEffect(() => {
    let alive = true
    let reread: (() => void) | null = null
    const read = (): void => {
      window.__scribeApi.invoke('scribe:drive-status', { meetingId }).then(
        (next) => {
          if (alive) setStatus(next)
        },
        // Recusada com o app bloqueado (contrato 22): relê no desbloqueio.
        (error: unknown) => {
          if (alive) reread = rereadWhenUnlocked(error, read)
        },
      )
    }
    read()
    const off = window.__scribeApi.on('scribe:drive-state', (event) => {
      if (alive && event.meetingId === meetingId) setStatus(event.status)
    })
    return () => {
      alive = false
      reread?.()
      off()
    }
  }, [meetingId])

  const line = driveStatusLine(status)
  if (!line || !status) return null

  const open = (): void => void window.__scribeApi.invoke('scribe:drive-open', { meetingId }).catch(() => undefined)
  const retry = (): void => {
    window.__scribeApi.invoke('scribe:drive-retry', { meetingId }).then(setStatus, () => undefined)
  }

  return (
    <li data-drive-status={status.state} className={rowClass}>
      <span className="w-24 shrink-0 text-12 font-medium text-text-muted">Google Drive</span>
      <span data-drive-text className={`min-w-0 flex-1 truncate text-13 tabular ${status.state === 'error' ? 'text-rec' : 'text-text'}`} aria-live="polite">
        {line.text}
      </span>
      {line.action === 'open' && (
        <button type="button" data-action="drive-open" onClick={open} className={actionClass}>
          Abrir no Drive
        </button>
      )}
      {line.action === 'retry' && (
        <button type="button" data-action="drive-retry" onClick={retry} className={actionClass}>
          Tentar de novo
        </button>
      )}
    </li>
  )
}
