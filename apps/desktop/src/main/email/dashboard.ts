// Painel de e-mail (contrato 156): o serviço que liga a lógica do 155 ao cache do email, ao modelo e aos lotes do
// Desfazer. A passada (`run`) lê só o cache (INBOX, enviados, corpos guardados) e baixa até 30 corpos por conta que
// faltem (por `BODY.PEEK[]`: nada fica lido); manda ao modelo lotes de até 15 mensagens por conta, um por vez, e grava
// os itens no `dashboard.json` depois de cada lote (o lote que falha não leva os outros). Só com a análise ligada nas
// Configurações (R9); uma passada por vez (N5). Nada é enviado nem movido aqui: o "Mover" (`applyMove`) só roda pelo
// canal `scribe:email-dashboard-apply-move`, no clique, e grava o lote com `origem: 'painel'` no mesmo arquivo do
// agente (D4), para o Desfazer de sempre. O agendamento diário (D7) é um relógio de 15 min no main.
//
// Log (R7): uma linha por passada, só com números e o modelo. Nenhum assunto, remetente, prévia, resposta ou motivo
// vai para log, erro ou `lastRun.error`.
import { randomUUID } from 'node:crypto'
import { isInbox, type EmailBody, type EmailMessage, type EmailMoveResult } from '../../shared/email'
import {
  DASHBOARD_LIMITS,
  allowedTargetFolders,
  archiveFolder,
  buildDashboardView,
  itemKey,
  pruneStore,
  selectMessagesToAnalyze,
  withIgnored,
  withOpened,
  type EmailDashboardFolder,
  type EmailDashboardItem,
  type EmailDashboardModel,
  type EmailDashboardSuggestionKind,
  type EmailDashboardView,
} from '../../shared/email-dashboard'
import type { EmailBatch } from '../../shared/email-organize'
import type { EmailDashboardSettings } from '../../shared/settings-defaults'
import { buildEmailDashboardPrompt, emailDashboardSystemPrompt, parseEmailDashboardOutput, type EmailDashboardPromptMessage } from '../claude-cli/email-dashboard'
import type { OneShotResult } from '../claude-cli/summary'
import type { EmailDashboardStoreApi } from './dashboard-store'
import { bodyText, isPending, type EmailCache } from './export'
import type { EmailMoveOptions } from './service'

/** D7: a primeira checagem depois de abrir o app e o intervalo das seguintes. */
export const DASHBOARD_SCHEDULE = { firstCheckMs: 30_000, everyMs: 15 * 60_000 } as const

/** O `chatId` dos lotes do painel (o lote do agente leva o da conversa do Assistente). */
export const EMAIL_DASHBOARD_BATCH_CHAT = 'painel'

/** `lastRun.error`: texto fixo, nunca a mensagem do modelo. */
export const dashboardRunError = (failures: number): string => (failures === 1 ? '1 chamada falhou' : `${failures} chamadas falharam`)
/** `lastRun.error` da passada que o bloqueio do app interrompeu (os lotes já gravados ficam). */
export const DASHBOARD_RUN_LOCKED = 'Análise interrompida: o app foi bloqueado'
/** `lastRun.error` da passada que parou com erro (disco, cache): o agendador não repete no mesmo dia. */
export const DASHBOARD_RUN_FAILED = 'A análise parou com erro'

/** Os erros do `applyMove`: texto fixo, sem dado do e-mail. */
export const DASHBOARD_MOVE_ERRORS = {
  account: 'Conta de e-mail não encontrada.',
  pop3: 'A conta POP3 não tem pastas no servidor; nada foi movido.',
  folder: 'Pasta de destino não permitida; nada foi movido.',
  message: 'Uma das mensagens não está mais na Caixa de Entrada; nada foi movido.',
  server: 'O servidor não moveu as mensagens.',
} as const

/** O pedido ao modelo; a resposta vem como texto (a leitura fica com `parseEmailDashboardOutput`). */
export interface EmailDashboardOneShotRequest {
  purpose: 'email-dashboard'
  model: EmailDashboardModel
  systemPrompt: string
  input: string
  timeoutMs: number
  signal: AbortSignal
}

export interface EmailDashboardEmail {
  /** O cache de cada conta (`EmailService.cached`): só o store, nada vai ao servidor. */
  cached(): Promise<EmailCache[]>
  /** As pastas pelo `LIST` guardado (sem sessão); `null` sem ele ou no POP3. */
  cachedFolders(accountId: string): EmailDashboardFolder[] | null
  /** As pastas, o `LIST` guardado ou pedido agora; `null` sem resposta. */
  listFolders(accountId: string): Promise<EmailDashboardFolder[] | null>
  /** O corpo guardado (nunca baixa). */
  cachedBody(accountId: string, message: EmailMessage): Promise<EmailBody | null>
  /** Baixa o corpo (IMAP, `BODY.PEEK[]`) e guarda; `null` se não deu. */
  loadBody(accountId: string, message: EmailMessage): Promise<EmailBody | null>
  moveMessages(accountId: string, fromPath: string, uids: readonly number[], toPath: string, options?: EmailMoveOptions): Promise<EmailMoveResult & { uidValidity?: string | null }>
  /** Endereços (em minúsculas) de contatos conhecidos fora do email (o funil); lido uma vez por passada. */
  knownContacts(): Promise<ReadonlySet<string>>
}

export interface EmailDashboardDeps {
  store: EmailDashboardStoreApi
  email: EmailDashboardEmail
  /** Os lotes do agente (`batches.json`): grava o lote pronto e devolve o id. */
  batches: { record(batch: EmailBatch): Promise<string> }
  settings: () => Promise<{ emailDashboard: EmailDashboardSettings }>
  runOneShot: (request: EmailDashboardOneShotRequest) => Promise<OneShotResult<string>>
  isLocked(): boolean
  isOnline(): boolean
  now(): number
  log: (line: string) => void
  onChanged: (view: EmailDashboardView) => void
  /** Prazo de cada chamada (os testes encurtam). */
  callTimeoutMs?: number
}

export interface EmailDashboardService {
  view(): Promise<EmailDashboardView>
  /** Começa a passada e volta logo; `settled()` espera ela terminar. */
  run(trigger: 'manual' | 'daily'): Promise<{ started: boolean; running: boolean }>
  /** Espera a passada em curso, se houver. */
  settled(): Promise<void>
  ignore(accountId: string, messageKey: string, kind: EmailDashboardSuggestionKind): Promise<EmailDashboardView>
  markOpened(accountId: string, messageKey: string): Promise<EmailDashboardView>
  /** Só pelo clique: lança (texto fixo) sem mover nada se algo não confere. */
  applyMove(accountId: string, folder: string, messageKeys: readonly string[]): Promise<{ batchId: string; moved: number }>
  startDailyScheduler(): () => void
  /** Sair do app: cancela a chamada em curso. */
  dispose(): void
}

const lower = (address: string): string => address.trim().toLowerCase()
const remetente = (message: EmailMessage): string => {
  const first = message.from[0]
  if (!first) return ''
  return first.name?.trim() && first.name.trim() !== first.address ? `${first.name.trim()} <${first.address}>` : first.address
}
const isPop3 = (cache: EmailCache): boolean => cache.status.account.incoming.protocol === 'pop3'
const ownOf = (cache: EmailCache): string[] => [cache.status.account.address]
/** Contrato 170: a conta pelo nome, como a barra lateral; sem nome, o endereço (na visão e no pedido ao modelo). */
const nomeDaConta = (cache: EmailCache): string => cache.status.account.name?.trim() || cache.status.account.address

export function createEmailDashboardService(deps: EmailDashboardDeps): EmailDashboardService {
  const timeoutMs = deps.callTimeoutMs ?? DASHBOARD_LIMITS.callTimeoutMs
  let running = false
  let current: Promise<void> | null = null
  let abort: AbortController | null = null
  let disposed = false

  /** Os pendentes de resposta de cada conta, pela heurística do `EMAILS.md` (os enviados de todas as contas valem). */
  function pendingOf(caches: readonly EmailCache[]): Map<string, Set<string>> {
    const sent = caches.flatMap((cache) => cache.sent)
    const own = caches.flatMap(ownOf)
    return new Map(caches.map((cache) => [cache.status.account.id, new Set(cache.inbox.filter((message) => isInbox(message) && isPending(message, sent, own, cache.status)).map((message) => message.id))]))
  }

  async function view(): Promise<EmailDashboardView> {
    const [caches, store, settings] = await Promise.all([deps.email.cached(), deps.store.load(), deps.settings()])
    const pending = pendingOf(caches)
    return buildDashboardView({
      enabled: settings.emailDashboard.enabled,
      running,
      store,
      accounts: caches.map((cache) => ({
        accountId: cache.status.account.id,
        name: nomeDaConta(cache),
        address: cache.status.account.address,
        pop3: isPop3(cache),
        ownAddresses: ownOf(cache),
        inbox: cache.inbox,
        pending: pending.get(cache.status.account.id) ?? new Set<string>(),
        folders: isPop3(cache) ? [] : (deps.email.cachedFolders(cache.status.account.id) ?? []),
      })),
    })
  }

  async function changed(): Promise<void> {
    if (disposed) return
    deps.onChanged(await view())
  }

  /** Uma chamada ao modelo com o prazo (que cancela a execução); nunca rejeita. */
  async function ask(request: Omit<EmailDashboardOneShotRequest, 'signal' | 'timeoutMs' | 'purpose'>, signal: AbortSignal): Promise<OneShotResult<string>> {
    const call = new AbortController()
    const stop = (): void => call.abort()
    signal.addEventListener('abort', stop, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const failed: OneShotResult<string> = { ok: false, error: 'timeout' }
    try {
      const deadline = new Promise<OneShotResult<string>>((resolve) => {
        timer = setTimeout(() => {
          call.abort()
          resolve(failed)
        }, timeoutMs)
      })
      const answer = deps
        .runOneShot({ ...request, purpose: 'email-dashboard', timeoutMs, signal: call.signal })
        .catch((): OneShotResult<string> => ({ ok: false, error: 'failed' }))
      return await Promise.race([answer, deadline])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    }
  }

  async function pass(model: EmailDashboardModel, signal: AbortSignal): Promise<void> {
    const started = deps.now()
    const caches = await deps.email.cached()
    const before = await deps.store.load()
    const selected = selectMessagesToAnalyze({
      now: started,
      accounts: caches.map((cache) => ({ accountId: cache.status.account.id, ownAddresses: ownOf(cache), inbox: cache.inbox })),
      store: before,
    })
    const pending = pendingOf(caches)
    const known = new Set<string>()
    if (selected.length) {
      for (const address of await deps.email.knownContacts().catch(() => new Set<string>())) known.add(lower(address))
      // Quem já recebeu um e-mail da pessoa também é conhecido.
      for (const cache of caches) for (const message of cache.sent) for (const address of [...message.to, ...message.cc]) known.add(lower(address.address))
    }
    let analyzed = 0
    let downloads = 0
    let calls = 0
    let failures = 0
    let cost: number | null = null
    let interrupted = false
    /** Sair do app ou bloquear: nada mais vai ao modelo (o bloqueio fica no `lastRun`). */
    const stop = (): boolean => {
      if (signal.aborted) return true
      if (deps.isLocked()) interrupted = true
      return interrupted
    }

    for (const cache of caches) {
      const accountId = cache.status.account.id
      const messages = selected.filter((entry) => entry.accountId === accountId).map((entry) => entry.message)
      if (!messages.length) continue
      if (stop()) break
      const pop3 = isPop3(cache)
      const folders = pop3 ? [] : ((await deps.email.listFolders(accountId).catch(() => null)) ?? deps.email.cachedFolders(accountId) ?? [])
      const allowed = allowedTargetFolders(folders)
      const archive = archiveFolder(folders)
      const allowedPaths = new Set(allowed.map((folder) => folder.path))
      const archiveTarget = archive && allowedPaths.has(archive.path) ? { path: archive.path } : null

      // R3: até 30 corpos baixados por conta; sem corpo, a mensagem vai sem prévia.
      let accountDownloads = 0
      const previews = new Map<string, string | null>()
      for (const message of messages) {
        if (stop()) break
        let body = await deps.email.cachedBody(accountId, message).catch(() => null)
        if (!body && !pop3 && message.uid !== null && accountDownloads < DASHBOARD_LIMITS.bodyDownloadsPerAccount) {
          accountDownloads++
          body = await deps.email.loadBody(accountId, message).catch(() => null)
        }
        previews.set(message.id, body ? bodyText(body).slice(0, DASHBOARD_LIMITS.previewChars) || null : null)
      }
      downloads += accountDownloads

      for (let start = 0; start < messages.length; start += DASHBOARD_LIMITS.perCall) {
        if (stop()) break
        const chunk = messages.slice(start, start + DASHBOARD_LIMITS.perCall)
        const byRef = new Map(chunk.map((message, index) => [`e${index + 1}`, message]))
        const promptMessages: EmailDashboardPromptMessage[] = [...byRef].map(([ref, message]) => ({
          ref,
          from: remetente(message),
          to: message.to.map((address) => address.address),
          subject: message.subject,
          dateIso: new Date(message.date).toISOString(),
          seen: message.seen,
          answered: message.answered,
          pending: pending.get(accountId)?.has(message.id) ?? false,
          knownContact: message.from.some((address) => known.has(lower(address.address))),
          preview: previews.get(message.id) ?? null,
        }))
        calls++
        const result = await ask(
          {
            model,
            systemPrompt: emailDashboardSystemPrompt(),
            input: buildEmailDashboardPrompt({ accountName: nomeDaConta(cache), ownAddresses: ownOf(cache), folders: allowed, archive: archiveTarget, messages: promptMessages }),
          },
          signal,
        )
        if (signal.aborted) break
        const parsed = result.ok ? parseEmailDashboardOutput(result.content, { refs: new Set(byRef.keys()), folders: allowedPaths }) : []
        // Fora do formato vale como falha: nada do lote é gravado e ele volta na próxima passada.
        if (!result.ok || !parsed.length) {
          failures++
          continue
        }
        if (result.costUsd !== null) cost = (cost ?? 0) + result.costUsd
        const at = deps.now()
        const found = new Map(parsed.map((entry) => [entry.ref, entry.item]))
        // O que o modelo não devolveu fica com importância 0 (R6): não volta a cada passada.
        const items: EmailDashboardItem[] = [...byRef].map(([ref, message]) => {
          const item = found.get(ref)
          return {
            accountId,
            messageKey: message.id,
            messageId: message.messageId,
            analyzedAt: at,
            model,
            ...(item ?? { importance: 0 as const, reason: '', needsReply: false, reply: null, move: null }),
            ...(pop3 ? { move: null } : {}),
          }
        })
        // R5: cada lote gravado logo que volta.
        await deps.store.update((store) => {
          for (const item of items) store.items[itemKey(accountId, item.messageKey)] = item
          return store
        })
        analyzed += items.length
      }
    }

    if (signal.aborted) return
    const liveKeys = new Set(caches.flatMap((cache) => cache.inbox.filter(isInbox).map((message) => itemKey(cache.status.account.id, message.id))))
    await deps.store.update((store) => ({ ...pruneStore(store, { now: deps.now(), liveKeys }), lastRun: { at: started, model, analyzed, costUsd: cost, error: interrupted ? DASHBOARD_RUN_LOCKED : failures ? dashboardRunError(failures) : null } }))
    deps.log(`email-dashboard: contas=${caches.length} analisadas=${analyzed} baixadas=${downloads} chamadas=${calls} falhas=${failures}${interrupted ? ' bloqueada=1' : ''} modelo=${model} custo=${cost === null ? '?' : cost.toFixed(4)} ms=${deps.now() - started}`)
  }

  async function run(_trigger: 'manual' | 'daily'): Promise<{ started: boolean; running: boolean }> {
    // N5: uma por vez; o lugar é tomado antes de ler as Configurações (duas chamadas juntas não começam duas).
    if (running) return { started: false, running: true }
    if (disposed) return { started: false, running: false }
    running = true
    let settings: { emailDashboard: EmailDashboardSettings }
    try {
      settings = await deps.settings()
    } catch {
      running = false
      return { started: false, running: false }
    }
    // R9: desligada, nenhum modelo é chamado.
    if (!settings.emailDashboard.enabled) {
      running = false
      return { started: false, running: false }
    }
    const control = new AbortController()
    abort = control
    current = (async () => {
      await changed().catch(() => undefined)
      const model = settings.emailDashboard.model
      try {
        await pass(model, control.signal)
      } catch {
        deps.log('email-dashboard: a passada parou com erro')
        // O `lastRun` fica gravado mesmo assim: o agendador diário não repete a passada a cada 15 min.
        await deps.store.update((store) => ({ ...store, lastRun: { at: deps.now(), model, analyzed: 0, costUsd: null, error: DASHBOARD_RUN_FAILED } })).catch(() => undefined)
      }
    })().finally(() => {
      running = false
      abort = null
      current = null
      void changed().catch(() => undefined)
    })
    return { started: true, running: true }
  }

  async function applyMove(accountId: string, folder: string, messageKeys: readonly string[]): Promise<{ batchId: string; moved: number }> {
    const cache = (await deps.email.cached()).find((item) => item.status.account.id === accountId)
    if (!cache) throw new Error(DASHBOARD_MOVE_ERRORS.account)
    if (isPop3(cache)) throw new Error(DASHBOARD_MOVE_ERRORS.pop3)
    const folders = (await deps.email.listFolders(accountId).catch(() => null)) ?? deps.email.cachedFolders(accountId) ?? []
    if (!allowedTargetFolders(folders).some((item) => item.path === folder)) throw new Error(DASHBOARD_MOVE_ERRORS.folder)
    const keys = [...new Set(messageKeys)]
    const messages = keys.map((key) => cache.inbox.find((message) => message.id === key && isInbox(message) && message.uid !== null))
    if (!keys.length || messages.some((message) => !message)) throw new Error(DASHBOARD_MOVE_ERRORS.message)
    const uidValidity = cache.uidValidity ?? null
    if (uidValidity === null) throw new Error(DASHBOARD_MOVE_ERRORS.message)
    const list = messages as (EmailMessage & { uid: number })[]
    const result = await deps.email.moveMessages(accountId, 'INBOX', list.map((message) => message.uid), folder, { uidValidity })
    if (!result.ok) throw new Error(DASHBOARD_MOVE_ERRORS.server)
    const toUids = new Map(result.moved.map((item) => [item.fromUid, item.toUid]))
    const at = deps.now()
    // O mesmo formato do lote do agente (`organize.ts`): o Desfazer (`scribe:email-batch-undo`) serve sem mudança.
    const batch: EmailBatch = {
      id: randomUUID(),
      accountId,
      chatId: EMAIL_DASHBOARD_BATCH_CHAT,
      startedAt: at,
      endedAt: at,
      state: 'done',
      request: '',
      totals: { read: list.length, total: list.length, outOfLimit: 0 },
      topics: [{ assunto: 'Painel de e-mail', veredito: 'outra', destino: folder, motivo: '', evidencia: '', from: '', count: list.length }],
      items: list.map((message) => ({
        messageId: message.messageId,
        fromPath: 'INBOX',
        fromUid: message.uid,
        fromUidValidity: uidValidity,
        toPath: folder,
        toUid: toUids.get(message.uid) ?? null,
        toUidValidity: result.uidValidity ?? null,
        status: 'moved',
        topic: 0,
      })),
      origem: 'painel',
    }
    const batchId = await deps.batches.record(batch)
    const gone = new Set(keys.map((key) => itemKey(accountId, key)))
    await deps.store.update((store) => ({ ...store, items: Object.fromEntries(Object.entries(store.items).filter(([key]) => !gone.has(key))) }))
    await changed()
    return { batchId, moved: list.length }
  }

  return {
    view,
    run,

    async settled() {
      await current
    },

    async ignore(accountId, messageKey, kind) {
      await deps.store.update((store) => withIgnored(store, accountId, messageKey, kind, deps.now()))
      return view()
    },

    async markOpened(accountId, messageKey) {
      await deps.store.update((store) => withOpened(store, accountId, messageKey, deps.now()))
      return view()
    },

    applyMove,

    startDailyScheduler() {
      let checking = false
      const check = (): void => {
        if (checking || running || disposed || deps.isLocked() || !deps.isOnline()) return
        checking = true
        void (async () => {
          const { lastRun } = await deps.store.load()
          // D7: uma vez por dia civil local.
          if (lastRun && new Date(lastRun.at).toDateString() === new Date(deps.now()).toDateString()) return
          if (deps.isLocked() || !deps.isOnline()) return
          await run('daily')
        })()
          .catch(() => undefined)
          .finally(() => {
            checking = false
          })
      }
      const first = setTimeout(check, DASHBOARD_SCHEDULE.firstCheckMs)
      const timer = setInterval(check, DASHBOARD_SCHEDULE.everyMs)
      return () => {
        clearTimeout(first)
        clearInterval(timer)
      }
    },

    dispose() {
      disposed = true
      abort?.abort()
    },
  }
}
