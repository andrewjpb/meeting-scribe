// Senhas das contas de email (contrato 42, N3 da PRD). No disco vai só o resultado de `safeStorage.encryptString` em
// base64, dentro de `settings.json` (`SettingsStore.setEmailAccounts`); a senha em claro só existe no main, na hora de
// conectar, e nunca vai a log. `safeStorage` chega injetado: os testes e o smoke usam um substituto em memória.
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'

export interface EmailSecrets {
  /** Cifra a senha; lança `EncryptionUnavailableError` se o macOS não oferecer cifragem agora. */
  seal(password: string): string
  /** A senha em claro, ou `null` quando o cifrado não abre (outro Mac, Chaveiro trocado). */
  open(sealed: string): string | null
}

export function createEmailSecrets(safeStorage: SafeStorageLike): EmailSecrets {
  return {
    seal(password) {
      if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError()
      return safeStorage.encryptString(password).toString('base64')
    },

    open(sealed) {
      try {
        return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
      } catch {
        return null
      }
    },
  }
}
