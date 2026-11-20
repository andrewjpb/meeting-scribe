import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, isMultiSelection, messagesLabel, selectedLabel, selectionReducer, type EmailSelection } from '../../src/renderer/src/features/email/selection'

const order = ['a', 'b', 'c', 'd', 'e']
const run = (steps: Parameters<typeof selectionReducer>[1][], list: readonly string[] = order, start: EmailSelection = EMPTY_SELECTION): EmailSelection =>
  steps.reduce((current, action) => selectionReducer(current, action, list), start)

describe('seleção múltipla (contrato 55, CA4)', () => {
  it('clique simples: só ela, e vira a âncora', () => {
    expect(run([{ type: 'click', id: 'b' }])).toEqual({ ids: ['b'], anchor: 'b' })
    expect(run([{ type: 'click', id: 'b' }, { type: 'click', id: 'd' }])).toEqual({ ids: ['d'], anchor: 'd' })
  })

  it('⌘ clique liga e desliga uma, na ordem da lista', () => {
    const three = run([{ type: 'click', id: 'd' }, { type: 'click', id: 'b', meta: true }, { type: 'click', id: 'c', meta: true }])
    expect(three.ids).toEqual(['b', 'c', 'd'])
    expect(isMultiSelection(three)).toBe(true)
    expect(selectionReducer(three, { type: 'click', id: 'c', meta: true }, order).ids).toEqual(['b', 'd'])
  })

  it('⇧ clique escolhe o intervalo desde a âncora, para baixo e para cima', () => {
    expect(run([{ type: 'click', id: 'b' }, { type: 'click', id: 'd', shift: true }])).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b' })
    expect(run([{ type: 'click', id: 'd' }, { type: 'click', id: 'a', shift: true }])).toEqual({ ids: ['a', 'b', 'c', 'd'], anchor: 'd' })
    // Outro ⇧ clique troca o intervalo, com a mesma âncora.
    expect(run([{ type: 'click', id: 'c' }, { type: 'click', id: 'e', shift: true }, { type: 'click', id: 'a', shift: true }]).ids).toEqual(['a', 'b', 'c'])
    // Sem âncora: só ela.
    expect(run([{ type: 'click', id: 'c', shift: true }])).toEqual({ ids: ['c'], anchor: 'c' })
  })

  it('Esc e troca de pasta limpam', () => {
    const many = run([{ type: 'click', id: 'a' }, { type: 'click', id: 'c', shift: true }])
    expect(selectionReducer(many, { type: 'clear' }, order)).toEqual(EMPTY_SELECTION)
    expect(selectionReducer(many, { type: 'folder' }, order)).toEqual(EMPTY_SELECTION)
  })

  it('mensagem que sumiu da lista sai da seleção (e da âncora)', () => {
    const many = run([{ type: 'click', id: 'b' }, { type: 'click', id: 'd', shift: true }])
    const pruned = selectionReducer(many, { type: 'prune' }, ['a', 'c', 'd', 'e'])
    expect(pruned).toEqual({ ids: ['c', 'd'], anchor: 'c' })
    // Nada mudou: o mesmo objeto (sem render à toa).
    expect(selectionReducer(pruned, { type: 'prune' }, ['a', 'c', 'd', 'e'])).toBe(pruned)
    // Clique numa que não está na lista: nada muda.
    expect(selectionReducer(pruned, { type: 'click', id: 'b' }, ['a', 'c', 'd', 'e'])).toBe(pruned)
  })

  it('textos', () => {
    expect(selectedLabel(3)).toBe('3 selecionadas')
    expect(messagesLabel(1)).toBe('1 mensagem')
    expect(messagesLabel(3)).toBe('3 mensagens')
  })
})
