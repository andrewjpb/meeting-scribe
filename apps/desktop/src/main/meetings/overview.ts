// Índice leve da tela de Reuniões (contrato 10): a lista com a prévia do resumo e o número de anotações
// (contrato 13) numa chamada só e a busca em título, transcrição, resumo e anotações, sem diferenciar maiúsculas nem acentos. A busca é por palavras: a
// reunião entra quando todas aparecem, mesmo em campos diferentes. Tudo no main e no disco local:
// nenhum texto sai do Mac. O texto de cada reunião fica em memória, já normalizado, e só é relido quando
// o arquivo dela muda (inode, data e tamanho); a lista aquece o índice em segundo plano para a primeira
// busca não esperar a leitura das transcrições.
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { notesInOrder } from '../../shared/meeting-notes'
import type { MeetingSummary } from '../../shared/meeting-summary'
import type { Meeting } from '../../shared/meetings'
import {
  SEARCH_SNIPPET_MAX,
  SEARCH_TERM_MAX,
  SEARCH_TERM_MIN,
  summaryPreview,
  type ListSummaryState,
  type MeetingOverview,
  type MeetingSearchResult,
  type SearchField,
  type SnippetPart,
} from '../../shared/meetings-overview'
import { notesPath, type NotesStore } from './notes'
import type { MeetingsStore } from './store'
import { summaryPath, type SummaryStore } from './summaries'
import { transcriptPath, type TranscriptStore } from './transcripts'

/** O que o serviço de resumo sabe e o disco não: gerando agora ou falhou nesta execução do app. */
export type SummaryActivity = 'generating' | 'error' | null

export interface MeetingsIndexDeps {
  /** `userData`, onde ficam `meetings/<id>.json` e `meetings/<id>.summary.json`. */
  dir: string
  meetings: Pick<MeetingsStore, 'list'>
  transcripts: Pick<TranscriptStore, 'get'>
  summaries: Pick<SummaryStore, 'get'>
  /** Anotações (contrato 13): "N anotações" na lista e a busca "nas anotações". */
  notes?: Pick<NotesStore, 'get'>
  activity: (meetingId: string) => SummaryActivity
}

export interface MeetingsIndex {
  /** `scribe:meetings-overview`: todas as reuniões, da mais recente para a mais antiga. */
  overview(): Promise<MeetingOverview[]>
  /** `scribe:meetings-search`: termo de 2 a 100 caracteres; fora disso, erro. */
  search(term: unknown): Promise<MeetingSearchResult[]>
  /** Teste: termina quando o aquecimento disparado pela lista acabar. */
  warmed(): Promise<void>
}

const termSchema = z.string().trim().min(SEARCH_TERM_MIN).max(SEARCH_TERM_MAX)

const foldCache = new Map<string, string>()

/** Um caractere sem acento e em minúscula, sempre do mesmo tamanho que o original (os índices batem). */
function foldChar(char: string): string {
  let folded = foldCache.get(char)
  if (folded === undefined) {
    const base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    const lower = char.toLowerCase()
    folded = base.length === char.length ? base : lower.length === char.length ? lower : char
    foldCache.set(char, folded)
  }
  return folded
}

/**
 * Texto para comparar: minúsculas e sem acento, com o mesmo tamanho do original, para a posição achada
 * valer no texto que a tela mostra.
 */
export function foldText(text: string): string {
  return text.replace(/[A-Z\u0080-￿]/g, foldChar)
}

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)
const oneLine = (text: string): string => text.replace(/\s+/g, ' ')
const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** Trecho de texto marcado: `[início, fim)`. */
export type Range = readonly [number, number]

/**
 * Trecho de até `max` caracteres em volta de `[index, index + length)`, cortado em palavra, com "…" onde o
 * texto continua. `marks` diz o que marcar dentro da janela (padrão: só a própria ocorrência). A borda nunca
 * parte um par surrogate (emoji): ela se abre para fora do par, e duas posições ficam reservadas para isso.
 */
export function snippetAround(
  text: string,
  index: number,
  length: number,
  marks: (from: number, to: number) => readonly Range[] = () => [[index, index + length]],
  max = SEARCH_SNIPPET_MAX,
): SnippetPart[] {
  const end = index + length
  // Duas reticências e um caractere de cada lado para não partir um surrogate.
  const room = Math.max(0, max - length - 4)
  let left = Math.floor(room / 2)
  let right = room - left
  if (index < left) {
    right += left - index
    left = index
  }
  if (text.length - end < right) {
    left = Math.min(index, left + right - (text.length - end))
    right = text.length - end
  }
  let from = index - left
  let to = end + right
  if (from > 0 && !isSpace(text[from - 1])) {
    const space = text.slice(from, index).search(/\s/)
    if (space !== -1) from += space + 1
  }
  if (to < text.length && !isSpace(text[to])) {
    const tail = text.slice(end, to)
    const space = Math.max(tail.lastIndexOf(' '), tail.lastIndexOf('\n'))
    if (space !== -1) to = end + space
  }
  if (from > 0 && isLow(text.charCodeAt(from)) && isHigh(text.charCodeAt(from - 1))) from--
  if (to < text.length && isHigh(text.charCodeAt(to - 1)) && isLow(text.charCodeAt(to))) to++

  // Marcas dentro da janela, em ordem e sem sobreposição.
  const ranges = marks(from, to)
    .map(([a, b]): Range => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of ranges) {
    const last = merged.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  const parts: SnippetPart[] = []
  let at = from
  for (const [a, b] of merged) {
    if (a > at) parts.push({ text: oneLine(text.slice(at, a)), mark: false })
    parts.push({ text: oneLine(text.slice(a, b)), mark: true })
    at = b
  }
  if (at < to) parts.push({ text: oneLine(text.slice(at, to)), mark: false })
  const first = parts[0]
  if (first && !first.mark) first.text = first.text.trimStart()
  const last = parts.at(-1)
  if (last && !last.mark) last.text = last.text.trimEnd()
  if (from > 0) parts.unshift({ text: '…', mark: false })
  if (to < text.length) parts.push({ text: '…', mark: false })
  // "…" colado no texto vizinho, sem pedaço vazio.
  return parts.reduce<SnippetPart[]>((out, part) => {
    const prev = out.at(-1)
    if (prev && !prev.mark && !part.mark) prev.text += part.text
    else if (part.text) out.push({ ...part })
    return out
  }, [])
}

/** Palavras do termo, já normalizadas e sem repetição, na ordem em que foram digitadas. */
export function searchWords(term: string): string[] {
  return [...new Set(foldText(term.normalize('NFC')).split(/\s+/).filter(Boolean))]
}

/** Quantas vezes `word` aparece em `folded` (sem sobreposição). */
function occurrences(folded: string, word: string): number {
  let count = 0
  for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length)) count++
  return count
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)

/**
 * Ocorrências das palavras dentro de `[from, to)` para marcar no trecho: só as que começam uma palavra
 * ("em" não acende dentro de "sem" ou "quem"). A busca continua achando pedaços de palavra.
 */
function wordRanges(folded: string, words: readonly string[], from: number, to: number): Range[] {
  const ranges: Range[] = []
  for (const word of words) {
    for (let at = folded.indexOf(word, from); at !== -1 && at + word.length <= to; at = folded.indexOf(word, at + word.length)) {
      if (!isWordChar(folded[at - 1])) ranges.push([at, at + word.length])
    }
  }
  return ranges
}

interface Indexed {
  stamp: string
  text: string
  folded: string
}

interface IndexedSummary extends Indexed {
  summary: MeetingSummary | null
}

interface IndexedNotes extends Indexed {
  /** Anotações com texto. */
  count: number
}

/** NFC antes de normalizar: "Café" gravado decomposto (NFD) vira o mesmo texto que o digitado. */
const indexed = (raw: string): Pick<Indexed, 'text' | 'folded'> => {
  const text = raw.normalize('NFC')
  return { text, folded: foldText(text) }
}

/** Muda quando o arquivo é regravado (a gravação atômica troca o inode) ou apagado. */
async function stampOf(file: string | null): Promise<string> {
  if (!file) return 'none'
  try {
    const info = await stat(file)
    return `${info.ino}:${info.mtimeMs}:${info.size}`
  } catch {
    return 'none'
  }
}

/** O que a busca procura no resumo: o que aconteceu, decisões, tarefas e quem faz. */
function summaryText(summary: MeetingSummary | null): string {
  if (!summary) return ''
  return [summary.overview, ...summary.decisions, ...summary.tasks.flatMap((task) => [task.task, task.owner ?? ''])]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

export function createMeetingsIndex(deps: MeetingsIndexDeps): MeetingsIndex {
  const summaries = new Map<string, IndexedSummary>()
  const transcripts = new Map<string, Indexed>()
  const notes = new Map<string, IndexedNotes>()
  let warming: Promise<void> = Promise.resolve()

  async function summaryOf(meetingId: string): Promise<IndexedSummary> {
    const stamp = await stampOf(summaryPath(deps.dir, meetingId))
    const cached = summaries.get(meetingId)
    if (cached?.stamp === stamp) return cached
    const summary = stamp === 'none' ? null : await deps.summaries.get(meetingId).catch(() => null)
    const entry = { stamp, summary, ...indexed(summaryText(summary)) }
    summaries.set(meetingId, entry)
    return entry
  }

  async function transcriptOf(meetingId: string): Promise<Indexed> {
    const stamp = await stampOf(transcriptPath(deps.dir, meetingId))
    const cached = transcripts.get(meetingId)
    if (cached?.stamp === stamp) return cached
    const document = stamp === 'none' ? null : await deps.transcripts.get(meetingId).catch(() => null)
    const text = document
      ? document.segments
          .map((segment) => segment.text.trim())
          .filter(Boolean)
          .join('\n')
      : ''
    const entry = { stamp, ...indexed(text) }
    transcripts.set(meetingId, entry)
    return entry
  }

  async function notesOf(meetingId: string): Promise<IndexedNotes> {
    const stamp = deps.notes ? await stampOf(notesPath(deps.dir, meetingId)) : 'none'
    const cached = notes.get(meetingId)
    if (cached?.stamp === stamp) return cached
    const list = stamp === 'none' ? [] : notesInOrder((await deps.notes?.get(meetingId).catch(() => [])) ?? [])
    const entry = { stamp, count: list.length, ...indexed(list.map((note) => note.text.trim()).join('\n')) }
    notes.set(meetingId, entry)
    return entry
  }

  /** Reunião excluída sai do índice. */
  function prune(meetings: readonly Meeting[]): void {
    const ids = new Set(meetings.map((meeting) => meeting.id))
    for (const cache of [summaries, transcripts, notes]) for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
  }

  function entryOf(meeting: Meeting, summary: MeetingSummary | null, notesCount: number): MeetingOverview {
    const activity = deps.activity(meeting.id)
    const summaryState: ListSummaryState = activity ?? (summary ? 'ready' : 'none')
    return { meeting, summary: summary ? summaryPreview(summary) : null, summaryState, notes: notesCount }
  }

  async function overview(): Promise<MeetingOverview[]> {
    const meetings = await deps.meetings.list()
    prune(meetings)
    const [found, counted] = await Promise.all([
      Promise.all(meetings.map((meeting) => summaryOf(meeting.id))),
      Promise.all(meetings.map((meeting) => notesOf(meeting.id))),
    ])
    // A primeira busca já encontra as transcrições em memória.
    warming = warming.then(async () => {
      for (const meeting of meetings) await transcriptOf(meeting.id).catch(() => undefined)
    })
    return meetings.map((meeting, i) => entryOf(meeting, found[i]?.summary ?? null, counted[i]?.count ?? 0))
  }

  async function search(input: unknown): Promise<MeetingSearchResult[]> {
    const words = searchWords(termSchema.parse(input))
    const meetings = await deps.meetings.list()
    prune(meetings)
    const results: MeetingSearchResult[] = []
    // Uma reunião por vez: a leitura de um arquivo que mudou não atrasa as que já estão em memória.
    for (const meeting of meetings) {
      const summary = await summaryOf(meeting.id)
      const meetingNotes = await notesOf(meeting.id)
      const fields: [SearchField, Pick<Indexed, 'text' | 'folded'>][] = [
        ['title', indexed(meeting.title)],
        ['transcript', await transcriptOf(meeting.id)],
        ['summary', summary],
        ['notes', meetingNotes],
      ]
      // Todas as palavras em algum campo; a do trecho é a mais rara (empate: a que veio antes no termo).
      let anchor: { word: string; count: number } | null = null
      let missing = false
      for (const word of words) {
        const count = fields.reduce((sum, [, field]) => sum + occurrences(field.folded, word), 0)
        if (count === 0) {
          missing = true
          break
        }
        if (!anchor || count < anchor.count) anchor = { word, count }
      }
      if (missing || !anchor) continue
      const { word } = anchor
      for (const [field, { text, folded }] of fields) {
        const at = folded.indexOf(word)
        if (at === -1) continue
        // A ocorrência que escolheu o trecho fica sempre marcada, mesmo no meio de uma palavra.
        const snippet = snippetAround(text, at, word.length, (from, to) => [[at, at + word.length], ...wordRanges(folded, words, from, to)])
        results.push({ ...entryOf(meeting, summary.summary, meetingNotes.count), field, snippet })
        break
      }
    }
    return results
  }

  return { overview, search, warmed: () => warming }
}
