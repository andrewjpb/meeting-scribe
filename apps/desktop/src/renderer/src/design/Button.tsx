import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Shortcut } from './Shortcut'

type Variant = 'primary' | 'secondary' | 'danger'

interface ButtonProps {
  children: ReactNode
  onClick: () => void
  variant?: Variant
  icon?: LucideIcon
  /** Atalho exibido à direita do rótulo, no formato do macOS (`⌘N`). */
  shortcut?: string
  /** Mesmo atalho no formato de `aria-keyshortcuts` (`Meta+N`). */
  ariaShortcut?: string
  /** Nome estável da ação (`data-action`), para o smoke achar o botão. */
  action?: string
  disabled?: boolean
}

// Primário: bloco azul (--accent) com texto --on-accent. Secundário: contorno, texto em --title.
// Perigo: só o texto em --rec, sem contorno (o "Excluir" dos mockups).
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90 active:opacity-80',
  secondary: 'border border-line-strong bg-bg-raised text-title hover:bg-bg-sunken active:bg-line',
  danger: 'text-rec hover:bg-bg-sunken active:bg-line',
}

export function Button({ children, onClick, variant = 'primary', icon, shortcut, ariaShortcut, action, disabled = false }: ButtonProps) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={ariaShortcut}
      className={`no-drag inline-flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-3 text-13 font-medium whitespace-nowrap transition-[opacity,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]}`}
    >
      {icon && <Icon icon={icon} />}
      <span>{children}</span>
      {shortcut && <Shortcut keys={shortcut} />}
    </button>
  )
}
