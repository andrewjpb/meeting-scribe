// Painel de e-mail (contrato 155, D1): o store de `userData/email/dashboard.json`, no molde de `tarefas/store.ts`. Fila
// serial, temporário + `rename`, `0o600` (a pasta `0o700` quando é criada aqui). Arquivo inválido ou de outra versão vale
// o store vazio: é tudo derivado da INBOX e a próxima passada refaz (a próxima gravação o substitui). O log leva uma
// linha sem conteúdo de e-mail (R7). Sem Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMAIL_DASHBOARD_FILE, emptyDashboardStore, type EmailDashboardStore } from '../../shared/email-dashboard'
import { EmailDashboardStoreSchema } from '../../shared/email-dashboard-schema'

export interface EmailDashboardStoreApi {
  /** Arquivo ausente, inválido ou de outra versão: o store vazio (sem gravar). */
  load(): Promise<EmailDashboardStore>
  /** Grava o arquivo inteiro; fora do formato, lança e nada é gravado. */
  save(store: EmailDashboardStore): Promise<void>
  /** Lê, aplica `fn` numa cópia e grava, na mesma vez da fila; devolve o que foi gravado. */
  update(fn: (store: EmailDashboardStore) => EmailDashboardStore): Promise<EmailDashboardStore>
  /** Tira os itens, ignorados e abertos da conta (chaves `<conta>:…`). */
  removeAccount(accountId: string): Promise<void>
  /** Apaga o arquivo. */
  clear(): Promise<void>
}

export interface EmailDashboardStoreOptions {
  log?: (message: string) => void
}

function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
}

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

export function createEmailDashboardStore(dir: string, { log = () => undefined }: EmailDashboardStoreOptions = {}): EmailDashboardStoreApi {
  const file = join(dir, EMAIL_DASHBOARD_FILE)
  const serial = serialQueue()

  async function read(): Promise<EmailDashboardStore> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      return emptyDashboardStore()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    const content = EmailDashboardStoreSchema.safeParse(parsed)
    if (content.success) return content.data
    log(`[email-dashboard] ${EMAIL_DASHBOARD_FILE} inválido ou de outra versão; o painel parte vazio`)
    return emptyDashboardStore()
  }

  async function write(store: EmailDashboardStore): Promise<void> {
    const valid = EmailDashboardStoreSchema.parse(store)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temp, `${JSON.stringify(valid, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, file)
    } catch (error) {
      // Sem o `rename`, o temporário não fica para trás.
      await rm(temp, { force: true })
      throw error
    }
  }

  const semConta = (accountId: string) => {
    const prefixo = `${accountId}:`
    return (key: string): boolean => !key.startsWith(prefixo)
  }

  return {
    load: () => serial(read),
    save: (store) => serial(() => write(store)),
    update: (fn) =>
      serial(async () => {
        const next = fn(structuredClone(await read()))
        await write(next)
        return structuredClone(next)
      }),
    removeAccount: (accountId) =>
      serial(async () => {
        const store = await read()
        const fica = semConta(accountId)
        const next: EmailDashboardStore = {
          ...store,
          items: Object.fromEntries(Object.entries(store.items).filter(([key]) => fica(key))),
          ignored: store.ignored.filter((mark) => fica(mark.key)),
          opened: store.opened.filter((mark) => fica(mark.key)),
        }
        // Nada da conta no arquivo: não grava (nem cria o arquivo).
        const mudou =
          Object.keys(next.items).length !== Object.keys(store.items).length || next.ignored.length !== store.ignored.length || next.opened.length !== store.opened.length
        if (mudou) await write(next)
      }),
    clear: () => serial(() => rm(file, { force: true })),
  }
}
