// Contrato 30: as operações novas da lista (resolver, reabrir, mover, o lote da IA), a seleção "só trechos novos" do
// ciclo, o filtro e as contas do quadro. Sem DOM.
import { describe, expect, it } from 'vitest'
import type { MeetingNote } from '@shared/meeting-notes'
import type { RuntimeSegment } from '@shared/transcription'
import { aiNotesKnownTitles, aiNotesOpenCards, aiNotesSelection, aiNotesShouldSkip } from '../../src/renderer/src/features/live/aiNotes'
import { CANVAS_CARD_HEIGHT, CANVAS_CARD_WIDTH, noteTilt, positionToPx, pxToPosition } from '../../src/renderer/src/features/notes/NotesBoard'
import { filterNotes } from '../../src/renderer/src/features/notes/NotesFilter'
import { aiNote, applyAiBatch, clampPosition, createNote, editNote, moveNote, reopenNote, resolveNote } from '../../src/renderer/src/features/notes/noteList'

const NOW = Date.parse('2026-11-18T15:00:00.000Z')
const manual = (id: string, text = 'manual'): MeetingNote => ({ ...createNote(1000, NOW, id), text })

describe('card da IA e estados (CA1, CA3)', () => {
  it('card da IA: azul, com título, aberto; sem descrição o texto fica vazio (o card mostra só o título)', () => {
    expect(aiNote('  Janela  ', 'Sábado?', 5000, NOW, 'a')).toMatchObject({ id: 'a', title: 'Janela', text: 'Sábado?', color: 'blue', origin: 'ia', status: 'aberta', atMs: 5000 })
    expect(aiNote('Só título', ' ', null, NOW, 'b').text).toBe('')
  })

  it('concluir com motivo e reabrir; já resolvido não muda; a pessoa mexendo num card da IA o marca userEdited', () => {
    const list = [aiNote('A', 'a', 0, NOW, 'ia1'), manual('m1')]
    const done = resolveNote(list, 'm1', { reason: '  Feito.  ', by: 'manual', atMs: 9_000.4 }, NOW)
    expect(done[1]).toMatchObject({ status: 'resolvida', resolution: { reason: 'Feito.', by: 'manual', atMs: 9000 } })
    expect(done[1]?.userEdited).toBeUndefined()
    expect(resolveNote(done, 'm1', { reason: 'de novo', by: 'manual', atMs: null }, NOW)).toBe(done)
    // A IA resolveu enquanto a pessoa escrevia o motivo: o "Concluir" dela vale; resolvido pela pessoa, nada muda.
    const byAiFirst = resolveNote(list, 'ia1', { reason: 'pela IA', by: 'ia', atMs: 1 }, NOW)
    const manualWins = resolveNote(byAiFirst, 'ia1', { reason: 'pela pessoa', by: 'manual', atMs: 2 }, NOW)
    expect(manualWins[0]).toMatchObject({ resolution: { reason: 'pela pessoa', by: 'manual', atMs: 2 }, userEdited: true })
    expect(resolveNote(manualWins, 'ia1', { reason: 'IA de novo', by: 'ia', atMs: 3 }, NOW)).toBe(manualWins)
    expect(resolveNote(manualWins, 'ia1', { reason: 'outra pessoa', by: 'manual', atMs: 3 }, NOW)).toBe(manualWins)
    const reopened = reopenNote(done, 'm1', NOW)
    expect(reopened[1]?.status).toBe('aberta')
    expect(reopened[1]?.resolution).toBeUndefined()
    expect(reopenNote(reopened, 'm1', NOW)).toBe(reopened)
    expect(resolveNote(list, 'ia1', { reason: '', by: 'manual', atMs: null }, NOW)[0]?.userEdited).toBe(true)
    const byAi = resolveNote(list, 'ia1', { reason: 'x'.repeat(600), by: 'ia', atMs: 1 }, NOW)[0]
    expect(byAi?.userEdited).toBeUndefined()
    expect(byAi?.resolution?.reason).toHaveLength(500)
  })

  it('editar texto ou título de um card da IA marca userEdited; cor não; card manual nunca', () => {
    const list = [aiNote('A', 'a', 0, NOW, 'ia1'), manual('m1')]
    expect(editNote(list, 'ia1', { color: 'pink' }, NOW)[0]?.userEdited).toBeUndefined()
    expect(editNote(list, 'ia1', { title: 'B' }, NOW)[0]).toMatchObject({ title: 'B', userEdited: true })
    expect(editNote(list, 'ia1', { text: 'outro' }, NOW)[0]?.userEdited).toBe(true)
    expect(editNote(list, 'm1', { text: 'outro' }, NOW)[1]?.userEdited).toBeUndefined()
    expect(editNote(list, 'ia1', { title: 'x'.repeat(200) }, NOW)[0]?.title).toHaveLength(120)
    expect(editNote(list, 'ia1', { title: 'A' }, NOW)).toBe(list)
  })

  it('mover: posição sempre entre 0 e 1; a mesma posição não muda a lista', () => {
    expect(clampPosition({ x: -0.5, y: 1.7 })).toEqual({ x: 0, y: 1 })
    expect(clampPosition({ x: Number.NaN, y: 0.4 })).toEqual({ x: 0, y: 0.4 })
    const moved = moveNote([manual('m1')], 'm1', { x: 0.3, y: 2 }, NOW)
    expect(moved[0]?.position).toEqual({ x: 0.3, y: 1 })
    expect(moveNote(moved, 'm1', { x: 0.3, y: 1 }, NOW)).toBe(moved)
  })
})

describe('lote da IA (CA2)', () => {
  it('novos entram em cima, sem repetir título; resolve só card da IA aberto e não mexido', () => {
    const ia = aiNote('Aberto', 'a', 0, NOW, 'ia1')
    const edited = { ...aiNote('Editado', 'e', 0, NOW, 'ia2'), userEdited: true }
    const closed = resolveNote([aiNote('Fechado', 'f', 0, NOW, 'ia3')], 'ia3', { reason: 'antes', by: 'ia', atMs: 0 }, NOW)[0] as MeetingNote
    const list = [ia, edited, closed, manual('m1')]
    let n = 0
    const next = applyAiBatch(
      list,
      {
        created: [{ title: 'Novo', description: 'n', atMs: 60_000 }, { title: ' aberto ', description: 'repetido' }, { title: 'Futuro', description: 'f', atMs: 999_999 }],
        resolved: [{ id: 'ia1', reason: 'Decidido.' }, { id: 'ia2', reason: 'x' }, { id: 'ia3', reason: 'y' }, { id: 'm1', reason: 'z' }],
      },
      120_000,
      NOW,
      () => `novo-${++n}`,
    )
    expect(next.map((note) => note.id)).toEqual(['novo-2', 'novo-1', 'ia1', 'ia2', 'ia3', 'm1'])
    expect(next[1]).toMatchObject({ title: 'Novo', atMs: 60_000, origin: 'ia' })
    // Tempo depois de agora não vale: fica o momento do ciclo.
    expect(next[0]).toMatchObject({ title: 'Futuro', atMs: 120_000 })
    expect(next[2]).toMatchObject({ status: 'resolvida', resolution: { reason: 'Decidido.', by: 'ia', atMs: 120_000 } })
    expect(next[3]).toBe(edited)
    expect(next[4]).toBe(closed)
    expect(next[5]).toBe(list[3])
    // A IA nunca apaga nem edita texto.
    expect(next.filter((note) => list.some((old) => old.id === note.id)).map((note) => note.text)).toEqual(list.map((note) => note.text))
  })

  it('cards enviados: só os da IA abertos e não mexidos; títulos de todos, sem repetir', () => {
    const notes = [aiNote('A', 'a', 0, NOW, 'ia1'), { ...aiNote('B', 'b', 0, NOW, 'ia2'), userEdited: true }, { ...manual('m1'), title: 'A' }, manual('m2')]
    expect(aiNotesOpenCards(notes)).toEqual([{ id: 'ia1', title: 'A', text: 'a' }])
    expect(aiNotesKnownTitles(notes)).toEqual(['A', 'B'])
    expect(aiNotesOpenCards(Array.from({ length: 60 }, (_, i) => aiNote(`T${i}`, 't', 0, NOW, `x${i}`)))).toHaveLength(50)
  })
})

describe('seleção do ciclo (CA2)', () => {
  const segment = (id: string, text: string, patch: Partial<RuntimeSegment> = {}): RuntimeSegment => ({
    id,
    source: 'mic',
    speaker: null,
    startMs: 1000,
    endMs: 2000,
    text,
    translation: null,
    translationModel: null,
    partial: false,
    turnOrder: 0,
    sessionId: 's',
    translationState: 'none',
    ...patch,
  } as RuntimeSegment)

  it('só finais, sem eco, com texto e que nenhum ciclo mandou; nomes do Meet no trecho do sistema', () => {
    const segments = [segment('a', 'Já foi.'), segment('b', 'Novo trecho.'), segment('c', 'Parcial', { partial: true }), segment('d', 'Eco', { echo: true }), segment('e', '   '), segment('f', 'Do sistema.', { source: 'system', speaker: 'A' })]
    const selection = aiNotesSelection(segments, new Set(['a']), (item) => (item.source === 'system' ? ['Ana'] : []))
    expect(selection.ids).toEqual(['b', 'f'])
    expect(selection.segments).toEqual([
      { source: 'mic', speaker: null, startMs: 1000, endMs: 2000, text: 'Novo trecho.' },
      { source: 'system', speaker: 'A', startMs: 1000, endMs: 2000, text: 'Do sistema.', names: ['Ana'] },
    ])
    expect(selection.chars).toBe('Novo trecho.'.length + 'Do sistema.'.length)
  })

  it('menos de 200 caracteres novos: o ciclo é pulado', () => {
    expect(aiNotesShouldSkip(aiNotesSelection([segment('a', 'x'.repeat(199))], new Set()))).toBe(true)
    expect(aiNotesShouldSkip(aiNotesSelection([segment('a', 'x'.repeat(120)), segment('b', 'y'.repeat(80))], new Set()))).toBe(false)
    expect(aiNotesShouldSkip(aiNotesSelection([segment('a', 'x'.repeat(300))], new Set(['a'])))).toBe(true)
  })
})

describe('filtro e quadro (CA3, CA4)', () => {
  it('Abertas, Resolvidas e Todas mantêm a ordem da lista', () => {
    const list = resolveNote([manual('a'), manual('b'), manual('c')], 'b', { reason: '', by: 'manual', atMs: null }, NOW)
    expect(filterNotes(list, 'abertas').map((note) => note.id)).toEqual(['a', 'c'])
    expect(filterNotes(list, 'resolvidas').map((note) => note.id)).toEqual(['b'])
    expect(filterNotes(list, 'todas').map((note) => note.id)).toEqual(['a', 'b', 'c'])
  })

  it('posição em frações do espaço livre: o card nunca sai do quadro; ida e volta iguais', () => {
    const board = { width: 1000, height: 700 }
    expect(positionToPx({ x: 1, y: 1 }, board)).toEqual({ x: 1000 - CANVAS_CARD_WIDTH, y: 700 - CANVAS_CARD_HEIGHT })
    expect(positionToPx({ x: 2, y: -1 }, board)).toEqual({ x: 1000 - CANVAS_CARD_WIDTH, y: 0 })
    expect(pxToPosition({ x: 380, y: 265 }, board)).toEqual({ x: 0.5, y: 0.5 })
    expect(pxToPosition({ x: 9999, y: -5 }, board)).toEqual({ x: 1, y: 0 })
    expect(pxToPosition({ x: 10, y: 10 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 0 })
    // Com a altura medida do card (card longo), o fim do quadro segura o card inteiro.
    expect(positionToPx({ x: 0, y: 1 }, board, 400)).toEqual({ x: 0, y: 300 })
    expect(pxToPosition({ x: 0, y: 150 }, board, 400)).toEqual({ x: 0, y: 0.5 })
  })

  it('rotação leve e sempre a mesma por id, entre −2° e +2°', () => {
    const tilts = Array.from({ length: 200 }, (_, i) => noteTilt(`nota-${i}`))
    expect(tilts.every((tilt) => tilt >= -2 && tilt <= 2)).toBe(true)
    expect(noteTilt('abc')).toBe(noteTilt('abc'))
    expect(new Set(tilts).size).toBeGreaterThan(10)
  })
})
