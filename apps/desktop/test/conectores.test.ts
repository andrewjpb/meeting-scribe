// Conectores do claude.ai no agente (contrato 57): as linhas `claude.ai <Nome>` do `claude mcp list` (CA1), o motivo da
// lista vazia (CA8), as opções do `session/new` sem conector (CA3, iguais às de antes byte a byte) e com conector (CA4),
// a aprovação de cada ferramenta (CA5) e os tipos de sessão que recebem conector (CA6). Nenhum `claude` de verdade e
// nenhuma rede.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acpOpener, openAcpSession, type AcpConnector, type AcpConnectorSet, type AcpLink, type AcpMcpServer, type AcpOpenResult, type AcpSessionRequest, type LaunchAcp } from '../src/main/acp/agent'
import { AcpChat } from '../src/main/acp/chat'
import { blockedServersOf, connectorVerdict, parseMcpStatus } from '../src/main/acp/connectors'
import { CLAUDE_DISALLOWED_TOOLS, claudeProfile } from '../src/main/acp/profiles/claude'
import type { ExecFile } from '../src/main/claude-cli/locate'
import { connectorsOf, createMcpCli, parseMcpList, subscriptionOf } from '../src/main/mcp/cli'
import { createMcpService, LIST_RETRY_MS, LIST_STALE_MS } from '../src/main/mcp/service'
import { createMcpStore } from '../src/main/mcp/store'
import { createAgentRunner } from '../src/main/schedules/runner'
import { memorySafeStorage } from '../src/main/secrets'
import type { ChatDetail } from '../src/shared/chat'
import { CLAUDE_CONNECTORS_UNKNOWN_NOTICE, claudeConnectorToolServer, type ClaudeConnectorPrefs } from '../src/shared/mcp'
// @ts-expect-error o agente falso é um script .mjs sem tipos
import { fakeAcpAgent } from './fixtures/fake-acp-agent.mjs'

const SNAPSHOT = join(__dirname, 'fixtures', 'acp', 'session-new-sem-conector.json')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conectores-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Saída do `claude mcp list` do Claude Code 2.1.325, com os endereços trocados. */
const LIST = [
  'Checking MCP server health…',
  '',
  'claude.ai Claude Docs: https://docs.example/mcp - ✔ Connected',
  'claude.ai Mez: https://mez.example/mcp - ! Needs authentication',
  'claude.ai COLAB: https://colab.example/mcp - ✘ Failed to connect — HTTP 404: Error POSTing to endpoint: {"type":"error"}',
  'claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected',
  'claude.ai Notion (2): https://mcp.notion.com/mcp - ✔ Connected',
  'claude.ai Ação Café: https://cafe.example/mcp - ✔ Connected',
  'claude.ai Figma: https://figma.example/mcp - ✔ Connected',
  'plugin:pdf-viewer:pdf: npx -y @modelcontextprotocol/server-pdf --stdio - ✔ Connected',
  'plugin:design:slack: https://slack.example/mcp (HTTP) - ! Needs authentication',
  'plugin:design:gmail:  (HTTP) - - Not configured',
  'timesheet: https://timesheet.example/mcp (HTTP) - ✔ Connected',
  'thunderbird: /usr/local/bin/atbridge mcp - ✔ Connected',
].join('\n')

describe('lista (CA1, CA9)', () => {
  it('as linhas claude.ai viram conectores: estado, nome com espaço e acento, colisão (2)', () => {
    expect(connectorsOf(parseMcpList(LIST))).toEqual([
      { name: 'Claude Docs', toolServer: 'claude_ai_Claude_Docs', state: 'connected' },
      { name: 'Mez', toolServer: 'claude_ai_Mez', state: 'needs-auth' },
      { name: 'COLAB', toolServer: 'claude_ai_COLAB', state: 'failed' },
      { name: 'Notion', toolServer: 'claude_ai_Notion', state: 'connected' },
      { name: 'Notion (2)', toolServer: 'claude_ai_Notion_2', state: 'connected' },
      { name: 'Ação Café', toolServer: 'claude_ai_A_o_Caf', state: 'connected' },
      { name: 'Figma', toolServer: 'claude_ai_Figma', state: 'connected' },
    ])
  })

  it('o servidor do conector como o Claude Code o põe no nome das ferramentas', () => {
    expect(claudeConnectorToolServer('Google Drive')).toBe('claude_ai_Google_Drive')
    expect(claudeConnectorToolServer('Microsoft 365')).toBe('claude_ai_Microsoft_365')
    expect(claudeConnectorToolServer('Cloudflare Developer Platform')).toBe('claude_ai_Cloudflare_Developer_Platform')
    expect(claudeConnectorToolServer('Notion (2)')).toBe('claude_ai_Notion_2')
  })

  it('nome que não volta do nome das ferramentas, ou repetido no servidor, fica de fora', () => {
    const entries = parseMcpList(['claude.ai ãç: https://x.example - ✔ Connected', 'claude.ai Notion 2: https://a - ✔ Connected', 'claude.ai Notion (2): https://b - ✔ Connected'].join('\n'))
    expect(connectorsOf(entries)).toEqual([{ name: 'Notion 2', toolServer: 'claude_ai_Notion_2', state: 'connected' }])
  })

  it('login por assinatura pelo `claude auth status --json`', () => {
    expect(subscriptionOf(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'x' }))).toBe(true)
    expect(subscriptionOf(JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }))).toBe(false)
    expect(subscriptionOf(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }))).toBe(false)
    expect(subscriptionOf(JSON.stringify({ loggedIn: false }))).toBe(false)
    expect(subscriptionOf('não é json')).toBeNull()
    expect(subscriptionOf('{}')).toBeNull()
  })
})

/** Um `claude` na memória: `mcp list` com a lista dada e `auth status` com o login dado; guarda cada chamada. */
function fakeClaude(list: string, subscription: boolean): { exec: ExecFile; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFile = (_file, args) => {
    calls.push([...args])
    if (args[0] === 'mcp' && args[1] === 'list') return Promise.resolve({ stdout: list })
    if (args[0] === 'auth') return Promise.resolve({ stdout: JSON.stringify({ loggedIn: true, authMethod: subscription ? 'claude.ai' : 'api_key', apiProvider: 'firstParty' }) })
    return Promise.reject(new Error('não existe'))
  }
  return { exec, calls }
}

function service(list = LIST, subscription = true, prefs: Record<string, ClaudeConnectorPrefs> = {}) {
  const cliFile = join(dir, 'claude.json')
  // O escopo `user`: um que a lista mostra e um que entrou no arquivo depois da lista.
  writeFileSync(cliFile, JSON.stringify({ mcpServers: { timesheet: { type: 'http', url: 'https://timesheet.example/mcp' }, 'novo servidor': { command: '/bin/echo' } } }))
  const claude = fakeClaude(list, subscription)
  const allowed: [string, string][] = []
  const mcp = createMcpService({
    store: createMcpStore({ dir, safeStorage: memorySafeStorage() }),
    cli: createMcpCli({ exec: claude.exec, baseEnv: {}, configFile: cliFile, cwd: join(dir, 'cwd') }),
    locate: async () => ({ ok: true, path: '/bin/claude', version: '2.1.325' }),
    desktopConfig: join(dir, 'nao-existe.json'),
    baseEnv: {},
    loginPath: async () => '/usr/bin',
    connectorPrefs: async () => prefs,
    allowConnectorTool: async (name, tool) => void allowed.push([name, tool]),
  })
  return { mcp, calls: claude.calls, allowed }
}

describe('serviço (CA1, CA8)', () => {
  it('os conectores saem da lista do CLI e vão para a lista própria; só `mcp list` roda', async () => {
    const { mcp, calls } = service()
    const overview = await mcp.overview({ cli: true })
    expect(overview.cli.servers.map((server) => server.name)).toEqual(['plugin:pdf-viewer:pdf', 'plugin:design:slack', 'timesheet', 'thunderbird'])
    expect(overview.connectors.reason).toBeNull()
    expect(overview.connectors.connectors.map((connector) => connector.name)).toEqual(['Claude Docs', 'Mez', 'COLAB', 'Notion', 'Notion (2)', 'Ação Café', 'Figma'])
    expect(calls).toEqual([['mcp', 'list']])
  })

  it('sem linhas claude.ai: vazia com o motivo; sem assinatura, "no-subscription"; com, "none"', async () => {
    const withoutConnectors = LIST.split('\n')
      .filter((line) => !line.startsWith('claude.ai'))
      .join('\n')
    const subscribed = service(withoutConnectors, true)
    expect((await subscribed.mcp.overview({ cli: true })).connectors).toEqual({ connectors: [], reason: 'none' })
    const apiKey = service(withoutConnectors, false, { Notion: { enabled: true, tools: {} } })
    expect((await apiKey.mcp.overview({ cli: true })).connectors).toEqual({ connectors: [], reason: 'no-subscription' })
    expect(apiKey.calls).toEqual([
      ['mcp', 'list'],
      ['auth', 'status', '--json'],
    ])
    // Ligado nas Configurações, mas a conta não tem: nada muda na sessão.
    expect(await apiKey.mcp.sessionConnectors()).toBeNull()
  })

  it('a lista ainda não lida: vazia, sem motivo', async () => {
    const { mcp } = service()
    expect((await mcp.overview({})).connectors).toEqual({ connectors: [], reason: null })
  })
})

describe('serviço: a sessão (CA2, CA4)', () => {
  it('nenhum ligado: nem a lista é lida', async () => {
    const { mcp, calls } = service(LIST, true, { Notion: { enabled: false, tools: {} } })
    expect(await mcp.sessionConnectors()).toBeNull()
    expect(calls).toEqual([])
  })

  it('o ligado e conectado vai; o resto (conectores, escopo user, plugins) vai para bloquear', async () => {
    const { mcp, allowed } = service(LIST, true, {
      Notion: { enabled: true, tools: { 'notion-create-pages': 'deny' } },
      // Precisa autorizar: não vai (o `claude` não teria as ferramentas).
      Mez: { enabled: true, tools: {} },
      Figma: { enabled: false, tools: {} },
    })
    const set = await mcp.sessionConnectors()
    expect(set?.enabled.map((connector) => [connector.name, connector.label, connector.toolServer, connector.toolPolicy])).toEqual([['Notion', 'claude.ai Notion', 'claude_ai_Notion', { 'notion-create-pages': 'deny' }]])
    expect([...(set?.others ?? [])].sort()).toEqual(
      [
        'claude_ai_Claude_Docs',
        'claude_ai_Mez',
        'claude_ai_COLAB',
        'claude_ai_Notion_2',
        'claude_ai_A_o_Caf',
        'claude_ai_Figma',
        'plugin_pdf-viewer_pdf',
        'plugin_design_slack',
        'timesheet',
        'thunderbird',
        // Do arquivo do CLI, lido agora (entrou depois da lista).
        'novo_servidor',
      ].sort(),
    )
    set?.enabled[0]?.allowAlways('notion-search')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(allowed).toEqual([['Notion', 'notion-search']])
  })

  it('conector ligado que saiu da conta: nada muda na sessão', async () => {
    const { mcp } = service(LIST, true, { Gmail: { enabled: true, tools: {} } })
    expect(await mcp.sessionConnectors()).toBeNull()
  })
})

const calc: AcpMcpServer = {
  key: 'cli:calculadora',
  name: 'calculadora',
  transport: 'stdio',
  definition: { name: 'calculadora', command: '/bin/calc', args: [], env: [{ name: 'CALC_TOKEN', value: 'x' }] },
  toolPolicy: { apagar_tudo: 'deny', soma: 'allow' },
  secrets: ['x'],
  allowAlways: () => undefined,
}
const CHAT: AcpSessionRequest = { purpose: 'chat', cwd: '/c', model: 'sonnet', systemPrompt: 'Instrução', tools: 'read' }
const LOCAL = { navegador: { url: 'http://127.0.0.1:4545/mcp', token: 't0k3n' } }

/** Os pedidos do snapshot (gerado com o código de antes do contrato 57). */
const SNAPSHOT_CASES: [string, AcpSessionRequest, typeof LOCAL | undefined][] = [
  ['chat', CHAT, undefined],
  ['chat-pensar-mais', { ...CHAT, thinkMore: true }, undefined],
  ['chat-internet', { ...CHAT, web: true }, undefined],
  ['chat-mcp', { ...CHAT, mcp: { off: [] }, mcpServers: [calc] }, undefined],
  ['chat-navegador', { ...CHAT, navegador: true }, LOCAL],
  ['chat-tudo', { ...CHAT, web: true, navegador: true, mcp: { off: [] }, mcpServers: [calc] }, LOCAL],
  ['analise-mcp', { purpose: 'analysis', cwd: '/c', model: 'sonnet', systemPrompt: 'p', tools: 'none', mcp: {}, mcpServers: [calc] }, undefined],
  ['traducao', { purpose: 'translate', cwd: '/c', model: 'haiku', systemPrompt: 'p', tools: 'none' }, undefined],
  ['resumo', { purpose: 'summary', cwd: '/c', model: 'haiku', systemPrompt: 'p', tools: 'none' }, undefined],
]

const connector = (policy: Record<string, 'ask' | 'allow' | 'deny'> = {}, always: string[] = []): AcpConnector => ({
  name: 'Notion',
  label: 'claude.ai Notion',
  toolServer: 'claude_ai_Notion',
  toolPolicy: policy,
  allowAlways: (tool) => void always.push(tool),
})
const SET = (policy: Record<string, 'ask' | 'allow' | 'deny'> = {}, always: string[] = []): AcpConnectorSet => ({
  enabled: [connector(policy, always)],
  others: ['claude_ai_Figma', 'timesheet', 'plugin_design_slack', 'calculadora', 'navegador', 'claude_ai_Notion', 'a__b', 'timesheet'],
})

const optionsOf = (params: acp.NewSessionRequest): Record<string, unknown> => (params._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options

describe('session/new (CA3, CA4, CA6)', () => {
  it('sem conector ligado: idêntico ao snapshot das opções de antes, byte a byte', () => {
    const snapshot = readFileSync(SNAPSHOT, 'utf8')
    const build = (extra: Partial<AcpSessionRequest>): string => `${JSON.stringify(Object.fromEntries(SNAPSHOT_CASES.map(([name, request, local]) => [name, claudeProfile.newSession({ ...request, ...extra }, local)])), null, 2)}\n`
    expect(build({})).toBe(snapshot)
    // Conjunto sem nenhum ligado também não muda nada.
    expect(build({ connectors: { enabled: [], others: ['timesheet'] } })).toBe(snapshot)
  })

  it('tradução, resumo e análise com conectores pedidos: iguais ao snapshot (sem conector, com o modo estrito)', () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, unknown>
    for (const [name, request, local] of SNAPSHOT_CASES.filter(([, request]) => request.purpose !== 'chat')) {
      const params = claudeProfile.newSession({ ...request, connectors: SET() }, local)
      expect(JSON.stringify(params)).toBe(JSON.stringify(snapshot[name]))
      expect(optionsOf(params)['strictMcpConfig']).toBe(true)
    }
  })

  it('com conector ligado: sem o modo estrito; o resto bloqueado pelo servidor; o ligado pergunta; "Negar" uma a uma', () => {
    const params = claudeProfile.newSession({ ...CHAT, mcp: { off: [] }, mcpServers: [calc], connectors: SET({ 'notion-create-pages': 'deny', 'notion.fetch': 'deny', 'notion-search': 'allow' }) })
    const options = optionsOf(params)
    expect('strictMcpConfig' in options).toBe(false)
    expect(options['settingSources']).toEqual([])
    expect(options['extraArgs']).toEqual({ restricted: null })
    expect(options['tools']).toEqual(['Read', 'Grep', 'Glob'])
    // Os servidores que a sessão passa continuam só os do app (o conector o `claude` sobe sozinho).
    expect(params.mcpServers).toEqual([calc.definition])
    expect(options['disallowedTools']).toEqual([
      ...CLAUDE_DISALLOWED_TOOLS,
      'mcp__calculadora__apagar_tudo',
      'mcp__claude_ai_Notion__notion-create-pages',
      'mcp__claude_ai_Notion__notion_fetch',
      'mcp__claude_ai_Figma',
      'mcp__timesheet',
      'mcp__plugin_design_slack',
      // Sem o navegador do app nesta sessão, um servidor da pessoa com esse nome fica bloqueado.
      'mcp__navegador',
    ])
    expect(options['settings']).toEqual({ permissions: { ask: ['mcp__calculadora', 'mcp__claude_ai_Notion'] } })
  })

  it('com o navegador do app na sessão, o nome dele não é bloqueado (é o do app)', () => {
    const options = optionsOf(claudeProfile.newSession({ ...CHAT, navegador: true, connectors: SET() }, LOCAL))
    expect(options['disallowedTools']).not.toContain('mcp__navegador')
    expect(options['disallowedTools']).toContain('mcp__calculadora')
    expect(options['settings']).toEqual({ permissions: { ask: ['mcp__claude_ai_Notion'], allow: expect.any(Array) as unknown } })
  })
})

/** O que o `/mcp` do agente falso mostra além dos servidores do app, por sessão. */
type FakeStatus = (session: { index: number; strict: boolean; disallowedTools: string[]; elapsedMs: number }) => { name: string; status: string; tools?: number }[]

/** Como no `claude` real: sem o modo estrito sobem os conectores da conta, inclusive o desligado (que conecta). */
const ACCOUNT: FakeStatus = (session) =>
  session.strict
    ? []
    : [
        { name: 'claude.ai Notion', status: 'connected', tools: 77 },
        { name: 'claude.ai Figma', status: 'connected', tools: 45 },
      ]

/** Liga o agente falso na memória (um "processo" por sessão). */
function memory(log: Record<string, unknown>[], mcpStatus: FakeStatus = ACCOUNT): LaunchAcp {
  return () => {
    const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const connection = (fakeAcpAgent({ log: (entry: Record<string, unknown>) => log.push(entry), pause: 0, mcpStatus }) as acp.AgentApp).connect({ writable: toClient.writable, readable: toAgent.readable })
    const listeners: (() => void)[] = []
    let exited = false
    const link: AcpLink = {
      stream: { writable: toAgent.writable, readable: toClient.readable },
      kill: () => {
        if (exited) return
        exited = true
        connection.close()
        for (const listener of listeners.splice(0)) listener()
      },
      onExit: (listener) => (exited ? listener() : void listeners.push(listener)),
    }
    return link
  }
}

/** A fábrica do app com o agente falso e uma fonte que devolve `set` como os conectores ligados. */
function opener(log: Record<string, unknown>[], set: AcpConnectorSet | null, extra: { locked?: () => boolean; approvalTimeoutMs?: number; mcpStatus?: FakeStatus; connectorWaitMs?: number } = {}) {
  const asked = { count: 0 }
  const waitMs = extra.connectorWaitMs ?? 300
  const factory = acpOpener({
    profile: () => claudeProfile,
    launch: memory(log, extra.mcpStatus),
    connectorWaitMs: waitMs,
    baseEnv: {},
    mcp: {
      servers: async () => [],
      connectors: async () => {
        asked.count += 1
        return set
      },
    },
    ...(extra.locked ? { locked: extra.locked } : {}),
  })('/bin/claude')
  const timeout = extra.approvalTimeoutMs
  const open = timeout === undefined ? factory : (request: AcpSessionRequest) => openAcpSession({ ...request, connectors: set ?? undefined }, { profile: claudeProfile, launch: memory(log, extra.mcpStatus), env: {}, approvalTimeoutMs: timeout, connectorWaitMs: waitMs })
  return { open, asked }
}

const strictOf = (log: Record<string, unknown>[]): unknown => (log.filter((entry) => entry['method'] === 'session/new').at(-1) as { options: Record<string, unknown> } | undefined)?.options['strictMcpConfig']

describe('aprovação (CA5)', () => {
  const chatWith = (open: (request: AcpSessionRequest) => Promise<AcpOpenResult>, cwd: string): AcpChat => new AcpChat({ open, model: 'sonnet', thinkMore: false, scope: 'all', cwd, mcp: { off: [] } })

  it('"Perguntar" (padrão): o cartão com "claude.ai Notion"; "Permitir uma vez" roda a ferramenta', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const chat = chatWith(opener(log, SET()).open, cwd)
    const details: ChatDetail[] = []
    const answer = await chat.ask('use o conector claude_ai_Notion notion-search', [], () => undefined, (detail) => {
      details.push(detail)
      if (detail.type === 'approval') setTimeout(() => chat.answerApproval(detail.approval.id, 'once'), 5)
    })
    expect(answer).toEqual({ ok: true, text: 'Achei 1 página.' })
    expect(details.filter((detail) => detail.type === 'approval')).toEqual([{ type: 'approval', approval: { id: 'mcp-1', server: 'claude.ai Notion', tool: 'notion-search', args: '{\n  "query": "orçamento"\n}' } }])
    expect(log.filter((entry) => entry['event'] === 'connector').map((entry) => entry['outcome'])).toEqual(['allow'])
    expect(strictOf(log)).toBeUndefined()
    // O passo leva o nome do conector, não o servidor do nome da ferramenta.
    const steps = details.flatMap((detail) => (detail.type === 'step' ? [detail.step.label] : []))
    expect(steps).toContain('Usando notion-search (claude.ai Notion)')
    chat.kill()
  })

  it('"Sempre permitir" grava allow naquela ferramenta e a próxima não pergunta; sem resposta em 2 min, nega', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const always: string[] = []
    const chat = chatWith(opener(log, SET({}, always), { approvalTimeoutMs: 50 }).open, cwd)
    const first = await chat.ask('use o conector claude_ai_Notion notion.search', [], () => undefined, (detail) => {
      if (detail.type === 'approval') setTimeout(() => chat.answerApproval(detail.approval.id, 'always'), 5)
    })
    expect(first.ok && first.text).toBe('Achei 1 página.')
    expect(always).toEqual(['notion_search'])
    const details: ChatDetail[] = []
    const second = await chat.ask('use o conector claude_ai_Notion notion.search', [], () => undefined, (detail) => details.push(detail))
    expect(second.ok && second.text).toBe('Achei 1 página.')
    expect(details.some((detail) => detail.type === 'approval')).toBe(false)
    // Outra ferramenta, sem resposta: vence em 50 ms e é negada.
    const third: ChatDetail[] = []
    const denied = await chat.ask('use o conector claude_ai_Notion notion-fetch', [], () => undefined, (detail) => third.push(detail))
    expect(denied.ok && denied.text).toBe('Não pude usar notion-fetch: o app negou.')
    expect(third).toContainEqual({ type: 'approval-done', id: 'mcp-2', decision: 'deny' })
    chat.kill()
  })

  it('"Negar" nega sem cartão; conector desligado ou desconhecido é negado; bloqueado, negado', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    let locked = false
    const chat = chatWith(opener(log, SET({ 'notion-create-pages': 'deny' }), { locked: () => locked }).open, cwd)
    const details: ChatDetail[] = []
    const onDetail = (detail: ChatDetail): void => void details.push(detail)
    expect((await chat.ask('use o conector claude_ai_Notion notion-create-pages', [], () => undefined, onDetail)).ok).toBe(true)
    expect((await chat.ask('use o conector claude_ai_Figma get_screenshot', [], () => undefined, onDetail)).ok).toBe(true)
    expect((await chat.ask('use o conector claude_ai_Gmail search', [], () => undefined, onDetail)).ok).toBe(true)
    locked = true
    expect((await chat.ask('use o conector claude_ai_Notion notion-search', [], () => undefined, onDetail)).ok).toBe(true)
    expect(details.some((detail) => detail.type === 'approval')).toBe(false)
    expect(log.filter((entry) => entry['event'] === 'connector').map((entry) => [entry['name'], entry['outcome']])).toEqual([
      ['mcp__claude_ai_Notion__notion-create-pages', 'reject'],
      ['mcp__claude_ai_Figma__get_screenshot', 'reject'],
      ['mcp__claude_ai_Gmail__search', 'reject'],
      ['mcp__claude_ai_Notion__notion-search', 'reject'],
    ])
    chat.kill()
  })

  it('ferramenta de conector que roda sem ter sido liberada cancela a resposta', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const chat = chatWith(opener(log, SET()).open, cwd)
    const details: ChatDetail[] = []
    await chat.ask('use o conector claude_ai_Notion notion-search direto', [], () => undefined, (detail) => details.push(detail))
    expect(log.filter((entry) => entry['event'] === 'connector').map((entry) => entry['cancelled'])).toEqual([true])
    expect(details.some((detail) => detail.type === 'denied')).toBe(true)
    chat.kill()
  })
})

describe('onde vale (CA6)', () => {
  it('a conversa do chat (Assistente e reunião) recebe; sem conector ligado, o modo estrito de sempre', async () => {
    const log: Record<string, unknown>[] = []
    mkdirSync(join(dir, 'c'))
    const on = opener(log, SET())
    const opened = await on.open({ ...CHAT, cwd: join(dir, 'c'), mcp: { off: [] } })
    expect(opened.ok).toBe(true)
    if (opened.ok) opened.session.close()
    expect(on.asked.count).toBe(1)
    expect(strictOf(log)).toBeUndefined()
    const off = opener(log, null)
    const plain = await off.open({ ...CHAT, cwd: join(dir, 'c'), mcp: { off: [] } })
    if (plain.ok) plain.session.close()
    expect(strictOf(log)).toBe(true)
  })

  it('análise, resumo, tradução e sessão sem MCP: a fonte nem é consultada e o modo estrito fica', async () => {
    const log: Record<string, unknown>[] = []
    mkdirSync(join(dir, 'c'))
    const { open, asked } = opener(log, SET())
    for (const request of [
      { purpose: 'analysis', cwd: join(dir, 'c'), model: 'sonnet', systemPrompt: 'p', tools: 'none', mcp: {} },
      { purpose: 'summary', cwd: join(dir, 'c'), model: 'haiku', systemPrompt: 'p', tools: 'none' },
      { purpose: 'translate', cwd: join(dir, 'c'), model: 'haiku', systemPrompt: 'p', tools: 'none' },
      { ...CHAT, cwd: join(dir, 'c') },
    ] as AcpSessionRequest[]) {
      const opened = await open(request)
      if (opened.ok) opened.session.close()
      expect(strictOf(log)).toBe(true)
    }
    expect(asked.count).toBe(0)
  })

  it('o agente das Automações abre o chat sem pedir MCP (como no contrato 21): sem conector', async () => {
    const opened: AcpSessionRequest[] = []
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => (req) => {
        opened.push(req)
        return Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' })
      },
      corpus: { dir: join(dir, 'acervo'), ensure: () => Promise.resolve(), scope: () => Promise.resolve(null), scopeMany: () => Promise.resolve(join(dir, 'escopo')), dropScope: () => Promise.resolve() },
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
    })
    await runner.run(
      {
        runId: 'run-1',
        agent: { name: 'Resumo', instructions: 'Liste.', profile: 'claude', model: 'sonnet', thinkMore: false, scope: { kind: 'all' }, web: false, funil: false, tarefas: false },
        prompt: 'Resuma.',
        meetingId: null,
        timeoutS: 30,
      },
      () => undefined,
    )
    expect(opened).toHaveLength(1)
    expect(opened[0]?.mcp).toBeUndefined()
    const log: Record<string, unknown>[] = []
    mkdirSync(join(dir, 'acervo'), { recursive: true })
    const { open, asked } = opener(log, SET())
    const session = await open(opened[0] as AcpSessionRequest)
    if (session.ok) session.session.close()
    expect(asked.count).toBe(0)
    expect(strictOf(log)).toBe(true)
  })
})

describe('o que a sessão carregou (devolução: CA4, CA7)', () => {
  it('lê a lista do /mcp no formato do adaptador 0.107.0 (o `formatMcpStatus` dele)', async () => {
    const require = createRequire(join(__dirname, '..', 'package.json'))
    const root = dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json'))
    const { formatMcpStatus } = (await import(pathToFileURL(join(root, 'dist', 'mcp-command.js')).href)) as { formatMcpStatus: (statuses: unknown[]) => string }
    const markdown = formatMcpStatus([
      { name: 'claude.ai Notion', status: 'connected', tools: [{}, {}] },
      { name: 'claude.ai Mez', status: 'needs-auth' },
      { name: 'claude.ai Lucid', status: 'pending' },
      { name: 'claude.ai COLAB', status: 'failed', error: 'MCP error -32001: HTTP 404' },
      { name: 'nome `com` crase', status: 'connected' },
      { name: 'parado', status: 'disabled' },
      { name: 'novo', status: 'reconnecting' },
    ])
    expect(parseMcpStatus(markdown)).toEqual([
      { name: 'claude.ai COLAB', status: 'failed' },
      { name: 'claude.ai Mez', status: 'needs-auth' },
      { name: 'claude.ai Lucid', status: 'pending' },
      { name: 'claude.ai Notion', status: 'connected' },
      { name: 'nome `com` crase', status: 'connected' },
      { name: 'novo', status: 'reconnecting' },
      { name: 'parado', status: 'disabled' },
    ])
    expect(parseMcpStatus(formatMcpStatus([]))).toEqual([])
    expect(parseMcpStatus('Claude Code text sem a lista')).toBeNull()
  })

  it('escapou: não é do app nem está bloqueado; nome com `__` escapa sempre', () => {
    const blocked = blockedServersOf(['Bash', 'mcp__claude_ai_Figma', 'mcp__timesheet', 'mcp__claude_ai_Notion__notion-create-pages', 'mcp__a__b'])
    expect([...blocked]).toEqual(['claude_ai_Figma', 'timesheet'])
    const verdict = connectorVerdict(
      [
        { name: 'claude.ai Notion', status: 'pending' },
        { name: 'claude.ai Figma', status: 'connected' },
        { name: 'calculadora', status: 'connected' },
        { name: 'claude.ai Novo', status: 'needs-auth' },
        { name: 'a__b', status: 'connected' },
        { name: 'parado', status: 'disabled' },
      ],
      [connector()],
      new Set(['calculadora']),
      blocked,
    )
    expect(verdict.surprises).toEqual(['claude_ai_Novo', 'a__b'])
    expect(verdict.pending.map((entry) => entry.name)).toEqual(['Notion'])
  })

  it('servidor surpresa: a sessão reabre uma vez com ele bloqueado e segue com o conector', async () => {
    const log: Record<string, unknown>[] = []
    mkdirSync(join(dir, 'c'))
    const surprise: FakeStatus = (session) => [...ACCOUNT(session), ...(session.strict ? [] : [{ name: 'claude.ai Novo', status: 'connected', tools: 3 }])]
    const opened = await opener(log, SET(), { mcpStatus: surprise }).open({ ...CHAT, cwd: join(dir, 'c'), mcp: { off: [] } })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const created = log.filter((entry) => entry['method'] === 'session/new') as { options: { strictMcpConfig?: boolean; disallowedTools: string[] } }[]
    expect(created).toHaveLength(2)
    expect(created[0]?.options.disallowedTools).not.toContain('mcp__claude_ai_Novo')
    expect(created[1]?.options.disallowedTools).toContain('mcp__claude_ai_Novo')
    expect(created[1]?.options.strictMcpConfig).toBeUndefined()
    expect(opened.session.connectors?.enabled.map((entry) => entry.name)).toEqual(['Notion'])
    expect(opened.session.takeNotices()).toEqual([])
    opened.session.close()
  })

  it('escapou de novo: a conversa segue no modo estrito, sem conector, com o aviso na conversa', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    // `a__b` não tem como ser bloqueado pelo servidor: escapa nas duas aberturas.
    const stubborn: FakeStatus = (session) => [...ACCOUNT(session), ...(session.strict ? [] : [{ name: 'a__b', status: 'connected', tools: 1 }])]
    const chat = new AcpChat({ open: opener(log, SET(), { mcpStatus: stubborn }).open, model: 'sonnet', thinkMore: false, scope: 'all', cwd, mcp: { off: [] } })
    const details: ChatDetail[] = []
    const answer = await chat.ask('use o conector claude_ai_Notion notion-search', [], () => undefined, (detail) => details.push(detail))
    const created = log.filter((entry) => entry['method'] === 'session/new') as { options: { strictMcpConfig?: boolean } }[]
    expect(created.map((entry) => entry.options.strictMcpConfig)).toEqual([undefined, undefined, true])
    expect(details).toContainEqual({ type: 'step', step: { tool: 'Mcp', label: CLAUDE_CONNECTORS_UNKNOWN_NOTICE, meetingId: null, id: 'aviso-conector-1', status: 'failed' } })
    // Sem conector na sessão, a ferramenta dele é negada.
    expect(answer.ok && answer.text).toBe('Não pude usar notion-search: o app negou.')
    // O aviso sai uma vez só.
    const again: ChatDetail[] = []
    await chat.ask('oi', [], () => undefined, (detail) => again.push(detail))
    expect(again.some((detail) => detail.type === 'step' && detail.step.label === CLAUDE_CONNECTORS_UNKNOWN_NOTICE)).toBe(false)
    chat.kill()
  })

  it('o conector que demora: a sessão espera ele conectar pelo /mcp antes da primeira pergunta', async () => {
    const log: Record<string, unknown>[] = []
    mkdirSync(join(dir, 'c'))
    const slow: FakeStatus = (session) => (session.strict ? [] : session.elapsedMs < 250 ? [] : ACCOUNT(session))
    const opened = await opener(log, SET(), { mcpStatus: slow, connectorWaitMs: 3000 }).open({ ...CHAT, cwd: join(dir, 'c'), mcp: { off: [] } })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const polls = log.filter((entry) => entry['event'] === 'mcp-status') as { servers: string[] }[]
    expect(polls.length).toBeGreaterThan(1)
    expect(polls[0]?.servers).toEqual([])
    expect(polls.at(-1)?.servers).toContain('claude.ai Notion=connected')
    expect(opened.session.takeNotices()).toEqual([])
    opened.session.close()
  })

  it('passou do limite: a pergunta segue sem o conector que faltou e o passo diz "O Notion ainda não conectou"', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const never: FakeStatus = (session) => (session.strict ? [] : [{ name: 'claude.ai Notion', status: 'pending' }, { name: 'claude.ai Figma', status: 'connected', tools: 45 }])
    const chat = new AcpChat({ open: opener(log, SET(), { mcpStatus: never, connectorWaitMs: 300 }).open, model: 'sonnet', thinkMore: false, scope: 'all', cwd, mcp: { off: [] } })
    const details: ChatDetail[] = []
    const started = Date.now()
    await chat.ask('oi', [], () => undefined, (detail) => details.push(detail))
    expect(Date.now() - started).toBeLessThan(3000)
    expect(details).toContainEqual({ type: 'step', step: { tool: 'Mcp', label: 'O Notion ainda não conectou', meetingId: null, id: 'aviso-conector-1', status: 'failed' } })
    // A sessão continua com o conector (pode conectar depois) e sem o modo estrito.
    expect(strictOf(log)).toBeUndefined()
    chat.kill()
  })
})

describe('serviço: a lista em cache para a sessão (devolução)', () => {
  const setup = () => {
    const cliFile = join(dir, 'claude.json')
    writeFileSync(cliFile, JSON.stringify({ mcpServers: {} }))
    const state = { failing: false, clock: 1_000_000, calls: [] as string[], gate: null as Promise<void> | null }
    const exec: ExecFile = async (_file, args) => {
      state.calls.push(args.join(' '))
      if (state.gate) await state.gate
      if (state.failing) throw new Error('falhou')
      return { stdout: LIST }
    }
    const mcp = createMcpService({
      store: createMcpStore({ dir, safeStorage: memorySafeStorage() }),
      cli: createMcpCli({ exec, baseEnv: {}, configFile: cliFile, cwd: join(dir, 'cwd') }),
      locate: async () => ({ ok: true, path: '/bin/claude', version: '2.1.325' }),
      desktopConfig: join(dir, 'nao-existe.json'),
      baseEnv: {},
      loginPath: async () => '/usr/bin',
      now: () => state.clock,
      connectorPrefs: async () => ({ Notion: { enabled: true, tools: {} } }),
    })
    return { mcp, state }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('sem cache espera a lista; a segunda sessão abre com a lista em cache, sem chamar o `claude mcp list`', async () => {
    const { mcp, state } = setup()
    expect((await mcp.sessionConnectors())?.enabled).toHaveLength(1)
    expect((await mcp.sessionConnectors())?.enabled).toHaveLength(1)
    expect(state.calls).toEqual(['mcp list'])
  })

  it('com mais de 5 min, a sessão abre com o cache e a lista renova em segundo plano', async () => {
    const { mcp, state } = setup()
    await mcp.sessionConnectors()
    state.clock += LIST_STALE_MS + 1
    let release: () => void = () => undefined
    // A leitura em segundo plano fica presa até `release`: a sessão volta antes dela.
    state.gate = new Promise<void>((resolve) => (release = resolve))
    const original = state.calls.length
    const set = await mcp.sessionConnectors()
    expect(set?.enabled).toHaveLength(1)
    await settle()
    expect(state.calls.length).toBe(original + 1)
    state.gate = null
    release()
    await settle()
    // Renovada: a próxima não chama de novo.
    await mcp.sessionConnectors()
    expect(state.calls.length).toBe(original + 1)
  })

  it('invalidar (mudou o MCP ou `claudeConnectors`) faz a próxima sessão esperar uma lista nova; a aba que relê também renova', async () => {
    const { mcp, state } = setup()
    await mcp.sessionConnectors()
    mcp.invalidateConnectors()
    await mcp.sessionConnectors()
    expect(state.calls).toEqual(['mcp list', 'mcp list'])
    mcp.invalidateConnectors()
    await mcp.overview({ cli: true, refresh: true })
    await mcp.sessionConnectors()
    expect(state.calls).toEqual(['mcp list', 'mcp list', 'mcp list'])
  })

  it('sem cache e com o `claude mcp list` falhando, a sessão só tenta de novo passados 60 s', async () => {
    const { mcp, state } = setup()
    state.failing = true
    expect(await mcp.sessionConnectors()).toBeNull()
    expect(await mcp.sessionConnectors()).toBeNull()
    expect(state.calls).toHaveLength(1)
    state.clock += LIST_RETRY_MS
    state.failing = false
    expect((await mcp.sessionConnectors())?.enabled).toHaveLength(1)
    expect(state.calls).toHaveLength(2)
  })
})
