// Estado do bloqueio do app (contrato 22). Fica no main: o renderer só pede (bloquear, desbloquear, criar,
// trocar ou remover a senha) e recebe o `LockStatus`. `isLocked()` é síncrono porque o registro do IPC o
// consulta a cada mensagem (`main/ipc.ts`). Bloquear nunca toca a gravação: aqui só muda o estado, o
// título da janela e o que o IPC deixa passar. Sem Electron: Touch ID, configurações e relógio chegam
// injetados (test/lock.test.ts).
import { isValidPassword, lockWaitMs, type LockResponse, type LockResult, type LockStatus } from '../../shared/lock'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings-defaults'
import { hashPassword, SCRYPT_PARAMS, verifyPassword, type ScryptParams } from './password'
import { EMPTY_LOCK_DATA, type LockData, type LockStore } from './store'

/** Por que o app bloqueou; só para o log de desenvolvimento e para o smoke. */
export type LockReason = 'button' | 'shortcut' | 'menu' | 'idle' | 'system' | 'launch'

export interface TouchIdAccess {
  /** `systemPreferences.canPromptTouchID()`. */
  available(): boolean
  /** `systemPreferences.promptTouchID(motivo)`: resolve quando aprovado. */
  prompt(reason: string): Promise<void>
}

export interface LockServiceOptions {
  store: LockStore
  settings: { get(): Promise<AppSettings> }
  touchId: TouchIdAccess
  /** Cada mudança de estado (título da janela, menu e `scribe:lock-state`). */
  onStatus: (status: LockStatus) => void
  now?: () => number
  scrypt?: ScryptParams
  log?: (message: string) => void
}

export interface LockService {
  /** Lê `lock.json`; abre bloqueado se fechou bloqueado ou se "Pedir senha ao abrir" está ligado (CA6). */
  init(): Promise<LockStatus>
  isLocked(): boolean
  status(): Promise<LockStatus>
  /** Bloqueia, se houver como desbloquear depois. Já bloqueado: nada muda. */
  lock(reason: LockReason): Promise<LockStatus>
  unlock(password: unknown): Promise<LockResponse>
  unlockWithTouchId(): Promise<LockResponse>
  /** Criar (`current: null`) ou trocar a senha; trocar pede a atual. */
  setPassword(request: unknown): Promise<LockResponse>
  /** Remover a senha pede a atual. */
  removePassword(request: unknown): Promise<LockResponse>
  /** Uso do app (tecla, clique, movimento), para "Bloquear sozinho depois de …". */
  activity(): void
  /** Chamado de tempos em tempos: bloqueia por falta de uso. */
  tick(): Promise<void>
  /** Configurações mudaram (Touch ID): o estado é reavisado. */
  refresh(): Promise<LockStatus>
}

const TOUCH_ID_REASON = 'desbloquear o app'

export function createLockService({ store, settings, touchId, onStatus, now = Date.now, scrypt = SCRYPT_PARAMS, log }: LockServiceOptions): LockService {
  let data: LockData = { ...EMPTY_LOCK_DATA }
  let lastActivity = now()
  let queue: Promise<unknown> = Promise.resolve()
  /** A última gravação de `lock.json` falhou: o estado vale na memória e a tela de bloqueio avisa. */
  let storageError = false

  // Uma operação por vez: duas tentativas de senha ao mesmo tempo não pulam a contagem de erros.
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const touchIdAvailable = (): boolean => {
    try {
      return touchId.available()
    } catch {
      return false
    }
  }

  /** Configurações ilegíveis valem como os padrões: o bloqueio nunca deixa de responder por causa delas. */
  async function readSettings(): Promise<AppSettings> {
    try {
      return await settings.get()
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async function computeStatus(): Promise<LockStatus> {
    const current = await readSettings()
    const hasPassword = data.password !== null
    return {
      locked: data.locked,
      hasPassword,
      touchIdAvailable: touchIdAvailable(),
      // O Touch ID é só um atalho da senha: sem senha, nem bloqueia nem desbloqueia. O botão aparece com o
      // interruptor ligado, mesmo que o Mac não o ofereça agora (a tela pede para usar a senha).
      touchIdEnabled: hasPassword && current.lockUseTouchId,
      canLock: hasPassword,
      retryInMs: data.retryAt === null ? 0 : Math.max(0, data.retryAt - now()),
      storageError,
    }
  }

  /**
   * A memória muda primeiro: bloquear e contar um erro valem mesmo se `lock.json` não puder ser gravado (a falha
   * vira aviso). Senha nova ou removida que não foi gravada volta atrás e devolve falso.
   */
  async function save(next: LockData, revertOnFailure = false): Promise<boolean> {
    const previous = data
    data = next
    try {
      await store.write(next)
      storageError = false
      return true
    } catch {
      storageError = true
      console.warn('[lock] não foi possível gravar lock.json')
      if (revertOnFailure) data = previous
      return false
    }
  }

  async function announce(): Promise<LockStatus> {
    const status = await computeStatus()
    onStatus(status)
    return status
  }

  async function respond(result: LockResult): Promise<LockResponse> {
    return { result, status: await announce() }
  }

  /** Senha errada: conta o erro e, do 5º em diante, a espera. */
  async function countFailure(): Promise<void> {
    const failures = data.failures + 1
    const wait = lockWaitMs(failures)
    await save({ ...data, failures, retryAt: wait > 0 ? now() + wait : null })
  }

  const waiting = (): boolean => data.retryAt !== null && now() < data.retryAt

  async function unlocked(): Promise<LockResponse> {
    await save({ ...data, locked: false, failures: 0, retryAt: null })
    lastActivity = now()
    log?.('[lock] desbloqueado')
    return respond('ok')
  }

  /** Confere a senha atual com a contagem de erros; `null` quando confere. */
  async function checkCurrent(password: unknown): Promise<LockResult | null> {
    if (!data.password) return 'unavailable'
    if (waiting()) return 'wait'
    if (typeof password !== 'string' || !(await verifyPassword(password, data.password))) {
      await countFailure()
      return 'wrong'
    }
    return null
  }

  async function doLock(reason: LockReason): Promise<LockStatus> {
    if (data.locked) return computeStatus()
    const status = await computeStatus()
    if (!status.canLock) return status
    await save({ ...data, locked: true })
    log?.(`[lock] bloqueado (${reason})`)
    return announce()
  }

  return {
    init: () =>
      serial(async () => {
        // Nunca derruba a inicialização: se algo falhar, abre bloqueado quando havia senha.
        try {
          data = await store.read()
          const current = await readSettings()
          // Sem senha (apagada à mão com o app fechado), o app não abre preso.
          if (data.password === null && data.locked) await save({ ...data, locked: false })
          else if (data.password !== null && !data.locked && current.lockOnLaunch) await save({ ...data, locked: true })
        } catch (error) {
          console.warn(`[lock] falha ao abrir o bloqueio: ${error instanceof Error ? error.message : String(error)}`)
          storageError = true
          if (data.password !== null) data = { ...data, locked: true }
        }
        lastActivity = now()
        return computeStatus()
      }),
    isLocked: () => data.locked,
    status: () => serial(computeStatus),
    lock: (reason) => serial(() => doLock(reason)),
    unlock: (password) =>
      serial(async () => {
        if (!data.locked) return respond('ok')
        if (!data.password) return respond('unavailable')
        if (waiting()) return respond('wait')
        if (typeof password !== 'string' || password.length === 0) return respond('wrong')
        if (!(await verifyPassword(password, data.password))) {
          await countFailure()
          return respond('wrong')
        }
        return unlocked()
      }),
    unlockWithTouchId: () =>
      serial(async () => {
        if (!data.locked) return respond('ok')
        const status = await computeStatus()
        if (!status.touchIdEnabled) return respond('unavailable')
        try {
          await touchId.prompt(TOUCH_ID_REASON)
        } catch {
          return respond('touch-id-failed')
        }
        return unlocked()
      }),
    setPassword: (request) =>
      serial(async () => {
        if (data.locked) return respond('unavailable')
        const { current, next } = (typeof request === 'object' && request !== null ? request : {}) as { current?: unknown; next?: unknown }
        if (!isValidPassword(next)) return respond('invalid')
        if (data.password) {
          const refused = await checkCurrent(current)
          if (refused) return respond(refused)
        }
        const saved = await save({ ...data, password: await hashPassword(next, scrypt), failures: 0, retryAt: null }, true)
        return respond(saved ? 'ok' : 'unavailable')
      }),
    removePassword: (request) =>
      serial(async () => {
        if (data.locked) return respond('unavailable')
        const { current } = (typeof request === 'object' && request !== null ? request : {}) as { current?: unknown }
        const refused = await checkCurrent(current)
        if (refused) return respond(refused)
        const saved = await save({ ...data, password: null, failures: 0, retryAt: null }, true)
        return respond(saved ? 'ok' : 'unavailable')
      }),
    activity: () => {
      if (!data.locked) lastActivity = now()
    },
    tick: () =>
      serial(async () => {
        if (data.locked) return
        const minutes = (await readSettings()).lockAfterMinutes
        if (minutes > 0 && now() - lastActivity >= minutes * 60_000) await doLock('idle')
      }),
    refresh: () => serial(announce),
  }
}
