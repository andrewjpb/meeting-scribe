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
//
// Erro de conexão (N4) nunca derruba o app: a conta fica `error` com uma mensagem curta e as outras seguem. Usuário ou
// senha recusados não tentam de novo sozinhos (para o servidor não bloquear a conta); o resto tenta de novo em 1 min
// (IMAP) ou no próximo poll (POP3).
import { randomUUID } from 'node:crypto'
import type { ConnectionOptions } from 'node:tls'
import { z } from 'zod'
import {
  EMAIL_ACCOUNT_ID_PATTERN,
  EMAIL_ATTACH_MAX_BYTES,
  EMAIL_ATTACH_MAX_FILES,
  EMAIL_ATTACH_NAME_MAX,
  EMAIL_CLICK_TTL_MS,
  EMAIL_INBOX_MAX,
  EMAIL_RAW_MAX_BYTES,
  EMAIL_RECIPIENTS_MAX,
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
  type EmailMessage,
  type EmailSendResult,
  type EmailAttachmentsResult,
  type EmailOutgoingAttachment,
  type EmailTestResult,
} from '../../shared/email'
import type { SafeStorageLike } from '../secrets'
import { emailAddressSchema, emailIncomingSchema, emailNameSchema, emailServerSchema, emailUsernameSchema, type StoredEmailAccount } from '../settings/schema'
import type { SettingsStore } from '../settings/store'
import { addressDomain, autoconfigure, AUTOCONFIG_TIMEOUT_MS, type AutoconfigFetch } from './autoconfig'
import { capInbox, createEmailStore, type EmailAccountData, type EmailStore } from './email-store'
import { connectImap, connectImapReader, messageIds, type ImapConnect, type ImapMessage, type ImapReaderConnect, type ImapSearchQuery, type ImapSession } from './imap-client'
import { connectPop3, Pop3Error, type Pop3Connect, type Pop3Session } from './pop3-client'
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
const messagesSchema = z.object({ accountId: accountIdSchema, folder: z.enum(['inbox', 'sent']).optional() }).strict()
const messageRequestSchema = z.object({ accountId: accountIdSchema, id: messageIdSchema }).strict()
const markReadSchema = messageRequestSchema.extend({ seen: z.boolean() }).strict()
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

function fromImap(accountId: string, message: ImapMessage): EmailMessage {
  return {
    id: String(message.uid),
    accountId,
    folder: 'inbox',
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
    folder: 'inbox',
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

/** Chave do corpo no store: a pasta e o id (o id do enviado é o Message-ID). */
const bodyKey = (message: Pick<EmailMessage, 'folder' | 'id'>): string => `${message.folder}:${message.id}`

export interface EmailServiceDeps {
  /** `userData/email`. */
  root: string
  settings: Pick<SettingsStore, 'get' | 'getEmailAccounts' | 'setEmailAccounts'>
  safeStorage: SafeStorageLike
  /** ISPDB do autoconfig (no smoke e nos testes, um HTTP falso). */
  fetch: AutoconfigFetch
  imap?: ImapConnect
  /** Contrato 45 (CA7): a conexão só de leitura da busca do Assistente (no smoke e nos testes, o IMAP falso). */
  imapReader?: ImapReaderConnect
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
  /** Mensagem nova na INBOX (IDLE do IMAP, ou poll do POP3 depois do primeiro). */
  onMessage: (message: EmailMessage) => void
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
  /** INBOX (padrão) ou enviados, da mais nova para a mais antiga. Só o store, nada vai ao servidor. */
  messages(request: unknown): Promise<EmailMessage[]>
  /**
   * Contrato 45: o cache local de cada conta (a INBOX e os enviados guardados), para o Assistente. Só leitura do store:
   * nada vai ao servidor.
   */
  cached(): Promise<{ status: EmailAccountStatus; inbox: EmailMessage[]; sent: EmailMessage[] }[]>
  /** Contrato 45: o corpo de uma mensagem se já foi baixado; `null` se não (nunca baixa). */
  cachedBody(accountId: string, message: Pick<EmailMessage, 'folder' | 'id'>): Promise<EmailBody | null>
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
  forgetSender(senderId: number): void
  /** Contrato 43 (CA8): um anexo recebido, com os bytes (do servidor no IMAP, da mensagem guardada no POP3 e nos enviados). */
  attachment(request: unknown): Promise<{ ok: true; name: string; bytes: Uint8Array } | { ok: false; error: 'not-found' | 'unavailable' }>
  /** Contrato 43 (CA9): os anexos para o "Encaminhar", nos limites do envio (os que passam ficam em `skipped`). */
  attachments(request: unknown): Promise<EmailAttachmentsResult>
  /** POP3: busca agora (o mesmo do relógio). */
  poll(accountId: string): Promise<void>
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
}

export function createEmailService(deps: EmailServiceDeps): EmailService {
  const now = deps.now ?? Date.now
  const imap = deps.imap ?? connectImap
  const imapReader = deps.imapReader ?? connectImapReader
  const pop3 = deps.pop3 ?? connectPop3
  const smtp = deps.smtp ?? sendSmtp
  const smtpVerify = deps.smtpVerify ?? verifySmtp
  const parse = deps.parse ?? parseEmail
  const readAttachments = deps.parseAttachments ?? parseAttachments
  const retryMs = deps.retryMs ?? EMAIL_RETRY_MS
  const secrets = createEmailSecrets(deps.safeStorage)
  const store: EmailStore = createEmailStore(deps.root)
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
  let disposed = false

  const log = (message: string): void => deps.log?.(`[email] ${message}`)
  /** Nos logs, só o começo do id da conta. */
  const tag = (rt: Runtime): string => `conta ${rt.account.id.slice(0, 8)}`
  const statusOf = (rt: Runtime): EmailAccountStatus => ({ account: publicAccount(rt.account), state: rt.state, error: rt.error })
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
    await store.update(id, (data) => {
      reset = data.uidValidity !== null && data.uidValidity !== session.uidValidity
      return { ...data, uidValidity: session.uidValidity, inbox: capInbox(list.map((message) => fromImap(id, message))) }
    })
    if (reset && live(rt, generation)) await store.clearBodies(id)
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
    await store.update(id, (current) => ({ ...current, inbox: capInbox([...added, ...current.inbox.filter((message) => !added.some((item) => item.id === message.id))]) }))
    log(`${tag(rt)}: ${added.length} mensagem(ns) nova(s)`)
    for (const message of added) if (!disposed) deps.onMessage(message)
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
    log(`${tag(rt)}: IMAP conectado`)
    setState(rt, 'connected', null)
  }

  async function pollPop3(rt: Runtime, pass: string, generation: number): Promise<void> {
    const id = rt.account.id
    const retry = async (): Promise<number> => ((await deps.settings.get().catch(() => null))?.emailPollMinutes ?? 5) * 60_000
    let session: Pop3Session | null = null
    const added: EmailMessage[] = []
    let firstPoll = false
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
        await store.update(id, (current) => ({
          ...current,
          seenUidls: [...current.seenUidls.filter((uidl) => !uidls.includes(uidl)), ...uidls].slice(-20_000),
          inbox: message ? capInbox([message, ...current.inbox.filter((item) => item.id !== message.id)]) : current.inbox,
        }))
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
      announceAdded()
      setState(rt, 'connected', null)
      schedule(rt, await retry())
    } catch (error) {
      session?.close()
      // O que já foi gravado antes da falha aparece na tela.
      if (live(rt, generation)) announceAdded()
      fail(rt, error, generation, await retry())
    }

    function announceAdded(): void {
      if (added.length === 0) return
      log(`${tag(rt)}: ${added.length} mensagem(ns) baixada(s) pelo POP3`)
      if (!firstPoll) for (const message of added) if (!disposed) deps.onMessage(message)
      changed(id)
    }
  }

  async function connect(rt: Runtime): Promise<void> {
    if (disposed || rt.removed) return
    if (rt.timer) clearTimeout(rt.timer)
    rt.timer = null
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
    return { account, state: 'offline', error: null, session: null, timer: null, generation: 0, queue: Promise.resolve(), removed: false }
  }

  async function findMessage(accountId: string, id: string): Promise<{ data: EmailAccountData; message: EmailMessage } | null> {
    const data = await store.read(accountId)
    const message = data.inbox.find((item) => item.id === id) ?? data.sent.find((item) => item.id === id)
    return message ? { data, message } : null
  }

  async function downloadBody(rt: Runtime, message: EmailMessage): Promise<EmailBodyResult> {
    const cached = await store.body(rt.account.id, bodyKey(message))
    if (cached) return { ok: true, body: cached }
    if (message.uid === null) return { ok: false, error: 'not-found' }
    const session = rt.session
    if (!session) return { ok: false, error: 'unavailable' }
    const raw = await session.source(message.uid)
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
    const session = rt.session
    if (!session) return 'unavailable'
    const raw = await session.source(message.uid)
    if (raw === 'too-big') return 'unavailable'
    return raw ?? 'not-found'
  }

  async function attachmentsOf(request: unknown): Promise<{ ok: true; list: Awaited<ReturnType<EmailAttachmentsParse>> } | { ok: false; error: 'not-found' | 'unavailable' }> {
    const parsed = messageRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'not-found' }
    const rt = runtimes.get(parsed.data.accountId)
    const found = rt ? await findMessage(parsed.data.accountId, parsed.data.id) : null
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

  return {
    async init() {
      const saved = await deps.settings.getEmailAccounts()
      for (const account of saved) if (!runtimes.has(account.id)) runtimes.set(account.id, runtime(account))
      announce()
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
      return [...(parsed.data.folder === 'sent' ? data.sent : data.inbox)].sort((a, b) => b.date - a.date)
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
            found.push({ mailbox: box.path, uidValidity, specialUse: box.specialUse, message: { ...fromImap(accountId, message), id: serverMessageId(box.path, uidValidity, message.uid), folder: box.specialUse === '\\Sent' ? 'sent' : 'inbox' } })
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
      const found = rt ? await findMessage(parsed.data.accountId, parsed.data.id) : null
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
      if (message.folder === 'inbox' && message.uid !== null) {
        if (!rt.session) return false
        try {
          await rt.session.setSeen(message.uid, seen)
        } catch (error) {
          log(`${tag(rt)}: marcar lida falhou (${failureOf(error)})`)
          return false
        }
      }
      if (rt.removed) return false
      const mark = (list: EmailMessage[]): EmailMessage[] => list.map((item) => (item.id === id && item.folder === message.folder ? { ...item, seen } : item))
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
      if (message.folder === 'inbox' && message.uid !== null) {
        if (!rt.session) return false
        try {
          await rt.session.remove(message.uid)
        } catch (error) {
          log(`${tag(rt)}: apagar falhou (${failureOf(error)})`)
          return false
        }
      }
      if (rt.removed) return false
      const keep = (list: EmailMessage[]): EmailMessage[] => list.filter((item) => !(item.id === id && item.folder === message.folder))
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
      const cc = parsed.data.cc ?? []
      const attachments = parsed.data.attachments ?? []
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
      const mail: OutgoingMail = { from: { name: rt.account.name, address: rt.account.address }, to, cc, subject, text, attachments, messageId, inReplyTo: inReplyTo ?? null, references, date: new Date(date) }
      let bytes: Buffer
      try {
        bytes = await smtp(serverConfig(rt, pass, rt.account.outgoing), mail)
      } catch (error) {
        const kind = error instanceof SmtpError ? error.kind : 'failed'
        log(`${tag(rt)}: envio falhou (${kind})`)
        return { ok: false, error: kind }
      }
      log(`${tag(rt)}: mensagem enviada com o clique da pessoa`)
      const sent: EmailMessage = {
        id: messageId,
        accountId,
        folder: 'sent',
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
        await store.update(accountId, (current) => ({
          ...current,
          sent: [sent, ...current.sent].slice(0, EMAIL_SENT_MAX),
          inbox: parent ? current.inbox.map((item) => (item.id === parent.id ? { ...item, answered: true } : item)) : current.inbox,
        }))
        await store.setBody(accountId, bodyKey(sent), { text, html: null, attachments: attachments.map((item) => ({ filename: item.name, contentType: 'application/octet-stream', size: item.bytes.byteLength })) })
        // Contrato 43: os bytes enviados, para baixar ou encaminhar os anexos depois.
        if (attachments.length > 0) await store.setRaw(accountId, bodyKey(sent), bytes)
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
    },

    forgetSender(senderId) {
      guard.forget(senderId)
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

    async poll(accountId) {
      const rt = runtimes.get(accountId)
      if (!rt || rt.account.incoming.protocol !== 'pop3') return
      await connect(rt)
    },

    async dispose() {
      disposed = true
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
