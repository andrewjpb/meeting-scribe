// Regras de email na tela (contrato 55, CA17 a CA19 e CA21): o resumo de uma regra numa frase, o "último erro", a
// frase da contagem do "Executar agora" e o rascunho do editor com a validação, espelho do esquema do contrato 53 (que
// segue sendo a palavra final, no main). Sem DOM: testado em test/renderer/email-rules-format.test.ts.
import { EMAIL_INBOX_MAILBOX } from '@shared/email'
import type { EmailRule, EmailRuleActions, EmailRuleCondition, EmailRuleErrorCode, EmailRulesError, EmailRulesSetResult, EmailRuleTextField } from '@shared/email-rules'
import { EMAIL_RULE_CONDITIONS_MAX, EMAIL_RULE_NAME_MAX, EMAIL_RULE_VALUE_MAX } from '@shared/email-rules-limits'

/** O nome de uma pasta na tela ("Clientes › ABF"). */
export type FolderName = (path: string) => string

export type ConditionField = EmailRuleTextField | 'hasAttachment'
export const CONDITION_FIELDS: readonly ConditionField[] = ['from', 'to', 'subject', 'body', 'hasAttachment']

/** Como cada condição aparece (com o artigo, numa condição só; sem ele, na lista de "Se todas:"). */
const CONDITION_NAMES: Record<ConditionField, string> = {
  from: 'o remetente contém',
  to: 'o destinatário ou Cc contém',
  subject: 'o assunto contém',
  body: 'o corpo contém',
  hasAttachment: 'tem anexo',
}

/** O rótulo do seletor do tipo de condição no editor. */
export const CONDITION_LABELS: Record<ConditionField, string> = {
  from: 'Remetente contém',
  to: 'Destinatário ou Cc contém',
  subject: 'Assunto contém',
  body: 'Corpo contém',
  hasAttachment: 'Tem anexo',
}

export type ActionKind = 'move' | 'read' | 'flag' | 'delete' | 'silent'
export const ACTION_KINDS: readonly ActionKind[] = ['move', 'read', 'flag', 'delete', 'silent']
/** Numa conta POP3, só estas (N2). */
export const POP3_ACTION_KINDS: readonly ActionKind[] = ['read', 'silent']

export const ACTION_LABELS: Record<ActionKind, string> = {
  move: 'Mover para a pasta',
  read: 'Marcar como lida',
  flag: 'Marcar com estrela',
  delete: 'Apagar (vai para a Lixeira)',
  silent: 'Não avisar',
}

const quoted = (value: string): string => `“${value}”`

function conditionText(condition: EmailRuleCondition, article: boolean): string {
  const name = CONDITION_NAMES[condition.field]
  const shown = article ? name : name.replace(/^o /, '')
  return condition.field === 'hasAttachment' ? shown : `${shown} ${quoted(condition.value)}`
}

/** As ações em minúscula, na ordem da tela ("marcar com estrela", "mover para Pendentes"). */
function actionTexts(actions: EmailRuleActions, name: FolderName): string[] {
  const out: string[] = []
  if (actions.markRead) out.push('marcar como lida')
  if (actions.flag) out.push('marcar com estrela')
  if (actions.moveTo !== null) out.push(`mover para ${name(actions.moveTo)}`)
  if (actions.delete) out.push('apagar (vai para a Lixeira)')
  if (actions.silent) out.push('não avisar')
  return out
}

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)

/** O resumo em duas partes: a condição ("Se o remetente contém “@abf.com.br”") e as ações ("Mover para … · parar aqui"). */
export function ruleSummaryParts(rule: Pick<EmailRule, 'match' | 'conditions' | 'actions' | 'stopHere'>, name: FolderName): { condition: string; actions: string } {
  const condition =
    rule.conditions.length <= 1
      ? `Se ${rule.conditions[0] ? conditionText(rule.conditions[0], true) : 'nenhuma condição'}`
      : `Se ${rule.match === 'all' ? 'todas' : 'qualquer uma'}: ${rule.conditions.map((item) => conditionText(item, false)).join(', ')}`
  const parts = [...actionTexts(rule.actions, name), ...(rule.stopHere ? ['parar aqui'] : [])]
  return { condition, actions: capital(parts.join(' · ')) }
}

/** "Se o remetente contém “@abf.com.br” Mover para Clientes › ABF · parar aqui". */
export function ruleSummary(rule: Pick<EmailRule, 'match' | 'conditions' | 'actions' | 'stopHere'>, name: FolderName): string {
  const parts = ruleSummaryParts(rule, name)
  return `${parts.condition} ${parts.actions}`.trim()
}

const two = (value: number): string => String(value).padStart(2, '0')

/** "hoje, 09:12", "ontem, 18:40", "16/11, 09:12" ou, de outro ano, "16/11/2025, 09:12". */
export function whenText(at: number, now = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  if (at >= start) return `hoje, ${time}`
  if (at >= start - 86_400_000) return `ontem, ${time}`
  const day = `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  return date.getFullYear() === today.getFullYear() ? `${day}, ${time}` : `${day}/${date.getFullYear()}, ${time}`
}

/** O "último erro" de uma regra (CA17), sem nada do conteúdo do email. */
export function ruleErrorText(error: { at: number; code: EmailRuleErrorCode }, rule: Pick<EmailRule, 'actions'>, name: FolderName, now = Date.now()): string {
  const stays = 'O email ficou na Caixa de Entrada.'
  const reason: Record<EmailRuleErrorCode, string> = {
    'folder-missing': `a pasta ${quoted(rule.actions.moveTo ? name(rule.actions.moveTo) : 'de destino')} não existe mais no servidor. ${stays}`,
    'no-trash': `a conta não tem Lixeira, então a regra não apaga. ${stays}`,
    unavailable: `sem conexão com o servidor. ${stays}`,
    server: `o servidor recusou. ${stays}`,
    pop3: 'conta POP3 não move, não marca com estrela nem apaga.',
  }
  return `Último erro ${whenText(error.at, now)}: ${reason[error.code]}`
}

const joinAnd = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1) ?? ''}`)

/**
 * A frase da contagem do "Executar agora" (CA19): "23 das 200 mensagens da Caixa de Entrada atendem à regra e serão
 * marcadas como lidas." e, com "não avisar", a nota de que isso não muda nada no que já chegou. 0: "Nenhuma das …".
 */
export function previewText(rule: Pick<EmailRule, 'actions'>, count: number, inbox: number, name: FolderName): string {
  const of = `${inbox === 1 ? 'da 1 mensagem' : `das ${inbox} mensagens`} da Caixa de Entrada`
  if (count === 0) return `Nenhuma ${of} atende à regra.`
  const one = count === 1
  const done: string[] = []
  if (rule.actions.moveTo !== null) done.push(`${one ? 'movida' : 'movidas'} para ${name(rule.actions.moveTo)}`)
  if (rule.actions.markRead) done.push(one ? 'marcada como lida' : 'marcadas como lidas')
  if (rule.actions.flag) done.push(one ? 'marcada com estrela' : 'marcadas com estrela')
  if (rule.actions.delete) done.push(one ? 'levada à Lixeira' : 'levadas à Lixeira')
  const head = `${count} ${of} ${one ? 'atende' : 'atendem'} à regra`
  const main = done.length ? `${head} e ${one ? 'será' : 'serão'} ${joinAnd(done)}.` : `${head}.`
  return rule.actions.silent ? `${main} “Não avisar” não muda nada em email que já chegou.` : main
}

/** O resultado do "Executar agora": "Feito em N mensagens." (+ as que já tinham saído). */
export function runResultText(done: number, skipped: number): string {
  const head = `Feito em ${done === 1 ? '1 mensagem' : `${done} mensagens`}.`
  return skipped > 0 ? `${head} ${skipped === 1 ? '1 já tinha saído' : `${skipped} já tinham saído`} da Caixa de Entrada.` : head
}

/** O rascunho do editor: as condições com o texto como a pessoa digita e as ações como linhas, na ordem em que entraram. */
export interface RuleDraft {
  id: string
  name: string
  enabled: boolean
  match: 'all' | 'any'
  conditions: { field: ConditionField; value: string }[]
  actions: { kind: ActionKind; moveTo: string | null }[]
  stopHere: boolean
}

/** Regra nova (CA18): uma condição "Remetente contém" vazia e nenhuma ação (nenhuma regra nasce apagando). */
export function newRuleDraft(id: string): RuleDraft {
  return { id, name: '', enabled: true, match: 'all', conditions: [{ field: 'from', value: '' }], actions: [], stopHere: false }
}

export function ruleToDraft(rule: EmailRule): RuleDraft {
  const actions: RuleDraft['actions'] = []
  if (rule.actions.markRead) actions.push({ kind: 'read', moveTo: null })
  if (rule.actions.flag) actions.push({ kind: 'flag', moveTo: null })
  if (rule.actions.moveTo !== null) actions.push({ kind: 'move', moveTo: rule.actions.moveTo })
  if (rule.actions.delete) actions.push({ kind: 'delete', moveTo: null })
  if (rule.actions.silent) actions.push({ kind: 'silent', moveTo: null })
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    match: rule.match,
    conditions: rule.conditions.map((item) => (item.field === 'hasAttachment' ? { field: 'hasAttachment', value: '' } : { field: item.field, value: item.value })),
    actions,
    stopHere: rule.stopHere,
  }
}

export function draftToRule(draft: RuleDraft): EmailRule {
  const has = (kind: ActionKind): boolean => draft.actions.some((item) => item.kind === kind)
  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    match: draft.match,
    conditions: draft.conditions.map((item): EmailRuleCondition => (item.field === 'hasAttachment' ? { field: 'hasAttachment' } : { field: item.field, value: item.value.trim() })),
    actions: { moveTo: draft.actions.find((item) => item.kind === 'move')?.moveTo ?? null, markRead: has('read'), flag: has('flag'), delete: has('delete'), silent: has('silent') },
    stopHere: draft.stopHere,
  }
}

/** As ações que ainda cabem numa linha nova: cada uma uma vez; mover e apagar se excluem; POP3 só as dele. */
export function availableActions(draft: Pick<RuleDraft, 'actions'>, options: { pop3: boolean; hasTrash: boolean }, keep?: ActionKind): ActionKind[] {
  const used = new Set(draft.actions.map((item) => item.kind).filter((kind) => kind !== keep))
  return (options.pop3 ? POP3_ACTION_KINDS : ACTION_KINDS).filter((kind) => {
    if (used.has(kind)) return false
    if (kind === 'move' && used.has('delete')) return false
    if (kind === 'delete' && (used.has('move') || !options.hasTrash)) return false
    return true
  })
}

const oneLine = (text: string): boolean => !/[\r\n]/.test(text)

/**
 * O que falta para a regra passar no formato do contrato 53 (CA1), em frase; `null` quando passa. O main confere de novo
 * (`scribe:email-rules-set`).
 */
export function validateRuleDraft(draft: RuleDraft, options: { pop3: boolean; hasTrash: boolean } = { pop3: false, hasTrash: true }): string | null {
  const name = draft.name.trim()
  if (!name) return 'Dê um nome à regra.'
  if (name.length > EMAIL_RULE_NAME_MAX) return `O nome passa de ${EMAIL_RULE_NAME_MAX} caracteres.`
  if (!oneLine(name)) return 'O nome fica numa linha só.'
  if (draft.conditions.length === 0) return 'Adicione ao menos uma condição.'
  if (draft.conditions.length > EMAIL_RULE_CONDITIONS_MAX) return `No máximo ${EMAIL_RULE_CONDITIONS_MAX} condições.`
  for (const condition of draft.conditions) {
    if (condition.field === 'hasAttachment') continue
    const value = condition.value.trim()
    if (!value) return 'Escreva o texto de cada condição.'
    if (value.length > EMAIL_RULE_VALUE_MAX) return `O texto de uma condição passa de ${EMAIL_RULE_VALUE_MAX} caracteres.`
    if (!oneLine(value)) return 'O texto de cada condição fica numa linha só.'
  }
  if (draft.actions.length === 0) return 'Escolha ao menos uma ação.'
  const kinds = draft.actions.map((item) => item.kind)
  if (new Set(kinds).size !== kinds.length) return 'Cada ação entra uma vez só.'
  if (kinds.includes('move') && kinds.includes('delete')) return 'Mover e apagar não vão juntos na mesma regra.'
  const move = draft.actions.find((item) => item.kind === 'move')
  if (move && move.moveTo === null) return 'Escolha a pasta de destino.'
  if (move?.moveTo && move.moveTo.toUpperCase() === EMAIL_INBOX_MAILBOX) return 'A regra não move para a Caixa de Entrada.'
  if (options.pop3 && kinds.some((kind) => !POP3_ACTION_KINDS.includes(kind))) return 'Conta POP3: só marcar como lida e não avisar.'
  if (kinds.includes('delete') && !options.hasTrash) return 'Esta conta não tem Lixeira.'
  return null
}

/** "Regra Faturas na posição 2 de 4" (a mudança de ordem, para a região viva). */
export function positionText(name: string, position: number, total: number): string {
  return `Regra ${name} na posição ${position} de ${total}`
}

/** Sobe ou desce uma regra (Subir/Descer do menu ⋯); fora dos limites, a lista como está. */
export function moveRule<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/**
 * O resultado do `scribe:email-rules-set` (contrato 53): `ok` é gravado (inclusive sem conexão com o servidor: o main já
 * grava e devolve `ok`); qualquer falha, `unavailable` inclusive (o `settings.json` não foi gravado), é falha: a tela
 * volta a lista ao que estava e mostra a frase.
 */
export function rulesSaveOutcome(result: EmailRulesSetResult): { ok: true; rules: EmailRule[] } | { ok: false; error: EmailRulesError } {
  return result.ok ? { ok: true, rules: result.rules } : { ok: false, error: result.error }
}

/** A frase da recusa ao gravar as regras. */
export function rulesSaveErrorText(error: EmailRulesError): string {
  switch (error) {
    case 'folder-missing':
      return 'A pasta escolhida não existe mais. Escolha outra.'
    case 'no-trash':
      return 'A conta não tem Lixeira: apagar não fica disponível.'
    case 'pop3':
      return 'Conta POP3: só marcar como lida e não avisar.'
    case 'invalid':
      return 'Confira os campos da regra.'
    case 'missing':
      return 'A conta não existe mais.'
    case 'server':
      return 'O servidor recusou.'
    case 'unavailable':
      return 'Não foi possível gravar as regras agora. Nada mudou; tente de novo.'
    case 'stale':
      return 'A regra mudou. Tente de novo.'
  }
}
