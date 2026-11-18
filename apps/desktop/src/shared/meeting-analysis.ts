// "Analisar até agora" (contrato 19): perguntas em aberto, o que não ficou claro, o que falta confirmar e
// perguntas para fazer agora, geradas pelo mesmo motor do resumo, a qualquer momento da gravação ou depois
// dela. Na gravação as análises ficam no `recordingStore` até a reunião existir; depois, em
// `meetings/<id>.analyses.json` (esquema zod em `meeting-analysis-schema.ts`, separado para o renderer não
// carregar o zod). O Markdown sai de `analysisMarkdown`: o `.md` da pasta, o "Baixar transcrição…", o
// "Copiar resumo" e o `- resumo.md` usam a mesma função.
import { formatClock } from './transcription'

export const ANALYSES_VERSION = 1
/** Itens por lista (CA1). */
export const ANALYSIS_ITEMS_MAX = 15
/** Caracteres por texto (CA1). */
export const ANALYSIS_TEXT_MAX = 500
/** Perguntas para fazer agora que a instrução pede (CA2); o esquema aceita até `ANALYSIS_ITEMS_MAX`. */
export const ANALYSIS_SUGGESTED_ASKED = 5
/** Análises guardadas por reunião; ao chegar aqui, o botão trava (contrato 19, devolução). */
export const ANALYSES_MAX = 100
/** Análises anteriores que vão no pedido: só as mais recentes, para ele não crescer sem fim. */
export const ANALYSIS_PREVIOUS_MAX = 20
/** Item sem o porquê na resposta do Claude. */
export const ANALYSIS_NO_DETAIL = 'Sem detalhe'

export interface OpenQuestion {
  text: string
  /** De onde veio a pergunta, numa frase. */
  context?: string | undefined
  /** Momento da gravação da fala em que ela apareceu. */
  atMs?: number | undefined
}

export interface UnclearTopic {
  topic: string
  /** Por que não ficou claro. */
  why: string
  atMs?: number | undefined
}

export interface ToConfirm {
  text: string
  /** Quem deveria confirmar, quando dá para saber. */
  owner?: string | undefined
}

/** As três listas que uma análise nova pode marcar como respondidas numa anterior. */
export const ANSWERABLE_SECTIONS = ['openQuestions', 'unclearTopics', 'toConfirm'] as const
export type AnswerableSection = (typeof ANSWERABLE_SECTIONS)[number]

/** Item de uma análise anterior que esta aponta como respondido depois (CA4: aparece riscado lá). */
export interface AnsweredRef {
  analysisId: string
  section: AnswerableSection
  index: number
}

/** O que o Claude devolve, já convertido (o `[mm:ss]` dele vira `atMs`, as refs viram `AnsweredRef`). */
export interface AnalysisContent {
  openQuestions: OpenQuestion[]
  unclearTopics: UnclearTopic[]
  toConfirm: ToConfirm[]
  suggestedQuestions: string[]
  answered: AnsweredRef[]
}

/** Uma análise (CA1). `costUsd` e `durationMs` vão no rodapé (CA7). */
export interface MeetingAnalysis extends AnalysisContent {
  id: string
  /** `null` enquanto a reunião ainda não foi criada (análise feita durante a gravação). */
  meetingId: string | null
  /** ISO 8601. */
  createdAt: string
  /** Momento da gravação (sem as pausas) até onde a transcrição foi analisada. */
  atMs: number
  /** `claude-cli:haiku`, como no resumo. */
  model: string
  /** Custo nominal em US$; `null` quando o motor não informou. */
  costUsd: number | null
  durationMs: number | null
}

/** Arquivo `meetings/<id>.analyses.json`, da mais antiga para a mais nova. */
export interface MeetingAnalysesFile {
  version: typeof ANALYSES_VERSION
  meetingId: string
  analyses: MeetingAnalysis[]
}

/**
 * `not-found`: sem `claude`; `timeout`: passou de 90 s; `format`: a resposta não era o JSON pedido;
 * `failed`: o processo falhou ou respondeu com erro; `agent`: o agente do ACP não abriu; `empty`: ainda
 * não há trecho final para analisar; `limit`: a reunião já tem `ANALYSES_MAX` análises.
 */
export type AnalysisError = 'not-found' | 'timeout' | 'format' | 'failed' | 'agent' | 'empty' | 'limit'

export type AnalysisRunResult = { ok: true; analysis: MeetingAnalysis } | { ok: false; error: AnalysisError }

/** Trecho da gravação em curso que vai para a análise: só os finais, sem eco, com texto. */
export interface LiveAnalysisSegment {
  source: 'mic' | 'system'
  speaker: string | null
  startMs: number
  endMs: number
  text: string
  /** Nomes do Meet (contrato 27): só na reunião salva; a gravação em curso ainda não tem. */
  names?: string[]
}

/** Fim do último trecho com texto: o `atMs` de uma análise ("Até mm:ss" bate com o que ela leu). */
export function analyzedUntil(segments: readonly Pick<LiveAnalysisSegment, 'startMs' | 'endMs' | 'text'>[]): number {
  return segments.reduce((max, segment) => (segment.text.trim() ? Math.max(max, segment.startMs, segment.endMs) : max), 0)
}

/** Pedido de "Analisar até agora" na gravação: tudo o que ainda está só na memória do renderer. */
export interface LiveAnalysisRequest {
  /**
   * Id da gravação, criado no começo dela: a análise de uma gravação nunca cai em outra. Um pedido de outra
   * gravação cancela a análise que ainda gerava para a anterior.
   */
  recordingId: string
  /** Até onde a transcrição foi analisada: o fim do último trecho incluído. */
  atMs: number
  segments: LiveAnalysisSegment[]
  notes: { text: string; atMs: number | null; createdAt: string }[]
  previous: MeetingAnalysis[]
}

/** "Analisar até agora" (gravação) ou "Analisar a reunião inteira" (detalhe, salva junto). */
export type AnalysisRunRequest = { live: LiveAnalysisRequest } | { meetingId: string }

/** A análise não tem nada em nenhuma das quatro listas: "Nada em aberto até aqui." */
export const analysisIsEmpty = (analysis: Pick<AnalysisContent, 'openQuestions' | 'unclearTopics' | 'toConfirm' | 'suggestedQuestions'>): boolean =>
  !analysis.openQuestions.length && !analysis.unclearTopics.length && !analysis.toConfirm.length && !analysis.suggestedQuestions.length

/** Chave de um item para saber se uma análise mais nova o marcou como respondido. */
export const answeredKey = (analysisId: string, section: AnswerableSection, index: number): string => `${analysisId}:${section}:${index}`

/** Itens respondidos segundo as análises da lista (qualquer ordem). */
export function answeredKeys(analyses: readonly Pick<MeetingAnalysis, 'answered'>[]): Set<string> {
  return new Set(analyses.flatMap((analysis) => analysis.answered.map((ref) => answeredKey(ref.analysisId, ref.section, ref.index))))
}

/** As `ANALYSIS_PREVIOUS_MAX` mais recentes, da mais antiga para a mais nova: o que vai no pedido. */
export function recentAnalyses<T extends Pick<MeetingAnalysis, 'createdAt'>>(analyses: readonly T[]): T[] {
  return [...analyses].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-ANALYSIS_PREVIOUS_MAX)
}

/** A mais nova: a de maior `createdAt` (empate, a última da lista). */
export function latestAnalysis<T extends Pick<MeetingAnalysis, 'createdAt'>>(analyses: readonly T[]): T | null {
  let best: T | null = null
  for (const analysis of analyses) if (!best || Date.parse(analysis.createdAt) >= Date.parse(best.createdAt)) best = analysis
  return best
}

/** Cabeçalho do bloco: "Até 23:41" (o tempo da gravação até onde foi analisada). */
export const analysisUntilLabel = (analysis: Pick<MeetingAnalysis, 'atMs'>): string => `Até ${formatClock(analysis.atMs)}`

/** Texto de um item na lista, para "Copiar" e "Virar anotação". */
export function analysisItemText(section: 'openQuestions' | 'unclearTopics' | 'toConfirm' | 'suggestedQuestions', item: OpenQuestion | UnclearTopic | ToConfirm | string): string {
  if (typeof item === 'string') return item
  if (section === 'unclearTopics' && 'topic' in item) return `${item.topic}: ${item.why}`
  if (section === 'toConfirm' && 'owner' in item && item.owner) return `${item.text} (${item.owner})`
  return 'text' in item ? item.text : ''
}

/** Texto do Claude numa linha do Markdown: sem quebra e com `#` no começo escapado. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().replace(/^#/, '\\#')
const at = (atMs: number | undefined): string => (atMs === undefined ? '' : ` (${formatClock(atMs)})`)

/**
 * Seção "## Perguntas em aberto" com a última análise: as quatro listas (as vazias somem), cada item numa
 * linha, e de qual momento é a análise. Sem análise, ou com tudo vazio: string vazia.
 */
export function analysisMarkdown(analyses: readonly MeetingAnalysis[]): string {
  const analysis = latestAnalysis(analyses)
  if (!analysis || analysisIsEmpty(analysis)) return ''
  const lines: string[] = ['## Perguntas em aberto', '', `_Análise da gravação até ${formatClock(analysis.atMs)}._`]
  const group = (title: string, items: string[]): void => {
    if (items.length) lines.push('', `**${title}**`, '', ...items.map((item) => `- ${item}`))
  }
  group(
    'Perguntas em aberto',
    analysis.openQuestions.map((item) => `${oneLine(item.text)}${at(item.atMs)}${item.context ? ` — ${oneLine(item.context)}` : ''}`),
  )
  group(
    'Não ficou claro',
    analysis.unclearTopics.map((item) => `${oneLine(item.topic)}${at(item.atMs)} — ${oneLine(item.why)}`),
  )
  group(
    'Para confirmar',
    analysis.toConfirm.map((item) => `${oneLine(item.text)}${item.owner ? ` — ${oneLine(item.owner)}` : ''}`),
  )
  group('Perguntas para fazer agora', analysis.suggestedQuestions.map(oneLine))
  return `${lines.join('\n')}\n`
}
