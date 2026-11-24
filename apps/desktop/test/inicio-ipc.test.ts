// Contrato 134 (inicio, D10): os canais `scribe:inicio-*` com um `ipcMain` falso, como em `tarefas-ipc.test.ts`. O
// pedido sem campo nenhum passa; qualquer outra coisa é recusada pelo esquema `.strict()` sem chamar o serviço; os
// dois são recusados com o app bloqueado, antes do handler; o evento existe só no sentido main → renderer.
// Contrato 145 (D3, CA8): o `scribe:inicio-atualizar`, no mesmo formato e também recusado bloqueado.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { InicioView } from '../src/shared/inicio'
import { LOCKED_ERROR } from '../src/shared/lock'

const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: () => undefined,
  },
}))

const { setLockGate } = await import('../src/main/ipc')
const { INICIO_PEDIDO, registerInicioIpc } = await import('../src/main/inicio/ipc')

const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }
const VIEW: InicioView = { hoje: '2026-11-17', agenda: { eventos: [], amanha: 0, contas: false, mac: 'ok' }, pendencias: { whatsapp: null, convites: null, emails: null, emailsNaoLidos: 0 }, saudacaoNome: null, atualizadoEm: '2026-11-17T13:00:00.000Z' }

let locked = false
const calls: string[] = []
setLockGate(() => locked)
registerInicioIpc({
  appOrigin: ORIGIN,
  inicio: {
    view: () => {
      calls.push('view')
      return Promise.resolve(VIEW)
    },
    macAccess: () => {
      calls.push('macAccess')
      return Promise.resolve(VIEW)
    },
    atualizar: () => {
      calls.push('atualizar')
      return Promise.resolve({ ok: true, view: VIEW, falhou: false })
    },
  },
})

afterEach(() => {
  locked = false
  calls.length = 0
})

const canal = (nome: string): ((event: unknown, ...args: unknown[]) => unknown) => {
  const handler = invokeHandlers.get(nome)
  if (!handler) throw new Error(`canal não registrado: ${nome}`)
  return handler
}
const chamar = (nome: string, ...args: unknown[]): Promise<unknown> => Promise.resolve().then(() => canal(nome)(trusted, ...args))

describe('canais da tela Início', () => {
  it('os três canais e o evento existem; os três canais são recusados com o app bloqueado', () => {
    expect(INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:inicio-')).sort()).toEqual(['scribe:inicio-atualizar', 'scribe:inicio-get', 'scribe:inicio-mac-acesso'])
    expect(MAIN_EVENT_CHANNELS.filter((channel) => channel.startsWith('scribe:inicio-'))).toEqual(['scribe:inicio-changed'])
    expect(WHEN_LOCKED['scribe:inicio-get']).toBe('refused')
    expect(WHEN_LOCKED['scribe:inicio-mac-acesso']).toBe('refused')
    expect(WHEN_LOCKED['scribe:inicio-atualizar']).toBe('refused')
    expect(invokeHandlers.has('scribe:inicio-atualizar')).toBe(true)
  })

  it('atualizar (CA8): sem pedido devolve a resposta; campo a mais é recusado sem lançar no main nem chamar o serviço', async () => {
    await expect(chamar('scribe:inicio-atualizar')).resolves.toEqual({ ok: true, view: VIEW, falhou: false })
    await expect(chamar('scribe:inicio-atualizar', {})).resolves.toEqual({ ok: true, view: VIEW, falhou: false })
    expect(calls).toEqual(['atualizar', 'atualizar'])
    calls.length = 0
    for (const pedido of [{ extra: 1 }, 'x', 1, null, []]) {
      await expect(chamar('scribe:inicio-atualizar', pedido)).rejects.toThrow(/scribe:inicio-atualizar: pedido fora do formato/)
    }
    expect(calls).toEqual([])
    locked = true
    await expect(chamar('scribe:inicio-atualizar')).rejects.toThrow(new RegExp(`^${LOCKED_ERROR}$`))
    expect(calls).toEqual([])
  })

  it('sem pedido (ou {}) devolve a view; campo a mais ou outro tipo é recusado sem chamar o serviço', async () => {
    await expect(chamar('scribe:inicio-get')).resolves.toEqual(VIEW)
    await expect(chamar('scribe:inicio-get', {})).resolves.toEqual(VIEW)
    await expect(chamar('scribe:inicio-mac-acesso')).resolves.toEqual(VIEW)
    expect(calls).toEqual(['view', 'view', 'macAccess'])
    calls.length = 0
    for (const pedido of [{ extra: 1 }, 'x', 1, null, []]) {
      await expect(chamar('scribe:inicio-get', pedido)).rejects.toThrow(/pedido fora do formato/)
      await expect(chamar('scribe:inicio-mac-acesso', pedido)).rejects.toThrow(/pedido fora do formato/)
    }
    expect(calls).toEqual([])
    expect(INICIO_PEDIDO.safeParse({ a: 1 }).success).toBe(false)
  })

  it('bloqueado: os dois recusados antes do handler (nenhum "Conceder" sai)', async () => {
    locked = true
    await expect(chamar('scribe:inicio-get')).rejects.toThrow(new RegExp(`^${LOCKED_ERROR}$`))
    await expect(chamar('scribe:inicio-mac-acesso')).rejects.toThrow(new RegExp(`^${LOCKED_ERROR}$`))
    expect(calls).toEqual([])
    locked = false
    await expect(chamar('scribe:inicio-mac-acesso')).resolves.toEqual(VIEW)
  })

  it('origem de fora não é atendida', async () => {
    await expect(Promise.resolve().then(() => canal('scribe:inicio-get')({ senderFrame: { url: 'https://example.com/' } }))).rejects.toThrow(/origem não autorizada/)
    expect(calls).toEqual([])
  })
})
