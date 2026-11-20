import { ArrowDown, ArrowUp, Film, Image as ImageGlyph, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountInsights, MediaInsights, MetricPeriod } from '@shared/redes'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { ScrollFade } from '../../design/ScrollFade'
import { Segmented } from '../../design/Segmented'
import { DEFAULT_METRICS_SORT, followsLabel, mediaLine, metricNumber, metricsNote, nextSort, periodRange, sortMedia, type MetricsColumn, type MetricsSort } from './metricsFormat'
import { useRedes } from './redesStore'

const PAGE_TOP = 'px-[var(--page-x)] pt-[var(--page-top)] pb-4'
const DEFAULT_PERIOD: MetricPeriod = 28
/** Os de `METRIC_PERIODS`, aqui à mão: importar o valor de `@shared/redes` traria o zod (e a CSP recusa o `new Function` dele). */
const PERIODS: readonly MetricPeriod[] = [7, 28, 90]
const PERIOD_OPTIONS = PERIODS.map((period) => ({ value: String(period) as `${MetricPeriod}`, label: `${period} dias` }))

/** Os cartões da conta, na ordem da spec; `name` é o `data-redes-metric`. */
const CARDS: readonly { name: string; label: string; full?: string; value: (insights: AccountInsights) => string }[] = [
  { name: 'followers', label: 'Seguidores agora', value: (insights) => metricNumber(insights.followers) },
  { name: 'reach', label: 'Alcance', value: (insights) => metricNumber(insights.reach) },
  { name: 'views', label: 'Visualizações', value: (insights) => metricNumber(insights.views) },
  { name: 'accountsEngaged', label: 'Contas engajadas', value: (insights) => metricNumber(insights.accountsEngaged) },
  { name: 'totalInteractions', label: 'Interações', value: (insights) => metricNumber(insights.totalInteractions) },
  { name: 'likes', label: 'Curtidas', value: (insights) => metricNumber(insights.likes) },
  { name: 'comments', label: 'Comentários', value: (insights) => metricNumber(insights.comments) },
  { name: 'saves', label: 'Salvamentos', value: (insights) => metricNumber(insights.saves) },
  { name: 'shares', label: 'Compartilhamentos', value: (insights) => metricNumber(insights.shares) },
  { name: 'followsAndUnfollows', label: 'Seguidores +/−', full: 'Seguidores ganhos e perdidos', value: (insights) => followsLabel(insights.followsAndUnfollows) },
  { name: 'profileLinksTaps', label: 'Toques em links', value: (insights) => metricNumber(insights.profileLinksTaps) },
]

/** As colunas da tabela; o rótulo curto (cabe com a seta em 96 px) tem o nome inteiro no `title` e para o leitor de tela. */
const COLUMNS: readonly { column: MetricsColumn; label: string; full?: string }[] = [
  { column: 'publicacao', label: 'Publicação' },
  { column: 'data', label: 'Data' },
  { column: 'views', label: 'Visualiz.', full: 'Visualizações' },
  { column: 'reach', label: 'Alcance' },
  { column: 'likes', label: 'Curtidas' },
  { column: 'comments', label: 'Coment.', full: 'Comentários' },
  { column: 'saved', label: 'Salvos', full: 'Salvamentos' },
  { column: 'shares', label: 'Compart.', full: 'Compartilhamentos' },
]
const NUMBER_COLUMNS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares'] as const

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
/** A primeira linha da legenda (a tabela mostra uma linha só, com reticências). */
const captionLine = (caption: string): string => caption.split('\n').find((line) => line.trim())?.trim() ?? ''

/**
 * Tela Redes › Métricas (contrato 75, R7 e CA12; artboard 07, densidade do contrato 79): o período em `Segmented` (7, 28
 * ou 90 dias), os números da conta em cartões (só números, sem gráfico), a nota do atraso da Meta e a tabela das 25
 * publicações recentes, ordenável pelo cabeçalho. Lê ao abrir e ao trocar o período (o main responde do cache de 1 h);
 * "Atualizar" lê da Meta de novo. O número que a Meta não entregou aparece como "—".
 */
export function MetricsSection({ accountId, title, notice }: { accountId: string; title: string; notice: ReactNode }) {
  const period = useRedes((store) => store.metricsPeriod[accountId] ?? DEFAULT_PERIOD)
  const state = useRedes((store) => store.metrics[accountId])
  const loading = useRedes((store) => store.metricsLoading[accountId] === true)
  const [sort, setSort] = useState<MetricsSort>(DEFAULT_METRICS_SORT)
  const [now, setNow] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void useRedes.getState().loadMetrics(accountId, period)
  }, [accountId, period])
  // O "atualizado há N min" anda sozinho.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const insights = state?.account[period] ?? null
  const media = state ? sortMedia(state.media, sort) : []
  const note = !state && loading ? 'Consultando o Instagram…' : metricsNote(state, now)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PAGE_TOP}>
        <PageHeader
          title={title}
          titleAttrs={{ 'data-redes-title': '' }}
          actions={
            <Button variant="secondary" icon={RefreshCw} action="redes-metrics-refresh" data={{ 'data-redes-metrics-refresh': '' }} disabled={loading} onClick={() => void useRedes.getState().loadMetrics(accountId, period, true)}>
              Atualizar
            </Button>
          }
        />
      </div>
      {notice}
      <div className="relative flex min-h-0 flex-1 flex-col border-t border-line">
        <div ref={scrollRef} data-redes-metrics className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-[var(--page-x)] pt-4 pb-6">
          {state?.error && (
            <Note id="redes-metrics-error" icon={TriangleAlert} role="alert">
              {state.error}
            </Note>
          )}

          <section aria-labelledby="redes-metrics-account" className="flex flex-col gap-2">
            <div className="flex min-h-7 items-center gap-2">
              <h2 id="redes-metrics-account" className="label">
                Conta
              </h2>
              {insights && <span className="text-11 text-text-muted">{`de ${periodRange(insights)}`}</span>}
              <span className="flex-1" />
              <span id="redes-metrics-period" className="sr-only">
                Período
              </span>
              <Segmented
                value={String(period) as `${MetricPeriod}`}
                options={PERIOD_OPTIONS}
                labelledBy="redes-metrics-period"
                dataName="redes-period"
                onChange={(value) => useRedes.getState().setMetricsPeriod(accountId, Number(value) as MetricPeriod)}
              />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
              {CARDS.map((card) => (
                <div key={card.name} data-redes-metric={card.name} className="flex min-w-0 flex-col rounded-[var(--radius-control)] border border-line px-3 py-2">
                  <span className="label truncate" title={card.full ?? card.label} aria-label={card.full}>
                    {card.label}
                  </span>
                  <span data-redes-metric-value className="tabular truncate text-20 font-bold text-title">
                    {insights ? card.value(insights) : '—'}
                  </span>
                </div>
              ))}
            </div>
            <p data-redes-metrics-updated className="text-11 text-text-muted">
              {note}
            </p>
          </section>

          <section aria-labelledby="redes-metrics-media" className="flex flex-col gap-2">
            <div className="flex min-h-7 items-center gap-2">
              <h2 id="redes-metrics-media" className="label">
                Publicações
              </h2>
              <span className="text-11 text-text-muted">as 25 mais recentes · clique no título da coluna para ordenar</span>
            </div>
            {state && !state.media.length ? (
              <div data-redes-metrics-empty className="flex justify-center py-8">
                <EmptyState
                  illustration={
                    <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised text-text-muted">
                      <Icon icon={ImageGlyph} />
                    </span>
                  }
                  title="Nenhuma publicação ainda"
                >
                  As publicações da conta vão aparecer aqui com as visualizações, o alcance e as interações de cada uma.
                </EmptyState>
              </div>
            ) : (
              <MetricsTable media={media} sort={sort} onSort={(column) => setSort((current) => nextSort(current, column))} />
            )}
          </section>
        </div>
        <ScrollFade target={scrollRef} tone="page" />
      </div>
    </div>
  )
}

/**
 * Bordas separadas (não `border-collapse`): o fio de baixo fica dentro dos 28 px de cada linha, e o cabeçalho também
 * mede 28 com o dele. A última linha não tem fio.
 */
const CELL = 'h-7 border-b border-line py-0 group-last:border-b-0'

function MetricsTable({ media, sort, onSort }: { media: MediaInsights[]; sort: MetricsSort; onSort: (column: MetricsColumn) => void }) {
  return (
    <table data-redes-metrics-table className="tabular w-full table-fixed border-separate border-spacing-0 text-13">
      <colgroup>
        <col />
        <col className="w-16" />
        {NUMBER_COLUMNS.map((column) => (
          <col key={column} className="w-24" />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(({ column, label, full }) => {
            const active = sort.column === column
            const left = column === 'publicacao'
            return (
              <th key={column} scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={`h-7 border-b border-line-strong p-0 ${left ? 'text-left' : 'text-right'}`}>
                {/* 27 px: com o fio de baixo do cabeçalho, a linha mede os 28 das outras. */}
                <button
                  type="button"
                  data-redes-metrics-sort={column}
                  aria-label={full}
                  title={full}
                  onClick={() => onSort(column)}
                  className={`no-drag inline-flex h-[27px] max-w-full items-center gap-1 rounded-[var(--radius-control)] px-2 text-11 font-medium whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title focus-visible:outline-offset-[-2px] ${left ? '-ml-2' : 'flex-row-reverse'} ${active ? 'text-title' : 'text-text-muted'}`}
                >
                  <span className="truncate">{label}</span>
                  {active && <Icon icon={sort.direction === 'asc' ? ArrowUp : ArrowDown} size={14} />}
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {media.map((item) => {
          const caption = captionLine(item.caption)
          return (
            <tr key={item.mediaId} data-redes-metrics-row={item.mediaId} className="group">
              <td className={`${CELL} pr-2`}>
                <span className="flex min-w-0 items-center gap-2" title={mediaLine(item)}>
                  <MetricsThumb path={item.thumbPath} video={item.mediaType === 'VIDEO'} />
                  <span data-redes-metrics-caption className={`truncate ${caption ? 'text-text' : 'text-text-faint'}`}>
                    {caption || 'Sem legenda'}
                  </span>
                </span>
              </td>
              <td className={`${CELL} px-2 text-right text-text-muted`}>{DAY_MONTH.format(new Date(item.timestamp))}</td>
              {NUMBER_COLUMNS.map((column) => (
                <td key={column} data-redes-metrics-cell={column} className={`${CELL} px-2 text-right text-text`}>
                  {metricNumber(item[column])}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** A miniatura 24×24 da publicação (a baixada pelo main, como data URL); sem ela, o ícone sobre `--bg-sunken`. */
function MetricsThumb({ path, video }: { path: string | null; video: boolean }) {
  const url = useRedes((store) => (path ? store.thumbs[path] : null))
  // Sem resposta ainda (ou depois de uma falha passageira), pede de novo; o store limita as tentativas.
  useEffect(() => {
    if (path && url === undefined) useRedes.getState().thumbnail(path)
  })
  if (url) return <img src={url} alt="" draggable={false} data-redes-metrics-thumb className="size-6 shrink-0 rounded-[var(--radius-control)] object-cover" />
  return (
    <span aria-hidden="true" data-redes-metrics-thumb-placeholder className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
      <Icon icon={video ? Film : ImageGlyph} size={14} />
    </span>
  )
}
