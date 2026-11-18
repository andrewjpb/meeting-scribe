// Perfil de agente (contrato 17, CA11): tudo o que é próprio de um agente ACP fica aqui atrás, para o app
// ligar outros agentes (Gemini CLI, Codex) só criando perfis novos. O código comum (`agent.ts`, chat,
// tradução e resumo) só fala com o perfil: como instalar, como subir, o `session/new` com o isolamento, a
// conferência do modo seguro, os modelos e o "Pensar mais", os nomes das ferramentas de leitura e a leitura
// de uso e custo.
import type * as acp from '@agentclientprotocol/sdk/unstable'
import type { AgentProfileId } from '../../../shared/settings-defaults'
import type { AcpPackage } from '../install'

export type AcpPurpose = 'chat' | 'translate' | 'summary' | 'analysis' | 'draft' | 'ai-notes' | 'whatsapp-insights'

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
}

/** Tipo de passo que a tela mostra (o vocabulário do app, não o do agente). */
export type StepTool = 'Read' | 'Grep' | 'Glob' | 'WebSearch' | 'WebFetch'

/** O que se sabe de uma chamada de ferramenta pelos `tool_call`/`tool_call_update` da sessão. */
export interface KnownToolCall {
  name?: string | undefined
  kind?: string | undefined
  title?: string | undefined
  status?: string | undefined
  locations: string[]
  rawInput?: unknown
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
  /** `session/new` com o isolamento: sem configurações pessoais, só leitura (ou nada), sem MCP. */
  newSession(request: AcpSessionRequest): acp.NewSessionRequest
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
