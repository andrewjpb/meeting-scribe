// O que os canais do Claude CLI pedem ao main, sem Electron: localizar, escolher o caminho, abrir o
// processo da gravação, traduzir um trecho e encerrar. Um tradutor por vez (uma gravação por vez); abrir
// outro mata o anterior. Pedidos do renderer são validados aqui antes de qualquer processo.
//
// Contrato 17: com a "Conexão com o Claude" no agente (padrão), a gravação traduz por uma sessão ACP
// (`acp/translator.ts`), com as mesmas regras e os mesmos canais; com "Linha de comando", nada muda.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ClaudeLocateResult, ClaudeRunState, ClaudeStartResult, ClaudeTranslateResult } from '../../shared/claude-cli'
import type { AppSettings } from '../../shared/settings-defaults'
import { TRANSLATE_TEXT_MAX } from '../assemblyai/translation'
import { claudePathSchema } from '../settings/schema'
import type { SettingsStore } from '../settings/store'
import type { AcpOpenResult, AcpSessionRequest } from '../acp/agent'
import { AcpTranslator } from '../acp/translator'
import { claudeEnv, locateClaude, type ExecFile } from './locate'
import { ClaudeTranslator, type SpawnClaude, type Timers } from './translator'

/** Pasta vazia onde o `claude` roda: nada do projeto nem do usuário fica ao alcance dele. */
export const CLAUDE_CWD_DIR = 'claude-cwd'
/** Pastas vazias próprias da tradução e do resumo pelo ACP, dentro de `claude-cwd` (contrato 17). */
export const ACP_TRANSLATE_DIR = 'translate'
export const ACP_SUMMARY_DIR = 'summary'
/** Pasta vazia da análise pelo ACP (contrato 19). */
export const ACP_ANALYSIS_DIR = 'analysis'
/** Pasta vazia do ACP da IA anotando ao vivo (contrato 30). */
export const ACP_AI_NOTES_DIR = 'ai-notes'

/** O que a gravação usa de um tradutor, pela linha de comando ou pelo ACP. */
type Translator = Pick<ClaudeTranslator, 'start' | 'translate' | 'stop' | 'kill'>

const translateSchema = z
  .object({
    segmentId: z.string().min(1).max(200),
    source: z.enum(['mic', 'system']),
    turnOrder: z.number().int().min(0),
    text: z
      .string()
      .max(TRANSLATE_TEXT_MAX)
      .refine((value) => value.trim() !== ''),
  })
  .strict()

export interface ClaudeServiceDeps {
  settings: Pick<SettingsStore, 'get' | 'setClaudePath'>
  userData: string
  home: string
  baseEnv: NodeJS.ProcessEnv
  exec: ExecFile
  spawn: SpawnClaude
  /** Fábrica de sessões do ACP para o `claude` encontrado (contrato 17). Sem ela, sempre a linha de comando. */
  openAcp?: (claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult>
  /** O agente está instalado? Sem ele, a gravação traduz pela linha de comando (e a tela avisa). */
  acpAvailable?: () => boolean | Promise<boolean>
  /** Smoke: lista fixa trocada pelo binário falso e sem shell de login. */
  candidates?: readonly string[]
  loginShell?: boolean
  onState?: (state: ClaudeRunState) => void
  log?: (message: string) => void
  timers?: Timers
}

export interface ClaudeService {
  locate(): Promise<ClaudeLocateResult>
  /** Caminho escolhido em Configurações: só grava se `claude --version` responder ali. `null` volta a procurar sozinho. */
  setPath(input: unknown): Promise<{ result: ClaudeLocateResult; settings: AppSettings }>
  start(): Promise<ClaudeStartResult>
  translate(request: unknown): Promise<ClaudeTranslateResult>
  stop(): Promise<void>
  /** Sair do app: mata o processo que estiver vivo. */
  dispose(): void
}

export function createClaudeService(deps: ClaudeServiceDeps): ClaudeService {
  let translator: Translator | null = null
  /** Abertura em andamento: um trecho que chega antes de o processo abrir espera por ela. */
  let starting: Promise<unknown> | null = null

  const locateWith = (configuredPath: string | null, only?: string): Promise<ClaudeLocateResult> =>
    locateClaude({
      configuredPath,
      home: deps.home,
      exec: deps.exec,
      baseEnv: deps.baseEnv,
      ...(only !== undefined ? { candidates: [only], loginShell: false } : {}),
      ...(only === undefined && deps.candidates ? { candidates: deps.candidates } : {}),
      ...(only === undefined && deps.loginShell !== undefined ? { loginShell: deps.loginShell } : {}),
    })

  const locate = async (): Promise<ClaudeLocateResult> => locateWith((await deps.settings.get()).claudePath)

  return {
    locate,

    async setPath(input) {
      if (input === null) {
        const settings = await deps.settings.setClaudePath(null)
        return { result: await locate(), settings }
      }
      const path = claudePathSchema.parse(input)
      const result = await locateWith(null, path)
      if (!result.ok) return { result, settings: await deps.settings.get() }
      return { result, settings: await deps.settings.setClaudePath(path) }
    },

    start() {
      const run = startTranslator()
      starting = run
      const clear = (): void => {
        if (starting === run) starting = null
      }
      void run.then(clear, clear)
      return run
    },

    async translate(request) {
      const parsed = translateSchema.safeParse(request)
      if (!parsed.success) throw new Error('pedido de tradução inválido')
      if (starting) await starting.catch(() => undefined)
      if (!translator) return { ok: false, error: 'not-running' }
      return translator.translate(parsed.data)
    },

    async stop() {
      if (starting) await starting.catch(() => undefined)
      const current = translator
      translator = null
      await current?.stop()
    },

    dispose() {
      translator?.kill()
      translator = null
    },
  }

  async function startTranslator(): Promise<ClaudeStartResult> {
    // O tradutor de uma gravação anterior (janela recarregada sem `claude-stop`) morre aqui, antes de
    // qualquer saída antecipada: senão ficaria parado até o app fechar.
    translator?.kill()
    translator = null
    const settings = await deps.settings.get()
    if (!settings.translationEnabled || settings.translationEngine !== 'claude-cli') return { ok: false, error: 'disabled' }
    const found = await locateWith(settings.claudePath)
    if (!found.ok) return found
    if (settings.claudeTransport === 'acp' && deps.openAcp && ((await deps.acpAvailable?.()) ?? true)) {
      const cwd = join(deps.userData, CLAUDE_CWD_DIR, ACP_TRANSLATE_DIR)
      await mkdir(cwd, { recursive: true, mode: 0o700 })
      const acpTranslator = new AcpTranslator({
        open: deps.openAcp(found.path),
        model: settings.claudeModel,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        cwd,
        ...(deps.onState ? { onState: deps.onState } : {}),
        ...(deps.log ? { log: deps.log } : {}),
        ...(deps.timers ? { timers: deps.timers } : {}),
      })
      translator = acpTranslator
      acpTranslator.start()
      return { ok: true, version: found.version }
    }
    const cwd = join(deps.userData, CLAUDE_CWD_DIR)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const cliTranslator = new ClaudeTranslator({
      binaryPath: found.path,
      model: settings.claudeModel,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      cwd,
      env: claudeEnv(deps.baseEnv, found.path),
      spawn: deps.spawn,
      ...(deps.onState ? { onState: deps.onState } : {}),
      ...(deps.log ? { log: deps.log } : {}),
      ...(deps.timers ? { timers: deps.timers } : {}),
    })
    translator = cliTranslator
    cliTranslator.start()
    return { ok: true, version: found.version }
  }
}
