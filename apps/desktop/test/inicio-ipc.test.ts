// Contrato 134 (inicio, D10): os canais `scribe:inicio-*` com um `ipcMain` falso, como em `tarefas-ipc.test.ts`. O
// pedido sem campo nenhum passa; qualquer outra coisa é recusada pelo esquema `.strict()` sem chamar o serviço; os
// dois são recusados com o app bloqueado, antes do handler; o evento existe só no sentido main → renderer.
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
const VIEW: InicioView = { hoje: '2026-11-17', agenda: { eventos: [], amanha: 0, contas: false, mac: 'ok' }, pendencias: { whatsapp: null, convites: null, emails: null }, saudacaoNome: null }

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
  it('os dois canais e o evento existem; os dois canais são recusados com o app bloqueado', () => {
    expect(INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:inicio-')).sort()).toEqual(['scribe:inicio-get', 'scribe:inicio-mac-acesso'])
    expect(MAIN_EVENT_CHANNELS.filter((channel) => channel.startsWith('scribe:inicio-'))).toEqual(['scribe:inicio-changed'])
    expect(WHEN_LOCKED['scribe:inicio-get']).toBe('refused')
    expect(WHEN_LOCKED['scribe:inicio-mac-acesso']).toBe('refused')
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
