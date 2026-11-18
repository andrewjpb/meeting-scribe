// Filtro por pasta na lista de Reuniões (contrato 28, CA3 e CA4): roda no renderer sobre as linhas do overview;
// mover e excluir a pasta atualizam as linhas sem reler a lista.
import { describe, expect, it } from 'vitest'
import type { MeetingOverview } from '../../src/shared/meetings-overview'
import { folderCounts, folderNameOf, inFolder, withMovedMeeting, withoutFolder } from '../../src/renderer/src/features/meetings/folders'

describe('filtro por pasta na lista (renderer)', () => {
  const entry = (id: string, folderId?: string | null): MeetingOverview => ({
    meeting: { id, title: id, startedAt: '2026-11-18T10:00:00.000Z', durationMs: 1000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null, ...(folderId !== undefined ? { folderId } : {}) },
    summary: null,
    summaryState: 'none',
    notes: 0,
  })
  const list = [entry('a', 'f1'), entry('b'), entry('c', 'f1'), entry('d', null), entry('e', 'f2')]

  it('"Todas" devolve tudo; a pasta, só as dela; contagens por pasta', () => {
    expect(inFolder(list, 'all').map((item) => item.meeting.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(inFolder(list, 'f1').map((item) => item.meeting.id)).toEqual(['a', 'c'])
    expect(inFolder(list, 'vazia')).toEqual([])
    expect([...folderCounts(list)]).toEqual([
      ['f1', 2],
      ['f2', 1],
    ])
  })

  it('mover e excluir a pasta atualizam as linhas sem reler; o nome da pasta vem da lista de pastas', () => {
    const moved = withMovedMeeting(list, { ...entry('b').meeting, folderId: 'f2' })
    expect(inFolder(moved, 'f2').map((item) => item.meeting.id)).toEqual(['b', 'e'])
    const cleared = withoutFolder(moved, 'f1')
    expect(inFolder(cleared, 'f1')).toEqual([])
    expect(cleared).toHaveLength(list.length)
    const folders = [{ id: 'f2', name: 'Cliente X' }]
    expect(folderNameOf({ folderId: 'f2' }, folders)).toBe('Cliente X')
    expect(folderNameOf({ folderId: 'f1' }, folders)).toBeNull()
    expect(folderNameOf({ folderId: null }, folders)).toBeNull()
  })
})
