// Serviço das redes no main (contrato 69, R1–R3 e R10 da spec redes-instagram): as contas do Instagram conectadas por
// token colado e o armazenamento de mídia. O token de cada conta e a chave secreta do armazenamento ficam no cofre
// (`accounts/instagram.bin` e `accounts/media-host.bin`, `safeStorage`); o perfil em cache e a configuração sem segredo,
// em `userData/redes/` (`store.ts`). Nada que sai daqui (`state()`, os resultados e o `onState`) leva token ou segredo:
// `MediaHostStatus.secretSet` é só um booleano.
//
// Renovação (R2, CA3): ao abrir o app e a cada 24 h, o token com 7 dias ou mais (e ainda válido) é renovado por mais 60;
// o que já venceu vira `expirada` sem chamar a API. A Meta só renova token com mais de 24 h: o "Renovar agora" antes
// disso não chama a API (uma recusa ali poderia ser lida como token vencido).
//
// Publicações (contrato 71, R4 e CA5–CA9, CA15): a fila de cada conta fica no mesmo `instagram-<id>.json`; ao salvar o
// rascunho, cada mídia é conferida (`media-check.ts`) e copiada para `redes/midia/<publicação>/`. "Publicar agora" e
// "Agendar" só com o token de clique do preload (o desenho do `emailSend`). A publicação roda uma por conta por vez:
// confere a cota (esgotada adia 1 h), sobe as imagens para o armazenamento, chama `publishOnce` gravando cada passo (o
// `creationId` antes do `media_publish`) e apaga as imagens do armazenamento depois de publicada (ou 48 h depois de um
// erro, pelo agendador). O agendador (30 s) não começa nada com o app bloqueado e retoma o que ficou em `publicando`.
import { randomUUID } from 'node:crypto'
import { chmod, copyFile, open, readFile, rm, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { ACCOUNTS_DIR, createVault } from '../accounts/vault'
import type { HttpFetch } from '../accounts/http'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'
import { MEDIA_HOST_FIELDS } from '../../shared/settings-index'
import {
  ALT_TEXT_MAX,
  captionStats,
  EMPTY_MEDIA_HOST_STATUS,
  inferPublicationType,
  MEDIA_CLEANUP_AFTER_ERROR_MS,
  MEDIA_HOST_REQUIRED_MESSAGE,
  PUBLICATION_ID_PATTERN,
  PUBLISH_TICK_MS,
  QUOTA_POSTPONE_MS,
  QUOTA_POSTPONED_MESSAGE,
  REDES_CLICK_MESSAGE,
  INSTAGRAM_REFRESH_AFTER_DAYS,
  INSTAGRAM_REFRESH_MIN_AGE_HOURS,
  INSTAGRAM_TOKEN_TTL_DAYS,
  mediaHostConfigSchema,
  REDES_ACCOUNT_ID_PATTERN,
  REDES_TOKEN_MAX,
  redesTokenSchema,
  type MediaHostConfig,
  type MediaHostSaveResult,
  type MediaCandidate,
  type MediaHostStatus,
  type Publication,
  type PublicationActionResult,
  type PublicationMedia,
  type PublicationQuota,
  type PublicationQuotaResult,
  type PublicationSaveResult,
  type RedesAccount,
  type RedesConnectResult,
  type RedesPublicationsPayload,
  type RedesState,
} from '../../shared/redes'
import { createInstagramClient, type InstagramProfile } from './instagram-client'
import { inspectMedia, type ReadHead } from './media-check'
import { mediaHostConfigProblem, removeMedia, uploadMedia, type MediaHostTester } from './media-host'
import { publishOnce } from './publisher'
import { createS3Client, safeKey, type S3Client } from './s3'
import { REDES_REQUEST_TIMEOUT_MS } from './hosts'
import { createRedesStore, MEDIA_DIR, REDES_DIR, type StoredMediaHost } from './store'
// 73: comentários
import { COMMENT_REPLY_MAX, type RedesComment, type RedesCommentActionResult, type RedesCommentReplyResult, type RedesCommentsPayload } from '../../shared/redes'
import { addReply, changeComment, commentsPayload, findComment, markRead, readComments, syncComments, thumbPaths, updateComments, type CommentsFile } from './comments'
import { THUMBS_DIR as COMMENT_THUMBS_DIR } from './store'
import { REDES_COMMENT_CLICK_MESSAGE } from '../../shared/ipc'
// fim 73
// 73/74: polling
import { REDES_POLL_MINUTES_DEFAULT } from '../../shared/settings-defaults'
// fim 73/74
// 74: mensagens
import type { RedesMessageSendResult, RedesMessagesPayload } from '../../shared/redes'
import { createMessagesService } from './messages'
// fim 74
// 75: métricas
import { METRIC_PERIODS, METRICS_CACHE_MS, type MetricPeriod, type RedesMetricsState } from '../../shared/redes'
import { createThumbSaver, loadMetrics, metricsStateOf, readMetricsCache } from './insights'
// fim 75

export const INSTAGRAM_VAULT_FILE = 'instagram.bin'
export const MEDIA_HOST_VAULT_FILE = 'media-host.bin'

const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
/** `refreshDue` de novo a cada 24 h com o app aberto. */
export const REDES_REFRESH_INTERVAL_MS = DAY_MS

export const REDES_EXPIRED_MESSAGE = 'Token vencido: gere um novo no painel da Meta'
export const REDES_INVALID_TOKEN_MESSAGE = 'Cole o token gerado no painel da Meta'
export const REDES_TOO_SOON_MESSAGE = `O Instagram só renova o token ${INSTAGRAM_REFRESH_MIN_AGE_HOURS} h depois da última renovação`
export const REDES_ACCOUNT_MISSING_MESSAGE = 'Conta não encontrada'
export const MEDIA_HOST_NOT_READY_DETAIL = 'Salve o armazenamento, com a chave secreta, antes de testar'
const MEDIA_HOST_TEST_FAILED_DETAIL = 'Não foi possível testar o armazenamento'
/** O `safeStorage` não cifra agora (Chaveiro indisponível): nada é gravado. */
export const REDES_VAULT_MESSAGE = 'Não foi possível guardar o token no cofre do sistema'
export const MEDIA_HOST_VAULT_MESSAGE = 'Não foi possível guardar a chave secreta no cofre do sistema'
export const MEDIA_HOST_SECRET_MISSING = 'Falta a chave secreta'
const MEDIA_HOST_INVALID = 'Confira os campos do armazenamento'

/** A razão, para a tela, de uma configuração que não passou no esquema: o primeiro campo vazio ou fora do formato. */
function mediaHostSchemaProblem(error: z.ZodError): string {
  const issue = error.issues.find((item) => item.path[0] === 'config') ?? error.issues[0]
  const field = MEDIA_HOST_FIELDS.find((item) => item.key === issue?.path[1])
  if (!field) return MEDIA_HOST_INVALID
  return issue?.code === 'too_small' ? `Preencha o campo ${field.name}` : `Confira o campo ${field.name}`
}

const tokenEntrySchema = z.object({ token: z.string().min(1).max(REDES_TOKEN_MAX), tokenExpiresAt: z.iso.datetime({ offset: true }), refreshedAt: z.iso.datetime({ offset: true }) }).strict()
const instagramVaultSchema = z.object({ tokens: z.record(z.string().regex(REDES_ACCOUNT_ID_PATTERN), tokenEntrySchema) }).strict()
const mediaHostVaultSchema = z.object({ secretAccessKey: z.string().min(1).max(1024) }).strict()
type InstagramVault = z.infer<typeof instagramVaultSchema>

// Contrato 71: as publicações.
export const PUBLICATION_MISSING_MESSAGE = 'Publicação não encontrada'
export const PUBLICATION_NOT_EDITABLE_MESSAGE = 'Só rascunho, publicação agendada ou com erro pode ser editada'
export const PUBLICATION_BUSY_MESSAGE = 'A publicação está sendo publicada agora'
export const PUBLICATION_PAST_MESSAGE = 'Escolha um horário no futuro'
export const PUBLICATION_MEDIA_GONE_MESSAGE = 'A cópia da mídia sumiu deste Mac; escolha o arquivo de novo'
export const PUBLICATION_FAILED_MESSAGE = 'Não foi possível publicar'
export const PUBLICATION_STARTED_MESSAGE = 'A publicação começou a ser publicada; não dá para editar agora'
/** Contrato 72: "Publicar agora" ou "Agendar" direto numa publicação com erro (sem a edição junto). */
export const PUBLICATION_ERROR_STATE_MESSAGE = 'Publicação com erro: use Tentar de novo ou edite antes'
/** Contrato 76: o rascunho sem mídia (criado pelo Assistente) não é publicado nem agendado. */
export const PUBLICATION_NO_MEDIA_MESSAGE = 'Escolha ao menos uma imagem ou um vídeo'
/** Contrato 76: o id escolhido para o rascunho novo já é de outra publicação. */
export const PUBLICATION_ID_TAKEN_MESSAGE = 'Esse rascunho já existe'
/** Contrato 72: editar a com erro cujo contêiner já saiu (ou que a Meta não deixou conferir): só o "Tentar de novo" retoma. */
export const PUBLICATION_MAYBE_OUT_MESSAGE = 'Esta publicação pode já ter saído no Instagram; use Tentar de novo'
const PUBLICATION_SAVE_FAILED = 'Não foi possível guardar a mídia neste Mac'
const MEDIA_FILE_MISSING = 'Arquivo não encontrado'
/** A cota lida vale 5 min no canal `scribe:redes-quota`. */
export const QUOTA_CACHE_MS = 5 * 60_000

/**
 * Token de clique do "Publicar agora" e do "Agendar" (a regra do `emailSend`: uso único, só a janela que o registrou,
 * 10 s). O `index.ts` injeta um guarda próprio (`createEmailClickGuard`); sem ele, nada passa.
 */
export interface RedesClickGuard {
  register(senderId: number, token: unknown): void
  consume(senderId: number, token: unknown): boolean
  forget(senderId: number): void
}
const REFUSE_ALL_CLICKS: RedesClickGuard = { register: () => undefined, consume: () => false, forget: () => undefined }

const isoSchema = z.iso.datetime({ offset: true })
const publicationIdSchema = z.string().regex(PUBLICATION_ID_PATTERN)
const publicationRequestSchema = z.object({ id: publicationIdSchema })
// Contrato 72: `save` é a edição da tela, salva no main depois de gastar o token de clique (a ativação do clique dura
// poucos segundos; salvar antes, no renderer, podia passar dela). Com `save`, o `id` é o dele.
const scheduleRequestSchema = z.object({ id: publicationIdSchema.optional(), at: isoSchema, clickToken: z.string().max(100), save: z.unknown().optional() })
const publishRequestSchema = z.object({ id: publicationIdSchema.optional(), clickToken: z.string().max(100), save: z.unknown().optional() })
const saveRequestSchema = z.object({
  id: publicationIdSchema.optional(),
  accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN),
  // O limite de 2.200 é conferido pelo `captionStats`, com a razão para a tela.
  caption: z.string().max(50_000),
  mediaPaths: z.array(z.string().min(1).max(4096)).max(50),
  // Contrato 72: por caminho (o `localPath` da cópia salva ou o do arquivo novo), não pelo nome: dois arquivos de mesmo nome.
  altTexts: z.record(z.string().max(4096), z.string().max(ALT_TEXT_MAX)).default({}),
  scheduledAt: isoSchema.nullable(),
})

const EXTENSION: Readonly<Record<PublicationMedia['mimeType'], string>> = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }

/** Leitura do começo (ou de um trecho) de um arquivo, para o `inspectMedia`. */
export const readFileHead: ReadHead = async (path, bytes, position = 0) => {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, position)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Confere um arquivo do disco; o que não abre vira um candidato recusado. */
async function inspectFile(path: string): Promise<MediaCandidate> {
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('não é arquivo')
    return await inspectMedia(path, readFileHead, info.size)
  } catch {
    return { path, fileName: basename(path), ok: false, kind: null, mimeType: null, bytes: 0, width: null, height: null, durationSeconds: null, problems: [MEDIA_FILE_MISSING] }
  }
}

const connectRequestSchema = z.object({ token: z.string().max(REDES_TOKEN_MAX * 2) })
const accountRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN) })
const mediaHostSaveSchema = z.object({ config: mediaHostConfigSchema, secretAccessKey: z.string().trim().max(1024).nullable() })

// 73: comentários
export const COMMENT_MISSING_MESSAGE = 'Comentário não encontrado; atualize a lista'
export const COMMENT_EMPTY_MESSAGE = 'Escreva a resposta'
export const COMMENT_TOO_LONG_MESSAGE = 'A resposta passa de 2.200 caracteres'
// fim 73

export interface RedesServiceOptions {
  userData: string
  safeStorage: SafeStorageLike
  fetch: HttpFetch
  /** Cada mudança, com o estado inteiro (sem token nem segredo). Quem monta decide se vai às janelas (bloqueio). */
  onState: (state: RedesState) => void
  now?: () => number
  testMediaHost: MediaHostTester
  /** Contrato 71: com o app bloqueado, o agendador não começa nada (CA15). */
  isLocked?: () => boolean
  /** Contrato 71: o guarda do token de clique do "Publicar agora" e do "Agendar". */
  clickGuard?: RedesClickGuard
  /** Contrato 71: o diálogo nativo de escolher as mídias (caminhos; vazio se cancelou). */
  pickFiles?: () => Promise<string[]>
  /** Contrato 71: a fila de uma conta mudou (vai inteira, com a cota em cache). */
  onPublications?: (payload: RedesPublicationsPayload) => void
  /** Contrato 71: a espera entre as consultas do contêiner (o smoke encurta; o padrão é o `setTimeout`). */
  sleep?: (ms: number) => Promise<void>
  /** Contrato 72: a miniatura de uma imagem (data URL), feita pelo `nativeImage` no `index.ts`; sem ela, nenhuma. */
  thumbnail?: (path: string) => Promise<string | null>
  // 73: comentários
  /** Contrato 73: os comentários de uma conta mudaram (vão inteiros, com os não lidos). Quem monta decide se vai às janelas. */
  onComments?: (payload: RedesCommentsPayload) => void
  // fim 73
  // 73/74: polling
  /** Contratos 73 e 74: `redesPollMinutes` das Configurações (lido a cada volta do timer); sem ele, 5 min. */
  pollMinutes?: () => Promise<number> | number
  // fim 73/74
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens de uma conta mudaram (vai o estado inteiro); quem monta decide se vai às janelas. */
  onMessages?: (payload: RedesMessagesPayload) => void
  // fim 74
  // 75: métricas
  /** Contrato 75: as métricas de uma conta foram lidas (da Meta ou do cache); quem monta decide se vai às janelas. */
  onMetrics?: (state: RedesMetricsState) => void
  // fim 75
}

export interface RedesService {
  init(): Promise<void>
  state(): RedesState
  connect(request: unknown): Promise<RedesConnectResult>
  refresh(request: unknown): Promise<RedesConnectResult>
  /** Renova o que tem 7 dias ou mais e marca `expirada` o que venceu (ao abrir e a cada 24 h; o smoke chama direto). */
  refreshDue(): Promise<void>
  remove(request: unknown): Promise<{ ok: boolean }>
  mediaHostSave(request: unknown): Promise<MediaHostSaveResult>
  mediaHostTest(): Promise<MediaHostStatus>
  mediaHostClear(): Promise<MediaHostStatus>
  /** Contrato 71: a fila de uma conta (`{ accountId }`) e a última cota lida. */
  publications(request: unknown): Promise<RedesPublicationsPayload>
  /** O diálogo nativo; devolve os arquivos já conferidos, sem salvar nada. */
  pickMedia(): Promise<MediaCandidate[]>
  /**
   * Salva o rascunho. Contrato 76: com `draftWithoutMedia` (só o Assistente), o rascunho pode vir sem mídia: as imagens são
   * escolhidas no editor, e ele não é publicado nem agendado sem elas; o rascunho que já existe sem mídia também salva sem
   * ela (a legenda ajustada no editor antes das imagens). `newId`: o id do rascunho novo, escolhido por quem cria (o cartão
   * do Assistente grava o id antes, para um segundo clique não criar outro); um id que já existe é recusado.
   */
  savePublication(request: unknown, options?: { draftWithoutMedia?: boolean; newId?: string }): Promise<PublicationSaveResult>
  deletePublication(request: unknown): Promise<{ ok: true } | { ok: false; error: string }>
  /** "Agendar": só com o token de clique registrado pela mesma janela (`senderId`). */
  schedulePublication(senderId: number, request: unknown): Promise<PublicationActionResult>
  /** "Publicar agora": só com o token de clique; põe em `publicando` e começa na hora. */
  publishNow(senderId: number, request: unknown): Promise<PublicationActionResult>
  unschedule(request: unknown): Promise<PublicationActionResult>
  /** "Tentar de novo" (só em `erro`): retoma pelo contêiner que já existe. */
  retry(request: unknown): Promise<PublicationActionResult>
  quota(request: unknown): Promise<PublicationQuotaResult>
  /** Contrato 76: as métricas guardadas de uma conta (só o cache, sem ler a Meta), para o `REDES.md` do Assistente. */
  cachedMetrics(accountId: string): Promise<RedesMetricsState>
  /** Contrato 76: a publicação está na fila de alguma conta (o cartão do Assistente não cria o rascunho duas vezes). */
  hasPublication(id: string): boolean
  /** Contrato 72: a miniatura de uma cópia salva ou de um arquivo escolhido no diálogo nesta sessão; o resto, `null`. */
  thumbnail(request: unknown): Promise<string | null>
  // 73: comentários
  /** Contrato 73: os comentários guardados de `{ accountId }` (sem ler a API). */
  commentsState(request: unknown): Promise<RedesCommentsPayload>
  /** Lê as 25 mídias e os comentários agora (ao abrir a seção e no "Atualizar"); a leitura em curso não sai duas vezes. */
  refreshComments(request: unknown): Promise<RedesCommentsPayload>
  /** Responde `{ accountId, commentId, message }`; a resposta a uma resposta vai ao comentário de cima. */
  replyComment(senderId: number, request: unknown): Promise<RedesCommentReplyResult>
  /** Oculta ou mostra `{ accountId, commentId, hide }`. */
  hideComment(request: unknown): Promise<RedesCommentActionResult>
  deleteComment(senderId: number, request: unknown): Promise<RedesCommentActionResult>
  /** Abrir a mídia na tela: `{ accountId, mediaId }` fica toda lida. */
  markCommentsRead(request: unknown): Promise<RedesCommentsPayload>
  // fim 73
  registerClick(senderId: number, token: unknown): void
  forgetSender(senderId: number): void
  /** O agendador: publica o que venceu, retoma o que ficou em `publicando` e limpa o armazenamento (o smoke chama direto). */
  tick(): Promise<void>
  // 73/74: polling
  /** Contratos 73 e 74: uma volta do polling agora (comentários e mensagens das contas conectadas; nada bloqueado). */
  poll(): Promise<void>
  // fim 73/74
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens guardadas de `{ accountId }` (sem ler o Instagram). */
  messagesState(request: unknown): Promise<RedesMessagesPayload>
  /** "Atualizar" e a abertura da seção: lê as conversas agora. */
  refreshMessages(request: unknown): Promise<RedesMessagesPayload>
  /** "Enviar": só com o token de clique registrado pela mesma janela (`senderId`). */
  sendMessage(senderId: number, request: unknown): Promise<RedesMessageSendResult>
  /** A conversa aberta na tela deixa de ser não lida. */
  markConversationRead(request: unknown): Promise<RedesMessagesPayload>
  /** O estado de cada conta conectada (ao desbloquear, para o número do nível). */
  messagesPayloads(): RedesMessagesPayload[]
  // fim 74
  // 75: métricas
  /** Contrato 75: as métricas de `{ accountId, period }`: o cache de 1 h, ou a Meta quando passou (ao abrir a seção). */
  metricsState(request: unknown): Promise<RedesMetricsState>
  /** "Atualizar": lê da Meta de novo, mesmo com o cache valendo. */
  refreshMetrics(request: unknown): Promise<RedesMetricsState>
  // fim 75
  dispose(): void
}

export function createRedesService(options: RedesServiceOptions): RedesService {
  const now = options.now ?? Date.now
  const iso = (ms: number): string => new Date(ms).toISOString()
  const store = createRedesStore(join(options.userData, REDES_DIR))
  const tokens = createVault<InstagramVault>(join(options.userData, ACCOUNTS_DIR, INSTAGRAM_VAULT_FILE), options.safeStorage, (raw) => instagramVaultSchema.safeParse(raw).data ?? null)
  const mediaSecret = createVault(join(options.userData, ACCOUNTS_DIR, MEDIA_HOST_VAULT_FILE), options.safeStorage, (raw) => mediaHostVaultSchema.safeParse(raw).data ?? null)
  const client = createInstagramClient(options.fetch)

  const accounts = new Map<string, RedesAccount>()
  let mediaHost: StoredMediaHost | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  // Contrato 71: a fila de cada conta (a mesma do arquivo), a cota lida e as publicações em curso.
  const queues = new Map<string, Publication[]>()
  const quotas = new Map<string, PublicationQuota>()
  /** A tentativa em curso de cada publicação (termina depois da última gravação dela). */
  const runs = new Map<string, Promise<void>>()
  const accountRuns = new Map<string, Promise<unknown>>()
  const guard = options.clickGuard ?? REFUSE_ALL_CLICKS
  // Contrato 72: os arquivos que o diálogo devolveu nesta sessão (a tela pede a miniatura deles antes de salvar).
  const picked = new Set<string>()
  const mediaRoot = resolve(options.userData, REDES_DIR, MEDIA_DIR)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let publishTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  // Uma mudança por vez (conectar, renovar, remover, salvar): a renovação diária não cruza com o "Remover".
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const mediaHostStatus = (): MediaHostStatus =>
    mediaHost ? { configured: true, config: { ...mediaHost.config }, secretSet: mediaSecret.read() !== null, lastTest: mediaHost.lastTest ? { ...mediaHost.lastTest } : null } : { ...EMPTY_MEDIA_HOST_STATUS, secretSet: mediaSecret.read() !== null }

  const state = (): RedesState => ({
    accounts: [...accounts.values()].sort((a, b) => a.connectedAt.localeCompare(b.connectedAt) || a.username.localeCompare(b.username)).map((account) => ({ ...account })),
    mediaHost: mediaHostStatus(),
  })
  const emit = (): void => {
    if (!disposed) options.onState(state())
  }

  const readTokens = (): InstagramVault => tokens.read() ?? { tokens: {} }
  const writeToken = (accountId: string, entry: InstagramVault['tokens'][string] | null): void => {
    const others = Object.entries(readTokens().tokens).filter(([id]) => id !== accountId)
    const next: InstagramVault = { tokens: Object.fromEntries(entry ? [...others, [accountId, entry]] : others) }
    if (Object.keys(next.tokens).length) tokens.write(next)
    else tokens.remove()
  }

  const save = async (account: RedesAccount): Promise<RedesAccount> => {
    await store.writeAccount(account)
    accounts.set(account.id, account)
    return account
  }

  const fromProfile = (profile: InstagramProfile, previous: RedesAccount | undefined, at: number, expiresAt: number): RedesAccount => ({
    id: profile.userId,
    rede: 'instagram',
    username: profile.username,
    name: profile.name,
    accountType: profile.accountType,
    pictureUrl: profile.pictureUrl,
    followers: profile.followers,
    mediaCount: profile.mediaCount,
    tokenExpiresAt: iso(expiresAt),
    refreshedAt: iso(at),
    // O mesmo token colado de novo para uma conta já conectada só troca o token: a conta continua a mesma.
    connectedAt: previous?.connectedAt ?? iso(at),
    state: 'conectada',
    error: null,
  })

  const markExpired = async (account: RedesAccount): Promise<RedesConnectResult> => {
    await save({ ...account, state: 'expirada', error: REDES_EXPIRED_MESSAGE })
    return { ok: false, error: REDES_EXPIRED_MESSAGE }
  }

  /** A renovação de uma conta, já dentro da fila. */
  const refreshAccount = async (accountId: string, manual: boolean): Promise<RedesConnectResult> => {
    const account = accounts.get(accountId)
    if (!account) return { ok: false, error: REDES_ACCOUNT_MISSING_MESSAGE }
    const at = now()
    const entry = readTokens().tokens[accountId]
    if (!entry || at >= Date.parse(account.tokenExpiresAt)) return markExpired(account)
    if (manual && at - Date.parse(entry.refreshedAt) < INSTAGRAM_REFRESH_MIN_AGE_HOURS * HOUR_MS) return { ok: false, error: REDES_TOO_SOON_MESSAGE }
    const result = await client.refreshToken(entry.token)
    if (!result.ok) {
      if (result.code === 190) return markExpired(account)
      // Outra falha (rede, limite): o token fica como estava e a próxima vez tenta de novo.
      await save({ ...account, state: 'erro', error: result.error })
      return { ok: false, error: result.error }
    }
    const expiresAt = at + result.expiresInSeconds * 1000
    try {
      writeToken(accountId, { token: result.accessToken, tokenExpiresAt: iso(expiresAt), refreshedAt: iso(at) })
    } catch (error) {
      if (!(error instanceof EncryptionUnavailableError)) throw error
      // O token novo não coube no cofre: o antigo continua lá e ainda vale; a próxima renovação tenta de novo.
      await save({ ...account, state: 'erro', error: REDES_VAULT_MESSAGE })
      return { ok: false, error: REDES_VAULT_MESSAGE }
    }
    return { ok: true, account: { ...(await save({ ...account, tokenExpiresAt: iso(expiresAt), refreshedAt: iso(at), state: 'conectada', error: null })) } }
  }

  const refreshDue = async (): Promise<void> => {
    for (const id of [...accounts.keys()]) {
      await serial(async () => {
        const account = accounts.get(id)
        if (!account || account.state === 'expirada') return
        const at = now()
        if (at >= Date.parse(account.tokenExpiresAt)) await markExpired(account)
        else if (at - Date.parse(account.refreshedAt) >= INSTAGRAM_REFRESH_AFTER_DAYS * DAY_MS) await refreshAccount(id, false)
        else return
        emit()
      }).catch(() => undefined)
    }
  }

  // ── Publicações (contrato 71) ──────────────────────────────────────────────────────────────────────────────────

  const payloadOf = (accountId: string): RedesPublicationsPayload => {
    const quota = quotas.get(accountId)
    return { accountId, publications: (queues.get(accountId) ?? []).map((item) => ({ ...item, media: item.media.map((media) => ({ ...media })) })), quota: quota ? { ...quota } : null }
  }
  const emitPublications = (accountId: string): void => {
    if (!disposed) options.onPublications?.(payloadOf(accountId))
  }
  const findPublication = (id: string): Publication | undefined => {
    for (const queue of queues.values()) {
      const found = queue.find((item) => item.id === id)
      if (found) return found
    }
    return undefined
  }
  /** Grava a publicação na fila (nova no fim), no arquivo e avisa. A conta que saiu não volta por aqui. */
  const putPublication = async (publication: Publication): Promise<Publication> => {
    const next: Publication = { ...publication, updatedAt: iso(now()) }
    if (!accounts.has(next.accountId)) return next
    const queue = queues.get(next.accountId) ?? []
    const updated = queue.some((item) => item.id === next.id) ? queue.map((item) => (item.id === next.id ? next : item)) : [...queue, next]
    queues.set(next.accountId, updated)
    await store.writePublications(next.accountId, updated)
    emitPublications(next.accountId)
    return next
  }
  const rememberQuota = (accountId: string, quota: PublicationQuota): PublicationQuota => {
    const value = { ...quota, checkedAt: iso(now()) }
    quotas.set(accountId, value)
    return value
  }

  /** O cliente do armazenamento, com prazo para a maior imagem (15 s mais 1 s a cada 256 KB). */
  const storageClient = (bytes: number): S3Client | null => {
    const secret = mediaSecret.read()?.secretAccessKey
    if (!mediaHost || !secret) return null
    return createS3Client(options.fetch, mediaHost.config, secret, undefined, REDES_REQUEST_TIMEOUT_MS + Math.ceil(bytes / (256 * 1024)) * 1000)
  }
  /** Apaga do armazenamento as imagens que ainda estão lá; devolve as mídias com `s3Key` limpo onde deu certo. */
  const removeFromStorage = async (media: PublicationMedia[]): Promise<PublicationMedia[]> => {
    const client = media.some((item) => item.s3Key) ? storageClient(0) : null
    const out: PublicationMedia[] = []
    for (const item of media) {
      if (!item.s3Key || !client) {
        out.push(item)
        continue
      }
      const removed = await removeMedia(client, item.s3Key)
      out.push(removed.ok ? { ...item, s3Key: null } : item)
    }
    return out
  }

  /**
   * Contrato 72: o contêiner de uma publicação com erro pode ser esquecido (para a edição criar outro)? Sem contêiner, sim;
   * com o id de mídia publicado, não; senão só se a Meta disser `ERROR`, `EXPIRED` ou `FINISHED` (pronto e não
   * publicado). `PUBLISHED`, `IN_PROGRESS` ou a consulta que falha: não (o "Tentar de novo" retoma e, se já saiu, só
   * marca como publicada, sem publicar de novo).
   */
  const containerDiscardable = async (publication: Publication): Promise<boolean> => {
    if (publication.publishedMediaId) return false
    if (!publication.creationId) return true
    const token = readTokens().tokens[publication.accountId]?.token
    if (!token) return false
    const result = await client.containerStatus(token, publication.creationId).catch(() => null)
    return result !== null && result.ok && (result.statusCode === 'ERROR' || result.statusCode === 'EXPIRED' || result.statusCode === 'FINISHED')
  }

  /** Rascunho, agendada ou (contrato 72) com erro: o "Editar" da fila abre as três. */
  const editable = (publication: Publication): boolean => publication.state === 'rascunho' || publication.state === 'agendada' || publication.state === 'erro'

  const savePublication = async (request: unknown, options: { draftWithoutMedia?: boolean; newId?: string } = {}): Promise<PublicationSaveResult> => {
    const parsed = saveRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, problems: ['Confira os campos da publicação'] }
    const input = parsed.data
    if (!accounts.has(input.accountId)) return { ok: false, problems: [REDES_ACCOUNT_MISSING_MESSAGE] }
    const existing = input.id ? findPublication(input.id) : undefined
    if (input.id && (!existing || existing.accountId !== input.accountId)) return { ok: false, problems: [PUBLICATION_MISSING_MESSAGE] }
    if (existing && !editable(existing)) return { ok: false, problems: [PUBLICATION_NOT_EDITABLE_MESSAGE] }
    // Contrato 72: a com erro só é editada (e o contêiner dela esquecido) se ele não saiu no Instagram.
    if (existing?.state === 'erro' && !(await containerDiscardable(existing))) return { ok: false, problems: [PUBLICATION_MAYBE_OUT_MESSAGE] }
    // Contrato 76: o id do rascunho novo escolhido pelo cartão do Assistente (nunca o de uma publicação que já existe).
    if (!existing && options.newId !== undefined && (!PUBLICATION_ID_PATTERN.test(options.newId) || findPublication(options.newId))) return { ok: false, problems: [PUBLICATION_ID_TAKEN_MESSAGE] }
    const publicationId = existing?.id ?? options.newId ?? randomUUID()

    // A mídia já salva vem pelo `localPath` da cópia; a nova é conferida pelos bytes.
    const problems: string[] = []
    const items: ({ saved: PublicationMedia } | { candidate: MediaCandidate })[] = []
    for (const path of input.mediaPaths) {
      const saved = existing?.media.find((item) => item.localPath === path)
      if (saved) {
        items.push({ saved })
        continue
      }
      const candidate = await inspectFile(path)
      if (!candidate.ok) problems.push(...candidate.problems.map((problem) => `${candidate.fileName}: ${problem}`))
      items.push({ candidate })
    }
    const kinds = items.map((item) => ('saved' in item ? { kind: item.saved.kind } : { kind: item.candidate.kind ?? 'imagem' }))
    // Contrato 76: o rascunho do Assistente sem mídia fica como imagem até a mídia entrar no editor (o tipo é refeito ao salvar).
    const emptyAllowed = options.draftWithoutMedia === true || (existing?.state === 'rascunho' && existing.media.length === 0)
    const type = emptyAllowed && !kinds.length ? 'imagem' : inferPublicationType(kinds)
    if (typeof type !== 'string') problems.push(type.error)
    problems.push(...captionStats(input.caption).problems)
    if (problems.length || typeof type !== 'string') return { ok: false, problems: problems.length ? problems : ['Confira as mídias'] }

    const media: PublicationMedia[] = []
    const copied: string[] = []
    try {
      for (const item of items) {
        if ('saved' in item) {
          const altText = item.saved.kind === 'imagem' ? (input.altTexts[item.saved.localPath] ?? item.saved.altText) : ''
          media.push({ ...item.saved, altText: altText.trim() })
          continue
        }
        const { candidate } = item
        const id = randomUUID()
        const mimeType = candidate.mimeType as PublicationMedia['mimeType']
        const dir = await store.mediaDir(publicationId, true)
        const localPath = join(dir, `${id}.${EXTENSION[mimeType]}`)
        await copyFile(candidate.path, localPath)
        await chmod(localPath, 0o600)
        copied.push(localPath)
        media.push({
          id,
          kind: candidate.kind ?? 'imagem',
          fileName: candidate.fileName,
          mimeType,
          bytes: candidate.bytes,
          width: candidate.width ?? 0,
          height: candidate.height ?? 0,
          durationSeconds: candidate.durationSeconds,
          altText: candidate.kind === 'imagem' ? (input.altTexts[candidate.path] ?? '').trim() : '',
          localPath,
          s3Key: null,
          containerId: null,
        })
      }
    } catch {
      for (const path of copied) await rm(path, { force: true }).catch(() => undefined)
      return { ok: false, problems: [PUBLICATION_SAVE_FAILED] }
    }
    // Relida depois dos `await` (conferir e copiar): se o agendador começou a publicar nesse meio-tempo, a edição não
    // vale e nada da publicação é apagado (só as cópias novas desta edição).
    if (existing) {
      const current = findPublication(existing.id)
      if (!current || !editable(current)) {
        for (const path of copied) await rm(path, { force: true }).catch(() => undefined)
        return { ok: false, problems: [current ? PUBLICATION_STARTED_MESSAGE : PUBLICATION_MISSING_MESSAGE] }
      }
    }
    // As cópias que saíram da publicação.
    for (const old of existing?.media ?? []) if (!media.some((item) => item.id === old.id)) await rm(old.localPath, { force: true }).catch(() => undefined)
    // Contrato 72: a com erro editada volta a rascunho sem nada da tentativa: as imagens saem do armazenamento (a que não
    // sair fica com a chave, e a próxima publicação a sobrescreve e apaga) e os contêineres dos itens são refeitos.
    if (existing?.state === 'erro') {
      const cleared = await removeFromStorage(media).catch(() => media)
      for (const [index, item] of cleared.entries()) media[index] = { ...item, containerId: null }
    }

    const at = iso(now())
    // Salvar sempre deixa rascunho: "Agendar" é outro passo, com o token de clique (a agendada editada volta a rascunho).
    const publication: Publication = {
      id: publicationId,
      accountId: input.accountId,
      type,
      media,
      caption: input.caption,
      scheduledAt: input.scheduledAt ? iso(Date.parse(input.scheduledAt)) : null,
      state: 'rascunho',
      error: null,
      attempts: existing?.attempts ?? 0,
      creationId: null,
      publishedMediaId: null,
      permalink: null,
      publishedAt: null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    }
    return { ok: true, publication: await putPublication(publication) }
  }

  /** A conta saiu ("Remover") no meio da tentativa: nada mais é gravado nem pedido. */
  class AccountGone extends Error {}

  /**
   * Contrato 72: a publicação do "Publicar agora" ou do "Agendar", já com o token gasto: a edição da tela salva aqui
   * (`save`, com a conferência da Meta e a limpeza do armazenamento da com erro) ou a da fila, pelo `id`.
   */
  const clickTarget = async (request: { id?: string | undefined; save?: unknown }): Promise<{ ok: true; publication: Publication; saved: boolean } | { ok: false; error: string; problems?: string[] }> => {
    if (request.save !== undefined) {
      const result = await savePublication(request.save)
      return result.ok ? { ok: true, publication: result.publication, saved: true } : { ok: false, error: result.problems.join('. '), problems: result.problems }
    }
    const publication = request.id ? findPublication(request.id) : undefined
    return publication ? { ok: true, publication, saved: false } : { ok: false, error: PUBLICATION_MISSING_MESSAGE }
  }
  /** Por que esta não pode ser publicada nem agendada agora (`null`: pode). */
  const notStartable = (publication: Publication): string | null =>
    publication.state === 'erro'
      ? PUBLICATION_ERROR_STATE_MESSAGE
      : publication.state !== 'rascunho' && publication.state !== 'agendada'
        ? PUBLICATION_NOT_EDITABLE_MESSAGE
        : // Contrato 76: o rascunho do Assistente sem mídia.
          !publication.media.length
          ? PUBLICATION_NO_MEDIA_MESSAGE
          : null

  /** Uma tentativa inteira de uma publicação em `publicando`; termina sempre gravada (`publicada`, `erro` ou adiada). */
  const attempt = async (id: string): Promise<void> => {
    try {
      await attemptSteps(id)
    } catch (error) {
      if (!(error instanceof AccountGone)) throw error
    }
  }

  const attemptSteps = async (id: string): Promise<void> => {
    let publication = findPublication(id)
    if (!publication || publication.state !== 'publicando') return
    const accountId = publication.accountId
    const save = async (next: Publication): Promise<Publication> => {
      if (!accounts.has(accountId)) throw new AccountGone()
      return putPublication(next)
    }
    const fail = async (error: string): Promise<void> => {
      if (publication && accounts.has(accountId)) await putPublication({ ...publication, state: 'erro', error })
    }
    const account = accounts.get(publication.accountId)
    const token = readTokens().tokens[publication.accountId]?.token
    if (!account || !token || account.state === 'expirada') return fail(REDES_EXPIRED_MESSAGE)

    // A cota (o que já foi publicado não conta de novo); esgotada adia 1 h, sem gastar tentativa.
    if (!publication.publishedMediaId) {
      const limit = await client.publishingLimit(token, account.id)
      if (limit.ok) {
        const quota = rememberQuota(account.id, limit.quota)
        if (quota.used >= quota.total) {
          await save({ ...publication, state: 'agendada', scheduledAt: iso(now() + QUOTA_POSTPONE_MS), error: QUOTA_POSTPONED_MESSAGE })
          return
        }
      }
    }
    publication = await save({ ...publication, attempts: publication.attempts + 1 })

    // As imagens sobem para o armazenamento (o Instagram busca pela URL pública); o vídeo vai pelo upload da Meta. Com o
    // `publishedMediaId` já gravado, só falta o permalink: nada sobe e o armazenamento não é exigido.
    let s3: S3Client | null = null
    if (publication.type !== 'reels' && !publication.publishedMediaId) {
      s3 = storageClient(Math.max(...publication.media.map((item) => item.bytes)))
      if (!s3) return fail(MEDIA_HOST_REQUIRED_MESSAGE)
      for (const [index, item] of publication.media.entries()) {
        let bytes: Uint8Array
        try {
          bytes = await readFile(item.localPath)
        } catch {
          return fail(PUBLICATION_MEDIA_GONE_MESSAGE)
        }
        const key = safeKey(['instagram', account.id, publication.id, `${item.id}.jpg`])
        const put = await uploadMedia(s3, key, bytes, item.mimeType)
        if (!put.ok) return fail(`Não foi possível subir a imagem: ${put.error}`)
        // Gravada a cada item: no carrossel que para no meio, as que subiram saem do armazenamento depois.
        const current: Publication = publication
        publication = await save({ ...current, media: current.media.map((entry, at) => (at === index ? { ...entry, s3Key: key } : entry)) })
      }
    }

    const client_ = s3
    const result = await publishOnce({
      client,
      token,
      igUserId: account.id,
      publication,
      mediaUrl: (media) => (media.s3Key && client_ ? client_.publicUrl(media.s3Key) : null),
      uploadReel: async (uri, media) => {
        let bytes: Uint8Array
        try {
          bytes = await readFile(media.localPath)
        } catch {
          throw new Error(PUBLICATION_MEDIA_GONE_MESSAGE)
        }
        const sent = await client.uploadResumable(token, uri, bytes)
        if (!sent.ok) throw new Error(sent.error)
      },
      now,
      // A conta que saiu durante a espera do contêiner para a tentativa antes do `media_publish`.
      sleep: async (ms) => {
        await sleep(ms)
        if (!accounts.has(accountId)) throw new AccountGone()
      },
      // Cada passo no arquivo antes do seguinte (o `creationId` antes do `media_publish`).
      onProgress: async (step) => {
        publication = await save({ ...step, state: 'publicando' })
      },
    })
    let final = result.publication
    if (final.state === 'publicada') {
      // Publicada: a imagem sai do armazenamento (a que não saiu fica com o `s3Key`, e o agendador tenta de novo) e a
      // cota em cache conta mais uma.
      final = { ...final, media: await removeFromStorage(final.media) }
      const quota = quotas.get(account.id)
      if (quota) quotas.set(account.id, { ...quota, used: quota.used + 1 })
    }
    await save(final)
  }

  /**
   * Uma publicação por conta por vez; a mesma publicação nunca roda duas vezes ao mesmo tempo. Pedida de novo enquanto a
   * anterior termina (a nova tentativa logo depois de um erro), roda em seguida: a tentativa só faz algo em `publicando`.
   */
  const runPublication = (id: string): Promise<void> => {
    const current = runs.get(id)
    if (current) return current.then(() => runPublication(id))
    const publication = findPublication(id)
    if (!publication) return Promise.resolve()
    const accountId = publication.accountId
    const run = (accountRuns.get(accountId) ?? Promise.resolve())
      .then(() => attempt(id))
      .catch(async () => {
        const failed = findPublication(id)
        if (failed?.state === 'publicando') await putPublication({ ...failed, state: 'erro', error: PUBLICATION_FAILED_MESSAGE }).catch(() => undefined)
      })
      .finally(() => {
        if (runs.get(id) === run) runs.delete(id)
      })
    runs.set(id, run)
    accountRuns.set(accountId, run)
    void run.then(() => {
      if (accountRuns.get(accountId) === run) accountRuns.delete(accountId)
    })
    return run
  }

  // 75: métricas
  // Contrato 75: o período visto por último em cada conta é relido a cada hora (o cache vale 1 h), nunca bloqueado; o
  // mesmo pedido em curso não sai duas vezes.
  const metricsSeen = new Map<string, MetricPeriod>()
  const metricsRuns = new Map<string, Promise<RedesMetricsState>>()
  let metricsTimer: ReturnType<typeof setInterval> | null = null
  const metricsRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN), period: z.literal(METRIC_PERIODS) })
  // A miniatura de cada mídia vai para `thumbs/`, a mesma pasta dos comentários (e a tela pede pelo mesmo canal).
  const saveThumb = createThumbSaver(options.fetch, store)
  const noMetrics = (accountId: string, error: string): RedesMetricsState => ({ accountId, account: { 7: null, 28: null, 90: null }, media: [], error, updatedAt: null })
  const runMetrics = (accountId: string, period: MetricPeriod, force: boolean): Promise<RedesMetricsState> => {
    const account = accounts.get(accountId)
    if (!account) return Promise.resolve(noMetrics(accountId, REDES_ACCOUNT_MISSING_MESSAGE))
    const key = `${accountId}:${period}:${force ? 'f' : 'c'}`
    const running = metricsRuns.get(key)
    if (running) return running
    const token = readTokens().tokens[accountId]?.token
    const run = (async (): Promise<RedesMetricsState> => {
      // Sem token (ou vencido): o que já estava no cache, com o aviso.
      if (!token || account.state === 'expirada') return metricsStateOf(accountId, await readMetricsCache(store, accountId), REDES_EXPIRED_MESSAGE)
      return loadMetrics(client, token, account, period, store, now, { force, saveThumb })
    })()
      .then((state) => {
        if (!disposed && accounts.has(accountId)) options.onMetrics?.(state)
        return state
      })
      .finally(() => {
        if (metricsRuns.get(key) === run) metricsRuns.delete(key)
      })
    metricsRuns.set(key, run)
    return run
  }
  // O tick lê da Meta sem olhar o cache: com o cache de 1 h e o tick de 1 h, o "ainda vale" por milissegundos pularia
  // uma volta inteira.
  const metricsTick = async (): Promise<void> => {
    if (disposed || options.isLocked?.()) return
    for (const [accountId, period] of [...metricsSeen]) if (accounts.has(accountId)) await runMetrics(accountId, period, true).catch(() => undefined)
  }
  const metricsRequest = (request: unknown, force: boolean): Promise<RedesMetricsState> => {
    const parsed = metricsRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.resolve(noMetrics('', REDES_ACCOUNT_MISSING_MESSAGE))
    const { accountId, period } = parsed.data
    if (accounts.has(accountId)) metricsSeen.set(accountId, period)
    return runMetrics(accountId, period, force)
  }
  // fim 75

  // 73/74: polling
  // Contratos 73 e 74: comentários e mensagens são lidos a cada `redesPollMinutes` por um timer só (`unref`, relido a
  // cada volta para valer a mudança nas Configurações), nunca com o app bloqueado. Cada contrato põe a sua leitura em
  // `pollers` (recebe as contas conectadas com token válido), uma depois da outra.
  const pollers: ((accountIds: string[]) => Promise<void>)[] = []
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  const poll = async (): Promise<void> => {
    if (disposed || options.isLocked?.()) return
    const ids = [...accounts.values()].filter((account) => account.state !== 'expirada').map((account) => account.id)
    if (!ids.length) return
    for (const poller of pollers) await poller(ids).catch(() => undefined)
  }
  const schedulePoll = async (): Promise<void> => {
    const raw = await Promise.resolve(options.pollMinutes?.() ?? REDES_POLL_MINUTES_DEFAULT).catch(() => REDES_POLL_MINUTES_DEFAULT)
    const minutes = Number.isFinite(raw) && raw >= 1 && raw <= 60 ? raw : REDES_POLL_MINUTES_DEFAULT
    if (disposed) return
    pollTimer = setTimeout(() => void poll().finally(() => void schedulePoll()), minutes * 60_000)
    pollTimer.unref()
  }
  // fim 73/74

  // 73: comentários
  pollers.push(async (accountIds) => {
    for (const accountId of accountIds) await syncAccountComments(accountId).catch(() => undefined)
  })
  // fim 73

  // 74: mensagens
  // Contrato 74: as mensagens diretas (`messages.ts`), no mesmo timer dos comentários; o "Enviar" gasta o mesmo token de
  // clique das redes (`scribe:redes-click`).
  const messages = createMessagesService({
    client,
    store,
    now,
    account: (accountId) => {
      const account = accounts.get(accountId)
      return account ? { id: account.id, username: account.username } : null
    },
    token: (accountId) => readTokens().tokens[accountId]?.token ?? null,
    onChange: (payload) => {
      if (!disposed) options.onMessages?.(payload)
    },
    consumeClick: (senderId, token) => guard.consume(senderId, token),
  })
  pollers.push((accountIds) => messages.syncAll(accountIds))
  // fim 74

  // 73: comentários
  // Contrato 73: os comentários de cada conta em memória (o mesmo do arquivo) e a leitura em curso de cada conta (o
  // "Atualizar" no meio do polling espera a mesma). O polling é o dos contratos 73 e 74 (`pollers`, mais acima).
  const commentFiles = new Map<string, CommentsFile>()
  const commentRuns = new Map<string, Promise<RedesCommentsPayload>>()
  const commentThumbsRoot = resolve(options.userData, REDES_DIR, COMMENT_THUMBS_DIR)
  const commentIdSchema = z.string().regex(/^\d{1,40}$/)
  const commentRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN), commentId: commentIdSchema })
  const replyRequestSchema = commentRequestSchema.extend({ message: z.string().max(COMMENT_REPLY_MAX * 4) })
  const hideRequestSchema = commentRequestSchema.extend({ hide: z.boolean() })
  const mediaReadSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN), mediaId: commentIdSchema })

  const noComments = (accountId: string, error: string | null): RedesCommentsPayload => ({ accountId, media: [], unread: 0, updatedAt: null, error })
  const commentsOf = async (accountId: string): Promise<CommentsFile> => {
    const cached = commentFiles.get(accountId)
    if (cached) return cached
    const file = await readComments(store, accountId)
    if (accounts.has(accountId)) commentFiles.set(accountId, file)
    return file
  }
  /** Guarda o arquivo como ficou e avisa a tela; a conta que saiu no meio não volta por aqui. */
  const keepComments = (accountId: string, file: CommentsFile): RedesCommentsPayload => {
    const payload = commentsPayload(accountId, file)
    if (!accounts.has(accountId)) return payload
    commentFiles.set(accountId, file)
    if (!disposed) options.onComments?.(payload)
    return payload
  }
  const syncAccountComments = (accountId: string): Promise<RedesCommentsPayload> => {
    const running = commentRuns.get(accountId)
    if (running) return running
    const run = (async (): Promise<RedesCommentsPayload> => {
      const account = accounts.get(accountId)
      if (!account) return noComments(accountId, REDES_ACCOUNT_MISSING_MESSAGE)
      const token = readTokens().tokens[accountId]?.token
      // Sem token (ou vencido): o que já estava, com o aviso.
      if (!token || account.state === 'expirada') return keepComments(accountId, await updateComments(store, accountId, (file) => ({ ...file, error: REDES_EXPIRED_MESSAGE })))
      const result = await syncComments(client, token, account, store, now(), { fetch: options.fetch })
      return keepComments(accountId, result.file)
    })().finally(() => {
      if (commentRuns.get(accountId) === run) commentRuns.delete(accountId)
    })
    commentRuns.set(accountId, run)
    return run
  }
  /** O token da conta, ou a razão de não ter. */
  const commentToken = (accountId: string): { account: RedesAccount; token: string } | { error: string } => {
    const account = accounts.get(accountId)
    if (!account) return { error: REDES_ACCOUNT_MISSING_MESSAGE }
    const token = readTokens().tokens[accountId]?.token
    return token && account.state !== 'expirada' ? { account, token } : { error: REDES_EXPIRED_MESSAGE }
  }
  // Responder e excluir só com o token de clique da mesma janela (gasto mesmo com o resto inválido); ocultar não.
  const replyComment = async (senderId: number, request: unknown): Promise<RedesCommentReplyResult> => {
    if (!guard.consume(senderId, ((request ?? {}) as { clickToken?: unknown }).clickToken)) return { ok: false, error: REDES_COMMENT_CLICK_MESSAGE }
    const parsed = replyRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    const { accountId, commentId } = parsed.data
    const message = parsed.data.message.trim()
    if (!message) return { ok: false, error: COMMENT_EMPTY_MESSAGE }
    if ([...message].length > COMMENT_REPLY_MAX) return { ok: false, error: COMMENT_TOO_LONG_MESSAGE }
    const auth = commentToken(accountId)
    if ('error' in auth) return { ok: false, error: auth.error }
    const found = findComment(await commentsOf(accountId), commentId)
    if (!found) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    // O Instagram só aceita resposta a um comentário: a de uma resposta vai ao de cima.
    const result = await client.replyComment(auth.token, found.top.id, message)
    if (!result.ok) return { ok: false, error: result.error }
    const reply: RedesComment = { id: result.id, mediaId: found.media.mediaId, parentId: found.top.id, text: message, username: auth.account.username, fromId: auth.account.id, timestamp: iso(now()), hidden: false, likeCount: 0, read: true, replies: [] }
    const file = await updateComments(store, accountId, (current) => addReply(current, found.top.id, reply))
    return { ok: true, comment: reply, payload: keepComments(accountId, file) }
  }
  const hideComment = async (request: unknown): Promise<RedesCommentActionResult> => {
    const parsed = hideRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    const { accountId, commentId, hide } = parsed.data
    const auth = commentToken(accountId)
    if ('error' in auth) return { ok: false, error: auth.error }
    if (!findComment(await commentsOf(accountId), commentId)) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    const result = await client.hideComment(auth.token, commentId, hide)
    if (!result.ok) return { ok: false, error: result.error }
    const file = await updateComments(store, accountId, (current) => changeComment(current, commentId, (comment) => ({ ...comment, hidden: hide })))
    return { ok: true, payload: keepComments(accountId, file) }
  }
  const deleteComment = async (senderId: number, request: unknown): Promise<RedesCommentActionResult> => {
    if (!guard.consume(senderId, ((request ?? {}) as { clickToken?: unknown }).clickToken)) return { ok: false, error: REDES_COMMENT_CLICK_MESSAGE }
    const parsed = commentRequestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    const { accountId, commentId } = parsed.data
    const auth = commentToken(accountId)
    if ('error' in auth) return { ok: false, error: auth.error }
    if (!findComment(await commentsOf(accountId), commentId)) return { ok: false, error: COMMENT_MISSING_MESSAGE }
    const result = await client.deleteComment(auth.token, commentId)
    if (!result.ok) return { ok: false, error: result.error }
    const file = await updateComments(store, accountId, (current) => changeComment(current, commentId, () => null))
    return { ok: true, payload: keepComments(accountId, file) }
  }
  // fim 73

  /** O agendador: nada com o app bloqueado (CA15). Espera as publicações que começou (o smoke confere em seguida). */
  const tick = async (): Promise<void> => {
    if (disposed || options.isLocked?.()) return
    const at = now()
    const started: Promise<void>[] = []
    const ids = [...queues.values()].flatMap((queue) => queue.map((item) => item.id))
    for (const id of ids) {
      // Relida a cada passo: entre um `await` e outro a pessoa pode ter mudado (voltado a rascunho, apagado).
      const publication = findPublication(id)
      if (!publication) continue
      if (publication.state === 'agendada' && publication.scheduledAt && Date.parse(publication.scheduledAt) <= at) {
        await putPublication({ ...publication, state: 'publicando', error: null })
        started.push(runPublication(publication.id))
      } else if (publication.state === 'publicando' && !runs.has(publication.id)) {
        // Ficou no meio (o app fechou): retoma pelo que está gravado.
        started.push(runPublication(publication.id))
      } else if (publication.media.some((item) => item.s3Key) && (publication.state === 'publicada' || (publication.state === 'erro' && Date.parse(publication.updatedAt) + MEDIA_CLEANUP_AFTER_ERROR_MS <= at))) {
        // A imagem que ficou no armazenamento: da publicada (o DELETE falhou) já, da com erro 48 h depois. Só grava o
        // que saiu (a falha tenta de novo no próximo tick).
        const media = await removeFromStorage(publication.media)
        const current = findPublication(id)
        if (current?.state === publication.state && media.some((item, index) => item.s3Key !== publication.media[index]?.s3Key)) await putPublication({ ...current, media })
      }
    }
    await Promise.all(started)
  }

  return {
    async init() {
      const [stored, host] = await Promise.all([store.listAccounts(), store.readMediaHost()])
      accounts.clear()
      // A conta sem token no cofre (cofre apagado, outro Mac) já nasce pedindo um token novo.
      const vault = readTokens()
      for (const account of stored) accounts.set(account.id, vault.tokens[account.id] ? account : { ...account, state: 'expirada', error: REDES_EXPIRED_MESSAGE })
      mediaHost = host
      // Contrato 71: a fila de cada conta; o que ficou em `publicando` (o app fechou no meio) o primeiro tick retoma.
      queues.clear()
      for (const account of stored) queues.set(account.id, await store.readPublications(account.id))
      // 74: mensagens
      await messages.init(stored.map((account) => account.id))
      // fim 74
      emit()
      for (const id of queues.keys()) emitPublications(id)
      void refreshDue()
      if (!timer && !disposed) {
        timer = setInterval(() => void refreshDue(), REDES_REFRESH_INTERVAL_MS)
        timer.unref()
      }
      if (!publishTimer && !disposed) {
        publishTimer = setInterval(() => void tick().catch(() => undefined), PUBLISH_TICK_MS)
        publishTimer.unref()
      }
      // 75: métricas
      if (!metricsTimer && !disposed) {
        metricsTimer = setInterval(() => void metricsTick().catch(() => undefined), METRICS_CACHE_MS)
        metricsTimer.unref()
      }
      // fim 75
      // 73/74: polling
      if (!pollTimer && !disposed) void schedulePoll()
      void poll()
      // fim 73/74
      // 73: comentários
      // Os comentários guardados vão à tela (o número do nível); a leitura da API sai no polling (73/74).
      commentFiles.clear()
      for (const account of stored) commentFiles.set(account.id, await readComments(store, account.id))
      for (const [id, file] of commentFiles) if (!disposed) options.onComments?.(commentsPayload(id, file))
      // fim 73
      void tick().catch(() => undefined)
    },

    state,

    connect(request) {
      const parsed = connectRequestSchema.safeParse(request)
      const token = redesTokenSchema.safeParse(parsed.success ? parsed.data.token : null)
      if (!token.success) return Promise.resolve({ ok: false, error: REDES_INVALID_TOKEN_MESSAGE })
      return serial(async (): Promise<RedesConnectResult> => {
        const result = await client.me(token.data)
        if (!result.ok) return { ok: false, error: result.error }
        const at = now()
        const expiresAt = at + INSTAGRAM_TOKEN_TTL_DAYS * DAY_MS
        const account = fromProfile(result.profile, accounts.get(result.profile.userId), at, expiresAt)
        try {
          writeToken(account.id, { token: token.data, tokenExpiresAt: account.tokenExpiresAt, refreshedAt: account.refreshedAt })
        } catch (error) {
          if (error instanceof EncryptionUnavailableError) return { ok: false, error: REDES_VAULT_MESSAGE }
          throw error
        }
        await save(account)
        emit()
        return { ok: true, account: { ...account } }
      })
    },

    refresh(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return Promise.resolve({ ok: false, error: REDES_ACCOUNT_MISSING_MESSAGE })
      return serial(async () => {
        const result = await refreshAccount(parsed.data.accountId, true)
        emit()
        return result
      })
    },

    refreshDue,

    remove(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return Promise.resolve({ ok: false })
      return serial(async () => {
        const id = parsed.data.accountId
        if (!accounts.has(id)) return { ok: false }
        writeToken(id, null)
        // Contrato 71: a conta sai primeiro (a publicação em curso para de gravar e de pedir), depois a fila (as cópias
        // das mídias e, se der, as imagens que ainda estão no armazenamento).
        accounts.delete(id)
        const queue = queues.get(id) ?? []
        queues.delete(id)
        quotas.delete(id)
        await removeFromStorage(queue.flatMap((publication) => publication.media)).catch(() => undefined)
        for (const publication of queue) await store.removeMediaDir(publication.id).catch(() => undefined)
        // 74: mensagens
        await messages.remove(id).catch(() => undefined)
        // fim 74
        await store.removeAccount(id)
        // 73: comentários
        // Depois do arquivo da conta: uma gravação dos comentários que estava na fila não volta a criar o arquivo.
        const commentsGone = commentFiles.get(id) ?? (await readComments(store, id).catch(() => null))
        commentFiles.delete(id)
        await store.removeComments(id).catch(() => undefined)
        for (const path of commentsGone ? thumbPaths(commentsGone) : []) if (resolve(path).startsWith(commentThumbsRoot + sep)) await rm(path, { force: true }).catch(() => undefined)
        // fim 73
        // 75: métricas
        // Também depois do arquivo da conta (a leitura em curso não recria o cache); com ele, as miniaturas que as
        // métricas baixaram (registradas no cache, inclusive as que saíram das 25).
        metricsSeen.delete(id)
        const metricsGone = await readMetricsCache(store, id).catch(() => null)
        await store.removeMetrics(id).catch(() => undefined)
        for (const path of metricsGone?.thumbs ?? []) if (resolve(path).startsWith(commentThumbsRoot + sep)) await rm(path, { force: true }).catch(() => undefined)
        // fim 75
        emit()
        return { ok: true }
      })
    },

    mediaHostSave(request) {
      const parsed = mediaHostSaveSchema.safeParse(request)
      if (!parsed.success) return Promise.resolve({ ok: false, error: mediaHostSchemaProblem(parsed.error), status: mediaHostStatus() })
      return serial(async (): Promise<MediaHostSaveResult> => {
        const config: MediaHostConfig = parsed.data.config
        const secret = parsed.data.secretAccessKey
        // Recusada antes de gravar qualquer coisa: o endereço fora de https, o campo vazio, a chave secreta que falta.
        const problem = mediaHostConfigProblem(config) ?? (!secret && mediaSecret.read() === null ? MEDIA_HOST_SECRET_MISSING : null)
        if (problem) return { ok: false, error: problem, status: mediaHostStatus() }
        try {
          if (secret) mediaSecret.write({ secretAccessKey: secret })
        } catch (error) {
          if (error instanceof EncryptionUnavailableError) return { ok: false, error: MEDIA_HOST_VAULT_MESSAGE, status: mediaHostStatus() }
          throw error
        }
        // Configuração nova: o teste anterior não vale mais.
        const same = mediaHost !== null && JSON.stringify(mediaHost.config) === JSON.stringify(config) && !secret
        const next: StoredMediaHost = { config, lastTest: same ? (mediaHost?.lastTest ?? null) : null }
        await store.writeMediaHost(next)
        mediaHost = next
        emit()
        return { ok: true, status: mediaHostStatus() }
      })
    },

    mediaHostTest() {
      return serial(async () => {
        if (!mediaHost) return mediaHostStatus()
        const secret = mediaSecret.read()?.secretAccessKey
        let result: { ok: boolean; detail: string }
        if (!secret) result = { ok: false, detail: MEDIA_HOST_NOT_READY_DETAIL }
        else {
          try {
            result = await options.testMediaHost(mediaHost.config, secret, options.fetch)
          } catch {
            result = { ok: false, detail: MEDIA_HOST_TEST_FAILED_DETAIL }
          }
        }
        // O detalhe vai à tela e ao disco: nunca a chave (o testador do contrato 70 não a põe; aqui, por garantia).
        const detail = (secret ? result.detail.split(secret).join('•••') : result.detail).slice(0, 500)
        const next: StoredMediaHost = { config: mediaHost.config, lastTest: { ok: result.ok, detail, at: iso(now()) } }
        await store.writeMediaHost(next)
        mediaHost = next
        emit()
        return mediaHostStatus()
      })
    },

    mediaHostClear() {
      return serial(async () => {
        mediaSecret.remove()
        await store.removeMediaHost()
        mediaHost = null
        emit()
        return mediaHostStatus()
      })
    },

    publications(request) {
      const parsed = accountRequestSchema.safeParse(request)
      return Promise.resolve(parsed.success ? payloadOf(parsed.data.accountId) : { accountId: '', publications: [], quota: null })
    },

    async pickMedia() {
      const paths = options.pickFiles ? await options.pickFiles() : []
      const candidates: MediaCandidate[] = []
      for (const path of paths.slice(0, 50)) {
        picked.add(path)
        candidates.push(await inspectFile(path))
      }
      return candidates
    },

    savePublication,

    async deletePublication(request) {
      const parsed = publicationRequestSchema.safeParse(request)
      const publication = parsed.success ? findPublication(parsed.data.id) : undefined
      if (!publication) return { ok: false, error: PUBLICATION_MISSING_MESSAGE }
      // Fora de `publicando`, a tentativa (se ainda está terminando) já fez a última gravação.
      if (publication.state === 'publicando') return { ok: false, error: PUBLICATION_BUSY_MESSAGE }
      const queue = (queues.get(publication.accountId) ?? []).filter((item) => item.id !== publication.id)
      queues.set(publication.accountId, queue)
      await store.writePublications(publication.accountId, queue)
      emitPublications(publication.accountId)
      await removeFromStorage(publication.media).catch(() => undefined)
      await store.removeMediaDir(publication.id).catch(() => undefined)
      return { ok: true }
    },

    async schedulePublication(senderId, request) {
      // O token é gasto mesmo com o resto inválido: não serve para uma segunda tentativa.
      if (!guard.consume(senderId, ((request ?? {}) as { clickToken?: unknown }).clickToken)) return { ok: false, error: REDES_CLICK_MESSAGE }
      const parsed = scheduleRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: PUBLICATION_MISSING_MESSAGE }
      const at = Date.parse(parsed.data.at)
      // A hora antes de salvar: no passado, nada muda.
      if (!(at > now())) return { ok: false, error: PUBLICATION_PAST_MESSAGE }
      const target = await clickTarget(parsed.data)
      if (!target.ok) return target
      const { publication, saved } = target
      const refused = notStartable(publication)
      if (refused) return { ok: false, error: refused, ...(saved ? { saved: publication } : {}) }
      return { ok: true, publication: await putPublication({ ...publication, state: 'agendada', scheduledAt: iso(at), error: null }) }
    },

    async publishNow(senderId, request) {
      if (!guard.consume(senderId, ((request ?? {}) as { clickToken?: unknown }).clickToken)) return { ok: false, error: REDES_CLICK_MESSAGE }
      const parsed = publishRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, error: PUBLICATION_MISSING_MESSAGE }
      const target = await clickTarget(parsed.data)
      if (!target.ok) return target
      const { publication, saved } = target
      const refused = notStartable(publication)
      if (refused) return { ok: false, error: refused, ...(saved ? { saved: publication } : {}) }
      const started = await putPublication({ ...publication, state: 'publicando', error: null })
      void runPublication(started.id)
      return { ok: true, publication: started }
    },

    async unschedule(request) {
      const parsed = publicationRequestSchema.safeParse(request)
      const publication = parsed.success ? findPublication(parsed.data.id) : undefined
      if (!publication) return { ok: false, error: PUBLICATION_MISSING_MESSAGE }
      if (publication.state !== 'agendada') return { ok: false, error: 'Só publicação agendada pode voltar a rascunho' }
      return { ok: true, publication: await putPublication({ ...publication, state: 'rascunho', error: null }) }
    },

    async retry(request) {
      const parsed = publicationRequestSchema.safeParse(request)
      const publication = parsed.success ? findPublication(parsed.data.id) : undefined
      if (!publication) return { ok: false, error: PUBLICATION_MISSING_MESSAGE }
      if (publication.state !== 'erro') return { ok: false, error: 'Só publicação com erro pode ser tentada de novo' }
      const started = await putPublication({ ...publication, state: 'publicando', error: null })
      void runPublication(started.id)
      return { ok: true, publication: started }
    },

    async quota(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success || !accounts.has(parsed.data.accountId)) return { ok: false, error: REDES_ACCOUNT_MISSING_MESSAGE }
      const accountId = parsed.data.accountId
      const cached = quotas.get(accountId)
      if (cached && now() - Date.parse(cached.checkedAt) < QUOTA_CACHE_MS) return { ok: true, quota: { ...cached } }
      const token = readTokens().tokens[accountId]?.token
      if (!token) return { ok: false, error: REDES_EXPIRED_MESSAGE }
      const result = await client.publishingLimit(token, accountId)
      if (!result.ok) return { ok: false, error: result.error }
      const quota = rememberQuota(accountId, result.quota)
      emitPublications(accountId)
      return { ok: true, quota: { ...quota } }
    },

    hasPublication: (id) => findPublication(id) !== undefined,

    async cachedMetrics(accountId) {
      return metricsStateOf(accountId, await readMetricsCache(store, accountId))
    },

    async thumbnail(request) {
      const parsed = z.object({ path: z.string().min(1).max(4096) }).safeParse(request)
      if (!parsed.success || !options.thumbnail) return null
      const { path } = parsed.data
      // 73: comentários
      // A miniatura de uma mídia com comentário, baixada pela atualização (`thumbs/<mídia>.jpg`).
      if (resolve(path).startsWith(commentThumbsRoot + sep) && /^\d{1,40}\.jpg$/.test(basename(path))) return options.thumbnail(path).catch(() => null)
      // fim 73
      const saved = resolve(path).startsWith(mediaRoot + sep)
      if (!saved && !picked.has(path)) return null
      if (!/\.jpe?g$/i.test(path)) return null
      return options.thumbnail(path).catch(() => null)
    },

    // 75: métricas
    metricsState: (request) => metricsRequest(request, false),
    refreshMetrics: (request) => metricsRequest(request, true),
    // fim 75

    // 73/74: polling
    poll,
    // fim 73/74

    // 74: mensagens
    messagesState: (request) => messages.state(request),
    refreshMessages: (request) => messages.refresh(request),
    sendMessage: (senderId, request) => messages.send(senderId, request),
    markConversationRead: (request) => messages.markRead(request),
    messagesPayloads: () => messages.payloads(),
    // fim 74

    // 73: comentários
    async commentsState(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success || !accounts.has(parsed.data.accountId)) return noComments(parsed.success ? parsed.data.accountId : '', REDES_ACCOUNT_MISSING_MESSAGE)
      return commentsPayload(parsed.data.accountId, await commentsOf(parsed.data.accountId))
    },

    refreshComments(request) {
      const parsed = accountRequestSchema.safeParse(request)
      if (!parsed.success) return Promise.resolve(noComments('', REDES_ACCOUNT_MISSING_MESSAGE))
      return syncAccountComments(parsed.data.accountId)
    },

    replyComment,
    hideComment,
    deleteComment,

    async markCommentsRead(request) {
      const parsed = mediaReadSchema.safeParse(request)
      if (!parsed.success || !accounts.has(parsed.data.accountId)) return noComments(parsed.success ? parsed.data.accountId : '', REDES_ACCOUNT_MISSING_MESSAGE)
      const { accountId, mediaId } = parsed.data
      return keepComments(accountId, await markRead(store, accountId, mediaId))
    },
    // fim 73

    registerClick(senderId, token) {
      guard.register(senderId, token)
    },

    forgetSender(senderId) {
      guard.forget(senderId)
    },

    tick,

    dispose() {
      disposed = true
      if (timer) clearInterval(timer)
      timer = null
      if (publishTimer) clearInterval(publishTimer)
      publishTimer = null
      // 73/74: polling
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      // fim 73/74
      // 75: métricas
      if (metricsTimer) clearInterval(metricsTimer)
      metricsTimer = null
      // fim 75
    },
  }
}
