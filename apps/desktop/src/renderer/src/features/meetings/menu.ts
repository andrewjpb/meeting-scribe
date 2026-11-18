// Menu em linha (contrato 28), no padrão do "…" das conversas (ChatRow): o foco vai ao primeiro item ao abrir;
// setas, Home e End andam entre os itens (em volta); Esc fecha e devolve o foco ao botão; sair do menu fecha.
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'

export const MENU_ITEM = 'no-drag flex h-8 w-full items-center px-3 text-left text-13 hover:bg-bg-sunken focus-visible:outline-offset-[-2px]'
export const MENU_PANEL = 'absolute top-full right-0 z-10 mt-1 flex w-52 flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1'
export const MENU_BUTTON =
  'no-drag flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'
export const INLINE_INPUT = 'no-drag h-8 w-full rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-13 text-text select-text'

export function useInlineMenu(open: boolean, close: () => void) {
  const button = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const onBlur = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      button.current?.focus()
      return
    }
    if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return { button, menu, onBlur, onKeyDown }
}
