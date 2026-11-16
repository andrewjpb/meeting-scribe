// O que os canais de Configurações fazem no main, com `fetch` injetado (respostas reais gravadas),
// pasta temporária e `safeStorage` em memória.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGatewayClient, type FetchLike } from '../src/main/assemblyai/gateway'
import { createMicPermissions, fakeMediaAccess, normalizeMicAccess } from '../src/main/permissions'
import { createSecretStore, memorySafeStorage, SECRETS_FILE, type SafeStorageLike } from '../src/main/secrets'
import { createSettingsService, type SettingsService } from '../src/main/settings/service'
import { createFileSettingsStore, SETTINGS_FILE } from '../src/main/settings/store'
import { DEFAULT_SETTINGS } from '../src/shared/settings-defaults'

const fixture = (name: string): string => readFileSync(resolve(__dirname, 'fixtures/assemblyai', name), 'utf8')
const reply = (status: number, body: string) => Promise.resolve({ status, text: () => Promise.resolve(body) })
const KEY = 'chave-ficticia-de-teste-0000-beef'

describe('serviço de Configurações', () => {
  let dir: string
  let fetch: ReturnType<typeof vi.fn<FetchLike>>
  let service: SettingsService
  let safeStorage: SafeStorageLike

  const build = (): SettingsService => {
    const secrets = createSecretStore({ dir, safeStorage, isPackaged: true })
    const gateway = createGatewayClient({ fetch, getApiKey: () => secrets.getApiKey() })
    return createSettingsService({ settings: createFileSettingsStore({ dir }), secrets, gateway, mic: createMicPermissions(fakeMediaAccess('granted')) })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-service-'))
    fetch = vi.fn<FetchLike>()
    safeStorage = memorySafeStorage()
    service = build()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const saved = (): boolean => existsSync(join(dir, SECRETS_FILE))

  it('Salvar: chave aceita pelo gateway é salva e "válida" (CA4)', async () => {
    fetch.mockImplementation(() => reply(400, fixture('key-probe-empty-body.json')))
    const result = await service.saveKey(KEY)
    expect(result).toEqual({ check: 'valid', status: { configured: true, last4: 'beef', source: 'saved' } })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(saved()).toBe(true)
  })

  it.each([401, 403])('Salvar: %i não salva (CA4)', async (status) => {
    fetch.mockImplementation(() => reply(status, fixture('auth-error.json')))
    expect(await service.saveKey(KEY)).toEqual({ check: 'refused', status: { configured: false, last4: null, source: null } })
    expect(saved()).toBe(false)
  })

  it('Salvar: falha de rede salva sem conferir; "Tentar de novo" confere a salva (CA4)', async () => {
    fetch.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    expect(await service.saveKey(KEY)).toEqual({ check: 'unverified', status: { configured: true, last4: 'beef', source: 'saved' } })
    expect(saved()).toBe(true)
    fetch.mockImplementation(() => reply(400, fixture('key-probe-empty-body.json')))
    expect((await service.verifyKey()).check).toBe('valid')
    expect(fetch.mock.calls.at(-1)?.[1].headers['authorization']).toBe(KEY)
  })

  it('Salvar: sem cifragem disponível não escreve nada', async () => {
    safeStorage = { ...memorySafeStorage(), isEncryptionAvailable: () => false }
    service = build()
    fetch.mockImplementation(() => reply(400, fixture('key-probe-empty-body.json')))
    expect((await service.saveKey(KEY)).check).toBe('unavailable')
    expect(saved()).toBe(false)
  })

  it('Salvar: 400 com outro corpo, 404 e 429 salvam como não verificada (CA4)', async () => {
    for (const [status, body] of [[400, '{"message":"bad request"}'], [404, '{}'], [429, '{}']] as const) {
      service.removeKey()
      fetch.mockImplementation(() => reply(status, body))
      expect((await service.saveKey(KEY)).check).toBe('unverified')
      expect(saved()).toBe(true)
    }
  })

  it('Salvar: texto vazio nem chega ao gateway', async () => {
    expect((await service.saveKey('   ')).check).toBe('invalid')
    expect(await service.saveKey(undefined)).toMatchObject({ check: 'invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Remover apaga a chave e o catálogo passa a pedir chave (CA8)', async () => {
    fetch.mockImplementation(() => reply(400, fixture('key-probe-empty-body.json')))
    await service.saveKey(KEY)
    expect(service.removeKey()).toEqual({ configured: false, last4: null, source: null })
    expect(saved()).toBe(false)
    expect(await service.listModels()).toEqual({ ok: false, error: 'no-key' })
  })

  it('catálogo: lista com chave; sem rede vira erro "network" (CA8)', async () => {
    fetch.mockImplementation(() => reply(400, fixture('key-probe-empty-body.json')))
    await service.saveKey(KEY)
    fetch.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    expect(await service.listModels()).toEqual({ ok: false, error: 'network' })
    fetch.mockImplementation(() => reply(200, fixture('models.json')))
    const result = await service.listModels()
    expect(result.ok && result.models).toHaveLength(60)
  })

  describe('escolha de modelo (CA7)', () => {
    beforeEach(async () => {
      fetch.mockImplementation(() => reply(200, fixture('chat-ok.json')))
      await service.saveKey(KEY)
      expect((await service.selectModel('gpt-oss-120b')).check).toBe('selected')
      fetch.mockClear()
    })

    it('o canal de configurações não troca o modelo', async () => {
      await expect(service.updateSettings({ translationModel: 'qwen3.5-4b-32k-fast' })).rejects.toThrow()
      expect(onDisk()).toBe('gpt-oss-120b')
    })
    const onDisk = (): string => (JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8')) as { settings: { translationModel: string } }).settings.translationModel

    it('200 grava translationModel', async () => {
      fetch.mockImplementation(() => reply(200, fixture('chat-ok.json')))
      const result = await service.selectModel('qwen3.5-4b-32k-fast')
      expect(result.check).toBe('selected')
      expect(result.settings.translationModel).toBe('qwen3.5-4b-32k-fast')
      expect(onDisk()).toBe('qwen3.5-4b-32k-fast')
    })

    it('400 real de modelo não liberado mantém a seleção anterior', async () => {
      fetch.mockImplementation(() => reply(400, fixture('chat-model-not-allowed.json')))
      const result = await service.selectModel('gemini-2.5-flash-lite')
      expect(result).toEqual({ check: 'not-allowed', settings: { ...DEFAULT_SETTINGS, translationModel: 'gpt-oss-120b' } })
      expect(onDisk()).toBe('gpt-oss-120b')
    })

    it('falha de rede mantém a seleção anterior', async () => {
      fetch.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
      expect((await service.selectModel('qwen3.5-4b-32k-fast')).check).toBe('network')
      expect(onDisk()).toBe('gpt-oss-120b')
    })

    it('sem chave não chama o gateway', async () => {
      service.removeKey()
      fetch.mockClear()
      expect((await service.selectModel('qwen3.5-4b-32k-fast')).check).toBe('no-key')
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([['vazio', ''], ['com espaço', ' qwen'], ['acima de 128', 'm'.repeat(129)], ['fora do ASCII', 'modelo-ç'], ['não texto', 42]])(
      'id %s é recusado antes do gateway',
      async (_label, id) => {
        await expect(service.selectModel(id)).rejects.toThrow()
        expect(fetch).not.toHaveBeenCalled()
        expect(onDisk()).toBe('gpt-oss-120b')
      },
    )

    it('id de 128 caracteres ASCII chega ao gateway', async () => {
      fetch.mockImplementation(() => reply(400, fixture('chat-model-not-allowed.json')))
      expect((await service.selectModel('m'.repeat(128))).check).toBe('not-allowed')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})

describe('permissão de microfone (CA12)', () => {
  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['restricted', 'denied'],
    ['not-determined', 'not-determined'],
    ['unknown', 'not-determined'],
  ])('%s -> %s', (status, expected) => {
    expect(normalizeMicAccess(status)).toBe(expected)
  })

  it('"Permitir" só pede ao macOS quando ainda não foi pedido', async () => {
    const api = fakeMediaAccess('not-determined')
    const mic = createMicPermissions(api)
    expect(mic.status()).toBe('not-determined')
    expect(await mic.request()).toBe('granted')
    expect(api.asked).toBe(1)
    api.set('denied')
    expect(await mic.request()).toBe('denied')
    expect(api.asked).toBe(1)
  })
})
