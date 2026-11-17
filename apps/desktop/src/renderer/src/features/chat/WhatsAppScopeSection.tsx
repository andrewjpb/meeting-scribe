import { Users } from 'lucide-react'
import { useEffect } from 'react'
import type { ChatScope } from '@shared/chat'
import { WHATSAPP_DEFAULT_SCOPE_DAYS, WHATSAPP_SCOPE_CHATS_MAX, WHATSAPP_SCOPE_DAYS } from '@shared/whatsapp'
import { Icon } from '../../design/Icon'
import { useWhatsApp } from '../whatsapp/whatsappStore'

/**
 * "Só estas conversas" no painel "Contexto" (contrato 24, CA5; no 25, a escolha manual dentro da fonte WhatsApp): até
 * 10 conversas, dos últimos 7, 30 ou 90 dias. O app exporta as mensagens para a pasta da conversa e o Claude lê como
 * lê as reuniões, citando "[WhatsApp · <conversa> · dd/mm hh:mm]".
 */
export function WhatsAppScopeSection({ scope, onScope }: { scope: ChatScope; onScope: (scope: ChatScope) => void }) {
  const connected = useWhatsApp((state) => state.status?.state === 'connected')
  const chats = useWhatsApp((state) => state.chats)
  const chosen = scope.whatsappChats ?? []
  const days = scope.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS

  useEffect(() => {
    if (connected) void useWhatsApp.getState().loadChats()
  }, [connected])

  const full = chosen.length >= WHATSAPP_SCOPE_CHATS_MAX
  // "Só estas conversas" sem nenhuma marcada continua no modo (nada do WhatsApp entra até marcar).
  const set = (ids: string[], nextDays = days): void => {
    const { whatsappChats: _chats, whatsappDays: _days, whatsappMode: _mode, ...rest } = scope
    onScope(ids.length ? { ...rest, whatsappChats: ids, whatsappDays: nextDays } : { ...rest, whatsappMode: 'chosen', whatsappDays: nextDays })
  }
  const toggle = (id: string): void => set(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id])

  return (
    <div aria-label="Só estas conversas" data-chat-whatsapp className="flex flex-col gap-2 pl-6">
      <div className="flex items-center gap-2">
        <label htmlFor="chat-whatsapp-days" className="text-12 text-text-muted">
          Mensagens dos últimos
        </label>
        <select
          id="chat-whatsapp-days"
          data-chat-whatsapp-days
          value={days}
          onChange={(event) => set(chosen, Number(event.target.value))}
          className="no-drag h-8 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-12 text-text"
        >
          {WHATSAPP_SCOPE_DAYS.map((value) => (
            <option key={value} value={value}>
              {value} dias
            </option>
          ))}
        </select>
      </div>
      <p className="text-12 text-text-faint tabular" aria-live="polite">
        {chosen.length} de {WHATSAPP_SCOPE_CHATS_MAX} escolhidas · até 2 000 mensagens
      </p>
      {!connected && <p className="text-12 text-text-muted">O WhatsApp não está conectado: as conversas escolhidas ficam de fora até ele voltar.</p>}
      <ul className="flex max-h-[200px] flex-col overflow-y-auto">
        {(chats ?? []).map((chat) => {
          const checked = chosen.includes(chat.id)
          return (
            <li key={chat.id}>
              <label className="flex cursor-default items-center gap-2 rounded-[var(--radius-control)] px-1 py-1 hover:bg-bg-sunken">
                <input
                  type="checkbox"
                  data-scope-whatsapp={chat.id}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(chat.id)}
                  className="no-drag size-4 shrink-0 accent-accent"
                />
                {chat.kind === 'group' && <Icon icon={Users} size={14} className="shrink-0 text-text-muted" />}
                <span className="truncate text-13 text-text">{chat.name}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
