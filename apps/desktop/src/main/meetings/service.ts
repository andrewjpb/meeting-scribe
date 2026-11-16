// O que a tela de detalhe pede da transcrição salva: ler, salvar e copiar como Markdown, e excluir a
// reunião com o que é dela no `userData`. Sem Electron: o clipboard chega injetado (o app usa
// `clipboard.writeText`; os testes, um array em memória).
import { transcriptMarkdown } from '../../shared/transcript-markdown'
import type { TranscriptCopyResult, TranscriptDocument } from '../../shared/transcription'
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
  clipboard: ClipboardWriter
}

export interface MeetingsService {
  saveTranscript(document: TranscriptDocument): Promise<void>
  getTranscript(meetingId: string): Promise<TranscriptDocument | null>
  /** Lê a reunião e a transcrição e põe o Markdown na área de transferência. */
  copyTranscript(meetingId: string): Promise<TranscriptCopyResult>
  /**
   * Exclui a reunião e apaga a transcrição e o resumo internos dela. Os arquivos da pasta ficam
   * (contratos 07 e 08).
   */
  deleteMeeting(id: string): Promise<boolean>
}

export function createMeetingsService({ meetings, transcripts, summaries, clipboard }: MeetingsServiceDeps): MeetingsService {
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

    async deleteMeeting(id) {
      const removed = await meetings.remove(id)
      if (removed) await Promise.all([transcripts.remove(id), summaries.remove(id)])
      return removed
    },
  }
}
