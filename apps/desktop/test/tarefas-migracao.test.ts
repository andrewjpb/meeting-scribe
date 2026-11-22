// Contrato 121 (tarefas, CA8 e CA9 = CA1 da spec, R35, D-3, D-4, D-8, D11): a migração única com falsos. Ordem das
// chamadas, o que vira tarefa, o que só sai das Automações, o desfazer e os casos sem escrita.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrarTarefas, type LembreteLegado, type MigracaoDeps, type PassoLegado } from '../src/main/tarefas/migracao'
import { createTarefasStore } from '../src/main/tarefas/store'
import type { TarefaNova, TarefasArquivo } from '../src/shared/tarefas'

const HORA_MS = 3_600_000
const NOW = Date.parse('2026-11-22T15:00:00.000Z')
const TZ = 'America/Sao_Paulo'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const passo = (patch: Partial<PassoLegado> = {}): PassoLegado => ({ oportunidadeId: 'op-1', texto: 'Ligar para a Marina', data: '2026-11-20', aberta: true, contatoIds: ['c-1'], empresaId: 'e-1', ...patch })
const lembrete = (patch: Partial<LembreteLegado> = {}): LembreteLegado => ({ id: 'r-1', texto: 'Responder o e-mail', nextRunAt: NOW + HORA_MS, whatsappChatId: null, email: null, ...patch })

const vazio = (): TarefasArquivo => ({ version: 1, tarefas: [], ignorados: [], migradoEm: null, ultimoAvisoHojeEm: null })

/** Falsos que anotam cada chamada em ordem; `falhas` faz um método rejeitar. */
function falsos(opts: { estado?: TarefasArquivo; passos?: PassoLegado[]; lembretes?: LembreteLegado[] | null; falhas?: string[] } = {}) {
  const chamadas: string[] = []
  const recebido: { aplicar?: TarefaNova[]; remover?: string[]; reverter?: TarefasArquivo | null } = {}
  let estado = opts.estado ?? vazio()
  const registrar = (nome: string): void => {
    chamadas.push(nome)
    if (opts.falhas?.includes(nome)) throw new Error(`falha em ${nome}`)
  }
  const ok = <T>(value: T) => ({ ok: true as const, value, state: estado })
  const deps: MigracaoDeps = {
    tarefas: {
      read: async () => {
        registrar('tarefas.read')
        return ok(estado)
      },
      aplicarMigracao: async (novas, at) => {
        registrar('tarefas.aplicarMigracao')
        recebido.aplicar = [...novas]
        estado = { ...estado, migradoEm: at }
        return ok([])
      },
      reverterMigracao: async (anterior) => {
        registrar('tarefas.reverterMigracao')
        recebido.reverter = anterior
        return ok(null)
      },
    },
    funil: {
      legado: async () => {
        registrar('funil.legado')
        return opts.passos ?? []
      },
      backup: async () => registrar('funil.backup'),
      limpar: async () => registrar('funil.limpar'),
      restaurar: async () => registrar('funil.restaurar'),
    },
    schedules: {
      lembretes: async () => {
        registrar('schedules.lembretes')
        return opts.lembretes === undefined ? [] : opts.lembretes
      },
      backup: async () => registrar('schedules.backup'),
      remover: async (ids) => {
        registrar('schedules.remover')
        recebido.remover = ids
      },
      restaurar: async () => registrar('schedules.restaurar'),
    },
    timeZone: () => TZ,
    now: () => NOW,
  }
  return { deps, chamadas, recebido }
}

describe('migração do próximo passo e dos lembretes (CA8)', () => {
  it('2 passos abertos + 1 fechado + 1 lembrete futuro + 1 desligado → 3 tarefas, cópias antes, limpeza depois', async () => {
    const logs: string[] = []
    const { deps, chamadas, recebido } = falsos({
      passos: [passo(), passo({ oportunidadeId: 'op-2', texto: 'Mandar a proposta', data: null, contatoIds: [], empresaId: null }), passo({ oportunidadeId: 'op-3', texto: 'Fechada', aberta: false })],
      lembretes: [lembrete({ email: { accountId: 'a-1', messageId: 'msg-1', label: 'Proposta', mailbox: 'Arquivo' }, whatsappChatId: 'chat-1' }), lembrete({ id: 'r-2', texto: 'Desligado', nextRunAt: null })],
    })
    const result = await migrarTarefas({ ...deps, log: (message) => void logs.push(message) })
    expect(result).toEqual({ ok: true, migradas: 3, jaMigrado: false })
    expect(chamadas).toEqual(['tarefas.read', 'funil.legado', 'schedules.lembretes', 'funil.backup', 'schedules.backup', 'tarefas.aplicarMigracao', 'schedules.remover', 'funil.limpar'])

    const novas = recebido.aplicar ?? []
    expect(novas).toHaveLength(3)
    expect(novas[0]).toEqual({
      titulo: 'Ligar para a Marina',
      detalhe: '',
      prazo: '2026-11-20',
      lembreteEm: null,
      importante: false,
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'migracao', de: 'proximo-passo' },
      vinculos: { oportunidadeId: 'op-1', contatoIds: ['c-1'], empresaId: 'e-1', meetingId: null, email: null, whatsappChatId: null },
    })
    expect(novas[1]).toMatchObject({ titulo: 'Mandar a proposta', prazo: null, lembreteEm: null, vinculos: { oportunidadeId: 'op-2' } })
    expect(novas[2]).toEqual({
      titulo: 'Responder o e-mail',
      detalhe: '',
      prazo: '2026-11-22',
      lembreteEm: NOW + HORA_MS,
      importante: false,
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'migracao', de: 'lembrete' },
      vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: { accountId: 'a-1', id: 'msg-1', assunto: 'Proposta', mailbox: 'Arquivo' }, whatsappChatId: 'chat-1' },
    })
    expect(recebido.remover).toEqual(['r-1', 'r-2'])
    expect(logs.join('\n')).not.toMatch(/Marina|proposta|e-mail/i)
  })

  it('texto longo: 200 caracteres no título e o resto no detalhe; prazo do lembrete no dia local', async () => {
    const texto = `${'a'.repeat(200)}${'b'.repeat(50)}`
    // 01:30 UTC do dia 23 ainda é dia 22 em São Paulo.
    const { deps, recebido } = falsos({ passos: [passo({ texto, data: '2026-02-30' })], lembretes: [lembrete({ nextRunAt: Date.parse('2026-11-23T01:30:00Z') })] })
    await migrarTarefas(deps)
    expect(recebido.aplicar?.[0]).toMatchObject({ titulo: 'a'.repeat(200), detalhe: 'b'.repeat(50), prazo: null })
    expect(recebido.aplicar?.[1]?.prazo).toBe('2026-11-22')
  })

  it('segunda chamada com migradoEm gravado: jaMigrado e nenhum outro método', async () => {
    const { deps, chamadas } = falsos({ estado: { ...vazio(), migradoEm: NOW - 1 }, passos: [passo()], lembretes: [lembrete()] })
    expect(await migrarTarefas(deps)).toEqual({ ok: true, migradas: 0, jaMigrado: true })
    expect(chamadas).toEqual(['tarefas.read'])
  })

  it('com o store de verdade: as que já existiam continuam e a segunda chamada não migra de novo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tarefas-migracao-'))
    dirs.push(dir)
    const store = createTarefasStore({ dir, now: () => NOW })
    const existente = await store.criar({
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
    const { deps } = falsos({ passos: [passo()], lembretes: [lembrete()] })
    expect(await migrarTarefas({ ...deps, tarefas: store })).toEqual({ ok: true, migradas: 2, jaMigrado: false })
    const lido = await store.read()
    if (!lido.ok) throw new Error('leitura')
    expect(lido.value.tarefas.map((t) => t.titulo)).toEqual(['Já existia', 'Ligar para a Marina', 'Responder o e-mail'])
    expect(lido.value.migradoEm).toBe(NOW)
    expect(await migrarTarefas({ ...deps, tarefas: store })).toEqual({ ok: true, migradas: 0, jaMigrado: true })
  })
})

describe('migração: falhas e casos sem escrita (CA9)', () => {
  it('limpar do funil rejeitando: desfaz as três e devolve o passo limpeza', async () => {
    const estado: TarefasArquivo = { ...vazio(), ultimoAvisoHojeEm: 5 }
    const { deps, chamadas, recebido } = falsos({ estado, passos: [passo()], lembretes: [lembrete()], falhas: ['funil.limpar'] })
    expect(await migrarTarefas(deps)).toEqual({ ok: false, passo: 'limpeza' })
    expect(recebido.reverter).toEqual(estado)
    expect(chamadas.slice(-3)).toEqual(['tarefas.reverterMigracao', 'schedules.restaurar', 'funil.restaurar'])
  })

  it('desfazer tenta todos mesmo quando um falha; arquivo que não existia volta a não existir', async () => {
    const { deps, chamadas, recebido } = falsos({ passos: [passo()], lembretes: [lembrete()], falhas: ['schedules.remover', 'schedules.restaurar'] })
    expect(await migrarTarefas(deps)).toEqual({ ok: false, passo: 'limpeza' })
    expect(recebido.reverter).toBeNull()
    expect(chamadas).toContain('funil.restaurar')
    expect(chamadas).not.toContain('funil.limpar')
  })

  it('cópia rejeitando: passo backup e aplicarMigracao nunca chamado', async () => {
    const { deps, chamadas } = falsos({ passos: [passo()], lembretes: [lembrete()], falhas: ['schedules.backup'] })
    expect(await migrarTarefas(deps)).toEqual({ ok: false, passo: 'backup' })
    expect(chamadas).not.toContain('tarefas.aplicarMigracao')
    expect(chamadas).not.toContain('funil.limpar')
  })

  it('leitura e gravação que falham não desfazem nada', async () => {
    const leitura = falsos({ passos: [passo()], falhas: ['funil.legado'] })
    expect(await migrarTarefas(leitura.deps)).toEqual({ ok: false, passo: 'leitura' })
    expect(leitura.chamadas).toEqual(['tarefas.read', 'funil.legado'])

    const gravacao = falsos({ passos: [passo()], lembretes: [lembrete()], falhas: ['tarefas.aplicarMigracao'] })
    expect(await migrarTarefas(gravacao.deps)).toEqual({ ok: false, passo: 'gravacao' })
    expect(gravacao.chamadas).not.toContain('schedules.remover')
    expect(gravacao.chamadas).not.toContain('tarefas.reverterMigracao')
  })

  it('schedules.json inválido: os passos do funil migram e nada mais de schedules é chamado', async () => {
    const { deps, chamadas, recebido } = falsos({ passos: [passo()], lembretes: null })
    expect(await migrarTarefas(deps)).toEqual({ ok: true, migradas: 1, jaMigrado: false })
    expect(chamadas.filter((nome) => nome.startsWith('schedules.'))).toEqual(['schedules.lembretes'])
    expect(chamadas).toEqual(['tarefas.read', 'funil.legado', 'schedules.lembretes', 'funil.backup', 'tarefas.aplicarMigracao', 'funil.limpar'])
    expect(recebido.aplicar).toHaveLength(1)
  })

  it('nada a migrar: só aplicarMigracao([]), sem cópia, remoção nem limpeza', async () => {
    const { deps, chamadas, recebido } = falsos()
    expect(await migrarTarefas(deps)).toEqual({ ok: true, migradas: 0, jaMigrado: false })
    expect(chamadas).toEqual(['tarefas.read', 'funil.legado', 'schedules.lembretes', 'tarefas.aplicarMigracao'])
    expect(recebido.aplicar).toEqual([])
  })

  it('lembrete já disparado não vira tarefa, mas o id dele vai para remover; sem passo, o funil fica intocado', async () => {
    const { deps, chamadas, recebido } = falsos({ lembretes: [lembrete({ id: 'r-velho', nextRunAt: NOW - HORA_MS }), lembrete({ id: 'r-agora', nextRunAt: NOW })] })
    expect(await migrarTarefas(deps)).toEqual({ ok: true, migradas: 0, jaMigrado: false })
    expect(recebido.aplicar).toEqual([])
    expect(recebido.remover).toEqual(['r-velho', 'r-agora'])
    expect(chamadas.filter((nome) => nome.startsWith('funil.'))).toEqual(['funil.legado'])
  })

  it('só passos de oportunidades fechadas: nenhuma tarefa, mas o campo sai do funil com cópia', async () => {
    const { deps, chamadas, recebido } = falsos({ passos: [passo({ aberta: false })] })
    expect(await migrarTarefas(deps)).toEqual({ ok: true, migradas: 0, jaMigrado: false })
    expect(recebido.aplicar).toEqual([])
    expect(chamadas).toEqual(['tarefas.read', 'funil.legado', 'schedules.lembretes', 'funil.backup', 'tarefas.aplicarMigracao', 'funil.limpar'])
  })
})
