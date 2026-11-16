import { TriangleAlert } from 'lucide-react'
import type { MouseEvent } from 'react'
import { PRIVACY_PANE_URLS } from '@shared/privacy'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import type { Notice } from './noticeRules'

/** Texto do aviso quando a pasta dos arquivos da reunião não aceita escrita (contrato 07). */
export const AUDIO_FOLDER_FAILED_TEXT = 'Não foi possível salvar o áudio nesta pasta. A transcrição continua.'

interface NoticesProps {
  notices: Notice[]
  saveFailed: boolean
  onRetrySave: () => void
  /** O arquivo da reunião não pôde ser escrito na pasta; a gravação segue. */
  audioFailed?: boolean
}

/** Avisos logo abaixo da fita, um por nota: ícone, texto e ação. Nunca modal. */
export function Notices({ notices, saveFailed, onRetrySave, audioFailed = false }: NoticesProps) {
  if (!notices.length && !saveFailed && !audioFailed) return null
  return (
    <ul aria-live="polite" className="mx-10 mt-4 flex flex-col gap-2">
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} />
      ))}
      {audioFailed && (
        <Note as="li" id="audio-folder-failed" icon={TriangleAlert}>
          {AUDIO_FOLDER_FAILED_TEXT}
        </Note>
      )}
      {saveFailed && (
        <Note as="li" id="save-failed" icon={TriangleAlert} action={<ActionLink onClick={onRetrySave}>Tentar de novo</ActionLink>}>
          Não foi possível salvar a reunião.
        </Note>
      )}
    </ul>
  )
}

/** Aviso em linha de uma operação que falhou, com "Tentar de novo". Nunca modal. */
export function RetryNotice({ id, text, onRetry, className }: { id: string; text: string; onRetry: () => void; className?: string }) {
  return (
    <Note role="alert" id={id} icon={TriangleAlert} action={<ActionLink onClick={onRetry}>Tentar de novo</ActionLink>} className={className}>
      {text}
    </Note>
  )
}

function NoticeRow({ notice }: { notice: Notice }) {
  const { pane } = notice
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    if (pane) window.__scribeApi.send('scribe:open-privacy-settings', pane)
  }
  return (
    <Note
      as="li"
      id={notice.id}
      icon={TriangleAlert}
      action={
        pane && (
          <a href={PRIVACY_PANE_URLS[pane]} onClick={open} draggable={false} className={NOTE_ACTION_CLASS}>
            Abrir Ajustes do Sistema
          </a>
        )
      }
    >
      {notice.text}
    </Note>
  )
}

function ActionLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={NOTE_ACTION_CLASS}>
      {children}
    </button>
  )
}
