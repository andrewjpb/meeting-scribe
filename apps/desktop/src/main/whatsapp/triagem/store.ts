// Triagem do WhatsApp (contrato 159): o store de `userData/whatsapp/triagem.json`, as etiquetas por conversa. Gravação
// como os outros stores: fila serial, temporário + `rename`, `0o600`; cada mutação grava o arquivo inteiro, já podado
// às `TRIAGEM_ETIQUETAS_MAX` mais recentes. Arquivo ausente vale vazio; inválido vira `triagem.json.corrupt-<stamp>` e
// a triagem parte vazia. O log nunca leva texto de mensagem nem motivo. Sem Electron.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { podarEtiquetas, TRIAGEM_VERSION, type Etiqueta, type TriagemFile } from '../../../shared/triagem'
import { etiquetaSchema, triagemChatIdSchema, triagemFileSchema } from '../../../shared/triagem-schema'
import { WHATSAPP_PATHS } from '../install'

export interface TriagemStore {
  /** Cópia das etiquetas, pelo `chatId`. */
  list(): Promise<Record<string, Etiqueta>>
  get(chatId: string): Promise<Etiqueta | null>
  /** Grava a etiqueta da conversa; `false` se o `chatId` ou a etiqueta forem inválidos (nada é gravado). */
  set(chatId: string, etiqueta: Etiqueta): Promise<boolean>
  remove(chatId: string): Promise<void>
  clear(): Promise<void>
}

export interface TriagemStoreOptions {
  /** `userData/whatsapp`. */
  dir: string
  now?: () => number
  devLog?: (message: string) => void
}

const codigo = (error: unknown): unknown => (error instanceof Error && 'code' in error ? error.code : undefined)

export function createTriagemStore({ dir, now = Date.now, devLog = () => undefined }: TriagemStoreOptions): TriagemStore {
  const name = WHATSAPP_PATHS.triagem
  const file = join(dir, name)
  let queue: Promise<unknown> = Promise.resolve()
  let cache: Record<string, Etiqueta> | null = null

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function write(etiquetas: Record<string, Etiqueta>): Promise<void> {
    await mkdir(dir, { recursive: true })
    const content: TriagemFile = { version: TRIAGEM_VERSION, etiquetas }
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
    cache = etiquetas
  }

  async function load(): Promise<Record<string, Etiqueta>> {
    if (cache) return cache
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (codigo(error) !== 'ENOENT') throw error
      cache = {}
      return cache
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    const content = triagemFileSchema.safeParse(parsed)
    if (content.success) {
      cache = content.data.etiquetas
      return cache
    }
    // Nunca sobrescrever o inválido: sem o `rename`, a leitura falha e nada é gravado por cima.
    const at = now()
    await rename(file, `${file}.corrupt-${at}`)
    devLog(`[triagem] ${name} inválido; guardado como ${name}.corrupt-${at} e a triagem parte vazia`)
    cache = {}
    return cache
  }

  /** Lê, muda uma cópia e grava o arquivo inteiro na mesma vez da fila. */
  const mutate = (fn: (draft: Record<string, Etiqueta>) => Record<string, Etiqueta>): Promise<void> =>
    serial(async () => {
      await write(fn(structuredClone(await load())))
    })

  return {
    list: () => serial(async () => structuredClone(await load())),

    get: (chatId) =>
      serial(async () => {
        const atual = await load()
        return Object.hasOwn(atual, chatId) ? structuredClone(atual[chatId] ?? null) : null
      }),

    set: async (chatId, etiqueta) => {
      if (!triagemChatIdSchema.safeParse(chatId).success) return false
      const parsed = etiquetaSchema.safeParse(etiqueta)
      if (!parsed.success) return false
      await mutate((draft) => podarEtiquetas({ ...draft, [chatId]: parsed.data }))
      return true
    },

    remove: (chatId) =>
      serial(async () => {
        const atual = await load()
        if (!Object.hasOwn(atual, chatId)) return
        const { [chatId]: _removida, ...resto } = atual
        await write(resto)
      }),

    clear: () => mutate(() => ({})),
  }
}
