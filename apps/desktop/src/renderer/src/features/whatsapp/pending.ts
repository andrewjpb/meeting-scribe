// Contrato 36: o balão otimista do envio com "Corrigir ao enviar" ligado. No clique, um balão temporário entra na
// conversa com o texto digitado enquanto a IA corrige; ele sai quando a mensagem real (o eco do serviço, com o mesmo
// `id` que o envio devolveu) chega, em qualquer ordem. Funções puras: o store só guarda o resultado.
import type { WhatsAppMessage } from '@shared/whatsapp'

/** Sem o eco 10 s depois do envio aceito, o temporário para de brilhar e passa a dizer "Enviada". */
export const PENDING_ECHO_WAIT_MS = 10_000

export interface PendingSend {
  /** Chave local do temporário (o `id` do WhatsApp só chega quando o envio é aceito). */
  key: string
  chatId: string
  /** O texto como foi digitado (nunca o corrigido: esse só aparece pelo eco). */
  text: string
  /** Hora do clique, para ordenar com as outras mensagens. */
  at: number
  /** `id` da mensagem no WhatsApp, depois que o envio foi aceito. */
  id: string | null
  /** `correcting`: a IA está ajustando; `sent`: aceito, mas o eco demorou mais de 10 s. */
  phase: 'correcting' | 'sent'
}

/** Temporários por conversa. */
export type PendingByChat = Record<string, PendingSend[]>

function withChat(pending: PendingByChat, chatId: string, list: PendingSend[]): PendingByChat {
  if (list.length) return { ...pending, [chatId]: list }
  return Object.fromEntries(Object.entries(pending).filter(([id]) => id !== chatId))
}

/** O clique: o temporário entra no fim da conversa de origem. */
export function addPending(pending: PendingByChat, item: Omit<PendingSend, 'id' | 'phase'>): PendingByChat {
  return withChat(pending, item.chatId, [...(pending[item.chatId] ?? []), { ...item, id: null, phase: 'correcting' }])
}

/** O envio foi aceito: o temporário ganha o `id`; se o eco já chegou (está nas mensagens), sai na hora. */
export function confirmPending(pending: PendingByChat, chatId: string, key: string, id: string, messages: readonly WhatsAppMessage[] | undefined): PendingByChat {
  const list = pending[chatId]
  if (!list?.some((item) => item.key === key)) return pending
  return settlePending(
    withChat(
      pending,
      chatId,
      list.map((item) => (item.key === key ? { ...item, id } : item)),
    ),
    chatId,
    messages,
  )
}

/** Falhou: o temporário sai (o texto volta ao campo por conta de quem chamou). Devolve o temporário que saiu. */
export function failPending(pending: PendingByChat, chatId: string, key: string): { pending: PendingByChat; failed: PendingSend | null } {
  const list = pending[chatId] ?? []
  const failed = list.find((item) => item.key === key) ?? null
  if (!failed) return { pending, failed: null }
  return {
    pending: withChat(
      pending,
      chatId,
      list.filter((item) => item.key !== key),
    ),
    failed,
  }
}

/** O eco demorou: o temporário aceito para de brilhar e diz "Enviada" (o texto continua o digitado). */
export function markPendingSent(pending: PendingByChat, chatId: string, key: string): PendingByChat {
  const list = pending[chatId]
  if (!list?.some((item) => item.key === key && item.id !== null && item.phase === 'correcting')) return pending
  return withChat(
    pending,
    chatId,
    list.map((item) => (item.key === key ? { ...item, phase: 'sent' } : item)),
  )
}

/** Os temporários cuja mensagem real já está na conversa saem; devolve também os `id` trocados (para o fade). */
export function settlePending(pending: PendingByChat, chatId: string, messages: readonly WhatsAppMessage[] | undefined): PendingByChat {
  const list = pending[chatId]
  if (!list || !messages?.length) return pending
  const ids = new Set(messages.map((message) => message.id))
  const kept = list.filter((item) => item.id === null || !ids.has(item.id))
  return kept.length === list.length ? pending : withChat(pending, chatId, kept)
}

/** Os `id` dos temporários aceitos que a lista de mensagens acabou de trazer (as mensagens que entram com o fade). */
export function settledIds(before: PendingByChat, after: PendingByChat): string[] {
  const kept = new Set(Object.values(after).flatMap((list) => list.map((item) => item.key)))
  return Object.values(before)
    .flat()
    .filter((item) => item.id !== null && !kept.has(item.key))
    .map((item) => item.id as string)
}

/** O que a conversa mostra: nunca o temporário e a mensagem real juntos. */
export function visiblePending(pending: readonly PendingSend[] | undefined, messages: readonly WhatsAppMessage[] | undefined): PendingSend[] {
  if (!pending?.length) return []
  const ids = new Set((messages ?? []).map((message) => message.id))
  return pending.filter((item) => item.id === null || !ids.has(item.id))
}

/** Folga entre a hora do clique (no Mac) e a hora do eco (do serviço) ao segurar as mensagens suas. */
export const PENDING_ECHO_SLACK_MS = 5_000

/**
 * O eco pode chegar antes da resposta do envio (sem o `id`, ainda não dá para saber de qual temporário ele é). Enquanto
 * houver temporário sem `id` na conversa, as mensagens suas a partir do clique ficam fora da tela; a resposta do envio
 * (ou a falha) as solta. Assim nunca aparecem as duas, a digitada e a corrigida.
 */
export function visibleMessages(messages: WhatsAppMessage[] | undefined, pending: readonly PendingSend[] | undefined): WhatsAppMessage[] | undefined {
  const waiting = pending?.filter((item) => item.id === null)
  if (!messages || !waiting?.length) return messages
  const since = Math.min(...waiting.map((item) => item.at)) - PENDING_ECHO_SLACK_MS
  return messages.filter((message) => !message.fromMe || message.at < since)
}
