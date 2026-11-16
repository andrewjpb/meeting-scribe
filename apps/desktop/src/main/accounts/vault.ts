// Arquivo cifrado das contas (contrato 11): o mesmo padrão da chave da AssemblyAI (`secrets.ts`). No disco vai
// só o resultado de `safeStorage.encryptString` (chave no Chaveiro do macOS), em `userData/accounts/`, pasta
// 0700 e arquivo 0600, escrito num temporário e renomeado. Arquivo que não decifra ou não passa no esquema é
// tratado como ausente.
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'

export const ACCOUNTS_DIR = 'accounts'

export interface Vault<T> {
  read(): T | null
  write(value: T): void
  remove(): void
}

export function createVault<T>(file: string, safeStorage: SafeStorageLike, parse: (raw: unknown) => T | null): Vault<T> {
  // `undefined`: ainda não lido do disco.
  let cached: T | null | undefined
  return {
    read() {
      if (cached !== undefined) return cached
      cached = null
      if (!existsSync(file)) return cached
      try {
        cached = parse(JSON.parse(safeStorage.decryptString(readFileSync(file))) as unknown)
      } catch {
        cached = null
      }
      return cached
    },

    write(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError()
      const encrypted = safeStorage.encryptString(JSON.stringify(value))
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
      try {
        writeFileSync(temp, encrypted, { mode: 0o600 })
        chmodSync(temp, 0o600)
        renameSync(temp, file)
      } catch (error) {
        rmSync(temp, { force: true })
        throw error
      }
      cached = value
    },

    remove() {
      rmSync(file, { force: true })
      cached = null
    },
  }
}
