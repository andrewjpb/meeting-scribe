// Automações no renderer (contrato 23): agentes, tarefas, execuções e o estado do agendador, como o main
// devolveu, e a resposta das execuções em curso (o mesmo formato da resposta do chat 16, por
// `scribe:automation-event`). O agendador mora no main: aqui só fica a cópia para a tela. O store continua vivo
// fora da tela: uma execução que termina com a pessoa em outra tela aparece pronta quando ela volta.
import { create } from 'zustand'
import type { ChatActionRef } from '@shared/assistant'
import {
  EMPTY_AUTOMATIONS_STATUS,
  type Agent,
  type AgentInput,
  type AgentModel,
  type AutomationRun,
  type AutomationRunListItem,
  type AutomationsStatus,
  type RunStartResult,
  type ScheduledTask,
  type TaskInput,
} from '@shared/automations'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { emptyAnswer, upsertStep, type LiveAnswer } from '../chat/chatStore'

export type AutomationsTab = 'agentes' | 'tarefas' | 'execucoes'

interface AutomationsState {
  loaded: boolean
  failure: string | null
  agents: Agent[]
  /** Nome das tarefas que usam cada agente. */
  usage: Record<string, string[]>
  models: AgentModel[]
  /** Contrato 21 (MCP): ainda não existe, o campo fica escondido. */
  mcp: boolean
  tasks: ScheduledTask[]
  runs: AutomationRunListItem[]
  status: AutomationsStatus
  /** Resposta em curso de cada execução. */
  live: Record<string, LiveAnswer>
  /** Execuções que terminaram nesta sessão (a resposta inteira, para "Testar agora" e "Pedir agora"). */
  finished: Record<string, AutomationRun>
  tab: AutomationsTab
  /** Execução aberta na aba "Execuções" (`null`: a lista). */
  openRunId: string | null
  /**
   * Contrato 25: "Criar tarefa" num cartão do Assistente. A aba "Tarefas agendadas" abre o formulário com isto
   * preenchido; salvar marca o cartão (`origin`) como "Tarefa criada".
   */
  taskDraft: { input: TaskInput; origin: ChatActionRef } | null
  openTaskDraft: (input: TaskInput, origin: ChatActionRef) => void
  /** O formulário pegou o rascunho (uma vez só). */
  takeTaskDraft: () => { input: TaskInput; origin: ChatActionRef } | null
  load: () => Promise<void>
  setTab: (tab: AutomationsTab) => void
  openRun: (id: string | null) => void
  saveAgent: (input: AgentInput) => Promise<{ ok: true; agent: Agent } | { ok: false; reason: string }>
  deleteAgent: (id: string) => Promise<{ ok: true } | { ok: false; reason: string; tasks: string[] }>
  testAgent: (input: AgentInput, text: string) => Promise<{ runId: string } | { reason: string }>
  ask: (agentId: string, text: string) => Promise<{ runId: string } | { reason: string }>
}

let listening = false
let reread: (() => void) | null = null

const startReason = (result: RunStartResult): string =>
  result.ok ? '' : result.error === 'busy' ? 'Esta tarefa já está rodando.' : result.error === 'missing' ? 'O agente não existe mais.' : 'Confira o agente e o pedido.'

async function readAll(): Promise<Partial<AutomationsState>> {
  const [agents, tasks, runs, status] = await Promise.all([
    window.__scribeApi.invoke('scribe:agents-list'),
    window.__scribeApi.invoke('scribe:tasks-list'),
    window.__scribeApi.invoke('scribe:runs-list', {}),
    window.__scribeApi.invoke('scribe:automations-status'),
  ])
  return { agents: agents.agents, usage: agents.usage, models: agents.models, mcp: agents.mcp, tasks, runs, status, loaded: true, failure: null }
}

/** Uma vez só: as execuções e as mudanças do agendador chegam a qualquer tela. */
function listen(): void {
  if (listening) return
  listening = true
  window.__scribeApi.on('scribe:automation-event', (event) => {
    if (event.type === 'done') {
      useAutomations.setState((state) => {
        const live = Object.fromEntries(Object.entries(state.live).filter(([id]) => id !== event.runId))
        return { live, finished: { ...state.finished, [event.runId]: event.run } }
      })
      void useAutomations.getState().load()
      return
    }
    useAutomations.setState((state) => {
      const current = state.live[event.runId] ?? emptyAnswer()
      let next: LiveAnswer
      if (event.type === 'answer') next = { ...current, text: event.text, reading: event.reading }
      else if (event.type === 'thinking') next = { ...current, thinking: current.thinking + event.delta }
      else if (event.type === 'step') next = { ...current, steps: upsertStep(current.steps, event.step) }
      else if (event.type === 'plan') next = { ...current, plan: event.entries }
      else if (event.type === 'denied') next = { ...current, denied: event.count }
      else if (event.type === 'meta') next = { ...current, meta: event.meta }
      else return state
      return { live: { ...state.live, [event.runId]: next } }
    })
  })
  window.__scribeApi.on('scribe:automations-changed', (status) => {
    useAutomations.setState({ status })
    if (useAutomations.getState().loaded) void useAutomations.getState().load()
  })
}

/** Leituras seguidas viram uma só (as mudanças chegam em rajada durante uma execução). */
let loading: Promise<void> | null = null
let again = false

export const useAutomations = create<AutomationsState>()((set, get) => ({
  loaded: false,
  failure: null,
  agents: [],
  usage: {},
  models: [],
  mcp: false,
  tasks: [],
  runs: [],
  status: { ...EMPTY_AUTOMATIONS_STATUS },
  live: {},
  finished: {},
  tab: 'agentes',
  openRunId: null,
  taskDraft: null,

  load: async () => {
    listen()
    if (loading) {
      again = true
      return loading
    }
    loading = (async () => {
      do {
        again = false
        try {
          set(await readAll())
        } catch (error) {
          // Recusado com o app bloqueado (contrato 22): relê no desbloqueio.
          reread ??= rereadWhenUnlocked(error, () => {
            reread = null
            void useAutomations.getState().load()
          })
          if (!reread) set({ failure: 'Não foi possível ler as automações.' })
          again = false
        }
      } while (again)
    })().finally(() => {
      loading = null
    })
    return loading
  },

  setTab: (tab) => set({ tab }),

  openRun: (id) => set({ openRunId: id, ...(id ? { tab: 'execucoes' as const } : {}) }),

  openTaskDraft: (input, origin) => set({ taskDraft: { input, origin }, tab: 'tarefas' }),

  takeTaskDraft: () => {
    const draft = get().taskDraft
    if (draft) set({ taskDraft: null })
    return draft
  },

  saveAgent: async (input) => {
    const result = await window.__scribeApi.invoke('scribe:agents-save', input)
    if (!result.ok) {
      const reason =
        result.error === 'duplicate' ? 'Já existe um agente com este nome.' : result.error === 'model' ? 'Este modelo não está disponível.' : result.error === 'full' ? 'Limite de agentes atingido.' : 'Confira os campos do agente.'
      return { ok: false, reason }
    }
    await useAutomations.getState().load()
    return result
  },

  deleteAgent: async (id) => {
    const result = await window.__scribeApi.invoke('scribe:agents-delete', { id })
    if (!result.ok) return { ok: false, reason: result.error === 'in-use' ? 'Usado por tarefas:' : 'Este agente não existe mais.', tasks: result.error === 'in-use' ? result.tasks : [] }
    await useAutomations.getState().load()
    return result
  },

  testAgent: async (input, text) => {
    listen()
    const result = await window.__scribeApi.invoke('scribe:agents-test', { agent: input, text })
    if (!result.ok) return { reason: startReason(result) }
    // A execução pode ter terminado antes desta volta: aí o `done` já vale.
    set((state) => (state.finished[result.runId] || state.live[result.runId] ? {} : { live: { ...state.live, [result.runId]: emptyAnswer() } }))
    return { runId: result.runId }
  },

  ask: async (agentId, text) => {
    listen()
    const result = await window.__scribeApi.invoke('scribe:automations-ask', { agentId, text })
    if (!result.ok) return { reason: startReason(result) }
    // A execução pode ter terminado antes desta volta: aí o `done` já vale.
    set((state) => (state.finished[result.runId] || state.live[result.runId] ? {} : { live: { ...state.live, [result.runId]: emptyAnswer() } }))
    return { runId: result.runId }
  },
}))

/** O id de uma execução já virou `done`? (a tela troca a resposta em curso pela gravada). */
export const runFinished = (runId: string | null): AutomationRun | null => (runId ? (useAutomations.getState().finished[runId] ?? null) : null)
