// Store do email (contrato 43, CA6): as contas e as Caixas de Entrada lidas ao abrir; "marcar como lida" otimista que
// volta se o servidor recusar; apagar; o email novo entrando na lista; os corpos pedidos uma vez (no máximo 3 ao mesmo
// tempo); e a conta removida levando as listas e o rascunho junto.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailAccountStatus, EmailMessage } from '../../src/shared/email'
import { bodyKey, folderKey, useEmail, watchEmail } from '../../src/renderer/src/features/email/emailStore'
import { emptyDraft } from '../../src/renderer/src/features/email/format'

const A = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const B = '1b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'

const status = (id: string): EmailAccountStatus => ({
  account: { id, address: `${id.slice(0, 4)}@lap.example`, name: null, username: 'x', incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' }, outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' }, deleteFromServer: false },
  state: 'connected',
  error: null,
})

const message = (id: string, date: number, over: Partial<EmailMessage> = {}): EmailMessage => ({
  id,
  accountId: A,
  folder: 'inbox',
  uid: Number(id),
  seen: false,
  flagged: false,
  answered: false,
  from: [{ name: 'Marina', address: 'marina@cliente.example' }],
  to: [],
  cc: [],
  subject: `Assunto ${id}`,
  date,
  messageId: null,
  inReplyTo: null,
  references: [],
  ...over,
})

describe('emailStore', () => {
  const invoke = vi.fn()
  const listeners = new Map<string, (payload: unknown) => void>()

  beforeEach(() => {
    invoke.mockReset()
    vi.stubGlobal('window', {
      __scribeApi: {
        invoke,
        on: (channel: string, listener: (payload: unknown) => void) => {
          listeners.set(channel, listener)
          return () => listeners.delete(channel)
        },
      },
    })
    useEmail.setState({ accounts: null, loadFailed: false, folders: {}, bodies: {}, draft: null, composing: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('ao abrir: as contas e a Caixa de Entrada de cada uma, da mais nova para a mais antiga', async () => {
    invoke.mockImplementation(async (channel: string, request?: { accountId: string }) => {
      if (channel === 'scribe:email-accounts') return [status(A), status(B)]
      if (channel === 'scribe:email-messages') return request?.accountId === A ? [message('1', 10), message('2', 30)] : []
      throw new Error(channel)
    })
    await useEmail.getState().load()
    expect(useEmail.getState().accounts?.map((item) => item.account.id)).toEqual([A, B])
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]?.map((item) => item.id)).toEqual(['2', '1'])
    expect(useEmail.getState().folders[folderKey(B, 'inbox')]).toEqual([])
  })

  it('bloqueado (canal recusado): a falha fica marcada e nada some', async () => {
    invoke.mockRejectedValue(new Error('locked'))
    await useEmail.getState().load()
    expect(useEmail.getState()).toMatchObject({ accounts: null, loadFailed: true })
  })

  it('marcar como lida muda na hora e volta se o servidor recusar', async () => {
    useEmail.setState({ folders: { [folderKey(A, 'inbox')]: [message('1', 10)] } })
    invoke.mockResolvedValueOnce(true)
    expect(await useEmail.getState().markRead(A, '1', true)).toBe(true)
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]?.[0]?.seen).toBe(true)
    invoke.mockResolvedValueOnce(false)
    expect(await useEmail.getState().markRead(A, '1', false)).toBe(false)
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]?.[0]?.seen).toBe(true)
    expect(invoke).toHaveBeenLastCalledWith('scribe:email-mark-read', { accountId: A, id: '1', seen: false })
  })

  it('apagar tira da lista só se o main apagou; email novo entra no topo', async () => {
    useEmail.setState({ folders: { [folderKey(A, 'inbox')]: [message('2', 20), message('1', 10)] } })
    invoke.mockResolvedValueOnce(false)
    await useEmail.getState().remove(A, '1')
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]).toHaveLength(2)
    invoke.mockResolvedValueOnce(true)
    await useEmail.getState().remove(A, '1')
    useEmail.getState().receive(message('3', 40))
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]?.map((item) => item.id)).toEqual(['3', '2'])
  })

  it('corpo pedido uma vez, no máximo 3 ao mesmo tempo; a falha pode ser pedida de novo', async () => {
    const pending: ((value: unknown) => void)[] = []
    invoke.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    for (const id of ['1', '2', '3', '4']) useEmail.getState().requestBody(A, id)
    useEmail.getState().requestBody(A, '1')
    expect(invoke).toHaveBeenCalledTimes(3)
    pending[0]?.({ ok: true, body: { text: 'Oi', html: null, attachments: [] } })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(4))
    expect(useEmail.getState().bodies[bodyKey(A, '1')]).toEqual({ text: 'Oi', html: null, attachments: [] })
    pending[1]?.({ ok: false, error: 'unavailable' })
    await vi.waitFor(() => expect(useEmail.getState().bodies[bodyKey(A, '2')]).toBe('error'))
    useEmail.getState().requestBody(A, '2')
    expect(invoke).toHaveBeenCalledTimes(4)
    useEmail.getState().requestBody(A, '2', true)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(5))
  })

  it('conta removida: as listas, os corpos e o rascunho dela saem', async () => {
    invoke.mockResolvedValue([])
    const off = watchEmail()
    useEmail.setState({
      accounts: [status(A), status(B)],
      folders: { [folderKey(A, 'inbox')]: [message('1', 10)], [folderKey(B, 'inbox')]: [] },
      bodies: { [bodyKey(A, '1')]: 'error' },
      draft: emptyDraft(A),
      composing: true,
    })
    listeners.get('scribe:email-state')?.([status(B)])
    expect(useEmail.getState().folders[folderKey(A, 'inbox')]).toBeUndefined()
    expect(useEmail.getState().bodies).toEqual({})
    expect(useEmail.getState()).toMatchObject({ draft: null, composing: false })
    off()
  })
})
