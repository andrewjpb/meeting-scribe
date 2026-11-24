// Contrato 161 (notificacoes-triagem, CA3 a CA6, CA9 e CA11): o motor da triagem com relógio, temporizador, modelo,
// WhatsApp, funil e automações falsos (as etiquetas em memória). A espera desde a última mensagem, a resposta do dono, o
// limite de idade, o interruptor, os grupos, a escolha do dono que prevalece, o teto do dia, a fila de 2, o app
// bloqueado, os canais e a prova estática de que a triagem não envia nada.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TriagemInput, TriagemOutcome } from '../src/main/whatsapp/triagem/classify'
import { createTriagemService } from '../src/main/whatsapp/triagem/service'
import type { Agent, AutomationRun, ScheduledTask } from '../src/shared/automations'
import { TRIAGEM_TEMPLATE } from '../src/shared/automations'
import type { Contato } from '../src/shared/funil'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import { aplicarManual, etiquetaVazia, TRIAGEM_TETO_ERRO, type Etiqueta, type TriagemStatus } from '../src/shared/triagem'
import type { WhatsAppMessage } from '../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const BETO = '5511922220000@s.whatsapp.net'
const CAIO = '5511933330000@s.whatsapp.net'
const GRUPO = '120363000000000001@g.us'
const SEC = 1000
const MINUTE = 60_000
const START = new Date(2026, 10, 23, 10, 0).getTime()
const TEXTO = 'Oi, preciso do orçamento hoje'
const NOMES: Record<string, string> = { [ANA]: 'Ana', [BETO]: 'Beto', [CAIO]: 'Caio', [GRUPO]: 'Grupo' }

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise<void>((done) => setImmediate(done))
}

const agente: Agent = { ...TRIAGEM_TEMPLATE, id: 'ag-triagem', createdAt: new Date(START).toISOString(), updatedAt: new Date(START).toISOString() }

const tarefa = (extra: Partial<ScheduledTask> = {}, grupos = false): ScheduledTask => ({
  id: 'tk-triagem',
  name: 'Triagem do WhatsApp',
  agentId: agente.id,
  message: 'Classificar',
  schedule: { kind: 'whatsapp-message', esperaSeg: 30, grupos },
  timezone: 'America/Sao_Paulo',
  enabled: true,
  runOnce: false,
  runOnceAction: 'disable',
  timeoutS: 30,
  notify: 'never',
  output: null,
  lastRunAt: null,
  nextRunAt: null,
  lastStatus: null,
  lastResultPreview: null,
  lastError: null,
  consecutiveFailures: 0,
  autoPaused: false,
  reminder: null,
  email: null,
  createdAt: new Date(START).toISOString(),
  updatedAt: new Date(START).toISOString(),
  ...extra,
})

interface Options {
  enabled?: boolean
  motivo?: 'sem-agente' | 'pausado' | null
  grupos?: boolean
  locked?: boolean
  hoje?: number
  etiquetas?: Record<string, Etiqueta>
  outcome?: TriagemOutcome | ((input: TriagemInput) => TriagemOutcome | Promise<TriagemOutcome>)
  contatos?: Contato[]
}

function harness(options: Options = {}) {
  let clock = START
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const etiquetas = new Map<string, Etiqueta>(Object.entries(options.etiquetas ?? {}))
  const sets: { chatId: string; etiqueta: Etiqueta }[] = []
  const changed: { chatId: string; etiqueta: Etiqueta | null }[] = []
  const statuses: TriagemStatus[] = []
  const dones: { chatId: string; ok: boolean }[] = []
  const runs: AutomationRun[] = []
  const calls: TriagemInput[] = []
  const logs: string[] = []
  const messages = new Map<string, WhatsAppMessage[]>()
  const hojeLidos: number[] = []
  const state = { timeZone: 'America/Sao_Paulo', enabled: options.enabled ?? true, motivo: options.motivo === undefined ? null : options.motivo, grupos: options.grupos ?? false, locked: options.locked ?? false }
  const situacao = () => (state.motivo === 'sem-agente' ? { task: null, agent: null, motivo: 'sem-agente' as const } : { task: tarefa({}, state.grupos), agent: agente, motivo: state.motivo })
  const service = createTriagemService({
    store: {
      list: async () => Object.fromEntries(etiquetas),
      get: async (chatId) => etiquetas.get(chatId) ?? null,
      set: async (chatId, etiqueta) => {
        sets.push({ chatId, etiqueta })
        etiquetas.set(chatId, etiqueta)
        return true
      },
    },
    enabled: async () => state.enabled,
    automations: {
      triagemSituacao: async () => situacao(),
      triagemAtiva: async () => {
        const atual = situacao()
        return atual.motivo === null && atual.task && atual.agent ? { task: atual.task, agent: atual.agent } : null
      },
      salvarExecucaoExterna: async (run) => void runs.push(run),
      criarTriagemDoModelo: async () => ({ ok: true, agentId: agente.id, taskId: 'tk-triagem' }),
    },
    whatsapp: {
      lastMessages: async (chatId, n) => (messages.get(chatId) ?? []).slice(-n),
      chat: async (chatId) => ({ id: chatId, name: NOMES[chatId] ?? chatId, kind: chatId.endsWith('@g.us') ? 'group' : 'person', unread: 1, lastMessage: null }),
      ownerName: () => 'Andrew',
    },
    funil: { contatos: async () => options.contatos ?? [], empresaNome: async (id) => (id === 'emp-1' ? 'Empresa X' : null) },
    classify: async (input) => {
      calls.push(input)
      const outcome = options.outcome ?? { ok: true, resultado: { urgente: true, ambito: 'profissional', motivo: 'pede orçamento hoje' }, costUsd: 0.001, durationMs: 800 }
      return typeof outcome === 'function' ? outcome(input) : outcome
    },
    changed: (chatId, etiqueta) => void changed.push({ chatId, etiqueta }),
    statusChanged: (status) => void statuses.push(status),
    done: (chatId, ok) => void dones.push({ chatId, ok }),
    locked: () => state.locked,
    runs: {
      hojeTrigger: async () => {
        hojeLidos.push(clock)
        return options.hoje ?? 0
      },
    },
    timeZone: () => state.timeZone,
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = ++seq
      timers.set(id, { at: clock + ms, fn })
      return id
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    newId: () => `run-${++seq}`,
    log: (message) => void logs.push(message),
  })
  const mensagem = (chatId: string, id: string, extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({ id, chatId, author: NOMES[chatId] ?? 'Contato', fromMe: false, at: clock, type: 'text', text: TEXTO, media: null, ...extra })
  return {
    service,
    state,
    timers,
    etiquetas,
    sets,
    changed,
    statuses,
    dones,
    runs,
    calls,
    logs,
    hojeLidos,
    mensagem,
    setClock: (at: number) => void (clock = at),
    clock: () => clock,
    /** Chega uma mensagem: entra no histórico da conversa e passa pelo motor. */
    async receive(message: WhatsAppMessage) {
      messages.set(message.chatId, [...(messages.get(message.chatId) ?? []), message])
      await service.onMessage(message, NOMES[message.chatId] ?? '')
      await flush()
    },
    async advance(ms: number) {
      const target = clock + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        clock = due[1].at
        due[1].fn()
        await flush()
      }
      clock = target
      await flush()
    },
  }
}

describe('motor da triagem (contrato 161)', () => {
  it('CA3: três mensagens em 20 s, espera de 30 s: uma chamada só, aos 50 s, com a etiqueta e a execução sem texto', async () => {
    const h = harness()
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(10 * SEC)
    await h.receive(h.mensagem(ANA, 'm2'))
    await h.advance(10 * SEC)
    await h.receive(h.mensagem(ANA, 'm3'))
    await h.advance(29 * SEC)
    expect(h.calls).toHaveLength(0)
    await h.advance(1 * SEC)
    expect(h.calls).toHaveLength(1)
    expect(h.clock() - START).toBe(50 * SEC)
    expect(h.calls[0]?.messages.map((message) => message.text)).toEqual([TEXTO, TEXTO, TEXTO])
    expect(h.calls[0]).toMatchObject({ instructions: agente.instructions, model: 'haiku', chatName: 'Ana', kind: 'person', ownerName: 'Andrew', funil: { contato: false, empresa: null } })
    expect(h.sets).toHaveLength(1)
    expect(h.sets[0]?.etiqueta).toMatchObject({ urgente: true, ambito: 'profissional', origem: 'agente', lastMessageId: 'm3' })
    expect(h.changed).toEqual([{ chatId: ANA, etiqueta: h.sets[0]?.etiqueta }])
    expect(h.runs).toHaveLength(1)
    const run = h.runs[0]
    expect(run).toMatchObject({ status: 'ok', trigger: 'whatsapp', taskId: 'tk-triagem', agentId: agente.id, agentName: agente.name, model: 'haiku', costUsd: 0.001, meetingId: null, outputResult: null })
    expect(run?.prompt).toBe('Triagem da conversa Ana · 3 mensagens novas')
    expect(run?.prompt).not.toContain(TEXTO)
    expect(run?.answer).toMatchObject({ role: 'assistant', text: 'Etiqueta: Urgente · Profissional. Motivo: pede orçamento hoje' })
    // Nada do texto, do nome ou do motivo no log.
    expect(h.logs.join('\n')).not.toMatch(/orçamento|Ana|pede/)
    expect(h.logs.some((line) => line.includes(ANA.slice(0, 8)) && !line.includes(ANA))).toBe(true)
  })

  it('CA3: a mesma última mensagem não é triada de novo; a contagem de novas é desde a última considerada', async () => {
    const h = harness()
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    expect(h.calls).toHaveLength(1)
    await h.receive(h.mensagem(ANA, 'm2'))
    await h.advance(30 * SEC)
    expect(h.calls).toHaveLength(2)
    expect(h.runs.map((run) => run.prompt)).toEqual(['Triagem da conversa Ana · 1 mensagem nova', 'Triagem da conversa Ana · 1 mensagem nova'])
  })

  it('CA4: resposta do dono numa conversa urgente tira o urgente sem chamar o modelo', async () => {
    const urgente: Etiqueta = { ...etiquetaVazia(START), urgente: true, ambito: 'pessoal', origem: 'agente', lastMessageId: 'm0' }
    const h = harness({ etiquetas: { [ANA]: urgente } })
    await h.receive(h.mensagem(ANA, 'm1', { fromMe: true, author: 'Andrew' }))
    await h.advance(MINUTE)
    expect(h.calls).toHaveLength(0)
    expect(h.etiquetas.get(ANA)).toMatchObject({ urgente: false, urgenteFixo: false, ambito: 'pessoal' })
    expect(h.changed).toHaveLength(1)
    expect(h.changed[0]?.etiqueta?.urgente).toBe(false)
    expect(h.timers.size).toBe(0)
  })

  it('CA4: mensagem velha, interruptor desligado, sem agente ativo ou grupo sem "grupos": nada, nem temporizador', async () => {
    const velha = harness()
    await velha.receive(velha.mensagem(ANA, 'm1', { at: START - 6 * MINUTE }))
    expect(velha.timers.size).toBe(0)
    const desligado = harness({ enabled: false })
    await desligado.receive(desligado.mensagem(ANA, 'm1'))
    expect(desligado.timers.size).toBe(0)
    const semAgente = harness({ motivo: 'sem-agente' })
    await semAgente.receive(semAgente.mensagem(ANA, 'm1'))
    expect(semAgente.timers.size).toBe(0)
    const pausado = harness({ motivo: 'pausado' })
    await pausado.receive(pausado.mensagem(ANA, 'm1'))
    expect(pausado.timers.size).toBe(0)
    const grupo = harness()
    await grupo.receive(grupo.mensagem(GRUPO, 'g1'))
    expect(grupo.timers.size).toBe(0)
    for (const h of [velha, desligado, semAgente, pausado, grupo]) {
      await h.advance(5 * MINUTE)
      expect(h.calls).toHaveLength(0)
      expect(h.runs).toHaveLength(0)
    }
    const comGrupos = harness({ grupos: true })
    await comGrupos.receive(comGrupos.mensagem(GRUPO, 'g1'))
    await comGrupos.advance(30 * SEC)
    expect(comGrupos.calls).toHaveLength(1)
    expect(comGrupos.calls[0]?.kind).toBe('group')
  })

  it('CA5: o âmbito fixado pelo dono prevalece; o urgente vem do resultado', async () => {
    const h = harness({ etiquetas: { [ANA]: aplicarManual(null, { ambito: 'pessoal' }, START - MINUTE) } })
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    expect(h.etiquetas.get(ANA)).toMatchObject({ ambito: 'pessoal', ambitoFixo: true, urgente: true, origem: 'agente', lastMessageId: 'm1' })
  })

  it('CA5: resultado inválido grava execução com erro e não mexe na etiqueta', async () => {
    const h = harness({ outcome: { ok: false, error: 'format' } })
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    expect(h.calls).toHaveLength(1)
    expect(h.sets).toEqual([])
    expect(h.changed).toEqual([])
    expect(h.runs).toHaveLength(1)
    expect(h.runs[0]).toMatchObject({ status: 'error', error: 'A resposta do Claude veio fora do formato.', trigger: 'whatsapp' })
  })

  it('o funil: contato ligado pelo telefone da conversa leva "sim" e a empresa', async () => {
    const contato = { id: 'ct-1', nome: 'Ana', emails: [], telefones: ['+5511911110000'], empresaId: 'emp-1', whatsappChatId: null, arquivado: false } as unknown as Contato
    const h = harness({ contatos: [contato] })
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    expect(h.calls[0]?.funil).toEqual({ contato: true, empresa: 'Empresa X' })
  })

  it('CA6: no teto do dia, nada chama o modelo e só uma execução registra o teto', async () => {
    const h = harness({ hoje: 300 })
    for (const [i, chatId] of [ANA, BETO, CAIO, '5511944440000@s.whatsapp.net', '5511955550000@s.whatsapp.net'].entries()) await h.receive(h.mensagem(chatId, `m${i}`))
    await h.advance(30 * SEC)
    await h.advance(MINUTE)
    expect(h.calls).toHaveLength(0)
    expect(h.runs).toHaveLength(1)
    expect(h.runs[0]).toMatchObject({ status: 'error', error: TRIAGEM_TETO_ERRO, trigger: 'whatsapp' })
    expect((await h.service.status()).hoje).toBe(300)
    expect(await h.service.runNow(ANA)).toEqual({ ok: false, error: 'teto' })
  })

  it('CA6: três conversas ao mesmo tempo, no máximo duas triagens; a terceira espera uma terminar', async () => {
    const pendentes: ((outcome: TriagemOutcome) => void)[] = []
    const h = harness({ outcome: () => new Promise<TriagemOutcome>((done) => void pendentes.push(done)) })
    await h.receive(h.mensagem(ANA, 'a1'))
    await h.receive(h.mensagem(BETO, 'b1'))
    await h.receive(h.mensagem(CAIO, 'c1'))
    await h.advance(30 * SEC)
    expect(h.calls.map((call) => call.chatName)).toEqual(['Ana', 'Beto'])
    expect((await h.service.status()).hoje).toBe(2)
    pendentes.shift()?.({ ok: true, resultado: { urgente: false, ambito: 'pessoal', motivo: '' }, costUsd: 0, durationMs: 1 })
    await h.advance(0)
    expect(h.calls.map((call) => call.chatName)).toEqual(['Ana', 'Beto', 'Caio'])
    for (const done of pendentes.splice(0)) done({ ok: false, error: 'timeout' })
    await h.advance(0)
    expect(h.runs.map((run) => run.status).sort()).toEqual(['ok', 'timeout', 'timeout'])
    expect((await h.service.status()).hoje).toBe(3)
  })

  it('o dia do contador vem do fuso das Automações (o mesmo do hojeTrigger), não do fuso do sistema', async () => {
    const h = harness()
    // 12:00 UTC de 23/11: já é dia 24 em Kiritimati (UTC+14) e ainda é 23 em Pago Pago (UTC-11), em qualquer fuso do sistema.
    h.setClock(Date.parse('2026-11-23T12:00:00Z'))
    h.state.timeZone = 'Pacific/Kiritimati'
    await h.service.status()
    await h.service.status()
    expect(h.hojeLidos).toHaveLength(1)
    h.state.timeZone = 'Pacific/Pago_Pago'
    await h.service.status()
    expect(h.hojeLidos).toHaveLength(2)
    // Mesmo instante, mesmo fuso: o mesmo dia, sem reler.
    await h.service.status()
    expect(h.hojeLidos).toHaveLength(2)
  })

  it('"Triar agora": sem espera; recusado desligado, sem agente, pausado, sem mensagens e com a conversa na fila', async () => {
    const pendentes: ((outcome: TriagemOutcome) => void)[] = []
    const h = harness({ outcome: () => new Promise<TriagemOutcome>((done) => void pendentes.push(done)) })
    expect(await h.service.runNow(ANA)).toEqual({ ok: false, error: 'sem-mensagens' })
    await h.receive(h.mensagem(ANA, 'a1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(ANA)).toEqual({ ok: true })
    await h.advance(0)
    expect(h.calls).toHaveLength(1)
    expect(await h.service.runNow(ANA)).toEqual({ ok: false, error: 'ocupado' })
    h.state.motivo = 'pausado'
    expect(await h.service.runNow(BETO)).toEqual({ ok: false, error: 'pausado' })
    h.state.motivo = 'sem-agente'
    expect(await h.service.runNow(BETO)).toEqual({ ok: false, error: 'sem-agente' })
    h.state.enabled = false
    expect(await h.service.runNow(BETO)).toEqual({ ok: false, error: 'desligado' })
  })

  it('contrato 171 (C2): "Triar agora" num grupo sem "Incluir grupos" é recusado sem execução; com grupos, tria', async () => {
    const h = harness()
    await h.receive(h.mensagem(GRUPO, 'g1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(GRUPO)).toEqual({ ok: false, error: 'grupos' })
    await h.advance(0)
    expect(h.calls).toEqual([])
    expect(h.runs).toEqual([])
    h.state.grupos = true
    expect(await h.service.runNow(GRUPO)).toEqual({ ok: true })
    await h.advance(0)
    expect(h.calls).toHaveLength(1)
    expect(h.runs).toHaveLength(1)
  })

  it('contrato 171 (C3): a execução do "Triar agora" termina em "· Triar agora"; a automática não; o teto conta as duas pelo gatilho', async () => {
    const h = harness()
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    await h.receive(h.mensagem(BETO, 'b1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(BETO)).toEqual({ ok: true })
    await h.advance(0)
    expect(h.runs.map((run) => run.prompt)).toEqual(['Triagem da conversa Ana · 1 mensagem nova', 'Triagem da conversa Beto · 1 mensagem nova · Triar agora'])
    expect(h.runs.every((run) => run.trigger === 'whatsapp')).toBe(true)
  })

  it('contrato 171 (C10): o fim de cada triagem avisa as janelas, com etiqueta, com falha e com tempo esgotado', async () => {
    let outcome: TriagemOutcome = { ok: true, resultado: { urgente: false, ambito: 'pessoal', motivo: 'conversa' }, costUsd: 0, durationMs: 10 }
    const h = harness({ outcome: () => outcome })
    await h.receive(h.mensagem(ANA, 'a1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(ANA)).toEqual({ ok: true })
    await h.advance(0)
    outcome = { ok: false, error: 'format' }
    await h.receive(h.mensagem(BETO, 'b1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(BETO)).toEqual({ ok: true })
    await h.advance(0)
    outcome = { ok: false, error: 'timeout' }
    await h.receive(h.mensagem(CAIO, 'c1', { at: START - 60 * MINUTE }))
    expect(await h.service.runNow(CAIO)).toEqual({ ok: true })
    await h.advance(0)
    expect(h.dones).toEqual([
      { chatId: ANA, ok: true },
      { chatId: BETO, ok: false },
      { chatId: CAIO, ok: false },
    ])
    expect(h.runs.map((run) => run.status)).toEqual(['ok', 'error', 'timeout'])
  })

  it('o estado: prioridade desligado > sem agente > pausado; avisa só quando muda', async () => {
    const h = harness({ enabled: false, motivo: 'sem-agente' })
    expect((await h.service.status()).motivo).toBe('desligado')
    h.state.enabled = true
    expect((await h.service.status()).motivo).toBe('sem-agente')
    h.state.motivo = 'pausado'
    expect(await h.service.status()).toMatchObject({ ativo: false, motivo: 'pausado', agenteNome: 'Triagem do WhatsApp', tarefaId: 'tk-triagem', teto: 300 })
    h.state.motivo = null
    expect(await h.service.status()).toMatchObject({ ativo: true, motivo: null })
    const avisos = h.statuses.length
    await h.service.status()
    expect(h.statuses).toHaveLength(avisos)
    expect(h.statuses.map((status) => status.motivo)).toEqual(['desligado', 'sem-agente', 'pausado', null])
  })

  it('a escolha do dono pelo canal: aplicarManual, grava e avisa; pedido fora do formato recusado', async () => {
    const h = harness()
    const result = await h.service.set(ANA, { urgente: true })
    expect(result).toMatchObject({ ok: true, etiqueta: { urgente: true, urgenteFixo: true, origem: 'manual' } })
    expect(h.changed).toHaveLength(1)
    expect(await h.service.set(ANA, { urgente: 'sim' })).toEqual({ ok: false, error: 'invalid' })
    expect(await h.service.set('nao-e-chat', { urgente: true })).toEqual({ ok: false, error: 'invalid' })
    expect(await h.service.set(ANA, { ambito: 'trabalho' })).toEqual({ ok: false, error: 'invalid' })
    expect((await h.service.list()).etiquetas[ANA]?.urgente).toBe(true)
  })

  it('CA9: bloqueado, etiqueta e grava, mas não avisa as janelas; os canais recusados com o app bloqueado', async () => {
    const h = harness({ locked: true })
    await h.receive(h.mensagem(ANA, 'm1'))
    await h.advance(30 * SEC)
    expect(h.sets).toHaveLength(1)
    expect(h.runs).toHaveLength(1)
    expect(h.changed).toEqual([])
    expect(h.statuses).toEqual([])
    for (const channel of ['scribe:triagem-list', 'scribe:triagem-set', 'scribe:triagem-run', 'scribe:triagem-create-from-template'] as const) {
      expect(INVOKE_CHANNELS).toContain(channel)
      expect(WHEN_LOCKED[channel]).toBe('refused')
    }
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:triagem-changed')
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:triagem-status-changed')
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:triagem-done')
    // Contrato 171 (C10): bloqueado, o fim da triagem também não chega às janelas.
    expect(h.dones).toEqual([])
    const index = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    expect(index).toContain("if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:triagem-changed', { chatId, etiqueta })")
    expect(index).toContain("if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:triagem-status-changed', status)")
    expect(index).toContain("if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:triagem-done', { chatId, ok })")
  })

  it('CA11: no index.ts a triagem recebe a mensagem depois do atendimento e antes da notificação', () => {
    const index = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    const atendimento = index.indexOf('void atendimentoRef.current?.onMessage(message, chatName)')
    const triagem = index.indexOf('void triagemRef.current?.onMessage(message, chatName)')
    const notifica = index.indexOf('notifyWhatsApp(message, chatName)', atendimento)
    expect(atendimento).toBeGreaterThan(-1)
    expect(triagem).toBeGreaterThan(atendimento)
    expect(notifica).toBeGreaterThan(triagem)
  })

  it('dispose: temporizadores saem e nada é chamado depois', async () => {
    const h = harness()
    await h.receive(h.mensagem(ANA, 'm1'))
    expect(h.timers.size).toBe(1)
    h.service.dispose()
    expect(h.timers.size).toBe(0)
    await h.advance(MINUTE)
    expect(h.calls).toEqual([])
  })

  it('a triagem só etiqueta: nada em main/whatsapp/triagem importa o envio nem o email', () => {
    const dir = resolve(import.meta.dirname, '../src/main/whatsapp/triagem')
    for (const name of readdirSync(dir)) {
      const source = readFileSync(join(dir, name), 'utf8')
      expect(source).not.toMatch(/send-guard|agentSend|main\/email|\.\.\/\.\.\/email/)
    }
    for (const name of ['../src/main/schedules/service.ts', '../src/main/schedules/runner.ts', '../src/main/agents/store.ts']) {
      expect(readFileSync(resolve(import.meta.dirname, name), 'utf8')).not.toMatch(/from '[^']*whatsapp\/(triagem|atendimento)/)
    }
  })
})
