// Esquema zod dos "Detalhes" do WhatsApp (contrato 32). Separado de `whatsapp-insights.ts` para o renderer, que só
// usa os tipos, não carregar o zod. O main valida a resposta do Claude (depois de cortar nos limites) e o
// `whatsapp/insights.json` na leitura.
import { z } from 'zod'
import {
  INSIGHTS_CACHE_MAX,
  INSIGHTS_COMMITMENTS_MAX,
  INSIGHTS_ITEM_MAX,
  INSIGHTS_MOOD_DAYS_MAX,
  INSIGHTS_MOOD_WHY_MAX,
  INSIGHTS_MOODS,
  INSIGHTS_PENDING_MAX,
  INSIGHTS_POINTS_MAX,
  INSIGHTS_SUMMARY_MAX,
  INSIGHTS_WHEN_MAX,
  type WhatsAppInsights,
  type WhatsAppInsightsCache,
  type WhatsAppInsightsContent,
} from './whatsapp-insights'

const item = z.string().trim().min(1).max(INSIGHTS_ITEM_MAX)
const mood = z.enum(INSIGHTS_MOODS)

export const insightsContentSchema = z
  .object({
    resumo: z.string().trim().min(1).max(INSIGHTS_SUMMARY_MAX),
    pontos: z.array(item).max(INSIGHTS_POINTS_MAX),
    humor: z.object({ valor: mood, justificativa: z.string().trim().max(INSIGHTS_MOOD_WHY_MAX) }).strict(),
    humorDias: z
      .array(
        z
          .object({
            dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            valor: mood,
          })
          .strict(),
      )
      .max(INSIGHTS_MOOD_DAYS_MAX),
    pendencias: z.object({ minhas: z.array(item).max(INSIGHTS_PENDING_MAX), deles: z.array(item).max(INSIGHTS_PENDING_MAX) }).strict(),
    compromissos: z.array(z.object({ texto: item, quando: z.string().trim().min(1).max(INSIGHTS_WHEN_MAX).optional() }).strict()).max(INSIGHTS_COMMITMENTS_MAX),
  })
  .strict()

export const insightsSchema = insightsContentSchema
  .extend({
    chatId: z.string().min(1).max(200),
    at: z.number().int().nonnegative(),
    createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida'),
    messages: z.number().int().nonnegative(),
    model: z.string().min(1).max(200),
    costUsd: z.number().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict()

export const insightsCacheSchema = z
  .record(z.string().min(1).max(200), z.object({ at: z.number().int().nonnegative(), result: insightsSchema }).strict())
  .refine((cache) => Object.keys(cache).length <= INSIGHTS_CACHE_MAX, 'conversas demais')

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const contentMatches: Same<z.output<typeof insightsContentSchema>, WhatsAppInsightsContent> = true
const insightsMatches: Same<z.output<typeof insightsSchema>, WhatsAppInsights> = true
const cacheMatches: Same<z.output<typeof insightsCacheSchema>, WhatsAppInsightsCache> = true
void contentMatches
void insightsMatches
void cacheMatches
