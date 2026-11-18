// IA anotando ao vivo (contrato 30): com o interruptor "IA anotando" ligado, a cada 5 minutos de gravação o
// renderer manda ao main só os trechos finais novos e os cards abertos que a própria IA criou; a resposta traz
// cards novos (título e descrição) e os abertos que a conversa resolveu, com o motivo. A IA nunca apaga nem edita
// texto: o renderer aplica o lote só nos cards dela que a pessoa não mexeu. O esquema zod do pedido está em
// `ai-notes-schema.ts` (o renderer não carrega o zod).
import type { LiveAnalysisSegment } from './meeting-analysis'

/** Intervalo entre os ciclos, no relógio da gravação (sem as pausas). */
export const AI_NOTES_INTERVAL_MS = 300_000
/** Menos que isso de fala nova desde o último ciclo: o ciclo é pulado (não gasta IA). */
export const AI_NOTES_MIN_CHARS = 200
/** Cards abertos da IA que vão no pedido. */
export const AI_NOTES_OPEN_MAX = 50
/** Títulos de todos os cards, para a IA não repetir assunto. */
export const AI_NOTES_TITLES_MAX = 200
/** Cards novos por ciclo; o que passar é cortado. */
export const AI_NOTES_NEW_MAX = 5
/** Cards resolvidos por ciclo; o que passar é cortado. */
export const AI_NOTES_RESOLVED_MAX = 10
export const AI_NOTE_DESCRIPTION_MAX = 500

/** Card aberto da IA, como vai no pedido. */
export interface AiNotesOpenCard {
  id: string
  title: string
  text: string
}

/** Pedido de um ciclo: tudo o que ainda está só na memória do renderer. */
export interface AiNotesRunRequest {
  /** Id da gravação (o mesmo da análise ao vivo): o ciclo de uma gravação nunca cai em outra. */
  recordingId: string
  /** Só os trechos finais novos desde o último ciclo. */
  segments: LiveAnalysisSegment[]
  /** Cards da IA abertos e não mexidos pela pessoa (até `AI_NOTES_OPEN_MAX`). */
  openCards: AiNotesOpenCard[]
  /** Títulos de todos os cards (até `AI_NOTES_TITLES_MAX`). */
  knownTitles: string[]
}

export interface AiNotesNewCard {
  title: string
  description: string
  /** Momento da fala de onde veio, quando a resposta trouxe. */
  atMs?: number
}

export interface AiNotesResolved {
  /** Sempre um dos `openCards` do pedido: o main descarta os outros. */
  id: string
  reason: string
}

/** Resposta lida e validada de um ciclo. */
export interface AiNotesBatch {
  created: AiNotesNewCard[]
  resolved: AiNotesResolved[]
}

/** `empty`: nenhum trecho com texto no pedido. Os outros, como na análise ao vivo. */
export type AiNotesError = 'not-found' | 'timeout' | 'format' | 'failed' | 'agent' | 'empty'

export type AiNotesRunResult = { ok: true; batch: AiNotesBatch; model: string; costUsd: number | null; durationMs: number } | { ok: false; error: AiNotesError }
