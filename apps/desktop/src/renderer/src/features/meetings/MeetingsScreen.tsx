import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { MeetingFolder } from '@shared/meetings'
import type { MeetingOverview, MeetingSearchResult } from '@shared/meetings-overview'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { PageHeader } from '../../design/PageHeader'
import { TapeIllustration } from '../../design/TapeIllustration'
import { UpcomingSection } from '../calendar/UpcomingSection'
import { RetryNotice } from '../live/Notices'
import { useStartRecording } from '../live/useStartRecording'
import { FolderBar } from './FolderBar'
import { folderCounts, folderNameOf, inFolder, withMovedMeeting, withoutFolder, type FolderFilter } from './folders'
import { groupByDay, type MeetingGroup } from './format'
import { MeetingRow } from './MeetingRow'
import { RecordingNow } from './RecordingNow'
import { SearchField } from './SearchField'
import { useMeetingFolders } from './useMeetingFolders'
import { useMeetingsOverview, useMeetingsSearch } from './useMeetingsOverview'

/**
 * Reuniões gravadas neste Mac, da mais recente para a mais antiga, agrupadas por dia, com a prévia do
 * resumo e a busca no topo (contrato 10). Contrato 12: no topo, "Próximas", as reuniões da agenda. Contrato 28:
 * acima de tudo, "Gravando agora" com a gravação em curso; abaixo do cabeçalho, a barra de pastas (some na busca,
 * que continua global) e o "…" de cada linha para mover a reunião.
 */
export function MeetingsScreen() {
  const { list, failed, retry, patch } = useMeetingsOverview()
  const [query, setQuery] = useState('')
  const search = useMeetingsSearch(query)
  const startRecording = useStartRecording()
  const { folders, create, rename, remove } = useMeetingFolders()
  const [selected, setSelected] = useState<FolderFilter>('all')
  // Pasta excluída (ou que sumiu): volta para "Todas".
  const filter: FolderFilter = selected === 'all' || folders.some((folder) => folder.id === selected) ? selected : 'all'

  const moveTo = async (meetingId: string, folderId: string | null): Promise<void> => {
    const moved = await window.__scribeApi.invoke('scribe:meetings-move', { id: meetingId, folderId }).catch(() => null)
    if (!moved) return
    patch((current) => withMovedMeeting(current, moved))
    // Movida a partir da busca: os resultados mostram a pasta nova também.
    search.patch((current) => withMovedMeeting(current, moved))
  }
  const rowMove = (meetingId: string): RowMove => ({
    folders,
    onMove: (folderId) => void moveTo(meetingId, folderId),
    onMoveToNew: (name) =>
      void create(name).then((folder) => {
        if (folder) return moveTo(meetingId, folder.id)
      }),
  })
  const deleteFolder = (id: string): void =>
    void remove(id).then((removed) => {
      if (!removed) return
      patch((current) => withoutFolder(current, id))
      search.patch((current) => withoutFolder(current, id))
    })

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
        <RecordingNow className="mt-7" />
        <RetryNotice id="list-failed" text="Não foi possível ler as reuniões deste Mac." onRetry={retry} className="mt-7 max-w-[820px]" />
      </div>
    )
  }
  if (list === null) return <div className="flex-1" aria-busy="true" />

  if (!list.length) {
    return (
      <div className="flex flex-1 flex-col px-10 pt-7 pb-10">
        <PageHeader title="Reuniões" />
        <RecordingNow className="mt-7" />
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
  // A pasta só aparece na linha com o filtro "Todas" (e na busca, que é global).
  const rowOptions = { folders, showFolder: filter === 'all' || shown !== null, rowMove }
  if (shown === null) {
    // Sem termo, ou até a primeira resposta dele: a lista inteira (ou a da pasta selecionada).
    const rows = inFolder(list, filter)
    body = rows.length ? (
      <DayGroups groups={groupByDay(rows, now, (entry) => entry.meeting)} {...rowOptions} />
    ) : (
      <div className="pt-10">
        <EmptyState illustration={<TapeIllustration />} title="Nenhuma reunião nesta pasta">
          Mova reuniões para cá pelo "…" de cada linha.
        </EmptyState>
      </div>
    )
  } else if (shown.results === null) {
    body = <RetryNotice id="search-failed" text="Não foi possível buscar nas reuniões deste Mac." onRetry={search.retry} className="max-w-[820px]" />
  } else if (!shown.results.length) {
    body = (
      <p data-search-empty className="max-w-[820px] text-13 text-text-muted">
        Nada encontrado para "{shown.term}".
      </p>
    )
  } else {
    body = <DayGroups groups={groupByDay(shown.results, now, (entry) => entry.meeting)} {...rowOptions} />
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
        <RecordingNow />
        {shown === null && (
          <FolderBar
            folders={folders}
            counts={folderCounts(list)}
            selected={filter}
            onSelect={setSelected}
            onCreate={(name) => void create(name)}
            onRename={(id, name) => void rename(id, name)}
            onDelete={deleteFolder}
          />
        )}
        {shown === null && <UpcomingSection className="pb-7" />}
        {body}
      </div>
    </div>
  )
}

type RowMove = { folders: readonly MeetingFolder[]; onMove: (folderId: string | null) => void; onMoveToNew: (name: string) => void }

interface DayGroupsProps {
  groups: MeetingGroup<MeetingOverview | MeetingSearchResult>[]
  folders: readonly MeetingFolder[]
  showFolder: boolean
  rowMove: (meetingId: string) => RowMove
}

function DayGroups({ groups, folders, showFolder, rowMove }: DayGroupsProps) {
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
            <MeetingRow
              entry={entry}
              found={'field' in entry ? { field: entry.field, snippet: entry.snippet } : undefined}
              folderName={showFolder ? folderNameOf(entry.meeting, folders) : null}
              move={rowMove(entry.meeting.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  ))
}
