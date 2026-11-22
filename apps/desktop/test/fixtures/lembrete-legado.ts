// Contrato 131: o lembrete antigo do Assistente (contrato 25) gravado direto no `schedules.json`, no formato que o
// `createReminder` das Automações gravava. Nada cria mais esse formato (desde o 127 os lembretes são tarefas), mas o que
// restar num arquivo antigo, até a migração, ainda avisa no horário; os testes do aviso semeiam por aqui.
import { createFileSchedulesStore } from '../../src/main/schedules/store'
import { TASK_TIMEOUT_MIN_S, type ScheduledTask, type TaskReminder } from '../../src/shared/automations'

/** Grava o lembrete para `at` (ISO com fuso) em `<dir>/schedules.json` e devolve a tarefa gravada. */
export async function semearLembrete(dir: string, input: { id: string; at: string; reminder: TaskReminder; timeZone: string; now: number }): Promise<ScheduledTask> {
  const quando = new Date(Date.parse(input.at)).toISOString()
  const criado = new Date(input.now).toISOString()
  const texto = input.reminder.text.trim()
  const lembrete: ScheduledTask = {
    id: input.id,
    name: `Lembrete: ${texto}`,
    agentId: '',
    message: texto,
    schedule: { kind: 'once', at: quando },
    timezone: input.timeZone,
    enabled: true,
    runOnce: true,
    runOnceAction: 'disable',
    timeoutS: TASK_TIMEOUT_MIN_S,
    notify: 'always',
    output: null,
    reminder: { ...input.reminder, text: texto },
    email: null,
    lastRunAt: null,
    nextRunAt: quando,
    lastStatus: null,
    lastResultPreview: null,
    lastError: null,
    consecutiveFailures: 0,
    autoPaused: false,
    createdAt: criado,
    updatedAt: criado,
  }
  await createFileSchedulesStore({ dir }).mutate((state) => ({ ...state, tasks: [...state.tasks, lembrete] }))
  return lembrete
}
