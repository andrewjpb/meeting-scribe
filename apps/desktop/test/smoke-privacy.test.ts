// Contrato 158 (CA2, CA3): as conferências de privacidade dos checks do Painel de e-mail no smoke.
import { describe, expect, it } from 'vitest'
import { leakedLines, numericDetail } from '../src/main/smoke-privacy'

describe('numericDetail', () => {
  it.each(['analyzed=6 attention=6 replies=3 moveGroups=1 moveRows=3 error=false', 'refused=5', 'lines=0 leaked=false'])('aprova %s', (detail) => {
    expect(numericDetail(detail)).toBe(true)
  })

  it.each(['', 'assunto=Cronograma', 'analyzed=6  error=false', 'analyzed=6; error=false', 'from="Marina" n=1', 'n=1.5', 'n=-1', 'é=1', '=1', 'analyzed', 'analyzed=6 error'])('reprova %s', (detail) => {
    expect(numericDetail(detail)).toBe(false)
  })
})

describe('leakedLines', () => {
  const needles = ['Cronograma da fase 2', 'Marina Costa', 'marina.costa@cliente.example']

  it('aceita as linhas só com números e o modelo', () => {
    expect(leakedLines(['email-dashboard: contas=1 analisadas=6 baixadas=6 chamadas=1 falhas=0 modelo=haiku custo=? ms=40'], needles)).toBe(0)
  })

  it('acusa o assunto, o remetente e o endereço injetados no log, sem diferença de caixa', () => {
    const lines = ['email-dashboard: contas=1 analisadas=6', 'resumo: cronograma DA FASE 2 pronto', 'de Marina Costa', '<MARINA.COSTA@cliente.example>']
    expect(leakedLines(lines, needles)).toBe(3)
  })

  it('ignora agulhas vazias', () => {
    expect(leakedLines(['qualquer linha'], ['', '  '])).toBe(0)
  })
})
