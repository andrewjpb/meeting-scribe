// Automações (contrato 23): agentes, agendamentos e execuções. O que o renderer, o main e o smoke
// compartilham: os tipos, os limites, o cálculo do próximo horário (com fuso e horário de verão) e as frases
// em português ("Toda sexta às 17:00"). Sem zod (o esquema fica em `automations-schema.ts`, só no main), sem
// Node: o renderer usa as mesmas funções na prévia "Próximas 5 execuções".
//
// Modelo de referência (KiroCrew, só os nomes dos campos): agente = nome, descrição, instruções, modelo,
// ferramentas e MCP; tarefa = nome, agente, mensagem, frequência, fuso, ligada, uma vez só, tempo máximo e o
// estado da última execução. Nenhum agente envia nada a ninguém: as saídas são só as quatro de
// `AGENT_OUTPUT_KINDS`, todas dentro deste Mac. A exceção é o contrato 51: a tarefa com "Pode enviar email" ligada
// envia email, só da conta e para os destinatários que a pessoa permitiu antes (`task-email.ts`).
import type { ChatDetail, ChatMessage } from './chat'
import { NOTE_COLORS, type NoteColor } from './meeting-notes'
import type { AgentProfileId } from './settings-defaults'
import type { RunEmail, TaskEmailInput, TaskEmailPermission } from './task-email'
import { TRIAGEM_AGENT_NAME, TRIAGEM_ESPERA_SEG } from './triagem'

export const AGENT_NAME_MAX = 40
export const AGENT_DESCRIPTION_MAX = 200
export const AGENT_INSTRUCTIONS_MAX = 8_000
/** Contador do campo de instruções aparece acima disto. */
export const AGENT_INSTRUCTIONS_COUNTER_FROM = 6_000
export const AGENTS_MAX = 100

export const TASK_NAME_MAX = 60
export const TASK_MESSAGE_MAX = 4_000
export const TASKS_MAX = 200
export const TASK_TIMEOUT_MIN_S = 30
export const TASK_TIMEOUT_MAX_S = 1_800
export const TASK_TIMEOUT_DEFAULT_S = 300
export const TASK_PREVIEW_MAX = 300
export const TASK_ERROR_MAX = 300
export const EVERY_MIN_MINUTES = 5
export const EVERY_MAX_MINUTES = 1_440
export const AFTER_MEETING_MAX_DELAY = 60

/** Histórico: as últimas 500 execuções, em `userData/schedule-runs/`. */
export const RUNS_MAX = 500
/** Falhas seguidas antes de a tarefa pausar sozinha. */
export const AUTO_PAUSE_FAILURES = 3
/** Horário perdido com o app fechado ou o Mac dormindo: roda uma vez se o atraso for menor que isto. */
export const MISSED_RUN_MAX_MS = 12 * 60 * 60_000
/** O agendador confere a cada 30 s. */
export const SCHEDULER_TICK_MS = 30_000
/** Execuções ao mesmo tempo, no total; as outras esperam na fila. */
export const MAX_CONCURRENT_RUNS = 2
/** "Limite diário de execuções agendadas" (Configurações › Claude): o padrão. */
export const DEFAULT_DAILY_RUN_LIMIT = 50

/**
 * Modelos de um agente. O perfil diz quais oferece (`AGENT_PROFILE_MODELS`): o do Claude oferece hoje os três
 * do chat; Opus 5.5 e Fable 5.2 entram com o contrato 20.
 */
export const AGENT_MODELS = ['haiku', 'sonnet', 'opus', 'opus-5-5', 'fable-5-2'] as const
export type AgentModel = (typeof AGENT_MODELS)[number]
export const AGENT_MODEL_LABELS: Readonly<Record<AgentModel, string>> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', 'opus-5-5': 'Opus 5.5', 'fable-5-2': 'Fable 5.2' }
export const AGENT_PROFILE_MODELS: Readonly<Record<AgentProfileId, readonly AgentModel[]>> = { claude: ['haiku', 'sonnet', 'opus'] }

/** Ícones do app que um agente pode ter (o renderer liga cada nome a um ícone do lucide). */
export const AGENT_ICONS = ['bot', 'calendar', 'list-checks', 'circle-help', 'file-text', 'bell', 'search', 'sparkles'] as const
export type AgentIcon = (typeof AGENT_ICONS)[number]
/** Cores das anotações (contrato 13). */
export const AGENT_COLORS = NOTE_COLORS
export type AgentColor = NoteColor

/** Escopo do chat (contrato 16) mais "nenhuma": a execução roda numa pasta vazia. */
export const AGENT_SCOPE_KINDS = ['all', '7d', '30d', 'meetings', 'none'] as const
export type AgentScopeKind = (typeof AGENT_SCOPE_KINDS)[number]
export interface AgentScope {
  kind: AgentScopeKind
  /** Só em `meetings`. */
  meetingIds?: string[] | undefined
}

/**
 * Saídas (CA6): conversa nova no "Assistente", post-it na reunião, arquivo `.md` na pasta das reuniões ou
 * notificação do macOS. Nada vai para fora do Mac.
 */
export const AGENT_OUTPUT_KINDS = ['chat', 'note', 'file', 'notification'] as const
export type AgentOutputKind = (typeof AGENT_OUTPUT_KINDS)[number]
export interface AgentOutput {
  kind: AgentOutputKind
  /** Post-it: a reunião escolhida (fora de "depois de cada reunião", que usa a reunião que acabou). */
  meetingId?: string | null | undefined
}

export interface Agent {
  id: string
  name: string
  description: string
  icon: AgentIcon
  color: AgentColor
  /** O "prompt": vai como instrução de sistema da sessão. */
  instructions: string
  profile: AgentProfileId
  model: AgentModel
  thinkMore: boolean
  scope: AgentScope
  /**
   * Contrato 26: "Pode pesquisar na internet". Busca na web e abre só as páginas que a busca encontrou (ou que a pessoa
   * escreveu no pedido). Agente salvo antes do 26 lê como `false`.
   */
  web: boolean
  /** Contrato 115: "Pode ler o funil". Cada execução recebe `FUNIL.md` na pasta. Agente salvo antes lê como `false`. */
  funil: boolean
  /**
   * Contrato 128 (R31): "Pode ler as tarefas". Cada execução recebe `TAREFAS.md` na pasta (o runner liga no 124).
   * Agente salvo antes lê como `false`.
   */
  tarefas: boolean
  /** Conexões MCP (contrato 21). O 21 ainda não existe: fica sempre vazio e escondido. */
  mcpServers: string[]
  output: AgentOutput
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
}

/** O que o formulário manda: `id: null` cria. */
export type AgentInput = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> & { id: string | null }

export type Schedule =
  | { kind: 'every'; minutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'once'; at: string }
  | { kind: 'cron'; expr: string }
  | { kind: 'after-meeting'; delayMin: number }
  /**
   * Contrato 159: "Quando chega mensagem do WhatsApp" (a triagem). Não roda pelo relógio: o motor da triagem dispara
   * `esperaSeg` segundos depois da última mensagem da conversa; `grupos` desligado ignora as conversas de grupo.
   */
  | { kind: 'whatsapp-message'; esperaSeg: number; grupos: boolean }
export type ScheduleKind = Schedule['kind']
export const SCHEDULE_KINDS = ['every', 'daily', 'weekly', 'monthly', 'once', 'cron', 'after-meeting', 'whatsapp-message'] as const satisfies readonly ScheduleKind[]

export const RUN_STATUSES = ['ok', 'error', 'timeout', 'skipped', 'running'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const NOTIFY_POLICIES = ['always', 'on-error', 'never'] as const
export type NotifyPolicy = (typeof NOTIFY_POLICIES)[number]
/** "Rodar uma vez só": depois de rodar, a tarefa é excluída ou desligada. */
export const RUN_ONCE_ACTIONS = ['delete', 'disable'] as const
export type RunOnceAction = (typeof RUN_ONCE_ACTIONS)[number]

export interface ScheduledTask {
  id: string
  name: string
  agentId: string
  /** O que pedir ao agente. */
  message: string
  schedule: Schedule
  /** IANA; o padrão é o fuso do Mac. */
  timezone: string
  enabled: boolean
  runOnce: boolean
  runOnceAction: RunOnceAction
  timeoutS: number
  notify: NotifyPolicy
  /** `null` herda a saída do agente. */
  output: AgentOutput | null
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: RunStatus | null
  lastResultPreview: string | null
  lastError: string | null
  consecutiveFailures: number
  /** Pausada sozinha depois de 3 falhas seguidas; ligar de novo tira a pausa. */
  autoPaused: boolean
  /**
   * Contrato 25: lembrete criado pelo Assistente. Tarefa "uma vez" sem agente (`agentId` vazio): no horário, só a
   * notificação do macOS com o texto, e o "Abrir" leva à conversa do WhatsApp quando há. Nenhum Claude roda.
   */
  reminder: TaskReminder | null
  /**
   * Contrato 51: "Pode enviar email", a permissão dada antes (a conta, os destinatários permitidos e o teto por
   * execução). `null`: a tarefa não envia nada, como no contrato 23.
   */
  email: TaskEmailPermission | null
  createdAt: string
  updatedAt: string
}

export interface TaskReminder {
  text: string
  whatsappChatId: string | null
  whatsappChatName: string | null
  /** Contrato 45: o lembrete de responder um email; "Abrir" da notificação leva à mensagem. */
  email?: { accountId: string; messageId: string; label: string; mailbox?: string | null | undefined } | null | undefined
}

/** O que o formulário manda: sem o estado das execuções. */
export type TaskInput = Pick<ScheduledTask, 'name' | 'agentId' | 'message' | 'schedule' | 'timezone' | 'enabled' | 'runOnce' | 'runOnceAction' | 'timeoutS' | 'notify' | 'output'> & {
  id: string | null
  /** Contrato 51: a seção "Pode enviar email" ligada; ausente ou `null`, desligada. */
  email?: TaskEmailInput | null | undefined
}

/**
 * De onde veio a execução: o horário (`schedule`), um horário perdido rodando atrasado (`missed`), o fim de
 * uma reunião (`meeting`), "Rodar agora" (`manual`), "Pedir agora" (`ask`), "Rodar de novo" (`rerun`) e
 * "Testar agora" (`test`, que não entra no histórico). Contrato 159: a triagem de uma conversa do WhatsApp (`whatsapp`),
 * que tem teto diário próprio e fica fora do limite diário.
 */
export const RUN_TRIGGERS = ['schedule', 'missed', 'meeting', 'manual', 'ask', 'rerun', 'test', 'whatsapp'] as const
export type RunTrigger = (typeof RUN_TRIGGERS)[number]
/** As que contam no limite diário: as que rodaram sem clique. */
export const AUTOMATIC_TRIGGERS: readonly RunTrigger[] = ['schedule', 'missed', 'meeting']

export interface AutomationRun {
  id: string
  /** `null` em "Pedir agora" e "Testar agora". */
  taskId: string | null
  taskName: string | null
  agentId: string | null
  agentName: string
  trigger: RunTrigger
  status: RunStatus
  /** ISO 8601. */
  startedAt: string
  endedAt: string | null
  durationMs: number
  /** Modelo pedido. */
  model: AgentModel
  /** Custo nominal em US$ (sai do plano do Claude da pessoa). */
  costUsd: number
  /** O pedido enviado ao agente, com a data e o fuso no começo. */
  prompt: string
  /** A resposta com raciocínio, passos e rodapé (os componentes do chat 16). */
  answer: ChatMessage | null
  error: string | null
  /** Reunião alvo (depois de cada reunião, ou o post-it). */
  meetingId: string | null
  /** O que a saída fez: "Conversa criada", "Post-it na reunião", "Arquivo …", "Notificação", ou o erro dela. */
  outputResult: string | null
  /** Contrato 51: os emails que a execução enviou ou que foram recusados, na ordem. Ausente: nenhum pedido de envio. */
  emails?: RunEmail[] | undefined
  /**
   * Contrato 56 (D19): os pedidos de organizar o email que o modelo fez nesta execução, todos recusados (tarefa agendada
   * não move, não cria pasta e não apaga). Ausente: nenhum pedido.
   */
  organizeRefused?: RunOrganizeRefused[] | undefined
}

/** Contrato 56 (D19): um pedido de organizar o email recusado numa execução ("mover 23 emails para Resolvidos"). */
export interface RunOrganizeRefused {
  at: string
  request: string
}

export type AutomationRunListItem = Omit<AutomationRun, 'prompt' | 'answer'>

/** Estado geral (aba, ícone da barra de menus). */
export interface AutomationsStatus {
  /** "Pausar todas as tarefas", ou o limite diário passou. */
  paused: boolean
  pauseReason: 'person' | 'limit' | null
  /** Execuções automáticas de hoje e o limite. */
  runsToday: number
  dailyLimit: number
  /** Ids das execuções rodando agora. */
  running: string[]
  /** As próximas tarefas (ligadas, com horário), na ordem. */
  next: { taskId: string; name: string; at: string }[]
}

export const EMPTY_AUTOMATIONS_STATUS: Readonly<AutomationsStatus> = Object.freeze({ paused: false, pauseReason: null, runsToday: 0, dailyLimit: DEFAULT_DAILY_RUN_LIMIT, running: [], next: [] })

/** Lista de agentes com quantas tarefas usam cada um. */
export interface AgentsList {
  agents: Agent[]
  /** Nome das tarefas que usam o agente, pelo id do agente. */
  usage: Record<string, string[]>
  /** Modelos que o perfil oferece. */
  models: AgentModel[]
  /** Contrato 21 (MCP) existe? Hoje não: o campo fica escondido. */
  mcp: boolean
}

export type AgentSaveResult = { ok: true; agent: Agent } | { ok: false; error: 'invalid' | 'duplicate' | 'missing' | 'model' | 'full' }
export type AgentDeleteResult = { ok: true } | { ok: false; error: 'in-use'; tasks: string[] } | { ok: false; error: 'missing' }
/** `past`: "Uma vez em" com a data que já passou. */
/** `email`: a conta escolhida em "Pode enviar email" não existe (contrato 51). */
/** Contrato 161: uma segunda tarefa "Quando chega mensagem do WhatsApp" ligada é recusada com a frase pronta. */
export type TaskSaveResult = { ok: true; task: ScheduledTask } | { ok: false; error: 'invalid' | 'agent' | 'cron' | 'timezone' | 'missing' | 'full' | 'past' | 'email' | TriagemUnicaError }
export type TriagemUnicaError = `Já existe um agente de triagem ativo: ${string}`
/** Contrato 161: ligar (pelo interruptor da lista) uma segunda triagem é recusado com a mesma frase do `saveTask`. */
export type TaskToggleResult = ScheduledTask | null | { ok: false; error: TriagemUnicaError }
/** Contrato 161: a frase da recusa, com o nome da tarefa que já está ligada. */
export const triagemUnicaError = (taskName: string): TriagemUnicaError => `Já existe um agente de triagem ativo: ${taskName}`
/** `busy`: a tarefa já roda (a vez vira `skipped`); `not-found`: sem o `claude`; `paused`: tudo pausado. */
export type RunStartResult = { ok: true; runId: string } | { ok: false; error: 'missing' | 'busy' | 'invalid' }

/** Eventos de uma execução para a tela (o mesmo formato do chat 16, com o id da execução). */
export type AutomationEvent =
  | { type: 'answer'; runId: string; text: string; reading: boolean }
  | ({ runId: string } & ChatDetail)
  | { type: 'done'; runId: string; run: AutomationRun }

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = { ok: 'Concluída', error: 'Erro', timeout: 'Tempo esgotado', skipped: 'Pulada', running: 'Rodando' }
export const RUN_TRIGGER_LABELS: Readonly<Record<RunTrigger, string>> = {
  schedule: 'No horário',
  missed: 'Horário perdido',
  meeting: 'Depois da reunião',
  manual: 'Rodar agora',
  ask: 'Pedir agora',
  rerun: 'Rodar de novo',
  test: 'Testar agora',
  whatsapp: 'WhatsApp',
}
export const OUTPUT_LABELS: Readonly<Record<AgentOutputKind, string>> = { chat: 'Conversa no Assistente', note: 'Post-it na reunião', file: 'Arquivo .md na pasta', notification: 'Notificação do macOS' }
export const SCOPE_LABELS: Readonly<Record<AgentScopeKind, string>> = { all: 'Todas as reuniões', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', meetings: 'Reuniões escolhidas', none: 'Nenhuma reunião' }
export const NOTIFY_LABELS: Readonly<Record<NotifyPolicy, string>> = { always: 'Sempre', 'on-error': 'Só com erro', never: 'Nunca' }

/** O modelo é do chat (haiku, sonnet, opus)? */
export const isOfferedModel = (profile: AgentProfileId, model: AgentModel): boolean => AGENT_PROFILE_MODELS[profile].includes(model)

// ---------------------------------------------------------------------------------------------------------
// Horários: o relógio de parede no fuso da tarefa, pelo `Intl` (sem biblioteca).

export interface WallTime {
  year: number
  /** 1 a 12. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 (domingo) a 6 (sábado). */
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone)
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' })
    formatters.set(timeZone, found)
  }
  return found
}

/** Fuso IANA que o `Intl` conhece. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    formatterFor(value)
    return true
  } catch {
    return false
  }
}

/** "AAAA-MM-DD" de um instante no fuso (o dia do limite diário; contrato 161: também o do teto da triagem). */
export function dayKey(ms: number, timeZone: string): string {
  const wall = wallTime(ms, timeZone)
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
}

/** Hora de parede de um instante num fuso. */
export function wallTime(ms: number, timeZone: string): WallTime {
  const parts: Record<string, string> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) parts[part.type] = part.value
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']) % 24,
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday: WEEKDAY_INDEX[parts['weekday'] ?? ''] ?? 0,
  }
}

/** Diferença do fuso para o UTC naquele instante, em ms. */
function offsetAt(ms: number, timeZone: string): number {
  const wall = wallTime(ms, timeZone)
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(ms / 1000) * 1000
}

/**
 * Instante da hora de parede `hour:minute` do dia dado, no fuso. Hora que não existe (o relógio pulou no
 * horário de verão) cai uma hora depois; hora que se repete (o relógio voltou) fica com a primeira.
 */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const local = Date.UTC(year, month - 1, day, hour, minute)
  const first = local - offsetAt(local, timeZone)
  const second = local - offsetAt(first, timeZone)
  if (second === first) return first
  const wall = wallTime(second, timeZone)
  return wall.hour === hour && wall.minute === minute ? second : first
}

/** O dia civil `days` depois de (year, month, day). */
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number; weekday: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() }
}

/** "HH:MM" de 00:00 a 23:59. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(time)
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

/** Expressão cron de 5 campos, já expandida. */
export interface CronFields {
  minutes: number[]
  hours: number[]
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** Dia do mês e dia da semana com `*`: a regra do cron junta os dois com "ou" quando os dois são restritos. */
  anyDay: boolean
  anyWeekday: boolean
}

function cronField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>()
  for (const item of field.split(',')) {
    const match = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/.exec(item)
    if (!match?.[1]) return null
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (step < 1) return null
    let from = min
    let to = max
    if (match[1] !== '*') {
      const [a, b] = match[1].split('-').map(Number)
      if (a === undefined) return null
      from = a
      // `5/15` vale "de 5 até o fim, a cada 15".
      to = b ?? (match[2] === undefined ? a : max)
    }
    if (from < min || to > max || from > to) return null
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

/** Expressão cron de 5 campos (minuto, hora, dia do mês, mês, dia da semana); `null` se inválida. */
export function parseCron(expr: string): CronFields | null {
  if (typeof expr !== 'string' || expr.length > 100) return null
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minuteField = '', hourField = '', dayField = '', monthField = '', weekdayField = ''] = fields
  const minutes = cronField(minuteField, 0, 59)
  const hours = cronField(hourField, 0, 23)
  const days = cronField(dayField, 1, 31)
  const months = cronField(monthField, 1, 12)
  const weekdays = cronField(weekdayField, 0, 7)
  if (!minutes || !hours || !days || !months || !weekdays) return null
  return {
    minutes,
    hours,
    days: new Set(days),
    months: new Set(months),
    // 7 também é domingo.
    weekdays: new Set(weekdays.map((value) => value % 7)),
    anyDay: dayField === '*',
    anyWeekday: weekdayField === '*',
  }
}

function cronDayMatches(cron: CronFields, day: number, weekday: number): boolean {
  if (cron.anyDay && cron.anyWeekday) return true
  if (cron.anyDay) return cron.weekdays.has(weekday)
  if (cron.anyWeekday) return cron.days.has(day)
  return cron.days.has(day) || cron.weekdays.has(weekday)
}

/** Até onde a procura do próximo horário de um cron vai (29 de fevereiro numa segunda pode levar anos). */
const CRON_SEARCH_DAYS = 366 * 8

/**
 * Próximo horário depois de `after` (ms), no fuso; `null` quando não há (uma vez só que já passou, depois de
 * cada reunião, mensagem do WhatsApp, cron impossível). `every` conta a partir de `after`: quem chama passa a última execução.
 */
export function nextRunAfter(schedule: Schedule, timeZone: string, after: number): number | null {
  if (schedule.kind === 'every') return after + schedule.minutes * 60_000
  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at)
    return Number.isNaN(at) || at <= after ? null : at
  }
  if (schedule.kind === 'after-meeting' || schedule.kind === 'whatsapp-message') return null
  const start = wallTime(after, timeZone)
  if (schedule.kind === 'daily' || schedule.kind === 'weekly') {
    const time = parseTime(schedule.time)
    if (!time) return null
    const days = schedule.kind === 'weekly' ? new Set(schedule.days) : null
    if (days && days.size === 0) return null
    for (let offset = 0; offset <= 15; offset++) {
      const date = addDays(start.year, start.month, start.day, offset)
      if (days && !days.has(date.weekday)) continue
      const at = zonedInstant(date.year, date.month, date.day, time.hour, time.minute, timeZone)
      if (at > after) return at
    }
    return null
  }
  if (schedule.kind === 'monthly') {
    const time = parseTime(schedule.time)
    if (!time) return null
    for (let offset = 0; offset <= 24; offset++) {
      const month0 = start.month - 1 + offset
      const year = start.year + Math.floor(month0 / 12)
      const month = (month0 % 12) + 1
      const at = zonedInstant(year, month, schedule.day, time.hour, time.minute, timeZone)
      if (at > after) return at
    }
    return null
  }
  const cron = parseCron(schedule.expr)
  if (!cron) return null
  for (let offset = 0; offset <= CRON_SEARCH_DAYS; offset++) {
    const date = addDays(start.year, start.month, start.day, offset)
    if (!cron.months.has(date.month) || !cronDayMatches(cron, date.day, date.weekday)) continue
    for (const hour of cron.hours) {
      // No primeiro dia, as horas que já passaram nem são calculadas (com folga para o horário de verão).
      if (offset === 0 && hour < start.hour - 2) continue
      for (const minute of cron.minutes) {
        const at = zonedInstant(date.year, date.month, date.day, hour, minute, timeZone)
        if (at <= after) continue
        // Hora que não existe naquele dia (o relógio pulou) não roda.
        const wall = wallTime(at, timeZone)
        if (wall.hour !== hour || wall.minute !== minute) continue
        return at
      }
    }
  }
  return null
}

/** Os próximos `count` horários (prévia "Próximas 5 execuções"). */
export function nextRuns(schedule: Schedule, timeZone: string, after: number, count = 5): number[] {
  const runs: number[] = []
  let cursor = after
  while (runs.length < count) {
    const at = nextRunAfter(schedule, timeZone, cursor)
    if (at === null) break
    runs.push(at)
    cursor = at
  }
  return runs
}

/** Horários vencidos de `first` até `now` (inclusive), no máximo `max`: quantos se perderam. */
export function dueOccurrences(schedule: Schedule, timeZone: string, first: number, now: number, max = 1_000): number[] {
  const due: number[] = []
  let at: number | null = first
  while (at !== null && at <= now && due.length < max) {
    due.push(at)
    at = nextRunAfter(schedule, timeZone, at)
  }
  return due
}

// ---------------------------------------------------------------------------------------------------------
// Frases.

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const
const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const
export const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((name, value) => ({ value, label: name, short: WEEKDAY_SHORT[value] ?? '' }))

const two = (value: number): string => String(value).padStart(2, '0')

/** "segunda, quarta e sexta". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1) ?? ''}`
}

function weeklyText(days: readonly number[], time: string): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return `Todo dia às ${time}`
  if (sorted.join(',') === '1,2,3,4,5') return `Todo dia útil às ${time}`
  if (sorted.join(',') === '0,6') return `Todo fim de semana às ${time}`
  const names = sorted.map((day) => WEEKDAY_NAMES[day] ?? '')
  // "Toda segunda…", "Todo sábado…": o gênero do primeiro dia da lista.
  const first = sorted[0] ?? 1
  return `${first === 0 || first === 6 ? 'Todo' : 'Toda'} ${joinNames(names)} às ${time}`
}

function everyText(minutes: number): string {
  if (minutes < 60) return `A cada ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return hours === 1 ? 'A cada hora' : `A cada ${hours} h`
  return `A cada ${hours} h ${rest} min`
}

/** Um campo de cron com um valor só. */
const single = (values: readonly number[] | Set<number>): number | null => {
  const list = [...values]
  return list.length === 1 ? (list[0] ?? null) : null
}

/** Cron em português quando ele cabe numa frase simples; senão a própria expressão. */
export function describeCron(expr: string): string | null {
  const cron = parseCron(expr)
  if (!cron) return null
  const fields = expr.trim().split(/\s+/)
  const minute = single(cron.minutes)
  const hour = single(cron.hours)
  const everyMonth = fields[3] === '*'
  if (everyMonth && minute !== null && hour !== null) {
    const time = `${two(hour)}:${two(minute)}`
    if (cron.anyDay && cron.anyWeekday) return `Todo dia às ${time}`
    if (cron.anyDay) return weeklyText([...cron.weekdays], time)
    if (cron.anyWeekday && single(cron.days) !== null) return `Todo mês no dia ${single(cron.days)} às ${time}`
  }
  if (everyMonth && cron.anyDay && cron.anyWeekday && minute !== null && fields[1] === '*') return `A cada hora, no minuto ${two(minute)}`
  const step = /^\*\/(\d{1,2})$/.exec(fields[0] ?? '')
  if (step && fields.slice(1).every((field) => field === '*')) return `A cada ${Number(step[1])} min`
  return `Cron: ${expr.trim()}`
}

/** "sex 21/11 17:00" no fuso. */
export function formatRunAt(ms: number, timeZone: string): string {
  const wall = wallTime(ms, timeZone)
  return `${WEEKDAY_SHORT[wall.weekday] ?? ''} ${two(wall.day)}/${two(wall.month)} ${two(wall.hour)}:${two(wall.minute)}`
}

/** "sex 17:00" no fuso (menu do ícone da barra de menus). */
export function formatRunShort(ms: number, timeZone: string): string {
  const wall = wallTime(ms, timeZone)
  return `${WEEKDAY_SHORT[wall.weekday] ?? ''} ${two(wall.hour)}:${two(wall.minute)}`
}

/** Frase da frequência: "Toda sexta às 17:00", "A cada 30 min", "Depois de cada reunião". */
export function describeSchedule(schedule: Schedule, timeZone: string): string {
  switch (schedule.kind) {
    case 'every':
      return everyText(schedule.minutes)
    case 'daily':
      return `Todo dia às ${schedule.time}`
    case 'weekly':
      return weeklyText(schedule.days, schedule.time)
    case 'monthly':
      return `Todo mês no dia ${schedule.day} às ${schedule.time}`
    case 'once': {
      const at = Date.parse(schedule.at)
      return Number.isNaN(at) ? 'Uma vez' : `Uma vez em ${formatRunAt(at, timeZone)}`
    }
    case 'cron':
      return describeCron(schedule.expr) ?? 'Expressão cron inválida'
    case 'after-meeting':
      return schedule.delayMin === 0 ? 'Depois de cada reunião' : `${schedule.delayMin} min depois de cada reunião`
    case 'whatsapp-message':
      return 'Quando chega mensagem do WhatsApp'
  }
}

/** "Toda sexta às 17:00 · próxima: sex 21/11 17:00". */
export function scheduleLine(task: Pick<ScheduledTask, 'schedule' | 'timezone' | 'nextRunAt' | 'enabled' | 'autoPaused'>): string {
  const text = describeSchedule(task.schedule, task.timezone)
  if (!task.enabled || task.autoPaused || !task.nextRunAt) return text
  const at = Date.parse(task.nextRunAt)
  return Number.isNaN(at) ? text : `${text} · próxima: ${formatRunAt(at, task.timezone)}`
}

/** "agora", "há 5 min", "há 2 h", "há 3 dias". */
export function agoLabel(ms: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'há 1 dia' : `há ${days} dias`
}

/** "12 s", "1 min 05 s". */
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${two(seconds % 60)} s`
}

/** Cabeçalho do pedido: a data, a hora e o fuso de agora, para o agente saber "esta semana" e "hoje". */
export function promptHeader(now: number, timeZone: string): string {
  const wall = wallTime(now, timeZone)
  return `Agora: ${WEEKDAY_NAMES[wall.weekday] ?? ''}, ${two(wall.day)}/${two(wall.month)}/${wall.year} ${two(wall.hour)}:${two(wall.minute)} (${timeZone}).`
}

/** Começo da resposta (prévia da tabela, corpo da notificação): uma linha, cortada. */
export function previewOf(text: string, max = TASK_PREVIEW_MAX): string {
  const line = text.replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

/** Saída que vale para a tarefa: a dela ou a do agente. */
export function taskOutput(task: Pick<ScheduledTask, 'output'>, agent: Pick<Agent, 'output'>): AgentOutput {
  return task.output ?? agent.output
}

/** "Agentes/<tarefa>/" e o nome do arquivo `AAAA-MM-DD HHhMM.md` (hora local do Mac), sem a pasta. */
export function runFileStamp(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}h${two(date.getMinutes())}`
}

export const AGENTS_FOLDER_NAME = 'Agentes'

/**
 * Contrato 159: o modelo pronto "Triagem do WhatsApp". Lê o funil (decide pessoal × profissional pelo contato e pela
 * empresa); a leitura das mensagens vem do gatilho "Quando chega mensagem do WhatsApp", não de uma permissão do agente.
 * As instruções são o texto da PRD (notificacoes-triagem), com o funil e a urgência mais explícitos (contrato 171, C11).
 */
export const TRIAGEM_TEMPLATE: Omit<AgentInput, 'id'> = {
  name: TRIAGEM_AGENT_NAME,
  description: 'Classifica cada conversa que recebe mensagem: urgente ou não; pessoal ou profissional.',
  icon: 'bell',
  color: 'orange',
  instructions:
    'Você faz a triagem de conversas do WhatsApp do dono do app. Para a conversa recebida, decida duas coisas. Urgente: sim quando a pessoa pede resposta hoje, cita prazo, pagamento, cobrança, falha em produção, saúde, segurança ou emergência, ou mandou várias mensagens seguidas sem resposta; não para conversa casual, confirmação simples ou assunto que pode esperar. Âmbito: profissional quando trata de trabalho, cliente, projeto, proposta, orçamento, reunião, nota fiscal ou cobrança; pessoal quando família, amigos, lazer, saúde própria ou assunto particular. Se o contato está no funil de vendas, pende para profissional, salvo contexto claro em contrário. Contato do funil pende para profissional mesmo em conversa informal. Urgente só com pedido explícito e prazo, cobrança de resposta ou problema em andamento; conversa só com anexos, mensagens automáticas (saldo, notificação, robô) ou sem pedido não é urgente. Em dúvida, âmbito indefinido. Nunca invente fatos: use só o que está nas mensagens.',
  profile: 'claude',
  model: 'haiku',
  thinkMore: false,
  scope: { kind: 'none' },
  web: false,
  funil: true,
  tarefas: false,
  mcpServers: [],
  output: { kind: 'notification' },
}

/** Contrato 159: o gatilho padrão da tarefa da triagem (espera 30 s depois da última mensagem; grupos desligado). */
export const TRIAGEM_SCHEDULE_DEFAULTS: Schedule = { kind: 'whatsapp-message', esperaSeg: TRIAGEM_ESPERA_SEG.padrao, grupos: false }

/** Agentes de exemplo da primeira vez (editáveis e removíveis). */
export const EXAMPLE_AGENTS: readonly Omit<AgentInput, 'id'>[] = [
  {
    name: 'Resumo da semana',
    description: 'As reuniões dos últimos 7 dias: decisões, tarefas por pessoa e perguntas em aberto.',
    icon: 'calendar',
    color: 'blue',
    instructions: [
      'Leia todas as reuniões dos últimos 7 dias e escreva um resumo da semana em três partes:',
      '1. Decisões tomadas, cada uma com a reunião citada.',
      '2. Tarefas por pessoa, com o prazo quando houver.',
      '3. Perguntas em aberto e o que ainda falta confirmar.',
      'Seja direto: uma linha por item.',
    ].join('\n'),
    profile: 'claude',
    model: 'sonnet',
    thinkMore: false,
    scope: { kind: '7d' },
    web: false,
    funil: false,
    tarefas: false,
    mcpServers: [],
    output: { kind: 'chat' },
  },
  {
    name: 'Minhas tarefas',
    description: 'As suas tarefas abertas, do TAREFAS.md: vencidas e de hoje primeiro, com o prazo e a origem.',
    icon: 'list-checks',
    color: 'green',
    instructions:
      'Liste as minhas tarefas abertas, começando pelas vencidas e pelas de hoje. Use o TAREFAS.md; diga o prazo de cada uma e de onde veio (reunião, oportunidade, e-mail ou conversa).',
    profile: 'claude',
    model: 'haiku',
    thinkMore: false,
    scope: { kind: 'all' },
    web: false,
    funil: false,
    tarefas: true,
    mcpServers: [],
    output: { kind: 'chat' },
  },
  {
    name: 'Pendências da reunião',
    description: 'Para rodar logo depois de encerrar: perguntas em aberto e o que confirmar.',
    icon: 'circle-help',
    color: 'yellow',
    instructions: [
      'Leia a reunião que acabou de terminar e liste:',
      '- as perguntas que ficaram em aberto;',
      '- o que precisa ser confirmado com alguém, e com quem.',
      'Se não houver pendência, diga isso em uma frase.',
    ].join('\n'),
    profile: 'claude',
    model: 'haiku',
    thinkMore: false,
    scope: { kind: 'all' },
    web: false,
    funil: false,
    tarefas: false,
    mcpServers: [],
    output: { kind: 'note' },
  },
  TRIAGEM_TEMPLATE,
]
