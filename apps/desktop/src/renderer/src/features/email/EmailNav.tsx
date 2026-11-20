import { ChevronDown, ChevronRight, CircleAlert, FilePen, Folder, FolderPlus, Inbox, Lock, Pencil, Send, Trash2 } from 'lucide-react'
import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { emailFolderFromSlug, emailFolderSegment, emailPath, type EmailRouteFolder } from '@shared/routes'
import type { EmailAccount, EmailFolderNode } from '@shared/email'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { ScrollFade } from '../../design/ScrollFade'
import { ContextMenu, FLOAT_PANEL, type MenuEntry } from './ContextMenu'
import { folderKey, useEmail } from './emailStore'
import { moveMessages, useEmailUi } from './emailUi'
import { deleteConfirmation, deleteNextStep, folderErrorText, folderNameError, routeFolder, sidebarTree, type FolderItem, type FolderKind } from './folderTree'
import { accountLabel, unreadBadge, unreadCount } from './format'
import { canDrop, dropLabel } from './moveTargets'
import type { LucideIcon } from 'lucide-react'

/** Linha da conta: 28 px como as pastas (contrato 79), distinta pela seta e pela falta do ícone de pasta; rótulo 13. */
const ROW = 'flex h-[var(--side-subrow)] min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
/** Linha de pasta: 28 px (contrato 79; era 30 no contrato 55), recuada 18 + 16 por nível porque já tem ícone. */
const FOLDER_ROW = 'flex h-[var(--side-subrow)] min-w-0 items-center gap-2 rounded-[var(--radius-control)] pr-2.5 text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'
const SIDE_INPUT = 'no-drag h-[26px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-side-outline bg-transparent px-1.5 text-13 text-side-text select-text'

const KIND_ICONS: Partial<Record<FolderKind, LucideIcon>> = { inbox: Inbox, drafts: FilePen, sent: Send, junk: CircleAlert, trash: Trash2 }

/** As duas pastas de sempre, enquanto a árvore não chegou (e numa conta POP3). */
const BASIC: FolderItem[] = [
  { path: 'INBOX', label: 'Caixa de Entrada', kind: 'inbox', specialUse: null, noselect: false, unseen: null, total: null, protected: true, delimiter: null, children: [] },
  { path: 'Sent', label: 'Enviados', kind: 'sent', specialUse: '\\Sent', noselect: false, unseen: null, total: null, protected: true, delimiter: null, children: [] },
]

/** A árvore de uma conta na barra lateral: a de `scribe:email-folders`, ou as duas de sempre (POP3, N2). */
export function accountTree(nodes: readonly EmailFolderNode[] | undefined, pop3: boolean): FolderItem[] {
  if (!nodes || pop3) return BASIC
  const tree = sidebarTree(nodes)
  return tree.length ? tree : BASIC
}

/** O delimitador da conta (o da pasta, ou o de qualquer uma da árvore). */
export function treeDelimiter(nodes: readonly EmailFolderNode[] | undefined, item?: Pick<FolderItem, 'delimiter'>): string {
  const walk = (list: readonly EmailFolderNode[]): string | null => {
    for (const node of list) {
      if (node.delimiter) return node.delimiter
      const inner = walk(node.children)
      if (inner) return inner
    }
    return null
  }
  return item?.delimiter ?? walk(nodes ?? []) ?? '/'
}

/** O que está aberto na barra lateral: o campo de "Nova subpasta…" ou "Renomear…", e a confirmação de apagar. */
type Editing = { mode: 'create' | 'rename'; accountId: string; item: FolderItem; value: string; error: string | null; busy: boolean } | null
type Confirm = { accountId: string; item: FolderItem; contents: { messages: number; folders: number } | null; busy: boolean; error: string | null; top: number; left: number } | null

/**
 * Contas de email na barra lateral (contrato 43, CA1), no nível Email da pilha (contrato 65) e no mesmo desenho da
 * navegação principal: cada conta pelo nome, com a seta que abre e fecha as pastas. As recolhidas ficam gravadas nas
 * configurações (`emailCollapsed`). Sem conta, nada aparece.
 *
 * Contrato 55 (CA2, CA5, CA9): abaixo de cada conta IMAP, a árvore de pastas do servidor (Caixa de Entrada, Rascunhos e
 * Enviados no topo, as da pessoa em ordem alfabética, Spam e Lixeira no fim), com as não lidas e as subárvores
 * recolhíveis (`emailFoldersCollapsed`); cada pasta é alvo de arrastar e tem o clique direito (Nova subpasta, Renomear,
 * Apagar pasta).
 */
export function EmailNav() {
  const accounts = useEmail((state) => state.accounts)
  const folders = useEmail((state) => state.folders)
  const trees = useEmail((state) => state.trees)
  const collapsed = useSettings((state) => state.settings.emailCollapsed)
  const foldersCollapsed = useSettings((state) => state.settings.emailFoldersCollapsed)
  const update = useSettings((state) => state.update)
  const navigate = useNavigate()
  const location = useLocation()
  // Contrato 68 (C): a lista que rola, para o esmaecimento do pé.
  const listRef = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState<{ accountId: string; path: string; label: string; top: number; left: number } | null>(null)
  const [menu, setMenu] = useState<{ accountId: string; item: FolderItem; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  if (!accounts?.length) return null
  const list = accounts.map((status) => status.account)
  const ids = new Set(list.map((account) => account.id))

  const toggle = (id: string): void => {
    const next = collapsed.includes(id) ? collapsed.filter((item) => item !== id) : [...collapsed, id]
    // Só as contas que existem (uma removida não fica lembrada).
    void update({ emailCollapsed: next.filter((item) => ids.has(item)) })
  }
  const subKey = (accountId: string, path: string): string => `${accountId}\n${path}`
  const toggleFolder = (accountId: string, path: string, open?: boolean): void => {
    const key = subKey(accountId, path)
    const closed = foldersCollapsed.includes(key)
    if (open !== undefined && open === !closed) return
    const next = closed ? foldersCollapsed.filter((item) => item !== key) : [...foldersCollapsed, key]
    void update({ emailFoldersCollapsed: next.filter((item) => ids.has(item.split('\n')[0] ?? '')) })
  }

  // A pasta aberta na tela (a apagada leva à Caixa de Entrada; a renomeada, ao path novo).
  const viewing = (accountId: string): EmailRouteFolder | null => (location.pathname.startsWith(`/email/${encodeURIComponent(accountId)}/`) ? emailFolderFromSlug(emailFolderSegment(location.pathname)) : null)
  const isUnder = (path: string, item: FolderItem): boolean => path === item.path || (item.delimiter !== null && path.startsWith(`${item.path}${item.delimiter}`))

  const onDragOver = (event: DragEvent<HTMLElement>, account: EmailAccount, item: FolderItem): void => {
    // Da loja, não do último render: o `dragover` pode chegar antes de a barra redesenhar depois do `dragstart`.
    const drag = useEmailUi.getState().drag
    if (!drag || !canDrop(drag, { accountId: account.id, item })) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (over?.accountId !== account.id || over.path !== item.path) {
      const box = event.currentTarget.getBoundingClientRect()
      setOver({ accountId: account.id, path: item.path, label: dropLabel(drag.ids.length, item.label), top: box.bottom + 4, left: box.left + 24 })
    }
  }
  const onDrop = (event: DragEvent<HTMLElement>, account: EmailAccount, item: FolderItem): void => {
    const payload = useEmailUi.getState().drag
    setOver(null)
    if (!payload || !canDrop(payload, { accountId: account.id, item })) return
    event.preventDefault()
    useEmailUi.getState().setDrag(null)
    void moveMessages(payload.accountId, payload.from, payload.ids, item.path)
  }

  const openMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, accountId: string, item: FolderItem): void => {
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const at = 'clientX' in event && event.clientX ? { x: event.clientX, y: event.clientY } : { x: box.left + 24, y: box.bottom }
    setMenu({ accountId, item, ...at })
  }
  const startCreate = (accountId: string, item: FolderItem): void => {
    toggleFolder(accountId, item.path, true)
    setEditing({ mode: 'create', accountId, item, value: '', error: null, busy: false })
  }
  const askDelete = (accountId: string, item: FolderItem): void => {
    const row = document.querySelector(`[data-email-folder-account="${CSS.escape(accountId)}"][data-email-folder-path="${CSS.escape(item.path)}"]`)?.getBoundingClientRect()
    setConfirm({ accountId, item, contents: null, busy: false, error: null, top: (row?.bottom ?? 120) + 4, left: (row?.left ?? 16) + 16 })
  }
  const menuEntries = (accountId: string, item: FolderItem): MenuEntry[] => {
    const locked = item.protected
    const hint = locked ? 'Pasta do sistema' : undefined
    return [
      { key: 'create', label: 'Nova subpasta…', icon: FolderPlus, data: { action: 'email-folder-new' }, onSelect: () => startCreate(accountId, item) },
      { key: 'rename', label: 'Renomear…', icon: locked ? Lock : Pencil, disabled: locked, hint, data: { action: 'email-folder-rename' }, onSelect: () => setEditing({ mode: 'rename', accountId, item, value: item.label, error: null, busy: false }) },
      { key: 'delete', label: 'Apagar pasta…', icon: locked ? Lock : Trash2, disabled: locked, hint, tone: locked ? undefined : 'danger', divider: true, data: { action: 'email-folder-delete' }, onSelect: () => askDelete(accountId, item) },
    ]
  }

  const submit = async (): Promise<void> => {
    if (!editing || editing.busy) return
    const problem = folderNameError(editing.value, treeDelimiter(trees[editing.accountId]?.nodes, editing.item))
    if (problem) {
      setEditing({ ...editing, error: problem })
      return
    }
    setEditing({ ...editing, busy: true, error: null })
    const store = useEmail.getState()
    const result = editing.mode === 'create' ? await store.createFolder(editing.accountId, editing.item.path, editing.value.trim()) : await store.renameFolder(editing.accountId, editing.item.path, editing.value.trim(), editing.item.delimiter)
    if (!result.ok) {
      setEditing((current) => (current ? { ...current, busy: false, error: folderErrorText(result.error) } : current))
      return
    }
    const open = viewing(editing.accountId)
    if (editing.mode === 'rename' && open && typeof open !== 'string' && isUnder(open.path, editing.item)) void navigate(emailPath(editing.accountId, { path: `${result.path}${open.path.slice(editing.item.path.length)}` }), { replace: true })
    setEditing(null)
  }

  const runDelete = async (): Promise<void> => {
    if (!confirm || confirm.busy) return
    setConfirm({ ...confirm, busy: true, error: null })
    // Sempre sem `force` primeiro: o total da árvore guardada pode estar velho. Com conteúdo, o 52 devolve o real e a
    // confirmação vira a longa (D11); só esse segundo clique manda `force`.
    const force = deleteConfirmation(confirm.item.label, confirm.contents).force
    const step = deleteNextStep(await useEmail.getState().deleteFolder(confirm.accountId, confirm.item.path, confirm.item.delimiter, force), force)
    if (step.kind === 'confirm') {
      setConfirm((current) => (current ? { ...current, busy: false, contents: step.contents } : current))
      return
    }
    if (step.kind === 'error') {
      setConfirm((current) => (current ? { ...current, busy: false, error: step.text } : current))
      return
    }
    const open = viewing(confirm.accountId)
    if (open && typeof open !== 'string' && isUnder(open.path, confirm.item)) void navigate(emailPath(confirm.accountId, 'inbox'), { replace: true })
    setConfirm(null)
  }

  const inputRow = (depth: number) =>
    editing && (
      <div data-email-folder-input={editing.mode} className="flex flex-col gap-0.5" style={{ paddingLeft: `${18 + depth * 16}px` }}>
        <div className="flex h-[var(--side-subrow)] items-center gap-2 pr-2.5">
          <Icon icon={Folder} className="shrink-0 text-side-muted" />
          <input
            // Aberto pelo próprio clique em "Nova subpasta…" ou "Renomear…": o foco vai para ele.
            autoFocus
            aria-label={editing.mode === 'create' ? `Nome da nova pasta em ${editing.item.label}` : `Novo nome de ${editing.item.label}`}
            value={editing.value}
            disabled={editing.busy}
            maxLength={120}
            onChange={(event) => setEditing({ ...editing, value: event.target.value, error: null })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(null)
              }
            }}
            onBlur={() => !editing.busy && !editing.error && setEditing(null)}
            className={SIDE_INPUT}
          />
        </div>
        {editing.error && (
          <p role="alert" data-email-folder-input-error className="pr-2.5 pb-1 pl-6 text-12 text-side-rec">
            {editing.error}
          </p>
        )}
      </div>
    )

  const folderRow = (account: EmailAccount, item: FolderItem, depth: number, unread: number) => {
    const open = !foldersCollapsed.includes(subKey(account.id, item.path))
    const target = over?.accountId === account.id && over.path === item.path
    const count = item.kind === 'inbox' ? unread : (item.unseen ?? 0)
    const renaming = editing?.mode === 'rename' && editing.accountId === account.id && editing.item.path === item.path
    const glyph = KIND_ICONS[item.kind] ?? Folder
    const common = {
      'data-email-folder': item.kind === 'inbox' ? 'inbox' : item.kind === 'sent' ? 'sent' : 'path',
      'data-email-folder-path': item.path,
      'data-email-folder-account': account.id,
      'data-email-drop-target': target ? 'true' : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => onDragOver(event, account, item),
      onDragLeave: () => target && setOver(null),
      onDrop: (event: DragEvent<HTMLElement>) => onDrop(event, account, item),
      onContextMenu: (event: MouseEvent<HTMLElement>) => openMenu(event, account.id, item),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') openMenu(event, account.id, item)
      },
    }
    const label = (
      <>
        <Icon icon={glyph} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count > 0 && (
          <span {...(item.kind === 'inbox' ? { 'data-email-unread-count': '' } : { 'data-email-folder-unseen': '' })} className="shrink-0 text-12 font-medium tabular text-side-text">
            {unreadBadge(count)}
            <span className="sr-only"> não lidas</span>
          </span>
        )}
      </>
    )
    const indent = { paddingLeft: `${18 + depth * 16}px` }
    const targetClass = target ? 'bg-side-active text-side-text outline outline-1 -outline-offset-1 outline-side-outline' : ''
    return (
      <li key={item.path} className="flex flex-col">
        <div className="relative flex min-w-0 items-center">
          {item.children.length > 0 && !renaming && (
            <button
              type="button"
              aria-label={open ? `Recolher ${item.label}` : `Abrir ${item.label}`}
              aria-expanded={open}
              data-email-folder-toggle={item.path}
              onClick={() => toggleFolder(account.id, item.path)}
              style={{ left: `${depth * 16}px` }}
              className="no-drag absolute top-1.5 z-[1] inline-flex size-4 items-center justify-center text-side-muted hover:text-side-text"
            >
              <Icon icon={open ? ChevronDown : ChevronRight} size={14} />
            </button>
          )}
          {renaming ? (
            <div className="min-w-0 flex-1">{inputRow(depth)}</div>
          ) : item.noselect ? (
            <button type="button" {...common} style={indent} onClick={() => toggleFolder(account.id, item.path)} className={`${FOLDER_ROW} no-drag min-w-0 flex-1 text-side-muted hover:text-side-text ${targetClass}`}>
              {label}
            </button>
          ) : (
            <NavLink
              to={emailPath(account.id, routeFolder(item))}
              end
              draggable={false}
              {...common}
              style={indent}
              className={({ isActive }) => `${FOLDER_ROW} min-w-0 flex-1 ${targetClass || (isActive ? 'bg-side-active text-side-text' : 'text-side-muted hover:text-side-text')}`}
            >
              {label}
            </NavLink>
          )}
        </div>
        {editing?.mode === 'create' && editing.accountId === account.id && editing.item.path === item.path && inputRow(depth + 1)}
        {open && item.children.length > 0 && <ul className="flex flex-col">{item.children.map((child) => folderRow(account, child, depth + 1, unread))}</ul>}
      </li>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={listRef} data-email-nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {accounts.map(({ account, state, error }) => {
          // Contrato 65 (D1): com uma conta só, a linha dela fica sem a seta e as pastas aparecem sempre.
          const single = accounts.length === 1
          const open = single || !collapsed.includes(account.id)
          const label = accountLabel(list, account)
          const unread = unreadCount(folders[folderKey(account.id, 'inbox')])
          const groupId = `email-nav-${account.id}`
          const tree = trees[account.id]
          const items = accountTree(tree?.nodes, (tree?.pop3 ?? false) || account.incoming.protocol === 'pop3')
          const errorMark = state === 'error' && (
            <span data-email-account-error title={error ?? 'Com problema'} className="size-1.5 shrink-0 bg-side-rec">
              <span className="sr-only">Com problema</span>
            </span>
          )
          return (
            <div key={account.id} data-email-account={account.id} className="flex flex-col gap-0.5">
              {single ? (
                <div data-email-account-header={account.id} title={account.address} className={`${ROW} text-side-muted`}>
                  <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                  {errorMark}
                </div>
              ) : (
                <button
                  type="button"
                  data-email-account-toggle={account.id}
                  aria-expanded={open}
                  aria-controls={groupId}
                  title={account.address}
                  onClick={() => toggle(account.id)}
                  className={`${ROW} text-side-muted hover:text-side-text`}
                >
                  <Icon icon={open ? ChevronDown : ChevronRight} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                  {errorMark}
                  {!open && unread > 0 && <span className="shrink-0 text-12 tabular text-side-text">{unreadBadge(unread)}</span>}
                </button>
              )}
              {open && (
                <ul id={groupId} data-email-tree={account.id} className="flex flex-col">
                  {items.map((item) => folderRow(account, item, 0, unread))}
                </ul>
              )}
            </div>
          )
        })}
        {over &&
          createPortal(
            <div data-email-drop-label role="status" style={{ top: over.top, left: over.left }} className={`${FLOAT_PANEL} pointer-events-none flex-row items-center gap-2 px-3 py-1.5 text-12 text-text`}>
              {over.label}
            </div>,
            document.body,
          )}
        {menu && <ContextMenu kind="folder" label={`Pasta ${menu.item.label}`} at={{ x: menu.x, y: menu.y }} entries={menuEntries(menu.accountId, menu.item)} onClose={() => setMenu(null)} />}
        {confirm &&
          createPortal(
            <div role="alertdialog" aria-labelledby="email-folder-delete-title" data-email-folder-delete-confirm={confirm.item.path} style={{ top: Math.min(confirm.top, window.innerHeight - 220), left: confirm.left }} className={`${FLOAT_PANEL} w-80 gap-3 p-4`}>
              <p id="email-folder-delete-title" className="text-13 font-bold text-title">
                {deleteConfirmation(confirm.item.label, confirm.contents).question}
              </p>
              {deleteConfirmation(confirm.item.label, confirm.contents).warning && <p className="text-12 text-text-muted">{deleteConfirmation(confirm.item.label, confirm.contents).warning}</p>}
              {confirm.error && (
                <p role="alert" className="text-12 text-rec">
                  {confirm.error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button action="email-folder-delete-confirm" variant="danger" onClick={() => void runDelete()} disabled={confirm.busy}>
                  {deleteConfirmation(confirm.item.label, confirm.contents).button}
                </Button>
                <Button action="email-folder-delete-cancel" variant="secondary" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
              </div>
            </div>,
            document.body,
          )}
      </div>
      <ScrollFade target={listRef} />
    </div>
  )
}
