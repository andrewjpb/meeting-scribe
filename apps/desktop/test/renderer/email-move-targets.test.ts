import { describe, expect, it } from 'vitest'
import type { EmailFolderNode } from '../../src/shared/email'
import { flattenTree, sidebarTree } from '../../src/renderer/src/features/email/folderTree'
import { canDrop, dropLabel, dropRecent, moveChunks, moveErrorText, pushRecent, recentTargets, renameRecent, submenuTargets } from '../../src/renderer/src/features/email/moveTargets'

const node = (path: string, extra: Partial<EmailFolderNode> = {}, children: EmailFolderNode[] = []): EmailFolderNode => ({ path, name: path.split('/').at(-1) ?? path, delimiter: '/', specialUse: null, noselect: false, unseen: 0, total: 0, children, ...extra })
const tree = sidebarTree([
  node('INBOX'),
  node('Rascunhos', { specialUse: '\\Drafts' }),
  node('Enviados', { specialUse: '\\Sent' }),
  node('Clientes', {}, [node('Clientes/ABF'), node('Clientes/GBS')]),
  node('Grupo', { noselect: true }, [node('Grupo/Item')]),
  node('Pendentes'),
  node('Spam', { specialUse: '\\Junk' }),
  node('Lixeira', { specialUse: '\\Trash' }),
])
const item = (path: string) => flattenTree(tree).find((entry) => entry.item.path === path)?.item as NonNullable<ReturnType<typeof flattenTree>[number]['item']>

describe('alvos de soltura (contrato 55, CA5)', () => {
  const source = { accountId: 'a', fromPath: 'INBOX', pop3: false }

  it('pasta da mesma conta aceita; a atual, \\Noselect, Rascunhos, outra conta e POP3 não', () => {
    expect(canDrop(source, { accountId: 'a', item: item('Clientes/ABF') })).toBe(true)
    expect(canDrop(source, { accountId: 'a', item: item('Lixeira') })).toBe(true)
    expect(canDrop(source, { accountId: 'a', item: item('INBOX') })).toBe(false)
    expect(canDrop({ ...source, fromPath: 'Pendentes' }, { accountId: 'a', item: item('INBOX') })).toBe(true)
    expect(canDrop(source, { accountId: 'a', item: item('Grupo') })).toBe(false)
    expect(canDrop(source, { accountId: 'a', item: item('Rascunhos') })).toBe(false)
    expect(canDrop(source, { accountId: 'b', item: item('Clientes/ABF') })).toBe(false)
    expect(canDrop({ ...source, pop3: true }, { accountId: 'a', item: item('Clientes/ABF') })).toBe(false)
  })

  it('etiqueta no singular e no plural', () => {
    expect(dropLabel(1, 'ABF')).toBe('Mover 1 mensagem para ABF')
    expect(dropLabel(3, 'ABF')).toBe('Mover 3 mensagens para ABF')
  })
})

describe('submenu "Mover para ›" (contrato 55, CA8)', () => {
  it('as pastas da barra lateral fora Rascunhos, Enviados e Lixeira; a atual e as \\Noselect desligadas', () => {
    const list = submenuTargets(tree, 'Clientes/ABF')
    expect(list.map(({ item: folder }) => folder.label)).toEqual(['Caixa de Entrada', 'Clientes', 'ABF', 'GBS', 'Grupo', 'Item', 'Pendentes', 'Spam'])
    expect(list.filter((entry) => entry.disabled).map(({ item: folder }) => folder.path)).toEqual(['Clientes/ABF', 'Grupo'])
    expect(list.find(({ item: folder }) => folder.path === 'Clientes/GBS')?.depth).toBe(1)
  })
})

describe('pastas recentes do "Mais" (contrato 55, CA6)', () => {
  it('até 3, a mais nova primeiro, sem repetir', () => {
    expect(pushRecent([], 'A')).toEqual(['A'])
    expect(pushRecent(['A', 'B', 'C'], 'D')).toEqual(['D', 'A', 'B'])
    expect(pushRecent(['A', 'B', 'C'], 'C')).toEqual(['C', 'A', 'B'])
  })

  it('renomear corrige a pasta e as subpastas; apagar tira as duas', () => {
    expect(renameRecent(['Clientes/ABF', 'Clientes', 'Outra'], 'Clientes', 'Contas', '/')).toEqual(['Contas/ABF', 'Contas', 'Outra'])
    expect(renameRecent(['Clientes2'], 'Clientes', 'Contas', '/')).toEqual(['Clientes2'])
    expect(dropRecent(['Clientes/ABF', 'Clientes', 'Outra'], 'Clientes', '/')).toEqual(['Outra'])
  })

  it('no menu: só as que existem na árvore, fora a atual', () => {
    expect(recentTargets(['Pendentes', 'Sumiu', 'Clientes/ABF'], tree, 'INBOX').map((folder) => folder.path)).toEqual(['Pendentes', 'Clientes/ABF'])
    expect(recentTargets(['Pendentes', 'Clientes/ABF'], tree, 'Pendentes').map((folder) => folder.path)).toEqual(['Clientes/ABF'])
    expect(recentTargets(undefined, tree, 'INBOX')).toEqual([])
  })
})

describe('mover em lotes e erros (contrato 55, CA5 e CA10)', () => {
  it('lotes de 500', () => {
    const uids = Array.from({ length: 1203 }, (_, index) => index + 1)
    expect(moveChunks(uids).map((chunk) => chunk.length)).toEqual([500, 500, 203])
    expect(moveChunks([])).toEqual([])
  })

  it('frase por código; parcial diz quantas foram', () => {
    expect(moveErrorText('unavailable')).toBe('Sem conexão com o servidor. Nada foi movido.')
    expect(moveErrorText('server')).toBe('O servidor recusou. Nada foi movido.')
    expect(moveErrorText('invalid')).toBe('A pasta mudou no servidor. Atualize e tente de novo.')
    expect(moveErrorText('unsupported')).toBe('Este servidor não move sem risco de apagar outras mensagens.')
    expect(moveErrorText('server', 500, 700)).toBe('500 de 700 mensagens foram movidas; as outras ficaram. O servidor recusou.')
  })
})
