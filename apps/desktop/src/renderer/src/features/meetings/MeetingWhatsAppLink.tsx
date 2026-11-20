import { Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WhatsAppMeetingLink } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Switch } from '../../design/Switch'
import { useWhatsApp } from '../whatsapp/whatsappStore'

/**
 * "Ligar conversa do WhatsApp" no detalhe da reunião (contrato 24, CA5): uma conversa (o grupo do projeto, por
 * exemplo) fica associada à reunião, e o resumo e a análise podem usar as mensagens do dia como material. A opção
 * começa desligada. Só aparece com o WhatsApp conectado ou com uma conversa já ligada.
 */
export function MeetingWhatsAppLink({ meetingId }: { meetingId: string }) {
  const connected = useWhatsApp((state) => state.status?.state === 'connected')
  const chats = useWhatsApp((state) => state.chats)
  const [link, setLink] = useState<WhatsAppMeetingLink | null | undefined>(undefined)
  const [choosing, setChoosing] = useState(false)
  const [choice, setChoice] = useState('')

  useEffect(() => {
    let alive = true
    void window.__scribeApi.invoke('scribe:whatsapp-link-get', { meetingId }).then(
      (found) => {
        if (alive) setLink(found)
      },
      () => {
        if (alive) setLink(null)
      },
    )
    return () => {
      alive = false
    }
  }, [meetingId])

  useEffect(() => {
    if (connected && choosing) void useWhatsApp.getState().loadChats()
  }, [connected, choosing])

  const save = (next: WhatsAppMeetingLink | null): void => {
    void window.__scribeApi.invoke('scribe:whatsapp-link-set', { meetingId, link: next }).then(
      (saved) => setLink(saved),
      () => undefined,
    )
  }

  if (link === undefined || (!connected && !link)) return null
  const switchId = `whatsapp-link-summary-${meetingId}`

  return (
    <div data-whatsapp-link={link?.chatId ?? ''} className="mx-8 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-2.5 text-13">
      <Icon icon={Smartphone} className="shrink-0 text-text-muted" />
      {link ? (
        <>
          <span className="min-w-0 truncate text-text">
            Conversa do WhatsApp: <span data-whatsapp-link-name className="font-medium">{link.chatName}</span>
          </span>
          <span className="flex items-center gap-2">
            <span id={switchId} className="text-12 text-text-muted">
              Usar as mensagens do dia no resumo e na análise
            </span>
            <Switch checked={link.useInSummary} labelledBy={switchId} onChange={(useInSummary) => save({ ...link, useInSummary })} />
          </span>
          <Button action="whatsapp-unlink" variant="secondary" onClick={() => save(null)}>
            Desligar a conversa
          </Button>
        </>
      ) : choosing ? (
        <>
          <label htmlFor={`whatsapp-link-${meetingId}`} className="text-12 text-text-muted">
            Conversa
          </label>
          <select
            id={`whatsapp-link-${meetingId}`}
            data-whatsapp-link-select
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="no-drag h-8 min-w-0 flex-[0_1_280px] rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-12 text-text"
          >
            <option value="">Escolha uma conversa</option>
            {(chats ?? []).map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.name}
                {chat.kind === 'group' ? ' (grupo)' : ''}
              </option>
            ))}
          </select>
          <Button
            action="whatsapp-link-save"
            disabled={!choice}
            onClick={() => {
              const chat = chats?.find((item) => item.id === choice)
              if (!chat) return
              setChoosing(false)
              save({ chatId: chat.id, chatName: chat.name, useInSummary: false })
            }}
          >
            Ligar
          </Button>
          <Button action="whatsapp-link-cancel" variant="secondary" onClick={() => setChoosing(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <Button action="whatsapp-link" variant="secondary" onClick={() => setChoosing(true)}>
          Ligar conversa do WhatsApp
        </Button>
      )}
    </div>
  )
}
