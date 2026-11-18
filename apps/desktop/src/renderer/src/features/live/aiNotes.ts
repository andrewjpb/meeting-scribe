// IA anotando ao vivo (contrato 30, CA2), a parte sem DOM: o que vai em cada ciclo. Testada em
// test/renderer/ai-notes.test.ts. Quem dirige o relógio e aplica o lote é o `recordingStore`.
import { AI_NOTES_MIN_CHARS, AI_NOTES_OPEN_MAX, AI_NOTES_TITLES_MAX, type AiNotesOpenCard } from '@shared/ai-notes'
import type { LiveAnalysisSegment } from '@shared/meeting-analysis'
import { NOTE_TITLE_MAX, type MeetingNote } from '@shared/meeting-notes'
import type { TranscriptionSegment } from '../../transcription/store'
import { aiCanTouch } from '../notes/noteList'

/** Trechos do ciclo: os ids (para marcar como enviados) e o que vai no pedido. */
export interface AiNotesSelection {
  ids: string[]
  segments: LiveAnalysisSegment[]
  /** Caracteres de fala nova (sem os espaços das pontas). */
  chars: number
}

/**
 * Só os trechos finais NOVOS desde o último ciclo: a mesma seleção da análise (finais, sem eco, com texto), menos os
 * que um ciclo já mandou (`sent`). Com nomes do Meet (contrato 27), o trecho do sistema leva os de quem falava.
 */
export function aiNotesSelection(segments: readonly TranscriptionSegment[], sent: ReadonlySet<string>, names: (segment: TranscriptionSegment) => readonly string[] = () => []): AiNotesSelection {
  const picked = segments.filter((segment) => !segment.partial && !segment.echo && segment.text.trim() !== '' && !sent.has(segment.id))
  return {
    ids: picked.map((segment) => segment.id),
    segments: picked.map((segment) => {
      const { source, speaker, startMs, endMs, text } = segment
      const found = names(segment)
      return { source, speaker, startMs, endMs, text, ...(found.length ? { names: [...found] } : {}) }
    }),
    chars: picked.reduce((total, segment) => total + segment.text.trim().length, 0),
  }
}

/** Pouca fala nova: o ciclo é pulado e o relógio reinicia (os trechos ficam para o próximo). */
export const aiNotesShouldSkip = (selection: Pick<AiNotesSelection, 'chars'>): boolean => selection.chars < AI_NOTES_MIN_CHARS

/** Cards que a IA ainda pode resolver (dela, abertos, sem mexida da pessoa), até 50, como vão no pedido. */
export function aiNotesOpenCards(notes: readonly MeetingNote[]): AiNotesOpenCard[] {
  return notes
    .filter(aiCanTouch)
    .slice(0, AI_NOTES_OPEN_MAX)
    .map((note) => ({ id: note.id, title: note.title ?? '', text: note.text }))
}

/** Títulos de todos os cards (para a IA não repetir assunto), sem repetir, até 200. */
export function aiNotesKnownTitles(notes: readonly MeetingNote[]): string[] {
  const titles = new Set<string>()
  for (const note of notes) {
    const title = note.title?.replace(/\s+/g, ' ').trim().slice(0, NOTE_TITLE_MAX)
    if (title) titles.add(title)
    if (titles.size >= AI_NOTES_TITLES_MAX) break
  }
  return [...titles]
}
