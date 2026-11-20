import { Calendar, CalendarPlus, CalendarX, Check, CircleHelp, Clock, ExternalLink, Info, MapPin, Merge, RefreshCw, Repeat, Settings, Trash2, TriangleAlert, User, Users, Video, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { EmailAccount, EmailMessage } from '@shared/email'
import type { EmailInvite } from '@shared/invite'
import { useLock } from '../../app/lockStore'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { CalendarPicker } from './CalendarPicker'
import { bodyKey, useEmail } from './emailStore'
import { accountLabel, emailFullDate } from './format'
import {
  attendeesLabel,
  calendarLabel,
  inviteWhen,
  joinLabel,
  joinService,
  macTimeZone,
  notForLine,
  occurrenceDay,
  partstatVerb,
  personLabel,
  recurrenceBlockLabel,
  RESPONSE_LABELS,
  responseHead,
  responseLine,
  sentToLine,
  whenDiff,
  type DiffPiece,
  type ReplyPartstat,
} from './inviteFormat'
import { useInvites } from './inviteStore'
import { availabilityFor, inviteView, type InviteBadgeTone, type InviteStatusView, type InviteView } from './inviteView'

// ---------------------------------------------------------------------------------------------------------------
// Peças do cartão (CA27): o 64 monta o cartão "Sugestão — confira" com elas, sem copiar classes.

const BADGE_TONES: Record<InviteBadgeTone, string> = {
  outline: 'border border-title text-title',
  solid: 'bg-accent text-on-accent',
  muted: 'bg-bg-sunken text-text-muted',
  danger: 'border border-rec text-rec',
  dashed: 'border border-dashed border-line-strong text-text-faint',
}

/** CA3: a etiqueta do estado, à direita do topo. Raio 4, sem pílula, sem verde nem amarelo. */
export function InviteBadge({ tone, children }: { tone: InviteBadgeTone; children: ReactNode }) {
  return (
    <span data-invite-badge data-invite-badge-tone={tone} className={`inline-flex h-5 shrink-0 items-center rounded-[var(--radius-control)] px-1.5 text-11 font-medium whitespace-nowrap ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

interface InviteCardShellProps {
  /** "Convite de reunião", "Convite atualizado", "Convite cancelado", "Resposta ao convite" (ou o do 64). */
  typeLabel: string
  badge: { text: string; tone: InviteBadgeTone } | null
  children: ReactNode
  /** Atributos do contêiner (`data-invite-card`, `data-invite-state`, `aria-busy`…). */
  attrs?: Record<string, string | boolean | undefined>
  /** A moldura tracejada da sugestão (64). */
  dashed?: boolean
}

/** CA2: a moldura do `CARD` do Assistente (borda --line-strong, raio 6, --bg-raised, sem sombra) com o topo. */
export function InviteCardShell({ typeLabel, badge, children, attrs = {}, dashed = false }: InviteCardShellProps) {
  return (
    <div {...attrs} className={`flex w-full min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-4 ${dashed ? 'border-dashed' : ''}`}>
      <div data-invite-head className="flex min-w-0 items-center gap-2 text-12 font-medium text-text-muted">
        <Icon icon={Calendar} size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{typeLabel}</span>
        <span className="ml-auto" />
        {badge && <InviteBadge tone={badge.tone}>{badge.text}</InviteBadge>}
      </div>
      {children}
    </div>
  )
}

interface InviteNoteProps {
  icon: LucideIcon
  /** `data-<marker>` da nota (`invite-no-access`, `invite-not-storable`…). */
  marker: string
  title?: ReactNode
  children: ReactNode
  /** Botões embaixo do texto. */
  actions?: ReactNode
  role?: 'status' | 'alert'
  /** O texto em --text-muted (a nota de uma linha do "Juntei…"). */
  muted?: boolean
}

/** CA13 e CA17: a nota de 12 px dentro do cartão, no formato das notas da LAP (barra de 3 px em --title à esquerda). */
export function InviteNote({ icon, marker, title, children, actions, role, muted = false }: InviteNoteProps) {
  return (
    <div {...{ [`data-${marker}`]: '' }} role={role} className="flex items-start gap-2.5 border-l-3 border-title bg-bg-sunken px-3 py-2.5 text-12 text-text">
      <Icon icon={icon} size={14} className="mt-px shrink-0 text-title" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="font-bold text-title">{title}</p>}
        <p className={`text-pretty ${muted ? 'text-text-muted' : ''}`}>{children}</p>
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

interface InviteStatusLineProps {
  icon: LucideIcon
  title: ReactNode
  sub?: ReactNode
  /** `rec` no cancelado e no "não encontrei". */
  tone?: 'accent' | 'rec'
  /** `data-<marker>` (padrão `invite-status-line`). */
  marker?: string
}

/** CA8: a linha de estado com ícone ("Na agenda Trabalho (iCloud)" e a frase embaixo). */
export function InviteStatusLine({ icon, title, sub, tone = 'accent', marker = 'invite-status-line' }: InviteStatusLineProps) {
  return (
    <div {...{ [`data-${marker}`]: '' }} className="flex min-w-0 items-start gap-2 text-13">
      <Icon icon={icon} className={`mt-0.5 shrink-0 ${tone === 'rec' ? 'text-rec' : 'text-accent'}`} />
      <div className="min-w-0 flex-1">
        <p className={tone === 'rec' ? 'text-rec' : 'text-text'}>{title}</p>
        {sub && <p className="text-12 text-text-faint">{sub}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// O cartão do convite na leitura (contrato 63, CA1 a CA18).

const REPLY_BUTTONS: readonly { partstat: ReplyPartstat; label: string; action: string; icon: LucideIcon }[] = [
  { partstat: 'ACCEPTED', label: 'Aceitar', action: 'invite-accept', icon: Check },
  { partstat: 'TENTATIVE', label: 'Talvez', action: 'invite-tentative', icon: CircleHelp },
  { partstat: 'DECLINED', label: 'Recusar', action: 'invite-decline', icon: X },
]
const SEGMENT_ICONS: Record<ReplyPartstat, LucideIcon> = { ACCEPTED: Check, TENTATIVE: CircleHelp, DECLINED: X }

/** Desligado durante o "Enviando" (CA9). */
const OFF = 'pointer-events-none opacity-50'

/**
 * CA9: o quadrado de 8 px que pulsa só em opacidade, no ritmo do `rec-pulse` do app (1,6 s; o `--duration-slow` piscaria
 * 5,5 vezes por segundo). Nada anima com movimento reduzido (regra de tokens.css).
 */
function SendingMark({ onAccent }: { onAccent: boolean }) {
  return <span data-invite-sending-mark aria-hidden="true" className={`inline-block size-2 shrink-0 rec-pulse ${onAccent ? 'bg-on-accent' : 'bg-title'}`} />
}

/** O valor antigo riscado → o novo em negrito (CA11). */
function Diff({ pieces }: { pieces: DiffPiece[] }) {
  return (
    <>
      {pieces.map((piece, index) =>
        piece.mark === 'old' ? (
          <span key={index} data-invite-old className="text-text-muted line-through">
            {piece.text}
          </span>
        ) : piece.mark === 'new' ? (
          <span key={index} data-invite-new className="font-bold text-title">
            {piece.text}
          </span>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  )
}

/** O realce da linha que mudou (CA11, D7): o token `--hl`. */
const CHANGED = 'rounded-[var(--radius-control)] bg-hl px-1'

/** Uma linha dos detalhes: ícone de 16 px em --text-muted à esquerda. */
function DetailRow({ icon, marker, changed = false, children }: { icon: LucideIcon; marker: string; changed?: boolean; children: ReactNode }) {
  return (
    <div {...{ [`data-${marker}`]: '' }} data-invite-changed={changed ? '' : undefined} className="flex min-w-0 items-start gap-2.5">
      <Icon icon={icon} className="mt-0.5 shrink-0 text-text-muted" />
      <div className={`min-w-0 flex-1 select-text ${changed ? CHANGED : ''}`}>{children}</div>
    </div>
  )
}

/** Secundário com contorno --rec ("Tirar da agenda", CA12), no tamanho do `Button`. */
function DangerOutlineButton({ action, icon, children, onClick, disabled = false }: { action: string; icon: LucideIcon; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={disabled}
      className="no-drag inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-rec bg-bg-raised px-3.5 text-13 font-medium whitespace-nowrap text-rec transition-[opacity,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon icon={icon} />
      <span>{children}</span>
    </button>
  )
}

/** CA8: "Sua resposta", segmentado de 28 px (`radiogroup`: setas mudam o foco, Enter ou Espaço escolhe). */
function ResponseSegment({ value, sending, onPick }: { value: ReplyPartstat; sending: ReplyPartstat | null; onPick: (partstat: ReplyPartstat) => void }) {
  const group = useRef<HTMLDivElement | null>(null)
  const options = Object.keys(RESPONSE_LABELS) as ReplyPartstat[]
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    const radios = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
    const at = radios.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    radios[(at + step + radios.length) % radios.length]?.focus()
  }
  return (
    <div data-invite-response={value} className="flex flex-wrap items-center gap-2">
      <span id="invite-response-label" className="text-12 text-text-faint">
        Sua resposta
      </span>
      <div ref={group} role="radiogroup" aria-labelledby="invite-response-label" onKeyDown={onKeyDown} className="flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
        {options.map((partstat, index) => {
          const checked = partstat === value
          const busy = sending === partstat
          return (
            <button
              key={partstat}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-invite-response-option={partstat}
              onClick={() => {
                if (!checked) onPick(partstat)
              }}
              className={`no-drag inline-flex h-7 items-center gap-1.5 px-2.5 text-12 whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${index > 0 ? 'border-l border-line-strong' : ''} ${
                checked ? 'bg-title font-medium text-bg' : 'bg-bg-raised text-text hover:bg-bg-sunken'
              } ${sending && !busy ? OFF : ''}`}
            >
              {busy ? <SendingMark onAccent={checked} /> : <Icon icon={SEGMENT_ICONS[partstat]} size={14} />}
              {busy ? 'Enviando resposta…' : RESPONSE_LABELS[partstat]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** O "Na agenda …", "Já está na agenda …" etc. (CA8, CA10, CA11, CA12, CA13). */
function StatusLine({ status, organizer, timeZone, now }: { status: InviteStatusView; organizer: EmailInvite['organizer']; timeZone: string; now: number }) {
  switch (status.kind) {
    case 'in-calendar':
    case 'already':
      return (
        <InviteStatusLine
          icon={Calendar}
          title={
            <>
              <b className="font-bold text-title">
                {status.kind === 'already' ? 'Já está na agenda' : 'Na agenda'} {status.calendarTitle}
              </b>{' '}
              <span className="text-text-muted">({status.sourceTitle})</span>
            </>
          }
          sub={status.response ? responseLine(status.response, organizer, timeZone, now) : status.kind === 'already' ? 'A sua conta já pôs na agenda. Responder não cria outro evento.' : undefined}
        />
      )
    case 'responded':
      return <InviteStatusLine icon={Calendar} title={<b className="font-bold text-title">{responseHead(status.response, timeZone, now)}</b>} sub={organizer ? sentToLine(organizer) : undefined} />
    case 'update':
      return (
        <InviteStatusLine
          icon={RefreshCw}
          title={<b className="font-bold text-title">O organizador mudou o convite</b>}
          sub={`${status.calendarTitle ? `Na agenda ${status.calendarTitle} o evento` : 'Na agenda, o evento'} ainda está no horário antigo.${status.partstat ? ` Sua resposta continua: ${RESPONSE_LABELS[status.partstat]}.` : ''}`}
        />
      )
    case 'cancelled':
      return (
        <InviteStatusLine
          icon={CalendarX}
          tone="rec"
          title={<b className="font-bold">{status.occurrence ? `A ocorrência de ${occurrenceDay(status.occurrence, timeZone, now)} foi cancelada.` : 'Cancelado pelo organizador'}</b>}
          sub={
            status.mode === 'removed'
              ? `Tirado da agenda${status.calendarTitle ? ` ${status.calendarTitle}` : ''}.`
              : status.mode === 'app'
                ? `O evento ainda está na agenda${status.calendarTitle ? ` ${status.calendarTitle}` : ''} (o app pôs lá). Só sai no seu clique.`
                : 'Se ele estiver na sua agenda, a sua conta tira.'
          }
        />
      )
  }
}

interface InviteCardProps {
  account: EmailAccount
  message: EmailMessage
  invite: EmailInvite
  /** O `openLink` da leitura: o link da reunião passa pela mesma confirmação "Abrir … no navegador?" (D6). */
  onLink: (href: string) => void
}

/**
 * Cartão do convite (contrato 63): entre o cabeçalho e o corpo da leitura. Abrir só lê o estado (`scribe:invite-state`);
 * responder, pôr, atualizar e tirar da agenda só no clique. Com o app bloqueado, nada aparece e nenhum canal é chamado.
 */
export function InviteCard({ account, message, invite, onLink }: InviteCardProps) {
  const locked = useLock((store) => store.status.locked)
  const key = bodyKey(account.id, message.id)
  const state = useInvites((store) => store.states[key])
  const calendars = useInvites((store) => store.calendars)
  const addChecked = useInvites((store) => store.addChecked[key])
  const calendarChoice = useInvites((store) => store.calendarChoice[key])
  const sending = useInvites((store) => store.sending[key] ?? null)
  const busy = useInvites((store) => store.busy[key] ?? null)
  const actionError = useInvites((store) => store.errors[key] ?? null)
  const effect = useInvites((store) => store.effects[key] ?? null)
  const accounts = useEmail((store) => store.accounts)
  // O "hoje às" e o ano da hora, contados a partir de quando a mensagem abriu.
  const [now] = useState(() => Date.now())

  // CA1: uma leitura por abertura, de novo a cada mudança da conta e ao desbloquear.
  useEffect(() => {
    if (locked) return
    void useInvites.getState().load(account.id, message.id, { clearError: true })
    return window.__scribeApi.on('scribe:email-changed', ({ accountId }) => {
      if (accountId === account.id) void useInvites.getState().load(account.id, message.id, { clearError: true })
    })
  }, [account.id, message.id, locked])

  const removed = effect?.effect === 'removed' ? { calendarTitle: effect.calendarTitle } : null
  const view: InviteView = inviteView({ invite, state, removed })
  const needsCalendars = view.addRow || view.addAfter || view.addPrimary || view.readd !== null

  // As agendas: lidas na primeira vez e de novo ao abrir, se a lista anterior veio sem acesso ou vazia.
  useEffect(() => {
    if (locked || !needsCalendars) return
    const listed = useInvites.getState().calendars
    if (listed === null || !listed.ok || listed.access !== 'full' || listed.calendars.length === 0) void useInvites.getState().loadCalendars()
  }, [locked, needsCalendars, message.id])

  if (locked) return null

  const timeZone = macTimeZone()
  const store = useInvites.getState()
  const options = calendars?.ok ? calendars.calendars : []
  const inList = (id: string | null | undefined): id is string => Boolean(id) && options.some((item) => item.id === id)
  const defaultCalendar = state?.defaultCalendarId ?? (calendars?.ok ? calendars.defaultId : null)
  const pickerValue = calendarChoice ?? defaultCalendar ?? null
  const readdValue = calendarChoice ?? (inList(view.readd?.calendarId) ? (view.readd?.calendarId ?? null) : defaultCalendar)
  const checked = addChecked ?? state?.addDefault ?? false
  const disabledAll = sending !== null || busy !== null
  const organizer = invite.organizer
  const who = accountLabel(
    (accounts ?? []).map((item) => item.account),
    account,
  )

  const reply = (partstat: ReplyPartstat): void => {
    // Sem a caixa à vista (já respondido), trocar a resposta nunca grava sozinho: para isso há o "Pôr na agenda".
    void store.reply(account.id, message.id, partstat, { addChecked: view.addRow && checked, calendarId: view.addRow ? pickerValue : null })
  }
  const openIcs = (): void => void store.openIcs(account.id, message.id)
  const picker = (value: string | null, disabled: boolean) => (
    <CalendarPicker calendars={options} value={value} disabled={disabled} label="Agenda deste convite" onChange={(calendarId) => store.chooseCalendar(account.id, message.id, calendarId)} />
  )

  // A hora: o antes → o depois quando mudou (CA11); senão a do convite.
  const timeChange = view.changes.time
  const when = inviteWhen(timeChange?.field === 'time' ? timeChange.after : invite, timeZone, now)
  const whenBefore = timeChange?.field === 'time' ? inviteWhen(timeChange.before, timeZone, now) : null
  const titleChange = view.changes.title
  const locationChange = view.changes.location
  const urlChange = view.changes.url
  const joinUrl = urlChange && urlChange.field !== 'time' ? urlChange.after : invite.joinUrl
  const oldJoinUrl = urlChange && urlChange.field !== 'time' ? urlChange.before : null
  const location = locationChange && locationChange.field !== 'time' ? locationChange : null

  const timeRow = (
    <DetailRow icon={Clock} marker="invite-time" changed={whenBefore !== null}>
      <span>{whenBefore ? <Diff pieces={whenDiff(whenBefore, when)} /> : when.main}</span>
      {when.duration && <span className="text-text-muted"> · {when.duration}</span>}
      {when.origin && (
        <span data-invite-origin-time className="block text-12 text-text-faint">
          {when.origin}
        </span>
      )}
    </DetailRow>
  )

  const title =
    titleChange && titleChange.field !== 'time' ? (
      <h3 data-invite-title data-invite-changed="" className={`text-15 font-bold text-title select-text ${CHANGED}`}>
        <Diff
          pieces={[
            ...(titleChange.before ? [{ text: titleChange.before, mark: 'old' as const }, { text: ' → ', mark: null }] : []),
            { text: titleChange.after ?? invite.title, mark: 'new' as const },
          ]}
        />
      </h3>
    ) : (
      <h3 data-invite-title className={`text-15 font-bold select-text ${view.cancelled ? 'text-text-muted line-through' : 'text-title'}`}>
        {invite.title}
      </h3>
    )

  const attrs = { 'data-invite-card': '', 'data-invite-state': view.stateAttr, 'aria-busy': sending !== null ? 'true' : undefined }

  if (view.compact) {
    // CA15: quem respondeu e como, o título e a hora numa linha.
    const replier = state?.replier ?? null
    return (
      <InviteCardShell typeLabel={view.typeLabel} badge={view.badge} attrs={attrs}>
        {replier && (
          <div data-invite-replier className="flex min-w-0 flex-col text-13">
            <p className="text-15 font-bold text-title">
              {personLabel(replier)} {partstatVerb(replier.partstat)}
            </p>
            <p className="text-12 text-text-faint">
              {replier.address} · {emailFullDate(message.date)}
            </p>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 select-text">
          <h3 data-invite-title className="text-15 font-bold text-title">
            {invite.title}
          </h3>
          <span data-invite-time className="text-13 text-text-muted">
            {when.text}
          </span>
        </div>
      </InviteCardShell>
    )
  }

  const footer: ReactNode[] = []
  if (view.status) footer.push(<StatusLine key="status" status={view.status} organizer={organizer} timeZone={timeZone} now={now} />)
  if (view.missing) {
    footer.push(
      <InviteStatusLine
        key="missing"
        marker="invite-missing"
        icon={TriangleAlert}
        tone="rec"
        title={<b className="font-bold">Não encontrei este evento na agenda</b>}
        sub={view.missing.calendarTitle ? `O app pôs na agenda ${calendarLabel(view.missing.calendarTitle, view.missing.sourceTitle)}, mas ele não está mais lá. Pode ter sido apagado no Calendário.` : 'O app tinha posto este evento na agenda, mas ele não está mais lá.'}
      />,
    )
  }
  if (view.reconciled) {
    footer.push(
      <InviteNote key="reconciled" marker="invite-reconciled" icon={Merge} muted>
        Juntei com o evento que a sua conta pôs na agenda.
      </InviteNote>,
    )
  }
  if (view.noAccess) {
    const { openSettings, openIcs: canOpenIcs } = view.noAccess
    footer.push(
      <InviteNote
        key="no-access"
        marker="invite-no-access"
        role="status"
        icon={TriangleAlert}
        title="Sem acesso ao Calendário"
        actions={
          (openSettings || canOpenIcs) && (
            <>
              {openSettings && <ActionButton icon={Settings} label="Abrir Ajustes" action="invite-open-settings" onClick={() => window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')} />}
              {canOpenIcs && <ActionButton icon={ExternalLink} label="Abrir no app de agenda" action="invite-open-ics" disabled={busy === 'open-ics'} onClick={openIcs} />}
            </>
          )
        }
      >
        O macOS não deixou o app pôr o evento na agenda. Permita em Ajustes › Privacidade › Calendários, ou abra o convite no app de agenda, que importa sozinho.
      </InviteNote>,
    )
  }
  if (view.notForMe) {
    footer.push(
      <InviteNote key="not-for" marker="invite-not-for" icon={Info} title={`Este convite não é para ${account.address}`}>
        {notForLine(invite.attendees, invite.attendeeCount)}
      </InviteNote>,
    )
  }
  if (view.notStorable) {
    footer.push(
      <InviteNote
        key="not-storable"
        marker="invite-not-storable"
        icon={Repeat}
        title="Esta repetição o app não consegue copiar"
        actions={view.notStorable.openIcs && <ActionButton icon={ExternalLink} label="Abrir no app de agenda" action="invite-open-ics" disabled={busy === 'open-ics'} onClick={openIcs} />}
      >
        O Calendário do Mac não representa este tipo de repetição pelo app. Abra o convite no app de agenda, que importa todas as datas.
      </InviteNote>,
    )
  }
  if (view.oldVersion) {
    footer.push(
      <p key="old" data-invite-old-version className="text-12 text-text-muted">
        Há uma versão mais nova deste convite.
      </p>,
    )
  }
  if (view.addRow) {
    footer.push(
      <div key="add" className={`flex flex-col gap-1.5 ${disabledAll ? OFF : ''}`}>
        <div data-invite-add-row aria-disabled={disabledAll || undefined} className="flex flex-wrap items-center gap-2">
          <label className="no-drag inline-flex items-center gap-2 text-13 text-text">
            <input type="checkbox" data-invite-add checked={checked} disabled={disabledAll} onChange={(event) => store.setAdd(account.id, message.id, event.target.checked)} className="size-4 rounded-[var(--radius-control)] accent-[var(--accent)]" />
            Pôr na agenda
          </label>
          {picker(pickerValue, !checked || disabledAll)}
        </div>
        {view.accountAdds && (
          <p data-invite-account-adds className="flex items-center gap-1.5 text-12 text-text-muted">
            <Icon icon={Info} size={14} className="shrink-0" />
            Sua conta já põe os convites na agenda dela.
          </p>
        )}
      </div>,
    )
  }
  if (view.openIcsButton) {
    footer.push(
      <div key="open-ics" className="flex flex-wrap items-center gap-2">
        <Button action="invite-open-ics" variant="secondary" icon={ExternalLink} disabled={busy === 'open-ics'} onClick={openIcs}>
          Abrir no app de agenda
        </Button>
      </div>,
    )
  }
  if (view.addAfter) {
    footer.push(
      <div key="add-after" data-invite-add-after className={`flex flex-wrap items-center gap-2 ${disabledAll ? OFF : ''}`}>
        <Button action="invite-add-after" variant="secondary" icon={CalendarPlus} disabled={disabledAll} onClick={() => void store.add(account.id, message.id, pickerValue, availabilityFor(state?.response?.partstat))}>
          Pôr na agenda
        </Button>
        {picker(pickerValue, disabledAll)}
      </div>,
    )
  }
  if (view.addPrimary) {
    footer.push(
      <div key="add-primary" className="flex flex-wrap items-center gap-2">
        <Button action="invite-add" icon={CalendarPlus} disabled={disabledAll} onClick={() => void store.add(account.id, message.id, pickerValue, 'busy')}>
          Pôr na agenda
        </Button>
        {picker(pickerValue, disabledAll)}
      </div>,
    )
  }
  if (view.readd) {
    footer.push(
      <div key="readd" className="flex flex-wrap items-center gap-2">
        <Button action="invite-readd" variant="secondary" icon={CalendarPlus} disabled={disabledAll} onClick={() => void store.add(account.id, message.id, readdValue, availabilityFor(state?.response?.partstat))}>
          Pôr de novo
        </Button>
        {picker(readdValue, disabledAll)}
      </div>,
    )
  }
  if (view.updateButton) {
    footer.push(
      <div key="update" className="flex flex-wrap items-center gap-2">
        <Button action="invite-update" icon={RefreshCw} disabled={disabledAll} onClick={() => void store.update(account.id, message.id)}>
          {busy === 'update' ? 'Atualizando…' : 'Atualizar na agenda'}
        </Button>
      </div>,
    )
  }
  if (view.removeButton) {
    footer.push(
      <div key="remove" className="flex flex-wrap items-center gap-2">
        <DangerOutlineButton action="invite-remove" icon={Trash2} disabled={disabledAll} onClick={() => void store.remove(account.id, message.id)}>
          Tirar da agenda
        </DangerOutlineButton>
      </div>,
    )
  }
  if (view.replyButtons) {
    footer.push(
      <div key="reply" data-invite-actions className="flex flex-wrap items-center gap-2">
        {REPLY_BUTTONS.map((item) => {
          const own = sending === item.partstat
          const primary = item.partstat === 'ACCEPTED'
          return (
            <Button key={item.action} action={item.action} variant={primary ? 'primary' : 'secondary'} {...(own ? {} : { icon: item.icon })} disabled={disabledAll && !own} onClick={() => reply(item.partstat)}>
              {own ? (
                <span className="inline-flex items-center gap-2.5">
                  <SendingMark onAccent={primary} />
                  Enviando resposta…
                </span>
              ) : (
                item.label
              )}
            </Button>
          )
        })}
      </div>,
    )
  }
  if (view.responseSegment && state?.response) {
    footer.push(<ResponseSegment key="segment" value={state.response.partstat} sending={sending} onPick={reply} />)
  }
  if (sending) {
    footer.push(
      <p key="sending" data-invite-sending className="text-12 text-text-faint">
        Enviando “{RESPONSE_LABELS[sending]}”{organizer ? ` a ${personLabel(organizer)}` : ''} pela conta {who}…
      </p>,
    )
  }
  const error = actionError ?? view.error
  if (error) {
    footer.push(
      <p key="error" data-invite-error role="alert" className="text-12 text-rec">
        {error}
      </p>,
    )
  }

  const recurrence = invite.recurrence
  const blocked = view.notStorable !== null
  return (
    <InviteCardShell typeLabel={view.typeLabel} badge={view.badge} attrs={attrs}>
      {title}
      <div data-invite-details className={`flex flex-col gap-2 text-13 text-text ${view.cancelled ? 'opacity-60' : ''}`}>
        {timeRow}
        {recurrence && (
          <DetailRow icon={Repeat} marker="invite-recurrence">
            {recurrence.text}
            {blocked && <span className="ml-2 text-12 text-text-faint">{recurrenceBlockLabel(recurrence.block)}</span>}
          </DetailRow>
        )}
        {(invite.location || location) && (
          <DetailRow icon={MapPin} marker="invite-location" changed={location !== null}>
            {location ? (
              <Diff
                pieces={[
                  ...(location.before ? [{ text: location.before, mark: 'old' as const }, { text: ' → ', mark: null }] : []),
                  ...(location.after ? [{ text: location.after, mark: 'new' as const }] : []),
                ]}
              />
            ) : (
              invite.location
            )}
          </DetailRow>
        )}
        {!view.cancelled && (joinUrl || oldJoinUrl) && (
          <DetailRow icon={Video} marker="invite-join" changed={urlChange !== undefined}>
            {oldJoinUrl && (
              <>
                <span data-invite-old className="text-text-muted line-through">
                  {joinLabel(oldJoinUrl)}
                </span>
                {joinUrl && ' → '}
              </>
            )}
            {joinUrl && (
              <a
                href={joinUrl}
                data-invite-join-link
                {...(urlChange ? { 'data-invite-new': '' } : {})}
                onClick={(event) => {
                  event.preventDefault()
                  onLink(joinUrl)
                }}
                className="no-drag inline-flex max-w-full items-center gap-1.5 font-medium break-all text-accent hover:underline"
              >
                {joinLabel(joinUrl)}
                <Icon icon={ExternalLink} size={14} className="shrink-0" />
              </a>
            )}
            {joinUrl && (
              <span data-invite-join-service className="block text-12 text-text-faint">
                {joinService(joinUrl)}
                {view.updating && !urlChange ? ' · sem mudança' : ''}
              </span>
            )}
          </DetailRow>
        )}
        {organizer && (
          <DetailRow icon={User} marker="invite-organizer">
            {organizer.name ? (
              <>
                <b className="font-bold text-text">{organizer.name}</b> <span className="text-text-muted">{organizer.address}</span>
              </>
            ) : (
              organizer.address
            )}
            <span className="block text-12 text-text-faint">Organizador</span>
          </DetailRow>
        )}
        {!view.cancelled && invite.attendeeCount > 0 && (
          <DetailRow icon={Users} marker="invite-attendees">
            {attendeesLabel(invite.attendeeCount)}
          </DetailRow>
        )}
      </div>
      {footer.length > 0 && <div className="flex flex-col gap-2.5 border-t border-line pt-3">{footer}</div>}
    </InviteCardShell>
  )
}
