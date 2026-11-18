// Envio dos quadros de áudio para a AssemblyAI (CA3, CA7 e CA8). Um socket por fonte, aberto só depois
// de a captura começar e só com token temporário. O `FrameSink` recebe quadros de 8 + 3200 bytes; aqui
// só os 3200 bytes de PCM vão no binário, como a API exige.
//
// Ciclo de vida: ao abrir, o socket guarda até 50 quadros (5 s) e descarta os mais antigos contando a
// lacuna; pausar envia `Terminate`, espera o `Termination` por até 2 s (o turno final ainda chega) e
// fecha; retomar abre sessão nova com token e deslocamento novos. Queda inesperada reconecta em 1, 2,
// 4 e 8 s (4 tentativas), cada uma com token novo; falha ao pedir o token também conta como tentativa,
// e só chave ausente ou recusada para na hora. Esgotadas, a fonte vira `failed` e a outra segue. Aos
// 170 min a sessão é trocada de forma planejada (a API fecha em 3 h). Cada conexão pedida leva uma
// geração: token que chega depois de pausa, retomada ou fim é descartado, sem abrir socket órfão.
// Fonte desligada de propósito ("Ouvir só os participantes", contrato 29): a sessão dela encerra como na pausa,
// sem reconexão nem aviso, e fica `paused` até ser religada; a retomada global não a reabre.
// Tudo com sockets, relógio e timers injetados, para o teste não abrir rede.
import type { AudioFrame, AudioSource, FrameSink } from '../audio/frames'
import type { TranscriptSource, TranscriptionTokenResult } from '../../../shared/transcription'
import type { StreamEnvelope } from './reducer'

export const MAX_BUFFERED_FRAMES = 50
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const
export const TERMINATION_TIMEOUT_MS = 3_000
/**
 * Só uma conexão que ficou de pé este tempo zera as tentativas. Abrir e cair logo em seguida (modelo
 * recusado, saldo zerado, parâmetro inválido) conta como tentativa, senão reconectaria para sempre.
 */
export const STABLE_CONNECTION_MS = 30_000
/** Pausa: espera do `Termination` antes de fechar (CA7). */
export const PAUSE_TERMINATION_TIMEOUT_MS = 2_000
/** 3 h por sessão na AssemblyAI; 10 min de folga para a troca terminar antes do limite. */
export const SESSION_ROTATE_MS = 170 * 60_000

const SOCKET_OPEN = 1

export interface StreamingSocket {
  readonly readyState: number
  send(data: string | ArrayBuffer | ArrayBufferView): void
  close(code?: number, reason?: string): void
  onopen: ((event?: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event?: unknown) => void) | null
  onerror: ((event?: unknown) => void) | null
}

export type OpenSocket = (url: string) => StreamingSocket

export type SourceError = 'no-key' | 'key-rejected' | 'network' | 'server' | 'format' | null
export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'stopped' | 'failed' | 'no-key'

export interface SourceStatus {
  status: ConnectionStatus
  /** Tentativas de reconexão já feitas (0 a 4). */
  attempts: number
  /** Espera antes da próxima tentativa, quando `reconnecting`. */
  nextRetryMs: number | null
  error: SourceError
}

export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SinkOptions {
  openSocket: OpenSocket
  /** Pede o token ao main (`scribe:transcription-token`); nunca devolve a chave. */
  getToken: () => Promise<TranscriptionTokenResult>
  urlFor: (token: string, source: TranscriptSource) => string
  onMessage: (envelope: StreamEnvelope) => void
  /** Tempo decorrido da gravação (sem as pausas), para o deslocamento de cada sessão. */
  elapsedMs: () => number
  onStatus?: (source: TranscriptSource, status: SourceStatus) => void
  timers?: Timers
  maxBufferedFrames?: number
  reconnectDelaysMs?: readonly number[]
  terminationTimeoutMs?: number
  pauseTerminationTimeoutMs?: number
  rotateAfterMs?: number
  newSessionId?: () => string
}

interface BufferedFrame {
  pcm: Uint8Array
  /** Tempo da gravação em que o quadro chegou. */
  at: number
}

interface SourceRuntime {
  source: TranscriptSource
  status: SourceStatus
  /** Socket da sessão em curso. Os que estão encerrando ficam em `draining`. */
  socket: StreamingSocket | null
  buffer: BufferedFrame[]
  retryTimer: unknown
  rotateTimer: unknown
  /** Muda a cada conexão pedida, pausa, retomada e fim: resultado de token antigo é descartado. */
  generation: number
  /** Sockets que receberam `Terminate` e esperam o `Termination` para fechar (pausa, fim, troca). */
  draining: Map<StreamingSocket, Promise<void>>
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

let sessionCounter = 0
const defaultSessionId = (): string => `s${(sessionCounter += 1).toString(36)}${Date.now().toString(36).slice(-4)}`

export class AssemblyAiSink implements FrameSink {
  readonly counts: Record<AudioSource, number> = { mic: 0, system: 0 }
  /** Quadros descartados por o buffer encher: a lacuna que a transcrição perde. */
  readonly gaps: Record<AudioSource, number> = { mic: 0, system: 0 }

  private readonly runtimes = new Map<TranscriptSource, SourceRuntime>()
  /** Fontes desligadas de propósito (contrato 29). */
  private readonly disabled = new Set<TranscriptSource>()
  /** Pausa global em curso: religar uma fonte espera a retomada. */
  private paused = false
  private readonly terminateWaiters = new Map<StreamingSocket, ((reached: boolean) => void)[]>()
  private readonly timers: Timers
  private readonly maxBuffered: number
  private readonly reconnectDelays: readonly number[]
  private readonly terminationTimeoutMs: number
  private readonly pauseTerminationTimeoutMs: number
  private readonly rotateAfterMs: number
  private readonly newSessionId: () => string

  constructor(private readonly options: SinkOptions) {
    this.timers = options.timers ?? defaultTimers
    this.maxBuffered = options.maxBufferedFrames ?? MAX_BUFFERED_FRAMES
    this.reconnectDelays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS
    this.terminationTimeoutMs = options.terminationTimeoutMs ?? TERMINATION_TIMEOUT_MS
    this.pauseTerminationTimeoutMs = options.pauseTerminationTimeoutMs ?? PAUSE_TERMINATION_TIMEOUT_MS
    this.rotateAfterMs = options.rotateAfterMs ?? SESSION_ROTATE_MS
    this.newSessionId = options.newSessionId ?? defaultSessionId
  }

  statusOf(source: TranscriptSource): SourceStatus | null {
    return this.runtimes.get(source)?.status ?? null
  }

  /** Abre uma sessão por fonte ativa. Chamar uma vez, quando a captura começa. */
  start(sources: readonly TranscriptSource[]): void {
    for (const source of sources) {
      if (this.runtimes.has(source)) continue
      const runtime: SourceRuntime = {
        source,
        status: { status: 'idle', attempts: 0, nextRetryMs: null, error: null },
        socket: null,
        buffer: [],
        retryTimer: null,
        rotateTimer: null,
        generation: 0,
        draining: new Map(),
      }
      this.runtimes.set(source, runtime)
      // Desligada antes de a captura começar: nasce parada, sem sessão aberta.
      if (this.disabled.has(source)) {
        runtime.status = { status: 'paused', attempts: 0, nextRetryMs: null, error: null }
        this.emit(runtime)
        continue
      }
      runtime.status = { status: 'connecting', attempts: 0, nextRetryMs: null, error: null }
      this.emit(runtime)
      this.connect(runtime)
    }
  }

  /**
   * "Ouvir só os participantes" (contrato 29): desligada, a sessão da fonte recebe `Terminate` e fecha como na
   * pausa (o turno final ainda chega), sem reconexão e sem `failed`; religada, abre sessão nova como o "Tentar de
   * novo" (pausada, só na retomada). A outra fonte não é tocada.
   */
  setSourceEnabled(source: TranscriptSource, enabled: boolean): void {
    const runtime = this.runtimes.get(source)
    if (enabled) {
      if (!this.disabled.delete(source)) return
      if (!runtime || this.paused || runtime.status.status !== 'paused') return
      runtime.status = { status: 'connecting', attempts: 0, nextRetryMs: null, error: null }
      this.emit(runtime)
      this.connect(runtime)
      return
    }
    if (this.disabled.has(source)) return
    this.disabled.add(source)
    if (!runtime || this.halted(runtime)) return
    runtime.generation += 1
    this.clearTimers(runtime)
    const socket = runtime.socket
    runtime.socket = null
    if (socket) void this.drain(runtime, socket, this.pauseTerminationTimeoutMs)
    runtime.buffer = []
    runtime.status = { status: 'paused', attempts: 0, nextRetryMs: null, error: null }
    this.emit(runtime)
  }

  write(frame: AudioFrame): void {
    const runtime = this.runtimes.get(frame.source)
    if (!runtime) return
    this.counts[frame.source] = (this.counts[frame.source] ?? 0) + 1
    const { status } = runtime.status
    if (status === 'paused' || status === 'stopped' || status === 'failed' || status === 'no-key' || status === 'idle') return
    if (runtime.socket && runtime.socket.readyState === SOCKET_OPEN) {
      this.send(runtime.socket, frame.pcm)
      return
    }
    // Socket ainda abrindo (ou trocando): até 5 s de áudio esperam; o resto vira lacuna contada.
    runtime.buffer.push({ pcm: frame.pcm, at: this.options.elapsedMs() })
    if (runtime.buffer.length > this.maxBuffered) {
      runtime.buffer.shift()
      this.gaps[frame.source] = (this.gaps[frame.source] ?? 0) + 1
    }
  }

  /**
   * Pausa: o áudio seguinte é descartado até retomar. Cada socket recebe `Terminate` e fecha quando o
   * `Termination` chega ou em 2 s; até lá o turno final ainda é entregue, com a sessão dele.
   */
  pause(): void {
    this.paused = true
    for (const runtime of this.runtimes.values()) {
      if (this.halted(runtime)) continue
      runtime.generation += 1
      this.clearTimers(runtime)
      const socket = runtime.socket
      runtime.socket = null
      if (socket) void this.drain(runtime, socket, this.pauseTerminationTimeoutMs)
      runtime.buffer = []
      runtime.status = { status: 'paused', attempts: 0, nextRetryMs: null, error: null }
      this.emit(runtime)
    }
  }

  /** Retomar: sessão nova, token novo e deslocamento novo (só o tempo gravado conta). */
  resume(): void {
    this.paused = false
    for (const runtime of this.runtimes.values()) {
      // Fonte desligada de propósito (contrato 29) continua parada.
      if (runtime.status.status !== 'paused' || this.disabled.has(runtime.source)) continue
      runtime.status = { status: 'connecting', attempts: 0, nextRetryMs: null, error: null }
      this.emit(runtime)
      this.connect(runtime)
    }
  }

  /** "Tentar de novo" de uma fonte que esgotou as tentativas (a outra não é tocada). */
  retry(source: TranscriptSource): void {
    const runtime = this.runtimes.get(source)
    if (!runtime || runtime.status.status === 'paused' || runtime.status.status === 'stopped' || this.disabled.has(source)) return
    this.clearTimers(runtime)
    this.closeSocket(runtime)
    runtime.status = { status: 'connecting', attempts: 0, nextRetryMs: null, error: null }
    this.emit(runtime)
    this.connect(runtime)
  }

  /**
   * Encerrar: `Terminate` em cada fonte, espera `Termination` por até 3 s e fecha. O que ainda estava
   * no buffer não é enviado: a gravação acabou. Sockets que já encerravam (pausa ou troca) também são
   * esperados, para nenhum ficar aberto depois do fim.
   */
  async end(): Promise<void> {
    const waits: Promise<void>[] = []
    for (const runtime of this.runtimes.values()) {
      runtime.generation += 1
      this.clearTimers(runtime)
      const socket = runtime.socket
      runtime.socket = null
      if (socket) this.drain(runtime, socket, this.terminationTimeoutMs)
      runtime.buffer = []
      runtime.status = { status: 'stopped', attempts: 0, nextRetryMs: null, error: runtime.status.error }
      waits.push(...runtime.draining.values())
    }
    await Promise.all(waits)
    for (const runtime of this.runtimes.values()) this.emit(runtime)
  }

  /** Sockets ainda abertos ou encerrando, de todas as fontes (teste e diagnóstico). */
  openSockets(): StreamingSocket[] {
    const sockets: StreamingSocket[] = []
    for (const runtime of this.runtimes.values()) {
      if (runtime.socket) sockets.push(runtime.socket)
      sockets.push(...runtime.draining.keys())
    }
    return sockets
  }

  private connect(runtime: SourceRuntime): void {
    runtime.generation += 1
    const generation = runtime.generation
    void this.options.getToken().then(
      (result) => this.onToken(runtime, generation, result),
      () => this.onToken(runtime, generation, { ok: false, error: 'network' }),
    )
  }

  private onToken(runtime: SourceRuntime, generation: number, result: TranscriptionTokenResult): void {
    // Pausa, retomada, fim ou outra tentativa vieram depois deste pedido: o token é de uma geração morta.
    if (generation !== runtime.generation) return
    if (runtime.status.status !== 'connecting' && runtime.status.status !== 'reconnecting') return
    if (result.ok) {
      this.open(runtime, result.token)
      return
    }
    // Sem chave ou chave recusada: tentar de novo não muda nada. O resto é passageiro e conta como tentativa.
    if (result.error === 'no-key' || result.error === 'key-rejected') {
      runtime.status = { status: result.error === 'no-key' ? 'no-key' : 'failed', attempts: runtime.status.attempts, nextRetryMs: null, error: result.error }
      this.emit(runtime)
      return
    }
    this.scheduleReconnect(runtime, result.error)
  }

  private open(runtime: SourceRuntime, token: string): void {
    let socket: StreamingSocket
    try {
      socket = this.options.openSocket(this.options.urlFor(token, runtime.source))
    } catch {
      this.scheduleReconnect(runtime, 'network')
      return
    }
    runtime.socket = socket
    // Sessão e deslocamento ficam presos a este socket: o turno final de uma sessão que encerra depois
    // da retomada ainda sai com o tempo dela.
    const sessionId = this.newSessionId()
    // O deslocamento é o do primeiro quadro que esta sessão vai receber; sem buffer, o instante atual.
    const offsetMs = runtime.buffer[0]?.at ?? this.options.elapsedMs()
    let openedAt: number | null = null

    socket.onopen = () => {
      if (runtime.socket !== socket) return
      openedAt = Date.now()
      runtime.status = { status: 'live', attempts: runtime.status.attempts, nextRetryMs: null, error: null }
      this.emit(runtime)
      this.flush(runtime, socket)
      this.scheduleRotation(runtime)
    }
    socket.onmessage = (event) => this.onData(runtime, socket, sessionId, offsetMs, event.data)
    socket.onclose = () => {
      this.resolveTermination(socket, false)
      if (runtime.socket !== socket) return
      runtime.socket = null
      this.clearTimers(runtime)
      if (openedAt !== null && Date.now() - openedAt >= STABLE_CONNECTION_MS) runtime.status = { ...runtime.status, attempts: 0 }
      this.scheduleReconnect(runtime, 'network')
    }
    socket.onerror = () => {
      // O fechamento chega logo depois em navegador e Node; reconectar aqui duplicaria a tentativa.
    }
    // Sockets de teste podem já nascer abertos.
    if (socket.readyState === SOCKET_OPEN) socket.onopen()
  }

  private onData(runtime: SourceRuntime, socket: StreamingSocket, sessionId: string, offsetMs: number, data: unknown): void {
    if (typeof data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    // Entrega antes de soltar a espera: o turno final que vem junto do fim entra antes de persistir.
    this.options.onMessage({ source: runtime.source, sessionId, offsetMs, message })
    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'Termination') this.resolveTermination(socket, true)
  }

  private flush(runtime: SourceRuntime, socket: StreamingSocket): void {
    const pending = runtime.buffer
    runtime.buffer = []
    for (const frame of pending) this.send(socket, frame.pcm)
  }

  private send(socket: StreamingSocket, pcm: Uint8Array): void {
    try {
      // Cópia exata dos 3200 bytes de PCM, sem o cabeçalho de 8 bytes do quadro.
      socket.send(pcm)
    } catch {
      // O close logo em seguida decide se reconecta.
    }
  }

  private scheduleReconnect(runtime: SourceRuntime, error: SourceError): void {
    if (runtime.status.status === 'stopped' || runtime.status.status === 'paused') return
    if (runtime.status.attempts >= this.reconnectDelays.length) {
      runtime.status = { status: 'failed', attempts: runtime.status.attempts, nextRetryMs: null, error }
      this.emit(runtime)
      return
    }
    const delay = this.reconnectDelays[runtime.status.attempts] as number
    const attempts = runtime.status.attempts + 1
    runtime.status = { status: 'reconnecting', attempts, nextRetryMs: delay, error }
    this.emit(runtime)
    runtime.retryTimer = this.timers.setTimeout(() => {
      runtime.retryTimer = null
      this.connect(runtime)
    }, delay)
  }

  private scheduleRotation(runtime: SourceRuntime): void {
    if (runtime.rotateTimer !== null) this.timers.clearTimeout(runtime.rotateTimer)
    runtime.rotateTimer = this.timers.setTimeout(() => {
      runtime.rotateTimer = null
      void this.rotate(runtime)
    }, this.rotateAfterMs)
  }

  /** Troca planejada aos 170 min: encerra a sessão atual e abre outra, sem aviso de reconexão. */
  private async rotate(runtime: SourceRuntime): Promise<void> {
    const socket = runtime.socket
    if (runtime.status.status !== 'live' || !socket) return
    const generation = runtime.generation
    // Enquanto a troca acontece, os quadros ficam no buffer e entram na sessão nova com o tempo certo.
    runtime.socket = null
    await this.drain(runtime, socket, this.terminationTimeoutMs)
    // Pausa, fim ou "Tentar de novo" pedidos enquanto a troca esperava: não abre outra.
    if (generation !== runtime.generation || this.halted(runtime)) return
    runtime.status = { status: 'connecting', attempts: 0, nextRetryMs: null, error: null }
    this.emit(runtime)
    this.connect(runtime)
  }

  /** Manda `Terminate`, espera o `Termination` (ou o tempo limite) e fecha. Um dreno por socket. */
  private drain(runtime: SourceRuntime, socket: StreamingSocket, timeoutMs: number): Promise<void> {
    const existing = runtime.draining.get(socket)
    if (existing) return existing
    const done = this.waitTermination(socket, timeoutMs).then(() => {
      runtime.draining.delete(socket)
      try {
        socket.close(1000, 'encerrado')
      } catch {
        // já fechado
      }
    })
    runtime.draining.set(socket, done)
    return done
  }

  private waitTermination(socket: StreamingSocket, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false
      const waiters = this.terminateWaiters.get(socket) ?? []
      this.terminateWaiters.set(socket, waiters)
      const finish = (reached: boolean): void => {
        if (done) return
        done = true
        this.timers.clearTimeout(timer)
        const index = waiters.indexOf(finish)
        if (index >= 0) waiters.splice(index, 1)
        if (!waiters.length) this.terminateWaiters.delete(socket)
        resolve(reached)
      }
      waiters.push(finish)
      const timer = this.timers.setTimeout(() => finish(false), timeoutMs)
      try {
        socket.send(JSON.stringify({ type: 'Terminate' }))
      } catch {
        finish(false)
      }
    })
  }

  private resolveTermination(socket: StreamingSocket, reached: boolean): void {
    for (const waiter of [...(this.terminateWaiters.get(socket) ?? [])]) waiter(reached)
  }

  /** Pausada ou encerrada: nada abre nem reconecta até retomar. */
  private halted(runtime: SourceRuntime): boolean {
    const status = runtime.status.status
    return status === 'stopped' || status === 'paused'
  }

  private closeSocket(runtime: SourceRuntime): void {
    const socket = runtime.socket
    runtime.socket = null
    if (!socket) return
    try {
      socket.close(1000, 'encerrado')
    } catch {
      // já fechado
    }
  }

  private clearTimers(runtime: SourceRuntime): void {
    if (runtime.retryTimer !== null) this.timers.clearTimeout(runtime.retryTimer)
    if (runtime.rotateTimer !== null) this.timers.clearTimeout(runtime.rotateTimer)
    runtime.retryTimer = null
    runtime.rotateTimer = null
  }

  private emit(runtime: SourceRuntime): void {
    this.options.onStatus?.(runtime.source, { ...runtime.status })
  }
}
