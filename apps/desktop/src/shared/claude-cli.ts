// Tradução pelo `claude` instalado na máquina (contrato 05): o que o renderer e o main trocam. O processo
// roda só no main; o renderer manda o texto de cada trecho final e recebe a tradução de volta.
import type { TranscriptSource } from './transcription'

/** Onde o `claude` está e qual versão respondeu a `claude --version`. */
export type ClaudeLocateResult = { ok: true; path: string; version: string } | { ok: false; error: 'not-found' }

/** Início da gravação: o processo já abre (aquece) antes do primeiro trecho. */
export type ClaudeStartResult = { ok: true; version: string } | { ok: false; error: 'not-found' | 'disabled' }

/** Um trecho final para traduzir. `source` e `turnOrder` identificam o trecho junto com `segmentId`. */
export interface ClaudeTranslateRequest {
  segmentId: string
  source: TranscriptSource
  turnOrder: number
  text: string
}

/**
 * `timeout`: sem resposta em 10 s; `error`: o Claude respondeu com erro; `stopped`: o processo parou de vez
 * (ou a gravação acabou antes); `not-running`: nenhum processo aberto para esta gravação.
 */
export type ClaudeTranslateResult =
  | { ok: true; translation: string; model: string }
  | { ok: false; error: 'timeout' | 'error' | 'stopped' | 'not-running' }

/**
 * Estado do processo durante a gravação. `stopped` mostra o aviso de que o Claude CLI parou; `agent-failed`
 * (contrato 17), que o agente do ACP não abriu, com "Usar a linha de comando".
 */
export type ClaudeRunState = 'running' | 'restarting' | 'stopped' | 'agent-failed'
