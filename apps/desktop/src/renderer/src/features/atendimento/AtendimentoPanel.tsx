// Painel "Atendimento" da conversa (contrato 143): as opções do atendimento daquela conversa, ao lado da conversa, no
// lugar dos Detalhes (um painel por vez). Salvar com "Responder sozinho" antes do aceite do risco troca o formulário
// pelo aviso (`AtendimentoRisk`). Sem agente nenhum, só o caminho para criar um nas Automações. O histórico da conversa
// é lido aqui, com o `chatId` (a leitura da aba das Automações tem o filtro dela e não é tocada).
import { Bot, Info, Pause, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ATENDIMENTO_ABOUT_MAX, ATENDIMENTO_LOG_LIST_MAX, type AtendimentoLogEntry, type AtendimentoMode } from '@shared/atendimento'
import { ROUTE_PATHS } from '@shared/routes'
import type { WhatsAppChat } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { CONTROL_CLASS, Select } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { Segmented } from '../../design/Segmented'
import { Switch } from '../../design/Switch'
import { AREA_CLASS } from '../agents/parts'
import { useAutomations } from '../agents/automationsStore'
import { useAtendimentoNow } from './AtendimentoBadge'
import { AtendimentoRisk } from './AtendimentoRisk'
import { useAtendimento } from './atendimentoStore'
import { bindingDraft, bindingInput, bindingProblems, DEFAULT_PICKED_HOURS, pausedNow, repliesToday, untilLabel, type BindingDraft } from './status'

const EMPTY_LOG: readonly AtendimentoLogEntry[] = []
const SAVE_FAILURE = 'Não foi possível salvar.'

/**
 * O histórico de uma conversa com atendimento (até 1.000 linhas), relido a cada aviso do serviço sobre ela e a cada
 * mensagem minha nela (a resposta do agente chega como mensagem minha). `active` falso: nada é lido.
 */
export function useAtendimentoChatLog(chatId: string | null, active: boolean): readonly AtendimentoLogEntry[] {
  const [log, setLog] = useState<{ chatId: string; entries: AtendimentoLogEntry[] } | null>(null)
  useEffect(() => {
    if (!chatId || !active) return
    let alive = true
    const read = (): void => {
      void window.__scribeApi.invoke('scribe:atendimento-log-list', { limit: ATENDIMENTO_LOG_LIST_MAX, chatId }).then(
        (result) => {
          if (alive && result.ok) setLog({ chatId, entries: result.entries })
        },
        () => undefined,
      )
    }
    read()
    const offChanged = window.__scribeApi.on('scribe:atendimento-changed', (event) => {
      if (event.chatId === chatId) read()
    })
    const offMessage = window.__scribeApi.on('scribe:whatsapp-message', ({ message }) => {
      if (message.chatId === chatId && message.fromMe) read()
    })
    return () => {
      alive = false
      offChanged()
      offMessage()
    }
  }, [chatId, active])
  return active && log?.chatId === chatId ? log.entries : EMPTY_LOG
}

/** Segunda primeiro; cada letra com o nome inteiro para o leitor de tela. */
const WEEK: readonly { day: number; letter: string; name: string }[] = [
  { day: 1, letter: 'S', name: 'Segunda-feira' },
  { day: 2, letter: 'T', name: 'Terça-feira' },
  { day: 3, letter: 'Q', name: 'Quarta-feira' },
  { day: 4, letter: 'Q', name: 'Quinta-feira' },
  { day: 5, letter: 'S', name: 'Sexta-feira' },
  { day: 6, letter: 'S', name: 'Sábado' },
  { day: 0, letter: 'D', name: 'Domingo' },
]

const MODES: readonly { value: AtendimentoMode; label: string }[] = [
  { value: 'draft', label: 'Rascunho para eu aprovar' },
  { value: 'auto', label: 'Responder sozinho' },
]

const HOURS_OPTIONS = [
  { value: 'always', label: 'Sempre' },
  { value: 'pick', label: 'Escolher' },
] as const

const NUMBER_CLASS = `${CONTROL_CLASS} w-14 px-2 text-center tabular select-text`
const TIME_CLASS = `${CONTROL_CLASS} w-[72px] px-2 text-center tabular select-text`

/** A frase do problema junto do campo. */
function Problem({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null
  return (
    <p id={id} data-atendimento-problem className="text-12 text-rec">
      {text}
    </p>
  )
}

function Group({ label, labelId, htmlFor, children }: { label: string; labelId?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className="text-13 font-medium text-title">
          {label}
        </label>
      ) : (
        <p id={labelId} className="text-13 font-medium text-title">
          {label}
        </p>
      )}
      {children}
    </div>
  )
}

/** Uma linha com o nome, o interruptor à direita e a frase de apoio embaixo. */
function SwitchRow({ label, checked, onChange, action, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; action: string; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-13 font-medium text-title">
          {label}
        </span>
        <Switch checked={checked} onChange={onChange} labelledBy={id} action={action} />
      </div>
      {hint}
    </div>
  )
}

interface AtendimentoPanelProps {
  chat: WhatsAppChat
  /** O histórico da conversa (`useAtendimentoChatLog`), para "N respostas hoje". */
  log: readonly AtendimentoLogEntry[]
  onClose: () => void
}

export function AtendimentoPanel({ chat, log, onClose }: AtendimentoPanelProps) {
  const loaded = useAtendimento((state) => state.loaded)
  const state = useAtendimento((state) => state.state)
  const navigate = useNavigate()
  const agents = state?.agents ?? []

  return (
    <aside data-wa-atendimento aria-label="Atendimento" className="flex w-[300px] shrink-0 flex-col border-l border-line bg-bg">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <h2 className="text-13 font-bold text-title">Atendimento</h2>
        <button
          type="button"
          data-action="whatsapp-atendimento-close"
          aria-label="Fechar o painel Atendimento"
          onClick={onClose}
          className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title"
        >
          <Icon icon={X} />
        </button>
      </div>
      {!loaded ? (
        <div aria-busy="true" />
      ) : agents.length === 0 ? (
        <div data-atendimento-no-agents className="flex flex-col items-start gap-3 px-3 py-3">
          <p className="text-13 text-text">Crie um agente de atendimento antes de marcar esta conversa.</p>
          <Button
            action="atendimento-create-agent"
            variant="secondary"
            icon={Bot}
            onClick={() => {
              useAutomations.getState().setTab('atendimento')
              void navigate(ROUTE_PATHS.automacoes)
            }}
          >
            Criar agente
          </Button>
        </div>
      ) : (
        // Trocar de conversa recomeça o formulário com os dados da nova.
        <BindingForm key={chat.id} chat={chat} log={log} />
      )}
    </aside>
  )
}

function BindingForm({ chat, log }: { chat: WhatsAppChat; log: readonly AtendimentoLogEntry[] }) {
  const state = useAtendimento((store) => store.state)
  const navigate = useNavigate()
  const now = new Date(useAtendimentoNow())
  const agents = state?.agents ?? []
  const binding = state?.bindings.find((item) => item.chatId === chat.id)
  const firstAgent = agents[0]?.id ?? ''
  // Atendimento que aponta para um agente que não existe mais começa no primeiro da lista.
  const initial = (): BindingDraft => {
    const draft = bindingDraft(binding, firstAgent)
    return agents.some((agent) => agent.id === draft.agentId) ? draft : { ...draft, agentId: firstAgent }
  }
  const [draft, setDraft] = useState<BindingDraft>(initial)
  const [view, setView] = useState<'form' | 'risk'>('form')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const problems = bindingProblems(draft)
  const blocked = Object.keys(problems).length > 0
  const ids = { mode: useId(), delay: useId(), hours: useId(), max: useId(), pause: useId(), about: useId(), agent: useId() }

  const patch = (next: Partial<BindingDraft>): void => {
    setDraft((current) => ({ ...current, ...next }))
    setSaved(false)
  }

  const store = async (): Promise<void> => {
    const result = await useAtendimento
      .getState()
      .saveBinding(bindingInput(chat.id, draft))
      .catch(() => ({ ok: false as const, reason: SAVE_FAILURE }))
    if (result.ok) {
      setView('form')
      setSaved(true)
    } else if (result.reason === 'risk-required') setView('risk')
    else {
      // O aviso de erro mora no formulário: uma falha depois do aceite do risco
      // volta para ele, senão o clique em "Ligar atendimento" parece não fazer nada.
      setFailure(result.reason)
      setView('form')
    }
  }

  const save = async (): Promise<void> => {
    if (blocked || busy) return
    setFailure(null)
    setSaved(false)
    if (draft.mode === 'auto' && draft.enabled && state?.riskAcceptedAt === null) {
      setView('risk')
      return
    }
    setBusy(true)
    await store()
    setBusy(false)
  }

  const accept = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const accepted = await useAtendimento
      .getState()
      .acceptRisk()
      .catch(() => ({ ok: false as const, reason: SAVE_FAILURE }))
    if (accepted.ok) await store()
    else {
      setFailure(accepted.reason)
      setView('form')
    }
    setBusy(false)
  }

  if (view === 'risk') return <AtendimentoRisk draft={draft} busy={busy} onAccept={() => void accept()} onCancel={() => setView('form')} />

  const replies = binding ? repliesToday(log, chat.id, now) : null
  const paused = binding && pausedNow(binding, now) && binding.pausedUntil ? untilLabel(binding.pausedUntil, now) : null

  return (
    <div data-atendimento-form className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <SwitchRow
          label="Atender esta conversa"
          checked={draft.enabled}
          onChange={(enabled) => patch({ enabled })}
          action="atendimento-binding-enabled"
          hint={
            replies !== null && (
              <p data-atendimento-replies-today className="text-12 text-text-muted tabular">
                {replies === 1 ? '1 resposta hoje' : `${replies} respostas hoje`}
              </p>
            )
          }
        />
        {paused && (
          <Note id="atendimento-paused" icon={Pause} role="status" layout="stacked">
            Pausado até {paused} porque você respondeu.
          </Note>
        )}
        <Note id="atendimento-app-open" icon={Info} layout="stacked">
          Só responde com o app aberto e o Mac acordado.
        </Note>

        <Group label="Agente" htmlFor={ids.agent}>
          <div className="flex [&>select]:w-full [&>select]:min-w-0">
            <Select id={ids.agent} value={draft.agentId} options={agents.map((agent) => ({ value: agent.id, label: agent.name }))} onChange={(agentId) => patch({ agentId })} />
          </div>
          <Problem id={`${ids.agent}-problem`} text={problems.agent} />
        </Group>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-13 font-medium text-title">Modo</legend>
          <div className="flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
            {MODES.map((mode, index) => (
              <label
                key={mode.value}
                className={`flex h-8 cursor-default items-center gap-2 px-2.5 text-13 ${index > 0 ? 'border-t border-line-strong' : ''} ${draft.mode === mode.value ? 'bg-bg-sunken font-medium text-title' : 'bg-bg-raised text-text'}`}
              >
                <input
                  type="radio"
                  name={`${ids.mode}-mode`}
                  data-atendimento-mode={mode.value}
                  checked={draft.mode === mode.value}
                  onChange={() => patch({ mode: mode.value })}
                  className="no-drag size-4 shrink-0 accent-accent"
                />
                {mode.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Group label="Responder depois de" labelId={ids.delay}>
          <div className="flex items-center gap-2 text-13 text-text">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Mínimo, em minutos"
              aria-describedby={problems.delay ? `${ids.delay}-problem` : undefined}
              data-atendimento-delay-min
              value={draft.delayMin}
              onChange={(event) => patch({ delayMin: event.target.value })}
              className={NUMBER_CLASS}
            />
            a
            <input
              type="text"
              inputMode="numeric"
              aria-label="Máximo, em minutos"
              aria-describedby={problems.delay ? `${ids.delay}-problem` : undefined}
              data-atendimento-delay-max
              value={draft.delayMax}
              onChange={(event) => patch({ delayMax: event.target.value })}
              className={NUMBER_CLASS}
            />
            minutos
          </div>
          <Problem id={`${ids.delay}-problem`} text={problems.delay} />
          <p className="text-12 text-text-muted">Sorteado a cada resposta. Iguais, o atraso é fixo.</p>
        </Group>

        <SwitchRow label="Mostrar “digitando…” antes de enviar" checked={draft.typing} onChange={(typing) => patch({ typing })} action="atendimento-binding-typing" />
        <SwitchRow
          label="Apresenta-se como assistente"
          checked={draft.identify}
          onChange={(identify) => patch({ identify })}
          action="atendimento-binding-identify"
          hint={<p className="text-12 text-text-muted">A primeira resposta do dia começa com “Aqui é o assistente”.</p>}
        />

        <Group label="Quem é esta pessoa" htmlFor={ids.about}>
          <textarea id={ids.about} rows={3} value={draft.about} maxLength={ATENDIMENTO_ABOUT_MAX} onChange={(event) => patch({ about: event.target.value })} className={AREA_CLASS} />
          <Problem id={`${ids.about}-problem`} text={problems.about} />
        </Group>

        <Group label="Horário de atendimento" labelId={ids.hours}>
          <div className="flex">
            <Segmented
              value={draft.hoursMode}
              options={HOURS_OPTIONS}
              labelledBy={ids.hours}
              dataName="atendimento-hours"
              onChange={(hoursMode) => patch(hoursMode === 'pick' && draft.days.length === 0 ? { hoursMode, days: [...DEFAULT_PICKED_HOURS.days] } : { hoursMode })}
            />
          </div>
          {draft.hoursMode === 'pick' && (
            <>
              <div role="group" aria-label="Dias da semana" className="flex gap-1">
                {WEEK.map(({ day, letter, name }) => {
                  const on = draft.days.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      data-atendimento-day={day}
                      aria-pressed={on}
                      aria-label={name}
                      title={name}
                      onClick={() => patch({ days: on ? draft.days.filter((item) => item !== day) : [...draft.days, day] })}
                      className={`no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] border text-12 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
                        on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-bg-raised text-text-muted hover:bg-bg-sunken'
                      }`}
                    >
                      {letter}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 text-13 text-text">
                <input type="text" aria-label="Começa às (HH:MM)" placeholder="HH:MM" maxLength={5} data-atendimento-hours-start value={draft.start} onChange={(event) => patch({ start: event.target.value })} className={TIME_CLASS} />
                às
                <input type="text" aria-label="Termina às (HH:MM)" placeholder="HH:MM" maxLength={5} data-atendimento-hours-end value={draft.end} onChange={(event) => patch({ end: event.target.value })} className={TIME_CLASS} />
              </div>
            </>
          )}
          <Problem id={`${ids.hours}-problem`} text={problems.hours} />
        </Group>

        <Group label="Limite de respostas por hora" htmlFor={ids.max}>
          <div className="flex items-center gap-2 text-13 text-text">
            <input id={ids.max} type="text" inputMode="numeric" data-atendimento-max-per-hour value={draft.maxPerHour} onChange={(event) => patch({ maxPerHour: event.target.value })} className={NUMBER_CLASS} />
            por hora, nesta conversa
          </div>
          <Problem id={`${ids.max}-problem`} text={problems.maxPerHour} />
        </Group>

        <Group label="Pausar quando eu responder" htmlFor={ids.pause}>
          <div className="flex items-center gap-2 text-13 text-text">
            <input id={ids.pause} type="text" inputMode="numeric" data-atendimento-pause value={draft.pause} onChange={(event) => patch({ pause: event.target.value })} className={NUMBER_CLASS} />
            minutos
          </div>
          <Problem id={`${ids.pause}-problem`} text={problems.pause} />
        </Group>

        {failure && (
          <Note id="atendimento-binding-error" icon={TriangleAlert} role="alert" layout="stacked">
            {failure}
          </Note>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-3">
        <Button action="atendimento-binding-save" onClick={() => void save()} disabled={blocked || busy}>
          Salvar
        </Button>
        <Button
          action="atendimento-binding-cancel"
          variant="secondary"
          onClick={() => {
            setDraft(initial())
            setFailure(null)
            setSaved(false)
          }}
          disabled={busy}
        >
          Cancelar
        </Button>
        {saved && (
          <span role="status" data-atendimento-saved className="text-12 text-text-muted">
            Salvo.
          </span>
        )}
        <button
          type="button"
          data-action="atendimento-open-history"
          onClick={() => {
            void useAtendimento.getState().setLogChatId(chat.id)
            useAutomations.getState().setTab('atendimento')
            void navigate(ROUTE_PATHS.automacoes)
          }}
          className={`${NOTE_ACTION_CLASS} ml-auto text-13`}
        >
          Ver histórico
        </button>
      </div>
    </div>
  )
}
