// Textos da seção Comentários das redes (contrato 73): a hora relativa de cada comentário, a linha de cada mídia e a da
// última atualização, em pt-BR (hora local do Mac).
import type { RedesMediaWithComments } from '@shared/redes'
import { relativeWhen } from './redesFormat'

const NUMBER = new Intl.NumberFormat('pt-BR')
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `agora`, `há 5 min`, `há 2 h`, `há 3 d`; de 7 dias para trás, `18/11` (ou `18/11/2025` em outro ano). */
export function commentAge(iso: string, now: Date): string {
  const date = new Date(iso)
  const elapsed = now.getTime() - date.getTime()
  if (elapsed < MINUTE) return 'agora'
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`
  if (elapsed < 7 * DAY) return `há ${Math.floor(elapsed / DAY)} d`
  return date.getFullYear() === now.getFullYear() ? DAY_MONTH.format(date) : FULL_DATE.format(date)
}

/** A data inteira, para a dica do `<time>`: `19/11/2026, 15:22`. */
export function commentDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso))
}

/** `1 comentário`, `12 comentários`. */
export function commentsCountLabel(count: number): string {
  return `${NUMBER.format(count)} ${count === 1 ? 'comentário' : 'comentários'}`
}

/** `1 novo`, `3 novos`. */
export function unreadLabel(count: number): string {
  return `${NUMBER.format(count)} ${count === 1 ? 'novo' : 'novos'}`
}

/** A primeira linha da legenda (a lista mostra uma linha só, com reticências). */
export function mediaCaptionLine(media: Pick<RedesMediaWithComments, 'caption'>): string {
  return media.caption.split('\n').find((line) => line.trim())?.trim() ?? ''
}

/** O texto do estado vazio: quando foi a última atualização. */
export function commentsUpdatedLine(updatedAt: string | null, now: Date): string {
  return updatedAt ? `Última atualização ${relativeWhen(updatedAt, now)}.` : 'Ainda não foi possível atualizar.'
}
