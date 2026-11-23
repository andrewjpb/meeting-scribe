// Formulário de agendamento (contrato 23, CA4): nome, agente, mensagem, frequência por seletores simples
// (com "Avançado: expressão cron"), fuso, saída, avisos, tempo máximo, "Rodar uma vez só" e a prévia "Próximas 5
// execuções". Na tarefa nova, as sugestões prontas preenchem o formulário (a pessoa ainda salva).
//
// Contrato 51: a seção "Pode enviar email", desligada por padrão. Ligada, pede a conta que envia, a lista de
// destinatários permitidos (endereços exatos e/ou domínios `@empresa.com`, de 1 a 50) e o teto por execução (padrão 5,
// até 20). Ligar e salvar é a permissão; o main grava a data.
import { ArrowLeft, Info, Lightbulb, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import type { EmailAccountStatus } from '@shared/email'
import { allowEntryValid, parseAllowList, TASK_EMAIL_ALLOW_MAX, TASK_EMAIL_ALLOW_MIN, TASK_EMAIL_MAX_PER_RUN_DEFAULT, TASK_EMAIL_MAX_PER_RUN_MAX, type TaskEmailInput } from '@shared/task-email'
import { TRIAGEM_ESPERA_SEG } from '@shared/triagem'
import { urlsIn } from '@shared/web-urls'
import { Button } from '../../design/Button'
import { Select, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
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

/**
 * Contrato 162 (R15): o aviso do gatilho "Quando chega mensagem do WhatsApp", e a mensagem que vai quando a pessoa deixa
 * o campo vazio nesse gatilho (o main exige uma; é a mesma da tarefa criada pelo modelo pronto).
 */
export const WHATSAPP_TRIGGER_NOTICE = 'Esta tarefa deixa o agente ler as últimas mensagens da conversa que recebeu a mensagem, e nada mais do WhatsApp. O agente só grava uma etiqueta; não envia nem apaga.'
const WHATSAPP_TRIGGER_MESSAGE = 'Classificar a conversa do WhatsApp que recebeu mensagem.'

/** A frase da recusa do save; a da unicidade da triagem (contrato 161) já vem pronta do main. */
export function taskErrorText(error: string): string {
  if (error.startsWith('Já existe um agente de triagem ativo')) return error
  return TASK_ERRORS[error] ?? TASK_ERRORS['invalid'] ?? ''
}

const TASK_ERRORS: Record<string, string> = {
  agent: 'Escolha um agente que exista.',
  cron: 'Expressão cron inválida.',
  timezone: 'Fuso desconhecido. Use um nome como America/Sao_Paulo.',
  missing: 'Este agendamento não existe mais.',
  full: 'Limite de agendamentos atingido.',
  past: 'A data de “Uma vez em” já passou. Escolha um horário no futuro.',
  email: 'A conta de email escolhida em “Pode enviar email” não está mais no app.',
  invalid: 'Confira os campos do agendamento.',
}

/** Contrato 51: o rascunho da seção "Pode enviar email" (a lista como foi digitada). */
interface EmailDraft {
  on: boolean
  accountId: string
  allowText: string
  maxPerRun: number
}

const emailDraftOf = (email: TaskEmailInput | null | undefined): EmailDraft =>
  email ? { on: true, accountId: email.accountId, allowText: email.allow.join('\n'), maxPerRun: email.maxPerRun } : { on: false, accountId: '', allowText: '', maxPerRun: TASK_EMAIL_MAX_PER_RUN_DEFAULT }

/** A seção validada: a permissão para salvar, ou o que falta. */
function emailOf(draft: EmailDraft, accounts: readonly EmailAccountStatus[]): { email: TaskEmailInput | null } | { error: string } {
  if (!draft.on) return { email: null }
  if (!accounts.some((status) => status.account.id === draft.accountId)) return { error: 'Escolha a conta que envia.' }
  const allow = parseAllowList(draft.allowText)
  const wrong = allow.filter((entry) => !allowEntryValid(entry))
  if (wrong.length) return { error: `Não é endereço nem domínio: ${wrong.slice(0, 3).join(', ')}${wrong.length > 3 ? '…' : ''}` }
  if (allow.length < TASK_EMAIL_ALLOW_MIN) return { error: 'Digite pelo menos um destinatário permitido.' }
  if (allow.length > TASK_EMAIL_ALLOW_MAX) return { error: `No máximo ${TASK_EMAIL_ALLOW_MAX} destinatários (são ${allow.length}).` }
  if (!Number.isInteger(draft.maxPerRun) || draft.maxPerRun < 1 || draft.maxPerRun > TASK_EMAIL_MAX_PER_RUN_MAX) return { error: `O teto vai de 1 a ${TASK_EMAIL_MAX_PER_RUN_MAX} envios.` }
  return { email: { accountId: draft.accountId, allow, maxPerRun: draft.maxPerRun } }
}

export function TaskForm({ initial, meetings, onClose, onSaved }: { initial: TaskInput; meetings: ChatMeetings; onClose: () => void; onSaved?: (() => void) | undefined }) {
  const agents = useAutomations((state) => state.agents)
  const [task, setTask] = useState<TaskInput>(initial)
  const [frequency, setFrequency] = useState<FrequencyDraft>(() => draftOf(initial.schedule, Date.now(), initial.timezone))
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [emailDraft, setEmailDraft] = useState<EmailDraft>(() => emailDraftOf(initial.email))
  const [emailAccounts, setEmailAccounts] = useState<EmailAccountStatus[] | null>(null)
  const grantedAt = useAutomations((state) => (initial.id ? (state.tasks.find((known) => known.id === initial.id)?.email?.grantedAt ?? null) : null))
  useEffect(() => {
    let alive = true
    void window.__scribeApi.invoke('scribe:email-accounts').then(
      (list) => {
        if (alive) setEmailAccounts(list)
      },
      () => alive && setEmailAccounts([]),
    )
    return () => {
      alive = false
    }
  }, [])
  const patch = (next: Partial<TaskInput>): void => setTask((current) => ({ ...current, ...next }))
  const patchFrequency = (next: Partial<FrequencyDraft>): void => setFrequency((current) => ({ ...current, ...next }))

  const timeZoneOk = isValidTimeZone(task.timezone)
  const now = new Date().getTime()
  const built = timeZoneOk ? scheduleOf(frequency, task.timezone, now) : { error: 'Fuso desconhecido.' }
  const schedule = 'schedule' in built ? built.schedule : null
  const preview = schedule && timeZoneOk ? nextRuns(schedule, task.timezone, now, 5) : []
  const agent = agents.find((candidate) => candidate.id === task.agentId)
  const webUrls = urlsIn(task.message)
  const email = emailOf(emailDraft, emailAccounts ?? [])
  // Contrato 162: no gatilho do WhatsApp a mensagem é opcional (o agente recebe a conversa que chegou).
  const whatsappTrigger = frequency.kind === 'whatsapp-message'
  const valid = schedule !== null && task.name.trim() !== '' && (whatsappTrigger || task.message.trim() !== '') && agent !== undefined && task.timeoutS >= TASK_TIMEOUT_MIN_S && task.timeoutS <= TASK_TIMEOUT_MAX_S && 'email' in email

  const save = async (): Promise<void> => {
    if (!schedule || !('email' in email)) return
    setSaving(true)
    setFailure(null)
    const message = whatsappTrigger && !task.message.trim() ? WHATSAPP_TRIGGER_MESSAGE : task.message
    const result = await window.__scribeApi.invoke('scribe:tasks-save', { ...task, name: task.name.trim(), message, schedule, email: email.email })
    setSaving(false)
    if (!result.ok) {
      setFailure(taskErrorText(result.error))
      return
    }
    await useAutomations.getState().load()
    onSaved?.()
    onClose()
  }

  const suggest = (suggestion: Suggestion): void => {
    const target = agents.find((candidate) => candidate.name === suggestion.agent) ?? agents[0]
    const next = { ...suggestion.build(target?.id ?? ''), id: null, agentId: target?.id ?? '', timezone: task.timezone }
    setTask(next)
    setEmailDraft(emailDraftOf(null))
    setFrequency(draftOf(next.schedule, new Date().getTime(), next.timezone))
  }

  const agentOptions = [{ value: '', label: 'Escolha o agente' }, ...agents.map((candidate) => ({ value: candidate.id, label: candidate.name }))]
  const outputValue: AgentOutputKind | 'inherit' = task.output?.kind ?? 'inherit'
  const outputOptions = [{ value: 'inherit' as const, label: agent ? `A do agente (${OUTPUT_LABELS[agent.output.kind]})` : 'A do agente' }, ...AGENT_OUTPUT_KINDS.map((kind) => ({ value: kind, label: OUTPUT_LABELS[kind] }))]
  const meetingOptions = [{ value: '', label: 'Escolha a reunião' }, ...(meetings.list ?? []).map((entry) => ({ value: entry.meeting.id, label: entry.meeting.title }))]

  return (
    <div data-task-form className="flex max-w-[760px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" data-action="task-form-back" onClick={onClose} className={QUIET_BUTTON}>
          <Icon icon={ArrowLeft} size={14} />
          Agendamentos
        </button>
        <h2 className="text-15 font-bold text-title">{initial.id ? 'Editar agendamento' : 'Novo agendamento'}</h2>
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
      <FormField
        label="Mensagem"
        htmlFor="task-message"
        hint={whatsappTrigger ? <span data-task-message-help>Opcional neste gatilho: o agente recebe a conversa que chegou.</span> : 'O que pedir ao agente a cada vez. A data, a hora e o fuso vão junto, no começo.'}
      >
        <textarea id="task-message" rows={4} value={task.message} maxLength={TASK_MESSAGE_MAX} onChange={(event) => patch({ message: event.target.value })} className={AREA_CLASS} />
        {/* Contrato 26: os endereços da mensagem contam como digitados (o agente com internet pode abri-los). A mensagem
            pode ter vindo de um cartão do Assistente: a pessoa vê a lista antes de salvar. */}
        {agent?.web && webUrls.length > 0 && (
          <p data-task-web-urls className="text-12 break-all text-text-muted">
            O agente poderá abrir: {webUrls.join(', ')}
          </p>
        )}
      </FormField>

      <FormField label="Frequência" htmlFor="task-frequency" hint={schedule ? describeSchedule(schedule, task.timezone) : 'error' in built ? built.error : ''}>
        <div className="flex flex-wrap items-center gap-2" data-task-frequency={frequency.kind}>
          <Select id="task-frequency" value={frequency.kind} options={FREQUENCY_OPTIONS} onChange={(kind: ScheduleKind) => patchFrequency({ kind })} />
          <FrequencyControls draft={frequency} onChange={patchFrequency} />
        </div>
        {/* Contrato 162: "Incluir grupos" e o aviso do que o agente lê, abaixo do seletor. */}
        {whatsappTrigger && (
          <div data-task-grupos={frequency.grupos ? 'on' : 'off'} className="flex items-center gap-2.5">
            <Switch checked={frequency.grupos} labelledBy="task-grupos" action="task-grupos" onChange={(grupos) => patchFrequency({ grupos })} />
            <span id="task-grupos" className="text-13 text-text">
              Incluir grupos
            </span>
          </div>
        )}
      </FormField>
      {whatsappTrigger && (
        <div data-task-whatsapp-aviso>
          <Note id="task-whatsapp-aviso" icon={Info}>
            {WHATSAPP_TRIGGER_NOTICE}
          </Note>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
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

      <EmailSection draft={emailDraft} accounts={emailAccounts} grantedAt={grantedAt} timeZone={task.timezone} error={'error' in email ? email.error : null} onChange={(next) => setEmailDraft((current) => ({ ...current, ...next }))} />

      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2.5">
          <Switch checked={task.enabled} labelledBy="task-enabled" onChange={(enabled) => patch({ enabled })} />
          <span id="task-enabled" className="text-13 text-text">
            Ligada
          </span>
        </div>
        <div className="flex items-center gap-2.5">
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

      {/* Contrato 162: o gatilho do WhatsApp não tem próxima execução pelo relógio. */}
      {!whatsappTrigger && (
        <section aria-label="Próximas 5 execuções" data-task-preview className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
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
      )}

      {failure && (
        <p role="alert" data-task-form-error className="text-13 text-rec">
          {failure}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button action="task-save" onClick={() => void save()} disabled={!valid || saving}>
          Salvar agendamento
        </Button>
        <Button action="task-cancel" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/**
 * Contrato 51: "Pode enviar email". Desligada por padrão; sem conta de email no app, não liga. Ligada, a conta, a lista
 * de destinatários permitidos e o teto por execução.
 */
function EmailSection({
  draft,
  accounts,
  grantedAt,
  timeZone,
  error,
  onChange,
}: {
  draft: EmailDraft
  accounts: EmailAccountStatus[] | null
  grantedAt: string | null
  timeZone: string
  error: string | null
  onChange: (patch: Partial<EmailDraft>) => void
}) {
  const none = accounts !== null && accounts.length === 0
  const turn = (on: boolean): void => onChange(on && !draft.accountId && accounts?.length === 1 ? { on, accountId: accounts[0]?.account.id ?? '' } : { on })
  const accountOptions = [{ value: '', label: 'Escolha a conta' }, ...(accounts ?? []).map((status) => ({ value: status.account.id, label: status.account.name ? `${status.account.name} (${status.account.address})` : status.account.address }))]
  const count = parseAllowList(draft.allowText).length
  const granted = grantedAt ? Date.parse(grantedAt) : Number.NaN
  const zone = Number.isNaN(granted) || !isValidTimeZone(timeZone) ? null : formatRunAt(granted, timeZone)
  return (
    <section aria-label="Pode enviar email" data-task-email={draft.on ? 'on' : 'off'} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <div className="flex items-start gap-2.5">
        <Switch checked={draft.on} labelledBy="task-email" action="task-email-toggle" disabled={none && !draft.on} onChange={turn} />
        <div className="flex min-w-0 flex-col gap-1">
          <span id="task-email" className="inline-flex items-center gap-1.5 text-13 font-medium text-text">
            <Icon icon={Send} size={14} className="text-text-muted" />
            Pode enviar email
          </span>
          <p className="text-12 text-text-muted">
            {none
              ? 'Conecte uma conta de email em Configurações › Contas para ligar.'
              : 'Ligar e salvar é a sua permissão: nas execuções deste agendamento, o agente envia email sem pedir o seu clique, só desta conta e só para a lista abaixo. Desligar ou excluir o agendamento corta na hora.'}
          </p>
          {draft.on && zone && (
            <p data-task-email-granted className="text-12 text-text-muted tabular">
              Permitido em {zone}
            </p>
          )}
        </div>
      </div>
      {draft.on && (
        <>
          <FormField label="Conta que envia" htmlFor="task-email-account">
            <Select id="task-email-account" value={draft.accountId} options={accountOptions} onChange={(accountId) => onChange({ accountId })} />
          </FormField>
          <FormField
            label="Destinatários permitidos"
            htmlFor="task-email-allow"
            hint={`Endereços exatos (ana@cliente.com) e/ou domínios (@cliente.com), um por linha; de ${TASK_EMAIL_ALLOW_MIN} a ${TASK_EMAIL_ALLOW_MAX}. O domínio não vale para subdomínios. ${count === 1 ? '1 destinatário' : `${count} destinatários`}.`}
          >
            <textarea id="task-email-allow" rows={4} value={draft.allowText} spellCheck={false} onChange={(event) => onChange({ allowText: event.target.value })} className={`${AREA_CLASS} font-mono`} />
          </FormField>
          <FormField label="Teto de envios por execução" htmlFor="task-email-max" hint={`De 1 a ${TASK_EMAIL_MAX_PER_RUN_MAX}. Acima disso, o envio é recusado.`}>
            <input
              id="task-email-max"
              type="number"
              min={1}
              max={TASK_EMAIL_MAX_PER_RUN_MAX}
              step={1}
              value={draft.maxPerRun}
              onChange={(event) => onChange({ maxPerRun: Number(event.target.value) })}
              className={`${INPUT_CLASS} w-24`}
            />
          </FormField>
          {error && (
            <p data-task-email-error className="text-12 text-rec">
              {error}
            </p>
          )}
        </>
      )}
    </section>
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
                  className={`no-drag h-8 w-10 text-13 ${index > 0 ? 'border-l border-line-strong' : ''} ${on ? 'bg-title font-medium text-bg' : 'bg-bg-raised text-text hover:bg-bg-sunken'}`}
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
    case 'whatsapp-message':
      return (
        <>
          <span className="text-13 text-text-muted">Esperar</span>
          <input
            type="number"
            aria-label="Segundos depois da última mensagem"
            data-task-espera
            min={TRIAGEM_ESPERA_SEG.min}
            max={TRIAGEM_ESPERA_SEG.max}
            value={draft.esperaSeg}
            onChange={(event) => onChange({ esperaSeg: Number(event.target.value) })}
            className={`${INPUT_CLASS} w-20`}
          />
          <span className="text-13 text-text-muted">segundos depois da última mensagem</span>
        </>
      )
    case 'cron':
      return <input type="text" aria-label="Expressão cron" data-task-cron spellCheck={false} value={draft.cron} onChange={(event) => onChange({ cron: event.target.value })} className={`${INPUT_CLASS} w-56 font-mono`} />
  }
}

