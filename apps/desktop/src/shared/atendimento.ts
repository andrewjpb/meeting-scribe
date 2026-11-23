// Agentes de atendimento no WhatsApp (contrato 138): tipos, limites e padrões. Um agente responde, em rascunho ou
// sozinho, as conversas individuais marcadas uma a uma (o "atendimento" da conversa). Separado dos agentes das
// Automações (`automations.ts`): este não lê dado nenhum do app nem usa ferramenta. O esquema zod fica em
// `atendimento-schema.ts`, para o renderer não carregar o zod. Nenhum texto de mensagem entra no histórico.

/** Arquivos em `userData/whatsapp/`. */
export const ATENDIMENTO_FILE = 'atendimento.json'
export const ATENDIMENTO_LOG_FILE = 'atendimento-log.jsonl'
export const ATENDIMENTO_VERSION = 1

export const ATENDIMENTO_NAME_MAX = 60
export const ATENDIMENTO_INSTRUCTIONS_MAX = 8000
export const ATENDIMENTO_TONE_MAX = 500
export const ATENDIMENTO_NEVER_MAX = 2000
export const ATENDIMENTO_ABOUT_MAX = 1000
/** Atraso antes de responder, em minutos (mínimo e máximo, com `delayMax >= delayMin`). */
export const ATENDIMENTO_DELAY_MAX_MINUTES = 120
export const ATENDIMENTO_MAX_PER_HOUR_MIN = 1
export const ATENDIMENTO_MAX_PER_HOUR_MAX = 30
/** Pausa depois de uma resposta minha na conversa, em minutos (até um dia). */
export const ATENDIMENTO_PAUSE_ON_MY_REPLY_MAX = 1440
export const ATENDIMENTO_REASON_MAX = 200
/** Histórico: os eventos mais recentes que ficam no arquivo. */
export const ATENDIMENTO_LOG_MAX = 5000
export const ATENDIMENTO_LOG_LIST_DEFAULT = 200
export const ATENDIMENTO_LOG_LIST_MAX = 1000
/** "HH:MM", de 00:00 a 23:59. */
export const ATENDIMENTO_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
/** Sufixo dos ids de grupo: grupo nunca tem atendimento. */
export const ATENDIMENTO_GROUP_SUFFIX = '@g.us'

export const ATENDIMENTO_MODELS = ['haiku', 'sonnet'] as const
export type AtendimentoModel = (typeof ATENDIMENTO_MODELS)[number]

export const ATENDIMENTO_MODES = ['draft', 'auto'] as const
export type AtendimentoMode = (typeof ATENDIMENTO_MODES)[number]

export interface AtendimentoAgent {
  id: string
  /** Único, sem diferenciar maiúsculas. */
  name: string
  instructions: string
  tone: string
  /** "Nunca diga ou prometa". */
  never: string
  model: AtendimentoModel
  createdAt: string
  updatedAt: string
}

/** Criar (`id: null`) ou trocar um agente; `tone` e `never` vazios quando não vierem. */
export interface AtendimentoAgentInput {
  id: string | null
  name: string
  instructions: string
  tone?: string
  never?: string
  model: AtendimentoModel
}

/** Horário de atendimento: `days` de 0 a 6 (0 = domingo), `start` e `end` em "HH:MM". */
export interface AtendimentoHours {
  days: number[]
  start: string
  end: string
}

export interface AtendimentoBinding {
  /** Chave: no máximo um atendimento por conversa; nunca termina em `@g.us`. */
  chatId: string
  agentId: string
  enabled: boolean
  mode: AtendimentoMode
  delayMinMinutes: number
  delayMaxMinutes: number
  /** Mostra "digitando…" antes de responder. */
  typing: boolean
  /** Avisa na primeira resposta do dia que é um assistente. */
  identify: boolean
  /** "Quem é esta pessoa". */
  about: string
  /** `null`: sempre. */
  hours: AtendimentoHours | null
  maxPerHour: number
  pauseOnMyReplyMinutes: number
  /** Gravado só pelo próprio atendimento (`setPausedUntil`); salvar a conversa não muda. */
  pausedUntil: string | null
  updatedAt: string
}

/** O que o painel da conversa manda: `chatId` e `agentId` sempre; o que faltar vale `ATENDIMENTO_BINDING_DEFAULTS`. */
export type AtendimentoBindingInput = Pick<AtendimentoBinding, 'chatId' | 'agentId'> & Partial<Omit<AtendimentoBinding, 'chatId' | 'agentId' | 'pausedUntil' | 'updatedAt'>>

/** Padrões de um atendimento novo. */
export const ATENDIMENTO_BINDING_DEFAULTS: Readonly<Omit<AtendimentoBinding, 'chatId' | 'agentId' | 'updatedAt'>> = Object.freeze({
  enabled: true,
  mode: 'draft',
  delayMinMinutes: 2,
  delayMaxMinutes: 5,
  typing: true,
  identify: false,
  about: '',
  hours: null,
  maxPerHour: 6,
  pauseOnMyReplyMinutes: 60,
  pausedUntil: null,
})

export interface AtendimentoState {
  agents: AtendimentoAgent[]
  bindings: AtendimentoBinding[]
  /** "Pausar todos os atendimentos". */
  pausedAll: boolean
  /** Aceite do aviso de risco, exigido antes do primeiro atendimento automático. */
  riskAcceptedAt: string | null
}

export const ATENDIMENTO_LOG_ACTIONS = ['sent', 'drafted', 'draft-sent', 'draft-discarded', 'handed-off', 'paused', 'cancelled', 'rate-limited', 'out-of-hours', 'failed'] as const
export type AtendimentoLogAction = (typeof ATENDIMENTO_LOG_ACTIONS)[number]

/** Uma linha do histórico. Sem texto de mensagem. */
export interface AtendimentoLogEntry {
  at: string
  chatId: string
  agentId: string
  action: AtendimentoLogAction
  messageId?: string
  reason?: string
}

/**
 * `invalid`: pedido fora do formato ou dos limites; `name-taken`: outro agente com o mesmo nome; `not-found`: o agente
 * ou o atendimento pedido não existe; `agent-not-found`: o atendimento aponta para agente inexistente;
 * `group-not-allowed`: conversa de grupo; `risk-required`: atendimento automático ligado sem o aceite do risco.
 */
export const ATENDIMENTO_ERRORS = ['invalid', 'name-taken', 'not-found', 'agent-not-found', 'group-not-allowed', 'risk-required'] as const
export type AtendimentoError = (typeof ATENDIMENTO_ERRORS)[number]

export type AtendimentoFailure = { ok: false; error: AtendimentoError }
/** Toda mutação devolve o estado inteiro depois de gravar. */
export type AtendimentoResult = { ok: true; state: AtendimentoState } | AtendimentoFailure
export type AtendimentoAgentSaveResult = { ok: true; agent: AtendimentoAgent; state: AtendimentoState } | AtendimentoFailure
export type AtendimentoBindingSaveResult = { ok: true; binding: AtendimentoBinding; state: AtendimentoState } | AtendimentoFailure
export type AtendimentoLogListResult = { ok: true; entries: AtendimentoLogEntry[] } | AtendimentoFailure

/** Pedido de `scribe:atendimento-log-list`: `limit` padrão 200, até 1.000; `chatId` filtra. */
export interface AtendimentoLogListRequest {
  limit?: number
  chatId?: string
}

/** Conversa de grupo. */
export const isGroupChat = (chatId: string): boolean => chatId.endsWith(ATENDIMENTO_GROUP_SUFFIX)
