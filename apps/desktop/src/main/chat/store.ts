// Conversas do chat em `userData/chats/<id>.json` (contrato 15, CA6). Gravação atômica (temporário +
// `rename`) em fila, como os outros stores. Arquivo inválido é ignorado: não aparece na lista e abrir dá
// "não encontrada". Ao gravar, ficam as 200 mensagens mais recentes, cada uma com até 20 000 caracteres.
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CHAT_MESSAGES_MAX, CHAT_TEXT_MAX, CHAT_TITLE_MAX, type Chat, type ChatListItem } from '../../shared/chat'

export const CHATS_DIR = 'chats'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'data inválida')
export const chatIdSchema = z.string().regex(/^[\w-]{1,100}$/)

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(CHAT_TEXT_MAX),
  at: isoDate,
  error: z.enum(['stopped', 'timeout', 'failed', 'not-found']).optional(),
})

export const chatSchema = z.object({
  id: chatIdSchema,
  meetingId: z.string().min(1).max(200).nullable(),
  title: z.string().max(CHAT_TITLE_MAX),
  createdAt: isoDate,
  messages: z.array(messageSchema).max(CHAT_MESSAGES_MAX),
})

export interface ChatStore {
  /** Todas as conversas válidas, da mais recente (última mensagem) para a mais antiga. */
  list(): Promise<ChatListItem[]>
  get(id: string): Promise<Chat | null>
  /** Grava a conversa inteira, cortando para os limites. */
  save(chat: Chat): Promise<Chat>
  remove(id: string): Promise<boolean>
}

/** Os limites do CA6 aplicados antes de gravar. */
export function clampChat(chat: Chat): Chat {
  return {
    ...chat,
    title: chat.title.slice(0, CHAT_TITLE_MAX),
    messages: chat.messages.slice(-CHAT_MESSAGES_MAX).map((message) => ({ ...message, text: message.text.slice(0, CHAT_TEXT_MAX) })),
  }
}

export function chatListItem(chat: Chat): ChatListItem {
  return { id: chat.id, meetingId: chat.meetingId, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.messages.at(-1)?.at ?? chat.createdAt }
}

export function createFileChatStore({ dir }: { dir: string }): ChatStore {
  const folder = join(dir, CHATS_DIR)
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const pathOf = (id: string): string | null => (chatIdSchema.safeParse(id).success ? join(folder, `${id}.json`) : null)

  async function read(file: string, id: string): Promise<Chat | null> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    const result = chatSchema.safeParse(parsed)
    // Conversa copiada com outro nome também não vale.
    if (!result.success || result.data.id !== id) return null
    return result.data
  }

  return {
    list: () =>
      serial(async () => {
        let names: string[]
        try {
          names = await readdir(folder)
        } catch {
          return []
        }
        const chats = await Promise.all(names.filter((name) => /^[\w-]{1,100}\.json$/.test(name)).map((name) => read(join(folder, name), name.slice(0, -'.json'.length))))
        return chats
          .filter((chat): chat is Chat => chat !== null)
          .map(chatListItem)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      }),

    get: (id) =>
      serial(async () => {
        const file = pathOf(id)
        return file ? read(file, id) : null
      }),

    save: (input) =>
      serial(async () => {
        const chat = chatSchema.parse(clampChat(input))
        const file = pathOf(chat.id)
        if (!file) throw new Error('id de conversa inválido')
        await mkdir(folder, { recursive: true, mode: 0o700 })
        await chmod(folder, 0o700)
        const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
        await writeFile(temp, `${JSON.stringify(chat, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
        return chat
      }),

    remove: (id) =>
      serial(async () => {
        const file = pathOf(id)
        if (!file) return false
        try {
          await rm(file)
          return true
        } catch {
          return false
        }
      }),
  }
}
