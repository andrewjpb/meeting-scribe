// Conectores do claude.ai na tela (contrato 58): o rótulo "Escrita" pelo nome da ferramenta (CA3), o registro de
// `settings.claudeConnectors` ao ligar, desligar e mudar a regra (CA1, CA3), a leitura das ferramentas pelo
// `mcpServerStatus` do `claude` no modo de controle (CA3) e o índice da busca. Só o `claude` falso
// (test/fixtures/fake-claude.mjs), nenhuma rede.
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecFile } from '../src/main/claude-cli/locate'
import type { SpawnSummary } from '../src/main/claude-cli/summary'
import { createMcpCli } from '../src/main/mcp/cli'
import { CONNECTOR_TOOLS_ARGS, connectorStatusesOf, readConnectorTools } from '../src/main/mcp/connector-tools'
import { createMcpService } from '../src/main/mcp/service'
import { createMcpStore } from '../src/main/mcp/store'
import { parseSettings, parseSettingsPatch } from '../src/main/settings/schema'
import { memorySafeStorage } from '../src/main/secrets'
import { CLAUDE_CONNECTORS_DESCRIPTION, claudeConnectorEnabledNotice, connectorFirstEnable, mcpToolSuggestsWrite, withConnectorEnabled, withConnectorPolicy } from '../src/shared/mcp'
import { settingsIndex } from '../src/shared/settings-index'

const FAKE_CLAUDE = join(__dirname, 'fixtures', 'fake-claude.mjs')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conectores-tela-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** O `claude` falso pelo Node deste processo; guarda os argumentos de cada processo aberto. */
function fakeProcesses(env: NodeJS.ProcessEnv = {}): { exec: ExecFile; spawn: SpawnSummary; spawned: string[][] } {
  const spawned: string[][] = []
  const exec: ExecFile = (file, args, options) =>
    new Promise((resolve, reject) => {
      if (file !== FAKE_CLAUDE) {
        reject(new Error('não existe'))
        return
      }
      execFile(process.execPath, [FAKE_CLAUDE, ...args], { timeout: options.timeoutMs, env: { ...options.env, ...env }, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve({ stdout })))
    })
  const spawnFake: SpawnSummary = (file, args, options) => {
    if (file !== FAKE_CLAUDE) throw new Error('não existe')
    spawned.push([...args])
    return spawn(process.execPath, [FAKE_CLAUDE, ...args], { ...options, env: { ...options.env, ...env } })
  }
  return { exec, spawn: spawnFake, spawned }
}

function service(env: NodeJS.ProcessEnv = {}) {
  const cliFile = join(dir, 'claude.json')
  writeFileSync(cliFile, JSON.stringify({ mcpServers: {} }))
  const processes = fakeProcesses({ FAKE_CLAUDE_MCP_FILE: cliFile, ...env })
  let clock = 1_000_000
  const mcp = createMcpService({
    store: createMcpStore({ dir, safeStorage: memorySafeStorage() }),
    cli: createMcpCli({ exec: processes.exec, spawn: processes.spawn, baseEnv: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, configFile: cliFile, cwd: join(dir, 'cwd') }),
    locate: async () => ({ ok: true, path: FAKE_CLAUDE, version: '2.1.325' }),
    desktopConfig: join(dir, 'nao-existe.json'),
    baseEnv: {},
    loginPath: async () => '/usr/bin',
    now: () => clock,
  })
  return { mcp, spawned: processes.spawned, advance: (ms: number) => void (clock += ms) }
}

describe('rótulo "Escrita" (CA3)', () => {
  it('pelas palavras do nome: send, create, delete, update', () => {
    expect(['create-pages', 'update-page', 'delete-comment', 'gmail_send_message', 'createEvent', 'notion-update-data-source'].every(mcpToolSuggestsWrite)).toBe(true)
    expect(['search', 'fetch', 'notion-get-users', 'read_file_content', 'updated', 'resend', 'sender'].some(mcpToolSuggestsWrite)).toBe(false)
  })
})

describe('registro dos conectores (CA1, CA3)', () => {
  it('ligar cria a entrada e marca "já ligado"; desligar mantém as regras e a marca; "Perguntar" não fica guardado', () => {
    const on = withConnectorEnabled({}, 'Notion', true)
    expect(on).toEqual({ Notion: { enabled: true, everEnabled: true, tools: {} } })
    const denied = withConnectorPolicy(on, 'Notion', 'delete-comment', 'deny')
    expect(denied).toEqual({ Notion: { enabled: true, everEnabled: true, tools: { 'delete-comment': 'deny' } } })
    expect(withConnectorEnabled(denied, 'Notion', false)).toEqual({ Notion: { enabled: false, everEnabled: true, tools: { 'delete-comment': 'deny' } } })
    expect(withConnectorPolicy(denied, 'Notion', 'delete-comment', 'ask')).toEqual({ Notion: { enabled: true, everEnabled: true, tools: {} } })
  })

  it('regra num conector nunca ligado não o liga nem o marca; a chave é o nome como o Claude o chama', () => {
    expect(withConnectorPolicy({ Gmail: { enabled: false, tools: {} } }, 'Google Drive', 'criar arquivo', 'allow')).toEqual({ Gmail: { enabled: false, tools: {} }, 'Google Drive': { enabled: false, tools: { criar_arquivo: 'allow' } } })
  })

  it('CA2: a primeira vez é a primeira vez LIGADO, mesmo com a entrada criada por uma regra', () => {
    expect(connectorFirstEnable({}, 'Notion')).toBe(true)
    // Regra escolhida com o conector desligado: a entrada existe, e ligar ainda é a primeira vez.
    const ruled = withConnectorPolicy({}, 'Notion', 'delete-comment', 'deny')
    expect(connectorFirstEnable(ruled, 'Notion')).toBe(true)
    const on = withConnectorEnabled(ruled, 'Notion', true)
    const off = withConnectorEnabled(on, 'Notion', false)
    expect(connectorFirstEnable(off, 'Notion')).toBe(false)
    // Entrada ligada gravada antes do campo (contrato 57): já foi ligada.
    expect(connectorFirstEnable({ Notion: { enabled: true, tools: {} } }, 'Notion')).toBe(false)
  })

  it('o aviso de uma linha do CA2', () => {
    expect(claudeConnectorEnabledNotice('Notion')).toBe('O agente poderá usar o Notion da sua conta do claude.ai. Cada ferramenta pergunta antes, até você mudar.')
  })
})

describe('ferramentas pelo mcpServerStatus (CA3)', () => {
  it('lê só os conectores, com o nome sem o prefixo, e corta o que vier de fora', () => {
    const statuses = connectorStatusesOf({
      mcpServers: [
        { name: 'claude.ai Notion', status: 'connected', tools: [{ name: 'notion-search', annotations: { readOnly: true } }, { name: 'notion-search' }, { name: 7 }, { name: 'x\u0007y', description: 'linha\ncom quebra' }] },
        { name: 'claude.ai Gmail', status: 'needs-auth' },
        { name: 'timesheet', status: 'connected', tools: [{ name: 'horas' }] },
      ],
    })
    expect(statuses).toEqual([
      {
        name: 'Notion',
        status: 'connected',
        tools: [
          { name: 'notion-search', description: '' },
          { name: 'x y', description: 'linha com quebra' },
        ],
      },
      { name: 'Gmail', status: 'needs-auth', tools: [] },
    ])
    expect(connectorStatusesOf({ commands: [] })).toBeNull()
    expect(connectorStatusesOf(null)).toBeNull()
  })

  it('o `claude` no modo de controle: espera o conector sair de "pending"; nenhuma pergunta vai ao modelo', async () => {
    const processes = fakeProcesses()
    const statuses = await readConnectorTools({ spawn: processes.spawn, claudePath: FAKE_CLAUDE, env: { PATH: process.env['PATH'] ?? '' }, cwd: dir, names: new Set(['Notion']), pollMs: 20 })
    expect(processes.spawned).toEqual([[...CONNECTOR_TOOLS_ARGS]])
    expect(CONNECTOR_TOOLS_ARGS).not.toContain('-p')
    expect(CONNECTOR_TOOLS_ARGS).not.toContain('--strict-mcp-config')
    expect(statuses.map((status) => `${status.name}=${status.status}:${status.tools.length}`)).toEqual(['Notion=connected:5', 'Google Drive=connected:3', 'Gmail=needs-auth:0'])
    expect(statuses[0]?.tools.map((tool) => tool.name)).toEqual(['search', 'fetch', 'create-pages', 'update-page', 'delete-comment'])
  })

  it('o serviço: só conector conectado; uma leitura serve todos por 5 min', async () => {
    const { mcp, spawned, advance } = service()
    await mcp.overview({ cli: true })
    const notion = await mcp.connectorTools({ name: 'Notion' })
    expect(notion.ok && notion.tools.length).toBe(5)
    const drive = await mcp.connectorTools({ name: 'Google Drive' })
    expect(drive.ok && drive.tools.map((tool) => tool.name)).toEqual(['search_files', 'read_file_content', 'create_file'])
    expect(spawned).toHaveLength(1)
    advance(5 * 60_000 + 1)
    await mcp.connectorTools({ name: 'Notion' })
    expect(spawned).toHaveLength(2)
    expect(await mcp.connectorTools({ name: 'Gmail' })).toEqual({ ok: false, error: 'O conector não está conectado.' })
    expect(await mcp.connectorTools({ name: 'Figma' })).toEqual({ ok: false, error: 'Conector não encontrado.' })
    expect(await mcp.connectorTools({ name: 42 })).toEqual({ ok: false, error: 'Pedido inválido.' })
    expect(spawned).toHaveLength(2)
  })

  it('leitura compartilhada: o conector pedido durante a leitura de outro, mais lento, espera a mesma leitura', async () => {
    const { mcp, spawned } = service({ FAKE_CLAUDE_SLOW_CONNECTOR: 'Google Drive' })
    await mcp.overview({ cli: true })
    const [notion, drive] = await Promise.all([mcp.connectorTools({ name: 'Notion' }), mcp.connectorTools({ name: 'Google Drive' })])
    expect(notion.ok && notion.tools.length).toBe(5)
    expect(drive.ok && drive.tools.length).toBe(3)
    expect(spawned).toHaveLength(1)
  })

  it('"Atualizar" e a mudança de conector limpam as ferramentas guardadas', async () => {
    const { mcp, spawned } = service()
    await mcp.overview({ cli: true })
    await mcp.connectorTools({ name: 'Notion' })
    await mcp.overview({ cli: true, refresh: true })
    await mcp.connectorTools({ name: 'Notion' })
    expect(spawned).toHaveLength(2)
    mcp.invalidateConnectors()
    await mcp.connectorTools({ name: 'Notion' })
    expect(spawned).toHaveLength(3)
  })

  it('sem login por assinatura: a lista vem vazia com o motivo (CA4) e nada é lido', async () => {
    const { mcp, spawned } = service({ FAKE_CLAUDE_AUTH: 'api-key' })
    expect((await mcp.overview({ cli: true })).connectors).toEqual({ connectors: [], reason: 'no-subscription' })
    expect(await mcp.connectorTools({ name: 'Notion' })).toEqual({ ok: false, error: 'Conector não encontrado.' })
    expect(spawned).toHaveLength(0)
  })
})

describe('settings.claudeConnectors com "já ligado" (CA2)', () => {
  it('o arquivo antigo (sem o campo) carrega igual; o campo novo grava e volta', () => {
    expect(parseSettings({ claudeConnectors: { Notion: { enabled: false, tools: { fetch: 'deny' } } } }).claudeConnectors).toEqual({ Notion: { enabled: false, tools: { fetch: 'deny' } } })
    expect(parseSettings({ claudeConnectors: { Notion: { enabled: false, everEnabled: true, tools: {} } } }).claudeConnectors).toEqual({ Notion: { enabled: false, everEnabled: true, tools: {} } })
    expect(parseSettingsPatch({ claudeConnectors: withConnectorEnabled({}, 'Notion', true) })).toEqual({ claudeConnectors: { Notion: { enabled: true, everEnabled: true, tools: {} } } })
    expect(() => parseSettingsPatch({ claudeConnectors: { Notion: { enabled: true, everEnabled: 'sim', tools: {} } } })).toThrow()
  })
})

describe('índice da busca', () => {
  it('a linha da seção, por último na aba Conexões', () => {
    const rows = settingsIndex('Claude').filter((entry) => entry.tab === 'conexoes')
    expect(rows.at(-1)).toMatchObject({ section: 'Conectores do claude.ai', name: 'Conectores da sua conta', description: CLAUDE_CONNECTORS_DESCRIPTION })
  })
})
