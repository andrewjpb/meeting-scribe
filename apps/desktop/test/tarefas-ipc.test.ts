// Contrato 122 (tarefas, CA8 e CA9): os 8 canais `scribe:tarefas-*` sobre o serviço real numa pasta temporária, com
// um `ipcMain` falso, como em `lock-ipc.test.ts`. Pedido fora do formato devolve `invalido` sem tocar no store (CA8,
// R37); exceção vira `falhou`; todos recusados com o app bloqueado (CA9, R36).
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'
import { TAREFAS_ERRO_TEXTO, TAREFAS_FALHOU_TEXTO, TAREFAS_FILE, TAREFAS_LEITURA_FALHOU_TEXTO, type TarefasView } from '../src/shared/tarefas'

const invokeHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: () => undefined,
  },
}))

const { createTarefasStore } = await import('../src/main/tarefas/store')
const { createTarefasService } = await import('../src/main/tarefas/service')
const { parseTarefasPedido, registerTarefasIpc } = await import('../src/main/tarefas/ipc')

const ORIGIN = 'scribe://app'
const trusted = { senderFrame: { url: `${ORIGIN}/index.html` } }

const CANAIS_TAREFAS = [
  'scribe:tarefas-get',
  'scribe:tarefas-criar',
  'scribe:tarefas-salvar',
  'scribe:tarefas-status',
  'scribe:tarefas-apagar',
  'scribe:tarefas-sugestoes',
  'scribe:tarefas-ignorar',
  'scribe:tarefas-adicionar-do-resumo',
]

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tarefas-ipc-'))
  dirs.push(dir)
  const store = createTarefasStore({ dir })
  const views: TarefasView[] = []
  const service = createTarefasService({
    store,
    funil: { state: () => Promise.reject(new Error('sem funil')) },
    meetings: { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
    summaries: { get: () => Promise.resolve(null) },
    analyses: { list: () => Promise.resolve([]) },
    insights: { read: () => Promise.resolve({}) },
    whatsapp: { chats: () => Promise.resolve([]) },
    settings: () => Promise.resolve({ tarefas: DEFAULT_SETTINGS.tarefas }),
    timeZone: () => 'America/Sao_Paulo',
    notify: () => undefined,
    onChange: (view) => void views.push(view),
  })
  return { dir, store, service, views, file: join(dir, TAREFAS_FILE) }
}

function canal(nome: string): (event: unknown, ...args: unknown[]) => unknown {
  const handler = invokeHandlers.get(nome)
  if (!handler) throw new Error(`canal não registrado: ${nome}`)
  return handler
}

const INVALIDO = { ok: false, erro: 'invalido', mensagem: TAREFAS_ERRO_TEXTO.invalido }

describe('canais das tarefas', () => {
  it('CA9: os 8 canais existem e são recusados com o app bloqueado', () => {
    const tarefas = INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:tarefas-'))
    expect([...tarefas].sort()).toEqual([...CANAIS_TAREFAS].sort())
    for (const channel of CANAIS_TAREFAS) expect(WHEN_LOCKED[channel as keyof typeof WHEN_LOCKED]).toBe('refused')
  })

  it('CA8: campo a mais, estado e índices fora do formato devolvem invalido e o store não muda', async () => {
    const ctx = setup()
    invokeHandlers.clear()
    registerTarefasIpc({ appOrigin: ORIGIN, tarefas: ctx.service })
    expect([...invokeHandlers.keys()].sort()).toEqual([...CANAIS_TAREFAS].sort())

    const criar = canal('scribe:tarefas-criar')
    expect(await criar(trusted, { titulo: 'Ligar', origem: { tipo: 'manual' }, extra: true })).toEqual(INVALIDO)
    expect(await criar(trusted, { titulo: 'Ligar', origem: { tipo: 'manual' }, vinculos: { email: null, pasta: 'x' } })).toEqual(INVALIDO)
    expect(await criar(trusted, { titulo: 'Ligar', origem: { tipo: 'manual' }, prazo: '2026-02-30' })).toEqual(INVALIDO)
    expect(existsSync(ctx.file)).toBe(false)
    expect(ctx.views).toHaveLength(0)

    const criada = await criar(trusted, { titulo: 'Ligar', origem: { tipo: 'manual' }, prazo: '2026-11-25' })
    expect(criada).toMatchObject({ ok: true })
    const id = (criada as { id: string }).id
    const antes = await ctx.store.read()

    expect(await canal('scribe:tarefas-status')(trusted, { id, status: 'arquivada' })).toEqual(INVALIDO)
    expect(await canal('scribe:tarefas-salvar')(trusted, { id, email: null })).toEqual(INVALIDO)
    expect(await canal('scribe:tarefas-apagar')(trusted, { id, motivo: 'x' })).toEqual(INVALIDO)
    expect(await canal('scribe:tarefas-ignorar')(trusted, {})).toEqual(INVALIDO)
    expect(await canal('scribe:tarefas-adicionar-do-resumo')(trusted, { meetingId: 'm1', indices: 'todas' })).toEqual(INVALIDO)
    expect(await ctx.store.read()).toEqual(antes)

    expect(await canal('scribe:tarefas-status')(trusted, { id, status: 'feita' })).toEqual({ ok: true, id })
    expect(await canal('scribe:tarefas-get')(trusted)).toMatchObject({ tarefas: [{ id, status: 'feita' }], hoje: expect.any(String) })
  })

  it('exceção ao gravar vira falhou; leituras com exceção respondem tipado', async () => {
    const ctx = setup()
    const logs: string[] = []
    invokeHandlers.clear()
    registerTarefasIpc({
      appOrigin: ORIGIN,
      tarefas: { ...ctx.service, criar: () => Promise.reject(new Error('disco cheio')), view: () => Promise.reject(new Error('quebrou')), sugestoes: () => Promise.reject(new Error('quebrou')) },
      log: (message) => void logs.push(message),
    })
    expect(await canal('scribe:tarefas-criar')(trusted, { titulo: 'Ligar', origem: { tipo: 'manual' } })).toEqual({ ok: false, erro: 'falhou', mensagem: TAREFAS_FALHOU_TEXTO })
    expect(await canal('scribe:tarefas-get')(trusted)).toEqual({ ok: false, erro: 'falhou', mensagem: TAREFAS_LEITURA_FALHOU_TEXTO })
    expect(await canal('scribe:tarefas-sugestoes')(trusted)).toEqual([])
    expect(logs).toHaveLength(3)
  })

  it('os parsers aceitam o formato dos canais', () => {
    expect(parseTarefasPedido('scribe:tarefas-criar', { titulo: 'Ligar', origem: { tipo: 'reuniao', meetingId: 'm1', texto: 'Ligar' }, lembrete: 'padrao', vinculos: { oportunidadeId: 'op1', contatoIds: ['c1'] } })).not.toBeNull()
    expect(parseTarefasPedido('scribe:tarefas-salvar', { id: 't1', prazo: null, lembrete: 1_764_000_000_000, vinculos: { meetingId: null } })).not.toBeNull()
    expect(parseTarefasPedido('scribe:tarefas-adicionar-do-resumo', { meetingId: 'm1', indices: [0, 2] })).not.toBeNull()
    expect(parseTarefasPedido('scribe:tarefas-adicionar-do-resumo', { meetingId: 'm1', indices: [-1] })).toBeNull()
    expect(parseTarefasPedido('scribe:tarefas-status', { id: 't1', status: 'cancelada' })).toEqual({ id: 't1', status: 'cancelada' })
  })
})
