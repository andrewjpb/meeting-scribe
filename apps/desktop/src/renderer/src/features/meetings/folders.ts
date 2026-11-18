// Pastas na lista de Reuniões (contrato 28): o filtro roda aqui, sobre as linhas que o overview já trouxe. A
// seleção não persiste; "Todas" é a lista de sempre.
import type { Meeting, MeetingFolder } from '@shared/meetings'
import type { MeetingOverview } from '@shared/meetings-overview'

/** `all` ou o id da pasta selecionada. */
export type FolderFilter = 'all' | (string & {})

/** As linhas da pasta selecionada; "Todas" devolve a lista como veio. */
export function inFolder<T extends Pick<MeetingOverview, 'meeting'>>(entries: readonly T[], filter: FolderFilter): T[] {
  return filter === 'all' ? [...entries] : entries.filter((entry) => entry.meeting.folderId === filter)
}

/** Quantas reuniões cada pasta tem (pasta sem reunião não aparece no mapa). */
export function folderCounts(entries: readonly Pick<MeetingOverview, 'meeting'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { meeting } of entries) if (meeting.folderId) counts.set(meeting.folderId, (counts.get(meeting.folderId) ?? 0) + 1)
  return counts
}

/** A reunião movida (o que `scribe:meetings-move` devolveu) no lugar da antiga, sem reler a lista. */
export function withMovedMeeting<T extends Pick<MeetingOverview, 'meeting'>>(entries: readonly T[], moved: Meeting): T[] {
  return entries.map((entry) => (entry.meeting.id === moved.id ? { ...entry, meeting: { ...entry.meeting, folderId: moved.folderId ?? null } } : entry))
}

/** Pasta excluída: as reuniões dela ficam fora de pasta (nenhuma some da lista). */
export function withoutFolder<T extends Pick<MeetingOverview, 'meeting'>>(entries: readonly T[], folderId: string): T[] {
  return entries.map((entry) => (entry.meeting.folderId === folderId ? { ...entry, meeting: { ...entry.meeting, folderId: null } } : entry))
}

/** Nome da pasta da reunião, para a linha de meta; `null` fora de pasta ou pasta que já não existe. */
export function folderNameOf(meeting: Pick<Meeting, 'folderId'>, folders: readonly MeetingFolder[]): string | null {
  if (!meeting.folderId) return null
  return folders.find((folder) => folder.id === meeting.folderId)?.name ?? null
}
