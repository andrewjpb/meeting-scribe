// Contrato 78: os eventos que o Assistente pôs no Calendário do Mac, em `userData/chat-events.json`, com os ids do
// EventKit, para a fase de alterar e tirar da agenda o que o app gravou (hoje só grava; ninguém lê além dos testes).
// Arquivo 0600, gravação atômica (temporário + `rename`) e as operações numa fila só, como os outros registros.
// Leitura leniente: linha fora do esquema sai sozinha. Arquivo ilegível (ou de outra versão) nunca é sobrescrito: vira
// `chat-events.<instante>.bad` e o registro começa de novo. Nenhum log com título.
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const CHAT_EVENTS_FILE = 'chat-events.json'
/** Passou disto, saem os mais antigos. */
export const CHAT_EVENTS_MAX = 2000

const text = z.string().max(4096)

const chatEventSchema = z
  .object({
    actionId: z.string().regex(/^[\w-]{1,40}$/),
    chatId: z.string().regex(/^[\w-]{1,100}$/),
    calendarId: text.min(1),
    eventIdentifier: text.nullable(),
    calendarItemIdentifier: text.min(1),
    externalIdentifier: text.nullable(),
    title: text,
    start: text,
    end: text,
    allDay: z.boolean(),
    createdAt: text,
  })
  .strict()
export type ChatEventRecord = z.infer<typeof chatEventSchema>

export interface ChatEventsStore {
  add(record: ChatEventRecord): Promise<void>
  list(): Promise<ChatEventRecord[]>
}

export function createChatEventsStore(root: string, options: { now?: () => number; log?: (message: string) => void } = {}): ChatEventsStore {
  const now = options.now ?? Date.now
  const log = options.log ?? (() => undefined)
  const file = join(root, CHAT_EVENTS_FILE)
  let queue: Promise<unknown> = Promise.resolve()
  let counter = 0

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  /** O arquivo que não se lê sai do caminho, com o conteúdo intacto, para o próximo `add` não apagá-lo. */
  async function setAside(): Promise<void> {
    const bad = join(root, `chat-events.${now()}.bad`)
    await rename(file, bad).catch(() => undefined)
    await chmod(bad, 0o600).catch(() => undefined)
    log('[assistente] chat-events.json ilegível: guardado à parte, o registro começa vazio')
  }

  async function load(): Promise<ChatEventRecord[]> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    const shape = z.object({ version: z.literal(1), events: z.array(z.unknown()) }).safeParse(parsed)
    if (!shape.success) {
      await setAside()
      return []
    }
    return shape.data.events.flatMap((item) => {
      const row = chatEventSchema.safeParse(item)
      return row.success ? [row.data] : []
    })
  }

  async function save(events: readonly ChatEventRecord[]): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temp = `${file}.tmp-${process.pid}-${++counter}`
    try {
      await writeFile(temp, `${JSON.stringify({ version: 1, events: events.slice(-CHAT_EVENTS_MAX) })}\n`, { mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  return {
    add: (record) =>
      serial(async () => {
        const row = chatEventSchema.parse(record)
        await save([...(await load()), row])
      }),
    list: () => serial(load),
  }
}
