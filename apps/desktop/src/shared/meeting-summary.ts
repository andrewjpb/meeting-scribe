// Resumo da reunião (contrato 08): o que aconteceu, o que foi decidido e as tarefas com quem faz. O main
// gera com o `claude` local, valida com `meeting-summary-schema.ts` e guarda em `meetings/<id>.summary.json`;
// o renderer só recebe o resultado (e este arquivo não leva o zod para ele). O Markdown é o mesmo no
// "Copiar resumo", no "Baixar resumo…" e na pasta da reunião.
import { durationLabel, type MarkdownMeeting } from './transcript-markdown'

export const SUMMARY_VERSION = 1
export const SUMMARY_OVERVIEW_MAX = 4_000
export const SUMMARY_ITEMS_MAX = 50
export const SUMMARY_TEXT_MAX = 500

/** Uma tarefa combinada: `owner` e `due` ficam `null` quando ninguém foi apontado ou não houve prazo. */
export interface SummaryTask {
  task: string
  owner: string | null
  due: string | null
}

/** O que o Claude devolve: só o conteúdo, sem os campos que o app preenche. */
export interface SummaryContent {
  overview: string
  decisions: string[]
  tasks: SummaryTask[]
}

/** Arquivo `meetings/<id>.summary.json`. O esquema zod que valida está em `meeting-summary-schema.ts`. */
export interface MeetingSummary extends SummaryContent {
  version: typeof SUMMARY_VERSION
  meetingId: string
  /** ISO 8601. */
  createdAt: string
  model: string
}

/**
 * `not-found`: sem `claude`; `timeout`: passou de 3 min; `format`: a resposta não era o JSON pedido;
 * `failed`: o processo falhou ou respondeu com erro.
 */
export type SummaryError = 'not-found' | 'timeout' | 'format' | 'failed'

/**
 * Estado do resumo de uma reunião para a aba "Resumo". `empty`: a reunião não tem trecho para resumir.
 * `error` guarda o resumo anterior, se houver, para ele continuar na tela.
 */
export type SummaryStatus =
  | { state: 'none' }
  | { state: 'empty' }
  | { state: 'generating' }
  | { state: 'ready'; summary: MeetingSummary }
  | { state: 'error'; error: SummaryError; summary: MeetingSummary | null }

const two = (value: number): string => String(value).padStart(2, '0')

/** `15/11/2026 14:30`, na hora local. */
export function summaryDateLabel(iso: string): string {
  const date = new Date(iso)
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Rodapé da aba e do Markdown: "Gerado pelo Claude em 15/11/2026 14:30 · claude-cli:haiku". */
export function summaryFooter(summary: Pick<MeetingSummary, 'createdAt' | 'model'>): string {
  return `Gerado pelo Claude em ${summaryDateLabel(summary.createdAt)} · ${summary.model}`
}

/**
 * Texto do Claude no Markdown: linha que começa com `#` ganha a barra (`\#`), para não abrir uma seção
 * falsa no `.md`.
 */
export const escapeHeadings = (text: string): string => text.replace(/^([ \t]*)#/gm, '$1\\#')

/** Item de lista em uma linha: quebra de linha dentro do texto não abre outro item. */
const oneLine = (text: string): string => escapeHeadings(text.replace(/\s+/g, ' ').trim())

/** `- [ ] tarefa — quem (prazo)`; sem responsável ou sem prazo, a parte some. */
export function taskLine(task: SummaryTask): string {
  const owner = task.owner ? ` — ${oneLine(task.owner)}` : ''
  const due = task.due ? ` (${oneLine(task.due)})` : ''
  return `- [ ] ${oneLine(task.task)}${owner}${due}`
}

const dateLabel = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Markdown do resumo: título, data, "O que aconteceu", "Decisões" (some se vazia, como na tela),
 * "Tarefas" e o rodapé com data e modelo.
 */
export function summaryMarkdown(meeting: MarkdownMeeting, summary: MeetingSummary): string {
  const started = new Date(meeting.startedAt)
  const lines: string[] = [
    `# ${meeting.title}`,
    '',
    `${dateLabel.format(started)} · ${two(started.getHours())}:${two(started.getMinutes())} · ${durationLabel(meeting.durationMs)}`,
    '',
    '## O que aconteceu',
    '',
    escapeHeadings(summary.overview.trim()),
  ]
  if (summary.decisions.length) lines.push('', '## Decisões', '', ...summary.decisions.map((decision) => `- ${oneLine(decision)}`))
  lines.push('', '## Tarefas', '')
  if (summary.tasks.length) lines.push(...summary.tasks.map(taskLine))
  else lines.push('Nenhuma tarefa combinada.')
  lines.push('', `_${summaryFooter(summary)}_`)
  return `${lines.join('\n')}\n`
}
