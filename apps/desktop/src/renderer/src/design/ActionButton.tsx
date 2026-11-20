import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

/**
 * Botão da barra de ações da leitura: compacto (28 px), ícone e rótulo, como o "Detalhes" do WhatsApp. `iconOnly`: só
 * o ícone, com o rótulo no `aria-label` e na dica (CA7: as ações secundárias, para a barra caber numa linha).
 */
export function ActionButton({
  icon,
  label,
  action,
  onClick,
  tone = 'normal',
  iconOnly = false,
  disabled = false,
  data,
}: {
  icon: LucideIcon
  label: string
  action: string
  onClick: () => void
  tone?: 'normal' | 'danger'
  iconOnly?: boolean
  disabled?: boolean
  /** Contrato 72: ganchos `data-*` a mais para o smoke (`{ 'data-redes-pub-action': 'editar' }`), como no `Button`. */
  data?: Readonly<Record<`data-${string}`, string>>
}) {
  return (
    <button
      type="button"
      data-action={action}
      {...data}
      onClick={onClick}
      disabled={disabled}
      {...(iconOnly ? { 'aria-label': label, title: label } : {})}
      className={`no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong text-12 font-medium whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none disabled:opacity-50 ${iconOnly ? 'w-7 justify-center' : 'px-2'} ${tone === 'danger' ? 'text-rec' : 'text-title'}`}
    >
      <Icon icon={icon} size={14} />
      {!iconOnly && label}
    </button>
  )
}
