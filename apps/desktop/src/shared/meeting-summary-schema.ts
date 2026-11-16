// Esquema zod do resumo da reunião (contrato 08, CA1). Separado de `meeting-summary.ts` para o renderer,
// que só usa os tipos e o Markdown, não carregar o zod. O main valida a resposta do Claude com
// `summaryContentSchema` e o arquivo `meetings/<id>.summary.json` com `meetingSummarySchema`.
import { z } from 'zod'
import { SUMMARY_ITEMS_MAX, SUMMARY_OVERVIEW_MAX, SUMMARY_TEXT_MAX, SUMMARY_VERSION, type MeetingSummary, type SummaryContent } from './meeting-summary'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const item = z.string().trim().min(1).max(SUMMARY_TEXT_MAX)
/** Quem faz e prazo: texto vazio vale como "ninguém apontado" / "sem prazo". */
const optionalItem = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), item.nullable())

export const summaryContentSchema = z.object({
  overview: z.string().trim().min(1).max(SUMMARY_OVERVIEW_MAX),
  decisions: z.array(item).max(SUMMARY_ITEMS_MAX),
  tasks: z.array(z.object({ task: item, owner: optionalItem, due: optionalItem })).max(SUMMARY_ITEMS_MAX),
})

export const meetingSummarySchema = summaryContentSchema.extend({
  version: z.literal(SUMMARY_VERSION),
  meetingId: z.string().min(1).max(200),
  createdAt: isoDate,
  model: z.string().min(1).max(200),
})

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const contentMatches: Same<z.output<typeof summaryContentSchema>, SummaryContent> = true
const summaryMatches: Same<z.output<typeof meetingSummarySchema>, MeetingSummary> = true
void contentMatches
void summaryMatches
