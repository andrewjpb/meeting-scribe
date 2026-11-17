import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { MeetingOverview, MeetingSearchResult } from '@shared/meetings-overview'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { PageHeader } from '../../design/PageHeader'
import { TapeIllustration } from '../../design/TapeIllustration'
import { UpcomingSection } from '../calendar/UpcomingSection'
import { RetryNotice } from '../live/Notices'
import { useStartRecording } from '../live/useStartRecording'
import { groupByDay, type MeetingGroup } from './format'
import { MeetingRow } from './MeetingRow'
import { SearchField } from './SearchField'
import { useMeetingsOverview, useMeetingsSearch } from './useMeetingsOverview'

/**
 * Reuniões gravadas neste Mac, da mais recente para a mais antiga, agrupadas por dia, com a prévia do
 * resumo e a busca no topo (contrato 10). Contrato 12: no topo, "Próximas", as reuniões da agenda.
 */
export function MeetingsScreen() {
  const { list, failed, retry } = useMeetingsOverview()
  const [query, setQuery] = useState('')
  const search = useMeetingsSearch(query)
  const startRecording = useStartRecording()

  const newRecording = (
    <Button action="new-recording" onClick={startRecording} icon={Plus} shortcut="⌘N" ariaShortcut="Meta+N">
      Nova gravação
    </Button>
  )

  // A leitura do arquivo local leva poucos milissegundos: nada aparece até ela voltar, para o estado
  // vazio não piscar antes da lista.
  if (list === null && failed) {
    return (
      <div className="flex flex-1 flex-col px-10 pt-7">
        <PageHeader title="Reuniões" actions={newRecording} />
        <RetryNotice id="list-failed" text="Não foi possível ler as reuniões deste Mac." onRetry={retry} className="mt-7 max-w-[820px]" />
      </div>
    )
  }
  if (list === null) return <div className="flex-1" aria-busy="true" />

  if (!list.length) {
    return (
      <div className="flex flex-1 flex-col px-10 pt-7 pb-10">
        <PageHeader title="Reuniões" />
        <UpcomingSection className="mt-7" />
        <div className="grow-[3]" />
        <EmptyState illustration={<TapeIllustration />} title="Nenhuma reunião ainda" action={newRecording}>
          As gravações ficam neste Mac e aparecem aqui, da mais recente para a mais antiga.
        </EmptyState>
        <div className="grow-[7]" />
      </div>
    )
  }

  const now = new Date()
  let body
  const shown = search.active ? search.shown : null
  if (shown === null) {
    // Sem termo, ou até a primeira resposta dele: a lista inteira.
    body = <DayGroups groups={groupByDay(list, now, (entry) => entry.meeting)} />
  } else if (shown.results === null) {
    body = <RetryNotice id="search-failed" text="Não foi possível buscar nas reuniões deste Mac." onRetry={search.retry} className="max-w-[820px]" />
  } else if (!shown.results.length) {
    body = (
      <p data-search-empty className="max-w-[820px] text-13 text-text-muted">
        Nada encontrado para "{shown.term}".
      </p>
    )
  } else {
    body = <DayGroups groups={groupByDay(shown.results, now, (entry) => entry.meeting)} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-7">
        <PageHeader
          title="Reuniões"
          actions={
            <>
              <SearchField value={query} onChange={setQuery} />
              {newRecording}
            </>
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-7 pb-10" aria-busy={search.pending}>
        {shown === null && <UpcomingSection className="pb-7" />}
        {body}
      </div>
    </div>
  )
}

function DayGroups({ groups }: { groups: MeetingGroup<MeetingOverview | MeetingSearchResult>[] }) {
  return groups.map((group) => (
    <section key={group.key} aria-label={group.label} data-day={group.key} className="max-w-[820px] pt-7 first:pt-0">
      <div className="flex items-baseline justify-between gap-4 border-b border-line-strong pb-2">
        <h2 className="text-12 font-bold text-text-muted">{group.label}</h2>
        <span data-day-total className="text-12 text-text-muted tabular">
          {group.total}
        </span>
      </div>
      <ul>
        {group.items.map((entry) => (
          <li key={entry.meeting.id} className="border-b border-line">
            <MeetingRow entry={entry} found={'field' in entry ? { field: entry.field, snippet: entry.snippet } : undefined} />
          </li>
        ))}
      </ul>
    </section>
  ))
}
