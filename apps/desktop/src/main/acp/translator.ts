// Tradução ao vivo pelo ACP (contrato 17, CA4b), com as regras do tradutor da linha de comando (contrato
// 05): uma sessão ACP por gravação, aberta ao começar (aquece antes do primeiro trecho), numa pasta vazia
// própria, sem ferramenta nenhuma, com o modelo das Configurações e a mesma instrução. Cada trecho final é um
// `session/prompt` com o texto escapado dentro de `<turn>`; a resposta é o `agent_message_chunk` juntado até
// o fim do prompt, limpa por `cleanTranslation`. Um trecho por vez; os dois lados usam a mesma fila.
//
// Limites: 10 s desde a chegada do trecho (também enquanto a sessão abre) sem o fim do prompt -> "Tradução
// indisponível"; se o trecho já estava na sessão, ela é trocada por uma nova (a fila segue nela). Erro do
// agente dá "indisponível" sem trocar de sessão. Processo que morre reabre uma vez depois de 1 s e o trecho que
// estava nele vai de novo; se morrer outra vez antes de entregar uma tradução, a tradução fica parada até o
// fim da gravação. A cada 40 trechos, ou quando o `usage_update` passa de 20 000 tokens em contexto, a sessão
// é trocada por uma nova, sem perder a fila; a próxima já abre antes (no 39º trecho, ou acima de 80% do
// contexto), para a troca não atrasar o trecho seguinte. Encerrar espera a fila por até 5 s; sair do app mata na hora.
import type { ClaudeRunState, ClaudeTranslateRequest, ClaudeTranslateResult } from '../../shared/claude-cli'
import { CLAUDE_MODEL_PREFIX, type ClaudeModel, type LanguageCode } from '../../shared/settings-defaults'
import { claudeSystemPrompt, cleanTranslation, turnContent } from '../claude-cli/prompt'
import { DRAIN_TIMEOUT_MS, MAX_CONTEXT_TOKENS, MAX_TURNS_PER_PROCESS, RESTART_DELAY_MS, RESULT_TIMEOUT_MS, type Timers } from '../claude-cli/translator'
import { contentText, type AcpOpenResult, type AcpSession, type AcpSessionRequest } from './agent'

export interface AcpTranslatorOptions {
  open: (request: AcpSessionRequest) => Promise<AcpOpenResult>
  model: ClaudeModel
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  /** Pasta vazia em `userData/claude-cwd/translate`. */
  cwd: string
  onState?: (state: ClaudeRunState) => void
  /** Só em desenvolvimento: motivo das trocas de sessão e tokens, nunca o texto. */
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
  session: AcpSession
  turns: number
  /** Tokens em contexto, do último `usage_update`. */
  used: number
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class AcpTranslator {
  /** Sessões abertas por este tradutor, na ordem (teste e diagnóstico). */
  readonly sessions: AcpSession[] = []

  private readonly timers: Timers
  private readonly resultTimeoutMs: number
  private readonly restartDelayMs: number
  private readonly maxTurns: number
  private readonly maxContextTokens: number
  private readonly drainTimeoutMs: number
  private readonly modelId: string
  private readonly systemPrompt: string

  private running: Running | null = null
  /** Abertura em curso: os trechos esperam na fila. */
  private opening = false
  /** Sessão da próxima rodada, já aberta (pré-aquecida) ou abrindo. */
  private standby: Running | null = null
  private standbyOpening = false
  /** A última abertura falhou porque o adaptador não subiu: o aviso diz que o problema é o agente. */
  private agentDown = false
  private readonly queue: Job[] = []
  private current: Job | null = null
  private restartTimer: unknown = null
  /** Mortes seguidas sem nenhuma tradução entregue entre elas. */
  private deaths = 0
  private state: ClaudeRunState | null = null
  private closed = false
  private drainWaiters: (() => void)[] = []

  constructor(private readonly options: AcpTranslatorOptions) {
    this.timers = options.timers ?? defaultTimers
    this.resultTimeoutMs = options.resultTimeoutMs ?? RESULT_TIMEOUT_MS
    this.restartDelayMs = options.restartDelayMs ?? RESTART_DELAY_MS
    this.maxTurns = options.maxTurnsPerProcess ?? MAX_TURNS_PER_PROCESS
    this.maxContextTokens = options.maxContextTokens ?? MAX_CONTEXT_TOKENS
    this.drainTimeoutMs = options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS
    // O mesmo valor gravado na reunião que a linha de comando grava (contrato 05, CA14).
    this.modelId = `${CLAUDE_MODEL_PREFIX}${options.model}`
    this.systemPrompt = claudeSystemPrompt(options.sourceLanguage, options.targetLanguage)
  }

  get runState(): ClaudeRunState | null {
    return this.state
  }

  /** Abre a sessão já no início da gravação, antes do primeiro trecho. */
  start(): void {
    if (this.closed || this.running || this.opening) return
    this.open()
  }

  translate(request: ClaudeTranslateRequest): Promise<ClaudeTranslateResult> {
    if (this.closed) return Promise.resolve({ ok: false, error: this.state === 'stopped' ? 'stopped' : 'not-running' })
    return new Promise((resolve) => {
      const job: Job = { request, resolve, timer: null }
      // Os 10 s contam desde a chegada, também na fila e enquanto a sessão abre.
      job.timer = this.timers.setTimeout(() => this.onTimeout(job), this.resultTimeoutMs)
      this.queue.push(job)
      this.pump()
    })
  }

  /** Encerrar a gravação: espera a fila esvaziar por até 5 s e fecha a sessão; o que sobrou volta `stopped`. */
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
    this.shutdown()
  }

  /** Sair do app: mata na hora, sem esperar a fila. */
  kill(): void {
    this.shutdown()
  }

  private shutdown(): void {
    this.closed = true
    if (this.restartTimer !== null) this.timers.clearTimeout(this.restartTimer)
    this.restartTimer = null
    const running = this.running
    this.running = null
    running?.session.close()
    this.standby?.session.close()
    this.standby = null
    this.failAll()
  }

  private open(): void {
    this.opening = true
    this.setState(this.deaths ? 'restarting' : 'running')
    void this.options
      .open({ purpose: 'translate', cwd: this.options.cwd, model: this.options.model, systemPrompt: this.systemPrompt, tools: 'none' })
      .then((opened) => {
        this.opening = false
        if (!opened.ok) {
          this.options.log?.(`[acp] tradução: a sessão não abriu (${opened.reason.slice(0, 200)})`)
          this.agentDown = opened.error === 'agent' || opened.error === 'missing'
          this.onDeath(null)
          return
        }
        if (this.closed) {
          opened.session.close()
          return
        }
        this.agentDown = false
        const running: Running = { session: opened.session, turns: 0, used: 0 }
        this.running = running
        this.sessions.push(opened.session)
        opened.session.onExit(() => this.onDeath(running))
        this.setState('running')
        this.pump()
      })
  }

  /** Abre a sessão da próxima rodada antes de ela ser necessária. */
  private prewarm(): void {
    if (this.closed || this.standby || this.standbyOpening) return
    this.standbyOpening = true
    void this.options
      .open({ purpose: 'translate', cwd: this.options.cwd, model: this.options.model, systemPrompt: this.systemPrompt, tools: 'none' })
      .then((opened) => {
        this.standbyOpening = false
        if (!opened.ok) {
          this.options.log?.(`[acp] tradução: a sessão seguinte não abriu (${opened.reason.slice(0, 200)})`)
          // Quem esperava por ela abre do jeito normal.
          if (!this.closed && !this.running && !this.opening) this.open()
          return
        }
        if (this.closed) {
          opened.session.close()
          return
        }
        const standby: Running = { session: opened.session, turns: 0, used: 0 }
        this.standby = standby
        this.sessions.push(opened.session)
        opened.session.onExit(() => {
          if (this.standby === standby) this.standby = null
        })
        if (!this.running && !this.opening) this.promote()
      })
  }

  /** A sessão pré-aquecida passa a ser a da gravação. */
  private promote(): void {
    const running = this.standby
    if (!running) return
    this.standby = null
    this.running = running
    running.session.onExit(() => this.onDeath(running))
    this.setState('running')
    this.pump()
  }

  /**
   * Troca planejada (tempo esgotado, 40 trechos, contexto alto): a sessão pré-aquecida, se houver; senão uma
   * nova na hora. A fila é mantida.
   */
  private recycle(reason: string): void {
    const running = this.running
    this.running = null
    running?.session.close()
    this.options.log?.(`[acp] sessão de tradução trocada: ${reason}`)
    if (this.closed) return
    if (this.standby) this.promote()
    else if (!this.standbyOpening && !this.opening) this.open()
  }

  private onDeath(running: Running | null): void {
    if (running && this.running !== running) return
    this.running = null
    // O trecho que estava na sessão vai de novo, na frente da fila (o prazo dele continua contando).
    if (this.current) {
      this.queue.unshift(this.current)
      this.current = null
    }
    if (this.closed) return
    this.deaths += 1
    if (this.deaths >= 2) {
      this.options.log?.('[acp] o agente parou de novo; tradução parada até o fim da gravação')
      this.setState(this.agentDown ? 'agent-failed' : 'stopped')
      this.closed = true
      this.failAll()
      return
    }
    this.setState('restarting')
    this.restartTimer = this.timers.setTimeout(() => {
      this.restartTimer = null
      if (this.closed || this.running || this.opening) return
      if (this.standby) this.promote()
      else if (!this.standbyOpening) this.open()
    }, this.restartDelayMs)
  }

  private pump(): void {
    const running = this.running
    if (this.current || !running || this.closed) return
    const job = this.queue.shift()
    if (!job) return
    this.current = job
    let text = ''
    void running.session
      .prompt(turnContent(job.request.text), {
        onUpdate: (update) => {
          if (update.sessionUpdate === 'agent_message_chunk') text += contentText(update.content)
          else if (update.sessionUpdate === 'usage_update') running.used = running.session.profile.usage(update).used ?? running.used
        },
      })
      .then((outcome) => {
        // Trecho que já estourou o tempo, ou que voltou para a fila quando o processo morreu.
        if (this.current !== job) return
        if (!outcome.ok && outcome.error === 'exited') return
        this.timers.clearTimeout(job.timer)
        job.timer = null
        this.current = null
        running.turns += 1
        const translation = outcome.ok && outcome.stopReason === 'end_turn' ? cleanTranslation(text) : ''
        if (!translation) {
          job.resolve({ ok: false, error: 'error' })
        } else {
          // Uma tradução entregue: a próxima morte volta a ter direito a uma reabertura.
          this.deaths = 0
          job.resolve({ ok: true, translation, model: this.modelId })
        }
        this.options.log?.(`[acp] trecho ${job.request.source}#${job.request.turnOrder}: ${running.used} tokens em contexto`)
        if (this.running === running) {
          if (running.turns >= this.maxTurns) this.recycle(`${running.turns} trechos na mesma sessão`)
          else if (running.used > this.maxContextTokens) this.recycle(`${running.used} tokens em contexto`)
          // A próxima rodada abre antes: no penúltimo trecho ou acima de 80% do contexto.
          else if (running.turns >= this.maxTurns - 1 || running.used > this.maxContextTokens * 0.8) this.prewarm()
        }
        this.afterJob()
      })
  }

  private onTimeout(job: Job): void {
    job.timer = null
    if (this.current === job) {
      this.current = null
      job.resolve({ ok: false, error: 'timeout' })
      this.running?.session.cancel()
      this.recycle(`sem resposta em ${this.resultTimeoutMs} ms`)
      this.afterJob()
      return
    }
    // Ainda na fila (a sessão abrindo ou outro trecho na frente): sai sem tradução.
    const at = this.queue.indexOf(job)
    if (at === -1) return
    this.queue.splice(at, 1)
    job.resolve({ ok: false, error: 'timeout' })
    this.afterJob()
  }

  private afterJob(): void {
    this.pump()
    if (!this.current && !this.queue.length) for (const waiter of [...this.drainWaiters]) waiter()
  }

  private failAll(): void {
    const jobs = [...(this.current ? [this.current] : []), ...this.queue.splice(0)]
    this.current = null
    for (const job of jobs) {
      if (job.timer !== null) this.timers.clearTimeout(job.timer)
      job.resolve({ ok: false, error: 'stopped' })
    }
    for (const waiter of [...this.drainWaiters]) waiter()
  }

  private setState(state: ClaudeRunState): void {
    if (this.state === state) return
    this.state = state
    this.options.onState?.(state)
  }
}
