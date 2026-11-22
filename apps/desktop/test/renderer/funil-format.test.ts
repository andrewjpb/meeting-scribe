// Contrato 112 (CA2): os filtros e as colunas do kanban (R23), as fechadas nos últimos 90 dias, a busca sem acento, o
// valor digitado em reais, a oportunidade aberta da empresa (aviso de duplicata, R25) e os resultados do SearchPicker.
// Contrato 119 (CA5, CA6): o "Escrever e-mail", o "Arquivar", o subtítulo, o "Abrir WhatsApp" e o "Abrir e-mail".
// Contrato 114 (CA7): a lista e a busca de contatos, a sugestão de empresa (R5), o texto das sugestões e o resultado e o
// arquivo da importação.
// Contrato 116: o contato ligado a um e-mail, telefone ou conversa (R35 a R37), a etapa pré-escolhida e o resumo do efeito
// do cartão "Oportunidade detectada" (R39).
// Contrato 125 (CA1): "Sem tarefa" no cartão (R14), as tarefas da oportunidade, do contato e da empresa (R15, R19) e o
// texto do item `tarefa` da linha do tempo (R18).
import { describe, expect, it } from 'vitest'
import type { Contato, Empresa, FunilState, ItemLinhaDoTempo, Oportunidade, ProximoPassoDerivado, Sugestao } from '../../src/shared/funil'
import type { Tarefa } from '../../src/shared/tarefas'
import { etapasPadrao } from '../../src/shared/funil-logic'
import {
  colunasVisiveis,
  composeDe,
  dataHora,
  diaCurto,
  emailDestino,
  fechadasRecentes,
  filtrarContatos,
  filtrarEmpresas,
  filtrarOportunidades,
  oportunidadeAbertaDaEmpresa,
  ordenarContatos,
  ordenarEmpresas,
  parseDominio,
  parseValor,
  PICKER_MAX,
  podeArquivar,
  resultadosPicker,
  sugestaoDeEmpresa,
  tarefasDaEmpresa,
  tarefasDaOportunidade,
  tarefasDoContato,
  telefoneLegivel,
  textoArquivoImport,
  textoItemTarefa,
  textoProximoPasso,
  textoResultadoImport,
  textoSubtitulo,
  textoSubtituloContato,
  textoSugestao,
  textoTotais,
  valorParaEdicao,
  whatsappDestino,
} from '../../src/renderer/src/features/funil/funilFormat'
import { contatoLigado, mesmoNome } from '../../src/renderer/src/features/funil/ContactLink'
import { etapaInicial, textoEfeito } from '../../src/renderer/src/features/funil/proposalStore'

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

  it('textoProximoPasso: o texto e a data curta, ou "Sem tarefa" (contrato 125, R14)', () => {
    expect(textoProximoPasso(null)).toEqual({ texto: 'Sem tarefa', data: null })
    expect(textoProximoPasso({ texto: 'Ligar', data: '2026-11-25' })).toEqual({ texto: 'Ligar', data: '25/11' })
    // Contrato 124 (CA10): o passo derivado das tarefas (com o `tarefaId`) sai igual.
    const derivado: ProximoPassoDerivado = { texto: 'Ligar', data: '2026-11-23', tarefaId: 't1' }
    expect(textoProximoPasso(derivado)).toEqual({ texto: 'Ligar', data: '23/11' })
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

  it('dataHora e valorParaEdicao', () => {
    expect(dataHora(Date.parse('2026-11-14T13:40:00.000Z'), SP)).toBe('14/11 · 10:40')
    expect(valorParaEdicao(6_400_000)).toBe('64.000')
    expect(valorParaEdicao(1_250_050)).toBe('12.500,50')
    expect(valorParaEdicao(null)).toBe('')
    expect(parseValor(valorParaEdicao(18_600_000))).toBe(18_600_000)
  })
})

describe('contatos e empresas (contrato 114)', () => {
  const pessoa = (id: string, nome: string, patch: Partial<Contato> = {}): Contato => ({ ...contato(id, nome, null), ...patch })
  const comDominio = (id: string, nome: string, dominios: string[]): Empresa => ({ ...empresa(id, nome), dominios })

  it('sugestaoDeEmpresa: Acme para ana@acme.com.br sem empresa; null para @gmail.com, com empresa do domínio ou já ligada', () => {
    const ana = pessoa('ct-ana', 'Ana', { emails: ['ana@acme.com.br'] })
    expect(sugestaoDeEmpresa(ana, [])).toEqual({ nome: 'Acme', dominio: 'acme.com.br' })
    expect(sugestaoDeEmpresa(pessoa('ct-bia', 'Bia', { emails: ['bia@gmail.com'] }), [])).toBeNull()
    expect(sugestaoDeEmpresa(ana, [comDominio('emp-acme', 'Acme Ltda', ['acme.com.br'])])).toBeNull()
    expect(sugestaoDeEmpresa({ ...ana, empresaId: 'emp-outra' }, [])).toBeNull()
    // O e-mail pessoal fica de fora e o seguinte, de empresa, vale.
    expect(sugestaoDeEmpresa(pessoa('ct-rafa', 'Rafael', { emails: ['rafa@hotmail.com', 'rafael.lima@lojista.example'] }), [])).toEqual({ nome: 'Lojista', dominio: 'lojista.example' })
    expect(sugestaoDeEmpresa(pessoa('ct-sem', 'Sem e-mail'), [])).toBeNull()
  })

  it('filtrarContatos: por nome sem acento, e-mail, empresa e telefone com ou sem pontuação', () => {
    const lista = [
      pessoa('ct-marcia', 'Márcia Gonçalves', { empresaId: 'emp-cliente', emails: ['marcia@cliente.example'] }),
      pessoa('ct-ana', 'Ana Ribeiro', { telefones: ['+5511987654321'] }),
      pessoa('ct-rafa', 'Rafael Lima', { emails: ['rafael.lima@lojista.example'] }),
    ]
    const ids = (busca: string): string[] => filtrarContatos(lista, state.empresas, busca).map((item) => item.id)
    expect(ids('marcia')).toEqual(['ct-marcia'])
    expect(ids('lojista')).toEqual(['ct-rafa'])
    expect(ids('cliente acao')).toEqual(['ct-marcia'])
    expect(ids('11987654321')).toEqual(['ct-ana'])
    expect(ids('(11) 98765-4321')).toEqual(['ct-ana'])
    expect(ids('98765')).toEqual(['ct-ana'])
    expect(ids('')).toHaveLength(3)
    expect(ids('ninguém')).toEqual([])
  })

  it('ordenarContatos: sem os arquivados, o atualizado há menos tempo primeiro e, no empate, pelo nome', () => {
    const lista = [
      pessoa('ct-b', 'Bruno', { atualizadoEm: NOW - DIA_MS }),
      pessoa('ct-a', 'Ana', { atualizadoEm: NOW - DIA_MS }),
      pessoa('ct-c', 'Carla', { atualizadoEm: NOW }),
      pessoa('ct-d', 'Davi', { atualizadoEm: NOW + DIA_MS, arquivado: true }),
    ]
    expect(ordenarContatos(lista).map((item) => item.id)).toEqual(['ct-c', 'ct-a', 'ct-b'])
  })

  it('textoResultadoImport e textoArquivoImport, como no artboard 07', () => {
    expect(textoResultadoImport({ criados: 16, atualizados: 2, ignorados: 2 })).toBe('16 criados · 2 atualizados · 2 ignorados (sem e-mail nem telefone)')
    expect(textoArquivoImport({ tipo: 'csv', total: 20, separador: ';', codificacao: 'utf-8' })).toBe('20 linhas · separador ; · UTF-8')
    expect(textoArquivoImport({ tipo: 'csv', total: 1, separador: '\t', codificacao: 'latin1' })).toBe('1 linha · separador tabulação · Latin-1')
    expect(textoArquivoImport({ tipo: 'vcard', total: 3, separador: null, codificacao: 'utf-8' })).toBe('vCard · 3 cartões')
  })

  it('textoSugestao: "e-mail ou telefone · canal" e "N interações · última em hoje|dd/mm"', () => {
    const sugestao = (patch: Partial<Sugestao>): Sugestao => ({
      chave: 'email:lucas@vertice.example',
      nome: 'Lucas Vieira',
      canais: ['reuniao'],
      interacoes: 2,
      ultimaEm: NOW - 60 * 60_000,
      origem: 'reuniao',
      email: 'lucas@vertice.example',
      telefone: null,
      whatsappChatId: null,
      ...patch,
    })
    expect(textoSugestao(sugestao({}), NOW, SP)).toEqual({ contato: 'lucas@vertice.example · Reunião', interacoes: '2 interações · última em hoje' })
    expect(textoSugestao(sugestao({ canais: ['email'], origem: 'email', interacoes: 4, ultimaEm: Date.parse('2026-11-19T13:00:00.000Z') }), NOW, SP)).toEqual({ contato: 'lucas@vertice.example · E-mail', interacoes: '4 interações · última em 19/11' })
    expect(textoSugestao(sugestao({ canais: ['whatsapp'], origem: 'whatsapp', email: null, telefone: '+5521998765432', interacoes: 1 }), NOW, SP)).toEqual({ contato: '+55 21 99876-5432 · WhatsApp', interacoes: '1 interação · última em hoje' })
  })

  it('telefoneLegivel, textoSubtituloContato, empresas (ordem e busca) e parseDominio', () => {
    expect(telefoneLegivel('+5511987654321')).toBe('+55 11 98765-4321')
    expect(telefoneLegivel('+551132221100')).toBe('+55 11 3222-1100')
    expect(telefoneLegivel('+14155550100')).toBe('+14155550100')
    const ana = pessoa('ct-ana', 'Ana', { cargo: 'Diretora de Expansão', origem: 'reuniao', criadoEm: Date.parse('2026-11-03T13:00:00.000Z') })
    expect(textoSubtituloContato(ana, 'ABF', SP)).toBe('Diretora de Expansão · ABF · desde 03/11/2026, pela reunião')
    expect(textoSubtituloContato({ ...ana, cargo: null, origem: 'manual' }, null, SP)).toBe('desde 03/11/2026, pelo cadastro manual')
    const empresas = [comDominio('emp-p', 'Parceiro', ['parceiro.example']), comDominio('emp-a', 'Ação Social', ['acao.org.br']), comDominio('emp-c', 'Cliente', ['cliente.example'])]
    expect(ordenarEmpresas(empresas).map((item) => item.id)).toEqual(['emp-a', 'emp-c', 'emp-p'])
    expect(filtrarEmpresas(empresas, 'acao').map((item) => item.id)).toEqual(['emp-a'])
    expect(filtrarEmpresas(empresas, 'cliente.example').map((item) => item.id)).toEqual(['emp-c'])
    expect(parseDominio(' @Acme.com.BR ')).toBe('acme.com.br')
    expect(parseDominio('acme')).toBeNull()
    expect(parseDominio('ana@acme.com.br')).toBeNull()
  })
})

describe('telas existentes e cartão da proposta (contrato 116)', () => {
  const pessoa = (id: string, patch: Partial<Contato>): Contato => ({ ...contato(id, id, null), ...patch })
  const contatos = [
    pessoa('ct-ana', { emails: ['ana@acme.example'], telefones: ['+5511911110000'] }),
    pessoa('ct-bia', { telefones: ['+5521998765432'], whatsappChatId: '5521998765432@s.whatsapp.net' }),
    pessoa('ct-arq', { emails: ['velho@acme.example'], arquivado: true }),
  ]

  it('contatoLigado: e-mail sem caixa, telefone com e sem o nono dígito, a conversa primeiro e nunca o arquivado', () => {
    expect(contatoLigado(contatos, { email: ' Ana@ACME.example ' })?.id).toBe('ct-ana')
    expect(contatoLigado(contatos, { telefone: '+55 11 1111-0000' })?.id).toBe('ct-ana')
    expect(contatoLigado(contatos, { telefone: '+55 11 99999-0000', whatsappChatId: '5521998765432@s.whatsapp.net' })?.id).toBe('ct-bia')
    expect(contatoLigado(contatos, { email: 'velho@acme.example' })).toBeNull()
    expect(contatoLigado(contatos, { email: 'outro@acme.example', telefone: null })).toBeNull()
    expect(contatoLigado(contatos, {})).toBeNull()
  })

  it('mesmoNome (contrato 131, R5): sem acento, sem caixa e com espaços simples; nomes diferentes não casam', () => {
    expect(mesmoNome('Paulo Siqueira', 'paulo  SIQUEIRA ')).toBe(true)
    expect(mesmoNome('João Araújo', 'Joao Araujo')).toBe(true)
    expect(mesmoNome('Paulo Siqueira', 'Paulo S.')).toBe(false)
    expect(mesmoNome('Ana', 'Ana Souza')).toBe(false)
  })

  it('etapaInicial: a aberta com o nome sugerido, sem acento e sem caixa; senão a primeira aberta', () => {
    expect(etapaInicial(etapas, 'negociacao')?.id).toBe('etapa-negociacao')
    expect(etapaInicial(etapas, ' Proposta ')?.id).toBe('etapa-proposta')
    expect(etapaInicial(etapas, 'Ganho')?.id).toBe('etapa-contato')
    expect(etapaInicial([], 'Contato')).toBeNull()
  })

  it('textoEfeito: contatos novos, empresa nova e os citados sem e-mail', () => {
    expect(textoEfeito({ contatosNovos: 2, empresaNova: true, citados: [] })).toBe('Cria os 2 contatos novos e a empresa')
    expect(textoEfeito({ contatosNovos: 1, empresaNova: false, citados: ['Carlos Dias'] })).toBe('Cria o contato novo · Carlos Dias fica só citado na nota')
    expect(textoEfeito({ contatosNovos: 0, empresaNova: true, citados: ['Carlos Dias', 'Ana Lima', 'Bia Reis'] })).toBe('Cria a empresa · Carlos Dias, Ana Lima e Bia Reis ficam só citados na nota')
    expect(textoEfeito({ contatosNovos: 0, empresaNova: false, citados: ['  '] })).toBe('')
  })
})

describe('tarefas no funil (contrato 125, CA1)', () => {
  let seqTarefa = 0
  const tarefa = (id: string, patch: Partial<Tarefa> = {}): Tarefa => ({
    id,
    titulo: id,
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
    criadaEm: ++seqTarefa,
    atualizadaEm: seqTarefa,
    feitaEm: null,
    ...patch,
  })
  const vinculos = (patch: Partial<Tarefa['vinculos']>): Tarefa['vinculos'] => ({ oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null, ...patch })
  const ids = (lista: readonly Tarefa[]): string[] => lista.map((item) => item.id)
  const daLoja = (id: string, patch: Partial<Tarefa> = {}): Tarefa => tarefa(id, { vinculos: vinculos({ oportunidadeId: 'op-loja', contatoIds: ['ct-rafael'], empresaId: 'emp-cliente' }), ...patch })
  const tarefas = [
    daLoja('sem-prazo'),
    daLoja('dia-25', { prazo: '2026-11-25' }),
    daLoja('dia-23', { prazo: '2026-11-23' }),
    daLoja('dia-23-depois', { prazo: '2026-11-23' }),
    daLoja('feita-ontem', { status: 'feita', prazo: '2026-11-20', feitaEm: NOW - DIA_MS }),
    daLoja('cancelada-hoje', { status: 'cancelada', feitaEm: NOW }),
    tarefa('outra-op', { prazo: '2026-11-21', vinculos: vinculos({ oportunidadeId: 'op-portal', contatoIds: ['ct-marina'] }) }),
    tarefa('so-contato', { prazo: '2026-11-22', vinculos: vinculos({ contatoIds: ['ct-rafael'] }) }),
    tarefa('so-contato-feita', { status: 'feita', feitaEm: NOW, vinculos: vinculos({ contatoIds: ['ct-rafael'], empresaId: 'emp-cliente' }) }),
  ]

  it('tarefasDaOportunidade: as abertas por prazo (sem prazo por último, empate pela criação) e as fechadas à parte', () => {
    const { abertas, fechadas } = tarefasDaOportunidade(tarefas, 'op-loja')
    expect(ids(abertas)).toEqual(['dia-23', 'dia-23-depois', 'dia-25', 'sem-prazo'])
    expect(ids(fechadas)).toEqual(['cancelada-hoje', 'feita-ontem'])
    expect(tarefasDaOportunidade(tarefas, 'op-nenhuma')).toEqual({ abertas: [], fechadas: [] })
  })

  it('tarefasDoContato e tarefasDaEmpresa: só as abertas com o contato (ou a empresa) nos vínculos, por prazo', () => {
    expect(ids(tarefasDoContato(tarefas, 'ct-rafael'))).toEqual(['so-contato', 'dia-23', 'dia-23-depois', 'dia-25', 'sem-prazo'])
    expect(ids(tarefasDoContato(tarefas, 'ct-marina'))).toEqual(['outra-op'])
    expect(tarefasDoContato(tarefas, 'ct-ninguem')).toEqual([])
    expect(ids(tarefasDaEmpresa(tarefas, 'emp-cliente'))).toEqual(['dia-23', 'dia-23-depois', 'dia-25', 'sem-prazo'])
  })

  it('textoItemTarefa: "Tarefa criada" ou "Tarefa concluída", com a origem e o prazo', () => {
    expect(textoItemTarefa({ acao: 'criada', origem: 'criada por você', prazo: '2026-11-25' })).toEqual({ rotulo: 'Tarefa criada', linha: 'Criada por você · até 25/11' })
    expect(textoItemTarefa({ acao: 'feita', origem: 'da reunião Kickoff', prazo: null })).toEqual({ rotulo: 'Tarefa concluída', linha: 'Da reunião Kickoff' })
    // A tarefa apagada chega sem origem e sem prazo: só o rótulo.
    expect(textoItemTarefa({ acao: 'feita', origem: '', prazo: null })).toEqual({ rotulo: 'Tarefa concluída', linha: null })
    expect(textoItemTarefa({ acao: 'criada', origem: '', prazo: '2026-12-01' })).toEqual({ rotulo: 'Tarefa criada', linha: 'até 01/12' })
  })
})
