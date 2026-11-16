// O que a tela de detalhe pede da transcrição salva e das anotações (contrato 13): ler, salvar e copiar
// como Markdown, e excluir a reunião com o que é dela no `userData`. Sem Electron: o clipboard chega
// injetado (o app usa `clipboard.writeText`; os testes, um array em memória).
import { z } from 'zod'
import { notesMarkdown, type MeetingNote } from '../../shared/meeting-notes'
import { transcriptMarkdown } from '../../shared/transcript-markdown'
import type { TranscriptCopyResult, TranscriptDocument } from '../../shared/transcription'
import type { NotesStore } from './notes'
import type { MeetingsStore } from './store'
import type { SummaryStore } from './summaries'
import type { TranscriptStore } from './transcripts'

export interface ClipboardWriter {
  writeText(text: string): void
}

export interface MeetingsServiceDeps {
  meetings: MeetingsStore
  transcripts: TranscriptStore
  /** Resumo interno da reunião (contrato 08); excluir a reunião apaga junto. */
  summaries: Pick<SummaryStore, 'remove'>
  /** Anotações da reunião (contrato 13); excluir a reunião apaga junto. */
  notes?: NotesStore
  /** Análises da reunião (contrato 19); excluir a reunião cancela a que estiver em curso e apaga o arquivo. */
  analyses?: { remove(meetingId: string): Promise<void> }
  /** Conversas do chat ligadas à reunião e o `.md` dela no acervo (contrato 15); excluir a reunião apaga junto. */
  chats?: { removeMeeting(meetingId: string): Promise<void> }
  clipboard: ClipboardWriter
}

export interface MeetingsService {
  saveTranscript(document: TranscriptDocument): Promise<void>
  getTranscript(meetingId: string): Promise<TranscriptDocument | null>
  /** Lê a reunião e a transcrição e põe o Markdown na área de transferência. */
  copyTranscript(meetingId: string): Promise<TranscriptCopyResult>
  /** Anotações da reunião; reunião que não existe ou pedido inválido: lista vazia. */
  getNotes(meetingId: unknown): Promise<MeetingNote[]>
  /**
   * Grava a lista inteira de anotações. Só para reunião que existe: falso quando ela não existe; lista
   * inválida (mais de 200, texto acima de 2 000 caracteres, cor desconhecida) lança.
   */
  saveNotes(request: unknown): Promise<boolean>
  /** "Copiar anotações": o mesmo Markdown do `.md` da pasta. */
  copyNotes(meetingId: unknown): Promise<TranscriptCopyResult>
  /**
   * Exclui a reunião e apaga a transcrição, o resumo, as anotações, as análises e as conversas do chat internos dela.
   * Os arquivos da pasta ficam (contratos 07 e 08).
   */
  deleteMeeting(id: string): Promise<boolean>
}

const meetingIdSchema = z.string().min(1).max(200)
const saveNotesSchema = z.object({ meetingId: meetingIdSchema, notes: z.array(z.unknown()) })

export function createMeetingsService({ meetings, transcripts, summaries, notes, analyses, chats, clipboard }: MeetingsServiceDeps): MeetingsService {
  return {
    saveTranscript: (document) => transcripts.save(document),
    getTranscript: (meetingId) => transcripts.get(meetingId),

    async copyTranscript(meetingId) {
      // A reunião precisa existir: transcrição órfã não vira texto na área de transferência.
      const meeting = await meetings.get(meetingId)
      if (!meeting) return 'missing'
      const document = await transcripts.get(meetingId)
      if (!document || document.segments.length === 0) return 'missing'
      try {
        clipboard.writeText(transcriptMarkdown({ title: meeting.title, startedAt: meeting.startedAt, durationMs: meeting.durationMs }, document))
        return 'copied'
      } catch {
        return 'failed'
      }
    },

    async getNotes(input) {
      const meetingId = meetingIdSchema.safeParse(input)
      if (!meetingId.success || !notes || !(await meetings.get(meetingId.data))) return []
      return notes.get(meetingId.data)
    },

    async saveNotes(request) {
      const { meetingId, notes: list } = saveNotesSchema.parse(request)
      if (!notes || !(await meetings.get(meetingId))) return false
      await notes.save(meetingId, list as MeetingNote[])
      return true
    },

    async copyNotes(input) {
      const meetingId = meetingIdSchema.safeParse(input)
      if (!meetingId.success || !notes || !(await meetings.get(meetingId.data))) return 'missing'
      const markdown = notesMarkdown(await notes.get(meetingId.data))
      if (!markdown) return 'missing'
      try {
        clipboard.writeText(markdown)
        return 'copied'
      } catch {
        return 'failed'
      }
    },

    async deleteMeeting(id) {
      const removed = await meetings.remove(id)
      if (removed) await Promise.all([transcripts.remove(id), summaries.remove(id), notes?.remove(id), analyses?.remove(id), chats?.removeMeeting(id)])
      return removed
    },
  }
}
