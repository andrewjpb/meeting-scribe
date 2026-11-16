import { useEffect, useState } from 'react'
import { SEARCH_TERM_MAX, SEARCH_TERM_MIN, withSummaryStatus, type MeetingOverview, type MeetingSearchResult } from '@shared/meetings-overview'

/** Espera depois da última tecla antes de pedir a busca ao main. */
export const SEARCH_DELAY_MS = 200

/** Termo que vai para o main: sem espaços nas pontas nem repetidos; `null` se curto ou longo demais. */
export function searchTermOf(input: string): string | null {
  const term = input.trim().replace(/\s+/g, ' ')
  return term.length >= SEARCH_TERM_MIN && term.length <= SEARCH_TERM_MAX ? term : null
}

/** `null` até o main responder. */
export interface MeetingsOverviewView {
  list: MeetingOverview[] | null
  failed: boolean
  retry: () => void
}

/**
 * Reuniões com a prévia do resumo, numa chamada só (contrato 10). Um `scribe:summary-state` atualiza a linha
 * da reunião na hora (CA5), sem pedir a lista de novo.
 */
export function useMeetingsOverview(): MeetingsOverviewView {
  const [list, setList] = useState<MeetingOverview[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    const api = window.__scribeApi
    api.invoke('scribe:meetings-overview').then(
      (entries) => {
        if (alive) setList(entries)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    const off = api.on('scribe:summary-state', ({ meetingId, status }) => {
      if (!alive) return
      setList((current) => current?.map((entry) => (entry.meeting.id === meetingId ? withSummaryStatus(entry, status) : entry)) ?? current)
    })
    return () => {
      alive = false
      off()
    }
  }, [attempt])

  const retry = (): void => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  return { list, failed, retry }
}

export interface MeetingsSearchView {
  /** Há um termo válido no campo: a tela mostra a busca, não a lista. */
  active: boolean
  /**
   * Última resposta: a do termo atual ou, enquanto ele não responde, a do termo anterior (a tela não pisca).
   * `results: null` quando a busca falhou. `null` antes da primeira resposta.
   */
  shown: { term: string; results: MeetingSearchResult[] | null } | null
  /** O termo atual ainda não respondeu. */
  pending: boolean
  retry: () => void
}

/**
 * Busca no main (CA4), 200 ms depois da última tecla. Resposta de um termo que já mudou é descartada; um
 * `scribe:summary-state` atualiza os resultados como a lista.
 */
export function useMeetingsSearch(input: string): MeetingsSearchView {
  const term = searchTermOf(input)
  const [answer, setAnswer] = useState<{ term: string; results: MeetingSearchResult[] | null } | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Campo limpo: a próxima busca começa sem a resposta antiga (ajuste durante a renderização).
  const [previous, setPrevious] = useState(term)
  if (term !== previous) {
    setPrevious(term)
    if (term === null) setAnswer(null)
  }

  useEffect(() => {
    if (term === null) return
    let alive = true
    const timer = setTimeout(() => {
      window.__scribeApi.invoke('scribe:meetings-search', { term }).then(
        (results) => {
          if (alive) setAnswer({ term, results })
        },
        () => {
          if (alive) setAnswer({ term, results: null })
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [term, attempt])

  useEffect(
    () =>
      window.__scribeApi.on('scribe:summary-state', ({ meetingId, status }) => {
        setAnswer((current) =>
          current?.results
            ? { ...current, results: current.results.map((entry) => (entry.meeting.id === meetingId ? withSummaryStatus(entry, status) : entry)) }
            : current,
        )
      }),
    [],
  )

  const retry = (): void => {
    setAnswer(null)
    setAttempt((n) => n + 1)
  }

  return { active: term !== null, shown: term === null ? null : answer, pending: term !== null && answer?.term !== term, retry }
}
