// Contrato 69 (CA1–CA3, CA16): o serviço das redes com o Instagram falso e o relógio injetado: conectar, renovar,
// `refreshDue` (6 dias não renova, 7 renova, 60 vence), remover e o armazenamento de mídia. Nenhum token nem segredo no
// estado que vai às janelas, nem nos arquivos de `userData/redes/`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MediaHostConfig, RedesState } from '../src/shared/redes'
import { ACCOUNTS_DIR } from '../src/main/accounts/vault'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFakeInstagram, FAKE_IG_REFRESH_EXPIRES_IN, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, type FakeInstagram } from '../src/main/redes/fake-instagram'
import type { MediaHostTester } from '../src/main/redes/media-host'
import { createRedesService, INSTAGRAM_VAULT_FILE, MEDIA_HOST_SECRET_MISSING, MEDIA_HOST_VAULT_FILE, MEDIA_HOST_VAULT_MESSAGE, REDES_EXPIRED_MESSAGE, REDES_TOO_SOON_MESSAGE, REDES_VAULT_MESSAGE, type RedesService } from '../src/main/redes/service'

const DAY = 24 * 60 * 60_000
const T0 = Date.parse('2026-11-20T12:00:00.000Z')
const SECRET = 'segredo-s3-falso-0000'

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

/** Todo o texto dos arquivos fora do cofre (os `.bin` são cifrados). */
function plainFiles(dir: string): string {
  const out: string[] = []
  const walk = (path: string): void => {
    for (const name of readdirSync(path)) {
      const full = join(path, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (!name.endsWith('.bin')) out.push(readFileSync(full, 'utf8'))
    }
  }
  walk(dir)
  return out.join('\n')
}

describe('serviço das redes (contrato 69)', () => {
  let dir: string
  let fake: FakeInstagram
  let clock: number
  let states: RedesState[]
  let tester: { calls: { config: MediaHostConfig; secret: string }[]; result: { ok: boolean; detail: string } }
  let service: RedesService

  const make = (): RedesService => {
    const testMediaHost: MediaHostTester = (config, secret) => {
      tester.calls.push({ config, secret })
      return Promise.resolve(tester.result)
    }
    return createRedesService({ userData: dir, safeStorage, fetch: fake.fetch, onState: (state) => states.push(state), now: () => clock, testMediaHost })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'redes-service-'))
    fake = createFakeInstagram()
    clock = T0
    states = []
    tester = { calls: [], result: { ok: true, detail: 'Upload e leitura pública ok' } }
    service = make()
    await service.init()
  })
  afterEach(() => {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('conecta com o token válido: conta conectada, validade de 60 dias, token só no cofre', async () => {
    const result = await service.connect({ token: `  ${SMOKE_IG_TOKEN}\n` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.account).toMatchObject({ id: SMOKE_IG_USER_ID, username: 'lap.teste', accountType: 'business', followers: 1284, state: 'conectada', error: null })
    expect(result.account.connectedAt).toBe(new Date(T0).toISOString())
    expect(result.account.refreshedAt).toBe(new Date(T0).toISOString())
    expect(result.account.tokenExpiresAt).toBe(new Date(T0 + 60 * DAY).toISOString())
    expect(existsSync(join(dir, ACCOUNTS_DIR, INSTAGRAM_VAULT_FILE))).toBe(true)
    expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.json`))).toBe(true)
    expect(JSON.stringify(service.state())).not.toContain(SMOKE_IG_TOKEN)
    expect(JSON.stringify(states)).not.toContain(SMOKE_IG_TOKEN)
    expect(plainFiles(dir)).not.toContain(SMOKE_IG_TOKEN)
    expect(states.at(-1)?.accounts).toHaveLength(1)
  })

  it('token inválido não grava nada', async () => {
    expect(await service.connect({ token: 'IGAAerrado' })).toEqual({ ok: false, error: 'Token recusado pelo Instagram' })
    expect(await service.connect({ token: '   ' })).toMatchObject({ ok: false })
    expect(await service.connect({})).toMatchObject({ ok: false })
    expect(service.state().accounts).toEqual([])
    expect(existsSync(join(dir, ACCOUNTS_DIR, INSTAGRAM_VAULT_FILE))).toBe(false)
    expect(existsSync(join(dir, 'redes'))).toBe(false)
  })

  it('o mesmo token de novo substitui o anterior, sem conta duplicada', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    clock += DAY
    const again = await service.connect({ token: SMOKE_IG_TOKEN })
    expect(again.ok && again.account.connectedAt).toBe(new Date(T0).toISOString())
    expect(again.ok && again.account.refreshedAt).toBe(new Date(T0 + DAY).toISOString())
    expect(service.state().accounts).toHaveLength(1)
  })

  it('renovar: novo token, refreshedAt e validade avançam; antes de 24 h não chama a API', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    const calls = fake.calls.length
    expect(await service.refresh({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: false, error: REDES_TOO_SOON_MESSAGE })
    expect(fake.calls.length).toBe(calls)
    clock += 2 * DAY
    const result = await service.refresh({ accountId: SMOKE_IG_USER_ID })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.account.refreshedAt).toBe(new Date(clock).toISOString())
    expect(result.account.tokenExpiresAt).toBe(new Date(clock + FAKE_IG_REFRESH_EXPIRES_IN * 1000).toISOString())
    expect(fake.calls.at(-1)).toMatchObject({ path: '/refresh_access_token', bearer: true, tokenInQuery: false })
    const json = JSON.stringify(service.state()) + plainFiles(dir)
    for (const token of fake.tokens()) expect(json).not.toContain(token)
  })

  it('renovação recusada (190) deixa a conta expirada; falha de rede deixa erro e mantém o token', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    clock += 2 * DAY
    const offline = createRedesService({ userData: dir, safeStorage, fetch: () => Promise.reject(new TypeError('fetch failed')), onState: () => undefined, now: () => clock, testMediaHost: () => Promise.resolve({ ok: true, detail: '' }) })
    await offline.init()
    const failed = await offline.refresh({ accountId: SMOKE_IG_USER_ID })
    expect(failed).toEqual({ ok: false, error: 'Não foi possível falar com o Instagram' })
    expect(offline.state().accounts[0]).toMatchObject({ state: 'erro', error: 'Não foi possível falar com o Instagram' })
    offline.dispose()
    // O serviço de antes relê do disco ao iniciar de novo: o token continua o mesmo e a renovação funciona.
    const again = make()
    await again.init()
    fake.revoke(SMOKE_IG_TOKEN)
    expect(await again.refresh({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: false, error: REDES_EXPIRED_MESSAGE })
    expect(again.state().accounts[0]).toMatchObject({ state: 'expirada', error: REDES_EXPIRED_MESSAGE })
    again.dispose()
  })

  it('refreshDue: 6 dias não renova, 7 renova, depois de vencer marca expirada sem chamar a API', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    const renewals = (): number => fake.calls.filter((call) => call.path === '/refresh_access_token').length
    clock = T0 + 6 * DAY
    await service.refreshDue()
    expect(renewals()).toBe(0)
    clock = T0 + 7 * DAY
    await service.refreshDue()
    expect(renewals()).toBe(1)
    const renewed = service.state().accounts[0]
    if (!renewed) throw new Error('sem conta')
    expect(renewed.refreshedAt).toBe(new Date(clock).toISOString())
    // Com 60 dias desde a renovação o token venceu (expires_in ~60 d): expirada, sem chamar a API.
    clock = Date.parse(renewed.tokenExpiresAt)
    await service.refreshDue()
    expect(renewals()).toBe(1)
    expect(service.state().accounts[0]).toMatchObject({ state: 'expirada', error: REDES_EXPIRED_MESSAGE })
    await service.refreshDue()
    expect(renewals()).toBe(1)
  })

  it('refreshDue sem renovar: 60 dias depois de conectar, sem abrir o app no meio, vence', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    service.dispose()
    clock = T0 + 60 * DAY
    const later = make()
    await later.init()
    await later.refreshDue()
    expect(later.state().accounts[0]?.state).toBe('expirada')
    expect(fake.calls.filter((call) => call.path === '/refresh_access_token')).toHaveLength(0)
    later.dispose()
  })

  it('remover apaga o token, o arquivo e a conta do estado', async () => {
    await service.connect({ token: SMOKE_IG_TOKEN })
    expect(await service.remove({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: true })
    expect(service.state().accounts).toEqual([])
    expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.json`))).toBe(false)
    expect(existsSync(join(dir, ACCOUNTS_DIR, INSTAGRAM_VAULT_FILE))).toBe(false)
    expect(await service.remove({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: false })
    expect(await service.remove({ accountId: '../x' })).toEqual({ ok: false })
  })

  it('armazenamento: salvar guarda o segredo no cofre, testar grava o resultado, remover limpa', async () => {
    const config: MediaHostConfig = { endpoint: 'https://abc.r2.cloudflarestorage.com', region: 'auto', bucket: 'lap-midia', accessKeyId: 'AKFALSA', publicBaseUrl: 'https://midia.example', pathStyle: true }
    const saved = await service.mediaHostSave({ config, secretAccessKey: SECRET })
    expect(saved).toEqual({ ok: true, status: { configured: true, config, secretSet: true, lastTest: null } })
    expect(JSON.stringify(saved)).not.toContain(SECRET)
    expect(existsSync(join(dir, ACCOUNTS_DIR, MEDIA_HOST_VAULT_FILE))).toBe(true)
    const tested = await service.mediaHostTest()
    expect(tester.calls).toEqual([{ config, secret: SECRET }])
    expect(tested.lastTest).toEqual({ ok: true, detail: 'Upload e leitura pública ok', at: new Date(T0).toISOString() })
    // `null` mantém o segredo; a mesma configuração mantém o teste.
    const kept = await service.mediaHostSave({ config, secretAccessKey: null })
    expect(kept.status.secretSet).toBe(true)
    expect(kept.status.lastTest?.ok).toBe(true)
    const changed = await service.mediaHostSave({ config: { ...config, bucket: 'outro' }, secretAccessKey: null })
    expect(changed.status.lastTest).toBeNull()
    expect(plainFiles(dir)).not.toContain(SECRET)
    expect(JSON.stringify(states)).not.toContain(SECRET)
    tester.result = { ok: false, detail: `Upload falhou: ${SECRET}` }
    expect((await service.mediaHostTest()).lastTest?.detail).toBe('Upload falhou: •••')
    expect(await service.mediaHostClear()).toEqual({ configured: false, config: null, secretSet: false, lastTest: null })
    expect(existsSync(join(dir, ACCOUNTS_DIR, MEDIA_HOST_VAULT_FILE))).toBe(false)
    expect(existsSync(join(dir, 'redes', 'media-host.json'))).toBe(false)
  })

  it('salvar recusado: campo vazio, endereço fora de https e chave secreta faltando voltam com a razão, sem gravar', async () => {
    const config: MediaHostConfig = { endpoint: 'https://s3.example', region: 'us-east-1', bucket: 'b', accessKeyId: 'AK', publicBaseUrl: 'https://p.example', pathStyle: false }
    const empty = { configured: false, config: null, secretSet: false, lastTest: null }
    expect(await service.mediaHostSave({ config: { ...config, bucket: '  ' }, secretAccessKey: SECRET })).toEqual({ ok: false, error: 'Preencha o campo Bucket', status: empty })
    expect(await service.mediaHostSave({ config: { ...config, endpoint: 'http://s3.example' }, secretAccessKey: SECRET })).toEqual({ ok: false, error: 'O endpoint precisa começar com https://', status: empty })
    expect(await service.mediaHostSave({ config, secretAccessKey: null })).toEqual({ ok: false, error: MEDIA_HOST_SECRET_MISSING, status: empty })
    expect(await service.mediaHostSave({ config: { endpoint: 1 }, secretAccessKey: null })).toMatchObject({ ok: false, status: empty })
    expect(existsSync(join(dir, 'redes', 'media-host.json'))).toBe(false)
    expect(existsSync(join(dir, ACCOUNTS_DIR, MEDIA_HOST_VAULT_FILE))).toBe(false)
    // Sem configuração salva, "Testar" não chama o testador.
    expect((await service.mediaHostTest()).lastTest).toBeNull()
    expect(tester.calls).toEqual([])
  })

  it('cofre do sistema indisponível: o token e a chave secreta não são gravados e a razão é a do cofre', async () => {
    const locked: SafeStorageLike = { ...safeStorage, isEncryptionAvailable: () => false }
    const noVault = createRedesService({ userData: dir, safeStorage: locked, fetch: fake.fetch, onState: () => undefined, now: () => clock, testMediaHost: () => Promise.resolve({ ok: true, detail: '' }) })
    await noVault.init()
    expect(await noVault.connect({ token: SMOKE_IG_TOKEN })).toEqual({ ok: false, error: REDES_VAULT_MESSAGE })
    expect(noVault.state().accounts).toEqual([])
    expect(existsSync(join(dir, 'redes'))).toBe(false)
    const config: MediaHostConfig = { endpoint: 'https://s3.example', region: 'auto', bucket: 'b', accessKeyId: 'AK', publicBaseUrl: 'https://p.example', pathStyle: true }
    expect(await noVault.mediaHostSave({ config, secretAccessKey: SECRET })).toMatchObject({ ok: false, error: MEDIA_HOST_VAULT_MESSAGE, status: { configured: false } })
    noVault.dispose()
    // A renovação com o cofre fora do ar: o token antigo fica, a conta mostra o porquê.
    await service.connect({ token: SMOKE_IG_TOKEN })
    clock += 2 * DAY
    const later = createRedesService({ userData: dir, safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, fetch: fake.fetch, onState: () => undefined, now: () => clock, testMediaHost: () => Promise.resolve({ ok: true, detail: '' }) })
    await later.init()
    expect(await later.refresh({ accountId: SMOKE_IG_USER_ID })).toEqual({ ok: false, error: REDES_VAULT_MESSAGE })
    expect(later.state().accounts[0]).toMatchObject({ state: 'erro', error: REDES_VAULT_MESSAGE })
    later.dispose()
  })
})
