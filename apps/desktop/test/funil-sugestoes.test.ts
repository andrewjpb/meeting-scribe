// Contrato 110 (funil-vendas, CA1 e CA2): sugestões de contato (R11, R12). E-mail com 2 ou mais mensagens em 90 dias,
// endereços automáticos, contas do usuário, contatos existentes e ignorados de fora; WhatsApp só com pessoa, pelo
// telefone do chat (`@lid` pelo `phone`), sem o próprio número; agrupamento por chave com os canais juntos.
import { describe, expect, it } from 'vitest'
import type { Contato } from '../src/shared/funil'
import { sugestoesDeContato, type SugestoesInput } from '../src/shared/funil-sugestoes'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')

const contato = (parcial: Partial<Contato>): Contato => ({
  id: 'c1',
  nome: 'Contato',
  emails: [],
  telefones: [],
  empresaId: null,
  cargo: null,
  notas: '',
  whatsappChatId: null,
  origem: 'manual',
  criadoEm: NOW,
  atualizadoEm: NOW,
  arquivado: false,
  ...parcial,
})

const mensagem = (de: string, diasAtras: number, nome: string | null = null) => ({ date: NOW - diasAtras * DIA_MS, from: [{ name: nome, address: de }], to: [{ name: 'Eu', address: 'eu@minha.example' }], cc: [] })

const entrada = (parcial: Partial<SugestoesInput>): SugestoesInput => ({
  reunioes: [],
  emails: [],
  contasEmail: ['eu@minha.example'],
  whatsapp: [],
  meuTelefone: null,
  contatos: [],
  ignorados: [],
  now: NOW,
  ...parcial,
})

describe('sugestões de contato', () => {
  it('CA1: e-mail com 1 mensagem não entra; com 2 entra com interacoes 2', () => {
    const sugestoes = sugestoesDeContato(entrada({ emails: [mensagem('uma@x.example', 3), mensagem('Duas@X.example', 5, 'Dora Duas'), mensagem('duas@x.example', 40)] }))
    expect(sugestoes.map((item) => item.chave)).toEqual(['email:duas@x.example'])
    expect(sugestoes[0]).toMatchObject({ nome: 'Dora Duas', interacoes: 2, canais: ['email'], origem: 'email', email: 'duas@x.example', ultimaEm: NOW - 5 * DIA_MS })
  })

  it('CA1: só contam as mensagens dos últimos 90 dias', () => {
    const sugestoes = sugestoesDeContato(entrada({ emails: [mensagem('velho@x.example', 10), mensagem('velho@x.example', 91)] }))
    expect(sugestoes).toEqual([])
  })

  it('CA1: noreply com 5 mensagens não entra, nem os outros automáticos', () => {
    const automaticos = ['noreply@x.example', 'no-reply@x.example', 'nao-responda@x.example', 'newsletter@x.example', 'notifications@x.example', 'mailer-daemon@x.example', 'bounce-123@x.example']
    const emails = automaticos.flatMap((endereco) => [1, 2, 3, 4, 5].map((dias) => mensagem(endereco, dias)))
    expect(sugestoesDeContato(entrada({ emails }))).toEqual([])
  })

  it('CA1: e-mail já de contato, chave ignorada e conta do usuário não entram', () => {
    const emails = [mensagem('cliente@x.example', 1), mensagem('cliente@x.example', 2), mensagem('ignorado@x.example', 1), mensagem('ignorado@x.example', 2), mensagem('eu@minha.example', 1), mensagem('eu@minha.example', 2)]
    const sugestoes = sugestoesDeContato(
      entrada({
        emails,
        contatos: [contato({ emails: ['cliente@x.example'] })],
        ignorados: [{ chave: 'email:ignorado@x.example', at: NOW }],
      }),
    )
    expect(sugestoes).toEqual([])
  })

  it('CA2: só o chat de pessoa com mensagem há 10 dias entra, com a chave do telefone', () => {
    const sugestoes = sugestoesDeContato(
      entrada({
        contasEmail: [],
        whatsapp: [
          { id: '5511912345678@s.whatsapp.net', name: 'Paula', kind: 'person', lastAt: NOW - 10 * DIA_MS },
          { id: '120363000000000000@g.us', name: 'Grupo da obra', kind: 'group', lastAt: NOW - DIA_MS },
          { id: '5511955554444@s.whatsapp.net', name: 'Antigo', kind: 'person', lastAt: NOW - 100 * DIA_MS },
        ],
      }),
    )
    expect(sugestoes).toHaveLength(1)
    expect(sugestoes[0]).toMatchObject({ chave: 'tel:+5511912345678', nome: 'Paula', canais: ['whatsapp'], origem: 'whatsapp', telefone: '+5511912345678', whatsappChatId: '5511912345678@s.whatsapp.net' })
  })

  it('CA2: chat @lid usa o phone que o serviço sabe', () => {
    const sugestoes = sugestoesDeContato(entrada({ whatsapp: [{ id: '123456789012345@lid', name: 'Lia', kind: 'person', phone: '+55 11 98765-4321', lastAt: NOW - DIA_MS }] }))
    expect(sugestoes.map((item) => item.chave)).toEqual(['tel:+5511987654321'])
    expect(sugestoes[0]?.whatsappChatId).toBe('123456789012345@lid')
  })

  it('CA2: o próprio número não entra, nem com o nono dígito a menos', () => {
    const whatsapp = [
      { id: '5511987654321@s.whatsapp.net', name: 'Eu mesmo', kind: 'person' as const, lastAt: NOW - DIA_MS },
      { id: '551187654321@s.whatsapp.net', name: 'Eu sem o nono', kind: 'person' as const, lastAt: NOW - DIA_MS },
    ]
    expect(sugestoesDeContato(entrada({ whatsapp, meuTelefone: '5511987654321' }))).toEqual([])
  })

  it('CA2: telefone já de contato (com ou sem o nono dígito) não entra', () => {
    const whatsapp = [{ id: '551187654321@s.whatsapp.net', name: 'Cliente', kind: 'person' as const, lastAt: NOW - DIA_MS }]
    expect(sugestoesDeContato(entrada({ whatsapp, contatos: [contato({ telefones: ['+5511987654321'] })] }))).toEqual([])
  })

  it('CA2: a mesma pessoa em reunião e e-mail vira uma sugestão com os dois canais', () => {
    const sugestoes = sugestoesDeContato(
      entrada({
        reunioes: [{ id: 'm1', startedAt: new Date(NOW - 20 * DIA_MS).toISOString(), attendees: [{ name: 'Rita Reis', email: 'rita@cliente.example' }] }],
        emails: [mensagem('rita@cliente.example', 2), mensagem('rita@cliente.example', 4)],
      }),
    )
    expect(sugestoes).toHaveLength(1)
    expect(sugestoes[0]).toMatchObject({ chave: 'email:rita@cliente.example', nome: 'Rita Reis', canais: ['reuniao', 'email'], interacoes: 3, origem: 'email', ultimaEm: NOW - 2 * DIA_MS })
  })

  it('CA2: empate de interações fica com a reunião; a ordem é pela última data', () => {
    const sugestoes = sugestoesDeContato(
      entrada({
        reunioes: [
          { id: 'm1', startedAt: new Date(NOW - 2 * DIA_MS).toISOString(), attendees: [{ name: 'Bia', email: 'bia@x.example' }] },
          { id: 'm2', startedAt: new Date(NOW - 3 * DIA_MS).toISOString(), attendees: [{ name: 'Bia', email: 'bia@x.example' }] },
          { id: 'm3', startedAt: new Date(NOW - DIA_MS).toISOString(), attendees: [{ name: '', email: 'sem.nome@x.example' }] },
        ],
        emails: [mensagem('bia@x.example', 5), mensagem('bia@x.example', 6)],
      }),
    )
    expect(sugestoes.map((item) => [item.chave, item.nome, item.origem])).toEqual([
      ['email:sem.nome@x.example', 'sem.nome', 'reuniao'],
      ['email:bia@x.example', 'Bia', 'reuniao'],
    ])
  })

  it('CA2: nenhum caminho devolve o canal agenda', () => {
    const sugestoes = sugestoesDeContato(
      entrada({
        reunioes: [{ id: 'm1', startedAt: new Date(NOW).toISOString(), attendees: [{ name: 'Ana', email: 'ana@x.example' }] }],
        emails: [mensagem('beto@x.example', 1), mensagem('beto@x.example', 2)],
        whatsapp: [{ id: '5511912345678@s.whatsapp.net', name: 'Caio', kind: 'person', lastAt: NOW }],
      }),
    )
    expect(sugestoes).toHaveLength(3)
    for (const sugestao of sugestoes) {
      expect(sugestao.canais).not.toContain('agenda')
      expect(sugestao.origem).not.toBe('agenda')
    }
    expect(Object.keys(entrada({}))).not.toContain('agenda')
  })
})
