import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MeetingDownloadKind, MeetingFileInfo, MeetingFileKind, MeetingFilesInfo } from '@shared/meeting-files'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { DriveStatusRow } from './DriveStatusRow'

const LABELS: Record<MeetingFileKind, { name: string; missing: string }> = {
  audio: { name: 'Áudio', missing: 'Áudio não encontrado em' },
  transcript: { name: 'Transcrição', missing: 'Transcrição não encontrada em' },
}

const DOWNLOAD_LABELS: Record<MeetingDownloadKind, string> = {
  audio: 'Baixar áudio…',
  transcript: 'Baixar transcrição…',
  summary: 'Baixar resumo…',
}

const ACTION_CLASS =
  'no-drag shrink-0 rounded-[var(--radius-control)] text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

const ROW_CLASS = 'flex min-h-8 items-center gap-4 border-t border-line py-1.5 first:border-t-0'

/**
 * Aba "Áudio" (contrato 08, CA7). Com os arquivos da pasta (contrato 07): uma linha para o áudio e outra
 * para a transcrição, com "Abrir", "Mostrar no Finder" e "Baixar…"; arquivo apagado ou movido diz onde
 * deveria estar. Sem arquivos: o aviso de que o áudio não fica guardado e a transcrição para baixar em
 * Markdown. O resumo, quando existe, também pode ser baixado. Os caminhos ficam no main: o renderer só
 * pede pela reunião e pelo tipo. Por último, o estado da reunião no Google Drive (contrato 11).
 */
export function MeetingFiles({ meetingId, hasFiles, hasTranscript, hasSummary }: { meetingId: string; hasFiles: boolean; hasTranscript: boolean; hasSummary: boolean }) {
  const [info, setInfo] = useState<MeetingFilesInfo | null>(null)

  useEffect(() => {
    if (!hasFiles) return
    let alive = true
    let reread: (() => void) | null = null
    const read = (): void => {
      window.__scribeApi.invoke('scribe:meeting-files', { meetingId }).then(
        (result) => {
          if (alive) setInfo(result)
        },
        // Recusada com o app bloqueado (contrato 22): relê no desbloqueio.
        (error: unknown) => {
          if (alive) reread = rereadWhenUnlocked(error, read)
        },
      )
    }
    read()
    return () => {
      alive = false
      reread?.()
    }
  }, [meetingId, hasFiles])

  const generated: MeetingDownloadKind[] = [...(!hasFiles && hasTranscript ? (['transcript'] as const) : []), ...(hasSummary ? (['summary'] as const) : [])]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-10">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 pt-7">
        {!hasFiles && <p className="text-13 text-pretty text-text-muted">O áudio não fica guardado no Mac.</p>}
        {hasFiles && info && (
          <ul data-meeting-files aria-label="Arquivos da reunião" className="flex flex-col">
            {info.audio && <FileRow kind="audio" file={info.audio} folder={info.folder} meetingId={meetingId} />}
            {info.transcript && <FileRow kind="transcript" file={info.transcript} folder={info.folder} meetingId={meetingId} />}
          </ul>
        )}
        {generated.length > 0 && (
          <ul data-meeting-downloads aria-label="Baixar em Markdown" className="flex flex-col">
            {generated.map((kind) => (
              <li key={kind} data-download={kind} className={ROW_CLASS}>
                <span className="w-24 shrink-0 text-12 font-medium text-text-muted">{kind === 'summary' ? 'Resumo' : 'Transcrição'}</span>
                <span className="min-w-0 flex-1 truncate text-13 text-text-muted">Texto em Markdown</span>
                <DownloadButton meetingId={meetingId} kind={kind} />
              </li>
            ))}
          </ul>
        )}
        {/* Contrato 11: o estado no Google Drive, com "Abrir no Drive" ou "Tentar de novo". */}
        <ul data-meeting-drive aria-label="Google Drive" className="flex flex-col empty:hidden">
          <DriveStatusRow meetingId={meetingId} rowClass={ROW_CLASS} actionClass={ACTION_CLASS} />
        </ul>
      </div>
    </div>
  )
}

function ActionButton({ action, onClick, children }: { action: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" data-action={action} onClick={onClick} className={ACTION_CLASS}>
      {children}
    </button>
  )
}

/** "Baixar…": o diálogo de salvar abre no main; depois de salvar, o rótulo diz "Salvo" por um instante. */
function DownloadButton({ meetingId, kind }: { meetingId: string; kind: MeetingDownloadKind }) {
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const download = (): void => {
    const show = (next: 'saved' | 'failed'): void => {
      setState(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2500)
    }
    window.__scribeApi.invoke('scribe:meeting-file-download', { meetingId, kind }).then(
      (result) => {
        if (result === 'saved') show('saved')
        else if (result !== 'canceled') show('failed')
      },
      () => show('failed'),
    )
  }

  return (
    <ActionButton action={`download-${kind}`} onClick={download}>
      {state === 'saved' ? 'Salvo' : state === 'failed' ? 'Não salvou' : DOWNLOAD_LABELS[kind]}
    </ActionButton>
  )
}

function FileRow({ kind, file, folder, meetingId }: { kind: MeetingFileKind; file: MeetingFileInfo; folder: string; meetingId: string }) {
  const label = LABELS[kind]
  const open = (): void => void window.__scribeApi.invoke('scribe:meeting-file-open', { meetingId, kind }).catch(() => undefined)
  const reveal = (): void => void window.__scribeApi.invoke('scribe:meeting-file-reveal', { meetingId, kind }).catch(() => undefined)
  return (
    <li data-file={kind} data-exists={file.exists} className={ROW_CLASS}>
      <span className="w-24 shrink-0 text-12 font-medium text-text-muted">{label.name}</span>
      {file.exists ? (
        <>
          <span data-file-name className="min-w-0 flex-1 truncate text-13 text-text" title={file.name}>
            {file.name}
          </span>
          <ActionButton action={`open-${kind}`} onClick={open}>
            Abrir
          </ActionButton>
          <ActionButton action={`reveal-${kind}`} onClick={reveal}>
            Mostrar no Finder
          </ActionButton>
          <DownloadButton meetingId={meetingId} kind={kind} />
        </>
      ) : (
        <span data-file-missing className="min-w-0 flex-1 truncate text-13 text-text-muted" title={folder}>
          {label.missing} {folder}
        </span>
      )}
    </li>
  )
}
