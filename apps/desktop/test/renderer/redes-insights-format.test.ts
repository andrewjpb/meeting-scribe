// Contrato 75: os números das métricas em pt-BR (`1.284`, `12,3 mil`, "—"), a nota do atraso da Meta e a ordenação da
// tabela das publicações.
import { describe, expect, it } from 'vitest'
import type { MediaInsights } from '../../src/shared/redes'
import { followsLabel, metricNumber, metricsNote, nextSort, periodRange, sortMedia, updatedAgo } from '../../src/renderer/src/features/redes/metricsFormat'

const NOW = Date.parse('2026-11-20T15:00:00.000Z')
const HOUR = 3_600_000

describe('números em pt-BR (contrato 75)', () => {
  it('metricNumber: "—", 1.284, 12,3 mil a partir de 10.000, mi a partir de 1 milhão', () => {
    expect(metricNumber(null)).toBe('—')
    expect(metricNumber(0)).toBe('0')
    expect(metricNumber(1284)).toBe('1.284')
    expect(metricNumber(9999)).toBe('9.999')
    expect(metricNumber(10_000)).toBe('10 mil')
    expect(metricNumber(12_345)).toBe('12,3 mil')
    expect(metricNumber(999_960)).toBe('1 mi')
    expect(metricNumber(1_250_000)).toBe('1,3 mi')
    expect(followsLabel({ follows: 12, unfollows: 3 })).toBe('+12 · −3')
    expect(followsLabel(null)).toBe('—')
  })

  it('a nota do atraso, o período e a ordenação da tabela', () => {
    expect(updatedAgo(null, NOW)).toBe('ainda não atualizado')
    expect(updatedAgo(new Date(NOW - 30_000).toISOString(), NOW)).toBe('atualizado agora')
    expect(metricsNote({ updatedAt: new Date(NOW - 7 * 60_000).toISOString() }, NOW)).toBe('Dados do Instagram com até 48 h de atraso · atualizado há 7 min')
    expect(updatedAgo(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe('atualizado há 2 h')
    expect(periodRange({ since: new Date(2026, 9, 22, 15).toISOString(), until: new Date(2026, 10, 19, 15).toISOString() })).toBe('22/10 a 19/11')

    const row = (id: string, likes: number | null, timestamp: string, caption = ''): MediaInsights => ({ mediaId: id, caption, permalink: null, timestamp, mediaType: 'IMAGE', views: 1, reach: 1, likes, comments: 0, saved: 0, shares: 0, totalInteractions: 0, thumbPath: null, fetchedAt: timestamp })
    const rows = [row('1', 10, '2026-11-01T00:00:00.000Z', 'Beta'), row('2', null, '2026-11-03T00:00:00.000Z', 'alfa'), row('3', 40, '2026-11-02T00:00:00.000Z', 'Ágil')]
    const byLikes = nextSort({ column: 'views', direction: 'desc' }, 'likes')
    expect(byLikes).toEqual({ column: 'likes', direction: 'desc' })
    expect(sortMedia(rows, byLikes).map((item) => item.mediaId)).toEqual(['3', '1', '2'])
    expect(sortMedia(rows, nextSort(byLikes, 'likes')).map((item) => item.mediaId)).toEqual(['1', '3', '2'])
    expect(sortMedia(rows, nextSort(byLikes, 'publicacao')).map((item) => item.mediaId)).toEqual(['3', '2', '1'])
    expect(sortMedia(rows, { column: 'data', direction: 'desc' }).map((item) => item.mediaId)).toEqual(['2', '3', '1'])
  })
})
