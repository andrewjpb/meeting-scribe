// Tarefas (contrato 122, R12, D6, D7): o que a notificação de uma tarefa mostra com o app bloqueado e o destino do
// "Abrir" guardado no main enquanto o app está bloqueado. Puro: `index.ts` liga ao `Notification`, ao bloqueio e ao
// envio do `scribe:open-tarefa`; o renderer não guarda nada, só navega quando recebe o evento já desbloqueado.
import type { AvisoTarefa } from '../../shared/tarefas'

/** Corpo da notificação com o app bloqueado: nada do título da tarefa. */
export const AVISO_BLOQUEADO_TEXTO = 'Você tem uma tarefa com lembrete'

/** Desbloqueado, o aviso como veio; bloqueado, só a marca e o texto fixo (o id fica para o "Abrir"). */
export function avisoMostrado(aviso: AvisoTarefa, bloqueado: boolean, marca: string): AvisoTarefa {
  return bloqueado ? { title: marca, body: AVISO_BLOQUEADO_TEXTO, tarefaId: aviso.tarefaId } : aviso
}

export interface DestinoPendente {
  /** Desbloqueado, envia na hora; bloqueado, guarda só o último destino e não envia. */
  abrir(id: string | null, bloqueado: boolean, enviar: (id: string | null) => void): void
  /** O app desbloqueou: envia o destino guardado uma vez e o esquece; sem destino, nada. */
  desbloqueou(enviar: (id: string | null) => void): void
}

export function createDestinoPendente(): DestinoPendente {
  /** `undefined` = nada guardado (`null` é um destino: a lista). */
  let pendente: { id: string | null } | undefined
  return {
    abrir(id, bloqueado, enviar) {
      if (bloqueado) {
        pendente = { id }
        return
      }
      pendente = undefined
      enviar(id)
    },
    desbloqueou(enviar) {
      if (pendente === undefined) return
      const { id } = pendente
      pendente = undefined
      enviar(id)
    },
  }
}
