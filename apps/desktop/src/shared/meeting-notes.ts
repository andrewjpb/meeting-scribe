// Anotações da reunião em cards coloridos (contrato 13): o que a pessoa escreve durante a gravação ou
// depois, no detalhe. O main guarda em `meetings/<id>.notes.json` (esquema zod em `meeting-notes-schema.ts`,
// separado para o renderer não carregar o zod). O Markdown sai de uma função só: "Copiar anotações",
// "Baixar transcrição…" e o `.md` da pasta usam `notesMarkdown`.
// Contrato 30: o card ganha título, origem (a IA anotando ao vivo), estado com o motivo de quem resolveu e a
// posição no quadro do detalhe. Tudo opcional: o arquivo continua na versão 1 e o antigo carrega igual.
import { formatClock } from './transcription'

export const NOTES_VERSION = 1
export const NOTE_TEXT_MAX = 2_000
export const NOTES_MAX = 200
export const NOTE_TITLE_MAX = 120
export const NOTE_REASON_MAX = 500

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

/** Quem criou o card; ausente vale como `manual`. */
export type NoteOrigin = 'manual' | 'ia'
/** Ausente vale como `aberta`. */
export type NoteStatus = 'aberta' | 'resolvida'

/** Por que e quando o card foi resolvido (contrato 30). */
export interface NoteResolution {
  /** Até `NOTE_REASON_MAX` caracteres; vazio quando a pessoa concluiu sem motivo. */
  reason: string
  by: 'ia' | 'manual'
  /** Momento da gravação; `null` quando resolvido depois, no detalhe. */
  atMs: number | null
  /** ISO 8601. */
  resolvedAt: string
}

/** Canto do card no quadro do detalhe, em frações (0–1) do espaço livre: sobrevive a redimensionar a janela. */
export interface NotePosition {
  x: number
  y: number
}

/** Cor fixa dos cards da IA (contrato 30). */
export const NOTE_AI_COLOR: NoteColor = 'blue'

export interface MeetingNote {
  id: string
  /** Até `NOTE_TITLE_MAX` caracteres; card sem título (o de sempre) não tem a chave. */
  title?: string
  /** Até `NOTE_TEXT_MAX` caracteres; vazio enquanto a pessoa não escreveu nada. */
  text: string
  color: NoteColor
  /** Momento da gravação (sem as pausas) em que foi criada; `null` quando criada depois, no detalhe. */
  atMs: number | null
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601. */
  updatedAt: string
  origin?: NoteOrigin
  status?: NoteStatus
  resolution?: NoteResolution
  /** Sem posição, o card fica na grade automática do quadro até ser arrastado. */
  position?: NotePosition
  /** A pessoa mexeu (texto, título ou estado) num card da IA: a IA não toca mais nele. */
  userEdited?: boolean
}

export const isAiNote = (note: Pick<MeetingNote, 'origin'>): boolean => note.origin === 'ia'
export const isResolved = (note: Pick<MeetingNote, 'status'>): boolean => note.status === 'resolvida'

/** Arquivo `meetings/<id>.notes.json`. */
export interface MeetingNotesFile {
  version: typeof NOTES_VERSION
  meetingId: string
  notes: MeetingNote[]
}

/**
 * Anotação em branco não entra no Markdown, no resumo, na busca nem na contagem da lista. Contrato 30: um card só com
 * título (o da IA sem descrição) conta.
 */
export const hasText = (note: Pick<MeetingNote, 'text'> & { title?: string | undefined }): boolean => note.text.trim() !== '' || (note.title ?? '').trim() !== ''

/** Título e texto num só: sem um deles, o outro; iguais, uma vez só. */
function titleAndText(note: Pick<MeetingNote, 'text' | 'title'>, join: (title: string, text: string) => string): string {
  const title = note.title?.replace(/\s+/g, ' ').trim() ?? ''
  const text = note.text.trim()
  if (!title) return text
  if (!text || text.replace(/\s+/g, ' ') === title) return join(title, '')
  return join(title, text)
}

/**
 * A anotação numa linha só, como vai para o Claude no resumo, na análise e no acervo (contrato 30): o título, `[IA]`
 * antes quando foi a IA que criou e `[Resolvida — motivo]` no fim quando já foi resolvida (para não virar pendência).
 */
export function noteContextText(note: Pick<MeetingNote, 'text' | 'title' | 'origin' | 'status' | 'resolution'>): string {
  const body = titleAndText(note, (title, text) => (text ? `${title} — ${text}` : title)).replace(/\s+/g, ' ')
  const reason = note.resolution?.reason.replace(/\s+/g, ' ').trim()
  const resolved = note.status === 'resolvida' ? ` [Resolvida${reason ? ` — ${reason}` : ''}]` : ''
  return `${note.origin === 'ia' ? '[IA] ' : ''}${body}${resolved}`
}

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
 * Contrato 30: com título, `- [12:34] **Título** — texto`; resolvida, mais uma linha `✔ Resolvida — motivo`.
 */
export function notesMarkdown(notes: readonly MeetingNote[]): string {
  const ordered = notesInOrder(notes)
  if (!ordered.length) return ''
  const items = ordered.map((note) => {
    const [first = '', ...rest] = titleAndText(note, (title, text) => (text ? `**${title}** — ${text}` : `**${title}**`)).split(/\r?\n/)
    const body = first
    const head = note.atMs === null ? `- ${body}` : `- [${formatClock(note.atMs)}] ${body}`
    const reason = note.resolution?.reason.replace(/\s+/g, ' ').trim()
    const resolved = isResolved(note) ? [`  ✔ Resolvida${reason ? ` — ${reason}` : ''}`] : []
    return [head, ...rest.map((line) => (line.trim() ? `  ${line}` : '')), ...resolved].join('\n')
  })
  return `## Anotações\n\n${items.join('\n')}\n`
}

/** "1 anotação", "3 anotações". */
export function notesCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'anotação' : 'anotações'}`
}
