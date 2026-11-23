// Aba "Agendamentos" (contrato 23, CA4; o nome é do contrato 128): tabela com nome, agente, quando ("Toda sexta às 17:00 · próxima:
// sex 21/11 17:00"), última execução (estado, tempo e "há 2 h") e o interruptor; ações "Rodar agora", "Editar",
// "Duplicar" e "Excluir" (confirma). O formulário abre no lugar da tabela.
//
// Contrato 25: o lembrete criado pelo Assistente aparecia aqui como "Lembrete" (sem agente). Contrato 127 (R33): os
// lembretes viraram tarefas e a lista não mostra mais nenhum. "Criar agendamento" num cartão do Assistente abre o
// formulário já preenchido.
//
// Contrato 51: a tarefa com "Pode enviar email" mostra o ícone de envio ao lado do nome e a linha com a data da
// permissão e quantos destinatários ela tem.
import { Copy, Pencil, Play, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { agoLabel, durationLabel, formatRunAt, isValidTimeZone, RUN_STATUS_LABELS, scheduleLine, TASK_NAME_MAX, type ScheduledTask, type TaskInput } from '@shared/automations'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Switch } from '../../design/Switch'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { useAutomations } from '../agents/automationsStore'
import { useChat } from '../chat/chatStore'
import { blankTask, TaskForm } from './TaskForm'

const inputOf = (task: ScheduledTask): TaskInput => ({
  id: task.id,
  name: task.name,
  agentId: task.agentId,
  message: task.message,
  schedule: task.schedule,
  timezone: task.timezone,
  enabled: task.enabled,
  runOnce: task.runOnce,
  runOnceAction: task.runOnceAction,
  timeoutS: task.timeoutS,
  notify: task.notify,
  output: task.output,
  email: task.email ? { accountId: task.email.accountId, allow: task.email.allow, maxPerRun: task.email.maxPerRun } : null,
})

/** Contrato 51: "Pode enviar email · permitido em sex 20/11 10:12 · 3 destinatários". */
function emailLine(task: ScheduledTask): string | null {
  if (!task.email) return null
  const at = Date.parse(task.email.grantedAt)
  const when = Number.isNaN(at) || !isValidTimeZone(task.timezone) ? '' : ` · permitido em ${formatRunAt(at, task.timezone)}`
  const count = task.email.allow.length === 1 ? '1 destinatário' : `${task.email.allow.length} destinatários`
  return `Pode enviar email${when} · ${count} · até ${task.email.maxPerRun} por execução`
}

export function SchedulesTab({ meetings }: { meetings: ChatMeetings }) {
  // Contrato 127 (R33): um lembrete que ainda reste nas Automações fica fora da lista (os lembretes são tarefas).
  const tasks = useAutomations((state) => state.tasks).filter((task) => !task.reminder)
  const agents = useAutomations((state) => state.agents)
  // O rascunho do cartão do Assistente, se houver, abre o formulário de cara.
  const [fromChat] = useState(() => useAutomations.getState().takeTaskDraft())
  const [editing, setEditing] = useState<TaskInput | null>(fromChat?.input ?? null)
  const [origin, setOrigin] = useState(fromChat?.origin ?? null)

  if (editing)
    return (
      <TaskForm
        key={editing.id ?? 'nova'}
        initial={editing}
        meetings={meetings}
        onClose={() => {
          setEditing(null)
          setOrigin(null)
        }}
        onSaved={origin ? () => void useChat.getState().setActionState(origin, 'task-created') : undefined}
      />
    )

  return (
    <div className="flex flex-col gap-4" data-tasks-tab>
      <div className="flex items-center justify-between gap-4">
        <p className="text-13 text-text-muted">Os agendamentos rodam com o app aberto, com a janela aberta ou só o ícone na barra de menus.</p>
        <Button action="task-new" icon={Plus} onClick={() => setEditing(blankTask(agents))} disabled={!agents.length}>
          Novo agendamento
        </Button>
      </div>
      {tasks.length === 0 ? (
        <p data-tasks-empty className="text-13 text-text-muted">
          Nenhum agendamento. Crie um com "Novo agendamento": as sugestões prontas aparecem no formulário.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="label border-b border-line-strong">
              <th className="py-1.5 pr-4 font-medium">Nome</th>
              <th className="py-1.5 pr-4 font-medium">Agente</th>
              <th className="py-1.5 pr-4 font-medium">Quando</th>
              <th className="py-1.5 pr-4 font-medium">Última execução</th>
              <th className="py-1.5 pr-4 font-medium">Ligada</th>
              <th className="py-1.5 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                agentName={agents.find((agent) => agent.id === task.agentId)?.name ?? 'Agente excluído'}
                onEdit={() => setEditing(inputOf(task))}
                onDuplicate={() => setEditing({ ...inputOf(task), id: null, name: `${task.name.slice(0, TASK_NAME_MAX - 8).trimEnd()} (cópia)` })}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Contrato 162: quanto tempo a recusa do interruptor fica na linha. */
const TOGGLE_ERROR_MS = 6000

function TaskRow({ task, agentName, onEdit, onDuplicate }: { task: ScheduledTask; agentName: string; onEdit: () => void; onDuplicate: () => void }) {
  const lastRun = useAutomations((state) => state.runs.find((run) => run.taskId === task.id && run.status !== 'skipped') ?? null)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const switchId = `task-switch-${task.id}`
  // Contrato 162 (adendo): ligar uma segunda triagem é recusado; o interruptor fica como estava e a frase aparece na
  // linha por 6 s (ou até mexer de novo).
  const [toggleError, setToggleError] = useState<string | null>(null)
  useEffect(() => {
    if (!toggleError) return
    const timer = setTimeout(() => setToggleError(null), TOGGLE_ERROR_MS)
    return () => clearTimeout(timer)
  }, [toggleError])
  const toggle = async (enabled: boolean): Promise<void> => {
    setToggleError(null)
    const result = await window.__scribeApi.invoke('scribe:tasks-toggle', { id: task.id, enabled })
    if (result && 'ok' in result && !result.ok) setToggleError(result.error)
    await useAutomations.getState().load()
  }
  const runNow = async (): Promise<void> => {
    const result = await window.__scribeApi.invoke('scribe:tasks-run-now', { id: task.id })
    setNotice(result.ok ? null : result.error === 'busy' ? 'Já está rodando: esta vez ficou como pulada.' : 'Não foi possível rodar.')
    await useAutomations.getState().load()
  }
  const remove = async (): Promise<void> => {
    await window.__scribeApi.invoke('scribe:tasks-delete', { id: task.id })
    setConfirming(false)
    await useAutomations.getState().load()
  }
  const permission = emailLine(task)
  const last = (() => {
    if (task.autoPaused) return 'Pausada depois de 3 falhas'
    if (!task.lastStatus) return 'Ainda não rodou'
    const parts = [RUN_STATUS_LABELS[task.lastStatus]]
    if (lastRun && lastRun.status !== 'running') parts.push(durationLabel(lastRun.durationMs))
    if (task.lastRunAt) parts.push(agoLabel(Date.parse(task.lastRunAt), new Date().getTime()))
    return parts.join(' · ')
  })()
  return (
    <tr data-task-row={task.id} data-task-name={task.name} data-task-status={task.lastStatus ?? ''} data-task-paused={task.autoPaused ? 'auto' : undefined} data-task-email={task.email ? '' : undefined} className="border-b border-line align-top text-13">
      <td className="py-1.5 pr-4">
        <span id={switchId} className="inline-flex items-center gap-1.5 font-medium text-text">
          {task.name}
          {permission && (
            <span data-task-email-icon title={permission} className="inline-flex shrink-0 text-text-muted">
              <Icon icon={Send} size={14} />
              <span className="sr-only">Pode enviar email</span>
            </span>
          )}
        </span>
        {permission && (
          <p data-task-email-line className="mt-0.5 text-12 text-text-muted tabular">
            {permission}
          </p>
        )}
        {notice && <p className="mt-0.5 text-12 text-text-muted">{notice}</p>}
        {toggleError && (
          <p role="alert" data-task-toggle-error className="mt-0.5 text-12 text-rec">
            {toggleError}
          </p>
        )}
      </td>
      <td className="py-1.5 pr-4 text-text-muted">{agentName}</td>
      <td data-task-when className="py-1.5 pr-4 text-text tabular">
        {scheduleLine(task)}
      </td>
      <td data-task-last className={`py-1.5 pr-4 tabular ${task.autoPaused || task.lastStatus === 'error' || task.lastStatus === 'timeout' ? 'text-rec' : 'text-text-muted'}`}>
        {last}
      </td>
      <td className="py-1.5 pr-4">
        <Switch checked={task.enabled && !task.autoPaused} labelledBy={switchId} onChange={(enabled) => void toggle(enabled)} />
      </td>
      <td className="py-0.5">
        <div className="-mr-2 flex flex-wrap justify-end gap-1">
          <button type="button" data-action="task-run-now" onClick={() => void runNow()} className={QUIET_BUTTON}>
            <Icon icon={Play} size={14} />
            Rodar agora
          </button>
          <button type="button" data-action="task-edit" onClick={onEdit} className={QUIET_BUTTON}>
            <Icon icon={Pencil} size={14} />
            Editar
          </button>
          <button type="button" data-action="task-duplicate" onClick={onDuplicate} className={QUIET_BUTTON}>
            <Icon icon={Copy} size={14} />
            Duplicar
          </button>
          {confirming ? (
            <>
              <button type="button" data-action="task-delete-confirm" onClick={() => void remove()} className={`${QUIET_BUTTON} text-rec`}>
                Excluir
              </button>
              <button type="button" data-action="task-delete-cancel" onClick={() => setConfirming(false)} className={QUIET_BUTTON}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" data-action="task-delete" onClick={() => setConfirming(true)} className={QUIET_BUTTON}>
              <Icon icon={Trash2} size={14} />
              Excluir
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
