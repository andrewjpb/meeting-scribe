// Configurações em `userData/settings.json`. Lê uma vez e guarda em memória; cada mudança é validada,
// aplicada e regravada de forma atômica (arquivo temporário + `rename`), em fila, e avisada a quem
// assinou (o main repassa a todas as janelas). Arquivo ausente ou corrompido vale como os padrões; o
// corrompido é guardado como `settings.json.corrupt-<timestamp>` na primeira gravação seguinte.
// Contrato 42: as contas de email vão no mesmo arquivo, em `emailAccounts` (fora de `settings`, sem aviso às janelas),
// e só aparecem no arquivo quando há alguma. Contrato 54: as assinaturas também, em `emailSignatures` (por id de conta);
// gravar a lista de contas tira a assinatura de quem saiu.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applySettingsPatch, DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings-defaults'
import type { EmailSignature } from '../../shared/email-signature'
import { audioFolderSchema, brandLogoSchema, checkEmailAccounts, claudePathSchema, emailSignatureSchema, modelIdSchema, parseEmailAccounts, parseEmailSignatures, parseSettings, parseSettingsPatch, SETTINGS_VERSION, type StoredEmailAccount } from './schema'

export const SETTINGS_FILE = 'settings.json'

/** Interface que a interface do app usa; o servidor troca esta implementação depois. */
export interface SettingsStore {
  get(): Promise<AppSettings>
  /** Valida e aplica a mudança vinda do renderer; devolve o que foi gravado. Mudança inválida lança erro. */
  update(patch: unknown): Promise<AppSettings>
  /** Só para o main, depois de o gateway confirmar o modelo (`settings/service.ts`). */
  setTranslationModel(id: string): Promise<AppSettings>
  /** Só para o main, depois de o `claude` responder naquele caminho (`claude-cli/service.ts`); `null` volta a procurar sozinho. */
  setClaudePath(path: string | null): Promise<AppSettings>
  /** Só para o main, depois do diálogo nativo de escolher pasta (`audio-files/service.ts`); `null` volta ao padrão. */
  setAudioFolder(path: string | null): Promise<AppSettings>
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
    return cached
  }

  async function write(settings: AppSettings, accounts: readonly StoredEmailAccount[] = emailAccounts, signatures: Record<string, EmailSignature> = emailSignatures): Promise<void> {
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
    setTranslationModel: (id) => serial(async () => commit({ ...(await load()), translationModel: modelIdSchema.parse(id) })),
    setClaudePath: (path) => serial(async () => commit({ ...(await load()), claudePath: path === null ? null : claudePathSchema.parse(path) })),
    setAudioFolder: (path) => serial(async () => commit({ ...(await load()), audioFolder: path === null ? null : audioFolderSchema.parse(path) })),
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
        await write(settings, next, signatures)
        emailAccounts = next
        emailSignatures = signatures
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
  }
}
