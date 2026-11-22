// Contrato 115 (funil-vendas, CA1): o `FUNIL.md` (R41, R27, D16). "esfriada" pela última interação, ganhas e perdidas
// só dos últimos 90 dias e nunca arquivadas, valores por `formatarBRL` e a lista de contatos cortada em 500. Contrato
// 124 (CA5, R16): "Tarefas abertas" no lugar de "Próximo passo".
import { describe, expect, it } from 'vitest'
import { FUNIL_MD_CONTATOS_MAX, FUNIL_MD_TRUNCADA, funilMarkdown } from '../src/main/funil/markdown'
import type { Contato, Etapa, FunilState, FunilView, Oportunidade } from '../src/shared/funil'
import { etapasPadrao, formatarBRL } from '../src/shared/funil-logic'
import type { Tarefa } from '../src/shared/tarefas'

const DIA_MS = 86_400_000
const NOW = Date.parse('2026-11-20T15:00:00.000Z')
const TZ = 'America/Sao_Paulo'

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

const contato = (patch: Partial<Contato> = {}): Contato => ({
  id: `c-${++seq}`,
  nome: 'Ana Souza',
  emails: [],
  telefones: [],
  empresaId: null,
  cargo: null,
  notas: '',
  whatsappChatId: null,
  origem: 'manual',
  criadoEm: NOW - 50 * DIA_MS,
  atualizadoEm: NOW - 50 * DIA_MS,
  arquivado: false,
  ...patch,
})

const view = (patch: Partial<FunilState>, ultimas: Record<string, number> = {}): FunilView => ({
  state: { version: 1, contatos: [], empresas: [], oportunidades: [], etapas, eventos: [], ignorados: [], ultimoAvisoEm: null, ...patch },
  ultimas,
  proximosPassos: {},
})

/** Uma tarefa aberta ligada à oportunidade. */
const tarefa = (oportunidadeId: string, titulo: string, prazo: string | null, criadaEm = NOW): Tarefa => ({
  id: `t-${++seq}`,
  titulo,
  detalhe: '',
  status: 'aberta',
  importante: false,
  prazo,
  lembreteEm: null,
  lembreteDisparadoEm: null,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'funil', oportunidadeId },
  vinculos: { oportunidadeId, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  historico: [],
  criadaEm,
  atualizadaEm: criadaEm,
  feitaEm: null,
})

const gerar = (v: FunilView, tarefas: readonly Tarefa[] = []): string => funilMarkdown({ view: v, tarefas, diasEsfriar: 7, reunioes: new Map([['r-1', 'Kickoff ABF']]), now: NOW, timeZone: TZ })

/** As linhas de uma seção `## …` até a próxima. */
function secao(texto: string, titulo: string): string[] {
  const linhas = texto.split('\n')
  const inicio = linhas.findIndex((linha) => linha.startsWith(`## ${titulo}`))
  if (inicio === -1) throw new Error(titulo)
  const fim = linhas.findIndex((linha, indice) => indice > inicio && linha.startsWith('## '))
  return linhas.slice(inicio + 1, fim === -1 ? undefined : fim)
}

describe('FUNIL.md (contrato 115, CA1)', () => {
  it('marca "esfriada" com 8 dias sem interação e não com 6', () => {
    const fria = oportunidade({ titulo: 'Portal ABF' })
    const morna = oportunidade({ titulo: 'App Conecta' })
    const texto = gerar(view({ oportunidades: [fria, morna] }, { [fria.id]: NOW - 8 * DIA_MS, [morna.id]: NOW - 6 * DIA_MS }))
    const [primeira, segunda] = texto.split('### ').slice(1)
    expect(primeira).toContain(`Portal ABF · id: ${fria.id}`)
    expect(primeira).toContain('esfriada')
    expect(segunda).toContain(`App Conecta · id: ${morna.id}`)
    expect(segunda?.split('## ')[0]).not.toContain('esfriada')
  })

  it('traz empresa, contatos, etapa, valor por formatarBRL, previsão, tarefas abertas, última interação e reuniões', () => {
    const ana = contato({ nome: 'Ana Souza', emails: ['ana@acme.com.br'] })
    const aberta = oportunidade({
      titulo: 'Portal',
      empresaId: 'emp-1',
      contatoIds: [ana.id],
      valor: 3_800_000,
      previsao: '2026-12-15',
      meetingIds: ['r-1', 'r-sumiu'],
    })
    const texto = gerar(view({ oportunidades: [aberta], contatos: [ana], empresas: [{ id: 'emp-1', nome: 'Acme', dominios: ['acme.com.br'], site: null, notas: '', criadoEm: NOW, atualizadoEm: NOW }] }, { [aberta.id]: Date.parse('2026-11-18T13:30:00.000Z') }), [tarefa(aberta.id, 'Enviar proposta', '2026-11-25')])
    expect(texto).toContain('- Empresa: Acme')
    expect(texto).toContain('- Contatos: Ana Souza <ana@acme.com.br>')
    expect(texto).toContain('- Etapa: Proposta')
    expect(texto).toContain(`- Valor: ${formatarBRL(3_800_000)}`)
    expect(texto).toContain('- Previsão: 15/12/2026')
    expect(texto).toContain('- Tarefas abertas: Enviar proposta (até 25/11)')
    expect(texto).toContain('- Última interação: 18/11/2026 10:30')
    expect(texto).toContain('- Reuniões: r-1 · Kickoff ABF; r-sumiu · Reunião apagada')
    expect(secao(texto, 'Etapas').filter((linha) => linha.startsWith('- '))).toEqual([
      '- Contato (aberta)',
      '- Descoberta (aberta)',
      '- Proposta (aberta)',
      '- Negociação (aberta)',
      '- Ganho (final)',
      '- Perdido (final)',
    ])
  })

  it('CA5 (contrato 124): até 5 tarefas abertas pela ordem do prazo, "—" sem nenhuma; nenhuma linha "Próximo passo"', () => {
    const cheia = oportunidade({ titulo: 'Cheia', proximoPasso: { texto: 'Legado que não aparece', data: '2026-11-01' } })
    const vazia = oportunidade({ titulo: 'Vazia' })
    const ganha = oportunidade({ titulo: 'Ganha', etapaId: porNome('Ganho').id, fechadoEm: NOW - DIA_MS })
    const tarefas = [
      tarefa(cheia.id, 'Sem prazo', null, NOW - 10),
      tarefa(cheia.id, 'Dia 30', '2026-11-30'),
      tarefa(cheia.id, 'Dia 22', '2026-11-22'),
      tarefa(cheia.id, 'Dia 25', '2026-11-25'),
      tarefa(cheia.id, 'Dia 21', '2026-11-21'),
      tarefa(cheia.id, 'Dia 28', '2026-11-28'),
      { ...tarefa(cheia.id, 'Feita antes', '2026-11-01'), status: 'feita' as const, feitaEm: NOW },
      tarefa(ganha.id, 'Da ganha', '2026-11-21'),
    ]
    const texto = gerar(view({ oportunidades: [cheia, vazia, ganha] }), tarefas)
    expect(texto).toContain('- Tarefas abertas: Dia 21 (até 21/11); Dia 22 (até 22/11); Dia 25 (até 25/11); Dia 28 (até 28/11); Dia 30 (até 30/11)')
    expect(texto).not.toContain('Sem prazo')
    expect(texto).not.toContain('Feita antes')
    expect(texto).not.toContain('Da ganha')
    expect(texto).not.toContain('Próximo passo')
    expect(texto).not.toContain('Legado que não aparece')
    const [, segunda] = texto.split('### ').slice(1)
    expect(segunda).toContain('- Tarefas abertas: —')
    // Sem data, só o título.
    expect(gerar(view({ oportunidades: [vazia] }), [tarefa(vazia.id, 'Ligar', null)])).toContain('- Tarefas abertas: Ligar\n')
  })

  it('ganhas e perdidas: só as dos últimos 90 dias e nunca as arquivadas (R27)', () => {
    const antiga = oportunidade({ titulo: 'Antiga', etapaId: porNome('Ganho').id, fechadoEm: NOW - 100 * DIA_MS, valor: 100_000 })
    const recente = oportunidade({ titulo: 'Recente', etapaId: porNome('Ganho').id, fechadoEm: NOW - 10 * DIA_MS, valor: 125_050 })
    const arquivada = oportunidade({ titulo: 'Arquivada', etapaId: porNome('Ganho').id, fechadoEm: NOW - 10 * DIA_MS, arquivado: true })
    const perdida = oportunidade({ titulo: 'Perdida', etapaId: porNome('Perdido').id, fechadoEm: NOW - 5 * DIA_MS, motivoPerda: 'Preço' })
    const texto = gerar(view({ oportunidades: [antiga, recente, arquivada, perdida] }))
    const fechadas = secao(texto, 'Ganhas e perdidas').join('\n')
    expect(fechadas).toContain(`- Recente · id: ${recente.id} · Ganho · ${formatarBRL(125_050)} · 10/11/2026`)
    expect(fechadas).toContain(`- Perdida · id: ${perdida.id} · Perdido · ${formatarBRL(null)} · 15/11/2026 · motivo: Preço`)
    expect(texto).not.toContain('Antiga')
    expect(texto).not.toContain('Arquivada')
    expect(secao(texto, 'Oportunidades abertas')).toContain('Nenhuma.')
  })

  it('contatos: até 500, os mais recentes primeiro, sem os arquivados; acima disso, "lista truncada; peça pelo nome"', () => {
    const contatos = Array.from({ length: 501 }, (_, indice) => contato({ id: `ct-${indice}`, nome: `Pessoa ${indice}`, atualizadoEm: NOW - indice * 1000, emails: [`p${indice}@x.com`], telefones: ['+5511987654321'] }))
    const texto = gerar(view({ contatos: [...contatos, contato({ nome: 'Arquivado', arquivado: true, atualizadoEm: NOW })] }))
    const linhas = secao(texto, 'Contatos')
    expect(linhas.filter((linha) => linha.startsWith('- '))).toHaveLength(FUNIL_MD_CONTATOS_MAX)
    expect(linhas[1]).toBe('- ct-0 · Pessoa 0 · — · p0@x.com · +5511987654321')
    expect(linhas.join('\n')).not.toContain('Pessoa 500')
    expect(linhas).toContain(FUNIL_MD_TRUNCADA)
    expect(FUNIL_MD_TRUNCADA).toBe('lista truncada; peça pelo nome')
    expect(texto).not.toContain('Arquivado')
    const poucos = gerar(view({ contatos: contatos.slice(0, 500) }))
    expect(poucos).not.toContain(FUNIL_MD_TRUNCADA)
  })
})
