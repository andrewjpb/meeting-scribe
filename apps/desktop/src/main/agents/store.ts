// Cadastro de agentes (contrato 23, CA1) em `userData/agents.json`. Gravação atômica (temporário + `rename`)
// em fila, como os outros stores. Na primeira vez (sem o arquivo), os três agentes de exemplo entram, editáveis
// e removíveis; depois disso o arquivo manda (apagar os exemplos não os traz de volta). Arquivo inválido: os
// agentes inválidos ficam de fora e o resto vale. Nome único (sem diferenciar maiúsculas); modelo só um dos que
// o perfil oferece; nenhuma conexão MCP (o contrato 21 ainda não existe). Sem Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { AGENTS_MAX, EXAMPLE_AGENTS, isOfferedModel, type Agent, type AgentSaveResult } from '../../shared/automations'
import { agentInputSchema, agentSchema, automationIdSchema } from '../../shared/automations-schema'

export const AGENTS_FILE = 'agents.json'
export const AGENTS_VERSION = 1

export interface AgentsStore {
  list(): Promise<Agent[]>
  get(id: string): Promise<Agent | null>
  /** Cria (`id: null`) ou troca; o pedido vem do formulário e é validado aqui. */
  save(input: unknown): Promise<AgentSaveResult>
  /** Só apaga; quem confere se uma tarefa usa o agente é o serviço das automações. */
  remove(id: unknown): Promise<boolean>
}

export interface AgentsStoreOptions {
  dir: string
  now?: () => number
  newId?: () => string
}

const fileSchema = z.object({ version: z.literal(AGENTS_VERSION), agents: z.array(z.unknown()) })

/** Nome para comparar: sem espaços nas pontas e sem diferenciar maiúsculas. */
const nameKey = (name: string): string => name.trim().toLocaleLowerCase('pt-BR')

export function createFileAgentsStore({ dir, now = Date.now, newId = randomUUID }: AgentsStoreOptions): AgentsStore {
  const file = join(dir, AGENTS_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  let cache: Agent[] | null = null

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
  const stamp = (): string => new Date(now()).toISOString()

  async function write(agents: Agent[]): Promise<void> {
    await mkdir(dir, { recursive: true })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify({ version: AGENTS_VERSION, agents }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    cache = agents
  }

  async function load(): Promise<Agent[]> {
    if (cache) return cache
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      // Primeira vez: os exemplos.
      const at = stamp()
      const seeded = EXAMPLE_AGENTS.map((example): Agent => ({ ...example, id: newId(), scope: { ...example.scope }, output: { ...example.output }, mcpServers: [], createdAt: at, updatedAt: at }))
      await write(seeded)
      return seeded
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const content = fileSchema.safeParse(parsed)
    if (!content.success) {
      console.warn(`[agents] ${file} inválido; a lista fica vazia até o próximo salvar`)
      cache = []
      return cache
    }
    const agents: Agent[] = []
    for (const entry of content.data.agents) {
      const agent = agentSchema.safeParse(entry)
      if (agent.success && !agents.some((known) => known.id === agent.data.id)) agents.push(agent.data)
    }
    cache = agents
    return agents
  }

  return {
    list: () => serial(async () => [...(await load())]),

    get: (id) =>
      serial(async () => {
        const agents = await load()
        return agents.find((agent) => agent.id === id) ?? null
      }),

    save: (input) =>
      serial(async (): Promise<AgentSaveResult> => {
        const parsed = agentInputSchema.safeParse(input)
        if (!parsed.success) return { ok: false, error: 'invalid' }
        const { id, ...fields } = parsed.data
        if (!isOfferedModel(fields.profile, fields.model)) return { ok: false, error: 'model' }
        const agents = await load()
        const at = stamp()
        if (agents.some((agent) => agent.id !== id && nameKey(agent.name) === nameKey(fields.name))) return { ok: false, error: 'duplicate' }
        const scope = fields.scope.kind === 'meetings' ? { kind: fields.scope.kind, meetingIds: fields.scope.meetingIds ?? [] } : { kind: fields.scope.kind }
        if (id === null) {
          if (agents.length >= AGENTS_MAX) return { ok: false, error: 'full' }
          const agent: Agent = { ...fields, scope, id: newId(), createdAt: at, updatedAt: at }
          await write([...agents, agent])
          return { ok: true, agent }
        }
        const current = agents.find((agent) => agent.id === id)
        if (!current) return { ok: false, error: 'missing' }
        const agent: Agent = { ...fields, scope, id, createdAt: current.createdAt, updatedAt: at }
        await write(agents.map((known) => (known.id === id ? agent : known)))
        return { ok: true, agent }
      }),

    remove: (input) =>
      serial(async () => {
        const id = automationIdSchema.safeParse(input)
        if (!id.success) return false
        const agents = await load()
        if (!agents.some((agent) => agent.id === id.data)) return false
        await write(agents.filter((agent) => agent.id !== id.data))
        return true
      }),
  }
}
