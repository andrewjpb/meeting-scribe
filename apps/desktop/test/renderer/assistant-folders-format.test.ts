import { describe, expect, it } from 'vitest'
import { FOLDER_ADD_FAILED_TEXT, FOLDER_REMOVE_FAILED_TEXT, folderAddNotices, folderDisplayPath, FOLDER_REFUSAL_TEXT } from '../../src/renderer/src/features/settings/assistantFoldersFormat'

describe('textos das pastas do Assistente (contrato 167)', () => {
  it('um aviso por motivo de recusa, com o texto fixo', () => {
    expect(folderAddNotices({ refused: [{ path: '/Users/x', reason: 'sensivel' }], replaced: [] })).toEqual([
      'Pasta pessoal, Library ou do sistema não pode ser escolhida (muito ampla). Escolha uma pasta dentro dela.',
    ])
    expect(folderAddNotices({ refused: [{ path: '/a', reason: 'limite' }, { path: '/b', reason: 'limite' }], replaced: [] })).toEqual(['No máximo 20 pastas.'])
    expect(
      folderAddNotices({
        refused: [
          { path: '/a/.x', reason: 'oculta' },
          { path: '/b', reason: 'repetida' },
          { path: '/c', reason: 'inexistente' },
        ],
        replaced: [],
      }),
    ).toEqual([FOLDER_REFUSAL_TEXT.oculta, 'Essa pasta já está na lista ou dentro de uma pasta da lista.', 'Pasta não encontrada.'])
  })

  it('as substituídas viram um aviso com a contagem; sem recusa nem substituição, nenhum aviso', () => {
    expect(folderAddNotices({ refused: [], replaced: ['/a/b', '/a/c'] })).toEqual(['Pastas dentro dela foram substituídas: 2.'])
    expect(folderAddNotices({ refused: [], replaced: [] })).toEqual([])
  })

  it('caminho com a pasta pessoal encurtada', () => {
    expect(folderDisplayPath('/Users/fulano/Documents/Contratos')).toBe('~/Documents/Contratos')
    expect(folderDisplayPath('/Users/fulano')).toBe('~')
    expect(folderDisplayPath('/Users/Shared/Projetos')).toBe('/Users/Shared/Projetos')
    expect(folderDisplayPath('/Volumes/Disco/Projetos')).toBe('/Volumes/Disco/Projetos')
  })

  it('as falhas dos canais têm texto fixo', () => {
    expect(FOLDER_ADD_FAILED_TEXT).toBe('Não foi possível abrir a janela de escolha de pasta.')
    expect(FOLDER_REMOVE_FAILED_TEXT).toBe('Não foi possível remover a pasta.')
  })
})
