// Gráficos locais do painel Detalhes (contrato 32): SVG estático com as classes dos tokens (como a TapeIllustration),
// sem biblioteca e sem animação (nada a reduzir com `prefers-reduced-motion`). Cada um leva o resumo em texto no
// `aria-label`; o `<title>` de cada marca é a dica ao passar o mouse.
import type { InsightsMoodDay } from '@shared/whatsapp-insights'
import { INSIGHTS_MOOD_LABELS } from '@shared/whatsapp-insights'
import type { WhatsAppMessage } from '@shared/whatsapp'
import { activityBars, activityDays, activitySummary, balanceSegments, balanceSummary, dayLabel, moodLevels, moodPoints, moodSummary, talkBalance } from './chart-data'

const WIDTH = 268

/** Atividade: mensagens por dia nos últimos 14 dias, barras da linha de base, o pico com o número. */
export function ActivityChart({ messages, now }: { messages: readonly WhatsAppMessage[]; now: number }) {
  const days = activityDays(messages, now)
  const top = 14
  const plot = 56
  const base = top + plot
  const { bars, peak } = activityBars(days, WIDTH, plot)
  const first = days[0]
  const last = days.at(-1)
  return (
    <svg data-wa-chart="activity" role="img" aria-label={activitySummary(days)} viewBox={`0 0 ${WIDTH} ${base + 16}`} className="block h-auto w-full" focusable="false">
      {bars.map((bar) =>
        bar.count > 0 ? (
          <rect key={bar.day} data-wa-bar={bar.day} x={bar.x} y={top + bar.y} width={bar.width} height={bar.height} className="fill-accent">
            <title>{`${dayLabel(bar.day)}: ${bar.count} ${bar.count === 1 ? 'mensagem' : 'mensagens'}`}</title>
          </rect>
        ) : null,
      )}
      <rect x={0} y={base} width={WIDTH} height={1} className="fill-line-strong" />
      {peak && (
        <text x={Math.min(WIDTH - 2, Math.max(2, peak.x + peak.width / 2))} y={top + peak.y - 4} textAnchor="middle" className="fill-text-muted text-12 tabular">
          {peak.count}
        </text>
      )}
      {first && (
        <text x={0} y={base + 14} className="fill-text-faint text-12 tabular">
          {dayLabel(first.day)}
        </text>
      )}
      {last && (
        <text x={WIDTH} y={base + 14} textAnchor="end" className="fill-text-faint text-12 tabular">
          hoje
        </text>
      )}
    </svg>
  )
}

/** Quem fala: a barra dupla você × eles, com a legenda e os percentuais em texto. */
export function BalanceChart({ messages, group }: { messages: readonly WhatsAppMessage[]; group: boolean }) {
  const balance = talkBalance(messages)
  const segments = balanceSegments(balance, WIDTH)
  const others = group ? 'Grupo' : 'Eles'
  return (
    <div className="flex flex-col gap-2">
      <svg data-wa-chart="balance" role="img" aria-label={balanceSummary(balance, group)} viewBox={`0 0 ${WIDTH} 10`} className="block h-auto w-full" focusable="false">
        {segments.length ? (
          segments.map((segment) => (
            <rect key={segment.who} data-wa-bar={segment.who} x={segment.x} y={0} width={segment.width} height={10} className={segment.who === 'mine' ? 'fill-mic' : 'fill-sys'}>
              <title>{segment.who === 'mine' ? `Você: ${balance.mine} (${balance.minePct}%)` : `${others}: ${balance.theirs} (${balance.theirsPct}%)`}</title>
            </rect>
          ))
        ) : (
          <rect x={0} y={4} width={WIDTH} height={1} className="fill-line-strong" />
        )}
      </svg>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-text-muted tabular" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 bg-mic" />
          Você {balance.minePct}%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 bg-sys" />
          {others} {balance.theirsPct}%
        </span>
      </p>
    </div>
  )
}

/** Humor no tempo: um ponto por dia (o humor que o Claude leu), em três alturas, ligados por uma linha. */
export function MoodChart({ days }: { days: readonly InsightsMoodDay[] }) {
  const left = 84
  const plotWidth = WIDTH - left
  const height = 64
  const points = moodPoints(days, plotWidth, height)
  const levels = moodLevels(height)
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${left + point.x} ${point.y}`).join(' ')
  return (
    <svg data-wa-chart="mood" role="img" aria-label={moodSummary(days)} viewBox={`0 0 ${WIDTH} ${height}`} className="block h-auto w-full" focusable="false">
      {levels.map((level) => (
        <g key={level.mood}>
          <rect x={left} y={level.y} width={plotWidth} height={1} className="fill-line" />
          <text x={0} y={level.y + 4} className="fill-text-faint text-12">
            {level.label}
          </text>
        </g>
      ))}
      {points.length > 1 && <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />}
      {points.map((point) => (
        <circle key={point.dia} data-wa-mood={point.valor} cx={left + point.x} cy={point.y} r={4} strokeWidth={2} className="fill-accent stroke-bg">
          <title>{`${dayLabel(point.dia)}: ${INSIGHTS_MOOD_LABELS[point.valor]}`}</title>
        </circle>
      ))}
    </svg>
  )
}
