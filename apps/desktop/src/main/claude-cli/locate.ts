// Onde está o `claude` (CA2). Um app aberto pelo Finder não herda o `PATH` do terminal, por isso a lista
// fixa vem antes do shell de login. Ordem: caminho escolhido em Configurações; `~/.local/bin/claude`;
// `/opt/homebrew/bin/claude`; `/usr/local/bin/claude`; `command -v claude` em `/bin/zsh -lc` (até 3 s).
// Cada candidato só vale se `claude --version` responder (até 5 s) com a versão do Claude Code. Os
// processos rodam com `exec` injetado (o teste não executa nada) e com o ambiente de `claudeEnv`.
import { execFile } from 'node:child_process'
import { dirname, isAbsolute, join } from 'node:path'
import type { ClaudeLocateResult } from '../../shared/claude-cli'

export const CLAUDE_VERSION_TIMEOUT_MS = 5_000
export const LOGIN_SHELL_TIMEOUT_MS = 3_000
export const LOGIN_SHELL = '/bin/zsh'

export interface ExecOptions {
  timeoutMs: number
  env: NodeJS.ProcessEnv
}

/** Executa sem shell e devolve a saída; rejeita em erro, código diferente de 0 ou tempo esgotado. */
export type ExecFile = (file: string, args: readonly string[], options: ExecOptions) => Promise<{ stdout: string }>

/** Implementação real: `execFile` com tempo limite, saída pequena e `SIGKILL` ao estourar. */
export const nodeExecFile: ExecFile = (file, args, { timeoutMs, env }) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, killSignal: 'SIGKILL', env, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve({ stdout })
    })
  })

/** Variáveis que o `claude` precisa para achar a conta do usuário; nenhuma do app passa. */
const ENV_ALLOWED = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'PATH'] as const
const DEFAULT_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * Ambiente dos processos do `claude`: só a lista acima, copiada do ambiente do main. A chave da
 * AssemblyAI, as variáveis do Electron e qualquer outra do app ficam de fora. A pasta do binário entra
 * no começo do `PATH`.
 */
export function claudeEnv(base: NodeJS.ProcessEnv, binaryPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of ENV_ALLOWED) {
    const value = base[name]
    if (typeof value === 'string' && value !== '') env[name] = value
  }
  const path = env['PATH'] ?? DEFAULT_PATH
  env['PATH'] = binaryPath ? `${dirname(binaryPath)}:${path}` : path
  return env
}

/** Lista fixa, na ordem do CA2. */
export function fixedCandidates(home: string): string[] {
  return [join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
}

/** `2.1.312 (Claude Code)` -> `2.1.312`. Saída sem "Claude Code" não é o `claude` que o app procura. */
export function parseClaudeVersion(stdout: string): string | null {
  if (!/claude code/i.test(stdout)) return null
  return /(\d+\.\d+\.\d+[\w.+-]*)/.exec(stdout)?.[1] ?? null
}

export interface LocateOptions {
  /** `claudePath` das configurações (`null` = procurar sozinho). */
  configuredPath: string | null
  home: string
  exec: ExecFile
  /** Ambiente do main; passa por `claudeEnv` antes de qualquer execução. */
  baseEnv: NodeJS.ProcessEnv
  /** Troca a lista fixa (o smoke aponta para o binário falso). */
  candidates?: readonly string[]
  /** Desliga o `command -v` no shell de login (smoke e escolha de caminho em Configurações). */
  loginShell?: boolean
}

async function versionOf(path: string, options: LocateOptions): Promise<string | null> {
  try {
    const { stdout } = await options.exec(path, ['--version'], { timeoutMs: CLAUDE_VERSION_TIMEOUT_MS, env: claudeEnv(options.baseEnv, path) })
    return parseClaudeVersion(stdout)
  } catch {
    return null
  }
}

async function fromLoginShell(options: LocateOptions): Promise<string | null> {
  try {
    const { stdout } = await options.exec(LOGIN_SHELL, ['-lc', 'command -v claude'], { timeoutMs: LOGIN_SHELL_TIMEOUT_MS, env: claudeEnv(options.baseEnv) })
    const path = stdout.trim().split('\n')[0]?.trim() ?? ''
    // `command -v` de um alias ou função devolve texto, não caminho.
    return isAbsolute(path) ? path : null
  } catch {
    return null
  }
}

export async function locateClaude(options: LocateOptions): Promise<ClaudeLocateResult> {
  const tried = new Set<string>()
  const attempt = async (path: string | null): Promise<ClaudeLocateResult | null> => {
    if (!path || tried.has(path)) return null
    tried.add(path)
    const version = await versionOf(path, options)
    return version ? { ok: true, path, version } : null
  }
  const candidates = [options.configuredPath, ...(options.candidates ?? fixedCandidates(options.home))]
  for (const path of candidates) {
    const found = await attempt(path)
    if (found) return found
  }
  if (options.loginShell !== false) {
    const found = await attempt(await fromLoginShell(options))
    if (found) return found
  }
  return { ok: false, error: 'not-found' }
}
