// Esquema zod das automações (contrato 23, CA1 e CA3). Separado de `automations.ts` para o renderer, que só
// usa os tipos e as frases, não carregar o zod. O main valida o que o formulário manda e os arquivos
// `agents.json`, `schedules.json` e `schedule-runs/<id>.json` com estes esquemas.
import { z } from 'zod'
import {
  AFTER_MEETING_MAX_DELAY,
  AGENT_COLORS,
  AGENT_DESCRIPTION_MAX,
  AGENT_ICONS,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_MODELS,
  AGENT_NAME_MAX,
  AGENT_OUTPUT_KINDS,
  AGENT_SCOPE_KINDS,
  EVERY_MAX_MINUTES,
  EVERY_MIN_MINUTES,
  isValidTimeZone,
  NOTIFY_POLICIES,
  parseCron,
  RUN_ONCE_ACTIONS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  TASK_ERROR_MAX,
  TASK_MESSAGE_MAX,
  TASK_NAME_MAX,
  TASK_PREVIEW_MAX,
  TASK_TIMEOUT_MAX_S,
  TASK_TIMEOUT_MIN_S,
  TIME_PATTERN,
  type Agent,
  type AgentInput,
  type AutomationRun,
  type ScheduledTask,
  type TaskInput,
} from './automations'
import { REMINDER_TEXT_MAX } from './assistant'
import { CHAT_SCOPE_MEETINGS_MAX, CHAT_TEXT_MAX } from './chat'
import { AGENT_PROFILES } from './settings-defaults'

export const automationIdSchema = z.string().regex(/^[\w-]{1,100}$/)
const meetingIdSchema = z.string().regex(/^[\w-]{1,200}$/)
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')

/** Sem caractere de controle (quebra de linha inclusive): nome numa linha só. */
const oneLine = (value: string): boolean => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

export const agentScopeSchema = z
  .object({
    kind: z.enum(AGENT_SCOPE_KINDS),
    meetingIds: z.array(meetingIdSchema).max(CHAT_SCOPE_MEETINGS_MAX).optional(),
  })
  .strict()

export const agentOutputSchema = z
  .object({
    kind: z.enum(AGENT_OUTPUT_KINDS),
    meetingId: meetingIdSchema.nullable().optional(),
  })
  .strict()

const agentFields = {
  name: z.string().trim().min(1).max(AGENT_NAME_MAX).refine(oneLine),
  description: z.string().trim().max(AGENT_DESCRIPTION_MAX),
  icon: z.enum(AGENT_ICONS),
  color: z.enum(AGENT_COLORS),
  instructions: z.string().max(AGENT_INSTRUCTIONS_MAX),
  profile: z.enum(AGENT_PROFILES),
  model: z.enum(AGENT_MODELS),
  thinkMore: z.boolean(),
  scope: agentScopeSchema,
  // Contrato 21 (MCP) ainda não existe: nenhuma conexão é aceita.
  mcpServers: z.array(z.string()).max(0),
  output: agentOutputSchema,
}

export const agentInputSchema = z.object({ id: automationIdSchema.nullable(), ...agentFields }).strict()
export const agentSchema = z.object({ id: automationIdSchema, ...agentFields, createdAt: isoDate, updatedAt: isoDate }).strict()

const timeSchema = z.string().regex(TIME_PATTERN)

export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('every'), minutes: z.number().int().min(EVERY_MIN_MINUTES).max(EVERY_MAX_MINUTES) }).strict(),
  z.object({ kind: z.literal('daily'), time: timeSchema }).strict(),
  z
    .object({
      kind: z.literal('weekly'),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .max(7)
        .refine((days) => new Set(days).size === days.length, 'dia repetido'),
      time: timeSchema,
    })
    .strict(),
  z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(28), time: timeSchema }).strict(),
  z.object({ kind: z.literal('once'), at: isoDate }).strict(),
  z
    .object({
      kind: z.literal('cron'),
      expr: z
        .string()
        .max(100)
        .refine((expr) => parseCron(expr) !== null, 'expressão cron inválida'),
    })
    .strict(),
  z.object({ kind: z.literal('after-meeting'), delayMin: z.number().int().min(0).max(AFTER_MEETING_MAX_DELAY) }).strict(),
])

const taskFields = {
  name: z.string().trim().min(1).max(TASK_NAME_MAX).refine(oneLine),
  agentId: automationIdSchema,
  message: z
    .string()
    .max(TASK_MESSAGE_MAX)
    .refine((value) => value.trim() !== ''),
  schedule: scheduleSchema,
  timezone: z.string().refine(isValidTimeZone, 'fuso inválido'),
  enabled: z.boolean(),
  runOnce: z.boolean(),
  runOnceAction: z.enum(RUN_ONCE_ACTIONS),
  timeoutS: z.number().int().min(TASK_TIMEOUT_MIN_S).max(TASK_TIMEOUT_MAX_S),
  notify: z.enum(NOTIFY_POLICIES),
  output: agentOutputSchema.nullable(),
}

/**
 * Id da conversa do lembrete, no formato de `WHATSAPP_CHAT_ID_PATTERN` (repetido aqui: as automações não importam
 * nada do WhatsApp; o teste do contrato 25 confere que os dois são o mesmo).
 */
export const REMINDER_CHAT_ID_PATTERN = /^[\w.+:-]{1,120}@[\w.-]{1,60}$/

/** Contrato 25: o lembrete do Assistente (tarefa sem agente). Só guarda o id e o nome da conversa para o "Abrir". */
export const taskReminderSchema = z
  .object({
    text: z.string().trim().min(1).max(REMINDER_TEXT_MAX),
    whatsappChatId: z.string().regex(REMINDER_CHAT_ID_PATTERN).nullable(),
    whatsappChatName: z.string().max(200).nullable(),
  })
  .strict()

export const taskInputSchema = z.object({ id: automationIdSchema.nullable(), ...taskFields }).strict()
export const taskSchema = z
  .object({
    id: automationIdSchema,
    ...taskFields,
    // O lembrete (contrato 25) não tem agente: `agentId` vazio.
    agentId: z.union([automationIdSchema, z.literal('')]),
    reminder: taskReminderSchema.nullable().default(null),
    lastRunAt: isoDate.nullable(),
    nextRunAt: isoDate.nullable(),
    lastStatus: z.enum(RUN_STATUSES).nullable(),
    lastResultPreview: z.string().max(TASK_PREVIEW_MAX).nullable(),
    lastError: z.string().max(TASK_ERROR_MAX).nullable(),
    consecutiveFailures: z.number().int().min(0).max(1_000_000),
    autoPaused: z.boolean(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()

/** Resposta guardada com a execução: o mesmo formato da mensagem do chat (passos, raciocínio, rodapé). */
const answerSchema = z.object({ role: z.literal('assistant'), text: z.string().max(CHAT_TEXT_MAX), at: isoDate }).passthrough()

export const runSchema = z
  .object({
    id: automationIdSchema,
    taskId: automationIdSchema.nullable(),
    taskName: z.string().max(TASK_NAME_MAX * 2).nullable(),
    agentId: automationIdSchema.nullable(),
    agentName: z.string().max(AGENT_NAME_MAX * 2),
    trigger: z.enum(RUN_TRIGGERS),
    status: z.enum(RUN_STATUSES),
    startedAt: isoDate,
    endedAt: isoDate.nullable(),
    durationMs: z.number().min(0).max(1e10),
    model: z.enum(AGENT_MODELS),
    costUsd: z.number().min(0).max(1e6),
    prompt: z.string().max(TASK_MESSAGE_MAX + 500),
    answer: answerSchema.nullable(),
    error: z.string().max(TASK_ERROR_MAX).nullable(),
    meetingId: meetingIdSchema.nullable(),
    outputResult: z.string().max(500).nullable(),
  })
  .strict()

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const agentMatches: Same<z.infer<typeof agentSchema>, Agent> = true
const agentInputMatches: Same<z.infer<typeof agentInputSchema>, AgentInput> = true
const taskMatches: Same<z.infer<typeof taskSchema>, ScheduledTask> = true
const taskInputMatches: Same<z.infer<typeof taskInputSchema>, TaskInput> = true
void agentMatches
void agentInputMatches
void taskMatches
void taskInputMatches
/** A execução lida do disco: a resposta passa como veio (já foi gravada pelo próprio app). */
export const parseRun = (raw: unknown): AutomationRun | null => {
  const parsed = runSchema.safeParse(raw)
  return parsed.success ? (parsed.data as unknown as AutomationRun) : null
}
