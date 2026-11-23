// Histórico do atendimento (contrato 142): o que os agentes fizeram em cada conversa, do mais recente para o mais
// antigo, com o filtro por conversa. Nenhum texto de mensagem: só quando, onde, quem, o que e o motivo.
import { Ban, Gauge, Moon, Pause, Send, SendHorizontal, Sparkles, TriangleAlert, UserRound, X, type LucideIcon } from 'lucide-react'
import type { AtendimentoLogAction } from '@shared/atendimento'
import { Select } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { useWhatsApp } from '../whatsapp/whatsappStore'
import { useAtendimento } from './atendimentoStore'
import { chatLabel, logActionLabel, logDetail, logWhen } from './format'

const ACTION_ICONS: Readonly<Record<AtendimentoLogAction, LucideIcon>> = {
  sent: Send,
  drafted: Sparkles,
  'draft-sent': SendHorizontal,
  'draft-discarded': X,
  'handed-off': UserRound,
  paused: Pause,
  cancelled: Ban,
  'rate-limited': Gauge,
  'out-of-hours': Moon,
  failed: TriangleAlert,
}

export function AtendimentoLog() {
  const log = useAtendimento((state) => state.log)
  const logChatId = useAtendimento((state) => state.logChatId)
  const agents = useAtendimento((state) => state.state?.agents)
  const bindings = useAtendimento((state) => state.state?.bindings)
  const chats = useWhatsApp((state) => state.chats) ?? []

  // Uma opção por conversa com atendimento ou com linha no histórico (e a filtrada, mesmo sem nenhuma das duas).
  const chatIds = [...new Set([...(bindings ?? []).map((binding) => binding.chatId), ...log.map((entry) => entry.chatId), ...(logChatId ? [logChatId] : [])])]
  const options = [{ value: '', label: 'Todas as conversas' }, ...chatIds.map((chatId) => ({ value: chatId, label: chatLabel(chatId, chats) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))]
  const agentName = new Map((agents ?? []).map((agent) => [agent.id, agent.name]))
  const now = new Date()

  return (
    <section aria-label="Histórico" data-atendimento-log className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-14 leading-5 font-semibold text-title">Histórico</h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-12 text-text-muted">Só o que aconteceu, sem o texto das mensagens</p>
          <Select id="atendimento-log-filter" value={logChatId ?? ''} options={options} onChange={(value) => void useAtendimento.getState().setLogChatId(value || null)} />
        </div>
      </div>
      {log.length === 0 ? (
        <p data-atendimento-log-empty className="text-13 text-text-muted">
          Nada aconteceu ainda.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="label border-b border-line-strong">
              <th className="py-1.5 pr-4 font-medium">Quando</th>
              <th className="py-1.5 pr-4 font-medium">Conversa</th>
              <th className="py-1.5 pr-4 font-medium">Agente</th>
              <th className="py-1.5 pr-4 font-medium">O que fez</th>
              <th className="py-1.5 font-medium">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {log.map((entry, index) => (
              <tr key={`${entry.at}-${entry.chatId}-${entry.action}-${index}`} data-atendimento-log-row={entry.action} data-atendimento-log-chat={entry.chatId} className="border-b border-line text-13">
                <td className="py-1.5 pr-4 whitespace-nowrap text-text-muted tabular">{logWhen(entry.at, now)}</td>
                <td className="py-1.5 pr-4 text-text">{chatLabel(entry.chatId, chats)}</td>
                <td className="py-1.5 pr-4 text-text-muted">{agentName.get(entry.agentId) ?? 'Agente excluído'}</td>
                <td className={`py-1.5 pr-4 font-medium ${entry.action === 'handed-off' ? 'text-accent' : entry.action === 'failed' ? 'text-rec' : 'text-title'}`}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Icon icon={ACTION_ICONS[entry.action]} className="shrink-0 text-text-muted" />
                    {logActionLabel(entry.action)}
                  </span>
                </td>
                <td className="py-1.5 text-text-muted">{logDetail(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
