import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchInit, FetchLike, FetchResponse } from '../src/main/assemblyai/gateway'
import { DOWNLOAD_IDLE_TIMEOUT_MS, DOWNLOAD_MAX_BYTES, downloadRelease, parseSha256File, type DownloadRequest } from '../src/main/updates/download'
import {
  checkLatestRelease,
  compareVersions,
  evaluateRelease,
  isAllowedRedirect,
  isReleaseDownloadUrl,
  LATEST_RELEASE_URL,
  parseVersion,
  RELEASE_DOWNLOAD_PREFIX,
  releaseNotes,
  type UpdateRelease,
} from '../src/main/updates/release'
import { CHECK_INTERVAL_MS, createUpdateService, FIRST_CHECK_DELAY_MS, type UpdateTimers } from '../src/main/updates/service'
import { UPDATE_DOWNLOAD_FAILED_MESSAGE, UPDATE_HASH_MISMATCH_MESSAGE, UPDATE_NOTES_MAX, type UpdateState } from '../src/shared/updates'

const DMG = Buffer.alloc(10_000, 'dmg ')
const DMG_SHA = createHash('sha256').update(DMG).digest('hex')

function releaseBody(tag: string, extra: Record<string, unknown> = {}, assets = true): Record<string, unknown> {
  const version = tag.replace(/^v/, '')
  const name = `LAP-Reunioes-${version}-arm64.dmg`
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: 'Notas',
    assets: assets
      ? [
          { name, browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}${tag}/${name}`, size: DMG.length },
          { name: `${name}.sha256`, browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}${tag}/${name}.sha256`, size: 90 },
        ]
      : [],
    ...extra,
  }
}

/** API falsa: devolve `status` e o corpo; guarda cada pedido. */
function fakeApi(status: number, body: unknown, calls: { url: string; init: FetchInit }[] = []): FetchLike {
  return (url, init) => {
    calls.push({ url, init })
    const response: FetchResponse = { status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) }
    return Promise.resolve(response)
  }
}

const chunksOf = (buffer: Buffer, size = 1000): AsyncIterable<Uint8Array> =>
  (async function* () {
    for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size)
  })()

/** Download falso: redireciona para o armazenamento de assets (passando por `allowRedirect`) e entrega. */
function fakeDownload(options: { sha?: string; dmg?: Buffer; redirectTo?: string; failDmg?: boolean } = {}): { request: DownloadRequest; urls: string[] } {
  const urls: string[] = []
  const request: DownloadRequest = (url, { allowRedirect }) => {
    urls.push(url)
    const target = options.redirectTo ?? 'https://release-assets.githubusercontent.com/github-production-release-asset/1/x'
    if (!allowRedirect(target)) return Promise.reject(new Error(`redirecionamento recusado: ${target}`))
    if (url.endsWith('.sha256')) return Promise.resolve({ status: 200, chunks: chunksOf(Buffer.from(`${options.sha ?? DMG_SHA}  arquivo.dmg\n`)) })
    if (options.failDmg) {
      return Promise.resolve({
        status: 200,
        chunks: (async function* () {
          yield Buffer.from('meio')
          throw new Error('conexão caiu')
        })(),
      })
    }
    return Promise.resolve({ status: 200, chunks: chunksOf(options.dmg ?? DMG) })
  }
  return { request, urls }
}

/**
 * Download que entrega o `.sha256` e, do `.dmg`, só o primeiro pedaço; depois para sem fechar a conexão.
 * Guarda os `signal` recebidos para conferir o cancelamento.
 */
function stallingDownload(): { request: DownloadRequest; signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  const request: DownloadRequest = (url, { signal }) => {
    signals.push(signal)
    if (url.endsWith('.sha256')) return Promise.resolve({ status: 200, chunks: chunksOf(Buffer.from(`${DMG_SHA}  a.dmg\n`)) })
    return Promise.resolve({
      status: 200,
      chunks: (async function* () {
        yield DMG.subarray(0, 1000)
        await new Promise(() => undefined)
      })(),
    })
  }
  return { request, signals }
}

function availableRelease(version = '0.2.0'): UpdateRelease {
  const result = evaluateRelease(releaseBody(`v${version}`), '0.1.0')
  if (result.kind !== 'available') throw new Error('release de teste inválido')
  return result.release
}

describe('versão (contrato 14, CA1)', () => {
  it('lê x.y.z com ou sem "v" e recusa pré-release e lixo', () => {
    expect(parseVersion('v0.2.0')).toEqual([0, 2, 0])
    expect(parseVersion('1.10.3')).toEqual([1, 10, 3])
    expect(parseVersion('v0.2.0-beta.1')).toBeNull()
    expect(parseVersion('v0.2')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('compara por número, não por texto', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 0])).toBeGreaterThan(0)
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBeGreaterThan(0)
    expect(compareVersions([0, 1, 0], [0, 1, 0])).toBe(0)
    expect(compareVersions([0, 1, 0], [0, 1, 1])).toBeLessThan(0)
  })

  it('notas em texto simples, até 2 000 caracteres', () => {
    expect(releaseNotes('  a\r\nb  ')).toBe('a\nb')
    expect(releaseNotes(null)).toBe('')
    const long = releaseNotes('x'.repeat(5000))
    expect(long.length).toBe(UPDATE_NOTES_MAX)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('consulta do último release (CA1)', () => {
  it('versão maior com os dois assets: disponível, com a URL do .dmg e do .sha256', async () => {
    const calls: { url: string; init: FetchInit }[] = []
    const result = await checkLatestRelease(fakeApi(200, releaseBody('v0.2.0'), calls), '0.1.0')
    expect(result.kind).toBe('available')
    if (result.kind !== 'available') return
    expect(result.release.version).toBe('0.2.0')
    expect(result.release.dmg.name).toBe('LAP-Reunioes-0.2.0-arm64.dmg')
    expect(result.release.dmg.url).toBe(`${RELEASE_DOWNLOAD_PREFIX}v0.2.0/LAP-Reunioes-0.2.0-arm64.dmg`)
    expect(result.release.sha256Url).toBe(`${RELEASE_DOWNLOAD_PREFIX}v0.2.0/LAP-Reunioes-0.2.0-arm64.dmg.sha256`)
    expect(result.release.notes).toBe('Notas')
    // Só a versão vai no pedido: Accept e User-Agent, nada mais.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(LATEST_RELEASE_URL)
    expect(calls[0]?.url).toBe('https://api.github.com/repos/andrewjpb/meeting-scribe/releases/latest')
    expect(calls[0]?.init.method).toBe('GET')
    expect(calls[0]?.init.headers).toEqual({ accept: 'application/vnd.github+json', 'user-agent': 'LAP-Reunioes/0.1.0' })
    expect(calls[0]?.init.body).toBeUndefined()
  })

  it.each([
    ['igual', 'v0.1.0'],
    ['menor', 'v0.0.9'],
    ['tag de pré-release', 'v0.2.0-beta.1'],
  ])('versão %s: nada a oferecer', async (_name, tag) => {
    expect((await checkLatestRelease(fakeApi(200, releaseBody(tag)), '0.1.0')).kind).toBe('none')
  })

  it('pré-release ou rascunho marcados no release: nada a oferecer', async () => {
    expect((await checkLatestRelease(fakeApi(200, releaseBody('v0.2.0', { prerelease: true })), '0.1.0')).kind).toBe('none')
    expect((await checkLatestRelease(fakeApi(200, releaseBody('v0.2.0', { draft: true })), '0.1.0')).kind).toBe('none')
  })

  it('release sem o .dmg ou sem o .sha256: nada a oferecer', async () => {
    expect((await checkLatestRelease(fakeApi(200, releaseBody('v0.2.0', {}, false)), '0.1.0')).kind).toBe('none')
    const onlyDmg = releaseBody('v0.2.0')
    ;(onlyDmg['assets'] as unknown[]).pop()
    expect((await checkLatestRelease(fakeApi(200, onlyDmg), '0.1.0')).kind).toBe('none')
    // Asset de outro nome (Intel) não serve.
    const intel = releaseBody('v0.2.0', {
      assets: [{ name: 'LAP-Reunioes-0.2.0-x64.dmg', browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}v0.2.0/LAP-Reunioes-0.2.0-x64.dmg` }],
    })
    expect((await checkLatestRelease(fakeApi(200, intel), '0.1.0')).kind).toBe('none')
  })

  it('asset apontando para fora do repositório: nada a oferecer', async () => {
    const name = 'LAP-Reunioes-0.2.0-arm64.dmg'
    const body = releaseBody('v0.2.0', {
      assets: [
        { name, browser_download_url: `https://example.com/${name}` },
        { name: `${name}.sha256`, browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}v0.2.0/${name}.sha256` },
      ],
    })
    expect((await checkLatestRelease(fakeApi(200, body), '0.1.0')).kind).toBe('none')
  })

  it('403 de limite, 500, JSON quebrado e formato estranho viram erro silencioso', async () => {
    expect(await checkLatestRelease(fakeApi(403, { message: 'API rate limit exceeded' }), '0.1.0')).toEqual({ kind: 'error', reason: 'GitHub respondeu 403' })
    expect((await checkLatestRelease(fakeApi(500, {}), '0.1.0')).kind).toBe('error')
    expect((await checkLatestRelease(fakeApi(200, '<html>'), '0.1.0')).kind).toBe('error')
    expect((await checkLatestRelease(fakeApi(200, { tag_name: 3 }), '0.1.0')).kind).toBe('error')
  })

  it('sem release publicado (404): nada a oferecer', async () => {
    expect((await checkLatestRelease(fakeApi(404, { message: 'Not Found' }), '0.1.0')).kind).toBe('none')
  })

  it('sem internet e tempo esgotado: erro, sem lançar', async () => {
    const offline: FetchLike = () => Promise.reject(new TypeError('fetch failed'))
    expect(await checkLatestRelease(offline, '0.1.0')).toEqual({ kind: 'error', reason: 'fetch failed' })
    const hanging: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abortado'))))
    expect(await checkLatestRelease(hanging, '0.1.0', 10)).toEqual({ kind: 'error', reason: 'tempo esgotado' })
  })
})

describe('destinos do download (CA3, CA5)', () => {
  it('só assets do próprio repositório', () => {
    expect(isReleaseDownloadUrl(`${RELEASE_DOWNLOAD_PREFIX}v0.2.0/a.dmg`)).toBe(true)
    expect(isReleaseDownloadUrl('https://github.com/outra/meeting-scribe/releases/download/v0.2.0/a.dmg')).toBe(false)
    expect(isReleaseDownloadUrl('https://github.com/andrewjpb/meeting-scribe/releases/download/../../../outra/x')).toBe(false)
    expect(isReleaseDownloadUrl('http://github.com/andrewjpb/meeting-scribe/releases/download/v0.2.0/a.dmg')).toBe(false)
    expect(isReleaseDownloadUrl('https://user:pw@github.com/andrewjpb/meeting-scribe/releases/download/v0.2.0/a.dmg')).toBe(false)
    expect(isReleaseDownloadUrl('https://github.com:444/andrewjpb/meeting-scribe/releases/download/v0.2.0/a.dmg')).toBe(false)
  })

  it('redirecionamento só para o armazenamento de assets do GitHub', () => {
    expect(isAllowedRedirect('https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2')).toBe(true)
    expect(isAllowedRedirect('https://release-assets.githubusercontent.com/github-production-release-asset/1/2')).toBe(true)
    expect(isAllowedRedirect('http://objects.githubusercontent.com/x')).toBe(false)
    expect(isAllowedRedirect('https://evil.githubusercontent.com/x')).toBe(false)
    expect(isAllowedRedirect('https://objects.githubusercontent.com.evil.com/x')).toBe(false)
    expect(isAllowedRedirect('https://example.com/x')).toBe(false)
  })

  it('lê o hash do arquivo .sha256 do shasum', () => {
    expect(parseSha256File(`${DMG_SHA}  LAP-Reunioes-0.2.0-arm64.dmg\n`)).toBe(DMG_SHA)
    expect(parseSha256File(DMG_SHA.toUpperCase())).toBe(DMG_SHA)
    expect(parseSha256File('não é hash')).toBeNull()
    expect(parseSha256File(`${DMG_SHA}a`)).toBeNull()
  })
})

describe('download do .dmg (CA3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ms-updates-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('baixa em .part, confere o SHA-256 e renomeia; o andamento vai de 0 a 100', async () => {
    const { request, urls } = fakeDownload()
    const progress: number[] = []
    const outcome = await downloadRelease({ request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: dir, onProgress: (p) => progress.push(p) })
    expect(outcome).toEqual({ ok: true, path: join(dir, 'LAP-Reunioes-0.2.0-arm64.dmg') })
    expect(readFileSync(join(dir, 'LAP-Reunioes-0.2.0-arm64.dmg')).equals(DMG)).toBe(true)
    expect(readdirSync(dir)).toEqual(['LAP-Reunioes-0.2.0-arm64.dmg'])
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(100)
    expect(progress).toContain(40)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    expect(urls.every((url) => url.startsWith(RELEASE_DOWNLOAD_PREFIX))).toBe(true)
  })

  it('cria a pasta de Downloads se ela não existir', async () => {
    const missing = join(dir, 'Downloads')
    const outcome = await downloadRelease({ request: fakeDownload().request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: missing })
    expect(outcome).toEqual({ ok: true, path: join(missing, 'LAP-Reunioes-0.2.0-arm64.dmg') })
  })

  it('conexão parada: cancela o pedido depois do prazo sem dados e apaga o .part', async () => {
    expect(DOWNLOAD_IDLE_TIMEOUT_MS).toBe(60_000)
    const { request, signals } = stallingDownload()
    const outcome = await downloadRelease({ request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: dir, idleTimeoutMs: 50 })
    expect(outcome).toMatchObject({ ok: false, reason: 'network' })
    expect(signals.at(-1)?.aborted).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it('maior que o tamanho declarado: cancela e apaga o .part', async () => {
    const { request, signals } = (() => {
      const signals: AbortSignal[] = []
      const inner = fakeDownload().request
      const wrapped: DownloadRequest = (url, options) => {
        signals.push(options.signal)
        return inner(url, options)
      }
      return { request: wrapped, signals }
    })()
    const release = { ...availableRelease(), dmg: { ...availableRelease().dmg, size: 5000 } }
    const outcome = await downloadRelease({ request, release, currentVersion: '0.1.0', downloadsDir: dir })
    expect(outcome).toMatchObject({ ok: false, reason: 'size' })
    expect(signals.at(-1)?.aborted).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it('sem tamanho declarado: teto de 1 GB', async () => {
    expect(DOWNLOAD_MAX_BYTES).toBe(1024 ** 3)
    const release = { ...availableRelease(), dmg: { ...availableRelease().dmg, size: null } }
    const outcome = await downloadRelease({ request: fakeDownload().request, release, currentVersion: '0.1.0', downloadsDir: dir, maxBytes: 4000 })
    expect(outcome).toMatchObject({ ok: false, reason: 'size' })
    expect(readdirSync(dir)).toEqual([])
    // Dentro do teto, baixa normalmente.
    const fits = await downloadRelease({ request: fakeDownload().request, release, currentVersion: '0.1.0', downloadsDir: dir, maxBytes: DMG.length })
    expect(fits.ok).toBe(true)
  })

  it('hash diferente: apaga o arquivo e não renomeia', async () => {
    const { request } = fakeDownload({ sha: 'a'.repeat(64) })
    const outcome = await downloadRelease({ request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: dir })
    expect(outcome).toMatchObject({ ok: false, reason: 'hash' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('redirecionamento para outro lugar: recusado, nada gravado', async () => {
    const { request } = fakeDownload({ redirectTo: 'https://example.com/x.dmg' })
    const outcome = await downloadRelease({ request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: dir })
    expect(outcome).toMatchObject({ ok: false, reason: 'network' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('conexão que cai no meio: apaga o .part', async () => {
    const { request } = fakeDownload({ failDmg: true })
    const outcome = await downloadRelease({ request, release: availableRelease(), currentVersion: '0.1.0', downloadsDir: dir })
    expect(outcome).toMatchObject({ ok: false, reason: 'network' })
    expect(readdirSync(dir)).toEqual([])
  })

  it('URL do release fora do repositório: nem pede', async () => {
    const { request, urls } = fakeDownload()
    const release = { ...availableRelease(), dmg: { ...availableRelease().dmg, url: 'https://example.com/a.dmg' } }
    const outcome = await downloadRelease({ request, release, currentVersion: '0.1.0', downloadsDir: dir })
    expect(outcome.ok).toBe(false)
    expect(urls.some((url) => url.startsWith('https://example.com'))).toBe(false)
    expect(existsSync(join(dir, 'LAP-Reunioes-0.2.0-arm64.dmg'))).toBe(false)
  })
})

/** Relógio manual: guarda os callbacks e dispara quando o teste mandar. */
function manualTimers(): UpdateTimers & { timeouts: { ms: number; fn: () => void }[]; intervals: { ms: number; fn: () => void }[]; cleared: number } {
  const timers = {
    timeouts: [] as { ms: number; fn: () => void }[],
    intervals: [] as { ms: number; fn: () => void }[],
    cleared: 0,
    setTimeout: (fn: () => void, ms: number) => timers.timeouts.push({ ms, fn }),
    setInterval: (fn: () => void, ms: number) => timers.intervals.push({ ms, fn }),
    clear: () => {
      timers.cleared++
    },
  }
  return timers
}

describe('serviço de atualização (CA1 a CA3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ms-updates-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function service(overrides: { fetch?: FetchLike; request?: DownloadRequest; auto?: boolean; openPath?: (path: string) => Promise<string>; idleTimeoutMs?: number } = {}) {
    const states: UpdateState[] = []
    const opened: string[] = []
    const quit = vi.fn()
    const timers = manualTimers()
    const logs: string[] = []
    const updates = createUpdateService({
      currentVersion: '0.1.0',
      fetch: overrides.fetch ?? fakeApi(200, releaseBody('v0.2.0')),
      request: overrides.request ?? fakeDownload().request,
      downloadsDir: dir,
      openPath:
        overrides.openPath ??
        ((path) => {
          opened.push(path)
          return Promise.resolve('')
        }),
      quit,
      autoCheck: () => Promise.resolve(overrides.auto ?? true),
      onState: (state) => states.push(state),
      log: (message) => logs.push(message),
      now: () => Date.UTC(2026, 10, 15, 21, 5),
      timers,
      ...(overrides.idleTimeoutMs ? { idleTimeoutMs: overrides.idleTimeoutMs } : {}),
    })
    return { updates, states, opened, quit, timers, logs }
  }

  it('agenda a primeira consulta para 30 s depois de abrir e as seguintes a cada 6 h', async () => {
    const calls: { url: string; init: FetchInit }[] = []
    const { updates, timers } = service({ fetch: fakeApi(200, releaseBody('v0.2.0'), calls) })
    updates.start()
    expect(timers.timeouts.map((t) => t.ms)).toEqual([FIRST_CHECK_DELAY_MS])
    expect(timers.intervals.map((t) => t.ms)).toEqual([CHECK_INTERVAL_MS])
    expect(FIRST_CHECK_DELAY_MS).toBe(30_000)
    expect(CHECK_INTERVAL_MS).toBe(6 * 3600 * 1000)
    expect(calls).toHaveLength(0)
    timers.timeouts[0]?.fn()
    await vi.waitFor(() => expect(updates.state().available?.version).toBe('0.2.0'))
    timers.intervals[0]?.fn()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    updates.dispose()
    expect(timers.cleared).toBe(2)
  })

  it('com "Procurar automaticamente" desligado, o agendamento não consulta; o botão consulta', async () => {
    const calls: { url: string; init: FetchInit }[] = []
    const { updates, timers } = service({ fetch: fakeApi(200, releaseBody('v0.2.0'), calls), auto: false })
    updates.start()
    timers.timeouts[0]?.fn()
    timers.intervals[0]?.fn()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(0)
    const state = await updates.check()
    expect(calls).toHaveLength(1)
    expect(state.available).toEqual({ version: '0.2.0', notes: 'Notas' })
    expect(state.lastCheckedAt).toBe('2026-11-15T21:05:00.000Z')
    expect(state.checking).toBe(false)
  })

  it('erro de rede ou 403 não muda o aviso nem a última verificação; só o log', async () => {
    const { updates, states, logs } = service({ fetch: fakeApi(403, { message: 'rate limit' }) })
    const state = await updates.check()
    expect(state).toEqual({ currentVersion: '0.1.0', checking: false, lastCheckedAt: null, available: null, download: { phase: 'idle' } })
    expect(states.map((s) => s.checking)).toEqual([true, false])
    expect(logs.join('\n')).toContain('403')
  })

  it('versão igual: sem aviso, com a hora da verificação', async () => {
    const { updates } = service({ fetch: fakeApi(200, releaseBody('v0.1.0')) })
    const state = await updates.check()
    expect(state.available).toBeNull()
    expect(state.lastCheckedAt).toBe('2026-11-15T21:05:00.000Z')
  })

  it('"Atualizar": baixa, mostra o andamento, confere, abre o .dmg e fica esperando o botão de fechar', async () => {
    const { updates, states, opened, quit } = service()
    await updates.check()
    expect(updates.quit()).toBe(false)
    expect(updates.download().download).toEqual({ phase: 'downloading', percent: 0 })
    // Clique repetido no meio não abre um segundo download.
    expect(updates.download().download.phase).toBe('downloading')
    await updates.idle()
    expect(updates.state().download).toEqual({ phase: 'ready' })
    const percents = states.flatMap((s) => (s.download.phase === 'downloading' ? [s.download.percent] : []))
    expect(percents).toContain(40)
    expect(percents.at(-1)).toBe(100)
    expect(opened).toEqual([join(dir, 'LAP-Reunioes-0.2.0-arm64.dmg')])
    expect(quit).not.toHaveBeenCalled()
    expect(updates.quit()).toBe(true)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('hash diferente: a mensagem de arquivo que não confere e nada aberto', async () => {
    const { updates, opened } = service({ request: fakeDownload({ sha: 'b'.repeat(64) }).request })
    await updates.check()
    updates.download()
    await updates.idle()
    expect(updates.state().download).toEqual({ phase: 'failed', message: UPDATE_HASH_MISMATCH_MESSAGE })
    expect(opened).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(updates.quit()).toBe(false)
  })

  it('falha de rede no download ou ao abrir: mensagem para tentar de novo', async () => {
    const offline = service({ request: () => Promise.reject(new Error('sem rede')) })
    await offline.updates.check()
    offline.updates.download()
    await offline.updates.idle()
    expect(offline.updates.state().download).toEqual({ phase: 'failed', message: UPDATE_DOWNLOAD_FAILED_MESSAGE })

    const notOpened = service({ openPath: () => Promise.resolve('não abriu') })
    await notOpened.updates.check()
    notOpened.updates.download()
    await notOpened.updates.idle()
    expect(notOpened.updates.state().download).toEqual({ phase: 'failed', message: UPDATE_DOWNLOAD_FAILED_MESSAGE })
  })

  it('download parado: mensagem para tentar de novo e o botão volta (outro download começa)', async () => {
    const { updates } = service({ request: stallingDownload().request, idleTimeoutMs: 50 })
    await updates.check()
    updates.download()
    await updates.idle()
    expect(updates.state().download).toEqual({ phase: 'failed', message: UPDATE_DOWNLOAD_FAILED_MESSAGE })
    expect(readdirSync(dir)).toEqual([])
    expect(updates.download().download).toEqual({ phase: 'downloading', percent: 0 })
    await updates.idle()
  })

  it('saída do app no meio do download: cancela o pedido e apaga o .part', async () => {
    const { request, signals } = stallingDownload()
    const { updates } = service({ request })
    await updates.check()
    updates.download()
    await vi.waitFor(() => expect(readdirSync(dir)).toEqual(['LAP-Reunioes-0.2.0-arm64.dmg.part']))
    updates.dispose()
    expect(readdirSync(dir)).toEqual([])
    await updates.idle()
    expect(signals.at(-1)?.aborted).toBe(true)
    expect(readdirSync(dir)).toEqual([])
    expect(updates.state().download).toEqual({ phase: 'idle' })
  })

  it('sem versão nova, "Atualizar" não faz nada', async () => {
    const { updates, states } = service({ fetch: fakeApi(200, releaseBody('v0.1.0')) })
    await updates.check()
    const before = states.length
    expect(updates.download().download).toEqual({ phase: 'idle' })
    expect(states.length).toBe(before)
  })
})
