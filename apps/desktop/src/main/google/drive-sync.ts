// Fila de envio ao Google Drive (contrato 11, CA4 e CA5). Roda no main, um envio por vez, inclusive com o app
// bloqueado (contrato 22), e fica em `userData/drive-queue.json` com os ids do Drive (pasta "LAP Reuniões",
// subpasta e arquivo de cada reunião): reabrir o app continua de onde parou. Entra ao encerrar (áudio e
// transcrição) e quando o resumo fica pronto ou é gerado de novo; o resumo novo substitui o anterior no Drive
// (o mesmo id). Sem internet, 5xx ou 429: tenta de novo com espera crescente (30 s, 2 min, 10 min, 30 min, depois
// de hora em hora). 401 renova o token uma vez; pasta apagada (403/404) é recriada. Excluir a reunião no app não
// apaga nada do Drive. Nenhum token vai para o arquivo: o endereço da sessão de upload fica só na memória.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DRIVE_FILE_KINDS,
  DRIVE_FOLDER_URL_PREFIX,
  DRIVE_ID_PATTERN,
  DRIVE_ROOT_FOLDER_NAME,
  type DriveErrorReason,
  type DriveFileKind,
  type DriveMeetingStatus,
} from '../../shared/accounts'
import type { HttpFetch } from '../accounts/http'
import { guardedFetch } from '../accounts/http'
import { AccountError, type GoogleAccountService } from './account'
import { createDriveClient, DriveError, type UploadSession } from './drive'
import { meetingUpload, MissingFileError, type DriveFilesDeps } from './drive-files'

export const DRIVE_QUEUE_FILE = 'drive-queue.json'
/** Espera antes de cada nova tentativa; depois da última, de hora em hora. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000] as const
/** Espera depois de entrar na fila: o "Encerrar" grava a transcrição, as anotações e o áudio em sequência. */
export const ENQUEUE_DELAY_MS = 2_000

const meetingIdSchema = z.string().min(1).max(200)
const driveIdSchema = z.string().regex(DRIVE_ID_PATTERN)
const kindSchema = z.enum(DRIVE_FILE_KINDS)
const itemSchema = z.object({
  meetingId: meetingIdSchema,
  kinds: z.array(kindSchema).min(1),
  attempts: z.number().int().min(0),
  /** `null`: parado até "Tentar de novo" ou o próximo login. */
  nextAt: z.number().nullable(),
  error: z.enum(['offline', 'session', 'missing', 'quota', 'refused', 'server']).nullable(),
})
type QueueItem = z.infer<typeof itemSchema>
const recordSchema = z.object({
  folderId: driveIdSchema.nullable(),
  files: z.partialRecord(kindSchema, driveIdSchema),
  /** Já foi inteira para o Drive ao menos uma vez ("No Drive"). */
  sent: z.boolean(),
})
type MeetingRecord = z.infer<typeof recordSchema>
const fileSchema = z.object({
  version: z.literal(1),
  /** E-mail da conta dos ids abaixo; outra conta começa do zero. */
  account: z.string().nullable(),
  rootFolderId: driveIdSchema.nullable(),
  meetings: z.record(z.string(), recordSchema),
  queue: z.array(itemSchema),
})
type QueueFile = z.infer<typeof fileSchema>

const emptyFile = (): QueueFile => ({ version: 1, account: null, rootFolderId: null, meetings: {}, queue: [] })

interface Progress {
  item: QueueItem
  sent: number
  total: number
  percent: number
}

export interface DriveTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DriveSyncDeps {
  /** `userData`. */
  dir: string
  account: Pick<GoogleAccountService, 'accessToken' | 'signedIn' | 'email' | 'markExpired'>
  /** "Guardar no Google Drive" ligado. */
  enabled: () => Promise<boolean>
  files: DriveFilesDeps
  fetch: HttpFetch
  onStatus: (meetingId: string, status: DriveMeetingStatus) => void
  now?: () => number
  timers?: DriveTimers
  enqueueDelayMs?: number
  log?: (message: string) => void
}

export interface DriveSyncService {
  /** Entra na fila (ou junta com o que já está esperando). Sem conta ou com o interruptor desligado: nada. */
  enqueue(meetingId: string, kinds: readonly DriveFileKind[]): Promise<void>
  status(meetingId: unknown): DriveMeetingStatus
  /** "Tentar de novo": volta para a fila agora. */
  retry(meetingId: unknown): DriveMeetingStatus
  /** "Abrir no Drive": a pasta da reunião; `null` sem pasta. */
  folderUrl(meetingId: unknown): string | null
  /** Ícone de nuvem na lista. */
  inDrive(meetingId: string): boolean
  /** Login bom: outra conta zera os ids; a fila parada por sessão expirada volta a andar. */
  signedIn(email: string): void
  /** "Sair" ou "Guardar no Google Drive" desligado: a fila esvazia (o que já foi fica no Drive). */
  clear(): void
  /** Começa (ou retoma) a fila. */
  start(): void
  /** Testes: roda tudo que estiver vencido agora, um por vez. */
  flush(): Promise<void>
  dispose(): void
}

export function createDriveSync(deps: DriveSyncDeps): DriveSyncService {
  const now = deps.now ?? Date.now
  const timers: DriveTimers = deps.timers ?? {
    setTimeout: (callback, ms) => {
      const handle = setTimeout(callback, ms)
      handle.unref?.()
      return handle
    },
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const enqueueDelay = deps.enqueueDelayMs ?? ENQUEUE_DELAY_MS
  const path = join(deps.dir, DRIVE_QUEUE_FILE)
  const drive = createDriveClient(guardedFetch(deps.fetch), () => deps.account.accessToken())
  const state = load()
  /** Sessões de upload que caíram no meio, por reunião e tipo: a próxima tentativa continua de onde parou. */
  const sessions = new Map<string, UploadSession>()
  let running: Progress | null = null
  let current: Promise<void> | null = null
  let timer: unknown = null
  let disposed = false

  function load(): QueueFile {
    if (!existsSync(path)) return emptyFile()
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      return parsed.success ? parsed.data : emptyFile()
    } catch {
      return emptyFile()
    }
  }

  function persist(): void {
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      renameSync(temp, path)
    } catch {
      rmSync(temp, { force: true })
      deps.log?.('[drive] não foi possível gravar a fila')
    }
  }

  const record = (meetingId: string): MeetingRecord => (state.meetings[meetingId] ??= { folderId: null, files: {}, sent: false })

  function status(meetingId: string): DriveMeetingStatus {
    if (running?.item.meetingId === meetingId) return { state: 'uploading', percent: running.percent }
    const pending = state.queue.find((item) => item.meetingId === meetingId)
    if (pending) {
      if (pending.error === 'offline') return { state: 'offline' }
      if (pending.error) return { state: 'error', reason: pending.error }
      return { state: 'uploading', percent: 0 }
    }
    return state.meetings[meetingId]?.sent ? { state: 'done' } : { state: 'hidden' }
  }

  const announce = (meetingId: string): void => deps.onStatus(meetingId, status(meetingId))

  function schedule(): void {
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    if (disposed || running) return
    const due = state.queue.filter((item) => item.nextAt !== null).map((item) => item.nextAt as number)
    if (!due.length) return
    timer = timers.setTimeout(() => {
      timer = null
      void pump()
    }, Math.max(0, Math.min(...due) - now()))
  }

  const delayAfter = (attempts: number): number => RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1] ?? 60 * 60_000

  /** Envia os arquivos da reunião; `false` quando a reunião não existe mais. */
  async function send(item: QueueItem, progress: Progress): Promise<boolean> {
    const upload = await meetingUpload(deps.files, item.meetingId, item.kinds)
    if (!upload) return false
    progress.total = upload.files.reduce((total, file) => total + file.source.size, 0)
    const entry = record(item.meetingId)
    let rootChecked = false
    let folderChecked = false
    /** Onde o último pedido estava: um 403/404 ali faz recriar aquela pasta (ou enviar o arquivo como novo). */
    let phase: 'root' | 'folder' | 'file' = 'root'

    const ensureRoot = async (): Promise<string> => {
      if (rootChecked && state.rootFolderId) return state.rootFolderId
      phase = 'root'
      if (!state.rootFolderId || !(await drive.folderExists(state.rootFolderId))) {
        // Apagada no Drive (ou nunca criada): procura a do app pelo nome, senão cria de novo.
        state.rootFolderId = (await drive.findByName(DRIVE_ROOT_FOLDER_NAME, 'root', true)) ?? (await drive.createFolder(DRIVE_ROOT_FOLDER_NAME, 'root'))
        persist()
      }
      rootChecked = true
      return state.rootFolderId
    }

    const ensureFolder = async (): Promise<string> => {
      const root = await ensureRoot()
      if (folderChecked && entry.folderId) return entry.folderId
      phase = 'folder'
      if (!entry.folderId || !(await drive.folderExists(entry.folderId))) {
        entry.folderId = (await drive.findByName(upload.base, root, true)) ?? (await drive.createFolder(upload.base, root))
        // Pasta nova: os arquivos da antiga ficaram para trás.
        entry.files = {}
        persist()
      }
      folderChecked = true
      return entry.folderId
    }

    let done = 0
    for (const { kind, source } of upload.files) {
      const key = `${item.meetingId}:${kind}`
      for (let round = 0; ; round++) {
        try {
          // As pastas também ficam aqui dentro: os erros delas seguem as mesmas regras de nova tentativa e recriação.
          const folder = await ensureFolder()
          phase = 'file'
          const fileId = entry.files[kind] ?? (await drive.findByName(source.name, folder, false))
          const id = await drive.upload({
            source,
            parent: folder,
            fileId,
            session: sessions.get(key) ?? null,
            onSession: (session) => (session ? sessions.set(key, session) : sessions.delete(key)),
            onBytes: (sent) => {
              progress.sent = done + sent
              const percent = progress.total ? Math.min(99, Math.floor((progress.sent / progress.total) * 100)) : 0
              if (percent !== progress.percent) {
                progress.percent = percent
                announce(item.meetingId)
              }
            },
          })
          entry.files[kind] = id
          persist()
          break
        } catch (error) {
          // Arquivo ou pasta apagados no Drive (404, ou 403 da pasta): confere tudo de novo, recria o que faltar
          // e envia como arquivo novo. Uma vez só.
          if (round === 0 && error instanceof DriveError && (error.kind === 'not-found' || (error.kind === 'refused' && error.status === 403))) {
            // `phase` muda dentro de `ensureRoot`/`ensureFolder`; o TypeScript só vê a última atribuição daqui.
            const where = phase as 'root' | 'folder' | 'file'
            if (where === 'root') state.rootFolderId = null
            if (where === 'root' || where === 'folder') {
              // Sem acesso à pasta guardada (403) ou ela sumiu: a próxima volta procura pelo nome ou cria outra.
              entry.folderId = null
              entry.files = {}
            } else entry.files = Object.fromEntries(Object.entries(entry.files).filter(([name]) => name !== kind))
            sessions.delete(key)
            rootChecked = false
            folderChecked = false
            continue
          }
          throw error
        }
      }
      done += source.size
    }
    if (upload.files.length) entry.sent = true
    return true
  }

  /** Erro do envio: a fila tenta de novo mais tarde ou para até a pessoa agir. */
  function fail(item: QueueItem, error: unknown): void {
    let reason: DriveErrorReason | 'offline'
    let transient: boolean
    if (error instanceof AccountError) {
      reason = error.code === 'session' ? 'session' : 'offline'
      transient = error.code !== 'session'
    } else if (error instanceof MissingFileError) {
      reason = 'missing'
      transient = false
    } else if (error instanceof DriveError) {
      reason = error.kind === 'network' ? 'offline' : error.reason
      transient = error.transient
    } else {
      reason = 'server'
      transient = true
    }
    item.error = reason
    if (transient) {
      item.attempts += 1
      item.nextAt = now() + delayAfter(item.attempts)
    } else {
      item.nextAt = null
    }
    deps.log?.(`[drive] envio falhou: ${reason}${transient ? `, nova tentativa em ${Math.round(((item.nextAt as number) - now()) / 1000)} s` : ''}`)
  }

  async function runItem(item: QueueItem): Promise<void> {
    const progress: Progress = { item, sent: 0, total: 0, percent: 0 }
    running = progress
    announce(item.meetingId)
    let exists: boolean
    try {
      try {
        exists = await send(item, progress)
      } catch (error) {
        // 401: o token venceu antes da hora ou foi revogado; renova uma vez e tenta de novo.
        if (!(error instanceof DriveError && error.kind === 'auth')) throw error
        await deps.account.accessToken(true)
        exists = await send(item, progress)
      }
      state.queue = state.queue.filter((entry) => entry !== item)
      if (!exists) state.meetings = Object.fromEntries(Object.entries(state.meetings).filter(([id]) => id !== item.meetingId))
    } catch (error) {
      // 401 de novo com o token recém-renovado: a conta inteira passa a "Entre de novo", como a linha da reunião.
      if (error instanceof DriveError && error.kind === 'auth') deps.account.markExpired()
      if (state.queue.includes(item)) fail(item, error instanceof DriveError && error.kind === 'auth' ? new AccountError('session') : error)
    } finally {
      running = null
      persist()
      announce(item.meetingId)
    }
  }

  /** O próximo envio vencido, se a conta e o interruptor deixam. */
  async function pump(): Promise<void> {
    if (running || disposed) return
    if (!deps.account.signedIn() || !(await deps.enabled())) return
    // Outro `pump` começou enquanto este esperava as configurações.
    if (running) return
    const at = now()
    const item = state.queue.filter((entry) => entry.nextAt !== null && entry.nextAt <= at).sort((a, b) => (a.nextAt as number) - (b.nextAt as number))[0]
    if (!item) {
      schedule()
      return
    }
    current = runItem(item)
    await current
    current = null
    if (!disposed) {
      schedule()
      void pump()
    }
  }

  const meetingIdOf = (input: unknown): string | null => {
    const parsed = meetingIdSchema.safeParse(input)
    return parsed.success ? parsed.data : null
  }

  return {
    async enqueue(meetingId, kinds) {
      if (disposed || !meetingIdSchema.safeParse(meetingId).success || !kinds.length) return
      // Sem conta, nada vai para a fila (e nenhum pedido sai para o Google). Sessão expirada: entra parada,
      // esperando o próximo login.
      if (deps.account.email() === null || !(await deps.enabled())) return
      const paused = !deps.account.signedIn()
      const pending = state.queue.find((item) => item.meetingId === meetingId && item !== running?.item)
      if (pending) {
        pending.kinds = DRIVE_FILE_KINDS.filter((kind) => pending.kinds.includes(kind) || kinds.includes(kind))
        pending.attempts = 0
        pending.error = paused ? 'session' : null
        pending.nextAt = paused ? null : now() + enqueueDelay
      } else {
        state.queue.push({
          meetingId,
          kinds: DRIVE_FILE_KINDS.filter((kind) => kinds.includes(kind)),
          attempts: 0,
          nextAt: paused ? null : now() + enqueueDelay,
          error: paused ? 'session' : null,
        })
      }
      persist()
      announce(meetingId)
      schedule()
    },

    status: (meetingId) => {
      const id = meetingIdOf(meetingId)
      return id ? status(id) : { state: 'hidden' }
    },

    retry(meetingId) {
      const id = meetingIdOf(meetingId)
      if (!id) return { state: 'hidden' }
      const pending = state.queue.find((item) => item.meetingId === id && item !== running?.item)
      if (pending) {
        pending.attempts = 0
        pending.error = null
        pending.nextAt = now()
        persist()
        announce(id)
        schedule()
      }
      return status(id)
    },

    folderUrl(meetingId) {
      const id = meetingIdOf(meetingId)
      const folderId = id ? state.meetings[id]?.folderId : null
      return folderId && DRIVE_ID_PATTERN.test(folderId) ? `${DRIVE_FOLDER_URL_PREFIX}${folderId}` : null
    },

    inDrive: (meetingId) => status(meetingId).state === 'done',

    signedIn(email) {
      if (state.account !== email) {
        // Outra conta: as pastas e os arquivos da anterior não valem aqui. O que estava no Drive da conta anterior
        // volta para a fila e vai inteiro para esta (deixa de aparecer "No Drive" até chegar).
        const previous = state.account
        state.account = email
        state.rootFolderId = null
        for (const [meetingId, entry] of Object.entries(state.meetings)) {
          const wasSent = entry.sent
          entry.folderId = null
          entry.files = {}
          entry.sent = false
          if (previous !== null && wasSent && !state.queue.some((item) => item.meetingId === meetingId)) {
            state.queue.push({ meetingId, kinds: [...DRIVE_FILE_KINDS], attempts: 0, nextAt: now(), error: null })
          }
        }
        sessions.clear()
        for (const meetingId of Object.keys(state.meetings)) announce(meetingId)
      }
      for (const item of state.queue) {
        if (item.error === 'session') {
          item.error = null
          item.attempts = 0
          item.nextAt = now()
        }
      }
      persist()
      for (const item of state.queue) announce(item.meetingId)
      schedule()
    },

    clear() {
      if (!state.queue.length) return
      const ids = state.queue.map((item) => item.meetingId)
      state.queue = []
      sessions.clear()
      persist()
      for (const id of new Set(ids)) announce(id)
      schedule()
    },

    start() {
      schedule()
      void pump()
    },

    async flush() {
      for (let guard = 0; guard < 100; guard++) {
        if (current) await current
        const at = now()
        if (!state.queue.some((item) => item.nextAt !== null && item.nextAt <= at)) return
        if (!deps.account.signedIn() || !(await deps.enabled())) return
        await pump()
      }
    },

    dispose() {
      disposed = true
      if (timer !== null) timers.clearTimeout(timer)
      timer = null
    },
  }
}

export interface EndOfRecordingDeps {
  enqueue: DriveSyncService['enqueue']
  /** Há uma gravação com arquivos na pasta ainda sem o `audio-finish` (`MeetingFilesService.hasOpenSession`). */
  filesPending: () => boolean
  timers?: DriveTimers
  /** Sem `audio-finish` até aqui (o renderer caiu no meio), a transcrição vai mesmo assim, montada na hora. */
  fallbackMs?: number
}

export interface EndOfRecordingHooks {
  /** `scribe:transcript-save`. */
  transcriptSaved(meetingId: string): void
  /** `scribe:audio-finish` respondeu. */
  filesFinished(meetingId: string): void
}

export const TRANSCRIPT_FALLBACK_MS = 120_000

/**
 * Quando a reunião entra na fila ao encerrar (contrato 11, CA5). Com arquivos na pasta, só depois do
 * `audio-finish`, que dá o nome base de verdade (com o " (2)" de `uniqueBase`) e o `.md` da pasta; sem pasta, logo
 * que a transcrição é salva, com o Markdown montado na hora. Uma entrada só por reunião: nunca duas transcrições.
 */
export function createEndOfRecordingHooks(deps: EndOfRecordingDeps): EndOfRecordingHooks {
  const timers: DriveTimers = deps.timers ?? {
    setTimeout: (callback, ms) => {
      const handle = setTimeout(callback, ms)
      handle.unref?.()
      return handle
    },
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const waiting = new Map<string, unknown>()
  const enqueue = (meetingId: string, kinds: readonly DriveFileKind[]): void => void deps.enqueue(meetingId, kinds).catch(() => undefined)
  return {
    transcriptSaved(meetingId) {
      if (waiting.has(meetingId)) return
      if (!deps.filesPending()) {
        enqueue(meetingId, ['transcript'])
        return
      }
      waiting.set(
        meetingId,
        timers.setTimeout(() => {
          waiting.delete(meetingId)
          enqueue(meetingId, ['audio', 'transcript'])
        }, deps.fallbackMs ?? TRANSCRIPT_FALLBACK_MS),
      )
    },
    filesFinished(meetingId) {
      const timer = waiting.get(meetingId)
      if (timer !== undefined) timers.clearTimeout(timer)
      waiting.delete(meetingId)
      // Com ou sem arquivo escrito: o que estiver na pasta vai; o que faltar, montado na hora.
      enqueue(meetingId, ['audio', 'transcript'])
    },
  }
}
