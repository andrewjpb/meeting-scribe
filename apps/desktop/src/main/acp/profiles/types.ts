// Perfil de agente (contrato 17, CA11): tudo o que é próprio de um agente ACP fica aqui atrás, para o app
// ligar outros agentes (Gemini CLI, Codex) só criando perfis novos. O código comum (`agent.ts`, chat,
// tradução e resumo) só fala com o perfil: como instalar, como subir, o `session/new` com o isolamento, a
// conferência do modo seguro, os modelos e o "Pensar mais", os nomes das ferramentas de leitura e a leitura
// de uso e custo.
import type * as acp from '@agentclientprotocol/sdk/unstable'
import type { McpToolPolicy, McpTransport } from '../../../shared/mcp'
import type { NavegadorFerramenta } from '../../../shared/navegador-ferramentas'
import type { AgentProfileId } from '../../../shared/settings-defaults'
import type { AcpPackage } from '../install'

/**
 * Contrato 64: `invite-suggest`, o "Sugerir evento" do email (sem ferramenta, sem MCP, sem web). Contrato 111:
 * `funnel-extract`, a detecção de oportunidade no resumo da reunião (idem).
 */
export type AcpPurpose = 'chat' | 'translate' | 'summary' | 'analysis' | 'draft' | 'ai-notes' | 'whatsapp-insights' | 'whatsapp-correct' | 'invite-suggest' | 'funnel-extract'

/** O que a fábrica de sessões recebe (CA4d), sem nada do agente. */
export interface AcpSessionRequest {
  purpose: AcpPurpose
  /** Pasta da sessão: o acervo, a pasta de escopo da conversa ou uma pasta vazia própria. */
  cwd: string
  /** Modelo do app (`haiku`, `sonnet`, `opus`); o perfil traduz para o valor do agente. */
  model: string
  systemPrompt: string
  /** `read`: só as ferramentas de leitura e busca do agente (chat); `none`: nenhuma (tradução, resumo e análise). */
  tools: 'read' | 'none'
  /** "Pensar mais" (CA5), se o perfil tiver. */
  thinkMore?: boolean
  /**
   * Contrato 26: busca na web e páginas abertas, só no chat com as ferramentas de leitura (agentes e Assistente). A
   * política de permissão confere cada chamada (`web.ts`). Tradução, resumo e análise nunca recebem.
   */
  web?: boolean
  /**
   * Contrato 21: a sessão pode receber os servidores MCP ligados nas Configurações (só o chat das conversas e a análise;
   * as automações, a tradução e o resumo nunca pedem). `off`: os desligados nesta conversa.
   */
  mcp?: { off?: readonly string[] | undefined } | undefined
  /** Contrato 21: os servidores MCP desta sessão, resolvidos pela fábrica (o chamador não preenche). */
  mcpServers?: readonly AcpMcpServer[] | undefined
  /**
   * Contrato 57: os conectores do claude.ai desta sessão, resolvidos pela fábrica (o chamador não preenche). Só no chat
   * que pede `mcp`; sem nenhum, a sessão é a mesma de antes (com o modo estrito).
   */
  connectors?: AcpConnectorSet | undefined
  /**
   * Contrato 47: as ferramentas do navegador (o servidor MCP local `navegador`), só no chat com as ferramentas de
   * leitura. Quem liga é o Assistente, com "Ativar ponte" ligado e a extensão conectada ao abrir a sessão.
   */
  navegador?: boolean
  /** Contrato 47: a instrução sem o navegador, que vale se o servidor MCP do navegador não abrir para esta sessão. */
  systemPromptSemNavegador?: string
}

/**
 * Um servidor MCP de uma sessão (contrato 21), já com a definição do `session/new` (com os segredos, só no main), a
 * política de cada ferramenta e os valores a mascarar no cartão de aprovação.
 */
export interface AcpMcpServer {
  /** `app:<id>` ou `cli:<nome>`. */
  key: string
  /** Nome no agente: o das ferramentas `mcp__<nome>__<ferramenta>`. */
  name: string
  transport: McpTransport
  definition: acp.McpServer
  toolPolicy: Readonly<Record<string, McpToolPolicy>>
  secrets: readonly string[]
  /** "Sempre permitir esta ferramenta": grava a política `allow`. */
  allowAlways(tool: string): void
}

/** Contrato 57: um conector do claude.ai ligado. O `claude` sobe o conector sozinho (o login é dele); o app só aprova. */
export interface AcpConnector {
  /** "Notion". */
  name: string
  /** "claude.ai Notion": o nome no cartão de aprovação. */
  label: string
  /** O servidor no nome das ferramentas (`claude_ai_Notion`). */
  toolServer: string
  toolPolicy: Readonly<Record<string, McpToolPolicy>>
  /** "Sempre permitir esta ferramenta": grava a política `allow`. */
  allowAlways(tool: string): void
}

/**
 * Contrato 57: os conectores de uma sessão. Sem o modo estrito o `claude` sobe também o que o app não ligou: `others` são
 * os servidores (como no nome das ferramentas) que o perfil bloqueia, menos os que a sessão passa em `mcpServers`.
 */
export interface AcpConnectorSet {
  enabled: readonly AcpConnector[]
  others: readonly string[]
}

/** Contrato 47: o servidor MCP local do navegador desta sessão, com o token dela. */
export interface AcpLocalMcp {
  navegador?: { url: string; token: string }
}

/**
 * Tipo de passo que a tela mostra (o vocabulário do app, não o do agente). `Mcp`: ferramenta de um servidor MCP;
 * contrato 47: as do navegador.
 */
export type StepTool = 'Read' | 'Grep' | 'Glob' | 'WebSearch' | 'WebFetch' | 'Mcp' | NavegadorFerramenta

/** O que se sabe de uma chamada de ferramenta pelos `tool_call`/`tool_call_update` da sessão. */
export interface KnownToolCall {
  name?: string | undefined
  kind?: string | undefined
  title?: string | undefined
  status?: string | undefined
  locations: string[]
  rawInput?: unknown
  /** Contrato 47: o começo do texto do resultado (a aba que o `navegador_abrir` abriu, o rótulo do clique). */
  output?: string | undefined
}

/** Opções da sessão aberta, como o perfil as confere. */
export interface SessionOptionsView {
  option(configId: string): string | boolean | null
  offers(configId: string, value: string): boolean
}

/** Uso e custo que o agente mandou num `usage_update`. */
export interface UsageReading {
  /** Modelo que respondeu, se o agente disser. */
  model: string | null
  /** Custo acumulado da sessão, em US$. */
  costUsd: number | null
  /** Tokens em contexto. */
  used: number | null
}

export interface AgentProfile {
  id: AgentProfileId
  /** Nome na tela: "Claude" ("Conexão com o Claude", "O agente do Claude não abriu."). */
  label: string
  /** Pacotes do npm pinados (com o sha512) e o script do agente dentro de `node_modules`. */
  install: { version: string; packages: readonly AcpPackage[]; entry: readonly string[] }
  /** Pacote do agente no `node_modules` do app (desenvolvimento). */
  bundledPackage: string
  /** Ambiente do agente: o do main filtrado e o executável do CLI que ele deve rodar. */
  env(baseEnv: NodeJS.ProcessEnv, cliPath: string): NodeJS.ProcessEnv
  /**
   * `session/new` com o isolamento: sem configurações pessoais, só leitura (ou nada), só os MCP do app (contrato 21).
   * Contrato 47: e o servidor local do navegador (`local`), quando a sessão pede e o app abriu um.
   */
  newSession(request: AcpSessionRequest, local?: AcpLocalMcp): acp.NewSessionRequest
  /** Depois de abrir: `null` se a sessão está no modo seguro; senão, o motivo. */
  unsafeMode(session: SessionOptionsView): string | null
  /** Ferramentas de leitura do agente pelo nome, com o tipo (`read` ou `search`). */
  readTools: Readonly<Record<string, 'read' | 'search'>>
  /** O passo da tela a partir da chamada: o tipo e a entrada com `file_path`, `pattern` e `path`. */
  stepOf(call: KnownToolCall): { tool: StepTool; input: Record<string, unknown> } | null
  /** Valor da opção de modelo do agente para o modelo do app. */
  modelConfig: { configId: string; value(model: string): string }
  /** "Pensar mais": a opção e os valores ligado/desligado; `null` se o agente não tiver. */
  thinkMore: { configId: string; on: string; off: string } | null
  /** Uso e custo de um `usage_update`. */
  usage(update: acp.UsageUpdate): UsageReading
}
