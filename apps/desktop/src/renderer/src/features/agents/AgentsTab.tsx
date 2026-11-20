// Aba "Agentes" (contrato 23, CA2): os agentes em cartões, com "Novo agente", "Duplicar", "Editar" e "Excluir"
// (confirma; recusado se uma tarefa usa o agente, com a lista das tarefas). O formulário abre no lugar da lista.
import { Copy, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { AGENT_MODEL_LABELS, SCOPE_LABELS, type Agent, type AgentInput } from '@shared/automations'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import type { ChatMeetings } from '../chat/useChatMeetings'
import { AgentForm, blankAgent, copyName } from './AgentForm'
import { useAutomations } from './automationsStore'
import { AgentBadge } from './parts'

/** Agente em edição: `null` é a lista. */
type Editing = { input: AgentInput } | null

export function AgentsTab({ meetings }: { meetings: ChatMeetings }) {
  const agents = useAutomations((state) => state.agents)
  const usage = useAutomations((state) => state.usage)
  const [editing, setEditing] = useState<Editing>(null)

  if (editing) return <AgentForm key={editing.input.id ?? 'novo'} initial={editing.input} meetings={meetings} onClose={() => setEditing(null)} />

  const toInput = (agent: Agent): AgentInput => {
    const { createdAt: _created, updatedAt: _updated, ...fields } = agent
    return fields
  }

  return (
    <div className="flex flex-col gap-4" data-agents-tab>
      <div className="flex items-center justify-between gap-4">
        <p className="text-13 text-text-muted">Cada agente tem instruções, um modelo e as reuniões que ele lê. Ele só lê e responde: nunca envia nada a ninguém.</p>
        <Button action="agent-new" icon={Plus} onClick={() => setEditing({ input: blankAgent() })}>
          Novo agente
        </Button>
      </div>
      {agents.length === 0 ? (
        <p data-agents-empty className="text-13 text-text-muted">
          Nenhum agente ainda. Crie um com "Novo agente".
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              tasks={usage[agent.id] ?? []}
              onEdit={() => setEditing({ input: toInput(agent) })}
              onDuplicate={() => setEditing({ input: { ...toInput(agent), id: null, name: copyName(agent.name, agents) } })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function AgentCard({ agent, tasks, onEdit, onDuplicate }: { agent: Agent; tasks: readonly string[]; onEdit: () => void; onDuplicate: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [blocked, setBlocked] = useState<string[] | null>(null)
  const remove = async (): Promise<void> => {
    const result = await useAutomations.getState().deleteAgent(agent.id)
    if (!result.ok) setBlocked(result.tasks)
    setConfirming(false)
  }
  const used = tasks.length === 0 ? 'Nenhuma tarefa' : tasks.length === 1 ? '1 tarefa' : `${tasks.length} tarefas`
  return (
    <li data-agent-card={agent.id} data-agent-name={agent.name} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <div className="flex items-start gap-2.5">
        <AgentBadge icon={agent.icon} color={agent.color} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-13 font-semibold text-title">{agent.name}</h3>
          {agent.description && <p className="line-clamp-2 text-12 text-text-muted">{agent.description}</p>}
        </div>
      </div>
      <p className="flex flex-wrap gap-x-2 text-12 text-text-faint">
        <span>{AGENT_MODEL_LABELS[agent.model]}</span>
        <span aria-hidden="true">·</span>
        <span>{SCOPE_LABELS[agent.scope.kind]}</span>
        <span aria-hidden="true">·</span>
        <span data-agent-tasks={tasks.length}>{used}</span>
        {agent.web && (
          <>
            <span aria-hidden="true">·</span>
            <span data-agent-web-badge>Internet</span>
          </>
        )}
      </p>
      {blocked && (
        <Note id="agent-in-use" icon={TriangleAlert} role="alert">
          {`Não dá para excluir: usado por ${blocked.map((name) => `«${name}»`).join(', ')}. Troque o agente dessas tarefas antes.`}
        </Note>
      )}
      <div className="-ml-2 mt-auto flex flex-wrap items-center gap-1">
        <button type="button" data-action="agent-edit" onClick={onEdit} className={QUIET_BUTTON}>
          <Icon icon={Pencil} size={14} />
          Editar
        </button>
        <button type="button" data-action="agent-duplicate" onClick={onDuplicate} className={QUIET_BUTTON}>
          <Icon icon={Copy} size={14} />
          Duplicar
        </button>
        {confirming ? (
          <>
            <span className="px-2 text-12 text-text-muted">Excluir este agente?</span>
            <button type="button" data-action="agent-delete-confirm" onClick={() => void remove()} className={`${QUIET_BUTTON} text-rec`}>
              Excluir
            </button>
            <button type="button" data-action="agent-delete-cancel" onClick={() => setConfirming(false)} className={QUIET_BUTTON}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" data-action="agent-delete" onClick={() => (tasks.length ? setBlocked([...tasks]) : setConfirming(true))} className={QUIET_BUTTON}>
            <Icon icon={Trash2} size={14} />
            Excluir
          </button>
        )}
      </div>
    </li>
  )
}
