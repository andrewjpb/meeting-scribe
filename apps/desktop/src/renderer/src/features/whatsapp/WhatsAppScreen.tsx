import { Paperclip, Search, Sparkles, TriangleAlert, Users } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
import { Link } from 'react-router'
import { settingsPath } from '@shared/routes'
import type { Meeting } from '@shared/meetings'
import { mediaLabel, WHATSAPP_DRAFT_INSTRUCTION_MAX, WHATSAPP_FIXED_WARNING, WHATSAPP_SEND_TEXT_MAX, type WhatsAppChat, type WhatsAppMessage, type WhatsAppSearchHit } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { clockLabel, messageTimeLabel, previewText } from './format'
import { useWhatsApp } from './whatsappStore'

const SEND_ERRORS: Record<'click' | 'state' | 'invalid' | 'failed' | 'cancelled', string> = {
  cancelled: 'Não enviada: você cancelou na confirmação. O texto continua no campo.',
  click: 'A mensagem só sai com o seu clique em "Enviar". Clique de novo.',
  state: 'O WhatsApp não está conectado. Confira em Configurações › Contas.',
  invalid: 'A mensagem está vazia ou passou de 4 096 caracteres.',
  failed: 'O WhatsApp não aceitou a mensagem. Tente de novo.',
}

const DRAFT_ERRORS: Record<'not-found' | 'timeout' | 'failed' | 'agent' | 'chat', string> = {
  'not-found': 'O Claude não foi encontrado neste Mac. Confira em Configurações › Claude.',
  timeout: 'O Claude demorou demais para escrever o rascunho. Tente de novo.',
  failed: 'O Claude não conseguiu escrever o rascunho. Tente de novo.',
  agent: 'O agente do Claude não abriu. Confira em Configurações › Claude.',
  chat: 'A conversa não está mais disponível.',
}

/** Uma linha da lista de conversas. */
function ChatRow({ chat, active, onOpen }: { chat: WhatsAppChat; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-whatsapp-chat={chat.id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={`no-drag flex w-full min-w-0 flex-col gap-0.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
    >
      <span className="flex items-center gap-2">
        {chat.kind === 'group' && (
          <span data-whatsapp-group title="Grupo" className="flex shrink-0 text-text-muted">
            <Icon icon={Users} size={14} />
            <span className="sr-only">Grupo:</span>
          </span>
        )}
        <span className={`min-w-0 flex-1 truncate text-13 ${chat.unread ? 'font-bold text-title' : 'font-medium text-text'}`}>{chat.name}</span>
        <span className="shrink-0 text-12 text-text-faint tabular">{chat.lastMessage ? messageTimeLabel(chat.lastMessage.at) : ''}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-12 text-text-muted">{previewText(chat.lastMessage)}</span>
        {chat.unread > 0 && (
          <span data-whatsapp-unread className="shrink-0 rounded-[var(--radius-control)] bg-accent px-1.5 text-12 font-medium text-on-accent tabular">
            {chat.unread}
          </span>
        )}
      </span>
    </button>
  )
}

/** Uma mensagem: autor e hora, o texto sempre como texto e a mídia só como metadado. */
function MessageItem({ message }: { message: WhatsAppMessage }) {
  return (
    <li data-whatsapp-message={message.id} data-from-me={message.fromMe ? 'true' : 'false'} className={`flex flex-col gap-0.5 ${message.fromMe ? 'items-end' : 'items-start'}`}>
      <span className="flex items-baseline gap-2 text-12">
        <span className="font-medium text-text-muted">{message.fromMe ? 'Você' : message.author}</span>
        <span className="text-text-faint tabular">{clockLabel(message.at)}</span>
      </span>
      <div className={`max-w-[560px] rounded-[var(--radius-panel)] px-3 py-2 text-15 whitespace-pre-wrap text-text select-text ${message.fromMe ? 'bg-bg-sunken' : 'border border-line bg-bg-raised'}`}>
        {message.media && (
          <span data-whatsapp-media className="mb-1 flex items-center gap-1.5 text-13 text-text-muted">
            <Icon icon={Paperclip} size={14} className="shrink-0" />
            {mediaLabel(message.media)}
          </span>
        )}
        {message.text && <span data-whatsapp-text>{message.text}</span>}
      </div>
    </li>
  )
}

interface ConversationProps {
  chat: WhatsAppChat
}

/** A conversa aberta: mensagens (mais antigas ao rolar para cima), o campo, "Enviar" e "Rascunho com o Claude". */
function Conversation({ chat }: ConversationProps) {
  const messages = useWhatsApp((state) => state.messages[chat.id])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [meetingId, setMeetingId] = useState('')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const olderFrom = useRef<number | null>(null)

  // Cada conversa monta o seu próprio campo (`key`): trocar de conversa começa tudo do zero.
  useEffect(() => {
    void useWhatsApp.getState().open(chat.id)
  }, [chat.id])

  useEffect(() => {
    if (!draftOpen) return
    void window.__scribeApi.invoke('scribe:meetings-list').then(
      (all) => setMeetings([...all].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 30)),
      () => setMeetings([]),
    )
  }, [draftOpen])

  // Fim da lista ao abrir e a cada mensagem nova (se a pessoa já estava no fim); mais antigas mantêm a posição.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (olderFrom.current !== null) {
      el.scrollTop = el.scrollHeight - olderFrom.current
      olderFrom.current = null
    } else if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (el.scrollTop < 40 && olderFrom.current === null && messages?.length) {
      olderFrom.current = el.scrollHeight - el.scrollTop
      void useWhatsApp
        .getState()
        .loadOlder(chat.id)
        .finally(() => {
          // Nada novo chegou: a posição fica como está.
          if (olderFrom.current !== null && list.current && list.current.scrollHeight - list.current.scrollTop === olderFrom.current) olderFrom.current = null
        })
    }
  }

  /**
   * O envio de verdade: só daqui, no clique (ou ⌘↵) da pessoa. O preload confere a ativação do usuário e o main abre
   * o diálogo nativo "Enviar para <nome>?" com o texto, em todo envio.
   */
  const sendNow = (): void => {
    const body = text
    if (!body.trim() || sending) return
    setSending(true)
    setSendError(null)
    void window.__scribeApi.whatsappSend({ chatId: chat.id, text: body }).then(
      (result) => {
        setSending(false)
        if (result.ok) {
          setText('')
          atBottom.current = true
          void useWhatsApp.getState().open(chat.id)
        } else setSendError(SEND_ERRORS[result.error])
      },
      () => {
        setSending(false)
        setSendError(SEND_ERRORS.failed)
      },
    )
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter só pula linha; ⌘↵ envia (com a confirmação nativa).
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      sendNow()
    }
  }

  const draft = (): void => {
    if (!instruction.trim() || drafting) return
    setDrafting(true)
    setDraftError(null)
    void window.__scribeApi.invoke('scribe:whatsapp-draft', { chatId: chat.id, instruction: instruction.trim(), meetingId: meetingId || null }).then(
      (result) => {
        setDrafting(false)
        if (result.ok) {
          // O rascunho vai para o campo; quem envia é a pessoa.
          setText(result.text)
          setDraftOpen(false)
          setInstruction('')
        } else setDraftError(DRAFT_ERRORS[result.error])
      },
      () => {
        setDrafting(false)
        setDraftError(DRAFT_ERRORS.failed)
      },
    )
  }

  return (
    <section data-whatsapp-conversation={chat.id} aria-label={chat.name} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-6">
        {chat.kind === 'group' && <Icon icon={Users} className="shrink-0 text-text-muted" />}
        <h2 data-whatsapp-chat-title className="truncate text-15 font-bold text-title">
          {chat.name}
        </h2>
        {chat.kind === 'group' && <span className="text-12 text-text-muted">Grupo</span>}
      </header>
      <div ref={list} onScroll={onScroll} data-whatsapp-messages className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {messages === undefined ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-10 w-2/3 rounded-[var(--radius-panel)] bg-bg-sunken" />
            ))}
          </div>
        ) : messages.length ? (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </ol>
        ) : (
          <p className="text-13 text-text-muted">Nenhuma mensagem guardada nesta conversa ainda.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-6 py-4">
        {draftOpen && (
          <div data-whatsapp-draft-panel className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-bg-sunken p-3">
            <label htmlFor="whatsapp-draft-instruction" className="text-12 font-medium text-text">
              O que o Claude deve escrever?
            </label>
            <input
              id="whatsapp-draft-instruction"
              type="text"
              value={instruction}
              maxLength={WHATSAPP_DRAFT_INSTRUCTION_MAX}
              placeholder="responda confirmando a reunião de sexta"
              autoComplete="off"
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  draft()
                }
              }}
              className="no-drag h-10 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 text-13 text-text select-text placeholder:text-text-faint"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="whatsapp-draft-meeting" className="text-12 text-text-muted">
                Reunião como contexto
              </label>
              <select
                id="whatsapp-draft-meeting"
                value={meetingId}
                onChange={(event) => setMeetingId(event.target.value)}
                className="no-drag h-8 min-w-0 flex-[1_1_200px] rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-12 text-text"
              >
                <option value="">Nenhuma</option>
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meeting.title}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-12 text-text-faint">O Claude só escreve o rascunho no campo. Nada é enviado sem o seu clique.</p>
            <div className="flex flex-wrap gap-2">
              <Button action="whatsapp-draft-run" icon={Sparkles} onClick={draft} disabled={drafting || !instruction.trim()}>
                {drafting ? 'Escrevendo…' : 'Escrever rascunho'}
              </Button>
              <Button action="whatsapp-draft-cancel" variant="secondary" onClick={() => setDraftOpen(false)}>
                Cancelar
              </Button>
            </div>
            {draftError && (
              <p role="alert" data-whatsapp-draft-error className="text-12 text-rec">
                {draftError}
              </p>
            )}
          </div>
        )}
        <label htmlFor="whatsapp-composer" className="sr-only">
          Mensagem para {chat.name}
        </label>
        <textarea
          id="whatsapp-composer"
          data-whatsapp-composer
          value={text}
          rows={3}
          maxLength={WHATSAPP_SEND_TEXT_MAX}
          placeholder="Escreva uma mensagem"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          className="no-drag min-h-[72px] resize-none rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2 text-15 text-text select-text placeholder:text-text-faint"
        />
        {sendError && (
          <p role="alert" data-whatsapp-send-error className="text-12 text-rec">
            {sendError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button action="whatsapp-draft" variant="secondary" icon={Sparkles} onClick={() => setDraftOpen(true)} disabled={draftOpen}>
            Rascunho com o Claude
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-12 text-text-faint">Enter pula linha</span>
            <Button action="whatsapp-send" onClick={sendNow} disabled={!text.trim() || sending} shortcut="⌘↵" ariaShortcut="Meta+Enter">
              Enviar
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Tela "WhatsApp" (contrato 24, CA3): conversas à esquerda (busca, não lidas, grupos marcados) e a conversa aberta.
 * Mensagens novas chegam pelo `/events` do serviço. Só aparece na barra lateral com o serviço instalado.
 */
export function WhatsAppScreen() {
  const status = useWhatsApp((state) => state.status)
  const chats = useWhatsApp((state) => state.chats)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ term: string; found: WhatsAppSearchHit[] } | null>(null)
  const connected = status?.state === 'connected'

  useEffect(() => {
    if (connected) void useWhatsApp.getState().loadChats()
  }, [connected])

  // Busca nas mensagens a partir de 2 letras; o nome filtra a lista na hora.
  const searchTerm = query.trim()
  const searching = searchTerm.length >= 2 && connected
  useEffect(() => {
    if (!searching) return
    const timer = setTimeout(() => {
      void window.__scribeApi.invoke('scribe:whatsapp-search', { term: searchTerm }).then(
        (found) => setHits({ term: searchTerm, found }),
        () => setHits(null),
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [searchTerm, searching])
  const shownHits = searching && hits?.term === searchTerm ? hits.found : null

  // Mensagem nova na conversa aberta não conta como não lida.
  useEffect(() => {
    if (!selected) return
    return window.__scribeApi.on('scribe:whatsapp-message', ({ message }) => {
      if (message.chatId === selected) useWhatsApp.setState((state) => ({ chats: state.chats?.map((chat) => (chat.id === selected ? { ...chat, unread: 0 } : chat)) ?? null }))
    })
  }, [selected])

  const term = query.trim().toLocaleLowerCase('pt-BR')
  const shown = (chats ?? []).filter((chat) => !term || chat.name.toLocaleLowerCase('pt-BR').includes(term))
  const open = chats?.find((chat) => chat.id === selected) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 px-10 pt-7 pb-6">
        <PageHeader title="WhatsApp" description="As suas conversas, lidas neste Mac. Nenhuma mensagem sai sem o seu clique em Enviar." />
        <Note id="whatsapp-screen-warning" icon={TriangleAlert}>
          {WHATSAPP_FIXED_WARNING}
        </Note>
      </div>
      {!connected ? (
        <div className="border-t border-line px-10 py-8">
          <Note
            id="whatsapp-not-connected"
            icon={TriangleAlert}
            role="status"
            action={
              <Link to={settingsPath('contas')} className={NOTE_ACTION_CLASS}>
                Abrir Contas
              </Link>
            }
          >
            O WhatsApp não está conectado. Ligue o serviço e pareie o celular em Configurações › Contas.
          </Note>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 border-t border-line">
          <aside aria-label="Conversas do WhatsApp" className="flex w-[280px] shrink-0 flex-col border-r border-line">
            <div className="p-3">
              <div className="no-drag flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-text-faint has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
                <Icon icon={Search} size={14} />
                <input
                  type="text"
                  data-whatsapp-search
                  value={query}
                  placeholder="Buscar conversas e mensagens"
                  aria-label="Buscar conversas e mensagens"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-12 text-text select-text placeholder:text-text-faint focus-visible:outline-none"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {chats === null ? (
                <p className="px-2 text-12 text-text-muted">Carregando…</p>
              ) : (
                <ul data-whatsapp-chats className="flex flex-col gap-0.5">
                  {shown.map((chat) => (
                    <li key={chat.id}>
                      <ChatRow chat={chat} active={chat.id === selected} onOpen={() => setSelected(chat.id)} />
                    </li>
                  ))}
                  {!shown.length && <li className="px-2 text-12 text-text-muted">{chats.length ? 'Nenhuma conversa com esse nome.' : 'Nenhuma conversa ainda.'}</li>}
                </ul>
              )}
              {shownHits && (
                <section aria-label="Mensagens encontradas" className="mt-4 flex flex-col gap-1">
                  <h3 className="px-2 text-12 font-bold text-text-muted">Mensagens</h3>
                  {shownHits.length ? (
                    <ul data-whatsapp-hits className="flex flex-col gap-0.5">
                      {shownHits.map((hit) => (
                        <li key={`${hit.chatId}:${hit.id}`}>
                          <button type="button" onClick={() => setSelected(hit.chatId)} className="no-drag flex w-full min-w-0 flex-col rounded-[var(--radius-control)] px-2.5 py-1.5 text-left hover:bg-bg-sunken">
                            <span className="truncate text-12 font-medium text-text">
                              {hit.chatName} · {messageTimeLabel(hit.at)}
                            </span>
                            <span className="truncate text-12 text-text-muted">{hit.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-2 text-12 text-text-muted">Nada encontrado.</p>
                  )}
                </section>
              )}
            </div>
          </aside>
          {open ? (
            <Conversation key={open.id} chat={open} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-13 text-text-muted">Escolha uma conversa.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
