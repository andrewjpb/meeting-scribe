import { Lock } from 'lucide-react'
import { LOCK_DISABLED_HINT } from '@shared/lock'
import { Icon } from '../design/Icon'
import { Shortcut } from '../design/Shortcut'
import { useLock } from './lockStore'

/**
 * "Bloquear" no rodapé da barra lateral (contrato 22, CA2), no formato dos itens de navegação. Sem senha e
 * sem Touch ID fica desabilitado, com a dica de onde criar a senha.
 */
export function LockButton() {
  const canLock = useLock((state) => state.status.canLock)
  const lock = useLock((state) => state.lock)
  return (
    <div title={canLock ? 'Bloquear (⌘⇧L)' : LOCK_DISABLED_HINT} className="mb-1 flex">
      <button
        type="button"
        data-action="lock-app"
        disabled={!canLock}
        aria-keyshortcuts="Meta+Shift+L"
        aria-describedby={canLock ? undefined : 'lock-disabled-hint'}
        onClick={() => void lock()}
        className="no-drag flex h-[var(--side-subrow)] grow items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-13 text-side-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-side-text disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon icon={Lock} className="shrink-0" />
        <span className="grow text-left">Bloquear</span>
        <Shortcut keys="⌘⇧L" />
      </button>
      {!canLock && (
        <span id="lock-disabled-hint" className="sr-only">
          {LOCK_DISABLED_HINT}
        </span>
      )}
    </div>
  )
}
