// Contrato 13, CA5: o salvar das anotações no detalhe, fora do componente. Espera de 500 ms, salvar ao
// sair do card e da aba, nova tentativa depois de falhar, uma gravação por vez na ordem certa e o
// "Desfazer" por 5 s. Canal e relógio falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingNote } from '@shared/meeting-notes'
import { isDirty, useMeetingNotes } from '../../src/renderer/src/features/meetings/notesStore'

const AT = '2026-11-15T20:00:00.000Z'
const NOTE: MeetingNote = { id: 'a', text: 'Antes', color: 'yellow', atMs: 1_000, createdAt: AT, updatedAt: AT }

type Save = { meetingId: string; notes: MeetingNote[] }

describe('anotações do detalhe (notesStore)', () => {
  const invoke = vi.fn()
  const saves = (): Save[] => invoke.mock.calls.filter(([channel]) => channel === 'scribe:notes-save').map(([, request]) => request as Save)
  const entry = () => useMeetingNotes.getState().meetings['m1']
  const store = () => useMeetingNotes.getState()
  const dirty = (): boolean => {
    const current = entry()
    if (!current) throw new Error('reunião sem anotações no store')
    return isDirty(current)
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'scribe:notes-get' ? [NOTE] : true))
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useMeetingNotes.setState({ meetings: {} })
    await store().load('m1')
  })
  afterEach(() => {
    store().forget('m1')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lê do main; digitar salva 500 ms depois da última tecla, uma vez, com o texto mais novo', async () => {
    expect(entry()).toMatchObject({ status: 'ready', notes: [NOTE] })
    store().change('m1', 'a', { text: 'Dep' })
    await vi.advanceTimersByTimeAsync(300)
    store().change('m1', 'a', { text: 'Depois' })
    await vi.advanceTimersByTimeAsync(499)
    expect(saves()).toEqual([])
    expect(dirty()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(saves().map((save) => save.notes[0]?.text)).toEqual(['Depois'])
    expect(dirty()).toBe(false)
  })

  it('sair do card salva na hora; trocar a cor também', async () => {
    store().change('m1', 'a', { text: 'Saindo' })
    await store().flush('m1')
    expect(saves().map((save) => save.notes[0]?.text)).toEqual(['Saindo'])
    store().change('m1', 'a', { color: 'pink' })
    await vi.advanceTimersByTimeAsync(0)
    expect(saves().at(-1)?.notes[0]?.color).toBe('pink')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(saves()).toHaveLength(2)
  })

  it('sair da aba (o componente desmonta e chama flush): a edição pendente vai e o estado continua no store', async () => {
    store().change('m1', 'a', { text: 'Troquei de aba' })
    await store().flush('m1')
    expect(saves().map((save) => save.notes[0]?.text)).toEqual(['Troquei de aba'])
    // Voltar à aba relê do main só quando não há nada pendente.
    store().change('m1', 'a', { text: 'Ainda não salvo' })
    await store().load('m1')
    expect(entry()?.notes[0]?.text).toBe('Ainda não salvo')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'scribe:notes-get')).toHaveLength(1)
  })

  it('falha uma vez: tenta de novo e salva; falha duas: aviso, continua pendente e "Tentar de novo" salva', async () => {
    invoke.mockRejectedValueOnce(new Error('canal'))
    store().change('m1', 'a', { text: 'Uma falha' })
    await store().flush('m1')
    expect(saves()).toHaveLength(2)
    expect(entry()).toMatchObject({ saveFailed: false })
    expect(dirty()).toBe(false)

    invoke.mockRejectedValueOnce(new Error('canal')).mockRejectedValueOnce(new Error('canal'))
    store().change('m1', 'a', { text: 'Duas falhas' })
    await store().flush('m1')
    expect(saves()).toHaveLength(4)
    expect(entry()).toMatchObject({ saveFailed: true, saving: false })
    expect(dirty()).toBe(true)

    await store().flush('m1')
    expect(saves().at(-1)?.notes[0]?.text).toBe('Duas falhas')
    expect(entry()).toMatchObject({ saveFailed: false })
    expect(dirty()).toBe(false)
  })

  it('duas gravações seguidas: uma por vez, a segunda depois da primeira e com a lista mais nova', async () => {
    let release: (value: boolean) => void = () => undefined
    invoke.mockImplementationOnce(() => new Promise<boolean>((resolve) => (release = resolve)))
    store().change('m1', 'a', { text: 'Primeira' })
    const first = store().flush('m1')
    store().change('m1', 'a', { text: 'Segunda' })
    const second = store().flush('m1')
    await vi.advanceTimersByTimeAsync(0)
    expect(saves().map((save) => save.notes[0]?.text)).toEqual(['Primeira'])
    release(true)
    await Promise.all([first, second])
    expect(saves().map((save) => save.notes[0]?.text)).toEqual(['Primeira', 'Segunda'])
    expect(dirty()).toBe(false)
  })

  it('reunião que não existe mais (resposta falsa): nada pendente e nenhum aviso', async () => {
    invoke.mockResolvedValueOnce(false)
    store().change('m1', 'a', { text: 'Sem reunião' })
    await store().flush('m1')
    expect(entry()).toMatchObject({ saveFailed: false })
    expect(dirty()).toBe(false)
  })

  it('nova anotação sem tempo, com o foco pedido e limpo; excluir salva e "Desfazer" vale 5 s', async () => {
    store().create('m1')
    const created = entry()?.notes[0]
    expect(created).toMatchObject({ atMs: null, color: 'yellow', text: '' })
    expect(entry()?.focusId).toBe(created?.id)
    store().clearFocus('m1')
    expect(entry()?.focusId).toBeNull()
    await vi.advanceTimersByTimeAsync(0)

    store().remove('m1', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(saves().at(-1)?.notes.map((note) => note.id)).toEqual([created?.id])
    expect(entry()?.undo?.note.id).toBe('a')
    await vi.advanceTimersByTimeAsync(4_999)
    expect(entry()?.undo).not.toBeNull()
    store().undo('m1')
    await vi.advanceTimersByTimeAsync(0)
    expect(saves().at(-1)?.notes.map((note) => note.id)).toEqual([created?.id, 'a'])

    store().remove('m1', 'a')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(entry()?.undo).toBeNull()
  })
})
