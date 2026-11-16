import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { SEARCH_TERM_MAX } from '@shared/meetings-overview'
import { Icon } from '../../design/Icon'
import { Shortcut } from '../../design/Shortcut'

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
}

/** Diálogo aberto na tela: o Esc é dele, não da busca. */
const DIALOG_OPEN = 'dialog[open], [role="dialog"], [role="alertdialog"]'

/**
 * "Buscar reuniões" no topo da lista (contrato 10, CA4): ⌘F foca o campo e Esc limpa a busca, com o foco
 * no campo ou fora dele (o campo só existe com a tela de Reuniões aberta), a não ser com um diálogo aberto.
 */
export function SearchField({ value, onChange }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onChange })
  useEffect(() => {
    latest.current = { value, onChange }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (event.defaultPrevented || !latest.current.value || document.querySelector(DIALOG_OPEN)) return
        event.preventDefault()
        latest.current.onChange('')
        return
      }
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      role="search"
      className="no-drag flex h-10 w-[280px] items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 text-text-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus"
    >
      <Icon icon={Search} />
      <input
        ref={input}
        type="text"
        data-search
        value={value}
        placeholder="Buscar reuniões"
        aria-label="Buscar reuniões"
        aria-keyshortcuts="Meta+F"
        autoComplete="off"
        spellCheck={false}
        maxLength={SEARCH_TERM_MAX}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-13 text-text select-text placeholder:text-text-faint focus-visible:outline-none"
      />
      {!value && <Shortcut keys="⌘F" />}
    </div>
  )
}
