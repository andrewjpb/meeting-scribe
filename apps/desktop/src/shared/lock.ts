// Bloqueio do app (contrato 22): tela fosca com a senha do app ou o Touch ID. O bloqueio é do app, não do
// macOS: a gravação, a transcrição, a tradução e as análises em curso continuam. A senha só existe no main,
// como hash scrypt em `userData/lock.json`; nenhum tipo daqui carrega a senha de volta ao renderer.

/** Erro com que o main recusa um canal de conteúdo enquanto o app está bloqueado (CA4). */
export const LOCKED_ERROR = 'locked'

/** Senha do app: de 4 a 64 caracteres (contados como o usuário vê, não em bytes). */
export const LOCK_PASSWORD_MIN = 4
export const LOCK_PASSWORD_MAX = 64

/** Erros seguidos antes da primeira espera (CA5). */
export const LOCK_FREE_ATTEMPTS = 5
/** Espera depois do 5º erro seguido, do 6º, do 7º…; daí em diante fica na última. */
export const LOCK_WAIT_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000] as const

/** O que o renderer sabe do bloqueio. Nada sobre a senha além de existir ou não. */
export interface LockStatus {
  locked: boolean
  hasPassword: boolean
  /** O Mac tem Touch ID (`systemPreferences.canPromptTouchID()`). */
  touchIdAvailable: boolean
  /** "Usar Touch ID" ligado e há senha (o Touch ID é só um atalho dela). */
  touchIdEnabled: boolean
  /** Há senha para desbloquear depois: sem ela o botão "Bloquear" fica desabilitado. */
  canLock: boolean
  /** Espera depois de erros seguidos; 0 quando dá para tentar agora. */
  retryInMs: number
  /** A última gravação de `lock.json` falhou (o bloqueio vale, mas pode não sobreviver a reabrir o app). */
  storageError: boolean
}

/**
 * Resultado de desbloquear, criar, trocar ou remover a senha. `wrong`: senha (ou senha atual) incorreta;
 * `wait`: ainda na espera; `invalid`: fora de 4 a 64 caracteres; `touch-id-failed`: o Touch ID não aprovou;
 * `unavailable`: o pedido não vale agora (sem senha para remover, Touch ID desligado…).
 */
export type LockResult = 'ok' | 'wrong' | 'wait' | 'invalid' | 'touch-id-failed' | 'unavailable'

export interface LockResponse {
  result: LockResult
  status: LockStatus
}

export const LOCK_STATUS_INITIAL: Readonly<LockStatus> = Object.freeze({
  locked: false,
  hasPassword: false,
  touchIdAvailable: false,
  touchIdEnabled: false,
  canLock: false,
  retryInMs: 0,
  storageError: false,
})

/** Tamanho da senha em caracteres (um emoji conta como um). */
export function passwordLength(value: string): number {
  return [...value].length
}

export function isValidPassword(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const length = passwordLength(value)
  return length >= LOCK_PASSWORD_MIN && length <= LOCK_PASSWORD_MAX
}

/** Espera depois de `failures` erros seguidos; 0 antes do 5º. */
export function lockWaitMs(failures: number): number {
  if (failures < LOCK_FREE_ATTEMPTS) return 0
  const step = Math.min(failures - LOCK_FREE_ATTEMPTS, LOCK_WAIT_STEPS_MS.length - 1)
  return LOCK_WAIT_STEPS_MS[step] ?? 0
}

/** Recusa do main por causa do bloqueio (o `invoke` rejeita com "Error invoking remote method …: Error: locked"). */
export function isLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message === LOCKED_ERROR || message.endsWith(`Error: ${LOCKED_ERROR}`)
}

/** Contagem da espera na tela: "0:30", "4:59", "1:00:00". */
export function retryLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** Título da janela com o app bloqueado (CA4). */
export function lockedWindowTitle(brandName: string): string {
  return `${brandName} — bloqueado`
}

/** "Esqueci a senha" (CA5): o app não oferece atalho para apagar a senha. */
export const LOCK_FORGOT_TEXT =
  'Feche o app e apague o arquivo lock.json em ~/Library/Application Support/Meeting Scribe. Isso remove a senha e não apaga nenhuma reunião. Com o app aberto não adianta: ele grava o arquivo de novo.'

/** Dica do botão "Bloquear" sem senha (CA1). */
export const LOCK_DISABLED_HINT = 'Crie uma senha em Configurações › Geral'

/** Touch ID que não confirmou ou não está disponível agora. */
export const TOUCH_ID_FAILED_TEXT = 'Touch ID indisponível agora. Use a senha.'

/** `lock.json` não pôde ser gravado. */
export const LOCK_STORAGE_ERROR_TEXT = 'Não foi possível gravar o bloqueio neste Mac. Ele vale enquanto o app estiver aberto.'
