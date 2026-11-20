// Aba "Execuções" (contrato 23, CA7): o histórico (as últimas 500) com data, tarefa, agente, estado, duração,
// custo nominal e modelo, e os filtros por tarefa e estado. Abrir uma mostra o pedido enviado, a resposta com
// raciocínio, passos e rodapé (componentes do chat 16) e o erro, se houve; "Rodar de novo".
//
// Contrato 51: a execução de uma tarefa com "Pode enviar email" mostra os emails enviados e os recusados (para, assunto,
// hora, Message-ID ou o motivo).
import { ArrowLeft, Ban, RotateCcw, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AGENT_MODEL_LABELS, durationLabel, RUN_STATUS_LABELS, RUN_STATUSES, RUN_TRIGGER_LABELS, type AutomationRun, type AutomationRunListItem, type RunOrganizeRefused as RunOrganizeRefusedItem, type RunStatus } from '@shared/automations'
import type { RunEmail } from '@shared/task-email'
import { Button } from '../../design/Button'
import { Select } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import { COST_HINT, costLabel } from '../chat/format'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { dayLabel, timeLabel } from '../meetings/format'
import { useAutomations } from '../agents/automationsStore'
import { RunAnswer } from '../agents/parts'

const runTitle = (run: Pick<AutomationRunListItem, 'taskName' | 'trigger' | 'agentName'>): string => run.taskName ?? `${RUN_TRIGGER_LABELS[run.trigger]}: ${run.agentName}`

export function RunsTab({ meetings }: { meetings: ChatMeetings }) {
  const runs = useAutomations((state) => state.runs)
  const tasks = useAutomations((state) => state.tasks)
  const openRunId = useAutomations((state) => state.openRunId)
  const [taskFilter, setTaskFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('')

  if (openRunId) return <RunDetail runId={openRunId} meetings={meetings} />

  const shown = runs.filter((run) => (!taskFilter || run.taskId === taskFilter) && (!statusFilter || run.status === statusFilter))
  const now = new Date()
  return (
    <div className="flex flex-col gap-4" data-runs-tab>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          id="runs-task-filter"
          value={taskFilter}
          options={[{ value: '', label: 'Todas as tarefas' }, ...tasks.map((task) => ({ value: task.id, label: task.name }))]}
          onChange={setTaskFilter}
        />
        <Select
          id="runs-status-filter"
          value={statusFilter}
          options={[{ value: '' as const, label: 'Todos os estados' }, ...RUN_STATUSES.map((status) => ({ value: status, label: RUN_STATUS_LABELS[status] }))]}
          onChange={setStatusFilter}
        />
        <span className="text-12 text-text-faint tabular">{shown.length === 1 ? '1 execução' : `${shown.length} execuções`}</span>
      </div>
      {shown.length === 0 ? (
        <p data-runs-empty className="text-13 text-text-muted">
          Nenhuma execução ainda.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="label border-b border-line-strong">
              <th className="py-1.5 pr-4 font-medium">Data</th>
              <th className="py-1.5 pr-4 font-medium">Tarefa</th>
              <th className="py-1.5 pr-4 font-medium">Agente</th>
              <th className="py-1.5 pr-4 font-medium">Estado</th>
              <th className="py-1.5 pr-4 font-medium">Duração</th>
              <th className="py-1.5 pr-4 font-medium">Custo</th>
              <th className="py-1.5 font-medium">Modelo</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((run) => {
              const date = new Date(run.startedAt)
              return (
                <tr
                  key={run.id}
                  data-run-row={run.id}
                  data-run-status={run.status}
                  data-run-trigger={run.trigger}
                  data-run-task={run.taskId ?? ''}
                  onClick={() => useAutomations.getState().openRun(run.id)}
                  className="cursor-default border-b border-line text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
                >
                  <td className="py-1.5 pr-4 text-text-muted tabular">
                    {dayLabel(date, now)} {timeLabel(date)}
                  </td>
                  <td className="py-1.5 pr-4">
                    <button type="button" data-action="run-open" onClick={() => useAutomations.getState().openRun(run.id)} className="no-drag text-left font-medium text-text hover:text-title">
                      {runTitle(run)}
                    </button>
                  </td>
                  <td className="py-1.5 pr-4 text-text-muted">{run.agentName}</td>
                  <td className={`py-1.5 pr-4 ${run.status === 'error' || run.status === 'timeout' ? 'text-rec' : 'text-text-muted'}`}>{RUN_STATUS_LABELS[run.status]}</td>
                  <td className="py-1.5 pr-4 text-text-muted tabular">{run.status === 'running' || run.status === 'skipped' ? '—' : durationLabel(run.durationMs)}</td>
                  <td className="py-1.5 pr-4 text-text-muted tabular" title={COST_HINT}>
                    {run.status === 'skipped' ? '—' : costLabel(run.costUsd)}
                  </td>
                  <td className="py-1.5 text-text-muted">{AGENT_MODEL_LABELS[run.model]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function RunDetail({ runId, meetings }: { runId: string; meetings: ChatMeetings }) {
  const [run, setRun] = useState<AutomationRun | null | undefined>(undefined)
  const finished = useAutomations((state) => state.finished[runId])
  const [rerun, setRerun] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.__scribeApi.invoke('scribe:runs-get', { id: runId }).then(
      (found) => {
        if (!alive) return
        setRun(found)
        // A gravada entra no store: a resposta aparece com os mesmos componentes da execução em curso.
        if (found && found.status !== 'running') useAutomations.setState((state) => (state.finished[runId] ? {} : { finished: { ...state.finished, [runId]: found } }))
      },
      () => alive && setRun(null),
    )
    return () => {
      alive = false
    }
  }, [runId, finished])

  const shown = finished ?? run
  const back = (
    <button type="button" data-action="run-back" onClick={() => useAutomations.getState().openRun(null)} className={QUIET_BUTTON}>
      <Icon icon={ArrowLeft} size={14} />
      Execuções
    </button>
  )
  if (run === undefined && !finished) return <div aria-busy="true">{back}</div>
  if (!shown) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-13 text-text-muted">Esta execução não está mais no histórico.</p>
      </div>
    )
  }
  const date = new Date(shown.startedAt)
  const again = async (): Promise<void> => {
    const result = await window.__scribeApi.invoke('scribe:runs-rerun', { id: shown.id })
    if (result.ok) {
      setRerun(result.runId)
      useAutomations.setState((state) => (state.finished[result.runId] || state.live[result.runId] ? {} : { live: { ...state.live, [result.runId]: { text: '', reading: false, thinking: '', steps: [], denied: 0, plan: [], meta: null, approvals: [] } } }))
    }
  }
  return (
    <div data-run-detail={shown.id} className="flex max-w-[820px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <Button action="run-again" variant="secondary" icon={RotateCcw} onClick={() => void again()} disabled={shown.status === 'running'}>
          Rodar de novo
        </Button>
      </div>
      <header className="flex flex-col gap-1">
        <h2 className="text-15 font-bold text-title">{runTitle(shown)}</h2>
        <p className="flex flex-wrap gap-x-2 text-12 text-text-muted tabular">
          <span>
            {dayLabel(date, new Date())} {timeLabel(date)}
          </span>
          <span aria-hidden="true">·</span>
          <span>{RUN_TRIGGER_LABELS[shown.trigger]}</span>
          <span aria-hidden="true">·</span>
          <span data-run-detail-status={shown.status}>{RUN_STATUS_LABELS[shown.status]}</span>
          {shown.status !== 'running' && shown.status !== 'skipped' && (
            <>
              <span aria-hidden="true">·</span>
              <span>{durationLabel(shown.durationMs)}</span>
              <span aria-hidden="true">·</span>
              <span title={COST_HINT}>{costLabel(shown.costUsd)}</span>
            </>
          )}
          {shown.outputResult && (
            <>
              <span aria-hidden="true">·</span>
              <span data-run-output>{shown.outputResult}</span>
            </>
          )}
        </p>
      </header>
      {shown.emails && shown.emails.length > 0 && <RunEmails emails={shown.emails} />}
      {shown.organizeRefused && shown.organizeRefused.length > 0 && <RunOrganizeRefused items={shown.organizeRefused} />}
      {shown.status === 'skipped' ? (
        <p data-run-error className="text-13 text-text-muted">
          {shown.error ?? 'Pulada.'}
        </p>
      ) : (
        <RunAnswer runId={shown.id} prompt={shown.prompt} meetings={meetings} />
      )}
      {rerun && (
        <section aria-label="Rodar de novo" className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-14 leading-5 font-semibold text-title">Rodando de novo</h3>
          <RunAnswer runId={rerun} prompt={null} meetings={meetings} />
        </section>
      )}
    </div>
  )
}

/**
 * Contrato 56 (D19, quadro 17): o modelo pediu para organizar o email numa tarefa agendada. Nada se moveu (a execução não
 * tem essas ferramentas): sem cartão e sem botão, só a recusa e para onde ir.
 */
function RunOrganizeRefused({ items }: { items: readonly RunOrganizeRefusedItem[] }) {
  return (
    <section aria-label="Organizar email nesta execução" data-run-organize className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <h3 className="text-13 font-medium text-text">
        Organizar email nesta execução{' '}
        <span className="font-normal text-text-muted tabular">· {items.length === 1 ? '1 pedido recusado' : `${items.length} pedidos recusados`}</span>
      </h3>
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={`${item.at}-${index}`} data-run-organize-refused className="flex items-start gap-2 text-13">
            <Icon icon={Ban} size={14} className="mt-0.5 shrink-0 text-rec" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-text">
                <span className="font-medium text-rec">Recusado</span> · {item.request}
              </p>
              <p className="text-12 text-text-muted">Tarefa agendada não move, não cria pasta e não apaga email. Para organizar, peça no Assistente.</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Contrato 51: os emails da execução, enviados e recusados, na ordem. */
function RunEmails({ emails }: { emails: readonly RunEmail[] }) {
  const sent = emails.filter((item) => item.ok).length
  const refused = emails.length - sent
  return (
    <section aria-label="Emails desta execução" data-run-emails className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <h3 className="text-13 font-medium text-text">
        Emails desta execução{' '}
        <span className="font-normal text-text-muted tabular">
          · {sent === 1 ? '1 enviado' : `${sent} enviados`} · {refused === 1 ? '1 recusado' : `${refused} recusados`}
        </span>
      </h3>
      <ol className="flex flex-col gap-3">
        {emails.map((item, index) => {
          const at = new Date(item.at)
          const recipients = [item.to.join(', '), item.cc.length ? `cc ${item.cc.join(', ')}` : '', item.bcc.length ? `cco ${item.bcc.join(', ')}` : ''].filter(Boolean).join(' · ')
          return (
            <li key={`${item.at}-${index}`} data-run-email={item.ok ? 'sent' : 'refused'} className="flex items-start gap-2 text-13">
              <Icon icon={item.ok ? Send : Ban} size={14} className={`mt-0.5 shrink-0 ${item.ok ? 'text-text-muted' : 'text-rec'}`} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="break-all text-text">
                  <span className={item.ok ? 'font-medium' : 'font-medium text-rec'}>{item.ok ? 'Enviado' : 'Recusado'}</span> · para <span data-run-email-to>{recipients || '—'}</span>
                </p>
                <p className="text-12 text-text-muted">
                  <span data-run-email-subject>{item.subject || '(sem assunto)'}</span> · <span className="tabular">{timeLabel(at)}</span>
                </p>
                <p className="break-all text-12 text-text-muted">{item.ok ? <span data-run-email-id>Message-ID {item.messageId}</span> : <span data-run-email-error>{item.error}</span>}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
