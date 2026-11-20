import { CalendarCheck, CalendarPlus, Info, Settings, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { safeJoinUrl } from '@shared/calendar'
import { INVITE_ERROR_MESSAGES, type InviteEventAddResult } from '@shared/invite-state'
import {
  INVITE_SUGGEST_DEFAULT_DURATION,
  INVITE_SUGGEST_DURATION_MAX,
  INVITE_SUGGEST_DURATION_MIN,
  INVITE_SUGGEST_ERRORS,
  INVITE_SUGGEST_TITLE_MAX,
  type InviteSuggestion,
} from '@shared/invite-suggest'
import { useLock } from '../../app/lockStore'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { CalendarPicker } from './CalendarPicker'
import { InviteCardShell, InviteNote, InviteStatusLine } from './InviteCard'
import { joinLabel } from './inviteFormat'
import { useInvites } from './inviteStore'
import { suggestTarget } from './suggestTarget'

/** O "Sugerir evento" de uma mensagem: nada, "Sugerindo…", o erro ou a sugestão (só na memória, nunca em disco). */
export type InviteSuggestView = { phase: 'loading' } | { phase: 'error'; text: string } | { phase: 'ready'; suggestion: InviteSuggestion }

/**
 * Contrato 64 (CA14): o estado do "Sugerir evento" da mensagem aberta. A leitura monta de novo a cada mensagem (`key`
 * do `ReadingPane`), então trocar de mensagem durante o "Sugerindo…" descarta a resposta que chegar depois, e reabrir o
 * email volta ao botão. O pedido sai no próprio clique (o preload confere a ativação e gera o token).
 */
export function useInviteSuggest(accountId: string, id: string): { view: InviteSuggestView | null; start: () => void; discard: () => void } {
  const [view, setView] = useState<InviteSuggestView | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const start = (): void => {
    setView({ phase: 'loading' })
    void window.__scribeApi
      .inviteSuggest({ accountId, id })
      .catch(() => ({ ok: false, error: 'failed' }) as const)
      .then((result) => {
        if (!alive.current) return
        setView(result.ok ? { phase: 'ready', suggestion: result.suggestion } : { phase: 'error', text: INVITE_SUGGEST_ERRORS[result.error] })
      })
  }
  return { view, start, discard: () => setView(null) }
}

const FIELD = 'no-drag h-8 min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2.5 text-13 text-text'
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]

/** "15 min", "1 h", "1 h 30". */
function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`
}

/** O link como a pessoa digitou: sem esquema vira `https://`; vazio, `null`; inválido, `undefined`. */
function linkOf(text: string): string | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  return safeJoinUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) ?? undefined
}

type Saved = { effect: 'created' | 'already'; calendarTitle: string; sourceTitle: string } | { noAccess: true } | { error: string }

interface InviteSuggestCardProps {
  accountId: string
  id: string
  suggestion: InviteSuggestion
  onDiscard: () => void
}

/**
 * O cartão "Sugestão — confira" (contrato 64, CA14, quadro 09 do mockup), com as peças do cartão do convite (CA27 do
 * 63): moldura tracejada, os campos editáveis (título, data, hora, duração, link e agenda), a nota de que nada grava sem
 * o clique e ninguém recebe resposta, "Pôr na agenda" e "Descartar". Gravar é só no clique, pelo `scribe:invite-suggest-add`.
 */
export function InviteSuggestCard({ accountId, id, suggestion, onDiscard }: InviteSuggestCardProps) {
  const locked = useLock((store) => store.status.locked)
  const calendars = useInvites((store) => store.calendars)
  const [title, setTitle] = useState(suggestion.title)
  const [date, setDate] = useState(suggestion.date)
  const [time, setTime] = useState(suggestion.time ?? '')
  const [duration, setDuration] = useState(suggestion.durationMinutes ?? INVITE_SUGGEST_DEFAULT_DURATION)
  const [link, setLink] = useState(suggestion.url ? joinLabel(suggestion.url) : '')
  const [chosen, setChosen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)

  useEffect(() => {
    const listed = useInvites.getState().calendars
    if (listed === null || !listed.ok || listed.access !== 'full' || listed.calendars.length === 0) void useInvites.getState().loadCalendars()
  }, [])

  if (locked) return null

  const options = calendars?.ok ? calendars.calendars : []
  const calendarId = chosen ?? (calendars?.ok ? calendars.defaultId : null)
  const url = linkOf(link)
  const done = saved !== null && 'effect' in saved
  const durations = [...new Set([...DURATIONS, duration])].filter((value) => value >= INVITE_SUGGEST_DURATION_MIN && value <= INVITE_SUGGEST_DURATION_MAX).sort((a, b) => a - b)
  const problem = !time ? 'Falta a hora' : !title.trim() ? 'Falta o título' : !date ? 'Falta a data' : url === undefined ? 'Confira o link' : null

  const save = async (): Promise<void> => {
    if (saving || problem || url === undefined) return
    setSaving(true)
    setSaved(null)
    const where = await suggestTarget({
      chosen,
      calendars: () => useInvites.getState().calendars,
      requestAccess: () => window.__scribeApi.invoke('scribe:invite-request-access'),
      reload: () => useInvites.getState().loadCalendars(),
    })
    if (!('id' in where)) {
      setSaved(where)
      setSaving(false)
      return
    }
    const result: InviteEventAddResult = await window.__scribeApi
      .invoke('scribe:invite-suggest-add', { accountId, id, event: { title: title.trim(), date, time, durationMinutes: duration, url, calendarId: where.id } })
      .catch(() => ({ ok: false, error: 'failed', message: INVITE_ERROR_MESSAGES.failed }) as const)
    setSaving(false)
    if (result.ok) setSaved({ effect: result.effect, calendarTitle: result.calendarTitle, sourceTitle: result.sourceTitle })
    else if (result.error === 'denied' || result.error === 'restricted') setSaved({ noAccess: true })
    else setSaved({ error: result.message })
  }

  const badge = done ? (saved.effect === 'created' ? { text: 'Na agenda', tone: 'solid' as const } : { text: 'Já estava na agenda', tone: 'muted' as const }) : { text: 'Sugestão — confira', tone: 'dashed' as const }
  const off = done || saving
  const label = 'w-16 shrink-0 text-12 text-text-muted'

  return (
    <InviteCardShell typeLabel="Evento sugerido" badge={badge} dashed={!done} attrs={{ 'data-invite-suggest-card': '', 'data-invite-suggest-state': done ? saved.effect : 'ready', 'aria-busy': saving ? 'true' : undefined }}>
      <div data-invite-suggest-fields className="flex flex-col gap-2 text-13">
        <div className="flex min-w-0 items-center gap-3">
          <label htmlFor="invite-suggest-title" className={label}>
            Título
          </label>
          <input id="invite-suggest-title" data-invite-suggest-title value={title} maxLength={INVITE_SUGGEST_TITLE_MAX} disabled={off} onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, ' '))} className={`${FIELD} flex-1`} />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <span id="invite-suggest-when" className={label}>
            Quando
          </span>
          <div role="group" aria-labelledby="invite-suggest-when" className="flex min-w-0 flex-1 gap-2">
            <input type="date" aria-label="Data" data-invite-suggest-date value={date} disabled={off} onChange={(event) => setDate(event.target.value)} className={`${FIELD} flex-1`} />
            <input type="time" aria-label="Hora" data-invite-suggest-time value={time} disabled={off} onChange={(event) => setTime(event.target.value)} className={`${FIELD} flex-1`} />
            <select aria-label="Duração" data-invite-suggest-duration value={duration} disabled={off} onChange={(event) => setDuration(Number(event.target.value))} className={`${FIELD} shrink-0`}>
              {durations.map((value) => (
                <option key={value} value={value}>
                  {durationLabel(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <label htmlFor="invite-suggest-link" className={label}>
            Link
          </label>
          <input id="invite-suggest-link" data-invite-suggest-link value={link} disabled={off} placeholder="Sem link" onChange={(event) => setLink(event.target.value)} className={`${FIELD} flex-1`} />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <span className={label}>Agenda</span>
          <CalendarPicker calendars={options} value={calendarId} disabled={off} label="Agenda da sugestão" onChange={setChosen} />
        </div>
      </div>
      <div data-invite-suggest-footer className="flex flex-col gap-2.5 border-t border-line pt-3">
        {saved && 'effect' in saved ? (
          <InviteStatusLine
            icon={CalendarCheck}
            title={
              <>
                <b className="font-bold text-title">{`${saved.effect === 'created' ? 'Na agenda' : 'Já está na agenda'} ${saved.calendarTitle}`}</b> ({saved.sourceTitle})
              </>
            }
          />
        ) : (
          <>
            <p data-invite-suggest-note className="flex items-start gap-2 text-12 text-text-muted">
              <Icon icon={Info} size={14} className="mt-0.5 shrink-0 text-accent" />
              Lido pelo Claude a partir do texto deste email. Confira antes de gravar: nada vai para a agenda sem o clique, e ninguém recebe resposta.
            </p>
            {saved && 'noAccess' in saved && (
              <InviteNote
                marker="invite-no-access"
                role="status"
                icon={TriangleAlert}
                title="Sem acesso ao Calendário"
                actions={<ActionButton icon={Settings} label="Abrir Ajustes" action="invite-open-settings" onClick={() => window.__scribeApi.send('scribe:open-privacy-settings', 'calendars')} />}
              >
                O macOS não deixou o app pôr o evento na agenda. Permita em Ajustes › Privacidade › Calendários.
              </InviteNote>
            )}
            {saved && 'error' in saved && (
              <p data-invite-error role="alert" className="text-12 text-rec">
                {saved.error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button action="invite-suggest-add" icon={CalendarPlus} disabled={problem !== null || saving} onClick={() => void save()}>
                {saving ? 'Pondo na agenda…' : 'Pôr na agenda'}
              </Button>
              <Button action="invite-suggest-discard" variant="secondary" disabled={saving} onClick={onDiscard}>
                Descartar
              </Button>
              {problem && (
                <span data-invite-suggest-problem className="text-12 text-text-muted">
                  {problem}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </InviteCardShell>
  )
}
