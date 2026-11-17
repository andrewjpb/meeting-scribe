// Ações do Assistente (contrato 25, CA3 e CA5). Duas partes, as duas no main:
// - `extractActions`: no fim de uma resposta do Assistente, os blocos cercados `lap-acao` com JSON viram ações. O
//   JSON é validado aqui (zod); o que o cartão mostra (o nome e o número da conversa, o nome do agente, o título da
//   reunião) é lido do app, nunca do texto do modelo. Bloco inválido, de conversa ou agente que não existe, ou acima
//   do limite fica no texto como veio (texto comum). Ação nenhuma roda aqui: o cartão só é gravado como `proposed`.
// - `createChatActions`: o que o clique no cartão faz. "Criar lembrete" cria a tarefa "uma vez" das Automações (23);
//   "Descartar", "Enviar" (que já passou pelo envio do contrato 24, com o token de clique e o diálogo nativo) e a
//   tarefa salva no formulário só gravam o estado. Cartão usado não roda de novo (recarregar a conversa não repete).
// Nada daqui importa o serviço do WhatsApp: o nome das conversas chega por uma função de leitura injetada.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ACTION_FENCE,
  ACTIONS_PER_MESSAGE_MAX,
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
  type OpenScreen,
} from '../../shared/assistant'
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
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => value.replace(/\s+/g, ' '))

/** O JSON que o Claude escreve, com os nomes do contrato. Campo a mais é ignorado. */
const proposedSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('lembrete'), quando: zonedIso, texto: line(REMINDER_TEXT_MAX), conversaWhatsApp: whatsappChatId.nullable().optional(), horaPadrao: z.boolean().optional() }),
  z.object({ tipo: z.literal('whatsapp-resposta'), chatId: whatsappChatId, texto: z.string().trim().min(1).max(WHATSAPP_SEND_TEXT_MAX) }),
  z.object({ tipo: z.literal('tarefa'), nome: line(TASK_NAME_MAX), agente: z.string().trim().min(1).max(100), mensagem: z.string().trim().min(1).max(TASK_MESSAGE_MAX), schedule: scheduleSchema }),
  z.object({ tipo: z.literal('abrir'), tela: z.enum(OPEN_SCREENS), alvo: z.string().trim().max(200).nullable().optional() }),
])
type Proposed = z.infer<typeof proposedSchema>

/** O que o main lê do app para montar o cartão. */
export interface ActionResolver {
  /** Nome e tipo de uma conversa do WhatsApp; `null` se ela não existe (ou o WhatsApp não está conectado). */
  whatsappChat?: (chatId: string) => Promise<{ name: string; kind: WhatsAppChatKind; phone?: string | undefined } | null>
  agents?: () => Promise<readonly { id: string; name: string }[]>
  meeting?: (meetingId: string) => Promise<{ title: string } | null>
  now: () => number
  timeZone: () => string
  newId?: () => string
}

const SETTINGS_LABELS: Readonly<Record<string, string>> = { geral: 'Geral', gravacao: 'Gravação', claude: 'Claude', arquivos: 'Arquivos', contas: 'Contas', sobre: 'Sobre' }
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
      return {
        ...base,
        kind: 'lembrete',
        at: proposed.quando,
        text: proposed.texto,
        whatsappChatId: chat ? (proposed.conversaWhatsApp ?? null) : null,
        whatsappChatName: chat?.name ?? null,
        defaultTime: proposed.horaPadrao === true,
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
        return `- lembrete "${action.text}" para ${action.at} (${state})`
      case 'whatsapp-resposta':
        return `- resposta no WhatsApp para ${action.chatName}: "${action.text.replace(/\s+/g, ' ').slice(0, 200)}" (${state})`
      case 'tarefa':
        return `- tarefa "${action.name}" com o agente ${action.agentName} (${state})`
      case 'abrir':
        return `- botão "${action.label}"`
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
const stateRequestSchema = z.object({ ...refFields, state: z.enum(['dismissed', 'sent', 'task-created']), text: z.string().max(WHATSAPP_SEND_TEXT_MAX).optional() }).strict()

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
        const created = await deps.createReminder({ at, reminder: { text, whatsappChatId: current.whatsappChatId, whatsappChatName: current.whatsappChatName } })
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
      if (state === 'dismissed') return write(ref, (action) => (action.kind === 'abrir' ? null : { ...action, status: 'dismissed', result: DISMISSED_TEXT }))
      if (state === 'task-created') return write(ref, (action) => (action.kind === 'tarefa' ? { ...action, status: 'done', result: TASK_CREATED_TEXT } : null))
      // "Enviar" passou pelo contrato 24: grava o texto que foi e a hora; as outras escolhas "É esta conversa?" com o
      // mesmo texto saem.
      const sentAt = now()
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
