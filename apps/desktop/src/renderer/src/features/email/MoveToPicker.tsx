import { Check, ChevronDown, ChevronRight, CircleAlert, FilePen, Folder, FolderPlus, Inbox, Search, Send, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { normalizeSearch } from '../settings/modelFormat'
import { FLOAT_PANEL } from './ContextMenu'
import { treeDelimiter } from './EmailNav'
import { useEmail } from './emailStore'
import { moveMessages, useEmailUi } from './emailUi'
import { folderErrorText, folderNameError, pickerTree, type FolderItem, type FolderKind } from './folderTree'
import { messagesLabel } from './selection'

/** Destinos que o mover nunca aceita (a regra do 52/56): Rascunhos, Enviados, Lixeira e Spam. */
const NOT_TARGETS: readonly FolderKind[] = ['drafts', 'sent', 'trash', 'junk']

const ICONS: Partial<Record<FolderKind, LucideIcon>> = { inbox: Inbox, drafts: FilePen, sent: Send, junk: CircleAlert, trash: Trash2, flagged: Star }

/** Uma linha da árvore à vista: a pasta, o nível, se tem filhos e se pode ser destino. */
interface Row {
  item: FolderItem
  depth: number
  parent: string | null
  hasChildren: boolean
  disabled: boolean
}

/** A árvore filtrada pela busca: a pasta achada (com as subpastas dela) e os pais (sem acento nem maiúscula). */
function filterTree(items: readonly FolderItem[], needle: string): FolderItem[] {
  if (!needle) return [...items]
  return items.flatMap((item) => {
    if (normalizeSearch(item.label).includes(needle)) return [item]
    const children = filterTree(item.children, needle)
    return children.length ? [{ ...item, children }] : []
  })
}

/** O nome com o trecho achado em destaque (peso forte); a posição conta letra a letra, com o acento tirado de cada uma. */
function highlight(label: string, needle: string): ReactNode {
  if (!needle) return label
  const chars = [...label]
  const plain = chars.map((char) => char.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase())
  const joined = plain.join('')
  const at = joined.indexOf(needle)
  if (at === -1) return label
  // Do índice no texto sem acento para o índice das letras.
  let count = 0
  let start = -1
  let end = chars.length
  for (const [index, part] of plain.entries()) {
    if (start === -1 && count + part.length > at) start = index
    count += part.length
    if (count >= at + needle.length) {
      end = index + 1
      break
    }
  }
  return (
    <>
      {chars.slice(0, start).join('')}
      <b data-email-picker-match className="font-bold">
        {chars.slice(start, end).join('')}
      </b>
      {chars.slice(end).join('')}
    </>
  )
}

/**
 * Seletor "Mover para…" (contrato 55, CA7, tela 03): título e quantas mensagens; a busca que filtra enquanto digita
 * (mantendo os pais da pasta achada); a árvore da conta (com "Todos os e-mails" e "Com estrela"; a pasta atual e as
 * `\Noselect` desligadas); ↑/↓ andam, → e ← abrem e fecham, Enter move, Esc fecha sem mover; "Nova pasta em …" cria e
 * move para ela. O mesmo seletor serve à leitura, ao resumo da seleção, ao menu de contexto e ao ⇧⌘M.
 */
export function MoveToPicker() {
  const request = useEmailUi((state) => state.picker)
  if (!request) return null
  return <Picker key={`${request.accountId}:${request.ids.join(',')}`} />
}

function Picker() {
  const request = useEmailUi((state) => state.picker) as NonNullable<ReturnType<typeof useEmailUi.getState>['picker']>
  const status = useEmail((state) => state.accounts?.find((item) => item.account.id === request.accountId))
  const tree = useEmail((state) => state.trees[request.accountId])
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(request.choose?.current ?? null)
  const [creating, setCreating] = useState<{ value: string; error: string | null; busy: boolean; parent: FolderItem | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const opener = useRef<Element | null>(document.activeElement)
  const needle = normalizeSearch(query)

  const blocked = request.choose?.disabled
  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (items: readonly FolderItem[], depth: number, parent: string | null): void => {
      for (const item of items) {
        out.push({ item, depth, parent, hasChildren: item.children.length > 0, disabled: item.noselect || NOT_TARGETS.includes(item.kind) || item.path === request.fromPath || (blocked?.some((path) => path.toUpperCase() === item.path.toUpperCase()) ?? false) })
        // Buscando, tudo aberto (os pais da achada aparecem).
        if (item.children.length && (needle || !closed.includes(item.path))) walk(item.children, depth + 1, item.path)
      }
    }
    walk(filterTree(pickerTree(tree?.nodes ?? []), needle), 0, null)
    return out
  }, [tree, needle, closed, request.fromPath, blocked])

  const enabled = rows.filter((row) => !row.disabled)
  // A escolhida sumiu da busca (ou ainda não há): a primeira que pode ser destino.
  // Sem destino escolhido de saída (CA7): "Mover" fica desligado até a pessoa escolher (setas, clique ou a busca + ↓).
  const current = rows.find((row) => row.item.path === active && !row.disabled) ?? null

  const accountId = request.accountId
  useEffect(() => {
    input.current?.focus()
    // A árvore mais nova (as pastas criadas por outro cliente aparecem).
    void useEmail.getState().loadTree(accountId)
    const back = opener.current
    return () => {
      if (back instanceof HTMLElement && document.contains(back)) back.focus()
    }
  }, [accountId])

  const close = (): void => useEmailUi.getState().closePicker()

  const move = async (toPath: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    close()
    if (request.choose) {
      request.choose.onChoose(toPath)
      return
    }
    await moveMessages(request.accountId, request.from, request.ids, toPath)
  }

  const create = async (): Promise<void> => {
    if (!creating || creating.busy) return
    const parent = creating.parent
    const problem = folderNameError(creating.value, treeDelimiter(tree?.nodes, parent ?? undefined))
    if (problem) {
      setCreating({ ...creating, error: problem })
      return
    }
    setCreating({ ...creating, busy: true, error: null })
    const result = await useEmail.getState().createFolder(request.accountId, parent?.path ?? null, creating.value.trim())
    if (!result.ok) {
      setCreating((now) => (now ? { ...now, busy: false, error: folderErrorText(result.error) } : now))
      return
    }
    await move(result.path)
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (creating) setCreating(null)
      else close()
      return
    }
    if (creating) return
    const at = current ? enabled.indexOf(current) : -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = enabled[event.key === 'ArrowDown' ? Math.min(enabled.length - 1, at + 1) : Math.max(0, at - 1)]
      if (next) setActive(next.item.path)
    } else if (event.key === 'ArrowRight' && current?.hasChildren && (input.current?.selectionStart ?? 0) === query.length) {
      event.preventDefault()
      setClosed(closed.filter((path) => path !== current.item.path))
    } else if (event.key === 'ArrowLeft' && current && (input.current?.selectionStart ?? 0) === 0) {
      event.preventDefault()
      if (current.hasChildren && !closed.includes(current.item.path) && !needle) setClosed([...closed, current.item.path])
      else if (current.parent) setActive(current.parent)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (current) void move(current.item.path)
    } else if (event.key === 'Tab') {
      // Foco preso no seletor (diálogo modal).
      const focusables = [...(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [])]
      const first = focusables[0]
      const last = focusables.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  const anchor = request.anchor
  const place = anchor ? { top: Math.min(anchor.top, window.innerHeight - 420), left: Math.max(8, anchor.right - 340) } : { top: Math.max(48, window.innerHeight / 2 - 220), left: Math.max(8, window.innerWidth / 2 - 170) }

  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40" onMouseDown={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-picker-title"
        data-email-picker
        onKeyDown={onKey}
        style={place}
        className={`${FLOAT_PANEL} w-[340px] gap-0 py-0`}
      >
        <div className="flex items-baseline justify-between gap-3 px-3 pt-3 pb-2">
          <h2 id="email-picker-title" className="text-13 font-bold text-title">
            {request.choose ? request.choose.title : 'Mover para…'}
          </h2>
          {!request.choose && <span className="text-12 text-text-muted">{messagesLabel(request.ids.length)}</span>}
        </div>
        <div className="px-3 pb-2">
          <div className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-focus bg-bg-raised px-2.5">
            <Icon icon={Search} size={14} className="shrink-0 text-text-muted" />
            <input
              ref={input}
              data-email-picker-search
              aria-label="Buscar pasta"
              aria-controls="email-picker-tree"
              aria-activedescendant={current ? `email-picker-${encodeURIComponent(current.item.path)}` : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="no-drag min-w-0 flex-1 bg-transparent text-13 text-text select-text focus-visible:outline-none"
            />
          </div>
        </div>
        <ul id="email-picker-tree" role="tree" aria-label="Pastas" className="max-h-[260px] overflow-y-auto pb-1">
          {rows.length === 0 && <li className="px-3 py-2 text-12 text-text-muted">Nenhuma pasta com esse nome.</li>}
          {rows.map((row) => {
            const selected = current?.item.path === row.item.path
            const open = needle !== '' || !closed.includes(row.item.path)
            return (
              <li
                key={row.item.path}
                id={`email-picker-${encodeURIComponent(row.item.path)}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-disabled={row.disabled || undefined}
                aria-expanded={row.hasChildren ? open : undefined}
                data-email-picker-folder={row.item.path}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !row.disabled && setActive(row.item.path)}
                onDoubleClick={() => !row.disabled && void move(row.item.path)}
                style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                className={`flex h-8 cursor-default items-center gap-2 pr-3 text-13 ${row.disabled ? 'text-text-faint' : selected ? 'bg-accent text-on-accent' : 'text-text hover:bg-bg-sunken'}`}
              >
                {row.hasChildren && !needle ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={open ? `Recolher ${row.item.label}` : `Abrir ${row.item.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setClosed(open ? [...closed, row.item.path] : closed.filter((path) => path !== row.item.path))
                    }}
                    className="no-drag -ml-4 inline-flex size-4 items-center justify-center"
                  >
                    <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
                  </button>
                ) : null}
                <Icon icon={ICONS[row.item.kind] ?? Folder} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{highlight(row.item.label, needle)}</span>
                {selected && <Icon icon={Check} size={14} className="shrink-0" />}
              </li>
            )
          })}
        </ul>
        <div className="border-t border-line px-3 py-2">
          {creating ? (
            <div className="flex flex-col gap-1">
              <input
                // Aberto pelo clique em "Nova pasta…": o foco vai para ele.
                autoFocus
                data-email-picker-new-input
                aria-label={creating.parent ? `Nome da nova pasta em ${creating.parent.label}` : 'Nome da nova pasta'}
                placeholder="Nome da pasta"
                value={creating.value}
                disabled={creating.busy}
                onChange={(event) => setCreating({ ...creating, value: event.target.value, error: null })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    void create()
                  }
                }}
                className="no-drag h-8 w-full rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-13 text-text select-text"
              />
              {creating.error && (
                <p role="alert" className="text-12 text-rec">
                  {creating.error}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start">
              {current && (
                <button type="button" data-action="email-picker-new-subfolder" onClick={() => setCreating({ value: '', error: null, busy: false, parent: current.item })} className="no-drag inline-flex h-8 max-w-full items-center gap-2 text-13 font-medium text-accent">
                  <Icon icon={FolderPlus} />
                  <span className="truncate">{`Nova pasta em “${current.item.label}”…`}</span>
                </button>
              )}
              <button type="button" data-action="email-picker-new-folder" onClick={() => setCreating({ value: '', error: null, busy: false, parent: null })} className="no-drag inline-flex h-8 items-center gap-2 text-13 font-medium text-accent">
                <Icon icon={FolderPlus} />
                Nova pasta…
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-12 text-text-muted">{status ? `${status.account.name ?? status.account.address} · ${status.account.address}` : ''}</p>
          <Button action="email-picker-cancel" variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button action="email-picker-move" onClick={() => current && void move(current.item.path)} disabled={!current || busy}>
            {request.choose ? 'Escolher' : 'Mover'}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  )
}
