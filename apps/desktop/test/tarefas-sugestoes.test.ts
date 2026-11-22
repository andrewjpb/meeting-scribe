// Contrato 121 (tarefas, CA7 = CA10 da spec, R26): as sugestões do resumo, da análise e dos insights do WhatsApp,
// a janela de 30 dias, o que já virou tarefa, o ignorado, a opção das reuniões e o corte em 100.
import { describe, expect, it } from 'vitest'
import type { Tarefa } from '../src/shared/tarefas'
import { sugestoesDeTarefa, type SugestoesInput } from '../src/shared/tarefas-sugestoes'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-22T15:00:00.000Z')
const HOJE = '2026-11-22'

const tarefa = (patch: Partial<Tarefa>): Tarefa => ({
  id: 't-1',
  titulo: 'Tarefa',
  detalhe: '',
  status: 'aberta',
  importante: false,
  prazo: null,
  lembreteEm: null,
  lembreteDisparadoEm: null,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'manual' },
  vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  historico: [],
  criadaEm: 1,
  atualizadaEm: 1,
  feitaEm: null,
  ...patch,
})

const reuniao = (patch: Partial<SugestoesInput['reunioes'][number]> = {}): SugestoesInput['reunioes'][number] => ({
  id: 'm1',
  titulo: 'Kickoff',
  startedAt: new Date(NOW - 3 * DIA_MS).toISOString(),
  resumo: [
    { task: 'Enviar a proposta', owner: 'Você', due: 'sexta', dueIso: '2026-11-27' },
    { task: 'Revisar o contrato', owner: 'Ana', due: null },
  ],
  toConfirm: [{ text: 'Confirmar o orçamento' }],
  ...patch,
})

const conversa = (patch: Partial<SugestoesInput['conversas'][number]> = {}): SugestoesInput['conversas'][number] => ({
  chatId: 'chat-1',
  nome: 'Marina',
  lastAt: NOW - DIA_MS,
  pendenciasMinhas: ['Mandar o boleto'],
  compromissos: [],
  ...patch,
})

const input = (patch: Partial<SugestoesInput> = {}): SugestoesInput => ({
  reunioes: [reuniao()],
  conversas: [conversa()],
  tarefas: [],
  ignorados: [],
  sugerirDasReunioes: true,
  hoje: HOJE,
  now: NOW,
  ...patch,
})

describe('sugestões de tarefa (CA7)', () => {
  it('resumo "Você" com dueIso, análise sem dono e pendência minha: 3 sugestões, a mais recente primeiro', () => {
    const lista = sugestoesDeTarefa(input())
    expect(lista).toHaveLength(3)
    expect(lista[0]).toEqual({
      chave: 'whatsapp:chat-1:mandar-o-boleto',
      texto: 'Mandar o boleto',
      origem: { tipo: 'whatsapp', chatId: 'chat-1', nome: 'Marina' },
      em: NOW - DIA_MS,
      prazo: null,
      responsavelTexto: null,
    })
    expect(lista[1]).toEqual({
      chave: 'reuniao:m1:enviar-a-proposta',
      texto: 'Enviar a proposta',
      origem: { tipo: 'reuniao', meetingId: 'm1', titulo: 'Kickoff' },
      em: NOW - 3 * DIA_MS,
      prazo: '2026-11-27',
      responsavelTexto: 'Você',
    })
    expect(lista[2]).toMatchObject({ chave: 'analise:m1:confirmar-o-orcamento', origem: { tipo: 'analise', meetingId: 'm1' }, prazo: null })
  })

  it('análise com dono "Você" entra; com outro dono, não; compromisso com dd/mm ganha prazo', () => {
    const lista = sugestoesDeTarefa(
      input({
        reunioes: [reuniao({ resumo: null, toConfirm: [{ text: 'A', owner: 'Você' }, { text: 'B', owner: 'Ana' }, { text: 'C', owner: '' }] })],
        conversas: [conversa({ pendenciasMinhas: [], compromissos: [{ texto: 'Entregar a arte', quando: '28/11' }, { texto: 'Ligar', quando: 'sexta' }] })],
      }),
    )
    expect(lista.map((s) => s.texto)).toEqual(['Entregar a arte', 'Ligar', 'A', 'C'])
    expect(lista[0]?.prazo).toBe('2026-11-28')
    expect(lista[1]?.prazo).toBeNull()
  })

  it('reunião de 31 dias atrás e conversa parada há 31 dias não entram', () => {
    const lista = sugestoesDeTarefa(input({ reunioes: [reuniao({ startedAt: new Date(NOW - 31 * DIA_MS).toISOString() })], conversas: [conversa({ lastAt: NOW - 31 * DIA_MS }), conversa({ chatId: 'x', lastAt: null })] }))
    expect(lista).toEqual([])
  })

  it('tarefa já criada da linha do resumo (texto igual pelo slug) não volta, nem a de mesmo título da conversa', () => {
    const lista = sugestoesDeTarefa(
      input({
        tarefas: [
          tarefa({ origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'enviar a PROPOSTA!' }, status: 'feita' }),
          tarefa({ id: 't-2', titulo: 'Mandar o boleto.', origem: { tipo: 'whatsapp', chatId: 'chat-1' } }),
          tarefa({ id: 't-3', titulo: 'Confirmar o orçamento', origem: { tipo: 'reuniao', meetingId: 'outra', texto: 'x' } }),
        ],
      }),
    )
    expect(lista.map((s) => s.chave)).toEqual(['analise:m1:confirmar-o-orcamento'])
  })

  it('chave ignorada não entra', () => {
    const lista = sugestoesDeTarefa(input({ ignorados: [{ chave: 'reuniao:m1:enviar-a-proposta', em: 1 }] }))
    expect(lista.map((s) => s.chave)).toEqual(['whatsapp:chat-1:mandar-o-boleto', 'analise:m1:confirmar-o-orcamento'])
  })

  it('sugerirDasReunioes desligado: só a do WhatsApp', () => {
    const lista = sugestoesDeTarefa(input({ sugerirDasReunioes: false }))
    expect(lista.map((s) => s.origem.tipo)).toEqual(['whatsapp'])
  })

  it('chaves repetidas viram uma; 150 candidatas viram 100, a mais recente primeiro', () => {
    const repetida = sugestoesDeTarefa(input({ reunioes: [], conversas: [conversa({ pendenciasMinhas: ['Mandar o boleto', 'mandar o boleto!'] })] }))
    expect(repetida).toHaveLength(1)

    const conversas = Array.from({ length: 150 }, (_, i) => conversa({ chatId: `c-${i}`, lastAt: NOW - i * 60_000 }))
    const lista = sugestoesDeTarefa(input({ reunioes: [], conversas: [...conversas].reverse() }))
    expect(lista).toHaveLength(100)
    expect(lista[0]?.origem).toEqual({ tipo: 'whatsapp', chatId: 'c-0', nome: 'Marina' })
    expect(lista[99]?.em).toBe(NOW - 99 * 60_000)
  })
})
