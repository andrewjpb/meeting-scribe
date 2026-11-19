// IMAP (contrato 42, R2 da PRD) pelo `imapflow`: só a INBOX e a pasta de enviados. O serviço fala com a interface
// `ImapSession`, que os testes trocam por um cliente falso; aqui fica só a ponte para a biblioteca. A biblioteca é
// carregada na primeira conexão: sem ela, a conta fica com erro e o resto do app segue (N4). Mensagem nova chega pelo
// `EXISTS` do IDLE, que o `imapflow` mantém sozinho enquanto a conexão está parada. Logs da biblioteca desligados:
// nada do protocolo (nem o `LOGIN`) vai a log.
import type { ConnectionOptions } from 'node:tls'
import type { FetchMessageObject, ImapFlow, MessageAddressObject } from 'imapflow'
import { EMAIL_RAW_MAX_BYTES, type EmailAddress, type EmailSecurity } from '../../shared/email'

export interface ImapConfig {
  host: string
  port: number
  security: EmailSecurity
  user: string
  pass: string
  tls?: ConnectionOptions | undefined
}

/** Uma mensagem da INBOX como o servidor descreve (`UID`, `FLAGS`, `ENVELOPE` e o cabeçalho `References`). */
export interface ImapMessage {
  uid: number
  flags: string[]
  date: number
  subject: string
  from: EmailAddress[]
  to: EmailAddress[]
  cc: EmailAddress[]
  messageId: string | null
  inReplyTo: string | null
  references: string[]
}

export interface ImapSession {
  /** `UIDVALIDITY` da INBOX: mudou, os UIDs guardados não valem mais. */
  readonly uidValidity: string
  /** As últimas `limit` mensagens da INBOX. */
  recent(limit: number): Promise<ImapMessage[]>
  /** As mensagens com UID acima de `uid`. */
  since(uid: number): Promise<ImapMessage[]>
  /** A mensagem inteira (RFC 822); `null` se ela sumiu, `too-big` se passa do limite (nem é baixada). */
  source(uid: number): Promise<Buffer | 'too-big' | null>
  /** `UID STORE +FLAGS (\Seen)` (ou `-FLAGS`). */
  setSeen(uid: number, seen: boolean): Promise<void>
  /** `UID STORE +FLAGS (\Deleted)` e `EXPUNGE`. */
  remove(uid: number): Promise<void>
  /** `APPEND` na pasta de enviados (`\Sent`, ou pelo nome); `false` quando o servidor não tem uma. */
  appendSent(raw: Buffer): Promise<boolean>
  /** O IDLE avisou mensagem nova na INBOX. */
  onNew(listener: () => void): void
  /** A conexão caiu (ou o servidor a fechou). */
  onClose(listener: (error: unknown) => void): void
  close(): Promise<void>
}

export type ImapConnect = (config: ImapConfig) => Promise<ImapSession>

const address = (list: MessageAddressObject[] | undefined): EmailAddress[] =>
  (list ?? []).filter((item) => typeof item.address === 'string' && item.address !== '').map((item) => ({ name: item.name ? item.name : null, address: item.address ?? '' }))

/** Os Message-IDs de um cabeçalho `References` (ou `In-Reply-To`). */
export function messageIds(header: string): string[] {
  return [...header.matchAll(/<[^<>\s]{1,250}>/g)].map((match) => match[0]).slice(-50)
}

export function toImapMessage(message: FetchMessageObject): ImapMessage {
  const envelope = message.envelope ?? {}
  const date = envelope.date ? new Date(envelope.date).getTime() : NaN
  const references = message.headers ? messageIds(message.headers.toString('latin1').replace(/\r\n[ \t]+/g, ' ')) : []
  return {
    uid: message.uid,
    flags: [...(message.flags ?? [])],
    date: Number.isFinite(date) ? date : 0,
    subject: envelope.subject ?? '',
    from: address(envelope.from),
    to: address(envelope.to),
    cc: address(envelope.cc),
    messageId: envelope.messageId ?? null,
    inReplyTo: envelope.inReplyTo ?? null,
    references,
  }
}

const QUERY = { uid: true, flags: true, envelope: true, headers: ['references'] }
const SENT_NAMES = /^(sent|sent items|sent messages|sent mail|enviados|itens enviados|mensagens enviadas)$/i

export const connectImap: ImapConnect = async (config) => {
  const { ImapFlow: Client } = await import('imapflow')
  const client: ImapFlow = new Client({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    // `starttls`: sem o STARTTLS do servidor, não conecta (a senha não vai em texto puro).
    doSTARTTLS: config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    ...(config.tls ? { tls: config.tls } : {}),
  })
  // Sem ouvinte, um `error` derrubaria o processo.
  client.on('error', () => undefined)
  let inbox: Awaited<ReturnType<ImapFlow['mailboxOpen']>>
  try {
    await client.connect()
    inbox = await client.mailboxOpen('INBOX')
  } catch (error) {
    // Sem a INBOX a sessão não serve: fecha já, senão cada nova tentativa deixaria uma conexão aberta.
    client.close()
    throw error
  }
  const fetchRange = async (range: string, byUid: boolean): Promise<ImapMessage[]> =>
    (await client.fetchAll(range, QUERY, { uid: byUid })).map(toImapMessage).sort((a, b) => a.uid - b.uid)

  return {
    uidValidity: String(inbox.uidValidity),

    async recent(limit) {
      const exists = client.mailbox ? client.mailbox.exists : 0
      if (exists === 0) return []
      return fetchRange(`${Math.max(1, exists - limit + 1)}:*`, false)
    },

    async since(uid) {
      // `N:*` sempre devolve a última, mesmo com UID menor: o filtro tira.
      return (await fetchRange(`${uid + 1}:*`, true)).filter((message) => message.uid > uid)
    },

    async source(uid) {
      const found = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
      if (!found) return null
      if ((found.size ?? 0) > EMAIL_RAW_MAX_BYTES) return 'too-big'
      const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      return full && full.source ? full.source : null
    },

    async setSeen(uid, seen) {
      if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    },

    async remove(uid) {
      // O `imapflow` marca `\Deleted` e faz o `UID EXPUNGE` (ou `EXPUNGE`) dessa mensagem.
      await client.messageDelete(String(uid), { uid: true })
    },

    async appendSent(raw) {
      const boxes = await client.list()
      const sent = boxes.find((box) => box.specialUse === '\\Sent') ?? boxes.find((box) => SENT_NAMES.test(box.name))
      if (!sent) return false
      return (await client.append(sent.path, raw, ['\\Seen'])) !== false
    },

    onNew(listener) {
      client.on('exists', (event: { path: string; count: number; prevCount: number }) => {
        if (event.path === 'INBOX' && event.count > event.prevCount) listener()
      })
    },

    onClose(listener) {
      client.on('close', () => listener(null))
    },

    async close() {
      await client.logout().catch(() => client.close())
    },
  }
}
