// Textos da tela "Assistente" (antes "Perguntar" v2, contrato 16): modelo, tempo, tokens, custo, escopo, totais da conversa,
// sugestões e a lista de conversas agrupada por dia. Sem DOM: testado em test/renderer/chat.test.ts.
import type { ChatListItem, ChatMessage, ChatScope } from '@shared/chat'
import { WHATSAPP_DEFAULT_SCOPE_DAYS } from '@shared/whatsapp'
import type { ChatModel } from '@shared/settings-defaults'
import { dayKey, groupDayLabel } from '../meetings/format'

export const CHAT_MODEL_LABELS: Readonly<Record<ChatModel, string>> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }

/** "Sonnet" a partir do apelido (`sonnet`) ou do id que o `claude` anunciou (`claude-sonnet-5-5`). */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return ''
  const family = /haiku|sonnet|opus/i.exec(model)?.[0]?.toLowerCase() as ChatModel | undefined
  return family ? CHAT_MODEL_LABELS[family] : model
}

const NUMBER_1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const MONEY = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "12 s", "1 min 05 s". */
export function answerTimeLabel(ms: number): string {
  const seconds = Math.max(ms > 0 ? 1 : 0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
}

/** "420", "3,1 mil", "1,2 mi". */
export function tokensLabel(count: number): string {
  if (count < 1000) return String(Math.round(count))
  if (count < 1_000_000) return `${NUMBER_1.format(count / 1000)} mil`
  return `${NUMBER_1.format(count / 1_000_000)} mi`
}

/** "US$ 0,02"; abaixo de um centavo, "menos de US$ 0,01". */
export function costLabel(usd: number): string {
  if (usd > 0 && usd < 0.005) return 'menos de US$ 0,01'
  return `US$ ${MONEY.format(usd)}`
}

export const COST_HINT = 'Valor de referência; sai do seu plano do Claude.'

/** "1 reunião consultada", "3 reuniões consultadas". */
export function consultedLabel(count: number): string {
  return count === 1 ? '1 reunião consultada' : `${count} reuniões consultadas`
}

/**
 * Reuniões escolhidas que ainda existem (`exists` nulo enquanto a lista não chegou: valem todas). Excluída
 * depois de escolhida não conta no rótulo nem libera o envio.
 */
export function chosenMeetings(scope: ChatScope, exists: ((id: string) => boolean) | null): string[] {
  const ids = scope.kind === 'meetings' ? (scope.meetingIds ?? []) : []
  return exists ? ids.filter(exists) : [...ids]
}

/**
 * Contrato 24: o escopo novo leva junto as conversas do WhatsApp escolhidas no anterior. Contrato 25: e o modo do
 * WhatsApp e as fontes desligadas.
 */
export function withWhatsApp(next: ChatScope, from: ChatScope): ChatScope {
  const chats = from.whatsappChats?.length ? { whatsappChats: [...from.whatsappChats], whatsappDays: from.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS } : {}
  return {
    ...next,
    ...chats,
    ...(from.whatsappMode ? { whatsappMode: from.whatsappMode } : {}),
    ...(from.sources ? { sources: { ...from.sources } } : {}),
  }
}

/** Rótulo do escopo: "Todas as reuniões (6)", "Últimos 7 dias", "Reuniões escolhidas (2)"; com " + 2 conversas" do WhatsApp. */
export function scopeLabel(scope: ChatScope, total: number | null, exists: ((id: string) => boolean) | null = null): string {
  const chats = scope.whatsappChats?.length ?? 0
  const extra = chats ? ` + ${chats} ${chats === 1 ? 'conversa' : 'conversas'}` : ''
  if (scope.kind === '7d') return `Últimos 7 dias${extra}`
  if (scope.kind === '30d') return `Últimos 30 dias${extra}`
  if (scope.kind === 'meetings') return `Reuniões escolhidas (${chosenMeetings(scope, exists).length})${extra}`
  return `${total === null ? 'Todas as reuniões' : `Todas as reuniões (${total})`}${extra}`
}

/** Tokens da resposta: a entrada conta o que veio do cache. */
export function answerTokens(meta: { inputTokens: number; cacheReadTokens: number; outputTokens: number }): { input: number; output: number } {
  return { input: meta.inputTokens + meta.cacheReadTokens, output: meta.outputTokens }
}

/** Reuniões abertas pelo Claude em toda a conversa, na ordem em que apareceram. */
export function consultedIn(messages: readonly ChatMessage[]): string[] {
  const seen: string[] = []
  for (const message of messages) {
    const ids = message.meta?.consulted ?? (message.steps ?? []).flatMap((step) => (step.meetingId ? [step.meetingId] : []))
    for (const id of ids) if (!seen.includes(id)) seen.push(id)
  }
  return seen
}

export interface ChatTotals {
  messages: number
  tokens: number
  costUsd: number
  durationMs: number
}

/** Totais da conversa para o painel "Contexto". */
export function chatTotals(messages: readonly ChatMessage[]): ChatTotals {
  return messages.reduce<ChatTotals>(
    (sum, message) => ({
      messages: sum.messages + 1,
      tokens: sum.tokens + (message.meta ? message.meta.inputTokens + message.meta.cacheReadTokens + message.meta.outputTokens : 0),
      costUsd: sum.costUsd + (message.meta?.costUsd ?? 0),
      durationMs: sum.durationMs + (message.meta?.durationMs ?? 0),
    }),
    { messages: 0, tokens: 0, costUsd: 0, durationMs: 0 },
  )
}

export interface SuggestionGroup {
  title: string
  items: [string, string]
}

/**
 * As 6 sugestões da conversa vazia, em 3 grupos. Com o participante e a palavra frequente do acervo, as
 * frases levam o nome e a palavra; sem eles, ficam genéricas. Na aba de uma reunião, sobre ela.
 */
export function chatSuggestionGroups(participant: string | null, topic: string | null, forMeeting = false): SuggestionGroup[] {
  if (forMeeting) {
    return [
      { title: 'Esta reunião', items: ['O que ficou decidido?', 'Quais tarefas são minhas?'] },
      { title: 'Pessoas', items: [participant ? `O que ${participant} disse?` : 'Quem falou o quê?', participant ? `O que ${participant} pediu?` : 'O que me pediram?'] },
      { title: 'Tópicos', items: [topic ? `O que foi dito sobre ${topic}?` : 'Resuma esta reunião em três frases.', 'Quais pendências ficaram abertas?'] },
    ]
  }
  return [
    { title: 'Esta semana', items: ['O que ficou decidido esta semana?', 'Quais tarefas são minhas?'] },
    {
      title: 'Pessoas',
      items: [participant ? `Resuma a última reunião com ${participant}` : 'Resuma a última reunião', participant ? `O que ${participant} pediu?` : 'O que me pediram nas reuniões?'],
    },
    { title: 'Tópicos', items: [topic ? `O que foi dito sobre ${topic}?` : 'Quais assuntos mais apareceram?', 'Quais pendências estão abertas?'] },
  ]
}

const STOPWORDS = new Set(
  'reunião reuniões sobre porque depois ainda então também quando todos todas outro outra outros outras nossa nosso nossas nossos entre cada desde sempre agora antes isso essa esse esses essas aquele aquela estava estão estamos fazer feito ficou ficar foram seria sendo tinha temos vamos pessoa pessoas equipe parte vezes coisa coisas onde quais qual quem mesmo mesma assim muito muita muitos muitas pouco poucos tudo nada algum alguma alguns algumas primeira primeiro segunda segundo semana semanal dia dias hoje ontem amanhã'.split(
    ' ',
  ),
)

/** Palavra (5+ letras) que mais aparece nos títulos e resumos, pelo menos 2 vezes; `null` se nenhuma. */
export function frequentWord(texts: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const word of text.toLowerCase().match(/\p{L}{5,}/gu) ?? []) {
      if (STOPWORDS.has(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  let best: string | null = null
  let most = 1
  for (const [word, total] of counts) {
    if (total > most) {
      best = word
      most = total
    }
  }
  return best
}

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** Busca por título, sem acento e sem caixa. */
export function filterChats(items: readonly ChatListItem[], query: string): ChatListItem[] {
  const term = fold(query.trim())
  return term ? items.filter((item) => fold(item.title).includes(term)) : [...items]
}

export interface ChatGroup {
  key: string
  label: string
  items: ChatListItem[]
}

/** Conversas agrupadas pelo dia da última mensagem, com os rótulos da lista de reuniões (contrato 10). */
export function groupChatsByDay(items: readonly ChatListItem[], now: Date): ChatGroup[] {
  const groups: ChatGroup[] = []
  for (const item of items) {
    const date = new Date(item.updatedAt)
    const key = dayKey(date)
    let group = groups.at(-1)
    if (group?.key !== key) {
      group = { key, label: groupDayLabel(date, now), items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** Medidas de tela (as de `getBoundingClientRect`) do trilho e da seção, mais a rolagem atual do trilho. */
export interface RailBox {
  top: number
  height: number
}

/**
 * Contrato 38: aonde rolar o trilho do Assistente para o "Contexto" recém-aberto aparecer. Inteiro à vista: não rola
 * (`null`). Cabe no trilho: o mínimo para ele aparecer inteiro. Maior que o trilho: o topo dele no alto.
 */
export function railScrollTarget(rail: RailBox & { scrollTop: number }, section: RailBox): number | null {
  const start = section.top - rail.top + rail.scrollTop
  const end = start + section.height
  if (start >= rail.scrollTop && end <= rail.scrollTop + rail.height) return null
  if (section.height >= rail.height || start < rail.scrollTop) return Math.max(0, start)
  return end - rail.height
}
