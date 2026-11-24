// Contrato 157 (CA1, R10, R11): o clique em "Email" vindo de fora leva ao Painel; no Painel, à última pasta aberta; de
// uma pasta, ao Painel; sem conta, como antes. No nível Email, a linha Painel vem antes das contas e fica marcada em
// `/email/painel`. O destino sai de `emailNavTarget` (o mesmo que o `Sidebar` usa no clique).
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailAccountStatus } from '../../src/shared/email'
import { emailPath, EMAIL_PAINEL_PATH, ROUTE_PATHS } from '../../src/shared/routes'
import { emailNavTarget, levelFor, rememberEmailPath, resetSidebarMemory } from '../../src/renderer/src/app/sidebarLevels'
import { EmailNav } from '../../src/renderer/src/features/email/EmailNav'
import { useEmail } from '../../src/renderer/src/features/email/emailStore'

vi.mock('zustand', async (original) => (await import('./zustand-ssr')).withCurrentState(await original()))

const A = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const B = '1b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'

const status = (id: string, name: string): EmailAccountStatus => ({
  account: { id, address: `${name.toLowerCase()}@lap.example`, name, username: 'x', incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' }, outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' }, deleteFromServer: false },
  state: 'connected',
  error: null,
  sentMailbox: 'Sent',
})

describe('Email na barra lateral leva ao Painel (CA1)', () => {
  beforeEach(() => resetSidebarMemory())
  afterEach(() => vi.unstubAllGlobals())

  it('do Início, o Painel (nível Email); clicando de novo, a última pasta', () => {
    // Uma pasta aberta antes, na sessão.
    rememberEmailPath(emailPath(B, 'sent'))
    const doInicio = emailNavTarget(ROUTE_PATHS.inicio, [A, B])
    expect(doInicio).toBe('/email/painel')
    expect(levelFor(EMAIL_PAINEL_PATH, null, 'k')).toBe('email')
    // O Painel não troca a última pasta lembrada.
    rememberEmailPath(EMAIL_PAINEL_PATH)
    expect(emailNavTarget(EMAIL_PAINEL_PATH, [A, B])).toBe(emailPath(B, 'sent'))
  })

  it('de uma pasta, o Painel; no Painel sem pasta lembrada, só o nível; sem conta, como antes; carregando, o Painel', () => {
    expect(emailNavTarget(emailPath(A, 'inbox'), [A, B])).toBe(EMAIL_PAINEL_PATH)
    expect(emailNavTarget(EMAIL_PAINEL_PATH, [A, B])).toBeNull()
    expect(emailNavTarget(ROUTE_PATHS.inicio, [])).toBe('/email')
    expect(emailNavTarget('/email', [])).toBeNull()
    // Contas ainda carregando: o Painel (a tela decide quando elas chegam).
    expect(emailNavTarget(ROUTE_PATHS.inicio, null)).toBe(EMAIL_PAINEL_PATH)
    expect(emailNavTarget(emailPath(A, 'inbox'), null)).toBe(EMAIL_PAINEL_PATH)
    // A pasta lembrada de uma conta que saiu não vale.
    rememberEmailPath(emailPath(B, 'inbox'))
    expect(emailNavTarget(EMAIL_PAINEL_PATH, [A])).toBeNull()
  })

  it('no nível Email, o Painel marcado em /email/painel e as contas abaixo dele', () => {
    vi.stubGlobal('window', { __scribeApi: { invoke: vi.fn(), send: vi.fn(), on: vi.fn() } })
    useEmail.setState({ accounts: [status(A, 'LAP'), status(B, 'Pessoal')], folders: {}, trees: {} })
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[EMAIL_PAINEL_PATH]}>
        <EmailNav />
      </MemoryRouter>,
    )
    const painel = html.indexOf('data-email-painel-link')
    expect(painel).toBeGreaterThan(-1)
    expect(html.slice(html.lastIndexOf('<a', painel), html.indexOf('>', painel))).toContain('aria-current="page"')
    expect(html.indexOf(`data-email-account="${A}"`)).toBeGreaterThan(painel)
    expect(html.indexOf(`data-email-account="${B}"`)).toBeGreaterThan(painel)
    // Numa pasta, o Painel não fica marcado.
    const pasta = renderToStaticMarkup(
      <MemoryRouter initialEntries={[emailPath(A, 'inbox')]}>
        <EmailNav />
      </MemoryRouter>,
    )
    const link = pasta.indexOf('data-email-painel-link')
    expect(pasta.slice(pasta.lastIndexOf('<a', link), pasta.indexOf('>', link))).not.toContain('aria-current')
  })
})
