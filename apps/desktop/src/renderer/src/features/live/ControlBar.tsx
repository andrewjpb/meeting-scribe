import { HardDrive, Pause, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettings } from '../../app/settingsStore'
import { Icon } from '../../design/Icon'
import { languagePairLabel, modelLabel } from './labels'

interface ControlBarProps {
  paused: boolean
  busy: boolean
  /** O áudio da reunião está indo para a pasta (contrato 07): mostra o marcador "Gravando áudio". */
  savingAudio?: boolean
  onTogglePause: () => void
  onEnd: () => void
}

/** Barra de controles: bloco azul (--side-bg, raio 6, sem sombra) a 24 px do rodapé com pausa, idiomas, modelo e "Encerrar". */
export function ControlBar({ paused, busy, savingAudio = false, onTogglePause, onEnd }: ControlBarProps) {
  // Idiomas e modelo como estão em Configurações (mudam na hora se alguém trocar durante a gravação).
  const settings = useSettings((state) => state.settings)
  const model = modelLabel(settings)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Controles da gravação"
        className="on-side pointer-events-auto flex items-center gap-1 rounded-[var(--radius-panel)] border border-side-edge bg-side-bg p-1.5 text-side-text"
      >
        <BarButton action="toggle-pause" label={paused ? 'Retomar' : 'Pausar'} onClick={onTogglePause} disabled={busy} ariaShortcut="Space">
          {/* Cheio, como nos mockups: o contorno de 1,5 px some no azul. */}
          <Icon icon={paused ? Play : Pause} className="fill-current" />
        </BarButton>
        <Divider />
        <span
          className="ml-2 flex h-7 items-center rounded-[var(--radius-control)] bg-side-active px-2.5 text-12 font-medium"
          title="Idioma falado e idioma da tradução"
        >
          {languagePairLabel(settings)}
        </span>
        {model && (
          <span
            className="flex h-7 items-center rounded-[var(--radius-control)] bg-side-active px-2.5 font-mono text-11 text-side-muted"
            title="Modelo de tradução"
          >
            {model}
          </span>
        )}
        {savingAudio && (
          <span
            data-audio-marker
            className="flex h-7 items-center gap-1.5 px-2 text-12 text-side-muted"
            title="O áudio da reunião está sendo salvo na pasta escolhida em Configurações"
          >
            <Icon icon={HardDrive} size={14} />
            Gravando áudio
          </span>
        )}
        <span aria-hidden="true" className="w-1" />
        <Divider />
        <BarButton action="end-recording" label="Encerrar" onClick={onEnd} disabled={busy}>
          <span aria-hidden="true" className="size-2 bg-side-rec" />
        </BarButton>
      </div>
    </div>
  )
}

function Divider() {
  return <span aria-hidden="true" className="h-6 w-px bg-side-divider" />
}

interface BarButtonProps {
  action: string
  label: string
  /** Ícone ou quadrado antes do rótulo. */
  children: ReactNode
  onClick: () => void
  disabled: boolean
  ariaShortcut?: string
}

function BarButton({ action, label, children, onClick, disabled, ariaShortcut }: BarButtonProps) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={ariaShortcut}
      className="no-drag inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-13 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active disabled:opacity-50"
    >
      {children}
      <span>{label}</span>
    </button>
  )
}
