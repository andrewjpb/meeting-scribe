// Contrato 124 (tarefas, CA7 = CA1 da spec, R35, D11): a migração única com os stores de verdade (funil, Automações e
// tarefas) numa pasta temporária, ligados como o `index.ts` liga. O que vira tarefa, o que sai de `funil.json` e de
// `schedules.json`, as cópias de antes (0600), o próximo passo derivado igual ao de antes e o desfazer quando a
// limpeza das Automações falha.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFunilService } from '../src/main/funil/service'
import { createFunilStore } from '../src/main/funil/store'
import { createFileSchedulesStore } from '../src/main/schedules/store'
import { migrarTarefas, type MigracaoDeps } from '../src/main/tarefas/migracao'
import { createTarefasStore, type TarefasStore } from '../src/main/tarefas/store'
import type { FunilState, Oportunidade } from '../src/shared/funil'
import { etapasPadrao } from '../src/shared/funil-logic'

const HORA_MS = 3_600_000
const NOW = Date.now()
const TZ = 'America/Sao_Paulo'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let seq = 0
const etapas = etapasPadrao(() => `e-${++seq}`)
const etapaId = (nome: string): string => etapas.find((etapa) => etapa.nome === nome)?.id ?? ''

const oportunidade = (id: string, parcial: Partial<Oportunidade>): Oportunidade => ({
  id,
  titulo: `Oportunidade ${id}`,
  empresaId: null,
  contatoIds: [],
  etapaId: etapaId('Proposta'),
  ordem: 0,
  valor: null,
  previsao: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: NOW - 10 * 24 * HORA_MS,
  atualizadoEm: NOW - 10 * 24 * HORA_MS,
  movidoEm: NOW - 10 * 24 * HORA_MS,
  fechadoEm: null,
  arquivado: false,
  ...parcial,
})

const FUNIL: FunilState = {
  version: 1,
  contatos: [],
  empresas: [],
  oportunidades: [
    oportunidade('op-portal', { proximoPasso: { texto: 'Enviar estudo de escopo', data: '2026-11-27' } }),
    oportunidade('op-loja', { ordem: 1, proximoPasso: { texto: 'Revisar contrato', data: null } }),
    oportunidade('op-ganha', { etapaId: etapaId('Ganho'), fechadoEm: NOW - HORA_MS, proximoPasso: { texto: 'Faturar', data: '2026-11-30' } }),
  ],
  etapas,
  eventos: [],
  ignorados: [],
  ultimoAvisoEm: null,
}

const tarefaBase = {
  message: 'x',
  timezone: TZ,
  enabled: true,
  runOnceAction: 'delete',
  timeoutS: 60,
  notify: 'always',
  output: null,
  lastRunAt: null,
  lastStatus: null,
  lastResultPreview: null,
  lastError: null,
  consecutiveFailures: 0,
  autoPaused: false,
  email: null,
  createdAt: new Date(NOW - HORA_MS).toISOString(),
  updatedAt: new Date(NOW - HORA_MS).toISOString(),
}
const EM_1H = new Date(NOW + HORA_MS).toISOString()
const SCHEDULES = {
  version: 1,
  tasks: [
    {
      ...tarefaBase,
      id: 'lembrete-1',
      name: 'Lembrete: Responder a Ana',
      agentId: '',
      schedule: { kind: 'once', at: EM_1H },
      runOnce: true,
      nextRunAt: EM_1H,
      reminder: { text: 'Responder a Ana', whatsappChatId: null, whatsappChatName: null },
    },
    { ...tarefaBase, id: 'resumo-diario', name: 'Resumo diário', agentId: 'agente-1', schedule: { kind: 'daily', time: '08:00' }, runOnce: false, nextRunAt: EM_1H, reminder: null },
  ],
  paused: false,
  pauseReason: null,
  limitReleasedOn: null,
  meetingRuns: [],
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tarefas-migracao-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'funil.json'), `${JSON.stringify(FUNIL, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(dir, 'schedules.json'), `${JSON.stringify(SCHEDULES, null, 2)}\n`, { mode: 0o600 })
  const funilStore = createFunilStore({ dir, now: () => NOW })
  const schedulesStore = createFileSchedulesStore({ dir, now: () => NOW })
  const tarefasStore = createTarefasStore({ dir, now: () => NOW })
  const todas = async () => {
    const lido = await tarefasStore.read()
    return lido.ok ? lido.value.tarefas : []
  }
  const funil = createFunilService({
    store: funilStore,
    meetings: { list: async () => [] },
    summaries: { get: async () => null },
    email: { cached: async () => [] },
    whatsapp: { chats: async () => [], me: () => null },
    chooseImportFile: async () => null,
    onChange: () => undefined,
    tarefas: { todas, criar: async () => ({ ok: true, id: null }), salvar: async () => ({ ok: true, id: null }) },
    now: () => NOW,
  })
  // Como o `index.ts` liga os adaptadores; `falhar` troca um deles por uma rejeição.
  const deps = (falhar: 'remover' | null = null): MigracaoDeps => ({
    tarefas: tarefasStore,
    funil: { legado: () => funilStore.legado(), backup: () => funilStore.backupMigracao(), limpar: () => funilStore.limparLegado(), restaurar: () => funilStore.restaurarMigracao() },
    schedules: {
      lembretes: () => schedulesStore.lembretes(),
      backup: () => schedulesStore.backupMigracao(),
      remover: (ids) => (falhar === 'remover' ? Promise.reject(new Error('disco cheio')) : schedulesStore.removerLembretes(ids)),
      restaurar: () => schedulesStore.restaurarMigracao(),
    },
    timeZone: () => TZ,
    now: () => NOW,
  })
  const ler = (nome: string): string => readFileSync(join(dir, nome), 'utf8')
  return { dir, funil, tarefasStore, deps, ler }
}

async function arquivo(store: TarefasStore) {
  const lido = await store.read()
  if (!lido.ok) throw new Error(lido.erro)
  return lido.value
}

describe('migração R35 com os stores reais (contrato 124, CA7)', () => {
  it('2 passos abertos e 1 lembrete viram tarefas; funil.json e schedules.json perdem o que migrou e ficam com cópia 0600', async () => {
    const ctx = setup()
    const funilAntes = ctx.ler('funil.json')
    const schedulesAntes = ctx.ler('schedules.json')

    expect(await migrarTarefas(ctx.deps())).toEqual({ ok: true, migradas: 3, jaMigrado: false })

    const tarefas = await arquivo(ctx.tarefasStore)
    expect(tarefas.migradoEm).toBe(NOW)
    expect(tarefas.tarefas.map((tarefa) => tarefa.origem)).toEqual([
      { tipo: 'migracao', de: 'proximo-passo' },
      { tipo: 'migracao', de: 'proximo-passo' },
      { tipo: 'migracao', de: 'lembrete' },
    ])
    expect(tarefas.tarefas.map((tarefa) => [tarefa.titulo, tarefa.vinculos.oportunidadeId])).toEqual([
      ['Enviar estudo de escopo', 'op-portal'],
      ['Revisar contrato', 'op-loja'],
      ['Responder a Ana', null],
    ])
    expect(tarefas.tarefas[2]?.lembreteEm).toBe(Date.parse(EM_1H))

    const funil = JSON.parse(ctx.ler('funil.json')) as FunilState
    expect(funil.oportunidades.map((item) => item.id)).toEqual(['op-portal', 'op-loja', 'op-ganha'])
    expect(funil.oportunidades.some((item) => 'proximoPasso' in item)).toBe(false)
    expect((JSON.parse(ctx.ler('schedules.json')) as { tasks: { id: string }[] }).tasks.map((task) => task.id)).toEqual(['resumo-diario'])

    const copias = readdirSync(ctx.dir).filter((nome) => nome.includes('.bak-tarefas-')).sort()
    expect(copias).toHaveLength(2)
    const copiaFunil = copias.find((nome) => nome.startsWith('funil.json.bak-tarefas-')) ?? ''
    const copiaSchedules = copias.find((nome) => nome.startsWith('schedules.json.bak-tarefas-')) ?? ''
    expect(ctx.ler(copiaFunil)).toBe(funilAntes)
    expect(ctx.ler(copiaSchedules)).toBe(schedulesAntes)
    expect(statSync(join(ctx.dir, copiaFunil)).mode & 0o777).toBe(0o600)
    expect(statSync(join(ctx.dir, copiaSchedules)).mode & 0o777).toBe(0o600)

    // O kanban mostra os mesmos passos de antes, agora derivados das tarefas; a ganha não tem chave.
    const view = await ctx.funil.view()
    expect(view.proximosPassos['op-portal']).toMatchObject({ texto: 'Enviar estudo de escopo', data: '2026-11-27' })
    expect(view.proximosPassos['op-loja']).toMatchObject({ texto: 'Revisar contrato', data: null })
    expect(view.proximosPassos).not.toHaveProperty('op-ganha')

    // Uma vez só: a segunda chamada não mexe em nada.
    const funilDepois = ctx.ler('funil.json')
    expect(await migrarTarefas(ctx.deps())).toEqual({ ok: true, migradas: 0, jaMigrado: true })
    expect(ctx.ler('funil.json')).toBe(funilDepois)
  })

  it('remover os lembretes falhando: tarefas.json sem as migradas e sem migradoEm; funil.json e schedules.json como antes', async () => {
    const ctx = setup()
    // Uma tarefa que já existia (o arquivo existe, sem migração).
    const existente = await ctx.tarefasStore.criar({
      titulo: 'Já existia',
      detalhe: '',
      prazo: null,
      lembreteEm: null,
      importante: false,
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'manual' },
      vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
    })
    expect(existente.ok).toBe(true)
    const funilAntes = ctx.ler('funil.json')
    const schedulesAntes = ctx.ler('schedules.json')

    expect(await migrarTarefas(ctx.deps('remover'))).toEqual({ ok: false, passo: 'limpeza' })

    const tarefas = await arquivo(ctx.tarefasStore)
    expect(tarefas.migradoEm).toBeNull()
    expect(tarefas.tarefas.map((tarefa) => tarefa.titulo)).toEqual(['Já existia'])
    expect(ctx.ler('funil.json')).toBe(funilAntes)
    expect(ctx.ler('schedules.json')).toBe(schedulesAntes)
    // O store do funil esqueceu o cache: a leitura vem do arquivo restaurado.
    expect((await ctx.funil.view()).state.oportunidades.filter((item) => item.proximoPasso).map((item) => item.id)).toEqual(['op-portal', 'op-loja', 'op-ganha'])
  })

  it('schedules.json inválido: a parte das Automações é pulada sem regravar o arquivo', async () => {
    const ctx = setup()
    writeFileSync(join(ctx.dir, 'schedules.json'), '{ quebrado')
    expect(await migrarTarefas(ctx.deps())).toEqual({ ok: true, migradas: 2, jaMigrado: false })
    expect(ctx.ler('schedules.json')).toBe('{ quebrado')
    expect(readdirSync(ctx.dir).some((nome) => nome.startsWith('schedules.json.bak-tarefas-'))).toBe(false)
  })
})
