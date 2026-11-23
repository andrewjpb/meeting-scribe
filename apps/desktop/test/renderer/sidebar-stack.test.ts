// Barra lateral em pilha (contrato 65, CA20; contrato 66, CA11, o nível Configurações; contrato 67, CA13, o nível Assistente; contrato 112, CA1, o nível Funil): o nível de cada rota, o "voltar" que vale só para a navegação dele, o
// deslize entre os níveis, o último email aberto na sessão e o número do item "Email" na raiz. Contrato 123 (CA1): Tarefas,
// item da raiz sem nível próprio. Contrato 135 (D1): Início, o primeiro item da raiz, também sem nível.
import { beforeEach, describe, expect, it } from 'vitest'
import { EMAIL_INBOX_MAILBOX, EMAIL_SENT_MAILBOX, type EmailMessage } from '../../src/shared/email'
import { emailFolderFromSlug, emailFolderSegment, emailPath, FUNIL_SECTIONS, funilPath, isFunilSection, isRedesSection, REDES_SECTIONS, redesPath, ROUTE_PATHS, ROUTE_REDIRECTS, TAREFAS_ROOT_PATH, tarefasPath } from '../../src/shared/routes'
import { activeNavId, lastEmailPath, lastRedesPath, levelFor, rememberEmailPath, rememberRedesPath, resetSidebarMemory, sectionOf, SIDEBAR_SECTIONS, SIDEBAR_SLIDE_FALLBACK_MS, SIDEBAR_SLIDE_MS, transitionOf } from '../../src/renderer/src/app/sidebarLevels'
import { totalUnread } from '../../src/renderer/src/features/email/format'
// A tabela de rotas importa todas as telas (JSX): o teste lê a ordem dos `nav` no texto do próprio arquivo.
import tabelaDeRotas from '../../src/renderer/src/app/routes.tsx?raw'

type Unread = Pick<EmailMessage, 'seen' | 'mailbox'>
const inbox = (unread: number, read = 1): Unread[] => [...Array.from({ length: unread }, () => ({ seen: false, mailbox: EMAIL_INBOX_MAILBOX })), ...Array.from({ length: read }, () => ({ seen: true, mailbox: EMAIL_INBOX_MAILBOX }))]
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

describe('nível Redes (contrato 72, CA13)', () => {
  it('sectionOf: /redes e /redes/* são a seção Redes', () => {
    expect(SIDEBAR_SECTIONS).toContain('redes')
    expect(sectionOf('/redes')).toBe('redes')
    expect(sectionOf('/redes/123/publicacoes')).toBe('redes')
    expect(sectionOf('/redesx')).toBeNull()
  })

  it('o nível, o "voltar" da mesma navegação, o item marcado e o deslize', () => {
    expect(levelFor('/redes/123/comentarios', null, 'k')).toBe('redes')
    expect(levelFor('/redes/123/comentarios', 'k', 'k')).toBe('root')
    expect(activeNavId('/redes/123/metricas', 'redes')).toBe('redes')
    expect(transitionOf('root', 'redes')).toBe('push')
    expect(transitionOf('redes', 'configuracoes')).toBe('push')
    expect(transitionOf('redes', 'root')).toBe('pop')
  })

  it('redesPath: a conta e a seção, Publicações por padrão; só as quatro seções valem', () => {
    expect(redesPath('123')).toBe('/redes/123/publicacoes')
    expect(redesPath('123', 'mensagens')).toBe('/redes/123/mensagens')
    expect(REDES_SECTIONS).toEqual(['publicacoes', 'comentarios', 'mensagens', 'metricas'])
    expect(isRedesSection('metricas')).toBe(true)
    expect(isRedesSection('stories')).toBe(false)
  })

  it('lastRedesPath: a última seção vista, se a conta existe; senão a primeira conta; sem conta, /redes', () => {
    expect(lastRedesPath([])).toBe('/redes')
    expect(lastRedesPath(['1', '2'])).toBe('/redes/1/publicacoes')
    rememberRedesPath('/redes/2/comentarios')
    expect(lastRedesPath(['1', '2'])).toBe('/redes/2/comentarios')
    expect(lastRedesPath(['1'])).toBe('/redes/1/publicacoes')
    expect(lastRedesPath([])).toBe('/redes')
  })

  it('/redes sozinho, seção desconhecida e outras rotas não trocam o lembrado', () => {
    rememberRedesPath('/redes/2/mensagens')
    rememberRedesPath('/redes')
    rememberRedesPath('/redes/2/stories')
    rememberRedesPath('/email/a/entrada')
    expect(lastRedesPath(['1', '2'])).toBe('/redes/2/mensagens')
    resetSidebarMemory()
    expect(lastRedesPath(['1', '2'])).toBe('/redes/1/publicacoes')
  })
})

describe('nível Funil (contrato 112, CA1)', () => {
  it('sectionOf: /funil e /funil/* são a seção Funil', () => {
    expect(SIDEBAR_SECTIONS).toContain('funil')
    expect(sectionOf('/funil')).toBe('funil')
    expect(sectionOf('/funil/oportunidades')).toBe('funil')
    expect(sectionOf('/funil/contatos/abc')).toBe('funil')
    expect(sectionOf('/funilx')).toBeNull()
  })

  it('o nível, o "voltar" da mesma navegação, o item marcado e o deslize', () => {
    expect(levelFor('/funil/empresas', null, 'k')).toBe('funil')
    expect(levelFor('/funil/empresas', 'k', 'k')).toBe('root')
    expect(activeNavId('/funil/oportunidades', null)).toBe('funil')
    expect(activeNavId('/funil/oportunidades/op-1', 'funil')).toBe('funil')
    expect(transitionOf('root', 'funil')).toBe('push')
    expect(transitionOf('funil', 'root')).toBe('pop')
    expect(transitionOf('funil', 'email')).toBe('push')
  })

  it('funilPath: a seção (Oportunidades por padrão) e o id codificado; só as três seções valem; nenhum redirecionamento novo', () => {
    expect(ROUTE_PATHS.funil).toBe('/funil/:secao?/:id?')
    expect(funilPath()).toBe('/funil/oportunidades')
    expect(funilPath('contatos')).toBe('/funil/contatos')
    expect(funilPath('oportunidades', 'op/1 a')).toBe('/funil/oportunidades/op%2F1%20a')
    expect(FUNIL_SECTIONS).toEqual(['oportunidades', 'contatos', 'empresas'])
    expect(isFunilSection('empresas')).toBe(true)
    expect(isFunilSection('negocios')).toBe(false)
    expect(ROUTE_REDIRECTS).toEqual([{ from: '/perguntar', to: '/assistente' }])
  })
})

describe('Tarefas, item da raiz sem nível (contrato 123, CA1)', () => {
  it('/tarefas e /tarefas/<id> não têm nível: a raiz fica, com Tarefas marcado', () => {
    expect(sectionOf('/tarefas')).toBeNull()
    expect(sectionOf('/tarefas/abc')).toBeNull()
    expect(levelFor('/tarefas/abc', null, 'k')).toBe('root')
    expect(activeNavId('/tarefas/abc', 'tarefas')).toBe('tarefas')
    expect(activeNavId('/tarefas', 'tarefas')).toBe('tarefas')
  })

  it('tarefasPath: a lista e o id codificado; nenhum redirecionamento novo', () => {
    expect(ROUTE_PATHS.tarefas).toBe('/tarefas/:id?')
    expect(TAREFAS_ROOT_PATH).toBe('/tarefas')
    expect(tarefasPath()).toBe('/tarefas')
    expect(tarefasPath('t/1 a')).toBe('/tarefas/t%2F1%20a')
    expect(ROUTE_REDIRECTS).toEqual([{ from: '/perguntar', to: '/assistente' }])
  })
})

describe('Início, primeiro item da raiz sem nível (contrato 135, D1)', () => {
  it('/inicio não tem nível: a raiz fica, com Início marcado; "/" continua sendo Reuniões', () => {
    expect(ROUTE_PATHS.inicio).toBe('/inicio')
    expect(ROUTE_PATHS.reunioes).toBe('/')
    expect(sectionOf('/inicio')).toBeNull()
    expect(levelFor('/inicio', null, 'k')).toBe('root')
    expect(activeNavId('/inicio', 'inicio')).toBe('inicio')
    expect(ROUTE_REDIRECTS).toEqual([{ from: '/perguntar', to: '/assistente' }])
  })

  it('a tabela de rotas põe "Início" (ícone House) antes de todos os outros itens da barra', () => {
    const itens = [...tabelaDeRotas.matchAll(/nav: \{ label: '([^']+)', icon: (\w+) \}/g)].map((match) => `${match[1]}:${match[2]}`)
    expect(itens).toEqual(['Início:House', 'Reuniões:NotebookText', 'Tarefas:SquareCheck', 'Assistente:Sparkles', 'Email:Mail', 'Funil:Funnel', 'Redes:AtSign', 'Automações:Bot', 'WhatsApp:Smartphone', 'Configurações:Settings'])
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

  it('contrato 55: lembra também as outras pastas (`emailPath` com o path)', () => {
    const path = emailPath('b', { path: 'Clientes/ABF 100%' })
    rememberEmailPath(path)
    expect(lastEmailPath(['a', 'b'])).toBe(path)
    expect(emailFolderFromSlug(emailFolderSegment(lastEmailPath(['a', 'b'])))).toEqual({ path: 'Clientes/ABF 100%' })
    expect(lastEmailPath(['a'])).toBe('/email')
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
    expect(totalUnread([account('a')], { 'a:inbox': inbox(0), 'a:sent': [{ seen: false, mailbox: EMAIL_SENT_MAILBOX }] })).toBe(0)
    expect(totalUnread([account('a')], { 'a:inbox': [...inbox(1), { seen: false, mailbox: EMAIL_SENT_MAILBOX }] })).toBe(1)
    expect(totalUnread([account('a'), account('b')], { 'a:inbox': inbox(1) })).toBe(1)
    expect(totalUnread([account('b')], {})).toBe(0)
  })
})
