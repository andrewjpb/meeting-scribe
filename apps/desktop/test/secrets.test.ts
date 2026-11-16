import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSecretStore, EncryptionUnavailableError, InvalidKeyError, memorySafeStorage, SECRETS_FILE, type SafeStorageLike } from '../src/main/secrets'
import { INVOKE_CHANNELS } from '../src/shared/ipc'

const KEY = 'chave-de-teste-ficticia-0123abcd'

/** `safeStorage` falso: "cifra" invertendo e marcando, e conta as chamadas. */
function fakeSafeStorage(available = true): SafeStorageLike & { encryptString: ReturnType<typeof vi.fn>; decryptString: ReturnType<typeof vi.fn> } {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`)),
    decryptString: vi.fn((data: Buffer) => [...data.toString().slice(4)].reverse().join('')),
  }
}

describe('secrets (CA3)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'secrets-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('grava só o resultado de encryptString, em secrets.bin com modo 0600', () => {
    const safeStorage = fakeSafeStorage()
    const store = createSecretStore({ dir, safeStorage, isPackaged: true })
    store.save(`  ${KEY}\n`)
    const file = join(dir, SECRETS_FILE)
    expect(safeStorage.encryptString).toHaveBeenCalledWith(KEY)
    expect(readFileSync(file)).toEqual(safeStorage.encryptString.mock.results[0]?.value)
    expect(readFileSync(file, 'utf8')).not.toContain(KEY)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([SECRETS_FILE])
    expect(store.status()).toEqual({ configured: true, last4: 'abcd', source: 'saved' })
    expect(store.getApiKey()).toBe(KEY)

    // App reaberto: decifra do disco.
    const reopened = createSecretStore({ dir, safeStorage, isPackaged: true })
    expect(reopened.status()).toEqual({ configured: true, last4: 'abcd', source: 'saved' })
    expect(reopened.getApiKey()).toBe(KEY)
  })

  it('sem cifragem disponível, falha com erro tipado e nada é escrito', () => {
    const store = createSecretStore({ dir, safeStorage: fakeSafeStorage(false), isPackaged: true })
    expect(() => store.save(KEY)).toThrow(EncryptionUnavailableError)
    expect(readdirSync(dir)).toEqual([])
    expect(store.status()).toEqual({ configured: false, last4: null, source: null })
  })

  it.each(['', '   ', 'com espaço no meio', 'x'.repeat(600), 'chave-com-acentuação', 'chave\u0000nula', 'chave\ttab', 'chave\u200bzero', 'chave-€'])(
    'recusa chave fora do ASCII imprimível (%j) com erro tipado, sem gravar',
    (key) => {
      const safeStorage = fakeSafeStorage()
      const store = createSecretStore({ dir, safeStorage, isPackaged: true })
      expect(() => store.save(key)).toThrow(InvalidKeyError)
      expect(() => store.save(key)).toThrow('Chave em formato inválido')
      expect(safeStorage.encryptString).not.toHaveBeenCalled()
      expect(readdirSync(dir)).toEqual([])
    },
  )

  it('remover apaga o arquivo', () => {
    const store = createSecretStore({ dir, safeStorage: fakeSafeStorage(), isPackaged: true })
    store.save(KEY)
    store.remove()
    expect(existsSync(join(dir, SECRETS_FILE))).toBe(false)
    expect(store.status()).toEqual({ configured: false, last4: null, source: null })
    expect(store.getApiKey()).toBeNull()
  })

  it('arquivo que não decifra vale como sem chave', () => {
    writeFileSync(join(dir, SECRETS_FILE), 'lixo')
    const safeStorage = fakeSafeStorage()
    safeStorage.decryptString.mockImplementation(() => {
      throw new Error('falhou')
    })
    const store = createSecretStore({ dir, safeStorage, isPackaged: true })
    expect(store.status()).toEqual({ configured: false, last4: null, source: null })
  })

  it('em desenvolvimento, sem chave salva, vale ASSEMBLYAI_API_KEY (dev-env); empacotado, nunca', () => {
    const env = { ASSEMBLYAI_API_KEY: 'chave-do-ambiente-9876' }
    const dev = createSecretStore({ dir, safeStorage: fakeSafeStorage(), isPackaged: false, env })
    expect(dev.status()).toEqual({ configured: true, last4: '9876', source: 'dev-env' })
    expect(dev.getApiKey()).toBe('chave-do-ambiente-9876')
    dev.save(KEY)
    expect(dev.status()).toEqual({ configured: true, last4: 'abcd', source: 'saved' })

    const packaged = createSecretStore({ dir: mkdtempSync(join(tmpdir(), 'secrets-')), safeStorage: fakeSafeStorage(), isPackaged: true, env })
    expect(packaged.status()).toEqual({ configured: false, last4: null, source: null })
    expect(packaged.getApiKey()).toBeNull()
  })

  it('o substituto em memória do smoke faz o caminho de ida e volta sem o Chaveiro', () => {
    const store = createSecretStore({ dir, safeStorage: memorySafeStorage(), isPackaged: true })
    store.save(KEY)
    expect(createSecretStore({ dir, safeStorage: memorySafeStorage(), isPackaged: true }).getApiKey()).toBe(KEY)
  })

  it('nenhum canal do renderer devolve a chave: só o estado', () => {
    const keyChannels = INVOKE_CHANNELS.filter((channel) => channel.includes('key'))
    expect(keyChannels.sort()).toEqual(['scribe:key-remove', 'scribe:key-save', 'scribe:key-status', 'scribe:key-verify'])
    expect(INVOKE_CHANNELS.some((channel) => /secret|api-key|key-get|key-read/.test(channel))).toBe(false)
  })
})
