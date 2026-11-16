// Lista e busca de reuniões (contrato 10): o que o main manda numa chamada só para a tela de Reuniões
// (reunião, prévia do resumo e estado dele) e o resultado da busca. As funções puras daqui rodam nos dois
// lados: o main monta a prévia ao ler o `summary.json` e o renderer refaz a mesma prévia quando chega o
// `scribe:summary-state`, sem pedir a lista de novo.
import type { MeetingSummary, SummaryStatus } from './meeting-summary'
import type { Meeting } from './meetings'

/** Tamanho máximo da prévia do resumo na lista, já contando as reticências. */
export const SUMMARY_PREVIEW_MAX = 200
/** Termo de busca, depois de tirar os espaços das pontas. */
export const SEARCH_TERM_MIN = 2
export const SEARCH_TERM_MAX = 100
/** Trecho em volta da primeira ocorrência, já contando as reticências. */
export const SEARCH_SNIPPET_MAX = 120

/** Estado do resumo na lista. Reunião sem trecho para resumir aparece como `none`. */
export type ListSummaryState = 'none' | 'generating' | 'ready' | 'error'

export interface SummaryPreview {
  /** Primeira frase do "O que aconteceu", com até `SUMMARY_PREVIEW_MAX` caracteres. */
  overview: string
  tasks: number
  decisions: number
}

export interface MeetingOverview {
  meeting: Meeting
  /** Último resumo salvo; continua aqui enquanto um novo é gerado ou se a nova tentativa falhou. */
  summary: SummaryPreview | null
  summaryState: ListSummaryState
  /** Anotações com texto (contrato 13); a lista mostra "N anotações" quando passa de zero. */
  notes: number
  /** Já está no Google Drive (contrato 11): a lista mostra um ícone de nuvem. Ausente é não. */
  inDrive?: boolean
}

export type SearchField = 'title' | 'transcript' | 'summary' | 'notes'

/** Pedaço do trecho achado: `mark` nas palavras do termo. O renderer marca sem montar HTML. */
export interface SnippetPart {
  text: string
  mark: boolean
}

export interface MeetingSearchResult extends MeetingOverview {
  /** Onde está a ocorrência mostrada no trecho, na ordem título, transcrição, resumo, anotações. */
  field: SearchField
  snippet: SnippetPart[]
}

const ELLIPSIS = '…'

/** Corta em palavra e põe "…" quando passa de `max` (as reticências contam no tamanho). */
export function clipAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - ELLIPSIS.length + 1)
  const space = cut.lastIndexOf(' ')
  // Uma palavra só, maior que o limite: corta no meio dela.
  const head = space > 0 ? cut.slice(0, space) : cut.slice(0, max - ELLIPSIS.length)
  return `${head.replace(/[\s,;:.!?–—-]+$/u, '')}${ELLIPSIS}`
}

/** Primeira frase do texto: até o primeiro `.`, `!`, `?` ou `…` seguido de espaço ou do fim. */
export function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const found = /^.+?[.!?…](?=\s|$)/u.exec(clean)
  return found ? found[0] : clean
}

export function summaryPreview(summary: Pick<MeetingSummary, 'overview' | 'tasks' | 'decisions'>): SummaryPreview {
  return {
    overview: clipAtWord(firstSentence(summary.overview), SUMMARY_PREVIEW_MAX),
    tasks: summary.tasks.length,
    decisions: summary.decisions.length,
  }
}

/**
 * Linha da lista depois de um `scribe:summary-state` (CA5): gerando mantém a prévia que já estava; pronto
 * troca pela nova; erro mostra o resumo anterior, se houver.
 */
export function withSummaryStatus<T extends MeetingOverview>(entry: T, status: SummaryStatus): T {
  switch (status.state) {
    case 'generating':
      return { ...entry, summaryState: 'generating' }
    case 'ready':
      return { ...entry, summary: summaryPreview(status.summary), summaryState: 'ready' }
    case 'error':
      return { ...entry, summary: status.summary ? summaryPreview(status.summary) : null, summaryState: 'error' }
    case 'none':
    case 'empty':
      return { ...entry, summary: null, summaryState: 'none' }
  }
}
