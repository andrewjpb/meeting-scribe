import { ArrowDown, ArrowUp, Brain, MessageCircle, PanelRight, Settings, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { CHAT_COUNTER_FROM, CHAT_TEXT_MAX, CHAT_TITLE_MAX, DEFAULT_CHAT_SCOPE, type ChatMessage, type ChatScope, type ChatScopeKind } from '@shared/chat'
import { ROUTE_PATHS } from '@shared/routes'
import type { ChatModel } from '@shared/settings-defaults'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { AssistantMessage, LiveAssistantMessage, UserMessage } from './ChatMessages'
import { draftOf, listKey, useChat, viewKey } from './chatStore'
import { ContextPanel, MODEL_OPTIONS } from './ContextPanel'
import { chatSuggestionGroups, chosenMeetings, modelLabel, scopeLabel } from './format'
import type { ChatMeetings } from './useChatMeetings'

interface ChatConversationProps {
  /** Conversa aberta; `null` = nova, criada na primeira pergunta. */
  chatId: string | null
  /** Conversa da aba de uma reunião (só o `.md` dela); `null` na tela "Perguntar". */
  meetingId: string | null
  meetings: ChatMeetings
  /** Painel "Contexto" aberto (o estado fica com a tela, que encolhe a lista quando falta largura). */
  contextOpen: boolean
  onContextOpen: (open: boolean) => void
}

/** Até 8 linhas de 20 px, mais o respiro do campo. */
const INPUT_MAX_HEIGHT = 8 * 20 + 16
const COUNT = new Intl.NumberFormat('pt-BR')
/** Cliques seguidos no escopo viram uma gravação só. */
const SCOPE_DELAY_MS = 300

const LABEL_BUTTON =
  'no-drag inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong px-2 text-12 font-medium text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken'
const BAR_SELECT =
  'no-drag h-7 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-1.5 text-12 text-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken'

/**
 * Uma conversa (contratos 15 e 16): cabeçalho com o título editável, o escopo e o modelo; mensagens com a
 * pessoa à direita e o Claude à esquerda (raciocínio e passos, a resposta, o rodapé com os detalhes e as
 * ações); o campo que cresce até 8 linhas com o modelo e o escopo na própria barra; o painel "Contexto".
 * Sem o `claude`, só o aviso com o caminho para Configurações. Sair da tela avisa o main, que mata o processo
 * em 5 min se a conversa não voltar.
 */
export function ChatConversation({ chatId, meetingId, meetings, contextOpen, onContextOpen }: ChatConversationProps) {
  const navigate = useNavigate()
  const key = viewKey(chatId, meetingId)
  const claude = useChat((state) => state.claude)
  const chat = useChat((state) => (chatId ? state.chats[chatId] : undefined))
  const answer = useChat((state) => (chatId ? state.answers[chatId] : undefined))
  const pending = useChat((state) => state.sending[key])
  const failure = useChat((state) => state.failures[key])
  const redoing = useChat((state) => (chatId ? state.redoing[chatId] === true : false))
  // O rascunho guardado (ou `undefined`): um objeto novo a cada leitura faria o seletor nunca estabilizar.
  const savedDraft = useChat((state) => state.drafts[listKey(meetingId)])
  const draft = draftOf({ drafts: savedDraft ? { [listKey(meetingId)]: savedDraft } : {} }, meetingId)
  const defaultModel = useChat((state) => state.defaultModel)
  const [text, setText] = useState('')
  /** ↑ no campo vazio: a última pergunta volta ao campo e o envio a troca. */
  const [editing, setEditing] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const atBottom = useRef(true)
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
  // Escopo trocado na tela e ainda não gravado (cliques seguidos viram um `update` só): ele vale na tela.
  const [pendingScope, setPendingScope] = useState<ChatScope | null>(null)
  const [scopeNotice, setScopeNotice] = useState<string | null>(null)
  const scopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scope: ChatScope = pendingScope ?? (chat ? chat.scope : meetingId ? DEFAULT_CHAT_SCOPE : draft.scope)
  const exists = meetings.list ? (id: string): boolean => meetings.byId.has(id) : null
  /** "Reuniões escolhidas" sem nenhuma (que ainda exista): nada é enviado. */
  const noneChosen = !meetingId && scope.kind === 'meetings' && chosenMeetings(scope, exists).length === 0
  const model: ChatModel = chat?.model ?? draft.model ?? defaultModel
  // "Pensar mais" (contrato 17, CA5): só pelo agente do ACP, que expõe o esforço como opção da sessão.
  const thinkMore = chat ? chat.thinkMore : draft.thinkMore
  const viaAgent = useSettings((state) => state.settings.claudeTransport) === 'acp'
  const lastUser = messages.findLastIndex((message) => message.role === 'user')
  const lastAssistant = messages.findLastIndex((message) => message.role === 'assistant')

  // A última mensagem à vista enquanto a resposta cresce, a não ser que a pessoa tenha subido: aí aparece
  // "Ir para o fim".
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    if (atBottom.current) node.scrollTop = node.scrollHeight
    else setShowJump(true)
  }, [messages.length, answer?.text, answer?.steps.length, answer?.thinking, pending])

  const onScroll = (): void => {
    const node = scroller.current
    if (!node) return
    atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32
    if (atBottom.current) setShowJump(false)
  }

  const jumpToEnd = (): void => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
    atBottom.current = true
    setShowJump(false)
  }

  useEffect(() => {
    input.current?.focus()
  }, [chatId])

  // Saindo da conversa com uma troca esperando os 300 ms: ela vai agora.
  const latestScope = useRef<{ chatId: string | null; scope: ChatScope | null }>({ chatId, scope: null })
  useEffect(() => {
    latestScope.current = { chatId, scope: scopeTimer.current ? pendingScope : null }
  })
  useEffect(
    () => () => {
      if (!scopeTimer.current) return
      clearTimeout(scopeTimer.current)
      const { chatId: id, scope: last } = latestScope.current
      if (id && last) void useChat.getState().update(id, { scope: last })
    },
    [],
  )

  // O campo cresce com o texto até 8 linhas; depois rola.
  useLayoutEffect(() => {
    const node = input.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, INPUT_MAX_HEIGHT)}px`
  }, [text])

  const send = (value: string): void => {
    const question = value.trim()
    if (!question || busy || claude === 'not-found' || noneChosen) return
    setText('')
    atBottom.current = true
    if (editing && chatId) {
      setEditing(false)
      void useChat
        .getState()
        .redo(chatId, question)
        .then((ok) => {
          if (!ok) setText((current) => current || question)
        })
      return
    }
    setEditing(false)
    void useChat
      .getState()
      .send(chatId, meetingId, question)
      .then((id) => {
        // Nada foi enviado: o texto volta para o campo.
        if (!id) setText((current) => current || question)
      })
  }

  const redo = (): void => {
    if (!chatId || busy) return
    atBottom.current = true
    void useChat.getState().redo(chatId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    // ↵ e ⌘↵ enviam; ⇧↵ quebra a linha.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(text)
      return
    }
    if (event.key === 'ArrowUp' && text === '' && !busy && chatId && lastUser !== -1) {
      event.preventDefault()
      setText(messages[lastUser]?.text ?? '')
      setEditing(true)
      return
    }
    if (event.key === 'Escape' && editing) {
      event.preventDefault()
      setEditing(false)
      setText('')
    }
  }

  /** Grava o escopo pendente; recusado (a pergunta ainda está saindo), fica na tela com o aviso. */
  const flushScope = (next: ChatScope): void => {
    if (!chatId) return
    void useChat
      .getState()
      .update(chatId, { scope: next })
      .then((ok) => {
        if (ok) {
          setPendingScope((current) => (current === next ? null : current))
          setScopeNotice(null)
        } else setScopeNotice('Espere a pergunta começar para mudar o escopo.')
      })
  }
  const changeScope = (next: ChatScope): void => {
    if (!chatId) {
      useChat.getState().setDraft(meetingId, { scope: next })
      return
    }
    // Otimista na tela; o main recebe a lista final 300 ms depois do último clique.
    setPendingScope(next)
    if (scopeTimer.current) clearTimeout(scopeTimer.current)
    scopeTimer.current = setTimeout(() => {
      scopeTimer.current = null
      flushScope(next)
    }, SCOPE_DELAY_MS)
  }
  // Escopo recusado enquanto a pergunta saía: tenta de novo quando ela já foi (a resposta começou ou acabou).
  useEffect(() => {
    if (!scopeNotice || !pendingScope || pending !== undefined || scopeTimer.current) return
    flushScope(pendingScope)
    // Só quando o envio termina; `flushScope` muda a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, scopeNotice, pendingScope])

  const changeModel = (next: ChatModel): void => {
    if (chatId) void useChat.getState().update(chatId, { model: next })
    else useChat.getState().setDraft(meetingId, { model: next })
  }
  const toggleThinkMore = (): void => {
    if (chatId) void useChat.getState().update(chatId, { thinkMore: !thinkMore })
    else useChat.getState().setDraft(meetingId, { thinkMore: !thinkMore })
  }
  const pickScope = (kind: ChatScopeKind): void => {
    changeScope(kind === 'meetings' ? { kind, meetingIds: scope.meetingIds ?? [] } : { kind })
    // "Reuniões escolhidas" se escolhe no painel.
    if (kind === 'meetings') onContextOpen(true)
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
  const total = meetings.list?.length ?? null
  const groups = chatSuggestionGroups(meetings.participant, meetings.topic, meetingId !== null)

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div data-chat-conversation={chatId ?? 'new'} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header data-chat-header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <div className="min-w-0 flex-1">
            {chat ? (
              <EditableTitle value={chat.title} maxLength={CHAT_TITLE_MAX} label="Título da conversa" onCommit={(title) => void useChat.getState().update(chat.id, { title })} />
            ) : (
              <h2 className="truncate text-20 font-bold tracking-[-0.3px] text-title">Nova conversa</h2>
            )}
          </div>
          {meetingId ? (
            <span data-chat-scope-label className="shrink-0 text-12 text-text-muted">
              Só esta reunião
            </span>
          ) : (
            <button type="button" data-action="chat-scope-label" title="Escopo da conversa" onClick={() => onContextOpen(true)} className={LABEL_BUTTON}>
              <span className="truncate">{scopeLabel(scope, total, exists)}</span>
            </button>
          )}
          <button type="button" data-action="chat-model-label" title="Modelo da conversa" onClick={() => onContextOpen(true)} className={LABEL_BUTTON}>
            {modelLabel(model)}
          </button>
          <button
            type="button"
            data-action="toggle-context"
            aria-pressed={contextOpen}
            onClick={() => onContextOpen(!contextOpen)}
            className={`${LABEL_BUTTON} ${contextOpen ? 'bg-bg-sunken' : ''}`}
          >
            <Icon icon={PanelRight} size={14} />
            Contexto
          </button>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scroller} data-chat-scroll onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pt-6">
              {empty && (
                <div data-chat-empty className="flex flex-col gap-5">
                  <div className="flex items-center gap-2 text-13 text-text-muted">
                    <Icon icon={MessageCircle} className="shrink-0" />
                    {meetingId ? 'Pergunte sobre esta reunião.' : 'Pergunte sobre as suas reuniões.'}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-5" aria-label="Sugestões">
                    {groups.map((group) => (
                      <section key={group.title} aria-label={group.title} className="col-span-2 flex flex-col gap-2">
                        <h3 className="text-12 font-bold text-text-muted">{group.title}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {group.items.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              data-chat-suggestion
                              onClick={() => send(suggestion)}
                              disabled={claude !== 'found' || noneChosen}
                              className="no-drag min-h-16 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised px-4 py-3 text-left text-13 text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:opacity-50"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}
              {!empty && (
                <ol aria-label="Mensagens" aria-live="polite" className="flex flex-col gap-6">
                  {messages.map((message, index) => {
                    // Refazendo: a resposta antiga e a pergunta que vai de novo saem da tela até voltar.
                    if (redoing && index >= lastUser) return null
                    return message.role === 'user' ? (
                      <UserMessage key={`${index}-${message.at}`} text={message.text} editing={editing && index === lastUser} />
                    ) : (
                      <AssistantMessage
                        key={`${index}-${message.at}`}
                        message={message}
                        meetings={meetings}
                        onCopy={() => (chatId ? useChat.getState().copy(chatId, index) : Promise.resolve(false))}
                        onRedo={index === lastAssistant && lastAssistant > lastUser && !busy ? redo : null}
                      />
                    )
                  })}
                  {pending !== undefined && <UserMessage text={pending || (messages[lastUser]?.text ?? '')} />}
                  {answer && <LiveAssistantMessage answer={answer} />}
                </ol>
              )}
              {failure && (
                <p data-chat-failure role="alert" className="text-13 text-rec">
                  {failure}
                </p>
              )}
            </div>
          </div>
          {showJump && (
            <button
              type="button"
              data-action="chat-jump-end"
              onClick={jumpToEnd}
              className="no-drag absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 text-12 font-medium text-title hover:bg-bg-sunken"
            >
              <Icon icon={ArrowDown} size={14} />
              Ir para o fim
            </button>
          )}
        </div>
        <div className="shrink-0 border-t border-line px-8 py-4">
          <div className="mx-auto flex w-full max-w-[720px] flex-col rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus">
            {noneChosen && (
              <p data-chat-scope-empty role="status" className="px-3 pt-2 text-12 text-rec">
                Escolha ao menos uma reunião
              </p>
            )}
            {editing && (
              <p data-chat-editing className="px-3 pt-2 text-12 text-text-muted">
                Editando a última pergunta · Esc cancela
              </p>
            )}
            <textarea
              ref={input}
              data-chat-input
              value={text}
              rows={2}
              maxLength={CHAT_TEXT_MAX}
              placeholder={meetingId ? 'Pergunte sobre esta reunião' : 'Pergunte sobre as reuniões'}
              aria-label="Pergunta"
              aria-keyshortcuts="Enter Meta+Enter"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="no-drag min-h-14 resize-none bg-transparent px-3 pt-2.5 pb-1 text-15 text-text select-text placeholder:text-text-faint focus-visible:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
              <label className="sr-only" htmlFor={`chat-model-${key}`}>
                Modelo
              </label>
              <select id={`chat-model-${key}`} data-chat-model-select value={model} onChange={(event) => changeModel(event.target.value as ChatModel)} className={BAR_SELECT}>
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {viaAgent && (
                <button
                  type="button"
                  data-action="chat-think-more"
                  aria-pressed={thinkMore}
                  title="Esforço alto: o Claude pensa mais antes de responder (mais lento)."
                  onClick={toggleThinkMore}
                  className={`${BAR_SELECT} inline-flex items-center gap-1.5 ${thinkMore ? 'border-title bg-title font-medium text-bg hover:bg-title' : ''}`}
                >
                  <Icon icon={Brain} size={14} />
                  Pensar mais
                </button>
              )}
              {!meetingId && (
                <>
                  <label className="sr-only" htmlFor={`chat-scope-${key}`}>
                    Escopo
                  </label>
                  <select id={`chat-scope-${key}`} data-chat-scope-select value={scope.kind} onChange={(event) => pickScope(event.target.value as ChatScopeKind)} className={BAR_SELECT}>
                    <option value="all">{scopeLabel({ kind: 'all' }, total)}</option>
                    <option value="7d">Últimos 7 dias</option>
                    <option value="30d">Últimos 30 dias</option>
                    <option value="meetings">Reuniões escolhidas</option>
                  </select>
                </>
              )}
              <span className="flex-1" />
              {text.length > CHAT_COUNTER_FROM && (
                <span data-chat-counter className={`text-12 tabular ${text.length >= CHAT_TEXT_MAX ? 'text-rec' : 'text-text-faint'}`}>
                  {COUNT.format(text.length)} / {COUNT.format(CHAT_TEXT_MAX)}
                </span>
              )}
              <span className="text-12 text-text-faint">↵ envia · ⇧↵ quebra linha</span>
              {answering && chatId ? (
                <Button action="chat-stop" variant="secondary" icon={Square} onClick={() => void useChat.getState().stop(chatId)}>
                  Parar
                </Button>
              ) : (
                <Button action="chat-send" icon={ArrowUp} onClick={() => send(text)} disabled={busy || !text.trim() || claude !== 'found' || noneChosen}>
                  Enviar
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {contextOpen && (
        <ContextPanel
          meetingId={meetingId}
          scope={scope}
          model={model}
          messages={messages}
          meetings={meetings}
          onScope={changeScope}
          notice={scopeNotice}
          onModel={changeModel}
          onClose={() => onContextOpen(false)}
        />
      )}
    </div>
  )
}
