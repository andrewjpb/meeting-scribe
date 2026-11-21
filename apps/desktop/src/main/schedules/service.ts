// Automações no main (contrato 23, CA5, CA7 e CA10): o agendador, a fila das execuções e o histórico. Roda
// só com o app aberto (janela aberta ou só o ícone da barra de menus), sem depender do renderer: confere a cada
// 30 s e no `resume` do Mac. Regras:
// - só roda tarefa criada e ligada pela pessoa; "Pausar todas" e o limite diário param tudo o que é automático;
// - uma execução por tarefa por vez: se a anterior ainda roda (ou espera), a vez vira `skipped`;
// - no máximo 2 execuções ao mesmo tempo, no total; as outras esperam na fila;
// - horário perdido (app fechado, Mac dormindo): roda uma vez se o atraso do último for menor que 12 h, e os
//   outros viram um registro `skipped`; nunca enfileira dezenas;
// - 3 falhas seguidas pausam a tarefa sozinha (`autoPaused`) e avisam; ligar de novo tira a pausa;
// - "Rodar uma vez só" exclui ou desliga a tarefa depois de rodar;
// - o limite diário conta as execuções automáticas do dia; ao passar, pausa tudo e avisa.
// Cada execução é uma sessão ACP própria (`runner.ts`); o resultado vai para o histórico de qualquer jeito e para
// a saída escolhida (`outputs.ts`). Nada aqui envia coisa alguma para fora do Mac, salvo o email da tarefa com a
// permissão do contrato 51 (abaixo). Sem Electron: relógio, intervalos, notificação e eventos chegam injetados.
//
// Contrato 25: o lembrete do Assistente é uma tarefa "uma vez" sem agente (`reminder`): no horário, só a
// notificação do macOS com o texto (o "Abrir" leva à conversa do WhatsApp, quando há); nenhum Claude roda, nada
// entra no histórico de execuções nem conta no limite diário. Só nasce do clique em "Criar lembrete". O lembrete roda
// também com as tarefas pausadas (pela pessoa ou pelo limite); perdido (app fechado, Mac dormindo, religado depois da
// data), avisa atrasado assim que o app confere, com qualquer atraso, e desliga.
//
// Contrato 51: a tarefa com "Pode enviar email" (a permissão gravada nela ao salvar, com a data) roda com as ferramentas
// de leitura do email e `enviar_email`, montadas só para aquela execução (`email-send.ts`); cada envio confere a
// permissão de agora (revogada, pausada, app bloqueado), a conta, os destinatários e o teto. Os envios e as recusas ficam
// na execução, e a execução que enviou avisa no fim ("Tarefa X enviou 2 emails"). Sem a seção, nada muda.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AGENT_PROFILE_MODELS,
  AUTO_PAUSE_FAILURES,
  AUTOMATIC_TRIGGERS,
  dueOccurrences,
  MAX_CONCURRENT_RUNS,
  MISSED_RUN_MAX_MS,
  nextRunAfter,
  previewOf,
  promptHeader,
  RUN_STATUSES,
  SCHEDULER_TICK_MS,
  TASK_ERROR_MAX,
  TASK_MESSAGE_MAX,
  TASK_NAME_MAX,
  TASK_TIMEOUT_MIN_S,
  TASKS_MAX,
  wallTime,
  formatRunAt,
  taskOutput,
  type Agent,
  type AgentDeleteResult,
  type AgentOutput,
  type AgentSaveResult,
  type AgentsList,
  type AutomationEvent,
  type AutomationRun,
  type AutomationRunListItem,
  type AutomationsStatus,
  type NotifyPolicy,
  type TaskReminder,
  type RunStartResult,
  type RunStatus,
  type RunTrigger,
  type ScheduledTask,
  type TaskSaveResult,
} from '../../shared/automations'
import { agentInputSchema, automationIdSchema, taskInputSchema, taskReminderSchema } from '../../shared/automations-schema'
import { emailsLabel, TASK_EMAIL_MAX_PER_RUN_MAX, type RunEmail, type TaskEmailInput, type TaskEmailPermission } from '../../shared/task-email'
import type { AgentsStore } from '../agents/store'
import { TOOL_ROUNDS_MAX } from '../chat/tools'
import { createSendTool, type TaskEmailDeps } from './email-send'
import type { OutputRequest } from './outputs'
import type { AgentRunner, AgentRunTools } from './runner'
import type { RunsStore, SchedulesState, SchedulesStore } from './store'

/** Contrato 45: a mensagem de email do lembrete, para o "Abrir" da notificação (só quando há). */
const emailOf = (reminder: TaskReminder): Pick<AutomationNotice, 'email'> => (reminder.email ? { email: { accountId: reminder.email.accountId, messageId: reminder.email.messageId, mailbox: reminder.email.mailbox ?? null } } : {})

/** Atraso a partir do qual a execução conta como "horário perdido" (o Mac dormiu, o app estava fechado). */
const LATE_AFTER_MS = 2 * SCHEDULER_TICK_MS

export interface AutomationNotice {
  title: string
  body: string
  /** "Abrir" leva a esta execução; `null` abre a tela. */
  runId: string | null
  /** Contrato 25: o lembrete ligado a uma conversa do WhatsApp; "Abrir" leva a ela. */
  whatsappChatId?: string | null | undefined
  /** Contrato 45: o lembrete de responder um email; "Abrir" leva à mensagem. */
  email?: { accountId: string; messageId: string; mailbox: string | null } | null | undefined
  /** Contrato 25: é um lembrete (bloqueado, a notificação diz só "Você tem um lembrete."). */
  reminder?: boolean | undefined
}

export interface IntervalTimers {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface AutomationsDeps {
  agents: AgentsStore
  schedules: SchedulesStore
  runs: RunsStore
  runner: Pick<AgentRunner, 'run' | 'dispose'>
  /** Saída local da execução (conversa, post-it, arquivo); a notificação fica com `notify`. */
  applyOutput: (request: OutputRequest) => Promise<string>
  /** Notificação do macOS (com "Abrir"). Bloqueado, quem mostra esconde o conteúdo. */
  notify: (notice: AutomationNotice) => void
  /** "Limite diário de execuções agendadas" das Configurações. */
  dailyLimit: () => Promise<number>
  /** Fuso do Mac (o dia do limite diário, o cabeçalho de "Pedir agora"). */
  timeZone: () => string
  /** Estado novo (tarefas, fila, pausa): a tela e o ícone da barra de menus acompanham. */
  onChange: (status: AutomationsStatus) => void
  /** A resposta de uma execução crescendo ou terminada. */
  onEvent: (event: AutomationEvent) => void
  now?: () => number
  newId?: () => string
  timers?: IntervalTimers
  log?: (message: string) => void
  /**
   * Contrato 51: o envio das tarefas com "Pode enviar email" (o caminho interno do main e as ferramentas de leitura).
   * Sem ele, nenhuma execução ganha ferramenta e a seção não pode ser salva.
   */
  email?: TaskEmailDeps | undefined
  /**
   * Contrato 115 (D15): a cada conferência, depois dos lembretes e antes da pausa (o alerta diário do funil). Uma
   * falha só vai para o `log`.
   */
  onTick?: (at: number) => Promise<void>
}

export interface AutomationsService {
  /** Abertura do app: confere já (horários perdidos) e a cada 30 s. */
  start(): void
  /** Uma conferência (o smoke e o teste chamam direto). */
  tick(): Promise<void>
  /** Mac acordou (`powerMonitor` `resume`): confere de novo. */
  resume(): Promise<void>
  /** Reunião encerrada: as tarefas "depois de cada reunião" entram com o atraso de cada uma. */
  meetingEnded(meetingId: string): void
  listAgents(): Promise<AgentsList>
  saveAgent(input: unknown): Promise<AgentSaveResult>
  deleteAgent(input: unknown): Promise<AgentDeleteResult>
  /** "Testar agora": roda o agente do formulário (salvo ou não) com a mensagem; não entra no histórico. */
  testAgent(input: unknown): Promise<RunStartResult>
  listTasks(): Promise<ScheduledTask[]>
  saveTask(input: unknown): Promise<TaskSaveResult>
  deleteTask(input: unknown): Promise<boolean>
  toggleTask(input: unknown): Promise<ScheduledTask | null>
  /** Contrato 25: "Criar lembrete" no cartão do Assistente; só com o clique da pessoa. */
  createReminder(input: unknown): Promise<TaskSaveResult>
  /**
   * Contrato 78: "Salvar" no cartão de alterar um lembrete do Assistente; só com o clique da pessoa. Só tarefa com
   * `reminder` que ainda não disparou (`missing`); a hora nova no futuro (`past`). O lembrete desligado volta ligado.
   */
  updateReminder(id: string, change: { at?: string; text?: string }): Promise<ReminderUpdateResult>
  /** "Rodar agora": com a pessoa olhando, fora da pausa e do limite. */
  runNow(input: unknown): Promise<RunStartResult>
  /** "Pedir agora": um agente e um pedido, na hora; entra em "Execuções". */
  ask(input: unknown): Promise<RunStartResult>
  listRuns(input: unknown): Promise<AutomationRunListItem[]>
  getRun(input: unknown): Promise<AutomationRun | null>
  rerun(input: unknown): Promise<RunStartResult>
  status(): Promise<AutomationsStatus>
  /** "Pausar todas as tarefas" / "Retomar". */
  setPaused(input: unknown): Promise<AutomationsStatus>
  /** O último estado, sem esperar o disco (o menu do ícone). */
  snapshot(): AutomationsStatus
  /** Teste e smoke: espera a fila e as execuções em curso terminarem. */
  settled(): Promise<void>
  dispose(): void
}

export type ReminderUpdateResult = { ok: true; task: ScheduledTask } | { ok: false; reason: 'missing' | 'past' | 'invalid' }

interface Job {
  runId: string
  trigger: RunTrigger
  task: ScheduledTask | null
  agent: Agent
  /** O que a pessoa pediu (sem o cabeçalho). */
  message: string
  meetingId: string | null
  timeoutS: number
  /** "Testar agora" não entra no histórico nem aplica a saída. */
  persist: boolean
  output: AgentOutput | null
  notify: NotifyPolicy
  timeZone: string
}

interface PendingMeeting {
  taskId: string
  meetingId: string
  at: number
}

const toggleSchema = z.object({ id: automationIdSchema, enabled: z.boolean() }).strict()
const idRequest = z.object({ id: automationIdSchema }).strict()
const pausedSchema = z.object({ paused: z.boolean() }).strict()
const messageSchema = z
  .string()
  .max(TASK_MESSAGE_MAX)
  .refine((value) => value.trim() !== '')
const askSchema = z.object({ agentId: automationIdSchema, text: messageSchema }).strict()
/** Horário com o fuso explícito (`…-03:00` ou `…Z`). */
const zonedIso = z
  .string()
  .max(40)
  .regex(/(Z|[+-]\d{2}:\d{2})$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const reminderInputSchema = z.object({ at: zonedIso, reminder: taskReminderSchema }).strict()
const reminderChangeSchema = z.object({ id: automationIdSchema, at: zonedIso.optional(), text: taskReminderSchema.shape.text.optional() }).strict()
const testSchema = z.object({ agent: agentInputSchema, text: messageSchema }).strict()
const runsFilterSchema = z
  .object({ taskId: automationIdSchema.optional(), status: z.enum(RUN_STATUSES).optional() })
  .strict()
  .optional()

const defaultTimers: IntervalTimers = {
  setInterval: (handler, ms) => {
    const handle = setInterval(handler, ms)
    handle.unref?.()
    return handle
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

const clipError = (text: string): string => (text.length > TASK_ERROR_MAX ? `${text.slice(0, TASK_ERROR_MAX - 1)}…` : text)
const failed = (status: RunStatus): boolean => status === 'error' || status === 'timeout'

/** "Lembrete: <texto>", cortado no limite do nome da tarefa. */
function reminderName(line: string): string {
  const label = `Lembrete: ${line}`
  return label.length <= TASK_NAME_MAX ? label : `${label.slice(0, TASK_NAME_MAX - 1).trimEnd()}…`
}

export function createAutomationsService(deps: AutomationsDeps): AutomationsService {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const timers = deps.timers ?? defaultTimers
  const queue: Job[] = []
  const running = new Map<string, Job>()
  /** Tarefas na fila ou rodando: a próxima vez delas vira `skipped`. */
  const busyTasks = new Set<string>()
  const pendingMeetings: PendingMeeting[] = []
  const inFlight = new Set<Promise<void>>()
  let interval: unknown = null
  let ticking: Promise<void> | null = null
  let disposed = false
  let last: AutomationsStatus = { paused: false, pauseReason: null, runsToday: 0, dailyLimit: 50, running: [], next: [] }

  const iso = (ms: number): string => new Date(ms).toISOString()

  /** Próximo horário de uma tarefa a partir de agora (`every` conta de agora). */
  const nextFor = (task: Pick<ScheduledTask, 'schedule' | 'timezone'>, from: number): string | null => {
    const at = nextRunAfter(task.schedule, task.timezone, from)
    return at === null ? null : iso(at)
  }

  /** "AAAA-MM-DD" de um instante no fuso do Mac (o dia do limite diário). */
  const dayOf = (ms: number): string => {
    const wall = wallTime(ms, deps.timeZone())
    return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
  }

  /**
   * Execuções automáticas de hoje: as do histórico (as puladas não contam), as que estão rodando e as que esperam na
   * fila. As que rodam já podem estar gravadas: cada uma conta uma vez só.
   */
  async function runsToday(): Promise<number> {
    const today = dayOf(now())
    const automatic = (job: Job): boolean => AUTOMATIC_TRIGGERS.includes(job.trigger)
    const live = new Set([...running.values()].filter(automatic).map((job) => job.runId))
    const stored = (await deps.runs.list()).filter((run) => !live.has(run.id) && AUTOMATIC_TRIGGERS.includes(run.trigger) && run.status !== 'skipped' && dayOf(Date.parse(run.startedAt)) === today).length
    return stored + live.size + queue.filter(automatic).length
  }

  function statusOf(state: SchedulesState, today: number, limit: number): AutomationsStatus {
    const next = state.paused
      ? []
      : state.tasks
          .filter((task) => task.enabled && !task.autoPaused && task.nextRunAt !== null)
          .sort((a, b) => Date.parse(a.nextRunAt ?? '') - Date.parse(b.nextRunAt ?? ''))
          .slice(0, 5)
          .map((task) => ({ taskId: task.id, name: task.name, at: task.nextRunAt ?? '' }))
    return { paused: state.paused, pauseReason: state.pauseReason, runsToday: today, dailyLimit: limit, running: [...running.keys()], next }
  }

  async function computeStatus(): Promise<AutomationsStatus> {
    const [state, today, limit] = await Promise.all([deps.schedules.read(), runsToday(), deps.dailyLimit()])
    last = statusOf(state, today, limit)
    return last
  }

  function changed(): void {
    void computeStatus().then(
      (status) => {
        if (!disposed) deps.onChange(status)
      },
      () => undefined,
    )
  }

  function track(work: Promise<void>): void {
    inFlight.add(work)
    void work.finally(() => inFlight.delete(work))
  }

  async function updateTask(id: string, fn: (task: ScheduledTask) => ScheduledTask | null): Promise<void> {
    await deps.schedules.mutate((state) => {
      const tasks: ScheduledTask[] = []
      for (const task of state.tasks) {
        if (task.id !== id) tasks.push(task)
        else {
          const next = fn(task)
          if (next) tasks.push(next)
        }
      }
      return { ...state, tasks }
    })
  }

  /** Registro de uma vez pulada (a anterior rodando, horários perdidos, pausa pelo limite). */
  async function recordSkipped(task: ScheduledTask, agent: Agent | null, trigger: RunTrigger, reason: string): Promise<void> {
    const at = now()
    const run: AutomationRun = {
      id: newId(),
      taskId: task.id,
      taskName: task.name,
      agentId: task.agentId,
      agentName: agent?.name ?? (task.reminder ? 'Lembrete' : ''),
      trigger,
      status: 'skipped',
      startedAt: iso(at),
      endedAt: iso(at),
      durationMs: 0,
      model: agent?.model ?? 'sonnet',
      costUsd: 0,
      prompt: task.message,
      answer: null,
      error: clipError(reason),
      meetingId: null,
      outputResult: null,
    }
    await deps.runs.save(run)
    await updateTask(task.id, (current) => (busyTasks.has(current.id) ? current : { ...current, lastStatus: 'skipped', lastError: run.error, updatedAt: iso(at) }))
  }

  function enqueue(job: Job): RunStartResult {
    if (job.task && busyTasks.has(job.task.id)) {
      const task = job.task
      track(recordSkipped(task, job.agent, job.trigger, 'A execução anterior desta tarefa ainda estava rodando.').then(changed, () => undefined))
      return { ok: false, error: 'busy' }
    }
    if (job.task) busyTasks.add(job.task.id)
    queue.push(job)
    pump()
    return { ok: true, runId: job.runId }
  }

  function pump(): void {
    while (!disposed && running.size < MAX_CONCURRENT_RUNS && queue.length) {
      const job = queue.shift()
      if (!job) break
      running.set(job.runId, job)
      track(execute(job))
    }
    changed()
  }

  async function execute(job: Job): Promise<void> {
    const started = now()
    const prompt = `${promptHeader(started, job.timeZone)}\n\n${job.message.trim()}`
    const base: AutomationRun = {
      id: job.runId,
      taskId: job.task?.id ?? null,
      taskName: job.task?.name ?? null,
      agentId: job.trigger === 'test' && !job.agent.createdAt ? null : job.agent.id,
      agentName: job.agent.name,
      trigger: job.trigger,
      status: 'running',
      startedAt: iso(started),
      endedAt: null,
      durationMs: 0,
      model: job.agent.model,
      costUsd: 0,
      prompt,
      answer: null,
      error: null,
      meetingId: job.meetingId,
      outputResult: null,
    }
    let run: AutomationRun
    // Contrato 51: os envios e as recusas desta execução (só a tarefa com "Pode enviar email").
    const emails: RunEmail[] = []
    const sends = { count: () => 0 }
    try {
      if (job.persist) await deps.runs.save(base)
      if (job.task) await updateTask(job.task.id, (task) => ({ ...task, lastStatus: 'running', updatedAt: iso(started) }))
      changed()
      const tools = job.task && job.persist ? await emailToolsFor(job.task.id, emails, sends) : undefined
      const result = await deps.runner.run({ runId: job.runId, agent: job.agent, prompt, meetingId: job.meetingId, timeoutS: job.timeoutS, ...(tools ? { tools } : {}) }, (event) => {
        if (!disposed) deps.onEvent({ ...event, runId: job.runId })
      })
      const ended = now()
      run = { ...base, status: result.status, endedAt: iso(ended), durationMs: Math.max(0, ended - started), costUsd: result.costUsd, answer: result.answer, error: result.error ? clipError(result.error) : null, ...(emails.length ? { emails: [...emails] } : {}), ...(result.organizeRefused?.length ? { organizeRefused: result.organizeRefused } : {}) }
      // A saída só com resposta; o histórico guarda de qualquer jeito.
      if (job.persist && job.output && result.status === 'ok' && result.answer.text.trim()) {
        const title = job.task ? `Tarefa: ${job.task.name}` : `Pedir agora: ${job.agent.name}`
        try {
          run.outputResult = await deps.applyOutput({ output: job.output, title, folderName: job.task?.name ?? job.agent.name, agent: job.agent, prompt, answer: result.answer, meetingId: job.meetingId })
        } catch (error) {
          run.outputResult = `A saída falhou: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500)
        }
      }
    } catch (error) {
      const ended = now()
      run = { ...base, status: 'error', endedAt: iso(ended), durationMs: Math.max(0, ended - started), error: clipError(error instanceof Error ? error.message : 'A execução falhou.'), ...(emails.length ? { emails: [...emails] } : {}) }
    }
    try {
      if (job.persist) await deps.runs.save(run)
      // Pausada agora pelas falhas: o aviso da pausa já diz que falhou (um aviso só).
      const pausedNow = job.task ? await finishTask(job, run) : false
      if (job.persist && !pausedNow) notifyRun(job, run)
      // Contrato 51: a execução que enviou avisa, com qualquer política de avisos.
      const sent = sends.count()
      if (job.task && sent > 0) deps.notify({ title: `Tarefa: ${job.task.name}`, body: `Tarefa ${job.task.name} enviou ${emailsLabel(sent)}`, runId: run.id })
    } catch (error) {
      deps.log?.(`[automações] não foi possível gravar a execução: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running.delete(job.runId)
      if (job.task) busyTasks.delete(job.task.id)
      if (!disposed) deps.onEvent({ type: 'done', runId: job.runId, run })
      pump()
    }
  }

  async function finishTask(job: Job, run: AutomationRun): Promise<boolean> {
    const task = job.task
    if (!task) return false
    let pausedNow = false
    await updateTask(task.id, (current) => {
      const failures = failed(run.status) ? current.consecutiveFailures + 1 : 0
      const autoPaused = current.autoPaused || failures >= AUTO_PAUSE_FAILURES
      pausedNow = autoPaused && !current.autoPaused
      // "Rodar uma vez só": excluída ou desligada depois de rodar.
      if (current.runOnce && current.runOnceAction === 'delete') return null
      const enabled = current.runOnce ? false : current.enabled
      return {
        ...current,
        enabled,
        lastRunAt: run.startedAt,
        lastStatus: run.status,
        lastResultPreview: run.answer?.text ? previewOf(run.answer.text) : null,
        lastError: run.error,
        consecutiveFailures: failures,
        autoPaused,
        nextRunAt: enabled && !autoPaused ? current.nextRunAt : null,
        updatedAt: iso(now()),
      }
    })
    if (pausedNow) deps.notify({ title: `Tarefa pausada: ${task.name}`, body: `Falhou ${AUTO_PAUSE_FAILURES} vezes seguidas. Ligue de novo em Automações quando quiser.`, runId: run.id })
    return pausedNow
  }

  function notifyRun(job: Job, run: AutomationRun): void {
    const ok = run.status === 'ok'
    const asOutput = ok && job.output?.kind === 'notification'
    const byPolicy = job.notify === 'always' || (job.notify === 'on-error' && failed(run.status))
    if (!asOutput && !byPolicy) return
    const title = job.task ? `Tarefa: ${job.task.name}` : job.agent.name
    const body = ok ? previewOf(run.answer?.text ?? '', 120) : `Não terminou: ${run.error ?? 'erro'}`
    deps.notify({ title, body, runId: run.id })
  }

  /**
   * Contrato 51: as ferramentas de uma execução da tarefa com "Pode enviar email": as de leitura do email e o envio, que
   * relê a tarefa e a pausa a cada pedido. `undefined`: a tarefa não tem a seção (ou o app não tem email): nenhuma.
   */
  async function emailToolsFor(taskId: string, emails: RunEmail[], sends: { count: () => number }): Promise<AgentRunTools | undefined> {
    const email = deps.email
    if (!email) return undefined
    // A permissão de agora (a desligada entre a fila e a vez não dá ferramenta).
    const gate = async (): Promise<{ paused: boolean; permission: TaskEmailPermission | null }> => {
      const state = await deps.schedules.read()
      return { paused: state.paused, permission: state.tasks.find((current) => current.id === taskId)?.email ?? null }
    }
    const permission = (await gate()).permission
    if (!permission) return undefined
    const send = createSendTool({
      deps: email,
      start: permission,
      gate,
      record: (entry) => emails.push(entry),
      now,
      ...(deps.log ? { log: deps.log } : {}),
    })
    sends.count = send.sent
    return {
      list: [...email.readTools(), send.tool],
      // Uma rodada por envio permitido, mais as da leitura.
      rounds: TOOL_ROUNDS_MAX + permission.maxPerRun,
      email: { account: email.accountAddress(permission.accountId) ?? 'a conta da permissão', allow: permission.allow, maxPerRun: permission.maxPerRun },
    }
  }

  /** A permissão do formulário com a data: a de antes se nada mudou, a de agora se a seção foi ligada ou mudou. */
  function permissionOf(input: TaskEmailInput | null | undefined, current: TaskEmailPermission | null, at: number): TaskEmailPermission | null {
    if (!input) return null
    const same = current !== null && current.accountId === input.accountId && current.maxPerRun === input.maxPerRun && current.allow.join('\n') === input.allow.join('\n')
    return { accountId: input.accountId, allow: [...input.allow], maxPerRun: Math.min(input.maxPerRun, TASK_EMAIL_MAX_PER_RUN_MAX), grantedAt: same ? current.grantedAt : iso(at) }
  }

  function jobFor(task: ScheduledTask, agent: Agent, trigger: RunTrigger, meetingId: string | null = null): Job {
    return {
      runId: newId(),
      trigger,
      task,
      agent,
      message: task.message,
      meetingId,
      timeoutS: task.timeoutS,
      persist: true,
      output: taskOutput(task, agent),
      notify: task.notify,
      timeZone: task.timezone,
    }
  }

  /**
   * Lembrete no horário (ou "Rodar agora"): a notificação com o texto e a tarefa marcada como feita. Sem Claude, sem
   * execução no histórico e fora do limite diário.
   */
  async function fireReminder(task: ScheduledTask, late = false): Promise<void> {
    const reminder = task.reminder
    if (!reminder) return
    const at = now()
    const scheduled = task.schedule.kind === 'once' ? Date.parse(task.schedule.at) : Number.NaN
    const was = Number.isNaN(scheduled) ? '' : formatRunAt(scheduled, task.timezone)
    // Contrato 45 (CA7): o email só do servidor não está no app; a notificação diz onde ele está.
    const text = `${previewOf(reminder.text, 200)}${reminder.email?.mailbox ? ` · o email está no servidor, na pasta ${previewOf(reminder.email.mailbox, 80)}` : ''}`
    deps.notify(
      late
        ? { title: 'Lembrete atrasado', body: `Era ${was} · ${text}`, runId: null, whatsappChatId: reminder.whatsappChatId, ...emailOf(reminder), reminder: true }
        : { title: 'Lembrete', body: text, runId: null, whatsappChatId: reminder.whatsappChatId, ...emailOf(reminder), reminder: true },
    )
    await updateTask(task.id, (current) =>
      current.runOnce && current.runOnceAction === 'delete'
        ? null
        : {
            ...current,
            enabled: false,
            nextRunAt: null,
            lastRunAt: iso(at),
            lastStatus: 'ok',
            lastResultPreview: previewOf(late ? `Avisado atrasado (era ${was}): ${reminder.text}` : reminder.text),
            lastError: null,
            consecutiveFailures: 0,
            updatedAt: iso(at),
          },
    )
    changed()
  }

  /** Lembretes vencidos: na hora (até 1 min de atraso) ou atrasados, com qualquer atraso. Rodam com tudo pausado. */
  async function dueReminders(tasks: readonly ScheduledTask[], at: number): Promise<void> {
    for (const task of tasks) {
      if (!task.reminder || !task.enabled || task.autoPaused) continue
      const due = task.nextRunAt ? Date.parse(task.nextRunAt) : task.schedule.kind === 'once' ? Date.parse(task.schedule.at) : Number.NaN
      if (Number.isNaN(due) || due > at) continue
      await fireReminder(task, at - due > LATE_AFTER_MS)
    }
  }

  /** Execução sem clique: confere a pausa e o limite diário antes. */
  async function enqueueAutomatic(task: ScheduledTask, trigger: RunTrigger, meetingId: string | null = null): Promise<void> {
    const agent = await deps.agents.get(task.agentId)
    if (!agent) {
      await recordSkipped(task, null, trigger, 'O agente desta tarefa não existe mais.')
      return
    }
    const state = await deps.schedules.read()
    if (state.paused) return
    const limit = await deps.dailyLimit()
    // "Retomar" depois da pausa pelo limite libera o resto do dia.
    if (state.limitReleasedOn !== dayOf(now()) && (await runsToday()) >= limit) {
      await deps.schedules.mutate((current) => ({ ...current, paused: true, pauseReason: 'limit' }))
      await recordSkipped(task, agent, trigger, `O limite diário de ${limit} execuções agendadas foi atingido.`)
      deps.notify({ title: 'Tarefas pausadas', body: `O limite diário de ${limit} execuções agendadas foi atingido. Retome em Automações.`, runId: null })
      return
    }
    enqueue(jobFor(task, agent, trigger, meetingId))
  }

  async function doTick(): Promise<void> {
    const at = now()
    const state = await deps.schedules.read()
    // Contrato 25: os lembretes não dependem da pausa nem do limite diário.
    await dueReminders(state.tasks, at)
    // Contrato 115: a falha de quem pegou carona no tick não muda nada do resto da conferência.
    try {
      await deps.onTick?.(at)
    } catch (error) {
      deps.log?.(`[automações] conferência do funil falhou: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (state.paused) {
      // Pausado: a vez das tarefas "depois de cada reunião" se perde (sem registro: nada rodaria).
      pendingMeetings.length = 0
      return
    }
    const due: { task: ScheduledTask; trigger: RunTrigger; run: boolean; extra: number }[] = []
    const nextRuns = new Map<string, string | null>()
    for (const task of state.tasks) {
      if (!task.enabled || task.autoPaused || task.schedule.kind === 'after-meeting' || task.reminder) continue
      if (task.nextRunAt === null) {
        const next = nextFor(task, at)
        if (next !== null) nextRuns.set(task.id, next)
        continue
      }
      const first = Date.parse(task.nextRunAt)
      if (first > at) continue
      const occurrences = dueOccurrences(task.schedule, task.timezone, first, at)
      const latest = occurrences.at(-1) ?? first
      const late = at - latest
      const runIt = late < MISSED_RUN_MAX_MS
      due.push({ task, trigger: at - first > LATE_AFTER_MS ? 'missed' : 'schedule', run: runIt, extra: runIt ? occurrences.length - 1 : occurrences.length })
      // `every` conta a partir do último horário; o resto, de agora.
      const next = nextRunAfter(task.schedule, task.timezone, task.schedule.kind === 'every' ? latest : at)
      nextRuns.set(task.id, next === null ? null : iso(next))
    }
    if (nextRuns.size) {
      await deps.schedules.mutate((current) => ({ ...current, tasks: current.tasks.map((task) => (nextRuns.has(task.id) ? { ...task, nextRunAt: nextRuns.get(task.id) ?? null } : task)) }))
    }
    for (const item of due) {
      if (item.extra > 0) {
        const agent = await deps.agents.get(item.task.agentId)
        const text = item.extra === 1 ? '1 horário perdido' : `${item.extra} horários perdidos`
        await recordSkipped(item.task, agent, 'missed', `${text} com o app fechado ou o Mac dormindo.`)
      }
      if (item.run) await enqueueAutomatic(item.task, item.trigger)
    }
    // Depois de cada reunião: as que já passaram do atraso.
    const ready = pendingMeetings.filter((entry) => entry.at <= at)
    if (ready.length) {
      for (const entry of ready) pendingMeetings.splice(pendingMeetings.indexOf(entry), 1)
      const tasks = (await deps.schedules.read()).tasks
      for (const entry of ready) {
        const task = tasks.find((candidate) => candidate.id === entry.taskId)
        if (task?.enabled && !task.autoPaused && task.schedule.kind === 'after-meeting') await enqueueAutomatic(task, 'meeting', entry.meetingId)
      }
    }
    changed()
  }

  function tick(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (ticking) return ticking
    ticking = doTick()
      .catch((error: unknown) => deps.log?.(`[automações] conferência falhou: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        ticking = null
      })
    return ticking
  }

  const parseId = (input: unknown): string | null => {
    const parsed = idRequest.safeParse(input)
    return parsed.success ? parsed.data.id : null
  }

  async function startTask(id: string, trigger: RunTrigger): Promise<RunStartResult> {
    const task = (await deps.schedules.read()).tasks.find((candidate) => candidate.id === id)
    if (!task) return { ok: false, error: 'missing' }
    // Contrato 25: "Rodar agora" num lembrete mostra a notificação agora.
    if (task.reminder) {
      await fireReminder(task)
      return { ok: true, runId: task.id }
    }
    const agent = await deps.agents.get(task.agentId)
    if (!agent) return { ok: false, error: 'missing' }
    return enqueue(jobFor(task, agent, trigger))
  }

  return {
    start() {
      if (interval !== null || disposed) return
      void tick()
      interval = timers.setInterval(() => void tick(), SCHEDULER_TICK_MS)
    },

    tick,

    resume: () => tick(),

    meetingEnded(meetingId) {
      if (disposed || !automationIdSchema.safeParse(meetingId).success) return
      // Cada par (tarefa, reunião) roda uma vez só, guardado em `schedules.json`: um "Tentar de novo" do fim da
      // gravação ou um novo aviso da mesma reunião não roda de novo.
      let immediate = false
      const added: PendingMeeting[] = []
      void deps.schedules
        .mutate((state) => {
          if (state.paused) return state
          const keys: string[] = []
          for (const task of state.tasks) {
            if (!task.enabled || task.autoPaused || task.schedule.kind !== 'after-meeting') continue
            const key = `${task.id}:${meetingId}`
            if (state.meetingRuns.includes(key)) continue
            keys.push(key)
            added.push({ taskId: task.id, meetingId, at: now() + task.schedule.delayMin * 60_000 })
            if (task.schedule.delayMin === 0) immediate = true
          }
          return keys.length ? { ...state, meetingRuns: [...state.meetingRuns, ...keys] } : state
        })
        .then(() => {
          pendingMeetings.push(...added)
          if (immediate) void tick()
        }, () => undefined)
    },

    async listAgents() {
      const [agents, state] = await Promise.all([deps.agents.list(), deps.schedules.read()])
      const usage: Record<string, string[]> = {}
      for (const task of state.tasks) if (!task.reminder) (usage[task.agentId] ??= []).push(task.name)
      return { agents, usage, models: [...AGENT_PROFILE_MODELS.claude], mcp: false }
    },

    async saveAgent(input) {
      const result = await deps.agents.save(input)
      if (result.ok) changed()
      return result
    },

    async deleteAgent(input) {
      const id = parseId(input)
      if (!id) return { ok: false, error: 'missing' }
      const users = (await deps.schedules.read()).tasks.filter((task) => task.agentId === id).map((task) => task.name)
      if (users.length) return { ok: false, error: 'in-use', tasks: users }
      if (!(await deps.agents.remove(id))) return { ok: false, error: 'missing' }
      changed()
      return { ok: true }
    },

    async testAgent(input) {
      const parsed = testSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { agent: fields, text } = parsed.data
      if (!AGENT_PROFILE_MODELS[fields.profile].includes(fields.model)) return { ok: false, error: 'invalid' }
      const at = iso(now())
      // Agente do formulário, salvo ou não: o id só identifica a execução; nada é gravado.
      const agent: Agent = { ...fields, id: fields.id ?? 'teste', createdAt: fields.id ? at : '', updatedAt: at }
      return enqueue({ runId: newId(), trigger: 'test', task: null, agent, message: text, meetingId: null, timeoutS: 300, persist: false, output: null, notify: 'never', timeZone: deps.timeZone() })
    },

    listTasks: async () => (await deps.schedules.read()).tasks,

    async saveTask(input) {
      const parsed = taskInputSchema.safeParse(input)
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => issue.path.join('.'))
        if (issues.includes('timezone')) return { ok: false, error: 'timezone' }
        const kind = (input as { schedule?: { kind?: unknown } } | null)?.schedule?.kind
        if (kind === 'cron' && issues.some((path) => path.startsWith('schedule'))) return { ok: false, error: 'cron' }
        return { ok: false, error: 'invalid' }
      }
      const { id, email: emailInput, ...fields } = parsed.data
      if (!(await deps.agents.get(fields.agentId))) return { ok: false, error: 'agent' }
      // Contrato 51: a conta de "Pode enviar email" tem que existir neste app.
      if (emailInput && (!deps.email || deps.email.accountAddress(emailInput.accountId) === null)) return { ok: false, error: 'email' }
      const at = now()
      // "Uma vez em" com a data no passado nunca rodaria.
      if (fields.enabled && fields.schedule.kind === 'once' && Date.parse(fields.schedule.at) <= at) return { ok: false, error: 'past' }
      let saved: ScheduledTask | null = null
      let missing = false
      let full = false
      await deps.schedules.mutate((state) => {
        if (id === null) {
          if (state.tasks.length >= TASKS_MAX) {
            full = true
            return state
          }
          const task: ScheduledTask = {
            ...fields,
            id: newId(),
            reminder: null,
            email: permissionOf(emailInput, null, at),
            lastRunAt: null,
            nextRunAt: fields.enabled ? nextFor(fields, at) : null,
            lastStatus: null,
            lastResultPreview: null,
            lastError: null,
            consecutiveFailures: 0,
            autoPaused: false,
            createdAt: iso(at),
            updatedAt: iso(at),
          }
          saved = task
          return { ...state, tasks: [...state.tasks, task] }
        }
        const current = state.tasks.find((task) => task.id === id)
        // O lembrete do Assistente (contrato 25) não tem agente nem formulário: não vira tarefa de agente.
        if (!current || current.reminder) {
          missing = true
          return state
        }
        // Editar recalcula o próximo horário; ligada de novo sai da pausa automática.
        const reenabled = fields.enabled && !current.enabled
        const task: ScheduledTask = {
          ...current,
          ...fields,
          email: permissionOf(emailInput, current.email, at),
          autoPaused: reenabled ? false : current.autoPaused,
          consecutiveFailures: reenabled ? 0 : current.consecutiveFailures,
          nextRunAt: fields.enabled ? nextFor(fields, at) : null,
          updatedAt: iso(at),
        }
        saved = task
        return { ...state, tasks: state.tasks.map((known) => (known.id === id ? task : known)) }
      })
      if (full) return { ok: false, error: 'full' }
      if (missing || !saved) return { ok: false, error: 'missing' }
      changed()
      return { ok: true, task: saved }
    },

    async deleteTask(input) {
      const id = parseId(input)
      if (!id) return false
      let found = false
      await deps.schedules.mutate((state) => {
        found = state.tasks.some((task) => task.id === id)
        return { ...state, tasks: state.tasks.filter((task) => task.id !== id) }
      })
      for (let at = pendingMeetings.length - 1; at >= 0; at--) if (pendingMeetings[at]?.taskId === id) pendingMeetings.splice(at, 1)
      if (found) changed()
      return found
    },

    async toggleTask(input) {
      const parsed = toggleSchema.safeParse(input)
      if (!parsed.success) return null
      const { id, enabled } = parsed.data
      let saved: ScheduledTask | null = null
      const at = now()
      const current = (await deps.schedules.read()).tasks.find((task) => task.id === id)
      // Contrato 25: o lembrete religado depois da data avisa atrasado agora (fora do histórico) e desliga.
      if (enabled && current?.reminder && current.schedule.kind === 'once' && Date.parse(current.schedule.at) <= at) {
        await fireReminder(current, true)
        return (await deps.schedules.read()).tasks.find((task) => task.id === id) ?? null
      }
      // "Uma vez em" cuja data passou com a tarefa desligada: a vez fica registrada como pulada e o "uma vez só" vale
      // (excluída ou desligada); sem ele, a tarefa continua desligada, porque nunca mais rodaria.
      if (enabled && current?.schedule.kind === 'once' && Date.parse(current.schedule.at) <= at) {
        await recordSkipped(current, await deps.agents.get(current.agentId), 'schedule', 'A data desta tarefa passou com ela desligada.')
        await updateTask(id, (task) => {
          saved = task.runOnce && task.runOnceAction === 'delete' ? null : { ...task, enabled: false, nextRunAt: null, lastStatus: 'skipped', updatedAt: iso(at) }
          return saved
        })
        changed()
        return saved
      }
      await updateTask(id, (task) => {
        saved = enabled
          ? { ...task, enabled, autoPaused: false, consecutiveFailures: 0, nextRunAt: nextFor(task, at), updatedAt: iso(at) }
          : { ...task, enabled, nextRunAt: null, updatedAt: iso(at) }
        return saved
      })
      if (saved) changed()
      return saved
    },

    async createReminder(input) {
      const parsed = reminderInputSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const at = now()
      const { reminder } = parsed.data
      const when = Date.parse(parsed.data.at)
      if (when <= at) return { ok: false, error: 'past' }
      const line = reminder.text.replace(/\s+/g, ' ').trim()
      const name = reminderName(line)
      let saved: ScheduledTask | null = null
      let full = false
      await deps.schedules.mutate((state) => {
        if (state.tasks.length >= TASKS_MAX) {
          full = true
          return state
        }
        const task: ScheduledTask = {
          id: newId(),
          name,
          agentId: '',
          message: line,
          schedule: { kind: 'once', at: new Date(when).toISOString() },
          timezone: deps.timeZone(),
          enabled: true,
          runOnce: true,
          runOnceAction: 'disable',
          timeoutS: TASK_TIMEOUT_MIN_S,
          notify: 'always',
          output: null,
          reminder: { ...reminder, text: reminder.text.trim() },
          email: null,
          lastRunAt: null,
          nextRunAt: new Date(when).toISOString(),
          lastStatus: null,
          lastResultPreview: null,
          lastError: null,
          consecutiveFailures: 0,
          autoPaused: false,
          createdAt: iso(at),
          updatedAt: iso(at),
        }
        saved = task
        return { ...state, tasks: [...state.tasks, task] }
      })
      if (full) return { ok: false, error: 'full' }
      if (!saved) return { ok: false, error: 'invalid' }
      changed()
      return { ok: true, task: saved }
    },

    async updateReminder(id, change) {
      const parsed = reminderChangeSchema.safeParse({ id, ...change })
      if (!parsed.success) return { ok: false, reason: 'invalid' }
      const text = parsed.data.text?.replace(/\s+/g, ' ').trim()
      if (text === '') return { ok: false, reason: 'invalid' }
      const at = now()
      const when = parsed.data.at === undefined ? null : Date.parse(parsed.data.at)
      if (when !== null && when <= at) return { ok: false, reason: 'past' }
      let saved: ScheduledTask | null = null
      let reason = null as 'missing' | 'past' | null
      await deps.schedules.mutate((state) => {
        const current = state.tasks.find((task) => task.id === parsed.data.id)
        // Só o lembrete que ainda não disparou: o que já avisou (ou foi apagado) não existe mais para o cartão.
        if (!current?.reminder || current.schedule.kind !== 'once' || current.lastRunAt !== null) {
          reason = 'missing'
          return state
        }
        const next = when ?? Date.parse(current.schedule.at)
        if (next <= at) {
          reason = 'past'
          return state
        }
        const nextIso = new Date(next).toISOString()
        // `runOnce`, `runOnceAction` e o resto do lembrete (a conversa, o email) ficam como estavam. O desligado religa:
        // alterar é a intenção de usar.
        const task: ScheduledTask = {
          ...current,
          ...(text !== undefined ? { name: reminderName(text), message: text, reminder: { ...current.reminder, text } } : {}),
          schedule: { kind: 'once', at: nextIso },
          enabled: true,
          autoPaused: false,
          nextRunAt: nextIso,
          updatedAt: iso(at),
        }
        saved = task
        return { ...state, tasks: state.tasks.map((known) => (known.id === task.id ? task : known)) }
      })
      if (reason) return { ok: false, reason }
      if (!saved) return { ok: false, reason: 'missing' }
      changed()
      return { ok: true, task: saved }
    },

    async runNow(input) {
      const id = parseId(input)
      return id ? startTask(id, 'manual') : { ok: false, error: 'invalid' }
    },

    async ask(input) {
      const parsed = askSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const agent = await deps.agents.get(parsed.data.agentId)
      if (!agent) return { ok: false, error: 'missing' }
      return enqueue({ runId: newId(), trigger: 'ask', task: null, agent, message: parsed.data.text, meetingId: null, timeoutS: 300, persist: true, output: agent.output.kind === 'note' && !agent.output.meetingId ? null : agent.output, notify: 'never', timeZone: deps.timeZone() })
    },

    async listRuns(input) {
      const filter = runsFilterSchema.safeParse(input)
      const { taskId, status } = filter.success ? (filter.data ?? {}) : {}
      return (await deps.runs.list()).filter((run) => (!taskId || run.taskId === taskId) && (!status || run.status === status))
    },

    getRun: (input) => {
      const id = parseId(input)
      return id ? deps.runs.get(id) : Promise.resolve(null)
    },

    async rerun(input) {
      const id = parseId(input)
      const run = id ? await deps.runs.get(id) : null
      if (!run) return { ok: false, error: 'missing' }
      if (run.taskId && (await deps.schedules.read()).tasks.some((task) => task.id === run.taskId)) return startTask(run.taskId, 'rerun')
      const agent = run.agentId ? await deps.agents.get(run.agentId) : null
      if (!agent) return { ok: false, error: 'missing' }
      // O pedido de antes, sem o cabeçalho de data (vai o de agora).
      const message = run.prompt.split('\n\n').slice(1).join('\n\n') || run.prompt
      return enqueue({ runId: newId(), trigger: 'rerun', task: null, agent, message, meetingId: null, timeoutS: 300, persist: true, output: null, notify: 'never', timeZone: deps.timeZone() })
    },

    status: () => computeStatus(),

    async setPaused(input) {
      const parsed = pausedSchema.safeParse(input)
      if (parsed.success) {
        const at = now()
        await deps.schedules.mutate((state) =>
          parsed.data.paused
            ? { ...state, paused: true, pauseReason: 'person' }
            : // Retomar: o que passou durante a pausa não roda atrasado; cada tarefa segue do próximo horário. Pausado pelo
              // limite diário, "Retomar" libera o resto do dia (fica registrado em `limitReleasedOn`).
              { ...state, paused: false, pauseReason: null, limitReleasedOn: state.pauseReason === 'limit' ? dayOf(at) : state.limitReleasedOn, tasks: state.tasks.map((task) => (task.enabled && !task.autoPaused && task.schedule.kind !== 'after-meeting' && !task.reminder ? { ...task, nextRunAt: nextFor(task, at) } : task)) },
        )
      }
      const status = await computeStatus()
      deps.onChange(status)
      return status
    },

    snapshot: () => last,

    async settled() {
      while (inFlight.size || queue.length || ticking) {
        await Promise.all([...inFlight, ticking ?? Promise.resolve()])
      }
    },

    dispose() {
      disposed = true
      if (interval !== null) timers.clearInterval(interval)
      interval = null
      queue.length = 0
      deps.runner.dispose()
    },
  }
}
