// Formulário de agente (contrato 23, CA2): nome, descrição, ícone e cor, instruções (campo grande, com contador),
// modelo, "Pensar mais", escopo, saída padrão, "Pode pesquisar na internet" (contrato 26) e "Testar agora", que roda o agente do formulário (salvo ou não)
// com uma mensagem e mostra a resposta aqui mesmo, com raciocínio, passos e rodapé (componentes do chat 16).
// Conexões MCP só aparecem quando o contrato 21 existir.
import { ArrowLeft, Play } from 'lucide-react'
import { useState } from 'react'
import {
  AGENT_COLORS,
  AGENT_DESCRIPTION_MAX,
  AGENT_ICONS,
  AGENT_INSTRUCTIONS_COUNTER_FROM,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_MODEL_LABELS,
  AGENT_NAME_MAX,
  AGENT_OUTPUT_KINDS,
  AGENT_SCOPE_KINDS,
  OUTPUT_LABELS,
  SCOPE_LABELS,
  TASK_MESSAGE_MAX,
  type Agent,
  type AgentInput,
  type AgentOutputKind,
  type AgentScopeKind,
} from '@shared/automations'
import { NOTE_COLOR_LABELS } from '@shared/meeting-notes'
import { Button } from '../../design/Button'
import { Select, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { COLOR_CLASS } from '../../design/StickyNote'
import { Segmented } from '../../design/Segmented'
import { Switch } from '../../design/Switch'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { useAutomations } from './automationsStore'
import { AGENT_ICON_GLYPHS, AGENT_ICON_LABELS, AREA_CLASS, FormField, RunAnswer } from './parts'

const COUNT = new Intl.NumberFormat('pt-BR')

export function blankAgent(): AgentInput {
  return {
    id: null,
    name: '',
    description: '',
    icon: 'bot',
    color: 'blue',
    instructions: '',
    profile: 'claude',
    model: 'sonnet',
    thinkMore: false,
    scope: { kind: 'all' },
    web: false,
    mcpServers: [],
    output: { kind: 'chat' },
  }
}

/** "Resumo da semana (cópia)", "(cópia 2)"…, até 40 caracteres. */
export function copyName(name: string, agents: readonly Pick<Agent, 'name'>[]): string {
  const taken = new Set(agents.map((agent) => agent.name.toLocaleLowerCase('pt-BR')))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (cópia)' : ` (cópia ${n})`
    const candidate = `${name.slice(0, AGENT_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate.toLocaleLowerCase('pt-BR'))) return candidate
  }
}

export function AgentForm({ initial, meetings, onClose }: { initial: AgentInput; meetings: ChatMeetings; onClose: () => void }) {
  const models = useAutomations((state) => state.models)
  const mcp = useAutomations((state) => state.mcp)
  const [agent, setAgent] = useState<AgentInput>(initial)
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testText, setTestText] = useState('')
  const [test, setTest] = useState<{ runId: string; prompt: string } | null>(null)
  const [testFailure, setTestFailure] = useState<string | null>(null)
  const testing = useAutomations((state) => (test ? state.live[test.runId] !== undefined && !state.finished[test.runId] : false))
  const patch = (next: Partial<AgentInput>): void => setAgent((current) => ({ ...current, ...next }))

  const meetingList = meetings.list ?? []
  const valid = agent.name.trim() !== '' && agent.name.length <= AGENT_NAME_MAX && agent.instructions.length <= AGENT_INSTRUCTIONS_MAX && (agent.output.kind !== 'note' || Boolean(agent.output.meetingId) || agent.scope.kind !== 'none')

  const save = async (): Promise<void> => {
    setSaving(true)
    setFailure(null)
    const result = await useAutomations.getState().saveAgent(agent)
    setSaving(false)
    if (!result.ok) setFailure(result.reason)
    else onClose()
  }

  const runTest = async (): Promise<void> => {
    setTestFailure(null)
    const text = testText.trim()
    const started = await useAutomations.getState().testAgent({ ...agent, name: agent.name.trim() || 'Agente sem nome' }, text)
    if ('reason' in started) setTestFailure(started.reason)
    else setTest({ runId: started.runId, prompt: text })
  }

  const scopeOptions = AGENT_SCOPE_KINDS.map((kind) => ({ value: kind, label: SCOPE_LABELS[kind] }))
  const outputOptions = AGENT_OUTPUT_KINDS.map((kind) => ({ value: kind, label: OUTPUT_LABELS[kind] }))
  const meetingOptions = [{ value: '', label: 'Escolha a reunião' }, ...meetingList.map((entry) => ({ value: entry.meeting.id, label: entry.meeting.title }))]
  const chosen = new Set(agent.scope.meetingIds ?? [])

  return (
    <div data-agent-form className="flex max-w-[760px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" data-action="agent-form-back" onClick={onClose} className={QUIET_BUTTON}>
          <Icon icon={ArrowLeft} size={14} />
          Agentes
        </button>
        <h2 className="text-15 font-bold text-title">{initial.id ? 'Editar agente' : 'Novo agente'}</h2>
      </div>

      <FormField label="Nome" htmlFor="agent-name">
        <TextField id="agent-name" value={agent.name} onChange={(name) => patch({ name })} maxLength={AGENT_NAME_MAX} placeholder="Ex.: Resumo da semana" />
      </FormField>
      <FormField label="Descrição" htmlFor="agent-description">
        <TextField id="agent-description" value={agent.description} onChange={(description) => patch({ description })} maxLength={AGENT_DESCRIPTION_MAX} placeholder="O que este agente faz, numa frase" />
      </FormField>

      <FormField label="Ícone e cor" labelId="agent-look">
        <div className="flex flex-wrap items-center gap-4" role="group" aria-labelledby="agent-look">
          <div className="flex gap-1">
            {AGENT_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                data-agent-icon={icon}
                aria-pressed={agent.icon === icon}
                aria-label={AGENT_ICON_LABELS[icon]}
                onClick={() => patch({ icon })}
                className={`no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${agent.icon === icon ? 'border-title bg-bg-sunken text-title' : 'border-line text-text-muted hover:bg-bg-sunken'}`}
              >
                <Icon icon={AGENT_ICON_GLYPHS[icon]} />
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {AGENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-agent-color={color}
                aria-pressed={agent.color === color}
                aria-label={NOTE_COLOR_LABELS[color]}
                onClick={() => patch({ color })}
                className={`no-drag size-6 rounded-[var(--radius-control)] border-2 ${COLOR_CLASS[color].swatch} ${agent.color === color ? 'border-title' : COLOR_CLASS[color].edge}`}
              />
            ))}
          </div>
        </div>
      </FormField>

      <FormField
        label="Instruções"
        htmlFor="agent-instructions"
        hint={
          <>
            O que o agente deve fazer a cada pedido. Ele lê as reuniões do escopo, sem escrever nada e sem enviar nada a ninguém.
            {agent.instructions.length >= AGENT_INSTRUCTIONS_COUNTER_FROM && (
              <span data-agent-instructions-count className="ml-2 tabular">
                {COUNT.format(agent.instructions.length)} / {COUNT.format(AGENT_INSTRUCTIONS_MAX)}
              </span>
            )}
          </>
        }
      >
        <textarea id="agent-instructions" rows={10} value={agent.instructions} maxLength={AGENT_INSTRUCTIONS_MAX} onChange={(event) => patch({ instructions: event.target.value })} className={AREA_CLASS} />
      </FormField>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <FormField label="Modelo" labelId="agent-model">
          <Segmented value={agent.model} options={models.map((model) => ({ value: model, label: AGENT_MODEL_LABELS[model] }))} labelledBy="agent-model" dataName="agent-model-option" onChange={(model) => patch({ model })} />
        </FormField>
        <FormField label="Pensar mais" labelId="agent-think-more" hint="O modelo raciocina mais antes de responder. Demora mais.">
          <Switch checked={agent.thinkMore} labelledBy="agent-think-more" onChange={(thinkMore) => patch({ thinkMore })} />
        </FormField>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <FormField label="Escopo" htmlFor="agent-scope" hint="As reuniões que o agente lê.">
          <Select
            id="agent-scope"
            value={agent.scope.kind}
            options={scopeOptions}
            onChange={(kind: AgentScopeKind) => patch({ scope: kind === 'meetings' ? { kind, meetingIds: agent.scope.meetingIds ?? [] } : { kind } })}
          />
        </FormField>
        <FormField label="Saída padrão" htmlFor="agent-output" hint="Toda execução também fica em Execuções.">
          <Select id="agent-output" value={agent.output.kind} options={outputOptions} onChange={(kind: AgentOutputKind) => patch({ output: kind === 'note' ? { kind, meetingId: agent.output.meetingId ?? null } : { kind } })} />
        </FormField>
      </div>

      <FormField label="Pode pesquisar na internet" labelId="agent-web" hint="Busca na web e abre as páginas que encontrar. Não abre endereços inventados.">
        <div data-agent-web>
          <Switch checked={agent.web} labelledBy="agent-web" onChange={(web) => patch({ web })} />
        </div>
      </FormField>

      {agent.scope.kind === 'meetings' && (
        <fieldset data-agent-scope-meetings className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-[var(--radius-panel)] border border-line-strong p-3">
          <legend className="px-1 text-12 text-text-muted">Reuniões escolhidas</legend>
          {meetingList.length === 0 && <p className="text-12 text-text-muted">Nenhuma reunião neste Mac.</p>}
          {meetingList.map((entry) => (
            <label key={entry.meeting.id} className="flex items-center gap-2 text-13 text-text">
              <input
                type="checkbox"
                checked={chosen.has(entry.meeting.id)}
                onChange={(event) => {
                  const next = new Set(chosen)
                  if (event.target.checked) next.add(entry.meeting.id)
                  else next.delete(entry.meeting.id)
                  patch({ scope: { kind: 'meetings', meetingIds: [...next] } })
                }}
              />
              <span className="truncate">{entry.meeting.title}</span>
            </label>
          ))}
        </fieldset>
      )}

      {agent.output.kind === 'note' && (
        <FormField label="Reunião do post-it" htmlFor="agent-output-meeting" hint="Nas tarefas “Depois de cada reunião”, o post-it vai para a reunião que acabou.">
          <Select id="agent-output-meeting" value={agent.output.meetingId ?? ''} options={meetingOptions} onChange={(meetingId) => patch({ output: { kind: 'note', meetingId: meetingId || null } })} />
        </FormField>
      )}

      {/* Contrato 21: as conexões MCP do agente aparecem aqui quando existirem. */}
      {mcp && <FormField label="Conexões MCP">{null}</FormField>}

      {failure && (
        <p role="alert" data-agent-form-error className="text-13 text-rec">
          {failure}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button action="agent-save" onClick={() => void save()} disabled={!valid || saving}>
          Salvar agente
        </Button>
        <Button action="agent-cancel" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>

      <section aria-label="Testar agora" data-agent-test className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-14 leading-5 font-semibold text-title">Testar agora</h3>
        <p className="text-12 text-text-muted">Roda o agente como está no formulário, sem salvar, e mostra a resposta aqui. Não entra em Execuções.</p>
        <textarea
          id="agent-test-text"
          aria-label="Mensagem para o teste"
          rows={3}
          value={testText}
          maxLength={TASK_MESSAGE_MAX}
          placeholder="Ex.: O que ficou decidido esta semana?"
          onChange={(event) => setTestText(event.target.value)}
          className={AREA_CLASS}
        />
        <div>
          <Button action="agent-test" variant="secondary" icon={Play} onClick={() => void runTest()} disabled={!testText.trim() || testing}>
            {testing ? 'Testando…' : 'Testar agora'}
          </Button>
        </div>
        {testFailure && <p className="text-13 text-rec">{testFailure}</p>}
        {test && <RunAnswer runId={test.runId} prompt={test.prompt} meetings={meetings} />}
      </section>
    </div>
  )
}
