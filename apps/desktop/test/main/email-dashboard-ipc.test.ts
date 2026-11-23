// Contrato 156: os canais `scribe:email-dashboard-*` com um `ipcMain` falso, como em `inicio-ipc.test.ts`. O pedido no
// formato chega ao serviço; fora dele (campo vazio, a mais, `kind` desconhecido, 0 ou mais de 500 mensagens) é recusado
// sem chamar o serviço; bloqueado, os cinco são recusados antes do handler; o evento só vai do main ao renderer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, RENDERER_EVENT_CHANNELS } from '../../src/shared/ipc'
import { LOCKED_ERROR } from '../../src/shared/lock'
import type { EmailDashboardView } from '../../src/shared/email-dashboard'

const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: () => undefined,
  },
}))

const { setLockGate } = await import('../../src/main/ipc')
const { registerEmailDashboardIpc } = await import('../../src/main/email/dashboard-ipc')

const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }
const VIEW: EmailDashboardView = { enabled: true, lastRun: null, analyzed: 0, running: false, accounts: [], attention: [], replies: [], moves: [] }

let locked = false
const calls: unknown[][] = []
setLockGate(() => locked)
registerEmailDashboardIpc({
  appOrigin: ORIGIN,
  dashboard: {
    view: async () => (calls.push(['view']), VIEW),
    run: async (trigger) => (calls.push(['run', trigger]), { started: true, running: true }),
    ignore: async (...args) => (calls.push(['ignore', ...args]), VIEW),
    markOpened: async (...args) => (calls.push(['opened', ...args]), VIEW),
    applyMove: async (...args) => (calls.push(['move', ...args]), { batchId: 'b', moved: args[2].length }),
  },
})

afterEach(() => {
  locked = false
  calls.length = 0
})

const chamar = (channel: string, request?: unknown): Promise<unknown> => Promise.resolve().then(() => invokeHandlers.get(channel)?.(trusted, request))

describe('canais do Painel de e-mail (contrato 156)', () => {
  it('cinco pedidos e um evento só de ida', () => {
    expect(INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:email-dashboard-')).every((channel) => invokeHandlers.has(channel))).toBe(true)
    expect(MAIN_EVENT_CHANNELS.filter((channel) => channel.startsWith('scribe:email-dashboard-'))).toEqual(['scribe:email-dashboard-changed'])
    expect(RENDERER_EVENT_CHANNELS.some((channel) => channel.startsWith('scribe:email-dashboard-'))).toBe(false)
  })

  it('o pedido no formato chega ao serviço; o "Analisar agora" é manual', async () => {
    await expect(chamar('scribe:email-dashboard-get')).resolves.toEqual(VIEW)
    await expect(chamar('scribe:email-dashboard-run', {})).resolves.toEqual({ started: true, running: true })
    await chamar('scribe:email-dashboard-ignore', { accountId: 'a', messageKey: 'k', kind: 'move' })
    await chamar('scribe:email-dashboard-opened', { accountId: 'a', messageKey: 'k' })
    await expect(chamar('scribe:email-dashboard-apply-move', { accountId: 'a', folder: 'Newsletters', messageKeys: ['1', '2'] })).resolves.toEqual({ batchId: 'b', moved: 2 })
    expect(calls).toEqual([['view'], ['run', 'manual'], ['ignore', 'a', 'k', 'move'], ['opened', 'a', 'k'], ['move', 'a', 'Newsletters', ['1', '2']]])
  })

  it.each([
    ['scribe:email-dashboard-get', { a: 1 }],
    ['scribe:email-dashboard-run', 'agora'],
    ['scribe:email-dashboard-ignore', { accountId: 'a', messageKey: 'k', kind: 'outro' }],
    ['scribe:email-dashboard-ignore', { accountId: '', messageKey: 'k', kind: 'reply' }],
    ['scribe:email-dashboard-opened', { accountId: 'a', messageKey: 'k', extra: true }],
    ['scribe:email-dashboard-apply-move', { accountId: 'a', folder: 'X', messageKeys: [] }],
    ['scribe:email-dashboard-apply-move', { accountId: 'a', folder: 'X', messageKeys: Array.from({ length: 501 }, (_, index) => String(index)) }],
    ['scribe:email-dashboard-apply-move', { accountId: 'a', folder: '', messageKeys: ['1'] }],
    ['scribe:email-dashboard-apply-move', undefined],
  ])('%s fora do formato é recusado sem chamar o serviço', async (channel, request) => {
    await expect(chamar(channel, request)).rejects.toThrow(/pedido fora do formato/)
    expect(calls).toEqual([])
  })

  it('bloqueado, recusado antes do handler', async () => {
    locked = true
    await expect(chamar('scribe:email-dashboard-apply-move', { accountId: 'a', folder: 'Newsletters', messageKeys: ['1'] })).rejects.toThrow(new RegExp(`^${LOCKED_ERROR}$`))
    expect(calls).toEqual([])
  })
})
