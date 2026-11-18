// Transcrição e tradução: o que o renderer, o main e o teste real (`test:aai`) compartilham. A chave
// nunca aparece aqui — o renderer recebe só o token temporário de streaming.
import type { LanguageCode } from './settings-defaults'

export type TranscriptSource = 'mic' | 'system'

/** Palavra como a AssemblyAI devolve no turno (tempos em ms desde o início da sessão). */
export interface TranscriptWord {
  text: string
  start: number
  end: number
  speaker?: string | null
}

/** Trecho salvo da transcrição da reunião — exatamente o que vai para `meetings/<id>.json`. */
export interface TranscriptSegment {
  id: string
  source: TranscriptSource
  /** Rótulo do provedor (`A`, `B`, `UNKNOWN`) ou `null` enquanto pendente. */
  speaker: string | null
  startMs: number
  endMs: number
  text: string
  translation: string | null
  translationModel: string | null
  /**
   * Quem falava no Meet durante o trecho (contrato 27), em ordem de maior sobreposição. Só trechos do sistema;
   * ausente nos documentos antigos e quando a extensão não estava ligada.
   */
  names?: string[]
}

export type TranslationState = 'pending' | 'done' | 'unavailable'

/** Trecho em memória durante a gravação: o salvo mais o que a tela precisa e não é persistido. */
export interface RuntimeSegment extends TranscriptSegment {
  partial: boolean
  turnOrder: number
  sessionId: string
  translationState: TranslationState
  /**
   * Trecho final do microfone que repete a fala do sistema (eco do alto-falante, contrato 06). Só é
   * marcado com "Remover eco do alto-falante" ligado; marcado, some da tela, do arquivo e da tradução.
   * Ausente vale como `false`.
   */
  echo?: boolean
}

/** Arquivo de uma reunião, em `userData/meetings/<id>.json`. */
export interface TranscriptDocument {
  version: 1
  meetingId: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode | null
  translationModel: string | null
  segments: TranscriptSegment[]
}

export const TRANSCRIPT_VERSION = 1

/** Token temporário de streaming (CA1). Só estes dois campos chegam ao renderer. */
export type TranscriptionTokenResult =
  | { ok: true; token: string; expiresInSeconds: number }
  | { ok: false; error: 'no-key' | 'key-rejected' | 'network' | 'server' | 'format' }

/** Tradução avulsa de um trecho (CA9), quando o gateway não respondeu na própria conexão. */
export type TranslateTurnResult =
  | { ok: true; translation: string; model: string }
  | { ok: false; error: 'refused' | 'not-allowed' | 'network' | 'server' }

/** "Copiar transcrição": `missing` quando a reunião ou a transcrição não existe mais. */
export type TranscriptCopyResult = 'copied' | 'missing' | 'failed'

/** Validade do token temporário pedido ao main (a API aceita de 1 a 600 s). */
export const TOKEN_LIFETIME_SECONDS = 60

export const ENGLISH_LANGUAGE_NAMES: Readonly<Record<LanguageCode, string>> = {
  pt: 'Portuguese',
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
}

/**
 * Instrução da tradução, usada na conexão (`llm_gateway`) e na chamada avulsa do CA9: precisa ser a
 * mesma nos dois caminhos. Nomeia origem e destino por extenso em inglês e pede só a tradução.
 * `{{turn}}` é substituído pela AssemblyAI na conexão e por nós na chamada direta.
 */
export function translationPrompt(source: LanguageCode, target: LanguageCode): string {
  return [
    `Translate the following ${ENGLISH_LANGUAGE_NAMES[source]} transcript to ${ENGLISH_LANGUAGE_NAMES[target]}.`,
    'Reply with the translation only, without commentary.',
    '',
    '{{turn}}',
  ].join('\n')
}

/** Mesma instrução, já com o texto do trecho (chamada direta a `/v1/chat/completions`). */
export function translationMessage(source: LanguageCode, target: LanguageCode, text: string): string {
  return translationPrompt(source, target).replace('{{turn}}', text)
}

/**
 * Rótulo de quem fala (CA5): microfone é sempre você; no áudio do sistema, a letra do provedor vira
 * "Participante A". Sem rótulo, pendente (`PENDING`) ou desconhecido: "Participantes".
 */
export function speakerLabel(source: TranscriptSource, label: string | null | undefined): string {
  if (source === 'mic') return 'Você'
  const value = typeof label === 'string' ? label.trim().toUpperCase() : ''
  if (/^[A-Z]$/.test(value)) return `Participante ${value}`
  return 'Participantes'
}

/** Até quantos nomes um trecho guarda e o tamanho de cada um (contrato 27). */
export const SEGMENT_NAMES_MAX = 4
export const SEGMENT_NAME_MAX = 80

/** Nomes do Meet de um trecho, numa linha só cada um, cortados em 80 caracteres, sem vazio e no máximo 4. */
export function segmentNames(names: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(names)) return []
  return names
    .map((name) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, SEGMENT_NAME_MAX).trim() : ''))
    .filter(Boolean)
    .slice(0, SEGMENT_NAMES_MAX)
}

/**
 * Rótulo de um trecho (contrato 27): com os nomes do Meet, "Ana" ou "Ana + Bruno"; sem nomes, o de
 * `speakerLabel`. Microfone é sempre "Você".
 */
export function segmentLabel(segment: { source: TranscriptSource; speaker: string | null | undefined; names?: readonly string[] | null | undefined }): string {
  if (segment.source === 'mic') return 'Você'
  const names = segmentNames(segment.names)
  return names.length ? names.join(' + ') : speakerLabel(segment.source, segment.speaker)
}

/** Início e fim do trecho no relógio da gravação (CA6): deslocamento da sessão + tempo da palavra. */
export function stitchedSpan(offsetMs: number, words: readonly TranscriptWord[]): { startMs: number; endMs: number } {
  const start = words[0]?.start ?? 0
  const end = words.at(-1)?.end ?? start
  // O relógio da gravação vem de `performance.now()`, com fração de ms; o arquivo salvo exige inteiros.
  return { startMs: Math.round(offsetMs + start), endMs: Math.round(offsetMs + end) }
}

/** `00:12`, `1:02:09` — o mesmo formato do cronômetro, para a calha e o Markdown. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
