// Contrato 123 (CA1 a CA3): o número de vencidas da barra lateral (R1), as visões Hoje, Próximas, Todas e Feitas com a
// busca sem acento (R2, D-10), o texto do prazo e da origem (R3), os grupos do "Agrupar por" (R4, D-11), o Histórico e o
// aviso efetivo do lembrete (R5) e o que o "Adicionar" das Sugestões cria (R26).
import { describe, expect, it } from 'vitest'
import type { SugestaoTarefa, Tarefa, TarefasView } from '../../src/shared/tarefas'
import { agrupar, badgeVencidas, filtrarVisao, tarefaDaSugestao, textoEvento, textoLembrete, textoOrigem, textoPrazo, textoResponsavel } from '../../src/renderer/src/features/tarefas/tarefasFormat'

/** Domingo, 22/11/2026. */
const HOJE = '2026-11-22'
const NOW = Date.parse('2026-11-22T15:00:00-03:00')
const DIA = 86_400_000
const TZ = 'America/Sao_Paulo'

let seq = 0
const tarefa = (patch: Partial<Tarefa> = {}): Tarefa => ({
  id: `t-${++seq}`,
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
  criadaEm: seq,
  atualizadaEm: seq,
  feitaEm: null,
  ...patch,
})
const vinculos = (patch: Partial<Tarefa['vinculos']>): Tarefa['vinculos'] => ({ oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null, ...patch })
const nomes = (patch: Partial<TarefasView['nomes']> = {}): TarefasView['nomes'] => ({ oportunidades: {}, contatos: {}, reunioes: {}, whatsapp: {}, ...patch })
const view = (tarefas: Tarefa[], extra: Partial<TarefasView['nomes']> = {}): TarefasView => ({ tarefas, hoje: HOJE, nomes: nomes(extra) })
const ids = (lista: readonly Tarefa[]): string[] => lista.map((item) => item.id)

describe('número de vencidas da barra lateral (R1, CA2)', () => {
  it('com 2 vencidas, "2"; sem vencida (ou sem a view), vazio', () => {
    const duas = [tarefa({ prazo: '2026-11-20' }), tarefa({ prazo: '2026-11-21' }), tarefa({ prazo: HOJE }), tarefa({ prazo: '2026-11-19', status: 'feita', feitaEm: NOW })]
    expect(badgeVencidas(view(duas))).toBe('2')
    expect(badgeVencidas(view([tarefa({ prazo: HOJE }), tarefa()]))).toBe('')
    expect(badgeVencidas(null)).toBe('')
  })
})

describe('visões (R2, CA3)', () => {
  const vencidaAntiga = tarefa({ id: 'venc-1', prazo: '2026-11-18', criadaEm: 5 })
  const vencidaOntem = tarefa({ id: 'venc-2', prazo: '2026-11-21', criadaEm: 1 })
  const deHoje = tarefa({ id: 'hoje-1', prazo: HOJE, criadaEm: 2 })
  const deHoje2 = tarefa({ id: 'hoje-2', prazo: HOJE, criadaEm: 3 })
  const depois = tarefa({ id: 'prox-2', prazo: '2026-11-30', criadaEm: 1 })
  const amanha = tarefa({ id: 'prox-1', prazo: '2026-11-23', criadaEm: 9 })
  const semPrazoA = tarefa({ id: 'sem-1', criadaEm: 1 })
  const semPrazoB = tarefa({ id: 'sem-2', criadaEm: 2 })
  const feitaVelha = tarefa({ id: 'feita-91', status: 'feita', prazo: '2026-08-01', feitaEm: NOW - 91 * DIA })
  const canceladaOntem = tarefa({ id: 'cancelada-1', status: 'cancelada', feitaEm: NOW - DIA })
  const feitaHoje = tarefa({ id: 'feita-0', status: 'feita', prazo: HOJE, feitaEm: NOW - 1000 })
  const todas = [semPrazoB, deHoje2, depois, feitaVelha, vencidaOntem, amanha, canceladaOntem, deHoje, semPrazoA, vencidaAntiga, feitaHoje]
  const v = view(todas)

  it('Hoje: as vencidas (pelo prazo) e depois as de hoje (pela criação); nada aberto de outro dia nem fechado', () => {
    expect(ids(filtrarVisao(v, 'hoje', '', NOW))).toEqual(['venc-1', 'venc-2', 'hoje-1', 'hoje-2'])
  })

  it('Próximas: abertas com prazo depois de hoje, pelo prazo', () => {
    expect(ids(filtrarVisao(v, 'proximas', '', NOW))).toEqual(['prox-1', 'prox-2'])
  })

  it('Todas: abertas pelo prazo, as sem prazo no fim pela criação', () => {
    expect(ids(filtrarVisao(v, 'todas', '', NOW))).toEqual(['venc-1', 'venc-2', 'hoje-1', 'hoje-2', 'prox-1', 'prox-2', 'sem-1', 'sem-2'])
  })

  it('Feitas: feitas e canceladas dos últimos 90 dias pelo fechamento, a mais recente primeiro (a de 91 dias fica de fora)', () => {
    expect(ids(filtrarVisao(v, 'feitas', '', NOW))).toEqual(['feita-0', 'cancelada-1'])
  })

  it('Sugestões não tem tarefas', () => {
    expect(filtrarVisao(v, 'sugestoes', '', NOW)).toEqual([])
  })

  it('busca sem acento e sem caixa no título, no detalhe e no nome da origem', () => {
    const orcamento = tarefa({ id: 'orc', titulo: 'Enviar orçamento revisado', prazo: '2026-11-20' })
    const ligada = tarefa({ id: 'lig', titulo: 'Ligar', prazo: HOJE, origem: { tipo: 'funil', oportunidadeId: 'op-loja' }, vinculos: vinculos({ oportunidadeId: 'op-loja' }) })
    const detalhe = tarefa({ id: 'det', titulo: 'Outra', detalhe: 'Conferir a CLÁUSULA', prazo: HOJE })
    const busca = view([orcamento, ligada, detalhe], { oportunidades: { 'op-loja': 'Loja virtual' } })
    expect(ids(filtrarVisao(busca, 'hoje', 'orcamento', NOW))).toEqual(['orc'])
    expect(ids(filtrarVisao(busca, 'hoje', '  LOJA  ', NOW))).toEqual(['lig'])
    expect(ids(filtrarVisao(busca, 'hoje', 'clausula', NOW))).toEqual(['det'])
    expect(filtrarVisao(busca, 'hoje', 'nada disso', NOW)).toEqual([])
  })
})

describe('prazo, origem e responsável da linha (R3, D-11)', () => {
  it('vencida com o atraso em dias; hoje; dd/mm; sem prazo, vazio', () => {
    expect(textoPrazo('2026-11-20', '2026-11-22')).toEqual({ texto: '20/11 · há 2 d', vencida: true, atrasoDias: 2 })
    expect(textoPrazo('2026-11-22', '2026-11-22').texto).toBe('hoje')
    expect(textoPrazo('2026-12-01', '2026-11-22')).toEqual({ texto: '01/12', vencida: false, atrasoDias: 0 })
    expect(textoPrazo(null, '2026-11-22')).toEqual({ texto: '', vencida: false, atrasoDias: 0 })
    // A virada do ano e a troca de horário não mudam a contagem.
    expect(textoPrazo('2026-12-30', '2027-01-02').atrasoDias).toBe(3)
  })

  it('a origem com o tipo e o nome; a migrada mostra o vínculo; o que a view não resolveu fica só com o tipo', () => {
    const n = nomes({ reunioes: { m1: 'Conversa com o Cliente' }, oportunidades: { 'op-1': 'Loja virtual' }, whatsapp: { c1: 'Rafael Lima' } })
    expect(textoOrigem(tarefa({ origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'x' } }), n)).toEqual({ icone: 'reuniao', texto: 'Reunião: Conversa com o Cliente', nome: 'Conversa com o Cliente' })
    expect(textoOrigem(tarefa({ origem: { tipo: 'funil', oportunidadeId: 'op-1' } }), n).texto).toBe('Oportunidade: Loja virtual')
    expect(textoOrigem(tarefa({ origem: { tipo: 'email', accountId: 'a', id: '1', assunto: 'Re: Proposta' } }), n).texto).toBe('E-mail: Re: Proposta')
    expect(textoOrigem(tarefa({ origem: { tipo: 'whatsapp', chatId: 'c1' } }), n).texto).toBe('WhatsApp: Rafael Lima')
    expect(textoOrigem(tarefa({ origem: { tipo: 'assistente' } }), n).texto).toBe('Assistente')
    expect(textoOrigem(tarefa(), n).texto).toBe('Manual')
    expect(textoOrigem(tarefa({ origem: { tipo: 'migracao', de: 'proximo-passo' }, vinculos: vinculos({ oportunidadeId: 'op-1' }) }), n)).toMatchObject({ icone: 'oportunidade', texto: 'Oportunidade: Loja virtual' })
    expect(textoOrigem(tarefa({ origem: { tipo: 'migracao', de: 'lembrete' } }), n).texto).toBe('Manual')
    expect(textoOrigem(tarefa({ origem: { tipo: 'reuniao', meetingId: 'apagada', texto: 'x' } }), n).texto).toBe('Reunião')
  })

  it('o responsável só quando não é "eu"', () => {
    const n = nomes({ contatos: { 'ct-1': 'Marina Rocha' } })
    expect(textoResponsavel({ tipo: 'eu' }, n)).toBeNull()
    expect(textoResponsavel({ tipo: 'contato', contatoId: 'ct-1' }, n)).toBe('Marina Rocha')
    expect(textoResponsavel({ tipo: 'nome', nome: 'Ana' }, n)).toBe('Ana')
  })
})

describe('Agrupar por (R4, D-11)', () => {
  it('Prazo com hoje num domingo: amanhã já cai em "Depois"; a ordem fixa e nenhum grupo vazio', () => {
    const lista = [tarefa({ id: 'v', prazo: '2026-11-20' }), tarefa({ id: 'h', prazo: HOJE }), tarefa({ id: 'a', prazo: '2026-11-23' }), tarefa({ id: 's' })]
    const grupos = agrupar(lista, 'prazo', view(lista))
    expect(grupos.map((grupo) => [grupo.chave, grupo.nome, ids(grupo.tarefas)])).toEqual([
      ['vencidas', 'Vencidas', ['v']],
      ['hoje', 'Hoje', ['h']],
      ['depois', 'Depois', ['a']],
      ['sem-prazo', 'Sem prazo', ['s']],
    ])
  })

  it('Prazo numa segunda: até o domingo é "Esta semana"; a fechada de prazo passado vai para "Antes de hoje"', () => {
    const segunda = { hoje: '2026-11-23', nomes: nomes() }
    const lista = [tarefa({ id: 'ter', prazo: '2026-11-24' }), tarefa({ id: 'dom', prazo: '2026-11-29' }), tarefa({ id: 'seg', prazo: '2026-11-30' }), tarefa({ id: 'f', status: 'feita', prazo: '2026-11-20', feitaEm: NOW })]
    expect(agrupar(lista, 'prazo', segunda).map((grupo) => [grupo.chave, ids(grupo.tarefas)])).toEqual([
      ['antes', ['f']],
      ['semana', ['ter', 'dom']],
      ['depois', ['seg']],
    ])
  })

  it('Oportunidade: pelo prazo mais próximo do grupo, "Sem oportunidade" por último, a ordem de dentro mantida', () => {
    const n = { oportunidades: { 'op-a': 'Portal do associado', 'op-b': 'Loja virtual' } }
    const lista = [
      tarefa({ id: 'a1', prazo: '2026-11-29', vinculos: vinculos({ oportunidadeId: 'op-a' }) }),
      tarefa({ id: 'x', prazo: '2026-11-20' }),
      tarefa({ id: 'b1', prazo: '2026-11-25', vinculos: vinculos({ oportunidadeId: 'op-b' }) }),
      tarefa({ id: 'a2', prazo: '2026-11-24', vinculos: vinculos({ oportunidadeId: 'op-a' }) }),
    ]
    expect(agrupar(lista, 'oportunidade', view(lista, n)).map((grupo) => [grupo.chave, grupo.nome, ids(grupo.tarefas)])).toEqual([
      ['op-a', 'Portal do associado', ['a1', 'a2']],
      ['op-b', 'Loja virtual', ['b1']],
      ['sem-oportunidade', 'Sem oportunidade', ['x']],
    ])
  })

  it('Contato usa o primeiro contato dos vínculos; Reunião, o vínculo ou a reunião de origem', () => {
    const n = { contatos: { 'ct-1': 'Marina Rocha', 'ct-2': 'Paulo Nunes' }, reunioes: { m1: 'Planejamento' } }
    const lista = [tarefa({ id: 'c', vinculos: vinculos({ contatoIds: ['ct-2', 'ct-1'] }) }), tarefa({ id: 'r', origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'x' } }), tarefa({ id: 'nada' })]
    expect(agrupar(lista, 'contato', view(lista, n)).map((grupo) => [grupo.nome, ids(grupo.tarefas)])).toEqual([
      ['Paulo Nunes', ['c']],
      ['Sem contato', ['r', 'nada']],
    ])
    expect(agrupar(lista, 'reuniao', view(lista, n)).map((grupo) => [grupo.nome, ids(grupo.tarefas)])).toEqual([
      ['Planejamento', ['r']],
      ['Sem reunião', ['c', 'nada']],
    ])
  })
})

describe('Histórico e lembrete do detalhe (R5)', () => {
  it('cada evento em pt-BR', () => {
    expect(textoEvento({ tipo: 'criada' })).toBe('Criada')
    expect(textoEvento({ tipo: 'prazo', detalhe: '2026-11-23' })).toBe('Prazo 23/11')
    expect(textoEvento({ tipo: 'prazo' })).toBe('Prazo tirado')
    expect(textoEvento({ tipo: 'feita' })).toBe('Concluída')
    expect(textoEvento({ tipo: 'reaberta' })).toBe('Reaberta')
    expect(textoEvento({ tipo: 'cancelada' })).toBe('Cancelada')
    expect(textoEvento({ tipo: 'vinculo', detalhe: 'oportunidade, reuniao' })).toBe('Vínculos: oportunidade, reunião')
  })

  it('o aviso efetivo: hoje, amanhã ou a data, com "já avisou" depois do disparo', () => {
    const nove = Date.parse('2026-11-22T09:00:00-03:00')
    expect(textoLembrete(nove, nove, HOJE, TZ)).toBe('hoje, 09:00 · já avisou')
    expect(textoLembrete(nove + DIA + 90 * 60_000, null, HOJE, TZ)).toBe('amanhã, 10:30')
    expect(textoLembrete(nove + 5 * DIA, null, HOJE, TZ)).toBe('27/11, 09:00')
    expect(textoLembrete(null, null, HOJE, TZ)).toBe('')
  })
})

describe('"Adicionar" das Sugestões (R26)', () => {
  const base = { chave: 'k', texto: '  Enviar o cronograma do piloto  ', em: NOW, prazo: '2026-11-25', responsavelTexto: 'Você' }

  it('do resumo: origem reunião com o texto (para casar a linha), a reunião nos vínculos e o prazo; sem oportunidade', () => {
    const sugestao: SugestaoTarefa = { ...base, origem: { tipo: 'reuniao', meetingId: 'm1', titulo: 'Piloto' } }
    expect(tarefaDaSugestao(sugestao)).toEqual({ titulo: 'Enviar o cronograma do piloto', prazo: '2026-11-25', origem: { tipo: 'reuniao', meetingId: 'm1', texto: base.texto }, vinculos: { meetingId: 'm1' } })
  })

  it('da análise: manual, ligada à reunião', () => {
    const sugestao: SugestaoTarefa = { ...base, prazo: null, origem: { tipo: 'analise', meetingId: 'm2', titulo: 'Piloto' } }
    expect(tarefaDaSugestao(sugestao)).toEqual({ titulo: 'Enviar o cronograma do piloto', prazo: null, origem: { tipo: 'manual' }, vinculos: { meetingId: 'm2' } })
  })

  it('da conversa: origem WhatsApp com o texto e a conversa nos vínculos; título longo cortado em 200', () => {
    const longo = 'x'.repeat(250)
    const sugestao: SugestaoTarefa = { ...base, texto: longo, origem: { tipo: 'whatsapp', chatId: 'c1', nome: 'Rafael' } }
    const tarefa = tarefaDaSugestao(sugestao)
    expect(tarefa).toMatchObject({ prazo: '2026-11-25', origem: { tipo: 'whatsapp', chatId: 'c1', texto: longo }, vinculos: { whatsappChatId: 'c1' } })
    expect(tarefa.titulo).toHaveLength(200)
  })
})
