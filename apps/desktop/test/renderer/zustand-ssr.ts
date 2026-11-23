// Contrato 157: os testes de componente renderizam com `react-dom/server`, e no servidor o zustand lê o estado inicial
// da loja (`getServerSnapshot` = `getInitialState`), não o que o teste pôs com `setState`. Com
// `vi.mock('zustand', async (original) => (await import('./zustand-ssr')).withCurrentState(await original()))` as lojas
// criadas no teste passam a dar o estado atual também no servidor.
import type * as Zustand from 'zustand'

type Initializer = Zustand.StateCreator<object>

export function withCurrentState(actual: typeof Zustand): typeof Zustand {
  const bound = (initializer: Initializer) => {
    const api = actual.createStore(initializer)
    api.getInitialState = api.getState
    const hook = (selector?: (state: object) => unknown) => actual.useStore(api, selector ?? ((state) => state))
    return Object.assign(hook, api)
  }
  const create = ((initializer?: Initializer) => (initializer ? bound(initializer) : bound)) as unknown as typeof actual.create
  return { ...actual, create }
}
