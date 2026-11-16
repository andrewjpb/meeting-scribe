// Consulta do último release no GitHub (contrato 14, CA1). Só a versão vai no pedido (`User-Agent`); o
// repositório é fixo aqui. Versão compara por semver `x.y.z`; pré-release, rascunho e release sem o
// `.dmg` e o `.sha256` não contam como versão nova.
import { z } from 'zod'
import { UPDATE_NOTES_MAX, updateAssetName } from '../../shared/updates'
import type { FetchLike } from '../assemblyai/gateway'

/** Repositório público de onde o app se atualiza. Trocar só aqui. */
export const UPDATE_REPO = 'andrewjpb/meeting-scribe'
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
/** Único lugar de onde um asset é baixado. */
export const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPO}/releases/download/`
/** Para onde o GitHub redireciona o download do asset. */
export const RELEASE_REDIRECT_HOSTS: readonly string[] = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com']

const API_TIMEOUT_MS = 15_000

export function userAgent(version: string): string {
  return `LAP-Reunioes/${version}`
}

type Semver = [number, number, number]

/** `0.2.0` ou `v0.2.0`; qualquer sufixo (`-beta.1`, `+build`) não é versão final e devolve `null`. */
export function parseVersion(value: string): Semver | null {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negativo se `a < b`, zero se iguais, positivo se `a > b`. */
export function compareVersions(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function plainUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  return url
}

/** Endereço de asset do próprio repositório (`https://github.com/<repo>/releases/download/...`). */
export function isReleaseDownloadUrl(value: string): boolean {
  const url = plainUrl(value)
  return url !== null && url.href.startsWith(RELEASE_DOWNLOAD_PREFIX)
}

/** Redirecionamento aceito no download: o armazenamento de assets do GitHub ou o próprio repositório. */
export function isAllowedRedirect(value: string): boolean {
  const url = plainUrl(value)
  return url !== null && (RELEASE_REDIRECT_HOSTS.includes(url.hostname) || url.href.startsWith(RELEASE_DOWNLOAD_PREFIX))
}

const assetSchema = z.object({ name: z.string(), browser_download_url: z.string(), size: z.number().int().nonnegative().optional() })
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  body: z.string().nullable().optional(),
  assets: z.array(assetSchema),
})

export interface UpdateRelease {
  version: string
  /** `body` do release em texto simples, cortado em 2 000 caracteres. */
  notes: string
  dmg: { name: string; url: string; size: number | null }
  sha256Url: string
}

export type CheckResult =
  | { kind: 'available'; release: UpdateRelease }
  /** Nenhuma versão maior utilizável (igual, menor, pré-release, rascunho ou sem os assets). */
  | { kind: 'none'; reason: string }
  | { kind: 'error'; reason: string }

export function releaseNotes(body: string | null | undefined): string {
  const text = (body ?? '').replace(/\r\n?/g, '\n').trim()
  return text.length > UPDATE_NOTES_MAX ? `${text.slice(0, UPDATE_NOTES_MAX - 1).trimEnd()}…` : text
}

/** Decide sobre a resposta de `releases/latest` já lida como objeto. */
export function evaluateRelease(raw: unknown, currentVersion: string): CheckResult {
  const parsed = releaseSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', reason: 'resposta fora do formato' }
  const release = parsed.data
  if (release.draft || release.prerelease) return { kind: 'none', reason: 'rascunho ou pré-release' }
  const latest = parseVersion(release.tag_name)
  if (!latest) return { kind: 'none', reason: `tag ${release.tag_name} não é versão final` }
  const current = parseVersion(currentVersion)
  if (!current) return { kind: 'error', reason: `versão atual ${currentVersion} ilegível` }
  if (compareVersions(latest, current) <= 0) return { kind: 'none', reason: `${latest.join('.')} não é maior que ${currentVersion}` }
  const version = latest.join('.')
  const dmgName = updateAssetName(version)
  const dmg = release.assets.find((asset) => asset.name === dmgName)
  const sha = release.assets.find((asset) => asset.name === `${dmgName}.sha256`)
  if (!dmg || !sha) return { kind: 'none', reason: `release ${release.tag_name} sem ${dmgName} e o .sha256` }
  if (!isReleaseDownloadUrl(dmg.browser_download_url) || !isReleaseDownloadUrl(sha.browser_download_url)) {
    return { kind: 'none', reason: 'asset fora do repositório' }
  }
  return {
    kind: 'available',
    release: {
      version,
      notes: releaseNotes(release.body),
      dmg: { name: dmgName, url: dmg.browser_download_url, size: dmg.size ?? null },
      sha256Url: sha.browser_download_url,
    },
  }
}

/** Uma consulta à API. Nunca lança: falta de internet, limite (403) e resposta estranha viram `error`. */
export async function checkLatestRelease(fetch: FetchLike, currentVersion: string, timeoutMs = API_TIMEOUT_MS): Promise<CheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', 'user-agent': userAgent(currentVersion) },
      signal: controller.signal,
      redirect: 'error',
    })
    if (response.status === 404) return { kind: 'none', reason: 'nenhum release publicado' }
    if (response.status !== 200) return { kind: 'error', reason: `GitHub respondeu ${response.status}` }
    let body: unknown
    try {
      body = JSON.parse(await response.text())
    } catch {
      return { kind: 'error', reason: 'resposta não é JSON' }
    }
    return evaluateRelease(body, currentVersion)
  } catch (error) {
    return { kind: 'error', reason: controller.signal.aborted ? 'tempo esgotado' : error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
