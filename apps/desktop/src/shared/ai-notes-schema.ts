// Esquema zod do pedido da IA anotando ao vivo (contrato 30). Separado de `ai-notes.ts` para o renderer, que só usa
// os tipos, não carregar o zod. O main valida com ele o que chega por `scribe:ai-notes-run`.
import { z } from 'zod'
import { AI_NOTES_OPEN_MAX, AI_NOTES_TITLES_MAX, type AiNotesRunRequest } from './ai-notes'
import { liveSegmentSchema } from './meeting-analysis-schema'
import { NOTE_TEXT_MAX, NOTE_TITLE_MAX } from './meeting-notes'

export const aiNotesRunRequestSchema = z
  .object({
    recordingId: z.string().min(1).max(100),
    // Os mesmos trechos do pedido de "Analisar até agora".
    segments: z.array(liveSegmentSchema).max(20_000),
    openCards: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().max(NOTE_TITLE_MAX), text: z.string().max(NOTE_TEXT_MAX) }).strict()).max(AI_NOTES_OPEN_MAX),
    knownTitles: z.array(z.string().max(NOTE_TITLE_MAX)).max(AI_NOTES_TITLES_MAX),
  })
  .strict()

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const requestMatches: Same<z.output<typeof aiNotesRunRequestSchema>, AiNotesRunRequest> = true
void requestMatches
