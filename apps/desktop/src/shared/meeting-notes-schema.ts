// Esquema zod das anotações da reunião (contrato 13, CA1). Separado de `meeting-notes.ts` para o renderer,
// que só usa os tipos e o Markdown, não carregar o zod. O main valida o pedido de salvar e o arquivo
// `meetings/<id>.notes.json` com estes esquemas.
import { z } from 'zod'
import { NOTE_COLORS, NOTE_TEXT_MAX, NOTES_MAX, NOTES_VERSION, type MeetingNote, type MeetingNotesFile } from './meeting-notes'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')

export const meetingNoteSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().max(NOTE_TEXT_MAX),
  color: z.enum(NOTE_COLORS),
  atMs: z.number().int().nonnegative().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const meetingNotesSchema = z
  .array(meetingNoteSchema)
  .max(NOTES_MAX)
  .refine((notes) => new Set(notes.map((note) => note.id)).size === notes.length, 'id repetido')

export const meetingNotesFileSchema = z.object({
  version: z.literal(NOTES_VERSION),
  meetingId: z.string().min(1).max(200),
  notes: meetingNotesSchema,
})

// O tipo escrito à mão e o que o esquema produz têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const noteMatches: Same<z.output<typeof meetingNoteSchema>, MeetingNote> = true
const fileMatches: Same<z.output<typeof meetingNotesFileSchema>, MeetingNotesFile> = true
void noteMatches
void fileMatches
