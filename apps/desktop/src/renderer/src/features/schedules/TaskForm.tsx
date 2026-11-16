// Formulário de tarefa agendada (contrato 23, CA4): nome, agente, mensagem, frequência por seletores simples
// (com "Avançado: expressão cron"), fuso, saída, avisos, tempo máximo, "Rodar uma vez só" e a prévia "Próximas 5
// execuções". Na tarefa nova, as sugestões prontas preenchem o formulário (a pessoa ainda salva).
import { ArrowLeft, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import {
  AGENT_OUTPUT_KINDS,
  describeSchedule,
  formatRunAt,
  isValidTimeZone,
  nextRuns,
  NOTIFY_LABELS,
  NOTIFY_POLICIES,
  OUTPUT_LABELS,
  TASK_MESSAGE_MAX,
  TASK_NAME_MAX,
  TASK_TIMEOUT_DEFAULT_S,
  TASK_TIMEOUT_MAX_S,
  TASK_TIMEOUT_MIN_S,
  WEEKDAY_OPTIONS,
  type Agent,
  type AgentOutputKind,
  type NotifyPolicy,
  type RunOnceAction,
  type ScheduleKind,
  type TaskInput,
} from '@shared/automations'
import { Button } from '../../design/Button'
import { Select, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Segmented } from '../../design/Segmented'
import { Switch } from '../../design/Switch'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { AREA_CLASS, FormField, INPUT_CLASS } from '../agents/parts'
import { useAutomations } from '../agents/automationsStore'
import { draftOf, FREQUENCY_OPTIONS, scheduleOf, type FrequencyDraft } from './frequency'

/** Fuso do Mac. */
export const macTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export function blankTask(agents: readonly Agent[]): TaskInput {
  return {
    id: null,
    name: '',
    agentId: agents[0]?.id ?? '',
    message: '',
    schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' },
    timezone: macTimeZone(),
    enabled: true,
    runOnce: false,
    runOnceAction: 'disable',
    timeoutS: TASK_TIMEOUT_DEFAULT_S,
    notify: 'on-error',
    output: null,
  }
}

interface Suggestion {
  label: string
  agent: string
  build: (agentId: string) => Omit<TaskInput, 'id' | 'agentId' | 'timezone'>
}

/** Sugestões prontas ao criar (CA4). */
const SUGGESTIONS: readonly Suggestion[] = [
  {
    label: 'Toda sexta 17:00 — Resumo da semana',
    agent: 'Resumo da semana',
    build: () => ({ name: 'Resumo da semana', message: 'Faça o resumo das reuniões desta semana.', schedule: { kind: 'weekly', days: [5], time: '17:00' }, enabled: true, runOnce: false, runOnceAction: 'disable', timeoutS: TASK_TIMEOUT_DEFAULT_S, notify: 'always', output: null }),
  },
  {
    label: 'Todo dia útil 08:00 — Minhas tarefas',
    agent: 'Minhas tarefas',
    build: () => ({ name: 'Minhas tarefas do dia', message: 'Quais são as minhas tarefas, com prazo?', schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }, enabled: true, runOnce: false, runOnceAction: 'disable', timeoutS: TASK_TIMEOUT_DEFAULT_S, notify: 'on-error', output: null }),
  },
  {
    label: 'Depois de cada reunião — Pendências da reunião',
    agent: 'Pendências da reunião',
    build: () => ({ name: 'Pendências da reunião', message: 'Quais são as pendências desta reunião?', schedule: { kind: 'after-meeting', delayMin: 0 }, enabled: true, runOnce: false, runOnceAction: 'disable', timeoutS: TASK_TIMEOUT_DEFAULT_S, notify: 'on-error', output: null }),
  },
]

const TASK_ERRORS: Record<string, string> = {
  agent: 'Escolha um agente que exista.',
  cron: 'Expressão cron inválida.',
  timezone: 'Fuso desconhecido. Use um nome como America/Sao_Paulo.',
  missing: 'Esta tarefa não existe mais.',
  full: 'Limite de tarefas atingido.',
  past: 'A data de “Uma vez em” já passou. Escolha um horário no futuro.',
  invalid: 'Confira os campos da tarefa.',
}

export function TaskForm({ initial, meetings, onClose }: { initial: TaskInput; meetings: ChatMeetings; onClose: () => void }) {
  const agents = useAutomations((state) => state.agents)
  const [task, setTask] = useState<TaskInput>(initial)
  const [frequency, setFrequency] = useState<FrequencyDraft>(() => draftOf(initial.schedule, Date.now(), initial.timezone))
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const patch = (next: Partial<TaskInput>): void => setTask((current) => ({ ...current, ...next }))
  const patchFrequency = (next: Partial<FrequencyDraft>): void => setFrequency((current) => ({ ...current, ...next }))

  const timeZoneOk = isValidTimeZone(task.timezone)
  const now = new Date().getTime()
  const built = timeZoneOk ? scheduleOf(frequency, task.timezone, now) : { error: 'Fuso desconhecido.' }
  const schedule = 'schedule' in built ? built.schedule : null
  const preview = schedule && timeZoneOk ? nextRuns(schedule, task.timezone, now, 5) : []
  const agent = agents.find((candidate) => candidate.id === task.agentId)
  const valid = schedule !== null && task.name.trim() !== '' && task.message.trim() !== '' && agent !== undefined && task.timeoutS >= TASK_TIMEOUT_MIN_S && task.timeoutS <= TASK_TIMEOUT_MAX_S

  const save = async (): Promise<void> => {
    if (!schedule) return
    setSaving(true)
    setFailure(null)
    const result = await window.__scribeApi.invoke('scribe:tasks-save', { ...task, name: task.name.trim(), schedule })
    setSaving(false)
    if (!result.ok) {
      setFailure(TASK_ERRORS[result.error] ?? TASK_ERRORS['invalid'] ?? '')
      return
    }
    await useAutomations.getState().load()
    onClose()
  }

  const suggest = (suggestion: Suggestion): void => {
    const target = agents.find((candidate) => candidate.name === suggestion.agent) ?? agents[0]
    const next = { ...suggestion.build(target?.id ?? ''), id: null, agentId: target?.id ?? '', timezone: task.timezone }
    setTask(next)
    setFrequency(draftOf(next.schedule, new Date().getTime(), next.timezone))
  }

  const agentOptions = [{ value: '', label: 'Escolha o agente' }, ...agents.map((candidate) => ({ value: candidate.id, label: candidate.name }))]
  const outputValue: AgentOutputKind | 'inherit' = task.output?.kind ?? 'inherit'
  const outputOptions = [{ value: 'inherit' as const, label: agent ? `A do agente (${OUTPUT_LABELS[agent.output.kind]})` : 'A do agente' }, ...AGENT_OUTPUT_KINDS.map((kind) => ({ value: kind, label: OUTPUT_LABELS[kind] }))]
  const meetingOptions = [{ value: '', label: 'Escolha a reunião' }, ...(meetings.list ?? []).map((entry) => ({ value: entry.meeting.id, label: entry.meeting.title }))]

  return (
    <div data-task-form className="flex max-w-[760px] flex-col gap-6">
      <div className="flex items-center gap-2">
        <button type="button" data-action="task-form-back" onClick={onClose} className={QUIET_BUTTON}>
          <Icon icon={ArrowLeft} size={14} />
          Tarefas agendadas
        </button>
        <h2 className="text-17 font-bold text-title">{initial.id ? 'Editar tarefa' : 'Nova tarefa'}</h2>
      </div>

      {initial.id === null && (
        <div data-task-suggestions className="flex flex-wrap items-center gap-2">
          <Icon icon={Lightbulb} size={14} className="text-text-faint" />
          <span className="text-12 text-text-muted">Sugestões:</span>
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion.label} type="button" data-task-suggestion={suggestion.agent} onClick={() => suggest(suggestion)} className={`${QUIET_BUTTON} border border-line-strong`}>
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      <FormField label="Nome" htmlFor="task-name">
        <TextField id="task-name" value={task.name} onChange={(name) => patch({ name })} maxLength={TASK_NAME_MAX} placeholder="Ex.: Resumo de sexta" />
      </FormField>
      <FormField label="Agente" htmlFor="task-agent">
        <Select id="task-agent" value={task.agentId} options={agentOptions} onChange={(agentId) => patch({ agentId })} />
      </FormField>
      <FormField label="Mensagem" htmlFor="task-message" hint="O que pedir ao agente a cada vez. A data, a hora e o fuso vão junto, no começo.">
        <textarea id="task-message" rows={4} value={task.message} maxLength={TASK_MESSAGE_MAX} onChange={(event) => patch({ message: event.target.value })} className={AREA_CLASS} />
      </FormField>

      <FormField label="Frequência" htmlFor="task-frequency" hint={schedule ? describeSchedule(schedule, task.timezone) : 'error' in built ? built.error : ''}>
        <div className="flex flex-wrap items-center gap-2" data-task-frequency={frequency.kind}>
          <Select id="task-frequency" value={frequency.kind} options={FREQUENCY_OPTIONS} onChange={(kind: ScheduleKind) => patchFrequency({ kind })} />
          <FrequencyControls draft={frequency} onChange={patchFrequency} />
        </div>
      </FormField>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        <FormField label="Fuso" htmlFor="task-timezone" hint={timeZoneOk ? 'Padrão: o fuso deste Mac.' : 'Fuso desconhecido.'}>
          <TextField id="task-timezone" value={task.timezone} onChange={(timezone) => patch({ timezone })} maxLength={64} />
        </FormField>
        <FormField label="Tempo máximo (segundos)" htmlFor="task-timeout" hint={`De ${TASK_TIMEOUT_MIN_S} a ${TASK_TIMEOUT_MAX_S}.`}>
          <input
            id="task-timeout"
            type="number"
            min={TASK_TIMEOUT_MIN_S}
            max={TASK_TIMEOUT_MAX_S}
            step={30}
            value={task.timeoutS}
            onChange={(event) => patch({ timeoutS: Number(event.target.value) })}
            className={`${INPUT_CLASS} w-32`}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        <FormField label="Saída" htmlFor="task-output">
          <Select
            id="task-output"
            value={outputValue}
            options={outputOptions}
            onChange={(value) => patch({ output: value === 'inherit' ? null : value === 'note' ? { kind: 'note', meetingId: task.output?.meetingId ?? null } : { kind: value } })}
          />
        </FormField>
        <FormField label="Avisos" htmlFor="task-notify" hint="Notificação do macOS ao terminar.">
          <Select id="task-notify" value={task.notify} options={NOTIFY_POLICIES.map((value) => ({ value, label: NOTIFY_LABELS[value] }))} onChange={(notify: NotifyPolicy) => patch({ notify })} />
        </FormField>
      </div>
      {task.output?.kind === 'note' && frequency.kind !== 'after-meeting' && (
        <FormField label="Reunião do post-it" htmlFor="task-output-meeting">
          <Select id="task-output-meeting" value={task.output.meetingId ?? ''} options={meetingOptions} onChange={(meetingId) => patch({ output: { kind: 'note', meetingId: meetingId || null } })} />
        </FormField>
      )}

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <Switch checked={task.enabled} labelledBy="task-enabled" onChange={(enabled) => patch({ enabled })} />
          <span id="task-enabled" className="text-13 text-text">
            Ligada
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={task.runOnce} labelledBy="task-run-once" onChange={(runOnce) => patch({ runOnce })} />
          <span id="task-run-once" className="text-13 text-text">
            Rodar uma vez só
          </span>
          {task.runOnce && (
            <Segmented
              value={task.runOnceAction}
              options={[
                { value: 'delete' as RunOnceAction, label: 'Excluir depois' },
                { value: 'disable' as RunOnceAction, label: 'Desligar depois' },
              ]}
              labelledBy="task-run-once"
              dataName="task-run-once-option"
              onChange={(runOnceAction) => patch({ runOnceAction })}
            />
          )}
        </div>
      </div>

      <section aria-label="Próximas 5 execuções" data-task-preview className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-4">
        <h3 className="text-13 font-medium text-text">Próximas 5 execuções</h3>
        {frequency.kind === 'after-meeting' ? (
          <p className="text-12 text-text-muted">Roda depois de cada reunião encerrada, com o escopo apontando para ela.</p>
        ) : preview.length ? (
          <ol className="flex flex-col gap-1">
            {preview.map((at) => (
              <li key={at} data-task-preview-item className="text-13 text-text tabular">
                {formatRunAt(at, task.timezone)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-12 text-text-muted">{'error' in built ? built.error : 'Nenhum horário pela frente.'}</p>
        )}
      </section>

      {failure && (
        <p role="alert" data-task-form-error className="text-13 text-rec">
          {failure}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button action="task-save" onClick={() => void save()} disabled={!valid || saving}>
          Salvar tarefa
        </Button>
        <Button action="task-cancel" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** Os controles de cada frequência, ao lado do seletor. */
function FrequencyControls({ draft, onChange }: { draft: FrequencyDraft; onChange: (patch: Partial<FrequencyDraft>) => void }) {
  const time = (
    <input type="time" aria-label="Horário" data-task-time value={draft.time} onChange={(event) => onChange({ time: event.target.value })} className={`${INPUT_CLASS} w-28`} />
  )
  switch (draft.kind) {
    case 'every':
      return (
        <>
          <input type="number" aria-label="Intervalo" data-task-every min={1} max={1440} value={draft.everyValue} onChange={(event) => onChange({ everyValue: Number(event.target.value) })} className={`${INPUT_CLASS} w-24`} />
          <Select value={draft.everyUnit} options={[{ value: 'min' as const, label: 'minutos' }, { value: 'h' as const, label: 'horas' }]} onChange={(everyUnit) => onChange({ everyUnit })} />
        </>
      )
    case 'daily':
      return time
    case 'weekly':
      return (
        <>
          <div role="group" aria-label="Dias da semana" className="flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
            {WEEKDAY_OPTIONS.map((day, index) => {
              const on = draft.days.includes(day.value)
              return (
                <button
                  key={day.value}
                  type="button"
                  data-task-day={day.value}
                  aria-pressed={on}
                  aria-label={day.label}
                  onClick={() => onChange({ days: on ? draft.days.filter((value) => value !== day.value) : [...draft.days, day.value] })}
                  className={`no-drag h-10 w-11 text-13 ${index > 0 ? 'border-l border-line-strong' : ''} ${on ? 'bg-title font-medium text-bg' : 'bg-bg-raised text-text hover:bg-bg-sunken'}`}
                >
                  {day.short}
                </button>
              )
            })}
          </div>
          {time}
        </>
      )
    case 'monthly':
      return (
        <>
          <input type="number" aria-label="Dia do mês" data-task-month-day min={1} max={28} value={draft.monthDay} onChange={(event) => onChange({ monthDay: Number(event.target.value) })} className={`${INPUT_CLASS} w-20`} />
          {time}
        </>
      )
    case 'once':
      return <input type="datetime-local" aria-label="Dia e horário" data-task-once value={draft.onceAt} onChange={(event) => onChange({ onceAt: event.target.value })} className={`${INPUT_CLASS} w-56`} />
    case 'after-meeting':
      return (
        <>
          <input type="number" aria-label="Minutos depois" data-task-delay min={0} max={60} value={draft.delayMin} onChange={(event) => onChange({ delayMin: Number(event.target.value) })} className={`${INPUT_CLASS} w-20`} />
          <span className="text-13 text-text-muted">min depois</span>
        </>
      )
    case 'cron':
      return <input type="text" aria-label="Expressão cron" data-task-cron spellCheck={false} value={draft.cron} onChange={(event) => onChange({ cron: event.target.value })} className={`${INPUT_CLASS} w-56 font-mono`} />
  }
}

