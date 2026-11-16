import { useState, type KeyboardEvent } from 'react'

interface EditableTitleProps {
  value: string
  onCommit: (value: string) => void
  maxLength: number
  /** Nome do campo para o leitor de tela. */
  label?: string
}

const TITLE_CLASS = 'text-20 font-bold tracking-[-0.3px] text-title'

/** Título da reunião (20/26, negrito azul) que vira campo ao clicar. Enter confirma, Esc cancela. */
export function EditableTitle({ value, onCommit, maxLength, label = 'Título da reunião' }: EditableTitleProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft === null) return
    const next = draft.trim()
    setDraft(null)
    if (next && next !== value) onCommit(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    }
  }

  if (draft !== null) {
    return (
      <input
        // Campo aberto pelo próprio clique do usuário: o foco vai para ele.
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.target.select()}
        className={`no-drag -mx-1.5 w-full rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-1.5 outline-none select-text focus-visible:outline-2 ${TITLE_CLASS}`}
      />
    )
  }

  return (
    <h1 className="min-w-0">
      <button
        type="button"
        title="Clique para renomear"
        onClick={() => setDraft(value)}
        className={`no-drag -mx-1.5 max-w-full truncate rounded-[var(--radius-control)] border border-transparent px-1.5 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken ${TITLE_CLASS}`}
      >
        {value}
      </button>
    </h1>
  )
}
