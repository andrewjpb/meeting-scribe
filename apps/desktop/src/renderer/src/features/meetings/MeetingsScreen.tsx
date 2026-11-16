import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Meeting } from '@shared/meetings'
import { meetingPath } from '@shared/routes'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { PageHeader } from '../../design/PageHeader'
import { TapeIllustration } from '../../design/TapeIllustration'
import { RetryNotice } from '../live/Notices'
import { useStartRecording } from '../live/useStartRecording'
import { durationLabel, groupByDay, timeLabel } from './format'
import { SourceDots } from './SourceDots'

/** Reuniões gravadas neste Mac, da mais recente para a mais antiga, agrupadas por dia. */
export function MeetingsScreen() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const startRecording = useStartRecording()

  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:meetings-list').then(
      (list) => {
        if (alive) setMeetings(list)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const retry = (): void => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  const newRecording = (
    <Button action="new-recording" onClick={startRecording} icon={Plus} shortcut="⌘N" ariaShortcut="Meta+N">
      Nova gravação
    </Button>
  )

  // A leitura do arquivo local leva poucos milissegundos: nada aparece até ela voltar, para o estado
  // vazio não piscar antes da lista.
  if (meetings === null && failed) {
    return (
      <div className="flex flex-1 flex-col px-10 pt-7">
        <PageHeader title="Reuniões" actions={newRecording} />
        <RetryNotice id="list-failed" text="Não foi possível ler as reuniões deste Mac." onRetry={retry} className="mt-7 max-w-[820px]" />
      </div>
    )
  }
  if (meetings === null) return <div className="flex-1" aria-busy="true" />

  if (!meetings.length) {
    return (
      <div className="flex flex-1 flex-col px-10 pt-7 pb-10">
        <PageHeader title="Reuniões" />
        <div className="grow-[3]" />
        <EmptyState illustration={<TapeIllustration />} title="Nenhuma reunião ainda" action={newRecording}>
          As gravações ficam neste Mac e aparecem aqui, da mais recente para a mais antiga.
        </EmptyState>
        <div className="grow-[7]" />
      </div>
    )
  }

  const groups = groupByDay(meetings, new Date())
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-7">
        <PageHeader title="Reuniões" actions={newRecording} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-7 pb-10">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label} className="max-w-[820px] pt-7 first:pt-0">
            <h2 className="border-b border-line-strong pb-2 text-12 font-bold text-text-muted">{group.label}</h2>
            <ul>
              {group.meetings.map((meeting) => (
                <li key={meeting.id} className="border-b border-line">
                  <MeetingRow meeting={meeting} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
  const started = new Date(meeting.startedAt)
  return (
    <Link
      to={meetingPath(meeting.id)}
      data-meeting={meeting.id}
      draggable={false}
      className="flex min-h-16 items-center gap-4 px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <p className="truncate text-15 font-medium text-text">{meeting.title}</p>
        <p className="text-12 text-text-muted tabular">
          {timeLabel(started)} · {durationLabel(meeting.durationMs)}
        </p>
      </div>
      <SourceDots sources={meeting.sources} />
    </Link>
  )
}
