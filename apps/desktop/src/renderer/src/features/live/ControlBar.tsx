import { HardDrive, Pause, Play, ScanSearch, StickyNote } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettings } from '../../app/settingsStore'
import { Icon } from '../../design/Icon'
import { languagePairLabel, modelLabel } from './labels'

interface ControlBarProps {
  paused: boolean
  busy: boolean
  /** O áudio da reunião está indo para a pasta (contrato 07): mostra o marcador "Gravando áudio". */
  savingAudio?: boolean
  /** Painel de anotações aberto (contrato 13). */
  notesOpen?: boolean
  /** "Analisar até agora" (contrato 19): `analyzing` mostra "Analisando…"; `canAnalyze` pede um trecho final. */
  analyzing?: boolean
  canAnalyze?: boolean
  /** A gravação já tem o máximo de análises: o botão trava com o aviso. */
  analysisLimit?: boolean
  onTogglePause: () => void
  onToggleNotes?: () => void
  onAnalyze?: () => void
  onEnd: () => void
}

/**
 * Barra de controles: bloco azul (--side-bg, raio 6, sem sombra) a 24 px do rodapé com pausa, anotações
 * (contrato 13), "Analisar até agora" (contrato 19), idiomas, modelo e "Encerrar".
 */
export function ControlBar({ paused, busy, savingAudio = false, notesOpen = false, analyzing = false, canAnalyze = false, analysisLimit = false, onTogglePause, onToggleNotes, onAnalyze, onEnd }: ControlBarProps) {
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
        {onToggleNotes && (
          <BarButton action="toggle-notes" label="Anotações" onClick={onToggleNotes} disabled={busy} ariaShortcut="Meta+Shift+N" pressed={notesOpen} title="Anotações (⌘⇧N)">
            <Icon icon={StickyNote} />
          </BarButton>
        )}
        {onAnalyze && (
          <BarButton
            action="analyze-now"
            label={analyzing ? 'Analisando…' : analysisLimit ? 'Limite de análises desta reunião' : 'Analisar até agora'}
            onClick={onAnalyze}
            disabled={busy || analyzing || analysisLimit || !canAnalyze}
            ariaShortcut="Meta+Shift+A"
            busy={analyzing}
            title={canAnalyze || analyzing ? 'Perguntas em aberto e o que não ficou claro até agora (⌘⇧A)' : 'Disponível depois da primeira fala transcrita'}
          >
            <Icon icon={ScanSearch} />
          </BarButton>
        )}
        <Divider />
        <span
          className="ml-2 flex h-7 items-center rounded-[var(--radius-control)] bg-side-active px-2.5 text-12 font-medium whitespace-nowrap"
          title="Idioma falado e idioma da tradução"
        >
          {languagePairLabel(settings)}
        </span>
        {model && (
          <span
            className="block h-7 max-w-[132px] truncate rounded-[var(--radius-control)] bg-side-active px-2.5 font-mono text-11 leading-7 whitespace-nowrap text-side-muted"
            title={`Modelo de tradução: ${model}`}
          >
            {model}
          </span>
        )}
        {savingAudio && (
          <span
            data-audio-marker
            className="flex h-7 items-center gap-1.5 px-2 text-12 whitespace-nowrap text-side-muted"
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
  /** Botão que liga e desliga (painel de anotações): marcado com o fundo do item ativo. */
  pressed?: boolean
  /** Trabalhando ("Analisando…"): `aria-busy`. */
  busy?: boolean
  title?: string
}

function BarButton({ action, label, children, onClick, disabled, ariaShortcut, pressed, busy, title }: BarButtonProps) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={ariaShortcut}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      title={title}
      className={`no-drag inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-13 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active disabled:opacity-50 ${pressed ? 'bg-side-active' : ''}`}
    >
      {children}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
