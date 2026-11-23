// Textos da aba "Atendimento" das Automações (contrato 142): o que cada linha do histórico diz, quando aconteceu, em
// quantas conversas um agente atua, o nome da cópia de um agente e o rótulo de uma conversa. Tudo puro, testado em
// `test/renderer/atendimento-format.test.ts`.
import { ATENDIMENTO_NAME_MAX, type AtendimentoBinding, type AtendimentoLogAction, type AtendimentoLogEntry, type AtendimentoModel } from '@shared/atendimento'
import type { WhatsAppChat } from '@shared/whatsapp'

export const ATENDIMENTO_MODEL_LABELS: Readonly<Record<AtendimentoModel, string>> = { haiku: 'Haiku', sonnet: 'Sonnet' }

const ACTION_LABELS: Readonly<Record<AtendimentoLogAction, string>> = {
  sent: 'Respondeu',
  drafted: 'Propôs',
  'draft-sent': 'Você enviou a proposta',
  'draft-discarded': 'Você descartou a proposta',
  'handed-off': 'Passou para você',
  paused: 'Pausou',
  cancelled: 'Cancelou a resposta',
  'rate-limited': 'Limite atingido',
  'out-of-hours': 'Fora do horário',
  failed: 'Não conseguiu responder',
}

/** "O que fez" de uma linha do histórico. */
export const logActionLabel = (action: AtendimentoLogAction): string => ACTION_LABELS[action]

/** "Detalhe": o motivo gravado, ou nada. O id da mensagem nunca aparece. */
export const logDetail = (entry: AtendimentoLogEntry): string => entry.reason ?? ''

const pad = (value: number): string => String(value).padStart(2, '0')
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** "Hoje, 14:51", "Ontem, 23:10" ou "20/11, 09:02", no fuso local. */
export function logWhen(iso: string, now: Date): string {
  const date = new Date(iso)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  // Arredonda: a troca de horário de verão deixa o dia com 23 ou 25 horas.
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return `Hoje, ${time}`
  if (days === 1) return `Ontem, ${time}`
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${time}`
}

/** "Nenhuma conversa", "1 conversa · Responder sozinho", "2 conversas · Rascunho", "3 conversas · Rascunho e sozinho". Só os ligados contam. */
export function agentUsage(agentId: string, bindings: readonly Pick<AtendimentoBinding, 'agentId' | 'enabled' | 'mode'>[]): string {
  const used = bindings.filter((binding) => binding.agentId === agentId && binding.enabled)
  if (used.length === 0) return 'Nenhuma conversa'
  const count = used.length === 1 ? '1 conversa' : `${used.length} conversas`
  const auto = used.some((binding) => binding.mode === 'auto')
  const draft = used.some((binding) => binding.mode === 'draft')
  return `${count} · ${auto && draft ? 'Rascunho e sozinho' : auto ? 'Responder sozinho' : 'Rascunho'}`
}

/** "Recados (cópia)", "Recados (cópia 2)"…, sem repetir nome (sem diferenciar maiúsculas) e até 60 caracteres. */
export function duplicateName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((item) => item.toLocaleLowerCase('pt-BR')))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (cópia)' : ` (cópia ${n})`
    const candidate = `${name.slice(0, ATENDIMENTO_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate.toLocaleLowerCase('pt-BR'))) return candidate
  }
}

/** O nome da conversa na lista do WhatsApp; fora dela, o número (o id sem o "@…"). */
export function chatLabel(chatId: string, chats: readonly Pick<WhatsAppChat, 'id' | 'name'>[]): string {
  const name = chats.find((chat) => chat.id === chatId)?.name.trim()
  return name || (chatId.split('@')[0] ?? chatId)
}
