// Chat "Perguntar" sobre as reuniões (contrato 15): o que o renderer e o main trocam. O `claude` roda só no
// main, numa pasta só de leitura com as reuniões em Markdown; o renderer manda a pergunta e recebe a
// resposta enquanto ela é escrita.

/** Até 200 mensagens por conversa; acima disso as mais antigas saem. */
export const CHAT_MESSAGES_MAX = 200
/** Texto de cada mensagem: pergunta e resposta. */
export const CHAT_TEXT_MAX = 20_000
/** Título da conversa: a primeira pergunta, cortada. */
export const CHAT_TITLE_MAX = 80
/** Esquema dos links que citam uma reunião: `[título · dd/mm](meeting:<id>)`. */
export const MEETING_LINK_SCHEME = 'meeting:'

export type ChatRole = 'user' | 'assistant'

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
}

export interface Chat {
  id: string
  /** Conversa da aba "Perguntar" de uma reunião; `null` na tela "Perguntar" (todas as reuniões). */
  meetingId: string | null
  title: string
  /** ISO 8601. */
  createdAt: string
  messages: ChatMessage[]
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

/** Resposta sendo escrita: o texto até agora e se o Claude está lendo os arquivos. */
export interface ChatProgress {
  text: string
  reading: boolean
}

/** main -> renderer: a resposta cresceu (`answer`) ou terminou e a conversa foi salva (`done`). */
export type ChatEvent = ({ type: 'answer'; chatId: string } & ChatProgress) | { type: 'done'; chatId: string; chat: Chat }

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
