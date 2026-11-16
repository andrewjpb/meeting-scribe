// Cliente HTTP do serviço local do WhatsApp (contrato 24): só `127.0.0.1`, com `Authorization: Bearer <token>`
// em todo pedido, e toda resposta conferida com zod antes de chegar ao resto do app. O envio exige a prova de
// clique (`SendProof`, de `send-guard.ts`). `/events` é lido como SSE e reconectado pelo serviço do main. Nada
// daqui vai para log com texto de mensagem.
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { z } from 'zod'
import { WHATSAPP_SERVICE_STATES, type WhatsAppChat, type WhatsAppMe, type WhatsAppMessage, type WhatsAppSearchHit, type WhatsAppServiceState } from '../../shared/whatsapp'
import { isSendProof, type SendProof } from './send-guard'

export const WHATSAPP_HOST = '127.0.0.1'
const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_MAX = 8 * 1024 * 1024

const meSchema: z.ZodType<WhatsAppMe> = z.object({ name: z.string().max(200), phone: z.string().max(40) })
export const healthSchema = z.object({
  version: z.string().max(40),
  state: z.enum(WHATSAPP_SERVICE_STATES),
  me: meSchema.nullable(),
  /** Com o token: o id da instalação e o PID do serviço. */
  id: z.string().max(64).optional(),
  pid: z.number().int().positive().optional(),
})
const mediaSchema = z.object({
  kind: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'other']),
  mime: z.string().max(100).nullable(),
  size: z.number().int().nonnegative().nullable(),
  name: z.string().max(200).nullable(),
})
export const messageSchema = z.object({
  id: z.string().min(1).max(200),
  chatId: z.string().min(1).max(200),
  author: z.string().max(200),
  fromMe: z.boolean(),
  at: z.number().int().nonnegative(),
  type: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'other']),
  text: z.string().max(20_000),
  media: mediaSchema.nullable(),
})
const chatSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200),
  kind: z.enum(['person', 'group']),
  unread: z.number().int().nonnegative(),
  lastMessage: messageSchema.nullable(),
})
const pairSchema = z.object({ state: z.enum(WHATSAPP_SERVICE_STATES), qr: z.string().max(4000).nullable(), code: z.string().max(40).nullable() })
const chatsSchema = z.object({ chats: z.array(chatSchema).max(5000) })
const messagesSchema = z.object({ messages: z.array(messageSchema).max(1000) })
const searchSchema = z.object({ messages: z.array(messageSchema.extend({ chatName: z.string().max(200) })).max(1000) })
const sendSchema = z.object({ id: z.string().min(1).max(200) })
const eventMessageSchema = messageSchema.extend({ chatName: z.string().max(200).nullable().optional() })

export type WhatsAppHealth = z.infer<typeof healthSchema>

export class WhatsAppServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`serviço do WhatsApp respondeu ${status} (${code})`)
  }
}

export type BridgeEvent = { type: 'state'; health: WhatsAppHealth } | { type: 'message'; message: WhatsAppMessage; chatName: string | null }

export interface BridgeClient {
  readonly port: number
  health(): Promise<WhatsAppHealth>
  pair(phone?: string): Promise<{ state: WhatsAppServiceState; qr: string | null; code: string | null }>
  logout(): Promise<WhatsAppHealth>
  chats(): Promise<WhatsAppChat[]>
  /** Com `before` e `beforeId`, o cursor (hora, id): as do mesmo milissegundo com id menor também vêm. */
  messages(chatId: string, options?: { before?: number; beforeId?: string; limit?: number }): Promise<WhatsAppMessage[]>
  search(term: string): Promise<WhatsAppSearchHit[]>
  /** Só com a prova de um clique de verdade, para a mesma conversa. */
  send(proof: SendProof, chatId: string, text: string): Promise<string>
  /** SSE de `/events`; `onClose` quando a conexão cai. Devolve o que fecha. */
  events(onEvent: (event: BridgeEvent) => void, onClose: () => void): () => void
  /** Rotas do serviço falso (smoke): ler o QR, receber uma mensagem. */
  fake(action: string, body?: Record<string, unknown>): Promise<unknown>
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > RESPONSE_MAX) {
        res.destroy()
        reject(new WhatsAppServiceError(0, 'too-large'))
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    res.on('error', reject)
  })
}

const chatPath = (chatId: string): string => encodeURIComponent(chatId)

export function createBridgeClient(port: number, token: string): BridgeClient {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('porta inválida')
  const headers = { Authorization: `Bearer ${token}` }

  function call<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
      const req = httpRequest(
        {
          host: WHATSAPP_HOST,
          port,
          method,
          path,
          headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.byteLength) } : {}) },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          readBody(res).then((text) => {
            let parsed: unknown
            try {
              parsed = JSON.parse(text)
            } catch {
              reject(new WhatsAppServiceError(res.statusCode ?? 0, 'json'))
              return
            }
            if ((res.statusCode ?? 0) !== 200) {
              const code = typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string' ? (parsed as { error: string }).error : 'http'
              reject(new WhatsAppServiceError(res.statusCode ?? 0, code.slice(0, 40)))
              return
            }
            const checked = schema.safeParse(parsed)
            if (checked.success) resolve(checked.data)
            else reject(new WhatsAppServiceError(200, 'schema'))
          }, reject)
        },
      )
      req.on('timeout', () => req.destroy(new WhatsAppServiceError(0, 'timeout')))
      req.on('error', reject)
      req.end(data)
    })
  }

  return {
    port,
    health: () => call('GET', '/health', healthSchema),
    pair: (phone) => call('GET', phone ? `/pair?phone=${encodeURIComponent(phone)}` : '/pair', pairSchema),
    logout: () => call('POST', '/logout', healthSchema, {}),
    chats: async () => (await call('GET', '/chats', chatsSchema)).chats,
    messages: async (chatId, options = {}) => {
      const query = new URLSearchParams()
      if (options.before !== undefined) query.set('before', String(Math.floor(options.before)))
      if (options.before !== undefined && options.beforeId !== undefined) query.set('beforeId', options.beforeId)
      if (options.limit !== undefined) query.set('limit', String(Math.floor(options.limit)))
      const suffix = query.size ? `?${query.toString()}` : ''
      return (await call('GET', `/chats/${chatPath(chatId)}/messages${suffix}`, messagesSchema)).messages
    },
    search: async (term) => (await call('GET', `/search?q=${encodeURIComponent(term)}`, searchSchema)).messages,
    send: async (proof, chatId, text) => {
      if (!isSendProof(proof) || proof.chatId !== chatId) throw new WhatsAppServiceError(0, 'click')
      return (await call('POST', `/chats/${chatPath(chatId)}/send`, sendSchema, { text })).id
    },
    fake: (action, body = {}) => call('POST', `/_fake/${action}`, z.unknown(), body),

    events(onEvent, onClose) {
      let closed = false
      const req = httpRequest({ host: WHATSAPP_HOST, port, method: 'GET', path: '/events', headers: { ...headers, Accept: 'text/event-stream' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return
        }
        res.setEncoding('utf8')
        let buffer = ''
        res.on('data', (chunk: string) => {
          buffer += chunk
          if (buffer.length > RESPONSE_MAX) {
            res.destroy()
            return
          }
          let end: number
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const parsed = parseSseBlock(block)
            if (parsed) onEvent(parsed)
          }
        })
      })
      const finish = (): void => {
        if (closed) return
        closed = true
        onClose()
      }
      req.on('error', finish)
      req.on('close', finish)
      req.end()
      return () => {
        closed = true
        req.destroy()
      }
    },
  }
}

/**
 * `/health` sem token: o id da instalação que o serviço naquela porta diz ter. O app só manda o token para a porta
 * salva depois de este id bater com o guardado (outro programa na mesma porta não recebe o token).
 */
export function probeInstance(port: number): Promise<string | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = httpRequest({ host: WHATSAPP_HOST, port, method: 'GET', path: '/health', timeout: 3000 }, (res) => {
      readBody(res).then(
        (text) => {
          try {
            const parsed = z.object({ id: z.string().max(64) }).safeParse(JSON.parse(text))
            resolve(res.statusCode === 200 && parsed.success ? parsed.data.id : null)
          } catch {
            resolve(null)
          }
        },
        () => resolve(null),
      )
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}

/** Um bloco do SSE (`event:` e `data:`) para um evento conferido; comentário e evento desconhecido são `null`. */
export function parseSseBlock(block: string): BridgeEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch {
    return null
  }
  if (event === 'state') {
    const health = healthSchema.safeParse(payload)
    return health.success ? { type: 'state', health: health.data } : null
  }
  if (event === 'message') {
    const message = eventMessageSchema.safeParse(payload)
    if (!message.success) return null
    const { chatName, ...rest } = message.data
    return { type: 'message', message: rest, chatName: chatName ?? null }
  }
  return null
}
