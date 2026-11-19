// Perfil do Claude (contrato 17, CA11): o adaptador oficial `@agentclientprotocol/claude-agent-acp`, que
// roda o `claude` já instalado pelo Claude Agent SDK.
//
// O que foi conferido no código do adaptador 0.107.0:
// - `_meta.claudeCode.options` é espalhado por cima do padrão dele: `settingSources: []` vence o
//   `["user","project","local"]` e o Agent SDK passa `--setting-sources ""` ao `claude` (sem hooks, sem
//   `CLAUDE.md`, sem permissões do usuário); `tools`, `disallowedTools`, `systemPrompt`, `strictMcpConfig`,
//   `persistSession`, `promptSuggestions` e `allowDangerouslySkipPermissions` são respeitados; `extraArgs` é
//   juntado aos dele e o SDK passa `{ restricted: null }` como `--restricted`;
// - `options.model` não decide o modelo (o adaptador usa `ANTHROPIC_MODEL` ou o `model` do `settings.json`
//   do usuário): por isso o modelo vai também em `configOptions`, aplicado depois da criação;
// - o modo de permissão inicial seria "auto" ou o `defaultMode` do usuário: o `configOptions` pede "default"
//   e a sessão só vale se o modo confirmado for "default";
// - o esforço é a opção `effort` (categoria `thought_level`, níveis por modelo);
// - o `usage_update` traz o custo acumulado e o modelo em `_meta["_claude/model"]`.
//
// Contrato 26 (internet), conferido no adaptador 0.107.0 e no `claude` 2.1.325: `WebSearch` e `WebFetch` chegam
// como `tool_call` com `name`, `kind: "fetch"`, título `Search "<consulta>"` / `Fetch <url>` e `rawInput` com
// `query` / `url`; o resultado da busca volta no `tool_call_update` como uma linha "Título (url)" por resultado. Os
// dois passam pelo `session/request_permission`, a não ser o `WebFetch` de uns sites de documentação que o `claude`
// abre sem perguntar ("preapproved hosts"); uma regra `ask` em `settings.permissions` é conferida antes dessa lista e
// faz ele perguntar sempre.
//
// Contrato 21 (MCP), conferido no adaptador 0.107.0: os `mcpServers` do `session/new` viram o `mcpServers` do Agent SDK
// (stdio `{ command, args, env }`; HTTP e SSE `{ type, url, headers }`; outro transporte fica de fora) e vão ao `claude`
// por `--mcp-config`; com `strictMcpConfig: true`, só esses valem (nem os do `~/.claude.json` nem os de `.mcp.json`), e
// `settingSources: []` continua deixando as configurações pessoais de fora. O `initialize` anuncia
// `mcpCapabilities: { http: true, sse: true }`. `tools` só escolhe as ferramentas embutidas: as do MCP chegam pelos
// servidores, com o nome `mcp__<servidor>__<ferramenta>`, e passam pelo `session/request_permission` (regra `ask` por
// servidor); as de política "Negar" vão também em `disallowedTools`.
import { mcpToolKey, mcpToolOf } from '../../../shared/mcp'
import { AGENT_PROFILE_LABELS } from '../../../shared/settings-defaults'
import { claudeEnv } from '../../claude-cli/locate'
import type { AcpPackage } from '../install'
import { webToolOf } from '../web'
import type { AgentProfile, KnownToolCall, StepTool } from './types'

/** Versão do adaptador: a pasta em `userData/acp/claude/`. */
export const CLAUDE_ADAPTER_VERSION = '0.107.0'

/**
 * A árvore que rodava no pacote (conferida com `npm view` e com o hash dos tarballs baixados em 16/11/2026):
 * o adaptador e as dependências de produção dele. Sem os binários do Claude Code por plataforma (o app usa
 * o `claude` instalado) nem as dependências opcionais do Agent SDK que o `sdk.mjs` não importa.
 */
export const CLAUDE_PACKAGES: readonly AcpPackage[] = [
  {
    name: '@agentclientprotocol/claude-agent-acp',
    version: CLAUDE_ADAPTER_VERSION,
    path: '@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.107.0.tgz',
    integrity: 'sha512-yOEYkKkomupue/lmkjlLy4C8ADlZ8ZZXX1ry3Ka6VTjtWHXowyoQ6+awjrfAc1Xkq3f37GA5fpTz9URyIfcb4g==',
    bytes: 781_152,
  },
  {
    name: '@agentclientprotocol/sdk',
    version: '2.6.0',
    path: '@agentclientprotocol/sdk/-/sdk-2.6.0.tgz',
    integrity: 'sha512-3FtL6MkAV5F9qxg0FQV8wmBszIm2xuVPoDWOILIFSDQ+Vq3Twdh7Cw6Hk2GOPUbevgrTUpUAqZXQy7Geaj79mw==',
    bytes: 829_765,
  },
  {
    name: '@anthropic-ai/claude-agent-sdk',
    version: '0.3.323',
    path: '@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.323.tgz',
    integrity: 'sha512-GXIczMzzceNWB+bIImK59hWOQoBWZtSw+AESPc/qbAWmmHM8Wrqb5KvTwWZ07CmjyC/KcPC47nOLxxyHlWqKPA==',
    bytes: 1_549_698,
  },
  {
    name: 'diff',
    version: '9.0.0',
    path: 'diff/-/diff-9.0.0.tgz',
    integrity: 'sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==',
    bytes: 152_500,
  },
  {
    name: 'zod',
    version: '4.6.7',
    path: 'zod/-/zod-4.6.7.tgz',
    integrity: 'sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==',
    bytes: 1_141_941,
  },
]

/** Ferramentas de leitura do Claude Code que o chat recebe. */
export const CLAUDE_READ_TOOLS = ['Read', 'Grep', 'Glob'] as const
/** Negadas por nome em toda sessão, além de nunca entrarem em `tools`: escrita, shell, rede e subagente. */
export const CLAUDE_DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'] as const
/** Contrato 26: a busca e a página, que saem da lista de negadas só na sessão com internet. */
export const CLAUDE_WEB_TOOLS = ['WebSearch', 'WebFetch'] as const
/** Nível de esforço de "Pensar mais"; "default" volta ao do modelo. */
export const CLAUDE_THINK_MORE_EFFORT = 'high'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Nome da ferramenta a partir do que o ACP manda (`name`, ou `kind` e o título). */
function toolName(call: KnownToolCall): StepTool | null {
  const web = webToolOf(call)
  if (web) return web
  const name = call.name ?? (call.kind === 'read' ? 'Read' : call.kind === 'search' ? (call.title?.startsWith('Find') ? 'Glob' : 'Grep') : null)
  return name === 'Read' || name === 'Grep' || name === 'Glob' ? name : null
}

export const claudeProfile: AgentProfile = {
  id: 'claude',
  label: AGENT_PROFILE_LABELS.claude,
  install: { version: CLAUDE_ADAPTER_VERSION, packages: CLAUDE_PACKAGES, entry: ['@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js'] },
  bundledPackage: '@agentclientprotocol/claude-agent-acp',
  // `claudeEnv` (sem nada do app) e o `claude` que o adaptador deve rodar.
  env: (baseEnv, cliPath) => ({ ...claudeEnv(baseEnv, cliPath), CLAUDE_CODE_EXECUTABLE: cliPath }),
  newSession: (request) => {
    // Contrato 26: só o chat com as ferramentas de leitura recebe a internet.
    const web = request.web === true && request.purpose === 'chat' && request.tools === 'read'
    // Contrato 21: os servidores MCP só no chat e na análise; sem nenhum, a sessão é a mesma do contrato 17.
    const mcp = request.purpose === 'chat' || request.purpose === 'analysis' ? (request.mcpServers ?? []) : []
    const mcpDenied = mcp.flatMap((server) => Object.entries(server.toolPolicy).flatMap(([tool, policy]) => (policy === 'deny' ? [`mcp__${server.name}__${mcpToolKey(tool)}`] : [])))
    const ask = [...(web ? CLAUDE_WEB_TOOLS : []), ...mcp.map((server) => `mcp__${server.name}`)]
    const disallowed = web ? CLAUDE_DISALLOWED_TOOLS.filter((tool) => !(CLAUDE_WEB_TOOLS as readonly string[]).includes(tool)) : [...CLAUDE_DISALLOWED_TOOLS]
    return {
      cwd: request.cwd,
      mcpServers: mcp.map((server) => server.definition),
      // Aplicadas na criação, em ordem; valor que o adaptador não oferece é ignorado por ele.
      configOptions: [
        { configId: 'mode', value: 'default' },
        { configId: 'model', value: request.model },
        ...(request.thinkMore ? [{ configId: 'effort', value: CLAUDE_THINK_MORE_EFFORT }] : []),
      ],
      _meta: {
        claudeCode: {
          options: {
            settingSources: [],
            tools: request.tools === 'read' ? [...CLAUDE_READ_TOOLS, ...(web ? CLAUDE_WEB_TOOLS : [])] : [],
            disallowedTools: [...disallowed, ...mcpDenied],
            // Toda busca, toda página e toda ferramenta MCP pedem permissão ao app, inclusive as que o `claude` liberaria sozinho.
            ...(ask.length ? { settings: { permissions: { ask } } } : {}),
            model: request.model,
            systemPrompt: request.systemPrompt,
            strictMcpConfig: true,
            // Sem transcrição da conversa em `~/.claude/projects` (a linha de comando usa `--no-session-persistence`).
            persistSession: false,
            // Sem a próxima pergunta prevista a cada resposta (custa tokens e o app não mostra).
            promptSuggestions: false,
            allowDangerouslySkipPermissions: false,
            extraArgs: { restricted: null },
          },
        },
      },
    }
  },
  unsafeMode: (session) => (session.option('mode') === 'default' ? null : `o agente não confirmou o modo de permissão "default" (${String(session.option('mode'))})`),
  readTools: { Read: 'read', Grep: 'search', Glob: 'search' },
  stepOf: (call) => {
    // Contrato 21: ferramenta de um servidor MCP ("Usando <ferramenta> (<servidor>)").
    const mcp = mcpToolOf(call.name)
    if (mcp) return { tool: 'Mcp', input: { server: mcp.server, tool: mcp.tool } }
    const tool = toolName(call)
    if (!tool) return null
    const input: Record<string, unknown> = isRecord(call.rawInput) ? { ...call.rawInput } : {}
    // Sem `file_path` ainda (a entrada chega em pedaços), o caminho do `locations` vale.
    if (tool === 'Read' && typeof input['file_path'] !== 'string' && call.locations[0]) input['file_path'] = call.locations[0]
    return { tool, input }
  },
  modelConfig: { configId: 'model', value: (model) => model },
  thinkMore: { configId: 'effort', on: CLAUDE_THINK_MORE_EFFORT, off: 'default' },
  usage: (update) => {
    const model = update._meta?.['_claude/model']
    return {
      model: typeof model === 'string' ? model : null,
      costUsd: update.cost && typeof update.cost.amount === 'number' ? update.cost.amount : null,
      used: typeof update.used === 'number' ? update.used : null,
    }
  },
}
