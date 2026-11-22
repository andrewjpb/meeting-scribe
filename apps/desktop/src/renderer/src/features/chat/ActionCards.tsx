// Cartões de ação do Assistente (contrato 25, CA3 e CA4): o que o Claude propôs no fim da resposta, já validado
// pelo main. Nenhum cartão faz nada sozinho: "Criar lembrete" pede ao main a tarefa "uma vez" das Automações;
// "Enviar" usa só `window.__scribeApi.whatsappSend` (o token de clique do preload do contrato 24; sem diálogo
// nativo desde o contrato 33); "Criar agendamento" abre o formulário das Automações preenchido para revisar; "Abrir" leva à
// tela. Depois do clique, o cartão mostra o estado, que fica gravado na conversa. Contrato 26: numa resposta que usou a
// internet, cada cartão vem com o aviso de conferir antes. Contrato 45: os cartões de email. A lista mostra o que o main
// leu do cache quando a resposta terminou (nada é buscado de novo ao desenhar) e o clique abre a tela Email na
// mensagem; o rascunho de resposta só sai pelo `window.__scribeApi.emailSend` (o token de clique do contrato 42), sem
// diálogo, e vira "Enviado às hh:mm".
// Contrato 78: o cartão de evento (só grava no Calendário do Mac no clique em "Pôr na agenda"; o "Editar" muda só o
// cartão) e os cartões de alterar e apagar um lembrete, cada um pelo seu canal no main.
// Contrato 76: o rascunho para o Instagram ("Criar rascunho" põe o rascunho na fila da conta e o main abre o editor em
// Redes; nada é publicado daqui).
// Contrato 117: os cartões do funil de vendas (mover, criar oportunidade, próximo passo e contato), cada um gravando pelo
// `scribe:chat-action-funil` só no clique, e o "Abrir" para o funil, uma oportunidade e um contato.
// Contrato 127: os cartões das tarefas (criar, com o "Editar" no próprio cartão; concluir; adiar), pelo
// `scribe:chat-action-tarefa` só no clique; o lembrete cria uma tarefa e o "Ver em Tarefas" abre o detalhe dela.
import {
  ArrowRight,
  Bell,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  FilePlus,
  Flag,
  Globe,
  ListChecks,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  SquareCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  emailSentText,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  eventWhen,
  FUNIL_CARD_PASSO_MAX,
  reminderTitle,
  reminderWhen,
  REMINDER_TEXT_MAX,
  sentText,
  type ChatAction,
  type ChatActionCalendar,
  type ChatActionEvent,
  type ChatActionEventFields,
  type ChatActionContatoCriar,
  type ChatActionFunil,
  type ChatActionFunilContato,
  type ChatActionInstagramDraft,
  type ChatActionOportunidadeCampos,
  type ChatActionOportunidadeCriar,
  type ChatActionOportunidadeMover,
  type ChatActionOportunidadeProximoPasso,
  type ChatActionRef,
  type ChatActionReminderDelete,
  type ChatActionReminderEdit,
  type ChatActionTarefa,
  type ChatActionTarefaAdiar,
  type ChatActionTarefaCampos,
  type ChatActionTarefaConcluir,
  type ChatActionTarefaCriar,
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
import { formatarBRL } from '@shared/funil-logic'
import { emailPath, funilPath, meetingPath, redesPath, ROUTE_PATHS, settingsPath, isSettingsTab, tarefasPath, type EmailNavigationState, type WhatsAppNavigationState } from '@shared/routes'
import { TAREFA_TITULO_MAX } from '@shared/tarefas'
import { CAPTION_MAX, captionStats } from '@shared/redes-rules'
import { WHATSAPP_SEND_TEXT_MAX } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { CONTROL_CLASS } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { useSettings } from '../../app/settingsStore'
import { useAutomations, type AutomationsTab } from '../agents/automationsStore'
import { emailTimeLabel, sendErrorText } from '../email/format'
import { chaveBusca, diaCurto, parseValor, telefoneLegivel, valorParaEdicao, type PickerItem } from '../funil/funilFormat'
import { useFunilView } from '../funil/funilStore'
import { diaCurto as tarefaDiaCurto, diaEHora } from '../tarefas/tarefasFormat'
import { SearchPicker } from '../funil/SearchPicker'
import { MENU_ITEM, useInlineMenu } from '../meetings/menu'
import { InstagramGlyph } from '../redes/InstagramGlyph'
import { scheduleWhen } from '../redes/redesFormat'
import { useRedes } from '../redes/redesStore'
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
          {action.status === 'done' && <OpenTasksLink tarefaId={action.tarefaId ?? null} />}
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
    <div data-chat-action="agendamento" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={ListChecks} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span>Agendamento · {action.name}</span>
      </p>
      <p data-chat-action-schedule className="text-12 text-text-muted">
        {describeSchedule(action.schedule, timeZone)} · agente {action.agentName}
      </p>
      <p className="text-13 text-text select-text">{action.message}</p>
      {action.status === 'proposed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button action="chat-action-task-create" icon={ListChecks} onClick={open}>
            Criar agendamento
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
        return
      // Contrato 117 (R20).
      case 'funil':
        void navigate(funilPath('oportunidades'))
        return
      case 'oportunidade':
        void navigate(action.target ? funilPath('oportunidades', action.target) : funilPath('oportunidades'))
        return
      case 'contato':
        void navigate(action.target ? funilPath('contatos', action.target) : funilPath('contatos'))
        return
      // Contrato 127 (R30).
      case 'tarefas':
        void navigate(tarefasPath())
        return
      case 'tarefa':
        void navigate(action.target ? tarefasPath(action.target) : tarefasPath())
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

/** Contrato 127 (R13): "Ver em Tarefas", no detalhe da tarefa do lembrete quando o cartão a tem; senão, a lista. */
function OpenTasksLink({ tarefaId }: { tarefaId: string | null }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      data-action="chat-action-open-tasks"
      onClick={() => void navigate(tarefaId ? tarefasPath(tarefaId) : tarefasPath())}
      className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title"
    >
      Ver em Tarefas
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
            {action.status !== 'dismissed' && <OpenTasksLink tarefaId={action.status === 'done' ? action.taskId : null} />}
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
            {action.status !== 'dismissed' && <OpenTasksLink tarefaId={null} />}
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

const INSTAGRAM_DRAFT_ERRORS: Record<string, string> = {
  past: 'Essa data já passou. Escolha outra ou deixe sem data.',
  done: 'Este cartão já foi usado.',
  missing: 'A conta do Instagram não está mais conectada.',
  invalid: 'Confira a legenda: até 2.200 caracteres, 30 hashtags e 20 @.',
}
const THOUSANDS = new Intl.NumberFormat('pt-BR')

/**
 * Contrato 76 (R9, artboard 09): o rascunho para o Instagram. A legenda proposta (até 6 linhas, com "ver mais"), o contador
 * "187/2.200 · 4 # · 1 @" e a data planejada, quando há. "Criar rascunho" põe o rascunho, sem mídia, na fila da conta e o
 * main abre o editor em Redes › Publicações; "Editar" muda a legenda e a data só no cartão. Nada é publicado daqui.
 */
function InstagramDraftCard({ action, actionRef }: { action: ChatActionInstagramDraft; actionRef: ChatActionRef }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(action.caption)
  const [when, setWhen] = useState(() => (action.at ? localInput(action.at) : ''))
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)
  const proposed = action.status === 'proposed'
  const text = editing ? caption : action.caption
  const stats = captionStats(text)
  const editedAt = when ? new Date(when) : null
  // A data do "Editar" que não se lê não vira "sem data" em silêncio: o cartão avisa e não cria.
  const badDate = editing && editedAt !== null && Number.isNaN(editedAt.getTime())
  const at = editing ? (editedAt && !badDate ? editedAt.toISOString() : null) : action.at
  const tooLong = stats.problems.length > 0

  // "ver mais" só quando a legenda passa das 6 linhas.
  useLayoutEffect(() => {
    const element = captionRef.current
    if (!element || expanded) return
    setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [text, expanded, editing])

  const create = async (): Promise<void> => {
    if (busy || tooLong || badDate || !text.trim()) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().createInstagramDraft(actionRef, editing ? { caption, at } : {})
    setBusy(false)
    if (!result.ok) setFailure(INSTAGRAM_DRAFT_ERRORS[result.error] ?? INSTAGRAM_DRAFT_ERRORS['invalid'] ?? '')
  }
  const openDraft = (): void => {
    if (!action.publicationId) return
    useRedes.getState().openEditor({ accountId: action.accountId, id: action.publicationId })
    void navigate(redesPath(action.accountId, 'publicacoes'))
  }

  return (
    <div data-chat-action="instagram-rascunho" data-chat-action-status={action.status} {...(editing ? { 'data-editing': '' } : {})} className={CARD}>
      <p className="flex items-center gap-2 text-13 font-medium text-title">
        <InstagramGlyph size={14} className="shrink-0 text-text-muted" />
        <span>Rascunho para o Instagram</span>
        <span data-chat-instagram-account className="min-w-0 truncate font-normal text-text-muted">
          · @{action.username}
        </span>
      </p>
      {proposed && editing ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Legenda
            <textarea
              data-chat-instagram-field="caption"
              value={caption}
              rows={6}
              onChange={(event) => setCaption(event.target.value)}
              className={`${FIELD} min-h-24 resize-y py-1.5 leading-5`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12 text-text-muted">
            Data planejada
            <input type="datetime-local" data-chat-instagram-field="at" value={when} onChange={(event) => setWhen(event.target.value)} className={`${FIELD} h-8 w-56`} />
          </label>
          {badDate && (
            <p role="alert" data-chat-instagram-date-error className="text-12 text-rec">
              Não entendi essa data. Corrija ou apague para criar sem data.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p
            ref={captionRef}
            data-chat-instagram-caption
            className={`border-l-[3px] border-line-strong bg-bg-sunken px-3 py-2.5 text-13 leading-5 whitespace-pre-wrap select-text ${proposed ? 'text-text' : 'text-text-muted'} ${expanded ? '' : 'line-clamp-6'}`}
          >
            {action.caption}
          </p>
          {(clamped || expanded) && (
            <button type="button" data-action="chat-action-instagram-more" onClick={() => setExpanded((value) => !value)} className="self-start text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title">
              {expanded ? 'ver menos' : 'ver mais'}
            </button>
          )}
        </div>
      )}
      {proposed && (
        <p data-chat-instagram-count className={`text-12 tabular ${tooLong ? 'text-rec' : 'text-text-muted'}`}>
          {THOUSANDS.format(stats.chars)}/{THOUSANDS.format(CAPTION_MAX)} · {stats.hashtags} # · {stats.mentions} @{tooLong ? ` · ${stats.problems.join('; ')}` : ''}
        </p>
      )}
      {proposed && !editing && (
        <p data-chat-instagram-when className="text-12 text-text-muted">
          {at ? `Sem mídia: as imagens você escolhe no editor. Data planejada: ${scheduleWhen(at)} (agendar é no editor).` : 'Sem mídia e sem data: as imagens e o horário você escolhe no editor.'}
        </p>
      )}
      {proposed ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button action="chat-action-instagram-create" icon={FilePlus} onClick={() => void create()} disabled={busy || tooLong || badDate || !text.trim()}>
              {busy ? 'Criando…' : 'Criar rascunho'}
            </Button>
            {editing ? (
              <Button
                action="chat-action-instagram-cancel"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setCaption(action.caption)
                  setWhen(action.at ? localInput(action.at) : '')
                  setEditing(false)
                  setFailure(null)
                }}
              >
                Cancelar
              </Button>
            ) : (
              <Button action="chat-action-edit" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
            <DismissButton actionRef={actionRef} disabled={busy} />
          </div>
          <p className="text-12 text-text-faint">Abre o rascunho em Redes › Publicações. Nada é publicado daqui.</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Outcome action={action} />
          {action.status === 'done' && action.publicationId && (
            <button type="button" data-action="chat-action-instagram-open" onClick={openDraft} className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title">
              Abrir em Redes
            </button>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}

// --- Contrato 117: o funil de vendas ----------------------------------------------------------------------------

const FUNIL_CARD_ERRORS: Record<string, string> = {
  done: 'Este cartão já foi usado.',
  missing: 'Esta conversa não existe mais.',
  invalid: 'Não foi possível concluir. Tente de novo.',
}
/** Só no cartão de criar oportunidade o `invalid` vem dos campos editados. */
const FUNIL_CRIAR_INVALID = 'Confira o título, a etapa e o valor.'
const funilFailure = (error: string, invalid?: string): string => (error === 'invalid' && invalid ? invalid : (FUNIL_CARD_ERRORS[error] ?? FUNIL_CARD_ERRORS['invalid'] ?? ''))
const FUNIL_LABEL = 'text-13 text-text-muted'
const FUNIL_CONTROL = `${CONTROL_CLASS} w-full min-w-0 px-2.5 select-text`

/** "28/02" de `AAAA-MM-DD` (o ano só quando não é o deste ano). */
function funilDia(dia: string): string {
  return dia.slice(0, 4) === String(new Date().getFullYear()) ? diaCurto(dia) : `${diaCurto(dia)}/${dia.slice(0, 4)}`
}

/** O link do resultado (`done`): a oportunidade ou o contato no funil. */
function FunilOpenLink({ to, children }: { to: string; children: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" data-action="chat-action-funil-open" data-chat-funil-open={to} onClick={() => void navigate(to)} className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title">
      {children}
    </button>
  )
}

/** O que vem depois do clique: o resultado com o link, ou o erro (o cartão `failed`). */
function FunilOutcome({ action, link }: { action: ChatActionFunil; link: { to: string; label: string } | null }) {
  if (action.status === 'failed') return action.error ? <CardError text={action.error} /> : null
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Outcome action={action} />
      {action.status === 'done' && link && <FunilOpenLink to={link.to}>{link.label}</FunilOpenLink>}
    </div>
  )
}

/** O erro do clique que não chegou a gravar (cartão já usado, campo fora do formato). */
function FunilFailure({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" data-chat-action-failure className="text-12 text-rec">
      {text}
    </p>
  )
}

/** Clique num cartão do funil, com o erro do canal no próprio cartão. */
function useFunilClick(actionRef: ChatActionRef, invalid?: string): { busy: boolean; failure: string | null; setFailure: (text: string | null) => void; run: (campos?: ChatActionOportunidadeCampos) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = async (campos?: ChatActionOportunidadeCampos): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().funilAction(actionRef, campos)
    setBusy(false)
    if (!result.ok) setFailure(funilFailure(result.error, invalid))
  }
  return { busy, failure, setFailure, run }
}

/** Contrato 117 (R43, artboard 10): "Mover <título> de <etapa> para <etapa>", com a nota; "Mover" grava pelo funil. */
function OportunidadeMoverCard({ action, actionRef }: { action: ChatActionOportunidadeMover; actionRef: ChatActionRef }) {
  const { busy, failure, run } = useFunilClick(actionRef)
  const proposed = action.status === 'proposed'
  return (
    <div data-chat-action="oportunidade-mover" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={ArrowRight} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        {action.titulo && action.de ? (
          <span data-chat-action-title>
            Mover <strong className="font-bold">{action.titulo}</strong> de {action.de} para {action.para}
          </span>
        ) : (
          <span data-chat-action-title>Mover oportunidade para {action.para}</span>
        )}
      </p>
      {action.nota && (
        <p data-chat-funil-nota className="pl-[22px] text-13 text-text-muted">
          Nota: {action.nota}
        </p>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-funil-mover" icon={ArrowRight} onClick={() => void run()} disabled={busy}>
            {busy ? 'Movendo…' : 'Mover'}
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <FunilOutcome action={action} link={{ to: funilPath('oportunidades', action.oportunidadeId), label: 'Abrir a oportunidade' }} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/** O formulário do cartão de criar oportunidade (o valor como a pessoa digita). */
interface CriarForm {
  titulo: string
  empresa: PickerItem | null
  etapaId: string
  valor: string
  contatos: PickerItem[]
  previsao: string
  passo: string
  passoData: string
}

/**
 * Contrato 117 (R43, artboard 10): criar uma oportunidade, com os campos editáveis antes do clique (como o `EventCard`):
 * Título, Etapa, Empresa e Contatos pelo `SearchPicker` (D21), Valor em reais, Previsão e Próximo passo. "Criar" manda o
 * que mudou; o main confere de novo e grava pelo serviço do funil.
 */
function OportunidadeCriarCard({ action, actionRef }: { action: ChatActionOportunidadeCriar; actionRef: ChatActionRef }) {
  const ids = useId()
  const view = useFunilView()
  const { busy, failure, setFailure, run } = useFunilClick(actionRef, FUNIL_CRIAR_INVALID)
  const empresaInicial = (): PickerItem | null => {
    if (!action.empresa) return null
    const chave = chaveBusca(action.empresa)
    const achada = view?.state.empresas.find((item) => chaveBusca(item.nome) === chave)
    return achada ? { id: achada.id, nome: achada.nome } : { id: 'nova', nome: action.empresa, novo: true }
  }
  const contatoItem = (contato: ChatActionFunilContato, index: number): PickerItem =>
    contato.contatoId ? { id: contato.contatoId, nome: contato.nome, detalhe: contato.email ?? undefined } : { id: `novo-${index}`, nome: contato.nome, detalhe: contato.email ?? undefined, novo: true }
  const [form, setForm] = useState<CriarForm>(() => ({
    titulo: action.titulo,
    empresa: empresaInicial(),
    etapaId: action.etapaId,
    valor: valorParaEdicao(action.valor),
    contatos: action.contatos.map(contatoItem),
    previsao: action.previsao ?? '',
    passo: action.proximoPasso?.texto ?? '',
    passoData: action.proximoPasso?.data ?? '',
  }))
  const [edited, setEdited] = useState(false)
  const change = (patch: Partial<CriarForm>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setEdited(true)
  }
  const proposed = action.status === 'proposed'
  const empresas: PickerItem[] = view?.state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] })) ?? []
  const pessoas: PickerItem[] = view?.state.contatos.filter((contato) => !contato.arquivado).map((contato) => ({ id: contato.id, nome: contato.nome, detalhe: contato.emails[0] })) ?? []

  const create = async (): Promise<void> => {
    if (!edited) return run()
    const valor = form.valor.trim() ? parseValor(form.valor) : null
    if (form.valor.trim() && valor === null) {
      setFailure('Valor fora do formato. Use, por exemplo, 1.234,56.')
      return
    }
    // Os contatos novos do cartão voltam como vieram; os escolhidos na lista, com o e-mail do funil.
    const contatos: ChatActionFunilContato[] = form.contatos.map((item) => {
      const original = item.novo ? action.contatos[Number(item.id.slice('novo-'.length))] : undefined
      if (original) return original
      const contato = view?.state.contatos.find((known) => known.id === item.id)
      return { nome: item.nome, email: contato?.emails[0] ?? null, contatoId: item.id }
    })
    await run({
      titulo: form.titulo,
      empresa: form.empresa?.nome ?? null,
      etapaId: form.etapaId,
      valor,
      contatos,
      previsao: form.previsao || null,
      proximoPasso: form.passo.trim() ? { texto: form.passo, data: form.passoData || null } : null,
    })
  }

  const etapaNome = action.etapas.find((etapa) => etapa.id === action.etapaId)?.nome ?? ''
  return (
    <div data-chat-action="oportunidade-criar" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Plus} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>Criar oportunidade</span>
      </p>
      {proposed ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pl-[22px]">
          <label htmlFor={`${ids}-titulo`} className={FUNIL_LABEL}>
            Título
          </label>
          <input id={`${ids}-titulo`} type="text" data-chat-funil-field="titulo" value={form.titulo} maxLength={200} onChange={(event) => change({ titulo: event.target.value })} className={FUNIL_CONTROL} />
          <label htmlFor={`${ids}-etapa`} className={FUNIL_LABEL}>
            Etapa
          </label>
          <select id={`${ids}-etapa`} data-chat-funil-field="etapa" value={form.etapaId} onChange={(event) => change({ etapaId: event.target.value })} className={FUNIL_CONTROL}>
            {action.etapas.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.nome}
              </option>
            ))}
          </select>
          <label htmlFor={`${ids}-empresa`} className={FUNIL_LABEL}>
            Empresa
          </label>
          <SearchPicker
            nome="chat-empresa"
            id={`${ids}-empresa`}
            label="Empresa"
            placeholder="Escolher ou criar…"
            itens={empresas}
            valor={form.empresa}
            onChange={(empresa) => change({ empresa })}
            onCriar={(nome) => change({ empresa: { id: 'nova', nome, novo: true } })}
          />
          <label htmlFor={`${ids}-valor`} className={FUNIL_LABEL}>
            Valor (R$)
          </label>
          <input id={`${ids}-valor`} type="text" data-chat-funil-field="valor" value={form.valor} maxLength={20} onChange={(event) => change({ valor: event.target.value })} className={FUNIL_CONTROL} />
          <label htmlFor={`${ids}-contatos`} className={FUNIL_LABEL}>
            Contatos
          </label>
          <SearchPicker multiplo nome="chat-contatos" id={`${ids}-contatos`} label="Contatos" placeholder="Buscar" itens={pessoas} valor={form.contatos} onChange={(contatos) => change({ contatos })} />
          <label htmlFor={`${ids}-previsao`} className={FUNIL_LABEL}>
            Previsão
          </label>
          <input id={`${ids}-previsao`} type="date" data-chat-funil-field="previsao" value={form.previsao} onChange={(event) => change({ previsao: event.target.value })} className={FUNIL_CONTROL} />
          <label htmlFor={`${ids}-passo`} className={FUNIL_LABEL}>
            Próximo passo
          </label>
          <div className="col-span-3 flex gap-2">
            <input id={`${ids}-passo`} type="text" data-chat-funil-field="passo" value={form.passo} maxLength={FUNIL_CARD_PASSO_MAX} onChange={(event) => change({ passo: event.target.value })} className={`${FUNIL_CONTROL} flex-1`} />
            <input type="date" aria-label="Data do próximo passo" data-chat-funil-field="passoData" value={form.passoData} onChange={(event) => change({ passoData: event.target.value })} className={`${CONTROL_CLASS} w-40 shrink-0 px-2.5 select-text`} />
          </div>
        </div>
      ) : (
        <p data-chat-funil-resumo className="pl-[22px] text-13 text-text-muted">
          {[action.titulo, etapaNome, action.empresa, action.valor === null ? null : formatarBRL(action.valor)].filter(Boolean).join(' · ')}
        </p>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-funil-criar" icon={Plus} onClick={() => void create()} disabled={busy || !form.titulo.trim() || !form.etapaId}>
            {busy ? 'Criando…' : 'Criar'}
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <FunilOutcome action={action} link={action.oportunidadeId ? { to: funilPath('oportunidades', action.oportunidadeId), label: 'Abrir a oportunidade' } : null} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/** Contrato 117 (R43): "Próximo passo de <título>"; "Salvar" grava pelo funil. Contrato 127 (R17): cria a tarefa. */
function ProximoPassoCard({ action, actionRef }: { action: ChatActionOportunidadeProximoPasso; actionRef: ChatActionRef }) {
  const { busy, failure, run } = useFunilClick(actionRef)
  const proposed = action.status === 'proposed'
  const passo = (texto: string, data: string | null): string => (data ? `${texto} · ${funilDia(data)}` : texto)
  return (
    <div data-chat-action="oportunidade-proximo-passo" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={Flag} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        {action.titulo ? (
          <span data-chat-action-title>
            Próximo passo de <strong className="font-bold">{action.titulo}</strong>
          </span>
        ) : (
          <span data-chat-action-title>Próximo passo</span>
        )}
      </p>
      {/* Contrato 127 (R17): o passo vira uma tarefa; o de antes não aparece mais. */}
      {action.titulo && (
        <span data-chat-funil-passo className={`pl-[22px] text-13 ${proposed ? 'font-medium text-title' : 'text-text-muted'}`}>
          {passo(action.texto, action.data)}
        </span>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-funil-passo" icon={Check} onClick={() => void run()} disabled={busy}>
            Salvar
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <FunilOutcome action={action} link={{ to: funilPath('oportunidades', action.oportunidadeId), label: 'Abrir a oportunidade' }} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/**
 * Contrato 117 (R43): criar um contato no funil (nome, e-mail, telefone, empresa, cargo). Com o e-mail ou o telefone de um
 * contato que já existe, "Completa o contato <nome>": o clique junta os dados nele (R4) em vez de repetir.
 */
function ContatoCriarCard({ action, actionRef }: { action: ChatActionContatoCriar; actionRef: ChatActionRef }) {
  const { busy, failure, run } = useFunilClick(actionRef)
  const proposed = action.status === 'proposed'
  const linhas = [action.email, action.telefone ? telefoneLegivel(action.telefone) : null, [action.empresa, action.cargo].filter(Boolean).join(' · ') || null].filter((item): item is string => Boolean(item))
  return (
    <div data-chat-action="contato-criar" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-13 font-medium text-title">
        <Icon icon={UserPlus} size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>
          Criar contato <strong className="font-bold">{action.nome}</strong>
        </span>
      </p>
      {linhas.length > 0 && (
        <div data-chat-funil-contato className="flex flex-col gap-0.5 pl-[22px]">
          {linhas.map((linha) => (
            <span key={linha} className={`text-13 ${proposed ? 'text-text' : 'text-text-muted'}`}>
              {linha}
            </span>
          ))}
        </div>
      )}
      {proposed && action.existenteId && action.existenteNome && (
        <p data-chat-funil-existente className="pl-[22px] text-12 text-text-muted">
          Completa o contato {action.existenteNome}
        </p>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-funil-contato" icon={UserPlus} onClick={() => void run()} disabled={busy}>
            {busy ? 'Criando…' : 'Criar'}
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <FunilOutcome action={action} link={action.contatoId ? { to: funilPath('contatos', action.contatoId), label: 'Abrir o contato' } : null} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

// --- Contrato 127: as tarefas --------------------------------------------------------------------------------------

const TAREFA_CARD_ERRORS: Record<string, string> = {
  done: 'Este cartão já foi usado.',
  missing: 'Esta conversa não existe mais.',
  past: 'Esse lembrete já passou. Escolha outro horário.',
  full: 'A lista chegou ao limite de tarefas.',
  invalid: 'Não foi possível concluir. Tente de novo.',
}
/** Só no cartão de criar tarefa o `invalid` vem dos campos editados. */
const TAREFA_CRIAR_INVALID = 'Confira o título, o prazo e o lembrete.'

/** "sexta, 27/11/2026" de `AAAA-MM-DD` (o dia da semana sem o "-feira"). */
function prazoLongo(dia: string): string {
  const [ano = 1970, mes = 1, d = 1] = dia.split('-').map(Number)
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, mes - 1, d))).replace(/-feira$/, '')
  return `${semana}, ${tarefaDiaCurto(dia)}/${ano}`
}

/** Clique num cartão das tarefas, com o erro do canal no próprio cartão. */
function useTarefaClick(actionRef: ChatActionRef, invalid?: string): { busy: boolean; failure: string | null; run: (campos?: ChatActionTarefaCampos) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = async (campos?: ChatActionTarefaCampos): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await useChat.getState().tarefaAction(actionRef, campos)
    setBusy(false)
    if (!result.ok) setFailure(result.error === 'invalid' && invalid ? invalid : (TAREFA_CARD_ERRORS[result.error] ?? TAREFA_CARD_ERRORS['invalid'] ?? ''))
  }
  return { busy, failure, run }
}

/** O que vem depois do clique: o resultado com "Abrir a tarefa", ou o erro (o cartão `failed`). */
function TarefaOutcome({ action, tarefaId }: { action: ChatActionTarefa; tarefaId: string | null }) {
  const navigate = useNavigate()
  if (action.status === 'failed') return action.error ? <CardError text={action.error} /> : null
  return (
    <div className="flex flex-wrap items-center gap-3 pl-[22px]">
      <Outcome action={action} />
      {action.status === 'done' && tarefaId && (
        <button type="button" data-action="chat-action-tarefa-open" onClick={() => void navigate(tarefasPath(tarefaId))} className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title">
          Abrir a tarefa
        </button>
      )}
    </div>
  )
}

/** Um par rótulo/valor do cartão de criar tarefa (o rótulo em 13 px, cinza; o valor em 15 px). */
function TarefaPar({ campo, rotulo, children }: { campo: string; rotulo: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-13 text-text-muted">{rotulo}</dt>
      <dd data-chat-tarefa-valor={campo} className="min-w-0 text-15 text-text">
        {children}
      </dd>
    </>
  )
}

/** O formulário do "Editar" do cartão de criar tarefa (o lembrete como no `<input type="datetime-local">`). */
interface TarefaForm {
  titulo: string
  prazo: string
  lembrete: string
  oportunidade: PickerItem | null
  contato: PickerItem | null
}

/**
 * Contrato 127 (R28, artboard 13): "Criar tarefa <título>", com os pares Prazo, Lembrete, Oportunidade e Contato. Com a
 * oportunidade (ou o contato) ambígua, o `SearchPicker` pede a escolha no lugar do valor. "Editar" troca os valores por
 * campos no próprio cartão; "Criar" manda o que mudou e o main confere de novo (as regras do 121).
 */
function TarefaCriarCard({ action, actionRef }: { action: ChatActionTarefaCriar; actionRef: ChatActionRef }) {
  const ids = useId()
  const view = useFunilView()
  const config = useSettings((state) => state.settings.tarefas)
  const timeZone = macTimeZone()
  const { busy, failure, run } = useTarefaClick(actionRef, TAREFA_CRIAR_INVALID)
  const lembreteInicial = (): string => {
    if (action.lembreteEm === null) return ''
    const { dia, hora } = diaEHora(action.lembreteEm, timeZone)
    return `${dia}T${hora}`
  }
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<TarefaForm>(() => ({
    titulo: action.titulo,
    prazo: action.prazo ?? '',
    lembrete: lembreteInicial(),
    oportunidade: action.oportunidade ? { id: action.oportunidade.id, nome: action.oportunidade.titulo } : null,
    contato: action.contato ? { id: action.contato.id, nome: action.contato.nome } : null,
  }))
  /** A escolha no `SearchPicker` do campo ambíguo (sem "Editar"). */
  const [escolhido, setEscolhido] = useState<PickerItem | null>(null)
  /** O contato escolhido quando a oportunidade e o contato ficaram os dois por escolher. */
  const [escolhidoContato, setEscolhidoContato] = useState<PickerItem | null>(null)
  const change = (patch: Partial<TarefaForm>): void => setForm((current) => ({ ...current, ...patch }))
  const proposed = action.status === 'proposed'
  const estado = view?.state
  const abertas = estado ? estado.oportunidades.filter((item) => !item.arquivado && estado.etapas.find((etapa) => etapa.id === item.etapaId)?.tipo === 'aberta') : []
  const oportunidades: PickerItem[] = abertas.map((item) => ({ id: item.id, nome: item.titulo, detalhe: estado?.etapas.find((etapa) => etapa.id === item.etapaId)?.nome }))
  const contatos: PickerItem[] = estado?.contatos.filter((item) => !item.arquivado).map((item) => ({ id: item.id, nome: item.nome, detalhe: item.emails[0] })) ?? []
  const ambiguo = proposed && !editing ? action.ambiguo : null
  const contatoAEscolher = ambiguo ? (action.ambiguoContato ?? null) : null

  const oportunidadeTexto = (): string => {
    if (!action.oportunidade) return 'Nenhuma'
    const oportunidade = estado?.oportunidades.find((item) => item.id === action.oportunidade?.id)
    const etapa = oportunidade ? estado?.etapas.find((item) => item.id === oportunidade.etapaId)?.nome : undefined
    return etapa ? `${action.oportunidade.titulo} · ${etapa}` : action.oportunidade.titulo
  }
  const contatoTexto = (): string => {
    if (action.contato) return action.contato.nome
    // R9: sem contato, a tarefa ganha os contatos da oportunidade.
    const daOportunidade = action.oportunidade ? estado?.oportunidades.find((item) => item.id === action.oportunidade?.id)?.contatoIds[0] : undefined
    const nome = daOportunidade ? estado?.contatos.find((item) => item.id === daOportunidade)?.nome : undefined
    return nome ? `${nome} (da oportunidade)` : 'Nenhum'
  }
  const lembreteTexto = (): string => {
    if (action.lembreteEm !== null) {
      const { dia, hora } = diaEHora(action.lembreteEm, timeZone)
      return `${prazoLongo(dia)}, às ${hora}`
    }
    return action.prazo && config.lembrarNoPrazo ? `no prazo, às ${config.horaLembrete}` : 'Sem lembrete'
  }

  const create = async (): Promise<void> => {
    if (ambiguo) {
      if (!escolhido || (contatoAEscolher && !escolhidoContato)) return
      await run(ambiguo.campo === 'oportunidade' ? { oportunidadeId: escolhido.id, ...(escolhidoContato ? { contatoId: escolhidoContato.id } : {}) } : { contatoId: escolhido.id })
      return
    }
    if (!editing) return run()
    const lembrete = form.lembrete ? new Date(form.lembrete).getTime() : null
    await run({
      titulo: form.titulo,
      prazo: form.prazo || null,
      lembreteEm: lembrete !== null && Number.isFinite(lembrete) ? lembrete : null,
      oportunidadeId: form.oportunidade?.id ?? null,
      contatoId: form.contato?.id ?? null,
    })
  }

  return (
    <div data-chat-action="tarefa-criar" data-chat-action-status={action.status} {...(editing ? { 'data-editing': '' } : {})} className={CARD}>
      <p className="flex items-start gap-2 text-15 font-medium text-title">
        <Icon icon={SquareCheck} size={16} className="mt-0.5 shrink-0 text-text-muted" />
        <span data-chat-action-title>
          Criar tarefa <strong className="font-bold">{action.titulo}</strong>
        </span>
      </p>
      {proposed && editing ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pl-[22px]">
          <label htmlFor={`${ids}-titulo`} className={FUNIL_LABEL}>
            Título
          </label>
          <input id={`${ids}-titulo`} type="text" data-chat-tarefa-field="titulo" value={form.titulo} maxLength={TAREFA_TITULO_MAX} onChange={(event) => change({ titulo: event.target.value })} className={FUNIL_CONTROL} />
          <label htmlFor={`${ids}-prazo`} className={FUNIL_LABEL}>
            Prazo
          </label>
          <input id={`${ids}-prazo`} type="date" data-chat-tarefa-field="prazo" value={form.prazo} onChange={(event) => change({ prazo: event.target.value })} className={`${FUNIL_CONTROL} max-w-48`} />
          <label htmlFor={`${ids}-lembrete`} className={FUNIL_LABEL}>
            Lembrete
          </label>
          <input id={`${ids}-lembrete`} type="datetime-local" data-chat-tarefa-field="lembrete" value={form.lembrete} onChange={(event) => change({ lembrete: event.target.value })} className={`${FUNIL_CONTROL} max-w-56`} />
          <label htmlFor={`${ids}-oportunidade`} className={FUNIL_LABEL}>
            Oportunidade
          </label>
          <SearchPicker nome="chat-tarefa-oportunidade" id={`${ids}-oportunidade`} label="Oportunidade" placeholder="Buscar" itens={oportunidades} valor={form.oportunidade} onChange={(oportunidade) => change({ oportunidade })} />
          <label htmlFor={`${ids}-contato`} className={FUNIL_LABEL}>
            Contato
          </label>
          <SearchPicker nome="chat-tarefa-contato" id={`${ids}-contato`} label="Contato" placeholder="Buscar" itens={contatos} valor={form.contato} onChange={(contato) => change({ contato })} />
        </div>
      ) : (
        <dl data-chat-tarefa-pares className="grid grid-cols-[minmax(120px,auto)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5 pl-[22px]">
          <TarefaPar campo="prazo" rotulo="Prazo">
            {action.prazo ? prazoLongo(action.prazo) : 'Sem prazo'}
          </TarefaPar>
          <TarefaPar campo="lembrete" rotulo="Lembrete">
            {lembreteTexto()}
          </TarefaPar>
          <TarefaPar campo="oportunidade" rotulo="Oportunidade">
            {ambiguo?.campo === 'oportunidade' ? (
              <span data-chat-tarefa-ambiguo="oportunidade" className="flex flex-col gap-1">
                <span className="text-12 text-text-muted">Escolha a oportunidade de «{ambiguo.texto}»</span>
                <SearchPicker nome="chat-tarefa-ambiguo" label="Oportunidade" placeholder="Buscar" itens={oportunidades} valor={escolhido} onChange={setEscolhido} />
              </span>
            ) : (
              oportunidadeTexto()
            )}
          </TarefaPar>
          <TarefaPar campo="contato" rotulo="Contato">
            {ambiguo?.campo === 'contato' ? (
              <span data-chat-tarefa-ambiguo="contato" className="flex flex-col gap-1">
                <span className="text-12 text-text-muted">Escolha o contato «{ambiguo.texto}»</span>
                <SearchPicker nome="chat-tarefa-ambiguo" label="Contato" placeholder="Buscar" itens={contatos} valor={escolhido} onChange={setEscolhido} />
              </span>
            ) : contatoAEscolher ? (
              <span data-chat-tarefa-ambiguo="contato" className="flex flex-col gap-1">
                <span className="text-12 text-text-muted">Escolha o contato «{contatoAEscolher}»</span>
                <SearchPicker nome="chat-tarefa-ambiguo-contato" label="Contato" placeholder="Buscar" itens={contatos} valor={escolhidoContato} onChange={setEscolhidoContato} />
              </span>
            ) : (
              contatoTexto()
            )}
          </TarefaPar>
        </dl>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pt-1 pl-[22px]">
          <Button action="chat-action-tarefa-criar" icon={Plus} onClick={() => void create()} disabled={busy || (editing && !form.titulo.trim()) || (ambiguo !== null && (!escolhido || (contatoAEscolher !== null && !escolhidoContato)))}>
            {busy ? 'Criando…' : 'Criar'}
          </Button>
          {!editing && (
            <Button action="tarefa-criar-editar" variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <TarefaOutcome action={action} tarefaId={action.tarefaId} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/** Contrato 127 (R28): "Concluir <título>"; "Concluir" marca a tarefa como feita. */
function TarefaConcluirCard({ action, actionRef }: { action: ChatActionTarefaConcluir; actionRef: ChatActionRef }) {
  const { busy, failure, run } = useTarefaClick(actionRef)
  return (
    <div data-chat-action="tarefa-concluir" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-15 font-medium text-title">
        <Icon icon={CircleCheck} size={16} className="mt-0.5 shrink-0 text-text-muted" />
        {action.titulo ? (
          <span data-chat-action-title>
            Concluir <strong className="font-bold">{action.titulo}</strong>
          </span>
        ) : (
          <span data-chat-action-title>Concluir tarefa</span>
        )}
      </p>
      {action.titulo && (
        <span data-chat-tarefa-mudanca className="flex flex-wrap items-center gap-2 pl-[22px] text-13">
          <span className="text-text-muted">Aberta</span>
          <Icon icon={ArrowRight} size={14} className="shrink-0 text-text-faint" />
          <span className={action.status === 'proposed' ? 'font-medium text-title' : 'text-text-muted'}>Feita</span>
        </span>
      )}
      {action.status === 'proposed' ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-tarefa-concluir" icon={Check} onClick={() => void run()} disabled={busy}>
            Concluir
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <TarefaOutcome action={action} tarefaId={action.status === 'done' ? action.tarefaId : null} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/** Contrato 127 (R28): "Adiar <título>", com o prazo de antes → o novo; "Adiar" muda o prazo. */
function TarefaAdiarCard({ action, actionRef }: { action: ChatActionTarefaAdiar; actionRef: ChatActionRef }) {
  const { busy, failure, run } = useTarefaClick(actionRef)
  const proposed = action.status === 'proposed'
  return (
    <div data-chat-action="tarefa-adiar" data-chat-action-status={action.status} className={CARD}>
      <p className="flex items-start gap-2 text-15 font-medium text-title">
        <Icon icon={Calendar} size={16} className="mt-0.5 shrink-0 text-text-muted" />
        {action.titulo ? (
          <span data-chat-action-title>
            Adiar <strong className="font-bold">{action.titulo}</strong>
          </span>
        ) : (
          <span data-chat-action-title>Adiar tarefa</span>
        )}
      </p>
      {action.titulo && (
        <span data-chat-tarefa-mudanca className="flex flex-wrap items-center gap-2 pl-[22px] text-13 tabular">
          <span className="text-text-muted">{action.prazoAntes ? prazoLongo(action.prazoAntes) : 'Sem prazo'}</span>
          <Icon icon={ArrowRight} size={14} className="shrink-0 text-text-faint" />
          <span className={proposed ? 'font-medium text-title' : 'text-text-muted'}>{prazoLongo(action.prazo)}</span>
        </span>
      )}
      {proposed ? (
        <div className="flex flex-wrap items-center gap-2 pl-[22px]">
          <Button action="chat-action-tarefa-adiar" icon={Calendar} onClick={() => void run()} disabled={busy}>
            Adiar
          </Button>
          <DismissButton actionRef={actionRef} disabled={busy} />
        </div>
      ) : (
        <TarefaOutcome action={action} tarefaId={action.status === 'done' ? action.tarefaId : null} />
      )}
      <FunilFailure text={failure} />
    </div>
  )
}

/** O cartão de uma ação, pelo tipo. */
function ActionCard({ action, actionRef, choice }: { action: ChatAction; actionRef: ChatActionRef; choice: boolean }) {
  if (action.kind === 'lembrete') return <ReminderCard action={action} actionRef={actionRef} />
  if (action.kind === 'whatsapp-resposta') return <WhatsAppCard action={action} actionRef={actionRef} choice={choice} />
  if (action.kind === 'agendamento') return <TaskCard action={action} actionRef={actionRef} />
  if (action.kind === 'emails') return <EmailListCard action={action} />
  if (action.kind === 'email-resposta') return <EmailReplyCard action={action} actionRef={actionRef} />
  // Contrato 56: o cartão do lote que o Assistente moveu (`EmailBatchCard.tsx`).
  if (action.kind === 'email-lote') return <EmailBatchCard action={action} />
  // Contrato 78.
  if (action.kind === 'evento') return <EventCard action={action} actionRef={actionRef} />
  if (action.kind === 'lembrete-editar') return <ReminderEditCard action={action} actionRef={actionRef} />
  if (action.kind === 'lembrete-apagar') return <ReminderDeleteCard action={action} actionRef={actionRef} />
  // Contrato 76.
  if (action.kind === 'instagram-rascunho') return <InstagramDraftCard action={action} actionRef={actionRef} />
  // Contrato 117.
  if (action.kind === 'oportunidade-mover') return <OportunidadeMoverCard action={action} actionRef={actionRef} />
  if (action.kind === 'oportunidade-criar') return <OportunidadeCriarCard action={action} actionRef={actionRef} />
  if (action.kind === 'oportunidade-proximo-passo') return <ProximoPassoCard action={action} actionRef={actionRef} />
  if (action.kind === 'contato-criar') return <ContatoCriarCard action={action} actionRef={actionRef} />
  // Contrato 127.
  if (action.kind === 'tarefa-criar') return <TarefaCriarCard action={action} actionRef={actionRef} />
  if (action.kind === 'tarefa-concluir') return <TarefaConcluirCard action={action} actionRef={actionRef} />
  if (action.kind === 'tarefa-adiar') return <TarefaAdiarCard action={action} actionRef={actionRef} />
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
