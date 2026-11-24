// Contrato 160: as regras puras do centro de notificações (a lista, o filtro, a contagem, o resumo e a prévia).
import { describe, expect, it } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import { contarNotificacoes, filtrarNotificacoes, montarNotificacoes, previaDaMensagem, resumoNotificacoes, type NotificacoesInput } from '../../src/shared/notificacoes'
import { etiquetaVazia } from '../../src/shared/triagem'
import type { WhatsAppChat, WhatsAppMessage } from '../../src/shared/whatsapp'

const mensagem = (over: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({
  id: 'm1',
  chatId: 'c',
  author: 'Ana',
  fromMe: false,
  at: 0,
  type: 'text',
  text: 'oi',
  media: null,
  ...over,
})

const chat = (id: string, unread: number, at: number, kind: WhatsAppChat['kind'] = 'person'): WhatsAppChat => ({
  id,
  name: `Nome ${id}`,
  kind,
  unread,
  lastMessage: mensagem({ chatId: id, at, text: `última de ${id}` }),
})

const email = (accountId: string, id: string, seen: boolean, date: number): EmailMessage => ({
  id,
  accountId,
  mailbox: 'INBOX',
  uid: 1,
  seen,
  flagged: false,
  answered: false,
  from: [{ name: `De ${id}`, address: `${id}@x.com` }],
  to: [],
  cc: [],
  subject: `Assunto ${id}`,
  date,
  messageId: null,
  inReplyTo: null,
  references: [],
})

const input = (over: Partial<NotificacoesInput> = {}): NotificacoesInput => ({
  chats: [chat('p1@s.whatsapp.net', 2, 500), chat('p2@s.whatsapp.net', 0, 600), chat('g1@g.us', 4, 300, 'group')],
  incluirGrupos: false,
  etiquetas: {},
  contas: [
    { id: 'a', label: 'oi@lap.com.br' },
    { id: 'b', label: 'contato@lap.com.br' },
  ],
  folders: { 'a:inbox': [email('a', 'e1', false, 400), email('a', 'e2', true, 700)], 'b:inbox': [email('b', 'e3', false, 200)], 'a:sent': [email('a', 'e9', false, 900)] },
  ...over,
})

describe('montarNotificacoes (CA1)', () => {
  it('WhatsApp só com não lidas, e grupo só com incluirGrupos', () => {
    const sem = montarNotificacoes(input()).filter((item) => item.kind === 'whatsapp')
    expect(sem).toHaveLength(1)
    expect(sem[0]).toMatchObject({ chatId: 'p1@s.whatsapp.net', naoLidas: 2, nome: 'Nome p1@s.whatsapp.net', previa: 'última de p1@s.whatsapp.net', at: 500, urgente: false })
    expect(montarNotificacoes(input({ incluirGrupos: true })).filter((item) => item.kind === 'whatsapp')).toHaveLength(2)
  })

  it('e-mails não lidos da Caixa de Entrada de cada conta, com o rótulo da conta', () => {
    const emails = montarNotificacoes(input()).filter((item) => item.kind === 'email')
    expect(emails).toEqual([
      { kind: 'email', accountId: 'a', id: 'e1', de: 'De e1', assunto: 'Assunto e1', at: 400, conta: 'oi@lap.com.br' },
      { kind: 'email', accountId: 'b', id: 'e3', de: 'De e3', assunto: 'Assunto e3', at: 200, conta: 'contato@lap.com.br' },
    ])
  })

  it('ordem por at decrescente, misturando as origens', () => {
    const ordem = montarNotificacoes(input({ incluirGrupos: true })).map((item) => (item.kind === 'whatsapp' ? item.chatId : item.id))
    expect(ordem).toEqual(['p1@s.whatsapp.net', 'e1', 'g1@g.us', 'e3'])
  })

  it('urgente vem de etiquetas[chatId].urgente === true', () => {
    const etiquetas = { 'p1@s.whatsapp.net': { ...etiquetaVazia(1), urgente: true }, 'g1@g.us': { ...etiquetaVazia(1), urgente: false } }
    const itens = montarNotificacoes(input({ incluirGrupos: true, etiquetas }))
    const urgente = Object.fromEntries(itens.flatMap((item) => (item.kind === 'whatsapp' ? [[item.chatId, item.urgente]] : [])))
    expect(urgente).toEqual({ 'p1@s.whatsapp.net': true, 'g1@g.us': false })
  })

  it('remetente sem nome vira o endereço; conta sem a Entrada carregada não dá linha', () => {
    const semNome = { ...email('a', 'e4', false, 1), from: [{ name: null, address: 'z@x.com' }] }
    const itens = montarNotificacoes(input({ chats: [], folders: { 'a:inbox': [semNome] } }))
    expect(itens).toEqual([{ kind: 'email', accountId: 'a', id: 'e4', de: 'z@x.com', assunto: 'Assunto e4', at: 1, conta: 'oi@lap.com.br' }])
  })
})

describe('contarNotificacoes e resumoNotificacoes (CA2)', () => {
  it('5 não lidas em 2 chats + 2 e-mails → 7', () => {
    const itens = montarNotificacoes(input({ chats: [chat('p1', 2, 1), chat('p2', 3, 2)] }))
    const contagem = contarNotificacoes(itens)
    expect(contagem).toEqual({ total: 7, whatsapp: 5, email: 2 })
    expect(resumoNotificacoes(contagem)).toBe('7 por ler: 5 mensagens no WhatsApp e 2 e-mails.')
  })

  it('singular, uma origem só e nada', () => {
    expect(resumoNotificacoes({ total: 1, whatsapp: 1, email: 0 })).toBe('1 mensagem no WhatsApp por ler.')
    expect(resumoNotificacoes({ total: 1, whatsapp: 0, email: 1 })).toBe('1 e-mail por ler.')
    expect(resumoNotificacoes({ total: 2, whatsapp: 0, email: 2 })).toBe('2 e-mails por ler.')
    expect(resumoNotificacoes({ total: 2, whatsapp: 1, email: 1 })).toBe('2 por ler: 1 mensagem no WhatsApp e 1 e-mail.')
    expect(resumoNotificacoes({ total: 0, whatsapp: 0, email: 0 })).toBe('Nada por ler.')
  })
})

describe('filtrarNotificacoes (CA3)', () => {
  const itens = montarNotificacoes(input({ incluirGrupos: true }))
  it('email só e-mails; whatsapp só WhatsApp; todas tudo', () => {
    expect(filtrarNotificacoes(itens, 'email').every((item) => item.kind === 'email')).toBe(true)
    expect(filtrarNotificacoes(itens, 'email')).toHaveLength(2)
    expect(filtrarNotificacoes(itens, 'whatsapp').every((item) => item.kind === 'whatsapp')).toBe(true)
    expect(filtrarNotificacoes(itens, 'whatsapp')).toHaveLength(2)
    expect(filtrarNotificacoes(itens, 'todas')).toEqual(itens)
  })
})

describe('previaDaMensagem (CA4)', () => {
  it('uma linha só, sem \\n', () => {
    expect(previaDaMensagem(mensagem({ text: '  linha 1\nlinha 2\n\n  linha 3 ' }))).toBe('linha 1 linha 2 linha 3')
  })

  it('mídia sem texto vira o rótulo entre colchetes; com legenda, a legenda', () => {
    expect(previaDaMensagem(mensagem({ type: 'image', text: '', media: { kind: 'image', mime: 'image/jpeg', size: 10, name: null } }))).toBe('[imagem]')
    expect(previaDaMensagem(mensagem({ type: 'audio', text: '' }))).toBe('[áudio]')
    expect(previaDaMensagem(mensagem({ type: 'document', text: '' }))).toBe('[documento]')
    expect(previaDaMensagem(mensagem({ type: 'image', text: 'olha isso' }))).toBe('olha isso')
  })

  it('null → vazio', () => {
    expect(previaDaMensagem(null)).toBe('')
  })
})
