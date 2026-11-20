import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../../design/Icon'

/** Painel de menu: fio de 1 px, raio 4, sem sombra (design.md). */
export const FLOAT_PANEL = 'fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1'
const ITEM =
  'no-drag flex h-8 w-full shrink-0 items-center gap-2.5 px-3 text-left text-13 text-text hover:bg-bg-sunken focus-visible:bg-bg-sunken focus-visible:outline-offset-[-2px] aria-disabled:cursor-default aria-disabled:text-text-faint aria-disabled:hover:bg-transparent'

export interface MenuEntry {
  key: string
  label: string
  icon?: LucideIcon | undefined
  onSelect?: (() => void) | undefined
  disabled?: boolean | undefined
  tone?: 'danger' | undefined
  /** Atalho à direita ("⇧⌘M"), só de leitura. */
  shortcut?: string | undefined
  /** Dica (`title`) do item desligado ("Pasta do sistema"). */
  hint?: string | undefined
  /** Recuo de subpasta (submenu das pastas). */
  depth?: number | undefined
  /** Submenu (abre à direita com →, Enter ou o mouse). */
  children?: MenuEntry[] | undefined
  /** `data-*` do item, para o smoke. */
  data?: Record<string, string> | undefined
  /** Fio antes do item. */
  divider?: boolean | undefined
}

interface ContextMenuProps {
  /** Onde abrir (o ponto do clique direito, ou o canto da linha no ⇧F10). */
  at: { x: number; y: number }
  label: string
  entries: MenuEntry[]
  onClose: () => void
  /** `data-email-context-menu`, para o smoke. */
  kind: string
}

const focusables = (root: HTMLElement | null): HTMLButtonElement[] => [...(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]

/**
 * Menu de contexto (contrato 55, CA8 e CA9) no padrão dos menus em linha (contrato 28): foco no primeiro item ao abrir,
 * setas, Home e End andam (em volta), → abre o submenu e ← volta, Esc fecha e devolve o foco a quem abriu; clicar fora
 * fecha. Fica num portal, por cima de tudo, e não sai da janela.
 */
export function ContextMenu({ at, label, entries, onClose, kind }: ContextMenuProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const sub = useRef<HTMLDivElement | null>(null)
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null)
  const [open, setOpen] = useState<{ key: string; top: number; left: number } | null>(null)

  // Não sai da janela: o painel já medido volta para dentro.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const box = el.getBoundingClientRect()
    el.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - box.width - 4))}px`
    el.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - box.height - 4))}px`
  }, [at])

  useEffect(() => {
    focusables(panel.current)[0]?.focus()
    const away = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !sub.current?.contains(target)) onClose()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])

  const close = (restore = true): void => {
    onClose()
    if (restore && opener.current instanceof HTMLElement) opener.current.focus()
  }

  const openSub = (entry: MenuEntry, button: HTMLElement, focus: boolean): void => {
    const box = button.getBoundingClientRect()
    setOpen({ key: entry.key, top: box.top - 4, left: box.right - 2 })
    if (focus) requestAnimationFrame(() => focusables(sub.current)[0]?.focus())
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>, inSub: boolean): void => {
    const root = inSub ? sub.current : panel.current
    const items = focusables(root)
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (inSub) {
        setOpen(null)
        panel.current?.querySelector<HTMLButtonElement>(`[data-menu-key="${CSS.escape(open?.key ?? '')}"]`)?.focus()
      } else close()
      return
    }
    if (event.key === 'ArrowLeft' && inSub) {
      event.preventDefault()
      const key = open?.key ?? ''
      setOpen(null)
      panel.current?.querySelector<HTMLButtonElement>(`[data-menu-key="${CSS.escape(key)}"]`)?.focus()
      return
    }
    if (event.key === 'ArrowRight' && !inSub) {
      const entry = entries.find((item) => item.key === (document.activeElement as HTMLElement | null)?.dataset.menuKey)
      if (entry?.children && document.activeElement instanceof HTMLElement) {
        event.preventDefault()
        openSub(entry, document.activeElement, true)
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next]?.focus()
  }

  const item = (entry: MenuEntry, inSub: boolean): ReactNode => (
    <div key={entry.key} className="contents">
      {entry.divider && <div role="separator" className="my-1 h-px shrink-0 bg-line" />}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-menu-key={entry.key}
        {...Object.fromEntries(Object.entries(entry.data ?? {}).map(([name, value]) => [`data-${name}`, value]))}
        // Desligado com `aria-disabled` (não `disabled`): o item segue no foco e a dica aparece no hover e no texto.
        aria-disabled={entry.disabled || undefined}
        aria-haspopup={entry.children ? 'menu' : undefined}
        aria-expanded={entry.children ? open?.key === entry.key : undefined}
        title={entry.disabled ? entry.hint : undefined}
        onMouseEnter={(event) => {
          if (inSub || entry.disabled) return
          if (entry.children) openSub(entry, event.currentTarget, false)
          else setOpen(null)
        }}
        onClick={(event) => {
          if (entry.disabled) return
          if (entry.children) {
            openSub(entry, event.currentTarget, true)
            return
          }
          close(false)
          entry.onSelect?.()
        }}
        style={entry.depth ? { paddingLeft: `${12 + entry.depth * 16}px` } : undefined}
        className={`${ITEM} ${entry.tone === 'danger' ? 'text-rec' : ''} ${open?.key === entry.key && !inSub ? 'bg-bg-sunken' : ''}`}
      >
        {entry.icon && <Icon icon={entry.icon} className="shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.disabled && entry.hint ? <span className="shrink-0 text-12 text-text-faint">{entry.hint}</span> : entry.shortcut && <span className="shrink-0 text-12 text-text-faint">{entry.shortcut}</span>}
        {entry.children && <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-muted" />}
      </button>
    </div>
  )

  const child = open ? entries.find((entry) => entry.key === open.key) : undefined
  return createPortal(
    <>
      <div ref={panel} role="menu" aria-label={label} data-email-context-menu={kind} onKeyDown={(event) => onKey(event, false)} style={{ left: at.x, top: at.y }} className={`${FLOAT_PANEL} w-56`}>
        {entries.map((entry) => item(entry, false))}
      </div>
      {child?.children && open && (
        <div
          ref={sub}
          role="menu"
          aria-label={child.label}
          data-email-context-submenu={child.key}
          onKeyDown={(event) => onKey(event, true)}
          style={{ left: Math.min(open.left, window.innerWidth - 228), top: Math.max(4, Math.min(open.top, window.innerHeight - 40 - child.children.length * 32)) }}
          className={`${FLOAT_PANEL} max-h-[60vh] w-56 overflow-y-auto`}
        >
          {child.children.map((entry) => item(entry, true))}
        </div>
      )}
    </>,
    document.body,
  )
}
