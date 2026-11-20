// Arquivos locais das redes (contrato 69, decisão 4 do plan redes-instagram), em `userData/redes/` (0700): um
// `instagram-<id>.json` por conta (0600) e o `media-host.json` com a configuração do armazenamento sem a chave secreta e o
// último teste. Gravação atômica (temporário + `rename`), validada pelo zod na leitura; arquivo ausente ou inválido vale
// como vazio. O arquivo da conta guarda o perfil em cache, o estado e (contrato 71) a fila de publicações; comentários e o
// resto entram nos contratos seguintes. Remover a conta apaga o arquivo (não há `removedAt`). As cópias das mídias das
// publicações ficam em `midia/<publicação>/` (0700), apagadas com a publicação. Nenhum segredo vai
// para estes arquivos: o token e a chave secreta ficam no cofre (`accounts/instagram.bin`, `accounts/media-host.bin`).
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  mediaHostConfigSchema,
  mediaHostTestSchema,
  PUBLICATION_ID_PATTERN,
  publicationSchema,
  REDES_ACCOUNT_ID_PATTERN,
  redesAccountSchema,
  type MediaHostConfig,
  type MediaHostStatus,
  type Publication,
  type RedesAccount,
} from '../../shared/redes'

export const REDES_DIR = 'redes'
export const MEDIA_HOST_FILE = 'media-host.json'
/** Contrato 71: as cópias das mídias das publicações, uma pasta por publicação. */
export const MEDIA_DIR = 'midia'
// 73: comentários
/** Contrato 73: as miniaturas das mídias publicadas (`thumbs/<mediaId>.jpg`), baixadas pelo main. */
export const THUMBS_DIR = 'thumbs'
// fim 73
const STORE_VERSION = 1
const ACCOUNT_FILE = /^instagram-(\d{1,32})\.json$/

// Contrato 71: `publications` entrou sem mudar a versão (o arquivo do 69, sem ela, vale como fila vazia).
const accountFileSchema = z.object({ version: z.literal(STORE_VERSION), account: redesAccountSchema, publications: z.array(publicationSchema).default([]) }).strict()
type AccountFile = z.output<typeof accountFileSchema>
const mediaHostFileSchema = z.object({ version: z.literal(STORE_VERSION), config: mediaHostConfigSchema, lastTest: mediaHostTestSchema.nullable() }).strict()

export interface StoredMediaHost {
  config: MediaHostConfig
  lastTest: MediaHostStatus['lastTest']
}

export interface RedesStore {
  readonly dir: string
  accountFile(accountId: string): string
  listAccounts(): Promise<RedesAccount[]>
  /** Grava o perfil e o estado; a fila que já está no arquivo fica. */
  writeAccount(account: RedesAccount): Promise<void>
  removeAccount(accountId: string): Promise<void>
  /** Contrato 71: a fila de publicações da conta (vazia sem arquivo). */
  readPublications(accountId: string): Promise<Publication[]>
  /** Grava a fila inteira; sem o arquivo da conta (removida), não grava nada e devolve `false`. */
  writePublications(accountId: string, publications: Publication[]): Promise<boolean>
  /** A pasta das cópias de uma publicação (`midia/<id>`), criada (0700) se `create`. */
  mediaDir(publicationId: string, create?: boolean): Promise<string>
  removeMediaDir(publicationId: string): Promise<void>
  readMediaHost(): Promise<StoredMediaHost | null>
  writeMediaHost(value: StoredMediaHost): Promise<void>
  removeMediaHost(): Promise<void>
  // 73: comentários
  /** Contrato 73: os comentários da conta (`instagram-<id>.comments.json`), cru (quem lê valida); `null` sem arquivo. */
  readComments(accountId: string): Promise<unknown>
  /** Grava na mesma fila de escrita da conta; sem o arquivo da conta (removida), não grava e devolve `false`. */
  writeComments(accountId: string, value: unknown): Promise<boolean>
  removeComments(accountId: string): Promise<void>
  /** A pasta das miniaturas das mídias (`thumbs/`, 0700), criada se `create`. */
  thumbsDir(create?: boolean): Promise<string>
  // fim 73
  // 74: mensagens
  /** Contrato 74: as conversas e mensagens da conta (`instagram-<id>.messages.json`), cru (quem lê valida); `null` sem arquivo. */
  readMessages(accountId: string): Promise<unknown>
  /** Grava na mesma fila de escrita da conta; sem o arquivo da conta (removida), não grava e devolve `false`. */
  writeMessages(accountId: string, value: unknown): Promise<boolean>
  removeMessages(accountId: string): Promise<void>
  // fim 74
  // 75: métricas
  /** Contrato 75: o cache das métricas da conta (`instagram-<id>.metrics.json`), cru (quem lê valida); `null` sem arquivo. */
  readMetrics(accountId: string): Promise<unknown>
  /** Grava o cache na mesma fila de escrita da conta; sem o arquivo da conta (removida), não grava e devolve `false`. */
  writeMetrics(accountId: string, value: unknown): Promise<boolean>
  /**
   * Lê e regrava o cache dentro da fila da conta (duas leituras em paralelo, de períodos diferentes, não se apagam):
   * `change` recebe o conteúdo cru de agora e devolve o novo. Sem o arquivo da conta, não grava e devolve `null`.
   */
  updateMetrics<T>(accountId: string, change: (current: unknown) => T): Promise<T | null>
  removeMetrics(accountId: string): Promise<void>
  // fim 75
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temp, content, { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** `root` é `userData/redes`. */
export function createRedesStore(root: string): RedesStore {
  const ensureDir = async (): Promise<void> => {
    await mkdir(root, { recursive: true, mode: 0o700 })
    await chmod(root, 0o700)
  }
  const accountFile = (accountId: string): string => {
    if (!REDES_ACCOUNT_ID_PATTERN.test(accountId)) throw new Error('conta inválida')
    return join(root, `instagram-${accountId}.json`)
  }
  const readAccountFile = async (accountId: string): Promise<AccountFile | null> => {
    const parsed = accountFileSchema.safeParse(await readJson(accountFile(accountId)))
    return parsed.success && parsed.data.account.id === accountId ? parsed.data : null
  }
  // Contrato 71: o perfil (renovação do token) e a fila (publicação em curso) mudam o mesmo arquivo por caminhos
  // diferentes do serviço; cada gravação lê o que está lá e regrava, uma por vez por conta, para nenhuma apagar a outra.
  const chains = new Map<string, Promise<unknown>>()
  const perAccount = <T>(accountId: string, task: () => Promise<T>): Promise<T> => {
    const run = (chains.get(accountId) ?? Promise.resolve()).then(task, task)
    const settled = run.catch(() => undefined)
    chains.set(accountId, settled)
    void settled.then(() => {
      if (chains.get(accountId) === settled) chains.delete(accountId)
    })
    return run
  }
  const writeFileOf = async (file: AccountFile): Promise<void> => {
    await ensureDir()
    await writeAtomic(accountFile(file.account.id), `${JSON.stringify({ version: STORE_VERSION, account: file.account, publications: file.publications }, null, 2)}\n`)
  }
  // 75: métricas
  const metricsFile = (accountId: string): string => `${accountFile(accountId).slice(0, -'.json'.length)}.metrics.json`
  // fim 75
  // 74: mensagens
  const messagesFile = (accountId: string): string => `${accountFile(accountId).slice(0, -'.json'.length)}.messages.json`
  // fim 74
  // 73: comentários
  const commentsFile = (accountId: string): string => `${accountFile(accountId).slice(0, -'.json'.length)}.comments.json`
  // fim 73
  const mediaPath = (publicationId: string): string => {
    if (!PUBLICATION_ID_PATTERN.test(publicationId)) throw new Error('publicação inválida')
    return join(root, MEDIA_DIR, publicationId)
  }

  return {
    dir: root,
    accountFile,

    async listAccounts() {
      let names: string[]
      try {
        names = await readdir(root)
      } catch {
        return []
      }
      const accounts: RedesAccount[] = []
      for (const name of names.sort()) {
        const match = ACCOUNT_FILE.exec(name)
        if (!match) continue
        const parsed = accountFileSchema.safeParse(await readJson(join(root, name)))
        // O arquivo é de uma conta só: o id de dentro tem que ser o do nome.
        if (parsed.success && parsed.data.account.id === match[1]) accounts.push(parsed.data.account)
      }
      return accounts
    },

    writeAccount(account) {
      const valid = redesAccountSchema.parse(account)
      return perAccount(valid.id, async () => {
        const current = await readAccountFile(valid.id)
        await writeFileOf({ version: STORE_VERSION, account: valid, publications: current?.publications ?? [] })
      })
    },

    removeAccount(accountId) {
      const file = accountFile(accountId)
      return perAccount(accountId, () => rm(file, { force: true }))
    },

    async readPublications(accountId) {
      return (await readAccountFile(accountId))?.publications ?? []
    },

    writePublications(accountId, publications) {
      const valid = publications.map((item) => publicationSchema.parse(item))
      return perAccount(accountId, async () => {
        const current = await readAccountFile(accountId)
        if (!current) return false
        await writeFileOf({ ...current, publications: valid })
        return true
      })
    },

    async mediaDir(publicationId, create = false) {
      const dir = mediaPath(publicationId)
      if (create) {
        await ensureDir()
        await mkdir(join(root, MEDIA_DIR), { recursive: true, mode: 0o700 })
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await chmod(dir, 0o700)
      }
      return dir
    },

    async removeMediaDir(publicationId) {
      await rm(mediaPath(publicationId), { recursive: true, force: true })
    },

    async readMediaHost() {
      const parsed = mediaHostFileSchema.safeParse(await readJson(join(root, MEDIA_HOST_FILE)))
      return parsed.success ? { config: parsed.data.config, lastTest: parsed.data.lastTest } : null
    },

    async writeMediaHost(value) {
      const config = mediaHostConfigSchema.parse(value.config)
      const lastTest = value.lastTest ? mediaHostTestSchema.parse(value.lastTest) : null
      await ensureDir()
      await writeAtomic(join(root, MEDIA_HOST_FILE), `${JSON.stringify({ version: STORE_VERSION, config, lastTest }, null, 2)}\n`)
    },

    async removeMediaHost() {
      await rm(join(root, MEDIA_HOST_FILE), { force: true })
    },

    // 73: comentários
    // Um arquivo à parte (`instagram-<id>.comments.json`): a gravação da fila, que regrava o da conta, não apaga o `read`.
    async readComments(accountId) {
      return readJson(commentsFile(accountId))
    },

    writeComments(accountId, value) {
      const file = commentsFile(accountId)
      return perAccount(accountId, async () => {
        if (!(await readAccountFile(accountId))) return false
        await ensureDir()
        await writeAtomic(file, `${JSON.stringify(value)}\n`)
        return true
      })
    },

    removeComments(accountId) {
      const file = commentsFile(accountId)
      return perAccount(accountId, () => rm(file, { force: true }))
    },

    async thumbsDir(create = false) {
      const dir = join(root, THUMBS_DIR)
      if (create) {
        await ensureDir()
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await chmod(dir, 0o700)
      }
      return dir
    },
    // fim 73

    // 75: métricas
    // Um arquivo à parte (`instagram-<id>.metrics.json`): a gravação da fila, que regrava o da conta, não apaga as métricas.
    async readMetrics(accountId) {
      return readJson(metricsFile(accountId))
    },

    writeMetrics(accountId, value) {
      const file = metricsFile(accountId)
      return perAccount(accountId, async () => {
        if (!(await readAccountFile(accountId))) return false
        await ensureDir()
        await writeAtomic(file, `${JSON.stringify(value)}\n`)
        return true
      })
    },

    updateMetrics(accountId, change) {
      const file = metricsFile(accountId)
      return perAccount(accountId, async () => {
        if (!(await readAccountFile(accountId))) return null
        const next = change(await readJson(file))
        await ensureDir()
        await writeAtomic(file, `${JSON.stringify(next)}\n`)
        return next
      })
    },

    removeMetrics(accountId) {
      const file = metricsFile(accountId)
      return perAccount(accountId, () => rm(file, { force: true }))
    },
    // fim 75

    // 74: mensagens
    // Um arquivo à parte (`instagram-<id>.messages.json`), como o das métricas: a fila e as mensagens não se apagam.
    async readMessages(accountId) {
      return readJson(messagesFile(accountId))
    },

    writeMessages(accountId, value) {
      const file = messagesFile(accountId)
      return perAccount(accountId, async () => {
        if (!(await readAccountFile(accountId))) return false
        await ensureDir()
        await writeAtomic(file, `${JSON.stringify(value)}\n`)
        return true
      })
    },

    removeMessages(accountId) {
      const file = messagesFile(accountId)
      return perAccount(accountId, () => rm(file, { force: true }))
    },
    // fim 74
  }
}
