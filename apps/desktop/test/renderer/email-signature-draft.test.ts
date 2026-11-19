// Contrato 54 (CA4): o rascunho de Nova mensagem, Responder, Responder a todos e Encaminhar com a assinatura da conta,
// acima da citação. A função que monta o texto (`withSignature`) é testada em test/email-signature.test.ts.
import { describe, expect, it } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import type { EmailSignature } from '../../src/shared/email-signature'
import { composeFrom, createDraftRequests, emptyDraft, signedDraft } from '../../src/renderer/src/features/email/format'

const SIGNATURE: EmailSignature = { text: 'Andrew Pereira\nLAP Software', onNew: true, onReply: true }

describe('rascunho com a assinatura (CA4)', () => {
  const message: EmailMessage = {
    id: '1',
    accountId: 'conta',
    mailbox: 'INBOX',
    uid: 1,
    seen: true,
    flagged: false,
    answered: false,
    from: [{ name: 'Marina', address: 'marina@cliente.example' }],
    to: [{ name: null, address: 'andrew@lap.example' }],
    cc: [],
    subject: 'Proposta',
    date: Date.parse('2026-11-19T17:05:00Z'),
    messageId: '<m1@cliente.example>',
    inReplyTo: null,
    references: [],
  }
  const account = { id: 'conta', address: 'andrew@lap.example', sentMailbox: 'Sent' }

  it('nova, responder, responder a todos e encaminhar: a assinatura no campo, acima da citação', () => {
    expect(signedDraft(emptyDraft('conta'), SIGNATURE).text).toBe('\n\n-- \nAndrew Pereira\nLAP Software')
    for (const mode of ['reply', 'replyAll', 'forward'] as const) {
      const plain = composeFrom(mode, message, { text: 'Oi', html: null }, account)
      const signed = signedDraft(plain, SIGNATURE)
      expect(signed.text).toBe(`\n\n-- \nAndrew Pereira\nLAP Software${plain.text}`)
      expect({ ...signed, text: plain.text }).toEqual(plain)
    }
  })

  it('sem assinatura (o main não respondeu) ou interruptor desligado: o rascunho como veio', () => {
    const plain = composeFrom('reply', message, { text: 'Oi', html: null }, account)
    expect(signedDraft(plain, null)).toBe(plain)
    expect(signedDraft(plain, { ...SIGNATURE, onReply: false }).text).toBe(plain.text)
    expect(signedDraft(emptyDraft('conta'), { ...SIGNATURE, onNew: false }).text).toBe('')
  })

  it('assinar de novo um rascunho já assinado não duplica (o texto real do rascunho entra na conferência)', () => {
    for (const mode of ['reply', 'forward'] as const) {
      const once = signedDraft(composeFrom(mode, message, { text: 'Oi', html: null }, account), SIGNATURE)
      expect(signedDraft(once, SIGNATURE).text).toBe(once.text)
    }
    const fresh = signedDraft(emptyDraft('conta'), SIGNATURE)
    expect(signedDraft(fresh, SIGNATURE).text).toBe(fresh.text)
  })
})

describe('só o último pedido de rascunho abre (CA4)', () => {
  it('clique duplo: a primeira resposta é descartada; abrir outra mensagem descarta a pendente', () => {
    const requests = createDraftRequests()
    const first = requests.start()
    const second = requests.start()
    expect(requests.current(first)).toBe(false)
    expect(requests.current(second)).toBe(true)
    requests.cancel()
    expect(requests.current(second)).toBe(false)
    expect(requests.current(requests.start())).toBe(true)
  })
})
