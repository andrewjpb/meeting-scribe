// Textos das contas das redes na aba Contas (contrato 69): o tipo, os seguidores e a validade do token, em pt-BR. Contrato
// 72: as linhas da fila de publicações, a cota e a inspeção da mídia no editor.
import type { Publication, PublicationQuota, PublicationType, RedesAccount } from '@shared/redes'
import type { RedesSection } from '@shared/routes'

const NUMBER = new Intl.NumberFormat('pt-BR')
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** `19/01/2027` (hora local do Mac). */
export function redesDate(iso: string): string {
  return DATE.format(new Date(iso))
}

/** `20/11/2026, 10:15`. */
export function redesDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso))
}

export function accountTypeLabel(account: Pick<RedesAccount, 'accountType'>): string {
  return account.accountType === 'business' ? 'Conta Business' : account.accountType === 'creator' ? 'Conta Creator' : 'Conta profissional'
}

export function followersLabel(followers: number | null): string | null {
  if (followers === null) return null
  return `${NUMBER.format(followers)} ${followers === 1 ? 'seguidor' : 'seguidores'}`
}

/** "Conta Business · 1.284 seguidores · Token válido até 19/01/2027"; vencida, a validade sai (a tela diz o porquê). */
export function accountLine(account: RedesAccount): string {
  const parts = [accountTypeLabel(account), followersLabel(account.followers)]
  if (account.state !== 'expirada') parts.push(`Token válido até ${redesDate(account.tokenExpiresAt)}`)
  return parts.filter(Boolean).join(' · ')
}

export const REDES_STATE_LABELS: Readonly<Record<RedesAccount['state'], string>> = {
  conectando: 'Conectando…',
  conectada: 'Conectada',
  expirada: 'Token vencido',
  erro: 'Erro na renovação',
}

/** Contrato 72: o nome de cada seção das redes, no nível Redes e no título da tela ("@conta · Publicações"). */
export const REDES_SECTION_LABELS: Readonly<Record<RedesSection, string>> = {
  publicacoes: 'Publicações',
  comentarios: 'Comentários',
  mensagens: 'Mensagens',
  metricas: 'Métricas',
}

const TYPE_LABELS: Readonly<Record<PublicationType, string>> = { imagem: 'Imagem', carrossel: 'Carrossel', reels: 'Reels' }

export function publicationTypeLabel(type: PublicationType): string {
  return TYPE_LABELS[type]
}

const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
const dayKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** `hoje às 08:00`, `ontem às 08:00` ou `18/11 às 08:00` (hora local do Mac). */
export function relativeWhen(iso: string, now: Date): string {
  const date = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const day = dayKey(date) === dayKey(now) ? 'hoje' : dayKey(date) === dayKey(yesterday) ? 'ontem' : DAY_MONTH.format(date)
  return `${day} às ${TIME.format(date)}`
}

/** A hora marcada: `Sáb., 21/11 às 10:00`. */
export function scheduleWhen(iso: string): string {
  const date = new Date(iso)
  const weekday = WEEKDAY.format(date).replace(/\.$/, '')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}., ${DAY_MONTH.format(date)} às ${TIME.format(date)}`
}

/** A segunda linha de uma publicação na fila: o tipo e o estado ou a data (a métrica entra com o contrato 75). */
export function publicationLine(publication: Publication, now: Date, editing: boolean): string {
  const parts = [publicationTypeLabel(publication.type)]
  if (publication.type === 'carrossel') parts.push(`${publication.media.length} mídias`)
  switch (publication.state) {
    case 'erro':
      parts.push(`falhou ${relativeWhen(publication.updatedAt, now)}`)
      break
    case 'rascunho':
      parts.push(editing ? 'editando' : `editado ${relativeWhen(publication.updatedAt, now)}`)
      break
    case 'agendada':
      if (publication.scheduledAt) parts.push(scheduleWhen(publication.scheduledAt))
      break
    case 'publicando':
      parts.push('Publicando…')
      break
    case 'publicada':
      if (publication.publishedAt) parts.push(DAY_MONTH.format(new Date(publication.publishedAt)))
      break
  }
  return parts.join(' · ')
}

/** A linha de apoio de Publicações: a cota da Meta das últimas 24 h. */
export function quotaLine(quota: PublicationQuota | 'consultando' | 'indisponivel' | undefined): string {
  if (quota === undefined || quota === 'consultando') return 'Cota da Meta: consultando…'
  if (quota === 'indisponivel') return 'Cota da Meta: não foi possível consultar agora'
  return `Cota da Meta: ${NUMBER.format(quota.used)} de ${NUMBER.format(quota.total)} publicações nas últimas 24 h`
}

const DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** `412 KB`, `4,1 MB`. */
export function bytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${NUMBER.format(Math.max(1, Math.round(bytes / 1024)))} KB`
  return `${DECIMAL.format(bytes / (1024 * 1024))} MB`
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** `4:5` quando a proporção é exata e curta; senão `1,33:1`. */
export function ratioLabel(width: number, height: number): string {
  if (!width || !height) return ''
  const divisor = gcd(width, height)
  const [w, h] = [width / divisor, height / divisor]
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${DECIMAL.format(width / height)}:1`
}

/** A inspeção de uma mídia que passou: `JPEG 1080 × 1350 (4:5) · 412 KB · dentro das especificações`. */
export function mediaInspection(media: { kind: 'imagem' | 'video'; mimeType: string; width: number; height: number; bytes: number; durationSeconds: number | null }): string {
  const format = media.mimeType === 'image/jpeg' ? 'JPEG' : media.mimeType === 'video/quicktime' ? 'MOV' : 'MP4'
  const size = media.width && media.height ? ` ${media.width} × ${media.height}` : ''
  const ratio = media.kind === 'imagem' && media.width && media.height ? ` (${ratioLabel(media.width, media.height)})` : ''
  const parts = [`${format}${size}${ratio}`]
  if (media.kind === 'video' && media.durationSeconds !== null) parts.push(`${DECIMAL.format(media.durationSeconds)} s`)
  parts.push(bytesLabel(media.bytes), 'dentro das especificações')
  return parts.join(' · ')
}
