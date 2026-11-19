// Servidores MCP no agente (contrato 21): o cadastro com os segredos cifrados (CA1), os servidores do Claude CLI pelo
// `claude` falso (CA0), "Testar conexão" contra o servidor MCP falso por stdio e por HTTP (CA3), o `session/new` com os
// servidores (CA4), a aprovação de cada ferramenta (CA5) e o isolamento do ambiente (CA7). Nenhum `claude` de verdade e
// nenhuma rede além de 127.0.0.1.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openAcpSession, type AcpLink, type AcpMcpServer, type AcpSessionRequest, type LaunchAcp } from '../src/main/acp/agent'
import { AcpChat } from '../src/main/acp/chat'
import { CLAUDE_DISALLOWED_TOOLS, claudeProfile } from '../src/main/acp/profiles/claude'
import type { ExecFile } from '../src/main/claude-cli/locate'
import { cliDetails, createMcpCli, definitionOf, parseMcpList } from '../src/main/mcp/cli'
import { mcpProcessEnv, testMcpServer } from '../src/main/mcp/client'
import { createMcpService, findExecutable } from '../src/main/mcp/service'
import { createMcpStore, MCP_CLI_ENABLED_FILE, MCP_SERVERS_FILE } from '../src/main/mcp/store'
import { chatScopeSchema } from '../src/main/chat/store'
import { memorySafeStorage } from '../src/main/secrets'
import type { ChatDetail } from '../src/shared/chat'
import { maskSecrets, MCP_NAME_PATTERN, mcpToolKey, mcpToolOf, mcpUrlAllowed, parseMcpJson } from '../src/shared/mcp'
// @ts-expect-error o agente falso é um script .mjs sem tipos
import { fakeAcpAgent } from './fixtures/fake-acp-agent.mjs'

const FIXTURES = join(__dirname, 'fixtures')
const SERVER = join(FIXTURES, 'fake-mcp-server.mjs')
const FAKE_CLAUDE = join(FIXTURES, 'fake-claude.mjs')
const SECRET = 'segredo-do-teste-4321'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** O `claude` falso: `claude` é o script, rodado pelo Node deste processo. */
const fakeExec: ExecFile = (file, args, { timeoutMs, env }) =>
  new Promise((resolve, reject) => {
    if (file !== FAKE_CLAUDE) {
      reject(new Error('não existe'))
      return
    }
    execFile(process.execPath, [FAKE_CLAUDE, ...args], { timeout: timeoutMs, env, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve({ stdout })))
  })

describe('regras compartilhadas', () => {
  it('endereço: https em qualquer lugar, http só no próprio Mac', () => {
    expect(mcpUrlAllowed('https://mcp.exemplo.com/mcp')).toBe(true)
    expect(mcpUrlAllowed('http://127.0.0.1:3000/mcp')).toBe(true)
    expect(mcpUrlAllowed('http://localhost:3000/mcp')).toBe(true)
    expect(mcpUrlAllowed('http://exemplo.com/mcp')).toBe(false)
    expect(mcpUrlAllowed('http://192.168.0.10/mcp')).toBe(false)
    expect(mcpUrlAllowed('https://usuario:senha@exemplo.com/')).toBe(false)
    expect(mcpUrlAllowed('file:///etc/passwd')).toBe(false)
  })

  it('nome do servidor sem `__` e sem `_` na ponta; regra pelo nome da ferramenta como o Claude a chama', () => {
    expect(['calc', 'calc-2', 'a_b'].every((name) => MCP_NAME_PATTERN.test(name))).toBe(true)
    expect(['a_', '_a', 'a__b', 'com espaço', ''].some((name) => MCP_NAME_PATTERN.test(name))).toBe(false)
    expect(mcpToolKey('arquivos.ler')).toBe('arquivos_ler')
  })

  it('nome da ferramenta MCP de volta ao servidor e à ferramenta', () => {
    expect(mcpToolOf('mcp__calculadora__soma')).toEqual({ server: 'calculadora', tool: 'soma' })
    expect(mcpToolOf('mcp__calc__apagar_tudo')).toEqual({ server: 'calc', tool: 'apagar_tudo' })
    expect(mcpToolOf('Read')).toBeNull()
    expect(mcpToolOf('mcp__semferramenta')).toBeNull()
  })

  it('JSON colado no formato do Claude Desktop: os valores entram como segredo', () => {
    const parsed = parseMcpJson(JSON.stringify({ mcpServers: { calc: { command: 'npx', args: ['-y', 'calc'], env: { TOKEN: 'abc' } }, remoto: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer z' } } } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.servers.map((server) => [server.name, server.transport])).toEqual([
      ['calc', 'stdio'],
      ['remoto', 'http'],
    ])
    expect(parsed.servers[0]?.env).toEqual([{ key: 'TOKEN', value: 'abc', secret: true }])
    expect(parseMcpJson('não é json').ok).toBe(false)
    expect(parseMcpJson('{"a": 1}').ok).toBe(false)
  })

  it('o escopo da conversa guarda os servidores desligados nela (CA6), sem repetir', () => {
    expect(chatScopeSchema.parse({ kind: 'all', mcpOff: ['cli:calc', 'cli:calc', 'app:id-1'] })).toEqual({ kind: 'all', mcpOff: ['cli:calc', 'app:id-1'] })
    expect(chatScopeSchema.parse({ kind: 'all', mcpOff: [] })).toEqual({ kind: 'all' })
    expect(chatScopeSchema.safeParse({ kind: 'all', mcpOff: ['outra:coisa'] }).success).toBe(false)
  })

  it('mascara os segredos no texto', () => {
    expect(maskSecrets(`{"token": "${SECRET}"}`, [SECRET, 'ab'])).toBe('{"token": "••••"}')
  })
})

describe('cadastro do app (CA1)', () => {
  it('segredo só cifrado no disco; volta decifrado só no main; arquivo inválido vale como vazio', async () => {
    const store = createMcpStore({ dir, safeStorage: memorySafeStorage() })
    await store.save({
      id: 's1',
      name: 'calc',
      transport: 'stdio',
      command: '/bin/echo',
      args: ['a'],
      cwd: null,
      env: [
        { key: 'TOKEN', value: SECRET, secret: true },
        { key: 'MODO', value: 'teste', secret: false },
      ],
      url: null,
      headers: [],
      enabled: false,
      uses: ['chat'],
      toolPolicy: {},
      source: 'manual',
      tools: [],
      lastTest: null,
    })
    const raw = readFileSync(join(dir, MCP_SERVERS_FILE), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).toContain('"cipher"')
    expect(raw).toContain('"teste"')
    expect((await store.list())[0]?.env).toEqual([
      { key: 'TOKEN', value: SECRET, secret: true },
      { key: 'MODO', value: 'teste', secret: false },
    ])
    writeFileSync(join(dir, MCP_SERVERS_FILE), '{"quebrado"')
    expect(await store.list()).toEqual([])
  })

  it('do Claude CLI guarda só o nome, os usos e a política', async () => {
    const store = createMcpStore({ dir, safeStorage: memorySafeStorage() })
    await store.setCli('calculadora', { uses: ['chat'], toolPolicy: { apagar_tudo: 'deny' } })
    expect(JSON.parse(readFileSync(join(dir, MCP_CLI_ENABLED_FILE), 'utf8'))).toEqual({ version: 1, servers: { calculadora: { uses: ['chat'], toolPolicy: { apagar_tudo: 'deny' } } } })
    await store.setCli('calculadora', null)
    expect(await store.cliEnabled()).toEqual({})
  })
})

describe('Claude CLI (CA0)', () => {
  it('lê a saída de claude mcp list (Claude Code 2.1.325)', () => {
    const out = [
      'Checking MCP server health…',
      '',
      'claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected',
      'calculadora: npx -y calc - ✔ Connected',
      'remoto: https://x.example/mcp (HTTP) - ✘ Failed to connect — HTTP 404: Error POSTing - erro',
      'plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication',
      'projeto: node s.js - ⏸ Pending approval',
    ].join('\n')
    expect(parseMcpList(out)).toEqual([
      { name: 'claude.ai Notion', transport: 'http', health: 'connected' },
      { name: 'calculadora', transport: 'stdio', health: 'connected' },
      { name: 'remoto', transport: 'http', health: 'failed' },
      { name: 'plugin:design:slack', transport: 'http', health: 'needs-auth' },
      { name: 'projeto', transport: 'stdio', health: 'pending' },
    ])
  })

  it('"Ver detalhes": só as linhas que interessam, variáveis e cabeçalhos mascarados', () => {
    const definition = definitionOf({ type: 'stdio', command: '/bin/x', args: [`--token=${SECRET}`], env: { TOKEN: SECRET } })
    const lines = cliDetails(['calc:', '  Scope: User config', '  Status: ✔ Connected', '  Type: stdio', `  Command: /bin/x`, `  Args: --token=${SECRET}`, '  Environment:', `    TOKEN=${SECRET}`].join('\n'), definition)
    expect(JSON.stringify(lines)).not.toContain(SECRET)
    expect(lines).toContainEqual({ label: 'Argumentos', value: '--token=••••' })
    expect(lines).toContainEqual({ label: 'Variável', value: 'TOKEN=••••' })
  })

  it('adicionar e remover pelo app gravam no CLI (sem shell, escopo user)', async () => {
    const file = join(dir, 'claude.json')
    writeFileSync(file, JSON.stringify({ mcpServers: {} }))
    const cli = createMcpCli({ exec: fakeExec, baseEnv: process.env, configFile: file, cwd: join(dir, 'cwd'), extraEnv: { FAKE_CLAUDE_MCP_FILE: file } })
    await cli.add(FAKE_CLAUDE, 'calc', { transport: 'stdio', command: '/bin/echo', args: ['a b', '$(rm -rf ~)'], env: { TOKEN: SECRET }, url: null, headers: {} })
    expect((await cli.definitions()).get('calc')).toEqual({ transport: 'stdio', command: '/bin/echo', args: ['a b', '$(rm -rf ~)'], env: { TOKEN: SECRET }, url: null, headers: {} })
    expect(await cli.list(FAKE_CLAUDE)).toContainEqual({ name: 'calc', transport: 'stdio', health: 'connected' })
    await cli.remove(FAKE_CLAUDE, 'calc')
    expect((await cli.definitions()).has('calc')).toBe(false)
  })
})

/** O servidor MCP falso por HTTP, numa porta livre de 127.0.0.1. */
async function httpServer(token: string): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [SERVER, '--http', '--token', token], { stdio: ['ignore', 'pipe', 'ignore'] })
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      const match = /PORT (\d+)/.exec(chunk)
      if (match) resolve(Number(match[1]))
    })
    child.on('exit', () => reject(new Error('saiu')))
  })
  return { url: `http://127.0.0.1:${port}/mcp`, child }
}

describe('"Testar conexão" (CA3) e o ambiente do processo (CA7)', () => {
  it('stdio: initialize e tools/list; o processo recebe só as variáveis cadastradas, PATH, HOME e LANG', async () => {
    const log = join(dir, 'env.log')
    const result = await testMcpServer(
      { transport: 'stdio', command: process.execPath, args: [SERVER], cwd: dir, env: { FAKE_MCP_ENV_LOG: log, TOKEN: SECRET }, url: null, headers: {} },
      { path: '/usr/bin:/bin', baseEnv: { HOME: '/Users/teste', LANG: 'pt_BR.UTF-8', ASSEMBLYAI_API_KEY: 'chave-do-app', ELECTRON_RUN_AS_NODE: '1' } },
    )
    expect(result).toEqual({
      ok: true,
      tools: [
        { name: 'soma', description: 'Soma dois números.' },
        { name: 'apagar_tudo', description: 'Apaga todos os arquivos (falso: nunca apaga nada).' },
      ],
    })
    const names = JSON.parse(readFileSync(log, 'utf8').trim()) as string[]
    expect(names.filter((name) => !name.startsWith('__CF') && name !== 'SHLVL' && name !== 'PWD' && name !== '_')).toEqual(['FAKE_MCP_ENV_LOG', 'HOME', 'LANG', 'PATH', 'TOKEN'])
    expect(mcpProcessEnv({ A: '1' }, '/p', { HOME: '/h', SECRET: 'x' })).toEqual({ PATH: '/p', HOME: '/h', A: '1' })
  })

  it('stdio: comando que sai na hora vira erro curto', async () => {
    const result = await testMcpServer({ transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(3)'], cwd: null, env: {}, url: null, headers: {} }, { path: '/usr/bin', baseEnv: {} })
    expect(result).toEqual({ ok: false, error: 'o processo saiu antes de responder (código 3)' })
  })

  it('stdio: sem resposta no prazo', async () => {
    const result = await testMcpServer({ transport: 'stdio', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], cwd: null, env: {}, url: null, headers: {} }, { path: '/usr/bin', baseEnv: {}, timeoutMs: 300 })
    expect(result).toEqual({ ok: false, error: 'sem resposta em 0 s' })
  })

  it('HTTP: com o cabeçalho, lista as ferramentas (resposta em JSON e em SSE); sem ele, 401', async () => {
    const { url, child } = await httpServer(SECRET)
    try {
      const ok = await testMcpServer({ transport: 'http', command: null, args: [], cwd: null, env: {}, url, headers: { Authorization: `Bearer ${SECRET}` } }, { path: '', baseEnv: {} })
      expect(ok.ok && ok.tools.map((tool) => tool.name)).toEqual(['soma', 'apagar_tudo'])
      const refused = await testMcpServer({ transport: 'http', command: null, args: [], cwd: null, env: {}, url, headers: {} }, { path: '', baseEnv: {} })
      expect(refused).toEqual({ ok: false, error: 'o servidor recusou o acesso (HTTP 401); confira os cabeçalhos' })
      const blocked = await testMcpServer({ transport: 'http', command: null, args: [], cwd: null, env: {}, url: 'http://exemplo.com/mcp', headers: {} }, { path: '', baseEnv: {} })
      expect(blocked).toEqual({ ok: false, error: 'endereço não permitido' })
    } finally {
      child.kill()
    }
  })

  it('o comando tem de existir e ser executável', async () => {
    expect(await findExecutable(process.execPath, '')).toBe(process.execPath)
    expect(await findExecutable('sh', '/bin:/usr/bin')).toMatch(/\/sh$/)
    expect(await findExecutable('comando-que-nao-existe', '/bin:/usr/bin')).toBeNull()
    expect(await findExecutable('./relativo', '/bin')).toBeNull()
  })
})

/** O serviço com o `claude` falso, o arquivo dele e o do Claude Desktop numa pasta temporária. */
function service() {
  const cliFile = join(dir, 'claude.json')
  const desktopFile = join(dir, 'claude_desktop_config.json')
  writeFileSync(
    cliFile,
    JSON.stringify({
      mcpServers: {
        calculadora: { type: 'stdio', command: process.execPath, args: [SERVER], env: { CALC_TOKEN: SECRET } },
        remoto: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: `Bearer ${SECRET}` } },
      },
    }),
  )
  writeFileSync(desktopFile, JSON.stringify({ mcpServers: { 'arquivos desktop': { command: process.execPath, args: [SERVER], env: { API_KEY: SECRET } } } }))
  const store = createMcpStore({ dir: join(dir, 'user'), safeStorage: memorySafeStorage() })
  const logins = { count: 0 }
  const mcp = createMcpService({
    store,
    cli: createMcpCli({ exec: fakeExec, baseEnv: process.env, configFile: cliFile, cwd: join(dir, 'cwd'), extraEnv: { FAKE_CLAUDE_MCP_FILE: cliFile } }),
    locate: async () => ({ ok: true, path: FAKE_CLAUDE, version: '2.1.312' }),
    desktopConfig: desktopFile,
    baseEnv: { HOME: '/Users/teste', PATH: '/usr/bin:/bin' },
    loginPath: async () => {
      logins.count += 1
      return '/login/bin:/usr/bin'
    },
    newId: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
  })
  return { mcp, store, cliFile, logins }
}

describe('serviço (CA0 a CA4)', () => {
  it('lista o CLI na hora, liga um para o chat e a sessão lê a definição agora (com o segredo, só no main)', async () => {
    const { mcp, cliFile } = service()
    const overview = await mcp.overview({ cli: true })
    expect(overview.cli.servers.map((server) => [server.name, server.usable, server.enabled])).toEqual([
      ['calculadora', true, false],
      ['remoto', true, false],
      ['plugin:design:slack', false, false],
    ])
    // Contrato 57: o conector do claude.ai sai da lista do CLI (não é mais "não usável") e vai para a lista própria.
    expect(overview.connectors).toEqual({ connectors: [{ name: 'Notion', toolServer: 'claude_ai_Notion', state: 'connected' }], reason: null })
    expect(JSON.stringify(overview)).not.toContain(SECRET)
    expect(await mcp.sessionServers('chat', [])).toEqual([])
    await mcp.update({ key: 'cli:calculadora', enabled: true })
    // Mudou no CLI depois de ligar: a sessão vê o de agora.
    const changed = JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, { args: string[] }> }
    changed.mcpServers['calculadora']?.args.push('--rodada-2')
    writeFileSync(cliFile, JSON.stringify(changed))
    const [session] = await mcp.sessionServers('chat', [])
    expect(session?.definition).toEqual({ name: 'calculadora', command: process.execPath, args: [SERVER, '--rodada-2'], env: [{ name: 'PATH', value: '/login/bin:/usr/bin' }, { name: 'CALC_TOKEN', value: SECRET }] })
    expect(await mcp.sessionServers('analysis', [])).toEqual([])
    expect(await mcp.sessionServers('chat', ['cli:calculadora'])).toEqual([])
    // "Sempre permitir": grava a política.
    session?.allowAlways('soma')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await mcp.overview({})).cli.servers[0]?.toolPolicy).toEqual({ soma: 'allow' })
  })

  it('o agente sem HTTP: o servidor HTTP fica de fora da sessão e aparece como não suportado', async () => {
    const { mcp } = service()
    await mcp.overview({ cli: true })
    await mcp.update({ key: 'cli:remoto', enabled: true })
    mcp.agentCapabilities({ http: false, sse: false })
    expect(await mcp.sessionServers('chat', [])).toEqual([])
    expect(await mcp.chatServers()).toEqual([{ key: 'cli:remoto', name: 'remoto', unavailable: 'não suportado por este agente' }])
  })

  it('adicionar: "Salvar" só depois de testar a mesma definição; no CLI por add-json; nome repetido recusado', async () => {
    const { mcp, cliFile } = service()
    await mcp.overview({ cli: true })
    const draft = { target: 'cli' as const, name: 'calc2', transport: 'stdio' as const, command: process.execPath, args: [SERVER], env: [{ key: 'TOKEN', value: SECRET, secret: true }] }
    expect(await mcp.save(draft)).toEqual({ ok: false, error: 'Teste a conexão antes de salvar.' })
    expect((await mcp.test({ draft })).ok).toBe(true)
    expect(await mcp.save({ ...draft, args: [SERVER, 'outro'] })).toEqual({ ok: false, error: 'Teste a conexão antes de salvar.' })
    const saved = await mcp.save(draft)
    expect(saved.ok).toBe(true)
    // No CLI, chega desligado para o app.
    expect(saved.ok && saved.overview.cli.servers.find((server) => server.name === 'calc2')?.enabled).toBe(false)
    expect((JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers['calc2']).toEqual({ type: 'stdio', command: process.execPath, args: [SERVER], env: { TOKEN: SECRET } })
    expect(JSON.stringify(saved)).not.toContain(SECRET)
    const repeated = await mcp.test({ draft: { ...draft, name: 'calculadora' } })
    expect(repeated.ok).toBe(true)
    expect(await mcp.save({ ...draft, name: 'calculadora' })).toEqual({ ok: false, error: 'Já existe um servidor do Claude CLI com este nome.' })
    expect(await mcp.test({ draft: { ...draft, command: 'comando-que-nao-existe' } })).toEqual({ ok: false, error: 'Comando não encontrado ou sem permissão de execução: comando-que-nao-existe' })
    expect(await mcp.test({ draft: { target: 'app', name: 'web', transport: 'http', url: 'http://exemplo.com/mcp' } })).toEqual({
      ok: false,
      error: 'Endereço não permitido: use https://, ou http:// só no próprio Mac (127.0.0.1 ou localhost).',
    })
  })

  it('só no app: nasce desligado; o segredo volta como "definido" e a edição mantém o guardado', async () => {
    const { mcp } = service()
    const draft = { target: 'app' as const, name: 'calc-app', transport: 'stdio' as const, command: process.execPath, args: [SERVER], env: [{ key: 'TOKEN', value: SECRET, secret: true }] }
    await mcp.test({ draft })
    const saved = await mcp.save(draft)
    expect(saved.ok && saved.overview.app[0]?.env).toEqual([{ key: 'TOKEN', value: null, secret: true, defined: true }])
    expect(saved.ok && saved.overview.app[0]?.state).toEqual({ kind: 'off' })
    const id = saved.ok ? (saved.overview.app[0]?.id ?? '') : ''
    expect(await mcp.sessionServers('chat', [])).toEqual([])
    const on = await mcp.update({ key: `app:${id}`, enabled: true })
    expect(on?.app[0]?.state).toEqual({ kind: 'connected', tools: 2 })
    const edit = { ...draft, id, uses: ['chat' as const, 'analysis' as const], env: [{ key: 'TOKEN', value: '', secret: true, keep: true }] }
    await mcp.test({ draft: edit })
    expect((await mcp.save(edit)).ok).toBe(true)
    const [session] = await mcp.sessionServers('analysis', [])
    expect(session?.definition).toEqual({ name: 'calc-app', command: process.execPath, args: [SERVER], env: [{ name: 'PATH', value: '/login/bin:/usr/bin' }, { name: 'TOKEN', value: SECRET }] })
    expect(session?.secrets).toEqual([SECRET])
  })

  it('importar do Claude Desktop: só no app sem os segredos, desligado; para o CLI com a definição inteira', async () => {
    const { mcp, cliFile } = service()
    const overview = await mcp.overview({ cli: true })
    expect(overview.found).toEqual([{ id: 'claude-desktop:arquivos desktop', source: 'claude-desktop', sourceLabel: 'Claude Desktop', name: 'arquivos desktop', transport: 'stdio', command: process.execPath.split('/').pop(), url: null, envKeys: ['API_KEY'], headerKeys: [] }])
    const app = await mcp.importFound({ id: 'claude-desktop:arquivos desktop', target: 'app' })
    expect(app.ok && app.overview.app[0]).toMatchObject({ name: 'arquivos-desktop', enabled: false, source: 'import', env: [{ key: 'API_KEY', value: null, secret: true, defined: false }] })
    expect(JSON.stringify(app)).not.toContain(SECRET)
    const cli = await mcp.importFound({ id: 'claude-desktop:arquivos desktop', target: 'cli' })
    expect(cli.ok).toBe(true)
    expect((JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, { env: unknown }> }).mcpServers['arquivos-desktop-2']?.env).toEqual({ API_KEY: SECRET })
  })

  it('sem nenhum ligado, a sessão nem lê o shell de login; regra gravada pelo nome normalizado', async () => {
    const { mcp, logins } = service()
    await mcp.overview({ cli: true })
    expect(await mcp.sessionServers('chat', [])).toEqual([])
    expect(logins.count).toBe(0)
    await mcp.update({ key: 'cli:calculadora', enabled: true })
    await mcp.update({ key: 'cli:calculadora', tool: 'arquivos.ler', policy: 'deny' })
    expect((await mcp.sessionServers('chat', []))[0]?.toolPolicy).toEqual({ arquivos_ler: 'deny' })
  })

  it('endereço http de outra máquina no CLI: não dá para usar, nem na sessão', async () => {
    const { mcp, cliFile, store } = service()
    const data = JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, unknown> }
    data.mcpServers['remoto'] = { type: 'http', url: 'http://192.168.0.9/mcp' }
    writeFileSync(cliFile, JSON.stringify(data))
    const overview = await mcp.overview({ cli: true })
    expect(overview.cli.servers.find((server) => server.name === 'remoto')?.usable).toBe(false)
    await store.setCli('remoto', { uses: ['chat'], toolPolicy: {} })
    expect(await mcp.sessionServers('chat', [])).toEqual([])
  })

  it('erro do servidor sem o segredo; servidor que saiu do CLI leva junto o "Usar no app" e as regras', async () => {
    const { mcp, cliFile, store } = service()
    await mcp.overview({ cli: true })
    const data = JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, { args?: string[] }> }
    data.mcpServers['calculadora'] = { type: 'stdio', command: process.execPath, args: ['-e', `console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'token ${SECRET} recusado' } }))`], env: { T: SECRET } } as never
    writeFileSync(cliFile, JSON.stringify(data))
    const result = await mcp.test({ key: 'cli:calculadora' })
    expect(result).toEqual({ ok: false, error: 'o servidor respondeu com erro (token •••• recusado)' })
    await store.setCli('calculadora', { uses: ['chat'], toolPolicy: { soma: 'allow' } })
    delete (data.mcpServers as Record<string, unknown>)['calculadora']
    writeFileSync(cliFile, JSON.stringify(data))
    await mcp.overview({ cli: true, refresh: true })
    expect(await store.cliEnabled()).toEqual({})
  })

  it('remover do CLI roda claude mcp remove e desliga no app', async () => {
    const { mcp, cliFile } = service()
    await mcp.overview({ cli: true })
    await mcp.update({ key: 'cli:calculadora', enabled: true })
    const removed = await mcp.remove({ key: 'cli:calculadora' })
    expect(removed.ok && removed.overview.cli.servers.map((server) => server.name)).toEqual(['remoto', 'plugin:design:slack'])
    expect((JSON.parse(readFileSync(cliFile, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers['calculadora']).toBeUndefined()
    expect(await mcp.sessionServers('chat', [])).toEqual([])
  })
})

/** Liga o agente falso na memória (um "processo" por sessão). */
function memory(log: Record<string, unknown>[]): LaunchAcp {
  return () => {
    const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>()
    const connection = (fakeAcpAgent({ log: (entry: Record<string, unknown>) => log.push(entry), pause: 0 }) as acp.AgentApp).connect({ writable: toClient.writable, readable: toAgent.readable })
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

const calcServer = (policy: AcpMcpServer['toolPolicy'] = {}, always: string[] = []): AcpMcpServer => ({
  key: 'cli:calculadora',
  name: 'calculadora',
  transport: 'stdio',
  definition: { name: 'calculadora', command: '/bin/calc', args: [], env: [{ name: 'CALC_TOKEN', value: SECRET }] },
  toolPolicy: policy,
  secrets: [SECRET],
  allowAlways: (tool) => void always.push(tool),
})

describe('sessão do agente com MCP (CA4, CA5)', () => {
  it('session/new: só os do app, a regra "ask" por servidor e as negadas em disallowedTools; sem servidor, igual ao contrato 17', () => {
    const request: AcpSessionRequest = { purpose: 'chat', cwd: '/c', model: 'sonnet', systemPrompt: 'x', tools: 'read' }
    const plain = claudeProfile.newSession(request)
    expect(plain.mcpServers).toEqual([])
    expect((plain._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options['settings']).toBeUndefined()
    const withMcp = claudeProfile.newSession({ ...request, mcpServers: [calcServer({ apagar_tudo: 'deny' })] })
    const options = (withMcp._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options
    expect(withMcp.mcpServers).toEqual([calcServer().definition])
    expect(options['strictMcpConfig']).toBe(true)
    expect(options['settingSources']).toEqual([])
    expect(options['disallowedTools']).toEqual([...CLAUDE_DISALLOWED_TOOLS, 'mcp__calculadora__apagar_tudo'])
    expect(options['settings']).toEqual({ permissions: { ask: ['mcp__calculadora'] } })
    // Tradução e resumo nunca recebem.
    expect(claudeProfile.newSession({ ...request, purpose: 'translate', tools: 'none', mcpServers: [calcServer()] }).mcpServers).toEqual([])
    expect(claudeProfile.newSession({ ...request, purpose: 'summary', tools: 'none', mcpServers: [calcServer()] }).mcpServers).toEqual([])
  })

  it('"Perguntar": o cartão com os argumentos mascarados; "Permitir uma vez" conclui o passo; "Negar" (política) nega sem cartão', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const open = (request: AcpSessionRequest) => openAcpSession({ ...request, mcpServers: [calcServer({ apagar_tudo: 'deny' })] }, { profile: claudeProfile, launch: memory(log), env: {} })
    const chat = new AcpChat({ open, model: 'sonnet', thinkMore: false, scope: 'all', cwd, mcp: { off: [] } })
    const details: ChatDetail[] = []
    const answer = chat.ask('some 2 e 3 e depois apague tudo', [], () => undefined, (detail) => {
      details.push(detail)
      if (detail.type === 'approval') setTimeout(() => chat.answerApproval(detail.approval.id, 'once'), 5)
    })
    const result = await answer
    expect(result).toEqual({ ok: true, text: 'A soma deu 5.\n\nNão pude usar apagar_tudo: o app negou.' })
    const approvals = details.filter((detail) => detail.type === 'approval')
    expect(approvals).toEqual([{ type: 'approval', approval: { id: 'mcp-1', server: 'calculadora', tool: 'soma', args: '{\n  "a": 2,\n  "b": 3\n}' } }])
    expect(details).toContainEqual({ type: 'approval-done', id: 'mcp-1', decision: 'once' })
    const steps = details.flatMap((detail) => (detail.type === 'step' ? [detail.step] : []))
    expect(steps.at(-1)).toMatchObject({ tool: 'Mcp', label: 'Usando apagar_tudo (calculadora)', status: 'failed' })
    expect(steps.find((step) => step.label === 'Usando soma (calculadora)' && step.status === 'completed')).toBeDefined()
    expect(log.filter((entry) => entry['event'] === 'mcp').map((entry) => [entry['tool'], entry['outcome']])).toEqual([
      ['soma', 'allow'],
      ['apagar_tudo', 'reject'],
    ])
    // O registro do agente falso não leva o valor do segredo.
    expect(JSON.stringify(log)).not.toContain(SECRET)
    chat.kill()
  })

  it('"Sempre permitir" grava a política; sem resposta em 2 min, nega', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const always: string[] = []
    const open = (request: AcpSessionRequest) => openAcpSession({ ...request, mcpServers: [calcServer({}, always)] }, { profile: claudeProfile, launch: memory(log), env: {}, approvalTimeoutMs: 50 })
    const chat = new AcpChat({ open, model: 'sonnet', thinkMore: false, scope: 'all', cwd, mcp: { off: [] } })
    const first = await chat.ask('some', [], () => undefined, (detail) => {
      if (detail.type === 'approval') setTimeout(() => chat.answerApproval(detail.approval.id, 'always'), 5)
    })
    expect(first.ok && first.text).toBe('A soma deu 5.')
    expect(always).toEqual(['soma'])
    // Na mesma sessão, a soma já não pergunta; o apagar (sem resposta) vence em 50 ms e é negado.
    const details: ChatDetail[] = []
    const second = await chat.ask('some e apague', [], () => undefined, (detail) => details.push(detail))
    expect(second.ok && second.text).toBe('A soma deu 5.\n\nNão pude usar apagar_tudo: o app negou.')
    expect(details.filter((detail) => detail.type === 'approval').map((detail) => detail.type === 'approval' && detail.approval.tool)).toEqual(['apagar_tudo'])
    expect(details).toContainEqual({ type: 'approval-done', id: 'mcp-2', decision: 'deny' })
    chat.kill()
  })

  it('sem quem pergunte (análise): "Perguntar" nega', async () => {
    const log: Record<string, unknown>[] = []
    const cwd = join(dir, 'c')
    mkdirSync(cwd)
    const opened = await openAcpSession({ purpose: 'chat', cwd, model: 'sonnet', systemPrompt: 'x', tools: 'read', mcpServers: [calcServer()] }, { profile: claudeProfile, launch: memory(log), env: {} })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let text = ''
    await opened.session.prompt('some', { onUpdate: (update) => void (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? (text += update.content.text) : undefined) })
    expect(text).toBe('Não pude usar soma: o app negou.')
    opened.session.close()
  })
})
