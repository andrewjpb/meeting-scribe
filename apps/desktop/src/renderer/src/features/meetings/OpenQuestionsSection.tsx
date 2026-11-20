// Seção "Perguntas em aberto" da aba "Resumo" (contrato 19, CA6), abaixo das tarefas: recolhível, com a
// última análise da reunião (se houver) e "Analisar a reunião inteira", que gera uma nova com a transcrição
// completa e a salva junto.
import { ChevronDown, ChevronRight, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { ANALYSES_MAX, answeredKeys, latestAnalysis } from '@shared/meeting-analysis'
import { useAgentLabel } from '../../app/agentLabel'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { AnalysisBlock } from '../live/AnalysisBlock'
import { analysisErrorText, copyAnalysisText } from '../live/AnalysisPanel'
import { RetryNotice } from '../live/Notices'
import { useMeetingNotes } from './notesStore'
import type { AnalysesView } from './useAnalyses'

interface OpenQuestionsSectionProps {
  meetingId: string
  view: AnalysesView
  onAnalyze: () => void
  /** A reunião não tem trecho: o botão fica desligado. */
  disabled: boolean
  /** Clique no tempo de um item: abre a "Transcrição" no trecho mais próximo. */
  onJump?: ((atMs: number) => void) | undefined
}

export function OpenQuestionsSection({ meetingId, view, onAnalyze, disabled, onJump }: OpenQuestionsSectionProps) {
  const [open, setOpen] = useState(true)
  const agentLabel = useAgentLabel()
  const analyses = view.analyses ?? []
  const latest = latestAnalysis(analyses)
  const atLimit = analyses.length >= ANALYSES_MAX
  const bodyId = `open-questions-${meetingId}`

  return (
    <section data-open-questions={latest ? latest.id : 'none'} aria-label="Perguntas em aberto">
      <button
        type="button"
        data-action="toggle-open-questions"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="no-drag flex items-center gap-1.5 rounded-[var(--radius-control)] text-left"
      >
        <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0 text-text-muted" />
        <span className="text-14 leading-5 font-semibold text-title">Perguntas em aberto</span>
      </button>
      <span aria-hidden="true" className="mt-2 mb-3 block h-0.5 w-5 bg-title" />
      {open && (
        <div id={bodyId} className="flex flex-col gap-4">
          {view.error && !view.analyzing && <RetryNotice id="meeting-analysis-failed" text={analysisErrorText(view.error, agentLabel)} onRetry={onAnalyze} />}
          {view.analyzing && (
            <p role="status" className="flex items-center gap-2 text-13 text-text-muted">
              <Icon icon={ScanSearch} className="shrink-0" />
              Analisando a reunião inteira…
            </p>
          )}
          {latest ? (
            <AnalysisBlock
              analysis={latest}
              answered={answeredKeys(analyses)}
              expanded
              onNote={(text, atMs) => void useMeetingNotes.getState().createWithText(meetingId, text, atMs)}
              onCopy={copyAnalysisText}
              onJump={onJump}
            />
          ) : (
            !view.analyzing && (
              <p data-open-questions-empty className="text-13 text-pretty text-text-muted">
                Nenhuma análise ainda. Veja as perguntas que ficaram sem resposta e o que não ficou claro na reunião.
              </p>
            )
          )}
          <div>
            <Button action="analyze-meeting" variant="secondary" icon={ScanSearch} onClick={onAnalyze} disabled={disabled || view.analyzing || atLimit || view.analyses === null}>
              {view.analyzing ? 'Analisando…' : atLimit ? 'Limite de análises desta reunião' : 'Analisar a reunião inteira'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
