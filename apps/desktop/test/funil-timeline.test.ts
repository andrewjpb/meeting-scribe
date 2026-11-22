// Contrato 110 (funil-vendas, CA3 e CA4): linha do tempo de contato e de oportunidade (R8 a R10, R29). Janela de
// e-mail da oportunidade (`criadoEm` menos 30 dias), e-mail vinculado fora do cache, reunião apagada no fim, ordem
// por data e as três formas de ligar uma conversa do WhatsApp ao contato. Contrato 124 (CA4, R18): os itens `tarefa`.
import { describe, expect, it } from 'vitest'
import type { Contato, Etapa, EventoFunil, Oportunidade } from '../src/shared/funil'
import { esfriada } from '../src/shared/funil-logic'
import { origemResumida, timelineDaOportunidade, timelineDoContato, ultimasInteracoes, type EmailFonte, type FontesTimeline } from '../src/shared/funil-timeline'
import type { Tarefa } from '../src/shared/tarefas'

const DIA_MS = 86_400_000
const D = Date.parse('2026-11-01T12:00:00.000Z')

const contato = (parcial: Partial<Contato> = {}): Contato => ({
  id: 'c1',
  nome: 'Carla Mendes',
  emails: ['carla@acme.example'],
  telefones: [],
  empresaId: null,
  cargo: null,
  notas: '',
  whatsappChatId: null,
  origem: 'manual',
  criadoEm: D,
  atualizadoEm: D,
  arquivado: false,
  ...parcial,
})

const oportunidade = (parcial: Partial<Oportunidade> = {}): Oportunidade => ({
  id: 'o1',
  titulo: 'Projeto Acme',
  empresaId: null,
  contatoIds: ['c1'],
  etapaId: 'e1',
  ordem: 0,
  valor: null,
  previsao: null,
  proximoPasso: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: D,
  atualizadoEm: D,
  movidoEm: D,
  fechadoEm: null,
  arquivado: false,
  ...parcial,
})

const email = (id: string, at: number, de = 'carla@acme.example', assunto = `Assunto ${id}`): EmailFonte => ({
  id,
  accountId: 'conta1',
  mailbox: 'INBOX',
  subject: assunto,
  from: [{ name: null, address: de }],
  to: [{ name: 'Eu', address: 'eu@minha.example' }],
  cc: [],
  date: at,
})

const fontes = (parcial: Partial<FontesTimeline> = {}): FontesTimeline => ({ reunioes: [], emails: [], contasEmail: ['eu@minha.example'], whatsapp: [], ...parcial })

describe('linha do tempo da oportunidade', () => {
  it('CA3: e-mail do contato em D-31 não entra, em D-29 entra', () => {
    const resultado = timelineDaOportunidade({
      ...fontes({ emails: [email('antigo', D - 31 * DIA_MS), email('recente', D - 29 * DIA_MS)] }),
      oportunidade: oportunidade(),
      contatos: [contato()],
      eventos: [],
    })
    expect(resultado.itens.map((item) => (item.tipo === 'email' ? item.messageId : item.tipo))).toEqual(['recente'])
  })

  it('CA3: e-mail vinculado fora do cache entra com noCache e o assunto guardado; reunião apagada vai para o fim; o resto em data decrescente', () => {
    const evento: EventoFunil = { id: 'ev1', oportunidadeId: 'o1', at: D + 3 * DIA_MS, tipo: 'nota', texto: 'Ligar na segunda' }
    const outroEvento: EventoFunil = { id: 'ev2', oportunidadeId: 'outra', at: D + 4 * DIA_MS, tipo: 'nota', texto: 'Não é desta' }
    const resultado = timelineDaOportunidade({
      ...fontes({
        reunioes: [{ id: 'm1', title: 'Kickoff', startedAt: new Date(D + DIA_MS).toISOString(), calendar: { attendees: [{ name: 'Carla', email: 'Carla@Acme.example' }] } }],
        emails: [email('cache1', D + 2 * DIA_MS)],
      }),
      oportunidade: oportunidade({
        meetingIds: ['apagada-1', 'm1'],
        emails: [
          { accountId: 'conta1', id: 'sumiu', assunto: 'Proposta assinada', de: 'Carla Mendes', data: D + 5 * DIA_MS },
          { accountId: 'conta1', id: 'cache1', assunto: 'Repetido', de: 'Carla', data: D + 2 * DIA_MS },
        ],
      }),
      contatos: [contato()],
      eventos: [evento, outroEvento],
    })
    expect(resultado.itens.map((item) => [item.tipo, item.at])).toEqual([
      ['email', D + 5 * DIA_MS],
      ['evento', D + 3 * DIA_MS],
      ['email', D + 2 * DIA_MS],
      ['reuniao', D + DIA_MS],
      ['reuniao', null],
    ])
    const [semCache, , emCache, reuniao, apagada] = resultado.itens
    expect(semCache).toMatchObject({ tipo: 'email', messageId: 'sumiu', assunto: 'Proposta assinada', de: 'Carla Mendes', noCache: true, mailbox: null })
    expect(emCache).toMatchObject({ tipo: 'email', messageId: 'cache1', noCache: false, mailbox: 'INBOX' })
    expect(reuniao).toMatchObject({ tipo: 'reuniao', meetingId: 'm1', titulo: 'Kickoff', apagada: false })
    expect(apagada).toEqual({ tipo: 'reuniao', at: null, meetingId: 'apagada-1', titulo: 'Reunião apagada', resumo: null, apagada: true })
    expect(resultado.ultimaInteracao).toBe(D + 5 * DIA_MS)
  })

  it('e-mail de conta do usuário não liga o contato', () => {
    const resultado = timelineDoContato({ ...fontes({ emails: [email('meu', D, 'eu@minha.example')] }), contato: contato({ emails: ['eu@minha.example'] }) })
    expect(resultado.itens).toEqual([])
  })
})

describe('conversas do WhatsApp ligadas ao contato', () => {
  const chat = (id: string, phone?: string) => ({ id, name: `Chat ${id}`, ...(phone ? { phone } : {}), lastMessage: { at: D, text: 'Oi' } })

  it('CA4: telefone com o nono dígito liga o chat sem ele', () => {
    const resultado = timelineDoContato({ ...fontes({ whatsapp: [chat('551187654321@s.whatsapp.net')] }), contato: contato({ telefones: ['+5511987654321'] }) })
    expect(resultado.itens).toEqual([{ tipo: 'whatsapp', at: D, chatId: '551187654321@s.whatsapp.net', nome: 'Chat 551187654321@s.whatsapp.net', ultimaMensagem: 'Oi' }])
    expect(resultado.whatsappChatIds).toEqual(['551187654321@s.whatsapp.net'])
  })

  it('CA4: chat @lid com o phone igual ao telefone do contato entra', () => {
    const resultado = timelineDoContato({ ...fontes({ whatsapp: [chat('99887766@lid', '+55 11 98765-4321'), chat('11223344@lid', '+55 21 90000-0000')] }), contato: contato({ telefones: ['+5511987654321'] }) })
    expect(resultado.whatsappChatIds).toEqual(['99887766@lid'])
  })

  it('CA4: whatsappChatId preenchido liga o chat mesmo com outro telefone', () => {
    const resultado = timelineDoContato({ ...fontes({ whatsapp: [chat('5521999990000@s.whatsapp.net')] }), contato: contato({ telefones: ['+5511987654321'], whatsappChatId: '5521999990000@s.whatsapp.net' }) })
    expect(resultado.itens.map((item) => item.tipo)).toEqual(['whatsapp'])
  })
})

describe('última interação de cada oportunidade', () => {
  it('pula a arquivada e pega o maior entre a reunião, o e-mail e o chat', () => {
    const state = {
      version: 1 as const,
      contatos: [contato({ telefones: ['+5511987654321'] })],
      empresas: [],
      oportunidades: [oportunidade(), oportunidade({ id: 'o2', arquivado: true })],
      etapas: [],
      eventos: [],
      ignorados: [],
      ultimoAvisoEm: null,
    }
    const ultimas = ultimasInteracoes({
      ...fontes({
        reunioes: [{ id: 'm1', title: 'Reunião', startedAt: new Date(D + DIA_MS).toISOString(), calendar: { attendees: [{ name: 'Carla', email: 'carla@acme.example' }] } }],
        emails: [email('e1', D + 2 * DIA_MS)],
        whatsapp: [{ id: '5511987654321@s.whatsapp.net', name: 'Carla', lastMessage: { at: D + 3 * DIA_MS, text: 'Fechado' } }],
      }),
      state,
    })
    expect(ultimas).toEqual({ o1: D + 3 * DIA_MS })
  })

  it('e-mail vinculado fora do cache conta pela data guardada: a oportunidade não esfria', () => {
    const agora = D + 40 * DIA_MS
    const op = oportunidade({ emails: [{ accountId: 'conta1', id: 'sumiu', assunto: 'Proposta', de: 'Carla', data: agora - 2 * DIA_MS }] })
    const state = { version: 1 as const, contatos: [contato()], empresas: [], oportunidades: [op], etapas: [], eventos: [], ignorados: [], ultimoAvisoEm: null }
    const ultimas = ultimasInteracoes({ ...fontes(), state })
    expect(ultimas).toEqual({ o1: agora - 2 * DIA_MS })
    const aberta: Etapa = { id: 'e1', nome: 'Contato', tipo: 'aberta', ordem: 0 }
    expect(esfriada(op, aberta, ultimas.o1 ?? 0, 7, agora)).toBe(false)
    expect(esfriada(op, aberta, op.movidoEm, 7, agora)).toBe(true)
  })
})

describe('tarefas na linha do tempo (contrato 124, R18)', () => {
  const tarefa = (parcial: Partial<Tarefa> & { id: string }): Tarefa => ({
    titulo: `Tarefa ${parcial.id}`,
    detalhe: '',
    status: 'aberta',
    importante: false,
    prazo: null,
    lembreteEm: null,
    lembreteDisparadoEm: null,
    responsavel: { tipo: 'eu' },
    origem: { tipo: 'manual' },
    vinculos: { oportunidadeId: 'o1', contatoIds: ['c1'], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
    historico: [],
    criadaEm: D,
    atualizadaEm: D,
    feitaEm: null,
    ...parcial,
  })
  const eventoTarefa = (id: string, at: number, tarefaId: string, acao: 'criada' | 'feita' | 'prazo', texto: string): EventoFunil => ({ id, oportunidadeId: 'o1', at, tipo: 'tarefa', texto, tarefa: { id: tarefaId, acao } })

  it('CA4: na oportunidade, criada vira item com título, prazo e origem; apagada tem existe false; prazo não vira item', () => {
    const doResumo = tarefa({ id: 't1', titulo: 'Enviar proposta', prazo: '2026-11-25', origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'Enviar proposta' } })
    const resultado = timelineDaOportunidade({
      ...fontes({ reunioes: [{ id: 'm1', title: 'Kickoff', startedAt: new Date(D - 10 * DIA_MS).toISOString() }] }),
      oportunidade: oportunidade({ contatoIds: [] }),
      contatos: [],
      eventos: [eventoTarefa('ev1', D + DIA_MS, 't1', 'criada', 'Enviar proposta'), eventoTarefa('ev2', D + 2 * DIA_MS, 't1', 'prazo', 'Enviar proposta'), eventoTarefa('ev3', D + 3 * DIA_MS, 'apagada', 'criada', 'Ligar para a Ana')],
      tarefas: [doResumo],
    })
    expect(resultado.itens).toEqual([
      { tipo: 'tarefa', at: D + 3 * DIA_MS, tarefaId: 'apagada', titulo: 'Ligar para a Ana', prazo: null, origem: '', acao: 'criada', existe: false },
      { tipo: 'tarefa', at: D + DIA_MS, tarefaId: 't1', titulo: 'Enviar proposta', prazo: '2026-11-25', origem: 'da reunião Kickoff', acao: 'criada', existe: true },
    ])
  })

  it('CA4: no contato, a tarefa feita com ele nos vínculos dá dois itens (feita e criada), em data decrescente', () => {
    const feita = tarefa({ id: 't2', status: 'feita', criadaEm: D + DIA_MS, feitaEm: D + 4 * DIA_MS })
    const deOutro = tarefa({ id: 't3', vinculos: { oportunidadeId: null, contatoIds: ['c9'], empresaId: null, meetingId: null, email: null, whatsappChatId: null } })
    const cancelada = tarefa({ id: 't4', status: 'cancelada', criadaEm: D + 2 * DIA_MS, feitaEm: D + 5 * DIA_MS })
    const resultado = timelineDoContato({ ...fontes(), contato: contato(), tarefas: [feita, deOutro, cancelada] })
    expect(resultado.itens.map((item) => (item.tipo === 'tarefa' ? `${item.tarefaId}:${item.acao}:${item.at}` : item.tipo))).toEqual([
      `t2:feita:${D + 4 * DIA_MS}`,
      `t4:criada:${D + 2 * DIA_MS}`,
      `t2:criada:${D + DIA_MS}`,
    ])
    // A última interação do contato continua só com reuniões, e-mails e conversas.
    expect(resultado.ultimaInteracao).toBeNull()
  })

  it('origem resumida em pt-BR', () => {
    const nomes = { reunioes: [], whatsapp: [{ id: 'w1', name: 'Ana', lastMessage: null }] }
    expect(origemResumida({ origem: { tipo: 'manual' } }, nomes)).toBe('criada por você')
    expect(origemResumida({ origem: { tipo: 'whatsapp', chatId: 'w1' } }, nomes)).toBe('da conversa com Ana')
    expect(origemResumida({ origem: { tipo: 'email', accountId: 'a', id: '1', assunto: 'Orçamento' } }, nomes)).toBe('do e-mail Orçamento')
    expect(origemResumida({ origem: { tipo: 'assistente' } }, nomes)).toBe('pelo Assistente')
    expect(origemResumida({ origem: { tipo: 'funil', oportunidadeId: 'o1' } }, nomes)).toBe('da oportunidade')
    expect(origemResumida({ origem: { tipo: 'migracao', de: 'proximo-passo' } }, nomes)).toBe('do próximo passo antigo')
    expect(origemResumida({ origem: { tipo: 'migracao', de: 'lembrete' } }, nomes)).toBe('de um lembrete antigo')
  })
})
