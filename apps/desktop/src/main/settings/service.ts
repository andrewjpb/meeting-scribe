// O que a tela de Configurações e a barra lateral pedem ao main, já decidido e sem Electron: os canais
// de `shared/ipc.ts` só repassam para cá (registro em `main/index.ts`). Testado com `fetch` injetado,
// pasta temporária e `safeStorage` em memória (test/settings-service.test.ts).
import type { KeyCheck, KeySaveResult, KeyStatus, MicAccess, ModelCheck, ModelsResult } from '../../shared/assemblyai'
import type { AppSettings } from '../../shared/settings-defaults'
import { checkModelAccess, GatewayError, type GatewayClient } from '../assemblyai/gateway'
import type { MicPermissions } from '../permissions'
import { EncryptionUnavailableError, InvalidKeyError, normalizeKey, type SecretStore } from '../secrets'
import { MODEL_ID_PATTERN } from './schema'
import type { SettingsStore } from './store'

export interface SettingsServiceDeps {
  settings: SettingsStore
  secrets: SecretStore
  gateway: GatewayClient
  mic: MicPermissions
}

export interface SettingsService {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: unknown): Promise<AppSettings>
  keyStatus(): KeyStatus
  saveKey(key: unknown): Promise<KeySaveResult>
  verifyKey(): Promise<KeySaveResult>
  removeKey(): KeyStatus
  listModels(): Promise<ModelsResult>
  selectModel(id: unknown): Promise<{ check: ModelCheck; settings: AppSettings }>
  micAccess(): MicAccess
  requestMicAccess(): Promise<MicAccess>
}

export function createSettingsService({ settings, secrets, gateway, mic }: SettingsServiceDeps): SettingsService {
  const result = (check: KeyCheck): KeySaveResult => ({ check, status: secrets.status() })

  return {
    getSettings: () => settings.get(),
    updateSettings: (patch) => settings.update(patch),
    keyStatus: () => secrets.status(),

    /** 2xx/400 do gateway salva ("Chave válida"); 401/403 não salva; falha de rede salva sem conferir. */
    async saveKey(input) {
      let key: string
      try {
        key = normalizeKey(input)
      } catch {
        return result('invalid')
      }
      const check = await gateway.validateKey(key)
      if (check === 'refused') return result('refused')
      try {
        secrets.save(key)
      } catch (error) {
        if (error instanceof EncryptionUnavailableError) return result('unavailable')
        if (error instanceof InvalidKeyError) return result('invalid')
        throw error
      }
      gateway.clearCache()
      return result(check)
    },

    /** Confere a chave em uso. Recusada, continua salva: quem decide trocar ou remover é o usuário. */
    async verifyKey() {
      const key = secrets.getApiKey()
      if (!key) return result('invalid')
      return result(await gateway.validateKey(key))
    },

    removeKey() {
      secrets.remove()
      gateway.clearCache()
      return secrets.status()
    },

    async listModels() {
      if (!secrets.getApiKey()) return { ok: false, error: 'no-key' }
      try {
        return { ok: true, models: await gateway.listModels() }
      } catch (error) {
        const kind = error instanceof GatewayError ? error.kind : 'server'
        if (kind === 'network' || kind === 'timeout') return { ok: false, error: 'network' }
        if (kind === 'unauthorized') return { ok: false, error: 'refused' }
        return { ok: false, error: 'server' }
      }
    },

    async selectModel(input) {
      // Id fora do formato nem chega ao gateway.
      if (typeof input !== 'string' || !MODEL_ID_PATTERN.test(input)) throw new Error('modelo inválido')
      const id = input
      if (!secrets.getApiKey()) return { check: 'no-key', settings: await settings.get() }
      const access = await checkModelAccess(gateway, id)
      if (access !== 'available') return { check: access, settings: await settings.get() }
      return { check: 'selected', settings: await settings.setTranslationModel(id) }
    },

    micAccess: () => mic.status(),
    requestMicAccess: () => mic.request(),
  }
}
