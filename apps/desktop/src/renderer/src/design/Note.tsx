import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface NoteProps {
  /** Nome estável do aviso (`data-notice`), para o smoke achar a nota. */
  id: string
  icon: LucideIcon
  children: ReactNode
  /** Link ou botão de ação à direita (use `NOTE_ACTION_CLASS`). */
  action?: ReactNode
  role?: 'alert' | 'status' | undefined
  as?: 'div' | 'li'
  /** Margens de quem usa (a nota não decide onde fica). */
  className?: string | undefined
  /**
   * Contrato 72: `stacked` põe o texto e a ação numa coluna ao lado do ícone, para um painel estreito (o editor de
   * publicação, 300 px), onde o texto quebraria para baixo do ícone.
   */
  layout?: 'inline' | 'stacked'
}

/** Classe do link ou botão de ação de uma nota: texto em --accent, sublinhado, peso 500. */
export const NOTE_ACTION_CLASS =
  'no-drag shrink-0 rounded-[var(--radius-control)] font-medium whitespace-nowrap text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

/** Aviso em linha no formato de nota dos documentos da LAP: fundo --bg-sunken e barra de 3 px em --title à esquerda. Nunca modal. */
export function Note({ id, icon, children, action, role, as: Tag = 'div', className = '', layout = 'inline' }: NoteProps) {
  if (layout === 'stacked') {
    return (
      <Tag role={role} data-notice={id} className={`flex items-start gap-2.5 border-l-3 border-title bg-bg-sunken px-3 py-2 text-13 ${className}`}>
        <Icon icon={icon} className="mt-0.5 shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="text-pretty text-text">{children}</p>
          {action}
        </div>
      </Tag>
    )
  }
  return (
    <Tag role={role} data-notice={id} className={`flex flex-wrap items-center gap-2.5 border-l-3 border-title bg-bg-sunken px-3 py-2 text-13 ${className}`}>
      <Icon icon={icon} className="shrink-0 text-text-muted" />
      <p className="min-w-0 flex-[1_1_320px] text-pretty text-text">{children}</p>
      {action}
    </Tag>
  )
}
