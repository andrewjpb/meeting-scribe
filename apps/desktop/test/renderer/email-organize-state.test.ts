import { describe, expect, it } from 'vitest'
import type { EmailOrganizeEvent, EmailOrganizeTopic } from '../../src/shared/email-organize'
import { batchMeta, folderCounts, organizeBanner, organizeView, panelBatch, readLine, undoResultText, type BatchMeta } from '../../src/renderer/src/features/email/organizeState'

const name = (path: string): string => path.split('/').join(' › ')
const at = (hour: number, minute: number, day = 19): number => new Date(2026, 10, day, hour, minute).getTime()

const topic = (patch: Partial<EmailOrganizeTopic>): EmailOrganizeTopic => ({
  assunto: 'Assunto',
  veredito: 'resolvido',
  destino: 'Resolvidos',
  motivo: 'Motivo.',
  evidencia: 'Evidência.',
  from: 'Carla Nogueira',
  count: 4,
  status: 'movido',
  open: { accountId: 'a', mailbox: 'Resolvidos', id: 'Resolvidos\n1\n10' },
  ...patch,
})

const event = (patch: Partial<EmailOrganizeEvent> = {}): EmailOrganizeEvent => ({
  batchId: 'b1',
  chatId: 'c1',
  accountId: 'a',
  state: 'running',
  etapa: 'decidindo',
  read: 64,
  total: 200,
  outOfLimit: 31,
  moved: 18,
  byFolder: [
    { path: 'Resolvidos', count: 11 },
    { path: 'Pendentes', count: 6 },
    { path: 'Clientes/ABF', count: 1 },
  ],
  topics: [
    topic({ assunto: 'Credenciamento ABF Expo 2027: lista final' }),
    topic({ assunto: 'Fatura de novembro', veredito: 'pendente', destino: 'Pendentes', from: 'Fluxopay Financeiro', count: 1 }),
    topic({ assunto: 'Re: Renovação do contrato ABF 2027', veredito: 'outra', destino: 'Clientes/ABF', count: 3 }),
    topic({ assunto: 'Re: Ajuste no app Conecta', status: 'decidindo', from: 'Marina Duarte', count: 5, destino: null, open: null }),
  ],
  ...patch,
})

const meta: BatchMeta = { request: 'organiza meus emails em resolvidos e pendentes', startedAt: at(14, 31), endedAt: null, fromPath: 'INBOX', origem: 'agente' }

describe('painel "Organizando" (contrato 55, CA12)', () => {
  it('contadores, etapas e o pedido', () => {
    const view = organizeView(event(), meta, name)
    expect(view.title).toBe('Organizando a Caixa de Entrada')
    expect(view.request).toBe('Pedido no Assistente às 14:31: “organiza meus emails em resolvidos e pendentes”')
    expect(view.stages.map((stage) => `${stage.label}:${stage.status}`)).toEqual(['Lendo:done', 'Decidindo:current', 'Movendo:next'])
    expect([view.read, view.total, view.moved, view.resolved, view.pending, view.others]).toEqual([64, 200, 18, 11, 6, 1])
    expect(view.summary).toBeNull()
  })

  it('"N outras pastas" soma o que não é Resolvidos nem Pendentes (em qualquer nível)', () => {
    expect(folderCounts([{ path: 'INBOX/Resolvidos', count: 2 }, { path: 'pendentes', count: 1 }, { path: 'A', count: 3 }, { path: 'B', count: 4 }])).toEqual({ resolved: 2, pending: 1, others: 7 })
  })

  it('decisões na ordem em que saem; "decidindo" e `open: null` sem clique', () => {
    const view = organizeView(event(), meta, name)
    expect(view.topics.map((row) => row.badge)).toEqual(['Resolvido', 'Pendente', 'Clientes › ABF', 'decidindo'])
    expect(view.topics[0]?.meta).toBe('Carla Nogueira · 4 emails')
    expect(view.topics[1]?.meta).toBe('Fluxopay Financeiro · 1 email')
    expect(view.topics[3]).toMatchObject({ deciding: true, meta: 'Marina Duarte · lendo 5 emails do fio', motivo: '', open: null })
    expect(view.topics[0]?.open).toEqual({ accountId: 'a', mailbox: 'Resolvidos', id: 'Resolvidos\n1\n10' })
  })

  it('nota do limite só com `outOfLimit`; sem item ainda, "a Caixa de Entrada"', () => {
    expect(organizeView(event(), meta, name).limitNote).toBe('A Caixa de Entrada tem 231 mensagens: o Assistente lê as 200 mais recentes e 31 ficam de fora. Na dúvida, vai para Pendentes.')
    expect(organizeView(event({ outOfLimit: 0 }), meta, name).limitNote).toBeNull()
    expect(organizeView(event(), { ...meta, fromPath: null }, name).title).toBe('Organizando a Caixa de Entrada')
    expect(organizeView(event(), { ...meta, fromPath: 'Clientes/ABF' }, name).title).toBe('Organizando a pasta Clientes › ABF')
    expect(organizeView(event(), null, name).request).toBe('')
  })

  it('fim `stopped` e `done`: resumo, Desfazer e as linhas', () => {
    const stopped = organizeView(event({ state: 'stopped' }), { ...meta, endedAt: at(14, 33) }, name)
    expect(stopped.title).toBe('Organização parada')
    expect(stopped.stages.every((stage) => stage.status === 'done')).toBe(true)
    expect(stopped.summary).toEqual({
      line: 'Você parou às 14:33. O que já foi movido ficou onde está.',
      perFolder: '11 em Resolvidos, 6 em Pendentes, 1 em Clientes › ABF',
      readLine: '64 de 200 mensagens lidas. As outras 136 não foram tocadas; 31 ficaram de fora por passar das 200 mais recentes.',
      undo: 'Desfazer as 18',
      decisions: '4 assuntos, 18 mensagens',
    })
    const done = organizeView(event({ state: 'done', read: 200, outOfLimit: 0 }), { ...meta, endedAt: at(14, 40) }, name)
    expect(done.title).toBe('Organização concluída')
    expect(done.summary?.line).toBe('Terminou às 14:40.')
    expect(done.summary?.readLine).toBe('200 de 200 mensagens lidas.')
  })

  it('lote vazio sem Desfazer; `partial-undo` com "Tentar de novo"; `undone` sem botão', () => {
    expect(organizeView(event({ state: 'done', moved: 0, byFolder: [] }), meta, name).summary?.undo).toBeNull()
    expect(organizeView(event({ state: 'partial-undo', moved: 4 }), meta, name).summary?.undo).toBe('Tentar de novo')
    expect(organizeView(event({ state: 'undone', moved: 0 }), meta, name).summary?.undo).toBeNull()
  })

  it('evento de outra conta não mexe no painel desta; o parado fica até o Fechar só se a sessão o viu rodando', () => {
    const other = event({ accountId: 'b', batchId: 'b2' })
    expect(panelBatch({ running: other, today: [] }, 'a', new Set(), new Set())).toBeNull()
    expect(panelBatch({ running: event(), today: [] }, 'a', new Set(), new Set())?.batchId).toBe('b1')
    const stopped = event({ state: 'stopped' })
    expect(panelBatch({ running: null, today: [stopped] }, 'a', new Set(['b1']), new Set())?.state).toBe('stopped')
    expect(panelBatch({ running: null, today: [stopped] }, 'a', new Set(), new Set())).toBeNull()
    expect(panelBatch({ running: null, today: [stopped] }, 'a', new Set(['b1']), new Set(['b1']))).toBeNull()
  })
})

describe('faixa e Desfazer (contrato 55, CA13)', () => {
  const stoppedMeta = { ...meta, endedAt: at(14, 33) }

  it('só lotes de hoje parados ou terminados, com algo movido e não fechados', () => {
    expect(organizeBanner(event({ state: 'stopped' }), stoppedMeta, at(18, 0), new Set())).toEqual({ batchId: 'b1', path: 'INBOX', title: 'O Assistente moveu 18 mensagens', detail: 'hoje, 14:33 · parado por você', retry: false, result: null })
    expect(organizeBanner(event({ state: 'done', moved: 1 }), stoppedMeta, at(18, 0), new Set())?.title).toBe('O Assistente moveu 1 mensagem')
    expect(organizeBanner(event({ state: 'done' }), stoppedMeta, at(18, 0), new Set())?.detail).toBe('hoje, 14:33 · concluído')
    expect(organizeBanner(event(), stoppedMeta, at(18, 0), new Set())).toBeNull()
    expect(organizeBanner(event({ state: 'undone' }), stoppedMeta, at(18, 0), new Set())).toBeNull()
    expect(organizeBanner(event({ state: 'done', moved: 0 }), stoppedMeta, at(18, 0), new Set())).toBeNull()
    expect(organizeBanner(event({ state: 'stopped' }), stoppedMeta, at(18, 0), new Set(['b1']))).toBeNull()
    expect(organizeBanner(event({ state: 'partial-undo', moved: 4 }), stoppedMeta, at(18, 0), new Set())?.retry).toBe(true)
  })

  it('contrato 170 (CA3): o lote do Painel diz "O Painel moveu"; o resto da faixa não muda', () => {
    const painelMeta: BatchMeta = { ...stoppedMeta, origem: 'painel' }
    expect(organizeBanner(event({ state: 'done', moved: 3 }), painelMeta, at(18, 0), new Set())).toEqual({ batchId: 'b1', path: 'INBOX', title: 'O Painel moveu 3 mensagens', detail: 'hoje, 14:33 · concluído', retry: false, result: null })
    expect(organizeBanner(event({ state: 'done', moved: 1 }), painelMeta, at(18, 0), new Set())?.title).toBe('O Painel moveu 1 mensagem')
    expect(organizeBanner(event({ state: 'partial-undo', moved: 2 }), painelMeta, at(18, 0), new Set())).toMatchObject({ title: 'O Painel moveu 2 mensagens', detail: 'hoje, 14:33 · desfeito em parte', retry: true })
    expect(organizeBanner(event({ state: 'done', moved: 3 }), { ...stoppedMeta, origem: 'agente' }, at(18, 0), new Set())?.title).toBe('O Assistente moveu 3 mensagens')
    // O lote gravado sem `origem` (de antes do contrato 156) é do agente.
    const semOrigem = batchMeta({ request: '', startedAt: at(14, 31), endedAt: at(14, 33), items: [] })
    expect(semOrigem.origem).toBe('agente')
    expect(organizeBanner(event({ state: 'done', moved: 3 }), semOrigem, at(18, 0), new Set())?.title).toBe('O Assistente moveu 3 mensagens')
    expect(batchMeta({ request: '', startedAt: at(14, 31), endedAt: at(14, 33), items: [], origem: 'painel' }).origem).toBe('painel')
  })

  it('desfeito pela faixa: a frase do resultado fica, mesmo com o lote já `undone` (até o × ou os 5 s)', () => {
    const results = { b1: { text: 'Desfeito: 18 mensagens voltaram para a Caixa de Entrada.', failed: false } }
    const shown = organizeBanner(event({ state: 'undone', moved: 0 }), stoppedMeta, at(18, 0), new Set(), results)
    expect(shown?.result?.text).toBe('Desfeito: 18 mensagens voltaram para a Caixa de Entrada.')
    expect(shown?.path).toBe('INBOX')
    expect(organizeBanner(event({ state: 'undone', moved: 0 }), stoppedMeta, at(18, 0), new Set(['b1']), results)).toBeNull()
    expect(organizeBanner(event({ state: 'undone', moved: 0 }), stoppedMeta, at(18, 0), new Set(), {})).toBeNull()
  })

  it('a faixa vai até a meia-noite local', () => {
    expect(organizeBanner(event({ state: 'stopped' }), stoppedMeta, at(23, 59), new Set())).not.toBeNull()
    expect(organizeBanner(event({ state: 'stopped' }), stoppedMeta, at(0, 1, 20), new Set())).toBeNull()
  })

  it('resultado do Desfazer em frase, por código', () => {
    expect(undoResultText({ ok: true, undone: 18, failed: [] }, 'a Caixa de Entrada')).toEqual({ text: 'Desfeito: 18 mensagens voltaram para a Caixa de Entrada.', failed: false })
    expect(undoResultText({ ok: true, undone: 14, failed: [{ code: 'folder-missing', count: 2 }, { code: 'origin-missing', count: 1 }, { code: 'not-found', count: 1 }] }, 'a Caixa de Entrada').text).toBe(
      'Voltaram 14 mensagens; 4 não voltaram: 2 porque a pasta de destino sumiu; 1 porque a pasta de origem não existe mais (o app não recria); 1 porque já tinham saído da pasta.',
    )
    expect(undoResultText({ ok: false, error: 'busy' }, 'x').text).toContain('ainda está organizando')
  })

  it('a frase da leitura, cada parte só quando vale', () => {
    expect(readLine(200, 200, 0)).toBe('200 de 200 mensagens lidas.')
    expect(readLine(200, 200, 31)).toBe('200 de 200 mensagens lidas. 31 ficaram de fora por passar das 200 mais recentes.')
    expect(readLine(10, 40, 0)).toBe('10 de 40 mensagens lidas. As outras 30 não foram tocadas.')
  })
})
