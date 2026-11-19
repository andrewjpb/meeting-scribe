// Contrato 49 (aviso-reuniao): o `lap-mic-watch` (native/mic-watch/main.swift) como processo filho do app, no molde
// do serviço do WhatsApp (whatsapp/process.ts): stdio em cano (o app morreu, o stdin fecha e ele sai), uma linha JSON
// por mudança no stdout, conferida pelo zod. Caiu, volta com recuo exponencial (no máximo 5 tentativas seguidas);
// parar fecha o stdin e manda SIGTERM, e SIGKILL se não sair em 3 s. O stderr não vai para log nenhum.
//
// O binário: no app empacotado, `Contents/Resources/bin/lap-mic-watch` (o pack.sh compila e assina); no `pnpm dev`,
// compilado sob demanda para `out/bin/` com o mesmo comando do pack.sh. Sem `swiftc`, sem macOS 14.4 ou fora do
// Apple Silicon, o recurso fica desligado (só o log diz por quê): o aviso continua pela extensão do Meet.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { MicWatchState } from '../../shared/meeting-prompt'

/** Tentativas seguidas de subir de novo depois de cair; depois disso, desiste até a configuração ser religada. */
export const MIC_WATCH_MAX_RESTARTS = 5
/** Primeira espera antes de subir de novo; dobra a cada tentativa (1 s, 2 s, 4 s…). */
export const MIC_WATCH_RESTART_BASE_MS = 1_000
/** Vivo isto sem cair, as tentativas voltam a zero. */
export const MIC_WATCH_STABLE_MS = 60_000
const KILL_AFTER_MS = 3_000
/** Linha maior que isto não é do `lap-mic-watch`: descartada. */
const MAX_LINE = 64_000

/** O comando do pack.sh e do dev: `swiftc <args> main.swift -o <saída>`. */
export const MIC_WATCH_SWIFTC_ARGS = ['-O', '-target', 'arm64-apple-macos14.4'] as const
/** As APIs de process objects do CoreAudio são do macOS 14.4. */
export const MIC_WATCH_MIN_MACOS: readonly [number, number] = [14, 4]

const lineSchema = z
  .object({
    v: z.literal(1),
    mic: z.boolean(),
    apps: z.array(z.string().min(1).max(255)).max(64),
    names: z.record(z.string().min(1).max(255), z.string().max(255)).optional(),
    camera: z.boolean(),
  })
  .strict()

/** Uma linha do stdout do `lap-mic-watch`; `null` fora do formato (campo a mais também é recusado). */
export function parseMicWatchLine(line: string): MicWatchState | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const parsed = lineSchema.safeParse(raw)
  if (!parsed.success) return null
  return { mic: parsed.data.mic, apps: parsed.data.apps, names: parsed.data.names ?? {}, camera: parsed.data.camera }
}

export interface MicWatchCommand {
  file: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
}

export type SpawnMicWatch = (command: MicWatchCommand) => ChildProcess

export const nodeSpawnMicWatch: SpawnMicWatch = (command) => spawn(command.file, [...command.args], { env: command.env, stdio: ['pipe', 'pipe', 'pipe'], detached: false })

export interface MicWatchOptions {
  command: MicWatchCommand
  /** Cada linha válida; `null` quando o processo saiu (o estado de antes não vale mais). */
  onState: (state: MicWatchState | null) => void
  spawn?: SpawnMicWatch
  log?: (message: string) => void
  baseDelayMs?: number
  maxRestarts?: number
  stableMs?: number
  now?: () => number
}

export interface MicWatch {
  /** Sobe (se já não estiver no ar); as tentativas voltam a zero. */
  start(): void
  /** Para e não sobe de novo até o próximo `start`. */
  stop(): Promise<void>
  running(): boolean
}

export function createMicWatch(options: MicWatchOptions): MicWatch {
  const spawnWatch = options.spawn ?? nodeSpawnMicWatch
  const baseDelayMs = options.baseDelayMs ?? MIC_WATCH_RESTART_BASE_MS
  const maxRestarts = options.maxRestarts ?? MIC_WATCH_MAX_RESTARTS
  const stableMs = options.stableMs ?? MIC_WATCH_STABLE_MS
  const now = options.now ?? Date.now
  let wanted = false
  let attempts = 0
  let child: ChildProcess | null = null
  let exited: Promise<void> = Promise.resolve()
  let retry: ReturnType<typeof setTimeout> | null = null

  const died = (startedAt: number, code: number | null): void => {
    child = null
    options.onState(null)
    if (!wanted) return
    if (now() - startedAt >= stableMs) attempts = 0
    if (attempts >= maxRestarts) {
      options.log?.(`[mic-watch] saiu (código ${String(code)}) ${maxRestarts} vezes seguidas; desligado até religar o aviso`)
      wanted = false
      return
    }
    const delay = baseDelayMs * 2 ** attempts
    attempts++
    options.log?.(`[mic-watch] saiu (código ${String(code)}); sobe de novo em ${delay} ms (tentativa ${attempts} de ${maxRestarts})`)
    retry = setTimeout(launch, delay)
    retry.unref?.()
  }

  function launch(): void {
    retry = null
    if (!wanted || child) return
    const startedAt = now()
    let proc: ChildProcess
    try {
      proc = spawnWatch(options.command)
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
    let buffer = ''
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        const state = parseMicWatchLine(line)
        if (state) options.onState(state)
        else options.log?.('[mic-watch] linha fora do formato, ignorada')
      }
      if (buffer.length > MAX_LINE) buffer = ''
    })
  }

  return {
    start() {
      if (wanted) return
      wanted = true
      attempts = 0
      launch()
    },

    async stop() {
      wanted = false
      if (retry) clearTimeout(retry)
      retry = null
      const proc = child
      if (!proc) return
      proc.stdin?.end()
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
      const timer = setTimeout(() => proc.kill('SIGKILL'), KILL_AFTER_MS)
      await exited
      clearTimeout(timer)
    },

    running: () => child !== null,
  }
}

/** macOS 14.4 ou mais novo (`process.getSystemVersion()`, ex.: "26.6.0"). */
export function supportsMicWatch(systemVersion: string): boolean {
  const [major = 0, minor = 0] = systemVersion.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [minMajor, minMinor] = MIC_WATCH_MIN_MACOS
  return major > minMajor || (major === minMajor && minor >= minMinor)
}

export type RunFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<boolean>

const nodeRunFile: RunFile = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, [...args], { timeout: timeoutMs, env: { PATH: '/usr/bin:/bin' } }, (error) => resolve(!error))
  })

export interface LocateOptions {
  platform: NodeJS.Platform
  arch: string
  systemVersion: string
  packaged: boolean
  /** `process.resourcesPath` (o binário do app empacotado fica em `bin/` dentro dele). */
  resourcesPath: string
  /** `app.getAppPath()` no dev (`apps/desktop`): fonte em `native/mic-watch/`, binário em `out/bin/`. */
  appPath: string
  run?: RunFile
  log?: (message: string) => void
}

/**
 * Caminho do `lap-mic-watch`, ou `null` com o motivo no log. No dev, compila sob demanda (fonte mais nova que o
 * binário, ou binário ausente); o `xcode-select -p` antes do `swiftc` evita a janela "instalar as ferramentas" do macOS.
 */
export async function locateMicWatch(options: LocateOptions): Promise<string | null> {
  const off = (why: string): null => {
    options.log?.(`[mic-watch] desligado: ${why}; o aviso de reunião continua só pela extensão do Meet`)
    return null
  }
  if (options.platform !== 'darwin' || options.arch !== 'arm64') return off('só no macOS com Apple Silicon')
  if (!supportsMicWatch(options.systemVersion)) return off(`precisa do macOS 14.4 ou mais novo (este é ${options.systemVersion})`)
  if (options.packaged) {
    const file = join(options.resourcesPath, 'bin', 'lap-mic-watch')
    return existsSync(file) ? file : off(`o pacote não leva ${file}`)
  }
  const source = join(options.appPath, 'native', 'mic-watch', 'main.swift')
  const file = join(options.appPath, 'out', 'bin', 'lap-mic-watch')
  if (!existsSync(source)) return off(`fonte ausente (${source})`)
  if (existsSync(file) && statSync(file).mtimeMs >= statSync(source).mtimeMs) return file
  const run = options.run ?? nodeRunFile
  if (!(await run('/usr/bin/xcode-select', ['-p'], 5_000))) return off('swiftc ausente (sem as ferramentas de linha de comando do Xcode)')
  mkdirSync(dirname(file), { recursive: true })
  options.log?.(`[mic-watch] compilando ${source}`)
  if (!(await run('/usr/bin/swiftc', [...MIC_WATCH_SWIFTC_ARGS, source, '-o', file], 180_000))) return off('o swiftc não compilou o main.swift')
  return file
}

export interface MicWatchServiceOptions {
  /** O comando a subir (o binário de `locateMicWatch`, ou o falso do smoke); `null`, recurso desligado. */
  command: () => Promise<MicWatchCommand | null>
  onState: (state: MicWatchState | null) => void
  spawn?: SpawnMicWatch
  log?: (message: string) => void
}

export interface MicWatchService {
  /** Liga ou desliga com "Avisar quando uma reunião começar" (repetir o mesmo valor não faz nada). */
  apply(enabled: boolean): void
  dispose(): Promise<void>
}

/** O observador do microfone ligado e desligado pela configuração; o binário é procurado (ou compilado) uma vez. */
export function createMicWatchService(options: MicWatchServiceOptions): MicWatchService {
  let command: Promise<MicWatchCommand | null> | null = null
  let watch: MicWatch | null = null
  let enabled = false
  return {
    apply(next) {
      // Qualquer configuração que muda passa por aqui: só a troca desta conta.
      if (next === enabled) return
      enabled = next
      if (!next) {
        void watch?.stop()
        return
      }
      command ??= options.command().catch(() => null)
      void command.then((found) => {
        if (!found || !enabled) return
        watch ??= createMicWatch({ command: found, onState: options.onState, ...(options.spawn ? { spawn: options.spawn } : {}), ...(options.log ? { log: options.log } : {}) })
        watch.start()
      })
    },

    async dispose() {
      enabled = false
      await watch?.stop()
    },
  }
}
