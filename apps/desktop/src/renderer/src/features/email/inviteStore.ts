// Convites no renderer (contrato 63): o `InviteState` de cada mensagem aberta (`scribe:invite-state`, do 62), as agendas
// graváveis (`scribe:invite-calendars`), a caixa "Pôr na agenda" e a agenda escolhida em cada cartão (só na memória:
// nada vai para as configurações), a trava do "Enviando" e o último efeito de cada convite. Responder passa só por
// `__scribeApi.inviteReply`, que gera o token de clique (61); a agenda muda depois, e só se o REPLY saiu (CA7).
import { create } from 'zustand'
import { INVITE_ERROR_MESSAGES, type InviteActionResult, type InviteCalendarsResult, type InviteEffect, type InviteState } from '@shared/invite-state'
import { bodyKey } from './emailStore'
import { INVITE_REPLY_ERRORS, type ReplyPartstat } from './inviteFormat'
import { afterReply, availabilityFor } from './inviteView'

/** O que está em andamento num cartão, fora o REPLY ("Atualizando…", "Pondo na agenda…"). */
export type InviteBusy = 'add' | 'update' | 'remove' | 'open-ics'

interface InviteStoreState {
  /** Por `bodyKey(conta, id)`; `null`: a leitura falhou (CA1). */
  states: Record<string, InviteState | null>
  /** `null` até a primeira leitura. */
  calendars: InviteCalendarsResult | null
  /** A caixa "Pôr na agenda" de cada cartão, quando a pessoa mexeu. */
  addChecked: Record<string, boolean>
  /** A agenda escolhida em cada cartão (CA6: não vira a padrão). */
  calendarChoice: Record<string, string>
  /** CA9: a resposta saindo, por mensagem. */
  sending: Record<string, ReplyPartstat>
  busy: Record<string, InviteBusy>
  /** A frase do último erro do cartão. */
  errors: Record<string, string>
  /** CA12: o último efeito de cada mensagem, com a agenda de antes ("Tirado da agenda Trabalho."). */
  effects: Record<string, { effect: InviteEffect; calendarTitle: string | null }>
  /** `clearError`: ao abrir a mensagem (ou quando o estado muda por fora), a frase do erro anterior sai. */
  load: (accountId: string, id: string, options?: { clearError?: boolean }) => Promise<void>
  loadCalendars: () => Promise<void>
  setAdd: (accountId: string, id: string, checked: boolean) => void
  chooseCalendar: (accountId: string, id: string, calendarId: string) => void
  /** CA7: o REPLY e, se ele saiu, o `-add` ou o `-remove`. A agenda e a caixa vêm do cartão. */
  reply: (accountId: string, id: string, partstat: ReplyPartstat, choice: { addChecked: boolean; calendarId: string | null }) => Promise<void>
  /** "Pôr na agenda" sem REPLY (CA14) e "Pôr de novo" (CA16). */
  add: (accountId: string, id: string, calendarId: string | null, availability: 'busy' | 'tentative') => Promise<void>
  update: (accountId: string, id: string) => Promise<void>
  remove: (accountId: string, id: string) => Promise<void>
  openIcs: (accountId: string, id: string) => Promise<void>
}

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([other]) => other !== key))

/** "A resposta foi enviada, mas a agenda não mudou." + a frase do 62 (CA7). */
const AFTER_REPLY_FAILED = 'A resposta foi enviada, mas a agenda não mudou.'

export const useInvites = create<InviteStoreState>()((set, get) => {
  const putError = (key: string, message: string | null): void => set((state) => ({ errors: message === null ? without(state.errors, key) : { ...state.errors, [key]: message } }))

  /** Uma ação de agenda (62): a frase fixa no erro e o estado novo que vier junto. */
  const act = async (key: string, call: () => Promise<InviteActionResult>): Promise<InviteActionResult> => {
    const result = await call().catch((): InviteActionResult => ({ ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed, state: null }))
    const next = result.state
    if (next) set((state) => ({ states: { ...state.states, [key]: next } }))
    return result
  }

  /**
   * A agenda do `-add`: a escolhida no cartão, senão a padrão do estado ou da lista. Sem nenhuma (o acesso ainda não foi
   * pedido, R8), pede o acesso e relê as agendas antes; negado ou restrito, a frase do 62 para isso.
   */
  const calendarFor = async (key: string, chosen: string | null): Promise<{ id: string } | { error: string }> => {
    const listed = get().calendars
    const picked = chosen ?? get().calendarChoice[key] ?? get().states[key]?.defaultCalendarId ?? (listed?.ok ? listed.defaultId : null)
    if (picked) return { id: picked }
    if (get().states[key]?.actions.requestAccess) {
      const asked = await window.__scribeApi.invoke('scribe:invite-request-access').catch(() => null)
      await get().loadCalendars()
      if (asked?.ok && (asked.access === 'denied' || asked.access === 'restricted')) return { error: INVITE_ERROR_MESSAGES[asked.access] }
      if (asked?.ok && asked.access === 'writeOnly') return { error: INVITE_ERROR_MESSAGES.denied }
      const calendars = get().calendars
      if (calendars?.ok && calendars.defaultId) return { id: calendars.defaultId }
    }
    return { error: INVITE_ERROR_MESSAGES['no-calendar'] }
  }

  /** `-add` com a agenda e a disponibilidade; devolve a frase do erro, ou `null`. */
  const addTo = async (accountId: string, id: string, chosen: string | null, availability: 'busy' | 'tentative'): Promise<string | null> => {
    const key = bodyKey(accountId, id)
    const target = await calendarFor(key, chosen)
    if ('error' in target) return target.error
    const result = await act(key, () => window.__scribeApi.invoke('scribe:invite-add', { accountId, id, calendarId: target.id, availability }))
    if (result.ok) set((state) => ({ effects: { ...state.effects, [key]: { effect: result.effect, calendarTitle: null } } }))
    return result.ok ? null : result.message
  }

  /**
   * A lista de agendas guardada vale enquanto o acesso não muda: um estado que já lê a agenda (o acesso foi dado), com a
   * lista guardada sem acesso ou vazia, relê.
   */
  const refreshCalendars = (next: InviteState | null): void => {
    const listed = get().calendars
    if (!next || listed === null) return
    const readable = ['absent', 'app', 'account', 'missing'].includes(next.calendar.status)
    const stale = !listed.ok || listed.access !== 'full' || listed.calendars.length === 0
    if (readable && stale) void get().loadCalendars()
  }

  return {
    states: {},
    calendars: null,
    addChecked: {},
    calendarChoice: {},
    sending: {},
    busy: {},
    errors: {},
    effects: {},

    load: async (accountId, id, options = {}) => {
      const key = bodyKey(accountId, id)
      if (options.clearError) putError(key, null)
      let next: InviteState | null = null
      try {
        const result = await window.__scribeApi.invoke('scribe:invite-state', { accountId, id })
        next = result.ok ? result.state : null
      } catch {
        next = null
      }
      set((state) => ({ states: { ...state.states, [key]: next } }))
      refreshCalendars(next)
    },

    loadCalendars: async () => {
      try {
        const calendars = await window.__scribeApi.invoke('scribe:invite-calendars')
        set({ calendars })
      } catch {
        // Bloqueado: a lista fica como estava.
      }
    },

    setAdd: (accountId, id, checked) => set((state) => ({ addChecked: { ...state.addChecked, [bodyKey(accountId, id)]: checked } })),
    chooseCalendar: (accountId, id, calendarId) => set((state) => ({ calendarChoice: { ...state.calendarChoice, [bodyKey(accountId, id)]: calendarId } })),

    reply: async (accountId, id, partstat, choice) => {
      const key = bodyKey(accountId, id)
      // CA9: um clique por vez. A trava liga antes do preload; a do main (`busy`) é a palavra final.
      if (get().sending[key]) return
      const before = get().states[key] ?? null
      set((state) => ({ sending: { ...state.sending, [key]: partstat }, errors: without(state.errors, key) }))
      try {
        const result = await window.__scribeApi.inviteReply({ accountId, id, partstat }).catch(() => ({ ok: false as const, error: 'failed' as const }))
        if (!result.ok) {
          putError(key, INVITE_REPLY_ERRORS[result.error])
          return
        }
        const step = afterReply(before, partstat, choice.addChecked)
        let failed: string | null = null
        if (step === 'add') failed = await addTo(accountId, id, choice.calendarId, availabilityFor(partstat))
        else if (step === 'remove') {
          const calendarTitle = before?.calendar.status === 'app' ? before.calendar.calendarTitle : null
          const removed = await act(key, () => window.__scribeApi.invoke('scribe:invite-remove', { accountId, id }))
          if (removed.ok) set((state) => ({ effects: { ...state.effects, [key]: { effect: removed.effect, calendarTitle } } }))
          else failed = removed.message
        }
        if (failed) putError(key, `${AFTER_REPLY_FAILED} ${failed}`)
        await get().load(accountId, id)
      } finally {
        set((state) => ({ sending: without(state.sending, key) }))
      }
    },

    add: async (accountId, id, calendarId, availability) => {
      const key = bodyKey(accountId, id)
      if (get().busy[key] || get().sending[key]) return
      set((state) => ({ busy: { ...state.busy, [key]: 'add' }, errors: without(state.errors, key) }))
      try {
        const failed = await addTo(accountId, id, calendarId, availability)
        if (failed) putError(key, failed)
        await get().load(accountId, id)
      } finally {
        set((state) => ({ busy: without(state.busy, key) }))
      }
    },

    update: async (accountId, id) => {
      const key = bodyKey(accountId, id)
      if (get().busy[key] || get().sending[key]) return
      set((state) => ({ busy: { ...state.busy, [key]: 'update' }, errors: without(state.errors, key) }))
      try {
        const result = await act(key, () => window.__scribeApi.invoke('scribe:invite-update', { accountId, id }))
        if (!result.ok) putError(key, result.message)
        else set((state) => ({ effects: { ...state.effects, [key]: { effect: result.effect, calendarTitle: null } } }))
        await get().load(accountId, id)
      } finally {
        set((state) => ({ busy: without(state.busy, key) }))
      }
    },

    remove: async (accountId, id) => {
      const key = bodyKey(accountId, id)
      if (get().busy[key] || get().sending[key]) return
      const before = get().states[key]
      const calendarTitle = before?.calendar.status === 'app' ? before.calendar.calendarTitle : null
      set((state) => ({ busy: { ...state.busy, [key]: 'remove' }, errors: without(state.errors, key) }))
      try {
        const result = await act(key, () => window.__scribeApi.invoke('scribe:invite-remove', { accountId, id }))
        if (!result.ok) putError(key, result.message)
        else set((state) => ({ effects: { ...state.effects, [key]: { effect: result.effect, calendarTitle } } }))
        await get().load(accountId, id)
      } finally {
        set((state) => ({ busy: without(state.busy, key) }))
      }
    },

    openIcs: async (accountId, id) => {
      const key = bodyKey(accountId, id)
      if (get().busy[key]) return
      set((state) => ({ busy: { ...state.busy, [key]: 'open-ics' }, errors: without(state.errors, key) }))
      try {
        const result = await window.__scribeApi.invoke('scribe:invite-open-ics', { accountId, id }).catch(() => ({ ok: false as const, error: 'failed' as const }))
        if (!result.ok) putError(key, result.error === 'failed' ? INVITE_ERROR_MESSAGES.failed : INVITE_ERROR_MESSAGES.missing)
      } finally {
        set((state) => ({ busy: without(state.busy, key) }))
      }
    },
  }
})
