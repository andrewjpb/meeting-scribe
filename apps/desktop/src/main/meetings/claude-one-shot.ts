// Uma execução curta do Claude pelo transporte das Configurações (contrato 17): pelo agente do ACP, se a
// "Conexão com o Claude" estiver nele e ele estiver instalado, numa pasta vazia própria; senão pela linha de
// comando, na pasta vazia de sempre. O resumo (contrato 08) e a análise (contrato 19) passam por aqui, com
// a instrução e a leitura de cada um.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaudeModel } from '../../shared/settings-defaults'
import type { AcpOpenResult, AcpSessionRequest } from '../acp/agent'
import { runAcpOneShot } from '../acp/summary'
import { claudeEnv } from '../claude-cli/locate'
import { CLAUDE_CWD_DIR } from '../claude-cli/service'
import { runOneShot, type OneShotParse, type OneShotResult, type SpawnSummary } from '../claude-cli/summary'
import type { Timers } from '../claude-cli/translator'
import type { SettingsStore } from '../settings/store'

export interface OneShotEngine {
  settings: Pick<SettingsStore, 'get'>
  spawn: SpawnSummary
  /** Fábrica de sessões do ACP para o `claude` encontrado. Sem ela, sempre a linha de comando. */
  openAcp?: ((claudePath: string) => (request: AcpSessionRequest) => Promise<AcpOpenResult>) | undefined
  /** O agente está instalado? Sem ele, a linha de comando. */
  acpAvailable?: (() => boolean | Promise<boolean>) | undefined
  userData: string
  baseEnv: NodeJS.ProcessEnv
  log?: ((message: string) => void) | undefined
  timers?: Timers | undefined
}

export interface OneShotRequest<T> {
  claudePath: string
  purpose: 'summary' | 'analysis'
  /** Pasta vazia do ACP dentro de `claude-cwd`. */
  acpDir: string
  systemPrompt: string
  parse: OneShotParse<T>
  input: string
  label: string
  timeoutMs?: number | undefined
  signal: AbortSignal
}

/** Roda e devolve o resultado e o modelo usado (o das Configurações naquele momento). Nunca rejeita por falha do Claude. */
export async function runClaudeOneShot<T>(engine: OneShotEngine, request: OneShotRequest<T>): Promise<{ result: OneShotResult<T>; model: ClaudeModel }> {
  const { claudeModel, claudeTransport } = await engine.settings.get()
  const common = {
    model: claudeModel,
    input: request.input,
    ...(engine.timers ? { timers: engine.timers } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(engine.log ? { log: engine.log } : {}),
    signal: request.signal,
  }
  if (claudeTransport === 'acp' && engine.openAcp && ((await engine.acpAvailable?.()) ?? true)) {
    const cwd = join(engine.userData, CLAUDE_CWD_DIR, request.acpDir)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const result = await runAcpOneShot({ ...common, open: engine.openAcp(request.claudePath), cwd, purpose: request.purpose, systemPrompt: request.systemPrompt, parse: request.parse, label: request.label })
    return { result, model: claudeModel }
  }
  const cwd = join(engine.userData, CLAUDE_CWD_DIR)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  const result = await runOneShot({
    ...common,
    binaryPath: request.claudePath,
    cwd,
    env: claudeEnv(engine.baseEnv, request.claudePath),
    spawn: engine.spawn,
    systemPrompt: request.systemPrompt,
    parse: request.parse,
    label: request.label,
  })
  return { result, model: claudeModel }
}
