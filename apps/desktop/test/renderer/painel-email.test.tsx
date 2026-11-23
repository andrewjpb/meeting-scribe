// Painel de e-mail (contrato 157, CA2 a CA4, CA6 a CA9 e CA11): a tela renderizada com `react-dom/server` (o projeto não
// tem DOM nos testes) a partir do store, e as ações do store que os cliques chamam (Ver resposta, Abrir no Composer,
// Ignorar, Mover, Desfazer, Analisar agora), com o `__scribeApi` falso.
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { itemKey, type EmailDashboardAttentionRow, type EmailDashboardView } from '../../src/shared/email-dashboard'
import { emailPath, settingsPath } from '../../src/shared/routes'
import { useEmail } from '../../src/renderer/src/features/email/emailStore'
import { PainelEmail } from '../../src/renderer/src/features/email/PainelEmail'
import { painelSubtitulo, textoConta, textoMovidos, textoUltimaAnalise } from '../../src/renderer/src/features/email/painelFormat'
import { resetPainelIgnorados, usePainel } from '../../src/renderer/src/features/email/painelStore'

vi.mock('zustand', async (original) => (await import('./zustand-ssr')).withCurrentState(await original()))

const A = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const B = '1b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const AGORA = new Date(2026, 10, 23, 9, 12).getTime()

const linha = (n: number, importance: EmailDashboardAttentionRow['importance'], accountId = A): EmailDashboardAttentionRow => ({
  accountId,
  messageKey: `k${n}`,
  from: `Remetente ${n}`,
  subject: `Assunto ${n}`,
  date: AGORA - n * 60_000,
  importance,
  reason: `motivo ${n}`,
  seen: false,
})

/** CA2: 8 de atenção (3 com importância ≥ 4), 5 respostas (1 aberta) e 2 grupos de mover (4 e 2). */
function visao(over: Partial<EmailDashboardView> = {}): EmailDashboardView {
  return {
    enabled: true,
    running: false,
    lastRun: { at: AGORA, model: 'haiku', analyzed: 38, costUsd: 0.02, error: null },
    accounts: [
      { accountId: A, name: 'LAP', unread: 5, pending: 3, pop3: false },
      { accountId: B, name: 'Pessoal', unread: 1, pending: 0, pop3: true },
    ],
    attention: [linha(1, 5), linha(2, 4), linha(3, 4), linha(4, 3), linha(5, 3), linha(6, 2), linha(7, 2), linha(8, 1)],
    replies: [1, 2, 3, 4, 5].map((n) => ({ ...linha(n, n === 1 ? 5 : 3), reply: `Resposta ${n}.\n\nSegundo parágrafo da resposta ${n}.`, opened: n === 3 })),
    moves: [
      { accountId: A, folder: 'Newsletters', folderName: 'Newsletters', rows: [11, 12, 13, 14].map((n) => ({ ...linha(n, 1), moveReason: 'newsletter' })) },
      { accountId: A, folder: 'Archive', folderName: 'Arquivar', rows: [21, 22].map((n) => ({ ...linha(n, 1), moveReason: 'aviso automático' })) },
    ],
    ...over,
  }
}

const render = (): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/email/painel']}>
      <PainelEmail />
    </MemoryRouter>,
  )

/** O trecho de um cartão no HTML. */
function cartao(html: string, id: string): string {
  return html.match(new RegExp(`<section data-email-painel-cartao="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''
}
const conta = (texto: string, trecho: string): number => texto.split(trecho).length - 1

function atual(): EmailDashboardView {
  const view = usePainel.getState().view
  if (!view) throw new Error('sem visão')
  return view
}
function resposta(i: number): EmailDashboardView['replies'][number] {
  const row = atual().replies[i]
  if (!row) throw new Error('sem resposta')
  return row
}
function grupo(i: number): EmailDashboardView['moves'][number] {
  const group = atual().moves[i]
  if (!group) throw new Error('sem grupo')
  return group
}

describe('Painel de e-mail', () => {
  const invoke = vi.fn()
  const api = {
    invoke,
    emailDashboardGet: vi.fn(),
    emailDashboardRun: vi.fn(),
    emailDashboardIgnore: vi.fn(),
    emailDashboardOpened: vi.fn(),
    emailDashboardApplyMove: vi.fn(),
    onEmailDashboardChanged: vi.fn(),
  }

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    resetPainelIgnorados()
    vi.stubGlobal('window', { __scribeApi: api })
    usePainel.setState({ view: visao(), loading: false, error: null, expanded: new Set(), showAllReplies: false, lastBatch: null })
    useEmail.setState({ bannerDismissed: [], bannerResults: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('CA2: 8 linhas de atenção com 3 quadrados, 3 respostas e "Mostrar mais 2", uma "Aberta" e os grupos com "Mover todos (N)"', () => {
    const html = render()
    const atencao = cartao(html, 'atencao')
    expect(conta(atencao, 'data-email-painel-linha=')).toBe(8)
    expect(conta(atencao, 'data-email-painel-marca')).toBe(3)
    expect(atencao).toContain('8 e-mails')
    const respostas = cartao(html, 'respostas')
    expect(conta(respostas, 'data-email-painel-resposta=')).toBe(3)
    expect(respostas).toContain('Mostrar mais 2')
    expect(conta(respostas, 'data-action="email-painel-aberta"')).toBe(1)
    expect(conta(respostas, 'data-action="email-painel-composer"')).toBe(2)
    const organizacao = cartao(html, 'organizacao')
    expect(conta(organizacao, 'data-email-painel-grupo=')).toBe(2)
    expect(organizacao).toContain('Mover todos (4)')
    expect(organizacao).toContain('Mover todos (2)')
    expect(organizacao).toContain('Mover para Newsletters')
    expect(organizacao).toContain('>Arquivar<')
    // As linhas de mover trocam a hora por Mover e Ignorar.
    expect(conta(organizacao, 'data-action="email-painel-mover"')).toBe(6)
    expect(conta(organizacao, 'data-action="email-painel-ignorar-mover"')).toBe(6)
    // Contas no topo da coluna da esquerda (D3).
    expect(html).toContain(textoConta({ unread: 5, pending: 3, pop3: false }))
    expect(html).toContain('1 não lido · 0 pendentes · POP3')
    // "Mostrar mais" abre o resto em linha.
    usePainel.getState().setShowAllReplies(true)
    const todas = cartao(render(), 'respostas')
    expect(conta(todas, 'data-email-painel-resposta=')).toBe(5)
    expect(todas).not.toContain('Mostrar mais')
  })

  it('CA3: "Ver resposta" abre só o 1º bloco por inteiro e vira "Ver menos"', () => {
    const antes = cartao(render(), 'respostas')
    expect(conta(antes, 'line-clamp-2')).toBe(3)
    expect(conta(antes, '>Ver resposta<')).toBe(3)
    usePainel.getState().toggleExpanded(itemKey(A, 'k1'))
    const depois = cartao(render(), 'respostas')
    const blocos = depois.split('data-email-painel-resposta=').slice(1)
    expect(blocos[0]).toContain('>Ver menos<')
    expect(blocos[0]).not.toContain('line-clamp-2')
    expect(blocos[0]).toContain('Segundo parágrafo da resposta 1.')
    for (const bloco of blocos.slice(1)) {
      expect(bloco).toContain('>Ver resposta<')
      expect(bloco).toContain('line-clamp-2')
    }
    usePainel.getState().toggleExpanded(itemKey(A, 'k1'))
    expect(conta(cartao(render(), 'respostas'), '>Ver resposta<')).toBe(3)
  })

  it('CA4: "Abrir no Composer" marca a resposta como aberta e leva à Caixa de Entrada com o pedido de resposta', async () => {
    api.emailDashboardOpened.mockResolvedValue(visao())
    const navigate = vi.fn()
    const row = resposta(1)
    usePainel.getState().openReply(row, navigate)
    expect(api.emailDashboardOpened).toHaveBeenCalledWith({ accountId: A, messageKey: 'k2' })
    expect(navigate).toHaveBeenCalledTimes(1)
    const [to, options] = navigate.mock.calls[0] as [string, { state: { compose: { replyTo: { messageKey: string; mailbox: string }; text: string } } }]
    expect(to).toBe(emailPath(A, 'inbox'))
    expect(to).toBe(`/email/${A}/entrada`)
    expect(options.state.compose.replyTo).toEqual({ messageKey: 'k2', mailbox: 'INBOX' })
    expect(options.state.compose.text).toBe(row.reply)
    // Otimista: o bloco já mostra "Aberta".
    expect(resposta(1).opened).toBe(true)
    // Nada é enviado nem movido.
    expect(invoke).not.toHaveBeenCalled()
    expect(api.emailDashboardApplyMove).not.toHaveBeenCalled()
  })

  it('CA6: Ignorar tira a linha na hora e chama o IPC com o tipo certo', async () => {
    let resolve: (view: EmailDashboardView) => void = () => undefined
    api.emailDashboardIgnore.mockImplementation(() => new Promise<EmailDashboardView>((done) => (resolve = done)))
    const pending = usePainel.getState().ignore(A, 'k2', 'reply')
    expect(atual().replies.map((row) => row.messageKey)).toEqual(['k1', 'k3', 'k4', 'k5'])
    expect(cartao(render(), 'respostas')).not.toContain('data-email-painel-resposta="k2"')
    expect(api.emailDashboardIgnore).toHaveBeenCalledWith({ accountId: A, messageKey: 'k2', kind: 'reply' })
    resolve(atual())
    await pending

    api.emailDashboardIgnore.mockResolvedValue(visao())
    usePainel.setState({ view: visao() })
    const move = usePainel.getState().ignore(A, 'k12', 'move')
    expect(grupo(0).rows.map((row) => row.messageKey)).toEqual(['k11', 'k13', 'k14'])
    expect(api.emailDashboardIgnore).toHaveBeenLastCalledWith({ accountId: A, messageKey: 'k12', kind: 'move' })
    await move
  })

  it('CA6: dois Ignorar seguidos com o IPC lento: a resposta do 1º (ainda com a linha do 2º) não traz a linha de volta', async () => {
    const respostas: ((view: EmailDashboardView) => void)[] = []
    api.emailDashboardIgnore.mockImplementation(() => new Promise<EmailDashboardView>((done) => respostas.push(done)))
    const primeiro = usePainel.getState().ignore(A, 'k1', 'reply')
    const segundo = usePainel.getState().ignore(A, 'k2', 'reply')
    expect(atual().replies.map((row) => row.messageKey)).toEqual(['k3', 'k4', 'k5'])
    // O main gravou só o 1º: a visão dele ainda traz o k2.
    const doPrimeiro = visao()
    respostas[0]?.({ ...doPrimeiro, replies: doPrimeiro.replies.filter((row) => row.messageKey !== 'k1') })
    await primeiro
    expect(atual().replies.map((row) => row.messageKey)).toEqual(['k3', 'k4', 'k5'])
    // O evento velho também não traz nenhuma de volta.
    let listener: (view: EmailDashboardView) => void = () => undefined
    api.onEmailDashboardChanged.mockImplementation((fn: (view: EmailDashboardView) => void) => {
      listener = fn
      return () => undefined
    })
    const stop = usePainel.getState().subscribe()
    listener(visao())
    expect(atual().replies.map((row) => row.messageKey)).toEqual(['k3', 'k4', 'k5'])
    respostas[1]?.(visao())
    await segundo
    expect(atual().replies.map((row) => row.messageKey)).toEqual(['k3', 'k4', 'k5'])
    expect(cartao(render(), 'respostas')).not.toMatch(/data-email-painel-resposta="k[12]"/)
    stop()
  })

  it('CA6: o IPC que falha relê a visão (a linha volta)', async () => {
    api.emailDashboardIgnore.mockRejectedValue(new Error('bloqueado'))
    api.emailDashboardGet.mockResolvedValue(visao())
    await usePainel.getState().ignore(A, 'k2', 'reply')
    await vi.waitFor(() => expect(atual().replies).toHaveLength(5))
  })

  it('CA7: "Mover todos (4)" move o grupo, mostra o banner e o Desfazer chama o undo do lote e recarrega', async () => {
    api.emailDashboardApplyMove.mockResolvedValue({ batchId: 'lote-1', moved: 4 })
    const keys = grupo(0).rows.map((row) => row.messageKey)
    const pending = usePainel.getState().applyMove(A, 'Newsletters', keys)
    // O grupo sai na hora.
    expect(atual().moves.map((group) => group.folder)).toEqual(['Archive'])
    await pending
    expect(api.emailDashboardApplyMove).toHaveBeenCalledWith({ accountId: A, folder: 'Newsletters', messageKeys: ['k11', 'k12', 'k13', 'k14'] })
    const html = render()
    expect(html).toContain('data-email-organize-banner="lote-1"')
    expect(html).toContain(textoMovidos(4, 'Newsletters'))
    expect(html).toContain('4 e-mails movidos para Newsletters')
    expect(html).toContain('Pelo Painel, às')
    expect(html).toContain('Desfazer')
    expect(cartao(html, 'organizacao')).not.toContain('Mover para Newsletters')

    invoke.mockResolvedValue({ ok: true, undone: 4, failed: [] })
    api.emailDashboardGet.mockResolvedValue(visao())
    await usePainel.getState().undoLast()
    expect(invoke).toHaveBeenCalledWith('scribe:email-batch-undo', { batchId: 'lote-1' })
    expect(api.emailDashboardGet).toHaveBeenCalled()
    expect(atual().moves).toHaveLength(2)

    // O × tira o banner.
    usePainel.getState().clearBatch()
    expect(render()).not.toContain('data-email-organize-banner')
  })

  it('CA7: mover que falha mostra o erro fixo e relê', async () => {
    api.emailDashboardApplyMove.mockRejectedValue(new Error('x'))
    api.emailDashboardGet.mockResolvedValue(visao())
    await usePainel.getState().applyMove(A, 'Newsletters', ['k11'])
    expect(usePainel.getState().error).toBe('Não foi possível mover')
    expect(usePainel.getState().lastBatch).toBeNull()
    expect(render()).toContain('data-notice="email-painel-error"')
  })

  it('CA8: desligada, "Analisar agora" desabilitado, a nota com o link e só Precisam de atenção, sem quadrado nem motivo', () => {
    usePainel.setState({ view: visao({ enabled: false, lastRun: null, replies: [], moves: [], attention: [linha(1, 0), linha(2, 0)] }) })
    const html = render()
    expect(html).toMatch(/<button type="button" data-action="email-painel-analisar" disabled=""/)
    expect(html).toContain('data-notice="email-painel-ia-desligada"')
    expect(html).toContain(`href="${settingsPath('email')}"`)
    expect(html).toContain('Configurações › Email')
    expect(cartao(html, 'atencao')).not.toBe('')
    expect(cartao(html, 'respostas')).toBe('')
    expect(cartao(html, 'organizacao')).toBe('')
    expect(html).not.toContain('data-email-painel-marca')
    expect(html).not.toContain('data-email-painel-motivo')
    expect(html).toContain('Ainda não analisado · análise por IA desligada')
    expect(cartao(html, 'atencao')).toContain('2 não lidos pendentes')
  })

  it('CA9: rodando, "Analisando…" desabilitado; o evento com running=false volta a "Analisar agora" e ao subtítulo novo', () => {
    let listener: (view: EmailDashboardView) => void = () => undefined
    api.onEmailDashboardChanged.mockImplementation((fn: (view: EmailDashboardView) => void) => {
      listener = fn
      return () => undefined
    })
    usePainel.setState({ view: visao({ running: true, lastRun: null }) })
    const rodando = render()
    expect(rodando).toMatch(/data-action="email-painel-analisar" disabled=""[^>]*>[\s\S]*?Analisando…/)
    expect(rodando).toContain('Ainda não analisado')
    const stop = usePainel.getState().subscribe()
    listener(visao({ running: false, lastRun: { at: AGORA, model: 'haiku', analyzed: 12, costUsd: 0.01, error: null } }))
    const pronto = render()
    expect(pronto).not.toContain('Analisando…')
    expect(pronto).toMatch(/data-action="email-painel-analisar"(?! disabled)[^>]*>[\s\S]*?Analisar agora/)
    expect(pronto).toContain('Analisado às 09:12 · 12 e-mails · Haiku')
    stop()
  })

  it('CA9: "Analisar agora" com a passada já rodando só marca o botão', async () => {
    api.emailDashboardRun.mockResolvedValue({ started: false, running: true })
    await usePainel.getState().run()
    expect(atual().running).toBe(true)
  })

  it('CA11: cada cartão vazio fica com a linha do vazio', () => {
    usePainel.setState({ view: visao({ attention: [], replies: [], moves: [] }) })
    const html = render()
    expect(cartao(html, 'atencao')).toContain('Nada precisa de atenção')
    expect(cartao(html, 'respostas')).toContain('Nenhuma resposta sugerida')
    expect(cartao(html, 'organizacao')).toContain('Caixa de Entrada em ordem')
    expect(conta(html, 'data-email-painel-vazio=')).toBe(3)
    expect(conta(html, 'class="flex h-8 items-center gap-2 text-13 text-text-muted"')).toBe(3)
  })

  it('textos do cabeçalho e das Configurações', () => {
    expect(painelSubtitulo(visao())).toBe('Analisado às 09:12 · 38 e-mails · Haiku')
    expect(painelSubtitulo({ enabled: true, lastRun: null })).toBe('Ainda não analisado')
    expect(textoUltimaAnalise(visao().lastRun)).toBe('Às 09:12 · 38 e-mails · US$ 0,02')
    expect(textoUltimaAnalise(null)).toBe('Nunca')
    expect(textoMovidos(1, 'Arquivar')).toBe('1 e-mail movido para o Arquivo')
  })
})
