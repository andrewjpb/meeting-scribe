// Gráficos locais do painel Detalhes (contrato 32), sem IA e sem biblioteca: funções puras que transformam as
// mensagens carregadas (e o humor por dia que o Claude devolveu) nas medidas das barras, segmentos e pontos que
// `Charts.tsx` desenha em SVG. Segue a skill de visualização no que cabe nos tokens do app: barras finas que saem de
// uma linha de base só, 2 px de intervalo entre as que se encostam, um eixo mínimo, rótulo só no pico e o resumo em
// texto para o leitor de tela. Sem DOM: testado em test/renderer/whatsapp-details.test.ts.
import type { InsightsMood, InsightsMoodDay } from '@shared/whatsapp-insights'
import { INSIGHTS_MOOD_LABELS } from '@shared/whatsapp-insights'
import type { WhatsAppMessage } from '@shared/whatsapp'

export const ACTIVITY_DAYS = 14
/** Barra no máximo desta largura; o resto do espaço fica de ar. */
export const BAR_MAX = 12
/** Intervalo entre marcas que se encostam. */
export const GAP = 2

const two = (value: number): string => String(value).padStart(2, '0')
/** `AAAA-MM-DD` no dia local. */
export const localDay = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}
/** `AAAA-MM-DD` → `dd/mm`. */
export const dayLabel = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`

export interface ActivityDay {
  day: string
  count: number
}

/** Mensagens por dia nos últimos 14 dias (hoje incluído), do mais antigo ao mais novo; dias sem mensagem valem 0. */
export function activityDays(messages: readonly Pick<WhatsAppMessage, 'at'>[], now: number, days = ACTIVITY_DAYS): ActivityDay[] {
  const today = new Date(now)
  const keys = Array.from({ length: days }, (_, index) => localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index), 12).getTime()))
  const counts = new Map(keys.map((key) => [key, 0]))
  for (const message of messages) {
    const key = localDay(message.at)
    const current = counts.get(key)
    if (current !== undefined) counts.set(key, current + 1)
  }
  return keys.map((day) => ({ day, count: counts.get(day) ?? 0 }))
}

export interface ActivityBar extends ActivityDay {
  x: number
  y: number
  width: number
  height: number
}

/** As barras numa área `width` × `height` (a base em `height`): uma faixa por dia, a barra centrada nela. */
export function activityBars(days: readonly ActivityDay[], width: number, height: number): { bars: ActivityBar[]; max: number; peak: ActivityBar | null } {
  const max = Math.max(0, ...days.map((day) => day.count))
  const slot = days.length ? width / days.length : 0
  const barWidth = Math.max(1, Math.min(BAR_MAX, slot - GAP))
  const bars = days.map((day, index) => {
    const barHeight = max ? Math.round((day.count / max) * height * 100) / 100 : 0
    return { ...day, x: Math.round((index * slot + (slot - barWidth) / 2) * 100) / 100, y: Math.round((height - barHeight) * 100) / 100, width: barWidth, height: barHeight }
  })
  // O pico é o dia mais recente com o maior número (o rótulo fica nele).
  const peak = max ? ([...bars].reverse().find((bar) => bar.count === max) ?? null) : null
  return { bars, max, peak }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** Resumo em texto da atividade, para o `aria-label` e a tabela. */
export function activitySummary(days: readonly ActivityDay[]): string {
  const total = days.reduce((sum, day) => sum + day.count, 0)
  if (!total) return `Nenhuma mensagem carregada nos últimos ${days.length} dias.`
  const active = days.filter((day) => day.count > 0).length
  const max = Math.max(...days.map((day) => day.count))
  const peak = [...days].reverse().find((day) => day.count === max)
  return `${plural(total, 'mensagem', 'mensagens')} em ${plural(active, 'dia', 'dias')} dos últimos ${days.length}; o dia com mais foi ${peak ? dayLabel(peak.day) : ''}, com ${max}.`
}

export interface TalkBalance {
  mine: number
  theirs: number
  total: number
  /** Percentuais inteiros que somam 100 (0 e 0 sem mensagens). */
  minePct: number
  theirsPct: number
}

/** Quem fala: mensagens suas × deles e os percentuais. */
export function talkBalance(messages: readonly Pick<WhatsAppMessage, 'fromMe'>[]): TalkBalance {
  const mine = messages.filter((message) => message.fromMe).length
  const total = messages.length
  const theirs = total - mine
  const minePct = total ? Math.round((mine / total) * 100) : 0
  return { mine, theirs, total, minePct, theirsPct: total ? 100 - minePct : 0 }
}

export interface BalanceSegment {
  who: 'mine' | 'theirs'
  x: number
  width: number
}

/** A barra dupla numa largura: você à esquerda, eles à direita, com o intervalo entre os dois quando há os dois. */
export function balanceSegments(balance: TalkBalance, width: number): BalanceSegment[] {
  if (!balance.total) return []
  if (!balance.mine) return [{ who: 'theirs', x: 0, width }]
  if (!balance.theirs) return [{ who: 'mine', x: 0, width }]
  const usable = width - GAP
  // Nenhum lado some: cada um tem pelo menos 2 px.
  const mineWidth = Math.min(usable - 2, Math.max(2, Math.round((balance.mine / balance.total) * usable)))
  return [
    { who: 'mine', x: 0, width: mineWidth },
    { who: 'theirs', x: mineWidth + GAP, width: usable - mineWidth },
  ]
}

export function balanceSummary(balance: TalkBalance, group: boolean): string {
  if (!balance.total) return 'Nenhuma mensagem carregada.'
  const others = group ? 'o grupo' : 'o outro lado'
  return `Você mandou ${plural(balance.mine, 'mensagem', 'mensagens')} (${balance.minePct}%) e ${others}, ${balance.theirs} (${balance.theirsPct}%).`
}

/** Altura de cada humor: satisfeito em cima, insatisfeito embaixo. */
const MOOD_LEVEL: Record<InsightsMood, number> = { positivo: 0, neutro: 1, negativo: 2 }

export interface MoodPoint extends InsightsMoodDay {
  x: number
  y: number
}

/** Os pontos do humor no tempo, pela data (o primeiro dia à esquerda, o último à direita), em 3 alturas. */
export function moodPoints(days: readonly InsightsMoodDay[], width: number, height: number, inset = 6): MoodPoint[] {
  const sorted = [...days].sort((a, b) => a.dia.localeCompare(b.dia))
  const time = (day: string): number => Date.parse(`${day}T12:00:00Z`)
  const first = sorted[0]
  const last = sorted.at(-1)
  if (!first || !last) return []
  const span = time(last.dia) - time(first.dia)
  const inner = width - inset * 2
  return sorted.map((day) => ({
    ...day,
    x: Math.round((span ? inset + ((time(day.dia) - time(first.dia)) / span) * inner : width / 2) * 100) / 100,
    y: Math.round((inset + (MOOD_LEVEL[day.valor] / 2) * (height - inset * 2)) * 100) / 100,
  }))
}

/** A altura de cada linha de referência do humor (para os rótulos do eixo). */
export function moodLevels(height: number, inset = 6): { mood: InsightsMood; label: string; y: number }[] {
  return (Object.keys(MOOD_LEVEL) as InsightsMood[]).map((mood) => ({ mood, label: INSIGHTS_MOOD_LABELS[mood], y: Math.round((inset + (MOOD_LEVEL[mood] / 2) * (height - inset * 2)) * 100) / 100 }))
}

export function moodSummary(days: readonly InsightsMoodDay[]): string {
  if (!days.length) return 'Sem humor por dia.'
  return days.map((day) => `${dayLabel(day.dia)}: ${INSIGHTS_MOOD_LABELS[day.valor].toLocaleLowerCase('pt-BR')}`).join('; ')
}
