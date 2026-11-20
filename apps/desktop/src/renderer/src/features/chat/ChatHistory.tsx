import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { CHAT_TITLE_MAX, type ChatListItem } from '@shared/chat'
import { Icon } from '../../design/Icon'
import { ScrollFade } from '../../design/ScrollFade'
import { listKey, openChat, useChat } from './chatStore'
import { filterChats, groupChatsByDay, railScrollTarget } from './format'

/**
 * Contrato 67: o histórico do Assistente no nível dele da barra lateral (antes no trilho da tela, contrato 38). "Nova
 * conversa", a busca por título (o termo vale enquanto o nível está montado) e as conversas por dia, só a lista rolando.
 * A lista é carregada pelo `ChatScreen`, que está sempre montado quando este nível aparece (`/assistente`).
 */
export function ChatHistory() {
  const key = listKey(null)
  const list = useChat((state) => state.lists[key])
  const selected = useChat((state) => state.selected[key] ?? null)
  const failure = useChat((state) => state.failures[`list:${key}`])
  const [query, setQuery] = useState('')
  // Contrato 68 (C): a lista que rola, para o esmaecimento do pé.
  const listRef = useRef<HTMLDivElement>(null)

  const shown = filterChats(list ?? [], query)
  const groups = groupChatsByDay(shown, new Date())

  // Sem a contenção da largura, um título comprido (numa linha só) alargaria a coluna da barra além do recuo dela.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col [contain:inline-size]">
      <button
        type="button"
        data-action="chat-new"
        onClick={() => openChat(null)}
        className="no-drag flex h-[30px] shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-13 text-side-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-side-text"
      >
        <Icon icon={Plus} className="shrink-0" />
        <span className="min-w-0 truncate">Nova conversa</span>
      </button>
      <div className="no-drag mt-1 mb-2 flex h-7 shrink-0 items-center gap-2 rounded-[var(--radius-control)] bg-side-active px-2 text-side-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-side-text">
        <Icon icon={Search} size={14} className="shrink-0" />
        <input
          type="text"
          data-chat-search
          value={query}
          placeholder="Buscar conversas"
          aria-label="Buscar conversas pelo título"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-12 text-side-text select-text placeholder:text-side-muted focus-visible:outline-none"
        />
      </div>
      {failure && <p className="px-2.5 pb-2 text-12 text-side-rec">{failure}</p>}
      {list && list.length === 0 && !failure && <p className="px-2.5 text-12 text-side-muted">Nenhuma conversa ainda.</p>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} data-chat-list className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label} data-chat-day={group.key}>
              <h2 className="caps px-2.5 pt-3 pb-1 text-side-muted">{group.label}</h2>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <ChatRow key={item.id} item={item} active={item.id === selected} onOpen={() => openChat(item.id)} />
                ))}
              </ul>
            </section>
          ))}
          {list && list.length > 0 && !shown.length && <p className="px-2.5 pt-3 text-12 text-side-muted">Nenhuma conversa com "{query.trim()}".</p>}
        </div>
        <ScrollFade target={listRef} />
      </div>
    </div>
  )
}

// O menu é um painel claro sobre o azul da barra: o contorno de foco volta ao de fora da barra (`on-side` o deixa branco).
const MENU_ITEM = 'no-drag flex h-8 w-full items-center px-3 text-left text-13 hover:bg-bg-sunken focus-visible:outline-offset-[-2px] focus-visible:outline-focus'
const CONFIRM_BUTTON = 'no-drag inline-flex h-7 items-center rounded-[var(--radius-control)] border border-side-outline px-2.5 text-12 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active'

/**
 * Linha da lista (D8): só o título, recuado como as pastas do email; o "…" aparece no hover e no foco da linha e abre o
 * menu que renomeia (na própria linha) ou exclui (com confirmação).
 */
function ChatRow({ item, active, onOpen }: { item: ChatListItem; active: boolean; onOpen: () => void }) {
  const [mode, setMode] = useState<'idle' | 'menu' | 'rename' | 'confirm'>('idle')
  const [title, setTitle] = useState(item.title)
  const menuButton = useRef<HTMLButtonElement | null>(null)
  // Contrato 68 (B): saindo do renomear por Esc ou Enter, o foco volta para o botão da linha (blur deixa o foco onde está).
  const openButton = useRef<HTMLButtonElement | null>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (mode !== 'idle' || !refocus.current) return
    refocus.current = false
    openButton.current?.focus({ preventScroll: true })
  }, [mode])

  const closeMenu = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMode('idle')
  }
  const menu = useRef<HTMLDivElement | null>(null)
  // Menu aberto: a lista rola o mínimo para ele aparecer inteiro, e o foco vai para o primeiro item.
  useEffect(() => {
    if (mode !== 'menu' || !menu.current) return
    const list = menu.current.closest<HTMLElement>('[data-chat-list]')
    if (list) {
      const box = list.getBoundingClientRect()
      const panel = menu.current.getBoundingClientRect()
      const top = railScrollTarget({ top: box.top, height: box.height, scrollTop: list.scrollTop }, { top: panel.top, height: panel.height })
      if (top !== null) list.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
    menu.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
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
      <li data-chat-item={item.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] py-2 pr-1 pl-8">
        <p className="text-12 text-side-text">Excluir esta conversa?</p>
        <div className="flex gap-2">
          <button type="button" data-action="confirm-delete-chat" onClick={() => void useChat.getState().remove(item.id, item.meetingId)} className={`${CONFIRM_BUTTON} text-side-rec`}>
            Excluir
          </button>
          <button type="button" data-action="cancel-delete-chat" onClick={() => setMode('idle')} className={`${CONFIRM_BUTTON} text-side-muted hover:text-side-text`}>
            Cancelar
          </button>
        </div>
      </li>
    )
  }
  if (mode === 'rename') {
    return (
      <li data-chat-item={item.id} className="flex h-[30px] items-center pr-1 pl-6">
        <input
          // Campo aberto pelo próprio clique em "Renomear": o foco vai para ele.
          autoFocus
          data-chat-rename-input
          aria-label="Novo título da conversa"
          value={title}
          maxLength={CHAT_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.target.select()}
          // Blur (clique fora, ⌘Tab): salva e deixa o foco onde o usuário o pôs; só Enter e Esc devolvem à linha.
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              refocus.current = true
              rename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              refocus.current = true
              setTitle(item.title)
              setMode('idle')
            }
          }}
          className="no-drag h-7 w-full rounded-[var(--radius-control)] border border-side-outline bg-side-active px-2 text-13 text-side-text select-text"
        />
      </li>
    )
  }
  return (
    <li
      data-chat-item={item.id}
      className={`group relative flex h-[30px] items-center rounded-[var(--radius-control)] text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
        active ? 'bg-side-active font-medium text-side-text' : 'text-side-muted hover:text-side-text'
      }`}
    >
      {/* O "…" fica por cima, à direita: o título só encurta quando ele aparece (hover, foco na linha ou menu aberto). */}
      <button
        ref={openButton}
        type="button"
        data-chat-open
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
        className={`no-drag flex h-full min-w-0 flex-1 items-center pl-8 text-left focus-visible:outline-offset-[-2px] ${
          mode === 'menu' ? 'pr-8' : 'pr-1 group-focus-within:pr-8 group-hover:pr-8'
        }`}
      >
        <span className="min-w-0 truncate">{item.title}</span>
      </button>
      <div onBlur={closeMenu} onKeyDown={onMenuKey} className="absolute inset-y-0 right-1 flex items-center">
        <button
          ref={menuButton}
          type="button"
          data-action="chat-row-menu"
          aria-label="Mais ações da conversa"
          aria-haspopup="menu"
          aria-expanded={mode === 'menu'}
          onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
          className={`no-drag flex size-6 items-center justify-center rounded-[var(--radius-control)] text-side-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] group-focus-within:opacity-100 group-hover:opacity-100 hover:text-side-text focus-visible:outline-offset-[-2px] ${
            mode === 'menu' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Icon icon={MoreHorizontal} />
        </button>
        {mode === 'menu' && (
          <div
            ref={menu}
            role="menu"
            aria-label="Ações da conversa"
            className="absolute top-full right-0 z-10 flex w-36 flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1 font-normal"
          >
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
