// Contrato 155 (email-dashboard, CA7): o store de `email/dashboard.json`. Gravação e leitura, modo 0600, arquivo
// corrompido ou de outra versão, apagar uma conta, a fila de `update` e o `clear`.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmailDashboardStore } from '../../src/main/email/dashboard-store'
import { emptyDashboardStore, ignoreKey, itemKey, type EmailDashboardItem, type EmailDashboardStore } from '../../src/shared/email-dashboard'

const NOW = Date.parse('2026-11-23T12:00:00.000Z')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'email-dashboard-store-'))
  dirs.push(base)
  // A pasta `email/` ainda não existe: o store cria.
  const dir = join(base, 'email')
  const logs: string[] = []
  const store = createEmailDashboardStore(dir, { log: (message) => void logs.push(message) })
  return { dir, file: join(dir, 'dashboard.json'), store, logs }
}

const item = (accountId: string, messageKey: string): EmailDashboardItem => ({
  accountId,
  messageKey,
  messageId: `<${messageKey}@x>`,
  analyzedAt: NOW,
  model: 'haiku',
  importance: 4,
  reason: 'Cliente pede retorno sobre a proposta',
  needsReply: true,
  reply: 'Olá,\n\nretorno até sexta.',
  move: null,
})

function cheio(): EmailDashboardStore {
  const store = emptyDashboardStore()
  store.lastRun = { at: NOW, model: 'sonnet', analyzed: 3, costUsd: 0.01, error: null }
  store.items[itemKey('a', '1')] = item('a', '1')
  store.items[itemKey('ab', '2')] = item('ab', '2')
  store.items[itemKey('b', '3')] = item('b', '3')
  store.ignored.push({ key: ignoreKey('a', '1', 'move'), at: NOW }, { key: ignoreKey('b', '3', 'reply'), at: NOW })
  store.opened.push({ key: itemKey('a', '1'), at: NOW })
  return store
}

describe('store do Painel de e-mail (CA7)', () => {
  it('grava e lê o mesmo conteúdo, arquivo 0600 e pasta 0700', async () => {
    const { store, file, dir } = setup()
    expect(await store.load()).toEqual(emptyDashboardStore())
    expect(existsSync(file)).toBe(false)
    await store.save(cheio())
    expect(await store.load()).toEqual(cheio())
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('JSON corrompido ou de outra versão: store vazio, com uma linha de log sem conteúdo', async () => {
    const { store, file, logs } = setup()
    await store.save(cheio())
    writeFileSync(file, '{ quebrado')
    expect(await store.load()).toEqual(emptyDashboardStore())
    writeFileSync(file, JSON.stringify({ ...cheio(), version: 2 }))
    expect(await store.load()).toEqual(emptyDashboardStore())
    expect(logs).toHaveLength(2)
    expect(logs.join('\n')).not.toContain('proposta')
  })

  it('fora do formato não grava', async () => {
    const { store, file } = setup()
    await store.save(cheio())
    const ruim = cheio()
    ruim.items[itemKey('a', '1')] = { ...item('a', '1'), reason: 'x'.repeat(141) }
    await expect(store.save(ruim)).rejects.toThrow()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(cheio())
  })

  it('removeAccount tira só as chaves da conta (a:*), não as de "ab"', async () => {
    const { store } = setup()
    await store.save(cheio())
    await store.removeAccount('a')
    const out = await store.load()
    expect(Object.keys(out.items).sort()).toEqual(['ab:2', 'b:3'])
    expect(out.ignored.map((mark) => mark.key)).toEqual(['b:3:reply'])
    expect(out.opened).toEqual([])
    expect(out.lastRun).toEqual(cheio().lastRun)
  })

  it('duas chamadas de update ao mesmo tempo aplicam as duas', async () => {
    const { store } = setup()
    const conta = (s: EmailDashboardStore): EmailDashboardStore => ({ ...s, lastRun: { at: NOW, model: 'haiku', analyzed: (s.lastRun?.analyzed ?? 0) + 1, costUsd: null, error: null } })
    const [um, dois] = await Promise.all([store.update(conta), store.update(conta)])
    expect(um.lastRun?.analyzed).toBe(1)
    expect(dois.lastRun?.analyzed).toBe(2)
    expect((await store.load()).lastRun?.analyzed).toBe(2)
  })

  it('clear apaga o arquivo; removeAccount sem arquivo não cria nada', async () => {
    const { store, file } = setup()
    await store.save(cheio())
    await store.clear()
    expect(existsSync(file)).toBe(false)
    await store.removeAccount('a')
    expect(existsSync(file)).toBe(false)
    expect(await store.load()).toEqual(emptyDashboardStore())
  })
})
