import { useCallback, useEffect, useState } from 'react'
import type { SummaryStatus } from '@shared/meeting-summary'
import { rereadWhenUnlocked } from '../../app/lockStore'

/** `loading` até o main responder. */
export type SummaryView = SummaryStatus | { state: 'loading' }

/**
 * Estado do resumo de uma reunião (contrato 08). Lê do main ao abrir e acompanha `scribe:summary-state`:
 * a aba atualiza sozinha quando o resumo termina, inclusive o que começou ao encerrar a gravação. O
 * estado guarda de qual reunião é: trocar de reunião volta a `loading` sem efeito extra.
 */
export function useSummary(meetingId: string): { view: SummaryView; generate: () => void } {
  const [entry, setEntry] = useState<{ meetingId: string; view: SummaryStatus } | null>(null)
  const view: SummaryView = entry?.meetingId === meetingId ? entry.view : { state: 'loading' }

  useEffect(() => {
    let alive = true
    const api = window.__scribeApi
    const off = api.on('scribe:summary-state', (payload) => {
      if (alive && payload.meetingId === meetingId) setEntry({ meetingId, view: payload.status })
    })
    // Um evento que chegou antes da leitura vale mais que ela: a leitura só preenche o que ainda falta.
    const fill = (status: SummaryStatus): void => {
      if (alive) setEntry((current) => (current?.meetingId === meetingId ? current : { meetingId, view: status }))
    }
    // Recusada com o app bloqueado (contrato 22): relê no desbloqueio.
    let reread: (() => void) | null = null
    const read = (): void => {
      api.invoke('scribe:summary-get', { meetingId }).then(fill, (error: unknown) => {
        reread = alive ? rereadWhenUnlocked(error, read) : null
        if (!reread) fill({ state: 'none' })
      })
    }
    read()
    return () => {
      alive = false
      reread?.()
      off()
    }
  }, [meetingId])

  const generate = useCallback(() => {
    setEntry({ meetingId, view: { state: 'generating' } })
    // A resposta só vale se não for "gerando" (reunião sem trecho, por exemplo); o fim chega pelo evento.
    const settle = (status: SummaryStatus): void =>
      setEntry((current) => (current?.meetingId === meetingId && current.view.state === 'generating' && status.state !== 'generating' ? { meetingId, view: status } : current))
    window.__scribeApi.invoke('scribe:summary-generate', { meetingId }).then(settle, () => settle({ state: 'error', error: 'failed', summary: null }))
  }, [meetingId])

  return { view, generate }
}
