// Registro de reunião (N4 da spec): o que o main guarda em `meetings.json` e o renderer mostra.

export interface MeetingSources {
  mic: boolean
  system: boolean
}

export interface Meeting {
  id: string
  title: string
  /** ISO 8601. */
  startedAt: string
  /** Tempo gravado, sem contar pausas. */
  durationMs: number
  /** Fontes que entregaram som durante a gravação. */
  sources: MeetingSources
  /** Arquivo de áudio salvo na pasta da reunião (contrato 07); `null` sem arquivo. Só o main grava. */
  audioPath: string | null
  /** Transcrição em Markdown salva na mesma pasta; `null` sem arquivo. Só o main grava. */
  transcriptPath: string | null
}

/** O que o renderer manda ao criar: os caminhos dos arquivos ficam com o main. */
export type NewMeeting = Omit<Meeting, 'id' | 'audioPath' | 'transcriptPath'>

/** Caminhos dos arquivos da reunião, gravados pelo main ao encerrar. */
export type MeetingFilePaths = Pick<Meeting, 'audioPath' | 'transcriptPath'>

export const MEETING_TITLE_MAX = 200

const pad = (value: number): string => String(value).padStart(2, '0')

/** Título padrão: "Reunião de DD/MM HH:mm", no fuso local. */
export function defaultMeetingTitle(startedAt: Date): string {
  return `Reunião de ${pad(startedAt.getDate())}/${pad(startedAt.getMonth() + 1)} ${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}`
}
