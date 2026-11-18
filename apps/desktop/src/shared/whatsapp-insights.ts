// "Detalhes" da conversa do WhatsApp (contrato 32): o que o Claude lê das últimas mensagens de uma conversa — resumo,
// pontos importantes, humor, pendências e compromissos — e o cache por conversa em `userData/whatsapp/insights.json`.
// Só tipos e limites: o esquema zod fica em `whatsapp-insights-schema.ts`, para o renderer não carregar o zod. A IA
// só lê: nada daqui alcança o envio.

/** Mensagens que vão no pedido (as mais recentes). */
export const INSIGHTS_MESSAGES_MAX = 200
export const INSIGHTS_SUMMARY_MAX = 600
export const INSIGHTS_POINTS_MAX = 8
export const INSIGHTS_ITEM_MAX = 200
export const INSIGHTS_MOOD_WHY_MAX = 300
export const INSIGHTS_MOOD_DAYS_MAX = 14
export const INSIGHTS_PENDING_MAX = 5
export const INSIGHTS_COMMITMENTS_MAX = 8
export const INSIGHTS_WHEN_MAX = 40
/** Conversas guardadas no cache; passando disso, saem as analisadas há mais tempo. */
export const INSIGHTS_CACHE_MAX = 300

export const INSIGHTS_MOODS = ['positivo', 'neutro', 'negativo'] as const
export type InsightsMood = (typeof INSIGHTS_MOODS)[number]

/** Rótulo do humor no painel. */
export const INSIGHTS_MOOD_LABELS: Readonly<Record<InsightsMood, string>> = { positivo: 'Satisfeito', neutro: 'Neutro', negativo: 'Insatisfeito' }
/** Nota fixa embaixo do humor. */
export const INSIGHTS_MOOD_NOTE = 'Leitura aproximada do texto.'

export interface InsightsMoodDay {
  /** `AAAA-MM-DD`, no dia local das mensagens. */
  dia: string
  valor: InsightsMood
}

export interface InsightsCommitment {
  texto: string
  /** "sexta", "dia 28", "até amanhã", quando a conversa diz. */
  quando?: string | undefined
}

/** O que o Claude devolve, já cortado nos limites. */
export interface WhatsAppInsightsContent {
  resumo: string
  pontos: string[]
  humor: { valor: InsightsMood; justificativa: string }
  humorDias: InsightsMoodDay[]
  pendencias: { minhas: string[]; deles: string[] }
  compromissos: InsightsCommitment[]
}

/** Uma análise guardada: o conteúdo, de que conversa, até que mensagem, e o modelo, o tempo e o custo. */
export interface WhatsAppInsights extends WhatsAppInsightsContent {
  chatId: string
  /** `lastMessage.at` da conversa quando a análise foi feita: outra mensagem depois invalida o cache. */
  at: number
  createdAt: string
  /** Quantas mensagens foram lidas. */
  messages: number
  model: string
  costUsd: number | null
  durationMs: number | null
}

/** O cache: `{ chatId: { at, result } }`. */
export type WhatsAppInsightsCache = Record<string, { at: number; result: WhatsAppInsights }>

/** O que o painel recebe ao abrir: a análise guardada (se houver) e se ela ainda vale para a última mensagem. */
export interface WhatsAppInsightsState {
  insights: WhatsAppInsights | null
  /** A análise guardada é da última mensagem de agora. */
  fresh: boolean
}

export type WhatsAppInsightsError = 'not-found' | 'timeout' | 'failed' | 'agent' | 'format' | 'chat' | 'empty' | 'off'
export type WhatsAppInsightsResult = { ok: true; insights: WhatsAppInsights } | { ok: false; error: WhatsAppInsightsError }

/** Texto curto de cada falha no painel. */
export const INSIGHTS_ERRORS: Readonly<Record<WhatsAppInsightsError, string>> = {
  'not-found': 'O Claude não foi encontrado neste Mac.',
  timeout: 'O Claude demorou demais.',
  failed: 'O Claude não conseguiu analisar a conversa.',
  agent: 'O agente do Claude não abriu.',
  format: 'A resposta do Claude veio num formato inesperado.',
  chat: 'A conversa não está mais disponível.',
  empty: 'Esta conversa ainda não tem mensagens para analisar.',
  off: 'Os Detalhes com IA estão desligados.',
}
