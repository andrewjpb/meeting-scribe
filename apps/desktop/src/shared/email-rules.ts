// Contrato 53: as regras de email (R4, R5, N1–N3, N5, N6 da spec email-organizacao). Regras do app, como as "só no
// cliente" do Outlook: rodam com o app aberto, no email novo que chega à Caixa de Entrada, e no "Executar agora". Cada
// regra tem condições (todas ou qualquer uma) e ações; "parar aqui" (`stopHere`) impede as seguintes. Ficam no
// `settings.json`, em `emailRules`, por id de conta (`SettingsStore.getEmailRules`), e saem com a conta. O "último erro",
// a hora do último "Executar agora" e a contagem ficam à parte, em `userData/email/<conta>.rules-state.json` (D1).
// Nenhuma regra nasce apagando: não há regra padrão e `delete` começa `false`.
// Contrato 64: a condição "É convite" (`isInvite`) e a ação "Pôr na agenda" (`addToCalendar`), que só cria o evento na
// agenda padrão das Configurações e nunca responde ao organizador.
import { z } from 'zod'
import { EMAIL_FOLDER_PATH_MAX, EMAIL_INBOX_MAILBOX } from './email'

import { EMAIL_RULE_CONDITIONS_MAX, EMAIL_RULE_NAME_MAX, EMAIL_RULE_VALUE_MAX, EMAIL_RULES_MAX } from './email-rules-limits'

export { EMAIL_RULE_CONDITIONS_MAX, EMAIL_RULE_NAME_MAX, EMAIL_RULE_VALUE_MAX, EMAIL_RULES_MAX } from './email-rules-limits'
/** O token do "Executar agora" vale 2 min (D10). */
export const EMAIL_RULE_TOKEN_TTL_MS = 2 * 60_000

/** `to` olha Para e Cc. */
export const EMAIL_RULE_TEXT_FIELDS = ['from', 'to', 'subject', 'body'] as const
export type EmailRuleTextField = (typeof EMAIL_RULE_TEXT_FIELDS)[number]

/** "Contém" `value` (sem diferenciar maiúsculas), "tem anexo" ou, contrato 64, "é convite" (REQUEST ou CANCEL). */
export type EmailRuleCondition = { field: EmailRuleTextField; value: string } | { field: 'hasAttachment' } | { field: 'isInvite' }

export interface EmailRuleActions {
  /** Mover para esta pasta (path IMAP). */
  moveTo: string | null
  markRead: boolean
  /** Estrela (`\Flagged`). */
  flag: boolean
  /** Apagar: mover para a Lixeira (`\Trash`), nunca `EXPUNGE` (N3). */
  delete: boolean
  /** Não avisar (sem notificação). */
  silent: boolean
  /** Contrato 64: "Pôr na agenda" (só o REQUEST, na agenda padrão; nunca responde, nunca pede acesso ao macOS). */
  addToCalendar: boolean
}

export interface EmailRule {
  /** UUID (a tela gera). */
  id: string
  name: string
  enabled: boolean
  /** `all`: todas as condições; `any`: basta uma. */
  match: 'all' | 'any'
  conditions: EmailRuleCondition[]
  actions: EmailRuleActions
  /** "Parar aqui": casou, as regras seguintes não rodam para esta mensagem. */
  stopHere: boolean
}

/** Uma regra nova: ligada, sem "parar aqui" e sem ação (a pessoa escolhe; nenhuma nasce apagando). */
export const DEFAULT_EMAIL_RULE_ACTIONS: Readonly<EmailRuleActions> = Object.freeze({ moveTo: null, markRead: false, flag: false, delete: false, silent: false, addToCalendar: false })

export function newEmailRule(id: string, name: string): EmailRule {
  return { id, name, enabled: true, match: 'all', conditions: [], actions: { ...DEFAULT_EMAIL_RULE_ACTIONS }, stopHere: false }
}

/**
 * Por que a regra não agiu: `folder-missing` (a pasta de destino não está no servidor), `no-trash` (apagar sem Lixeira),
 * `unavailable` (sem conexão), `server` (o servidor recusou), `pop3` (ação que o POP3 não tem). Contrato 64:
 * `calendar-denied` (o acesso ao Calendário do Mac não é completo) e `no-calendar` (não há onde gravar: sem agenda padrão,
 * agenda que sumiu ou não grava, fora do Mac, sem o helper ou o helper sem resposta).
 */
export const EMAIL_RULE_ERROR_CODES = ['folder-missing', 'no-trash', 'unavailable', 'server', 'pop3', 'calendar-denied', 'no-calendar'] as const
export type EmailRuleErrorCode = (typeof EMAIL_RULE_ERROR_CODES)[number]

/** O estado de uma regra (fora do `settings.json`). Nunca leva assunto, remetente nem corpo. */
export interface EmailRuleState {
  lastError: { at: number; code: EmailRuleErrorCode } | null
  /** O último "Executar agora". */
  lastRunAt: number | null
  /** Mensagens em que a regra agiu. */
  hits: number
}

export const EMPTY_EMAIL_RULE_STATE: Readonly<EmailRuleState> = Object.freeze({ lastError: null, lastRunAt: null, hits: 0 })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Sem CR nem LF. */
const oneLine = (value: string): boolean => !/[\r\n]/.test(value)

/** O path de uma pasta, como o do mover (contrato 52): sem quebra de linha nem caractere nulo. */
const folderPath = z
  .string()
  .min(1)
  .max(EMAIL_FOLDER_PATH_MAX)
  .refine((value) => !/[\r\n\0]/.test(value))

const conditionSchema = z.union([
  z.object({ field: z.enum(EMAIL_RULE_TEXT_FIELDS), value: z.string().min(1).max(EMAIL_RULE_VALUE_MAX).refine(oneLine) }).strict(),
  z.object({ field: z.literal('hasAttachment') }).strict(),
  z.object({ field: z.literal('isInvite') }).strict(),
])

const actionsSchema = z
  .object({
    moveTo: folderPath.refine((value) => value.toUpperCase() !== EMAIL_INBOX_MAILBOX).nullable(),
    markRead: z.boolean(),
    flag: z.boolean(),
    delete: z.boolean(),
    silent: z.boolean(),
    // A regra gravada pela 0.16.0 não tem a chave: volta com `false` na leitura leniente.
    addToCalendar: z.boolean().default(false),
  })
  .strict()
  // Alguma ação ligada; apagar e mover juntos, não.
  .refine((actions) => actions.moveTo !== null || actions.markRead || actions.flag || actions.delete || actions.silent || actions.addToCalendar)
  .refine((actions) => !(actions.delete && actions.moveTo !== null))

export const emailRuleSchema = z
  .object({
    id: z.string().regex(UUID),
    name: z.string().min(1).max(EMAIL_RULE_NAME_MAX).refine(oneLine),
    enabled: z.boolean(),
    match: z.enum(['all', 'any']),
    // Ao menos uma condição: não há "todas as mensagens" (D3).
    conditions: z.array(conditionSchema).min(1).max(EMAIL_RULE_CONDITIONS_MAX),
    actions: actionsSchema,
    stopHere: z.boolean(),
  })
  .strict()

/** A lista inteira de uma conta, na ordem: até 50, sem id repetido. */
export const emailRuleListSchema = z
  .array(emailRuleSchema)
  .max(EMAIL_RULES_MAX)
  .refine((list) => new Set(list.map((rule) => rule.id)).size === list.length)

/**
 * `missing`: conta ou regra inexistente; `pop3`: a conta POP3 só tem "marcar lida" e "não avisar" (N2); `invalid`: pedido
 * fora do formato; `folder-missing`: a pasta de destino não existe no servidor; `no-trash`: apagar numa conta sem Lixeira;
 * `stale`: o token do "Executar agora" venceu, foi usado, é de outra conta ou a regra mudou; `unavailable`: sem conexão
 * (ou o `settings.json` não se lê); `server`: o servidor recusou. Contrato 64: `auto-calendar`: "Pôr na agenda" numa conta
 * que já põe os convites na agenda dela (R5b); `no-mac`: "Pôr na agenda" fora do macOS ou sem o helper.
 */
export type EmailRulesError = 'missing' | 'pop3' | 'invalid' | 'folder-missing' | 'no-trash' | 'stale' | 'unavailable' | 'server' | 'auto-calendar' | 'no-mac'
export interface EmailRulesFailure {
  ok: false
  error: EmailRulesError
}

/**
 * Contrato 64: `invite.autoAdds`: a conta já põe os convites na agenda dela (R5b); `invite.mac`: o Calendário do Mac existe
 * aqui (macOS com o helper, sem pedir acesso).
 */
export type EmailRulesGetResult = { ok: true; rules: EmailRule[]; state: Record<string, EmailRuleState>; invite: { autoAdds: boolean; mac: boolean } } | EmailRulesFailure
export type EmailRulesSetResult = { ok: true; rules: EmailRule[] } | EmailRulesFailure
/** O primeiro passo do "Executar agora": quantas mensagens da Caixa de Entrada a regra pega, o que faria e o token. */
export type EmailRulePreviewResult = { ok: true; count: number; actions: Pick<EmailRuleActions, 'markRead' | 'flag' | 'moveTo' | 'delete' | 'addToCalendar'>; token: string } | EmailRulesFailure
/** `done`: mensagens em que agiu; `skipped`: as do preview que já não estavam na Caixa de Entrada (ou que falharam). */
export type EmailRuleRunResult = { ok: true; done: number; skipped: number } | EmailRulesFailure
