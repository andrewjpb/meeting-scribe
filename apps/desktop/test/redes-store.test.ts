// Contrato 69: os arquivos de `userData/redes/` (arquivo inválido vale vazio, permissões 0700/0600, remover apaga).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RedesAccount } from '../src/shared/redes'
import { createRedesStore, MEDIA_HOST_FILE } from '../src/main/redes/store'

const account = (id: string): RedesAccount => ({
  id,
  rede: 'instagram',
  username: `conta${id}`,
  name: null,
  accountType: 'business',
  pictureUrl: null,
  followers: 10,
  mediaCount: 2,
  tokenExpiresAt: '2027-01-19T12:00:00.000Z',
  refreshedAt: '2026-11-20T12:00:00.000Z',
  connectedAt: '2026-11-20T12:00:00.000Z',
  state: 'conectada',
  error: null,
})
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8)

describe('arquivos das redes (contrato 69)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'redes-store-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('grava a conta com pasta 0700 e arquivo 0600, sem temporário sobrando', async () => {
    const root = join(dir, 'redes')
    const store = createRedesStore(root)
    await store.writeAccount(account('111'))
    expect(mode(root)).toBe('700')
    expect(mode(store.accountFile('111'))).toBe('600')
    expect(readdirSync(root)).toEqual(['instagram-111.json'])
    expect(await store.listAccounts()).toEqual([account('111')])
  })

  it('arquivo inválido, de outra conta ou ausente vale como vazio', async () => {
    const root = join(dir, 'redes')
    const store = createRedesStore(root)
    expect(await store.listAccounts()).toEqual([])
    expect(await store.readMediaHost()).toBeNull()
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'instagram-222.json'), '{ não é json')
    writeFileSync(join(root, 'instagram-333.json'), JSON.stringify({ version: 1, account: account('444') }))
    writeFileSync(join(root, 'instagram-555.json'), JSON.stringify({ version: 1, account: { ...account('555'), token: 'IGAAvazado' } }))
    writeFileSync(join(root, MEDIA_HOST_FILE), JSON.stringify({ version: 1, config: { endpoint: '' }, lastTest: null }))
    await store.writeAccount(account('666'))
    expect((await store.listAccounts()).map((item) => item.id)).toEqual(['666'])
    expect(await store.readMediaHost()).toBeNull()
  })

  it('remover apaga o arquivo; o armazenamento grava e remove', async () => {
    const root = join(dir, 'redes')
    const store = createRedesStore(root)
    await store.writeAccount(account('777'))
    await store.removeAccount('777')
    expect(existsSync(store.accountFile('777'))).toBe(false)
    const config = { endpoint: 'https://x.r2.cloudflarestorage.com', region: 'auto', bucket: 'midia', accessKeyId: 'AK', publicBaseUrl: 'https://midia.example', pathStyle: true }
    await store.writeMediaHost({ config, lastTest: null })
    expect(mode(join(root, MEDIA_HOST_FILE))).toBe('600')
    expect(await store.readMediaHost()).toEqual({ config, lastTest: null })
    await store.removeMediaHost()
    expect(await store.readMediaHost()).toBeNull()
  })

  it('id de conta fora do formato não vira caminho', () => {
    const store = createRedesStore(join(dir, 'redes'))
    expect(() => store.accountFile('../x')).toThrow()
  })
})
