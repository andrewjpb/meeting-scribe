// SMTP (contrato 42, R4 da PRD) pelo `nodemailer`. A mensagem é montada aqui (`MailComposer`) e sai já pronta: os
// mesmos bytes vão ao SMTP e ao `APPEND` da pasta de enviados. Uma conexão por envio, fechada no fim. A biblioteca é
// carregada no primeiro envio; os logs dela ficam desligados. O erro volta num tipo curto, sem a resposta do servidor.
import { isIP } from 'node:net'
import type { ConnectionOptions } from 'node:tls'
import type { EmailAddress, EmailSecurity } from '../../shared/email'

export interface SmtpConfig {
  host: string
  port: number
  security: EmailSecurity
  user: string
  pass: string
  tls?: ConnectionOptions | undefined
}

export interface OutgoingMail {
  from: EmailAddress
  to: string[]
  subject: string
  text: string
  /** Com os `<` e `>`. */
  messageId: string
  inReplyTo: string | null
  references: string[]
  date: Date
}

export type SmtpErrorKind = 'auth' | 'connection' | 'rejected' | 'failed'

export class SmtpError extends Error {
  constructor(readonly kind: SmtpErrorKind) {
    super(`smtp: ${kind}`)
    this.name = 'SmtpError'
  }
}

/** Manda a mensagem e devolve os bytes enviados (para o `APPEND`). Lança `SmtpError`. */
export type SmtpSend = (config: SmtpConfig, mail: OutgoingMail) => Promise<Buffer>

/** A mensagem em RFC 5322, com From, Message-ID e, se for resposta, In-Reply-To e References. */
export async function buildMessage(mail: OutgoingMail): Promise<Buffer> {
  const { default: MailComposer } = await import('nodemailer/lib/mail-composer')
  return new MailComposer({
    from: mail.from.name ? { name: mail.from.name, address: mail.from.address } : mail.from.address,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId: mail.messageId,
    date: mail.date,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
    ...(mail.references.length > 0 ? { references: mail.references } : {}),
  })
    .compile()
    .build()
}

/** Erro do `nodemailer` (ou do socket) no tipo curto. */
export function smtpErrorKind(error: unknown): SmtpErrorKind {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; responseCode?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : ''
  if (code === 'EAUTH' || code === 'ENOAUTH') return 'auth'
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'EPROTOCOL'].includes(code)) return 'connection'
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return 'rejected'
  if (typeof record.responseCode === 'number' && record.responseCode >= 500) return 'rejected'
  return 'failed'
}

export const sendSmtp: SmtpSend = async (config, mail) => {
  const raw = await buildMessage(mail)
  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    // `starttls`: sem o STARTTLS do servidor, não envia; `none`: nem tenta.
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    auth: { user: config.user, pass: config.pass },
    logger: false,
    debug: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
    tls: { ...(isIP(config.host) ? {} : { servername: config.host }), ...config.tls },
  })
  try {
    await transport.sendMail({ envelope: { from: mail.from.address, to: mail.to }, raw })
    return raw
  } catch (error) {
    throw new SmtpError(smtpErrorKind(error))
  } finally {
    transport.close()
  }
}
