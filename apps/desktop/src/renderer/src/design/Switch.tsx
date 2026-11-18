interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Id do texto que nomeia o alternador (o nome da linha de configuração). */
  labelledBy: string
  disabled?: boolean
  /** `data-action` do botão (o smoke e os atalhos acham por ele). */
  action?: string
}

/** Alternador quadrado (44 × 24, raio 4): desligado em --bg-sunken, ligado em --accent. */
export function Switch({ checked, onChange, labelledBy, disabled = false, action }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      {...(action ? { 'data-action': action } : {})}
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`no-drag flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-control)] border p-[3px] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:opacity-50 ${
        checked ? 'justify-end border-accent bg-accent' : 'justify-start border-line-strong bg-bg-sunken'
      }`}
    >
      <span aria-hidden="true" className={`size-4 rounded-[2px] ${checked ? 'bg-on-accent' : 'bg-text-muted'}`} />
    </button>
  )
}
