// Triagem do WhatsApp (contrato 161): o motor. Cada mensagem recebida, com o interruptor ligado e uma tarefa
// "Quando chega mensagem do WhatsApp" ativa, (re)arma o temporizador da conversa (`esperaSeg` desde a última mensagem);
// ao vencer, relê as últimas mensagens, chama o modelo UMA vez e grava a etiqueta (`aplicarAgente`), sem mexer no que o
// dono fixou. Resposta minha na conversa tira o "Urgente". No máximo `TRIAGEM_SIMULTANEAS` ao mesmo tempo (as outras
// esperam numa fila, uma entrada por conversa) e `TRIAGEM_TETO_DIARIO` por dia; cada triagem vira uma execução no
// histórico das Automações (`trigger: 'whatsapp'`), fora do limite diário delas, com um pedido curto sem texto de
// mensagem. O gatilho é a permissão de leitura: só a conversa que recebeu a mensagem é lida.
//
// A IA só etiqueta: nada aqui envia, apaga ou move mensagem. Roda também com o app bloqueado; os avisos às janelas só
// saem desbloqueado. Relógio, temporizador, modelo, WhatsApp, funil e automações chegam injetados. Logs só com o
// `chatId` cortado em 8 caracteres, contagens e tempos: nunca texto de mensagem, nome de contato nem motivo. Sem Electron.
import { randomUUID } from 'node:crypto'
import { isGroupChat } from '../../../shared/atendimento'
import { dayKey, type Agent, type AutomationRun, type RunTrigger, type ScheduledTask } from '../../../shared/automations'
import { CHAT_MODELS, type ChatModel } from '../../../shared/settings-defaults'
import type { ChatMessage } from '../../../shared/chat'
import type { Contato } from '../../../shared/funil'
import { contatoLigado } from '../../../shared/funil-logic'
import { telefoneDoChat } from '../../../shared/funil-sugestoes'
import {
  aplicarAgente,
  aplicarManual,
  chipsDe,
  mensagemRecebida,
  precisaTriar,
  respostaDoDono,
  TRIAGEM_MAX_AGE_MS,
  TRIAGEM_MENSAGENS_MAX,
  TRIAGEM_SIMULTANEAS,
  TRIAGEM_TETO_DIARIO,
  TRIAGEM_TETO_ERRO,
  type Etiqueta,
  type EtiquetaPatch,
  type TriagemStatus,
} from '../../../shared/triagem'
import { triagemChatIdSchema } from '../../../shared/triagem-schema'
import type { WhatsAppChat, WhatsAppMessage } from '../../../shared/whatsapp'
import type { TriagemInput, TriagemOutcome } from './classify'
import type { TriagemStore } from './store'

export type TriagemRunError = 'sem-agente' | 'desligado' | 'pausado' | 'sem-mensagens' | 'teto' | 'ocupado'
export type TriagemRunResult = { ok: true } | { ok: false; error: TriagemRunError }
export type TriagemSetResult = { ok: true; etiqueta: Etiqueta } | { ok: false; error: string }
export type TriagemCreateResult = { ok: true; agentId: string; taskId: string } | { ok: false; error: string }

export interface TriagemServiceDeps {
  store: Pick<TriagemStore, 'list' | 'get' | 'set'>
  /** O interruptor "Triagem do WhatsApp por agente" (`settings.whatsappTriagem`). */
  enabled: () => Promise<boolean>
  /** As automações (a tarefa ativa, o histórico e o modelo pronto), injetadas: elas não importam a triagem. */
  automations: {
    triagemAtiva(): Promise<{ task: ScheduledTask; agent: Agent } | null>
    triagemSituacao(): Promise<{ task: ScheduledTask | null; agent: Agent | null; motivo: 'sem-agente' | 'pausado' | null }>
    salvarExecucaoExterna(run: AutomationRun): Promise<void>
    criarTriagemDoModelo(): Promise<TriagemCreateResult>
  }
  whatsapp: {
    /** As últimas `n` mensagens da conversa, em ordem cronológica. */
    lastMessages(chatId: string, n: number): Promise<WhatsAppMessage[]>
    chat(chatId: string): Promise<WhatsAppChat | null>
    ownerName(): string | null
  }
  funil: {
    contatos(): Promise<Contato[]>
    empresaNome(id: string): Promise<string | null>
  }
  /** O classificador (`createTriagemClassifier` com o `claude` encontrado). Nunca deveria lançar; se lançar, é falha. */
  classify: (input: TriagemInput, signal: AbortSignal) => Promise<TriagemOutcome>
  /** Aviso às janelas (`scribe:triagem-changed`); o serviço só chama com o app desbloqueado. */
  changed: (chatId: string, etiqueta: Etiqueta | null) => void
  /** Aviso às janelas (`scribe:triagem-status-changed`) quando o estado muda; só com o app desbloqueado. */
  statusChanged: (status: TriagemStatus) => void
  locked: () => boolean
  /** Execuções de hoje com o gatilho, sem as que têm o erro `exceptError` (o registro do teto). */
  runs: { hojeTrigger(trigger: RunTrigger, exceptError?: string): Promise<number> }
  /** O fuso das Automações (o mesmo `timeZone` delas): o dia do contador e do registro do teto. */
  timeZone: () => string
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  newId?: () => string
  log?: (message: string) => void
}

export interface TriagemService {
  /** Toda mensagem nova do WhatsApp (minha ou não). Nunca rejeita. */
  onMessage(message: WhatsAppMessage, chatName: string): Promise<void>
  /** "Triar agora": sem a espera e sem o limite de idade; respeita o interruptor, o agente, o teto e a fila. */
  runNow(chatId: unknown): Promise<TriagemRunResult>
  list(): Promise<{ etiquetas: Record<string, Etiqueta>; status: TriagemStatus }>
  /** A escolha do dono (`aplicarManual`). */
  set(chatId: unknown, patch: unknown): Promise<TriagemSetResult>
  status(): Promise<TriagemStatus>
  createFromTemplate(): Promise<TriagemCreateResult>
  /** Saída do app: temporizadores e chamadas em curso saem; nada é gravado depois. */
  dispose(): void
}

interface Entrada {
  chatId: string
  manual: boolean
}

const FALHAS: Record<'timeout' | 'format' | 'failed' | 'agent', string> = {
  timeout: 'O Claude não respondeu a tempo.',
  format: 'A resposta do Claude veio fora do formato.',
  failed: 'A chamada ao Claude falhou.',
  agent: 'O agente do Claude não abriu.',
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** O pedido do dono: só `urgente` (booleano) e `ambito` (`pessoal`, `profissional` ou `null`), ao menos um. */
function patchDe(value: unknown): EtiquetaPatch | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => key !== 'urgente' && key !== 'ambito')) return null
  const patch: EtiquetaPatch = {}
  if ('urgente' in value) {
    if (typeof value['urgente'] !== 'boolean') return null
    patch.urgente = value['urgente']
  }
  if ('ambito' in value) {
    const ambito = value['ambito']
    if (ambito !== null && ambito !== 'pessoal' && ambito !== 'profissional') return null
    patch.ambito = ambito
  }
  return patch
}

/** Recebidas depois da última considerada (todas, quando ela não está mais na janela). */
function novasDesde(messages: readonly WhatsAppMessage[], lastMessageId: string | null): number {
  const from = lastMessageId === null ? -1 : messages.findIndex((message) => message.id === lastMessageId)
  return messages.slice(from + 1).filter((message) => !message.fromMe).length
}

export function createTriagemService(deps: TriagemServiceDeps): TriagemService {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const newId = deps.newId ?? randomUUID
  const log = deps.log ?? (() => undefined)
  let disposed = false

  const timers = new Map<string, unknown>()
  const fila: Entrada[] = []
  const rodando = new Map<string, AbortController>()
  /** O nome da conversa visto na última mensagem dela. */
  const nomes = new Map<string, string>()
  /** Triagens do dia (local): lidas do histórico na primeira vez do dia, depois contadas aqui. */
  let contador: { dia: string; n: Promise<number> } | null = null
  /** O dia em que o registro do teto já foi gravado. */
  let tetoRegistradoEm: string | null = null
  let ultimoStatus: string | null = null

  const curto = (chatId: string): string => chatId.slice(0, 8)
  const iso = (at: number): string => new Date(at).toISOString()
  /** O dia no fuso das Automações, o mesmo do `hojeTrigger` (senão o contador e o histórico discordam perto da meia-noite). */
  const diaDe = (at: number): string => dayKey(at, deps.timeZone())

  const emitir = (chatId: string, etiqueta: Etiqueta | null): void => {
    if (disposed || deps.locked()) return
    deps.changed(chatId, etiqueta)
  }

  function hoje(): Promise<number> {
    const dia = diaDe(now())
    if (contador?.dia !== dia) contador = { dia, n: deps.runs.hojeTrigger('whatsapp', TRIAGEM_TETO_ERRO).catch(() => 0) }
    return contador.n
  }

  /** Reserva mais uma triagem hoje, antes da chamada (as simultâneas contam); `false` no teto. Encadeada: sem corrida. */
  function reservar(): Promise<boolean> {
    void hoje()
    const atual = contador
    if (!atual) return Promise.resolve(false)
    let reservou = false
    const n = atual.n.then((valor) => {
      if (valor >= TRIAGEM_TETO_DIARIO) return valor
      reservou = true
      return valor + 1
    })
    contador = { dia: atual.dia, n }
    return n.then(() => reservou)
  }

  async function computeStatus(): Promise<TriagemStatus> {
    const [ligado, situacao, n] = await Promise.all([deps.enabled().catch(() => false), deps.automations.triagemSituacao(), hoje()])
    const motivo = !ligado ? 'desligado' : situacao.motivo
    return { ativo: motivo === null, motivo, agenteNome: situacao.agent?.name ?? null, tarefaId: situacao.task?.id ?? null, hoje: n, teto: TRIAGEM_TETO_DIARIO }
  }

  /** Relê o estado e avisa as janelas se mudou. */
  async function refreshStatus(): Promise<TriagemStatus> {
    const status = await computeStatus()
    const key = JSON.stringify(status)
    if (key !== ultimoStatus) {
      ultimoStatus = key
      if (!disposed && !deps.locked()) deps.statusChanged(status)
    }
    return status
  }
  const refresh = (): void => void refreshStatus().catch(() => undefined)

  const naFila = (chatId: string): boolean => rodando.has(chatId) || fila.some((entrada) => entrada.chatId === chatId)

  function enfileirar(entrada: Entrada): void {
    if (disposed || fila.some((known) => known.chatId === entrada.chatId)) return
    fila.push(entrada)
    pump()
  }

  function pump(): void {
    while (!disposed && rodando.size < TRIAGEM_SIMULTANEAS) {
      // A primeira da fila cuja conversa não está rodando (FIFO).
      const at = fila.findIndex((entrada) => !rodando.has(entrada.chatId))
      if (at === -1) return
      const [entrada] = fila.splice(at, 1)
      if (!entrada) return
      const controller = new AbortController()
      rodando.set(entrada.chatId, controller)
      void triar(entrada, controller.signal).finally(() => {
        if (rodando.get(entrada.chatId) === controller) rodando.delete(entrada.chatId)
        refresh()
        pump()
      })
    }
  }

  function runBase(task: ScheduledTask, agent: Agent, chatName: string, novas: number, started: number): AutomationRun {
    return {
      id: newId(),
      taskId: task.id,
      taskName: task.name,
      agentId: agent.id,
      agentName: agent.name,
      trigger: 'whatsapp',
      status: 'running',
      startedAt: iso(started),
      endedAt: null,
      durationMs: 0,
      model: agent.model,
      costUsd: 0,
      prompt: `Triagem da conversa ${chatName} · ${novas === 1 ? '1 mensagem nova' : `${novas} mensagens novas`}`,
      answer: null,
      error: null,
      meetingId: null,
      outputResult: null,
    }
  }

  async function salvar(run: AutomationRun): Promise<void> {
    await deps.automations.salvarExecucaoExterna(run).catch(() => log('[triagem] não deu para gravar a execução'))
  }

  /** O teto do dia: uma execução `error` por dia, e nada roda. */
  async function registrarTeto(task: ScheduledTask, agent: Agent, chatName: string, novas: number): Promise<void> {
    const dia = diaDe(now())
    if (tetoRegistradoEm === dia) return
    tetoRegistradoEm = dia
    const at = now()
    log(`[triagem] teto diário de ${TRIAGEM_TETO_DIARIO} atingido`)
    await salvar({ ...runBase(task, agent, chatName, novas, at), status: 'error', endedAt: iso(at), error: TRIAGEM_TETO_ERRO })
  }

  async function entradaDe(chatId: string, agent: Agent, messages: WhatsAppMessage[]): Promise<{ input: TriagemInput; chatName: string }> {
    const chat = await deps.whatsapp.chat(chatId).catch(() => null)
    const chatName = nomes.get(chatId)?.trim() || chat?.name.trim() || chatId.split('@')[0] || 'Contato'
    let funil: TriagemInput['funil'] = null
    if (agent.funil) {
      const contatos = await deps.funil.contatos().catch(() => [])
      const contato = contatoLigado(contatos, { whatsappChatId: chatId, telefone: telefoneDoChat(chat ?? { id: chatId }) })
      const empresa = contato?.empresaId ? await deps.funil.empresaNome(contato.empresaId).catch(() => null) : null
      funil = { contato: contato !== null, empresa }
    }
    return {
      chatName,
      input: {
        instructions: agent.instructions,
        model: agent.model,
        chatName,
        kind: chat?.kind ?? (isGroupChat(chatId) ? 'group' : 'person'),
        ownerName: deps.whatsapp.ownerName(),
        messages,
        funil,
      },
    }
  }

  async function triar({ chatId, manual }: Entrada, signal: AbortSignal): Promise<void> {
    const parado = (): boolean => disposed || signal.aborted
    try {
      if (!(await deps.enabled())) return
      const ativa = await deps.automations.triagemAtiva()
      if (!ativa || parado()) return
      const { task, agent } = ativa
      const messages = await deps.whatsapp.lastMessages(chatId, TRIAGEM_MENSAGENS_MAX)
      const ultimaRecebida = messages.filter((message) => !message.fromMe).at(-1)
      if (!ultimaRecebida || parado()) return
      const atual = await deps.store.get(chatId)
      if (!manual && !precisaTriar(atual, ultimaRecebida.id)) return
      const novas = novasDesde(messages, atual?.lastMessageId ?? null)
      const { input, chatName } = await entradaDe(chatId, agent, messages)
      if (parado()) return
      if (!(await reservar())) return await registrarTeto(task, agent, chatName, novas)
      const started = now()
      const outcome = await deps.classify(input, signal).catch((): TriagemOutcome => ({ ok: false, error: 'failed' }))
      if (parado()) return
      const ended = now()
      const base = { ...runBase(task, agent, chatName, novas, started), endedAt: iso(ended), durationMs: Math.max(0, ended - started) }
      const chatModel = (CHAT_MODELS as readonly string[]).includes(agent.model) ? { model: agent.model as ChatModel } : {}
      if (!outcome.ok) {
        const answer: ChatMessage = { role: 'assistant', text: '', at: iso(ended), error: outcome.error === 'timeout' ? 'timeout' : 'failed', ...chatModel }
        await salvar({ ...base, status: outcome.error === 'timeout' ? 'timeout' : 'error', answer, error: FALHAS[outcome.error] })
        log(`[triagem] conversa ${curto(chatId)} sem etiqueta (${outcome.error}, ${messages.length} mensagens, ${ended - started} ms)`)
        return
      }
      // Relê: a escolha do dono pode ter chegado enquanto o modelo pensava.
      const etiqueta = aplicarAgente(await deps.store.get(chatId), outcome.resultado, ultimaRecebida.id, ended)
      const gravou = await deps.store.set(chatId, etiqueta)
      if (gravou) emitir(chatId, etiqueta)
      const chips = chipsDe(etiqueta)
      const answer: ChatMessage = { role: 'assistant', text: `Etiqueta: ${chips.length ? chips.join(' · ') : 'Nenhuma'}. Motivo: ${etiqueta.motivo ?? ''}`, at: iso(ended), ...chatModel }
      await salvar({ ...base, status: 'ok', costUsd: outcome.costUsd, answer })
      log(`[triagem] conversa ${curto(chatId)} etiquetada (${messages.length} mensagens, ${ended - started} ms)`)
    } catch {
      log(`[triagem] conversa ${curto(chatId)} não triada por erro`)
    }
  }

  return {
    async onMessage(message, chatName) {
      try {
        if (disposed) return
        const chatId = message.chatId
        if (chatName.trim()) nomes.set(chatId, chatName)
        const atual = await deps.store.get(chatId)
        if (message.fromMe) {
          const etiqueta = respostaDoDono(atual, now())
          if (etiqueta && (await deps.store.set(chatId, etiqueta))) emitir(chatId, etiqueta)
          return
        }
        // Reconexão do SSE ou mensagem que chegou com o app fechado: não dispara.
        if (now() - message.at > TRIAGEM_MAX_AGE_MS) return
        // Mensagem nova libera o agente a reavaliar a urgência fixada à mão.
        if (atual?.urgenteFixo) await deps.store.set(chatId, mensagemRecebida(atual) ?? atual)
        const ligado = await deps.enabled()
        refresh()
        if (!ligado || disposed) return
        const ativa = await deps.automations.triagemAtiva()
        if (!ativa || disposed) return
        const { schedule } = ativa.task
        if (schedule.kind !== 'whatsapp-message') return
        if (isGroupChat(chatId) && !schedule.grupos) return
        const anterior = timers.get(chatId)
        if (anterior !== undefined) clearTimer(anterior)
        timers.set(
          chatId,
          setTimer(() => {
            timers.delete(chatId)
            enfileirar({ chatId, manual: false })
          }, schedule.esperaSeg * 1000),
        )
      } catch {
        log('[triagem] mensagem não tratada por erro')
      }
    },

    async runNow(request) {
      const parsed = triagemChatIdSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'sem-mensagens' }
      const chatId = parsed.data
      const status = await refreshStatus()
      if (status.motivo !== null || disposed) return { ok: false, error: status.motivo ?? 'desligado' }
      if (naFila(chatId)) return { ok: false, error: 'ocupado' }
      const messages = await deps.whatsapp.lastMessages(chatId, TRIAGEM_MENSAGENS_MAX).catch(() => [])
      if (!messages.some((message) => !message.fromMe)) return { ok: false, error: 'sem-mensagens' }
      if ((await hoje()) >= TRIAGEM_TETO_DIARIO) return { ok: false, error: 'teto' }
      const anterior = timers.get(chatId)
      if (anterior !== undefined) clearTimer(anterior)
      timers.delete(chatId)
      enfileirar({ chatId, manual: true })
      return { ok: true }
    },

    async list() {
      const [etiquetas, status] = await Promise.all([deps.store.list(), refreshStatus()])
      return { etiquetas, status }
    },

    async set(request, patchRequest) {
      const parsed = triagemChatIdSchema.safeParse(request)
      const patch = patchDe(patchRequest)
      if (!parsed.success || !patch) return { ok: false, error: 'invalid' }
      const chatId = parsed.data
      const etiqueta = aplicarManual(await deps.store.get(chatId), patch, now())
      if (!(await deps.store.set(chatId, etiqueta))) return { ok: false, error: 'invalid' }
      emitir(chatId, etiqueta)
      return { ok: true, etiqueta }
    },

    status: () => refreshStatus(),

    async createFromTemplate() {
      const result = await deps.automations.criarTriagemDoModelo()
      refresh()
      return result
    },

    dispose() {
      disposed = true
      for (const handle of timers.values()) clearTimer(handle)
      timers.clear()
      fila.length = 0
      for (const controller of rodando.values()) controller.abort()
      rodando.clear()
    },
  }
}
