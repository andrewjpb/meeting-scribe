// Pedido de `getDisplayMedia` do renderer: só áudio, só da própria origem, vira o áudio do sistema
// (Core Audio Tap, pela saída `loopback`). Mesmo handler provado em prova/main.js (fase 0, teste 1).
import type { Session } from 'electron'
import { originOf } from '../security'

export interface DisplayMediaQuery {
  videoRequested: boolean
  audioRequested: boolean
  /** Origem do frame que pediu, no formato de `originOf`. */
  origin: string | null
}

export function decideDisplayMedia(query: DisplayMediaQuery, appOrigin: string): { audio: 'loopback' } | null {
  const ok = query.videoRequested === false && query.audioRequested === true && query.origin !== null && query.origin === appOrigin
  return ok ? { audio: 'loopback' } : null
}

/** `useSystemPicker: false`: nunca abre o seletor de tela do macOS. */
export function registerDisplayMediaHandler(ses: Session, appOrigin: string): void {
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const origin = originOf(request.frame?.url ?? '') ?? originOf(request.securityOrigin)
      callback(decideDisplayMedia({ videoRequested: request.videoRequested, audioRequested: request.audioRequested, origin }, appOrigin))
    },
    { useSystemPicker: false },
  )
}
