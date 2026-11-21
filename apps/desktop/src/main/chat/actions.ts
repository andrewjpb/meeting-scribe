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
// Contrato 78: o evento no Calendário do Mac (a agenda resolvida pelo nome entre as graváveis, gravado pelo `lap-calendar`
// só no clique em "Pôr na agenda") e os cartões de alterar e apagar um lembrete, que só aceitam o id de um lembrete que
// existe nas Automações. O modelo nunca vê o id de uma agenda: ele escreve o nome.
// Contrato 76: o rascunho para o Instagram. A conta é resolvida entre as conectadas (a única, ou a nomeada pelo @); o clique
// em "Criar rascunho" só põe o rascunho, sem mídia, na fila da conta (pela função injetada, que usa o `savePublication`
// das redes): nada daqui importa o serviço das redes, publica ou agenda.
// Contrato 117: os cartões do funil de vendas. Oportunidade, etapa e contato são resolvidos pelo funil do app (o id que
// não existe e a etapa que não bate viram cartão `failed` com a razão); o clique grava só pelo serviço do funil (110).
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ACTION_FENCE,
  ACTIONS_PER_MESSAGE_MAX,
  EMAIL_CARD_ITEMS_MAX,
  emailSentText,
  AUTOMATIONS_TABS,
  CHAT_ACTION_ERROR_MAX,
  DISMISSED_TEXT,
  EVENT_DEFAULT_DURATION_MS,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  eventAlreadyText,
  eventCreatedText,
  FUNIL_ACTION_KINDS,
  FUNIL_CARD_CONTATOS_MAX,
  FUNIL_CARD_NOTA_MAX,
  FUNIL_CARD_PASSO_MAX,
  FUNIL_CONTATO_COMPLETADO_TEXT,
  FUNIL_CONTATO_CRIADO_TEXT,
  FUNIL_CONTATO_SEM_CANAL,
  FUNIL_ETAPA_NAO_ENCONTRADA,
  FUNIL_OPORTUNIDADE_CRIADA_TEXT,
  FUNIL_OPORTUNIDADE_NAO_ENCONTRADA,
  FUNIL_PASSO_SALVO_TEXT,
  funilMovidaText,
  INSTAGRAM_DRAFT_CAPTION_MAX,
  INSTAGRAM_DRAFT_CREATED_TEXT,
  openLabel,
  OPEN_SCREENS,
  phoneOfChatId,
  REMINDER_TEXT_MAX,
  reminderChangedText,
  reminderCreatedText,
  REMINDER_DELETED_TEXT,
  REMINDER_GONE_TEXT,
  sentText,
  TASK_CREATED_TEXT,
  WHATSAPP_CHOICES_MAX,
  type ChatAction,
  type ChatActionCalendar,
  type ChatActionEvent,
  type ChatActionFunil,
  type ChatActionFunilContato,
  type ChatActionOportunidadeCriar,
  type ChatActionResult,
  type ChatCalendarAccess,
  type EmailCardItem,
  type OpenScreen,
  type ReminderEmail,
} from '../../shared/assistant'
import { EMAIL_REF_PATTERN, EMAIL_TEXT_MAX, isSent, prefixedSubject, type EmailAccountStatus, type EmailMessage } from '../../shared/email'
import { describeSchedule, TASK_MESSAGE_MAX, TASK_NAME_MAX, wallTime, zonedInstant, type ScheduledTask, type TaskReminder, type TaskSaveResult } from '../../shared/automations'
import { automationIdSchema, scheduleSchema } from '../../shared/automations-schema'
import type { Chat, ChatMessage } from '../../shared/chat'
import { FUNIL_ETAPA_NOME_MAX, FUNIL_NOME_MAX, type Etapa, type FunilActionResult, type FunilState, type FunilView, type Oportunidade } from '../../shared/funil'
import { mesmoTelefone, normalizarEmail, normalizarTelefone, semAcento } from '../../shared/funil-logic'
import { SETTINGS_TABS } from '../../shared/routes'
import { WHATSAPP_CHAT_ID_PATTERN, WHATSAPP_SEND_TEXT_MAX, type WhatsAppChatKind } from '../../shared/whatsapp'
import { normalizeWhen } from '../invites/map'
import type { MacCalendar } from '../mac-calendar/process'
import type { MacCalendarCreateArgs, MacCalendarError } from '../mac-calendar/protocol'
import type { FunilService } from '../funil/service'
import type { AutomationsService } from '../schedules/service'
import type { ChatEventsStore } from './events-store'
import { calendarIdSchema, CHAT_CALENDARS_MAX, chatIdSchema, type ChatStore } from './store'
import { captionStats } from '../../shared/redes-rules'

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

/**
 * Contrato 78: a data do evento. ISO 8601 com ou sem o fuso (sem ele, vale o fuso do Mac), ou só o dia ("2026-11-20",
 * que vira dia inteiro).
 */
const EVENT_WHEN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/
const eventWhenText = z.string().trim().max(40).regex(EVENT_WHEN)

/** Contrato 117: um dia `AAAA-MM-DD` que existe. */
const funilDia = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  }, 'dia inválido')
const funilId = z.string().trim().min(1).max(200)
/** Texto opcional de uma linha: vazio vale como ausente. */
const funilOpcional = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .optional()
    .transform((value) => (value ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() || null : null))

/** O JSON que o Claude escreve, com os nomes do contrato. Campo a mais é ignorado. */
const proposedSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('lembrete'), quando: zonedIso, texto: line(REMINDER_TEXT_MAX), conversaWhatsApp: whatsappChatId.nullable().optional(), horaPadrao: z.boolean().optional(), email: emailRef.nullable().optional() }),
  z.object({ tipo: z.literal('whatsapp-resposta'), chatId: whatsappChatId, texto: z.string().trim().min(1).max(WHATSAPP_SEND_TEXT_MAX) }),
  z.object({ tipo: z.literal('tarefa'), nome: line(TASK_NAME_MAX), agente: z.string().trim().min(1).max(100), mensagem: z.string().trim().min(1).max(TASK_MESSAGE_MAX), schedule: scheduleSchema }),
  z.object({ tipo: z.literal('abrir'), tela: z.enum(OPEN_SCREENS), alvo: z.string().trim().max(200).nullable().optional() }),
  // Contrato 45.
  z.object({ tipo: z.literal('emails'), mensagens: z.array(emailRef).min(1).max(EMAIL_CARD_ITEMS_MAX * 2) }),
  z.object({ tipo: z.literal('email-resposta'), email: emailRef, texto: z.string().trim().min(1).max(EMAIL_TEXT_MAX) }),
  // Contrato 78: o título e as notas a mais são cortados (não recusados).
  z.object({
    tipo: z.literal('evento'),
    titulo: z.string().trim().min(1).max(EVENT_TITLE_MAX * 10),
    inicio: eventWhenText,
    fim: eventWhenText.nullable().optional(),
    diaInteiro: z.boolean().optional(),
    local: z.string().max(EVENT_LOCATION_MAX * 4).nullable().optional(),
    notas: z.string().max(EVENT_NOTES_MAX * 4).nullable().optional(),
    agenda: z.string().trim().max(300).nullable().optional(),
  }),
  z.object({ tipo: z.literal('lembrete-editar'), id: automationIdSchema, quando: zonedIso.optional(), texto: line(REMINDER_TEXT_MAX).optional() }),
  z.object({ tipo: z.literal('lembrete-apagar'), id: automationIdSchema }),
  // Contrato 76: a legenda mantém as quebras de linha; a acima dos limites do Instagram vira cartão com o problema marcado.
  z.object({
    tipo: z.literal('instagram-rascunho'),
    conta: z.string().trim().max(100).nullable().optional(),
    legenda: z.string().max(INSTAGRAM_DRAFT_CAPTION_MAX),
    quando: zonedIso.nullable().optional(),
  }),
  // Contrato 117: o funil de vendas. O valor vem em reais; a etapa, pelo nome; o id, copiado do FUNIL.md.
  z.object({
    tipo: z.literal('oportunidade-criar'),
    titulo: line(FUNIL_NOME_MAX),
    empresa: funilOpcional(FUNIL_NOME_MAX),
    contatos: z
      .array(z.object({ nome: line(FUNIL_NOME_MAX), email: z.string().max(320).nullable().optional() }))
      .max(FUNIL_CARD_CONTATOS_MAX)
      .optional(),
    etapa: funilOpcional(FUNIL_ETAPA_NOME_MAX),
    valor: z.number().min(0).max(1e12).nullable().optional(),
    previsao: funilDia.nullable().optional(),
    proximoPasso: z.object({ texto: line(FUNIL_CARD_PASSO_MAX), data: funilDia.nullable().optional() }).nullable().optional(),
  }),
  z.object({ tipo: z.literal('oportunidade-mover'), oportunidadeId: funilId, etapa: line(FUNIL_ETAPA_NOME_MAX * 2), nota: funilOpcional(FUNIL_CARD_NOTA_MAX) }),
  z.object({ tipo: z.literal('oportunidade-proximo-passo'), oportunidadeId: funilId, texto: line(FUNIL_CARD_PASSO_MAX), data: funilDia.nullable().optional() }),
  z.object({
    tipo: z.literal('contato-criar'),
    nome: line(FUNIL_NOME_MAX),
    email: z.string().max(320).nullable().optional(),
    telefone: z.string().max(40).nullable().optional(),
    empresa: funilOpcional(FUNIL_NOME_MAX),
    cargo: funilOpcional(FUNIL_NOME_MAX),
  }),
])
type Proposed = z.infer<typeof proposedSchema>
type FunilProposed = Extract<Proposed, { tipo: ChatActionFunil['kind'] }>

/** O que o main lê do app para montar o cartão. */
export interface ActionResolver {
  /** Nome e tipo de uma conversa do WhatsApp; `null` se ela não existe (ou o WhatsApp não está conectado). */
  whatsappChat?: (chatId: string) => Promise<{ name: string; kind: WhatsAppChatKind; phone?: string | undefined } | null>
  agents?: () => Promise<readonly { id: string; name: string }[]>
  meeting?: (meetingId: string) => Promise<{ title: string } | null>
  /** Contrato 45: o email de uma referência "em-…" (do cache, ou achado pela busca); `null` se não existe ou bloqueado. */
  email?: (ref: string) => Promise<{ status: EmailAccountStatus; message: EmailMessage; mailbox: string | null; pending: boolean } | null>
  /** Contrato 78: o Calendário do Mac, só para ler o acesso e as agendas (montar o cartão não grava nada). */
  calendar?: Pick<MacCalendar, 'status' | 'calendars'>
  /** Contrato 78: a agenda padrão de Configurações › Email › Convites (`inviteCalendarId`). */
  preferredCalendar?: () => Promise<string | null>
  /** Contrato 78: as tarefas das Automações (o lembrete que o cartão de alterar ou apagar aceita). */
  tasks?: () => Promise<readonly ScheduledTask[]>
  /** Contrato 76: as contas do Instagram conectadas (o id e o @), para o cartão do rascunho. */
  instagramAccounts?: () => Promise<readonly InstagramDraftAccount[]>
  /** Contrato 117: o funil de vendas, só para ler (montar o cartão não grava nada); `null` com o app bloqueado. */
  funil?: () => Promise<FunilView | null>
  now: () => number
  timeZone: () => string
  newId?: () => string
}

const SETTINGS_LABELS: Readonly<Record<string, string>> = { geral: 'Geral', gravacao: 'Gravação', claude: 'Claude', arquivos: 'Arquivos', contas: 'Contas', plugins: 'Plugins', conexoes: 'Conexões', sobre: 'Sobre' }
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
  // Contrato 117 (R20): a oportunidade e o contato pelo id do funil (que existe e não está arquivado), com o nome dele.
  if (screen === 'oportunidade' || screen === 'contato') {
    if (!target) return null
    const state = (await resolver.funil?.().catch(() => null))?.state
    if (!state) return null
    if (screen === 'oportunidade') {
      const oportunidade = oportunidadeViva(state, target)
      return oportunidade ? { target, name: oportunidade.titulo } : null
    }
    const contato = state.contatos.find((item) => item.id === target && !item.arquivado)
    return contato ? { target, name: contato.nome } : null
  }
  // Reuniões, Gravação e o Funil não têm alvo.
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

// --- Contrato 76: rascunho para o Instagram ---------------------------------------------------------------------

/** Uma conta do Instagram como o cartão do rascunho precisa (nunca o token). */
export interface InstagramDraftAccount {
  id: string
  username: string
}

/** A legenda sem caracteres de controle (as quebras de linha ficam), sem espaço nas pontas. */
export const instagramCaption = (value: string): string => withoutControls(value, true).trim()

/**
 * Contrato 76: a conta do rascunho. Sem nome, a única conectada (com duas ou mais, nenhuma); com nome, a do @ (com ou sem
 * "@", sem caixa) ou do id.
 */
export function chooseInstagramAccount(accounts: readonly InstagramDraftAccount[], wanted: string | null | undefined): InstagramDraftAccount | null {
  const name = wanted?.trim().replace(/^@/, '').toLocaleLowerCase('pt-BR') ?? ''
  if (!name) return accounts.length === 1 ? (accounts[0] ?? null) : null
  return accounts.find((item) => item.username.toLocaleLowerCase('pt-BR') === name || item.id === name) ?? null
}

// --- Contrato 78: evento e lembretes ----------------------------------------------------------------------------

/** O instante de uma data do evento; sem fuso, no fuso do Mac. `day`: veio só o dia. `null` se não existe. */
function parseEventWhen(text: string, timeZone: string): { at: number; day: boolean } | null {
  const match = EVENT_WHEN.exec(text.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  if (match[4] === undefined) return { at: zonedInstant(year, month, day, 0, 0, timeZone), day: true }
  const [hour, minute] = [Number(match[4]), Number(match[5])]
  if (hour > 23 || minute > 59 || Number(match[6] ?? 0) > 59) return null
  if (match[7] !== undefined) {
    const at = Date.parse(text.trim().replace(' ', 'T'))
    return Number.isNaN(at) ? null : { at, day: false }
  }
  return { at: zonedInstant(year, month, day, hour, minute, timeZone), day: false }
}

/** A meia-noite do dia de `ms` no fuso, e a do dia seguinte. */
function dayBounds(ms: number, timeZone: string): { start: number; next: number } {
  const wall = wallTime(ms, timeZone)
  const following = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1))
  return { start: zonedInstant(wall.year, wall.month, wall.day, 0, 0, timeZone), next: zonedInstant(following.getUTCFullYear(), following.getUTCMonth() + 1, following.getUTCDate(), 0, 0, timeZone) }
}

const withoutControls = (value: string, keepLines: boolean): string => [...value].filter((char) => (keepLines && (char === '\n' || char === '\t')) || (char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)).join('')
const cleanLine = (value: string, max: number): string => withoutControls(value, false).replace(/\s+/g, ' ').trim().slice(0, max).trim()
const cleanOptional = (value: string | null | undefined, max: number, keepLines = false): string | null => {
  if (!value) return null
  const text = keepLines ? withoutControls(value, true).trim().slice(0, max).trim() : cleanLine(value, max)
  return text || null
}

type EventDraft = Pick<ChatActionEvent, 'title' | 'start' | 'end' | 'allDay' | 'location' | 'notes'>

/**
 * Contrato 78 (R1): as regras do evento, na proposta e de novo no clique (com o "Editar"). Início hoje ou depois (a
 * meia-noite de hoje no fuso do Mac), fim depois do início (sem fim, uma hora); dia inteiro vai da meia-noite do dia à do
 * dia seguinte. Título e notas cortados nos limites.
 */
export function eventDraft(
  input: { title: string; start: string; end?: string | null | undefined; allDay?: boolean | undefined; location?: string | null | undefined; notes?: string | null | undefined },
  now: number,
  timeZone: string,
): EventDraft | { error: 'past' | 'invalid' } {
  const title = cleanLine(input.title, EVENT_TITLE_MAX)
  const start = parseEventWhen(input.start, timeZone)
  if (!title || !start) return { error: 'invalid' }
  const allDay = input.allDay === true || start.day
  if (start.at < dayBounds(now, timeZone).start) return { error: 'past' }
  let from = start.at
  let to: number
  if (allDay) {
    const bounds = dayBounds(start.at, timeZone)
    from = bounds.start
    to = bounds.next
  } else if (input.end) {
    const end = parseEventWhen(input.end, timeZone)
    if (!end) return { error: 'invalid' }
    to = end.at
  } else to = from + EVENT_DEFAULT_DURATION_MS
  if (to <= from) return { error: 'invalid' }
  return {
    title,
    start: new Date(from).toISOString(),
    end: new Date(to).toISOString(),
    allDay,
    location: cleanOptional(input.location, EVENT_LOCATION_MAX),
    notes: cleanOptional(input.notes, EVENT_NOTES_MAX, true),
  }
}

/** Contrato 78: o acesso do helper como o cartão mostra (`writeOnly` e `restricted` contam como negado). */
async function calendarAccess(calendar: Pick<MacCalendar, 'status'> | undefined): Promise<ChatCalendarAccess> {
  const status = await calendar?.status().catch(() => null)
  if (!status?.ok) return 'unavailable'
  const { access } = status.value
  return access === 'full' ? 'full' : access === 'notDetermined' ? 'not-determined' : 'denied'
}

/** Sem acento e sem caixa, para achar a agenda pelo nome que o modelo escreveu. */
const plainName = (value: string): string => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')

/** As agendas graváveis do Mac, no formato do cartão (`null`: o helper não respondeu). */
async function writableCalendars(calendar: Pick<MacCalendar, 'calendars'>): Promise<ChatActionCalendar[] | null> {
  const listed = await calendar.calendars().catch(() => null)
  if (!listed?.ok) return null
  return listed.value.calendars
    .filter((item) => item.writable)
    .slice(0, CHAT_CALENDARS_MAX)
    .map((item) => ({ id: item.id, title: item.title.slice(0, 300), source: item.sourceTitle.slice(0, 300), color: item.color, isDefault: item.isDefault }))
}

/** R1: a agenda pedida pelo nome, se gravável; senão a das Configurações; senão a padrão do Mac; senão a primeira. */
export function chooseCalendar(calendars: readonly ChatActionCalendar[], wanted: string | null, preferred: string | null): ChatActionCalendar | null {
  const named = wanted ? calendars.find((item) => plainName(item.title) === plainName(wanted)) : undefined
  return named ?? calendars.find((item) => item.id === preferred) ?? calendars.find((item) => item.isDefault) ?? calendars[0] ?? null
}

/** Contrato 78: quanto o `ESTADO.md` reaproveita o acesso e as agendas lidos do helper. */
export const CALENDAR_READS_TTL_MS = 30_000

export interface CachedCalendarReads extends Pick<MacCalendar, 'status' | 'calendars'> {
  /** Esquece o que leu ("Pedir acesso", a janela voltou ao foco). */
  invalidate(): void
  /** Um `status` lido na hora por outro caminho: acesso diferente do guardado esquece tudo (a permissão mudou). */
  observe(outcome: Awaited<ReturnType<MacCalendar['status']>>): void
}

/**
 * Contrato 78: o `status` e o `calendars` do helper guardados por `ttlMs`, para a pergunta do Assistente não esperar o
 * helper a cada vez. Resposta com erro não fica guardada. Só para o `ESTADO.md`: o cartão e o clique leem na hora.
 */
export function cachedCalendarReads(calendar: Pick<MacCalendar, 'status' | 'calendars'>, ttlMs = CALENDAR_READS_TTL_MS, now: () => number = Date.now): CachedCalendarReads {
  let status: { at: number; value: ReturnType<MacCalendar['status']> } | null = null
  let calendars: { at: number; value: ReturnType<MacCalendar['calendars']> } | null = null
  const fresh = (entry: { at: number } | null): boolean => entry !== null && now() - entry.at < ttlMs
  return {
    status() {
      if (status && fresh(status)) return status.value
      const entry = { at: now(), value: calendar.status() }
      status = entry
      void entry.value.then(
        (outcome) => {
          if (!outcome.ok && status === entry) status = null
        },
        () => {
          if (status === entry) status = null
        },
      )
      return entry.value
    },
    calendars() {
      if (calendars && fresh(calendars)) return calendars.value
      const entry = { at: now(), value: calendar.calendars() }
      calendars = entry
      void entry.value.then(
        (outcome) => {
          if (!outcome.ok && calendars === entry) calendars = null
        },
        () => {
          if (calendars === entry) calendars = null
        },
      )
      return entry.value
    },
    invalidate() {
      status = null
      calendars = null
    },
    observe(outcome) {
      const cached = status
      if (!cached || !outcome.ok) return
      void cached.value.then((before) => {
        if (status === cached && (!before.ok || before.value.access !== outcome.value.access)) {
          status = null
          calendars = null
        }
      })
    },
  }
}

/**
 * Contrato 78 (R3): as agendas para o `ESTADO.md`: o nome, a conta e a que o cartão escolhe sem nome pedido (nunca o id).
 */
export async function calendarOverview(
  calendar: Pick<MacCalendar, 'status' | 'calendars'>,
  preferred: () => Promise<string | null>,
): Promise<{ access: ChatCalendarAccess; calendars: { title: string; source: string; isDefault: boolean }[] }> {
  const access = await calendarAccess(calendar)
  if (access !== 'full') return { access, calendars: [] }
  const calendars = await writableCalendars(calendar)
  if (!calendars) return { access: 'unavailable', calendars: [] }
  const chosen = chooseCalendar(calendars, null, await preferred().catch(() => null))
  return { access, calendars: calendars.map((item) => ({ title: item.title, source: item.source, isDefault: item.id === chosen?.id })) }
}

/** O lembrete das Automações que ainda não disparou (o que já avisou não existe mais para o cartão). */
const pendingReminder = (tasks: readonly ScheduledTask[], id: string): (ScheduledTask & { reminder: TaskReminder; schedule: { kind: 'once'; at: string } }) | null => {
  const task = tasks.find((item) => item.id === id)
  if (!task?.reminder || task.schedule.kind !== 'once' || task.lastRunAt !== null) return null
  return task as ScheduledTask & { reminder: TaskReminder; schedule: { kind: 'once'; at: string } }
}

// --- Contrato 117: o funil de vendas ----------------------------------------------------------------------------

/** O nome de uma etapa comparável: sem acento, sem caixa e com espaços simples. */
const chaveEtapa = (nome: string): string => semAcento(nome).replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')

/** As etapas na ordem do quadro. */
const etapasEmOrdem = (state: FunilState): Etapa[] => [...state.etapas].sort((a, b) => a.ordem - b.ordem)

/** A etapa pelo nome que o modelo escreveu (sem acento e sem caixa), entre as de `etapas`. */
const etapaPorNome = (etapas: readonly Etapa[], nome: string): Etapa | null => etapas.find((etapa) => chaveEtapa(etapa.nome) === chaveEtapa(nome)) ?? null

/** A oportunidade que o cartão pode mexer: existe e não está arquivada. */
const oportunidadeViva = (state: FunilState, id: string): Oportunidade | null => state.oportunidades.find((item) => item.id === id && !item.arquivado) ?? null

const cardText = (value: string, max: number): string => value.replace(/\s+/g, ' ').trim().slice(0, max).trim()

/**
 * Contrato 117: os contatos do cartão de criar oportunidade. O e-mail normalizado (o que não é e-mail fica sem); com o
 * e-mail de um contato do funil, o id dele. O mesmo e-mail (ou o mesmo contato) não entra duas vezes.
 */
function funilContatos(input: readonly { nome: string; email?: string | null | undefined }[], state: FunilState): ChatActionFunilContato[] {
  const contatos: ChatActionFunilContato[] = []
  for (const item of input.slice(0, FUNIL_CARD_CONTATOS_MAX)) {
    const nome = cardText(item.nome, FUNIL_NOME_MAX)
    if (!nome) continue
    const email = item.email ? normalizarEmail(item.email) : null
    const existente = email ? state.contatos.find((contato) => !contato.arquivado && contato.emails.includes(email)) : undefined
    if (email && contatos.some((known) => known.email === email)) continue
    if (existente && contatos.some((known) => known.contatoId === existente.id)) continue
    contatos.push({ nome, email, contatoId: existente?.id ?? null })
  }
  return contatos
}

/** Contrato 117: as outras razões de um cartão de criar oportunidade que não vale (a etapa tem o texto da R42). */
const FUNIL_CRIAR_INVALIDO: Record<'titulo' | 'valor', string> = {
  titulo: 'Não foi possível montar a oportunidade: o título está vazio.',
  valor: 'Não foi possível montar a oportunidade: o valor está fora do formato.',
}

type CriarDraft = Pick<ChatActionOportunidadeCriar, 'titulo' | 'empresa' | 'contatos' | 'etapaId' | 'valor' | 'previsao' | 'proximoPasso'>

/**
 * Contrato 117 (R42): o cartão de criar oportunidade, na proposta e de novo no clique (com o que o cartão mudou). A etapa
 * é uma das abertas do funil agora; o que não vale volta como `error` (o chamador diz qual é a razão).
 */
function criarDraft(input: CriarDraft, state: FunilState): CriarDraft | { error: 'titulo' | 'etapa' | 'valor' } {
  const titulo = cardText(input.titulo, FUNIL_NOME_MAX)
  if (!titulo) return { error: 'titulo' }
  const etapa = etapasEmOrdem(state).find((item) => item.id === input.etapaId && item.tipo === 'aberta')
  if (!etapa) return { error: 'etapa' }
  if (input.valor !== null && !(Number.isSafeInteger(input.valor) && input.valor >= 0)) return { error: 'valor' }
  const empresa = input.empresa ? cardText(input.empresa, FUNIL_NOME_MAX) || null : null
  const passo = input.proximoPasso ? cardText(input.proximoPasso.texto, FUNIL_CARD_PASSO_MAX) : ''
  return {
    titulo,
    empresa,
    contatos: funilContatos(input.contatos, state),
    etapaId: etapa.id,
    valor: input.valor,
    previsao: input.previsao,
    proximoPasso: passo ? { texto: passo, data: input.proximoPasso?.data ?? null } : null,
  }
}

/** As etapas abertas, como o seletor do cartão mostra. */
const etapasAbertas = (state: FunilState): { id: string; nome: string }[] => etapasEmOrdem(state).filter((etapa) => etapa.tipo === 'aberta').map((etapa) => ({ id: etapa.id, nome: etapa.nome }))

/**
 * Contrato 117 (R42): o cartão do funil, com o que o funil do app tem agora. Oportunidade que não existe (ou arquivada) e
 * etapa que não bate viram o cartão `failed` com a razão; `contato-criar` sem e-mail nem telefone também. Nada é gravado.
 */
function resolveFunil(proposed: FunilProposed, base: { id: string; status: 'proposed'; result: null }, state: FunilState): ChatAction {
  const failed = { status: 'failed' as const }
  const etapas = etapasEmOrdem(state)
  switch (proposed.tipo) {
    case 'oportunidade-criar': {
      const abertas = etapas.filter((etapa) => etapa.tipo === 'aberta')
      const etapa = proposed.etapa ? etapaPorNome(abertas, proposed.etapa) : (abertas[0] ?? null)
      const valor = proposed.valor === null || proposed.valor === undefined ? null : Math.round(proposed.valor * 100)
      const fields: CriarDraft = {
        titulo: proposed.titulo,
        empresa: proposed.empresa,
        contatos: funilContatos(proposed.contatos ?? [], state),
        etapaId: etapa?.id ?? '',
        valor,
        previsao: proposed.previsao ?? null,
        proximoPasso: proposed.proximoPasso ? { texto: proposed.proximoPasso.texto, data: proposed.proximoPasso.data ?? null } : null,
      }
      const card = { ...base, kind: 'oportunidade-criar' as const, ...fields, etapas: etapasAbertas(state), oportunidadeId: null, error: null }
      const draft = criarDraft(fields, state)
      if ('error' in draft) return { ...card, ...failed, error: draft.error === 'etapa' ? FUNIL_ETAPA_NAO_ENCONTRADA : FUNIL_CRIAR_INVALIDO[draft.error] }
      return { ...card, ...draft }
    }
    case 'oportunidade-mover': {
      const oportunidade = oportunidadeViva(state, proposed.oportunidadeId)
      const para = etapaPorNome(etapas, proposed.etapa)
      const card = {
        ...base,
        kind: 'oportunidade-mover' as const,
        oportunidadeId: proposed.oportunidadeId,
        titulo: oportunidade?.titulo ?? '',
        de: (oportunidade && etapas.find((etapa) => etapa.id === oportunidade.etapaId)?.nome) ?? '',
        paraEtapaId: para?.id ?? '',
        para: para?.nome ?? cardText(proposed.etapa, FUNIL_ETAPA_NOME_MAX),
        nota: proposed.nota,
        error: null,
      }
      if (!oportunidade) return { ...card, ...failed, error: FUNIL_OPORTUNIDADE_NAO_ENCONTRADA }
      if (!para) return { ...card, ...failed, error: FUNIL_ETAPA_NAO_ENCONTRADA }
      return card
    }
    case 'oportunidade-proximo-passo': {
      const oportunidade = oportunidadeViva(state, proposed.oportunidadeId)
      const card = {
        ...base,
        kind: 'oportunidade-proximo-passo' as const,
        oportunidadeId: proposed.oportunidadeId,
        titulo: oportunidade?.titulo ?? '',
        texto: proposed.texto,
        data: proposed.data ?? null,
        anterior: oportunidade?.proximoPasso ? { texto: oportunidade.proximoPasso.texto, data: oportunidade.proximoPasso.data } : null,
        error: null,
      }
      return oportunidade ? card : { ...card, ...failed, error: FUNIL_OPORTUNIDADE_NAO_ENCONTRADA }
    }
    case 'contato-criar': {
      const email = proposed.email ? normalizarEmail(proposed.email) : null
      const telefone = proposed.telefone ? normalizarTelefone(proposed.telefone) : null
      // R4: o contato com o mesmo e-mail ou telefone (arquivado também: o clique traz de volta) é completado, não repetido.
      const existente = state.contatos.find((contato) => (email !== null && contato.emails.includes(email)) || (telefone !== null && contato.telefones.some((conhecido) => mesmoTelefone(conhecido, telefone))))
      const card = {
        ...base,
        kind: 'contato-criar' as const,
        nome: proposed.nome,
        email,
        telefone,
        empresa: proposed.empresa,
        cargo: proposed.cargo,
        existenteId: existente?.id ?? null,
        existenteNome: existente ? cardText(existente.nome, FUNIL_NOME_MAX) : null,
        contatoId: null,
        error: null,
      }
      return email === null && telefone === null ? { ...card, ...failed, error: FUNIL_CONTATO_SEM_CANAL } : card
    }
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
      const targets = (isSent(message, status) ? message.to : message.from).filter((item) => item.address.toLowerCase() !== own)
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
    case 'evento': {
      const draft = eventDraft({ title: proposed.titulo, start: proposed.inicio, end: proposed.fim, allDay: proposed.diaInteiro, location: proposed.local, notes: proposed.notas }, resolver.now(), resolver.timeZone())
      if ('error' in draft) return null
      const access = await calendarAccess(resolver.calendar)
      // Sem acesso, nada de agendas: o cartão mostra o aviso e o "Pedir acesso".
      const calendars = access === 'full' && resolver.calendar ? ((await writableCalendars(resolver.calendar)) ?? []) : []
      const preferred = calendars.length ? ((await resolver.preferredCalendar?.().catch(() => null)) ?? null) : null
      const chosen = chooseCalendar(calendars, proposed.agenda ?? null, preferred)
      return { ...base, kind: 'evento', ...draft, calendarId: chosen?.id ?? null, calendarTitle: chosen?.title ?? null, calendars, access, error: null }
    }
    case 'lembrete-editar': {
      if (proposed.quando === undefined && proposed.texto === undefined) return null
      if (proposed.quando !== undefined && Date.parse(proposed.quando) <= resolver.now()) return null
      const task = pendingReminder((await resolver.tasks?.().catch(() => [])) ?? [], proposed.id)
      if (!task) return null
      return { ...base, kind: 'lembrete-editar', taskId: task.id, currentText: task.reminder.text, currentAt: task.schedule.at, text: proposed.texto ?? null, at: proposed.quando ?? null, error: null }
    }
    case 'lembrete-apagar': {
      const task = pendingReminder((await resolver.tasks?.().catch(() => [])) ?? [], proposed.id)
      if (!task) return null
      return { ...base, kind: 'lembrete-apagar', taskId: task.id, text: task.reminder.text, at: task.schedule.at, error: null }
    }
    case 'instagram-rascunho': {
      const caption = instagramCaption(proposed.legenda)
      if (!caption) return null
      if (proposed.quando && Date.parse(proposed.quando) <= resolver.now()) return null
      const account = chooseInstagramAccount((await resolver.instagramAccounts?.().catch(() => [])) ?? [], proposed.conta)
      if (!account) return null
      return { ...base, kind: 'instagram-rascunho', accountId: account.id, username: account.username.slice(0, 100), caption, at: proposed.quando ?? null, publicationId: null }
    }
    // Contrato 117: sem o funil (o app bloqueado), o bloco fica como texto.
    case 'oportunidade-criar':
    case 'oportunidade-mover':
    case 'oportunidade-proximo-passo':
    case 'contato-criar': {
      const view = await resolver.funil?.().catch(() => null)
      return view ? resolveFunil(proposed, base, view.state) : null
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
    const state =
      action.status === 'proposed' ? 'esperando o clique' : action.status === 'failed' && 'error' in action && action.error ? `não deu certo: ${action.error}` : (action.result ?? action.status)
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
      case 'email-lote':
        return `- lote de emails movidos na conta ${action.account} (${action.status === 'proposed' ? 'com Desfazer' : state})`
      case 'evento':
        return `- evento "${action.title}" em ${action.start}${action.allDay ? ' (dia inteiro)' : ` até ${action.end}`}${action.calendarTitle ? ` na agenda ${action.calendarTitle}` : ''} (${state})`
      case 'lembrete-editar':
        return `- alterar o lembrete "${action.currentText}" (id: ${action.taskId}) de ${action.currentAt}${action.at ? ` para ${action.at}` : ''}${action.text ? ` com o texto "${action.text}"` : ''} (${state})`
      case 'lembrete-apagar':
        return `- apagar o lembrete "${action.text}" (id: ${action.taskId}) de ${action.at} (${state})`
      case 'instagram-rascunho':
        return `- rascunho para o Instagram @${action.username}${action.at ? ` (data proposta ${action.at})` : ''}: "${action.caption.replace(/\s+/g, ' ').slice(0, 200)}" (${state})`
      // Contrato 117.
      case 'oportunidade-criar':
        return `- Oportunidade criada: ${action.titulo} (${state})`
      case 'oportunidade-mover':
        return `- Oportunidade movida: ${action.titulo || action.oportunidadeId} para ${action.para} (${state})`
      case 'oportunidade-proximo-passo':
        return `- Próximo passo de ${action.titulo || action.oportunidadeId}: ${action.texto} (${state})`
      case 'contato-criar':
        return `- Contato criado: ${action.nome} (${state})`
    }
  })
  return ['[Cartões propostos nesta resposta:', ...lines, ']'].join('\n')
}

/**
 * Contrato 56: o cartão do lote de emails depois do Desfazer: `done`, com a frase do estado ("Desfeito às 14:40"), em
 * toda resposta da conversa que tem o cartão daquele lote. `null` se a conversa não tem nenhum.
 */
export async function markEmailBatchCard(store: Pick<ChatStore, 'mutate'>, chatId: string, batchId: string, result: string): Promise<Chat | null> {
  return store.mutate(chatId, (chat) => {
    if (!chat) return null
    const has = (message: ChatMessage): boolean => message.actions?.some((action) => action.kind === 'email-lote' && action.batchId === batchId) ?? false
    if (!chat.messages.some(has)) return null
    return {
      ...chat,
      messages: chat.messages.map((message) =>
        has(message) ? { ...message, actions: (message.actions ?? []).map((action) => (action.kind === 'email-lote' && action.batchId === batchId ? { ...action, status: 'done' as const, result } : action)) } : message,
      ),
    }
  })
}

export interface ChatActionsDeps {
  store: Pick<ChatStore, 'get' | 'mutate'>
  /** Automações (23): a tarefa "uma vez" sem agente. */
  createReminder: (input: { at: string; reminder: TaskReminder }) => Promise<TaskSaveResult>
  timeZone: () => string
  now?: () => number
  /** Contrato 78: o Calendário do Mac, que grava o evento só no clique em "Pôr na agenda". */
  calendar?: Pick<MacCalendar, 'calendars' | 'find' | 'create'>
  /** Contrato 78: o registro dos eventos que o Assistente gravou (`chat-events.json`). */
  events?: Pick<ChatEventsStore, 'add'>
  /**
   * Contrato 76: o rascunho do Instagram, só no clique: as contas conectadas, se um rascunho já existe na fila e o rascunho
   * sem mídia na fila com o id que o cartão gravou antes (o `savePublication` das redes). `missing`: a conta saiu;
   * `invalid`: a legenda ou a data recusadas.
   */
  instagram?: {
    accounts: () => readonly InstagramDraftAccount[]
    exists: (publicationId: string) => boolean
    createDraft: (input: { accountId: string; caption: string; at: string | null; publicationId: string }) => Promise<{ ok: true; publicationId: string } | { ok: false; error: 'missing' | 'invalid' }>
  }
  /** Contrato 117: o serviço do funil (110): a leitura e as gravações, só no clique de um cartão do funil. */
  funil?: Pick<FunilService, 'view' | 'contatoSave' | 'oportunidadeSave' | 'oportunidadeMove' | 'eventoAdd'>
  /** Contrato 78: alterar e apagar um lembrete das Automações (só no clique). */
  reminders?: {
    list: () => Promise<readonly ScheduledTask[]>
    update: AutomationsService['updateReminder']
    remove: (id: string) => Promise<boolean>
  }
  log?: (message: string) => void
}

export interface ChatActions {
  /** "Criar lembrete" (com a data e o texto do "Editar"). */
  reminder(request: unknown): Promise<ChatActionResult>
  /** "Descartar", "Enviada" (depois do envio do contrato 24) e "Tarefa criada" (depois do formulário). */
  setState(request: unknown): Promise<ChatActionResult>
  /** Contrato 78: "Pôr na agenda" e "Tentar de novo" (com o que o "Editar" mudou). */
  event(request: unknown): Promise<ChatActionResult>
  /** Contrato 78: "Salvar" no cartão de alterar um lembrete e "Apagar lembrete". */
  reminderChange(request: unknown): Promise<ChatActionResult>
  /**
   * Contrato 76: "Criar rascunho" (com a legenda e a data do "Editar"). `onCreated` recebe a conta e o rascunho criado (quem
   * monta abre o editor em Redes).
   */
  instagramDraft(request: unknown, onCreated?: (target: { accountId: string; publicationId: string }) => void): Promise<ChatActionResult>
  /** Contrato 117 (D9): "Mover", "Criar" e "Salvar" nos cartões do funil, pelo tipo gravado (`campos`: o de criar). */
  funil(request: unknown): Promise<ChatActionResult>
}

/** Contrato 78: a frase do erro do helper no cartão do evento, sem termo técnico. */
export function eventErrorText(error: Pick<MacCalendarError, 'code' | 'reason'>): string {
  if (error.code === 'denied' || error.code === 'restricted') return 'O app não tem acesso ao Calendário.'
  if ((error.code === 'not-found' && error.reason === 'calendar') || (error.code === 'invalid' && error.reason === 'read-only-calendar')) return 'Nenhuma agenda gravável escolhida.'
  const reason: string =
    error.reason === 'timeout'
      ? 'o Calendário não respondeu a tempo'
      : error.reason === 'platform' || error.reason === 'no-binary' || error.reason === 'dev' || error.reason === 'gave-up' || error.reason === 'disposed'
        ? 'o Calendário do Mac não está disponível'
        : error.reason === 'dates' || error.reason === 'timezone'
          ? 'o Calendário recusou a data'
          : error.reason === 'busy'
            ? 'o Calendário está ocupado'
            : 'o Calendário recusou o evento'
  return `Não consegui gravar na agenda: ${reason}. Nada foi criado.`
}

const NO_CALENDAR_TEXT = 'Nenhuma agenda gravável escolhida.'

/** O que o helper grava: o dia inteiro em datas (o fim exclusivo); o resto em UTC, com o fuso do Mac. */
function createArgs(draft: EventDraft, calendarId: string, timeZone: string): MacCalendarCreateArgs {
  const day = (iso: string): string => {
    const wall = wallTime(Date.parse(iso), timeZone)
    return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
  }
  return {
    calendarId,
    title: draft.title,
    start: draft.allDay ? day(draft.start) : normalizeWhen(draft.start),
    end: draft.allDay ? day(draft.end) : normalizeWhen(draft.end),
    allDay: draft.allDay,
    timeZone: draft.allDay ? null : timeZone,
    availability: 'busy',
    ...(draft.location ? { location: draft.location } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
  }
}

const refFields = { chatId: chatIdSchema, index: z.number().int().min(0).max(10_000), actionId: z.string().regex(/^[\w-]{1,40}$/) }
const reminderRequestSchema = z.object({ ...refFields, at: zonedIso.optional(), text: z.string().max(REMINDER_TEXT_MAX * 2).optional() }).strict()
const stateRequestSchema = z.object({ ...refFields, state: z.enum(['dismissed', 'sent', 'task-created']), text: z.string().max(Math.max(WHATSAPP_SEND_TEXT_MAX, EMAIL_TEXT_MAX)).optional() }).strict()
const isoText = z.string().max(40)
const eventRequestSchema = z
  .object({
    ...refFields,
    calendarId: calendarIdSchema,
    fields: z
      .object({
        title: z.string().max(EVENT_TITLE_MAX * 2).optional(),
        start: isoText.optional(),
        end: isoText.optional(),
        allDay: z.boolean().optional(),
        location: z
          .string()
          .max(EVENT_LOCATION_MAX * 2)
          .nullable()
          .optional(),
        notes: z
          .string()
          .max(EVENT_NOTES_MAX * 2)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
const reminderChangeRequestSchema = z.object({ ...refFields, op: z.enum(['update', 'delete']), at: zonedIso.optional(), text: z.string().max(REMINDER_TEXT_MAX * 2).optional() }).strict()
const instagramDraftRequestSchema = z.object({ ...refFields, caption: z.string().max(INSTAGRAM_DRAFT_CAPTION_MAX).optional(), at: z.iso.datetime({ offset: true }).nullable().optional() }).strict()
/** Contrato 117: o que o cartão de criar oportunidade mudou (o valor em centavos), conferido de novo por `criarDraft`. */
const funilCamposSchema = z
  .object({
    titulo: z.string().max(FUNIL_NOME_MAX * 2).optional(),
    empresa: z.string().max(FUNIL_NOME_MAX * 2).nullable().optional(),
    etapaId: z.string().max(200).optional(),
    valor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    previsao: funilDia.nullable().optional(),
    proximoPasso: z
      .object({ texto: z.string().max(FUNIL_CARD_PASSO_MAX * 2), data: funilDia.nullable() })
      .strict()
      .nullable()
      .optional(),
    contatos: z
      .array(z.object({ nome: z.string().max(FUNIL_NOME_MAX * 2), email: z.string().max(320).nullable(), contatoId: z.string().max(200).nullable() }).strict())
      .max(FUNIL_CARD_CONTATOS_MAX)
      .optional(),
  })
  .strict()
const funilRequestSchema = z.object({ ...refFields, campos: funilCamposSchema.optional() }).strict()
const isFunilAction = (action: ChatAction): action is ChatActionFunil => (FUNIL_ACTION_KINDS as readonly string[]).includes(action.kind)
/** Contrato 117 (R39): os contatos sem e-mail do cartão de criar ficam numa nota da oportunidade. */
export const funilNotaCitados = (nomes: readonly string[]): string => `Citados na conversa com o Assistente: ${nomes.join(', ')}`

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

  /** Contrato 78: o cartão ainda aceita o clique (o evento que falhou aceita "Tentar de novo" e "Descartar"). */
  const open = (action: ChatAction, retry: boolean): boolean => action.status === 'proposed' || (retry && action.status === 'failed' && action.kind === 'evento')

  /**
   * Troca a ação (e, com `others`, as outras da mesma resposta) na conversa, na mesma vez da fila. `retry`: vale também
   * para o evento que falhou.
   */
  async function write(ref: Ref, change: (action: ChatAction) => ChatAction | null, others?: (action: ChatAction, before: ChatAction) => ChatAction, retry = false): Promise<ChatActionResult> {
    let error: 'missing' | 'done' | null = null
    const saved = await deps.store.mutate(ref.chatId, (chat) => {
      const current = actionIn(chat, ref)
      if (!chat || !current) {
        error = 'missing'
        return null
      }
      if (!open(current, retry)) {
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
      // Contrato 56: o cartão do lote não se descarta (o Desfazer é o caminho dele). Contrato 78: o evento que falhou
      // também se descarta.
      if (state === 'dismissed')
        return write(ref, (action) => (action.kind === 'abrir' || action.kind === 'emails' || action.kind === 'email-lote' ? null : { ...action, status: 'dismissed', result: DISMISSED_TEXT }), undefined, true)
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

    async event(request) {
      const parsed = eventRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const ref = parsed.data
      const key = keyOf(ref)
      if (busy.has(key)) return { ok: false, error: 'done' }
      busy.add(key)
      try {
        const current = actionIn(await deps.store.get(ref.chatId), ref)
        if (!current || current.kind !== 'evento') return { ok: false, error: 'missing' }
        if (!open(current, true)) return { ok: false, error: 'done' }
        const timeZone = deps.timeZone()
        const fields = parsed.data.fields ?? {}
        // O "Editar" passa pelas mesmas regras da proposta (R1).
        const draft = eventDraft(
          {
            title: fields.title ?? current.title,
            start: fields.start ?? current.start,
            end: fields.end ?? current.end,
            allDay: fields.allDay ?? current.allDay,
            location: fields.location === undefined ? current.location : fields.location,
            notes: fields.notes === undefined ? current.notes : fields.notes,
          },
          now(),
          timeZone,
        )
        if ('error' in draft) return { ok: false, error: draft.error }
        if (!deps.calendar) return { ok: false, error: 'invalid' }
        const failed = (text: string, calendar: { id: string; title: string } | null): Promise<ChatActionResult> =>
          write(
            ref,
            (action) => (action.kind === 'evento' ? { ...action, ...draft, ...(calendar ? { calendarId: calendar.id, calendarTitle: calendar.title } : {}), status: 'failed', result: null, error: text.slice(0, CHAT_ACTION_ERROR_MAX) } : null),
            undefined,
            true,
          )
        // A agenda escolhida tem que existir e aceitar eventos agora (a lista do cartão pode ter envelhecido).
        const listed = await deps.calendar.calendars().catch(() => null)
        if (!listed) return failed(eventErrorText({ code: 'unavailable', reason: 'exited' }), null)
        if (!listed.ok) return failed(eventErrorText(listed.error), null)
        const calendar = listed.value.calendars.find((item) => item.id === parsed.data.calendarId)
        if (!calendar?.writable) return failed(NO_CALENDAR_TEXT, null)
        const chosen = { id: calendar.id, title: calendar.title.slice(0, 300) }
        const args = createArgs(draft, chosen.id, timeZone)
        const record = (ids: { eventIdentifier: string | null; calendarItemIdentifier: string; externalIdentifier: string | null }): Promise<void> =>
          deps.events
            ? deps.events
                .add({
                  actionId: ref.actionId,
                  chatId: ref.chatId,
                  calendarId: chosen.id,
                  eventIdentifier: ids.eventIdentifier,
                  calendarItemIdentifier: ids.calendarItemIdentifier,
                  externalIdentifier: ids.externalIdentifier,
                  title: draft.title,
                  start: draft.start,
                  end: draft.end,
                  allDay: draft.allDay,
                  createdAt: new Date(now()).toISOString(),
                })
                .catch(() => deps.log?.('[assistente] evento: o registro do evento não foi gravado'))
            : Promise.resolve()
        const finish = (result: string): Promise<ChatActionResult> =>
          write(ref, (action) => (action.kind === 'evento' ? { ...action, ...draft, calendarId: chosen.id, calendarTitle: chosen.title, status: 'done', result, error: null } : null), undefined, true)
        // Antes de criar (e sobretudo no "Tentar de novo"): o `create` que estourou o prazo ou caiu pode ter gravado no
        // EventKit. O mesmo título, início e fim na agenda escolhida já é este evento: registra e não cria outro.
        const found = await deps.calendar
          .find({ uid: `lap-assistente:${ref.chatId}:${ref.actionId}`, title: args.title, start: args.start, end: args.end, allDay: args.allDay })
          .catch(() => null)
        if (!found) return failed(eventErrorText({ code: 'unavailable', reason: 'exited' }), chosen)
        if (!found.ok) {
          deps.log?.(`[assistente] evento, procurar: ${found.error.code}/${found.error.reason}`)
          return failed(eventErrorText(found.error), chosen)
        }
        const already = found.value.matches.find(
          (item) => item.calendarId === chosen.id && item.allDay === args.allDay && item.title.trim() === args.title.trim() && normalizeWhen(item.start) === args.start && normalizeWhen(item.end) === args.end,
        )
        if (already) {
          await record(already)
          return await finish(eventAlreadyText(draft, chosen.title, timeZone))
        }
        const created = await deps.calendar.create(args).catch(() => null)
        if (!created) return failed(eventErrorText({ code: 'unavailable', reason: 'exited' }), chosen)
        if (!created.ok) deps.log?.(`[assistente] evento: ${created.error.code}/${created.error.reason}`)
        // O helper gravou e falhou depois (60): o evento está na agenda, então o cartão fica feito e não cria outro.
        const ids = created.ok ? created.value.event : created.error.saved
        if (!ids) return failed(created.ok ? NO_CALENDAR_TEXT : eventErrorText(created.error), chosen)
        await record(ids)
        return await finish(eventCreatedText(draft, chosen.title, timeZone))
      } finally {
        busy.delete(key)
      }
    },

    async reminderChange(request) {
      const parsed = reminderChangeRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const ref = parsed.data
      const key = keyOf(ref)
      if (busy.has(key)) return { ok: false, error: 'done' }
      busy.add(key)
      try {
        const current = actionIn(await deps.store.get(ref.chatId), ref)
        const kind = parsed.data.op === 'update' ? 'lembrete-editar' : 'lembrete-apagar'
        if (!current || current.kind !== kind) return { ok: false, error: 'missing' }
        if (current.status !== 'proposed') return { ok: false, error: 'done' }
        if (!deps.reminders) return { ok: false, error: 'invalid' }
        const timeZone = deps.timeZone()
        // Já disparou ou foi apagado entre a proposta e o clique: o cartão fica assim, sem tentar de novo.
        const gone = (): Promise<ChatActionResult> =>
          write(ref, (action) => (action.kind === 'lembrete-editar' || action.kind === 'lembrete-apagar' ? { ...action, status: 'failed', result: null, error: REMINDER_GONE_TEXT } : null))
        if (current.kind === 'lembrete-apagar') {
          const task = pendingReminder(await deps.reminders.list(), current.taskId)
          if (!task || !(await deps.reminders.remove(task.id))) return await gone()
          return await write(ref, (action) => (action.kind === 'lembrete-apagar' ? { ...action, status: 'done', result: REMINDER_DELETED_TEXT, error: null } : null))
        }
        if (current.kind !== 'lembrete-editar') return { ok: false, error: 'missing' }
        const at = parsed.data.at ?? current.at ?? undefined
        const text = parsed.data.text ?? current.text ?? undefined
        if (at === undefined && text === undefined) return { ok: false, error: 'invalid' }
        if (at !== undefined && Date.parse(at) <= now()) return { ok: false, error: 'past' }
        const changed = await deps.reminders.update(current.taskId, { ...(at !== undefined ? { at } : {}), ...(text !== undefined ? { text } : {}) })
        if (!changed.ok) return changed.reason === 'missing' ? await gone() : { ok: false, error: changed.reason }
        const savedAt = changed.task.schedule.kind === 'once' ? changed.task.schedule.at : (at ?? current.currentAt)
        const savedText = changed.task.reminder?.text ?? text ?? current.currentText
        return await write(ref, (action) =>
          action.kind === 'lembrete-editar'
            ? { ...action, at: savedAt, text: savedText === action.currentText ? action.text : savedText, status: 'done', result: reminderChangedText(savedAt, timeZone), error: null }
            : null,
        )
      } finally {
        busy.delete(key)
      }
    },

    async instagramDraft(request, onCreated) {
      const parsed = instagramDraftRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const ref = parsed.data
      const key = keyOf(ref)
      if (busy.has(key)) return { ok: false, error: 'done' }
      busy.add(key)
      try {
        const current = actionIn(await deps.store.get(ref.chatId), ref)
        if (!current || current.kind !== 'instagram-rascunho') return { ok: false, error: 'missing' }
        if (current.status !== 'proposed') return { ok: false, error: 'done' }
        if (!deps.instagram) return { ok: false, error: 'invalid' }
        // O "Editar" passa pelas mesmas regras da proposta: a legenda dentro dos limites do Instagram e a data no futuro.
        const caption = instagramCaption(parsed.data.caption ?? current.caption)
        const at = parsed.data.at === undefined ? current.at : parsed.data.at
        if (!caption || captionStats(caption).problems.length) return { ok: false, error: 'invalid' }
        if (at !== null && Date.parse(at) <= now()) return { ok: false, error: 'past' }
        const instagram = deps.instagram
        const finish = async (publicationId: string, fields: { caption: string; at: string | null }): Promise<ChatActionResult> => {
          const saved = await write(ref, (action) => (action.kind === 'instagram-rascunho' ? { ...action, ...fields, publicationId, status: 'done', result: INSTAGRAM_DRAFT_CREATED_TEXT } : null))
          if (saved.ok) onCreated?.({ accountId: current.accountId, publicationId })
          return saved
        }
        // O clique anterior criou o rascunho e não chegou a marcar o cartão: marca agora e reabre o mesmo, sem criar outro.
        if (current.publicationId && instagram.exists(current.publicationId)) return await finish(current.publicationId, { caption: current.caption, at: current.at })
        if (!instagram.accounts().some((item) => item.id === current.accountId)) return { ok: false, error: 'missing' }
        // O id do rascunho fica no cartão antes de criar: se a gravação de depois falhar, o próximo clique acha o rascunho.
        const publicationId = current.publicationId ?? randomUUID()
        if (!current.publicationId) {
          const reserved = await write(ref, (action) => (action.kind === 'instagram-rascunho' ? { ...action, publicationId } : null))
          if (!reserved.ok) return reserved
        }
        const created = await instagram.createDraft({ accountId: current.accountId, caption, at, publicationId })
        if (!created.ok) return { ok: false, error: created.error }
        return await finish(created.publicationId, { caption, at })
      } finally {
        busy.delete(key)
      }
    },

    async funil(request) {
      const parsed = funilRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const ref = parsed.data
      const key = keyOf(ref)
      if (busy.has(key)) return { ok: false, error: 'done' }
      busy.add(key)
      try {
        const current = actionIn(await deps.store.get(ref.chatId), ref)
        if (!current || !isFunilAction(current)) return { ok: false, error: 'missing' }
        if (current.status !== 'proposed') return { ok: false, error: 'done' }
        if (!deps.funil || (parsed.data.campos && current.kind !== 'oportunidade-criar')) return { ok: false, error: 'invalid' }
        const funil = deps.funil
        const kind = current.kind
        /** O clique que o funil recusou: o cartão fica `failed`, com a frase do funil. */
        const failed = (error: string): Promise<ChatActionResult> =>
          write(ref, (action) => (action.kind === kind ? { ...action, status: 'failed', result: null, error: error.slice(0, CHAT_ACTION_ERROR_MAX) } : null))
        const done = (change: (action: ChatActionFunil) => ChatActionFunil): Promise<ChatActionResult> => write(ref, (action) => (action.kind === kind && isFunilAction(action) ? change(action) : null))
        const refused = (result: FunilActionResult): string | null => (result.ok ? null : result.mensagem)
        const { state } = await funil.view()

        if (current.kind === 'oportunidade-mover') {
          // O funil pode ter mudado entre a proposta e o clique.
          if (!oportunidadeViva(state, current.oportunidadeId)) return await failed(FUNIL_OPORTUNIDADE_NAO_ENCONTRADA)
          const etapa = state.etapas.find((item) => item.id === current.paraEtapaId)
          if (!etapa) return await failed(FUNIL_ETAPA_NAO_ENCONTRADA)
          // Para Perdido, a nota é o motivo da perda; nas outras etapas, uma nota na linha do tempo.
          const perdido = etapa.tipo === 'perdido'
          const moved = await funil.oportunidadeMove({ id: current.oportunidadeId, etapaId: etapa.id, ordem: 0, ...(perdido ? { motivoPerda: current.nota } : {}) })
          const movedError = refused(moved)
          if (movedError) return await failed(movedError)
          if (current.nota && !perdido) {
            const nota = await funil.eventoAdd({ oportunidadeId: current.oportunidadeId, texto: current.nota })
            if (!nota.ok) deps.log?.(`[assistente] funil: a nota da oportunidade movida não foi gravada (${nota.erro})`)
          }
          return await done((action) => ({ ...action, para: etapa.nome, status: 'done', result: funilMovidaText(etapa.nome), error: null }))
        }

        if (current.kind === 'oportunidade-proximo-passo') {
          const oportunidade = oportunidadeViva(state, current.oportunidadeId)
          if (!oportunidade) return await failed(FUNIL_OPORTUNIDADE_NAO_ENCONTRADA)
          const saved = await funil.oportunidadeSave({ oportunidade: { id: oportunidade.id, titulo: oportunidade.titulo, proximoPasso: { texto: current.texto, data: current.data } } })
          const savedError = refused(saved)
          if (savedError) return await failed(savedError)
          return await done((action) => ({ ...action, status: 'done', result: FUNIL_PASSO_SALVO_TEXT, error: null }))
        }

        if (current.kind === 'contato-criar') {
          const saved = await funil.contatoSave({
            contato: { nome: current.nome, emails: current.email ? [current.email] : [], telefones: current.telefone ? [current.telefone] : [], empresaNome: current.empresa, cargo: current.cargo },
            origem: 'assistente',
          })
          if (!saved.ok) return await failed(saved.mensagem)
          const contatoId = saved.id
          const result = saved.mesclado ? FUNIL_CONTATO_COMPLETADO_TEXT : FUNIL_CONTATO_CRIADO_TEXT
          return await done((action) => (action.kind === 'contato-criar' ? { ...action, contatoId, status: 'done', result, error: null } : action))
        }

        // `oportunidade-criar`: o que o cartão mudou passa pelas mesmas regras da proposta.
        const campos = parsed.data.campos ?? {}
        const draft = criarDraft(
          {
            titulo: campos.titulo ?? current.titulo,
            empresa: campos.empresa === undefined ? current.empresa : campos.empresa,
            contatos: campos.contatos ?? current.contatos,
            etapaId: campos.etapaId ?? current.etapaId,
            valor: campos.valor === undefined ? current.valor : campos.valor,
            previsao: campos.previsao === undefined ? current.previsao : campos.previsao,
            proximoPasso: campos.proximoPasso === undefined ? current.proximoPasso : campos.proximoPasso,
          },
          state,
        )
        if ('error' in draft) return { ok: false, error: 'invalid' }
        // Os contatos com e-mail que ainda não estão no funil entram (ou completam o que já tem o e-mail, R4); os sem
        // e-mail ficam numa nota da oportunidade (R39).
        const contatoIds: string[] = []
        const citados: string[] = []
        for (const contato of draft.contatos) {
          if (contato.contatoId) {
            contatoIds.push(contato.contatoId)
            continue
          }
          if (!contato.email) {
            citados.push(contato.nome)
            continue
          }
          const saved = await funil.contatoSave({ contato: { nome: contato.nome, emails: [contato.email], telefones: [] }, origem: 'assistente' })
          if (!saved.ok) return await failed(saved.mensagem)
          if (saved.id) contatoIds.push(saved.id)
        }
        const created = await funil.oportunidadeSave({
          oportunidade: {
            titulo: draft.titulo,
            empresaNome: draft.empresa,
            contatoIds: [...new Set(contatoIds)],
            etapaId: draft.etapaId,
            valor: draft.valor,
            previsao: draft.previsao,
            proximoPasso: draft.proximoPasso,
            origem: 'assistente',
          },
        })
        if (!created.ok) return await failed(created.mensagem)
        const oportunidadeId = created.id
        if (oportunidadeId && citados.length) {
          const nota = await funil.eventoAdd({ oportunidadeId, texto: funilNotaCitados(citados) })
          if (!nota.ok) deps.log?.(`[assistente] funil: a nota dos citados não foi gravada (${nota.erro})`)
        }
        return await done((action) => (action.kind === 'oportunidade-criar' ? { ...action, ...draft, oportunidadeId, status: 'done', result: FUNIL_OPORTUNIDADE_CRIADA_TEXT, error: null } : action))
      } catch (error) {
        deps.log?.(`[assistente] funil: ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, error: 'invalid' }
      } finally {
        busy.delete(key)
      }
    },
  }
}
