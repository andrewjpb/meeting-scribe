// O que o renderer sabe da AssemblyAI. A chave nunca aparece aqui: só se há uma, os quatro últimos
// caracteres e de onde veio (N2 da spec). Catálogo e validação rodam no main (`main/assemblyai/`).

/** Painel da AssemblyAI onde se cria a chave; o main abre sempre esta URL, nunca uma vinda do renderer. */
export const ASSEMBLYAI_DASHBOARD_URL = 'https://www.assemblyai.com/dashboard'

export interface KeyStatus {
  configured: boolean
  last4: string | null
  /** `dev-env`: sem chave salva, em desenvolvimento, vale a variável `ASSEMBLYAI_API_KEY`. */
  source: 'saved' | 'dev-env' | null
}

/**
 * Resultado de salvar (ou conferir de novo) a chave. `valid` e `unverified` salvam; `refused` não
 * salva; `unavailable` é o macOS sem cifragem disponível (nada é escrito); `invalid` é texto vazio.
 */
export type KeyCheck = 'valid' | 'refused' | 'unverified' | 'unavailable' | 'invalid'

export interface KeySaveResult {
  check: KeyCheck
  status: KeyStatus
}

/** Um modelo do LLM Gateway. Preços em US$ por 1M de tokens; `null` quando não há preço fixo. */
export interface CatalogModel {
  id: string
  name: string
  contextLength: number | null
  promptPerM: number | null
  completionPerM: number | null
}

export type CatalogError = 'no-key' | 'network' | 'refused' | 'server'

export type ModelsResult = { ok: true; models: CatalogModel[] } | { ok: false; error: CatalogError }

/**
 * Escolha de modelo. `selected` gravou `translationModel`; `not-allowed` é o 400 de modelo não liberado
 * na conta; nos demais a seleção anterior continua.
 */
export type ModelCheck = 'selected' | 'not-allowed' | 'no-key' | 'refused' | 'network' | 'server'

/** Permissão de microfone do macOS, já reduzida aos três estados que a barra lateral mostra. */
export type MicAccess = 'granted' | 'denied' | 'not-determined'
