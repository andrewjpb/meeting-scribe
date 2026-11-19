// WhatsApp pessoal no app (contrato 24): detectar, instalar, ligar, parear, ler e enviar (só com clique). O
// recurso fica desligado por padrão: sem "Instalar" não há ambiente Python, e sem "Ligar" nenhum processo roda
// nem há pedido de rede novo. Ligado, o serviço local (`services/whatsapp-bridge`) é processo filho do app e
// continua conectado com o app bloqueado (as mensagens não se perdem); "Ligar" fica lembrado para a próxima
// abertura. Porta e token ficam cifrados com o `safeStorage` (`whatsapp/service.bin`): um serviço que já esteja
// rodando é reencontrado. O token vai ao serviço num arquivo 0600 que só existe enquanto ele sobe.
//
// Aviso de risco (CA2): instalar e cada pareamento exigem uma aceitação recente da tela de risco, registrada com a
// data em `whatsapp/aceite.json`; a aceitação vale para um pareamento só. Envio (CA4): só com a prova de clique de
// `send-guard.ts`, que só o registro do IPC tem. Rascunho, leitura pelo "Perguntar" e o material do resumo só
// leem. A correção ao enviar (contrato 35) roda dentro do envio, com a prova já gasta: só troca o texto. Logs nunca
// levam texto de mensagem.
//
// Contrato 37: a mídia de uma mensagem e a transcrição de um áudio, só quando a pessoa clica. Os bytes não ficam no
// main (o serviço guarda no disco dele; o renderer, o blob da sessão); a transcrição manda o áudio só à AssemblyAI e
// fica em `whatsapp/transcripts.json`, que sai no "Remover" e no "Sair da conta".
//
// Contrato 39: a imagem ou o vídeo anexado sai pelo mesmo guarda do texto (`sendMedia`): o token é gasto primeiro, o
// tipo é conferido de novo pelos bytes (o que a tela diz é só dica) e a legenda vai como foi digitada, sem a correção do
// contrato 35. Os bytes só passam por aqui a caminho do serviço; nada fica guardado no main.
//
// Contrato 34: responder citando sai pelo mesmo `send` (a mesma prova; a correção do 35 continua valendo no texto). Reagir
// é envio: `react` gasta o seu próprio token de clique no mesmo guarda, e só com um dos 6 emojis fixos. O "digitando…" da
// sua conta (`typing`) não é mensagem e não passa pelo guarda, mas só sai com "Mostrar quando estou digitando" ligado
// (`typingEnabled`, lido a cada vez); desligado, nada vai ao serviço.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { OneShotResult } from '../claude-cli/summary'
import type { SafeStorageLike } from '../secrets'
import { createVault, type Vault } from '../accounts/vault'
import { FileTranscriptError } from '../assemblyai/transcript'
import type { MeetingSummary } from '../../shared/meeting-summary'
import type { Meeting } from '../../shared/meetings'
import {
  WHATSAPP_CHAT_ID_PATTERN,
  WHATSAPP_DRAFT_INSTRUCTION_MAX,
  WHATSAPP_MESSAGE_ID_PATTERN,
  WHATSAPP_REACTION_EMOJIS,
  WHATSAPP_SCOPE_CHATS_MAX,
  WHATSAPP_SEND_TEXT_MAX,
  type WhatsAppChat,
  type WhatsAppDraftResult,
  type WhatsAppError,
  type WhatsAppMediaResult,
  type WhatsAppMeetingLink,
  type WhatsAppMessage,
  type WhatsAppPairing,
  type WhatsAppPresence,
  type WhatsAppReactResult,
  type WhatsAppReaction,
  type WhatsAppSearchHit,
  type WhatsAppSendResult,
  type WhatsAppStatus,
  type WhatsAppTranscribeResult,
} from '../../shared/whatsapp'
import { createBridgeClient, probeInstance, WhatsAppServiceError, type BridgeClient, type WhatsAppHealth } from './client'
import { dayLines, exportChats, exportRecentWith, recentMessages, type ExportCache } from './export'
import { draftInput } from './draft'
import { copyBridge, installBridge, isInstalled, removeBridge, WHATSAPP_PATHS, type Exec, type PackageIndex } from './install'
import { killBridgePid, startBridge, type BridgeBackend, type BridgeProcess, type SpawnBridge } from './process'
import { createSendGuard, type SendGuard } from './send-guard'
import { checkAttachment, WHATSAPP_ATTACH_MIMES, WHATSAPP_ATTACH_NAME_MAX, type WhatsAppSendMediaResult } from '../../shared/whatsapp-attach'
import { clipTranscript, createTranscriptsCache } from './transcripts'

/** Aceitação da tela de risco vale por 10 min e para um pareamento (ou uma instalação). */
export const RISK_ACCEPT_TTL_MS = 10 * 60_000
const RECONNECT_MS = 1_000

export const chatIdSchema = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const meetingIdSchema = z.string().min(1).max(200)
const messagesSchema = z.object({ chatId: chatIdSchema, before: z.number().int().positive().optional(), beforeId: z.string().min(1).max(200).optional() }).strict()
const searchSchema = z.object({ term: z.string().trim().min(2).max(100) }).strict()
const photoSchema = z.object({ chatId: chatIdSchema }).strict()
const mediaSchema = z.object({ chatId: chatIdSchema, messageId: z.string().regex(WHATSAPP_MESSAGE_ID_PATTERN) }).strict()
const transcribeSchema = mediaSchema.extend({ peek: z.boolean().optional() }).strict()
const messageIdSchema = z.string().regex(WHATSAPP_MESSAGE_ID_PATTERN)
const sendSchema = z
  .object({ chatId: chatIdSchema, text: z.string().max(WHATSAPP_SEND_TEXT_MAX).refine((value) => value.trim() !== ''), clickToken: z.string().max(100), replyToId: messageIdSchema.optional() })
  .strict()
/** Contrato 34: só os 6 emojis fixos (ou o vazio, que tira a sua). */
const reactSchema = z.object({ chatId: chatIdSchema, messageId: messageIdSchema, emoji: z.enum([...WHATSAPP_REACTION_EMOJIS, '']), clickToken: z.string().max(100) }).strict()
const typingSchema = z.object({ chatId: chatIdSchema, state: z.enum(['composing', 'paused']) }).strict()
const sendMediaSchema = z
  .object({
    chatId: chatIdSchema,
    name: z.string().min(1).max(WHATSAPP_ATTACH_NAME_MAX),
    mime: z.enum(WHATSAPP_ATTACH_MIMES),
    bytes: z.instanceof(Uint8Array),
    caption: z.string().max(WHATSAPP_SEND_TEXT_MAX).optional(),
    clickToken: z.string().max(100),
  })
  .strict()
const draftSchema = z.object({ chatId: chatIdSchema, instruction: z.string().trim().min(1).max(WHATSAPP_DRAFT_INSTRUCTION_MAX), meetingId: meetingIdSchema.nullable() }).strict()
const riskSchema = z.object({ purpose: z.enum(['install', 'pair']) }).strict()
const pairSchema = z.object({ phone: z.string().regex(/^\d{8,15}$/).optional() }).strict()
const linkSchema = z.object({ chatId: chatIdSchema, chatName: z.string().max(200), useInSummary: z.boolean() }).strict()
const setLinkSchema = z.object({ meetingId: meetingIdSchema, link: linkSchema.nullable() }).strict()
const linksFileSchema = z.record(z.string(), linkSchema)
const vaultSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  port: z.number().int().positive().max(65_535).nullable(),
  on: z.boolean(),
  // Id aleatório da instalação: o `/health` sem token responde com ele, e só depois de bater o token é mandado.
  instanceId: z.string().regex(/^[0-9a-f]{32}$/),
})
type VaultData = z.infer<typeof vaultSchema>
const riskFileSchema = z.object({ acceptances: z.array(z.object({ at: z.string(), purpose: z.enum(['install', 'pair']) })).max(500) })

export interface WhatsAppServiceDeps {
  /** `userData/whatsapp`. */
  root: string
  /** Pasta com os arquivos do serviço (no app empacotado, dentro do `app.asar`). */
  bridgeSource: string
  bridgeFiles: readonly string[]
  backend: BridgeBackend
  index: PackageIndex
  /** Só no smoke: requirements do índice falso. */
  requirements?: string
  pythonCandidates: readonly string[]
  exec: Exec
  spawn?: SpawnBridge
  safeStorage: SafeStorageLike
  baseEnv: NodeJS.ProcessEnv
  /** Rascunho pelo motor do contrato 17 (só leitura, sem ferramentas). */
  draft: (input: string) => Promise<OneShotResult<string> | { ok: false; error: 'not-found' }>
  /**
   * Contrato 35: o texto que sai no envio (o corrigido pelo Claude, com "Corrigir ao enviar" ligado, ou o original).
   * Só recebe e devolve texto; nunca rejeita. Sem ela, sai o texto digitado.
   */
  correct?: (text: string) => Promise<string>
  /**
   * Contrato 37: o texto de um áudio pela AssemblyAI (upload e consulta, até 120 s). Lança `FileTranscriptError`. Sem
   * ela, "Transcrever" falha.
   */
  transcribe?: (bytes: Uint8Array) => Promise<string>
  /** Reunião escolhida como contexto do rascunho; e a data de início, para o material do dia. */
  meeting: (meetingId: string) => Promise<{ meeting: Meeting; summary: MeetingSummary | null } | null>
  onStatus: (status: WhatsAppStatus) => void
  onMessage: (message: WhatsAppMessage, chatName: string) => void
  /** Várias conversas mudaram de uma vez: o renderer relê a lista (no máximo uma vez por segundo). */
  onChatsChanged?: () => void
  /** Contrato 34: as reações de uma mensagem mudaram. */
  onReactions?: (update: { chatId: string; messageId: string; reactions: WhatsAppReaction[] }) => void
  /** Contrato 34: alguém digitando (ou parou) numa conversa. */
  onPresence?: (presence: WhatsAppPresence) => void
  /** Contrato 34: "Mostrar quando estou digitando" (padrão desligado); sem ela, o "digitando…" da sua conta nunca sai. */
  typingEnabled?: () => Promise<boolean>
  log?: (message: string) => void
  now?: () => number
}

export interface WhatsAppService {
  /** Ao abrir o app: reencontra o serviço rodando ou sobe de novo, se estava ligado. */
  init(): Promise<void>
  status(): WhatsAppStatus
  acceptRisk(request: unknown): Promise<WhatsAppStatus>
  install(): Promise<WhatsAppStatus>
  start(): Promise<WhatsAppStatus>
  stop(): Promise<WhatsAppStatus>
  /** QR em texto (ou código por número); só depois da tela de risco deste pareamento. */
  pair(request: unknown): Promise<WhatsAppPairing | { error: WhatsAppError }>
  /** Saiu da tela do QR: a aceitação deste pareamento acaba. */
  cancelPair(): void
  logout(): Promise<WhatsAppStatus>
  remove(): Promise<WhatsAppStatus>
  chats(): Promise<WhatsAppChat[]>
  messages(request: unknown): Promise<WhatsAppMessage[]>
  search(request: unknown): Promise<WhatsAppSearchHit[]>
  /**
   * Contrato 32: foto de perfil da conversa (data URL) ou `null`, guardada na memória (6 h; sem foto ou falha, 10 min). Pedidos
   * da mesma conversa ao mesmo tempo viram um só.
   */
  photo(request: unknown): Promise<string | null>
  /**
   * Contrato 37: os bytes da imagem, do vídeo ou do áudio de uma mensagem, só no clique. Pedidos iguais ao mesmo tempo
   * viram um só; nada fica guardado no main.
   */
  media(request: unknown): Promise<WhatsAppMediaResult>
  /**
   * Contrato 37: o texto de um áudio. Já transcrito: do `transcripts.json`, sem baixar nem enviar nada; com `peek`, só
   * isso. Senão baixa, manda à AssemblyAI e guarda.
   */
  transcribe(request: unknown): Promise<WhatsAppTranscribeResult>
  /** Contrato 32 (Detalhes): a conversa da lista, com a última mensagem. Só leitura. */
  findChat(chatId: string): Promise<WhatsAppChat | null>
  /** Contrato 32 (Detalhes): as últimas `max` mensagens da conversa. Só leitura; nunca zera as não lidas. */
  lastMessages(chatId: string, max: number): Promise<WhatsAppMessage[]>
  /** O preload registrou um clique de "Enviar" desta janela. */
  registerClick(senderId: number, token: unknown): void
  /** Só com o token de clique (uso único, 10 s) da mesma janela. Em todo envio. */
  send(senderId: number, request: unknown): Promise<WhatsAppSendResult>
  /** Contrato 39: a imagem ou o vídeo, com a mesma prova de clique do `send`; a legenda não passa pela correção. */
  sendMedia(senderId: number, request: unknown): Promise<WhatsAppSendMediaResult>
  /** Contrato 34: reagir (um dos 6 emojis; vazio tira a sua), com o token de clique próprio, como um envio. */
  react(senderId: number, request: unknown): Promise<WhatsAppReactResult>
  /** Contrato 34: o "digitando…" da sua conta; só com o interruptor ligado. Nunca lança; `false` quando nada saiu. */
  typing(request: unknown): Promise<boolean>
  forgetSender(senderId: number): void
  draft(request: unknown): Promise<WhatsAppDraftResult>
  link(meetingId: unknown): Promise<WhatsAppMeetingLink | null>
  setLink(request: unknown): Promise<WhatsAppMeetingLink | null>
  /** "Perguntar" (CA5): escreve os `.md` das conversas na pasta de escopo. Só leitura do serviço. */
  exportChats(folder: string, chatIds: readonly string[], days: number): Promise<string[]>
  /**
   * Assistente (contrato 25, CA2): as conversas dos últimos 14 dias e o resumo delas, relendo só as que têm mensagem
   * nova desde o último export daquela pasta. Só leitura; conectado.
   */
  exportRecent(folder: string): Promise<string[]>
  /** A lista de conversas lida pela última exportação (até 2 min), ou lida agora: o nome nos cartões do Assistente. */
  knownChats(): Promise<WhatsAppChat[]>
  /** Resumo e análise: as mensagens do dia da conversa ligada, se a opção estiver ligada. */
  meetingMaterial(meetingId: string): Promise<string[]>
  /** Excluir a reunião: a ligação sai. */
  removeMeeting(meetingId: string): Promise<void>
  /** Smoke: rotas do serviço falso. */
  fake(action: string, body?: Record<string, unknown>): Promise<unknown>
  /** Sair do app: para o processo filho. */
  dispose(): Promise<void>
}

/** A lista lida na exportação vale para os cartões por 2 min. */
const KNOWN_CHATS_MS = 2 * 60_000
/** Contrato 32: a foto vale na memória por 6 h; sem foto ou a que falhou, por 10 min. */
const PHOTO_MS = 6 * 3600_000
/** Sem foto ou falha. */
const PHOTO_FAILED_MS = 10 * 60_000

/** Contrato 37: o erro do serviço na resposta da mídia. */
function mediaError(failure: unknown): 'too-big' | 'gone' | 'unavailable' {
  if (failure instanceof WhatsAppServiceError && failure.status === 413) return 'too-big'
  if (failure instanceof WhatsAppServiceError && failure.status === 410) return 'gone'
  return 'unavailable'
}

/** Contrato 37: o erro da AssemblyAI na resposta de "Transcrever". */
function transcribeError(failure: unknown): 'no-key' | 'key' | 'timeout' | 'failed' {
  if (!(failure instanceof FileTranscriptError)) return 'failed'
  if (failure.kind === 'no-key') return 'no-key'
  if (failure.kind === 'key-rejected') return 'key'
  if (failure.kind === 'timeout') return 'timeout'
  return 'failed'
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

export function createWhatsAppService(deps: WhatsAppServiceDeps): WhatsAppService {
  const now = deps.now ?? Date.now
  const guard: SendGuard = createSendGuard(now)
  const vault: Vault<VaultData> = createVault(join(deps.root, WHATSAPP_PATHS.service), deps.safeStorage, (raw) => {
    const parsed = vaultSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  })
  let child: BridgeProcess | null = null
  /** Serviço reencontrado ao abrir o app (não é filho deste processo): o PID que ele informou. */
  let foreignPid: number | null = null
  let client: BridgeClient | null = null
  let closeEvents: (() => void) | null = null
  let health: WhatsAppHealth | null = null
  /** Contrato 25: o que cada pasta do Assistente já tem exportado, e a última lista de conversas lida. */
  const exportCache: ExportCache = new Map()
  let listRead: { at: number; chats: WhatsAppChat[] } | null = null
  let busy: WhatsAppStatus['busy'] = null
  let error: WhatsAppError | null = null
  let progress: string | null = null
  let riskAcceptedAt: string | null = null
  /** Aceitações ainda não usadas, por propósito. */
  const pendingRisk: Record<'install' | 'pair', number | null> = { install: null, pair: null }
  let disposed = false
  /** Conversas já confirmadas nesta execução não pedem confirmação de novo (o renderer guarda). */
  let chatNames = new Map<string, string>()
  /** Contrato 32: fotos de perfil (até quando valem) e os pedidos em curso. */
  const photos = new Map<string, { until: number; photo: string | null }>()
  const photoRequests = new Map<string, Promise<string | null>>()
  /** Contrato 37: downloads e transcrições em curso, por mensagem (`<conversa>\n<id>`). */
  const mediaRequests = new Map<string, Promise<WhatsAppMediaResult>>()
  const transcribeRequests = new Map<string, Promise<WhatsAppTranscribeResult>>()
  const transcripts = createTranscriptsCache(join(deps.root, WHATSAPP_PATHS.transcripts), now)
  /** Sobe a cada "Sair da conta" e "Remover": a transcrição que terminar depois não grava nada. */
  let generation = 0

  const root = (name: string): string => join(deps.root, name)

  function status(): WhatsAppStatus {
    const installed = isInstalled(deps.root)
    const state: WhatsAppStatus['state'] =
      busy === 'installing' ? 'installing' : !installed ? 'not-installed' : client && health ? health.state : 'stopped'
    return { state, me: state === 'connected' ? (health?.me ?? null) : null, busy, error, progress: busy === 'installing' ? progress : null, riskAcceptedAt }
  }

  const announce = (): void => deps.onStatus(status())

  async function readRisk(): Promise<z.infer<typeof riskFileSchema>> {
    try {
      const parsed = riskFileSchema.safeParse(JSON.parse(await readFile(root(WHATSAPP_PATHS.risk), 'utf8')))
      return parsed.success ? parsed.data : { acceptances: [] }
    } catch {
      return { acceptances: [] }
    }
  }

  async function readLinks(): Promise<Record<string, WhatsAppMeetingLink>> {
    try {
      const parsed = linksFileSchema.safeParse(JSON.parse(await readFile(root(WHATSAPP_PATHS.links), 'utf8')))
      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }

  const riskValid = (purpose: 'install' | 'pair'): boolean => {
    const at = pendingRisk[purpose]
    return at !== null && now() - at <= RISK_ACCEPT_TTL_MS
  }

  function onHealth(next: WhatsAppHealth): void {
    const changed = health?.state !== next.state || health?.me?.name !== next.me?.name || health?.me?.phone !== next.me?.phone
    health = next
    if (next.state === 'connected') pendingRisk.pair = null
    if (changed) {
      deps.log?.(`[whatsapp] estado: ${next.state}`)
      announce()
    }
  }

  let chatsTimer: ReturnType<typeof setTimeout> | null = null
  function chatsChanged(): void {
    if (chatsTimer) return
    chatsTimer = setTimeout(() => {
      chatsTimer = null
      if (!disposed) deps.onChatsChanged?.()
    }, 1000)
  }

  function subscribe(current: BridgeClient): void {
    closeEvents?.()
    closeEvents = current.events(
      (event) => {
        if (client !== current) return
        if (event.type === 'state') onHealth(event.health)
        else if (event.type === 'chats') chatsChanged()
        else if (event.type === 'reactions') deps.onReactions?.({ chatId: event.chatId, messageId: event.messageId, reactions: event.reactions })
        else if (event.type === 'presence') deps.onPresence?.(event.presence)
        else {
          const chatName = event.chatName ?? chatNames.get(event.message.chatId) ?? event.message.chatId.split('@')[0] ?? ''
          deps.onMessage(event.message, chatName)
        }
      },
      () => {
        if (client !== current || disposed) return
        // A conexão caiu: o processo ainda está vivo? Então reconecta.
        setTimeout(() => {
          if (client !== current || disposed) return
          void current.health().then(
            (next) => {
              onHealth(next)
              subscribe(current)
            },
            () => detach('service'),
          )
        }, RECONNECT_MS)
      },
    )
  }

  function detach(reason: WhatsAppError | null): void {
    closeEvents?.()
    closeEvents = null
    client = null
    health = null
    child = null
    if (reason) error = reason
    announce()
  }

  /** Token novo a cada vez que o serviço sobe; o id da instalação fica. */
  function freshToken(): VaultData {
    const saved = vault.read()
    const next: VaultData = { token: randomBytes(32).toString('hex'), port: null, on: saved?.on ?? false, instanceId: saved?.instanceId ?? randomBytes(16).toString('hex') }
    vault.write(next)
    return next
  }

  /**
   * Fala com o serviço numa porta: primeiro o `/health` sem token (só o id da instalação); o token só vai depois de o
   * id bater. `pid`: o processo reencontrado (sem ser filho deste app), para "Desligar" poder pará-lo.
   */
  async function attach(port: number, saved: VaultData, reattached: boolean): Promise<boolean> {
    try {
      if ((await probeInstance(port)) !== saved.instanceId) return false
      const candidate = createBridgeClient(port, saved.token)
      const first = await candidate.health()
      if (first.id !== undefined && first.id !== saved.instanceId) return false
      client = candidate
      health = first
      foreignPid = reattached && typeof first.pid === 'number' ? first.pid : null
      subscribe(candidate)
      return true
    } catch {
      return false
    }
  }

  /** Para o serviço reencontrado: SIGTERM e, depois, SIGKILL, só se o PID for o `server.py` desta instalação. */
  async function stopForeign(): Promise<void> {
    const pid = foreignPid
    foreignPid = null
    if (pid !== null) await killBridgePid(pid, join(deps.root, WHATSAPP_PATHS.bridge, 'server.py'), deps.exec)
  }

  async function startNow(): Promise<void> {
    if (!isInstalled(deps.root)) return
    const saved = freshToken()
    const bridgeDir = await copyBridge(deps.bridgeSource, deps.root, deps.bridgeFiles)
    await mkdir(root(WHATSAPP_PATHS.session), { recursive: true, mode: 0o700 })
    const tokenFile = root(WHATSAPP_PATHS.token)
    await writeAtomic(tokenFile, `${saved.token}\n`)
    const started = await startBridge({
      root: deps.root,
      bridgeDir,
      tokenFile,
      instanceId: saved.instanceId,
      backend: deps.backend,
      baseEnv: deps.baseEnv,
      ...(deps.spawn ? { spawn: deps.spawn } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    })
    // O serviço já leu o token: o arquivo em texto some.
    await rm(tokenFile, { force: true })
    if (!started.ok) {
      error = started.error
      return
    }
    const proc = started.process
    if (!(await attach(proc.port, saved, false))) {
      await proc.stop()
      error = 'start-failed'
      return
    }
    child = proc
    error = null
    vault.write({ ...saved, port: proc.port, on: true })
    void proc.exited.then(() => {
      if (child === proc) detach(busy === 'stopping' ? null : 'service')
    })
  }

  async function stopNow(remember: boolean): Promise<void> {
    const proc = child
    closeEvents?.()
    closeEvents = null
    client = null
    health = null
    child = null
    await proc?.stop()
    await stopForeign()
    const saved = vault.read()
    if (saved && remember) vault.write({ ...saved, port: null, on: false })
  }

  async function run<T>(kind: NonNullable<WhatsAppStatus['busy']>, task: () => Promise<T>): Promise<WhatsAppStatus> {
    if (busy) return status()
    busy = kind
    announce()
    try {
      await task()
    } catch (failure) {
      deps.log?.(`[whatsapp] ${kind} falhou: ${failure instanceof Error ? failure.name : 'erro'}`)
      if (!error) error = kind === 'installing' ? 'install-failed' : 'service'
    } finally {
      busy = null
      progress = null
    }
    announce()
    return status()
  }

  function download(chatId: string, messageId: string): Promise<WhatsAppMediaResult> {
    if (!client) return Promise.resolve({ ok: false, error: 'unavailable' })
    const key = `${chatId}\n${messageId}`
    const running = mediaRequests.get(key)
    if (running) return running
    const task = client.media(chatId, messageId).then(
      ({ mime, bytes }): WhatsAppMediaResult => ({ ok: true, mime, bytes }),
      (failure): WhatsAppMediaResult => ({ ok: false, error: mediaError(failure) }),
    )
    const done = task.finally(() => mediaRequests.delete(key))
    mediaRequests.set(key, done)
    return done
  }

  async function transcribeNow(chatId: string, messageId: string): Promise<WhatsAppTranscribeResult> {
    if (!deps.transcribe) return { ok: false, error: 'failed' }
    const started = generation
    const media = await download(chatId, messageId)
    if (!media.ok) return media
    if (!media.mime.startsWith('audio/')) return { ok: false, error: 'unavailable' }
    let text: string
    try {
      text = await deps.transcribe(media.bytes)
    } catch (failure) {
      deps.log?.(`[whatsapp] transcrição falhou: ${failure instanceof FileTranscriptError ? failure.kind : 'erro'}`)
      return { ok: false, error: transcribeError(failure) }
    }
    deps.log?.('[whatsapp] áudio transcrito pela AssemblyAI')
    if (started !== generation) return { ok: true, text: clipTranscript(text) }
    return { ok: true, text: await transcripts.set(chatId, messageId, text).catch(() => clipTranscript(text)) }
  }

  const requireClient = (): BridgeClient => {
    if (!client) throw new WhatsAppServiceError(0, 'stopped')
    return client
  }

  return {
    async init() {
      const risk = await readRisk()
      riskAcceptedAt = risk.acceptances.at(-1)?.at ?? null
      if (!isInstalled(deps.root)) return
      const saved = vault.read()
      if (!saved?.on) return
      if (saved.port !== null && (await attach(saved.port, saved, true))) {
        deps.log?.('[whatsapp] serviço já rodando, reencontrado')
        announce()
        return
      }
      await run('starting', startNow)
    },

    status,

    async acceptRisk(request) {
      const parsed = riskSchema.safeParse(request)
      if (!parsed.success) return status()
      const at = new Date(now()).toISOString()
      await mkdir(deps.root, { recursive: true, mode: 0o700 })
      const risk = await readRisk()
      risk.acceptances = [...risk.acceptances, { at, purpose: parsed.data.purpose }].slice(-500)
      await writeAtomic(root(WHATSAPP_PATHS.risk), `${JSON.stringify(risk, null, 2)}\n`)
      riskAcceptedAt = at
      pendingRisk[parsed.data.purpose] = now()
      if (error === 'risk') error = null
      announce()
      return status()
    },

    install() {
      if (!riskValid('install')) {
        error = 'risk'
        announce()
        return Promise.resolve(status())
      }
      pendingRisk.install = null
      return run('installing', async () => {
        error = null
        const result = await installBridge({
          root: deps.root,
          exec: deps.exec,
          pythonCandidates: deps.pythonCandidates,
          bridgeSource: deps.bridgeSource,
          bridgeFiles: deps.bridgeFiles,
          ...(deps.requirements ? { requirements: deps.requirements } : {}),
          index: deps.index,
          baseEnv: deps.baseEnv,
          onProgress: (line) => {
            progress = line
            announce()
          },
        })
        if (!result.ok) {
          error = result.error
          return
        }
        // Token e id da instalação novos a cada instalação.
        vault.write({ token: randomBytes(32).toString('hex'), port: null, on: false, instanceId: randomBytes(16).toString('hex') })
        deps.log?.(`[whatsapp] instalado com o Python ${result.python.version}`)
      })
    },

    start() {
      if (client) return Promise.resolve(status())
      return run('starting', async () => {
        error = null
        await startNow()
      })
    },

    stop() {
      return run('stopping', () => stopNow(true))
    },

    async pair(request) {
      const parsed = pairSchema.safeParse(request ?? {})
      if (!parsed.success) return { error: 'service' }
      if (!riskValid('pair')) return { error: 'risk' }
      if (!client) return { error: 'service' }
      try {
        const result = await client.pair(parsed.data.phone)
        if (result.state === 'connected') pendingRisk.pair = null
        return { state: result.state, qr: result.state === 'pairing' ? result.qr : null, code: result.code }
      } catch {
        return { error: 'service' }
      }
    },

    cancelPair() {
      pendingRisk.pair = null
    },

    logout() {
      return run('logging-out', async () => {
        const current = requireClient()
        await current.logout()
        // Contrato 32: o cache dos Detalhes e as fotos são das mensagens apagadas: saem junto. Contrato 37: e as
        // transcrições dos áudios.
        generation++
        await rm(root(WHATSAPP_PATHS.insights), { force: true })
        await rm(root(WHATSAPP_PATHS.transcripts), { force: true })
        transcripts.forget()
        photos.clear()
        // Sessão apagada: o serviço sobe de novo, pronto para um pareamento novo.
        await stopNow(false)
        await startNow()
      })
    },

    remove() {
      return run('removing', async () => {
        generation++
        await stopNow(true)
        vault.remove()
        await removeBridge(deps.root)
        transcripts.forget()
        pendingRisk.install = null
        pendingRisk.pair = null
        chatNames = new Map()
        photos.clear()
        error = null
      })
    },

    async chats() {
      if (!client) return []
      const list = await client.chats()
      chatNames = new Map(list.map((chat) => [chat.id, chat.name]))
      return list
    },

    async messages(request) {
      const parsed = messagesSchema.safeParse(request)
      if (!parsed.success || !client) return []
      const { before, beforeId } = parsed.data
      return client.messages(parsed.data.chatId, { ...(before !== undefined ? { before } : {}), ...(before !== undefined && beforeId !== undefined ? { beforeId } : {}), limit: 50 })
    },

    async search(request) {
      const parsed = searchSchema.safeParse(request)
      if (!parsed.success || !client) return []
      return client.search(parsed.data.term)
    },

    photo(request) {
      const parsed = photoSchema.safeParse(request)
      if (!parsed.success || !client) return Promise.resolve(null)
      const { chatId } = parsed.data
      const known = photos.get(chatId)
      if (known && known.until > now()) return Promise.resolve(known.photo)
      const running = photoRequests.get(chatId)
      if (running) return running
      const current = client
      const task = current.photo(chatId).then(
        (photo) => {
          // Sem foto (ou o serviço não achou) vale pouco: a pessoa pode pôr uma, e a próxima abertura pergunta de novo.
          photos.set(chatId, { until: now() + (photo ? PHOTO_MS : PHOTO_FAILED_MS), photo })
          return photo
        },
        () => {
          photos.set(chatId, { until: now() + PHOTO_FAILED_MS, photo: null })
          return null
        },
      )
      const done = task.finally(() => photoRequests.delete(chatId))
      photoRequests.set(chatId, done)
      return done
    },

    media(request) {
      const parsed = mediaSchema.safeParse(request)
      if (!parsed.success) return Promise.resolve({ ok: false, error: 'unavailable' })
      return download(parsed.data.chatId, parsed.data.messageId)
    },

    async transcribe(request) {
      const parsed = transcribeSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: 'unavailable' }
      const { chatId, messageId, peek } = parsed.data
      const saved = await transcripts.get(chatId, messageId)
      if (saved !== null) return { ok: true, text: saved }
      if (peek) return { ok: false, error: 'not-cached' }
      const key = `${chatId}\n${messageId}`
      const running = transcribeRequests.get(key)
      if (running) return running
      const done = transcribeNow(chatId, messageId).finally(() => transcribeRequests.delete(key))
      transcribeRequests.set(key, done)
      return done
    },

    async findChat(chatId) {
      if (!client || !chatIdSchema.safeParse(chatId).success) return null
      return (await client.chats().catch((): WhatsAppChat[] => [])).find((item) => item.id === chatId) ?? null
    },

    async lastMessages(chatId, max) {
      if (!client || !chatIdSchema.safeParse(chatId).success) return []
      return recentMessages(client, chatId, 0, max, now() + 1)
    },

    registerClick(senderId, token) {
      guard.register(senderId, token)
    },

    async send(senderId, request) {
      const raw = (request ?? {}) as { clickToken?: unknown; chatId?: unknown }
      const parsed = sendSchema.safeParse(request)
      // O token é gasto mesmo com o resto inválido: não serve para uma segunda tentativa.
      const proof = guard.consume(senderId, raw.clickToken, typeof raw.chatId === 'string' ? raw.chatId : '')
      if (!proof) {
        deps.log?.('[whatsapp] envio recusado: sem clique')
        return { ok: false, error: 'click' }
      }
      if (!parsed.success) return { ok: false, error: 'invalid' }
      if (!client || health?.state !== 'connected') return { ok: false, error: 'state' }
      const current = client
      const chat = (await current.chats().catch((): WhatsAppChat[] => [])).find((item) => item.id === parsed.data.chatId)
      if (!chat) return { ok: false, error: 'invalid' }
      // Contrato 35: a correção vem depois da prova gasta e antes do envio; ela vale durante a correção (nada de segundo
      // token). Qualquer falha devolve o original: o clique nunca se perde.
      const text = deps.correct ? await deps.correct(parsed.data.text).catch(() => parsed.data.text) : parsed.data.text
      try {
        // Contrato 34: a resposta cita a mensagem; a que o serviço não tem sai sem citação.
        const id = await current.send(proof, parsed.data.chatId, text, parsed.data.replyToId)
        deps.log?.('[whatsapp] mensagem enviada com o clique da pessoa')
        return { ok: true, id }
      } catch (failure) {
        if (failure instanceof WhatsAppServiceError && failure.status === 409) return { ok: false, error: 'state' }
        return { ok: false, error: 'failed' }
      }
    },

    async sendMedia(senderId, request) {
      const raw = (request ?? {}) as { clickToken?: unknown; chatId?: unknown }
      const parsed = sendMediaSchema.safeParse(request)
      // Como no texto: o token é gasto mesmo com o resto inválido.
      const proof = guard.consume(senderId, raw.clickToken, typeof raw.chatId === 'string' ? raw.chatId : '')
      if (!proof) {
        deps.log?.('[whatsapp] envio de anexo recusado: sem clique')
        return { ok: false, error: 'click' }
      }
      if (!parsed.success) return { ok: false, error: 'invalid' }
      const { chatId, name, mime, bytes, caption } = parsed.data
      // O tipo pelos bytes tem de ser o informado, e dentro do limite dele.
      const checked = checkAttachment(bytes, { declared: mime })
      if (!checked.ok) return { ok: false, error: checked.error === 'too-big' ? 'too-big' : 'invalid' }
      if (!client || health?.state !== 'connected') return { ok: false, error: 'state' }
      const current = client
      const chat = (await current.chats().catch((): WhatsAppChat[] => [])).find((item) => item.id === chatId)
      if (!chat) return { ok: false, error: 'invalid' }
      try {
        const id = await current.sendMedia(proof, chatId, { name, mime, bytes, caption: caption?.trim() ? caption : undefined })
        deps.log?.(`[whatsapp] ${checked.kind === 'video' ? 'vídeo enviado' : 'imagem enviada'} com o clique da pessoa`)
        return { ok: true, id }
      } catch (failure) {
        if (failure instanceof WhatsAppServiceError && failure.status === 409) return { ok: false, error: 'state' }
        if (failure instanceof WhatsAppServiceError && failure.status === 413) return { ok: false, error: 'too-big' }
        if (failure instanceof WhatsAppServiceError && failure.status === 400) return { ok: false, error: 'invalid' }
        // Sem resposta no prazo: o arquivo pode ter saído; a tela pede para conferir antes de tentar de novo.
        if (failure instanceof WhatsAppServiceError && failure.code === 'timeout') return { ok: false, error: 'timeout' }
        if (failure instanceof WhatsAppServiceError && failure.status === 503 && failure.code === 'ffmpeg') return { ok: false, error: 'ffmpeg' }
        return { ok: false, error: 'failed' }
      }
    },

    async react(senderId, request) {
      const raw = (request ?? {}) as { clickToken?: unknown; chatId?: unknown }
      const parsed = reactSchema.safeParse(request)
      // Reagir é envio: o token deste clique é gasto primeiro, mesmo com o resto inválido.
      const proof = guard.consume(senderId, raw.clickToken, typeof raw.chatId === 'string' ? raw.chatId : '')
      if (!proof) {
        deps.log?.('[whatsapp] reação recusada: sem clique')
        return { ok: false, error: 'click' }
      }
      if (!parsed.success) return { ok: false, error: 'invalid' }
      if (!client || health?.state !== 'connected') return { ok: false, error: 'state' }
      const current = client
      const { chatId, messageId, emoji } = parsed.data
      const chat = (await current.chats().catch((): WhatsAppChat[] => [])).find((item) => item.id === chatId)
      if (!chat) return { ok: false, error: 'invalid' }
      try {
        const reactions = await current.react(proof, chatId, messageId, emoji)
        deps.log?.(`[whatsapp] ${emoji ? 'reação enviada' : 'reação tirada'} com o clique da pessoa`)
        return { ok: true, reactions }
      } catch (failure) {
        if (failure instanceof WhatsAppServiceError && failure.status === 409) return { ok: false, error: 'state' }
        if (failure instanceof WhatsAppServiceError && failure.status === 404) return { ok: false, error: 'missing' }
        if (failure instanceof WhatsAppServiceError && failure.status === 400) return { ok: false, error: 'invalid' }
        return { ok: false, error: 'failed' }
      }
    },

    async typing(request) {
      const parsed = typingSchema.safeParse(request)
      if (!parsed.success || !client || health?.state !== 'connected' || !deps.typingEnabled) return false
      const current = client
      // O interruptor é lido a cada vez: desligado agora, nada sai (nem o "parou" de um "digitando…" de antes).
      if (!(await deps.typingEnabled().catch(() => false))) return false
      try {
        await current.presence(parsed.data.chatId, parsed.data.state)
        return true
      } catch {
        return false
      }
    },

    forgetSender(senderId) {
      guard.forget(senderId)
    },

    async draft(request) {
      const parsed = draftSchema.safeParse(request)
      if (!parsed.success || !client) return { ok: false, error: 'chat' }
      const current = client
      const chat = (await current.chats().catch(() => [])).find((item) => item.id === parsed.data.chatId)
      if (!chat) return { ok: false, error: 'chat' }
      const messages = await current.messages(chat.id, { before: now() + 1, limit: 40 }).catch((): WhatsAppMessage[] => [])
      const meeting = parsed.data.meetingId ? await deps.meeting(parsed.data.meetingId).catch(() => null) : null
      const result = await deps.draft(draftInput(chat.name, parsed.data.instruction, messages, meeting))
      if (result.ok) return { ok: true, text: result.content }
      return { ok: false, error: result.error === 'format' ? 'failed' : result.error }
    },

    async link(meetingId) {
      const parsed = meetingIdSchema.safeParse(meetingId)
      if (!parsed.success) return null
      return (await readLinks())[parsed.data] ?? null
    },

    async setLink(request) {
      const parsed = setLinkSchema.safeParse(request)
      if (!parsed.success) return null
      await mkdir(deps.root, { recursive: true, mode: 0o700 })
      const { meetingId: target, link } = parsed.data
      const others = Object.fromEntries(Object.entries(await readLinks()).filter(([id]) => id !== target))
      const links = link ? { ...others, [target]: link } : others
      await writeAtomic(root(WHATSAPP_PATHS.links), `${JSON.stringify(links, null, 2)}\n`)
      return parsed.data.link
    },

    async exportChats(folder, chatIds, days) {
      if (!client) return []
      const ids = chatIds.filter((id) => chatIdSchema.safeParse(id).success).slice(0, WHATSAPP_SCOPE_CHATS_MAX)
      const list = await client.chats()
      listRead = { at: now(), chats: list }
      return exportChats(client, folder, ids, days, now(), exportCache, list)
    },

    async exportRecent(folder) {
      if (!client || health?.state !== 'connected') return []
      const result = await exportRecentWith(client, folder, now(), exportCache)
      listRead = { at: now(), chats: result.chats }
      return result.files
    },

    async knownChats() {
      if (listRead && now() - listRead.at < KNOWN_CHATS_MS) return listRead.chats
      return this.chats()
    },

    async meetingMaterial(meetingId) {
      if (!client) return []
      const link = (await readLinks())[meetingId]
      if (!link?.useInSummary) return []
      const found = await deps.meeting(meetingId).catch(() => null)
      if (!found) return []
      return dayLines(client, link.chatId, found.meeting.startedAt).catch(() => [])
    },

    async removeMeeting(meetingId) {
      if (!existsSync(root(WHATSAPP_PATHS.links))) return
      const all = await readLinks()
      if (!(meetingId in all)) return
      const links = Object.fromEntries(Object.entries(all).filter(([id]) => id !== meetingId))
      await writeAtomic(root(WHATSAPP_PATHS.links), `${JSON.stringify(links, null, 2)}\n`)
    },

    fake(action, body) {
      return requireClient().fake(action, body)
    },

    async dispose() {
      disposed = true
      const proc = child
      closeEvents?.()
      closeEvents = null
      client = null
      child = null
      await proc?.stop()
      await stopForeign()
    },
  }
}
