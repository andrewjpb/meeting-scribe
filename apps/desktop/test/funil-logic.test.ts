// Contrato 107 (funil-vendas, CA10 a CA12): lógica pura do funil. Última interação e "esfriou" (R7), telefone (R3),
// e-mail, domínio e empresa (R5), `formatarBRL` e os totais do cabeçalho.
import { describe, expect, it } from 'vitest'
import type { Etapa, FunilState, Oportunidade } from '../src/shared/funil'
import {
  diasNaEtapa,
  dominioDe,
  ehProvedorPessoal,
  empresaPorDominio,
  esfriada,
  etapasPadrao,
  formatarBRL,
  mesmoTelefone,
  nomeEmpresaDoDominio,
  normalizarEmail,
  normalizarTelefone,
  passoVencido,
  previsaoVencida,
  semAcento,
  totaisDoFunil,
  ultimaInteracao,
} from '../src/shared/funil-logic'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')

let seq = 0
const etapas = etapasPadrao(() => `e-${++seq}`)
const porNome = (nome: string): Etapa => {
  const found = etapas.find((etapa) => etapa.nome === nome)
  if (!found) throw new Error(nome)
  return found
}

const oportunidade = (patch: Partial<Oportunidade> = {}): Oportunidade => ({
  id: `op-${++seq}`,
  titulo: 'Portal',
  empresaId: null,
  contatoIds: [],
  etapaId: porNome('Proposta').id,
  ordem: 0,
  valor: null,
  previsao: null,
  proximoPasso: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: NOW - 40 * DIA_MS,
  atualizadoEm: NOW - 30 * DIA_MS,
  movidoEm: NOW - 31 * DIA_MS,
  fechadoEm: null,
  arquivado: false,
  ...patch,
})

describe('lógica do funil', () => {
  it('CA10: ultimaInteracao devolve o maior de cada fonte', () => {
    const base = oportunidade()
    const sem = { oportunidade: base, reunioes: [], emails: [], whatsapp: [] }
    expect(ultimaInteracao(sem)).toBe(base.atualizadoEm)
    expect(ultimaInteracao({ ...sem, oportunidade: { ...base, movidoEm: NOW - DIA_MS } })).toBe(NOW - DIA_MS)
    expect(ultimaInteracao({ ...sem, reunioes: [{ startedAt: new Date(NOW - 2 * DIA_MS).toISOString() }, { startedAt: new Date(NOW - 9 * DIA_MS).toISOString() }] })).toBe(NOW - 2 * DIA_MS)
    expect(ultimaInteracao({ ...sem, emails: [{ date: NOW - 3 * DIA_MS }] })).toBe(NOW - 3 * DIA_MS)
    expect(ultimaInteracao({ ...sem, whatsapp: [{ at: NOW - 4 * DIA_MS }] })).toBe(NOW - 4 * DIA_MS)
    const comEmail = { ...base, emails: [{ accountId: 'conta', id: '42', assunto: 'Proposta', de: 'ana@acme.com.br', data: NOW - 5 * DIA_MS }] }
    expect(ultimaInteracao({ ...sem, oportunidade: comEmail })).toBe(NOW - 5 * DIA_MS)
    expect(ultimaInteracao({ ...sem, reunioes: [{ startedAt: 'não é data' }] })).toBe(base.atualizadoEm)
  })

  it('CA10: esfriada com 7 dias: 8 sim, 6 não, em ganho nunca', () => {
    const op = oportunidade()
    expect(esfriada(op, porNome('Proposta'), NOW - 8 * DIA_MS, 7, NOW)).toBe(true)
    expect(esfriada(op, porNome('Proposta'), NOW - 6 * DIA_MS, 7, NOW)).toBe(false)
    expect(esfriada(op, porNome('Ganho'), NOW - 30 * DIA_MS, 7, NOW)).toBe(false)
  })

  it('CA11: normalizarTelefone e mesmoTelefone', () => {
    expect(normalizarTelefone('+55 (11) 3333-4444')).toBe('+551133334444')
    expect(normalizarTelefone('1133334444')).toBe('+551133334444')
    expect(normalizarTelefone('011 98765-4321')).toBe('+5511987654321')
    expect(normalizarTelefone('5511987654321')).toBe('+5511987654321')
    expect(normalizarTelefone('12345')).toBe('12345')
    expect(normalizarTelefone('  ')).toBeNull()
    expect(normalizarTelefone('+1 415 555 1234')).toBe('+14155551234')
    expect(mesmoTelefone('+5511987654321', '+551187654321')).toBe(true)
    expect(mesmoTelefone('+5511987654321', '+5521987654321')).toBe(false)
    expect(mesmoTelefone('(11) 98765-4321', '+55 11 98765 4321')).toBe(true)
    expect(mesmoTelefone('', '')).toBe(false)
  })

  it('CA12: formatarBRL', () => {
    const inteiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
    const padrao = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    expect(formatarBRL(3_800_000)).toBe(inteiro.format(38_000))
    expect(formatarBRL(125_050)).toBe(padrao.format(1250.5))
    expect(formatarBRL(null)).toBe('\u2014')
    expect(formatarBRL(0)).toBe(inteiro.format(0))
  })

  it('CA12: e-mail, domínio e empresa', () => {
    expect(normalizarEmail('sem-arroba')).toBeNull()
    expect(normalizarEmail(' Ana@ACME.com.br ')).toBe('ana@acme.com.br')
    expect(normalizarEmail('ana@acme')).toBeNull()
    expect(dominioDe('Y@Acme.com.br')).toBe('acme.com.br')
    expect(ehProvedorPessoal('gmail.com')).toBe(true)
    expect(ehProvedorPessoal('acme.com.br')).toBe(false)
    expect(nomeEmpresaDoDominio('acme.com.br')).toBe('Acme')
    expect(nomeEmpresaDoDominio('cliente.example')).toBe('Cliente')
    expect(nomeEmpresaDoDominio('mail.acme.com.br')).toBe('Acme')
    expect(semAcento('Negociação São')).toBe('Negociacao Sao')
    const acme = { id: 'acme', nome: 'Acme', dominios: ['acme.com.br'], site: null, notas: '', criadoEm: NOW, atualizadoEm: NOW }
    expect(empresaPorDominio([acme], 'y@acme.com.br')).toBe(acme)
    expect(empresaPorDominio([acme], 'y@gmail.com')).toBeNull()
  })

  it('etapas padrão, vencidos e dias na etapa', () => {
    expect(etapasPadrao(() => 'x').map((etapa) => [etapa.nome, etapa.tipo, etapa.ordem])).toEqual([
      ['Contato', 'aberta', 0],
      ['Descoberta', 'aberta', 1],
      ['Proposta', 'aberta', 2],
      ['Negociação', 'aberta', 3],
      ['Ganho', 'ganho', 4],
      ['Perdido', 'perdido', 5],
    ])
    expect(passoVencido({ data: '2026-11-19' }, '2026-11-20')).toBe(true)
    expect(passoVencido({ data: '2026-11-20' }, '2026-11-20')).toBe(false)
    expect(passoVencido({ data: null }, '2026-11-20')).toBe(false)
    expect(passoVencido(null, '2026-11-20')).toBe(false)
    expect(previsaoVencida('2026-11-19', '2026-11-20')).toBe(true)
    expect(previsaoVencida(null, '2026-11-20')).toBe(false)
    expect(diasNaEtapa(NOW - 3 * DIA_MS - 1, NOW)).toBe(3)
  })

  it('CA12: totaisDoFunil tira arquivadas das abertas e soma o ganho do mês, arquivado ou não', () => {
    const ganho = porNome('Ganho').id
    const state: FunilState = {
      version: 1,
      contatos: [],
      empresas: [],
      etapas,
      eventos: [],
      ignorados: [],
      ultimoAvisoEm: null,
      oportunidades: [
        oportunidade({ valor: 100_000 }),
        oportunidade({ valor: null }),
        oportunidade({ valor: 500_000, arquivado: true }),
        oportunidade({ etapaId: ganho, valor: 300_000, fechadoEm: NOW - DIA_MS }),
        oportunidade({ etapaId: ganho, valor: 700_000, fechadoEm: Date.parse('2026-10-15T12:00:00.000Z') }),
        oportunidade({ etapaId: ganho, valor: 900_000, fechadoEm: NOW, arquivado: true }),
        oportunidade({ etapaId: porNome('Perdido').id, valor: 50_000, fechadoEm: NOW }),
      ],
    }
    expect(totaisDoFunil(state, NOW, 'America/Sao_Paulo')).toEqual({ abertas: 2, emAberto: 100_000, ganhoNoMes: 1_200_000 })
  })
})
