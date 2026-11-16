// Contrato 15, CA4: o Markdown das respostas vira árvore de dados (nenhum HTML do texto chega ao DOM), os
// links `meeting:` e `https://` são reconhecidos, e o store do chat acompanha a resposta em pedaços. Canal
// falso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, ChatEvent } from '@shared/chat'
import { useChat } from '../../src/renderer/src/features/chat/chatStore'
import { chatSuggestions } from '../../src/renderer/src/features/chat/ChatScreen'
import { isExternalLink, parseInline, parseMarkdown } from '../../src/renderer/src/features/chat/markdown'

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

  it('sugestões: a última leva o participante quando há', () => {
    expect(chatSuggestions('Ana')).toEqual(['O que ficou decidido esta semana?', 'Quais tarefas são minhas?', 'Resuma a última reunião com Ana'])
    expect(chatSuggestions(null).at(-1)).toBe('Resuma a última reunião')
  })
})

describe('store do chat (CA3)', () => {
  const invoke = vi.fn()
  let emit: ((event: ChatEvent) => void) | null = null
  const AT = '2026-11-15T20:00:00.000Z'
  const chat: Chat = { id: 'c1', meetingId: null, title: 'Oi?', createdAt: AT, messages: [{ role: 'user', text: 'Oi?', at: AT }] }

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
    useChat.setState({ claude: 'checking', lists: {}, chats: {}, answers: {}, sending: {}, selected: {}, failures: {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('enviar seleciona a conversa nova e marca a resposta em curso; pedaços e fim chegam pelo evento', async () => {
    expect(await useChat.getState().send(null, null, 'Oi?')).toBe('c1')
    expect(useChat.getState().selected['all']).toBe('c1')
    expect(useChat.getState().answers['c1']).toEqual({ text: '', reading: false })
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
})
