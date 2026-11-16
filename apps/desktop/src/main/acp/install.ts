// Instalação do adaptador ACP (contrato 17, decisão do Andrew de 16/11/2026): o `.dmg` não leva o
// `@anthropic-ai/claude-agent-sdk` (licença proprietária). Só com o clique da pessoa, o app baixa do registro
// do npm a mesma árvore que rodava no pacote — o adaptador e as dependências de produção dele, nas versões
// fixas abaixo — e monta `userData/acp/<versão>/node_modules`, como o Zed faz com os agentes dele.
//
// Cada tarball tem o `integrity` (sha512) fixo no código: o hash é conferido antes de extrair, e hash que não
// bate apaga tudo e dá erro. A extração é própria (zlib + um leitor de tar pequeno): caminho absoluto, `..`,
// link ou qualquer coisa que não seja arquivo comum ou pasta recusa o pacote inteiro. Tudo vai para
// `<versão>.part` e só vira `<versão>` com um `rename` da pasta inteira no fim: instalação pela metade nunca
// aparece como instalada. Só `registry.npmjs.org` é destino de rede. Os pacotes, a versão e o script vêm do
// perfil do agente (CA11); a pasta é `userData/acp/<perfil>/<versão>`.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { AcpAgentStatus } from '../../shared/acp'

/** O único registro de onde o app baixa. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/'

export interface AcpPackage {
  name: string
  version: string
  /** Caminho do tarball no registro (depois de `NPM_REGISTRY`). */
  path: string
  /** `sha512-<base64>`, o `dist.integrity` do npm. */
  integrity: string
  /** Tamanho do tarball, para o progresso e o "Instalar (≈4 MB)". */
  bytes: number
}

/** Baixa um arquivo; `onBytes` recebe cada pedaço que chegou (para o progresso). */
export type DownloadTarball = (url: string, onBytes: (count: number) => void) => Promise<Uint8Array>

/** `sha512-<base64>` do conteúdo. */
export function integrityOf(data: Uint8Array): string {
  return `sha512-${createHash('sha512').update(data).digest('base64')}`
}

/** Um arquivo do tarball, já com o caminho relativo à raiz do pacote. */
export interface TarFile {
  path: string
  data: Buffer
}

const text = (block: Buffer, start: number, length: number): string => {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8')
}
const octal = (block: Buffer, start: number, length: number): number => {
  const value = text(block, start, length).trim()
  if (!/^[0-7]*$/.test(value)) throw new Error('tar: tamanho inválido')
  return value ? parseInt(value, 8) : 0
}

/**
 * Caminho seguro dentro do pacote: sem a primeira pasta do tarball (`package/`), relativo, sem `..` e sem
 * caractere de controle. `null` se não for um.
 */
export function safeEntryPath(name: string): string | null {
  if (!name || isAbsolute(name) || name.includes('\\') || [...name].some((char) => char.charCodeAt(0) < 0x20)) return null
  const parts = name.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) return null
  const inside = parts.slice(1)
  if (!inside.length) return null
  const path = normalize(inside.join('/'))
  return path.startsWith('..') || isAbsolute(path) ? null : path
}

/**
 * Leitor de tar (ustar, com os cabeçalhos `pax` do npm para nomes longos). Devolve só os arquivos comuns; uma
 * pasta é aceita e ignorada; link, dispositivo ou caminho inseguro lançam erro.
 */
export function readTar(tar: Buffer): TarFile[] {
  const files: TarFile[] = []
  let offset = 0
  let paxPath: string | null = null
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] ?? 0)
    const body = tar.subarray(offset + 512, offset + 512 + size)
    if (body.length < size) throw new Error('tar: arquivo cortado')
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      // Cabeçalho pax: só o `path` importa (nome acima de 100 caracteres).
      for (const record of body.toString('utf8').split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(record)
        if (match) paxPath = match[1] ?? null
      }
      continue
    }
    if (type === 'g') continue
    const prefix = text(header, 345, 155)
    const name = paxPath ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100))
    paxPath = null
    if (type === '5') continue
    if (type !== '0' && type !== '\0') throw new Error(`tar: tipo "${type}" recusado em ${name.slice(0, 120)}`)
    const path = safeEntryPath(name)
    if (!path) throw new Error(`tar: caminho recusado: ${name.slice(0, 120)}`)
    files.push({ path, data: Buffer.from(body) })
  }
  return files
}

/** Extrai o `.tgz` de um pacote na pasta dele. */
export async function extractPackage(tgz: Uint8Array, target: string): Promise<number> {
  const files = readTar(gunzipSync(tgz))
  for (const file of files) {
    const path = join(target, file.path)
    if (!path.startsWith(`${target}${sep}`)) throw new Error('tar: caminho fora do pacote')
    await mkdir(dirname(path), { recursive: true, mode: 0o755 })
    await writeFile(path, file.data, { mode: 0o644, flag: 'wx' })
  }
  return files.length
}

export interface AcpInstallerOptions {
  /** `userData/acp`. */
  root: string
  download: DownloadTarball
  /** Teste: outro registro. */
  registry?: string
  /** Os pacotes pinados do perfil (o smoke troca pelos do registro falso). */
  packages: readonly AcpPackage[]
  /** Versão do agente: a pasta dentro de `root`. */
  version: string
  /** Script do agente dentro de `node_modules`. */
  entry: readonly string[]
  /** Nome na tela ("Claude"). */
  label: string
  onStatus?: (status: AcpAgentStatus) => void
  log?: (message: string) => void
}

export interface AcpInstaller {
  status(): AcpAgentStatus
  /** `dist/index.js` do adaptador instalado; `null` se não instalado. */
  entry(): string | null
  /** Baixa, confere e instala (uma vez por vez); devolve o estado no fim. */
  install(): Promise<AcpAgentStatus>
  remove(): Promise<AcpAgentStatus>
}

export function createAcpInstaller(options: AcpInstallerOptions): AcpInstaller {
  const registry = options.registry ?? NPM_REGISTRY
  const { packages, version, label } = options
  const downloadBytes = packages.reduce((sum, pkg) => sum + pkg.bytes, 0)
  const folder = join(options.root, version)
  const entryPath = join(folder, 'node_modules', ...options.entry)
  let installing: Promise<AcpAgentStatus> | null = null
  let progress = 0
  let lastError: string | null = null

  const status = (): AcpAgentStatus => {
    if (installing) return { state: 'installing', label, version, progress, downloadBytes }
    if (existsSync(entryPath)) return { state: 'installed', label, version, progress: 100, downloadBytes }
    if (lastError) return { state: 'error', label, version, progress: 0, downloadBytes, error: lastError }
    return { state: 'missing', label, version, progress: 0, downloadBytes }
  }
  const announce = (): void => options.onStatus?.(status())

  async function run(): Promise<void> {
    const part = `${folder}.part`
    await rm(part, { recursive: true, force: true })
    await mkdir(join(part, 'node_modules'), { recursive: true, mode: 0o700 })
    let received = 0
    let shown = -1
    try {
      for (const pkg of packages) {
        const url = `${registry}${pkg.path}`
        if (!url.startsWith(registry) || pkg.path.includes('..')) throw new Error('endereço fora do registro')
        const data = await options.download(url, (count) => {
          received += count
          progress = Math.min(99, Math.floor((received / downloadBytes) * 100))
          if (progress !== shown) {
            shown = progress
            announce()
          }
        })
        if (integrityOf(data) !== pkg.integrity) throw new Error(`o arquivo de ${pkg.name} não confere (hash diferente)`)
        await extractPackage(data, join(part, 'node_modules', ...pkg.name.split('/')))
      }
      await rm(folder, { recursive: true, force: true })
      await rename(part, folder)
      options.log?.(`[acp] agente ${version} instalado em ${folder}`)
    } catch (error) {
      await rm(part, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  return {
    status,
    entry: () => (installing === null && existsSync(entryPath) ? entryPath : null),
    install() {
      if (installing) return installing
      if (existsSync(entryPath)) return Promise.resolve(status())
      progress = 0
      lastError = null
      const job = run()
        .catch((error: unknown) => {
          lastError = `Não foi possível instalar: ${error instanceof Error ? error.message : 'erro'}.`
          options.log?.(`[acp] instalação falhou: ${lastError}`)
        })
        .then(() => {
          installing = null
          const result = status()
          options.onStatus?.(result)
          return result
        })
      installing = job
      announce()
      return job
    },
    async remove() {
      if (installing) return status()
      await rm(folder, { recursive: true, force: true })
      lastError = null
      announce()
      return status()
    },
  }
}
