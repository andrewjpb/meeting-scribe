// Alerta diário do funil (contrato 115, R44, D15): sem IA, no tick que as Automações já fazem a cada 30 s. O primeiro
// tick depois das 09:00 locais confere as oportunidades abertas, grava `ultimoAvisoEm` em `funil.json` (uma
// verificação por dia, com ou sem aviso) e, havendo esfriada ou passo vencido, manda **uma** notificação agrupada.
import type { FunilView } from '../../shared/funil'
import { esfriada, passoVencido } from '../../shared/funil-logic'
import type { FunilSettings } from '../../shared/settings-defaults'
import { diaNoFuso } from './markdown'

/** Hora local a partir da qual o aviso do dia pode sair. */
export const FUNIL_ALERTA_HORA = 9

/** Hora (0 a 23) de um instante no fuso pedido. */
function horaNoFuso(at: number, timeZone: string): number {
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).find((parte) => parte.type === 'hour')?.value
  return Number(hora ?? 0)
}

/**
 * O aviso de hoje é devido? Só com `avisarEsfriadas` ligado, a partir das 09:00 locais e sem verificação ainda hoje
 * (`ultimoAvisoEm` nulo ou de um dia local anterior). Conta as oportunidades abertas e não arquivadas que esfriaram
 * (R7) e as com próximo passo vencido.
 */
export function funilAlertaDevido(input: { view: FunilView; settings: FunilSettings; now: number; timeZone: string }): { devido: boolean; esfriadas: number; vencidas: number } {
  const { view, settings, now, timeZone } = input
  const { state } = view
  const hoje = diaNoFuso(now, timeZone)
  const etapas = new Map(state.etapas.map((etapa) => [etapa.id, etapa]))
  let esfriadas = 0
  let vencidas = 0
  for (const oportunidade of state.oportunidades) {
    const etapa = etapas.get(oportunidade.etapaId)
    if (oportunidade.arquivado || etapa?.tipo !== 'aberta') continue
    const ultima = view.ultimas[oportunidade.id] ?? Math.max(oportunidade.movidoEm, oportunidade.atualizadoEm)
    if (esfriada(oportunidade, etapa, ultima, settings.diasEsfriar, now)) esfriadas++
    if (passoVencido(oportunidade.proximoPasso, hoje)) vencidas++
  }
  return { devido: settings.avisarEsfriadas && podeConferir(state.ultimoAvisoEm, now, timeZone), esfriadas, vencidas }
}

/** A partir das 09:00 locais e sem verificação ainda hoje. */
function podeConferir(ultimoAvisoEm: number | null, now: number, timeZone: string): boolean {
  return horaNoFuso(now, timeZone) >= FUNIL_ALERTA_HORA && (ultimoAvisoEm === null || diaNoFuso(ultimoAvisoEm, timeZone) < diaNoFuso(now, timeZone))
}

/** "2 oportunidades esfriaram, 1 com próximo passo vencido", com o título "Funil". */
export function textoAlerta(esfriadas: number, vencidas: number): { title: string; body: string } {
  const frias = esfriadas === 1 ? '1 oportunidade esfriou' : `${esfriadas} oportunidades esfriaram`
  return { title: 'Funil', body: `${frias}, ${vencidas} com próximo passo vencido` }
}

export interface FunilAlertsDeps {
  view: () => Promise<FunilView>
  /** Só o `ultimoAvisoEm` de `funil.json`, sem montar a view (a checagem barata de cada tick). */
  ultimoAviso: () => Promise<number | null>
  settings: () => Promise<{ funil: FunilSettings }>
  /** Grava `ultimoAvisoEm` em `funil.json` (pelo serviço). */
  marcar: (at: number) => Promise<void>
  notify: (aviso: { title: string; body: string }) => void
  timeZone: () => string
  log?: (message: string) => void
}

export interface FunilAlerts {
  /** Uma conferência (o tick das Automações); nunca lança. */
  tick(at: number): Promise<void>
}

export function createFunilAlerts(deps: FunilAlertsDeps): FunilAlerts {
  const log = deps.log ?? (() => undefined)
  return {
    async tick(at) {
      try {
        // As checagens baratas antes: a view lê os caches de reuniões, email e WhatsApp e o tick é a cada 30 s.
        const { funil } = await deps.settings()
        const timeZone = deps.timeZone()
        if (!funil.avisarEsfriadas || horaNoFuso(at, timeZone) < FUNIL_ALERTA_HORA) return
        if (!podeConferir(await deps.ultimoAviso(), at, timeZone)) return
        const { devido, esfriadas, vencidas } = funilAlertaDevido({ view: await deps.view(), settings: funil, now: at, timeZone })
        if (!devido) return
        // Marca antes de avisar: se a gravação falhar, o aviso não sai a cada tick.
        await deps.marcar(at)
        if (esfriadas + vencidas > 0) deps.notify(textoAlerta(esfriadas, vencidas))
      } catch (error) {
        log(`[funil] alerta diário falhou: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
