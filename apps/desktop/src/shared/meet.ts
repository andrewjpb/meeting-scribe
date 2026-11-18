// Quem fala no Meet (contrato 27): o que o main manda ao renderer sobre a extensão do Chrome. Só nomes e
// "começou/parou de falar"; o horário que vale é o da chegada no renderer, no relógio da gravação.

/** "Fulano começou (ou parou) de falar", como a extensão viu. `ts` só ordena os eventos de um mesmo envio. */
export interface MeetSpeakingEvent {
  name: string
  speaking: boolean
  ts: number
}

/**
 * Estado da extensão: `connected` enquanto o último envio tem menos de 15 s. No `scribe:meet-changed`, `events`
 * traz só os eventos novos daquele envio; no `scribe:meet-status`, vem sempre vazio.
 */
export interface MeetState {
  connected: boolean
  participants: string[]
  events: MeetSpeakingEvent[]
}

/** "Meet conectado · 3 participantes" na tela de gravação. */
export function meetConnectedLabel(participants: number): string {
  return `Meet conectado · ${participants} ${participants === 1 ? 'participante' : 'participantes'}`
}

/** Adendo 27c: o interruptor está ligado, mas a extensão não manda nada há mais de 15 s (ou nunca mandou). */
export const MEET_DISCONNECTED_LABEL = 'Meet desconectado'
