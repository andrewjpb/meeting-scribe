// Prova com o `claude` real (contrato 57, CA7), fora dos gates: só roda com `ACP_LIVE_CONNECTORS=1`. Usa o adaptador de
// verdade (o do `node_modules` do app), o `claude` instalado neste Mac logado por assinatura e o serviço do app lendo
// `claude mcp list` de verdade. Liga só o conector A (`CONECTOR_A`, padrão "Notion") e deixa o B (`CONECTOR_B`, padrão
// "Claude Docs") desligado, abre uma sessão de chat como a do Assistente e confere:
// 1. a conferência estrutural pelo `/mcp` (o status dos servidores, `mcpServerStatus` do adaptador, sem chamar o
//    modelo), depois da espera que a própria abertura faz: A conectado e liberado, B carregado mas bloqueado, nada fora;
// 2. opcional: as ferramentas `mcp__…` que o modelo diz ter;
// 3. uma busca em A (só leitura) abre o cartão "claude.ai <A>"; a resposta é "Permitir uma vez".
// Nunca chama ferramenta de escrita. Imprime o que chegou.
//
// Uso: ACP_LIVE_CONNECTORS=1 pnpm --filter @meeting-scribe/desktop exec vitest run --disableConsoleIntercept test/conectores-live.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acpOpener, processLauncher, type AgentProfile } from '../src/main/acp/agent'
import { blockedServersOf, connectorVerdict } from '../src/main/acp/connectors'
import { bundledAdapterEntry } from '../src/main/acp/entry'
import { claudeProfile } from '../src/main/acp/profiles/claude'
import { locateClaude, nodeExecFile } from '../src/main/claude-cli/locate'
import { createMcpCli } from '../src/main/mcp/cli'
import { createMcpService } from '../src/main/mcp/service'
import { createMcpStore } from '../src/main/mcp/store'
import { memorySafeStorage } from '../src/main/secrets'
import { claudeConnectorToolServer, type McpApproval } from '../src/shared/mcp'

const A = process.env['CONECTOR_A'] ?? 'Notion'
const B = process.env['CONECTOR_B'] ?? 'Claude Docs'
/** Diagnóstico: o log do `claude` (`--debug-file`) e parar depois do `/mcp` (sem chamar o modelo). */
const DEBUG_FILE = process.env['CONECTORES_DEBUG_FILE']
const ONLY_STATUS = process.env['CONECTORES_SO_STATUS'] === '1'
const profile: AgentProfile = DEBUG_FILE
  ? {
      ...claudeProfile,
      newSession: (request, local) => {
        const params = claudeProfile.newSession(request, local)
        const options = (params._meta as { claudeCode: { options: { extraArgs: Record<string, string | null> } } }).claudeCode.options
        options.extraArgs = { ...options.extraArgs, 'debug-file': DEBUG_FILE }
        return params
      },
    }
  : claudeProfile

describe.skipIf(!process.env['ACP_LIVE_CONNECTORS'])('conectores do claude.ai com o claude real (contrato 57, CA7)', () => {
  it('A ligado aparece e abre o cartão; B desligado fica fora da sessão', { timeout: 600_000 }, async () => {
    const found = await locateClaude({ configuredPath: null, home: homedir(), exec: nodeExecFile, baseEnv: process.env })
    expect(found.ok, 'claude não encontrado').toBe(true)
    if (!found.ok) return
    const root = mkdtempSync(join(tmpdir(), 'conectores-live-'))
    writeFileSync(join(root, 'INDICE.md'), '# Índice das reuniões\n\n(nenhuma reunião)\n')
    const mcp = createMcpService({
      store: createMcpStore({ dir: join(root, 'user-data'), safeStorage: memorySafeStorage() }),
      cli: createMcpCli({ exec: nodeExecFile, baseEnv: process.env, configFile: join(homedir(), '.claude.json'), cwd: join(root, 'mcp') }),
      locate: async () => found,
      desktopConfig: join(root, 'nao-existe.json'),
      baseEnv: process.env,
      loginPath: async () => process.env['PATH'] ?? '/usr/bin:/bin',
      connectorPrefs: async () => ({ [A]: { enabled: true, tools: {} }, [B]: { enabled: false, tools: {} } }),
    })
    const overview = await mcp.overview({ cli: true })
    const states = overview.connectors.connectors.map((connector) => `${connector.name}=${connector.state}`)
    console.log(`[live] conectores: ${states.join(', ')} (motivo: ${String(overview.connectors.reason)})`)
    expect(overview.connectors.connectors.find((connector) => connector.name === A)?.state).toBe('connected')
    expect(overview.connectors.connectors.find((connector) => connector.name === B)?.state).toBe('connected')
    const set = await mcp.sessionConnectors()
    expect(set?.enabled.map((connector) => connector.name)).toEqual([A])
    const request = { purpose: 'chat' as const, cwd: root, model: 'haiku', systemPrompt: 'Você é um assistente de teste. Responda curto, em português.', tools: 'read' as const, mcp: { off: [] } }
    const options = (claudeProfile.newSession({ ...request, connectors: set ?? undefined })._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options
    console.log(`[live] strictMcpConfig=${String(options['strictMcpConfig'])} disallowedTools=${JSON.stringify(options['disallowedTools'])} settings=${JSON.stringify(options['settings'])}`)
    const open = acpOpener({
      profile: () => profile,
      launch: processLauncher({ execPath: process.execPath, entry: bundledAdapterEntry(claudeProfile, process.cwd()), log: (message) => console.log(message) }),
      baseEnv: process.env,
      mcp: { servers: async () => [], connectors: () => mcp.sessionConnectors() },
      log: (message) => console.log(message),
    })(found.path)
    const started = Date.now()
    const opened = await open(request)
    console.log(`[live] sessão: ${opened.ok ? 'aberta' : `falhou (${opened.error}: ${opened.reason})`} em ${Date.now() - started} ms`)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const session = opened.session
    const ask = async (text: string, onApproval?: (approval: McpApproval) => Promise<'once' | 'deny'>) => {
      let answer = ''
      const notices: string[] = []
      let denied = 0
      const outcome = await session.prompt(text, {
        onUpdate: (update) => {
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') answer += update.content.text
          const meta = (update as { _meta?: Record<string, unknown> })._meta
          if (meta && JSON.stringify(meta).includes('mcpServerStatus')) notices.push(JSON.stringify(meta))
        },
        onDenied: () => void (denied += 1),
        ...(onApproval ? { onApproval } : {}),
      })
      return { answer, notices, denied, outcome }
    }
    try {
      // 1. A conferência do app (feita ao abrir): a lista da sessão pelo `/mcp`, sem chamar o modelo. Prova estrutural:
      // A conectado e liberado; B carregado (o conector desligado ainda conecta), mas bloqueado pelo servidor inteiro; nada
      // fora do bloqueio.
      const entries = (await session.mcpStatus()) ?? []
      console.log(`[live] /mcp: ${entries.map((entry) => `${entry.name}=${entry.status}`).join(', ')}`)
      console.log(`[live] avisos da sessão: ${JSON.stringify(session.notices)}`)
      const blocked = blockedServersOf(session.sentDisallowedTools)
      const verdict = connectorVerdict(entries, session.connectors?.enabled ?? [], session.passedMcpNames(), blocked)
      console.log(`[live] fora do bloqueio: ${JSON.stringify(verdict.surprises)}; ligados sem conectar: ${JSON.stringify(verdict.pending.map((entry) => entry.name))}`)
      expect(entries.find((entry) => entry.name === `claude.ai ${A}`)?.status).toBe('connected')
      expect(blocked.has(claudeConnectorToolServer(A))).toBe(false)
      expect(entries.some((entry) => entry.name === `claude.ai ${B}`)).toBe(true)
      expect(blocked.has(claudeConnectorToolServer(B))).toBe(true)
      expect(verdict.surprises).toEqual([])
      if (ONLY_STATUS) return
      // 2. Opcional (`CONECTORES_PERGUNTAR_FERRAMENTAS=1`): as ferramentas que o modelo diz ter.
      if (process.env['CONECTORES_PERGUNTAR_FERRAMENTAS'] === '1') {
        const tools = await ask('Sem chamar nenhuma ferramenta: liste os nomes exatos de TODAS as ferramentas disponíveis nesta sessão cujo nome começa com "mcp__", uma por linha, sem comentário.')
        console.log(`[live] ferramentas mcp__ que o modelo vê:\n${tools.answer}`)
        expect(tools.answer).toContain(`mcp__${claudeConnectorToolServer(A)}__`)
        expect(tools.answer).not.toContain(`mcp__${claudeConnectorToolServer(B)}__`)
      }
      // 3. Uma busca em A: o cartão abre com o nome "claude.ai <A>".
      const approvals: McpApproval[] = []
      const search = await ask(`Use a ferramenta de busca do conector ${A} para procurar a palavra "reunião" e diga só quantos resultados vieram. Não use nenhuma outra ferramenta.`, async (approval) => {
        approvals.push(approval)
        console.log(`[live] cartão: ${approval.server} · ${approval.tool} · ${approval.args.replace(/\s+/g, ' ').slice(0, 200)}`)
        return 'once'
      })
      console.log(`[live] busca: ${JSON.stringify(search.outcome)} negadas=${search.denied} resposta: ${search.answer.slice(0, 300)}`)
      for (const [id, call] of session.knownToolCalls()) console.log(`[live] ferramenta ${id}: ${call.name ?? '?'} ${call.status ?? '?'}`)
      expect(approvals.length).toBeGreaterThan(0)
      expect(approvals[0]?.server).toBe(`claude.ai ${A}`)
    } finally {
      session.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
