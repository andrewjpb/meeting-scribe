// O serviço como processo filho do app (contrato 24, CA2): `venv/bin/python -I bridge/server.py`, com o
// ambiente mínimo, o stdin num cano (o app morreu, o cano fecha e o serviço sai) e a primeira linha do stdout
// dizendo a porta. "Desligar" e a saída do app mandam SIGTERM e, se não sair em 3 s, SIGKILL. O stderr do serviço
// não vai para log nenhum: só o fim dele fica na memória, para explicar uma falha ao subir.
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { pythonEnv, venvPython, WHATSAPP_PATHS, type Exec } from './install'

export const BRIDGE_READY_TIMEOUT_MS = 30_000
const KILL_AFTER_MS = 3_000

export type BridgeBackend = 'neonize' | 'fake'

export interface BridgeProcess {
  readonly port: number
  readonly pid: number | undefined
  /** Termina quando o processo sai. */
  readonly exited: Promise<number | null>
  stop(): Promise<void>
}

export type StartResult = { ok: true; process: BridgeProcess } | { ok: false; error: 'libmagic' | 'start-failed' }

export type SpawnBridge = (python: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildProcess

export const nodeSpawnBridge: SpawnBridge = (python, args, env) => spawn(python, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: false })

export interface StartOptions {
  root: string
  bridgeDir: string
  tokenFile: string
  /** Id aleatório da instalação: o `/health` sem token responde com ele. */
  instanceId: string
  backend: BridgeBackend
  baseEnv: NodeJS.ProcessEnv
  spawn?: SpawnBridge
  timeoutMs?: number
  log?: (message: string) => void
}

export function startBridge(options: StartOptions): Promise<StartResult> {
  const args = ['-I', join(options.bridgeDir, 'server.py'), '--data-dir', join(options.root, WHATSAPP_PATHS.session), '--token-file', options.tokenFile, '--backend', options.backend, '--instance-id', options.instanceId]
  const child = (options.spawn ?? nodeSpawnBridge)(venvPython(options.root), args, pythonEnv(options.baseEnv))
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000)
  })
  child.stdin?.on('error', () => undefined)

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS)
    await exited
    clearTimeout(timer)
  }

  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    const done = (result: StartResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) void stop()
      resolve(result)
    }
    const timer = setTimeout(() => {
      options.log?.('[whatsapp] o serviço não disse a porta a tempo')
      done({ ok: false, error: 'start-failed' })
    }, options.timeoutMs ?? BRIDGE_READY_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      stdout += chunk
      const end = stdout.indexOf('\n')
      if (end === -1) {
        if (stdout.length > 4000) done({ ok: false, error: 'start-failed' })
        return
      }
      let line: unknown
      try {
        line = JSON.parse(stdout.slice(0, end))
      } catch {
        done({ ok: false, error: 'start-failed' })
        return
      }
      const event = line as { event?: unknown; port?: unknown; error?: unknown }
      if (event.event === 'ready' && typeof event.port === 'number' && Number.isInteger(event.port) && event.port > 0 && event.port < 65_536) {
        const port = event.port
        done({ ok: true, process: { port, pid: child.pid, exited, stop } })
        return
      }
      done({ ok: false, error: event.event === 'error' && event.error === 'libmagic' ? 'libmagic' : 'start-failed' })
    })
    void exited.then((code) => {
      if (settled) return
      options.log?.(`[whatsapp] o serviço saiu ao subir (código ${String(code)})`)
      done({ ok: false, error: /libmagic/i.test(stderrTail) ? 'libmagic' : 'start-failed' })
    })
  })
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Para um serviço reencontrado (sobrou de uma execução anterior do app): só se o comando do PID for o `server.py`
 * desta instalação (`ps`), SIGTERM e, se não sair em 3 s, SIGKILL. Qualquer outro processo fica em paz.
 */
export async function killBridgePid(pid: number, serverPath: string, exec: Exec, waitMs = KILL_AFTER_MS): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false
  const found = await exec('/bin/ps', ['-p', String(pid), '-o', 'command='], { timeoutMs: 5000, env: { PATH: '/bin:/usr/bin' } })
  if (!found.ok || !found.stdout.includes(serverPath)) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Saiu entre a conferência e o sinal.
  }
  return true
}
