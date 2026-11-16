// Estado da atualização no main (contrato 14). Procura 30 s depois de abrir e a cada 6 h (com
// "Procurar atualizações automaticamente" ligado) e pelo botão. Erro e falta de internet não aparecem:
// só vão para o log de desenvolvimento. "Atualizar" baixa, confere, abre o `.dmg` e espera a pessoa
// fechar o app pelo botão: o main nunca sai sozinho.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateState } from '../../shared/updates'
import { UPDATE_DOWNLOAD_FAILED_MESSAGE, UPDATE_HASH_MISMATCH_MESSAGE } from '../../shared/updates'
import type { FetchLike } from '../assemblyai/gateway'
import { downloadRelease, type DownloadRequest } from './download'
import { checkLatestRelease, type UpdateRelease } from './release'

export const FIRST_CHECK_DELAY_MS = 30_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdateTimers {
  setTimeout(callback: () => void, ms: number): unknown
  setInterval(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: UpdateTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as NodeJS.Timeout)
    clearInterval(handle as NodeJS.Timeout)
  },
}

export interface UpdateServiceOptions {
  currentVersion: string
  fetch: FetchLike
  request: DownloadRequest
  downloadsDir: string
  /** `shell.openPath`: devolve texto vazio quando abriu. */
  openPath: (path: string) => Promise<string>
  /** `app.quit()`; só pelo botão "Fechar o app agora". */
  quit: () => void
  /** "Procurar atualizações automaticamente". */
  autoCheck: () => Promise<boolean>
  onState: (state: UpdateState) => void
  log?: (message: string) => void
  now?: () => number
  timers?: UpdateTimers
  /** Prazo sem dados no download; só os testes trocam. */
  idleTimeoutMs?: number
}

export interface UpdateService {
  state(): UpdateState
  /** Agenda a primeira consulta (30 s) e as seguintes (6 h). */
  start(): void
  /** "Procurar atualização": consulta agora, mesmo com a opção automática desligada. */
  check(): Promise<UpdateState>
  /** "Atualizar" / "Baixar e instalar": começa e responde na hora; o andamento chega por `onState`. */
  download(): UpdateState
  /** Resolve quando o download em curso termina (testes e smoke). */
  idle(): Promise<void>
  quit(): boolean
  dispose(): void
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const { currentVersion, fetch, request, downloadsDir, openPath, quit, autoCheck, onState, log, now = Date.now, timers = realTimers, idleTimeoutMs } = options
  let state: UpdateState = { currentVersion, checking: false, lastCheckedAt: null, available: null, download: { phase: 'idle' } }
  let release: UpdateRelease | null = null
  let checking: Promise<UpdateState> | null = null
  let downloading: Promise<void> | null = null
  /** Cancela o download em curso (saída do app). */
  let cancel: AbortController | null = null
  let partPath: string | null = null
  const handles: unknown[] = []

  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch }
    onState(state)
  }

  function check(): Promise<UpdateState> {
    if (checking) return checking
    set({ checking: true })
    checking = checkLatestRelease(fetch, currentVersion)
      .then((result) => {
        if (result.kind === 'error') {
          log?.(`[updates] consulta falhou: ${result.reason}`)
          set({ checking: false })
          return state
        }
        const checkedAt = new Date(now()).toISOString()
        if (result.kind === 'none') {
          log?.(`[updates] nenhuma versão nova: ${result.reason}`)
          // Um download em curso ou pronto continua valendo; sem ele, some o aviso.
          if (state.download.phase === 'idle' || state.download.phase === 'failed') {
            release = null
            set({ checking: false, lastCheckedAt: checkedAt, available: null, download: { phase: 'idle' } })
          } else set({ checking: false, lastCheckedAt: checkedAt })
          return state
        }
        const changed = release?.version !== result.release.version
        // Versão diferente da que já estava baixando ou pronta: recomeça do zero.
        if (changed && (state.download.phase === 'downloading' || state.download.phase === 'ready')) {
          set({ checking: false, lastCheckedAt: checkedAt })
          return state
        }
        release = result.release
        set({
          checking: false,
          lastCheckedAt: checkedAt,
          available: { version: result.release.version, notes: result.release.notes },
          ...(changed ? { download: { phase: 'idle' as const } } : {}),
        })
        return state
      })
      .finally(() => {
        checking = null
      })
    return checking
  }

  async function runDownload(target: UpdateRelease, signal: AbortSignal): Promise<void> {
    const outcome = await downloadRelease({
      request,
      release: target,
      currentVersion,
      downloadsDir,
      signal,
      ...(idleTimeoutMs ? { idleTimeoutMs } : {}),
      onProgress: (percent) => {
        if (state.download.phase === 'downloading') set({ download: { phase: 'downloading', percent } })
      },
    })
    if (!outcome.ok && outcome.reason === 'cancelled') {
      log?.('[updates] download cancelado na saída do app')
      set({ download: { phase: 'idle' } })
      return
    }
    if (!outcome.ok) {
      log?.(`[updates] download falhou (${outcome.reason}): ${outcome.detail}`)
      set({ download: { phase: 'failed', message: outcome.reason === 'hash' ? UPDATE_HASH_MISMATCH_MESSAGE : UPDATE_DOWNLOAD_FAILED_MESSAGE } })
      return
    }
    const error = await openPath(outcome.path).catch((reason: unknown) => (reason instanceof Error ? reason.message : String(reason)))
    if (error) {
      log?.(`[updates] não abriu ${outcome.path}: ${error}`)
      set({ download: { phase: 'failed', message: UPDATE_DOWNLOAD_FAILED_MESSAGE } })
      return
    }
    set({ download: { phase: 'ready' } })
  }

  return {
    state: () => state,
    start() {
      const scheduled = (): void => {
        void autoCheck()
          .then((enabled) => (enabled ? check() : undefined))
          .catch(() => undefined)
      }
      handles.push(timers.setTimeout(scheduled, FIRST_CHECK_DELAY_MS))
      handles.push(timers.setInterval(scheduled, CHECK_INTERVAL_MS))
    },
    check,
    download() {
      const target = release
      // Já baixado e aberto: o `.dmg` está em Downloads; não baixa de novo.
      if (!target || downloading || state.download.phase === 'downloading' || state.download.phase === 'ready') return state
      set({ download: { phase: 'downloading', percent: 0 } })
      cancel = new AbortController()
      partPath = join(downloadsDir, `${target.dmg.name}.part`)
      downloading = runDownload(target, cancel.signal)
        .catch((error: unknown) => {
          log?.(`[updates] download: ${error instanceof Error ? error.message : String(error)}`)
          set({ download: { phase: 'failed', message: UPDATE_DOWNLOAD_FAILED_MESSAGE } })
        })
        .finally(() => {
          downloading = null
          cancel = null
          partPath = null
        })
      return state
    },
    idle: () => downloading ?? Promise.resolve(),
    quit() {
      if (state.download.phase !== 'ready') return false
      quit()
      return true
    },
    /** Saída do app: para o agendamento e cancela o download em curso (o `.part` é apagado). */
    dispose() {
      for (const handle of handles.splice(0)) timers.clear(handle)
      if (!cancel) return
      cancel.abort()
      // O app pode sair antes de o cancelamento assíncrono apagar o `.part`: apaga aqui também, na hora.
      if (partPath) rmSync(partPath, { force: true })
    },
  }
}
