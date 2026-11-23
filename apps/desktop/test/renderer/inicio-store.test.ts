// Store do Início (contrato 146, CA1 e CA2): o "Atualizar" pede `scribe:inicio-atualizar` uma vez por vez, liga
// `atualizando` até a resposta e guarda o `falhou`; a recusa mantém a view; uma view nova bem-sucedida (pelo `load`, pelo
// evento ou por um "Atualizar" sem falha) limpa o `falhou`. Cada teste carrega o módulo de novo (o store é do módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InicioAtualizarResult, InicioView } from '../../src/shared/inicio'
import type * as StoreModule from '../../src/renderer/src/features/inicio/inicioStore'

const view = (atualizadoEm: string, emailsNaoLidos = 0): InicioView => ({
  hoje: '2026-11-23',
  agenda: { eventos: [], amanha: 0, contas: false, mac: 'ok' },
  pendencias: { whatsapp: null, convites: null, emails: null, emailsNaoLidos },
  saudacaoNome: null,
  atualizadoEm,
})

describe('inicioStore: atualizar', () => {
  const invoke = vi.fn()
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  let mod: typeof StoreModule
  const store = () => mod.useInicio.getState()
  const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel)
  const emit = (channel: string, payload: unknown): void => {
    for (const listener of listeners.get(channel) ?? []) listener(payload)
  }

  beforeEach(async () => {
    invoke.mockReset()
    listeners.clear()
    vi.stubGlobal('window', {
      __scribeApi: {
        invoke,
        on: (channel: string, listener: (payload: unknown) => void) => {
          listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
          return () => undefined
        },
      },
    })
    vi.resetModules()
    mod = await import('../../src/renderer/src/features/inicio/inicioStore')
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Um pedido de atualizar que só responde quando o teste manda. */
  const pendente = () => {
    let responder: (result: InicioAtualizarResult) => void = () => undefined
    let recusar: (error: Error) => void = () => undefined
    invoke.mockImplementation((channel: string) => {
      if (channel !== 'scribe:inicio-atualizar') return Promise.reject(new Error(channel))
      return new Promise<InicioAtualizarResult>((resolve, reject) => {
        responder = resolve
        recusar = reject
      })
    })
    return { responder: (result: InicioAtualizarResult) => responder(result), recusar: (error: Error) => recusar(error) }
  }

  it('CA1: liga atualizando até a resposta, troca a view e guarda o falhou', async () => {
    const pedido = pendente()
    const rodando = store().atualizar()
    expect(store().atualizando).toBe(true)
    expect(calls('scribe:inicio-atualizar')).toHaveLength(1)
    pedido.responder({ ok: true, view: view('2026-11-23T17:32:00.000Z'), falhou: true })
    await rodando
    expect(store()).toMatchObject({ atualizando: false, falhou: true, view: view('2026-11-23T17:32:00.000Z') })
  })

  it('CA1: com atualizando ligado, outro clique não faz outro pedido', async () => {
    const pedido = pendente()
    const primeiro = store().atualizar()
    await store().atualizar()
    await store().atualizar()
    expect(calls('scribe:inicio-atualizar')).toHaveLength(1)
    pedido.responder({ ok: true, view: view('2026-11-23T17:32:00.000Z'), falhou: false })
    await primeiro
    expect(store().atualizando).toBe(false)
  })

  it('CA1: canal recusado: atualizando volta a false, falhou fica true e a view de antes permanece', async () => {
    const antes = view('2026-11-23T17:00:00.000Z', 2)
    mod.useInicio.setState({ view: antes })
    const pedido = pendente()
    const rodando = store().atualizar()
    pedido.recusar(new Error('bloqueado'))
    await rodando
    expect(store()).toMatchObject({ atualizando: false, falhou: true })
    expect(store().view).toBe(antes)
  })

  it('CA2: um atualizar sem falha limpa o falhou', async () => {
    mod.useInicio.setState({ falhou: true })
    invoke.mockResolvedValue({ ok: true, view: view('2026-11-23T17:40:00.000Z'), falhou: false })
    await store().atualizar()
    expect(store()).toMatchObject({ falhou: false, view: view('2026-11-23T17:40:00.000Z') })
  })

  it('CA2: o load bem-sucedido limpa o falhou; o que falha não', async () => {
    mod.useInicio.setState({ falhou: true })
    invoke.mockRejectedValueOnce(new Error('fora do ar'))
    await store().load()
    expect(store().falhou).toBe(true)
    invoke.mockResolvedValueOnce(view('2026-11-23T17:41:00.000Z'))
    await store().load()
    expect(store()).toMatchObject({ falhou: false, view: view('2026-11-23T17:41:00.000Z') })
  })

  it('falha parcial: o aviso que as fontes boas do mesmo Atualizar mandam em seguida não apaga a falha; a leitura seguinte apaga', async () => {
    const agora = Date.now()
    invoke.mockResolvedValueOnce({ ok: true, view: view(new Date(agora).toISOString(), 2), falhou: true })
    store().watch()
    await store().atualizar()
    expect(store().falhou).toBe(true)
    // Eco: a agenda (ou outra conta) releu no mesmo clique e o main avisa até 1 s depois.
    emit('scribe:inicio-changed', view(new Date(agora + 1_000).toISOString(), 3))
    expect(store()).toMatchObject({ falhou: true })
    expect(store().view?.pendencias.emailsNaoLidos).toBe(3)
    // Leitura nova, bem depois: o aviso some.
    emit('scribe:inicio-changed', view(new Date(agora + 60_000).toISOString(), 4))
    expect(store()).toMatchObject({ falhou: false })
  })

  it('CA2 e CA9: a view do evento entra com o atualizadoEm dela e limpa o falhou', () => {
    mod.useInicio.setState({ falhou: true, view: view('2026-11-23T17:00:00.000Z') })
    store().watch()
    emit('scribe:inicio-changed', view('2026-11-23T17:45:00.000Z', 1))
    expect(store()).toMatchObject({ falhou: false })
    expect(store().view?.atualizadoEm).toBe('2026-11-23T17:45:00.000Z')
    expect(store().view?.pendencias.emailsNaoLidos).toBe(1)
  })
})
