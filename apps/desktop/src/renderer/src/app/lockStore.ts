// Bloqueio do app no renderer (contrato 22): cópia do estado que o main mantém. A senha digitada vai direto
// ao main e não fica guardada aqui; nenhuma resposta traz a senha nem o hash. ⌘⇧L bloqueia e o uso do app
// (tecla, clique, movimento) vai ao main no máximo a cada 15 s, para "Bloquear sozinho depois de …".
import { useEffect } from 'react'
import { create } from 'zustand'
import { isLockedError, LOCK_STATUS_INITIAL, type LockResponse, type LockResult, type LockStatus } from '@shared/lock'

interface LockState {
  status: LockStatus
  /** Fim da espera depois dos erros, no relógio desta janela; 0 sem espera. */
  retryUntil: number
  lock: () => Promise<void>
  unlock: (password: string) => Promise<LockResult>
  touchId: () => Promise<LockResult>
  setPassword: (current: string | null, next: string) => Promise<LockResult>
  removePassword: (current: string) => Promise<LockResult>
}

const ACTIVITY_THROTTLE_MS = 15_000

const fromStatus = (status: LockStatus): Pick<LockState, 'status' | 'retryUntil'> => ({
  status,
  retryUntil: status.retryInMs > 0 ? Date.now() + status.retryInMs : 0,
})

/** Resposta do main (ou falha da chamada, que não muda nada e conta como pedido recusado). */
async function ask(call: () => Promise<LockResponse>): Promise<LockResult> {
  try {
    const { result, status } = await call()
    useLock.setState(fromStatus(status))
    return result
  } catch {
    return 'unavailable'
  }
}

export const useLock = create<LockState>()(() => ({
  ...fromStatus(LOCK_STATUS_INITIAL),
  lock: async () => {
    try {
      useLock.setState(fromStatus(await window.__scribeApi.invoke('scribe:lock-now')))
    } catch {
      // Nada a fazer: o app continua como estava.
    }
  },
  unlock: (password) => ask(() => window.__scribeApi.invoke('scribe:lock-unlock', { password })),
  touchId: () => ask(() => window.__scribeApi.invoke('scribe:lock-touch-id')),
  setPassword: (current, next) => ask(() => window.__scribeApi.invoke('scribe:lock-password-set', { current, next })),
  removePassword: (current) => ask(() => window.__scribeApi.invoke('scribe:lock-password-remove', { current })),
}))

// O foco de antes do bloqueio volta no desbloqueio (CA5: a tela volta exatamente onde estava). Guardado na
// mudança do estado, antes de o React marcar o resto do app como `inert` (o que tira o foco dele).
let focusBeforeLock: HTMLElement | null = null
useLock.subscribe((state, previous) => {
  if (typeof document === 'undefined') return
  if (state.status.locked && !previous.status.locked) {
    focusBeforeLock = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  } else if (!state.status.locked && previous.status.locked) {
    const target = focusBeforeLock
    focusBeforeLock = null
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true })
    })
  }
})

/** Roda `run` agora, se o app está desbloqueado, ou no próximo desbloqueio. Devolve como desistir. */
export function whenUnlocked(run: () => void): () => void {
  if (!useLock.getState().status.locked) {
    run()
    return () => undefined
  }
  const off = useLock.subscribe((state) => {
    if (state.status.locked) return
    off()
    run()
  })
  return off
}

/**
 * Leitura que o main recusou com `locked` (contrato 22): marca "reler ao desbloquear" e relê no desbloqueio, sem
 * mostrar erro. Devolve como desistir (tela fechada antes), ou `null` se o erro era outro.
 */
export function rereadWhenUnlocked(error: unknown, reread: () => void): (() => void) | null {
  if (!isLockedError(error)) return null
  return whenUnlocked(reread)
}

/** Lê o estado antes do primeiro quadro: aberto já bloqueado (CA6), nada da tela aparece antes da camada. */
export async function loadLockStatus(): Promise<void> {
  try {
    useLock.setState(fromStatus(await window.__scribeApi.invoke('scribe:lock-status')))
  } catch {
    // Sem resposta, o main continua recusando o conteúdo se estiver bloqueado; a próxima mudança chega por evento.
  }
}

/** ⌘⇧L sem outro modificador. */
export function isLockShortcut(event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>): boolean {
  return event.code === 'KeyL' && event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey
}

/** Acompanha o main, manda o uso do app e atende ⌘⇧L (o item do menu tem o mesmo atalho). */
export function useLockSync(): void {
  useEffect(() => window.__scribeApi.on('scribe:lock-state', (status) => useLock.setState(fromStatus(status))), [])

  useEffect(() => {
    let last = 0
    const onUse = (): void => {
      const now = Date.now()
      if (now - last < ACTIVITY_THROTTLE_MS || useLock.getState().status.locked) return
      last = now
      window.__scribeApi.send('scribe:lock-activity', undefined)
    }
    const onKey = (event: KeyboardEvent): void => {
      onUse()
      if (!isLockShortcut(event) || event.repeat) return
      event.preventDefault()
      if (!useLock.getState().status.locked) void useLock.getState().lock()
    }
    const events = ['pointerdown', 'pointermove', 'wheel'] as const
    for (const name of events) window.addEventListener(name, onUse, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      for (const name of events) window.removeEventListener(name, onUse)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
