import type { LucideIcon } from 'lucide-react'

interface IconProps {
  icon: LucideIcon
  className?: string | undefined
  size?: 14 | 16
}

/** Ícone lucide no padrão do app: 16 px, traço 1,5 com pontas retas, decorativo para leitor de tela. */
export function Icon({ icon: Glyph, className, size = 16 }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    />
  )
}
