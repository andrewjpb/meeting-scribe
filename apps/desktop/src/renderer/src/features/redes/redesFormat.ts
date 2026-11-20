// Textos das contas das redes na aba Contas (contrato 69): o tipo, os seguidores e a validade do token, em pt-BR.
import type { RedesAccount } from '@shared/redes'

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
