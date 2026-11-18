// Esquema zod da análise da reunião (contrato 19, CA1). Separado de `meeting-analysis.ts` para o renderer,
// que só usa os tipos e o Markdown, não carregar o zod. O main valida o arquivo
// `meetings/<id>.analyses.json`, o pedido da gravação e a análise que volta do renderer ao encerrar.
import { z } from 'zod'
import {
  ANALYSES_MAX,
  ANALYSES_VERSION,
  ANALYSIS_ITEMS_MAX,
  ANALYSIS_TEXT_MAX,
  ANSWERABLE_SECTIONS,
  type AnalysisContent,
  type LiveAnalysisRequest,
  type MeetingAnalysesFile,
  type MeetingAnalysis,
} from './meeting-analysis'
import { SEGMENT_NAME_MAX, SEGMENT_NAMES_MAX } from './transcription'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const text = z.string().trim().min(1).max(ANALYSIS_TEXT_MAX)
const time = z.number().int().nonnegative()
const list = <T extends z.ZodType>(item: T) => z.array(item).max(ANALYSIS_ITEMS_MAX)

export const analysisContentSchema = z.object({
  openQuestions: list(z.object({ text, context: text.optional(), atMs: time.optional() })),
  unclearTopics: list(z.object({ topic: text, why: text, atMs: time.optional() })),
  toConfirm: list(z.object({ text, owner: text.optional() })),
  suggestedQuestions: list(text),
  answered: z.array(z.object({ analysisId: z.string().min(1).max(100), section: z.enum(ANSWERABLE_SECTIONS), index: z.number().int().min(0).max(ANALYSIS_ITEMS_MAX - 1) })).max(ANALYSIS_ITEMS_MAX * 3 * ANALYSES_MAX),
})

export const meetingAnalysisSchema = analysisContentSchema.extend({
  id: z.string().min(1).max(100),
  meetingId: z.string().min(1).max(200).nullable(),
  createdAt: isoDate,
  atMs: time,
  model: z.string().min(1).max(200),
  costUsd: z.number().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
})

export const meetingAnalysesSchema = z
  .array(meetingAnalysisSchema)
  .max(ANALYSES_MAX)
  .refine((analyses) => new Set(analyses.map((analysis) => analysis.id)).size === analyses.length, 'id repetido')

export const meetingAnalysesFileSchema = z.object({
  version: z.literal(ANALYSES_VERSION),
  meetingId: z.string().min(1).max(200),
  analyses: meetingAnalysesSchema,
})

/** Trecho final que a gravação manda: o texto de um trecho cabe folgado em 20 000 caracteres. */
export const liveSegmentSchema = z.object({
  source: z.enum(['mic', 'system']),
  speaker: z.string().max(20).nullable(),
  startMs: time,
  endMs: time,
  text: z.string().max(20_000),
  names: z.array(z.string().max(SEGMENT_NAME_MAX)).max(SEGMENT_NAMES_MAX).exactOptional(),
})

export const liveAnalysisRequestSchema = z
  .object({
    recordingId: z.string().min(1).max(100),
    atMs: time,
    segments: z.array(liveSegmentSchema).max(20_000),
    notes: z.array(z.object({ text: z.string().max(2_000), atMs: time.nullable(), createdAt: isoDate })).max(200),
    previous: meetingAnalysesSchema,
  })
  .strict()

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const contentMatches: Same<z.output<typeof analysisContentSchema>, AnalysisContent> = true
const analysisMatches: Same<z.output<typeof meetingAnalysisSchema>, MeetingAnalysis> = true
const fileMatches: Same<z.output<typeof meetingAnalysesFileSchema>, MeetingAnalysesFile> = true
const requestMatches: Same<z.output<typeof liveAnalysisRequestSchema>, LiveAnalysisRequest> = true
void contentMatches
void analysisMatches
void fileMatches
void requestMatches
