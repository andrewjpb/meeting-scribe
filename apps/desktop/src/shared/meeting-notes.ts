// Anotações da reunião em cards coloridos (contrato 13): o que a pessoa escreve durante a gravação ou
// depois, no detalhe. O main guarda em `meetings/<id>.notes.json` (esquema zod em `meeting-notes-schema.ts`,
// separado para o renderer não carregar o zod). O Markdown sai de uma função só: "Copiar anotações",
// "Baixar transcrição…" e o `.md` da pasta usam `notesMarkdown`.
import { formatClock } from './transcription'

export const NOTES_VERSION = 1
export const NOTE_TEXT_MAX = 2_000
export const NOTES_MAX = 200

export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

/** Nome acessível de cada cor, na ordem das bolinhas do card. */
export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Amarelo',
  pink: 'Rosa',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Roxo',
  orange: 'Laranja',
}

export interface MeetingNote {
  id: string
  /** Até `NOTE_TEXT_MAX` caracteres; vazio enquanto a pessoa não escreveu nada. */
  text: string
  color: NoteColor
  /** Momento da gravação (sem as pausas) em que foi criada; `null` quando criada depois, no detalhe. */
  atMs: number | null
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601. */
  updatedAt: string
}

/** Arquivo `meetings/<id>.notes.json`. */
export interface MeetingNotesFile {
  version: typeof NOTES_VERSION
  meetingId: string
  notes: MeetingNote[]
}

/** Anotação em branco não entra no Markdown, no resumo, na busca nem na contagem da lista. */
export const hasText = (note: Pick<MeetingNote, 'text'>): boolean => note.text.trim() !== ''

/**
 * Ordem de leitura: primeiro as da gravação, pelo tempo; depois as escritas no detalhe, pela criação.
 * Só as que têm texto.
 */
export function notesInOrder<T extends Pick<MeetingNote, 'text' | 'atMs' | 'createdAt'>>(notes: readonly T[]): T[] {
  // `sort` é estável: empate fica na ordem em que chegou.
  const later = (note: T): number => (note.atMs === null ? 1 : 0)
  const time = (note: T): number => note.atMs ?? Date.parse(note.createdAt)
  return notes.filter(hasText).sort((a, b) => later(a) - later(b) || time(a) - time(b))
}

/**
 * Seção "## Anotações": `- [12:34] texto` para as da gravação, `- texto` para as escritas depois. Texto de
 * várias linhas continua no mesmo item (recuo de dois espaços). Sem anotação com texto: string vazia.
 */
export function notesMarkdown(notes: readonly MeetingNote[]): string {
  const ordered = notesInOrder(notes)
  if (!ordered.length) return ''
  const items = ordered.map((note) => {
    const [first = '', ...rest] = note.text.trim().split(/\r?\n/)
    const head = note.atMs === null ? `- ${first}` : `- [${formatClock(note.atMs)}] ${first}`
    return [head, ...rest.map((line) => (line.trim() ? `  ${line}` : ''))].join('\n')
  })
  return `## Anotações\n\n${items.join('\n')}\n`
}

/** "1 anotação", "3 anotações". */
export function notesCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'anotação' : 'anotações'}`
}
