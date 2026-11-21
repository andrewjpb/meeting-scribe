// Contrato 115 (funil-vendas, CA2 e CA3): o alerta diário do funil (R44). Só a partir das 09:00 locais, uma
// verificação por dia (`ultimoAvisoEm`), uma notificação agrupada e nenhuma sem esfriada nem passo vencido.
import { describe, expect, it } from 'vitest'
import { createFunilAlerts, funilAlertaDevido, textoAlerta } from '../src/main/funil/alerts'
import type { Etapa, FunilState, FunilView, Oportunidade } from '../src/shared/funil'
import { etapasPadrao } from '../src/shared/funil-logic'
import type { FunilSettings } from '../src/shared/settings-defaults'

const DIA_MS = 86_400_000
const TZ = 'America/Sao_Paulo'
/** 20/11/2026 em São Paulo (UTC-3). */
const AS_0859 = Date.parse('2026-11-20T11:59:00.000Z')
const AS_0901 = Date.parse('2026-11-20T12:01:00.000Z')
const SETTINGS: FunilSettings = { detectarNasReunioes: true, diasEsfriar: 7, avisarEsfriadas: true }

let seq = 0
const etapas = etapasPadrao(() => `e-${++seq}`)
const porNome = (nome: string): Etapa => {
  const found = etapas.find((etapa) => etapa.nome === nome)
  if (!found) throw new Error(nome)
  return found
}

const oportunidade = (patch: Partial<Oportunidade> = {}): Oportunidade => ({
  id: `op-${++seq}`,
  titulo: 'Portal',
  empresaId: null,
  contatoIds: [],
  etapaId: porNome('Proposta').id,
  ordem: 0,
  valor: null,
  previsao: null,
  proximoPasso: null,
  meetingIds: [],
  whatsappChatIds: [],
  emails: [],
  origem: 'manual',
  motivoPerda: null,
  criadoEm: AS_0901 - 40 * DIA_MS,
  atualizadoEm: AS_0901 - DIA_MS,
  movidoEm: AS_0901 - DIA_MS,
  fechadoEm: null,
  arquivado: false,
  ...patch,
})

/** 2 esfriadas e 1 com próximo passo vencido; a ganha fria e a arquivada não contam. */
function estado(ultimoAvisoEm: number | null = null): FunilView {
  const fria1 = oportunidade()
  const fria2 = oportunidade()
  const vencida = oportunidade({ proximoPasso: { texto: 'Ligar', data: '2026-11-19' } })
  const emDia = oportunidade({ proximoPasso: { texto: 'Ligar', data: '2026-11-20' } })
  const ganha = oportunidade({ etapaId: porNome('Ganho').id, fechadoEm: AS_0901 - 30 * DIA_MS })
  const arquivada = oportunidade({ etapaId: porNome('Perdido').id, arquivado: true, proximoPasso: { texto: 'x', data: '2026-01-01' } })
  const state: FunilState = { version: 1, contatos: [], empresas: [], oportunidades: [fria1, fria2, vencida, emDia, ganha, arquivada], etapas, eventos: [], ignorados: [], ultimoAvisoEm }
  return { state, ultimas: { [fria1.id]: AS_0901 - 8 * DIA_MS, [fria2.id]: AS_0901 - 20 * DIA_MS, [ganha.id]: AS_0901 - 30 * DIA_MS } }
}

/** Alerta com um `funil.json` em memória: `marcar` grava o `ultimoAvisoEm` que a próxima leitura vê. */
function montar(opcoes: { view?: FunilView; settings?: FunilSettings } = {}) {
  let view = opcoes.view ?? estado()
  const marcados: number[] = []
  const avisos: { title: string; body: string }[] = []
  const logs: string[] = []
  let views = 0
  const alerts = createFunilAlerts({
    view: () => {
      views++
      return Promise.resolve(view)
    },
    ultimoAviso: () => Promise.resolve(view.state.ultimoAvisoEm),
    settings: () => Promise.resolve({ funil: opcoes.settings ?? SETTINGS }),
    marcar: (at) => {
      marcados.push(at)
      view = { ...view, state: { ...view.state, ultimoAvisoEm: at } }
      return Promise.resolve()
    },
    notify: (aviso) => avisos.push(aviso),
    timeZone: () => TZ,
    log: (message) => logs.push(message),
  })
  return { alerts, marcados, avisos, logs, views: () => views }
}

describe('alerta diário do funil (contrato 115)', () => {
  it('CA2: às 08:59 não é devido; às 09:01 avisa uma vez, marca, e só volta no dia seguinte', async () => {
    expect(funilAlertaDevido({ view: estado(), settings: SETTINGS, now: AS_0859, timeZone: TZ })).toEqual({ devido: false, esfriadas: 2, vencidas: 1 })
    expect(funilAlertaDevido({ view: estado(), settings: SETTINGS, now: AS_0901, timeZone: TZ })).toEqual({ devido: true, esfriadas: 2, vencidas: 1 })

    const { alerts, marcados, avisos } = montar()
    await alerts.tick(AS_0859)
    expect(marcados).toEqual([])
    expect(avisos).toEqual([])
    await alerts.tick(AS_0901)
    expect(avisos).toEqual([{ title: 'Funil', body: '2 oportunidades esfriaram, 1 com próximo passo vencido' }])
    expect(marcados).toEqual([AS_0901])
    await alerts.tick(AS_0901 + 30_000)
    await alerts.tick(AS_0901 + 10 * 3_600_000)
    expect(avisos).toHaveLength(1)
    expect(marcados).toHaveLength(1)
    await alerts.tick(AS_0901 + DIA_MS)
    expect(avisos).toHaveLength(2)
    expect(marcados).toEqual([AS_0901, AS_0901 + DIA_MS])
  })

  it('CA3: desligado não avisa nem marca; devido sem esfriada nem vencida só marca', async () => {
    const desligado = montar({ settings: { ...SETTINGS, avisarEsfriadas: false } })
    await desligado.alerts.tick(AS_0901)
    expect(desligado.avisos).toEqual([])
    expect(desligado.marcados).toEqual([])

    const vazio = montar({ view: { state: { ...estado().state, oportunidades: [oportunidade()] }, ultimas: {} } })
    await vazio.alerts.tick(AS_0901)
    expect(vazio.marcados).toEqual([AS_0901])
    expect(vazio.avisos).toEqual([])
  })

  it('o texto no singular e o erro de leitura vira log, sem lançar', async () => {
    expect(textoAlerta(1, 1)).toEqual({ title: 'Funil', body: '1 oportunidade esfriou, 1 com próximo passo vencido' })
    expect(textoAlerta(0, 3).body).toBe('0 oportunidades esfriaram, 3 com próximo passo vencido')
    const logs: string[] = []
    const alerts = createFunilAlerts({
      view: () => Promise.reject(new Error('disco')),
      ultimoAviso: () => Promise.resolve(null),
      settings: () => Promise.resolve({ funil: SETTINGS }),
      marcar: () => Promise.resolve(),
      notify: () => {
        throw new Error('não devia avisar')
      },
      timeZone: () => TZ,
      log: (message) => logs.push(message),
    })
    await expect(alerts.tick(AS_0901)).resolves.toBeUndefined()
    expect(logs).toEqual(['[funil] alerta diário falhou: disco'])
  })

  it('as checagens baratas vêm antes: desligado, antes das 09:00 ou já conferido hoje, a view não é montada', async () => {
    const desligado = montar({ settings: { ...SETTINGS, avisarEsfriadas: false } })
    await desligado.alerts.tick(AS_0901)
    expect(desligado.views()).toBe(0)

    const cedo = montar()
    await cedo.alerts.tick(AS_0859)
    expect(cedo.views()).toBe(0)

    const marcado = montar({ view: estado(AS_0901 - 60_000) })
    await marcado.alerts.tick(AS_0901)
    expect(marcado.views()).toBe(0)
    expect(marcado.avisos).toEqual([])

    const devido = montar()
    await devido.alerts.tick(AS_0901)
    await devido.alerts.tick(AS_0901 + 30_000)
    expect(devido.views()).toBe(1)
  })
})
