// Mensagens diretas do Instagram no main (contrato 74, R6 e CA11 da spec redes-instagram). A cada `redesPollMinutes`
// (o mesmo timer dos comentários), ao abrir a seção e no "Atualizar", `syncMessages` lê `/me/conversations` e só as
// mensagens das conversas com `updated_time` novo, mesclando com o que já estava guardado (pelo id; a Meta só detalha as
// 20 mais recentes, então as mais antigas já lidas ficam). O que foi lido fica em `instagram-<id>.messages.json` (um
// arquivo à parte, na mesma fila de escrita da conta, para a fila de publicações não apagar as mensagens).
//
// Não lida é a conversa cuja última mensagem é do contato e chegou depois da última vez que a pessoa a abriu
// (`readAt`); só abrir a conversa na tela muda isso. A recusa da Meta ao acesso às mensagens (permissão, Standard
// Access, "Permitir acesso a mensagens" desligado) vira `access: 'denied'` com o resumo em pt-BR e zera os não lidos,
// sem erro vermelho. "Enviar" só com o token de clique do preload; fora da janela de 24 h tenta do mesmo jeito e, se a
// Meta recusar, devolve "O Instagram recusou: fora da janela de 24 h". O texto do contato é de terceiros: guardado e
// devolvido como texto, nunca interpretado.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { REDES_MESSAGE_CLICK_MESSAGE } from '../../shared/ipc'
import {
  EMPTY_MESSAGES_STATE,
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_TEXT_MAX_BYTES,
  MESSAGE_TOO_LONG_MESSAGE,
  MESSAGE_WINDOW_REFUSED_MESSAGE,
  MESSAGES_ACCESS_STATES,
  messageBytes,
  outsideMessageWindow,
  REDES_ACCOUNT_ID_PATTERN,
  type RedesConversation,
  type RedesMessage,
  type RedesMessageAttachment,
  type RedesMessageSendResult,
  type RedesMessagesPayload,
  type RedesMessagesState,
} from '../../shared/redes'
import { MESSAGING_ID, type InstagramClient, type InstagramConversation, type InstagramDirectMessage } from './instagram-client'
import type { RedesStore } from './store'

const FILE_VERSION = 1
/** As conversas guardadas por conta (as mais recentes) e as mensagens por conversa (as mais novas). */
export const MESSAGES_CONVERSATIONS_MAX = 100
export const MESSAGES_PER_CONVERSATION_MAX = 200
const TEXT_MAX = 4000
/** A mensagem enviada sem o id da Meta fica com um id local até a leitura seguinte trazer a de verdade. */
const LOCAL_PREFIX = 'local-'
/** A enviada (local) e a que volta da Meta são a mesma se o texto bate e a hora está a até 10 min. */
const LOCAL_MATCH_MS = 10 * 60_000

export const MESSAGES_FAILED_MESSAGE = 'Não foi possível ler as mensagens do Instagram'
export const MESSAGE_SEND_FAILED_MESSAGE = 'Não foi possível enviar a mensagem'
export const MESSAGE_EMPTY_MESSAGE = 'Escreva a mensagem antes de enviar'
export const CONVERSATION_MISSING_MESSAGE = 'Conversa não encontrada'

const iso = z.iso.datetime({ offset: true })
const messagingId = z.string().regex(MESSAGING_ID)
const igsid = z.string().regex(/^\d{1,40}$/)

const attachmentSchema = z.object({ kind: z.enum(MESSAGE_ATTACHMENT_KINDS), url: z.string().max(4096).nullable() }).strict()
const messageSchema = z
  .object({
    id: messagingId,
    conversationId: messagingId,
    fromId: z.string().max(40),
    fromMe: z.boolean(),
    text: z.string().max(TEXT_MAX).nullable(),
    attachments: z.array(attachmentSchema).max(20),
    createdAt: iso,
  })
  .strict()
const conversationSchema = z
  .object({
    id: messagingId,
    participantId: igsid,
    participantName: z.string().min(1).max(200),
    participantUsername: z.string().min(1).max(100),
    updatedAt: iso,
    /** A última vez que a pessoa abriu a conversa: a hora da última mensagem que estava lá. */
    readAt: iso.nullable(),
    /** O `updated_time` da última leitura completa das mensagens (`null`: ainda não leu, ou a leitura falhou). */
    syncedAt: iso.nullable(),
    olderCount: z.number().int().nonnegative(),
  })
  .strict()
const fileSchema = z
  .object({
    version: z.literal(FILE_VERSION),
    conversations: z.array(conversationSchema).max(MESSAGES_CONVERSATIONS_MAX),
    messages: z.record(messagingId, z.array(messageSchema).max(MESSAGES_PER_CONVERSATION_MAX)),
    access: z.enum(MESSAGES_ACCESS_STATES),
    accessError: z.string().max(500).nullable(),
    updatedAt: iso.nullable(),
  })
  .strict()

export type StoredConversation = z.output<typeof conversationSchema>
/** Tudo o que o main guarda de uma conta (o arquivo, sem a versão). */
export interface MessagesSnapshot {
  conversations: StoredConversation[]
  messages: Record<string, RedesMessage[]>
  access: RedesMessagesState['access']
  accessError: string | null
  updatedAt: string | null
}

export function emptySnapshot(): MessagesSnapshot {
  return { conversations: [], messages: {}, access: EMPTY_MESSAGES_STATE.access, accessError: null, updatedAt: null }
}

/** O arquivo lido, validado; ausente ou inválido vale como vazio. */
export function parseMessagesFile(raw: unknown): MessagesSnapshot {
  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) return emptySnapshot()
  const { conversations, messages, access, accessError, updatedAt } = parsed.data
  return { conversations, messages, access, accessError, updatedAt }
}

export function serializeMessages(snapshot: MessagesSnapshot): z.input<typeof fileSchema> {
  return { version: FILE_VERSION, ...snapshot }
}

const time = (value: string | null): number => (value ? Date.parse(value) : 0)

/** A mesclagem por id, da mais antiga para a mais nova; a local (enviada sem id) sai quando a de verdade chega. */
export function mergeMessages(existing: readonly RedesMessage[], incoming: readonly RedesMessage[]): RedesMessage[] {
  const byId = new Map<string, RedesMessage>()
  for (const message of existing) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, message)
  const real = [...byId.values()].filter((message) => !message.id.startsWith(LOCAL_PREFIX))
  const kept = [...byId.values()].filter(
    (message) => !message.id.startsWith(LOCAL_PREFIX) || !real.some((other) => other.fromMe && other.text === message.text && Math.abs(time(other.createdAt) - time(message.createdAt)) <= LOCAL_MATCH_MS),
  )
  return kept.sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id)).slice(-MESSAGES_PER_CONVERSATION_MAX)
}

const ATTACHMENT_LABEL: Readonly<Record<RedesMessageAttachment['kind'], string>> = { imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', arquivo: 'Arquivo', outro: 'Anexo' }

/** A mensagem numa linha (a prévia da lista): o texto sem quebras ou o tipo do anexo. */
export function messagePreview(message: RedesMessage): string {
  const line = message.text?.replace(/\s+/g, ' ').trim()
  if (line) return line.slice(0, 300)
  const first = message.attachments[0]
  return first ? ATTACHMENT_LABEL[first.kind] : 'Mensagem'
}

/** A conversa como a tela vê: a prévia, a hora da última do contato e se está não lida. */
export function conversationView(conversation: StoredConversation, messages: readonly RedesMessage[]): RedesConversation {
  const last = messages.at(-1)
  const lastInbound = [...messages].reverse().find((message) => !message.fromMe)
  return {
    id: conversation.id,
    participantId: conversation.participantId,
    participantName: conversation.participantName,
    participantUsername: conversation.participantUsername,
    updatedAt: conversation.updatedAt,
    lastMessage: last ? messagePreview(last) : null,
    unread: Boolean(last && !last.fromMe && (!conversation.readAt || time(last.createdAt) > time(conversation.readAt))),
    lastInboundAt: lastInbound?.createdAt ?? null,
    olderCount: conversation.olderCount,
  }
}

/** O estado para a tela; com o acesso recusado, nenhum não lido (o número do nível some). */
export function messagesState(snapshot: MessagesSnapshot): RedesMessagesState {
  const conversations = [...snapshot.conversations].sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).map((conversation) => conversationView(conversation, snapshot.messages[conversation.id] ?? []))
  const denied = snapshot.access === 'denied'
  return {
    conversations,
    messages: Object.fromEntries(conversations.map((conversation) => [conversation.id, (snapshot.messages[conversation.id] ?? []).map((message) => ({ ...message, attachments: message.attachments.map((item) => ({ ...item })) }))])),
    access: snapshot.access,
    accessError: snapshot.accessError,
    unread: denied ? 0 : conversations.filter((conversation) => conversation.unread).length,
    updatedAt: snapshot.updatedAt,
  }
}

export interface MessagesAccount {
  id: string
  username: string
}

const isSelf = (account: MessagesAccount, id: string, username: string | null): boolean => id === account.id || (username !== null && username.toLowerCase() === account.username.toLowerCase())

function toMessage(account: MessagesAccount, conversationId: string, message: InstagramDirectMessage): RedesMessage {
  return {
    id: message.id,
    conversationId,
    fromId: message.fromId,
    fromMe: isSelf(account, message.fromId, message.fromUsername),
    text: message.text,
    attachments: message.attachments.map((item) => ({ ...item })),
    createdAt: message.createdAt,
  }
}

export interface SyncResult {
  snapshot: MessagesSnapshot
  /** Falha que não é recusa de acesso (rede, limite): o que já estava fica. */
  error: string | null
}

/**
 * Uma leitura: as conversas e, das que mudaram (`updated_time` diferente do da última leitura completa), as mensagens.
 * Recusa de acesso em qualquer passo vira `denied` (o que já estava guardado fica, escondido pela tela). A conversa
 * cujas mensagens não vieram fica com o `syncedAt` antigo e é lida de novo na próxima vez.
 */
export async function syncMessages(client: InstagramClient, token: string, account: MessagesAccount, current: MessagesSnapshot, now: number): Promise<SyncResult> {
  const listed = await client.conversations(token)
  if (!listed.ok) {
    if (listed.denied) return { snapshot: { ...current, access: 'denied', accessError: listed.error }, error: null }
    return { snapshot: current, error: listed.error }
  }
  const byId = new Map(current.conversations.map((conversation) => [conversation.id, conversation]))
  const messages: Record<string, RedesMessage[]> = { ...current.messages }
  let error: string | null = null
  for (const item of listed.conversations.slice(0, MESSAGES_CONVERSATIONS_MAX)) {
    const contact = contactOf(account, item)
    if (!contact) continue
    const previous = byId.get(item.id)
    const base: StoredConversation = {
      id: item.id,
      participantId: contact.id,
      participantName: contact.name ?? contact.username,
      participantUsername: contact.username,
      updatedAt: item.updatedAt,
      readAt: previous?.readAt ?? null,
      syncedAt: previous?.syncedAt ?? null,
      olderCount: previous?.olderCount ?? 0,
    }
    if (previous?.syncedAt === item.updatedAt) {
      byId.set(item.id, base)
      continue
    }
    const read = await client.conversationMessages(token, item.id)
    if (!read.ok) {
      if (read.denied) return { snapshot: { ...current, access: 'denied', accessError: read.error }, error: null }
      error = read.error
      byId.set(item.id, base)
      continue
    }
    const merged = mergeMessages(messages[item.id] ?? [], read.messages.map((message) => toMessage(account, item.id, message)))
    messages[item.id] = merged
    // A Meta conta as antigas sem detalhe; as que já estão guardadas (lidas quando eram recentes) não contam de novo.
    const known = Math.max(0, merged.length - read.messages.length)
    byId.set(item.id, { ...base, syncedAt: item.updatedAt, olderCount: Math.max(0, read.olderCount - known) })
  }
  const conversations = [...byId.values()].sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).slice(0, MESSAGES_CONVERSATIONS_MAX)
  const keep = new Set(conversations.map((conversation) => conversation.id))
  return {
    snapshot: {
      conversations,
      messages: Object.fromEntries(Object.entries(messages).filter(([id]) => keep.has(id))),
      access: 'ok',
      accessError: null,
      updatedAt: new Date(now).toISOString(),
    },
    error,
  }
}

/** O contato da conversa: o participante que não é a própria conta (sem ele, a conversa não entra). */
function contactOf(account: MessagesAccount, conversation: InstagramConversation): { id: string; username: string; name: string | null } | null {
  return conversation.participants.find((participant) => !isSelf(account, participant.id, participant.username)) ?? null
}

/** A conversa aberta na tela: lida até a última mensagem que está lá. */
export function markConversationRead(snapshot: MessagesSnapshot, conversationId: string): MessagesSnapshot {
  const last = snapshot.messages[conversationId]?.at(-1)
  if (!last) return snapshot
  return { ...snapshot, conversations: snapshot.conversations.map((conversation) => (conversation.id === conversationId ? { ...conversation, readAt: last.createdAt } : conversation)) }
}

/** A resposta enviada entra na conversa na hora (com o id da Meta, ou um local até a próxima leitura). */
export function appendSent(snapshot: MessagesSnapshot, conversationId: string, accountId: string, text: string, messageId: string | null, now: number): { snapshot: MessagesSnapshot; message: RedesMessage } {
  const message: RedesMessage = { id: messageId ?? `${LOCAL_PREFIX}${randomUUID()}`, conversationId, fromId: accountId, fromMe: true, text, attachments: [], createdAt: new Date(now).toISOString() }
  const messages = { ...snapshot.messages, [conversationId]: mergeMessages(snapshot.messages[conversationId] ?? [], [message]) }
  // A conversa vai para o topo; a mensagem enviada já conta como vista (a última é da pessoa).
  const conversations = snapshot.conversations.map((conversation) => (conversation.id === conversationId ? { ...conversation, updatedAt: new Date(Math.max(now, time(conversation.updatedAt))).toISOString(), readAt: message.createdAt } : conversation))
  return { snapshot: { ...snapshot, conversations, messages }, message }
}

const accountRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN) })
const readRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN), conversationId: messagingId })
// O limite de 1000 bytes é conferido com a razão para a tela; o esquema só corta o absurdo.
const sendRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN), conversationId: messagingId, text: z.string().max(20_000), clickToken: z.string().max(100) })

/** A resposta do canal quando o serviço falhou: vazio, com o aviso (a tela mantém o que já tinha). */
export function failedMessagesPayload(request: unknown): RedesMessagesPayload {
  const parsed = accountRequestSchema.safeParse(request)
  return { accountId: parsed.success ? parsed.data.accountId : '', ...messagesState(emptySnapshot()), error: MESSAGES_FAILED_MESSAGE }
}

export interface MessagesServiceOptions {
  client: InstagramClient
  store: Pick<RedesStore, 'readMessages' | 'writeMessages' | 'removeMessages'>
  /** A conta conectada (`null`: saiu, ou não existe). */
  account: (accountId: string) => MessagesAccount | null
  /** O token em claro, só no main (`null`: sem token no cofre). */
  token: (accountId: string) => string | null
  now: () => number
  /** O estado de uma conta mudou (vai inteiro). */
  onChange: (payload: RedesMessagesPayload) => void
  /** O token de clique do "Enviar" (o guarda do serviço). */
  consumeClick: (senderId: number, token: unknown) => boolean
}

export interface MessagesService {
  /** Lê os arquivos das contas (ao abrir o app). */
  init(accountIds: readonly string[]): Promise<void>
  state(request: unknown): Promise<RedesMessagesPayload>
  /** "Atualizar" e a abertura da seção: lê agora. */
  refresh(request: unknown): Promise<RedesMessagesPayload>
  /** O polling: todas as contas conectadas, uma por vez. */
  syncAll(accountIds: readonly string[]): Promise<void>
  markRead(request: unknown): Promise<RedesMessagesPayload>
  send(senderId: number, request: unknown): Promise<RedesMessageSendResult>
  /** A conta saiu: o arquivo e o estado em memória. */
  remove(accountId: string): Promise<void>
  /** Os não lidos de cada conta (o número do nível Redes, ao desbloquear). */
  payloads(): RedesMessagesPayload[]
}

/** O lado de serviço das mensagens: o estado de cada conta em memória, uma operação por vez por conta. */
export function createMessagesService(options: MessagesServiceOptions): MessagesService {
  const snapshots = new Map<string, MessagesSnapshot>()
  const errors = new Map<string, string | null>()
  const chains = new Map<string, Promise<unknown>>()
  const perAccount = <T>(accountId: string, task: () => Promise<T>): Promise<T> => {
    const run = (chains.get(accountId) ?? Promise.resolve()).then(task, task)
    const settled = run.catch(() => undefined)
    chains.set(accountId, settled)
    void settled.then(() => {
      if (chains.get(accountId) === settled) chains.delete(accountId)
    })
    return run
  }

  const payloadOf = (accountId: string): RedesMessagesPayload => ({ accountId, ...messagesState(snapshots.get(accountId) ?? emptySnapshot()), error: errors.get(accountId) ?? null })
  const empty = (accountId: string): RedesMessagesPayload => ({ accountId, ...messagesState(emptySnapshot()), error: null })

  /** Grava e avisa; a conta que saiu no meio não volta por aqui. */
  const commit = async (accountId: string, snapshot: MessagesSnapshot, error: string | null): Promise<RedesMessagesPayload> => {
    if (!options.account(accountId)) return empty(accountId)
    snapshots.set(accountId, snapshot)
    errors.set(accountId, error)
    await options.store.writeMessages(accountId, serializeMessages(snapshot))
    const payload = payloadOf(accountId)
    options.onChange(payload)
    return payload
  }

  const sync = (accountId: string): Promise<RedesMessagesPayload> =>
    perAccount(accountId, async () => {
      const account = options.account(accountId)
      if (!account) return empty(accountId)
      const token = options.token(accountId)
      const current = snapshots.get(accountId) ?? emptySnapshot()
      if (!token) return commit(accountId, current, MESSAGES_FAILED_MESSAGE)
      const result = await syncMessages(options.client, token, account, current, options.now()).catch(() => ({ snapshot: current, error: MESSAGES_FAILED_MESSAGE }))
      return commit(accountId, result.snapshot, result.error)
    })

  return {
    async init(accountIds) {
      snapshots.clear()
      errors.clear()
      for (const id of accountIds) snapshots.set(id, parseMessagesFile(await options.store.readMessages(id)))
    },

    async state(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success || !options.account(parsed.data.accountId)) return empty(parsed.success ? parsed.data.accountId : '')
      return payloadOf(parsed.data.accountId)
    },

    async refresh(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success || !options.account(parsed.data.accountId)) return empty(parsed.success ? parsed.data.accountId : '')
      return sync(parsed.data.accountId)
    },

    async syncAll(accountIds) {
      for (const id of accountIds) await sync(id).catch(() => undefined)
    },

    markRead(request) {
      const parsed = readRequestSchema.safeParse(request)
      if (!parsed.success || !options.account(parsed.data.accountId)) return Promise.resolve(empty(parsed.success ? parsed.data.accountId : ''))
      const { accountId, conversationId } = parsed.data
      return perAccount(accountId, async () => {
        const current = snapshots.get(accountId) ?? emptySnapshot()
        const readAt = (snapshot: MessagesSnapshot): string | null | undefined => snapshot.conversations.find((item) => item.id === conversationId)?.readAt
        const next = markConversationRead(current, conversationId)
        // Já lida até a última: nada a gravar.
        if (readAt(next) === readAt(current)) return payloadOf(accountId)
        return commit(accountId, next, errors.get(accountId) ?? null)
      })
    },

    async send(senderId, request) {
      // O token de clique é gasto antes de tudo (uso único), como no "Enviar" do email.
      if (!options.consumeClick(senderId, ((request ?? {}) as { clickToken?: unknown }).clickToken)) return { ok: false, error: REDES_MESSAGE_CLICK_MESSAGE }
      const parsed = sendRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: CONVERSATION_MISSING_MESSAGE }
      const { accountId, conversationId } = parsed.data
      const text = parsed.data.text.trim()
      if (!text) return { ok: false, error: MESSAGE_EMPTY_MESSAGE }
      if (messageBytes(text) > MESSAGE_TEXT_MAX_BYTES) return { ok: false, error: MESSAGE_TOO_LONG_MESSAGE }
      return perAccount(accountId, async (): Promise<RedesMessageSendResult> => {
        const account = options.account(accountId)
        const token = options.token(accountId)
        const current = snapshots.get(accountId) ?? emptySnapshot()
        const conversation = current.conversations.find((item) => item.id === conversationId)
        if (!account || !conversation) return { ok: false, error: CONVERSATION_MISSING_MESSAGE }
        if (!token) return { ok: false, error: MESSAGE_SEND_FAILED_MESSAGE }
        // Fora da janela de 24 h, tenta do mesmo jeito (a Meta decide); a recusa ganha a razão da janela.
        const outside = outsideMessageWindow(conversationView(conversation, current.messages[conversationId] ?? []).lastInboundAt, options.now())
        const sent = await options.client.sendMessage(token, account.id, conversation.participantId, text).catch(() => null)
        if (!sent) return { ok: false, error: MESSAGE_SEND_FAILED_MESSAGE }
        // A razão da janela só para a recusa dela (subcódigo 2018278, ou o código 10 fora da janela); o resto, o erro da
        // Meta em pt-BR (`instagramErrorMessage`), mesmo fora da janela.
        if (!sent.ok) return { ok: false, error: sent.subcode === 2018278 || (outside && sent.code === 10) ? MESSAGE_WINDOW_REFUSED_MESSAGE : sent.error }
        const next = appendSent(current, conversationId, account.id, text, sent.messageId, options.now())
        const payload = await commit(accountId, next.snapshot, errors.get(accountId) ?? null)
        return { ok: true, message: next.message, payload }
      })
    },

    remove(accountId) {
      return perAccount(accountId, async () => {
        snapshots.delete(accountId)
        errors.delete(accountId)
        await options.store.removeMessages(accountId)
      })
    },

    payloads() {
      return [...snapshots.keys()].filter((id) => options.account(id)).map(payloadOf)
    },
  }
}
