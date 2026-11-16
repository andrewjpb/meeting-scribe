// Permissão de microfone do macOS para a barra lateral. `getMediaAccessStatus` só consulta (sem diálogo,
// fase 0, teste 9); `askForMediaAccess` abre o pedido do macOS e só roda quando o usuário clica em
// "Permitir". `systemPreferences` chega injetado: o smoke usa um substituto e nunca abre diálogo.
import type { MicAccess } from '../shared/assemblyai'

export interface MediaAccessApi {
  getMediaAccessStatus(mediaType: 'microphone'): string
  askForMediaAccess(mediaType: 'microphone'): Promise<boolean>
}

/** `restricted` (controle parental, MDM) é negado para quem usa: só os Ajustes resolvem. */
export function normalizeMicAccess(status: string): MicAccess {
  if (status === 'granted') return 'granted'
  if (status === 'denied' || status === 'restricted') return 'denied'
  return 'not-determined'
}

export interface MicPermissions {
  status(): MicAccess
  /** Pede ao macOS; só pede de fato em `not-determined` (nos outros o macOS nem pergunta). */
  request(): Promise<MicAccess>
}

export function createMicPermissions(api: MediaAccessApi | null): MicPermissions {
  // Fora do macOS não há o que pedir: o Chromium cuida no `getUserMedia`.
  if (!api) return { status: () => 'granted', request: () => Promise.resolve('granted') }
  const status = (): MicAccess => {
    try {
      return normalizeMicAccess(api.getMediaAccessStatus('microphone'))
    } catch {
      return 'not-determined'
    }
  }
  return {
    status,
    async request() {
      if (status() !== 'not-determined') return status()
      try {
        await api.askForMediaAccess('microphone')
      } catch {
        // O estado relido abaixo diz o que aconteceu.
      }
      return status()
    },
  }
}

/** Substituto do smoke: começa em `not-determined` e "Permitir" concede, sem diálogo. */
export function fakeMediaAccess(initial: string = 'not-determined'): MediaAccessApi & { set(status: string): void; asked: number } {
  let current = initial
  const fake = {
    asked: 0,
    set(status: string) {
      current = status
    },
    getMediaAccessStatus: () => current,
    askForMediaAccess: () => {
      fake.asked++
      if (current === 'not-determined') current = 'granted'
      return Promise.resolve(current === 'granted')
    },
  }
  return fake
}
