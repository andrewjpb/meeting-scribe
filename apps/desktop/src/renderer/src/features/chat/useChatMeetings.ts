import { useEffect, useMemo, useState } from 'react'
import type { MeetingOverview } from '@shared/meetings-overview'
import { frequentWord } from './format'

export interface ChatMeetings {
  /** `null` até o main responder (ou se falhar). */
  list: MeetingOverview[] | null
  /** Reunião pelo id, para o título e a data das consultadas. */
  byId: ReadonlyMap<string, MeetingOverview>
  /** Primeiro nome de um participante da agenda (o da reunião mais recente que tem agenda). */
  participant: string | null
  /** Palavra que mais aparece nos títulos e nos resumos. */
  topic: string | null
}

/** Primeiro nome do primeiro participante da agenda com nome. */
function firstAttendee(entries: readonly MeetingOverview[]): string | null {
  const person = entries.flatMap((entry) => entry.meeting.calendar?.attendees ?? []).find((attendee) => attendee.name.trim() !== '')
  return person ? (person.name.trim().split(/\s+/)[0] ?? null) : null
}

/**
 * Reuniões deste Mac para a tela "Perguntar" (contrato 16): a lista do escopo, o título e a data das
 * consultadas, e o participante e a palavra das sugestões. Com `meetingId`, as sugestões saem só dela.
 */
export function useChatMeetings(meetingId: string | null = null): ChatMeetings {
  const [list, setList] = useState<MeetingOverview[] | null>(null)

  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:meetings-overview').then(
      (entries) => {
        if (alive) setList(entries)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  return useMemo(() => {
    const entries = list ?? []
    const source = meetingId ? entries.filter((entry) => entry.meeting.id === meetingId) : entries
    return {
      list,
      byId: new Map(entries.map((entry) => [entry.meeting.id, entry])),
      participant: firstAttendee(source),
      topic: frequentWord(source.flatMap((entry) => [entry.meeting.title, entry.summary?.overview ?? ''])),
    }
  }, [list, meetingId])
}
