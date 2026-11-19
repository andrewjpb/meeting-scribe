import { Paperclip, PanelRight, Reply, Search, SmilePlus, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject, type UIEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { settingsPath, type WhatsAppNavigationState } from '@shared/routes'
import type { Meeting } from '@shared/meetings'
import {
  WHATSAPP_DRAFT_INSTRUCTION_MAX,
  WHATSAPP_REACTION_EMOJIS,
  WHATSAPP_SEND_TEXT_MAX,
  type WhatsAppChat,
  type WhatsAppMessage,
  type WhatsAppReactionEmoji,
  type WhatsAppReactResult,
  type WhatsAppSearchHit,
} from '@shared/whatsapp'
import { attachErrorText, attachName, WHATSAPP_ATTACH_HEAD, type WhatsAppAttachment, type WhatsAppSendMediaResult } from '@shared/whatsapp-attach'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { AttachCard } from './AttachCard'
import { carriesFiles, chooseDropped, DROP_FILES_MAX, previewFor, type AttachPreview } from './attach'
import { Avatar } from './Avatar'
import { DetailsPanel } from './DetailsPanel'
import { toBlob } from './media'
import { MessageMedia } from './MessageMedia'
import { chatPhone, clockLabel, detailsStartOpen, messageTimeLabel, previewText, startsRun } from './format'
import { createTypingSignal, quotedBlock, quoteFor, reactionToSend, typingLabel, type ReplyQuote, type TypingSignal } from './interactions'
import { visibleMessages, visiblePending, type PendingSend } from './pending'
import { useWhatsApp } from './whatsappStore'

const SEND_ERRORS: Record<'click' | 'state' | 'invalid' | 'failed', string> = {
  click: 'A mensagem só sai com o seu clique em "Enviar". Clique de novo.',
  state: 'O WhatsApp não está conectado. Confira em Configurações › Contas.',
  invalid: 'A mensagem está vazia ou passou de 4 096 caracteres.',
  failed: 'O WhatsApp não aceitou a mensagem. Tente de novo.',
}

/** Contrato 39: o envio do anexo. */
const MEDIA_SEND_ERRORS: Record<Extract<WhatsAppSendMediaResult, { ok: false }>['error'], string> = {
  click: 'O arquivo só sai com o seu clique em "Enviar". Clique de novo.',
  state: SEND_ERRORS.state,
  invalid: 'O arquivo não é uma imagem ou um vídeo aceito.',
  'too-big': 'O arquivo passa do limite do WhatsApp (imagem até 16 MB, vídeo até 64 MB).',
  timeout: 'Demorou demais — confira na conversa se chegou antes de tentar de novo.',
  ffmpeg: 'Instale o ffmpeg para enviar vídeos (brew install ffmpeg).',
  failed: 'O WhatsApp não aceitou o arquivo. Tente de novo.',
}

/** Contrato 34: a reação. */
const REACT_ERRORS: Record<Extract<WhatsAppReactResult, { ok: false }>['error'], string> = {
  click: 'A reação só sai com o seu clique. Clique de novo.',
  state: SEND_ERRORS.state,
  invalid: 'Essa reação não está disponível.',
  missing: 'Não dá para reagir a esta mensagem (ela chegou antes desta versão do app).',
  failed: 'O WhatsApp não aceitou a reação. Tente de novo.',
}

const isReactionEmoji = (emoji: string): emoji is WhatsAppReactionEmoji => (WHATSAPP_REACTION_EMOJIS as readonly string[]).includes(emoji)

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
  // Contrato 34: "digitando…" no lugar da prévia enquanto a pessoa escreve (o aviso vence sozinho).
  const typing = useWhatsApp((state) => typingLabel(state.typing, chat.id, group, Date.now()))
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
          {typing ? (
            <span data-wa-typing className="min-w-0 flex-1 truncate text-12 text-accent">
              {typing}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-12 text-text-muted">{previewText(chat.lastMessage)}</span>
          )}
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

interface MessageItemProps {
  message: WhatsAppMessage
  first: boolean
  group: boolean
  photo: string | null | undefined
  swapped: boolean
  /** Contrato 34: a mensagem citada carregada na tela (para o autor e o rolar até ela). */
  loaded: readonly WhatsAppMessage[] | undefined
  /** O seletor dos 6 emojis está aberto neste balão. */
  picking: boolean
  onReply: (message: WhatsAppMessage) => void
  onPick: (messageId: string | null) => void
  onReact: (message: WhatsAppMessage, emoji: WhatsAppReactionEmoji) => void
  onQuote: (messageId: string) => void
}

const ACTION_BUTTON_CLASS =
  'no-drag inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken hover:text-title'

/** Contrato 34: "Responder" e "Reagir", à vista ao passar o mouse (ou com o foco) no balão. */
function MessageActions({ message, picking, onReply, onPick }: Pick<MessageItemProps, 'message' | 'picking' | 'onReply' | 'onPick'>) {
  return (
    <span className={`flex shrink-0 items-center gap-0.5 self-center transition-opacity duration-[var(--duration-fast)] ${picking ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
      <button type="button" data-wa-reply={message.id} aria-label="Responder" title="Responder" onClick={() => onReply(message)} className={ACTION_BUTTON_CLASS}>
        <Icon icon={Reply} size={16} />
      </button>
      <button type="button" data-wa-react-open={message.id} aria-label="Reagir" title="Reagir" aria-expanded={picking} onClick={() => onPick(picking ? null : message.id)} className={ACTION_BUTTON_CLASS}>
        <Icon icon={SmilePlus} size={16} />
      </button>
    </span>
  )
}

/**
 * Uma mensagem: o texto sempre como texto e a mídia como metadado (ícone do tipo, nome e tamanho) ou, no contrato 37,
 * o "Baixar" que a mostra no balão (`MessageMedia`), só no clique. As suas à
 * direita, em azul; as dos outros à esquerda, com a foto (ou as iniciais) e, num grupo, o autor, só na primeira de
 * uma sequência do mesmo autor. Contrato 34: a citação em cima do texto (clicar rola até a citada, se carregada), as
 * reações embaixo do balão e, no hover, "Responder" e "Reagir" (os 6 emojis fixos; tocar na sua de novo tira).
 */
function MessageItem({ message, first, group, photo, swapped, loaded, picking, onReply, onPick, onReact, onQuote }: MessageItemProps) {
  const mine = message.fromMe
  const author = mine ? 'Você' : message.author
  const quote = quotedBlock(message, loaded)
  const reactions = message.reactions ?? []
  return (
    <li
      data-whatsapp-message={message.id}
      data-from-me={mine ? 'true' : 'false'}
      className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-3 first:mt-0' : 'mt-1'}`}
    >
      {!mine && (
        <span className="flex size-8 shrink-0" aria-hidden={first ? undefined : 'true'}>
          {first && <Avatar id={group ? `${message.chatId}:${message.author}` : message.chatId} name={message.author} photo={group ? null : photo} />}
        </span>
      )}
      {mine && <MessageActions message={message} picking={picking} onReply={onReply} onPick={onPick} />}
      <div className={`flex max-w-[560px] min-w-0 flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
        <div data-wa-bubble className={`flex max-w-full min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] px-3 py-2 text-15 whitespace-pre-wrap select-text ${mine ? 'bg-accent text-on-accent' : 'border border-line bg-bg-raised text-text'}`}>
          {group && !mine && first ? <span className="text-12 font-bold text-accent">{author}</span> : <span className="sr-only">{author}: </span>}
          {quote && (
            <button
              type="button"
              data-wa-quote={quote.id}
              disabled={!quote.loaded}
              onClick={() => onQuote(quote.id)}
              title={quote.loaded ? 'Ir para a mensagem respondida' : undefined}
              className={`no-drag flex min-w-0 flex-col items-start rounded-[var(--radius-control)] border-l-2 px-2 py-1 text-left whitespace-normal disabled:cursor-default ${mine ? 'border-on-accent/60 bg-on-accent/10' : 'border-accent bg-bg-sunken'}`}
            >
              <span className="sr-only">Respondendo a </span>
              {quote.author && <span className={`text-12 font-bold ${mine ? 'text-on-accent' : 'text-accent'}`}>{quote.author}</span>}
              <span data-wa-quote-text className={`line-clamp-2 text-12 ${mine ? 'opacity-80' : 'text-text-muted'}`}>
                {quote.preview}
              </span>
            </button>
          )}
          {message.media && <MessageMedia message={message} mine={mine} />}
          {/* Contrato 36: entrou no lugar do balão temporário; o texto (o corrigido) troca com um fade curto. */}
          {message.text && (
            <span data-whatsapp-text className={swapped ? 'wa-swap-in' : undefined}>
              {message.text}
            </span>
          )}
          <span className={`self-end text-12 tabular ${mine ? 'opacity-80' : 'text-text-faint'}`}>{clockLabel(message.at)}</span>
        </div>
        {reactions.length > 0 && (
          <ul data-wa-reactions aria-label="Reações" className="flex flex-wrap gap-1">
            {reactions.map((reaction) => {
              const label = `${reaction.emoji} ${reaction.count}${reaction.mine ? ', a sua' : ''}`
              const chipClass = `inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border px-1.5 text-12 tabular ${reaction.mine ? 'border-accent bg-bg-sunken font-medium text-title' : 'border-line bg-bg-raised text-text'}`
              // Só os 6 fixos viram botão (tocar de novo tira a sua); os outros que chegam são só texto.
              return (
                <li key={reaction.emoji}>
                  {isReactionEmoji(reaction.emoji) ? (
                    <button
                      type="button"
                      data-wa-reaction={reaction.emoji}
                      data-mine={reaction.mine ? 'true' : 'false'}
                      aria-pressed={reaction.mine}
                      aria-label={label}
                      onClick={() => onReact(message, reaction.emoji as WhatsAppReactionEmoji)}
                      className={`no-drag ${chipClass} hover:bg-bg-sunken`}
                    >
                      <span aria-hidden="true">{reaction.emoji}</span>
                      <span aria-hidden="true">{reaction.count}</span>
                    </button>
                  ) : (
                    <span data-wa-reaction={reaction.emoji} data-mine={reaction.mine ? 'true' : 'false'} aria-label={label} className={chipClass}>
                      <span aria-hidden="true">{reaction.emoji}</span>
                      <span aria-hidden="true">{reaction.count}</span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {picking && (
          <div role="group" aria-label="Reagir com" data-wa-react-picker={message.id} className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-bg-raised p-1">
            {WHATSAPP_REACTION_EMOJIS.map((emoji) => {
              const isMine = reactions.some((reaction) => reaction.mine && reaction.emoji === emoji)
              return (
                <button
                  key={emoji}
                  type="button"
                  data-wa-react-emoji={emoji}
                  aria-pressed={isMine}
                  aria-label={isMine ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}
                  onClick={() => onReact(message, emoji)}
                  className={`no-drag inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-15 hover:bg-bg-sunken ${isMine ? 'bg-bg-sunken' : ''}`}
                >
                  {emoji}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {!mine && <MessageActions message={message} picking={picking} onReply={onReply} onPick={onPick} />}
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
  const typingSignalOn = useSettings((state) => state.settings.whatsappTypingSignal)
  const pending = visiblePending(pendingAll, messages)
  const shown = visibleMessages(messages, pendingAll)
  const header = useRef<HTMLElement | null>(null)
  const photo = usePhoto(chat.id, header, true)
  const group = chat.kind === 'group'
  const phone = chatPhone(chat)
  // Contrato 34: "digitando…" no cabeçalho, a citação do envio, o seletor de reação aberto e o erro da reação.
  const typing = useWhatsApp((state) => typingLabel(state.typing, chat.id, group, Date.now()))
  const [replyTo, setReplyTo] = useState<ReplyQuote | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [reactError, setReactError] = useState<string | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const typingSignal = useRef<TypingSignal | null>(null)
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
  // Contrato 39: a prévia do anexo (só na memória desta tela), a recusa e a sobreposição "Solte para anexar".
  const [previewState, setPreview] = useState<AttachPreview | null>(null)
  const preview = previewFor(previewState, chat.id)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  // A leitura do arquivo (soltar ou clipe) termina depois: só vira prévia com a conversa ainda aberta e fora de um envio.
  const mounted = useRef(true)
  const sendingNow = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

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

  // Contrato 34: o seu "digitando…" só existe com o interruptor ligado; trocar de conversa, sair ou desligar manda "parou".
  useEffect(() => {
    if (!typingSignalOn) return
    const chatId = chat.id
    const signal = createTypingSignal({
      send: (state) => {
        void window.__scribeApi.invoke('scribe:whatsapp-typing', { chatId, state }).catch(() => false)
      },
    })
    typingSignal.current = signal
    return () => {
      signal.stop()
      if (typingSignal.current === signal) typingSignal.current = null
    }
  }, [typingSignalOn, chat.id])

  // Contrato 34: Esc fecha o seletor de reação aberto (antes de qualquer outra coisa).
  useEffect(() => {
    if (!picking) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setPicking(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [picking])

  // Contrato 39: o object URL da miniatura sai junto com a prévia (descartada, enviada ou a conversa fechada).
  useEffect(() => {
    if (!previewState) return
    return () => URL.revokeObjectURL(previewState.url)
  }, [previewState])

  // Esc descarta a prévia (a sobreposição da imagem do contrato 37, aberta por cima, fecha antes).
  useEffect(() => {
    if (!previewState || sending) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setPreview(null)
      setAttachError(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewState, sending])

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

  /** Contrato 39: o arquivo aceito vira a prévia; nada é enviado. Conversa fechada ou envio em curso: descarta. */
  const showAttachment = (attachment: WhatsAppAttachment): void => {
    if (!mounted.current || sendingNow.current) return
    setAttachError(null)
    setSendError(null)
    setPreview({ ...attachment, chatId: chat.id, url: URL.createObjectURL(toBlob(attachment.bytes, attachment.mime)) })
  }

  /** Soltar: o primeiro arquivo aceito pelos primeiros bytes (a extensão e o tipo do navegador não contam). */
  const attachFiles = async (files: File[]): Promise<void> => {
    const heads = await Promise.all(files.map(async (file) => ({ size: file.size, head: new Uint8Array(await file.slice(0, WHATSAPP_ATTACH_HEAD).arrayBuffer()) })))
    const choice = chooseDropped(heads)
    if (!choice || !mounted.current) return
    if (!choice.ok) {
      setAttachError(attachErrorText(choice.error, choice.kind))
      return
    }
    const file = files[choice.index]
    if (!file) return
    showAttachment({ name: attachName(file.name), mime: choice.mime, kind: choice.kind, bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  const onDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (!carriesFiles([...event.dataTransfer.types])) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!carriesFiles([...event.dataTransfer.types])) return
    event.preventDefault()
    event.dataTransfer.dropEffect = sending ? 'none' : 'copy'
  }
  const onDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (!carriesFiles([...event.dataTransfer.types])) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!carriesFiles([...event.dataTransfer.types])) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (sending) return
    const files = [...event.dataTransfer.files].slice(0, DROP_FILES_MAX)
    if (files.length) void attachFiles(files).catch(() => setAttachError(attachErrorText('type')))
  }

  /** O clipe: o seletor do macOS no main, que devolve o arquivo já conferido. */
  const pickAttachment = (): void => {
    if (sending) return
    void window.__scribeApi.invoke('scribe:whatsapp-attach-pick').then(
      (result) => {
        if (!result || !mounted.current || sendingNow.current) return
        if (result.ok) showAttachment(result.attachment)
        else setAttachError(attachErrorText(result.error, result.kind))
      },
      () => {
        if (mounted.current) setAttachError(attachErrorText('type'))
      },
    )
  }

  /**
   * Contrato 39: o anexo sai pelo mesmo caminho do texto (o token do clique no preload, o guarda no main), com a legenda
   * como foi digitada: sem o balão otimista e sem a correção do contrato 35. Falhou, a prévia fica para tentar de novo.
   */
  const sendMedia = (current: AttachPreview): void => {
    const chatId = chat.id
    sendingNow.current = true
    setSending(true)
    setSendError(null)
    void window.__scribeApi.whatsappSendMedia({ chatId, name: current.name, mime: current.mime, bytes: current.bytes, caption: text.trim() ? text : undefined }).then(
      (result) => {
        sendingNow.current = false
        setSending(false)
        if (result.ok) {
          setPreview(null)
          setText('')
          atBottom.current = true
          void useWhatsApp.getState().open(chatId)
        } else setSendError(MEDIA_SEND_ERRORS[result.error])
      },
      () => {
        sendingNow.current = false
        setSending(false)
        setSendError(MEDIA_SEND_ERRORS.failed)
      },
    )
  }

  /** Contrato 34: "Responder" num balão: a citação vai para a barra acima do campo, e o foco para o campo. */
  const startReply = (message: WhatsAppMessage): void => {
    setReplyTo(quoteFor(message))
    setPicking(null)
    composer.current?.focus()
  }

  /**
   * Contrato 34: a citada carregada na tela: rola até ela, direto (a rolagem suave depende de quadros que a janela em
   * segundo plano não pinta, e o que importa é a mensagem ficar à vista).
   */
  const scrollToMessage = (messageId: string): void => {
    const target = [...(list.current?.querySelectorAll<HTMLElement>('[data-whatsapp-message]') ?? [])].find((el) => el.dataset['whatsappMessage'] === messageId)
    if (!target) return
    atBottom.current = false
    target.scrollIntoView({ block: 'center' })
  }

  /**
   * Contrato 34: reagir é envio, só daqui, no clique da pessoa: o preload confere a ativação e gera o token, e o main só
   * envia com ele. Tocar na sua reação de novo tira (vai o emoji vazio).
   */
  const react = (message: WhatsAppMessage, emoji: WhatsAppReactionEmoji): void => {
    const chatId = chat.id
    setPicking(null)
    setReactError(null)
    void window.__scribeApi.whatsappReact({ chatId, messageId: message.id, emoji: reactionToSend(message.reactions, emoji) }).then(
      (result) => {
        if (result.ok) useWhatsApp.getState().setReactions(chatId, message.id, result.reactions)
        else if (mounted.current) setReactError(REACT_ERRORS[result.error])
      },
      () => {
        if (mounted.current) setReactError(REACT_ERRORS.failed)
      },
    )
  }

  /**
   * O envio de verdade: só daqui, no clique (ou ⌘↵) da pessoa. O preload confere a ativação do usuário e o main só
   * envia com o token desse clique (sem diálogo de confirmação desde o contrato 33). Contrato 34: com a barra de
   * citação, o texto sai como resposta (a mídia não: responder com mídia fica de fora).
   */
  const sendNow = (): void => {
    if (preview) {
      if (!sending) sendMedia(preview)
      return
    }
    const body = text
    if (!body.trim() || sending) return
    const replyToId = replyTo?.id
    typingSignal.current?.stop()
    if (autoCorrect) {
      // Contrato 36: com a correção ligada, o campo limpa na hora e o balão temporário entra com o texto digitado
      // enquanto a IA ajusta; o eco do serviço (com o `id` que o envio devolve) troca um pelo outro.
      const chatId = chat.id
      const key = useWhatsApp.getState().startPending(chatId, body)
      setText('')
      setReplyTo(null)
      setSendError(null)
      atBottom.current = true
      void window.__scribeApi.whatsappSend({ chatId, text: body, replyToId }).then(
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
    void window.__scribeApi.whatsappSend({ chatId: chat.id, text: body, replyToId }).then(
      (result) => {
        setSending(false)
        if (result.ok) {
          setText('')
          setReplyTo(null)
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
    // Contrato 34: Esc no campo tira a citação (antes de descartar o anexo).
    if (event.key === 'Escape' && replyTo && !preview && !event.defaultPrevented) {
      event.preventDefault()
      setReplyTo(null)
      return
    }
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
    <section
      data-whatsapp-conversation={chat.id}
      aria-label={chat.name}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {dragging && (
        <div data-wa-drop aria-hidden="true" className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-[var(--radius-panel)] border-2 border-dashed border-accent bg-bg/90 text-15 font-medium text-title">
          Solte para anexar
        </div>
      )}
      <header ref={header} className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <Avatar id={chat.id} name={chat.name} photo={photo} group={group} size={10} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 data-whatsapp-chat-title className="truncate text-15 font-bold text-title">
            {chat.name}
          </h2>
          {typing ? (
            <span data-wa-typing role="status" className="truncate text-12 text-accent">
              {typing}
            </span>
          ) : (
            <span data-whatsapp-chat-subtitle className="truncate text-12 text-text-muted tabular">
              {group ? 'grupo' : (phone ?? 'pessoa')}
            </span>
          )}
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
              <MessageItem
                key={message.id}
                message={message}
                first={startsRun(message, shown[index - 1])}
                group={group}
                photo={photo}
                swapped={swapped[message.id] === true}
                loaded={messages}
                picking={picking === message.id}
                onReply={startReply}
                onPick={setPicking}
                onReact={react}
                onQuote={scrollToMessage}
              />
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
        {preview && (
          <AttachCard
            preview={preview}
            sending={sending}
            onDiscard={() => {
              setPreview(null)
              setAttachError(null)
            }}
          />
        )}
        {attachError && (
          <p role="alert" data-wa-attach-error className="text-12 text-rec">
            {attachError}
          </p>
        )}
        {reactError && (
          <p role="alert" data-wa-react-error className="text-12 text-rec">
            {reactError}
          </p>
        )}
        {/* Contrato 34: a barra de citação: quem mandou e o trecho; o X (ou Esc no campo) tira. */}
        {replyTo && !preview && (
          <div data-wa-reply-bar={replyTo.id} className="flex items-center gap-2 rounded-[var(--radius-control)] border-l-2 border-accent bg-bg-sunken py-1.5 pr-1 pl-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-12 font-bold text-accent">Respondendo a {replyTo.author}</span>
              <span data-wa-reply-bar-text className="truncate text-12 text-text-muted">
                {replyTo.preview}
              </span>
            </span>
            <button
              type="button"
              data-wa-reply-cancel
              aria-label="Não responder a esta mensagem"
              title="Cancelar a resposta (Esc)"
              onClick={() => {
                setReplyTo(null)
                composer.current?.focus()
              }}
              className="no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-raised hover:text-title"
            >
              <Icon icon={X} size={16} />
            </button>
          </div>
        )}
        <label htmlFor="whatsapp-composer" className="sr-only">
          {preview ? `Legenda para ${chat.name}` : `Mensagem para ${chat.name}`}
        </label>
        <textarea
          id="whatsapp-composer"
          ref={composer}
          data-whatsapp-composer
          value={text}
          rows={3}
          maxLength={WHATSAPP_SEND_TEXT_MAX}
          placeholder={preview ? 'Legenda (opcional)' : 'Escreva uma mensagem'}
          onChange={(event) => {
            setText(event.target.value)
            // Contrato 34: só a digitação da pessoa (não o rascunho do Claude) vira "digitando…", e só com o interruptor.
            typingSignal.current?.input(event.target.value)
          }}
          onKeyDown={onKey}
          className="no-drag min-h-[72px] resize-none rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2 text-15 text-text select-text placeholder:text-text-faint"
        />
        {sendError && (
          <p role="alert" data-whatsapp-send-error className="text-12 text-rec">
            {sendError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-wa-attach-pick
              aria-label="Anexar imagem ou vídeo"
              title="Anexar imagem ou vídeo (ou arraste para a conversa)"
              onClick={pickAttachment}
              disabled={sending}
              className="no-drag inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none disabled:opacity-50"
            >
              <Icon icon={Paperclip} />
            </button>
            <Button action="whatsapp-draft" variant="secondary" icon={Sparkles} onClick={() => setDraftOpen(true)} disabled={draftOpen}>
              Rascunho com o Claude
            </Button>
          </div>
          <div className="flex items-center gap-3" title="Nenhuma mensagem sai sem o seu clique em Enviar.">
            <span className="text-12 text-text-faint">Enter pula linha</span>
            <Button action="whatsapp-send" onClick={sendNow} disabled={(!text.trim() && !preview) || sending} shortcut="⌘↵" ariaShortcut="Meta+Enter">
              {sending && preview ? 'Enviando…' : 'Enviar'}
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

  // Contrato 40: o main sabe qual conversa está aberta aqui; com a janela em foco, ela não vira notificação.
  const viewing = connected ? selected : null
  useEffect(() => window.__scribeApi.send('scribe:whatsapp-viewing', { chatId: viewing }), [viewing])
  useEffect(() => () => window.__scribeApi.send('scribe:whatsapp-viewing', { chatId: null }), [])

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
