// Instalar e remover o serviço local do WhatsApp (contrato 24, CA2), só com o clique da pessoa e depois do
// aviso de risco. O ambiente Python fica isolado em `userData/whatsapp/venv`, criado com o `python3` do sistema
// (3.10 ou mais novo), e o `requirements.txt` (neonize em versão fixa, com hashes) entra com `--require-hashes`,
// `--only-binary=:all:` (nenhum código de instalação roda) e `--isolated` (nenhuma configuração do pip de fora).
// A rede é só do PyPI, só neste momento; no smoke, um índice falso numa pasta local, sem rede.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WHATSAPP_PYTHON_MIN, type WhatsAppError } from '../../shared/whatsapp'

export const WHATSAPP_DIR = 'whatsapp'
/** Pastas e arquivos dentro de `userData/whatsapp`. */
export const WHATSAPP_PATHS = {
  venv: 'venv',
  bridge: 'bridge',
  session: 'session',
  installed: 'installed.json',
  risk: 'aceite.json',
  links: 'links.json',
  service: 'service.bin',
  token: 'token',
  /** Contrato 32: o cache dos Detalhes (resumos das conversas): sai junto com as mensagens. */
  insights: 'insights.json',
  /** Contrato 37: as transcrições dos áudios: saem junto com as mensagens. */
  transcripts: 'transcripts.json',
  /** Contrato 159: as etiquetas da triagem: saem junto com as mensagens. */
  triagem: 'triagem.json',
} as const

/** Arquivos do serviço copiados para `userData/whatsapp/bridge` a cada "Ligar". */
export const BRIDGE_FILES = ['server.py', 'bridge_store.py', 'backend_neonize.py', 'requirements.txt'] as const
/** Só no smoke: o cliente falso. */
export const BRIDGE_FAKE_FILE = 'backend_fake.py'

/** Onde procurar o `python3` do sistema, na ordem (o `/usr/bin/python3` do macOS é um atalho que abre o instalador das ferramentas da Apple: fica de fora). */
export const PYTHON_CANDIDATES = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/Library/Developer/CommandLineTools/usr/bin/python3',
] as const

/** O índice do PyPI; no smoke, uma pasta local. */
export type PackageIndex = { kind: 'pypi' } | { kind: 'local'; dir: string }

export type ExecResult = { ok: true; stdout: string } | { ok: false; stderr: string }
export type Exec = (file: string, args: readonly string[], options: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>

export const nodeExec: Exec = (file, args, options) =>
  new Promise((resolve) => {
    try {
      execFile(file, [...args], { timeout: options.timeoutMs, env: options.env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve(error ? { ok: false, stderr: String(stderr).slice(-2000) } : { ok: true, stdout: String(stdout) })
      })
    } catch (error) {
      // O sistema recusou abrir o processo (ex.: sem permissão).
      resolve({ ok: false, stderr: error instanceof Error ? error.message : String(error) })
    }
  })

export interface PythonFound {
  path: string
  version: string
}

export type PythonResult = { ok: true; python: PythonFound } | { ok: false; error: Extract<WhatsAppError, 'python-missing' | 'python-old'>; version: string | null }

/** Ambiente mínimo para os processos do Python: nada das variáveis do app nem do `PYTHON*` do usuário. */
export function pythonEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: base['HOME'] ?? '',
    LANG: 'en_US.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1',
  }
}

export function versionAtLeast(version: string, min: readonly [number, number]): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10))
  return major > min[0] || (major === min[0] && minor >= min[1])
}

/** O primeiro `python3` que responde; com versão anterior à 3.10, o erro diz qual achou. */
export async function findPython(exec: Exec, candidates: readonly string[], env: NodeJS.ProcessEnv): Promise<PythonResult> {
  let old: string | null = null
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const result = await exec(path, ['-I', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { timeoutMs: 10_000, env })
    if (!result.ok) continue
    const version = result.stdout.trim()
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue
    if (versionAtLeast(version, WHATSAPP_PYTHON_MIN)) return { ok: true, python: { path, version } }
    old ??= version
  }
  return old ? { ok: false, error: 'python-old', version: old } : { ok: false, error: 'python-missing', version: null }
}

export const venvPython = (root: string): string => join(root, WHATSAPP_PATHS.venv, 'bin', 'python')

/** Instalado: o ambiente existe e a instalação terminou (marca gravada no fim). */
export function isInstalled(root: string): boolean {
  return existsSync(venvPython(root)) && existsSync(join(root, WHATSAPP_PATHS.installed))
}

export interface InstallDeps {
  /** `userData/whatsapp`. */
  root: string
  exec: Exec
  pythonCandidates: readonly string[]
  /** Pasta com `requirements.txt` e os arquivos do serviço (no app empacotado, dentro do `app.asar`). */
  bridgeSource: string
  /** Arquivos copiados para `userData/whatsapp/bridge` antes do `pip` (que não lê de dentro do `app.asar`). */
  bridgeFiles: readonly string[]
  /** Só no smoke: requirements do índice falso, no lugar do real. */
  requirements?: string
  index: PackageIndex
  baseEnv: NodeJS.ProcessEnv
  onProgress: (line: string) => void
}

export type InstallResult = { ok: true; python: PythonFound } | { ok: false; error: WhatsAppError; detail?: string }

/** Cria o ambiente e instala o neonize. Ambiente pela metade é apagado. */
export async function installBridge(deps: InstallDeps): Promise<InstallResult> {
  const env = pythonEnv(deps.baseEnv)
  const found = await findPython(deps.exec, deps.pythonCandidates, env)
  if (!found.ok) return { ok: false, error: found.error, ...(found.version ? { detail: found.version } : {}) }
  await mkdir(deps.root, { recursive: true, mode: 0o700 })
  await chmod(deps.root, 0o700)
  const venv = join(deps.root, WHATSAPP_PATHS.venv)
  await rm(join(deps.root, WHATSAPP_PATHS.installed), { force: true })
  await rm(venv, { recursive: true, force: true })
  deps.onProgress('Criando o ambiente Python…')
  const created = await deps.exec(found.python.path, ['-I', '-m', 'venv', venv], { timeoutMs: 180_000, env })
  if (!created.ok) {
    await rm(venv, { recursive: true, force: true })
    return { ok: false, error: 'install-failed', detail: 'venv' }
  }
  deps.onProgress(deps.index.kind === 'pypi' ? 'Baixando e instalando do PyPI…' : 'Instalando do índice local…')
  // O `requirements.txt` sai do `app.asar` (o `readFile` do Electron lê de lá; o `pip` não) para o `userData`.
  const bridgeDir = await copyBridge(deps.bridgeSource, deps.root, deps.bridgeFiles)
  const requirements = deps.requirements ?? join(bridgeDir, 'requirements.txt')
  const source = deps.index.kind === 'pypi' ? ['--index-url', 'https://pypi.org/simple/'] : ['--no-index', '--find-links', deps.index.dir]
  const installed = await deps.exec(
    venvPython(deps.root),
    ['-I', '-m', 'pip', 'install', '--isolated', '--disable-pip-version-check', '--no-input', '--no-cache-dir', '--require-hashes', '--only-binary=:all:', ...source, '-r', requirements],
    { timeoutMs: 600_000, env },
  )
  if (!installed.ok) {
    await rm(venv, { recursive: true, force: true })
    return { ok: false, error: 'install-failed', detail: 'pip' }
  }
  const marker = join(deps.root, WHATSAPP_PATHS.installed)
  const temp = `${marker}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify({ installedAt: new Date().toISOString(), python: found.python.version })}\n`, { mode: 0o600 })
  await rename(temp, marker)
  return { ok: true, python: found.python }
}

/**
 * Copia os arquivos do serviço para `userData/whatsapp/bridge` (o Python não lê de dentro do `app.asar`), a cada
 * "Ligar": o serviço anda junto com a versão do app.
 */
export async function copyBridge(source: string, root: string, files: readonly string[]): Promise<string> {
  const target = join(root, WHATSAPP_PATHS.bridge)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const name of files) {
    // `readFile` (e não `copyFile`) lê também de dentro do `app.asar`.
    const content = await readFile(join(source, name))
    await writeFile(join(target, name), content, { mode: 0o600 })
  }
  return target
}

/**
 * "Remover": o ambiente, os arquivos do serviço, a sessão do WhatsApp com as mensagens, o cache dos Detalhes (contrato
 * 32, feito das mensagens), a porta e o token. O registro
 * das aceitações do aviso fica (é a prova de que a pessoa aceitou), e as ligações com reuniões também.
 */
export async function removeBridge(root: string): Promise<void> {
  for (const name of [WHATSAPP_PATHS.installed, WHATSAPP_PATHS.venv, WHATSAPP_PATHS.bridge, WHATSAPP_PATHS.session, WHATSAPP_PATHS.service, WHATSAPP_PATHS.token, WHATSAPP_PATHS.insights, WHATSAPP_PATHS.transcripts]) {
    await rm(join(root, name), { recursive: true, force: true })
  }
}
