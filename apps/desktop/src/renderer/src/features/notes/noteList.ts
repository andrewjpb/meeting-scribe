// Operações na lista de anotações (contrato 13), iguais na gravação e no detalhe. Sem DOM: testadas em
// test/renderer/notes.test.ts. A lista fica da mais nova para a mais antiga, a ordem da tela.
import { NOTE_TEXT_MAX, NOTES_MAX, type MeetingNote } from '@shared/meeting-notes'

/** Anotação tirada da lista, com a posição dela, para o "Desfazer". */
export interface RemovedNote {
  note: MeetingNote
  index: number
}

export type NotePatch = Partial<Pick<MeetingNote, 'text' | 'color'>>

/** Quanto tempo o "Desfazer" fica na tela depois de excluir. */
export const NOTE_UNDO_MS = 5_000
/** Espera depois da última tecla antes de salvar. */
export const NOTE_SAVE_DELAY_MS = 500

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/** Anotação nova, sempre amarela e vazia; `atMs` é o tempo da gravação, ou `null` no detalhe. */
export function createNote(atMs: number | null, now: number, id = newId()): MeetingNote {
  const at = new Date(now).toISOString()
  return { id, text: '', color: 'yellow', atMs: atMs === null ? null : Math.max(0, Math.round(atMs)), createdAt: at, updatedAt: at }
}

/** A nova entra em cima. Com a lista cheia (200), nada muda. */
export function addNote(list: readonly MeetingNote[], note: MeetingNote): MeetingNote[] {
  return list.length >= NOTES_MAX ? [...list] : [note, ...list]
}

/** Texto ou cor novos; o texto é cortado em 2 000 caracteres. Igual ao que já estava: a mesma lista. */
export function editNote(list: readonly MeetingNote[], id: string, patch: NotePatch, now: number): MeetingNote[] {
  const next = { ...patch, ...(patch.text !== undefined ? { text: patch.text.slice(0, NOTE_TEXT_MAX) } : {}) }
  let changed = false
  const edited = list.map((note) => {
    if (note.id !== id || (Object.keys(next) as (keyof NotePatch)[]).every((key) => note[key] === next[key])) return note
    changed = true
    return { ...note, ...next, updatedAt: new Date(now).toISOString() }
  })
  return changed ? edited : (list as MeetingNote[])
}

export function removeNote(list: readonly MeetingNote[], id: string): { list: MeetingNote[]; removed: RemovedNote | null } {
  const index = list.findIndex((note) => note.id === id)
  const note = list[index]
  if (!note) return { list: [...list], removed: null }
  return { list: list.filter((item) => item.id !== id), removed: { note, index } }
}

/** "Desfazer": volta para a mesma posição (ou para o fim, se a lista encolheu); não duplica. */
export function restoreNote(list: readonly MeetingNote[], removed: RemovedNote): MeetingNote[] {
  if (list.some((note) => note.id === removed.note.id) || list.length >= NOTES_MAX) return [...list]
  const next = [...list]
  next.splice(Math.min(removed.index, next.length), 0, removed.note)
  return next
}

/**
 * Trecho mais próximo do tempo de uma anotação (pelo início do trecho), para o clique no tempo do card
 * levar à transcrição. Empate: o primeiro. Sem trecho: `null`.
 */
export function closestSegmentId(segments: readonly { id: string; startMs: number }[], atMs: number): string | null {
  let best: { id: string; startMs: number } | null = null
  for (const segment of segments) if (!best || Math.abs(segment.startMs - atMs) < Math.abs(best.startMs - atMs)) best = segment
  return best?.id ?? null
}
