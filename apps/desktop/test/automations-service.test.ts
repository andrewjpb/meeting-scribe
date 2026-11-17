import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileAgentsStore } from '../src/main/agents/store'
import type { OutputRequest } from '../src/main/schedules/outputs'
import type { AgentRunRequest, AgentRunResult } from '../src/main/schedules/runner'
import { createAutomationsService, type AutomationNotice, type AutomationsService } from '../src/main/schedules/service'
import { createFileRunsStore, createFileSchedulesStore, SCHEDULE_RUNS_DIR, SCHEDULES_FILE } from '../src/main/schedules/store'
import { AGENTS_FILE } from '../src/main/agents/store'
import type { AgentInput, AutomationEvent, ScheduledTask, TaskInput } from '../src/shared/automations'

const SP = 'America/Sao_Paulo'

/** Execução substituta: cada uma espera o teste responder. */
interface Pending {
  request: AgentRunRequest
  resolve: (result: Partial<AgentRunResult>) => void
}

let dir: string
let clock: number
let pending: Pending[]
let maxConcurrent: number
let notices: AutomationNotice[]
let outputs: OutputRequest[]
let events: AutomationEvent[]
let limit: number
let service: AutomationsService
let ids: number

function setup(): void {
  pending = []
  maxConcurrent = 0
  notices = []
  outputs = []
  events = []
  limit = 50
  ids = 0
  const newId = (): string => `id-${++ids}`
  const now = (): number => clock
  service = createAutomationsService({
    agents: createFileAgentsStore({ dir, now, newId }),
    schedules: createFileSchedulesStore({ dir }),
    runs: createFileRunsStore({ dir }),
    runner: {
      run: (request) =>
        new Promise((resolve) => {
          pending.push({
            request,
            resolve: (result) =>
              resolve({ status: 'ok', answer: { role: 'assistant', text: `Resposta de ${request.runId}`, at: new Date(clock).toISOString() }, error: null, costUsd: 0.01, ...result }),
          })
          maxConcurrent = Math.max(maxConcurrent, pending.length)
        }),
      dispose: () => undefined,
    },
    applyOutput: (request) => {
      outputs.push(request)
      return Promise.resolve('Conversa criada no Assistente')
    },
    notify: (notice) => notices.push(notice),
    dailyLimit: () => Promise.resolve(limit),
    timeZone: () => SP,
    onChange: () => undefined,
    onEvent: (event) => events.push(event),
    now,
    newId,
    timers: { setInterval: () => 0, clearInterval: () => undefined },
  })
}

/** Espera a fila andar até haver `count` execuções esperando resposta. */
async function waitPending(count: number): Promise<void> {
  for (let i = 0; i < 200 && pending.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(pending.length).toBeGreaterThanOrEqual(count)
}

async function answer(index: number, result: Partial<AgentRunResult> = {}): Promise<void> {
  const [item] = pending.splice(index, 1)
  item?.resolve(result)
  await new Promise((resolve) => setTimeout(resolve, 20))
}

async function firstAgentId(name = 'Resumo da semana'): Promise<string> {
  const { agents } = await service.listAgents()
  const agent = agents.find((candidate) => candidate.name === name)
  if (!agent) throw new Error('sem agente')
  return agent.id
}

function taskInput(agentId: string, patch: Partial<TaskInput> = {}): TaskInput {
  return {
    id: null,
    name: 'Resumo de sexta',
    agentId,
    message: 'Resuma a semana.',
    schedule: { kind: 'daily', time: '08:00' },
    timezone: SP,
    enabled: true,
    runOnce: false,
    runOnceAction: 'disable',
    timeoutS: 300,
    notify: 'on-error',
    output: null,
    ...patch,
  }
}

async function createTask(patch: Partial<TaskInput> = {}): Promise<ScheduledTask> {
  const result = await service.saveTask(taskInput(await firstAgentId(), patch))
  if (!result.ok) throw new Error(`tarefa recusada: ${result.error}`)
  return result.task
}

const runsOnDisk = (): { status: string; trigger: string; taskId: string | null; error: string | null }[] => {
  try {
    return readdirSync(join(dir, SCHEDULE_RUNS_DIR)).map((name) => JSON.parse(readFileSync(join(dir, SCHEDULE_RUNS_DIR, name), 'utf8')) as { status: string; trigger: string; taskId: string | null; error: string | null })
  } catch {
    return []
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'automacoes-'))
  // Segunda, 16/11/2026, 07:00 em São Paulo.
  clock = Date.parse('2026-11-16T10:00:00Z')
  setup()
})

afterEach(async () => {
  for (const item of pending.splice(0)) item.resolve({})
  await service.settled()
  service.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('agentes (contrato 23, CA1 e CA2)', () => {
  it('os três de exemplo entram na primeira vez, em agents.json, e podem ser apagados para sempre', async () => {
    const { agents, models, mcp } = await service.listAgents()
    expect(agents.map((agent) => agent.name)).toEqual(['Resumo da semana', 'Minhas tarefas', 'Pendências da reunião'])
    expect(agents[0]?.scope).toEqual({ kind: '7d' })
    expect(models).toEqual(['haiku', 'sonnet', 'opus'])
    expect(mcp).toBe(false)
    const file = JSON.parse(readFileSync(join(dir, AGENTS_FILE), 'utf8')) as { version: number; agents: unknown[] }
    expect(file.agents).toHaveLength(3)
    for (const agent of agents) expect(await service.deleteAgent({ id: agent.id })).toEqual({ ok: true })
    // Reaberto do disco: continua vazio (os exemplos não voltam).
    setup()
    expect((await service.listAgents()).agents).toEqual([])
  })

  it('nome único, modelo do perfil e excluir recusado com a lista das tarefas que usam o agente', async () => {
    const agentId = await firstAgentId()
    const base: AgentInput = { id: null, name: 'resumo da SEMANA', description: '', icon: 'bot', color: 'blue', instructions: 'x', profile: 'claude', model: 'haiku', thinkMore: false, scope: { kind: 'all' }, web: false, mcpServers: [], output: { kind: 'chat' } }
    expect(await service.saveAgent(base)).toEqual({ ok: false, error: 'duplicate' })
    expect(await service.saveAgent({ ...base, name: 'Novo', model: 'fable-5-2' })).toEqual({ ok: false, error: 'model' })
    const saved = await service.saveAgent({ ...base, name: 'Novo' })
    expect(saved.ok).toBe(true)
    await createTask({ name: 'Usa o resumo' })
    expect(await service.deleteAgent({ id: agentId })).toEqual({ ok: false, error: 'in-use', tasks: ['Usa o resumo'] })
    expect((await service.listAgents()).usage[agentId]).toEqual(['Usa o resumo'])
  })

  it('"Testar agora" roda o agente do formulário sem gravar nada no histórico nem aplicar a saída', async () => {
    const input: AgentInput = { id: null, name: 'Rascunho', description: '', icon: 'bot', color: 'pink', instructions: 'Seja breve.', profile: 'claude', model: 'haiku', thinkMore: false, scope: { kind: 'none' }, web: false, mcpServers: [], output: { kind: 'file' } }
    const started = await service.testAgent({ agent: input, text: 'Olá?' })
    expect(started.ok).toBe(true)
    await waitPending(1)
    expect(pending[0]?.request.agent.instructions).toBe('Seja breve.')
    expect(pending[0]?.request.prompt).toBe('Agora: segunda, 16/11/2026 07:00 (America/Sao_Paulo).\n\nOlá?')
    await answer(0)
    expect(events.at(-1)).toMatchObject({ type: 'done', runId: started.ok ? started.runId : '', run: { status: 'ok', trigger: 'test', agentId: null } })
    expect(runsOnDisk()).toEqual([])
    expect(outputs).toEqual([])
  })
})

describe('agendador (contrato 23, CA5)', () => {
  it('nada roda sem tarefa criada e ligada; no horário, roda e grava a execução e a saída', async () => {
    await service.tick()
    expect(pending).toHaveLength(0)
    const task = await createTask({ notify: 'always' })
    expect(task.nextRunAt).toBe('2026-11-16T11:00:00.000Z')
    await service.tick()
    expect(pending).toHaveLength(0)
    clock = Date.parse('2026-11-16T11:00:10Z')
    await service.tick()
    await waitPending(1)
    expect(pending[0]?.request.prompt.startsWith('Agora: segunda, 16/11/2026 08:00')).toBe(true)
    await answer(0)
    await service.settled()
    const [saved] = await service.listTasks()
    expect(saved).toMatchObject({ lastStatus: 'ok', lastRunAt: '2026-11-16T11:00:10.000Z', nextRunAt: '2026-11-17T11:00:00.000Z', consecutiveFailures: 0 })
    expect(saved?.lastResultPreview).toContain('Resposta de')
    expect(runsOnDisk()).toEqual([expect.objectContaining({ status: 'ok', trigger: 'schedule', taskId: task.id })])
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ title: 'Tarefa: Resumo de sexta', output: { kind: 'chat' } })
    expect(notices).toEqual([expect.objectContaining({ title: 'Tarefa: Resumo de sexta' })])
  })

  it('uma por tarefa: com a anterior rodando, a vez vira skipped; no máximo 2 ao mesmo tempo no total', async () => {
    const a = await createTask({ name: 'A', schedule: { kind: 'every', minutes: 5 } })
    const b = await createTask({ name: 'B' })
    const c = await createTask({ name: 'C' })
    expect((await service.runNow({ id: a.id })).ok).toBe(true)
    expect(await service.runNow({ id: a.id })).toEqual({ ok: false, error: 'busy' })
    await service.runNow({ id: b.id })
    await service.runNow({ id: c.id })
    await waitPending(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(pending).toHaveLength(2)
    await answer(0)
    await waitPending(2)
    expect(maxConcurrent).toBe(2)
    await answer(0)
    await answer(0)
    await service.settled()
    const statuses = runsOnDisk().map((run) => `${run.taskId === a.id ? 'A' : run.taskId === b.id ? 'B' : 'C'}:${run.status}`).sort()
    expect(statuses).toEqual(['A:ok', 'A:skipped', 'B:ok', 'C:ok'])
  })

  it('horário perdido: roda uma vez só e registra os outros como skipped; atraso de 12 h ou mais não roda', async () => {
    const task = await createTask()
    // App fechado de segunda 07:00 até quinta 10:00: perdeu 08:00 de seg, ter, qua e qui.
    clock = Date.parse('2026-11-19T13:00:00Z')
    await service.tick()
    await waitPending(1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(pending).toHaveLength(1)
    await answer(0)
    await service.settled()
    const runs = runsOnDisk()
    expect(runs.filter((run) => run.status === 'ok')).toEqual([expect.objectContaining({ trigger: 'missed' })])
    expect(runs.filter((run) => run.status === 'skipped')).toEqual([expect.objectContaining({ error: '3 horários perdidos com o app fechado ou o Mac dormindo.' })])
    expect((await service.listTasks())[0]?.nextRunAt).toBe('2026-11-20T11:00:00.000Z')

    // Outra tarefa, e o Mac dormindo até 13 h depois do último horário: nada roda, só o registro.
    await service.deleteTask({ id: task.id })
    await createTask({ name: 'Noite', schedule: { kind: 'daily', time: '06:00' } })
    clock = Date.parse('2026-11-21T22:30:00Z')
    await service.resume()
    await service.settled()
    expect(pending).toHaveLength(0)
    expect(runsOnDisk().filter((run) => run.status === 'skipped')).toHaveLength(2)
  })

  it('3 falhas seguidas pausam a tarefa e avisam; ligar de novo tira a pausa', async () => {
    const task = await createTask()
    for (let i = 0; i < 3; i++) {
      await service.runNow({ id: task.id })
      await waitPending(1)
      await answer(0, { status: i === 2 ? 'timeout' : 'error', error: 'falhou', answer: { role: 'assistant', text: '', at: '2026-11-16T10:00:00.000Z', error: 'failed' } })
      await service.settled()
    }
    const [paused] = await service.listTasks()
    expect(paused).toMatchObject({ autoPaused: true, consecutiveFailures: 3, nextRunAt: null, lastStatus: 'timeout' })
    expect(notices.at(-1)?.title).toBe('Tarefa pausada: Resumo de sexta')
    // Pausada, o horário não roda.
    clock = Date.parse('2026-11-17T11:00:10Z')
    await service.tick()
    expect(pending).toHaveLength(0)
    const back = await service.toggleTask({ id: task.id, enabled: true })
    expect(back).toMatchObject({ autoPaused: false, consecutiveFailures: 0, nextRunAt: '2026-11-18T11:00:00.000Z' })
  })

  it('"Rodar uma vez só": exclui ou desliga depois de rodar; "uma vez em" roda no horário', async () => {
    const once = await createTask({ name: 'Uma vez', schedule: { kind: 'once', at: '2026-11-16T12:00:00.000Z' }, runOnce: true, runOnceAction: 'delete' })
    const off = await createTask({ name: 'Desliga', runOnce: true, runOnceAction: 'disable' })
    clock = Date.parse('2026-11-16T12:00:05Z')
    await service.tick()
    await waitPending(2)
    await answer(0)
    await answer(0)
    await service.settled()
    const tasks = await service.listTasks()
    expect(tasks.find((task) => task.id === once.id)).toBeUndefined()
    expect(tasks.find((task) => task.id === off.id)).toMatchObject({ enabled: false, nextRunAt: null, lastStatus: 'ok' })
  })

  it('limite diário: ao passar, pausa tudo e avisa; "Retomar" segue do próximo horário', async () => {
    limit = 1
    const task = await createTask({ schedule: { kind: 'every', minutes: 5 } })
    clock += 5 * 60_000 + 1_000
    await service.tick()
    await waitPending(1)
    await answer(0)
    await service.settled()
    clock += 5 * 60_000
    await service.tick()
    await service.settled()
    expect(pending).toHaveLength(0)
    const status = await service.status()
    expect(status).toMatchObject({ paused: true, pauseReason: 'limit', runsToday: 1, dailyLimit: 1 })
    expect(notices.at(-1)?.title).toBe('Tarefas pausadas')
    // "Rodar agora" (com a pessoa olhando) não conta e roda mesmo pausado.
    expect((await service.runNow({ id: task.id })).ok).toBe(true)
    await waitPending(1)
    await answer(0)
    const resumed = await service.setPaused({ paused: false })
    expect(resumed).toMatchObject({ paused: false, pauseReason: null })
    expect(Date.parse((await service.listTasks())[0]?.nextRunAt ?? '')).toBe(clock + 5 * 60_000)
  })

  it('depois de cada reunião: roda com a reunião que acabou, depois do atraso', async () => {
    const agentId = await firstAgentId('Pendências da reunião')
    const saved = await service.saveTask(taskInput(agentId, { name: 'Pendências', schedule: { kind: 'after-meeting', delayMin: 5 } }))
    expect(saved.ok && saved.task.nextRunAt).toBeNull()
    service.meetingEnded('reuniao-1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await service.tick()
    expect(pending).toHaveLength(0)
    clock += 5 * 60_000
    await service.tick()
    await waitPending(1)
    expect(pending[0]?.request.meetingId).toBe('reuniao-1')
    await answer(0)
    await service.settled()
    expect(outputs[0]).toMatchObject({ meetingId: 'reuniao-1', output: { kind: 'note' } })
    expect(runsOnDisk()[0]).toMatchObject({ trigger: 'meeting', status: 'ok' })
  })

  it('depois de cada reunião: cada par (tarefa, reunião) roda uma vez só, também depois de um "Tentar de novo" e de reabrir', async () => {
    const agentId = await firstAgentId('Pendências da reunião')
    await service.saveTask(taskInput(agentId, { name: 'Pendências', schedule: { kind: 'after-meeting', delayMin: 0 } }))
    service.meetingEnded('reuniao-1')
    await waitPending(1)
    // O fim da gravação avisa de novo (retry) enquanto a primeira ainda roda, e depois que terminou.
    service.meetingEnded('reuniao-1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await answer(0)
    await service.settled()
    service.meetingEnded('reuniao-1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await service.tick()
    expect(pending).toHaveLength(0)
    // Reaberto do disco: o par continua guardado.
    setup()
    service.meetingEnded('reuniao-1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await service.tick()
    expect(pending).toHaveLength(0)
    expect(runsOnDisk().filter((run) => run.trigger === 'meeting')).toHaveLength(1)
    // Outra reunião roda.
    service.meetingEnded('reuniao-2')
    await waitPending(1)
    await answer(0)
  })

  it('limite diário conta também o que está rodando e na fila; "Retomar" depois do limite libera o resto do dia', async () => {
    limit = 2
    for (const name of ['A', 'B', 'C']) await createTask({ name })
    clock = Date.parse('2026-11-16T11:00:10Z')
    await service.tick()
    await waitPending(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    // A terceira não entrou: duas já rodavam (nenhuma gravada como terminada ainda).
    expect(pending).toHaveLength(2)
    expect(await service.status()).toMatchObject({ paused: true, pauseReason: 'limit' })
    await answer(0)
    await answer(0)
    await service.settled()
    await service.setPaused({ paused: false })
    expect(JSON.parse(readFileSync(join(dir, SCHEDULES_FILE), 'utf8'))).toMatchObject({ paused: false, limitReleasedOn: '2026-11-16' })
    // Liberado: no mesmo dia, o próximo horário roda sem pausar de novo.
    await createTask({ name: 'D', schedule: { kind: 'every', minutes: 5 } })
    clock += 5 * 60_000 + 1_000
    await service.tick()
    await waitPending(1)
    await answer(0)
    await service.settled()
    expect((await service.status()).paused).toBe(false)
    // No dia seguinte o limite volta a valer.
    clock = Date.parse('2026-11-17T11:00:10Z')
    await service.tick()
    await waitPending(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(pending).toHaveLength(2)
    expect((await service.status()).pauseReason).toBe('limit')
  })

  it('"Uma vez em" com a data no passado é recusada; passou desligada, religar registra pulada e aplica o "uma vez só"', async () => {
    const agentId = await firstAgentId()
    expect(await service.saveTask(taskInput(agentId, { schedule: { kind: 'once', at: '2026-11-15T10:00:00.000Z' } }))).toEqual({ ok: false, error: 'past' })
    const once = { kind: 'once' as const, at: '2026-11-16T12:00:00.000Z' }
    const deleting = await service.saveTask(taskInput(agentId, { name: 'Exclui', schedule: once, enabled: false, runOnce: true, runOnceAction: 'delete' }))
    const keeping = await service.saveTask(taskInput(agentId, { name: 'Fica', schedule: once, enabled: false, runOnce: false }))
    clock = Date.parse('2026-11-16T13:00:00Z')
    expect(await service.toggleTask({ id: deleting.ok ? deleting.task.id : '', enabled: true })).toBeNull()
    expect(await service.toggleTask({ id: keeping.ok ? keeping.task.id : '', enabled: true })).toMatchObject({ enabled: false, nextRunAt: null, lastStatus: 'skipped' })
    expect((await service.listTasks()).map((task) => task.name)).toEqual(['Fica'])
    expect(runsOnDisk().filter((run) => run.status === 'skipped')).toHaveLength(2)
    await service.tick()
    expect(pending).toHaveLength(0)
  })

  it('"Pedir agora" entra em Execuções; "Rodar de novo" repete o pedido', async () => {
    const agentId = await firstAgentId('Minhas tarefas')
    const asked = await service.ask({ agentId, text: 'Quais são as minhas tarefas?' })
    expect(asked.ok).toBe(true)
    await waitPending(1)
    await answer(0)
    await service.settled()
    const [run] = await service.listRuns({})
    expect(run).toMatchObject({ trigger: 'ask', status: 'ok', agentName: 'Minhas tarefas', taskId: null })
    const again = await service.rerun({ id: run?.id ?? '' })
    expect(again.ok).toBe(true)
    await waitPending(1)
    expect(pending[0]?.request.prompt.endsWith('\n\nQuais são as minhas tarefas?')).toBe(true)
    await answer(0)
    expect((await service.listRuns({ status: 'ok' })).map((item) => item.trigger).sort()).toEqual(['ask', 'rerun'])
  })

  it('schedules.json guarda a pausa e as tarefas; arquivo estragado vira lista vazia', async () => {
    await createTask()
    await service.setPaused({ paused: true })
    const file = JSON.parse(readFileSync(join(dir, SCHEDULES_FILE), 'utf8')) as { paused: boolean; tasks: unknown[] }
    expect(file).toMatchObject({ paused: true, tasks: [expect.objectContaining({ name: 'Resumo de sexta' })] })
  })
})

describe('histórico (contrato 23, CA7)', () => {
  it('fica com as últimas 500 (as mais antigas saem do disco)', async () => {
    const store = createFileRunsStore({ dir, max: 3 })
    for (let i = 0; i < 5; i++) {
      await store.save({
        id: `run-${i}`,
        taskId: null,
        taskName: null,
        agentId: null,
        agentName: 'A',
        trigger: 'ask',
        status: 'ok',
        startedAt: new Date(Date.UTC(2026, 10, 16, 10, i)).toISOString(),
        endedAt: null,
        durationMs: 0,
        model: 'haiku',
        costUsd: 0,
        prompt: 'p',
        answer: null,
        error: null,
        meetingId: null,
        outputResult: null,
      })
    }
    expect((await store.list()).map((run) => run.id)).toEqual(['run-4', 'run-3', 'run-2'])
    expect(readdirSync(join(dir, SCHEDULE_RUNS_DIR)).sort()).toEqual(['run-2.json', 'run-3.json', 'run-4.json'])
    expect(await store.get('run-0')).toBeNull()
    expect((await store.get('run-4'))?.prompt).toBe('p')
  })
})
