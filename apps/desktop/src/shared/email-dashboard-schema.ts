// Esquema zod do Painel de e-mail (contrato 155). Separado de `email-dashboard.ts` para o renderer, que só usa os
// tipos, não carregar o zod. O store valida `dashboard.json` na leitura e antes de gravar; a passada (contrato 156)
// valida a saída do modelo com `EmailDashboardModelOutputSchema` e depois aplica `clampModelItem`.
import { z } from 'zod'
import { DASHBOARD_LIMITS, EMAIL_DASHBOARD_VERSION, type EmailDashboardItem, type EmailDashboardStore } from './email-dashboard'

const at = z.number().finite()
const model = z.enum(['haiku', 'sonnet'])

export const EmailDashboardItemSchema = z.object({
  accountId: z.string().min(1),
  messageKey: z.string().min(1),
  messageId: z.string().nullable(),
  analyzedAt: at,
  model,
  importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  reason: z.string().max(DASHBOARD_LIMITS.reasonChars),
  needsReply: z.boolean(),
  reply: z.string().max(DASHBOARD_LIMITS.replyChars).nullable(),
  move: z.object({ folder: z.string().min(1), reason: z.string().max(DASHBOARD_LIMITS.reasonChars) }).nullable(),
}) satisfies z.ZodType<EmailDashboardItem>

const markSchema = z.object({ key: z.string().min(1), at })

export const EmailDashboardStoreSchema = z.object({
  version: z.literal(EMAIL_DASHBOARD_VERSION),
  lastRun: z.object({ at, model, analyzed: z.number().int().min(0), costUsd: z.number().finite().nullable(), error: z.string().nullable() }).nullable(),
  items: z.record(z.string(), EmailDashboardItemSchema),
  ignored: z.array(markSchema),
  opened: z.array(markSchema),
}) satisfies z.ZodType<EmailDashboardStore>

/** A resposta do modelo, já como objeto: `ref` aponta a mensagem do lote; os limites de R6 ficam com `clampModelItem`. */
export const EmailDashboardModelOutputSchema = z.object({
  items: z.array(
    z.object({
      ref: z.string(),
      importance: z.number(),
      reason: z.string().optional(),
      needsReply: z.boolean().optional(),
      reply: z.string().nullable().optional(),
      move: z.object({ folder: z.string(), reason: z.string().optional() }).nullable().optional(),
    }),
  ),
})
export type EmailDashboardModelOutput = z.infer<typeof EmailDashboardModelOutputSchema>
