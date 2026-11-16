// Contrato 17, devolução: perfil de agente (CA11), instalação do agente com hash pinado e tar próprio,
// pré-aquecimento e prazo da tradução desde a chegada do trecho, "Parar" e `kill` enquanto a sessão abre.
// Agentes na memória; nenhuma rede nem processo.
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openAcpSession, type AcpLink, type AcpSessionRequest, type AgentProfile, type LaunchAcp } from '../src/main/acp/agent'
import { AcpChat } from '../src/main/acp/chat'
import { createAcpInstaller, integrityOf, readTar, safeEntryPath, type AcpPackage } from '../src/main/acp/install'
import { claudeProfile, CLAUDE_PACKAGES } from '../src/main/acp/profiles/claude'
import { runAcpSummary } from '../src/main/acp/summary'
import { AcpTranslator } from '../src/main/acp/translator'
import { summaryInput } from '../src/main/claude-cli/summary'
import { smokeTarball } from '../src/main/smoke-fixtures'
import type { AcpAgentStatus } from '../src/shared/acp'
import type { ChatDetail } from '../src/shared/chat'

/** Agente na memória: cada `launch` é um "processo" novo. */
function memory(make: () => acp.AgentApp) {
  const links: { killed: boolean }[] = []
  const launch: LaunchAcp = () => {
    const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const connection = make().connect({ writable: toClient.writable, readable: toAgent.readable })
    const listeners: (() => void)[] = []
    let exited = false
    const record = { killed: false }
    links.push(record)
    const link: AcpLink = {
      stream: { writable: toAgent.writable, readable: toClient.readable },
      kill: () => {
        record.killed = true
        if (exited) return
        exited = true
        connection.close()
        for (const listener of listeners.splice(0)) listener()
      },
      onExit: (listener) => (exited ? listener() : void listeners.push(listener)),
    }
    return link
  }
  return { launch, links }
}

const opener = (launch: LaunchAcp, profile: AgentProfile = claudeProfile) => (request: AcpSessionRequest) => openAcpSession(request, { profile, launch, env: {} })
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const MODE_DEFAULT: acp.SessionConfigOption[] = [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Manual' }] }]

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acp-agents-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('perfil de agente (CA11)', () => {
  /**
   * Perfil falso, de um agente que não é o Claude: ferramentas com outros nomes, opções em outro `_meta`, o
   * modo seguro chamado "somente-leitura", modelo e custo no `_meta` dele.
   */
  const seen: { params: acp.NewSessionRequest[] } = { params: [] }
  const fakeProfile: AgentProfile = {
    id: 'claude',
    label: 'Falso',
    install: { version: '1.0.0', packages: [], entry: ['falso', 'index.js'] },
    bundledPackage: 'falso',
    env: (base, cli) => ({ FALSO_CLI: cli, HOME: base['HOME'] ?? '' }),
    newSession: (request) => ({ cwd: request.cwd, mcpServers: [], _meta: { falso: { ferramentas: request.tools, instrucao: request.systemPrompt.slice(0, 20), modelo: request.model } } }),
    unsafeMode: (session) => (session.option('acesso') === 'somente-leitura' ? null : 'sem somente-leitura'),
    readTools: { ler_arquivo: 'read', buscar: 'search' },
    stepOf: (call) => (call.name === 'ler_arquivo' ? { tool: 'Read', input: { file_path: (call.rawInput as { caminho?: string } | undefined)?.caminho } } : null),
    modelConfig: { configId: 'modelo', value: (model) => `falso-${model}` },
    thinkMore: null,
    usage: (update) => ({ model: typeof update._meta?.['falso/modelo'] === 'string' ? update._meta['falso/modelo'] : null, costUsd: update.cost?.amount ?? null, used: update.used }),
  }

  const fakeAgent = (): acp.AgentApp =>
    acp
      .agent()
      .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
      .onRequest('session/new', (ctx) => {
        seen.params.push(ctx.params)
        return { sessionId: 's', configOptions: [{ id: 'acesso', name: 'Acesso', type: 'select', currentValue: 'somente-leitura', options: [{ value: 'somente-leitura', name: 'Leitura' }] }] }
      })
      .onRequest('session/prompt', async (ctx) => {
        const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
        const say = (piece: string) => ctx.client.notify('session/update', { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: piece } } })
        const prompt = (seen.params.at(-1)?._meta as { falso: { instrucao: string } }).falso.instrucao
        if (prompt.startsWith('You translate')) await say(`[falso] ${/<turn>(.*)<\/turn>/.exec(text)?.[1] ?? ''}`)
        else if (prompt.startsWith('Você resume')) await say('{"overview": "Resumo do agente falso.", "decisions": [], "tasks": []}')
        else {
          await ctx.client.notify('session/update', {
            sessionId: 's',
            update: { sessionUpdate: 'tool_call', toolCallId: 't1', name: 'ler_arquivo', kind: 'read', title: 'ler', status: 'completed', rawInput: { caminho: join(dir, 'INDICE.md') } },
          })
          // Pedido de uma ferramenta que não é de leitura no perfil: negado.
          await ctx.client.request('session/request_permission', {
            sessionId: 's',
            toolCall: { toolCallId: 't2', title: 'apagar', kind: 'delete', rawInput: {} },
            options: [
              { optionId: 'sim', name: 'Sim', kind: 'allow_once' },
              { optionId: 'nao', name: 'Não', kind: 'reject_once' },
            ],
          })
          await say('Resposta do agente falso.')
          await ctx.client.notify('session/update', { sessionId: 's', update: { sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 0.5, currency: 'USD' }, _meta: { 'falso/modelo': 'falso-x' } } })
        }
        return { stopReason: 'end_turn' as const, usage: { totalTokens: 3, inputTokens: 2, outputTokens: 1 } }
      })

  it('um perfil falso roda chat, tradução e resumo sem tocar no código comum', async () => {
    seen.params = []
    const { launch } = memory(fakeAgent)
    const open = opener(launch, fakeProfile)

    const chat = new AcpChat({ open, model: 'sonnet', thinkMore: false, scope: 'all', cwd: dir })
    const details: ChatDetail[] = []
    const answer = await chat.ask('Oi?', [], () => undefined, (detail) => details.push(detail))
    expect(answer).toEqual({ ok: true, text: 'Resposta do agente falso.' })
    expect(details.find((detail) => detail.type === 'step')).toMatchObject({ step: { tool: 'Read', label: 'Lendo o índice das reuniões', status: 'completed' } })
    expect(details.find((detail) => detail.type === 'denied')).toEqual({ type: 'denied', count: 1 })
    expect(details.find((detail) => detail.type === 'meta')).toMatchObject({ meta: { model: 'falso-x', costUsd: 0.5 } })
    expect(seen.params[0]?._meta).toEqual({ falso: { ferramentas: 'read', instrucao: 'Você responde pergun', modelo: 'sonnet' } })
    chat.kill()

    const translator = new AcpTranslator({ open, model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: dir })
    translator.start()
    expect(await translator.translate({ segmentId: 'm', source: 'mic', turnOrder: 0, text: 'Olá' })).toEqual({ ok: true, translation: '[falso] Olá', model: 'claude-cli:haiku' })
    expect((seen.params.at(-1)?._meta as { falso: { ferramentas: string } }).falso.ferramentas).toBe('none')
    translator.kill()

    const summary = await runAcpSummary({ open, model: 'haiku', cwd: dir, input: summaryInput(['[00:01] Você: Oi.']) })
    expect(summary).toMatchObject({ ok: true, content: { overview: 'Resumo do agente falso.' } })
  })

  it('sessão sem o modo seguro do perfil é fechada com o erro `agent`', async () => {
    const unsafe = memory(() =>
      acp
        .agent()
        .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
        .onRequest('session/new', () => ({ sessionId: 's', configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }] }] })),
    )
    const result = await opener(unsafe.launch)({ purpose: 'chat', cwd: dir, model: 'haiku', systemPrompt: 'p', tools: 'read' })
    expect(result).toMatchObject({ ok: false, error: 'agent' })
    expect(unsafe.links[0]?.killed).toBe(true)
  })
})

describe('instalação do agente (contrato 17, devolução A)', () => {
  const pkg = (name: string, files: Record<string, string>, entry = false): { meta: AcpPackage; data: Buffer } => {
    const data = smokeTarball(entry ? { ...files, 'dist/index.js': '// agente' } : files)
    return { meta: { name, version: '1.0.0', path: `${name}/-/${name.split('/').at(-1)}-1.0.0.tgz`, integrity: integrityOf(data), bytes: data.length }, data }
  }

  it('baixa só do registro, confere o hash, extrai em .part e troca a pasta inteira no fim', async () => {
    const agent = pkg('@falso/agente', { 'package.json': '{}' }, true)
    const dep = pkg('dep', { 'package.json': '{}', 'lib/a.js': 'a' })
    const urls: string[] = []
    const statuses: AcpAgentStatus[] = []
    const installer = createAcpInstaller({
      root: join(dir, 'acp', 'falso'),
      packages: [agent.meta, dep.meta],
      version: '1.0.0',
      entry: ['@falso', 'agente', 'dist', 'index.js'],
      label: 'Falso',
      download: (url, onBytes) => {
        urls.push(url)
        const data = url.endsWith(agent.meta.path) ? agent.data : dep.data
        onBytes(data.length)
        return Promise.resolve(data)
      },
      onStatus: (status) => statuses.push(status),
    })
    expect(installer.status()).toMatchObject({ state: 'missing', label: 'Falso', downloadBytes: agent.data.length + dep.data.length })
    expect(installer.entry()).toBeNull()
    expect(await installer.install()).toMatchObject({ state: 'installed', version: '1.0.0' })
    expect(urls).toEqual([`https://registry.npmjs.org/${agent.meta.path}`, `https://registry.npmjs.org/${dep.meta.path}`])
    expect(statuses[0]?.state).toBe('installing')
    expect(statuses.some((status) => status.state === 'installing' && status.progress > 0)).toBe(true)
    expect(installer.entry()).toBe(join(dir, 'acp', 'falso', '1.0.0', 'node_modules', '@falso', 'agente', 'dist', 'index.js'))
    expect(readFileSync(join(dir, 'acp', 'falso', '1.0.0', 'node_modules', 'dep', 'lib', 'a.js'), 'utf8')).toBe('a')
    expect(readdirSync(join(dir, 'acp', 'falso'))).toEqual(['1.0.0'])
    expect(await installer.remove()).toMatchObject({ state: 'missing' })
    expect(existsSync(join(dir, 'acp', 'falso', '1.0.0'))).toBe(false)
  })

  it('hash diferente apaga tudo e dá erro; tar com `..`, caminho absoluto ou link é recusado', async () => {
    const agent = pkg('agente', { 'package.json': '{}' }, true)
    const installer = createAcpInstaller({
      root: join(dir, 'acp'),
      packages: [{ ...agent.meta, integrity: 'sha512-outro' }],
      version: '1.0.0',
      entry: ['agente', 'dist', 'index.js'],
      label: 'Falso',
      download: () => Promise.resolve(agent.data),
    })
    const failed = await installer.install()
    expect(failed.state).toBe('error')
    expect(failed.error).toContain('não confere')
    expect(readdirSync(join(dir, 'acp'))).toEqual([])

    expect(safeEntryPath('package/../../x')).toBeNull()
    expect(safeEntryPath('/etc/passwd')).toBeNull()
    expect(safeEntryPath('package/lib/a.js')).toBe('lib/a.js')
    // Link simbólico (tipo "2") no tar: recusado.
    const header = Buffer.alloc(512)
    header.write('package/link', 0, 100, 'utf8')
    header.write('00000000000\0', 124, 12, 'ascii')
    header.write('2', 156, 1, 'ascii')
    expect(() => readTar(Buffer.concat([header, Buffer.alloc(1024)]))).toThrow(/tipo "2"/)
    // Arquivo comum com caminho que sobe para fora do pacote: recusado.
    const escape = Buffer.alloc(512)
    escape.write('package/../../fora.txt', 0, 100, 'utf8')
    escape.write('00000000000\0', 124, 12, 'ascii')
    escape.write('0', 156, 1, 'ascii')
    expect(() => readTar(Buffer.concat([escape, Buffer.alloc(1024)]))).toThrow(/caminho recusado/)
    // O tarball do smoke (ustar com `package/`) é lido inteiro.
    expect(readTar(gunzipSync(smokeTarball({ 'a.txt': 'x' })))).toEqual([{ path: 'a.txt', data: Buffer.from('x') }])
  })

  it('os pacotes pinados do Claude são a árvore do adaptador instalado no app', () => {
    const require = createRequire(join(process.cwd(), 'package.json'))
    const adapterDir = dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json'))
    const adapter = JSON.parse(readFileSync(join(adapterDir, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> }
    const pinned = Object.fromEntries(CLAUDE_PACKAGES.map((entry) => [entry.name, entry.version]))
    expect(pinned['@agentclientprotocol/claude-agent-acp']).toBe(adapter.version)
    for (const [name, version] of Object.entries(adapter.dependencies)) expect(pinned[name], name).toBe(version)
    for (const entry of CLAUDE_PACKAGES) {
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
      expect(entry.path.startsWith(`${entry.name}/-/`)).toBe(true)
    }
  })
})

describe('tradução e chat enquanto a sessão abre (devolução D, E, F)', () => {
  /** Agente cujo `session/new` demora `delay` ms; responde `[EN] texto`. */
  const slowAgent = (delay: number, log: string[] = []) => (): acp.AgentApp =>
    acp
      .agent()
      .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
      .onRequest('session/new', async () => {
        log.push('new')
        await wait(delay)
        return { sessionId: 's', configOptions: MODE_DEFAULT }
      })
      .onRequest('session/set_config_option', async () => {
        await wait(delay)
        return { configOptions: MODE_DEFAULT }
      })
      .onRequest('session/prompt', async (ctx) => {
        const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
        await ctx.client.notify('session/update', { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `[EN] ${/<turn>(.*)<\/turn>/.exec(text)?.[1] ?? 'ok'}` } } })
        return { stopReason: 'end_turn' as const }
      })

  it('os 10 s contam desde a chegada do trecho, também enquanto a sessão abre', async () => {
    const { launch } = memory(slowAgent(80))
    const translator = new AcpTranslator({ open: opener(launch), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: dir, resultTimeoutMs: 20 })
    translator.start()
    expect(await translator.translate({ segmentId: 'a', source: 'mic', turnOrder: 0, text: 'oi' })).toEqual({ ok: false, error: 'timeout' })
    translator.kill()
  })

  it('a sessão da próxima rodada abre antes do último trecho: a troca não atrasa', async () => {
    const log: string[] = []
    const { launch } = memory(slowAgent(40, log))
    const translator = new AcpTranslator({ open: opener(launch), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: dir, maxTurnsPerProcess: 3 })
    translator.start()
    const request = (n: number) => ({ segmentId: `s${n}`, source: 'mic' as const, turnOrder: n, text: `t${n}` })
    await translator.translate(request(0))
    await translator.translate(request(1))
    // Depois do 2º trecho (penúltimo da rodada) a próxima sessão já está abrindo.
    await wait(10)
    expect(log).toEqual(['new', 'new'])
    await wait(60)
    await translator.translate(request(2))
    const started = Date.now()
    expect(await translator.translate(request(3))).toMatchObject({ ok: true, translation: '[EN] t3' })
    // Sem esperar os 40 ms de abrir: a sessão nova já estava pronta.
    expect(Date.now() - started).toBeLessThan(35)
    expect(translator.sessions).toHaveLength(2)
    translator.kill()
  })

  it('"Parar" enquanto a sessão abre não manda a pergunta; `kill` durante a troca de modelo não rejeita', async () => {
    const prompts: string[] = []
    const app = (): acp.AgentApp =>
      slowAgent(40)().onRequest('session/prompt', (ctx) => {
        prompts.push('prompt')
        return ctx.params.sessionId ? { stopReason: 'end_turn' as const } : { stopReason: 'end_turn' as const }
      })
    const { launch } = memory(app)
    const chat = new AcpChat({ open: opener(launch), model: 'haiku', thinkMore: false, scope: 'all', cwd: dir })
    const pending = chat.ask('Oi', [], () => undefined)
    await wait(5)
    expect(chat.stop()).toBe(true)
    expect(await pending).toEqual({ ok: false, error: 'stopped', text: '' })
    expect(prompts).toEqual([])
    expect(chat.alive).toBe(true)

    chat.configure('opus', false)
    const during = chat.ask('De novo', [], () => undefined)
    await wait(5)
    chat.kill()
    await expect(during).resolves.toEqual({ ok: false, error: 'stopped', text: '' })
    expect(chat.stop()).toBe(false)
  })
})
