// Conversas do chat em `userData/chats/<id>.json` (contrato 15, CA6). Gravação atômica (temporário +
// `rename`) em fila, como os outros stores. Arquivo inválido é ignorado: não aparece na lista e abrir dá
// "não encontrada". Ao gravar, ficam as 200 mensagens mais recentes, cada uma com até 20 000 caracteres.
// Contrato 16: cada resposta guarda os passos, o raciocínio (até 20 000 caracteres), as ferramentas negadas,
// os detalhes (modelo, tempo, tokens, custo, consultadas) e o modelo pedido; a conversa guarda o escopo e o
// modelo. Arquivo do contrato 15, sem esses campos, carrega com os padrões (escopo "Todas", modelo das
// Configurações).
// Contrato 17: cada passo pode ter o id e o estado da chamada de ferramenta do ACP; a resposta guarda o
// "Plano" do agente; a conversa guarda "Pensar mais" (padrão desligado).
// Contrato 25: o escopo guarda as fontes desligadas e o modo do WhatsApp; a resposta guarda as ações propostas
// com o estado de cada cartão. Arquivo sem esses campos carrega com tudo ligado e sem cartões.
// Contrato 21: o escopo guarda os servidores MCP desligados na conversa; cada passo pode ser de uma ferramenta MCP.
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CHAT_ERRORS,
  CHAT_MESSAGES_MAX,
  CHAT_PLAN_MAX,
  CHAT_PLAN_STATUSES,
  CHAT_PLAN_TEXT_MAX,
  CHAT_SCOPE_KINDS,
  CHAT_SCOPE_MEETINGS_MAX,
  CHAT_SOURCE_KINDS,
  CHAT_STEP_LABEL_MAX,
  CHAT_STEP_STATUSES,
  CHAT_STEP_TOOLS,
  CHAT_STEPS_MAX,
  CHAT_TEXT_MAX,
  CHAT_THINKING_MAX,
  CHAT_TITLE_MAX,
  CHAT_WHATSAPP_MODES,
  chatWhatsAppModeOf,
  type Chat,
  type ChatListItem,
  type ChatScope,
} from '../../shared/chat'
import { ACTIONS_PER_MESSAGE_MAX, CHAT_ACTION_STATUSES, EMAIL_CARD_ITEMS_MAX, OPEN_SCREENS, REMINDER_TEXT_MAX } from '../../shared/assistant'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_RECIPIENTS_MAX, EMAIL_SUBJECT_MAX, EMAIL_TEXT_MAX } from '../../shared/email'
import { scheduleSchema } from '../../shared/automations-schema'
import { MCP_SERVERS_MAX } from '../../shared/mcp'
import { CHAT_MODELS } from '../../shared/settings-defaults'
import { WHATSAPP_CHAT_ID_PATTERN, WHATSAPP_DEFAULT_SCOPE_DAYS, WHATSAPP_SCOPE_CHATS_MAX, WHATSAPP_SCOPE_DAYS, WHATSAPP_SEND_TEXT_MAX } from '../../shared/whatsapp'

export const CHATS_DIR = 'chats'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
export const chatIdSchema = z.string().regex(/^[\w-]{1,100}$/)

const meetingIdSchema = z.string().regex(/^[\w-]{1,200}$/)
const tokens = z.number().int().min(0).max(1e12)

export const chatStepSchema = z.object({
  tool: z.enum(CHAT_STEP_TOOLS),
  label: z.string().max(CHAT_STEP_LABEL_MAX),
  meetingId: meetingIdSchema.nullable(),
  id: z.string().max(200).optional(),
  status: z.enum(CHAT_STEP_STATUSES).optional(),
})

export const chatPlanEntrySchema = z.object({
  content: z.string().max(CHAT_PLAN_TEXT_MAX),
  status: z.enum(CHAT_PLAN_STATUSES),
})

export const chatMetaSchema = z.object({
  model: z.string().max(100),
  durationMs: z.number().min(0).max(1e9),
  inputTokens: tokens,
  outputTokens: tokens,
  cacheReadTokens: tokens,
  costUsd: z.number().min(0).max(1e6),
  turns: z.number().int().min(0).max(1e6),
  consulted: z.array(meetingIdSchema).max(CHAT_STEPS_MAX),
})

export const chatScopeSchema = z
  .object({
    kind: z.enum(CHAT_SCOPE_KINDS),
    meetingIds: z.array(meetingIdSchema).max(CHAT_SCOPE_MEETINGS_MAX).optional(),
    // Contrato 24: conversas do WhatsApp no escopo, em qualquer tipo.
    whatsappChats: z.array(z.string().regex(WHATSAPP_CHAT_ID_PATTERN)).max(WHATSAPP_SCOPE_CHATS_MAX).optional(),
    whatsappDays: z
      .number()
      .int()
      .refine((days) => (WHATSAPP_SCOPE_DAYS as readonly number[]).includes(days))
      .optional(),
    // Contrato 25: o modo do WhatsApp e as fontes desligadas.
    whatsappMode: z.enum(CHAT_WHATSAPP_MODES).optional(),
    sources: z.partialRecord(z.enum(CHAT_SOURCE_KINDS), z.boolean()).optional(),
    // Contrato 21: os servidores MCP desligados nesta conversa.
    mcpOff: z
      .array(z.string().regex(/^(app:[\w-]{1,64}|cli:[^\n]{1,200})$/))
      .max(MCP_SERVERS_MAX * 2)
      .optional(),
  })
  .strict()
  // Só "Reuniões escolhidas" leva a lista; as conversas do WhatsApp vão em qualquer escopo. "Só estas conversas"
  // sem nenhuma escolhida guarda o modo; com conversas, o modo fica implícito (como no contrato 24). Das fontes,
  // só as desligadas ficam.
  .transform((scope): ChatScope => {
    const base: ChatScope = scope.kind === 'meetings' ? { kind: scope.kind, meetingIds: [...new Set(scope.meetingIds ?? [])] } : { kind: scope.kind }
    const chats = [...new Set(scope.whatsappChats ?? [])]
    const mode = chatWhatsAppModeOf({ whatsappMode: scope.whatsappMode, whatsappChats: chats })
    const days = scope.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS
    const whatsapp: Partial<ChatScope> = mode === 'recent' ? {} : chats.length ? { whatsappChats: chats, whatsappDays: days } : { whatsappMode: 'chosen', whatsappDays: days }
    const off = CHAT_SOURCE_KINDS.filter((kind) => scope.sources?.[kind] === false)
    const mcpOff = [...new Set(scope.mcpOff ?? [])]
    return { ...base, ...whatsapp, ...(off.length ? { sources: Object.fromEntries(off.map((kind) => [kind, false])) } : {}), ...(mcpOff.length ? { mcpOff } : {}) }
  })

const actionBase = {
  id: z.string().regex(/^[\w-]{1,40}$/),
  status: z.enum(CHAT_ACTION_STATUSES),
  result: z.string().max(200).nullable(),
}
const chatIdOfWhatsApp = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const emailAccountId = z.string().regex(EMAIL_ACCOUNT_ID_PATTERN)

/** Ação proposta gravada com a resposta (contrato 25), já validada e com o que o app leu (nomes, número). */
export const chatActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('lembrete'),
      ...actionBase,
      at: isoDate,
      text: z.string().max(REMINDER_TEXT_MAX),
      whatsappChatId: chatIdOfWhatsApp.nullable(),
      whatsappChatName: z.string().max(200).nullable(),
      defaultTime: z.boolean(),
      // Contrato 45.
      email: z.object({ accountId: emailAccountId, messageId: z.string().min(1).max(1000), label: z.string().max(300), mailbox: z.string().max(200).nullable().optional() }).strict().nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('whatsapp-resposta'),
      ...actionBase,
      chatId: chatIdOfWhatsApp,
      chatName: z.string().max(200),
      phone: z.string().max(40).nullable(),
      group: z.boolean(),
      text: z.string().max(WHATSAPP_SEND_TEXT_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tarefa'),
      ...actionBase,
      name: z.string().max(200),
      agentId: z.string().regex(/^[\w-]{1,100}$/),
      agentName: z.string().max(200),
      message: z.string().max(CHAT_TEXT_MAX),
      schedule: scheduleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('abrir'),
      ...actionBase,
      screen: z.enum(OPEN_SCREENS),
      target: z.string().max(200).nullable(),
      label: z.string().max(300),
    })
    .strict(),
  // Contrato 45: os cartões de email, com o que o app leu do cache quando a resposta terminou.
  z
    .object({
      kind: z.literal('emails'),
      ...actionBase,
      items: z
        .array(
          z
            .object({
              accountId: emailAccountId,
              messageId: z.string().min(1).max(1000),
              account: z.string().max(320),
              from: z.string().max(300),
              fromAddress: z.string().max(320),
              subject: z.string().max(500),
              date: z.number(),
              seen: z.boolean(),
              pending: z.boolean(),
              mailbox: z.string().max(200).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(EMAIL_CARD_ITEMS_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal('email-resposta'),
      ...actionBase,
      accountId: emailAccountId,
      account: z.string().max(320),
      messageId: z.string().min(1).max(1000),
      mailbox: z.string().max(200).nullable().default(null),
      inReplyTo: z.string().max(1000).nullable(),
      to: z.array(z.string().max(320)).min(1).max(EMAIL_RECIPIENTS_MAX),
      toLabel: z.string().max(500),
      subject: z.string().max(EMAIL_SUBJECT_MAX),
      text: z.string().max(EMAIL_TEXT_MAX),
    })
    .strict(),
])

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(CHAT_TEXT_MAX),
  at: isoDate,
  error: z.enum(CHAT_ERRORS).optional(),
  steps: z.array(chatStepSchema).max(CHAT_STEPS_MAX).optional(),
  thinking: z.string().max(CHAT_THINKING_MAX).optional(),
  denied: z.number().int().min(0).max(1e6).optional(),
  plan: z.array(chatPlanEntrySchema).max(CHAT_PLAN_MAX).optional(),
  meta: chatMetaSchema.optional(),
  model: z.enum(CHAT_MODELS).optional(),
  actions: z.array(chatActionSchema).max(ACTIONS_PER_MESSAGE_MAX).optional(),
})

export const chatSchema = z.object({
  id: chatIdSchema,
  meetingId: z.string().min(1).max(200).nullable(),
  title: z.string().max(CHAT_TITLE_MAX),
  createdAt: isoDate,
  messages: z.array(messageSchema).max(CHAT_MESSAGES_MAX),
  // Contrato 15 não tinha escopo nem modelo: "Todas as reuniões" e o modelo das Configurações.
  scope: chatScopeSchema.default({ kind: 'all' }),
  model: z.enum(CHAT_MODELS).nullable().default(null),
  // Contrato 17: "Pensar mais" desligado nas conversas que não tinham o campo.
  thinkMore: z.boolean().default(false),
})

export interface ChatStore {
  /** Todas as conversas válidas, da mais recente (última mensagem) para a mais antiga. */
  list(): Promise<ChatListItem[]>
  get(id: string): Promise<Chat | null>
  /** Grava a conversa inteira, cortando para os limites. */
  save(chat: Chat): Promise<Chat>
  /**
   * Lê, aplica `fn` e grava, na mesma vez da fila: nenhuma outra gravação da conversa entra no meio (uma
   * resposta que termina durante um "Renomear" não apaga o título, nem o título apaga a resposta). `fn`
   * recebe `null` se a conversa não existe; devolvendo `null`, nada é gravado.
   */
  mutate(id: string, fn: (current: Chat | null) => Chat | null): Promise<Chat | null>
  remove(id: string): Promise<boolean>
}

/** Os limites do CA6 aplicados antes de gravar. */
export function clampChat(chat: Chat): Chat {
  return {
    ...chat,
    title: chat.title.slice(0, CHAT_TITLE_MAX),
    messages: chat.messages.slice(-CHAT_MESSAGES_MAX).map((message) => ({
      ...message,
      text: message.text.slice(0, CHAT_TEXT_MAX),
      ...(message.thinking !== undefined ? { thinking: message.thinking.slice(0, CHAT_THINKING_MAX) } : {}),
      ...(message.steps !== undefined ? { steps: message.steps.slice(-CHAT_STEPS_MAX) } : {}),
    })),
  }
}

export function chatListItem(chat: Chat): ChatListItem {
  return { id: chat.id, meetingId: chat.meetingId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.messages.at(-1)?.at ?? chat.createdAt }
}

export function createFileChatStore({ dir }: { dir: string }): ChatStore {
  const folder = join(dir, CHATS_DIR)
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const pathOf = (id: string): string | null => (chatIdSchema.safeParse(id).success ? join(folder, `${id}.json`) : null)

  async function read(file: string, id: string): Promise<Chat | null> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const result = chatSchema.safeParse(parsed)
    // Conversa copiada com outro nome também não vale.
    if (!result.success || result.data.id !== id) return null
    return result.data
  }

  /** Gravação atômica; só dentro da fila. */
  async function write(input: Chat): Promise<Chat> {
    const chat = chatSchema.parse(clampChat(input))
    const file = pathOf(chat.id)
    if (!file) throw new Error('id de conversa inválido')
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await chmod(folder, 0o700)
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify(chat, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    return chat
  }

  return {
    list: () =>
      serial(async () => {
        let names: string[]
        try {
          names = await readdir(folder)
        } catch {
          return []
        }
        const chats = await Promise.all(names.filter((name) => /^[\w-]{1,100}\.json$/.test(name)).map((name) => read(join(folder, name), name.slice(0, -'.json'.length))))
        return chats
          .filter((chat): chat is Chat => chat !== null)
          .map(chatListItem)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      }),

    get: (id) =>
      serial(async () => {
        const file = pathOf(id)
        return file ? read(file, id) : null
      }),

    save: (input) => serial(() => write(input)),

    mutate: (id, fn) =>
      serial(async () => {
        const file = pathOf(id)
        if (!file) return null
        const next = fn(await read(file, id))
        if (!next) return null
        if (next.id !== id) throw new Error('id de conversa trocado')
        return write(next)
      }),

    remove: (id) =>
      serial(async () => {
        const file = pathOf(id)
        if (!file) return false
        try {
          await rm(file)
          return true
        } catch {
          return false
        }
      }),
  }
}
