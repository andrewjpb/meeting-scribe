// Agendador do atendimento no WhatsApp (contrato 140): só a lógica de tempo. Decide se uma mensagem que chega vira
// resposta agendada (atraso sorteado entre `delayMinMinutes` e `delayMaxMinutes`), reagenda quando chega outra da mesma
// conversa (com teto de 2 × `delayMax` desde a primeira) e conta as respostas na última hora, por conversa e no total.
// Módulo puro: relógio, temporizador e sorteio chegam injetados. Não lê o store, não chama modelo e não envia (contrato
// 141). Pendências ficam só na memória e se perdem ao fechar o app, como pede a spec.
import { isGroupChat, type AtendimentoBinding, type AtendimentoHours } from '../../../shared/atendimento'

/** Teto de respostas automáticas somando todas as conversas, na última hora. */
export const GLOBAL_MAX_PER_HOUR = 30

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type SchedulerDeps = {
  /** Agora, em ms. */
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** Em [0, 1). */
  random: () => number
  /** Hora de responder: os ids pendentes da conversa, na ordem de chegada. */
  onDue: (chatId: string, pendingIds: string[]) => void
}

export type IncomingSkipReason = 'disabled' | 'paused' | 'paused-all' | 'out-of-hours' | 'rate-limited' | 'group'

export type IncomingResult = { status: 'scheduled'; dueAt: number } | { status: 'skipped'; reason: IncomingSkipReason }

export interface AtendimentoIncoming {
  chatId: string
  messageId: string
  binding: AtendimentoBinding
  pausedAll: boolean
}

export interface AtendimentoScheduler {
  /** Agenda (ou reagenda) a resposta da conversa, ou diz por que não. */
  onIncoming(input: AtendimentoIncoming): IncomingResult
  /** Cancela a resposta pendente da conversa; devolve os ids que estavam pendentes (`[]` se nada). */
  cancel(chatId: string): string[]
  /** Cancela todas; devolve as conversas que tinham pendência. */
  cancelAll(): string[]
  /** Conta uma resposta enviada na conversa (janela deslizante de 60 min). */
  recordSent(chatId: string): void
  /** Ainda cabe uma resposta: menos de `maxPerHour` na conversa e menos de `GLOBAL_MAX_PER_HOUR` no total. */
  canSend(chatId: string, maxPerHour: number): boolean
  pending(chatId: string): { dueAt: number; messageIds: string[] } | null
  /** Limpa todos os temporizadores; depois disso nenhum `onDue` é chamado. */
  dispose(): void
}

interface Pending {
  firstAt: number
  dueAt: number
  messageIds: string[]
  handle: unknown
}

/** "HH:MM" em minutos desde a meia-noite. */
const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/**
 * Dentro do horário, na hora local de `at`. `null` é sempre. Fim exclusivo. Faixa com `end` antes de `start` cruza a
 * meia-noite e pertence ao dia em que começou. `start` igual a `end` vale o dia inteiro a partir de `start`.
 */
export function isWithinHours(hours: AtendimentoHours | null, at: Date): boolean {
  if (!hours) return true
  const day = at.getDay()
  const minute = at.getHours() * 60 + at.getMinutes()
  const start = minutesOf(hours.start)
  const end = minutesOf(hours.end)
  if (start < end) return hours.days.includes(day) && minute >= start && minute < end
  const previous = (day + 6) % 7
  return (hours.days.includes(day) && minute >= start) || (hours.days.includes(previous) && minute < end)
}

export function createAtendimentoScheduler(deps: SchedulerDeps): AtendimentoScheduler {
  const pendings = new Map<string, Pending>()
  /** Envios da última hora: por conversa e no total. */
  const sentByChat = new Map<string, number[]>()
  let sentAll: number[] = []
  let disposed = false

  const recent = (times: number[], now: number): number[] => times.filter((at) => now - at < HOUR)

  const fire = (chatId: string): void => {
    const entry = pendings.get(chatId)
    if (!entry || disposed) return
    pendings.delete(chatId)
    deps.onDue(chatId, entry.messageIds)
  }

  const canSend = (chatId: string, maxPerHour: number): boolean => {
    const now = deps.now()
    sentAll = recent(sentAll, now)
    const chat = recent(sentByChat.get(chatId) ?? [], now)
    if (chat.length > 0) sentByChat.set(chatId, chat)
    else sentByChat.delete(chatId)
    return chat.length < maxPerHour && sentAll.length < GLOBAL_MAX_PER_HOUR
  }

  const skipped = (reason: IncomingSkipReason): IncomingResult => ({ status: 'skipped', reason })

  const cancel = (chatId: string): string[] => {
    const entry = pendings.get(chatId)
    if (!entry) return []
    deps.clearTimer(entry.handle)
    pendings.delete(chatId)
    return entry.messageIds
  }

  return {
    onIncoming({ chatId, messageId, binding, pausedAll }) {
      if (disposed) return skipped('disabled')
      if (isGroupChat(chatId)) return skipped('group')
      if (!binding.enabled) return skipped('disabled')
      if (pausedAll) return skipped('paused-all')
      const now = deps.now()
      if (binding.pausedUntil && Date.parse(binding.pausedUntil) > now) return skipped('paused')
      if (!isWithinHours(binding.hours, new Date(now))) return skipped('out-of-hours')
      if (!canSend(chatId, binding.maxPerHour)) return skipped('rate-limited')

      const min = binding.delayMinMinutes * MINUTE
      const max = binding.delayMaxMinutes * MINUTE
      const previous = pendings.get(chatId)
      if (previous) deps.clearTimer(previous.handle)
      const firstAt = previous?.firstAt ?? now
      const drawn = now + min + Math.floor(deps.random() * (max - min))
      const dueAt = Math.min(drawn, firstAt + 2 * max)
      const entry: Pending = { firstAt, dueAt, messageIds: [...(previous?.messageIds ?? []), messageId], handle: undefined }
      pendings.set(chatId, entry)
      entry.handle = deps.setTimer(() => fire(chatId), Math.max(0, dueAt - now))
      return { status: 'scheduled', dueAt }
    },
    cancel,
    cancelAll() {
      const chatIds = [...pendings.keys()]
      for (const chatId of chatIds) cancel(chatId)
      return chatIds
    },
    recordSent(chatId) {
      const now = deps.now()
      sentByChat.set(chatId, [...recent(sentByChat.get(chatId) ?? [], now), now])
      sentAll = [...recent(sentAll, now), now]
    },
    canSend,
    pending(chatId) {
      const entry = pendings.get(chatId)
      return entry ? { dueAt: entry.dueAt, messageIds: [...entry.messageIds] } : null
    },
    dispose() {
      disposed = true
      for (const entry of pendings.values()) deps.clearTimer(entry.handle)
      pendings.clear()
    },
  }
}
