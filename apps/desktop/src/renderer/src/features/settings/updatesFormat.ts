// Textos do bloco "Atualizações" e do aviso da barra lateral (contrato 14). Sem DOM: testado em
// test/renderer/updates-format.test.ts.
import type { UpdateDownloadState } from '@shared/updates'
import { dayLabel, timeLabel } from '../meetings/format'

/** "Última verificação: hoje às 21:05" ou "ontem às" ou "12 de novembro às". */
export function lastCheckLabel(iso: string | null, now: Date): string {
  if (!iso) return 'Ainda não verificado.'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Ainda não verificado.'
  return `Última verificação: ${dayLabel(date, now).toLowerCase()} às ${timeLabel(date)}`
}

/** "Baixando… 42%"; `null` fora do download. */
export function downloadProgressLabel(download: UpdateDownloadState): string | null {
  return download.phase === 'downloading' ? `Baixando… ${download.percent}%` : null
}
