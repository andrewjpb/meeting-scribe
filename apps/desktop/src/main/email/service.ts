// Email no app (contrato 42): contas IMAP ou POP3 para receber e SMTP para enviar, tudo no main, no desenho do WhatsApp
// (service + clientes + store + IPC). As contas ficam em `settings.json` com a senha cifrada pelo `safeStorage`
// (`secrets.ts`); a senha em claro só existe na hora de conectar e nunca vai a log nem ao renderer.
//
// IMAP: ao conectar, as últimas 200 da INBOX (UID, flags, envelope) vão para o `email-store`; mensagem nova chega pelo
// IDLE (`ImapSession.onNew`) e vira o evento `onMessage`. "Marcar lida" e "Apagar" vão ao servidor (`STORE \Seen`,
// `\Deleted` + `EXPUNGE`) e depois ao store. O corpo só é baixado quando a tela pede, passa pelo `mailparser` e fica no
// store. POP3: um poll a cada `emailPollMinutes`, pelo `UIDL`; só as ainda não vistas são baixadas (`RETR`), já com o
// corpo, e ficam no servidor (`DELE` só com `deleteFromServer`). O primeiro poll de uma conta não avisa mensagem nova.
//
// Envio (R4): só com um token de clique (a mesma regra do WhatsApp: o preload gera o token no clique da pessoa e só o
// registro do IPC chama `registerClick` e `send`), sem diálogo de confirmação. Os bytes enviados vão também ao `APPEND` da pasta de
// enviados (IMAP) e o enviado fica guardado no app (as duas modalidades).
// Contrato 51: a única saída sem clique é `sendForTask`, o envio de uma tarefa agendada com "Pode enviar email", chamado
// só pela montagem das automações no main (nunca pelo IPC), depois das regras da permissão de `schedules/email-send.ts`.
//
// Contrato 52: as pastas da conta IMAP (`LIST` + `STATUS`, em árvore), abrir uma pasta (as 200 mais recentes, guardadas
// no store), mover (`MOVE`, ou `COPY` + `EXPUNGE`) e criar, renomear e apagar pasta, cada pedido numa conexão à parte
// (`ImapFolderSession`): a da INBOX segue no IDLE. A INBOX e as pastas especiais (`\Sent`, `\Trash`…) não se renomeiam
// nem se apagam. Erro do servidor não muda nada no store. `listFolders`, `moveMessages` e `createFolder` são o caminho
// interno (o IPC e, depois, o agente do contrato 56 chamam os mesmos). POP3 não tem pastas no servidor. O mover passa pela
// fila da conta (a mesma do sincronismo da INBOX e do IDLE), e o que chega à INBOX por ele não vira aviso de email novo.
// Nenhum pedido de pastas faz login numa conta com a senha recusada; a pasta vigiada só é relida com a conta conectada.
//
// Contrato 54: a assinatura de cada conta, lida e gravada no `settings.json` (sai junto quando a conta sai). Quem a põe no
// texto é o rascunho da tela, antes do envio; o envio (o do clique e o da tarefa agendada) não acrescenta nada.
//
// Contrato 53: as regras da conta (`rules.ts`), no email novo que chega à INBOX (`fetchNew` do IMAP e o poll do POP3,
// fora o primeiro), antes do `onMessage`: corpo (se alguma regra olha corpo ou anexo), marcas (`\Seen`, `\Flagged`) e
// mover (para a pasta da regra ou para a `\Trash`), na fila da conta, com o corpo do mover (`moveQueued`), nunca o
// `moveMessages` (enfileiraria de novo e travaria a conta). Falha deixa a mensagem na INBOX, com o "último erro" da regra
// no `<conta>.rules-state.json` do store; nunca vira estado de erro da conta. "Executar agora" em dois passos
// (`previewRule` devolve a contagem e um token; `runRule` só age com ele). E `pruneBodies`: os corpos que não são de
// nenhuma mensagem guardada saem depois de cada corte pelo teto, no sincronismo e ao abrir o app, sempre na fila da conta.
//
// Erro de conexão (N4) nunca derruba o app: a conta fica `error` com uma mensagem curta e as outras seguem. Usuário ou
// senha recusados não tentam de novo sozinhos (para o servidor não bloquear a conta); o resto tenta de novo em 1 min
// (IMAP) ou no próximo poll (POP3).
import { createHash, randomUUID } from 'node:crypto'
import type { ConnectionOptions } from 'node:tls'
import { z } from 'zod'
import {
  EMAIL_ACCOUNT_ID_PATTERN,
  EMAIL_ATTACH_MAX_BYTES,
  EMAIL_ATTACH_MAX_FILES,
  EMAIL_ATTACH_NAME_MAX,
  EMAIL_CLICK_TTL_MS,
  EMAIL_FOLDER_MESSAGES_MAX,
  EMAIL_FOLDER_NAME_MAX,
  EMAIL_FOLDER_PATH_MAX,
  EMAIL_FOLDER_REFRESH_MS,
  EMAIL_INBOX_MAILBOX,
  EMAIL_INBOX_MAX,
  EMAIL_MOVE_MAX,
  EMAIL_PROTECTED_SPECIAL_USE,
  EMAIL_RAW_MAX_BYTES,
  EMAIL_RECIPIENTS_MAX,
  EMAIL_SENT_MAILBOX,
  EMAIL_SENT_MAX,
  EMAIL_SUBJECT_MAX,
  EMAIL_TEXT_MAX,
  type EmailAccount,
  type EmailAccountState,
  type EmailAccountStatus,
  type EmailAddResult,
  type EmailAddress,
  type EmailAutoconfig,
  type EmailBody,
  type EmailBodyResult,
  type EmailFolderDeleteResult,
  type EmailFolderFailure,
  type EmailFolderNode,
  type EmailFolderPathResult,
  type EmailFoldersResult,
  type EmailMessage,
  type EmailMoveResult,
  type EmailOpenFolderResult,
  type EmailSendResult,
  type EmailAttachmentsResult,
  type EmailOutgoingAttachment,
  type EmailTestResult,
  isInbox,
} from '../../shared/email'
import { DEFAULT_EMAIL_SIGNATURE, type EmailSignature, type EmailSignatureResult } from '../../shared/email-signature'
import {
  EMAIL_RULE_TOKEN_TTL_MS,
  EMPTY_EMAIL_RULE_STATE,
  emailRuleListSchema,
  type EmailRule,
  type EmailRuleErrorCode,
  type EmailRulePreviewResult,
  type EmailRuleRunResult,
  type EmailRulesFailure,
  type EmailRulesGetResult,
  type EmailRulesSetResult,
  type EmailRuleState,
} from '../../shared/email-rules'
import type { SafeStorageLike } from '../secrets'
import { emailAddressSchema, emailIncomingSchema, emailNameSchema, emailServerSchema, emailSignatureSchema, emailUsernameSchema, type StoredEmailAccount } from '../settings/schema'
import type { SettingsStore } from '../settings/store'
import { addressDomain, autoconfigure, AUTOCONFIG_TIMEOUT_MS, type AutoconfigFetch } from './autoconfig'
import { capInbox, createEmailStore, type EmailAccountData, type EmailCachedFolder, type EmailStore } from './email-store'
import {
  connectImap,
  connectImapFolders,
  connectImapReader,
  ImapFolderError,
  messageIds,
  type ImapConnect,
  type ImapFolderConnect,
  type ImapFolderEntry,
  type ImapFolderSession,
  type ImapMessage,
  type ImapReaderConnect,
  type ImapSearchQuery,
  type ImapSession,
} from './imap-client'
import { connectPop3, Pop3Error, type Pop3Connect, type Pop3Session } from './pop3-client'
import { needsBody, planActions, ruleBody, type EmailRuleInput, type EmailRulePlan } from './rules'
import { createEmailSecrets } from './secrets'
import { sendSmtp, SmtpError, verifySmtp, type OutgoingMail, type SmtpSend, type SmtpVerify } from './smtp-client'

/**
 * Token de clique do "Enviar" (a regra do contrato 24, CA4, com guarda próprio: o do WhatsApp fica só com ele). O token
 * vale uma vez, só para a janela que o registrou e por 10 s; tentativa com um token registrado o gasta, mesmo recusada.
 */
export interface EmailClickGuard {
  register(senderId: number, token: unknown): void
  consume(senderId: number, token: unknown): boolean
  forget(senderId: number): void
}

const CLICK_TOKEN = /^[0-9a-f-]{36}$/

export function createEmailClickGuard(now: () => number = Date.now, ttlMs = EMAIL_CLICK_TTL_MS): EmailClickGuard {
  const tokens = new Map<string, { senderId: number; at: number }>()
  const used = new Set<string>()
  const sweep = (): void => {
    const limit = now() - ttlMs
    for (const [token, entry] of tokens) if (entry.at < limit) tokens.delete(token)
    if (used.size > 1000) used.clear()
  }
  return {
    register(senderId, token) {
      sweep()
      if (typeof token !== 'string' || !CLICK_TOKEN.test(token) || tokens.has(token) || used.has(token) || tokens.size >= 20) return
      tokens.set(token, { senderId, at: now() })
    },
    consume(senderId, token) {
      sweep()
      if (typeof token !== 'string') return false
      const entry = tokens.get(token)
      tokens.delete(token)
      if (entry) used.add(token)
      return entry !== undefined && entry.senderId === senderId && now() - entry.at <= ttlMs
    },
    forget(senderId) {
      for (const [token, entry] of tokens) if (entry.senderId === senderId) tokens.delete(token)
    },
  }
}

/** IMAP caído (ou servidor fora): nova tentativa em 1 min. */
export const EMAIL_RETRY_MS = 60_000

/** O que a tela mostra quando a conta falha. Nunca leva senha, endereço nem a resposta do servidor. */
export const EMAIL_FAILURES = {
  auth: 'Usuário ou senha recusados.',
  connection: 'Servidor fora do ar ou inacessível.',
  tls: 'Falha na conexão segura (TLS).',
  timeout: 'O servidor não respondeu a tempo.',
  secret: 'A senha guardada não abre neste Mac. Adicione a conta de novo.',
  closed: 'A conexão com o servidor caiu.',
  failed: 'Erro ao falar com o servidor.',
} as const
export type EmailFailure = keyof typeof EMAIL_FAILURES

const accountIdSchema = z.string().regex(EMAIL_ACCOUNT_ID_PATTERN)
const messageIdSchema = z.string().min(1).max(1000)
const headerIdSchema = z.string().regex(/^<[^<>\s]{1,250}>$/)
const addSchema = z
  .object({
    address: emailAddressSchema,
    password: z.string().min(1).max(1024),
    name: emailNameSchema.optional(),
    username: z.union([emailUsernameSchema, z.literal('')]).optional(),
    incoming: emailIncomingSchema,
    outgoing: emailServerSchema,
    deleteFromServer: z.boolean().optional(),
  })
  .strict()
const accountRequestSchema = z.object({ accountId: accountIdSchema }).strict()
const autoconfigSchema = z.object({ address: emailAddressSchema }).strict()
/** Contrato 52: o path de uma pasta, sem quebra de linha nem caractere nulo. */
const folderPathSchema = z
  .string()
  .min(1)
  .max(EMAIL_FOLDER_PATH_MAX)
  .refine((value) => !/[\r\n\0]/.test(value))
/** `mailbox` (contrato 52): uma pasta aberta, do que ficou guardado (nada vai ao servidor). */
const messagesSchema = z.object({ accountId: accountIdSchema, folder: z.enum(['inbox', 'sent']).optional(), mailbox: folderPathSchema.optional() }).strict()
const openFolderSchema = z.object({ accountId: accountIdSchema, path: folderPathSchema }).strict()
const folderWatchSchema = z.object({ accountId: accountIdSchema, path: folderPathSchema.nullable() }).strict().nullable()
const moveSchema = z
  .object({ accountId: accountIdSchema, fromPath: folderPathSchema, uids: z.array(z.number().int().positive().max(0xffffffff)).min(1).max(EMAIL_MOVE_MAX), toPath: folderPathSchema })
  .strict()
const folderCreateSchema = z.object({ accountId: accountIdSchema, parentPath: folderPathSchema.nullable(), name: z.string().max(EMAIL_FOLDER_PATH_MAX) }).strict()
const folderRenameSchema = z.object({ accountId: accountIdSchema, path: folderPathSchema, newName: z.string().max(EMAIL_FOLDER_PATH_MAX) }).strict()
const folderDeleteSchema = z.object({ accountId: accountIdSchema, path: folderPathSchema, force: z.boolean().optional() }).strict()
const messageRequestSchema = z.object({ accountId: accountIdSchema, id: messageIdSchema }).strict()
const markReadSchema = messageRequestSchema.extend({ seen: z.boolean() }).strict()
const signatureSetSchema = z.object({ accountId: accountIdSchema, signature: emailSignatureSchema }).strict()
/** Contrato 53: os pedidos das regras (a lista é conferida à parte, para o erro ser `invalid` e não uma exceção). */
const ruleIdSchema = z.string().min(1).max(64)
const rulesSetSchema = z.object({ accountId: accountIdSchema, rules: z.array(z.unknown()) }).strict()
const rulePreviewSchema = z.object({ accountId: accountIdSchema, ruleId: ruleIdSchema }).strict()
const ruleRunSchema = z.object({ accountId: accountIdSchema, ruleId: ruleIdSchema, token: z.string().min(1).max(100) }).strict()
/** Contrato 43: o nome do anexo, sem caminho nem caractere de controle. */
const attachmentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(EMAIL_ATTACH_NAME_MAX)
      .refine((value) => !/[\\/]/.test(value) && ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) && value !== '.' && value !== '..'),
    bytes: z.instanceof(Uint8Array),
  })
  .strict()
const sendSchema = z
  .object({
    accountId: accountIdSchema,
    to: z.array(emailAddressSchema).min(1).max(EMAIL_RECIPIENTS_MAX),
    cc: z.array(emailAddressSchema).max(EMAIL_RECIPIENTS_MAX).optional(),
    subject: z.string().max(EMAIL_SUBJECT_MAX).refine((value) => !/[\r\n]/.test(value)),
    text: z.string().max(EMAIL_TEXT_MAX),
    inReplyTo: headerIdSchema.optional(),
    attachments: z
      .array(attachmentSchema)
      .max(EMAIL_ATTACH_MAX_FILES)
      .refine((list) => list.reduce((total, item) => total + item.bytes.byteLength, 0) <= EMAIL_ATTACH_MAX_BYTES)
      .optional(),
    clickToken: z.string().max(100),
  })
  .strict()
/**
 * Contrato 51: o envio de uma tarefa agendada com "Pode enviar email" (sem token de clique, sem anexo, sem resposta).
 * As regras da permissão (conta, destinatários, teto, revogação, bloqueio, pausa) são conferidas antes, a cada envio,
 * em `schedules/email-send.ts`; aqui só o formato.
 */
const taskSendSchema = z
  .object({
    accountId: accountIdSchema,
    to: z.array(emailAddressSchema).min(1).max(EMAIL_RECIPIENTS_MAX),
    cc: z.array(emailAddressSchema).max(EMAIL_RECIPIENTS_MAX).optional(),
    bcc: z.array(emailAddressSchema).max(EMAIL_RECIPIENTS_MAX).optional(),
    subject: z.string().max(EMAIL_SUBJECT_MAX).refine((value) => !/[\r\n]/.test(value)),
    text: z.string().max(EMAIL_TEXT_MAX),
  })
  .strict()

/** O que sai pelo SMTP, já validado: o envio do clique e o da tarefa. */
interface Delivery {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  inReplyTo: string | undefined
  attachments: { name: string; bytes: Uint8Array }[]
}

/** O que sai do `mailparser`: cabeçalho e corpo. */
export interface ParsedEmail {
  subject: string
  date: number | null
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  body: EmailBody
}

export type EmailParse = (raw: Buffer) => Promise<ParsedEmail>

interface ParsedAddressList {
  value: { name: string; address?: string | undefined; group?: ParsedAddressList['value'] | undefined }[]
}

function flattenAddresses(input: ParsedAddressList | ParsedAddressList[] | undefined): EmailAddress[] {
  const lists = input === undefined ? [] : Array.isArray(input) ? input : [input]
  const out: EmailAddress[] = []
  const walk = (items: ParsedAddressList['value']): void => {
    for (const item of items) {
      if (item.group) walk(item.group)
      else if (item.address) out.push({ name: item.name ? item.name : null, address: item.address })
    }
  }
  for (const list of lists) walk(list.value)
  return out.slice(0, 100)
}

/** `mailparser` (carregado no primeiro uso): cabeçalho e corpo, sem guardar o conteúdo dos anexos. */
export const parseEmail: EmailParse = async (raw) => {
  const { simpleParser } = await import('mailparser')
  const parsed = await simpleParser(raw, { skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true })
  const references = parsed.references === undefined ? [] : (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).flatMap((value) => messageIds(value))
  return {
    subject: parsed.subject ?? '',
    date: parsed.date ? parsed.date.getTime() : null,
    from: flattenAddresses(parsed.from),
    to: flattenAddresses(parsed.to),
    cc: flattenAddresses(parsed.cc),
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ? (messageIds(parsed.inReplyTo)[0] ?? null) : null,
    references: references.slice(-50),
    body: {
      text: parsed.text ?? null,
      html: typeof parsed.html === 'string' ? parsed.html : null,
      // Nos limites do store: um nome de anexo enorme não impede a mensagem de entrar.
      attachments: parsed.attachments.slice(0, 500).map((item) => ({ filename: item.filename ? clip(item.filename, 1000) : null, contentType: clip(item.contentType, 300), size: item.size })),
    },
  }
}

/** Contrato 43: os anexos de uma mensagem, com o conteúdo, na mesma ordem de `EmailBody.attachments`. */
export type EmailAttachmentsParse = (raw: Buffer) => Promise<{ filename: string | null; contentType: string; content: Buffer }[]>

export const parseAttachments: EmailAttachmentsParse = async (raw) => {
  const { simpleParser } = await import('mailparser')
  const parsed = await simpleParser(raw, { skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true })
  return parsed.attachments.slice(0, 500).map((item) => ({ filename: item.filename ?? null, contentType: item.contentType, content: item.content }))
}

/** Nome de arquivo para salvar ou anexar: sem caminho, sem caractere de controle nem ponto no começo; vazio vira "anexo". */
export function safeAttachmentName(name: string | null, index: number): string {
  const clean = [...(name ?? '')]
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/[/\\:]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
  const value = clean || `anexo-${index + 1}`
  if (value.length <= EMAIL_ATTACH_NAME_MAX) return value
  const dot = value.lastIndexOf('.')
  const extension = dot > 0 && value.length - dot <= 12 ? value.slice(dot) : ''
  return `${value.slice(0, EMAIL_ATTACH_NAME_MAX - extension.length)}${extension}`
}

/** Erro de qualquer cliente no tipo curto da tela. */
export function failureOf(error: unknown): EmailFailure {
  if (error instanceof Pop3Error) return error.kind === 'auth' || error.kind === 'connection' || error.kind === 'tls' || error.kind === 'timeout' ? error.kind : 'failed'
  if (error instanceof SmtpError) return error.kind === 'auth' ? 'auth' : error.kind === 'connection' ? 'connection' : 'failed'
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; authenticationFailed?: unknown; tlsFailed?: unknown }) : {}
  if (record.authenticationFailed === true) return 'auth'
  // O `imapflow` marca a falha do TLS (handshake, certificado, STARTTLS) com `tlsFailed`.
  if (record.tlsFailed === true) return 'tls'
  const code = typeof record.code === 'string' ? record.code : ''
  if (code.includes('TLS') || code.startsWith('ERR_SSL') || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'tls'
  if (['ETIMEDOUT', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(code)) return 'timeout'
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE', 'NoConnection', 'EConnectionClosed', 'ClosedAfterConnectText', 'ClosedAfterConnectTLS'].includes(code)) return 'connection'
  return 'failed'
}

const clip = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value)
const clipAddresses = (list: EmailAddress[], max: number): EmailAddress[] =>
  list.slice(0, max).map((item) => ({ name: item.name === null ? null : clip(item.name, 500), address: clip(item.address, 500) }))

function fromImap(accountId: string, message: ImapMessage, mailbox: string = EMAIL_INBOX_MAILBOX): EmailMessage {
  return {
    id: String(message.uid),
    accountId,
    mailbox,
    uid: message.uid,
    seen: message.flags.includes('\\Seen'),
    flagged: message.flags.includes('\\Flagged'),
    answered: message.flags.includes('\\Answered'),
    from: clipAddresses(message.from, 100),
    to: clipAddresses(message.to, 500),
    cc: clipAddresses(message.cc, 500),
    subject: clip(message.subject, 10_000),
    date: message.date,
    messageId: message.messageId ? clip(message.messageId, 1000) : null,
    inReplyTo: message.inReplyTo ? clip(message.inReplyTo, 1000) : null,
    references: message.references.slice(-100),
  }
}

function fromParsed(accountId: string, id: string, parsed: ParsedEmail, now: number): EmailMessage {
  return {
    id,
    accountId,
    mailbox: EMAIL_INBOX_MAILBOX,
    uid: null,
    seen: false,
    flagged: false,
    answered: false,
    from: clipAddresses(parsed.from, 100),
    to: clipAddresses(parsed.to, 500),
    cc: clipAddresses(parsed.cc, 500),
    subject: clip(parsed.subject, 10_000),
    date: parsed.date ?? now,
    messageId: parsed.messageId ? clip(parsed.messageId, 1000) : null,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
  }
}

type EmailServerInput = z.infer<typeof emailServerSchema>

/**
 * Contrato 45 (CA7): o id de uma mensagem achada no servidor: `servidor:<UIDVALIDITY>:<UID>:<pasta>`. Os ids do cache são o
 * UID puro (INBOX), o UIDL (POP3) ou o Message-ID (`<…>`, enviados): este nunca se confunde com eles.
 */
export function serverMessageId(mailbox: string, uidValidity: string, uid: number): string {
  return `servidor:${uidValidity}:${uid}:${mailbox}`.slice(0, 1000)
}

/** Contrato 52: a pasta de um id de `serverMessageId`, ou `null` (id do cache da INBOX, do POP3 ou dos enviados). */
export function serverMessageMailbox(id: string): string | null {
  const match = /^servidor:[^:]*:\d+:([\s\S]+)$/.exec(id)
  return match ? (match[1] ?? null) : null
}

/** Contrato 45 (CA7): uma mensagem achada no servidor, com a pasta (o `id` dela é o de `serverMessageId`). */
export interface EmailServerFound {
  mailbox: string
  uidValidity: string
  /** `\Sent`, `\Trash`…, ou `null`. */
  specialUse: string | null
  message: EmailMessage
}

/** `pop3`: a conta não tem busca no servidor; `unavailable`: a conexão ou a busca falhou. */
export type EmailServerSearchResult = { ok: true; found: EmailServerFound[]; skippedFolders: number } | { ok: false; error: 'missing' | 'pop3' | 'unavailable' }

/** Pastas lidas numa busca no servidor (a INBOX e os enviados primeiro). */
export const EMAIL_SEARCH_FOLDERS_MAX = 30

const publicAccount = ({ password: _password, ...account }: StoredEmailAccount): EmailAccount => account

/**
 * Chave do corpo no store: a lista e o id (o id do enviado é o Message-ID). As da INBOX e dos enviados são as mesmas da
 * 0.15.0 (`inbox:` e `sent:`), para os corpos já baixados continuarem valendo; a de outra pasta aberta (contrato 52) leva
 * o id de `serverMessageId`, que já tem a pasta e o `UIDVALIDITY`.
 */
const bodyKey = (message: Pick<EmailMessage, 'mailbox' | 'id' | 'uid'>): string => `${isInbox(message) ? 'inbox' : message.uid === null ? 'sent' : 'box'}:${message.id}`

/** Contrato 52: a pasta não se renomeia nem se apaga (a INBOX, uma especial, ou uma que tem uma delas dentro). */
export function isProtectedFolder(entry: ImapFolderEntry, entries: readonly ImapFolderEntry[]): boolean {
  const special = (item: ImapFolderEntry): boolean => item.path.toUpperCase() === EMAIL_INBOX_MAILBOX || (item.specialUse !== null && (EMAIL_PROTECTED_SPECIAL_USE as readonly string[]).includes(item.specialUse))
  return special(entry) || descendants(entry, entries).some(special)
}

/** As pastas de dentro de uma pasta (em qualquer nível), pelo delimitador. */
function descendants(entry: Pick<ImapFolderEntry, 'path' | 'delimiter'>, entries: readonly ImapFolderEntry[]): ImapFolderEntry[] {
  if (!entry.delimiter) return []
  const prefix = `${entry.path}${entry.delimiter}`
  return entries.filter((item) => item.path.startsWith(prefix))
}

/** Contrato 52: a INBOX primeiro, o resto pelo nome. */
const folderOrder = (a: EmailFolderNode, b: EmailFolderNode): number =>
  Number(b.path.toUpperCase() === EMAIL_INBOX_MAILBOX) - Number(a.path.toUpperCase() === EMAIL_INBOX_MAILBOX) || a.name.localeCompare(b.name, 'pt-BR')

/** Contrato 52: o `LIST` em árvore, pelo delimitador de cada pasta; pasta cujo pai não veio no `LIST` fica na raiz. */
export function folderTree(entries: readonly ImapFolderEntry[]): EmailFolderNode[] {
  const nodes = new Map<string, EmailFolderNode>()
  for (const entry of entries) if (!nodes.has(entry.path)) nodes.set(entry.path, { path: entry.path, name: entry.name, delimiter: entry.delimiter, specialUse: entry.specialUse, noselect: entry.noselect, unseen: entry.unseen, total: entry.total, children: [] })
  const roots: EmailFolderNode[] = []
  for (const node of nodes.values()) {
    const cut = node.delimiter ? node.path.lastIndexOf(node.delimiter) : -1
    const parent = cut > 0 ? nodes.get(node.path.slice(0, cut)) : undefined
    ;(parent ?? { children: roots }).children.push(node)
  }
  const sort = (list: EmailFolderNode[]): EmailFolderNode[] => {
    list.sort(folderOrder)
    for (const node of list) sort(node.children)
    return list
  }
  return sort(roots)
}

/** Contrato 52: nome de pasta válido: 1 a 100 caracteres, sem o delimitador nem caractere de controle (CR, LF…). */
export function validFolderName(name: string, delimiter: string | null): boolean {
  if (name.length < 1 || name.length > EMAIL_FOLDER_NAME_MAX || name.trim() === '') return false
  if ([...name].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return false
  return !delimiter || !name.includes(delimiter)
}

const folderFailure = (error: EmailFolderFailure['error']): EmailFolderFailure => ({ ok: false, error })

export interface EmailServiceDeps {
  /** `userData/email`. */
  root: string
  /** O store em `root` (nos testes, um que falha ou atrasa de propósito). */
  store?: EmailStore
  settings: Pick<SettingsStore, 'get' | 'getEmailAccounts' | 'setEmailAccounts' | 'getEmailSignatures' | 'setEmailSignature' | 'getEmailRules' | 'setEmailRules'>
  safeStorage: SafeStorageLike
  /** ISPDB do autoconfig (no smoke e nos testes, um HTTP falso). */
  fetch: AutoconfigFetch
  imap?: ImapConnect
  /** Contrato 45 (CA7): a conexão só de leitura da busca do Assistente (no smoke e nos testes, o IMAP falso). */
  imapReader?: ImapReaderConnect
  /** Contrato 52: a conexão das pastas (listar, abrir, mover, criar, renomear, apagar). */
  imapFolders?: ImapFolderConnect
  /** Contrato 52: de quanto em quanto tempo a pasta aberta (fora a INBOX) é relida. */
  folderRefreshMs?: number
  pop3?: Pop3Connect
  smtp?: SmtpSend
  /** Contrato 43: o "Testar conexão" do envio (no smoke, um substituto). */
  smtpVerify?: SmtpVerify
  parse?: EmailParse
  /** Contrato 43: os anexos com o conteúdo (no teste, o `mailparser` de verdade também). */
  parseAttachments?: EmailAttachmentsParse
  /** Opções extras do TLS do POP3 e do IMAP/SMTP (nos testes, o certificado do servidor falso). */
  tls?: ConnectionOptions
  onStatus: (statuses: EmailAccountStatus[]) => void
  /**
   * Mensagem nova na INBOX (IDLE do IMAP, ou poll do POP3 depois do primeiro), já com as regras aplicadas (contrato 53):
   * `notify: false` quando uma regra pediu "não avisar" ou levou a mensagem à Lixeira.
   */
  onMessage: (message: EmailMessage, options: { notify: boolean }) => void
  /** A lista de uma conta mudou (sincronismo, lida, apagada, enviada): a tela relê. */
  onMessagesChanged?: (accountId: string) => void
  /** Só estados e tipos de erro: nunca senha, endereço ou texto de mensagem. */
  log?: (message: string) => void
  now?: () => number
  retryMs?: number
  autoconfigTimeoutMs?: number
}

export interface EmailService {
  /** Ao abrir o app: as contas gravadas conectam. */
  init(): Promise<void>
  accounts(): EmailAccountStatus[]
  autoconfig(request: unknown): Promise<EmailAutoconfig | null>
  addAccount(request: unknown): Promise<EmailAddResult>
  /** Contrato 43: "Testar conexão" com os dados do formulário: recebimento e envio, sem gravar nada. */
  test(request: unknown): Promise<EmailTestResult>
  removeAccount(request: unknown): Promise<boolean>
  /**
   * INBOX (padrão) ou enviados, da mais nova para a mais antiga; com `mailbox` (contrato 52), a pasta aberta como ficou
   * guardada. Só o store, nada vai ao servidor.
   */
  messages(request: unknown): Promise<EmailMessage[]>
  /**
   * Contrato 45: o cache local de cada conta (a INBOX e os enviados guardados), para o Assistente. Só leitura do store:
   * nada vai ao servidor.
   */
  cached(): Promise<{ status: EmailAccountStatus; inbox: EmailMessage[]; sent: EmailMessage[] }[]>
  /** Contrato 45: o corpo de uma mensagem se já foi baixado; `null` se não (nunca baixa). */
  cachedBody(accountId: string, message: Pick<EmailMessage, 'mailbox' | 'id' | 'uid'>): Promise<EmailBody | null>
  /**
   * Contrato 45 (CA7): `UID SEARCH` no servidor IMAP, em todas as pastas do `LIST` abertas só para leitura (`EXAMINE`),
   * as `limit` mais recentes no total. Nada é gravado no cache e nenhuma flag muda. POP3 não tem busca no servidor.
   */
  searchServer(accountId: string, query: ImapSearchQuery, limit: number): Promise<EmailServerSearchResult>
  /** Contrato 45 (CA7): o corpo de uma mensagem do servidor por `BODY.PEEK[]`, sem gravar no cache. */
  peekServer(accountId: string, mailbox: string, uid: number): Promise<EmailBodyResult>
  /** Corpo: do store; senão (IMAP) baixa, passa pelo `mailparser` e guarda. */
  body(request: unknown): Promise<EmailBodyResult>
  markRead(request: unknown): Promise<boolean>
  remove(request: unknown): Promise<boolean>
  /** O preload registrou um clique de "Enviar" desta janela. */
  registerClick(senderId: number, token: unknown): void
  /** Só com o token de clique (uso único, 10 s) da mesma janela. */
  send(senderId: number, request: unknown): Promise<EmailSendResult>
  /**
   * Contrato 51: o envio sem clique de uma tarefa agendada com "Pode enviar email", depois das regras da permissão
   * (`schedules/email-send.ts`). Caminho interno do main: nunca registrado no IPC; só a montagem das automações em
   * `index.ts` chama (teste estático em `email-automations.test.ts`).
   */
  sendForTask(request: unknown): Promise<EmailSendResult>
  forgetSender(senderId: number): void
  /** Contrato 43 (CA8): um anexo recebido, com os bytes (do servidor no IMAP, da mensagem guardada no POP3 e nos enviados). */
  attachment(request: unknown): Promise<{ ok: true; name: string; bytes: Uint8Array } | { ok: false; error: 'not-found' | 'unavailable' }>
  /** Contrato 43 (CA9): os anexos para o "Encaminhar", nos limites do envio (os que passam ficam em `skipped`). */
  attachments(request: unknown): Promise<EmailAttachmentsResult>
  /** POP3: busca agora (o mesmo do relógio). */
  poll(accountId: string): Promise<void>
  /** Contrato 52 (CA2): as pastas em árvore, com as contagens; guardadas na memória até mudar algo ou reconectar. */
  listFolders(accountId: string): Promise<EmailFoldersResult>
  /** Contrato 52 (CA4): `MOVE` de até 500 UIDs; erro do servidor não tira nada do store. */
  moveMessages(accountId: string, fromPath: string, uids: readonly number[], toPath: string): Promise<EmailMoveResult>
  /** Contrato 52 (CA5): pasta nova na raiz (`parentPath` `null`) ou dentro de outra. */
  createFolder(accountId: string, parentPath: string | null, name: string): Promise<EmailFolderPathResult>
  renameFolder(accountId: string, path: string, newName: string): Promise<EmailFolderPathResult>
  /** Pasta com mensagens ou subpastas só sai com `force`. */
  deleteFolder(accountId: string, path: string, force: boolean): Promise<EmailFolderDeleteResult>
  /** Contrato 52 (CA3): as 200 mais recentes da pasta, gravadas no store; a INBOX vem do store (ela segue no IDLE). */
  openFolder(accountId: string, path: string): Promise<EmailOpenFolderResult>
  /** Os mesmos, pelos pedidos do IPC (validados aqui). */
  folders(request: unknown): Promise<EmailFoldersResult>
  open(request: unknown): Promise<EmailOpenFolderResult>
  move(request: unknown): Promise<EmailMoveResult>
  folderCreate(request: unknown): Promise<EmailFolderPathResult>
  folderRename(request: unknown): Promise<EmailFolderPathResult>
  folderDelete(request: unknown): Promise<EmailFolderDeleteResult>
  /** A pasta aberta na tela desta janela (só uma por janela): fora a INBOX, relida a cada 5 min; `null` para. */
  watchFolder(senderId: number, request: unknown): void
  /** Contrato 54 (CA2): a assinatura da conta (a padrão, vazia e com os dois interruptores ligados, se nunca foi gravada). */
  signatureGet(request: unknown): Promise<EmailSignatureResult>
  signatureSet(request: unknown): Promise<EmailSignatureResult>
  /** Contrato 53 (CA12): as regras da conta, na ordem, com o estado de cada uma. */
  rulesGet(request: unknown): Promise<EmailRulesGetResult>
  /**
   * A lista inteira das regras da conta (CA9: confere POP3 e, nas regras ligadas novas ou com as ações mudadas, a pasta
   * e a Lixeira antes de gravar; apagar sem Lixeira grava com o erro na regra).
   */
  rulesSet(request: unknown): Promise<EmailRulesSetResult>
  rulesPreview(request: unknown): Promise<EmailRulePreviewResult>
  rulesRun(request: unknown): Promise<EmailRuleRunResult>
  /** Contrato 53 (CA10): "Executar agora", primeiro passo: só aquela regra nas mensagens da INBOX guardada. Nada muda. */
  previewRule(accountId: string, ruleId: string): Promise<EmailRulePreviewResult>
  /** Segundo passo: só com o token do preview (uso único, 2 min, a mesma regra e as mesmas mensagens). */
  runRule(accountId: string, ruleId: string, token: string): Promise<EmailRuleRunResult>
  /** Sair do app: fecha as conexões e para os relógios. */
  dispose(): Promise<void>
}

interface Runtime {
  account: StoredEmailAccount
  state: EmailAccountState
  error: string | null
  session: ImapSession | null
  timer: ReturnType<typeof setTimeout> | null
  /** Sobe a cada reconexão e ao remover: o resultado de uma tentativa antiga não vale mais. */
  generation: number
  /** Busca de mensagens novas (IMAP) ou poll (POP3) em fila. */
  queue: Promise<unknown>
  removed: boolean
  /** Contrato 52: a pasta dos enviados (`EmailAccountStatus.sentMailbox`). */
  sentMailbox: string
  /** Contrato 52: Message-IDs que chegaram à INBOX por "Mover" (até quando): o IDLE não os avisa como novos. */
  movedIn: Map<string, number>
  /** Contrato 52: a conexão das pastas teve a senha recusada; nenhum pedido de pastas tenta de novo até reconectar. */
  foldersAuthRefused: boolean
}

export function createEmailService(deps: EmailServiceDeps): EmailService {
  const now = deps.now ?? Date.now
  const imap = deps.imap ?? connectImap
  const imapReader = deps.imapReader ?? connectImapReader
  const imapFolders = deps.imapFolders ?? connectImapFolders
  const folderRefreshMs = deps.folderRefreshMs ?? EMAIL_FOLDER_REFRESH_MS
  const pop3 = deps.pop3 ?? connectPop3
  const smtp = deps.smtp ?? sendSmtp
  const smtpVerify = deps.smtpVerify ?? verifySmtp
  const parse = deps.parse ?? parseEmail
  const readAttachments = deps.parseAttachments ?? parseAttachments
  const retryMs = deps.retryMs ?? EMAIL_RETRY_MS
  const secrets = createEmailSecrets(deps.safeStorage)
  const store: EmailStore = deps.store ?? createEmailStore(deps.root)
  const guard = createEmailClickGuard(now)
  const runtimes = new Map<string, Runtime>()
  /** Adicionar e remover conta leem e gravam a lista inteira: um de cada vez, para nenhum perder a conta do outro. */
  let accountsQueue: Promise<unknown> = Promise.resolve()
  const accountsSerial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = accountsQueue.then(task, task)
    accountsQueue = run.catch(() => undefined)
    return run
  }
  const bodyRequests = new Map<string, Promise<EmailBodyResult>>()
  /** Contrato 52: o `LIST` de cada conta, até mover, criar, renomear, apagar ou reconectar. */
  const folderCache = new Map<string, ImapFolderEntry[]>()
  /** Contrato 52: a pasta aberta relida de cada janela (pelo id do `webContents`). */
  const folderWatches = new Map<number, { accountId: string; path: string; timer: ReturnType<typeof setInterval>; failures: number }>()
  /** Contrato 53 (CA10): os tokens do "Executar agora" (uso único, 2 min), presos à conta, à regra e às mensagens. */
  const ruleTokens = new Map<string, { accountId: string; ruleId: string; hash: string; ids: string[]; at: number }>()
  let disposed = false

  const log = (message: string): void => deps.log?.(`[email] ${message}`)
  /** Nos logs, só o começo do id da conta. */
  const tag = (rt: Runtime): string => `conta ${rt.account.id.slice(0, 8)}`
  const statusOf = (rt: Runtime): EmailAccountStatus => ({ account: publicAccount(rt.account), state: rt.state, error: rt.error, sentMailbox: rt.sentMailbox })
  const statuses = (): EmailAccountStatus[] => [...runtimes.values()].map(statusOf)
  const announce = (): void => {
    if (!disposed) deps.onStatus(statuses())
  }
  const changed = (accountId: string): void => {
    if (!disposed) deps.onMessagesChanged?.(accountId)
  }
  const live = (rt: Runtime, generation: number): boolean => !disposed && !rt.removed && rt.generation === generation

  function setState(rt: Runtime, state: EmailAccountState, error: string | null): void {
    rt.state = state
    rt.error = error
    announce()
  }

  function enqueue<T>(rt: Runtime, task: () => Promise<T>): Promise<T> {
    const run = rt.queue.then(task, task)
    rt.queue = run.catch(() => undefined)
    return run
  }

  function schedule(rt: Runtime, ms: number): void {
    if (rt.timer) clearTimeout(rt.timer)
    if (disposed || rt.removed) return
    rt.timer = setTimeout(() => {
      rt.timer = null
      void connect(rt)
    }, ms)
    rt.timer.unref?.()
  }

  /** A tentativa falhou: estado `error` e, se não foi a senha, nova tentativa mais tarde. */
  function fail(rt: Runtime, error: unknown, generation: number, retryIn: number): void {
    if (!live(rt, generation)) return
    const failure = error === 'closed' || error === 'secret' ? error : failureOf(error)
    log(`${tag(rt)}: falhou (${failure})`)
    setState(rt, 'error', EMAIL_FAILURES[failure])
    if (failure !== 'auth' && failure !== 'secret') schedule(rt, retryIn)
  }

  const serverConfig = (rt: Runtime, pass: string, server: StoredEmailAccount['outgoing']) => ({
    host: server.host,
    port: server.port,
    security: server.security,
    user: rt.account.username,
    pass,
    ...(deps.tls ? { tls: deps.tls } : {}),
  })

  async function syncInbox(rt: Runtime, session: ImapSession, generation: number): Promise<void> {
    const id = rt.account.id
    const list = await session.recent(EMAIL_INBOX_MAX)
    // Conta removida (ou reconectada) no meio: nada é regravado em `userData/email/`.
    if (!live(rt, generation)) return
    let reset = false
    const data = await store.update(id, (current) => {
      reset = current.uidValidity !== null && current.uidValidity !== session.uidValidity
      return { ...current, uidValidity: session.uidValidity, inbox: capInbox(list.map((message) => fromImap(id, message))) }
    })
    rt.sentMailbox = data.sentMailbox
    if (reset && live(rt, generation)) await store.clearBodies(id)
    // Contrato 53 (CA11): o que saiu da INBOX (pelo teto ou do servidor) não deixa o corpo para trás.
    if (live(rt, generation)) await pruneAccount(rt)
    changed(id)
  }

  /** IDLE avisou: as mensagens com UID acima da maior guardada. */
  async function fetchNew(rt: Runtime, session: ImapSession, generation: number): Promise<void> {
    if (!live(rt, generation) || rt.session !== session) return
    const id = rt.account.id
    const data = await store.read(id)
    const lastUid = data.inbox.reduce((max, message) => Math.max(max, message.uid ?? 0), 0)
    const fresh = (await session.since(lastUid)).slice(-EMAIL_INBOX_MAX)
    const known = new Set(data.inbox.map((message) => message.id))
    const added = fresh.map((message) => fromImap(id, message)).filter((message) => !known.has(message.id))
    if (added.length === 0 || !live(rt, generation)) return
    let capped = false
    await store.update(id, (current) => {
      const merged = [...added, ...current.inbox.filter((message) => !added.some((item) => item.id === message.id))]
      capped = merged.length > EMAIL_INBOX_MAX
      return { ...current, inbox: capInbox(merged) }
    })
    // Contrato 52: o que entrou na INBOX por "Mover" não é email novo.
    const at = now()
    for (const [key, until] of rt.movedIn) if (until < at) rt.movedIn.delete(key)
    const fresh2 = added.filter((message) => !(message.messageId !== null && rt.movedIn.has(message.messageId)))
    log(`${tag(rt)}: ${added.length} mensagem(ns) nova(s)`)
    // Contrato 53: sem regra ligada, o caminho de sempre (nenhuma ida a mais ao servidor).
    const rules = fresh2.length > 0 ? await enabledRules(id) : []
    if (rules.length === 0) {
      for (const message of fresh2) if (!disposed) deps.onMessage(message, { notify: true })
    } else {
      const delivered = await applyRules(rt, session, fresh2, rules)
      for (const item of delivered) if (!disposed && live(rt, generation)) deps.onMessage(item.message, { notify: item.notify })
    }
    if (capped && live(rt, generation)) await pruneAccount(rt)
    changed(id)
  }

  async function connectImapAccount(rt: Runtime, pass: string, generation: number): Promise<void> {
    let session: ImapSession
    try {
      session = await imap(serverConfig(rt, pass, rt.account.incoming))
    } catch (error) {
      fail(rt, error, generation, retryMs)
      return
    }
    if (!live(rt, generation)) {
      void session.close().catch(() => undefined)
      return
    }
    rt.session = session
    session.onClose(() => {
      if (rt.session !== session) return
      rt.session = null
      fail(rt, 'closed', generation, retryMs)
    })
    session.onNew(() => {
      void enqueue(rt, () => fetchNew(rt, session, generation)).catch((error: unknown) => log(`${tag(rt)}: mensagem nova não lida (${failureOf(error)})`))
    })
    try {
      await enqueue(rt, () => syncInbox(rt, session, generation))
    } catch (error) {
      rt.session = null
      void session.close().catch(() => undefined)
      fail(rt, error, generation, retryMs)
      return
    }
    if (!live(rt, generation)) return
    // Contrato 52: os enviados guardados ficam na pasta `\\Sent` do servidor (sem ela, `Sent`).
    if (session.sentPath) {
      try {
        await useSentMailbox(rt, (await session.sentPath()) ?? EMAIL_SENT_MAILBOX)
      } catch (error) {
        log(`${tag(rt)}: pasta de enviados não lida (${failureOf(error)})`)
      }
    }
    if (!live(rt, generation)) return
    log(`${tag(rt)}: IMAP conectado`)
    setState(rt, 'connected', null)
  }

  async function pollPop3(rt: Runtime, pass: string, generation: number): Promise<void> {
    const id = rt.account.id
    const retry = async (): Promise<number> => ((await deps.settings.get().catch(() => null))?.emailPollMinutes ?? 5) * 60_000
    let session: Pop3Session | null = null
    const added: EmailMessage[] = []
    let firstPoll = false
    let capped = false
    try {
      session = await pop3(serverConfig(rt, pass, rt.account.incoming))
      const list = await session.uidl()
      const data = await store.read(id)
      firstPoll = !data.polled
      const seen = new Set(data.seenUidls)
      const fresh = [...list].filter(([, uidl]) => !seen.has(uidl)).sort((a, b) => a[0] - b[0])
      // Primeiro poll: só as 200 mais novas são baixadas; as mais antigas ficam vistas (no servidor, sem aviso).
      const skipped = fresh.slice(0, Math.max(0, fresh.length - EMAIL_INBOX_MAX)).map(([, uidl]) => uidl)
      const wanted = fresh.slice(-EMAIL_INBOX_MAX)
      const sizes = wanted.length > 0 ? await session.sizes() : new Map<number, number>()
      /** Grava o UIDL como visto (e a mensagem, se veio) logo em seguida: uma falha adiante não desfaz o que já entrou. */
      const record = async (uidls: string[], message: EmailMessage | null): Promise<void> => {
        if (!live(rt, generation)) throw new Error('conta removida')
        await store.update(id, (current) => {
          const merged = message ? [message, ...current.inbox.filter((item) => item.id !== message.id)] : current.inbox
          if (merged.length > EMAIL_INBOX_MAX) capped = true
          return { ...current, seenUidls: [...current.seenUidls.filter((uidl) => !uidls.includes(uidl)), ...uidls].slice(-20_000), inbox: capInbox(merged) }
        })
      }
      if (skipped.length > 0) await record(skipped, null)
      for (const [number, uidl] of wanted) {
        // Grande demais: nem é baixada; fica vista (e no servidor) para não travar os polls seguintes.
        if ((sizes.get(number) ?? 0) > EMAIL_RAW_MAX_BYTES) {
          log(`${tag(rt)}: mensagem POP3 grande demais, pulada`)
          await record([uidl], null)
          continue
        }
        const raw = await session.retr(number)
        let message: EmailMessage
        try {
          const parsed = await parse(raw)
          message = fromParsed(id, uidl, parsed, now())
          if (!live(rt, generation)) throw new Error('conta removida')
          await store.setBody(id, bodyKey(message), parsed.body)
          // Contrato 43: a mensagem inteira fica guardada (o POP3 pode apagar do servidor): os anexos saem dela depois.
          await store.setRaw(id, bodyKey(message), raw)
        } catch (error) {
          if (!live(rt, generation)) throw error
          // Mensagem que não se lê (MIME quebrado, campo fora do limite): pulada e vista, as outras seguem.
          log(`${tag(rt)}: mensagem POP3 ilegível, pulada (${failureOf(error)})`)
          await record([uidl], null)
          continue
        }
        await record([uidl], message)
        added.push(message)
        if (rt.account.deleteFromServer) await session.dele(number)
      }
      await session.quit()
      session = null
      if (!live(rt, generation)) return
      // Os UIDLs do servidor agora: os que saíram dele não ficam lembrados para sempre.
      const onServer = new Set(list.values())
      await store.update(id, (current) => ({ ...current, polled: true, seenUidls: current.seenUidls.filter((uidl) => onServer.has(uidl)) }))
      await announceAdded()
      if (capped && live(rt, generation)) await pruneAccount(rt)
      setState(rt, 'connected', null)
      schedule(rt, await retry())
    } catch (error) {
      session?.close()
      // O que já foi gravado antes da falha aparece na tela.
      if (live(rt, generation)) await announceAdded().catch((announceError: unknown) => log(`${tag(rt)}: regras não aplicadas (${failureOf(announceError)})`))
      fail(rt, error, generation, await retry())
    }

    async function announceAdded(): Promise<void> {
      if (added.length === 0) return
      log(`${tag(rt)}: ${added.length} mensagem(ns) baixada(s) pelo POP3`)
      // Contrato 53: as regras só no que vira aviso (o primeiro poll não avisa nem aplica regra).
      const rules = firstPoll ? [] : await enabledRules(id)
      if (rules.length === 0) {
        if (!firstPoll) for (const message of added) if (!disposed) deps.onMessage(message, { notify: true })
      } else {
        const delivered = await applyRules(rt, null, added, rules)
        for (const item of delivered) if (!disposed && live(rt, generation)) deps.onMessage(item.message, { notify: item.notify })
      }
      changed(id)
    }
  }

  async function connect(rt: Runtime): Promise<void> {
    if (disposed || rt.removed) return
    if (rt.timer) clearTimeout(rt.timer)
    rt.timer = null
    folderCache.delete(rt.account.id)
    rt.foldersAuthRefused = false
    if (rt.account.incoming.protocol === 'pop3') {
      // Um poll por vez: o seguinte espera o anterior terminar e gravar.
      await enqueue(rt, async () => {
        if (disposed || rt.removed) return
        const generation = ++rt.generation
        // Cada poll não pisca "conectando" numa conta que já está bem.
        if (rt.state !== 'connected') setState(rt, 'connecting', null)
        const pass = secrets.open(rt.account.password)
        if (pass === null) fail(rt, 'secret', generation, retryMs)
        else await pollPop3(rt, pass, generation)
      })
      return
    }
    const generation = ++rt.generation
    const previous = rt.session
    rt.session = null
    if (previous) void previous.close().catch(() => undefined)
    setState(rt, 'connecting', null)
    const pass = secrets.open(rt.account.password)
    if (pass === null) {
      fail(rt, 'secret', generation, retryMs)
      return
    }
    await connectImapAccount(rt, pass, generation)
  }

  function runtime(account: StoredEmailAccount): Runtime {
    return { account, state: 'offline', error: null, session: null, timer: null, generation: 0, queue: Promise.resolve(), removed: false, sentMailbox: EMAIL_SENT_MAILBOX, movedIn: new Map(), foldersAuthRefused: false }
  }

  /** A mensagem guardada; com `folders` (contrato 52), também nas outras pastas abertas (corpo e anexos). */
  async function findMessage(accountId: string, id: string, folders = false): Promise<{ data: EmailAccountData; message: EmailMessage } | null> {
    const data = await store.read(accountId)
    let message = data.inbox.find((item) => item.id === id) ?? data.sent.find((item) => item.id === id)
    const mailbox = folders && !message ? serverMessageMailbox(id) : null
    if (mailbox !== null) message = (await store.folder(accountId, mailbox))?.messages.find((item) => item.id === id)
    return message ? { data, message } : null
  }

  /**
   * A mensagem inteira do servidor: a da INBOX pela conexão do IDLE; a de outra pasta (contrato 52) por `BODY.PEEK[]`
   * numa conexão só de leitura (não marca como lida). `unavailable`: sem conexão.
   */
  async function serverSource(rt: Runtime, message: EmailMessage & { uid: number }): Promise<Buffer | 'too-big' | 'unavailable' | null> {
    if (isInbox(message)) return rt.session ? rt.session.source(message.uid) : 'unavailable'
    const pass = secrets.open(rt.account.password)
    if (pass === null) return 'unavailable'
    const reader = await imapReader(serverConfig(rt, pass, rt.account.incoming))
    try {
      return await reader.peek(message.mailbox, message.uid)
    } finally {
      await reader.close().catch(() => undefined)
    }
  }

  async function downloadBody(rt: Runtime, message: EmailMessage): Promise<EmailBodyResult> {
    const cached = await store.body(rt.account.id, bodyKey(message))
    if (cached) return { ok: true, body: cached }
    if (message.uid === null) return { ok: false, error: 'not-found' }
    const raw = await serverSource(rt, { ...message, uid: message.uid })
    if (raw === 'unavailable') return { ok: false, error: 'unavailable' }
    if (raw === 'too-big') return { ok: false, error: 'too-big' }
    if (raw === null) return { ok: false, error: 'not-found' }
    const parsed = await parse(raw)
    if (!rt.removed) await store.setBody(rt.account.id, bodyKey(message), parsed.body)
    return { ok: true, body: parsed.body }
  }

  /** A mensagem inteira: a guardada (POP3, enviados) ou, no IMAP, pedida de novo ao servidor. */
  async function rawOf(rt: Runtime, message: EmailMessage): Promise<Buffer | 'not-found' | 'unavailable'> {
    const saved = await store.raw(rt.account.id, bodyKey(message))
    if (saved) return saved
    if (message.uid === null) return 'not-found'
    const raw = await serverSource(rt, { ...message, uid: message.uid })
    if (raw === 'too-big' || raw === 'unavailable') return 'unavailable'
    return raw ?? 'not-found'
  }

  async function attachmentsOf(request: unknown): Promise<{ ok: true; list: Awaited<ReturnType<EmailAttachmentsParse>> } | { ok: false; error: 'not-found' | 'unavailable' }> {
    const parsed = messageRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'not-found' }
    const rt = runtimes.get(parsed.data.accountId)
    const found = rt ? await findMessage(parsed.data.accountId, parsed.data.id, true) : null
    if (!rt || !found) return { ok: false, error: 'not-found' }
    try {
      const raw = await rawOf(rt, found.message)
      if (typeof raw === 'string') return { ok: false, error: raw }
      return { ok: true, list: await readAttachments(raw) }
    } catch (error) {
      log(`${tag(rt)}: anexos não lidos (${failureOf(error)})`)
      return { ok: false, error: 'unavailable' }
    }
  }

  /** O envio já validado (o do clique ou o da tarefa): SMTP, a cópia em Enviados no app e o `APPEND` no IMAP. */
  async function deliver(delivery: Delivery, sentLog: string): Promise<EmailSendResult> {
    const { accountId, to, cc, bcc, subject, text, inReplyTo, attachments } = delivery
    const rt = runtimes.get(accountId)
    const pass = rt ? secrets.open(rt.account.password) : null
    if (!rt || pass === null) return { ok: false, error: 'account' }
    const domain = addressDomain(rt.account.address) ?? 'localhost'
    const messageId = `<${randomUUID()}@${domain}>`
    const data = await store.read(accountId)
    const parent = inReplyTo ? data.inbox.find((item) => item.messageId === inReplyTo) : undefined
    // References: as da mensagem respondida e o Message-ID dela por último (RFC 5322, 3.6.4).
    const references = inReplyTo ? [...(parent?.references ?? []).filter((value) => value !== inReplyTo), inReplyTo].slice(-50) : []
    const date = now()
    const mail: OutgoingMail = { from: { name: rt.account.name, address: rt.account.address }, to, cc, ...(bcc.length > 0 ? { bcc } : {}), subject, text, attachments, messageId, inReplyTo: inReplyTo ?? null, references, date: new Date(date) }
    let bytes: Buffer
    try {
      bytes = await smtp(serverConfig(rt, pass, rt.account.outgoing), mail)
    } catch (error) {
      const kind = error instanceof SmtpError ? error.kind : 'failed'
      log(`${tag(rt)}: envio falhou (${kind})`)
      return { ok: false, error: kind }
    }
    log(`${tag(rt)}: ${sentLog}`)
    const sent: EmailMessage = {
      id: messageId,
      accountId,
      mailbox: rt.sentMailbox,
      uid: null,
      seen: true,
      flagged: false,
      answered: false,
      from: [{ name: rt.account.name, address: rt.account.address }],
      to: to.map((address) => ({ name: null, address })),
      cc: cc.map((address) => ({ name: null, address })),
      subject,
      date,
      messageId,
      inReplyTo: inReplyTo ?? null,
      references,
    }
    // O envio já saiu: falhar ao guardar ou no APPEND não vira erro para a tela.
    try {
      if (rt.removed) throw new Error('conta removida')
      let sentCapped = false
      await store.update(accountId, (current) => {
        sentCapped = current.sent.length + 1 > EMAIL_SENT_MAX
        return {
        ...current,
        sent: [{ ...sent, mailbox: current.sentMailbox }, ...current.sent].slice(0, EMAIL_SENT_MAX),
        inbox: parent ? current.inbox.map((item) => (item.id === parent.id ? { ...item, answered: true } : item)) : current.inbox,
        }
      })
      await store.setBody(accountId, bodyKey(sent), { text, html: null, attachments: attachments.map((item) => ({ filename: item.name, contentType: 'application/octet-stream', size: item.bytes.byteLength })) })
      // Contrato 43: os bytes enviados, para baixar ou encaminhar os anexos depois.
      if (attachments.length > 0) await store.setRaw(accountId, bodyKey(sent), bytes)
      // Contrato 53 (CA11): o enviado mais antigo saiu pelo teto; o corpo e o `.eml` dele também.
      if (sentCapped) void enqueue(rt, () => pruneAccount(rt))
    } catch (error) {
      log(`${tag(rt)}: enviado não guardado (${failureOf(error)})`)
    }
    if (rt.account.incoming.protocol === 'imap') {
      const session = rt.session
      if (!session) log(`${tag(rt)}: enviado fora da pasta de enviados (IMAP desconectado)`)
      else
        await session.appendSent(bytes).then(
          (ok) => {
            if (!ok) log(`${tag(rt)}: servidor sem pasta de enviados`)
          },
          (error: unknown) => log(`${tag(rt)}: APPEND nos enviados falhou (${failureOf(error)})`),
        )
    }
    changed(accountId)
    return { ok: true, messageId }
  }

  /** Contrato 52: os enviados guardados passam a dizer a pasta de enviados do servidor (o store e o estado da conta). */
  async function useSentMailbox(rt: Runtime, path: string): Promise<void> {
    if (rt.removed) return
    const data = await store.update(rt.account.id, (current) =>
      current.sentMailbox === path ? current : { ...current, sentMailbox: path, sent: current.sent.map((message) => ({ ...message, mailbox: path })) },
    )
    if (rt.sentMailbox === data.sentMailbox) return
    rt.sentMailbox = data.sentMailbox
    announce()
    changed(rt.account.id)
  }

  /** Conta IMAP pronta para um pedido de pastas, ou a falha (`missing`, `pop3`, `invalid`). */
  function imapRuntime(accountId: string): Runtime | EmailFolderFailure {
    if (!EMAIL_ACCOUNT_ID_PATTERN.test(accountId)) return folderFailure('invalid')
    const rt = runtimes.get(accountId)
    if (!rt || rt.removed) return folderFailure('missing')
    if (rt.account.incoming.protocol !== 'imap') return folderFailure('pop3')
    return rt
  }

  /**
   * Um pedido numa conexão das pastas, aberta e fechada aqui. Sem senha ou sem conexão: `unavailable`; o servidor
   * recusou o comando: `server`.
   */
  async function withFolders<T>(rt: Runtime, what: string, task: (session: ImapFolderSession) => Promise<T>): Promise<T | EmailFolderFailure> {
    // Senha recusada (pela conexão da INBOX ou pela das pastas): nenhum login novo até reconectar, para o servidor não
    // bloquear a conta.
    if (rt.foldersAuthRefused || (rt.state === 'error' && (rt.error === EMAIL_FAILURES.auth || rt.error === EMAIL_FAILURES.secret))) return folderFailure('unavailable')
    const pass = secrets.open(rt.account.password)
    if (pass === null) return folderFailure('unavailable')
    let session: ImapFolderSession
    try {
      session = await imapFolders(serverConfig(rt, pass, rt.account.incoming))
    } catch (error) {
      const failure = failureOf(error)
      if (failure === 'auth') rt.foldersAuthRefused = true
      log(`${tag(rt)}: ${what}: sem conexão (${failure})`)
      return folderFailure('unavailable')
    }
    try {
      return await task(session)
    } catch (error) {
      if (error instanceof ImapFolderError) {
        log(`${tag(rt)}: ${what}: não feito (${error.kind})`)
        return folderFailure(error.kind === 'unsupported' ? 'unsupported' : 'invalid')
      }
      log(`${tag(rt)}: ${what}: recusado pelo servidor (${failureOf(error)})`)
      return folderFailure('server')
    } finally {
      await session.close().catch(() => undefined)
    }
  }

  const isFailure = (value: unknown): value is EmailFolderFailure => typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false

  /** O `LIST` da conta (o guardado, ou pedido agora); aproveita para saber a pasta de enviados. */
  async function folderEntries(rt: Runtime): Promise<ImapFolderEntry[] | EmailFolderFailure> {
    const cached = folderCache.get(rt.account.id)
    if (cached) return cached
    const generation = rt.generation
    const entries = await withFolders(rt, 'LIST', (session) => session.list())
    if (isFailure(entries)) return entries
    if (rt.removed) return folderFailure('missing')
    if (rt.generation === generation) folderCache.set(rt.account.id, entries)
    const sent = entries.find((entry) => entry.specialUse === '\\Sent' && !entry.noselect)
    if (sent) await useSentMailbox(rt, sent.path).catch(() => undefined)
    return entries
  }

  /** Mudou algo nas pastas: o `LIST` guardado não vale mais e a tela relê. */
  function foldersChanged(rt: Runtime): void {
    folderCache.delete(rt.account.id)
    changed(rt.account.id)
  }

  /** POP3: só a Caixa de Entrada e os enviados do app, contados no store. */
  async function pop3Folders(rt: Runtime): Promise<EmailFolderNode[]> {
    const data = await store.read(rt.account.id)
    const node = (path: string, specialUse: string | null, list: EmailMessage[]): EmailFolderNode => ({ path, name: path, delimiter: null, specialUse, noselect: false, unseen: list.filter((message) => !message.seen).length, total: list.length, children: [] })
    return [node(EMAIL_INBOX_MAILBOX, null, data.inbox), node(EMAIL_SENT_MAILBOX, '\\Sent', data.sent)]
  }

  async function listFolders(accountId: string): Promise<EmailFoldersResult> {
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) {
      const pop = rt.error === 'pop3' ? runtimes.get(accountId) : undefined
      return pop ? { ok: true, folders: await pop3Folders(pop), pop3: true } : rt
    }
    const entries = await folderEntries(rt)
    if (isFailure(entries)) return entries
    return { ok: true, folders: folderTree(entries), pop3: false }
  }

  async function openFolder(accountId: string, path: string): Promise<EmailOpenFolderResult> {
    if (!folderPathSchema.safeParse(path).success) return folderFailure('invalid')
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) {
      const pop = rt.error === 'pop3' ? runtimes.get(accountId) : undefined
      if (!pop) return rt
      // POP3: a Caixa de Entrada e os enviados do app; outra pasta não existe.
      if (!isInbox({ mailbox: path }) && path !== EMAIL_SENT_MAILBOX) return rt
      const data = await store.read(accountId)
      return { ok: true, messages: [...(isInbox({ mailbox: path }) ? data.inbox : data.sent)].sort((a, b) => b.date - a.date) }
    }
    // A INBOX segue o fluxo de sempre (as 200 do IDLE, no store).
    if (isInbox({ mailbox: path })) return { ok: true, messages: [...(await store.read(accountId)).inbox].sort((a, b) => b.date - a.date) }
    const generation = rt.generation
    const read = await withFolders(rt, 'abrir pasta', (session) => session.recent(path, EMAIL_FOLDER_MESSAGES_MAX))
    if (isFailure(read)) return read
    if (rt.removed || disposed) return folderFailure('missing')
    const messages = read.messages.slice(-EMAIL_FOLDER_MESSAGES_MAX).map((message) => ({ ...fromImap(accountId, message, path), id: serverMessageId(path, read.uidValidity, message.uid) }))
    let dropped: EmailMessage[] = []
    await store.updateFolder(accountId, path, (current) => {
      const ids = new Set(messages.map((message) => message.id))
      dropped = (current?.messages ?? []).filter((message) => !ids.has(message.id))
      return { path, uidValidity: read.uidValidity, at: now(), messages }
      // Contrato 53 (CA11): uma pasta saiu pelo teto de 30; os corpos dela saem na fila da conta.
    }, () => void enqueue(rt, () => pruneAccount(rt)))
    // Os corpos das que saíram da pasta (ou do `UIDVALIDITY` antigo) não ficam para sempre.
    for (const message of dropped) await store.removeBody(accountId, bodyKey(message)).catch(() => undefined)
    if (rt.generation === generation) log(`${tag(rt)}: pasta aberta (${messages.length} mensagens)`)
    return { ok: true, messages: [...messages].sort((a, b) => b.date - a.date) }
  }

  /** Um Message-ID que chega à INBOX por "Mover" fica sem aviso de email novo por 10 min. */
  const MOVED_IN_MS = 10 * 60_000

  async function moveMessages(accountId: string, fromPath: string, uids: readonly number[], toPath: string): Promise<EmailMoveResult> {
    const parsed = moveSchema.safeParse({ accountId, fromPath, uids: [...uids], toPath })
    if (!parsed.success || fromPath === toPath) return folderFailure('invalid')
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) return rt
    const list = [...new Set(parsed.data.uids)]
    // Na fila da conta: um sincronismo da INBOX em andamento termina antes, e não devolve as movidas à lista.
    const result = await enqueue(rt, () => moveQueued(rt, fromPath, list, toPath))
    return result.ok ? { ok: true, moved: result.moved } : result
  }

  /** O mover já na fila da conta; com o `UIDVALIDITY` do destino (`COPYUID`), que as regras usam (contrato 53). */
  async function moveQueued(rt: Runtime, fromPath: string, list: number[], toPath: string): Promise<{ ok: true; moved: { fromUid: number; toUid: number | null }[]; uidValidity: string | null } | EmailFolderFailure> {
    const accountId = rt.account.id
    if (rt.removed) return folderFailure('missing')
    const fromInbox = isInbox({ mailbox: fromPath })
    const toInbox = isInbox({ mailbox: toPath })
    // Os UIDs valem com o `UIDVALIDITY` guardado da pasta de origem: sem ele (pasta nunca aberta), não há como conferir.
    const data = await store.read(accountId)
    const source = fromInbox ? null : await store.folder(accountId, fromPath)
    const uidValidity = fromInbox ? data.uidValidity : (source?.uidValidity ?? null)
    if (uidValidity === null) return folderFailure('invalid')
    const gone = new Set(list)
    const known = (fromInbox ? data.inbox : (source?.messages ?? [])).filter((message) => message.uid !== null && gone.has(message.uid))
    // Antes do servidor: o IDLE pode avisar a chegada na INBOX antes de o mover voltar.
    if (toInbox) for (const message of known) if (message.messageId !== null) rt.movedIn.set(message.messageId, now() + MOVED_IN_MS)
    const result = await withFolders(rt, 'mover', (session) => session.move(fromPath, list, toPath, uidValidity))
    // Erro do servidor: nada sai do store; o `LIST` guardado é relido (as contagens podem ter mudado).
    if (isFailure(result)) {
      folderCache.delete(accountId)
      return result
    }
    if (rt.removed) return { ok: true, moved: result.moved, uidValidity: result.uidValidity }
    const target = new Map(result.moved.map((item) => [item.fromUid, item.toUid]))
    const keep = (messages: EmailMessage[]): EmailMessage[] => messages.filter((message) => message.uid === null || !gone.has(message.uid))
    // As que chegam com o UID novo (`COPYUID`): a cópia na pasta de destino.
    const arrived = (mailbox: string, id: (uid: number) => string): EmailMessage[] | null => {
      if (known.length !== list.length || result.moved.some((item) => item.toUid === null)) return null
      return known.map((message) => {
        const uid = target.get(message.uid ?? 0) as number
        return { ...message, mailbox, uid, id: id(uid) }
      })
    }
    let capped = false
    await store.update(accountId, (current) => {
      let inbox = fromInbox ? keep(current.inbox) : current.inbox
      if (toInbox && result.uidValidity === current.uidValidity) {
        const copies = arrived(EMAIL_INBOX_MAILBOX, (uid) => String(uid))
        if (copies) {
          const merged = [...copies, ...inbox.filter((message) => !copies.some((item) => item.id === message.id))]
          capped = merged.length > EMAIL_INBOX_MAX
          inbox = capInbox(merged)
        }
      }
      return { ...current, inbox }
    })
    if (!fromInbox) await store.updateFolder(accountId, fromPath, (current) => (current ? { ...current, messages: keep(current.messages), at: now() } : null))
    if (!toInbox) {
      const cached = await store.folder(accountId, toPath)
      if (cached) {
        const copies = result.uidValidity === cached.uidValidity ? arrived(toPath, (uid) => serverMessageId(toPath, cached.uidValidity, uid)) : null
        if (copies) {
          await store.updateFolder(accountId, toPath, (current) =>
            current ? { ...current, messages: [...copies, ...current.messages.filter((message) => !copies.some((item) => item.id === message.id))].sort((a, b) => b.date - a.date).slice(0, EMAIL_FOLDER_MESSAGES_MAX) } : null,
          )
        } else {
          // Sem o UID novo de cada uma, a pasta guardada não confere mais: relida ao abrir.
          await store.updateFolder(accountId, toPath, () => null)
          for (const message of cached.messages) await store.removeBody(accountId, bodyKey(message)).catch(() => undefined)
        }
      }
    }
    for (const message of known) await store.removeBody(accountId, bodyKey(message)).catch(() => undefined)
    if (capped) await pruneAccount(rt)
    log(`${tag(rt)}: ${list.length} mensagem(ns) movida(s)`)
    foldersChanged(rt)
    return { ok: true, moved: result.moved, uidValidity: result.uidValidity }
  }

  async function createFolder(accountId: string, parentPath: string | null, name: string): Promise<EmailFolderPathResult> {
    if ((parentPath !== null && !folderPathSchema.safeParse(parentPath).success) || typeof name !== 'string') return folderFailure('invalid')
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) return rt
    const entries = await folderEntries(rt)
    if (isFailure(entries)) return entries
    const parent = parentPath === null ? null : entries.find((entry) => entry.path === parentPath)
    if (parent === undefined) return folderFailure('missing')
    const delimiter = parent?.delimiter ?? entries.find((entry) => entry.delimiter)?.delimiter ?? null
    if (!validFolderName(name, delimiter)) return folderFailure('invalid')
    if (parent && !delimiter) return folderFailure('invalid')
    const path = parent ? `${parent.path}${delimiter ?? ''}${name}` : name
    if (path.length > EMAIL_FOLDER_PATH_MAX) return folderFailure('invalid')
    if (entries.some((entry) => entry.path === path)) return { ok: true, path }
    const created = await withFolders(rt, 'criar pasta', (session) => session.create(path))
    foldersChanged(rt)
    if (isFailure(created)) return created
    log(`${tag(rt)}: pasta criada`)
    return { ok: true, path: created }
  }

  /** Tira do store a pasta (e as de dentro) que mudou de nome ou saiu do servidor, e para de vigiá-las. */
  async function forgetFolder(rt: Runtime, entry: Pick<ImapFolderEntry, 'path' | 'delimiter'>): Promise<void> {
    const prefix = entry.delimiter ? `${entry.path}${entry.delimiter}` : null
    const gone = (path: string): boolean => path === entry.path || (prefix !== null && path.startsWith(prefix))
    for (const [senderId, watch] of folderWatches) if (watch.accountId === rt.account.id && gone(watch.path)) stopWatch(senderId)
    for (const path of (await store.folderPaths(rt.account.id)).filter(gone)) {
      let removed: EmailCachedFolder | null = null
      await store.updateFolder(rt.account.id, path, (current) => {
        removed = current
        return null
      })
      for (const message of (removed as EmailCachedFolder | null)?.messages ?? []) await store.removeBody(rt.account.id, bodyKey(message)).catch(() => undefined)
    }
  }

  async function renameFolder(accountId: string, path: string, newName: string): Promise<EmailFolderPathResult> {
    if (!folderPathSchema.safeParse(path).success || typeof newName !== 'string') return folderFailure('invalid')
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) return rt
    const entries = await folderEntries(rt)
    if (isFailure(entries)) return entries
    const entry = entries.find((item) => item.path === path)
    if (!entry) return folderFailure('missing')
    if (isProtectedFolder(entry, entries)) return folderFailure('protected')
    if (!validFolderName(newName, entry.delimiter)) return folderFailure('invalid')
    const cut = entry.delimiter ? path.lastIndexOf(entry.delimiter) : -1
    const newPath = `${cut > 0 ? path.slice(0, cut + 1) : ''}${newName}`
    if (newPath === path) return { ok: true, path }
    if (newPath.length > EMAIL_FOLDER_PATH_MAX || entries.some((item) => item.path === newPath)) return folderFailure('invalid')
    const renamed = await withFolders(rt, 'renomear pasta', (session) => session.rename(path, newPath))
    foldersChanged(rt)
    if (isFailure(renamed)) return renamed
    await forgetFolder(rt, entry)
    await retargetRules(rt, entry, renamed)
    log(`${tag(rt)}: pasta renomeada`)
    return { ok: true, path: renamed }
  }

  async function deleteFolder(accountId: string, path: string, force: boolean): Promise<EmailFolderDeleteResult> {
    if (!folderPathSchema.safeParse(path).success) return folderFailure('invalid')
    const rt = imapRuntime(accountId)
    if (isFailure(rt)) return rt
    const entries = await folderEntries(rt)
    if (isFailure(entries)) return entries
    const entry = entries.find((item) => item.path === path)
    if (!entry) return folderFailure('missing')
    if (isProtectedFolder(entry, entries)) return folderFailure('protected')
    const folders = descendants(entry, entries).length
    const messages = entry.total ?? 0
    // Sem a contagem do servidor (e a pasta abre), vale como "pode ter mensagens": só com `force`.
    if (!force && (messages > 0 || folders > 0 || (entry.total === null && !entry.noselect))) return { ok: false, error: 'invalid', contents: { messages, folders } }
    const deleted = await withFolders(rt, 'apagar pasta', (session) => session.delete(path))
    foldersChanged(rt)
    if (isFailure(deleted)) return deleted
    await forgetFolder(rt, entry)
    await markRulesFolderMissing(rt, entry)
    log(`${tag(rt)}: pasta apagada`)
    return { ok: true }
  }

  // Contrato 53: as regras da conta.

  /** As regras gravadas da conta, na ordem. */
  async function savedRules(accountId: string): Promise<EmailRule[]> {
    return (await deps.settings.getEmailRules())[accountId] ?? []
  }

  /** As ligadas; o `settings.json` que não se lê vale como nenhuma (o email chega como sempre). */
  async function enabledRules(accountId: string): Promise<EmailRule[]> {
    try {
      return (await savedRules(accountId)).filter((rule) => rule.enabled)
    } catch {
      log('regras: settings.json não lido')
      return []
    }
  }

  /**
   * CA11: os corpos (e as mensagens inteiras) que não são de nenhuma mensagem guardada (INBOX, enviados, pastas abertas)
   * saem. Sempre na fila da conta: um poll do POP3 grava o `.eml` antes de pôr a mensagem na lista. As listas são lidas
   * dentro da fila do store, na mesma tarefa da limpeza: um envio no meio (que não passa pela fila da conta) entra na
   * lista antes ou grava o corpo depois, nunca entre as duas. O `<conta>.json` que sumiu ou não se lê não apaga nada:
   * o `.eml` do POP3 pode ser a única cópia.
   */
  async function pruneAccount(rt: Runtime): Promise<void> {
    if (rt.removed) return
    const id = rt.account.id
    try {
      const removed = await store.pruneBodies(id, ({ data, folders }) => [...data.inbox, ...data.sent, ...folders.flatMap((folder) => folder.messages)].map(bodyKey))
      if (removed > 0) log(`${tag(rt)}: ${removed} corpo(s) sem mensagem apagado(s)`)
    } catch (error) {
      log(`${tag(rt)}: limpeza dos corpos falhou (${failureOf(error)})`)
    }
  }

  const ruleInput = (message: EmailMessage, body: EmailBody | null): EmailRuleInput => ({ from: message.from, to: message.to, cc: message.cc, subject: message.subject, ...ruleBody(body) })

  /** O corpo para as condições: o guardado ou, no IMAP, baixado e guardado; grande demais ou ilegível, `null` (D8). */
  async function ruleBodyOf(rt: Runtime, session: ImapSession | null, message: EmailMessage): Promise<EmailBody | null> {
    const cached = await store.body(rt.account.id, bodyKey(message)).catch(() => null)
    if (cached || message.uid === null || !session) return cached
    try {
      const raw = await session.source(message.uid)
      if (!Buffer.isBuffer(raw)) return null
      const parsed = await parse(raw)
      if (!rt.removed) await store.setBody(rt.account.id, bodyKey(message), parsed.body)
      return parsed.body
    } catch (error) {
      log(`${tag(rt)}: regras: corpo não lido (${failureOf(error)})`)
      return null
    }
  }

  const ruleErrorOf = (error: unknown): EmailRuleErrorCode => (['connection', 'timeout', 'tls', 'closed'].includes(failureOf(error)) ? 'unavailable' : 'server')

  interface RuleTarget {
    message: EmailMessage
    plan: EmailRulePlan
  }
  /** O estado final da mensagem (`message`), se saiu da INBOX e se alguma etapa falhou. */
  interface RuleOutcome {
    message: EmailMessage
    moved: boolean
    failed: boolean
  }
  /** Por regra, nesta rodada: em quantas mensagens agiu e o último erro (`null`: nenhum). */
  type RuleTally = Map<string, { hits: number; error: EmailRuleErrorCode | null }>

  /**
   * Os planos, na fila da conta: (1) as marcas (`\Seen`, `\Flagged`) na conexão da INBOX; (2) o mover, um `MOVE` por
   * destino (até 500), pelo corpo do mover (`moveQueued`); apagar é mover para a `\Trash` do `LIST` (N3). A pasta que não
   * está no `LIST` (relido uma vez) nem é tentada. POP3: só "marcar lida", no app (N2). O que falha fica onde está.
   */
  async function executePlans(rt: Runtime, session: ImapSession | null, targets: readonly RuleTarget[], rules: readonly EmailRule[], tally: RuleTally): Promise<RuleOutcome[]> {
    const id = rt.account.id
    const pop3 = rt.account.incoming.protocol === 'pop3'
    const byId = new Map(rules.map((rule) => [rule.id, rule]))
    const outcomes: RuleOutcome[] = targets.map((target) => ({ message: { ...target.message }, moved: false, failed: false }))
    const errors = targets.map(() => new Map<string, EmailRuleErrorCode>())
    /** A etapa falhou: o erro vai para as regras do plano que pediram aquela ação. */
    const blame = (index: number, pick: (rule: EmailRule) => boolean, code: EmailRuleErrorCode): void => {
      for (const ruleId of targets[index]?.plan.ruleIds ?? []) {
        const rule = byId.get(ruleId)
        if (rule && pick(rule)) errors[index]?.set(ruleId, code)
      }
      const outcome = outcomes[index]
      if (outcome) outcome.failed = true
    }
    const wantsMove = (rule: EmailRule): boolean => rule.actions.moveTo !== null
    const wantsDelete = (rule: EmailRule): boolean => rule.actions.delete

    const seen = new Set<string>()
    const flagged = new Set<string>()
    for (const [index, { message, plan }] of targets.entries()) {
      if (pop3) {
        if (plan.markRead) seen.add(message.id)
        // Só por arquivo antigo ou editado à mão: o POP3 não tem como ir ao servidor.
        if (plan.flag) blame(index, (rule) => rule.actions.flag, 'pop3')
        if (plan.moveTo !== null) blame(index, wantsMove, 'pop3')
        if (plan.delete) blame(index, wantsDelete, 'pop3')
        continue
      }
      if (message.uid === null) continue
      if (plan.markRead && !message.seen) {
        if (!session) blame(index, (rule) => rule.actions.markRead, 'unavailable')
        else
          await session.setSeen(message.uid, true).then(
            () => seen.add(message.id),
            (error: unknown) => blame(index, (rule) => rule.actions.markRead, ruleErrorOf(error)),
          )
      }
      if (plan.flag && !message.flagged) {
        if (!session) blame(index, (rule) => rule.actions.flag, 'unavailable')
        else
          await session.setFlagged(message.uid, true).then(
            () => flagged.add(message.id),
            (error: unknown) => blame(index, (rule) => rule.actions.flag, ruleErrorOf(error)),
          )
      }
    }
    if (seen.size > 0 || flagged.size > 0) {
      for (const outcome of outcomes) {
        if (seen.has(outcome.message.id)) outcome.message.seen = true
        if (flagged.has(outcome.message.id)) outcome.message.flagged = true
      }
      if (!rt.removed) {
        const mark = (item: EmailMessage): EmailMessage => (seen.has(item.id) || flagged.has(item.id) ? { ...item, seen: item.seen || seen.has(item.id), flagged: item.flagged || flagged.has(item.id) } : item)
        // As marcas já estão no servidor: o store que não grava agora acerta no próximo sincronismo.
        await store.update(id, (current) => ({ ...current, inbox: current.inbox.map(mark) })).catch((error: unknown) => log(`${tag(rt)}: regras: marcas não guardadas (${failureOf(error)})`))
      }
    }

    if (!pop3) {
      let refreshed = false
      /** A pasta no `LIST` (o guardado; sem achar, relido uma vez). `undefined`: o `LIST` não veio; `null`: não está. */
      const lookup = async (pick: (entries: readonly ImapFolderEntry[]) => ImapFolderEntry | undefined): Promise<ImapFolderEntry | null | undefined> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt === 1) {
            if (refreshed) break
            refreshed = true
            folderCache.delete(id)
          }
          const entries = await folderEntries(rt)
          if (isFailure(entries)) return undefined
          const found = pick(entries)
          if (found) return found
        }
        return null
      }
      const groups = new Map<string, number[]>()
      // Cada etapa no seu `try`: o que já foi movido continua dito como movido se uma etapa adiante lançar.
      const failMove = (index: number, error: unknown): void => {
        log(`${tag(rt)}: regras: mover não feito (${failureOf(error)})`)
        blame(index, targets[index]?.plan.delete === true ? wantsDelete : wantsMove, ruleErrorOf(error))
      }
      for (const [index, { message, plan }] of targets.entries()) {
        if ((plan.moveTo === null && !plan.delete) || message.uid === null || rt.removed) continue
        let dest: string
        try {
          if (plan.delete) {
            const trash = await lookup((entries) => entries.find((entry) => entry.specialUse === '\\Trash' && !entry.noselect))
            if (!trash) {
              blame(index, wantsDelete, trash === null ? 'no-trash' : 'unavailable')
              continue
            }
            dest = trash.path
          } else {
            const path = plan.moveTo as string
            // Sem o `LIST`, o `MOVE` é tentado assim mesmo; não estar nele, nem tenta.
            if ((await lookup((entries) => entries.find((entry) => entry.path === path && !entry.noselect))) === null) {
              blame(index, wantsMove, 'folder-missing')
              continue
            }
            dest = path
          }
        } catch (error) {
          failMove(index, error)
          continue
        }
        groups.set(dest, [...(groups.get(dest) ?? []), index])
      }
      for (const [dest, indexes] of groups) {
        for (let start = 0; start < indexes.length; start += EMAIL_MOVE_MAX) {
          const chunk = indexes.slice(start, start + EMAIL_MOVE_MAX)
          const uids = chunk.map((index) => targets[index]?.message.uid as number)
          let result: Awaited<ReturnType<typeof moveQueued>>
          try {
            result = await moveQueued(rt, EMAIL_INBOX_MAILBOX, uids, dest)
          } catch (error) {
            for (const index of chunk) failMove(index, error)
            continue
          }
          if (!result.ok) {
            const code: EmailRuleErrorCode = result.error === 'unavailable' ? 'unavailable' : 'server'
            let gone = false
            // O `LIST` guardado dizia que a pasta existia: relido, ela pode ter sumido por fora (webmail).
            if (code === 'server' && !refreshed) {
              refreshed = true
              folderCache.delete(id)
              const entries = await folderEntries(rt).catch((): EmailFolderFailure => folderFailure('unavailable'))
              gone = !isFailure(entries) && !entries.some((entry) => entry.path === dest && !entry.noselect)
            }
            for (const index of chunk) {
              const deleting = targets[index]?.plan.delete === true
              blame(index, deleting ? wantsDelete : wantsMove, gone ? (deleting ? 'no-trash' : 'folder-missing') : code)
            }
            continue
          }
          const map = new Map(result.moved.map((item) => [item.fromUid, item.toUid]))
          for (const index of chunk) {
            const outcome = outcomes[index]
            if (!outcome || outcome.message.uid === null) continue
            const toUid = map.get(outcome.message.uid) ?? null
            outcome.moved = true
            // Com o `COPYUID`, a mensagem como está no destino; sem ele, o id da origem e sem UID (abrir é do 55).
            outcome.message =
              toUid !== null && result.uidValidity !== null
                ? { ...outcome.message, mailbox: dest, uid: toUid, id: serverMessageId(dest, result.uidValidity, toUid) }
                : { ...outcome.message, mailbox: dest, uid: null }
          }
        }
      }
    }

    for (const [index, target] of targets.entries()) {
      for (const ruleId of target.plan.ruleIds) {
        const entry = tally.get(ruleId) ?? { hits: 0, error: null }
        const code = errors[index]?.get(ruleId)
        if (code) entry.error = code
        else entry.hits++
        tally.set(ruleId, entry)
      }
    }
    return outcomes
  }

  /** CA7: grava a rodada no estado das regras: erro novo, ou o sucesso limpa o anterior; `runRuleId` ganha `lastRunAt`. */
  async function saveTally(rt: Runtime, tally: RuleTally, runRuleId: string | null = null): Promise<void> {
    if ((tally.size === 0 && runRuleId === null) || rt.removed) return
    const at = now()
    try {
      await store.updateRuleState(rt.account.id, (state) => {
        const next = { ...state }
        for (const [ruleId, item] of tally) {
          const current = next[ruleId] ?? { ...EMPTY_EMAIL_RULE_STATE }
          next[ruleId] = { ...current, hits: current.hits + item.hits, lastError: item.error ? { at, code: item.error } : null }
        }
        if (runRuleId !== null) next[runRuleId] = { ...(next[runRuleId] ?? { ...EMPTY_EMAIL_RULE_STATE }), lastRunAt: at }
        return next
      })
    } catch (error) {
      log(`${tag(rt)}: estado das regras não gravado (${failureOf(error)})`)
    }
  }

  /** CA4: as regras ligadas nas mensagens novas; devolve cada uma no estado final, com o aviso (CA5). */
  async function applyRules(rt: Runtime, session: ImapSession | null, messages: readonly EmailMessage[], rules: readonly EmailRule[]): Promise<{ message: EmailMessage; notify: boolean }[]> {
    const wantBody = needsBody(rules)
    const targets: RuleTarget[] = []
    for (const message of messages) {
      const body = wantBody ? await ruleBodyOf(rt, session, message) : null
      targets.push({ message, plan: planActions(ruleInput(message, body), rules) })
    }
    const acting = targets.filter((target) => target.plan.ruleIds.length > 0)
    const tally: RuleTally = new Map()
    let outcomes: RuleOutcome[]
    try {
      outcomes = acting.length > 0 ? await executePlans(rt, session, acting, rules, tally) : []
    } catch (error) {
      // Nunca derruba a conta nem impede o aviso: a mensagem fica como chegou.
      log(`${tag(rt)}: regras não aplicadas (${failureOf(error)})`)
      outcomes = acting.map((target) => ({ message: target.message, moved: false, failed: true }))
    }
    await saveTally(rt, tally)
    const final = new Map(acting.map((target, index) => [target.message.id, { plan: target.plan, message: outcomes[index]?.message ?? target.message }]))
    if (acting.length > 0) log(`${tag(rt)}: regras aplicadas em ${acting.length} mensagem(ns)`)
    return messages.map((message) => {
      const item = final.get(message.id)
      return item ? { message: item.message, notify: !(item.plan.silent || item.plan.delete) } : { message, notify: true }
    })
  }

  /**
   * CA9: a pasta de destino e a Lixeira, pelo `LIST` (relido uma vez se faltar algo), só das regras que se conferem
   * (`changedRules`). Pasta que não existe: `folder-missing` (a lista não grava). Apagar sem Lixeira não trava a lista:
   * volta em `noTrash` (os ids dessas regras), que gravam com o erro. Sem o `LIST`, nada a dizer (grava).
   */
  async function checkRuleTargets(rt: Runtime, rules: readonly EmailRule[]): Promise<{ missing: boolean; noTrash: string[] }> {
    const moves = rules.flatMap((rule) => (rule.actions.moveTo === null ? [] : [rule.actions.moveTo]))
    const deletes = rules.filter((rule) => rule.actions.delete).map((rule) => rule.id)
    const none = { missing: false, noTrash: [] }
    if (moves.length === 0 && deletes.length === 0) return none
    const missing = (entries: readonly ImapFolderEntry[]): boolean => moves.some((path) => !entries.some((entry) => entry.path === path && !entry.noselect))
    const noTrash = (entries: readonly ImapFolderEntry[]): boolean => deletes.length > 0 && !entries.some((entry) => entry.specialUse === '\\Trash' && !entry.noselect)
    let entries = await folderEntries(rt)
    if (isFailure(entries)) return none
    if (missing(entries) || noTrash(entries)) {
      folderCache.delete(rt.account.id)
      entries = await folderEntries(rt)
      if (isFailure(entries)) return none
    }
    return { missing: missing(entries), noTrash: noTrash(entries) ? deletes : [] }
  }

  /**
   * CA9 e D6: as regras que se conferem ao gravar: as ligadas que são novas ou cujas ações mudaram. Uma regra antiga já
   * quebrada (pasta que sumiu, sem Lixeira), ligada ou não, não impede gravar o resto da lista; o erro dela segue no
   * estado.
   */
  function changedRules(rules: readonly EmailRule[], saved: readonly EmailRule[]): EmailRule[] {
    const before = new Map(saved.map((rule) => [rule.id, rule]))
    return rules.filter((rule) => {
      if (!rule.enabled) return false
      const previous = before.get(rule.id)
      return !previous || JSON.stringify(previous.actions) !== JSON.stringify(rule.actions)
    })
  }

  /** Os paths de dentro de uma pasta (e o dela), pelo delimitador. */
  const underFolder = (entry: Pick<ImapFolderEntry, 'path' | 'delimiter'>, path: string): boolean => path === entry.path || (entry.delimiter !== null && path.startsWith(`${entry.path}${entry.delimiter}`))

  /** CA8: a pasta renomeada pelo app: as regras que apontavam para ela (ou para uma de dentro) passam ao path novo. */
  async function retargetRules(rt: Runtime, entry: Pick<ImapFolderEntry, 'path' | 'delimiter'>, newPath: string): Promise<void> {
    const id = rt.account.id
    const moved: string[] = []
    try {
      await accountsSerial(async () => {
        const rules = await savedRules(id)
        const next = rules.map((rule) => {
          const to = rule.actions.moveTo
          if (to === null || !underFolder(entry, to)) return rule
          moved.push(rule.id)
          return { ...rule, actions: { ...rule.actions, moveTo: `${newPath}${to.slice(entry.path.length)}` } }
        })
        if (moved.length > 0) await deps.settings.setEmailRules(id, next)
      })
      if (moved.length > 0) {
        await store.updateRuleState(id, (state) => Object.fromEntries(Object.entries(state).map(([ruleId, item]) => [ruleId, moved.includes(ruleId) ? { ...item, lastError: null } : item])))
        log(`${tag(rt)}: ${moved.length} regra(s) seguiram a pasta renomeada`)
      }
    } catch (error) {
      log(`${tag(rt)}: regras não atualizadas com a pasta renomeada (${failureOf(error)})`)
    }
  }

  /** CA8: a pasta apagada pelo app: as regras ficam (nem apagadas nem desligadas, D6), com `folder-missing`. */
  async function markRulesFolderMissing(rt: Runtime, entry: Pick<ImapFolderEntry, 'path' | 'delimiter'>): Promise<void> {
    const id = rt.account.id
    try {
      const hit = (await savedRules(id)).filter((rule) => rule.actions.moveTo !== null && underFolder(entry, rule.actions.moveTo)).map((rule) => rule.id)
      if (hit.length === 0) return
      const at = now()
      await store.updateRuleState(id, (state) => {
        const next = { ...state }
        for (const ruleId of hit) next[ruleId] = { ...(next[ruleId] ?? { ...EMPTY_EMAIL_RULE_STATE }), lastError: { at, code: 'folder-missing' } }
        return next
      })
    } catch (error) {
      log(`${tag(rt)}: regras não marcadas com a pasta apagada (${failureOf(error)})`)
    }
  }

  const rulesFailure = (error: EmailRulesFailure['error']): EmailRulesFailure => ({ ok: false, error })
  const ruleHash = (rule: EmailRule): string => createHash('sha256').update(JSON.stringify(rule)).digest('hex')

  function sweepRuleTokens(): void {
    const limit = now() - EMAIL_RULE_TOKEN_TTL_MS
    for (const [token, entry] of ruleTokens) if (entry.at < limit) ruleTokens.delete(token)
    // Poucos de cada vez: sai o mais antigo.
    while (ruleTokens.size >= 20) ruleTokens.delete(ruleTokens.keys().next().value as string)
  }

  async function previewRule(accountId: string, ruleId: string): Promise<EmailRulePreviewResult> {
    const rt = runtimes.get(accountId)
    if (!rt || rt.removed) return rulesFailure('missing')
    let rules: EmailRule[]
    try {
      rules = await savedRules(accountId)
    } catch {
      return rulesFailure('unavailable')
    }
    const rule = rules.find((item) => item.id === ruleId)
    if (!rule) return rulesFailure('missing')
    // Só esta regra, ligada ou não, sem "parar aqui".
    const single: EmailRule = { ...rule, enabled: true, stopHere: false }
    const wantBody = needsBody([single])
    const session = rt.account.incoming.protocol === 'imap' ? rt.session : null
    const ids: string[] = []
    for (const message of [...(await store.read(accountId)).inbox].sort((a, b) => b.date - a.date)) {
      if (rt.removed) return rulesFailure('missing')
      const body = wantBody ? await ruleBodyOf(rt, session, message) : null
      if (planActions(ruleInput(message, body), [single]).ruleIds.length > 0) ids.push(message.id)
    }
    sweepRuleTokens()
    const token = randomUUID()
    ruleTokens.set(token, { accountId, ruleId, hash: ruleHash(rule), ids, at: now() })
    const { markRead, flag, moveTo, delete: remove } = rule.actions
    return { ok: true, count: ids.length, actions: { markRead, flag, moveTo, delete: remove }, token }
  }

  async function runRule(accountId: string, ruleId: string, token: string): Promise<EmailRuleRunResult> {
    sweepRuleTokens()
    const entry = ruleTokens.get(token)
    // Uso único: gasto mesmo quando recusado.
    ruleTokens.delete(token)
    if (!entry || entry.accountId !== accountId || entry.ruleId !== ruleId || now() - entry.at > EMAIL_RULE_TOKEN_TTL_MS) return rulesFailure('stale')
    const rt = runtimes.get(accountId)
    if (!rt || rt.removed) return rulesFailure('missing')
    let rule: EmailRule | undefined
    try {
      rule = (await savedRules(accountId)).find((item) => item.id === ruleId)
    } catch {
      return rulesFailure('unavailable')
    }
    if (!rule || ruleHash(rule) !== entry.hash) return rulesFailure('stale')
    const current = rule
    return enqueue(rt, async (): Promise<EmailRuleRunResult> => {
      if (rt.removed) return rulesFailure('missing')
      const wanted = new Set(entry.ids)
      const present = (await store.read(accountId)).inbox.filter((message) => wanted.has(message.id))
      const { markRead, flag, moveTo, delete: remove } = current.actions
      const plan: EmailRulePlan = { ruleIds: [current.id], markRead, flag, moveTo, delete: remove, silent: false }
      const tally: RuleTally = new Map()
      const outcomes = await executePlans(rt, rt.account.incoming.protocol === 'imap' ? rt.session : null, present.map((message) => ({ message, plan })), [current], tally)
      await saveTally(rt, tally, current.id)
      changed(accountId)
      const done = outcomes.filter((outcome) => !outcome.failed).length
      log(`${tag(rt)}: regra executada à mão (${done} de ${entry.ids.length})`)
      return { ok: true, done, skipped: entry.ids.length - done }
    })
  }

  function stopWatch(senderId: number): void {
    const watch = folderWatches.get(senderId)
    if (watch) clearInterval(watch.timer)
    folderWatches.delete(senderId)
  }

  /**
   * A cada 5 min, a pasta vigiada é relida, só com a conta conectada (sem login com a senha recusada nem com o servidor
   * fora). Para sozinha quando a conta ou a pasta some, e depois de duas recusas seguidas do servidor.
   */
  async function refreshWatch(senderId: number): Promise<void> {
    const watch = folderWatches.get(senderId)
    if (!watch) return
    const rt = runtimes.get(watch.accountId)
    if (!rt || rt.removed) return stopWatch(senderId)
    if (rt.state !== 'connected' || rt.foldersAuthRefused) return
    const result = await openFolder(watch.accountId, watch.path).catch((): EmailOpenFolderResult => folderFailure('server'))
    if (folderWatches.get(senderId) !== watch) return
    if (result.ok) {
      watch.failures = 0
      changed(watch.accountId)
      return
    }
    if (result.error === 'server') watch.failures++
    if (result.error === 'missing' || result.error === 'pop3' || result.error === 'invalid' || rt.foldersAuthRefused || watch.failures >= 2) stopWatch(senderId)
  }

  return {
    async init() {
      const saved = await deps.settings.getEmailAccounts()
      for (const account of saved) if (!runtimes.has(account.id)) runtimes.set(account.id, runtime(account))
      // Contrato 52: a pasta dos enviados que ficou gravada, já antes de conectar (ou com a conta fora do ar).
      for (const rt of runtimes.values()) rt.sentMailbox = (await store.read(rt.account.id).catch(() => null))?.sentMailbox ?? rt.sentMailbox
      announce()
      // Contrato 53 (CA11): o que a 0.15.0 e o 52 deixaram em `<conta>.bodies/`, antes do primeiro sincronismo.
      for (const rt of runtimes.values()) void enqueue(rt, () => pruneAccount(rt))
      for (const rt of runtimes.values()) void connect(rt)
    },

    accounts: statuses,

    async autoconfig(request) {
      const parsed = autoconfigSchema.safeParse(request)
      if (!parsed.success) return null
      return autoconfigure(parsed.data.address, { fetch: deps.fetch, timeoutMs: deps.autoconfigTimeoutMs ?? AUTOCONFIG_TIMEOUT_MS })
    },

    async addAccount(request) {
      const parsed = addSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const input = parsed.data
      return accountsSerial(async (): Promise<EmailAddResult> => {
        const saved = await deps.settings.getEmailAccounts()
        if (saved.some((account) => account.address.toLowerCase() === input.address.toLowerCase())) return { ok: false, error: 'duplicate' }
        let password: string
        try {
          password = secrets.seal(input.password)
        } catch {
          return { ok: false, error: 'encryption' }
        }
        const account: StoredEmailAccount = {
          id: randomUUID(),
          address: input.address,
          name: input.name ?? null,
          username: input.username ? input.username : input.address,
          incoming: input.incoming,
          outgoing: input.outgoing,
          deleteFromServer: input.deleteFromServer ?? false,
          password,
        }
        await deps.settings.setEmailAccounts([...saved, account])
        const rt = runtime(account)
        runtimes.set(account.id, rt)
        log(`${tag(rt)}: adicionada (${account.incoming.protocol})`)
        void connect(rt)
        return { ok: true, status: statusOf(rt) }
      })
    },

    async test(request) {
      const parsed = addSchema.safeParse(request)
      if (!parsed.success) return { ok: false, stage: 'invalid', error: 'Confira o endereço, a senha e os servidores.' }
      const input = parsed.data
      const user = input.username ? input.username : input.address
      const config = (server: EmailServerInput) => ({ host: server.host, port: server.port, security: server.security, user, pass: input.password, ...(deps.tls ? { tls: deps.tls } : {}) })
      try {
        if (input.incoming.protocol === 'imap') await (await imap(config(input.incoming))).close()
        else await (await pop3(config(input.incoming))).quit()
      } catch (error) {
        log(`teste: recebimento falhou (${failureOf(error)})`)
        return { ok: false, stage: 'incoming', error: EMAIL_FAILURES[failureOf(error)] }
      }
      try {
        await smtpVerify(config(input.outgoing))
      } catch (error) {
        log(`teste: envio falhou (${failureOf(error)})`)
        return { ok: false, stage: 'outgoing', error: EMAIL_FAILURES[failureOf(error)] }
      }
      return { ok: true }
    },

    async removeAccount(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return false
      const rt = runtimes.get(parsed.data.accountId)
      if (!rt) return false
      rt.removed = true
      rt.generation++
      if (rt.timer) clearTimeout(rt.timer)
      rt.timer = null
      const session = rt.session
      rt.session = null
      if (session) void session.close().catch(() => undefined)
      runtimes.delete(rt.account.id)
      folderCache.delete(rt.account.id)
      for (const [senderId, watch] of folderWatches) if (watch.accountId === rt.account.id) stopWatch(senderId)
      for (const [token, entry] of ruleTokens) if (entry.accountId === rt.account.id) ruleTokens.delete(token)
      await accountsSerial(async () => deps.settings.setEmailAccounts((await deps.settings.getEmailAccounts()).filter((account) => account.id !== rt.account.id)))
      await store.remove(rt.account.id)
      log(`${tag(rt)}: removida`)
      announce()
      return true
    },

    async messages(request) {
      const parsed = messagesSchema.safeParse(request)
      if (!parsed.success || !runtimes.has(parsed.data.accountId)) return []
      const data = await store.read(parsed.data.accountId)
      const { folder, mailbox } = parsed.data
      const list = mailbox !== undefined && !isInbox({ mailbox }) ? ((await store.folder(parsed.data.accountId, mailbox))?.messages ?? []) : folder === 'sent' ? data.sent : data.inbox
      return [...list].sort((a, b) => b.date - a.date)
    },

    async cached() {
      const list: { status: EmailAccountStatus; inbox: EmailMessage[]; sent: EmailMessage[] }[] = []
      for (const rt of runtimes.values()) {
        const data = await store.read(rt.account.id).catch(() => null)
        if (data && !rt.removed) list.push({ status: statusOf(rt), inbox: data.inbox, sent: data.sent })
      }
      return list
    },

    async cachedBody(accountId, message) {
      if (!runtimes.has(accountId)) return null
      return store.body(accountId, bodyKey(message)).catch(() => null)
    },

    async searchServer(accountId, query, limit) {
      const rt = runtimes.get(accountId)
      if (!rt) return { ok: false, error: 'missing' }
      if (rt.account.incoming.protocol !== 'imap') return { ok: false, error: 'pop3' }
      const pass = secrets.open(rt.account.password)
      if (pass === null) return { ok: false, error: 'unavailable' }
      let reader: Awaited<ReturnType<ImapReaderConnect>> | null = null
      try {
        reader = await imapReader(serverConfig(rt, pass, rt.account.incoming))
        const rank = (box: { path: string; specialUse: string | null }): number => (box.path.toUpperCase() === 'INBOX' ? 0 : box.specialUse === '\\Sent' ? 1 : 2)
        const all = (await reader.folders()).sort((a, b) => rank(a) - rank(b))
        const folders = all.slice(0, EMAIL_SEARCH_FOLDERS_MAX)
        const found: EmailServerFound[] = []
        for (const box of folders) {
          const { uidValidity, messages } = await reader.search(box.path, query, limit)
          // O id leva a pasta e o UIDVALIDITY: nunca cai no espaço dos ids da INBOX do cache (o UID puro).
          for (const message of messages)
            found.push({ mailbox: box.path, uidValidity, specialUse: box.specialUse, message: { ...fromImap(accountId, message, box.path), id: serverMessageId(box.path, uidValidity, message.uid) } })
        }
        log(`${tag(rt)}: busca no servidor em ${folders.length} pastas (${found.length} achadas)`)
        return { ok: true, found: found.sort((a, b) => b.message.date - a.message.date).slice(0, limit), skippedFolders: all.length - folders.length }
      } catch (error) {
        log(`${tag(rt)}: busca no servidor falhou (${failureOf(error)})`)
        return { ok: false, error: 'unavailable' }
      } finally {
        await reader?.close().catch(() => undefined)
      }
    },

    async peekServer(accountId, mailbox, uid) {
      const rt = runtimes.get(accountId)
      if (!rt || rt.account.incoming.protocol !== 'imap') return { ok: false, error: 'not-found' }
      const pass = secrets.open(rt.account.password)
      if (pass === null) return { ok: false, error: 'unavailable' }
      let reader: Awaited<ReturnType<ImapReaderConnect>> | null = null
      try {
        reader = await imapReader(serverConfig(rt, pass, rt.account.incoming))
        const raw = await reader.peek(mailbox, uid)
        if (raw === 'too-big') return { ok: false, error: 'too-big' }
        if (raw === null) return { ok: false, error: 'not-found' }
        return { ok: true, body: (await parse(raw)).body }
      } catch (error) {
        log(`${tag(rt)}: leitura no servidor falhou (${failureOf(error)})`)
        return { ok: false, error: 'unavailable' }
      } finally {
        await reader?.close().catch(() => undefined)
      }
    },

    async body(request) {
      const parsed = messageRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'not-found' }
      const rt = runtimes.get(parsed.data.accountId)
      const found = rt ? await findMessage(parsed.data.accountId, parsed.data.id, true) : null
      if (!rt || !found) return { ok: false, error: 'not-found' }
      const key = `${rt.account.id}\n${bodyKey(found.message)}`
      const running = bodyRequests.get(key)
      if (running) return running
      const task = downloadBody(rt, found.message).catch((error: unknown): EmailBodyResult => {
        log(`${tag(rt)}: corpo não baixado (${failureOf(error)})`)
        return { ok: false, error: 'unavailable' }
      })
      const done = task.finally(() => bodyRequests.delete(key))
      bodyRequests.set(key, done)
      return done
    },

    async markRead(request) {
      const parsed = markReadSchema.safeParse(request)
      if (!parsed.success) return false
      const { accountId, id, seen } = parsed.data
      const rt = runtimes.get(accountId)
      const found = rt ? await findMessage(accountId, id) : null
      if (!rt || !found) return false
      const { message } = found
      if (isInbox(message) && message.uid !== null) {
        if (!rt.session) return false
        try {
          await rt.session.setSeen(message.uid, seen)
        } catch (error) {
          log(`${tag(rt)}: marcar lida falhou (${failureOf(error)})`)
          return false
        }
      }
      if (rt.removed) return false
      const mark = (list: EmailMessage[]): EmailMessage[] => list.map((item) => (item.id === id && item.mailbox === message.mailbox ? { ...item, seen } : item))
      await store.update(accountId, (data) => ({ ...data, inbox: mark(data.inbox), sent: mark(data.sent) }))
      changed(accountId)
      return true
    },

    async remove(request) {
      const parsed = messageRequestSchema.safeParse(request)
      if (!parsed.success) return false
      const { accountId, id } = parsed.data
      const rt = runtimes.get(accountId)
      const found = rt ? await findMessage(accountId, id) : null
      if (!rt || !found) return false
      const { message } = found
      // IMAP: no servidor primeiro. POP3 e enviados: só no app (o UIDL fica lembrado, a mensagem não volta).
      if (isInbox(message) && message.uid !== null) {
        if (!rt.session) return false
        try {
          await rt.session.remove(message.uid)
        } catch (error) {
          log(`${tag(rt)}: apagar falhou (${failureOf(error)})`)
          return false
        }
      }
      if (rt.removed) return false
      const keep = (list: EmailMessage[]): EmailMessage[] => list.filter((item) => !(item.id === id && item.mailbox === message.mailbox))
      await store.update(accountId, (data) => ({ ...data, inbox: keep(data.inbox), sent: keep(data.sent) }))
      await store.removeBody(accountId, bodyKey(message)).catch(() => undefined)
      changed(accountId)
      return true
    },

    registerClick(senderId, token) {
      guard.register(senderId, token)
    },

    async send(senderId, request) {
      const raw = (request ?? {}) as { clickToken?: unknown }
      const parsed = sendSchema.safeParse(request)
      // O token é gasto mesmo com o resto inválido: não serve para uma segunda tentativa.
      if (!guard.consume(senderId, raw.clickToken)) {
        log('envio recusado: sem clique')
        return { ok: false, error: 'click' }
      }
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { accountId, to, subject, text, inReplyTo } = parsed.data
      return deliver({ accountId, to, cc: parsed.data.cc ?? [], bcc: [], subject, text, inReplyTo, attachments: parsed.data.attachments ?? [] }, 'mensagem enviada com o clique da pessoa')
    },

    async sendForTask(request) {
      const parsed = taskSendSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { accountId, to, subject, text } = parsed.data
      return deliver({ accountId, to, cc: parsed.data.cc ?? [], bcc: parsed.data.bcc ?? [], subject, text, inReplyTo: undefined, attachments: [] }, 'mensagem enviada por uma tarefa com permissão')
    },

    forgetSender(senderId) {
      guard.forget(senderId)
      stopWatch(senderId)
    },

    async attachment(request) {
      const index = (request as { index?: unknown } | undefined)?.index
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= 500) return { ok: false, error: 'not-found' }
      const { index: _index, ...rest } = request as Record<string, unknown>
      const result = await attachmentsOf(rest)
      if (!result.ok) return result
      const item = result.list[index]
      if (!item) return { ok: false, error: 'not-found' }
      return { ok: true, name: safeAttachmentName(item.filename, index), bytes: new Uint8Array(item.content) }
    },

    async attachments(request) {
      const result = await attachmentsOf(request)
      if (!result.ok) return result
      const attachments: EmailOutgoingAttachment[] = []
      const skipped: string[] = []
      let total = 0
      result.list.forEach((item, index) => {
        const name = safeAttachmentName(item.filename, index)
        if (attachments.length >= EMAIL_ATTACH_MAX_FILES || total + item.content.byteLength > EMAIL_ATTACH_MAX_BYTES) {
          skipped.push(name)
          return
        }
        total += item.content.byteLength
        attachments.push({ name, bytes: new Uint8Array(item.content) })
      })
      return { ok: true, attachments, skipped }
    },

    listFolders,
    moveMessages,
    createFolder,
    renameFolder,
    deleteFolder,
    openFolder,

    async folders(request) {
      const parsed = accountRequestSchema.safeParse(request)
      return parsed.success ? listFolders(parsed.data.accountId) : folderFailure('invalid')
    },

    async open(request) {
      const parsed = openFolderSchema.safeParse(request)
      return parsed.success ? openFolder(parsed.data.accountId, parsed.data.path) : folderFailure('invalid')
    },

    async move(request) {
      const parsed = moveSchema.safeParse(request)
      return parsed.success ? moveMessages(parsed.data.accountId, parsed.data.fromPath, parsed.data.uids, parsed.data.toPath) : folderFailure('invalid')
    },

    async folderCreate(request) {
      const parsed = folderCreateSchema.safeParse(request)
      return parsed.success ? createFolder(parsed.data.accountId, parsed.data.parentPath, parsed.data.name) : folderFailure('invalid')
    },

    async folderRename(request) {
      const parsed = folderRenameSchema.safeParse(request)
      return parsed.success ? renameFolder(parsed.data.accountId, parsed.data.path, parsed.data.newName) : folderFailure('invalid')
    },

    async folderDelete(request) {
      const parsed = folderDeleteSchema.safeParse(request)
      return parsed.success ? deleteFolder(parsed.data.accountId, parsed.data.path, parsed.data.force ?? false) : folderFailure('invalid')
    },

    watchFolder(senderId, request) {
      stopWatch(senderId)
      const parsed = folderWatchSchema.safeParse(request ?? null)
      if (disposed || !parsed.success || parsed.data === null || parsed.data.path === null) return
      const { accountId, path } = parsed.data
      // A INBOX já chega pelo IDLE; POP3 não tem outra pasta.
      if (isInbox({ mailbox: path }) || runtimes.get(accountId)?.account.incoming.protocol !== 'imap') return
      const timer = setInterval(() => void refreshWatch(senderId), folderRefreshMs)
      timer.unref?.()
      folderWatches.set(senderId, { accountId, path, timer, failures: 0 })
    },

    async signatureGet(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      if (!runtimes.has(parsed.data.accountId)) return { ok: false, error: 'missing' }
      let saved: EmailSignature | undefined
      try {
        saved = (await deps.settings.getEmailSignatures())[parsed.data.accountId]
      } catch {
        return { ok: false, error: 'storage' }
      }
      return { ok: true, signature: saved ?? { ...DEFAULT_EMAIL_SIGNATURE } }
    },

    async signatureSet(request) {
      const parsed = signatureSetSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { accountId, signature } = parsed.data
      if (!runtimes.has(accountId)) return { ok: false, error: 'missing' }
      // Na mesma fila de adicionar e remover conta: a assinatura nunca fica de uma conta que acabou de sair.
      let saved: boolean
      try {
        saved = await accountsSerial(() => deps.settings.setEmailSignature(accountId, signature))
      } catch {
        // O formato já foi conferido acima: o que sobra é o disco (gravar o `settings.json`).
        log('assinatura: não foi possível gravar o settings.json')
        return { ok: false, error: 'storage' }
      }
      return saved ? { ok: true, signature: { ...signature } } : { ok: false, error: 'missing' }
    },

    async rulesGet(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return rulesFailure('invalid')
      const { accountId } = parsed.data
      if (!runtimes.has(accountId)) return rulesFailure('missing')
      let rules: EmailRule[]
      try {
        rules = await savedRules(accountId)
      } catch {
        return rulesFailure('unavailable')
      }
      const saved = await store.ruleState(accountId).catch((): Record<string, EmailRuleState> => ({}))
      return { ok: true, rules, state: Object.fromEntries(rules.map((rule) => [rule.id, saved[rule.id] ?? { ...EMPTY_EMAIL_RULE_STATE }])) }
    },

    async rulesSet(request) {
      const parsed = rulesSetSchema.safeParse(request)
      const list = parsed.success ? emailRuleListSchema.safeParse(parsed.data.rules) : null
      if (!parsed.success || !list?.success) return rulesFailure('invalid')
      const { accountId } = parsed.data
      const rules = list.data
      const rt = runtimes.get(accountId)
      if (!rt || rt.removed) return rulesFailure('missing')
      if (rt.account.incoming.protocol === 'pop3') {
        // N2: no POP3, só "marcar lida" e "não avisar".
        if (rules.some((rule) => rule.actions.moveTo !== null || rule.actions.flag || rule.actions.delete)) return rulesFailure('pop3')
      }
      let noTrash: string[] = []
      if (rt.account.incoming.protocol === 'imap' && rt.state === 'connected') {
        // O `settings.json` que não se lê: todas contam como novas.
        const before = await savedRules(accountId).catch((): EmailRule[] => [])
        const check = await checkRuleTargets(rt, changedRules(rules, before))
        if (check.missing) return rulesFailure('folder-missing')
        noTrash = check.noTrash
      }
      let saved: boolean
      try {
        // Na fila de adicionar e remover conta: as regras nunca ficam de uma conta que acabou de sair.
        saved = await accountsSerial(() => deps.settings.setEmailRules(accountId, rules))
      } catch {
        log('regras: não foi possível gravar o settings.json')
        return rulesFailure('unavailable')
      }
      if (!saved) return rulesFailure('missing')
      // A regra apagada sai do estado; a de apagar numa conta sem Lixeira fica com o erro (a ação não age, N3).
      const ids = new Set(rules.map((rule) => rule.id))
      const at = now()
      await store
        .updateRuleState(accountId, (state) => {
          const next = Object.fromEntries(Object.entries(state).filter(([ruleId]) => ids.has(ruleId)))
          for (const ruleId of noTrash) next[ruleId] = { ...(next[ruleId] ?? { ...EMPTY_EMAIL_RULE_STATE }), lastError: { at, code: 'no-trash' } }
          return next
        })
        .catch(() => log(`${tag(rt)}: estado das regras não gravado`))
      return { ok: true, rules }
    },

    async rulesPreview(request) {
      const parsed = rulePreviewSchema.safeParse(request)
      return parsed.success ? previewRule(parsed.data.accountId, parsed.data.ruleId) : rulesFailure('invalid')
    },

    async rulesRun(request) {
      const parsed = ruleRunSchema.safeParse(request)
      return parsed.success ? runRule(parsed.data.accountId, parsed.data.ruleId, parsed.data.token) : rulesFailure('invalid')
    },

    previewRule,
    runRule,

    async poll(accountId) {
      const rt = runtimes.get(accountId)
      if (!rt || rt.account.incoming.protocol !== 'pop3') return
      await connect(rt)
    },

    async dispose() {
      disposed = true
      for (const senderId of [...folderWatches.keys()]) stopWatch(senderId)
      const sessions: ImapSession[] = []
      for (const rt of runtimes.values()) {
        rt.generation++
        if (rt.timer) clearTimeout(rt.timer)
        rt.timer = null
        if (rt.session) sessions.push(rt.session)
        rt.session = null
      }
      await Promise.all(sessions.map((session) => session.close().catch(() => undefined)))
    },
  }
}
