// Contrato 53 (CA3): as regras de email, puras (sem IMAP, sem disco, sem relógio). `matchRule` diz se uma regra casa com
// uma mensagem; `planActions` percorre as regras na ordem e devolve o que fazer; `needsBody` diz se vale baixar o corpo.
// "Contém" é sem diferenciar maiúsculas e com acento (D2): os dois lados em NFC, "relatorio" não acha "relatório".
// Contrato 64: "é convite" olha o método do convite do corpo (REQUEST ou CANCEL) e "pôr na agenda" entra no plano.
import type { EmailAddress, EmailBody } from '../../shared/email'
import type { EmailRule, EmailRuleActions, EmailRuleCondition } from '../../shared/email-rules'
import type { InviteMethod } from '../../shared/invite'

/**
 * O que as condições olham. `body`/`hasAttachment` `null`: não deu para ler (condição de corpo ou anexo não casa).
 * `inviteMethod` `null`: sem convite, ou sem corpo.
 */
export interface EmailRuleInput {
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  subject: string
  body: string | null
  hasAttachment: boolean | null
  inviteMethod: InviteMethod | null
}

export interface EmailRulePlan {
  /** As regras que casaram, na ordem. */
  ruleIds: string[]
  markRead: boolean
  flag: boolean
  moveTo: string | null
  delete: boolean
  silent: boolean
  /** Contrato 64: alguma regra que casou pede "pôr na agenda". */
  addToCalendar: boolean
}

const fold = (value: string): string => value.normalize('NFC').toLowerCase()
const has = (text: string, needle: string): boolean => fold(text).includes(fold(needle))
const people = (list: readonly EmailAddress[], needle: string): boolean => list.some((item) => has(item.address, needle) || (item.name !== null && has(item.name, needle)))

/** O HTML reduzido a texto, para "corpo contém" quando o email não tem parte em texto. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
}

/** O corpo como as condições olham: o texto (ou o HTML reduzido), se tem anexo e o método do convite; sem corpo, os três `null`. */
export function ruleBody(body: EmailBody | null): Pick<EmailRuleInput, 'body' | 'hasAttachment' | 'inviteMethod'> {
  if (!body) return { body: null, hasAttachment: null, inviteMethod: null }
  return { body: body.text ?? (body.html !== null ? htmlText(body.html) : ''), hasAttachment: body.attachments.length > 0, inviteMethod: body.invite?.method ?? null }
}

function matchCondition(message: EmailRuleInput, condition: EmailRuleCondition): boolean {
  if (condition.field === 'hasAttachment') return message.hasAttachment === true
  // C1: a resposta de um convidado (REPLY) não é convite.
  if (condition.field === 'isInvite') return message.inviteMethod === 'REQUEST' || message.inviteMethod === 'CANCEL'
  const { value } = condition
  if (condition.field === 'from') return people(message.from, value)
  if (condition.field === 'to') return people(message.to, value) || people(message.cc, value)
  if (condition.field === 'subject') return has(message.subject, value)
  return message.body !== null && has(message.body, value)
}

export function matchRule(message: EmailRuleInput, rule: EmailRule): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false
  const check = (condition: EmailRuleCondition): boolean => matchCondition(message, condition)
  return rule.match === 'all' ? rule.conditions.every(check) : rule.conditions.some(check)
}

export const emptyPlan = (): EmailRulePlan => ({ ruleIds: [], markRead: false, flag: false, moveTo: null, delete: false, silent: false, addToCalendar: false })

/**
 * Na ordem: as marcas (`markRead`, `flag`, `silent`, `addToCalendar`) se somam; a primeira regra que casa com mover ou
 * apagar decide o destino e encerra (a mensagem saiu da INBOX, D4), levando as marcas dela; `stopHere` encerra também.
 */
export function planActions(message: EmailRuleInput, rules: readonly EmailRule[]): EmailRulePlan {
  const plan = emptyPlan()
  for (const rule of rules) {
    if (!matchRule(message, rule)) continue
    const actions: EmailRuleActions = rule.actions
    plan.ruleIds.push(rule.id)
    plan.markRead ||= actions.markRead
    plan.flag ||= actions.flag
    plan.silent ||= actions.silent
    plan.addToCalendar ||= actions.addToCalendar
    if (actions.delete) {
      plan.delete = true
      break
    }
    if (actions.moveTo !== null) {
      plan.moveTo = actions.moveTo
      break
    }
    if (rule.stopHere) break
  }
  return plan
}

/** Alguma regra ligada olha o corpo, o anexo ou o convite, ou põe na agenda: vale baixar o corpo antes. */
export function needsBody(rules: readonly EmailRule[]): boolean {
  return rules.some((rule) => rule.enabled && (rule.actions.addToCalendar || rule.conditions.some((condition) => condition.field === 'body' || condition.field === 'hasAttachment' || condition.field === 'isInvite')))
}
