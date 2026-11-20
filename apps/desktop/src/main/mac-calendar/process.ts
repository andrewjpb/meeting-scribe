// Contrato 60 (convites-agenda): o `lap-calendar` (native/calendar/main.swift) como processo filho do app, no molde do
// `mic-watch/process.ts`: stdio em cano (o app morreu, o stdin fecha e ele sai), uma requisição por linha no stdin e
// uma resposta por linha no stdout, conferida pelo zod do comando que ela responde (protocol.ts).
//
// Sob demanda: nada sobe até a primeira chamada; depois, um processo só, uma requisição por vez (fila de até 32). Cada
// comando tem prazo; estourou, o processo morre (o estado dele é desconhecido) e a fila segue no próximo. Caiu, sobe
// de novo com recuo exponencial (no máximo 5 tentativas seguidas). Nenhum método rejeita: tudo volta como
// `{ ok: false, error }`, com `unavailable` quando o helper não está disponível (D9). O log diz só comando, `id`,
// `code` e `reason`: nada do evento (título, notas, local, URL) e nada do stderr.
//
// O binário: no app empacotado, `Contents/Resources/bin/lap-calendar` (o pack.sh compila, assina e confere); no
// `pnpm dev`, compilado sob demanda para `out/bin/` com os mesmos argumentos do pack.sh. No dev o `request-access`
// não sai (o processo responsável seria o Electron do node_modules, sem a frase de uso do Calendário).
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MAC_CALENDAR_ARGS_SCHEMAS,
  MAC_CALENDAR_MAX_REQUEST_LINE,
  MAC_CALENDAR_MAX_RESPONSE_LINE,
  parseMacCalendarResponse,
  type MacCalendarCmd,
  type MacCalendarCreateArgs,
  type MacCalendarError,
  type MacCalendarErrorReason,
  type MacCalendarFindArgs,
  type MacCalendarOutcome,
  type MacCalendarRemoveArgs,
  type MacCalendarResults,
  type MacCalendarUpdateArgs,
} from './protocol'

/** Tentativas seguidas de subir de novo depois de cair; depois disso, `gave-up` até um novo `createMacCalendar`. */
export const MAC_CALENDAR_MAX_RESTARTS = 5
/** Primeira espera antes de subir de novo; dobra a cada tentativa (1 s, 2 s, 4 s…). */
export const MAC_CALENDAR_RESTART_BASE_MS = 1_000
/** Vivo isto sem cair, as tentativas voltam a zero. */
export const MAC_CALENDAR_STABLE_MS = 60_000
/** Requisições na fila (a em andamento conta); a 33ª volta `busy` na hora. */
export const MAC_CALENDAR_MAX_PENDING = 32
export const MAC_CALENDAR_KILL_AFTER_MS = 3_000
/** Prazo de cada comando; o `request-access` espera o clique na janela do macOS. */
export const MAC_CALENDAR_TIMEOUTS_MS: Readonly<Record<MacCalendarCmd, number>> = {
  status: 10_000,
  calendars: 10_000,
  refresh: 10_000,
  find: 10_000,
  create: 15_000,
  update: 15_000,
  remove: 15_000,
  'request-access': 120_000,
}

/** O comando do pack.sh e do dev, rodado em `apps/desktop`: `swiftc <args> native/calendar/main.swift -o <saída>`. */
export const MAC_CALENDAR_SWIFTC_ARGS = ['-O', '-target', 'arm64-apple-macos14.4', '-warnings-as-errors', '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', 'native/calendar/Info.plist'] as const
export const MAC_CALENDAR_SOURCE = 'native/calendar/main.swift'
/** `requestFullAccessToEvents` é do macOS 14; as APIs de process objects do mic-watch, e o pacote, são do 14.4. */
export const MAC_CALENDAR_MIN_MACOS: readonly [number, number] = [14, 4]

export interface MacCalendarCommand {
  file: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
}

export type SpawnMacCalendar = (command: MacCalendarCommand) => ChildProcess

export const nodeSpawnMacCalendar: SpawnMacCalendar = (command) => spawn(command.file, [...command.args], { env: command.env, stdio: ['pipe', 'pipe', 'pipe'], detached: false })

export interface MacCalendarOptions {
  platform: NodeJS.Platform
  arch: string
  /** `process.getSystemVersion()` (ex.: "26.6.0"). */
  systemVersion: string
  /** `app.isPackaged`: fora do pacote, `requestAccess` volta `unavailable`/`dev`. */
  packaged: boolean
  /** O comando a subir (o binário de `locateMacCalendar`, ou o falso); `null`, sem binário. Chamado uma vez. */
  command: () => Promise<MacCalendarCommand | null>
  spawn?: SpawnMacCalendar
  log?: (message: string) => void
  timeouts?: Partial<Record<MacCalendarCmd, number>>
  baseDelayMs?: number
  maxRestarts?: number
  stableMs?: number
  killAfterMs?: number
  now?: () => number
}

export type MacCalendarCall<T> = Promise<MacCalendarOutcome<T>>

export interface MacCalendar {
  status(): MacCalendarCall<MacCalendarResults['status']>
  requestAccess(): MacCalendarCall<MacCalendarResults['request-access']>
  calendars(): MacCalendarCall<MacCalendarResults['calendars']>
  refresh(): MacCalendarCall<MacCalendarResults['refresh']>
  find(args: MacCalendarFindArgs): MacCalendarCall<MacCalendarResults['find']>
  create(args: MacCalendarCreateArgs): MacCalendarCall<MacCalendarResults['create']>
  update(args: MacCalendarUpdateArgs): MacCalendarCall<MacCalendarResults['update']>
  remove(args: MacCalendarRemoveArgs): MacCalendarCall<MacCalendarResults['remove']>
  /** Fecha o stdin, SIGTERM, SIGKILL depois de 3 s; as pendentes e as chamadas seguintes voltam `disposed`. */
  dispose(): Promise<void>
}

const MESSAGES: Partial<Record<MacCalendarErrorReason, string>> = {
  platform: 'O Calendário do Mac só funciona no macOS 14.4 ou mais novo, com Apple Silicon.',
  'no-binary': 'O app não achou o lap-calendar.',
  dev: 'No pnpm dev o app não pede acesso ao Calendário; use o app do pack.sh.',
  timeout: 'O Calendário do Mac não respondeu a tempo.',
  exited: 'O lap-calendar fechou no meio da requisição.',
  busy: 'Requisições demais na fila do Calendário do Mac.',
  'gave-up': 'O lap-calendar caiu vezes demais seguidas.',
  'bad-response': 'O lap-calendar respondeu fora do formato.',
  disposed: 'O Calendário do Mac foi desligado.',
  'line-too-long': 'A requisição passou de 64 KiB.',
  schema: 'A requisição está fora do formato.',
}

function failure(code: MacCalendarError['code'], reason: MacCalendarErrorReason): { ok: false; error: MacCalendarError } {
  return { ok: false, error: { code, reason, message: MESSAGES[reason] ?? reason } }
}

const unavailable = (reason: MacCalendarErrorReason) => failure('unavailable', reason)

/** macOS 14.4 ou mais novo (`process.getSystemVersion()`). */
export function supportsMacCalendar(systemVersion: string): boolean {
  const [major = 0, minor = 0] = systemVersion.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [minMajor, minMinor] = MAC_CALENDAR_MIN_MACOS
  return major > minMajor || (major === minMajor && minor >= minMinor)
}

interface Pending {
  id: string
  cmd: MacCalendarCmd
  line: string
  settle: (outcome: MacCalendarOutcome<unknown>) => void
}

export function createMacCalendar(options: MacCalendarOptions): MacCalendar {
  const spawnHelper = options.spawn ?? nodeSpawnMacCalendar
  const log = options.log ?? (() => undefined)
  const baseDelayMs = options.baseDelayMs ?? MAC_CALENDAR_RESTART_BASE_MS
  const maxRestarts = options.maxRestarts ?? MAC_CALENDAR_MAX_RESTARTS
  const stableMs = options.stableMs ?? MAC_CALENDAR_STABLE_MS
  const killAfterMs = options.killAfterMs ?? MAC_CALENDAR_KILL_AFTER_MS
  const now = options.now ?? Date.now
  const timeoutOf = (cmd: MacCalendarCmd): number => options.timeouts?.[cmd] ?? MAC_CALENDAR_TIMEOUTS_MS[cmd]
  const supported = options.platform === 'darwin' && options.arch === 'arm64' && supportsMacCalendar(options.systemVersion)

  let command: Promise<MacCalendarCommand | null> | null = null
  const queue: Pending[] = []
  let inFlight: (Pending & { timer: ReturnType<typeof setTimeout> }) | null = null
  let child: ChildProcess | null = null
  /** O processo atual não recebe mais nada (prazo estourado ou dispose): espera o `exit`. */
  let dying = false
  let exited: Promise<void> = Promise.resolve()
  let attempts = 0
  let retryAt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let launching = false
  let gaveUp = false
  let disposed = false
  let counter = 0

  const settleInFlight = (outcome: MacCalendarOutcome<unknown>): void => {
    const current = inFlight
    if (!current) return
    inFlight = null
    clearTimeout(current.timer)
    current.settle(outcome)
  }

  const kill = (proc: ChildProcess): void => {
    proc.stdin?.end()
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }, killAfterMs)
    timer.unref?.()
    void exited.then(() => clearTimeout(timer))
  }

  const failQueue = (reason: MacCalendarErrorReason): void => {
    for (const pending of queue.splice(0)) pending.settle(unavailable(reason))
  }

  const died = (startedAt: number, code: number | null): void => {
    child = null
    dying = false
    if (inFlight) {
      log(`[mac-calendar] ${inFlight.cmd} ${inFlight.id}: unavailable/exited (código ${String(code)})`)
      settleInFlight(unavailable('exited'))
    }
    if (disposed) return
    if (now() - startedAt >= stableMs) attempts = 0
    if (attempts >= maxRestarts) {
      gaveUp = true
      log(`[mac-calendar] saiu (código ${String(code)}) ${maxRestarts} vezes seguidas; desligado até criar o cliente de novo`)
      failQueue('gave-up')
      return
    }
    const delay = baseDelayMs * 2 ** attempts
    attempts++
    retryAt = now() + delay
    log(`[mac-calendar] saiu (código ${String(code)}); sobe de novo em ${delay} ms quando houver requisição (tentativa ${attempts} de ${maxRestarts})`)
    pump()
  }

  const onLine = (line: string): void => {
    let raw: unknown
    let parsedOk = true
    try {
      raw = JSON.parse(line)
    } catch {
      parsedOk = false
    }
    const id = parsedOk && raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : null
    const current = inFlight
    if (!current) {
      log('[mac-calendar] resposta sem requisição em andamento, descartada')
      return
    }
    // Uma requisição em voo de cada vez: linha ilegível (sem JSON ou sem `id`) é a resposta dela, estragada.
    if (id !== null && id !== current.id) {
      log(`[mac-calendar] resposta com id desconhecido ou repetido, descartada (esperava ${current.id})`)
      return
    }
    const parsed = parsedOk ? parseMacCalendarResponse(current.cmd, raw) : null
    if (!parsed || (parsed.id !== null && parsed.id !== current.id)) {
      log(`[mac-calendar] ${current.cmd} ${current.id}: unavailable/bad-response (linha fora do formato, descartada)`)
      settleInFlight(unavailable('bad-response'))
      pump()
      return
    }
    if (!parsed.outcome.ok) log(`[mac-calendar] ${current.cmd} ${current.id}: ${parsed.outcome.error.code}/${parsed.outcome.error.reason}`)
    settleInFlight(parsed.outcome)
    pump()
  }

  function launch(found: MacCalendarCommand): void {
    const startedAt = now()
    let proc: ChildProcess
    try {
      proc = spawnHelper(found)
    } catch {
      died(startedAt, null)
      return
    }
    child = proc
    let gone = false
    exited = new Promise((resolve) => {
      const end = (code: number | null): void => {
        if (gone) return
        gone = true
        resolve()
        died(startedAt, code)
      }
      proc.once('exit', (code) => end(code))
      proc.once('error', () => end(null))
    })
    proc.stdin?.on('error', () => undefined)
    proc.stderr?.resume()
    proc.stdout?.setEncoding('utf8')
    let buffer = ''
    let discarding = false
    proc.stdout?.on('data', (chunk: string) => {
      if (proc !== child) return
      buffer += chunk
      for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (discarding) {
          discarding = false
          continue
        }
        if (!line.trim()) continue
        if (Buffer.byteLength(line) > MAC_CALENDAR_MAX_RESPONSE_LINE) {
          tooLong()
          continue
        }
        onLine(line)
      }
      if (Buffer.byteLength(buffer) > MAC_CALENDAR_MAX_RESPONSE_LINE) {
        buffer = ''
        if (!discarding) tooLong()
        discarding = true
      }
    })
  }

  const tooLong = (): void => {
    const current = inFlight
    if (!current) return
    log(`[mac-calendar] ${current.cmd} ${current.id}: unavailable/bad-response (linha maior que 1 MiB, descartada)`)
    settleInFlight(unavailable('bad-response'))
    pump()
  }

  /** Manda a próxima da fila, subindo o processo se preciso (respeitando o recuo). */
  function pump(): void {
    if (disposed || inFlight || queue.length === 0) return
    if (gaveUp) {
      failQueue('gave-up')
      return
    }
    if (!child) {
      if (launching || retry || dying) return
      const wait = retryAt - now()
      if (wait > 0) {
        retry = setTimeout(() => {
          retry = null
          pump()
        }, wait)
        retry.unref?.()
        return
      }
      launching = true
      command ??= options.command().catch(() => null)
      void command.then((found) => {
        launching = false
        if (disposed) return
        if (!found) {
          failQueue('no-binary')
          return
        }
        if (!child) launch(found)
        pump()
      })
      return
    }
    if (dying) return
    const next = queue.shift()
    if (!next) return
    const proc = child
    const timer = setTimeout(() => {
      if (inFlight?.id !== next.id) return
      log(`[mac-calendar] ${next.cmd} ${next.id}: unavailable/timeout; o processo é encerrado`)
      settleInFlight(unavailable('timeout'))
      dying = true
      kill(proc)
    }, timeoutOf(next.cmd))
    timer.unref?.()
    inFlight = { ...next, timer }
    proc.stdin?.write(`${next.line}\n`)
  }

  function call<K extends MacCalendarCmd>(cmd: K, args: unknown): MacCalendarCall<MacCalendarResults[K]> {
    if (disposed) return Promise.resolve(unavailable('disposed'))
    if (!supported) return Promise.resolve(unavailable('platform'))
    if (cmd === 'request-access' && !options.packaged) return Promise.resolve(unavailable('dev'))
    if (gaveUp) return Promise.resolve(unavailable('gave-up'))
    if (!MAC_CALENDAR_ARGS_SCHEMAS[cmd].safeParse(args).success) {
      log(`[mac-calendar] ${cmd}: invalid/schema (não enviada)`)
      return Promise.resolve(failure('invalid', 'schema'))
    }
    if (queue.length + (inFlight ? 1 : 0) >= MAC_CALENDAR_MAX_PENDING) {
      log(`[mac-calendar] ${cmd}: unavailable/busy`)
      return Promise.resolve(unavailable('busy'))
    }
    const id = `c${++counter}`
    const line = JSON.stringify({ v: 1, id, cmd, args })
    if (Buffer.byteLength(line) > MAC_CALENDAR_MAX_REQUEST_LINE) {
      log(`[mac-calendar] ${cmd} ${id}: invalid/line-too-long (não enviada)`)
      return Promise.resolve(failure('invalid', 'line-too-long'))
    }
    return new Promise((resolve) => {
      queue.push({ id, cmd, line, settle: resolve as (outcome: MacCalendarOutcome<unknown>) => void })
      pump()
    })
  }

  return {
    status: () => call('status', {}),
    requestAccess: () => call('request-access', {}),
    calendars: () => call('calendars', {}),
    refresh: () => call('refresh', {}),
    find: (args) => call('find', args),
    create: (args) => call('create', args),
    update: (args) => call('update', args),
    remove: (args) => call('remove', args),

    async dispose() {
      if (disposed) return
      disposed = true
      if (retry) clearTimeout(retry)
      retry = null
      failQueue('disposed')
      settleInFlight(unavailable('disposed'))
      const proc = child
      if (!proc) return
      dying = true
      kill(proc)
      await exited
    },
  }
}

export type RunFile = (file: string, args: readonly string[], timeoutMs: number, cwd: string) => Promise<boolean>

const nodeRunFile: RunFile = (file, args, timeoutMs, cwd) =>
  new Promise((resolve) => {
    execFile(file, [...args], { timeout: timeoutMs, cwd, env: { PATH: '/usr/bin:/bin' } }, (error) => resolve(!error))
  })

export interface LocateOptions {
  platform: NodeJS.Platform
  arch: string
  systemVersion: string
  packaged: boolean
  /** `process.resourcesPath` (o binário do app empacotado fica em `bin/` dentro dele). */
  resourcesPath: string
  /** `app.getAppPath()` no dev (`apps/desktop`): fonte em `native/calendar/`, binário em `out/bin/`. */
  appPath: string
  run?: RunFile
  log?: (message: string) => void
}

/**
 * Caminho do `lap-calendar`, ou `null` com o motivo no log (o cliente responde `no-binary`). No dev, compila sob
 * demanda (fonte ou Info.plist mais novos que o binário, ou binário ausente), em `appPath`, com os argumentos do
 * pack.sh; o `xcode-select -p` antes do `swiftc` evita a janela "instalar as ferramentas" do macOS.
 */
export async function locateMacCalendar(options: LocateOptions): Promise<string | null> {
  const off = (why: string): null => {
    options.log?.(`[mac-calendar] sem o Calendário do Mac: ${why}`)
    return null
  }
  if (options.platform !== 'darwin' || options.arch !== 'arm64') return off('só no macOS com Apple Silicon')
  if (!supportsMacCalendar(options.systemVersion)) return off(`precisa do macOS 14.4 ou mais novo (este é ${options.systemVersion})`)
  if (options.packaged) {
    const file = join(options.resourcesPath, 'bin', 'lap-calendar')
    return existsSync(file) ? file : off(`o pacote não leva ${file}`)
  }
  const source = join(options.appPath, MAC_CALENDAR_SOURCE)
  const plist = join(options.appPath, 'native', 'calendar', 'Info.plist')
  const file = join(options.appPath, 'out', 'bin', 'lap-calendar')
  if (!existsSync(source) || !existsSync(plist)) return off(`fonte ausente (${dirname(source)})`)
  if (existsSync(file) && statSync(file).mtimeMs >= Math.max(statSync(source).mtimeMs, statSync(plist).mtimeMs)) return file
  const run = options.run ?? nodeRunFile
  if (!(await run('/usr/bin/xcode-select', ['-p'], 5_000, options.appPath))) return off('swiftc ausente (sem as ferramentas de linha de comando do Xcode)')
  mkdirSync(dirname(file), { recursive: true })
  options.log?.(`[mac-calendar] compilando ${source}`)
  if (!(await run('/usr/bin/swiftc', [...MAC_CALENDAR_SWIFTC_ARGS, MAC_CALENDAR_SOURCE, '-o', file], 180_000, options.appPath))) return off('o swiftc não compilou o main.swift')
  return file
}
