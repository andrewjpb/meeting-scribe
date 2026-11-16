// Tradução pelo `claude` local (CA4 e CA6 a CA9). Um processo por gravação, aberto ao começar (aquece
// antes do primeiro trecho) e sempre aberto em modo `stream-json`: uma linha no stdin por trecho, a linha
// `result` do stdout volta ao trecho que a pediu. Um trecho por vez no processo; os dois lados (microfone
// e sistema) usam a mesma fila, em ordem de chegada.
//
// Limites: sem `result` em 10 s o trecho vira "Tradução indisponível" e o processo é reaberto (a fila
// segue no novo); `is_error` faz o mesmo sem reabrir. Processo que morre sozinho é reaberto uma vez depois
// de 1 s, e o trecho que estava nele vai de novo; se morrer outra vez antes de entregar uma tradução, o
// Claude CLI fica parado até o fim da gravação (nunca troca sozinho para a AssemblyAI). A cada 40 trechos
// ou acima de 20 000 tokens de contexto o processo é trocado por um novo, sem perder a fila.
//
// Fim de vida: encerrar espera a fila por até 5 s, fecha o stdin e mata o processo; `kill` (sair do app)
// mata na hora. Todo processo que sai de uso recebe `kill`, inclusive o que já morreu: nenhum fica órfão.
import { spawn } from 'node:child_process'
import type { ClaudeRunState, ClaudeTranslateRequest, ClaudeTranslateResult } from '../../shared/claude-cli'
import { CLAUDE_MODEL_PREFIX, type ClaudeModel, type LanguageCode } from '../../shared/settings-defaults'
import { claudeArgs, claudeSystemPrompt, cleanTranslation, userMessageLine } from './prompt'

export const RESULT_TIMEOUT_MS = 10_000
export const RESTART_DELAY_MS = 1_000
export const MAX_TURNS_PER_PROCESS = 40
export const MAX_CONTEXT_TOKENS = 20_000
export const DRAIN_TIMEOUT_MS = 5_000
/** Depois do `SIGTERM`, quanto se espera antes do `SIGKILL`. */
export const KILL_GRACE_MS = 2_000
/** Linha do stdout sem quebra acima disto é descartada (nenhuma resposta de um trecho chega perto). */
const MAX_LINE_CHARS = 1_000_000

export interface ChildStdin {
  write(chunk: string): boolean
  end(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface ChildReadable {
  setEncoding(encoding: 'utf8'): unknown
  on(event: 'data', listener: (chunk: string) => void): unknown
}

/** O que o tradutor usa de um `ChildProcess` (o teste entrega um processo falso). */
export interface ClaudeChild {
  readonly stdin: ChildStdin | null
  readonly stdout: ChildReadable | null
  readonly stderr: ChildReadable | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export interface SpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: ['pipe', 'pipe', 'pipe']
}

export type SpawnClaude = (file: string, args: readonly string[], options: SpawnOptions) => ClaudeChild

/** Implementação real: sem shell, então nenhum argumento é interpretado. */
export const nodeSpawnClaude: SpawnClaude = (file, args, options) => spawn(file, [...args], options)

export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ClaudeTranslatorOptions {
  binaryPath: string
  model: ClaudeModel
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  /** Pasta vazia em `userData/claude-cwd/`. */
  cwd: string
  /** Já filtrado por `claudeEnv`: nenhuma variável do app. */
  env: NodeJS.ProcessEnv
  spawn: SpawnClaude
  onState?: (state: ClaudeRunState) => void
  /** Só em desenvolvimento: custo nominal e motivo das trocas de processo. */
  log?: (message: string) => void
  timers?: Timers
  resultTimeoutMs?: number
  restartDelayMs?: number
  maxTurnsPerProcess?: number
  maxContextTokens?: number
  drainTimeoutMs?: number
}

interface Job {
  request: ClaudeTranslateRequest
  resolve: (result: ClaudeTranslateResult) => void
  timer: unknown
}

interface Running {
  child: ClaudeChild
  /** Resto de linha ainda sem `\n`. */
  pending: string
  turns: number
  exited: boolean
  /** Trocado ou encerrado por nós: a saída dele não conta como morte. */
  retired: boolean
  killTimer: unknown
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const tokens = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export class ClaudeTranslator {
  /** Processos abertos por este tradutor, na ordem (teste e diagnóstico). */
  readonly spawned: ClaudeChild[] = []

  private readonly timers: Timers
  private readonly resultTimeoutMs: number
  private readonly restartDelayMs: number
  private readonly maxTurns: number
  private readonly maxContextTokens: number
  private readonly drainTimeoutMs: number
  private readonly args: string[]
  private readonly modelId: string

  private running: Running | null = null
  private readonly queue: Job[] = []
  private current: Job | null = null
  private restartTimer: unknown = null
  /** Mortes seguidas sem nenhuma tradução entregue entre elas. */
  private deaths = 0
  private state: ClaudeRunState | null = null
  /** Encerrado (fim da gravação, saída do app ou parada definitiva): nada mais abre. */
  private closed = false
  private drainWaiters: (() => void)[] = []

  constructor(private readonly options: ClaudeTranslatorOptions) {
    this.timers = options.timers ?? defaultTimers
    this.resultTimeoutMs = options.resultTimeoutMs ?? RESULT_TIMEOUT_MS
    this.restartDelayMs = options.restartDelayMs ?? RESTART_DELAY_MS
    this.maxTurns = options.maxTurnsPerProcess ?? MAX_TURNS_PER_PROCESS
    this.maxContextTokens = options.maxContextTokens ?? MAX_CONTEXT_TOKENS
    this.drainTimeoutMs = options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS
    this.args = claudeArgs(options.model, claudeSystemPrompt(options.sourceLanguage, options.targetLanguage))
    this.modelId = `${CLAUDE_MODEL_PREFIX}${options.model}`
  }

  get runState(): ClaudeRunState | null {
    return this.state
  }

  /** Abre o processo já no início da gravação, antes do primeiro trecho. */
  start(): void {
    if (this.closed || this.running) return
    this.open()
  }

  translate(request: ClaudeTranslateRequest): Promise<ClaudeTranslateResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: this.state === 'stopped' ? 'stopped' : 'not-running' })
    return new Promise((resolve) => {
      this.queue.push({ request, resolve, timer: null })
      this.pump()
    })
  }

  /**
   * Encerrar a gravação: espera a fila esvaziar por até 5 s, então fecha o stdin e mata o processo. O que
   * sobrou na fila volta como `stopped`.
   */
  async stop(): Promise<void> {
    if (this.closed && !this.running) return
    if (this.current || this.queue.length) {
      await new Promise<void>((resolve) => {
        let timer: unknown = null
        const done = (): void => {
          if (timer !== null) this.timers.clearTimeout(timer)
          timer = null
          this.drainWaiters = this.drainWaiters.filter((waiter) => waiter !== done)
          resolve()
        }
        this.drainWaiters.push(done)
        timer = this.timers.setTimeout(done, this.drainTimeoutMs)
      })
    }
    this.shutdown(true)
  }

  /** Sair do app: mata na hora, sem esperar a fila. */
  kill(): void {
    this.shutdown(false)
  }

  private shutdown(closeStdin: boolean): void {
    this.closed = true
    if (this.restartTimer !== null) this.timers.clearTimeout(this.restartTimer)
    this.restartTimer = null
    const running = this.running
    this.running = null
    if (running) this.retire(running, closeStdin)
    this.failAll('stopped')
  }

  private open(): void {
    let child: ClaudeChild
    try {
      child = this.options.spawn(this.options.binaryPath, this.args, { cwd: this.options.cwd, env: this.options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      this.onDeath(null)
      return
    }
    this.spawned.push(child)
    const running: Running = { child, pending: '', turns: 0, exited: false, retired: false, killTimer: null }
    this.running = running
    // Escrever num processo que acabou de morrer dá EPIPE no stdin; sem ouvinte, derrubaria o main.
    child.stdin?.on('error', () => undefined)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => this.onData(running, chunk))
    child.stderr?.setEncoding('utf8')
    // O stderr precisa ser lido (pipe cheio trava o processo); só a última linha vai para o log.
    child.stderr?.on('data', (chunk) => {
      const last = chunk.trim().split('\n').pop()
      if (last) this.options.log?.(`[claude] stderr: ${last.slice(0, 300)}`)
    })
    let gone = false
    const onGone = (): void => {
      if (gone) return
      gone = true
      running.exited = true
      if (running.killTimer !== null) this.timers.clearTimeout(running.killTimer)
      running.killTimer = null
      if (!running.retired) this.onDeath(running)
    }
    child.on('exit', onGone)
    child.on('error', onGone)
    this.setState('running')
    this.pump()
  }

  /** Tira o processo de uso: fecha o stdin (se pedido) e manda `SIGTERM`; `SIGKILL` se não sair em 2 s. */
  private retire(running: Running, closeStdin: boolean): void {
    running.retired = true
    if (closeStdin) {
      try {
        running.child.stdin?.end()
      } catch {
        // stdin já fechado
      }
    }
    try {
      running.child.kill('SIGTERM')
    } catch {
      // já saiu
    }
    if (running.exited) return
    running.killTimer = this.timers.setTimeout(() => {
      running.killTimer = null
      if (running.exited) return
      try {
        running.child.kill('SIGKILL')
      } catch {
        // já saiu
      }
    }, KILL_GRACE_MS)
  }

  /** Troca planejada (tempo esgotado, 40 trechos, contexto grande): processo novo na hora, fila mantida. */
  private recycle(reason: string): void {
    const running = this.running
    this.running = null
    if (running) this.retire(running, true)
    this.options.log?.(`[claude] processo trocado: ${reason}`)
    if (!this.closed) this.open()
  }

  private onDeath(running: Running | null): void {
    if (running && this.running !== running) return
    this.running = null
    if (running) this.retire(running, false)
    // O trecho que estava no processo vai de novo, na frente da fila.
    if (this.current) {
      this.timers.clearTimeout(this.current.timer)
      this.current.timer = null
      this.queue.unshift(this.current)
      this.current = null
    }
    if (this.closed) return
    this.deaths += 1
    if (this.deaths >= 2) {
      this.options.log?.('[claude] o processo morreu de novo; tradução parada até o fim da gravação')
      this.setState('stopped')
      this.closed = true
      this.failAll('stopped')
      return
    }
    this.setState('restarting')
    this.restartTimer = this.timers.setTimeout(() => {
      this.restartTimer = null
      if (!this.closed) this.open()
    }, this.restartDelayMs)
  }

  private pump(): void {
    const running = this.running
    if (this.current || !running || this.closed) return
    const job = this.queue.shift()
    if (!job) return
    this.current = job
    job.timer = this.timers.setTimeout(() => this.onTimeout(job), this.resultTimeoutMs)
    try {
      running.child.stdin?.write(userMessageLine(job.request.text))
    } catch {
      // A morte do processo chega pelo `exit`; o trecho volta para a fila lá.
    }
  }

  private onTimeout(job: Job): void {
    if (this.current !== job) return
    job.timer = null
    this.current = null
    job.resolve({ ok: false, error: 'timeout' })
    this.recycle(`sem resposta em ${this.resultTimeoutMs} ms`)
    this.afterJob()
  }

  private onData(running: Running, chunk: string): void {
    if (this.running !== running) return
    running.pending += chunk
    let newline = running.pending.indexOf('\n')
    while (newline !== -1) {
      const line = running.pending.slice(0, newline)
      running.pending = running.pending.slice(newline + 1)
      this.onLine(running, line)
      // A linha pode ter trocado o processo; o resto deste pedaço é do processo antigo.
      if (this.running !== running) return
      newline = running.pending.indexOf('\n')
    }
    if (running.pending.length > MAX_LINE_CHARS) running.pending = ''
  }

  private onLine(running: Running, line: string): void {
    if (!line.trim()) return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(message) || message['type'] !== 'result') return
    const job = this.current
    if (!job) return
    this.timers.clearTimeout(job.timer)
    job.timer = null
    this.current = null
    running.turns += 1
    const usage = isRecord(message['usage']) ? message['usage'] : {}
    const context = tokens(usage['input_tokens']) + tokens(usage['cache_read_input_tokens']) + tokens(usage['cache_creation_input_tokens'])
    if (typeof message['total_cost_usd'] === 'number') {
      this.options.log?.(`[claude] trecho ${job.request.source}#${job.request.turnOrder}: ${context} tokens de contexto, US$ ${message['total_cost_usd'].toFixed(4)} nominais`)
    }
    const text = typeof message['result'] === 'string' ? cleanTranslation(message['result']) : ''
    if (message['is_error'] === true || !text) {
      job.resolve({ ok: false, error: 'error' })
    } else {
      // Uma tradução entregue: a próxima morte volta a ter direito a uma reabertura.
      this.deaths = 0
      job.resolve({ ok: true, translation: text, model: this.modelId })
    }
    if (running.turns >= this.maxTurns) this.recycle(`${running.turns} trechos no mesmo processo`)
    else if (context > this.maxContextTokens) this.recycle(`${context} tokens de contexto`)
    this.afterJob()
  }

  private afterJob(): void {
    this.pump()
    if (!this.current && !this.queue.length) for (const waiter of [...this.drainWaiters]) waiter()
  }

  private failAll(error: 'stopped'): void {
    const jobs = [...(this.current ? [this.current] : []), ...this.queue.splice(0)]
    this.current = null
    for (const job of jobs) {
      if (job.timer !== null) this.timers.clearTimeout(job.timer)
      job.resolve({ ok: false, error })
    }
    for (const waiter of [...this.drainWaiters]) waiter()
  }

  private setState(state: ClaudeRunState): void {
    if (this.state === state) return
    this.state = state
    this.options.onState?.(state)
  }
}
