// Tradução de reserva de um trecho final (CA9): se o `LLMGatewayResponse` da conexão não chegar em
// 5 s, uma chamada avulsa ao gateway traduz aquele trecho — uma única vez por trecho. Falhou, o trecho
// marca "Tradução indisponível" e a tela oferece "Tentar de novo", que chama de novo sem esperar (com
// a chamada ainda em voo, espera a resposta dela em vez de abrir outra). Ao encerrar a gravação, quem
// salva espera as traduções pendentes por até 5 s (`idle`). Timers e a chamada chegam injetados; o
// teste controla o relógio.
import type { TranslateTurnResult } from '../../../shared/transcription'

export const FALLBACK_TIMEOUT_MS = 5_000

export interface TranslationWatcherOptions {
  /** Chamada avulsa (no app, `scribe:translate-turn`). */
  translate: (segmentId: string, text: string) => Promise<TranslateTurnResult>
  onResult: (segmentId: string, result: TranslateTurnResult) => void
  timeoutMs?: number
  setTimer?: (handler: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface Job {
  segmentId: string
  text: string
  timer: unknown
  running: boolean
}

export class TranslationWatcher {
  private readonly jobs = new Map<string, Job>()
  /** Trechos já atendidos: um turno entregue duas vezes não agenda outra chamada. */
  private readonly completed = new Set<string>()
  private readonly timeoutMs: number
  private readonly setTimer: (handler: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private disposed = false
  /** Quem espera não haver mais tradução pendente (`idle`). */
  private idleWaiters: (() => void)[] = []

  constructor(private readonly options: TranslationWatcherOptions) {
    this.timeoutMs = options.timeoutMs ?? FALLBACK_TIMEOUT_MS
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  /** O trecho final chegou sem tradução: espera 5 s antes de chamar o gateway por fora. */
  expect(segmentId: string, text: string): void {
    if (this.disposed || !text.trim() || this.jobs.has(segmentId) || this.completed.has(segmentId)) return
    const job: Job = { segmentId, text, timer: null, running: false }
    job.timer = this.setTimer(() => {
      job.timer = null
      void this.run(job)
    }, this.timeoutMs)
    this.jobs.set(segmentId, job)
  }

  /** Chamado depois de cada tradução da conexão: quem já recebeu não espera mais nada. */
  settle(segments: readonly { id: string; translation: string | null }[]): void {
    for (const segment of segments) {
      if (!segment.translation) continue
      const job = this.jobs.get(segment.id)
      if (!job) continue
      this.cancel(job)
      this.jobs.delete(segment.id)
    }
    if (this.jobs.size === 0) this.notifyIdle()
  }

  /** "Tentar de novo": chama na hora, sem esperar os 5 s. */
  retry(segmentId: string, text: string): void {
    if (this.disposed) return
    const existing = this.jobs.get(segmentId)
    // A chamada anterior ainda não voltou: o resultado dela atende este pedido, sem segunda chamada.
    if (existing?.running) return
    this.completed.delete(segmentId)
    if (existing) this.cancel(existing)
    const job: Job = { segmentId, text, timer: null, running: false }
    this.jobs.set(segmentId, job)
    void this.run(job)
  }

  /**
   * O trecho deixou de precisar de tradução (eco do alto-falante, contrato 06): a espera agendada é
   * cancelada e ele pode ser pedido de novo depois. Uma chamada já em voo segue; quem recebe o
   * resultado decide descartá-lo.
   */
  drop(segmentId: string): void {
    this.completed.delete(segmentId)
    const job = this.jobs.get(segmentId)
    if (!job || job.running) return
    this.cancel(job)
    this.jobs.delete(segmentId)
    if (this.jobs.size === 0) this.notifyIdle()
  }

  has(segmentId: string): boolean {
    return this.jobs.has(segmentId)
  }

  /**
   * Resolve quando não houver tradução agendada nem em voo, ou quando `timeoutMs` passar. Usado ao
   * encerrar, antes de salvar: o resultado que chegar a tempo entra no arquivo.
   */
  idle(timeoutMs: number): Promise<void> {
    if (this.disposed || this.jobs.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      let timer: unknown = null
      const done = (): void => {
        if (timer !== null) this.clearTimer(timer)
        timer = null
        this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== done)
        resolve()
      }
      this.idleWaiters.push(done)
      timer = this.setTimer(done, timeoutMs)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const job of this.jobs.values()) this.cancel(job)
    this.jobs.clear()
    this.notifyIdle()
  }

  private async run(job: Job): Promise<void> {
    if (job.running || this.disposed) return
    job.running = true
    let result: TranslateTurnResult
    try {
      result = await this.options.translate(job.segmentId, job.text)
    } catch {
      result = { ok: false, error: 'server' }
    }
    if (this.disposed) return
    // Trocado por outro pedido enquanto esperava (não acontece com a regra do `retry`, mas um resultado
    // velho nunca vira um segundo resultado).
    if (this.jobs.get(job.segmentId) !== job) return
    this.jobs.delete(job.segmentId)
    this.completed.add(job.segmentId)
    this.options.onResult(job.segmentId, result)
    if (this.jobs.size === 0) this.notifyIdle()
  }

  private notifyIdle(): void {
    for (const waiter of [...this.idleWaiters]) waiter()
  }

  private cancel(job: Job): void {
    if (job.timer !== null) this.clearTimer(job.timer)
    job.timer = null
  }
}
