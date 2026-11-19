// Cartões de ação do Assistente (contrato 25, CA3 e CA4): o que o Claude propôs no fim da resposta, já validado
// pelo main. Nenhum cartão faz nada sozinho: "Criar lembrete" pede ao main a tarefa "uma vez" das Automações;
// "Enviar" usa só `window.__scribeApi.whatsappSend` (o token de clique do preload do contrato 24; sem diálogo
// nativo desde o contrato 33); "Criar tarefa" abre o formulário das Automações preenchido para revisar; "Abrir" leva à
// tela. Depois do clique, o cartão mostra o estado, que fica gravado na conversa. Contrato 26: numa resposta que usou a
// internet, cada cartão vem com o aviso de conferir antes. Contrato 45: os cartões de email. A lista mostra o que o main
// leu do cache quando a resposta terminou (nada é buscado de novo ao desenhar) e o clique abre a tela Email na
// mensagem; o rascunho de resposta só sai pelo `window.__scribeApi.emailSend` (o token de clique do contrato 42), sem
// diálogo, e vira "Enviado às hh:mm".
import { Bell, Check, ExternalLink, Globe, ListChecks, Mail, MessageSquare, Pencil, Send, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  emailSentText,
  reminderTitle,
  REMINDER_TEXT_MAX,
  sentText,
  type ChatAction,
  type ChatActionRef,
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
import { useAutomations, type AutomationsTab } from '../agents/automationsStore'
import { emailTimeLabel, sendErrorText } from '../email/format'
import { macTimeZone } from '../schedules/TaskForm'
import { QUIET_BUTTON } from './ChatMessages'
import { useChat } from './chatStore'

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

/** O cartão de uma ação, pelo tipo. */
function ActionCard({ action, actionRef, choice }: { action: ChatAction; actionRef: ChatActionRef; choice: boolean }) {
  if (action.kind === 'lembrete') return <ReminderCard action={action} actionRef={actionRef} />
  if (action.kind === 'whatsapp-resposta') return <WhatsAppCard action={action} actionRef={actionRef} choice={choice} />
  if (action.kind === 'tarefa') return <TaskCard action={action} actionRef={actionRef} />
  if (action.kind === 'emails') return <EmailListCard action={action} />
  if (action.kind === 'email-resposta') return <EmailReplyCard action={action} actionRef={actionRef} />
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
