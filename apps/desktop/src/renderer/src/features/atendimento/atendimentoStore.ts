// Atendimento no WhatsApp no renderer (contrato 142): os agentes de atendimento, os atendimentos das conversas, o que
// o serviço sabe agora de cada conversa (resposta agendada, proposta, passagem para o dono) e o histórico, como o main
// devolveu. Toda mutação devolve o estado inteiro, que substitui o daqui sem nova leitura. O envio da proposta não
// passa por aqui: sai direto do clique, pelo `atendimentoDraftSend` do preload (contrato 143).
import { create } from 'zustand'
import {
  ATENDIMENTO_LOG_LIST_DEFAULT,
  type AtendimentoAgent,
  type AtendimentoAgentInput,
  type AtendimentoAgentTestRequest,
  type AtendimentoBinding,
  type AtendimentoBindingInput,
  type AtendimentoDecision,
  type AtendimentoError,
  type AtendimentoLogEntry,
  type AtendimentoRuntime,
  type AtendimentoState,
} from '@shared/atendimento'
import { rereadWhenUnlocked } from '../../app/lockStore'

type Failure = { ok: false; reason: string }

interface AtendimentoStoreState {
  loaded: boolean
  failure: string | null
  state: AtendimentoState | null
  runtime: AtendimentoRuntime
  /** Histórico, do mais recente para o mais antigo. */
  log: AtendimentoLogEntry[]
  /** Filtro do histórico (`null`: todas as conversas). */
  logChatId: string | null
  load: () => Promise<void>
  loadRuntime: () => Promise<void>
  /** Sem argumento, usa o filtro guardado. */
  loadLog: (chatId?: string | null) => Promise<void>
  saveAgent: (input: AtendimentoAgentInput) => Promise<{ ok: true; agent: AtendimentoAgent | null } | Failure>
  deleteAgent: (id: string) => Promise<{ ok: true } | Failure>
  testAgent: (request: AtendimentoAgentTestRequest) => Promise<{ ok: true; decision: AtendimentoDecision; ms: number } | Failure>
  /** `reason: 'risk-required'` sem tradução: o painel da conversa abre o aviso de risco (contrato 143). */
  saveBinding: (input: AtendimentoBindingInput) => Promise<{ ok: true; binding: AtendimentoBinding | null } | Failure>
  deleteBinding: (chatId: string) => Promise<{ ok: true } | Failure>
  pauseAll: (paused: boolean) => Promise<{ ok: true } | Failure>
  acceptRisk: () => Promise<{ ok: true } | Failure>
  discardDraft: (chatId: string) => Promise<{ ok: boolean }>
  setLogChatId: (chatId: string | null) => Promise<void>
}

const LOAD_FAILURE = 'Não foi possível ler os atendimentos.'
const TEST_FAILURE = 'Não foi possível testar agora.'

/** A frase de cada recusa do main. */
export function atendimentoErrorReason(error: AtendimentoError | string): string {
  switch (error) {
    case 'name-taken':
      return 'Já existe um agente com esse nome.'
    case 'agent-not-found':
      return 'Esse agente não existe mais.'
    case 'group-not-allowed':
      return 'Atendimento não funciona em grupos.'
    case 'not-found':
      return 'Não encontrado. Atualize a tela.'
    case 'invalid':
      return 'Confira os campos e tente de novo.'
    default:
      return 'Não foi possível salvar.'
  }
}

let listening = false
let reread: (() => void) | null = null
/** Leituras seguidas viram uma só (os avisos de mudança chegam em rajada). */
let loading: Promise<void> | null = null
let again = false

/** Uma vez só: a cada mudança no serviço, relê o que ele sabe agora das conversas. */
function listen(): void {
  if (listening) return
  listening = true
  window.__scribeApi.on('scribe:atendimento-changed', () => {
    void useAtendimento.getState().loadRuntime()
  })
}

type Mutation = { ok: true; state?: AtendimentoState } | { ok: false; error: AtendimentoError }

/** Troca o estado pelo devolvido; se não veio, relê. */
async function apply(state: AtendimentoState | undefined): Promise<void> {
  if (state) useAtendimento.setState({ state })
  else await useAtendimento.getState().load()
}

/** Aplica o estado devolvido e traduz a recusa. */
async function settle(result: Mutation): Promise<{ ok: true } | Failure> {
  if (!result.ok) return { ok: false, reason: atendimentoErrorReason(result.error) }
  await apply(result.state)
  return { ok: true }
}

export const useAtendimento = create<AtendimentoStoreState>()((set, get) => ({
  loaded: false,
  failure: null,
  state: null,
  runtime: {},
  log: [],
  logChatId: null,

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
          const [state, runtime] = await Promise.all([window.__scribeApi.invoke('scribe:atendimento-state'), window.__scribeApi.invoke('scribe:atendimento-runtime')])
          if (state.ok) set({ state: state.state, runtime, loaded: true, failure: null })
          else set({ failure: LOAD_FAILURE })
        } catch (error) {
          // Recusado com o app bloqueado (contrato 22): relê no desbloqueio.
          reread ??= rereadWhenUnlocked(error, () => {
            reread = null
            void useAtendimento.getState().load()
          })
          if (!reread) set({ failure: LOAD_FAILURE })
          again = false
        }
      } while (again)
    })().finally(() => {
      loading = null
    })
    return loading
  },

  loadRuntime: async () => {
    try {
      set({ runtime: await window.__scribeApi.invoke('scribe:atendimento-runtime') })
    } catch {
      // Bloqueado ou fora do ar: fica o que estava; o próximo aviso relê.
    }
  },

  loadLog: async (chatId = get().logChatId) => {
    try {
      const result = await window.__scribeApi.invoke('scribe:atendimento-log-list', chatId ? { limit: ATENDIMENTO_LOG_LIST_DEFAULT, chatId } : { limit: ATENDIMENTO_LOG_LIST_DEFAULT })
      if (result.ok) set({ log: result.entries })
    } catch {
      // Bloqueado: o histórico fica como estava.
    }
  },

  saveAgent: async (input) => {
    const result: { ok: true; agent?: AtendimentoAgent; state?: AtendimentoState } | { ok: false; error: AtendimentoError } = await window.__scribeApi.invoke('scribe:atendimento-agent-save', input)
    if (!result.ok) return { ok: false, reason: atendimentoErrorReason(result.error) }
    await apply(result.state)
    return { ok: true, agent: result.agent ?? null }
  },

  deleteAgent: async (id) => settle(await window.__scribeApi.invoke('scribe:atendimento-agent-delete', { id })),

  testAgent: async (request) => {
    const started = performance.now()
    try {
      const result = await window.__scribeApi.invoke('scribe:atendimento-agent-test', request)
      if (!result.ok) return { ok: false, reason: TEST_FAILURE }
      return { ok: true, decision: result.decision, ms: performance.now() - started }
    } catch {
      return { ok: false, reason: TEST_FAILURE }
    }
  },

  saveBinding: async (input) => {
    const result: { ok: true; binding?: AtendimentoBinding; state?: AtendimentoState } | { ok: false; error: AtendimentoError } = await window.__scribeApi.invoke('scribe:atendimento-binding-save', input)
    if (!result.ok) return { ok: false, reason: result.error === 'risk-required' ? 'risk-required' : atendimentoErrorReason(result.error) }
    await apply(result.state)
    return { ok: true, binding: result.binding ?? null }
  },

  deleteBinding: async (chatId) => settle(await window.__scribeApi.invoke('scribe:atendimento-binding-delete', { chatId })),

  pauseAll: async (paused) => settle(await window.__scribeApi.invoke('scribe:atendimento-pause-all', { paused })),

  acceptRisk: async () => settle(await window.__scribeApi.invoke('scribe:atendimento-risk-accept')),

  discardDraft: async (chatId) => {
    const result = await window.__scribeApi.invoke('scribe:atendimento-draft-discard', { chatId })
    await get().loadRuntime()
    return { ok: result.ok }
  },

  setLogChatId: async (chatId) => {
    set({ logChatId: chatId })
    await get().loadLog(chatId)
  },
}))
