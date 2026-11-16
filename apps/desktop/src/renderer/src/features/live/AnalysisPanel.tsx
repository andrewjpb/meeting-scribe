// Aba "Análise" do painel da gravação (contrato 19, CA4): a análise mais nova em cima, aberta; as anteriores
// recolhidas. Gerando, um esqueleto parado; falhou, o motivo e "Tentar de novo". Cada item vira anotação,
// é copiado ou leva a transcrição ao tempo dele.
import { ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { answeredKeys, type AnalysisError } from '@shared/meeting-analysis'
import { useAgentLabel } from '../../app/agentLabel'
import { Icon } from '../../design/Icon'
import { summaryErrorReason } from '../meetings/SummaryTab'
import { AnalysisBlock } from './AnalysisBlock'
import { RetryNotice } from './Notices'
import { useRecording } from './recordingStore'

/** Texto do aviso de erro da análise (como o do resumo, contratos 08 e 17). */
export function analysisErrorText(error: AnalysisError, agentLabel = 'Claude'): string {
  if (error === 'empty') return 'Ainda não há fala transcrita para analisar.'
  if (error === 'limit') return 'Limite de análises desta reunião.'
  return `Não foi possível analisar. ${summaryErrorReason(error, agentLabel)}`
}

/** "Copiar" de um item: o main escreve na área de transferência. */
export const copyAnalysisText = async (text: string): Promise<boolean> => {
  try {
    return await window.__scribeApi.invoke('scribe:analysis-copy', { text })
  } catch {
    return false
  }
}

export function AnalysisPanel() {
  const analyses = useRecording((state) => state.analyses)
  const analyzing = useRecording((state) => state.analyzing)
  const error = useRecording((state) => state.analysisError)
  const { analyze, noteFromAnalysis, jumpToTime } = useRecording.getState()
  const agentLabel = useAgentLabel()
  /** Blocos abertos à mão; a mais nova abre sozinha. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const newest = analyses.at(-1)?.id
  const answered = answeredKeys(analyses)

  return (
    <div data-analysis-panel aria-live="polite" className="flex flex-col gap-4">
      {analyzing && (
        <div data-analysis-busy role="status" className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-13 text-text-muted">
            <Icon icon={ScanSearch} className="shrink-0" />
            Analisando a reunião até agora…
          </p>
          <div aria-hidden="true" className="flex flex-col gap-2">
            {['w-full', 'w-4/5', 'w-3/5'].map((width) => (
              <span key={width} className={`h-3 ${width} rounded-[var(--radius-control)] bg-bg-sunken`} />
            ))}
          </div>
        </div>
      )}
      {error && !analyzing && <RetryNotice id="analysis-failed" text={analysisErrorText(error, agentLabel)} onRetry={analyze} />}
      {analyses.length === 0 && !analyzing && !error && (
        <p data-analysis-hint className="text-13 text-pretty text-text-muted">
          Use "Analisar até agora" (⌘⇧A) para ver as perguntas em aberto e o que não ficou claro, com base na reunião inteira até aqui. Nada é analisado sem o clique.
        </p>
      )}
      {[...analyses].reverse().map((analysis) => {
        const expanded = toggled[analysis.id] ?? analysis.id === newest
        return (
          <AnalysisBlock
            key={analysis.id}
            analysis={analysis}
            answered={answered}
            expanded={expanded}
            onToggle={() => setToggled((current) => ({ ...current, [analysis.id]: !expanded }))}
            onNote={noteFromAnalysis}
            onCopy={copyAnalysisText}
            onJump={jumpToTime}
          />
        )
      })}
    </div>
  )
}
