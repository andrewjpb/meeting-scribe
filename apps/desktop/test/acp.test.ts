// Motor do Claude pelo ACP (contrato 17): processo e ambiente (CA1), sessão e opções (CA2), segurança
// (CA3), eventos do chat (CA4), tradução (CA4b), resumo (CA4c), fábrica única (CA4d) e o serviço do chat com
// o transporte trocado. O agente é o falso (test/fixtures/fake-acp-agent.mjs), ligado na memória ao cliente
// por streams; nenhum processo de verdade nem o `claude` real.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACP_BOOT,
  ACP_READ_MAX_BYTES,
  insideFolder,
  openAcpSession,
  permissionAllowed,
  permissionOutcome,
  processLauncher,
  readTextFileInside,
  type AcpChildProcess,
  type AcpLink,
  type AcpSessionRequest,
  type AgentProfile,
  type LaunchAcp,
} from '../src/main/acp/agent'
import { AcpChat, acpStepOf } from '../src/main/acp/chat'
import { runAcpOneShot, runAcpSummary } from '../src/main/acp/summary'
import { analysisInput, analysisParser, analysisSystemPrompt } from '../src/main/claude-cli/analysis'
import { AcpTranslator } from '../src/main/acp/translator'
import { insightsInput, insightsParser, insightsSystemPrompt } from '../src/main/whatsapp/insights'
import { CLAUDE_DISALLOWED_TOOLS, claudeProfile } from '../src/main/acp/profiles/claude'
import { summaryInput } from '../src/main/claude-cli/summary'
import { createChatCorpus } from '../src/main/chat/corpus'
import { createChatService } from '../src/main/chat/service'
import { createFileChatStore } from '../src/main/chat/store'
import { createFileMeetingsStore } from '../src/main/meetings/store'
import { createFileSummaryStore } from '../src/main/meetings/summaries'
import { createFileTranscriptStore } from '../src/main/meetings/transcripts'
import type { ChatDetail, ChatEvent } from '../src/shared/chat'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings-defaults'
// @ts-expect-error o agente falso é um script .mjs sem tipos
import { fakeAcpAgent } from './fixtures/fake-acp-agent.mjs'

type LogEntry = Record<string, unknown> & { method?: string; event?: string }
type AgentFactory = () => acp.AgentApp

/** Liga um agente na memória ao cliente: cada `launch` é um "processo" novo; `crash` mata o último. */
function memory(make: AgentFactory) {
  const links: { exit: () => void; killed: boolean }[] = []
  const launch: LaunchAcp = () => {
    const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const connection = make().connect({ writable: toClient.writable, readable: toAgent.readable })
    const listeners: (() => void)[] = []
    let exited = false
    const exit = (): void => {
      if (exited) return
      exited = true
      connection.close()
      for (const listener of listeners.splice(0)) listener()
    }
    const record = { exit, killed: false }
    links.push(record)
    const link: AcpLink = {
      stream: { writable: toAgent.writable, readable: toClient.readable },
      kill: () => {
        record.killed = true
        exit()
      },
      onExit: (listener) => (exited ? listener() : void listeners.push(listener)),
    }
    return link
  }
  return { launch, links, crash: () => links.at(-1)?.exit() }
}

function fake(log: LogEntry[], pause = 0): AgentFactory {
  return () => fakeAcpAgent({ log: (entry: LogEntry) => log.push(entry), pause }) as acp.AgentApp
}

/** Resposta mínima do `session/new` com o modo "default" confirmado. */
const MODE_DEFAULT: acp.SessionConfigOption[] = [{ id: 'mode', name: 'Mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Manual' }] }]

const opener = (launch: LaunchAcp, profile: AgentProfile = claudeProfile) => (request: AcpSessionRequest) => openAcpSession(request, { profile, launch, env: { HOME: '/Users/teste' } })

let dir: string
let corpus: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acp-'))
  corpus = join(dir, 'chat-corpus')
  mkdirSync(corpus)
  writeFileSync(join(corpus, 'INDICE.md'), '# Índice\n\n- 15/11/2026 10:00 · Planejamento Q1 · Fechar o orçamento. · 2026-11-15 10h00 - Planejamento Q1 - m-plan.md · meeting:m-plan\n')
  writeFileSync(join(corpus, '2026-11-15 10h00 - Planejamento Q1 - m-plan.md'), '# Planejamento Q1\n\n- Id: m-plan\n')
  writeFileSync(join(dir, 'fora.txt'), 'segredo')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('processo e sessão (CA1, CA2, CA4d)', () => {
  it('sobe o adaptador com o Node do Electron, o ambiente do claude e CLAUDE_CODE_EXECUTABLE', () => {
    const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    const spawn = (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }): AcpChildProcess => {
      calls.push({ file, args, env: options.env })
      return { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true, on: () => undefined }
    }
    const env = claudeProfile.env({ HOME: '/Users/a', PATH: '/usr/bin', ASSEMBLYAI_API_KEY: 'segredo', ELECTRON_RUN_AS_NODE: '0' }, '/Users/a/.local/bin/claude')
    processLauncher({ execPath: '/Applications/LAP.app/Contents/MacOS/LAP', entry: '/R/acp/dist/index.js', spawn })(env, claudeProfile)
    expect(calls[0]?.file).toBe('/Applications/LAP.app/Contents/MacOS/LAP')
    // O boot tira ELECTRON_RUN_AS_NODE do ambiente antes de carregar o adaptador (o `claude` não o herda).
    expect(calls[0]?.args).toEqual(['-e', ACP_BOOT, '/R/acp/dist/index.js'])
    expect(Object.keys(calls[0]?.env ?? {}).sort()).toEqual(['CLAUDE_CODE_EXECUTABLE', 'ELECTRON_RUN_AS_NODE', 'HOME', 'PATH'])
    expect(calls[0]?.env['CLAUDE_CODE_EXECUTABLE']).toBe('/Users/a/.local/bin/claude')
    expect(calls[0]?.env['ELECTRON_RUN_AS_NODE']).toBe('1')
  })

  it('session/new: pasta, sem MCP, settingSources vazio, só as ferramentas pedidas, modo default e o modelo', () => {
    const params = claudeProfile.newSession({ purpose: 'chat', cwd: '/x', model: 'sonnet', systemPrompt: 'Instrução', tools: 'read', thinkMore: true })
    expect(params.mcpServers).toEqual([])
    expect(params.cwd).toBe('/x')
    expect(params.configOptions).toEqual([
      { configId: 'mode', value: 'default' },
      { configId: 'model', value: 'sonnet' },
      { configId: 'effort', value: 'high' },
    ])
    expect(params._meta).toEqual({
      claudeCode: {
        options: {
          settingSources: [],
          tools: ['Read', 'Grep', 'Glob'],
          disallowedTools: [...CLAUDE_DISALLOWED_TOOLS],
          model: 'sonnet',
          systemPrompt: 'Instrução',
          strictMcpConfig: true,
          persistSession: false,
          promptSuggestions: false,
          allowDangerouslySkipPermissions: false,
          extraArgs: { restricted: null },
        },
      },
    })
    const none = claudeProfile.newSession({ purpose: 'translate', cwd: '/x', model: 'haiku', systemPrompt: 'p', tools: 'none' })
    expect(none.configOptions).toHaveLength(2)
    expect((none._meta as { claudeCode: { options: { tools: string[] } } }).claudeCode.options.tools).toEqual([])
  })

  it('initialize com fs só de leitura e sem terminal; versão do protocolo conferida', async () => {
    const log: LogEntry[] = []
    const { launch } = memory(fake(log))
    const opened = await opener(launch)({ purpose: 'chat', cwd: corpus, model: 'haiku', systemPrompt: 'p', tools: 'read' })
    expect(opened.ok).toBe(true)
    expect(log[0]).toMatchObject({ method: 'initialize', protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false } })
    expect(log[1]).toMatchObject({ method: 'session/new', cwd: corpus, mcpServers: [], options: { settingSources: [], tools: ['Read', 'Grep', 'Glob'] } })
    if (opened.ok) opened.session.close()

    const wrongVersion = memory(() => acp.agent().onRequest('initialize', () => ({ protocolVersion: 2, agentCapabilities: {}, authMethods: [] })))
    const refused = await opener(wrongVersion.launch)({ purpose: 'chat', cwd: corpus, model: 'haiku', systemPrompt: 'p', tools: 'none' })
    expect(refused).toMatchObject({ ok: false, error: 'agent' })
    expect(wrongVersion.links[0]?.killed).toBe(true)

    const broken = await opener(() => {
      throw new Error('ENOENT')
    })({ purpose: 'chat', cwd: corpus, model: 'haiku', systemPrompt: 'p', tools: 'none' })
    expect(broken).toMatchObject({ ok: false, error: 'agent' })

    // O adaptador sai antes de responder (pacote corrompido).
    const dying = memory(() => acp.agent().onRequest('initialize', () => new Promise(() => undefined)))
    const pending = opener(dying.launch)({ purpose: 'chat', cwd: corpus, model: 'haiku', systemPrompt: 'p', tools: 'none' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    dying.crash()
    expect(await pending).toMatchObject({ ok: false, error: 'agent' })
  })
})

describe('segurança (CA3)', () => {
  it('permite leitura e busca só dentro da pasta, pelo caminho real', async () => {
    const real = (await import('node:fs/promises')).realpath
    const cwdReal = await real(corpus)
    symlinkSync(join(dir, 'fora.txt'), join(corpus, 'atalho.md'))
    const read = (path: string) => permissionAllowed('chat', { name: 'Read', kind: 'read', locations: [path] }, corpus, cwdReal, claudeProfile.readTools)
    expect(await read(join(corpus, 'INDICE.md'))).toBe(true)
    expect(await read(join(corpus, '..', 'fora.txt'))).toBe(false)
    expect(await read(join(dir, 'fora.txt'))).toBe(false)
    expect(await read('/etc/hosts')).toBe(false)
    expect(await read(join(corpus, 'atalho.md'))).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Read', kind: 'read', locations: [], rawInput: { file_path: '../fora.txt' } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    // Busca sem caminho: negada (dentro da pasta o `claude` nem pergunta).
    expect(await permissionAllowed('chat', { name: 'Grep', kind: 'search', locations: [], rawInput: { pattern: 'x' } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Grep', kind: 'search', locations: [], rawInput: { pattern: 'a..b', path: corpus } }, corpus, cwdReal, claudeProfile.readTools)).toBe(true)
    // Padrão que sai da pasta: negado, mesmo com o caminho dentro.
    expect(await permissionAllowed('chat', { name: 'Glob', kind: 'search', locations: [], rawInput: { pattern: '../**/*.txt', path: corpus } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Glob', kind: 'search', locations: [], rawInput: { pattern: `${dir}/**` } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Grep', kind: 'search', locations: [], rawInput: { pattern: 'x', glob: '~/.ssh/*', path: corpus } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Grep', kind: 'search', locations: [], rawInput: { pattern: 'x', path: dir } }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Read', kind: 'read', locations: [] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    // Escrita, shell e qualquer coisa fora de leitura e busca: negadas.
    expect(await permissionAllowed('chat', { name: 'Write', kind: 'edit', locations: [join(corpus, 'n.md')] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'Bash', kind: 'execute', locations: [] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('chat', { name: 'WebFetch', kind: 'read', locations: [] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    // Tradução e resumo não têm ferramenta nenhuma.
    expect(await permissionAllowed('translate', { name: 'Read', kind: 'read', locations: [join(corpus, 'INDICE.md')] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await permissionAllowed('summary', { name: 'Grep', kind: 'search', locations: [] }, corpus, cwdReal, claudeProfile.readTools)).toBe(false)
    expect(await insideFolder(cwdReal, corpus)).toBe(true)
  })

  it('responde com allow_once ou reject_once', () => {
    const options: acp.PermissionOption[] = [
      { optionId: 'a', name: 'Sempre', kind: 'allow_always' },
      { optionId: 'b', name: 'Uma vez', kind: 'allow_once' },
      { optionId: 'c', name: 'Não', kind: 'reject_once' },
    ]
    expect(permissionOutcome(options, true)).toEqual({ outcome: { outcome: 'selected', optionId: 'b' } })
    expect(permissionOutcome(options, false)).toEqual({ outcome: { outcome: 'selected', optionId: 'c' } })
    expect(permissionOutcome([{ optionId: 'a', name: 'Sempre', kind: 'allow_always' }], false)).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('fs/read_text_file lê só dentro da pasta, até 2 MB, com linha e limite', async () => {
    const cwdReal = await (await import('node:fs/promises')).realpath(corpus)
    writeFileSync(join(corpus, 'linhas.md'), 'um\ndois\ntrês\nquatro')
    expect(await readTextFileInside('chat', { sessionId: 's', path: join(corpus, 'linhas.md'), line: 2, limit: 2 }, cwdReal)).toEqual({ content: 'dois\ntrês' })
    await expect(readTextFileInside('chat', { sessionId: 's', path: join(corpus, '..', 'fora.txt') }, cwdReal)).rejects.toThrow()
    await expect(readTextFileInside('translate', { sessionId: 's', path: join(corpus, 'linhas.md') }, cwdReal)).rejects.toThrow()
    writeFileSync(join(corpus, 'grande.md'), 'x'.repeat(ACP_READ_MAX_BYTES + 1))
    await expect(readTextFileInside('chat', { sessionId: 's', path: join(corpus, 'grande.md') }, cwdReal)).rejects.toThrow()
  })
})

describe('chat pelo ACP (CA2 a CA5)', () => {
  const ask = async (chat: AcpChat, question: string) => {
    const details: ChatDetail[] = []
    const texts: string[] = []
    const answer = await chat.ask(question, [], (progress) => texts.push(progress.text), (detail) => details.push(detail))
    return { answer, details, texts }
  }

  it('mapeia os eventos do protocolo: raciocínio, passos com estado, plano, negações e detalhes', async () => {
    const log: LogEntry[] = []
    const { launch } = memory(fake(log))
    const chat = new AcpChat({ open: opener(launch), model: 'sonnet', thinkMore: false, scope: 'all', cwd: corpus, titleOf: (id) => (id === 'm-plan' ? 'Planejamento Q1' : null) })
    const { answer, details, texts } = await ask(chat, 'O que foi decidido?')
    expect(answer).toMatchObject({ ok: true })
    expect(answer.text).toContain('[Planejamento Q1 · 15/11](meeting:m-plan)')
    expect(texts.length).toBeGreaterThan(2)
    const thinking = details.flatMap((detail) => (detail.type === 'thinking' ? [detail.delta] : [])).join('')
    expect(thinking).toContain('<b>sem HTML</b>')
    const steps = details.flatMap((detail) => (detail.type === 'step' ? [detail.step] : []))
    const last = new Map(steps.map((step) => [step.id, step]))
    expect([...last.values()].map((step) => [step.label, step.status])).toEqual([
      ['Lendo o índice das reuniões', 'completed'],
      ['Abrindo «Planejamento Q1»', 'completed'],
      ['Procurando "decid"', 'completed'],
    ])
    // Nenhum caminho absoluto vai à tela.
    expect(JSON.stringify(details)).not.toContain(dir)
    const plans = details.flatMap((detail) => (detail.type === 'plan' ? [detail.entries] : []))
    expect(plans.at(-1)).toEqual([
      { content: 'Ler o índice das reuniões', status: 'completed' },
      { content: 'Abrir a reunião mais recente', status: 'completed' },
      { content: 'Responder com a citação', status: 'completed' },
    ])
    // A escrita (permissão negada) e a leitura fora da pasta (recusada) contam.
    expect(details.filter((detail) => detail.type === 'denied').at(-1)).toEqual({ type: 'denied', count: 2 })
    const meta = details.find((detail) => detail.type === 'meta')
    expect(meta).toMatchObject({ meta: { model: 'claude-sonnet-5-5', inputTokens: 2112, outputTokens: 420, cacheReadTokens: 1000, costUsd: 0.0213, consulted: ['m-plan'] } })
    expect(log.filter((entry) => entry.event === 'permission').map((entry) => [entry.tool, entry.outcome])).toEqual([
      ['Read', 'allow'],
      ['Read', 'allow'],
      ['Grep', 'allow'],
      ['Write', 'reject'],
    ])
    expect(log.find((entry) => entry.event === 'read-outside')).toMatchObject({ refused: true })
    expect(log.find((entry) => entry.event === 'terminal')).toMatchObject({ refused: true, code: -32601 })
    expect(log.find((entry) => entry.method === 'session/new')).toMatchObject({ configOptions: [{ configId: 'mode', value: 'default' }, { configId: 'model', value: 'sonnet' }] })

    // A segunda pergunta vai na mesma sessão, sem o histórico.
    await ask(chat, 'E depois?')
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
    expect(log.filter((entry) => entry.method === 'session/prompt').map((entry) => entry.history)).toEqual([false, false])
    chat.kill()
  })

  it('"Parar" manda session/cancel e a sessão segue viva; trocar o modelo e "Pensar mais" usam a mesma sessão', async () => {
    const log: LogEntry[] = []
    const { launch } = memory(fake(log, 20))
    const chat = new AcpChat({ open: opener(launch), model: 'haiku', thinkMore: false, scope: 'all', cwd: corpus })
    const pending = chat.ask('Responda devagar', [], () => undefined)
    while (!log.some((entry) => entry.event === 'permission')) await new Promise((resolve) => setTimeout(resolve, 5))
    chat.stop()
    expect(await pending).toMatchObject({ ok: false, error: 'stopped' })
    expect(log.some((entry) => entry.method === 'session/cancel')).toBe(true)
    expect(chat.alive).toBe(true)

    expect(chat.configure('opus', true)).toBe(true)
    const { answer } = await ask(chat, 'De novo')
    expect(answer.text).toContain('Modelo: opus')
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
    expect(log.filter((entry) => entry.method === 'session/set_config_option').map((entry) => [entry.configId, entry.value])).toEqual([
      ['model', 'opus'],
      ['effort', 'high'],
    ])
    chat.kill()
    expect(chat.alive).toBe(false)
  })

  it('adaptador que não sobe vira o erro `agent`; histórico vai na primeira pergunta de uma sessão nova', async () => {
    const broken = new AcpChat({
      open: opener(() => {
        throw new Error('ENOENT')
      }),
      model: 'haiku',
      thinkMore: false,
      scope: 'all',
      cwd: corpus,
    })
    expect(await broken.ask('Oi', [], () => undefined)).toEqual({ ok: false, error: 'agent', text: '' })

    const log: LogEntry[] = []
    const { launch, crash } = memory(fake(log))
    const chat = new AcpChat({ open: opener(launch), model: 'haiku', thinkMore: false, scope: 'all', cwd: corpus })
    await chat.ask('Primeira', [], () => undefined)
    crash()
    const again = await chat.ask('Segunda', [{ role: 'user', text: 'Primeira' }, { role: 'assistant', text: 'Resposta' }], () => undefined)
    expect(again.ok).toBe(true)
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(2)
    expect(log.filter((entry) => entry.method === 'session/prompt').map((entry) => entry.history)).toEqual([false, true])
    chat.kill()
  })

  it('3 min sem nenhum evento: tempo esgotado e o processo morre', async () => {
    const hang = memory(() =>
      acp
        .agent()
        .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
        .onRequest('session/new', () => ({ sessionId: 's', configOptions: MODE_DEFAULT }))
        .onRequest('session/prompt', () => new Promise(() => undefined)),
    )
    const chat = new AcpChat({ open: opener(hang.launch), model: 'haiku', thinkMore: false, scope: 'all', cwd: corpus, idleTimeoutMs: 30 })
    expect(await chat.ask('Oi', [], () => undefined)).toMatchObject({ ok: false, error: 'timeout' })
    expect(hang.links[0]?.killed).toBe(true)
  })

  it('passo a partir de kind e locations quando falta o nome', () => {
    expect(acpStepOf(claudeProfile, 't1', { kind: 'read', locations: ['/a/INDICE.md'] })).toEqual({ tool: 'Read', label: 'Lendo o índice das reuniões', meetingId: null, id: 't1', status: 'pending' })
    expect(acpStepOf(claudeProfile, 't2', { kind: 'search', title: 'Find `*.md`', locations: [], status: 'in_progress' })).toMatchObject({ tool: 'Glob', label: 'Listando arquivos', status: 'in_progress' })
    expect(acpStepOf(claudeProfile, 't3', { kind: 'edit', name: 'Write', locations: [] })).toBeNull()
  })
})

describe('tradução pelo ACP (CA4b)', () => {
  const request = (n: number, text = `trecho ${n}`) => ({ segmentId: `mic-${n}`, source: 'mic' as const, turnOrder: n, text })

  it('uma sessão por gravação, sem ferramentas, na pasta própria; traduz em ordem e troca a cada 40 trechos', async () => {
    const log: LogEntry[] = []
    const { launch } = memory(fake(log))
    const states: string[] = []
    const translator = new AcpTranslator({ open: opener(launch), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: corpus, onState: (state) => states.push(state), maxTurnsPerProcess: 2 })
    translator.start()
    const results = await Promise.all([translator.translate(request(0, 'Alguma dúvida <até> aqui?')), translator.translate(request(1)), translator.translate(request(2))])
    expect(results).toEqual([
      { ok: true, translation: '[EN] Alguma dúvida <até> aqui?', model: 'claude-cli:haiku' },
      { ok: true, translation: '[EN] trecho 1', model: 'claude-cli:haiku' },
      { ok: true, translation: '[EN] trecho 2', model: 'claude-cli:haiku' },
    ])
    const created = log.filter((entry) => entry.method === 'session/new')
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ purpose: 'translate', cwd: corpus, options: { tools: [], settingSources: [], model: 'haiku' } })
    await translator.stop()
    expect(states).toEqual(['running'])
  })

  it('contexto alto troca a sessão; processo que morre reabre; sem resposta em 10 s vira "timeout" e sessão nova', async () => {
    const log: LogEntry[] = []
    const { launch, links, crash } = memory(fake(log))
    const translator = new AcpTranslator({ open: opener(launch), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: corpus, maxContextTokens: 600, restartDelayMs: 5 })
    translator.start()
    await translator.translate(request(0))
    await translator.translate(request(1))
    // Cada trecho passou de 600 tokens em contexto: a sessão nova abre logo depois.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(3)

    // O processo morre: reabre uma vez (depois de 1 s; aqui 5 ms) e o trecho seguinte vai na sessão nova.
    crash()
    expect(translator.runState).toBe('restarting')
    expect(await translator.translate(request(2))).toMatchObject({ ok: true })
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(4)
    expect(translator.runState).toBe('running')
    translator.kill()
    expect(links.at(-1)?.killed).toBe(true)

    const hang = memory(() =>
      acp
        .agent()
        .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
        .onRequest('session/new', () => ({ sessionId: 's', configOptions: MODE_DEFAULT }))
        .onRequest('session/prompt', () => new Promise(() => undefined)),
    )
    const slow = new AcpTranslator({ open: opener(hang.launch), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: corpus, resultTimeoutMs: 20 })
    slow.start()
    expect(await slow.translate(request(0))).toEqual({ ok: false, error: 'timeout' })
    expect(hang.links[0]?.killed).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(hang.links.length).toBe(2)
    slow.kill()
  })

  it('morre outra vez antes de traduzir: tradução parada até o fim da gravação', async () => {
    let launches = 0
    const dead: LaunchAcp = () => {
      launches += 1
      throw new Error('ENOENT')
    }
    const states: string[] = []
    const translator = new AcpTranslator({ open: opener(dead), model: 'haiku', sourceLanguage: 'pt', targetLanguage: 'en', cwd: corpus, onState: (state) => states.push(state), restartDelayMs: 5 })
    translator.start()
    expect(await translator.translate(request(0))).toEqual({ ok: false, error: 'stopped' })
    expect(launches).toBe(2)
    // Abrir falhou porque o adaptador não sobe: o aviso diz que o problema é o agente (H).
    expect(states.at(-1)).toBe('agent-failed')
  })
})

describe('resumo pelo ACP (CA4c)', () => {
  const input = summaryInput(['[00:01] Você: Vamos revisar a captura.', '[00:05] Participante A: Eu envio as notas.'])

  it('uma sessão curta, sem ferramentas; a resposta passa pela validação do resumo', async () => {
    const log: LogEntry[] = []
    const { launch, links } = memory(fake(log))
    const result = await runAcpSummary({ open: opener(launch), model: 'haiku', cwd: corpus, input })
    expect(result).toMatchObject({ ok: true, content: { tasks: [{ owner: 'Você' }, { owner: 'Participante A' }] } })
    expect(log.find((entry) => entry.method === 'session/new')).toMatchObject({ purpose: 'summary', options: { tools: [], settingSources: [] } })
    expect(log.find((entry) => entry.method === 'session/prompt')).toMatchObject({ chars: input.length })
    expect(links[0]?.killed).toBe(true)
  })

  it('JSON inválido é `format`; 3 min sem fim é `timeout` com cancelamento; cancelar é `failed`', async () => {
    const answering = (text: string) =>
      memory(() =>
        acp
          .agent()
          .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
          .onRequest('session/new', () => ({ sessionId: 's', configOptions: MODE_DEFAULT }))
          .onRequest('session/prompt', async (ctx) => {
            if (!text) return new Promise<never>(() => undefined)
            await ctx.client.notify('session/update', { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } })
            return { stopReason: 'end_turn' as const }
          }),
      )
    expect(await runAcpSummary({ open: opener(answering('não é JSON').launch), model: 'haiku', cwd: corpus, input })).toEqual({ ok: false, error: 'format' })
    const hang = answering('')
    expect(await runAcpSummary({ open: opener(hang.launch), model: 'haiku', cwd: corpus, input, timeoutMs: 30 })).toEqual({ ok: false, error: 'timeout' })
    expect(hang.links[0]?.killed).toBe(true)
    const abort = new AbortController()
    const cancelled = answering('')
    const pending = runAcpSummary({ open: opener(cancelled.launch), model: 'haiku', cwd: corpus, input, signal: abort.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    abort.abort()
    expect(await pending).toEqual({ ok: false, error: 'failed' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(cancelled.links[0]?.killed).toBe(true)
  })
})

describe('análise pelo ACP (contrato 19, CA2)', () => {
  const input = analysisInput(['[00:01] Você: Quando migramos?', '[00:05] Participante A: Talvez no fim do mês.'])
  const run = (open: ReturnType<typeof opener>, extra: { timeoutMs?: number } = {}) =>
    runAcpOneShot({ open, model: 'haiku', cwd: corpus, input, purpose: 'analysis', systemPrompt: analysisSystemPrompt(), parse: analysisParser(new Map()), label: 'análise', ...extra })

  it('sessão curta sem ferramentas; JSON entre cercas validado; custo do usage_update', async () => {
    const log: LogEntry[] = []
    const { launch, links } = memory(fake(log))
    const result = await run(opener(launch))
    expect(result).toMatchObject({ ok: true, costUsd: 0.0042, content: { openQuestions: [{ text: 'Quando migramos?', atMs: 1000 }], toConfirm: [{ owner: 'Participante A' }] } })
    expect(log.find((entry) => entry.method === 'session/new')).toMatchObject({ purpose: 'analysis', options: { tools: [], settingSources: [], systemPrompt: analysisSystemPrompt().split('\n')[0] } })
    expect(links[0]?.killed).toBe(true)
  })

  it('JSON inválido é `format`; sem fim no prazo é `timeout` com o processo encerrado', async () => {
    const answering = (text: string) =>
      memory(() =>
        acp
          .agent()
          .onRequest('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }))
          .onRequest('session/new', () => ({ sessionId: 's', configOptions: MODE_DEFAULT }))
          .onRequest('session/prompt', async (ctx) => {
            if (!text) return new Promise<never>(() => undefined)
            await ctx.client.notify('session/update', { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } })
            return { stopReason: 'end_turn' as const }
          }),
      )
    expect(await run(opener(answering('{"openQuestions": 3}').launch))).toEqual({ ok: false, error: 'format' })
    expect(await run(opener(answering('```json\n{"openQuestions": [{"text": "Ok?"}]}\n```').launch))).toMatchObject({ ok: true, content: { openQuestions: [{ text: 'Ok?' }], unclearTopics: [] } })
    const hang = answering('')
    expect(await run(opener(hang.launch), { timeoutMs: 30 })).toEqual({ ok: false, error: 'timeout' })
    expect(hang.links[0]?.killed).toBe(true)
  })
})

describe('Detalhes do WhatsApp pelo ACP (contrato 32)', () => {
  it('o agente falso reconhece o purpose novo pela instrução e devolve o JSON lido pelo parser, sem ferramentas', async () => {
    const log: LogEntry[] = []
    const { launch, links } = memory(fake(log))
    const input = insightsInput('Ana Souza', 'person', [{ id: 'a', chatId: '5511911110000@s.whatsapp.net', author: 'Ana Souza', fromMe: false, at: new Date(2026, 10, 16, 9).getTime(), type: 'text', text: 'Oi', media: null }], new Date(2026, 10, 18).getTime())
    const result = await runAcpOneShot({ open: opener(launch), model: 'haiku', cwd: corpus, input, purpose: 'whatsapp-insights', systemPrompt: insightsSystemPrompt(), parse: insightsParser, label: 'detalhes do WhatsApp' })
    expect(result).toMatchObject({ ok: true, costUsd: 0.0031, content: { humor: { valor: 'positivo' }, humorDias: [{ dia: '2026-11-16', valor: 'positivo' }] } })
    expect(log.find((entry) => entry.method === 'session/new')).toMatchObject({ purpose: 'whatsapp-insights', options: { tools: [], settingSources: [] } })
    expect(log.find((entry) => entry.method === 'session/prompt')).toMatchObject({ purpose: 'whatsapp-insights' })
    expect(links[0]?.killed).toBe(true)
    // Fora do chat, nenhuma permissão é concedida.
    expect(await permissionAllowed('whatsapp-insights', { kind: 'read', title: 'ler', locations: [], rawInput: {} } as never, corpus, corpus, { Read: 'read' })).toBe(false)
  })
})

describe('serviço do chat com o transporte trocado (CA2, CA7, CA8)', () => {
  it('pelo ACP grava passos com estado e plano; modelo e "Pensar mais" na mesma sessão; "Linha de comando" volta ao claude -p', async () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    const meetings = createFileMeetingsStore({ dir: data, newId: () => 'm-hoje' })
    const transcripts = createFileTranscriptStore({ dir: data })
    const summaries = createFileSummaryStore({ dir: data })
    const corpusStore = createChatCorpus({ dir: data, meetings, transcripts, summaries })
    const store = createFileChatStore({ dir: data })
    const log: LogEntry[] = []
    const { launch } = memory(fake(log))
    let settings: AppSettings = { ...DEFAULT_SETTINGS }
    const cliSpawns: string[][] = []
    const events: ChatEvent[] = []
    const service = createChatService({
      store,
      corpus: corpusStore,
      settings: { get: () => Promise.resolve(settings) },
      meetings,
      locate: () => Promise.resolve({ ok: true, path: '/Users/teste/.local/bin/claude', version: '2.1.325' }),
      spawn: (_file, args) => {
        cliSpawns.push([...args])
        throw new Error('sem processo no teste')
      },
      openAcp: () => opener(launch),
      baseEnv: { HOME: '/Users/teste' },
      onEvent: (event) => events.push(event),
      newId: () => 'c1',
    })
    await meetings.create({ title: 'Hoje', startedAt: new Date().toISOString(), durationMs: 1000, sources: { mic: true, system: false } })

    const sent = await service.send({ chatId: null, meetingId: null, text: 'O que foi decidido?' })
    expect(sent.ok).toBe(true)
    await service.settled('c1')
    const saved = await store.get('c1')
    const answer = saved?.messages.at(-1)
    expect(answer?.error).toBeUndefined()
    expect(answer?.steps?.map((step) => step.status)).toEqual(['completed', 'completed', 'completed'])
    expect(answer?.plan?.every((entry) => entry.status === 'completed')).toBe(true)
    expect(answer?.denied).toBe(2)
    expect(events.some((event) => event.type === 'plan')).toBe(true)

    // Modelo e "Pensar mais" trocados: mesma sessão, pelo protocolo.
    await service.update({ id: 'c1', model: 'opus', thinkMore: true })
    await service.send({ chatId: 'c1', meetingId: null, text: 'E agora?' })
    await service.settled('c1')
    expect(log.filter((entry) => entry.method === 'session/new')).toHaveLength(1)
    expect(log.filter((entry) => entry.method === 'session/set_config_option').map((entry) => entry.value)).toEqual(['opus', 'high'])
    expect((await store.get('c1'))?.thinkMore).toBe(true)

    // "Linha de comando": a próxima pergunta recomeça pelo `claude -p`.
    settings = { ...settings, claudeTransport: 'cli' }
    await service.send({ chatId: 'c1', meetingId: null, text: 'E pela linha de comando?' })
    await service.settled('c1')
    expect(cliSpawns).toHaveLength(1)
    expect(cliSpawns[0]).toContain('-p')
    service.dispose()
  })
})
