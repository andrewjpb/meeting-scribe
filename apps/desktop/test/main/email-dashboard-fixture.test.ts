// Contrato 156 (CA12, D9): a resposta falsa da passada do Painel de e-mail, pela função e pelo `claude` falso do smoke
// (o processo, com a instrução de verdade), válida pelo esquema da saída do modelo.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EmailDashboardModelOutputSchema } from '../../src/shared/email-dashboard-schema'
import { buildEmailDashboardPrompt, emailDashboardSystemPrompt, parseEmailDashboardOutput } from '../../src/main/claude-cli/email-dashboard'
// @ts-expect-error a resposta falsa é um script .mjs sem tipos
import { fakeEmailDashboard } from '../fixtures/fake-email-dashboard.mjs'

const FAKE_CLAUDE = join(import.meta.dirname, '..', 'fixtures', 'fake-claude.mjs')

const prompt = buildEmailDashboardPrompt({
  accountName: 'eu@lap.example',
  ownAddresses: ['eu@lap.example'],
  folders: [
    { path: 'Arquivo', name: 'Arquivo' },
    { path: 'Newsletters', name: 'Newsletters' },
  ],
  archive: { path: 'Arquivo' },
  messages: ['e1', 'e2', 'e3', 'e4'].map((ref) => ({ ref, from: 'Ana <ana@x.example>', to: ['eu@lap.example'], subject: 'Oi', dateIso: '2026-11-23T10:00:00.000Z', seen: false, answered: false, pending: true, knownContact: false, preview: 'Texto' })),
})

function check(text: string): void {
  const parsed = EmailDashboardModelOutputSchema.parse(JSON.parse(text))
  expect(parsed.items.map((item) => item.ref)).toEqual(['e1', 'e2', 'e3', 'e4'])
  expect(parsed.items.map((item) => item.importance)).toEqual([5, 4, 3, 2])
  expect(parsed.items.filter((item) => item.reply)).toHaveLength(2)
  expect(parsed.items.filter((item) => item.move?.folder === 'Newsletters')).toHaveLength(2)
  const read = parseEmailDashboardOutput(text, { refs: new Set(['e1', 'e2', 'e3', 'e4']), folders: new Set(['Arquivo', 'Newsletters']) })
  expect(read).toHaveLength(4)
  expect(read.filter((entry) => entry.item.move?.folder === 'Newsletters')).toHaveLength(2)
}

describe('fixture do Painel de e-mail (contrato 156, CA12)', () => {
  it('a função devolve 2 respostas e 2 mover para Newsletters', () => {
    check(fakeEmailDashboard(prompt))
  })

  it('o `claude` falso reconhece a instrução e devolve o mesmo JSON', () => {
    const run = spawnSync(process.execPath, [FAKE_CLAUDE, '-p', '--model', 'haiku', '--output-format', 'json', '--system-prompt', emailDashboardSystemPrompt()], { input: prompt, encoding: 'utf8' })
    expect(run.status).toBe(0)
    const result = JSON.parse(run.stdout.trim()) as { result: string; is_error: boolean }
    expect(result.is_error).toBe(false)
    check(result.result)
  })

  it('sem pasta no pedido (POP3), ninguém vai para pasta', () => {
    const pop3 = buildEmailDashboardPrompt({ accountName: 'eu@lap.example', ownAddresses: [], folders: [], archive: null, messages: [{ ref: 'e1', from: 'a', to: [], subject: 's', dateIso: 'x', seen: true, answered: false, pending: false, knownContact: false, preview: null }, { ref: 'e2', from: 'a', to: [], subject: 's', dateIso: 'x', seen: true, answered: false, pending: false, knownContact: false, preview: null }] })
    expect((JSON.parse(fakeEmailDashboard(pop3)) as { items: { move: unknown }[] }).items.every((item) => item.move === null)).toBe(true)
  })
})
