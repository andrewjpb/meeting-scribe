// Contrato 62 (convites-agenda): o serviço de convites. Liga o convite guardado no corpo do email (contrato 61) ao
// Calendário do Mac pelo cliente do `lap-calendar` (contrato 60): guarda o registro (N3), procura antes de criar
// (R5a), cria, atualiza e tira só no clique (D8), junta com a cópia da conta (R5c) e monta o estado do cartão (R7).
//
// Regras que valem em todo o arquivo:
// - Só uma linha com `event` dá direito a `update` ou `remove`, e só pelos ids dela; a cópia da conta só é lida.
//   As duas únicas chamadas de escrita ao helper ficam em `updateEvent` e `removeEvent`, que recebem o `InviteEventRef`.
// - O renderer manda só a conta e a mensagem: título, horário e UID saem do corpo guardado (`deps.source`).
// - Nada vai para a rede (só o helper, que é local) e nenhum dado de evento vai para o log: só canal, operação, `code`,
//   `reason` e contagens.
import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { EMAIL_ACCOUNT_ID_PATTERN, type EmailAccount, type InviteRepliedEvent } from '../../shared/email'
import { compareInviteVersion, type EmailInvite } from '../../shared/invite'
import {
  INVITE_ERROR_MESSAGES,
  type InviteAccessResult,
  type InviteActionResult,
  type InviteCalendarStatus,
  type InviteCalendarsResult,
  type InviteEffect,
  type InviteErrorCode,
  type InviteEventAddResult,
  type InviteOpenIcsResult,
  type InviteRuleAddResult,
  type InviteState,
  type InviteStateResult,
} from '../../shared/invite-state'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings-defaults'
import type { MacCalendar } from '../mac-calendar/process'
import {
  createArgsSchema,
  type MacCalendarCalendar,
  type MacCalendarCreateArgs,
  type MacCalendarError,
  type MacCalendarEvent,
  type MacCalendarFindArgs,
  type MacCalendarIds,
  type MacCalendarMatch,
  type MacCalendarUpdateArgs,
} from '../mac-calendar/protocol'
import { cleanInviteIcs, writeInviteIcs } from './ics-file'
import { buildState, calendarOption, createArgs, defaultCalendarOf, errorCodeOf, normalizeWhen, recurrenceOf, refFields, updateFields } from './map'
import { createInviteStore, emptyRecord, type InviteEventRef, type InviteKey, type InviteRecord, type InviteStore } from './store'

/** CA8: o `refresh` do Calendário ao abrir o cartão, no máximo uma vez neste intervalo (antes de criar, sempre). */
export const INVITE_REFRESH_MIN_MS = 60_000
/** CA10: a reconciliação de fundo (a cada leitura de agenda), no máximo uma vez neste intervalo. */
export const INVITE_RECONCILE_MIN_MS = 300_000
/** CA10: linhas conferidas por vez na reconciliação de fundo. */
export const INVITE_RECONCILE_BATCH = 20
const DAY_MS = 86_400_000
/** CA10: a janela da reconciliação de fundo, pelo início do evento. */
const RECONCILE_BEFORE_MS = DAY_MS
const RECONCILE_AFTER_MS = 60 * DAY_MS

export interface InviteSource {
  account: EmailAccount
  invite: EmailInvite
  /** O `EmailMessage.id` da mensagem do convite. */
  messageId: string
}

export type InviteSettings = Pick<AppSettings, 'inviteCalendarId' | 'inviteAddOnAccept'>

export interface InviteServiceDeps {
  /** `userData`: o registro fica em `email/invites.json` e os temporários em `tmp/`. */
  root: string
  calendar: MacCalendar
  settings: () => InviteSettings | Promise<InviteSettings>
  /** O convite guardado no corpo da mensagem (`EmailService.inviteSource`); nunca baixa nada. */
  source: (accountId: string, id: string) => Promise<InviteSource | null>
  /** `shell.openPath`: texto vazio quando abriu, a mensagem do erro quando não. */
  openPath: (path: string) => Promise<string>
  now?: () => number
  log?: (message: string) => void
  /** Nos testes, um registro que falha ou atrasa de propósito. */
  store?: InviteStore
}

export interface InviteEventAddRequest {
  accountId: string
  key: string
  messageId: string
  args: MacCalendarCreateArgs
}

export interface InviteService {
  state(request: unknown): Promise<InviteStateResult>
  add(request: unknown): Promise<InviteActionResult>
  update(request: unknown): Promise<InviteActionResult>
  remove(request: unknown): Promise<InviteActionResult>
  calendars(): Promise<InviteCalendarsResult>
  requestAccess(): Promise<InviteAccessResult>
  openIcs(request: unknown): Promise<InviteOpenIcsResult>
  /** CA16: o REPLY saiu (o 61 avisa depois do SMTP com sucesso): grava a resposta na linha. */
  recordReply(event: InviteRepliedEvent): Promise<void>
  /** CA10: a reconciliação de fundo (a cada leitura de agenda). */
  reconcileAll(): Promise<void>
  /** CA23: a ação "Pôr na agenda" das regras do 64 (sem IPC, nunca pede acesso, nunca responde). */
  addFromRule(source: InviteSource): Promise<InviteRuleAddResult>
  /** CA23: gravar a sugestão do 64 no clique (sem IPC). */
  addEvent(request: InviteEventAddRequest): Promise<InviteEventAddResult>
  /** CA23: o Calendário do Mac existe aqui (sem pedir acesso). */
  calendarPresent(): Promise<boolean>
  /** A conta de email saiu: as linhas dela saem; os eventos na agenda ficam. */
  forgetAccount(accountId: string): Promise<void>
  /** Sair do app: apaga os `.ics` temporários. */
  dispose(): Promise<void>
}

// --- Pedidos -----------------------------------------------------------------------------------------------------

const hasNoControlChar = (value: string): boolean => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
const accountIdSchema = z.string().regex(EMAIL_ACCOUNT_ID_PATTERN)
const messageIdSchema = z.string().min(1).max(1024).refine(hasNoControlChar)
const messageRequestSchema = z.object({ accountId: accountIdSchema, id: messageIdSchema }).strict()
const addRequestSchema = z.object({ accountId: accountIdSchema, id: messageIdSchema, calendarId: z.string().min(1).max(1024), availability: z.enum(['busy', 'tentative']) }).strict()
const eventAddRequestSchema = z.object({ accountId: accountIdSchema, key: z.string().min(1).max(1024), messageId: messageIdSchema, args: createArgsSchema }).strict()
const repliedSchema = z
  .object({
    accountId: accountIdSchema,
    messageId: messageIdSchema,
    mailbox: z.string().min(1).max(1024),
    uid: z.string().min(1).max(4096),
    recurrenceId: z.string().min(1).max(64).nullable(),
    sequence: z.number().int().nonnegative(),
    dtstamp: z.string().max(64).nullable(),
    partstat: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']),
    respondedAt: z.number().finite(),
    replyMessageId: z.string().max(1024),
  })
  .strict()

// --- Ajudantes puros ---------------------------------------------------------------------------------------------

const ID_MATCHES: readonly MacCalendarMatch['match'][] = ['eventIdentifier', 'calendarItemIdentifier', 'externalIdentifier']
const UNAVAILABLE_REASONS = ['platform', 'no-binary', 'gave-up', 'disposed'] as const
type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]
const isUnavailableReason = (reason: string): reason is UnavailableReason => (UNAVAILABLE_REASONS as readonly string[]).includes(reason)

const keyOf = (source: InviteSource): InviteKey => ({ accountId: source.account.id, uid: source.invite.uid, recurrenceId: source.invite.recurrenceId === null ? null : normalizeWhen(source.invite.recurrenceId) })
const keyText = (key: InviteKey): string => `${key.accountId}\n${key.uid}\n${key.recurrenceId ?? ''}`
const seriesKey = (key: InviteKey): InviteKey => ({ ...key, recurrenceId: null })
const recurrenceBlocked = (invite: EmailInvite): boolean => invite.recurrence !== null && !invite.recurrence.storable

/**
 * Os ids que vão ao helper. O `externalIdentifier` igual ao UID do convite fica de fora: esse é o id da cópia da conta,
 * e um evento que o app criou nunca o tem (o EventKit não deixa gravar o UID).
 */
function idsOf(ref: Pick<InviteEventRef, 'eventIdentifier' | 'calendarItemIdentifier' | 'externalIdentifier'>, uid: string): MacCalendarIds {
  return {
    ...(ref.eventIdentifier ? { eventIdentifier: ref.eventIdentifier } : {}),
    calendarItemIdentifier: ref.calendarItemIdentifier,
    ...(ref.externalIdentifier && ref.externalIdentifier !== uid ? { externalIdentifier: ref.externalIdentifier } : {}),
  }
}

const sameIds = (ref: InviteEventRef, event: Pick<MacCalendarEvent, 'eventIdentifier' | 'calendarItemIdentifier' | 'externalIdentifier'>): boolean =>
  ref.eventIdentifier === event.eventIdentifier && ref.calendarItemIdentifier === event.calendarItemIdentifier && ref.externalIdentifier === event.externalIdentifier

const withIds = (ref: InviteEventRef, event: Pick<MacCalendarEvent, 'eventIdentifier' | 'calendarItemIdentifier' | 'externalIdentifier'>): InviteEventRef => ({
  ...ref,
  eventIdentifier: event.eventIdentifier,
  calendarItemIdentifier: event.calendarItemIdentifier,
  externalIdentifier: event.externalIdentifier,
})

/** O `find` do CA8: os dados do evento do app (havendo) ou do convite, os ids e a ocorrência. */
function findArgs(invite: EmailInvite, uid: string, ref: InviteEventRef | null): MacCalendarFindArgs {
  const base = ref ?? refFields(invite)
  return {
    uid,
    title: base.title || '(sem título)',
    start: base.start,
    end: base.end,
    allDay: base.allDay,
    ...(ref ? { ids: idsOf(ref, uid) } : {}),
    ...(invite.recurrenceId !== null ? { recurrenceId: normalizeWhen(invite.recurrenceId) } : {}),
  }
}

/**
 * CA8 (4): o evento do app (por id, ou um único título + início na agenda do registro) e a cópia de outra conta.
 * Salvaguarda da devolução (o D0 não respondeu se o external id é o UID): o título + início só é do app quando o
 * `externalIdentifier` do achado é o mesmo que o app gravou (inclusive os dois `null`). Senão o achado é da conta
 * (`foreign`): o cartão diz "Já estava na agenda" e o app perde o `event`, sem nunca atualizar nem tirar esse evento.
 */
function classify(matches: readonly MacCalendarMatch[], ref: InviteEventRef | null): { app: MacCalendarMatch | null; other: MacCalendarMatch | null; foreign: MacCalendarMatch | null } {
  let app: MacCalendarMatch | null = null
  let foreign: MacCalendarMatch | null = null
  if (ref) {
    app = matches.find((item) => ID_MATCHES.includes(item.match)) ?? null
    if (!app) {
      const sameCalendar = matches.filter((item) => item.match === 'title-start' && item.calendarId === ref.calendarId)
      const candidate = sameCalendar.length === 1 ? (sameCalendar[0] ?? null) : null
      if (candidate && candidate.externalIdentifier === ref.externalIdentifier) app = candidate
      else foreign = candidate
    }
  }
  const other = matches.find((item) => item !== app && (item.match === 'uid' || item.match === 'title-start')) ?? null
  return { app, other, foreign }
}

interface Owner {
  ref: InviteEventRef
  /** A linha que guarda o `event` (a da ocorrência, ou a da série). */
  holder: InviteKey
  series: boolean
}

type Access = { ok: true } | { ok: false; code: InviteErrorCode }

type AddOutcome = { ok: true; effect: 'created' | 'already' } | { ok: false; code: InviteErrorCode }

// --- Serviço -----------------------------------------------------------------------------------------------------

export function createInviteService(deps: InviteServiceDeps): InviteService {
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => undefined)
  const store = deps.store ?? createInviteStore(deps.root, now, log)
  const cal = deps.calendar
  /** CA14: as chaves com `add`, `update` ou `remove` em andamento. */
  const busy = new Set<string>()
  let lastRefresh = -Infinity
  let lastReconcile = -Infinity
  let reconciling = false

  const say = (message: string): void => log(`[convites] ${message}`)
  const failLog = (operation: string, error: Pick<MacCalendarError, 'code' | 'reason'>): void => say(`${operation}: ${error.code}/${error.reason}`)

  const cleaned = cleanInviteIcs(deps.root)

  /** As duas escritas ao helper: só com o evento que o app gravou, e só pelos ids dele. */
  function updateEvent(ref: InviteEventRef, uid: string, args: Omit<MacCalendarUpdateArgs, 'ids'>) {
    return cal.update({ ids: idsOf(ref, uid), ...args })
  }
  function removeEvent(ref: InviteEventRef, uid: string, recurrenceId: string | null) {
    return cal.remove(recurrenceId === null ? { ids: idsOf(ref, uid), span: 'future' } : { ids: idsOf(ref, uid), recurrenceId, span: 'this' })
  }

  async function refreshAtMost(force: boolean): Promise<void> {
    if (!force && now() - lastRefresh < INVITE_REFRESH_MIN_MS) return
    lastRefresh = now()
    const result = await cal.refresh()
    if (!result.ok) failLog('refresh', result.error)
  }

  /** CA7: o REQUEST cria ou atualiza a linha (a versão nunca diminui); o CANCEL só atualiza a versão de uma linha que já existe. */
  async function remember(source: InviteSource, key: InviteKey): Promise<InviteRecord | null> {
    const { invite } = source
    if (invite.method === 'REPLY') return store.get(key)
    return store.update(key, (current) => {
      if (!current) return invite.method === 'REQUEST' ? { ...emptyRecord(key, invite, now()), messageId: source.messageId } : null
      const version = compareInviteVersion(invite, current) > 0 ? { sequence: invite.sequence, dtstamp: invite.dtstamp } : { sequence: current.sequence, dtstamp: current.dtstamp }
      return invite.method === 'REQUEST' ? { ...current, ...version, messageId: source.messageId, seenAt: now() } : { ...current, ...version }
    })
  }

  /** CA12: o dono do evento (a ocorrência com `event`, ou já tirada; senão a série); `null` sem evento do app. */
  async function ownerOf(key: InviteKey): Promise<Owner | null> {
    const row = await store.get(key)
    if (row?.event) return { ref: row.event, holder: key, series: false }
    if (key.recurrenceId === null || row?.removed) return null
    const series = await store.get(seriesKey(key))
    return series?.event ? { ref: series.event, holder: seriesKey(key), series: true } : null
  }

  /**
   * Grava os ids novos do evento do app achado, quando mudaram (N3). Quando o dono é a série e o achado é uma ocorrência,
   * nada é adotado: os ids de uma ocorrência destacada (o EventKit dá outro `eventIdentifier` a ela) na linha da série
   * fariam um `update` ou `remove` da série cair só naquela ocorrência.
   */
  async function adoptIds(owner: Owner, event: MacCalendarEvent): Promise<InviteEventRef> {
    if (owner.series || sameIds(owner.ref, event)) return owner.ref
    const next = withIds(owner.ref, event)
    await store.update(owner.holder, (current) => (current?.event ? { ...current, event: withIds(current.event, event) } : current))
    return next
  }

  /** As linhas de ocorrência do UID perdem o `event` (a série saiu ou passou para a conta). */
  async function dropOccurrenceEvents(accountId: string, uid: string): Promise<void> {
    for (const row of await store.list(accountId)) {
      if (row.uid !== uid || row.recurrenceId === null || !row.event) continue
      await store.update(row, (current) => (current ? { ...current, event: null } : current))
    }
  }

  /**
   * CA10 (R5c): a conta pôs a cópia dela (mesmo UID, outro item) ao lado do evento que o app criou. O app tira o
   * evento dele (o item inteiro) e passa a só mostrar a cópia; nunca toca nela.
   */
  async function reconcile(key: InviteKey, ref: InviteEventRef, app: MacCalendarMatch, matches: readonly MacCalendarMatch[]): Promise<MacCalendarMatch | null> {
    if (key.recurrenceId !== null || !ID_MATCHES.includes(app.match) || busy.has(keyText(key))) return null
    // A cópia é outro item; `eventIdentifier` igual (e não nulo) é o mesmo evento, e os dois `null` não dizem nada.
    const copy = matches.find((item) => item.match === 'uid' && item.calendarItemIdentifier !== app.calendarItemIdentifier && !(item.eventIdentifier !== null && item.eventIdentifier === app.eventIdentifier))
    if (!copy) return null
    busy.add(keyText(key))
    try {
      const removed = await removeEvent(withIds(ref, app), key.uid, null)
      if (!removed.ok && !(removed.error.code === 'not-found' && removed.error.reason !== 'calendar')) {
        failLog('juntar', removed.error)
        return null
      }
      await store.update(key, (current) => (current ? { ...current, event: null, merged: { calendarItemIdentifier: copy.calendarItemIdentifier, calendarTitle: copy.calendarTitle, sourceTitle: copy.sourceTitle }, mergedNotice: true } : current))
      await dropOccurrenceEvents(key.accountId, key.uid)
      say('juntou com a cópia da conta')
      return copy
    } finally {
      busy.delete(keyText(key))
    }
  }

  /** CA8 (2): o acesso como estado do cartão; `null` com acesso completo. */
  function accessStatus(outcome: Awaited<ReturnType<MacCalendar['status']>>): InviteCalendarStatus | null {
    if (!outcome.ok) {
      const { reason } = outcome.error
      if (outcome.error.code === 'unavailable' && isUnavailableReason(reason)) return { status: 'unavailable', reason }
      return { status: 'error', code: outcome.error.code === 'unavailable' ? 'failed' : errorCodeOf(outcome.error) }
    }
    const { access } = outcome.value
    if (access === 'full') return null
    if (access === 'notDetermined') return { status: 'needs-access' }
    return { status: 'no-access', access }
  }

  /** CA8 e CA9: registra o que foi visto, pergunta ao helper o que precisa e monta o estado. */
  async function compute(source: InviteSource, id: string): Promise<InviteState> {
    const { invite, account } = source
    const key = keyOf(source)
    const settings = await deps.settings()
    const before = invite.method === 'REPLY' ? null : await store.get(key)
    const old = before !== null && compareInviteVersion(invite, before) < 0
    let record = old ? before : await remember(source, key)
    let owner = old || invite.method === 'REPLY' ? null : await ownerOf(key)
    let calendar: InviteCalendarStatus = { status: 'skipped' }
    let defaultCalendarId: string | null = null
    let ref: InviteEventRef | null = null
    if (!(invite.method === 'REPLY' || old || (invite.method === 'CANCEL' && !owner))) {
      const status = await cal.status()
      const denied = accessStatus(status)
      if (denied) calendar = denied
      else {
        const calendars = await cal.calendars()
        const list: MacCalendarCalendar[] = calendars.ok ? calendars.value.calendars : []
        if (!calendars.ok) failLog('agendas', calendars.error)
        defaultCalendarId = defaultCalendarOf(list, settings.inviteCalendarId)
        await refreshAtMost(false)
        const found = await cal.find(findArgs(invite, invite.uid, owner?.ref ?? null))
        if (!found.ok) {
          failLog('procurar', found.error)
          calendar = { status: 'error', code: errorCodeOf(found.error) === 'unavailable' ? 'failed' : errorCodeOf(found.error) }
        } else {
          const { app, other, foreign } = classify(found.value.matches, owner?.ref ?? null)
          if (owner && !app && foreign) {
            // Salvaguarda: título + início com outro external id não é do app; ele larga o `event` (a série fica).
            if (!owner.series) await store.update(owner.holder, (current) => (current ? { ...current, event: null } : current))
            owner = null
            calendar = { status: 'account', calendarTitle: foreign.calendarTitle, sourceTitle: foreign.sourceTitle, merged: false }
          } else if (owner && app) {
            const current = await adoptIds(owner, app)
            const merged = owner.series ? null : await reconcile(key, current, app, found.value.matches)
            if (merged) {
              owner = null
              calendar = { status: 'account', calendarTitle: merged.calendarTitle, sourceTitle: merged.sourceTitle, merged: true }
            } else {
              // Numa ocorrência da série, o "antes" do horário é o da ocorrência na agenda, não o do começo da série.
              ref = owner.series ? { ...current, start: app.start, end: app.end, allDay: app.allDay } : current
              calendar = { status: 'app', calendarId: app.calendarId, calendarTitle: app.calendarTitle, sourceTitle: app.sourceTitle }
            }
          } else if (owner) {
            const known = list.find((item) => item.id === owner?.ref.calendarId) ?? null
            calendar = { status: 'missing', calendarId: owner.ref.calendarId, calendarTitle: known?.title ?? null, sourceTitle: known?.sourceTitle ?? null }
          } else if (other) {
            record = await store.get(key)
            calendar = { status: 'account', calendarTitle: other.calendarTitle, sourceTitle: other.sourceTitle, merged: record?.merged != null }
          } else calendar = { status: 'absent' }
        }
      }
    }
    // R5c: o aviso "Juntei…" sai uma vez, na primeira leitura depois de juntar (aqui ou na reconciliação de fundo).
    let notice: 'merged' | null = null
    if (invite.method !== 'REPLY' && !old) {
      record = await store.get(key)
      if (record?.mergedNotice) {
        notice = 'merged'
        record = await store.update(key, (current) => (current ? { ...current, mergedNotice: false } : current))
      }
    }
    return buildState({ accountId: account.id, id, account, invite, record, ref, old, calendar, defaultCalendarId, addOnAccept: settings.inviteAddOnAccept, notice })
  }

  /** CA11 (2): o acesso para gravar; `notDetermined` só pede com `mayAskAccess` (o IPC; as regras nunca). */
  async function ensureAccess(mayAskAccess: boolean): Promise<Access> {
    const status = await cal.status()
    if (!status.ok) {
      failLog('status', status.error)
      return { ok: false, code: errorCodeOf(status.error) }
    }
    let access = status.value.access
    if (access === 'notDetermined') {
      if (!mayAskAccess) return { ok: false, code: 'denied' }
      const asked = await cal.requestAccess()
      if (!asked.ok) {
        failLog('pedir acesso', asked.error)
        return { ok: false, code: errorCodeOf(asked.error) }
      }
      access = asked.value.access
    }
    if (access === 'full') return { ok: true }
    return { ok: false, code: access === 'restricted' ? 'restricted' : 'denied' }
  }

  /** CA11 (3): a agenda pedida existe e aceita eventos. */
  async function checkCalendar(calendarId: string): Promise<{ ok: true; calendar: MacCalendarCalendar } | { ok: false; code: InviteErrorCode }> {
    const calendars = await cal.calendars()
    if (!calendars.ok) {
      failLog('agendas', calendars.error)
      return { ok: false, code: errorCodeOf(calendars.error) }
    }
    const calendar = calendars.value.calendars.find((item) => item.id === calendarId)
    if (!calendar) return { ok: false, code: 'no-calendar' }
    if (!calendar.writable) return { ok: false, code: 'read-only-calendar' }
    return { ok: true, calendar }
  }

  /** CA11: "Pôr na agenda" (o IPC, com `mayAskAccess`, e as regras do 64, sem). A trava do CA14 é de quem chama. */
  async function addFor(source: InviteSource, options: { calendarId: string; availability: 'busy' | 'tentative'; mayAskAccess: boolean }): Promise<AddOutcome> {
    const { invite } = source
    const key = keyOf(source)
    if (invite.method !== 'REQUEST') return { ok: false, code: 'not-request' }
    const before = await store.get(key)
    if (before && compareInviteVersion(invite, before) < 0) return { ok: false, code: 'old' }
    if (recurrenceBlocked(invite)) return { ok: false, code: 'recurrence' }
    await remember(source, key)
    const access = await ensureAccess(options.mayAskAccess)
    if (!access.ok) return access
    const checked = await checkCalendar(options.calendarId)
    if (!checked.ok) return checked
    await refreshAtMost(true)
    const owner = await ownerOf(key)
    const found = await cal.find(findArgs(invite, invite.uid, owner?.ref ?? null))
    if (!found.ok) {
      failLog('procurar', found.error)
      return { ok: false, code: errorCodeOf(found.error) }
    }
    const { app, other } = classify(found.value.matches, owner?.ref ?? null)
    if (owner && app) {
      await adoptIds(owner, app)
      return { ok: true, effect: 'already' }
    }
    if (other) {
      // R5a: já está na agenda (a conta pôs, ou outra cópia): não cria e o app não ganha direito sobre ela.
      await store.update(key, (current) => (current ? { ...current, event: null } : current))
      return { ok: true, effect: 'already' }
    }
    const created = await cal.create(createArgs(invite, options.calendarId, options.availability))
    const base = { calendarId: options.calendarId, availability: options.availability, occurrence: null, ...refFields(invite) }
    if (!created.ok) {
      failLog('criar', created.error)
      const saved = created.error.saved
      if (saved) {
        // O helper salvou e falhou depois (60): o evento é do app, com os ids que ele mandou.
        await store.update(key, (current) => ({ ...(current ?? emptyRecord(key, invite, now())), event: { ...base, ...saved }, removed: false }))
        return { ok: false, code: 'failed' }
      }
      // `timeout`/`exited` viram `failed` sem repetir e sem adotar nada (E5): se ficou gravado, o próximo `find` acha.
      return { ok: false, code: errorCodeOf(created.error) }
    }
    const event = created.value.event
    const ref: InviteEventRef = { ...base, calendarId: event.calendarId, eventIdentifier: event.eventIdentifier, calendarItemIdentifier: event.calendarItemIdentifier, externalIdentifier: event.externalIdentifier }
    await store.update(key, (current) => ({ ...(current ?? { ...emptyRecord(key, invite, now()), messageId: source.messageId }), event: ref, merged: null, mergedNotice: false, removed: false }))
    // CA11 (7): as ocorrências que o organizador mudou de horário, uma a uma; falha só no log.
    if (recurrenceOf(invite)) {
      let failed = 0
      let lastCode = ''
      for (const exception of invite.exceptions.filter((item) => !item.cancelled)) {
        const moved = await updateEvent(ref, invite.uid, { recurrenceId: normalizeWhen(exception.recurrenceId), span: 'this', fields: { start: exception.start, end: exception.end } })
        if (!moved.ok) {
          failed++
          lastCode = `${moved.error.code}/${moved.error.reason}`
        }
      }
      if (failed) say(`criar: ${failed} exceção(ões) da série não mudaram (${lastCode})`)
    }
    return { ok: true, effect: 'created' }
  }

  async function load(request: unknown, schema: typeof messageRequestSchema | typeof addRequestSchema): Promise<{ ok: true; source: InviteSource; id: string } | { ok: false; error: 'invalid' | 'missing' }> {
    const parsed = schema.safeParse(request)
    if (!parsed.success) return { ok: false, error: 'invalid' }
    const source = await deps.source(parsed.data.accountId, parsed.data.id)
    if (!source || source.account.id !== parsed.data.accountId) return { ok: false, error: 'missing' }
    return { ok: true, source, id: parsed.data.id }
  }

  const failure = (code: InviteErrorCode, state: InviteState | null): InviteActionResult => ({ ok: false, error: code, message: INVITE_ERROR_MESSAGES[code], state })
  const stateOrNull = (source: InviteSource, id: string): Promise<InviteState | null> => compute(source, id).catch(() => null)

  /**
   * O estado depois de uma escrita que deu certo: a agenda já mudou, então a resposta é `ok` mesmo se o `compute` falhar.
   * Tenta duas vezes; falhando as duas, um estado mínimo: o convite e a linha do registro como estão, com
   * `calendar: skipped` (nada foi perguntado ao helper), o que deixa as ações da agenda desligadas até a próxima leitura.
   */
  async function stateAfterWrite(source: InviteSource, id: string): Promise<InviteState> {
    const first = await stateOrNull(source, id)
    if (first) return first
    const second = await stateOrNull(source, id)
    if (second) return second
    say('estado depois de gravar: falhou duas vezes, estado mínimo')
    const record = await store.get(keyOf(source)).catch(() => null)
    const addOnAccept = await Promise.resolve()
      .then(() => deps.settings())
      .then((settings) => settings.inviteAddOnAccept)
      .catch(() => DEFAULT_SETTINGS.inviteAddOnAccept)
    return buildState({ accountId: source.account.id, id, account: source.account, invite: source.invite, record, ref: null, old: false, calendar: { status: 'skipped' }, defaultCalendarId: null, addOnAccept, notice: null })
  }

  /** Roda `task` com a trava da chave (CA14): outro pedido para a mesma chave volta `busy` na hora. */
  async function locked<T>(key: InviteKey, onBusy: () => T, task: () => Promise<T>): Promise<T> {
    const text = keyText(key)
    if (busy.has(text)) return onBusy()
    busy.add(text)
    try {
      return await task()
    } finally {
      busy.delete(text)
    }
  }

  /** CA12: o evento do app na agenda antes de escrever (como no CA8, passo 4). */
  async function locate(invite: EmailInvite, owner: Owner): Promise<{ ok: true; ref: InviteEventRef } | { ok: false; code: InviteErrorCode }> {
    const access = await ensureAccess(false)
    if (!access.ok) return access
    const found = await cal.find(findArgs(invite, invite.uid, owner.ref))
    if (!found.ok) {
      failLog('procurar', found.error)
      return { ok: false, code: errorCodeOf(found.error) }
    }
    const { app } = classify(found.value.matches, owner.ref)
    if (!app) return { ok: false, code: 'not-found' }
    return { ok: true, ref: await adoptIds(owner, app) }
  }

  return {
    async state(request) {
      const loaded = await load(request, messageRequestSchema)
      if (!loaded.ok) return loaded
      return { ok: true, state: await compute(loaded.source, loaded.id) }
    },

    async add(request) {
      const loaded = await load(request, addRequestSchema)
      if (!loaded.ok) return failure(loaded.error, null)
      const { source, id } = loaded
      const { calendarId, availability } = addRequestSchema.parse(request)
      const outcome = await locked<AddOutcome | 'busy'>(keyOf(source), () => 'busy', () => addFor(source, { calendarId, availability, mayAskAccess: true }))
      if (outcome === 'busy') return failure('busy', null)
      if (!outcome.ok) return failure(outcome.code, await stateOrNull(source, id))
      say(`pôr na agenda: ${outcome.effect}`)
      return { ok: true, effect: outcome.effect, state: await stateAfterWrite(source, id) }
    },

    async update(request) {
      const loaded = await load(request, messageRequestSchema)
      if (!loaded.ok) return failure(loaded.error, null)
      const { source, id } = loaded
      const { invite } = source
      const key = keyOf(source)
      const outcome = await locked<{ ok: true; effect: InviteEffect } | { ok: false; code: InviteErrorCode } | 'busy'>(
        key,
        () => 'busy',
        async () => {
          if (invite.method !== 'REQUEST') return { ok: false, code: 'invalid' }
          const row = await store.get(key)
          if (row && compareInviteVersion(invite, row) < 0) return { ok: false, code: 'old' }
          const owner = await ownerOf(key)
          if (!owner) return { ok: false, code: 'not-owned' }
          if (compareInviteVersion(invite, owner.ref) <= 0) return { ok: false, code: 'old' }
          if (recurrenceBlocked(invite)) return { ok: false, code: 'recurrence' }
          const located = await locate(invite, owner)
          if (!located.ok) return located
          const recurrenceId = key.recurrenceId
          const result = await updateEvent(located.ref, invite.uid, { ...(recurrenceId !== null ? { recurrenceId } : {}), span: recurrenceId !== null ? 'this' : 'future', fields: updateFields(invite, located.ref) })
          const next = (ids: Pick<MacCalendarEvent, 'eventIdentifier' | 'calendarItemIdentifier' | 'externalIdentifier'>, calendarId: string): InviteEventRef => ({
            ...withIds(located.ref, ids),
            ...refFields(invite),
            calendarId,
            occurrence: recurrenceId,
          })
          const write = (ref: InviteEventRef) => store.update(key, (current) => ({ ...(current ?? { ...emptyRecord(key, invite, now()), messageId: source.messageId }), event: ref, removed: false }))
          if (!result.ok) {
            failLog('atualizar', result.error)
            if (result.error.saved) {
              await write(next(result.error.saved, located.ref.calendarId))
              return { ok: false, code: 'failed' }
            }
            return { ok: false, code: errorCodeOf(result.error) }
          }
          await write(next(result.value.event, result.value.event.calendarId))
          return { ok: true, effect: 'updated' }
        },
      )
      if (outcome === 'busy') return failure('busy', null)
      if (!outcome.ok) return failure(outcome.code, await stateOrNull(source, id))
      say(`atualizar na agenda: ${outcome.effect}`)
      return { ok: true, effect: outcome.effect, state: await stateAfterWrite(source, id) }
    },

    async remove(request) {
      const loaded = await load(request, messageRequestSchema)
      if (!loaded.ok) return failure(loaded.error, null)
      const { source, id } = loaded
      const { invite } = source
      const key = keyOf(source)
      const outcome = await locked<{ ok: true; effect: InviteEffect } | { ok: false; code: InviteErrorCode } | 'busy'>(
        key,
        () => 'busy',
        async () => {
          if (invite.method === 'REPLY') return { ok: false, code: 'invalid' }
          const row = await store.get(key)
          if (row && compareInviteVersion(invite, row) < 0) return { ok: false, code: 'old' }
          const owner = await ownerOf(key)
          if (!owner) return { ok: false, code: 'not-owned' }
          const located = await locate(invite, owner)
          if (!located.ok) return located
          const result = await removeEvent(located.ref, invite.uid, key.recurrenceId)
          if (!result.ok && !(result.error.code === 'not-found' && result.error.reason !== 'calendar')) {
            failLog('tirar', result.error)
            return { ok: false, code: errorCodeOf(result.error) }
          }
          if (key.recurrenceId !== null) {
            // Só aquela ocorrência saiu (N8): a linha dela fica, marcada, para o botão não voltar; a série não muda.
            await store.update(key, (current) => ({ ...(current ?? { ...emptyRecord(key, invite, now()), messageId: source.messageId }), event: null, removed: true }))
          } else if (invite.method === 'CANCEL') {
            await store.removeUid(key.accountId, key.uid)
          } else {
            // "Recusar" (R4): o evento sai e a resposta gravada pelo `recordReply` continua.
            await store.update(key, (current) => (current ? { ...current, event: null } : current))
            await dropOccurrenceEvents(key.accountId, key.uid)
          }
          return { ok: true, effect: 'removed' }
        },
      )
      if (outcome === 'busy') return failure('busy', null)
      if (!outcome.ok) return failure(outcome.code, await stateOrNull(source, id))
      say(`tirar da agenda: ${outcome.effect}`)
      return { ok: true, effect: outcome.effect, state: await stateAfterWrite(source, id) }
    },

    async calendars() {
      const status = await cal.status()
      if (!status.ok) return { ok: false, error: 'unavailable', reason: status.error.reason }
      const { access } = status.value
      if (access !== 'full') return { ok: true, access, calendars: [], defaultId: null }
      const listed = await cal.calendars()
      if (!listed.ok) return { ok: false, error: 'unavailable', reason: listed.error.reason }
      const writable = listed.value.calendars.filter((item) => item.writable)
      const settings = await deps.settings()
      return { ok: true, access, calendars: writable.map(calendarOption), defaultId: defaultCalendarOf(writable, settings.inviteCalendarId) }
    },

    async requestAccess() {
      const asked = await cal.requestAccess()
      if (!asked.ok) return { ok: false, error: 'unavailable', reason: asked.error.reason }
      return { ok: true, access: asked.value.access, granted: asked.value.granted }
    },

    async openIcs(request) {
      const loaded = await load(request, messageRequestSchema)
      if (!loaded.ok) return { ok: false, error: loaded.error }
      if (loaded.source.invite.method !== 'REQUEST') return { ok: false, error: 'invalid' }
      let file: string | null = null
      try {
        await cleaned
        file = await writeInviteIcs(deps.root, loaded.source.invite.source)
        const error = await deps.openPath(file)
        if (!error) return { ok: true }
      } catch {
        // cai na falha abaixo
      }
      if (file) await rm(file, { force: true }).catch(() => undefined)
      say('abrir no app de agenda: falhou')
      return { ok: false, error: 'failed' }
    },

    async recordReply(event) {
      const parsed = repliedSchema.safeParse(event)
      if (!parsed.success) {
        say('resposta de convite: aviso inválido')
        return
      }
      const reply = parsed.data
      const key: InviteKey = { accountId: reply.accountId, uid: reply.uid, recurrenceId: reply.recurrenceId === null ? null : normalizeWhen(reply.recurrenceId) }
      await store.update(key, (current) => {
        const base = current ?? emptyRecord(key, reply, now())
        const version = compareInviteVersion(reply, base) > 0 ? { sequence: reply.sequence, dtstamp: reply.dtstamp } : {}
        return { ...base, ...version, response: reply.partstat, respondedAt: reply.respondedAt, messageId: reply.messageId }
      })
    },

    async reconcileAll() {
      if (reconciling || now() - lastReconcile < INVITE_RECONCILE_MIN_MS) return
      lastReconcile = now()
      reconciling = true
      try {
        const at = now()
        const rows = (await store.list())
          .filter((row) => {
            const start = Date.parse(row.event?.start ?? '')
            return row.event !== null && row.recurrenceId === null && Number.isFinite(start) && start >= at - RECONCILE_BEFORE_MS && start <= at + RECONCILE_AFTER_MS
          })
          .slice(0, INVITE_RECONCILE_BATCH)
        if (!rows.length) return
        const status = await cal.status()
        if (!status.ok || status.value.access !== 'full') return
        await refreshAtMost(false)
        let merged = 0
        for (const row of rows) {
          const ref = row.event
          if (!ref || busy.has(keyText(row))) continue
          const found = await cal.find({ uid: row.uid, title: ref.title || '(sem título)', start: ref.start, end: ref.end, allDay: ref.allDay, ids: idsOf(ref, row.uid) })
          if (!found.ok) {
            failLog('juntar', found.error)
            continue
          }
          const { app } = classify(found.value.matches, ref)
          if (!app) continue
          const current = await adoptIds({ ref, holder: row, series: false }, app)
          if (await reconcile(row, current, app, found.value.matches)) merged++
        }
        if (merged) say(`juntar: ${merged} evento(s)`)
      } catch {
        say('juntar: falhou')
      } finally {
        reconciling = false
      }
    },

    async addFromRule(source) {
      const { invite } = source
      const key = keyOf(source)
      if (invite.method !== 'REQUEST' || recurrenceBlocked(invite)) return { ok: true, effect: 'none' }
      const row = await store.get(key)
      if (row && compareInviteVersion(invite, row) < 0) return { ok: true, effect: 'none' }
      // D8: versão nova de um evento do app só muda no clique "Atualizar na agenda".
      if (row?.event && compareInviteVersion(invite, row.event) > 0) return { ok: true, effect: 'none' }
      const calendarId = (await deps.settings()).inviteCalendarId
      if (calendarId === null) return { ok: false, error: 'no-calendar' }
      const outcome = await locked<AddOutcome | 'busy'>(key, () => 'busy', () => addFor(source, { calendarId, availability: 'busy', mayAskAccess: false }))
      if (outcome === 'busy') {
        say('regras: pôr na agenda ignorado (busy)')
        return { ok: true, effect: 'none' }
      }
      if (outcome.ok) return { ok: true, effect: outcome.effect }
      if (outcome.code === 'not-request' || outcome.code === 'old' || outcome.code === 'recurrence') return { ok: true, effect: 'none' }
      return { ok: false, error: outcome.code === 'denied' || outcome.code === 'restricted' ? 'calendar-denied' : 'no-calendar' }
    },

    async addEvent(request) {
      const parsed = eventAddRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid', message: INVITE_ERROR_MESSAGES.invalid }
      const { accountId, messageId, args } = parsed.data
      const key: InviteKey = { accountId, uid: parsed.data.key, recurrenceId: null }
      const version = { sequence: 0, dtstamp: null }
      const outcome = await locked<InviteEventAddResult>(
        key,
        () => ({ ok: false, error: 'busy', message: INVITE_ERROR_MESSAGES.busy }),
        async () => {
          const fail = (code: InviteErrorCode): InviteEventAddResult => ({ ok: false, error: code, message: INVITE_ERROR_MESSAGES[code] })
          const access = await ensureAccess(true)
          if (!access.ok) return fail(access.code)
          const checked = await checkCalendar(args.calendarId)
          if (!checked.ok) return fail(checked.code)
          await refreshAtMost(true)
          const row = await store.get(key)
          const ref = row?.event ?? null
          const found = await cal.find({ uid: key.uid, title: args.title, start: args.start, end: args.end, allDay: args.allDay, ...(ref ? { ids: idsOf(ref, key.uid) } : {}) })
          if (!found.ok) {
            failLog('procurar', found.error)
            return fail(errorCodeOf(found.error))
          }
          const { app, other } = classify(found.value.matches, ref)
          if (ref && app) await adoptIds({ ref, holder: key, series: false }, app)
          const already = app ?? other ?? found.value.matches[0] ?? null
          if (already) {
            if (!row) await store.update(key, (current) => current ?? { ...emptyRecord(key, version, now()), messageId })
            return { ok: true, effect: 'already', calendarTitle: already.calendarTitle, sourceTitle: already.sourceTitle }
          }
          const created = await cal.create(args)
          const base = {
            calendarId: args.calendarId,
            title: args.title,
            start: normalizeWhen(args.start),
            end: normalizeWhen(args.end),
            allDay: args.allDay,
            timeZone: args.allDay ? null : args.timeZone,
            location: args.location ?? null,
            url: args.url ?? null,
            availability: args.availability,
            occurrence: null,
            ...version,
          }
          const write = (event: InviteEventRef) => store.update(key, (current) => ({ ...(current ?? { ...emptyRecord(key, version, now()), messageId }), event, removed: false }))
          if (!created.ok) {
            failLog('criar sugestão', created.error)
            if (created.error.saved) {
              await write({ ...base, ...created.error.saved })
              return fail('failed')
            }
            return fail(errorCodeOf(created.error))
          }
          const event = created.value.event
          await write({ ...base, calendarId: event.calendarId, eventIdentifier: event.eventIdentifier, calendarItemIdentifier: event.calendarItemIdentifier, externalIdentifier: event.externalIdentifier })
          return { ok: true, effect: 'created', calendarTitle: event.calendarTitle || checked.calendar.title, sourceTitle: event.sourceTitle || checked.calendar.sourceTitle }
        },
      )
      if (!outcome.ok) say(`sugestão: ${outcome.error}`)
      return outcome
    },

    async calendarPresent() {
      const status = await cal.status()
      return status.ok || !(status.error.code === 'unavailable' && isUnavailableReason(status.error.reason))
    },

    async forgetAccount(accountId) {
      await store.forgetAccount(accountId).catch(() => undefined)
    },

    async dispose() {
      await cleanInviteIcs(deps.root)
    },
  }
}
