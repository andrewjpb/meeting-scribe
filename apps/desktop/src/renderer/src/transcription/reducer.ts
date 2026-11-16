// Redutor puro da transcrição (CA4): só o estado anterior e uma mensagem da AssemblyAI entram; sai o
// estado novo, sem efeito colateral. É o mesmo código usado no app, no teste real (`test:aai`) e no
// smoke, para não haver duas leituras das mensagens.
//
// Formatos reais (14/11/2026): `Turn` tem `turn_order`, `end_of_turn`, `transcript`, `words` e
// `speaker_label` (ausente nos parciais); `LLMGatewayResponse` traz `turn_order`,
// `data.model` e `data.choices[0].message.content`; `SpeakerRevision` traz
// `revisions: [{turn_order, speaker_label}]`.
import {
  stitchedSpan,
  type RuntimeSegment,
  type TranscriptSegment,
  type TranscriptSource,
  type TranscriptWord,
} from '../../../shared/transcription'
import { ECHO_SLACK_MS, SystemWindow } from './echo'

/** Uma mensagem já com a origem e a sessão dela: cada fonte abre conexões próprias, com turnos e
 *  tempos que recomeçam do zero. */
export type { RuntimeSegment }

export interface StreamEnvelope {
  source: TranscriptSource
  sessionId: string
  /** Tempo da gravação em que a sessão começou (CA6). */
  offsetMs: number
  message: unknown
}

export interface PendingTranslation {
  translation: string
  model: string | null
}

export interface TranscriptState {
  segments: RuntimeSegment[]
  /** Tradução que chegou antes do turno final, por chave de turno. */
  pendingTranslations: Record<string, PendingTranslation>
}

export const emptyTranscriptState = (): TranscriptState => ({ segments: [], pendingTranslations: {} })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const turnKey = (source: TranscriptSource, sessionId: string, turnOrder: number): string => `${source}:${sessionId}:${turnOrder}`

export const segmentIdOf = (source: TranscriptSource, sessionId: string, turnOrder: number): string => `${source}-${sessionId}-${turnOrder}`

function wordsOf(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return []
  return value.filter((word): word is TranscriptWord => isRecord(word) && typeof word['text'] === 'string' && typeof word['start'] === 'number' && typeof word['end'] === 'number')
}

/** Ordena por início; empate mantém a ordem em que chegaram. */
function sorted(segments: RuntimeSegment[]): RuntimeSegment[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.startMs - b.segment.startMs || a.index - b.index)
    .map(({ segment }) => segment)
}

function replace(state: TranscriptState, key: string, next: RuntimeSegment): TranscriptState {
  const index = state.segments.findIndex((segment) => turnKey(segment.source, segment.sessionId, segment.turnOrder) === key)
  const segments = index === -1 ? [...state.segments, next] : state.segments.map((segment, i) => (i === index ? next : segment))
  return { ...state, segments: sorted(segments) }
}

function applyTurn(state: TranscriptState, envelope: StreamEnvelope, message: Record<string, unknown>): TranscriptState {
  const turnOrder = message['turn_order']
  const transcript = message['transcript']
  if (typeof turnOrder !== 'number' || !Number.isInteger(turnOrder) || typeof transcript !== 'string') return state
  const final = message['end_of_turn'] === true
  const words = wordsOf(message['words'])
  const key = turnKey(envelope.source, envelope.sessionId, turnOrder)
  const existingIndex = state.segments.findIndex((segment) => turnKey(segment.source, segment.sessionId, segment.turnOrder) === key)
  const existing = existingIndex === -1 ? null : (state.segments[existingIndex] as RuntimeSegment)

  // Parcial atrasado depois do final não desfaz o trecho fechado.
  if (!final && existing && !existing.partial) return state

  const rawSpeaker = typeof message['speaker_label'] === 'string' ? message['speaker_label'] : null
  const wordSpeaker = words.find((word) => typeof word.speaker === 'string' && word.speaker !== '')?.speaker ?? null
  const span = stitchedSpan(envelope.offsetMs, words.length ? words : [{ text: '', start: existing?.startMs ?? 0, end: existing?.endMs ?? 0 }])
  const pending = state.pendingTranslations[key] ?? null
  const translation = final && pending ? pending.translation : existing?.translation ?? null
  const translationModel = final && pending ? pending.model : existing?.translationModel ?? null

  const segment: RuntimeSegment = {
    id: segmentIdOf(envelope.source, envelope.sessionId, turnOrder),
    source: envelope.source,
    // Parcial ainda não tem falante: o rótulo chega no turno final ou numa revisão.
    speaker: final ? rawSpeaker ?? wordSpeaker ?? existing?.speaker ?? null : existing?.speaker ?? null,
    startMs: span.startMs,
    endMs: span.endMs,
    text: transcript,
    translation,
    translationModel,
    partial: !final,
    turnOrder,
    sessionId: envelope.sessionId,
    translationState: translation ? 'done' : 'pending',
  }
  const next = replace(state, key, segment)
  if (final && pending) {
    const { [key]: _used, ...rest } = next.pendingTranslations
    return { ...next, pendingTranslations: rest }
  }
  return next
}

function applyTranslation(state: TranscriptState, envelope: StreamEnvelope, message: Record<string, unknown>): TranscriptState {
  const turnOrder = message['turn_order']
  if (typeof turnOrder !== 'number' || !Number.isInteger(turnOrder)) return state
  const data = message['data']
  if (!isRecord(data)) return state
  const choices = Array.isArray(data['choices']) ? data['choices'] : []
  const first = choices[0]
  const content = isRecord(first) && isRecord(first['message']) && typeof first['message']['content'] === 'string' ? first['message']['content'].trim() : ''
  if (!content) return state
  const model = typeof data['model'] === 'string' ? data['model'] : null
  const key = turnKey(envelope.source, envelope.sessionId, turnOrder)
  const index = state.segments.findIndex((segment) => turnKey(segment.source, segment.sessionId, segment.turnOrder) === key)
  // Chegou antes do turno final: guarda para quando ele chegar, mesmo fora de ordem.
  if (index === -1) return { ...state, pendingTranslations: { ...state.pendingTranslations, [key]: { translation: content, model } } }
  const segments = state.segments.map((segment, i) => (i === index ? { ...segment, translation: content, translationModel: model, translationState: 'done' as const } : segment))
  return { ...state, segments }
}

function applySpeakerRevision(state: TranscriptState, envelope: StreamEnvelope, message: Record<string, unknown>): TranscriptState {
  const revisions = Array.isArray(message['revisions']) ? message['revisions'] : []
  let segments = state.segments
  for (const revision of revisions) {
    if (!isRecord(revision)) continue
    const turnOrder = revision['turn_order']
    if (typeof turnOrder !== 'number') continue
    const label = typeof revision['speaker_label'] === 'string' ? revision['speaker_label'] : null
    const key = turnKey(envelope.source, envelope.sessionId, turnOrder)
    segments = segments.map((segment) => (turnKey(segment.source, segment.sessionId, segment.turnOrder) === key ? { ...segment, speaker: label } : segment))
  }
  return segments === state.segments ? state : { ...state, segments }
}

export interface ApplyOptions {
  /** "Remover eco do alto-falante" (contrato 06). Desligado (padrão), nenhum trecho é marcado. */
  removeEcho?: boolean
}

interface Span {
  startMs: number
  endMs: number
}

const isMicFinal = (segment: RuntimeSegment): boolean => segment.source === 'mic' && !segment.partial

/**
 * Refaz a marca de eco dos trechos finais do microfone (contrato 06, CA3). Com `touched`, só os
 * trechos do microfone cuja janela cruza um desses intervalos são reavaliados (o resto não pode ter
 * mudado); sem ele, todos (troca da configuração no meio da gravação). Desligado, tira todas as marcas.
 * O trecho do sistema nunca muda (CA6); quem não mudou de marca continua o mesmo objeto.
 */
export function applyEcho(state: TranscriptState, enabled: boolean, touched?: readonly Span[]): TranscriptState {
  if (!enabled) {
    if (!state.segments.some((segment) => segment.echo)) return state
    return { ...state, segments: state.segments.map((segment) => (segment.echo ? { ...segment, echo: false } : segment)) }
  }
  const affected = (segment: RuntimeSegment): boolean =>
    !touched || touched.some((span) => span.startMs <= segment.endMs + ECHO_SLACK_MS && span.endMs >= segment.startMs - ECHO_SLACK_MS)
  let window: SystemWindow<RuntimeSegment> | null = null
  let changed = false
  const segments = state.segments.map((segment) => {
    if (segment.source !== 'mic') return segment
    let echo = segment.echo === true
    // Parcial do microfone nunca é marcado.
    if (!isMicFinal(segment)) echo = false
    else if (affected(segment)) {
      window ??= new SystemWindow(state.segments.filter((item) => item.source === 'system'))
      echo = window.match(segment).echo
    }
    if (echo === (segment.echo === true)) return segment
    changed = true
    return { ...segment, echo }
  })
  return changed ? { ...state, segments } : state
}

/** Turno aplicado e, com a remoção de eco ligada, a marca refeita perto do trecho que mudou. */
function applyTurnWithEcho(state: TranscriptState, envelope: StreamEnvelope, message: Record<string, unknown>, removeEcho: boolean): TranscriptState {
  const next = applyTurn(state, envelope, message)
  if (!removeEcho || next === state) return next
  const turnOrder = message['turn_order'] as number
  const key = turnKey(envelope.source, envelope.sessionId, turnOrder)
  const before = state.segments.find((segment) => turnKey(segment.source, segment.sessionId, segment.turnOrder) === key)
  const after = next.segments.find((segment) => turnKey(segment.source, segment.sessionId, segment.turnOrder) === key)
  // O intervalo antigo também: um trecho do sistema que mudou de lugar pode deixar de cobrir um do microfone.
  const touched = [before, after].filter((segment): segment is RuntimeSegment => segment !== undefined)
  return applyEcho(next, true, touched)
}

/** Mensagem desconhecida, malformada ou vazia: o estado volta intacto, sem erro. */
export function applyMessage(state: TranscriptState, envelope: StreamEnvelope, options: ApplyOptions = {}): TranscriptState {
  const message = isRecord(envelope.message) ? envelope.message : null
  if (!message) return state
  switch (message['type']) {
    case 'Turn':
      return applyTurnWithEcho(state, envelope, message, options.removeEcho === true)
    case 'LLMGatewayResponse':
      return applyTranslation(state, envelope, message)
    case 'SpeakerRevision':
      return applySpeakerRevision(state, envelope, message)
    default:
      return state
  }
}

/** Tradução avulsa do CA9, quando a da conexão não chegou. */
export function applyFallbackTranslation(state: TranscriptState, segmentId: string, translation: string, model: string | null): TranscriptState {
  return { ...state, segments: state.segments.map((segment) => (segment.id === segmentId ? { ...segment, translation, translationModel: model, translationState: 'done' } : segment)) }
}

export function markTranslationUnavailable(state: TranscriptState, segmentId: string): TranscriptState {
  return { ...state, segments: state.segments.map((segment) => (segment.id === segmentId ? { ...segment, translation: null, translationState: 'unavailable' } : segment)) }
}

/**
 * O que a reunião salva guarda: os trechos com texto, menos os marcados como eco. Um parcial que sobrou no fim (o turno final não
 * chegou antes de a sessão fechar) entra como está: é a melhor leitura que existe daquele trecho, e
 * perdê-lo apagaria fala do arquivo.
 */
export function persistableSegments(state: TranscriptState): TranscriptSegment[] {
  return state.segments
    // Eco do alto-falante (contrato 06): a fala já está no trecho do sistema.
    .filter((segment) => segment.text.trim() !== '' && !segment.echo)
    .map(({ id, source, speaker, startMs, endMs, text, translation, translationModel }) => ({ id, source, speaker, startMs, endMs, text, translation, translationModel }))
}

export { turnKey }
