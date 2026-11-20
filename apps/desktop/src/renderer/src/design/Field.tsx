// Campo de texto e seletor no padrão dos controles: 40 px de altura, raio 4, contorno --line-strong.

export const CONTROL_CLASS =
  'no-drag h-10 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-13 text-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'

interface TextFieldProps {
  id?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'search'
  placeholder?: string
  /** Sem `<label>` visível (busca), o nome vai aqui. */
  ariaLabel?: string
  /** Enter no campo. */
  onEnter?: (() => void) | undefined
  /** Saída do campo (foco foi para outro lugar). */
  onBlur?: (() => void) | undefined
  maxLength?: number | undefined
  disabled?: boolean
  /** Id do texto de apoio (`aria-describedby`). */
  describedBy?: string | undefined
  /** Contrato 69: ganchos `data-*` a mais para o smoke (`{ 'data-redes-token': '' }`). */
  data?: Readonly<Record<`data-${string}`, string>>
}

export function TextField({ id, value, onChange, type = 'text', placeholder, ariaLabel, onEnter, onBlur, maxLength, disabled = false, describedBy, data }: TextFieldProps) {
  return (
    <input
      id={id}
      {...data}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter) {
          event.preventDefault()
          onEnter()
        }
      }}
      className={`${CONTROL_CLASS} min-w-0 flex-[1_1_280px] px-3 select-text placeholder:text-text-faint`}
    />
  )
}

interface SelectProps<T extends string> {
  id?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Id do texto de apoio (`aria-describedby`). */
  describedBy?: string | undefined
}

export function Select<T extends string>({ id, value, options, onChange, describedBy }: SelectProps<T>) {
  return (
    <select
      id={id}
      value={value}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value as T)}
      className={`${CONTROL_CLASS} min-w-[240px] px-2.5`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
