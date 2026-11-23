// Contrato 135 (inicio, D11, D12): os textos da tela Início e a linha comprimida do dia (escolha D2 do mockup), no fuso
// local. O dia do mockup: segunda, 23/11/2026, 14:40.
import { describe, expect, it } from 'vitest'
import {
  dataPorExtenso,
  linhaDoDia,
  rotaInicial,
  saudacao,
  textoAmanha,
  textoEmAndamento,
  textoEventos,
  textoFalha,
  textoHorarioEvento,
  textoLivreAte,
  textoQuandoFoi,
  textoQuandoVai,
  textoSemEventos,
  type ItemLinha,
} from '../../src/renderer/src/features/inicio/inicioFormat'
import type { InicioEvento } from '../../src/shared/inicio'
import { ROUTE_PATHS } from '../../src/shared/routes'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'

const local = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)
const hoje = (h: number, min = 0): number => local(2026, 11, 23, h, min).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()

function evento(id: string, de: [number, number], ate: [number, number], patch: Partial<InicioEvento> = {}): InicioEvento {
  return {
    id,
    titulo: id,
    inicio: iso(hoje(...de)),
    fim: iso(hoje(...ate)),
    diaInteiro: false,
    fontes: ['google'],
    calendarKey: `google:primary:${id}`,
    eventId: id,
    chamada: null,
    reuniaoId: null,
    ...patch,
  }
}

/** A linha resumida: o tipo e o texto de cada item, na ordem. */
const resumo = (itens: ItemLinha[]): string[] =>
  itens.map((item) => (item.tipo === 'evento' ? `evento ${item.hora} ${item.evento.id} ${item.estado}` : item.tipo === 'livre' ? item.texto : `${item.tipo} ${item.hora}`))

describe('saudação e data (D12)', () => {
  it('Bom dia das 5 às 12, Boa tarde das 12 às 18, Boa noite no resto', () => {
    expect(saudacao(local(2026, 11, 23, 5, 0), null)).toBe('Bom dia')
    expect(saudacao(local(2026, 11, 23, 11, 59), null)).toBe('Bom dia')
    expect(saudacao(local(2026, 11, 23, 12, 0), null)).toBe('Boa tarde')
    expect(saudacao(local(2026, 11, 23, 17, 59), null)).toBe('Boa tarde')
    expect(saudacao(local(2026, 11, 23, 18, 0), null)).toBe('Boa noite')
    expect(saudacao(local(2026, 11, 23, 4, 59), null)).toBe('Boa noite')
  })

  it('com o primeiro nome do perfil; sem conta (ou nome vazio), só a saudação', () => {
    expect(saudacao(local(2026, 11, 23, 14, 40), 'Andrew')).toBe('Boa tarde, Andrew')
    expect(saudacao(local(2026, 11, 23, 14, 40), '  ')).toBe('Boa tarde')
  })

  it('data por extenso com o dia da semana em maiúscula', () => {
    expect(dataPorExtenso(local(2026, 11, 23))).toBe('Segunda-feira, 23 de novembro de 2026')
    expect(dataPorExtenso(local(2026, 3, 1))).toBe('Domingo, 1 de março de 2026')
  })
})

describe('textos da agenda', () => {
  it('"livre até", contagens e "Amanhã"', () => {
    expect(textoLivreAte(hoje(14))).toBe('livre até 14:00')
    expect(textoEventos(0)).toBe('nenhum evento')
    expect(textoEventos(1)).toBe('1 evento')
    expect(textoEventos(4)).toBe('4 eventos')
    expect(textoAmanha(3)).toBe('Amanhã: 3 eventos')
    expect(textoAmanha(1)).toBe('Amanhã: 1 evento')
  })

  it('horário e chamada; o de dia inteiro', () => {
    expect(textoHorarioEvento(evento('a', [9, 0], [9, 30], { chamada: 'meet' }))).toBe('09:00 – 09:30 · Google Meet')
    expect(textoHorarioEvento(evento('b', [14, 0], [15, 0], { chamada: 'teams' }))).toBe('14:00 – 15:00 · Teams')
    expect(textoHorarioEvento(evento('c', [16, 0], [16, 30]))).toBe('16:00 – 16:30')
    expect(textoHorarioEvento(evento('d', [0, 0], [0, 0], { diaInteiro: true }))).toBe('Dia inteiro')
  })

  it('em andamento: faltam N min, faltam 1 h 05 min, termina agora', () => {
    expect(textoEmAndamento(iso(hoje(15)), hoje(14, 40))).toBe('Em andamento · faltam 20 min')
    expect(textoEmAndamento(iso(hoje(16, 5)), hoje(15))).toBe('Em andamento · faltam 1 h 05 min')
    expect(textoEmAndamento(iso(hoje(15)), hoje(15))).toBe('Em andamento · termina agora')
  })

  it('quando foi a reunião e quando vai a automação', () => {
    const agora = local(2026, 11, 23, 14, 40)
    expect(textoQuandoFoi(local(2026, 11, 23, 9, 0), agora)).toBe('hoje, 09:00')
    expect(textoQuandoFoi(local(2026, 11, 22, 16, 30), agora)).toBe('ontem, 16:30')
    expect(textoQuandoFoi(local(2026, 11, 20, 10, 0), agora)).toBe('sexta, 20/11')
    expect(textoQuandoVai(local(2026, 11, 23, 18, 0), agora)).toBe('hoje, 18:00')
    expect(textoQuandoVai(local(2026, 11, 24, 7, 0), agora)).toBe('amanhã, 07:00')
    expect(textoQuandoVai(local(2026, 11, 27, 7, 0), agora)).toBe('sexta, 27/11, 07:00')
    expect(textoFalha('Triagem do email', local(2026, 11, 23, 7, 0).toISOString(), agora.getTime())).toBe('“Triagem do email” falhou às 07:00')
    expect(textoFalha('Triagem do email', local(2026, 11, 22, 7, 0).toISOString(), agora.getTime())).toBe('“Triagem do email” falhou ontem, 07:00')
  })
})

describe('linha comprimida do dia (D2)', () => {
  it('o dia do mockup: 08:00, o passado, "livre até 14:00", o atual, agora, os futuros e 19:00', () => {
    const eventos = [evento('proposta', [17, 30], [18, 0]), evento('daily', [9, 0], [9, 30]), evento('alinhamento', [14, 0], [15, 0]), evento('contrato', [16, 0], [16, 30])]
    expect(resumo(linhaDoDia(eventos, hoje(14, 40)))).toEqual([
      'limite 08:00',
      'evento 09:00 daily passado',
      'livre até 14:00',
      'evento 14:00 alinhamento atual',
      'agora 14:40',
      'evento 16:00 contrato futuro',
      'evento 17:30 proposta futuro',
      'limite 19:00',
    ])
  })

  it('com o agora num intervalo livre, "livre até" logo depois dele, mesmo curto', () => {
    const eventos = [evento('a', [9, 0], [10, 0]), evento('b', [11, 0], [11, 30])]
    expect(resumo(linhaDoDia(eventos, hoje(10, 15)))).toEqual(['limite 08:00', 'evento 09:00 a passado', 'agora 10:15', 'livre até 11:00', 'evento 11:00 b futuro', 'limite 19:00'])
  })

  it('antes do primeiro evento: o agora e "livre até" o primeiro; antes das 08:00, o agora vem antes da ponta', () => {
    const eventos = [evento('a', [10, 0], [10, 30])]
    expect(resumo(linhaDoDia(eventos, hoje(9, 0)))).toEqual(['limite 08:00', 'agora 09:00', 'livre até 10:00', 'evento 10:00 a futuro', 'limite 19:00'])
    expect(resumo(linhaDoDia(eventos, hoje(7, 0)))).toEqual(['agora 07:00', 'limite 08:00', 'evento 10:00 a futuro', 'limite 19:00'])
  })

  it('evento às 08:00 ou antes tira a ponta de cima; terminando às 19:00 ou depois, a de baixo; depois de tudo, o agora no fim', () => {
    const eventos = [evento('cedo', [7, 30], [8, 0]), evento('tarde', [18, 30], [20, 0])]
    expect(resumo(linhaDoDia(eventos, hoje(21, 0)))).toEqual(['evento 07:30 cedo passado', 'livre até 18:30', 'evento 18:30 tarde passado', 'agora 21:00'])
  })

  it('o de dia inteiro vem antes de tudo; sem evento, só as pontas e o agora', () => {
    const inteiro = evento('feriado', [0, 0], [0, 0], { diaInteiro: true })
    expect(resumo(linhaDoDia([inteiro], hoje(12, 0)))).toEqual(['evento dia todo feriado futuro', 'limite 08:00', 'agora 12:00', 'limite 19:00'])
    expect(resumo(linhaDoDia([], hoje(20, 0)))).toEqual(['limite 08:00', 'limite 19:00', 'agora 20:00'])
  })
})

// Contrato 136 (D2, artboard 03): a tela inicial e o dia sem evento.
describe('tela inicial e dia vazio', () => {
  it('a preferência leva ao Início (/inicio) ou a Reuniões (/); o padrão é o Início', () => {
    expect(rotaInicial('inicio')).toBe(ROUTE_PATHS.inicio)
    expect(rotaInicial('reunioes')).toBe(ROUTE_PATHS.reunioes)
    expect(ROUTE_PATHS.reunioes).toBe('/')
    expect(rotaInicial(DEFAULT_SETTINGS.inicio.telaInicial)).toBe('/inicio')
  })

  it('"Sem eventos hoje" cita só as fontes que a agenda leu', () => {
    expect(textoSemEventos(true, 'ok')).toBe('As agendas conectadas e o Calendário do Mac não têm nada marcado para hoje.')
    expect(textoSemEventos(true, 'sem-acesso')).toBe('As agendas conectadas não têm nada marcado para hoje.')
    expect(textoSemEventos(true, 'dev')).toBe('As agendas conectadas não têm nada marcado para hoje.')
    expect(textoSemEventos(false, 'ok')).toBe('O Calendário do Mac não tem nada marcado para hoje.')
    expect(textoSemEventos(false, 'indisponivel')).toBe('Nenhuma agenda para ler hoje.')
  })
})
