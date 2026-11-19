// Barra lateral em pilha (contrato 65, CA20; contrato 66, CA11, o nível Configurações; contrato 67, CA13, o nível Assistente): o nível de cada rota, o "voltar" que vale só para a navegação dele, o
// deslize entre os níveis, o último email aberto na sessão e o número do item "Email" na raiz.
import { beforeEach, describe, expect, it } from 'vitest'
import type { EmailMessage } from '../../src/shared/email'
import { activeNavId, lastEmailPath, levelFor, rememberEmailPath, resetSidebarMemory, sectionOf, SIDEBAR_SLIDE_FALLBACK_MS, SIDEBAR_SLIDE_MS, transitionOf } from '../../src/renderer/src/app/sidebarLevels'
import { totalUnread } from '../../src/renderer/src/features/email/format'

type Unread = Pick<EmailMessage, 'seen' | 'folder'>
const inbox = (unread: number, read = 1): Unread[] => [...Array.from({ length: unread }, () => ({ seen: false, folder: 'inbox' as const })), ...Array.from({ length: read }, () => ({ seen: true, folder: 'inbox' as const }))]
const account = (id: string) => ({ account: { id } })

beforeEach(() => resetSidebarMemory())

describe('nível da barra lateral (contrato 65)', () => {
  it('sectionOf: só /email e /email/* são a seção Email', () => {
    expect(sectionOf('/email')).toBe('email')
    expect(sectionOf('/email/a/entrada')).toBe('email')
    for (const path of ['/', '/reunioes/x', '/gravacao', '/automacoes', '/whatsapp']) expect(sectionOf(path)).toBeNull()
  })

  it('sectionOf: /configuracoes e /configuracoes/* são a seção Configurações (contrato 66)', () => {
    expect(sectionOf('/configuracoes')).toBe('configuracoes')
    expect(sectionOf('/configuracoes/conexoes')).toBe('configuracoes')
    expect(sectionOf('/configuracoes/gravacao')).toBe('configuracoes')
    expect(sectionOf('/configuracoesx')).toBeNull()
  })

  it('sectionOf: /assistente e /assistente/* são a seção Assistente (contrato 67)', () => {
    expect(sectionOf('/assistente')).toBe('assistente')
    expect(sectionOf('/assistente/x')).toBe('assistente')
    expect(sectionOf('/assistentex')).toBeNull()
  })

  it('/assistente: o nível, o "voltar" da mesma navegação, o item marcado e o deslize (contrato 67)', () => {
    expect(levelFor('/assistente', null, 'k')).toBe('assistente')
    expect(levelFor('/assistente', 'k', 'k')).toBe('root')
    expect(activeNavId('/assistente', 'assistente')).toBe('assistente')
    expect(transitionOf('assistente', 'email')).toBe('push')
    expect(transitionOf('assistente', 'root')).toBe('pop')
    expect(transitionOf('root', 'assistente')).toBe('push')
  })

  it('levelFor: a rota manda, menos o "voltar" da mesma navegação', () => {
    expect(levelFor('/email/a/entrada', null, 'k1')).toBe('email')
    expect(levelFor('/email/a/entrada', 'k1', 'k1')).toBe('root')
    expect(levelFor('/email/a/entrada', 'k0', 'k1')).toBe('email')
    expect(levelFor('/', null, 'k1')).toBe('root')
    expect(levelFor('/configuracoes/geral', null, 'k1')).toBe('configuracoes')
    expect(levelFor('/configuracoes/geral', 'k1', 'k1')).toBe('root')
    expect(levelFor('/configuracoes/geral', 'k0', 'k1')).toBe('configuracoes')
  })

  it('nível e item marcado saem do mesmo padrão: /email mais fundo mostra o nível Email e marca "Email"', () => {
    const deep = '/email/a/entrada/x'
    expect(sectionOf(deep)).toBe('email')
    expect(levelFor(deep, null, 'k1')).toBe('email')
    // `routeIdOf` não casa um caminho mais fundo que `/email/:conta?/:pasta?` (null); a seção decide.
    expect(activeNavId(deep, null)).toBe('email')
    expect(activeNavId('/email/a/entrada', 'email')).toBe('email')
    expect(activeNavId('/configuracoes/geral', 'configuracoes')).toBe('configuracoes')
    expect(activeNavId('/reunioes/x', 'detalhe')).toBe('detalhe')
    expect(activeNavId('/', 'reunioes')).toBe('reunioes')
  })

  it('transitionOf: nada na primeira pintura nem sem troca; push ao entrar e pop ao voltar', () => {
    expect(transitionOf(null, 'email')).toBeNull()
    expect(transitionOf('email', 'email')).toBeNull()
    expect(transitionOf('root', 'email')).toBe('push')
    expect(transitionOf('email', 'root')).toBe('pop')
    // Contrato 66: do nível Email, ⌘, entra direto no nível Configurações (e o contrário), sem passar pela raiz.
    expect(transitionOf('email', 'configuracoes')).toBe('push')
    expect(transitionOf('configuracoes', 'email')).toBe('push')
    expect(transitionOf('configuracoes', 'root')).toBe('pop')
  })

  it('o deslize dura o --duration-slow, com reserva de 80 ms', () => {
    expect(SIDEBAR_SLIDE_MS).toBe(180)
    expect(SIDEBAR_SLIDE_FALLBACK_MS).toBe(260)
  })
})

describe('último email aberto na sessão (contrato 65, CA6)', () => {
  it('sem nada lembrado, /email', () => {
    expect(lastEmailPath(['a', 'b'])).toBe('/email')
  })

  it('a pasta lembrada, se a conta ainda existe; senão /email', () => {
    rememberEmailPath('/email/b/enviados')
    expect(lastEmailPath(['a', 'b'])).toBe('/email/b/enviados')
    expect(lastEmailPath(['a'])).toBe('/email')
  })

  it('/email sozinho e outras rotas não trocam o lembrado', () => {
    rememberEmailPath('/email/b/enviados')
    rememberEmailPath('/email')
    rememberEmailPath('/reunioes')
    expect(lastEmailPath(['a', 'b'])).toBe('/email/b/enviados')
  })
})

describe('número do item "Email" (contrato 65, CA3)', () => {
  it('contas ainda não carregadas: 0', () => {
    expect(totalUnread(null, {})).toBe(0)
  })

  it('soma as não lidas da Caixa de Entrada de cada conta', () => {
    expect(totalUnread([account('a'), account('b')], { 'a:inbox': inbox(2), 'b:inbox': inbox(1) })).toBe(3)
  })

  it('não lida em Enviados não conta; conta sem a lista carregada, 0', () => {
    expect(totalUnread([account('a')], { 'a:inbox': inbox(0), 'a:sent': [{ seen: false, folder: 'sent' }] })).toBe(0)
    expect(totalUnread([account('a')], { 'a:inbox': [...inbox(1), { seen: false, folder: 'sent' }] })).toBe(1)
    expect(totalUnread([account('a'), account('b')], { 'a:inbox': inbox(1) })).toBe(1)
    expect(totalUnread([account('b')], {})).toBe(0)
  })
})
