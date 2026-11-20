import { describe, expect, it } from 'vitest'
import type { EmailFolderNode } from '../../src/shared/email'
import { emailFolderFromSlug, emailFolderSegment, emailPath } from '../../src/shared/routes'
import { createMemoryRouter } from 'react-router'
import { ROUTE_PATHS } from '../../src/shared/routes'
import { breadcrumb, deleteConfirmation, deleteNextStep, findFolder, flattenTree, folderLabel, pickerTree, sidebarTree } from '../../src/renderer/src/features/email/folderTree'

const node = (path: string, extra: Partial<EmailFolderNode> = {}, children: EmailFolderNode[] = []): EmailFolderNode => ({
  path,
  name: path.split(/[/.]/).at(-1) ?? path,
  delimiter: '/',
  specialUse: null,
  noselect: false,
  unseen: 0,
  total: 0,
  children,
  ...extra,
})

const labels = (items: ReturnType<typeof sidebarTree>): string[] => flattenTree(items).map(({ item, depth }) => `${'  '.repeat(depth)}${item.label}`)

describe('árvore de pastas (contrato 55, CA2)', () => {
  const imap: EmailFolderNode[] = [
    node('INBOX', { unseen: 12, total: 231 }),
    node('Lixeira', { specialUse: '\\Trash' }),
    node('Spam', { specialUse: '\\Junk' }),
    node('Resolvidos'),
    node('Enviados', { specialUse: '\\Sent' }),
    node('Clientes', {}, [node('Clientes/GBS'), node('Clientes/ABF', { unseen: 3 }), node('Clientes/Fluxopay')]),
    node('Rascunhos', { specialUse: '\\Drafts' }),
    node('Pendentes', { unseen: 5 }),
    node('Ágil'),
    node('arquivo morto'),
  ]

  it('ordem D1: sistema no topo, a pessoa em ordem alfabética (com acento, sem maiúscula, também nas subpastas), Spam e Lixeira no fim', () => {
    expect(labels(sidebarTree(imap))).toEqual([
      'Caixa de Entrada',
      'Rascunhos',
      'Enviados',
      'Ágil',
      'arquivo morto',
      'Clientes',
      '  ABF',
      '  Fluxopay',
      '  GBS',
      'Pendentes',
      'Resolvidos',
      'Spam',
      'Lixeira',
    ])
  })

  it('nomes da casa onde quer que estejam; as outras com o nome do servidor', () => {
    expect(folderLabel({ path: 'INBOX', name: 'INBOX', specialUse: null })).toBe('Caixa de Entrada')
    expect(folderLabel({ path: 'Itens Enviados', name: 'Itens Enviados', specialUse: '\\Sent' })).toBe('Enviados')
    expect(folderLabel({ path: 'Deleted', name: 'Deleted', specialUse: '\\Trash' })).toBe('Lixeira')
    expect(folderLabel({ path: 'Junk', name: 'Junk', specialUse: '\\Junk' })).toBe('Spam')
    expect(folderLabel({ path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' })).toBe('Rascunhos')
    expect(folderLabel({ path: 'Arquivo', name: 'Arquivo', specialUse: '\\Archive' })).toBe('Arquivo')
  })

  it('Gmail: o [Gmail] some, os filhos sobem; "Todos os e-mails", "Com estrela" e \\Important só no seletor', () => {
    const gmail: EmailFolderNode[] = [
      node('INBOX'),
      node('Clientes'),
      node('[Gmail]', { noselect: true, unseen: null, total: null }, [
        node('[Gmail]/Todos os e-mails', { specialUse: '\\All' }),
        node('[Gmail]/Com estrela', { specialUse: '\\Flagged' }),
        node('[Gmail]/Importante', { specialUse: '\\Important' }),
        node('[Gmail]/E-mails enviados', { specialUse: '\\Sent' }),
        node('[Gmail]/Rascunhos', { specialUse: '\\Drafts' }),
        node('[Gmail]/Lixeira', { specialUse: '\\Trash' }),
        node('[Gmail]/Spam', { specialUse: '\\Junk' }),
      ]),
    ]
    expect(labels(sidebarTree(gmail))).toEqual(['Caixa de Entrada', 'Rascunhos', 'Enviados', 'Clientes', 'Spam', 'Lixeira'])
    expect(labels(pickerTree(gmail))).toEqual(['Caixa de Entrada', 'Rascunhos', 'Enviados', 'Clientes', 'Todos os e-mails', 'Com estrela', 'Importante', 'Spam', 'Lixeira'])
    expect(breadcrumb('[Gmail]/Lixeira', gmail)).toBe('Lixeira')
    // [Gmail] com uma pasta da pessoa dentro continua, como pasta comum.
    const kept = [...gmail.slice(0, 2), { ...(gmail[2] as EmailFolderNode), children: [...(gmail[2] as EmailFolderNode).children, node('[Gmail]/Projetos')] }]
    expect(labels(sidebarTree(kept))).toContain('[Gmail]')
    expect(breadcrumb('[Gmail]/Projetos', kept)).toBe('[Gmail] › Projetos')
  })

  it('\\Archive entra na ordem alfabética e é protegida', () => {
    const tree = sidebarTree([node('INBOX'), node('Zeta'), node('Arquivo', { specialUse: '\\Archive' })])
    expect(labels(tree)).toEqual(['Caixa de Entrada', 'Arquivo', 'Zeta'])
    expect(findFolder(tree, 'Arquivo')?.protected).toBe(true)
    expect(findFolder(tree, 'Zeta')?.protected).toBe(false)
    expect(findFolder(tree, 'INBOX')?.protected).toBe(true)
  })

  it('breadcrumb com "/" e com "."', () => {
    expect(breadcrumb('Clientes/ABF', imap)).toBe('Clientes › ABF')
    const dotted = [node('INBOX', { delimiter: '.' }, [node('INBOX.Clientes', { delimiter: '.' }, [node('INBOX.Clientes.ABF', { delimiter: '.' })])])]
    expect(breadcrumb('INBOX.Clientes.ABF', dotted)).toBe('Caixa de Entrada › Clientes › ABF')
    expect(breadcrumb('Sumiu/Daqui', imap)).toBe('Sumiu › Daqui')
    expect(breadcrumb('INBOX', imap)).toBe('Caixa de Entrada')
  })

  it('\\Noselect: aparece só com filhos; sem filhos some', () => {
    const tree = sidebarTree([node('INBOX'), node('Vazio', { noselect: true }), node('Pai', { noselect: true }, [node('Pai/Filho')])])
    expect(labels(tree)).toEqual(['Caixa de Entrada', 'Pai', '  Filho'])
    expect(findFolder(tree, 'Pai')?.noselect).toBe(true)
  })

  it('POP3: só Caixa de Entrada e Enviados', () => {
    const pop3: EmailFolderNode[] = [node('INBOX', { delimiter: null }), node('Sent', { delimiter: null, specialUse: '\\Sent' })]
    expect(labels(sidebarTree(pop3))).toEqual(['Caixa de Entrada', 'Enviados'])
  })
})

describe('rotas das pastas (contrato 55, CA1)', () => {
  const id = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'

  it('Caixa de Entrada e Enviados mantêm os caminhos de antes', () => {
    expect(emailPath(id)).toBe(`/email/${id}/entrada`)
    expect(emailPath(id, 'sent')).toBe(`/email/${id}/enviados`)
    expect(emailFolderFromSlug('entrada')).toBe('inbox')
    expect(emailFolderFromSlug('enviados')).toBe('sent')
  })

  it('ida e volta de qualquer path, sem colidir com os slugs', () => {
    for (const path of ['Clientes/ABF', 'INBOX.Clientes.ABF', 'Pasta com espaço', 'Ação', '100%', 'a%41', 'til~de', 'entrada', 'enviados', '[Gmail]/Lixeira']) {
      const route = emailPath(id, { path })
      const segment = emailFolderSegment(route)
      expect(segment?.startsWith('p~')).toBe(true)
      expect(segment).not.toContain('/')
      expect(emailFolderFromSlug(segment)).toEqual({ path })
    }
  })

  it('segmento fora do formato não é pasta', () => {
    expect(emailFolderFromSlug(undefined)).toBeNull()
    expect(emailFolderFromSlug('outra')).toBeNull()
    expect(emailFolderFromSlug('p~')).toBeNull()
    expect(emailFolderFromSlug('p~%E0%A4%A')).toBeNull()
  })
})

describe('apagar pasta (contrato 55, CA9, devolução B3)', () => {
  it('o primeiro pedido vai sempre sem `force`, mesmo com a árvore dizendo que tem mensagens', () => {
    expect(deleteConfirmation('GBS', null)).toEqual({ question: 'Apagar a pasta “GBS”?', warning: null, button: 'Apagar pasta', force: false })
  })

  it('árvore velha: guardado 0, real 14; a confirmação mostra o real que o 52 devolveu, e só ela manda `force`', () => {
    const stale = sidebarTree([node('INBOX'), node('GBS', { total: 0 })])
    expect(findFolder(stale, 'GBS')?.total).toBe(0)
    const step = deleteNextStep({ ok: false, error: 'invalid', contents: { messages: 14, folders: 1 } }, false)
    expect(step).toEqual({ kind: 'confirm', contents: { messages: 14, folders: 1 } })
    const asked = deleteConfirmation('GBS', step.kind === 'confirm' ? step.contents : null)
    expect(asked.question).toBe('Apagar a pasta “GBS” e as 14 mensagens e a subpasta dela?')
    expect(asked.warning).toBe('As mensagens são apagadas no servidor, sem passar pela Lixeira. Para guardar, mova antes para outra pasta.')
    expect(asked).toMatchObject({ button: 'Apagar pasta e mensagens', force: true })
    expect(deleteConfirmation('ABF', { messages: 1, folders: 0 }).question).toBe('Apagar a pasta “ABF” e a mensagem dela?')
  })

  it('vazia: apaga no primeiro pedido; erro do servidor vira a frase', () => {
    expect(deleteNextStep({ ok: true }, false)).toEqual({ kind: 'done' })
    expect(deleteNextStep({ ok: false, error: 'server' }, true)).toEqual({ kind: 'error', text: 'O servidor recusou. Nada mudou.' })
    // Com `force` já mandado, `invalid` não pede de novo.
    expect(deleteNextStep({ ok: false, error: 'invalid', contents: { messages: 2, folders: 0 } }, true).kind).toBe('error')
  })
})

describe('rota de pasta pela navegação do roteador em memória (contrato 55, CA1)', () => {
  it('ida e volta com acento e "›" no nome', async () => {
    const router = createMemoryRouter([{ path: ROUTE_PATHS.email, element: null }], { initialEntries: ['/email'] })
    const id = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
    for (const path of ['Clientes › Ação', 'Clientes/Ação', 'INBOX.Orçamentos 100%']) {
      await router.navigate(emailPath(id, { path }))
      const { pathname } = router.state.location
      expect(router.state.matches[0]?.params['conta']).toBe(id)
      expect(emailFolderFromSlug(emailFolderSegment(pathname))).toEqual({ path })
    }
    router.dispose()
  })
})
