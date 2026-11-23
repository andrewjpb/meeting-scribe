// Contrato 138 (whatsapp-agentes, CA1 a CA15): o store de `whatsapp/atendimento.json` e o histórico em
// `whatsapp/atendimento-log.jsonl`. Estado vazio sem exemplos, nome único, grupo recusado, aceite do risco antes do
// automático, um atendimento por conversa, exclusão do agente desliga os atendimentos, pausa geral, `pausedUntil`,
// teto do histórico, quarentena do arquivo ruim e os oito canais recusados com o app bloqueado.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAtendimentoLog } from '../src/main/whatsapp/atendimento/log'
import { createAtendimentoStore } from '../src/main/whatsapp/atendimento/store'
import { ATENDIMENTO_LOG_MAX, type AtendimentoAgentSaveResult, type AtendimentoBindingSaveResult, type AtendimentoLogEntry, type AtendimentoResult } from '../src/shared/atendimento'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'

const NOW = Date.parse('2026-11-23T15:00:00.000Z')
const CHAT = '5511999990000@s.whatsapp.net'
const OUTRO = '5511888880000@s.whatsapp.net'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(dir = mkdtempSync(join(tmpdir(), 'atendimento-store-'))) {
  if (!dirs.includes(dir)) dirs.push(dir)
  let seq = 0
  const logs: string[] = []
  const store = createAtendimentoStore({ dir, now: () => NOW, newId: () => `id-${++seq}`, log: (message) => void logs.push(message) })
  return { dir, file: join(dir, 'atendimento.json'), store, logs }
}

const agente = (name = 'Recados', extra: Record<string, unknown> = {}) => ({ id: null, name, instructions: 'Anote o recado e diga que retorno depois.', tone: 'cordial', never: 'preço', model: 'haiku', ...extra })

function agentOk(result: AtendimentoAgentSaveResult) {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.error}`)
  return result
}
function bindingOk(result: AtendimentoBindingSaveResult) {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.error}`)
  return result
}
function ok(result: AtendimentoResult) {
  if (!result.ok) throw new Error(`esperava ok, veio ${result.error}`)
  return result
}

describe('store do atendimento', () => {
  it('CA1: diretório vazio vale o estado vazio, sem agente de exemplo e sem gravar', async () => {
    const { store, file } = setup()
    expect(await store.state()).toEqual({ agents: [], bindings: [], pausedAll: false, riskAcceptedAt: null })
    expect(existsSync(file)).toBe(false)
  })

  it('CA2: o agente salvo volta igual num store novo e o arquivo é 0600', async () => {
    const { store, dir, file } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    expect(agent).toEqual({ id: 'id-1', name: 'Recados', instructions: 'Anote o recado e diga que retorno depois.', tone: 'cordial', never: 'preço', model: 'haiku', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() })
    const again = setup(dir)
    expect((await again.store.state()).agents).toEqual([agent])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, pausedAll: false, riskAcceptedAt: null })
  })

  it('CA3: nome igual com outra caixa é recusado e nada é gravado', async () => {
    const { store, file } = setup()
    agentOk(await store.saveAgent(agente('Recados')))
    const before = readFileSync(file, 'utf8')
    expect(await store.saveAgent(agente('recados'))).toEqual({ ok: false, error: 'name-taken' })
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect((await store.state()).agents).toHaveLength(1)
  })

  it('CA4: conversa de grupo é recusada', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    expect(await store.saveBinding({ chatId: '120363000000000000@g.us', agentId: agent.id })).toEqual({ ok: false, error: 'group-not-allowed' })
    expect((await store.state()).bindings).toEqual([])
  })

  it('CA5: agente inexistente é recusado', async () => {
    const { store } = setup()
    expect(await store.saveBinding({ chatId: CHAT, agentId: 'nao-existe' })).toEqual({ ok: false, error: 'agent-not-found' })
  })

  it('CA6: automático ligado sem aceite do risco é recusado sem gravar; depois do aceite grava', async () => {
    const { store, file } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    const before = readFileSync(file, 'utf8')
    const pedido = { chatId: CHAT, agentId: agent.id, mode: 'auto', enabled: true }
    expect(await store.saveBinding(pedido)).toEqual({ ok: false, error: 'risk-required' })
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(ok(await store.acceptRisk()).state.riskAcceptedAt).toBe(new Date(NOW).toISOString())
    const { binding } = bindingOk(await store.saveBinding(pedido))
    expect(binding).toMatchObject({ chatId: CHAT, mode: 'auto', enabled: true })
  })

  it('CA7: rascunho grava sem aceite do risco, com os padrões de um atendimento novo', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    const { binding, state } = bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id, mode: 'draft' }))
    expect(state.riskAcceptedAt).toBeNull()
    expect(binding).toEqual({
      chatId: CHAT,
      agentId: agent.id,
      enabled: true,
      mode: 'draft',
      delayMinMinutes: 2,
      delayMaxMinutes: 5,
      typing: true,
      identify: false,
      about: '',
      hours: null,
      maxPerHour: 6,
      pauseOnMyReplyMinutes: 60,
      pausedUntil: null,
      updatedAt: new Date(NOW).toISOString(),
    })
  })

  it('CA8: atraso máximo menor que o mínimo, ou campo fora dos limites, é inválido', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    const base = { chatId: CHAT, agentId: agent.id }
    const invalidos: Record<string, unknown>[] = [
      { delayMinMinutes: 10, delayMaxMinutes: 5 },
      { delayMinMinutes: -1 },
      { delayMaxMinutes: 121 },
      { maxPerHour: 0 },
      { maxPerHour: 31 },
      { pauseOnMyReplyMinutes: 1441 },
      { about: 'x'.repeat(1001) },
      { hours: { days: [7], start: '08:00', end: '18:00' } },
      { hours: { days: [1], start: '8:00', end: '18:00' } },
      { mode: 'sozinho' },
      { extra: true },
    ]
    for (const campo of invalidos) expect(await store.saveBinding({ ...base, ...campo })).toEqual({ ok: false, error: 'invalid' })
    for (const campo of [{ name: '' }, { name: 'x'.repeat(61) }, { instructions: 'x'.repeat(8001) }, { tone: 'x'.repeat(501) }, { never: 'x'.repeat(2001) }, { model: 'opus' }]) {
      expect(await store.saveAgent(agente('Outro', campo))).toEqual({ ok: false, error: 'invalid' })
    }
    expect((await store.state()).bindings).toEqual([])
  })

  it('CA9: um atendimento por conversa: salvar de novo substitui', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id, maxPerHour: 3 }))
    const { state } = bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id, maxPerHour: 10, hours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' } }))
    expect(state.bindings).toHaveLength(1)
    expect(state.bindings[0]).toMatchObject({ maxPerHour: 10, hours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' } })
  })

  it('CA10: excluir o agente desliga os atendimentos dele sem apagá-los', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    const { agent: outro } = agentOk(await store.saveAgent(agente('Vendas')))
    bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id }))
    bindingOk(await store.saveBinding({ chatId: OUTRO, agentId: agent.id }))
    bindingOk(await store.saveBinding({ chatId: '5511777770000@s.whatsapp.net', agentId: outro.id }))
    const { state } = ok(await store.deleteAgent({ id: agent.id }))
    expect(state.agents.map((item) => item.id)).toEqual([outro.id])
    expect(state.bindings.filter((item) => item.agentId === agent.id).map((item) => item.enabled)).toEqual([false, false])
    expect(state.bindings.find((item) => item.agentId === outro.id)?.enabled).toBe(true)
    expect(await store.deleteAgent({ id: agent.id })).toEqual({ ok: false, error: 'not-found' })
  })

  it('CA11: pausar todos grava e retomar volta', async () => {
    const { store, dir } = setup()
    expect(ok(await store.pauseAll({ paused: true })).state.pausedAll).toBe(true)
    expect((await setup(dir).store.state()).pausedAll).toBe(true)
    expect(ok(await store.pauseAll({ paused: false })).state.pausedAll).toBe(false)
  })

  it('CA12: setPausedUntil grava só esse campo', async () => {
    const { store } = setup()
    const { agent } = agentOk(await store.saveAgent(agente()))
    const { binding } = bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id }))
    const ate = '2026-11-23T16:00:00.000Z'
    expect(await store.setPausedUntil(CHAT, ate)).toBe(true)
    expect((await store.state()).bindings[0]).toEqual({ ...binding, pausedUntil: ate })
    // Salvar o painel de novo não desfaz a pausa.
    expect(bindingOk(await store.saveBinding({ chatId: CHAT, agentId: agent.id, typing: false })).binding.pausedUntil).toBe(ate)
    expect(await store.setPausedUntil(CHAT, null)).toBe(true)
    expect((await store.state()).bindings[0]?.pausedUntil).toBeNull()
    expect(await store.setPausedUntil(OUTRO, ate)).toBe(false)
  })

  it('CA14: arquivo corrompido: estado vazio e o arquivo ruim guardado com outro nome', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-store-'))
    writeFileSync(join(dir, 'atendimento.json'), '{quebrado')
    const { store, logs } = setup(dir)
    expect(await store.state()).toEqual({ agents: [], bindings: [], pausedAll: false, riskAcceptedAt: null })
    const corrupt = readdirSync(dir).filter((name) => name.startsWith('atendimento.json.corrupt-'))
    expect(corrupt).toHaveLength(1)
    expect(readFileSync(join(dir, corrupt[0] ?? ''), 'utf8')).toBe('{quebrado')
    expect(logs.some((line) => line.includes('inválido'))).toBe(true)
  })

  it('nenhum log leva instruções, "nunca diga" ou "quem é"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-store-'))
    writeFileSync(join(dir, 'atendimento.json'), JSON.stringify({ version: 1, agents: [{ id: 'a', name: 'X', instructions: 'SEGREDO-INSTRUCOES', tone: '', never: 'SEGREDO-NUNCA', model: 'haiku' }], bindings: [], pausedAll: false, riskAcceptedAt: null }))
    const { store, logs } = setup(dir)
    await store.state()
    expect(logs.join('\n')).not.toMatch(/SEGREDO/)
  })
})

describe('histórico do atendimento', () => {
  const evento = (index: number, chatId = CHAT): AtendimentoLogEntry => ({ at: new Date(NOW + index * 1000).toISOString(), chatId, agentId: 'id-1', action: 'sent', messageId: `m-${index}` })

  it('CA13: uma linha por evento; com 5.001 a leitura devolve os 5.000 mais recentes e compacta; a lista vem do mais recente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-log-'))
    dirs.push(dir)
    const log = createAtendimentoLog({ dir })
    const file = join(dir, 'atendimento-log.jsonl')
    expect(await log.append(evento(0))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(evento(0))}\n`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    for (let index = 1; index <= ATENDIMENTO_LOG_MAX; index += 1) await log.append(evento(index, index % 2 === 0 ? CHAT : OUTRO))
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(ATENDIMENTO_LOG_MAX + 1)

    const lidos = await log.read()
    expect(lidos).toHaveLength(ATENDIMENTO_LOG_MAX)
    expect(lidos[0]?.messageId).toBe('m-1')
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(ATENDIMENTO_LOG_MAX)
    expect((await readdir(dir)).filter((name) => name.includes('.tmp-'))).toEqual([])

    const padrao = await log.list(undefined)
    if (!padrao.ok) throw new Error(padrao.error)
    expect(padrao.entries).toHaveLength(200)
    expect(padrao.entries[0]?.messageId).toBe(`m-${ATENDIMENTO_LOG_MAX}`)
    expect(padrao.entries[1]?.messageId).toBe(`m-${ATENDIMENTO_LOG_MAX - 1}`)

    const maximo = await log.list({ limit: 1000 })
    expect(maximo.ok && maximo.entries.length).toBe(1000)
    expect(await log.list({ limit: 1001 })).toEqual({ ok: false, error: 'invalid' })

    const filtrado = await log.list({ chatId: OUTRO, limit: 3 })
    if (!filtrado.ok) throw new Error(filtrado.error)
    expect(filtrado.entries.map((entry) => entry.messageId)).toEqual([`m-${ATENDIMENTO_LOG_MAX - 1}`, `m-${ATENDIMENTO_LOG_MAX - 3}`, `m-${ATENDIMENTO_LOG_MAX - 5}`])
    expect(filtrado.entries.every((entry) => entry.chatId === OUTRO)).toBe(true)
  })

  it('entrada fora do esquema não é gravada e linha ruim no arquivo é ignorada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atendimento-log-'))
    dirs.push(dir)
    const log = createAtendimentoLog({ dir })
    expect(await log.append({ ...evento(1), reason: 'x'.repeat(201) })).toBe(false)
    expect(await log.append({ ...evento(1), action: 'replied' } as unknown as AtendimentoLogEntry)).toBe(false)
    writeFileSync(join(dir, 'atendimento-log.jsonl'), `não é json\n${JSON.stringify(evento(2))}\n`)
    expect(await createAtendimentoLog({ dir }).read()).toEqual([evento(2)])
  })
})

describe('canais do atendimento', () => {
  const CANAIS = [
    'scribe:atendimento-state',
    'scribe:atendimento-agent-save',
    'scribe:atendimento-agent-delete',
    'scribe:atendimento-binding-save',
    'scribe:atendimento-binding-delete',
    'scribe:atendimento-pause-all',
    'scribe:atendimento-risk-accept',
    'scribe:atendimento-log-list',
  ] as const

  it('CA15: os oito canais existem e são recusados com o app bloqueado', () => {
    for (const channel of CANAIS) {
      expect(INVOKE_CHANNELS).toContain(channel)
      expect(WHEN_LOCKED[channel]).toBe('refused')
    }
    // Contrato 141: mais os quatro do serviço (runtime, testar agente, enviar e descartar a proposta).
    expect(INVOKE_CHANNELS.filter((channel) => channel.startsWith('scribe:atendimento-'))).toHaveLength(CANAIS.length + 4)
  })

  it('CA15: pedido fora do formato devolve invalid sem lançar', async () => {
    const { store } = setup()
    const logDir = mkdtempSync(join(tmpdir(), 'atendimento-log-'))
    dirs.push(logDir)
    const log = createAtendimentoLog({ dir: logDir })
    for (const lixo of [undefined, null, 42, 'texto', [], {}]) {
      await expect(store.saveAgent(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
      await expect(store.deleteAgent(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
      await expect(store.saveBinding(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
      await expect(store.deleteBinding(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
      await expect(store.pauseAll(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
    }
    for (const lixo of [null, 42, 'texto', { limit: 0 }, { limit: 1.5 }, { chatId: 'sem-arroba' }, { outro: 1 }]) {
      await expect(log.list(lixo)).resolves.toEqual({ ok: false, error: 'invalid' })
    }
    expect(await store.state()).toEqual({ agents: [], bindings: [], pausedAll: false, riskAcceptedAt: null })
  })

  it('Automações e bandeja não importam o atendimento', () => {
    const root = join(__dirname, '../src/main')
    for (const pasta of ['agents', 'schedules', 'tray']) {
      const base = join(root, pasta)
      if (!existsSync(base)) continue
      for (const nome of readdirSync(base, { recursive: true }) as string[]) {
        if (!nome.endsWith('.ts')) continue
        expect(readFileSync(join(base, nome), 'utf8'), `${pasta}/${nome}`).not.toMatch(/whatsapp\/atendimento/)
      }
    }
  })
})
