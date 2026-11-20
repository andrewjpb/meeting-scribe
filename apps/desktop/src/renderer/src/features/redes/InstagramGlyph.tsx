/**
 * Contrato 72: o glifo do Instagram no traço dos ícones do app (o `lucide-react` não traz mais ícones de marca): 16 px
 * (contrato 76: 14 px nos cartões do Assistente), traço 1,5, pontas retas, na cor do texto. Decorativo para leitor de tela (o @ da conta vai ao lado).
 */
export function InstagramGlyph({ className, size = 16 }: { className?: string; size?: 14 | 16 | 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size === 24 ? 1.25 : 1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" />
      <circle cx="12" cy="12" r="4.25" />
      <path d="M17.5 6.5h.01" />
    </svg>
  )
}
