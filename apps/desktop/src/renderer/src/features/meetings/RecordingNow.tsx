import { Link } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { formatElapsed } from '../../audio/clock'
import { useRecording } from '../live/recordingStore'
import { useElapsed } from '../live/useElapsed'

/**
 * "Gravando agora" no topo da lista (contrato 28, CA5): o quadrado vermelho pulsante da gravação, o título e o
 * tempo gravado ao vivo; o clique volta para a tela de gravação. Pausada, o quadrado para (como no cabeçalho dela).
 */
export function RecordingNow({ className = 'mb-7' }: { className?: string }) {
  const session = useRecording((state) => state.session)
  const title = useRecording((state) => state.title)
  const phase = useRecording((state) => state.capture?.phase ?? 'idle')
  const elapsed = useElapsed(session?.clock ?? null, phase === 'recording')
  if (!session) return null
  return (
    <Link
      to={ROUTE_PATHS.gravacao}
      data-recording-now
      draggable={false}
      className={`${className} flex max-w-[820px] items-center gap-3 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-4 py-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken`}
    >
      <span aria-hidden="true" className={`size-2 shrink-0 ${phase === 'recording' ? 'bg-rec rec-pulse' : 'bg-text-faint'}`} />
      <span className="shrink-0 text-13 font-medium text-rec">Gravando agora</span>
      <span className="min-w-0 flex-1 truncate text-15 font-medium text-text">{title}</span>
      <span data-recording-now-elapsed className="shrink-0 text-15 font-medium text-text tabular" aria-label="Tempo gravado">
        {formatElapsed(elapsed)}
      </span>
    </Link>
  )
}
