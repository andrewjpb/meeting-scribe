import { useRef, type KeyboardEvent } from 'react'

interface TabsProps<T extends string> {
  /** Aba atual; `null` deixa nenhuma marcada (ex.: durante uma busca), com a primeira na ordem do Tab. */
  value: T | null
  tabs: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Nome da lista de abas para leitores de tela. */
  label: string
  /** Prefixo dos ids de cada aba e painel (`<id>-tab-<valor>`, `<id>-panel-<valor>`). */
  id: string
}

export const tabId = (id: string, value: string): string => `${id}-tab-${value}`
export const tabPanelId = (id: string, value: string): string => `${id}-panel-${value}`

/**
 * Abas em linha, sem pílula nem sombra: rótulo 13/500 em --text-muted; a aba atual em --title com o
 * sublinhado de 2 px em --accent, que pousa sobre o fio de baixo do cabeçalho. Setas esquerda e direita,
 * Home e End trocam de aba.
 */
export function Tabs<T extends string>({ value, tabs, onChange, label, id }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((tab) => tab.value === value)
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
    const tab = tabs[next]
    if (next === -1 || !tab) return
    event.preventDefault()
    onChange(tab.value)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mb-px flex gap-5">
      {tabs.map((tab, index) => {
        const active = tab.value === value
        const reachable = active || (value === null && index === 0)
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.value)}
            data-tab={tab.value}
            aria-selected={active}
            aria-controls={tabPanelId(id, tab.value)}
            tabIndex={reachable ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`no-drag h-8 border-b-2 text-13 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${
              active ? 'border-accent text-title' : 'border-transparent text-text-muted hover:text-title'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
