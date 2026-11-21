// Contrato 112 (CA2): os filtros e as colunas do kanban (R23), as fechadas nos últimos 90 dias, a busca sem acento, o
// valor digitado em reais, a oportunidade aberta da empresa (aviso de duplicata, R25) e os resultados do SearchPicker.
// Contrato 119 (CA5, CA6): o "Escrever e-mail", o "Arquivar", o subtítulo, o "Abrir WhatsApp" e o "Abrir e-mail".
import { describe, expect, it } from 'vitest'
import type { Contato, Empresa, FunilState, ItemLinhaDoTempo, Oportunidade } from '../../src/shared/funil'
import { etapasPadrao } from '../../src/shared/funil-logic'
import {
  colunasVisiveis,
  composeDe,
  dataHora,
  diaCurto,
  emailDestino,
  fechadasRecentes,
  filtrarOportunidades,
  oportunidadeAbertaDaEmpresa,
  parseValor,
  PICKER_MAX,
  podeArquivar,
  resultadosPicker,
  textoPassoDetalhe,
  textoProximoPasso,
  textoSubtitulo,
  textoTotais,
  valorParaEdicao,
  whatsappDestino,
} from '../../src/renderer/src/features/funil/funilFormat'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')
const SP = 'America/Sao_Paulo'

const ids = ['contato', 'descoberta', 'proposta', 'negociacao', 'ganho', 'perdido']
let seq = 0
const etapas = etapasPadrao(() => `etapa-${ids[seq++] ?? seq}`)

const oportunidade = (id: string, etapa: string, patch: Partial<Oportunidade> = {}): Oportunidade => ({
  id,
  titulo: id,
  empresaId: null,
  contatoIds: [],
  etapaId: `etapa-${etapa}`,
  ordem: 0,
  valor: null,
  previsao: null,
  proximoPasso: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: NOW - 30 * DIA_MS,
  atualizadoEm: NOW - DIA_MS,
  movidoEm: NOW - 2 * DIA_MS,
  fechadoEm: etapa === 'ganho' || etapa === 'perdido' ? NOW - DIA_MS : null,
  arquivado: false,
  ...patch,
})

const contato = (id: string, nome: string, empresaId: string | null): Contato => ({
  id,
  nome,
  emails: [],
  telefones: [],
  empresaId,
  cargo: null,
  notas: '',
  whatsappChatId: null,
  origem: 'manual',
  criadoEm: NOW,
  atualizadoEm: NOW,
  arquivado: false,
})

const empresa = (id: string, nome: string): Empresa => ({ id, nome, dominios: [], site: null, notas: '', criadoEm: NOW, atualizadoEm: NOW })

const state: FunilState = {
  version: 1,
  contatos: [contato('ct-marcia', 'Márcia Gonçalves', 'emp-cliente'), contato('ct-rafael', 'Rafael Lima', null)],
  empresas: [empresa('emp-cliente', 'Cliente Ação'), empresa('emp-parceiro', 'Parceiro')],
  etapas,
  oportunidades: [
    oportunidade('op-portal', 'contato', { titulo: 'Portal do associado', empresaId: 'emp-cliente', contatoIds: ['ct-marcia'], valor: 3_800_000 }),
    oportunidade('op-consultoria', 'descoberta', { titulo: 'Consultoria fiscal', empresaId: 'emp-cliente', ordem: 0, valor: 1_250_050 }),
    oportunidade('op-loja', 'negociacao', { titulo: 'Loja virtual', contatoIds: ['ct-rafael'], valor: 6_400_000 }),
    oportunidade('op-ganha', 'ganho', { valor: 7_500_000, fechadoEm: NOW - 3 * DIA_MS }),
    oportunidade('op-ganha-91', 'ganho', { valor: 5_000_000, fechadoEm: NOW - 91 * DIA_MS, ordem: 1 }),
    oportunidade('op-perdida', 'perdido', { fechadoEm: NOW - 200 * DIA_MS }),
    oportunidade('op-arquivada', 'ganho', { titulo: 'Portal antigo', fechadoEm: NOW - 2 * DIA_MS, arquivado: true, ordem: 2 }),
  ],
  eventos: [],
  ignorados: [],
  ultimoAvisoEm: null,
}

const expandidas = (filtro: Parameters<typeof colunasVisiveis>[1]): string[] => colunasVisiveis(etapas, filtro).filter((coluna) => !coluna.recolhida).map((coluna) => coluna.etapa.id)

describe('colunas do kanban por filtro (R23)', () => {
  it('Abertas: as 4 abertas expandidas e Ganho e Perdido recolhidas, na ordem das etapas', () => {
    const colunas = colunasVisiveis(etapas, 'abertas')
    expect(colunas.map((coluna) => coluna.etapa.nome)).toEqual(['Contato', 'Descoberta', 'Proposta', 'Negociação', 'Ganho', 'Perdido'])
    expect(colunas.map((coluna) => coluna.recolhida)).toEqual([false, false, false, false, true, true])
  })

  it('Ganhas: só Ganho expandida (as outras 5 recolhidas); Perdidas: só Perdido; Todas: as 6', () => {
    expect(expandidas('ganhas')).toEqual(['etapa-ganho'])
    expect(colunasVisiveis(etapas, 'ganhas').filter((coluna) => coluna.recolhida)).toHaveLength(5)
    expect(expandidas('perdidas')).toEqual(['etapa-perdido'])
    expect(expandidas('todas')).toHaveLength(6)
  })

  it('fechadasRecentes: a fechada há 91 dias fica de fora; sem fechadoEm também', () => {
    const ganhas = state.oportunidades.filter((item) => item.etapaId === 'etapa-ganho')
    expect(fechadasRecentes(ganhas, NOW).map((item) => item.id)).toEqual(['op-ganha', 'op-arquivada'])
    expect(fechadasRecentes([{ fechadoEm: NOW - 90 * DIA_MS }, { fechadoEm: null }], NOW)).toHaveLength(1)
  })
})

describe('filtrarOportunidades (R21, R23)', () => {
  it('nunca devolve a arquivada', () => {
    for (const filtro of ['abertas', 'ganhas', 'perdidas', 'todas'] as const) expect(filtrarOportunidades(state, filtro, '').map((item) => item.id)).not.toContain('op-arquivada')
    expect(filtrarOportunidades(state, 'todas', 'portal').map((item) => item.id)).toEqual(['op-portal'])
  })

  it('o filtro escolhe as etapas: Abertas, Ganhas, Perdidas', () => {
    expect(filtrarOportunidades(state, 'abertas', '').map((item) => item.id)).toEqual(['op-portal', 'op-consultoria', 'op-loja'])
    expect(filtrarOportunidades(state, 'ganhas', '').map((item) => item.id)).toEqual(['op-ganha', 'op-ganha-91'])
    expect(filtrarOportunidades(state, 'perdidas', '').map((item) => item.id)).toEqual(['op-perdida'])
  })

  it('acha "Portal" por "portal", pela empresa e pelo nome do contato sem acento, dentro do filtro', () => {
    expect(filtrarOportunidades(state, 'abertas', 'portal').map((item) => item.id)).toEqual(['op-portal'])
    expect(filtrarOportunidades(state, 'abertas', 'goncalves').map((item) => item.id)).toEqual(['op-portal'])
    expect(filtrarOportunidades(state, 'abertas', 'MARCIA').map((item) => item.id)).toEqual(['op-portal'])
    expect(filtrarOportunidades(state, 'abertas', 'acao').map((item) => item.id)).toEqual(['op-portal', 'op-consultoria'])
    expect(filtrarOportunidades(state, 'ganhas', 'portal')).toEqual([])
  })
})

describe('valor, totais e próximo passo', () => {
  it("parseValor: '1.234,56' -> 123456; 'abc' -> null", () => {
    expect(parseValor('1.234,56')).toBe(123456)
    expect(parseValor('abc')).toBeNull()
    expect(parseValor('120.000')).toBe(12_000_000)
    expect(parseValor('R$ 1500')).toBe(150_000)
    expect(parseValor('38,5')).toBe(3850)
    expect(parseValor('')).toBeNull()
    expect(parseValor('1,234.56')).toBeNull()
    expect(parseValor('1.23,4')).toBeNull()
  })

  it('textoTotais: abertas, em aberto e o ganho no mês, em BRL', () => {
    expect(textoTotais(state, NOW, SP)).toBe('3 abertas · R$ 114.500,50 em aberto · R$ 75.000 ganho em novembro')
  })

  it('textoProximoPasso: o texto e a data curta, ou "Sem próximo passo"', () => {
    expect(textoProximoPasso(null)).toEqual({ texto: 'Sem próximo passo', data: null })
    expect(textoProximoPasso({ texto: 'Ligar', data: '2026-11-25' })).toEqual({ texto: 'Ligar', data: '25/11' })
    expect(diaCurto('2026-01-09')).toBe('09/01')
  })
})

describe('aviso de duplicata e SearchPicker (R25)', () => {
  it('oportunidadeAbertaDaEmpresa: a aberta da primeira etapa; sem empresa ou só fechada, null', () => {
    expect(oportunidadeAbertaDaEmpresa(state, 'emp-cliente')?.id).toBe('op-portal')
    expect(oportunidadeAbertaDaEmpresa(state, 'emp-parceiro')).toBeNull()
    expect(oportunidadeAbertaDaEmpresa(state, null)).toBeNull()
  })

  it('resultadosPicker: no máximo 8, sem acento, sem os escolhidos, e "Criar" sem nome igual', () => {
    const itens = Array.from({ length: 12 }, (_, index) => ({ id: `c-${index}`, nome: `Cliente ${index}` }))
    expect(resultadosPicker(itens, 'cliente').itens).toHaveLength(PICKER_MAX)
    expect(resultadosPicker(itens, 'cliente').criar).toBe(true)
    expect(resultadosPicker(itens, 'CLIENTE 1', ['c-1']).itens.map((item) => item.id)).toEqual(['c-10', 'c-11'])
    expect(resultadosPicker(itens, 'cliente 3').criar).toBe(false)
    expect(resultadosPicker([{ id: 'a', nome: 'Ação' }], 'acao').itens).toHaveLength(1)
    expect(resultadosPicker(itens, '  ')).toEqual({ itens: [], criar: false })
  })
})

describe('detalhe da oportunidade (contrato 119)', () => {
  const comEmails = (emails: string[]): Pick<Contato, 'emails'> => ({ emails })

  it('composeDe: o e-mail principal de cada contato, sem repetir, e o contato sem e-mail fica de fora', () => {
    expect(composeDe([comEmails(['rafael.lima@lojista.example']), comEmails([]), comEmails(['Rafael.Lima@Lojista.example ', 'outro@lojista.example']), comEmails(['marina@cliente.example'])])).toEqual([
      'rafael.lima@lojista.example',
      'marina@cliente.example',
    ])
    expect(composeDe([comEmails([]), comEmails([])])).toEqual([])
    expect(composeDe([])).toEqual([])
  })

  it('podeArquivar: só Ganho e Perdido', () => {
    expect(etapas.filter((etapa) => podeArquivar(etapa)).map((etapa) => etapa.tipo)).toEqual(['ganho', 'perdido'])
    expect(podeArquivar({ tipo: 'aberta' })).toBe(false)
    expect(podeArquivar(null)).toBe(false)
    expect(podeArquivar(undefined)).toBe(false)
  })

  it('textoSubtitulo: dias na etapa, a criação e a última interação com "hoje" e "ontem", como no artboard', () => {
    // NOW = 20/11/2026 12:00 em São Paulo.
    const op = { movidoEm: NOW - 6 * DIA_MS, criadoEm: Date.parse('2026-11-03T13:00:00.000Z') }
    const proposta = { nome: 'Proposta' }
    expect(textoSubtitulo(op, proposta, Date.parse('2026-11-19T18:12:00.000Z'), NOW, SP)).toBe('Há 6 d em Proposta · criada em 03/11/2026 · última interação ontem, 15:12')
    expect(textoSubtitulo(op, proposta, NOW - 30 * 60_000, NOW, SP)).toBe('Há 6 d em Proposta · criada em 03/11/2026 · última interação hoje, 11:30')
    expect(textoSubtitulo(op, proposta, Date.parse('2026-11-14T13:52:00.000Z'), NOW, SP)).toBe('Há 6 d em Proposta · criada em 03/11/2026 · última interação 14/11/2026')
    expect(textoSubtitulo(op, proposta, null, NOW, SP)).toBe('Há 6 d em Proposta · criada em 03/11/2026')
    // "ontem" é o dia anterior no fuso, não 24 h: 23:50 de ontem continua "ontem".
    expect(textoSubtitulo(op, proposta, Date.parse('2026-11-20T02:50:00.000Z'), NOW, SP)).toBe('Há 6 d em Proposta · criada em 03/11/2026 · última interação ontem, 23:50')
  })

  it('whatsappDestino: a primeira conversa ligada vai a /whatsapp com state.chatId; sem conversa, nada', () => {
    expect(whatsappDestino(['5511987654321@s.whatsapp.net', 'outro@s.whatsapp.net'])).toEqual({ path: '/whatsapp', state: { chatId: '5511987654321@s.whatsapp.net' } })
    expect(whatsappDestino([])).toBeNull()
  })

  it('emailDestino: a pasta da mensagem (Entrada, Enviados ou outra) com o messageId; fora do cache, nada', () => {
    const item = (patch: Partial<Extract<ItemLinhaDoTempo, { tipo: 'email' }>>): Extract<ItemLinhaDoTempo, { tipo: 'email' }> => ({
      tipo: 'email',
      at: NOW,
      accountId: 'conta-1',
      messageId: 'm-7',
      mailbox: 'INBOX',
      assunto: 'Proposta',
      de: 'Marina',
      para: 'Andrew',
      noCache: false,
      ...patch,
    })
    expect(emailDestino(item({}), 'Sent')).toEqual({ path: '/email/conta-1/entrada', state: { messageId: 'm-7', mailbox: 'INBOX' } })
    expect(emailDestino(item({ mailbox: 'Sent' }), 'Sent')?.path).toBe('/email/conta-1/enviados')
    expect(emailDestino(item({ mailbox: 'Clientes/ABF' }), 'Sent')?.path).toBe('/email/conta-1/p~Clientes%2FABF')
    expect(emailDestino(item({ mailbox: null }), null)?.path).toBe('/email/conta-1/entrada')
    expect(emailDestino(item({ noCache: true }), 'Sent')).toBeNull()
  })

  it('textoPassoDetalhe, dataHora e valorParaEdicao', () => {
    expect(textoPassoDetalhe({ texto: 'Ligar para a Ana', data: '2026-11-18' }, '2026-11-20')).toEqual({ texto: 'Ligar para a Ana', data: '18/11 · vencido', vencido: true })
    expect(textoPassoDetalhe({ texto: 'Revisar', data: '2026-11-21' }, '2026-11-20')).toEqual({ texto: 'Revisar', data: '21/11', vencido: false })
    expect(textoPassoDetalhe(null, '2026-11-20')).toEqual({ texto: 'Sem próximo passo', data: null, vencido: false })
    expect(dataHora(Date.parse('2026-11-14T13:40:00.000Z'), SP)).toBe('14/11 · 10:40')
    expect(valorParaEdicao(6_400_000)).toBe('64.000')
    expect(valorParaEdicao(1_250_050)).toBe('12.500,50')
    expect(valorParaEdicao(null)).toBe('')
    expect(parseValor(valorParaEdicao(18_600_000))).toBe(18_600_000)
  })
})
