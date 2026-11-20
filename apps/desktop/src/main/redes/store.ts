// Arquivos locais das redes (contrato 69, decisão 4 do plan redes-instagram), em `userData/redes/` (0700): um
// `instagram-<id>.json` por conta (0600) e o `media-host.json` com a configuração do armazenamento sem a chave secreta e o
// último teste. Gravação atômica (temporário + `rename`), validada pelo zod na leitura; arquivo ausente ou inválido vale
// como vazio. Nesta fase o arquivo da conta guarda só o perfil em cache e o estado; a fila de publicações, os comentários
// e o resto entram nos contratos seguintes. Remover a conta apaga o arquivo (não há `removedAt`). Nenhum segredo vai
// para estes arquivos: o token e a chave secreta ficam no cofre (`accounts/instagram.bin`, `accounts/media-host.bin`).
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { mediaHostConfigSchema, mediaHostTestSchema, REDES_ACCOUNT_ID_PATTERN, redesAccountSchema, type MediaHostConfig, type MediaHostStatus, type RedesAccount } from '../../shared/redes'

export const REDES_DIR = 'redes'
export const MEDIA_HOST_FILE = 'media-host.json'
const STORE_VERSION = 1
const ACCOUNT_FILE = /^instagram-(\d{1,32})\.json$/

const accountFileSchema = z.object({ version: z.literal(STORE_VERSION), account: redesAccountSchema }).strict()
const mediaHostFileSchema = z.object({ version: z.literal(STORE_VERSION), config: mediaHostConfigSchema, lastTest: mediaHostTestSchema.nullable() }).strict()

export interface StoredMediaHost {
  config: MediaHostConfig
  lastTest: MediaHostStatus['lastTest']
}

export interface RedesStore {
  readonly dir: string
  accountFile(accountId: string): string
  listAccounts(): Promise<RedesAccount[]>
  writeAccount(account: RedesAccount): Promise<void>
  removeAccount(accountId: string): Promise<void>
  readMediaHost(): Promise<StoredMediaHost | null>
  writeMediaHost(value: StoredMediaHost): Promise<void>
  removeMediaHost(): Promise<void>
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

    async writeAccount(account) {
      const valid = redesAccountSchema.parse(account)
      await ensureDir()
      await writeAtomic(accountFile(valid.id), `${JSON.stringify({ version: STORE_VERSION, account: valid }, null, 2)}\n`)
    },

    async removeAccount(accountId) {
      await rm(accountFile(accountId), { force: true })
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
  }
}
