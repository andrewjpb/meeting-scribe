// Serviço do atendimento no WhatsApp (contrato 141): liga as peças. Cada mensagem nova passa por aqui; o agendador
// (contrato 140) decide quando responder, o motor (contrato 139) decide o quê, e no modo automático o envio sai pela
// prova do agente (`AgentSendProof`), a única exceção ao "nenhuma IA envia" (decisão do dono em 23/11/2026, só para as
// conversas marcadas). No modo rascunho a proposta fica em memória até a pessoa clicar em "Enviar" (o caminho de clique
// de sempre) ou descartar. Resposta minha na conversa cancela o que estava pendente e pausa o atendimento dela.
//
// Continua recebendo, agendando e respondendo com o app bloqueado (decisão do dono, ao contrário do email agendado); só
// o aviso às janelas espera o desbloqueio. A notificação da passagem nunca leva texto de mensagem nem o motivo, e
// bloqueada não leva o nome do contato no título. Relógio, temporizador, sorteio, motor e WhatsApp chegam injetados.
// Logs nunca levam texto de mensagem, de resposta nem das regras do agente. Sem Electron.
import {
  ATENDIMENTO_BINDING_DEFAULTS,
  ATENDIMENTO_REASON_MAX,
  isGroupChat,
  type AtendimentoAgent,
  type AtendimentoAgentTestResult,
  type AtendimentoBinding,
  type AtendimentoDraft,
  type AtendimentoDraftDiscardResult,
  type AtendimentoDraftSendResult,
  type AtendimentoLogAction,
  type AtendimentoRuntime,
  type AtendimentoState,
} from '../../../shared/atendimento'
import { atendimentoAgentTestRequestSchema, atendimentoChatRequestSchema, atendimentoDraftSendRequestSchema } from '../../../shared/atendimento-schema'
import type { WhatsAppMessage, WhatsAppSendRequest, WhatsAppSendResult } from '../../../shared/whatsapp'
import { savedTranscripts } from '../export'
import type { AgentSendAuthority, AgentSendProof } from '../send-guard'
import type { AtendimentoLog } from './log'
import type { ReplyInput, ReplyMessage, ReplyOutcome } from './reply'
import { createAtendimentoScheduler, type AtendimentoScheduler, type SchedulerDeps } from './scheduler'
import type { AtendimentoStore } from './store'

/** Mensagens da conversa no pedido ao motor. */
export const HISTORY_MAX = 50
/** Mensagem mais velha que isto (ou de antes do serviço começar) não gera resposta: reconexão do SSE. */
export const INCOMING_MAX_AGE_MS = 5 * 60_000
/** "Fora do horário" e "limite por hora" no histórico: no máximo uma linha por conversa neste intervalo. */
export const SKIP_LOG_INTERVAL_MS = 10 * 60_000
/** "Digitando…": 1 s a cada 15 caracteres, entre 2 s e 12 s. */
export const TYPING_MS_PER_CHAR = 1000 / 15
export const TYPING_MIN_MS = 2000
export const TYPING_MAX_MS = 12_000
/** Ids das mensagens que o próprio atendimento enviou, guardados para reconhecer o eco. */
const SENT_IDS_MAX = 500

/** Quanto dura o "digitando…" antes de um texto. */
export const typingDelayMs = (text: string): number => Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, Math.round(Array.from(text).length * TYPING_MS_PER_CHAR)))

/** O que o serviço usa do WhatsApp; no app, o serviço do contrato 24. */
export interface AtendimentoWhatsApp {
  /** As últimas `max` mensagens da conversa, em ordem cronológica. */
  lastMessages(chatId: string, max: number): Promise<WhatsAppMessage[]>
  /** Envio do agente, só com a prova dele. */
  agentSend(proof: AgentSendProof, chatId: string, text: string): Promise<WhatsAppSendResult>
  /** "Digitando…" do agente. */
  agentPresence(chatId: string, state: 'composing' | 'paused'): Promise<boolean>
  /**
   * O envio com o token de clique (o mesmo do `scribe:whatsapp-send`), para a proposta do modo rascunho. `onText` recebe
   * o texto que vai sair de fato (o corrigido, com "Corrigir ao enviar"), antes do envio.
   */
  clickSend(senderId: number, request: WhatsAppSendRequest, onText?: (text: string) => void): Promise<WhatsAppSendResult>
  /** O nome da conta conectada, quando o app sabe. */
  ownerName(): string | null
  /** Contrato 147: a transcrição já guardada de um áudio (sem rede). Não muda a regra: áudio pendente passa para o dono. */
  transcript?(chatId: string, messageId: string): Promise<string | null>
}

/** A notificação de passagem, pelo mesmo mecanismo das do WhatsApp; o clique abre a conversa. */
export interface AtendimentoNotice {
  chatId: string
  title: string
  body: string
}

export interface AtendimentoServiceDeps {
  store: Pick<AtendimentoStore, 'state' | 'setPausedUntil'>
  history: Pick<AtendimentoLog, 'append' | 'read'>
  whatsapp: AtendimentoWhatsApp
  /** A autoridade criada na montagem do app; só este serviço recebe. */
  authority: AgentSendAuthority
  /** O motor do contrato 139 (`generateReply` com o `claude` encontrado). Nunca deveria lançar; se lançar, é falha. */
  reply: (input: ReplyInput, signal: AbortSignal) => Promise<ReplyOutcome>
  notify: (notice: AtendimentoNotice) => void
  appName: () => string
  locked: () => boolean
  /** Aviso às janelas (`scribe:atendimento-changed`); o serviço só chama com o app desbloqueado. */
  changed: (chatId: string) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  random?: () => number
  createScheduler?: (deps: SchedulerDeps) => AtendimentoScheduler
  log?: (message: string) => void
}

export interface AtendimentoService {
  /** Toda mensagem nova do WhatsApp (minha ou não). Nunca rejeita. */
  onMessage(message: WhatsAppMessage, chatName: string): Promise<void>
  /** Depois de salvar ou apagar um atendimento, excluir um agente ou pausar todos: descarta o que não vale mais. */
  stateChanged(state: AtendimentoState): void
  runtime(): Promise<AtendimentoRuntime>
  /** "Testar agente": só a decisão; nada é gravado, agendado, enviado ou notificado. */
  testAgent(request: unknown): Promise<AtendimentoAgentTestResult>
  /** Enviar a proposta pelo caminho de clique; sem clique válido, recusado e a proposta fica. */
  draftSend(senderId: number, request: unknown): Promise<AtendimentoDraftSendResult>
  draftDiscard(request: unknown): Promise<AtendimentoDraftDiscardResult>
  /** Saída do app: temporizadores e propostas saem; nada é enviado depois. */
  dispose(): void
}

/** Um envio do atendimento em andamento: os textos que podem voltar como eco e se o eco já chegou. */
interface Sending {
  texts: Set<string>
  echoed: boolean
}

/** Uma resposta em preparo: do vencimento do atraso até o envio. */
interface Run {
  controller: AbortController
  agentId: string
  /** As mensagens ainda sem resposta. */
  pendingIds: string[]
  /** O envio já saiu para o serviço: não há mais como cancelar. */
  sending: boolean
}

const OWNER_FALLBACK = 'o dono deste WhatsApp'
const TEST_CHAT = 'teste@s.whatsapp.net'

const toReplyMessage = (message: WhatsAppMessage, transcripts: ReadonlyMap<string, string> = new Map()): ReplyMessage => {
  const transcript = transcripts.get(message.id)
  return {
    id: message.id,
    fromMe: message.fromMe,
    author: message.author,
    at: new Date(message.at).toISOString(),
    type: message.type,
    text: message.text,
    ...(transcript ? { transcript } : {}),
  }
}

export function createAtendimentoService(deps: AtendimentoServiceDeps): AtendimentoService {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const log = deps.log ?? (() => undefined)
  const startedAt = now()
  let disposed = false

  /** Quem é o agente da pendência de cada conversa (para a linha `cancelled`). */
  const pendingAgent = new Map<string, string>()
  const runs = new Map<string, Run>()
  const drafts = new Map<string, AtendimentoDraft>()
  const handedOff = new Map<string, string>()
  /** O nome da conversa visto na última mensagem dela. */
  const names = new Map<string, string>()
  /**
   * Envios do atendimento em andamento por conversa, com os textos que podem voltar como eco. Antes do retorno, só é eco a
   * mensagem minha com um desses textos, e cada envio aceita um eco só; qualquer outra é resposta do dono.
   */
  const sending = new Map<string, Sending[]>()
  const sentIds = new Set<string>()
  const lastSkipLog = new Map<string, number>()

  const iso = (at: number): string => new Date(at).toISOString()

  const emit = (chatId: string): void => {
    if (disposed || deps.locked()) return
    deps.changed(chatId)
  }

  const append = (chatId: string, agentId: string, action: AtendimentoLogAction, extra: { messageId?: string; reason?: string } = {}): Promise<void> =>
    deps.history
      .append({ at: iso(now()), chatId, agentId, action, ...(extra.messageId ? { messageId: extra.messageId } : {}), ...(extra.reason ? { reason: extra.reason.slice(0, ATENDIMENTO_REASON_MAX) } : {}) })
      .then(
        (ok) => {
          if (!ok) log(`[atendimento] linha ${action} recusada pelo esquema`)
        },
        () => log(`[atendimento] não deu para gravar a linha ${action}`),
      )

  const remember = (id: string): void => {
    sentIds.add(id)
    if (sentIds.size > SENT_IDS_MAX) {
      const oldest = sentIds.values().next().value
      if (oldest !== undefined) sentIds.delete(oldest)
    }
  }

  const beginSend = (chatId: string, text: string): Sending => {
    const entry: Sending = { texts: new Set([text.trim()]), echoed: false }
    sending.set(chatId, [...(sending.get(chatId) ?? []), entry])
    return entry
  }
  const endSend = (chatId: string, entry: Sending): void => {
    const left = (sending.get(chatId) ?? []).filter((known) => known !== entry)
    if (left.length > 0) sending.set(chatId, left)
    else sending.delete(chatId)
  }
  /** A mensagem minha é eco de um envio do atendimento: id já conhecido, ou texto de um envio em andamento (uma vez). */
  const isEcho = (message: WhatsAppMessage): boolean => {
    if (sentIds.delete(message.id)) return true
    const text = message.text.trim()
    const entry = sending.get(message.chatId)?.find((known) => !known.echoed && known.texts.has(text))
    if (!entry) return false
    entry.echoed = true
    return true
  }

  const scheduler = (deps.createScheduler ?? createAtendimentoScheduler)({
    now,
    setTimer,
    clearTimer,
    random: deps.random ?? Math.random,
    onDue: (chatId, pendingIds) => void respond(chatId, pendingIds),
  })

  /** Cancela a pendência e a resposta em preparo da conversa; `cancelled` no histórico se havia alguma. */
  function cancelChat(chatId: string): boolean {
    const ids = scheduler.cancel(chatId)
    const agentId = pendingAgent.get(chatId)
    pendingAgent.delete(chatId)
    const run = runs.get(chatId)
    const stopped = run && !run.sending ? run : undefined
    if (stopped) {
      stopped.controller.abort()
      runs.delete(chatId)
    }
    const who = agentId ?? stopped?.agentId
    if ((ids.length === 0 && !stopped) || !who) return false
    void append(chatId, who, 'cancelled')
    return true
  }

  /** O atendimento ainda vale agora (ligado, sem pausa, agente existente), ou `null`. */
  async function current(chatId: string): Promise<{ binding: AtendimentoBinding; agent: AtendimentoAgent } | null> {
    const state = await deps.store.state()
    if (state.pausedAll) return null
    const binding = state.bindings.find((known) => known.chatId === chatId)
    if (!binding?.enabled) return null
    if (binding.pausedUntil && Date.parse(binding.pausedUntil) > now()) return null
    const agent = state.agents.find((known) => known.id === binding.agentId)
    return agent ? { binding, agent } : null
  }

  /** O dia local de hoje já teve resposta (automática ou da proposta) nesta conversa? */
  async function repliedToday(chatId: string): Promise<boolean> {
    const today = new Date(now()).toDateString()
    const entries = await deps.history.read().catch(() => [])
    return entries.some((entry) => entry.chatId === chatId && (entry.action === 'sent' || entry.action === 'draft-sent') && new Date(entry.at).toDateString() === today)
  }

  /** O agente passou a conversa (ou falhou): histórico, notificação local e a marca no runtime. */
  function handOff(chatId: string, agent: AtendimentoAgent, action: 'handed-off' | 'failed', reason: string): void {
    void append(chatId, agent.id, action, { reason })
    handedOff.set(chatId, iso(now()))
    const name = names.get(chatId)?.trim() || chatId.split('@')[0] || 'um contato'
    const locked = deps.locked()
    // O motivo pode citar a conversa: nunca vai na notificação. Bloqueado, o título é o nome do app (como `notify.ts`).
    deps.notify({ chatId, title: locked ? deps.appName() : name, body: `${agent.name} passou a conversa com ${name} para você` })
    log(`[atendimento] conversa passada para o dono (${action})`)
    emit(chatId)
  }

  function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const onAbort = (): void => {
        clearTimer(handle)
        resolve()
      }
      const handle = setTimer(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  async function respond(chatId: string, pendingIds: string[]): Promise<void> {
    if (disposed) return
    // Uma resposta ainda em preparo nesta conversa (o motor pensando) dá lugar a esta, que leva as pendentes dela.
    const previous = runs.get(chatId)
    const carried = previous && !previous.sending ? previous.pendingIds.filter((id) => !pendingIds.includes(id)) : []
    if (previous && !previous.sending) previous.controller.abort()
    const run: Run = { controller: new AbortController(), agentId: pendingAgent.get(chatId) ?? previous?.agentId ?? '', pendingIds: [...carried, ...pendingIds], sending: false }
    pendingAgent.delete(chatId)
    runs.set(chatId, run)
    const { signal } = run.controller
    const stopped = (): boolean => disposed || signal.aborted
    emit(chatId)
    try {
      const ready = await current(chatId)
      if (stopped()) return
      if (!ready) {
        if (run.agentId) void append(chatId, run.agentId, 'cancelled')
        return
      }
      const { agent, binding } = ready
      run.agentId = agent.id
      let history: ReplyMessage[]
      try {
        const messages = (await deps.whatsapp.lastMessages(chatId, HISTORY_MAX)).slice(-HISTORY_MAX)
        const transcript = deps.whatsapp.transcript?.bind(deps.whatsapp)
        const transcripts = await savedTranscripts(messages, transcript ? { get: transcript } : undefined)
        history = messages.map((message) => toReplyMessage(message, transcripts))
      } catch {
        if (!stopped()) handOff(chatId, agent, 'failed', 'não deu para ler a conversa')
        return
      }
      const firstReplyToday = !(await repliedToday(chatId))
      if (stopped()) return
      const contactName = names.get(chatId) ?? chatId.split('@')[0] ?? ''
      const input: ReplyInput = { agent, binding, ownerName: deps.whatsapp.ownerName()?.trim() || OWNER_FALLBACK, contactName, history, pendingIds: run.pendingIds, firstReplyToday }
      const outcome = await deps.reply(input, signal).catch((): ReplyOutcome => ({ acao: 'falhou', motivo: 'a chamada ao Claude falhou' }))
      if (stopped()) return
      if (outcome.acao === 'passar') return handOff(chatId, agent, 'handed-off', outcome.motivo)
      if (outcome.acao === 'falhou') return handOff(chatId, agent, 'failed', outcome.motivo)

      // O modo pode ter mudado enquanto o motor pensava: vale o de agora.
      const latest = await current(chatId)
      if (stopped()) return
      if (!latest) return void append(chatId, agent.id, 'cancelled')
      if (latest.binding.mode === 'draft') {
        drafts.set(chatId, { text: outcome.texto, at: iso(now()), agentId: latest.agent.id })
        void append(chatId, latest.agent.id, 'drafted')
        log('[atendimento] proposta pronta')
        emit(chatId)
        return
      }
      if (latest.binding.typing) {
        await deps.whatsapp.agentPresence(chatId, 'composing').catch(() => false)
        await wait(typingDelayMs(outcome.texto), signal)
        await deps.whatsapp.agentPresence(chatId, 'paused').catch(() => false)
      }
      if (stopped()) return
      // Antes de enviar, relê: desligado, pausado, trocado para rascunho ou "Pausar todos" no meio cancela.
      const last = await current(chatId)
      if (stopped()) return
      if (!last || last.binding.mode !== 'auto') return void append(chatId, agent.id, 'cancelled')
      if (!scheduler.canSend(chatId, last.binding.maxPerHour)) return void append(chatId, last.agent.id, 'rate-limited')
      const proof = deps.authority.issue(chatId)
      if (!proof) return void append(chatId, last.agent.id, 'failed', { reason: 'conversa sem envio do agente' })
      run.sending = true
      const pending = beginSend(chatId, outcome.texto)
      let result: WhatsAppSendResult
      try {
        result = await deps.whatsapp.agentSend(proof, chatId, outcome.texto).catch((): WhatsAppSendResult => ({ ok: false, error: 'failed' }))
        if (result.ok) remember(result.id)
      } finally {
        endSend(chatId, pending)
      }
      if (!result.ok) {
        if (!disposed) handOff(chatId, last.agent, 'failed', 'o envio pelo WhatsApp falhou')
        return
      }
      scheduler.recordSent(chatId)
      void append(chatId, last.agent.id, 'sent', { messageId: result.id })
      log('[atendimento] resposta enviada pelo agente')
    } catch {
      log('[atendimento] resposta interrompida por erro')
    } finally {
      if (runs.get(chatId) === run) {
        runs.delete(chatId)
        emit(chatId)
      }
    }
  }

  /** Resposta minha na conversa: cancela o pendente, descarta a proposta e pausa o atendimento dela. */
  async function onMine(message: WhatsAppMessage, binding: AtendimentoBinding): Promise<void> {
    const chatId = message.chatId
    if (isEcho(message)) return
    cancelChat(chatId)
    drafts.delete(chatId)
    handedOff.delete(chatId)
    const minutes = binding.pauseOnMyReplyMinutes
    if (minutes > 0) {
      const until = iso(now() + minutes * 60_000)
      if (await deps.store.setPausedUntil(chatId, until).catch(() => false)) void append(chatId, binding.agentId, 'paused')
    }
    emit(chatId)
  }

  function discard(chatId: string): void {
    const cancelled = cancelChat(chatId)
    const dropped = drafts.delete(chatId)
    if (cancelled || dropped) emit(chatId)
  }

  return {
    async onMessage(message, chatName) {
      try {
        if (disposed) return
        // Reconexão do SSE: mensagem de antes do serviço começar, ou velha, não gera resposta.
        if (message.at < startedAt || now() - message.at > INCOMING_MAX_AGE_MS) return
        const chatId = message.chatId
        if (isGroupChat(chatId)) return
        const state = await deps.store.state()
        if (disposed) return
        const binding = state.bindings.find((known) => known.chatId === chatId)
        if (!binding) return
        if (chatName.trim()) names.set(chatId, chatName)
        if (message.fromMe) return await onMine(message, binding)
        const result = scheduler.onIncoming({ chatId, messageId: message.id, binding, pausedAll: state.pausedAll })
        if (result.status === 'scheduled') {
          pendingAgent.set(chatId, binding.agentId)
          emit(chatId)
          return
        }
        if (result.reason !== 'out-of-hours' && result.reason !== 'rate-limited') return
        const at = now()
        const previous = lastSkipLog.get(chatId)
        if (previous !== undefined && at - previous < SKIP_LOG_INTERVAL_MS) return
        lastSkipLog.set(chatId, at)
        await append(chatId, binding.agentId, result.reason)
      } catch {
        log('[atendimento] mensagem não tratada por erro')
      }
    },

    stateChanged(state) {
      if (disposed) return
      const chats = new Set([...pendingAgent.keys(), ...runs.keys(), ...drafts.keys()])
      for (const chatId of chats) {
        const binding = state.bindings.find((known) => known.chatId === chatId)
        if (!binding?.enabled || !state.agents.some((agent) => agent.id === binding.agentId)) discard(chatId)
      }
      // "Pausar todos": toda pendência sai (uma linha por conversa); as propostas ficam para a pessoa decidir.
      if (state.pausedAll) for (const chatId of new Set([...pendingAgent.keys(), ...runs.keys()])) if (cancelChat(chatId)) emit(chatId)
    },

    async runtime() {
      const state = await deps.store.state()
      const out: AtendimentoRuntime = {}
      for (const { chatId } of state.bindings) {
        const pending = scheduler.pending(chatId)
        out[chatId] = { dueAt: pending ? iso(pending.dueAt) : null, draft: drafts.get(chatId) ?? null, handedOffAt: handedOff.get(chatId) ?? null }
      }
      return out
    },

    async testAgent(request) {
      const parsed = atendimentoAgentTestRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { agent: fields, about, message } = parsed.data
      const at = iso(now())
      const agent: AtendimentoAgent = { id: fields.id ?? 'teste', name: fields.name, instructions: fields.instructions, tone: fields.tone, never: fields.never, model: fields.model, createdAt: at, updatedAt: at }
      const binding: AtendimentoBinding = { ...ATENDIMENTO_BINDING_DEFAULTS, chatId: TEST_CHAT, agentId: agent.id, about, updatedAt: at }
      const input: ReplyInput = {
        agent,
        binding,
        ownerName: deps.whatsapp.ownerName()?.trim() || OWNER_FALLBACK,
        contactName: 'Contato de teste',
        history: [{ id: 'teste', fromMe: false, author: 'Contato de teste', at, type: 'text', text: message }],
        pendingIds: ['teste'],
        firstReplyToday: true,
      }
      const outcome = await deps.reply(input, new AbortController().signal).catch((): ReplyOutcome => ({ acao: 'falhou', motivo: '' }))
      if (outcome.acao === 'falhou') return { ok: false, error: 'failed' }
      return { ok: true, decision: outcome }
    },

    async draftSend(senderId, request) {
      const parsed = atendimentoDraftSendRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { chatId, text, clickToken } = parsed.data
      const draft = drafts.get(chatId)
      if (!draft || disposed) return { ok: false, error: 'no-draft' }
      const pending = beginSend(chatId, text)
      let result: WhatsAppSendResult
      try {
        // O caminho de clique de sempre: o token do preload, a correção ao enviar e o envio do serviço do WhatsApp. O
        // texto corrigido também vale como eco.
        result = await deps.whatsapp.clickSend(senderId, { chatId, text, clickToken }, (sent) => void pending.texts.add(sent.trim())).catch((): WhatsAppSendResult => ({ ok: false, error: 'failed' }))
        if (result.ok) remember(result.id)
      } finally {
        endSend(chatId, pending)
      }
      if (!result.ok) return result
      if (drafts.get(chatId) === draft) drafts.delete(chatId)
      await append(chatId, draft.agentId, 'draft-sent', { messageId: result.id })
      emit(chatId)
      return result
    },

    async draftDiscard(request) {
      const parsed = atendimentoChatRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { chatId } = parsed.data
      const draft = drafts.get(chatId)
      if (!draft) return { ok: false, error: 'not-found' }
      drafts.delete(chatId)
      await append(chatId, draft.agentId, 'draft-discarded')
      emit(chatId)
      return { ok: true }
    },

    dispose() {
      disposed = true
      scheduler.dispose()
      for (const run of runs.values()) run.controller.abort()
      runs.clear()
      pendingAgent.clear()
      drafts.clear()
      handedOff.clear()
    },
  }
}
