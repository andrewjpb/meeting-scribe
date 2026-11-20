import { AudioLines, ExternalLink, FileText, Image, Info, MessageSquareOff, Paperclip, RefreshCw, Send, TriangleAlert, Video, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { RedesConversation, RedesMessage, RedesMessageAttachment, RedesMessagesPayload } from '@shared/redes'
// Só do `redes-rules` (sem o zod), como o editor de publicação.
import { MESSAGE_TEXT_MAX_BYTES, messageBytes, outsideMessageWindow } from '@shared/redes-rules'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { ScrollFade } from '../../design/ScrollFade'
import { Avatar } from '../whatsapp/Avatar'
import { clockLabel, messageTimeLabel } from '../whatsapp/format'
import { redesDateTime } from './redesFormat'
import { useRedes } from './redesStore'

const PAGE_TOP = 'px-[var(--page-x)] pt-[var(--page-top)] pb-4'
/** A caixa de entrada do Instagram no navegador ("Abrir no Instagram"). */
const INSTAGRAM_INBOX_URL = 'https://www.instagram.com/direct/inbox/'

const ATTACHMENT: Readonly<Record<RedesMessageAttachment['kind'], { icon: LucideIcon; label: string }>> = {
  imagem: { icon: Image, label: 'Imagem' },
  video: { icon: Video, label: 'Vídeo' },
  audio: { icon: AudioLines, label: 'Áudio' },
  arquivo: { icon: FileText, label: 'Arquivo' },
  outro: { icon: Paperclip, label: 'Anexo' },
}

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Hoje", "Ontem" ou "17 de novembro" (com o ano, se não for o deste). */
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  if (sameDay(date, now)) return 'Hoje'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return 'Ontem'
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** A linha de apoio da conversa aberta: o @ e quando o contato escreveu por último. */
function lastInboundLine(conversation: RedesConversation, now: Date): string {
  const at = conversation.lastInboundAt
  if (!at) return `@${conversation.participantUsername}`
  const date = new Date(at)
  const when = sameDay(date, now) ? `às ${clockLabel(date.getTime())}` : `em ${messageTimeLabel(date.getTime(), now)} às ${clockLabel(date.getTime())}`
  return `@${conversation.participantUsername} · Última mensagem do contato ${when}`
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/**
 * Redes › Mensagens (contrato 74, R6 e CA11; artboards 06, 06b e 06c): as conversas da caixa de mensagens diretas em duas
 * colunas, a lista (280 px: nome, última mensagem numa linha, hora e o quadrado de não lida) e a conversa aberta, com os
 * balões no padrão do WhatsApp do app (recebidos à esquerda, enviados à direita) e a resposta embaixo (até 1000 bytes,
 * Enter envia, ⇧Enter quebra a linha; nada sai sem o clique ou a tecla). Abrir a seção lê o Instagram; abrir uma conversa
 * a marca como lida. Com o acesso às mensagens recusado pela Meta, a tela inteira vira a nota de como liberar.
 */
export function MessagesSection({ accountId, title, notice }: { accountId: string; title: string; notice: ReactNode }) {
  const payload = useRedes((store) => store.messages[accountId])
  const loading = useRedes((store) => store.messagesLoading[accountId] ?? false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    void useRedes.getState().refreshMessages(accountId)
  }, [accountId])

  const conversations = payload?.conversations ?? []
  const open = conversations.find((item) => item.id === selected) ?? null
  const refresh = (): void => void useRedes.getState().refreshMessages(accountId)

  const choose = (conversation: RedesConversation): void => {
    setSelected(conversation.id)
    if (conversation.unread) void useRedes.getState().markConversationRead(accountId, conversation.id)
  }

  // A conversa aberta que recebe mensagem com a janela em foco: a pessoa está lendo, então já conta como lida.
  const openUnread = open?.unread === true
  useEffect(() => {
    if (openUnread && selected && document.hasFocus()) void useRedes.getState().markConversationRead(accountId, selected)
  }, [accountId, openUnread, selected])

  let body: ReactNode
  if (payload?.access === 'denied') body = <MessagesDenied onRetry={refresh} loading={loading} />
  else if (!payload) body = <p className="px-[var(--page-x)] pt-4 text-13 text-text-muted">Lendo as mensagens…</p>
  else if (!conversations.length) body = <NoConversations payload={payload} />
  else {
    body = (
      <>
        <ConversationList conversations={conversations} messages={payload.messages} selectedId={open?.id ?? null} onOpen={choose} />
        {open ? (
          <ConversationPane key={open.id} accountId={accountId} conversation={open} messages={payload.messages[open.id] ?? []} />
        ) : (
          <div data-redes-conversation-none className="flex min-w-0 flex-1 items-center justify-center px-6 text-13 text-text-muted">
            Escolha uma conversa para ler e responder.
          </div>
        )}
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PAGE_TOP}>
        <PageHeader
          title={title}
          titleAttrs={{ 'data-redes-title': '' }}
          actions={
            <Button variant="secondary" icon={RefreshCw} action="redes-messages-refresh" data={{ 'data-redes-messages-refresh': '' }} onClick={refresh} disabled={loading}>
              Atualizar
            </Button>
          }
        />
      </div>
      {notice}
      {payload?.error && payload.access !== 'denied' && (
        <div className="px-[var(--page-x)] pb-3">
          <Note id="redes-messages-error" icon={TriangleAlert} role="status">
            {payload.error}. O que já estava aqui continua.
          </Note>
        </div>
      )}
      <div data-redes-messages className="flex min-h-0 flex-1 border-t border-line">
        {body}
      </div>
    </div>
  )
}

/** Artboard 06c: a Meta não liberou as mensagens (permissão, Standard Access ou "Permitir acesso" desligado). */
function MessagesDenied({ onRetry, loading }: { onRetry: () => void; loading: boolean }) {
  return (
    <div data-redes-messages-denied className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-[var(--page-x)] pt-5 pb-8">
      <Note id="redes-messages-denied" icon={Info} role="status" className="max-w-[640px]">
        <b className="font-medium text-title">O Instagram não liberou o acesso às mensagens desta conta.</b> Comentários, publicações e métricas continuam funcionando.
      </Note>
      <section aria-label="Como liberar" className="flex max-w-[640px] flex-col gap-2">
        <h2 className="label">Como liberar</h2>
        <ol className="flex flex-col gap-2 text-13 text-text">
          <Step n={1}>
            No app do Instagram, abra <b className="font-medium">Configurações › Mensagens › Ferramentas conectadas</b>.
          </Step>
          <Step n={2}>
            Ligue <b className="font-medium">Permitir acesso a mensagens</b>.
          </Step>
          <Step n={3}>
            Volte aqui e clique em <b className="font-medium">Tentar de novo</b>.
          </Step>
        </ol>
        <p className="text-12 text-text-muted">
          Com o app da Meta em modo de desenvolvimento, a conta precisa ter um papel no app (no painel da Meta, em Funções do app), e a Meta pode limitar as mensagens mesmo com o acesso
          ligado. Nesse caso este aviso continua.
        </p>
        <div>
          <Button icon={RefreshCw} action="redes-messages-retry" data={{ 'data-redes-messages-retry': '' }} onClick={onRetry} disabled={loading}>
            Tentar de novo
          </Button>
        </div>
      </section>
    </div>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-12 font-medium text-title tabular">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
    </li>
  )
}

function NoConversations({ payload }: { payload: RedesMessagesPayload }) {
  return (
    <div data-redes-messages-empty className="flex flex-1 flex-col items-center px-[var(--page-x)]">
      <div className="grow-[3]" />
      <EmptyState
        illustration={
          <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised text-text-muted">
            <Icon icon={MessageSquareOff} />
          </span>
        }
        title="Nenhuma conversa ainda"
      >
        {payload.updatedAt ? `As mensagens diretas da conta aparecem aqui. Última atualização em ${redesDateTime(payload.updatedAt)}.` : 'As mensagens diretas da conta aparecem aqui.'}
      </EmptyState>
      <div className="grow-[7]" />
    </div>
  )
}

/** A coluna das conversas: uma linha de 44 px por conversa, a mais recente em cima. */
function ConversationList({ conversations, messages, selectedId, onOpen }: { conversations: RedesConversation[]; messages: Record<string, RedesMessage[]>; selectedId: string | null; onOpen: (conversation: RedesConversation) => void }) {
  const listRef = useRef<HTMLUListElement>(null)
  const now = new Date()
  return (
    <aside aria-label="Conversas" className="relative flex w-[280px] shrink-0 flex-col border-r border-line">
      <ul ref={listRef} data-redes-conversations className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {conversations.map((conversation) => {
          const active = conversation.id === selectedId
          const last = messages[conversation.id]?.at(-1)
          const preview = conversation.lastMessage ? `${last?.fromMe ? 'Você: ' : ''}${conversation.lastMessage}` : 'Sem mensagens'
          return (
            <li key={conversation.id} className="flex">
              <button
                type="button"
                data-redes-conversation={conversation.id}
                aria-current={active ? 'true' : undefined}
                title={`${conversation.participantName} (@${conversation.participantUsername})`}
                onClick={() => onOpen(conversation)}
                className={`no-drag flex min-h-[var(--row-h)] w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1 text-left ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
              >
                <Avatar id={conversation.participantId} name={conversation.participantName} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-13 ${conversation.unread ? 'font-bold text-title' : 'font-medium text-text'}`}>{conversation.participantName}</span>
                    <span className={`shrink-0 text-12 tabular ${conversation.unread ? 'font-medium text-accent' : 'text-text-faint'}`}>{messageTimeLabel(Date.parse(conversation.updatedAt), now)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-12 ${conversation.unread ? 'font-medium text-accent' : 'text-text-muted'}`}>{preview}</span>
                    {conversation.unread && (
                      <span data-redes-conversation-unread className="size-1.5 shrink-0 bg-accent">
                        <span className="sr-only">não lida</span>
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <ScrollFade target={listRef} tone="page" />
    </aside>
  )
}

/** A conversa aberta: o cabeçalho (44 px), os balões por dia e a resposta. */
function ConversationPane({ accountId, conversation, messages }: { accountId: string; conversation: RedesConversation; messages: RedesMessage[] }) {
  const listRef = useRef<HTMLOListElement>(null)
  const now = new Date()
  const lastId = messages.at(-1)?.id
  // O anexo é um endereço de terceiros: abre no navegador só depois da confirmação na tela, como os links do email.
  const [ask, setAsk] = useState<string | null>(null)

  // Abre (e recebe mensagem) no fim, como o WhatsApp do app.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [lastId])

  return (
    <section aria-label={`Conversa com ${conversation.participantName}`} data-redes-conversation-open={conversation.id} className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[var(--panel-head-h)] shrink-0 items-center gap-3 border-b border-line px-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-13 font-medium text-title">{conversation.participantName}</span>
          <span className="truncate text-12 text-text-muted">{lastInboundLine(conversation, now)}</span>
        </div>
        <Button variant="secondary" icon={ExternalLink} action="redes-messages-open-instagram" onClick={() => window.__scribeApi.send('scribe:open-link', INSTAGRAM_INBOX_URL)}>
          Abrir no Instagram
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ol ref={listRef} data-redes-bubbles className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 py-4">
          {/* Empurra os balões para baixo quando são poucos (sem o `justify-end`, que corta o topo ao rolar). */}
          <li aria-hidden="true" className="flex-1" />
          {conversation.olderCount > 0 && (
            <li data-redes-messages-older className="self-center text-12 text-text-faint">
              {plural(conversation.olderCount, 'mensagem mais antiga não aparece', 'mensagens mais antigas não aparecem')}: o Instagram só mostra as 20 mais recentes.
            </li>
          )}
          {messages.map((message, index) => {
            const day = dayLabel(message.createdAt, now)
            const previous = messages[index - 1]
            const separator = !previous || dayLabel(previous.createdAt, now) !== day
            return [
              separator && (
                <li key={`dia-${message.id}`} className="mt-1 self-center text-12 text-text-faint">
                  {day}
                </li>
              ),
              <MessageBubble key={message.id} message={message} onLink={setAsk} />,
            ]
          })}
        </ol>
        <ScrollFade target={listRef} tone="page" />
        {ask && (
          <Note
            id="redes-message-link"
            icon={ExternalLink}
            className="mx-6 mb-2"
            action={
              <div className="flex gap-2">
                {/^https:/i.test(ask) && (
                  <Button
                    action="redes-message-open-link"
                    variant="secondary"
                    onClick={() => {
                      window.__scribeApi.send('scribe:open-link', ask)
                      setAsk(null)
                    }}
                  >
                    Abrir
                  </Button>
                )}
                <Button action="redes-message-cancel-link" variant="secondary" onClick={() => setAsk(null)}>
                  {/^https:/i.test(ask) ? 'Cancelar' : 'Fechar'}
                </Button>
              </div>
            }
          >
            {/^https:/i.test(ask) ? `Abrir ${ask} no navegador?` : `O app só abre links seguros (https). Este não abre: ${ask}`}
          </Note>
        )}
      </div>
      <MessageComposer key={conversation.id} accountId={accountId} conversation={conversation} />
    </section>
  )
}

/** Um balão: o texto do contato sempre como texto (é de terceiros), os anexos como link que abre no navegador (com a confirmação). */
function MessageBubble({ message, onLink }: { message: RedesMessage; onLink: (url: string) => void }) {
  const mine = message.fromMe
  return (
    <li data-redes-message={message.id} data-from-me={mine ? 'true' : 'false'} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[420px] min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] px-3 py-2 text-14 leading-[22px] whitespace-pre-wrap select-text ${mine ? 'bg-accent text-on-accent' : 'border border-line bg-bg-raised text-text'}`}>
        <span className="sr-only">{mine ? 'Você' : 'Contato'}: </span>
        {message.text && <span className="break-words">{message.text}</span>}
        {message.attachments.map((attachment, index) => {
          const { icon, label } = ATTACHMENT[attachment.kind]
          const url = attachment.url
          return url ? (
            <button
              key={index}
              type="button"
              data-redes-message-attachment={attachment.kind}
              onClick={() => onLink(url)}
              className={`no-drag inline-flex items-center gap-1.5 self-start text-13 font-medium underline decoration-1 underline-offset-3 ${mine ? 'text-on-accent' : 'text-accent hover:text-title'}`}
            >
              <Icon icon={icon} size={14} />
              {label}
            </button>
          ) : (
            <span key={index} data-redes-message-attachment={attachment.kind} className="inline-flex items-center gap-1.5 text-13 opacity-80">
              <Icon icon={icon} size={14} />
              {label}
            </span>
          )
        })}
        <span className={`self-end text-11 tabular ${mine ? 'text-on-accent opacity-80' : 'text-text-faint'}`}>{clockLabel(Date.parse(message.createdAt))}</span>
      </div>
    </li>
  )
}

/** A resposta: duas linhas, o contador de bytes da Meta, Enter envia e ⇧Enter quebra; fora da janela de 24 h, o aviso. */
function MessageComposer({ accountId, conversation }: { accountId: string; conversation: RedesConversation }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bytes = messageBytes(text.trim())
  const over = bytes > MESSAGE_TEXT_MAX_BYTES
  const outside = outsideMessageWindow(conversation.lastInboundAt, new Date().getTime())
  const inputId = `redes-message-${conversation.id}`

  const send = async (): Promise<void> => {
    if (sending || !text.trim() || over) return
    setSending(true)
    setError(null)
    const result = await useRedes.getState().sendMessage(accountId, conversation.id, text)
    setSending(false)
    if (result.ok) setText('')
    else setError(result.error)
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 px-6 pt-2 pb-5">
      {outside && (
        <div data-redes-window-note>
          <Note id="redes-messages-window" icon={TriangleAlert} role="status">
            Fora da janela de 24 h: o Instagram pode recusar.
          </Note>
        </div>
      )}
      <div className="flex flex-col rounded-[var(--radius-control)] border border-line-strong bg-bg-raised has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus">
        <label htmlFor={inputId} className="sr-only">
          Responder a {conversation.participantName}
        </label>
        <textarea
          id={inputId}
          data-redes-message-input
          value={text}
          rows={2}
          placeholder="Escreva uma resposta"
          onChange={(event) => {
            setText(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={onKey}
          className="no-drag resize-none bg-transparent px-3 pt-2 text-14 leading-[22px] text-text outline-none select-text placeholder:text-text-faint"
        />
        <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
          <span data-redes-message-bytes className={`min-w-0 flex-1 truncate text-12 tabular ${over ? 'font-medium text-rec' : 'text-text-muted'}`}>
            {bytes}/{MESSAGE_TEXT_MAX_BYTES} bytes · ↵ envia, ⇧↵ quebra a linha
          </span>
          <Button icon={Send} action="redes-message-send" data={{ 'data-redes-message-send': '' }} onClick={() => void send()} disabled={sending || !text.trim() || over}>
            {sending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" data-redes-message-error className="text-12 text-rec">
          {error}
        </p>
      )}
    </div>
  )
}
