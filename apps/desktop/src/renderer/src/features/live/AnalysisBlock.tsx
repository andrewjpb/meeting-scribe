// Uma análise "Analisar até agora" (contrato 19, CA4): o cabeçalho com o tempo da gravação ("Até 23:41"),
// as quatro seções (as vazias somem; tudo vazio, "Nada em aberto até aqui."), as ações de cada item e o
// rodapé com modelo, tempo e custo nominal (CA7). Usada no painel da gravação e na aba "Resumo" do detalhe.
// Item que uma análise mais nova aponta como respondido aparece riscado.
import { ChevronDown, ChevronRight, Copy, StickyNote } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { analysisIsEmpty, analysisItemText, analysisUntilLabel, answeredKey, type AnswerableSection, type MeetingAnalysis } from '@shared/meeting-analysis'
import { formatClock } from '@shared/transcription'
import { Icon } from '../../design/Icon'
import { answerTimeLabel, COST_HINT, costLabel, modelLabel } from '../chat/format'

type Section = AnswerableSection | 'suggestedQuestions'

const SECTION_TITLES: Record<Section, string> = {
  openQuestions: 'Perguntas em aberto',
  unclearTopics: 'Não ficou claro',
  toConfirm: 'Para confirmar',
  suggestedQuestions: 'Perguntas para fazer agora',
}

const ITEM_ACTION_CLASS =
  'no-drag inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title disabled:pointer-events-none disabled:opacity-50'

export interface AnalysisActions {
  /** "Virar anotação"; sem isto a ação não aparece. */
  onNote?: ((text: string, atMs: number) => void) | undefined
  /** "Copiar": verdadeiro quando o texto foi para a área de transferência. */
  onCopy: (text: string) => Promise<boolean>
  /** Clique no tempo do item; sem isto o tempo é só texto. */
  onJump?: ((atMs: number) => void) | undefined
}

interface AnalysisBlockProps extends AnalysisActions {
  analysis: MeetingAnalysis
  /** Itens respondidos segundo as análises mais novas (`answeredKeys`). */
  answered: ReadonlySet<string>
  expanded: boolean
  /** Recolher e abrir pelo cabeçalho; sem isto o bloco fica sempre aberto. */
  onToggle?: (() => void) | undefined
}

/** "Haiku · 4 s · US$ 0,01"; o que o motor não informou fica de fora. */
export function analysisFooterParts(analysis: Pick<MeetingAnalysis, 'model' | 'durationMs' | 'costUsd'>): { text: string; cost: string | null } {
  const parts = [modelLabel(analysis.model), analysis.durationMs === null ? '' : answerTimeLabel(analysis.durationMs)].filter(Boolean)
  return { text: parts.join(' · '), cost: analysis.costUsd === null ? null : costLabel(analysis.costUsd) }
}

export function AnalysisBlock({ analysis, answered, expanded, onToggle, onNote, onCopy, onJump }: AnalysisBlockProps) {
  const until = analysisUntilLabel(analysis)
  const empty = analysisIsEmpty(analysis)
  const footer = analysisFooterParts(analysis)
  const bodyId = `analysis-${analysis.id}`
  const isAnswered = (section: AnswerableSection, index: number): boolean => answered.has(answeredKey(analysis.id, section, index))
  const item = (section: Section, index: number, text: string, detail: string | undefined, atMs: number | undefined, copyText: string) => (
    <AnalysisItem
      key={`${section}-${index}`}
      text={text}
      detail={detail}
      atMs={atMs}
      copyText={copyText}
      answered={section !== 'suggestedQuestions' && isAnswered(section, index)}
      noteAtMs={atMs ?? analysis.atMs}
      onNote={onNote}
      onCopy={onCopy}
      onJump={onJump}
    />
  )

  return (
    <article data-analysis={analysis.id} data-expanded={expanded} aria-label={`Análise ${until.toLowerCase()}`} className="border-b border-line pb-3">
      {onToggle ? (
        <button
          type="button"
          data-action="toggle-analysis"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className="no-drag flex h-7 w-full items-center gap-1.5 rounded-[var(--radius-control)] text-left text-13 font-semibold text-title tabular"
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} size={14} className="shrink-0 text-text-muted" />
          <span data-analysis-until>{until}</span>
        </button>
      ) : (
        <p data-analysis-until className="text-13 font-semibold text-title tabular">
          {until}
        </p>
      )}
      {expanded && (
        <div id={bodyId} className="mt-2 flex flex-col gap-4">
          {empty ? (
            <p data-analysis-empty className="text-13 text-text-muted">
              Nada em aberto até aqui.
            </p>
          ) : (
            <>
              <AnalysisSection section="openQuestions" items={analysis.openQuestions.map((entry, index) => item('openQuestions', index, entry.text, entry.context, entry.atMs, analysisItemText('openQuestions', entry)))} />
              <AnalysisSection section="unclearTopics" items={analysis.unclearTopics.map((entry, index) => item('unclearTopics', index, entry.topic, entry.why, entry.atMs, analysisItemText('unclearTopics', entry)))} />
              <AnalysisSection section="toConfirm" items={analysis.toConfirm.map((entry, index) => item('toConfirm', index, entry.text, entry.owner, undefined, analysisItemText('toConfirm', entry)))} />
              <AnalysisSection section="suggestedQuestions" items={analysis.suggestedQuestions.map((entry, index) => item('suggestedQuestions', index, entry, undefined, undefined, entry))} />
            </>
          )}
          <p data-analysis-footer className="text-12 text-text-faint tabular">
            {footer.text}
            {footer.cost && (
              <span title={COST_HINT}>
                {' '}
                · {footer.cost}
                <span className="sr-only"> ({COST_HINT})</span>
              </span>
            )}
          </p>
        </div>
      )}
    </article>
  )
}

function AnalysisSection({ section, items }: { section: Section; items: ReactNode[] }) {
  if (!items.length) return null
  return (
    <section data-analysis-section={section} aria-label={SECTION_TITLES[section]}>
      <h3 className="label">{SECTION_TITLES[section]}</h3>
      <ul className="mt-1.5 flex flex-col gap-3">{items}</ul>
    </section>
  )
}

interface AnalysisItemProps extends AnalysisActions {
  text: string
  /** Contexto, porquê ou responsável, em texto de apoio. */
  detail: string | undefined
  atMs: number | undefined
  copyText: string
  answered: boolean
  /** Tempo da anotação criada: o do item ou, sem ele, o da análise. */
  noteAtMs: number
}

function AnalysisItem({ text, detail, atMs, copyText, answered, noteAtMs, onNote, onCopy, onJump }: AnalysisItemProps) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [noted, setNoted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    void onCopy(copyText).then(
      (ok) => {
        setCopied(ok ? 'copied' : 'failed')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied('idle'), 2500)
      },
      () => setCopied('failed'),
    )
  }

  return (
    <li data-analysis-item data-answered={answered || undefined} className="flex flex-col gap-0.5">
      <p className={`text-13 text-pretty select-text ${answered ? 'text-text-muted line-through' : 'text-text'}`}>
        {atMs !== undefined &&
          (onJump ? (
            <button
              type="button"
              data-action="analysis-jump"
              onClick={() => onJump(atMs)}
              aria-label={`Ir para ${formatClock(atMs)} na transcrição`}
              className="no-drag mr-1.5 rounded-[var(--radius-control)] text-12 font-medium text-accent tabular no-underline hover:text-title"
            >
              {formatClock(atMs)}
            </button>
          ) : (
            <span className="mr-1.5 text-12 text-text-faint tabular">{formatClock(atMs)}</span>
          ))}
        {text}
        {answered && <span className="sr-only"> (respondida depois)</span>}
      </p>
      {detail && <p className={`text-12 text-pretty text-text-muted select-text ${answered ? 'line-through' : ''}`}>{detail}</p>}
      <div className="flex items-center gap-3">
        {onNote && (
          <button
            type="button"
            data-action="analysis-to-note"
            disabled={noted}
            onClick={() => {
              onNote(copyText, noteAtMs)
              setNoted(true)
            }}
            className={ITEM_ACTION_CLASS}
          >
            <Icon icon={StickyNote} size={14} />
            {noted ? 'Virou anotação' : 'Virar anotação'}
          </button>
        )}
        <button type="button" data-action="analysis-copy" onClick={copy} className={ITEM_ACTION_CLASS}>
          <Icon icon={Copy} size={14} />
          {copied === 'copied' ? 'Copiado' : copied === 'failed' ? 'Não copiou' : 'Copiar'}
        </button>
      </div>
    </li>
  )
}
