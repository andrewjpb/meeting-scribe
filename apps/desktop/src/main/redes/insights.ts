// Métricas do Instagram (contrato 75, R7 e CA12 da spec redes-instagram): a conta no período (7, 28 ou 90 dias) e as 25
// publicações mais recentes, lidas pelo `InstagramClient` e guardadas em `instagram-<id>.metrics.json` (um arquivo à
// parte do da conta, na mesma fila de escrita dela: a gravação da fila de publicações não apaga as métricas, e
// vice-versa). Cada período e as mídias valem 1 h no cache; o "Atualizar" lê de novo.
//
// A Meta recusa (código 100) a métrica que não existe para aquela conta ou mídia, e recusa o pedido inteiro junto. Aí
// cada métrica é pedida sozinha: a recusada vira `null` (o "—" da tela) e fica de fora por 24 h, sem erro na tela.
// O intervalo entre `since` e `until` é de no máximo 30 dias: 90 dias vão em três janelas, somadas (só a métrica que veio
// nas três; faltando numa, `null`). Alcance e contas engajadas contam pessoas únicas, que não se somam entre janelas;
// nesse caso ficam `null` em vez de um número inflado.
//
// As miniaturas vêm da CDN do Instagram, que a CSP do renderer não deixa carregar: o mesmo mecanismo dos comentários
// (contrato 73), uma vez por mídia para `userData/redes/thumbs/<mídia>.jpg`, e a tela pede a data URL pelo
// `scribe:redes-media-thumb`, como na fila.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { HttpFetch } from '../accounts/http'
import { METRIC_PERIODS, METRICS_CACHE_MS, METRICS_MEDIA_LIMIT, type AccountInsights, type MediaInsights, type MetricPeriod, type RedesAccount, type RedesMetricsState } from '../../shared/redes'
import { downloadThumbnail } from './comments'
import { ACCOUNT_METRICS, MEDIA_METRICS, type AccountMetric, type InstagramClient, type InstagramFailure, type InstagramMedia, type MediaMetric } from './instagram-client'
import type { RedesStore } from './store'

const CACHE_VERSION = 1
const DAY_S = 86_400
const DAY_MS = DAY_S * 1000
/** O maior intervalo que a Meta aceita entre `since` e `until`. */
export const INSIGHTS_WINDOW_DAYS = 30
/** A métrica recusada fica de fora por este tempo (depois, tenta de novo). */
export const DENIED_RETRY_MS = DAY_MS
/** Pedidos de mídia ao mesmo tempo. */
const MEDIA_CONCURRENCY = 5
/** As métricas de pessoas únicas: não se somam entre janelas. */
const UNIQUE_METRICS: readonly AccountMetric[] = ['reach', 'accounts_engaged']

/** As miniaturas registradas no cache (as mais antigas saem do registro, não do disco). */
const THUMBS_REGISTRY_MAX = 500

export const METRICS_FAILED_MESSAGE = 'Não foi possível ler as métricas do Instagram'

const count = z.number().int().nonnegative().nullable()
const isoDate = z.iso.datetime({ offset: true })
const accountInsightsSchema = z
  .object({
    period: z.literal(METRIC_PERIODS),
    since: isoDate,
    until: isoDate,
    followers: count,
    reach: count,
    views: count,
    accountsEngaged: count,
    totalInteractions: count,
    likes: count,
    comments: count,
    saves: count,
    shares: count,
    followsAndUnfollows: z.object({ follows: z.number().int().nonnegative(), unfollows: z.number().int().nonnegative() }).strict().nullable(),
    profileLinksTaps: count,
    fetchedAt: isoDate,
  })
  .strict()
const mediaInsightsSchema = z
  .object({
    mediaId: z.string().regex(/^\d{1,40}$/),
    caption: z.string().max(10_000),
    permalink: z.string().max(2000).nullable(),
    timestamp: isoDate,
    mediaType: z.string().max(40),
    views: count,
    reach: count,
    likes: count,
    comments: count,
    saved: count,
    shares: count,
    totalInteractions: count,
    thumbPath: z.string().max(4096).nullable(),
    fetchedAt: isoDate,
  })
  .strict()
const cacheSchema = z
  .object({
    version: z.literal(CACHE_VERSION),
    account: z.object({ '7': accountInsightsSchema.optional(), '28': accountInsightsSchema.optional(), '90': accountInsightsSchema.optional() }).strict(),
    media: z.array(mediaInsightsSchema).max(100),
    /** ISO da última lista de mídias lida. */
    mediaFetchedAt: isoDate.nullable(),
    /** As métricas recusadas pela Meta: da conta, e das mídias por tipo; `at` é quando a lista começou. */
    denied: z.object({ account: z.array(z.enum(ACCOUNT_METRICS)), media: z.record(z.string().max(40), z.array(z.enum(MEDIA_METRICS))), at: isoDate.nullable() }).strict(),
    updatedAt: isoDate.nullable(),
    /** Todas as miniaturas que as métricas baixaram (o "Remover" da conta apaga cada uma, mesmo a que saiu das 25). */
    thumbs: z.array(z.string().max(4096)).max(THUMBS_REGISTRY_MAX).default([]),
  })
  .strict()
export type MetricsCache = z.infer<typeof cacheSchema>

/** O que `loadMetrics` usa do `RedesStore`. */
export type MetricsStore = Pick<RedesStore, 'readMetrics' | 'updateMetrics'>

const emptyCache = (): MetricsCache => ({ version: CACHE_VERSION, account: {}, media: [], mediaFetchedAt: null, denied: { account: [], media: {}, at: null }, updatedAt: null, thumbs: [] })

/** O cache da conta; arquivo ausente ou inválido vale como vazio. */
export async function readMetricsCache(store: Pick<RedesStore, 'readMetrics'>, accountId: string): Promise<MetricsCache> {
  return parseCache(await store.readMetrics(accountId).catch(() => null))
}

const parseCache = (raw: unknown): MetricsCache => {
  const parsed = cacheSchema.safeParse(raw)
  return parsed.success ? parsed.data : emptyCache()
}

const union = <T>(...lists: readonly (readonly T[])[]): T[] => [...new Set(lists.flat())]

/** As recusas que ainda valem (24 h desde a primeira). */
const liveDenied = (denied: MetricsCache['denied'], at: number): MetricsCache['denied'] => (denied.at && at - Date.parse(denied.at) < DENIED_RETRY_MS ? denied : { account: [], media: {}, at: null })

/** O estado da tela a partir do cache (as mídias da mais nova para a mais antiga). */
export function metricsStateOf(accountId: string, cache: MetricsCache, error: string | null = null): RedesMetricsState {
  const account = Object.fromEntries(METRIC_PERIODS.map((period) => [period, cache.account[String(period) as '7' | '28' | '90'] ?? null])) as Record<MetricPeriod, AccountInsights | null>
  const media = [...cache.media].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, METRICS_MEDIA_LIMIT)
  return { accountId, account, media, error, updatedAt: cache.updatedAt }
}

/**
 * As janelas de um período, em UNIX (segundos): `until` é agora e `since`, `period` dias antes; acima de 30 dias, em
 * pedaços de até 30, do mais antigo ao mais novo.
 */
export function periodWindows(period: MetricPeriod, nowMs: number): { since: number; until: number }[] {
  const until = Math.floor(nowMs / 1000)
  const since = until - period * DAY_S
  const windows: { since: number; until: number }[] = []
  for (let start = since; start < until; start += INSIGHTS_WINDOW_DAYS * DAY_S) windows.push({ since: start, until: Math.min(until, start + INSIGHTS_WINDOW_DAYS * DAY_S) })
  return windows
}

/**
 * A miniatura de uma mídia em `thumbs/<mídia>.jpg` (baixada uma vez pelo `downloadThumbnail` do contrato 73; a que já
 * está lá, dos comentários ou de antes, não é baixada de novo). Vídeo e Reels pela capa (`thumbnail_url`); imagem e
 * carrossel pela própria `media_url`. Devolve o caminho, ou `null` sem miniatura.
 */
export function createThumbSaver(fetch: HttpFetch, store: Pick<RedesStore, 'thumbsDir'>): (media: InstagramMedia) => Promise<string | null> {
  return async (media) => {
    if (!/^\d{1,40}$/.test(media.id)) return null
    const file = join(await store.thumbsDir(false), `${media.id}.jpg`)
    if (await stat(file).then((info) => info.isFile() && info.size > 0, () => false)) return file
    const url = media.mediaType === 'VIDEO' ? media.thumbnailUrl : (media.mediaUrl ?? media.thumbnailUrl)
    if (!url) return null
    await store.thumbsDir(true)
    return (await downloadThumbnail(fetch, url, file)) ? file : null
  }
}

export interface LoadMetricsOptions {
  /** "Atualizar": lê de novo mesmo com o cache valendo. */
  force?: boolean
  /** A miniatura de cada mídia (o `createThumbSaver`); sem ele, nenhuma. */
  saveThumb?: (media: InstagramMedia) => Promise<string | null>
}

type Values<M extends string> = Partial<Record<M, number>>
type Tolerant<M extends string, E> = { ok: true; values: Values<M>; extra: E | null; denied: M[] } | InstagramFailure

/**
 * Pede `metrics` de uma vez; na recusa com código 100, uma por uma: a recusada sai (vai em `denied`) e as outras ficam.
 * Se todas forem recusadas, é o pedido que está errado (não as métricas): devolve a falha, sem marcar nenhuma.
 */
async function tolerant<M extends string, E>(metrics: readonly M[], call: (metrics: readonly M[]) => Promise<({ ok: true; values: Values<M> } & { extra?: E | null }) | InstagramFailure>): Promise<Tolerant<M, E>> {
  if (!metrics.length) return { ok: true, values: {}, extra: null, denied: [] }
  const first = await call(metrics)
  if (first.ok) return { ok: true, values: first.values, extra: first.extra ?? null, denied: [] }
  if (first.code !== 100 || metrics.length === 1) return first
  const values: Values<M> = {}
  const denied: M[] = []
  let extra: E | null = null
  for (const metric of metrics) {
    const one = await call([metric])
    if (one.ok) {
      Object.assign(values, one.values)
      extra = one.extra ?? extra
    } else if (one.code === 100) denied.push(metric)
    else return one
  }
  return denied.length === metrics.length ? first : { ok: true, values, extra, denied }
}

async function pool<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      out[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

/** Os números da conta no período: as janelas somadas, com os seguidores de agora. */
async function fetchAccount(client: InstagramClient, token: string, account: RedesAccount, period: MetricPeriod, at: number, deniedBefore: readonly AccountMetric[]): Promise<{ ok: true; insights: AccountInsights; denied: AccountMetric[] } | InstagramFailure> {
  const windows = periodWindows(period, at)
  const metrics = ACCOUNT_METRICS.filter((metric) => !deniedBefore.includes(metric))
  const totals: Values<AccountMetric> = {}
  /** Em quantas janelas cada métrica veio. */
  const seen = new Map<AccountMetric, number>()
  const denied = new Set<AccountMetric>()
  const follows = { follows: 0, unfollows: 0 }
  let followsSeen = 0
  for (const window of windows) {
    const result = await tolerant<AccountMetric, { follows: number; unfollows: number }>(metrics, async (list) => {
      const response = await client.accountInsights(token, account.id, window.since, window.until, { metrics: list })
      return response.ok ? { ok: true, values: response.values, extra: response.follows } : response
    })
    if (!result.ok) return result
    for (const metric of result.denied) denied.add(metric)
    let windowFollows = result.extra
    // Sem a divisão em ganhos e perdidos na resposta, o `follows_and_unfollows` de novo com `breakdown=follow_type`.
    if (!windowFollows && metrics.includes('follows_and_unfollows') && !denied.has('follows_and_unfollows')) {
      const split = await client.accountInsights(token, account.id, window.since, window.until, { metrics: ['follows_and_unfollows'], breakdown: 'follow_type' })
      if (split.ok) windowFollows = split.follows
      else if (split.code !== 100) return split
    }
    if (windowFollows) {
      follows.follows += windowFollows.follows
      follows.unfollows += windowFollows.unfollows
      followsSeen++
    }
    for (const metric of ACCOUNT_METRICS) {
      const value = result.values[metric]
      if (value === undefined) continue
      totals[metric] = (totals[metric] ?? 0) + value
      seen.set(metric, (seen.get(metric) ?? 0) + 1)
    }
  }
  const followers = await client.followersCount(token)
  // Só a soma da métrica que veio em todas as janelas: faltando numa, o total sairia pela metade, então vira `null`
  // ("—"). As de pessoas únicas, com mais de uma janela, também (não se somam).
  const total = (metric: AccountMetric): number | null => {
    if (seen.get(metric) !== windows.length || (windows.length > 1 && UNIQUE_METRICS.includes(metric))) return null
    return totals[metric] ?? null
  }
  const first = windows[0]
  const last = windows[windows.length - 1]
  return {
    ok: true,
    denied: [...denied],
    insights: {
      period,
      since: new Date((first?.since ?? 0) * 1000).toISOString(),
      until: new Date((last?.until ?? 0) * 1000).toISOString(),
      followers: followers.ok ? (followers.followers ?? account.followers) : account.followers,
      reach: total('reach'),
      views: total('views'),
      accountsEngaged: total('accounts_engaged'),
      totalInteractions: total('total_interactions'),
      likes: total('likes'),
      comments: total('comments'),
      saves: total('saves'),
      shares: total('shares'),
      followsAndUnfollows: followsSeen === windows.length ? { ...follows } : null,
      profileLinksTaps: total('profile_links_taps'),
      fetchedAt: new Date(at).toISOString(),
    },
  }
}

/**
 * Contrato 75: as métricas de uma conta num período. Lê o cache; o período e as mídias que passaram de 1 h (ou todos,
 * com `force`) vão à Meta, e o resultado volta ao cache. Falha da Meta não apaga o que já estava: o estado leva os
 * números de antes e a mensagem em `error`.
 */
export async function loadMetrics(client: InstagramClient, token: string, account: RedesAccount, period: MetricPeriod, store: MetricsStore, now: () => number, options: LoadMetricsOptions = {}): Promise<RedesMetricsState> {
  const at = now()
  const cache = await readMetricsCache(store, account.id)
  const fresh = (iso: string | null | undefined): boolean => Boolean(iso) && at - Date.parse(iso ?? '') < METRICS_CACHE_MS && Date.parse(iso ?? '') <= at
  const key = String(period) as '7' | '28' | '90'
  const accountStale = options.force === true || !fresh(cache.account[key]?.fetchedAt)
  const mediaStale = options.force === true || !fresh(cache.mediaFetchedAt)
  if (!accountStale && !mediaStale) return metricsStateOf(account.id, cache)

  // As recusas valem 24 h; depois, a Meta pode ter passado a entregar.
  const denied = liveDenied(cache.denied, at)
  const next: MetricsCache = { ...cache, account: { ...cache.account }, denied: { account: [...denied.account], media: { ...denied.media }, at: denied.at } }
  const deny = (): void => {
    next.denied.at ??= new Date(at).toISOString()
  }
  let error: string | null = null
  let insights: AccountInsights | null = null
  let rows: MediaInsights[] | null = null

  if (accountStale) {
    const result = await fetchAccount(client, token, account, period, at, next.denied.account).catch((): InstagramFailure => ({ ok: false, error: METRICS_FAILED_MESSAGE, code: null, subcode: null }))
    if (result.ok) {
      insights = result.insights
      if (result.denied.length) {
        next.denied.account = [...new Set([...next.denied.account, ...result.denied])]
        deny()
      }
    } else error = result.error
  }

  if (mediaStale) {
    const list = await client.recentMedia(token, account.id, METRICS_MEDIA_LIMIT).catch((): InstagramFailure => ({ ok: false, error: METRICS_FAILED_MESSAGE, code: null, subcode: null }))
    if (!list.ok) error ??= list.error
    else {
      const failures: string[] = []
      rows = await pool(list.media, MEDIA_CONCURRENCY, async (media): Promise<MediaInsights> => {
        const before = cache.media.find((item) => item.mediaId === media.id)
        const typeDenied = next.denied.media[media.mediaType] ?? []
        const result = await tolerant<MediaMetric, never>(
          MEDIA_METRICS.filter((metric) => !typeDenied.includes(metric)),
          (metrics) => client.mediaInsights(token, media.id, metrics),
        ).catch((): InstagramFailure => ({ ok: false, error: METRICS_FAILED_MESSAGE, code: null, subcode: null }))
        if (result.ok && result.denied.length) {
          next.denied.media[media.mediaType] = [...new Set([...(next.denied.media[media.mediaType] ?? []), ...result.denied])]
          deny()
        }
        if (!result.ok) failures.push(result.error)
        const value = (metric: MediaMetric): number | null => (result.ok ? (result.values[metric] ?? null) : null)
        const thumbPath = (await options.saveThumb?.(media).catch(() => null)) ?? before?.thumbPath ?? null
        // A mídia que falhou agora fica com os números de antes (se havia).
        if (!result.ok && before) return { ...before, caption: media.caption, permalink: media.permalink, thumbPath }
        return {
          mediaId: media.id,
          caption: media.caption,
          permalink: media.permalink,
          timestamp: media.timestamp,
          mediaType: media.mediaType,
          views: value('views'),
          reach: value('reach'),
          likes: value('likes'),
          comments: value('comments'),
          saved: value('saved'),
          shares: value('shares'),
          totalInteractions: value('total_interactions'),
          thumbPath,
          fetchedAt: new Date(at).toISOString(),
        }
      })
      // Uma mídia sem números (recém-publicada, apagada no meio) não é erro; todas, é.
      if (rows.length && failures.length === rows.length) error ??= failures[0] ?? METRICS_FAILED_MESSAGE
    }
  }

  // Gravado em cima do que está no arquivo agora, na fila da conta: outra leitura (outro período) que terminou no meio
  // tempo fica; daqui entram só o período lido, as mídias (se lidas), as recusas novas e as miniaturas.
  const stamp = new Date(at).toISOString()
  const apply = (current: MetricsCache): MetricsCache => {
    const kept = liveDenied(current.denied, at)
    const media = { ...kept.media }
    for (const [type, list] of Object.entries(next.denied.media)) media[type] = union(media[type] ?? [], list)
    const firstAt = [kept.at, next.denied.at].filter((value): value is string => value !== null).sort()[0] ?? null
    return {
      ...current,
      account: insights ? { ...current.account, [key]: insights } : current.account,
      ...(rows ? { media: rows, mediaFetchedAt: stamp } : {}),
      denied: { account: union(kept.account, next.denied.account), media, at: firstAt },
      updatedAt: error === null ? stamp : current.updatedAt,
      thumbs: union(current.thumbs, (rows ?? []).flatMap((item) => (item.thumbPath ? [item.thumbPath] : []))).slice(-THUMBS_REGISTRY_MAX),
    }
  }
  const saved = await store.updateMetrics(account.id, (raw) => apply(parseCache(raw))).catch(() => null)
  return metricsStateOf(account.id, saved ?? apply(cache), error)
}
