// Cache local do email (contrato 42), em `userData/email/`: um arquivo por conta (`<conta>.json`, com a INBOX, os
// enviados, o `UIDVALIDITY` do IMAP e os UIDLs já vistos do POP3) e os corpos já baixados em `<conta>.bodies/`, um
// arquivo por mensagem. Contrato 43: ao lado do corpo, a mensagem inteira (`.eml`) das que não ficam no servidor (POP3 e
// enviados), para baixar e encaminhar os anexos depois; as do IMAP são pedidas de novo ao servidor. Pasta 0700, arquivos 0600, gravação atômica (temporário + `rename`) e em fila por conta.
// Arquivo ausente ou inválido vale como vazio: o próximo sincronismo refaz.
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_INBOX_MAX, EMAIL_SENT_MAX, type EmailBody, type EmailMessage } from '../../shared/email'

export const EMAIL_DIR = 'email'
const STORE_VERSION = 1
/** UIDLs lembrados por conta POP3 (os que ainda estão no servidor). */
const SEEN_UIDLS_MAX = 20_000

const addressSchema = z.object({ name: z.string().max(500).nullable(), address: z.string().max(500) })
const messageSchema = z.object({
  id: z.string().min(1).max(1000),
  accountId: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
  folder: z.enum(['inbox', 'sent']),
  uid: z.number().int().positive().nullable(),
  seen: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  from: z.array(addressSchema).max(100),
  to: z.array(addressSchema).max(500),
  cc: z.array(addressSchema).max(500),
  subject: z.string().max(10_000),
  date: z.number(),
  messageId: z.string().max(1000).nullable(),
  inReplyTo: z.string().max(1000).nullable(),
  references: z.array(z.string().max(1000)).max(100),
})
const dataSchema = z.object({
  version: z.literal(STORE_VERSION),
  uidValidity: z.string().max(40).nullable(),
  /** POP3: já passou pelo primeiro poll (o primeiro não avisa mensagem nova). */
  polled: z.boolean(),
  seenUidls: z.array(z.string().max(70)).max(SEEN_UIDLS_MAX),
  inbox: z.array(messageSchema).max(EMAIL_INBOX_MAX),
  sent: z.array(messageSchema).max(EMAIL_SENT_MAX),
})
const bodySchema = z.object({
  text: z.string().nullable(),
  html: z.string().nullable(),
  attachments: z.array(z.object({ filename: z.string().max(1000).nullable(), contentType: z.string().max(300), size: z.number().int().nonnegative() })).max(500),
})

export type EmailAccountData = z.infer<typeof dataSchema>

export const emptyAccountData = (): EmailAccountData => ({ version: STORE_VERSION, uidValidity: null, polled: false, seenUidls: [], inbox: [], sent: [] })

/** INBOX da mais nova para a mais antiga, até o limite. */
export function capInbox(messages: readonly EmailMessage[]): EmailMessage[] {
  return [...messages].sort((a, b) => b.date - a.date || (b.uid ?? 0) - (a.uid ?? 0)).slice(0, EMAIL_INBOX_MAX)
}

export interface EmailStore {
  read(accountId: string): Promise<EmailAccountData>
  /** Lê, aplica e grava, em fila por conta. */
  update(accountId: string, change: (data: EmailAccountData) => EmailAccountData): Promise<EmailAccountData>
  body(accountId: string, messageId: string): Promise<EmailBody | null>
  setBody(accountId: string, messageId: string, body: EmailBody): Promise<void>
  removeBody(accountId: string, messageId: string): Promise<void>
  /** Contrato 43: a mensagem inteira guardada (POP3 e enviados), ou `null`. */
  raw(accountId: string, messageId: string): Promise<Buffer | null>
  setRaw(accountId: string, messageId: string, raw: Buffer): Promise<void>
  /** Todos os corpos da conta (o `UIDVALIDITY` mudou). */
  clearBodies(accountId: string): Promise<void>
  /** A conta saiu: o arquivo e os corpos. */
  remove(accountId: string): Promise<void>
}

async function writeAtomic(file: string, content: string | Buffer): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temp, content, { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function createEmailStore(root: string): EmailStore {
  const queues = new Map<string, Promise<unknown>>()

  const checkId = (accountId: string): string => {
    if (!EMAIL_ACCOUNT_ID_PATTERN.test(accountId)) throw new Error('conta inválida')
    return accountId
  }
  const accountFile = (accountId: string): string => join(root, `${checkId(accountId)}.json`)
  const bodiesDir = (accountId: string): string => join(root, `${checkId(accountId)}.bodies`)
  // O id da mensagem vem do servidor (UIDL) ou é um Message-ID: o nome do arquivo é o hash dele.
  const fileName = (messageId: string): string => createHash('sha256').update(messageId).digest('hex').slice(0, 32)
  const bodyFile = (accountId: string, messageId: string): string => join(bodiesDir(accountId), `${fileName(messageId)}.json`)
  const rawFile = (accountId: string, messageId: string): string => join(bodiesDir(accountId), `${fileName(messageId)}.eml`)

  const serial = <T>(accountId: string, task: () => Promise<T>): Promise<T> => {
    const run = (queues.get(accountId) ?? Promise.resolve()).then(task, task)
    queues.set(
      accountId,
      run.catch(() => undefined),
    )
    return run
  }

  async function load(accountId: string): Promise<EmailAccountData> {
    const parsed = dataSchema.safeParse(await readJson(accountFile(accountId)))
    return parsed.success ? parsed.data : emptyAccountData()
  }

  return {
    read: (accountId) => serial(accountId, () => load(accountId)),

    update: (accountId, change) =>
      serial(accountId, async () => {
        const next = dataSchema.parse(change(await load(accountId)))
        await mkdir(root, { recursive: true, mode: 0o700 })
        await writeAtomic(accountFile(accountId), `${JSON.stringify(next)}\n`)
        return next
      }),

    async body(accountId, messageId) {
      const parsed = bodySchema.safeParse(await readJson(bodyFile(accountId, messageId)))
      return parsed.success ? parsed.data : null
    },

    // Os corpos entram na mesma fila da conta: uma gravação pedida antes do `remove` termina antes dele.
    setBody: (accountId, messageId, body) =>
      serial(accountId, async () => {
        const content = `${JSON.stringify(bodySchema.parse(body))}\n`
        await mkdir(bodiesDir(accountId), { recursive: true, mode: 0o700 })
        await writeAtomic(bodyFile(accountId, messageId), content)
      }),

    removeBody: (accountId, messageId) =>
      serial(accountId, async () => {
        await rm(bodyFile(accountId, messageId), { force: true })
        await rm(rawFile(accountId, messageId), { force: true })
      }),

    async raw(accountId, messageId) {
      try {
        return await readFile(rawFile(accountId, messageId))
      } catch {
        return null
      }
    },

    setRaw: (accountId, messageId, raw) =>
      serial(accountId, async () => {
        await mkdir(bodiesDir(accountId), { recursive: true, mode: 0o700 })
        await writeAtomic(rawFile(accountId, messageId), raw)
      }),

    clearBodies: (accountId) => serial(accountId, () => rm(bodiesDir(accountId), { recursive: true, force: true })),

    remove: (accountId) =>
      serial(accountId, async () => {
        await rm(accountFile(accountId), { force: true })
        await rm(bodiesDir(accountId), { recursive: true, force: true })
      }),
  }
}
