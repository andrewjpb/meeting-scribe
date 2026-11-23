// Selos do atendimento na tela do WhatsApp (contrato 143): o do cabeçalho da conversa ("Recados da Ana · atendendo") e
// a etiqueta de 18 px na lista de conversas. O relógio que atualiza "responde em N min" e "pausado até" anda a cada
// 30 s, só enquanto a tela do WhatsApp está montada (`useAtendimentoTicker`).
import { Bot, Clock, Moon, Pause, CirclePause, Sparkles, Square, UserCheck, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { create } from 'zustand'
import { Icon } from '../../design/Icon'
import { useAtendimento } from './atendimentoStore'
import { atendimentoStatus, type BadgeKind } from './status'

const TICK_MS = 30_000

const useClock = create<{ now: number }>()(() => ({ now: Date.now() }))

/** Liga o relógio dos selos enquanto quem chama está montado. */
export function useAtendimentoTicker(): void {
  useEffect(() => {
    useClock.setState({ now: Date.now() })
    const timer = setInterval(() => useClock.setState({ now: Date.now() }), TICK_MS)
    return () => clearInterval(timer)
  }, [])
}

/** Agora, no passo do relógio dos selos. */
export const useAtendimentoNow = (): number => useClock((state) => state.now)

const KIND_ICONS: Readonly<Record<BadgeKind, LucideIcon>> = {
  off: CirclePause,
  'all-paused': CirclePause,
  'handed-off': UserCheck,
  proposed: Sparkles,
  scheduled: Clock,
  paused: Pause,
  'out-of-hours': Moon,
  attending: Bot,
}

const MUTED: ReadonlySet<BadgeKind> = new Set(['paused', 'out-of-hours', 'off', 'all-paused'])

/** Contorno, fundo e cor do texto de cada estado: fundo --accent só em "passou para você"; tracejado na pausa geral. */
function toneClass(kind: BadgeKind): string {
  if (kind === 'handed-off') return 'border-accent bg-accent text-on-accent'
  if (kind === 'all-paused') return 'border-dashed border-line-strong bg-bg text-text-muted'
  if (MUTED.has(kind)) return 'border-line-strong bg-bg-sunken text-text-muted'
  return 'border-line-strong bg-bg-sunken text-accent'
}

/** O estado da conversa e o nome do agente; `null` sem atendimento. */
export function useAtendimentoBadge(chatId: string): { kind: BadgeKind; label: string; agentName: string } | null {
  const now = useAtendimentoNow()
  const state = useAtendimento((store) => store.state)
  const runtime = useAtendimento((store) => store.runtime[chatId])
  const binding = state?.bindings.find((item) => item.chatId === chatId)
  const status = atendimentoStatus({ binding, pausedAll: state?.pausedAll ?? false, runtime, now: new Date(now) })
  if (!status || !binding) return null
  const agentName = state?.agents.find((agent) => agent.id === binding.agentId)?.name ?? 'Agente excluído'
  return { ...status, agentName }
}

/** Selo do cabeçalho: "<agente> · <estado>". */
export function AtendimentoBadge({ chatId }: { chatId: string }) {
  const badge = useAtendimentoBadge(chatId)
  if (!badge) return null
  const full = `${badge.agentName} · ${badge.label}`
  return (
    <p
      data-atendimento-badge={badge.kind}
      title={full}
      className={`flex h-7 max-w-[280px] min-w-0 shrink items-center gap-1.5 rounded-[var(--radius-control)] border px-2 text-12 ${toneClass(badge.kind)}`}
    >
      {badge.kind === 'attending' ? <Icon icon={Square} size={14} className="shrink-0 fill-current" /> : <Icon icon={KIND_ICONS[badge.kind]} size={14} className="shrink-0" />}
      <span className={`min-w-0 truncate font-bold ${badge.kind === 'handed-off' ? '' : 'text-title'}`}>{badge.agentName}</span>
      <span className="shrink-0 whitespace-nowrap">· {badge.label}</span>
    </p>
  )
}

/** Etiqueta da lista de conversas: o ícone do estado e o nome do agente, só com o atendimento ligado. */
export function AtendimentoChip({ chatId }: { chatId: string }) {
  const badge = useAtendimentoBadge(chatId)
  if (!badge || badge.kind === 'off') return null
  const full = `${badge.agentName} · ${badge.label}`
  return (
    <span
      data-atendimento-chip={badge.kind}
      title={full}
      className={`inline-flex h-[18px] max-w-[60%] min-w-0 shrink items-center gap-1 rounded-[var(--radius-control)] border px-1.5 text-12 leading-none ${toneClass(badge.kind)}`}
    >
      <Icon icon={KIND_ICONS[badge.kind]} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{badge.agentName}</span>
      <span className="sr-only"> · {badge.label}</span>
    </span>
  )
}
