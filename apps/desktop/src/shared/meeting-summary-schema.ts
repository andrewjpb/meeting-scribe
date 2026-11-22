// Esquema zod do resumo da reunião (contrato 08, CA1). Separado de `meeting-summary.ts` para o renderer,
// que só usa os tipos e o Markdown, não carregar o zod. O main valida a resposta do Claude com
// `summaryContentSchema` e o arquivo `meetings/<id>.summary.json` com `meetingSummarySchema`.
import { z } from 'zod'
import { SUMMARY_ITEMS_MAX, SUMMARY_OVERVIEW_MAX, SUMMARY_TEXT_MAX, SUMMARY_VERSION, type MeetingSummary, type SummaryContent } from './meeting-summary'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const item = z.string().trim().min(1).max(SUMMARY_TEXT_MAX)
/** Quem faz e prazo: texto vazio vale como "ninguém apontado" / "sem prazo". */
const optionalItem = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), item.nullable())

/** `AAAA-MM-DD` de uma data que existe no calendário. */
function isoDay(value: unknown): value is string {
  const parts = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!parts) return false
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  return date.toISOString().slice(0, 10) === value
}
/** Prazo em `AAAA-MM-DD` (contrato 121, D13): qualquer outra coisa vira `null` e nunca reprova o resumo; ausente fica ausente. */
const dueIso = z.preprocess((value) => (isoDay(value) ? value : null), z.string().nullable()).exactOptional()

export const summaryContentSchema = z.object({
  overview: z.string().trim().min(1).max(SUMMARY_OVERVIEW_MAX),
  decisions: z.array(item).max(SUMMARY_ITEMS_MAX),
  tasks: z.array(z.object({ task: item, owner: optionalItem, due: optionalItem, dueIso })).max(SUMMARY_ITEMS_MAX),
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
