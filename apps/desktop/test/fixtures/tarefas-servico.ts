// Contrato 127: o serviço das tarefas de verdade (store numa pasta temporária) para os testes do Assistente, com os outros
// domínios vazios e o funil pedido, e o registro das chamadas que os cartões fazem (`criar`, `salvar`, `status`, `apagar`).
import type { FunilState } from '../../src/shared/funil'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'
import type { TarefaInput, TarefaSalvar, TarefaStatus } from '../../src/shared/tarefas'
import { createTarefasService, type TarefasService } from '../../src/main/tarefas/service'
import { createTarefasStore } from '../../src/main/tarefas/store'

export interface ChamadasTarefas {
  criar: TarefaInput[]
  salvar: TarefaSalvar[]
  status: { id: string; status: TarefaStatus }[]
  apagar: { id: string }[]
}

/** O serviço e as chamadas registradas; `funil` (opcional) é o estado que o R9 lê. */
export function tarefasServico(dir: string, now: () => number, funil: () => FunilState | null = () => null): { service: TarefasService; chamadas: ChamadasTarefas } {
  const chamadas: ChamadasTarefas = { criar: [], salvar: [], status: [], apagar: [] }
  const real = createTarefasService({
    store: createTarefasStore({ dir, now }),
    funil: {
      state: () => {
        const state = funil()
        return state ? Promise.resolve(structuredClone(state)) : Promise.reject(new Error('sem funil'))
      },
    },
    meetings: { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
    summaries: { get: () => Promise.resolve(null) },
    analyses: { list: () => Promise.resolve([]) },
    insights: { read: () => Promise.resolve({}) },
    whatsapp: { chats: () => Promise.resolve([]) },
    settings: () => Promise.resolve({ tarefas: DEFAULT_SETTINGS.tarefas }),
    timeZone: () => 'America/Sao_Paulo',
    notify: () => undefined,
    onChange: () => undefined,
    now,
  })
  const service: TarefasService = {
    ...real,
    criar: (input) => (chamadas.criar.push(structuredClone(input)), real.criar(input)),
    salvar: (request) => (chamadas.salvar.push(structuredClone(request)), real.salvar(request)),
    status: (request) => (chamadas.status.push({ ...request }), real.status(request)),
    apagar: (request) => (chamadas.apagar.push({ ...request }), real.apagar(request)),
  }
  return { service, chamadas }
}
