import { ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { CHAT_SCOPE_MEETINGS_MAX, type ChatMessage, type ChatScope, type ChatScopeKind } from '@shared/chat'
import type { MeetingOverview } from '@shared/meetings-overview'
import { meetingPath } from '@shared/routes'
import type { ChatModel } from '@shared/settings-defaults'
import { Icon } from '../../design/Icon'
import { Segmented } from '../../design/Segmented'
import { dayLabel, timeLabel } from '../meetings/format'
import { useMeetingsSearch } from '../meetings/useMeetingsOverview'
import { answerTimeLabel, CHAT_MODEL_LABELS, chatTotals, chosenMeetings, consultedIn, COST_HINT, costLabel, modelLabel, scopeLabel, tokensLabel, withWhatsApp } from './format'
import type { ChatMeetings } from './useChatMeetings'
import { SourcesSection } from './SourcesSection'

const SCOPE_OPTIONS: readonly { kind: ChatScopeKind; label: (total: number | null) => string }[] = [
  { kind: 'all', label: (total) => scopeLabel({ kind: 'all' }, total) },
  { kind: '7d', label: () => 'Últimos 7 dias' },
  { kind: '30d', label: () => 'Últimos 30 dias' },
  { kind: 'meetings', label: () => 'Reuniões escolhidas' },
]

export const MODEL_OPTIONS: readonly { value: ChatModel; label: string }[] = (['haiku', 'sonnet', 'opus'] as const).map((value) => ({ value, label: CHAT_MODEL_LABELS[value] }))

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0">
      <h3 className="text-12 font-bold text-text-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Linha de reunião: título e data, com o link que abre o detalhe. */
function MeetingLink({ entry }: { entry: MeetingOverview }) {
  const navigate = useNavigate()
  const date = new Date(entry.meeting.startedAt)
  return (
    <button
      type="button"
      data-meeting-link={entry.meeting.id}
      onClick={() => void navigate(meetingPath(entry.meeting.id))}
      className="no-drag flex w-full min-w-0 flex-col rounded-[var(--radius-control)] px-1 py-1 text-left hover:bg-bg-sunken"
    >
      <span className="truncate text-13 font-medium text-accent">{entry.meeting.title}</span>
      <span className="text-12 text-text-faint tabular">
        {dayLabel(date, new Date())} · {timeLabel(date)}
      </span>
    </button>
  )
}

/** "Reuniões escolhidas": busca do contrato 10 e caixas de marcar, até 50. */
function MeetingPicker({ meetings, chosen, onChange }: { meetings: ChatMeetings; chosen: readonly string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const search = useMeetingsSearch(query)
  const results = search.active && search.shown?.results ? search.shown.results : null
  const shown = results ?? meetings.list ?? []
  const full = chosen.length >= CHAT_SCOPE_MEETINGS_MAX
  const toggle = (id: string): void => onChange(chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id])
  return (
    <div data-chat-scope-picker className="flex flex-col gap-2">
      <div className="no-drag flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 text-text-faint has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
        <Icon icon={Search} size={14} />
        <input
          type="text"
          data-chat-scope-search
          value={query}
          placeholder="Buscar reuniões"
          aria-label="Buscar reuniões para escolher"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-12 text-text select-text placeholder:text-text-faint focus-visible:outline-none"
        />
      </div>
      <p className="text-12 text-text-faint tabular" aria-live="polite">
        {chosen.length} de {CHAT_SCOPE_MEETINGS_MAX} escolhidas
      </p>
      <ul className="flex max-h-[240px] flex-col overflow-y-auto">
        {shown.map((entry) => {
          const checked = chosen.includes(entry.meeting.id)
          const date = new Date(entry.meeting.startedAt)
          return (
            <li key={entry.meeting.id}>
              <label className="flex cursor-default items-start gap-2 rounded-[var(--radius-control)] px-1 py-1 hover:bg-bg-sunken">
                <input
                  type="checkbox"
                  data-scope-meeting={entry.meeting.id}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(entry.meeting.id)}
                  className="no-drag mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-13 text-text">{entry.meeting.title}</span>
                  <span className="text-12 text-text-faint tabular">
                    {dayLabel(date, new Date())} · {timeLabel(date)}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
        {search.active && results && !results.length && <li className="px-1 text-12 text-text-muted">Nada encontrado.</li>}
      </ul>
    </div>
  )
}

interface ContextSectionsProps {
  /** Aba de uma reunião: escopo fixo nela. */
  meetingId: string | null
  scope: ChatScope
  model: ChatModel
  messages: readonly ChatMessage[]
  meetings: ChatMeetings
  onScope: (scope: ChatScope) => void
  /** Aviso sobre o escopo (troca que ainda não foi gravada). */
  notice?: string | null
  onModel: (model: ChatModel) => void
}

interface ContextPanelProps extends ContextSectionsProps {
  onClose: () => void
}

/**
 * Painel "Contexto" da conversa (contrato 16, CA4): escopo e fontes (só na tela "Assistente", contrato 25), reuniões consultadas
 * nesta conversa, totais e modelo. Trocar o escopo ou o modelo vale para a próxima pergunta. Painel lateral da aba da reunião;
 * no Assistente o mesmo conteúdo fica no trilho da direita (`RailContext`, contrato 38).
 */
export function ContextPanel({ onClose, ...sections }: ContextPanelProps) {
  return (
    <aside data-chat-context aria-label="Contexto" className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line bg-bg">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
        <h2 className="text-13 font-bold text-title">Contexto</h2>
        <button
          type="button"
          data-action="close-context"
          aria-label="Fechar o painel Contexto"
          onClick={onClose}
          className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title"
        >
          <Icon icon={X} />
        </button>
      </div>
      <ContextSections {...sections} />
    </aside>
  )
}

interface RailContextProps extends ContextPanelProps {
  /** Seção aberta; recolhida, só o cabeçalho (e nada numa conversa nova). */
  open: boolean
  /** Há uma conversa aberta (uma nova, ainda sem pergunta, não tem). */
  chatOpen: boolean
  onOpen: () => void
  /** Recolhida pelo X numa conversa nova (sem o cabeçalho recolhido): para onde vai o foco. */
  onFocusAway: () => void
}

/** Id da seção aberta, alvo do `aria-controls` dos dois botões (só existe uma no trilho). */
const RAIL_CONTEXT_ID = 'chat-rail-context'

/**
 * Contrato 38: a seção "Contexto" no trilho da direita do Assistente, embaixo do histórico. Recolhida por padrão (só o
 * cabeçalho, com o escopo e o modelo); aberta, o conteúdo do painel. Sem conversa aberta, nada: o trilho fica só com o
 * histórico, até abrir pelo cabeçalho da conversa.
 */
export function RailContext({ open, chatOpen, onOpen, onClose, onFocusAway, ...sections }: RailContextProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const expandButton = useRef<HTMLButtonElement | null>(null)
  /** O botão clicado sai da tela: o foco vai para o que toma o lugar dele (só depois desses cliques). */
  const handoff = useRef(false)
  useEffect(() => {
    if (!handoff.current) return
    handoff.current = false
    if (open) closeButton.current?.focus()
    else if (expandButton.current) expandButton.current.focus()
    else onFocusAway()
    // Só na troca de aberto/recolhido; `onFocusAway` muda a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (open) {
    return (
      <section id={RAIL_CONTEXT_ID} data-chat-context aria-label="Contexto" className="flex flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
          <h2 className="text-13 font-bold text-title">Contexto</h2>
          <button
            ref={closeButton}
            type="button"
            data-action="close-context"
            aria-label="Recolher o Contexto"
            aria-expanded={true}
            aria-controls={RAIL_CONTEXT_ID}
            onClick={() => {
              handoff.current = true
              onClose()
            }}
            className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title"
          >
            <Icon icon={X} />
          </button>
        </div>
        <ContextSections {...sections} />
      </section>
    )
  }
  if (!chatOpen) return null
  const total = sections.meetings.list?.length ?? null
  const exists = sections.meetings.list ? (id: string): boolean => sections.meetings.byId.has(id) : null
  return (
    <button
      ref={expandButton}
      type="button"
      data-action="expand-context"
      aria-expanded={false}
      aria-controls={RAIL_CONTEXT_ID}
      onClick={() => {
        handoff.current = true
        onOpen()
      }}
      className="no-drag flex h-12 w-full items-center gap-2 pr-3 pl-4 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken focus-visible:outline-offset-[-2px]"
    >
      <span className="text-13 font-bold text-title">Contexto</span>
      <span className="min-w-0 flex-1 truncate text-12 text-text-faint">
        {sections.meetingId ? 'Só esta reunião' : scopeLabel(sections.scope, total, exists)} · {modelLabel(sections.model)}
      </span>
      <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
    </button>
  )
}

/** Escopo, fontes, consultadas, totais e modelo: o conteúdo do "Contexto", no painel ou no trilho. */
function ContextSections({ meetingId, scope, model, messages, meetings, onScope, onModel, notice = null }: ContextSectionsProps) {
  const totals = chatTotals(messages)
  const consulted = consultedIn(messages)
  const total = meetings.list?.length ?? null
  // Só as que ainda existem: a excluída sai da lista na próxima mudança.
  const chosen = chosenMeetings(scope, meetings.list ? (id) => meetings.byId.has(id) : null)
  const radios = useRef<HTMLDivElement | null>(null)
  const pick = (kind: ChatScopeKind): void => onScope(withWhatsApp(kind === 'meetings' ? { kind: 'meetings', meetingIds: chosen } : { kind }, scope))
  // Grupo de rádio com tabindex móvel: Tab entra na opção marcada; setas, Home e End trocam e marcam.
  const onRadioKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = SCOPE_OPTIONS.findIndex((option) => option.kind === scope.kind)
    const last = SCOPE_OPTIONS.length - 1
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (at + 1) % SCOPE_OPTIONS.length
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (at - 1 + SCOPE_OPTIONS.length) % SCOPE_OPTIONS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const option = SCOPE_OPTIONS[next]
    if (!option) return
    pick(option.kind)
    radios.current?.querySelector<HTMLButtonElement>(`[data-scope-option="${option.kind}"]`)?.focus()
  }
  return (
    <>
      <PanelSection title="Escopo">
        {meetingId ? (
          <p className="text-13 text-text">Só esta reunião</p>
        ) : (
          <>
            <div ref={radios} role="radiogroup" aria-label="Escopo" onKeyDown={onRadioKey} className="flex flex-col">
              {SCOPE_OPTIONS.map((option) => {
                const active = scope.kind === option.kind
                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-scope-option={option.kind}
                    tabIndex={active ? 0 : -1}
                    onClick={() => pick(option.kind)}
                    className={`no-drag flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-1 text-left text-13 hover:bg-bg-sunken ${active ? 'font-medium text-title' : 'text-text'}`}
                  >
                    <span aria-hidden="true" className={`size-2 shrink-0 border ${active ? 'border-accent bg-accent' : 'border-line-strong'}`} />
                    {option.label(total)}
                  </button>
                )
              })}
            </div>
            {scope.kind === 'meetings' && <MeetingPicker meetings={meetings} chosen={chosen} onChange={(ids) => onScope(withWhatsApp({ kind: 'meetings', meetingIds: ids }, scope))} />}
            {notice && (
              <p data-chat-scope-notice role="status" className="text-12 text-text-muted">
                {notice}
              </p>
            )}
          </>
        )}
      </PanelSection>
      {!meetingId && <SourcesSection scope={scope} onScope={onScope} />}
      <PanelSection title="Consultadas nesta conversa">
        {consulted.length ? (
          <ul data-chat-context-consulted className="-mx-1 flex flex-col">
            {consulted.map((id) => {
              const entry = meetings.byId.get(id)
              return <li key={id}>{entry ? <MeetingLink entry={entry} /> : <span className="px-1 text-12 text-text-faint">Reunião excluída</span>}</li>
            })}
          </ul>
        ) : (
          <p className="text-12 text-text-muted">Nenhuma ainda.</p>
        )}
      </PanelSection>
      <PanelSection title="Totais">
        <dl data-chat-totals className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-13 tabular">
          <dt className="text-text-muted">Mensagens</dt>
          <dd className="text-right text-text">{totals.messages}</dd>
          <dt className="text-text-muted">Tokens</dt>
          <dd className="text-right text-text">{tokensLabel(totals.tokens)}</dd>
          <dt className="text-text-muted" title={COST_HINT}>
            Custo nominal
          </dt>
          <dd className="text-right text-text" title={COST_HINT}>
            {costLabel(totals.costUsd)}
          </dd>
          <dt className="text-text-muted">Tempo</dt>
          <dd className="text-right text-text">{answerTimeLabel(totals.durationMs)}</dd>
        </dl>
        <p className="text-12 text-text-faint">{COST_HINT}</p>
      </PanelSection>
      <PanelSection title="Modelo">
        <span id="chat-context-model" className="sr-only">
          Modelo da conversa
        </span>
        <Segmented value={model} options={MODEL_OPTIONS} onChange={onModel} labelledBy="chat-context-model" dataName="chat-model" />
        <p className="text-12 text-text-faint">Vale a partir da próxima pergunta.</p>
      </PanelSection>
    </>
  )
}
