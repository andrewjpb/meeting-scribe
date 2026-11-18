// Operações na lista de anotações (contrato 13), iguais na gravação e no detalhe. Sem DOM: testadas em
// test/renderer/notes.test.ts. A lista fica da mais nova para a mais antiga, a ordem da tela.
// Contrato 30: título, resolver com motivo, reabrir, mover no quadro e o lote da IA anotando ao vivo.
import type { AiNotesBatch } from '@shared/ai-notes'
import { isAiNote, isResolved, NOTE_AI_COLOR, NOTE_REASON_MAX, NOTE_TEXT_MAX, NOTE_TITLE_MAX, NOTES_MAX, type MeetingNote, type NotePosition } from '@shared/meeting-notes'

/** Anotação tirada da lista, com a posição dela, para o "Desfazer". */
export interface RemovedNote {
  note: MeetingNote
  index: number
}

export type NotePatch = Partial<Pick<MeetingNote, 'text' | 'color'>> & { title?: string }

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

/**
 * "Virar anotação" de um item da análise (contrato 19, CA4): um card amarelo já com o texto (cortado em
 * 2 000 caracteres) e o tempo do item ou da análise.
 */
export function noteWithText(text: string, atMs: number | null, now: number, id = newId()): MeetingNote {
  return { ...createNote(atMs, now, id), text: text.slice(0, NOTE_TEXT_MAX) }
}

/** A nova entra em cima. Com a lista cheia (200), nada muda. */
export function addNote(list: readonly MeetingNote[], note: MeetingNote): MeetingNote[] {
  return list.length >= NOTES_MAX ? [...list] : [note, ...list]
}

/**
 * Texto, título ou cor novos; o texto é cortado em 2 000 caracteres e o título em 120. Igual ao que já estava: a
 * mesma lista. Texto ou título mexidos num card da IA o marcam `userEdited` (a IA não toca mais nele).
 */
export function editNote(list: readonly MeetingNote[], id: string, patch: NotePatch, now: number): MeetingNote[] {
  const next: NotePatch = {
    ...patch,
    ...(patch.text !== undefined ? { text: patch.text.slice(0, NOTE_TEXT_MAX) } : {}),
    ...(patch.title !== undefined ? { title: patch.title.slice(0, NOTE_TITLE_MAX) } : {}),
  }
  let changed = false
  const edited = list.map((note) => {
    if (note.id !== id || (Object.keys(next) as (keyof NotePatch)[]).every((key) => note[key] === next[key])) return note
    changed = true
    const touched = isAiNote(note) && ((next.text !== undefined && next.text !== note.text) || (next.title !== undefined && next.title !== note.title))
    return { ...note, ...next, ...(touched ? { userEdited: true } : {}), updatedAt: new Date(now).toISOString() }
  })
  return changed ? edited : (list as MeetingNote[])
}

/** Troca um card da lista; sem o id (ou sem mudança), a mesma lista. */
function replaceNote(list: readonly MeetingNote[], id: string, change: (note: MeetingNote) => MeetingNote | null): MeetingNote[] {
  let changed = false
  const next = list.map((note) => {
    if (note.id !== id) return note
    const updated = change(note)
    if (!updated) return note
    changed = true
    return updated
  })
  return changed ? next : (list as MeetingNote[])
}

/**
 * "Concluir" (ou a IA resolvendo): estado `resolvida` com o motivo (cortado em 500), quem resolveu e quando. Já
 * resolvido: a mesma lista, a não ser que a IA tenha resolvido e agora seja a pessoa: o motivo dela vale (ela pode
 * ter aberto o campo antes de o ciclo chegar). A pessoa concluindo um card da IA o marca `userEdited`.
 */
export function resolveNote(list: readonly MeetingNote[], id: string, resolution: { reason: string; by: 'ia' | 'manual'; atMs: number | null }, now: number): MeetingNote[] {
  const at = new Date(now).toISOString()
  return replaceNote(list, id, (note) => {
    if (isResolved(note) && !(note.resolution?.by === 'ia' && resolution.by === 'manual')) return null
    const reason = resolution.reason.trim().slice(0, NOTE_REASON_MAX).trim()
    const atMs = resolution.atMs === null ? null : Math.max(0, Math.round(resolution.atMs))
    return {
      ...note,
      status: 'resolvida',
      resolution: { reason, by: resolution.by, atMs, resolvedAt: at },
      ...(resolution.by === 'manual' && isAiNote(note) ? { userEdited: true } : {}),
      updatedAt: at,
    }
  })
}

/** "Reabrir": volta a `aberta` e o motivo sai. Sempre pela pessoa: num card da IA, marca `userEdited`. */
export function reopenNote(list: readonly MeetingNote[], id: string, now: number): MeetingNote[] {
  return replaceNote(list, id, (note) => {
    if (!isResolved(note)) return null
    const { resolution: _resolution, ...rest } = note
    return { ...rest, status: 'aberta', ...(isAiNote(note) ? { userEdited: true } : {}), updatedAt: new Date(now).toISOString() }
  })
}

/** Fração de 0 a 1 (o que não é número vira 0). */
const unit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Posição no quadro sempre dentro dele: cada eixo entre 0 e 1. */
export function clampPosition(position: NotePosition): NotePosition {
  return { x: unit(position.x), y: unit(position.y) }
}

/** Soltar o card no quadro: a posição nova (dentro do quadro). Igual à que estava: a mesma lista. */
export function moveNote(list: readonly MeetingNote[], id: string, position: NotePosition, now: number): MeetingNote[] {
  const next = clampPosition(position)
  return replaceNote(list, id, (note) => (note.position?.x === next.x && note.position.y === next.y ? null : { ...note, position: next, updatedAt: new Date(now).toISOString() }))
}

/** Card novo da IA: azul, com título e descrição (sem descrição, o texto fica vazio e o card mostra só o título), aberto. */
export function aiNote(title: string, description: string, atMs: number | null, now: number, id = newId()): MeetingNote {
  const cleanTitle = title.trim().slice(0, NOTE_TITLE_MAX)
  const text = description.trim().slice(0, NOTE_TEXT_MAX)
  return { ...createNote(atMs, now, id), title: cleanTitle, text, color: NOTE_AI_COLOR, origin: 'ia', status: 'aberta' }
}

/** O card que a IA ainda pode resolver: dela, aberto e que a pessoa não mexeu. */
export const aiCanTouch = (note: MeetingNote): boolean => isAiNote(note) && !isResolved(note) && note.userEdited !== true

const titleKey = (title: string): string => title.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Aplica o lote de um ciclo da IA (contrato 30, CA2): os novos entram em cima (sem repetir título que já existe, até
 * a lista encher); os resolvidos mudam de estado só se a IA ainda puder tocar no card. A IA nunca apaga nem edita
 * texto, e card manual, editado pela pessoa ou já resolvido fica como está. `atMs` é o momento da gravação agora
 * (vale para o card que veio sem tempo e para o momento da resolução).
 */
export function applyAiBatch(list: readonly MeetingNote[], batch: AiNotesBatch, atMs: number, now: number, makeId: () => string = newId): MeetingNote[] {
  let next = [...list]
  for (const item of batch.resolved) {
    const note = next.find((candidate) => candidate.id === item.id)
    if (note && aiCanTouch(note)) next = resolveNote(next, item.id, { reason: item.reason, by: 'ia', atMs }, now)
  }
  const titles = new Set(next.flatMap((note) => (note.title ? [titleKey(note.title)] : [])))
  for (const item of batch.created) {
    const key = titleKey(item.title)
    if (!key || titles.has(key) || next.length >= NOTES_MAX) continue
    titles.add(key)
    const at = item.atMs !== undefined && item.atMs <= atMs ? item.atMs : atMs
    next = addNote(next, aiNote(item.title, item.description, at, now, makeId()))
  }
  return next
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
