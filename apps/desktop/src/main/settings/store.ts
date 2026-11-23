// Configurações em `userData/settings.json`. Lê uma vez e guarda em memória; cada mudança é validada,
// aplicada e regravada de forma atômica (arquivo temporário + `rename`), em fila, e avisada a quem
// assinou (o main repassa a todas as janelas). Arquivo ausente ou corrompido vale como os padrões; o
// corrompido é guardado como `settings.json.corrupt-<timestamp>` na primeira gravação seguinte.
// Contrato 42: as contas de email vão no mesmo arquivo, em `emailAccounts` (fora de `settings`, sem aviso às janelas),
// e só aparecem no arquivo quando há alguma. Contrato 54: as assinaturas também, em `emailSignatures` (por id de conta);
// gravar a lista de contas tira a assinatura de quem saiu. Contrato 53: as regras também, em `emailRules` (por id de
// conta, na ordem), e saem com a conta do mesmo jeito.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ASSISTANT_FOLDERS_MAX, type AssistantFolder } from '../../shared/assistant-folders'
import { assistantFolderSchema } from '../../shared/assistant-folders-schema'
import { applySettingsPatch, DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '../../shared/settings-defaults'
import type { EmailSignature } from '../../shared/email-signature'
import { emailRuleListSchema, type EmailRule } from '../../shared/email-rules'
import { audioFolderSchema, brandLogoSchema, checkEmailAccounts, claudePathSchema, emailSignatureSchema, modelIdSchema, parseEmailAccounts, parseEmailRules, parseEmailSignatures, parseSettings, parseSettingsPatch, SETTINGS_VERSION, type StoredEmailAccount } from './schema'

export const SETTINGS_FILE = 'settings.json'

/** Interface que a interface do app usa; o servidor troca esta implementação depois. */
export interface SettingsStore {
  get(): Promise<AppSettings>
  /** Valida e aplica a mudança vinda do renderer; devolve o que foi gravado. Mudança inválida lança erro. */
  update(patch: unknown): Promise<AppSettings>
  /**
   * Só para o main: a mudança calculada a partir do valor gravado agora, na mesma fila das gravações (nenhuma outra
   * mudança entra no meio). `null` não grava nada. Contrato 57: "Sempre permitir" de um conector.
   */
  mutate(change: (current: AppSettings) => SettingsPatch | null): Promise<AppSettings>
  /** Só para o main, depois de o gateway confirmar o modelo (`settings/service.ts`). */
  setTranslationModel(id: string): Promise<AppSettings>
  /** Só para o main, depois de o `claude` responder naquele caminho (`claude-cli/service.ts`); `null` volta a procurar sozinho. */
  setClaudePath(path: string | null): Promise<AppSettings>
  /** Só para o main, depois do diálogo nativo de escolher pasta (`audio-files/service.ts`); `null` volta ao padrão. */
  setAudioFolder(path: string | null): Promise<AppSettings>
  /**
   * Contrato 165, só para o main (os canais `scribe:assistant-folder-add/-remove`): a lista nova de pastas do Assistente,
   * calculada a partir da gravada agora, na mesma fila das gravações. Devolver a mesma lista não grava; fora do formato
   * lança erro e nada é gravado.
   */
  updateAssistantFolders(change: (current: readonly AssistantFolder[]) => AssistantFolder[]): Promise<AppSettings>
  /** Só para o main, depois de copiar o logo para `userData/branding/` (`branding/service.ts`); `null` volta ao símbolo da LAP. */
  setBrandLogo(name: string | null): Promise<AppSettings>
  /** Só para o main (`email/service.ts`): as contas de email, com a senha cifrada. */
  getEmailAccounts(): Promise<StoredEmailAccount[]>
  /** Só para o main: grava a lista inteira de contas; conta fora do formato lança erro e nada é gravado. */
  setEmailAccounts(accounts: readonly StoredEmailAccount[]): Promise<StoredEmailAccount[]>
  /** Contrato 54, só para o main: as assinaturas gravadas, por id de conta (conta sem assinatura fica de fora). */
  getEmailSignatures(): Promise<Record<string, EmailSignature>>
  /** Grava a assinatura de uma conta; conta inexistente devolve `false` e nada é gravado. Fora do formato lança erro. */
  setEmailSignature(accountId: string, signature: EmailSignature): Promise<boolean>
  /** Contrato 53, só para o main: as regras gravadas, por id de conta (conta sem regra fica de fora). */
  getEmailRules(): Promise<Record<string, EmailRule[]>>
  /** Grava a lista inteira (na ordem) das regras de uma conta; conta inexistente devolve `false`. Fora do formato lança erro. */
  setEmailRules(accountId: string, rules: readonly EmailRule[]): Promise<boolean>
}

export interface FileSettingsStoreOptions {
  dir: string
  /** Chamado depois de cada gravação, com o valor gravado. */
  onChange?: (settings: AppSettings) => void
  now?: () => number
}

export function createFileSettingsStore({ dir, onChange, now = Date.now }: FileSettingsStoreOptions): SettingsStore {
  const file = join(dir, SETTINGS_FILE)
  let cached: AppSettings | null = null
  let emailAccounts: StoredEmailAccount[] = []
  let emailSignatures: Record<string, EmailSignature> = {}
  let emailRules: Record<string, EmailRule[]> = {}
  let corrupt = false
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function load(): Promise<AppSettings> {
    if (cached) return cached
    emailAccounts = []
    emailSignatures = {}
    emailRules = {}
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[settings] não foi possível ler ${SETTINGS_FILE}; valem os padrões`)
      cached = { ...DEFAULT_SETTINGS }
      return cached
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      corrupt = true
      console.warn(`[settings] ${SETTINGS_FILE} corrompido; valem os padrões`)
    }
    const data = typeof parsed === 'object' && parsed !== null && 'settings' in parsed ? (parsed as { settings: unknown }).settings : undefined
    cached = parseSettings(data)
    if (typeof parsed === 'object' && parsed !== null && 'emailAccounts' in parsed) emailAccounts = parseEmailAccounts((parsed as { emailAccounts: unknown }).emailAccounts)
    if (typeof parsed === 'object' && parsed !== null && 'emailSignatures' in parsed) {
      emailSignatures = parseEmailSignatures(
        (parsed as { emailSignatures: unknown }).emailSignatures,
        emailAccounts.map((account) => account.id),
      )
    }
    if (typeof parsed === 'object' && parsed !== null && 'emailRules' in parsed) {
      emailRules = parseEmailRules(
        (parsed as { emailRules: unknown }).emailRules,
        emailAccounts.map((account) => account.id),
      )
    }
    return cached
  }

  async function write(settings: AppSettings, accounts: readonly StoredEmailAccount[] = emailAccounts, signatures: Record<string, EmailSignature> = emailSignatures, rules: Record<string, EmailRule[]> = emailRules): Promise<void> {
    if (corrupt) {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      await rename(file, `${file}.corrupt-${stamp}`).catch(() => undefined)
      corrupt = false
    }
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    const content = {
      version: SETTINGS_VERSION,
      settings,
      ...(accounts.length > 0 ? { emailAccounts: accounts } : {}),
      ...(Object.keys(signatures).length > 0 ? { emailSignatures: signatures } : {}),
      ...(Object.keys(rules).length > 0 ? { emailRules: rules } : {}),
    }
    await writeFile(temp, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  async function commit(next: AppSettings): Promise<AppSettings> {
    if (next.sourceLanguage === next.targetLanguage) throw new Error('origem e destino iguais')
    await write(next)
    cached = next
    onChange?.(next)
    return next
  }

  return {
    get: () => serial(load),
    update: (input) => serial(async () => commit(applySettingsPatch(await load(), parseSettingsPatch(input)))),
    mutate: (change) =>
      serial(async () => {
        const current = await load()
        const patch = change(current)
        return patch === null ? current : commit(applySettingsPatch(current, parseSettingsPatch(patch)))
      }),
    setTranslationModel: (id) => serial(async () => commit({ ...(await load()), translationModel: modelIdSchema.parse(id) })),
    setClaudePath: (path) => serial(async () => commit({ ...(await load()), claudePath: path === null ? null : claudePathSchema.parse(path) })),
    setAudioFolder: (path) => serial(async () => commit({ ...(await load()), audioFolder: path === null ? null : audioFolderSchema.parse(path) })),
    updateAssistantFolders: (change) =>
      serial(async () => {
        const current = await load()
        const changed = change(current.assistant.folders)
        // A mesma lista (nada mudou): nada é gravado.
        if (changed === current.assistant.folders) return current
        const folders = z.array(assistantFolderSchema).max(ASSISTANT_FOLDERS_MAX).parse(changed)
        return commit({ ...current, assistant: { ...current.assistant, folders } })
      }),
    setBrandLogo: (name) => serial(async () => commit({ ...(await load()), brandLogo: name === null ? null : brandLogoSchema.parse(name) })),
    getEmailAccounts: () =>
      serial(async () => {
        await load()
        return emailAccounts.map((account) => ({ ...account }))
      }),
    setEmailAccounts: (accounts) =>
      serial(async () => {
        const next = checkEmailAccounts(accounts)
        const settings = await load()
        const signatures = Object.fromEntries(Object.entries(emailSignatures).filter(([id]) => next.some((account) => account.id === id)))
        const rules = Object.fromEntries(Object.entries(emailRules).filter(([id]) => next.some((account) => account.id === id)))
        await write(settings, next, signatures, rules)
        emailAccounts = next
        emailSignatures = signatures
        emailRules = rules
        return next.map((account) => ({ ...account }))
      }),
    getEmailSignatures: () =>
      serial(async () => {
        await load()
        return Object.fromEntries(Object.entries(emailSignatures).map(([id, signature]) => [id, { ...signature }]))
      }),
    setEmailSignature: (accountId, signature) =>
      serial(async () => {
        const settings = await load()
        const value = emailSignatureSchema.parse(signature)
        if (!emailAccounts.some((account) => account.id === accountId)) return false
        const next = { ...emailSignatures, [accountId]: value }
        await write(settings, emailAccounts, next)
        emailSignatures = next
        return true
      }),
    getEmailRules: () =>
      serial(async () => {
        await load()
        return structuredClone(emailRules)
      }),
    setEmailRules: (accountId, rules) =>
      serial(async () => {
        const settings = await load()
        const list = emailRuleListSchema.parse(rules)
        if (!emailAccounts.some((account) => account.id === accountId)) return false
        const next = Object.fromEntries(Object.entries(emailRules).filter(([id]) => id !== accountId))
        if (list.length > 0) next[accountId] = list
        await write(settings, emailAccounts, emailSignatures, next)
        emailRules = next
        return true
      }),
  }
}
