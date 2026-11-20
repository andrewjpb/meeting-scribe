import { HardDrive, Lock, Mic, MicOff, Pause, Play, ScanSearch, StickyNote } from 'lucide-react'
import type { ReactNode } from 'react'
import { LOCK_DISABLED_HINT } from '@shared/lock'
import { useLock } from '../../app/lockStore'
import { useSettings } from '../../app/settingsStore'
import { Icon } from '../../design/Icon'
import { languagePairLabel, modelLabel } from './labels'

interface ControlBarProps {
  paused: boolean
  /** "Ouvir só os participantes" (contrato 29): o microfone desta gravação está desligado. */
  micOff?: boolean
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
  onToggleMic?: () => void
  onToggleNotes?: () => void
  onAnalyze?: () => void
  onEnd: () => void
}

/**
 * Barra de controles: bloco azul (--side-bg, raio 6, sem sombra) a 24 px do rodapé com pausa, o microfone
 * ("Ouvir só os participantes", contrato 29, só o ícone para caber em 1120 px), anotações
 * (contrato 13), "Analisar até agora" (contrato 19), idiomas, modelo, "Bloquear" (contrato 22, a gravação
 * continua) e "Encerrar".
 */
export function ControlBar({
  paused,
  micOff = false,
  busy,
  savingAudio = false,
  notesOpen = false,
  analyzing = false,
  canAnalyze = false,
  analysisLimit = false,
  onTogglePause,
  onToggleMic,
  onToggleNotes,
  onAnalyze,
  onEnd,
}: ControlBarProps) {
  // Idiomas e modelo como estão em Configurações (mudam na hora se alguém trocar durante a gravação).
  const settings = useSettings((state) => state.settings)
  const model = modelLabel(settings)
  const canLock = useLock((state) => state.status.canLock)
  const lock = useLock((state) => state.lock)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Controles da gravação"
        className="on-side pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-[var(--radius-panel)] border border-side-edge bg-side-bg p-1 text-side-text"
      >
        <BarButton action="toggle-pause" label={paused ? 'Retomar' : 'Pausar'} onClick={onTogglePause} disabled={busy} ariaShortcut="Space">
          {/* Cheio, como nos mockups: o contorno de 1,5 px some no azul. */}
          <Icon icon={paused ? Play : Pause} className="fill-current" />
        </BarButton>
        {onToggleMic && (
          <BarButton
            action="mic-off"
            label={micOff ? 'Voltar a me ouvir' : 'Ouvir só os participantes'}
            title={micOff ? 'Voltar a me ouvir' : 'Ouvir só os participantes'}
            iconOnly
            pressed={micOff}
            onClick={onToggleMic}
            disabled={busy}
          >
            <Icon icon={micOff ? MicOff : Mic} />
          </BarButton>
        )}
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
          className="ml-2 flex h-6 items-center rounded-[var(--radius-control)] bg-side-active px-2 text-12 font-medium whitespace-nowrap"
          title="Idioma falado e idioma da tradução"
        >
          {languagePairLabel(settings)}
        </span>
        {model && (
          <span
            className="block h-6 min-w-0 max-w-[132px] truncate rounded-[var(--radius-control)] bg-side-active px-2 font-mono text-11 leading-6 whitespace-nowrap text-side-muted"
            title={`Modelo de tradução: ${model}`}
          >
            {model}
          </span>
        )}
        {savingAudio && (
          <span
            data-audio-marker
            className="flex h-6 items-center gap-1.5 px-2 text-12 whitespace-nowrap text-side-muted"
            title="O áudio da reunião está sendo salvo na pasta escolhida em Configurações"
          >
            <Icon icon={HardDrive} size={14} />
            Gravando áudio
          </span>
        )}
        <span aria-hidden="true" className="w-1" />
        <Divider />
        {/* Bloquear não para nem pausa a gravação. Desabilitado, o `title` fica no contêiner (botão desabilitado não mostra dica). */}
        <span title={canLock ? 'Bloquear o app; a gravação continua (⌘⇧L)' : LOCK_DISABLED_HINT} className="flex">
          <BarButton action="lock-app-recording" label="Bloquear" iconOnly onClick={() => void lock()} disabled={!canLock} ariaShortcut="Meta+Shift+L">
            <Icon icon={Lock} />
          </BarButton>
        </span>
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
  /** Só o ícone na barra (o rótulo fica para o leitor de tela): "Bloquear", para a barra caber em 1120 px. */
  iconOnly?: boolean
}

function BarButton({ action, label, children, onClick, disabled, ariaShortcut, pressed, busy, title, iconOnly = false }: BarButtonProps) {
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
      className={`no-drag inline-flex h-8 items-center gap-2 rounded-[var(--radius-control)] ${iconOnly ? 'w-8 justify-center' : 'px-3'} text-13 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active disabled:opacity-50 ${pressed ? 'bg-side-active' : ''}`}
    >
      {children}
      <span className={iconOnly ? 'sr-only' : 'whitespace-nowrap'}>{label}</span>
    </button>
  )
}
