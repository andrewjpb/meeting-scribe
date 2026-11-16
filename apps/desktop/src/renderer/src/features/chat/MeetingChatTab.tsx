import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../../design/Button'
import { Select } from '../../design/Field'
import { dayLabel, timeLabel } from '../meetings/format'
import { ChatConversation } from './ChatConversation'
import { listKey, useChat } from './chatStore'

const SUGGESTIONS = ['O que ficou decidido?', 'Quais tarefas são minhas?', 'Resuma esta reunião em três frases.']

/**
 * Aba "Perguntar" do detalhe (contrato 15, CA5): a mesma conversa da tela "Perguntar", limitada a esta
 * reunião (o `claude` roda numa pasta só com o `.md` dela) e sem a lista lateral. Abre na conversa mais
 * recente da reunião; "Nova conversa" começa outra, e as anteriores ficam no seletor.
 */
export function MeetingChatTab({ meetingId }: { meetingId: string }) {
  const key = listKey(meetingId)
  const list = useChat((state) => state.lists[key])
  const chosen = useChat((state) => state.selected[key])
  // Até a pessoa escolher, vale a conversa mais recente da reunião.
  const selected = chosen === undefined ? (list?.[0]?.id ?? null) : chosen

  useEffect(() => {
    void useChat.getState().loadList(meetingId)
  }, [meetingId])

  const choose = (id: string | null): void => {
    if (id === selected) return
    if (selected) window.__scribeApi.send('scribe:chat-close', { id: selected })
    useChat.getState().select(meetingId, id)
  }

  if (list === undefined) return <div className="flex-1" aria-busy="true" />

  const options = [
    ...(selected === null ? [{ value: '', label: 'Nova conversa' }] : []),
    ...list.map((item) => {
      const date = new Date(item.updatedAt)
      return { value: item.id, label: `${item.title} · ${dayLabel(date, new Date())} ${timeLabel(date)}` }
    }),
  ]

  return (
    <div data-meeting-chat={meetingId} className="flex min-h-0 flex-1 flex-col">
      <div className="px-10 pt-5">
        <div className="mx-auto flex w-full max-w-[680px] flex-wrap items-center gap-2">
          <Button action="chat-new" variant="secondary" icon={Plus} onClick={() => choose(null)}>
            Nova conversa
          </Button>
          {list.length > 0 && (
            <div className="min-w-0 flex-1">
              <label htmlFor="meeting-chat-select" className="sr-only">
                Conversas desta reunião
              </label>
              <Select id="meeting-chat-select" value={selected ?? ''} options={options} onChange={(value) => choose(value || null)} />
            </div>
          )}
        </div>
      </div>
      <ChatConversation key={selected ?? 'new'} chatId={selected} meetingId={meetingId} suggestions={SUGGESTIONS} />
    </div>
  )
}
