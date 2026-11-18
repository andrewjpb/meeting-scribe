// Gravação em andamento. A sessão vive aqui, não na tela: trocar de tela no meio não para a captura.
// A transcrição (contrato 04) só conecta em modo real: no smoke o áudio é gerado e nenhuma rede é
// tocada; o probe injeta os trechos da fixture. Com o motor Claude CLI (contrato 05) o processo do
// `claude` abre no main junto com a gravação, continua aberto na pausa e fecha ao encerrar. Com
// "Salvar áudio e transcrição numa pasta" (contrato 07), um gravador à parte mistura as duas fontes e
// manda o áudio ao main em pedaços; ao encerrar, o main renomeia o arquivo e escreve a transcrição ao lado.
// As anotações da gravação (contrato 13) ficam aqui até a reunião existir e são salvas nela ao encerrar.
// "Analisar até agora" (contrato 19) também: cada análise volta do main para cá e é salva com a reunião ao
// encerrar. A análise roda à parte, sem pausar nem esperar a captura, a transcrição ou a tradução.
// Quem fala no Meet (contrato 27): a linha do tempo de falas acompanha o relógio da gravação e, ao encerrar,
// os trechos do sistema ganham os nomes antes de a transcrição ser salva.
// IA anotando ao vivo (contrato 30): com o interruptor ligado, a cada 5 min do relógio da gravação (sem as pausas) os
// trechos novos vão ao main e o lote volta como post-its da IA, criados e resolvidos aqui, salvos com os outros.
import { create } from 'zustand'
import { AI_NOTES_INTERVAL_MS, type AiNotesRunResult } from '@shared/ai-notes'
import { analyzedUntil, ANALYSES_MAX, recentAnalyses, type AnalysisError, type AnalysisRunResult, type LiveAnalysisSegment, type MeetingAnalysis } from '@shared/meeting-analysis'
import { NOTE_TEXT_MAX, noteContextText, type MeetingNote, type NoteColor } from '@shared/meeting-notes'
import { audioExtension } from '@shared/meeting-files'
import { defaultMeetingTitle, MEETING_TITLE_MAX, type Meeting } from '@shared/meetings'
import type { InvokeChannels, RecordingSessionChannel } from '@shared/ipc'
import { TRANSCRIPT_VERSION, type TranscriptDocument, type TranscriptionTokenResult } from '@shared/transcription'
import { effectiveTranslationModel, type AppSettings } from '@shared/settings-defaults'
import { useSettings } from '../../app/settingsStore'
import { CaptureSession, type CaptureState } from '../../audio/capture'
import { captureEnvironment, loadCaptureEnvironment, type CaptureEnvironment } from '../../audio/environment'
import { CountingFrameSink, type AudioSource, type FrameSink } from '../../audio/frames'
import { AudioFileRecorder, type MeetingAudioRecorder } from '../../audio/recorder'
import { TranscriptionSession } from '../../transcription/session'
import type { StreamingSocket } from '../../transcription/sink'
import { persistableTranscript, useTranscription, type TranscriptionSegment } from '../../transcription/store'
import { aiNotesKnownTitles, aiNotesOpenCards, aiNotesSelection, aiNotesShouldSkip } from './aiNotes'
import { liveNamer, meetRecordingEnded, meetRecordingPaused, meetRecordingStarted, useMeet, withSpeakerNames, type SpeakerInterval } from './meetStore'
import { addNote, applyAiBatch, closestSegmentId, createNote, editNote, NOTE_UNDO_MS, noteWithText, removeNote, reopenNote, resolveNote, restoreNote, type NotePatch, type RemovedNote } from '../notes/noteList'
import { TapeHistory } from './tapeHistory'
import { tapeStats } from './tapeStats'

interface RecordingState {
  session: CaptureSession | null
  capture: CaptureState | null
  transcription: TranscriptionSession | null
  tape: TapeHistory | null
  title: string
  startedAt: string | null
  saving: boolean
  saveFailed: boolean
  /** Reunião já criada numa tentativa de "Encerrar" que falhou depois: "Tentar de novo" não duplica. */
  savedMeeting: Meeting | null
  /** O ambiente de captura não carregou: "Nova gravação" mostra o aviso em vez de gravar. */
  startFailed: boolean
  /**
   * Arquivo de áudio da reunião (contrato 07): `off` com a opção desligada; `recording` mostra o marcador
   * "Gravando áudio"; `failed` mostra o aviso de pasta e a gravação segue.
   */
  audio: 'off' | 'recording' | 'failed'
  /** Reunião encerrada cujo arquivo não foi escrito na pasta: o detalhe mostra o mesmo aviso. */
  filesFailedMeetingId: string | null
  /**
   * Anotações da gravação em curso (contrato 13), da mais nova para a mais antiga. Cada tecla já chega aqui:
   * "Encerrar" salva tudo, inclusive a que está sendo digitada.
   */
  notes: MeetingNote[]
  /** Painel de anotações aberto; lembrado enquanto a gravação durar. */
  notesOpen: boolean
  /** Card criado agora, que abre com o cursor no texto (limpo depois do foco). */
  newNoteId: string | null
  /** Última anotação excluída, por 5 s, mesmo com o painel fechado. */
  noteUndo: RemovedNote | null
  /** Id desta gravação (contrato 19): a análise de uma gravação nunca entra em outra. */
  recordingId: string | null
  /**
   * Análises que terminaram depois do "Encerrar" e não entraram na reunião nem na segunda tentativa: o
   * detalhe dela mostra "Uma análise não foi salva" com "Tentar de novo".
   */
  unsavedAnalyses: { meetingId: string; analysis: MeetingAnalysis }[]
  /** "Tentar de novo" do aviso do detalhe. */
  retryUnsavedAnalyses: (meetingId: string) => Promise<void>
  /** Aba do painel lateral (contrato 19): "Anotações" ou "Análise". */
  panelTab: SidePanelTab
  /** Análises da gravação em curso (contrato 19), da mais antiga para a mais nova. */
  analyses: MeetingAnalysis[]
  /** Uma análise está sendo gerada: o botão mostra "Analisando…" e não aceita outro clique. */
  analyzing: boolean
  /** A última tentativa falhou (até a próxima). */
  analysisError: AnalysisError | null
  /** Trecho da transcrição para onde rolar (clique no tempo de um item da análise). */
  jump: { id: string; seq: number } | null
  /** Interruptor "IA anotando" desta gravação (contrato 30); começa como `liveCards` das Configurações. */
  aiNotes: boolean
  /** Um ciclo da IA está rodando: o painel mostra "anotando…". */
  aiNotesBusy: boolean
  /** Inicia a captura. Chamar direto do gesto (clique, tecla ou menu); devolve falso se já havia uma. */
  start: () => boolean
  /** "Tentar de novo" do aviso de início: recarrega o ambiente e começa (o clique é o gesto). */
  retryStart: () => Promise<void>
  togglePause: () => void
  /**
   * "Ouvir só os participantes" (contrato 29): desliga ou religa o microfone desta gravação (começa sempre ligado,
   * não vai para Configurações). Vale também pausado.
   */
  toggleMic: () => void
  setTitle: (title: string) => void
  toggleNotes: () => void
  /** "+ Nova anotação": amarela, vazia, com o tempo da gravação agora. */
  addNote: () => void
  editNote: (id: string, patch: NotePatch & { color?: NoteColor }) => void
  /** "Concluir" (contrato 30): resolvida pela pessoa, com o motivo (pode ser vazio). */
  resolveNote: (id: string, reason: string) => void
  /** "Reabrir": volta a aberta. */
  reopenNote: (id: string) => void
  /** Liga ou desliga a IA anotando nesta gravação; ligar recomeça a contagem dos 5 min. */
  toggleAiNotes: () => void
  /**
   * Um ciclo da IA agora (o relógio chama a cada 5 min; o smoke chama direto). `off`: interruptor desligado ou sem
   * gravação; `busy`: já há um rodando; `skipped`: pouca fala nova; `failed`: erro, prazo ou bloqueio (o próximo tenta).
   */
  runAiNotesCycle: () => Promise<'ran' | 'skipped' | 'off' | 'busy' | 'failed'>
  /** Exclui e guarda para o "Desfazer" por 5 s. */
  deleteNote: (id: string) => void
  /** "Desfazer": a última excluída volta para o mesmo lugar. */
  undoDeleteNote: () => void
  noteFocused: () => void
  setPanelTab: (tab: SidePanelTab) => void
  /** "Analisar até agora" (⌘⇧A): abre a aba "Análise" e pede a análise da transcrição até este momento. */
  analyze: () => void
  /** "Virar anotação": um card amarelo com o texto e o tempo do item (ou da análise). */
  noteFromAnalysis: (text: string, atMs: number) => void
  /** Clique no tempo de um item: a transcrição rola até o trecho mais próximo. */
  jumpToTime: (atMs: number) => void
  /** Encerra, salva o registro, a transcrição e as anotações, e devolve a reunião salva (ou `null` se não salvou). */
  end: () => Promise<Meeting | null>
}

export type SidePanelTab = 'anotacoes' | 'analise'

/** Contagem de quadros da gravação (o smoke confere que a captura continua entregando quadros). */
const frameCounts: Record<AudioSource, number> = { mic: 0, system: 0 }

/** Gravação que abriu o processo do `claude` no main e o aviso de estado que ela assina. */
let claudeRun: { session: CaptureSession; off: () => void } | null = null

/**
 * Abre (aquece) o `claude` no main, antes do primeiro trecho. Não encontrado: a transcrição segue sem
 * tradução e a coluna mostra o aviso (CA11). Reaberto ou parado de vez: chega por `scribe:claude-state`.
 */
function startClaude(session: CaptureSession): void {
  const api = window.__scribeApi
  const off = api.on?.('scribe:claude-state', (state) => useTranscription.getState().setClaude(state)) ?? ((): void => undefined)
  claudeRun = { session, off }
  void Promise.resolve(api.invoke('scribe:claude-start')).then(
    (result) => {
      if (claudeRun?.session !== session) return
      useTranscription.getState().setClaude(result?.ok ? 'running' : 'not-found')
    },
    () => {
      if (claudeRun?.session === session) useTranscription.getState().setClaude('not-found')
    },
  )
}

/** Encerrar: o main espera a fila por até 5 s, fecha o stdin e mata o processo. */
async function stopClaude(session: CaptureSession): Promise<void> {
  if (claudeRun?.session !== session) return
  const { off } = claudeRun
  claudeRun = null
  try {
    await window.__scribeApi.invoke('scribe:claude-stop')
  } catch {
    // O main mata o processo de qualquer forma ao sair.
  } finally {
    off()
  }
}

/** Gravação com arquivo na pasta: o gravador, a mistura das fontes e o id da sessão de arquivos no main. */
interface AudioRun {
  session: CaptureSession
  handle: MeetingAudioRecorder | null
  file: AudioFileRecorder | null
  /** Id da sessão no main; `null` se a pasta não abriu (ou a opção foi desligada no meio). */
  begin: Promise<string | null>
}

let audioRun: AudioRun | null = null

/**
 * Gravação cujas análises já foram salvas na reunião criada: a que terminar depois disso entra direto nela
 * (`scribe:analyses-add`), em vez de ficar na memória de uma gravação que já acabou.
 */
const analysesSavedFor = new WeakMap<CaptureSession, string>()

/** Trechos que a análise lê: só os finais, sem eco, com texto, na ordem do tempo (CA2). */
export function analysisSegments(segments: readonly TranscriptionSegment[]): LiveAnalysisSegment[] {
  return segments
    .filter((segment) => !segment.partial && !segment.echo && segment.text.trim() !== '')
    .map(({ source, speaker, startMs, endMs, text }) => ({ source, speaker, startMs, endMs, text }))
}

const newRecordingId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

/**
 * Canal de fim de gravação (contrato 22): com o token da sessão aberta no main, passa mesmo com o app bloqueado
 * no meio do "Encerrar"; sem token (sessão que não abriu), o `invoke` de sempre.
 */
type FinishCall = <C extends RecordingSessionChannel>(channel: C, request: InvokeChannels[C]['request']) => Promise<InvokeChannels[C]['response']>

function finishCall(token: string | null): FinishCall {
  return (channel, request) => {
    const api = window.__scribeApi
    if (token) return api.invokeInSession(token, channel, request)
    return (api.invoke as (name: typeof channel, body: typeof request) => Promise<InvokeChannels[typeof channel]['response']>)(channel, request)
  }
}

const plainCall = finishCall(null)

/** Token da sessão de cada gravação no main (contrato 22); `null` se o main não respondeu. */
const recordingTokens = new WeakMap<CaptureSession, Promise<string | null>>()

/** Uma análise atrasada na reunião já criada, com uma segunda tentativa. Falso se as duas falharam. */
async function addLateAnalysis(meetingId: string, analysis: MeetingAnalysis, call: FinishCall = plainCall): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if ((await call('scribe:analyses-add', { meetingId, analysis: { ...analysis, meetingId } })) === true) return true
    } catch {
      // tenta de novo
    }
  }
  return false
}

/**
 * IA anotando da gravação em curso (contrato 30): o relógio (confere a cada segundo se já passaram 5 min de gravação
 * desde o último ciclo), os trechos que algum ciclo já mandou e o momento (no relógio da gravação) do último ciclo.
 */
let aiRun: { session: CaptureSession; timer: ReturnType<typeof setInterval>; sent: Set<string>; lastAt: number } | null = null
const AI_NOTES_TICK_MS = 1000

/**
 * Para o relógio e, com o id da gravação, cancela no main o ciclo que ainda gerava (o processo do `claude` morre). No
 * "Encerrar" vai pelo token da sessão (passa com o app bloqueado).
 */
function stopAiNotes(recordingId: string | null = null, call: FinishCall = plainCall): void {
  if (aiRun) clearInterval(aiRun.timer)
  aiRun = null
  if (recordingId) void Promise.resolve(call('scribe:ai-notes-cancel', { recordingId })).catch(() => undefined)
}

/** Prazo do "Desfazer" da última anotação excluída. */
let noteUndoTimer: ReturnType<typeof setTimeout> | null = null
function clearNoteUndoTimer(): void {
  if (noteUndoTimer) clearTimeout(noteUndoTimer)
  noteUndoTimer = null
}
/** Último gravador de arquivo, para o smoke comparar bytes com o arquivo depois de encerrar. */
let lastAudioFile: AudioFileRecorder | null = null

/**
 * Começa o arquivo da reunião: escolhe o formato, cria o gravador e pede ao main o `.part` na pasta. O
 * gravador começa na hora (o primeiro pedaço só sai depois de 5 s, quando o main já respondeu); cada
 * fonte entra na mistura quando a captura a abre (`onStream`).
 */
function startAudioFile(env: CaptureEnvironment, startedAt: Date, title: string, onState: (audio: RecordingState['audio']) => void): Omit<AudioRun, 'session'> {
  const api = window.__scribeApi
  const mime = env.recorderMime()
  let handle: MeetingAudioRecorder | null
  try {
    handle = mime ? env.createRecorder(mime) : null
  } catch {
    handle = null
  }
  const request = { startedAt: startedAt.toISOString(), title, extension: handle && mime ? audioExtension(mime) : null }
  const result = Promise.resolve(api.invoke('scribe:audio-begin', request)).catch(() => ({ ok: false as const, error: 'unwritable' as const }))
  const begin = result.then((value) => (value?.ok ? value.id : null))
  const file = handle
    ? new AudioFileRecorder({
        recorder: handle.recorder,
        writer: {
          append: async (data) => {
            const id = await begin
            return id !== null && (await api.invoke('scribe:audio-append', { id, data })) === true
          },
        },
        onFailure: () => onState('failed'),
      })
    : null
  lastAudioFile = file
  file?.start()
  void result.then((value) => {
    if (value?.ok) {
      if (!file) onState('failed')
      return
    }
    // Desligada entre a leitura da configuração e o pedido: nada é gravado e não há aviso.
    if (value?.error === 'disabled') {
      file?.cancel()
      onState('off')
    } else if (file) file.fail()
    else onState('failed')
  })
  return { handle, file, begin }
}

/**
 * Encerrar, primeira parte: para o gravador (o último pedaço espera até 5 s) e fecha a mistura, antes de
 * parar a captura, para o arquivo não terminar com o silêncio das trilhas paradas.
 */
async function stopAudioFile(run: AudioRun | null): Promise<void> {
  if (!run) return
  await run.file?.stop()
  await run.handle?.close()
}

/** Encerrar, segunda parte: o main renomeia o `.part`, escreve o `.md` e grava os caminhos. Falso se algo falhou. */
async function finishAudioFile(run: AudioRun, meetingId: string, call: FinishCall): Promise<boolean> {
  const id = await run.begin
  if (id === null) return run.file === null || run.file.ok
  try {
    const result = await call('scribe:audio-finish', { id, meetingId })
    return result.ok
  } catch {
    return false
  }
}

/** Pedido do token ao main: a chave nunca chega ao renderer. Falha de canal vira erro de rede. */
async function requestToken(): Promise<TranscriptionTokenResult> {
  try {
    const result: unknown = await window.__scribeApi.invoke('scribe:transcription-token')
    if (!result || typeof result !== 'object' || typeof (result as { ok?: unknown }).ok !== 'boolean') return { ok: false, error: 'network' }
    return result as TranscriptionTokenResult
  } catch {
    return { ok: false, error: 'network' }
  }
}

export const useRecording = create<RecordingState>()((set, get) => ({
  session: null,
  capture: null,
  transcription: null,
  tape: null,
  title: '',
  startedAt: null,
  saving: false,
  saveFailed: false,
  savedMeeting: null,
  startFailed: false,
  audio: 'off',
  filesFailedMeetingId: null,
  notes: [],
  notesOpen: false,
  newNoteId: null,
  noteUndo: null,
  recordingId: null,
  unsavedAnalyses: [],
  panelTab: 'anotacoes',
  analyses: [],
  analyzing: false,
  analysisError: null,
  jump: null,
  aiNotes: false,
  aiNotesBusy: false,

  start: () => {
    if (get().session) return false
    let env: ReturnType<typeof captureEnvironment>
    try {
      env = captureEnvironment()
    } catch {
      set({ startFailed: true })
      return false
    }
    // Microfone, cancelamento de eco e idiomas como estão em Configurações no momento de começar.
    const settings = useSettings.getState().settings
    const { echoCancellation, micDeviceId } = settings
    const counting = new CountingFrameSink()
    // A transcrição nasce depois da captura (precisa do relógio dela); o sink a lê na hora de cada quadro.
    let transcription: TranscriptionSession | null = null
    // Cada quadro é contado e segue para a transcrição. Os primeiros podem chegar antes de a sessão de
    // transcrição começar: passam pelo contador e são descartados sem quebrar a captura.
    const sink: FrameSink = {
      write: (frame) => {
        frameCounts[frame.source]++
        counting.write(frame)
        transcription?.write(frame)
      },
    }
    const startedAt = new Date()
    const title = defaultMeetingTitle(startedAt)
    // Sessão no main (contrato 22): fechar a janela pede confirmação e o "Encerrar" salva mesmo bloqueado.
    const recordingToken = Promise.resolve(window.__scribeApi.invoke('scribe:recording-session-open')).then(
      (token: unknown) => (typeof token === 'string' ? token : null),
      () => null,
    )
    // Arquivo da reunião, se a opção está ligada: o gravador lê as mesmas trilhas que a captura abrir.
    let audio: Omit<AudioRun, 'session'> | null = null
    const session = new CaptureSession({
      media: env.media,
      createPipeline: env.createPipeline,
      sink,
      settings: { echoCancellation, micDeviceId },
      onStream: (source, stream) => audio?.handle?.addStream(source, stream),
    })
    if (settings.saveToFolder) {
      audio = startAudioFile(env, startedAt, title, (state) => {
        if (audioRun?.session === session) set({ audio: state })
      })
      audioRun = { session, ...audio }
    }
    recordingTokens.set(session, recordingToken)
    // Contrato 27: os eventos do Meet contam no relógio desta gravação (parado até a captura começar).
    meetRecordingStarted(session.clock)
    // Contrato 12 (CA9): começando com um evento da agenda, a gravação leva o título dele (se a pessoa ainda não
    // trocou o título). O main decide o evento ao abrir a sessão.
    void recordingToken
      .then((token) => (token ? window.__scribeApi.invoke('scribe:calendar-recording') : null))
      .then(
        (event) => {
          if (event?.title && get().session === session && get().title === title) set({ title: event.title.trim().slice(0, MEETING_TITLE_MAX) || title })
        },
        () => undefined,
      )
    const real = env.mode === 'real'
    transcription = real
      ? new TranscriptionSession({
          sources: ['mic', 'system'],
          settings,
          elapsedMs: () => session.clock.elapsedMs,
          getToken: requestToken,
          openSocket: (url) => new WebSocket(url) as unknown as StreamingSocket,
          onMessage: (envelope) => useTranscription.getState().receive(envelope),
          onStatus: (source, status) => useTranscription.getState().updateSource(source, status),
        })
      : null
    useTranscription.getState().attach(transcription, settings)
    if (settings.translationEnabled && settings.translationEngine === 'claude-cli') startClaude(session)
    // No smoke (sinal gerado) não há sink: o estado sem chave precisa vir da configuração.
    if (!real) {
      void Promise.resolve(window.__scribeApi.invoke('scribe:key-status'))
        .then(
        (status) => {
          if (!status.configured && get().session === session) useTranscription.getState().markNoKey()
        },
          () => undefined,
        )
    }
    session.subscribe((capture) => set({ capture }))
    // Contrato 30: o relógio da IA anotando. Pausada, o relógio da gravação para e nenhum ciclo extra sai na volta.
    stopAiNotes()
    aiRun = {
      session,
      sent: new Set(),
      lastAt: 0,
      timer: setInterval(() => {
        const state = get()
        // Gravação que acabou (ou foi trocada): o relógio dela para.
        if (aiRun?.session === session && state.session !== session) return stopAiNotes()
        if (!aiRun || aiRun.session !== session || !state.aiNotes || state.aiNotesBusy || state.capture?.phase !== 'recording') return
        if (session.clock.elapsedMs - aiRun.lastAt >= AI_NOTES_INTERVAL_MS) void state.runAiNotesCycle()
      }, AI_NOTES_TICK_MS),
    }
    set({
      session,
      transcription,
      tape: new TapeHistory(),
      capture: session.getState(),
      title,
      startedAt: startedAt.toISOString(),
      saving: false,
      saveFailed: false,
      savedMeeting: null,
      startFailed: false,
      notes: [],
      notesOpen: false,
      newNoteId: null,
      noteUndo: null,
      recordingId: newRecordingId(),
      panelTab: 'anotacoes',
      analyses: [],
      analyzing: false,
      analysisError: null,
      jump: null,
      aiNotes: settings.liveCards,
      aiNotesBusy: false,
      // Sem formato aceito ou gravador que nem começou: o aviso já aparece aqui.
      audio: audioRun?.session === session ? (audioRun.file?.ok ? 'recording' : 'failed') : 'off',
    })
    frameCounts.mic = 0
    frameCounts.system = 0
    // A parte síncrona de `start()` já pede as duas fontes, ainda dentro do gesto.
    session
      .start()
      .catch(() => undefined)
      .then(() => {
        // Só a fonte que a captura abriu recebe conexão: evita sessão ociosa cobrada na outra.
        const capture = session.getState()
        const active = (['mic', 'system'] as const).filter((source) => capture[source] !== 'failed')
        if (transcription && get().session === session) transcription.start(active)
      })
    return true
  },

  retryStart: async () => {
    try {
      await loadCaptureEnvironment()
    } catch {
      set({ startFailed: true })
      return
    }
    get().start()
  },

  togglePause: () => {
    const { session, capture, transcription } = get()
    if (!session || !capture) return
    // O arquivo da reunião pausa junto: não guarda o silêncio da pausa (contrato 07, CA6).
    const file = audioRun?.session === session ? audioRun.file : null
    if (capture.phase === 'recording') {
      transcription?.pause()
      file?.pause()
      session.pause()
      meetRecordingPaused()
    } else if (capture.phase === 'paused') {
      session.resume()
      file?.resume()
      transcription?.resume()
    }
  },

  toggleMic: () => {
    const { session, capture, transcription } = get()
    if (!session || !capture || capture.phase === 'stopping' || capture.phase === 'stopped') return
    const enabled = capture.micOff
    session.setMicEnabled(enabled)
    // A sessão da AssemblyAI do microfone encerra de propósito (sem reconexão nem aviso) e reabre ao religar.
    transcription?.setSourceEnabled('mic', enabled)
  },

  setTitle: (title) => {
    const value = title.trim().slice(0, MEETING_TITLE_MAX)
    if (value) set({ title: value })
  },

  // Com o painel aberto na "Análise", "Anotações" (⌘⇧N) troca de aba em vez de fechar.
  toggleNotes: () => {
    if (!get().session) return
    set((state) => (state.notesOpen && state.panelTab !== 'anotacoes' ? { panelTab: 'anotacoes' } : { notesOpen: !state.notesOpen, panelTab: 'anotacoes' }))
  },

  addNote: () => {
    const { session, saving, notes } = get()
    if (!session || saving) return
    // O mesmo relógio dos trechos da transcrição (sem as pausas): o tempo do card bate com o da coluna.
    const note = createNote(session.clock.elapsedMs, Date.now())
    const next = addNote(notes, note)
    if (next.length !== notes.length) set({ notes: next, notesOpen: true, panelTab: 'anotacoes', newNoteId: note.id })
  },

  editNote: (id, patch) => {
    if (get().saving) return
    set((state) => ({ notes: editNote(state.notes, id, patch, Date.now()) }))
  },

  resolveNote: (id, reason) => {
    const { session, saving } = get()
    if (!session || saving) return
    set((state) => ({ notes: resolveNote(state.notes, id, { reason, by: 'manual', atMs: session.clock.elapsedMs }, Date.now()) }))
  },

  reopenNote: (id) => {
    if (!get().session || get().saving) return
    set((state) => ({ notes: reopenNote(state.notes, id, Date.now()) }))
  },

  toggleAiNotes: () => {
    const { session, saving, aiNotes } = get()
    if (!session || saving) return
    // Ligar é o consentimento (contrato 30, CA2): o primeiro ciclo sai 5 min de gravação depois.
    if (!aiNotes && aiRun?.session === session) aiRun.lastAt = session.clock.elapsedMs
    // Desligar é tirar o consentimento: o ciclo em curso é cancelado no main (e o lote, se chegar, descartado).
    const recordingId = get().recordingId
    if (aiNotes && recordingId) void Promise.resolve(plainCall('scribe:ai-notes-cancel', { recordingId })).catch(() => undefined)
    set({ aiNotes: !aiNotes })
  },

  runAiNotesCycle: async () => {
    const { session, saving, aiNotes, aiNotesBusy, recordingId, notes } = get()
    const run = aiRun
    if (!session || saving || !aiNotes || !recordingId || run?.session !== session) return 'off'
    if (aiNotesBusy) return 'busy'
    run.lastAt = session.clock.elapsedMs
    const selection = aiNotesSelection(useTranscription.getState().segments, run.sent, liveNamer(useMeet.getState().liveIntervals))
    if (aiNotesShouldSkip(selection)) return 'skipped'
    set({ aiNotesBusy: true })
    const request = { recordingId, segments: selection.segments, openCards: aiNotesOpenCards(notes), knownTitles: aiNotesKnownTitles(notes) }
    // Erro, prazo ou app bloqueado: silencioso (o main registra no log) e o próximo ciclo tenta com os mesmos trechos.
    const result: AiNotesRunResult = await Promise.resolve(window.__scribeApi.invoke('scribe:ai-notes-run', request)).catch((): AiNotesRunResult => ({ ok: false, error: 'failed' }))
    const current = get().session === session && get().recordingId === recordingId
    if (current) set({ aiNotesBusy: false })
    // Desligado durante o ciclo: sem consentimento, o lote não entra.
    if (!result?.ok || !current || get().saving || !get().aiNotes) return 'failed'
    for (const id of selection.ids) run.sent.add(id)
    set((state) => ({ notes: applyAiBatch(state.notes, result.batch, session.clock.elapsedMs, Date.now()) }))
    return 'ran'
  },

  deleteNote: (id) => {
    if (get().saving) return
    const { list, removed } = removeNote(get().notes, id)
    if (!removed) return
    clearNoteUndoTimer()
    noteUndoTimer = setTimeout(() => {
      noteUndoTimer = null
      if (get().noteUndo === removed) set({ noteUndo: null })
    }, NOTE_UNDO_MS)
    set({ notes: list, noteUndo: removed })
  },

  undoDeleteNote: () => {
    const { session, saving, noteUndo } = get()
    if (!session || saving || !noteUndo) return
    clearNoteUndoTimer()
    set((state) => ({ notes: restoreNote(state.notes, noteUndo), noteUndo: null }))
  },

  noteFocused: () => {
    if (get().newNoteId) set({ newNoteId: null })
  },

  setPanelTab: (tab) => {
    if (get().session) set({ panelTab: tab, notesOpen: true })
  },

  analyze: () => {
    const { session, saving, analyzing, notes, analyses, recordingId } = get()
    if (!session || saving || !recordingId) return
    // O clique sempre mostra a aba; com uma análise em curso ou no limite, não pede outra.
    set({ notesOpen: true, panelTab: 'analise' })
    if (analyzing || analyses.length >= ANALYSES_MAX) return
    const segments = analysisSegments(useTranscription.getState().segments)
    if (!segments.length) return
    set({ analyzing: true, analysisError: null })
    const request = {
      live: {
        recordingId,
        // "Até" é o fim do último trecho lido: o que a análise cita nunca passa dele.
        atMs: Math.round(analyzedUntil(segments)),
        segments,
        // Contrato 30: título, origem e estado vão no texto (o card resolvido da IA não volta como pendência).
        notes: notes.map((note) => ({ text: noteContextText(note).slice(0, NOTE_TEXT_MAX), atMs: note.atMs, createdAt: note.createdAt })),
        // Só as mais recentes: o pedido não cresce sem fim.
        previous: recentAnalyses(analyses),
      },
    }
    const failed: AnalysisRunResult = { ok: false, error: 'failed' }
    void Promise.resolve(window.__scribeApi.invoke('scribe:analysis-run', request))
      .catch(() => failed)
      .then(async (result) => {
        // Resultado de outra gravação nunca entra nesta: só vale para a gravação que pediu.
        const current = get().session === session && get().recordingId === recordingId
        if (current) set({ analyzing: false })
        if (!result?.ok) {
          if (current) set({ analysisError: result?.error ?? 'failed' })
          return
        }
        // Ainda na tela (inclusive enquanto "Encerrar" salva): entra na lista, que um "Tentar de novo" salva de novo.
        if (current) set((state) => ({ analyses: [...state.analyses, result.analysis] }))
        // A reunião já foi criada e as análises dela salvas: esta entra direto nela.
        const meetingId = analysesSavedFor.get(session)
        if (meetingId && !(await addLateAnalysis(meetingId, result.analysis))) {
          set((state) => ({ unsavedAnalyses: [...state.unsavedAnalyses, { meetingId, analysis: result.analysis }] }))
        }
      })
  },

  retryUnsavedAnalyses: async (meetingId) => {
    const mine = get().unsavedAnalyses.filter((entry) => entry.meetingId === meetingId)
    if (!mine.length) return
    set((state) => ({ unsavedAnalyses: state.unsavedAnalyses.filter((entry) => entry.meetingId !== meetingId) }))
    for (const entry of mine) {
      if (!(await addLateAnalysis(meetingId, entry.analysis))) set((state) => ({ unsavedAnalyses: [...state.unsavedAnalyses, entry] }))
    }
  },

  noteFromAnalysis: (text, atMs) => {
    const { session, saving, notes } = get()
    if (!session || saving || !text.trim()) return
    const next = addNote(notes, noteWithText(text, atMs, Date.now()))
    if (next.length !== notes.length) set({ notes: next })
  },

  jumpToTime: (atMs) => {
    const items = useTranscription.getState().segments.filter((segment) => !segment.echo)
    const id = closestSegmentId(items, atMs)
    if (id) set((state) => ({ jump: { id, seq: (state.jump?.seq ?? 0) + 1 } }))
  },

  end: async () => {
    const { session, transcription, startedAt } = get()
    if (!session || !startedAt || get().saving) return null
    set({ saving: true, saveFailed: false })
    const settings = useSettings.getState().settings
    const audio = audioRun?.session === session ? audioRun : null
    // Contrato 27: a fala aberta no Meet fecha agora; "Tentar de novo" reaproveita os mesmos intervalos.
    const intervals = speakerIntervals.get(session) ?? meetRecordingEnded()
    speakerIntervals.set(session, intervals)
    const token = (await recordingTokens.get(session)) ?? null
    const call = finishCall(token)
    // Contrato 30: depois da reunião não há ciclo; o que ainda rodava é cancelado no main e o lote, descartado.
    // Desligado, não há ciclo para cancelar (desligar já cancelou o que havia).
    if (aiRun?.session === session) stopAiNotes(get().aiNotes ? get().recordingId : null, call)
    try {
      await stopAudioFile(audio)
      const result = lastResult.get(session) ?? (await stopOnce(session))
      lastResult.set(session, result)
      // Termina a transcrição antes de persistir: espera o `Termination` por até 3 s (CA7) e as
      // traduções de reserva ainda pendentes por até 5 s, para o resultado delas entrar no arquivo. Com o
      // Claude CLI, os trechos finais já foram para a fila do main; ele espera a mesma janela e fecha.
      await transcription?.end()
      await Promise.all([useTranscription.getState().settleTranslations(), stopClaude(session)])
      const meeting =
        get().savedMeeting ??
        (await call('scribe:meetings-create', { title: get().title, startedAt, durationMs: result.durationMs, sources: result.sources }))
      set({ savedMeeting: meeting })
      const hasTranscript = await saveTranscript(meeting.id, useTranscription.getState().segments, settings, call, intervals)
      // Anotações (contrato 13, CA4): antes do `.md` da pasta, que as leva no fim. Falhou: "Tentar de novo".
      await saveNotes(meeting.id, get().notes, call)
      // Análises (contrato 19, CA5): também antes do `.md`. A que ainda estiver gerando não é esperada: quando
      // terminar, entra direto na reunião.
      await saveAnalyses(session, meeting.id, () => get().analyses, call)
      // Depois da transcrição interna salva: o main renomeia o áudio e escreve o `.md` (CA6, CA6b).
      if (audio) {
        const filesOk = await finishAudioFile(audio, meeting.id, call)
        if (audioRun === audio) audioRun = null
        set({ filesFailedMeetingId: filesOk && get().audio !== 'failed' ? null : meeting.id })
      }
      // Resumo (contrato 08, CA4): com algum trecho, o main resume em segundo plano, depois dos arquivos
      // (o `- resumo.md` vai ao lado deles). Só com "Resumir ao encerrar" ligado e o `claude` encontrado;
      // quem decide é o main. A tela não espera.
      if (hasTranscript) void Promise.resolve(call('scribe:summary-generate', { meetingId: meeting.id, auto: true })).catch(() => undefined)
      // Tudo salvo: a sessão fecha (depois do pedido do resumo, que já passou) e o bloqueio volta a recusar.
      if (token) void Promise.resolve(window.__scribeApi.invoke('scribe:recording-session-close', { token })).catch(() => undefined)
      useTranscription.getState().reset()
      set({
        session: null,
        capture: null,
        transcription: null,
        tape: null,
        title: '',
        startedAt: null,
        saving: false,
        savedMeeting: null,
        audio: 'off',
        notes: [],
        notesOpen: false,
        newNoteId: null,
        noteUndo: null,
        recordingId: null,
        panelTab: 'anotacoes',
        analyses: [],
        analyzing: false,
        analysisError: null,
        jump: null,
        aiNotes: false,
        aiNotesBusy: false,
      })
      clearNoteUndoTimer()
      return meeting
    } catch {
      set({ saving: false, saveFailed: true })
      return null
    }
  },
}))

// "Remover eco do alto-falante" trocado em Configurações vale para a gravação em curso (contrato 06,
// CA7): os trechos que já existem são reavaliados na hora. Repassa sempre, inclusive enquanto
// "Encerrar" salva; sem gravação não faz nada (a próxima lê a configuração ao começar).
useSettings.subscribe((state, previous) => {
  if (state.settings.removeEcho !== previous.settings.removeEcho) useTranscription.getState().setRemoveEcho(state.settings.removeEcho)
})

type StopResult = Awaited<ReturnType<CaptureSession['stop']>>

/** Resultado da captura já encerrada, para "Tentar de novo" salvar sem parar de novo. */
const lastResult = new WeakMap<CaptureSession, StopResult>()

/** Intervalos de fala do Meet de cada gravação encerrada (contrato 27), para "Tentar de novo". */
const speakerIntervals = new WeakMap<CaptureSession, SpeakerInterval[]>()

/**
 * Para a captura. Se `stop()` já foi tentado e falhou no meio (a sessão não está mais ativa), o
 * registro sai do cronômetro, que `stop()` para antes de qualquer outra coisa, e das fontes ouvidas.
 */
async function stopOnce(session: CaptureSession): Promise<StopResult> {
  const { phase, heard } = session.getState()
  if (phase === 'stopping' || phase === 'stopped') return { durationMs: session.clock.elapsedMs, sources: { mic: heard.mic, system: heard.system } }
  return session.stop()
}

/**
 * Grava a transcrição em `meetings/<id>.json` (CA12). Sem trechos (sem chave), nada é escrito e devolve falso. Com
 * intervalos do Meet (contrato 27), cada trecho do sistema leva os nomes de quem falava nele.
 */
async function saveTranscript(meetingId: string, segments: readonly TranscriptionSegment[], settings: AppSettings, call: FinishCall, intervals: readonly SpeakerInterval[] = []): Promise<boolean> {
  const persisted = withSpeakerNames(persistableTranscript(segments), intervals)
  if (!persisted.length) return false
  const document: TranscriptDocument = {
    version: TRANSCRIPT_VERSION,
    meetingId,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.translationEnabled ? settings.targetLanguage : null,
    // Com o Claude CLI, `claude-cli:<modelo>` (contrato 05, CA14).
    translationModel: settings.translationEnabled ? effectiveTranslationModel(settings) : null,
    segments: persisted,
  }
  await call('scribe:transcript-save', { document })
  return persisted.some((segment) => segment.text.trim() !== '')
}

/** Grava as anotações da gravação na reunião criada. Sem anotação, nada é escrito. */
async function saveNotes(meetingId: string, notes: readonly MeetingNote[], call: FinishCall): Promise<void> {
  if (!notes.length) return
  const saved = await call('scribe:notes-save', { meetingId, notes: [...notes] })
  if (!saved) throw new Error('anotações não salvas')
}

/**
 * Grava as análises da gravação na reunião criada (sem análise, nada é escrito) e marca a gravação como
 * salva. Uma que chegou enquanto o pedido ia ao main também entra, uma a uma.
 */
async function saveAnalyses(session: CaptureSession, meetingId: string, current: () => readonly MeetingAnalysis[], call: FinishCall): Promise<void> {
  const list = current()
  if (list.length) {
    const saved = await call('scribe:analyses-save', { meetingId, analyses: [...list] })
    if (!saved) throw new Error('análises não salvas')
  }
  analysesSavedFor.set(session, meetingId)
  for (const late of current().filter((analysis) => !list.includes(analysis))) {
    if (!(await addLateAnalysis(meetingId, late, call))) throw new Error('análise não salva')
  }
}

/** Smoke: estado da captura, quadros contados, quadros desenhados pela fita e a fixture na tela. */
export function exposeRecordingProbe(): void {
  captureEnvironment().exposeProbe({
    state: () => useRecording.getState().capture,
    frames: () => ({ ...frameCounts }),
    tapeFrames: () => tapeStats.frames,
    replay: (segments) => useTranscription.getState().replay(segments as TranscriptionSegment[]),
    audioFile: () => (lastAudioFile ? { chunks: lastAudioFile.chunks, bytes: lastAudioFile.bytes, ok: lastAudioFile.ok } : null),
    aiNotesCycle: () => useRecording.getState().runAiNotesCycle(),
  })
}
