import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { MEETING_TITLE_MAX } from '@shared/meetings'
import { meetingPath } from '@shared/routes'
import { useBranding } from '../../app/brandingStore'
import { whenUnlocked } from '../../app/lockStore'
import type { CapturePhase, CaptureState } from '../../audio/capture'
import { formatElapsed } from '../../audio/clock'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { EmptyState } from '../../design/EmptyState'
import { SilentTapeIllustration } from '../../design/TapeIllustration'
import { ControlBar } from './ControlBar'
import { LevelTape } from './LevelTape'
import { Notices, RetryNotice } from './Notices'
import { NotesPanel } from './NotesPanel'
import { noticesFor } from './noticeRules'
import { ANALYSES_MAX } from '@shared/meeting-analysis'
import { useTranscription } from '../../transcription/store'
import { useRecording } from './recordingStore'
import { TranscriptArea } from './TranscriptArea'
import { TranscriptionNotices } from './TranscriptionNotices'
import { useElapsed } from './useElapsed'
import { useStartRecording } from './useStartRecording'

const absent = (capture: CaptureState, source: 'mic' | 'system'): boolean =>
  capture[source] === 'failed' || capture[source] === 'ended' || capture.silence[source] !== 'ok'

/**
 * Gravação ao vivo: cabeçalho com estado e cronômetro, fita, avisos, transcrição, o painel à direita com as
 * anotações (contrato 13) e a análise (contrato 19) e os controles.
 */
export function LiveScreen() {
  const navigate = useNavigate()
  const session = useRecording((state) => state.session)
  const capture = useRecording((state) => state.capture)
  const tape = useRecording((state) => state.tape)
  const appName = useBranding((state) => state.branding.name)
  const title = useRecording((state) => state.title)
  const saving = useRecording((state) => state.saving)
  const saveFailed = useRecording((state) => state.saveFailed)
  const audio = useRecording((state) => state.audio)
  const setTitle = useRecording((state) => state.setTitle)
  const togglePause = useRecording((state) => state.togglePause)
  const notesOpen = useRecording((state) => state.notesOpen)
  const panelTab = useRecording((state) => state.panelTab)
  const toggleNotes = useRecording((state) => state.toggleNotes)
  const analyze = useRecording((state) => state.analyze)
  const analyzing = useRecording((state) => state.analyzing)
  const analysisLimit = useRecording((state) => state.analyses.length >= ANALYSES_MAX)
  // "Analisar até agora" pede pelo menos um trecho final (sem eco, com texto).
  const canAnalyze = useTranscription((state) => state.segments.some((segment) => !segment.partial && !segment.echo && segment.text.trim() !== ''))
  const phase = capture?.phase ?? 'idle'
  const elapsed = useElapsed(session?.clock ?? null, phase === 'recording')

  const end = (): void => {
    void useRecording
      .getState()
      .end()
      .then((meeting) => {
        // Bloqueado no meio do "Encerrar" (contrato 22): o detalhe só abre depois do desbloqueio.
        if (meeting) whenUnlocked(() => void navigate(meetingPath(meeting.id), { replace: true }))
      })
  }

  // Barra de espaço alterna a pausa, fora de campo de texto e de botão (o botão já trata o espaço).
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
      event.preventDefault()
      togglePause()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, togglePause])

  // ⌘⇧N abre e fecha o painel de anotações, inclusive com o foco no texto de um card.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyN' || !event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey || event.repeat) return
      event.preventDefault()
      toggleNotes()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, toggleNotes])

  // ⌘⇧A: "Analisar até agora", inclusive com o foco no texto de um card.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyA' || !event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey || event.repeat) return
      event.preventDefault()
      analyze()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, analyze])

  if (!session || !capture || !tape) return <NoRecording />

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-phase={phase} data-mic={capture.mic} data-system={capture.system}>
      <header className="px-10 pt-7 pb-5">
        <RecordingStatus phase={phase} elapsed={elapsed} />
        <div className="mt-2.5">
          <EditableTitle value={title} onCommit={setTitle} maxLength={MEETING_TITLE_MAX} />
        </div>
      </header>
      <LevelTape session={session} tape={tape} phase={phase} micAbsent={absent(capture, 'mic')} systemAbsent={absent(capture, 'system')} />
      <Notices notices={noticesFor(capture, appName)} saveFailed={saveFailed} onRetrySave={end} audioFailed={audio === 'failed'} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TranscriptionNotices />
          <TranscriptArea />
        </div>
        {notesOpen && <NotesPanel />}
      </div>
      <ControlBar
        paused={phase === 'paused'}
        busy={saving}
        savingAudio={audio === 'recording'}
        notesOpen={notesOpen && panelTab === 'anotacoes'}
        analyzing={analyzing}
        canAnalyze={canAnalyze}
        analysisLimit={analysisLimit}
        onTogglePause={togglePause}
        onToggleNotes={toggleNotes}
        onAnalyze={analyze}
        onEnd={end}
      />
    </div>
  )
}

// Quadrado de gravação de 8 px (o quadrado do logo): pulsa em --rec gravando, parado em --text-faint.
const STATUS: Record<CapturePhase, { label: string; square: string; text: string }> = {
  idle: { label: 'Iniciando', square: 'bg-text-faint', text: 'text-text-muted' },
  recording: { label: 'Gravando', square: 'bg-rec rec-pulse', text: 'text-rec' },
  paused: { label: 'Pausado', square: 'bg-text-faint', text: 'text-text-muted' },
  stopping: { label: 'Encerrando', square: 'bg-text-faint', text: 'text-text-muted' },
  stopped: { label: 'Encerrada', square: 'bg-text-faint', text: 'text-text-muted' },
}

function RecordingStatus({ phase, elapsed }: { phase: CapturePhase; elapsed: number }) {
  const status = STATUS[phase]
  return (
    <p className="flex h-5 items-center gap-3" aria-live="polite">
      <span aria-hidden="true" data-rec-square className={`size-2 ${status.square}`} />
      <span data-status className={`text-13 font-medium ${status.text}`}>
        {status.label}
      </span>
      <span className="text-15 font-medium text-text tabular" aria-label="Tempo gravado">
        {formatElapsed(elapsed)}
      </span>
    </p>
  )
}

/** A rota de gravação sem gravação em andamento (só se alcança voltando a ela depois de encerrar). */
function NoRecording() {
  const startRecording = useStartRecording()
  const startFailed = useRecording((state) => state.startFailed)
  const retryStart = useRecording((state) => state.retryStart)
  return (
    <div className="flex flex-1 flex-col px-10 pt-7 pb-10">
      {startFailed && <RetryNotice id="start-failed" text="Não foi possível preparar a gravação." onRetry={() => void retryStart()} />}
      <div className="grow-[3]" />
      <EmptyState
        illustration={<SilentTapeIllustration />}
        title="Nenhuma gravação em andamento"
        action={
          <Button action="new-recording" onClick={startRecording} icon={Plus} shortcut="⌘N" ariaShortcut="Meta+N">
            Nova gravação
          </Button>
        }
      >
        Comece uma gravação para ver aqui o nível da sua voz e o dos participantes.
      </EmptyState>
      <div className="grow-[7]" />
    </div>
  )
}
