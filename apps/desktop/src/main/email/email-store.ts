// Cache local do email (contrato 42), em `userData/email/`: um arquivo por conta (`<conta>.json`, com a INBOX, os
// enviados, o `UIDVALIDITY` do IMAP e os UIDLs já vistos do POP3) e os corpos já baixados em `<conta>.bodies/`, um
// arquivo por mensagem. Contrato 43: ao lado do corpo, a mensagem inteira (`.eml`) das que não ficam no servidor (POP3 e
// enviados), para baixar e encaminhar os anexos depois; as do IMAP são pedidas de novo ao servidor. Pasta 0700, arquivos 0600, gravação atômica (temporário + `rename`) e em fila por conta.
// Arquivo ausente ou inválido vale como vazio: o próximo sincronismo refaz.
//
// Contrato 52: em memória, cada mensagem diz a pasta (`mailbox`, o path IMAP). No disco, o `<conta>.json` continua na
// versão 1 e legível pela 0.15.0 (voltar de versão não perde o cache nem os UIDLs vistos do POP3): cada mensagem leva o
// `folder` antigo (`inbox` ou `sent`, pela lista) ao lado do `mailbox`, e a pasta dos enviados vai em `sentMailbox`, que
// a 0.15.0 ignora. Arquivo sem `mailbox` (o da 0.15.0) abre sem perda: `inbox` vira `INBOX` e `sent` vira a pasta dos
// enviados gravada (ou `Sent`, que o serviço troca pelo path da `\Sent` quando o servidor disser).
// As outras pastas abertas ficam à parte, em `<conta>.folders/`: um arquivo por pasta (as 200 mais recentes) e um índice
// com a hora de uso de cada uma; passou de 30, sai a usada há mais tempo. O caminho da INBOX (IDLE, lida, apagar) não lê
// nem grava esses arquivos.
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  EMAIL_ACCOUNT_ID_PATTERN,
  EMAIL_FOLDER_MESSAGES_MAX,
  EMAIL_FOLDER_PATH_MAX,
  EMAIL_INBOX_MAILBOX,
  EMAIL_INBOX_MAX,
  EMAIL_SENT_MAILBOX,
  EMAIL_SENT_MAX,
  type EmailBody,
  type EmailMessage,
} from '../../shared/email'

export const EMAIL_DIR = 'email'
/** Contrato 52: pastas abertas guardadas por conta (a usada há mais tempo sai). */
export const EMAIL_CACHED_FOLDERS_MAX = 30
const STORE_VERSION = 1
/** UIDLs lembrados por conta POP3 (os que ainda estão no servidor). */
const SEEN_UIDLS_MAX = 20_000

const addressSchema = z.object({ name: z.string().max(500).nullable(), address: z.string().max(500) })
const mailboxSchema = z.string().min(1).max(EMAIL_FOLDER_PATH_MAX)
const messageSchema = z.object({
  id: z.string().min(1).max(1000),
  accountId: z.string().regex(EMAIL_ACCOUNT_ID_PATTERN),
  mailbox: mailboxSchema,
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
  /** Contrato 52: o `mailbox` dos enviados (`EmailAccountStatus.sentMailbox`). */
  sentMailbox: mailboxSchema,
})
/**
 * Contrato 52: o `<conta>.json` como fica no disco, o mesmo esquema da 0.15.0 com dois campos a mais que ela ignora: a
 * mensagem com o `folder` antigo e o `mailbox` (ausente no arquivo gravado pela 0.15.0), e o `sentMailbox`.
 */
const diskMessageSchema = messageSchema.extend({ folder: z.enum(['inbox', 'sent']), mailbox: mailboxSchema.optional() })
const diskSchema = dataSchema.extend({
  inbox: z.array(diskMessageSchema).max(EMAIL_INBOX_MAX),
  sent: z.array(diskMessageSchema).max(EMAIL_SENT_MAX),
  sentMailbox: mailboxSchema.optional(),
})
/** Contrato 52: uma pasta aberta (fora a INBOX), com o `UIDVALIDITY` dela e quando foi usada. */
const cachedFolderSchema = z.object({
  path: mailboxSchema,
  uidValidity: z.string().max(40),
  at: z.number(),
  messages: z.array(messageSchema).max(EMAIL_FOLDER_MESSAGES_MAX),
})
const folderIndexSchema = z.object({ version: z.literal(1), folders: z.record(mailboxSchema, z.object({ file: z.string().regex(/^[0-9a-f]{32}$/), at: z.number() })) })
const bodySchema = z.object({
  text: z.string().nullable(),
  html: z.string().nullable(),
  attachments: z.array(z.object({ filename: z.string().max(1000).nullable(), contentType: z.string().max(300), size: z.number().int().nonnegative() })).max(500),
})

export type EmailAccountData = z.infer<typeof dataSchema>

export type EmailCachedFolder = z.infer<typeof cachedFolderSchema>

export const emptyAccountData = (): EmailAccountData => ({ version: STORE_VERSION, uidValidity: null, polled: false, seenUidls: [], inbox: [], sent: [], sentMailbox: EMAIL_SENT_MAILBOX })

/** Contrato 52: o `<conta>.json` do disco (o desta versão ou o da 0.15.0) em memória; `null` se não se lê. */
export function migrateAccountData(raw: unknown): EmailAccountData | null {
  const parsed = diskSchema.safeParse(raw)
  if (!parsed.success) return null
  const sentMailbox = parsed.data.sentMailbox ?? EMAIL_SENT_MAILBOX
  const read = ({ folder, mailbox, ...message }: z.infer<typeof diskMessageSchema>): EmailMessage => ({ ...message, mailbox: mailbox ?? (folder === 'inbox' ? EMAIL_INBOX_MAILBOX : sentMailbox) })
  return { ...parsed.data, sentMailbox, inbox: parsed.data.inbox.map(read), sent: parsed.data.sent.map(read) }
}

/** Contrato 52: o que vai para o disco: o `folder` antigo pela lista, para a 0.15.0 ler o mesmo arquivo. */
export function toDisk(data: EmailAccountData): z.infer<typeof diskSchema> {
  return { ...data, inbox: data.inbox.map((message) => ({ ...message, folder: 'inbox' as const })), sent: data.sent.map((message) => ({ ...message, folder: 'sent' as const })) }
}

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
  /** Contrato 52: uma pasta aberta guardada (fora a INBOX), ou `null`. */
  folder(accountId: string, path: string): Promise<EmailCachedFolder | null>
  /** Contrato 52: lê, aplica e grava uma pasta aberta (`null` tira); conta como uso dela no teto de pastas. */
  updateFolder(accountId: string, path: string, change: (folder: EmailCachedFolder | null) => EmailCachedFolder | null): Promise<EmailCachedFolder | null>
  /** Contrato 52: os paths das pastas abertas guardadas. */
  folderPaths(accountId: string): Promise<string[]>
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
  const foldersDir = (accountId: string): string => join(root, `${checkId(accountId)}.folders`)
  const indexFile = (accountId: string): string => join(foldersDir(accountId), 'index.json')
  const folderFile = (accountId: string, file: string): string => join(foldersDir(accountId), `${file}.json`)

  async function readIndex(accountId: string): Promise<z.infer<typeof folderIndexSchema>> {
    const parsed = folderIndexSchema.safeParse(await readJson(indexFile(accountId)))
    return parsed.success ? parsed.data : { version: 1, folders: {} }
  }

  async function readFolder(accountId: string, path: string): Promise<EmailCachedFolder | null> {
    const entry = (await readIndex(accountId)).folders[path]
    if (!entry) return null
    const parsed = cachedFolderSchema.safeParse(await readJson(folderFile(accountId, entry.file)))
    return parsed.success && parsed.data.path === path ? parsed.data : null
  }

  const serial = <T>(accountId: string, task: () => Promise<T>): Promise<T> => {
    const run = (queues.get(accountId) ?? Promise.resolve()).then(task, task)
    queues.set(
      accountId,
      run.catch(() => undefined),
    )
    return run
  }

  async function load(accountId: string): Promise<EmailAccountData> {
    return migrateAccountData(await readJson(accountFile(accountId))) ?? emptyAccountData()
  }

  return {
    read: (accountId) => serial(accountId, () => load(accountId)),

    update: (accountId, change) =>
      serial(accountId, async () => {
        const next = dataSchema.parse(change(await load(accountId)))
        await mkdir(root, { recursive: true, mode: 0o700 })
        await writeAtomic(accountFile(accountId), `${JSON.stringify(toDisk(next))}\n`)
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

    folder: (accountId, path) => readFolder(accountId, path),

    updateFolder: (accountId, path, change) =>
      serial(accountId, async () => {
        const index = await readIndex(accountId)
        const changed = change(await readFolder(accountId, path))
        const next = changed === null ? null : cachedFolderSchema.parse({ ...changed, path })
        const folders = new Map(Object.entries(index.folders))
        const file = folders.get(path)?.file ?? fileName(`pasta:${path}`)
        await mkdir(foldersDir(accountId), { recursive: true, mode: 0o700 })
        if (next === null) {
          folders.delete(path)
          await rm(folderFile(accountId, file), { force: true })
        } else {
          await writeAtomic(folderFile(accountId, file), `${JSON.stringify(next)}\n`)
          folders.set(path, { file, at: next.at })
        }
        // Passou do teto: sai a pasta usada há mais tempo (o arquivo dela também).
        const order = [...folders].sort((a, b) => b[1].at - a[1].at)
        for (const [gone, entry] of order.slice(EMAIL_CACHED_FOLDERS_MAX)) {
          folders.delete(gone)
          await rm(folderFile(accountId, entry.file), { force: true })
        }
        await writeAtomic(indexFile(accountId), `${JSON.stringify({ version: 1, folders: Object.fromEntries(folders) })}\n`)
        return next
      }),

    folderPaths: async (accountId) => Object.keys((await readIndex(accountId)).folders),

    clearBodies: (accountId) => serial(accountId, () => rm(bodiesDir(accountId), { recursive: true, force: true })),

    remove: (accountId) =>
      serial(accountId, async () => {
        await rm(accountFile(accountId), { force: true })
        await rm(bodiesDir(accountId), { recursive: true, force: true })
        await rm(foldersDir(accountId), { recursive: true, force: true })
      }),
  }
}
