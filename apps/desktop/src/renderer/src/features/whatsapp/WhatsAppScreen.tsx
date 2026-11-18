import { FileText, Image as ImageIcon, Mic, PanelRight, Paperclip, Search, Sparkles, Sticker, TriangleAlert, Video, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject, type UIEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { settingsPath, type WhatsAppNavigationState } from '@shared/routes'
import type { Meeting } from '@shared/meetings'
import {
  mediaLabel,
  WHATSAPP_DRAFT_INSTRUCTION_MAX,
  WHATSAPP_SEND_TEXT_MAX,
  type WhatsAppChat,
  type WhatsAppMessage,
  type WhatsAppMessageType,
  type WhatsAppSearchHit,
} from '@shared/whatsapp'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { Avatar } from './Avatar'
import { DetailsPanel } from './DetailsPanel'
import { chatPhone, clockLabel, detailsStartOpen, messageTimeLabel, previewText, startsRun } from './format'
import { visibleMessages, visiblePending, type PendingSend } from './pending'
import { useWhatsApp } from './whatsappStore'

const SEND_ERRORS: Record<'click' | 'state' | 'invalid' | 'failed', string> = {
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

/** Pede a foto da conversa quando o elemento aparece na tela (sem `IntersectionObserver` ou na conversa aberta, logo ao montar). */
function usePhoto(chatId: string, target: RefObject<Element | null>, again = false): string | null | undefined {
  const photo = useWhatsApp((state) => state.photos[chatId])
  useEffect(() => {
    const el = target.current
    // A conversa aberta (`again`) pede de novo a que veio sem foto, uma vez por abertura.
    if (again || !el || typeof IntersectionObserver === 'undefined') {
      useWhatsApp.getState().requestPhoto(chatId, again)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        useWhatsApp.getState().requestPhoto(chatId)
        observer.disconnect()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [chatId, target, again])
  return photo
}

/** Uma linha da lista de conversas: foto (ou iniciais), nome, hora, prévia e não lidas. */
function ChatRow({ chat, active, onOpen }: { chat: WhatsAppChat; active: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const photo = usePhoto(chat.id, ref)
  const group = chat.kind === 'group'
  return (
    <button
      ref={ref}
      type="button"
      data-whatsapp-chat={chat.id}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={`no-drag flex w-full min-w-0 items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
    >
      <span className="flex shrink-0" {...(group ? { 'data-whatsapp-group': '', title: 'Grupo' } : {})}>
        <Avatar id={chat.id} name={chat.name} photo={photo} group={group} size={10} />
        {group && <span className="sr-only">Grupo:</span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-13 ${chat.unread ? 'font-bold text-title' : 'font-medium text-text'}`}>{chat.name}</span>
          <span className={`shrink-0 text-12 tabular ${chat.unread ? 'text-accent' : 'text-text-faint'}`}>{chat.lastMessage ? messageTimeLabel(chat.lastMessage.at) : ''}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-12 text-text-muted">{previewText(chat.lastMessage)}</span>
          {chat.unread > 0 && (
            <span data-whatsapp-unread className="shrink-0 rounded-[var(--radius-control)] bg-accent px-1.5 text-12 font-medium text-on-accent tabular">
              {chat.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

const MEDIA_ICONS: Record<WhatsAppMessageType, LucideIcon> = {
  text: Paperclip,
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
  sticker: Sticker,
  other: Paperclip,
}

/**
 * Uma mensagem: o texto sempre como texto e a mídia só como metadado (ícone do tipo, nome e tamanho). As suas à
 * direita, em azul; as dos outros à esquerda, com a foto (ou as iniciais) e, num grupo, o autor, só na primeira de
 * uma sequência do mesmo autor.
 */
function MessageItem({ message, first, group, photo, swapped }: { message: WhatsAppMessage; first: boolean; group: boolean; photo: string | null | undefined; swapped: boolean }) {
  const mine = message.fromMe
  const author = mine ? 'Você' : message.author
  return (
    <li
      data-whatsapp-message={message.id}
      data-from-me={mine ? 'true' : 'false'}
      className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-3 first:mt-0' : 'mt-1'}`}
    >
      {!mine && (
        <span className="flex size-8 shrink-0" aria-hidden={first ? undefined : 'true'}>
          {first && <Avatar id={group ? `${message.chatId}:${message.author}` : message.chatId} name={message.author} photo={group ? null : photo} />}
        </span>
      )}
      <div className={`flex max-w-[560px] min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] px-3 py-2 text-15 whitespace-pre-wrap select-text ${mine ? 'bg-accent text-on-accent' : 'border border-line bg-bg-raised text-text'}`}>
        {group && !mine && first ? <span className="text-12 font-bold text-accent">{author}</span> : <span className="sr-only">{author}: </span>}
        {message.media && (
          <span data-whatsapp-media className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-13 ${mine ? 'bg-bg-raised text-text' : 'bg-bg-sunken text-text-muted'}`}>
            <Icon icon={MEDIA_ICONS[message.media.kind]} size={14} className="shrink-0" />
            {mediaLabel(message.media)}
          </span>
        )}
        {/* Contrato 36: entrou no lugar do balão temporário; o texto (o corrigido) troca com um fade curto. */}
        {message.text && (
          <span data-whatsapp-text className={swapped ? 'wa-swap-in' : undefined}>
            {message.text}
          </span>
        )}
        <span className={`self-end text-12 tabular ${mine ? 'opacity-80' : 'text-text-faint'}`}>{clockLabel(message.at)}</span>
      </div>
    </li>
  )
}

/**
 * Contrato 36: o balão temporário do envio com "Corrigir ao enviar" ligado. O texto como foi digitado, com um brilho
 * discreto e a linha da IA enquanto ela ajusta; o eco do serviço (com o texto corrigido) entra no lugar dele. Se o eco
 * demorar, o brilho para e a linha diz "Enviada" (o texto continua o digitado: nada é inventado).
 */
function PendingItem({ item }: { item: PendingSend }) {
  const correcting = item.phase === 'correcting'
  return (
    <li data-wa-pending={item.key} data-wa-pending-phase={item.phase} className="mt-3 flex items-end justify-end gap-2 first:mt-0">
      <div className={`flex max-w-[560px] min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] bg-accent px-3 py-2 text-15 whitespace-pre-wrap text-on-accent select-text ${correcting ? 'wa-pending-shimmer' : ''}`}>
        <span className="sr-only">Você: </span>
        <span data-wa-pending-text>{item.text}</span>
        <span data-wa-pending-status role="status" className="flex items-center gap-1 self-end text-12 opacity-80">
          <Icon icon={Sparkles} size={14} className="shrink-0" />
          {correcting ? 'A IA está ajustando o texto…' : 'Enviada'}
        </span>
      </div>
    </li>
  )
}

/** O texto que voltou de um envio que falhou, antes do que já estiver no campo (nada se perde). */
function joinRestored(back: string | undefined, current: string): string {
  if (!back) return current
  return current.trim() ? `${back}\n${current}` : back
}

interface ConversationProps {
  chat: WhatsAppChat
  /** Contrato 25: "Abrir no WhatsApp" do cartão do Assistente traz o texto para o campo (nada é enviado). */
  initialText?: string | undefined
  /** Contrato 32: o painel Detalhes está aberto (o botão do cabeçalho o abre e fecha). */
  detailsOpen: boolean
  onDetails: (open: boolean) => void
}

/** A conversa aberta: mensagens (mais antigas ao rolar para cima), o campo, "Enviar" e "Rascunho com o Claude". */
function Conversation({ chat, initialText, detailsOpen, onDetails }: ConversationProps) {
  const messages = useWhatsApp((state) => state.messages[chat.id])
  const pendingAll = useWhatsApp((state) => state.pending[chat.id])
  const swapped = useWhatsApp((state) => state.swapped)
  const autoCorrect = useSettings((state) => state.settings.whatsappAutoCorrect)
  const pending = visiblePending(pendingAll, messages)
  const shown = visibleMessages(messages, pendingAll)
  const header = useRef<HTMLElement | null>(null)
  const photo = usePhoto(chat.id, header, true)
  const group = chat.kind === 'group'
  const phone = chatPhone(chat)
  // Contrato 36: o envio otimista desta conversa falhou com ela fechada: o texto e o erro voltam ao abrir.
  const [restored] = useState(() => useWhatsApp.getState().restore[chat.id] ?? null)
  const [text, setText] = useState(() => joinRestored(restored?.text, initialText ?? ''))
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(restored?.error ?? null)
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

  // Contrato 36: um envio otimista desta conversa falhou com ela aberta: o texto volta ao campo, sem apagar o que a
  // pessoa já tiver escrito depois, e o erro aparece como no envio sem correção.
  useEffect(() => {
    if (restored && useWhatsApp.getState().restore[chat.id] === restored) useWhatsApp.getState().takeRestore(chat.id)
    return useWhatsApp.subscribe((state) => {
      if (!state.restore[chat.id]) return
      const back = state.takeRestore(chat.id)
      if (!back) return
      setText((current) => joinRestored(back.text, current))
      setSendError(back.error)
    })
  }, [restored, chat.id])

  // Fim da lista ao abrir e a cada mensagem nova (se a pessoa já estava no fim); mais antigas mantêm a posição.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (olderFrom.current !== null) {
      el.scrollTop = el.scrollHeight - olderFrom.current
      olderFrom.current = null
    } else if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, pendingAll])

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
   * O envio de verdade: só daqui, no clique (ou ⌘↵) da pessoa. O preload confere a ativação do usuário e o main só
   * envia com o token desse clique (sem diálogo de confirmação desde o contrato 33).
   */
  const sendNow = (): void => {
    const body = text
    if (!body.trim() || sending) return
    if (autoCorrect) {
      // Contrato 36: com a correção ligada, o campo limpa na hora e o balão temporário entra com o texto digitado
      // enquanto a IA ajusta; o eco do serviço (com o `id` que o envio devolve) troca um pelo outro.
      const chatId = chat.id
      const key = useWhatsApp.getState().startPending(chatId, body)
      setText('')
      setSendError(null)
      atBottom.current = true
      void window.__scribeApi.whatsappSend({ chatId, text: body }).then(
        (result) => {
          const store = useWhatsApp.getState()
          if (result.ok) {
            store.confirmPending(chatId, key, result.id)
            void store.open(chatId)
          } else store.failPending(chatId, key, SEND_ERRORS[result.error])
        },
        () => useWhatsApp.getState().failPending(chatId, key, SEND_ERRORS.failed),
      )
      return
    }
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
    // Enter só pula linha; ⌘↵ envia.
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
      <header ref={header} className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <Avatar id={chat.id} name={chat.name} photo={photo} group={group} size={10} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 data-whatsapp-chat-title className="truncate text-15 font-bold text-title">
            {chat.name}
          </h2>
          <span data-whatsapp-chat-subtitle className="truncate text-12 text-text-muted tabular">
            {group ? 'grupo' : (phone ?? 'pessoa')}
          </span>
        </div>
        <button
          type="button"
          data-action="toggle-whatsapp-details"
          aria-pressed={detailsOpen}
          onClick={() => onDetails(!detailsOpen)}
          className={`no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong px-2 text-12 font-medium text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken ${detailsOpen ? 'bg-bg-sunken' : ''}`}
        >
          <Icon icon={PanelRight} size={14} />
          Detalhes
        </button>
      </header>
      <div ref={list} onScroll={onScroll} data-whatsapp-messages className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {messages === undefined ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-10 w-2/3 rounded-[var(--radius-panel)] bg-bg-sunken" />
            ))}
          </div>
        ) : shown?.length || pending.length ? (
          <ol className="flex flex-col">
            {shown?.map((message, index) => (
              <MessageItem key={message.id} message={message} first={startsRun(message, shown[index - 1])} group={group} photo={photo} swapped={swapped[message.id] === true} />
            ))}
            {pending.map((item) => (
              <PendingItem key={item.key} item={item} />
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
          <div className="flex items-center gap-3" title="Nenhuma mensagem sai sem o seu clique em Enviar.">
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

/** O painel Detalhes da conversa aberta, com as mensagens carregadas dela. */
function OpenDetails({ chat, onClose }: { chat: WhatsAppChat; onClose: () => void }) {
  const messages = useWhatsApp((state) => state.messages[chat.id])
  return <DetailsPanel chat={chat} messages={messages} onClose={onClose} />
}

/**
 * Tela "WhatsApp" (contrato 24, CA3; três colunas no contrato 32: conversas, a conversa aberta e os Detalhes): conversas à esquerda (busca, não lidas, grupos marcados) e a conversa aberta.
 * Mensagens novas chegam pelo `/events` do serviço. Só aparece na barra lateral com o serviço instalado.
 */
export function WhatsAppScreen() {
  const status = useWhatsApp((state) => state.status)
  const chats = useWhatsApp((state) => state.chats)
  // Contrato 25: o cartão do Assistente e a notificação de um lembrete abrem uma conversa (com o texto no campo).
  const location = useLocation()
  const asked = (location.state ?? null) as WhatsAppNavigationState | null
  const [selected, setSelected] = useState<string | null>(asked?.chatId ?? null)
  // Já na tela, um pedido novo (outra navegação) troca a conversa aberta.
  const [seenKey, setSeenKey] = useState(location.key)
  if (seenKey !== location.key) {
    setSeenKey(location.key)
    if (asked?.chatId) setSelected(asked.chatId)
  }
  const [query, setQuery] = useState('')
  // Contrato 33: o painel Detalhes começa aberto com a janela larga (fechado abaixo) e, depois, fica como a pessoa
  // deixou, ao trocar de conversa e ao redimensionar, enquanto a tela está montada.
  const [detailsOpen, setDetailsOpen] = useState(() => detailsStartOpen(window.innerWidth))
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
    // Contrato 33: sem título nem aviso no topo (o aviso do cliente não oficial fica no pareamento); as colunas
    // começam no topo da área.
    <div className="flex min-h-0 flex-1 flex-col">
      {!connected ? (
        <div className="px-10 pt-7 pb-8">
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
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Conversas do WhatsApp" className={`flex w-[300px] shrink-0 flex-col border-r border-line ${open && detailsOpen ? 'max-[1279px]:hidden' : ''}`}>
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
            <>
              <Conversation key={`${open.id}:${location.key}`} chat={open} initialText={asked?.chatId === open.id ? asked.text : undefined} detailsOpen={detailsOpen} onDetails={setDetailsOpen} />
              {detailsOpen && <OpenDetails key={open.id} chat={open} onClose={() => setDetailsOpen(false)} />}
            </>
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
