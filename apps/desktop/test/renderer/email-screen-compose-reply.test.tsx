// Contrato 157 (CA5, D12): o "Abrir no Composer" do Painel chega à Caixa de Entrada com `state.compose.replyTo`; a tela
// acha a mensagem no cache (`findReplyTarget`) e abre o rascunho de Responder pelo mesmo `composedDraft` da tela, com a
// resposta sugerida no topo. Sem a mensagem, nada abre (a tela mostra a nota). Nada é enviado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import type { EmailSignature } from '../../src/shared/email-signature'
import { findReplyTarget, folderKey, useEmail } from '../../src/renderer/src/features/email/emailStore'
import { composedDraft, replyDraftText } from '../../src/renderer/src/features/email/format'

const A = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const account = { id: A, address: 'andrew@lap.example', sentMailbox: 'Sent' }
const SIGNATURE: EmailSignature = { text: 'Andrew Pereira\nLAP Software', onNew: true, onReply: true }

const message: EmailMessage = {
  id: 'k',
  accountId: A,
  mailbox: 'INBOX',
  uid: 7,
  seen: false,
  flagged: false,
  answered: false,
  from: [{ name: 'Rafael Lima', address: 'rafael@cliente.example' }],
  to: [{ name: null, address: 'andrew@lap.example' }],
  cc: [],
  subject: 'Aceite da proposta',
  date: Date.parse('2026-11-23T12:05:00Z'),
  messageId: '<aceite@cliente.example>',
  inReplyTo: null,
  references: [],
}

describe('Composer pré-preenchido pelo Painel (CA5)', () => {
  const invoke = vi.fn()
  const emailSend = vi.fn()

  beforeEach(() => {
    invoke.mockReset()
    emailSend.mockReset()
    vi.stubGlobal('window', { __scribeApi: { invoke, emailSend } })
    useEmail.setState({ folders: { [folderKey(A, 'inbox')]: [message] } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a mensagem do cache vira Responder com a resposta no topo, a assinatura e a citação; nada é enviado', async () => {
    const found = await findReplyTarget(A, { messageKey: 'k', mailbox: 'INBOX' })
    expect(found).toBe(message)
    expect(invoke).not.toHaveBeenCalled()
    const draft = composedDraft('reply', message, { text: 'Podemos fechar?', html: null }, account, SIGNATURE, 'Olá, obrigado.')
    expect(draft.mode).toBe('reply')
    expect(draft.inReplyTo).toBe('<aceite@cliente.example>')
    expect(draft.to.map((item) => item.address)).toEqual(['rafael@cliente.example'])
    expect(draft.subject).toBe('Re: Aceite da proposta')
    expect(draft.text.startsWith('Olá, obrigado.\n\n')).toBe(true)
    // D12: a resposta, uma linha em branco, a assinatura, outra linha em branco e a citação.
    expect(draft.text).toMatch(/^Olá, obrigado\.\n\n-- \nAndrew Pereira\nLAP Software\n\nEm .*Rafael Lima <rafael@cliente\.example> escreveu:\n> Podemos fechar\?$/)
    expect(draft.signed).toBe(true)
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('sem assinatura, a resposta e a citação, com uma linha em branco entre elas', () => {
    const draft = composedDraft('reply', message, { text: 'Oi', html: null }, account, null, 'Combinado.\n')
    expect(draft.text).toMatch(/^Combinado\.\n\nEm .* escreveu:\n> Oi$/)
    expect(replyDraftText('A', '\n\nB')).toBe('A\n\nB')
  })

  it('fora da lista guardada, procura no cache do main', async () => {
    useEmail.setState({ folders: {} })
    invoke.mockResolvedValue([message])
    expect(await findReplyTarget(A, { messageKey: 'k', mailbox: 'INBOX' })).toBe(message)
    expect(invoke).toHaveBeenCalledWith('scribe:email-messages', { accountId: A, folder: 'inbox' })
  })

  it('a mensagem que saiu da Caixa de Entrada: nenhum rascunho (a tela mostra "Este e-mail saiu da Caixa de Entrada")', async () => {
    invoke.mockResolvedValue([])
    expect(await findReplyTarget(A, { messageKey: 'sumiu', mailbox: 'INBOX' })).toBeNull()
    expect(emailSend).not.toHaveBeenCalled()
  })
})
