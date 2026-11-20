// Serviço das redes no main (contrato 69, R1–R3 e R10 da spec redes-instagram): as contas do Instagram conectadas por
// token colado e o armazenamento de mídia. O token de cada conta e a chave secreta do armazenamento ficam no cofre
// (`accounts/instagram.bin` e `accounts/media-host.bin`, `safeStorage`); o perfil em cache e a configuração sem segredo,
// em `userData/redes/` (`store.ts`). Nada que sai daqui (`state()`, os resultados e o `onState`) leva token ou segredo:
// `MediaHostStatus.secretSet` é só um booleano.
//
// Renovação (R2, CA3): ao abrir o app e a cada 24 h, o token com 7 dias ou mais (e ainda válido) é renovado por mais 60;
// o que já venceu vira `expirada` sem chamar a API. A Meta só renova token com mais de 24 h: o "Renovar agora" antes
// disso não chama a API (uma recusa ali poderia ser lida como token vencido).
import { join } from 'node:path'
import { z } from 'zod'
import { ACCOUNTS_DIR, createVault } from '../accounts/vault'
import type { HttpFetch } from '../accounts/http'
import { EncryptionUnavailableError, type SafeStorageLike } from '../secrets'
import { MEDIA_HOST_FIELDS } from '../../shared/settings-index'
import {
  EMPTY_MEDIA_HOST_STATUS,
  INSTAGRAM_REFRESH_AFTER_DAYS,
  INSTAGRAM_REFRESH_MIN_AGE_HOURS,
  INSTAGRAM_TOKEN_TTL_DAYS,
  mediaHostConfigSchema,
  REDES_ACCOUNT_ID_PATTERN,
  REDES_TOKEN_MAX,
  redesTokenSchema,
  type MediaHostConfig,
  type MediaHostSaveResult,
  type MediaHostStatus,
  type RedesAccount,
  type RedesConnectResult,
  type RedesState,
} from '../../shared/redes'
import { createInstagramClient, type InstagramProfile } from './instagram-client'
import { mediaHostConfigProblem, type MediaHostTester } from './media-host'
import { createRedesStore, REDES_DIR, type StoredMediaHost } from './store'

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

const connectRequestSchema = z.object({ token: z.string().max(REDES_TOKEN_MAX * 2) })
const accountRequestSchema = z.object({ accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN) })
const mediaHostSaveSchema = z.object({ config: mediaHostConfigSchema, secretAccessKey: z.string().trim().max(1024).nullable() })

export interface RedesServiceOptions {
  userData: string
  safeStorage: SafeStorageLike
  fetch: HttpFetch
  /** Cada mudança, com o estado inteiro (sem token nem segredo). Quem monta decide se vai às janelas (bloqueio). */
  onState: (state: RedesState) => void
  now?: () => number
  testMediaHost: MediaHostTester
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

  return {
    async init() {
      const [stored, host] = await Promise.all([store.listAccounts(), store.readMediaHost()])
      accounts.clear()
      // A conta sem token no cofre (cofre apagado, outro Mac) já nasce pedindo um token novo.
      const vault = readTokens()
      for (const account of stored) accounts.set(account.id, vault.tokens[account.id] ? account : { ...account, state: 'expirada', error: REDES_EXPIRED_MESSAGE })
      mediaHost = host
      emit()
      void refreshDue()
      if (!timer && !disposed) {
        timer = setInterval(() => void refreshDue(), REDES_REFRESH_INTERVAL_MS)
        timer.unref()
      }
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
        await store.removeAccount(id)
        accounts.delete(id)
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

    dispose() {
      disposed = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
