// Store do atendimento (contrato 142, CA1 a CA8): a leitura juntando as chamadas seguidas, a recusa com o app bloqueado,
// o aviso de mudança assinado uma vez, as mutações trocando o estado pelo devolvido, as frases de erro, o teste sem
// mexer em nada, o histórico com o filtro e o descarte da proposta. Cada teste carrega o módulo de novo: a assinatura
// e a leitura em curso ficam no módulo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCK_STATUS_INITIAL } from '../../src/shared/lock'
import type { AtendimentoAgent, AtendimentoLogEntry, AtendimentoRuntime, AtendimentoState } from '../../src/shared/atendimento'
import type * as LockModule from '../../src/renderer/src/app/lockStore'
import type * as StoreModule from '../../src/renderer/src/features/atendimento/atendimentoStore'

type Store = typeof StoreModule
type Lock = typeof LockModule

const agent = (id: string, name = id): AtendimentoAgent => ({ id, name, instructions: 'Regras', tone: '', never: '', model: 'haiku', createdAt: '2026-11-23T10:00:00.000Z', updatedAt: '2026-11-23T10:00:00.000Z' })
const stateWith = (...agents: AtendimentoAgent[]): AtendimentoState => ({ agents, bindings: [], pausedAll: false, riskAcceptedAt: null })
const RUNTIME: AtendimentoRuntime = { '5511@s.whatsapp.net': { dueAt: null, draft: null, handedOffAt: null } }
const ENTRIES: AtendimentoLogEntry[] = [
  { at: '2026-11-23T14:51:00.000Z', chatId: '5511@s.whatsapp.net', agentId: 'a', action: 'drafted' },
  { at: '2026-11-23T14:43:00.000Z', chatId: '5522@s.whatsapp.net', agentId: 'a', action: 'sent' },
]

describe('atendimentoStore', () => {
  const invoke = vi.fn()
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  let mod: Store
  let lock: Lock
  const store = () => mod.useAtendimento.getState()
  const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel)

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
    mod = await import('../../src/renderer/src/features/atendimento/atendimentoStore')
    lock = await import('../../src/renderer/src/app/lockStore')
  })
  afterEach(() => vi.unstubAllGlobals())

  const answering = (state: AtendimentoState = stateWith(agent('a'))) =>
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'scribe:atendimento-state') return { ok: true, state }
      if (channel === 'scribe:atendimento-runtime') return RUNTIME
      throw new Error(channel)
    })

  it('CA1: load lê o estado e o runtime e marca loaded; chamadas seguidas viram uma só leitura extra', async () => {
    answering()
    await store().load()
    expect(store()).toMatchObject({ loaded: true, failure: null, state: stateWith(agent('a')), runtime: RUNTIME })
    expect(calls('scribe:atendimento-state')).toHaveLength(1)
    expect(calls('scribe:atendimento-runtime')).toHaveLength(1)

    invoke.mockClear()
    await Promise.all([store().load(), store().load(), store().load(), store().load()])
    expect(calls('scribe:atendimento-state')).toHaveLength(2)
    expect(calls('scribe:atendimento-runtime')).toHaveLength(2)
  })

  it('CA2: recusado com o app bloqueado, não grava falha e relê no desbloqueio', async () => {
    lock.useLock.setState({ status: { ...LOCK_STATUS_INITIAL, locked: true, hasPassword: true, canLock: true } })
    invoke.mockImplementation(async (channel: string) => {
      if (lock.useLock.getState().status.locked) throw new Error(`Error invoking remote method '${channel}': Error: locked`)
      if (channel === 'scribe:atendimento-state') return { ok: true, state: stateWith() }
      return RUNTIME
    })
    await store().load()
    expect(store()).toMatchObject({ loaded: false, failure: null })
    lock.useLock.setState({ status: { ...LOCK_STATUS_INITIAL, hasPassword: true, canLock: true } })
    await vi.waitFor(() => expect(store().loaded).toBe(true))
    expect(store().failure).toBeNull()
  })

  it('CA2: outra falha grava a frase', async () => {
    invoke.mockRejectedValue(new Error('caiu'))
    await store().load()
    expect(store()).toMatchObject({ loaded: false, failure: 'Não foi possível ler os atendimentos.' })
  })

  it('CA3: assina scribe:atendimento-changed uma vez só e, a cada aviso, relê só o runtime', async () => {
    answering()
    await store().load()
    await store().load()
    expect(listeners.get('scribe:atendimento-changed')).toHaveLength(1)
    invoke.mockClear()
    const next: AtendimentoRuntime = { 'x@s.whatsapp.net': { dueAt: '2026-11-23T15:00:00.000Z', draft: null, handedOffAt: null } }
    invoke.mockResolvedValueOnce(next)
    listeners.get('scribe:atendimento-changed')?.[0]?.({ chatId: 'x@s.whatsapp.net' })
    await vi.waitFor(() => expect(store().runtime).toEqual(next))
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['scribe:atendimento-runtime'])
  })

  describe('CA4: mutações', () => {
    const cases = [
      ['saveAgent', 'scribe:atendimento-agent-save', (s: Store['useAtendimento']) => s.getState().saveAgent({ id: null, name: 'b', instructions: 'x', model: 'haiku' })],
      ['deleteAgent', 'scribe:atendimento-agent-delete', (s: Store['useAtendimento']) => s.getState().deleteAgent('a')],
      ['saveBinding', 'scribe:atendimento-binding-save', (s: Store['useAtendimento']) => s.getState().saveBinding({ chatId: '5511@s.whatsapp.net', agentId: 'a' })],
      ['deleteBinding', 'scribe:atendimento-binding-delete', (s: Store['useAtendimento']) => s.getState().deleteBinding('5511@s.whatsapp.net')],
      ['pauseAll', 'scribe:atendimento-pause-all', (s: Store['useAtendimento']) => s.getState().pauseAll(true)],
      ['acceptRisk', 'scribe:atendimento-risk-accept', (s: Store['useAtendimento']) => s.getState().acceptRisk()],
    ] as const

    it.each(cases)('%s: ok troca o estado pelo devolvido, sem nova leitura', async (_name, channel, run) => {
      const before = stateWith(agent('a'))
      const after = stateWith(agent('a'), agent('b'))
      mod.useAtendimento.setState({ state: before, loaded: true })
      invoke.mockResolvedValueOnce({ ok: true, state: after, agent: agent('b'), binding: null })
      const result = await run(mod.useAtendimento)
      expect(result.ok).toBe(true)
      expect(store().state).toEqual(after)
      expect(invoke.mock.calls.map(([name]) => name)).toEqual([channel])
    })

    it.each(cases)('%s: ok sem estado na resposta relê', async (_name, channel, run) => {
      const fresh = stateWith(agent('z'))
      invoke.mockImplementation(async (name: string) => {
        if (name === channel) return { ok: true }
        if (name === 'scribe:atendimento-state') return { ok: true, state: fresh }
        return RUNTIME
      })
      const result = await run(mod.useAtendimento)
      expect(result.ok).toBe(true)
      expect(store().state).toEqual(fresh)
      expect(calls('scribe:atendimento-state')).toHaveLength(1)
    })

    it.each(cases)('%s: recusa devolve a frase e não muda o store', async (_name, _channel, run) => {
      const before = stateWith(agent('a'))
      mod.useAtendimento.setState({ state: before, loaded: true })
      invoke.mockResolvedValueOnce({ ok: false, error: 'not-found' })
      expect(await run(mod.useAtendimento)).toEqual({ ok: false, reason: 'Não encontrado. Atualize a tela.' })
      expect(store().state).toBe(before)
      expect(invoke).toHaveBeenCalledTimes(1)
    })
  })

  it.each([
    ['name-taken', 'Já existe um agente com esse nome.'],
    ['agent-not-found', 'Esse agente não existe mais.'],
    ['group-not-allowed', 'Atendimento não funciona em grupos.'],
    ['not-found', 'Não encontrado. Atualize a tela.'],
    ['invalid', 'Confira os campos e tente de novo.'],
    ['outro', 'Não foi possível salvar.'],
  ])('CA5: %s → %s', async (error, reason) => {
    invoke.mockResolvedValueOnce({ ok: false, error })
    expect(await store().saveAgent({ id: null, name: 'b', instructions: 'x', model: 'haiku' })).toEqual({ ok: false, reason })
  })

  it('CA5: risk-required não vira frase no saveBinding', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'risk-required' })
    expect(await store().saveBinding({ chatId: '5511@s.whatsapp.net', agentId: 'a', mode: 'auto' })).toEqual({ ok: false, reason: 'risk-required' })
    expect(store().state).toBeNull()
  })

  it('CA6: testAgent devolve a decisão e o tempo, sem mexer no store', async () => {
    mod.useAtendimento.setState({ state: stateWith(agent('a')), runtime: RUNTIME, log: ENTRIES })
    const before = store()
    invoke.mockResolvedValueOnce({ ok: true, decision: { acao: 'responder', texto: 'Oi!' } })
    const request = { agent: { name: 'a', instructions: 'Regras', model: 'haiku' as const }, about: '', message: 'Oi' }
    const result = await store().testAgent(request)
    expect(result).toMatchObject({ ok: true, decision: { acao: 'responder', texto: 'Oi!' } })
    expect(result.ok && typeof result.ms === 'number' && result.ms >= 0).toBe(true)
    expect(invoke).toHaveBeenCalledWith('scribe:atendimento-agent-test', request)
    expect(store().state).toBe(before.state)
    expect(store().runtime).toBe(before.runtime)
    expect(store().log).toBe(before.log)
  })

  it('CA6: falha (recusa ou erro) vira a frase do teste', async () => {
    const request = { agent: { name: 'a', instructions: 'Regras', model: 'haiku' as const }, about: '', message: 'Oi' }
    invoke.mockResolvedValueOnce({ ok: false, error: 'failed' })
    expect(await store().testAgent(request)).toEqual({ ok: false, reason: 'Não foi possível testar agora.' })
    invoke.mockRejectedValueOnce(new Error('caiu'))
    expect(await store().testAgent(request)).toEqual({ ok: false, reason: 'Não foi possível testar agora.' })
  })

  it('CA7: loadLog pede 200 com o filtro e guarda na ordem recebida; setLogChatId guarda e relê', async () => {
    invoke.mockResolvedValue({ ok: true, entries: ENTRIES })
    await store().loadLog()
    expect(invoke).toHaveBeenLastCalledWith('scribe:atendimento-log-list', { limit: 200 })
    expect(store().log).toEqual(ENTRIES)

    await store().loadLog('5522@s.whatsapp.net')
    expect(invoke).toHaveBeenLastCalledWith('scribe:atendimento-log-list', { limit: 200, chatId: '5522@s.whatsapp.net' })

    invoke.mockResolvedValue({ ok: true, entries: [ENTRIES[0]] })
    await store().setLogChatId('5511@s.whatsapp.net')
    expect(store().logChatId).toBe('5511@s.whatsapp.net')
    expect(invoke).toHaveBeenLastCalledWith('scribe:atendimento-log-list', { limit: 200, chatId: '5511@s.whatsapp.net' })
    expect(store().log).toEqual([ENTRIES[0]])

    await store().setLogChatId(null)
    expect(store().logChatId).toBeNull()
    expect(invoke).toHaveBeenLastCalledWith('scribe:atendimento-log-list', { limit: 200 })
  })

  it('CA8: discardDraft descarta e relê o runtime', async () => {
    invoke.mockImplementation(async (channel: string) => (channel === 'scribe:atendimento-draft-discard' ? { ok: true } : RUNTIME))
    expect(await store().discardDraft('5511@s.whatsapp.net')).toEqual({ ok: true })
    expect(invoke.mock.calls).toEqual([['scribe:atendimento-draft-discard', { chatId: '5511@s.whatsapp.net' }], ['scribe:atendimento-runtime']])
    expect(store().runtime).toEqual(RUNTIME)
  })
})
