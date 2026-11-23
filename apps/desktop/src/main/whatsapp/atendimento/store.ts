// Agentes de atendimento no WhatsApp (contrato 138): o store de `userData/whatsapp/atendimento.json`. Um arquivo
// só para os agentes, os atendimentos de cada conversa, a pausa geral e o aceite do risco. Gravação como os outros
// stores: fila serial, temporário + `rename`, `0o600`; cada mutação grava o arquivo inteiro. Arquivo ausente vale o
// estado vazio (nenhum agente de exemplo); inválido vira `atendimento.json.corrupt-<stamp>` e o estado parte vazio.
// Todo pedido vem como o renderer mandou e é validado aqui. O log nunca leva instruções nem texto do agente. Sem
// Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ATENDIMENTO_FILE,
  ATENDIMENTO_VERSION,
  isGroupChat,
  type AtendimentoAgent,
  type AtendimentoAgentSaveResult,
  type AtendimentoBinding,
  type AtendimentoBindingSaveResult,
  type AtendimentoError,
  type AtendimentoFailure,
  type AtendimentoResult,
  type AtendimentoState,
} from '../../../shared/atendimento'
import {
  atendimentoAgentInputSchema,
  atendimentoBindingInputSchema,
  atendimentoChatIdSchema,
  atendimentoChatRequestSchema,
  atendimentoFileSchema,
  atendimentoIdRequestSchema,
  atendimentoPauseAllRequestSchema,
} from '../../../shared/atendimento-schema'

export interface AtendimentoStore {
  /** Cópia do estado. */
  state(): Promise<AtendimentoState>
  /** Cria (`id: null`) ou troca um agente; nome único sem diferenciar maiúsculas. */
  saveAgent(input: unknown): Promise<AtendimentoAgentSaveResult>
  /** Apaga o agente e desliga (sem apagar) os atendimentos que o usam. */
  deleteAgent(input: unknown): Promise<AtendimentoResult>
  /** Cria ou substitui o atendimento da conversa (um por `chatId`). */
  saveBinding(input: unknown): Promise<AtendimentoBindingSaveResult>
  deleteBinding(input: unknown): Promise<AtendimentoResult>
  pauseAll(input: unknown): Promise<AtendimentoResult>
  /** O pedido não leva nada. */
  acceptRisk(): Promise<AtendimentoResult>
  /** Uso interno do atendimento (contrato 141): grava só `pausedUntil` da conversa. `false` se não há atendimento. */
  setPausedUntil(chatId: string, iso: string | null): Promise<boolean>
}

export interface AtendimentoStoreOptions {
  /** `userData/whatsapp`. */
  dir: string
  now?: () => number
  newId?: () => string
  log?: (message: string) => void
}

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

/** Nome para comparar: sem espaços nas pontas e sem diferenciar maiúsculas. */
const nameKey = (name: string): string => name.trim().toLocaleLowerCase('pt-BR')

const falha = (error: AtendimentoError): AtendimentoFailure => ({ ok: false, error })

const vazio = (): AtendimentoState => ({ agents: [], bindings: [], pausedAll: false, riskAcceptedAt: null })

type Passo<T> = { ok: true; value: T } | AtendimentoFailure

export function createAtendimentoStore({ dir, now = Date.now, newId = randomUUID, log = () => undefined }: AtendimentoStoreOptions): AtendimentoStore {
  const file = join(dir, ATENDIMENTO_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  let cache: AtendimentoState | null = null

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
  const stamp = (): string => new Date(now()).toISOString()

  async function write(state: AtendimentoState): Promise<void> {
    await mkdir(dir, { recursive: true })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify({ version: ATENDIMENTO_VERSION, ...state }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    cache = state
  }

  async function load(): Promise<AtendimentoState> {
    if (cache) return cache
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      cache = vazio()
      return cache
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    const content = atendimentoFileSchema.safeParse(parsed)
    if (content.success) {
      const { agents, bindings, pausedAll, riskAcceptedAt } = content.data
      cache = { agents, bindings, pausedAll, riskAcceptedAt }
      return cache
    }
    // Nunca sobrescrever o inválido: sem o `rename`, a leitura falha e nada é gravado por cima.
    const at = now()
    await rename(file, `${file}.corrupt-${at}`)
    log(`[atendimento] ${ATENDIMENTO_FILE} inválido; guardado como ${ATENDIMENTO_FILE}.corrupt-${at} e o atendimento parte vazio`)
    cache = vazio()
    return cache
  }

  /** Lê, muda uma cópia e grava o arquivo inteiro na mesma vez da fila; recusa não grava nada. */
  function mutate<T>(fn: (draft: AtendimentoState, at: string) => Passo<T>): Promise<{ ok: true; value: T; state: AtendimentoState } | AtendimentoFailure> {
    return serial(async () => {
      const draft = structuredClone(await load())
      const result = fn(draft, stamp())
      if (!result.ok) return result
      await write(draft)
      const out = structuredClone({ value: result.value, state: draft })
      return { ok: true, value: out.value, state: out.state }
    })
  }

  return {
    state: () => serial(async () => structuredClone(await load())),

    saveAgent: async (input) => {
      const parsed = atendimentoAgentInputSchema.safeParse(input)
      if (!parsed.success) return falha('invalid')
      const { id, ...fields } = parsed.data
      const result = await mutate<AtendimentoAgent>((draft, at) => {
        if (draft.agents.some((agent) => agent.id !== id && nameKey(agent.name) === nameKey(fields.name))) return falha('name-taken')
        if (id === null) {
          const agent: AtendimentoAgent = { id: newId(), ...fields, createdAt: at, updatedAt: at }
          draft.agents.push(agent)
          return { ok: true, value: agent }
        }
        const index = draft.agents.findIndex((agent) => agent.id === id)
        const current = draft.agents[index]
        if (!current) return falha('not-found')
        const agent: AtendimentoAgent = { id, ...fields, createdAt: current.createdAt, updatedAt: at }
        draft.agents[index] = agent
        return { ok: true, value: agent }
      })
      return result.ok ? { ok: true, agent: result.value, state: result.state } : result
    },

    deleteAgent: async (input) => {
      const parsed = atendimentoIdRequestSchema.safeParse(input)
      if (!parsed.success) return falha('invalid')
      const { id } = parsed.data
      const result = await mutate<null>((draft, at) => {
        if (!draft.agents.some((agent) => agent.id === id)) return falha('not-found')
        draft.agents = draft.agents.filter((agent) => agent.id !== id)
        draft.bindings = draft.bindings.map((binding) => (binding.agentId === id && binding.enabled ? { ...binding, enabled: false, updatedAt: at } : binding))
        return { ok: true, value: null }
      })
      return result.ok ? { ok: true, state: result.state } : result
    },

    saveBinding: async (input) => {
      const parsed = atendimentoBindingInputSchema.safeParse(input)
      if (!parsed.success) return falha('invalid')
      const fields = parsed.data
      if (isGroupChat(fields.chatId)) return falha('group-not-allowed')
      const result = await mutate<AtendimentoBinding>((draft, at) => {
        if (!draft.agents.some((agent) => agent.id === fields.agentId)) return falha('agent-not-found')
        if (fields.mode === 'auto' && fields.enabled && draft.riskAcceptedAt === null) return falha('risk-required')
        const current = draft.bindings.find((binding) => binding.chatId === fields.chatId)
        // A pausa é do próprio atendimento (`setPausedUntil`): salvar o painel não a desfaz.
        const binding: AtendimentoBinding = { ...fields, pausedUntil: current?.pausedUntil ?? null, updatedAt: at }
        draft.bindings = current ? draft.bindings.map((known) => (known.chatId === fields.chatId ? binding : known)) : [...draft.bindings, binding]
        return { ok: true, value: binding }
      })
      return result.ok ? { ok: true, binding: result.value, state: result.state } : result
    },

    deleteBinding: async (input) => {
      const parsed = atendimentoChatRequestSchema.safeParse(input)
      if (!parsed.success) return falha('invalid')
      const { chatId } = parsed.data
      const result = await mutate<null>((draft) => {
        if (!draft.bindings.some((binding) => binding.chatId === chatId)) return falha('not-found')
        draft.bindings = draft.bindings.filter((binding) => binding.chatId !== chatId)
        return { ok: true, value: null }
      })
      return result.ok ? { ok: true, state: result.state } : result
    },

    pauseAll: async (input) => {
      const parsed = atendimentoPauseAllRequestSchema.safeParse(input)
      if (!parsed.success) return falha('invalid')
      const result = await mutate<null>((draft) => {
        draft.pausedAll = parsed.data.paused
        return { ok: true, value: null }
      })
      return result.ok ? { ok: true, state: result.state } : result
    },

    acceptRisk: async () => {
      const result = await mutate<null>((draft, at) => {
        // O primeiro aceite vale; aceitar de novo não muda a data.
        draft.riskAcceptedAt ??= at
        return { ok: true, value: null }
      })
      return result.ok ? { ok: true, state: result.state } : result
    },

    setPausedUntil: async (chatId, iso) => {
      if (!atendimentoChatIdSchema.safeParse(chatId).success) return false
      if (iso !== null && Number.isNaN(Date.parse(iso))) return false
      const result = await mutate<null>((draft) => {
        const binding = draft.bindings.find((known) => known.chatId === chatId)
        if (!binding) return falha('not-found')
        binding.pausedUntil = iso
        return { ok: true, value: null }
      })
      return result.ok
    },
  }
}
