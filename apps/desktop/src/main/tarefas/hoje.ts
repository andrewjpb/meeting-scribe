// O aviso diário "Hoje" (contrato 124, R32, D12, D-12), no lugar do alerta do funil (contrato 115): sem IA, no tick
// que as Automações já fazem a cada 30 s. O primeiro tick a partir de `tarefas.horaLembrete` (hora local) confere as
// tarefas e o funil, grava `ultimoAvisoHojeEm` em `tarefas.json` (uma conferência por dia, com ou sem aviso) e, havendo
// o que dizer, manda **uma** notificação "Hoje" ("1 vencida · 1 para hoje · Funil: 1 esfriada"). Puro nas contas;
// `createAvisoHoje` só liga as dependências que o `index.ts` passa. O log não leva título de tarefa.
import type { FunilView } from '../../shared/funil'
import { esfriada } from '../../shared/funil-logic'
import type { FunilSettings, TarefasSettings } from '../../shared/settings-defaults'
import type { Tarefa } from '../../shared/tarefas'
import { deHoje, diaNoFuso, vencida } from '../../shared/tarefas-logic'

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
/** Hora do aviso quando `horaLembrete` vem fora do formato. */
const HORA_PADRAO = '09:00'

export interface AvisoHojeSettings {
  tarefas: TarefasSettings
  funil: FunilSettings
}

export interface AvisoHojeContagens {
  vencidas: number
  hoje: number
  esfriadas: number
}

/** `HH:MM` de um instante no fuso pedido. */
function horaNoFuso(at: number, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((item) => item.type === tipo)?.value ?? '00'
  return `${parte('hour')}:${parte('minute')}`
}

/** A partir da hora do aviso (local) e sem conferência ainda no dia local. */
function podeConferir(input: { horaLembrete: string; ultimoAvisoHojeEm: number | null; now: number; timeZone: string }): boolean {
  const { horaLembrete, ultimoAvisoHojeEm, now, timeZone } = input
  const hora = HORA.test(horaLembrete) ? horaLembrete : HORA_PADRAO
  if (horaNoFuso(now, timeZone) < hora) return false
  return ultimoAvisoHojeEm === null || diaNoFuso(ultimoAvisoHojeEm, timeZone) < diaNoFuso(now, timeZone)
}

/**
 * O aviso de hoje é devido? A partir de `tarefas.horaLembrete` (hora local) e sem aviso ainda no dia local. Conta as
 * tarefas vencidas e as de hoje e as oportunidades abertas e não arquivadas que esfriaram (R7, `funil.diasEsfriar`).
 */
export function avisoHojeDevido(input: {
  tarefas: readonly Tarefa[]
  view: FunilView
  settings: AvisoHojeSettings
  ultimoAvisoHojeEm: number | null
  now: number
  timeZone: string
}): { devido: boolean } & AvisoHojeContagens {
  const { tarefas, view, settings, ultimoAvisoHojeEm, now, timeZone } = input
  const dia = diaNoFuso(now, timeZone)
  const { state } = view
  const etapas = new Map(state.etapas.map((etapa) => [etapa.id, etapa]))
  let esfriadas = 0
  for (const oportunidade of state.oportunidades) {
    const etapa = etapas.get(oportunidade.etapaId)
    if (oportunidade.arquivado || etapa?.tipo !== 'aberta') continue
    const ultima = view.ultimas[oportunidade.id] ?? Math.max(oportunidade.movidoEm, oportunidade.atualizadoEm)
    if (esfriada(oportunidade, etapa, ultima, settings.funil.diasEsfriar, now)) esfriadas++
  }
  return {
    devido: podeConferir({ horaLembrete: settings.tarefas.horaLembrete, ultimoAvisoHojeEm, now, timeZone }),
    vencidas: tarefas.filter((tarefa) => vencida(tarefa, dia)).length,
    hoje: tarefas.filter((tarefa) => deHoje(tarefa, dia)).length,
    esfriadas,
  }
}

/**
 * Título "Hoje" e as partes não zeradas separadas por " · ": "N vencida(s)" e "M para hoje" só com
 * `tarefas.avisoDiario`, "Funil: X esfriada(s)" só com `funil.avisarEsfriadas`. Nada a dizer: `null`.
 */
export function textoAvisoHoje(contagens: AvisoHojeContagens, settings: AvisoHojeSettings): { title: string; body: string } | null {
  const partes: string[] = []
  if (settings.tarefas.avisoDiario) {
    if (contagens.vencidas > 0) partes.push(`${contagens.vencidas} ${contagens.vencidas === 1 ? 'vencida' : 'vencidas'}`)
    if (contagens.hoje > 0) partes.push(`${contagens.hoje} para hoje`)
  }
  if (settings.funil.avisarEsfriadas && contagens.esfriadas > 0) partes.push(`Funil: ${contagens.esfriadas} ${contagens.esfriadas === 1 ? 'esfriada' : 'esfriadas'}`)
  return partes.length ? { title: 'Hoje', body: partes.join(' · ') } : null
}

export interface AvisoHojeDeps {
  settings: () => Promise<AvisoHojeSettings>
  /** Só o `ultimoAvisoHojeEm` de `tarefas.json` (a checagem barata de cada tick). */
  ultimoAvisoHojeEm: () => Promise<number | null>
  /** A view do funil (lê os caches de reuniões, e-mail e WhatsApp): só depois das checagens baratas. */
  view: () => Promise<FunilView>
  tarefas: () => Promise<Tarefa[]>
  /** Grava `ultimoAvisoHojeEm` em `tarefas.json`; falha vira exceção. */
  marcarAvisoHoje: (at: number) => Promise<void>
  notify: (aviso: { title: string; body: string }) => void
  timeZone: () => string
  log?: (message: string) => void
}

export interface AvisoHoje {
  /** Uma conferência (o tick das Automações); nunca lança. */
  tick(at: number): Promise<void>
}

export function createAvisoHoje(deps: AvisoHojeDeps): AvisoHoje {
  const log = deps.log ?? (() => undefined)
  return {
    async tick(at) {
      try {
        // As checagens baratas antes: a view lê os caches e o tick é a cada 30 s.
        const settings = await deps.settings()
        const timeZone = deps.timeZone()
        if (!podeConferir({ horaLembrete: settings.tarefas.horaLembrete, ultimoAvisoHojeEm: null, now: at, timeZone })) return
        const ultimoAvisoHojeEm = await deps.ultimoAvisoHojeEm()
        if (!podeConferir({ horaLembrete: settings.tarefas.horaLembrete, ultimoAvisoHojeEm, now: at, timeZone })) return
        // Com as duas partes desligadas não há o que dizer: a conferência do dia é marcada sem ler o funil nem as tarefas.
        if (!settings.tarefas.avisoDiario && !settings.funil.avisarEsfriadas) {
          await deps.marcarAvisoHoje(at)
          return
        }
        const [view, tarefas] = await Promise.all([deps.view(), deps.tarefas()])
        const { devido, ...contagens } = avisoHojeDevido({ tarefas, view, settings, ultimoAvisoHojeEm, now: at, timeZone })
        if (!devido) return
        // Marca antes de avisar: se a gravação falhar, o aviso não sai a cada tick.
        await deps.marcarAvisoHoje(at)
        const aviso = textoAvisoHoje(contagens, settings)
        if (aviso) deps.notify(aviso)
      } catch (error) {
        log(`[tarefas] aviso "Hoje" falhou: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
