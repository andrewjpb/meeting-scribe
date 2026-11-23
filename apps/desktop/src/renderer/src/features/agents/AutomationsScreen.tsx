// Tela "Automações" (contrato 23, pedido de 16/11 19:25): no topo, "Pedir agora" (escolhe um agente, digita o
// pedido e roda na hora; a execução entra em "Execuções"); abaixo, as abas "Agentes", "Agendamentos" e
// "Execuções". Tudo roda no main; a tela só pede e mostra.
//
// Contrato 142: a quarta aba, "Atendimento", com os agentes que respondem as conversas do WhatsApp (store próprio,
// carregado pela aba; não espera a leitura das automações).
import { ArrowUp, Pause, Play } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { TASK_MESSAGE_MAX } from '@shared/automations'
import { Button } from '../../design/Button'
import { Select } from '../../design/Field'
import { PageHeader } from '../../design/PageHeader'
import { tabId, tabPanelId, Tabs } from '../../design/Tabs'
import { useChatMeetings, type ChatMeetings } from '../chat/useChatMeetings'
import { RunsTab } from '../schedules/RunsTab'
import { SchedulesTab } from '../schedules/SchedulesTab'
import { AtendimentoTab } from '../atendimento/AtendimentoTab'
import { AgentsTab } from './AgentsTab'
import { useAutomations, type AutomationsTab } from './automationsStore'
import { AREA_CLASS, RunAnswer } from './parts'

const TABS: readonly { value: AutomationsTab; label: string }[] = [
  { value: 'agentes', label: 'Agentes' },
  { value: 'tarefas', label: 'Agendamentos' },
  { value: 'execucoes', label: 'Execuções' },
  { value: 'atendimento', label: 'Atendimento' },
]
const TABS_ID = 'automations'

export function AutomationsScreen() {
  const tab = useAutomations((state) => state.tab)
  const loaded = useAutomations((state) => state.loaded)
  const failure = useAutomations((state) => state.failure)
  const status = useAutomations((state) => state.status)
  const meetings = useChatMeetings()

  useEffect(() => {
    void useAutomations.getState().load()
  }, [])

  const pauseText = status.paused ? (status.pauseReason === 'limit' ? `Agendamentos pausados: o limite diário de ${status.dailyLimit} execuções foi atingido.` : 'Agendamentos pausados.') : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-automations>
      <div className="px-8 pt-5">
        <PageHeader
          title="Automações"
          description={pauseText ?? 'Agentes que leem as suas reuniões e, se você deixar, a internet, e respondem na hora ou no horário que você escolher.'}
          actions={
            <Button
              action={status.paused ? 'automations-resume' : 'automations-pause'}
              variant="secondary"
              icon={status.paused ? Play : Pause}
              onClick={() => void window.__scribeApi.invoke('scribe:automations-pause', { paused: !status.paused }).then((next) => useAutomations.setState({ status: next }))}
            >
              {status.paused ? 'Retomar' : 'Pausar todos os agendamentos'}
            </Button>
          }
        />
        <AskNow meetings={meetings} />
        <div className="mt-4 border-b border-line">
          <Tabs value={tab} tabs={TABS} onChange={(next) => useAutomations.getState().setTab(next)} label="Seções das automações" id={TABS_ID} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-8" role="tabpanel" id={tabPanelId(TABS_ID, tab)} aria-labelledby={tabId(TABS_ID, tab)} data-automations-tab={tab}>
        {tab === 'atendimento' ? (
          <AtendimentoTab />
        ) : failure && !loaded ? (
          <p className="text-13 text-text-muted">{failure}</p>
        ) : !loaded ? (
          <div aria-busy="true" />
        ) : tab === 'agentes' ? (
          <AgentsTab meetings={meetings} />
        ) : tab === 'tarefas' ? (
          <SchedulesTab meetings={meetings} />
        ) : (
          <RunsTab meetings={meetings} />
        )}
      </div>
    </div>
  )
}

/** "Pedir agora": um agente, um pedido, na hora. A resposta aparece aqui e a execução fica em "Execuções". */
function AskNow({ meetings }: { meetings: ChatMeetings }) {
  const agents = useAutomations((state) => state.agents)
  const [agentId, setAgentId] = useState('')
  const [text, setText] = useState('')
  const [asked, setAsked] = useState<{ runId: string; prompt: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const running = useAutomations((state) => (asked ? !state.finished[asked.runId] : false))
  const chosen = agents.some((agent) => agent.id === agentId) ? agentId : (agents[0]?.id ?? '')

  const ask = async (): Promise<void> => {
    const request = text.trim()
    if (!request || !chosen || running) return
    setFailure(null)
    const result = await useAutomations.getState().ask(chosen, request)
    if ('reason' in result) {
      setFailure(result.reason)
      return
    }
    setAsked({ runId: result.runId, prompt: request })
    setText('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void ask()
    }
  }

  return (
    <section aria-label="Pedir agora" data-ask-now className="mt-4 flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-14 leading-5 font-semibold text-title">Pedir agora</h2>
        {agents.length > 0 && <Select id="ask-now-agent" value={chosen} options={agents.map((agent) => ({ value: agent.id, label: agent.name }))} onChange={setAgentId} />}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          id="ask-now-text"
          aria-label="Pedido ao agente"
          rows={2}
          value={text}
          maxLength={TASK_MESSAGE_MAX}
          placeholder={agents.length ? 'Peça algo ao agente. Ex.: Quais tarefas ficaram comigo esta semana?' : 'Crie um agente para pedir algo.'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!agents.length}
          className={`${AREA_CLASS} resize-none`}
        />
        <Button action="ask-now" icon={ArrowUp} onClick={() => void ask()} disabled={!text.trim() || !chosen || running}>
          {running ? 'Rodando…' : 'Pedir'}
        </Button>
      </div>
      {failure && <p className="text-13 text-rec">{failure}</p>}
      {asked && (
        <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto border-t border-line pt-3">
          <RunAnswer runId={asked.runId} prompt={asked.prompt} meetings={meetings} />
          <div className="flex items-center gap-4">
            <button type="button" data-action="ask-now-open-run" onClick={() => useAutomations.getState().openRun(asked.runId)} className="text-12 text-accent underline decoration-1 underline-offset-3 hover:text-title">
              Ver em Execuções
            </button>
            {/* A resposta fica em "Execuções": fechar devolve o espaço às abas. */}
            {!running && (
              <button type="button" data-action="ask-now-close" onClick={() => setAsked(null)} className="text-12 text-text-muted underline decoration-1 underline-offset-3 hover:text-title">
                Fechar
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
