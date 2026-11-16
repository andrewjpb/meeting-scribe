import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisError, MeetingAnalysis } from '@shared/meeting-analysis'

export interface AnalysesView {
  /** `null` até o main responder. */
  analyses: MeetingAnalysis[] | null
  analyzing: boolean
  error: AnalysisError | null
}

/**
 * Análises salvas de uma reunião (contrato 19, CA6) e "Analisar a reunião inteira": a nova volta já salva
 * pelo main e entra no fim da lista. O estado guarda de qual reunião é: trocar de reunião volta ao começo.
 */
export function useAnalyses(meetingId: string): { view: AnalysesView; analyze: () => void } {
  const [entry, setEntry] = useState<{ meetingId: string; view: AnalysesView } | null>(null)
  const view: AnalysesView = entry?.meetingId === meetingId ? entry.view : { analyses: null, analyzing: false, error: null }
  /** Reunião com uma análise em curso pedida por esta tela: outro clique não pede de novo. */
  const running = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    const fill = (analyses: MeetingAnalysis[]): void => {
      if (alive) setEntry((current) => (current?.meetingId === meetingId && current.view.analyses ? current : { meetingId, view: { analyses, analyzing: current?.meetingId === meetingId && current.view.analyzing, error: null } }))
    }
    window.__scribeApi.invoke('scribe:analyses-get', { meetingId }).then(fill, () => fill([]))
    // Mudou no main (uma análise da gravação que chegou depois do "Encerrar", outra janela): relê.
    const off = window.__scribeApi.on('scribe:analyses-changed', (payload) => {
      if (payload.meetingId !== meetingId) return
      window.__scribeApi.invoke('scribe:analyses-get', { meetingId }).then(
        (analyses) => {
          if (alive) setEntry((current) => ({ meetingId, view: { ...(current?.meetingId === meetingId ? current.view : { analyzing: false, error: null }), analyses } }))
        },
        () => undefined,
      )
    })
    return () => {
      alive = false
      off()
    }
  }, [meetingId])

  const analyze = useCallback(() => {
    const patch = (next: (current: AnalysesView) => AnalysesView): void =>
      setEntry((current) => {
        const base = current?.meetingId === meetingId ? current.view : { analyses: null, analyzing: false, error: null }
        return { meetingId, view: next(base) }
      })
    if (running.current === meetingId) return
    running.current = meetingId
    patch((current) => ({ ...current, analyzing: true, error: null }))
    const done = (): void => {
      if (running.current === meetingId) running.current = null
    }
    window.__scribeApi.invoke('scribe:analysis-run', { meetingId }).then(
      (result) => {
        done()
        patch((current) =>
          result.ok ? { analyses: [...(current.analyses ?? []), result.analysis], analyzing: false, error: null } : { ...current, analyzing: false, error: result.error },
        )
      },
      () => {
        done()
        patch((current) => ({ ...current, analyzing: false, error: 'failed' }))
      },
    )
  }, [meetingId])

  return { view, analyze }
}
