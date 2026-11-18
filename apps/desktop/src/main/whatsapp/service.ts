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
// leem. Logs nunca levam texto de mensagem.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { OneShotResult } from '../claude-cli/summary'
import type { SafeStorageLike } from '../secrets'
import { createVault, type Vault } from '../accounts/vault'
import type { MeetingSummary } from '../../shared/meeting-summary'
import type { Meeting } from '../../shared/meetings'
import {
  WHATSAPP_CHAT_ID_PATTERN,
  WHATSAPP_DRAFT_INSTRUCTION_MAX,
  WHATSAPP_SCOPE_CHATS_MAX,
  WHATSAPP_SEND_TEXT_MAX,
  type WhatsAppChat,
  type WhatsAppDraftResult,
  type WhatsAppError,
  type WhatsAppMeetingLink,
  type WhatsAppMessage,
  type WhatsAppPairing,
  type WhatsAppSearchHit,
  type WhatsAppSendResult,
  type WhatsAppStatus,
} from '../../shared/whatsapp'
import { createBridgeClient, probeInstance, WhatsAppServiceError, type BridgeClient, type WhatsAppHealth } from './client'
import { dayLines, exportChats, exportRecentWith, recentMessages, type ExportCache } from './export'
import { draftInput } from './draft'
import { copyBridge, installBridge, isInstalled, removeBridge, WHATSAPP_PATHS, type Exec, type PackageIndex } from './install'
import { killBridgePid, startBridge, type BridgeBackend, type BridgeProcess, type SpawnBridge } from './process'
import { createSendGuard, type SendGuard } from './send-guard'

/** Aceitação da tela de risco vale por 10 min e para um pareamento (ou uma instalação). */
export const RISK_ACCEPT_TTL_MS = 10 * 60_000
const RECONNECT_MS = 1_000

export const chatIdSchema = z.string().regex(WHATSAPP_CHAT_ID_PATTERN)
const meetingIdSchema = z.string().min(1).max(200)
const messagesSchema = z.object({ chatId: chatIdSchema, before: z.number().int().positive().optional(), beforeId: z.string().min(1).max(200).optional() }).strict()
const searchSchema = z.object({ term: z.string().trim().min(2).max(100) }).strict()
const photoSchema = z.object({ chatId: chatIdSchema }).strict()
const sendSchema = z.object({ chatId: chatIdSchema, text: z.string().max(WHATSAPP_SEND_TEXT_MAX).refine((value) => value.trim() !== ''), clickToken: z.string().max(100) }).strict()
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
  /** Reunião escolhida como contexto do rascunho; e a data de início, para o material do dia. */
  meeting: (meetingId: string) => Promise<{ meeting: Meeting; summary: MeetingSummary | null } | null>
  onStatus: (status: WhatsAppStatus) => void
  onMessage: (message: WhatsAppMessage, chatName: string) => void
  /** Várias conversas mudaram de uma vez: o renderer relê a lista (no máximo uma vez por segundo). */
  onChatsChanged?: () => void
  log?: (message: string) => void
  now?: () => number
}

/** O que o diálogo nativo de envio mostra. */
export interface SendQuestion {
  chatName: string
  text: string
}

/** Texto do diálogo nativo: "Enviar para <nome>?" e a mensagem, até 300 caracteres. */
export function sendDialogText(question: SendQuestion): { message: string; detail: string } {
  const text = question.text.trim()
  return { message: `Enviar para ${question.chatName}?`, detail: text.length > 300 ? `${text.slice(0, 300)}…` : text }
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
  /** Contrato 32 (Detalhes): a conversa da lista, com a última mensagem. Só leitura. */
  findChat(chatId: string): Promise<WhatsAppChat | null>
  /** Contrato 32 (Detalhes): as últimas `max` mensagens da conversa. Só leitura; nunca zera as não lidas. */
  lastMessages(chatId: string, max: number): Promise<WhatsAppMessage[]>
  /** O preload registrou um clique de "Enviar" desta janela. */
  registerClick(senderId: number, token: unknown): void
  /**
   * Só com o token de clique (uso único, 10 s) da mesma janela e depois do "Enviar" no diálogo nativo (`confirm`),
   * que mostra a conversa e o texto que vão ao serviço. Em todo envio.
   */
  send(senderId: number, request: unknown, confirm: (question: SendQuestion) => Promise<boolean>): Promise<WhatsAppSendResult>
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
        // Contrato 32: o cache dos Detalhes e as fotos são das mensagens apagadas: saem junto.
        await rm(root(WHATSAPP_PATHS.insights), { force: true })
        photos.clear()
        // Sessão apagada: o serviço sobe de novo, pronto para um pareamento novo.
        await stopNow(false)
        await startNow()
      })
    },

    remove() {
      return run('removing', async () => {
        await stopNow(true)
        vault.remove()
        await removeBridge(deps.root)
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

    async send(senderId, request, confirm) {
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
      // Segunda barreira: o diálogo nativo do macOS, aberto pelo main, com a conversa e o texto que vão mesmo ao
      // serviço. Nem um script na tela consegue enviar sem a pessoa ver e clicar em "Enviar" nele.
      if (!(await confirm({ chatName: chat.name, text: parsed.data.text }).catch(() => false))) {
        deps.log?.('[whatsapp] envio cancelado no diálogo')
        return { ok: false, error: 'cancelled' }
      }
      try {
        const id = await current.send(proof, parsed.data.chatId, parsed.data.text)
        deps.log?.('[whatsapp] mensagem enviada com o clique da pessoa')
        return { ok: true, id }
      } catch (failure) {
        if (failure instanceof WhatsAppServiceError && failure.status === 409) return { ok: false, error: 'state' }
        return { ok: false, error: 'failed' }
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
