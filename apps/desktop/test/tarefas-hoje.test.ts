// Contrato 124 (tarefas, CA6 = CA14 da spec, R32, D12, D-12): o aviso diário "Hoje" no lugar do alerta do funil.
// Uma conferência por dia a partir de `tarefas.horaLembrete` (hora local), marcada antes de avisar, e o texto com as
// partes que as Configurações deixam ligadas.
import { describe, expect, it } from 'vitest'
import { avisoHojeDevido, createAvisoHoje, textoAvisoHoje, type AvisoHojeSettings } from '../src/main/tarefas/hoje'
import type { FunilView, Oportunidade } from '../src/shared/funil'
import { etapasPadrao } from '../src/shared/funil-logic'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'
import type { Tarefa } from '../src/shared/tarefas'

const DIA_MS = 86_400_000
const TZ = 'America/Sao_Paulo'
/** 20/11/2026 09:05 em São Paulo (UTC-3). */
const AS_0905 = Date.parse('2026-11-20T12:05:00.000Z')
const AS_0855 = Date.parse('2026-11-20T11:55:00.000Z')
const ONTEM = AS_0905 - DIA_MS

let seq = 0
const etapas = etapasPadrao(() => `e-${++seq}`)
const aberta = etapas.find((etapa) => etapa.tipo === 'aberta')?.id ?? ''

const tarefa = (prazo: string | null, parcial: Partial<Tarefa> = {}): Tarefa => ({
  id: `t-${++seq}`,
  titulo: 'Ligar para a Ana',
  detalhe: '',
  status: 'aberta',
  importante: false,
  prazo,
  lembreteEm: null,
  lembreteDisparadoEm: null,
  responsavel: { tipo: 'eu' },
  origem: { tipo: 'manual' },
  vinculos: { oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null },
  historico: [],
  criadaEm: ONTEM,
  atualizadaEm: ONTEM,
  feitaEm: null,
  ...parcial,
})

const oportunidade = (id: string, parcial: Partial<Oportunidade> = {}): Oportunidade => ({
  id,
  titulo: 'Portal',
  empresaId: null,
  contatoIds: [],
  etapaId: aberta,
  ordem: 0,
  valor: null,
  previsao: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: AS_0905 - 40 * DIA_MS,
  atualizadoEm: AS_0905 - 30 * DIA_MS,
  movidoEm: AS_0905 - 30 * DIA_MS,
  fechadoEm: null,
  arquivado: false,
  ...parcial,
})

/** Uma esfriada (20 dias sem interação) e uma morna (2 dias). */
const VIEW: FunilView = {
  state: { version: 1, contatos: [], empresas: [], oportunidades: [oportunidade('fria'), oportunidade('morna')], etapas, eventos: [], ignorados: [], ultimoAvisoEm: null },
  ultimas: { fria: AS_0905 - 20 * DIA_MS, morna: AS_0905 - 2 * DIA_MS },
  proximosPassos: { fria: null, morna: null },
}
const VIEW_VAZIA: FunilView = { ...VIEW, state: { ...VIEW.state, oportunidades: [] }, ultimas: {}, proximosPassos: {} }

/** 1 vencida, 1 de hoje, 1 futura, 1 sem prazo e 1 vencida já feita. */
const TAREFAS = [tarefa('2026-11-19'), tarefa('2026-11-20'), tarefa('2026-11-27'), tarefa(null), tarefa('2026-11-18', { status: 'feita', feitaEm: ONTEM })]

const settings = (patch: { tarefas?: Partial<AvisoHojeSettings['tarefas']>; funil?: Partial<AvisoHojeSettings['funil']> } = {}): AvisoHojeSettings => ({
  tarefas: { ...DEFAULT_SETTINGS.tarefas, ...patch.tarefas },
  funil: { ...DEFAULT_SETTINGS.funil, ...patch.funil },
})

function montar(opts: { settings?: AvisoHojeSettings; view?: FunilView; tarefas?: Tarefa[]; ultimo?: number | null; marcarFalha?: boolean } = {}) {
  const chamadas: string[] = []
  const avisos: { title: string; body: string }[] = []
  let ultimo = opts.ultimo === undefined ? ONTEM : opts.ultimo
  let leiturasDaView = 0
  const aviso = createAvisoHoje({
    settings: async () => opts.settings ?? settings(),
    ultimoAvisoHojeEm: async () => ultimo,
    view: async () => {
      leiturasDaView++
      return opts.view ?? VIEW
    },
    tarefas: async () => opts.tarefas ?? TAREFAS,
    marcarAvisoHoje: async (at) => {
      chamadas.push('marcar')
      if (opts.marcarFalha) throw new Error('disco cheio')
      ultimo = at
    },
    notify: (item) => {
      chamadas.push('notify')
      avisos.push(item)
    },
    timeZone: () => TZ,
  })
  return { aviso, chamadas, avisos, leituras: () => leiturasDaView }
}

describe('aviso "Hoje" (contrato 124, CA6)', () => {
  it('às 09:05 com o último aviso de ontem: marca e avisa uma vez; o segundo tick do dia não faz nada', async () => {
    const ctx = montar()
    await ctx.aviso.tick(AS_0905)
    expect(ctx.chamadas).toEqual(['marcar', 'notify'])
    expect(ctx.avisos).toEqual([{ title: 'Hoje', body: '1 vencida · 1 para hoje · Funil: 1 esfriada' }])
    await ctx.aviso.tick(AS_0905 + 30_000)
    expect(ctx.chamadas).toEqual(['marcar', 'notify'])
  })

  it('às 08:55 nada (nem a view é lida); sem aviso nenhum ainda, às 09:05 avisa', async () => {
    const cedo = montar()
    await cedo.aviso.tick(AS_0855)
    expect(cedo.chamadas).toEqual([])
    expect(cedo.leituras()).toBe(0)
    const primeiro = montar({ ultimo: null })
    await primeiro.aviso.tick(AS_0905)
    expect(primeiro.chamadas).toEqual(['marcar', 'notify'])
  })

  it('a hora das Configurações manda: com 10:00, às 09:05 nada', async () => {
    const ctx = montar({ settings: settings({ tarefas: { horaLembrete: '10:00' } }) })
    await ctx.aviso.tick(AS_0905)
    expect(ctx.chamadas).toEqual([])
  })

  it('tudo zerado: marca e não avisa', async () => {
    const ctx = montar({ view: VIEW_VAZIA, tarefas: [tarefa('2026-11-27')] })
    await ctx.aviso.tick(AS_0905)
    expect(ctx.chamadas).toEqual(['marcar'])
    expect(ctx.avisos).toEqual([])
  })

  it('avisoDiario desligado: só o funil; avisarEsfriadas desligado: só as tarefas; as duas desligadas: marca o dia e não avisa', async () => {
    const soFunil = montar({ settings: settings({ tarefas: { avisoDiario: false } }) })
    await soFunil.aviso.tick(AS_0905)
    expect(soFunil.avisos).toEqual([{ title: 'Hoje', body: 'Funil: 1 esfriada' }])
    const soTarefas = montar({ settings: settings({ funil: { avisarEsfriadas: false } }) })
    await soTarefas.aviso.tick(AS_0905)
    expect(soTarefas.avisos).toEqual([{ title: 'Hoje', body: '1 vencida · 1 para hoje' }])
    const nada = montar({ settings: settings({ tarefas: { avisoDiario: false }, funil: { avisarEsfriadas: false } }) })
    await nada.aviso.tick(AS_0905)
    expect(nada.chamadas).toEqual(['marcar'])
    expect(nada.leituras()).toBe(0)
    await nada.aviso.tick(AS_0905 + 30_000)
    expect(nada.chamadas).toEqual(['marcar'])
  })

  it('a marcação falhando: nenhum aviso e o tick não lança', async () => {
    const ctx = montar({ marcarFalha: true })
    await expect(ctx.aviso.tick(AS_0905)).resolves.toBeUndefined()
    expect(ctx.chamadas).toEqual(['marcar'])
  })

  it('plurais e partes zeradas', () => {
    const ligado = settings()
    expect(textoAvisoHoje({ vencidas: 2, hoje: 0, esfriadas: 0 }, ligado)).toEqual({ title: 'Hoje', body: '2 vencidas' })
    expect(textoAvisoHoje({ vencidas: 0, hoje: 3, esfriadas: 2 }, ligado)).toEqual({ title: 'Hoje', body: '3 para hoje · Funil: 2 esfriadas' })
    expect(textoAvisoHoje({ vencidas: 0, hoje: 0, esfriadas: 0 }, ligado)).toBeNull()
    expect(textoAvisoHoje({ vencidas: 1, hoje: 1, esfriadas: 0 }, settings({ tarefas: { avisoDiario: false } }))).toBeNull()
  })

  it('avisoHojeDevido conta pelo dia local e diz se é devido', () => {
    const devido = avisoHojeDevido({ tarefas: [...TAREFAS, tarefa('2026-11-10')], view: VIEW, settings: settings(), ultimoAvisoHojeEm: ONTEM, now: AS_0905, timeZone: TZ })
    expect(devido).toEqual({ devido: true, vencidas: 2, hoje: 1, esfriadas: 1 })
    expect(avisoHojeDevido({ tarefas: TAREFAS, view: VIEW, settings: settings(), ultimoAvisoHojeEm: AS_0905 - 60_000, now: AS_0905, timeZone: TZ }).devido).toBe(false)
  })
})
