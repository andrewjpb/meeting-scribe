// Contrato 62 (convites-agenda): o estado do cartão do convite e os resultados dos canais do serviço de convites
// (main/invites/service.ts). Só tipos e as frases fixas dos erros: o 63 mostra o que vem daqui, sem tabela própria.
// Puro: nada de `node:*`, `electron` nem `main/`; o `InviteCalendarAccess` repete o enum do protocolo do 60 (um teste
// confere que é igual).

export const INVITE_KINDS = ['new', 'responded', 'in-calendar', 'already-in-calendar', 'update-pending', 'cancelled', 'old', 'reply-received', 'error'] as const
export type InviteKind = (typeof INVITE_KINDS)[number]
export type InviteCalendarAccess = 'full' | 'writeOnly' | 'denied' | 'restricted' | 'notDetermined'
export type InviteCalendarStatus =
  | { status: 'unavailable'; reason: 'platform' | 'no-binary' | 'gave-up' | 'disposed' } // D9, N9
  | { status: 'needs-access' } // notDetermined: o primeiro "Pôr na agenda" pede (R8)
  | { status: 'no-access'; access: 'denied' | 'restricted' | 'writeOnly' } // R8
  | { status: 'absent' } // não está na agenda; dá para pôr
  | { status: 'app'; calendarId: string; calendarTitle: string; sourceTitle: string } // o app gravou e achou
  | { status: 'account'; calendarTitle: string; sourceTitle: string; merged: boolean } // R5a (merged false) ou R5c (true)
  | { status: 'missing'; calendarId: string; calendarTitle: string | null; sourceTitle: string | null } // o app gravou e não acha mais (R6); nomes `null` se a agenda sumiu
  | { status: 'skipped' } // nada foi perguntado ao helper (CA8)
  | { status: 'error'; code: InviteErrorCode } // falha passageira
export interface InviteWhen {
  start: string
  end: string
  allDay: boolean
  timeZone: string | null
}
export type InviteChange = { field: 'time'; before: InviteWhen; after: InviteWhen } | { field: 'title' | 'location' | 'url'; before: string | null; after: string | null }
export interface InviteState {
  accountId: string
  /** O `EmailMessage.id` pedido. */
  id: string
  uid: string
  /** Sem fração de segundo (CA4). */
  recurrenceId: string | null
  method: 'REQUEST' | 'CANCEL' | 'REPLY'
  kind: InviteKind
  response: { partstat: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'; at: number } | null
  calendar: InviteCalendarStatus
  /** Só em 'update-pending'. */
  changes: InviteChange[]
  /** Estado inicial da caixa "Pôr na agenda" (R5b, R9). */
  addDefault: boolean
  /** A frase do R5b. */
  addHint: 'account-adds' | null
  /** R9 (CA13). */
  defaultCalendarId: string | null
  /** As recusas do `sendInviteReply` do 61 (CA9). */
  replyable: boolean
  /** N5: o endereço da conta não está entre os ATTENDEE. */
  notForMe: boolean
  /** N8: repetição que o app não grava. */
  recurrenceBlocked: boolean
  /** Só em REPLY. */
  replier: { name: string | null; address: string; partstat: string } | null
  /** R5c, só na primeira leitura depois de juntar. */
  notice: 'merged' | null
  actions: { add: boolean; update: boolean; remove: boolean; openIcs: boolean; requestAccess: boolean; openSettings: boolean }
  /** Só em 'error'. */
  error: { code: InviteErrorCode; message: string } | null
}
export type InviteErrorCode =
  | 'missing'
  | 'invalid'
  | 'old'
  | 'not-request'
  | 'recurrence'
  | 'unavailable'
  | 'denied'
  | 'restricted'
  | 'no-calendar'
  | 'read-only-calendar'
  | 'not-owned'
  | 'not-found'
  | 'busy'
  | 'failed'
export type InviteStateResult = { ok: true; state: InviteState } | { ok: false; error: 'missing' | 'invalid' | 'unavailable' }
export type InviteEffect = 'created' | 'already' | 'updated' | 'removed' | 'none'
export type InviteActionResult = { ok: true; effect: InviteEffect; state: InviteState } | { ok: false; error: InviteErrorCode; message: string; state: InviteState | null }
export interface InviteCalendarOption {
  id: string
  title: string
  sourceTitle: string
  sourceType: 'local' | 'exchange' | 'caldav' | 'mobileme' | 'subscribed' | 'birthdays'
  isDefault: boolean
}
export type InviteCalendarsResult = { ok: true; access: InviteCalendarAccess; calendars: InviteCalendarOption[]; defaultId: string | null } | { ok: false; error: 'unavailable'; reason: string }
export type InviteAccessResult = { ok: true; access: InviteCalendarAccess; granted: boolean } | { ok: false; error: 'unavailable'; reason: string }
export type InviteOpenIcsResult = { ok: true } | { ok: false; error: 'missing' | 'invalid' | 'failed' }

/** Entradas sem IPC para o 64 (CA23). */
export type InviteRuleAddResult = { ok: true; effect: 'created' | 'already' | 'none' } | { ok: false; error: 'calendar-denied' | 'no-calendar' }
export type InviteEventAddResult = { ok: true; effect: 'created' | 'already'; calendarTitle: string; sourceTitle: string } | { ok: false; error: InviteErrorCode; message: string }

/** Pedidos dos canais (CA18): o renderer manda só a conta e a mensagem; o convite sai do corpo guardado no main. */
export interface InviteMessageRequest {
  accountId: string
  id: string
}
export interface InviteAddRequest extends InviteMessageRequest {
  calendarId: string
  availability: 'busy' | 'tentative'
}

/** CA17: as frases fixas, em português; nunca o `message` do helper. */
export const INVITE_ERROR_MESSAGES: Readonly<Record<InviteErrorCode, string>> = Object.freeze({
  missing: 'Não achei o convite desta mensagem.',
  invalid: 'Não foi possível fazer isso agora.',
  old: 'Há uma versão mais nova deste convite.',
  'not-request': 'Este convite não vai para a agenda.',
  recurrence: 'Esta repetição o app não consegue copiar.',
  unavailable: 'O Calendário do Mac não está disponível aqui.',
  denied: 'Sem acesso ao Calendário.',
  restricted: 'O acesso ao Calendário está restrito neste Mac.',
  'no-calendar': 'A agenda escolhida não existe mais. Escolha outra.',
  'read-only-calendar': 'Esta agenda não aceita eventos novos. Escolha outra.',
  'not-owned': 'O app não mexe em evento que ele não pôs na agenda.',
  'not-found': 'Não encontrei este evento na agenda.',
  busy: 'Já há um pedido em andamento para este convite.',
  failed: 'O Calendário não respondeu. Tente de novo.',
})
