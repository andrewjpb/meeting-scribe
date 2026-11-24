// Contrato 157 (CA10, D13): Configurações › Email › Painel entre Avisos e Convites, com o interruptor, o Segmented do
// modelo e a Última análise; desligado, o Segmented e o "Analisar agora" ficam desabilitados. Renderizado com
// `react-dom/server` (sem DOM nos testes); o que o clique grava sai de `emailDashboardPatch`, o mesmo do `onChange`.
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailDashboardView } from '../../src/shared/email-dashboard'
import { DEFAULT_SETTINGS } from '../../src/shared/settings-defaults'
import { settingsIndex } from '../../src/shared/settings-index'
import { useSettings } from '../../src/renderer/src/app/settingsStore'
import { usePainel } from '../../src/renderer/src/features/email/painelStore'
import { EmailPainelSection, emailDashboardPatch } from '../../src/renderer/src/features/settings/EmailPainelSection'
import { EmailSettingsTab } from '../../src/renderer/src/features/settings/EmailSettingsTab'

vi.mock('zustand', async (original) => (await import('./zustand-ssr')).withCurrentState(await original()))

const view: EmailDashboardView = { enabled: true, running: false, lastRun: { at: new Date(2026, 10, 23, 9, 12).getTime(), model: 'haiku', analyzed: 38, costUsd: 0.02, error: null }, analyzed: 38, accounts: [], attention: [], replies: [], moves: [] }

const render = (): string => renderToStaticMarkup(<EmailPainelSection />)

describe('Configurações › Email › Painel (CA10)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __scribeApi: { invoke: vi.fn(), emailDashboardGet: vi.fn(), onEmailDashboardChanged: vi.fn(() => () => undefined) } })
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, emailDashboard: { enabled: true, model: 'haiku' } } })
    usePainel.setState({ view })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('ligado: interruptor, Haiku marcado, Sonnet clicável, a última análise e o "Analisar agora"', () => {
    const html = render()
    expect(html).toContain('aria-label="Painel"')
    expect(html).toContain('O Painel fica no topo do Email. Ele sugere; nada é enviado nem movido sem o seu clique.')
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/)
    expect(html).toMatch(/data-email-dashboard-model="haiku" aria-pressed="true"/)
    expect(html).not.toMatch(/data-email-dashboard-model="sonnet"[^>]*disabled/)
    expect(html).toContain('Às 09:12 · 38 e-mails · US$ 0,02')
    expect(html).not.toMatch(/data-action="email-dashboard-run" disabled/)
  })

  it('contrato 170 (CA2): a Última análise conta o total analisado, não a última passada', () => {
    usePainel.setState({ view: { ...view, lastRun: { at: new Date(2026, 10, 23, 9, 12).getTime(), model: 'haiku', analyzed: 0, costUsd: 0.02, error: null }, analyzed: 6 } })
    expect(render()).toContain('Às 09:12 · 6 e-mails · US$ 0,02')
  })

  it('desligado: o Segmented e o "Analisar agora" desabilitados; desligar e escolher Sonnet gravam o objeto inteiro', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, emailDashboard: { enabled: false, model: 'haiku' } } })
    const html = render()
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/)
    expect(html).toMatch(/data-email-dashboard-model="haiku" aria-pressed="true" disabled=""/)
    expect(html).toMatch(/data-email-dashboard-model="sonnet" aria-pressed="false" disabled=""/)
    expect(html).toMatch(/data-action="email-dashboard-run" disabled=""/)
    expect(emailDashboardPatch({ enabled: true, model: 'haiku' }, { enabled: false })).toEqual({ emailDashboard: { enabled: false, model: 'haiku' } })
    expect(emailDashboardPatch({ enabled: true, model: 'haiku' }, { model: 'sonnet' })).toEqual({ emailDashboard: { enabled: true, model: 'sonnet' } })
  })

  it('rodando: "Analisando…" desabilitado; nunca analisado: "Nunca"', () => {
    usePainel.setState({ view: { ...view, running: true, lastRun: null } })
    const html = render()
    expect(html).toMatch(/data-action="email-dashboard-run" disabled=""[\s\S]*?Analisando…/)
    expect(html).toContain('data-setting-description="Nunca"')
  })

  it('a seção fica entre Avisos e Convites, e as três linhas estão no índice da busca', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EmailSettingsTab />
      </MemoryRouter>,
    )
    const ordem = [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((match) => match[1])
    expect(ordem.indexOf('Painel')).toBe(ordem.indexOf('Avisos') + 1)
    expect(ordem.indexOf('Convites')).toBe(ordem.indexOf('Painel') + 1)
    const linhas = settingsIndex('Claude').filter((entry) => entry.tab === 'email' && entry.section === 'Painel').map((entry) => entry.name)
    expect(linhas).toEqual(['Analisar e-mails com IA', 'Modelo', 'Última análise'])
  })
})
