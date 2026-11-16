import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChatListItem } from '@shared/chat'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { PageHeader } from '../../design/PageHeader'
import { dayLabel, timeLabel } from '../meetings/format'
import { ChatConversation } from './ChatConversation'
import { listKey, useChat } from './chatStore'

/** Sugestões da conversa vazia; a última leva o nome de um participante da agenda, quando há. */
export function chatSuggestions(participant: string | null): string[] {
  return ['O que ficou decidido esta semana?', 'Quais tarefas são minhas?', participant ? `Resuma a última reunião com ${participant}` : 'Resuma a última reunião']
}

/** Primeiro nome de um participante da agenda da reunião mais recente que tem agenda. */
function useLatestParticipant(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.__scribeApi.invoke('scribe:meetings-list').then(
      (meetings) => {
        const attendee = meetings.flatMap((meeting) => meeting.calendar?.attendees ?? []).find((person) => person.name.trim() !== '')
        if (alive) setName(attendee ? (attendee.name.trim().split(/\s+/)[0] ?? null) : null)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  return name
}

/** Fecha a conversa que estava aberta: o processo dela morre (depois da resposta em curso). */
function closeChat(id: string | null): void {
  if (id) window.__scribeApi.send('scribe:chat-close', { id })
}

/**
 * Tela "Perguntar" (contrato 15, CA4): conversas à esquerda (a primeira pergunta e a data, "Nova conversa" e
 * excluir) e a conversa aberta à direita, sobre todas as reuniões.
 */
export function ChatScreen() {
  const key = listKey(null)
  const list = useChat((state) => state.lists[key])
  const selected = useChat((state) => state.selected[key] ?? null)
  const failure = useChat((state) => state.failures[`list:${key}`])
  const participant = useLatestParticipant()

  useEffect(() => {
    void useChat.getState().loadList(null)
  }, [])

  const choose = (id: string | null): void => {
    if (id === selected) return
    closeChat(selected)
    useChat.getState().select(null, id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-7 pb-6">
        <PageHeader title="Perguntar" description="O Claude responde com base nas suas reuniões, lidas neste Mac." />
      </div>
      <div className="flex min-h-0 flex-1 border-t border-line">
        <aside aria-label="Conversas" className="flex w-[260px] shrink-0 flex-col border-r border-line">
          <div className="p-3">
            <Button action="chat-new" variant="secondary" icon={Plus} onClick={() => choose(null)}>
              Nova conversa
            </Button>
          </div>
          {failure && <p className="px-4 pb-2 text-12 text-rec">{failure}</p>}
          <ul data-chat-list className="min-h-0 flex-1 overflow-y-auto pb-3">
            {(list ?? []).map((item) => (
              <ChatRow key={item.id} item={item} active={item.id === selected} onOpen={() => choose(item.id)} />
            ))}
          </ul>
        </aside>
        <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
          <ChatConversation key={selected ?? 'new'} chatId={selected} meetingId={null} suggestions={chatSuggestions(participant)} />
        </section>
      </div>
    </div>
  )
}

/** Linha da lista: título e data; a lixeira pede confirmação na própria linha. */
function ChatRow({ item, active, onOpen }: { item: ChatListItem; active: boolean; onOpen: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const date = new Date(item.updatedAt)

  if (confirming) {
    return (
      <li data-chat-item={item.id} className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <p className="text-13 text-text">Excluir esta conversa?</p>
        <div className="flex gap-2">
          <Button action="confirm-delete-chat" variant="danger" onClick={() => void useChat.getState().remove(item.id, item.meetingId)}>
            Excluir
          </Button>
          <Button action="cancel-delete-chat" variant="secondary" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      </li>
    )
  }
  return (
    <li data-chat-item={item.id} className={`group flex items-center border-b border-line ${active ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}>
      <button type="button" aria-current={active ? 'true' : undefined} onClick={onOpen} className="no-drag flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left focus-visible:outline-offset-[-2px]">
        <span className="truncate text-13 font-medium text-title">{item.title}</span>
        <span className="text-12 text-text-muted tabular">
          {dayLabel(date, new Date())} · {timeLabel(date)}
        </span>
      </button>
      <button
        type="button"
        data-action="delete-chat"
        aria-label="Excluir conversa"
        onClick={() => setConfirming(true)}
        className="no-drag mr-2 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-rec"
      >
        <Icon icon={Trash2} />
      </button>
    </li>
  )
}
