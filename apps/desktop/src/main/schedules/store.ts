// Tarefas agendadas e histórico (contrato 23, CA3 e CA7). As tarefas e o "Pausar todas" ficam em
// `userData/schedules.json`; cada execução num arquivo `userData/schedule-runs/<id>.json`, com as últimas 500
// (as mais antigas saem). Gravação atômica (temporário + `rename`) em fila, como os outros stores. Arquivo
// inválido: o que não valida fica de fora e o resto vale. Sem Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { RUNS_MAX, type AutomationRun, type AutomationRunListItem, type ScheduledTask } from '../../shared/automations'
import { automationIdSchema, parseRun, taskSchema } from '../../shared/automations-schema'

export const SCHEDULES_FILE = 'schedules.json'
export const SCHEDULE_RUNS_DIR = 'schedule-runs'
export const SCHEDULES_VERSION = 1

/** O que fica em `schedules.json`. */
export interface SchedulesState {
  tasks: ScheduledTask[]
  /** "Pausar todas as tarefas" ou o limite diário. */
  paused: boolean
  pauseReason: 'person' | 'limit' | null
  /**
   * "Retomar" depois da pausa pelo limite diário: o dia (AAAA-MM-DD no fuso do Mac) em que o resto ficou liberado;
   * `null` sem liberação.
   */
  limitReleasedOn: string | null
  /** "Depois de cada reunião" já agendada: `<tarefa>:<reunião>`, para cada par rodar uma vez só (as mais recentes). */
  meetingRuns: string[]
}

/** Quantos pares (tarefa, reunião) ficam guardados. */
export const MEETING_RUNS_MAX = 5_000

export interface SchedulesStore {
  /** Cópia do estado. */
  read(): Promise<SchedulesState>
  /** Lê, muda e grava na mesma vez da fila. */
  mutate(fn: (state: SchedulesState) => SchedulesState): Promise<SchedulesState>
}

const fileSchema = z.object({
  version: z.literal(SCHEDULES_VERSION),
  tasks: z.array(z.unknown()),
  paused: z.boolean().catch(false),
  pauseReason: z.enum(['person', 'limit']).nullable().catch(null),
  limitReleasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  meetingRuns: z.array(z.string().max(320)).max(MEETING_RUNS_MAX).catch([]),
})

function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
}

async function atomicWrite(file: string, data: unknown): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
}

const copy = (state: SchedulesState): SchedulesState => ({ ...state, tasks: state.tasks.map((task) => ({ ...task })), meetingRuns: [...state.meetingRuns] })

export function createFileSchedulesStore({ dir }: { dir: string }): SchedulesStore {
  const file = join(dir, SCHEDULES_FILE)
  const serial = serialQueue()
  let cache: SchedulesState | null = null

  async function load(): Promise<SchedulesState> {
    if (cache) return cache
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      parsed = undefined
    }
    const content = fileSchema.safeParse(parsed)
    if (!content.success) {
      if (parsed !== undefined) console.warn(`[schedules] ${file} inválido; nenhuma tarefa até o próximo salvar`)
      cache = { tasks: [], paused: false, pauseReason: null, limitReleasedOn: null, meetingRuns: [] }
      return cache
    }
    const tasks: ScheduledTask[] = []
    for (const entry of content.data.tasks) {
      const task = taskSchema.safeParse(entry)
      if (task.success && !tasks.some((known) => known.id === task.data.id)) tasks.push(task.data)
    }
    cache = { tasks, paused: content.data.paused, pauseReason: content.data.paused ? content.data.pauseReason : null, limitReleasedOn: content.data.limitReleasedOn, meetingRuns: content.data.meetingRuns }
    return cache
  }

  return {
    read: () => serial(async () => copy(await load())),
    mutate: (fn) =>
      serial(async () => {
        const next = fn(copy(await load()))
        await mkdir(dir, { recursive: true })
        const meetingRuns = next.meetingRuns.slice(-MEETING_RUNS_MAX)
        await atomicWrite(file, { version: SCHEDULES_VERSION, tasks: next.tasks, paused: next.paused, pauseReason: next.pauseReason, limitReleasedOn: next.limitReleasedOn, meetingRuns })
        cache = copy(next)
        return copy(next)
      }),
  }
}

export interface RunsStore {
  /** Grava (nova ou atualizada) e tira as mais antigas acima de 500. */
  save(run: AutomationRun): Promise<void>
  get(id: unknown): Promise<AutomationRun | null>
  /** Da mais recente para a mais antiga, sem o pedido nem a resposta. */
  list(): Promise<AutomationRunListItem[]>
}

const itemOf = ({ prompt: _prompt, answer: _answer, ...item }: AutomationRun): AutomationRunListItem => item

export function createFileRunsStore({ dir, max = RUNS_MAX }: { dir: string; max?: number }): RunsStore {
  const root = join(dir, SCHEDULE_RUNS_DIR)
  const serial = serialQueue()
  /** Índice em memória, montado na primeira leitura. */
  let index: Map<string, AutomationRunListItem> | null = null

  const pathOf = (id: string): string | null => (automationIdSchema.safeParse(id).success ? join(root, `${id}.json`) : null)

  async function load(): Promise<Map<string, AutomationRunListItem>> {
    if (index) return index
    index = new Map()
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return index
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const run = parseRun(JSON.parse(await readFile(join(root, name), 'utf8')))
        if (run && `${run.id}.json` === name) index.set(run.id, itemOf(run))
      } catch {
        // Arquivo ilegível fica de fora.
      }
    }
    return index
  }

  const newestFirst = (a: AutomationRunListItem, b: AutomationRunListItem): number => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id)

  return {
    save: (run) =>
      serial(async () => {
        const path = pathOf(run.id)
        if (!path) throw new Error('id de execução inválido')
        const known = await load()
        await mkdir(root, { recursive: true, mode: 0o700 })
        await atomicWrite(path, run)
        known.set(run.id, itemOf(run))
        if (known.size <= max) return
        const oldest = [...known.values()].sort(newestFirst).slice(max)
        for (const item of oldest) {
          known.delete(item.id)
          const old = pathOf(item.id)
          if (old) await rm(old, { force: true })
        }
      }),

    get: (input) =>
      serial(async () => {
        const id = automationIdSchema.safeParse(input)
        if (!id.success) return null
        const path = pathOf(id.data)
        if (!path) return null
        try {
          return parseRun(JSON.parse(await readFile(path, 'utf8')))
        } catch {
          return null
        }
      }),

    list: () => serial(async () => [...(await load()).values()].sort(newestFirst)),
  }
}
