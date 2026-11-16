// Chave da AssemblyAI (N2 da spec). Fica só no main: no disco vai apenas o resultado de
// `safeStorage.encryptString` (cifrado com a chave guardada no Chaveiro do macOS), em
// `userData/secrets.bin` com modo 0600. O renderer só recebe `KeyStatus`; nenhum canal devolve a chave.
// `safeStorage` chega injetado: o smoke usa um substituto em memória e nunca toca no Chaveiro.
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyStatus } from '../shared/assemblyai'

export const SECRETS_FILE = 'secrets.bin'
export const DEV_KEY_ENV = 'ASSEMBLYAI_API_KEY'
/** Uma chave da AssemblyAI tem 32 caracteres; o limite só barra colagem de texto qualquer. */
const MAX_KEY_LENGTH = 512
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** O macOS não oferece cifragem agora: salvar falha e nada é escrito. */
export class EncryptionUnavailableError extends Error {
  readonly code = 'encryption-unavailable'
  constructor() {
    super('cifragem indisponível neste Mac')
    this.name = 'EncryptionUnavailableError'
  }
}

/** Chave vazia, grande demais ou com caractere fora do ASCII imprimível (espaço, quebra de linha, acento). */
export class InvalidKeyError extends Error {
  readonly code = 'invalid-key'
  constructor() {
    super('Chave em formato inválido')
    this.name = 'InvalidKeyError'
  }
}

export interface SecretStore {
  status(): KeyStatus
  /** Só para o main (cabeçalho `authorization` das chamadas à AssemblyAI). */
  getApiKey(): string | null
  save(key: string): void
  remove(): void
}

export interface SecretStoreOptions {
  dir: string
  safeStorage: SafeStorageLike
  /** `app.isPackaged`: empacotado, a variável de ambiente nunca vale. */
  isPackaged: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export function normalizeKey(input: unknown): string {
  if (typeof input !== 'string') throw new InvalidKeyError()
  const key = input.trim()
  if (key.length > MAX_KEY_LENGTH || !PRINTABLE_ASCII.test(key)) throw new InvalidKeyError()
  return key
}

const last4 = (key: string): string => key.slice(-4)

export function createSecretStore({ dir, safeStorage, isPackaged, env = {} }: SecretStoreOptions): SecretStore {
  const file = join(dir, SECRETS_FILE)
  // `undefined`: ainda não lido do disco; `null`: não há chave salva (ou não deu para decifrar).
  let saved: string | null | undefined

  function readSaved(): string | null {
    if (saved !== undefined) return saved
    saved = null
    if (!existsSync(file)) return saved
    try {
      saved = normalizeKey(safeStorage.decryptString(readFileSync(file)))
    } catch {
      console.warn(`[secrets] ${SECRETS_FILE} não pôde ser decifrado; a chave precisa ser salva de novo`)
    }
    return saved
  }

  function devKey(): string | null {
    if (isPackaged) return null
    try {
      return normalizeKey(env[DEV_KEY_ENV])
    } catch {
      return null
    }
  }

  return {
    status() {
      const key = readSaved()
      if (key) return { configured: true, last4: last4(key), source: 'saved' }
      const dev = devKey()
      if (dev) return { configured: true, last4: last4(dev), source: 'dev-env' }
      return { configured: false, last4: null, source: null }
    },

    getApiKey: () => readSaved() ?? devKey(),

    save(input) {
      const key = normalizeKey(input)
      if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError()
      const encrypted = safeStorage.encryptString(key)
      const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
      try {
        writeFileSync(temp, encrypted, { mode: 0o600 })
        chmodSync(temp, 0o600)
        renameSync(temp, file)
      } catch (error) {
        rmSync(temp, { force: true })
        throw error
      }
      saved = key
    },

    remove() {
      rmSync(file, { force: true })
      saved = null
    },
  }
}

/** Substituto em memória do `safeStorage` para o smoke (e testes): nada passa pelo Chaveiro. */
export function memorySafeStorage(): SafeStorageLike {
  const PREFIX = 'mem:'
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`${PREFIX}${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8')
      if (!text.startsWith(PREFIX)) throw new Error('formato desconhecido')
      return Buffer.from(text.slice(PREFIX.length), 'base64').toString('utf8')
    },
  }
}
