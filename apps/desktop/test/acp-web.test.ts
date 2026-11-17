// Contrato 26: agentes, tarefas e Assistente podem pesquisar na internet. A política de permissão da busca e da página
// (CA3), o `session/new` com e sem internet, os passos e o agente ACP falso (sem rede) de ponta a ponta.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openAcpSession, permissionAllowed, type AcpLink, type AcpSessionRequest, type KnownToolCall, type LaunchAcp } from '../src/main/acp/agent'
import { AcpChat, acpStepOf } from '../src/main/acp/chat'
import { CLAUDE_DISALLOWED_TOOLS, claudeProfile } from '../src/main/acp/profiles/claude'
import { AcpWebState, fetchableUrl, privateHost, searchResultUrls, urlsIn, WEB_FETCH_MAX, WEB_QUERY_MAX, WEB_SEARCH_MAX, webDecision } from '../src/main/acp/web'
import { createChatCorpus } from '../src/main/chat/corpus'
import { createChatService } from '../src/main/chat/service'
import { createFileChatStore } from '../src/main/chat/store'
import { assistantSystemPrompt } from '../src/main/claude-cli/chat'
import { createFileMeetingsStore } from '../src/main/meetings/store'
import { createFileSummaryStore } from '../src/main/meetings/summaries'
import { createFileTranscriptStore } from '../src/main/meetings/transcripts'
import { agentSystemPrompt } from '../src/main/schedules/runner'
import { agentSchema } from '../src/shared/automations-schema'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'
import { chatSourcesOf, chatWebUsage, chatWebUsageLabel, WEB_BLOCKED_LABEL, type ChatDetail, type ChatStep } from '../src/shared/chat'
// @ts-expect-error o agente falso é um script .mjs sem tipos
import { fakeAcpAgent } from './fixtures/fake-acp-agent.mjs'

type LogEntry = Record<string, unknown> & { method?: string; event?: string }

const RESULT = 'https://www.financas.example/tendencias-2026?utm_source=busca'

let dir: string
let corpus: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acp-web-'))
  corpus = join(dir, 'chat-corpus')
  mkdirSync(corpus)
  writeFileSync(join(corpus, 'INDICE.md'), '# Índice\n\n- 15/11/2026 10:00 · Planejamento Q1 · Fechar o orçamento. · 2026-11-15 10h00 - Planejamento Q1 - m-plan.md · meeting:m-plan\n')
  writeFileSync(join(corpus, '2026-11-15 10h00 - Planejamento Q1 - m-plan.md'), '# Planejamento Q1\n\n- Id: m-plan\n')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A sessão com internet depois de uma busca que devolveu `RESULT`. */
function searched(): AcpWebState {
  const web = new AcpWebState()
  web.begin('')
  for (const url of searchResultUrls({ content: [{ type: 'content', content: { type: 'text', text: `Tendências 2026 (${RESULT})` } }] })) web.seen.add(url)
  return web
}

const search = (query: unknown): KnownToolCall => ({ name: 'WebSearch', kind: 'fetch', title: 'Search', locations: [], rawInput: { query } })
const fetchCall = (url: unknown): KnownToolCall => ({ name: 'WebFetch', kind: 'fetch', title: `Fetch ${String(url)}`, locations: [], rawInput: { url, prompt: 'Resuma.' } })
const allowed = (call: KnownToolCall, web: AcpWebState | null, purpose: 'chat' | 'translate' = 'chat') => permissionAllowed(purpose, call, corpus, corpus, claudeProfile.readTools, web)

describe('política da internet (CA3)', () => {
  it('WebSearch: consulta de 1 a 300 caracteres, até 10 por execução, e só na sessão com internet', async () => {
    const web = new AcpWebState()
    web.begin('')
    expect(await allowed(search('finanças em alta'), web)).toBe(true)
    expect(web.searches).toBe(1)
    expect(await allowed(search(''), web)).toBe(false)
    expect(await allowed(search('x'.repeat(WEB_QUERY_MAX + 1)), web)).toBe(false)
    expect(await allowed(search(42), web)).toBe(false)
    for (let n = 1; n < WEB_SEARCH_MAX; n++) expect(await allowed(search(`busca ${n}`), web)).toBe(true)
    expect(web.searches).toBe(WEB_SEARCH_MAX)
    expect(await allowed(search('a 11ª'), web)).toBe(false)
    // A próxima execução recomeça a conta.
    web.begin('')
    expect(await allowed(search('de novo'), web)).toBe(true)
    // Sem internet, ou fora do chat: negada.
    expect(await allowed(search('finanças'), null)).toBe(false)
    expect(await allowed(search('finanças'), web, 'translate')).toBe(false)
  })

  it('WebFetch: só o endereço de um resultado da busca desta sessão ou digitado pela pessoa', async () => {
    const web = searched()
    expect(await allowed(fetchCall(RESULT), web)).toBe(true)
    expect(web.pages).toBe(1)
    // O mesmo endereço com o `?utm=` igual e um `#` diferente: permitido. Sem a consulta também (não leva dado).
    expect(await allowed(fetchCall(`${RESULT}#secao`), web)).toBe(true)
    expect(await allowed(fetchCall('https://www.financas.example/tendencias-2026'), web)).toBe(true)
    // Trecho de reunião na consulta, endereço não visto na busca: negado.
    expect(await allowed(fetchCall('https://coletor.example/c?q=Planejamento%20Q1%20or%C3%A7amento'), web)).toBe(false)
    // O endereço do resultado com outra consulta (onde um dado vazaria): negado.
    expect(await allowed(fetchCall('https://www.financas.example/tendencias-2026?utm_source=Planejamento'), web)).toBe(false)
    expect(await allowed(fetchCall('https://www.financas.example/outra-pagina'), web)).toBe(false)
    expect(webDecision('WebFetch', fetchCall('https://coletor.example/c?q=x'), web)).toBe('blocked')
    // Digitado pela pessoa no pedido.
    web.begin('Resuma https://blog.example/post-1. Obrigado')
    expect(await allowed(fetchCall('https://blog.example/post-1'), web)).toBe(true)
    // Sem internet: negado.
    expect(await allowed(fetchCall(RESULT), null)).toBe(false)
  })

  it('WebFetch: nunca credencial, rede local, loopback, .local ou outro protocolo, mesmo visto na busca', async () => {
    const web = new AcpWebState()
    const bad = [
      'https://pessoa:senha@www.financas.example/a',
      'http://localhost:8080/a',
      'http://127.0.0.1/a',
      'http://0x7f.1/a',
      'http://10.2.1.20/a',
      'http://192.168.15.60/a',
      'http://172.16.0.1/a',
      'http://192.0.0.8/a',
      'http://198.18.0.1/a',
      'http://198.19.255.1/a',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/a',
      'http://[::ffff:127.0.0.1]/a',
      'http://[fd00::1]/a',
      'http://mac-mini.local/a',
      'http://intranet/a',
      'ftp://www.financas.example/a',
      'file:///etc/passwd',
    ]
    web.begin(bad.join(' '))
    for (const url of bad) {
      web.seen.add(url)
      expect(await allowed(fetchCall(url), web), url).toBe(false)
    }
    expect(web.seen.size).toBe(0)
    expect(privateHost('www.financas.example')).toBe(false)
    expect(fetchableUrl('http://www.financas.example/a')?.hostname).toBe('www.financas.example')
  })

  it('WebFetch: até 15 páginas por execução', async () => {
    const web = searched()
    for (let n = 0; n < WEB_FETCH_MAX; n++) expect(await allowed(fetchCall(RESULT), web)).toBe(true)
    expect(await allowed(fetchCall(RESULT), web)).toBe(false)
    expect(webDecision('WebFetch', fetchCall(RESULT), web)).toBe('limit')
  })

  it('os endereços vêm só dos hits: os estruturados, ou as linhas exatas "Título (url)"; nunca do texto livre', () => {
    const structured = {
      content: [{ type: 'content', content: { type: 'text', text: 'Resumo livre: veja https://livre.example/a' } }],
      _meta: { claudeCode: { toolName: 'WebSearch', toolResponse: { query: 'x', results: ['Resumo: https://resumo.example/b', { tool_use_id: 't', content: [{ title: 'T', url: 'https://json.example/x' }, { url: 'https://sem-titulo.example/y' }] }] } } },
      rawInput: { query: 'https://modelo.example/montado' },
      rawOutput: 'https://bruto.example/z',
    }
    expect(searchResultUrls(structured as never)).toEqual(['https://json.example/x'])
    // Sem o estruturado: só as linhas no formato do adaptador (com parênteses no endereço inclusive).
    const lines = { content: [{ type: 'content', content: { type: 'text', text: 'Foo (bar) (https://pt.wikipedia.example/wiki/Foo_(bar))\nOutro (https://noticias.example/a?b=1&c=2)\nNão achei nada sobre https://livre.example/c.' } }] }
    expect(searchResultUrls(lines)).toEqual(['https://pt.wikipedia.example/wiki/Foo_(bar)', 'https://noticias.example/a?b=1&c=2'])
    expect(urlsIn('veja (https://a.example/b), e https://c.example/d.')).toEqual(['https://a.example/b', 'https://c.example/d'])
  })

  it('um endereço que o modelo pôs numa consulta nunca vira visto, nem repetido em parte ou reformatado', async () => {
    const hits = (urls: string[]) => ({ _meta: { claudeCode: { toolResponse: { results: [{ content: urls.map((url) => ({ title: 'T', url })) }] } } } })
    const leak = 'https://evil.example/c?d=SEGREDO'
    const fake = (line: string) => ({ content: [{ type: 'content', content: { type: 'text', text: line } }] })
    // Eco literal num hit, numa linha "Título (url)" do resumo, reformatado (maiúsculas, sem esquema, codificado) e parcial.
    expect(searchResultUrls(hits([leak, 'https://ok.example/a']), [`tendencias ${leak}`])).toEqual(['https://ok.example/a'])
    expect(searchResultUrls(fake(`Não encontrei nada sobre (${leak})`), [`tendencias ${leak}`])).toEqual([])
    expect(searchResultUrls(hits([leak]), ['tendencias EVIL.EXAMPLE/c?d=segredo'])).toEqual([])
    expect(searchResultUrls(hits(['https://evil.example/c?d=SEGREDO%20Q1']), ['evil.example/c?d=SEGREDO Q1'])).toEqual([])
    expect(searchResultUrls(hits(['https://www.evil.example/c?d=SEGREDO']), ['site evil.example com SEGREDO'])).toEqual([])
    // Só o domínio na consulta ("site:"), sem pedaço do endereço: o resultado vale.
    expect(searchResultUrls(hits(['https://instagram.example/financas/reels']), ['site:instagram.example dicas'])).toEqual(['https://instagram.example/financas/reels'])
    // E na hora de abrir: visto antes, mas uma consulta posterior da sessão o repete -> bloqueado.
    const web = new AcpWebState()
    web.begin('')
    web.seen.add(leak)
    expect(webDecision('WebFetch', fetchCall(leak), web)).toBe('allow')
    web.addQuery(`busca ${leak}`)
    expect(webDecision('WebFetch', fetchCall(leak), web)).toBe('blocked')
    // Digitado pela pessoa continua valendo.
    web.begin(`abra ${leak}`)
    expect(await allowed(fetchCall(leak), web)).toBe(true)
  })

  it('os vistos valem só na execução: o próximo prompt zera', () => {
    const web = searched()
    expect(webDecision('WebFetch', fetchCall(RESULT), web)).toBe('allow')
    web.begin('')
    expect(web.seen.size).toBe(0)
    expect(webDecision('WebFetch', fetchCall(RESULT), web)).toBe('blocked')
  })
})

describe('sessão com e sem internet', () => {
  const request = (patch: Partial<AcpSessionRequest> = {}): AcpSessionRequest => ({ purpose: 'chat', cwd: corpus, model: 'sonnet', systemPrompt: 'x', tools: 'read', ...patch })
  const options = (patch: Partial<AcpSessionRequest> = {}) => (claudeProfile.newSession(request(patch))._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options

  it('com internet, a busca e a página saem das negadas só nessa sessão, e toda chamada pede permissão', () => {
    const on = options({ web: true })
    expect(on['tools']).toEqual(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])
    expect(on['disallowedTools']).toEqual(['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task'])
    expect(on['settings']).toEqual({ permissions: { ask: ['WebSearch', 'WebFetch'] } })
    // Sem internet: igual ao contrato 17.
    const off = options()
    expect(off['tools']).toEqual(['Read', 'Grep', 'Glob'])
    expect(off['disallowedTools']).toEqual([...CLAUDE_DISALLOWED_TOOLS])
    expect(off['settings']).toBeUndefined()
    // Tradução e resumo nunca recebem, nem pedindo.
    for (const purpose of ['translate', 'summary', 'analysis'] as const) {
      const none = options({ purpose, tools: 'none', web: true })
      expect(none['tools']).toEqual([])
      expect(none['disallowedTools']).toEqual([...CLAUDE_DISALLOWED_TOOLS])
    }
  })

  it('passos: "Pesquisando: <consulta>", "Abrindo <domínio>" e a página recusada', () => {
    const at = (call: KnownToolCall, blocked = false) => acpStepOf(claudeProfile, 'id', call, undefined, blocked)
    expect(at({ ...search('finanças em alta'), status: 'completed' })).toEqual({ tool: 'WebSearch', label: 'Pesquisando: finanças em alta', meetingId: null, id: 'id', status: 'completed' })
    expect(at(fetchCall(RESULT))?.label).toBe('Abrindo financas.example')
    expect(at({ ...fetchCall('https://coletor.example/c?q=x'), status: 'failed' }, true)?.label).toBe(WEB_BLOCKED_LABEL)
    // Sem o nome: pelo tipo `fetch` e o título do adaptador.
    expect(at({ kind: 'fetch', title: 'Search "x"', locations: [], rawInput: { query: 'x' } })?.tool).toBe('WebSearch')
  })

  it('rodapé "Usou a internet": buscas e páginas que não foram negadas', () => {
    const steps: Pick<ChatStep, 'tool' | 'status'>[] = [
      { tool: 'Read', status: 'completed' },
      { tool: 'WebSearch', status: 'completed' },
      { tool: 'WebFetch', status: 'completed' },
      { tool: 'WebFetch', status: 'failed' },
    ]
    expect(chatWebUsage(steps)).toEqual({ used: true, searches: 1, pages: 1 })
    expect(chatWebUsageLabel({ searches: 2, pages: 1 })).toBe('Usou a internet · 2 buscas · 1 página')
    expect(chatWebUsage([{ tool: 'Read', status: 'completed' }]).used).toBe(false)
  })
})

describe('agente e Assistente (CA1, CA2, CA4, CA5)', () => {
  it('agente salvo antes do contrato 26 lê como sem internet; a fonte Internet vem ligada', () => {
    const old = { id: 'a1', name: 'A', description: '', icon: 'bot', color: 'blue', instructions: '', profile: 'claude', model: 'sonnet', thinkMore: false, scope: { kind: 'all' }, mcpServers: [], output: { kind: 'chat' }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }
    expect(agentSchema.parse(old).web).toBe(false)
    expect(agentSchema.parse({ ...old, web: true }).web).toBe(true)
    expect(chatSourcesOf({}).internet).toBe(true)
    expect(chatSourcesOf({ sources: { internet: false } }).internet).toBe(false)
  })

  it('instrução: com internet, as regras e a citação; sem, onde ligar', () => {
    const on = agentSystemPrompt('all', 'Faça.', true)
    expect(on).toContain('[Web · <domínio> · <título curto>](<endereço>)')
    expect(on).toContain('em alta')
    expect(on).not.toContain('não acessa a internet')
    const off = agentSystemPrompt('all', 'Faça.')
    expect(off).toContain('não acessa a internet')
    expect(off).toContain(`"Para isso, ligue 'Pode pesquisar na internet' neste agente."`)
    expect(off).not.toContain('[Web ·')
    expect(assistantSystemPrompt('all', true)).toContain('[Web · <domínio> · <título curto>](<endereço>)')
    expect(assistantSystemPrompt('all')).toContain('"Para isso, ligue a fonte Internet no Contexto."')
  })
})

describe('de ponta a ponta com o agente ACP falso (sem rede)', () => {
  function launcher(log: LogEntry[]): LaunchAcp {
    return () => {
      const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const connection = (fakeAcpAgent({ log: (entry: LogEntry) => log.push(entry), pause: 0 }) as acp.AgentApp).connect({ writable: toClient.writable, readable: toAgent.readable })
      const listeners: (() => void)[] = []
      let exited = false
      const exit = (): void => {
        if (exited) return
        exited = true
        connection.close()
        for (const listener of listeners.splice(0)) listener()
      }
      const link: AcpLink = { stream: { writable: toAgent.writable, readable: toClient.readable }, kill: exit, onExit: (listener) => (exited ? listener() : void listeners.push(listener)) }
      return link
    }
  }
  const run = async (web: boolean, systemPrompt: string) => {
    const log: LogEntry[] = []
    const launch = launcher(log)
    const chat = new AcpChat({ open: (request) => openAcpSession(request, { profile: claudeProfile, launch, env: {} }), model: 'sonnet', thinkMore: false, scope: 'all', cwd: corpus, systemPrompt, ...(web ? { web: true } : {}) })
    const details: ChatDetail[] = []
    const answer = await chat.ask('Pesquise o que está em alta sobre finanças', [], () => undefined, (detail) => details.push(detail))
    chat.kill()
    const steps = [...new Map(details.flatMap((detail) => (detail.type === 'step' ? [[detail.step.id, detail.step] as const] : []))).values()]
    return { answer, steps, log }
  }

  it('com internet: busca, abre o resultado, nega o endereço montado e responde com o link', async () => {
    const { answer, steps, log } = await run(true, agentSystemPrompt('all', 'Faça.', true))
    expect(answer.ok).toBe(true)
    expect(answer.text).toContain(`[Web · financas.example · Tendências 2026](${RESULT})`)
    expect(steps.map((step) => [step.tool, step.label, step.status])).toEqual([
      ['WebSearch', 'Pesquisando: finanças em alta no Instagram', 'completed'],
      ['WebFetch', 'Abrindo financas.example', 'completed'],
      ['WebFetch', WEB_BLOCKED_LABEL, 'failed'],
    ])
    expect(log.find((entry) => entry.event === 'web')).toMatchObject({ searched: true, opened: true, leaked: false })
    expect(chatWebUsage(steps)).toEqual({ used: true, searches: 1, pages: 1 })
  })

  it('os vistos da busca não passam para a pergunta seguinte da mesma sessão', async () => {
    const log: LogEntry[] = []
    const launch = launcher(log)
    const chat = new AcpChat({ open: (request) => openAcpSession(request, { profile: claudeProfile, launch, env: {} }), model: 'sonnet', thinkMore: false, scope: 'all', cwd: corpus, systemPrompt: 'x', web: true })
    expect((await chat.ask('Pesquise o que está em alta', [], () => undefined)).ok).toBe(true)
    const again = await chat.ask('Agora abra o primeiro resultado', [], () => undefined)
    chat.kill()
    expect(again.text).toBe('A página foi recusada.')
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
    expect(log.find((entry) => entry.event === 'web-reopen')).toMatchObject({ opened: false })
  })

  it('página terminada sem pedir permissão cancela a resposta; busca acima do limite sem pedir também', async () => {
    for (const question of ['Abra sem perguntar', 'Faça busca demais']) {
      const log: LogEntry[] = []
      const launch = launcher(log)
      const chat = new AcpChat({ open: (request) => openAcpSession(request, { profile: claudeProfile, launch, env: {} }), model: 'sonnet', thinkMore: false, scope: 'all', cwd: corpus, systemPrompt: 'x', web: true })
      const details: ChatDetail[] = []
      const answer = await chat.ask(question, [], () => undefined, (detail) => details.push(detail))
      chat.kill()
      expect(answer, question).toMatchObject({ ok: false, error: 'stopped' })
      expect(log.some((entry) => entry.method === 'session/cancel'), question).toBe(true)
      expect(log.find((entry) => entry.event === 'unasked'), question).toMatchObject({ cancelled: true })
      expect(details.some((detail) => detail.type === 'denied'), question).toBe(true)
    }
  })

  it('sem internet: a busca é negada e a resposta diz onde ligar', async () => {
    const { answer, steps, log } = await run(false, agentSystemPrompt('all', 'Faça.'))
    expect(answer.ok).toBe(true)
    expect(answer.text).toBe("Para isso, ligue 'Pode pesquisar na internet' neste agente.")
    expect(steps.map((step) => [step.tool, step.status])).toEqual([['WebSearch', 'failed']])
    expect(log.filter((entry) => entry.event === 'permission').map((entry) => [entry.tool, entry.outcome])).toEqual([['WebSearch', 'reject']])
    expect(log.find((entry) => entry.method === 'session/new')).toMatchObject({ options: { tools: ['Read', 'Grep', 'Glob'] } })
    expect(chatWebUsage(steps).used).toBe(false)
  })
})

describe('Assistente com a fonte Internet (CA2)', () => {
  it('ligada por padrão pelo ACP: a sessão abre com a busca e a página e a resposta grava os passos; desligada, não', async () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    const meetings = createFileMeetingsStore({ dir: data, newId: () => 'm-hoje' })
    const corpusStore = createChatCorpus({ dir: data, meetings, transcripts: createFileTranscriptStore({ dir: data }), summaries: createFileSummaryStore({ dir: data }) })
    const store = createFileChatStore({ dir: data })
    const log: LogEntry[] = []
    const launch: LaunchAcp = () => {
      const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
      const connection = (fakeAcpAgent({ log: (entry: LogEntry) => log.push(entry), pause: 0 }) as acp.AgentApp).connect({ writable: toClient.writable, readable: toAgent.readable })
      const listeners: (() => void)[] = []
      let exited = false
      const exit = (): void => {
        if (exited) return
        exited = true
        connection.close()
        for (const listener of listeners.splice(0)) listener()
      }
      return { stream: { writable: toAgent.writable, readable: toClient.readable }, kill: exit, onExit: (listener) => (exited ? listener() : void listeners.push(listener)) }
    }
    let n = 0
    const service = createChatService({
      store,
      corpus: corpusStore,
      assistant: { prepare: () => Promise.resolve(), extract: (text) => Promise.resolve({ text, actions: [] }) },
      settings: { get: () => Promise.resolve({ ...DEFAULT_SETTINGS, claudeTransport: 'acp' }) },
      meetings,
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.1.325' }),
      spawn: () => {
        throw new Error('sem linha de comando no teste')
      },
      openAcp: () => (request) => openAcpSession(request, { profile: claudeProfile, launch, env: {} }),
      baseEnv: {},
      onEvent: () => undefined,
      newId: () => `c${++n}`,
    })
    await meetings.create({ title: 'Hoje', startedAt: new Date().toISOString(), durationMs: 1000, sources: { mic: true, system: false } })

    const sent = await service.send({ chatId: null, meetingId: null, text: 'Pesquise o que está em alta sobre finanças' })
    expect(sent.ok).toBe(true)
    await service.settled('c1')
    const answer = (await store.get('c1'))?.messages.at(-1)
    expect(answer?.text).toContain('[Web · financas.example · Tendências 2026]')
    expect(chatWebUsage(answer?.steps)).toEqual({ used: true, searches: 1, pages: 1 })
    expect(answer?.steps?.some((step) => step.label === WEB_BLOCKED_LABEL)).toBe(true)
    const opened = log.filter((entry) => entry.method === 'session/new') as { options: { tools: string[]; systemPrompt: string } }[]
    expect(opened[0]?.options.tools).toEqual(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])

    // A fonte desligada no Contexto: sessão nova, sem a busca, e a resposta diz onde ligar.
    await service.update({ id: 'c1', scope: { kind: 'all', sources: { internet: false } } })
    await service.send({ chatId: 'c1', meetingId: null, text: 'Pesquise de novo' })
    await service.settled('c1')
    const again = (await store.get('c1'))?.messages.at(-1)
    expect(again?.text).toBe('Para isso, ligue a fonte Internet no Contexto.')
    const reopened = log.filter((entry) => entry.method === 'session/new') as { options: { tools: string[] } }[]
    expect(reopened).toHaveLength(2)
    expect(reopened[1]?.options.tools).toEqual(['Read', 'Grep', 'Glob'])
    service.dispose()
  })
})
