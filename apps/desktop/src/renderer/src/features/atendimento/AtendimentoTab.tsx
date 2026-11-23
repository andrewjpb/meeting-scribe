// Aba "Atendimento" das Automações (contrato 142): os agentes que respondem as conversas do WhatsApp, em cartões com
// "Editar", "Duplicar" (salva a cópia na hora) e "Excluir" (confirma na própria linha), e o histórico abaixo. O
// formulário abre no lugar da lista. A conversa em que cada agente atua é marcada na tela do WhatsApp (contrato 143).
import { Bot, Copy, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AtendimentoAgent, AtendimentoAgentInput, AtendimentoBinding } from '@shared/atendimento'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import { useWhatsApp } from '../whatsapp/whatsappStore'
import { AtendimentoAgentForm, blankAtendimentoAgent } from './AtendimentoAgentForm'
import { AtendimentoLog } from './AtendimentoLog'
import { useAtendimento } from './atendimentoStore'
import { agentUsage, ATENDIMENTO_MODEL_LABELS, duplicateName } from './format'

/** Agente em edição: `null` é a lista. */
type Editing = { input: AtendimentoAgentInput } | null

const toInput = ({ id, name, instructions, tone, never, model }: AtendimentoAgent): AtendimentoAgentInput => ({ id, name, instructions, tone, never, model })

export function AtendimentoTab() {
  const loaded = useAtendimento((state) => state.loaded)
  const failure = useAtendimento((state) => state.failure)
  const state = useAtendimento((state) => state.state)
  const chatsLoaded = useWhatsApp((state) => state.chats !== null)
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => {
    void useAtendimento.getState().load()
    void useAtendimento.getState().loadLog()
  }, [])

  // Os nomes das conversas do histórico vêm da lista do WhatsApp; sem ela, aparece o número.
  useEffect(() => {
    if (!chatsLoaded) void useWhatsApp.getState().loadChats()
  }, [chatsLoaded])

  if (!loaded) {
    return failure ? <p className="text-13 text-text-muted">{failure}</p> : <div aria-busy="true" />
  }
  if (editing) return <AtendimentoAgentForm key={editing.input.id ?? 'novo'} initial={editing.input} onClose={() => setEditing(null)} />

  const agents = state?.agents ?? []
  const bindings = state?.bindings ?? []

  return (
    <div className="flex flex-col gap-6" data-atendimento-tab>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-13 text-text-muted">Respondem as conversas do WhatsApp que você marcar. Cada um só lê a conversa em que atua.</p>
          <Button action="atendimento-agent-new" icon={Plus} onClick={() => setEditing({ input: blankAtendimentoAgent() })}>
            Novo agente
          </Button>
        </div>
        {agents.length === 0 ? (
          <p data-atendimento-empty className="text-13 text-text-muted">
            Nenhum agente de atendimento ainda. Crie um e depois marque a conversa na tela do WhatsApp.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} agents={agents} bindings={bindings} onEdit={() => setEditing({ input: toInput(agent) })} />
            ))}
          </ul>
        )}
      </div>
      <AtendimentoLog />
    </div>
  )
}

function AgentCard({ agent, agents, bindings, onEdit }: { agent: AtendimentoAgent; agents: readonly AtendimentoAgent[]; bindings: readonly AtendimentoBinding[]; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const duplicate = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const name = duplicateName(
      agent.name,
      agents.map((item) => item.name),
    )
    const result = await useAtendimento.getState().saveAgent({ ...toInput(agent), id: null, name })
    setBusy(false)
    if (!result.ok) setFailure(result.reason)
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    const result = await useAtendimento.getState().deleteAgent(agent.id)
    setBusy(false)
    setConfirming(false)
    if (!result.ok) setFailure(result.reason)
  }
  const firstLine = agent.instructions.split('\n').find((line) => line.trim() !== '') ?? ''

  return (
    <li data-atendimento-agent={agent.id} data-atendimento-agent-name={agent.name} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line bg-bg-sunken text-text-muted">
          <Icon icon={Bot} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-13 font-semibold text-title">{agent.name}</h3>
          {firstLine && <p className="line-clamp-2 text-12 text-text-muted">{firstLine.trim()}</p>}
        </div>
      </div>
      <p className="flex flex-wrap gap-x-2 text-12 text-text-faint">
        <span>{ATENDIMENTO_MODEL_LABELS[agent.model]}</span>
        <span aria-hidden="true">·</span>
        <span data-atendimento-agent-usage>{agentUsage(agent.id, bindings)}</span>
      </p>
      {failure && (
        <Note id="atendimento-agent-error" icon={TriangleAlert} role="alert">
          {failure}
        </Note>
      )}
      <div className="-ml-2 mt-auto flex flex-wrap items-center gap-1">
        {confirming ? (
          <>
            <span className="px-2 text-12 text-text-muted">Excluir este agente? As conversas que ele atende ficam desligadas.</span>
            <button type="button" data-action="atendimento-agent-delete-confirm" onClick={() => void remove()} disabled={busy} className={`${QUIET_BUTTON} text-rec`}>
              Excluir
            </button>
            <button type="button" data-action="atendimento-agent-delete-cancel" onClick={() => setConfirming(false)} className={QUIET_BUTTON}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" data-action="atendimento-agent-edit" onClick={onEdit} className={QUIET_BUTTON}>
              <Icon icon={Pencil} />
              Editar
            </button>
            <button type="button" data-action="atendimento-agent-duplicate" onClick={() => void duplicate()} disabled={busy} className={QUIET_BUTTON}>
              <Icon icon={Copy} />
              Duplicar
            </button>
            <button type="button" data-action="atendimento-agent-delete" onClick={() => setConfirming(true)} className={QUIET_BUTTON}>
              <Icon icon={Trash2} />
              Excluir
            </button>
          </>
        )}
      </div>
    </li>
  )
}
