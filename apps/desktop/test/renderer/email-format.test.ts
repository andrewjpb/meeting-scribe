// Formatação da tela de email (contrato 43, CA6): a hora e os grupos da lista, a prévia de uma linha, as não lidas por
// conta, o nome da conta na barra lateral, os destinatários e os rascunhos de Responder, Responder a todos e Encaminhar.
import { describe, expect, it } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import {
  accountLabel,
  composeFrom,
  dayGroupLabel,
  draftHasContent,
  emailTimeLabel,
  emptyDraft,
  groupByDay,
  isGmailAddress,
  parseRecipients,
  prefixedSubject,
  previewLine,
  rowTitle,
  unreadBadge,
  unreadByAccount,
  unreadCount,
} from '../../src/renderer/src/features/email/format'

/** Contrato 52: a pasta de enviados da conta. */
const SENT = { sentMailbox: 'Sent' }
const NOW = new Date(2026, 10, 19, 15, 30)
const at = (day: number, hour = 10, minute = 0, month = 10, year = 2026): number => new Date(year, month, day, hour, minute).getTime()

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: '1',
  accountId: 'conta',
  mailbox: 'INBOX',
  uid: 1,
  seen: false,
  flagged: false,
  answered: false,
  from: [{ name: 'Marina Rocha', address: 'marina@cliente.example' }],
  to: [{ name: 'Andrew', address: 'andrew@lap.example' }, { name: null, address: 'time@lap.example' }],
  cc: [{ name: 'Paulo', address: 'paulo@cliente.example' }],
  subject: 'Proposta',
  date: at(19, 14, 5),
  messageId: '<m1@cliente.example>',
  inReplyTo: null,
  references: [],
  ...over,
})

describe('hora e grupos da lista', () => {
  it('hoje a hora, na semana o dia, no ano dia/mês, antes com o ano', () => {
    expect(emailTimeLabel(at(19, 9, 7), NOW)).toBe('09:07')
    expect(emailTimeLabel(at(18), NOW)).toBe('qua.')
    expect(emailTimeLabel(at(13), NOW)).toBe('sex.')
    expect(emailTimeLabel(at(12), NOW)).toBe('12/11')
    expect(emailTimeLabel(at(3, 10, 0, 1, 2025), NOW)).toBe('03/02/25')
  })

  it('Hoje, Ontem, Esta semana e o mês', () => {
    expect(dayGroupLabel(at(19, 0, 1), NOW)).toBe('Hoje')
    expect(dayGroupLabel(at(18, 23), NOW)).toBe('Ontem')
    expect(dayGroupLabel(at(14), NOW)).toBe('Esta semana')
    expect(dayGroupLabel(at(2), NOW)).toBe('Novembro')
    expect(dayGroupLabel(at(2, 10, 0, 9, 2025), NOW)).toBe('Outubro de 2025')
    const groups = groupByDay([message({ date: at(19) }), message({ id: '2', date: at(19, 8) }), message({ id: '3', date: at(18) })], NOW)
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['Hoje', 2],
      ['Ontem', 1],
    ])
  })
})

describe('prévia e linha da lista', () => {
  it('a primeira linha do texto, sem as citações, numa linha só', () => {
    expect(previewLine({ text: 'Bom dia!\n\nSegue o arquivo.\n> Mensagem anterior', html: null })).toBe('Bom dia! Segue o arquivo.')
    expect(previewLine({ text: null, html: '<p>Ol&aacute;, <b>Andrew</b></p>' })).toBe('Olá, Andrew')
    expect(previewLine({ text: 'x'.repeat(300), html: null })).toHaveLength(200)
    expect(previewLine(null)).toBe('')
  })

  it('Caixa de Entrada mostra quem mandou; Enviados, para quem foi', () => {
    expect(rowTitle(message(), SENT)).toBe('Marina Rocha')
    expect(rowTitle(message({ from: [{ name: null, address: 'avisos@x.example' }] }), SENT)).toBe('avisos@x.example')
    expect(rowTitle(message({ mailbox: 'Sent' }), SENT)).toBe('Para: Andrew, time@lap.example')
  })
})

describe('não lidas por conta', () => {
  it('conta só as não lidas da Caixa de Entrada, por conta', () => {
    const a = [message(), message({ id: '2', seen: true }), message({ id: '3' })]
    expect(unreadCount(a)).toBe(2)
    expect(unreadCount([message({ mailbox: 'Sent' })])).toBe(0)
    expect(unreadByAccount({ a, b: [], c: undefined })).toEqual({ a: 2, b: 0, c: 0 })
    expect(unreadBadge(0)).toBe('')
    expect(unreadBadge(7)).toBe('7')
    expect(unreadBadge(1500)).toBe('999+')
  })

  it('a conta aparece pelo nome; sem nome ou com nome repetido, pelo endereço', () => {
    const one = { id: '1', name: 'Andrew', address: 'andrew@lap.example' }
    const two = { id: '2', name: null, address: 'pessoal@x.example' }
    const three = { id: '3', name: 'andrew', address: 'outro@x.example' }
    expect(accountLabel([one, two], one)).toBe('Andrew')
    expect(accountLabel([one, two], two)).toBe('pessoal@x.example')
    expect(accountLabel([one, three], one)).toBe('andrew@lap.example')
  })
})

describe('composer', () => {
  it('destinatários por vírgula, ponto e vírgula ou espaço, com "Nome <x>", sem repetir', () => {
    expect(parseRecipients('ana@x.example, Bruno <bruno@x.example>; ANA@x.example nao-e-email')).toEqual([
      { address: 'ana@x.example', valid: true },
      { address: 'bruno@x.example', valid: true },
      { address: 'nao-e-email', valid: false },
    ])
  })

  it('Re: e Enc: sem repetir o prefixo', () => {
    expect(prefixedSubject('Re:', 'Proposta')).toBe('Re: Proposta')
    expect(prefixedSubject('Re:', 'RE: Proposta')).toBe('RE: Proposta')
    expect(prefixedSubject('Enc:', 'Fwd: Proposta')).toBe('Fwd: Proposta')
    expect(prefixedSubject('Enc:', 'Re: Proposta')).toBe('Enc: Re: Proposta')
  })

  it('Responder: para quem mandou, "Re:" e a citação com a data e o remetente', () => {
    const account = { id: 'conta', address: 'andrew@lap.example', ...SENT }
    const draft = composeFrom('reply', message(), { text: 'Linha 1\nLinha 2', html: null }, account)
    expect(draft.to).toEqual([{ address: 'marina@cliente.example', valid: true }])
    expect(draft.cc).toEqual([])
    expect(draft.subject).toBe('Re: Proposta')
    expect(draft.inReplyTo).toBe('<m1@cliente.example>')
    expect(draft.text).toBe('\n\nEm qui., 19/11/2026 14:05, Marina Rocha <marina@cliente.example> escreveu:\n> Linha 1\n> Linha 2')
  })

  it('Responder a todos: os outros de Para e Cc, sem a própria conta', () => {
    const draft = composeFrom('replyAll', message(), null, { id: 'conta', address: 'ANDREW@lap.example', ...SENT })
    expect(draft.to.map((item) => item.address)).toEqual(['marina@cliente.example'])
    expect(draft.cc.map((item) => item.address)).toEqual(['time@lap.example', 'paulo@cliente.example'])
  })

  it('Encaminhar: sem destinatário, "Enc:" e a original no texto', () => {
    const draft = composeFrom('forward', message(), { text: 'Corpo', html: null }, { id: 'conta', address: 'andrew@lap.example', ...SENT })
    expect(draft.to).toEqual([])
    expect(draft.subject).toBe('Enc: Proposta')
    expect(draft.inReplyTo).toBeNull()
    expect(draft.text).toContain('---------- Mensagem encaminhada ----------\nDe: Marina Rocha <marina@cliente.example>')
    expect(draft.text.endsWith('\nCorpo')).toBe(true)
  })

  it('rascunho vazio não tem conteúdo; Gmail é reconhecido para a dica da senha de app', () => {
    expect(draftHasContent(emptyDraft('conta'))).toBe(false)
    expect(draftHasContent({ ...emptyDraft('conta'), subject: 'x' })).toBe(true)
    expect(isGmailAddress('fulano@gmail.com')).toBe(true)
    expect(isGmailAddress('fulano@GoogleMail.com')).toBe(true)
    expect(isGmailAddress('fulano@lap.example')).toBe(false)
  })
})
