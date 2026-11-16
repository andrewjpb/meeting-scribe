import { ArrowUp, MessageCircle, Settings, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { CHAT_ERROR_TEXT, CHAT_TEXT_MAX, type ChatMessage } from '@shared/chat'
import { ROUTE_PATHS } from '@shared/routes'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { useChat, viewKey } from './chatStore'
import { ChatMarkdown } from './ChatMarkdown'

interface ChatConversationProps {
  /** Conversa aberta; `null` = nova, criada na primeira pergunta. */
  chatId: string | null
  /** Conversa da aba de uma reunião (só o `.md` dela); `null` na tela "Perguntar". */
  meetingId: string | null
  suggestions: readonly string[]
}

/**
 * Uma conversa (contrato 15, CA3 e CA4): mensagens (a pessoa à direita, o Claude à esquerda), a resposta
 * aparecendo enquanto é escrita, "Parar", o campo (Enter envia, Shift+Enter quebra a linha) e as sugestões
 * quando ela está vazia. Sem o `claude`, só o aviso com o caminho para Configurações. Sair da tela avisa o
 * main, que mata o processo em 5 min se a conversa não voltar.
 */
export function ChatConversation({ chatId, meetingId, suggestions }: ChatConversationProps) {
  const navigate = useNavigate()
  const key = viewKey(chatId, meetingId)
  const claude = useChat((state) => state.claude)
  const chat = useChat((state) => (chatId ? state.chats[chatId] : undefined))
  const answer = useChat((state) => (chatId ? state.answers[chatId] : undefined))
  const pending = useChat((state) => state.sending[key])
  const failure = useChat((state) => state.failures[key])
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    void useChat.getState().checkClaude()
  }, [])

  useEffect(() => {
    if (!chatId) return
    void useChat.getState().open(chatId)
    return () => window.__scribeApi.send('scribe:chat-leave', { id: chatId })
  }, [chatId])

  const messages: ChatMessage[] = chat?.messages ?? []
  const answering = answer !== undefined
  const busy = answering || pending !== undefined

  // Sempre a última mensagem à vista enquanto a resposta cresce.
  useLayoutEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, answer?.text, pending])

  useEffect(() => {
    input.current?.focus()
  }, [chatId])

  const send = (text: string): void => {
    const question = text.trim()
    if (!question || busy || claude === 'not-found') return
    setDraft('')
    void useChat
      .getState()
      .send(chatId, meetingId, question)
      .then((id) => {
        // Nada foi enviado: o texto volta para o campo.
        if (!id) setDraft((current) => current || question)
      })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send(draft)
  }

  if (claude === 'not-found') {
    return (
      <div data-chat-conversation="no-claude" className="flex min-h-0 flex-1 flex-col px-10 pt-7">
        <div className="mx-auto w-full max-w-[680px]">
          <Note
            id="chat-no-claude"
            icon={Settings}
            action={
              <Button action="open-claude-settings" variant="secondary" onClick={() => void navigate(ROUTE_PATHS.configuracoes)}>
                Abrir Configurações
              </Button>
            }
          >
            Configure o Claude CLI em Configurações.
          </Note>
        </div>
      </div>
    )
  }

  const empty = messages.length === 0 && pending === undefined

  return (
    <div data-chat-conversation={chatId ?? 'new'} className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} data-chat-scroll className="min-h-0 flex-1 overflow-y-auto px-10 pb-6">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 pt-7">
          {empty && (
            <div className="flex flex-col items-start gap-4">
              <div className="flex items-center gap-2 text-13 text-text-muted">
                <Icon icon={MessageCircle} className="shrink-0" />
                {meetingId ? 'Pergunte sobre esta reunião.' : 'Pergunte sobre as suas reuniões.'}
              </div>
              <ul className="flex flex-col items-start gap-2" aria-label="Sugestões">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      data-chat-suggestion
                      onClick={() => send(suggestion)}
                      disabled={claude !== 'found'}
                      className="no-drag rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2 text-left text-13 text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!empty && (
            <ol aria-label="Mensagens" aria-live="polite" className="flex flex-col gap-6">
              {messages.map((message, index) => (
                <MessageItem key={`${index}-${message.at}`} message={message} />
              ))}
              {pending !== undefined && <MessageItem message={{ role: 'user', text: pending, at: '' }} />}
              {answer && (
                <li data-chat-message="assistant" data-chat-streaming="" className="flex flex-col gap-2 text-15 text-text">
                  {answer.text ? (
                    <ChatMarkdown text={answer.text} />
                  ) : (
                    <p role="status" className="text-13 text-text-muted">
                      {answer.reading ? 'Lendo as reuniões…' : 'Procurando nas reuniões…'}
                    </p>
                  )}
                </li>
              )}
            </ol>
          )}
          {failure && (
            <p data-chat-failure role="alert" className="text-13 text-rec">
              {failure}
            </p>
          )}
        </div>
      </div>
      <div className="border-t border-line px-10 py-4">
        <div className="mx-auto flex w-full max-w-[680px] items-end gap-2">
          <textarea
            ref={input}
            data-chat-input
            value={draft}
            rows={2}
            maxLength={CHAT_TEXT_MAX}
            placeholder={meetingId ? 'Pergunte sobre esta reunião' : 'Pergunte sobre as reuniões'}
            aria-label="Pergunta"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="no-drag max-h-40 min-h-10 flex-1 resize-none rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2 text-13 text-text"
          />
          {answering && chatId ? (
            <Button action="chat-stop" variant="secondary" icon={Square} onClick={() => void useChat.getState().stop(chatId)}>
              Parar
            </Button>
          ) : (
            <Button action="chat-send" icon={ArrowUp} onClick={() => send(draft)} disabled={busy || !draft.trim() || claude !== 'found'}>
              Enviar
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Uma mensagem: a pessoa num bloco à direita; o Claude à esquerda, em Markdown, com o erro embaixo. */
function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <li data-chat-message="user" className="flex justify-end">
        <p className="max-w-[80%] rounded-[var(--radius-panel)] bg-bg-sunken px-4 py-2.5 text-15 whitespace-pre-line text-text">{message.text}</p>
      </li>
    )
  }
  return (
    <li data-chat-message="assistant" data-chat-error={message.error} className="flex flex-col gap-2 text-15 text-text">
      {message.text && <ChatMarkdown text={message.text} />}
      {message.error && <p className="text-13 text-text-muted">{CHAT_ERROR_TEXT[message.error]}</p>}
    </li>
  )
}
