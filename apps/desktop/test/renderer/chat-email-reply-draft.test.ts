// Contrato 168 (pastas-assistente E3 e E5): o total do cartão com anexos, quando ele abre no Composer em vez de enviar, e o
// rascunho que vai para o store do email (o texto do cartão, os anexos lidos pelo main e os que ficaram de fora).
import { describe, expect, it } from 'vitest'
import { emailReplyHasAttachments } from '../../src/shared/assistant'
import { withSignature, type EmailSignature } from '../../src/shared/email-signature'
import { composeDraftOf, composePathOf, emailReplyTotalText } from '../../src/renderer/src/features/chat/emailReplyDraft'

const MB = 1024 * 1024

describe('cartão da resposta com anexos (CA4, CA5)', () => {
  it('total como no mockup 05; com anexo ou faltante abre no Composer, sem os dois é o cartão de sempre', () => {
    expect(emailReplyTotalText([{ bytes: Math.round(1.2 * MB) }, { bytes: 240 * 1024 }])).toBe('Total: 1,4 MB de 20 MB')
    expect(emailReplyTotalText([])).toBe('Total: 0 bytes de 20 MB')
    expect(emailReplyHasAttachments({ attachments: [], missing: [] })).toBe(false)
    expect(emailReplyHasAttachments({ attachments: [], missing: ['certidão'] })).toBe(true)
    expect(emailReplyHasAttachments({ attachments: [{ id: '0123456789abcdef', name: 'a.pdf', relPath: 'a.pdf', folderLabel: 'Docs', bytes: 1, requested: null }], missing: [] })).toBe(true)
  })

  it('o rascunho leva o texto editado no cartão, os anexos e os pulados; a pasta da respondida no caminho, sem `state`', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const result = {
      ok: true as const,
      accountId: 'conta-1',
      mailbox: null,
      to: ['michel@cliente.example'],
      subject: 'Re: Documentos',
      text: 'texto do modelo',
      inReplyTo: '<m3@cliente.example>',
      attachments: [{ name: 'a.pdf', bytes }],
      skipped: ['b.pdf'],
    }
    expect(composeDraftOf(result, 'texto editado')).toEqual({
      accountId: 'conta-1',
      mode: 'reply',
      to: [{ address: 'michel@cliente.example', valid: true }],
      cc: [],
      subject: 'Re: Documentos',
      text: 'texto editado',
      inReplyTo: '<m3@cliente.example>',
      attachments: [{ name: 'a.pdf', bytes }],
      skippedAttachments: ['b.pdf'],
      signed: false,
    })
    // A assinatura da conta entra no fim do texto do cartão (não há citação: o texto inteiro é o corpo); desligada para
    // resposta, ou sem assinatura, o texto fica como veio.
    const signature: EmailSignature = { text: 'Andrew\nLAP', onNew: true, onReply: true }
    const signed = composeDraftOf(result, 'texto editado', signature)
    expect(signed.text).toBe(withSignature({ text: 'texto editado', quote: '' }, signature, 'reply').text)
    expect(signed.text.startsWith('texto editado\n\n')).toBe(true)
    expect(signed.text).toContain('Andrew\nLAP')
    expect(signed.signed).toBe(true)
    expect(composeDraftOf(result, 'texto editado', { ...signature, onReply: false })).toMatchObject({ text: 'texto editado', signed: false })
    expect(composePathOf(result)).toBe('/email/conta-1/entrada')
    expect(composePathOf({ accountId: 'conta-1', mailbox: 'Arquivo' })).toBe('/email/conta-1/p~Arquivo')
  })
})
