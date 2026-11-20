// Textos das métricas das redes (contrato 75): os números em pt-BR, a nota do atraso da Meta, a ordenação da tabela das
// publicações. Puros, sem React (os testes importam daqui).
import type { AccountInsights, MediaInsights, RedesMetricsState } from '@shared/redes'

const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

/** `—` sem número; `1.284` até 9.999; `12,3 mil` a partir de 10.000; `1,2 mi` a partir de 1 milhão. */
export function metricNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const thousands = Math.round(abs / 100) / 10
  if (abs >= 1_000_000 || thousands >= 1000) return `${DECIMAL.format(Math.round(value / 100_000) / 10)} mi`
  if (abs >= 10_000) return `${DECIMAL.format(Math.sign(value) * thousands)} mil`
  return INTEGER.format(value)
}

/** Seguidores ganhos e perdidos: `+12 · −3` (com o sinal de menos tipográfico). */
export function followsLabel(value: AccountInsights['followsAndUnfollows']): string {
  if (!value) return '—'
  return `+${metricNumber(value.follows)} · −${metricNumber(value.unfollows)}`
}

/** `atualizado agora`, `atualizado há 1 min`, `há 2 h`, `em 18/11`; sem leitura ainda, `ainda não atualizado`. */
export function updatedAgo(iso: string | null, now: number): string {
  if (!iso) return 'ainda não atualizado'
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'atualizado agora'
  if (minutes < 60) return `atualizado há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `atualizado há ${hours} h`
  return `atualizado em ${DAY_MONTH.format(new Date(iso))}`
}

/** A nota abaixo dos cartões da conta. */
export function metricsNote(state: Pick<RedesMetricsState, 'updatedAt'> | undefined, now: number): string {
  return `Dados do Instagram com até 48 h de atraso · ${updatedAgo(state?.updatedAt ?? null, now)}`
}

/** `22/10 a 18/11`: o período consultado (o `until` é exclusivo: o último dia é o anterior). */
export function periodRange(insights: Pick<AccountInsights, 'since' | 'until'>): string {
  return `${DAY_MONTH.format(new Date(insights.since))} a ${DAY_MONTH.format(new Date(Date.parse(insights.until) - 1))}`
}

/** `Reels · 14/11`: o tipo e a data da publicação. */
export function mediaLine(media: Pick<MediaInsights, 'mediaType' | 'timestamp'>): string {
  const type = media.mediaType === 'VIDEO' ? 'Reels' : media.mediaType === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem'
  return `${type} · ${DAY_MONTH.format(new Date(media.timestamp))}`
}

/** As colunas da tabela que ordenam (o `data-redes-metrics-sort`). */
export const METRICS_COLUMNS = ['publicacao', 'data', 'views', 'reach', 'likes', 'comments', 'saved', 'shares'] as const
export type MetricsColumn = (typeof METRICS_COLUMNS)[number]
export interface MetricsSort {
  column: MetricsColumn
  direction: 'asc' | 'desc'
}
export const DEFAULT_METRICS_SORT: MetricsSort = { column: 'views', direction: 'desc' }

/** O clique no cabeçalho: na mesma coluna, inverte; noutra, números e data do maior para o menor, a legenda de A a Z. */
export function nextSort(current: MetricsSort, column: MetricsColumn): MetricsSort {
  if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { column, direction: column === 'publicacao' ? 'asc' : 'desc' }
}

const COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/** A tabela ordenada; o número que falta (`—`) vai sempre para o fim, e o empate fica pela data, da mais nova. */
export function sortMedia(media: readonly MediaInsights[], sort: MetricsSort): MediaInsights[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  const byDate = (a: MediaInsights, b: MediaInsights): number => b.timestamp.localeCompare(a.timestamp)
  return [...media].sort((a, b) => {
    if (sort.column === 'publicacao') return factor * COLLATOR.compare(a.caption.trim(), b.caption.trim()) || byDate(a, b)
    if (sort.column === 'data') return factor * a.timestamp.localeCompare(b.timestamp)
    const x = a[sort.column]
    const y = b[sort.column]
    if (x === null && y === null) return byDate(a, b)
    if (x === null) return 1
    if (y === null) return -1
    return factor * (x - y) || byDate(a, b)
  })
}
