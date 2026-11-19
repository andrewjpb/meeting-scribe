// Ações do Assistente (contrato 25, CA3 e CA5). Duas partes, as duas no main:
// - `extractActions`: no fim de uma resposta do Assistente, os blocos cercados `lap-acao` com JSON viram ações. O
//   JSON é validado aqui (zod); o que o cartão mostra (o nome e o número da conversa, o nome do agente, o título da
//   reunião) é lido do app, nunca do texto do modelo. Bloco inválido, de conversa ou agente que não existe, ou acima
//   do limite fica no texto como veio (texto comum). Ação nenhuma roda aqui: o cartão só é gravado como `proposed`.
// - `createChatActions`: o que o clique no cartão faz. "Criar lembrete" cria a tarefa "uma vez" das Automações (23);
//   "Descartar", "Enviar" (que já passou pelo envio do contrato 24, com o token de clique e o diálogo nativo) e a
//   tarefa salva no formulário só gravam o estado. Cartão usado não roda de novo (recarregar a conversa não repete).
// Nada daqui importa o serviço do WhatsApp: o nome das conversas chega por uma função de leitura injetada.
// Contrato 45: os cartões de email (a lista e o rascunho de resposta) e o lembrete de responder um email. O que o cartão
// mostra (quem mandou, o assunto, a conta, o destinatário, o Message-ID) vem do cache do app pela referência "em-…";
// nada daqui importa o serviço do email nem envia: o "Enviar" do rascunho passa pelo `emailSend` do preload (o token de
// clique do contrato 42) e aqui só grava "Enviado às hh:mm".
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ACTION_FENCE,
  ACTIONS_PER_MESSAGE_MAX,
  EMAIL_CARD_ITEMS_MAX,
  emailSentText,
  AUTOMATIONS_TABS,
  DISMISSED_TEXT,
  openLabel,
  OPEN_SCREENS,
  phoneOfChatId,
  REMINDER_TEXT_MAX,
  reminderCreatedText,
  sentText,
  TASK_CREATED_TEXT,
  WHATSAPP_CHOICES_MAX,
  type ChatAction,
  type ChatActionResult,
  type EmailCardItem,
  type OpenScreen,
  type ReminderEmail,
} from '../../shared/assistant'
import { EMAIL_REF_PATTERN, EMAIL_TEXT_MAX, prefixedSubject, type EmailAccountStatus, type EmailMessage } from '../../shared/email'
import { describeSchedule, TASK_MESSAGE_MAX, TASK_NAME_MAX, type TaskReminder, type TaskSaveResult } from '../../shared/automations'
import { scheduleSchema } from '../../shared/automations-schema'
import type { Chat, ChatMessage } from '../../shared/chat'
import { SETTINGS_TABS } from '../../shared/routes'
import { WHATSAPP_CHAT_ID_PATTERN, WHATSAPP_SEND_TEXT_MAX, type WhatsAppChatKind } from '../../shared/whatsapp'
import { chatIdSchema, type ChatStore } from './store'

/** Bloco ```lap-acao … ``` numa linha própria, com o JSON dentro. */
const FENCE_PATTERN = new RegExp(`(^|\\n)[ \\t]*\`\`\`${ACTION_FENCE}[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*\`\`\`[ \\t]*(?=\\n|$)`, 'g')

/** Horário com o fuso explícito (`…-03:00` ou `…Z`): "amanhã às 9" já resolvido pelo assistente. */
const zonedIso = z
  .string()
  .max(40)
  .regex(/(Z|[+-]\d{2}:\d{2})$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
const whatsappChatId = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const emailRef = z.string().regex(EMAIL_REF_PATTERN)
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.replace(/\s+/g, ' '))

/** O JSON que o Claude escreve, com os nomes do contrato. Campo a mais é ignorado. */
const proposedSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('lembrete'), quando: zonedIso, texto: line(REMINDER_TEXT_MAX), conversaWhatsApp: whatsappChatId.nullable().optional(), horaPadrao: z.boolean().optional(), email: emailRef.nullable().optional() }),
  z.object({ tipo: z.literal('whatsapp-resposta'), chatId: whatsappChatId, texto: z.string().trim().min(1).max(WHATSAPP_SEND_TEXT_MAX) }),
  z.object({ tipo: z.literal('tarefa'), nome: line(TASK_NAME_MAX), agente: z.string().trim().min(1).max(100), mensagem: z.string().trim().min(1).max(TASK_MESSAGE_MAX), schedule: scheduleSchema }),
  z.object({ tipo: z.literal('abrir'), tela: z.enum(OPEN_SCREENS), alvo: z.string().trim().max(200).nullable().optional() }),
  // Contrato 45.
  z.object({ tipo: z.literal('emails'), mensagens: z.array(emailRef).min(1).max(EMAIL_CARD_ITEMS_MAX * 2) }),
  z.object({ tipo: z.literal('email-resposta'), email: emailRef, texto: z.string().trim().min(1).max(EMAIL_TEXT_MAX) }),
])
type Proposed = z.infer<typeof proposedSchema>

/** O que o main lê do app para montar o cartão. */
export interface ActionResolver {
  /** Nome e tipo de uma conversa do WhatsApp; `null` se ela não existe (ou o WhatsApp não está conectado). */
  whatsappChat?: (chatId: string) => Promise<{ name: string; kind: WhatsAppChatKind; phone?: string | undefined } | null>
  agents?: () => Promise<readonly { id: string; name: string }[]>
  meeting?: (meetingId: string) => Promise<{ title: string } | null>
  /** Contrato 45: o email de uma referência "em-…" (do cache, ou achado pela busca); `null` se não existe ou bloqueado. */
  email?: (ref: string) => Promise<{ status: EmailAccountStatus; message: EmailMessage; mailbox: string | null; pending: boolean } | null>
  now: () => number
  timeZone: () => string
  newId?: () => string
}

const SETTINGS_LABELS: Readonly<Record<string, string>> = { geral: 'Geral', gravacao: 'Gravação', claude: 'Claude', arquivos: 'Arquivos', contas: 'Contas', plugins: 'Plugins', sobre: 'Sobre' }
const AUTOMATIONS_LABELS: Readonly<Record<string, string>> = { agentes: 'Agentes', tarefas: 'Tarefas agendadas', execucoes: 'Execuções' }

async function openTarget(screen: OpenScreen, target: string | null, resolver: ActionResolver): Promise<{ target: string | null; name: string | null } | null> {
  if (screen === 'reuniao') {
    if (!target || !/^[\w-]{1,200}$/.test(target)) return null
    const meeting = await resolver.meeting?.(target).catch(() => null)
    return meeting ? { target, name: meeting.title } : null
  }
  if (screen === 'whatsapp') {
    if (!target) return { target: null, name: null }
    if (!WHATSAPP_CHAT_ID_PATTERN.test(target)) return null
    const chat = await resolver.whatsappChat?.(target).catch(() => null)
    return chat ? { target, name: chat.name } : null
  }
  if (screen === 'configuracoes') {
    if (!target) return { target: null, name: null }
    return (SETTINGS_TABS as readonly string[]).includes(target) ? { target, name: SETTINGS_LABELS[target] ?? target } : null
  }
  if (screen === 'automacoes') {
    if (!target) return { target: null, name: null }
    return (AUTOMATIONS_TABS as readonly string[]).includes(target) ? { target, name: AUTOMATIONS_LABELS[target] ?? target } : null
  }
  // Reuniões e Gravação não têm alvo.
  return { target: null, name: null }
}

type FoundEmail = NonNullable<Awaited<ReturnType<NonNullable<ActionResolver['email']>>>>

const nameOf = (address: { name: string | null; address: string } | undefined): string => (address ? (address.name ?? '').replace(/\s+/g, ' ').trim() || address.address : 'Remetente desconhecido')

/** "Marina Rocha · Proposta revisada": o rótulo do lembrete de um email. */
const emailLabel = (found: FoundEmail): string => `${nameOf(found.message.from[0])} · ${found.message.subject.replace(/\s+/g, ' ').trim() || '(sem assunto)'}`.slice(0, 300)

function cardItem(found: FoundEmail): EmailCardItem {
  const from = found.message.from[0]
  return {
    accountId: found.status.account.id,
    messageId: found.message.id,
    account: found.status.account.address,
    from: nameOf(from).slice(0, 300),
    fromAddress: (from?.address ?? '').slice(0, 320),
    subject: found.message.subject.slice(0, 500),
    date: found.message.date,
    seen: found.message.seen,
    pending: found.pending,
    mailbox: found.mailbox ? found.mailbox.slice(0, 200) : null,
  }
}

/** A ação validada, com o que o app leu; `null` se ela não vale (o bloco fica como texto). */
async function resolve(proposed: Proposed, id: string, resolver: ActionResolver): Promise<ChatAction | null> {
  const base = { id, status: 'proposed' as const, result: null }
  switch (proposed.tipo) {
    case 'lembrete': {
      const at = Date.parse(proposed.quando)
      if (at <= resolver.now()) return null
      let chat: { name: string } | null = null
      if (proposed.conversaWhatsApp) {
        chat = (await resolver.whatsappChat?.(proposed.conversaWhatsApp).catch(() => null)) ?? null
        if (!chat) return null
      }
      let email: ReminderEmail | null = null
      if (proposed.email) {
        const found = await resolver.email?.(proposed.email).catch(() => null)
        if (!found) return null
        email = { accountId: found.status.account.id, messageId: found.message.id, label: emailLabel(found), ...(found.mailbox ? { mailbox: found.mailbox.slice(0, 200) } : {}) }
      }
      return {
        ...base,
        kind: 'lembrete',
        at: proposed.quando,
        text: proposed.texto,
        whatsappChatId: chat ? (proposed.conversaWhatsApp ?? null) : null,
        whatsappChatName: chat?.name ?? null,
        defaultTime: proposed.horaPadrao === true,
        ...(email ? { email } : {}),
      }
    }
    case 'whatsapp-resposta': {
      const chat = await resolver.whatsappChat?.(proposed.chatId).catch(() => null)
      if (!chat) return null
      return { ...base, kind: 'whatsapp-resposta', chatId: proposed.chatId, chatName: chat.name, phone: chat.kind === 'group' ? null : (chat.phone ?? phoneOfChatId(proposed.chatId)), group: chat.kind === 'group', text: proposed.texto }
    }
    case 'tarefa': {
      const agents = (await resolver.agents?.().catch(() => [])) ?? []
      const wanted = proposed.agente.toLocaleLowerCase('pt-BR')
      const agent = agents.find((candidate) => candidate.id === proposed.agente) ?? agents.find((candidate) => candidate.name.toLocaleLowerCase('pt-BR') === wanted)
      if (!agent) return null
      // Frequência que não se descreve (cron inválido já não passa no esquema) também não vale.
      if (!describeSchedule(proposed.schedule, resolver.timeZone())) return null
      return { ...base, kind: 'tarefa', name: proposed.nome, agentId: agent.id, agentName: agent.name, message: proposed.mensagem, schedule: proposed.schedule }
    }
    case 'abrir': {
      const found = await openTarget(proposed.tela, proposed.alvo ?? null, resolver)
      if (!found) return null
      return { ...base, kind: 'abrir', screen: proposed.tela, target: found.target, label: openLabel(proposed.tela, found.name) }
    }
    case 'emails': {
      // As referências que não existem ficam de fora; nenhuma que vale, o bloco fica como texto.
      const items: EmailCardItem[] = []
      for (const ref of [...new Set(proposed.mensagens)]) {
        if (items.length >= EMAIL_CARD_ITEMS_MAX) break
        const found = await resolver.email?.(ref).catch(() => null)
        if (found) items.push(cardItem(found))
      }
      return items.length ? { ...base, kind: 'emails', items } : null
    }
    case 'email-resposta': {
      const found = await resolver.email?.(proposed.email).catch(() => null)
      if (!found) return null
      const { message, status } = found
      // Para quem mandou (ou, num enviado, os mesmos destinatários), sem a própria conta.
      const own = status.account.address.toLowerCase()
      const targets = (message.folder === 'sent' ? message.to : message.from).filter((item) => item.address.toLowerCase() !== own)
      const to = [...new Set(targets.map((item) => item.address))].slice(0, 10)
      if (!to.length) return null
      const inReplyTo = message.messageId && /^<[^<>\s]{1,250}>$/.test(message.messageId) ? message.messageId : null
      return {
        ...base,
        kind: 'email-resposta',
        accountId: status.account.id,
        account: status.account.address,
        messageId: message.id,
        mailbox: found.mailbox ? found.mailbox.slice(0, 200) : null,
        inReplyTo,
        to,
        toLabel: targets.map((item) => (item.name ? `${nameOf(item)} <${item.address}>` : item.address)).join(', ').slice(0, 500),
        subject: prefixedSubject('Re:', message.subject).slice(0, 998),
        text: proposed.texto,
      }
    }
  }
}

/**
 * Os blocos `lap-acao` de uma resposta do Assistente: os válidos saem do texto e viram ações `proposed`; os
 * inválidos (JSON quebrado, campo errado, conversa ou agente que não existe, data no passado) e os acima do limite
 * ficam no texto como vieram. Nada é executado.
 */
export async function extractActions(text: string, resolver: ActionResolver): Promise<{ text: string; actions: ChatAction[] }> {
  const newId = resolver.newId ?? (() => randomUUID().slice(0, 8))
  const actions: ChatAction[] = []
  const kept: string[] = []
  let cursor = 0
  for (const match of text.matchAll(FENCE_PATTERN)) {
    const start = match.index + (match[1]?.length ?? 0)
    const end = match.index + match[0].length
    kept.push(text.slice(cursor, start))
    cursor = end
    let action: ChatAction | null = null
    if (actions.length < ACTIONS_PER_MESSAGE_MAX) {
      let json: unknown
      try {
        json = JSON.parse(match[2] ?? '')
      } catch {
        json = undefined
      }
      const parsed = proposedSchema.safeParse(json)
      const choices = actions.filter((known) => known.kind === 'whatsapp-resposta').length
      if (parsed.success && !(parsed.data.tipo === 'whatsapp-resposta' && choices >= WHATSAPP_CHOICES_MAX)) action = await resolve(parsed.data, newId(), resolver)
    }
    if (action) actions.push(action)
    else kept.push(text.slice(start, end))
  }
  kept.push(text.slice(cursor))
  const rest = actions.length ? kept.join('').replace(/\n{3,}/g, '\n\n').trim() : text
  return { text: rest, actions }
}

/** Para o histórico de um processo novo: o que foi proposto e o que a pessoa fez com cada cartão. */
export function actionsHistory(actions: readonly ChatAction[] | undefined): string {
  if (!actions?.length) return ''
  const lines = actions.map((action) => {
    const state = action.status === 'proposed' ? 'esperando o clique' : (action.result ?? action.status)
    switch (action.kind) {
      case 'lembrete':
        return `- lembrete "${action.text}" para ${action.at}${action.email ? ` sobre o email ${action.email.label}` : ''} (${state})`
      case 'whatsapp-resposta':
        return `- resposta no WhatsApp para ${action.chatName}: "${action.text.replace(/\s+/g, ' ').slice(0, 200)}" (${state})`
      case 'tarefa':
        return `- tarefa "${action.name}" com o agente ${action.agentName} (${state})`
      case 'abrir':
        return `- botão "${action.label}"`
      case 'emails':
        return `- cartão com ${action.items.length} email(s): ${action.items.map((item) => `${item.from} · "${item.subject.replace(/\s+/g, ' ').slice(0, 80)}"`).join('; ')}`
      case 'email-resposta':
        return `- resposta por email para ${action.toLabel} ("${action.subject}"): "${action.text.replace(/\s+/g, ' ').slice(0, 200)}" (${state})`
    }
  })
  return ['[Cartões propostos nesta resposta:', ...lines, ']'].join('\n')
}

export interface ChatActionsDeps {
  store: Pick<ChatStore, 'get' | 'mutate'>
  /** Automações (23): a tarefa "uma vez" sem agente. */
  createReminder: (input: { at: string; reminder: TaskReminder }) => Promise<TaskSaveResult>
  timeZone: () => string
  now?: () => number
}

export interface ChatActions {
  /** "Criar lembrete" (com a data e o texto do "Editar"). */
  reminder(request: unknown): Promise<ChatActionResult>
  /** "Descartar", "Enviada" (depois do envio do contrato 24) e "Tarefa criada" (depois do formulário). */
  setState(request: unknown): Promise<ChatActionResult>
}

const refFields = { chatId: chatIdSchema, index: z.number().int().min(0).max(10_000), actionId: z.string().regex(/^[\w-]{1,40}$/) }
const reminderRequestSchema = z.object({ ...refFields, at: zonedIso.optional(), text: z.string().max(REMINDER_TEXT_MAX * 2).optional() }).strict()
const stateRequestSchema = z.object({ ...refFields, state: z.enum(['dismissed', 'sent', 'task-created']), text: z.string().max(Math.max(WHATSAPP_SEND_TEXT_MAX, EMAIL_TEXT_MAX)).optional() }).strict()

type Ref = { chatId: string; index: number; actionId: string }

export function createChatActions(deps: ChatActionsDeps): ChatActions {
  const now = deps.now ?? Date.now
  /** Cartões com um clique em andamento: o segundo clique não cria outro lembrete. */
  const busy = new Set<string>()
  const keyOf = (ref: Ref): string => `${ref.chatId}:${ref.index}:${ref.actionId}`

  function actionIn(chat: Chat | null, ref: Ref): ChatAction | null {
    const message: ChatMessage | undefined = chat?.messages[ref.index]
    if (!message || message.role !== 'assistant') return null
    return message.actions?.find((action) => action.id === ref.actionId) ?? null
  }

  /** Troca a ação (e, com `others`, as outras da mesma resposta) na conversa, na mesma vez da fila. */
  async function write(ref: Ref, change: (action: ChatAction) => ChatAction | null, others?: (action: ChatAction, before: ChatAction) => ChatAction): Promise<ChatActionResult> {
    let error: 'missing' | 'done' | null = null
    const saved = await deps.store.mutate(ref.chatId, (chat) => {
      const current = actionIn(chat, ref)
      if (!chat || !current) {
        error = 'missing'
        return null
      }
      if (current.status !== 'proposed') {
        error = 'done'
        return null
      }
      const next = change(current)
      if (!next) {
        error = 'done'
        return null
      }
      return {
        ...chat,
        messages: chat.messages.map((message, at) =>
          at !== ref.index ? message : { ...message, actions: (message.actions ?? []).map((action) => (action.id === ref.actionId ? next : others ? others(action, current) : action)) },
        ),
      }
    })
    if (error) return { ok: false, error }
    return saved ? { ok: true, chat: saved } : { ok: false, error: 'missing' }
  }

  return {
    async reminder(request) {
      const parsed = reminderRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const ref = parsed.data
      const key = keyOf(ref)
      if (busy.has(key)) return { ok: false, error: 'done' }
      busy.add(key)
      try {
        const current = actionIn(await deps.store.get(ref.chatId), ref)
        if (!current || current.kind !== 'lembrete') return { ok: false, error: 'missing' }
        if (current.status !== 'proposed') return { ok: false, error: 'done' }
        const at = parsed.data.at ?? current.at
        const text = (parsed.data.text ?? current.text).replace(/\s+/g, ' ').trim()
        if (!text || text.length > REMINDER_TEXT_MAX) return { ok: false, error: 'invalid' }
        if (Date.parse(at) <= now()) return { ok: false, error: 'past' }
        const created = await deps.createReminder({ at, reminder: { text, whatsappChatId: current.whatsappChatId, whatsappChatName: current.whatsappChatName, ...(current.email ? { email: current.email } : {}) } })
        if (!created.ok) return { ok: false, error: created.error === 'past' ? 'past' : created.error === 'full' ? 'full' : 'invalid' }
        return await write(ref, (action) => (action.kind === 'lembrete' ? { ...action, at, text, status: 'done', result: reminderCreatedText(at, deps.timeZone()) } : null))
      } finally {
        busy.delete(key)
      }
    },

    async setState(request) {
      const parsed = stateRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { state, text } = parsed.data
      const ref = parsed.data
      if (busy.has(keyOf(ref))) return { ok: false, error: 'done' }
      if (state === 'dismissed') return write(ref, (action) => (action.kind === 'abrir' || action.kind === 'emails' ? null : { ...action, status: 'dismissed', result: DISMISSED_TEXT }))
      if (state === 'task-created') return write(ref, (action) => (action.kind === 'tarefa' ? { ...action, status: 'done', result: TASK_CREATED_TEXT } : null))
      // "Enviar" passou pelo contrato 24: grava o texto que foi e a hora; as outras escolhas "É esta conversa?" com o
      // mesmo texto saem.
      const sentAt = now()
      // Contrato 45: o email já saiu pelo `emailSend` (o token de clique do contrato 42); aqui só o estado.
      if ((await deps.store.get(ref.chatId).then((chat) => actionIn(chat, ref)))?.kind === 'email-resposta') {
        if (text !== undefined && text.length > EMAIL_TEXT_MAX) return { ok: false, error: 'invalid' }
        return write(
          ref,
          (action) => (action.kind === 'email-resposta' ? { ...action, text: text?.trim() ? text : action.text, status: 'done', result: emailSentText(sentAt) } : null),
          (other, before) =>
            other.kind === 'email-resposta' && other.status === 'proposed' && before.kind === 'email-resposta' && other.messageId !== before.messageId && other.text === before.text
              ? { ...other, status: 'dismissed', result: DISMISSED_TEXT }
              : other,
        )
      }
      if (text !== undefined && text.length > WHATSAPP_SEND_TEXT_MAX) return { ok: false, error: 'invalid' }
      return write(
        ref,
        (action) => (action.kind === 'whatsapp-resposta' ? { ...action, text: text?.trim() ? text : action.text, status: 'done', result: sentText(sentAt) } : null),
        (other, before) =>
          other.kind === 'whatsapp-resposta' && other.status === 'proposed' && before.kind === 'whatsapp-resposta' && other.chatId !== before.chatId && other.text === before.text
            ? { ...other, status: 'dismissed', result: DISMISSED_TEXT }
            : other,
      )
    },
  }
}
