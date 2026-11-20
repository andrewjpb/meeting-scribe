// Contrato 75: as métricas do Instagram (o `total_value` da conta, os períodos em UNIX, o cache de 1 h, a métrica
// recusada e o arquivo próprio ao lado do da conta), com o Instagram falso em memória. Os números em pt-BR estão em
// `renderer/redes-insights-format.test.ts`.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HttpFetch } from '../src/main/accounts/http'
import type { RedesAccount } from '../src/shared/redes'
import { createFakeInstagram, FAKE_IG_SEED_MEDIA, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, type FakeInstagram } from '../src/main/redes/fake-instagram'
import { createInstagramClient, INSTAGRAM_API_VERSION } from '../src/main/redes/instagram-client'
import { createThumbSaver, DENIED_RETRY_MS, loadMetrics, periodWindows, readMetricsCache, type MetricsStore } from '../src/main/redes/insights'
import { createRedesStore } from '../src/main/redes/store'
import { createRedesService } from '../src/main/redes/service'
import { testMediaHost } from '../src/main/redes/media-host'
import type { SafeStorageLike } from '../src/main/secrets'

const NOW = Date.parse('2026-11-20T15:00:00.000Z')
const HOUR = 3_600_000

const account: RedesAccount = {
  id: SMOKE_IG_USER_ID,
  rede: 'instagram',
  username: 'lap.teste',
  name: 'LAP Teste',
  accountType: 'business',
  pictureUrl: null,
  followers: 1000,
  mediaCount: 37,
  tokenExpiresAt: '2027-01-19T12:00:00.000Z',
  refreshedAt: '2026-11-20T12:00:00.000Z',
  connectedAt: '2026-11-20T12:00:00.000Z',
  state: 'conectada',
  error: null,
}

const memoryStore = (): MetricsStore & { data: unknown; writes: number } => {
  const store = {
    data: null as unknown,
    writes: 0,
    readMetrics: () => Promise.resolve(store.data),
    updateMetrics: <T>(_accountId: string, change: (current: unknown) => T): Promise<T | null> => {
      const next = change(store.data)
      store.data = JSON.parse(JSON.stringify(next)) as unknown
      store.writes++
      return Promise.resolve(next)
    },
  }
  return store
}

const insightCalls = (fake: FakeInstagram): string[] => fake.calls.filter((call) => call.path.endsWith('/insights')).map((call) => call.path)

/** Um `HttpFetch` que guarda as URLs e responde sempre o mesmo corpo. */
const recording = (body: unknown): { fetch: HttpFetch; urls: URL[] } => {
  const urls: URL[] = []
  const fetch: HttpFetch = (url) => {
    urls.push(new URL(url))
    const text = JSON.stringify(body)
    return Promise.resolve({ status: 200, header: () => 'application/json', text: () => Promise.resolve(text), bytes: () => Promise.resolve(new Uint8Array(Buffer.from(text))) })
  }
  return { fetch, urls }
}

describe('cliente: insights (contrato 75)', () => {
  it('accountInsights: o total_value de cada métrica, since/until em UNIX, period=day e metric_type=total_value', async () => {
    const { fetch, urls } = recording({
      data: [
        { name: 'reach', period: 'day', total_value: { value: 8412 } },
        { name: 'views', period: 'day', total_value: { value: 21930 } },
        { name: 'likes', period: 'day', total_value: { value: -1 } },
        { name: 'follows_and_unfollows', period: 'day', total_value: { value: 70, breakdowns: [{ dimension_keys: ['follow_type'], results: [{ dimension_values: ['FOLLOWER'], value: 58 }, { dimension_values: ['NON_FOLLOWER'], value: 12 }] }] } },
        { name: 'impressions', period: 'day', total_value: { value: 1 } },
      ],
    })
    const result = await createInstagramClient(fetch).accountInsights(SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, 1_761_177_600, 1_763_596_800)
    expect(result).toEqual({ ok: true, values: { reach: 8412, views: 21930, follows_and_unfollows: 70 }, follows: { follows: 58, unfollows: 12 } })
    const url = urls[0]
    expect(url?.pathname).toBe(`/${INSTAGRAM_API_VERSION}/${SMOKE_IG_USER_ID}/insights`)
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      metric: 'reach,views,accounts_engaged,total_interactions,likes,comments,saves,shares,follows_and_unfollows,profile_links_taps',
      period: 'day',
      metric_type: 'total_value',
      since: '1761177600',
      until: '1763596800',
    })
    expect(url?.searchParams.has('access_token')).toBe(false)
  })

  it('mediaInsights: o lifetime em values[0], e o total_value também; a métrica que não veio fica de fora', async () => {
    const { fetch, urls } = recording({ data: [{ name: 'views', period: 'lifetime', values: [{ value: 9640 }] }, { name: 'reach', total_value: { value: 6118 } }] })
    expect(await createInstagramClient(fetch).mediaInsights(SMOKE_IG_TOKEN, '18000000000000001')).toEqual({ ok: true, values: { views: 9640, reach: 6118 } })
    expect(urls[0]?.searchParams.get('metric')).toBe('views,reach,likes,comments,saved,shares,total_interactions')
  })

  it('recentMedia e followersCount pelo falso', async () => {
    const fake = createFakeInstagram({ now: () => NOW })
    const client = createInstagramClient(fake.fetch)
    const recent = await client.recentMedia(SMOKE_IG_TOKEN, SMOKE_IG_USER_ID)
    expect(recent.ok && recent.media.length).toBe(25)
    expect(recent.ok && recent.media[0]).toMatchObject({ id: '18100000000000001', mediaType: 'VIDEO', caption: 'Como a gente grava e resume reuniões' })
    expect(await client.followersCount(SMOKE_IG_TOKEN)).toEqual({ ok: true, followers: 1284 })
  })
})

describe('períodos (contrato 75)', () => {
  it('7 e 28 dias numa janela; 90 dias em três de 30, sem buraco', () => {
    const until = Math.floor(NOW / 1000)
    expect(periodWindows(7, NOW)).toEqual([{ since: until - 7 * 86_400, until }])
    expect(periodWindows(28, NOW)).toEqual([{ since: until - 28 * 86_400, until }])
    const ninety = periodWindows(90, NOW)
    expect(ninety).toHaveLength(3)
    expect(ninety[0]?.since).toBe(until - 90 * 86_400)
    expect(ninety[2]?.until).toBe(until)
    ninety.slice(1).forEach((window, index) => expect(window.since).toBe(ninety[index]?.until))
    expect(ninety.every((window) => Number.isInteger(window.since) && window.until - window.since <= 30 * 86_400)).toBe(true)
  })
})

describe('loadMetrics (contrato 75)', () => {
  let fake: FakeInstagram
  let clock: number
  beforeEach(() => {
    clock = NOW
    fake = createFakeInstagram({ now: () => clock })
  })

  it('a conta e as 25 mídias; o cache vale 1 h por período; "Atualizar" lê de novo', async () => {
    const client = createInstagramClient(fake.fetch)
    const store = memoryStore()
    const first = await loadMetrics(client, SMOKE_IG_TOKEN, account, 28, store, () => clock)
    expect(first.error).toBeNull()
    expect(first.account[28]).toMatchObject({ period: 28, followers: 1284, reach: 290 * 28 + 17, views: 760 * 28 + 41, accountsEngaged: 21 * 28 + 5, likes: 39 * 28 + 4, followsAndUnfollows: { follows: 58, unfollows: 14 }, profileLinksTaps: 59 })
    expect(first.account[7]).toBeNull()
    expect(first.media).toHaveLength(25)
    expect(first.media.every((item) => item.views !== null && item.likes !== null && item.totalInteractions === (item.likes ?? 0) + (item.comments ?? 0) + (item.saved ?? 0) + (item.shares ?? 0))).toBe(true)
    expect(first.updatedAt).toBe(new Date(NOW).toISOString())
    const calls = fake.calls.length

    clock = NOW + HOUR - 1
    const cached = await loadMetrics(client, SMOKE_IG_TOKEN, account, 28, store, () => clock)
    expect(fake.calls.length).toBe(calls)
    expect(cached.account[28]).toEqual(first.account[28])

    // Outro período: só a conta vai à Meta (as mídias ainda valem).
    await loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock)
    expect(fake.calls.slice(calls).every((call) => !call.path.endsWith('/media'))).toBe(true)
    const afterSeven = fake.calls.length

    const forced = await loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock, { force: true })
    expect(fake.calls.length).toBeGreaterThan(afterSeven)
    expect(forced.account[7]?.views).toBe(760 * 7 + 41)
    expect(forced.account[28]).toEqual(first.account[28])

    clock = NOW + HOUR + 1
    const before = fake.calls.length
    await loadMetrics(client, SMOKE_IG_TOKEN, account, 28, store, () => clock)
    expect(fake.calls.length).toBeGreaterThan(before)
  })

  it('90 dias: as janelas somadas; alcance e contas engajadas (pessoas únicas) ficam null', async () => {
    const state = await loadMetrics(createInstagramClient(fake.fetch), SMOKE_IG_TOKEN, account, 90, memoryStore(), () => clock)
    expect(state.error).toBeNull()
    expect(insightCalls(fake).filter((path) => path.includes(SMOKE_IG_USER_ID))).toHaveLength(6)
    expect(state.account[90]).toMatchObject({ views: 3 * (760 * 30 + 41), likes: 3 * (39 * 30 + 4), reach: null, accountsEngaged: null, followsAndUnfollows: { follows: 3 * 62, unfollows: 45 } })
    expect(Date.parse(state.account[90]?.until ?? '') - Date.parse(state.account[90]?.since ?? '')).toBe(90 * 86_400_000)
  })

  it('90 dias: a métrica que faltou numa das janelas vira null (não a soma das outras)', async () => {
    const base = createInstagramClient(fake.fetch)
    const middle = Math.floor(clock / 1000) - 60 * 86_400
    const client = {
      ...base,
      accountInsights: async (...args: Parameters<typeof base.accountInsights>) => {
        const result = await base.accountInsights(...args)
        if (result.ok && args[2] === middle) delete result.values.likes
        return result
      },
    }
    const state = await loadMetrics(client, SMOKE_IG_TOKEN, account, 90, memoryStore(), () => clock)
    expect(state.account[90]).toMatchObject({ likes: null, views: 3 * (760 * 30 + 41) })
  })

  it('dois períodos lidos ao mesmo tempo não se apagam no arquivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redes-insights-par-'))
    try {
      const store = createRedesStore(join(dir, 'redes'))
      await store.writeAccount(account)
      const client = createInstagramClient(fake.fetch)
      await Promise.all([loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock), loadMetrics(client, SMOKE_IG_TOKEN, account, 28, store, () => clock), loadMetrics(client, SMOKE_IG_TOKEN, account, 90, store, () => clock)])
      const cache = await readMetricsCache(store, account.id)
      expect([cache.account['7']?.views, cache.account['28']?.views, cache.account['90']?.views]).toEqual([760 * 7 + 41, 760 * 28 + 41, 3 * (760 * 30 + 41)])
      expect(cache.media).toHaveLength(25)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a métrica recusada (código 100) vira null, sem erro, e fica de fora por 24 h', async () => {
    fake.denyMetric('views')
    const client = createInstagramClient(fake.fetch)
    const store = memoryStore()
    const state = await loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock)
    expect(state.error).toBeNull()
    expect(state.account[7]).toMatchObject({ views: null, reach: 290 * 7 + 17, likes: 39 * 7 + 4 })
    expect(state.media).toHaveLength(25)
    expect(state.media.every((item) => item.views === null && item.reach !== null)).toBe(true)
    const cache = await readMetricsCache(store, account.id)
    expect(cache.denied.account).toEqual(['views'])
    expect(Object.values(cache.denied.media).every((list) => list.includes('views'))).toBe(true)

    // De novo (forçado): ninguém pede `views`, e cada pedido sai de uma vez só.
    const before = fake.calls.length
    const again = await loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock, { force: true })
    expect(again.account[7]?.views).toBeNull()
    // O lote da conta, o `follows_and_unfollows` com `breakdown`, os seguidores, a lista e as 25 mídias.
    expect(fake.calls.length - before).toBe(1 + 1 + 1 + 1 + 25)

    // 24 h depois, tenta de novo (e a Meta voltou a entregar).
    fake.allowMetrics()
    clock += DENIED_RETRY_MS + 1
    const later = await loadMetrics(client, SMOKE_IG_TOKEN, account, 7, store, () => clock)
    expect(later.account[7]?.views).toBe(760 * 7 + 41)
  })

  it('a falha da Meta guarda os números de antes e devolve a mensagem', async () => {
    const store = memoryStore()
    await loadMetrics(createInstagramClient(fake.fetch), SMOKE_IG_TOKEN, account, 7, store, () => clock)
    const offline: HttpFetch = () => Promise.reject(new TypeError('fetch failed'))
    const failed = await loadMetrics(createInstagramClient(offline), SMOKE_IG_TOKEN, account, 7, store, () => clock, { force: true })
    expect(failed.error).toBe('Não foi possível falar com o Instagram')
    expect(failed.account[7]?.views).toBe(760 * 7 + 41)
    expect(failed.media).toHaveLength(25)
    expect(failed.updatedAt).toBe(new Date(NOW).toISOString())
  })

  it('miniatura: baixada uma vez da CDN para thumbs/<mídia>.jpg', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redes-insights-'))
    try {
      const root = join(dir, 'redes')
      fake.thumbJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
      const store = createRedesStore(root)
      await store.writeAccount(account)
      const state = await loadMetrics(createInstagramClient(fake.fetch), SMOKE_IG_TOKEN, account, 7, store, () => clock, { saveThumb: createThumbSaver(fake.fetch, store) })
      expect(state.media.every((item) => item.thumbPath === join(root, 'thumbs', `${item.mediaId}.jpg`))).toBe(true)
      expect(readdirSync(join(root, 'thumbs'))).toHaveLength(25)
      const downloads = fake.calls.filter((call) => call.host === 'scontent.cdninstagram.com').length
      expect(downloads).toBe(25)
      await loadMetrics(createInstagramClient(fake.fetch), SMOKE_IG_TOKEN, account, 7, store, () => clock, { force: true, saveThumb: createThumbSaver(fake.fetch, store) })
      expect(fake.calls.filter((call) => call.host === 'scontent.cdninstagram.com').length).toBe(downloads)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('arquivo das métricas (contrato 75)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'redes-metrics-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('instagram-<id>.metrics.json (0600) ao lado do da conta: a fila não apaga as métricas, nem o contrário', async () => {
    const root = join(dir, 'redes')
    const store = createRedesStore(root)
    await store.writeAccount(account)
    const fake = createFakeInstagram({ now: () => NOW })
    await loadMetrics(createInstagramClient(fake.fetch), SMOKE_IG_TOKEN, account, 7, store, () => NOW)
    await store.writePublications(account.id, [])
    await store.writeAccount({ ...account, followers: 2000 })
    const file = join(root, `instagram-${account.id}.metrics.json`)
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600')
    expect((await readMetricsCache(store, account.id)).account['7']?.views).toBe(760 * 7 + 41)
    expect(await store.listAccounts()).toEqual([{ ...account, followers: 2000 }])
    await store.removeMetrics(account.id)
    await store.removeAccount(account.id)
    expect(readdirSync(root)).toEqual([])
    // Conta removida: o cache não volta.
    expect(await store.writeMetrics(account.id, { version: 1 })).toBe(false)
    expect(await store.updateMetrics(account.id, () => ({ version: 1 }))).toBeNull()
    expect(readdirSync(root)).toEqual([])
  })
})

it('o falso tem 30 mídias inventadas além das publicadas', () => {
  expect(createFakeInstagram().mediaList()).toHaveLength(FAKE_IG_SEED_MEDIA)
})

describe('"Remover" a conta (contrato 75)', () => {
  const safeStorage: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
    decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
  }

  it('apaga o cache das métricas e as miniaturas que elas baixaram, sem órfão', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redes-insights-remover-'))
    const fake = createFakeInstagram({ now: () => NOW })
    fake.thumbJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
    const service = createRedesService({ userData: dir, safeStorage, fetch: fake.fetch, onState: () => undefined, now: () => NOW, testMediaHost })
    try {
      await service.init()
      expect((await service.connect({ token: SMOKE_IG_TOKEN })).ok).toBe(true)
      const state = await service.metricsState({ accountId: SMOKE_IG_USER_ID, period: 7 })
      expect(state.media).toHaveLength(25)
      const thumbs = join(dir, 'redes', 'thumbs')
      expect(readdirSync(thumbs)).toHaveLength(25)
      expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.metrics.json`))).toBe(true)
      expect((await service.remove({ accountId: SMOKE_IG_USER_ID })).ok).toBe(true)
      expect(readdirSync(thumbs)).toEqual([])
      expect(readdirSync(join(dir, 'redes')).filter((name) => name.startsWith('instagram-'))).toEqual([])
    } finally {
      service.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
