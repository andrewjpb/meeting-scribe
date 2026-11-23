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
// Contrato 78: os cartões de evento e de alterar e apagar um lembrete, e o estado `failed` (com a frase do erro).
// Contrato 117: os quatro cartões do funil de vendas (conversa antiga, sem eles, carrega como antes).
// Contrato 127: os três cartões das tarefas e a tarefa criada pelo cartão do lembrete (`tarefaId`, ausente nos antigos).
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
  chatSourcesToKeep,
  chatWhatsAppModeOf,
  type Chat,
  type ChatListItem,
  type ChatScope,
} from '../../shared/chat'
import {
  ACTIONS_PER_MESSAGE_MAX,
  CHAT_ACTION_ERROR_MAX,
  CHAT_ACTION_STATUSES,
  EMAIL_CARD_ITEMS_MAX,
  EMAIL_REPLY_ATTACHMENTS_MAX,
  EMAIL_REPLY_MISSING_MAX,
  EMAIL_REPLY_MISSING_TEXT_MAX,
  EMAIL_REPLY_REQUESTED_MAX,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  FUNIL_CARD_CONTATOS_MAX,
  FUNIL_CARD_NOTA_MAX,
  FUNIL_CARD_PASSO_MAX,
  INSTAGRAM_DRAFT_CAPTION_MAX,
  OPEN_SCREENS,
  REMINDER_TEXT_MAX,
} from '../../shared/assistant'
import { FUNIL_ETAPA_NOME_MAX, FUNIL_NOME_MAX, FUNIL_NOTAS_MAX } from '../../shared/funil'
import { TAREFA_TITULO_MAX } from '../../shared/tarefas'
import { EMAIL_ACCOUNT_ID_PATTERN, EMAIL_RECIPIENTS_MAX, EMAIL_SUBJECT_MAX, EMAIL_TEXT_MAX } from '../../shared/email'
import { automationIdSchema, scheduleSchema } from '../../shared/automations-schema'
import { MCP_SERVERS_MAX } from '../../shared/mcp'
import { PUBLICATION_ID_PATTERN, REDES_ACCOUNT_ID_PATTERN } from '../../shared/redes'
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
  // só as desligadas ficam (contrato 76: da Redes, que começa desligada, só o `true`).
  .transform((scope): ChatScope => {
    const base: ChatScope = scope.kind === 'meetings' ? { kind: scope.kind, meetingIds: [...new Set(scope.meetingIds ?? [])] } : { kind: scope.kind }
    const chats = [...new Set(scope.whatsappChats ?? [])]
    const mode = chatWhatsAppModeOf({ whatsappMode: scope.whatsappMode, whatsappChats: chats })
    const days = scope.whatsappDays ?? WHATSAPP_DEFAULT_SCOPE_DAYS
    const whatsapp: Partial<ChatScope> = mode === 'recent' ? {} : chats.length ? { whatsappChats: chats, whatsappDays: days } : { whatsappMode: 'chosen', whatsappDays: days }
    const sources = chatSourcesToKeep(scope.sources)
    const mcpOff = [...new Set(scope.mcpOff ?? [])]
    return { ...base, ...whatsapp, ...(Object.keys(sources).length ? { sources } : {}), ...(mcpOff.length ? { mcpOff } : {}) }
  })

const actionBase = {
  id: z.string().regex(/^[\w-]{1,40}$/),
  status: z.enum(CHAT_ACTION_STATUSES),
  result: z.string().max(200).nullable(),
}
const chatIdOfWhatsApp = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
/** Contrato 78: o id de uma agenda do EventKit, como o helper aceita. */
export const calendarIdSchema = z.string().min(1).max(1024)
/** Contrato 78: agendas graváveis guardadas num cartão de evento (as a mais ficam de fora). */
export const CHAT_CALENDARS_MAX = 50
const emailAccountId = z.string().regex(EMAIL_ACCOUNT_ID_PATTERN)
/** Contrato 117: as etapas abertas guardadas num cartão de criar oportunidade. */
const FUNIL_CARD_ETAPAS_MAX = 100
const funilCardId = z.string().max(200)
const funilCardDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const funilCardPasso = z.object({ texto: z.string().max(FUNIL_CARD_PASSO_MAX), data: funilCardDia.nullable() }).strict()
const funilCardContato = z.object({ nome: z.string().max(FUNIL_NOME_MAX), email: z.string().max(320).nullable(), contatoId: funilCardId.nullable() }).strict()
/** Contrato 127: o id de uma tarefa num cartão (o uuid do `tarefas.json`). */
const tarefaCardId = z.string().regex(/^[\w-]{1,100}$/)
/** Contrato 168: um anexo das pastas numa resposta de email (o id do índice, nunca um caminho absoluto). */
const emailReplyAttachment = z
  .object({
    id: z.string().regex(/^[0-9a-f]{16}$/),
    name: z.string().max(1000),
    relPath: z.string().max(4096),
    folderLabel: z.string().max(1000),
    bytes: z.number().int().min(0),
    requested: z.string().max(EMAIL_REPLY_REQUESTED_MAX).nullable(),
  })
  .strict()

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
      // Contrato 127.
      tarefaId: tarefaCardId.nullable().optional(),
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
  // Contrato 128 (R29, D15): o cartão `tarefa` passou a `agendamento`; o gravado antes ainda lê, já com o nome novo.
  z
    .object({
      kind: z.literal(['tarefa', 'agendamento']).transform((): 'agendamento' => 'agendamento'),
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
      // Contrato 168: os cartões gravados antes dos anexos das pastas ficam sem nenhum.
      attachments: z.array(emailReplyAttachment).max(EMAIL_REPLY_ATTACHMENTS_MAX).default([]),
      missing: z.array(z.string().max(EMAIL_REPLY_MISSING_TEXT_MAX)).max(EMAIL_REPLY_MISSING_MAX).default([]),
    })
    .strict(),
  // Contrato 56: o lote que o Assistente moveu (o cartão lê o resto do `batches.json`).
  z
    .object({
      kind: z.literal('email-lote'),
      ...actionBase,
      batchId: z.string().uuid(),
      accountId: emailAccountId,
      account: z.string().max(320),
    })
    .strict(),
  // Contrato 78: o evento no Calendário do Mac e os cartões de alterar e apagar um lembrete.
  z
    .object({
      kind: z.literal('evento'),
      ...actionBase,
      title: z.string().min(1).max(EVENT_TITLE_MAX),
      start: isoDate,
      end: isoDate,
      allDay: z.boolean(),
      location: z.string().max(EVENT_LOCATION_MAX).nullable(),
      notes: z.string().max(EVENT_NOTES_MAX).nullable(),
      calendarId: calendarIdSchema.nullable(),
      calendarTitle: z.string().max(300).nullable(),
      calendars: z
        .array(
          z
            .object({
              id: calendarIdSchema,
              title: z.string().max(300),
              source: z.string().max(300),
              color: z
                .string()
                .regex(/^#[0-9A-Fa-f]{6}$/)
                .nullable(),
              isDefault: z.boolean(),
            })
            .strict(),
        )
        .max(CHAT_CALENDARS_MAX),
      access: z.enum(['full', 'not-determined', 'denied', 'unavailable']),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lembrete-editar'),
      ...actionBase,
      taskId: automationIdSchema,
      currentText: z.string().max(REMINDER_TEXT_MAX),
      currentAt: isoDate,
      text: z.string().max(REMINDER_TEXT_MAX).nullable(),
      at: isoDate.nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lembrete-apagar'),
      ...actionBase,
      taskId: automationIdSchema,
      text: z.string().max(REMINDER_TEXT_MAX),
      at: isoDate,
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  // Contrato 76: o rascunho para o Instagram (a conta lida do app; o rascunho criado, depois do clique).
  z
    .object({
      kind: z.literal('instagram-rascunho'),
      ...actionBase,
      accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN),
      username: z.string().max(100),
      caption: z.string().max(INSTAGRAM_DRAFT_CAPTION_MAX),
      at: isoDate.nullable(),
      publicationId: z.string().regex(PUBLICATION_ID_PATTERN).nullable(),
    })
    .strict(),
  // Contrato 117: o funil de vendas (os ids, as etapas e os nomes lidos do funil do app).
  z
    .object({
      kind: z.literal('oportunidade-criar'),
      ...actionBase,
      titulo: z.string().max(FUNIL_NOME_MAX),
      empresa: z.string().max(FUNIL_NOME_MAX).nullable(),
      contatos: z.array(funilCardContato).max(FUNIL_CARD_CONTATOS_MAX),
      etapaId: funilCardId,
      etapas: z.array(z.object({ id: funilCardId, nome: z.string().max(FUNIL_ETAPA_NOME_MAX) }).strict()).max(FUNIL_CARD_ETAPAS_MAX),
      valor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
      previsao: funilCardDia.nullable(),
      proximoPasso: funilCardPasso.nullable(),
      oportunidadeId: funilCardId.nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('oportunidade-mover'),
      ...actionBase,
      oportunidadeId: funilCardId,
      titulo: z.string().max(FUNIL_NOME_MAX),
      de: z.string().max(FUNIL_ETAPA_NOME_MAX),
      paraEtapaId: funilCardId,
      para: z.string().max(FUNIL_ETAPA_NOME_MAX),
      nota: z.string().max(FUNIL_CARD_NOTA_MAX).nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('oportunidade-proximo-passo'),
      ...actionBase,
      oportunidadeId: funilCardId,
      titulo: z.string().max(FUNIL_NOME_MAX),
      texto: z.string().max(FUNIL_CARD_PASSO_MAX),
      data: funilCardDia.nullable(),
      anterior: z
        .object({ texto: z.string().max(FUNIL_NOTAS_MAX), data: funilCardDia.nullable() })
        .strict()
        .nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('contato-criar'),
      ...actionBase,
      nome: z.string().max(FUNIL_NOME_MAX),
      email: z.string().max(320).nullable(),
      telefone: z.string().max(40).nullable(),
      empresa: z.string().max(FUNIL_NOME_MAX).nullable(),
      cargo: z.string().max(FUNIL_NOME_MAX).nullable(),
      existenteId: funilCardId.nullable(),
      existenteNome: z.string().max(FUNIL_NOME_MAX).nullable(),
      contatoId: funilCardId.nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  // Contrato 127: as tarefas (os nomes e os títulos lidos do app).
  z
    .object({
      kind: z.literal('tarefa-criar'),
      ...actionBase,
      titulo: z.string().max(TAREFA_TITULO_MAX),
      prazo: funilCardDia.nullable(),
      lembreteEm: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
      oportunidade: z.object({ id: funilCardId, titulo: z.string().max(FUNIL_NOME_MAX) }).strict().nullable(),
      contato: z.object({ id: funilCardId, nome: z.string().max(FUNIL_NOME_MAX) }).strict().nullable(),
      ambiguo: z
        .object({ campo: z.enum(['oportunidade', 'contato']), texto: z.string().max(FUNIL_NOME_MAX) })
        .strict()
        .nullable(),
      ambiguoContato: z.string().max(FUNIL_NOME_MAX).nullable().optional(),
      tarefaId: tarefaCardId.nullable(),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tarefa-concluir'),
      ...actionBase,
      tarefaId: tarefaCardId,
      titulo: z.string().max(TAREFA_TITULO_MAX),
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tarefa-adiar'),
      ...actionBase,
      tarefaId: tarefaCardId,
      titulo: z.string().max(TAREFA_TITULO_MAX),
      prazoAntes: funilCardDia.nullable(),
      prazo: funilCardDia,
      error: z.string().max(CHAT_ACTION_ERROR_MAX).nullable(),
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
