// Mídia do WhatsApp por clique no renderer (contrato 37): o tempo, a velocidade e a barra do player, o que baixa e o
// que fica chip, os textos de erro, os object URLs (revogados quando o último elemento sai) e o limite dos blobs da
// sessão.
import { describe, expect, it } from 'vitest'
import {
  canDownload,
  createBlobStore,
  createUrlRegistry,
  knownDuration,
  mediaErrorFinal,
  mediaErrorText,
  nextRate,
  OLD_MEDIA_TITLE,
  rateLabel,
  seekRatio,
  supportsDownload,
  timeLabel,
  transcribeErrorText,
} from '../../src/renderer/src/features/whatsapp/media'

describe('renderer: player e blobs (contrato 37)', () => {
  it('tempo, velocidade e a posição clicada', () => {
    expect(timeLabel(0)).toBe('0:00')
    expect(timeLabel(7.9)).toBe('0:07')
    expect(timeLabel(65)).toBe('1:05')
    expect(timeLabel(3723)).toBe('1:02:03')
    expect(timeLabel(Number.NaN)).toBe('0:00')
    expect(timeLabel(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect([nextRate(1), nextRate(1.5), nextRate(2), nextRate(3)]).toEqual([1.5, 2, 1, 1])
    expect([1, 1.5, 2].map(rateLabel)).toEqual(['1x', '1.5x', '2x'])
    expect(seekRatio(150, 100, 200)).toBe(0.25)
    expect(seekRatio(50, 100, 200)).toBe(0)
    expect(seekRatio(400, 100, 200)).toBe(1)
    expect(seekRatio(10, 0, 0)).toBe(0)
    // Ogg sem duração no cabeçalho (`Infinity`): vale a do WhatsApp.
    expect(knownDuration(Number.POSITIVE_INFINITY, 12)).toBe(12)
    expect(knownDuration(3.5, 12)).toBe(3.5)
    expect(knownDuration(Number.NaN, undefined)).toBe(0)
  })

  it('o que baixa, o que fica chip e os textos de erro', () => {
    const media = { kind: 'audio' as const, mime: 'audio/ogg', size: 10, name: null }
    expect(canDownload({ ...media, downloadable: true })).toBe(true)
    expect(canDownload(media)).toBe(false)
    expect(canDownload({ ...media, kind: 'document', downloadable: true })).toBe(false)
    expect(supportsDownload({ ...media, kind: 'sticker' })).toBe(false)
    expect(OLD_MEDIA_TITLE).toBe('Disponível só para mensagens recebidas a partir desta versão')
    expect(mediaErrorText('gone')).toBe('Este arquivo não está mais disponível no WhatsApp')
    expect(mediaErrorText('too-big')).toBe('Arquivo grande demais')
    // "Não está mais disponível" deixa clicar de novo (pode ser falha passageira); só "grande demais" desabilita.
    expect([mediaErrorFinal('gone'), mediaErrorFinal('unavailable'), mediaErrorFinal('too-big')]).toEqual([false, false, true])
    expect(transcribeErrorText('gone')).toBe('Este arquivo não está mais disponível no WhatsApp')
    expect(transcribeErrorText('no-key')).toContain('chave da AssemblyAI')
  })

  it('o object URL é revogado quando o último elemento sai (a remontagem do React não revoga), e os blobs da sessão têm limite', () => {
    const created: Blob[] = []
    const revoked: string[] = []
    const later: (() => void)[] = []
    const api = { createObjectURL: (blob: Blob) => (created.push(blob), `blob:app/${created.length}`), revokeObjectURL: (url: string) => void revoked.push(url) }
    const urls = createUrlRegistry(api, (job) => later.push(job))
    const blob = new Blob([new Uint8Array(4)], { type: 'image/png' })
    const url = urls.urlFor(blob)
    expect(url).toBe('blob:app/1')
    expect(urls.urlFor(blob)).toBe(url)
    // Monta, desmonta e monta de novo na mesma passada (modo estrito): continua valendo.
    urls.acquire(blob)
    urls.release(blob)
    urls.acquire(blob)
    for (const job of later.splice(0)) job()
    expect(revoked).toEqual([])
    // Dois elementos com o mesmo blob: só o último a sair revoga, uma vez.
    urls.acquire(blob)
    urls.release(blob)
    for (const job of later.splice(0)) job()
    expect(revoked).toEqual([])
    urls.release(blob)
    urls.release(blob)
    for (const job of later.splice(0)) job()
    expect(revoked).toEqual(['blob:app/1'])
    expect(urls.live()).toBe(0)
    expect(created).toHaveLength(1)

    const store = createBlobStore(10)
    const of = (size: number): Blob => new Blob([new Uint8Array(size)])
    store.put('a', of(4))
    store.put('b', of(4))
    expect(store.get('a')?.size).toBe(4)
    // Passou de 10 bytes: sai o menos usado (o "b"; o "a" acabou de ser lido).
    store.put('c', of(4))
    expect(store.get('b')).toBeUndefined()
    expect(store.get('a')).toBeDefined()
    expect(store.size()).toBe(8)
    // Um maior que o limite fica sozinho (o da tela de agora).
    store.put('d', of(20))
    expect([store.get('a'), store.get('c')]).toEqual([undefined, undefined])
    expect(store.get('d')?.size).toBe(20)
    store.clear()
    expect(store.size()).toBe(0)
  })
})
