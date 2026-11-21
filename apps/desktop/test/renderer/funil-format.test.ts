// Contrato 112 (CA2): os filtros e as colunas do kanban (R23), as fechadas nos últimos 90 dias, a busca sem acento, o
// valor digitado em reais, a oportunidade aberta da empresa (aviso de duplicata, R25) e os resultados do SearchPicker.
import { describe, expect, it } from 'vitest'
import type { Contato, Empresa, FunilState, Oportunidade } from '../../src/shared/funil'
import { etapasPadrao } from '../../src/shared/funil-logic'
import {
  colunasVisiveis,
  diaCurto,
  fechadasRecentes,
  filtrarOportunidades,
  oportunidadeAbertaDaEmpresa,
  parseValor,
  PICKER_MAX,
  resultadosPicker,
  textoProximoPasso,
  textoTotais,
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
