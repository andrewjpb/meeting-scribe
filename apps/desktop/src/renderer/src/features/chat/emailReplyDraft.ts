// Contrato 168 (pastas-assistente E3 e E5): o que o cartão da resposta com anexos mostra e o rascunho que ele põe no
// Composer. Os bytes vêm do `scribe:chat-action-email-compose` e vão direto para o store do email (nunca para o
// `history.state` da navegação); o texto é o do cartão, com a edição da pessoa.
import type { EmailComposeFromAction, EmailReplyAttachment } from '@shared/assistant'
import { EMAIL_ATTACH_MAX_BYTES } from '@shared/email'
import { withSignature, type EmailSignature } from '@shared/email-signature'
import { emailPath } from '@shared/routes'
import { parseRecipients, signatureEntered, sizeLabel, type ComposeDraft } from '../email/format'

/** "Total: 1,4 MB de 20 MB" (a soma do que vai anexo, pelo tamanho do índice). */
export function emailReplyTotalText(attachments: readonly Pick<EmailReplyAttachment, 'bytes'>[]): string {
  const total = attachments.reduce((sum, item) => sum + item.bytes, 0)
  return `Total: ${sizeLabel(total)} de ${EMAIL_ATTACH_MAX_BYTES / (1024 * 1024)} MB`
}

type ComposeReady = Extract<EmailComposeFromAction, { ok: true }>

/**
 * O rascunho de resposta do Composer: o destinatário, o assunto e o Message-ID do main; o texto do cartão, com a assinatura da
 * conta de resposta (o texto inteiro é o corpo: não há citação); os anexos lidos. Sem assinatura (`null`), o texto como veio.
 */
export function composeDraftOf(result: ComposeReady, text: string, signature: EmailSignature | null = null): ComposeDraft {
  return {
    accountId: result.accountId,
    mode: 'reply',
    to: parseRecipients(result.to.join('\n')),
    cc: [],
    subject: result.subject,
    text: signature ? withSignature({ text, quote: '' }, signature, 'reply').text : text,
    inReplyTo: result.inReplyTo,
    attachments: result.attachments,
    skippedAttachments: result.skipped,
    signed: signatureEntered(signature, 'reply'),
  }
}

/** A pasta onde a respondida está: a Caixa de Entrada, ou a do servidor. */
export const composePathOf = (result: Pick<ComposeReady, 'accountId' | 'mailbox'>): string => emailPath(result.accountId, result.mailbox ? { path: result.mailbox } : 'inbox')
