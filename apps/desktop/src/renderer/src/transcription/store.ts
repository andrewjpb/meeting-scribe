// Estado da transcrição ao vivo, fora da tela (trocar de tela no meio da gravação não perde texto).
// Recebe as mensagens já envelope-adas pelo sink, aplica o redutor puro e agenda a tradução de reserva
// (CA9). O smoke injeta aqui os trechos da fixture (CA13): em modo sintético nada conecta.
// Com o motor Claude CLI (contrato 05) não há tradução na conexão: cada trecho final vai na hora ao
// `claude` do main, pela mesma fila de tradução avulsa (mesmo "Tradução indisponível" / "Tentar de novo").
// Eco do alto-falante (contrato 06): com "Remover eco do alto-falante" ligado, o trecho do microfone
// marcado como eco não pede tradução; o resultado que chegar para ele é descartado sem erro, e se a
// marca cair (o texto do sistema mudou) ele volta a pedir.
import { create } from 'zustand'
import type { AppSettings } from '../../../shared/settings-defaults'
import type { ClaudeRunState } from '../../../shared/claude-cli'
import type { TranscriptSegment, TranslateTurnResult } from '../../../shared/transcription'
import { TranslationWatcher } from './fallback'
import { applyEcho, applyFallbackTranslation, applyMessage, markTranslationUnavailable, persistableSegments, segmentIdOf, type PendingTranslation, type RuntimeSegment, type StreamEnvelope } from './reducer'
import type { TranscriptionSession } from './session'
import type { SourceStatus } from './sink'
import type { AudioSource } from '../audio/frames'

export type TranscriptionStatus = 'idle' | 'waiting' | 'live' | 'no-key' | 'unavailable'

/** Ao encerrar: quanto se espera pelas traduções de reserva ainda pendentes antes de salvar. */
export const TRANSLATION_DRAIN_MS = 5_000

const idleSource = (): SourceStatus => ({ status: 'idle', attempts: 0, nextRetryMs: null, error: null })

/**
 * Claude CLI na gravação: `off` com o motor AssemblyAI ou sem tradução; `not-found` mostra o aviso do
 * CA11; `stopped` (morreu duas vezes) mostra o do CA7. Nos dois, a transcrição segue sem tradução.
 */
export type ClaudeStatus = 'off' | 'starting' | ClaudeRunState | 'not-found'

interface TranscriptionState {
  status: TranscriptionStatus
  segments: RuntimeSegment[]
  pendingTranslations: Record<string, PendingTranslation>
  sources: Record<AudioSource, SourceStatus>
  claude: ClaudeStatus
  /** "Remover eco do alto-falante" valendo agora (muda no meio da gravação sem recomeçar). */
  removeEcho: boolean
  /** Início da gravação: o estado é zerado a cada "Nova gravação". */
  attach: (session: TranscriptionSession | null, settings: AppSettings) => void
  receive: (envelope: StreamEnvelope) => void
  updateSource: (source: AudioSource, sourceStatus: SourceStatus) => void
  /** "Tentar de novo" de uma fonte que esgotou as reconexões. */
  retrySource: (source: AudioSource) => void
  /** "Tentar de novo" de uma tradução indisponível. */
  retryTranslation: (segmentId: string) => void
  /** Encerrar: espera as traduções de reserva agendadas ou em voo, por até `timeoutMs`. */
  settleTranslations: (timeoutMs?: number) => Promise<void>
  setClaude: (claude: ClaudeStatus) => void
  /** Configuração trocada no meio da gravação: reavalia os trechos que já existem (CA7). */
  setRemoveEcho: (removeEcho: boolean) => void
  /** Modo sintético (smoke): sem conexão, o estado sem chave vem da própria configuração. */
  markNoKey: () => void
  /** Smoke: trechos da fixture, sem conexão nenhuma. */
  replay: (segments: TranscriptionSegment[]) => void
  reset: () => void
}

export type TranscriptionSegment = RuntimeSegment

let session: TranscriptionSession | null = null
let watcher: TranslationWatcher | null = null
let settings: AppSettings | null = null

const translate = async (_segmentId: string, text: string): Promise<TranslateTurnResult> => {
  if (!settings) return { ok: false, error: 'server' }
  try {
    return await window.__scribeApi.invoke('scribe:translate-turn', {
      text,
      source: settings.sourceLanguage,
      target: settings.targetLanguage,
      model: settings.translationModel,
    })
  } catch {
    return { ok: false, error: 'server' }
  }
}

/** Trecho final ao `claude` do main. Falha de canal ou do processo vira "Tradução indisponível". */
const translateWithClaude = async (segmentId: string, text: string): Promise<TranslateTurnResult> => {
  const segment = useTranscription.getState().segments.find((item) => item.id === segmentId)
  if (!segment) return { ok: false, error: 'server' }
  try {
    const result = await window.__scribeApi.invoke('scribe:claude-translate', { segmentId, source: segment.source, turnOrder: segment.turnOrder, text })
    return result.ok ? { ok: true, translation: result.translation, model: result.model } : { ok: false, error: 'server' }
  } catch {
    return { ok: false, error: 'server' }
  }
}

const usesClaude = (value: AppSettings | null): boolean => value !== null && value.translationEnabled && value.translationEngine === 'claude-cli'

/** O `claude` não está disponível nesta gravação: os trechos novos ficam sem tradução, sem pedir nada. */
const claudeUnavailable = (claude: ClaudeStatus): boolean => claude === 'not-found' || claude === 'stopped'

const idleState = (): Pick<TranscriptionState, 'status' | 'segments' | 'pendingTranslations' | 'sources' | 'claude' | 'removeEcho'> => ({
  status: 'idle',
  segments: [],
  pendingTranslations: {},
  sources: { mic: idleSource(), system: idleSource() },
  claude: 'off',
  removeEcho: false,
})

/**
 * Trechos do microfone que mudaram de marca de eco: o que virou eco não espera mais tradução (o que já
 * está em voo é descartado ao chegar); o que deixou de ser e ainda não tem tradução volta a pedir, pelo
 * mesmo caminho de um trecho final novo.
 */
function syncEchoTranslations(before: readonly RuntimeSegment[], after: readonly RuntimeSegment[], claude: ClaudeStatus): void {
  if (!watcher || !settings?.translationEnabled) return
  const previous = new Map(before.map((segment) => [segment.id, segment.echo === true]))
  for (const segment of after) {
    if (segment.source !== 'mic' || segment.partial) continue
    const was = previous.get(segment.id)
    const now = segment.echo === true
    if (was === undefined || was === now) continue
    if (now) {
      watcher.drop(segment.id)
      continue
    }
    if (segment.translation || !segment.text.trim()) continue
    watcher.drop(segment.id)
    if (!usesClaude(settings)) watcher.expect(segment.id, segment.text)
    else if (!claudeUnavailable(claude)) watcher.retry(segment.id, segment.text)
  }
}

export const useTranscription = create<TranscriptionState>()((set, get) => ({
  ...idleState(),

  attach: (nextSession, nextSettings) => {
    watcher?.dispose()
    session = nextSession
    settings = nextSettings
    watcher = new TranslationWatcher({
      translate: usesClaude(nextSettings) ? translateWithClaude : translate,
      onResult: (segmentId, result) => {
        const state = get()
        // Virou eco enquanto a tradução estava na fila: descartada, sem "Tradução indisponível".
        if (state.segments.find((segment) => segment.id === segmentId)?.echo) return
        set(
          result.ok
            ? { segments: applyFallbackTranslation({ segments: state.segments, pendingTranslations: state.pendingTranslations }, segmentId, result.translation, result.model).segments }
            : { segments: markTranslationUnavailable({ segments: state.segments, pendingTranslations: state.pendingTranslations }, segmentId).segments },
        )
      },
    })
    set({ ...idleState(), status: 'waiting', claude: usesClaude(nextSettings) ? 'starting' : 'off', removeEcho: nextSettings.removeEcho })
  },

  receive: (envelope) => {
    const state = get()
    const next = applyMessage({ segments: state.segments, pendingTranslations: state.pendingTranslations }, envelope, { removeEcho: state.removeEcho })
    const message = envelope.message as { type?: unknown; end_of_turn?: unknown; turn_order?: unknown } | null
    const isTurn = message !== null && typeof message === 'object' && message.type === 'Turn'
    set({
      segments: next.segments,
      pendingTranslations: next.pendingTranslations,
      status: isTurn ? 'live' : state.status,
    })
    watcher?.settle(next.segments)
    // Trechos do microfone que mudaram de marca de eco com esta mensagem (contrato 06, CA3 e CA4).
    syncEchoTranslations(state.segments, next.segments, state.claude)
    // Tradução ligada e o turno final ainda sem tradução: o relógio de 5 s do CA9 começa aqui. Com o
    // Claude CLI o trecho vai na hora, no mesmo passo (a ordem dos pedidos é a ordem dos trechos).
    if (isTurn && message.end_of_turn === true && settings?.translationEnabled && typeof message.turn_order === 'number') {
      const id = segmentIdOf(envelope.source, envelope.sessionId, message.turn_order)
      const segment = next.segments.find((item) => item.id === id)
      // Eco do alto-falante: não vai para a fila nem espera a reserva.
      if (segment && !segment.echo && segment.translationState === 'pending' && !segment.translation && !watcher?.has(id)) {
        if (!usesClaude(settings)) watcher?.expect(id, segment.text)
        else if (!claudeUnavailable(get().claude) && segment.text.trim()) watcher?.retry(id, segment.text)
      }
    }
  },

  updateSource: (source, sourceStatus) => {
    const sources: Record<AudioSource, SourceStatus> = { ...get().sources, [source]: sourceStatus }
    // Fonte que nunca abriu (`idle`) não decide nada: só o microfone aberto e sem chave já é "sem chave".
    const values: SourceStatus[] = [sources.mic, sources.system].filter((value) => value.status !== 'idle')
    const status: TranscriptionStatus =
      values.length > 0 && values.every((value) => value.status === 'no-key')
        ? 'no-key'
        : values.some((value) => value.status === 'live') || get().segments.length > 0
          ? 'live'
          : values.length > 0 && values.every((value) => value.status === 'failed')
            ? 'unavailable'
            : 'waiting'
    set({ sources, status })
  },

  retrySource: (source) => {
    session?.retry(source)
  },

  retryTranslation: (segmentId) => {
    const segment = get().segments.find((item) => item.id === segmentId)
    if (!segment) return
    set({ segments: get().segments.map((item) => (item.id === segmentId ? { ...item, translationState: 'pending' as const } : item)) })
    watcher?.retry(segmentId, segment.text)
  },

  settleTranslations: (timeoutMs = TRANSLATION_DRAIN_MS) => watcher?.idle(timeoutMs) ?? Promise.resolve(),

  setClaude: (claude) => {
    if (get().claude === 'off') return
    set({ claude })
  },

  setRemoveEcho: (removeEcho) => {
    const state = get()
    if (state.removeEcho === removeEcho) return
    const next = applyEcho({ segments: state.segments, pendingTranslations: state.pendingTranslations }, removeEcho)
    set({ removeEcho, segments: next.segments })
    syncEchoTranslations(state.segments, next.segments, state.claude)
  },

  markNoKey: () => {
    const noKey: SourceStatus = { status: 'no-key', attempts: 0, nextRetryMs: null, error: 'no-key' }
    set({ status: 'no-key', sources: { mic: noKey, system: { ...noKey } } })
  },

  replay: (segments) => {
    set({
      status: 'live',
      segments: applyEcho({ segments, pendingTranslations: {} }, get().removeEcho).segments,
      sources: {
        mic: { status: 'live', attempts: 0, nextRetryMs: null, error: null },
        system: { status: 'live', attempts: 0, nextRetryMs: null, error: null },
      },
    })
  },

  reset: () => {
    watcher?.dispose()
    watcher = null
    session = null
    settings = null
    set(idleState())
  },
}))

/** O que a reunião salva guarda (CA12): os trechos com texto. Ver `persistableSegments`. */
export function persistableTranscript(segments: readonly TranscriptionSegment[]): TranscriptSegment[] {
  return persistableSegments({ segments: [...segments], pendingTranslations: {} })
}
