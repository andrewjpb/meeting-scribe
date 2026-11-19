// Contrato 51: a tarefa agendada que pode enviar email, com a permissão dada antes (na criação ou na edição da tarefa).
// Exceção controlada à regra "nenhum agente envia a terceiros" (contrato 23) e ao N1 da PRD do email: a permissão é o
// "Salvar" com a seção "Pode enviar email" ligada, e vale só para a conta escolhida, os destinatários da lista e o teto
// de envios por execução. As regras de quem pode receber ficam aqui (o renderer valida o formulário com elas e o main
// confere cada envio com as mesmas); sem zod e sem Node.
import { EMAIL_ADDRESS_PATTERN } from './email'

/** Destinatários permitidos numa tarefa: endereços exatos e/ou domínios `@empresa.com`. */
export const TASK_EMAIL_ALLOW_MIN = 1
export const TASK_EMAIL_ALLOW_MAX = 50
/** Teto de envios por execução: padrão 5, máximo 20. */
export const TASK_EMAIL_MAX_PER_RUN_DEFAULT = 5
export const TASK_EMAIL_MAX_PER_RUN_MAX = 20
/** Envios e recusas guardados numa execução (o teto mais as recusas, com folga). */
export const RUN_EMAILS_MAX = 60

/** O domínio de uma entrada `@empresa.com`. */
const DOMAIN_PATTERN = /^@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/

/** A permissão gravada na tarefa. */
export interface TaskEmailPermission {
  /** A conta que envia (id do contrato 42). */
  accountId: string
  /** Endereços exatos e domínios `@empresa.com`, em minúsculas, sem repetir. */
  allow: string[]
  /** Envios por execução (1 a 20). */
  maxPerRun: number
  /** Quando a pessoa ligou a seção e salvou (ISO 8601): a data da permissão. */
  grantedAt: string
}

/** O que o formulário manda: a data da permissão é do main. */
export type TaskEmailInput = Omit<TaskEmailPermission, 'grantedAt'>

/** Um envio (ou uma recusa) de uma execução, para a aba "Execuções". */
export interface RunEmail {
  /** ISO 8601. */
  at: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  ok: boolean
  /** Com os `<` e `>`; `null` na recusa ou na falha. */
  messageId: string | null
  /** O motivo da recusa ou da falha ("app bloqueado", "destinatário fora da lista: …"). */
  error: string | null
}

/** A entrada da lista como fica gravada (sem espaço, em minúsculas). */
export const normalizeAllowEntry = (entry: string): string => entry.trim().toLowerCase()

/** Endereço exato (`ana@cliente.com`) ou domínio (`@cliente.com`). */
export function allowEntryValid(entry: string): boolean {
  const value = normalizeAllowEntry(entry)
  return value.length <= 320 && (DOMAIN_PATTERN.test(value) || EMAIL_ADDRESS_PATTERN.test(value))
}

/** A lista digitada (uma por linha, ou separadas por vírgula, ponto e vírgula ou espaço), sem repetir. */
export function parseAllowList(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(/[\s,;]+/)) {
    const value = normalizeAllowEntry(part)
    if (value) seen.add(value)
  }
  return [...seen]
}

/**
 * O destinatário está na lista? Maiúsculas não contam. `@empresa.com` casa só com `alguem@empresa.com`: o subdomínio
 * (`alguem@vendas.empresa.com`) só casa se ele próprio estiver na lista.
 */
export function recipientAllowed(address: string, allow: readonly string[]): boolean {
  const value = normalizeAllowEntry(address)
  if (!EMAIL_ADDRESS_PATTERN.test(value)) return false
  const domain = value.slice(value.lastIndexOf('@'))
  return allow.some((entry) => {
    const rule = normalizeAllowEntry(entry)
    return rule.startsWith('@') ? rule === domain : rule === value
  })
}

/** "1 email", "2 emails". */
export const emailsLabel = (count: number): string => (count === 1 ? '1 email' : `${count} emails`)
