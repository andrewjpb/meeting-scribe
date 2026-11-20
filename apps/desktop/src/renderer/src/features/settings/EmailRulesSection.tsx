import { CircleCheck, Folder, GripVertical, Info, MoreHorizontal, Plus, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import type { EmailRule, EmailRuleState, EmailRulesError } from '@shared/email-rules'
import { EMAIL_RULE_CONDITIONS_MAX, EMAIL_RULES_MAX } from '@shared/email-rules-limits'
import { settingsPath } from '@shared/routes'
import { EMAIL_RULES_DESCRIPTION } from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { CONTROL_CLASS } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { Switch } from '../../design/Switch'
import { useEmailUi } from '../email/emailUi'
import { useInvites } from '../email/inviteStore'
import { INLINE_INPUT, MENU_ITEM, MENU_PANEL, useInlineMenu } from '../meetings/menu'
import { EmailRow } from './EmailSignatureSection'
import {
  ACTION_KINDS,
  ACTION_LABELS,
  availableActions,
  CALENDAR_UNAVAILABLE_HINTS,
  CONDITION_FIELDS,
  CONDITION_LABELS,
  conditionHasValue,
  draftToRule,
  moveRule,
  newRuleDraft,
  positionText,
  previewText,
  ruleErrorText,
  ruleSummaryParts,
  ruleToDraft,
  rulesSaveErrorText,
  rulesSaveOutcome,
  runResultText,
  validateRuleDraft,
  POP3_ACTION_KINDS,
  type ActionKind,
  type CalendarAvailability,
  type CalendarName,
  type ConditionField,
  type FolderName,
  type RuleDraft,
} from './rulesFormat'

const SELECT = `${CONTROL_CLASS} shrink-0 px-2.5`

interface RulesProps {
  accountId: string
  pop3: boolean
  hasTrash: boolean
  name: FolderName
  /** Mensagens da Caixa de Entrada guardadas no app (o T da contagem do "Executar agora"). */
  inboxCount: number
}

/**
 * Contrato 64: a agenda padrão das Configurações (o nome, se ela está na lista) e se falta escolher a agenda ou dar o
 * acesso ao Calendário do Mac. A regra só usa a agenda gravada (`inviteCalendarId`), nunca uma escolhida por ela.
 */
function useRuleCalendar(): { name: CalendarName; needsSetup: boolean } {
  const saved = useSettings((state) => state.settings.inviteCalendarId)
  const calendars = useInvites((state) => state.calendars)
  useEffect(() => {
    if (useInvites.getState().calendars === null) void useInvites.getState().loadCalendars()
  }, [])
  const full = calendars?.ok === true && calendars.access === 'full'
  const name = saved !== null && calendars?.ok ? (calendars.calendars.find((item) => item.id === saved)?.title ?? null) : null
  return { name, needsSetup: !full || name === null }
}

type Run = { ruleId: string; phase: 'counting' } | { ruleId: string; phase: 'ready'; count: number; token: string } | { ruleId: string; phase: 'running' } | { ruleId: string; phase: 'done'; text: string } | { ruleId: string; phase: 'stale' } | { ruleId: string; phase: 'error'; text: string }

/**
 * Configurações › Email › Regras (contrato 55, CA17 a CA19 e CA21): "N de 50", "Nova regra", o texto de como as regras
 * agem e uma linha por regra (alça, número, nome, resumo, interruptor, "Executar agora" e ⋯). A ordem muda arrastando
 * pela alça ou por Subir/Descer, sempre gravando a lista inteira por `scribe:email-rules-set`; a tela muda na hora e
 * volta se o main recusar. O editor abre no lugar da linha.
 */
export function EmailRulesSection({ accountId, pop3, hasTrash, name, inboxCount }: RulesProps) {
  const [rules, setRules] = useState<EmailRule[] | null>(null)
  const [states, setStates] = useState<Record<string, EmailRuleState>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ draft: RuleDraft; isNew: boolean; dirty: boolean; error: string | null; busy: boolean; confirmDelete: boolean } | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [announce, setAnnounce] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  // Contrato 64: "Pôr na agenda" nesta conta (R5b e fora do Mac desligam a ação).
  const [calendarOk, setCalendarOk] = useState<CalendarAvailability>('ok')
  const calendar = useRuleCalendar()

  useEffect(() => {
    let alive = true
    void window.__scribeApi.invoke('scribe:email-rules-get', { accountId }).then(
      (result) => {
        if (!alive) return
        if (result.ok) {
          setRules(result.rules)
          setStates(result.state)
          setCalendarOk(result.invite.autoAdds ? 'auto' : result.invite.mac ? 'ok' : 'no-mac')
          setFailure(null)
        } else setFailure('Não foi possível ler as regras desta conta.')
      },
      () => alive && setFailure('Não foi possível ler as regras desta conta.'),
    )
    return () => {
      alive = false
    }
  }, [accountId])

  const reload = (): void => {
    void window.__scribeApi.invoke('scribe:email-rules-get', { accountId }).then(
      (result) => {
        if (result.ok) {
          setRules(result.rules)
          setStates(result.state)
        }
      },
      () => undefined,
    )
  }

  /** Grava a lista inteira; a tela já mudou e volta se o main recusar. */
  const persist = async (next: EmailRule[], before: EmailRule[]): Promise<EmailRulesError | null> => {
    setRules(next)
    // `unavailable` (ou o canal que falhou) é o `settings.json` que não foi gravado: sem conexão com o servidor, o main já
    // grava e devolve `ok` (contrato 53, CA9). Falhou: a lista volta ao que está gravado.
    const result = await window.__scribeApi.invoke('scribe:email-rules-set', { accountId, rules: next }).catch(() => ({ ok: false as const, error: 'unavailable' as const }))
    const outcome = rulesSaveOutcome(result)
    if (outcome.ok) {
      setRules(outcome.rules)
      return null
    }
    setRules(before)
    return outcome.error
  }

  const reorder = async (from: number, to: number): Promise<void> => {
    if (!rules) return
    const next = moveRule(rules, from, to)
    const moved = next[to]
    const error = await persist(next, rules)
    if (error) setFailure(rulesSaveErrorText(error))
    else if (moved) setAnnounce(positionText(moved.name, to + 1, next.length))
  }

  const toggle = async (rule: EmailRule, enabled: boolean): Promise<void> => {
    if (!rules) return
    const error = await persist(
      rules.map((item) => (item.id === rule.id ? { ...item, enabled } : item)),
      rules,
    )
    if (error) setFailure(rulesSaveErrorText(error))
  }

  const save = async (): Promise<void> => {
    if (!editing || !rules || editing.busy) return
    const rule = draftToRule(editing.draft)
    const next = editing.isNew ? [...rules, rule] : rules.map((item) => (item.id === rule.id ? rule : item))
    setEditing({ ...editing, busy: true, error: null })
    const error = await persist(next, rules)
    if (error) setEditing((current) => (current ? { ...current, busy: false, error: rulesSaveErrorText(error) } : current))
    else setEditing(null)
  }

  const remove = async (id: string): Promise<void> => {
    if (!rules) return
    const error = await persist(
      rules.filter((item) => item.id !== id),
      rules,
    )
    if (error) setFailure(rulesSaveErrorText(error))
    setEditing(null)
  }

  const count = async (rule: EmailRule): Promise<void> => {
    setRun({ ruleId: rule.id, phase: 'counting' })
    const result = await window.__scribeApi.invoke('scribe:email-rules-preview', { accountId, ruleId: rule.id }).catch(() => ({ ok: false as const, error: 'unavailable' as const }))
    if (result.ok) setRun({ ruleId: rule.id, phase: 'ready', count: result.count, token: result.token })
    else setRun({ ruleId: rule.id, phase: 'error', text: result.error === 'unavailable' ? 'Sem conexão com o servidor. Tente de novo.' : result.error === 'pop3' ? 'Conta POP3: esta regra tem ação que o POP3 não faz.' : 'Não foi possível contar agora.' })
  }
  const execute = async (rule: EmailRule, token: string): Promise<void> => {
    setRun({ ruleId: rule.id, phase: 'running' })
    const result = await window.__scribeApi.invoke('scribe:email-rules-run', { accountId, ruleId: rule.id, token }).catch(() => ({ ok: false as const, error: 'unavailable' as const }))
    if (result.ok) {
      setRun({ ruleId: rule.id, phase: 'done', text: runResultText(result.done, result.skipped) })
      reload()
    } else if (result.error === 'stale') setRun({ ruleId: rule.id, phase: 'stale' })
    else setRun({ ruleId: rule.id, phase: 'error', text: result.error === 'unavailable' ? 'Sem conexão com o servidor. Nada foi feito.' : 'O servidor recusou. Nada foi feito.' })
  }

  const dirty = editing?.dirty ?? false
  const full = (rules?.length ?? 0) >= EMAIL_RULES_MAX
  const startNew = (): void => {
    if (full || dirty) return
    setRun(null)
    setEditing({ draft: newRuleDraft(crypto.randomUUID()), isNew: true, dirty: true, error: null, busy: false, confirmDelete: false })
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, to: number): void => {
    event.preventDefault()
    if (!rules || dragging === null) return
    const from = rules.findIndex((rule) => rule.id === dragging)
    setDragging(null)
    if (from !== -1 && from !== to) void reorder(from, to)
  }

  return (
    <Section title="Regras" anchor="regras">
      <EmailRow name="Regras" description={EMAIL_RULES_DESCRIPTION} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[460px] text-12 text-text-muted">As regras são do app: agem no email que chega, na ordem da lista, só enquanto o Meeting Scribe está aberto. “Parar aqui” impede as regras de baixo.</p>
          <div className="flex shrink-0 items-center gap-3">
            <span data-email-rules-count className="text-12 tabular text-text-muted">
              {rules?.length ?? 0} de {EMAIL_RULES_MAX}
            </span>
            <div title={full ? 'Limite de 50 regras por conta' : undefined}>
              <Button action="email-rule-new" variant="secondary" icon={Plus} onClick={startNew} disabled={full || dirty || rules === null}>
                Nova regra
              </Button>
            </div>
          </div>
        </div>
        {full && <p className="text-12 text-text-muted">Limite de 50 regras por conta</p>}
        {pop3 && (
          <Note id="email-rules-pop3" icon={TriangleAlert} role="status">
            Conta POP3 não tem pastas no servidor: as regras desta conta só podem <b>marcar como lida</b>, <b>não avisar</b> e <b>pôr na agenda</b>. Mover, estrela e apagar ficam desligados.
          </Note>
        )}
        {failure && (
          <Note id="email-rules-error" icon={TriangleAlert} role="alert">
            {failure}
          </Note>
        )}
        <p aria-live="polite" className="sr-only" data-email-rules-live>
          {announce}
        </p>
        <ol data-email-rules className="flex flex-col">
          {(rules ?? []).map((rule, index) => {
            const isEditing = editing && !editing.isNew && editing.draft.id === rule.id
            const state = states[rule.id]
            return (
              <li
                key={rule.id}
                data-email-rule={rule.id}
                onDragOver={(event) => dragging !== null && event.preventDefault()}
                onDrop={(event) => onDrop(event, index)}
                className={`flex flex-col gap-2 border-t border-line py-2 first:border-t-0 ${dragging === rule.id ? 'opacity-50' : ''}`}
              >
                {isEditing && editing ? (
                  <RuleEditor
                    number={index + 1}
                    editing={editing}
                    onChange={(draft) => setEditing({ ...editing, draft, dirty: true, error: null })}
                    onSave={() => void save()}
                    onCancel={() => setEditing(null)}
                    onAskDelete={(confirmDelete) => setEditing({ ...editing, confirmDelete })}
                    onDelete={() => void remove(rule.id)}
                    accountId={accountId}
                    pop3={pop3}
                    hasTrash={hasTrash}
                    calendarOk={calendarOk}
                    calendar={calendar}
                    name={name}
                  />
                ) : (
                  <>
                    <RuleLine
                      rule={rule}
                      number={index + 1}
                      total={rules?.length ?? 0}
                      name={name}
                      calendar={calendar.name}
                      canEdit={!dirty}
                      onDragStart={() => setDragging(rule.id)}
                      onDragEnd={() => setDragging(null)}
                      onToggle={(enabled) => void toggle(rule, enabled)}
                      onEdit={() => {
                        setEditing({ draft: ruleToDraft(rule), isNew: false, dirty: false, error: null, busy: false, confirmDelete: false })
                      }}
                      onMove={(to) => void reorder(index, to)}
                      onDelete={() => setEditing({ draft: ruleToDraft(rule), isNew: false, dirty: false, error: null, busy: false, confirmDelete: true })}
                      onRun={() => void count(rule)}
                    />
                    {state?.lastError && (
                      <p data-email-rule-error className="flex items-start gap-1.5 pl-[52px] text-12 text-rec">
                        <Icon icon={TriangleAlert} size={14} className="mt-px shrink-0" />
                        <span>
                          {ruleErrorText(state.lastError, rule, name)}{' '}
                          {!dirty && (
                            <button
                              type="button"
                              data-action="email-rule-error-edit"
                              onClick={() => setEditing({ draft: ruleToDraft(rule), isNew: false, dirty: false, error: null, busy: false, confirmDelete: false })}
                              className="no-drag font-medium text-accent underline decoration-1 underline-offset-3"
                            >
                              Editar regra
                            </button>
                          )}
                        </span>
                      </p>
                    )}
                    {run?.ruleId === rule.id && <RunPanel rule={rule} run={run} inboxCount={inboxCount} name={name} calendar={calendar.name} onExecute={(token) => void execute(rule, token)} onRecount={() => void count(rule)} onClose={() => setRun(null)} />}
                  </>
                )}
              </li>
            )
          })}
          {editing?.isNew && (
            <li data-email-rule="new" className="flex flex-col gap-2 border-t border-line py-2 first:border-t-0">
              <RuleEditor
                number={(rules?.length ?? 0) + 1}
                editing={editing}
                onChange={(draft) => setEditing({ ...editing, draft, dirty: true, error: null })}
                onSave={() => void save()}
                onCancel={() => setEditing(null)}
                onAskDelete={() => setEditing(null)}
                onDelete={() => setEditing(null)}
                accountId={accountId}
                pop3={pop3}
                hasTrash={hasTrash}
                calendarOk={calendarOk}
                calendar={calendar}
                name={name}
              />
            </li>
          )}
        </ol>
        {rules?.length === 0 && !editing && <p className="text-12 text-text-muted">Nenhuma regra nesta conta.</p>}
      </EmailRow>
    </Section>
  )
}

interface RuleLineProps {
  rule: EmailRule
  number: number
  total: number
  name: FolderName
  calendar: CalendarName
  canEdit: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onMove: (to: number) => void
  onDelete: () => void
  onRun: () => void
}

/** Uma regra na lista (CA17, D9, D10): alça, número, nome, resumo, ligar/desligar, "Executar agora" e ⋯. */
function RuleLine({ rule, number, total, name, calendar, canEdit, onDragStart, onDragEnd, onToggle, onEdit, onMove, onDelete, onRun }: RuleLineProps) {
  const [open, setOpen] = useState(false)
  const { button, menu, onBlur, onKeyDown } = useInlineMenu(open, () => setOpen(false))
  const summary = ruleSummaryParts(rule, name, calendar)
  const labelId = `email-rule-${rule.id}-label`
  const item = (key: string, label: string, act: () => void, disabled = false, danger = false) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-action={`email-rule-${key}`}
      disabled={disabled}
      onClick={() => {
        setOpen(false)
        act()
      }}
      className={`${MENU_ITEM} ${danger ? 'text-rec' : 'text-text'} disabled:text-text-faint`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-start gap-2">
      <span
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', rule.id)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        aria-hidden="true"
        title="Arraste para mudar a ordem"
        className="mt-0.5 inline-flex size-5 shrink-0 cursor-grab items-center justify-center text-text-faint"
      >
        <Icon icon={GripVertical} size={14} />
      </span>
      <span className="mt-0.5 w-5 shrink-0 text-12 tabular text-text-muted">{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p data-email-rule-name className={`text-13 font-bold ${rule.enabled ? 'text-title' : 'text-text-muted'}`}>
          {rule.name}
        </p>
        <p data-email-rule-summary className="text-12 text-text-muted">
          {summary.condition} <span className="text-text">{summary.actions}</span>
        </p>
      </div>
      <span id={labelId} className="sr-only">{`Regra ${rule.name} ligada`}</span>
      <Switch checked={rule.enabled} labelledBy={labelId} action="email-rule-toggle" onChange={onToggle} />
      <button type="button" data-action="email-rule-run" onClick={onRun} className="no-drag h-7 shrink-0 rounded-[var(--radius-control)] border border-line-strong px-2 text-12 font-medium text-title hover:bg-bg-sunken">
        Executar agora
      </button>
      <div onBlur={onBlur} onKeyDown={open ? onKeyDown : undefined} className="relative shrink-0">
        <button ref={button} type="button" data-action="email-rule-menu" aria-label={`Mais ações da regra ${rule.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="no-drag inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title">
          <Icon icon={MoreHorizontal} />
        </button>
        {open && (
          <div ref={menu} role="menu" aria-label={`Regra ${rule.name}`} className={MENU_PANEL}>
            {item('edit', 'Editar', onEdit, !canEdit)}
            {item('up', 'Subir', () => onMove(number - 2), number === 1)}
            {item('down', 'Descer', () => onMove(number), number === total)}
            {item('delete', 'Apagar', onDelete, !canEdit, true)}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Executar agora" (CA19): a contagem antes, sempre; só então o botão que executa com o token. */
function RunPanel({ rule, run, inboxCount, name, calendar, onExecute, onRecount, onClose }: { rule: EmailRule; run: Run; inboxCount: number; name: FolderName; calendar: CalendarName; onExecute: (token: string) => void; onRecount: () => void; onClose: () => void }) {
  return (
    <div data-email-rule-run={run.phase} className="ml-[52px] flex flex-col gap-2 border-l-3 border-title bg-bg-sunken px-3 py-2">
      {run.phase === 'counting' && <p className="text-13 text-text-muted">Contando… (pode levar alguns segundos quando a regra olha o corpo)</p>}
      {run.phase === 'running' && <p className="text-13 text-text-muted">Executando…</p>}
      {run.phase === 'ready' && (
        <>
          <p className="text-13 font-bold text-title">{`Executar “${rule.name}” agora?`}</p>
          <p data-email-rule-preview className="text-13 text-text">
            {previewText(rule, run.count, inboxCount, name, calendar)}
          </p>
          <div className="flex flex-wrap gap-2">
            {run.count > 0 ? (
              <>
                <Button action="email-rule-execute" onClick={() => onExecute(run.token)}>
                  {`Executar em ${run.count} ${run.count === 1 ? 'mensagem' : 'mensagens'}`}
                </Button>
                <Button action="email-rule-run-cancel" variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button action="email-rule-run-close" variant="secondary" onClick={onClose}>
                Fechar
              </Button>
            )}
          </div>
        </>
      )}
      {run.phase === 'done' && (
        <div className="flex items-center gap-3">
          <Icon icon={CircleCheck} className="shrink-0 text-accent" />
          <p data-email-rule-done className="flex-1 text-13 text-text">
            {run.text}
          </p>
          <Button action="email-rule-run-close" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      )}
      {run.phase === 'stale' && (
        <div className="flex flex-wrap items-center gap-3">
          <p data-email-rule-stale className="flex-1 text-13 text-text">
            A regra ou a Caixa de Entrada mudou. Conte de novo.
          </p>
          <Button action="email-rule-recount" variant="secondary" onClick={onRecount}>
            Contar de novo
          </Button>
        </div>
      )}
      {run.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="flex-1 text-13 text-rec">
            {run.text}
          </p>
          <Button action="email-rule-run-close" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}

interface EditorProps {
  number: number
  editing: { draft: RuleDraft; isNew: boolean; dirty: boolean; error: string | null; busy: boolean; confirmDelete: boolean }
  onChange: (draft: RuleDraft) => void
  onSave: () => void
  onCancel: () => void
  onAskDelete: (confirm: boolean) => void
  onDelete: () => void
  accountId: string
  pop3: boolean
  hasTrash: boolean
  /** Contrato 64: "Pôr na agenda" nesta conta. */
  calendarOk: CalendarAvailability
  calendar: { name: CalendarName; needsSetup: boolean }
  name: FolderName
}

/** O editor da regra (CA18, D10, tela 10), no lugar da linha. */
function RuleEditor({ number, editing, onChange, onSave, onCancel, onAskDelete, onDelete, accountId, pop3, hasTrash, calendarOk, calendar, name }: EditorProps) {
  const navigate = useNavigate()
  const { draft } = editing
  const options = { pop3, hasTrash, calendar: calendarOk }
  const problem = validateRuleDraft(draft, options)
  const set = (patch: Partial<RuleDraft>): void => onChange({ ...draft, ...patch })
  const setCondition = (index: number, patch: Partial<RuleDraft['conditions'][number]>): void => set({ conditions: draft.conditions.map((item, at) => (at === index ? { ...item, ...patch } : item)) })
  const setAction = (index: number, patch: Partial<RuleDraft['actions'][number]>): void => set({ actions: draft.actions.map((item, at) => (at === index ? { ...item, ...patch } : item)) })
  const nextAction = availableActions(draft, options)[0]
  const kinds = pop3 ? POP3_ACTION_KINDS : ACTION_KINDS
  const optionLabel = (kind: ActionKind): string => {
    if (kind === 'delete' && !hasTrash) return `${ACTION_LABELS[kind]} · Esta conta não tem Lixeira`
    if (kind === 'calendar' && calendarOk !== 'ok') return `${ACTION_LABELS[kind]} · ${CALENDAR_UNAVAILABLE_HINTS[calendarOk]}`
    return ACTION_LABELS[kind]
  }

  const pickFolder = (index: number, anchor: DOMRect): void => {
    const current = draft.actions[index]?.moveTo ?? null
    useEmailUi.getState().openPicker({
      accountId,
      from: 'inbox',
      fromPath: '',
      ids: [],
      anchor: { top: anchor.bottom + 4, right: anchor.right },
      choose: { title: 'Mover para a pasta', current, disabled: ['INBOX'], onChoose: (path) => setAction(index, { moveTo: path }) },
    })
  }

  return (
    <div data-email-rule-editor={draft.id} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong p-3">
      <div className="flex items-center gap-2">
        <span className="text-12 tabular text-text-muted">{number}</span>
        <p className="text-13 font-bold text-title">{editing.isNew ? 'Nova regra' : 'Editar regra'}</p>
        {editing.dirty && <span className="text-12 text-text-muted">alterações não salvas</span>}
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={`email-rule-name-${draft.id}`} className="w-14 shrink-0 text-12 font-medium text-text">
          Nome
        </label>
        <input id={`email-rule-name-${draft.id}`} data-email-rule-name-input value={draft.name} maxLength={120} onChange={(event) => set({ name: event.target.value })} className={`${INLINE_INPUT} max-w-[360px] flex-1`} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-13 text-text">
          <span id={`email-rule-match-${draft.id}`}>Quando chega email que atende a</span>
          <Segmented
            value={draft.match}
            options={[
              { value: 'all', label: 'todas' },
              { value: 'any', label: 'qualquer uma' },
            ]}
            labelledBy={`email-rule-match-${draft.id}`}
            dataName="email-rule-match"
            onChange={(match) => set({ match })}
          />
          <span>destas condições:</span>
        </div>
        {draft.conditions.map((condition, index) => (
          <div key={index} data-email-rule-condition={index} className="flex items-center gap-2">
            <select aria-label="Condição" value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value as ConditionField })} className={SELECT}>
              {CONDITION_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {CONDITION_LABELS[field]}
                </option>
              ))}
            </select>
            {conditionHasValue(condition.field) && <input aria-label="Texto da condição" data-email-rule-value value={condition.value} maxLength={220} onChange={(event) => setCondition(index, { value: event.target.value })} className={`${INLINE_INPUT} flex-1`} />}
            <button type="button" aria-label="Tirar a condição" onClick={() => set({ conditions: draft.conditions.filter((_, at) => at !== index) })} className="no-drag inline-flex size-8 shrink-0 items-center justify-center text-text-muted hover:text-title">
              <Icon icon={X} size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-action="email-rule-add-condition" disabled={draft.conditions.length >= EMAIL_RULE_CONDITIONS_MAX} onClick={() => set({ conditions: [...draft.conditions, { field: 'from', value: '' }] })} className="no-drag inline-flex items-center gap-1.5 text-13 font-medium text-accent disabled:opacity-50">
            <Icon icon={Plus} size={14} />
            Adicionar condição
          </button>
          <span className="text-12 text-text-faint">Condições: remetente contém · destinatário ou Cc contém · assunto contém · corpo contém · tem anexo · é convite</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-13 text-text">Fazer isto:</p>
        {draft.actions.map((action, index) => {
          const allowed = availableActions(draft, options, action.kind)
          return (
            <div key={index} className="flex flex-col gap-1.5">
              <div data-email-rule-action={action.kind} className="flex items-center gap-2">
                <select aria-label="Ação" value={action.kind} onChange={(event) => setAction(index, { kind: event.target.value as ActionKind, moveTo: null })} className={SELECT}>
                  {kinds.map((kind) => (
                    <option key={kind} value={kind} disabled={!allowed.includes(kind)}>
                      {optionLabel(kind)}
                    </option>
                  ))}
                </select>
                {action.kind === 'move' && (
                  <button type="button" data-action="email-rule-pick-folder" onClick={(event) => pickFolder(index, event.currentTarget.getBoundingClientRect())} className={`${CONTROL_CLASS} inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left`}>
                    <Icon icon={Folder} size={14} className="shrink-0 text-text-muted" />
                    <span data-email-rule-folder className={`truncate ${action.moveTo ? '' : 'text-text-faint'}`}>
                      {action.moveTo ? name(action.moveTo) : 'Escolher pasta…'}
                    </span>
                  </button>
                )}
                <button type="button" aria-label="Tirar a ação" onClick={() => set({ actions: draft.actions.filter((_, at) => at !== index) })} className="no-drag inline-flex size-8 shrink-0 items-center justify-center text-text-muted hover:text-title">
                  <Icon icon={X} size={14} />
                </button>
              </div>
              {action.kind === 'calendar' && (
                <div data-email-rule-calendar-note className="flex flex-col gap-1 text-12 text-text-muted">
                  <p className="flex items-center gap-1.5">
                    <Icon icon={Info} size={14} className="shrink-0" />
                    Só põe na agenda; não responde ao organizador.
                  </p>
                  {calendarOk === 'ok' && calendar.needsSetup && (
                    <p data-email-rule-calendar-setup className="pl-5">
                      <button type="button" data-action="email-rule-calendar-settings" onClick={() => void navigate(settingsPath('email', 'convites'))} className="no-drag font-medium text-accent underline decoration-1 underline-offset-3">
                        Escolha a agenda e dê o acesso em Configurações › Email › Convites.
                      </button>
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-action="email-rule-add-action" disabled={!nextAction} onClick={() => nextAction && set({ actions: [...draft.actions, { kind: nextAction, moveTo: null }] })} className="no-drag inline-flex items-center gap-1.5 text-13 font-medium text-accent disabled:opacity-50">
            <Icon icon={Plus} size={14} />
            Adicionar ação
          </button>
          <span className="text-12 text-text-faint">{pop3 ? 'Ações: marcar como lida · não avisar · pôr na agenda' : 'Ações: mover para a pasta · marcar como lida · marcar com estrela · apagar (vai para a Lixeira) · não avisar · pôr na agenda'}</span>
        </div>
      </div>
      <label className="flex items-center gap-2 text-13 text-text">
        <input type="checkbox" data-email-rule-stop checked={draft.stopHere} onChange={(event) => set({ stopHere: event.target.checked })} className="no-drag size-4 accent-[var(--accent)]" />
        Parar aqui: não aplicar as regras de baixo
      </label>
      {(problem || editing.error) && (
        <p role={editing.error ? 'alert' : 'status'} data-email-rule-problem className={`text-12 ${editing.error ? 'text-rec' : 'text-text-muted'}`}>
          {editing.error ?? problem}
        </p>
      )}
      {editing.confirmDelete && (
        <Note
          id="email-rule-delete-confirm"
          icon={TriangleAlert}
          role="alert"
          action={
            <div className="flex gap-2">
              <Button action="email-rule-delete-confirm" variant="danger" onClick={onDelete}>
                Apagar regra
              </Button>
              <Button action="email-rule-delete-cancel" variant="secondary" onClick={() => onAskDelete(false)}>
                Cancelar
              </Button>
            </div>
          }
        >
          {`Apagar a regra “${draft.name || 'sem nome'}”?`}
        </Note>
      )}
      <div className="flex flex-wrap gap-2">
        <Button action="email-rule-save" onClick={onSave} disabled={problem !== null || editing.busy}>
          {editing.busy ? 'Salvando…' : 'Salvar regra'}
        </Button>
        <Button action="email-rule-cancel" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        {!editing.isNew && (
          <Button action="email-rule-delete" variant="danger" onClick={() => onAskDelete(true)}>
            Apagar regra
          </Button>
        )}
      </div>
    </div>
  )
}
