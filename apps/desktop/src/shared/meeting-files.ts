// Arquivos da reunião numa pasta do Mac (contrato 07): o que o renderer, o main e o smoke
// compartilham. O renderer grava o áudio em pedaços e pede ao main; quem escolhe a pasta, dá o nome,
// escreve e renomeia é sempre o main.

/** Formatos do gravador, em ordem de preferência: m4a toca no QuickTime; webm é a reserva. */
export const RECORDER_MIME_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus'] as const

export const AUDIO_EXTENSIONS = ['m4a', 'webm'] as const
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]

/** Um pedaço do áudio vai para o disco a cada 5 s: a reunião inteira nunca fica na memória. */
export const AUDIO_TIMESLICE_MS = 5_000
/** Ao encerrar, quanto se espera pelo último pedaço do gravador. */
export const AUDIO_STOP_WAIT_MS = 5_000
/** AAC/Opus mono a ~64 kbps: cerca de 30 MB por hora. */
export const AUDIO_BITS_PER_SECOND = 64_000
/** Maior pedaço aceito pelo main (5 s a 64 kbps são ~40 kB; folga larga para o gravador). */
export const AUDIO_CHUNK_MAX_BYTES = 16 * 1024 * 1024

/** Extensão do arquivo pelo formato que o gravador aceitou. */
export function audioExtension(mime: string): AudioExtension {
  return mime.startsWith('audio/mp4') ? 'm4a' : 'webm'
}

/** Primeiro formato da lista que o gravador aceita; `null` se nenhum. */
export function pickRecorderMime(isTypeSupported: (mime: string) => boolean): string | null {
  for (const mime of RECORDER_MIME_TYPES) {
    try {
      if (isTypeSupported(mime)) return mime
    } catch {
      // Formato que nem dá para consultar conta como não aceito.
    }
  }
  return null
}

/** Pasta atual: o caminho e o mesmo encurtado com `~` para a tela. */
export interface AudioFolderInfo {
  path: string
  display: string
}

/** Início da gravação: id da sessão de arquivos no main, ou falha (pasta que não dá para escrever). */
export type AudioBeginResult = { ok: true; id: string } | { ok: false; error: 'disabled' | 'unwritable' }

/** Encerrar: `ok` falso quando algo não foi escrito (o mesmo aviso da gravação). */
export interface AudioFinishResult {
  ok: boolean
  audioPath: string | null
  transcriptPath: string | null
}

export type MeetingFileKind = 'audio' | 'transcript'

/** "Baixar…" (contrato 08): os arquivos da pasta e o resumo, que vira `.md` na hora. */
export const MEETING_DOWNLOAD_KINDS = ['audio', 'transcript', 'summary'] as const
export type MeetingDownloadKind = (typeof MEETING_DOWNLOAD_KINDS)[number]
/** `missing`: o arquivo ou o texto não existe mais; `canceled`: o diálogo foi fechado sem salvar. */
export type MeetingDownloadResult = 'saved' | 'canceled' | 'missing' | 'failed'

export interface MeetingFileInfo {
  name: string
  exists: boolean
}

/** O que o detalhe mostra: a pasta (encurtada) e cada arquivo gravado, se ainda está lá. */
export interface MeetingFilesInfo {
  folder: string
  audio: MeetingFileInfo | null
  transcript: MeetingFileInfo | null
}
