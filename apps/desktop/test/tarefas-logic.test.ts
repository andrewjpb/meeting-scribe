// Contrato 121 (tarefas, CA4 a CA6): os derivados (vencida, próxima da oportunidade, partição), o lembrete padrão e
// o recálculo (R11, D-6), o slug, o dono do resumo → responsável (R22, D-16) e o prazo do "quando" (D-9).
import { describe, expect, it } from 'vitest'
import type { Tarefa } from '../src/shared/tarefas'
import {
  abertasDaOportunidade,
  casaComResumo,
  chaveSugestao,
  contarVencidas,
  deHoje,
  diaNoFuso,
  lembretePadrao,
  particao,
  prazoDoQuando,
  proximaDaOportunidade,
  recalcularLembrete,
  responsavelDoDono,
  slugTexto,
  vencida,
} from '../src/shared/tarefas-logic'

const HOJE = '2026-11-22'
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
const daOp = (prazo: string | null, criadaEm: number, opId = 'op-1'): Tarefa =>
  tarefa({ prazo, criadaEm, vinculos: { oportunidadeId: opId, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null } })

describe('derivados (CA4)', () => {
  it('vencida e de hoje só valem para aberta', () => {
    expect(vencida(tarefa({ prazo: '2026-11-21' }), HOJE)).toBe(true)
    expect(vencida(tarefa({ prazo: '2026-11-21', status: 'feita' }), HOJE)).toBe(false)
    expect(vencida(tarefa({ prazo: HOJE }), HOJE)).toBe(false)
    expect(vencida(tarefa({ prazo: null }), HOJE)).toBe(false)
    expect(deHoje(tarefa({ prazo: HOJE }), HOJE)).toBe(true)
    expect(deHoje(tarefa({ prazo: HOJE, status: 'cancelada' }), HOJE)).toBe(false)
    expect(contarVencidas([tarefa({ prazo: '2026-11-01' }), tarefa({ prazo: '2026-11-20', status: 'feita' }), tarefa({ prazo: '2026-11-23' })], HOJE)).toBe(1)
  })

  it('próxima da oportunidade: menor prazo, sem prazo por último, empate pela criação', () => {
    const a = daOp('2026-11-25', 1)
    const b = daOp(null, 2)
    const c = daOp('2026-11-23', 3)
    const outra = daOp('2026-11-01', 0, 'op-2')
    const fechada = { ...daOp('2026-11-02', 0), status: 'feita' as const }
    expect(proximaDaOportunidade([a, b, c, outra, fechada], 'op-1')).toBe(c)
    expect(abertasDaOportunidade([a, b, c, outra, fechada], 'op-1')).toEqual([c, a, b])

    const cedo = daOp('2026-11-23', 10)
    const tarde = daOp('2026-11-23', 20)
    expect(proximaDaOportunidade([tarde, cedo], 'op-1')).toBe(cedo)
    expect(proximaDaOportunidade([b], 'op-1')).toBe(b)
    expect(proximaDaOportunidade([outra], 'op-1')).toBeNull()
  })

  it('partição: cada aberta em exatamente uma seção, na ordem de cada uma', () => {
    const lista = [
      tarefa({ prazo: '2026-11-20', criadaEm: 5 }),
      tarefa({ prazo: '2026-11-10', criadaEm: 6 }),
      tarefa({ prazo: HOJE, criadaEm: 9 }),
      tarefa({ prazo: HOJE, criadaEm: 2 }),
      tarefa({ prazo: '2026-12-01', criadaEm: 1 }),
      tarefa({ prazo: '2026-11-23', criadaEm: 7 }),
      tarefa({ prazo: null, criadaEm: 8 }),
      tarefa({ prazo: null, criadaEm: 3 }),
      tarefa({ prazo: '2026-11-01', status: 'feita' }),
      tarefa({ prazo: null, status: 'cancelada' }),
    ]
    const p = particao(lista, HOJE)
    expect(p.vencidas.map((t) => t.prazo)).toEqual(['2026-11-10', '2026-11-20'])
    expect(p.hoje.map((t) => t.criadaEm)).toEqual([2, 9])
    expect(p.proximas.map((t) => t.prazo)).toEqual(['2026-11-23', '2026-12-01'])
    expect(p.semPrazo.map((t) => t.criadaEm)).toEqual([3, 8])
    const ids = [...p.vencidas, ...p.hoje, ...p.proximas, ...p.semPrazo].map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(lista.filter((t) => t.status === 'aberta').length)
  })

  it('dia no fuso', () => {
    expect(diaNoFuso(Date.parse('2026-11-23T01:30:00Z'), TZ)).toBe('2026-11-22')
    expect(diaNoFuso(Date.parse('2026-11-23T01:30:00Z'), 'UTC')).toBe('2026-11-23')
  })
})

describe('lembrete padrão e recálculo (CA5)', () => {
  const padrao = (prazo: string) => lembretePadrao(prazo, '09:00', TZ)
  const base = { hora: '09:00', lembrarNoPrazo: true, timeZone: TZ }

  it('o dia do prazo na hora pedida, no fuso', () => {
    expect(lembretePadrao('2026-11-25', '09:00', TZ)).toBe(Date.parse('2026-11-25T09:00:00-03:00'))
    expect(lembretePadrao('2026-11-25', '18:30', 'Europe/Lisbon')).toBe(Date.parse('2026-11-25T18:30:00Z'))
    expect(lembretePadrao('2026-07-01', '08:15', 'Europe/Lisbon')).toBe(Date.parse('2026-07-01T08:15:00+01:00'))
  })

  it('padrão do prazo antigo acompanha o novo; personalizado fica', () => {
    expect(recalcularLembrete({ ...base, lembreteEm: padrao('2026-11-25'), prazoAntigo: '2026-11-25', prazoNovo: '2026-11-28' })).toBe(padrao('2026-11-28'))
    const personalizado = Date.parse('2026-11-25T10:30:00-03:00')
    expect(recalcularLembrete({ ...base, lembreteEm: personalizado, prazoAntigo: '2026-11-25', prazoNovo: '2026-11-28' })).toBe(personalizado)
  })

  it('prazo removido: o padrão sai, o personalizado fica', () => {
    expect(recalcularLembrete({ ...base, lembreteEm: padrao('2026-11-25'), prazoAntigo: '2026-11-25', prazoNovo: null })).toBeNull()
    expect(recalcularLembrete({ ...base, lembreteEm: 123, prazoAntigo: '2026-11-25', prazoNovo: null })).toBe(123)
  })

  it('sem prazo antigo nem lembrete: ganha o padrão só com lembrarNoPrazo ligado', () => {
    expect(recalcularLembrete({ ...base, lembreteEm: null, prazoAntigo: null, prazoNovo: '2026-11-28' })).toBe(padrao('2026-11-28'))
    expect(recalcularLembrete({ ...base, lembrarNoPrazo: false, lembreteEm: null, prazoAntigo: null, prazoNovo: '2026-11-28' })).toBeNull()
    // "Sem aviso" escolhido numa tarefa com prazo continua sem aviso.
    expect(recalcularLembrete({ ...base, lembreteEm: null, prazoAntigo: '2026-11-25', prazoNovo: '2026-11-28' })).toBeNull()
  })
})

describe('slug, dono do resumo e prazo do quando (CA6)', () => {
  it('slug sem acento, minúsculo, com um hífen por trecho e até 80 caracteres', () => {
    expect(slugTexto('Revisar a transcrição  da reunião!')).toBe('revisar-a-transcricao-da-reuniao')
    expect(slugTexto('  --Olá, Mundo--  ')).toBe('ola-mundo')
    const longo = slugTexto(`${'a'.repeat(79)} b`)
    expect(longo).toBe('a'.repeat(79))
    expect(slugTexto('x'.repeat(100))).toHaveLength(80)
    expect(chaveSugestao('reuniao', 'm1', 'Enviar a proposta')).toBe('reuniao:m1:enviar-a-proposta')
  })

  it('responsável: Você é eu; nome de participante que é contato vira contato; outro nome fica como nome', () => {
    const attendees = [{ name: 'Marina Rocha', email: 'Marina@x.example' }, { name: 'Bruno', email: 'bruno@y.example' }]
    const contatos = [{ id: 'c-1', emails: ['marina@x.example'] }]
    expect(responsavelDoDono('Você', attendees, contatos)).toEqual({ tipo: 'eu' })
    expect(responsavelDoDono(null, attendees, contatos)).toEqual({ tipo: 'eu' })
    expect(responsavelDoDono('marina rocha', attendees, contatos)).toEqual({ tipo: 'contato', contatoId: 'c-1' })
    expect(responsavelDoDono('Bruno', attendees, contatos)).toEqual({ tipo: 'nome', nome: 'Bruno' })
    expect(responsavelDoDono('Ana', [], contatos)).toEqual({ tipo: 'nome', nome: 'Ana' })
  })

  it('casa com o resumo pela reunião e pelo slug do texto', () => {
    const t = tarefa({ origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'Enviar a proposta.' } })
    expect(casaComResumo(t, 'm1', 'enviar a PROPOSTA')).toBe(true)
    expect(casaComResumo(t, 'm2', 'Enviar a proposta')).toBe(false)
    expect(casaComResumo(t, 'm1', 'Enviar o contrato')).toBe(false)
    expect(casaComResumo(tarefa(), 'm1', 'Enviar a proposta')).toBe(false)
  })

  it('prazo do quando: AAAA-MM-DD, dd/mm com virada de ano, o resto sem prazo', () => {
    expect(prazoDoQuando('sexta', HOJE)).toBeNull()
    expect(prazoDoQuando('28/11', HOJE)).toBe('2026-11-28')
    expect(prazoDoQuando('05/01', HOJE)).toBe('2027-01-05')
    expect(prazoDoQuando('22/11', HOJE)).toBe('2026-11-22')
    expect(prazoDoQuando('2026-12-10', HOJE)).toBe('2026-12-10')
    expect(prazoDoQuando('2026-02-30', HOJE)).toBeNull()
    expect(prazoDoQuando('31/02', HOJE)).toBeNull()
    expect(prazoDoQuando(undefined, HOJE)).toBeNull()
  })
})
