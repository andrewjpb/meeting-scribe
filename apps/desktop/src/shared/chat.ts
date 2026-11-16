// Chat "Perguntar" sobre as reuniões (contratos 15 e 16): o que o renderer e o main trocam. O `claude` roda
// só no main, numa pasta só de leitura com as reuniões em Markdown; o renderer manda a pergunta e recebe a
// resposta enquanto ela é escrita, com o raciocínio, os passos de leitura e os detalhes da resposta.
import type { ChatModel } from './settings-defaults'

/** Até 200 mensagens por conversa; acima disso as mais antigas saem. */
export const CHAT_MESSAGES_MAX = 200
/** Texto de cada mensagem: pergunta e resposta. */
export const CHAT_TEXT_MAX = 20_000
/** Título da conversa: a primeira pergunta, cortada. */
export const CHAT_TITLE_MAX = 80
/** Esquema dos links que citam uma reunião: `[título · dd/mm](meeting:<id>)`. */
export const MEETING_LINK_SCHEME = 'meeting:'

/** Raciocínio (`thinking`) guardado com cada resposta (contrato 16). */
export const CHAT_THINKING_MAX = 20_000
/** Passos de leitura guardados com cada resposta; acima disso os primeiros saem. */
export const CHAT_STEPS_MAX = 200
/** Rótulo de um passo. */
export const CHAT_STEP_LABEL_MAX = 200
/** "Reuniões escolhidas": até 50. */
export const CHAT_SCOPE_MEETINGS_MAX = 50
/** Contador do campo de pergunta aparece acima disto. */
export const CHAT_COUNTER_FROM = 2_000

export type ChatRole = 'user' | 'assistant'

/** Ferramentas de leitura que viram passo na tela. */
export const CHAT_STEP_TOOLS = ['Read', 'Grep', 'Glob'] as const
export type ChatStepTool = (typeof CHAT_STEP_TOOLS)[number]

/**
 * Um passo do Claude enquanto procura a resposta: "Lendo o índice das reuniões", "Abrindo «Planejamento»",
 * "Procurando "prazo"", "Listando arquivos". `meetingId` sai do nome do arquivo do acervo (que tem o id
 * inteiro); caminho de arquivo nunca chega à tela.
 */
export interface ChatStep {
  tool: ChatStepTool
  label: string
  meetingId: string | null
}

/** Detalhes da resposta, do `system/init` e do `result` do `claude` (contrato 16, CA1). */
export interface ChatMeta {
  /** Id do modelo que respondeu (`claude-sonnet-…`), do `system/init`. */
  model: string
  durationMs: number
  /** Tokens de entrada cobrados como entrada (inclui os que foram gravados no cache). */
  inputTokens: number
  outputTokens: number
  /** Tokens de entrada lidos do cache. */
  cacheReadTokens: number
  /** Custo nominal em US$ (sai do plano do Claude da pessoa). */
  costUsd: number
  turns: number
  /** Reuniões abertas pelo Claude nesta resposta, na ordem. */
  consulted: string[]
}

/** Escopo da conversa da tela "Perguntar": todas, últimos 7 ou 30 dias, ou as reuniões escolhidas. */
export const CHAT_SCOPE_KINDS = ['all', '7d', '30d', 'meetings'] as const
export type ChatScopeKind = (typeof CHAT_SCOPE_KINDS)[number]

export interface ChatScope {
  kind: ChatScopeKind
  /** Só em `meetings`. */
  meetingIds?: string[] | undefined
}

export const DEFAULT_CHAT_SCOPE: ChatScope = { kind: 'all' }

/**
 * `stopped`: a pessoa clicou em "Parar"; `timeout`: 3 min sem nenhum dado do processo; `failed`: o processo
 * morreu ou respondeu com erro; `not-found`: o `claude` não foi encontrado.
 */
export type ChatError = 'stopped' | 'timeout' | 'failed' | 'not-found'

export interface ChatMessage {
  role: ChatRole
  text: string
  /** ISO 8601. */
  at: string
  error?: ChatError | undefined
  /** Resposta: os passos de leitura, na ordem (contrato 16). */
  steps?: ChatStep[] | undefined
  /** Resposta: o raciocínio, quando o modelo mandou (texto puro, até 20 000 caracteres). */
  thinking?: string | undefined
  /** Resposta: ferramentas negadas. */
  denied?: number | undefined
  /** Resposta: modelo, tempo, tokens, custo e reuniões consultadas. */
  meta?: ChatMeta | undefined
  /** Modelo pedido (`--model`) quando a mensagem foi feita. */
  model?: ChatModel | undefined
}

export interface Chat {
  id: string
  /** Conversa da aba "Perguntar" de uma reunião; `null` na tela "Perguntar" (todas as reuniões). */
  meetingId: string | null
  title: string
  /** ISO 8601. */
  createdAt: string
  messages: ChatMessage[]
  /** Pasta que o `claude` lê; a conversa de uma reunião ignora (é sempre só ela). */
  scope: ChatScope
  /** Modelo da conversa; `null` (conversa do contrato 15) segue o "Modelo do chat" das Configurações. */
  model: ChatModel | null
}

/** Linha da lista de conversas. */
export interface ChatListItem {
  id: string
  meetingId: string | null
  title: string
  createdAt: string
  /** Hora da última mensagem (ou da criação). */
  updatedAt: string
}

export type ChatSendResult = { ok: true; chat: Chat } | { ok: false; error: 'not-found' | 'busy' | 'missing' }

/** Pergunta: nova conversa (`chatId: null`) leva o escopo e o modelo escolhidos na barra do campo. */
export interface ChatSendRequest {
  chatId: string | null
  meetingId: string | null
  text: string
  scope?: ChatScope | undefined
  model?: ChatModel | undefined
}

/** Renomear, trocar o escopo ou o modelo (vale para a próxima pergunta). */
export interface ChatUpdateRequest {
  id: string
  title?: string | undefined
  scope?: ChatScope | undefined
  model?: ChatModel | undefined
}

/**
 * "Refazer" e "Tentar de novo": a última resposta sai e a mesma pergunta vai de novo, num processo novo. Com
 * `text`, a última pergunta é trocada antes (↑ no campo vazio edita a última pergunta).
 */
export interface ChatRedoRequest {
  id: string
  text?: string | undefined
}

/** Resposta sendo escrita: o texto até agora e se o Claude está lendo os arquivos. */
export interface ChatProgress {
  text: string
  reading: boolean
}

/** O que acompanha a resposta além do texto (contrato 16, CA1). */
export type ChatDetail =
  /** Pedaço novo do raciocínio; quem recebe junta os pedaços na ordem. */
  | { type: 'thinking'; delta: string }
  | { type: 'step'; step: ChatStep }
  /** Ferramentas negadas até agora nesta resposta. */
  | { type: 'denied'; count: number }
  | { type: 'meta'; meta: ChatMeta }

/**
 * main -> renderer: a resposta cresceu (`answer`), o raciocínio, um passo, uma negação ou os detalhes
 * chegaram, ou ela terminou e a conversa foi salva (`done`).
 */
export type ChatEvent = ({ type: 'answer'; chatId: string } & ChatProgress) | ({ chatId: string } & ChatDetail) | { type: 'done'; chatId: string; chat: Chat }

/** Frase da tela para cada erro. */
export const CHAT_ERROR_TEXT: Readonly<Record<ChatError, string>> = {
  stopped: 'Resposta interrompida.',
  timeout: 'O Claude demorou demais.',
  failed: 'Não foi possível responder. Tente de novo.',
  'not-found': 'Configure o Claude CLI em Configurações.',
}

/** Título da conversa a partir da primeira pergunta: uma linha só, cortada em 80 caracteres. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  if (line.length <= CHAT_TITLE_MAX) return line
  return `${line.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…`
}

/** Id da reunião de um link `meeting:<id>`; `null` se não for um. */
export function meetingIdOfLink(href: string): string | null {
  if (!href.startsWith(MEETING_LINK_SCHEME)) return null
  const id = href.slice(MEETING_LINK_SCHEME.length).trim()
  return /^[\w-]{1,200}$/.test(id) ? id : null
}
