// Contrato 15, CA4: o Markdown das respostas vira árvore de dados (nenhum HTML do texto chega ao DOM), os
// links `meeting:` e `https://` são reconhecidos, e o store do chat acompanha a resposta em pedaços. Contrato
// 16: textos do rodapé, do painel e das sugestões, a lista agrupada por dia, e o store com o raciocínio, os
// passos, os detalhes, o rascunho da conversa nova e o "Refazer". Canal falso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, ChatEvent } from '@shared/chat'
import { emptyAnswer, useChat } from '../../src/renderer/src/features/chat/chatStore'
import {
  answerTimeLabel,
  chatSuggestionGroups,
  chatTotals,
  chosenMeetings,
  consultedIn,
  consultedLabel,
  costLabel,
  filterChats,
  frequentWord,
  groupChatsByDay,
  modelLabel,
  railScrollTarget,
  scopeLabel,
  tokensLabel,
} from '../../src/renderer/src/features/chat/format'
import { isExternalLink, parseInline, parseMarkdown } from '../../src/renderer/src/features/chat/markdown'

const AT = '2026-11-15T20:00:00.000Z'

describe('Markdown das respostas (CA4)', () => {
  it('parágrafos, listas, negrito, itálico, código e links', () => {
    expect(parseMarkdown('Primeiro **parágrafo**\ncontinua.\n\n- um\n- `dois`\n\n1. a\n2. *b*\n\n```\nx < y\n```')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Primeiro ' }, { type: 'strong', children: [{ type: 'text', text: 'parágrafo' }] }, { type: 'text', text: '\ncontinua.' }] },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'um' }], [{ type: 'code', text: 'dois' }]] },
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'a' }], [{ type: 'em', children: [{ type: 'text', text: 'b' }] }]] },
      { type: 'code', text: 'x < y' },
    ])
  })

  it('link meeting: com o título e a data; nada de link dentro de link', () => {
    expect(parseInline('Decidido [Planejamento · 14/11](meeting:smoke-1).')).toEqual([
      { type: 'text', text: 'Decidido ' },
      { type: 'link', href: 'meeting:smoke-1', children: [{ type: 'text', text: 'Planejamento · 14/11' }] },
      { type: 'text', text: '.' },
    ])
    expect(parseInline('[a [b](https://x.com)](meeting:m)')).toEqual([{ type: 'link', href: 'meeting:m', children: [{ type: 'text', text: 'a [b](https://x.com)' }] }])
  })

  it('HTML fica como texto; título vira parágrafo em negrito; citação, parágrafo', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }])
    expect(parseMarkdown('## Decisões\n> citado')).toEqual([
      { type: 'heading', children: [{ type: 'text', text: 'Decisões' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'citado' }] },
    ])
    expect(parseInline('\\*literal\\* e 2 * 3 * 4')).toEqual([{ type: 'text', text: '*literal* e 2 * 3 * 4' }])
  })

  it('linear: 20 000 [ (e outras marcas sem fecho) em menos de 50 ms', () => {
    for (const source of ['['.repeat(20_000), '[a]('.repeat(5_000), '*a'.repeat(10_000), '`'.repeat(20_001)]) {
      // Melhor de três, depois de aquecer: a suíte roda em paralelo e a primeira chamada paga a compilação.
      parseMarkdown(source)
      const times = [0, 1, 2].map(() => {
        const started = performance.now()
        parseMarkdown(source)
        return performance.now() - started
      })
      expect(Math.min(...times)).toBeLessThan(50)
    }
  })

  it('link externo só com https:// válido', () => {
    expect(isExternalLink('https://exemplo.com/a')).toBe(true)
    expect(isExternalLink('http://exemplo.com')).toBe(false)
    expect(isExternalLink('javascript:alert(1)')).toBe(false)
    expect(isExternalLink('file:///etc/passwd')).toBe(false)
    expect(isExternalLink('https://')).toBe(false)
  })

})

describe('textos da tela "Perguntar" v2 (contrato 16)', () => {
  it('modelo, tempo, tokens, custo e consultadas', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet')
    expect(modelLabel('haiku')).toBe('Haiku')
    expect(modelLabel('opus')).toBe('Opus')
    expect(modelLabel('outro-modelo')).toBe('outro-modelo')
    expect(modelLabel(undefined)).toBe('')
    expect(answerTimeLabel(12_300)).toBe('12 s')
    expect(answerTimeLabel(200)).toBe('1 s')
    expect(answerTimeLabel(65_000)).toBe('1 min 05 s')
    expect(tokensLabel(420)).toBe('420')
    expect(tokensLabel(3112)).toBe('3,1 mil')
    expect(tokensLabel(1_250_000)).toBe('1,3 mi')
    expect(costLabel(0.0213)).toBe('US$ 0,02')
    expect(costLabel(0.001)).toBe('menos de US$ 0,01')
    expect(costLabel(0)).toBe('US$ 0,00')
    expect(consultedLabel(1)).toBe('1 reunião consultada')
    expect(consultedLabel(3)).toBe('3 reuniões consultadas')
  })

  it('escopo, totais e consultadas da conversa', () => {
    expect(scopeLabel({ kind: 'all' }, 6)).toBe('Todas as reuniões (6)')
    expect(scopeLabel({ kind: '7d' }, 6)).toBe('Últimos 7 dias')
    expect(scopeLabel({ kind: '30d' }, null)).toBe('Últimos 30 dias')
    expect(scopeLabel({ kind: 'meetings', meetingIds: ['a', 'b'] }, 6)).toBe('Reuniões escolhidas (2)')
    // Só contam as que ainda existem.
    const exists = (id: string): boolean => id !== 'b'
    expect(scopeLabel({ kind: 'meetings', meetingIds: ['a', 'b'] }, 6, exists)).toBe('Reuniões escolhidas (1)')
    expect(chosenMeetings({ kind: 'meetings', meetingIds: ['b'] }, exists)).toEqual([])
    expect(chosenMeetings({ kind: 'meetings', meetingIds: ['b'] }, null)).toEqual(['b'])
    expect(chosenMeetings({ kind: 'all' }, null)).toEqual([])
    const meta = { model: 'claude-sonnet-5-5', durationMs: 2000, inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, costUsd: 0.01, turns: 2, consulted: ['m1', 'm2'] }
    const messages = [
      { role: 'user' as const, text: 'a', at: AT },
      { role: 'assistant' as const, text: 'b', at: AT, meta },
      { role: 'user' as const, text: 'c', at: AT },
      { role: 'assistant' as const, text: 'd', at: AT, meta: { ...meta, consulted: ['m2', 'm3'] } },
      // Sem meta (resposta parada): as consultadas saem dos passos.
      { role: 'assistant' as const, text: 'e', at: AT, steps: [{ tool: 'Read' as const, label: 'x', meetingId: 'm4' }] },
    ]
    expect(chatTotals(messages)).toEqual({ messages: 5, tokens: 300, costUsd: 0.02, durationMs: 4000 })
    expect(consultedIn(messages)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('6 sugestões em 3 grupos, com o participante e a palavra do acervo quando há', () => {
    const groups = chatSuggestionGroups('Ana', 'migração')
    expect(groups.map((group) => group.title)).toEqual(['Esta semana', 'Pessoas', 'Tópicos'])
    expect(groups.flatMap((group) => group.items)).toEqual([
      'O que ficou decidido esta semana?',
      'Quais tarefas são minhas?',
      'Resuma a última reunião com Ana',
      'O que Ana pediu?',
      'O que foi dito sobre migração?',
      'Quais pendências estão abertas?',
    ])
    expect(chatSuggestionGroups(null, null).flatMap((group) => group.items)).toHaveLength(6)
    expect(chatSuggestionGroups(null, null)[1]?.items[0]).toBe('Resuma a última reunião')
    expect(chatSuggestionGroups('Ana', null, true)[0]?.title).toBe('Esta reunião')
    expect(frequentWord(['Planejamento da migração', 'A migração do banco ficou para sábado', 'Revisão do contrato'])).toBe('migração')
    expect(frequentWord(['Uma reunião', 'Outra reunião'])).toBeNull()
  })

  it('lista de conversas: busca sem acento e agrupada por dia', () => {
    const now = new Date('2026-11-15T18:00:00')
    const item = (id: string, title: string, iso: string) => ({ id, meetingId: null, title, createdAt: iso, updatedAt: new Date(iso).toISOString() })
    const items = [item('a', 'Decisões da migração', '2026-11-15T10:00:00'), item('b', 'Tarefas', '2026-11-15T09:00:00'), item('c', 'Contrato', '2026-11-14T09:00:00')]
    expect(filterChats(items, 'DECISOES').map((entry) => entry.id)).toEqual(['a'])
    expect(filterChats(items, '  ').map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(groupChatsByDay(items, now).map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ['Hoje', ['a', 'b']],
      ['Ontem', ['c']],
    ])
  })
})

describe('trilho do Assistente (contrato 38)', () => {
  const rail = { top: 100, height: 500, scrollTop: 0 }
  it('o Contexto inteiro à vista não rola', () => {
    expect(railScrollTarget(rail, { top: 300, height: 200 })).toBeNull()
  })
  it('abaixo da vista e cabendo: rola o mínimo para aparecer inteiro', () => {
    expect(railScrollTarget(rail, { top: 450, height: 300 })).toBe(150)
  })
  it('maior que o trilho: o topo dele no alto, contando a rolagem que já havia', () => {
    expect(railScrollTarget({ ...rail, scrollTop: 40 }, { top: 400, height: 900 })).toBe(340)
  })
  it('acima da vista: volta até o topo dele', () => {
    expect(railScrollTarget({ ...rail, scrollTop: 300 }, { top: 50, height: 100 })).toBe(250)
  })
})

describe('store do chat (CA3)', () => {
  const invoke = vi.fn()
  let emit: ((event: ChatEvent) => void) | null = null
  const chat: Chat = { id: 'c1', meetingId: null, title: 'Oi?', createdAt: AT, messages: [{ role: 'user', text: 'Oi?', at: AT }], scope: { kind: 'all' }, model: 'sonnet', thinkMore: false }

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => {
      if (channel === 'scribe:chat-send') return Promise.resolve({ ok: true, chat })
      if (channel === 'scribe:claude-locate') return Promise.resolve({ ok: true, path: '/x/claude', version: '2.1.325' })
      return Promise.resolve([])
    })
    vi.stubGlobal('window', {
      __scribeApi: {
        invoke,
        send: vi.fn(),
        on: (_channel: string, listener: (event: ChatEvent) => void) => {
          emit = listener
          return () => undefined
        },
      },
    })
    useChat.setState({ claude: 'checking', lists: {}, chats: {}, answers: {}, drafts: {}, sending: {}, redoing: {}, selected: {}, failures: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('enviar seleciona a conversa nova e marca a resposta em curso; pedaços e fim chegam pelo evento', async () => {
    expect(await useChat.getState().send(null, null, 'Oi?')).toBe('c1')
    expect(useChat.getState().selected['all']).toBe('c1')
    expect(useChat.getState().answers['c1']).toEqual(emptyAnswer())
    expect(useChat.getState().lists['all']?.map((item) => item.id)).toEqual(['c1'])
    emit?.({ type: 'answer', chatId: 'c1', text: 'Olá', reading: false })
    expect(useChat.getState().answers['c1']?.text).toBe('Olá')
    const done: Chat = { ...chat, messages: [...chat.messages, { role: 'assistant', text: 'Olá.', at: AT }] }
    emit?.({ type: 'done', chatId: 'c1', chat: done })
    expect(useChat.getState().answers['c1']).toBeUndefined()
    expect(useChat.getState().chats['c1']?.messages).toHaveLength(2)
  })

  it('a pessoa trocou de conversa enquanto a pergunta ia: a troca dela vale', async () => {
    let resolve: (value: unknown) => void = () => undefined
    invoke.mockImplementation((channel: string) => (channel === 'scribe:chat-send' ? new Promise((done) => (resolve = done)) : Promise.resolve([])))
    const sending = useChat.getState().send(null, null, 'Oi?')
    useChat.getState().select(null, 'outra')
    resolve({ ok: true, chat })
    expect(await sending).toBe('c1')
    expect(useChat.getState().selected['all']).toBe('outra')
  })

  it('sem claude: nada fica marcado e a tela passa a mostrar o aviso (CA7)', async () => {
    invoke.mockImplementation(() => Promise.resolve({ ok: false, error: 'not-found' }))
    expect(await useChat.getState().send(null, null, 'Oi?')).toBeNull()
    expect(useChat.getState().claude).toBe('not-found')
    expect(useChat.getState().chats).toEqual({})
  })

  it('pelo ACP o mesmo passo troca de estado no lugar e o plano chega inteiro (contrato 17)', async () => {
    await useChat.getState().send(null, null, 'Oi?')
    emit?.({ type: 'step', chatId: 'c1', step: { tool: 'Read', label: 'Abrindo um arquivo', meetingId: null, id: 't1', status: 'pending' } })
    emit?.({ type: 'step', chatId: 'c1', step: { tool: 'Grep', label: 'Procurando "x"', meetingId: null, id: 't2', status: 'pending' } })
    emit?.({ type: 'step', chatId: 'c1', step: { tool: 'Read', label: 'Lendo o índice das reuniões', meetingId: null, id: 't1', status: 'completed' } })
    emit?.({ type: 'plan', chatId: 'c1', entries: [{ content: 'Ler o índice', status: 'in_progress' }] })
    emit?.({ type: 'plan', chatId: 'c1', entries: [{ content: 'Ler o índice', status: 'completed' }, { content: 'Responder', status: 'pending' }] })
    const answer = useChat.getState().answers['c1']
    expect(answer?.steps.map((step) => `${step.id}:${step.label}:${step.status}`)).toEqual(['t1:Lendo o índice das reuniões:completed', 't2:Procurando "x":pending'])
    expect(answer?.plan).toEqual([
      { content: 'Ler o índice', status: 'completed' },
      { content: 'Responder', status: 'pending' },
    ])
  })

  it('"Pensar mais" da conversa nova vai junto na primeira pergunta (contrato 17, CA5)', async () => {
    useChat.getState().setDraft(null, { thinkMore: true })
    await useChat.getState().send(null, null, 'Oi?')
    expect(invoke).toHaveBeenCalledWith('scribe:chat-send', { chatId: null, meetingId: null, text: 'Oi?', scope: { kind: 'all' }, thinkMore: true })
  })

  it('raciocínio, passos, negação e detalhes chegam pelo evento e somem no fim (contrato 16)', async () => {
    await useChat.getState().send(null, null, 'Oi?')
    emit?.({ type: 'thinking', chatId: 'c1', delta: 'Vou ' })
    emit?.({ type: 'thinking', chatId: 'c1', delta: 'ler' })
    emit?.({ type: 'step', chatId: 'c1', step: { tool: 'Read', label: 'Lendo o índice das reuniões', meetingId: null } })
    emit?.({ type: 'step', chatId: 'c1', step: { tool: 'Grep', label: 'Procurando "x"', meetingId: null } })
    emit?.({ type: 'denied', chatId: 'c1', count: 1 })
    const meta = { model: 'claude-sonnet-5-5', durationMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costUsd: 0, turns: 1, consulted: [] }
    emit?.({ type: 'meta', chatId: 'c1', meta })
    expect(useChat.getState().answers['c1']).toEqual({ text: '', reading: false, thinking: 'Vou ler', steps: [{ tool: 'Read', label: 'Lendo o índice das reuniões', meetingId: null }, { tool: 'Grep', label: 'Procurando "x"', meetingId: null }], denied: 1, plan: [], meta, approvals: [] })
    emit?.({ type: 'done', chatId: 'c1', chat: { ...chat, messages: [...chat.messages, { role: 'assistant', text: 'Olá.', at: AT, meta }] } })
    expect(useChat.getState().answers['c1']).toBeUndefined()
  })

  it('o cartão de aprovação MCP chega pelo evento, a escolha vai ao main e o cartão sai quando ele avisa (contrato 21)', async () => {
    await useChat.getState().send(null, null, 'Oi?')
    const approval = { id: 'mcp-1', server: 'calculadora', tool: 'soma', args: '{"a": 2}' }
    emit?.({ type: 'approval', chatId: 'c1', approval })
    expect(useChat.getState().answers['c1']?.approvals).toEqual([approval])
    await useChat.getState().answerApproval('c1', 'mcp-1', 'once')
    expect(invoke).toHaveBeenCalledWith('scribe:chat-approval', { chatId: 'c1', id: 'mcp-1', decision: 'once' })
    emit?.({ type: 'approval-done', chatId: 'c1', id: 'mcp-1', decision: 'once' })
    expect(useChat.getState().answers['c1']?.approvals).toEqual([])
  })

  it('a conversa nova de uma reunião leva do rascunho só os servidores MCP desligados (contrato 21)', async () => {
    useChat.getState().setDraft('m1', { scope: { kind: '7d', mcpOff: ['cli:calc'] } })
    await useChat.getState().send(null, 'm1', 'Oi?')
    expect(invoke).toHaveBeenCalledWith('scribe:chat-send', { chatId: null, meetingId: 'm1', text: 'Oi?', scope: { kind: 'all', mcpOff: ['cli:calc'] } })
  })

  it('a conversa nova leva o escopo e o modelo do rascunho, que volta ao padrão depois', async () => {
    useChat.getState().setDraft(null, { scope: { kind: '7d' }, model: 'opus' })
    await useChat.getState().send(null, null, 'Oi?')
    expect(invoke).toHaveBeenCalledWith('scribe:chat-send', { chatId: null, meetingId: null, text: 'Oi?', scope: { kind: '7d' }, model: 'opus' })
    expect(useChat.getState().drafts['all']).toBeUndefined()
    // Na aba de uma reunião, o escopo não vai.
    useChat.getState().setDraft('m1', { scope: { kind: '7d' } })
    await useChat.getState().send(null, 'm1', 'Oi?')
    expect(invoke).toHaveBeenLastCalledWith('scribe:chat-send', { chatId: null, meetingId: 'm1', text: 'Oi?' })
  })

  it('Refazer troca a conversa pela que voltou (com menos mensagens) e marca a resposta em curso', async () => {
    const answered: Chat = { ...chat, messages: [...chat.messages, { role: 'assistant', text: 'Velha.', at: AT }] }
    useChat.setState({ chats: { c1: answered } })
    const redone: Chat = { ...chat, messages: [{ role: 'user', text: 'Oi?', at: '2026-11-15T20:05:00.000Z' }] }
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'scribe:chat-redo' ? { ok: true, chat: redone } : []))
    expect(await useChat.getState().redo('c1')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('scribe:chat-redo', { id: 'c1' })
    expect(useChat.getState().chats['c1']?.messages).toHaveLength(1)
    expect(useChat.getState().answers['c1']).toEqual(emptyAnswer())
    expect(useChat.getState().redoing).toEqual({})
    // Com a resposta em curso, não refaz.
    expect(await useChat.getState().redo('c1')).toBe(false)
  })

  it('renomear atualiza a conversa e a linha da lista', async () => {
    useChat.setState({ chats: { c1: chat }, lists: { all: [{ id: 'c1', meetingId: null, title: 'Oi?', createdAt: AT, updatedAt: AT }] } })
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'scribe:chat-update' ? { ...chat, title: 'Novo' } : []))
    expect(await useChat.getState().update('c1', { title: 'Novo' })).toBe(true)
    expect(useChat.getState().chats['c1']?.title).toBe('Novo')
    expect(useChat.getState().lists['all']?.[0]?.title).toBe('Novo')
  })
})
