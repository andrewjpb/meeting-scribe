// O que o cartão do convite mostra (contrato 63): a etiqueta, os blocos, os botões e as notas a partir do convite do
// corpo (59) e do `InviteState` do 62. Puro e sem regra própria de agenda: um botão de agenda só aparece quando a ação
// do 62 é verdadeira. `afterReply` decide o que vai à agenda depois de um REPLY que deu certo (CA7).
import type { EmailInvite } from '../../../../shared/invite'
import type { InviteCalendarStatus, InviteChange, InviteKind, InviteState } from '../../../../shared/invite-state'
import type { ReplyPartstat } from './inviteFormat'

export type InviteBadgeTone = 'outline' | 'solid' | 'muted' | 'danger' | 'dashed'

/** CA3: a etiqueta de cada `kind` (o tom `dashed` é da sugestão do 64). */
export const INVITE_BADGES: Readonly<Record<InviteKind, { text: string; tone: InviteBadgeTone }>> = {
  new: { text: 'Novo', tone: 'outline' },
  'update-pending': { text: 'Atualização pendente', tone: 'outline' },
  'in-calendar': { text: 'Na agenda', tone: 'solid' },
  'already-in-calendar': { text: 'Já estava na agenda', tone: 'muted' },
  responded: { text: 'Respondido', tone: 'muted' },
  'reply-received': { text: 'Resposta recebida', tone: 'muted' },
  old: { text: 'Antigo', tone: 'muted' },
  cancelled: { text: 'Cancelado', tone: 'danger' },
  error: { text: 'Erro', tone: 'danger' },
}

/** CA1: o estado que não veio. */
export const INVITE_STATE_FAILED = 'Não foi possível conferir a agenda agora.'

/** A linha de estado (CA8, CA10, CA11, CA12, CA13). */
export type InviteStatusView =
  | { kind: 'in-calendar'; calendarTitle: string; sourceTitle: string; response: InviteState['response'] }
  | { kind: 'already'; calendarTitle: string; sourceTitle: string; response: InviteState['response'] }
  | { kind: 'responded'; response: NonNullable<InviteState['response']> }
  | { kind: 'update'; calendarTitle: string | null; partstat: ReplyPartstat | null }
  | { kind: 'cancelled'; occurrence: string | null; mode: 'app' | 'account' | 'removed'; calendarTitle: string | null }

export interface InviteView {
  kind: InviteKind
  /** `data-invite-state`: o `kind`, ou `loading` antes da primeira leitura. */
  stateAttr: InviteKind | 'loading'
  typeLabel: string
  /** `null` enquanto o estado não chegou. */
  badge: { text: string; tone: InviteBadgeTone } | null
  /** CA15: só quem respondeu, o título e a hora. */
  compact: boolean
  /** CA12: título riscado, detalhes apagados, sem o link e os convidados. */
  cancelled: boolean
  /** CA11: as linhas que mudaram. */
  changes: Partial<Record<InviteChange['field'], InviteChange>>
  /** O link mudou ou não, numa atualização (o "· sem mudança"). */
  updating: boolean
  status: InviteStatusView | null
  /** CA6: a caixa "Pôr na agenda" com o seletor (só antes de responder). */
  addRow: boolean
  /**
   * Depois de responder (Aceito ou Talvez) com o evento fora da agenda: "Pôr na agenda" secundário com o seletor, no
   * padrão do "Pôr de novo" (CA16). Só o `-add`, sem REPLY (devolução do 63).
   */
  addAfter: boolean
  /** CA14: "Pôr na agenda" como primário, sem a caixa. */
  addPrimary: boolean
  /** CA7: Aceitar, Talvez e Recusar. */
  replyButtons: boolean
  /** CA8: o segmentado "Sua resposta". */
  responseSegment: boolean
  /** CA11. */
  updateButton: boolean
  /** CA12. */
  removeButton: boolean
  /** CA16: "Pôr de novo", com a agenda em que o app tinha posto. */
  readd: { calendarId: string } | null
  /** CA16. */
  missing: { calendarTitle: string | null; sourceTitle: string | null } | null
  /** CA13: a nota "Sem acesso ao Calendário" e os botões dela. */
  noAccess: { openSettings: boolean; openIcs: boolean } | null
  /** CA13 (`unavailable`): "Abrir no app de agenda" no lugar da linha "Pôr na agenda". */
  openIcsButton: boolean
  /** CA17: a nota da repetição e o botão dela. */
  notStorable: { openIcs: boolean } | null
  /** CA14. */
  notForMe: boolean
  /** CA10. */
  reconciled: boolean
  /** CA6 (R5b). */
  accountAdds: boolean
  /** CA18. */
  oldVersion: boolean
  /** CA18 (`error`) e CA1 (sem estado). */
  error: string | null
}

const TYPE_LABELS: Partial<Record<InviteKind, string>> = {
  'update-pending': 'Convite atualizado',
  cancelled: 'Convite cancelado',
  'reply-received': 'Resposta ao convite',
}

const ADD_ROW: readonly InviteCalendarStatus['status'][] = ['absent', 'needs-access']

export interface InviteViewInput {
  invite: EmailInvite
  /** `undefined`: ainda lendo; `null`: o `invite-state` falhou (CA1). */
  state: InviteState | null | undefined
  /** CA12: o "Tirar da agenda" deste convite já tirou (guardado na memória da tela), com o nome da agenda. */
  removed?: { calendarTitle: string | null } | null
}

export function inviteView({ invite, state, removed = null }: InviteViewInput): InviteView {
  const kind: InviteKind = state ? state.kind : 'error'
  const method = state?.method ?? invite.method
  // Sem estado (CA1): responder segue o convite do corpo; a agenda fica de fora.
  const replyable = state ? state.replyable : method === 'REQUEST' && invite.organizer !== null && invite.self !== null
  const response = state?.response ?? null
  const actions = state?.actions ?? { add: false, update: false, remove: false, openIcs: false, requestAccess: false, openSettings: false }
  const calendar: InviteCalendarStatus = state?.calendar ?? { status: 'skipped' }
  const compact = kind === 'reply-received'
  const cancelled = kind === 'cancelled'
  const notForMe = Boolean(state?.notForMe) && method === 'REQUEST' && !cancelled && kind !== 'old'
  const recurrenceBlocked = Boolean(state?.recurrenceBlocked) && method === 'REQUEST' && !cancelled && kind !== 'old'
  const changes: InviteView['changes'] = {}
  if (kind === 'update-pending') for (const change of state?.changes ?? []) changes[change.field] = change

  let status: InviteStatusView | null = null
  if (state) {
    if (cancelled) {
      const occurrence = state.recurrenceId ?? invite.recurrenceId
      if (removed) status = { kind: 'cancelled', occurrence, mode: 'removed', calendarTitle: removed.calendarTitle }
      else if (actions.remove) status = { kind: 'cancelled', occurrence, mode: 'app', calendarTitle: calendar.status === 'app' ? calendar.calendarTitle : null }
      else status = { kind: 'cancelled', occurrence, mode: 'account', calendarTitle: null }
    } else if (kind === 'update-pending') {
      status = { kind: 'update', calendarTitle: calendar.status === 'app' ? calendar.calendarTitle : null, partstat: response?.partstat ?? null }
    } else if (kind === 'reply-received' || kind === 'old' || kind === 'error') {
      status = null
    } else if (calendar.status === 'app') {
      status = { kind: 'in-calendar', calendarTitle: calendar.calendarTitle, sourceTitle: calendar.sourceTitle, response }
    } else if (calendar.status === 'account') {
      status = calendar.merged
        ? { kind: 'in-calendar', calendarTitle: calendar.calendarTitle, sourceTitle: calendar.sourceTitle, response }
        : { kind: 'already', calendarTitle: calendar.calendarTitle, sourceTitle: calendar.sourceTitle, response }
    } else if (response && calendar.status !== 'missing') {
      status = { kind: 'responded', response }
    }
  }

  const open = !compact && !cancelled && kind !== 'old'
  const addable = state !== undefined && open && !notForMe && actions.add && ADD_ROW.includes(calendar.status)
  const addRow = addable && response === null
  const addAfter = addable && response !== null && response.partstat !== 'DECLINED'
  const noAccess = open && calendar.status === 'no-access' ? { openSettings: actions.openSettings, openIcs: actions.openIcs } : null
  return {
    kind,
    stateAttr: state === undefined ? 'loading' : kind,
    typeLabel: TYPE_LABELS[kind] ?? 'Convite de reunião',
    badge: state === undefined ? null : INVITE_BADGES[kind],
    compact,
    cancelled,
    changes,
    updating: kind === 'update-pending',
    status,
    addRow,
    addAfter,
    addPrimary: open && notForMe && actions.add,
    replyButtons: state !== undefined && open && replyable && response === null,
    responseSegment: state !== undefined && open && replyable && response !== null,
    updateButton: kind === 'update-pending' && actions.update,
    removeButton: cancelled && actions.remove && !removed,
    readd: open && calendar.status === 'missing' && actions.add ? { calendarId: calendar.calendarId } : null,
    missing: open && calendar.status === 'missing' ? { calendarTitle: calendar.calendarTitle, sourceTitle: calendar.sourceTitle } : null,
    noAccess,
    openIcsButton: open && calendar.status === 'unavailable' && actions.openIcs && !recurrenceBlocked,
    notStorable: open && recurrenceBlocked ? { openIcs: actions.openIcs && !noAccess?.openIcs } : null,
    notForMe,
    reconciled: open && state?.notice === 'merged',
    accountAdds: addRow && state?.addHint === 'account-adds',
    oldVersion: kind === 'old',
    error: state === undefined ? null : state === null ? INVITE_STATE_FAILED : kind === 'error' ? (state.error?.message ?? INVITE_STATE_FAILED) : null,
  }
}

/** CA7 e CA16: a disponibilidade do evento pela resposta. */
export const availabilityFor = (partstat: ReplyPartstat | null | undefined): 'busy' | 'tentative' => (partstat === 'TENTATIVE' ? 'tentative' : 'busy')

/**
 * CA7, passo 2: depois do REPLY que deu certo, o que vai à agenda, com o estado lido antes do clique. Aceitar e Talvez
 * gravam com a caixa marcada (e nunca no "já está na agenda", R5a); Recusar tira só o que o app pôs.
 */
export function afterReply(state: InviteState | null | undefined, partstat: ReplyPartstat, addChecked: boolean): 'add' | 'remove' | null {
  if (!state) return null
  if (partstat === 'DECLINED') return state.actions.remove ? 'remove' : null
  if (addChecked && state.actions.add && ADD_ROW.includes(state.calendar.status)) return 'add'
  return null
}
