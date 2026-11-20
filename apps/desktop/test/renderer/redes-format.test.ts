// Contrato 72: os textos da fila de publicações, da cota e da inspeção da mídia no editor (pt-BR, hora local do Mac).
import { describe, expect, it } from 'vitest'
import type { Publication } from '../../src/shared/redes'
import { bytesLabel, mediaInspection, publicationLine, quotaLine, ratioLabel, relativeWhen, scheduleWhen } from '../../src/renderer/src/features/redes/redesFormat'

const local = (day: number, hour: number, minute = 0): string => new Date(2026, 10, day, hour, minute).toISOString()
const NOW = new Date(2026, 10, 20, 15, 0)

const publication = (patch: Partial<Publication>): Publication => ({
  id: '00000000-0000-4000-8000-000000000000',
  accountId: '1',
  type: 'imagem',
  media: [],
  caption: '',
  scheduledAt: null,
  state: 'rascunho',
  error: null,
  attempts: 0,
  creationId: null,
  publishedMediaId: null,
  permalink: null,
  publishedAt: null,
  createdAt: local(20, 8),
  updatedAt: local(20, 8),
  ...patch,
})
const media = (count: number): Publication['media'] => Array.from({ length: count }, () => ({}) as Publication['media'][number])

describe('textos da fila (contrato 72)', () => {
  it('relativeWhen: hoje, ontem ou o dia, com a hora', () => {
    expect(relativeWhen(local(20, 8), NOW)).toBe('hoje às 08:00')
    expect(relativeWhen(local(19, 23, 5), NOW)).toBe('ontem às 23:05')
    expect(relativeWhen(local(11, 9), NOW)).toBe('11/11 às 09:00')
  })

  it('scheduleWhen: o dia da semana abreviado com maiúscula', () => {
    expect(scheduleWhen(local(21, 10))).toBe('Sáb., 21/11 às 10:00')
    expect(scheduleWhen(local(25, 18, 30))).toBe('Qua., 25/11 às 18:30')
  })

  it('publicationLine: o tipo (com as mídias do carrossel) e o estado ou a data', () => {
    expect(publicationLine(publication({ state: 'erro', updatedAt: local(20, 8) }), NOW, false)).toBe('Imagem · falhou hoje às 08:00')
    expect(publicationLine(publication({ type: 'carrossel', media: media(2), updatedAt: local(20, 9, 40) }), NOW, false)).toBe('Carrossel · 2 mídias · editado hoje às 09:40')
    expect(publicationLine(publication({ type: 'carrossel', media: media(2) }), NOW, true)).toBe('Carrossel · 2 mídias · editando')
    expect(publicationLine(publication({ state: 'agendada', scheduledAt: local(21, 10) }), NOW, false)).toBe('Imagem · Sáb., 21/11 às 10:00')
    expect(publicationLine(publication({ state: 'publicada', type: 'reels', publishedAt: local(18, 12) }), NOW, false)).toBe('Reels · 18/11')
    expect(publicationLine(publication({ state: 'publicando' }), NOW, false)).toBe('Imagem · Publicando…')
    // Contrato 76: o rascunho do Assistente, ainda sem mídia.
    expect(publicationLine(publication({ updatedAt: local(20, 9) }), NOW, false)).toBe('Sem mídia · editado hoje às 09:00')
  })

  it('quotaLine: a cota lida, consultando ou indisponível', () => {
    expect(quotaLine(undefined)).toBe('Cota da Meta: consultando…')
    expect(quotaLine('consultando')).toBe('Cota da Meta: consultando…')
    expect(quotaLine({ used: 3, total: 50, checkedAt: local(20, 8) })).toBe('Cota da Meta: 3 de 50 publicações nas últimas 24 h')
    expect(quotaLine('indisponivel')).toBe('Cota da Meta: não foi possível consultar agora')
  })
})

describe('inspeção da mídia (contrato 72)', () => {
  it('ratioLabel e bytesLabel', () => {
    expect(ratioLabel(1080, 1350)).toBe('4:5')
    expect(ratioLabel(640, 800)).toBe('4:5')
    expect(ratioLabel(1000, 751)).toBe('1,3:1')
    expect(bytesLabel(412 * 1024)).toBe('412 KB')
    expect(bytesLabel(4.1 * 1024 * 1024)).toBe('4,1 MB')
  })

  it('a linha da imagem e a do vídeo', () => {
    expect(mediaInspection({ kind: 'imagem', mimeType: 'image/jpeg', width: 1080, height: 1350, bytes: 412 * 1024, durationSeconds: null })).toBe('JPEG 1080 × 1350 (4:5) · 412 KB · dentro das especificações')
    expect(mediaInspection({ kind: 'video', mimeType: 'video/mp4', width: 1080, height: 1920, bytes: 4.1 * 1024 * 1024, durationSeconds: 12 })).toBe('MP4 1080 × 1920 · 12 s · 4,1 MB · dentro das especificações')
  })
})
