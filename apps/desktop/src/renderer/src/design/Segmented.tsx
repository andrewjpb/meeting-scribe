interface SegmentedProps<T extends string> {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Id do nome da linha (`aria-labelledby`). */
  labelledBy: string
  /** Nome do atributo de cada opção (`data-<name>="<valor>"`), para o smoke achar o botão. */
  dataName: string
  /** Contrato 157: o controle inteiro desligado (opacidade 0,5, sem clique), como o `Switch`. */
  disabled?: boolean
}

/** Controle segmentado: botões lado a lado com contorno --line-strong; o marcado em bloco --title. */
export function Segmented<T extends string>({ value, options, onChange, labelledBy, dataName, disabled = false }: SegmentedProps<T>) {
  return (
    <div role="group" aria-labelledby={labelledBy} aria-disabled={disabled || undefined} className={`flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong ${disabled ? 'opacity-50' : ''}`}>
      {options.map((option, index) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            {...{ [`data-${dataName}`]: option.value }}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`no-drag h-7 px-3 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${
              index > 0 ? 'border-l border-line-strong' : ''
            } ${active ? 'bg-title font-medium text-bg' : 'bg-bg-raised text-text hover:bg-bg-sunken'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
