// Esquema zod dos agentes de atendimento no WhatsApp (contrato 138). Separado de `atendimento.ts` para o renderer,
// que só usa os tipos, não carregar o zod. O main valida com estes esquemas o que o renderer manda e o arquivo
// `whatsapp/atendimento.json`; as linhas do histórico também.
import { z } from 'zod'
import {
  ATENDIMENTO_ABOUT_MAX,
  ATENDIMENTO_BINDING_DEFAULTS,
  ATENDIMENTO_DELAY_MAX_MINUTES,
  ATENDIMENTO_INSTRUCTIONS_MAX,
  ATENDIMENTO_LOG_ACTIONS,
  ATENDIMENTO_LOG_LIST_MAX,
  ATENDIMENTO_MAX_PER_HOUR_MAX,
  ATENDIMENTO_MAX_PER_HOUR_MIN,
  ATENDIMENTO_MODELS,
  ATENDIMENTO_MODES,
  ATENDIMENTO_NAME_MAX,
  ATENDIMENTO_NEVER_MAX,
  ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX,
  ATENDIMENTO_REASON_MAX,
  ATENDIMENTO_TIME_PATTERN,
  ATENDIMENTO_TONE_MAX,
  ATENDIMENTO_VERSION,
} from './atendimento'
import { WHATSAPP_CHAT_ID_PATTERN } from './whatsapp'

export const atendimentoIdSchema = z.string().regex(/^[\w-]{1,100}$/)
export const atendimentoChatIdSchema = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')

/** Sem caractere de controle (quebra de linha inclusive): nome numa linha só. */
const oneLine = (value: string): boolean => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

const agentFields = {
  name: z.string().trim().min(1).max(ATENDIMENTO_NAME_MAX).refine(oneLine),
  instructions: z.string().trim().min(1).max(ATENDIMENTO_INSTRUCTIONS_MAX),
  tone: z.string().trim().max(ATENDIMENTO_TONE_MAX),
  never: z.string().trim().max(ATENDIMENTO_NEVER_MAX),
  model: z.enum(ATENDIMENTO_MODELS),
}

export const atendimentoAgentSchema = z
  .object({ id: atendimentoIdSchema, ...agentFields, createdAt: isoDate, updatedAt: isoDate })
  .strict()

export const atendimentoAgentInputSchema = z
  .object({ id: atendimentoIdSchema.nullable(), ...agentFields, tone: agentFields.tone.default(''), never: agentFields.never.default('') })
  .strict()

export const atendimentoHoursSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'dia repetido'),
    start: z.string().regex(ATENDIMENTO_TIME_PATTERN),
    end: z.string().regex(ATENDIMENTO_TIME_PATTERN),
  })
  .strict()

const delayMinutes = z.number().int().min(0).max(ATENDIMENTO_DELAY_MAX_MINUTES)
const maxPerHour = z.number().int().min(ATENDIMENTO_MAX_PER_HOUR_MIN).max(ATENDIMENTO_MAX_PER_HOUR_MAX)
const pauseOnMyReply = z.number().int().min(0).max(ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX)
const about = z.string().trim().max(ATENDIMENTO_ABOUT_MAX)
const delayOrder = (binding: { delayMinMinutes: number; delayMaxMinutes: number }): boolean => binding.delayMaxMinutes >= binding.delayMinMinutes

export const atendimentoBindingSchema = z
  .object({
    chatId: atendimentoChatIdSchema,
    agentId: atendimentoIdSchema,
    enabled: z.boolean(),
    mode: z.enum(ATENDIMENTO_MODES),
    delayMinMinutes: delayMinutes,
    delayMaxMinutes: delayMinutes,
    typing: z.boolean(),
    identify: z.boolean(),
    about,
    hours: atendimentoHoursSchema.nullable(),
    maxPerHour,
    pauseOnMyReplyMinutes: pauseOnMyReply,
    pausedUntil: isoDate.nullable(),
    updatedAt: isoDate,
  })
  .strict()
  .refine(delayOrder, 'atraso máximo menor que o mínimo')

/** O pedido do painel: o que faltar vale o padrão de um atendimento novo. */
export const atendimentoBindingInputSchema = z
  .object({
    chatId: atendimentoChatIdSchema,
    agentId: atendimentoIdSchema,
    enabled: z.boolean().default(ATENDIMENTO_BINDING_DEFAULTS.enabled),
    mode: z.enum(ATENDIMENTO_MODES).default(ATENDIMENTO_BINDING_DEFAULTS.mode),
    delayMinMinutes: delayMinutes.default(ATENDIMENTO_BINDING_DEFAULTS.delayMinMinutes),
    delayMaxMinutes: delayMinutes.default(ATENDIMENTO_BINDING_DEFAULTS.delayMaxMinutes),
    typing: z.boolean().default(ATENDIMENTO_BINDING_DEFAULTS.typing),
    identify: z.boolean().default(ATENDIMENTO_BINDING_DEFAULTS.identify),
    about: about.default(ATENDIMENTO_BINDING_DEFAULTS.about),
    hours: atendimentoHoursSchema.nullable().default(ATENDIMENTO_BINDING_DEFAULTS.hours),
    maxPerHour: maxPerHour.default(ATENDIMENTO_BINDING_DEFAULTS.maxPerHour),
    pauseOnMyReplyMinutes: pauseOnMyReply.default(ATENDIMENTO_BINDING_DEFAULTS.pauseOnMyReplyMinutes),
  })
  .strict()
  .refine(delayOrder, 'atraso máximo menor que o mínimo')

export const atendimentoFileSchema = z
  .object({
    version: z.literal(ATENDIMENTO_VERSION),
    agents: z.array(atendimentoAgentSchema),
    bindings: z.array(atendimentoBindingSchema),
    pausedAll: z.boolean(),
    riskAcceptedAt: isoDate.nullable(),
  })
  .strict()

export const atendimentoLogEntrySchema = z
  .object({
    at: isoDate,
    chatId: atendimentoChatIdSchema,
    agentId: atendimentoIdSchema,
    action: z.enum(ATENDIMENTO_LOG_ACTIONS),
    messageId: z.string().min(1).max(200).optional(),
    reason: z.string().max(ATENDIMENTO_REASON_MAX).optional(),
  })
  .strict()

/** Pedidos dos canais. */
export const atendimentoIdRequestSchema = z.object({ id: atendimentoIdSchema }).strict()
export const atendimentoChatRequestSchema = z.object({ chatId: atendimentoChatIdSchema }).strict()
export const atendimentoPauseAllRequestSchema = z.object({ paused: z.boolean() }).strict()
export const atendimentoLogListRequestSchema = z
  .object({ limit: z.number().int().min(1).max(ATENDIMENTO_LOG_LIST_MAX).optional(), chatId: atendimentoChatIdSchema.optional() })
  .strict()
  .optional()
