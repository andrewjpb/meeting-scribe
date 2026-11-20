// Cartões de ação do Assistente (contrato 25, CA3 e CA4): o que o Claude propôs no fim da resposta, já validado
// pelo main. Nenhum cartão faz nada sozinho: "Criar lembrete" pede ao main a tarefa "uma vez" das Automações;
// "Enviar" usa só `window.__scribeApi.whatsappSend` (o token de clique do preload do contrato 24; sem diálogo
// nativo desde o contrato 33); "Criar tarefa" abre o formulário das Automações preenchido para revisar; "Abrir" leva à
// tela. Depois do clique, o cartão mostra o estado, que fica gravado na conversa. Contrato 26: numa resposta que usou a
// internet, cada cartão vem com o aviso de conferir antes. Contrato 45: os cartões de email. A lista mostra o que o main
// leu do cache quando a resposta terminou (nada é buscado de novo ao desenhar) e o clique abre a tela Email na
// mensagem; o rascunho de resposta só sai pelo `window.__scribeApi.emailSend` (o token de clique do contrato 42), sem
// diálogo, e vira "Enviado às hh:mm".
// Contrato 78: o cartão de evento (só grava no Calendário do Mac no clique em "Pôr na agenda"; o "Editar" muda só o
// cartão) e os cartões de alterar e apagar um lembrete, cada um pelo seu canal no main.
import {
  ArrowRight,
  Bell,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  ExternalLink,
  Globe,
  ListChecks,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  emailSentText,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  eventWhen,
  reminderTitle,
  reminderWhen,
  REMINDER_TEXT_MAX,
  sentText,
  type ChatAction,
  type ChatActionCalendar,
  type ChatActionEvent,
  type ChatActionEventFields,
  type ChatActionRef,
  type ChatActionReminderDelete,
  type ChatActionReminderEdit,
  type ChatCalendarAccess,
  type EmailListAction,
  type EmailReplyAction,
  type OpenAction,
  type ReminderAction,
  type TaskAction,
  type WhatsAppReplyAction,
} from '@shared/assistant'
import { EMAIL_TEXT_MAX } from '@shared/email'
import { describeSchedule, TASK_TIMEOUT_DEFAULT_S } from '@shared/automations'
import { emailPath, meetingPath, ROUTE_PATHS, settingsPath, isSettingsTab, type EmailNavigationState, type WhatsAppNavigationState } from '@shared/routes'
import { WHATSAPP_SEND_TEXT_MAX } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { useAutomations, type AutomationsTab } from '../agents/automationsStore'
import { emailTimeLabel, sendErrorText } from '../email/format'
import { MENU_ITEM, useInlineMenu } from '../meetings/menu'
import { macTimeZone } from '../schedules/TaskForm'
import { QUIET_BUTTON } from './ChatMessages'
import { useChat } from './chatStore'
import { EmailBatchCard } from './EmailBatchCard'

const CARD = 'flex max-w-[72ch] flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3'
const FIELD = 'no-drag rounded-[var(--radius-control)] border border-line-strong bg-bg px-2 text-13 text-text select-text'

const REMINDER_ERRORS: Record<string, string> = {
  past: 'Esse horário já passou. Escolha outro.',
  full: 'Limite de tarefas atingido.',
  done: 'Este cartão já foi usado.',
  missing: 'Esta conversa não existe mais.',
  invalid: 'Confira a data e o texto do lembrete.',
}
const SEND_ERRORS: Record<string, string> = {
  click: 'Clique em "Enviar" para mandar a mensagem.',
  state: 'O WhatsApp não está conectado. Confira em Configurações › Contas.',
  invalid: 'Esta conversa não existe mais.',
  failed: 'Não foi possível enviar. Tente de novo.',
}

const two = (value: number): string => String(value).padStart(2, '0')
/** ISO -> valor do `<input type="datetime-local">`, na hora local. */
function localInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

/** O estado depois do clique: "Lembrete criado · ter 17/11 09:00", "Enviada às 19:40", "Descartado". */
function Outcome({ action }: { action: ChatAction }) {
  return (
    <p data-chat-action-result className={`flex items-center gap-1.5 text-12 ${action.status === 'dismissed' ? 'text-text-faint' : 'text-text-muted'}`}>
      <Icon icon={action.status === 'dismissed' ? X : Check} size={14} className="shrink-0" />
      {action.result ?? (action.status === 'dismissed' ? 'Descartado' : 'Feito')}
    </p>
  )
}

function DismissButton({ actionRef, disabled }: { actionRef: ChatActionRef; disabled: boolean }) {
  return (
    <button type="button" data-action="chat-action-dismiss" disabled={disabled} onClick={() => void useChat.getState().setActionState(actionRef, 'dismissed')} className={QUIET_BUTTON}>
      Descartar
    </button>
  )
}

function ReminderCard({ action, actionRef }: { action: ReminderAction; actionRef: ChatActionRef }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [when, setWhen] = useState(() => localInput(action.at))
  const [text, setText] = useState(action.text)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const timeZone = macTimeZone()
  const proposed = action.status === 'proposed'
  const editedAt = editing && when ? new Date(when) : null
  const shown = { at: editedAt && !Number.isNaN(editedAt.getTime()) ? editedAt.toISOString() : action.at, text: editing ? text : action.text }

  const create = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().createReminder(actionRef, editing ? { at: shown.at, text } : {})
    setBusy(false)
    if (!result.ok) setFailure(REMINDER_ERRORS[result.error] ?? REMINDER_ERRORS['invalid'] ?? '')
  }

  return (
    <div data-chat-action="lembrete" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Bell} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>{reminderTitle(shown, new Date().getTime(), timeZone)}</span>
      </p>
      {action.whatsappChatName && <p className="text-12 text-text-muted">Conversa do WhatsApp: {action.whatsappChatName}</p>}
      {action.email && (
        <p data-chat-action-email-label className="text-12 text-text-muted">
          Email: {action.email.label}
          {action.email.mailbox ? ` (no servidor, pasta ${action.email.mailbox})` : ''}
        </p>
      )}
      {proposed && action.defaultTime && !editing && <p data-chat-action-default-time className="text-12 text-text-muted">O pedido não disse a hora: ficou para as 09:00.</p>}
      {proposed && editing && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Data e hora
            <input type="datetime-local" data-chat-action-when value={when} onChange={(event) => setWhen(event.target.value)} className={`${FIELD} h-8 w-56`} />
          </label>
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Texto
            <input type="text" data-chat-action-text value={text} maxLength={REMINDER_TEXT_MAX} onChange={(event) => setText(event.target.value)} className={`${FIELD} h-8`} />
          </label>
        </div>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button action="chat-action-reminder-create" icon={Bell} onClick={() => void create()} disabled={busy || (editing && (!when || !text.trim()))}>
            Criar lembrete
          </Button>
          {!editing && (
            <Button action="chat-action-edit" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Outcome action={action} />
          {action.status === 'done' && (
            <button
              type="button"
              data-action="chat-action-open-tasks"
              onClick={() => {
                useAutomations.getState().setTab('tarefas')
                void navigate(ROUTE_PATHS.automacoes)
              }}
              className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title"
            >
              Ver em Automações
            </button>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

function WhatsAppCard({ action, actionRef, choice }: { action: WhatsAppReplyAction; actionRef: ChatActionRef; choice: boolean }) {
  const navigate = useNavigate()
  const [text, setText] = useState(action.text)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Enviada, mas o estado do cartão ainda não foi gravado: a tela já mostra "Enviada" e nunca oferece "Enviar" de novo.
  const [sentHere, setSentHere] = useState<{ text: string; result: string } | null>(null)
  const proposed = action.status === 'proposed' && !sentHere

  /** Grava "Enviada" no main; se falhar (bloqueado, erro), tenta de novo a cada 3 s, até 20 vezes. */
  const persistSent = (body: string, attempt = 0): void => {
    void useChat
      .getState()
      .setActionState(actionRef, 'sent', body)
      .then((result) => {
        if (!result.ok && result.error !== 'done' && result.error !== 'missing' && attempt < 20) setTimeout(() => persistSent(body, attempt + 1), 3000)
      })
  }

  // O envio de verdade: só daqui, no clique da pessoa, pelo mesmo caminho da tela "WhatsApp" (contrato 24).
  const send = (): void => {
    const body = text
    if (!body.trim() || sending) return
    setSending(true)
    setFailure(null)
    void window.__scribeApi.whatsappSend({ chatId: action.chatId, text: body }).then(
      (result) => {
        setSending(false)
        if (result.ok) {
          setSentHere({ text: body, result: sentText(new Date().getTime()) })
          persistSent(body)
        } else setFailure(SEND_ERRORS[result.error] ?? SEND_ERRORS['failed'] ?? '')
      },
      () => {
        setSending(false)
        setFailure(SEND_ERRORS['failed'] ?? '')
      },
    )
  }
  const openInWhatsApp = (): void => {
    const state: WhatsAppNavigationState = { chatId: action.chatId, text }
    void navigate(ROUTE_PATHS.whatsapp, { state })
  }

  return (
    <div data-chat-action="whatsapp-resposta" data-chat-action-status={sentHere && action.status === 'proposed' ? 'done' : action.status} data-chat-action-chat={action.chatId} className={CARD}>
      <p className="flex items-center gap-2 text-12 font-medium text-text-muted">
        <Icon icon={MessageSquare} size={14} className="shrink-0" />
        {choice ? 'É esta conversa?' : 'Responder no WhatsApp'}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span data-chat-action-name className="text-13 font-bold text-title">
          {action.chatName}
        </span>
        <span data-chat-action-phone className="text-12 text-text-muted tabular">
          {action.group ? 'grupo' : (action.phone ?? 'número oculto pelo WhatsApp')}
        </span>
      </p>
      {proposed ? (
        <>
          <label className="sr-only" htmlFor={`chat-action-text-${action.id}`}>
            Mensagem para {action.chatName}
          </label>
          <textarea
            id={`chat-action-text-${action.id}`}
            data-chat-action-message
            value={text}
            rows={3}
            maxLength={WHATSAPP_SEND_TEXT_MAX}
            onChange={(event) => setText(event.target.value)}
            className={`${FIELD} min-h-16 resize-none py-1.5 text-15`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button action="chat-action-send" icon={Send} onClick={send} disabled={sending || !text.trim()}>
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
            <Button action="chat-action-open-whatsapp" variant="secondary" icon={ExternalLink} onClick={openInWhatsApp}>
              Abrir no WhatsApp
            </Button>
            <DismissButton actionRef={actionRef} disabled={sending} />
          </div>
          <p className="text-12 text-text-faint">O macOS pergunta antes de enviar.</p>
        </>
      ) : (
        <>
          <p className="max-w-[72ch] text-13 whitespace-pre-wrap text-text-muted select-text">{sentHere && action.status === 'proposed' ? sentHere.text : action.text}</p>
          <Outcome action={sentHere && action.status === 'proposed' ? { ...action, status: 'done', result: sentHere.result } : action} />
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

function TaskCard({ action, actionRef }: { action: TaskAction; actionRef: ChatActionRef }) {
  const navigate = useNavigate()
  const timeZone = macTimeZone()
  const open = (): void => {
    useAutomations.getState().openTaskDraft(
      {
        id: null,
        name: action.name,
        agentId: action.agentId,
        message: action.message,
        schedule: action.schedule,
        timezone: timeZone,
        enabled: true,
        runOnce: action.schedule.kind === 'once',
        runOnceAction: 'disable',
        timeoutS: TASK_TIMEOUT_DEFAULT_S,
        notify: 'on-error',
        output: null,
      },
      actionRef,
    )
    void navigate(ROUTE_PATHS.automacoes)
  }
  return (
    <div data-chat-action="tarefa" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={ListChecks} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span>Tarefa · {action.name}</span>
      </p>
      <p data-chat-action-schedule className="text-12 text-text-muted">
        {describeSchedule(action.schedule, timeZone)} · agente {action.agentName}
      </p>
      <p className="text-13 text-text select-text">{action.message}</p>
      {action.status === 'proposed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button action="chat-action-task-create" icon={ListChecks} onClick={open}>
            Criar tarefa
          </Button>
          <DismissButton actionRef={actionRef} disabled={false} />
        </div>
      ) : (
        <Outcome action={action} />
      )}
    </div>
  )
}

function OpenCard({ action }: { action: OpenAction }) {
  const navigate = useNavigate()
  const go = (): void => {
    switch (action.screen) {
      case 'reuniao':
        if (action.target) void navigate(meetingPath(action.target))
        return
      case 'reunioes':
        void navigate(ROUTE_PATHS.reunioes)
        return
      case 'gravacao':
        void navigate(ROUTE_PATHS.gravacao)
        return
      case 'whatsapp': {
        const state: WhatsAppNavigationState = action.target ? { chatId: action.target } : {}
        void navigate(ROUTE_PATHS.whatsapp, { state })
        return
      }
      case 'configuracoes':
        void navigate(isSettingsTab(action.target) ? settingsPath(action.target) : ROUTE_PATHS.configuracoes)
        return
      case 'automacoes':
        if (action.target) useAutomations.getState().setTab(action.target as AutomationsTab)
        void navigate(ROUTE_PATHS.automacoes)
    }
  }
  return (
    <div data-chat-action="abrir" className="flex">
      <Button action="chat-action-open" variant="secondary" icon={ExternalLink} onClick={go}>
        {action.label}
      </Button>
    </div>
  )
}

/** Contrato 45 (CA2): os emails da resposta, cada um clicável (abre a tela Email na mensagem). */
function EmailListCard({ action }: { action: EmailListAction }) {
  const navigate = useNavigate()
  const open = (accountId: string, messageId: string): void => {
    const state: EmailNavigationState = { messageId }
    void navigate(emailPath(accountId, 'inbox'), { state })
  }
  return (
    <div data-chat-action="emails" className={CARD}>
      <p className="flex items-center gap-2 text-12 font-medium text-text-muted">
        <Icon icon={Mail} size={14} className="shrink-0" />
        {action.items.length === 1 ? '1 email' : `${action.items.length} emails`}
      </p>
      <ul className="flex flex-col">
        {action.items.map((item) => {
          const body = (
            <>
              <span className="flex min-w-0 items-baseline gap-2">
                {!item.seen && <span aria-label="Não lida" className="size-1.5 shrink-0 self-center bg-accent" />}
                <span data-chat-email-from className={`truncate text-13 ${item.seen ? 'text-text' : 'font-bold text-title'}`}>
                  {item.from}
                </span>
                <span data-chat-email-time className="ml-auto shrink-0 text-12 text-text-muted tabular">
                  {emailTimeLabel(item.date)}
                </span>
              </span>
              <span data-chat-email-subject className="truncate text-13 text-text">
                {item.subject || '(sem assunto)'}
              </span>
              <span data-chat-email-account className="truncate text-12 text-text-faint">
                {item.account}
                {item.pending ? ' · pendente de resposta' : ''}
                {item.mailbox ? ` · só no servidor (pasta ${item.mailbox})` : ''}
              </span>
            </>
          )
          return (
            <li key={`${item.accountId}:${item.mailbox ?? ''}:${item.messageId}`} className="border-t border-line first:border-t-0">
              {item.mailbox === null ? (
                <button
                  type="button"
                  data-action="chat-email-open"
                  data-chat-email-item={item.messageId}
                  onClick={() => open(item.accountId, item.messageId)}
                  className="no-drag flex w-full min-w-0 flex-col gap-0.5 rounded-[var(--radius-control)] px-1 py-2 text-left hover:bg-bg-sunken"
                >
                  {body}
                </button>
              ) : (
                <div data-chat-email-item={item.messageId} className="flex min-w-0 flex-col gap-0.5 px-1 py-2">
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Contrato 45 (CA3): o rascunho da resposta por email. Destinatário, assunto e conta vêm do app; o corpo é editável. O
 * envio só acontece no clique em "Enviar", pelo `emailSend` do preload, com o `In-Reply-To` da mensagem respondida.
 */
function EmailReplyCard({ action, actionRef }: { action: EmailReplyAction; actionRef: ChatActionRef }) {
  const navigate = useNavigate()
  const [text, setText] = useState(action.text)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Enviado, mas o estado do cartão ainda não foi gravado: a tela já mostra "Enviado" e nunca oferece "Enviar" de novo.
  const [sentHere, setSentHere] = useState<{ text: string; result: string } | null>(null)
  const proposed = action.status === 'proposed' && !sentHere

  const persistSent = (body: string, attempt = 0): void => {
    void useChat
      .getState()
      .setActionState(actionRef, 'sent', body)
      .then((result) => {
        if (!result.ok && result.error !== 'done' && result.error !== 'missing' && attempt < 20) setTimeout(() => persistSent(body, attempt + 1), 3000)
      })
  }

  // O envio de verdade: só daqui, no clique da pessoa, pelo mesmo caminho do composer da tela Email (contrato 42).
  const send = (): void => {
    const body = text
    if (!body.trim() || sending) return
    setSending(true)
    setFailure(null)
    void window.__scribeApi.emailSend({ accountId: action.accountId, to: action.to, subject: action.subject, text: body, inReplyTo: action.inReplyTo ?? undefined }).then(
      (result) => {
        setSending(false)
        if (result.ok) {
          setSentHere({ text: body, result: emailSentText(new Date().getTime()) })
          persistSent(body)
        } else setFailure(sendErrorText(result.error))
      },
      () => {
        setSending(false)
        setFailure(sendErrorText('failed'))
      },
    )
  }
  const openOriginal = (): void => {
    const state: EmailNavigationState = { messageId: action.messageId }
    void navigate(emailPath(action.accountId, 'inbox'), { state })
  }
  const shownStatus = sentHere && action.status === 'proposed' ? 'done' : action.status

  return (
    <div data-chat-action="email-resposta" data-chat-action-status={shownStatus} className={CARD}>
      <p className="flex items-center gap-2 text-12 font-medium text-text-muted">
        <Icon icon={Mail} size={14} className="shrink-0" />
        Responder por email
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-13">
        <dt className="text-text-muted">Para</dt>
        <dd data-chat-email-to className="min-w-0 truncate font-bold text-title">
          {action.toLabel}
        </dd>
        <dt className="text-text-muted">Assunto</dt>
        <dd data-chat-email-subject className="min-w-0 truncate text-text">
          {action.subject}
        </dd>
        <dt className="text-text-muted">De</dt>
        <dd data-chat-email-account className="min-w-0 truncate text-text-muted">
          {action.account}
        </dd>
      </dl>
      {proposed ? (
        <>
          <label className="sr-only" htmlFor={`chat-action-email-${action.id}`}>
            Resposta para {action.toLabel}
          </label>
          <textarea
            id={`chat-action-email-${action.id}`}
            data-chat-action-message
            value={text}
            rows={5}
            maxLength={EMAIL_TEXT_MAX}
            onChange={(event) => setText(event.target.value)}
            className={`${FIELD} min-h-24 resize-y py-1.5 text-15`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button action="chat-action-email-send" icon={Send} onClick={send} disabled={sending || !text.trim()}>
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
            {action.mailbox === null && (
              <Button action="chat-action-email-open" variant="secondary" icon={ExternalLink} onClick={openOriginal}>
                Abrir o email
              </Button>
            )}
            <DismissButton actionRef={actionRef} disabled={sending} />
          </div>
          {action.mailbox !== null && (
            <p data-chat-email-server className="text-12 text-text-muted">
              O email respondido está no servidor, na pasta {action.mailbox} (fora da Caixa de Entrada do app).
            </p>
          )}
          <p className="text-12 text-text-faint">Só sai com o seu clique em "Enviar".</p>
        </>
      ) : (
        <>
          <p className="max-w-[72ch] text-13 whitespace-pre-wrap text-text-muted select-text">{sentHere && action.status === 'proposed' ? sentHere.text : action.text}</p>
          <Outcome action={sentHere && action.status === 'proposed' ? { ...action, status: 'done', result: sentHere.result } : action} />
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

// --- Contrato 78: evento no Calendário do Mac e lembretes ---------------------------------------------------------

const EVENT_ERRORS: Record<string, string> = {
  past: 'Esse dia já passou. Escolha hoje ou um dia depois.',
  done: 'Este cartão já foi usado.',
  missing: 'Esta conversa não existe mais.',
  invalid: 'Confira o título, a data e o horário do evento.',
}
const REMINDER_CHANGE_ERRORS: Record<string, string> = { ...REMINDER_ERRORS, invalid: 'Confira a data e o texto do lembrete.' }

/** ISO -> "AAAA-MM-DD" e "hh:mm", na hora local. */
function localParts(iso: string): { date: string; time: string } {
  const value = localInput(iso)
  return { date: value.slice(0, 10), time: value.slice(11, 16) }
}

/** "AAAA-MM-DD" + "hh:mm" na hora local -> ISO; `null` se não é uma data. */
function isoOf(date: string, time: string): string | null {
  const at = new Date(`${date}T${time || '00:00'}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** O dia seguinte de "AAAA-MM-DD", à meia-noite local, em ISO. */
function nextDayIso(date: string): string | null {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const at = new Date(year, month - 1, day + 1)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** O erro do cartão (`failed`): a frase do main em --rec. */
function CardError({ text }: { text: string }) {
  return (
    <p role="alert" data-chat-action-error className="flex items-start gap-1.5 text-12 text-rec">
      <Icon icon={CircleAlert} size={14} className="mt-px shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/** "Ver em Automações", na aba Tarefas agendadas. */
function OpenTasksLink() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      data-action="chat-action-open-tasks"
      onClick={() => {
        useAutomations.getState().setTab('tarefas')
        void navigate(ROUTE_PATHS.automacoes)
      }}
      className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title"
    >
      Ver em Automações
    </button>
  )
}

/** O ponto com a cor que o Mac dá à agenda (redondo: 8 px com o raio de 4 px). A cor vem do Calendário, não do tema. */
function CalendarDot({ color }: { color: string | null }) {
  if (!color) return <span aria-hidden="true" className="size-2 shrink-0 rounded-[var(--radius-control)] border border-line-strong" />
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-[var(--radius-control)]" style={{ backgroundColor: color }} />
}

/** O seletor de agenda do cartão de evento: as graváveis, com o ponto da cor e a conta. */
function EventCalendarSelect({ calendars, value, onChange, id }: { calendars: readonly ChatActionCalendar[]; value: string | null; onChange: (id: string) => void; id: string }) {
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(open, close)
  const current = calendars.find((item) => item.id === value) ?? null

  useEffect(() => {
    if (!open) return
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    ;(options.find((item) => item.getAttribute('aria-selected') === 'true') ?? options[0])?.focus()
  }, [open, menu])

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    if (!options.length) return
    event.preventDefault()
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? Math.min(at + 1, options.length - 1) : Math.max(at - 1, 0)
    options[next]?.focus()
  }

  const pick = (calendarId: string): void => {
    close()
    button.current?.focus()
    onChange(calendarId)
  }

  return (
    <div data-chat-event-calendar-picker onBlur={onBlur} onKeyDown={open ? onKeyDown : undefined} className="relative min-w-0">
      <button
        ref={button}
        id={id}
        type="button"
        data-chat-event-calendar={current?.id ?? ''}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `Agenda: ${current.title} (${current.source})` : 'Agenda: escolher'}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`no-drag inline-flex h-8 max-w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-bg pr-2 pl-2.5 text-13 whitespace-nowrap text-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken ${open ? 'bg-bg-sunken' : ''}`}
      >
        {current ? (
          <>
            <CalendarDot color={current.color} />
            <span className="truncate">
              {current.title} ({current.source})
            </span>
          </>
        ) : (
          <span className="truncate text-text-muted">Escolher agenda</span>
        )}
        <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
      </button>
      {open && (
        <div
          ref={menu}
          role="listbox"
          aria-label="Agenda"
          data-chat-event-calendar-menu
          onKeyDown={onListKey}
          className="absolute top-full left-0 z-10 mt-1 flex w-60 max-w-[80vw] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-1"
        >
          {calendars.map((calendar) => {
            const selected = calendar.id === value
            return (
              <button
                key={calendar.id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                data-chat-event-calendar-option={calendar.id}
                onClick={() => pick(calendar.id)}
                className={`${MENU_ITEM} gap-2 rounded-[var(--radius-control)] px-2 ${selected ? 'bg-bg-sunken font-medium text-title' : 'text-text'}`}
              >
                <CalendarDot color={calendar.color} />
                <span className="truncate">{calendar.title}</span>
                <span className="ml-auto shrink-0 text-12 font-normal text-text-faint">{calendar.source}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

type EventShown = Pick<ChatActionEvent, 'title' | 'start' | 'end' | 'allDay' | 'location' | 'notes'>

/** O formulário do "Editar" do evento: os campos ficam aqui até "Salvar" (que só muda o cartão). */
interface EventForm {
  title: string
  date: string
  from: string
  /** O dia do fim (o evento pode passar da meia-noite); no dia inteiro, não vale. */
  endDate: string
  to: string
  allDay: boolean
  location: string
  notes: string
}

function formOf(shown: EventShown): EventForm {
  const start = localParts(shown.start)
  const end = localParts(shown.end)
  return {
    title: shown.title,
    date: start.date,
    from: shown.allDay ? '09:00' : start.time,
    endDate: shown.allDay ? start.date : end.date,
    to: shown.allDay ? '10:00' : end.time,
    allDay: shown.allDay,
    location: shown.location ?? '',
    notes: shown.notes ?? '',
  }
}

/** O formulário de volta ao cartão; `null` (com a razão) se não vale. */
function shownOf(form: EventForm): EventShown | string {
  const title = form.title.replace(/\s+/g, ' ').trim()
  if (!title) return 'Escreva o título do evento.'
  const start = isoOf(form.date, form.allDay ? '00:00' : form.from)
  const end = form.allDay ? nextDayIso(form.date) : isoOf(form.endDate || form.date, form.to)
  if (!start || !end) return 'Escolha a data e o horário.'
  const today = new Date()
  if (Date.parse(start) < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) return EVENT_ERRORS['past'] ?? ''
  if (Date.parse(end) <= Date.parse(start)) return 'O fim tem que ser depois do início.'
  return { title: title.slice(0, EVENT_TITLE_MAX), start, end, allDay: form.allDay, location: form.location.trim() || null, notes: form.notes.trim() || null }
}

const ACCESS_OF: Readonly<Record<string, ChatCalendarAccess>> = { full: 'full', notDetermined: 'not-determined', denied: 'denied', restricted: 'denied', writeOnly: 'denied' }

/**
 * Contrato 78 (R1, quadros 02 e 03): o evento proposto, com a agenda num seletor. "Pôr na agenda" grava pelo main, na
 * agenda escolhida, com o que o "Editar" mudou; sem acesso, o aviso e "Pedir acesso" (ou "Abrir Ajustes", negado), e o
 * botão principal desabilitado até liberar. O erro do Calendário vira `failed`, com "Tentar de novo".
 */
function EventCard({ action, actionRef }: { action: ChatActionEvent; actionRef: ChatActionRef }) {
  const timeZone = macTimeZone()
  const [shown, setShown] = useState<EventShown>(action)
  const [edited, setEdited] = useState(false)
  const [form, setForm] = useState<EventForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Depois do "Pedir acesso", o cartão relê o acesso e as agendas (o que foi gravado com a resposta não muda).
  const [calendarState, setCalendarState] = useState<{ access: ChatCalendarAccess; calendars: ChatActionCalendar[] }>({ access: action.access, calendars: action.calendars })
  const [calendarId, setCalendarId] = useState<string | null>(action.calendarId)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const open = action.status === 'proposed' || action.status === 'failed'
  const { access, calendars } = calendarState
  const full = access === 'full'
  const view: EventShown = open ? shown : action

  const create = async (): Promise<void> => {
    if (busy || !calendarId) return
    setBusy(true)
    setFailure(null)
    const fields: ChatActionEventFields | undefined = edited ? { title: shown.title, start: shown.start, end: shown.end, allDay: shown.allDay, location: shown.location, notes: shown.notes } : undefined
    const result = await useChat.getState().createEvent(actionRef, calendarId, fields)
    setBusy(false)
    if (!result.ok) setFailure(EVENT_ERRORS[result.error] ?? EVENT_ERRORS['invalid'] ?? '')
  }

  const requestAccess = (): void => {
    if (asking) return
    setAsking(true)
    void window.__scribeApi
      .invoke('scribe:invite-request-access')
      .catch(() => null)
      .then(() => window.__scribeApi.invoke('scribe:invite-calendars'))
      .then((result) => {
        if (!result.ok) {
          setCalendarState({ access: 'unavailable', calendars: [] })
          return
        }
        const next = ACCESS_OF[result.access] ?? 'denied'
        // As agendas do canal dos convites vêm sem cor: o ponto fica só com o contorno.
        const list: ChatActionCalendar[] = next === 'full' ? result.calendars.map((item) => ({ id: item.id, title: item.title, source: item.sourceTitle, color: null, isDefault: item.isDefault })) : []
        setCalendarState({ access: next, calendars: list })
        setCalendarId((current) => (current && list.some((item) => item.id === current) ? current : (result.defaultId ?? list[0]?.id ?? null)))
      })
      .catch(() => setCalendarState({ access: 'unavailable', calendars: [] }))
      .finally(() => setAsking(false))
  }

  const save = (): void => {
    if (!form) return
    const next = shownOf(form)
    if (typeof next === 'string') {
      setFormError(next)
      return
    }
    setShown(next)
    setEdited(true)
    setForm(null)
    setFormError(null)
  }

  const chosen = calendars.find((item) => item.id === calendarId) ?? null
  const accessNote =
    access === 'not-determined'
      ? 'O app ainda não tem acesso ao Calendário.'
      : access === 'denied'
        ? 'O acesso ao Calendário foi negado. Libere o app em Ajustes do Sistema › Privacidade e Segurança › Calendários.'
        : access === 'unavailable'
          ? 'O Calendário do Mac não está disponível agora.'
          : calendars.length === 0
            ? 'Nenhuma agenda gravável no Calendário do Mac.'
            : null
  const field = `${FIELD} h-8`

  return (
    <div data-chat-action="evento" data-chat-action-status={action.status} {...(form ? { 'data-editing': '' } : {})} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Calendar} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>{form ? shown.title : view.title}</span>
      </p>
      {form ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Título
            <input type="text" data-chat-event-field="title" value={form.title} maxLength={EVENT_TITLE_MAX} onChange={(event) => setForm({ ...form, title: event.target.value })} className={field} />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="flex w-40 flex-col gap-1 text-12 text-text-muted">
              Data
              <input
                type="date"
                data-chat-event-field="date"
                value={form.date}
                // O fim no mesmo dia acompanha a troca do dia do início.
                onChange={(event) => setForm({ ...form, date: event.target.value, endDate: form.endDate === form.date ? event.target.value : form.endDate })}
                className={field}
              />
            </label>
            {!form.allDay && (
              <>
                <label className="flex w-24 flex-col gap-1 text-12 text-text-muted">
                  Início
                  <input type="time" data-chat-event-field="from" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} className={field} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-12 text-text-muted">
                  Data do fim
                  <input type="date" data-chat-event-field="endDate" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} className={field} />
                </label>
                <label className="flex w-24 flex-col gap-1 text-12 text-text-muted">
                  Fim
                  <input type="time" data-chat-event-field="to" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} className={field} />
                </label>
              </>
            )}
          </div>
          <label className="flex h-6 items-center gap-2 text-13 text-text">
            <input type="checkbox" data-chat-event-field="allDay" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} className="no-drag size-4 shrink-0 accent-accent" />
            Dia inteiro
          </label>
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Local
            <input type="text" data-chat-event-field="location" value={form.location} maxLength={EVENT_LOCATION_MAX} onChange={(event) => setForm({ ...form, location: event.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Notas
            <textarea
              data-chat-event-field="notes"
              value={form.notes}
              rows={2}
              maxLength={EVENT_NOTES_MAX}
              placeholder="Opcional"
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className={`${FIELD} min-h-14 resize-y py-1.5 placeholder:text-text-faint`}
            />
          </label>
          {full && calendars.length > 0 && (
            <div className="flex flex-col gap-1 text-12 text-text-muted">
              <label htmlFor={`chat-event-calendar-edit-${action.id}`}>Agenda</label>
              <div className="flex">
                <EventCalendarSelect id={`chat-event-calendar-edit-${action.id}`} calendars={calendars} value={calendarId} onChange={setCalendarId} />
              </div>
            </div>
          )}
          {formError && (
            <p role="alert" data-chat-event-form-error className="text-12 text-rec">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button action="chat-action-event-save" icon={Check} onClick={save}>
              Salvar
            </Button>
            <Button
              action="chat-action-event-cancel"
              variant="secondary"
              onClick={() => {
                setForm(null)
                setFormError(null)
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 pl-[22px]">
            {(open || action.status === 'dismissed') && (
              <span data-chat-event-when className="flex items-center gap-2 text-13 text-text tabular">
                <Icon icon={Clock} size={14} className="shrink-0 text-text-faint" />
                {eventWhen(view, timeZone)}
              </span>
            )}
            {view.location && (
              <span data-chat-event-location className={`flex items-center gap-2 text-13 ${open ? 'text-text' : 'text-text-muted'}`}>
                <Icon icon={MapPin} size={14} className="shrink-0 text-text-faint" />
                <span className="min-w-0 truncate">{view.location}</span>
              </span>
            )}
          </div>
          {open && full && calendars.length > 0 && (
            <div className="flex items-center gap-2 pl-[22px]">
              <label htmlFor={`chat-event-calendar-${action.id}`} className="text-12 text-text-muted">
                Agenda
              </label>
              <EventCalendarSelect id={`chat-event-calendar-${action.id}`} calendars={calendars} value={calendarId} onChange={setCalendarId} />
            </div>
          )}
          {open && accessNote && (
            <Note id="chat-event-calendar-access" icon={CalendarCheck} role="status">
              {accessNote}
            </Note>
          )}
          {action.status === 'failed' && action.error && <CardError text={action.error} />}
          {open ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button action="chat-action-event-create" icon={action.status === 'failed' ? RotateCcw : CalendarPlus} onClick={() => void create()} disabled={busy || !full || !chosen}>
                {busy ? 'Gravando…' : action.status === 'failed' ? 'Tentar de novo' : 'Pôr na agenda'}
              </Button>
              {full ? (
                <Button
                  action="chat-action-event-edit"
                  variant="secondary"
                  icon={Pencil}
                  onClick={() => {
                    setForm(formOf(shown))
                    setFailure(null)
                  }}
                >
                  Editar
                </Button>
              ) : access === 'not-determined' ? (
                <Button action="chat-action-calendar-access" variant="secondary" icon={CalendarCheck} disabled={asking} onClick={requestAccess}>
                  Pedir acesso
                </Button>
              ) : access === 'denied' ? (
                <Button action="chat-action-calendar-settings" variant="secondary" icon={Settings} onClick={() => window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')}>
                  Abrir Ajustes
                </Button>
              ) : null}
              <DismissButton actionRef={actionRef} disabled={busy} />
            </div>
          ) : (
            <Outcome action={action} />
          )}
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

/**
 * Contrato 78 (R2, quadro 04): alterar um lembrete. O texto atual e a hora antes → depois; "Salvar" aplica direto, e o
 * "Editar" abre a data, a hora e o texto no cartão. O lembrete que já disparou ou foi apagado vira `failed`.
 */
function ReminderEditCard({ action, actionRef }: { action: ChatActionReminderEdit; actionRef: ChatActionRef }) {
  const timeZone = macTimeZone()
  const [editing, setEditing] = useState(false)
  const [when, setWhen] = useState(() => localInput(action.at ?? action.currentAt))
  const [text, setText] = useState(action.text ?? action.currentText)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const proposed = action.status === 'proposed'
  const editedAt = editing && when ? new Date(when) : null
  const nextAt = editedAt && !Number.isNaN(editedAt.getTime()) ? editedAt.toISOString() : (action.at ?? action.currentAt)
  const nextText = editing ? text.replace(/\s+/g, ' ').trim() : (action.text ?? action.currentText)

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().changeReminder(actionRef, 'update', editing ? { at: nextAt, text: nextText } : {})
    setBusy(false)
    if (!result.ok) setFailure(REMINDER_CHANGE_ERRORS[result.error] ?? REMINDER_CHANGE_ERRORS['invalid'] ?? '')
  }

  const timeChanged = Date.parse(nextAt) !== Date.parse(action.currentAt)
  const textChanged = nextText !== action.currentText

  return (
    <div data-chat-action="lembrete-editar" data-chat-action-status={action.status} {...(editing ? { 'data-editing': '' } : {})} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Bell} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>Lembrete: {action.currentText}</span>
      </p>
      {proposed && (
        <div data-chat-reminder-change className="flex flex-col gap-0.5 pl-[22px]">
          <span data-chat-reminder-change-when className="flex flex-wrap items-center gap-2 text-13 tabular">
            <span className={timeChanged ? 'text-text-muted' : 'text-text'}>{reminderWhen(action.currentAt, timeZone)}</span>
            {timeChanged && (
              <>
                <Icon icon={ArrowRight} size={14} className="shrink-0 text-text-faint" />
                <span className="font-medium text-title">{reminderWhen(nextAt, timeZone)}</span>
              </>
            )}
          </span>
          {textChanged && nextText && (
            <span data-chat-reminder-change-text className="flex flex-wrap items-center gap-2 text-13">
              <span className="text-text-muted">“{action.currentText}”</span>
              <Icon icon={ArrowRight} size={14} className="shrink-0 text-text-faint" />
              <span className="font-medium text-title">“{nextText}”</span>
            </span>
          )}
        </div>
      )}
      {proposed && editing && (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Data e hora
            <input type="datetime-local" data-chat-action-when value={when} onChange={(event) => setWhen(event.target.value)} className={`${FIELD} h-8 w-56`} />
          </label>
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Texto
            <input type="text" data-chat-action-text value={text} maxLength={REMINDER_TEXT_MAX} onChange={(event) => setText(event.target.value)} className={`${FIELD} h-8`} />
          </label>
        </div>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button action="chat-action-reminder-save" icon={Check} onClick={() => void save()} disabled={busy || (editing && (!when || !nextText))}>
            Salvar
          </Button>
          {!editing && (
            <Button action="chat-action-edit" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <>
          {action.status === 'failed' && action.error && <CardError text={action.error} />}
          <div className="flex flex-wrap items-center gap-3">
            {action.status !== 'failed' && <Outcome action={action} />}
            {action.status !== 'dismissed' && <OpenTasksLink />}
          </div>
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

/** Contrato 78 (R2, quadro 05): apagar um lembrete, com o botão de perigo. O que já disparou ou sumiu vira `failed`. */
function ReminderDeleteCard({ action, actionRef }: { action: ChatActionReminderDelete; actionRef: ChatActionRef }) {
  const timeZone = macTimeZone()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const remove = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().changeReminder(actionRef, 'delete')
    setBusy(false)
    if (!result.ok) setFailure(REMINDER_CHANGE_ERRORS[result.error] ?? REMINDER_CHANGE_ERRORS['invalid'] ?? '')
  }

  return (
    <div data-chat-action="lembrete-apagar" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Trash2} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>
          Apagar o lembrete “{action.text}” de {reminderWhen(action.at, timeZone)}?
        </span>
      </p>
      {action.status === 'proposed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button action="chat-action-reminder-delete" variant="danger" icon={Trash2} onClick={() => void remove()} disabled={busy}>
            Apagar lembrete
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <>
          {action.status === 'failed' && action.error && <CardError text={action.error} />}
          <div className="flex flex-wrap items-center gap-3">
            {action.status !== 'failed' && <Outcome action={action} />}
            {action.status !== 'dismissed' && <OpenTasksLink />}
          </div>
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

/** O cartão de uma ação, pelo tipo. */
function ActionCard({ action, actionRef, choice }: { action: ChatAction; actionRef: ChatActionRef; choice: boolean }) {
  if (action.kind === 'lembrete') return <ReminderCard action={action} actionRef={actionRef} />
  if (action.kind === 'whatsapp-resposta') return <WhatsAppCard action={action} actionRef={actionRef} choice={choice} />
  if (action.kind === 'tarefa') return <TaskCard action={action} actionRef={actionRef} />
  if (action.kind === 'emails') return <EmailListCard action={action} />
  if (action.kind === 'email-resposta') return <EmailReplyCard action={action} actionRef={actionRef} />
  // Contrato 56: o cartão do lote que o Assistente moveu (`EmailBatchCard.tsx`).
  if (action.kind === 'email-lote') return <EmailBatchCard action={action} />
  // Contrato 78.
  if (action.kind === 'evento') return <EventCard action={action} actionRef={actionRef} />
  if (action.kind === 'lembrete-editar') return <ReminderEditCard action={action} actionRef={actionRef} />
  if (action.kind === 'lembrete-apagar') return <ReminderDeleteCard action={action} actionRef={actionRef} />
  return <OpenCard action={action} />
}

/**
 * Os cartões de uma resposta, na ordem; várias respostas no WhatsApp viram as escolhas "É esta conversa?". `web`: a
 * resposta usou páginas da internet (contrato 26, CA6), e cada cartão vem com o aviso.
 */
export function ActionCards({ chatId, index, actions, web = false }: { chatId: string; index: number; actions: readonly ChatAction[]; web?: boolean }) {
  const replies = actions.filter((action) => action.kind === 'whatsapp-resposta').length
  return (
    <div data-chat-actions-cards className="flex flex-col gap-2">
      {replies > 1 && <p className="text-12 text-text-muted">Não tenho certeza de qual conversa é: escolha a certa.</p>}
      {actions.map((action) => {
        const actionRef: ChatActionRef = { chatId, index, actionId: action.id }
        if (!web) return <ActionCard key={action.id} action={action} actionRef={actionRef} choice={replies > 1} />
        return (
          <div key={action.id} className="flex flex-col gap-1">
            <p data-chat-action-web className="flex items-center gap-1.5 text-12 text-text-muted">
              <Icon icon={Globe} size={14} className="shrink-0 text-text-faint" />
              Esta resposta usou páginas da internet: confira antes.
            </p>
            <ActionCard action={action} actionRef={actionRef} choice={replies > 1} />
          </div>
        )
      })}
    </div>
  )
}
