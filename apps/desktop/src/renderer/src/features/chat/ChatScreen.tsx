import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { CHAT_TITLE_MAX, type ChatListItem } from '@shared/chat'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { PageHeader } from '../../design/PageHeader'
import { timeLabel } from '../meetings/format'
import { ChatConversation } from './ChatConversation'
import { listKey, useChat } from './chatStore'
import { filterChats, groupChatsByDay, railScrollTarget } from './format'
import { useChatMeetings } from './useChatMeetings'

/** Fecha a conversa que estava aberta: o processo dela morre (depois da resposta em curso). */
function closeChat(id: string | null): void {
  if (id) window.__scribeApi.send('scribe:chat-close', { id })
}

/**
 * Tela "Assistente" (contratos 15, 16, 25 e 38; antes "Perguntar"): a conversa aberta e, à direita, um trilho só com as
 * conversas em cima (busca por título, agrupadas por dia, "Nova conversa", e renomear e excluir no menu "…" da linha) e o
 * "Contexto" da conversa embaixo, recolhido até a pessoa abrir. Conversa e trilho cabem lado a lado mesmo em 1120 px.
 */
export function ChatScreen() {
  const key = listKey(null)
  const list = useChat((state) => state.lists[key])
  const selected = useChat((state) => state.selected[key] ?? null)
  const failure = useChat((state) => state.failures[`list:${key}`])
  const meetings = useChatMeetings()
  const [query, setQuery] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  // O "Contexto" é desenhado pela conversa (que tem o escopo e o modelo) dentro deste elemento do trilho.
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null)
  const rail = useRef<HTMLElement | null>(null)
  /** Cada pedido para abrir o "Contexto" (mesmo já aberto) rola o trilho até ele. */
  const [reveal, setReveal] = useState(0)
  const openContext = (open: boolean): void => {
    setContextOpen(open)
    if (open) setReveal((count) => count + 1)
  }

  useEffect(() => {
    void useChat.getState().loadList(null)
  }, [])

  useEffect(() => {
    const node = rail.current
    if (!reveal || !node || !contextSlot) return
    const box = node.getBoundingClientRect()
    const section = contextSlot.getBoundingClientRect()
    const top = railScrollTarget({ top: box.top, height: box.height, scrollTop: node.scrollTop }, { top: section.top, height: section.height })
    if (top === null) return
    node.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [reveal, contextSlot])

  const choose = (id: string | null): void => {
    if (id === selected) return
    closeChat(selected)
    useChat.getState().select(null, id)
  }

  const shown = filterChats(list ?? [], query)
  const groups = groupChatsByDay(shown, new Date())

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-7 pb-6">
        <PageHeader title="Assistente" description="Pergunte ou peça qualquer coisa: reuniões, WhatsApp, email, automações e o próprio app." />
      </div>
      <div className="flex min-h-0 flex-1 border-t border-line">
        <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
          <ChatConversation
            key={selected ?? 'new'}
            chatId={selected}
            meetingId={null}
            meetings={meetings}
            contextOpen={contextOpen}
            onContextOpen={openContext}
            contextSlot={contextSlot}
          />
        </section>
        {/* Depois da conversa no DOM: a barra lateral do app continua sendo o primeiro `aside` da janela. */}
        <aside ref={rail} aria-label="Conversas e contexto" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line">
          <div className="flex shrink-0 flex-col gap-2 p-3">
            <Button action="chat-new" variant="secondary" icon={Plus} onClick={() => choose(null)}>
              Nova conversa
            </Button>
            <div className="no-drag flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-text-faint has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
              <Icon icon={Search} size={14} />
              <input
                type="text"
                data-chat-search
                value={query}
                placeholder="Buscar conversas"
                aria-label="Buscar conversas pelo título"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-12 text-text select-text placeholder:text-text-faint focus-visible:outline-none"
              />
            </div>
          </div>
          {failure && <p className="px-4 pb-2 text-12 text-rec">{failure}</p>}
          {/* Recolhido, o "Contexto" fica no pé do trilho; aberto, a lista encolhe e o trilho rola. */}
          <div data-chat-list className={`overflow-y-auto pb-3 ${contextOpen ? 'max-h-[260px] shrink-0' : 'min-h-0 flex-1'}`}>
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label} data-chat-day={group.key}>
                <h2 className="border-b border-line px-4 pt-3 pb-1.5 text-12 font-bold text-text-muted">{group.label}</h2>
                <ul>
                  {group.items.map((item) => (
                    <ChatRow key={item.id} item={item} active={item.id === selected} onOpen={() => choose(item.id)} />
                  ))}
                </ul>
              </section>
            ))}
            {list && list.length > 0 && !shown.length && <p className="px-4 pt-3 text-12 text-text-muted">Nenhuma conversa com "{query.trim()}".</p>}
          </div>
          <div ref={setContextSlot} data-chat-rail-context className="shrink-0 border-t border-line empty:hidden" />
        </aside>
      </div>
    </div>
  )
}

const MENU_ITEM = 'no-drag flex h-8 w-full items-center px-3 text-left text-13 hover:bg-bg-sunken focus-visible:outline-offset-[-2px]'

/** Linha da lista: título e hora; o menu "…" renomeia (na própria linha) ou exclui (com confirmação). */
function ChatRow({ item, active, onOpen }: { item: ChatListItem; active: boolean; onOpen: () => void }) {
  const [mode, setMode] = useState<'idle' | 'menu' | 'rename' | 'confirm'>('idle')
  const [title, setTitle] = useState(item.title)
  const menuButton = useRef<HTMLButtonElement | null>(null)

  const closeMenu = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMode('idle')
  }
  const menu = useRef<HTMLDivElement | null>(null)
  // Menu aberto: o foco vai para o primeiro item.
  useEffect(() => {
    if (mode === 'menu') menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [mode])
  // Esc fecha e devolve o foco ao "…"; setas, Home e End andam entre os itens (em volta).
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setMode('idle')
      menuButton.current?.focus()
      return
    }
    if (mode !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next]?.focus()
  }
  const rename = (): void => {
    const next = title.trim()
    setMode('idle')
    if (next && next !== item.title) void useChat.getState().update(item.id, { title: next })
  }

  if (mode === 'confirm') {
    return (
      <li data-chat-item={item.id} className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <p className="text-13 text-text">Excluir esta conversa?</p>
        <div className="flex gap-2">
          <Button action="confirm-delete-chat" variant="danger" onClick={() => void useChat.getState().remove(item.id, item.meetingId)}>
            Excluir
          </Button>
          <Button action="cancel-delete-chat" variant="secondary" onClick={() => setMode('idle')}>
            Cancelar
          </Button>
        </div>
      </li>
    )
  }
  if (mode === 'rename') {
    return (
      <li data-chat-item={item.id} className="border-b border-line px-3 py-2">
        <input
          // Campo aberto pelo próprio clique em "Renomear": o foco vai para ele.
          autoFocus
          data-chat-rename-input
          aria-label="Novo título da conversa"
          value={title}
          maxLength={CHAT_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              rename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setTitle(item.title)
              setMode('idle')
            }
          }}
          className="no-drag h-8 w-full rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-13 text-text select-text"
        />
      </li>
    )
  }
  return (
    <li data-chat-item={item.id} className={`relative flex items-center border-b border-line ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}>
      <button type="button" aria-current={active ? 'true' : undefined} onClick={onOpen} className="no-drag flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2.5 text-left focus-visible:outline-offset-[-2px]">
        <span className="truncate text-13 font-medium text-title">{item.title}</span>
        <span className="text-12 text-text-muted tabular">{timeLabel(new Date(item.updatedAt))}</span>
      </button>
      <div onBlur={closeMenu} onKeyDown={onMenuKey} className="mr-2 shrink-0">
        <button
          ref={menuButton}
          type="button"
          data-action="chat-row-menu"
          aria-label="Mais ações da conversa"
          aria-haspopup="menu"
          aria-expanded={mode === 'menu'}
          onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
          className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
        >
          <Icon icon={MoreHorizontal} />
        </button>
        {mode === 'menu' && (
          <div ref={menu} role="menu" aria-label="Ações da conversa" className="absolute top-full right-2 z-10 flex w-36 flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-action="rename-chat"
              onClick={() => {
                setTitle(item.title)
                setMode('rename')
              }}
              className={`${MENU_ITEM} text-text`}
            >
              Renomear
            </button>
            <button type="button" role="menuitem" tabIndex={-1} data-action="delete-chat" onClick={() => setMode('confirm')} className={`${MENU_ITEM} text-rec`}>
              Excluir
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
