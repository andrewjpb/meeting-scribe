import { Copy, Download, RefreshCw, Sparkles, Terminal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { acpReady } from '@shared/acp'
import { summaryDateLabel, type MeetingSummary, type SummaryError } from '@shared/meeting-summary'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { RetryNotice } from '../live/Notices'
import type { SummaryView } from './useSummary'

/** Motivo curto do erro, depois de "Não foi possível gerar o resumo." */
export function summaryErrorReason(error: SummaryError, agentLabel = 'Claude'): string {
  if (error === 'not-found') return 'Configure o Claude CLI em Configurações.'
  if (error === 'timeout') return 'O Claude demorou demais.'
  if (error === 'agent') return `O agente do ${agentLabel} não abriu.`
  return 'Tente de novo.'
}

/**
 * Contrato 17: com a conexão no agente e ele não instalado, o resumo sai pela linha de comando; um aviso
 * discreto oferece instalar (nunca baixa sem o clique).
 */
function AcpFallbackNote() {
  const transport = useSettings((state) => state.settings.claudeTransport)
  const acp = useAcp((state) => state.status)
  useEffect(() => {
    if (transport === 'acp') void useAcp.getState().load()
  }, [transport])
  if (transport !== 'acp' || !acp || acpReady(acp)) return null
  return (
    <Note
      id="summary-acp-missing"
      icon={Download}
      action={
        acp.state === 'installing' ? undefined : (
          <button type="button" data-action="acp-install-from-summary" className={NOTE_ACTION_CLASS} onClick={() => void useAcp.getState().install()}>
            Instalar
          </button>
        )
      }
    >
      {acp.state === 'installing' ? `Instalando o agente do ${acp.label}… ${acp.progress}%` : `O resumo usa a linha de comando: o agente do ${acp.label} não está instalado.`}
    </Note>
  )
}

/** O agente não abriu (contrato 17, CA8): troca a conexão para a linha de comando. */
function UseCommandLine() {
  const update = useSettings((state) => state.update)
  const transport = useSettings((state) => state.settings.claudeTransport)
  if (transport === 'cli') return null
  return (
    <Button action="use-command-line" variant="secondary" icon={Terminal} onClick={() => void update({ claudeTransport: 'cli' })}>
      Usar a linha de comando
    </Button>
  )
}

/** Coluna da aba: mesma largura e margens da transcrição, rolando sozinha. */
function Column({ children, state }: { children: ReactNode; state: string }) {
  return (
    <div data-summary-scroll className="min-h-0 flex-1 overflow-y-auto px-10 pb-10">
      <div data-summary={state} aria-live="polite" className="mx-auto flex w-full max-w-[680px] flex-col gap-8 pt-7">
        <AcpFallbackNote />
        {children}
      </div>
    </div>
  )
}

/**
 * Aba "Resumo" (contrato 08, CA6): o que aconteceu, as decisões e as tarefas com quem faz. Gerando, um
 * esqueleto parado (nada gira, com ou sem movimento reduzido) que vira o resumo sozinho quando o main
 * avisa. Sem resumo, "Gerar resumo"; reunião sem trecho, o botão fica desligado.
 */
export function SummaryTab({ meetingId, view, onGenerate }: { meetingId: string; view: SummaryView; onGenerate: () => void }) {
  const agentLabel = useAgentLabel()
  if (view.state === 'loading') return <div className="flex-1" aria-busy="true" />

  if (view.state === 'generating') {
    return (
      <Column state="generating">
        <div role="status" className="flex items-center gap-2 text-13 text-text-muted">
          <Icon icon={Sparkles} className="shrink-0" />
          Gerando o resumo…
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3">
          {['w-full', 'w-11/12', 'w-4/5', 'w-2/5'].map((width) => (
            <span key={width} className={`h-3 ${width} rounded-[var(--radius-control)] bg-bg-sunken`} />
          ))}
        </div>
      </Column>
    )
  }

  if (view.state === 'none' || view.state === 'empty') {
    const empty = view.state === 'empty'
    return (
      <Column state={view.state}>
        <div className="flex flex-col items-start gap-4">
          <p className="text-13 text-pretty text-text-muted">{empty ? 'Sem transcrição para resumir.' : 'Esta reunião ainda não tem resumo.'}</p>
          <Button action="generate-summary" icon={Sparkles} onClick={onGenerate} disabled={empty}>
            Gerar resumo
          </Button>
        </div>
      </Column>
    )
  }

  const summary = view.summary
  return (
    <Column state={view.state}>
      {view.state === 'error' && (
        <RetryNotice id="summary-failed" text={`Não foi possível gerar o resumo. ${summaryErrorReason(view.error, agentLabel)}`} onRetry={onGenerate} />
      )}
      {view.state === 'error' && view.error === 'agent' && (
        <div className="-mt-4">
          <UseCommandLine />
        </div>
      )}
      {summary && <SummaryContent meetingId={meetingId} summary={summary} onGenerate={onGenerate} />}
    </Column>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <>
      <h2 className="text-17 font-bold text-title">{children}</h2>
      <span aria-hidden="true" className="mt-2 mb-3 block h-0.5 w-6 bg-title" />
    </>
  )
}

function SummaryContent({ meetingId, summary, onGenerate }: { meetingId: string; summary: MeetingSummary; onGenerate: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    window.__scribeApi.invoke('scribe:summary-copy', { meetingId }).then(
      (result) => {
        setCopyState(result === 'copied' ? 'copied' : 'failed')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopyState('idle'), 2500)
      },
      () => setCopyState('failed'),
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button action="copy-summary" variant="secondary" icon={Copy} onClick={copy}>
          {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Não copiou' : 'Copiar resumo'}
        </Button>
        <Button action="regenerate-summary" variant="secondary" icon={RefreshCw} onClick={onGenerate}>
          Gerar de novo
        </Button>
      </div>

      <section aria-label="O que aconteceu">
        <SectionTitle>O que aconteceu</SectionTitle>
        <div data-summary-overview className="flex flex-col gap-3">
          {summary.overview
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className="text-16 text-pretty text-text select-text">
                {paragraph}
              </p>
            ))}
        </div>
      </section>

      {summary.decisions.length > 0 && (
        <section aria-label="Decisões">
          <SectionTitle>Decisões</SectionTitle>
          <ul data-summary-decisions className="flex flex-col gap-2">
            {summary.decisions.map((decision, index) => (
              <li key={index} className="grid grid-cols-[16px_minmax(0,1fr)] text-15 text-text select-text">
                <span aria-hidden="true" className="mt-2 size-1.5 bg-accent" />
                <span>{decision}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Tarefas">
        <SectionTitle>Tarefas</SectionTitle>
        {summary.tasks.length === 0 ? (
          <p data-summary-no-tasks className="text-13 text-text-muted">
            Nenhuma tarefa combinada.
          </p>
        ) : (
          <table data-summary-tasks className="w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong text-12 font-medium text-text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Tarefa
                </th>
                <th scope="col" className="w-40 py-2 pr-4 font-medium">
                  Quem
                </th>
                <th scope="col" className="w-32 py-2 font-medium">
                  Prazo
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.tasks.map((task, index) => (
                <tr key={index} className="border-b border-line align-top text-13 text-text select-text">
                  <td className="py-2.5 pr-4">{task.task}</td>
                  <td className={`py-2.5 pr-4 ${task.owner ? 'font-medium' : 'text-text-muted'}`}>{task.owner ?? '—'}</td>
                  <td className={`py-2.5 tabular ${task.due ? '' : 'text-text-muted'}`}>{task.due ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p data-summary-footer className="text-12 text-text-faint">
        Gerado pelo Claude em <span className="tabular">{summaryDateLabel(summary.createdAt)}</span> · <span className="font-mono text-11">{summary.model}</span>
      </p>
    </>
  )
}
