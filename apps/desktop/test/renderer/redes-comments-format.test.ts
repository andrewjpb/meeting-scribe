// Contrato 73: os textos da seção Comentários das redes: a hora relativa de cada comentário e as contagens (pt-BR, hora
// local do Mac).
import { describe, expect, it } from 'vitest'
import { commentAge, commentsCountLabel, unreadLabel } from '../../src/renderer/src/features/redes/commentsFormat'

const MIN = 60_000

describe('textos da seção Comentários (contrato 73)', () => {
  const now = new Date(2026, 10, 20, 15, 0)
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString()
  it('hora relativa em pt-BR', () => {
    expect(commentAge(ago(20_000), now)).toBe('agora')
    expect(commentAge(ago(5 * MIN), now)).toBe('há 5 min')
    expect(commentAge(ago(2 * 60 * MIN + 59 * MIN), now)).toBe('há 2 h')
    expect(commentAge(ago(3 * 24 * 60 * MIN), now)).toBe('há 3 d')
    expect(commentAge(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe('02/11')
    expect(commentAge(new Date(2025, 10, 2, 9, 0).toISOString(), now)).toBe('02/11/2025')
  })
  it('contagens no singular e no plural', () => {
    expect(commentsCountLabel(1)).toBe('1 comentário')
    expect(commentsCountLabel(1284)).toBe('1.284 comentários')
    expect(unreadLabel(1)).toBe('1 novo')
    expect(unreadLabel(3)).toBe('3 novos')
  })
})
