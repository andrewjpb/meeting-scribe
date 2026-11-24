// Store da triagem do WhatsApp (contrato 162, CA3, CA4 e CA9): a leitura das etiquetas e do estado, a releitura no
// desbloqueio, a escolha do dono gravada com a resposta do main, os avisos de mudança e o "Triar agora" com o erro
// tipado. Cada teste carrega o módulo de novo (a releitura pendente fica no módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCK_STATUS_INITIAL } from '../../src/shared/lock'
import { contagensAbas, naAba, type Etiqueta, type TriagemStatus } from '../../src/shared/triagem'
import type * as LockModule from '../../src/renderer/src/app/lockStore'
import type * as StoreModule from '../../src/renderer/src/features/whatsapp/triagemStore'

const etiqueta = (patch: Partial<Etiqueta> = {}): Etiqueta => ({ urgente: false, ambito: null, ambitoFixo: false, urgenteFixo: false, origem: 'manual', lastMessageId: null, motivo: null, at: 1, ...patch })
const STATUS: TriagemStatus = { ativo: true, motivo: null, agenteNome: 'Triagem do WhatsApp', tarefaId: 't1', hoje: 0, teto: 300 }
const ANA = '5511@s.whatsapp.net'

describe('triagemStore', () => {
  const invoke = vi.fn()
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  let mod: typeof StoreModule
  let lock: typeof LockModule
  const store = () => mod.useTriagem.getState()
  const emit = (channel: string, payload: unknown): void => listeners.get(channel)?.forEach((listener) => listener(payload))

  beforeEach(async () => {
    invoke.mockReset()
    listeners.clear()
    vi.stubGlobal('window', {
      __scribeApi: {
        invoke,
        on: (channel: string, listener: (payload: unknown) => void) => {
          listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
          return () => listeners.set(channel, (listeners.get(channel) ?? []).filter((known) => known !== listener))
        },
      },
    })
    vi.resetModules()
    mod = await import('../../src/renderer/src/features/whatsapp/triagemStore')
    lock = await import('../../src/renderer/src/app/lockStore')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('load lê as etiquetas e o estado do motor', async () => {
    invoke.mockResolvedValue({ etiquetas: { [ANA]: etiqueta({ urgente: true }) }, status: STATUS })
    expect(store().status).toBeNull()
    await store().load()
    expect(invoke).toHaveBeenCalledWith('scribe:triagem-list')
    expect(store().etiquetas[ANA]?.urgente).toBe(true)
    expect(store().status).toEqual(STATUS)
  })

  it('load recusado com o app bloqueado relê no desbloqueio', async () => {
    lock.useLock.setState({ status: { ...LOCK_STATUS_INITIAL, locked: true, hasPassword: true, canLock: true } })
    invoke.mockImplementation(async (channel: string) => {
      if (lock.useLock.getState().status.locked) throw new Error(`Error invoking remote method '${channel}': Error: locked`)
      return { etiquetas: {}, status: STATUS }
    })
    await store().load()
    expect(store().status).toBeNull()
    lock.useLock.setState({ status: { ...LOCK_STATUS_INITIAL, hasPassword: true, canLock: true } })
    await vi.waitFor(() => expect(store().status).toEqual(STATUS))
  })

  it('CA3: set manda o patch e aplica a etiqueta devolvida; a recusa não mexe no que está', async () => {
    invoke.mockResolvedValueOnce({ ok: true, etiqueta: etiqueta({ ambito: 'pessoal', ambitoFixo: true }) })
    expect(await store().set(ANA, { ambito: 'pessoal' })).toEqual({ ok: true })
    expect(invoke).toHaveBeenLastCalledWith('scribe:triagem-set', { chatId: ANA, patch: { ambito: 'pessoal' } })
    expect(store().etiquetas[ANA]?.ambito).toBe('pessoal')

    invoke.mockResolvedValueOnce({ ok: true, etiqueta: etiqueta({ ambito: null }) })
    await store().set(ANA, { ambito: null })
    expect(invoke).toHaveBeenLastCalledWith('scribe:triagem-set', { chatId: ANA, patch: { ambito: null } })
    expect(store().etiquetas[ANA]?.ambito).toBeNull()

    invoke.mockResolvedValueOnce({ ok: false, error: 'invalid' })
    expect(await store().set(ANA, { urgente: true })).toEqual({ ok: false, error: 'invalid' })
    expect(store().etiquetas[ANA]?.urgente).toBe(false)
  })

  it('CA4: os avisos do main trocam a etiqueta (null tira) e o estado', () => {
    const off = mod.watchTriagem()
    emit('scribe:triagem-changed', { chatId: ANA, etiqueta: etiqueta({ urgente: true, ambito: 'profissional' }) })
    expect(store().etiquetas[ANA]).toMatchObject({ urgente: true, ambito: 'profissional' })
    emit('scribe:triagem-changed', { chatId: ANA, etiqueta: null })
    expect(store().etiquetas[ANA]).toBeUndefined()
    emit('scribe:triagem-status-changed', { ...STATUS, ativo: false, motivo: 'desligado' })
    expect(store().status?.motivo).toBe('desligado')
    off()
    emit('scribe:triagem-status-changed', STATUS)
    expect(store().status?.motivo).toBe('desligado')
  })

  it('CA3: runNow devolve o erro tipado, com a frase de cada um', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'sem-agente' })
    const result = await store().runNow(ANA)
    expect(invoke).toHaveBeenLastCalledWith('scribe:triagem-run', { chatId: ANA })
    expect(result).toEqual({ ok: false, error: 'sem-agente' })
    expect(mod.TRIAGEM_RUN_ERRORS['sem-agente']).toBe('Nenhum agente de triagem ativo.')
    expect(mod.TRIAGEM_RUN_ERRORS.desligado).toBe('A triagem está desligada em Configurações.')
    expect(mod.TRIAGEM_RUN_ERRORS.ocupado).toBe('Já há uma triagem desta conversa em andamento.')
  })

  it('contrato 171 (C2, C10): "Triando…" fica até o aviso do fim daquela conversa; a recusa solta na hora', async () => {
    const off = mod.watchTriagem()
    invoke.mockResolvedValueOnce({ ok: true })
    expect(await store().runNow(ANA)).toEqual({ ok: true })
    expect(store().triando[ANA]).toBe(true)
    emit('scribe:triagem-done', { chatId: 'outra@s.whatsapp.net', ok: true })
    expect(store().triando[ANA]).toBe(true)
    emit('scribe:triagem-done', { chatId: ANA, ok: false })
    expect(store().triando[ANA]).toBeUndefined()
    invoke.mockResolvedValueOnce({ ok: false, error: 'grupos' })
    expect(await store().runNow(ANA)).toEqual({ ok: false, error: 'grupos' })
    expect(store().triando[ANA]).toBeUndefined()
    expect(mod.TRIAGEM_RUN_ERRORS.grupos).toBe('Grupos estão fora da triagem. Ligue “Incluir grupos” na tarefa.')
    expect(mod.TRIAGEM_TRIANDO_MAX_MS).toBe(35_000)
    off()
  })

  it('createFromTemplate relê o estado quando cria', async () => {
    invoke.mockImplementation(async (channel: string) => (channel === 'scribe:triagem-create-from-template' ? { ok: true, agentId: 'a', taskId: 't' } : { etiquetas: {}, status: STATUS }))
    expect(await store().createFromTemplate()).toEqual({ ok: true, agentId: 'a', taskId: 't' })
    await vi.waitFor(() => expect(store().status).toEqual(STATUS))
  })

  it('CA1: o filtro por aba vem antes da busca e as contagens são sobre todas as conversas', () => {
    const chats = [
      { id: 'a', name: 'Ana', unread: 2 },
      { id: 'b', name: 'Bruno', unread: 1 },
      { id: 'c', name: 'Carla', unread: 0 },
      { id: 'd', name: 'Davi', unread: 0 },
    ]
    const etiquetas = { a: etiqueta({ urgente: true, ambito: 'profissional' }), c: etiqueta({ ambito: 'pessoal' }) }
    const aba = (nome: Parameters<typeof naAba>[2], busca = '') => chats.filter((chat) => naAba(chat, etiquetas[chat.id as 'a'] ?? null, nome)).filter((chat) => chat.name.toLowerCase().includes(busca))
    expect(aba('todas')).toHaveLength(4)
    expect(aba('nao-lidas')).toHaveLength(2)
    expect(aba('urgentes').map((chat) => chat.id)).toEqual(['a'])
    expect(aba('pessoal').map((chat) => chat.id)).toEqual(['c'])
    expect(aba('profissional').map((chat) => chat.id)).toEqual(['a'])
    expect(aba('urgentes', 'bru')).toHaveLength(0)
    expect(contagensAbas(chats, etiquetas)).toEqual({ naoLidas: 2, urgentes: 1 })
  })
})
