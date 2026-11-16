// Configurações em `userData/settings.json`. Lê uma vez e guarda em memória; cada mudança é validada,
// aplicada e regravada de forma atômica (arquivo temporário + `rename`), em fila, e avisada a quem
// assinou (o main repassa a todas as janelas). Arquivo ausente ou corrompido vale como os padrões; o
// corrompido é guardado como `settings.json.corrupt-<timestamp>` na primeira gravação seguinte.
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applySettingsPatch, DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings-defaults'
import { audioFolderSchema, brandLogoSchema, claudePathSchema, modelIdSchema, parseSettings, parseSettingsPatch, SETTINGS_VERSION } from './schema'

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
  let corrupt = false
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function load(): Promise<AppSettings> {
    if (cached) return cached
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
    return cached
  }

  async function write(settings: AppSettings): Promise<void> {
    if (corrupt) {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      await rename(file, `${file}.corrupt-${stamp}`).catch(() => undefined)
      corrupt = false
    }
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify({ version: SETTINGS_VERSION, settings }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
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
  }
}
