import { ChevronLeft, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { MEETING_TITLE_MAX, type Meeting } from '@shared/meetings'
import { ROUTE_PATHS } from '@shared/routes'
import type { TranscriptDocument } from '@shared/transcription'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { tabPanelId, Tabs, tabId } from '../../design/Tabs'
import { AUDIO_FOLDER_FAILED_TEXT, RetryNotice } from '../live/Notices'
import { useRecording } from '../live/recordingStore'
import { TranscriptList, type TranscriptItem } from '../live/TranscriptList'
import { attendeesLabel, durationLabel, longDateLabel, timeLabel } from './format'
import { calendarOriginLabel } from '../calendar/format'
import { MeetingChatTab } from '../chat/MeetingChatTab'
import { closestSegmentId } from '../notes/noteList'
import { MeetingFiles } from './MeetingFiles'
import { useMeetingNotes } from './notesStore'
import { NotesTab } from './NotesTab'
import { SourceDots } from './SourceDots'
import { SummaryTab } from './SummaryTab'
import { useAnalyses } from './useAnalyses'
import { useSummary, type SummaryView } from './useSummary'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { MeetingWhatsAppLink } from './MeetingWhatsAppLink'

type DetailTab = 'resumo' | 'anotacoes' | 'perguntar' | 'transcricao' | 'audio'

const TABS: { value: DetailTab; label: string }[] = [
  { value: 'resumo', label: 'Resumo' },
  { value: 'anotacoes', label: 'Anotações' },
  // Contrato 25: a aba do chat da reunião tem o nome da tela, "Assistente" (o valor interno fica).
  { value: 'perguntar', label: 'Assistente' },
  { value: 'transcricao', label: 'Transcrição' },
  { value: 'audio', label: 'Áudio' },
]
const TABS_ID = 'meeting-detail'

/** Aba ao abrir: "Resumo" quando há resumo ou ele está sendo gerado; senão "Transcrição". */
export function initialDetailTab(view: SummaryView): DetailTab {
  return view.state === 'ready' || view.state === 'generating' || (view.state === 'error' && view.summary !== null) ? 'resumo' : 'transcricao'
}

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'missing' }
  | { status: 'ready'; meeting: Meeting; transcript: TranscriptDocument | null }

const itemsOf = (transcript: TranscriptDocument | null): TranscriptItem[] =>
  (transcript?.segments ?? []).map(({ id, source, speaker, startMs, text, translation, translationModel }) => ({
    id,
    source,
    speaker,
    startMs,
    text,
    translation,
    partial: false,
    translationState: translation ? 'done' : translationModel ? 'done' : 'pending',
  }))

/**
 * Detalhe da reunião: mesmo esqueleto da gravação, sem a fita ao vivo, com cinco abas (contratos 08, 13 e
 * 15): "Resumo", "Anotações" (os cards da reunião), "Assistente" (o chat só sobre esta reunião),
 * "Transcrição" (a transcrição salva) e "Áudio" (os arquivos e o que dá para baixar).
 */
export function MeetingDetailScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const summary = useSummary(id)
  /** Análises da reunião (contrato 19): aqui para a análise em curso não se perder ao trocar de aba. */
  const analyses = useAnalyses(id)
  /** Aba escolhida pela pessoa; até ela escolher, vale a aba automática. Ambas guardam de qual reunião são. */
  const [chosenTab, setChosenTab] = useState<{ id: string; tab: DetailTab } | null>(null)
  const [autoTab, setAutoTab] = useState<{ id: string; tab: DetailTab } | null>(null)
  // Aba automática: decidida quando o estado do resumo chega. O resumo que começa logo depois de abrir (ao
  // encerrar a gravação) ainda leva para "Resumo", se a pessoa não tiver escolhido outra aba.
  if (summary.view.state !== 'loading' && (autoTab?.id !== id || (summary.view.state === 'generating' && autoTab.tab !== 'resumo'))) {
    setAutoTab({ id, tab: initialDetailTab(summary.view) })
  }
  const tab: DetailTab = (chosenTab?.id === id ? chosenTab.tab : null) ?? (autoTab?.id === id ? autoTab.tab : null) ?? 'transcricao'
  /** Trecho para onde a transcrição rola depois do clique no tempo de uma anotação. */
  const [jump, setJump] = useState<{ meetingId: string; id: string; seq: number } | null>(null)

  // Leitura que falha vira aviso com "Tentar de novo", nunca tela em branco.
  useEffect(() => {
    let alive = true
    // Recusada com o app bloqueado (contrato 22): relê no desbloqueio em vez de mostrar a falha.
    let reread: (() => void) | null = null
    const read = (): void => {
      Promise.all([window.__scribeApi.invoke('scribe:meetings-get', { id }), window.__scribeApi.invoke('scribe:transcript-get', { meetingId: id })]).then(
        ([meeting, transcript]) => {
          if (alive) setLoaded(meeting ? { status: 'ready', meeting, transcript } : { status: 'missing' })
        },
        (error: unknown) => {
          if (!alive) return
          reread = rereadWhenUnlocked(error, read)
          if (!reread) setLoaded({ status: 'failed' })
        },
      )
    }
    read()
    return () => {
      alive = false
      reread?.()
    }
  }, [id, attempt])

  const retryLoad = (): void => {
    setLoaded({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  /** Operação que falhou, com o texto do aviso e como repeti-la. */
  const [failure, setFailure] = useState<{ text: string; retry: () => void } | null>(null)
  /** Esta reunião acabou de ser encerrada e o arquivo dela não foi escrito na pasta (contrato 07). */
  const filesFailed = useRecording((state) => state.filesFailedMeetingId === id)
  /** As anotações desta reunião não foram salvas depois da nova tentativa (contrato 13): aviso em qualquer aba. */
  const notesSaveFailed = useMeetingNotes((state) => state.meetings[id]?.saveFailed === true)
  /** Uma análise da gravação terminou depois do "Encerrar" e não entrou nesta reunião (contrato 19). */
  const analysisUnsaved = useRecording((state) => state.unsavedAnalyses.some((entry) => entry.meetingId === id))

  const rename = (title: string): void => {
    setFailure(null)
    window.__scribeApi.invoke('scribe:meetings-rename', { id, title }).then(
      (meeting) => {
        if (meeting) setLoaded((current) => (current.status === 'ready' ? { ...current, meeting } : current))
      },
      () => setFailure({ text: 'Não foi possível renomear a reunião.', retry: () => rename(title) }),
    )
  }

  const remove = async (): Promise<void> => {
    setFailure(null)
    // Edição de anotação esperando para salvar não grava numa reunião que está saindo.
    useMeetingNotes.getState().forget(id)
    try {
      await window.__scribeApi.invoke('scribe:meetings-delete', { id })
    } catch {
      setFailure({ text: 'Não foi possível excluir a reunião.', retry: () => void remove() })
      void useMeetingNotes.getState().load(id)
      return
    }
    void navigate(ROUTE_PATHS.reunioes, { replace: true })
  }

  if (loaded.status === 'loading' || (loaded.status === 'ready' && summary.view.state === 'loading')) return <div className="flex-1" aria-busy="true" />

  const ready = loaded.status === 'ready' ? loaded : null
  const items = itemsOf(ready?.transcript ?? null)

  const jumpTo = (atMs: number): void => {
    const target = closestSegmentId(items, atMs)
    setChosenTab({ id, tab: 'transcricao' })
    if (target) setJump((current) => ({ meetingId: id, id: target, seq: (current?.seq ?? 0) + 1 }))
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-meeting={ready ? ready.meeting.id : ''}>
      <header className={`border-b border-line px-10 pt-6 ${ready ? '' : 'pb-5'}`}>
        <Link
          to={ROUTE_PATHS.reunioes}
          draggable={false}
          className="no-drag inline-flex h-4 items-center gap-1.5 rounded-[var(--radius-control)] pr-1 text-12 text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
        >
          <Icon icon={ChevronLeft} size={14} />
          Reuniões
        </Link>
        {ready ? (
          <>
            <MeetingHeader meeting={ready.meeting} transcript={ready.transcript} onRename={rename} onDelete={remove} hasTranscript={items.length > 0 && tab === 'transcricao'} />
            <div className="mt-4">
              <Tabs value={tab} tabs={TABS} onChange={(value) => setChosenTab({ id, tab: value })} label="Conteúdo da reunião" id={TABS_ID} />
            </div>
          </>
        ) : loaded.status === 'missing' ? (
          <div className="mt-1.5">
            <h1 className="text-20 font-bold tracking-[-0.3px] text-title">Reunião não encontrada</h1>
            <p className="mt-1.5 text-12 text-text-muted">Ela pode ter sido excluída.</p>
          </div>
        ) : null}
      </header>
      {loaded.status === 'failed' && (
        <RetryNotice id="detail-load-failed" text="Não foi possível abrir a reunião." onRetry={retryLoad} className="mx-10 mt-4" />
      )}
      {failure && <RetryNotice id="detail-failed" text={failure.text} onRetry={failure.retry} className="mx-10 mt-4" />}
      {ready && notesSaveFailed && (
        <RetryNotice id="notes-save-failed" text="Não foi possível salvar as anotações." onRetry={() => void useMeetingNotes.getState().flush(id)} className="mx-10 mt-4" />
      )}
      {ready && analysisUnsaved && (
        <RetryNotice id="analysis-unsaved" text="Uma análise não foi salva." onRetry={() => void useRecording.getState().retryUnsavedAnalyses(id)} className="mx-10 mt-4" />
      )}
      {ready && filesFailed && (
        <Note id="audio-folder-failed" icon={TriangleAlert} className="mx-10 mt-4">
          {AUDIO_FOLDER_FAILED_TEXT}
        </Note>
      )}
      {/* Contrato 24: a conversa do WhatsApp ligada à reunião (só com o WhatsApp conectado ou já ligada). */}
      {ready && <MeetingWhatsAppLink meetingId={ready.meeting.id} />}
      {ready && (
        <div role="tabpanel" id={tabPanelId(TABS_ID, tab)} aria-labelledby={tabId(TABS_ID, tab)} data-tab-panel={tab} className="flex min-h-0 flex-1 flex-col">
          {tab === 'resumo' && <SummaryTab meetingId={ready.meeting.id} view={summary.view} onGenerate={summary.generate} analyses={analyses} onJump={jumpTo} />}
          {tab === 'anotacoes' && <NotesTab meetingId={ready.meeting.id} onJump={jumpTo} />}
          {tab === 'perguntar' && <MeetingChatTab meetingId={ready.meeting.id} />}
          {tab === 'transcricao' &&
            (items.length > 0 ? (
              <TranscriptList items={items} jumpTo={jump?.meetingId === id ? jump : null} />
            ) : (
              <div className="min-h-0 flex-1 px-10 pb-10">
                <div className="mx-auto w-full max-w-[680px] pt-7">
                  <p className="text-13 text-pretty text-text-muted">
                    {ready.meeting.audioPath ? 'Esta reunião foi gravada sem transcrição.' : 'Esta reunião foi gravada sem transcrição. O áudio não fica guardado no Mac.'}
                  </p>
                </div>
              </div>
            ))}
          {tab === 'audio' && (
            <MeetingFiles
              meetingId={ready.meeting.id}
              hasFiles={ready.meeting.audioPath !== null || ready.meeting.transcriptPath !== null}
              hasTranscript={items.length > 0}
              hasSummary={summary.view.state === 'ready' || (summary.view.state === 'error' && summary.view.summary !== null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MeetingHeader({
  meeting,
  transcript,
  onRename,
  onDelete,
  hasTranscript,
}: {
  meeting: Meeting
  transcript: TranscriptDocument | null
  onRename: (title: string) => void
  onDelete: () => Promise<void>
  hasTranscript: boolean
}) {
  const started = new Date(meeting.startedAt)
  // Contrato 12 (CA9): de que evento da agenda a reunião veio e os participantes dele.
  const origin = calendarOriginLabel(meeting.calendar)
  const attendees = (meeting.calendar?.attendees ?? []).map((person) => person.name || person.email)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    window.__scribeApi.invoke('scribe:transcript-copy', { meetingId: meeting.id }).then(
      (result) => {
        setCopyState(result === 'copied' ? 'copied' : 'failed')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopyState('idle'), 2500)
      },
      () => setCopyState('failed'),
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <EditableTitle value={meeting.title} onCommit={onRename} maxLength={MEETING_TITLE_MAX} />
        <div className="flex flex-wrap items-center gap-2 text-12 text-text-muted tabular">
          <span>
            {longDateLabel(started)} · {timeLabel(started)} · {durationLabel(meeting.durationMs)}
          </span>
          <SourceDots sources={meeting.sources} />
          {transcript?.targetLanguage && (
            <span className="inline-flex h-[22px] items-center rounded-[var(--radius-control)] bg-bg-sunken px-2 font-medium">
              {transcript.sourceLanguage.toUpperCase()} → {transcript.targetLanguage.toUpperCase()}
            </span>
          )}
          {transcript?.translationModel && (
            <span className="inline-flex h-[22px] items-center rounded-[var(--radius-control)] bg-bg-sunken px-2 font-mono text-11">{transcript.translationModel}</span>
          )}
        </div>
        {(origin || attendees.length > 0) && (
          <p className="text-12 text-text-muted" data-calendar-origin>
            {origin}
            {origin && attendees.length > 0 && ' · '}
            {attendees.length > 0 && <span data-calendar-attendees>{attendeesLabel(attendees, 8)}</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hasTranscript && (
          <Button action="copy-transcript" variant="secondary" icon={Copy} onClick={copy}>
            {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Não copiou' : 'Copiar transcrição'}
          </Button>
        )}
        <DeleteAction onDelete={onDelete} keepsFiles={meeting.audioPath !== null || meeting.transcriptPath !== null} />
      </div>
    </div>
  )
}

/** "Excluir" com confirmação na própria linha, sem diálogo. Os arquivos da pasta nunca são apagados. */
function DeleteAction({ onDelete, keepsFiles }: { onDelete: () => Promise<void>; keepsFiles: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <Button action="delete-meeting" variant="danger" onClick={() => setConfirming(true)}>
        Excluir
      </Button>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Confirmar exclusão">
      <p className="mr-1 text-13 text-text">{keepsFiles ? 'Excluir esta reunião? Os arquivos na pasta continuam.' : 'Excluir esta reunião?'}</p>
      <Button action="cancel-delete" variant="secondary" onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
      <Button
        action="confirm-delete"
        variant="danger"
        onClick={() => {
          if (busy) return
          setBusy(true)
          void onDelete().finally(() => setBusy(false))
        }}
      >
        Excluir
      </Button>
    </div>
  )
}
