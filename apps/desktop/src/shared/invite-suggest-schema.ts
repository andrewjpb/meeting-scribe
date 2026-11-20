// Contrato 64: os esquemas zod do "Sugerir evento" (a resposta do Claude e o pedido de gravar), só no main e nos testes;
// os tipos, os limites e as frases ficam em `invite-suggest.ts`, que a tela importa sem levar o zod.
import { z } from 'zod'
import { safeJoinUrl } from './calendar'
import { EMAIL_ACCOUNT_ID_PATTERN } from './email'
import { INVITE_SUGGEST_DATE_PATTERN, INVITE_SUGGEST_DURATION_MAX, INVITE_SUGGEST_DURATION_MIN, INVITE_SUGGEST_TIME_PATTERN, INVITE_SUGGEST_TITLE_MAX, type InviteSuggestAddRequest } from './invite-suggest'

/** A resposta do Claude: só estas chaves, com estes tipos; qualquer outra coisa é `format`. */
export const inviteSuggestReplySchema = z
  .object({
    found: z.boolean(),
    title: z.string().nullable(),
    date: z.string().regex(INVITE_SUGGEST_DATE_PATTERN).nullable(),
    time: z.string().regex(INVITE_SUGGEST_TIME_PATTERN).nullable(),
    durationMinutes: z.number().int().nullable(),
    url: z.string().nullable(),
  })
  .strict()
export type InviteSuggestReply = z.infer<typeof inviteSuggestReplySchema>

const oneLine = (value: string): boolean => !/[\r\n]/.test(value)
const realDay = (text: string): boolean => {
  const [year = 0, month = 0, day = 0] = text.split('-').map(Number)
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Gravar a sugestão (só no clique de "Pôr na agenda" do cartão; local, sem token). */
export const inviteSuggestAddRequestSchema: z.ZodType<InviteSuggestAddRequest> = z
  .object({
    accountId: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
    id: z.string().min(1).max(1024).refine(oneLine),
    event: z
      .object({
        title: z.string().min(1).max(INVITE_SUGGEST_TITLE_MAX).refine(oneLine),
        date: z.string().regex(INVITE_SUGGEST_DATE_PATTERN).refine(realDay),
        time: z.string().regex(INVITE_SUGGEST_TIME_PATTERN),
        durationMinutes: z.number().int().min(INVITE_SUGGEST_DURATION_MIN).max(INVITE_SUGGEST_DURATION_MAX),
        url: z
          .string()
          .refine((value) => safeJoinUrl(value) !== null)
          .nullable(),
        calendarId: z.string().min(1).max(1024),
      })
      .strict(),
  })
  .strict()
