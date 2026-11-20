// Contrato 71 (R4): o contador da legenda e o tipo da publicação pelas mídias, as duas funções puras que a tela e o
// serviço usam antes de salvar o rascunho.
import { describe, expect, it } from 'vitest'
import { captionStats, inferPublicationType, type PublicationMediaKind } from '../src/shared/redes'

const kinds = (...list: PublicationMediaKind[]): { kind: PublicationMediaKind }[] => list.map((kind) => ({ kind }))

describe('captionStats (contrato 71)', () => {
  it('conta caracteres por ponto de código, hashtags e menções', () => {
    expect(captionStats('Reunião boa 🎉 #lap #reunioes com @andrew e @lap.software')).toEqual({ chars: 56, hashtags: 2, mentions: 2, problems: [] })
    expect(captionStats('')).toEqual({ chars: 0, hashtags: 0, mentions: 0, problems: [] })
  })

  it('não conta email nem o # no meio de uma palavra', () => {
    expect(captionStats('fale com oi@lap.com.br, item#3 e C# #ok').hashtags).toBe(1)
    expect(captionStats('fale com oi@lap.com.br').mentions).toBe(0)
  })

  it('passa dos limites da Meta com a razão em pt-BR', () => {
    const long = captionStats('a'.repeat(2201))
    expect(long.problems).toEqual(['Legenda acima de 2.200 caracteres'])
    expect(captionStats('a'.repeat(2200)).problems).toEqual([])
    const tags = Array.from({ length: 31 }, (_, index) => `#t${index}`).join(' ')
    expect(captionStats(tags).problems).toEqual(['Mais de 30 hashtags na legenda'])
    const mentions = Array.from({ length: 21 }, (_, index) => `@p${index}`).join(' ')
    expect(captionStats(mentions).problems).toEqual(['Mais de 20 menções (@) na legenda'])
    expect(captionStats(Array.from({ length: 30 }, (_, index) => `#t${index}`).join(' ')).problems).toEqual([])
  })
})

describe('inferPublicationType (contrato 71)', () => {
  it('1 imagem, 2 a 10 imagens e 1 vídeo', () => {
    expect(inferPublicationType(kinds('imagem'))).toBe('imagem')
    expect(inferPublicationType(kinds('imagem', 'imagem'))).toBe('carrossel')
    expect(inferPublicationType(kinds(...Array<PublicationMediaKind>(10).fill('imagem')))).toBe('carrossel')
    expect(inferPublicationType(kinds('video'))).toBe('reels')
  })

  it('recusa com a razão: nada, mais de 10, vídeo com imagem, dois vídeos', () => {
    expect(inferPublicationType([])).toEqual({ error: 'Escolha ao menos uma imagem ou um vídeo' })
    expect(inferPublicationType(kinds(...Array<PublicationMediaKind>(11).fill('imagem')))).toEqual({ error: 'Carrossel aceita no máximo 10 imagens' })
    expect(inferPublicationType(kinds('video', 'imagem'))).toEqual({ error: 'Vídeo não entra em carrossel: publique o vídeo sozinho' })
    expect(inferPublicationType(kinds('video', 'video'))).toEqual({ error: 'Só um vídeo por publicação' })
  })
})
