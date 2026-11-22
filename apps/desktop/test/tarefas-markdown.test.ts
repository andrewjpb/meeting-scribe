// Contrato 121 (tarefas, CA10, R27): o `TAREFAS.md`. As quatro seções pela partição, só abertas, id curto e nomes dos
// vínculos, o corte em 200 linhas e a seção Lembretes; nada de e-mail.
import { describe, expect, it } from 'vitest'
import { tarefasMarkdown } from '../src/main/tarefas/markdown'
import type { Tarefa } from '../src/shared/tarefas'

const HOJE = '2026-11-22'
const TZ = 'America/Sao_Paulo'

let seq = 0
const tarefa = (patch: Partial<Tarefa> = {}): Tarefa => {
  seq++
  return {
    id: `${String(seq).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`,
    titulo: `Tarefa ${seq}`,
    detalhe: 'segredo do detalhe',
    status: 'aberta',
    importante: false,
    prazo: null,
    lembreteEm: null,
    lembreteDisparadoEm: null,
    responsavel: { tipo: 'eu' },
    origem: { tipo: 'manual' },
    vinculos: { oportunidadeId: 'op-1', contatoIds: ['c-1'], empresaId: null, meetingId: 'm-1', email: { accountId: 'a', id: 'x', assunto: 'Assunto', mailbox: null }, whatsappChatId: null },
    historico: [],
    criadaEm: seq,
    atualizadaEm: seq,
    feitaEm: null,
    ...patch,
  }
}

const nomes = {
  oportunidades: new Map([['op-1', 'Portal da ACME']]),
  contatos: new Map([
    ['c-1', 'Marina Rocha'],
    ['c-2', 'Bruno'],
  ]),
  reunioes: new Map([['m-1', 'Kickoff']]),
}

const linhasDaSecao = (md: string, secao: string): string[] => {
  const depois = md.split(`## ${secao}\n`)[1] ?? ''
  return (depois.split('\n## ')[0] ?? '').split('\n').filter((linha) => linha.startsWith('- '))
}

describe('TAREFAS.md (CA10)', () => {
  it('as quatro seções na ordem, só abertas, id de 8 caracteres e os nomes dos vínculos', () => {
    const vencida = tarefa({ titulo: 'Vencida', prazo: '2026-11-20' })
    const hoje = tarefa({ titulo: 'De hoje', prazo: HOJE, responsavel: { tipo: 'nome', nome: 'Ana' } })
    const proxima = tarefa({ titulo: 'Próxima', prazo: '2026-11-30', responsavel: { tipo: 'contato', contatoId: 'c-2' } })
    const semPrazo = tarefa({ titulo: 'Sem prazo', vinculos: { oportunidadeId: 'op-1', contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null } })
    const feita = tarefa({ titulo: 'Feita', status: 'feita', prazo: '2026-11-21', lembreteEm: Date.parse('2026-11-25T10:30:00-03:00') })
    const md = tarefasMarkdown({ tarefas: [semPrazo, feita, proxima, hoje, vencida], nomes, hoje: HOJE, timeZone: TZ })

    expect(md.startsWith('# Tarefas\n')).toBe(true)
    expect(md).toContain('[Tarefa · <título>]')
    const posicoes = ['## Vencidas', '## Hoje', '## Próximas', '## Sem prazo', '## Lembretes'].map((secao) => md.indexOf(secao))
    expect(posicoes.every((pos) => pos >= 0)).toBe(true)
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes)
    expect(md).not.toContain('Feita')

    expect(linhasDaSecao(md, 'Vencidas')).toEqual([`- ${vencida.id.slice(0, 8)} · Vencida · prazo 20/11 · responsável: Eu · oportunidade: Portal da ACME · contatos: Marina Rocha · reunião: Kickoff`])
    expect(linhasDaSecao(md, 'Hoje')).toEqual([`- ${hoje.id.slice(0, 8)} · De hoje · prazo 22/11 · responsável: Ana · oportunidade: Portal da ACME · contatos: Marina Rocha · reunião: Kickoff`])
    expect(linhasDaSecao(md, 'Próximas')[0]).toContain('· responsável: Bruno ·')
    expect(linhasDaSecao(md, 'Sem prazo')).toEqual([`- ${semPrazo.id.slice(0, 8)} · Sem prazo · sem prazo · responsável: Eu · oportunidade: Portal da ACME`])
    for (const secao of ['Vencidas', 'Hoje', 'Próximas', 'Sem prazo']) {
      for (const linha of linhasDaSecao(md, secao)) expect(linha).toMatch(/^- [0-9a-z]{8} · /)
    }
    expect(md).toContain('## Lembretes\n\nNenhum lembrete.')
    expect(md).not.toContain('@')
    expect(md).not.toContain('segredo do detalhe')
    expect(md).not.toContain('Assunto')
  })

  it('seção vazia diz "Nenhuma."', () => {
    const md = tarefasMarkdown({ tarefas: [], nomes, hoje: HOJE, timeZone: TZ })
    expect(md.match(/Nenhuma\./g)).toHaveLength(4)
    expect(md).toContain('Nenhum lembrete.')
  })

  it('250 abertas: 200 linhas nas quatro seções, na ordem das seções', () => {
    const lista = [
      ...Array.from({ length: 150 }, () => tarefa({ prazo: '2026-11-01' })),
      ...Array.from({ length: 50 }, () => tarefa({ prazo: HOJE })),
      ...Array.from({ length: 50 }, () => tarefa({ prazo: null })),
    ]
    const md = tarefasMarkdown({ tarefas: lista, nomes, hoje: HOJE, timeZone: TZ })
    const contagem = ['Vencidas', 'Hoje', 'Próximas', 'Sem prazo'].map((secao) => linhasDaSecao(md, secao).length)
    expect(contagem).toEqual([150, 50, 0, 0])
    expect(md).toContain('## Próximas\n\nNenhuma.')
    expect(md).toContain('… e mais 50 (lista truncada).')
  })

  it('Lembretes: abertas com aviso, por data, com dia e hora no fuso e "já avisou"', () => {
    const depois = tarefa({ titulo: 'Depois', lembreteEm: Date.parse('2026-11-26T08:00:00-03:00'), lembreteDisparadoEm: null })
    const aviso = tarefa({ titulo: 'Com aviso', prazo: '2026-11-25', lembreteEm: Date.parse('2026-11-25T10:30:00-03:00') })
    const avisou = tarefa({ titulo: 'Já foi', lembreteEm: Date.parse('2026-11-21T09:00:00-03:00'), lembreteDisparadoEm: 1 })
    const feita = tarefa({ titulo: 'Feita com aviso', status: 'feita', lembreteEm: Date.parse('2026-11-24T09:00:00-03:00') })
    const md = tarefasMarkdown({ tarefas: [depois, aviso, avisou, feita], nomes, hoje: HOJE, timeZone: TZ })
    expect(linhasDaSecao(md, 'Lembretes')).toEqual([
      `- ${avisou.id.slice(0, 8)} · Já foi · aviso 21/11 09:00 · já avisou`,
      `- ${aviso.id.slice(0, 8)} · Com aviso · aviso 25/11 10:30`,
      `- ${depois.id.slice(0, 8)} · Depois · aviso 26/11 08:00`,
    ])
    expect(md).not.toContain('Feita com aviso')
  })
})
