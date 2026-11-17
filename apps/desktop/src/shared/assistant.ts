// Assistente (contrato 25): as ações que o Claude propõe no fim da resposta e o que o renderer e o main trocam
// sobre elas. O Claude só escreve um bloco cercado `lap-acao` com um JSON; o main valida (inválido vira texto
// comum), lê do app o que o cartão mostra (o nome e o número da conversa, o nome do agente) e grava a ação com a
// resposta. Nada roda sem o clique da pessoa no cartão: o lembrete vira uma tarefa "uma vez" das Automações (23),
// a resposta no WhatsApp passa pelo envio do contrato 24 (token de clique e diálogo nativo) e a tarefa abre o
// formulário do 23 preenchido. Sem zod e sem Node: o renderer usa as frases.
import { formatRunAt, wallTime, type Schedule } from './automations'
import type { Chat } from './chat'

/** Linguagem da cerca do bloco de ação: ```lap-acao ... ```. */
export const ACTION_FENCE = 'lap-acao'
/** Cartões numa resposta; os blocos a mais viram texto. */
export const ACTIONS_PER_MESSAGE_MAX = 6
/** "É esta conversa?": no máximo 3 cartões de resposta no WhatsApp numa resposta. */
export const WHATSAPP_CHOICES_MAX = 3
export const REMINDER_TEXT_MAX = 300
/** Pedido sem hora: o lembrete fica para as 09:00 e o cartão diz isso. */
export const REMINDER_DEFAULT_TIME = '09:00'

/** Telas que o botão "Abrir" alcança. `alvo`: a reunião, a conversa, a aba de Configurações ou a aba das Automações. */
export const OPEN_SCREENS = ['reuniao', 'reunioes', 'whatsapp', 'configuracoes', 'automacoes', 'gravacao'] as const
export type OpenScreen = (typeof OPEN_SCREENS)[number]
export const OPEN_SCREEN_LABELS: Readonly<Record<OpenScreen, string>> = {
  reuniao: 'a reunião',
  reunioes: 'Reuniões',
  whatsapp: 'WhatsApp',
  configuracoes: 'Configurações',
  automacoes: 'Automações',
  gravacao: 'Gravação',
}
/** Abas das Automações que o "Abrir" aceita. */
export const AUTOMATIONS_TABS = ['agentes', 'tarefas', 'execucoes'] as const

/** `proposed`: o cartão espera o clique; `done`: feito (criado, enviado); `dismissed`: "Descartar". */
export const CHAT_ACTION_STATUSES = ['proposed', 'done', 'dismissed'] as const
export type ChatActionStatus = (typeof CHAT_ACTION_STATUSES)[number]
export const CHAT_ACTION_KINDS = ['lembrete', 'whatsapp-resposta', 'tarefa', 'abrir'] as const
export type ChatActionKind = (typeof CHAT_ACTION_KINDS)[number]

interface ActionBase {
  /** Único na resposta. */
  id: string
  status: ChatActionStatus
  /** A frase do estado depois do clique ("Lembrete criado · ter 17/11 09:00", "Enviada às 19:40", "Descartado"). */
  result: string | null
}

/** `lembrete`: uma notificação do macOS no horário, como tarefa "uma vez" das Automações. */
export interface ReminderAction extends ActionBase {
  kind: 'lembrete'
  /** ISO 8601 com o fuso. */
  at: string
  text: string
  /** "Abrir" da notificação leva a esta conversa do WhatsApp. */
  whatsappChatId: string | null
  /** O nome da conversa, lido do app. */
  whatsappChatName: string | null
  /** O pedido não disse a hora: 09:00. */
  defaultTime: boolean
}

/** `whatsapp-resposta`: o texto editável e "Enviar", pelo caminho do contrato 24. */
export interface WhatsAppReplyAction extends ActionBase {
  kind: 'whatsapp-resposta'
  chatId: string
  /** Nome e número lidos do app, nunca do texto do modelo. */
  chatName: string
  phone: string | null
  group: boolean
  text: string
}

/** `tarefa`: "Criar tarefa" abre o formulário das Automações preenchido. */
export interface TaskAction extends ActionBase {
  kind: 'tarefa'
  name: string
  agentId: string
  /** O nome do agente, lido do app. */
  agentName: string
  message: string
  schedule: Schedule
}

/** `abrir`: um botão que leva a uma tela do app. */
export interface OpenAction extends ActionBase {
  kind: 'abrir'
  screen: OpenScreen
  target: string | null
  /** "Abrir Configurações › Claude", "Abrir «Planejamento»", lido do app. */
  label: string
}

export type ChatAction = ReminderAction | WhatsAppReplyAction | TaskAction | OpenAction

/** Qual cartão de qual resposta. */
export interface ChatActionRef {
  chatId: string
  /** Posição da resposta na conversa. */
  index: number
  actionId: string
}

/** "Criar lembrete" (com a data e o texto do "Editar", quando mudaram). */
export interface ChatActionReminderRequest extends ChatActionRef {
  at?: string | undefined
  text?: string | undefined
}

/**
 * Estado depois do clique que não cria nada no main: "Descartar"; "Enviar" que já passou pelo contrato 24 (`sent`,
 * com o texto que foi); a tarefa salva no formulário das Automações (`task-created`).
 */
export interface ChatActionStateRequest extends ChatActionRef {
  state: 'dismissed' | 'sent' | 'task-created'
  text?: string | undefined
}

/** `done`: o cartão já tinha sido usado (recarregar a conversa não repete a ação). */
export type ChatActionResult = { ok: true; chat: Chat } | { ok: false; error: 'missing' | 'invalid' | 'past' | 'done' | 'full' }

const two = (value: number): string => String(value).padStart(2, '0')

/** "ter 17/11 09:00" no fuso. */
export function reminderWhen(at: string, timeZone: string): string {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? at : formatRunAt(ms, timeZone)
}

/** "hoje", "amanhã" ou `null`, no fuso. */
export function relativeDay(at: string, now: number, timeZone: string): string | null {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return null
  const day = (value: number): number => {
    const wall = wallTime(value, timeZone)
    return Date.UTC(wall.year, wall.month - 1, wall.day)
  }
  const diff = Math.round((day(ms) - day(now)) / 86_400_000)
  return diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : null
}

/** Título do cartão: "Lembrete · ter 17/11 09:00 (amanhã) · Responder Fulano". */
export function reminderTitle(action: Pick<ReminderAction, 'at' | 'text'>, now: number, timeZone: string): string {
  const relative = relativeDay(action.at, now, timeZone)
  return `Lembrete · ${reminderWhen(action.at, timeZone)}${relative ? ` (${relative})` : ''} · ${action.text}`
}

/** "Lembrete criado · ter 17/11 09:00". */
export function reminderCreatedText(at: string, timeZone: string): string {
  return `Lembrete criado · ${reminderWhen(at, timeZone)}`
}

/** "Enviada às 19:40", na hora local. */
export function sentText(at: number): string {
  const date = new Date(at)
  return `Enviada às ${two(date.getHours())}:${two(date.getMinutes())}`
}

export const DISMISSED_TEXT = 'Descartado'
export const TASK_CREATED_TEXT = 'Tarefa criada'

/**
 * Número de uma conversa a partir do id (`5511911110000@s.whatsapp.net` -> "+55 11 91111-0000"); grupo e id
 * `@lid` não têm número.
 */
export function phoneOfChatId(chatId: string): string | null {
  const match = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(chatId)
  const digits = match?.[1]
  if (!digits) return null
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits)
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`
  return `+${digits}`
}

/** "Abrir <tela>" com o nome do alvo. */
export function openLabel(screen: OpenScreen, targetName: string | null): string {
  if (screen === 'reuniao') return targetName ? `Abrir «${targetName}»` : 'Abrir a reunião'
  if (screen === 'whatsapp' && targetName) return `Abrir a conversa com ${targetName}`
  if (screen === 'configuracoes' && targetName) return `Abrir Configurações › ${targetName}`
  if (screen === 'automacoes' && targetName) return `Abrir Automações › ${targetName}`
  return `Abrir ${OPEN_SCREEN_LABELS[screen]}`
}

/**
 * Resposta com erro, parada ou estourada no tempo (contrato 25): nenhum bloco de ação fica no texto gravado, nem
 * inteiro nem pela metade (o cartão só nasce de uma resposta que terminou).
 */
export function withoutActionBlocks(text: string): string {
  const whole = new RegExp(`(^|\\n)[ \\t]*\`\`\`${ACTION_FENCE}[ \\t]*\\n[\\s\\S]*?\\n[ \\t]*\`\`\`[ \\t]*(?=\\n|$)`, 'g')
  return withoutPendingActions(text.replace(whole, '$1'))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Na resposta em curso, o bloco de ação ainda pela metade não aparece: o texto para no começo da cerca. */
export function withoutPendingActions(text: string): string {
  const at = text.indexOf(`\`\`\`${ACTION_FENCE}`)
  return at === -1 ? text : text.slice(0, at).trimEnd()
}
